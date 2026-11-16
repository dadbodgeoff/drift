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

/// Where a promoted practice holds: a package, or one directory of it.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Place {
    /// The package directory ("" the root package).
    pub package: String,
    /// The directory below the package ("" the whole package), without a trailing
    /// slash: a unit is in the place when its file is in this directory or below it.
    pub dir: String,
}

/// One way of doing a concern in a place: a known variant of the map.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Way {
    /// The variant's id (`P-…`).
    pub id: String,
    /// Its key ([`super::VariantKey::key`]): what the rule stores.
    pub key: String,
    pub label: String,
    /// The units of the place that do it this way.
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
    /// left to the framework, logs to the language's own output): new code follows it
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
}

impl Place {
    /// A place as a person names it (`--in`): a path from the repository root, read
    /// against the packages of `report` (the longest package that holds it wins; the
    /// rest is the directory). `.` or "" is the root package. `None` when the path has
    /// a `..` segment or is absolute.
    pub fn parse(text: &str, report: &PracticesReport) -> Option<Place> {
        let text = text.trim();
        if text.starts_with('/') || std::path::Path::new(text).is_absolute() {
            return None;
        }
        let mut segs: Vec<&str> = Vec::new();
        for s in text.split('/') {
            match s {
                "" | "." => {}
                ".." => return None,
                s => segs.push(s),
            }
        }
        let path = segs.join("/");
        let packages: BTreeSet<&str> = report
            .concerns
            .iter()
            .flat_map(|c| {
                c.units
                    .iter()
                    .map(|u| u.package.as_str())
                    .chain(c.by_package.iter().map(|p| p.package.as_str()))
            })
            .collect();
        let package = packages
            .into_iter()
            .filter(|p| p.is_empty() || path == *p || path.starts_with(&format!("{p}/")))
            .max_by_key(|p| p.len())
            .unwrap_or("");
        let dir = path
            .strip_prefix(package)
            .unwrap_or(&path)
            .trim_start_matches('/')
            .to_string();
        Some(Place {
            package: package.to_string(),
            dir,
        })
    }

    /// The place as output names it: the path from the repository root (`apps/api/views`),
    /// `.` for the root package.
    pub fn shown(&self) -> String {
        match (self.package.is_empty(), self.dir.is_empty()) {
            (true, true) => ".".to_string(),
            (true, false) => self.dir.clone(),
            (false, true) => self.package.clone(),
            (false, false) => format!("{}/{}", self.package, self.dir),
        }
    }

    /// Whether the file at the repo-relative `path` (of the package `package`) is in
    /// the place.
    pub fn holds(&self, package: &str, path: &str) -> bool {
        package == self.package
            && (self.dir.is_empty()
                || dir_below(package, path).is_some_and(|d| within(d, &self.dir)))
    }

    /// How deep the place is below its package: 0 for the whole package.
    fn depth(&self) -> usize {
        if self.dir.is_empty() {
            0
        } else {
            self.dir.split('/').count()
        }
    }

    /// Whether `other` is this place or a directory inside it.
    fn contains(&self, other: &Place) -> bool {
        self.package == other.package && (self.dir.is_empty() || within(&other.dir, &self.dir))
    }

