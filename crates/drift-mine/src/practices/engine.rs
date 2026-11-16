//! The practice-map engine (PLAN-R13 §3): each registered concern's population is
//! assigned unit by unit, the assignments go through the [STRICT] rules below, and the
//! units are grouped by variant key. For each variant it says where its members are,
//! what sets it apart from the dominant variant, which members to copy, and which
//! units in its places do it another way; for each package, the same profile, and the
//! packages whose dominant variant is not the repository's. Across concerns: the recipe
//! per package and kind of entry point, and the findings.
//!
//! The [STRICT] rules, applied to every assignment whatever the classifier said:
//!
//! - **Declared** first: an instrument a person named under the concern in
//!   `.drift/config.yaml` `practices:` is known, whatever else would say of it; for
//!   authentication and authorization only where the unit runs it on every path
//!   ([`short_of_every_path`]), else the unit is unknown with the declaration as a
//!   check found and not proven. A declared unit is counted apart
//!   ([`Population::declared`]) and is never a recipe, a way to copy or what another
//!   unit departs from. A person may still promote it ([`super::promote`]): a way they
//!   declared and units use is held to like any other.
//! - **Unparsed** ([`Guards::unparsed`]): a unit in a file whose parse failed or that
//!   was skipped for lack of stack, or one whose instrument is defined in such a file,
//!   is unknown (`unparsed`).
//! - **Unknown dominates known** ([`Guards::unknown_dominates`]): a known unit with
//!   any instrument that is unclassified, unresolved, opaque or dynamic is unknown, even
//!   when its other instruments are known.
//! - **No false none** ([`Guards::false_none`]): a recorded absence is only a `none`
//!   when nothing on the unit could be doing the concern unseen. An entry point whose
//!   handler is not found, or (for the concerns a wrapper can do) one wrapped by
//!   something unresolved or without a definition, is unknown instead. No unknown unit
//!   is ever `none`.
//! - **Guard filter** ([`Guards::guard_filter`], authn only): a wrapper, decorator,
//!   dependency, base or app guard counts as authentication only when
//!   [`crate::security::authenticates`] holds; a body call only when
//!   [`crate::security::callee_is_guard`] holds. Only an in-repo definition that
//!   rejects no one is dropped (a FastAPI `Depends(get_db)` is no instrument); an
//!   in-repo wrapper without a definition is unknown (`opaque_wrapper`), and a
//!   package's export no guard list knows is unknown (`unclassified`).
//! - **Middleware coverage** ([`Guards::matcher`], authn only): the package's
//!   middleware route matchers are joined to the route ([`super::matcher`]). A
//!   middleware use on a route the matchers exclude is dropped; on one they may or may
//!   not cover (a matcher that cannot be read, a dynamic segment) the unit is unknown.
//!   A `none` on a route a middleware covers is unknown: the middleware may be the
//!   guard.
//!
//! Deterministic: units are sorted before they are grouped, every list is sorted with
//! a total order, and nothing depends on the order of the facts.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, RepoFacts, Symbol, WrapKind};

use super::matcher::{self, Tri};
use super::*;
use crate::mine::{MIN_ROLE_SIZE, Rule, norm_ref, r3};
use crate::roles::{NonProduction, is_test_path};

/// What next round's concerns will describe (PLAN-R13 §8): not in this map yet.
pub const NOT_COVERED: &[&str] = &[
    "outbound calls (HTTP clients, timeouts, retries)",
    "background jobs and queues",
    "frontend data fetching",
    "state and design system",
    "hygiene (duplicate libraries, escape hatches)",
    "declared vs actual (AGENTS.md, lint configs)",
    "change over time (which variant new code adopts)",
];

/// The concerns that make the recipe and reach agents (lead decision, round 13); the
/// others are reported as a preview.
pub const PRIMARY: &[&str] = &[AUTHN, AUTHZ, VALIDATION, ERRORS, API];

/// The smallest share of a place a variant must hold for the other units there to be
/// its exceptions (PLAN-R13 §3).
const EXCEPTION_PLACE_SHARE: f64 = 0.8;
/// The smallest share of a package its dominant variant must hold to diverge.
const DIVERGENCE_SHARE: f64 = 0.6;
/// Smallest separation reported in `sets_apart`.
const MIN_SEPARATION: f64 = 0.25;
/// Fewest members a variant needs before anything is said to set it apart.
const MIN_APART: usize = 5;
/// The family-wise error rate of one `sets_apart` test (Bonferroni over its
/// candidate attributes), two-sided.
const ALPHA: f64 = 0.05;
/// The share of a package each of the top two variants needs for a split.
const SPLIT_SHARE: f64 = 0.2;
/// Internal modules that may be an `imports:` attribute: the most imported ones.
const TOP_IMPORTS: usize = 50;
/// Known keys with fewer members fold into the concern's tail.
const MIN_VARIANT: usize = 2;
/// The key and id of a concern's tail.
pub(crate) const TAIL: &str = "tail";

/// Concerns a wrapper can do on an entry point's behalf: there an unresolved or
/// opaque wrapper means a `none` may be false ([`Guards::false_none`]).
const WRAPPER_CONCERNS: &[&str] = &[AUTHN, AUTHZ, ERRORS, LOGGING, VALIDATION, API];

/// Mechanisms the authn guard filter reads through [`crate::security::authenticates`].
const WRAP_MECHANISMS: &[&str] = &["wrap", "decorator", "dependency", "base", "app_guard"];
/// Mechanisms it reads through [`crate::security::callee_is_guard`].
const CALL_MECHANISMS: &[&str] = &["body_call"];
/// Authn mechanisms of the user caller class: the ones a split policy may fold.
const USER_AUTHN: &[&str] = &[
    "wrap",
    "dependency",
    "decorator",
    "base",
    "config",
    "app_hook",
    "app_guard",
    "middleware",
    "body_check",
    "body_call",
];
/// The user-class mechanisms whose instrument can be decisive for grouping: those a
/// split policy folds, and a person's declaration.
const AUTHN_USER_DECISIVE: &[&str] = &[
    "wrap",
    "dependency",
    "decorator",
    "base",
    "config",
    "app_hook",
    "app_guard",
    "middleware",
    "body_check",
    "body_call",
    "declared",
];
/// Authn mechanisms the whole app (or a whole module) runs, not the route itself.
const GLOBAL_AUTHN: &[&str] = &["app_guard", "app_hook", "config", "middleware"];
/// The service-to-service caller class: folds only with itself.
const SERVICE_AUTHN: &str = "service_auth";
/// Attributes a split policy's alternatives may be told apart by.
const STRUCTURAL: &[&str] = &["package:", "dir:", "entry:", "method:"];

/// The [STRICT] rules, each one switchable only in tests (the mutation checks).
#[derive(Debug, Clone, Copy)]
pub(super) struct Guards {
    pub unparsed: bool,
    pub unknown_dominates: bool,
    pub false_none: bool,
    pub guard_filter: bool,
    pub matcher: bool,
}

impl Guards {
    pub const ALL: Guards = Guards {
        unparsed: true,
        unknown_dominates: true,
        false_none: true,
        guard_filter: true,
        matcher: true,
    };
}

/// One run of the engine: the report, and each unit's variant for the card.
pub(super) struct Run {
    pub report: PracticesReport,
    /// Every assigned unit in scope: (concern, path, variant id or `unknown`).
    pub units: Vec<(&'static str, String, String)>,
    /// Each concern in scope with its placed units, for the card's lines.
    runs: Vec<ConcernRun>,
}

/// One assigned unit, with where it is.
struct Placed {
    path: String,
    /// Where the unit's code is, to quote and copy: the file of its symbol (the
    /// origin of a re-exported handler), else `path`.
    src: String,
    package: String,
    symbol: String,
    line: u32,
    /// The catch index of a catch unit, else 0.
    sub: usize,
    entry_kind: Option<String>,
    method: Option<String>,
    /// The route of an entry unit: a handler mounted more than once is a unit for
    /// each mount.
    route: Option<String>,
    stem: String,
    /// The directory chain below the package (`role_dirs` without "").
    dirs: Vec<String>,
    roles: Vec<String>,
    /// `sets_apart` candidates of the unit itself (cross-concern ones are added later).
    attrs: BTreeSet<String>,
    outcome: Outcome,
    /// Authz only: the tenant or owner key the unit takes from the request and
    /// neither checks nor scopes ([`Concern::unscoped_key`]), kept only for a unit
    /// whose authentication is known.
    unscoped: Option<String>,
    /// What stands behind a known outcome ([`Concern::assign_backed`]); empty otherwise.
    backing: Backing,
    /// Of a unit unknown for its instrument alone ([`declarable`]): it does not run the
    /// instrument on every path, so naming it in `practices:` would not settle it
    /// ([`short_of_every_path`]).
    unsettled: bool,
}

/// What tells one placed unit of a concern from another ([`Placed::ident`]): its file,
/// symbol, line, catch index, entry kind, method and route.
type Ident<'a> = (
    &'a str,
    &'a str,
    u32,
    usize,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
);

/// A unit across concerns ([`Placed::unit_key`]): its file, symbol, line, method and
/// route.
type UnitKey = (String, String, u32, Option<String>, Option<String>);

impl Placed {
    fn ident(&self) -> Ident<'_> {
        (
            &self.path,
            &self.symbol,
            self.line,
            self.sub,
            self.entry_kind.as_deref(),
            self.method.as_deref(),
            self.route.as_deref(),
        )
    }

    /// The unit across concerns: the same entry point in authn and in authz.
    fn unit_key(&self) -> UnitKey {
        (
            self.path.clone(),
            self.symbol.clone(),
            self.line,
            self.method.clone(),
            self.route.clone(),
        )
    }

    fn example(&self) -> Example {
        Example {
            path: self.src.clone(),
            symbol: self.symbol.clone(),
            line: self.line,
        }
    }

    /// The medoid signature (PLAN-R13 §3 "Examples").
    fn signature(&self) -> (String, Option<String>, String, String) {
        (
            self.package.clone(),
            self.entry_kind.clone(),
            self.stem.clone(),
            self.roles.join(","),
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    Known {
        key: VariantKey,
        label: String,
        source: VariantSource,
    },
    None {
        label: String,
    },
    /// Authentication that identifies the caller and turns no one away
    /// ([`super::authn::identified_only`]): its key's mechanism is
    /// [`super::authn::IDENTIFIED`].
    Identified {
        key: VariantKey,
        label: String,
        source: VariantSource,
    },
    Unknown {
        reason: UnknownReason,
        instrument: String,
    },
}

/// An authentication outcome every use of which identifies the caller: identified.
/// Its key stays what it was (`identifies:<instrument>`), and so does its P- id: an
/// identity, not text. Any other is as it was.
fn identified(concern: &str, o: Outcome) -> Outcome {
    match o {
        Outcome::Known { key, source, .. }
            if concern == AUTHN && super::authn::identified_only(&key.uses) =>
        {
            let by: Vec<String> = key.uses.iter().map(|u| u.instrument.clone()).collect();
            Outcome::Identified {
                label: super::basis::identified(&by),
                key,
                source,
            }
        }
        o => o,
    }
}

/// A package's middleware: its route matchers and the instrument it is.
struct Middleware<'a> {
    matchers: &'a [drift_core::RouteMatcher],
    instrument: String,
    /// The middleware's own symbol (`middleware.ts#default`).
    symbol: String,
}

/// What the whole repository says about every unit's place.
struct Env<'a> {
    facts: &'a RepoFacts,
    non_production: NonProduction,
    map: crate::map::RepoMap,
    /// Files whose facts are not to be trusted: parse errors, skipped for lack of stack.
    unparsed: BTreeSet<&'a str>,
    /// Internal modules that may be an `imports:` attribute.
    top_imports: BTreeSet<&'a str>,
    /// Each package's middleware (the first middleware file by path).
    middleware: BTreeMap<&'a str, Middleware<'a>>,
}

impl<'a> Env<'a> {
    fn new(facts: &'a RepoFacts, opts: &Options) -> Self {
        let kinds = opts
            .kinds
            .clone()
            .unwrap_or_else(|| crate::roles::FileKinds::learn(facts));
        let mut unparsed: BTreeSet<&str> = facts.stack_unavailable().into_iter().collect();
        unparsed.extend(
            facts
                .files
                .iter()
                .filter(|f| !f.parse_ok)
                .map(|f| f.path.as_str()),
        );
        let paths: BTreeSet<&str> = facts.files.iter().map(|f| f.path.as_str()).collect();
        let mut importers: BTreeMap<&str, usize> = BTreeMap::new();
        for f in &facts.files {
            let mods: BTreeSet<&str> = f
                .imports
                .iter()
                .map(|i| i.module.as_str())
                .filter(|m| paths.contains(m))
                .collect();
            for m in mods {
                *importers.entry(m).or_default() += 1;
            }
        }
        let mut ranked: Vec<(&str, usize)> = importers.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        let top_imports = ranked
            .into_iter()
            .take(TOP_IMPORTS)
            .map(|(m, _)| m)
            .collect();
        let mut files: Vec<&FileFacts> = facts
            .files
            .iter()
            .filter(|f| f.entry_points.iter().any(|e| e.kind == "middleware"))
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let mut middleware = BTreeMap::new();
        for f in files {
            let Some(e) = f.entry_points.iter().find(|e| e.kind == "middleware") else {
                continue;
            };
            let instrument = crate::entries::entry_symbol(facts, f, e)
                .and_then(|(_, s)| s.wraps.first().map(|w| norm_ref(&w.wrapper).into_owned()))
                .unwrap_or_else(|| format!("{}#{}", f.path, e.symbol));
            let symbol = crate::entries::entry_symbol(facts, f, e).map_or_else(
                || format!("{}#{}", f.path, e.symbol),
                |(df, s)| format!("{}#{}", df.path, s.name),
            );
            middleware.entry(f.package.as_str()).or_insert(Middleware {
                matchers: &f.route_matchers,
                instrument,
                symbol,
            });
        }
        Env {
            facts,
            non_production: NonProduction::learn(facts),
            map: crate::map::RepoMap::build(facts, &kinds),
            unparsed,
            top_imports,
            middleware,
        }
    }

    fn roles_of(&self, path: &str) -> Vec<String> {
        let mut out: Vec<String> = self
            .map
            .file_roles
            .get(path)
            .map(|v| v.iter().map(|&i| self.map.roles[i].id.clone()).collect())
            .unwrap_or_default();
        out.sort();
        out.dedup();
        out
    }

    fn place(&self, unit: &UnitRef<'a>, outcome: Outcome) -> Placed {
        let file = unit.file();
        let src = symbol_file(self, unit).map_or_else(|| file.path.clone(), |f| f.path.clone());
        let (symbol, line, sub, entry_kind, method, route) = match *unit {
            UnitRef::Entry { entry, symbol, .. } => (
                entry.symbol.clone(),
                symbol.map_or(0, |s| s.line),
                0,
                Some(entry.kind.clone()),
                entry.method.clone(),
                entry.route.clone(),
            ),
            UnitRef::Symbol { symbol, .. } => {
                (symbol.name.clone(), symbol.line, 0, None, None, None)
            }
            UnitRef::Catch { symbol, index, .. } => {
                (symbol.name.clone(), symbol.line, index, None, None, None)
            }
            UnitRef::TestFile { .. } | UnitRef::File { .. } => {
                (String::new(), 0, 0, None, None, None)
            }
        };
        let dirs: Vec<String> = crate::security::role_dirs(&file.package, &file.path)
            .into_iter()
            .filter(|d| !d.is_empty())
            .collect();
        let roles = self.roles_of(&file.path);
        let stem = stem_of(&file.path);
        let mut attrs = BTreeSet::new();
        attrs.insert(format!("package:{}", shown_package(&file.package)));
        for d in &dirs {
            attrs.insert(format!("dir:{d}"));
        }
        for r in &roles {
            attrs.insert(format!("role:{r}"));
        }
        if let Some(k) = &entry_kind {
            attrs.insert(format!("entry:{k}"));
        }
        if let Some(m) = &method {
            attrs.insert(format!("method:{m}"));
        }
        if !stem.is_empty() {
            attrs.insert(format!("stem:{stem}"));
        }
        if let Some(first) = route.as_deref().and_then(first_segment) {
            attrs.insert(format!("route:{first}"));
        }
        if !file.lang.is_empty() {
            attrs.insert(format!("lang:{}", file.lang));
        }
        for i in &file.imports {
            if self.top_imports.contains(i.module.as_str()) {
                attrs.insert(format!("imports:{}", i.module));
            }
        }
        Placed {
            path: file.path.clone(),
            src,
            package: file.package.clone(),
            symbol,
            line,
            sub,
            entry_kind,
            method,
            route,
            stem,
            dirs,
            roles,
            attrs,
            outcome,
            unscoped: None,
            backing: Backing::default(),
            unsettled: false,
        }
    }
}

