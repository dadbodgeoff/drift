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
//! Deterministic: everything is read in report order and sorted.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use drift_core::ingest::Lang;
use drift_core::{FileFacts, RepoFacts, SymbolKind};
use serde::{Deserialize, Serialize};

use super::depart::PLACE_SHARE;
use super::{
    CONCERNS, Concern, ConcernReport, Example, PracticesReport, Promotable, TAIL, UnitRow, Variant,
    VariantKind, plain_concern, plain_way,
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
            } => write!(
                f,
                "In {}, Drift cannot tell how {unknown} of the {total} do it ({}%, more than {}%): it cannot hold code to what it cannot read. `drift practices --hints` prints the .drift/config.yaml lines that would let Drift read them.",
                sanitize(place, 160),
                pct(*unknown, *total),
                share_pct(MAX_UNKNOWN_SHARE)
            ),
        }
    }
}

impl Refusal {
    /// Whether a person's `force` lifts it ([`Refusal::BelowShare`] only).
    pub fn forceable(&self) -> bool {
        matches!(self, Refusal::BelowShare { .. })
    }
}

/// The keys a way accepts: a folded policy's (`any_of(A|B)`) are its alternatives'
/// keys, `A` and `B`; any other way's is its own key.
fn way_keys(key: &str) -> Vec<String> {
    if let Some(inner) = key
        .strip_prefix("any_of(")
        .and_then(|k| k.strip_suffix(')'))
        && let Some((a, b)) = inner.split_once('|')
        && !b.contains('|')
    {
        return vec![a.to_string(), b.to_string()];
    }
    vec![key.to_string()]
}

/// Whether `k` is one of `keys`.
fn in_keys(keys: &[String], k: &str) -> bool {
    keys.iter().any(|x| x == k)
}

/// Every key the ways accept.
fn accepted_keys(ways: &[&Variant]) -> BTreeSet<String> {
    ways.iter().flat_map(|v| way_keys(&v.key)).collect()
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

/// One concern of a report read for promotion: each row's own way and each place's
/// rows.
struct Reading<'a> {
    c: &'a ConcernReport,
    /// Each row's own way's key; `None` for a row the map gives no known way.
    own: Vec<Option<&'a str>>,
    /// The rows of each place a row is in.
    places: BTreeMap<Place, Vec<usize>>,
}

impl<'a> Reading<'a> {
    fn new(c: &'a ConcernReport) -> Self {
        let keys: BTreeMap<&'a str, &'a str> = c
            .variants
            .iter()
            .map(|v| (v.id.as_str(), v.key.as_str()))
            .collect();
        // A unit's own uses, where its variant stands for several ways; the variant's
        // key otherwise.
        let own = c
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
        let mut places: BTreeMap<Place, Vec<usize>> = BTreeMap::new();
        for (i, u) in c.units.iter().enumerate() {
            for p in places_of(&u.package, &u.path) {
                places.entry(p).or_default().push(i);
            }
        }
        Reading { c, own, places }
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

    /// Whether row `i` is known to do it one of `keys`.
    fn uses(&self, i: usize, keys: &[String]) -> bool {
        self.c.units[i].assignment == "known" && self.own[i].is_some_and(|k| in_keys(keys, k))
    }

    /// Each row's verdict against `accepted`.
    fn verdicts(&self, accepted: &BTreeSet<String>) -> Vec<Verdict> {
        self.c
            .units
            .iter()
            .zip(&self.own)
            .map(|(u, own)| match (u.assignment.as_str(), own) {
                ("unknown", _) => Verdict::Unknown,
                ("known", Some(k)) if accepted.contains(*k) => Verdict::Follows,
                ("known", Some(_)) => Verdict::Breaks,
                ("known", None) => Verdict::Unknown,
                _ => Verdict::Breaks,
            })
            .collect()
    }

    /// The units of `place` with their verdicts, each unit once (its mounts together),
    /// sorted by path, line and symbol.
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
                });
            j.line = j.line.min(u.line);
            if verdict > j.verdict {
                j.verdict = verdict;
                j.own = own;
            }
        }
        let mut out: Vec<Judged<'a>> = by.into_values().collect();
        out.sort_by(|a, b| (a.path, a.line, a.symbol).cmp(&(b.path, b.line, b.symbol)));
        out
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
    let keys = way_keys(&v.key);
    if !(0..r.c.units.len()).any(|i| r.uses(i, &keys)) {
        return Err(
            "no unit Drift read is known to do it this way (a way declared in .drift/config.yaml is one once a unit uses it)"
                .to_string(),
        );
    }
    Ok(())
}

