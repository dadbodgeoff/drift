//! A practice a person turned into a convention (docs/v2/PROMOTE-A-PRACTICE.md).
//!
//! The practice map says what the code does: facts, not rules. A person who reads "38
//! of 40 entry points here sign a caller in with `withAuth`" can make that the rule for
//! new code in one step: [`candidate`] says whether the place qualifies and what the
//! step would record, [`convention`] is the accepted convention it writes (a
//! [`Rule::Practice`]), and [`check`] holds the code to it from then on.
//!
//! The rule is checked by the classifier that draws the map, never by matching a name:
//! a unit follows it when the map says it does the concern one of the accepted ways
//! (by variant key), breaks it when the map says another known way or `none`, and is
//! **never reported when the map cannot tell** (counted, [`NotChecked`]). A convention
//! whose ways no unit of its place uses any more is stale ([`Stale`]) and fires on
//! nothing: a renamed guard never becomes forty violations.
//!
//! What may be promoted is decided from counts, never from names: the place has at
//! least [`MIN_ROLE_SIZE`] units of the concern, the accepted ways hold at least
//! [`PLACE_SHARE`] of the units Drift could read, and at most [`MAX_UNKNOWN_SHARE`] of
//! the place is unknown. A person may promote below the share (`force`); nobody may
//! promote what Drift cannot read.
//!
//! A unit's own way is read where its variant stands for several ([`UnitRow::key`]: the
//! tail of one-off ways, a folded policy), so a unit of a fold follows when its own way
//! is accepted, and promoting a fold (`any_of(A|B)`) accepts both of its ways. A
//! handler mounted on several routes is one row per mount and one unit here: it
//! follows when every mount does, and breaks when one does.
//!
//! What follows is the classifier's to say ([`Concern`]): where a concern's uses add
//! up ([`Concern::additive`]: sign-in, permissions, validation, responses), a unit that
//! does an accepted way and more follows it; a practice may accept a mechanism whole
//! ("any membership guard") or any way the classifier says enforces the concern ("any
//! way that turns an unsigned caller away"), and a way that opens a route on purpose
//! is accepted only when a person names it. A background job takes no request: it is
//! no unit of a concern about the caller ([`Concern::needs_a_caller`]).
//!
//! Deterministic: everything is read in report order and sorted.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use drift_core::ingest::Lang;
use drift_core::{FileFacts, RepoFacts, SymbolKind};
use serde::{Deserialize, Serialize};

use super::common::{JOB, use_from_key, use_keys};
use super::depart::PLACE_SHARE;
use super::{
    CONCERNS, Concern, ConcernReport, Example, PracticesReport, Promotable, TAIL, UnitRow,
    UnknownReason, Use, Variant, VariantKind, mechanism_of, plain_concern, plain_way,
};
use crate::check::{Extent, Scope, Violation};
use crate::mine::{Evidence, MIN_ROLE_SIZE, Rule, r3, wilson_lower_bound};
use crate::policy::{AgentsChoice, Convention, ConventionsFile, Lock, Mode, Status};
use crate::report::sanitize;
use crate::roles::{PACKAGE_WIDE, RoleSelector};

/// The largest share of a place's units that may be unknown for a practice to be
/// promoted there: Drift cannot hold code to what it cannot read.
pub const MAX_UNKNOWN_SHARE: f64 = 0.2;

/// The share of a place's readable units the accepted ways must hold for a promoted
/// practice to block ([`PLACE_SHARE`]): one promoted below it advises, whatever its mode.
pub const BLOCK_SHARE: f64 = PLACE_SHARE;

/// How many of the units most recently added to a place [`replay`] reads.
pub const REPLAY_UNITS: usize = crate::mine::MIN_BLOCK_ROLE_SIZE;

/// The file kind of a promoted practice's role ([`RoleSelector::file`]). No file is of
/// this kind, so the role holds no member wherever a convention's role members are
/// looked up (`check`'s role members, a card's, the hooks'): the role only carries the
/// place, and the practice map says which units are in it.
pub const PRACTICE_FILE: &str = "(practice)";

/// Exceptions named in a preview before "and N more".
const NAMED: usize = 3;

/// The concerns under which a file a person set apart as a different kind covers only
/// the entry points they confirmed by name ([`crate::calibrate::auth_or_validation`]
/// for the mined rules).
const CONFIRM_BY_NAME: &[&str] = &[super::AUTHN, super::AUTHZ, super::VALIDATION];

/// Where a promoted practice holds: a package, one directory of it, one file of it, or
/// the routes of it under a literal route prefix. At most one of `file` and `route` is
/// set; with neither, the place is the directory (and serialises as it always did).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Place {
    /// The package directory ("" the root package).
    pub package: String,
    /// The directory below the package ("" the whole package), without a trailing
    /// slash: a unit is in the place when its file is in this directory or below it.
    /// Of a file place, the file's directory; of a route place, "".
    pub dir: String,
    /// One file (repo-relative path): a unit is in the place when its file is exactly
    /// this one. "Every route in this router signs the caller in this way."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// A literal route prefix, by segment, each parameter as
    /// [`drift_core::practice::ANY_SEGMENT`] (`/api/workspaces/[*]/projects/[*]`): a
    /// unit is in the place when a route Drift read to the end as a literal has these
    /// first segments. A unit whose route was not read so is never in it, and is
    /// counted as not read wherever it could be under the prefix. Or the keys of a
    /// tRPC procedure path, ending in `.` (`viewer.me.`): a procedure is in the
    /// place when its dotted path starts with those keys ([`procedure_segments`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
}

/// The kind of a [`Place`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Dir,
    File,
    Route,
}

/// Where a place is in a `--in` argument: a route prefix follows its package and this
/// separator (`apps/api:/api/v2`, `.:/api/workspaces/<slug>` for the root package), and
/// so do the keys of a tRPC procedure path, ending in `.` (`packages/trpc:/viewer.me.`).
pub const ROUTE_SEPARATOR: &str = ":/";

/// The segments of a route as the facts record it that Drift read as literals, each
/// parameter (`:id`, `[id]`, `{id}`, `<int:id>`) as
/// [`drift_core::practice::ANY_SEGMENT`], and whether the whole route was read so.
/// Reading stops at the first segment that is not a literal: one the adapter could not
/// read (`?`), a pattern (`*`, a regex). A route that does not start with `/` (no
/// route, a procedure or command name) is read to no segment.
fn route_segments(route: Option<&str>) -> (Vec<String>, bool) {
    let Some(raw) = route.map(str::trim).filter(|r| r.starts_with('/')) else {
        return (Vec::new(), false);
    };
    let mut out: Vec<String> = Vec::new();
    for seg in raw.split('/').filter(|s| !s.is_empty()) {
        // A segment that takes any number of segments (`[...slug]`, `[[...slug]]`,
        // `{p:path}`, `<path:p>`, `:p*`, `:p(.*)`) is no one parameter: the routes it
        // serves are not known, so reading stops and the unit is counted as not read
        // wherever it could be under a prefix (`[[...slug]]` serves the prefix itself
        // too), never a member of a prefix it was read to the end of.
        let catch_all = seg.starts_with("[...")
            || seg.starts_with("[[")
            || (seg.starts_with('{') && seg.ends_with(":path}"))
            || seg.starts_with("<path:")
            || (seg.starts_with(':') && seg.contains(['*', '+', '(']));
        if catch_all {
            return (out, false);
        }
        let param = !seg.contains('?')
            && seg.len() > 1
            && (seg.starts_with(':')
                || (seg.starts_with('[') && seg.ends_with(']'))
                || (seg.starts_with('{') && seg.ends_with('}'))
                || (seg.starts_with('<') && seg.ends_with('>')));
        if param {
            out.push(drift_core::practice::ANY_SEGMENT.to_string());
        } else if seg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'@'))
        {
            out.push(seg.to_string());
        } else {
            return (out, false);
        }
    }
    (out, true)
}

/// The kind of entry point a tRPC procedure is: its route is its dotted path
/// (`viewer.me.get`), read by [`procedure_segments`].
const RPC: &str = "rpc";

/// What ends a route place's prefix when it is a procedure path's (`viewer.me.`),
/// where an HTTP prefix starts with `/`: the procedures whose path starts with these
/// keys.
const PROCEDURE_END: char = '.';

/// The keys of a procedure's dotted path that Drift read, and whether it read them
/// all: reading stops at a key it could not read (`?`, a router mounted where Drift
/// does not read it), as [`route_segments`] stops at a segment.
fn procedure_segments(path: &str) -> (Vec<String>, bool) {
    let mut out = Vec::new();
    for key in path.trim().split(PROCEDURE_END) {
        let literal = !key.is_empty()
            && key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'$'));
        if !literal {
            return (out, false);
        }
        out.push(key.to_string());
    }
    (out, true)
}

/// Whether a stored prefix is a procedure path's ([`PROCEDURE_END`]).
fn is_procedure_prefix(prefix: &str) -> bool {
    prefix.ends_with(PROCEDURE_END)
}

/// The segments of a unit's route for route places, whether they are all of it, and
/// whether they are a procedure path's: an HTTP route as [`route_segments`] reads
/// it, a tRPC procedure's dotted path as [`procedure_segments`] does.
fn unit_segments(kind: Option<&str>, route: Option<&str>) -> (Vec<String>, bool, bool) {
    match route {
        Some(r) if kind == Some(RPC) && !r.trim_start().starts_with('/') => {
            let (segs, whole) = procedure_segments(r);
            (segs, whole, true)
        }
        _ => {
            let (segs, whole) = route_segments(route);
            (segs, whole, false)
        }
    }
}

/// The entry-point kinds of `c` (as the facts name them, [`UnitRow::kind`]) that are
/// served at a path: those of which Drift read at least one unit's route as a path (it
/// starts with `/`). Read from the units, never from a list of kinds: a kind none of
/// whose units has a path (a server action, a GraphQL resolver whose route is
/// `Class.method`, an RPC procedure named by its key, a job) has no route at all, so a
/// unit of it is outside every route place. It is not unknown there: no config line
/// could ever place it under a prefix. Only a unit of a kind served at a path whose own
/// route Drift could not read is counted as not read under the prefixes it could be
/// under. A unit with no kind recorded is read as one of a kind served at a path, so
/// it is still counted as not read rather than left out.
fn routed_kinds(c: &ConcernReport) -> BTreeSet<&str> {
    c.units
        .iter()
        .filter(|u| {
            u.route
                .as_deref()
                .is_some_and(|r| r.trim_start().starts_with('/'))
        })
        .filter_map(|u| u.kind.as_deref())
        .collect()
}

/// The canonical form of a stored route prefix ([`Rule::Practice`] `under_route`), as
/// [`Place::parse`] writes one: by segment, each parameter (`:id`, `{id}`, `<id>`,
/// `[id]`) as [`drift_core::practice::ANY_SEGMENT`], no trailing slash, a leading
/// slash added when it has none. Every read of a promoted practice's place goes
/// through it ([`place_of`]), and so does the write ([`convention`]), so a value a
/// person edited by hand (`/api/v2/`, `/api/:id`) holds the units its canonical form
/// does. `None` for a value that is no literal prefix of at least one segment (`/`,
/// `/api/*`, a catch-all): such a value is kept as written, holds no unit, and the
/// practice is reported stale (it fires on nothing).
pub fn canonical_route(prefix: &str) -> Option<String> {
    let text = prefix.trim();
    // A procedure path's prefix (`viewer.me.`): its keys, then the end mark.
    if is_procedure_prefix(text) {
        let keys = text.trim_start_matches('/').trim_end_matches(PROCEDURE_END);
        let (segs, whole) = procedure_segments(keys);
        return (whole && !segs.is_empty()).then(|| format!("{}{PROCEDURE_END}", segs.join(".")));
    }
    let text = if text.starts_with('/') {
        text.to_string()
    } else {
        format!("/{text}")
    };
    let (segs, whole) = route_segments(Some(text.as_str()));
    (whole && !segs.is_empty()).then(|| format!("/{}", segs.join("/")))
}

/// The segments of a stored route prefix.
fn prefix_segments(prefix: &str) -> Vec<&str> {
    let sep = if is_procedure_prefix(prefix) {
        PROCEDURE_END
    } else {
        '/'
    };
    prefix.split(sep).filter(|s| !s.is_empty()).collect()
}

/// Whether one list of segments starts with the other, either way: a route read up
/// to `a` may be under the prefix `b`.
fn compatible<A: AsRef<str>, B: AsRef<str>>(a: &[A], b: &[B]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.as_ref() == y.as_ref())
}

/// The packages of the report's units and profiles.
fn packages(report: &PracticesReport) -> BTreeSet<&str> {
    report
        .concerns
        .iter()
        .flat_map(|c| {
            c.units
                .iter()
                .map(|u| u.package.as_str())
                .chain(c.by_package.iter().map(|p| p.package.as_str()))
        })
        .collect()
}

/// One way of doing a concern in a place: a known variant of the map.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Way {
    /// The variant's id (`P-…`).
    pub id: String,
    /// Its key ([`super::VariantKey::key`]): what the rule stores.
    pub key: String,
    pub label: String,
    /// The units of the place that do it this way. Ways may overlap: where the uses of
    /// a concern add up ([`Concern::additive`]), a unit that does two accepted ways is a
    /// member of each, so the members of a practice's ways (its `Evidence.split`) may
    /// sum to more than the units that follow it.
    pub members: usize,
    /// A folded policy's alternatives' keys (`any_of(A|B)` accepts `A` and `B`); empty
    /// for any other way.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<String>,
}

impl Way {
    /// The keys it accepts ([`way_keys`]).
    fn keys(&self) -> Vec<String> {
        if self.alternatives.is_empty() {
            vec![self.key.clone()]
        } else {
            self.alternatives.clone()
        }
    }
}

/// What promoting a practice in a place would record ([`candidate`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    pub concern: String,
    /// What one unit of the concern is (`entry_point`, ...).
    pub unit: String,
    pub place: Place,
    /// The accepted ways: the variant promoted first, then the ones added with it.
    pub ways: Vec<Way>,
    /// The other known ways units of the place use: each can be added (`--with`),
    /// none is ever added silently. Sorted by members (descending), then id.
    pub other_ways: Vec<Way>,
    /// Units of the place that do it one of the accepted ways.
    pub follows: usize,
    /// Every unit of the place that does it another known way or not at all, sorted by
    /// path, line and symbol: recorded in `drift.lock` when the practice is promoted.
    pub exceptions: Vec<Example>,
    /// Units of the place the map cannot tell: never reported.
    pub unknown: usize,
    /// `follows + exceptions.len() + unknown`.
    pub total: usize,
    /// A unit that follows, to copy from.
    pub example: Option<Example>,
    /// Promoted below [`PLACE_SHARE`] on a person's word: advise only, always.
    pub forced: bool,
    /// Units of the place in Python files: the convention's
    /// [`Evidence::python_members`], so a Python place advises only (decision D7).
    /// In process only, never serialised.
    #[serde(skip)]
    pub python: usize,
    /// Mechanisms accepted whole, sorted ([`Rule::Practice`] `any_mechanism`): a unit
    /// that does the concern by one of them follows, whichever instrument it names
    /// ("a membership check, by any of our permission classes"). Empty for a practice
    /// of named ways.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mechanisms: Vec<String>,
    /// Any way the classifier says enforces the concern follows ([`Rule::Practice`]
    /// `any_enforcing`, [`Concern::enforces`]): "every entry point here signs the
    /// caller in, however". A way that opens a route on purpose is not one: it is
    /// accepted only when a person names it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub any_enforcing: bool,
    /// What it accepts is what code does by doing nothing ([`Concern::passive`]: errors
    /// left to the framework): new code follows it
    /// without trying, so as a rule it holds code to little. Still a candidate; a list
    /// shows it apart.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub passive: bool,
    /// Units of the place not counted because they take no request (background jobs),
    /// for a concern about the caller ([`Concern::needs_a_caller`]).
    #[serde(default, skip_serializing_if = "zero")]
    pub jobs: usize,
    /// The one cause, outside the units themselves, that every unit of the place Drift
    /// could not read shares (an unread app-level call), when they all share one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_cause: Option<UnknownCause>,
    /// Of a route place: the units of `unknown` that are there because Drift did not
    /// read their route as a literal to the end, so whether they are under the prefix
    /// is not known. Never members, never reported.
    #[serde(default, skip_serializing_if = "zero")]
    pub unread_routes: usize,
}

/// What a person asks to promote ([`candidate_for`]): the arguments of `drift
/// practices promote` as one value. At least one of `ways`, `with`, `mechanisms` or
/// `any_enforcing` says what follows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// The concern (`authn`, ...). May be "" when a way is named: the concern is the
    /// way's. Needed when only `mechanisms` or `any_enforcing` are asked for.
    pub concern: String,
    /// Variant ids (`P-…`) accepted as ways; the first is the convention's
    /// [`Convention::promoted_from_practice`].
    pub ways: Vec<String>,
    /// More variant ids of the same concern accepted with them (`--with`).
    pub with: Vec<String>,
    /// Mechanisms accepted whole, in the classifier's vocabulary ([`super::mechanism_of`]:
    /// `dependency`, `membership_guard`, ...).
    pub mechanisms: Vec<String>,
    /// Any way the classifier says enforces the concern.
    pub any_enforcing: bool,
    /// Promote below [`PLACE_SHARE`], advise only.
    pub force: bool,
}

/// Every unit of a place that Drift could not read, unread for one cause that is not
/// in any of them ([`Candidate::unknown_cause`]): one call of the application that was
/// not read makes all its routes unknown. Settling that one cause settles them all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnknownCause {
    pub reason: UnknownReason,
    /// What was not read, as the unknown units name it.
    pub instrument: String,
    /// The units unknown for it.
    pub units: usize,
    /// The `.drift/config.yaml` line that would let Drift read it ([`super::config_hint`]),
    /// when a line can.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

fn zero(n: &usize) -> bool {
    *n == 0
}

/// Why a practice cannot be promoted. `Display` is the sentence a person reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Refusal {
    /// No variant of the map has this id.
    UnknownVariant { id: String },
    /// The id names `none`, the tail of one-off ways, or a way a person only declared
    /// with no unit proven to use it: there is no way to hold new code to.
    NotAWay { id: String, why: String },
    /// A variant added with the first (`--with`) is of another concern.
    OtherConcern { id: String, concern: String },
    /// The place named holds no unit of the concern (or is not a directory of a
    /// package Drift read).
    NoSuchPlace { place: String },
    /// No place was named and the variant qualifies in none; `nearest` is the best
    /// place it has, with why that one does not qualify.
    NoPlace {
        id: String,
        nearest: Option<Box<Refusal>>,
    },
    /// Fewer than [`MIN_ROLE_SIZE`] units of the concern in the place.
    TooSmall {
        place: String,
        units: usize,
        min: usize,
    },
    /// The accepted ways hold less than [`PLACE_SHARE`] of what Drift could read
    /// there. A person may promote all the same (`force`).
    BelowShare {
        place: String,
        follows: usize,
        read: usize,
    },
    /// More than [`MAX_UNKNOWN_SHARE`] of the place is unknown. Never forced. `cause`:
    /// the one cause outside the units that every unknown unit shares, when they do,
    /// with the line that would settle it.
    TooUnknown {
        place: String,
        unknown: usize,
        total: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cause: Option<UnknownCause>,
    },
    /// Nothing was asked to be accepted: no way, no mechanism, not any enforcing way.
    NothingAccepted,
    /// The concern named is not one of the report's.
    UnknownConcern { concern: String },
    /// No unit Drift read does the concern by this mechanism.
    NotAMechanism { concern: String, mechanism: String },
    /// The concern has no notion of a way that enforces it ([`Concern::enforces`]).
    NoEnforcing { concern: String },
}

/// A promoted practice none of whose ways any unit of its place uses any more: the
/// guard was renamed or replaced. It fires on nothing until a person looks at it.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Stale {
    /// The convention's id (`D-…`).
    pub id: String,
    pub summary: String,
    /// The units of the concern in its place now.
    pub units: usize,
}

/// Units of a promoted practice's place the map cannot tell: not checked, said so.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NotChecked {
    /// The convention's id (`D-…`).
    pub id: String,
    pub units: usize,
}

/// What the promoted practices of a policy say of the code ([`check`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Checked {
    /// One per unit that breaks a promoted practice, as every other violation is
    /// reported: `baselined` from the lock, `suppressed` from a `drift-ignore`.
    pub violations: Vec<Violation>,
    /// Lock entries of the promoted practices in scope whose unit now follows or is
    /// gone (`"<id> <path>#<symbol>"`): safe to prune. Empty when `only_paths` is set,
    /// and never for a stale convention or a unit the map cannot tell.
    pub fixed: Vec<String>,
    pub stale: Vec<Stale>,
    pub not_checked: Vec<NotChecked>,
}

/// Of the units most recently added to a place, how many follow a practice as they
/// stand ([`replay`]): what blocking would have met on recent work.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Replay {
    /// Units read: the [`REPLAY_UNITS`] most recently added that the map can tell.
    pub recent: usize,
    pub followed: usize,
    /// The units of the place the map can tell, dated or not: a place with fewer than
    /// [`REPLAY_UNITS`] can never be replayed, and is told so.
    #[serde(default)]
    pub readable: usize,
    /// Of a file place: each unit was dated by the last commit that changed the line
    /// that declares it, not by the commit that first added the file (every unit of
    /// one file would share that date).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub by_line: bool,
}

impl Place {
    /// A place as a person names it (`--in`): a path from the repository root, read
    /// against the packages of `report` (the longest package that holds it wins; the
    /// rest is the directory). `.` or "" is the root package. `None` when the path has
    /// a `..` segment or is absolute.
    ///
    /// A path that is the file of a unit of `report` is that one file. A package, then
    /// [`ROUTE_SEPARATOR`] and a route prefix (`apps/api:/api/workspaces/<slug>`, `.:/x`
    /// for the root package) is the routes of that package under the prefix, each
    /// parameter matching any parameter; `None` when the package is not one of the
    /// report's or the prefix is not a literal of at least one segment.
    pub fn parse(text: &str, report: &PracticesReport) -> Option<Place> {
        let text = text.trim();
        if let Some((package, prefix)) = text.split_once(ROUTE_SEPARATOR) {
            return Self::parse_route(package, prefix, report);
        }
        if text.starts_with('/') || std::path::Path::new(text).is_absolute() {
            return None;
        }
        let path = clean_path(text)?;
        let package = packages(report)
            .into_iter()
            .filter(|p| p.is_empty() || path == *p || path.starts_with(&format!("{p}/")))
            .max_by_key(|p| p.len())
            .unwrap_or("");
        let is_file = report.concerns.iter().any(|c| {
            c.units
                .iter()
                .any(|u| u.path == path && u.package == package)
        });
        if is_file && let Some(p) = Place::file_of(package, &path) {
            return Some(p);
        }
        let dir = path
            .strip_prefix(package)
            .unwrap_or(&path)
            .trim_start_matches('/')
            .to_string();
        Some(Place {
            package: package.to_string(),
            dir,
            ..Place::default()
        })
    }

