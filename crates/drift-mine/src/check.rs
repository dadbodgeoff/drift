//! `drift check`: evaluate accepted conventions against the current code.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{RepoFacts, SymbolKind};
use serde::Serialize;

use crate::context::RepoContext;
use crate::mine::{MIN_BLOCK_ROLE_SIZE, Rule};
use crate::policy::{Convention, ConventionsFile, Lock, Mode, Status};
use crate::roles::{Legacy, Unit, View, units_before};
use crate::tier::Tier;
use crate::unchecked::Unchecked;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Violation {
    pub id: String,
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// Human rule text, e.g. "HTTP handlers in app/api/** are wrapped in withAuth()".
    pub summary: String,
    /// `holders/total` evidence, e.g. "40/43".
    pub evidence: String,
    pub example: String,
    pub mode: String,
    /// Confidence tier of the convention (computed from its rule, never stored).
    pub tier: Tier,
    /// True when recorded in `drift.lock` (legacy): never blocks.
    pub baselined: bool,
    /// True when a `drift-ignore` comment with a reason covers it: never blocks, always listed.
    #[serde(default)]
    pub suppressed: bool,
    /// True when its file depends on a file that was not parsed for lack of stack
    /// ([`crate::unchecked`]): the verdict may change once that file's facts are
    /// known. Listed, never new and never blocking. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unsure: bool,
    /// True when the neighbour gate held the warning back ([`crate::neighbour`]): the
    /// member is nearer the members its convention sets apart than the ones that hold it.
    /// Listed (here and in [`CheckReport::suppressed_neighbour`]), never new, never
    /// blocking. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub suppressed_neighbour: bool,
    /// The lines the unit spans in its file, for diff-scoped checks (`--diff-base`). Not serialised.
    #[serde(skip)]
    pub extent: Extent,
    /// Wiring rules only: where to register the symbol (or mirror the key), and a
    /// sibling already there. Not serialised when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire: Option<WireHint>,
    /// Layering rules only: the import that breaks the rule. Not serialised when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import: Option<ImportHit>,
    /// Promoted practices only ([`crate::practices::promote`]): the concern the unit
    /// breaks, so every text that lists the violation can say what to do ("handle
    /// sign-in the way ... does") without the policy at hand. Not serialised.
    #[serde(skip)]
    pub practice: Option<String>,
}

/// The import a layering violation is about ([`Violation::import`]): its module, and
/// once [`locate_imports`] read the file, the specifier as written and its line.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
pub struct ImportHit {
    /// Canonical module id (`app/board/board-context.ts`).
    pub module: String,
    /// The specifier as written (`@/app/board/board-context`); empty when not found.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub specifier: String,
    /// 1-based line of the import; 0 when not found.
    #[serde(default)]
    pub line: u32,
}

impl ImportHit {
    /// `` imports `@/app/board/board-context` `` (or the module when the specifier was
    /// not found).
    pub fn describe(&self) -> String {
        if self.specifier.is_empty() {
            format!("imports {}", self.module)
        } else {
            format!("imports `{}`", self.specifier)
        }
    }
}

/// Fill each layering violation's specifier and line from its file under `root`, and
/// point the violation at that line. Best effort: a file that cannot be read, or an
/// import not found in it, keeps the module only.
pub fn locate_imports(report: &mut CheckReport, root: &std::path::Path) {
    let mut texts: BTreeMap<String, Option<String>> = BTreeMap::new();
    for v in &mut report.violations {
        let Some(hit) = v.import.as_mut() else {
            continue;
        };
        let text = texts
            .entry(v.path.clone())
            .or_insert_with(|| std::fs::read_to_string(root.join(&v.path)).ok());
        if let Some((line, spec)) = text
            .as_deref()
            .and_then(|t| find_import(t, &v.path, &hit.module))
        {
            hit.line = line;
            hit.specifier = spec;
            v.line = line;
        }
    }
}

/// The first line of `text` (a file at `from`) with a quoted import specifier that
/// names `module`: a relative one resolved against `from`'s folder, or an aliased or
/// bare one (`@/x/y`, `~/x/y`, `src/x/y`) whose path is the end of the module's
/// (extension and `/index` ignored).
pub fn find_import(text: &str, from: &str, module: &str) -> Option<(u32, String)> {
    let strip = |m: &str| -> String {
        let m = m
            .rsplit_once('.')
            .filter(|(_, e)| !e.contains('/'))
            .map_or(m, |(s, _)| s);
        m.strip_suffix("/index").unwrap_or(m).to_string()
    };
    let target = strip(module);
    let dir = from.rsplit_once('/').map_or("", |(d, _)| d);
    let names = |spec: &str| -> bool {
        if spec.starts_with("./") || spec.starts_with("../") {
            let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
            for seg in spec.split('/') {
                match seg {
                    "." | "" => {}
                    ".." => {
                        parts.pop();
                    }
                    s => parts.push(s),
                }
            }
            return strip(&parts.join("/")) == target;
        }
        let bare = spec
            .strip_prefix("@/")
            .or_else(|| spec.strip_prefix("~/"))
            .or_else(|| spec.strip_prefix('#'))
            .unwrap_or(spec);
        let bare = strip(bare.trim_end_matches('/'));
        !bare.is_empty() && (target == bare || target.ends_with(&format!("/{bare}")))
    };
    for (n, line) in text.lines().enumerate() {
        if !(line.contains("import") || line.contains("from") || line.contains("require")) {
            continue;
        }
        for quote in ['"', '\''] {
            let mut rest = line;
            while let Some((_, after)) = rest.split_once(quote) {
                let Some((spec, tail)) = after.split_once(quote) else {
                    break;
                };
                if names(spec) {
                    return Some((n as u32 + 1, spec.to_string()));
                }
                rest = tail;
            }
        }
    }
    None
}

impl Violation {
    /// Whether this violation, if new, fails `drift check`: in block mode, or any
    /// with `--strict` except wiring advice (experimental wiring rules only advise,
    /// under `--strict` too).
    pub fn fails(&self, strict: bool) -> bool {
        self.mode == "block" || (strict && self.wire.is_none())
    }
}

/// Where a wiring fix goes ([`Violation::wire`], `census --json` `wiring.registry`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
pub struct WireHint {
    /// `register`: add the symbol to a registry. `import_module`: the symbol is
    /// provided only by a module nothing imports (`like`): import that module from
    /// a reachable one (`path`). `reexport_module`: add a star
    /// re-export of the symbol's module to a barrel of them (`export * from "./x"`,
    /// `from .x import *`). `mirror`: add the key to another file.
    pub action: String,
    /// The file to edit.
    pub path: String,
    /// 1-based line where the list starts (or of the file's first key); 0 when
    /// unknown (a barrel's re-exports).
    pub line: u32,
    /// What to add to, for people: `Module() providers`, `` `urlpatterns` ``,
    /// `re-exports`, `keys`.
    pub label: String,
    /// A sibling already there, and the line it is listed at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub like: Option<WireLike>,
    /// In a violation: what is missing (the symbol or key, and the file declaring it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<WireEntry>,
}