fn stem_of(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or_default()
        .split('.')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn external(r: &str) -> bool {
    r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:")
}

/// The file of an internal canonical reference (`lib/auth.ts#withAuth`).
fn internal_path(r: &str) -> Option<&str> {
    if external(r) {
        return None;
    }
    r.split_once('#').map(|(p, _)| p)
}

/// `/api/x/[id]` -> `/api`, when it is route-shaped (the string policy).
fn first_segment(route: &str) -> Option<String> {
    let rest = route.strip_prefix('/')?;
    let seg = rest.split('/').next().unwrap_or_default();
    let s = format!("/{seg}");
    drift_core::practice::valid_route(&s).then_some(s)
}

pub(super) fn shown_package(p: &str) -> &str {
    if p.is_empty() { "." } else { p }
}

/// An instrument that says it cannot be told: its unknown reason.
fn unknown_instrument(i: &str) -> Option<UnknownReason> {
    if i.starts_with("unclassified:") {
        Some(UnknownReason::Unclassified)
    } else if i.starts_with("unresolved:") {
        Some(UnknownReason::Unresolved)
    } else if i.starts_with("opaque:") {
        Some(UnknownReason::OpaqueWrapper)
    } else if i.starts_with("dynamic:") {
        Some(UnknownReason::Dynamic)
    } else {
        None
    }
}

/// The short name of an instrument: `lib/auth.ts#withAuth` -> `withAuth`.
fn short(i: &str) -> &str {
    let i = i.strip_prefix("unclassified:").unwrap_or(i);
    i.rsplit_once('#').map_or(i, |(_, n)| n)
}

/// A label for uses the engine changed: `wrap withAuth + body_call auth`.
fn label_of(uses: &[Use]) -> String {
    uses.iter()
        .map(|u| format!("{} {}", u.mechanism, short(&u.instrument)))
        .collect::<Vec<_>>()
        .join(" + ")
}

/// A canonical reference a person can name in `.drift/config.yaml` `practices:`
/// (`lib/auth.ts#withAuth`, `pkg:x#withThing`): a module and a name. Not a
/// pseudo-instrument (`input`, `responses`, `validates`) nor an unresolved, opaque,
/// dynamic or unclassified marker.
fn hintable(instrument: &str) -> bool {
    let Some((module, name)) = instrument.split_once('#') else {
        return false;
    };
    !module.is_empty()
        && !name.is_empty()
        && !["unresolved:", "opaque:", "dynamic:", "unclassified:"]
            .iter()
            .any(|p| module.starts_with(p))
}

/// The `.drift/config.yaml` line that classifies `instrument` under `concern`, in the
/// form [`crate::policy::DriftConfig::load`] reads:
/// `practices: {authn: {"pkg:x#withThing": "withThing"}}`. `None` for anything that is
/// not a canonical reference: a line for it would classify nothing.
pub fn config_hint(concern: &str, instrument: &str) -> Option<String> {
    if !hintable(instrument) {
        return None;
    }
    // Testing is told by what the tests use. A unit of it is unknown behind another
    // concern's instrument when a required case is (the dependency that signs callers
    // in): a line naming that under `testing` would say the routes are tested by it.
    if concern == TESTING && !test_instrument(instrument) {
        return None;
    }
    let q = |s: &str| serde_json::to_string(s).unwrap_or_default();
    Some(format!(
        "practices: {{{concern}: {{{}: {}}}}}",
        q(instrument),
        q(short(instrument))
    ))
}

/// Whether `instrument` (`module#name`) is something tests use: a test library's, or
/// defined in a test file.
fn test_instrument(instrument: &str) -> bool {
    let module = instrument.split_once('#').map_or(instrument, |(m, _)| m);
    if module.starts_with("pkg:") {
        super::libraries::test_runner(module).is_some()
    } else {
        is_test_path(module)
    }
}

/// What a person declared under `practices:` that names nothing in the repository: an
/// in-repo reference with no function or method of that name, that no body calls and
/// nothing wraps. Such a line settles no unit; each is one warning. A package's
/// reference (`pkg:`) cannot be looked up and is never warned about.
pub fn declared_warnings(facts: &RepoFacts, declared: &Declared) -> Vec<String> {
    if declared.values().all(|t| t.is_empty()) {
        return Vec::new();
    }
    let listed = facts.listed();
    let facts = &*listed;
    let ctx = crate::context::RepoContext::new(facts, &[]);
    let mut referenced: BTreeSet<String> = BTreeSet::new();
    for f in &facts.files {
        for s in &f.symbols {
            let calls = s
                .calls
                .iter()
                .chain(&s.receiver_calls)
                .chain(&s.app_middleware)
                .chain(
                    s.members
                        .iter()
                        .flat_map(|m| m.calls.iter().chain(&m.receiver_calls)),
                );
            for c in calls {
                let c = c.trim_start_matches('?');
                let c = c.trim_end_matches("(ref)").trim_end_matches("(new)");
                referenced.insert(norm_ref(c).into_owned());
            }
            for w in &s.wraps {
                referenced.insert(norm_ref(&w.wrapper).into_owned());
            }
        }
        for m in &f.mounts {
            for w in &m.wraps {
                referenced.insert(norm_ref(&w.wrapper).into_owned());
            }
        }
    }
    let mut out = Vec::new();
    for (concern, table) in declared {
        for canonical in table.keys() {
            let c = norm_ref(canonical);
            if super::common::external(&c)
                || CallsOf::of(&ctx, &c).is_some()
                || referenced.contains(c.as_ref())
            {
                continue;
            }
            out.push(format!(
                "{}: `practices.{concern}` names `{canonical}`, which is nowhere in the repository (no function or method of that name, and nothing calls or wraps it): it settles nothing",
                crate::policy::CONFIG_FILE
            ));
        }
    }
    out
}

/// Every [`InstrumentCount::config_hint`] of the report as one block to merge into
/// `.drift/config.yaml`: the unknown units a person can settle by naming how a concern
/// is done here, the largest first within each concern, each with the units it frees.
/// A person keeps the lines that are right; Drift never writes them (naming an
/// instrument is a statement about the codebase, not an inference). When nothing can be
/// named, one line that says so.
pub fn config_hints(r: &PracticesReport) -> String {
    let q = |s: &str| serde_json::to_string(s).unwrap_or_default();
    let mut body = String::new();
    let (mut units, mut names) = (0usize, 0usize);
    for c in &r.concerns {
        let lines = hint_lines(c);
        if lines.is_empty() {
            continue;
        }
        body.push_str(&format!("  {}:\n", c.id));
        for HintLine {
            instrument,
            members,
            found,
            why,
        } in lines
        {
            units += members;
            names += 1;
            let note = match found {
                0 => String::new(),
                n if n == members => format!(": check found, not proven ({})", why.join(", ")),
                n => format!(", {n} with a check found, not proven ({})", why.join(", ")),
            };
            body.push_str(&format!(
                "    {}: {}  # {} unit(s){note}\n",
                q(instrument),
                q(short(instrument)),
                members,
            ));
        }
    }
    if names == 0 {
        return "Nothing to name: no unknown unit is behind something a `practices:` line in .drift/config.yaml would classify.\n".to_string();
    }
    format!(
        "# {units} unit(s) are unknown behind {names} name(s) Drift cannot classify alone.\n\
         # Each line says how a concern is done here; the value is the label reports show.\n\
         # Keep the lines that are right, merge them under one `practices:` key in\n\
         # .drift/config.yaml, and run `drift practices` again.\n\
         practices:\n{body}"
    )
}

/// How many unknown units [`config_hints`] would settle, behind how many names: its
/// lines, one per instrument and concern.
pub fn config_hint_counts(r: &PracticesReport) -> (usize, usize) {
    r.concerns
        .iter()
        .flat_map(hint_lines)
        .fold((0, 0), |(u, n), l| (u + l.members, n + 1))
}

/// One line of [`config_hints`]: an instrument a `practices:` line names, the units
/// it settles, and of them those behind a check found and not proven, with why.
struct HintLine<'r> {
    instrument: &'r str,
    members: usize,
    found: usize,
    why: Vec<&'r str>,
}

/// The lines of [`config_hints`] for one concern, one per instrument: a check found
/// and not proven first (the line says the check is what its name says and runs for
/// every request that reaches it), its rows merged; then the instruments named
/// alone, added to the line of a check on the same instrument where there is one.
fn hint_lines(c: &ConcernReport) -> Vec<HintLine<'_>> {
    let mut out: Vec<HintLine<'_>> = Vec::new();
    for k in c
        .unknown
        .checks
        .iter()
        .filter(|k| !k.config_hint.is_empty())
    {
        let instrument = k.check.split_once(':').map_or("", |(_, i)| i);
        match out.iter_mut().find(|l| l.instrument == instrument) {
            Some(l) => {
                l.members += k.members;
                l.found += k.members;
                if !l.why.contains(&k.obligation.as_str()) {
                    l.why.push(&k.obligation);
                }
            }
            None => out.push(HintLine {
                instrument,
                members: k.members,
                found: k.members,
                why: vec![&k.obligation],
            }),
        }
    }
    for i in c
        .unknown
        .instruments
        .iter()
        .filter(|i| !i.config_hint.is_empty())
    {
        match out.iter_mut().find(|l| l.instrument == i.instrument) {
            Some(l) => l.members += i.members,
            None => out.push(HintLine {
                instrument: &i.instrument,
                members: i.members,
                found: 0,
                why: Vec::new(),
            }),
        }
    }
    out
}

/// What a unit row says of a check found and not proven.
fn not_proven(concern: &str, u: &Unproven) -> NotProven {
    let instrument = u.check.split_once(':').map_or("", |(_, i)| i);
    NotProven {
        check: u.check.clone(),
        obligation: u.obligation.clone(),
        when: u.when.clone(),
        line: super::not_proven_line(&u.check, &u.obligation, &u.when),
        config_hint: if u.declarable {
            config_hint(concern, instrument).unwrap_or_default()
        } else {
            String::new()
        },
    }
}

/// An unknown a `practices:` line naming its instrument makes known: one that is so
/// only for the instrument (unclassified, opaque, unresolved, or a dynamic middleware),
/// never for an unparsed file or a missing symbol.
fn declarable(reason: UnknownReason) -> bool {
    matches!(
        reason,
        UnknownReason::Unclassified
            | UnknownReason::OpaqueWrapper
            | UnknownReason::Unresolved
            | UnknownReason::Dynamic
    )
}

/// The package's middleware enforces nothing: its body is read to the end (every
/// in-repo callee defined, nothing unresolved) and it rejects no one (a Clerk
/// `clerkMiddleware()` with no `protect`). Such a middleware covers no route.
fn reads_as_open(cx: &Cx<'_>, m: &Middleware<'_>) -> bool {
    let ctx = cx.context();
    let Some(d) = ctx.definition(&m.symbol) else {
        return false;
    };
    let readable = d
        .calls
        .iter()
        .chain(d.wraps.iter().map(|w| &w.wrapper))
        .filter(|c| !c.ends_with("(new)"))
        .all(|c| {
            let c = c.trim_end_matches("(ref)");
            !c.starts_with("unresolved:") && (external(c) || ctx.definition(c).is_some())
        });
    readable && !crate::security::authenticates(ctx, &m.symbol)
}

/// A unit made known by a person's declaration of `instrument`.
fn declared_known(instrument: &str, label: &str) -> Outcome {
    Outcome::Known {
        key: VariantKey::new(&[Use {
            mechanism: "declared".into(),
            instrument: instrument.to_string(),
        }]),
        label: declared_words(label, &[instrument]),
        source: VariantSource::Declared,
    }
}

/// What a unit known by a person's word says: its label, and that the symbols are
/// declared in `.drift/config.yaml`, not proven ("rule access (declared in
/// .drift/config.yaml: RuleBook._ensure_access)").
fn declared_words(label: &str, instruments: &[&str]) -> String {
    let names: Vec<&str> = instruments
        .iter()
        .map(|i| i.rsplit_once('#').map_or(*i, |(_, n)| n))
        .collect();
    format!(
        "{label} (declared in {}: {})",
        crate::policy::CONFIG_FILE,
        names.join(", ")
    )
}

/// The concerns where a declaration settles a unit only where the unit runs the
/// declared symbol on every path (the approved rule): the ones that say who may call.
const EVERY_PATH_CONCERNS: &[&str] = &[AUTHN, AUTHZ];

/// How deep [`short_of_every_path`] follows calls that run on every path.
const EVERY_PATH_DEPTH: usize = 4;

/// The calls one body makes, as [`short_of_every_path`] reads them.
struct CallsOf<'a> {
    calls: &'a [String],
    receiver_calls: &'a [String],
    conditional_calls: &'a [String],
}

impl<'a> CallsOf<'a> {
    /// The body `r` names: a function's, or a method's of its class.
    fn of(ctx: &crate::context::RepoContext<'a>, r: &str) -> Option<CallsOf<'a>> {
        if super::common::external(r) {
            return None;
        }
        let d = ctx.definition(r)?;
        let name = r.split_once('#').map_or(r, |(_, n)| n);
        if d.name == name || d.exported_as.iter().any(|e| e == name) {
            return Some(CallsOf::symbol(d));
        }
        // `Class.method`: the method's own body, never the class's.
        let method = name.strip_prefix(&format!("{}.", d.name))?;
        let m = d.members.iter().find(|m| m.name == method)?;
        Some(CallsOf {
            calls: &m.calls,
            receiver_calls: &m.receiver_calls,
            conditional_calls: &m.conditional_calls,
        })
    }

    fn symbol(s: &'a Symbol) -> CallsOf<'a> {
        CallsOf {
            calls: &s.calls,
            receiver_calls: &s.receiver_calls,
            conditional_calls: &s.conditional_calls,
        }
    }
}

/// Why the unit is not shown to run `instrument` on every path, as an obligation
/// ([`obligation`]); `None` when it does: the instrument wraps the unit (a decorator, a
/// dependency, a base, its mount's wrappers), is middleware every application serving
/// it runs, or is called from the handler (or a dependency's body) through calls none
/// of which is conditional ([`Symbol::conditional_calls`]), at most
/// [`EVERY_PATH_DEPTH`] calls down. A call found only where some requests do not get
/// says why ([`drift_core::not_always`]); one not found at all is
/// [`obligation::PATH_UNREAD`]. What is not read is never taken as every path.
fn short_of_every_path<'a>(
    cx: &Cx<'a>,
    env: &Env<'a>,
    u: &UnitRef<'a>,
    instrument: &str,
) -> Option<&'static str> {
    short_of_every_path_in(cx, symbol_file(env, u), u, instrument)
}

/// [`short_of_every_path`] where the file of the unit's symbol is known.
fn short_of_every_path_in<'a>(
    cx: &Cx<'a>,
    file: Option<&'a FileFacts>,
    u: &UnitRef<'a>,
    instrument: &str,
) -> Option<&'static str> {
    let want = norm_ref(instrument.trim_end_matches("(ref)")).into_owned();
    let Some(s) = unit_symbol(u) else {
        return Some(obligation::PATH_UNREAD);
    };
    let classes = file
        .map(|f| super::common::owning_classes(f, s))
        .unwrap_or_default();
    let wraps: Vec<&drift_core::Wrap> = u
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps))
        .filter(|w| !matches!(w.kind, WrapKind::Jsx | WrapKind::Try))
        .collect();
    if wraps.iter().any(|w| norm_ref(&w.wrapper) == want) {
        return None;
    }
    for m in s.app_middleware.iter().chain(u.mount_middleware()) {
        if norm_ref(m) == want {
            return None;
        }
    }
    // Called from the body: the body must let what the call refuses stop the request.
    if let Some(why) = declaration_blocked(cx, u, instrument) {
        return Some(why);
    }
    let ctx = cx.context();
    let mut level: Vec<CallsOf<'a>> = vec![CallsOf::symbol(s)];
    // A dependency's body runs before the handler's, for every request.
    level.extend(
        wraps
            .iter()
            .filter(|w| matches!(w.kind, WrapKind::Call | WrapKind::Decorator))
            .filter_map(|w| CallsOf::of(ctx, &norm_ref(&w.wrapper))),
    );
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut conditional: Option<&'static str> = None;
    for _ in 0..=EVERY_PATH_DEPTH {
        let mut next = Vec::new();
        for b in &level {
            let why_of = |c: &str| {
                b.conditional_calls.iter().find_map(|x| {
                    let (why, callee) = x.split_once(':')?;
                    (norm_ref(callee) == c).then_some(why)
                })
            };
            for c in b.calls.iter().chain(b.receiver_calls) {
                if c.ends_with("(ref)") {
                    continue;
                }
                let c = norm_ref(c.trim_end_matches("(new)")).into_owned();
                if let Some(why) = why_of(&c) {
                    if c == want && conditional.is_none() {
                        conditional = Some(obligation::of_not_always(why));
                    }
                    continue;
                }
                if c == want {
                    return None;
                }
                if seen.insert(c.clone())
                    && let Some(body) = CallsOf::of(ctx, &c)
                {
                    next.push(body);
                }
            }
        }
        level = next;
    }
    Some(conditional.unwrap_or(obligation::PATH_UNREAD))
}