    /// [`Place::parse`] of `<package>:/<prefix>`.
    fn parse_route(package: &str, prefix: &str, report: &PracticesReport) -> Option<Place> {
        let package = match package.trim() {
            "" | "." => String::new(),
            p => clean_path(p)?,
        };
        if !package.is_empty() && !packages(report).contains(package.as_str()) {
            return None;
        }
        // `viewer.me.`: the procedures under those keys.
        if is_procedure_prefix(prefix.trim()) {
            let route = canonical_route(prefix)?;
            return Some(Place {
                package,
                route: Some(route),
                ..Place::default()
            });
        }
        let text = format!("/{prefix}");
        let (segs, whole) = route_segments(Some(text.as_str()));
        if !whole || segs.is_empty() {
            return None;
        }
        Some(Place::route_in(&package, &segs))
    }

    /// The place of the one file at `path` of `package`; `None` when the file is not
    /// under the package.
    pub fn file_of(package: &str, path: &str) -> Option<Place> {
        let dir = dir_below(package, path)?;
        Some(Place {
            package: package.to_string(),
            dir: dir.to_string(),
            file: Some(path.to_string()),
            route: None,
        })
    }

    /// The place of the routes of `package` under the prefix `segs` (as
    /// [`route_segments`] reads them).
    fn route_in(package: &str, segs: &[String]) -> Place {
        Place {
            package: package.to_string(),
            dir: String::new(),
            file: None,
            route: Some(format!("/{}", segs.join("/"))),
        }
    }

    /// The place of the tRPC procedures of `package` whose path starts with the keys
    /// `segs` (`viewer.me.`).
    fn procedure_in(package: &str, segs: &[String]) -> Place {
        Place {
            package: package.to_string(),
            dir: String::new(),
            file: None,
            route: Some(format!("{}{PROCEDURE_END}", segs.join("."))),
        }
    }

    fn kind(&self) -> Kind {
        if self.route.is_some() {
            Kind::Route
        } else if self.file.is_some() {
            Kind::File
        } else {
            Kind::Dir
        }
    }

    /// The place as a `--in` argument for a shell: [`Place::shown`], in single quotes
    /// when a file or route place has a character a shell reads (`[*]`). A directory
    /// is printed as it always was.
    pub fn command_arg(&self) -> String {
        let s = self.shown();
        let plain = s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'/'));
        if self.kind() == Kind::Dir || plain {
            s
        } else {
            format!("'{}'", s.replace('\'', "'\\''"))
        }
    }

    /// Whether the two places share units for certain, as a promoted practice and a
    /// candidate of the same concern would: of one package, and a directory that holds
    /// the other (directory or file), the same file, one route prefix of the other, or
    /// a route place and its whole package. Otherwise no.
    ///
    /// Also a route place and any directory or file place of its package: a file's path
    /// cannot rule out that it serves a route under the prefix ([`Place::holds`]), so
    /// they may hold the same units (`app/api` and `.:/api` in a Next.js app). Every
    /// refusal and every choice of one proposal over another reads this, so two
    /// practices of one concern never report one unit twice. Containment
    /// ([`Place::contains`]) stays strict for what needs it.
    pub fn overlaps(&self, other: &Place) -> bool {
        self.contains(other)
            || other.contains(self)
            || (self.package == other.package
                && (self.kind() == Kind::Route) != (other.kind() == Kind::Route))
    }

    /// The place as output names it: the path from the repository root (`apps/api/views`),
    /// `.` for the root package; a file's path; `<package>:<prefix>` for a route place
    /// (`.:/api/x` in the root package), as [`Place::parse`] reads it back.
    pub fn shown(&self) -> String {
        if let Some(r) = &self.route {
            let package = if self.package.is_empty() {
                "."
            } else {
                self.package.as_str()
            };
            // A procedure path's prefix has no `/` of its own to follow the package.
            if is_procedure_prefix(r) {
                return format!("{package}{ROUTE_SEPARATOR}{r}");
            }
            return format!("{package}:{r}");
        }
        if let Some(f) = &self.file {
            return f.clone();
        }
        match (self.package.is_empty(), self.dir.is_empty()) {
            (true, true) => ".".to_string(),
            (true, false) => self.dir.clone(),
            (false, true) => self.package.clone(),
            (false, false) => format!("{}/{}", self.package, self.dir),
        }
    }

    /// Whether the file at the repo-relative `path` (of the package `package`) is in
    /// the place.
    ///
    /// A file place holds that file only. A route place holds every file of its
    /// package: a file's path cannot rule out that it registers or mounts a route under
    /// the prefix (a router's paths are relative to where it is mounted).
    pub fn holds(&self, package: &str, path: &str) -> bool {
        if package != self.package {
            return false;
        }
        match self.kind() {
            Kind::Route => true,
            Kind::File => self.file.as_deref() == Some(path),
            Kind::Dir => {
                self.dir.is_empty()
                    || dir_below(package, path).is_some_and(|d| within(d, &self.dir))
            }
        }
    }

    /// How deep the place is below its package: 0 for the whole package; a file one
    /// below its directory; a route place its prefix's segments.
    fn depth(&self) -> usize {
        let dir = if self.dir.is_empty() {
            0
        } else {
            self.dir.split('/').count()
        };
        match (&self.file, &self.route) {
            (_, Some(r)) => prefix_segments(r).len(),
            (Some(_), None) => dir + 1,
            (None, None) => dir,
        }
    }

    /// Whether `other` is this place or inside it: a directory inside a directory, a
    /// file inside a directory, the same file, a longer route prefix inside a shorter
    /// one, a route place inside its whole package.
    fn contains(&self, other: &Place) -> bool {
        if self.package != other.package {
            return false;
        }
        match (self.kind(), other.kind()) {
            (Kind::Dir, Kind::Dir | Kind::File) => {
                self.dir.is_empty() || within(&other.dir, &self.dir)
            }
            (Kind::Dir, Kind::Route) => self.dir.is_empty(),
            (Kind::File, Kind::File) => self.file == other.file,
            (Kind::Route, Kind::Route)
                if is_procedure_prefix(self.route.as_deref().unwrap_or(""))
                    != is_procedure_prefix(other.route.as_deref().unwrap_or("")) =>
            {
                false
            }
            (Kind::Route, Kind::Route) => {
                let (a, b) = (
                    prefix_segments(self.route.as_deref().unwrap_or("")),
                    prefix_segments(other.route.as_deref().unwrap_or("")),
                );
                a.len() <= b.len() && compatible(&a, &b)
            }
            _ => false,
        }
    }

    /// The place in a sentence: its path, or "the root package"; "the routes under
    /// `/api/x` of apps/api" for a route place.
    fn words(&self) -> String {
        if let Some(r) = &self.route {
            let what = if is_procedure_prefix(r) {
                "procedures"
            } else {
                "routes"
            };
            return if self.package.is_empty() {
                format!("the {what} under {}", sanitize(r, 160))
            } else {
                format!(
                    "the {what} under {} of {}",
                    sanitize(r, 160),
                    sanitize(&self.package, 160)
                )
            };
        }
        if self.package.is_empty() && self.dir.is_empty() {
            "the root package".to_string()
        } else {
            sanitize(&self.shown(), 160)
        }
    }
}

/// The directory of the file at `path` below `package` ("" at the package root);
/// `None` when the file is not under the package (a handler re-exported from another
/// package is in its package's place only).
fn dir_below<'p>(package: &str, path: &'p str) -> Option<&'p str> {
    let rel = if package.is_empty() {
        path
    } else {
        path.strip_prefix(package)?.strip_prefix('/')?
    };
    Some(rel.rsplit_once('/').map_or("", |(d, _)| d))
}

/// `dir` is `of` or below it (`app/api2` is not below `app/api`).
fn within(dir: &str, of: &str) -> bool {
    dir == of
        || dir
            .strip_prefix(of)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Every place a unit of the file at `path` (of `package`) is in, broadest first: the
/// package, then each directory from the package root down to the file's own.
fn places_of(package: &str, path: &str) -> Vec<Place> {
    let mut out = vec![Place {
        package: package.to_string(),
        dir: String::new(),
        ..Place::default()
    }];
    let Some(dir) = dir_below(package, path).filter(|d| !d.is_empty()) else {
        return out;
    };
    let mut acc = String::new();
    for seg in dir.split('/') {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(seg);
        out.push(Place {
            package: package.to_string(),
            dir: acc.clone(),
            ..Place::default()
        });
    }
    out
}

/// A repo-relative path as a person writes it, without `.` segments or slashes at
/// either end; `None` with a `..` segment.
fn clean_path(text: &str) -> Option<String> {
    let mut segs: Vec<&str> = Vec::new();
    for s in text.split('/') {
        match s {
            "" | "." => {}
            ".." => return None,
            s => segs.push(s),
        }
    }
    Some(segs.join("/"))
}

/// `k` of `n` as a whole percentage, rounded down: a share just under a bar never
/// reads as the bar.
fn pct(k: usize, n: usize) -> usize {
    (k * 100).checked_div(n).unwrap_or(0)
}

/// A share as a whole percentage (`0.8` is 80).
fn share_pct(share: f64) -> usize {
    (share * 100.0).round() as usize
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::UnknownVariant { id } => write!(
                f,
                "No variant of the practice map has the id {}: `drift practices --json` lists each variant's id (`concerns[].variants[].id`).",
                sanitize(id, 40)
            ),
            Refusal::NotAWay { id, why } => {
                write!(f, "{} cannot be promoted: {why}.", sanitize(id, 40))
            }
            Refusal::OtherConcern { id, concern } => write!(
                f,
                "{} is a way of {}, not of the practice being promoted: `--with` adds a way of the same concern.",
                sanitize(id, 40),
                sanitize(plain_concern(concern), 40)
            ),
            Refusal::NoSuchPlace { place } => write!(
                f,
                "Drift read nothing of this practice in {}: name a package directory, or a directory inside one, where it did (`.` is the root package).",
                sanitize(place, 160)
            ),
            Refusal::NoPlace { id, nearest } => match nearest {
                Some(n) => write!(
                    f,
                    "{} may be promoted in no place as the code stands. The nearest: {n}",
                    sanitize(id, 40)
                ),
                None => write!(
                    f,
                    "{} may be promoted in no place: nothing Drift read does it this way.",
                    sanitize(id, 40)
                ),
            },
            Refusal::TooSmall { place, units, min } => write!(
                f,
                "In {}, Drift could read how this is done {}; a practice is promoted only where it could at least {min} times.",
                sanitize(place, 160),
                if *units == 1 {
                    "once".to_string()
                } else {
                    format!("{units} times")
                }
            ),
            Refusal::BelowShare {
                place,
                follows,
                read,
            } => write!(
                f,
                "In {}, {follows} of the {read} Drift could read do it this way ({}%), below the {}% a practice needs. `--force` promotes it all the same, in advise mode only (it never blocks).",
                sanitize(place, 160),
                pct(*follows, *read),
                share_pct(PLACE_SHARE)
            ),
            Refusal::TooUnknown {
                place,
                unknown,
                total,
                cause,
            } => {
                write!(
                    f,
                    "In {}, Drift cannot tell how {unknown} of the {total} do it ({}%, more than {}%): it cannot hold code to what it cannot read.",
                    sanitize(place, 160),
                    pct(*unknown, *total),
                    share_pct(MAX_UNKNOWN_SHARE)
                )?;
                match cause {
                    Some(c) => write!(f, " {}", cause_sentence(c)),
                    None => write!(
                        f,
                        " `drift practices --hints` prints the .drift/config.yaml lines that would let Drift read them."
                    ),
                }
            }
            Refusal::NothingAccepted => write!(
                f,
                "Nothing to promote: name a way (a variant id), a mechanism, or any way that enforces the concern."
            ),
            Refusal::UnknownConcern { concern } => write!(
                f,
                "The practice map has no concern {}: `drift practices --json` lists them (`concerns[].id`).",
                sanitize(concern, 40)
            ),
            Refusal::NotAMechanism { concern, mechanism } => write!(
                f,
                "No unit of {} Drift read does it by {}: a mechanism is promoted only where code uses it.",
                sanitize(plain_concern(concern), 40),
                sanitize(mechanism, 60)
            ),
            Refusal::NoEnforcing { concern } => write!(
                f,
                "Drift has no reading of which ways enforce {}: name its ways instead.",
                sanitize(plain_concern(concern), 40)
            ),
        }
    }
}

/// A shared cause of the unknown units in a sentence, with what would settle it.
fn cause_sentence(c: &UnknownCause) -> String {
    let what = format!(
        "All {} are unknown for one cause outside them: {} (`{}`).",
        c.units,
        reason_words(c.reason),
        sanitize(&c.instrument, 160)
    );
    match &c.hint {
        Some(h) => format!(
            "{what} This line in .drift/config.yaml would let Drift read it: `{}`.",
            sanitize(h, 240)
        ),
        None => format!(
            "{what} No .drift/config.yaml line names it: once Drift reads that call, they can be told."
        ),
    }
}

/// The reasons a unit is unknown for something outside it: code it runs that was not
/// read. Any other reason is the unit's own (a check found and not proven, a value not
/// followed, dynamic code) and is no shared cause.
const OUTSIDE_REASONS: &[UnknownReason] = &[
    UnknownReason::BodyUnreadable,
    UnknownReason::OpaqueWrapper,
    UnknownReason::Unresolved,
    UnknownReason::PartlyRead,
    UnknownReason::Unparsed,
];

/// Why a unit is unknown, for one of [`OUTSIDE_REASONS`], in a few words.
fn reason_words(reason: UnknownReason) -> &'static str {
    match reason {
        UnknownReason::BodyUnreadable => "a call whose body Drift cannot read",
        UnknownReason::OpaqueWrapper => "a wrapper Drift cannot see into",
        UnknownReason::Unresolved => "a name that does not resolve",
        UnknownReason::PartlyRead => "a method of a value whose type Drift does not know",
        UnknownReason::Unparsed => "a file that was not parsed",
        _ => "code Drift could not read",
    }
}

impl Refusal {
    /// Whether a person's `force` lifts it ([`Refusal::BelowShare`] only).
    pub fn forceable(&self) -> bool {
        matches!(self, Refusal::BelowShare { .. })
    }
}

/// The keys a way accepts: a folded policy's (`any_of(A|B)`) are its alternatives'
/// keys, `A` and `B`, read from the fold itself (a key may hold `|`); any other way's
/// is its own key.
fn way_keys(v: &Variant) -> Vec<String> {
    if v.alternatives.is_empty() {
        vec![v.key.clone()]
    } else {
        v.alternatives.iter().map(|a| a.key.clone()).collect()
    }
}

/// Every key the ways accept.
fn accepted_keys(ways: &[&Variant]) -> BTreeSet<String> {
    ways.iter().flat_map(|v| way_keys(v)).collect()
}

/// Whether the sorted uses `uses` include every use the way `key` names. A key that
/// names no use of its own (the tail, a fold) is included in nothing.
fn includes(uses: &[&str], key: &str) -> bool {
    let need = use_keys(key);
    !need.is_empty() && need.iter().all(|k| uses.binary_search(k).is_ok())
}

/// Of a broader candidate (a mechanism whole, any enforcing way), the share of its
/// place's units it must hold beyond the best narrower candidate around it to be
/// offered as well: the more specific rule is offered first, and the broader one only
/// when it covers materially more of the code.
pub const MATERIAL_SHARE: f64 = 0.1;

/// What the concern's classifier says of ways, for promotion ([`Concern::additive`],
/// [`Concern::enforces`], [`Concern::passive`], [`Concern::needs_a_caller`]). A concern
/// no classifier is registered for reads strictly: whole keys, no notion of enforcing,
/// nothing passive, every unit counted.
struct Traits {
    classifier: Option<Box<dyn Concern>>,
}

impl Traits {
    fn of(concern: &str) -> Self {
        Traits {
            classifier: super::registry().into_iter().find(|c| c.id() == concern),
        }
    }

    fn additive(&self) -> bool {
        self.classifier.as_ref().is_some_and(|c| c.additive())
    }

    fn needs_a_caller(&self) -> bool {
        self.classifier.as_ref().is_some_and(|c| c.needs_a_caller())
    }

    /// Whether the uses (one key each) enforce the concern; `None` where the concern
    /// has no such notion.
    fn enforces(&self, uses: &[&str]) -> Option<bool> {
        let c = self.classifier.as_ref()?;
        let uses: Vec<Use> = uses.iter().map(|k| use_from_key(k)).collect();
        c.enforces(&uses)
    }

    /// Whether the concern has a notion of a way that enforces it.
    fn has_enforcing(&self) -> bool {
        self.enforces(&[]).is_some()
    }

    /// Whether a use of the mechanism `m` may enforce the concern: a mechanism that
    /// cannot (one that opens a route, one that only identifies the caller) is never
    /// offered whole. It is accepted only when a person names it.
    fn mechanism_enforces(&self, m: &str) -> bool {
        let key = format!("{m}:");
        self.enforces(&[key.as_str()]).unwrap_or(true)
    }

    fn passive(&self, uses: &[&str]) -> bool {
        let Some(c) = self.classifier.as_ref() else {
            return false;
        };
        let uses: Vec<Use> = uses.iter().map(|k| use_from_key(k)).collect();
        c.passive(&uses)
    }
}

/// What a promoted practice accepts, its three forms together ([`Rule::Practice`]):
/// named ways (by key), mechanisms whole, and any way that enforces the concern.
#[derive(Debug, Clone, Default)]
struct Accepts {
    keys: BTreeSet<String>,
    mechanisms: BTreeSet<String>,
    enforcing: bool,
}

impl Accepts {
    fn of_ways(ways: &[&Variant]) -> Self {
        Accepts {
            keys: accepted_keys(ways),
            ..Accepts::default()
        }
    }

    fn of_rule(any_of: &[String], any_mechanism: &[String], any_enforcing: bool) -> Self {
        Accepts {
            keys: any_of.iter().cloned().collect(),
            mechanisms: any_mechanism.iter().cloned().collect(),
            enforcing: any_enforcing,
        }
    }

    /// A stored rule read against the map's `variants`: a key that is a folded
    /// policy's own (`any_of(a|b|c)`, as practices promoted before a fold's
    /// alternatives were stored kept it) accepts its alternatives' keys too, which are
    /// what the fold's units carry.
    fn with_folds(mut self, variants: &[Variant]) -> Self {
        let more: Vec<String> = variants
            .iter()
            .filter(|v| !v.alternatives.is_empty() && self.keys.contains(&v.key))
            .flat_map(|v| v.alternatives.iter().map(|a| a.key.clone()))
            .collect();
        self.keys.extend(more);
        self
    }
}

/// What is being promoted: the variants accepted as ways, the mechanisms accepted
/// whole, and whether any way that enforces the concern is.
#[derive(Debug, Clone, Default)]
struct Asked<'a> {
    ways: Vec<&'a Variant>,
    mechanisms: Vec<String>,
    enforcing: bool,
}

impl Asked<'_> {
    fn accepts(&self) -> Accepts {
        Accepts {
            mechanisms: self.mechanisms.iter().cloned().collect(),
            enforcing: self.enforcing,
            ..Accepts::of_ways(&self.ways)
        }
    }

    /// What it is called where no place takes it ([`Refusal::NoPlace`]): its first
    /// way's id, else what it accepts.
    fn name(&self) -> String {
        if let Some(v) = self.ways.first() {
            v.id.clone()
        } else if !self.mechanisms.is_empty() {
            format!("mechanism {}", self.mechanisms.join(", "))
        } else {
            "any enforcing way".to_string()
        }
    }
}

/// How broad a candidate is: named ways (0), a mechanism whole (1), any way that
/// enforces the concern (2). The more specific is listed first.
fn breadth(c: &Candidate) -> u8 {
    if c.any_enforcing {
        2
    } else if !c.mechanisms.is_empty() {
        1
    } else {
        0
    }
}

/// How one unit stands against the accepted ways. Ordered so that the worst of a
/// unit's mounts decides: one mount that breaks makes the unit break.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Verdict {
    Follows,
    /// The map cannot tell (or knows no way of its own for it): never reported.
    Unknown,
    /// Another known way, `identified`, or `none`.
    Breaks,
}

/// One unit of a concern in a place, its mounts together.
#[derive(Debug, Clone, Copy)]
struct Judged<'a> {
    path: &'a str,
    symbol: &'a str,
    line: u32,
    verdict: Verdict,
    /// The key of its own way (of the mount that decided), when the map knows one.
    own: Option<&'a str>,
    /// The row of the mount that decided.
    row: usize,
    /// The mount that decided is in a route place only as a route Drift did not read
    /// to the end ([`Reading::unread`]).
    unread: bool,
}

impl Judged<'_> {
    fn example(&self) -> Example {
        Example {
            path: self.path.to_string(),
            symbol: self.symbol.to_string(),
            line: self.line,
        }
    }

    /// `path#symbol`, as `drift.lock` keys a unit.
    fn key(&self) -> String {
        format!("{}#{}", self.path, self.symbol)
    }
}

