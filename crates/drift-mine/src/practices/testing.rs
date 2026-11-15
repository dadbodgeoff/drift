//! Testing practice (PLAN-R13 §1.9), at the entry points: whether each is tested, and
//! whether its tests assert the cases its own profile calls for. Population: `http`
//! and `server_action` entry points.
//!
//! A test covers an entry point when one of its `test_requests` has the same method
//! (or `ANY`) and either names the entry's file as its `target` or asks for a path the
//! entry's route template answers ([`relation`]), or when the test file imports the
//! handler. A router mounted more than once has an entry point for each mount, and
//! each is a unit of its own here: a request tests the mount whose route it asks for,
//! not the handler's other mounts. Required cases come from the entry's other
//! concerns, each asked only about a unit of its own population: 401 when it signs
//! callers in (`authn`), 403 when `authz` checks a role, 404 when it answers 404 or
//! scopes a dynamic route by tenant, 400 or 422 when it validates.
//!
//! Variants (`<variant>:<runner>`): `tested_all_required`, `tested_some`,
//! `tested_none_asserted`; `untested` is the recorded absence. Unknown [STRICT]: no
//! test matched, but a test file of the package makes a request whose route is not a
//! literal (`reverse()`, a variable) and names no target, or one this route may
//! answer and so may another of the package (two templates fit it equally, or the
//! template holds syntax not read), or the entry has no route while the package's
//! tests make requests (`route_not_matched`): it may be that one.

use std::collections::BTreeSet;

use drift_core::{FileFacts, practice::normalize_route};

use super::authn::{self, Authn};
use super::authz::Authz;
use super::common::{self, unit_symbol, unknown, unreadable, use_of};
use super::libraries::test_runner;
use super::validation::{self, Validation};
use super::{Assignment, Backing, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};
use crate::roles::is_test_path;

pub struct Testing;

impl Concern for Testing {
    fn id(&self) -> &'static str {
        super::TESTING
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, &["http", "server_action"])
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        self.assign_backed(cx, unit).0
    }

    /// The assignment, with the test files that cover the entry point and the required
    /// cases they leave unasserted: nothing for an entry point that is untested or
    /// unknown.
    fn assign_backed<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> (Assignment, Backing) {
        let bare = |a: Assignment| (a, Backing::default());
        if let Some(a) = unreadable(cx, unit) {
            return bare(a);
        }
        let (UnitRef::Entry { file, entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit))
        else {
            return bare(unknown(UnknownReason::NoSymbol, ""));
        };
        if let Some(a) = common::truncated(sfile, s, &["responses"]) {
            return bare(a);
        }
        let route = entry.route.as_deref().and_then(normalize_route);
        let template = entry.route.as_deref().and_then(Template::parse);
        let method = entry.method.as_deref().unwrap_or("ANY");
        let same_method = |m: &str| m == "ANY" || method == "ANY" || m == method;
        let rivals = cx.rivals(rivals);
        let mut runners: BTreeSet<String> = BTreeSet::new();
        let mut covering: BTreeSet<String> = BTreeSet::new();
        let mut asserted: BTreeSet<u16> = BTreeSet::new();
        let mut tested = false;
        let mut ambiguous = false;
        let serving = cx.serving_packages(serving_packages);
        for &tf in cx.test_files() {
            // A package that serves entry points of its own tests those: its client is
            // bound to its own app, so a route of the same shape in another package is
            // not what it asks for (a FastAPI service's `client.get("/v1/rules")` does
            // not test the Next.js proxy at `/api/v1/[...path]`). A package that serves
            // nothing (an end-to-end suite, tests at the repository root) may ask any.
            let elsewhere =
                tf.package != file.package && serving.contains(tf.package.as_str());
            let mut hit = false;
            for r in &tf.test_requests {
                if !same_method(&r.method) {
                    continue;
                }
                let rel = if r.target == file.path {
                    Rel::Hit(Score::WHOLE)
                } else if !r.target.is_empty() || elsewhere {
                    Rel::No
                } else {
                    let own = tf.package == file.package;
                    match (relation(r, template.as_ref(), own), &template) {
                        // A path a parameter or a left-out prefix was needed for: the
                        // package's router gives it to the route that fits it best.
                        (Rel::Hit(score), Some(t)) if !score.settled() => {
                            outranked(r, score, t, own, &file.package, rivals)
                        }
                        (rel, _) => rel,
                    }
                };
                match rel {
                    Rel::Hit(_) => {
                        hit = true;
                        asserted.extend(&r.statuses);
                    }
                    // A request whose route has this one's shape: it may be this one.
                    Rel::Maybe if tf.package == file.package => ambiguous = true,
                    // One whose route cannot be read at all may be any route, but only
                    // of the code the test file could plausibly reach: never every
                    // entry of the package.
                    Rel::Blind if tf.package == file.package && plausible(tf, file) => {
                        ambiguous = true
                    }
                    Rel::Maybe | Rel::Blind | Rel::No => {}
                }
            }
            // A deferred load (`const { GET } = await import("../route")`, written
            // after the mocks are set) hands over the whole module: the facts do not
            // record which exports the test takes from it.
            let imports = tf.imports.iter().any(|i| {
                i.module == file.path
                    && (i.names.is_empty()
                        || i.load != drift_core::ImportLoad::Static
                        || i.names.iter().any(|n| *n == entry.symbol || n == "*"))
            });
            if common::file_truncated(tf, "test_requests") && tf.package == file.package {
                ambiguous = true;
            }
            if hit || imports {
                tested = true;
                runners.insert(runner(cx, tf));
                covering.insert(tf.path.clone());
            }
        }
        if !tested {
            if ambiguous {
                // No instrument: no `practices:` line can name a test's route.
                return bare(unknown(UnknownReason::RouteNotMatched, ""));
            }
            // A package with no test file at all: untested, and so is everything beside
            // it. Said apart, so a count of untested entry points reads honestly.
            let package_has_tests = cx.test_files().iter().any(|f| f.package == file.package);
            return bare(Assignment::None {
                label: if package_has_tests {
                    "untested".into()
                } else {
                    "untested (the package has no tests)".into()
                },
            });
        }
        let mut backing = Backing {
            tests: covering.into_iter().collect(),
            ..Backing::default()
        };
        let variant = if asserted.is_empty() {
            "tested_none_asserted"
        } else {
            // The cases it needs come from its other concerns; one unknown, and whether
            // they are all asserted cannot be told [STRICT].
            let required = match required(cx, unit, s, route.as_deref()) {
                Ok(r) => r,
                Err(a) => return bare(a),
            };
            let met = |need: &Need| match need {
                Need::Status(n) => asserted.contains(n),
                Need::BadInput => asserted.contains(&400) || asserted.contains(&422),
            };
            backing.required = required.iter().map(Need::name).collect();
            backing.missing = required
                .iter()
                .filter(|n| !met(n))
                .map(Need::name)
                .collect();
            if backing.missing.is_empty() {
                "tested_all_required"
            } else {
                "tested_some"
            }
        };
        let uses: Vec<Use> = runners.iter().map(|r| use_of(variant, r)).collect();
        (common::known(uses, VariantSource::Usage), backing)
    }
}