/// Whether `v` may qualify anywhere: a way, used by enough units that some place could
/// hold [`PLACE_SHARE`] of [`MIN_ROLE_SIZE`] of them. Saves reading every place of a
/// variant of two units.
fn may_qualify(r: &Reading<'_>, v: &Variant) -> bool {
    if is_way(r, v).is_err() {
        return false;
    }
    let keys = way_keys(&v.key);
    let rows = (0..r.c.units.len()).filter(|&i| r.uses(i, &keys)).count();
    rows as f64 >= PLACE_SHARE * MIN_ROLE_SIZE as f64
}

/// Whether a place with these counts may be promoted in: `Ok(true)` when only `force`
/// lets it (below the share).
fn eligible(
    place: &Place,
    follows: usize,
    breaks: usize,
    unknown: usize,
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

/// The candidate of `ways` in `place`, from its units' verdicts (`judged`).
fn build_from(
    r: &Reading<'_>,
    ways: &[&Variant],
    place: &Place,
    judged: &[Judged<'_>],
    force: bool,
) -> Result<Candidate, Refusal> {
    let count = |v: Verdict| judged.iter().filter(|j| j.verdict == v).count();
    let (follows, breaks, unknown) = (
        count(Verdict::Follows),
        count(Verdict::Breaks),
        count(Verdict::Unknown),
    );
    let forced = eligible(place, follows, breaks, unknown, force)?;
    let way_of = |v: &Variant| -> Way {
        let keys = way_keys(&v.key);
        Way {
            id: v.id.clone(),
            key: v.key.clone(),
            label: v.label.clone(),
            members: judged
                .iter()
                .filter(|j| {
                    j.verdict == Verdict::Follows && j.own.is_some_and(|k| in_keys(&keys, k))
                })
                .count(),
        }
    };
    // The ways the units that break it use, by the variant of their own way.
    let taken: BTreeSet<&str> = ways.iter().map(|v| v.id.as_str()).collect();
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
            })
            .members += 1;
    }
    let mut other_ways: Vec<Way> = others.into_values().collect();
    other_ways.sort_by(|a, b| b.members.cmp(&a.members).then(a.id.cmp(&b.id)));
    Ok(Candidate {
        concern: r.c.id.clone(),
        unit: r.c.unit.clone(),
        place: place.clone(),
        ways: ways.iter().map(|&v| way_of(v)).collect(),
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
    })
}

