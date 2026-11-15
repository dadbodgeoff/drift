//! Wiring rules: "you added one, but did not register it".
//!
//! A **registry** is a place that lists the members of a role by reference: an
//! array or object passed to a call or decorator (`@Module({ providers: [...] })`),
//! a module-level list (`urlpatterns`, `INSTALLED_APPS`, `export const routes`),
//! the arguments of repeated calls on one receiver (`admin.site.register(M)`), or a
//! file that re-exports its siblings (a barrel). The facts come from the language
//! parsers ([`drift_core::FileFacts::registries`], [`drift_core::Export`]), so a
//! reference counts only when it resolves to the member's symbol, never by name.
//!
//! The rule is "members of role R are registered in registry G": proposed when G
//! names at least [`MIN_COVERAGE`] of R's members and R has at least
//! [`MIN_MEMBERS`] (spread over at least [`MIN_FILES`] files). A *family* of
//! registries in one slot (every `@Module`'s `providers`, every `urlpatterns`) can
//! play G's part when no single list does: then the member must be in one of them,
//! and the message names the nearest.
//!
//! Not proposed, or not checked, when a role's members are wired without being
//! listed ([`Discovery`]): file-based routing (Next.js), glob imports
//! (`import.meta.glob`, `require.context`), dependency-injection auto-registration
//! (Angular `providedIn`, `typedi`'s `@Service`, `tsyringe`), and Django and Celery
//! autodiscovery (`admin.py`, `models.py`, management commands, migrations, template
//! tags, `tasks.py` under `autodiscover_tasks()`). Below the coverage bar a list is
//! taken to cover a subset by design.
//!
//! Wiring rules are suggestion-tier (`registered_in` is not in the default tier's
//! allowlist) and are mined only when the `wiring` feature is on.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{ExportKind, FileFacts, RepoFacts, Symbol, SymbolKind, traits};
use serde::{Deserialize, Serialize};

use crate::check::{WireHint, WireLike};
use crate::mine::{
    Candidate, Evidence, Outlier, Rule, convention_id, name_patterns, wilson_lower_bound,
};
use crate::roles::{
    FileKinds, NonProduction, RoleSelector, View, is_test_path, selectors_for, units,
};

/// A registry must name at least this share of a role's members.
pub const MIN_COVERAGE: f64 = 0.9;
/// A role needs at least this many members (after autodiscovered ones are set aside).
pub const MIN_MEMBERS: usize = 5;
/// Members must come from at least this many files: one file's exports listed
/// next to each other are a module, not a pattern.
pub const MIN_FILES: usize = 3;
/// A role whose members are autodiscovered at least this often is wired by discovery.
const DISCOVERED_SHARE: f64 = 0.5;
/// Most wiring rules proposed per repository.
pub const MAX_WIRING_RULES: usize = 10;
/// Most registries one role is proposed with.
const MAX_PER_ROLE: usize = 2;
/// Registries listed in the census report (proposed or not).
const MAX_REPORTED: usize = 40;
/// Slot of a barrel: the file's re-exports.
pub const EXPORTS_SLOT: &str = "exports";
/// `RoleSelector::entry` of wiring roles: entry kinds come from registration
/// itself (a Django view is an `http` entry point because `urlpatterns` names it),
/// so wiring roles must not split on them.
pub const ANY_ENTRY: &str = "*";

/// Decorators that register a class with a DI container by themselves.
const AUTO_REGISTERING_DECORATORS: &[&str] = &[
    "pkg:typedi#Service",
    "pkg:tsyringe#singleton",
    "pkg:tsyringe#injectable",
    "pkg:tsyringe#autoInjectable",
    "pkg:tsyringe#registry",
    "pkg:inversify-binding-decorators#provide",
    "pkg:inversify-binding-decorators#fluentProvide",
];

/// Slot prefixes of file-based route definitions (TanStack Router).
const FILE_ROUTE_FACTORIES: &[&str] = &[
    "arg:pkg:@tanstack/react-router#createFileRoute",
    "arg:pkg:@tanstack/react-router#createLazyFileRoute",
    "arg:pkg:@tanstack/solid-router#createFileRoute",
    "arg:pkg:@tanstack/vue-router#createFileRoute",
];

/// Why a member needs no registration: it is wired by discovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Discovery {
    /// A route, page or layout of a file-based router (Next.js).
    FileRouting,
    /// Loaded by `import.meta.glob` or `require.context`.
    GlobImport,
    /// Registered by its own decorator (`@Injectable({ providedIn })`, `@Service()`).
    DiAutoRegistration,
    /// A module Django or Celery imports by convention.
    FrameworkAutodiscovery,
}

impl Discovery {
    pub fn as_str(self) -> &'static str {
        match self {
            Discovery::FileRouting => "file_routing",
            Discovery::GlobImport => "glob_import",
            Discovery::DiAutoRegistration => "di_auto_registration",
            Discovery::FrameworkAutodiscovery => "framework_autodiscovery",
        }
    }
}

/// A role member as wiring rules see it.
#[derive(Debug, Clone)]
struct Member<'a> {
    file: &'a FileFacts,
    symbol: &'a Symbol,
    /// `path#name` and `path#<exported name>` for each export name.
    keys: Vec<String>,
    roles: Vec<RoleSelector>,
    discovered: Option<Discovery>,
}

/// One list, with what it names.
#[derive(Debug, Clone)]
struct Reg<'a> {
    path: &'a str,
    slot: String,
    family: String,
    line: u32,
    /// Target -> line of the reference.
    items: BTreeMap<String, u32>,
    /// Module-level lists (`path#name`) whose items this one takes in by naming
    /// them (`common = [...services]`): registering in those is enough.
    derived: BTreeSet<String>,
    /// Targets spread into the list (`...USE_CASES`).
    spreads: BTreeSet<String>,
    /// Holds something Drift cannot resolve ([`drift_core::Registry::opaque`]), or
    /// spreads a list it cannot read: a member missing from it may be in it.
    opaque: bool,
    /// The list belongs to the app: its owner, if it is a Nest `@Module`, is
    /// imported somewhere or bootstrapped (`NestFactory.create`). A list of a module
    /// nothing imports registers nothing, so it is no sibling and no family member.
    live: bool,
    /// A dead list's `@Module` (its class name), for the fix: import it.
    dead_owner: String,
    /// Barrels: modules re-exported whole (`export * from "./a"`, `from .a import *`).
    stars: BTreeSet<String>,
    /// Barrels: targets re-exported only by a star re-export. A star re-export
    /// re-exports one module, so it is evidence of a barrel convention only for the
    /// barrel's own directory (see [`mine`]).
    star_items: BTreeSet<String>,
}

impl Reg<'_> {
    /// Whether a barrel names `m` only through a star re-export.
    fn star_only(&self, m: &Member) -> bool {
        let mut named = m.keys.iter().filter(|k| self.items.contains_key(*k));
        let mut any = false;
        named.all(|k| {
            any = true;
            self.star_items.contains(k)
        }) && any
    }

    /// Whether `m` is the class or binding that owns this list: `AppModule` for
    /// its `@Module({ providers })`, `appRouter` for `router({ ... })`. An owner
    /// is not a member of its own registry.
    fn owned_by(&self, m: &Member) -> bool {
        if m.file.path != self.path {
            return false;
        }
        let Some(call) = call_prefix(&self.slot).strip_prefix("arg:") else {
            return false;
        };
        m.symbol.args.iter().any(|a| {
            a.strip_prefix(call)
                .is_some_and(|rest| rest.starts_with(':'))
        })
    }

    fn names(&self, m: &Member) -> Option<u32> {
        if let Some(line) = m.keys.iter().find_map(|k| self.items.get(k)) {
            return Some(*line);
        }
        // A module named by string (Celery `include`) registers that module; a
        // package (`INSTALLED_APPS = ["dcim"]`) registers its app config
        // (`dcim/apps.py`), not what its modules or `__init__.py` declare.
        let path = m.file.path.as_str();
        self.items.iter().find_map(|(t, line)| {
            let module = t.strip_suffix("#*")?;
            let hit = (module == path && !module.ends_with("__init__.py"))
                || module
                    .strip_suffix("__init__.py")
                    .is_some_and(|dir| !dir.is_empty() && path == format!("{dir}apps.py"));
            hit.then_some(*line)
        })
    }
}