/// Packages with production entry points of the kinds this concern counts.
fn serving_packages<'a>(cx: &Cx<'a>) -> BTreeSet<&'a str> {
    cx.facts
        .files
        .iter()
        .filter(|f| !is_test_path(&f.path))
        .filter(|f| {
            f.entry_points
                .iter()
                .any(|e| e.kind == "http" || e.kind == "server_action")
        })
        .map(|f| f.package.as_str())
        .collect()
}

/// How a test request relates to an entry point's route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Rel {
    /// The request asks for a path the route answers, this well ([`Score`]).
    Hit(Score),
    Maybe,
    /// The request's route (or the entry's) cannot be read at all.
    Blind,
    No,
}

/// How well a request fits a route, to choose between the routes of one package that
/// fit it: a fit of the whole path before one that sets a mount prefix aside, then
/// more literal segments (`/users/me` before `/users/{id}`), then fewer catch-alls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Score {
    whole: bool,
    lits: usize,
    catch_alls: usize,
    /// Concrete segments of the request that parameters took.
    filled: usize,
}

impl Score {
    /// A request that names the handler itself.
    const WHOLE: Score = Score {
        whole: true,
        lits: usize::MAX,
        catch_alls: 0,
        filled: 0,
    };

    /// Literal for literal over the whole path: no other route of the package can fit
    /// the request as well.
    fn settled(&self) -> bool {
        self.whole && self.filled == 0 && self.catch_alls == 0
    }

    /// What routes are ranked by.
    fn rank(&self) -> (bool, usize, std::cmp::Reverse<usize>) {
        (self.whole, self.lits, std::cmp::Reverse(self.catch_alls))
    }
}

/// One segment of a route template.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Seg {
    Lit(String),
    /// A parameter: one segment, of this shape.
    One(Shape),
    /// A catch-all: one or more segments, or none as well (`zero`).
    Many { zero: bool },
}

/// What a parameter's converter accepts (`{id:int}`, `<uuid:id>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Any,
    Int,
    Uuid,
}

impl Shape {
    fn accepts(self, seg: &str) -> bool {
        match self {
            Shape::Any => true,
            Shape::Int => !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()),
            Shape::Uuid => {
                seg.len() == 36
                    && seg.bytes().enumerate().all(|(i, b)| match i {
                        8 | 13 | 18 | 23 => b == b'-',
                        _ => b.is_ascii_hexdigit(),
                    })
            }
        }
    }
}

/// An entry point's route template, segment by segment, in each style Drift reads:
/// `{id}`, `{id:int}`, `{rest:path}`, `<id>`, `<int:id>`, `<path:rest>`, `:id`, `:id*`,
/// `:id+`, `[id]`, `[...rest]`, `[[...rest]]`, `*` and `[*]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Template {
    segs: Vec<Seg>,
    /// The template holds syntax that is not read (an optional parameter, a regular
    /// expression, a converter Drift does not know, a parameter inside a segment, a
    /// path that was not a literal): a path that fits it may be the route's, and is
    /// never said to be.
    unsure: bool,
    /// The template under `normalize_route`: two entry points with the same key answer
    /// the same paths.
    key: String,
}