/// The symbol a person declared for `concern` that the entry point `entry` of `file`
/// runs on every path, through the calls the reading follows
/// ([`short_of_every_path`]), with the person's label: what `drift security` lists as
/// the route's declared guard (of `only`, where one is asked for). `None` where no
/// declared symbol is shown to run.
pub(crate) fn declared_on_every_path<'a>(
    cx: &Cx<'a>,
    file: &'a FileFacts,
    entry: &'a drift_core::EntryPoint,
    concern: &str,
    only: Option<&str>,
) -> Option<(&'a str, &'a str)> {
    if !EVERY_PATH_CONCERNS.contains(&concern) {
        return None;
    }
    let handler = super::common::handler(cx.facts, file, &entry.symbol);
    let u = UnitRef::Entry {
        file,
        entry,
        symbol: handler.map(|(_, s)| s),
    };
    let home = handler.map(|(f, _)| f).or(Some(file));
    cx.declared
        .get(concern)?
        .iter()
        .filter(|(symbol, _)| only.is_none_or(|o| norm_ref(o) == norm_ref(symbol)))
        .find(|(symbol, _)| short_of_every_path_in(cx, home, &u, symbol).is_none())
        .map(|(symbol, label)| (symbol.as_str(), label.as_str()))
}

/// Why the unit's own body is not shown to stop the request where a declared symbol
/// it calls refuses, or to check the record the request acts on: a person vouches for
/// what the symbol does, not for this. `None` where nothing of these is read in it.
///
/// - an exit no fact records ([`drift_core::controls::UNREAD_EXIT`]: an `assert`,
///   which `python -O` drops) or a context manager of the repository (a class with
///   `__exit__`, a `@contextmanager` function), whose exit may swallow what is raised
///   inside it: [`obligation::PATH_UNREAD`], [`obligation::SWALLOWED`];
/// - a `catch` / `except` clause that neither raises again nor answers with an error
///   ([`drift_core::CatchFact::does`]), and a promise combinator that settles whatever
///   the promises it is given do (`Promise.allSettled`, `any`, `race`):
///   [`obligation::SWALLOWED`];
/// - a method called on an object of the repository's class built in the body
///   (`RuleBook(System()).read(id)`), which is not shown to hold the request's
///   caller: [`obligation::PATH_UNREAD`];
/// - a call of a method of the declared symbol's own class whose value the body drops
///   (`service.read(other_id)` before `return {"id": rule_id}`): what the method
///   checked and handed back is not what the route answers with:
///   [`obligation::PATH_UNREAD`].
fn declaration_blocked<'a>(cx: &Cx<'a>, u: &UnitRef<'a>, instrument: &str) -> Option<&'static str> {
    let s = unit_symbol(u)?;
    let ctx = cx.context();
    if s.controls
        .iter()
        .any(|c| c == drift_core::controls::UNREAD_EXIT)
    {
        return Some(obligation::PATH_UNREAD);
    }
    let swallowing_catch = s.catches.iter().any(|c| {
        !c.does.iter().any(|d| {
            d == "rethrow"
                || d.starts_with("throw:")
                || d.strip_prefix("respond:")
                    .and_then(|n| n.parse::<u16>().ok())
                    .is_some_and(|n| n >= 400)
        })
    });
    if swallowing_catch {
        return Some(obligation::SWALLOWED);
    }
    let want = norm_ref(instrument.trim_end_matches("(ref)")).into_owned();
    // The declared symbol's class and method, for a method (`file#Class.method`).
    let (class, method) = match want.rsplit_once('.') {
        Some((c, m)) if c.contains('#') => (Some(c.to_string()), m.to_string()),
        _ => (None, String::new()),
    };
    let wrapped = |r: &str| s.wraps.iter().any(|w| norm_ref(&w.wrapper) == r);
    for c in s.calls.iter().chain(&s.receiver_calls) {
        let c = norm_ref(c.trim_end_matches("(ref)").trim_end_matches("(new)")).into_owned();
        if let Some(name) = c.strip_prefix("global#Promise.")
            && matches!(name, "allSettled" | "any" | "race")
        {
            return Some(obligation::SWALLOWED);
        }
        if let Some(d) = ctx.definition(&c) {
            let cm = d
                .members
                .iter()
                .any(|m| m.name == "__exit__" || m.name == "__aexit__")
                || d.wraps.iter().any(|w| {
                    w.kind == WrapKind::Decorator
                        && (w.wrapper.ends_with("#contextmanager")
                            || w.wrapper.ends_with("#asynccontextmanager"))
                });
            if cm && (d.name == c.rsplit(['#', '.']).next().unwrap_or_default()) {
                return Some(obligation::SWALLOWED);
            }
        }
        if let Some((built, _)) = c.split_once("().")
            && !wrapped(built)
            && ctx
                .definition(built)
                .is_some_and(|d| d.kind == drift_core::SymbolKind::Class)
        {
            return Some(obligation::PATH_UNREAD);
        }
    }
    if let Some(class) = &class
        && let Some(d) = ctx.definition(class)
    {
        for x in &s.conditional_calls {
            let Some((why, callee)) = x.split_once(':') else {
                continue;
            };
            let callee = norm_ref(callee);
            let called = callee.rsplit('.').next().unwrap_or_default();
            if why == obligation::NOT_AWAITED
                && callee != want
                && called != method
                && d.members.iter().any(|m| m.name == called)
            {
                return Some(obligation::PATH_UNREAD);
            }
        }
    }
    None
}

/// A unit a person declared a symbol for that it does not run on every path: unknown,
/// with the declaration as a check found and not proven ([`short_of_every_path`]).
fn declared_not_proven(instrument: &str, why: &'static str) -> (Outcome, Option<Unproven>) {
    (
        Outcome::Unknown {
            reason: UnknownReason::CheckNotProven,
            instrument: instrument.to_string(),
        },
        Some(Unproven {
            check: format!("declared:{}", norm_ref(instrument)),
            obligation: why.to_string(),
            when: String::new(),
            declarable: false,
        }),
    )
}

/// The symbol a unit is about, when it has one.
fn unit_symbol<'a>(u: &UnitRef<'a>) -> Option<&'a Symbol> {
    match *u {
        UnitRef::Entry { symbol, .. } => symbol,
        UnitRef::Symbol { symbol, .. } | UnitRef::Catch { symbol, .. } => Some(symbol),
        UnitRef::TestFile { .. } | UnitRef::File { .. } => None,
    }
}

/// The file of the symbol a unit is about (another file for a re-exported handler).
fn symbol_file<'a>(env: &Env<'a>, u: &UnitRef<'a>) -> Option<&'a FileFacts> {
    let s = unit_symbol(u)?;
    let f = u.file();
    if f.symbols.iter().any(|x| std::ptr::eq(x, s)) {
        return Some(f);
    }
    env.facts
        .files
        .iter()
        .find(|f| f.symbols.iter().any(|x| std::ptr::eq(x, s)))
}

/// The [STRICT] rules (module docs) applied to one classifier assignment, with the
/// check a declaration did not settle when that is why the unit is unknown
/// ([`declared_not_proven`]).
fn enforce<'a>(
    concern: &str,
    cx: &Cx<'a>,
    env: &Env<'a>,
    u: &UnitRef<'a>,
    a: Assignment,
    g: Guards,
    vouchable: bool,
) -> (Outcome, Option<Unproven>) {
    // A declaration settles a unit of who may call only where the unit runs the
    // declared symbol on every path (the approved rule).
    let every_path = EVERY_PATH_CONCERNS.contains(&concern);
    let short = |instrument: &str| {
        if every_path {
            short_of_every_path(cx, env, u, instrument)
        } else {
            None
        }
    };
    let outcome = |o: Outcome| (o, None);
    let unknown = |reason: UnknownReason, instrument: &str| {
        outcome(Outcome::Unknown {
            reason,
            instrument: instrument.to_string(),
        })
    };
    if g.unparsed {
        let own = env.unparsed.contains(u.file().path.as_str())
            || symbol_file(env, u).is_some_and(|f| env.unparsed.contains(f.path.as_str()));
        if own && !matches!(a, Assignment::Unknown { .. }) {
            return unknown(UnknownReason::Unparsed, "");
        }
    }
    // The package's middleware, joined to the route (authn entry points only).
    let coverage = match u {
        UnitRef::Entry { file, entry, .. } if g.matcher && concern == AUTHN => env
            .middleware
            .get(file.package.as_str())
            .filter(|m| !reads_as_open(cx, m))
            .map(|m| (matcher::coverage(m.matchers, entry.route.as_deref()), m)),
        _ => None,
    };
    match a {
        Assignment::Unknown { reason, instrument } => {
            // A person named the instrument: it is known. A found check that is not
            // proven is settled so only where the unit calls its symbol on every path
            // (`vouchable`): the person vouches for what the symbol does, not for the
            // unit reaching it.
            if reason == UnknownReason::CheckNotProven
                && vouchable
                && let Some(label) = cx.declared_label(concern, &instrument)
            {
                return match declaration_blocked(cx, u, &instrument) {
                    None => outcome(declared_known(&instrument, label)),
                    Some(why) => declared_not_proven(&instrument, why),
                };
            }
            if declarable(reason)
                && let Some(label) = cx.declared_label(concern, &instrument)
            {
                return match short(&instrument) {
                    None => outcome(declared_known(&instrument, label)),
                    Some(why) => declared_not_proven(&instrument, why),
                };
            }
            outcome(Outcome::Unknown { reason, instrument })
        }
        Assignment::Known {
            uses,
            label,
            mut source,
        } => {
            let mut kept: Vec<Use> = Vec::with_capacity(uses.len());
            let mut changed = false;
            let mut declared: Vec<String> = Vec::new();
            for use_ in uses {
                if cx.declared_label(concern, &use_.instrument).is_some() {
                    // The package's middleware is the unit's where its matchers cover
                    // the route; anything else, where the unit runs it on every path.
                    let covered = use_.mechanism == "middleware"
                        && matches!(coverage, Some((Tri::Covers, _)));
                    if !covered && let Some(why) = short(&use_.instrument) {
                        return declared_not_proven(&use_.instrument, why);
                    }
                    source = VariantSource::Declared;
                    declared.push(use_.instrument.clone());
                    kept.push(use_);
                    continue;
                }
                // Before the guard filter, so an unknown instrument is never dropped.
                if g.unknown_dominates
                    && let Some(r) = unknown_instrument(&use_.instrument)
                {
                    return unknown(r, &use_.instrument);
                }
                let m = use_.mechanism.as_str();
                if g.guard_filter && concern == AUTHN {
                    let i = norm_ref(&use_.instrument).into_owned();
                    // A Python unit's wrappers and body calls are read where they
                    // stand, with how they are written there: an instrument proven
                    // so is a guard of this unit where the instrument alone does
                    // not say it (a scheme is one by how its instance was built).
                    let in_place = super::authn::proven_in_place(cx, u, &i);
                    if in_place {
                    } else if WRAP_MECHANISMS.contains(&m) {
                        // What a guard position's reading proved by the closed
                        // lists ([`crate::guard_position`]) is named by the list's
                        // own export.
                        // And what a TypeScript definition proves by what it does
                        // is a guard whatever its name says.
                        let by_body = !external(&i)
                            && !i.split('#').next().is_some_and(|m| m.ends_with(".py"))
                            && crate::security::proving_root(cx.context(), &i).is_some();
                        if !crate::security::authenticates(cx.context(), &i)
                            && !drift_core::guard_lists::listed_guard(&use_.instrument)
                            && !by_body
                        {
                            // A package's export no guard list knows is not proven to
                            // turn no one away; an in-repo one without a definition
                            // cannot be read. Only a definition read to the end that
                            // rejects no one (`get_db`) is dropped.
                            if external(&i) {
                                return unknown(UnknownReason::Unclassified, &use_.instrument);
                            }
                            if cx.context().definition(&i).is_none() {
                                return unknown(UnknownReason::OpaqueWrapper, &use_.instrument);
                            }
                            changed = true;
                            continue;
                        }
                    } else if CALL_MECHANISMS.contains(&m)
                        && !crate::security::callee_is_guard(cx.context(), &i)
                    {
                        changed = true;
                        continue;
                    }
                }
                if m == "middleware"
                    && let Some((cov, mw)) = &coverage
                {
                    match cov {
                        Tri::Covers => {}
                        Tri::Excludes => {
                            changed = true;
                            continue;
                        }
                        Tri::Indeterminate => {
                            return unknown(UnknownReason::Dynamic, &mw.instrument);
                        }
                    }
                }
                if g.unknown_dominates
                    && g.unparsed
                    && internal_path(&use_.instrument).is_some_and(|p| env.unparsed.contains(p))
                {
                    return unknown(UnknownReason::Unparsed, &use_.instrument);
                }
                kept.push(use_);
            }
            if changed && kept.is_empty() {
                return outcome(none_or_unknown(
                    concern,
                    cx,
                    u,
                    super::basis::AUTHN_NONE_WRAPPED.to_string(),
                    g,
                    coverage,
                ));
            }
            let key = VariantKey::new(&kept);
            let mut label = if changed { label_of(&key.uses) } else { label };
            if !declared.is_empty() {
                // The person's own words where the unit does nothing else.
                if declared.len() == key.uses.len() {
                    let words: Vec<&str> = declared
                        .iter()
                        .filter_map(|i| cx.declared_label(concern, i))
                        .collect();
                    label = words.join(" + ");
                }
                let declared: Vec<&str> = declared.iter().map(String::as_str).collect();
                label = declared_words(&label, &declared);
            }
            outcome(Outcome::Known { key, label, source })
        }
        Assignment::None { label } => {
            // A symbol a person declared for the concern that the unit runs on every
            // path, through the calls the reading follows (`via` calls `helper`, which
            // calls `require_user`), is the unit's: the declaration settles it as it
            // does where the handler calls the symbol itself.
            if every_path
                && let Some((symbol, words)) = cx
                    .declared
                    .get(concern)
                    .and_then(|table| table.iter().find(|(symbol, _)| short(symbol).is_none()))
            {
                return outcome(declared_known(symbol, words));
            }
            outcome(none_or_unknown(concern, cx, u, label, g, coverage))
        }
    }
}

/// The key an authz unit leaves unscoped ([`Concern::unscoped_key`]): asked only of a
/// recorded absence or a known assignment, never of an unknown one, with the package's
/// middleware among what runs before the unit.
fn unscoped_key<'a>(
    c: &dyn Concern,
    cx: &Cx<'a>,
    env: &Env<'a>,
    u: &UnitRef<'a>,
    outcome: &Outcome,
) -> Option<String> {
    let uses: &[Use] = match outcome {
        Outcome::None { .. } => &[],
        Outcome::Known { key, .. } | Outcome::Identified { key, .. } => &key.uses,
        Outcome::Unknown { .. } => return None,
    };
    let middleware = env
        .middleware
        .get(u.file().package.as_str())
        .map(|m| m.symbol.as_str());
    c.unscoped_key(cx, u, uses, middleware)
}

/// A recorded absence, unless something on the unit could be doing the concern unseen
/// ([`Guards::false_none`], [`Guards::matcher`]).
fn none_or_unknown<'a>(
    concern: &str,
    cx: &Cx<'a>,
    u: &UnitRef<'a>,
    label: String,
    g: Guards,
    coverage: Option<(Tri, &Middleware)>,
) -> Outcome {
    let unknown = |reason: UnknownReason, instrument: &str| Outcome::Unknown {
        reason,
        instrument: instrument.to_string(),
    };
    if g.false_none {
        if let UnitRef::Entry { symbol: None, .. } = u {
            return unknown(UnknownReason::NoSymbol, "");
        }
        if WRAPPER_CONCERNS.contains(&concern)
            && let Some(s) = unit_symbol(u)
        {
            for w in u.mount_wraps().iter().chain(&s.wraps) {
                if !matches!(
                    w.kind,
                    WrapKind::Call | WrapKind::Decorator | WrapKind::Extends
                ) {
                    continue;
                }
                let r = norm_ref(&w.wrapper);
                if r.starts_with("unresolved:") {
                    return unknown(UnknownReason::Unresolved, &w.wrapper);
                }
                if !external(&r) && cx.context().definition(&r).is_none() {
                    // A person named it for this concern: the unit uses it.
                    if let Some(label) = cx.declared_label(concern, &w.wrapper) {
                        return declared_known(&w.wrapper, label);
                    }
                    return unknown(UnknownReason::OpaqueWrapper, &w.wrapper);
                }
            }
        }
    }
    match coverage {
        Some((Tri::Indeterminate, mw)) => unknown(UnknownReason::Dynamic, &mw.instrument),
        // The middleware runs on this route and nothing lets it through: unless its
        // definition was read and rejects no one, it may be the guard.
        Some((Tri::Covers, mw)) => {
            let i = mw.instrument.as_str();
            let proven_open = !external(i)
                && cx.context().definition(i).is_some()
                && !crate::security::authenticates(cx.context(), i);
            if proven_open {
                Outcome::None { label }
            } else if let Some(l) = cx.declared_label(concern, i) {
                declared_known(i, l)
            } else {
                unknown(UnknownReason::Unclassified, i)
            }
        }
        _ => Outcome::None { label },
    }
}