/// The registries and members of a repository.
pub struct WiringIndex<'a> {
    regs: Vec<Reg<'a>>,
    kinds: FileKinds,
    discovers: Vec<DiscoveryGlob>,
    celery_autodiscover: bool,
    django: bool,
    /// In-repo classes other classes extend: bases are not registered themselves.
    bases: BTreeSet<String>,
    /// Module-level lists that are registries (`path#urlpatterns`): a list is not a
    /// member of the lists it is like.
    lists: BTreeSet<String>,
    /// For each list, the lists reachable from it ([`reachability`]), itself first.
    reach: Vec<Vec<usize>>,
    /// For each module-level list, the lists that spread it (`[...USE_CASES, X]`).
    outers: Vec<Vec<usize>>,
    /// Nest root modules: `@Module` classes a file passes to `NestFactory.create*`
    /// (`path#name`). Bootstrapped, so registered nowhere.
    roots: BTreeSet<String>,
    /// Production files (`path` -> package): imports from them say how code is used.
    production: BTreeMap<&'a str, &'a str>,
}

/// A registry the census found covering most of a role, proposed or not.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RegistryReport {
    /// File of the list, or empty for a family of lists.
    pub path: String,
    pub line: u32,
    pub slot: String,
    /// For people: `Module() providers`, `urlpatterns`, `re-exports`.
    pub label: String,
    /// Lists in the family (1 for a single registry, whatever its lists in the file).
    pub lists: usize,
    pub role: RoleSelector,
    pub role_summary: String,
    pub members: usize,
    pub covered: usize,
    /// `proposed`, `below_threshold`, `opaque` (the list holds what Drift cannot
    /// resolve, so it could never say "missing"), `autodiscovered:<why>`, `subsumed`,
    /// `split` (some members are registered in another list of the same kind that
    /// this one does not reach: the family stands in) or `curated` (a barrel that
    /// leaves out members its own package imports directly: internal on purpose).
    pub status: String,
}

/// What wiring mining found.
#[derive(Debug, Clone, Default)]
pub struct WiringMined {
    pub candidates: Vec<Candidate>,
    pub registries: Vec<RegistryReport>,
}

/// The local part of a slot made file-independent: `calls:src/a.ts#router` ->
/// `calls:~#router`, so the same kind of list in many files forms one family.
pub fn family_of(path: &str, slot: &str) -> String {
    if path.is_empty() {
        return slot.to_string();
    }
    slot.replace(&format!("{path}#"), "~#")
}

/// The short name of a canonical reference (`pkg:@nestjs/common#Module` -> `Module`).
fn short_ref(r: &str) -> &str {
    let name = r.rsplit_once('#').map_or(r, |(_, n)| n);
    name.trim_end_matches("(new)")
}

/// A slot for people: `Module() providers`, `Celery(include=)`, `urlpatterns`,
/// `app.use() calls`, `re-exports`.
pub fn slot_label(slot: &str) -> String {
    if slot == EXPORTS_SLOT {
        return "re-exports".to_string();
    }
    if let Some(name) = slot.strip_prefix("binding:") {
        return if name == "default" {
            "`export default`".to_string()
        } else {
            format!("`{name}`")
        };
    }
    if let Some(recv) = slot.strip_prefix("calls:") {
        return format!("{}.…() calls", short_ref(recv));
    }
    if let Some(rest) = slot.strip_prefix("arg:")
        && let Some((callee, pos)) = rest.rsplit_once('@')
    {
        let (index, key) = pos.split_once(':').unwrap_or((pos, ""));
        let name = short_ref(callee);
        return match (index, key) {
            ("99", k) if !k.is_empty() => format!("{name}({k}=)"),
            (_, "") => format!(
                "{name}() argument {}",
                index.parse::<u32>().unwrap_or(0) + 1
            ),
            (_, k) => format!("{name}() {k}"),
        };
    }
    slot.to_string()
}

/// A plain identifier: route pseudo-symbols (`GET /x`) and view handler methods
/// (`View.get`) are not registrable units.
fn plain_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
}

/// Wiring roles of a symbol: its structural roles at every depth, any entry kind.
/// `None` for symbols no registry is for: bases, mixins, abstract classes,
/// protocols, type variables, and pseudo-symbols.
pub fn wiring_roles(file: &FileFacts, s: &Symbol, kinds: &FileKinds) -> Vec<RoleSelector> {
    if !plain_name(&s.name)
        || !matches!(
            s.kind,
            SymbolKind::Class
                | SymbolKind::Function
                | SymbolKind::Component
                | SymbolKind::Const
                | SymbolKind::Variable
        )
    {
        return vec![];
    }
    let has = |t: &str| s.traits.iter().any(|x| x == t);
    if [
        traits::BASE,
        traits::ABSTRACT,
        traits::DECLARED_ABSTRACT,
        traits::PROTOCOL,
        traits::TYPE_VAR,
    ]
    .into_iter()
    .any(has)
    {
        return vec![];
    }
    let variety = [
        traits::ENUM,
        traits::NAMEDTUPLE,
        traits::TYPEDDICT,
        traits::DATACLASS,
    ]
    .into_iter()
    .find(|t| has(t));
    selectors_for(file, ANY_ENTRY, s.kind, kinds)
        .into_iter()
        .map(|mut r| {
            r.variety = variety.map(str::to_string);
            r
        })
        .collect()
}

/// The directory of a path (`src/a/index.ts` -> `src/a`), empty at the root.
fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// Whether `path` is under the directory `dir` (any path is under the root).
fn under(path: &str, dir: &str) -> bool {
    dir.is_empty() || path.strip_prefix(dir).is_some_and(|r| r.starts_with('/'))
}

/// Longest discovery glob compiled; longer ones discover their literal prefix.
const MAX_GLOB_LEN: usize = 256;
/// Most `{` and `*` in a compiled discovery glob.
const MAX_GLOB_BRACES: usize = 8;
const MAX_GLOB_STARS: usize = 16;

/// A discovery glob (`import.meta.glob`, `require.context`), ready to match.
/// Patterns come from the repository, so matching must stay linear: `globset`
/// compiles to an automaton. A pattern over the complexity caps, or one it
/// rejects, discovers everything under its literal prefix (`src/pages/**`):
/// that makes members there unknown, never "missing".
pub enum DiscoveryGlob {
    Glob(globset::GlobMatcher),
    Under(String),
}

impl DiscoveryGlob {
    pub fn new(pattern: &str) -> Self {
        let over = pattern.len() > MAX_GLOB_LEN
            || pattern.matches('{').count() > MAX_GLOB_BRACES
            || pattern.matches('*').count() > MAX_GLOB_STARS;
        if !over
            && let Ok(g) = globset::GlobBuilder::new(pattern)
                .literal_separator(true)
                .build()
        {
            return Self::Glob(g.compile_matcher());
        }
        let prefix: Vec<&str> = pattern
            .split('/')
            .take_while(|seg| !seg.contains(['*', '?', '[', '{']))
            .collect();
        Self::Under(prefix.join("/"))
    }

    pub fn matches(&self, path: &str) -> bool {
        match self {
            Self::Glob(g) => g.is_match(path),
            Self::Under(p) => p.is_empty() || path.starts_with(&format!("{p}/")),
        }
    }
}

/// Whether `path` matches the discovery glob `pattern` (see [`DiscoveryGlob`]).
pub fn glob_match(pattern: &str, path: &str) -> bool {
    DiscoveryGlob::new(pattern).matches(path)
}

/// Django or Celery imports this Python module by convention when its app is installed.
fn framework_module(path: &str, celery_autodiscover: bool) -> bool {
    let mut parts = path.rsplit('/');
    let file = parts.next().unwrap_or_default();
    let parent = parts.next().unwrap_or_default();
    let grandparent = parts.next().unwrap_or_default();
    matches!(file, "admin.py" | "models.py")
        || parent == "models"
        || parent == "migrations"
        || parent == "templatetags"
        || (parent == "commands" && grandparent == "management")
        || (celery_autodiscover && file == "tasks.py")
}