/// One concern of a report read for promotion: each row's own way and uses, and each
/// place's rows.
struct Reading<'a> {
    c: &'a ConcernReport,
    traits: Traits,
    /// [`Concern::additive`] of the concern.
    additive: bool,
    /// Each row's own way's key; `None` for a row the map gives no known way.
    own: Vec<Option<&'a str>>,
    /// Each known row's uses, one key per use, sorted: [`UnitRow::uses`], else read
    /// from its own way's key. Empty for a row that is not known.
    uses: Vec<Vec<&'a str>>,
    /// Each known row: whether its uses enforce the concern ([`UnitRow::enforces`],
    /// else the classifier asked).
    enforces: Vec<bool>,
    /// Whether the row is counted at all: not a background job of a concern about the
    /// caller ([`Concern::needs_a_caller`]).
    counted: Vec<bool>,
    /// The counted rows of each place a row is in: its package and directories, its
    /// file, and (of a concern of entry points) every prefix of a route Drift read to
    /// the end as a literal. The one reading of membership that `candidate_for`,
    /// `candidates`, `check`, `baseline` and `replay` all go through.
    places: BTreeMap<Place, Vec<usize>>,
    /// Of each route place, the counted rows whose route Drift did not read to the
    /// end and could be under its prefix: never members, each counted as not read.
    unread: BTreeMap<Place, Vec<usize>>,
    /// The units of each place left out as background jobs (path, symbol).
    jobs: BTreeMap<Place, BTreeSet<(&'a str, &'a str)>>,
}

impl<'a> Reading<'a> {
    fn new(c: &'a ConcernReport) -> Self {
        let traits = Traits::of(&c.id);
        let keys: BTreeMap<&'a str, &'a str> = c
            .variants
            .iter()
            .map(|v| (v.id.as_str(), v.key.as_str()))
            .collect();
        // A unit's own uses, where its variant stands for several ways; the variant's
        // key otherwise.
        let own: Vec<Option<&'a str>> = c
            .units
            .iter()
            .map(|u| {
                if u.assignment != "known" {
                    return None;
                }
                u.key
                    .as_deref()
                    .or_else(|| keys.get(u.variant.as_str()).copied())
            })
            .collect();
        let uses: Vec<Vec<&'a str>> = c
            .units
            .iter()
            .zip(&own)
            .map(|(u, own)| {
                if u.assignment != "known" {
                    return Vec::new();
                }
                let mut v: Vec<&'a str> = if u.uses.is_empty() {
                    (*own).map(use_keys).unwrap_or_default()
                } else {
                    u.uses.iter().map(String::as_str).collect()
                };
                v.sort_unstable();
                v.dedup();
                v
            })
            .collect();
        let enforces: Vec<bool> = c
            .units
            .iter()
            .zip(&uses)
            .map(|(u, uses)| {
                u.assignment == "known"
                    && u.enforces
                        .unwrap_or_else(|| traits.enforces(uses).unwrap_or(false))
            })
            .collect();
        let caller = traits.needs_a_caller();
        let counted: Vec<bool> = c
            .units
            .iter()
            .map(|u| !(caller && u.kind.as_deref() == Some(JOB)))
            .collect();
        let mut places: BTreeMap<Place, Vec<usize>> = BTreeMap::new();
        let mut jobs: BTreeMap<Place, BTreeSet<(&'a str, &'a str)>> = BTreeMap::new();
        // Rows whose route was not read to the end, with what was read of it.
        let mut pending: Vec<(usize, Vec<String>, bool)> = Vec::new();
        let entries = c.unit == "entry_point";
        let routed = routed_kinds(c);
        for (i, u) in c.units.iter().enumerate() {
            let mut of = places_of(&u.package, &u.path);
            of.extend(Place::file_of(&u.package, &u.path));
            // A background job is served at no route, and neither is an entry point of a
            // kind Drift read no route for (a server action, a resolver, a procedure):
            // it is in no route place, neither a member nor unread there.
            // A tRPC procedure is in the places of its dotted path's keys.
            let procedure = u.kind.as_deref() == Some(RPC)
                && u.route
                    .as_deref()
                    .is_some_and(|r| !r.trim_start().starts_with('/'));
            if entries
                && counted[i]
                && u.kind.as_deref() != Some(JOB)
                && (procedure || u.kind.as_deref().is_none_or(|k| routed.contains(k)))
            {
                let (segs, whole, procedure) = unit_segments(u.kind.as_deref(), u.route.as_deref());
                let place = if procedure {
                    Place::procedure_in
                } else {
                    Place::route_in
                };
                if whole {
                    of.extend((1..=segs.len()).map(|k| place(&u.package, &segs[..k])));
                } else {
                    pending.push((i, segs, procedure));
                }
            }
            for p in of {
                if counted[i] {
                    places.entry(p).or_default().push(i);
                } else {
                    jobs.entry(p)
                        .or_default()
                        .insert((u.path.as_str(), u.symbol.as_str()));
                }
            }
        }
        let mut unread: BTreeMap<Place, Vec<usize>> = BTreeMap::new();
        if !pending.is_empty() {
            let routes: Vec<(&Place, Vec<&str>)> = places
                .keys()
                .filter_map(|p| p.route.as_deref().map(|r| (p, prefix_segments(r))))
                .collect();
            for (i, read, procedure) in &pending {
                let package = c.units[*i].package.as_str();
                for (p, segs) in &routes {
                    let same = is_procedure_prefix(p.route.as_deref().unwrap_or("")) == *procedure;
                    if p.package == package && same && compatible(read, segs) {
                        unread.entry((*p).clone()).or_default().push(*i);
                    }
                }
            }
        }
        let additive = traits.additive();
        Reading {
            c,
            traits,
            additive,
            own,
            uses,
            enforces,
            counted,
            places,
            unread,
            jobs,
        }
    }

    /// The variant `id` names: a top-level one, else an alternative of a fold.
    fn variant(&self, id: &str) -> Option<&'a Variant> {
        let c = self.c;
        c.variants.iter().find(|v| v.id == id).or_else(|| {
            c.variants
                .iter()
                .flat_map(|v| v.alternatives.iter())
                .find(|a| a.id == id)
        })
    }

    /// The variant whose key is `key`: a top-level one, else an alternative of a fold.
    fn by_key(&self, key: &str) -> Option<&'a Variant> {
        let c = self.c;
        c.variants.iter().find(|v| v.key == key).or_else(|| {
            c.variants
                .iter()
                .flat_map(|v| v.alternatives.iter())
                .find(|a| a.key == key)
        })
    }

    /// Whether row `i`, of a known way, does it a way `acc` accepts:
    /// - its own way's key is an accepted one;
    /// - for a concern whose uses add up ([`Concern::additive`]), its uses include
    ///   every use of an accepted way: doing more is still doing it. Elsewhere the
    ///   extra use is the departure, and only the whole key follows;
    /// - one of its uses is of an accepted mechanism (every one of them, where the
    ///   uses do not add up);
    /// - any enforcing way is accepted and its uses enforce the concern.
    fn follows(&self, i: usize, acc: &Accepts) -> bool {
        let Some(own) = self.own[i] else {
            return false;
        };
        if acc.keys.contains(own) {
            return true;
        }
        let uses = &self.uses[i];
        if uses.is_empty() {
            return false;
        }
        if self.additive && acc.keys.iter().any(|k| includes(uses, k)) {
            return true;
        }
        if !acc.mechanisms.is_empty() {
            let of = |u: &str| acc.mechanisms.contains(mechanism_of(u));
            let by_mechanism = if self.additive {
                uses.iter().any(|u| of(u))
            } else {
                uses.iter().all(|u| of(u))
            };
            if by_mechanism {
                return true;
            }
        }
        acc.enforcing && self.enforces[i]
    }

    /// Whether row `i` is counted and known to do it a way `acc` accepts.
    fn known_follows(&self, i: usize, acc: &Accepts) -> bool {
        self.counted[i] && self.c.units[i].assignment == "known" && self.follows(i, acc)
    }

    /// Each row's verdict against `acc`.
    fn verdicts(&self, acc: &Accepts) -> Vec<Verdict> {
        (0..self.c.units.len())
            .map(
                |i| match (self.c.units[i].assignment.as_str(), self.own[i]) {
                    ("unknown", _) => Verdict::Unknown,
                    ("known", None) => Verdict::Unknown,
                    ("known", Some(_)) if self.follows(i, acc) => Verdict::Follows,
                    _ => Verdict::Breaks,
                },
            )
            .collect()
    }

    /// The units of `place` with their verdicts, each unit once (its mounts together),
    /// sorted by path, line and symbol. A background job of a concern about the caller
    /// is none of them.
    fn judged(&self, place: &Place, verdicts: &[Verdict]) -> Vec<Judged<'a>> {
        let c = self.c;
        let rows = self.places.get(place).map_or(&[][..], Vec::as_slice);
        let unread = self.unread.get(place).map_or(&[][..], Vec::as_slice);
        let mut by: BTreeMap<(&'a str, &'a str), Judged<'a>> = BTreeMap::new();
        // A row of a route not read to the end is no member: it is not read, whatever
        // the map says of the unit.
        let all = rows
            .iter()
            .map(|&i| (i, verdicts[i], self.own[i], false))
            .chain(unread.iter().map(|&i| (i, Verdict::Unknown, None, true)));
        for (i, verdict, own, not_read) in all {
            let u: &'a UnitRow = &c.units[i];
            let j = by
                .entry((u.path.as_str(), u.symbol.as_str()))
                .or_insert(Judged {
                    path: &u.path,
                    symbol: &u.symbol,
                    line: u.line,
                    verdict,
                    own,
                    row: i,
                    unread: not_read,
                });
            j.line = j.line.min(u.line);
            if verdict > j.verdict {
                j.verdict = verdict;
                j.own = own;
                j.row = i;
                j.unread = not_read;
            }
        }
        let mut out: Vec<Judged<'a>> = by.into_values().collect();
        out.sort_by(|a, b| (a.path, a.line, a.symbol).cmp(&(b.path, b.line, b.symbol)));
        out
    }

    /// The mechanisms the counted known rows use, sorted.
    fn mechanisms(&self) -> BTreeSet<&'a str> {
        (0..self.c.units.len())
            .filter(|&i| self.counted[i])
            .flat_map(|i| self.uses[i].iter().map(|k| mechanism_of(k)))
            .collect()
    }

    /// The one cause that every unknown unit of `judged` shares, when it is outside
    /// them ([`UnknownCause`]): the same reason, one of [`OUTSIDE_REASONS`], and the
    /// same instrument, which no unit's own file holds, for at least two units. A unit
    /// unknown for another reason, or for something in its own file, is its own.
    fn unknown_cause(&self, judged: &[Judged<'_>]) -> Option<UnknownCause> {
        let mut cause: Option<(UnknownReason, &str)> = None;
        let mut units = 0;
        for j in judged.iter().filter(|j| j.verdict == Verdict::Unknown) {
            let u = &self.c.units[j.row];
            let reason = u.reason.filter(|r| OUTSIDE_REASONS.contains(r))?;
            if u.instrument.is_empty() || u.instrument.contains(u.path.as_str()) {
                return None;
            }
            let this = (reason, u.instrument.as_str());
            if cause.is_some_and(|c| c != this) {
                return None;
            }
            cause = Some(this);
            units += 1;
        }
        let (reason, instrument) = cause?;
        if units < 2 {
            return None;
        }
        Some(UnknownCause {
            reason,
            instrument: instrument.to_string(),
            units,
            hint: super::config_hint(&self.c.id, instrument),
        })
    }
}

/// Whether `v` is a way new code can be held to: a known way of its own (not `none`,
/// not `identified`, not the tail of one-off ways) that some unit is known to use. A
/// way a person declared in `.drift/config.yaml` and units use is one like any other.
/// `Err` says why not.
fn is_way(r: &Reading<'_>, v: &Variant) -> Result<(), String> {
    match v.kind {
        VariantKind::None => {
            return Err(
                "it is a recorded absence (nothing found in what Drift read), not a way to hold new code to"
                    .to_string(),
            );
        }
        VariantKind::Identified => {
            return Err(
                "it identifies the caller and turns no one away, which is not a way to hold new code to"
                    .to_string(),
            );
        }
        VariantKind::Known => {}
    }
    if v.key == TAIL {
        return Err("it stands for the ways one unit each uses, not for one way".to_string());
    }
    let acc = Accepts::of_ways(&[v]);
    if !(0..r.c.units.len()).any(|i| r.known_follows(i, &acc)) {
        return Err(
            "no unit Drift read is known to do it this way (a way declared in .drift/config.yaml is one once a unit uses it)"
                .to_string(),
        );
    }
    Ok(())
}

/// Whether what `acc` accepts may qualify anywhere: enough units follow it that some
/// place could hold [`PLACE_SHARE`] of [`MIN_ROLE_SIZE`] of them. Saves reading every
/// place of a variant of two units.
fn may_qualify(r: &Reading<'_>, acc: &Accepts) -> bool {
    let rows = (0..r.c.units.len())
        .filter(|&i| r.known_follows(i, acc))
        .count();
    rows as f64 >= PLACE_SHARE * MIN_ROLE_SIZE as f64
}

/// [`may_qualify`] of the variant `v` as the one accepted way, when it is a way.
fn may_qualify_way(r: &Reading<'_>, v: &Variant) -> bool {
    is_way(r, v).is_ok() && may_qualify(r, &Accepts::of_ways(&[v]))
}

/// Whether a place with these counts may be promoted in: `Ok(true)` when only `force`
/// lets it (below the share). `cause`: the one cause outside the units that the
/// unknown ones share, said with a refusal for too many unknowns.
fn eligible(
    place: &Place,
    follows: usize,
    breaks: usize,
    unknown: usize,
    cause: Option<UnknownCause>,
    force: bool,
) -> Result<bool, Refusal> {
    let total = follows + breaks + unknown;
    let shown = place.shown();
    if total == 0 {
        return Err(Refusal::NoSuchPlace { place: shown });
    }
    if unknown as f64 > MAX_UNKNOWN_SHARE * total as f64 {
        return Err(Refusal::TooUnknown {
            place: shown,
            unknown,
            total,
            cause,
        });
    }
    let read = follows + breaks;
    if read < MIN_ROLE_SIZE {
        return Err(Refusal::TooSmall {
            place: shown,
            units: read,
            min: MIN_ROLE_SIZE,
        });
    }
    // The comparison `effective_mode` makes, so a practice promoted at the share is
    // never read as below it.
    let below = (follows as f64) < PLACE_SHARE * read as f64;
    if below && !force {
        return Err(Refusal::BelowShare {
            place: shown,
            follows,
            read,
        });
    }
    Ok(below)
}

/// Whether what `asked` accepts is what code does by doing nothing
/// ([`Concern::passive`]): every way and mechanism it names is, and it names one. Any
/// enforcing way never is.
fn passive(r: &Reading<'_>, asked: &Asked<'_>) -> bool {
    if asked.enforcing {
        return false;
    }
    let mut parts = 0;
    for v in &asked.ways {
        for k in way_keys(v) {
            let uses = use_keys(&k);
            if uses.is_empty() || !r.traits.passive(&uses) {
                return false;
            }
            parts += 1;
        }
    }
    for m in &asked.mechanisms {
        let k = format!("{m}:");
        if !r.traits.passive(&[k.as_str()]) {
            return false;
        }
        parts += 1;
    }
    parts > 0
}

/// The candidate of `asked` in `place`, from its units' verdicts (`judged`).
fn build_from<'a>(
    r: &Reading<'a>,
    asked: &Asked<'_>,
    place: &Place,
    judged: &[Judged<'a>],
    force: bool,
) -> Result<Candidate, Refusal> {
    let count = |v: Verdict| judged.iter().filter(|j| j.verdict == v).count();
    let (follows, breaks, unknown) = (
        count(Verdict::Follows),
        count(Verdict::Breaks),
        count(Verdict::Unknown),
    );
    let cause = if unknown > 0 {
        r.unknown_cause(judged)
    } else {
        None
    };
    let forced = eligible(place, follows, breaks, unknown, cause.clone(), force)?;
    let way_of = |v: &Variant| -> Way {
        let acc = Accepts::of_ways(&[v]);
        Way {
            id: v.id.clone(),
            key: v.key.clone(),
            label: v.label.clone(),
            members: judged
                .iter()
                .filter(|j| j.verdict == Verdict::Follows && r.follows(j.row, &acc))
                .count(),
            alternatives: v.alternatives.iter().map(|a| a.key.clone()).collect(),
        }
    };
    // The ways the units that break it use, by the variant of their own way.
    let taken: BTreeSet<&str> = asked.ways.iter().map(|v| v.id.as_str()).collect();
    let mut others: BTreeMap<String, Way> = BTreeMap::new();
    for j in judged.iter().filter(|j| j.verdict == Verdict::Breaks) {
        let Some(v) = j.own.and_then(|k| r.by_key(k)) else {
            continue;
        };
        if v.kind != VariantKind::Known || v.key == TAIL || taken.contains(v.id.as_str()) {
            continue;
        }
        others
            .entry(v.id.clone())
            .or_insert_with(|| Way {
                id: v.id.clone(),
                key: v.key.clone(),
                label: v.label.clone(),
                members: 0,
                alternatives: v.alternatives.iter().map(|a| a.key.clone()).collect(),
            })
            .members += 1;
    }
    let mut other_ways: Vec<Way> = others.into_values().collect();
    other_ways.sort_by(|a, b| b.members.cmp(&a.members).then(a.id.cmp(&b.id)));
    let mut mechanisms = asked.mechanisms.clone();
    mechanisms.sort();
    mechanisms.dedup();
    Ok(Candidate {
        concern: r.c.id.clone(),
        unit: r.c.unit.clone(),
        place: place.clone(),
        ways: asked.ways.iter().map(|&v| way_of(v)).collect(),
        other_ways,
        follows,
        exceptions: judged
            .iter()
            .filter(|j| j.verdict == Verdict::Breaks)
            .map(Judged::example)
            .collect(),
        unknown,
        total: follows + breaks + unknown,
        example: judged
            .iter()
            .find(|j| j.verdict == Verdict::Follows)
            .map(Judged::example),
        forced,
        python: judged
            .iter()
            .filter(|j| crate::tier::language_of(j.path) == Lang::Python)
            .count(),
        mechanisms,
        any_enforcing: asked.enforcing,
        passive: passive(r, asked),
        jobs: r.jobs.get(place).map_or(0, BTreeSet::len),
        unknown_cause: cause,
        unread_routes: judged.iter().filter(|j| j.unread).count(),
    })
}

/// The places `asked` may be promoted in, broadest first (a whole package before a
/// directory, then more units that follow, then by place), and, when there is none,
/// why the nearest does not qualify (the place where most units follow, broadest
/// first). Only places where some unit follows are read.
fn qualifying(
    r: &Reading<'_>,
    asked: &Asked<'_>,
    force: bool,
) -> (Vec<Candidate>, Option<Refusal>) {
    qualifying_in(r, asked, force, Kind::Dir)
}

/// [`qualifying`] among the places of one kind.
fn qualifying_in(
    r: &Reading<'_>,
    asked: &Asked<'_>,
    force: bool,
    kind: Kind,
) -> (Vec<Candidate>, Option<Refusal>) {
    let verdicts = r.verdicts(&asked.accepts());
    let places: Vec<&Place> = r
        .places
        .iter()
        .filter(|(p, _)| p.kind() == kind)
        .filter(|(_, rows)| rows.iter().any(|&i| verdicts[i] == Verdict::Follows))
        .map(|(p, _)| p)
        .collect();
    let mut ok: Vec<Candidate> = Vec::new();
    let mut nearest: Option<(usize, usize, Refusal)> = None;
    for place in places {
        let judged = r.judged(place, &verdicts);
        let follows = judged
            .iter()
            .filter(|j| j.verdict == Verdict::Follows)
            .count();
        match build_from(r, asked, place, &judged, force) {
            Ok(c) => ok.push(c),
            Err(e) => {
                let depth = place.depth();
                if nearest
                    .as_ref()
                    .is_none_or(|(f, d, _)| follows > *f || (follows == *f && depth < *d))
                {
                    nearest = Some((follows, depth, e));
                }
            }
        }
    }
    ok.sort_by(|a, b| {
        (a.place.depth(), Reverse(a.follows), &a.place).cmp(&(
            b.place.depth(),
            Reverse(b.follows),
            &b.place,
        ))
    });
    (ok, nearest.map(|(_, _, e)| e))
}

/// Of the qualifying places of one candidate, those around which no other qualifies:
/// a directory only where no place around it qualifies.
fn broadest(ok: Vec<Candidate>) -> Vec<Candidate> {
    let places: Vec<Place> = ok.iter().map(|c| c.place.clone()).collect();
    ok.into_iter()
        .filter(|c| !places.iter().any(|p| *p != c.place && p.contains(&c.place)))
        .collect()
}

/// Whether a broader candidate `b` is offered beside the narrower ones already offered
/// of its concern: where none of them holds in a place that holds or is held by its
/// own, or where it covers materially more units than the best of them
/// ([`MATERIAL_SHARE`] of its place's units).
fn broader_offered(b: &Candidate, narrower: &[Candidate]) -> bool {
    let best = narrower
        .iter()
        .filter(|n| {
            n.concern == b.concern && (b.place.contains(&n.place) || n.place.contains(&b.place))
        })
        .map(|n| n.follows)
        .max();
    let material = ((MATERIAL_SHARE * b.total as f64).ceil() as usize).max(1);
    best.is_none_or(|f| b.follows >= f + material)
}

/// The qualifying places of `kind` that `asked` is offered in:
/// - directories: the broadest ([`broadest`]);
/// - one file: only where no directory around it qualifies for the same thing (the
///   file's rule would restate its directory's);
/// - a route prefix: of each chain of prefixes, the longest that holds the same units
///   as the shortest that qualifies ([`longest`]), and only where no directory that
///   holds all of its units qualifies for the same thing.
fn pick(r: &Reading<'_>, asked: &Asked<'_>, kind: Kind) -> Vec<Candidate> {
    let ok = qualifying_in(r, asked, false, kind).0;
    if kind == Kind::Dir || ok.is_empty() {
        return broadest(ok);
    }
    let dirs = qualifying_in(r, asked, false, Kind::Dir).0;
    match kind {
        Kind::File => ok
            .into_iter()
            .filter(|c| !dirs.iter().any(|d| d.place.contains(&c.place)))
            .collect(),
        _ => {
            let verdicts = r.verdicts(&asked.accepts());
            longest(ok)
                .into_iter()
                .filter(|c| {
                    let judged = r.judged(&c.place, &verdicts);
                    !dirs.iter().any(|d| {
                        judged
                            .iter()
                            .all(|j| d.place.holds(&r.c.units[j.row].package, j.path))
                    })
                })
                .collect()
        }
    }
}

