//! Proposals from the map at `drift init`, `drift census --from-map` and `drift review`:
//! the practices the practice map shows a place already does one way
//! ([`drift_mine::practices::promote::candidates`]) and the layering the structure map
//! shows ([`drift_mine::from_map::layering`]), written as conventions with
//! `from_map` set, `status: proposed`, `mode: advise`. They did not go through the
//! miner's measured gates, and every line that shows one says so.
//!
//! Nothing here is enforced or reaches an agent until a person accepts it: a proposed
//! practice is written with no agents choice (a proposal with `agents: show` would be
//! shown, `drift_mine::admission`), is never baselined into `drift.lock` while it is
//! proposed, and `drift check` reads accepted practices only. Accepting one writes what
//! `drift practices promote` writes (the engine's convention, accepted, and one lock
//! line per unit that differs today, from the engine's baseline); declining records it
//! rejected, so it is not offered again. Units Drift could not read are said, never
//! counted against the rule. Python proposals follow `proposals.python`
//! ([`drift_mine::policy::python_proposals`]): withheld while it is off.
//!
//! `crate::promote` keeps `written` and `insert` private; [`written`] and [`insert`]
//! here are copies of them, kept the same on purpose.

use std::borrow::Cow;
use std::collections::BTreeSet;
use std::io::{BufRead, Write};
use std::path::Path;

use anyhow::bail;
use drift_core::RepoFacts;
use drift_core::ingest::Lang;
use drift_mine::from_map::{self, LayeringEvidence, MinedRule, Proposal};
use drift_mine::mine::Rule;
use drift_mine::policy::{
    CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Lock, Mode, Status,
};
use drift_mine::practices::promote::{self, Candidate, Place, Request};
use drift_mine::practices::{CONCERNS, PRIMARY, PracticesReport};
use drift_mine::report::sanitize;
use drift_mine::roles::{FileKinds, PACKAGE_WIDE, RoleSelector};
use drift_mine::unchecked::Unchecked;
use serde_json::{Value, json};

/// At most this many practices are proposed from the map at once, strongest first.
pub const MAX_PRACTICES: usize = 8;

/// [`Convention::from_map`] of a practice proposed from the map.
pub const PRACTICE: &str = "practice";

/// [`Convention::from_map`] of a rule a lint configuration of the repository declares
/// ([`drift_mine::declared`]).
pub const DECLARED: &str = from_map::DECLARED;

/// The channel of wiring regularities ([`drift_mine::wiring_proposals`]): listed by
/// `census --from-map` as information, never written.
pub const WIRING: &str = from_map::WIRING;

/// The heading of the section `init` and `census --from-map` print.
const HEADING: &str = "From the map (not mined: these did not go through the miner's measured gates; each advises only once you accept it)";

/// Why something that qualified was not proposed.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Reason {
    /// What it accepts is what code does by doing nothing ([`Candidate::passive`]).
    Passive,
    /// A concern of the map's preview (not in [`PRIMARY`]).
    Preview,
    /// Python proposals are off (`proposals: {python: off}`).
    PythonOff,
    /// A stronger proposal of the same concern holds an overlapping place (its id).
    Overlaps(String),
    /// The miner already proposes it (the mined id).
    SameAsMined(String),
    /// The show policy would drop it from the conventions file as it is read
    /// ([`drift_mine::show::convention_kept`]), so it is not written.
    NotShown,
    /// More than may be proposed at once.
    OverCap,
}

impl Reason {
    pub fn code(&self) -> &'static str {
        match self {
            Reason::Passive => "passive",
            Reason::Preview => "preview_concern",
            Reason::PythonOff => "python_off",
            Reason::Overlaps(_) => "overlaps",
            Reason::SameAsMined(_) => "same_as_mined",
            Reason::NotShown => "not_shown",
            Reason::OverCap => "over_cap",
        }
    }

    pub fn words(&self) -> String {
        match self {
            Reason::Passive => {
                "it accepts what code does by doing nothing, so new code would follow it without trying".to_string()
            }
            Reason::Preview => "a concern the map only previews".to_string(),
            Reason::PythonOff => "Python proposals are off (`proposals: {python: off}`)".to_string(),
            Reason::Overlaps(id) => format!("{id} holds an overlapping place for the same concern"),
            Reason::SameAsMined(id) => format!("the miner already proposes it as {id}"),
            Reason::NotShown => {
                "the show policy does not show its family, so the conventions file would not keep it".to_string()
            }
            Reason::OverCap => "more than are proposed at once".to_string(),
        }
    }
}

/// A rule already in the policy or mined, said the same as a practice from the map: a
/// WrappedBy or Calls rule of an entry-point role in the place, naming the guard the map
/// classifies for one of the practice's ways. The same rule read two ways.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Twin {
    pub id: String,
    pub summary: String,
    /// `accepted` or `proposed`.
    pub status: &'static str,
}

/// What a proposal rests on.
#[derive(Debug, Clone)]
pub enum Basis {
    Practice {
        candidate: Candidate,
        /// Units the departures name (`drift_mine::practices::departures`) that it
        /// would settle: those it records as differing today.
        settles: usize,
    },
    Layering {
        evidence: LayeringEvidence,
        /// Files of the layer Drift could not read.
        unknown: usize,
    },
    /// A rule a lint configuration of the repository declares, checked against the code.
    Declared {
        evidence: drift_mine::declared::DeclaredEvidence,
    },
}

/// One proposal from the map.
#[derive(Debug, Clone)]
pub struct FromMap {
    pub convention: Convention,
    pub basis: Basis,
    pub twins: Vec<Twin>,
}