impl<'a> WiringIndex<'a> {
    pub fn new(repo: &'a RepoFacts, kinds: &FileKinds) -> Self {
        let non_production = NonProduction::learn(repo);
        let production =
            |f: &FileFacts| !is_test_path(&f.path) && !non_production.contains(&f.path, &f.package);
        let mut regs = Vec::new();
        let mut discovers = BTreeSet::new();
        let mut celery_autodiscover = false;
        let mut django = false;
        let mut bases = BTreeSet::new();
        let mut roots = BTreeSet::new();
        let mut production_files = BTreeMap::new();
        // In-repo constants with a literal value (no call, no wrapper): spreading
        // one (`...ADVISORS_SHORTCUT_IDS`, an object of strings) adds no member and
        // hides none. A constant bound to a call result is not one.
        let mut literals: BTreeSet<String> = BTreeSet::new();
        for f in &repo.files {
            for s in &f.symbols {
                if matches!(s.kind, SymbolKind::Const | SymbolKind::Variable)
                    && s.calls.is_empty()
                    && s.wraps.is_empty()
                {
                    literals.insert(format!("{}#{}", f.path, s.name));
                    for e in &s.exported_as {
                        literals.insert(format!("{}#{e}", f.path));
                    }
                }
            }
            for s in &f.symbols {
                for w in &s.wraps {
                    if w.kind == drift_core::WrapKind::Extends && !w.wrapper.contains(':') {
                        let base = w.wrapper.split(['(', '<']).next().unwrap_or(&w.wrapper);
                        bases.insert(base.to_string());
                    }
                }
            }
            if f.lang == "py" && f.imports.iter().any(|i| i.module.starts_with("pkg:django")) {
                django = true;
            }
            // `NestFactory.create(AppModule)`: the module it is given is a root.
            if f.symbols.iter().any(|s| {
                s.calls
                    .iter()
                    .any(|c| c.starts_with("pkg:@nestjs/core#NestFactory."))
            }) {
                for i in &f.imports {
                    if !i.module.contains(':') {
                        roots.extend(i.names.iter().map(|n| format!("{}#{n}", i.module)));
                    }
                }
                roots.extend(f.symbols.iter().map(|s| format!("{}#{}", f.path, s.name)));
            }
            for d in &f.discovers {
                if d == "celery:autodiscover_tasks" {
                    celery_autodiscover = true;
                } else {
                    discovers.insert(d.clone());
                }
            }
            if !production(f) {
                continue;
            }
            production_files.insert(f.path.as_str(), f.package.as_str());
            for r in &f.registries {
                // `__all__` names exports by string; the export facts already say that.
                // A file route (`createFileRoute("/x")({ component })`) is found by
                // the router from its path: file-based routing, not a registry.
                if r.slot == "binding:__all__"
                    || FILE_ROUTE_FACTORIES.iter().any(|c| r.slot.starts_with(c))
                {
                    continue;
                }
                regs.push(Reg {
                    path: &f.path,
                    family: family_of(&f.path, &r.slot),
                    slot: r.slot.clone(),
                    line: r.line,
                    items: r.items.iter().map(|i| (i.target.clone(), i.line)).collect(),
                    derived: BTreeSet::new(),
                    spreads: r
                        .items
                        .iter()
                        .filter(|i| i.spread)
                        .map(|i| i.target.clone())
                        .collect(),
                    opaque: r.opaque,
                    live: true,
                    dead_owner: String::new(),
                    stars: BTreeSet::new(),
                    star_items: BTreeSet::new(),
                });
            }
            let mut items = BTreeMap::new();
            let mut reexports = false;
            let mut stars = BTreeSet::new();
            let mut named = BTreeSet::new();
            let mut starred = Vec::new();
            for e in &f.exports {
                if e.name == "*" {
                    if let Some(m) = e.origin.strip_suffix("#*") {
                        stars.insert(m.to_string());
                    }
                    continue;
                }
                reexports |= e.kind != ExportKind::Local;
                // What the barrel declares itself is exported by it too.
                items.entry(e.origin.clone()).or_insert(0);
                if e.kind == ExportKind::ReExportAll {
                    starred.push(e.origin.as_str());
                } else {
                    named.insert(e.origin.as_str());
                }
            }
            if reexports {
                let star_items = starred
                    .into_iter()
                    .filter(|t| !named.contains(t))
                    .map(str::to_string)
                    .collect();
                regs.push(Reg {
                    path: &f.path,
                    slot: EXPORTS_SLOT.to_string(),
                    family: EXPORTS_SLOT.to_string(),
                    // Export facts carry no lines: a barrel is named by its path.
                    line: 0,
                    items,
                    derived: BTreeSet::new(),
                    spreads: BTreeSet::new(),
                    opaque: false,
                    live: true,
                    dead_owner: String::new(),
                    stars,
                    star_items,
                });
            }
        }
        // A list that names a module-level list stands for its items, through any
        // number of levels (`providers: [...services]`, `extra = [...dispute]`,
        // `include(api_patterns)`). A spread of anything else (a function, a
        // package's list) makes the list opaque, and so does taking in an opaque one.
        let by_binding: BTreeMap<String, usize> = regs
            .iter()
            .enumerate()
            .filter_map(|(i, r)| {
                let name = r.slot.strip_prefix("binding:")?;
                Some((format!("{}#{name}", r.path), i))
            })
            .collect();
        for _ in 0..MAX_SPREAD_DEPTH {
            let mut changed = false;
            for i in 0..regs.len() {
                // A barrel re-exporting a list does not register the list's items.
                if regs[i].slot == EXPORTS_SLOT {
                    continue;
                }
                let own = regs[i]
                    .slot
                    .strip_prefix("binding:")
                    .map(|n| format!("{}#{n}", regs[i].path));
                let named: Vec<usize> = regs[i]
                    .items
                    .keys()
                    .filter(|t| Some(*t) != own.as_ref())
                    .filter_map(|t| by_binding.get(t).copied())
                    .collect();
                for j in named {
                    let (items, opaque, key) = (
                        regs[j].items.clone(),
                        regs[j].opaque,
                        format!("{}#{}", regs[j].path, &regs[j].slot["binding:".len()..]),
                    );
                    let r = &mut regs[i];
                    for (k, v) in items {
                        if let std::collections::btree_map::Entry::Vacant(e) = r.items.entry(k) {
                            e.insert(v);
                            changed = true;
                        }
                    }
                    if opaque && !r.opaque {
                        r.opaque = true;
                        changed = true;
                    }
                    r.derived.insert(key);
                }
            }
            if !changed {
                break;
            }
        }
        for r in &mut regs {
            let own = r
                .slot
                .strip_prefix("binding:")
                .map(|n| format!("{}#{n}", r.path));
            if r.spreads.iter().any(|t| {
                !by_binding.contains_key(t) && !literals.contains(t) && Some(t) != own.as_ref()
            }) {
                r.opaque = true;
            }
        }
        // Lists of `@Module`s that nothing imports and nothing bootstraps are dead.
        // Without a visible `NestFactory` bootstrap, an unimported module may be the
        // root, so every list stays live.
        if !roots.is_empty() {
            let named: BTreeSet<String> =
                regs.iter().flat_map(|r| r.items.keys().cloned()).collect();
            let by_path: BTreeMap<&str, &FileFacts> =
                repo.files.iter().map(|f| (f.path.as_str(), f)).collect();
            for r in &mut regs {
                let (Some(call), Some(f)) = (
                    call_prefix(&r.slot).strip_prefix("arg:"),
                    by_path.get(r.path),
                ) else {
                    continue;
                };
                let owners: Vec<&Symbol> = f
                    .symbols
                    .iter()
                    .filter(|s| {
                        s.wraps.iter().any(|w| {
                            w.kind == drift_core::WrapKind::Decorator
                                && w.wrapper.split('(').next() == Some("pkg:@nestjs/common#Module")
                        }) && s
                            .args
                            .iter()
                            .any(|a| a.strip_prefix(call).is_some_and(|x| x.starts_with(':')))
                    })
                    .collect();
                if owners.is_empty() {
                    continue;
                }
                r.live = owners.iter().any(|s| {
                    std::iter::once(&s.name)
                        .chain(&s.exported_as)
                        .map(|n| format!("{}#{n}", f.path))
                        .any(|k| named.contains(&k) || roots.contains(&k))
                });
                if !r.live {
                    r.dead_owner = owners[0].name.clone();
                }
            }
        }
        let mut outers = vec![Vec::new(); regs.len()];
        for (i, r) in regs.iter().enumerate() {
            for k in &r.derived {
                if let Some(&j) = by_binding.get(k) {
                    outers[j].push(i);
                }
            }
        }
        let reach = reachability(&regs);
        let lists = regs
            .iter()
            .filter_map(|r| Some(format!("{}#{}", r.path, r.slot.strip_prefix("binding:")?)))
            .collect();
        Self {
            regs,
            kinds: kinds.clone(),
            discovers: discovers.iter().map(|g| DiscoveryGlob::new(g)).collect(),
            celery_autodiscover,
            django,
            bases,
            lists,
            reach,
            outers,
            roots,
            production: production_files,
        }
    }

    /// Why `s` in `f` is wired without being listed, if it is.
    fn discovery(&self, f: &FileFacts, s: &Symbol) -> Option<Discovery> {
        if f.entry_points
            .iter()
            .any(|e| e.adapter == "nextjs" && s.exported_as.contains(&e.symbol))
        {
            return Some(Discovery::FileRouting);
        }
        if self.discovers.iter().any(|g| g.matches(&f.path)) {
            return Some(Discovery::GlobImport);
        }
        let auto_decorator = s.wraps.iter().any(|w| {
            w.kind == drift_core::WrapKind::Decorator
                && AUTO_REGISTERING_DECORATORS.contains(&w.wrapper.split('(').next().unwrap_or(""))
        });
        let provided_in = s
            .args
            .iter()
            .any(|a| a.starts_with("pkg:@angular/core#Injectable@0:providedIn"));
        if auto_decorator || provided_in {
            return Some(Discovery::DiAutoRegistration);
        }
        let celery_task = f
            .entry_points
            .iter()
            .any(|e| e.adapter == "celery" && s.exported_as.contains(&e.symbol));
        if f.lang == "py"
            && ((self.django && framework_module(&f.path, self.celery_autodiscover))
                || (celery_task && self.celery_autodiscover))
        {
            return Some(Discovery::FrameworkAutodiscovery);
        }
        None
    }