/// Of the qualifying route places of one candidate, one per chain: a prefix around
/// which every qualifying prefix holds the same units, and inside which none does
/// (so `/a/[*]/b` is offered when every route under `/a` is under it, and one rule is
/// not offered at five depths). A prefix inside a qualifying one that holds more is
/// a part of that rule, not one of its own. The units of a prefix are those of every
/// prefix around it or fewer, so the same count is the same units.
fn longest(ok: Vec<Candidate>) -> Vec<Candidate> {
    let places: Vec<(Place, usize)> = ok.iter().map(|c| (c.place.clone(), c.total)).collect();
    ok.into_iter()
        .filter(|c| {
            let around_same = places
                .iter()
                .filter(|(p, _)| *p != c.place && p.contains(&c.place))
                .all(|(_, t)| *t == c.total);
            let inside_same = places
                .iter()
                .any(|(p, t)| *p != c.place && c.place.contains(p) && *t == c.total);
            around_same && !inside_same
        })
        .collect()
}

/// The candidates of one concern ([`candidates`]): each way in its broadest qualifying
/// places; then each mechanism whole that may enforce the concern; then any enforcing
/// way. A broader candidate is offered only where it covers materially more than the
/// narrower ones ([`broader_offered`]).
///
/// Directories first. Then, for a concern of entry points, one file and a route
/// prefix ([`pick`]): each only where it adds something over the directories.
/// A file of symbols is its directory's business: a file place is offered for entry
/// points only (it may still be asked for with `--in`).
fn concern_candidates(c: &ConcernReport) -> Vec<Candidate> {
    let r = Reading::new(c);
    let mut out = offered(&r, Kind::Dir);
    if c.unit == "entry_point" {
        out.extend(offered(&r, Kind::File));
        out.extend(offered(&r, Kind::Route));
    }
    out
}

/// The candidates of places of one kind, as [`pick`] keeps them.
fn offered(r: &Reading<'_>, kind: Kind) -> Vec<Candidate> {
    let c = r.c;
    let mut out: Vec<Candidate> = Vec::new();
    for v in c.variants.iter().filter(|v| may_qualify_way(r, v)) {
        let asked = Asked {
            ways: vec![v],
            ..Asked::default()
        };
        out.extend(pick(r, &asked, kind));
    }
    let mut by_mechanism: Vec<Candidate> = Vec::new();
    for m in r.mechanisms() {
        if !r.traits.mechanism_enforces(m) {
            continue;
        }
        let asked = Asked {
            mechanisms: vec![m.to_string()],
            ..Asked::default()
        };
        if !may_qualify(r, &asked.accepts()) {
            continue;
        }
        by_mechanism.extend(
            pick(r, &asked, kind)
                .into_iter()
                .filter(|b| broader_offered(b, &out)),
        );
    }
    out.extend(by_mechanism);
    if r.traits.has_enforcing() {
        let asked = Asked {
            enforcing: true,
            ..Asked::default()
        };
        if may_qualify(r, &asked.accepts()) {
            let enforcing: Vec<Candidate> = pick(r, &asked, kind)
                .into_iter()
                .filter(|b| broader_offered(b, &out))
                .collect();
            out.extend(enforcing);
        }
    }
    out
}

/// Fills each variant's [`Variant::promotable`] of a concern whose report lists every
/// unit (the engine, before it drops the rows a report does not list): set exactly for
/// the variants [`candidates`] lists as named ways, with the broadest place
/// [`candidate`] picks without `--in`. An alternative of a fold is promoted with its
/// fold (or by its own id): it carries none. A mechanism or any enforcing way is no
/// variant's: [`candidates`] lists it.
pub(super) fn fill_promotable(c: &mut ConcernReport) {
    let places: BTreeMap<String, String> = {
        let r = Reading::new(c);
        c.variants
            .iter()
            .filter(|v| may_qualify_way(&r, v))
            .filter_map(|v| {
                let asked = Asked {
                    ways: vec![v],
                    ..Asked::default()
                };
                qualifying(&r, &asked, false)
                    .0
                    .into_iter()
                    .next()
                    .map(|cand| (v.id.clone(), cand.place.shown()))
            })
            .collect()
    };
    for v in &mut c.variants {
        v.promotable = places.get(&v.id).map(|place| Promotable {
            rule: "practice".to_string(),
            role: String::new(),
            place: Some(place.clone()),
        });
        for a in &mut v.alternatives {
            a.promotable = None;
        }
    }
}

/// Every practice that may be promoted as the code stands, without `force`: for each
/// known variant, its broadest qualifying place (a directory is listed only where its
/// package does not qualify); for each mechanism and for any enforcing way, the same,
/// where they cover materially more than the ways do. Sorted by concern (in
/// [`super::CONCERNS`] order), place, breadth (ways, mechanism, any enforcing way),
/// first way id and mechanisms. A passive one ([`Candidate::passive`]) is listed like
/// any other: a list shows it apart. `report` must list its units
/// ([`super::Options::units`]).
pub fn candidates(report: &PracticesReport) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = report
        .concerns
        .iter()
        .flat_map(concern_candidates)
        .collect();
    let rank = |c: &Candidate| {
        CONCERNS
            .iter()
            .position(|(id, _)| *id == c.concern)
            .unwrap_or(CONCERNS.len())
    };
    let first = |c: &Candidate| c.ways.first().map_or(String::new(), |w| w.id.clone());
    out.sort_by(|a, b| {
        (rank(a), &a.place, breadth(a), first(a), &a.mechanisms).cmp(&(
            rank(b),
            &b.place,
            breadth(b),
            first(b),
            &b.mechanisms,
        ))
    });
    out
}

/// The concern and variant `id` names: a top-level variant, else an alternative.
fn find<'r>(report: &'r PracticesReport, id: &str) -> Option<(&'r ConcernReport, &'r Variant)> {
    report.concerns.iter().find_map(|c| {
        c.variants
            .iter()
            .find(|v| v.id == id)
            .or_else(|| {
                c.variants
                    .iter()
                    .flat_map(|v| v.alternatives.iter())
                    .find(|a| a.id == id)
            })
            .map(|v| (c, v))
    })
}

/// What promoting the variant `id` would record. `place`: where (`None`: its broadest
/// qualifying place). `with`: other variants of the same concern accepted as ways with
/// it. `force`: promote below [`PLACE_SHARE`]. `report` must list its units.
/// [`candidate_for`] with `id` as the one way.
pub fn candidate(
    report: &PracticesReport,
    id: &str,
    place: Option<&Place>,
    with: &[String],
    force: bool,
) -> Result<Candidate, Refusal> {
    candidate_for(
        report,
        place,
        &Request {
            ways: vec![id.to_string()],
            with: with.to_vec(),
            force,
            ..Request::default()
        },
    )
}

/// What promoting `req` would record: its ways (`ways`, then `with`, all of one
/// concern), the mechanisms it accepts whole, and whether any way that enforces the
/// concern follows. `place`: where (`None`: the broadest place it qualifies in).
/// `report` must list its units. A way is refused as [`candidate`] refuses it; a
/// mechanism no unit uses, or any enforcing way of a concern with no such notion, is
/// refused too; a request that accepts nothing is [`Refusal::NothingAccepted`].
pub fn candidate_for(
    report: &PracticesReport,
    place: Option<&Place>,
    req: &Request,
) -> Result<Candidate, Refusal> {
    let named: Vec<&String> = req.ways.iter().chain(req.with.iter()).collect();
    let c: &ConcernReport = match named.first() {
        Some(id) => match find(report, id) {
            Some((c, _)) => c,
            None => {
                return Err(Refusal::UnknownVariant { id: (*id).clone() });
            }
        },
        None if req.concern.is_empty() => return Err(Refusal::NothingAccepted),
        None => report
            .concerns
            .iter()
            .find(|c| c.id == req.concern)
            .ok_or_else(|| Refusal::UnknownConcern {
                concern: req.concern.clone(),
            })?,
    };
    if !req.concern.is_empty()
        && req.concern != c.id
        && let Some(id) = named.first()
    {
        return Err(Refusal::OtherConcern {
            id: (*id).clone(),
            concern: c.id.clone(),
        });
    }
    let r = Reading::new(c);
    let mut ways: Vec<&Variant> = Vec::new();
    for w in &named {
        if ways.iter().any(|v| v.id == **w) {
            continue;
        }
        let v = match find(report, w) {
            None => return Err(Refusal::UnknownVariant { id: (*w).clone() }),
            Some((other, _)) if other.id != c.id => {
                return Err(Refusal::OtherConcern {
                    id: (*w).clone(),
                    concern: other.id.clone(),
                });
            }
            Some(_) => r
                .variant(w)
                .ok_or_else(|| Refusal::UnknownVariant { id: (*w).clone() })?,
        };
        is_way(&r, v).map_err(|why| Refusal::NotAWay {
            id: (*w).clone(),
            why,
        })?;
        ways.push(v);
    }
    let used = r.mechanisms();
    let mut mechanisms: Vec<String> = Vec::new();
    for m in &req.mechanisms {
        if !used.contains(m.as_str()) {
            return Err(Refusal::NotAMechanism {
                concern: c.id.clone(),
                mechanism: m.clone(),
            });
        }
        if !mechanisms.contains(m) {
            mechanisms.push(m.clone());
        }
    }
    if req.any_enforcing && !r.traits.has_enforcing() {
        return Err(Refusal::NoEnforcing {
            concern: c.id.clone(),
        });
    }
    if ways.is_empty() && mechanisms.is_empty() && !req.any_enforcing {
        return Err(Refusal::NothingAccepted);
    }
    let asked = Asked {
        ways,
        mechanisms,
        enforcing: req.any_enforcing,
    };
    match place {
        Some(p) => {
            let verdicts = r.verdicts(&asked.accepts());
            let judged = r.judged(p, &verdicts);
            build_from(&r, &asked, p, &judged, req.force)
        }
        None => {
            let (ok, nearest) = qualifying(&r, &asked, req.force);
            ok.into_iter().next().ok_or_else(|| Refusal::NoPlace {
                id: asked.name(),
                nearest: nearest.map(Box::new),
            })
        }
    }
}

/// The labels of `ways`, as a person reads them: each in the first run's words
/// ([`plain_way`]), joined with ", or ".
fn labels(ways: &[Way]) -> String {
    ways.iter()
        .map(|w| sanitize(&plain_way(&w.label), 160))
        .collect::<Vec<_>>()
        .join(", or ")
}

/// What "any way that enforces it" means for a concern, in words.
fn enforcing_words(concern: &str) -> &'static str {
    match concern {
        super::AUTHN => "any way that turns an unsigned caller away",
        super::AUTHZ => "any check Drift proved compares the caller with what is asked for",
        _ => "any way Drift reads as enforcing it",
    }
}

/// What the promoted practice `c` accepts besides its named ways, each in the words a
/// preview says it with: every mechanism accepted whole ("by any membership guard") and
/// any enforcing way ("any way that turns an unsigned caller away"). Empty for a
/// practice of named ways only and for any other convention. A list or a card that
/// names a practice's ways says these too: a practice of a mechanism or of any
/// enforcing way names no way, and would otherwise read as accepting nothing.
pub fn accepts_beyond_ways(c: &Convention) -> Vec<String> {
    let Rule::Practice {
        concern,
        any_mechanism,
        any_enforcing,
        ..
    } = &c.rule
    else {
        return Vec::new();
    };
    let mut out: Vec<String> = any_mechanism.iter().map(|m| mechanism_words(m)).collect();
    if *any_enforcing {
        out.push(enforcing_words(concern).to_string());
    }
    out
}

/// A mechanism accepted whole, in words: "by any membership guard".
fn mechanism_words(m: &str) -> String {
    format!("by any {}", sanitize(&m.replace('_', " "), 60))
}

/// What a candidate accepts, as a person reads it: its ways ([`labels`]), each
/// mechanism whole ("by any dependency"), and any enforcing way, joined with ", or ".
fn accepted_words(c: &Candidate) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !c.ways.is_empty() {
        parts.push(labels(&c.ways));
    }
    for m in &c.mechanisms {
        parts.push(mechanism_words(m));
    }
    if c.any_enforcing {
        parts.push(enforcing_words(&c.concern).to_string());
    }
    parts.join(", or ")
}

/// The concern as a line opens with it: the first run's word ([`plain_concern`]),
/// capitalised ("Sign-in").
fn concern_heading(concern: &str) -> String {
    let word = sanitize(plain_concern(concern), 40);
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => word,
    }
}

/// The role a promoted practice of `place` is written with: its package and directory
/// (the whole package as [`PACKAGE_WIDE`]), and values no unit's role has for the rest
/// ([`PRACTICE_FILE`]), so no role-member lookup ever finds a member of it.
fn role_of(place: &Place) -> RoleSelector {
    RoleSelector {
        package: place.package.clone(),
        dir: if place.dir.is_empty() {
            PACKAGE_WIDE.to_string()
        } else {
            place.dir.clone()
        },
        file: PRACTICE_FILE.to_string(),
        entry: "-".to_string(),
        kind: SymbolKind::Module,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: Vec::new(),
    }
}

/// The convention promoting `c` writes: accepted by the person, advise mode, shown to
/// agents on their word ([`crate::policy::AgentsChoice::Show`]),
/// [`Convention::promoted_from_practice`] the first way's id. Its id is of the place, the
/// concern and the form ([`candidate_id`]), so adding a way later keeps the id and its
/// lock entries, and a practice of another form in the same place never takes it over.
/// A mechanism accepted whole and any enforcing way are written as the
/// rule's `any_mechanism` and `any_enforcing`; the summary says them in words ("Sign-in
/// in app/api: any way that turns an unsigned caller away").
pub fn convention(c: &Candidate) -> Convention {
    let mut any_of: Vec<String> = c.ways.iter().flat_map(Way::keys).collect();
    any_of.sort();
    any_of.dedup();
    let mut any_mechanism = c.mechanisms.clone();
    any_mechanism.sort();
    any_mechanism.dedup();
    let holders = c.follows;
    let total = c.follows + c.exceptions.len();
    Convention {
        id: candidate_id(c),
        status: Status::Accepted,
        mode: Mode::Advise,
        summary: format!(
            "{} in {}: {}",
            concern_heading(&c.concern),
            c.place.words(),
            accepted_words(c)
        ),
        role: role_of(&c.place),
        rule: Rule::Practice {
            concern: c.concern.clone(),
            any_of,
            any_mechanism,
            any_enforcing: c.any_enforcing,
            in_file: c.place.file.clone(),
            under_route: c
                .place
                .route
                .as_deref()
                .map(|r| canonical_route(r).unwrap_or_else(|| r.to_string())),
        },
        evidence: Evidence {
            holders,
            total,
            lower_bound: r3(wilson_lower_bound(holders, total)),
            lift: 1.0,
            split: c.ways.iter().map(|w| (w.key.clone(), w.members)).collect(),
            role_members: None,
            python_members: (c.python > 0).then_some(c.python),
        },
        example: c
            .example
            .as_ref()
            .map_or(String::new(), |e| format!("{}#{}", e.path, e.symbol)),
        selector_version: crate::policy::SELECTOR_VERSION,
        agents: Some(AgentsChoice::Show),
        exceptions: Vec::new(),
        different_kind: Vec::new(),
        promoted_from_hidden: false,
        promoted_from_practice: c.ways.first().map(|w| w.id.clone()),
        from_map: None,
        accepted_evidence: None,
    }
}

/// The id of the promoted practice of `concern` in `place`: `D-` and 6 hex digits.
pub fn convention_id(place: &Place, concern: &str) -> String {
    // The prefix keeps it apart from every mined convention's id input (a role and a
    // rule), so mining never proposes, refreshes or replaces one.
    let mut text = format!("practice\0{}\0{}\0{concern}", place.package, place.dir);
    // A file or a route place adds its kind and value; a directory adds nothing, so
    // its id is what it always was.
    if let Some(f) = &place.file {
        text.push_str(&format!("\0file\0{f}"));
    }
    if let Some(r) = &place.route {
        text.push_str(&format!("\0route\0{r}"));
    }
    let h = blake3::hash(text.as_bytes());
    format!("D-{}", &h.to_hex()[..6])
}

/// What a promoted practice accepts, as a kind: named ways, a mechanism whole, or any
/// way that enforces the concern. Ordered from the most specific: a practice that
/// names ways and a mechanism is of the mechanism form, one that also accepts any
/// enforcing way of the enforcing form ([`breadth`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Form {
    Ways,
    Mechanism,
    Enforcing,
}

impl Form {
    fn of(mechanisms: bool, enforcing: bool) -> Form {
        if enforcing {
            Form::Enforcing
        } else if mechanisms {
            Form::Mechanism
        } else {
            Form::Ways
        }
    }
}

impl Candidate {
    /// What it accepts, as a kind ([`Form`]).
    pub fn form(&self) -> Form {
        Form::of(!self.mechanisms.is_empty(), self.any_enforcing)
    }
}

/// The form of the promoted practice `c` ([`Form`]); `None` for any other convention.
pub fn form_of(c: &Convention) -> Option<Form> {
    match &c.rule {
        Rule::Practice {
            any_mechanism,
            any_enforcing,
            ..
        } => Some(Form::of(!any_mechanism.is_empty(), *any_enforcing)),
        _ => None,
    }
}

/// The id of the promoted practice of `concern` in `place` of the form `form`. Named
/// ways keep the id of the place and the concern ([`convention_id`]), the one every
/// practice was written with before forms had ids of their own, so the ids already in
/// `conventions.yaml` and `drift.lock` stay what they are; a mechanism and any
/// enforcing way add their form, so the three candidates of one place never share an
/// id (one declined is not the others declined, one promoted never overwrites another
/// by id). Adding a way, or a mechanism, keeps the id: the form is what changes it.
pub fn practice_id(place: &Place, concern: &str, form: Form) -> String {
    let tag = match form {
        Form::Ways => return convention_id(place, concern),
        Form::Mechanism => "mechanism",
        Form::Enforcing => "enforcing",
    };
    let mut text = format!("practice\0{}\0{}\0{concern}", place.package, place.dir);
    if let Some(f) = &place.file {
        text.push_str(&format!("\0file\0{f}"));
    }
    if let Some(r) = &place.route {
        text.push_str(&format!("\0route\0{r}"));
    }
    text.push_str(&format!("\0form\0{tag}"));
    let h = blake3::hash(text.as_bytes());
    format!("D-{}", &h.to_hex()[..6])
}

/// The id promoting `c` writes ([`practice_id`] of its place, concern and form).
pub fn candidate_id(c: &Candidate) -> String {
    practice_id(&c.place, &c.concern, c.form())
}

/// Whether the convention `x` is a promoted practice of `concern` in `place` of the
/// form `form`, whatever its id. A practice of the mechanism or the enforcing form
/// written before the forms had ids of their own carries its place's id
/// ([`convention_id`]); it is found by what it is, not by its id, and keeps that id
/// and its lock lines.
pub fn is_practice_of(x: &Convention, place: &Place, concern: &str, form: Form) -> bool {
    matches!(&x.rule, Rule::Practice { concern: c, .. } if c == concern)
        && form_of(x) == Some(form)
        && place_of(x).as_ref() == Some(place)
}

/// The units (`path`, `symbol`) of its place that the promoted practice `c` holds to
/// and that follow it as the code stands, read as [`check`] reads them. Empty for any
/// other convention, or one of a concern `report` does not have.
pub fn followers(report: &PracticesReport, c: &Convention) -> BTreeSet<(String, String)> {
    let (
        Rule::Practice {
            concern,
            any_of,
            any_mechanism,
            any_enforcing,
            ..
        },
        Some(place),
    ) = (&c.rule, place_of(c))
    else {
        return BTreeSet::new();
    };
    let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
        return BTreeSet::new();
    };
    let r = Reading::new(cr);
    let accepted = Accepts::of_rule(any_of, any_mechanism, *any_enforcing).with_folds(&cr.variants);
    r.judged(&place, &r.verdicts(&accepted))
        .iter()
        .filter(|j| j.verdict == Verdict::Follows)
        .map(|j| (j.path.to_string(), j.symbol.to_string()))
        .collect()
}

/// Every unit of its place (`path#symbol`) with what the promoted practice `c` says of
/// it as [`check`] reads it: follows, breaks, or the map cannot tell. What
/// [`super::probation`] counts. Empty for any other convention, or one of a concern
/// `report` does not have. Sorted by unit.
pub fn observed(
    report: &PracticesReport,
    c: &Convention,
) -> Vec<(String, super::probation::Observed)> {
    use super::probation::Observed;
    let (
        Rule::Practice {
            concern,
            any_of,
            any_mechanism,
            any_enforcing,
            ..
        },
        Some(place),
    ) = (&c.rule, place_of(c))
    else {
        return Vec::new();
    };
    let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
        return Vec::new();
    };
    let r = Reading::new(cr);
    let accepted = Accepts::of_rule(any_of, any_mechanism, *any_enforcing).with_folds(&cr.variants);
    let mut out: Vec<(String, Observed)> = r
        .judged(&place, &r.verdicts(&accepted))
        .iter()
        .map(|j| {
            let seen = match j.verdict {
                Verdict::Follows => Observed::Follows,
                Verdict::Unknown => Observed::Unknown,
                Verdict::Breaks => Observed::Breaks,
            };
            (j.key(), seen)
        })
        .collect();
    // Each unit once already: its mounts are judged together, the worst deciding.
    out.sort();
    out
}

