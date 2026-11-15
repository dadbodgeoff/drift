//! Repo-wide context a rule may need beyond its own unit: which frameworks the
//! repo uses, what its linter configs decide, the workspace's dependency graph
//! and the dependency versions most packages agree on.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use drift_core::{FileFacts, LintConfig, PackageFacts, RepoFacts, Symbol};

use crate::parts::Parts;
use crate::roles::{RoleSelector, Unit, View, is_python_package};

/// What a repo's linter config says about a rule, for a part of the repo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LintVerdict {
    /// No config covering it sets the rule.
    Silent,
    /// Set to `warn`: the team's stated policy, not enforced.
    Warned,
    /// Turned off: the team allows it. Mining then proposes no rule the lint rule
    /// states (`mine::proposable`); an import restriction turned off decides nothing.
    Disabled,
    /// Set to `error`: the linter already enforces it.
    Enforced,
}

impl LintVerdict {
    /// The linter decides: it already enforces the rule, so proposing it is trivial.
    pub fn decides(self) -> bool {
        self == LintVerdict::Enforced
    }
}

#[derive(Debug, Clone, Default)]
pub struct RepoContext<'a> {
    /// Classes the repository uses as Nest guards: `UseGuards=<G>` and `APP_GUARD=<G>`
    /// in `decorator_args` (normalised refs). Read by [`crate::security::authenticates`]
    /// (the framework's guard contract applies to them only).
    nest_guards: BTreeSet<String>,
    /// Package roots the repo imports or declares as a dependency.
    used: BTreeSet<String>,
    /// Range most packages of an ecosystem use, per (Python?, dependency).
    majority: BTreeMap<(bool, String), String>,
    lint: Vec<&'a LintConfig>,
    packages: Vec<&'a PackageFacts>,
    /// Dependency names each workspace package declares, by package path.
    declared: BTreeMap<String, BTreeSet<String>>,
    /// Package path -> the packages it may run without (peer and optional
    /// dependencies), which it loads lazily if at all.
    optional: BTreeMap<String, BTreeSet<String>>,
    /// Files that read `process.env` directly.
    env_readers: BTreeSet<&'a str>,
    /// What each class decorator registers the classes it decorates under
    /// ([`Registrations`]), by package-normalised decorator.
    registrations: BTreeMap<String, Registrations>,
    /// Everything that wraps an entry point of production code (package-normalised):
    /// what `drift security` lists as its guards.
    entry_wrappers: BTreeSet<String>,
    /// Every class the repo defines (`path#name`), with all the bases it extends
    /// directly or through in-repo bases (package-normalised refs).
    ancestors: BTreeMap<String, Vec<String>>,
    /// In-repo functions (`path#export`) that only wrap class-name utilities (`cn`
    /// calling `clsx` and `twMerge`).
    class_name_wrappers: BTreeSet<String>,
    /// Python library classes and functions the team wraps under the same name, and
    /// the wrappers themselves, each mapped to the wrapper (`path#name`).
    team_versions: BTreeMap<String, String>,
    /// The attributes each class of the repo has, its own and inherited from in-repo
    /// bases, with the callees each one's declaration calls ([`attributes`]). Keys are
    /// `path#name` and `path#<exported name>`.
    attributes: BTreeMap<String, Arc<Attributes>>,
    /// Every class the facts define (`path#name`, also under exported names),
    /// context files included.
    classes: BTreeSet<String>,
    /// Files by path, context files included (a file of the repo wins).
    files: BTreeMap<&'a str, &'a FileFacts>,
    /// The symbol members of each role, with their files, in unit order.
    role_members: BTreeMap<RoleSelector, Vec<(&'a FileFacts, &'a Symbol)>>,
    /// Units that are plain aliases of functions ([`crate::roles::FunctionAliases`]),
    /// by `path#name`: the function each names.
    aliases: BTreeMap<String, (&'a FileFacts, &'a Symbol)>,
    /// What each production class of the repo is built on: its lineage (every base it
    /// extends, directly or through in-repo bases) and its class decorators, both
    /// package-normalised; indexed by lineage member and by decorator
    /// ([`RepoContext::carriers`]).
    profiles: Vec<ClassProfile>,
    /// The roles of each profiled class (empty for one in no role), by profile index.
    profile_roles: Vec<Vec<RoleSelector>>,
    by_lineage: BTreeMap<String, Vec<usize>>,
    by_decorator: BTreeMap<String, Vec<usize>>,
    /// Names of the classes the facts define (`Form`), context files included.
    class_names: BTreeSet<String>,
    /// What guards an entry point, as `drift security` reads guards: the call wrappers
    /// and decorators on entry-point symbols (schema-only decorators left out), and the
    /// bases entry-point classes are built on; the same of handlers and controller
    /// classes a route refers to by reference, and of the classes a route's handler
    /// runs (constructs: [`class_run_by`]).
    guards: BTreeSet<String>,
    /// Classes (`path#name`) that are entry points, whose methods are routes, or that a
    /// route's handler reaches directly ([`RepoContext::is_entry_class`]).
    entry_classes: BTreeSet<String>,
    /// Entry classes only because a route's handler reaches them by a call
    /// ([`class_run_by`]): no entry point, route owner or reference names them
    /// ([`RepoContext::entry_only_as_reached`]).
    reached_only: BTreeSet<String>,
    /// The facts hold at most one file ([`RepoContext::holds_one_file`]).
    one_file: bool,
    /// Bindings built from another by additive builder steps, or bound to one
    /// ([`drift_core::Symbol::derives_from`]): `path#name` and `path#<exported name>` ->
    /// what it derives from (package-normalised), context files included.
    derivations: BTreeMap<String, String>,
    /// Every file the facts have, context files included.
    modules: BTreeSet<String>,
    /// Every symbol the facts define, context files included, by `path#name` and
    /// `path#<exported name>` ([`RepoContext::definition`]).
    symbols: BTreeMap<String, &'a drift_core::Symbol>,
    /// Functions and other non-class symbols (`path#name`) an entry point refers to by
    /// reference: the handler of `router.get("/x", handler)`, whose route is the routes
    /// file's own symbol ([`RepoContext::is_entry_unit`]).
    ref_entries: BTreeSet<String>,
    /// In-repo callees (package-normalised) that guard by what calls them: entry points
    /// call them directly in [`ENTRY_CALLERS`] places or more and their body can throw
    /// ([`RepoContext::called_as_guard`]).
    entry_checks: BTreeSet<String>,
    /// Who uses each exported symbol, for the shared parts of roles ([`crate::parts`]).
    parts: Parts,
    /// What entry-point symbols call (package-normalised): a rule that members call one
    /// of these (`ensureTeamAccess()`) is about what guards the entry points.
    entry_callees: BTreeSet<String>,
    /// The keys some call in the facts passes, each with the callees it is passed to
    /// (package-normalised): what [`RepoContext::passes_key`] answers from. Read from
    /// every symbol's arguments on the first question, once: the practice map asks for
    /// each guard of each entry point.
    passed_keys: std::sync::OnceLock<BTreeMap<String, BTreeSet<String>>>,
    /// What code of the repository puts on a request-scoped holder
    /// ([`RepoContext::held`]), read from every symbol's `caller_args` on the first
    /// question.
    held: std::sync::OnceLock<BTreeMap<String, BTreeSet<String>>>,
    /// The reader is `drift security` or the practice map
    /// ([`RepoContext::since_measured`]).
    since_measured: bool,
}

/// How many levels of in-repo functions a Python call rule's member may call its
/// callee through ([`RepoContext::calls_through_helpers`]).
pub const HELPER_DEPTH: usize = 2;

/// Entry points ([`RepoContext::is_entry_unit`]) that must call an in-repo function whose
/// body can throw before it counts as their guard ([`RepoContext::called_as_guard`]).
pub const ENTRY_CALLERS: usize = 2;

/// What a class is built on ([`RepoContext::lineage`] and its class decorators) and the
/// kind its file and folder name (`service` for `services/x.service.ts`), or the union
/// of that over the classes that follow a rule ([`RepoContext::carriers`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClassProfile {
    pub lineage: BTreeSet<String>,
    pub decorators: BTreeSet<String>,
    /// Kind words of the files' dotted suffixes (`service` for `x.service.ts`), with how
    /// many of the classes are in such a file.
    pub suffixes: BTreeMap<String, usize>,
    /// Kind words of the files' folders (`service` for `services/`), counted the same way.
    pub dirs: BTreeMap<String, usize>,
    /// How many classes the profile is of.
    pub count: usize,
}

impl ClassProfile {
    /// The kinds most of the classes' files or folders name: a suffix or folder that
    /// more than half of them share.
    pub fn place_kinds(&self) -> BTreeSet<String> {
        self.suffixes
            .iter()
            .chain(&self.dirs)
            .filter(|(_, n)| **n * 2 > self.count)
            .map(|(k, _)| k.clone())
            .collect()
    }
}

/// How much a symbol's facts say (calls, throws, controls, wraps, derivation): of two
/// symbols of one name (a TypeScript overload signature and its implementation), the
/// one that says more is the definition.
fn facts_of(s: &drift_core::Symbol) -> usize {
    s.calls.len()
        + s.throws.len()
        + s.controls
            .iter()
            .filter(|c| {
                // Not what mining does not read ([`RepoContext::since_measured`]).
                !matches!(
                    c.as_str(),
                    drift_core::controls::HANDLER_REJECTS
                        | drift_core::controls::HANDLER_MAY_REJECT
                        | drift_core::controls::PARAM_FLOWS
                        | drift_core::controls::REJECTS_SOME
                        | drift_core::controls::REFUSES_ALL
                        | drift_core::controls::PASSES_TEST_SIGNED_IN
                        | drift_core::controls::PASSES_TEST_TRUE
                        | drift_core::controls::PASSES_TEST_UNREAD
                        | drift_core::controls::TEST_ASKS_ROLE
                        | drift_core::controls::TEST_ASKS_STATUS
                        | drift_core::controls::TEST_ASKS_UNREAD
                        | drift_core::controls::RETURNS_CALLER
                        | drift_core::controls::RETURNS_UNREAD
                        | drift_core::controls::CALLS_UNNAMED
                        | drift_core::controls::RETURNS_REFUSING
                        | drift_core::controls::REFUSES_EVERY
                        | drift_core::controls::REFUSAL_NOT_RETURNED
                        | drift_core::controls::RETURNS_REQUEST
                        | drift_core::controls::ORM_FILTER
                        | drift_core::controls::OVERRIDDEN
                        | drift_core::controls::HANDS_BACK_PARAM
                        | drift_core::controls::KEEPS_VALUE
                        // Nor what the lowering records since that build for the
                        // practice map and `drift security` alone.
                        | drift_core::controls::REJECTS_CALLER
                        | drift_core::controls::REGISTERS_ARG
                        | drift_core::controls::UNREAD_CALL
                        | drift_core::controls::LATE_BOUND
                        | drift_core::controls::UNREAD_EXIT
                        | drift_core::controls::SCOPE_UNREAD
                        | drift_core::controls::METADATA_UNREAD
                ) && !c.starts_with(drift_core::controls::SHAPE)
                    && !c.starts_with(drift_core::controls::BUILTIN_VALUE)
                    && !c.starts_with(drift_core::controls::SETS_METADATA)
                    && !c.starts_with(drift_core::controls::OPENS_FOR_METADATA)
                    && !c.starts_with(drift_core::controls::SIDES)
                    && !c.starts_with(drift_core::controls::FILTER_VALUE)
                    && !c.starts_with(drift_core::controls::ARG_VALUE)
                    && !c.starts_with(drift_core::controls::ATTR_PARAM)
                    && !c.starts_with(drift_core::controls::RETURNS_REJECTION)
                    && !c.starts_with(drift_core::controls::RETURNS_RESULT_OF)
                    && !c.starts_with(drift_core::controls::DROPS_RESULT_OF)
                    && !c.starts_with(drift_core::controls::EXIT_UNREAD)
                    && !c.starts_with(drift_core::controls::VERIFIES_SIGNATURE)
            })
            .count()
        + s.wraps.len()
        + usize::from(!s.derives_from.is_empty())
}