/// The places `ways` may be promoted in, broadest first (a whole package before a
/// directory, then more units that follow, then by place), and, when there is none,
/// why the nearest does not qualify (the place where most units follow, broadest
/// first). Only places where some unit follows are read.
fn qualifying(
    r: &Reading<'_>,
    ways: &[&Variant],
    force: bool,
) -> (Vec<Candidate>, Option<Refusal>) {
    let verdicts = r.verdicts(&accepted_keys(ways));
    let places: BTreeSet<Place> =
        r.c.units
            .iter()
            .zip(&verdicts)
            .filter(|(_, v)| **v == Verdict::Follows)
            .flat_map(|(u, _)| places_of(&u.package, &u.path))
            .collect();
    let mut ok: Vec<Candidate> = Vec::new();
    let mut nearest: Option<(usize, usize, Refusal)> = None;
    for place in &places {
        let judged = r.judged(place, &verdicts);
        let follows = judged
            .iter()
            .filter(|j| j.verdict == Verdict::Follows)
            .count();
        match build_from(r, ways, place, &judged, force) {
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

/// The candidates of one concern ([`candidates`]).
fn concern_candidates(c: &ConcernReport) -> Vec<Candidate> {
    let r = Reading::new(c);
    let mut out = Vec::new();
    for v in c.variants.iter().filter(|v| may_qualify(&r, v)) {
        let (ok, _) = qualifying(&r, &[v], false);
        let places: Vec<Place> = ok.iter().map(|c| c.place.clone()).collect();
        // A directory only where no place around it qualifies.
        out.extend(
            ok.into_iter()
                .filter(|c| !places.iter().any(|p| *p != c.place && p.contains(&c.place))),
        );
    }
    out
}

/// Fills each variant's [`Variant::promotable`] of a concern whose report lists every
/// unit (the engine, before it drops the rows a report does not list): set exactly for
/// the variants [`candidates`] lists, with the broadest place [`candidate`] picks
/// without `--in`. An alternative of a fold is promoted with its fold (or by its own
/// id): it carries none.
pub(super) fn fill_promotable(c: &mut ConcernReport) {
    let places: BTreeMap<String, String> = {
        let r = Reading::new(c);
        c.variants
            .iter()
            .filter(|v| may_qualify(&r, v))
            .filter_map(|v| {
                qualifying(&r, &[v], false)
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
/// package does not qualify). Sorted by concern (in [`super::CONCERNS`] order), place
/// and variant id. `report` must list its units ([`super::Options::units`]).
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
    out.sort_by(|a, b| (rank(a), &a.place, first(a)).cmp(&(rank(b), &b.place, first(b))));
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
pub fn candidate(
    report: &PracticesReport,
    id: &str,
    place: Option<&Place>,
    with: &[String],
    force: bool,
) -> Result<Candidate, Refusal> {
    let Some((c, first)) = find(report, id) else {
        return Err(Refusal::UnknownVariant { id: id.to_string() });
    };
    let r = Reading::new(c);
    is_way(&r, first).map_err(|why| Refusal::NotAWay {
        id: id.to_string(),
        why,
    })?;
    let mut ways: Vec<&Variant> = vec![first];
    for w in with {
        if ways.iter().any(|v| v.id == *w) {
            continue;
        }
        let v = match find(report, w) {
            None => return Err(Refusal::UnknownVariant { id: w.clone() }),
            Some((other, _)) if other.id != c.id => {
                return Err(Refusal::OtherConcern {
                    id: w.clone(),
                    concern: other.id.clone(),
                });
            }
            Some(_) => r
                .variant(w)
                .ok_or_else(|| Refusal::UnknownVariant { id: w.clone() })?,
        };
        is_way(&r, v).map_err(|why| Refusal::NotAWay { id: w.clone(), why })?;
        ways.push(v);
    }
    match place {
        Some(p) => {
            let verdicts = r.verdicts(&accepted_keys(&ways));
            let judged = r.judged(p, &verdicts);
            build_from(&r, &ways, p, &judged, force)
        }
        None => {
            let (ok, nearest) = qualifying(&r, &ways, force);
            ok.into_iter().next().ok_or_else(|| Refusal::NoPlace {
                id: id.to_string(),
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
/// lock entries.
pub fn convention(c: &Candidate) -> Convention {
    let mut any_of: Vec<String> = c.ways.iter().flat_map(|w| way_keys(&w.key)).collect();
    any_of.sort();
    any_of.dedup();
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
            labels(&c.ways)
        ),
        role: role_of(&c.place),
        rule: Rule::Practice {
            concern: c.concern.clone(),
            any_of,
            any_mechanism: Vec::new(),
            any_enforcing: false,
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
/// memory from the content an agent is about to write.
pub fn covers_file(c: &Convention, f: &FileFacts) -> bool {
    covers(c, &f.package, &f.path, |unit| declares_unit(unit, f))
}

/// What a promoted practice applies to in a file whose content is not known yet, said
/// before its rule ("for its entry points"); `None` for any other convention. A file of
/// the place that declares none is not held to it.
pub fn condition(c: &Convention) -> Option<String> {
    let Rule::Practice { concern, .. } = &c.rule else {
        return None;
    };
    Some(format!("for its {}", units_word(unit_of(concern)?, 2)))
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
        labels(&c.ways),
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
    out.push_str(&format!(
        "From now on `drift check` reports a new {} here that does it another way, or not at all.\n",
        units_word(&c.unit, 1)
    ));
    let first = c.ways.first().map_or("", |w| w.id.as_str());
    let block = format!(
        "`drift practices promote {} --in {place} --block` makes it fail one, when the {} {} added here most recently follow it",
        sanitize(first, 40),
        REPLAY_UNITS,
        units_word(&c.unit, REPLAY_UNITS)
    );
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
/// says; a practice of a concern `report` does not have is not read at all.
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
        let (Rule::Practice {
            concern, any_of, ..
        }, Some(place)) = (&c.rule, place_of(c)) else {
            continue;
        };
        let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
            continue;
        };
        let r = Reading::new(cr);
        let accepted: BTreeSet<String> = any_of.iter().cloned().collect();
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
                mode: crate::check::effective_mode(c).into(),
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
    let (Rule::Practice {
            concern, any_of, ..
        }, Some(place)) = (&c.rule, place_of(c)) else {
        return Replay::default();
    };
    let Some(cr) = report.concerns.iter().find(|x| x.id == *concern) else {
        return Replay::default();
    };
    let r = Reading::new(cr);
    let accepted: BTreeSet<String> = any_of.iter().cloned().collect();
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
        let listed: Vec<(String, String)> = candidates(&r)
            .iter()
            .map(|c| (c.ways[0].id.clone(), c.place.shown()))
            .collect();
        assert_eq!(
            listed,
            [
                ("P-auth".to_string(), "app".to_string()),
                ("P-user".to_string(), "lib".to_string())
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
        assert_eq!(condition(&conv).as_deref(), Some("for its entry points"));
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
    }
}