/// A registered sibling ([`WireHint::like`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
pub struct WireLike {
    /// Its name (symbol or key).
    pub name: String,
    /// Line of its registration in the registry (0 when unknown: a barrel).
    pub line: u32,
    /// File that declares it (for a key: the file it is mirrored to).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
}

/// The missing entry of a wiring violation ([`WireHint::entry`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
pub struct WireEntry {
    pub symbol: String,
    pub path: String,
    pub line: u32,
}

impl WireHint {
    /// One line for people and agents: `add BillingService to Module() providers in
    /// src/app.module.ts:8 (like UsersService, line 9)`, or for a barrel of star
    /// re-exports `` add `export * from "./refunds"` to src/index.ts (like `export *
    /// from "./users"`) ``.
    pub fn describe(&self, what: &str) -> String {
        let at = if self.line > 0 {
            format!("{}:{}", self.path, self.line)
        } else {
            self.path.clone()
        };
        if self.action == crate::wiring::IMPORT_MODULE
            && let Some(l) = &self.like
        {
            return format!(
                "import {} ({}:{}) from a reachable module, such as the one in {at}: it provides {what}, but nothing imports it",
                l.name, l.path, l.line
            );
        }
        if self.action == crate::wiring::REEXPORT_MODULE
            && let Some(e) = &self.entry
        {
            let like = match &self.like {
                Some(l) if !l.path.is_empty() => {
                    format!(" (like `{}`)", star_line(&self.path, &l.path))
                }
                _ => String::new(),
            };
            return format!("add `{}` to {at}{like}", star_line(&self.path, &e.path));
        }
        let like = match &self.like {
            Some(l) if l.line > 0 => format!(" (like {}, line {})", l.name, l.line),
            Some(l) => format!(" (like {})", l.name),
            None => String::new(),
        };
        format!("add {what} to {} in {at}{like}", self.label)
    }
}

/// The star re-export of `module` in the barrel `barrel`: `export * from "./x"`
/// (TypeScript), `from .x import *` (Python).
fn star_line(barrel: &str, module: &str) -> String {
    let dir: Vec<&str> = barrel
        .rsplit_once('/')
        .map_or(vec![], |(d, _)| d.split('/').collect());
    let target: Vec<&str> = module.split('/').collect();
    let common = dir.iter().zip(&target).take_while(|(a, b)| a == b).count();
    let up = dir.len() - common;
    let mut rest: Vec<String> = target[common..].iter().map(|s| s.to_string()).collect();
    let py = barrel.ends_with(".py");
    if let Some(last) = rest.last_mut() {
        let stem = last
            .rsplit_once('.')
            .map_or(last.as_str(), |(s, _)| s)
            .to_string();
        *last = stem;
    }
    if rest
        .last()
        .is_some_and(|l| l == if py { "__init__" } else { "index" })
        && rest.len() > 1
    {
        rest.pop();
    }
    if py {
        format!("from {}{} import *", ".".repeat(up + 1), rest.join("."))
    } else {
        let prefix = if up == 0 {
            "./".to_string()
        } else {
            "../".repeat(up)
        };
        format!("export * from \"{prefix}{}\"", rest.join("/"))
    }
}

/// Where a violation's unit lives in its file: what a diff-scoped check matches changed lines against.
///
/// Facts record where a declaration starts, not where it ends, so a declaration is taken to
/// run up to the line before the next declaration (symbol or model) in the same file, or to the
/// end of the file. That over-covers top-level code that follows a declaration; it never misses
/// an edit inside one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum Extent {
    /// A whole file, a package manifest, or a file's top-level statements (`(module)`).
    #[default]
    File,
    /// A declared symbol: `start..=end` (1-based). A `drift-ignore` comment can suppress it.
    Symbol { start: u32, end: u32 },
    /// A database model: `start..=end` (1-based).
    Model { start: u32, end: u32 },
}

impl Extent {
    /// The line range, for declarations.
    pub fn lines(self) -> Option<(u32, u32)> {
        match self {
            Extent::File => None,
            Extent::Symbol { start, end } | Extent::Model { start, end } => Some((start, end)),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CheckReport {
    pub violations: Vec<Violation>,
    /// Lock entries whose violation no longer exists (fixed): safe to prune. Entries
    /// in unchecked files and their dependents are never listed: their violations
    /// are unknown.
    pub fixed: Vec<String>,
    /// Files not checked: skipped for lack of stack ([`crate::unchecked`]), sorted.
    /// Their violations are unknown, not absent. Not serialised when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unchecked: Vec<String>,
    /// Role members a base-class, decorator or wrapper convention is not about, with
    /// Drift's reason ([`crate::mine::Rule::exemption`]), and outliers a reviewer marked
    /// fine (code [`REVIEWED`]): checked as holding, listed so a wrong exemption can be
    /// seen. Omitted when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exempt: Vec<Exemption>,
    /// Warnings the neighbour gate held back ([`crate::neighbour`]), each with the
    /// nearest set-apart member and the nearest holder: counted and listed, never
    /// dropped [STRICT]. Their violations stay in `violations`, marked
    /// `suppressed_neighbour`. Omitted when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suppressed_neighbour: Vec<NeighbourHold>,
    /// Promoted practices none of whose ways any unit of their place uses any more
    /// ([`crate::practices::promote::Stale`]): they fire on nothing until a person
    /// looks at them. Omitted when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stale_practices: Vec<crate::practices::promote::Stale>,
    /// Per promoted practice, the units of its place the practice map cannot tell:
    /// not checked, never reported. Omitted when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub practices_not_checked: Vec<crate::practices::promote::NotChecked>,
}

/// A warning the neighbour gate held back ([`CheckReport::suppressed_neighbour`]).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NeighbourHold {
    pub id: String,
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// `path#symbol` of the nearest member the convention sets apart, and how it is set
    /// apart (an exemption code, or `reviewed`).
    pub nearest_apart: String,
    pub apart_code: String,
    pub apart_distance: f64,
    /// `path#symbol` of the nearest member that holds the convention.
    pub nearest_holder: String,
    pub holder_distance: f64,
}

impl NeighbourHold {
    /// Whether it is the hold of `v`.
    pub fn of(&self, v: &Violation) -> bool {
        self.id == v.id && self.path == v.path && self.symbol == v.symbol
    }
}

/// A role member a convention is not about, as `drift check` saw it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Exemption {
    pub id: String,
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// Why, for tools (`another_kind`, `defining_module`, `enum`, `named_for_base`;
    /// `reviewed` for a member a reviewer marked fine, [`REVIEWED`]).
    pub code: String,
    pub reason: String,
}

impl Exemption {
    /// `id path#symbol`, as the hooks' session state keys members.
    pub fn key(&self) -> String {
        format!("exempt {} {}#{}", self.id, self.path, self.symbol)
    }
}

impl CheckReport {
    /// Adds what the promoted practices say ([`crate::practices::promote::check`], of
    /// the same policy, lock, scope and paths as this report): [`check`] leaves them
    /// out, since they are read from the practice map and not from a role's members.
    pub fn add_practices(&mut self, checked: crate::practices::promote::Checked) {
        self.violations.extend(checked.violations);
        self.violations.sort();
        self.fixed.extend(checked.fixed);
        self.stale_practices = checked.stale;
        self.practices_not_checked = checked.not_checked;
    }