/// A variant while it is built.
struct Group {
    key: VariantKey,
    kind: VariantKind,
    members: Vec<usize>,
    labels: BTreeMap<String, usize>,
    sources: BTreeMap<VariantSource, usize>,
}

impl Group {
    fn new(key: VariantKey, kind: VariantKind) -> Self {
        Group {
            key,
            kind,
            members: Vec::new(),
            labels: BTreeMap::new(),
            sources: BTreeMap::new(),
        }
    }

    fn add(&mut self, i: usize, label: &str, source: VariantSource) {
        self.members.push(i);
        *self.labels.entry(label.to_string()).or_default() += 1;
        *self.sources.entry(source).or_default() += 1;
    }

    /// The most common, then the least.
    fn top<T: Ord + Clone>(m: &BTreeMap<T, usize>) -> Option<T> {
        m.iter()
            .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
            .map(|(k, _)| k.clone())
    }

    fn is_tail(&self) -> bool {
        self.key.key == TAIL
    }
}

pub(super) fn ratio(a: usize, b: usize) -> f64 {
    if b == 0 { 0.0 } else { a as f64 / b as f64 }
}

/// `(value, members)` counts, most members first, then by value; at most `cap`.
fn counted<T: Ord + Clone>(items: impl Iterator<Item = T>, cap: usize) -> Vec<(T, usize)> {
    let mut m: BTreeMap<T, usize> = BTreeMap::new();
    for i in items {
        *m.entry(i).or_default() += 1;
    }
    let mut v: Vec<(T, usize)> = m.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(cap);
    v
}

/// The stack of a thread the engine starts: what the main thread, where the
/// classifiers ran before, has on Linux and macOS.
const STACK: usize = 8 * 1024 * 1024;

/// `a` and `b`, both run to their end: `a` on a thread of its own while `b` runs
/// here. Where no thread can be started, `a` runs here after `b`; a panic in it is
/// passed on.
fn beside<A: Send, B>(a: impl Fn() -> A + Sync, b: impl FnOnce() -> B) -> (A, B) {
    std::thread::scope(|s| {
        let thread = std::thread::Builder::new()
            .stack_size(STACK)
            .spawn_scoped(s, &a);
        let b = b();
        let a = match thread {
            Ok(t) => t
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
            Err(_) => a(),
        };
        (a, b)
    })
}

/// `f(0)`, `f(1)`, ... `f(n - 1)`, in that order whatever order they finish in: the
/// first here, the others each on a thread of its own. One no thread can be started
/// for runs here after the first; a panic in any is passed on.
fn side_by_side<T: Send>(n: usize, f: impl Fn(usize) -> T + Sync) -> Vec<T> {
    std::thread::scope(|s| {
        let f = &f;
        let threads: Vec<_> = (1..n)
            .map(|i| {
                std::thread::Builder::new()
                    .stack_size(STACK)
                    .spawn_scoped(s, move || f(i))
                    .ok()
            })
            .collect();
        let first = (n > 0).then(|| f(0));
        let rest = threads.into_iter().enumerate().map(|(i, t)| match t {
            Some(t) => t
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
            None => f(i + 1),
        });
        first.into_iter().chain(rest).collect()
    })
}

/// One concern's run, for the recipes and findings after the reports.
struct ConcernRun {
    id: &'static str,
    placed: Vec<Placed>,
    /// Each unit's top-level variant id, or `unknown`.
    of_unit: Vec<String>,
}

pub(super) fn run(
    facts: &RepoFacts,
    opts: &Options,
    classifiers: &[Box<dyn Concern>],
    g: Guards,
) -> Run {
    // The practice map is of every entry point Drift lists, the ones mining does not
    // read yet included ([`drift_core::Listed`]).
    let listed = facts.listed();
    let facts = &*listed;
    let cx = Cx::new(facts, &opts.declared);
    // The repo context every entry-point classifier reads is built while the places
    // are: neither reads the other. Not for facts with no entry point, which may never
    // ask for it.
    let entries = facts.files.iter().any(|f| !f.entry_points.is_empty());
    let (_, env) = beside(
        || {
            if entries {
                cx.context();
            }
        },
        || Env::new(facts, opts),
    );
    let scope_package = opts.scope.package.as_deref().map(|p| {
        if p == "." {
            ""
        } else {
            p.trim_end_matches('/')
        }
    });
    let scope_path = opts
        .scope
        .path
        .as_deref()
        .map(|p| p.trim_start_matches("./"));
    // Every registered concern is assigned, in scope or not, so the cross-concern
    // attributes do not depend on `--concern`.
    // The concerns are assigned side by side: none reads another's units here (the
    // cross-concern attributes are added below, from all of them), and each one's
    // units come out in its own order whichever finishes first.
    let registered: Vec<(&'static str, &'static str, &dyn Concern)> = CONCERNS
        .iter()
        .filter_map(|&(id, title)| {
            let c = classifiers.iter().find(|c| c.id() == id)?;
            Some((id, title, c.as_ref()))
        })
        .collect();
    let mut assigned: Vec<(
        &'static str,
        &'static str,
        &'static str,
        Vec<Placed>,
        LeftOut,
    )> = side_by_side(registered.len(), |i| {
        let (id, title, c) = registered[i];
        let mut left_out = LeftOut::default();
        let mut placed: Vec<Placed> = Vec::new();
        for u in c.population(&cx) {
            let f = u.file();
            if !matches!(u, UnitRef::TestFile { .. }) {
                if is_test_path(&f.path) {
                    left_out.tests += 1;
                    continue;
                }
                if env.non_production.dir_of(&f.path, &f.package).is_some() {
                    left_out.non_production += 1;
                    continue;
                }
            }
            if scope_package.is_some_and(|p| f.package != p)
                || scope_path.is_some_and(|p| f.path != p)
            {
                continue;
            }
            let (a, backing) = c.assign_backed(&cx, &u);
            let vouchable = backing.unproven.as_ref().is_some_and(|u| u.declarable);
            let (outcome, unsettled) = enforce(id, &cx, &env, &u, a, g, vouchable);
            let outcome = identified(id, outcome);
            let backing = match unsettled {
                Some(unproven) => Backing {
                    unproven: Some(unproven),
                    ..backing
                },
                None => backing,
            };
            let unscoped = if id == AUTHZ {
                unscoped_key(c, &cx, &env, &u, &outcome)
            } else {
                None
            };
            let mut p = env.place(&u, outcome);
            p.unscoped = unscoped;
            if let Outcome::Unknown { reason, instrument } = &p.outcome
                && declarable(*reason)
                && EVERY_PATH_CONCERNS.contains(&id)
            {
                p.unsettled = short_of_every_path(&cx, &env, &u, instrument).is_some();
            }
            // Only what is known has something behind it: never an unknown's, but
            // for the check that was found and not proven.
            match p.outcome {
                Outcome::Known { .. } => {
                    p.backing = Backing {
                        unproven: None,
                        ..backing
                    }
                }
                Outcome::Unknown {
                    reason: UnknownReason::CheckNotProven,
                    ..
                } => p.backing.unproven = backing.unproven,
                // Nothing found in what was read: what that rests on.
                Outcome::None { .. } if EVERY_PATH_CONCERNS.contains(&id) => {
                    p.backing.basis = c.basis(&cx, &u, &backing);
                }
                _ => {}
            }
            placed.push(p);
        }
        placed.sort_by(|a, b| a.ident().cmp(&b.ident()));
        placed.dedup_by(|b, a| a.ident() == b.ident());
        (id, title, c.unit(), placed, left_out)
    });
    // An unscoped key is said only of a unit whose authentication is known: an
    // unknown there is an unknown here, and a unit no one signs in to has no caller.
    let signed_in: BTreeSet<UnitKey> = assigned
        .iter()
        .filter(|(id, ..)| *id == AUTHN)
        .flat_map(|(_, _, _, placed, _)| placed)
        .filter(|p| {
            matches!(&p.outcome, Outcome::Known { key, .. }
                if key.uses.iter().any(|u| super::authn::enforces(&u.mechanism)))
        })
        .map(Placed::unit_key)
        .collect();
    for (_, _, _, placed, _) in assigned.iter_mut().filter(|(id, ..)| *id == AUTHZ) {
        for p in placed.iter_mut() {
            if p.unscoped.is_some() && !signed_in.contains(&p.unit_key()) {
                p.unscoped = None;
            }
        }
    }
    // Cross-concern attributes: what each unit does for the other concerns.
    let mut cross: BTreeMap<(String, String, u32), BTreeSet<String>> = BTreeMap::new();
    for (id, _, _, placed, _) in &assigned {
        for p in placed {
            let set = cross
                .entry((p.path.clone(), p.symbol.clone(), p.line))
                .or_default();
            match &p.outcome {
                Outcome::Known { key, .. } | Outcome::Identified { key, .. } => {
                    for u in &key.uses {
                        set.insert(format!("wrap:{id}:{}:{}", u.mechanism, u.instrument));
                    }
                }
                Outcome::None { .. } => {
                    set.insert(format!("wrap:{id}:none"));
                }
                Outcome::Unknown { .. } => {}
            }
        }
    }
    for (id, _, _, placed, _) in &mut assigned {
        let own = format!("wrap:{id}:");
        for p in placed.iter_mut() {
            if let Some(set) = cross.get(&(p.path.clone(), p.symbol.clone(), p.line)) {
                p.attrs
                    .extend(set.iter().filter(|a| !a.starts_with(&own)).cloned());
            }
        }
    }
    let mut units = Vec::new();
    let mut concerns = Vec::new();
    let mut runs = Vec::new();
    // Each concern's report is of its own units: side by side too.
    let reports = side_by_side(assigned.len(), |i| {
        let (id, title, unit, placed, left_out) = &assigned[i];
        let (mut report, of_unit) = concern_report(id, title, unit, placed, left_out.clone());
        // What may be promoted is read from every unit, whether the report lists them
        // or not (`drift practices` does not by default): one reading, the one
        // `drift practices promote` makes ([`super::promote::fill_promotable`]).
        report.units = unit_rows(&report, placed, &of_unit);
        super::promote::fill_promotable(&mut report);
        if !opts.units {
            report.units = Vec::new();
        }
        (report, of_unit)
    });
    for ((id, _, _, placed, _), (report, of_unit)) in assigned.into_iter().zip(reports) {
        let in_scope = opts.scope.concern.as_deref().is_none_or(|c| c == id);
        if !in_scope {
            continue;
        }
        for (p, v) in placed.iter().zip(&of_unit) {
            units.push((id, p.path.clone(), v.clone()));
        }
        concerns.push(report);
        runs.push(ConcernRun {
            id,
            placed,
            of_unit,
        });
    }
    let mut summary = Summary {
        target: TARGET,
        ..Summary::default()
    };
    for c in &concerns {
        summary.population += c.population.total;
        summary.known += c.population.known;
        summary.declared += c.population.declared;
        summary.identified += c.population.identified;
        summary.none += c.population.none;
        summary.unknown += c.population.unknown;
        if c.population.total > 0 && c.population.coverage >= TARGET {
            summary.concerns_at_target += 1;
        }
    }
    summary.coverage = r3(ratio(
        summary.known + summary.identified + summary.none,
        summary.population,
    ));
    let recipes = recipes(&runs, &concerns);
    // Helpers defined more than once are no concern's: said of the whole map only.
    let duplicates = if opts.scope.concern.is_none() && !opts.skip_duplicates {
        super::dupes::findings(facts, scope_package, scope_path)
    } else {
        Vec::new()
    };
    let findings = findings(&runs, &concerns, duplicates);
    // Message consumers are a kind of their own: listed, in no concern's population.
    let mut consumers: Vec<super::Consumer> = Vec::new();
    if opts.scope.concern.is_none() {
        for f in &facts.files {
            if is_test_path(&f.path)
                || env.non_production.dir_of(&f.path, &f.package).is_some()
                || scope_package.is_some_and(|p| f.package != p)
                || scope_path.is_some_and(|p| f.path != p)
            {
                continue;
            }
            for e in f.entry_points.iter().filter(|e| e.kind == "consumer") {
                let line = f
                    .symbols
                    .iter()
                    .find(|s| s.name == e.symbol || s.exported_as.contains(&e.symbol))
                    .map_or(0, |s| s.line);
                consumers.push(super::Consumer {
                    path: f.path.clone(),
                    symbol: e.symbol.clone(),
                    line,
                    adapter: e.adapter.clone(),
                });
            }
        }
        consumers.sort();
        consumers.dedup();
    }
    Run {
        report: PracticesReport {
            version: VERSION,
            commit: opts.commit.clone(),
            facts_schema: drift_core::FACTS_SCHEMA_VERSION,
            scope: opts.scope.clone(),
            summary,
            concerns,
            not_covered: NOT_COVERED.iter().map(|s| s.to_string()).collect(),
            recipes,
            findings,
            consumers,
        },
        units,
        runs,
    }
}

/// Build one variant entry from its members.
fn variant_entry(
    concern: &str,
    placed: &[Placed],
    g: &Group,
    compare: &[usize],
    of_unit: &[String],
    package_total: &BTreeMap<&str, usize>,
) -> Variant {
    let members: Vec<&Placed> = g.members.iter().map(|&i| &placed[i]).collect();
    let n = members.len();
    let in_set: BTreeSet<usize> = g.members.iter().copied().collect();
    let mut placement = Where::default();
    for (pkg, k) in counted(members.iter().map(|p| p.package.clone()), caps::WHERE) {
        placement.packages.push(WherePackage {
            share_of_package: r3(ratio(k, package_total[pkg.as_str()])),
            package: pkg,
            members: k,
        });
    }
    placement.dirs = where_dirs(&members);
    placement.roles = counted(
        members.iter().flat_map(|p| p.roles.iter().cloned()),
        caps::WHERE,
    )
    .into_iter()
    .map(|(role, members)| WhereRole { role, members })
    .collect();
    placement.entry_kinds = counted(
        members.iter().filter_map(|p| p.entry_kind.clone()),
        caps::WHERE,
    )
    .into_iter()
    .map(|(kind, members)| WhereEntryKind { kind, members })
    .collect();
    placement.methods = counted(members.iter().filter_map(|p| p.method.clone()), caps::WHERE)
        .into_iter()
        .map(|(method, members)| WhereMethod { method, members })
        .collect();
    let (exceptions, exceptions_more) = if g.kind == VariantKind::Known && !g.is_tail() {
        exceptions_of(placed, &in_set, of_unit)
    } else {
        (Vec::new(), 0)
    };
    let key = &g.key;
    let mut mechanisms: Vec<String> = key.uses.iter().map(|u| u.mechanism.clone()).collect();
    mechanisms.sort();
    mechanisms.dedup();
    let instruments = instruments_of(g);
    Variant {
        id: variant_id(concern, &key.key),
        key: key.key.clone(),
        label: Group::top(&g.labels).unwrap_or_default(),
        kind: g.kind,
        mechanisms,
        source: Group::top(&g.sources).unwrap_or_default(),
        members: n,
        share: 0.0,
        placement,
        sets_apart: sets_apart(placed, &g.members, compare, &instruments),
        instruments,
        examples: examples_of(&members),
        exceptions,
        exceptions_more,
        conventions: Vec::new(),
        // Filled once every variant of the concern is known
        // ([`super::promote::fill_promotable`]).
        promotable: None,
        alternatives: Vec::new(),
        not_read: if g.kind == VariantKind::None {
            super::basis::Basis::union(
                g.members
                    .iter()
                    .filter_map(|&i| placed[i].backing.basis.as_ref()),
            )
        } else {
            Vec::new()
        },
    }
}

/// The caller class of a single-use authn key a split policy may fold, if any.
fn caller_class(key: &VariantKey) -> Option<&'static str> {
    let [u] = key.uses.as_slice() else {
        return None;
    };
    if u.mechanism == SERVICE_AUTHN {
        Some("service")
    } else if USER_AUTHN.contains(&u.mechanism.as_str()) {
        Some("user")
    } else {
        // `identifies` is not enforced and `opens` is declared public: neither folds.
        None
    }
}

