//! Candidate changes to mining's gates, each behind a switch that is off (stream S21,
//! audit 7 gaps G2 and G5, PLAN-R14 WS-H). Study use only: `drift census
//! --gate-candidate <name>` turns one on for that run; `init`, `check`, the hooks and
//! every other command never do, and nothing a switch changes is written anywhere.
//!
//! Why it exists: mining is frozen (a pre-registered study measured its output), and
//! several of its gates have no study behind them. The owner decides each gate with
//! numbers; these switches make each decision measurable without changing what the
//! product proposes. With no switch on (the default, and always outside `census`), every
//! gate runs exactly the code it ran before: each candidate is written as
//! `if gate_candidates::on(GateCandidate::X) { new } else { the code as it was }` at
//! the gate it changes, in `crate::mine`.
//!
//! What a switch adds is marked: every proposal that exists only because a switch is on
//! carries the switch's name ([`marked`]), which `census --json` writes as
//! `gate_candidate` and the text view as a `study:` line; the yield funnel
//! ([`crate::funnel`]) counts those proposals at the stage [`GateCandidate::stage`]. A
//! proposal only `universal` or `small-roles` made advises only ([`advise_only`]),
//! whatever its rule kind and role size.
//!
//! The switches are a process-wide set, empty by default and set once, from the command
//! line ([`set`]). The marks are kept for the process, keyed by convention id
//! ([`crate::mine::convention_id`]), and read only while a switch is on.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU8, Ordering};

/// One candidate change to a gate of mining.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum GateCandidate {
    /// A rule every member of its role holds (no outlier) is proposed, advise only:
    /// "holds everywhere; cannot be checked against an exception". The outlier rule
    /// (`consider`, `draft_over`) is the gate; every other gate, the mandated-by-a-framework
    /// filter (`unproposable`) included, still applies.
    Universal,
    /// Roles of 8 to 18 members can yield a plain rule: audit 7 G2(b), exactly. Under the
    /// shipped gates (at least one outlier, Wilson lower bound 0.75) the smallest role
    /// that can is 19 (18 of 19); this admits a rule held by at least 90% of a role of 8
    /// to 18 (all of it included) whose target the repository defines, with lift of at
    /// least 1.5 and holders in at least 3 files, advise only.
    SmallRoles,
    /// The per-role cap (`MAX_PER_ROLE`) counts only drafts the show policy will show,
    /// as the per-repository caps already do (WS-H(a)).
    CapShowAware,
    /// The caps run after narrowing, the compiler check, subtrees and the merge of
    /// sibling roles, on the cards those make (WS-H(b)).
    CapAfterNarrow,
    /// `narrow` checks the lower bound again after it recounts (WS-H(c)).
    NarrowRecheck,
    /// The layering share (`AVOID_MAX_SHARE` of `--max`) does not cut a default-tier rule.
    AvoidCapOwn,
}

impl GateCandidate {
    /// Every candidate, in the order of this enum.
    pub const ALL: [GateCandidate; 6] = [
        GateCandidate::Universal,
        GateCandidate::SmallRoles,
        GateCandidate::CapShowAware,
        GateCandidate::CapAfterNarrow,
        GateCandidate::NarrowRecheck,
        GateCandidate::AvoidCapOwn,
    ];

    /// The name `--gate-candidate` takes and `census --json` writes (`gate_candidate`).
    pub fn name(self) -> &'static str {
        match self {
            GateCandidate::Universal => "universal",
            GateCandidate::SmallRoles => "small-roles",
            GateCandidate::CapShowAware => "cap-show-aware",
            GateCandidate::CapAfterNarrow => "cap-after-narrow",
            GateCandidate::NarrowRecheck => "narrow-recheck",
            GateCandidate::AvoidCapOwn => "avoid-cap-own",
        }
    }

    /// The candidate named `name` ([`GateCandidate::name`]).
    pub fn from_name(name: &str) -> Option<GateCandidate> {
        GateCandidate::ALL.into_iter().find(|c| c.name() == name)
    }

    /// The yield funnel's stage ([`crate::funnel::add`]) for this candidate: the
    /// proposals only it made, or (`narrow-recheck`) the drafts it dropped. Never a
    /// stage of [`crate::funnel::STAGES`], so the funnel's list of stages, and every
    /// count, are what they were while no switch is on.
    pub fn stage(self) -> &'static str {
        match self {
            GateCandidate::Universal => "gate_candidate:universal",
            GateCandidate::SmallRoles => "gate_candidate:small-roles",
            GateCandidate::CapShowAware => "gate_candidate:cap-show-aware",
            GateCandidate::CapAfterNarrow => "gate_candidate:cap-after-narrow",
            GateCandidate::NarrowRecheck => "gate_candidate:narrow-recheck",
            GateCandidate::AvoidCapOwn => "gate_candidate:avoid-cap-own",
        }
    }

    /// What the text view says of a proposal only this candidate made.
    pub fn note(self) -> &'static str {
        match self {
            GateCandidate::Universal => {
                "holds everywhere; cannot be checked against an exception (study candidate universal, advise only)"
            }
            GateCandidate::SmallRoles => {
                "a role of 8 to 18 members, held by at least 90%, below what the 0.75 lower bound admits (study candidate small-roles, advise only)"
            }
            GateCandidate::CapShowAware => {
                "kept because the per-role cap counted only drafts the show policy shows (study candidate cap-show-aware)"
            }
            GateCandidate::CapAfterNarrow => {
                "kept because the caps ran after narrowing and merging (study candidate cap-after-narrow)"
            }
            GateCandidate::NarrowRecheck => {
                "changed by the re-check of the lower bound after narrowing (study candidate narrow-recheck)"
            }
            GateCandidate::AvoidCapOwn => {
                "a default-tier layering rule the layering share would have cut (study candidate avoid-cap-own)"
            }
        }
    }

    /// A proposal only this candidate made advises only: it was never measured, and it
    /// has no outlier to check (`universal`) or a role below the bound (`small-roles`).
    fn forces_advice(self) -> bool {
        matches!(self, GateCandidate::Universal | GateCandidate::SmallRoles)
    }

    fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// The switches on, as bits of [`GateCandidate::bit`]: none by default.