    fn member(&self, f: &'a FileFacts, s: &'a Symbol) -> Option<Member<'a>> {
        let roles = wiring_roles(f, s, &self.kinds);
        let key = format!("{}#{}", f.path, s.name);
        if roles.is_empty()
            || self.lists.contains(&key)
            || (s.kind == SymbolKind::Class && self.bases.contains(&key))
        {
            return None;
        }
        let mut keys = vec![format!("{}#{}", f.path, s.name)];
        keys.extend(s.exported_as.iter().map(|e| format!("{}#{e}", f.path)));
        keys.sort();
        keys.dedup();
        let nest_module = s.wraps.iter().any(|w| {
            w.kind == drift_core::WrapKind::Decorator
                && w.wrapper.split('(').next() == Some("pkg:@nestjs/common#Module")
        });
        if nest_module && keys.iter().any(|k| self.roots.contains(k)) {
            return None;
        }
        Some(Member {
            file: f,
            symbol: s,
            keys,
            roles,
            discovered: self.discovery(f, s),
        })
    }

    /// The module-level list `path#name`, if it is one.
    fn binding_reg(&self, key: &str) -> Option<&Reg<'a>> {
        let (path, name) = key.rsplit_once('#')?;
        self.regs
            .iter()
            .find(|r| r.path == path && r.slot.strip_prefix("binding:") == Some(name))
    }

    /// The lists a rule checks against: one list, or every list of a family.
    fn lists_for(&self, slot: &str, path: &str) -> Vec<usize> {
        (0..self.regs.len())
            .filter(|&i| {
                let r = &self.regs[i];
                if path.is_empty() {
                    r.family == slot && r.live
                } else {
                    r.path == path && r.slot == slot
                }
            })
            .collect()
    }

    /// The lists that decide whether a rule registers a member: a family's lists,
    /// or one list and every list reachable from it.
    fn pool(&self, slot: &str, path: &str) -> Vec<usize> {
        let lists = self.lists_for(slot, path);
        if path.is_empty() {
            return lists;
        }
        let pool: BTreeSet<usize> = lists
            .iter()
            .flat_map(|&i| self.reach[i].iter().chain(&self.outers[i]).copied())
            .collect();
        pool.into_iter().collect()
    }

    /// Where `m` should be registered under a rule, when it is not: the list (the
    /// nearest of the rule's family among the lists that decide) and a sibling
    /// already in it. `None` when it is registered, discovered, unknown (a list that
    /// decides is opaque), or the registry is not in these facts (a single-file
    /// check sees only the edited file).
    fn missing(
        &self,
        (role, slot, path, named): (&RoleSelector, &str, &str, &str),
        m: &Member,
    ) -> Option<WireHint> {
        if m.discovered.is_some() || !name_matches(named, &m.symbol.name) {
            return None;
        }
        let pool = self.pool(slot, path);
        if pool.is_empty()
            || pool.iter().any(|&i| self.regs[i].opaque)
            || pool.iter().any(|&i| self.regs[i].names(m).is_some())
        {
            return None;
        }
        let family = if path.is_empty() {
            slot.to_string()
        } else {
            family_of(path, slot)
        };
        if self.unregistrable(m, slot, path, &family) {
            return None;
        }
        let lists: Vec<&Reg> = pool
            .iter()
            .map(|&i| &self.regs[i])
            .filter(|r| r.family == family)
            .collect();
        // Nearest list: the longest shared directory prefix, then by path.
        let shared = |p: &str| {
            p.split('/')
                .zip(m.file.path.split('/'))
                .take_while(|(a, b)| a == b)
                .count()
        };
        let reg = nearest(lists.iter().copied(), &shared)?;
        // A list built from other lists (`controllers: [...controllers]`): the new
        // member goes in one of those, the nearest.
        let reg = nearest(
            reg.derived
                .iter()
                .filter_map(|k| self.binding_reg(k))
                .filter(|r| !r.opaque),
            &shared,
        )
        .unwrap_or(reg);
        // A sibling in that list: a member of the same role, nearest by path.
        let like_item = reg
            .items
            .iter()
            .filter_map(|(t, line)| {
                let (p, name) = t.rsplit_once('#')?;
                (name != "*").then_some((p, name, *line, t))
            })
            .filter(|(p, _, _, _)| {
                // Same role: same directory prefix and file kind as the role says.
                self.kinds.kind_of(p) == role.file || role.file == "*"
            })
            .max_by(|a, b| {
                shared(a.0)
                    .cmp(&shared(b.0))
                    .then_with(|| (b.0, b.1, b.2).cmp(&(a.0, a.1, a.2)))
            });
        // A barrel of `export * from "./x"` lines: the fix is another such line.
        let star = reg.slot == EXPORTS_SLOT
            && match like_item {
                Some((_, _, _, t)) => reg.star_items.contains(t),
                None => !reg.stars.is_empty(),
            };
        let like = like_item.map(|(p, name, line, _)| WireLike {
            name: name.to_string(),
            line,
            path: p.to_string(),
        });
        // Provided only by a `@Module` that nothing imports: the fix is to import
        // that module from one the app reaches, not to provide it a second time.
        if let Some(dead) = self.regs.iter().find(|r| {
            r.family == family && !r.live && !r.dead_owner.is_empty() && r.names(m).is_some()
        }) {
            return Some(WireHint {
                action: IMPORT_MODULE.into(),
                path: reg.path.to_string(),
                line: reg.line,
                label: "a module the app imports".into(),
                like: Some(WireLike {
                    name: dead.dead_owner.clone(),
                    line: dead.line,
                    path: dead.path.to_string(),
                }),
                entry: None,
            });
        }
        Some(WireHint {
            action: if star { REEXPORT_MODULE } else { "register" }.into(),
            path: reg.path.to_string(),
            line: reg.line,
            label: slot_label(&reg.slot),
            like,
            entry: None,
        })
    }
}

impl WiringIndex<'_> {
    /// Whether `m` is not a member a rule can find missing, though no list of the
    /// rule's pool names it: it owns the rule's list (or, for a family, it owns a
    /// list of the family and none names it: the root of the graph), or a list of
    /// the same kind elsewhere names it (a sibling `@Module` that neither imports
    /// the other provides it: provided by the app, so not missing).
    fn unregistrable(&self, m: &Member, slot: &str, path: &str, family: &str) -> bool {
        if path.is_empty() {
            let lists = self.lists_for(slot, path);
            return lists.iter().any(|&i| self.regs[i].owned_by(m))
                && !lists.iter().any(|&i| self.regs[i].names(m).is_some());
        }
        if self
            .lists_for(slot, path)
            .iter()
            .any(|&i| self.regs[i].owned_by(m))
        {
            return true;
        }
        // Barrels count one by one: another barrel re-exporting it is not this one.
        slot != EXPORTS_SLOT
            && self
                .regs
                .iter()
                .any(|r| r.family == family && r.live && r.names(m).is_some())
    }
}

/// [`WireHint::action`] for a member provided only by a `@Module` nothing imports:
/// import that module (`like`) from one the app reaches (`path`).
pub const IMPORT_MODULE: &str = "import_module";

/// [`WireHint::action`] for a barrel of star re-exports: add `export * from "./x"`
/// (`from .x import *`), not a name.
pub const REEXPORT_MODULE: &str = "reexport_module";

/// The list nearest a member: the longest shared directory prefix (`shared`), then
/// by path and line.
fn nearest<'r>(
    regs: impl Iterator<Item = &'r Reg<'r>>,
    shared: &dyn Fn(&str) -> usize,
) -> Option<&'r Reg<'r>> {
    regs.max_by(|a, b| {
        shared(a.path)
            .cmp(&shared(b.path))
            .then_with(|| b.path.cmp(a.path))
            .then_with(|| b.line.cmp(&a.line))
    })
}

/// Most lists one list reaches ([`reachability`]).
const MAX_REACH: usize = 4096;
/// Levels of `[...a]` inside `a = [...b]` followed.
const MAX_SPREAD_DEPTH: usize = 6;