/// The units of `g` that `keep` holds, as a group of the same key.
fn subgroup(placed: &[Placed], g: &Group, keep: impl Fn(usize) -> bool) -> Group {
    let mut out = Group::new(g.key.clone(), g.kind);
    for &i in g.members.iter().filter(|&&i| keep(i)) {
        let (label, source) = match &placed[i].outcome {
            Outcome::Known { label, source, .. } => (label.as_str(), *source),
            _ => ("", VariantSource::Usage),
        };
        out.add(i, label, source);
    }
    out
}

/// The instruments of a group's key, sorted; none for the tail.
fn instruments_of(g: &Group) -> Vec<String> {
    if g.is_tail() {
        return Vec::new();
    }
    let mut v: Vec<String> = g.key.uses.iter().map(|u| u.instrument.clone()).collect();
    v.sort();
    v.dedup();
    v
}

/// The split authn policies: package -> the two groups that are one policy there.
///
/// A policy is one package's, and so is the decision: it reads that package's own
/// units and nothing else. There, the variant most of its units use (each unit using
/// it alone, of one caller class) and the largest other one of the same class whose
/// units a structural attribute sets apart from the first's (a directory, the kind of
/// entry point, the method; [`sets_apart`] on the package's units) are alternatives
/// of one policy. What other packages do is their own fact: a route elsewhere that
/// uses one of the two guards neither enables the fold nor blocks it, and two
/// packages that each do it one way are two policies, never alternatives of one (a
/// recipe never names a mechanism its package does not use).
fn split_policies<'a>(placed: &'a [Placed], groups: &[Group]) -> BTreeMap<&'a str, (usize, usize)> {
    let mut out = BTreeMap::new();
    let packages: BTreeSet<&str> = placed.iter().map(|p| p.package.as_str()).collect();
    for pkg in packages {
        // The package's units of each known variant, most first, then by key.
        let mut here: Vec<(usize, Vec<usize>)> = groups
            .iter()
            .enumerate()
            .filter(|(_, g)| g.kind == VariantKind::Known && !g.is_tail())
            .map(|(gi, g)| {
                let members: Vec<usize> = g
                    .members
                    .iter()
                    .copied()
                    .filter(|&i| placed[i].package == pkg)
                    .collect();
                (gi, members)
            })
            .filter(|(_, m)| !m.is_empty())
            .collect();
        here.sort_by(|a, b| {
            b.1.len()
                .cmp(&a.1.len())
                .then(groups[a.0].key.key.cmp(&groups[b.0].key.key))
        });
        let Some((d, first)) = here.first() else {
            continue;
        };
        let Some(class) = caller_class(&groups[*d].key) else {
            continue;
        };
        let second = here[1..].iter().find(|(b, members)| {
            caller_class(&groups[*b].key) == Some(class)
                && sets_apart(placed, members, first, &instruments_of(&groups[*b]))
                    .iter()
                    .any(|s| STRUCTURAL.iter().any(|p| s.attribute.starts_with(p)))
        });
        if let Some((b, _)) = second {
            out.insert(pkg, (*d, *b));
        }
    }
    out
}

fn concern_report(
    id: &'static str,
    title: &str,
    unit: &str,
    placed: &[Placed],
    left_out: LeftOut,
) -> (ConcernReport, Vec<String>) {
    let total = placed.len();
    // Group.
    let mut known: BTreeMap<String, Group> = BTreeMap::new();
    let mut none: BTreeMap<String, Group> = BTreeMap::new();
    // Identified keys are never folded into the tail: the tail is of known ways.
    let mut identified: BTreeMap<String, Group> = BTreeMap::new();
    let mut unknown: Vec<usize> = Vec::new();
    for (i, p) in placed.iter().enumerate() {
        match &p.outcome {
            Outcome::Known { key, label, source } => known
                .entry(key.key.clone())
                .or_insert_with(|| Group::new(key.clone(), VariantKind::Known))
                .add(i, label, *source),
            Outcome::None { label } => {
                // The key is the variant's identity, not its text: it is hashed into
                // the P- id ([`super::basis::none_identity`]).
                let key = if label.is_empty() {
                    "none".to_string()
                } else {
                    format!("none:{}", super::basis::none_identity(label))
                };
                none.entry(key.clone())
                    .or_insert_with(|| {
                        let mut g = Group::new(VariantKey::default(), VariantKind::None);
                        g.key.key = key;
                        g
                    })
                    .add(i, label, VariantSource::Usage);
            }
            Outcome::Identified { key, label, source } => identified
                .entry(key.key.clone())
                .or_insert_with(|| Group::new(key.clone(), VariantKind::Identified))
                .add(i, label, *source),
            Outcome::Unknown { .. } => unknown.push(i),
        }
    }
    // Fold known keys with too few members into the tail.
    let mut groups: Vec<Group> = Vec::new();
    let mut tail = Group::new(
        VariantKey {
            uses: Vec::new(),
            key: TAIL.to_string(),
        },
        VariantKind::Known,
    );
    for (_, g) in known {
        if g.members.len() < MIN_VARIANT {
            for &i in &g.members {
                let (l, s) = match &placed[i].outcome {
                    Outcome::Known { label, source, .. } => (label.as_str(), *source),
                    _ => ("", VariantSource::Usage),
                };
                tail.add(i, l, s);
                tail.key.uses.extend(g.key.uses.iter().cloned());
            }
        } else {
            groups.push(g);
        }
    }
    if !tail.members.is_empty() {
        tail.labels = BTreeMap::from([(
            format!(
                "other ways, one unit each ({} unit{})",
                tail.members.len(),
                if tail.members.len() == 1 { "" } else { "s" }
            ),
            1,
        )]);
        tail.key.uses.sort();
        tail.key.uses.dedup();
        groups.push(tail);
    }
    groups.extend(identified.into_values());
    groups.extend(none.into_values());
    let order = |a: &Group, b: &Group| {
        b.members
            .len()
            .cmp(&a.members.len())
            .then(a.key.key.cmp(&b.key.key))
    };
    groups.sort_by(order);
    let mut package_total: BTreeMap<&str, usize> = BTreeMap::new();
    for p in placed {
        *package_total.entry(p.package.as_str()).or_default() += 1;
    }
    // Each unit's own variant, before folding.
    let own_ids: Vec<String> = groups.iter().map(|g| variant_id(id, &g.key.key)).collect();
    let mut of_unit: Vec<String> = vec!["unknown".to_string(); total];
    for (gi, g) in groups.iter().enumerate() {
        for &i in &g.members {
            of_unit[i] = own_ids[gi].clone();
        }
    }
    let dominant = groups
        .iter()
        .position(|g| g.kind == VariantKind::Known && !g.is_tail());
    let compare_of = |gi: usize, members: &[usize]| -> Vec<usize> {
        let in_set: BTreeSet<usize> = members.iter().copied().collect();
        match dominant {
            Some(d) if d != gi => groups[d].members.clone(),
            _ => (0..total).filter(|i| !in_set.contains(i)).collect(),
        }
    };
    let entry = |gi: usize, of_unit: &[String]| {
        variant_entry(
            id,
            placed,
            &groups[gi],
            &compare_of(gi, &groups[gi].members),
            of_unit,
            &package_total,
        )
    };
    let mut variants: Vec<Variant> = (0..groups.len()).map(|gi| entry(gi, &of_unit)).collect();
    // Split authn policies, each decided in one package from that package's own units
    // ([`split_policies`]).
    let pairs = if id == AUTHN {
        split_policies(placed, &groups)
    } else {
        BTreeMap::new()
    };
    if !pairs.is_empty() {
        let mut group_of: Vec<Option<usize>> = vec![None; total];
        for (gi, g) in groups.iter().enumerate() {
            for &i in &g.members {
                group_of[i] = Some(gi);
            }
        }
        // Fold key -> its two sides (by key) and the units folded, in unit order. The
        // packages that fold the same two variants share one policy.
        let mut folded: BTreeMap<String, ([usize; 2], Vec<usize>)> = BTreeMap::new();
        for (i, p) in placed.iter().enumerate() {
            if let Some(gi) = group_of[i]
                && let Some(&(x, y)) = pairs.get(p.package.as_str())
                && (gi == x || gi == y)
            {
                let mut sides = [x, y];
                sides.sort_by(|a, b| groups[*a].key.key.cmp(&groups[*b].key.key));
                let key = format!(
                    "any_of({}|{})",
                    groups[sides[0]].key.key, groups[sides[1]].key.key
                );
                folded.entry(key).or_insert((sides, Vec::new())).1.push(i);
            }
        }
        // The alternatives read each unit's own variant, the rest the folded policy's.
        let own_of_unit = of_unit.clone();
        let mut in_fold = vec![false; total];
        for (key, (_, members)) in &folded {
            let fold_id = variant_id(id, key);
            for &i in members {
                of_unit[i] = fold_id.clone();
                in_fold[i] = true;
            }
        }
        let outside = |members: &[usize]| -> Vec<usize> {
            let in_set: BTreeSet<usize> = members.iter().copied().collect();
            (0..total).filter(|i| !in_set.contains(i)).collect()
        };
        let mut next: Vec<Variant> = Vec::new();
        let mut is_side = vec![false; groups.len()];
        for (key, (sides, members)) in &folded {
            let in_set: BTreeSet<usize> = members.iter().copied().collect();
            // Each side's units in the fold: the larger first, then by key.
            let mut parts: Vec<Group> = sides
                .iter()
                .map(|&s| subgroup(placed, &groups[s], |i| in_set.contains(&i)))
                .collect();
            parts.sort_by(order);
            let mut alts: Vec<Variant> = Vec::new();
            for (n, part) in parts.iter().enumerate() {
                // The first as a dominant variant is read (against every other unit),
                // the second against the first.
                let compare = if n == 0 {
                    outside(&part.members)
                } else {
                    parts[0].members.clone()
                };
                let mut a = variant_entry(id, placed, part, &compare, &own_of_unit, &package_total);
                a.share = r3(ratio(a.members, total));
                alts.push(a);
            }
            let mut fold = Group::new(
                VariantKey {
                    uses: Vec::new(),
                    key: key.clone(),
                },
                VariantKind::Known,
            );
            fold.members = members.clone();
            for part in &parts {
                fold.key.uses.extend(part.key.uses.iter().cloned());
                for (s, n) in &part.sources {
                    *fold.sources.entry(*s).or_default() += n;
                }
            }
            fold.key.uses.sort();
            fold.labels
                .insert(format!("{}, or {}", alts[0].label, alts[1].label), 1);
            let mut v = variant_entry(
                id,
                placed,
                &fold,
                &outside(&fold.members),
                &of_unit,
                &package_total,
            );
            alts.sort_by(|x, y| x.key.cmp(&y.key));
            v.alternatives = alts;
            next.push(v);
            for &s in sides {
                is_side[s] = true;
            }
        }
        for (gi, g) in groups.iter().enumerate() {
            if is_side[gi] {
                // What another package does with one of the two alone stays its own
                // variant, with the units that are not in a fold.
                let rest = subgroup(placed, g, |i| !in_fold[i]);
                if !rest.members.is_empty() {
                    next.push(variant_entry(
                        id,
                        placed,
                        &rest,
                        &compare_of(gi, &rest.members),
                        &of_unit,
                        &package_total,
                    ));
                }
                continue;
            }
            let mut v = variants[gi].clone();
            // Exceptions read the folded policy's id.
            if g.kind == VariantKind::Known && !g.is_tail() {
                let in_set: BTreeSet<usize> = g.members.iter().copied().collect();
                (v.exceptions, v.exceptions_more) = exceptions_of(placed, &in_set, &of_unit);
            }
            next.push(v);
        }
        next.sort_by(|a, b| b.members.cmp(&a.members).then(a.key.cmp(&b.key)));
        variants = next;
    }
    for v in &mut variants {
        v.share = r3(ratio(v.members, total));
    }
    // Unknown.
    let mut unknown_report = UnknownReport {
        members: unknown.len(),
        ..UnknownReport::default()
    };
    unknown_report.reasons = counted(
        unknown.iter().filter_map(|&i| match &placed[i].outcome {
            Outcome::Unknown { reason, .. } => Some(*reason),
            _ => None,
        }),
        usize::MAX,
    )
    .into_iter()
    .map(|(reason, members)| UnknownCount { reason, members })
    .collect();
    unknown_report.instruments = counted(
        unknown.iter().filter_map(|&i| match &placed[i].outcome {
            Outcome::Unknown { instrument, .. } if !instrument.is_empty() => {
                Some(instrument.clone())
            }
            _ => None,
        }),
        caps::WHERE,
    )
    .into_iter()
    .map(|(instrument, members)| {
        // A hint only where declaring the instrument is what makes its units known:
        // each is unknown for being unclassified or opaque, nothing else.
        let resolvable = unknown.iter().all(|&i| match &placed[i].outcome {
            Outcome::Unknown {
                instrument: x,
                reason,
            } if *x == instrument => declarable(*reason) && !placed[i].unsettled,
            _ => true,
        });
        InstrumentCount {
            config_hint: if resolvable {
                config_hint(id, &instrument).unwrap_or_default()
            } else {
                String::new()
            },
            instrument,
            members,
        }
    })
    .collect();
    unknown_report.examples = unknown
        .iter()
        .take(caps::EXAMPLES)
        .map(|&i| placed[i].example())
        .collect();
    // The checks found and not proven: by obligation, and each check with its units.
    let found = || {
        unknown
            .iter()
            .filter_map(|&i| placed[i].backing.unproven.as_ref().map(|u| (i, u)))
    };
    unknown_report.not_proven = counted(found().map(|(_, u)| u.obligation.clone()), usize::MAX)
        .into_iter()
        .map(|(obligation, members)| ObligationCount {
            obligation,
            members,
        })
        .collect();
    unknown_report.checks = counted(found().map(|(_, u)| u.clone()), caps::WHERE)
        .into_iter()
        .map(|(u, members)| {
            let n = not_proven(id, &u);
            NotProvenCheck {
                examples: found()
                    .filter(|(_, x)| **x == u)
                    .take(caps::EXAMPLES)
                    .map(|(i, _)| placed[i].example())
                    .collect(),
                check: n.check,
                obligation: n.obligation,
                when: n.when,
                members,
                line: n.line,
                config_hint: n.config_hint,
            }
        })
        .collect();
    // Per package, on the top-level variants.
    let top_known = |vid: &str| {
        variants
            .iter()
            .find(|v| v.id == vid)
            .is_some_and(|v| v.kind == VariantKind::Known && v.key != TAIL)
    };
    let repo_dominant = variants
        .iter()
        .find(|v| v.kind == VariantKind::Known && v.key != TAIL)
        .map(|v| v.id.clone());
    // A package that uses one alternative of the repository's dominant policy alone
    // (the fold is another package's) does it one of that policy's ways, not its own.
    let dominant_ways: BTreeSet<&str> = variants
        .iter()
        .find(|v| v.kind == VariantKind::Known && v.key != TAIL)
        .into_iter()
        .flat_map(|v| v.alternatives.iter().map(|a| a.id.as_str()))
        .collect();
    let rank: BTreeMap<&str, usize> = variants
        .iter()
        .enumerate()
        .map(|(i, v)| (v.id.as_str(), i))
        .collect();
    let mut by_package = Vec::new();
    let mut divergence = Vec::new();
    for (&pkg, &n) in &package_total {
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for (i, p) in placed.iter().enumerate() {
            if p.package == pkg && of_unit[i] != "unknown" {
                *counts.entry(of_unit[i].as_str()).or_default() += 1;
            }
        }
        let decided: usize = counts.values().sum();
        let mut pv: Vec<(&str, usize)> = counts.into_iter().collect();
        pv.sort_by(|a, b| b.1.cmp(&a.1).then(rank[a.0].cmp(&rank[b.0])));
        if let Some(d) = &repo_dominant
            && let Some(&(top, k)) = pv.iter().find(|(vid, _)| top_known(vid))
            && top != d
            && !dominant_ways.contains(top)
            && ratio(k, n) >= DIVERGENCE_SHARE
        {
            divergence.push(Divergence {
                package: pkg.to_string(),
                dominant: top.to_string(),
                repo_dominant: d.clone(),
                members: k,
            });
        }
        by_package.push(PackageProfile {
            package: pkg.to_string(),
            total: n,
            coverage: r3(ratio(decided, n)),
            variants: pv
                .into_iter()
                .map(|(vid, k)| PackageVariant {
                    id: vid.to_string(),
                    members: k,
                    share: r3(ratio(k, n)),
                })
                .collect(),
        });
    }
    let count = |kind: VariantKind| {
        variants
            .iter()
            .filter(|v| v.kind == kind)
            .map(|v| v.members)
            .sum::<usize>()
    };
    let (known_n, none_n) = (count(VariantKind::Known), count(VariantKind::None));
    let identified_n = count(VariantKind::Identified);
    let declared_n = placed
        .iter()
        .filter(|p| {
            matches!(
                p.outcome,
                Outcome::Known {
                    source: VariantSource::Declared,
                    ..
                }
            )
        })
        .count();
    let report = ConcernReport {
        id: id.to_string(),
        title: title.to_string(),
        unit: unit.to_string(),
        population: Population {
            total,
            known: known_n,
            declared: declared_n,
            identified: identified_n,
            none: none_n,
            unknown: unknown.len(),
            coverage: r3(ratio(known_n + identified_n + none_n, total)),
            left_out,
        },
        variants,
        unknown: unknown_report,
        by_package,
        divergence,
        units: Vec::new(),
        groups: Vec::new(),
    };
    let mut report = report;
    report.groups = groups_of(id, placed, &report.variants, &of_unit);
    (report, of_unit)
}