    pub fn new_violations(&self) -> impl Iterator<Item = &Violation> {
        self.violations
            .iter()
            .filter(|v| !v.baselined && !v.suppressed && !v.unsure && !v.suppressed_neighbour)
    }

    /// Violations that would be new, held back by the neighbour gate ([`crate::neighbour`]).
    pub fn held_by_neighbour(&self) -> impl Iterator<Item = &Violation> {
        self.violations
            .iter()
            .filter(|v| !v.baselined && !v.suppressed && v.suppressed_neighbour)
    }

    /// Violations that would be new, in files whose verdicts depend on an unchecked file.
    pub fn unsure(&self) -> impl Iterator<Item = &Violation> {
        self.violations
            .iter()
            .filter(|v| !v.baselined && !v.suppressed && v.unsure && !v.suppressed_neighbour)
    }

    pub fn suppressed(&self) -> impl Iterator<Item = &Violation> {
        self.violations.iter().filter(|v| v.suppressed)
    }

    pub fn blocking(&self) -> impl Iterator<Item = &Violation> {
        self.new_violations().filter(|v| v.mode == "block")
    }
}

/// Which conventions to evaluate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Only accepted conventions (the default for check).
    Accepted,
    /// Accepted and proposed (used by `init` to build the lock).
    All,
}

/// Evaluate conventions against `repo`. `only_paths` restricts which files are reported.
/// The neighbour gate runs as [`neighbour_gate_on`] says.
pub fn check(
    repo: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: Scope,
    only_paths: Option<&BTreeSet<String>>,
) -> CheckReport {
    check_gated(repo, policy, lock, scope, only_paths, neighbour_gate_on())
}

/// [`check`], with the neighbour gate ([`crate::neighbour`]) on or off: it only ever runs
/// over accepted conventions ([`Scope::Accepted`]), never when `init` builds the lock.
pub fn check_gated(
    repo: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: Scope,
    only_paths: Option<&BTreeSet<String>>,
    neighbour: bool,
) -> CheckReport {
    // A merged card is checked part by part, under its one id.
    let parts = policy.by_part();
    let policy: &ConventionsFile = &parts;
    let conventions: Vec<_> = policy
        .conventions
        .iter()
        .filter(|c| match scope {
            Scope::Accepted => c.status == Status::Accepted,
            Scope::All => c.status != Status::Rejected,
        })
        .collect();

    let unchecked = Unchecked::of(repo);
    let mut report = CheckReport {
        unchecked: unchecked
            .files
            .iter()
            .filter(|p| only_paths.is_none_or(|o| o.contains(*p)))
            .cloned()
            .collect(),
        ..CheckReport::default()
    };
    // No convention in scope: no unit can break one, be left out of one, lack a
    // registration one asks for, or have fixed one. The report is the files not
    // checked, and the units and contexts of the whole repository are not built.
    if conventions.is_empty() {
        return report;
    }
    let all = crate::roles::all_units(repo, &policy.file_kinds);
    // Built for every convention of the policy: a sibling outside the scope still says
    // what a member is ([`sibling_exemption`]).
    let every: Vec<&Convention> = policy.conventions.iter().collect();
    let contexts = Contexts::new(repo, &all, &every);
    let ctx = &contexts.now;
    let starts = declaration_starts(repo);
    // The neighbour gate's holders, per convention id ([`neighbour_gate`]).
    let gate = scope == Scope::Accepted && neighbour;
    let mut holders: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    // Members of files a person set apart as a different kind: their lock entries stay.
    let mut set_apart: Vec<(String, String)> = Vec::new();
    for (ui, u) in all.iter().enumerate() {
        let path = u.path();
        if only_paths.is_some_and(|p| !p.contains(&path)) {
            continue;
        }
        let extent = extent(&u.view, &starts);
        for c in &conventions {
            let why = match classify(c, u, &policy.conventions, &contexts) {
                None => continue,
                Some(Verdict::Holds) => {
                    if gate && c.rule.applies_in(Some(&c.role), &u.view, contexts.of(c)) {
                        holders.entry(c.id.as_str()).or_default().push(ui);
                    }
                    continue;
                }
                Some(Verdict::Exempt(why)) => {
                    if why.code == DIFFERENT_KIND {
                        set_apart.push((c.id.clone(), format!("{path}#{}", u.name())));
                    }
                    why
                }
                Some(Verdict::Breaks) => {
                    let key = u.key();
                    report.violations.push(Violation {
                        id: c.id.clone(),
                        path: path.clone(),
                        symbol: u.name().to_string(),
                        line: u.line(),
                        summary: summary_now(c, ctx),
                        evidence: format!("{}/{}", c.evidence.holders, c.evidence.total),
                        example: c.example.clone(),
                        mode: effective_mode(c).into(),
                        tier: c.tier(),
                        baselined: lock.contains(&c.id, &key),
                        suppressed: u.suppressions().contains(&c.id),
                        unsure: unchecked.uncertain(&path),
                        suppressed_neighbour: false,
                        extent,
                        wire: None,
                        import: crate::mine::offending_import(&c.rule, &u.view, contexts.of(c))
                            .map(|module| ImportHit {
                                module,
                                specifier: String::new(),
                                line: 0,
                            }),
                        practice: None,
                    });
                    continue;
                }
            };
            report.exempt.push(Exemption {
                id: c.id.clone(),
                path: path.clone(),
                symbol: u.name().to_string(),
                line: u.line(),
                code: why.code,
                reason: why.reason,
            });
        }
    }
    wiring_violations(
        repo,
        policy,
        &conventions,
        lock,
        only_paths,
        &starts,
        ctx,
        scope == Scope::Accepted,
        &unchecked,
        &mut report,
    );
    let reviewed = apply_exceptions(&conventions, &mut report);
    if gate {
        neighbour_gate(
            repo,
            &all,
            &policy.conventions,
            &conventions,
            holders,
            &contexts,
            only_paths,
            &mut report,
        );
    }
    report.violations.sort();
    report.exempt.sort();
    if only_paths.is_none() {
        // A member a reviewer marked fine keeps its lock entry: the exception is a policy
        // decision, not a fix, and removing it brings the legacy violation back as legacy.
        let current: BTreeSet<(String, String)> = report
            .violations
            .iter()
            .map(|v| (v.id.clone(), format!("{}#{}", v.path, v.symbol)))
            .chain(reviewed)
            .chain(set_apart)
            .collect();
        // A promoted practice's entries are the practice map's to call fixed.
        let in_scope: BTreeSet<&str> = conventions
            .iter()
            .filter(|c| !c.rule.is_practice())
            .map(|c| c.id.as_str())
            .collect();
        report.fixed = lock
            .entries
            .iter()
            .filter(|e| in_scope.contains(e.0.as_str()) && !current.contains(*e))
            .filter(|(_, key)| {
                !unchecked.uncertain(key.split_once('#').map_or(key.as_str(), |(p, _)| p))
            })
            .map(|(id, key)| format!("{id} {key}"))
            .collect();
    }
    report
}

