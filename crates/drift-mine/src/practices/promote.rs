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
//! Deterministic: everything is read in report order and sorted.

use std::collections::BTreeSet;

use drift_core::RepoFacts;
use serde::{Deserialize, Serialize};

use super::depart::PLACE_SHARE;
use super::{Example, PracticesReport};
use crate::check::{Scope, Violation};
use crate::mine::MIN_ROLE_SIZE;
use crate::policy::{Convention, ConventionsFile, Lock};

/// The largest share of a place's units that may be unknown for a practice to be
/// promoted there: Drift cannot hold code to what it cannot read.
pub const MAX_UNKNOWN_SHARE: f64 = 0.2;

/// The share of a place's readable units the accepted ways must hold for a promoted
/// practice to block ([`PLACE_SHARE`]): one promoted below it advises, whatever its mode.
pub const BLOCK_SHARE: f64 = PLACE_SHARE;

/// How many of the units most recently added to a place [`replay`] reads.
pub const REPLAY_UNITS: usize = crate::mine::MIN_BLOCK_ROLE_SIZE;

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
    /// More than [`MAX_UNKNOWN_SHARE`] of the place is unknown. Never forced.
    TooUnknown {
        place: String,
        unknown: usize,
        total: usize,
    },
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
    pub fn parse(_text: &str, _report: &PracticesReport) -> Option<Place> {
        unimplemented!()
    }

    /// The place as output names it: the path from the repository root (`apps/api/views`),
    /// `.` for the root package.
    pub fn shown(&self) -> String {
        unimplemented!()
    }

    /// Whether the file at the repo-relative `path` (of the package `package`) is in
    /// the place.
    pub fn holds(&self, _package: &str, _path: &str) -> bool {
        unimplemented!()
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, _f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        unimplemented!()
    }
}

impl Refusal {
    /// Whether a person's `force` lifts it ([`Refusal::BelowShare`] only).
    pub fn forceable(&self) -> bool {
        matches!(self, Refusal::BelowShare { .. })
    }
}

/// Every practice that may be promoted as the code stands, without `force`: for each
/// known variant, its broadest qualifying place (a directory is listed only where its
/// package does not qualify). Sorted by concern (in [`super::CONCERNS`] order), place
/// and variant id. `report` must list its units ([`super::Options::units`]).
pub fn candidates(_report: &PracticesReport) -> Vec<Candidate> {
    unimplemented!()
}

/// What promoting the variant `id` would record. `place`: where (`None`: its broadest
/// qualifying place). `with`: other variants of the same concern accepted as ways with
/// it. `force`: promote below [`PLACE_SHARE`]. `report` must list its units.
pub fn candidate(
    _report: &PracticesReport,
    _id: &str,
    _place: Option<&Place>,
    _with: &[String],
    _force: bool,
) -> Result<Candidate, Refusal> {
    unimplemented!()
}

/// The convention promoting `c` writes: accepted by the person, advise mode, shown to
/// agents on their word ([`crate::policy::AgentsChoice::Show`]),
/// [`Convention::promoted_from_practice`] the first way's id. Its id is of the place and
/// the concern only ([`convention_id`]), so adding a way later keeps the id and its
/// lock entries.
pub fn convention(_c: &Candidate) -> Convention {
    unimplemented!()
}

/// The id of the promoted practice of `concern` in `place`: `D-` and 6 hex digits.
pub fn convention_id(_place: &Place, _concern: &str) -> String {
    unimplemented!()
}

/// The place a promoted practice holds in (its role's package and directory); `None`
/// for any other convention.
pub fn place_of(_c: &Convention) -> Option<Place> {
    unimplemented!()
}

/// What a person reads before the practice is written (and what the command prints):
/// how many follow, the exceptions recorded as they are (at most 3 named), what could
/// not be read, what `drift check` reports from now on, the mode and how to change it,
/// and the other ways that could be added. Ends with a newline.
pub fn preview(_c: &Candidate, _convention: &Convention) -> String {
    unimplemented!()
}

/// What the promoted practices of `policy` in `scope` say of the code. `report` must
/// list its units; `repo` gives each unit's `drift-ignore` comments and extent.
/// `only_paths` restricts which files are reported.
pub fn check(
    _repo: &RepoFacts,
    _report: &PracticesReport,
    _policy: &ConventionsFile,
    _lock: &Lock,
    _scope: Scope,
    _only_paths: Option<&BTreeSet<String>>,
) -> Checked {
    unimplemented!()
}

/// The lock entries that record every unit breaking a promoted practice of `policy`
/// today (every one not rejected), as [`crate::check::baseline`] does for the rest.
pub fn baseline(
    _repo: &RepoFacts,
    _report: &PracticesReport,
    _policy: &ConventionsFile,
) -> BTreeSet<(String, String)> {
    unimplemented!()
}

/// Whether any convention of `policy` in `scope` is a promoted practice: only then is
/// the map needed to check it.
pub fn any(policy: &ConventionsFile, scope: Scope) -> bool {
    policy.conventions.iter().any(|c| {
        c.rule.is_practice()
            && match scope {
                Scope::Accepted => c.status == crate::policy::Status::Accepted,
                Scope::All => c.status != crate::policy::Status::Rejected,
            }
    })
}

/// Of the [`REPLAY_UNITS`] units most recently added to the place of the promoted
/// practice `c` that the map can tell, how many follow it as they stand. `added`: when
/// the file at a repo-relative path was first committed (seconds since the epoch;
/// `None` when unknown, and such a unit is not read). Ties are broken by path, line.
pub fn replay(
    _report: &PracticesReport,
    _c: &Convention,
    _added: &dyn Fn(&str) -> Option<i64>,
) -> Replay {
    unimplemented!()
}

impl Replay {
    /// Whether the replay lets the practice block: [`REPLAY_UNITS`] units were read and
    /// at least [`PLACE_SHARE`] of them follow. `Err` is the sentence a person reads.
    pub fn allows_block(&self) -> Result<(), String> {
        unimplemented!()
    }

    /// The evidence as a person reads it: "of the last 15 entry points added here, 14
    /// follow it as they stand".
    pub fn sentence(&self, _unit: &str) -> String {
        unimplemented!()
    }
}

const _: (f64, usize) = (PLACE_SHARE, MIN_ROLE_SIZE);