/// The units of `concern` in `place` as [`check`] reads a place's membership
/// ([`Reading`]): each unit once (`path#symbol`), with its rows in the report (its
/// mounts), and whether it is there only as a route Drift did not read to the end, so
/// whatever the map says of it, it cannot be told there. A background job of a concern
/// about the caller, and an entry point of a kind served at no path in a route place,
/// is none of them. Sorted by unit. What [`super::probation`] records.
pub fn place_units<'r>(
    report: &'r PracticesReport,
    concern: &str,
    place: &Place,
) -> Vec<(String, Vec<(&'r UnitRow, bool)>)> {
    let Some(cr) = report.concerns.iter().find(|x| x.id == concern) else {
        return Vec::new();
    };
    let r = Reading::new(cr);
    let rows = r.places.get(place).map_or(&[][..], Vec::as_slice);
    let unread = r.unread.get(place).map_or(&[][..], Vec::as_slice);
    let mut by: BTreeMap<String, Vec<(&'r UnitRow, bool)>> = BTreeMap::new();
    for (i, not_read) in rows
        .iter()
        .map(|&i| (i, false))
        .chain(unread.iter().map(|&i| (i, true)))
    {
        let u: &'r UnitRow = &cr.units[i];
        by.entry(format!("{}#{}", u.path, u.symbol))
            .or_default()
            .push((u, not_read));
    }
    by.into_iter().collect()
}

/// The place a promoted practice holds in (its role's package and directory); `None`
/// for any other convention.
///
/// A file or route place is read from the rule ([`Rule::Practice`] `in_file`,
/// `under_route`); a route place is of the whole package whatever the role says.
pub fn place_of(c: &Convention) -> Option<Place> {
    let Rule::Practice {
        in_file,
        under_route,
        ..
    } = &c.rule
    else {
        return None;
    };
    let dir = if under_route.is_some() || c.role.dir == PACKAGE_WIDE || c.role.dir == "." {
        String::new()
    } else {
        c.role.dir.trim_end_matches('/').to_string()
    };
    Some(Place {
        package: c.role.package.clone(),
        dir,
        file: if under_route.is_some() {
            None
        } else {
            in_file.clone()
        },
        // The canonical form whatever the file says ([`canonical_route`]); a value
        // that is no literal prefix is kept as written and holds nothing.
        route: under_route
            .as_deref()
            .map(|r| canonical_route(r).unwrap_or_else(|| r.to_string())),
    })
}

/// What one unit of `concern` is ([`Concern::unit`]: `entry_point`, `symbol`), as the
/// registered classifier says; `None` for a concern no classifier is registered for. A
/// promoted practice stores its concern, not its unit: the classifier that checks it is
/// the one that says what it holds to.
pub fn unit_of(concern: &str) -> Option<&'static str> {
    super::registry()
        .iter()
        .map(|c| &**c)
        .find(|c| Concern::id(*c) == concern)
        .map(Concern::unit)
}

/// Whether a file's facts declare a unit of the kind `unit` names: an entry point for
/// `entry_point`; any symbol for the others. Which symbols of a file a symbol-level
/// classifier counts takes the map to say, and no per-file surface builds it: a rule
/// shown for a file it turns out to say nothing of costs a line, one left out is a rule
/// the agent never hears.
pub fn declares_unit(unit: &str, f: &FileFacts) -> bool {
    match unit {
        "entry_point" => !f.listed_entry_points().is_empty(),
        _ => !f.symbols.is_empty(),
    }
}

/// Whether the promoted practice `c` applies to the file at `path` of `package`: its
/// place holds the file, and the file has (or, once written, will have) a unit of the
/// convention's concern, as `has_unit` says of the concern's unit kind ([`unit_of`]).
/// `false` for any other convention.
///
/// The convention's role holds no file ([`PRACTICE_FILE`]), so a per-file surface that
/// reads roles alone never finds it: this is what they read instead. Cheap (no map is
/// built): the hooks ask on every tool call.
pub fn covers(
    c: &Convention,
    package: &str,
    path: &str,
    has_unit: impl FnOnce(&str) -> bool,
) -> bool {
    let (Rule::Practice { concern, .. }, Some(place)) = (&c.rule, place_of(c)) else {
        return false;
    };
    place.holds(package, path) && unit_of(concern).is_some_and(has_unit)
}

/// [`covers`] for a file whose facts are known: read from the repository, or lowered in
/// memory from the content an agent is about to write. For a concern about the caller
/// ([`Concern::needs_a_caller`]), a file whose only entry points are background jobs
/// declares no unit of it: a job takes no request.
///
/// By kind of place (cheap: it reads the file's facts alone):
/// - a directory: a file of the package in the directory or below it;
/// - one file: that file only;
/// - a route prefix: every file of its package that declares a unit of the concern.
///   A file's own facts cannot rule one out: the routes a router file records are
///   relative to where it is mounted, which the file alone does not show, so a file
///   that registers or mounts a route under the prefix, and one Drift cannot rule out,
///   are both covered.
pub fn covers_file(c: &Convention, f: &FileFacts) -> bool {
    let caller = match &c.rule {
        Rule::Practice { concern, .. } => needs_a_caller(concern),
        _ => false,
    };
    covers(c, &f.package, &f.path, |unit| {
        if caller && unit == "entry_point" {
            f.listed_entry_points().iter().any(|e| e.kind != JOB)
        } else {
            declares_unit(unit, f)
        }
    })
}

/// Whether the unit `symbol` of the file `f` is one the check of the promoted practice
/// `c` reads as a member, so a surface that says departures as facts can leave it to
/// the check. A directory or file place: [`covers_file`]. A route place: only when an
/// entry point of `symbol` in `f` has a route Drift read to the end as a literal, under
/// the prefix, as the check's own reading of membership counts one ([`Reading`]); a
/// unit whose route was not read so, or that is served elsewhere, is no member, so the
/// check says nothing of it and its departure is still said. Cheap: the file's facts
/// alone.
pub fn covers_unit(c: &Convention, f: &FileFacts, symbol: &str) -> bool {
    if !covers_file(c, f) {
        return false;
    }
    let Some(prefix) = place_of(c).and_then(|p| p.route) else {
        return true;
    };
    let want = prefix_segments(&prefix);
    let procedures = is_procedure_prefix(&prefix);
    f.listed_entry_points()
        .iter()
        .filter(|e| e.symbol == symbol && e.kind != JOB)
        .any(|e| {
            let (segs, whole, procedure) = unit_segments(Some(&e.kind), e.route.as_deref());
            whole
                && procedure == procedures
                && segs.len() >= want.len()
                && compatible(&segs[..], &want[..])
        })
}

/// Whether the registered classifier of `concern` is about the caller of a request
/// ([`Concern::needs_a_caller`]).
fn needs_a_caller(concern: &str) -> bool {
    super::registry()
        .iter()
        .find(|c| c.id() == concern)
        .is_some_and(|c| c.needs_a_caller())
}

/// What a promoted practice applies to in a file whose content is not known yet, said
/// before its rule ("for its entry points"); `None` for any other convention. A file of
/// the place that declares none is not held to it, and for a concern about the caller
/// neither is a background job ("for its entry points that take a request").
pub fn condition(c: &Convention) -> Option<String> {
    let Rule::Practice { concern, .. } = &c.rule else {
        return None;
    };
    let unit = unit_of(concern)?;
    let request = if unit == "entry_point" && needs_a_caller(concern) {
        " that take a request"
    } else {
        ""
    };
    let units = units_word(unit, 2);
    // A route place holds the entry points served under its prefix, wherever their
    // file is.
    if let Some(route) = place_of(c).and_then(|p| p.route) {
        let route = sanitize(&route, 160);
        return Some(if request.is_empty() {
            format!("for its {units} served under {route}")
        } else {
            format!("for its {units}{request} and are served under {route}")
        });
    }
    Some(format!("for its {units}{request}"))
}

/// What one unit of a concern is called, `n` of them (`entry_point`: "entry points").
pub(crate) fn units_word(unit: &str, n: usize) -> String {
    let one = match unit {
        "entry_point" => "entry point".to_string(),
        "catch" => "catch clause".to_string(),
        "test_file" => "test file".to_string(),
        other => other.replace('_', " "),
    };
    if n == 1 { one } else { format!("{one}s") }
}

/// The command that promotes `c` as it is: its first way, `--in` its place, `--with`
/// each other way, `--mechanism` each mechanism accepted whole and `--any-enforcing`;
/// `--concern` in place of a way when it names none. Each word through
/// [`crate::report::shell_word`]; a place that starts with `-` is written `--in=` so the
/// command line never reads it as a flag. Every command that names a candidate (the
/// list, the preview's block hint) is this one, so none drops a flag and promotes a
/// narrower rule.
pub fn command(c: &Candidate) -> String {
    use crate::report::shell_word;
    let mut s = String::from("drift practices promote");
    match c.ways.first() {
        Some(w) => {
            s.push(' ');
            s.push_str(&shell_word(&w.id));
        }
        None => {
            s.push_str(" --concern ");
            s.push_str(&shell_word(&c.concern));
        }
    }
    let place = c.place.shown();
    s.push_str(if place.starts_with('-') {
        " --in="
    } else {
        " --in "
    });
    s.push_str(&shell_word(&place));
    for w in c.ways.iter().skip(1) {
        s.push_str(" --with ");
        s.push_str(&shell_word(&w.id));
    }
    for m in &c.mechanisms {
        s.push_str(" --mechanism ");
        s.push_str(&shell_word(m));
    }
    if c.any_enforcing {
        s.push_str(" --any-enforcing");
    }
    s
}

/// What a person reads before the practice is written (and what the command prints):
/// how many follow, the exceptions recorded as they are (at most 3 named), what could
/// not be read, what `drift check` reports from now on, the mode and how to change it,
/// and the other ways that could be added. Ends with a newline.
pub fn preview(c: &Candidate, convention: &Convention) -> String {
    let mut out = format!(
        "{} in {}: {} in {} of {} {}.\n",
        concern_heading(&c.concern),
        c.place.words(),
        accepted_words(c),
        c.follows,
        c.total,
        units_word(&c.unit, c.total)
    );
    let n = c.exceptions.len();
    if n == 0 {
        out.push_str("  None does it another way.\n");
    } else {
        let mut named: Vec<String> = c
            .exceptions
            .iter()
            .take(NAMED)
            .map(|e| {
                format!(
                    "{}:{} {}",
                    sanitize(&e.path, 160),
                    e.line,
                    sanitize(&e.symbol, 80)
                )
            })
            .collect();
        if n > NAMED {
            named.push(format!("and {} more", n - NAMED));
        }
        let (does, is, it) = if n == 1 {
            ("does", "is", "it")
        } else {
            ("do", "are", "they")
        };
        out.push_str(&format!(
            "  {n} {does} not, and {is} recorded as {it} {is} ({}).\n",
            named.join(", ")
        ));
    }
    out.push_str(&format!(
        "  {} could not be read; those are never reported.\n",
        c.unknown
    ));
    if let Some(cause) = &c.unknown_cause {
        out.push_str(&format!("  {}\n", cause_sentence(cause)));
    }
    if c.unread_routes > 0 {
        out.push_str(&format!(
            "  Of those, {} {} a route Drift did not read to the end, so whether {} under {} is not known.\n",
            c.unread_routes,
            if c.unread_routes == 1 { "has" } else { "have" },
            if c.unread_routes == 1 { "it is" } else { "they are" },
            sanitize(c.place.route.as_deref().unwrap_or(""), 160)
        ));
    }
    if c.jobs > 0 {
        out.push_str(&format!(
            "  {} background {} take no request and {} not counted.\n",
            c.jobs,
            if c.jobs == 1 { "job" } else { "jobs" },
            if c.jobs == 1 { "is" } else { "are" }
        ));
    }
    out.push_str(&format!(
        "From now on `drift check` reports a new {} here that does it another way, or not at all.\n",
        units_word(&c.unit, 1)
    ));
    if c.passive {
        out.push_str("This is what code here does by doing nothing: new code follows it without trying, so the rule reports only code that does something else.\n");
    }
    // The command that promotes this very candidate, every flag of it, and `--block`:
    // one that left out a way, a mechanism or any enforcing way would write a narrower
    // rule over this one.
    let readable = c.follows + n;
    let block = if readable < REPLAY_UNITS {
        format!(
            "It cannot block: blocking needs a replay of the {REPLAY_UNITS} {} added here most recently, and Drift can read only {readable} here",
            units_word(&c.unit, REPLAY_UNITS)
        )
    } else {
        format!(
            "`{} --block` makes it fail one, when the {} {} {} here most recently follow it",
            sanitize(&command(c), 480),
            REPLAY_UNITS,
            units_word(&c.unit, REPLAY_UNITS),
            if c.place.kind() == Kind::File {
                "added or changed"
            } else {
                "added"
            }
        )
    };
    let mode = if c.forced {
        format!(
            "Mode: advise (it never fails a check). It is promoted below the usual share on your word ({}% of what Drift could read, where {}% is needed), so it never blocks.\n",
            pct(c.follows, c.follows + n),
            share_pct(PLACE_SHARE)
        )
    } else if convention.language() == Lang::Python {
        "Mode: advise (it never fails a check). A place of Python code advises only.\n".to_string()
    } else if crate::check::effective_mode(convention) == "block" {
        format!(
            "Mode: block (a new one fails the check). `drift review --advise {}` makes it advise.\n",
            sanitize(&convention.id, 40)
        )
    } else {
        format!("Mode: advise (it never fails a check). {block}.\n")
    };
    out.push_str(&mode);
    if !c.other_ways.is_empty() {
        out.push_str("Other ways code here uses, none of them accepted unless you name it with `--with <id>`:\n");
        for w in &c.other_ways {
            out.push_str(&format!(
                "  {} {}: {} {}\n",
                sanitize(&w.id, 40),
                sanitize(&plain_way(&w.label), 160),
                w.members,
                units_word(&c.unit, w.members)
            ));
        }
    }
    out
}

/// Whether the convention is read by `drift check` in `scope`.
fn in_scope(c: &Convention, scope: Scope) -> bool {
    match scope {
        Scope::Accepted => c.status == Status::Accepted,
        Scope::All => c.status != Status::Rejected,
    }
}

/// Whether a reviewer's exception or a file set apart as a different kind exempts the
/// unit, as they do for every other convention: a set-apart file covers an entry point
/// of an authentication, authorization or validation practice only when the person
/// confirmed it by name [STRICT].
fn exempt(c: &Convention, concern: &str, j: &Judged<'_>) -> bool {
    c.exception(&j.key()).is_some()
        || c.different_kind_at(j.path).is_some_and(|d| {
            !CONFIRM_BY_NAME.contains(&concern) || d.entry_points.iter().any(|e| e == j.symbol)
        })
}

/// Whether a `drift-ignore <id>: reason` comment covers the unit's declaration.
fn suppressed(repo: &RepoFacts, j: &Judged<'_>, id: &str) -> bool {
    repo.files
        .iter()
        .find(|f| f.path == j.path)
        .and_then(|f| {
            f.symbols
                .iter()
                .find(|s| s.name == j.symbol && s.line == j.line)
                .or_else(|| f.symbols.iter().find(|s| s.name == j.symbol))
                .or_else(|| f.symbols.iter().find(|s| s.line == j.line && j.line > 0))
        })
        .is_some_and(|s| s.suppressions.iter().any(|x| x == id))
}

/// What the promoted practices of `policy` in `scope` say of the code. `report` must
/// list its units; `repo` gives each unit's `drift-ignore` comments and extent.
/// `only_paths` restricts which files are reported.
///
/// Whether a practice is stale is read over its whole place, whatever `only_paths`
/// says; a practice of a concern `report` does not have is not read at all. A practice
/// is stale when no unit of its place follows it in any of its forms: none does it one
/// of its ways, none uses one of its mechanisms, and (for any enforcing way) none
/// enforces the concern any more.
pub fn check(
    repo: &RepoFacts,
    report: &PracticesReport,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: Scope,
    only_paths: Option<&BTreeSet<String>>,
) -> Checked {
    let mut out = Checked::default();
    let conventions: Vec<&Convention> = policy
        .conventions
        .iter()
        .filter(|c| c.rule.is_practice() && in_scope(c, scope))
        .collect();
    if conventions.is_empty() {
        return out;
    }
    let unchecked = crate::unchecked::Unchecked::of(repo);
    let starts = crate::check::declaration_starts(repo);
    let listed = |path: &str| only_paths.is_none_or(|o| o.contains(path));
    for c in conventions {
        let (
            Rule::Practice {
                concern,
                any_of,
                any_mechanism,
                any_enforcing,
                ..
            },
            Some(place),
        ) = (&c.rule, place_of(c))
        else {
            continue;
        };
        let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
            continue;
        };
        let r = Reading::new(cr);
        let accepted =
            Accepts::of_rule(any_of, any_mechanism, *any_enforcing).with_folds(&cr.variants);
        let judged = r.judged(&place, &r.verdicts(&accepted));
        // Units that break it anew (not in the lock) are the gate's to stop, never a
        // reason to stop gating: counted against it, an agent rewrapping every route of
        // the place made the practice stale (it fired on nothing) or pushed it under the
        // share it blocks at. They count as following it, as a mined rule's do
        // ([`crate::check`]'s staleness).
        let anew = judged
            .iter()
            .filter(|j| j.verdict == Verdict::Breaks && !lock.contains(&c.id, &j.key()))
            .count();
        if anew == 0 && !judged.iter().any(|j| j.verdict == Verdict::Follows) {
            out.stale.push(Stale {
                id: c.id.clone(),
                summary: c.summary.clone(),
                units: judged.len(),
            });
            continue;
        }
        let unknown = judged
            .iter()
            .filter(|j| j.verdict == Verdict::Unknown && listed(j.path))
            .count();
        if unknown > 0 {
            out.not_checked.push(NotChecked {
                id: c.id.clone(),
                units: unknown,
            });
        }
        // Blocks only while the place still holds it as the gate asked at promotion: the
        // evidence recorded then is not refreshed, the code is read now.
        let count = |v: Verdict| judged.iter().filter(|j| j.verdict == v).count();
        let (follows, breaks) = (count(Verdict::Follows), count(Verdict::Breaks));
        let mode = if ((follows + anew) as f64) < BLOCK_SHARE * (follows + breaks) as f64 {
            "advise"
        } else {
            crate::check::effective_mode(c)
        };
        // The units whose lock entry stays: those that break it (reported, exempt or
        // not) and those the map cannot tell.
        let mut current: BTreeSet<String> = BTreeSet::new();
        for j in &judged {
            if j.verdict == Verdict::Follows {
                continue;
            }
            let key = j.key();
            current.insert(key.clone());
            if j.verdict == Verdict::Unknown || !listed(j.path) || exempt(c, concern, j) {
                continue;
            }
            out.violations.push(Violation {
                id: c.id.clone(),
                path: j.path.to_string(),
                symbol: j.symbol.to_string(),
                line: j.line,
                summary: c.summary.clone(),
                evidence: format!("{}/{}", c.evidence.holders, c.evidence.total),
                example: c.example.clone(),
                // Under the share, it advises for its legacy units only: a unit not in
                // the lock keeps the practice's own mode.
                mode: if lock.contains(&c.id, &key) {
                    mode.into()
                } else {
                    crate::check::effective_mode(c).into()
                },
                tier: c.tier(),
                baselined: lock.contains(&c.id, &key),
                suppressed: suppressed(repo, j, &c.id),
                unsure: unchecked.uncertain(j.path),
                suppressed_neighbour: false,
                extent: if j.line == 0 {
                    Extent::File
                } else {
                    let (start, end) = crate::check::span(&starts, j.path, j.line);
                    Extent::Symbol { start, end }
                },
                wire: None,
                import: None,
                practice: Some(concern.clone()),
            });
        }
        if only_paths.is_none() {
            out.fixed.extend(
                lock.entries
                    .iter()
                    .filter(|(id, key)| {
                        *id == c.id
                            && !current.contains(key)
                            && !unchecked
                                .uncertain(key.split_once('#').map_or(key.as_str(), |(p, _)| p))
                    })
                    .map(|(id, key)| format!("{id} {key}")),
            );
        }
    }
    out.violations.sort();
    out.fixed.sort();
    out.fixed.dedup();
    out.stale.sort();
    out.not_checked.sort();
    out
}

/// The lock entries that record every unit breaking a promoted practice of `policy`
/// today (every one not rejected), as [`crate::check::baseline`] does for the rest.
pub fn baseline(
    repo: &RepoFacts,
    report: &PracticesReport,
    policy: &ConventionsFile,
) -> BTreeSet<(String, String)> {
    check(repo, report, policy, &Lock::default(), Scope::All, None)
        .violations
        .into_iter()
        .map(|v| (v.id, format!("{}#{}", v.path, v.symbol)))
        .collect()
}

/// Whether any convention of `policy` in `scope` is a promoted practice: only then is
/// the map needed to check it.
pub fn any(policy: &ConventionsFile, scope: Scope) -> bool {
    policy
        .conventions
        .iter()
        .any(|c| c.rule.is_practice() && in_scope(c, scope))
}

/// Of the [`REPLAY_UNITS`] units most recently added to the place of the promoted
/// practice `c` that the map can tell, how many follow it as they stand. `added`: when
/// the file at a repo-relative path was first committed (seconds since the epoch;
/// `None` when unknown, and such a unit is not read). Ties are broken by path, line.
///
/// Not for a file place: every unit of one file has the file's date, so the tie-break
/// would pick its first lines, not its recent ones. A file place reads no unit here
/// (so it is never allowed to block on the file's date); [`replay_dated`] dates each
/// unit by its own line.
pub fn replay(
    report: &PracticesReport,
    c: &Convention,
    added: &dyn Fn(&str) -> Option<i64>,
) -> Replay {
    let by_file = place_of(c).is_some_and(|p| p.kind() == Kind::File);
    replay_dated(report, c, &|path: &str, _line: u32| {
        if by_file { None } else { added(path) }
    })
}

/// [`replay`] with each unit dated by `added(path, line)`, `line` the line that
/// declares it. For a file place, `added` must say when that line last changed (the
/// commit `git blame` names for it): what is recent in one file is what was added or
/// changed there lately. A unit it cannot date is not read, never dated by its file.
/// Elsewhere `added` may say when the file was first committed. Ties are broken by
/// path, line.
pub fn replay_dated(
    report: &PracticesReport,
    c: &Convention,
    added: &dyn Fn(&str, u32) -> Option<i64>,
) -> Replay {
    let (
        Rule::Practice {
            concern,
            any_of,
            any_mechanism,
            any_enforcing,
            ..
        },
        Some(place),
    ) = (&c.rule, place_of(c))
    else {
        return Replay::default();
    };
    let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
        return Replay::default();
    };
    let r = Reading::new(cr);
    let accepted = Accepts::of_rule(any_of, any_mechanism, *any_enforcing).with_folds(&cr.variants);
    let judged = r.judged(&place, &r.verdicts(&accepted));
    let readable = judged
        .iter()
        .filter(|j| j.verdict != Verdict::Unknown)
        .count();
    let by_line = place.kind() == Kind::File;
    let mut dated: Vec<(i64, &Judged<'_>)> = judged
        .iter()
        .filter(|j| j.verdict != Verdict::Unknown)
        .filter_map(|j| added(j.path, j.line).map(|t| (t, j)))
        .collect();
    dated.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(a.1.path.cmp(b.1.path))
            .then(a.1.line.cmp(&b.1.line))
            .then(a.1.symbol.cmp(b.1.symbol))
    });
    dated.truncate(REPLAY_UNITS);
    Replay {
        recent: dated.len(),
        followed: dated
            .iter()
            .filter(|(_, j)| j.verdict == Verdict::Follows)
            .count(),
        readable,
        by_line,
    }
}