/// What #52's shared parts read as guards, added to [`RepoContext::is_guard`]'s set:
/// the call wrappers, decorators and root components on entry-point symbols and the
/// bases (with their in-repo ancestors) they extend; and what entry-point symbols
/// call ([`RepoContext::is_guard_call`]).
fn part_guards(
    repo: &RepoFacts,
    ancestors: &BTreeMap<String, Vec<String>>,
) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut out = BTreeSet::new();
    let mut callees = BTreeSet::new();
    for f in &repo.files {
        for e in &f.entry_points {
            for s in f
                .symbols
                .iter()
                .filter(|s| s.exported_as.contains(&e.symbol) || s.name == e.symbol)
            {
                callees.extend(
                    s.calls
                        .iter()
                        .map(|c| crate::mine::norm_ref(c).into_owned()),
                );
                for w in &s.wraps {
                    let r = crate::mine::norm_ref(&w.wrapper).into_owned();
                    match w.kind {
                        drift_core::WrapKind::Call
                        | drift_core::WrapKind::Decorator
                        | drift_core::WrapKind::Jsx
                            if !crate::security::SCHEMA_ONLY.contains(&r.as_str()) =>
                        {
                            out.insert(r);
                        }
                        drift_core::WrapKind::Extends => {
                            if let Some(a) = ancestors.get(&r) {
                                out.extend(a.iter().cloned());
                            }
                            out.insert(r);
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    (out, callees)
}

/// Class-name utilities by export name: they merge CSS classes.
const CLASS_NAME_UTILITIES: &[&str] = &[
    "cn",
    "clsx",
    "classnames",
    "classNames",
    "twMerge",
    "twJoin",
    "cva",
    "tv",
];

/// Packages whose exports are class-name utilities.
const CLASS_NAME_PACKAGES: &[&str] = &[
    "clsx",
    "classnames",
    "tailwind-merge",
    "class-variance-authority",
    "tailwind-variants",
];

/// A known class-name utility, by export name or by package (`pkg:clsx#default`).
fn known_class_name_utility(callee: &str) -> bool {
    let Some((module, name)) = callee.split_once('#') else {
        return false;
    };
    let name = name.split('(').next().unwrap_or(name);
    let name = name.rsplit('.').next().unwrap_or(name);
    CLASS_NAME_UTILITIES.contains(&name)
        || package_root(module).is_some_and(|p| CLASS_NAME_PACKAGES.contains(&p))
}

/// `name@range` -> (`name`, `range`); scoped names keep their leading `@`.
pub fn split_dep(d: &str) -> Option<(&str, &str)> {
    let i = d.get(1..)?.find('@')? + 1;
    Some((&d[..i], &d[i + 1..]))
}

fn package_root(module: &str) -> Option<&str> {
    let m = module.strip_prefix("pkg:")?;
    let mut parts = m.splitn(3, '/');
    let first = parts.next()?;
    if first.starts_with('@') {
        let second = parts.next()?;
        Some(&m[..first.len() + 1 + second.len()])
    } else {
        Some(first)
    }
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// `dir` is `scope` or one of its ancestors ("" is the repo root).
fn covers(dir: &str, scope: &str) -> bool {
    dir.is_empty() || scope == dir || scope.starts_with(&format!("{dir}/"))
}

impl<'a> RepoContext<'a> {
    /// Built from the repo and its analysable units (package units define the
    /// workspace population for version agreement).
    pub fn new(repo: &'a RepoFacts, units: &[Unit<'a>]) -> Self {
        let mut used = BTreeSet::new();
        for f in &repo.files {
            for i in &f.imports {
                if let Some(p) = package_root(&i.module) {
                    used.insert(p.to_string());
                }
            }
        }
        // npm dependencies (framework mandates name npm packages).
        for p in repo.packages.iter().filter(|p| !is_python_package(p)) {
            for d in &p.dependencies {
                if let Some((n, _)) = split_dep(d) {
                    used.insert(n.to_string());
                }
            }
        }
        // Per ecosystem and dependency: how many packages use each range, and how many
        // depend on it.
        type Counts<'d> = (BTreeMap<&'d str, usize>, usize);
        let mut by_dep: BTreeMap<(bool, &str), Counts> = BTreeMap::new();
        for u in units {
            if let View::Package(p) = u.view {
                let mut seen = BTreeSet::new();
                let mut names = BTreeSet::new();
                for d in &p.dependencies {
                    if let Some((n, r)) = split_dep(d) {
                        let e = by_dep.entry((is_python_package(p), n)).or_default();
                        if seen.insert((n, r)) {
                            *e.0.entry(r).or_default() += 1;
                        }
                        if names.insert(n) {
                            e.1 += 1;
                        }
                    }
                }
            }
        }
        // Only a strict majority is "the version the workspace uses": on a tie (two
        // packages upgraded, two not) the workspace agrees on nothing.
        let majority = by_dep
            .into_iter()
            .filter_map(|((py, n), (ranges, packages))| {
                ranges
                    .into_iter()
                    .find(|(_, c)| c * 2 > packages)
                    .map(|(r, _)| ((py, n.to_string()), r.to_string()))
            })
            .collect();
        // A directory can hold two manifests (`package.json` and `pyproject.toml`):
        // the package there declares what either declares.
        let mut declared: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for p in &repo.packages {
            declared.entry(p.path.clone()).or_default().extend(
                p.dependencies
                    .iter()
                    .filter_map(|d| split_dep(d).map(|(n, _)| n.to_string())),
            );
        }
        let mut optional: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for p in &repo.packages {
            let names: BTreeSet<String> = p
                .peer_dependencies
                .iter()
                .chain(&p.optional_dependencies)
                .filter_map(|d| split_dep(d).map(|(n, _)| n.to_string()))
                .collect();
            if !names.is_empty() {
                optional.entry(p.path.clone()).or_default().extend(names);
            }
        }
        let env_readers = repo
            .files
            .iter()
            .filter(|f| {
                f.symbols
                    .iter()
                    .any(|s| s.reads.iter().any(|r| r.starts_with("process.env")))
            })
            .map(|f| f.path.as_str())
            .collect();
        // A function whose calls are all class-name utilities is one itself.
        let class_name_wrappers = repo
            .files
            .iter()
            .flat_map(|f| {
                f.symbols
                    .iter()
                    .filter(|s| {
                        s.kind == drift_core::SymbolKind::Function
                            && !s.calls.is_empty()
                            && s.calls.iter().all(|c| known_class_name_utility(c))
                    })
                    .flat_map(move |s| s.exported_as.iter().map(move |n| format!("{}#{n}", f.path)))
            })
            .collect();
        let ancestors = ancestors(repo);
        let (part_guards, entry_callees) = part_guards(repo, &ancestors);
        let mut unit_roles: BTreeMap<(&str, &str), &[RoleSelector]> = BTreeMap::new();
        for u in units {
            if let View::Symbol(f, s) = u.view
                && s.kind == drift_core::SymbolKind::Class
            {
                unit_roles.insert((f.path.as_str(), s.name.as_str()), &u.roles);
            }
        }
        let mut profiles = Vec::new();
        let mut profile_roles = Vec::new();
        let mut by_lineage: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        let mut by_decorator: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for f in repo
            .files
            .iter()
            .filter(|f| !crate::roles::is_test_path(&f.path))
        {
            for c in f
                .symbols
                .iter()
                .filter(|s| s.kind == drift_core::SymbolKind::Class)
            {
                let profile = ClassProfile {
                    lineage: lineage_of(c, &ancestors),
                    decorators: c
                        .wraps
                        .iter()
                        .filter(|w| w.kind == drift_core::WrapKind::Decorator)
                        .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
                        .collect(),
                    suffixes: suffix_kind(&f.path).map(|k| (k, 1)).into_iter().collect(),
                    dirs: dir_kind(&f.path).map(|k| (k, 1)).into_iter().collect(),
                    count: 1,
                };
                let i = profiles.len();
                profile_roles.push(
                    unit_roles
                        .get(&(f.path.as_str(), c.name.as_str()))
                        .map_or_else(Vec::new, |r| r.to_vec()),
                );
                for l in &profile.lineage {
                    by_lineage.entry(l.clone()).or_default().push(i);
                }
                for d in &profile.decorators {
                    by_decorator.entry(d.clone()).or_default().push(i);
                }
                profiles.push(profile);
            }
        }
        let mut symbols: BTreeMap<String, &'a drift_core::Symbol> = BTreeMap::new();
        for f in repo.files.iter().chain(&repo.context_files) {
            for s in &f.symbols {
                for n in std::iter::once(&s.name).chain(&s.exported_as) {
                    // A TypeScript overload signature has no body: the
                    // implementation, with the most facts, wins.
                    let e = symbols.entry(format!("{}#{n}", f.path)).or_insert(s);
                    if facts_of(s) > facts_of(e) {
                        *e = s;
                    }
                }
            }
        }
        let mut guards = BTreeSet::new();
        let mut entry_classes = BTreeSet::new();
        let mut ref_entries = BTreeSet::new();
        // Classes routes name (their own, the owner of a route method, by reference),
        // and classes a route's handler reaches by a call.
        let mut named_classes: BTreeSet<String> = BTreeSet::new();
        let mut reached_classes: BTreeSet<String> = BTreeSet::new();
        // What the routes refer to by reference (`router.get("/x", handler)`,
        // `router.get("/x", ctrl.list)`): the handler is an entry point, and what it is
        // wrapped in or built on guards it as it would guard the route's own symbol.
        // Context files are read too, for whatever entry points they carry. A hook's
        // TypeScript single-file scan loads its bindings' files without their entry points
        // and without the routes file, so there a handler routed by reference is not an
        // entry unit: an exemption that would apply only because of that is undecided and
        // sends the hook to a full scan (`Rule::exemption_undecided`, tests/gate.rs).
        let mut by_ref: Vec<&'a drift_core::Symbol> = Vec::new();
        for f in repo.files.iter().chain(&repo.context_files) {
            for e in &f.entry_points {
                for sym in f
                    .symbols
                    .iter()
                    .filter(|s| s.exported_as.contains(&e.symbol) || s.name == e.symbol)
                {
                    for c in &sym.calls {
                        let Some(r) = c.strip_suffix("(ref)") else {
                            continue;
                        };
                        for t in ref_target(&symbols, &crate::mine::norm_ref(r)) {
                            match t {
                                RefTarget::Class(key, class) => {
                                    named_classes.insert(key.clone());
                                    entry_classes.insert(key);
                                    by_ref.push(class);
                                }
                                RefTarget::Unit(key, unit) => {
                                    ref_entries.insert(key);
                                    by_ref.push(unit);
                                }
                            }
                        }
                    }
                }
            }
        }
        for sym in &by_ref {
            for w in &sym.wraps {
                let r = crate::mine::norm_ref(&w.wrapper).into_owned();
                match w.kind {
                    drift_core::WrapKind::Call | drift_core::WrapKind::Decorator
                        if !crate::security::SCHEMA_ONLY.contains(&r.as_str()) =>
                    {
                        guards.insert(r);
                    }
                    _ => {}
                }
            }
            guards.extend(lineage_of(sym, &ancestors));
        }
        for f in &repo.files {
            for e in &f.entry_points {
                let syms: Vec<&drift_core::Symbol> = f
                    .symbols
                    .iter()
                    .filter(|s| s.exported_as.contains(&e.symbol) || s.name == e.symbol)
                    .collect();
                // The route's own symbol, and the class whose method it is: a Nest route
                // carries the class decorators but not what the class extends.
                let owner = route_owner(f, e);
                // The in-repo classes the handler reaches directly by calling them
                // ([`class_run_by`]; a class referred to by reference is the pass above's):
                // a route that calls `new XHandler().handle(req, res)` is XHandler's route,
                // and what XHandler is built on guards it. A static call
                // (`Choices.values()`) makes the class the route's, but runs nothing of
                // its bases. Both land in the one `entry_classes` set every exemption path
                // reads ([`RepoContext::is_entry_unit`]).
                let reached = syms.iter().flat_map(|s| &s.calls).filter_map(|c| {
                    let (class, runs) = class_run_by(&crate::mine::norm_ref(c))?;
                    let &sym = symbols.get(&class)?;
                    let (path, _) = class.split_once('#')?;
                    (sym.kind == drift_core::SymbolKind::Class)
                        .then(|| (path.to_string(), sym, runs))
                });
                let own = syms.iter().copied().chain(owner);
                let own = own.map(|s| (f.path.clone(), s, true, false));
                let reached = reached.map(|(p, s, runs)| (p, s, runs, true));
                for (path, sym, runs, by_call) in own.chain(reached) {
                    if sym.kind == drift_core::SymbolKind::Class {
                        let key = format!("{path}#{}", sym.name);
                        if by_call {
                            reached_classes.insert(key.clone());
                        } else {
                            named_classes.insert(key.clone());
                        }
                        entry_classes.insert(key);
                    }
                    if !runs {
                        continue;
                    }
                    for w in &sym.wraps {
                        let r = crate::mine::norm_ref(&w.wrapper).into_owned();
                        match w.kind {
                            // A registry function a class the handler constructs is
                            // decorated with ran once, at import, and left the class as
                            // it was: nothing of it runs with the route. What the class
                            // is built on still does (its `__init__`, its methods).
                            drift_core::WrapKind::Decorator
                                if by_call && registry_function(&symbols, &r) => {}
                            drift_core::WrapKind::Call | drift_core::WrapKind::Decorator
                                if !crate::security::SCHEMA_ONLY.contains(&r.as_str()) =>
                            {
                                guards.insert(r);
                            }
                            _ => {}
                        }
                    }
                    guards.extend(lineage_of(sym, &ancestors));
                }
            }
        }
        // #52's reading of guards too: only ever refuses exemptions, so the union.
        guards.extend(part_guards);
        let reached_only = reached_classes
            .difference(&named_classes)
            .cloned()
            .collect();
        let entry_checks = entry_checks(repo, &symbols, &entry_classes, &ref_entries);
        let mut files: BTreeMap<&str, &FileFacts> = BTreeMap::new();
        for f in repo.files.iter().chain(&repo.context_files) {
            files.entry(f.path.as_str()).or_insert(f);
        }
        let mut role_members: BTreeMap<RoleSelector, Vec<(&FileFacts, &Symbol)>> = BTreeMap::new();
        let mut aliases = BTreeMap::new();
        for u in units {
            if let View::Symbol(f, s) = &u.view {
                for r in &u.roles {
                    role_members.entry(r.clone()).or_default().push((*f, *s));
                }
                if let Some(t) = u.alias {
                    aliases.insert(format!("{}#{}", f.path, s.name), t);
                }
            }
        }
        // Both read the one ancestor map.
        let team_versions = team_versions(repo, &ancestors);
        let nest_guards = repo
            .files
            .iter()
            .flat_map(|f| &f.symbols)
            .flat_map(|s| &s.decorator_args)
            .filter_map(|a| a.split_once('='))
            .filter(|(d, _)| {
                crate::mine::norm_ref(d) == "pkg:@nestjs/common#UseGuards"
                    || *d == "APP_GUARD"
                    || d.ends_with("#APP_GUARD")
                    || d.ends_with(".APP_GUARD")
            })
            .map(|(_, g)| g)
            // And the classes `useGlobalGuards` registers ([`drift_core::NEST_GUARD`]).
            .chain(
                repo.files
                    .iter()
                    .flat_map(|f| &f.symbols)
                    .flat_map(|s| &s.app_middleware)
                    .filter_map(|m| {
                        m.trim_start_matches('?')
                            .strip_prefix(drift_core::NEST_GUARD)
                    }),
            )
            .map(|g| crate::mine::norm_ref(g).trim_end_matches("()").to_string())
            .collect();
        Self {
            nest_guards,
            files,
            role_members,
            aliases,
            parts: Parts::new(repo, units),
            guards,
            entry_callees,
            passed_keys: std::sync::OnceLock::new(),
            held: std::sync::OnceLock::new(),
            since_measured: false,
            class_name_wrappers,
            entry_classes,
            reached_only,
            one_file: repo.files.len() <= 1,
            symbols,
            ref_entries,
            entry_checks,
            profiles,
            profile_roles,
            by_lineage,
            by_decorator,
            class_names: repo
                .files
                .iter()
                .chain(&repo.context_files)
                .flat_map(|f| {
                    f.symbols
                        .iter()
                        .filter(|s| s.kind == drift_core::SymbolKind::Class)
                        .map(|s| s.name.clone())
                })
                .collect(),
            team_versions,
            ancestors,
            attributes: attributes(repo),
            classes: repo
                .files
                .iter()
                .chain(&repo.context_files)
                .flat_map(|f| {
                    f.symbols
                        .iter()
                        .filter(|s| s.kind == drift_core::SymbolKind::Class)
                        .flat_map(move |s| {
                            std::iter::once(&s.name)
                                .chain(&s.exported_as)
                                .map(move |n| format!("{}#{n}", f.path))
                        })
                })
                .collect(),
            derivations: repo
                .files
                .iter()
                .chain(&repo.context_files)
                .flat_map(|f| {
                    f.symbols
                        .iter()
                        .filter(|s| !s.derives_from.is_empty())
                        .flat_map(move |s| {
                            let from = crate::mine::norm_ref(&s.derives_from).into_owned();
                            std::iter::once(&s.name)
                                .chain(&s.exported_as)
                                .map(move |n| (format!("{}#{n}", f.path), from.clone()))
                        })
                })
                .collect(),
            modules: repo
                .files
                .iter()
                .chain(&repo.context_files)
                .map(|f| f.path.clone())
                .collect(),
            env_readers,
            used,
            majority,
            lint: repo.lint.iter().collect(),
            packages: repo.packages.iter().collect(),
            declared,
            optional,
            registrations: registrations(repo),
            entry_wrappers: entry_wrappers(repo),
        }
    }

    /// The same context for `drift security` and the practice map, which read the
    /// guard proofs added since the last build whose mined proposals were measured
    /// ([`drift_core::Listed`]): a guard that answers "not signed in" in an `except`
    /// handler ([`drift_core::controls::HANDLER_REJECTS`]). Mining's context does
    /// not, so what it reads as a guard is what the measured build read.
    pub fn reading_since_measured(mut self) -> Self {
        self.since_measured = true;
        self
    }

    /// Whether the proofs added since the measured build are read
    /// ([`RepoContext::reading_since_measured`]).
    pub fn since_measured(&self) -> bool {
        self.since_measured
    }

    /// The function the unit `s` (a symbol of `f`) is a plain alias of
    /// ([`crate::roles::Unit::alias`]), whose facts say what it does: what it is wrapped
    /// in, calls, renders and throws. `None` for any other symbol.
    pub fn alias_target(&self, f: &FileFacts, s: &Symbol) -> Option<(&'a FileFacts, &'a Symbol)> {
        if self.aliases.is_empty()
            || !matches!(
                s.kind,
                drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
            )
            || s.derives_from.is_empty()
        {
            return None;
        }
        self.aliases.get(&format!("{}#{}", f.path, s.name)).copied()
    }

    /// The symbol members of `role` (none for a role these facts have no member of).
    pub fn role_members(&self, role: &RoleSelector) -> &[(&'a FileFacts, &'a Symbol)] {
        self.role_members.get(role).map_or(&[], Vec::as_slice)
    }

    /// The in-repo symbol a canonical ref (`path#name`, `path#<exported name>`) names, if
    /// these facts have its file.
    pub fn symbol(&self, r: &str) -> Option<(&'a FileFacts, &'a Symbol)> {
        let (module, name) = r.split_once('#')?;
        let f = *self.files.get(module)?;
        f.symbols
            .iter()
            .find(|s| s.name == name)
            .or_else(|| {
                f.symbols
                    .iter()
                    .find(|s| s.exported_as.iter().any(|e| e == name))
            })
            .map(|s| (f, s))
    }

    /// Bases a class extends, directly or through in-repo classes, when `class` (a
    /// canonical ref) is a class of the repo; empty otherwise.
    pub fn ancestors(&self, class: &str) -> &[String] {
        self.ancestors.get(class).map_or(&[], Vec::as_slice)
    }

    /// The team's own version of `r`, when `r` is a library class or function that
    /// a production Python class or function of the repo wraps under the same name
    /// (`CTFd/forms/fields.py#SubmitField` extending `wtforms.SubmitField`, polar's
    /// `actor` calling `dramatiq.actor`), or is that wrapper.
    pub fn team_version(&self, r: &str) -> Option<&str> {
        self.team_versions.get(r).map(String::as_str)
    }

    /// What the binding `binding` (`path#name`) is built from, if it is built from
    /// another binding by additive builder steps or bound to one.
    pub fn derives_from(&self, binding: &str) -> Option<&str> {
        self.derivations.get(binding).map(String::as_str)
    }

    /// The facts have the file at `path` (a context file counts).
    pub fn has_module(&self, path: &str) -> bool {
        self.modules.contains(path)
    }

    /// What gives the values code of the repository binds on the request-scoped
    /// holder attribute `holder` (`pkg:flask#g.venue_id`,
    /// `global#request.state.tenant`): for each binding of a value
    /// of the caller ([`drift_core::Symbol::caller_args`] with the holder as the
    /// callee), the dependency or helper it comes through, or `""` for a value
    /// that is the caller's by its own source (`g.venue_id = get_jwt()["venue_id"]`).
    /// `None` where nothing in the facts binds one there.
    pub fn held(&self, holder: &str) -> Option<&BTreeSet<String>> {
        // Python's holders, and the one TypeScript's are written under.
        const HOLDERS: [&str; 3] = [
            drift_core::CALLER_HOLDERS[0],
            drift_core::CALLER_HOLDERS[1],
            drift_core::CALLER_HOLDER_TS,
        ];
        if !HOLDERS.iter().any(|h| holder.starts_with(h)) {
            return None;
        }
        self.held
            .get_or_init(|| {
                let mut held: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
                let lists = self.symbols.values().flat_map(|s| {
                    std::iter::once(&s.caller_args).chain(s.members.iter().map(|m| &m.caller_args))
                });
                for entry in lists.flatten() {
                    let (callee, via) = entry
                        .split_once(drift_core::CALLER_ARG_VIA)
                        .unwrap_or((entry, ""));
                    // A use reads the holder through itself: no binding.
                    if via != callee && HOLDERS.iter().any(|h| callee.starts_with(h)) {
                        held.entry(callee.to_string())
                            .or_default()
                            .insert(via.to_string());
                    }
                }
                held
            })
            .get(holder)
    }

    /// Some call in the facts passes the key `key` to `callee` (`auto_error` to
    /// `OAuth2PasswordBearer(...)`), compared package-normalised.
    pub fn passes_key(&self, callee: &str, key: &str) -> bool {
        let want = crate::mine::norm_ref(callee.trim_end_matches("(new)"));
        let passed = self.passed_keys.get_or_init(|| {
            let mut passed: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
            for s in self.symbols.values() {
                for a in &s.args {
                    // `<callee>@<position>:<key>`.
                    if let Some((at, k)) = a.rsplit_once(':')
                        && let Some((c, _)) = at.rsplit_once('@')
                    {
                        passed
                            .entry(k.to_string())
                            .or_default()
                            .insert(crate::mine::norm_ref(c).into_owned());
                    }
                }
            }
            passed
        });
        passed
            .get(key)
            .is_some_and(|callees| callees.contains(want.as_ref()))
    }

    /// The symbol that defines the binding a reference starts with: the longest prefix
    /// of `path#a.b.c` (before any call) the facts define, so
    /// `lib/a.ts#client.inputSchema().action` is `client`'s definition and
    /// `app/v.py#View.get` the method's (or the class's, when the facts have only it).
    /// The repository uses `r` as a Nest guard class (`@UseGuards(r)`, `APP_GUARD`).
    pub fn is_nest_guard(&self, r: &str) -> bool {
        self.nest_guards
            .contains(crate::mine::norm_ref(r).trim_end_matches("()"))
    }

    pub fn definition(&self, r: &str) -> Option<&'a drift_core::Symbol> {
        let r = crate::mine::norm_ref(r);
        let (module, rest) = r.split_once('#')?;
        let segs: Vec<&str> = rest.split('.').collect();
        (1..=segs.len()).rev().find_map(|k| {
            if segs[..k].iter().any(|s| s.contains('(')) {
                return None;
            }
            self.symbols
                .get(&format!("{module}#{}", segs[..k].join(".")))
                .copied()
        })
    }

    /// `symbol` calls `callee` through an in-repo function it calls, to
    /// [`HELPER_DEPTH`] levels: `get_window_date_range()` reads Redis through
    /// `get_anchor_timestamp()`, which calls `get_redis_client()`. Only functions the
    /// facts define (exact `path#name`), never a package's or a class's method.
    pub fn calls_through_helpers(&self, symbol: &drift_core::Symbol, callee: &str) -> bool {
        let want = crate::mine::norm_ref(callee);
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut frontier = vec![symbol];
        for _ in 0..HELPER_DEPTH {
            let mut next = Vec::new();
            for s in frontier {
                for c in s.calls.iter().filter(|c| !c.ends_with("(ref)")) {
                    let key = crate::mine::norm_ref(c).into_owned();
                    let Some(&d) = self.symbols.get(&key) else {
                        continue;
                    };
                    if d.kind != drift_core::SymbolKind::Function || !seen.insert(key) {
                        continue;
                    }
                    if d.calls.iter().any(|x| crate::mine::norm_ref(x) == want) {
                        return true;
                    }
                    next.push(d);
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        false
    }

    /// `callee` (an in-repo function) guards the entry points that call it: they call it
    /// in [`ENTRY_CALLERS`] places or more and its body can throw ([`entry_checks`]).
    pub fn called_as_guard(&self, callee: &str) -> bool {
        self.entry_checks
            .contains(crate::mine::norm_ref(callee).as_ref())
    }

    /// `callee` merges CSS class names: a known utility (`cn`, `clsx`, `twMerge`,
    /// `cva`, ...) or an in-repo function that only wraps such utilities.
    pub fn is_class_name_helper(&self, callee: &str) -> bool {
        known_class_name_utility(callee) || self.class_name_wrappers.contains(callee)
    }

    /// `class` (a canonical ref) is a class these facts define.
    pub fn knows_class(&self, class: &str) -> bool {
        self.classes.contains(class)
    }

    /// Every base `class` extends, directly or through in-repo bases
    /// (package-normalised refs).
    pub fn lineage(&self, class: &drift_core::Symbol) -> BTreeSet<String> {
        lineage_of(class, &self.ancestors)
    }

    /// What the production classes that follow a base-class rule (`extends`: their
    /// lineage holds a target) or a class-decorator rule (they carry a target) are
    /// built on, together. For a base-class rule the targets and their ancestors are
    /// in the lineage too. Counted within `role` when given (the convention's role, so
    /// code outside it changes no verdict), else over the whole repo; a hook's
    /// single-file scan does not have them ([`crate::mine::Rule::exemption_undecided`]).
    pub fn carriers(
        &self,
        extends: bool,
        targets: &[String],
        role: Option<&RoleSelector>,
    ) -> ClassProfile {
        let mut out = ClassProfile::default();
        for i in self.carrier_indexes(extends, targets, role) {
            let p = &self.profiles[i];
            out.lineage.extend(p.lineage.iter().cloned());
            out.decorators.extend(p.decorators.iter().cloned());
            for (k, n) in &p.suffixes {
                *out.suffixes.entry(k.clone()).or_default() += n;
            }
            for (k, n) in &p.dirs {
                *out.dirs.entry(k.clone()).or_default() += n;
            }
            out.count += p.count;
        }
        if extends {
            for t in targets {
                let t = crate::mine::norm_ref(t).into_owned();
                out.lineage.extend(self.ancestors(&t).iter().cloned());
                out.lineage.insert(t);
            }
        }
        out
    }

    /// How many production classes of these facts follow the rule
    /// [`RepoContext::carriers`] describes: fewer than mining counted means the facts
    /// are a single-file scan.
    pub fn carriers_count(
        &self,
        extends: bool,
        targets: &[String],
        role: Option<&RoleSelector>,
    ) -> usize {
        self.carrier_indexes(extends, targets, role).len()
    }

    fn carrier_indexes(
        &self,
        extends: bool,
        targets: &[String],
        role: Option<&RoleSelector>,
    ) -> BTreeSet<usize> {
        let index = if extends {
            &self.by_lineage
        } else {
            &self.by_decorator
        };
        targets
            .iter()
            .flat_map(|t| {
                index
                    .get(crate::mine::norm_ref(t).as_ref())
                    .into_iter()
                    .flatten()
                    .copied()
            })
            .filter(|&i| role.is_none_or(|r| self.profile_roles[i].contains(r)))
            .collect()
    }

    /// `target` guards an entry point somewhere in the facts (it wraps, decorates or is
    /// a base of one, or of a handler or controller a route refers to by reference): a
    /// convention on it is a security boundary.
    pub fn is_guard(&self, target: &str) -> bool {
        self.guards.contains(crate::mine::norm_ref(target).as_ref())
    }

    /// The class is an entry class ([`RepoContext::is_entry_unit`] reads it): an entry
    /// point itself, a class one of whose methods is a route (a Nest controller's
    /// `@Post()` handler, a Python view's `get`), one a route refers to by reference
    /// (`router.get("/x", ctrl.list)`, `X.handle` passed as the handler), or one a
    /// route's handler reaches directly: constructs it or calls a method on it
    /// (`new XHandler().handle(req, res)`, Python's `XHandler().handle(request)`, a
    /// static `XHandler.verify(req)`). When the route runs the class (every case but a
    /// static call), what the class is built on guards it too ([`RepoContext::is_guard`]).
    pub fn is_entry_class(&self, path: &str, class: &str) -> bool {
        self.entry_classes.contains(&format!("{path}#{class}"))
    }

    /// The unit is an entry point only because a route's handler reaches it by a call
    /// ([`class_run_by`]: constructs it, calls a method on it): no entry point names it,
    /// it owns no route method, and no route refers to it by reference.
    pub fn entry_only_as_reached(
        &self,
        file: &drift_core::FileFacts,
        symbol: &drift_core::Symbol,
    ) -> bool {
        let key = format!("{}#{}", file.path, symbol.name);
        self.reached_only.contains(&key)
            && crate::roles::entry_of(file, symbol) == "-"
            && !file.entry_points.iter().any(|e| e.symbol == symbol.name)
            && !self.ref_entries.contains(&key)
    }

    /// `target` is a registry function of these facts ([`registry_function`]), and
    /// nothing in its name says access control.
    pub fn is_registry_function(&self, target: &str) -> bool {
        registry_function(&self.symbols, &crate::mine::norm_ref(target))
    }

    /// The facts hold at most one file, as a hook's single-file scan does (its base
    /// classes' files are context, not files): routes in other files are not in them.
    pub fn holds_one_file(&self) -> bool {
        self.one_file
    }

    /// The unit is an entry point: one itself (an entry point names it), an entry class
    /// ([`RepoContext::is_entry_class`]: one whose method is a route, or that a route
    /// refers to, constructs or calls), or a handler a route refers to by reference
    /// (`router.get("/x", handler)`, whose route is the routes file's own symbol). A
    /// class is an entry class too when a route refers to its method
    /// (`Controller.list`) or to a method of an instance the module builds
    /// (`ctrl.list`, `export const ctrl = new Controller()`).
    pub fn is_entry_unit(&self, file: &drift_core::FileFacts, symbol: &drift_core::Symbol) -> bool {
        crate::roles::entry_of(file, symbol) != "-"
            || file.entry_points.iter().any(|e| e.symbol == symbol.name)
            || self.is_entry_class(&file.path, &symbol.name)
            || self
                .ref_entries
                .contains(&format!("{}#{}", file.path, symbol.name))
    }

    /// The facts define a class of this name (`Form`): a package ref to it may be an
    /// alias of the repo's own code that the resolver did not map.
    pub fn defines_class_named(&self, name: &str) -> bool {
        self.class_names.contains(name)
    }

    /// Everything `class` extends is known: it is a class of these facts, and so is
    /// every ancestor (none comes from a package, whose own bases the facts do not
    /// have). Then a base outside its ancestors is certainly not one of them.
    pub fn ancestry_known(&self, class: &str) -> bool {
        self.knows_class(class) && self.ancestors(class).iter().all(|a| self.knows_class(a))
    }

    /// The class inherits a call to `callee` from an in-repo base, at any depth: an
    /// attribute a base declares with the call (`fieldsets = (FieldSet(...),)`, a model
    /// field) that neither the class nor a class between them reassigns. Calls in a
    /// base's methods do not count: a subclass may be meant to override the method.
    pub fn inherits_call(&self, class: &drift_core::Symbol, callee: &str) -> bool {
        if self.attributes.is_empty() {
            return false;
        }
        let callee = crate::mine::norm_ref(callee);
        let own: BTreeSet<&str> = class.declares.iter().map(|d| attribute_of(d).0).collect();
        inherited(
            class
                .wraps
                .iter()
                .filter(|w| w.kind == drift_core::WrapKind::Extends)
                .filter_map(|w| {
                    self.attributes
                        .get(crate::mine::norm_ref(&w.wrapper).as_ref())
                        .map(|a| &**a)
                }),
        )
        .into_iter()
        .any(|(attr, callees)| {
            !own.contains(attr) && callees.iter().any(|c| crate::mine::norm_ref(c) == callee)
        })
    }

    /// An entry point calls `callee` somewhere in the facts: a calls rule on it is about
    /// what guards the entry points (`ensureTeamAccess()`, `assertCan()`).
    pub fn is_guard_call(&self, callee: &str) -> bool {
        self.entry_callees
            .contains(crate::mine::norm_ref(callee).as_ref())
    }

    /// How many units use `symbol` (of the file at `path`) when it may be a shared
    /// part of `role`: no entry point, no default export, in a role without entry
    /// points, and used only from inside the role's scope ([`Parts::users_within`]).
    pub fn part_users(
        &self,
        role: &RoleSelector,
        path: &str,
        symbol: &drift_core::Symbol,
    ) -> Option<usize> {
        self.parts.users_within(role, path, symbol)
    }

    /// The package at `package` (its directory, "" for the root) declares a
    /// dependency on `name`.
    pub fn package_depends_on(&self, package: &str, name: &str) -> bool {
        self.declared.get(package).is_some_and(|d| d.contains(name))
    }

    /// The registration `decorator` files `class` under, if `decorator` keeps a registry
    /// keyed by one ([`Registrations::keyed`]) and another class already holds the key
    /// `class` would be filed under: its own `Meta.model`. Returns the key and the
    /// class that holds it (`path#name`).
    pub fn registered_key(
        &self,
        decorator: &str,
        class: &drift_core::Symbol,
    ) -> Option<(&str, &str)> {
        let r = self
            .registrations
            .get(crate::mine::norm_ref(decorator).as_ref())?;
        if !r.keyed() {
            return None;
        }
        let key = meta_model(class)?;
        let (key, holders) = r.keys.get_key_value(key)?;
        Some((key.as_str(), holders.first()?.as_str()))
    }

    /// `target` wraps an entry point of production code in these facts.
    pub fn wraps_entry_point(&self, target: &str) -> bool {
        self.entry_wrappers
            .contains(crate::mine::norm_ref(target).as_ref())
    }

    /// Classes the facts hold that `decorator` decorates (a single-file scan holds
    /// fewer than the repo).
    pub fn registered_count(&self, decorator: &str) -> usize {
        self.registrations
            .get(crate::mine::norm_ref(decorator).as_ref())
            .map_or(0, |r| r.classes)
    }

    /// The file at `path` reads `process.env` directly.
    pub fn reads_env(&self, path: &str) -> bool {
        self.env_readers.contains(path)
    }

    /// The repo imports this package or a package declares it as a dependency.
    pub fn uses(&self, package: &str) -> bool {
        self.used.contains(package)
    }

    /// The range a strict majority of the workspace packages depending on `name`
    /// declare, if any.
    /// `python` selects Python packages, otherwise npm packages.
    pub fn majority_range_in(&self, python: bool, name: &str) -> Option<&str> {
        self.majority
            .get(&(python, name.to_string()))
            .map(String::as_str)
    }

    /// The setting of `rule` that applies to files under `scope` in one tool's
    /// config: the nearest config of the tool decides, falling back to its parent
    /// only when it inherits from it.
    fn tool_setting(
        &self,
        tool: &str,
        rule: &str,
        scope: &str,
    ) -> Option<&'a drift_core::LintRule> {
        let mut chain: Vec<&&LintConfig> = self
            .lint
            .iter()
            .filter(|c| c.tool == tool && covers(dir_of(&c.path), scope))
            .collect();
        // Deepest first; ties (two configs in one directory) by path for determinism.
        chain.sort_by(|a, b| {
            dir_of(&b.path)
                .len()
                .cmp(&dir_of(&a.path).len())
                .then(a.path.cmp(&b.path))
        });
        for c in chain {
            if let Some(r) = c.rules.iter().find(|r| r.rule == rule) {
                return Some(r);
            }
            if !c.inherits {
                return None;
            }
        }
        None
    }

    fn settings(&self, rule: &str, scope: &str) -> Vec<&'a drift_core::LintRule> {
        let tools: BTreeSet<&str> = self.lint.iter().map(|c| c.tool.as_str()).collect();
        tools
            .into_iter()
            .filter_map(|t| self.tool_setting(t, rule, scope))
            .collect()
    }

    /// What the linters say about `rule` (a tool-neutral name) for files under `scope`.
    pub fn lint_verdict(&self, rule: &str, scope: &str) -> LintVerdict {
        verdict(self.settings(rule, scope).iter().map(|r| r.level.as_str()))
    }

    /// What `no-restricted-imports` says about importing from `area` under `scope`:
    /// only settings whose options name the area or a workspace package in it count.
    pub fn import_restriction(&self, scope: &str, area: &str) -> LintVerdict {
        let names: Vec<&str> = self
            .packages_in_area(area)
            .iter()
            .map(|p| p.name.as_str())
            .filter(|n| !n.is_empty())
            .collect();
        let mentions = |o: &String| {
            names_path(o, area)
                || names
                    .iter()
                    .any(|n| o == n || o.starts_with(&format!("{n}/")))
        };
        verdict(
            self.settings("no-restricted-imports", scope)
                .iter()
                .filter(|r| r.options.iter().any(mentions))
                .map(|r| r.level.as_str()),
        )
    }

    /// The repo's linter forbids files under `from` (a repo area) to import from `to`
    /// (a repo area) as a whole: an `overrides` entry scoped to `from` or an ancestor
    /// of it sets `no-restricted-imports` with an option that names all of `to` (its
    /// workspace package `@x/to`, `@x/to/*` or `@x/to/**`, or the path `to`, `to/*` or
    /// `to/**`, a relative one read from the entry's directory). A restriction on a
    /// subpath (a deprecated module), one scoped to a part of `from`, or a setting for
    /// a whole config states no direction between the two areas.
    pub fn forbids_import(&self, from: &str, to: &str) -> bool {
        let mut whole: Vec<String> = Vec::new();
        let roots = self
            .packages
            .iter()
            .filter(|p| p.path == to && !p.name.is_empty())
            .map(|p| p.name.as_str())
            .chain(std::iter::once(to));
        for root in roots {
            whole.extend([root.to_string(), format!("{root}/*"), format!("{root}/**")]);
        }
        self.lint.iter().flat_map(|c| &c.scoped).any(|sc| {
            sc.dirs.iter().filter(|d| covers(d, from)).any(|d| {
                sc.rules.iter().flat_map(|r| &r.options).any(|o| {
                    let resolved = resolve_relative(d, o);
                    let o = resolved.as_deref().unwrap_or(o);
                    whole.iter().any(|w| w == o)
                })
            })
        })
    }

    /// Workspace packages (not the root) that make up or contain an area.
    fn packages_in_area(&self, area: &str) -> Vec<&'a PackageFacts> {
        self.packages
            .iter()
            .copied()
            .filter(|p| {
                !p.path.is_empty()
                    && (p.path == area
                        || p.path.starts_with(&format!("{area}/"))
                        || area.starts_with(&format!("{}/", p.path)))
            })
            .collect()
    }

    /// The workspace package that holds `from` (a repo area) declares, in its
    /// package.json, the workspace package that holds `to`: a declared layer edge.
    pub fn declares_area(&self, from: &str, to: &str) -> bool {
        self.packages
            .iter()
            .filter(|p| {
                !p.path.is_empty() && (from == p.path || from.starts_with(&format!("{}/", p.path)))
            })
            .max_by_key(|p| p.path.len())
            .is_some_and(|p| self.declares_module(&p.path, &format!("{to}/")))
    }

    /// The workspace package at `importer` declares, in its package.json, the workspace
    /// package that contains `module` (a repo path).
    pub fn declares_module(&self, importer: &str, module: &str) -> bool {
        self.declared
            .get(importer)
            .is_some_and(|deps| self.module_in(deps, importer, module))
    }

    /// The workspace package at `importer` declares the workspace package that
    /// contains `module` as a peer or optional dependency: one it may run without.
    pub fn declares_optional_module(&self, importer: &str, module: &str) -> bool {
        self.optional
            .get(importer)
            .is_some_and(|deps| self.module_in(deps, importer, module))
    }

    /// The deepest workspace package containing `module` (not `importer` itself) is
    /// named in `deps`.
    fn module_in(&self, deps: &BTreeSet<String>, importer: &str, module: &str) -> bool {
        let containing: Vec<&&PackageFacts> = self
            .packages
            .iter()
            .filter(|p| {
                !p.path.is_empty()
                    && module
                        .strip_prefix(p.path.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            })
            .collect();
        let Some(deepest) = containing.iter().map(|p| p.path.len()).max() else {
            return false;
        };
        containing.iter().any(|t| {
            t.path.len() == deepest
                && t.path != importer
                && !t.name.is_empty()
                && deps.contains(&t.name)
        })
    }
}

/// A class's attributes: name -> callees its declaration calls (empty when it calls none).
/// The callee sets are shared (`Arc`) by every class that inherits them.
type Attributes = BTreeMap<String, Arc<BTreeSet<String>>>;

/// `attr=callee` or `attr=` ([`drift_core::Symbol::declares`]) -> (`attr`, callee).
fn attribute_of(d: &str) -> (&str, Option<&str>) {
    match d.split_once('=') {
        Some((a, "")) => (a, None),
        Some((a, c)) => (a, Some(c)),
        None => (d, None),
    }
}

/// The attributes a class gets from its bases, in order: the first base that has an
/// attribute decides it (Python's method resolution order, simplified to depth-first).
fn inherited<'m>(
    bases: impl Iterator<Item = &'m Attributes>,
) -> BTreeMap<&'m str, &'m Arc<BTreeSet<String>>> {
    let mut out: BTreeMap<&str, &Arc<BTreeSet<String>>> = BTreeMap::new();
    for b in bases {
        for (a, c) in b {
            out.entry(a.as_str()).or_insert(c);
        }
    }
    out
}

/// Every class's attributes, own and inherited ([`Attributes`]). A class's own binding
/// of an attribute replaces what its bases declare for it.
fn attributes(repo: &RepoFacts) -> BTreeMap<String, Arc<Attributes>> {
    use drift_core::{SymbolKind, WrapKind};
    // Classes with declarations or in-repo bases: own attributes and bases, in order.
    let mut classes: BTreeMap<String, (Attributes, Vec<String>)> = BTreeMap::new();
    for f in repo.files.iter().chain(&repo.context_files) {
        for s in f.symbols.iter().filter(|s| s.kind == SymbolKind::Class) {
            let mut own: Attributes = BTreeMap::new();
            for d in &s.declares {
                let (a, c) = attribute_of(d);
                let e = own.entry(a.to_string()).or_default();
                if let Some(c) = c {
                    Arc::make_mut(e).insert(c.to_string());
                }
            }
            let bases: Vec<String> = s
                .wraps
                .iter()
                .filter(|w| w.kind == WrapKind::Extends)
                .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
                .collect();
            for name in std::iter::once(&s.name).chain(&s.exported_as) {
                classes
                    .entry(format!("{}#{name}", f.path))
                    .or_insert_with(|| (own.clone(), bases.clone()));
            }
        }
    }
    if classes.values().all(|(own, _)| own.is_empty()) {
        return BTreeMap::new();
    }
    // Resolved attributes are shared (`Arc`), not copied, by every class built on them.
    fn resolve(
        k: &str,
        classes: &BTreeMap<String, (Attributes, Vec<String>)>,
        memo: &mut BTreeMap<String, Arc<Attributes>>,
        visiting: &mut BTreeSet<String>,
    ) -> Arc<Attributes> {
        if let Some(m) = memo.get(k) {
            return m.clone();
        }
        let Some((own, bases)) = classes.get(k) else {
            return Arc::default();
        };
        // An import cycle between classes ends the walk.
        if !visiting.insert(k.to_string()) {
            return Arc::new(own.clone());
        }
        let resolved: Vec<Arc<Attributes>> = bases
            .iter()
            .map(|b| resolve(b, classes, memo, visiting))
            .collect();
        let mut all = own.clone();
        for (a, c) in inherited(resolved.iter().map(|r| &**r)) {
            all.entry(a.to_string()).or_insert_with(|| c.clone());
        }
        visiting.remove(k);
        let all = Arc::new(all);
        memo.insert(k.to_string(), all.clone());
        all
    }
    let mut memo = BTreeMap::new();
    let keys: Vec<String> = classes.keys().cloned().collect();
    for k in keys {
        resolve(&k, &classes, &mut memo, &mut BTreeSet::new());
    }
    memo
}

/// Files other than its own that must reference a team version: it is a shared helper
/// the team builds on (polar's `button`, used across the backoffice), not a function
/// that happens to share a name with what it calls.
const MIN_TEAM_VERSION_FILES: usize = 3;

/// Entry points and scripts are called by a framework, a scheduler or a person, not by
/// the team's code: an HTTP handler `get` that calls `pycountry.countries.get`, a
/// script's `run` that calls `subprocess.run`. Recorded entry points (routes, jobs,
/// cron), view classes, management commands, `__main__.py` and `manage.py`, and files
/// under `scripts/`, `bin/` or a hidden directory. (Not a whole `views/` package: Misago's
/// `admin/views/__init__.py#render` is the team's `render`.)
fn entry_or_script(f: &drift_core::FileFacts, s: &drift_core::Symbol) -> bool {
    let path = f.path.as_str();
    let file = path.rsplit('/').next().unwrap_or(path);
    let dirs: Vec<&str> = path.split('/').rev().skip(1).collect();
    f.entry_points
        .iter()
        .any(|e| e.symbol == s.name || s.exported_as.contains(&e.symbol))
        || s.traits.iter().any(|t| t == drift_core::traits::VIEW)
        || matches!(file, "__main__.py" | "manage.py")
        || dirs
            .iter()
            .any(|d| matches!(*d, "scripts" | "bin") || d.starts_with('.'))
        || path.contains("/management/commands/")
        || path.starts_with("management/commands/")
}

/// The library references a symbol stands in for, by its own name `N`: for a class,
/// the library classes named `N` it extends, directly or through in-repo bases
/// (`SubmitField(wtforms.SubmitField)`; not `Decimal(graphene.Float)`, whose methods
/// call `decimal.Decimal`); for a function, the library functions named `N` it calls,
/// when it passes them a parameter of its own ([`drift_core::traits::FORWARDS`]:
/// polar's `button(**kwargs)` calling `tag.button(**kwargs)`; not a `load()` that reads
/// one file with `json.load`).
fn stands_in_for(
    file: &str,
    s: &drift_core::Symbol,
    ancestors: &BTreeMap<String, Vec<String>>,
) -> Vec<String> {
    use drift_core::{SymbolKind, WrapKind};
    let named = |r: &str| {
        r.split_once('#').is_some_and(|(module, path)| {
            module.starts_with("pkg:")
                && !path.contains('(')
                && path.rsplit('.').next() == Some(s.name.as_str())
        })
    };
    let refs: Vec<String> = match s.kind {
        SymbolKind::Class => s
            .wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Extends)
            .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
            .chain(
                ancestors
                    .get(&format!("{file}#{}", s.name))
                    .into_iter()
                    .flatten()
                    .cloned(),
            )
            .collect(),
        SymbolKind::Function if s.traits.iter().any(|t| t == drift_core::traits::FORWARDS) => s
            .calls
            .iter()
            .map(|c| crate::mine::norm_ref(c).into_owned())
            .collect(),
        _ => vec![],
    };
    let mut out: Vec<String> = refs.into_iter().filter(|r| named(r)).collect();
    out.sort();
    out.dedup();
    out
}

/// [`RepoContext::team_version`]: a production Python class or function named `N` that
/// stands in for a library reference whose last name is `N` ([`stands_in_for`]), that
/// is no entry point or script ([`entry_or_script`]), and that production code in at
/// least [`MIN_TEAM_VERSION_FILES`] other files references. A library reference two
/// candidates claim is left out.
fn team_versions(
    repo: &RepoFacts,
    ancestors: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, String> {
    let production =
        |f: &&drift_core::FileFacts| f.lang == "py" && !crate::roles::is_test_path(&f.path);
    // The production files that reference each in-repo id.
    let mut referenced_from: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
    for f in repo.files.iter().filter(production) {
        for s in &f.symbols {
            for r in s
                .wraps
                .iter()
                .map(|w| w.wrapper.as_str())
                .chain(s.calls.iter().map(String::as_str))
            {
                let r = r.strip_suffix("(ref)").unwrap_or(r);
                if !r.starts_with("pkg:") {
                    referenced_from
                        .entry(r.to_string())
                        .or_default()
                        .insert(f.path.as_str());
                }
            }
        }
    }
    let mut claims: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for f in repo.files.iter().filter(production) {
        for s in &f.symbols {
            if !matches!(
                s.kind,
                drift_core::SymbolKind::Class | drift_core::SymbolKind::Function
            ) || entry_or_script(f, s)
            {
                continue;
            }
            let library = stands_in_for(&f.path, s, ancestors);
            if library.is_empty() {
                continue;
            }
            let team = format!("{}#{}", f.path, s.name);
            let files: BTreeSet<&str> = std::iter::once(team.clone())
                .chain(s.exported_as.iter().map(|e| format!("{}#{e}", f.path)))
                .filter_map(|id| referenced_from.get(&id))
                .flatten()
                .copied()
                .filter(|p| *p != f.path)
                .collect();
            if files.len() < MIN_TEAM_VERSION_FILES {
                continue;
            }
            for r in library {
                claims.entry(r).or_default().insert(team.clone());
            }
        }
    }
    let mut out = BTreeMap::new();
    for (library, teams) in claims {
        if let [team] = teams.into_iter().collect::<Vec<_>>().as_slice() {
            out.insert(team.clone(), team.clone());
            out.insert(library, team.clone());
        }
    }
    out
}

/// Transitive bases of every class of the repo (and of the context files of a
/// single-file scan): `class X(TransactionRepository)` extends `RepositoryBase` when
/// `TransactionRepository` does. Keys are the class's
/// `path#name` and `path#<exported name>`; values are normalised refs, sorted.
/// The kind a file's dotted suffix names (`x.service.ts` -> `service`).
pub fn suffix_kind(path: &str) -> Option<String> {
    let file = path.rsplit('/').next().unwrap_or(path);
    let parts: Vec<&str> = file.split('.').collect();
    (parts.len() >= 3)
        .then(|| crate::mine::kind_of_word(parts[parts.len() - 2]))
        .filter(|k| !k.is_empty())
}

/// The kind a file's folder names (`services/` -> `service`); `None` for folders that
/// name no kind (source roots, `api`, `utils`, version folders).
pub fn dir_kind(path: &str) -> Option<String> {
    let mut segs = path.rsplit('/');
    segs.next()?;
    let dir = segs.next()?;
    let k = crate::mine::kind_of_word(dir);
    (!k.is_empty() && !NO_KIND_DIRS.contains(&k.as_str()) && !k.chars().any(|c| c.is_ascii_digit()))
        .then_some(k)
}

/// Folder names that hold code of any kind.
const NO_KIND_DIRS: &[&str] = &[
    "src", "lib", "libs", "app", "apps", "package", "source", "api", "util", "utility", "common",
    "core", "shared", "internal",
];

/// `target` (package-normalised) is a function of these facts that files its argument
/// in a registry and hands it back unchanged ([`drift_core::controls::REGISTERS_ARG`]),
/// and nothing in its name says who may pass (the refuse vocabulary:
/// [`crate::vocab::refuse::guard_shaped`], [`crate::vocab::refuse::part_guard_shaped`]). A
/// package decorator, whose definition the facts lack, never is one.
fn registry_function(symbols: &BTreeMap<String, &drift_core::Symbol>, target: &str) -> bool {
    symbols.get(target).is_some_and(|s| {
        s.kind == drift_core::SymbolKind::Function
            && s.controls
                .iter()
                .any(|c| c == drift_core::controls::REGISTERS_ARG)
    }) && !crate::vocab::refuse::guard_shaped(target)
        && !crate::vocab::refuse::part_guard_shaped(target)
}

/// The class (`path#Name`) a handler reaches directly when it makes this call, if the
/// callee is a class, and whether the handler runs it: it constructs it (`new X()`,
/// Python's `X()`) or calls a method on an instance it just made (`new X().handle()`,
/// Python's `X().handle()`). A static or class method call (`X.find()`,
/// `Choices.values()`) reaches the class without running it as the route's handler.
/// Only one step: `Order.objects.filter()` reaches a manager, not the class, and a call
/// through a module-level instance or another function is not followed. A reference
/// (`X.handle(ref)`, the class or its method passed as the handler) is not a call: the
/// by-reference pass reads it ([`ref_target`]), and the handler runs that class.
fn class_run_by(callee: &str) -> Option<(String, bool)> {
    if callee.ends_with("(ref)") {
        return None;
    }
    let (module, rest) = callee.split_once('#')?;
    let rest = rest.strip_suffix("(new)").unwrap_or(rest);
    let (head, tail) = rest.split_at(rest.find(['.', '(']).unwrap_or(rest.len()));
    let (tail, instance) = match tail.strip_prefix("()") {
        Some(t) => (t, true),
        None => (tail, tail.is_empty()),
    };
    let direct = tail.is_empty()
        || tail
            .strip_prefix('.')
            .is_some_and(|m| !m.is_empty() && !m.contains(['.', '(']));
    (!head.is_empty() && direct).then(|| (format!("{module}#{head}"), instance))
}

/// The class an entry point is a method of: `PostView` for Python's `PostView.get`, and
/// for a Nest route (its own symbol, `POST /stripe/purge`) the class declared last before
/// it in the file, which holds the handler.
fn route_owner<'f>(
    f: &'f drift_core::FileFacts,
    e: &drift_core::EntryPoint,
) -> Option<&'f drift_core::Symbol> {
    let classes = || {
        f.symbols
            .iter()
            .filter(|s| s.kind == drift_core::SymbolKind::Class)
    };
    if let Some((class, _)) = e.symbol.split_once('.')
        && let Some(c) = classes().find(|c| c.name == class)
    {
        return Some(c);
    }
    if e.adapter != "nestjs" {
        return None;
    }
    let line = f
        .symbols
        .iter()
        .find(|s| s.name == e.symbol || s.exported_as.contains(&e.symbol))?
        .line;
    classes().filter(|c| c.line <= line).max_by_key(|c| c.line)
}

/// What a route's by-reference handler (`path#handler`, `path#ctrl.list`,
/// `path#Controller.list`) is: a class whose method it is, directly or through an
/// instance the module builds (`export const ctrl = new ProjectsController()`), or
/// another unit (a function). For a member of an object (`export default { list }`,
/// `const ctrl = { create, remove }`), the object itself and every function its
/// properties refer to (`drift-ts` records them as `(ref)` calls of the object): which
/// property the route names is not in the facts, and taking them all only refuses more
/// exemptions. Keys are `path#name`.
enum RefTarget<'a> {
    Class(String, &'a drift_core::Symbol),
    Unit(String, &'a drift_core::Symbol),
}

fn ref_target<'a>(
    symbols: &BTreeMap<String, &'a drift_core::Symbol>,
    r: &str,
) -> Vec<RefTarget<'a>> {
    let mut out = Vec::new();
    ref_targets(symbols, r, 0, &mut out);
    out
}