impl Template {
    /// None when `raw` is no route ([`normalize_route`]).
    fn parse(raw: &str) -> Option<Template> {
        let key = normalize_route(raw)?;
        let raw = raw.trim();
        // A URL, not a template: only its path is the route, as the key has it.
        let path = if raw.contains("//") { key.as_str() } else { raw };
        let mut unsure = false;
        let segs = path
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| Self::seg(s, &mut unsure))
            .collect();
        Some(Template { segs, unsure, key })
    }

    fn seg(s: &str, unsure: &mut bool) -> Seg {
        let ident = |n: &str| !n.is_empty() && n.chars().all(|c| c.is_alphanumeric() || c == '_');
        let inside = |open: &str, close: &str| {
            s.strip_prefix(open)
                .and_then(|r| r.strip_suffix(close))
                .filter(|n| !n.contains(['[', ']', '{', '}', '<', '>']))
        };
        let mut convert = |conv: &str| match conv {
            "" | "str" | "string" => Seg::One(Shape::Any),
            "path" => Seg::Many { zero: false },
            "int" => Seg::One(Shape::Int),
            "uuid" => Seg::One(Shape::Uuid),
            _ => {
                *unsure = true;
                Seg::One(Shape::Any)
            }
        };
        if s == drift_core::practice::ANY_SEGMENT {
            return Seg::One(Shape::Any);
        }
        if s == "*" {
            return Seg::Many { zero: true };
        }
        // A path that was not a literal where the route was registered (drift-ts
        // writes `?`): it may be any.
        if s == "?" {
            *unsure = true;
            return Seg::Many { zero: true };
        }
        if inside("[[...", "]]").is_some_and(ident) {
            return Seg::Many { zero: true };
        }
        if inside("[...", "]").is_some_and(ident) {
            return Seg::Many { zero: false };
        }
        if inside("[", "]").is_some_and(ident) {
            return Seg::One(Shape::Any);
        }
        if let Some(inner) = inside("{", "}") {
            let (name, conv) = inner.split_once(':').unwrap_or((inner, ""));
            if ident(name) {
                return convert(conv);
            }
        }
        if let Some(inner) = inside("<", ">") {
            let (conv, name) = inner.split_once(':').unwrap_or(("", inner));
            if ident(name) {
                return convert(conv);
            }
        }
        if let Some(rest) = s.strip_prefix(':') {
            let end = rest
                .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(rest.len());
            if end > 0 {
                return match &rest[end..] {
                    "" => Seg::One(Shape::Any),
                    "*" => Seg::Many { zero: true },
                    "+" => Seg::Many { zero: false },
                    // `:id?` (with or without the segment), `:id(\d+)`: not read.
                    tail => {
                        *unsure = true;
                        if tail == "?" {
                            Seg::Many { zero: true }
                        } else {
                            Seg::One(Shape::Any)
                        }
                    }
                };
            }
        }
        if s.contains(['{', '}', '[', ']', '<', '>', '(', ')', '*', '+', '?']) {
            *unsure = true;
            return Seg::One(Shape::Any);
        }
        Seg::Lit(s.to_string())
    }
}

/// How a path's segments fit a template's; the larger the better.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Fit {
    /// No `[*]` of the request (a segment that may be anything) stands where the
    /// template has a literal.
    sure: bool,
    lits: usize,
    tight: std::cmp::Reverse<usize>,
    filled: usize,
}

/// The best fit of the request segments `t` to the template segments `e`: every
/// segment of each is used, a literal takes its equal (or a `[*]`, unsurely), a
/// parameter one segment its converter accepts, a catch-all as many as it needs.
fn fit(t: &[&str], e: &[Seg]) -> Option<Fit> {
    let any = drift_core::practice::ANY_SEGMENT;
    let Some((seg, rest)) = e.split_first() else {
        return t.is_empty().then_some(Fit {
            sure: true,
            lits: 0,
            tight: std::cmp::Reverse(0),
            filled: 0,
        });
    };
    match seg {
        Seg::Lit(l) => {
            let (first, tail) = t.split_first()?;
            let mut f = fit(tail, rest)?;
            if first == l {
                f.lits += 1;
            } else if *first == any {
                f.sure = false;
            } else {
                return None;
            }
            Some(f)
        }
        Seg::One(shape) => {
            let (first, tail) = t.split_first()?;
            if *first != any && !shape.accepts(first) {
                return None;
            }
            let mut f = fit(tail, rest)?;
            f.filled += usize::from(*first != any);
            Some(f)
        }
        Seg::Many { zero } => (usize::from(!*zero)..=t.len())
            .filter_map(|k| {
                let mut f = fit(&t[k..], rest)?;
                f.tight.0 += 1;
                f.filled += t[..k].iter().filter(|s| **s != any).count();
                Some(f)
            })
            .max(),
    }
}

/// How the request `r` relates to the entry's route template.
///
/// The request's path is compared segment by segment ([`fit`]), whole, or with the
/// mount prefix one side carries and the other leaves out set aside ([`mount_prefix`]):
/// the request's, for a route whose template leaves it out (a router whose mount is
/// written elsewhere, a proxy in front of a service); the route's, for a request of a
/// test of the route's own package (`own`), whose client may be bound to `/api/v1`.
/// A test of another package is not credited with a route whose prefix it does not
/// write. `/v1/rules` is not `/v2/rules`: a prefix both sides write must be the same.
///
/// - [`Rel::Hit`] when the path fits and a literal segment of the template anchors
///   it. A fit through parameters alone (`/7` to `/{id}`) is no proof: `Maybe`.
/// - [`Rel::Maybe`] also when the template holds syntax not read, or when the request
///   is dynamic (a base-URL constant, an interpolated segment) and its `[*]` segments
///   could be the template's literal ones: the base is an origin, not a path.
/// - [`Rel::Blind`] with no route on either side: it may be any.
fn relation(r: &drift_core::TestRequest, entry: Option<&Template>, own: bool) -> Rel {
    let Some(entry) = entry else {
        return Rel::Blind;
    };
    if r.route.is_empty() {
        return Rel::Blind;
    }
    let Some(route) = normalize_route(&r.route) else {
        return Rel::No;
    };
    let t: Vec<&str> = route.split('/').filter(|s| !s.is_empty()).collect();
    let e = entry.segs.as_slice();
    let whole = fit(&t, e);
    let found = match whole {
        Some(f) if f.sure => Some((true, f)),
        _ => {
            // Leading prefix segments one side may leave out; something must be left.
            let tn = t.iter().take_while(|s| mount_prefix(s)).count();
            let en = e
                .iter()
                .take_while(|s| own && matches!(s, Seg::Lit(l) if mount_prefix(l)))
                .count();
            (1..=tn.min(t.len().saturating_sub(1)))
                .filter_map(|k| fit(&t[k..], e))
                .chain((1..=en.min(e.len().saturating_sub(1))).filter_map(|k| fit(&t, &e[k..])))
                .filter(|f| f.sure)
                .max()
                .map(|f| (false, f))
                .or(whole.map(|f| (true, f)))
        }
    };
    match found {
        None => Rel::No,
        Some((_, f)) if !f.sure => {
            if common::request_dynamic(r) {
                Rel::Maybe
            } else {
                Rel::No
            }
        }
        Some(_) if entry.unsure => Rel::Maybe,
        Some((_, f)) if f.filled > 0 && f.lits == 0 => Rel::Maybe,
        Some((whole, f)) => Rel::Hit(Score {
            whole,
            lits: f.lits,
            catch_alls: f.tight.0,
            filled: f.filled,
        }),
    }
}