/// What one convention says of one unit ([`classify`]).
enum Verdict {
    /// Not about it: an exemption (the rule's own, a shared part, a sibling's, a file a
    /// person set apart as a different kind).
    Exempt(crate::mine::Exempted),
    /// It holds (or is not about it at all, [`crate::mine::Rule::applies_in`]).
    Holds,
    /// It breaks the rule.
    Breaks,
}

/// What `c` says of `u`: `None` when `u` is not in its role or it is a wiring rule
/// (checked apart, [`wiring_violations`]).
fn classify(
    c: &Convention,
    u: &Unit,
    every: &[Convention],
    contexts: &Contexts,
) -> Option<Verdict> {
    // Wiring rules are checked against other files than the unit's own, apart; a
    // promoted practice against the practice map ([`CheckReport::add_practices`]).
    if c.rule.is_wiring()
        || c.rule.is_practice()
        || !u.in_convention_role(&c.role, c.selector_version)
    {
        return None;
    }
    // Its exemptions look up the members its frozen selector holds.
    let cx = contexts.of(c);
    // "Pass `k` to `f()`" is not about code that never calls `f()`: too many such
    // members to list, and none of them is a class Drift chose to leave out.
    if matches!(c.rule, crate::mine::Rule::WrappedBy { .. })
        && let Some(why) = c.rule.exemption_in(Some(&c.role), &u.view, cx)
    {
        return Some(Verdict::Exempt(why));
    }
    // A shared part of the role (#52) is not one of its members: listed, never a
    // violation. part_exemption goes through #45's gate like every exemption.
    if let Some(why) = c.rule.part_exemption(&c.role, &u.view, cx) {
        return Some(Verdict::Exempt(crate::mine::Exempted {
            code: "shared_part".into(),
            reason: why,
        }));
    }
    if c.rule.holds_in(Some(&c.role), &u.view, cx) {
        return Some(Verdict::Holds);
    }
    // An outlier a sibling rule of the role leaves out for what it is.
    if let Some(why) = sibling_exemption(c, every, u, contexts) {
        return Some(Verdict::Exempt(why));
    }
    // A file a person set apart as a different kind (`drift review`'s question):
    // exempt, except an entry point under an auth or validation rule they did not
    // confirm by name [STRICT].
    if let Some(why) = crate::calibrate::set_apart(c, u, cx) {
        return Some(Verdict::Exempt(crate::mine::Exempted {
            code: DIFFERENT_KIND.into(),
            reason: why,
        }));
    }
    Some(Verdict::Breaks)
}

/// Whether `drift check` (and so the hooks, MCP and PR mode) runs the neighbour gate
/// ([`crate::neighbour`]): [`NEIGHBOUR_GATE_DEFAULT`] unless [`NEIGHBOUR_GATE_ENV`] is
/// `on` or `off`.
pub fn neighbour_gate_on() -> bool {
    match std::env::var(NEIGHBOUR_GATE_ENV).as_deref().map(str::trim) {
        Ok("on") => true,
        Ok("off") => false,
        _ => NEIGHBOUR_GATE_DEFAULT,
    }
}

/// Set to `on` or `off` to turn the neighbour gate on or off ([`neighbour_gate_on`]).
pub const NEIGHBOUR_GATE_ENV: &str = "DRIFT_NEIGHBOUR_GATE";

/// Whether the neighbour gate runs when [`NEIGHBOUR_GATE_ENV`] is not set: off. Admitted in
/// round 11 (WS-J), then withdrawn [STRICT]: a new violator next to a member Drift exempts
/// by itself (a base-class exemption, a documented exception, a shared part, a framework
/// root file) is held back, a case the labelled-outlier evaluation did not cover
/// (eval/study/runs/neighbour-r11-2026-11-08). Not admitted until dev4 measures it;
/// `DRIFT_NEIGHBOUR_GATE=on` turns it on.
pub const NEIGHBOUR_GATE_DEFAULT: bool = false; // mutation:neighbour-default