/// The mechanisms that can make an instrument decisive for a concern, by caller
/// class: `(class, mechanisms)`, the first class with a use winning. Concerns not
/// listed: every mechanism, one class.
fn decisive_tiers(concern: &str) -> &'static [(&'static str, &'static [&'static str])] {
    match concern {
        AUTHN => &[
            ("user", AUTHN_USER_DECISIVE),
            ("service", &[SERVICE_AUTHN]),
            ("identifies", &["identifies"]),
            ("opens", &["opens"]),
        ],
        VALIDATION => &[
            ("", &["schema", "typed_model", "typed_param", "declared"]),
            ("", &["manual"]),
        ],
        ERRORS => &[(
            "",
            &[
                "app_handler",
                "mapped_by_wrapper",
                "in_body_try",
                "throw",
                "bubble",
                "declared",
            ],
        )],
        _ => &[],
    }
}

/// A unit's decisive use: in the first tier where it has one, the use whose
/// instrument the most known units of the concern have in that tier (the shared
/// one), then the least `(mechanism, instrument)`. With its class.
fn decisive<'u>(
    concern: &str,
    key: &'u VariantKey,
    freq: &BTreeMap<(&'static str, String), usize>,
) -> Option<(&'static str, &'u Use)> {
    let tiers = decisive_tiers(concern);
    if tiers.is_empty() {
        return key
            .uses
            .iter()
            .max_by(|a, b| {
                let fa = freq.get(&("", a.instrument.clone())).copied().unwrap_or(0);
                let fb = freq.get(&("", b.instrument.clone())).copied().unwrap_or(0);
                fa.cmp(&fb).then(b.cmp(a))
            })
            .map(|u| ("", u));
    }
    // authn: what proves the caller first (a library's own guard, then a name that
    // says access control, then a guard on the route itself rather than one the whole
    // app runs), then the instrument shared most. A presentation choice among
    // instruments already proven: it classifies nothing.
    let rank = |u: &Use| -> (bool, bool, bool) {
        if concern != AUTHN {
            return (false, false, false);
        }
        let i = norm_ref(&u.instrument);
        (
            crate::security::library_guard(&i),
            crate::vocab::refuse::names_access_control(&i),
            !GLOBAL_AUTHN.contains(&u.mechanism.as_str()),
        )
    };
    for (class, mechs) in tiers {
        let best = key
            .uses
            .iter()
            .filter(|u| mechs.contains(&u.mechanism.as_str()))
            .max_by(|a, b| {
                let fa = freq
                    .get(&(*class, a.instrument.clone()))
                    .copied()
                    .unwrap_or(0);
                let fb = freq
                    .get(&(*class, b.instrument.clone()))
                    .copied()
                    .unwrap_or(0);
                rank(a).cmp(&rank(b)).then(fa.cmp(&fb)).then(b.cmp(a))
            });
        if let Some(u) = best {
            return Some((class, u));
        }
    }
    None
}