fn ref_targets<'a>(
    symbols: &BTreeMap<String, &'a drift_core::Symbol>,
    r: &str,
    depth: usize,
    out: &mut Vec<RefTarget<'a>>,
) {
    use drift_core::SymbolKind;
    // A call's result (`makeHandler()`) is not a reference to a unit.
    if r.contains('(') || depth > 1 {
        return;
    }
    let Some((module, rest)) = r.split_once('#') else {
        return;
    };
    let (binding, member) = match rest.split_once('.') {
        Some((b, m)) => (b, Some(m)),
        None => (rest, None),
    };
    let Some(&s) = symbols.get(&format!("{module}#{binding}")) else {
        return;
    };
    let key = |module: &str, s: &drift_core::Symbol| format!("{module}#{}", s.name);
    if s.kind == SymbolKind::Class {
        out.push(RefTarget::Class(key(module, s), s));
        return;
    }
    out.push(RefTarget::Unit(key(module, s), s));
    if member.is_none() {
        return;
    }
    for c in &s.calls {
        if let Some(c) = c.strip_suffix("(new)") {
            // A method of an instance: every in-repo class its binding constructs.
            let c = crate::mine::norm_ref(c);
            if let Some((m, _)) = c.split_once('#')
                && let Some(&class) = symbols.get(c.as_ref())
                && class.kind == SymbolKind::Class
            {
                out.push(RefTarget::Class(key(m, class), class));
            }
        } else if let Some(c) = c.strip_suffix("(ref)") {
            // A property of an object of handlers.
            ref_targets(symbols, &crate::mine::norm_ref(c), depth + 1, out);
        }
    }
}