/// The neighbour gate ([`crate::neighbour`]): every new violation (not legacy, not
/// suppressed by a comment, not unsure, not wiring advice) of a convention that sets
/// members apart (an exemption or a reviewer's exception) is compared with the
/// convention's holders and its set-apart members, and held back when it is strictly
/// nearer the set-apart ones, except where [`crate::neighbour::may_hold_back`] forbids
/// it [STRICT]. A held-back violation stays in `violations`, marked, and is listed in
/// [`CheckReport::suppressed_neighbour`].
#[allow(clippy::too_many_arguments)]
fn neighbour_gate<'a, 'c>(
    repo: &'a RepoFacts,
    all: &[Unit<'a>],
    every: &[Convention],
    conventions: &[&'c Convention],
    mut holders: BTreeMap<&'c str, Vec<usize>>,
    contexts: &Contexts<'a>,
    only_paths: Option<&BTreeSet<String>>,
    report: &mut CheckReport,
) {
    use crate::neighbour::{
        Consumers, Signature, holds_back, may_hold_back, nearest, rule_modules, signature,
    };
    let gateable = |v: &Violation| !v.baselined && !v.suppressed && !v.unsure && v.wire.is_none();
    let ids: BTreeSet<&str> = report
        .violations
        .iter()
        .filter(|v| gateable(v))
        .map(|v| v.id.as_str())
        .collect();
    if ids.is_empty() {
        return;
    }
    // Set apart, per id: the exemptions and reviewers' exceptions of the files checked,
    // and every reviewer's exception of the convention.
    let mut apart: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for e in &report.exempt {
        apart
            .entry(e.id.clone())
            .or_default()
            .insert(format!("{}#{}", e.path, e.symbol), e.code.clone());
    }
    for c in conventions.iter().filter(|c| ids.contains(c.id.as_str())) {
        for x in &c.exceptions {
            apart
                .entry(c.id.clone())
                .or_default()
                .entry(x.member.clone())
                .or_insert_with(|| REVIEWED.to_string());
        }
    }
    // A check of some files only: the holders and exemptions of the rest of the repo
    // are read too, for the conventions with a warning to gate.
    if let Some(only) = only_paths {
        for (ui, u) in all.iter().enumerate() {
            if only.contains(&u.path()) {
                continue;
            }
            for c in conventions.iter().filter(|c| ids.contains(c.id.as_str())) {
                match classify(c, u, every, contexts) {
                    Some(Verdict::Holds)
                        if c.rule.applies_in(Some(&c.role), &u.view, contexts.of(c)) =>
                    {
                        holders.entry(c.id.as_str()).or_default().push(ui);
                    }
                    Some(Verdict::Exempt(why)) => {
                        apart
                            .entry(c.id.clone())
                            .or_default()
                            .entry(u.key())
                            .or_insert(why.code);
                    }
                    _ => {}
                }
            }
        }
    }
    let by_key: BTreeMap<String, usize> =
        all.iter().enumerate().map(|(i, u)| (u.key(), i)).collect();
    let consumers = Consumers::learn(repo);
    let mut sigs: BTreeMap<(String, usize), Signature> = BTreeMap::new();
    let mut held = Vec::new();
    for (vi, v) in report.violations.iter().enumerate() {
        if !gateable(v) {
            continue;
        }
        let (Some(hs), Some(ap)) = (holders.get(v.id.as_str()), apart.get(&v.id)) else {
            continue;
        };
        let Some(c) = conventions
            .iter()
            .find(|c| c.id == v.id && !c.rule.is_wiring())
        else {
            continue;
        };
        let Some(&ui) = by_key.get(&format!("{}#{}", v.path, v.symbol)) else {
            continue;
        };
        if !may_hold_back(&c.rule, &all[ui].view, contexts.of(c)) {
            continue;
        }
        let excluded = rule_modules(&c.rule);
        let mut sig = |i: usize| -> Signature {
            sigs.entry((c.id.clone(), i))
                .or_insert_with(|| signature(&all[i], &consumers, &excluded))
                .clone()
        };
        let me = sig(ui);
        let hs: Vec<usize> = hs.iter().copied().filter(|&i| i != ui).collect();
        let hsigs: Vec<Signature> = hs.iter().map(|&i| sig(i)).collect();
        let aps: Vec<(usize, &str)> = ap
            .iter()
            .filter_map(|(k, code)| by_key.get(k).map(|&i| (i, code.as_str())))
            .filter(|&(i, _)| i != ui)
            .collect();
        let asigs: Vec<Signature> = aps.iter().map(|&(i, _)| sig(i)).collect();
        let (h, a) = (nearest(&me, &hsigs), nearest(&me, &asigs));
        let (Some((hi, hd)), Some((ai, ad))) = (h, a) else {
            continue;
        };
        if !holds_back(Some(hd), Some(ad)) {
            continue;
        }
        held.push((
            vi,
            NeighbourHold {
                id: v.id.clone(),
                path: v.path.clone(),
                symbol: v.symbol.clone(),
                line: v.line,
                nearest_apart: all[aps[ai].0].key(),
                apart_code: aps[ai].1.to_string(),
                apart_distance: ad,
                nearest_holder: all[hs[hi]].key(),
                holder_distance: hd,
            },
        ));
    }
    for (vi, h) in held {
        report.violations[vi].suppressed_neighbour = true;
        report.suppressed_neighbour.push(h);
    }
    report
        .suppressed_neighbour
        .sort_by(|a, b| (&a.id, &a.path, &a.symbol).cmp(&(&b.id, &b.path, &b.symbol)));
}
/// [`Exemption::code`] of a member in a file a person set apart as a different kind of
/// thing ([`crate::policy::Convention::different_kind`]).
pub const DIFFERENT_KIND: &str = "different_kind";

/// [`Exemption::code`] of a member a reviewer marked as a legitimate exception
/// ([`crate::policy::Convention::exceptions`]).
pub const REVIEWED: &str = "reviewed";

/// Move every violation a reviewer marked fine ([`crate::policy::Convention::exceptions`],
/// matched on `path#symbol`) from the violations to the exempt members, with the
/// reviewer's reason (sanitised and capped, since agents read it). Only ever removes
/// violations of the convention that names the member [STRICT]. Returns the `(id,
/// path#symbol)` pairs moved.
fn apply_exceptions(
    conventions: &[&Convention],
    report: &mut CheckReport,
) -> Vec<(String, String)> {
    let by_id: BTreeMap<&str, &Convention> = conventions
        .iter()
        .filter(|c| !c.exceptions.is_empty())
        .map(|c| (c.id.as_str(), *c))
        .collect();
    if by_id.is_empty() {
        return Vec::new();
    }
    let mut moved = Vec::new();
    report.violations.retain(|v| {
        let key = format!("{}#{}", v.path, v.symbol);
        let Some(e) = by_id.get(v.id.as_str()).and_then(|c| c.exception(&key)) else {
            return true;
        };
        report.exempt.push(Exemption {
            id: v.id.clone(),
            path: v.path.clone(),
            symbol: v.symbol.clone(),
            line: v.line,
            code: REVIEWED.into(),
            reason: format!(
                "marked fine by a reviewer: {}",
                crate::report::sanitize(&e.reason, crate::policy::MAX_EXCEPTION_REASON)
            ),
        });
        moved.push((v.id.clone(), key));
        false
    });
    moved
}

/// The exemption a sibling convention of `c` (same role and selector version, any
/// status: what a member is does not depend on whether a person accepted that rule)
/// gives `u` for what it is ([`crate::mine::ROLE_EXEMPTION_CODES`]), as mining shares
/// it: the sibling with the least id first. For an outlier of `c` that `c` may take it
/// over for ([`crate::mine::Rule::takes_role_exemptions`]).
fn sibling_exemption(
    c: &Convention,
    conventions: &[Convention],
    u: &Unit,
    contexts: &Contexts,
) -> Option<crate::mine::Exempted> {
    if !c
        .rule
        .takes_role_exemptions(Some(&c.role), &u.view, contexts.of(c))
    {
        return None;
    }
    let mut siblings: Vec<&Convention> = conventions
        .iter()
        .filter(|a| {
            a.id != c.id
                && a.role == c.role
                && a.selector_version == c.selector_version
                && !a.rule.is_wiring()
                && !a.rule.is_practice()
        })
        .collect();
    siblings.sort_by(|a, b| a.id.cmp(&b.id));
    siblings.into_iter().find_map(|a| {
        a.rule
            .exemption_in(Some(&a.role), &u.view, contexts.of(a))
            .filter(|e| crate::mine::shares_code(&e.code, &c.rule))
            .map(|e| crate::mine::role_exemption(&e, &a.rule))
    })
}

/// The contexts a convention's verdicts are read against. Each is built from the units
/// and their roles, and answers who a role's members are (the classes that follow a
/// rule, [`RepoContext::carriers`]; the members an opt-out is counted over,
/// [`RepoContext::role_members`]; where a shared part's users sit, [`RepoContext::part_users`]).
/// A convention accepted before reserved exports or member kinds had roles of their own
/// ([`Legacy`]) holds their members at its place too ([`Unit::in_convention_role`]), so
/// its exemptions are read against a `frozen` context, built from the roles the units
/// had then ([`units_before`]): no exemption fires, or stops firing, because today's
/// roles hold fewer members.
pub(crate) struct Contexts<'a> {
    pub(crate) now: RepoContext<'a>,
    /// One context per way a convention reads its selector as before ([`Legacy`]),
    /// for the readings some unit's roles differ under; the others read as `now`.
    frozen: BTreeMap<Legacy, RepoContext<'a>>,
}

impl<'a> Contexts<'a> {
    pub(crate) fn new(repo: &'a RepoFacts, all: &[Unit<'a>], conventions: &[&Convention]) -> Self {
        let readings: BTreeSet<Legacy> = conventions
            .iter()
            .map(|c| Legacy::of(&c.role, c.selector_version))
            .filter(|l| l.any())
            .collect();
        let frozen = readings
            .into_iter()
            .filter_map(|l| units_before(all, l).map(|before| (l, RepoContext::new(repo, &before))))
            .collect();
        Contexts {
            now: RepoContext::new(repo, all),
            frozen,
        }
    }

    /// The context `c`'s exemptions are read against.
    pub(crate) fn of(&self, c: &Convention) -> &RepoContext<'a> {
        self.frozen
            .get(&Legacy::of(&c.role, c.selector_version))
            .unwrap_or(&self.now)
    }
}