/// How often each `(class, instrument)` is a candidate among the known units.
fn decisive_freq(concern: &str, placed: &[Placed]) -> BTreeMap<(&'static str, String), usize> {
    let tiers = decisive_tiers(concern);
    let mut freq: BTreeMap<(&'static str, String), usize> = BTreeMap::new();
    for p in placed {
        let Outcome::Known { key, .. } = &p.outcome else {
            continue;
        };
        let mut seen: BTreeSet<(&'static str, &str)> = BTreeSet::new();
        if tiers.is_empty() {
            for u in &key.uses {
                seen.insert(("", u.instrument.as_str()));
            }
        } else {
            // Only the first tier the unit has a use in: its class.
            for (class, mechs) in tiers {
                let here: Vec<&Use> = key
                    .uses
                    .iter()
                    .filter(|u| mechs.contains(&u.mechanism.as_str()))
                    .collect();
                if !here.is_empty() {
                    for u in here {
                        seen.insert((class, u.instrument.as_str()));
                    }
                    break;
                }
            }
        }
        for (c, i) in seen {
            *freq.entry((c, i.to_string())).or_default() += 1;
        }
    }
    freq
}

/// [`ConcernReport::groups`]: the known units grouped by caller class and decisive
/// instrument (groups of one fold into their class's tail), and one group per none
/// variant. Never across classes, nor across known, none and unknown.
fn groups_of(
    concern: &str,
    placed: &[Placed],
    variants: &[Variant],
    of_unit: &[String],
) -> Vec<VariantGroup> {
    let total = placed.len();
    let freq = decisive_freq(concern, placed);
    // (class, instrument) -> member indices; units with no decisive use: by class "".
    let mut by: BTreeMap<(&'static str, String), Vec<usize>> = BTreeMap::new();
    for (i, p) in placed.iter().enumerate() {
        if let Outcome::Known { key, .. } = &p.outcome {
            let (class, instrument) = match decisive(concern, key, &freq) {
                Some((c, u)) => (c, u.instrument.clone()),
                None => ("", String::new()),
            };
            by.entry((class, instrument)).or_default().push(i);
        }
    }
    let mut known: BTreeMap<(&'static str, String), Vec<usize>> = BTreeMap::new();
    for ((class, instrument), members) in by {
        let k = if members.len() < MIN_VARIANT || instrument.is_empty() {
            (class, String::new())
        } else {
            (class, instrument)
        };
        known.entry(k).or_default().extend(members);
    }
    let mut out = Vec::new();
    for ((class, instrument), mut members) in known {
        members.sort_unstable();
        let mut subs: BTreeMap<String, (String, usize)> = BTreeMap::new();
        let mut mechanisms: BTreeSet<String> = BTreeSet::new();
        for &i in &members {
            if let Outcome::Known { key, label, .. } = &placed[i].outcome {
                let e = subs.entry(key.key.clone()).or_insert((label.clone(), 0));
                e.1 += 1;
                for u in key.uses.iter().filter(|u| u.instrument == instrument) {
                    mechanisms.insert(u.mechanism.clone());
                }
            }
        }
        let mut top: Vec<GroupVariant> = subs
            .iter()
            .map(|(k, (label, n))| GroupVariant {
                id: variant_id(concern, k),
                key: k.clone(),
                label: label.clone(),
                members: *n,
            })
            .collect();
        top.sort_by(|a, b| b.members.cmp(&a.members).then(a.key.cmp(&b.key)));
        let n_variants = top.len();
        top.truncate(caps::GROUP_VARIANTS);
        let label = if instrument.is_empty() {
            format!(
                "other ways, nothing shared ({} unit{})",
                members.len(),
                if members.len() == 1 { "" } else { "s" }
            )
        } else if n_variants == 1 {
            top[0].label.clone()
        } else {
            format!("{n_variants} variants sharing {}", short(&instrument))
        };
        let refs: Vec<&Placed> = members.iter().map(|&i| &placed[i]).collect();
        let id_key = if instrument.is_empty() {
            TAIL.to_string()
        } else {
            instrument.clone()
        };
        out.push(VariantGroup {
            id: group_id(concern, class, &id_key),
            kind: VariantKind::Known,
            class: class.to_string(),
            instrument,
            mechanisms: mechanisms.into_iter().collect(),
            label,
            members: members.len(),
            share: r3(ratio(members.len(), total)),
            variants: n_variants,
            top,
            examples: examples_of(&refs),
        });
    }
    // A none variant, or an identified one: one group each.
    for v in variants.iter().filter(|v| v.kind != VariantKind::Known) {
        let members: Vec<&Placed> = placed
            .iter()
            .zip(of_unit)
            .filter(|(_, u)| **u == v.id)
            .map(|(p, _)| p)
            .collect();
        // An identified group keeps the class and the id the `identifies` group had.
        let (class, instrument, mechanisms, id_key) = match v.kind {
            VariantKind::Identified => (
                super::authn::IDENTIFIES,
                v.instruments.join("+"),
                v.mechanisms.clone(),
                v.instruments.join("+"),
            ),
            _ => ("", String::new(), Vec::new(), v.key.clone()),
        };
        out.push(VariantGroup {
            id: group_id(concern, class, &id_key),
            kind: v.kind,
            class: class.to_string(),
            instrument,
            mechanisms,
            label: v.label.clone(),
            members: members.len(),
            share: r3(ratio(members.len(), total)),
            variants: 1,
            top: vec![GroupVariant {
                id: v.id.clone(),
                key: v.key.clone(),
                label: v.label.clone(),
                members: members.len(),
            }],
            examples: examples_of(&members),
        });
    }
    // Groups first by members, the tails last among equals; then by id.
    out.sort_by(|a, b| {
        b.members
            .cmp(&a.members)
            .then(a.instrument.is_empty().cmp(&b.instrument.is_empty()))
            .then(a.id.cmp(&b.id))
    });
    out
}

/// A group's id: `G-` and 6 hex digits of blake3 of `concern\0class\0key`.
fn group_id(concern: &str, class: &str, key: &str) -> String {
    let h = blake3::hash(format!("{concern}\0{class}\0{key}").as_bytes());
    format!("G-{}", &h.to_hex()[..6])
}

/// Directories holding the members: a directory is listed unless a directory below it
/// holds as many (the deeper one says more), most members first.
fn where_dirs(members: &[&Placed]) -> Vec<WhereDir> {
    let mut m: BTreeMap<&str, usize> = BTreeMap::new();
    for p in members {
        for d in &p.dirs {
            *m.entry(d.as_str()).or_default() += 1;
        }
    }
    let mut v: Vec<(&str, usize)> = m
        .iter()
        .filter(|(d, k)| {
            !m.iter()
                .any(|(c, kc)| kc == *k && c.len() > d.len() && c.starts_with(&format!("{d}/")))
        })
        .map(|(d, k)| (*d, *k))
        .collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    v.truncate(caps::WHERE);
    v.into_iter()
        .map(|(dir, members)| WhereDir {
            dir: dir.to_string(),
            members,
        })
        .collect()
}

/// The upper-tail standard normal quantile `z` with `P(Z > z) = p` (Acklam's rational
/// approximation, relative error below 1.2e-9).
fn normal_upper_quantile(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    // The lower-tail quantile of q = 1 - p, negated as needed.
    let q = p.clamp(1e-300, 0.5);
    let r = (-2.0 * q.ln()).sqrt();
    let x = (((((C[0] * r + C[1]) * r + C[2]) * r + C[3]) * r + C[4]) * r + C[5])
        / ((((D[0] * r + D[1]) * r + D[2]) * r + D[3]) * r + 1.0);
    if q < 0.02425 {
        -x
    } else {
        let s = q - 0.5;
        let t = s * s;
        -((((((A[0] * t + A[1]) * t + A[2]) * t + A[3]) * t + A[4]) * t + A[5]) * s
            / (((((B[0] * t + B[1]) * t + B[2]) * t + B[3]) * t + B[4]) * t + 1.0))
    }
}

/// The 95% Wilson interval of `k/n` widened to `z`: `(lower, upper)`.
fn wilson(k: usize, n: usize, z: f64) -> (f64, f64) {
    if n == 0 {
        return (0.0, 1.0);
    }
    let n_f = n as f64;
    let p = k as f64 / n_f;
    let z2 = z * z;
    let centre = p + z2 / (2.0 * n_f);
    let margin = z * ((p * (1.0 - p) + z2 / (4.0 * n_f)) / n_f).sqrt();
    let d = 1.0 + z2 / n_f;
    ((centre - margin) / d, (centre + margin) / d)
}

/// The statistic of PLAN-R13 §3 with the lead's guards: attributes of the variant's
/// members whose Wilson lower bound in the variant exceeds their Wilson upper bound in
/// `compare` by more than [`MIN_SEPARATION`], with the interval widened for the number
/// of attributes tried (Bonferroni at [`ALPHA`]); none for a variant of fewer than
/// [`MIN_APART`] members; of nested directories only the shallowest; never an
/// `imports:` of a module one of `instruments` is defined in.
fn sets_apart(
    placed: &[Placed],
    members: &[usize],
    compare: &[usize],
    instruments: &[String],
) -> Vec<SetsApart> {
    let (n_v, n_d) = (members.len(), compare.len());
    if n_v < MIN_APART {
        return Vec::new();
    }
    let own: BTreeSet<String> = instruments
        .iter()
        .filter_map(|i| internal_path(i).map(|p| format!("imports:{p}")))
        .collect();
    let mut k_v: BTreeMap<&str, usize> = BTreeMap::new();
    for &i in members {
        for a in &placed[i].attrs {
            if !own.contains(a) {
                *k_v.entry(a.as_str()).or_default() += 1;
            }
        }
    }
    let z = normal_upper_quantile(ALPHA / 2.0 / k_v.len().max(1) as f64);
    let mut out: Vec<SetsApart> = Vec::new();
    for (attr, kv) in k_v {
        let kd = compare
            .iter()
            .filter(|&&i| placed[i].attrs.contains(attr))
            .count();
        let separation = wilson(kv, n_v, z).0 - wilson(kd, n_d, z).1;
        if separation <= MIN_SEPARATION {
            continue;
        }
        out.push(SetsApart {
            attribute: attr.to_string(),
            in_variant: [kv, n_v],
            in_dominant: [kd, n_d],
            separation,
            purity: ratio(kv, kv + kd),
        });
    }
    let dirs: Vec<String> = out
        .iter()
        .filter_map(|s| s.attribute.strip_prefix("dir:").map(str::to_string))
        .collect();
    out.retain(|s| {
        s.attribute
            .strip_prefix("dir:")
            .is_none_or(|d| !dirs.iter().any(|p| d.starts_with(&format!("{p}/"))))
    });
    out.sort_by(|a, b| {
        b.separation
            .total_cmp(&a.separation)
            .then(b.purity.total_cmp(&a.purity))
            .then(a.attribute.cmp(&b.attribute))
    });
    out.truncate(caps::SETS_APART);
    for s in &mut out {
        s.separation = r3(s.separation);
        s.purity = r3(s.purity);
    }
    out
}

/// The members nearest the medoid: the most common signature first, then by path;
/// distinct files first.
fn examples_of(members: &[&Placed]) -> Vec<Example> {
    let mut freq: BTreeMap<(String, Option<String>, String, String), usize> = BTreeMap::new();
    for p in members {
        *freq.entry(p.signature()).or_default() += 1;
    }
    let mut order: Vec<&&Placed> = members.iter().collect();
    order.sort_by(|a, b| {
        freq[&b.signature()]
            .cmp(&freq[&a.signature()])
            .then(a.signature().cmp(&b.signature()))
            .then(a.ident().cmp(&b.ident()))
    });
    let mut out: Vec<Example> = Vec::new();
    let mut files: BTreeSet<&str> = BTreeSet::new();
    for p in &order {
        if out.len() < caps::EXAMPLES && files.insert(p.path.as_str()) {
            out.push(p.example());
        }
    }
    for p in &order {
        if out.len() >= caps::EXAMPLES {
            break;
        }
        let e = p.example();
        if !out.contains(&e) {
            out.push(e);
        }
    }
    out
}

/// Units of other variants, `none` or unknown in the variant's places: (package, dir)
/// roles of at least [`MIN_ROLE_SIZE`] units where it holds at least
/// [`EXCEPTION_PLACE_SHARE`], broadest first (as `security::guard_gaps`).
fn exceptions_of(
    placed: &[Placed],
    in_set: &BTreeSet<usize>,
    of_unit: &[String],
) -> (Vec<Exception>, usize) {
    let mut places: BTreeMap<(&str, String), Vec<usize>> = BTreeMap::new();
    for (i, p) in placed.iter().enumerate() {
        for d in crate::security::role_dirs(&p.package, &p.path) {
            places.entry((p.package.as_str(), d)).or_default().push(i);
        }
    }
    let mut keys: Vec<&(&str, String)> = places.keys().collect();
    keys.sort_by_key(|k| (k.0, k.1.len(), k.1.as_str()));
    let mut listed: BTreeSet<usize> = BTreeSet::new();
    let mut out = Vec::new();
    for k in keys {
        let m = &places[k];
        let held = m.iter().filter(|i| in_set.contains(i)).count();
        if m.len() < MIN_ROLE_SIZE
            || held == m.len()
            || (held as f64) < EXCEPTION_PLACE_SHARE * m.len() as f64
        {
            continue;
        }
        for &i in m {
            if !in_set.contains(&i) && listed.insert(i) {
                let p = &placed[i];
                out.push(Exception {
                    path: p.src.clone(),
                    symbol: p.symbol.clone(),
                    line: p.line,
                    variant: of_unit[i].clone(),
                });
            }
        }
    }
    let more = out.len().saturating_sub(caps::EXCEPTIONS);
    out.truncate(caps::EXCEPTIONS);
    (out, more)
}

/// Every unit with its assignment (`--units`), sorted.
fn unit_rows(report: &ConcernReport, placed: &[Placed], of_unit: &[String]) -> Vec<UnitRow> {
    let mut out: Vec<UnitRow> = placed
        .iter()
        .zip(of_unit)
        .map(|(p, vid)| {
            let (assignment, reason, variant) = match &p.outcome {
                Outcome::Unknown { reason, .. } => ("unknown", Some(*reason), String::new()),
                _ => {
                    let kind = report
                        .variants
                        .iter()
                        .find(|v| &v.id == vid)
                        .map_or(VariantKind::Known, |v| v.kind);
                    let a = match (kind, &p.outcome) {
                        (_, Outcome::Identified { .. }) | (VariantKind::Identified, _) => {
                            super::authn::IDENTIFIED
                        }
                        (VariantKind::None, _) => "none",
                        _ => "known",
                    };
                    (a, None, vid.clone())
                }
            };
            // Its own uses, where the variant it is counted under stands for several.
            let own = match &p.outcome {
                Outcome::Known { key, label, .. } => report
                    .variants
                    .iter()
                    .find(|v| &v.id == vid)
                    .filter(|v| v.key != key.key)
                    .map(|_| (label.clone(), key.key.clone())),
                _ => None,
            };
            let (does, key) = own.unzip();
            UnitRow {
                package: p.package.clone(),
                variant,
                path: p.src.clone(),
                symbol: p.symbol.clone(),
                line: p.line,
                method: p.method.clone(),
                assignment: assignment.to_string(),
                reason,
                does,
                key,
                route: p.route.clone(),
                declared: match &p.outcome {
                    Outcome::Known {
                        label,
                        source: VariantSource::Declared,
                        ..
                    } => Some(label.clone()),
                    _ => None,
                },
                not_proven: match &p.outcome {
                    Outcome::Unknown { .. } => p
                        .backing
                        .unproven
                        .as_ref()
                        .map(|u| not_proven(&report.id, u)),
                    _ => None,
                },
                basis: match &p.outcome {
                    Outcome::None { .. } => p.backing.basis.clone(),
                    _ => None,
                },
                kind: None,
                uses: Vec::new(),
                enforces: None,
                unscoped: None,
                instrument: match &p.outcome {
                    Outcome::Unknown { instrument, .. } => instrument.clone(),
                    _ => String::new(),
                },
            }
        })
        .collect();
    out.sort();
    out
}

// ---------- recipes and findings ----------

/// The id of the recipe of `role` in `package`.
fn recipe_id(package: &str, role: &str) -> String {
    let h = blake3::hash(format!("{package}\0{role}").as_bytes());
    format!("E-{}", &h.to_hex()[..6])
}

/// The guarded `sets_apart` of `second` against `first` among `placed`, its first
/// attribute (none: nothing sets it apart).
fn separating(placed: &[Placed], second: &[usize], first: &[usize]) -> Option<String> {
    sets_apart(placed, second, first, &[])
        .into_iter()
        .next()
        .map(|s| s.attribute)
}

/// An entry point: (path, symbol, method).
type EntryKey = (String, String, Option<String>);

/// The recipe per package and kind of entry point (lead decision, round 13): for each
/// [`PRIMARY`] concern with entry-point units there, its top two known variants with a
/// member to copy, the `none` and unknown counts, and where the second differs.
fn recipes(runs: &[ConcernRun], concerns: &[ConcernReport]) -> Vec<Recipe> {
    // (package, kind) -> distinct entry points across the recipe concerns.
    let mut groups: BTreeMap<(String, String), BTreeSet<EntryKey>> = BTreeMap::new();
    for r in runs.iter().filter(|r| PRIMARY.contains(&r.id)) {
        for p in &r.placed {
            if let Some(k) = &p.entry_kind {
                groups
                    .entry((p.package.clone(), k.clone()))
                    .or_default()
                    .insert((p.path.clone(), p.symbol.clone(), p.method.clone()));
            }
        }
    }
    let mut out = Vec::new();
    for ((package, role), entries) in groups {
        let mut rc = Vec::new();
        for r in runs.iter().filter(|r| PRIMARY.contains(&r.id)) {
            let Some(report) = concerns.iter().find(|c| c.id == r.id) else {
                continue;
            };
            let here: Vec<usize> = (0..r.placed.len())
                .filter(|&i| {
                    r.placed[i].package == package
                        && r.placed[i].entry_kind.as_deref() == Some(role.as_str())
                })
                .collect();
            if here.is_empty() {
                continue;
            }
            let variant = |vid: &str| report.variants.iter().find(|v| v.id == vid);
            let mut none = 0;
            let mut identified = 0;
            let mut unknown = 0;
            let mut by: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
            for &i in &here {
                let vid = r.of_unit[i].as_str();
                match variant(vid) {
                    None => unknown += 1,
                    Some(v) if v.kind == VariantKind::None => none += 1,
                    // Identifying the caller turns no one away: never a way to copy.
                    Some(v) if v.kind == VariantKind::Identified => identified += 1,
                    // A person's word is no way of doing it to copy.
                    Some(v) if v.key == TAIL || v.source == VariantSource::Declared => {}
                    Some(_) => by.entry(vid).or_default().push(i),
                }
            }
            let rank: BTreeMap<&str, usize> = report
                .variants
                .iter()
                .enumerate()
                .map(|(i, v)| (v.id.as_str(), i))
                .collect();
            let mut top: Vec<(&str, Vec<usize>)> = by.into_iter().collect();
            top.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(rank[a.0].cmp(&rank[b.0])));
            top.truncate(2);
            let n = here.len();
            let copy = top.first().map(|(vid, members)| {
                // The variant's own example when it is here, else its first member here.
                let v = variant(vid);
                v.and_then(|v| {
                    v.examples
                        .iter()
                        .find(|e| members.iter().any(|&i| r.placed[i].src == e.path))
                        .cloned()
                })
                .unwrap_or_else(|| r.placed[members[0]].example())
            });
            let differs = top.get(1).map(|(vid, members)| Differs {
                variant: vid.to_string(),
                members: members.len(),
                attribute: separating(&r.placed, members, &top[0].1),
                examples: members
                    .iter()
                    .take(caps::EXAMPLES)
                    .map(|&i| r.placed[i].example())
                    .collect(),
            });
            rc.push(RecipeConcern {
                concern: r.id.to_string(),
                total: n,
                variants: top
                    .iter()
                    .map(|(vid, members)| RecipeVariant {
                        id: vid.to_string(),
                        label: variant(vid).map(|v| v.label.clone()).unwrap_or_default(),
                        members: members.len(),
                        share: r3(ratio(members.len(), n)),
                    })
                    .collect(),
                copy,
                none,
                identified,
                unknown,
                differs,
            });
        }
        let preview = PREVIEW
            .iter()
            .filter_map(|&id| {
                let r = runs.iter().find(|r| r.id == id)?;
                let report = concerns.iter().find(|c| c.id == id)?;
                if id == TESTING {
                    tests_preview(r, &package, &role)
                } else {
                    package_preview(r, report, &package)
                }
            })
            .collect();
        out.push(Recipe {
            id: recipe_id(&package, &role),
            label: format!("{role} entry points in {}", shown_package(&package)),
            package,
            role,
            population: entries.len(),
            concerns: rc,
            preview,
        });
    }
    out.sort_by(|a, b| {
        b.population
            .cmp(&a.population)
            .then(a.package.cmp(&b.package))
            .then(a.role.cmp(&b.role))
    });
    out.truncate(caps::RECIPES);
    out
}

/// The concerns outside [`PRIMARY`] that a recipe and a card add as a preview, in
/// [`CONCERNS`] order.
const PREVIEW: &[&str] = &[LOGGING, CONFIG, DATA_ACCESS, TESTING];

/// The known variant most of `package`'s units of a concern have: its row in the
/// package's profile and the variant, when it holds at least [`DIVERGENCE_SHARE`] of
/// them (unknown units counted against it).
fn package_dominant<'r>(
    report: &'r ConcernReport,
    package: &str,
) -> Option<(&'r Variant, &'r PackageVariant, usize)> {
    let profile = report.by_package.iter().find(|p| p.package == package)?;
    let (v, row) = profile.variants.iter().find_map(|row| {
        let v = report.variants.iter().find(|v| v.id == row.id)?;
        (v.kind == VariantKind::Known && v.key != TAIL).then_some((v, row))
    })?;
    (ratio(row.members, profile.total) >= DIVERGENCE_SHARE).then_some((v, row, profile.total))
}

/// A recipe's preview line for logging, config or data access: the package's dominant
/// variant ([`package_dominant`]) with a member of it there to copy.
fn package_preview(r: &ConcernRun, report: &ConcernReport, package: &str) -> Option<RecipePreview> {
    let (v, row, total) = package_dominant(report, package)?;
    let copy = v
        .examples
        .iter()
        .find(|e| {
            r.placed
                .iter()
                .any(|p| p.package == package && p.src == e.path)
        })
        .cloned()
        .or_else(|| {
            (0..r.placed.len())
                .find(|&i| r.placed[i].package == package && r.of_unit[i] == v.id)
                .map(|i| r.placed[i].example())
        });
    Some(RecipePreview {
        concern: r.id.to_string(),
        label: v.label.clone(),
        members: row.members,
        total,
        share: r3(ratio(row.members, total)),
        variant: Some(v.id.clone()),
        tests_dir: None,
        runner: None,
        copy,
    })
}

/// A recipe's preview line for testing: where the tests of the package's entry points
/// of `role` are. The deepest directory below the repository root whose test files
/// cover at least [`DIVERGENCE_SHARE`] of them (untested and unknown ones counted
/// against it; ties go to the first by path), with the runner most of those tests use
/// and one of the test files.
fn tests_preview(r: &ConcernRun, package: &str, role: &str) -> Option<RecipePreview> {
    let here: Vec<&Placed> = r
        .placed
        .iter()
        .filter(|p| p.package == package && p.entry_kind.as_deref() == Some(role))
        .collect();
    let total = here.len();
    // Each directory, and the entry points here a test file under it covers.
    let mut under: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
    for (i, p) in here.iter().enumerate() {
        for t in &p.backing.tests {
            let mut dir = t.as_str();
            while let Some((parent, _)) = dir.rsplit_once('/') {
                under.entry(parent.to_string()).or_default().insert(i);
                dir = parent;
            }
        }
    }
    let depth = |d: &str| d.split('/').count();
    // The package's own directory (or one above it) says nothing of where.
    let above = |d: &str| package == d || package.starts_with(&format!("{d}/"));
    let (dir, covered) = under
        .iter()
        .filter(|(d, c)| !above(d) && ratio(c.len(), total) >= DIVERGENCE_SHARE)
        .max_by(|a, b| depth(a.0).cmp(&depth(b.0)).then(b.0.cmp(a.0)))?;
    let inside = |t: &str| t.starts_with(&format!("{dir}/"));
    // The runner of each covered entry point's variant (`tested_*:<runner>`).
    let runners = counted(
        covered.iter().flat_map(|&i| match &here[i].outcome {
            Outcome::Known { key, .. } => key
                .uses
                .iter()
                .map(|u| u.instrument.clone())
                .collect::<BTreeSet<_>>(),
            _ => BTreeSet::new(),
        }),
        1,
    );
    let runner = runners
        .into_iter()
        .next()
        .filter(|(_, n)| ratio(*n, covered.len()) >= DIVERGENCE_SHARE)
        .map(|(name, _)| short(&name).to_string());
    let file = covered
        .iter()
        .flat_map(|&i| here[i].backing.tests.iter())
        .filter(|t| inside(t))
        .min()?;
    Some(RecipePreview {
        concern: TESTING.to_string(),
        label: match &runner {
            Some(name) => format!("tests in {dir} ({name})"),
            None => format!("tests in {dir}"),
        },
        members: covered.len(),
        total,
        share: r3(ratio(covered.len(), total)),
        variant: None,
        tests_dir: Some(dir.clone()),
        runner,
        copy: Some(Example {
            path: file.clone(),
            symbol: String::new(),
            line: 0,
        }),
    })
}

/// What to look at first (lead decision, round 13): keys a signed-in caller names that
/// nothing scopes, then unexplained splits, then `none` in authn or validation, then
/// unknown instruments by the units classifying them would free, then helpers defined
/// more than once (`duplicates`, beyond the cap of the others). Each ranked by members
/// (a helper's copies times what they share), then concern order, package, instrument
/// and key.
fn findings(
    runs: &[ConcernRun],
    concerns: &[ConcernReport],
    duplicates: Vec<Finding>,
) -> Vec<Finding> {
    let order: BTreeMap<&str, usize> = CONCERNS
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (*id, i))
        .collect();
    let mut out = Vec::new();
    for r in runs {
        let Some(report) = concerns.iter().find(|c| c.id == r.id) else {
            continue;
        };
        let variant = |vid: &str| report.variants.iter().find(|v| v.id == vid);
        let packages: BTreeSet<&str> = r.placed.iter().map(|p| p.package.as_str()).collect();
        for pkg in packages {
            let here: Vec<usize> = (0..r.placed.len())
                .filter(|&i| r.placed[i].package == pkg)
                .collect();
            let mut by: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
            let mut none: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
            for &i in &here {
                let vid = r.of_unit[i].as_str();
                match variant(vid) {
                    Some(v) if v.kind == VariantKind::None => none.entry(vid).or_default().push(i),
                    Some(v) if v.key != TAIL => by.entry(vid).or_default().push(i),
                    _ => {}
                }
            }
            let mut top: Vec<(&str, Vec<usize>)> = by.into_iter().collect();
            top.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(b.0)));
            if let [first, second, ..] = top.as_slice()
                && ratio(second.1.len(), here.len()) >= SPLIT_SHARE
                && second.1.len() >= MIN_APART
                && separating(&r.placed, &second.1, &first.1).is_none()
            {
                out.push(Finding {
                    kind: FindingKind::UnexplainedSplit,
                    concern: r.id.to_string(),
                    package: Some(pkg.to_string()),
                    variants: vec![first.0.to_string(), second.0.to_string()],
                    members: second.1.len(),
                    instrument: None,
                    config_hint: None,
                    examples: second
                        .1
                        .iter()
                        .take(caps::EXAMPLES)
                        .map(|&i| r.placed[i].example())
                        .collect(),
                    ..Finding::default()
                });
            }
            if matches!(r.id, AUTHN | VALIDATION) {
                for (vid, members) in none {
                    out.push(Finding {
                        kind: FindingKind::None,
                        concern: r.id.to_string(),
                        package: Some(pkg.to_string()),
                        variants: vec![vid.to_string()],
                        members: members.len(),
                        instrument: None,
                        config_hint: None,
                        examples: members
                            .iter()
                            .take(caps::EXAMPLES)
                            .map(|&i| r.placed[i].example())
                            .collect(),
                        not_read: super::basis::Basis::union(
                            members
                                .iter()
                                .filter_map(|&i| r.placed[i].backing.basis.as_ref()),
                        ),
                        ..Finding::default()
                    });
                }
            }
            // Keys the package's signed-in entry points take and leave unscoped, one
            // finding per key.
            let mut unscoped: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
            for &i in &here {
                if let Some(k) = r.placed[i].unscoped.as_deref() {
                    unscoped.entry(k).or_default().push(i);
                }
            }
            for (key, members) in unscoped {
                let variants: BTreeSet<&str> =
                    members.iter().map(|&i| r.of_unit[i].as_str()).collect();
                out.push(Finding {
                    kind: FindingKind::UnscopedKey,
                    concern: r.id.to_string(),
                    package: Some(pkg.to_string()),
                    variants: variants.into_iter().map(str::to_string).collect(),
                    members: members.len(),
                    instrument: None,
                    config_hint: None,
                    examples: members
                        .iter()
                        .take(caps::EXAMPLES)
                        .map(|&i| r.placed[i].example())
                        .collect(),
                    key: Some(key.to_string()),
                    ..Finding::default()
                });
            }
        }
        for i in &report.unknown.instruments {
            out.push(Finding {
                kind: FindingKind::Unknown,
                concern: r.id.to_string(),
                package: None,
                variants: Vec::new(),
                members: i.members,
                instrument: Some(i.instrument.clone()),
                config_hint: (!i.config_hint.is_empty()).then(|| i.config_hint.clone()),
                examples: r
                    .placed
                    .iter()
                    .filter(|p| {
                        matches!(&p.outcome, Outcome::Unknown { instrument, .. } if *instrument == i.instrument)
                    })
                    .take(caps::EXAMPLES)
                    .map(Placed::example)
                    .collect(),
                ..Finding::default()
            });
        }
    }
    // A duplicate helper weighs its copies by what they share; its concern is none of
    // the map's.
    let weight = |f: &Finding| f.members * f.shared_calls.unwrap_or(1);
    let rank = |f: &Finding| order.get(f.concern.as_str()).copied().unwrap_or(usize::MAX);
    let sort = |fs: &mut Vec<Finding>| {
        fs.sort_by(|a, b| {
            a.kind
                .cmp(&b.kind)
                .then(weight(b).cmp(&weight(a)))
                .then(rank(a).cmp(&rank(b)))
                .then(a.package.cmp(&b.package))
                .then(a.instrument.cmp(&b.instrument))
                .then(a.key.cmp(&b.key))
        });
    };
    sort(&mut out);
    out.truncate(caps::FINDINGS);
    // Duplicate helpers come last and have their own cap: they take no other
    // finding's place.
    let mut duplicates = duplicates;
    sort(&mut duplicates);
    out.extend(duplicates);
    out
}