/// An entry point a request may be for instead of the unit's: its package, method
/// and route template.
pub(super) struct Rival<'a> {
    package: &'a str,
    method: &'a str,
    template: Template,
}

/// The routed entry points this concern counts, of production files: found once for
/// a run ([`Cx::rivals`]).
fn rivals<'a>(cx: &Cx<'a>) -> Vec<Rival<'a>> {
    let mut out = Vec::new();
    for f in cx.facts.files.iter().filter(|f| !is_test_path(&f.path)) {
        for e in &f.entry_points {
            if (e.kind == "http" || e.kind == "server_action")
                && let Some(template) = e.route.as_deref().and_then(Template::parse)
            {
                out.push(Rival {
                    package: f.package.as_str(),
                    method: e.method.as_deref().unwrap_or("ANY"),
                    template,
                });
            }
        }
    }
    out
}

/// What a hit that needed a parameter or a left-out prefix comes to, once the other
/// routes of the entry's package (one app, one router) are asked: `No` when another
/// fits the request better (`/users/me` is the static route's, not `/users/{id}`'s),
/// `Maybe` when another fits it as well (`/a/{x}/c` and `/a/b/{y}` for `/a/b/c`; the
/// `/v1` and `/v2` mounts of one router for a request that names neither), else the
/// hit. A route with the same template answers the same paths and is no rival.
fn outranked(
    r: &drift_core::TestRequest,
    score: Score,
    own: &Template,
    own_package: bool,
    package: &str,
    rivals: &[Rival<'_>],
) -> Rel {
    let mut tie = false;
    for rival in rivals {
        if rival.package != package
            || rival.template.segs == own.segs
            || !(r.method == "ANY" || rival.method == "ANY" || r.method == rival.method)
        {
            continue;
        }
        if let Rel::Hit(other) = relation(r, Some(&rival.template), own_package) {
            match other.rank().cmp(&score.rank()) {
                std::cmp::Ordering::Greater => return Rel::No,
                std::cmp::Ordering::Equal => tie = true,
                std::cmp::Ordering::Less => {}
            }
        }
    }
    if tie { Rel::Maybe } else { Rel::Hit(score) }
}

/// Test directories that sit beside the code they test (`app/tests`, `__tests__`).
const TEST_DIRS: &[&str] = &["tests", "test", "__tests__", "spec", "specs", "e2e"];

/// A test file could reach the entry when it imports the entry's module, or when the
/// entry's file lies under the directory the test file's test folder belongs to
/// (`backend/accounts/tests/test_x.py` reaches `backend/accounts/`), never the
/// package root alone.
fn plausible(tf: &FileFacts, entry_file: &FileFacts) -> bool {
    if tf.imports.iter().any(|i| i.module == entry_file.path) {
        return true;
    }
    let mut dir: Vec<&str> = tf.path.split('/').collect();
    dir.pop();
    while dir
        .last()
        .is_some_and(|d| TEST_DIRS.contains(d) || d.ends_with("-test") || d.ends_with("_test"))
    {
        dir.pop();
    }
    let base = dir.join("/");
    let root = entry_file.package.trim_end_matches('/');
    !base.is_empty() && base != root && entry_file.path.starts_with(&format!("{base}/"))
}

/// Leading route segments a server mounts its routes under (`/api`, `/v1`), which an
/// entry point's own template, or a test client bound to a base path, may leave out.
fn mount_prefix(seg: &str) -> bool {
    seg == "api"
        || seg == "rest"
        || (seg.len() >= 2 && seg.starts_with('v') && seg[1..].bytes().all(|b| b.is_ascii_digit()))
}

/// A case an entry point's tests should assert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Need {
    Status(u16),
    /// 400 or 422.
    BadInput,
}

impl Need {
    /// The case as the card names it: the status, or `400/422`.
    fn name(&self) -> String {
        match self {
            Need::Status(n) => n.to_string(),
            Need::BadInput => "400/422".into(),
        }
    }
}

/// The cases the entry's own profile calls for; `Err` with the unknown assignment
/// of a concern it is read from.
fn required<'a>(
    cx: &Cx<'a>,
    unit: &UnitRef<'a>,
    s: &drift_core::Symbol,
    route: Option<&str>,
) -> Result<BTreeSet<Need>, Assignment> {
    let mut out = BTreeSet::new();
    let authn = Authn.assign(cx, unit);
    if matches!(authn, Assignment::Unknown { .. }) {
        return Err(authn);
    }
    // Each concern is asked only about a unit of its own population: authorization
    // about one that signs callers in, validation about one that may read input. Of
    // any other they have nothing to say, and what they would answer (validation
    // cannot classify the input of a handler that takes none) is not the unit's.
    let signs_in = authn::read(cx, unit).signs_in();
    let authz = signs_in.then(|| Authz.assign(cx, unit));
    let validation = validation::may_read_input(cx, unit).then(|| Validation.assign(cx, unit));
    for a in [&authz, &validation].into_iter().flatten() {
        if matches!(a, Assignment::Unknown { .. }) {
            return Err(a.clone());
        }
    }
    if matches!(authn, Assignment::Known { .. }) && signs_in {
        out.insert(Need::Status(401));
    }
    let has = |ms: &[&str]| match &authz {
        Some(Assignment::Known { uses, .. }) => {
            uses.iter().any(|u| ms.contains(&u.mechanism.as_str()))
        }
        _ => false,
    };
    if has(&["role_guard", "role_check", "policy"]) {
        out.insert(Need::Status(403));
    }
    let dynamic = route.is_some_and(|r| r.contains(drift_core::practice::ANY_SEGMENT));
    if s.responses.iter().any(|r| r.status == 404) || (dynamic && has(&["tenancy_check"])) {
        out.insert(Need::Status(404));
    }
    if let Some(Assignment::Known { uses, .. }) = &validation
        && uses
            .iter()
            .any(|u| u.mechanism == "schema" || u.mechanism == "typed_model")
    {
        out.insert(Need::BadInput);
    }
    Ok(out)
}