/// One that qualified and was not proposed.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Held {
    pub id: String,
    /// [`PRACTICE`] or [`from_map::LAYERING`].
    pub kind: &'static str,
    pub summary: String,
    pub reason: Reason,
}

/// The proposals from the map, and what qualified but was not proposed, with why.
#[derive(Debug, Clone, Default)]
pub struct Collected {
    pub proposals: Vec<FromMap>,
    pub held: Vec<Held>,
    /// Information from the map that is no proposal and is never written: declared
    /// restrictions another convention states or Drift cannot express, wiring
    /// regularities, instruction files ([`drift_mine::declared::Note`]).
    pub notes: Vec<drift_mine::declared::Note>,
}

/// A rule Drift already has: a convention of the policy (neither a practice nor from
/// the map, not rejected) or a mined candidate.
#[derive(Debug, Clone)]
pub struct Known<'a> {
    pub id: &'a str,
    pub role: &'a RoleSelector,
    pub rule: &'a Rule,
    pub summary: String,
    pub accepted: bool,
}

/// The rules of `policy` and `mined` a proposal is compared with, the policy's first,
/// each id once.
pub fn known<'a>(
    policy: Option<&'a ConventionsFile>,
    mined: &'a [drift_mine::mine::Candidate],
) -> Vec<Known<'a>> {
    let mut out: Vec<Known<'a>> = Vec::new();
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for c in policy.map_or(&[][..], |p| p.conventions.as_slice()) {
        if c.status == Status::Rejected || c.rule.is_practice() || c.from_map.is_some() {
            continue;
        }
        if seen.insert(&c.id) {
            out.push(Known {
                id: &c.id,
                role: &c.role,
                rule: &c.rule,
                summary: c.summary.clone(),
                accepted: c.status == Status::Accepted,
            });
        }
    }
    for c in mined {
        if seen.insert(&c.id) {
            out.push(Known {
                id: &c.id,
                role: &c.role,
                rule: &c.rule,
                summary: c.summary(),
                accepted: false,
            });
        }
    }
    out
}

/// Whether `c` is a proposal from the map a person has not decided yet.
pub fn undecided(c: &Convention) -> bool {
    c.status == Status::Proposed && c.from_map.is_some()
}

/// `policy` without the proposals from the map nobody decided yet: what `drift.lock` is
/// baselined from (a proposal is recorded only once accepted, as `drift practices
/// promote` records it), and what the promote step compares with.
pub fn left_out_of_lock(policy: &ConventionsFile) -> Cow<'_, ConventionsFile> {
    if !policy.conventions.iter().any(undecided) {
        return Cow::Borrowed(policy);
    }
    let mut p = policy.clone();
    p.conventions.retain(|c| !undecided(c));
    Cow::Owned(p)
}