impl Replay {
    /// Whether the replay lets the practice block: [`REPLAY_UNITS`] units were read and
    /// at least [`PLACE_SHARE`] of them follow. `Err` is the sentence a person reads.
    pub fn allows_block(&self) -> Result<(), String> {
        // A place that holds fewer units Drift can read than the replay reads can never
        // be replayed, however much history there is: said as it is, not as a shortage
        // of dates.
        if self.readable < REPLAY_UNITS {
            return Err(format!(
                "its place holds only {} that Drift can read, and block mode needs the {REPLAY_UNITS} most recently added there, so it cannot block until the place holds {REPLAY_UNITS}; it advises until then",
                self.readable
            ));
        }
        if self.recent < REPLAY_UNITS {
            let (dated, why) = if self.by_line {
                (
                    "dated by the last commit that changed the line that declares each",
                    if self.recent == 0 {
                        " (no git history, or the file's lines could not be dated)"
                    } else {
                        ""
                    },
                )
            } else {
                (
                    "dated by the commit that first added their file",
                    if self.recent == 0 {
                        " (no git history, or no unit whose file's first commit is known)"
                    } else {
                        ""
                    },
                )
            };
            return Err(format!(
                "block mode needs the {REPLAY_UNITS} most recently added to the place that Drift can read, {dated}; it found {}{why}",
                self.recent
            ));
        }
        if (self.followed as f64) < PLACE_SHARE * self.recent as f64 {
            return Err(format!(
                "of the last {} added to the place, {} follow it as they stand ({}%), and blocking needs {}%",
                self.recent,
                self.followed,
                pct(self.followed, self.recent),
                share_pct(PLACE_SHARE)
            ));
        }
        Ok(())
    }