/// `arg:<callee>@<index>:<key>` -> `arg:<callee>@<index>`: lists of one call (a
/// `@Module`'s `providers` and `imports`). Other slots are their own prefix.
fn call_prefix(slot: &str) -> &str {
    if slot.starts_with("arg:")
        && let Some(at) = slot.rfind('@')
        && let Some(colon) = slot[at..].find(':')
    {
        return &slot[..at + colon];
    }
    slot
}

/// For each list, the lists a member may be registered in through it, itself
/// first. From a list Drift follows:
///
/// - the other lists of the same call in the same file (`AppModule`'s `imports`
///   next to its `providers`);
/// - in each file a reached list names (an imported module, an `include()`d
///   urlconf), that file's lists of the same call or slot;
/// - lists of calls on a receiver a reached list names (`app.use(adminRouter)`,
///   then `adminRouter.use(refundsRouter)`).
///
/// Barrels follow nothing: a barrel is where its role re-exports.
fn reachability(regs: &[Reg]) -> Vec<Vec<usize>> {
    let mut by_file: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut by_slot: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, r) in regs.iter().enumerate() {
        by_file.entry(r.path).or_default().push(i);
        by_slot.entry(r.slot.as_str()).or_default().push(i);
    }
    (0..regs.len())
        .map(|start| {
            let mut out = vec![start];
            if regs[start].slot == EXPORTS_SLOT {
                return out;
            }
            let prefix = call_prefix(&regs[start].slot);
            let mut seen: BTreeSet<usize> = [start].into();
            let mut queue = vec![start];
            let mut visit = |j: usize, queue: &mut Vec<usize>, out: &mut Vec<usize>| {
                if out.len() < MAX_REACH && seen.insert(j) {
                    out.push(j);
                    queue.push(j);
                }
            };
            for &j in by_file.get(regs[start].path).into_iter().flatten() {
                if call_prefix(&regs[j].slot) == prefix {
                    visit(j, &mut queue, &mut out);
                }
            }
            while let Some(r) = queue.pop() {
                for t in regs[r].items.keys() {
                    let file = t.split_once('#').map_or(t.as_str(), |(f, _)| f);
                    for &j in by_file.get(file).into_iter().flatten() {
                        if call_prefix(&regs[j].slot) == prefix {
                            visit(j, &mut queue, &mut out);
                        }
                    }
                    for &j in by_slot
                        .get(format!("calls:{t}").as_str())
                        .into_iter()
                        .flatten()
                    {
                        visit(j, &mut queue, &mut out);
                    }
                }
            }
            out
        })
        .collect()
}

/// A member a wiring rule finds unregistered.
pub struct Missing<'a> {
    /// Index of the rule in the slice given to [`missing_registrations`].
    pub rule: usize,
    pub file: &'a FileFacts,
    pub symbol: &'a Symbol,
    pub hint: WireHint,
}

/// Members that `rules` (`(role, slot, path, named)` of `registered_in` conventions) find
/// unregistered, for the files in `only_paths` (all when `None`).
pub fn missing_registrations<'a>(
    repo: &'a RepoFacts,
    kinds: &FileKinds,
    rules: &[(&RoleSelector, &str, &str, &str)],
    only_paths: Option<&BTreeSet<String>>,
) -> Vec<Missing<'a>> {
    let mut out = Vec::new();
    if rules.is_empty() {
        return out;
    }
    let index = WiringIndex::new(repo, kinds);
    for u in units(repo, kinds) {
        let View::Symbol(f, s) = u.view else { continue };
        if only_paths.is_some_and(|p| !p.contains(&f.path)) {
            continue;
        }
        let Some(m) = index.member(f, s) else {
            continue;
        };
        for (i, rule) in rules.iter().enumerate() {
            if !m.roles.contains(rule.0) {
                continue;
            }
            if let Some(hint) = index.missing(*rule, &m) {
                out.push(Missing {
                    rule: i,
                    file: f,
                    symbol: s,
                    hint,
                });
            }
        }
    }
    out
}

/// A candidate registry for a role, during mining.
struct Fit<'r> {
    role: RoleSelector,
    /// Members the rule holds (indexes into all members), after any name filter.
    live: Vec<usize>,
    /// Those of them the registry names.
    covered: BTreeSet<usize>,
    /// Name pattern the rule is narrowed to (`*_JOB_DEFINITION`), or empty.
    named: String,
    /// One list, or every list of a family.
    lists: Vec<&'r Reg<'r>>,
    slot: String,
    path: String,
    /// Some members are registered only in lists reachable from the rule's list.
    reach: bool,
}

/// Name patterns for narrowing a role: [`name_patterns`] (`*Service`, `use*`), plus
/// the last and first word of an UPPER_SNAKE name (`*_JOB_DEFINITION` is
/// `*_DEFINITION`, `SEND_*`).
pub fn name_keys(name: &str) -> Vec<String> {
    let mut out = name_patterns(name);
    if name.contains('_')
        && name
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && let (Some((first, _)), Some((_, last))) = (name.split_once('_'), name.rsplit_once('_'))
        && !first.is_empty()
        && !last.is_empty()
    {
        out.push(format!("*_{last}"));
        out.push(format!("{first}_*"));
    }
    out
}

/// Whether `name` matches a [`name_keys`] pattern.
pub fn name_matches(pattern: &str, name: &str) -> bool {
    pattern.is_empty() || name_keys(name).iter().any(|p| p == pattern)
}

/// A proposed fit, narrowed by name when the registered members share a name
/// pattern that the unregistered ones lack (job definitions in `jobs/**` next to
/// the schemas they validate): `None` if narrowing leaves too few members.
fn fit_for<'r>(
    members: &[Member],
    role: &RoleSelector,
    pop: &[usize],
    covered: &BTreeSet<usize>,
    lists: Vec<&'r Reg<'r>>,
    slot: String,
    path: String,
) -> Fit<'r> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for &m in covered {
        for k in name_keys(&members[m].symbol.name) {
            *counts.entry(k).or_default() += 1;
        }
    }
    // The pattern most registered members share, if nearly all do.
    let best = counts
        .iter()
        .filter(|(_, n)| **n as f64 >= MIN_COVERAGE * covered.len() as f64)
        .max_by(|a, b| {
            a.1.cmp(b.1)
                .then_with(|| a.0.len().cmp(&b.0.len()))
                .then_with(|| b.0.cmp(a.0))
        })
        .map(|(k, _)| k.clone());
    let uncovered_off_pattern = best.as_ref().is_some_and(|p| {
        pop.iter()
            .filter(|m| !covered.contains(m))
            .any(|&m| !name_matches(p, &members[m].symbol.name))
    });
    let (live, named) = match best {
        Some(p) if uncovered_off_pattern => {
            let live: Vec<usize> = pop
                .iter()
                .copied()
                .filter(|&m| name_matches(&p, &members[m].symbol.name))
                .collect();
            if live.len() >= MIN_MEMBERS {
                (live, p)
            } else {
                (pop.to_vec(), String::new())
            }
        }
        _ => (pop.to_vec(), String::new()),
    };
    let covered = covered
        .iter()
        .copied()
        .filter(|m| live.contains(m))
        .collect();
    Fit {
        role: role.clone(),
        live,
        covered,
        named,
        lists,
        slot,
        path,
        reach: false,
    }
}

/// Whether a barrel fit is a curated public subset, whose outliers are internal
/// on purpose (helpers its siblings share, a component kept out to avoid a name
/// clash): more than half of its outliers are internal, each imported directly,
/// not through the barrel, by another production file of its own package, with
/// nothing else in its file re-exported. One internal helper next to forgotten
/// exports does not make a barrel curated. Not for a role of one kind (`*.dto` files, a `*Template` name
/// pattern, TypedDicts): a member of the kind left out is an omission (a nested
/// DTO), not a helper. An outlier in a file the barrel re-exports from is not
/// internal either (a new schema next to exported ones).
fn curated(
    fit: &Fit,
    members: &[Member],
    barrel: &str,
    importers: &BTreeMap<String, BTreeSet<&str>>,
    production: &BTreeMap<&str, &str>,
) -> bool {
    if fit.role.file != "*" || fit.role.variety.is_some() || !fit.named.is_empty() {
        return false;
    }
    let outliers: Vec<usize> = fit
        .live
        .iter()
        .copied()
        .filter(|m| !fit.covered.contains(m))
        .collect();
    let internal = outliers
        .iter()
        .filter(|&&m| {
            let m = &members[m];
            let public_file = fit
                .covered
                .iter()
                .any(|&c| members[c].file.path == m.file.path);
            !public_file
                && m.keys
                    .iter()
                    .cloned()
                    .chain([format!("{}#*", m.file.path)])
                    .filter_map(|k| importers.get(&k))
                    .flatten()
                    .any(|&f| {
                        f != barrel
                            && f != m.file.path
                            && production.get(f).copied() == Some(m.file.package.as_str())
                    })
        })
        .count();
    internal * 2 > outliers.len()
}