static ON: AtomicU8 = AtomicU8::new(0);

/// Convention id -> the candidate that made it (the least one, when several did).
static MARKS: Mutex<BTreeMap<String, GateCandidate>> = Mutex::new(BTreeMap::new());

/// Turn on exactly `candidates` (none: every switch off). Called once, by `census`.
pub fn set(candidates: &[GateCandidate]) {
    let bits = candidates.iter().fold(0u8, |b, c| b | c.bit());
    ON.store(bits, Ordering::Relaxed);
    if let Ok(mut m) = MARKS.lock() {
        m.clear();
    }
}

/// Whether the switch of `candidate` is on.
pub fn on(candidate: GateCandidate) -> bool {
    ON.load(Ordering::Relaxed) & candidate.bit() != 0
}

/// Whether any switch is on.
pub fn any() -> bool {
    ON.load(Ordering::Relaxed) != 0
}

/// The switches on, in [`GateCandidate::ALL`] order.
pub fn enabled() -> Vec<GateCandidate> {
    GateCandidate::ALL.into_iter().filter(|c| on(*c)).collect()
}

/// Mark the draft or card `id` as made only because `candidate` is on. Nothing while
/// no switch is on.
pub fn mark(id: &str, candidate: GateCandidate) {
    if !any() {
        return;
    }
    let mut m = MARKS.lock().unwrap_or_else(|e| e.into_inner());
    let e = m.entry(id.to_string()).or_insert(candidate);
    if candidate < *e {
        *e = candidate;
    }
}

/// The candidate that made `id`, if one did (always `None` while no switch is on).
pub fn marked(id: &str) -> Option<GateCandidate> {
    if !any() {
        return None;
    }
    let m = MARKS.lock().unwrap_or_else(|e| e.into_inner());
    m.get(id).copied()
}

/// Whether `id` was made only by a candidate whose proposals advise only (`universal`,
/// `small-roles`). Always false while no switch is on.
pub fn advise_only(id: &str) -> bool {
    marked(id).is_some_and(GateCandidate::forces_advice)
}

/// The text view's line for `id`: [`GateCandidate::note`] of the candidate that made it.
pub fn note_for(id: &str) -> Option<&'static str> {
    marked(id).map(GateCandidate::note)
}

/// Carry the marks of drafts to the cards made from them: `origins` maps each card's id
/// to the ids of the drafts it was made from (one, or a merged card's parts). A card
/// takes the least mark of its drafts. Nothing while no switch is on.
pub fn carry(origins: &BTreeMap<String, Vec<String>>) {
    if !any() {
        return;
    }
    let mut m = MARKS.lock().unwrap_or_else(|e| e.into_inner());
    let found: Vec<(String, GateCandidate)> = origins
        .iter()
        .filter_map(|(id, os)| {
            os.iter()
                .filter_map(|o| m.get(o).copied())
                .min()
                .map(|c| (id.clone(), c))
        })
        .collect();
    for (id, c) in found {
        let e = m.entry(id).or_insert(c);
        if c < *e {
            *e = c;
        }
    }
}

/// Whether `stage` is one of the candidates' funnel stages ([`GateCandidate::stage`]).
pub fn is_stage(stage: &str) -> bool {
    GateCandidate::ALL.iter().any(|c| c.stage() == stage)
}

thread_local! {
    /// The drafts `narrow-recheck` dropped in the pass now mining, as the funnel counts
    /// them: (family, keying, language). Drained by the pass ([`take_rechecked`]).
    static RECHECKED: std::cell::RefCell<Vec<(String, &'static str, &'static str)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Note one draft `narrow-recheck` dropped.
pub fn note_rechecked(family: String, keying: &'static str, lang: &'static str) {
    RECHECKED.with(|r| r.borrow_mut().push((family, keying, lang)));
}

/// The drafts `narrow-recheck` dropped since the last call.
pub fn take_rechecked() -> Vec<(String, &'static str, &'static str)> {
    RECHECKED.with(|r| std::mem::take(&mut *r.borrow_mut()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The switches are process-wide, so these tests never turn one on: unit tests of
    // the miner run in the same process.

    #[test]
    fn every_switch_is_off_by_default_and_nothing_is_marked() {
        assert!(!any());
        for c in GateCandidate::ALL {
            assert!(!on(c), "{}", c.name());
        }
        mark("D-000000", GateCandidate::Universal);
        assert_eq!(marked("D-000000"), None);
        assert!(!advise_only("D-000000"));
        assert_eq!(note_for("D-000000"), None);
    }

    #[test]
    fn names_and_stages_round_trip_and_stay_out_of_the_funnel_stages() {
        for c in GateCandidate::ALL {
            assert_eq!(GateCandidate::from_name(c.name()), Some(c));
            assert!(is_stage(c.stage()));
            assert!(!crate::funnel::STAGES.contains(&c.stage()));
        }
        assert_eq!(GateCandidate::from_name("wilson"), None);
    }
}