    /// The evidence as a person reads it: "of the last 15 entry points added here, 14
    /// follow it as they stand".
    pub fn sentence(&self, unit: &str) -> String {
        format!(
            "of the last {} {} {} here, {} follow it as they stand",
            self.recent,
            units_word(unit, self.recent),
            if self.by_line {
                "added or changed"
            } else {
                "added"
            },
            self.followed
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::practices::{AUTHN, PackageProfile};
    use drift_core::{FileFacts, Symbol};

    const AUTH: &str = "wrap:lib/auth.ts#withAuth";
    const USER: &str = "dependency:lib/user.ts#getUser";

    fn variant(id: &str, key: &str, label: &str, kind: VariantKind) -> Variant {
        Variant {
            id: id.into(),
            key: key.into(),
            label: label.into(),
            kind,
            ..Variant::default()
        }
    }

    fn variants() -> Vec<Variant> {
        let fold = Variant {
            alternatives: vec![
                variant("P-alt1", "wrap:lib/a.ts#a", "wrap a", VariantKind::Known),
                variant("P-alt2", "wrap:lib/b.ts#b", "wrap b", VariantKind::Known),
            ],
            ..variant(
                "P-fold",
                "any_of(wrap:lib/a.ts#a|wrap:lib/b.ts#b)",
                "wrap a, or wrap b",
                VariantKind::Known,
            )
        };
        vec![
            variant("P-auth", AUTH, "wrap withAuth", VariantKind::Known),
            variant("P-user", USER, "dependency getUser", VariantKind::Known),
            variant("P-none", "none", "no guard found", VariantKind::None),
            variant(
                "P-tail",
                TAIL,
                "other ways, one unit each",
                VariantKind::Known,
            ),
            fold,
        ]
    }

    /// A unit of `variant` (`""` unknown) at `path`, package "".
    fn row(path: &str, symbol: &str, line: u32, variant: &str) -> UnitRow {
        UnitRow {
            package: String::new(),
            variant: variant.into(),
            path: path.into(),
            symbol: symbol.into(),
            line,
            assignment: match variant {
                "" => "unknown",
                "P-none" => "none",
                _ => "known",
            }
            .into(),
            ..UnitRow::default()
        }
    }

    /// A unit of a fold or the tail, with its own way.
    fn own(path: &str, symbol: &str, variant: &str, key: &str) -> UnitRow {
        UnitRow {
            key: Some(key.into()),
            does: Some(key.into()),
            ..row(path, symbol, 1, variant)
        }
    }

    /// `n` routes `<dir>/r<i>/route.ts` of `variant`.
    fn routes(dir: &str, from: usize, n: usize, variant: &str) -> Vec<UnitRow> {
        (from..from + n)
            .map(|i| row(&format!("{dir}/r{i:02}/route.ts"), "GET", 1, variant))
            .collect()
    }

    fn report(units: Vec<UnitRow>) -> PracticesReport {
        PracticesReport {
            concerns: vec![ConcernReport {
                id: AUTHN.into(),
                title: "Authentication".into(),
                unit: "entry_point".into(),
                variants: variants(),
                units,
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        }
    }

    fn at(package: &str, dir: &str) -> Place {
        Place {
            package: package.into(),
            dir: dir.into(),
            ..Place::default()
        }
    }

    fn policy(conventions: Vec<Convention>) -> ConventionsFile {
        ConventionsFile {
            version: crate::policy::POLICY_VERSION_SINGLE,
            engine: String::new(),
            file_kinds: crate::roles::FileKinds::default(),
            suggestion_cap: None,
            agents: Default::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            conventions,
        }
    }

    /// The fixture of the brief: 38 of 40 routes in app/api wrapped, 2 with nothing.
    fn api() -> PracticesReport {
        let mut units = routes("app/api", 0, 38, "P-auth");
        units.extend(routes("app/api", 38, 2, "P-none"));
        report(units)
    }

    #[test]
    fn units_follow_break_or_are_not_told() {
        let mut units = routes("app/api", 0, 8, "P-auth");
        units.extend(routes("app/api", 8, 1, "P-user"));
        units.extend(routes("app/api", 9, 1, "P-none"));
        units.extend(routes("app/api", 10, 1, ""));
        let mut identified = row("app/api/r11/route.ts", "GET", 1, "P-id");
        identified.assignment = "identified".into();
        units.push(identified);
        let c = candidate(
            &report(units),
            "P-auth",
            Some(&at("", "app/api")),
            &[],
            true,
        )
        .unwrap();
        assert_eq!(
            (c.follows, c.exceptions.len(), c.unknown, c.total),
            (8, 3, 1, 12)
        );
        assert_eq!(
            c.exceptions
                .iter()
                .map(|e| e.path.as_str())
                .collect::<Vec<_>>(),
            [
                "app/api/r08/route.ts",
                "app/api/r09/route.ts",
                "app/api/r11/route.ts"
            ]
        );
        assert_eq!(c.ways[0].members, 8);
        assert_eq!(c.example.as_ref().unwrap().path, "app/api/r00/route.ts");
        // Another known way is offered, never added.
        assert_eq!(c.other_ways.len(), 1);
        assert_eq!(
            (c.other_ways[0].id.as_str(), c.other_ways[0].members),
            ("P-user", 1)
        );
        assert!(c.forced, "8 of 11 is below the share");
    }

    #[test]
    fn eligibility_at_each_threshold() {
        let place = at("", "app/api");
        let try_ = |units: Vec<UnitRow>, force: bool| {
            candidate(&report(units), "P-auth", Some(&place), &[], force)
        };
        // 7 readable units: too few; 8: enough.
        assert!(matches!(
            try_(routes("app/api", 0, 7, "P-auth"), false),
            Err(Refusal::TooSmall {
                units: 7,
                min: 8,
                ..
            })
        ));
        assert!(try_(routes("app/api", 0, 8, "P-auth"), false).is_ok());
        // 8 of 10 is the share; 31 of 39 is just under it.
        let mut at_share = routes("app/api", 0, 8, "P-auth");
        at_share.extend(routes("app/api", 8, 2, "P-none"));
        let c = try_(at_share, false).unwrap();
        assert!(!c.forced);
        let mut under = routes("app/api", 0, 31, "P-auth");
        under.extend(routes("app/api", 31, 8, "P-none"));
        let refused = try_(under.clone(), false).unwrap_err();
        assert_eq!(
            refused,
            Refusal::BelowShare {
                place: "app/api".into(),
                follows: 31,
                read: 39
            }
        );
        assert!(refused.forceable());
        assert!(refused.to_string().contains("(79%)"), "{refused}");
        assert!(refused.to_string().contains("--force"), "{refused}");
        // Forced: promoted, advise only.
        let forced = try_(under, true).unwrap();
        assert!(forced.forced);
        let conv = convention(&forced);
        assert_eq!(crate::check::effective_mode(&conv), "advise");
        // 2 of 10 unknown is allowed; 3 of 14 (just over 0.2) is not, forced or not.
        let mut two = routes("app/api", 0, 8, "P-auth");
        two.extend(routes("app/api", 8, 2, ""));
        assert!(try_(two, false).is_ok());
        let mut three = routes("app/api", 0, 11, "P-auth");
        three.extend(routes("app/api", 11, 3, ""));
        let refused = try_(three, true).unwrap_err();
        assert!(matches!(
            refused,
            Refusal::TooUnknown {
                unknown: 3,
                total: 14,
                ..
            }
        ));
        assert!(!refused.forceable());
        assert!(
            refused.to_string().contains("drift practices --hints"),
            "{refused}"
        );
        // A place with no unit of the concern.
        assert!(matches!(
            candidate(&api(), "P-auth", Some(&at("", "lib")), &[], false),
            Err(Refusal::NoSuchPlace { .. })
        ));
    }

    #[test]
    fn what_is_not_a_way_is_never_promoted() {
        let r = api();
        for id in ["P-none", "P-tail"] {
            assert!(
                matches!(
                    candidate(&r, id, None, &[], true),
                    Err(Refusal::NotAWay { .. })
                ),
                "{id}"
            );
        }
        // A way no unit is known to use (a declaration nothing proves).
        let mut declared = r.clone();
        declared.concerns[0].variants.push(Variant {
            source: crate::practices::VariantSource::Declared,
            ..variant(
                "P-decl",
                "declared:lib/x.ts#x",
                "declared x",
                VariantKind::Known,
            )
        });
        assert!(matches!(
            candidate(&declared, "P-decl", None, &[], true),
            Err(Refusal::NotAWay { .. })
        ));
        assert_eq!(
            candidate(&r, "P-nope", None, &[], false),
            Err(Refusal::UnknownVariant {
                id: "P-nope".into()
            })
        );
    }

    #[test]
    fn a_folded_policy_accepts_both_of_its_ways() {
        let mut units: Vec<UnitRow> = (0..6)
            .map(|i| own(&format!("svc/a{i}.py"), "h", "P-fold", "wrap:lib/a.ts#a"))
            .collect();
        units
            .extend((0..4).map(|i| own(&format!("svc/b{i}.py"), "h", "P-fold", "wrap:lib/b.ts#b")));
        units.extend(routes("svc", 0, 1, "P-none"));
        let r = report(units);
        let c = candidate(&r, "P-fold", None, &[], false).unwrap();
        assert_eq!(c.place, at("", ""));
        assert_eq!((c.follows, c.exceptions.len()), (10, 1));
        let conv = convention(&c);
        assert_eq!(
            conv.rule,
            Rule::Practice {
                concern: AUTHN.into(),
                any_of: vec!["wrap:lib/a.ts#a".into(), "wrap:lib/b.ts#b".into()],
                any_mechanism: Vec::new(),
                any_enforcing: false,
                in_file: None,
                under_route: None,
            }
        );
        assert_eq!(conv.promoted_from_practice.as_deref(), Some("P-fold"));
        // A Python place advises only.
        assert_eq!(conv.evidence.python_members, Some(10));
        assert_eq!(conv.language(), Lang::Python);
        // One alternative alone: the other's units break it, and it is offered.
        let one = candidate(&r, "P-alt1", None, &[], true).unwrap();
        assert_eq!((one.follows, one.exceptions.len()), (6, 5));
        assert_eq!(one.other_ways[0].id, "P-alt2");
        // The fold's units of a promoted practice follow it by their own way.
        let checked = check(
            &RepoFacts::default(),
            &r,
            &policy(vec![conv]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert_eq!(checked.violations.len(), 1);
        assert_eq!(checked.violations[0].path, "svc/r00/route.ts");
    }

    #[test]
    fn with_adds_a_way_of_the_same_concern() {
        let mut units = routes("app/api", 0, 6, "P-auth");
        units.extend(routes("app/api", 6, 3, "P-user"));
        units.extend(routes("app/api", 9, 1, "P-none"));
        let r = report(units);
        assert!(matches!(
            candidate(&r, "P-auth", None, &[], false),
            Err(Refusal::NoPlace {
                nearest: Some(_),
                ..
            })
        ));
        let c = candidate(&r, "P-auth", None, &["P-user".into()], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (9, 1));
        assert_eq!(
            c.ways
                .iter()
                .map(|w| (w.id.as_str(), w.members))
                .collect::<Vec<_>>(),
            [("P-auth", 6), ("P-user", 3)]
        );
        assert!(c.other_ways.is_empty());
        let conv = convention(&c);
        assert_eq!(
            conv.summary,
            "Sign-in in the root package: wrapped in withAuth, or depends on getUser"
        );
        // The id is of the place and concern: adding a way keeps it.
        let alone = candidate(&r, "P-auth", Some(&c.place), &[], true).unwrap();
        assert_eq!(convention(&alone).id, conv.id);
        assert_eq!(conv.id, convention_id(&at("", ""), AUTHN));
        assert!(
            conv.id.starts_with("D-") && conv.id.len() == 8,
            "{}",
            conv.id
        );
        // A way of another concern is refused.
        let mut other = r.clone();
        let mut errors = other.concerns[0].clone();
        errors.id = crate::practices::ERRORS.into();
        errors.variants = vec![variant("P-err", "bubble:x", "bubble", VariantKind::Known)];
        other.concerns.push(errors);
        assert_eq!(
            candidate(&other, "P-auth", None, &["P-err".into()], false),
            Err(Refusal::OtherConcern {
                id: "P-err".into(),
                concern: "errors".into()
            })
        );
    }

    #[test]
    fn the_broadest_qualifying_place_and_a_directory_its_package_does_not_hold() {
        // app/api follows withAuth, lib/jobs getUser: the root holds neither at 80%.
        let mut units = routes("app/api", 0, 10, "P-auth");
        units.extend(routes("lib/jobs", 0, 10, "P-user"));
        let r = report(units);
        let c = candidate(&r, "P-auth", None, &[], false).unwrap();
        // `app` and `app/api` hold the same units: the broader is taken.
        assert_eq!(c.place, at("", "app"));
        let listed: Vec<(String, String, bool)> = candidates(&r)
            .iter()
            .map(|c| {
                (
                    c.ways.first().map_or(String::new(), |w| w.id.clone()),
                    c.place.shown(),
                    c.any_enforcing,
                )
            })
            .collect();
        // Every unit of the root signs its caller in, one way or the other: the
        // practice "any way that turns an unsigned caller away" holds all 20, twice
        // what either way holds, so it is offered beside them.
        assert_eq!(
            listed,
            [
                (String::new(), ".".to_string(), true),
                ("P-auth".to_string(), "app".to_string(), false),
                ("P-user".to_string(), "lib".to_string(), false)
            ]
        );
        // The root refuses, with the share.
        assert!(matches!(
            candidate(&r, "P-auth", Some(&at("", "")), &[], false),
            Err(Refusal::BelowShare {
                follows: 10,
                read: 20,
                ..
            })
        ));
        // When the whole package qualifies, it is the place, and no directory of it is
        // listed.
        let whole = api();
        let all = candidates(&whole);
        assert_eq!(all.len(), 1, "{all:?}");
        assert_eq!(all[0].place.shown(), ".");
        // The engine's `promotable` says the same.
        let mut c = whole.concerns[0].clone();
        fill_promotable(&mut c);
        let p = c.variants[0].promotable.clone().unwrap();
        assert_eq!(
            (p.rule.as_str(), p.role.as_str(), p.place.as_deref()),
            ("practice", "", Some("."))
        );
        assert!(c.variants.iter().skip(1).all(|v| v.promotable.is_none()));
    }

    #[test]
    fn a_stale_practice_fires_on_nothing() {
        let conv = convention(&candidate(&api(), "P-auth", None, &[], false).unwrap());
        // withAuth was renamed: every unit is now another way.
        let renamed = report(routes("app/api", 0, 40, "P-user"));
        // [FIX3-W3] Review fix v1, item 1 (fcd5f71e): units that break it anew (not in
        // `drift.lock`) are the gate's to stop, never a reason to stop gating. With an
        // empty lock the 40 renamed units are new violations, in the practice's own
        // mode, and the practice is not stale (before, it fired on nothing).
        let fresh = check(
            &RepoFacts::default(),
            &renamed,
            &policy(vec![conv.clone()]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert!(fresh.stale.is_empty(), "{:?}", fresh.stale);
        assert_eq!(fresh.violations.len(), 40);
        assert!(
            fresh
                .violations
                .iter()
                .all(|v| v.id == conv.id && v.mode == "advise" && !v.baselined)
        );
        // In block mode they block: staleness never demotes a violation the change adds.
        let mut blocking = conv.clone();
        blocking.mode = Mode::Block;
        let fresh = check(
            &RepoFacts::default(),
            &renamed,
            &policy(vec![blocking]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert!(fresh.stale.is_empty(), "{:?}", fresh.stale);
        assert_eq!(fresh.violations.len(), 40);
        assert!(
            fresh
                .violations
                .iter()
                .all(|v| v.mode == "block" && !v.baselined)
        );
        // Once those units are legacy (in the lock), no unit follows it and none breaks
        // it anew: it is stale and fires on nothing.
        let lock = Lock {
            entries: baseline(&RepoFacts::default(), &renamed, &policy(vec![conv.clone()])),
        };
        assert_eq!(lock.entries.len(), 40);
        let checked = check(
            &RepoFacts::default(),
            &renamed,
            &policy(vec![conv.clone()]),
            &lock,
            Scope::Accepted,
            None,
        );
        assert!(checked.violations.is_empty());
        assert!(checked.fixed.is_empty(), "{:?}", checked.fixed);
        assert_eq!(checked.stale.len(), 1);
        assert_eq!(
            (checked.stale[0].id.as_str(), checked.stale[0].units),
            (conv.id.as_str(), 40)
        );
        // No unit left in the place (the units are all in another package): stale too.
        let elsewhere = routes("apps/web", 0, 3, "P-auth")
            .into_iter()
            .map(|u| UnitRow {
                package: "apps/web".into(),
                ..u
            })
            .collect();
        let empty = report(elsewhere);
        let checked = check(
            &RepoFacts::default(),
            &empty,
            &policy(vec![conv]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert_eq!(checked.stale[0].units, 0);
    }

    #[test]
    fn violations_are_baselined_suppressed_and_fixed() {
        let r = api();
        let cand = candidate(&r, "P-auth", None, &[], false).unwrap();
        let conv = convention(&cand);
        let p = policy(vec![conv.clone()]);
        // Promotion baselines today's exceptions.
        let lock = Lock {
            entries: baseline(&RepoFacts::default(), &r, &p),
        };
        assert_eq!(
            lock.entries
                .iter()
                .map(|(_, k)| k.as_str())
                .collect::<Vec<_>>(),
            ["app/api/r38/route.ts#GET", "app/api/r39/route.ts#GET"]
        );
        // A new route without the guard, one with a drift-ignore comment.
        let mut units = r.concerns[0].units.clone();
        units.extend(routes("app/api", 40, 2, "P-none"));
        let now = report(units);
        let repo = RepoFacts {
            files: vec![FileFacts {
                path: "app/api/r41/route.ts".into(),
                symbols: vec![Symbol {
                    name: "GET".into(),
                    line: 1,
                    suppressions: vec![conv.id.clone()],
                    ..Symbol::default()
                }],
                ..FileFacts::default()
            }],
            ..RepoFacts::default()
        };
        let checked = check(&repo, &now, &p, &lock, Scope::Accepted, None);
        let seen: Vec<(&str, bool, bool)> = checked
            .violations
            .iter()
            .map(|v| (v.path.as_str(), v.baselined, v.suppressed))
            .collect();
        assert_eq!(
            seen,
            [
                ("app/api/r38/route.ts", true, false),
                ("app/api/r39/route.ts", true, false),
                ("app/api/r40/route.ts", false, false),
                ("app/api/r41/route.ts", false, true),
            ]
        );
        let v = &checked.violations[2];
        assert_eq!(
            (v.summary.as_str(), v.evidence.as_str()),
            (conv.summary.as_str(), "38/40")
        );
        assert_eq!(v.mode, "advise");
        assert_eq!(v.example, "app/api/r00/route.ts#GET");
        assert!(checked.fixed.is_empty());
        // Only some files: only theirs are reported, nothing is called fixed.
        let only: BTreeSet<String> = ["app/api/r40/route.ts".to_string()].into();
        let some = check(&repo, &now, &p, &lock, Scope::Accepted, Some(&only));
        assert_eq!(some.violations.len(), 1);
        // r38 now follows, r39 cannot be told: only r38's entry is fixed.
        let mut units = routes("app/api", 0, 39, "P-auth");
        units.push(row("app/api/r39/route.ts", "GET", 1, ""));
        let checked = check(&repo, &report(units), &p, &lock, Scope::Accepted, None);
        assert!(checked.violations.is_empty());
        assert_eq!(
            checked.fixed,
            [format!("{} app/api/r38/route.ts#GET", conv.id)]
        );
        assert_eq!(
            checked.not_checked,
            [NotChecked {
                id: conv.id.clone(),
                units: 1
            }]
        );
        // A reviewer's exception exempts the unit.
        let mut excused = conv.clone();
        excused.set_exception("app/api/r40/route.ts#GET", "public on purpose");
        let checked = check(
            &repo,
            &now,
            &policy(vec![excused]),
            &lock,
            Scope::Accepted,
            None,
        );
        assert!(
            checked
                .violations
                .iter()
                .all(|v| v.path != "app/api/r40/route.ts")
        );
        // A proposal or rejected practice is not checked as accepted.
        let mut rejected = conv;
        rejected.status = Status::Rejected;
        assert_eq!(
            check(
                &repo,
                &now,
                &policy(vec![rejected]),
                &lock,
                Scope::All,
                None
            ),
            Checked::default()
        );
    }

    #[test]
    fn a_handler_mounted_twice_is_reported_once() {
        let mut units = routes("app/api", 0, 10, "P-auth");
        let mut a = row("app/api/shared.ts", "handler", 4, "P-none");
        a.route = Some("/a".into());
        let mut b = a.clone();
        b.route = Some("/b".into());
        units.extend([a, b]);
        let r = report(units);
        let c = candidate(&r, "P-auth", None, &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len(), c.total), (10, 1, 11));
        let conv = convention(&c);
        let mut units = r.concerns[0].units.clone();
        units.extend(routes("app/api", 20, 1, "P-none"));
        let checked = check(
            &RepoFacts::default(),
            &report(units),
            &policy(vec![conv]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert_eq!(
            checked
                .violations
                .iter()
                .map(|v| v.path.as_str())
                .collect::<Vec<_>>(),
            ["app/api/r20/route.ts", "app/api/shared.ts"]
        );
        // One mount that breaks makes the unit break: one that follows does not save it.
        let mut mixed = row("app/api/shared.ts", "handler", 4, "P-auth");
        mixed.route = Some("/c".into());
        let mut units = r.concerns[0].units.clone();
        units.push(mixed);
        let c = candidate(&report(units), "P-auth", None, &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (10, 1));
    }

    #[test]
    fn replay_reads_the_most_recent_units_it_can_date() {
        let conv = convention(&candidate(&api(), "P-auth", None, &[], false).unwrap());
        // Every file dated by its number: r39 newest. r38 and r39 break.
        let dated =
            |p: &str| -> Option<i64> { p.strip_prefix("app/api/r")?.get(..2)?.parse::<i64>().ok() };
        let r = replay(&api(), &conv, &dated);
        assert_eq!(
            r,
            Replay {
                recent: 15,
                followed: 13,
                readable: 40,
                ..Replay::default()
            }
        );
        assert_eq!(
            r.sentence("entry_point"),
            "of the last 15 entry points added here, 13 follow it as they stand"
        );
        // 13 of 15 is at least 80%.
        assert!(r.allows_block().is_ok());
        // Ties: every file added at once: broken by path, so r00..r14, all following.
        let same = replay(&api(), &conv, &|_| Some(7));
        assert_eq!(
            same,
            Replay {
                recent: 15,
                followed: 15,
                readable: 40,
                ..Replay::default()
            }
        );
        assert!(same.allows_block().is_ok());
        // Unknown add times are not read: too few to block.
        let few = replay(&api(), &conv, &|p| {
            if p < "app/api/r05" { Some(1) } else { None }
        });
        assert_eq!(few.recent, 5);
        assert!(few.allows_block().unwrap_err().contains("it found 5"));
        assert!(
            replay(&api(), &conv, &|_| None)
                .allows_block()
                .unwrap_err()
                .contains("no git history")
        );
        // 12 of 15 is 80%: allowed; 11 of 15 is not.
        assert!(
            Replay {
                recent: 15,
                followed: 12,
                readable: 40,
                ..Replay::default()
            }
            .allows_block()
            .is_ok()
        );
        assert!(
            Replay {
                recent: 15,
                followed: 11,
                readable: 40,
                ..Replay::default()
            }
            .allows_block()
            .is_err()
        );
    }

    #[test]
    fn places_are_parsed_shown_and_held() {
        let mut r = report(vec![UnitRow {
            package: "apps/web".into(),
            ..row("apps/web/api/x.ts", "GET", 1, "P-auth")
        }]);
        r.concerns[0].by_package.push(PackageProfile {
            package: "apps/api".into(),
            ..PackageProfile::default()
        });
        assert_eq!(Place::parse(".", &r), Some(at("", "")));
        assert_eq!(Place::parse("", &r), Some(at("", "")));
        assert_eq!(Place::parse("./app/api/", &r), Some(at("", "app/api")));
        assert_eq!(Place::parse("apps/web", &r), Some(at("apps/web", "")));
        assert_eq!(
            Place::parse("apps/web/api/v1", &r),
            Some(at("apps/web", "api/v1"))
        );
        assert_eq!(
            Place::parse("apps/api/views", &r),
            Some(at("apps/api", "views"))
        );
        // A name that only starts like a package is not in it.
        assert_eq!(
            Place::parse("apps/website", &r),
            Some(at("", "apps/website"))
        );
        assert_eq!(Place::parse("/etc", &r), None);
        assert_eq!(Place::parse("app/../etc", &r), None);
        assert_eq!(at("", "").shown(), ".");
        assert_eq!(at("", "app/api").shown(), "app/api");
        assert_eq!(at("apps/web", "").shown(), "apps/web");
        assert_eq!(at("apps/web", "api").shown(), "apps/web/api");
        let root = at("", "");
        assert!(root.holds("", "route.ts"));
        assert!(root.holds("", "app/api/x/route.ts"));
        assert!(!root.holds("apps/web", "apps/web/x.ts"));
        let api = at("", "app/api");
        assert!(api.holds("", "app/api/route.ts"));
        assert!(api.holds("", "app/api/x/route.ts"));
        assert!(!api.holds("", "app/api2/route.ts"));
        assert!(!api.holds("", "app/route.ts"));
        let web = at("apps/web", "api");
        assert!(web.holds("apps/web", "apps/web/api/x.ts"));
        assert!(!web.holds("apps/web", "apps/web/apix/x.ts"));
        assert!(!web.holds("", "apps/web/api/x.ts"));
        // The place a convention holds in reads back from its role.
        let c = Candidate {
            concern: AUTHN.into(),
            place: web.clone(),
            ..Candidate::default()
        };
        assert_eq!(place_of(&convention(&c)), Some(web));
        let c = Candidate {
            concern: AUTHN.into(),
            ..Candidate::default()
        };
        assert_eq!(place_of(&convention(&c)), Some(root));
    }

    #[test]
    fn the_preview_says_what_is_recorded() {
        let c = candidate(&api(), "P-auth", None, &[], false).unwrap();
        let conv = convention(&c);
        let text = preview(&c, &conv);
        assert_eq!(
            text,
            "Sign-in in the root package: wrapped in withAuth in 38 of 40 entry points.\n  \
             2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).\n  \
             0 could not be read; those are never reported.\n\
             From now on `drift check` reports a new entry point here that does it another way, or not at all.\n\
             Mode: advise (it never fails a check). `drift practices promote P-auth --in . --block` makes it fail one, when the 15 entry points added here most recently follow it.\n"
        );
        assert_eq!(conv.status, Status::Accepted);
        assert_eq!(conv.mode, Mode::Advise);
        assert_eq!(conv.agents, Some(AgentsChoice::Show));
        assert_eq!(conv.evidence.holders, 38);
        assert_eq!(conv.evidence.total, 40);
        assert!(conv.evidence.lower_bound > 0.8 && conv.evidence.lower_bound < 0.95);
        // More than three exceptions: three named, the rest counted.
        let mut units = routes("app/api", 0, 36, "P-auth");
        units.extend(routes("app/api", 36, 5, "P-none"));
        let c = candidate(&report(units), "P-auth", None, &[], false).unwrap();
        assert!(preview(&c, &convention(&c)).contains("app/api/r38/route.ts:1 GET, and 2 more)."));
    }

    #[test]
    fn drift_init_keeps_a_promoted_practice_as_it_is() {
        let conv = convention(&candidate(&api(), "P-auth", None, &[], false).unwrap());
        let existing = policy(vec![conv.clone()]);
        assert!(existing.accepted_rules().is_empty());
        assert!(crate::show::convention_kept(&conv));
        let merged = ConventionsFile::merge(
            Some(existing),
            "e2",
            crate::roles::FileKinds::default(),
            &[],
        );
        assert_eq!(merged.conventions, [conv]);
    }

    #[test]
    fn the_role_of_a_practice_holds_no_member() {
        let c = convention(&candidate(&api(), "P-auth", None, &[], false).unwrap());
        let file = FileFacts {
            path: "app/api/r00/route.ts".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![Symbol {
                name: "GET".into(),
                line: 1,
                ..Symbol::default()
            }],
            ..FileFacts::default()
        };
        let kinds = crate::roles::FileKinds::default();
        assert!(!crate::roles::convention_role_covers_path(
            &c.role,
            c.selector_version,
            &file.path,
            Some(&file),
            None,
            &kinds,
        ));
    }

    #[test]
    fn a_practice_covers_the_files_of_its_place_with_a_unit_of_its_concern() {
        let place = at("", "app/api");
        let conv = convention(&candidate(&api(), "P-auth", Some(&place), &[], false).unwrap());
        assert_eq!(unit_of(AUTHN), Some("entry_point"));
        assert_eq!(unit_of("no-such-concern"), None);
        // In the place, with or without a unit of the concern.
        assert!(covers(&conv, "", "app/api/r40/route.ts", |_| true));
        assert!(!covers(&conv, "", "app/api/r40/route.ts", |_| false));
        // Outside the place, or of another package.
        assert!(!covers(&conv, "", "app/admin/route.ts", |_| true));
        assert!(!covers(&conv, "web", "web/app/api/r40/route.ts", |_| true));
        // Sign-in is of a caller: a background job is no unit of it.
        assert_eq!(
            condition(&conv).as_deref(),
            Some("for its entry points that take a request")
        );
        // A file's facts: an entry point is a unit, a helper's symbols are not.
        let helper = FileFacts {
            path: "app/api/util.ts".into(),
            symbols: vec![Symbol {
                name: "slugify".into(),
                line: 1,
                ..Symbol::default()
            }],
            ..FileFacts::default()
        };
        assert!(!covers_file(&conv, &helper));
        let route = FileFacts {
            path: "app/api/r40/route.ts".into(),
            entry_points: vec![drift_core::EntryPoint {
                symbol: "GET".into(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: None,
                adapter: String::new(),
            }],
            ..FileFacts::default()
        };
        assert!(covers_file(&conv, &route));
        // A file whose only entry point is a background job takes no request.
        let job = FileFacts {
            path: "app/api/r41/task.py".into(),
            entry_points: vec![drift_core::EntryPoint {
                symbol: "cleanup".into(),
                kind: "job".into(),
                method: None,
                route: None,
                adapter: String::new(),
            }],
            ..FileFacts::default()
        };
        assert!(!covers_file(&conv, &job));
    }

    // ---------- what counts as following (stream S1) ----------

    /// A report of one concern with these variants and units.
    fn report_of(
        concern: &str,
        unit: &str,
        vs: Vec<Variant>,
        units: Vec<UnitRow>,
    ) -> PracticesReport {
        PracticesReport {
            concerns: vec![ConcernReport {
                id: concern.into(),
                title: concern.into(),
                unit: unit.into(),
                variants: vs,
                units,
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        }
    }

    const A: &str = "wrap:lib/a.ts#a";
    const B: &str = "wrap:lib/b.ts#b";
    const OPEN: &str = "opens:pkg:x#AllowAny";

    /// Sign-in ways for the mechanism and enforcing tests: two wrappers, a dependency,
    /// a way that opens a route on purpose, one that only identifies the caller, and
    /// one that does `withAuth` and checks more besides. Without the fold of `variants`:
    /// its alternatives are `A` and `B`, so it would hold every unit of either wrapper
    /// and be the one way offered where these tests need no single way to qualify.
    fn signin_variants() -> Vec<Variant> {
        let mut vs: Vec<Variant> = variants()
            .into_iter()
            .filter(|v| v.id != "P-fold")
            .collect();
        vs.extend([
            variant("P-a", A, "wrap a", VariantKind::Known),
            variant("P-b", B, "wrap b", VariantKind::Known),
            variant("P-open", OPEN, "opens AllowAny", VariantKind::Known),
            variant(
                "P-id",
                "identifies:pkg:x#Session",
                "identifies Session",
                VariantKind::Identified,
            ),
            variant(
                "P-more",
                "body_check:req.user+wrap:lib/auth.ts#withAuth",
                "body check req.user + wrap withAuth",
                VariantKind::Known,
            ),
        ]);
        vs
    }

    fn signin(units: Vec<UnitRow>) -> PracticesReport {
        report_of(AUTHN, "entry_point", signin_variants(), units)
    }

    fn checked(r: &PracticesReport, conv: &Convention) -> Checked {
        check(
            &RepoFacts::default(),
            r,
            &policy(vec![conv.clone()]),
            &Lock::default(),
            Scope::Accepted,
            None,
        )
    }

    /// [`checked`] with every unit that breaks `conv` today in the lock (legacy).
    fn legacy(r: &PracticesReport, conv: &Convention) -> Checked {
        let p = policy(vec![conv.clone()]);
        let lock = Lock {
            entries: baseline(&RepoFacts::default(), r, &p),
        };
        check(&RepoFacts::default(), r, &p, &lock, Scope::Accepted, None)
    }

    fn violating(c: &Checked) -> Vec<&str> {
        c.violations.iter().map(|v| v.path.as_str()).collect()
    }

    /// Pins inclusion: before, a unit that signs in with `withAuth` and checks more
    /// besides was an exception of the `withAuth` practice; now it follows it.
    #[test]
    fn a_unit_that_does_the_way_and_more_follows_it() {
        let mut units = routes("app/api", 0, 7, "P-auth");
        units.extend(routes("app/api", 7, 2, "P-more"));
        units.extend(routes("app/api", 9, 1, "P-user"));
        let r = signin(units);
        let c = candidate(&r, "P-auth", None, &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (9, 1));
        assert_eq!(c.ways[0].members, 9);
        assert_eq!(c.exceptions[0].path, "app/api/r09/route.ts");
        // The unit's own uses, as the engine fills them, say the same.
        let mut units = routes("app/api", 0, 8, "P-auth");
        let mut tail = row("app/api/r08/route.ts", "GET", 1, "P-tail");
        tail.uses = vec![AUTH.into(), "body_check:req.user".into()];
        tail.uses.sort();
        units.push(tail);
        let c = candidate(&signin(units), "P-auth", None, &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (9, 0));
        // Checked the same way: a new unit that does more follows.
        let conv = convention(&c);
        let mut units = routes("app/api", 0, 8, "P-auth");
        units.extend(routes("app/api", 8, 1, "P-more"));
        units.extend(routes("app/api", 9, 1, "P-none"));
        units.extend(routes("app/api", 10, 1, ""));
        let now = checked(&signin(units), &conv);
        assert_eq!(violating(&now), ["app/api/r09/route.ts"]);
        assert_eq!(now.not_checked[0].units, 1);
    }

    /// Pins that inclusion is the concern's to allow: where the extra instrument is
    /// the departure (configuration), the whole key must be accepted, as before.
    #[test]
    fn where_the_extra_use_is_the_departure_the_whole_key_is_needed() {
        let vs = vec![
            variant(
                "P-mod",
                "config_module:lib/config.ts",
                "config module",
                VariantKind::Known,
            ),
            variant(
                "P-mix",
                "config_module:lib/config.ts+in_place:process.env",
                "config module + in place",
                VariantKind::Known,
            ),
        ];
        let mut units = routes("lib", 0, 8, "P-mod");
        units.extend(routes("lib", 8, 2, "P-mix"));
        let r = report_of(crate::practices::CONFIG, "symbol", vs, units);
        let c = candidate(&r, "P-mod", None, &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (8, 2));
    }

    /// Pins a mechanism accepted whole: two wrappers that hold half each qualify as
    /// "by any wrap", and `candidates` offers it where no single way qualifies.
    #[test]
    fn a_mechanism_accepted_whole() {
        let mut units = routes("app/api", 0, 5, "P-a");
        units.extend(routes("app/api", 5, 5, "P-b"));
        units.extend(routes("app/api", 10, 1, "P-user"));
        let r = signin(units);
        let req = Request {
            concern: AUTHN.into(),
            mechanisms: vec!["wrap".into()],
            ..Request::default()
        };
        let c = candidate_for(&r, None, &req).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (10, 1));
        assert_eq!(c.mechanisms, ["wrap"]);
        assert!(c.ways.is_empty() && !c.passive);
        let conv = convention(&c);
        assert_eq!(
            conv.rule,
            Rule::Practice {
                concern: AUTHN.into(),
                any_of: Vec::new(),
                any_mechanism: vec!["wrap".into()],
                any_enforcing: false,
                in_file: None,
                under_route: None,
            }
        );
        assert_eq!(conv.summary, "Sign-in in the root package: by any wrap");
        assert_eq!(conv.promoted_from_practice, None);
        // 11 units Drift can read: fewer than a replay reads, so it is told it cannot
        // block, never handed a command that could not.
        let text = preview(&c, &conv);
        assert!(
            text.contains("It cannot block: blocking needs a replay of the 15 entry points added here most recently, and Drift can read only 11 here."),
            "{text}"
        );
        assert!(!text.contains("--block"), "{text}");
        // Offered by the list: no way holds 80% alone. Any enforcing way holds 11,
        // only one more than the mechanism: not offered beside it.
        let all = candidates(&r);
        assert_eq!(all.len(), 1, "{all:?}");
        assert_eq!(all[0].mechanisms, ["wrap"]);
        // Checked: a new wrapper of the same mechanism follows; a dependency breaks.
        let mut units = r.concerns[0].units.clone();
        units.push(UnitRow {
            key: Some("wrap:lib/c.ts#c".into()),
            ..row("app/api/r20/route.ts", "GET", 1, "P-tail")
        });
        units.extend(routes("app/api", 21, 1, "P-user"));
        let now = checked(&signin(units), &conv);
        assert_eq!(
            violating(&now),
            ["app/api/r10/route.ts", "app/api/r21/route.ts"]
        );
        // Refused: a mechanism nothing uses, or nothing at all.
        let none_uses = Request {
            mechanisms: vec!["decorator".into()],
            ..req.clone()
        };
        assert!(matches!(
            candidate_for(&r, None, &none_uses),
            Err(Refusal::NotAMechanism { .. })
        ));
        assert_eq!(
            candidate_for(&r, None, &Request::default()),
            Err(Refusal::NothingAccepted)
        );
        assert_eq!(mechanism_of(A), "wrap");
        assert_eq!(mechanism_of("none"), "none");
    }

    /// Pins any enforcing way: whatever guard signs the caller in follows; a way that
    /// opens the route breaks it unless a person names it; one that only identifies
    /// the caller, or nothing found, breaks it; unknown is never reported.
    #[test]
    fn any_way_that_enforces_the_concern() {
        let mut units = routes("app/api", 0, 6, "P-auth");
        units.extend(routes("app/api", 6, 4, "P-user"));
        units.extend(routes("app/api", 10, 1, "P-open"));
        let r = signin(units);
        let req = Request {
            concern: AUTHN.into(),
            any_enforcing: true,
            ..Request::default()
        };
        let c = candidate_for(&r, None, &req).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (10, 1));
        assert_eq!(c.other_ways[0].id, "P-open");
        let conv = convention(&c);
        assert_eq!(
            conv.summary,
            "Sign-in in the root package: any way that turns an unsigned caller away"
        );
        assert!(matches!(
            &conv.rule,
            Rule::Practice { any_enforcing: true, any_of, .. } if any_of.is_empty()
        ));
        // Named, the open way follows too.
        let named = Request {
            ways: vec!["P-open".into()],
            ..req.clone()
        };
        let c2 = candidate_for(&r, None, &named).unwrap();
        assert_eq!((c2.follows, c2.exceptions.len()), (11, 0));
        // Checked: identified and none break, unknown is not checked.
        let mut units = r.concerns[0].units.clone();
        let mut id = row("app/api/r20/route.ts", "GET", 1, "P-id");
        id.assignment = "identified".into();
        units.push(id);
        units.extend(routes("app/api", 21, 1, "P-none"));
        units.extend(routes("app/api", 22, 1, ""));
        units.extend(routes("app/api", 23, 1, "P-a"));
        let now = checked(&signin(units), &conv);
        assert_eq!(
            violating(&now),
            [
                "app/api/r10/route.ts",
                "app/api/r20/route.ts",
                "app/api/r21/route.ts"
            ]
        );
        assert_eq!(now.not_checked[0].units, 1);
        // A concern with no notion of enforcing refuses it.
        let errors = report_of(
            crate::practices::ERRORS,
            "entry_point",
            vec![variant(
                "P-err",
                "throw:HTTPException",
                "throw",
                VariantKind::Known,
            )],
            routes("app/api", 0, 8, "P-err"),
        );
        let ask = Request {
            concern: crate::practices::ERRORS.into(),
            any_enforcing: true,
            ..Request::default()
        };
        assert!(matches!(
            candidate_for(&errors, None, &ask),
            Err(Refusal::NoEnforcing { .. })
        ));
    }

    /// Pins that a mechanism that opens routes is never offered whole: the list offers
    /// "by any wrap" and never "by any opens".
    #[test]
    fn a_mechanism_that_opens_routes_is_never_offered() {
        let mut units: Vec<UnitRow> = (0..10)
            .map(|i| UnitRow {
                key: Some(format!("opens:pkg:x#Open{i}")),
                ..row(&format!("pub/r{i:02}/route.ts"), "GET", 1, "P-tail")
            })
            .collect();
        units.extend(routes("pub", 10, 1, "P-auth"));
        let all = candidates(&signin(units));
        assert!(
            all.iter()
                .all(|c| !c.mechanisms.contains(&"opens".to_string())),
            "{all:?}"
        );
    }

    /// Pins the entry kind: a background job takes no request, so the 5 jobs with no
    /// sign-in no longer hold the place below the share, and a new job is never
    /// reported.
    #[test]
    fn a_background_job_is_no_unit_of_sign_in() {
        let job = |i: usize| UnitRow {
            kind: Some("job".into()),
            ..row(&format!("app/tasks/t{i:02}.py"), "run", 1, "P-none")
        };
        let mut units = routes("app/api", 0, 10, "P-auth");
        units.extend((0..5).map(job));
        let r = signin(units);
        let c = candidate(&r, "P-auth", Some(&at("", "app")), &[], false).unwrap();
        assert_eq!(
            (c.follows, c.exceptions.len(), c.total, c.jobs),
            (10, 0, 10, 5)
        );
        assert!(preview(&c, &convention(&c)).contains("5 background jobs take no request"));
        let conv = convention(&c);
        let mut units = r.concerns[0].units.clone();
        units.push(job(9));
        assert!(checked(&signin(units), &conv).violations.is_empty());
        // The same units of a concern that does not need a caller are counted.
        let errors = report_of(
            crate::practices::ERRORS,
            "entry_point",
            vec![variant(
                "P-err",
                "throw:HTTPException",
                "throw",
                VariantKind::Known,
            )],
            (0..10)
                .map(|i| UnitRow {
                    kind: Some("job".into()),
                    ..row(&format!("app/tasks/t{i:02}.py"), "run", 1, "P-err")
                })
                .collect(),
        );
        let c = candidate(&errors, "P-err", None, &[], false).unwrap();
        assert_eq!((c.follows, c.jobs), (10, 0));
    }

    /// Pins passive ways: errors left to the framework are what code does by doing
    /// nothing, as the classifier's `bubble` mechanism says; a way someone chose is not.
    /// Logging to the console is not passive: no fact of the use says "the language's
    /// own output", and the instrument's name is not one.
    #[test]
    fn a_way_of_doing_nothing_is_passive() {
        let errors = report_of(
            crate::practices::ERRORS,
            "entry_point",
            vec![
                variant(
                    "P-bubble",
                    "bubble:framework_default",
                    "bubble framework_default",
                    VariantKind::Known,
                ),
                variant("P-err", "throw:HTTPException", "throw", VariantKind::Known),
            ],
            {
                let mut u = routes("app/api", 0, 9, "P-bubble");
                u.extend(routes("lib", 0, 9, "P-err"));
                u
            },
        );
        let c = candidate(&errors, "P-bubble", None, &[], false).unwrap();
        assert!(c.passive);
        assert!(preview(&c, &convention(&c)).contains("by doing nothing"));
        assert!(
            !candidate(&errors, "P-err", None, &[], false)
                .unwrap()
                .passive
        );
        // Still listed, marked.
        let listed = candidates(&errors);
        assert!(listed.iter().any(|c| c.passive), "{listed:?}");
        assert!(listed.iter().any(|c| !c.passive), "{listed:?}");
        let logging = report_of(
            crate::practices::LOGGING,
            "symbol",
            vec![variant(
                "P-console",
                "message:console",
                "message logs via console",
                VariantKind::Known,
            )],
            routes("lib", 0, 8, "P-console"),
        );
        assert!(
            !candidate(&logging, "P-console", None, &[], false)
                .unwrap()
                .passive
        );
    }

    /// Pins stale detection for each form of the rule: a practice nothing in its place
    /// follows any more fires on nothing.
    #[test]
    fn each_form_of_a_practice_goes_stale() {
        // A mechanism: every wrapper replaced by a dependency.
        let mut units = routes("app/api", 0, 5, "P-a");
        units.extend(routes("app/api", 5, 5, "P-b"));
        let r = signin(units);
        let mech = Request {
            concern: AUTHN.into(),
            mechanisms: vec!["wrap".into()],
            ..Request::default()
        };
        let conv = convention(&candidate_for(&r, None, &mech).unwrap());
        // [FIX3-W3] Review fix v1, item 1 (fcd5f71e): a unit that breaks it anew (not in
        // `drift.lock`) is the gate's to stop, never a reason to stop gating. With an
        // empty lock every replaced unit is a new violation in the practice's own mode
        // and it is not stale; once they are in the lock (legacy), it is stale and fires
        // on nothing.
        let replacing = signin(routes("app/api", 0, 10, "P-user"));
        let fresh = checked(&replacing, &conv);
        assert!(fresh.stale.is_empty(), "{:?}", fresh.stale);
        assert_eq!(fresh.violations.len(), 10);
        assert!(
            fresh
                .violations
                .iter()
                .all(|v| v.mode == "advise" && !v.baselined)
        );
        let replaced = legacy(&replacing, &conv);
        assert!(replaced.violations.is_empty());
        assert_eq!(replaced.stale.len(), 1);
        // Still used by one unit: not stale, the rest break.
        let mut units = routes("app/api", 0, 9, "P-user");
        units.extend(routes("app/api", 9, 1, "P-a"));
        let kept = checked(&signin(units), &conv);
        assert!(kept.stale.is_empty());
        assert_eq!(kept.violations.len(), 9);
        // Any enforcing way: nothing turns a caller away any more.
        let enf = Request {
            concern: AUTHN.into(),
            any_enforcing: true,
            ..Request::default()
        };
        let conv = convention(&candidate_for(&r, None, &enf).unwrap());
        let mut units = routes("app/api", 0, 9, "P-none");
        units.extend(routes("app/api", 9, 1, "P-open"));
        let open = signin(units);
        // Not in the lock: ten new violations, not stale (as above).
        let fresh = checked(&open, &conv);
        assert!(fresh.stale.is_empty(), "{:?}", fresh.stale);
        assert_eq!(fresh.violations.len(), 10);
        assert!(fresh.violations.iter().all(|v| !v.baselined));
        let gone = legacy(&open, &conv);
        assert!(gone.violations.is_empty());
        assert_eq!(gone.stale.len(), 1);
        // The replay reads the same rule.
        let back = replay(&signin(routes("app/api", 0, 15, "P-auth")), &conv, &|_| {
            Some(1)
        });
        assert_eq!(back.followed, 15);
    }

    /// Pins the unknown share's refusal: when every unknown unit is unknown for one
    /// call outside them, the refusal says so, still refuses (the 20% is not moved),
    /// and names what would settle it.
    #[test]
    fn unknown_units_of_one_outside_cause_are_said_so() {
        let unread = |i: usize| UnitRow {
            reason: Some(UnknownReason::BodyUnreadable),
            instrument: "unread:`app.frontend(...)` (backend/app/main.py:36)".into(),
            ..row(&format!("backend/app/api/routes/u{i}.py"), "h", 1, "")
        };
        let mut units = routes("backend/app/api/routes", 0, 10, "P-auth");
        units.extend((0..3).map(unread));
        let r = signin(units.clone());
        let refused = candidate(
            &r,
            "P-auth",
            Some(&at("", "backend/app/api/routes")),
            &[],
            false,
        )
        .unwrap_err();
        let Refusal::TooUnknown {
            unknown: 3,
            total: 13,
            cause: Some(cause),
            ..
        } = &refused
        else {
            panic!("{refused:?}");
        };
        assert_eq!(
            (cause.reason, cause.units),
            (UnknownReason::BodyUnreadable, 3)
        );
        assert!(
            refused.to_string().contains("one cause outside them"),
            "{refused}"
        );
        assert!(!refused.to_string().contains("--hints"), "{refused}");
        // Two causes: none is shared, the refusal is as before.
        let mut other = unread(3);
        other.instrument = "lib/x.ts#helper".into();
        units.push(other);
        let refused = candidate(
            &signin(units),
            "P-auth",
            Some(&at("", "backend/app/api/routes")),
            &[],
            false,
        )
        .unwrap_err();
        assert!(
            matches!(refused, Refusal::TooUnknown { cause: None, .. }),
            "{refused:?}"
        );
        assert!(refused.to_string().contains("--hints"), "{refused}");
    }

    /// Pins that a fold of more than two alternatives accepts each of them.
    #[test]
    fn a_fold_of_three_accepts_each() {
        let alt = |key: &str| variant("P-alt", key, key, VariantKind::Known);
        let fold = Variant {
            alternatives: vec![alt("a:x"), alt("b:y"), alt("c:z")],
            ..variant("P-fold", "any_of(a:x|b:y|c:z)", "any", VariantKind::Known)
        };
        assert_eq!(way_keys(&fold), ["a:x", "b:y", "c:z"]);
        // A key that holds `|` is read from the fold itself, not split.
        let piped = variant("P-one", "a:x|y", "one", VariantKind::Known);
        assert_eq!(way_keys(&piped), ["a:x|y"]);
    }

    /// Pins that a key is cut only between uses: an instrument that holds a `+` (a
    /// SvelteKit `+layout.server.ts`, a route parameter `:p+`) is one use, so a unit
    /// that does it and more follows it. Before, the instrument was cut in two and the
    /// unit broke the practice.
    #[test]
    fn a_plus_in_an_instrument_is_not_a_second_use() {
        let layout = "wrap:src/routes/+layout.server.ts#handle";
        let key = format!("{layout}+body_check:event.locals.user");
        assert_eq!(use_keys(&key), [layout, "body_check:event.locals.user"]);
        assert_eq!(
            use_keys("matcher:/a/:p++wrap:x"),
            ["matcher:/a/:p+", "wrap:x"]
        );
        assert_eq!(use_keys(layout), [layout]);
        let mut uses = use_keys(&key);
        uses.sort_unstable();
        assert!(includes(&uses, layout));
    }

    /// Pins a practice stored with a fold's own key (`any_of(A|B)`), as one promoted
    /// before a fold's alternatives were stored was: the fold's units follow it by
    /// their own way. Before, none did: it went stale and reported nothing.
    #[test]
    fn a_practice_stored_with_a_folds_own_key_accepts_its_alternatives() {
        let mut units: Vec<UnitRow> = (0..6)
            .map(|i| own(&format!("svc/a{i}.py"), "h", "P-fold", "wrap:lib/a.ts#a"))
            .collect();
        units
            .extend((0..4).map(|i| own(&format!("svc/b{i}.py"), "h", "P-fold", "wrap:lib/b.ts#b")));
        units.extend(routes("svc", 0, 1, "P-none"));
        let r = report(units);
        let mut old = convention(&candidate(&r, "P-fold", None, &[], false).unwrap());
        if let Rule::Practice { any_of, .. } = &mut old.rule {
            *any_of = vec!["any_of(wrap:lib/a.ts#a|wrap:lib/b.ts#b)".into()];
        }
        let now = checked(&r, &old);
        assert!(now.stale.is_empty(), "{:?}", now.stale);
        assert_eq!(violating(&now), ["svc/r00/route.ts"]);
        assert_eq!(replay(&r, &old, &|_| Some(1)).followed, 10);
    }

    /// An entry point of `kind` at `path`, served at `route`, of `variant`.
    fn served(path: &str, symbol: &str, kind: &str, route: Option<&str>, variant: &str) -> UnitRow {
        UnitRow {
            kind: Some(kind.into()),
            route: route.map(str::to_string),
            ..row(path, symbol, 1, variant)
        }
    }

    /// The reviewer's scenario: 40 `/api/...` handlers signed in with `withAuth`, and
    /// 11 server actions beside them (a server action is served at no path).
    fn api_and_actions() -> PracticesReport {
        let mut units: Vec<UnitRow> = (0..40)
            .map(|i| {
                served(
                    &format!("app/api/r{i:02}/route.ts"),
                    "GET",
                    "http",
                    Some(format!("/api/r{i:02}").as_str()),
                    "P-auth",
                )
            })
            .collect();
        units.extend((0..11).map(|i| {
            served(
                &format!("app/api/actions/a{i:02}.ts"),
                &format!("save{i}"),
                "server_action",
                None,
                "P-none",
            )
        }));
        report(units)
    }

    /// Pins review item 1 (area 2): an entry point of a kind Drift read no route for
    /// (a server action, a resolver, a procedure) is in no route place, neither a
    /// member nor "not read" there. Before, its empty route was compatible with every
    /// prefix: 11 server actions beside 40 `/api` handlers made `.:/api` 11 of 51
    /// unknown, refused, never offered, and once accepted reported the actions as not
    /// checked, which no config line could settle. A handler of a kind served at a path
    /// whose route was not read is still not read there.
    #[test]
    fn an_entry_point_of_a_kind_served_at_no_path_is_in_no_route_place() {
        let r = api_and_actions();
        let api = Place::parse(".:/api", &r).unwrap();
        let c = candidate(&r, "P-auth", Some(&api), &[], false).unwrap();
        assert_eq!(
            (
                c.follows,
                c.exceptions.len(),
                c.unknown,
                c.total,
                c.unread_routes
            ),
            (40, 0, 0, 40, 0)
        );
        // Offered: the directories hold the actions too (40 of 51, below the share).
        let all = candidates(&r);
        assert!(
            all.iter()
                .any(|x| x.place == api && x.ways.first().is_some_and(|w| w.id == "P-auth")),
            "{all:?}"
        );
        let conv = convention(&c);
        let now = checked(&r, &conv);
        assert!(now.not_checked.is_empty(), "{:?}", now.not_checked);
        assert!(now.violations.is_empty() && now.stale.is_empty());
        // An http handler whose route Drift could not read could be under /api.
        let mut units = r.concerns[0].units.clone();
        units.push(served("app/x/route.ts", "GET", "http", None, "P-none"));
        let r2 = report(units);
        let c2 = candidate(&r2, "P-auth", Some(&api), &[], false).unwrap();
        assert_eq!((c2.unknown, c2.unread_routes, c2.total), (1, 1, 41));
        assert_eq!(checked(&r2, &conv).not_checked[0].units, 1);
    }

    /// 36 routes in app/api wrapped in withAuth, 2 signed in by getUser, 2 with nothing.
    fn mixed_api() -> PracticesReport {
        let mut units = routes("app/api", 0, 36, "P-auth");
        units.extend(routes("app/api", 36, 2, "P-user"));
        units.extend(routes("app/api", 38, 2, "P-none"));
        report(units)
    }

    /// Pins review items 2 and 4 (area 2): the named-way, mechanism and any-enforcing
    /// practices of one place have ids of their own (the named way keeps the id every
    /// practice had, so files already written keep working), and the preview's block
    /// hint is the command of the candidate it previews, every flag of it. Before, all
    /// three shared the place's id, and the hint of a candidate of named ways dropped
    /// `--with`: run as printed, it wrote a narrower rule over the wider one.
    #[test]
    fn each_form_in_one_place_has_its_own_id_and_its_own_command() {
        let r = mixed_api();
        let place = at("", "app/api");
        let named = candidate(&r, "P-auth", Some(&place), &["P-user".to_string()], false).unwrap();
        let mech = candidate_for(
            &r,
            Some(&place),
            &Request {
                concern: AUTHN.into(),
                mechanisms: vec!["wrap".into()],
                ..Request::default()
            },
        )
        .unwrap();
        let any = candidate_for(
            &r,
            Some(&place),
            &Request {
                concern: AUTHN.into(),
                any_enforcing: true,
                ..Request::default()
            },
        )
        .unwrap();
        let (n, m, a) = (convention(&named), convention(&mech), convention(&any));
        assert_eq!(n.id, convention_id(&place, AUTHN));
        assert_eq!(m.id, practice_id(&place, AUTHN, Form::Mechanism));
        assert_eq!(a.id, practice_id(&place, AUTHN, Form::Enforcing));
        assert!(n.id != m.id && m.id != a.id && n.id != a.id);
        assert!(m.id.starts_with("D-") && m.id.len() == 8);
        // Adding a mechanism keeps the id: the form is what changes it.
        let both = candidate_for(
            &r,
            Some(&place),
            &Request {
                concern: AUTHN.into(),
                mechanisms: vec!["wrap".into(), "dependency".into()],
                ..Request::default()
            },
        )
        .unwrap();
        assert_eq!(convention(&both).id, m.id);
        assert_eq!(form_of(&n), Some(Form::Ways));
        assert_eq!(form_of(&a), Some(Form::Enforcing));
        assert!(is_practice_of(&m, &place, AUTHN, Form::Mechanism));
        assert!(!is_practice_of(&m, &place, AUTHN, Form::Ways));
        // Each hint is the candidate's own command, with --block.
        for (c, conv, want) in [
            (
                &named,
                &n,
                "`drift practices promote P-auth --in app/api --with P-user --block`",
            ),
            (
                &mech,
                &m,
                "`drift practices promote --concern authn --in app/api --mechanism wrap --block`",
            ),
            (
                &any,
                &a,
                "`drift practices promote --concern authn --in app/api --any-enforcing --block`",
            ),
        ] {
            let text = preview(c, conv);
            assert!(text.contains(want), "{text}");
            assert_eq!(command(c) + " --block", want.trim_matches('`'));
        }
    }

    /// Pins that a mechanism practice written before the forms had ids of their own,
    /// under its place's id, still loads as what it is and matches its lock lines: its
    /// id is read from the file, never recomputed, and its rule from the rule.
    #[test]
    fn a_mechanism_practice_under_the_old_shared_id_keeps_its_lock_lines() {
        let r = mixed_api();
        let place = at("", "app/api");
        let mech = candidate_for(
            &r,
            Some(&place),
            &Request {
                concern: AUTHN.into(),
                mechanisms: vec!["wrap".into()],
                ..Request::default()
            },
        )
        .unwrap();
        let mut old = convention(&mech);
        old.id = convention_id(&place, AUTHN);
        let lock = Lock {
            entries: mech
                .exceptions
                .iter()
                .map(|e| (old.id.clone(), format!("{}#{}", e.path, e.symbol)))
                .collect(),
        };
        let now = check(
            &RepoFacts::default(),
            &r,
            &policy(vec![old.clone()]),
            &lock,
            Scope::Accepted,
            None,
        );
        assert_eq!(now.violations.len(), 4);
        assert!(now.violations.iter().all(|v| v.baselined && v.id == old.id));
        assert!(now.fixed.is_empty());
        assert!(is_practice_of(&old, &place, AUTHN, Form::Mechanism));
    }

    /// 20 entry points of one router file, `h00` at line 1 to `h19` at line 20: the
    /// first 16 wrapped in withAuth, the last 4 (added last) with nothing.
    fn router(n: usize, breaking: usize) -> PracticesReport {
        let units = (0..n)
            .map(|i| {
                row(
                    "app/api/router.ts",
                    &format!("h{i:02}"),
                    i as u32 + 1,
                    if i + breaking >= n {
                        "P-none"
                    } else {
                        "P-auth"
                    },
                )
            })
            .collect();
        report(units)
    }

    /// Pins review item 3 (area 2): the replay of a file place reads the units most
    /// recently added or changed in the file, each dated by its own line, never the
    /// file's first commit (which every unit of the file shares, so the tie-break read
    /// its first lines: the four handlers added last, at the bottom, were never read).
    /// A file place with fewer units than the replay reads says it cannot block.
    #[test]
    fn a_file_place_is_replayed_by_line() {
        let r = router(20, 4);
        let file = Place::file_of("", "app/api/router.ts").unwrap();
        let c = candidate(&r, "P-auth", Some(&file), &[], false).unwrap();
        assert_eq!((c.follows, c.exceptions.len()), (16, 4));
        let conv = convention(&c);
        // By the file's date alone, nothing is read.
        let by_file = replay(&r, &conv, &|_| Some(7));
        assert_eq!((by_file.recent, by_file.readable), (0, 20));
        assert!(by_file.allows_block().is_err());
        // By line: lines 6 to 20 are the 15 most recent, and 4 of them break.
        let by_line = replay_dated(&r, &conv, &|_, line| Some(i64::from(line)));
        assert_eq!(
            by_line,
            Replay {
                recent: 15,
                followed: 11,
                readable: 20,
                by_line: true,
            }
        );
        assert!(by_line.allows_block().is_err());
        assert_eq!(
            by_line.sentence("entry_point"),
            "of the last 15 entry points added or changed here, 11 follow it as they stand"
        );
        // A file of 10: it qualifies, and can never be replayed; it says so.
        let small = router(10, 0);
        let c = candidate(&small, "P-auth", Some(&file), &[], false).unwrap();
        let conv = convention(&c);
        let why = replay_dated(&small, &conv, &|_, line| Some(i64::from(line)))
            .allows_block()
            .unwrap_err();
        assert!(why.contains("its place holds only 10"), "{why}");
        assert!(
            why.contains("cannot block until the place holds 15"),
            "{why}"
        );
        let text = preview(&c, &conv);
        assert!(text.contains("It cannot block"), "{text}");
        assert!(text.contains("Drift can read only 10 here"), "{text}");
    }

    /// Pins review item 5 (area 2): a route prefix is read in its canonical form,
    /// whatever the file says, so a hand-edited `/api/v2/` or `/api/:id` holds the
    /// units `/api/v2` and `/api/[*]` do. Before, it was used verbatim as the place key:
    /// it held nothing and the practice was stale for good.
    #[test]
    fn a_route_prefix_is_read_in_its_canonical_form() {
        assert_eq!(canonical_route("/api/v2/").as_deref(), Some("/api/v2"));
        assert_eq!(canonical_route("/api/:id").as_deref(), Some("/api/[*]"));
        assert_eq!(canonical_route("api/{id}/x").as_deref(), Some("/api/[*]/x"));
        assert_eq!(
            canonical_route("/api/<int:id>").as_deref(),
            Some("/api/[*]")
        );
        assert_eq!(canonical_route("/api/*"), None);
        assert_eq!(canonical_route("/"), None);
        let units: Vec<UnitRow> = (0..10)
            .map(|i| {
                served(
                    &format!("app/api/[id]/r{i}/route.ts"),
                    "GET",
                    "http",
                    Some(format!("/api/[id]/r{i}").as_str()),
                    "P-auth",
                )
            })
            .collect();
        let r = report(units);
        let place = Place::parse(".:/api/[id]", &r).unwrap();
        let c = candidate(&r, "P-auth", Some(&place), &[], false).unwrap();
        for edited in ["/api/:id", "/api/{id}/", "api/[id]"] {
            let mut conv = convention(&c);
            if let Rule::Practice { under_route, .. } = &mut conv.rule {
                *under_route = Some(edited.into());
            }
            assert_eq!(place_of(&conv), Some(place.clone()), "{edited}");
            let now = checked(&r, &conv);
            assert!(now.stale.is_empty(), "{edited}: {:?}", now.stale);
        }
        // One that is no literal prefix holds nothing: stale, it fires on nothing.
        let mut conv = convention(&c);
        if let Rule::Practice { under_route, .. } = &mut conv.rule {
            *under_route = Some("/api/*".into());
        }
        assert_eq!(checked(&r, &conv).stale.len(), 1);
    }
}