/// The list of `lists` that names the most of `covered`, then the first by path
/// and line: where a fix goes, and the example a rule shows.
fn fullest<'r>(
    lists: impl Iterator<Item = &'r Reg<'r>>,
    covered: &BTreeSet<usize>,
    members: &[Member],
) -> &'r Reg<'r> {
    lists
        .max_by_key(|r| {
            (
                covered
                    .iter()
                    .filter(|&&m| r.names(&members[m]).is_some())
                    .count(),
                std::cmp::Reverse((r.path, r.line)),
            )
        })
        .expect("a registry has a list")
}

/// Mine wiring rules: registries covering nearly every member of a role.
pub fn mine(repo: &RepoFacts, kinds: &FileKinds) -> WiringMined {
    let index = WiringIndex::new(repo, kinds);
    let all_units = units(repo, kinds);
    let members: Vec<Member> = all_units
        .iter()
        .filter_map(|u| match u.view {
            View::Symbol(f, s) => index.member(f, s),
            _ => None,
        })
        .collect();
    // Role -> member indexes (discovered ones included, to judge the role).
    let mut roles: BTreeMap<&RoleSelector, Vec<usize>> = BTreeMap::new();
    for (i, m) in members.iter().enumerate() {
        for r in &m.roles {
            roles.entry(r).or_default().push(i);
        }
    }
    // Which lists name each member.
    let names: Vec<Vec<usize>> = members
        .iter()
        .map(|m| {
            index
                .regs
                .iter()
                .enumerate()
                .filter(|(_, r)| r.names(m).is_some())
                .map(|(i, _)| i)
                .collect()
        })
        .collect();
    let families: BTreeMap<&str, Vec<usize>> =
        index.regs.iter().enumerate().filter(|(_, r)| r.live).fold(
            BTreeMap::new(),
            |mut acc, (i, r)| {
                acc.entry(r.family.as_str()).or_default().push(i);
                acc
            },
        );
    // The lists of one slot in one file are one registry (two `@Module`s in a file,
    // a router nested in a router), as `check` reads them: one rule, one id.
    let groups: BTreeMap<(&str, &str), Vec<usize>> =
        index
            .regs
            .iter()
            .enumerate()
            .fold(BTreeMap::new(), |mut acc, (i, r)| {
                acc.entry((r.path, r.slot.as_str())).or_default().push(i);
                acc
            });
    // Members that own each list (`AppModule` for its `@Module`'s lists).
    let mut owners: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); index.regs.len()];
    {
        let mut by_file: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        for (i, r) in index.regs.iter().enumerate() {
            by_file.entry(r.path).or_default().push(i);
        }
        for (mi, m) in members.iter().enumerate() {
            for &r in by_file.get(m.file.path.as_str()).into_iter().flatten() {
                if index.regs[r].owned_by(m) {
                    owners[r].insert(mi);
                }
            }
        }
    }
    // Production files importing each `path#name` directly (and `path#*`).
    let mut importers: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
    for f in &repo.files {
        if !index.production.contains_key(f.path.as_str()) {
            continue;
        }
        for i in &f.imports {
            if i.module.contains(':') {
                continue;
            }
            for n in i.names.iter().map(String::as_str).chain(["*"]) {
                importers
                    .entry(format!("{}#{n}", i.module))
                    .or_default()
                    .insert(f.path.as_str());
            }
        }
    }

    let mut reports: Vec<RegistryReport> = Vec::new();
    let mut fits: Vec<Fit> = Vec::new();
    for (role, idx) in &roles {
        let discovered: Vec<usize> = idx
            .iter()
            .copied()
            .filter(|&i| members[i].discovered.is_some())
            .collect();
        let live: Vec<usize> = idx
            .iter()
            .copied()
            .filter(|&i| members[i].discovered.is_none())
            .collect();
        let autodiscovered =
            !idx.is_empty() && discovered.len() as f64 >= DISCOVERED_SHARE * idx.len() as f64;
        let why = discovered
            .first()
            .and_then(|&i| members[i].discovered)
            .map_or("", Discovery::as_str);
        // A role wired by discovery is judged on all its members, to report why no
        // rule is proposed; any other on the members that need registering.
        let pop: &[usize] = if autodiscovered { idx } else { &live };
        // Members each list names, directly.
        let mut per_reg: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
        let mut per_family: BTreeMap<&str, BTreeSet<usize>> = BTreeMap::new();
        for &i in pop {
            for &r in &names[i] {
                per_reg.entry(r).or_default().insert(i);
                if index.regs[r].live {
                    per_family
                        .entry(index.regs[r].family.as_str())
                        .or_default()
                        .insert(i);
                }
            }
        }
        let direct = per_reg.clone();
        // A list also registers what reachable lists of its own kind name (a service
        // in the providers of a feature module that `AppModule` imports); lists of
        // other kinds (`imports`) only lead there.
        for (&r, covered) in per_reg.iter_mut() {
            let family = &index.regs[r].family;
            let reach: BTreeSet<usize> = index.reach[r]
                .iter()
                .copied()
                .filter(|&j| &index.regs[j].family == family)
                .collect();
            if reach.len() < 2 {
                continue;
            }
            for &i in pop {
                if !covered.contains(&i) && names[i].iter().any(|x| reach.contains(x)) {
                    covered.insert(i);
                }
            }
        }
        // `None`: too small a role to judge. The members a registry covers must come
        // from [`MIN_FILES`] files: one module's names next to each other are not a
        // registry convention. A barrel's star re-export (`from .base import *`)
        // re-exports one module: what it covers is evidence only for a role inside
        // the barrel's own directory, never for a wider one (with pontoon's
        // `settings/__init__.py`, every constant of the package "belonged" there).
        let status_of = |pop: &[usize], covered: &BTreeSet<usize>, barrel: Option<&Reg>| {
            let n = pop.len();
            let files = |set: &mut dyn Iterator<Item = &usize>| {
                set.map(|&i| members[i].file.path.as_str())
                    .collect::<BTreeSet<_>>()
                    .len()
            };
            if autodiscovered {
                return Some(format!("autodiscovered:{why}"));
            }
            if n < MIN_MEMBERS || files(&mut pop.iter()) < MIN_FILES {
                return None;
            }
            let held: BTreeSet<usize> = match barrel {
                Some(reg) => covered
                    .iter()
                    .copied()
                    .filter(|&i| {
                        !reg.star_only(&members[i])
                            || pop
                                .iter()
                                .all(|&j| under(&members[j].file.path, dir_of(reg.path)))
                    })
                    .collect(),
                None => covered.clone(),
            };
            let total = n - (covered.len() - held.len());
            Some(
                if total < MIN_MEMBERS
                    || (held.len() as f64) < MIN_COVERAGE * total as f64
                    || files(&mut held.iter()) < MIN_FILES
                {
                    "below_threshold".into()
                } else {
                    "proposed".into()
                },
            )
        };
        // Single registries (one file's lists of one slot).
        let mut best_single: BTreeMap<&str, usize> = BTreeMap::new();
        let mut single_fit = false;
        for (&(path, slot), lists) in &groups {
            let mut covered: BTreeSet<usize> = lists
                .iter()
                .filter_map(|r| per_reg.get(r))
                .flatten()
                .copied()
                .collect();
            if covered.is_empty() {
                continue;
            }
            let family = index.regs[lists[0]].family.as_str();
            let barrel = slot == EXPORTS_SLOT;
            // Not this registry's members: the classes or bindings that own its lists.
            let skip: BTreeSet<usize> = pop
                .iter()
                .copied()
                .filter(|i| lists.iter().any(|&r| owners[r].contains(i)))
                .collect();
            let pop_g: Vec<usize> = pop.iter().copied().filter(|i| !skip.contains(i)).collect();
            covered.retain(|i| !skip.contains(i));
            let n = pop_g.len();
            if covered.len() * 2 < n.max(1) || n < MIN_MEMBERS {
                continue;
            }
            let best = best_single.entry(family).or_default();
            *best = (*best).max(covered.len());
            let Some(mut status) =
                status_of(&pop_g, &covered, barrel.then(|| &index.regs[lists[0]]))
            else {
                continue;
            };
            // A list holding what Drift cannot read can never say "missing".
            if !status.starts_with("autodiscovered")
                && lists
                    .iter()
                    .any(|&r| index.reach[r].iter().any(|&j| index.regs[j].opaque))
            {
                status = "opaque".into();
            }
            // Members registered in another list of the same kind, which this one
            // does not reach (a sibling `@Module`): the role is split between lists,
            // so the family stands in, never this list alone.
            if status == "proposed"
                && !barrel
                && pop_g.iter().any(|&i| {
                    !covered.contains(&i)
                        && names[i]
                            .iter()
                            .any(|&r| index.regs[r].family == family && index.regs[r].live)
                })
            {
                status = "split".into();
            }
            if status == "proposed" {
                // A list spread into another (`providers: [...USE_CASES, X]`): a
                // member listed there directly is provided too, not an outlier. It
                // is not evidence for this list, so it counts only once the list
                // passes on its own.
                let outer: BTreeSet<usize> = lists
                    .iter()
                    .flat_map(|&r| index.outers[r].iter().copied())
                    .collect();
                if !outer.is_empty() {
                    covered.extend(
                        pop_g
                            .iter()
                            .copied()
                            .filter(|&i| names[i].iter().any(|r| outer.contains(r))),
                    );
                }
                let mut fit = fit_for(
                    &members,
                    role,
                    &pop_g,
                    &covered,
                    lists.iter().map(|&r| &index.regs[r]).collect(),
                    slot.to_string(),
                    path.to_string(),
                );
                let direct_n = lists
                    .iter()
                    .filter_map(|r| direct.get(r))
                    .flatten()
                    .filter(|i| fit.covered.contains(i))
                    .collect::<BTreeSet<_>>()
                    .len();
                fit.reach = fit.covered.len() > direct_n;
                // A barrel that leaves out what its own package imports directly is a
                // curated public subset: the rest are internal on purpose.
                if barrel && curated(&fit, &members, path, &importers, &index.production) {
                    status = "curated".into();
                } else {
                    single_fit = true;
                    fits.push(fit);
                }
            }
            let reg = fullest(lists.iter().map(|&r| &index.regs[r]), &covered, &members);
            reports.push(RegistryReport {
                path: path.to_string(),
                line: reg.line,
                slot: slot.to_string(),
                label: slot_label(slot),
                lists: 1,
                role: (*role).clone(),
                role_summary: role.describe(),
                members: n,
                covered: covered.len(),
                status,
            });
        }
        for (family, covered) in &per_family {
            let lists = &families[family];
            // "Re-exported by some barrel" says nothing about where: barrels count
            // one by one.
            if *family == EXPORTS_SLOT || lists.len() < 2 {
                continue;
            }
            // The roots of the family's graph own a list of it and no list names
            // them (`AppModule`, `appRouter`): not members.
            let roots: BTreeSet<usize> = lists
                .iter()
                .flat_map(|&r| owners[r].iter().copied())
                .filter(|i| !covered.contains(i))
                .collect();
            let pop_f: Vec<usize> = pop.iter().copied().filter(|i| !roots.contains(i)).collect();
            let n = pop_f.len();
            if covered.len() * 2 < n.max(1) || n < MIN_MEMBERS {
                continue;
            }
            // A family only stands in when no single list of it does the job.
            if best_single.get(family).copied().unwrap_or(0) >= covered.len() {
                continue;
            }
            let Some(mut status) = status_of(&pop_f, covered, None) else {
                continue;
            };
            if !status.starts_with("autodiscovered") && lists.iter().any(|&j| index.regs[j].opaque)
            {
                status = "opaque".into();
            }
            if status == "proposed" && single_fit {
                status = "subsumed".into();
            }
            if status == "proposed" {
                fits.push(fit_for(
                    &members,
                    role,
                    &pop_f,
                    covered,
                    lists.iter().map(|&r| &index.regs[r]).collect(),
                    family.to_string(),
                    String::new(),
                ));
            }
            reports.push(RegistryReport {
                path: String::new(),
                line: 0,
                slot: family.to_string(),
                label: slot_label(family),
                lists: lists.len(),
                role: (*role).clone(),
                role_summary: role.describe(),
                members: n,
                covered: covered.len(),
                status,
            });
        }
    }

    // Keep the most useful role per registry. Of two nested roles that both pass
    // with the same registry, the broader one is kept only when the members it adds
    // are covered too (the registry really reaches that far: every `*.service` in
    // `src/**`, not only `src/users/**`); otherwise the narrower one is (an inner
    // barrel is not where a sibling folder registers). Equal member sets keep the
    // more specific description.
    let sets: Vec<BTreeSet<usize>> = fits
        .iter()
        .map(|f| f.live.iter().copied().collect())
        .collect();
    let covered_sets: Vec<BTreeSet<usize>> = fits.iter().map(|f| f.covered.clone()).collect();
    let more_specific = |a: &RoleSelector, b: &RoleSelector| -> bool {
        // `*.service` over `*`; deeper over shallower; then selector order.
        let fa = a.file != "*";
        let fb = b.file != "*";
        (fa, a.dir.matches('/').count(), std::cmp::Reverse(a))
            > (fb, b.dir.matches('/').count(), std::cmp::Reverse(b))
    };
    let mut dropped = vec![false; fits.len()];
    for i in 0..fits.len() {
        for j in 0..fits.len() {
            if i == j || fits[i].slot != fits[j].slot || fits[i].path != fits[j].path {
                continue;
            }
            if !sets[i].is_subset(&sets[j]) {
                continue;
            }
            if sets[i] == sets[j] {
                if more_specific(&fits[j].role, &fits[i].role) {
                    dropped[i] = true;
                }
                continue;
            }
            let extra: Vec<usize> = sets[j].difference(&sets[i]).copied().collect();
            let extra_covered = extra.iter().filter(|m| covered_sets[j].contains(m)).count();
            if extra_covered as f64 >= MIN_COVERAGE * extra.len() as f64 {
                dropped[i] = true;
            } else {
                dropped[j] = true;
            }
        }
    }
    // Barrels: one per role, in the role's own package (a barrel re-exporting
    // another package's code is an API choice), the fullest, then the nearest.
    let package_of = |p: &str, role: &RoleSelector| {
        role.package.is_empty() || p.starts_with(&format!("{}/", role.package))
    };
    for i in 0..fits.len() {
        if dropped[i] || fits[i].slot != EXPORTS_SLOT || fits[i].path.is_empty() {
            continue;
        }
        if !package_of(&fits[i].path, &fits[i].role) {
            dropped[i] = true;
            continue;
        }
        let rank = |k: usize| {
            (
                covered_sets[k].len(),
                fits[k].path.matches('/').count(),
                std::cmp::Reverse(fits[k].path.clone()),
            )
        };
        if fits.iter().enumerate().any(|(j, f)| {
            j != i
                && !dropped[j]
                && f.role == fits[i].role
                && f.slot == EXPORTS_SLOT
                && !f.path.is_empty()
                && package_of(&f.path, &f.role)
                && rank(j) > rank(i)
        }) {
            dropped[i] = true;
        }
    }

    // A list built from another list (`common = [...services]`) follows it: the
    // inner list is where to register, and doing so satisfies both.
    for i in 0..fits.len() {
        if dropped[i] || fits[i].path.is_empty() {
            continue;
        }
        let outer = &fits[i].lists;
        if fits.iter().enumerate().any(|(j, f)| {
            j != i
                && !dropped[j]
                && f.role == fits[i].role
                && !f.path.is_empty()
                && f.slot.strip_prefix("binding:").is_some_and(|n| {
                    let key = format!("{}#{n}", f.path);
                    outer.iter().any(|o| o.derived.contains(&key))
                })
        }) {
            dropped[i] = true;
        }
    }

    let mut kept: Vec<(usize, f64)> = fits
        .iter()
        .enumerate()
        .filter(|(i, _)| !dropped[*i])
        .map(|(i, f)| {
            let lb = wilson_lower_bound(f.covered.len(), f.live.len());
            (i, lb * (1.0 + f.live.len() as f64).log2())
        })
        .collect();
    kept.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| fits[a.0].role.cmp(&fits[b.0].role))
            .then_with(|| fits[a.0].slot.cmp(&fits[b.0].slot))
            .then_with(|| fits[a.0].path.cmp(&fits[b.0].path))
    });
    let mut per_role: BTreeMap<&RoleSelector, usize> = BTreeMap::new();
    let mut chosen = Vec::new();
    for (i, score) in kept {
        let c = per_role.entry(&fits[i].role).or_default();
        if *c >= MAX_PER_ROLE || chosen.len() >= MAX_WIRING_RULES {
            continue;
        }
        *c += 1;
        chosen.push((i, score));
    }
    // Two rules on nested lists for nested roles name one omission twice: a list
    // and the list spread into it (`controllers: [...controllers]`), an
    // `include([...])` inside `urlpatterns`, a module and the module it imports, a
    // family and one of its lists. Of the proposed rules, only the more
    // specific stays: the narrower role on the inner list.
    let list_ids = |f: &Fit| index.lists_for(&f.slot, &f.path);
    let pool_of =
        |f: &Fit| -> BTreeSet<usize> { index.pool(&f.slot, &f.path).into_iter().collect() };
    let inside = |j: usize, i: usize| -> bool {
        let (fi, fj) = (&fits[i], &fits[j]);
        let outer = list_ids(fi);
        let pool = pool_of(fi);
        let inner = list_ids(fj);
        !inner.is_empty()
            && inner.iter().all(|&l| {
                let r = &index.regs[l];
                pool.contains(&l)
                    || outer.iter().any(|&o| {
                        let o = &index.regs[o];
                        r.slot
                            .strip_prefix("binding:")
                            .is_some_and(|n| o.derived.contains(&format!("{}#{n}", r.path)))
                            || (o.path == r.path
                                && o.slot != r.slot
                                && !r.items.is_empty()
                                && r.items.keys().all(|k| o.items.contains_key(k)))
                    })
            })
    };
    let picked: Vec<usize> = chosen.iter().map(|&(i, _)| i).collect();
    let outers: BTreeSet<usize> = picked
        .iter()
        .copied()
        .filter(|&i| {
            fits[i].slot != EXPORTS_SLOT
                && picked.iter().any(|&j| {
                    j != i
                        && fits[j].slot != EXPORTS_SLOT
                        // One registry with nested roles is decided above, and a
                        // family is never the more specific list.
                        && !fits[j].path.is_empty()
                        && (fits[j].slot != fits[i].slot || fits[j].path != fits[i].path)
                        && sets[j].is_subset(&sets[i])
                        && inside(j, i)
                        && (sets[j] != sets[i] || !inside(i, j) || j < i)
                })
        })
        .collect();
    chosen.retain(|(i, _)| !outers.contains(i));

    let chosen_keys: BTreeSet<(RoleSelector, String, String)> = chosen
        .iter()
        .map(|&(i, _)| {
            (
                fits[i].role.clone(),
                fits[i].slot.clone(),
                fits[i].path.clone(),
            )
        })
        .collect();
    for r in &mut reports {
        if r.status == "proposed"
            && !chosen_keys.contains(&(r.role.clone(), r.slot.clone(), r.path.clone()))
        {
            r.status = "subsumed".into();
        }
    }

    let mut candidates = Vec::new();
    for (i, score) in chosen {
        let f = &fits[i];
        let live = &f.live;
        let rule = Rule::RegisteredIn {
            slot: f.slot.clone(),
            path: f.path.clone(),
            named: f.named.clone(),
            reach: f.reach,
        };
        let outliers: Vec<Outlier> = live
            .iter()
            .filter(|m| !f.covered.contains(m))
            .map(|&m| Outlier {
                path: members[m].file.path.clone(),
                symbol: members[m].symbol.name.clone(),
                line: members[m].symbol.line,
            })
            .collect();
        // The example: a registered member, first by path.
        let example = live
            .iter()
            .filter(|m| f.covered.contains(m))
            .map(|&m| format!("{}#{}", members[m].file.path, members[m].symbol.name))
            .min()
            .unwrap_or_default();
        // The list that names the most members (of a family, or of one file's
        // lists of the slot).
        let live_set: BTreeSet<usize> = live.iter().copied().collect();
        let reg =
            (!f.lists.is_empty()).then(|| fullest(f.lists.iter().copied(), &live_set, &members));
        let site = reg.map(|r| {
            let like = live
                .iter()
                .filter_map(|&m| r.names(&members[m]).map(|line| (line, &members[m])))
                .min_by(|a, b| {
                    a.0.cmp(&b.0)
                        .then_with(|| a.1.file.path.cmp(&b.1.file.path))
                })
                .map(|(line, m)| WireLike {
                    name: m.symbol.name.clone(),
                    line,
                    path: m.file.path.clone(),
                });
            WireHint {
                action: "register".into(),
                path: r.path.to_string(),
                line: r.line,
                label: slot_label(&r.slot),
                like,
                entry: None,
            }
        });
        candidates.push(Candidate {
            id: convention_id(&f.role, &rule),
            role: f.role.clone(),
            evidence: Evidence {
                holders: f.covered.len(),
                total: live.len(),
                lower_bound: r3(wilson_lower_bound(f.covered.len(), live.len())),
                lift: 1.0,
                split: vec![],
                role_members: None,
                // Wiring rules are suggestions by kind; the example gives the language.
                python_members: None,
            },
            rule,
            score: r3(score),
            example,
            outliers,
            can_block: false,
            exempt: vec![],
            inherited: vec![],
            derived: vec![],
            wiring: site.map(|s| crate::mine::WiringEvidence {
                registry: s,
                lists: f.lists.len(),
                history: None,
            }),
        });
    }
    reports.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "proposed" => 0,
            "subsumed" => 1,
            "below_threshold" => 2,
            _ => 3,
        };
        rank(&a.status)
            .cmp(&rank(&b.status))
            .then_with(|| b.covered.cmp(&a.covered))
            .then_with(|| a.role.cmp(&b.role))
            .then_with(|| a.slot.cmp(&b.slot))
            .then_with(|| a.path.cmp(&b.path))
    });
    reports.truncate(MAX_REPORTED);
    // Census ids are unique: one rule per (role, rule), whatever found it twice.
    let mut seen = BTreeSet::new();
    candidates.retain(|c| seen.insert(c.id.clone()));
    WiringMined {
        candidates,
        registries: reports,
    }
}

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        assert!(glob_match("src/pages/*.tsx", "src/pages/a.tsx"));
        assert!(glob_match("src/{a,b}/*.ts", "src/b/x.ts"));
        assert!(!glob_match("src/pages/*.tsx", "src/pages/x/a.tsx"));
        assert!(glob_match("src/pages/**", "src/pages/x/a.tsx"));
        assert!(glob_match("src/**/*.{ts,tsx}", "src/a/b/c.tsx"));
        assert!(glob_match("src/**/*.ts", "src/c.ts"));
        assert!(!glob_match("src/**/*.ts", "lib/c.ts"));
    }

    /// Repository-controlled patterns that made the old backtracking matcher hang
    /// must match in linear time.
    #[test]
    fn hostile_globs_match_quickly() {
        let started = std::time::Instant::now();
        let long = format!("src/{}b.ts", "a".repeat(200));
        let star = format!("./{}b", "*a".repeat(14));
        assert!(!glob_match(&star, &long));
        let star = format!("src/{}b.ts", "*a".repeat(14));
        assert!(
            glob_match(&star, &long),
            "over the star cap: its prefix is discovered"
        );
        let braces = format!("src/{}", "{a,b}".repeat(20));
        assert!(glob_match(&braces, "src/ab/x"), "over the brace cap");
        assert!(!glob_match(&braces, "lib/ab"));
        let ok = format!("src/{}", "{a,b}".repeat(8));
        assert!(glob_match(&ok, "src/abababab"));
        for _ in 0..1000 {
            glob_match("src/**/*a*a*a*a*a*a*a*b.ts", &long);
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn labels() {
        assert_eq!(
            slot_label("arg:pkg:@nestjs/common#Module@0:providers"),
            "Module() providers"
        );
        assert_eq!(
            slot_label("arg:pkg:celery#Celery@99:include"),
            "Celery(include=)"
        );
        assert_eq!(slot_label("binding:urlpatterns"), "`urlpatterns`");
        assert_eq!(slot_label("calls:~#app"), "app.…() calls");
        assert_eq!(slot_label("arg:src/a.ts#combine@0"), "combine() argument 1");
        assert_eq!(slot_label(EXPORTS_SLOT), "re-exports");
    }

    /// `reach` describes how a rule was mined, not what it is: the id ignores it.
    #[test]
    fn ids_ignore_reach() {
        let role = RoleSelector {
            package: String::new(),
            dir: "src".into(),
            file: "*.service".into(),
            entry: ANY_ENTRY.into(),
            kind: SymbolKind::Class,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        };
        let rule = |reach| Rule::RegisteredIn {
            slot: "arg:pkg:@nestjs/common#Module@0:providers".into(),
            path: "src/app.module.ts".into(),
            named: String::new(),
            reach,
        };
        assert_eq!(
            convention_id(&role, &rule(true)),
            convention_id(&role, &rule(false))
        );
        let other = Rule::RegisteredIn {
            slot: "arg:pkg:@nestjs/common#Module@0:providers".into(),
            path: "src/other.module.ts".into(),
            named: String::new(),
            reach: true,
        };
        assert_ne!(
            convention_id(&role, &rule(true)),
            convention_id(&role, &other)
        );
    }

    #[test]
    fn families_ignore_the_file() {
        assert_eq!(
            family_of("src/a.ts", "calls:src/a.ts#router"),
            "calls:~#router"
        );
        assert_eq!(
            family_of("src/a.ts", "arg:pkg:@nestjs/common#Module@0:providers"),
            "arg:pkg:@nestjs/common#Module@0:providers"
        );
    }
}