/// The runner a test file uses: one it imports, else its package's one test runner
/// dependency, else `tests`.
fn runner(cx: &Cx<'_>, tf: &FileFacts) -> String {
    if let Some(r) = tf.imports.iter().find_map(|i| test_runner(&i.module)) {
        return r;
    }
    let deps: BTreeSet<String> = cx
        .facts
        .packages
        .iter()
        .filter(|p| p.path == tf.package)
        .flat_map(|p| &p.dependencies)
        .filter_map(|d| crate::context::split_dep(d).map(|(n, _)| n))
        .filter_map(|n| test_runner(&format!("pkg:{n}")))
        .collect();
    match deps.len() {
        1 => deps.into_iter().next().unwrap_or_default(),
        _ => "tests".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn required_cases_from_the_profile() {
        let d = empty();
        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(
            key(&of(&all, route, "GET")),
            "tested_all_required:@playwright/test+tested_all_required:vitest"
        );
        // The unit test calls GET only.
        assert!(matches!(of(&all, route, "POST"), Assignment::None { .. }));
        assert_eq!(
            key(&of(&all, "app/api/webhooks/stripe/route.ts", "POST")),
            "tested_all_required:@playwright/test"
        );
        assert!(matches!(
            of(&all, "app/api/legacy/route.ts", "GET"),
            Assignment::None { .. }
        ));

        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        let items = "services/api/app/routers/items.py";
        // 401 is required (it signs callers in) and not asserted.
        assert_eq!(key(&of(&all, items, "read_item")), "tested_some:pytest");
        // Its tenancy is unknown, so its required cases are too.
        assert_eq!(
            of(&all, items, "create_item"),
            unknown(UnknownReason::NotFollowed, "header:x-org-id")
        );

        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        let ctl = "src/projects/projects.controller.ts";
        for name in ["GET /projects/:id", "POST /projects"] {
            assert_eq!(
                of(&all, ctl, name),
                unknown(UnknownReason::OpaqueWrapper, "pkg:@nestjs/common#UseGuards")
            );
        }
    }

    #[test]
    fn unmatched_dynamic_requests_are_unknown() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/routes.py", "list_items")),
            "tested_all_required:pytest"
        );
        assert_eq!(
            of(&all, "svc/app/routes.py", "admin_items"),
            unknown(UnknownReason::RouteNotMatched, "")
        );
    }

    /// The test files and the serving packages are found once for a run
    /// ([`Cx::test_files`], [`Cx::serving_packages`]): a unit reads the same asked
    /// after every other unit of the run as it does asked first.
    #[test]
    fn a_unit_reads_the_same_asked_first_or_after_the_others() {
        let d = empty();
        for facts in [
            fixtures::next_clerk(),
            fixtures::fastapi_split(),
            fixtures::nest_mixed(),
            fixtures::ts_cases(),
            fixtures::py_cases(),
        ] {
            let shared = Cx::new(&facts, &d);
            let units = Testing.population(&shared);
            assert!(!units.is_empty());
            // What the run remembers is what the facts say, file for file.
            let tests: Vec<&str> = shared.test_files().iter().map(|f| &*f.path).collect();
            let want: Vec<&str> = facts
                .files
                .iter()
                .filter(|f| is_test_path(&f.path))
                .map(|f| f.path.as_str())
                .collect();
            assert_eq!(tests, want);
            assert_eq!(
                shared.serving_packages(serving_packages),
                &serving_packages(&shared)
            );
            let together: Vec<_> = units
                .iter()
                .map(|u| Testing.assign_backed(&shared, u))
                .collect();
            for (u, got) in units.iter().zip(&together) {
                let alone = Cx::new(&facts, &d);
                assert_eq!(&Testing.assign_backed(&alone, u), got);
            }
        }
    }

    /// A production file of `package` serving `entries` (`(symbol, method, route)`).
    fn served(path: &str, package: &str, entries: &[(&str, &str, &str)]) -> FileFacts {
        FileFacts {
            path: path.into(),
            package: package.into(),
            parse_ok: true,
            symbols: entries
                .iter()
                .map(|(symbol, _, _)| drift_core::Symbol {
                    name: symbol.to_string(),
                    exported_as: vec![symbol.to_string()],
                    line: 1,
                    ..Default::default()
                })
                .collect(),
            entry_points: entries
                .iter()
                .map(|(symbol, method, route)| drift_core::EntryPoint {
                    symbol: symbol.to_string(),
                    kind: "http".into(),
                    method: Some(method.to_string()),
                    route: Some(route.to_string()),
                    adapter: String::new(),
                })
                .collect(),
            ..Default::default()
        }
    }

    fn import(module: &str, names: &[&str], load: drift_core::ImportLoad) -> drift_core::Import {
        drift_core::Import {
            module: module.into(),
            names: names.iter().map(|n| n.to_string()).collect(),
            type_only: false,
            load,
        }
    }

    /// A test file of `package` that imports `runner` and asks `GET` of each route,
    /// asserting no status (so no case its entry's other concerns call for is read).
    fn test_file(path: &str, package: &str, runner: &str, routes: &[&str]) -> FileFacts {
        FileFacts {
            path: path.into(),
            package: package.into(),
            parse_ok: true,
            imports: vec![import(runner, &["*"], drift_core::ImportLoad::Static)],
            test_requests: routes
                .iter()
                .map(|r| drift_core::TestRequest {
                    method: "GET".into(),
                    route: r.to_string(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    fn repo(mut files: Vec<FileFacts>) -> drift_core::RepoFacts {
        files.sort_by(|a, b| a.path.cmp(&b.path));
        drift_core::RepoFacts {
            files,
            ..Default::default()
        }
    }

    /// A monorepo: a Next.js app proxies `/api/v1/rules` to a FastAPI service's
    /// `/v1/rules`, the same route once the mount prefixes are set aside.
    const PROXY: &str = "frontend/app/api/v1/rules/route.ts";
    const SERVICE: &str = "services/api/app/rules.py";

    fn proxy_and_service() -> Vec<FileFacts> {
        vec![
            served(PROXY, "frontend", &[("GET", "GET", "/api/v1/rules")]),
            served(
                SERVICE,
                "services/api",
                &[("list_rules", "GET", "/v1/rules")],
            ),
            test_file(
                "services/api/tests/test_rules.py",
                "services/api",
                "pkg:pytest",
                &["/v1/rules"],
            ),
        ]
    }

    /// A package that serves entry points of its own tests those: the service's pytest
    /// client asks the service, not the app's route of the same shape.
    #[test]
    fn a_serving_packages_tests_do_not_bind_another_packages_route() {
        let d = empty();
        assert!(hits("/v1/rules", "/api/v1/rules"));
        let facts = repo(proxy_and_service());
        let cx = Cx::new(&facts, &d);
        assert_eq!(
            serving_packages(&cx).into_iter().collect::<Vec<_>>(),
            ["frontend", "services/api"]
        );
        let all = assign_all(&Testing, &cx);
        assert_eq!(
            key(&of(&all, SERVICE, "list_rules")),
            "tested_none_asserted:pytest"
        );
        assert_eq!(
            of(&all, PROXY, "GET"),
            Assignment::None {
                label: "untested (the package has no tests)".into()
            }
        );
    }

    /// A package that serves nothing (an end-to-end suite, tests at the repository
    /// root) may ask any package's route.
    #[test]
    fn a_package_that_serves_nothing_tests_any_packages_route() {
        let d = empty();
        for (path, package) in [("e2e/rules.spec.ts", "e2e"), ("tests/rules.spec.ts", "")] {
            let mut files = proxy_and_service();
            files.push(test_file(
                path,
                package,
                "pkg:@playwright/test",
                &["/api/v1/rules"],
            ));
            let facts = repo(files);
            let cx = Cx::new(&facts, &d);
            let all = assign_all(&Testing, &cx);
            assert_eq!(
                key(&of(&all, PROXY, "GET")),
                "tested_none_asserted:@playwright/test",
                "{path}"
            );
            assert_eq!(
                key(&of(&all, SERVICE, "list_rules")),
                "tested_none_asserted:@playwright/test+tested_none_asserted:pytest",
                "{path}"
            );
        }
    }

    /// A test in another serving package that calls the handler itself (`target`) or
    /// imports it still tests it: only a route string is the package's own.
    #[test]
    fn another_serving_package_still_tests_what_it_names() {
        let d = empty();
        let mut files = proxy_and_service();
        files[2].test_requests[0].target = PROXY.into();
        let facts = repo(files);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(
            key(&of(&all, PROXY, "GET")),
            "tested_none_asserted:pytest",
            "by target"
        );

        let mut files = proxy_and_service();
        files[2].test_requests.clear();
        files[2].imports.push(import(
            PROXY,
            &["GET"],
            drift_core::ImportLoad::Static,
        ));
        let facts = repo(files);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(
            key(&of(&all, PROXY, "GET")),
            "tested_none_asserted:pytest",
            "by import"
        );
    }

    /// `const { GET } = await import("../route")`, written after the mocks are set, is
    /// the test importing the handler. The facts name no export of a deferred load
    /// (`default`), so it hands over every handler of the module; a static import
    /// tests the names it takes.
    #[test]
    fn a_deferred_import_of_the_route_counts_as_importing_it() {
        use drift_core::ImportLoad;
        let d = empty();
        let route = "app/api/items/route.ts";
        let handlers = [("GET", "GET", "/api/items"), ("POST", "POST", "/api/items")];
        let with = |names: &[&str], load: ImportLoad| {
            let mut test = test_file("app/api/items/route.test.ts", "", "pkg:vitest", &[]);
            test.imports.push(import(route, names, load));
            repo(vec![served(route, "", &handlers), test])
        };
        for load in [ImportLoad::Dynamic, ImportLoad::Require] {
            let facts = with(&["default"], load);
            let cx = Cx::new(&facts, &d);
            let all = assign_all(&Testing, &cx);
            for name in ["GET", "POST"] {
                assert_eq!(
                    key(&of(&all, route, name)),
                    "tested_none_asserted:vitest",
                    "{name} {load:?}"
                );
            }
        }
        // A static import: the names it takes, and a default export is not a handler.
        let facts = with(&["GET"], ImportLoad::Static);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(
            key(&of(&all, route, "GET")),
            "tested_none_asserted:vitest"
        );
        assert_eq!(
            of(&all, route, "POST"),
            Assignment::None {
                label: "untested".into()
            }
        );
        let facts = with(&["default"], ImportLoad::Static);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        for name in ["GET", "POST"] {
            assert!(
                matches!(of(&all, route, name), Assignment::None { .. }),
                "{name}"
            );
        }
    }

    fn req(route: &str, dynamic: bool) -> drift_core::TestRequest {
        drift_core::TestRequest {
            method: "GET".into(),
            route: route.into(),
            dynamic,
            ..Default::default()
        }
    }

    /// How a literal request for `test` relates to the route template `entry`.
    fn rel(test: &str, entry: &str) -> Rel {
        relation(&req(test, false), Template::parse(entry).as_ref(), true)
    }

    fn hits(test: &str, entry: &str) -> bool {
        matches!(rel(test, entry), Rel::Hit(_))
    }

    #[test]
    fn routes_match_across_mount_prefixes() {
        assert!(hits("/api/v1/projects/[*]", "/projects/[*]"));
        assert!(hits("/v2/api-keys/refresh", "/api-keys/refresh"));
        assert!(hits("/projects/123?x=1", "/projects/123"));
        assert!(!hits("/api/v1", "/"));
        assert!(!hits("/api/v1/projects", "/projects/[*]"));
        // A prefix both sides write must be the same one: another version of the API
        // is another route.
        assert!(hits("/v1/rules", "/api/v1/rules"));
        assert!(hits("/api/v1/rules", "/v1/rules"));
        assert_eq!(rel("/v1/rules", "/v2/rules"), Rel::No);
        assert_eq!(rel("/api/v1/rules/7", "/api/v2/rules/{id}"), Rel::No);
        let at = |route: &str, dynamic: bool, entry: &str| {
            relation(&req(route, dynamic), Template::parse(entry).as_ref(), true)
        };
        // A test of another package: the prefix the route writes must be in the
        // request (a service's `/v2/x` is not the web app's `/api/v2/[...path]`); the
        // one the request writes may be left out of the route.
        let other = |route: &str, entry: &str| {
            relation(&req(route, false), Template::parse(entry).as_ref(), false)
        };
        assert_eq!(other("/v2/workspaces/7", "/api/v2/[...path]"), Rel::No);
        assert!(matches!(other("/api/v2/workspaces/7", "/api/v2/[...path]"), Rel::Hit(_)));
        assert!(matches!(other("/api/v1/rules", "/v1/rules"), Rel::Hit(_)));
        assert!(matches!(at("/x/y", false, "/x/y"), Rel::Hit(_)));
        assert_eq!(at("/y", false, "/x/y"), Rel::No);
        // An interpolated segment: `/x/[*]` may be `/x/y`, not `/z/y` or `/x/y/z`.
        assert_eq!(at("/x/[*]", true, "/x/y"), Rel::Maybe);
        assert_eq!(at("/x/[*]", true, "/z/y"), Rel::No);
        assert_eq!(at("/x/[*]", true, "/x/y/z"), Rel::No);
        assert!(matches!(at("/x/y", true, "/x/y"), Rel::Hit(_)));
        assert_eq!(at("", false, "/x/z"), Rel::Blind);
        assert_eq!(relation(&req("/x/z", false), None, true), Rel::Blind);
    }

    /// A concrete segment of a request is what a parameter of the route takes, in
    /// each style a route template is written in.
    #[test]
    fn a_concrete_segment_matches_a_parameter_in_every_style() {
        for entry in [
            "/things/{thing_id}",
            "/things/{thing_id:int}",
            "/things/<int:thing_id>",
            "/things/<thing_id>",
            "/things/:thing_id",
            "/things/[thing_id]",
            "/things/[*]",
            "things/<int:thing_id>/",
        ] {
            assert!(hits("/things/7", entry), "{entry}");
            // With a slash at the end, a query string, a mount prefix, an origin.
            assert!(hits("/things/7/", entry), "{entry}");
            assert!(hits("/things/7?verbose=1", entry), "{entry}");
            assert!(hits("/api/v1/things/7", entry), "{entry}");
            assert!(hits("http://testserver/things/7", entry), "{entry}");
            // One segment, no more and no fewer; and the literal one must be there.
            assert_eq!(rel("/things", entry), Rel::No, "{entry}");
            assert_eq!(rel("/things/7/parts", entry), Rel::No, "{entry}");
            assert_eq!(rel("/others/7", entry), Rel::No, "{entry}");
        }
        // A converter takes what it accepts.
        for entry in ["/things/{id:int}", "/things/<int:id>"] {
            assert_eq!(rel("/things/latest", entry), Rel::No, "{entry}");
        }
        assert!(hits(
            "/things/0b0e5a52-7c1f-4f0a-9d0e-2f6b1c3a4d5e",
            "/things/<uuid:id>"
        ));
        assert_eq!(rel("/things/7", "/things/<uuid:id>"), Rel::No);
        // Catch-alls: one or more segments, or none as well.
        for entry in [
            "/files/[...path]",
            "/files/{path:path}",
            "/files/<path:path>",
        ] {
            assert!(hits("/files/a", entry), "{entry}");
            assert!(hits("/files/a/b/c.txt", entry), "{entry}");
            assert_eq!(rel("/files", entry), Rel::No, "{entry}");
        }
        for entry in ["/files/[[...path]]", "/files/*", "/files/:path*"] {
            assert!(hits("/files/a/b", entry), "{entry}");
            assert!(hits("/files", entry), "{entry}");
        }
        assert!(hits("/a/x/y/z", "/a/[...rest]/z"));
        assert_eq!(rel("/a/z", "/a/[...rest]/z"), Rel::No);
    }

    /// Covered is said only of a route a test provably requests [STRICT]: a fit with
    /// no literal segment in it, or to a template with syntax that is not read, may
    /// be the route.
    #[test]
    fn a_fit_that_proves_nothing_is_a_maybe() {
        assert_eq!(rel("/7", "/{id}"), Rel::Maybe);
        assert_eq!(rel("/a/b", "/[...path]"), Rel::Maybe);
        // An optional parameter, a regular expression, a converter Drift does not
        // know, a parameter inside a segment, a path that was not a literal.
        for (test, entry) in [
            ("/users/7", "/users/:id?"),
            ("/users", "/users/:id?"),
            ("/users/7", "/users/:id(\\d+)"),
            ("/users/7", "/users/{id:slug}"),
            ("/files/a.txt", "/files/{name}.txt"),
            ("/users/7", "?"),
            ("/api/users/7", "/api/?"),
        ] {
            assert_eq!(rel(test, entry), Rel::Maybe, "{test} {entry}");
        }
        assert_eq!(rel("/teams/7", "/users/:id?"), Rel::No);
        assert_eq!(rel("/users/7", "/admin/?"), Rel::No);
    }

    /// One package, one router: the request is for the route that fits it best, and
    /// for none of them when two fit it equally.
    #[test]
    fn the_static_route_is_preferred_and_a_tie_is_unknown() {
        let d = empty();
        let app = "svc/app/users.py";
        let with = |entries: &[(&str, &str, &str)], routes: &[&str]| {
            repo(vec![
                served(app, "svc", entries),
                test_file("svc/tests/test_users.py", "svc", "pkg:pytest", routes),
            ])
        };
        let none = Assignment::None {
            label: "untested".into(),
        };
        let users = [
            ("me", "GET", "/users/me"),
            ("one", "GET", "/users/{user_id}"),
        ];
        // `/users/me` is the static route's and does not test the parameterised one.
        let facts = with(&users, &["/users/me"]);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(key(&of(&all, app, "me")), "tested_none_asserted:pytest");
        assert_eq!(of(&all, app, "one"), none);
        // `/users/7` is the parameterised route's.
        let facts = with(&users, &["/users/7"]);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(of(&all, app, "me"), none);
        assert_eq!(key(&of(&all, app, "one")), "tested_none_asserted:pytest");
        // Two templates that fit `/a/b/c` equally: which one it tests is unknown.
        let tied = [("x", "GET", "/a/{x}/c"), ("y", "GET", "/a/b/{y}")];
        let facts = with(&tied, &["/a/b/c"]);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        for name in ["x", "y"] {
            assert_eq!(
                of(&all, app, name),
                unknown(UnknownReason::RouteNotMatched, ""),
                "{name}"
            );
        }
        // The other method's route is no rival.
        let methods = [("me", "POST", "/users/me"), ("one", "GET", "/users/{id}")];
        let facts = with(&methods, &["/users/me"]);
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        assert_eq!(key(&of(&all, app, "one")), "tested_none_asserted:pytest");
    }

    /// A router mounted at `/v1` and `/v2` is two entry points and two units: a test
    /// that asks for `/v1/things/7` tests that mount, one that names neither prefix
    /// may be for either, and one that calls the handler tests both.
    #[test]
    fn each_mount_of_a_router_is_tested_by_the_requests_for_it() {
        let d = empty();
        let app = "svc/app/things.py";
        let mounts = [
            ("read_thing", "GET", "/v1/things/{thing_id}"),
            ("read_thing", "GET", "/v2/things/{thing_id}"),
        ];
        let answers = |facts: &drift_core::RepoFacts| -> Vec<Assignment> {
            let cx = Cx::new(facts, &d);
            Testing
                .population(&cx)
                .iter()
                .map(|u| Testing.assign(&cx, u))
                .collect()
        };
        let with = |routes: &[&str]| {
            repo(vec![
                served(app, "svc", &mounts),
                test_file("svc/tests/test_things.py", "svc", "pkg:pytest", routes),
            ])
        };
        let got = answers(&with(&["/v1/things/7"]));
        assert_eq!(key(&got[0]), "tested_none_asserted:pytest");
        assert_eq!(
            got[1],
            Assignment::None {
                label: "untested".into()
            }
        );
        let got = answers(&with(&["/things/7"]));
        for a in &got {
            assert_eq!(a, &unknown(UnknownReason::RouteNotMatched, ""));
        }
        let mut files = vec![
            served(app, "svc", &mounts),
            test_file("svc/tests/test_things.py", "svc", "pkg:pytest", &[]),
        ];
        files[1].imports.push(import(
            app,
            &["read_thing"],
            drift_core::ImportLoad::Static,
        ));
        for a in &answers(&repo(files)) {
            assert_eq!(key(a), "tested_none_asserted:pytest");
        }
    }

    /// The cases a tested entry point should assert come from its other concerns, and
    /// each is asked only about a unit of its own population: a handler that takes no
    /// input is no unit of validation, whose answer for it (it cannot tell whether
    /// input is read) is not the entry's.
    #[test]
    fn a_tested_handler_that_takes_no_input_is_known() {
        let d = empty();
        let app = "svc/app/health.py";
        let mut file = served(app, "svc", &[("health", "GET", "/health")]);
        file.symbols[0].controls = vec![drift_core::controls::NO_INPUT.into()];
        let mut test = test_file("svc/tests/test_health.py", "svc", "pkg:pytest", &["/health"]);
        test.test_requests[0].statuses = vec![200];
        let facts = repo(vec![file, test]);
        let cx = Cx::new(&facts, &d);
        let unit = &Testing.population(&cx)[0];
        assert!(!validation::may_read_input(&cx, unit));
        assert!(matches!(
            Validation.assign(&cx, unit),
            Assignment::Unknown { .. }
        ));
        let all = assign_all(&Testing, &cx);
        assert_eq!(key(&of(&all, app, "health")), "tested_all_required:pytest");
    }

    /// A route-less request is ambiguous only for code its test file could reach:
    /// the app beside its test folder, never the whole package.
    #[test]
    fn blind_requests_stay_near_their_test_file() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Testing, &cx);
        // `svc/app/tests/` reaches `svc/app/routes.py`, not `svc/web/views.py`.
        assert_eq!(
            of(&all, "svc/app/routes.py", "admin_items"),
            unknown(UnknownReason::RouteNotMatched, "")
        );
        assert!(matches!(
            of(&all, "svc/web/views.py", "ItemView.get"),
            Assignment::None { .. }
        ));
    }
}