/// In-repo callees that guard the entry points calling them, read from those calls
/// ([`RepoContext::called_as_guard`]): entry points ([`RepoContext::is_entry_unit`])
/// call the callee directly, not by reference or as a constructor, in
/// [`ENTRY_CALLERS`] distinct units or more, and its definition can turn the caller
/// away: its body throws (a `throw` control or a thrown class). A class (a constructor
/// called without `new`, Python's `Form(...)`) is not one. (A callee whose name opens
/// access, `optionalUser()`, is still no guard: [`crate::security::callee_is_guard`]
/// vetoes it.) Production files only;
/// deterministic (sorted sets, no thresholds on ratios).
fn entry_checks(
    repo: &RepoFacts,
    symbols: &BTreeMap<String, &drift_core::Symbol>,
    entry_classes: &BTreeSet<String>,
    ref_entries: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut callers: BTreeMap<String, BTreeSet<(&str, &str)>> = BTreeMap::new();
    for f in repo
        .files
        .iter()
        .filter(|f| !crate::roles::is_test_path(&f.path))
    {
        for s in &f.symbols {
            let key = format!("{}#{}", f.path, s.name);
            let entry = f
                .entry_points
                .iter()
                .any(|e| e.symbol == s.name || s.exported_as.contains(&e.symbol))
                || entry_classes.contains(&key)
                || ref_entries.contains(&key);
            if !entry {
                continue;
            }
            for c in &s.calls {
                if c.ends_with("(ref)") || c.ends_with("(new)") {
                    continue;
                }
                callers
                    .entry(crate::mine::norm_ref(c).into_owned())
                    .or_default()
                    .insert((f.path.as_str(), s.name.as_str()));
            }
        }
    }
    callers
        .into_iter()
        .filter(|(callee, by)| {
            by.len() >= ENTRY_CALLERS
                && symbols.get(callee).is_some_and(|d| {
                    d.kind != drift_core::SymbolKind::Class
                        && (d.controls.iter().any(|c| c == "throw") || !d.throws.is_empty())
                })
        })
        .map(|(callee, _)| callee)
        .collect()
}