    /// The place in a sentence: its path, or "the root package".
    fn words(&self) -> String {
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
        });
    }
    out
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
    /// The counted rows of each place a row is in.
    places: BTreeMap<Place, Vec<usize>>,
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
                    && u
                        .enforces
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
        for (i, u) in c.units.iter().enumerate() {
            for p in places_of(&u.package, &u.path) {
                if counted[i] {
                    places.entry(p).or_default().push(i);
                } else {
                    jobs.entry(p)
                        .or_default()
                        .insert((u.path.as_str(), u.symbol.as_str()));
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
                uses.iter().any(|u| of(*u))
            } else {
                uses.iter().all(|u| of(*u))
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
        let mut by: BTreeMap<(&'a str, &'a str), Judged<'a>> = BTreeMap::new();
        for &i in rows {
            let u: &'a UnitRow = &c.units[i];
            let (verdict, own) = (verdicts[i], self.own[i]);
            let j = by
                .entry((u.path.as_str(), u.symbol.as_str()))
                .or_insert(Judged {
                    path: &u.path,
                    symbol: &u.symbol,
                    line: u.line,
                    verdict,
                    own,
                    row: i,
                });
            j.line = j.line.min(u.line);
            if verdict > j.verdict {
                j.verdict = verdict;
                j.own = own;
                j.row = i;
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
            .flat_map(|i| self.uses[i].iter().map(|k| mechanism_of(*k)))
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
    let verdicts = r.verdicts(&asked.accepts());
    let places: Vec<&Place> = r
        .places
        .iter()
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

/// The candidates of one concern ([`candidates`]): each way in its broadest qualifying
/// places; then each mechanism whole that may enforce the concern; then any enforcing
/// way. A broader candidate is offered only where it covers materially more than the
/// narrower ones ([`broader_offered`]).
fn concern_candidates(c: &ConcernReport) -> Vec<Candidate> {
    let r = Reading::new(c);
    let mut out: Vec<Candidate> = Vec::new();
    for v in c.variants.iter().filter(|v| may_qualify_way(&r, v)) {
        let asked = Asked {
            ways: vec![v],
            ..Asked::default()
        };
        out.extend(broadest(qualifying(&r, &asked, false).0));
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
        if !may_qualify(&r, &asked.accepts()) {
            continue;
        }
        by_mechanism.extend(
            broadest(qualifying(&r, &asked, false).0)
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
        if may_qualify(&r, &asked.accepts()) {
            let enforcing: Vec<Candidate> = broadest(qualifying(&r, &asked, false).0)
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
                return Err(Refusal::UnknownVariant {
                    id: (*id).clone(),
                });
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

/// What a candidate accepts, as a person reads it: its ways ([`labels`]), each
/// mechanism whole ("by any dependency"), and any enforcing way, joined with ", or ".
fn accepted_words(c: &Candidate) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !c.ways.is_empty() {
        parts.push(labels(&c.ways));
    }
    for m in &c.mechanisms {
        parts.push(format!("by any {}", sanitize(&m.replace('_', " "), 60)));
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
/// [`Convention::promoted_from_practice`] the first way's id. Its id is of the place and
/// the concern only ([`convention_id`]), so adding a way later keeps the id and its
/// lock entries. A mechanism accepted whole and any enforcing way are written as the
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
        id: convention_id(&c.place, &c.concern),
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
    let h =
        blake3::hash(format!("practice\0{}\0{}\0{concern}", place.package, place.dir).as_bytes());
    format!("D-{}", &h.to_hex()[..6])
}

/// The place a promoted practice holds in (its role's package and directory); `None`
/// for any other convention.
pub fn place_of(c: &Convention) -> Option<Place> {
    if !c.rule.is_practice() {
        return None;
    }
    let dir = if c.role.dir == PACKAGE_WIDE || c.role.dir == "." {
        String::new()
    } else {
        c.role.dir.trim_end_matches('/').to_string()
    };
    Some(Place {
        package: c.role.package.clone(),
        dir,
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
    Some(format!("for its {}{request}", units_word(unit, 2)))
}

/// What one unit of a concern is called, `n` of them (`entry_point`: "entry points").
fn units_word(unit: &str, n: usize) -> String {
    let one = match unit {
        "entry_point" => "entry point".to_string(),
        "catch" => "catch clause".to_string(),
        "test_file" => "test file".to_string(),
        other => other.replace('_', " "),
    };
    if n == 1 { one } else { format!("{one}s") }
}

/// What a person reads before the practice is written (and what the command prints):
/// how many follow, the exceptions recorded as they are (at most 3 named), what could
/// not be read, what `drift check` reports from now on, the mode and how to change it,
/// and the other ways that could be added. Ends with a newline.
pub fn preview(c: &Candidate, convention: &Convention) -> String {
    let place = sanitize(&c.place.shown(), 160);
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
    let block = match c.ways.first() {
        Some(w) => format!(
            "`drift practices promote {} --in {place} --block` makes it fail one, when the {} {} added here most recently follow it",
            sanitize(&w.id, 40),
            REPLAY_UNITS,
            units_word(&c.unit, REPLAY_UNITS)
        ),
        None => format!(
            "`drift review --block {}` makes it fail one, when the {} {} added here most recently follow it",
            sanitize(&convention.id, 40),
            REPLAY_UNITS,
            units_word(&c.unit, REPLAY_UNITS)
        ),
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
        let accepted = Accepts::of_rule(any_of, any_mechanism, *any_enforcing);
        let judged = r.judged(&place, &r.verdicts(&accepted));
        if !judged.iter().any(|j| j.verdict == Verdict::Follows) {
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
        let mode = if (follows as f64) < BLOCK_SHARE * (follows + breaks) as f64 {
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
                mode: mode.into(),
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
pub fn replay(
    report: &PracticesReport,
    c: &Convention,
    added: &dyn Fn(&str) -> Option<i64>,
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
    let accepted = Accepts::of_rule(any_of, any_mechanism, *any_enforcing);
    let judged = r.judged(&place, &r.verdicts(&accepted));
    let mut dated: Vec<(i64, &Judged<'_>)> = judged
        .iter()
        .filter(|j| j.verdict != Verdict::Unknown)
        .filter_map(|j| added(j.path).map(|t| (t, j)))
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
    }
}

impl Replay {
    /// Whether the replay lets the practice block: [`REPLAY_UNITS`] units were read and
    /// at least [`PLACE_SHARE`] of them follow. `Err` is the sentence a person reads.
    pub fn allows_block(&self) -> Result<(), String> {
        if self.recent < REPLAY_UNITS {
            let why = if self.recent == 0 {
                " (no git history, or no unit whose file's first commit is known)".to_string()
            } else {
                String::new()
            };
            return Err(format!(
                "block mode needs the {REPLAY_UNITS} most recently added to the place that Drift can read, dated by the commit that first added their file; it found {}{why}",
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
            "of the last {} {} added here, {} follow it as they stand",
            self.recent,
            units_word(unit, self.recent),
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
        let checked = check(
            &RepoFacts::default(),
            &renamed,
            &policy(vec![conv.clone()]),
            &Lock::default(),
            Scope::Accepted,
            None,
        );
        assert!(checked.violations.is_empty());
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
                followed: 13
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
                followed: 15
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
                followed: 12
            }
            .allows_block()
            .is_ok()
        );
        assert!(
            Replay {
                recent: 15,
                followed: 11
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
    fn report_of(concern: &str, unit: &str, vs: Vec<Variant>, units: Vec<UnitRow>) -> PracticesReport {
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
    /// one that does `withAuth` and checks more besides.
    fn signin_variants() -> Vec<Variant> {
        let mut vs = variants();
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
            }
        );
        assert_eq!(conv.summary, "Sign-in in the root package: by any wrap");
        assert_eq!(conv.promoted_from_practice, None);
        assert!(preview(&c, &conv).contains(&format!("`drift review --block {}`", conv.id)));
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
            vec![variant("P-err", "throw:HTTPException", "throw", VariantKind::Known)],
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
        assert!(all.iter().all(|c| !c.mechanisms.contains(&"opens".to_string())), "{all:?}");
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
        assert_eq!((c.follows, c.exceptions.len(), c.total, c.jobs), (10, 0, 10, 5));
        assert!(preview(&c, &convention(&c)).contains("5 background jobs take no request"));
        let conv = convention(&c);
        let mut units = r.concerns[0].units.clone();
        units.push(job(9));
        assert!(checked(&signin(units), &conv).violations.is_empty());
        // The same units of a concern that does not need a caller are counted.
        let errors = report_of(
            crate::practices::ERRORS,
            "entry_point",
            vec![variant("P-err", "throw:HTTPException", "throw", VariantKind::Known)],
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

    /// Pins passive ways: errors left to the framework and logs to the console are what
    /// code does by doing nothing; a way someone chose is not.
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
        assert!(!candidate(&errors, "P-err", None, &[], false).unwrap().passive);
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
        assert!(candidate(&logging, "P-console", None, &[], false).unwrap().passive);
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
        let replaced = checked(&signin(routes("app/api", 0, 10, "P-user")), &conv);
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
        let gone = checked(&signin(units), &conv);
        assert!(gone.violations.is_empty());
        assert_eq!(gone.stale.len(), 1);
        // The replay reads the same rule.
        let back = replay(&signin(routes("app/api", 0, 15, "P-auth")), &conv, &|_| Some(1));
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
        let refused = candidate(&r, "P-auth", Some(&at("", "backend/app/api/routes")), &[], false)
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
        assert_eq!((cause.reason, cause.units), (UnknownReason::BodyUnreadable, 3));
        assert!(refused.to_string().contains("one cause outside them"), "{refused}");
        assert!(!refused.to_string().contains("--hints"), "{refused}");
        // Two causes: none is shared, the refusal is as before.
        let mut other = unread(3);
        other.instrument = "lib/x.ts#helper".into();
        units.push(other);
        let refused = candidate(&signin(units), "P-auth", Some(&at("", "backend/app/api/routes")), &[], false)
            .unwrap_err();
        assert!(matches!(refused, Refusal::TooUnknown { cause: None, .. }), "{refused:?}");
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
}