/// Violations of wiring rules: members missing from their registry, and keys of one
/// file missing from the file they are mirrored to. Both read other files than the
/// violation's own, so they are evaluated here, not per unit.
#[allow(clippy::too_many_arguments)]
fn wiring_violations(
    repo: &RepoFacts,
    policy: &ConventionsFile,
    conventions: &[&crate::policy::Convention],
    lock: &Lock,
    only_paths: Option<&BTreeSet<String>>,
    starts: &BTreeMap<&str, Vec<u32>>,
    ctx: &RepoContext,
    once: bool,
    unchecked: &Unchecked,
    report: &mut CheckReport,
) {
    type Registered<'c> = (
        &'c crate::policy::Convention,
        (&'c crate::roles::RoleSelector, &'c str, &'c str, &'c str),
    );
    let registered: Vec<Registered> = conventions
        .iter()
        .filter_map(|c| match &c.rule {
            Rule::RegisteredIn {
                slot, path, named, ..
            } => Some((*c, (&c.role, slot.as_str(), path.as_str(), named.as_str()))),
            _ => None,
        })
        .collect();
    let rules: Vec<_> = registered.iter().map(|(_, r)| *r).collect();
    // Directories with a baselined (legacy) violation of the rule: their members are
    // registered some way Drift does not see (`@Module(getConfig())`, a list built
    // at run time), so a new sibling there is not reported either.
    let dir = |p: &str| p.rsplit_once('/').map_or("", |(d, _)| d).to_string();
    let legacy_dirs: BTreeSet<(&str, String)> = lock
        .entries
        .iter()
        .filter_map(|(id, key)| Some((id.as_str(), dir(key.rsplit_once('#')?.0))))
        .collect();
    // One omission is one violation: a member missing from nested barrels or from
    // a list and the list spread into it, under several accepted rules of one kind
    // (or whose fixes name the same list), is reported once, for the rule whose fix
    // is nearest it. (Not when the lock is built: each rule's legacy outliers are
    // its own.)
    let mut found: Vec<(usize, String, Violation)> = Vec::new();
    for m in crate::wiring::missing_registrations(repo, &policy.file_kinds, &rules, only_paths) {
        let c = registered[m.rule].0;
        let key = format!("{}#{}", m.file.path, m.symbol.name);
        if !lock.contains(&c.id, &key) && legacy_dirs.contains(&(c.id.as_str(), dir(&m.file.path)))
        {
            continue;
        }
        let (_, slot, path, _) = registered[m.rule].1;
        let family = crate::wiring::family_of(path, slot);
        let near = m
            .hint
            .path
            .split('/')
            .zip(m.file.path.split('/'))
            .take_while(|(a, b)| a == b)
            .count();
        let v = Violation {
            id: c.id.clone(),
            path: m.file.path.clone(),
            symbol: m.symbol.name.clone(),
            line: m.symbol.line,
            summary: summary_now(c, ctx),
            evidence: format!("{}/{}", c.evidence.holders, c.evidence.total),
            example: c.example.clone(),
            mode: effective_mode(c).into(),
            tier: c.tier(),
            baselined: lock.contains(&c.id, &key),
            suppressed: m.symbol.suppressions.contains(&c.id),
            extent: extent(&View::Symbol(m.file, m.symbol), starts),
            // The verdict reads the member's file and the registry's (#32: unsure when
            // either is a file not parsed, or depends on one).
            unsure: unchecked.uncertain(&m.file.path) || unchecked.uncertain(path),
            suppressed_neighbour: false,
            import: None,
            wire: Some(WireHint {
                entry: Some(WireEntry {
                    symbol: m.symbol.name.clone(),
                    path: m.file.path.clone(),
                    line: m.symbol.line,
                }),
                ..m.hint
            }),
            practice: None,
        };
        if !once || v.baselined || v.suppressed {
            report.violations.push(v);
        } else {
            found.push((near, family, v));
        }
    }
    // Nearest fix first, then by rule id.
    found.sort_by(|a, b| {
        (&a.2.path, &a.2.symbol, std::cmp::Reverse(a.0), &a.2.id).cmp(&(
            &b.2.path,
            &b.2.symbol,
            std::cmp::Reverse(b.0),
            &b.2.id,
        ))
    });
    let mut said: BTreeSet<(String, String, String)> = BTreeSet::new();
    for (_, family, v) in found {
        let w = v.wire.as_ref().expect("a wiring violation has a fix");
        let member = format!("{}#{}", v.path, v.symbol);
        let list = format!("{}:{}:{}", w.path, w.line, w.label);
        let first_of_kind = said.insert((member.clone(), "kind".into(), family));
        let first_at_list = said.insert((member, "list".into(), list));
        if first_of_kind && first_at_list {
            report.violations.push(v);
        }
    }
    for c in conventions {
        let Rule::MirrorsKeys { from, to } = &c.rule else {
            continue;
        };
        if only_paths.is_some_and(|p| !p.contains(from)) {
            continue;
        }
        let find = |p: &str| repo.key_files.iter().find(|k| k.path == p);
        // Both files must be known: a check that did not read them says nothing.
        let (Some(src), Some(dst)) = (find(from), find(to)) else {
            continue;
        };
        let have: BTreeMap<&str, u32> = dst.keys.iter().map(|(k, l)| (k.as_str(), *l)).collect();
        let like = src.keys.iter().find_map(|(k, _)| {
            have.get(k.as_str()).map(|l| WireLike {
                name: k.clone(),
                line: *l,
                path: to.clone(),
            })
        });
        let first = dst.keys.iter().map(|(_, l)| *l).min().unwrap_or(1);
        for (k, line) in &src.keys {
            if have.contains_key(k.as_str()) {
                continue;
            }
            let key = format!("{from}#{k}");
            report.violations.push(Violation {
                id: c.id.clone(),
                path: from.clone(),
                symbol: k.clone(),
                line: *line,
                summary: c.summary.clone(),
                evidence: format!("{}/{}", c.evidence.holders, c.evidence.total),
                example: c.example.clone(),
                mode: effective_mode(c).into(),
                tier: c.tier(),
                baselined: lock.contains(&c.id, &key),
                suppressed: false,
                extent: Extent::Symbol {
                    start: *line,
                    end: *line,
                },
                unsure: unchecked.uncertain(from) || unchecked.uncertain(to),
                suppressed_neighbour: false,
                import: None,
                wire: Some(WireHint {
                    action: "mirror".into(),
                    path: to.clone(),
                    line: first,
                    label: "keys".into(),
                    like: like.clone(),
                    entry: Some(WireEntry {
                        symbol: k.clone(),
                        path: from.clone(),
                        line: *line,
                    }),
                }),
                practice: None,
            });
        }
    }
}