// ---------- card and hook lines ----------

/// Concerns listed at most in a card or a hook line.
const LINES: usize = 5;

/// `drift card`'s "Practices here" lines for `rel`: for each [`PRIMARY`] concern with
/// units in the file and something known, the file's own variant, and the package's
/// dominant one with a member to copy when they differ; then the preview concerns'
/// lines ([`card_lines_with`]). Empty when nothing is known.
pub fn card_lines(facts: &RepoFacts, opts: &Options, rel: &str) -> Vec<String> {
    card_lines_with(facts, opts, &registry(), rel)
}

/// Preview concerns listed at most in a card, after the primary ones.
const PREVIEW_LINES: usize = 4;
/// Entry points named per clause of a card's testing line, and clauses in it.
const PREVIEW_NAMED: usize = 3;
/// Test files named per clause of a card's testing line.
const PREVIEW_TESTS: usize = 2;

/// The card's line for logging, config or data access in a file with entry points:
/// the known variant most of the file's own units of the concern have, and the
/// package's dominant one ([`package_dominant`]) with a member there to copy when it
/// is another (or the file has none). `None` when neither is known: an unknown unit
/// says nothing.
fn preview_line(
    r: &ConcernRun,
    report: &ConcernReport,
    file: &FileFacts,
    lang_of: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    use crate::report::sanitize;
    let known = |id: &str| {
        report
            .variants
            .iter()
            .find(|v| v.id == id && v.kind == VariantKind::Known && v.key != TAIL)
    };
    let mine = (0..r.placed.len())
        .filter(|&i| r.placed[i].path == file.path)
        .map(|i| r.of_unit[i].as_str())
        .filter(|id| known(id).is_some());
    let own = counted(mine, 1)
        .into_iter()
        .next()
        .and_then(|(id, _)| known(id));
    let mut parts = Vec::new();
    if let Some(v) = own {
        parts.push(format!(
            "{} [{}]",
            sanitize(&v.label, 120),
            sanitize(&v.id, 16)
        ));
    }
    if let Some(p) = package_preview(r, report, &file.package)
        && own.is_none_or(|v| Some(&v.id) != p.variant.as_ref())
        && p.copy.is_some()
        && let Some(v) = report
            .variants
            .iter()
            .find(|v| Some(&v.id) == p.variant.as_ref())
    {
        // A member of the package in the file's language ([`copy_here`]).
        let copy = match copy_here(r, v, file, lang_of) {
            Some(e) => format!(
                "copy {}:{} {}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(&e.symbol, 80)
            ),
            None => no_copy_here(file),
        };
        parts.push(format!(
            "the package mostly: {} {}/{} ({copy})",
            sanitize(&p.label, 120),
            p.members,
            p.total,
        ));
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// The card's testing line for a file: per entry point of the testing population,
/// the test files that cover it and the required cases they do not assert, or that no
/// test of it was found; entry points of which the same is said share a clause. An
/// entry point whose testing is unknown is counted as not known, never described.
/// `None` when nothing is known of any.
fn testing_line(r: &ConcernRun, file: &FileFacts) -> Option<String> {
    use crate::report::sanitize;
    let mut said: Vec<(String, Vec<&str>)> = Vec::new();
    let mut unknown = 0;
    for p in r.placed.iter().filter(|p| p.path == file.path) {
        let what = match &p.outcome {
            // (Identified is authentication's only.)
            Outcome::Unknown { .. } | Outcome::Identified { .. } => {
                unknown += 1;
                continue;
            }
            // The map's `untested` is what its matching found (a request for a literal
            // path, `/things/7`, is not matched to a route with a parameter): the card
            // says that no test was found, not that there is none.
            Outcome::None { label } => {
                sanitize(&label.replacen("untested", "no test found", 1), 80)
            }
            Outcome::Known { .. } => {
                let b = &p.backing;
                let mut files: Vec<String> = b
                    .tests
                    .iter()
                    .take(PREVIEW_TESTS)
                    .map(|t| sanitize(t, 160))
                    .collect();
                if b.tests.len() > PREVIEW_TESTS {
                    files.push(format!("{} more", b.tests.len() - PREVIEW_TESTS));
                }
                let cases = if !b.missing.is_empty() {
                    format!(", not asserted: {}", b.missing.join(", "))
                } else if !b.required.is_empty() {
                    format!(", asserts {}", b.required.join(", "))
                } else {
                    String::new()
                };
                format!("covered by {}{cases}", files.join(", "))
            }
        };
        match said.iter_mut().find(|(w, _)| *w == what) {
            Some((_, names)) => names.push(&p.symbol),
            None => said.push((what, vec![&p.symbol])),
        }
    }
    if said.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = said
        .iter()
        .take(PREVIEW_NAMED)
        .map(|(what, names)| {
            let mut shown: Vec<String> = names
                .iter()
                .take(PREVIEW_NAMED)
                .map(|n| sanitize(n, 80))
                .collect();
            if names.len() > PREVIEW_NAMED {
                shown.push(format!("{} more", names.len() - PREVIEW_NAMED));
            }
            format!("{}: {what}", shown.join(", "))
        })
        .collect();
    let more: usize = said
        .iter()
        .skip(PREVIEW_NAMED)
        .map(|(_, names)| names.len())
        .sum();
    if more > 0 {
        parts.push(format!("{more} more entry point(s)"));
    }
    if unknown > 0 {
        parts.push(format!("{unknown} not known"));
    }
    Some(parts.join("; "))
}

/// [`card_lines`] with the given classifiers. After the [`PRIMARY`] lines, a file with
/// entry points gets the preview concerns' lines, marked `(preview)` and under their
/// own cap ([`PREVIEW_LINES`]): the logger, how config is read and how data is
/// reached ([`preview_line`]), and what tests its entry points ([`testing_line`]).
pub fn card_lines_with(
    facts: &RepoFacts,
    opts: &Options,
    classifiers: &[Box<dyn Concern>],
    rel: &str,
) -> Vec<String> {
    let listed = facts.listed();
    let facts = &*listed;
    let Some(file) = facts.files.iter().find(|f| f.path == rel) else {
        return Vec::new();
    };
    let run = run(facts, opts, classifiers, Guards::ALL);
    let langs: BTreeMap<&str, &str> = facts
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.lang.as_str()))
        .collect();
    let lang_of = |p: &str| langs.get(p).map(|l| l.to_string());
    let mut out = primary_lines(&run, file, &lang_of);
    if !file.entry_points.is_empty() {
        let lines = PREVIEW.iter().filter_map(|&id| {
            let r = run.runs.iter().find(|r| r.id == id)?;
            let report = run.report.concerns.iter().find(|c| c.id == id)?;
            let line = if id == TESTING {
                testing_line(r, file)
            } else {
                preview_line(r, report, file, &lang_of)
            }?;
            Some(format!("  {id} (preview): {line}"))
        });
        out.extend(lines.take(PREVIEW_LINES));
    }
    out
}

/// A member of variant `v` in `file`'s package whose code is in `file`'s language, to
/// copy: the variant's own example when one is such a member of another file, else the
/// first such member, another file's before the file's own. `lang_of` gives a scanned
/// file's language. `None` when the package has none.
fn copy_here(
    r: &ConcernRun,
    v: &Variant,
    file: &FileFacts,
    lang_of: &dyn Fn(&str) -> Option<String>,
) -> Option<Example> {
    let mut here: Vec<&Placed> = (0..r.placed.len())
        .filter(|&i| r.of_unit[i] == v.id)
        .map(|i| &r.placed[i])
        .filter(|p| p.package == file.package && lang_of(&p.src).as_deref() == Some(&file.lang))
        .collect();
    // Another file's member before one of the file itself: it is what the others do.
    here.sort_by_key(|p| p.src == file.path);
    v.examples
        .iter()
        .find(|e| e.path != file.path && here.iter().any(|p| p.src == e.path))
        .cloned()
        .or_else(|| here.first().map(|p| p.example()))
}

/// What a card says where its package has no member of a variant to copy in the
/// file's language ([`copy_here`]).
fn no_copy_here(file: &FileFacts) -> String {
    format!(
        "no {} example of it in this package to copy",
        crate::report::sanitize(&file.lang, 16)
    )
}

/// The card's lines for the [`PRIMARY`] concerns ([`card_lines`]). `lang_of` gives a
/// scanned file's language.
fn primary_lines(
    run: &Run,
    file: &FileFacts,
    lang_of: &dyn Fn(&str) -> Option<String>,
) -> Vec<String> {
    use crate::report::sanitize;
    let rel = file.path.as_str();
    let mut out = Vec::new();
    for c in &run.report.concerns {
        if out.len() >= LINES
            || !PRIMARY.contains(&c.id.as_str())
            || !c.variants.iter().any(|v| v.kind == VariantKind::Known)
        {
            continue;
        }
        let mine: Vec<&str> = run
            .units
            .iter()
            .filter(|(id, path, _)| *id == c.id && path == rel)
            .map(|(_, _, v)| v.as_str())
            .collect();
        let Some((own, sharing)) = counted(mine.iter().copied(), 1).into_iter().next() else {
            continue;
        };
        let Some(v) = c.variants.iter().find(|v| v.id == own) else {
            // Unknown here: an agent is never told an unknown as a fact.
            continue;
        };
        // A none says what it rests on: what this file's units of it saw and did not
        // read.
        let name = |v: &Variant| -> String {
            if v.kind == VariantKind::None {
                let not_read = run
                    .runs
                    .iter()
                    .find(|r| r.id == c.id)
                    .map(|r| {
                        super::basis::Basis::union(
                            r.placed
                                .iter()
                                .zip(&r.of_unit)
                                .filter(|(p, u)| p.path == rel && **u == v.id)
                                .filter_map(|(p, _)| p.backing.basis.as_ref()),
                        )
                    })
                    .unwrap_or_default();
                super::basis::none(&v.label, &not_read)
            } else {
                v.label.clone()
            }
        };
        let mut line = format!(
            "  {}: {} [{}]",
            c.id,
            sanitize(&name(v), 240),
            sanitize(own, 16)
        );
        // The line is the file's most common answer, never every unit's: a handler
        // mounted behind a guard and again without one is two units that differ.
        if sharing < mine.len() {
            line.push_str(&format!(
                " ({sharing} of the {} here; the others differ)",
                mine.len()
            ));
        }
        let pkg = c.by_package.iter().find(|p| p.package == file.package);
        if let Some(top) = pkg.and_then(|p| p.variants.first())
            && top.id != own
            && let Some(tv) = c.variants.iter().find(|v| v.id == top.id)
            && tv.kind == VariantKind::Known
            // A person's word is no way of doing it to copy.
            && tv.source != VariantSource::Declared
            && let Some(r) = run.runs.iter().find(|r| r.id == c.id)
        {
            // The variant's examples are the repository's: the one to copy is a member
            // of this package, in this file's language.
            let copy = match copy_here(r, tv, file, lang_of) {
                Some(e) => format!(
                    "copy {}:{} {}",
                    sanitize(&e.path, 160),
                    e.line,
                    sanitize(&e.symbol, 80)
                ),
                None => no_copy_here(file),
            };
            line.push_str(&format!(
                "; the package mostly: {} {}/{} ({copy})",
                sanitize(&tv.label, 120),
                top.members,
                pkg.map_or(0, |p| p.total),
            ));
        }
        out.push(line);
    }
    // A check that was found in a unit of the file and is not proven: said in the one
    // approved wording ([`super::not_proven_line`]), never as what the unit does. One
    // line for each concern, for its first such unit, with how many more there are.
    for r in &run.runs {
        if !PRIMARY.contains(&r.id) {
            continue;
        }
        let mut found: Vec<(&str, u32, String)> = r
            .placed
            .iter()
            .filter(|p| p.path == rel && matches!(p.outcome, Outcome::Unknown { .. }))
            .filter_map(|p| {
                let u = p.backing.unproven.as_ref()?;
                Some((
                    p.symbol.as_str(),
                    p.line,
                    super::not_proven_line(&u.check, &u.obligation, &u.when),
                ))
            })
            .collect();
        found.sort();
        if let Some((symbol, _, said)) = found.first() {
            let more = match found.len() - 1 {
                0 => String::new(),
                n => format!(" ({n} more here with a check found and not proven)"),
            };
            out.push(format!(
                "  {}: {}: {said}{more}",
                r.id,
                sanitize(symbol, 80)
            ));
        }
    }
    out
}

/// The hook's one line for `package` (PLAN-R13 §4.3): each [`PRIMARY`] concern's
/// dominant known variant there with a member to copy, at most [`LINES`] concerns;
/// `None` when nothing is known.
pub fn package_line(facts: &RepoFacts, opts: &Options, package: &str) -> Option<String> {
    package_line_with(facts, opts, &registry(), package)
}

/// [`package_line`] with the given classifiers.
pub fn package_line_with(
    facts: &RepoFacts,
    opts: &Options,
    classifiers: &[Box<dyn Concern>],
    package: &str,
) -> Option<String> {
    let scoped = Options {
        scope: Scope {
            package: Some(shown_package(package).to_string()),
            ..Scope::default()
        },
        ..opts.clone()
    };
    let r = run(facts, &scoped, classifiers, Guards::ALL).report;
    super::render::package_line_of(&r, package)
}

// ---------- convention links ----------

/// Whether `rule` names `instrument`: a `wrapped_by` alternative, the callee of
/// `calls`, the class of `throws`, or what `avoids` avoids.
pub fn rule_names(rule: &Rule, instrument: &str) -> bool {
    let i = norm_ref(instrument);
    let same = |r: &str| norm_ref(r) == i;
    match rule {
        Rule::WrappedBy { any_of, .. } => any_of.iter().any(|w| same(w)),
        Rule::Calls { callee } => same(callee),
        Rule::Throws { class } => same(class),
        Rule::Avoids { signal } => same(signal) || signal.strip_prefix("import:").is_some_and(same),
        _ => false,
    }
}

/// Links each variant to the conventions (accepted or proposed) whose rule names one of
/// its instruments and whose role covers one of its examples (PLAN-R13 §3 "Convention
/// links", as `security::link_conventions` links shared guards): `covering(path)` are
/// the conventions covering a file, `blocks` says whether one blocks. Accepted ones
/// first, then by id.
pub fn link_conventions<'a>(
    report: &mut PracticesReport,
    covering: &dyn Fn(&str) -> Vec<&'a crate::policy::Convention>,
    blocks: &dyn Fn(&crate::policy::Convention) -> bool,
) {
    use crate::policy::Status;
    for c in &mut report.concerns {
        for v in &mut c.variants {
            if v.kind != VariantKind::Known || v.instruments.is_empty() {
                continue;
            }
            let mut found: BTreeMap<(bool, String), ConventionLink> = BTreeMap::new();
            for e in &v.examples {
                for conv in covering(&e.path) {
                    if conv.status == Status::Rejected
                        || !v.instruments.iter().any(|i| rule_names(&conv.rule, i))
                    {
                        continue;
                    }
                    let accepted = conv.status == Status::Accepted;
                    found.insert(
                        (!accepted, conv.id.clone()),
                        ConventionLink {
                            id: conv.id.clone(),
                            status: if accepted { "accepted" } else { "proposed" }.to_string(),
                            mode: if blocks(conv) { "block" } else { "advise" }.to_string(),
                        },
                    );
                }
            }
            v.conventions = found.into_values().take(caps::EXAMPLES).collect();
        }
    }
}

#[cfg(test)]
mod tests;