/// The proposals from the map for the code as it stands. `policy`: the conventions file
/// (a proposal of an id a person decided is not made again; a practice a convention
/// already covers is not made). `known`: [`known`]. `python_on`: whether Python
/// proposals are on.
pub fn collect(
    repo: &RepoFacts,
    report: &PracticesReport,
    kinds: &FileKinds,
    known: &[Known<'_>],
    policy: Option<&ConventionsFile>,
    python_on: bool,
) -> Collected {
    let mut out = Collected::default();
    practices_into(report, known, policy, python_on, &mut out);
    layering_into(repo, kinds, known, policy, python_on, &mut out);
    declared_into(repo, kinds, known, policy, python_on, &mut out);
    out.held.sort();
    out
}

fn practices_into(
    report: &PracticesReport,
    known: &[Known<'_>],
    policy: Option<&ConventionsFile>,
    python_on: bool,
    out: &mut Collected,
) {
    let base = policy.map(|p| left_out_of_lock(p).into_owned());
    let open = crate::promote::open_candidates(report, base.as_ref());
    let departures = drift_mine::practices::departures(report, None);
    let settles = |c: &Candidate| -> usize {
        departures
            .iter()
            .filter(|d| d.concern == c.concern && c.place.holds(&d.package, &d.path))
            .flat_map(|d| d.units.iter().map(move |u| (d.path.as_str(), u.symbol.as_str())))
            .filter(|(path, symbol)| {
                c.exceptions
                    .iter()
                    .any(|e| e.path == *path && e.symbol == *symbol)
            })
            .count()
    };
    let (chosen, held) = choose(open.candidates, &settles, python_on);
    for (c, reason) in held {
        let conv = promote::convention(&c);
        out.held.push(Held {
            id: conv.id,
            kind: PRACTICE,
            summary: conv.summary,
            reason,
        });
    }
    for c in chosen {
        let convention = proposed(&c);
        let twins = twins(report, known, &c);
        let settles = settles(&c);
        out.proposals.push(FromMap {
            convention,
            basis: Basis::Practice {
                candidate: c,
                settles,
            },
            twins,
        });
    }
}

/// The convention a practice from the map is proposed as: the engine's, proposed,
/// advising, with no agents choice (nothing reaches an agent until a person accepts
/// it), `from_map: practice`.
pub fn proposed(c: &Candidate) -> Convention {
    let mut conv = promote::convention(c);
    conv.status = Status::Proposed;
    conv.mode = Mode::Advise;
    conv.agents = None;
    conv.from_map = Some(PRACTICE.to_string());
    conv
}

/// Which open candidates are proposed, strongest first (units covered, then departures
/// settled), at most [`MAX_PRACTICES`], and which are not, with why. A passive one, one
/// of a preview concern and a Python one while Python proposals are off are never
/// proposed; of two of one concern in overlapping places, the stronger is.
pub fn choose(
    candidates: Vec<Candidate>,
    settles: &dyn Fn(&Candidate) -> usize,
    python_on: bool,
) -> (Vec<Candidate>, Vec<(Candidate, Reason)>) {
    let rank = |c: &Candidate| {
        CONCERNS
            .iter()
            .position(|(id, _)| *id == c.concern)
            .unwrap_or(CONCERNS.len())
    };
    let first = |c: &Candidate| c.ways.first().map_or(String::new(), |w| w.id.clone());
    let mut scored: Vec<(Candidate, usize)> = candidates
        .into_iter()
        .map(|c| {
            let s = settles(&c);
            (c, s)
        })
        .collect();
    scored.sort_by(|(a, sa), (b, sb)| {
        let covered = |c: &Candidate| c.follows + c.exceptions.len();
        covered(b)
            .cmp(&covered(a))
            .then(sb.cmp(sa))
            .then(b.follows.cmp(&a.follows))
            .then(rank(a).cmp(&rank(b)))
            .then(a.place.cmp(&b.place))
            .then(first(a).cmp(&first(b)))
            .then(a.mechanisms.cmp(&b.mechanisms))
            .then(a.any_enforcing.cmp(&b.any_enforcing))
    });
    let mut chosen: Vec<Candidate> = Vec::new();
    let mut held: Vec<(Candidate, Reason)> = Vec::new();
    for (c, _) in scored {
        let reason = if c.passive {
            Some(Reason::Passive)
        } else if !PRIMARY.contains(&c.concern.as_str()) {
            Some(Reason::Preview)
        } else if !python_on && promote::convention(&c).language() == Lang::Python {
            Some(Reason::PythonOff)
        } else if let Some(o) = chosen
            .iter()
            .find(|o| o.concern == c.concern && places_overlap(&o.place, &c.place))
        {
            Some(Reason::Overlaps(promote::convention_id(&o.place, &o.concern)))
        } else if chosen.len() >= MAX_PRACTICES {
            Some(Reason::OverCap)
        } else {
            None
        };
        match reason {
            Some(r) => held.push((c, r)),
            None => chosen.push(c),
        }
    }
    (chosen, held)
}

/// Whether one place holds the other (one package, one directory at or below the other).
fn places_overlap(a: &Place, b: &Place) -> bool {
    a.overlaps(b)
}

/// Whether a role's directory (`app/api/[*]`, [`PACKAGE_WIDE`], `.` for the package's
/// own files) and a place's directory ("" the whole package) can hold one file.
pub fn dir_overlaps(role_dir: &str, place_dir: &str) -> bool {
    let role = role_dir.trim_end_matches('/');
    if role == PACKAGE_WIDE || role.is_empty() || place_dir.is_empty() {
        return true;
    }
    if role == "." {
        return false;
    }
    role.split('/')
        .zip(place_dir.split('/'))
        .all(|(r, p)| r == p || r.starts_with('['))
}

/// The instruments the map classifies for the ways of `c` (alternatives included).
fn instruments<'r>(report: &'r PracticesReport, c: &Candidate) -> Vec<&'r str> {
    let mut out: Vec<&str> = report
        .concerns
        .iter()
        .filter(|x| x.id == c.concern)
        .flat_map(|x| &x.variants)
        .flat_map(|v| std::iter::once(v).chain(v.alternatives.iter()))
        .filter(|v| c.ways.iter().any(|w| w.id == v.id))
        .flat_map(|v| v.instruments.iter().map(String::as_str))
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// The rules of `known` that say what `c` says: [`Twin`]. Sorted by id.
pub fn twins(report: &PracticesReport, known: &[Known<'_>], c: &Candidate) -> Vec<Twin> {
    let instruments = instruments(report, c);
    if instruments.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<Twin> = known
        .iter()
        .filter(|k| matches!(k.rule, Rule::WrappedBy { .. } | Rule::Calls { .. }))
        .filter(|k| k.role.entry != "-" && k.role.package == c.place.package)
        .filter(|k| dir_overlaps(&k.role.dir, &c.place.dir))
        .filter(|k| {
            instruments
                .iter()
                .any(|i| drift_mine::practices::rule_names(k.rule, i))
        })
        .map(|k| Twin {
            id: k.id.to_string(),
            summary: k.summary.clone(),
            status: if k.accepted { "accepted" } else { "proposed" },
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

fn layering_into(
    repo: &RepoFacts,
    kinds: &FileKinds,
    known: &[Known<'_>],
    policy: Option<&ConventionsFile>,
    python_on: bool,
    out: &mut Collected,
) {
    let rules: Vec<MinedRule<'_>> = known
        .iter()
        .map(|k| MinedRule {
            id: k.id,
            role: k.role,
            rule: k.rule,
        })
        .collect();
    let decided = |id: &str| {
        policy.is_some_and(|p| {
            p.conventions
                .iter()
                .any(|c| c.id == id && c.status != Status::Proposed)
        })
    };
    let mut kept: Vec<Proposal> = Vec::new();
    for p in from_map::layering(repo, kinds, &rules) {
        if decided(&p.convention.id) {
            continue;
        }
        let reason = if let Some(m) = &p.same_as_mined {
            Some(Reason::SameAsMined(m.clone()))
        } else if !python_on && p.convention.language() == Lang::Python {
            Some(Reason::PythonOff)
        } else if !drift_mine::show::convention_kept(&p.convention) {
            Some(Reason::NotShown)
        } else {
            None
        };
        match reason {
            Some(reason) => out.held.push(Held {
                id: p.convention.id.clone(),
                kind: from_map::LAYERING,
                summary: p.convention.summary.clone(),
                reason,
            }),
            None => kept.push(p),
        }
    }
    let (offered, _) = from_map::offered(&kept);
    let shown: BTreeSet<&str> = offered.iter().map(|p| p.convention.id.as_str()).collect();
    for p in &kept {
        if !shown.contains(p.convention.id.as_str()) {
            out.held.push(Held {
                id: p.convention.id.clone(),
                kind: from_map::LAYERING,
                summary: p.convention.summary.clone(),
                reason: Reason::OverCap,
            });
        }
    }
    let unchecked = Unchecked::of(repo);
    for p in offered {
        let prefix = format!("{}/", p.layering.layer);
        let unknown = repo
            .files
            .iter()
            .filter(|f| f.path.starts_with(&prefix) && unchecked.uncertain(&f.path))
            .count();
        out.proposals.push(FromMap {
            convention: p.convention.clone(),
            basis: Basis::Layering {
                evidence: p.layering.clone(),
                unknown,
            },
            twins: Vec::new(),
        });
    }
}

/// Rules a lint configuration of the repository declares ([`drift_mine::declared`]):
/// each Drift can check is proposed ([`Basis::Declared`]) unless a person decided its
/// id, and held as layering proposals are (Python proposals off, the show policy, more
/// than [`from_map::MAX_OFFERED`]); the rest are notes (another convention already says
/// it, or Drift cannot express it, with why).
fn declared_into(
    repo: &RepoFacts,
    kinds: &FileKinds,
    known: &[Known<'_>],
    policy: Option<&ConventionsFile>,
    python_on: bool,
    out: &mut Collected,
) {
    let rules: Vec<MinedRule<'_>> = known
        .iter()
        .map(|k| MinedRule {
            id: k.id,
            role: k.role,
            rule: k.rule,
        })
        .collect();
    let decided = |id: &str| {
        policy.is_some_and(|p| {
            p.conventions
                .iter()
                .any(|c| c.id == id && c.status != Status::Proposed)
        })
    };
    let d = drift_mine::declared::declared(repo, kinds, &rules);
    out.notes.extend(drift_mine::declared::notes(&d));
    let mut offered = 0usize;
    for p in d.proposals {
        if decided(&p.convention.id) {
            continue;
        }
        let reason = if !python_on && p.convention.language() == Lang::Python {
            Some(Reason::PythonOff)
        } else if !drift_mine::show::convention_kept(&p.convention) {
            Some(Reason::NotShown)
        } else if offered >= from_map::MAX_OFFERED {
            Some(Reason::OverCap)
        } else {
            None
        };
        match reason {
            Some(reason) => out.held.push(Held {
                id: p.convention.id.clone(),
                kind: DECLARED,
                summary: p.convention.summary.clone(),
                reason,
            }),
            None => {
                offered += 1;
                out.proposals.push(FromMap {
                    convention: p.convention,
                    basis: Basis::Declared {
                        evidence: p.declared,
                    },
                    twins: Vec::new(),
                });
            }
        }
    }
}

/// What `census --from-map` lists besides the proposals: the wiring regularities the
/// map computes ([`drift_mine::wiring_proposals`]) and the instruction files of the
/// repository, with which of these proposals an export would add to them. Information
/// only: nothing of it is written.
fn census_notes(
    root: &Path,
    repo: &RepoFacts,
    kinds: &FileKinds,
    known: &[Known<'_>],
    c: &mut Collected,
) {
    let rules: Vec<MinedRule<'_>> = known
        .iter()
        .map(|k| MinedRule {
            id: k.id,
            role: k.role,
            rule: k.rule,
        })
        .collect();
    let wiring = drift_mine::wiring_proposals::wiring(repo, kinds, &rules);
    c.notes
        .extend(drift_mine::wiring_proposals::notes(&wiring));
    let proposed: Vec<&Convention> = c.proposals.iter().map(|p| &p.convention).collect();
    let instructions = drift_mine::declared::instruction_notes(root, &proposed);
    c.notes.extend(instructions);
}

/// Accept the proposed declared rule `id` ([`DECLARED`]): accepted, advising, and the
/// files that break it today recorded in `lock` as `drift init` records a new
/// convention's, so only a new import against it is reported. Returns how many lines
/// were added.
fn accept_declared(
    repo: &RepoFacts,
    policy: &mut ConventionsFile,
    lock: &mut Lock,
    id: &str,
) -> usize {
    let Some(c) = policy.get_mut(id) else {
        return 0;
    };
    c.status = Status::Accepted;
    c.mode = Mode::Advise;
    let mut only = policy.clone();
    only.conventions.retain(|x| x.id == id);
    let new: Vec<(String, String)> = drift_mine::check::baseline(repo, &only)
        .entries
        .into_iter()
        .filter(|(i, key)| !lock.contains(i, key))
        .collect();
    let n = new.len();
    lock.entries.extend(new);
    n
}

// ---------- drift init ----------

/// Write the proposals of `c` into `policy`: the ones nobody decided are replaced by
/// these (what a person decided is kept as it is), placed after the accepted and
/// proposed conventions, before the rejected ones. `c` empty (`--no-from-map`): none.
pub fn write(policy: &mut ConventionsFile, c: &Collected) {
    policy.conventions.retain(|x| !undecided(x));
    for p in &c.proposals {
        if policy.conventions.iter().any(|x| x.id == p.convention.id) {
            continue;
        }
        insert(policy, p.convention.clone());
    }
}

/// `units` as a person reads it, `n` of them.
fn units_word(unit: &str, n: usize) -> String {
    let one = match unit {
        "entry_point" => "entry point".to_string(),
        "catch" => "catch clause".to_string(),
        "test_file" => "test file".to_string(),
        other => other.replace('_', " "),
    };
    if n == 1 { one } else { format!("{one}s") }
}

/// The lines of one proposal: what it says, how many follow of how many Drift could
/// read, how many it could not read, and a rule already there that says the same.
fn proposal_lines(p: &FromMap) -> Vec<String> {
    let c = &p.convention;
    let mut out = Vec::new();
    match &p.basis {
        Basis::Practice { candidate, settles } => {
            let read = candidate.follows + candidate.exceptions.len();
            let differ = candidate.exceptions.len();
            let mut line = format!(
                "  [{}] {}: {} of the {} {} Drift could read here follow it, {} {}",
                c.id,
                c.summary,
                candidate.follows,
                read,
                units_word(&candidate.unit, read),
                differ,
                if differ == 1 { "differs" } else { "differ" }
            );
            if *settles > 0 {
                line.push_str(&format!(" ({settles} named as departures today)"));
            }
            line.push_str(&format!(
                "; {} could not be read (never reported)",
                candidate.unknown
            ));
            out.push(line);
        }
        Basis::Layering { evidence, unknown } => {
            out.push(format!(
                "  [{}] {}: {} of the {} files there that import code of this repository follow it, 0 differ; {} could not be read (never reported)",
                c.id,
                c.summary,
                evidence.importing,
                evidence.importing,
                unknown
            ));
        }
        Basis::Declared { evidence } => {
            out.extend(drift_mine::declared::proposal_lines(c, evidence));
        }
    }
    for t in &p.twins {
        out.push(format!(
            "    the same rule read two ways: [{}] {} ({}, mined). Accepting both reports one departure twice; the mined one stays as it is.",
            t.id,
            sanitize(&t.summary, 200),
            t.status
        ));
    }
    out
}

/// The section `drift init` prints after the conventions; empty when there is nothing
/// from the map, proposed or not.
pub fn init_lines(c: &Collected) -> Vec<String> {
    if c.proposals.is_empty() && c.held.is_empty() {
        return Vec::new();
    }
    let mut out = vec![String::new(), HEADING.to_string()];
    if c.proposals.is_empty() {
        out.push("  none proposed.".to_string());
    }
    for p in &c.proposals {
        out.extend(proposal_lines(p));
    }
    if !c.proposals.is_empty() {
        out.push(
            "  Proposed in advise mode: nothing is checked and no agent is told of one until you accept it (`drift review`)."
                .to_string(),
        );
    }
    out.push(format!(
        "  Also seen, not proposed: {} (`drift census --from-map` lists each, with why).",
        c.held.len()
    ));
    if !c.notes.is_empty() {
        out.push(format!(
            "  Also from the repository's own statements: {} note(s), none proposed (`drift census --from-map` lists each).",
            c.notes.len()
        ));
    }
    out
}

// ---------- drift census --from-map ----------

/// What `drift census --from-map` appends: the section `init` prints, then each one not
/// proposed with why.
pub fn census_text(c: &Collected) -> String {
    let mut lines = vec![String::new(), HEADING.to_string()];
    if c.proposals.is_empty() {
        lines.push("  none proposed.".to_string());
    }
    for p in &c.proposals {
        lines.extend(proposal_lines(p));
    }
    for (kind, heading) in [
        (
            DECLARED,
            "  Declared by the repository, not proposed here (information, never written):",
        ),
        (
            WIRING,
            "  Wiring regularities (information: listed, never written, nothing checks them):",
        ),
    ] {
        let of: Vec<&drift_mine::declared::Note> =
            c.notes.iter().filter(|n| n.kind == kind).collect();
        if of.is_empty() {
            continue;
        }
        lines.push(heading.to_string());
        for n in of {
            lines.extend(n.lines.iter().cloned());
        }
    }
    lines.push(format!("  Also seen, not proposed: {}", c.held.len()));
    for h in &c.held {
        lines.push(format!(
            "    [{}] {}: not proposed: {}",
            h.id,
            h.summary,
            h.reason.words()
        ));
    }
    let mut s = lines.join("\n");
    s.push('\n');
    s
}

/// `drift census --from-map --json`'s `from_map`: every proposal (`proposed: true`), then
/// every one not proposed with its reason, in that order.
pub fn census_json(c: &Collected) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for p in &c.proposals {
        let mut v = json!({
            "proposed": true,
            "id": p.convention.id,
            "kind": p.convention.from_map,
            "summary": p.convention.summary,
            "convention": p.convention,
            "same_rule": p.twins.iter().map(|t| json!({
                "id": t.id,
                "summary": t.summary,
                "status": t.status,
            })).collect::<Vec<_>>(),
        });
        match &p.basis {
            Basis::Practice { candidate, settles } => {
                v["candidate"] = json!(candidate);
                v["settles"] = json!(settles);
                v["follows"] = json!(candidate.follows);
                v["differ"] = json!(candidate.exceptions.len());
                v["unknown"] = json!(candidate.unknown);
            }
            Basis::Layering { evidence, unknown } => {
                v["layering"] = json!(evidence);
                v["follows"] = json!(evidence.importing);
                v["differ"] = json!(0);
                v["unknown"] = json!(unknown);
            }
            Basis::Declared { evidence } => {
                v["declared"] = json!(evidence);
                v["follows"] = json!(evidence.follows);
                v["differ"] = json!(evidence.breaks);
                v["unknown"] = json!(evidence.not_read);
            }
        }
        out.push(v);
    }
    for h in &c.held {
        out.push(json!({
            "proposed": false,
            "id": h.id,
            "kind": h.kind,
            "summary": h.summary,
            "reason": h.reason.code(),
            "why": h.reason.words(),
        }));
    }
    for n in &c.notes {
        out.push(n.json.clone());
    }
    Value::Array(out)
}

/// The proposals of the repository at `root` for `census`: of `repo`, with mining's
/// `mined` and the conventions file as it is (none is written).
pub fn for_census(
    root: &Path,
    repo: &RepoFacts,
    mined: &drift_mine::mine::Mined,
    python_on: bool,
) -> Collected {
    let policy = ConventionsFile::load(root).ok().flatten();
    let report = crate::practices::report_units_kept(root, repo, None);
    let known = known(policy.as_ref(), &mined.candidates);
    let mut c = collect(
        repo,
        &report,
        &mined.kinds,
        &known,
        policy.as_ref(),
        python_on,
    );
    census_notes(root, repo, &mined.kinds, &known, &mut c);
    c
}

/// What `drift init` writes and prints from the map: the proposals for `policy` as it
/// stands (written into it), or none with `off` (`--no-from-map`). The caller saves.
pub fn for_init(
    root: &Path,
    repo: &RepoFacts,
    policy: &mut ConventionsFile,
    python_on: bool,
    off: bool,
) -> Collected {
    let c = if off {
        Collected::default()
    } else {
        let report = crate::practices::report_units_kept(root, repo, None);
        let known = known(Some(&*policy), &[]);
        collect(repo, &report, &policy.file_kinds, &known, Some(&*policy), python_on)
    };
    write(policy, &c);
    c
}

// ---------- drift review ----------

/// The candidate a proposed practice from the map stands for now: the open candidate of
/// its id that the engine would write as the same rule, else the engine's candidate for
/// what the rule accepts in its place. `None` when it no longer qualifies.
pub fn recompute(report: &PracticesReport, c: &Convention) -> Option<Candidate> {
    let Rule::Practice {
        concern,
        any_mechanism,
        any_enforcing,
        ..
    } = &c.rule
    else {
        return None;
    };
    let place = promote::place_of(c)?;
    if let Some(found) = promote::candidates(report).into_iter().find(|x| {
        promote::convention_id(&x.place, &x.concern) == c.id
            && promote::convention(x).rule == c.rule
    }) {
        return Some(found);
    }
    let req = Request {
        concern: concern.clone(),
        ways: c.promoted_from_practice.iter().cloned().collect(),
        with: Vec::new(),
        mechanisms: any_mechanism.clone(),
        any_enforcing: *any_enforcing,
        force: false,
    };
    promote::candidate_for(report, Some(&place), &req).ok()
}

/// Copy of `crate::promote`'s private `written`: the convention a promotion of `cand`
/// writes, accepted, with what a person decided about the one there of the same id kept.
fn written(policy: &ConventionsFile, cand: &Candidate) -> Convention {
    let mut c = promote::convention(cand);
    if let Some(old) = policy.conventions.iter().find(|x| x.id == c.id) {
        c.mode = old.mode;
        c.exceptions = old.exceptions.clone();
        c.different_kind = old.different_kind.clone();
        if old.agents.is_some() {
            c.agents = old.agents;
        }
    }
    if cand.forced {
        c.mode = Mode::Advise;
    }
    c.status = Status::Accepted;
    c
}

/// Copy of `crate::promote`'s private `insert`: `c` in the policy, replacing the
/// convention of its id, after the conventions of its status.
fn insert(policy: &mut ConventionsFile, c: Convention) {
    policy.conventions.retain(|x| x.id != c.id);
    let at = policy
        .conventions
        .iter()
        .position(|x| x.status > c.status)
        .unwrap_or(policy.conventions.len());
    policy.conventions.insert(at, c);
}

/// Accept the proposed practice `conv`: what `drift practices promote` writes (the
/// engine's convention, accepted, advising, `from_map: practice` kept to say where it
/// came from) put in `policy`, and the lock lines of the units that differ today from
/// the engine's baseline ([`promote::baseline`]), less those already there, added to
/// `lock`. Returns how many lines were added; `None` when it no longer qualifies
/// (nothing changed).
fn accept_practice(
    repo: &RepoFacts,
    report: &PracticesReport,
    policy: &mut ConventionsFile,
    lock: &mut Lock,
    conv: &Convention,
) -> Option<usize> {
    let cand = recompute(report, conv)?;
    let mut c = written(policy, &cand);
    c.from_map = conv.from_map.clone();
    let mut only = policy.clone();
    only.conventions = vec![c.clone()];
    let new: Vec<(String, String)> = promote::baseline(repo, report, &only)
        .into_iter()
        .filter(|(id, key)| !lock.contains(id, key))
        .collect();
    let n = new.len();
    lock.entries.extend(new);
    insert(policy, c);
    Some(n)
}

/// What [`review_step`] did.
#[derive(Debug, Clone, Copy, Default)]
pub struct Step {
    pub changed: bool,
    pub quit: bool,
}

/// The card of one proposal in interactive review.
fn card(report: &PracticesReport, known: &[Known<'_>], c: &Convention) -> Option<Vec<String>> {
    let mut out = vec![format!(
        "[{}] {} (from the map, not mined: it did not go through the miner's measured gates)",
        c.id, c.summary
    )];
    match c.from_map.as_deref() {
        Some(PRACTICE) => {
            let cand = recompute(report, c)?;
            let read = cand.follows + cand.exceptions.len();
            out.push(format!(
                "  {} of the {} {} Drift could read here follow it, {} differ; {} could not be read (never reported)",
                cand.follows,
                read,
                units_word(&cand.unit, read),
                cand.exceptions.len(),
                cand.unknown
            ));
            for e in cand.exceptions.iter().take(3) {
                out.push(format!("  differs: {}#{} (line {})", e.path, e.symbol, e.line));
            }
            if cand.exceptions.len() > 3 {
                out.push(format!("  and {} more", cand.exceptions.len() - 3));
            }
            for t in twins(report, known, &cand) {
                out.push(format!(
                    "  the same rule read two ways: [{}] {} ({}, mined). Accepting both reports one departure twice; the mined one stays as it is.",
                    t.id,
                    sanitize(&t.summary, 200),
                    t.status
                ));
            }
            out.push(format!(
                "  y accepts it as `drift practices promote` would (advise mode; the {} that differ today recorded in {LOCK_FILE})",
                cand.exceptions.len()
            ));
        }
        Some(DECLARED) => {
            out.extend(drift_mine::declared::card_lines(c));
        }
        _ => {
            out.push(format!(
                "  {} of the {} files there that import code of this repository follow it, 0 differ",
                c.evidence.holders, c.evidence.total
            ));
            out.push(
                "  y accepts it, as a mined layering convention is accepted (advise mode)".to_string(),
            );
        }
    }
    Some(out)
}

/// The from-the-map step of interactive `drift review`, before the practices that may
/// be promoted: each proposal from the map nobody decided, one at a time, labelled. `y`
/// accepts (a practice as `drift practices promote` writes it; layering as a mined
/// convention is accepted), `n` records it rejected so it is not offered again, `s`
/// skips, `q` stops the review. The policy is changed in memory (the caller saves it);
/// the lock is saved here.
pub fn review_step(
    root: &Path,
    repo: &RepoFacts,
    report: &PracticesReport,
    policy: &mut ConventionsFile,
) -> anyhow::Result<Step> {
    let ids: Vec<String> = policy
        .conventions
        .iter()
        .filter(|c| undecided(c))
        .map(|c| c.id.clone())
        .collect();
    let mut step = Step::default();
    if ids.is_empty() {
        return Ok(step);
    }
    let mut lock = Lock::load(root)?;
    println!();
    println!(
        "{} proposal(s) from the map (not mined). y = accept (advise), n = no (not asked again), s = skip, q = quit",
        ids.len()
    );
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    for id in ids {
        let Some(conv) = policy.conventions.iter().find(|c| c.id == id).cloned() else {
            continue;
        };
        let lines_of = {
            let known = known(Some(&*policy), &[]);
            card(report, &known, &conv)
        };
        let Some(text) = lines_of else {
            println!();
            println!(
                "[{id}] {}: no longer qualifies as the code stands; left as proposed (`drift init` drops it)",
                conv.summary
            );
            continue;
        };
        println!();
        for l in text {
            println!("{l}");
        }
        print!("  [y/n/s/q] > ");
        std::io::stdout().flush()?;
        let Some(line) = lines.next() else { break };
        let line = line?;
        match line.trim() {
            "y" => {
                if conv.from_map.as_deref() == Some(PRACTICE) {
                    match accept_practice(repo, report, policy, &mut lock, &conv) {
                        Some(n) => println!("  accepted: {id}, advise ({n} recorded in {LOCK_FILE})"),
                        None => {
                            println!("  {id} no longer qualifies: left as proposed");
                            continue;
                        }
                    }
                } else if conv.from_map.as_deref() == Some(DECLARED) {
                    let n = accept_declared(repo, policy, &mut lock, &id);
                    println!("  accepted: {id}, advise ({n} recorded in {LOCK_FILE})");
                } else if let Some(c) = policy.get_mut(&id) {
                    c.status = Status::Accepted;
                    println!("  accepted: {id}, advise");
                }
                step.changed = true;
            }
            "n" => {
                if let Some(c) = policy.get_mut(&id) {
                    c.status = Status::Rejected;
                    c.mode = Mode::Advise;
                }
                println!(
                    "  not accepted: recorded as {id}, rejected, in {CONVENTIONS_FILE}, so it is not offered again"
                );
                step.changed = true;
            }
            "q" => {
                step.quit = true;
                break;
            }
            _ => println!("  skipped: offered again next time"),
        }
    }
    if step.changed {
        lock.save(root)?;
    }
    Ok(step)
}

/// `drift review --accept/--block/--advise/--show-to-agents` on a proposed practice from
/// the map, before the decisions are applied: it is first written as `drift practices
/// promote` writes it (and its lock lines added), so the decisions then apply to that.
/// Refuses, changing nothing, when one no longer qualifies, or when a Python one is
/// asked to block (a Python practice advises only). Layering proposals need nothing
/// here: they are accepted as mined conventions are. Returns a line per practice.
pub fn accept_ids(
    root: &Path,
    facts: impl FnOnce() -> anyhow::Result<RepoFacts>,
    policy: &mut ConventionsFile,
    lists: &[&[String]],
    block: &[String],
) -> anyhow::Result<Vec<String>> {
    let mut ids: Vec<String> = lists
        .iter()
        .flat_map(|l| l.iter())
        .filter(|id| {
            policy
                .conventions
                .iter()
                .any(|c| &c.id == *id && undecided(c) && c.rule.is_practice())
        })
        .cloned()
        .collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let python: Vec<&str> = ids
        .iter()
        .filter(|id| block.contains(id))
        .filter(|id| {
            policy
                .conventions
                .iter()
                .any(|c| &c.id == *id && c.language() == Lang::Python)
        })
        .map(String::as_str)
        .collect();
    if !python.is_empty() {
        bail!(
            "refusing to block {}, nothing was changed: a Python practice advises only. `drift review --accept <id>` accepts it advising",
            python.join(", ")
        );
    }
    let repo = facts()?;
    let report = crate::practices::report_units_kept(root, &repo, None);
    let mut lock = Lock::load(root)?;
    let mut next = policy.clone();
    let mut out = Vec::new();
    let mut gone = Vec::new();
    for id in &ids {
        let Some(conv) = next.conventions.iter().find(|c| &c.id == id).cloned() else {
            continue;
        };
        match accept_practice(&repo, &report, &mut next, &mut lock, &conv) {
            Some(n) => out.push(format!(
                "{id}: from the map, written as `drift practices promote` writes it ({n} unit(s) that differ today recorded in {LOCK_FILE})"
            )),
            None => gone.push(id.as_str()),
        }
    }
    if !gone.is_empty() {
        bail!(
            "{} no longer qualif{} as the code stands, nothing was changed: `drift init` proposes again what the map shows now",
            gone.join(", "),
            if gone.len() == 1 { "ies" } else { "y" }
        );
    }
    lock.save(root)?;
    *policy = next;
    Ok(out)
}

/// `drift review --list`'s lines on the proposals from the map nobody decided yet.
pub fn listed(policy: &ConventionsFile) -> Vec<String> {
    let open: Vec<&Convention> = policy.conventions.iter().filter(|c| undecided(c)).collect();
    if open.is_empty() {
        return Vec::new();
    }
    let mut out = vec![format!(
        "{} proposal(s) from the map, not mined (`drift review` asks about each; `drift review --show <id>` shows one):",
        open.len()
    )];
    for c in open {
        out.push(format!(
            "  [{}] {} (proposed, from the map: {})",
            c.id,
            c.summary,
            c.from_map.as_deref().unwrap_or_default()
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_mine::practices::promote::Way;

    fn cand(concern: &str, dir: &str, follows: usize) -> Candidate {
        Candidate {
            concern: concern.to_string(),
            unit: "entry_point".to_string(),
            place: Place {
                package: String::new(),
                dir: dir.to_string(),
                ..Place::default()
            },
            ways: vec![Way {
                id: format!("P-{dir}"),
                key: "wrapped_by:withAuth".to_string(),
                label: "withAuth".to_string(),
                members: follows,
            }],
            follows,
            total: follows,
            example: None,
            ..Candidate::default()
        }
    }

    #[test]
    fn a_passive_candidate_is_never_proposed() {
        let mut c = cand(drift_mine::practices::AUTHN, "api", 40);
        c.passive = true;
        let (chosen, held) = choose(vec![c], &|_| 0, true);
        assert!(chosen.is_empty());
        assert_eq!(held[0].1, Reason::Passive);
    }

    #[test]
    fn a_preview_concern_is_held() {
        let c = cand(drift_mine::practices::LOGGING, "api", 40);
        let (chosen, held) = choose(vec![c], &|_| 0, true);
        assert!(chosen.is_empty());
        assert_eq!(held[0].1, Reason::Preview);
    }

    #[test]
    fn at_most_eight_are_proposed_largest_first() {
        let all: Vec<Candidate> = (0..10)
            .map(|i| cand(drift_mine::practices::AUTHN, &format!("d{i}"), 10 + i))
            .collect();
        let (chosen, held) = choose(all, &|_| 0, true);
        assert_eq!(chosen.len(), MAX_PRACTICES);
        assert_eq!(chosen[0].follows, 19);
        assert_eq!(held.len(), 2);
        assert!(held.iter().all(|(_, r)| *r == Reason::OverCap));
    }

    #[test]
    fn of_overlapping_places_the_larger_is_proposed() {
        let a = cand(drift_mine::practices::AUTHN, "", 40);
        let b = cand(drift_mine::practices::AUTHN, "api", 30);
        let (chosen, held) = choose(vec![b, a], &|_| 0, true);
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].place.dir, "");
        assert!(matches!(held[0].1, Reason::Overlaps(_)));
    }

    #[test]
    fn python_is_held_while_python_proposals_are_off() {
        let mut c = cand(drift_mine::practices::AUTHN, "api", 40);
        c.python = 40;
        let (chosen, held) = choose(vec![c.clone()], &|_| 0, false);
        assert!(chosen.is_empty());
        assert_eq!(held[0].1, Reason::PythonOff);
        let (chosen, _) = choose(vec![c], &|_| 0, true);
        assert_eq!(chosen.len(), 1);
    }

    #[test]
    fn a_proposal_reaches_no_agent_and_advises() {
        let c = proposed(&cand(drift_mine::practices::AUTHN, "api", 40));
        assert_eq!(c.status, Status::Proposed);
        assert_eq!(c.mode, Mode::Advise);
        assert_eq!(c.agents, None);
        assert_eq!(c.from_map.as_deref(), Some(PRACTICE));
    }

    #[test]
    fn role_directories_overlap_places() {
        assert!(dir_overlaps("**", "app/api"));
        assert!(dir_overlaps("app/api/[*]", "app/api"));
        assert!(dir_overlaps("app", "app/api"));
        assert!(dir_overlaps("app/[*]/x", "app/y"));
        assert!(!dir_overlaps("lib", "app/api"));
        assert!(!dir_overlaps(".", "app"));
        assert!(dir_overlaps(".", ""));
    }

    #[test]
    fn no_line_says_every_file_or_not_at_all() {
        let c = cand(drift_mine::practices::AUTHN, "api", 40);
        let p = FromMap {
            convention: proposed(&c),
            basis: Basis::Practice {
                candidate: c,
                settles: 0,
            },
            twins: Vec::new(),
        };
        for l in proposal_lines(&p) {
            assert!(!l.contains("every file"), "{l}");
            assert!(!l.contains("not at all"), "{l}");
            assert!(!l.contains("nothing found"), "{l}");
        }
    }
}