/// Sorted, distinct declaration lines (symbols other than `(module)`, and models) per file.
pub(crate) fn declaration_starts(repo: &RepoFacts) -> BTreeMap<&str, Vec<u32>> {
    let mut out: BTreeMap<&str, BTreeSet<u32>> = BTreeMap::new();
    for f in &repo.files {
        let lines = out.entry(f.path.as_str()).or_default();
        lines.extend(
            f.symbols
                .iter()
                .filter(|s| s.kind != SymbolKind::Module)
                .map(|s| s.line),
        );
    }
    for m in &repo.models {
        out.entry(m.path.as_str()).or_default().insert(m.line);
    }
    out.into_iter()
        .map(|(p, l)| (p, l.into_iter().collect()))
        .collect()
}

/// The lines of the declaration that starts at `start` in `path`: up to the line before
/// the next declaration there ([`declaration_starts`]), or to the end of the file.
pub(crate) fn span(starts: &BTreeMap<&str, Vec<u32>>, path: &str, start: u32) -> (u32, u32) {
    let end = starts
        .get(path)
        .and_then(|l| l.get(l.partition_point(|&n| n <= start)))
        .map_or(u32::MAX, |n| n - 1);
    (start, end)
}

fn extent(view: &View, starts: &BTreeMap<&str, Vec<u32>>) -> Extent {
    match view {
        View::Symbol(f, s) if s.kind != SymbolKind::Module => {
            let (start, end) = span(starts, &f.path, s.line);
            Extent::Symbol { start, end }
        }
        View::Model(m) => {
            let (start, end) = span(starts, &m.path, m.line);
            Extent::Model { start, end }
        }
        View::Symbol(..) | View::File(_) | View::Package(_) => Extent::File,
    }
}