fn lineage_of(
    class: &drift_core::Symbol,
    ancestors: &BTreeMap<String, Vec<String>>,
) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for w in class
        .wraps
        .iter()
        .filter(|w| w.kind == drift_core::WrapKind::Extends)
    {
        let b = crate::mine::norm_ref(&w.wrapper).into_owned();
        out.extend(ancestors.get(&b).into_iter().flatten().cloned());
        out.insert(b);
    }
    out
}

fn ancestors(repo: &RepoFacts) -> BTreeMap<String, Vec<String>> {
    use drift_core::{SymbolKind, WrapKind};
    let mut direct: BTreeMap<String, Vec<String>> = BTreeMap::new();
    // A single-file scan carries the files of the in-repo bases as context.
    for f in repo.files.iter().chain(&repo.context_files) {
        for s in f.symbols.iter().filter(|s| s.kind == SymbolKind::Class) {
            let bases: Vec<String> = s
                .wraps
                .iter()
                .filter(|w| w.kind == WrapKind::Extends)
                .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
                .collect();
            if bases.is_empty() {
                continue;
            }
            for name in std::iter::once(&s.name).chain(&s.exported_as) {
                direct
                    .entry(format!("{}#{name}", f.path))
                    .or_insert_with(|| bases.clone());
            }
        }
    }
    let mut out = BTreeMap::new();
    for class in direct.keys() {
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut stack: Vec<&str> = vec![class.as_str()];
        while let Some(c) = stack.pop() {
            for b in direct.get(c).into_iter().flatten() {
                if b != class && seen.insert(b.clone()) {
                    stack.push(b);
                }
            }
        }
        out.insert(class.clone(), seen.into_iter().collect());
    }
    out
}