/// Facts from a single-file scan are not enough to check them like a full scan when
/// an accepted convention could exempt one of the file's symbols and whether it does
/// depends on code the scan did not load:
///
/// - a base-class or class-decorator convention, on the in-repo target's ancestry or
///   on what the classes that follow the rule are built on; a call-wrapper
///   convention, on a binding in a file the scan did not load
///   ([`crate::mine::Rule::exemption_undecided`]); either, on the repo's registrations
///   and guards ([`crate::mine::Rule::documented_or_registered_undecided`]);
/// - a key convention, for a symbol that does not call the callee, and a key or call
///   convention, for a symbol in the callee's own module: whether the callee guards an
///   entry point (which refuses the exemption) is read from every file;
/// - any of these or a key convention, on the routes of other files: a class exempt in
///   facts of one file always is undecided ([`crate::mine::Rule::exemption_undecided`],
///   [`RepoContext::holds_one_file`]), since a route in another file may construct the
///   class, call it or refer to it ([`RepoContext::is_entry_class`]);
/// - a convention whose shared parts may be exempt ([`crate::mine::Rule::parts_apply`]:
///   about members, in a role without entry points, guarding nothing), broken by a
///   symbol that may be a part of the role ([`crate::parts::may_be_part`]), when the
///   facts hold no other file of the role: who uses it is known only from the other
///   files;
/// - an accepted promoted practice ([`crate::practices::promote::check`]): its verdicts
///   are read from the practice map, which is of the whole repository (whether a place
///   still uses one of its ways, a unit's guard defined in another file, its lock
///   entries).
///
/// Hooks then scan the repo. Units and context are built once for all.
pub fn needs_full_scan(repo: &RepoFacts, policy: &ConventionsFile) -> bool {
    if crate::practices::promote::any(policy, Scope::Accepted) {
        return true;
    }
    let parts = policy.by_part();
    let policy: &ConventionsFile = &parts;
    // Conventions whose exemptions may be undecided: wrapper rules, and key rules (a
    // class one may exempt is undecided in facts of one file).
    let wrapped = |c: &Convention| {
        matches!(
            &c.rule,
            crate::mine::Rule::WrappedBy {
                kind: drift_core::WrapKind::Extends
                    | drift_core::WrapKind::Decorator
                    | drift_core::WrapKind::Call,
                ..
            }
        ) || matches!(
            &c.rule,
            crate::mine::Rule::PassesKey { .. } | crate::mine::Rule::Calls { .. }
        )
    };
    // Conventions whose parts may be exempt, as far as the rule alone says (whether its
    // target guards an entry point elsewhere is decided by the full scan).
    let none = RepoContext::default();
    let about_parts = |c: &Convention| c.rule.parts_apply(&c.role, &none);
    // Python naming and call rules: a class of another kind (decided over the role's
    // followers) and a call made through an in-repo helper (decided by the helper's
    // body) may be undecided in facts of one file.
    let py_rule = |c: &Convention| {
        matches!(
            &c.rule,
            crate::mine::Rule::Named { .. } | crate::mine::Rule::Calls { .. }
        )
    };
    let is_py = |u: &Unit| matches!(u.view, View::Symbol(f, _) if f.lang == "py");
    // A plain value under a naming rule: whether the role's followers are schemas is
    // decided over the whole role ([`crate::mine::Rule::exemption_undecided`]).
    let is_plain = |u: &Unit| {
        matches!(u.view, View::Symbol(_, s)
            if s.traits.iter().any(|t| t == drift_core::traits::PLAIN_VALUE))
    };
    // Accepted conventions with a sibling (same role): an outlier may take over the
    // sibling's exemption ([`sibling_exemption`]).
    let has_sibling = |c: &Convention| {
        policy.conventions.iter().any(|a| {
            a.id != c.id
                && a.role == c.role
                && a.selector_version == c.selector_version
                && !a.rule.is_wiring()
        })
    };
    // A file a person set apart under an auth or validation rule: whether one of its
    // members is an entry point (which the set-apart exemption never covers unconfirmed)
    // is read from every file (a route elsewhere may make a class an entry class).
    let set_apart_rule = |c: &Convention| {
        !c.different_kind.is_empty() && crate::calibrate::auth_or_validation(&c.rule)
    };
    let rules: Vec<&Convention> = policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Accepted)
        .filter(|c| {
            wrapped(c) || about_parts(c) || py_rule(c) || has_sibling(c) || set_apart_rule(c)
        })
        .collect();
    if rules.is_empty() {
        return false;
    }
    let all = crate::roles::all_units(repo, &policy.file_kinds);
    let every: Vec<&Convention> = policy.conventions.iter().collect();
    let contexts = Contexts::new(repo, &all, &every);
    let ctx = &contexts.now;
    // The facts see the users of a symbol of the role only when they hold the role's
    // other files (a full scan does; a single-file scan does not). Today's roles: a
    // convention accepted before reserved exports had roles of their own holds more
    // members, so it is alone in a file no more often than this says.
    let alone = |c: &Convention, path: &str| {
        all.iter()
            .filter(|o| o.roles.contains(&c.role))
            .all(|o| o.path() == path)
    };
    // Undecided as `check` reads the convention ([`Contexts::of`]), or as today's roles
    // read it: a full scan is never wrong, so either reading asks for one.
    let undecided = |c: &Convention, u: &Unit, cx: &RepoContext| {
        c.rule
            .exemption_undecided(Some(&c.role), &u.view, cx, c.evidence.holders)
            || c.rule.documented_or_registered_undecided(
                Some(&c.role),
                &u.view,
                cx,
                c.evidence.holders,
            )
    };
    // A sibling's exemption is read from every file as the sibling reads it: in facts of
    // one file, an outlier one would take over, or whose sibling exemption is undecided,
    // goes to a full scan (more facts can refuse an exemption a file alone grants).
    let sibling_undecided = |c: &Convention, u: &Unit| {
        ctx.holds_one_file()
            && !c.rule.holds_in(Some(&c.role), &u.view, contexts.of(c))
            && c.rule
                .takes_role_exemptions(Some(&c.role), &u.view, contexts.of(c))
            && policy.conventions.iter().any(|a| {
                a.id != c.id
                    && a.role == c.role
                    && a.selector_version == c.selector_version
                    && !a.rule.is_wiring()
                    && (a
                        .rule
                        .exemption_in(Some(&a.role), &u.view, contexts.of(a))
                        .is_some_and(|e| crate::mine::shares_code(&e.code, &c.rule))
                        || undecided(a, u, contexts.of(a)))
            })
    };
    all.iter().any(|u| {
        rules.iter().any(|c| {
            u.in_convention_role(&c.role, c.selector_version)
                && ((ctx.holds_one_file()
                    && set_apart_rule(c)
                    && c.different_kind_at(&u.path()).is_some())
                    || sibling_undecided(c, u)
                    || ((wrapped(c) || (py_rule(c) && (is_py(u) || is_plain(u))))
                        && (undecided(c, u, ctx) || undecided(c, u, contexts.of(c))))
                    || (about_parts(c)
                        && c.rule.parts_apply(&c.role, ctx)
                        && crate::parts::may_be_part(u)
                        && !c.rule.holds(&u.view, ctx)
                        && alone(c, &u.path())))
        })
    })
}

/// The mode a convention is checked with. A role under [`MIN_BLOCK_ROLE_SIZE`] members never
/// blocks, even when a hand-edited policy says `mode: block`: it advises. (A suggestion a person
/// set to block, with `drift review --force` or before tiers existed, keeps blocking.)
pub fn effective_mode(c: &crate::policy::Convention) -> &'static str {
    // Experimental wiring rules never block (also enforced when the policy loads).
    if c.rule.is_wiring() {
        return "advise";
    }
    // A practice promoted below the share a place needs, on a person's word, advises.
    if c.rule.is_practice()
        && (c.evidence.holders as f64)
            < crate::practices::promote::BLOCK_SHARE * c.evidence.total as f64
    {
        return "advise";
    }
    match c.mode {
        Mode::Block if c.evidence.role_size() >= MIN_BLOCK_ROLE_SIZE => "block",
        _ => "advise",
    }
}

/// The convention's summary, with what it means for the code as it is now: a
/// version rule that follows the workspace names the range most packages use.
fn summary_now(c: &crate::policy::Convention, ctx: &RepoContext) -> String {
    match &c.rule {
        crate::mine::Rule::DependencyVersion { name, range: None } => {
            let python = c.role.file == crate::roles::PYTHON_PACKAGE_FILE;
            match ctx.majority_range_in(python, name) {
                Some(r) => format!("{} ({name}@{r})", c.summary),
                None => c.summary.clone(),
            }
        }
        _ => c.summary.clone(),
    }
}

/// The lock that baselines every current violation of `policy` (all non-rejected conventions).
pub fn baseline(repo: &RepoFacts, policy: &ConventionsFile) -> Lock {
    let r = check(repo, policy, &Lock::default(), Scope::All, None);
    Lock {
        entries: r
            .violations
            .into_iter()
            .map(|v| (v.id, format!("{}#{}", v.path, v.symbol)))
            .collect(),
    }
}