/// `../features/**` read from `packages/app-store` -> `packages/features/**`; `None`
/// for an option that is not a relative path or climbs above the repo.
fn resolve_relative(dir: &str, option: &str) -> Option<String> {
    if !option.starts_with("./") && !option.starts_with("../") {
        return None;
    }
    let mut out: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in option.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                out.pop()?;
            }
            s => out.push(s),
        }
    }
    Some(out.join("/"))
}

/// `path` (a restricted import path or pattern) names `area` on segment boundaries:
/// `packages/ui`, `../packages/ui/x` and `@/packages/ui/**` name `packages/ui`;
/// `packages/ui-kit` does not, and `next/dist/client` does not name the area `client`.
fn names_path(path: &str, area: &str) -> bool {
    let p: Vec<&str> = path.split('/').collect();
    let a: Vec<&str> = area.split('/').collect();
    !a.is_empty() && p.windows(a.len()).any(|w| w == a.as_slice()) && {
        // A single-segment area must be the start of the path (after relative or
        // alias prefixes), not any segment of a package subpath.
        a.len() > 1
            || p.iter()
                .find(|s| !matches!(**s, "" | "." | ".." | "@" | "~"))
                .is_some_and(|s| *s == a[0])
    }
}

fn verdict<'l>(levels: impl Iterator<Item = &'l str>) -> LintVerdict {
    levels
        .map(|l| match l {
            "error" => LintVerdict::Enforced,
            "off" => LintVerdict::Disabled,
            "warn" => LintVerdict::Warned,
            _ => LintVerdict::Silent,
        })
        .max()
        .unwrap_or(LintVerdict::Silent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::LintRule;

    /// Of two symbols of one name, the definition is the one with more facts as the
    /// measured build counted them: a control the lowering added since for the
    /// practice map alone (`scope_unread`, `unread_exit`) does not make the other one
    /// the definition mining reads (review 5, finding 8).
    #[test]
    fn controls_recorded_for_the_practice_map_alone_do_not_choose_the_definition() {
        use drift_core::{FileFacts, Symbol, controls};
        let repo = RepoFacts {
            files: vec![FileFacts {
                path: "app/views.py".into(),
                lang: "py".into(),
                symbols: vec![
                    Symbol {
                        name: "items".into(),
                        line: 1,
                        calls: vec!["app/db.py#rows".into()],
                        controls: vec![
                            controls::SCOPE_UNREAD.into(),
                            controls::UNREAD_EXIT.into(),
                            controls::UNREAD_CALL.into(),
                            controls::LATE_BOUND.into(),
                        ],
                        ..Symbol::default()
                    },
                    Symbol {
                        name: "items".into(),
                        line: 9,
                        calls: vec!["app/db.py#rows".into(), "app/db.py#scope".into()],
                        ..Symbol::default()
                    },
                ],
                ..FileFacts::default()
            }],
            ..RepoFacts::default()
        };
        let ctx = RepoContext::new(&repo, &[]);
        assert_eq!(
            ctx.definition("app/views.py#items").map(|s| s.line),
            Some(9)
        );
    }

    /// [`RepoContext::passes_key`] answers from keys read once: the same answers as
    /// reading every symbol's arguments for each question, as it did.
    #[test]
    fn passes_key_answers_as_a_read_of_every_argument_would() {
        use drift_core::{FileFacts, Symbol};
        let args = [
            "pkg:fastapi/security#HTTPBearer@0:auto_error",
            "pkg:fastapi#security.APIKeyHeader@99:**",
            "app/auth.py#Bearer@1:auto_error",
            "app/auth.py#make@0:scheme:name",
            "pkg:@scope/lib/deep#guard@2:strict",
            "no_position:auto_error",
            "app/auth.py#bare@0",
            "",
        ];
        let repo = RepoFacts {
            files: vec![FileFacts {
                path: "app/main.py".into(),
                lang: "py".into(),
                symbols: args
                    .chunks(3)
                    .enumerate()
                    .map(|(i, a)| Symbol {
                        name: format!("f{i}"),
                        args: a.iter().map(|a| a.to_string()).collect(),
                        ..Symbol::default()
                    })
                    .collect(),
                ..FileFacts::default()
            }],
            ..RepoFacts::default()
        };
        let ctx = RepoContext::new(&repo, &[]);
        let read = |callee: &str, key: &str| {
            let want = crate::mine::norm_ref(callee.trim_end_matches("(new)"));
            ctx.symbols.values().any(|s| {
                s.args.iter().any(|a| {
                    a.rsplit_once(':').is_some_and(|(at, k)| {
                        k == key
                            && at
                                .rsplit_once('@')
                                .is_some_and(|(c, _)| crate::mine::norm_ref(c) == want)
                    })
                })
            })
        };
        let callees = [
            "pkg:fastapi#HTTPBearer",
            "pkg:fastapi/security#HTTPBearer",
            "pkg:fastapi#HTTPBearer(new)",
            "pkg:fastapi#security.APIKeyHeader",
            "app/auth.py#Bearer",
            "app/auth.py#Bearer(new)",
            "app/auth.py#make",
            "app/auth.py#make@0:scheme",
            "pkg:@scope/lib#guard",
            "pkg:@scope/lib/other#guard",
            "app/auth.py#bare",
            "no_position",
            "",
        ];
        let keys = ["auto_error", "**", "name", "scheme:name", "strict", "", "0"];
        let mut yes = 0;
        for c in callees {
            for k in keys {
                assert_eq!(ctx.passes_key(c, k), read(c, k), "{c} {k}");
                yes += usize::from(read(c, k));
            }
        }
        assert_eq!(yes, 9);
    }

    /// A same-name function is a team version only when production code in three
    /// other files references it (`polar/worker/sqs.py#run` calling `asyncio.run`, which
    /// only the worker's entry module calls, is none).
    #[test]
    fn a_team_version_is_referenced_from_three_other_files() {
        use drift_core::{FileFacts, Symbol, SymbolKind};
        let f = |path: &str, name: &str, calls: &[&str]| FileFacts {
            path: path.into(),
            lang: "py".into(),
            symbols: vec![Symbol {
                name: name.into(),
                kind: SymbolKind::Function,
                exported_as: vec![name.into()],
                calls: calls.iter().map(|c| c.to_string()).collect(),
                traits: vec![drift_core::traits::FORWARDS.into()],
                ..Symbol::default()
            }],
            ..FileFacts::default()
        };
        let repo = |callers: usize| RepoFacts {
            files: std::iter::once(f("app/worker/sqs.py", "run", &["pkg:python:asyncio#run"]))
                .chain((0..callers).map(|i| {
                    f(
                        &format!("app/c{i}.py"),
                        &format!("c{i}"),
                        &["app/worker/sqs.py#run"],
                    )
                }))
                // Tests do not count.
                .chain(std::iter::once(f(
                    "tests/test_sqs.py",
                    "test_run",
                    &["app/worker/sqs.py#run"],
                )))
                .collect(),
            ..RepoFacts::default()
        };
        let two = repo(2);
        assert!(team_versions(&two, &ancestors(&two)).is_empty());
        let three = repo(3);
        let three = team_versions(&three, &ancestors(&three));
        assert_eq!(
            three.get("pkg:python:asyncio#run").map(String::as_str),
            Some("app/worker/sqs.py#run")
        );
    }

    fn cfg(path: &str, tool: &str, inherits: bool, rules: &[(&str, &str)]) -> LintConfig {
        LintConfig {
            path: path.into(),
            tool: tool.into(),
            inherits,
            rules: rules
                .iter()
                .map(|(r, l)| LintRule {
                    rule: (*r).into(),
                    level: (*l).into(),
                    options: vec![],
                })
                .collect(),
            scoped: vec![],
        }
    }

    #[test]
    fn a_directory_with_two_manifests_declares_what_either_declares() {
        let pkg = |path: &str, name: &str, manifest: &str, deps: &[&str]| PackageFacts {
            path: path.into(),
            name: name.into(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            manifest: manifest.into(),
            ..Default::default()
        };
        let repo = RepoFacts {
            packages: vec![
                pkg("svc", "svc-web", "", &["@acme/ui@*"]),
                pkg("svc", "svc", "svc/pyproject.toml", &["acme-core@>=1"]),
                pkg("libs/core", "acme-core", "libs/core/pyproject.toml", &[]),
                pkg("packages/ui", "@acme/ui", "", &[]),
            ],
            ..Default::default()
        };
        let ctx = RepoContext::new(&repo, &[]);
        assert!(ctx.declares_module("svc", "libs/core/acme_core/models.py"));
        assert!(ctx.declares_module("svc", "packages/ui/src/button.tsx"));
        assert!(!ctx.declares_module("libs/core", "packages/ui/src/button.tsx"));
    }

    /// A workspace package contains a module only on a path-segment boundary:
    /// `packages/ui` holds `packages/ui/src/x.ts`, not `packages/ui-kit/src/x.ts`.
    #[test]
    fn a_package_contains_modules_on_segment_boundaries() {
        let pkg = |path: &str, name: &str, deps: &[&str]| PackageFacts {
            path: path.into(),
            name: name.into(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            ..Default::default()
        };
        let repo = RepoFacts {
            packages: vec![
                pkg("apps/web", "web", &["@acme/ui@*"]),
                pkg("packages/ui", "@acme/ui", &[]),
                pkg("packages/ui-kit", "@acme/ui-kit", &[]),
            ],
            ..Default::default()
        };
        let ctx = RepoContext::new(&repo, &[]);
        assert!(ctx.declares_module("apps/web", "packages/ui/src/button.tsx"));
        assert!(!ctx.declares_module("apps/web", "packages/ui-kit/src/button.tsx"));
        assert!(!ctx.declares_module("apps/web", "packages/ui"));
    }

    #[test]
    fn restricted_paths_name_areas_on_segment_boundaries() {
        assert!(names_path("packages/ui", "packages/ui"));
        assert!(names_path("../../packages/ui/src", "packages/ui"));
        assert!(names_path("client/**", "client"));
        assert!(!names_path("next/dist/client", "client"));
        assert!(!names_path("packages/ui-kit", "packages/ui"));
        assert!(!names_path("src/clients", "client"));
    }

    #[test]
    fn nearest_config_decides_unless_it_inherits() {
        let repo = RepoFacts {
            lint: vec![
                cfg(
                    ".oxlintrc.json",
                    "oxlint",
                    false,
                    &[("no-explicit-any", "off")],
                ),
                cfg("web/.oxlintrc.json", "oxlint", false, &[]),
                cfg("api/.eslintrc.json", "eslint", true, &[]),
                cfg(".eslintrc.json", "eslint", false, &[("no-console", "warn")]),
            ],
            ..Default::default()
        };
        let ctx = RepoContext::new(&repo, &[]);
        assert_eq!(
            ctx.lint_verdict("no-explicit-any", "server/src"),
            LintVerdict::Disabled
        );
        // web has its own oxlint config that does not set it.
        assert_eq!(
            ctx.lint_verdict("no-explicit-any", "web/src"),
            LintVerdict::Silent
        );
        // api's legacy eslintrc cascades to the root one.
        assert_eq!(
            ctx.lint_verdict("no-console", "api/src"),
            LintVerdict::Warned
        );
        assert!(!LintVerdict::Warned.decides());
        assert!(!LintVerdict::Disabled.decides());
        assert!(LintVerdict::Enforced.decides());
    }
}

/// The classes one class decorator decorates, and the key each one is registered
/// under: the reference the decorator is called with (`@register_type(Site)`, from
/// [`drift_core::Symbol::decorator_args`]), or else the class's own `Meta.model`
/// (`@register_filterset` reads `filterset._meta.model`).
#[derive(Debug, Clone, Default)]
struct Registrations {
    /// Production classes it decorates (abstract ones left out).
    classes: usize,
    /// Key -> the classes registered under it (`path#name`), sorted.
    keys: BTreeMap<String, Vec<String>>,
}

impl Registrations {
    /// The decorator files classes in a registry keyed by what it registers: at least
    /// two classes, nearly all of them (90%) with a key, and no key held twice. A
    /// second class registered under a held key would replace the first, so a class
    /// that leaves the decorator off for a held key does so on purpose. A decorator
    /// whose classes share keys, or mostly have none, is not such a registry.
    fn keyed(&self) -> bool {
        let keyed: usize = self.keys.values().map(Vec::len).sum();
        self.classes >= 2
            && keyed * 10 >= self.classes * 9
            && self.keys.values().all(|holders| holders.len() == 1)
    }
}

/// `Meta.model` of a class ([`drift_core::Symbol::meta`]).
fn meta_model(class: &drift_core::Symbol) -> Option<&str> {
    class.meta.iter().find_map(|m| m.strip_prefix("model="))
}

/// Files of production code: not tests or fixtures, not examples, samples, demos or
/// integration-test suites ([`crate::roles::NonProduction`]).
fn production_files(repo: &RepoFacts) -> impl Iterator<Item = &drift_core::FileFacts> {
    let non_production = crate::roles::NonProduction::learn(repo);
    repo.files.iter().filter(move |f| {
        !crate::roles::is_test_path(&f.path) && !non_production.contains(&f.path, &f.package)
    })
}

/// What wraps the entry points of production code ([`RepoContext::wraps_entry_point`]).
fn entry_wrappers(repo: &RepoFacts) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for f in production_files(repo) {
        for s in f
            .symbols
            .iter()
            .filter(|s| f.entry_points.iter().any(|e| e.symbol == s.name))
        {
            for w in s
                .wraps
                .iter()
                .filter(|w| w.kind != drift_core::WrapKind::Try)
            {
                out.insert(crate::mine::norm_ref(&w.wrapper).into_owned());
            }
        }
    }
    out
}

/// What every class decorator of the repo's production code registers
/// ([`Registrations`]).
fn registrations(repo: &RepoFacts) -> BTreeMap<String, Registrations> {
    use drift_core::{SymbolKind, WrapKind};
    let mut out: BTreeMap<String, Registrations> = BTreeMap::new();
    for f in production_files(repo) {
        for c in f
            .symbols
            .iter()
            .filter(|s| s.kind == SymbolKind::Class && !s.meta.iter().any(|m| m == "abstract"))
        {
            let mut seen = BTreeSet::new();
            for w in c.wraps.iter().filter(|w| w.kind == WrapKind::Decorator) {
                let d = crate::mine::norm_ref(&w.wrapper).into_owned();
                if !seen.insert(d.clone()) {
                    continue;
                }
                let key = c
                    .decorator_args
                    .iter()
                    .find_map(|a| {
                        a.split_once('=')
                            .filter(|(x, _)| crate::mine::norm_ref(x) == d.as_str())
                            .map(|(_, k)| k)
                    })
                    .or_else(|| meta_model(c));
                let r = out.entry(d).or_default();
                r.classes += 1;
                if let Some(k) = key {
                    r.keys
                        .entry(k.to_string())
                        .or_default()
                        .push(format!("{}#{}", f.path, c.name));
                }
            }
        }
    }
    for r in out.values_mut() {
        for h in r.keys.values_mut() {
            h.sort();
        }
    }
    out
}
