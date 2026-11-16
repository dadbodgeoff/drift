//! Stream S8, audit 6 G5 and G6: what a person decided stays theirs across `drift init`.
//!
//! - A mined wrapper rule that gains an alternative comes back under a new id (ids hash
//!   role and rule and are not changed). Before, the accepted card was left behind and
//!   the new one came in as a proposal: the decision, its exceptions and its lock lines
//!   were orphaned. Now `merge` carries them to the new id.
//! - `merge` kept refreshing the evidence of accepted conventions with nothing kept of
//!   what the person accepted; now that evidence is kept beside it.
//! - `merge` re-sorted the whole file by lower bound, a value every run changes; decided
//!   conventions are now ordered by id.

use drift_core::{SymbolKind, WrapKind};
use drift_mine::mine::{Candidate, Evidence, Rule};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status, gains_alternatives};
use drift_mine::roles::{FileKinds, RoleSelector};

fn role() -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: "app".into(),
        file: "route".into(),
        entry: "http".into(),
        kind: SymbolKind::Function,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

fn wrapped(any_of: &[&str]) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: any_of.iter().map(|s| s.to_string()).collect(),
    }
}

fn cand(id: &str, rule: Rule, holders: usize, lb: f64) -> Candidate {
    Candidate {
        id: id.into(),
        role: role(),
        rule,
        evidence: Evidence {
            holders,
            total: 20,
            lower_bound: lb,
            lift: 2.0,
            split: vec![],
            role_members: None,
            python_members: None,
        },
        score: 1.0,
        example: "app/a/route.ts#GET".into(),
        outliers: vec![],
        can_block: false,
        wiring: None,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
    }
}

const AUTH: &str = "lib/auth.ts#withAuth";
const ADMIN: &str = "lib/auth.ts#withAdmin";

#[test]
fn a_decision_follows_its_rule_when_the_rule_gains_an_alternative() {
    let mut first = ConventionsFile::merge(
        None,
        "e1",
        FileKinds::default(),
        &[cand("D-aaaaaa", wrapped(&[AUTH]), 17, 0.7)],
    );
    let c = first.get_mut("D-aaaaaa").unwrap();
    c.status = Status::Accepted;
    c.mode = Mode::Block;
    c.set_exception("app/health/route.ts#GET", "public health check");
    // The next run mines the same role with a second wrapper: a new id.
    let (again, carried) = ConventionsFile::merge_carrying(
        Some(first),
        "e2",
        FileKinds::default(),
        &[cand("D-bbbbbb", wrapped(&[AUTH, ADMIN]), 19, 0.8)],
    );
    assert_eq!(carried, [("D-aaaaaa".to_string(), "D-bbbbbb".to_string())]);
    let ids: Vec<(&str, Status, Mode)> = again
        .conventions
        .iter()
        .map(|c| (c.id.as_str(), c.status, c.mode))
        .collect();
    assert_eq!(ids, [("D-bbbbbb", Status::Accepted, Mode::Block)]);
    let c = &again.conventions[0];
    assert_eq!(c.rule, wrapped(&[AUTH, ADMIN]));
    assert_eq!(
        c.exception("app/health/route.ts#GET").map(|e| e.reason.as_str()),
        Some("public health check")
    );
    // What the person accepted (17 of 20) stays beside the refreshed evidence.
    let accepted = c.accepted_evidence.as_ref().expect("kept");
    assert_eq!((accepted.holders, accepted.total, accepted.role_size), (17, 20, 20));
    assert_eq!(c.evidence.holders, 19);

    // The lock lines move with it, fingerprint lines included.
    let mut lock = Lock::default();
    lock.entries
        .insert(("D-aaaaaa".into(), "app/x/route.ts#GET".into()));
    lock.entries.insert((
        "D-aaaaaa".into(),
        Lock::fingerprint_key("0123456789abcdef", "app/x/route.ts#GET"),
    ));
    lock.entries
        .insert(("D-cccccc".into(), "app/y/route.ts#GET".into()));
    for (from, to) in &carried {
        lock.rename(from, to);
    }
    assert!(lock.contains("D-bbbbbb", "app/x/route.ts#GET"));
    assert!(!lock.entries.iter().any(|(id, _)| id == "D-aaaaaa"));
    assert!(lock.contains("D-cccccc", "app/y/route.ts#GET"));
    assert_eq!(lock.members(), 2);
}

#[test]
fn only_an_added_alternative_carries_a_decision() {
    assert!(gains_alternatives(&wrapped(&[AUTH]), &wrapped(&[AUTH, ADMIN])));
    // The same rule, one dropped, one swapped, another kind: a new decision.
    assert!(!gains_alternatives(&wrapped(&[AUTH]), &wrapped(&[AUTH])));
    assert!(!gains_alternatives(&wrapped(&[AUTH, ADMIN]), &wrapped(&[AUTH])));
    assert!(!gains_alternatives(&wrapped(&[AUTH]), &wrapped(&[ADMIN])));
    assert!(!gains_alternatives(
        &wrapped(&[AUTH]),
        &Rule::WrappedBy {
            kind: WrapKind::Decorator,
            any_of: vec![AUTH.into(), ADMIN.into()],
        }
    ));
    // A proposal, or an accepted card mining still proposes, carries nothing.
    let first = ConventionsFile::merge(
        None,
        "e1",
        FileKinds::default(),
        &[cand("D-aaaaaa", wrapped(&[AUTH]), 17, 0.7)],
    );
    let (again, carried) = ConventionsFile::merge_carrying(
        Some(first.clone()),
        "e2",
        FileKinds::default(),
        &[cand("D-bbbbbb", wrapped(&[AUTH, ADMIN]), 19, 0.8)],
    );
    assert!(carried.is_empty());
    assert_eq!(again.conventions.len(), 2);
    let mut accepted = first;
    accepted.get_mut("D-aaaaaa").unwrap().status = Status::Accepted;
    let (_, carried) = ConventionsFile::merge_carrying(
        Some(accepted),
        "e2",
        FileKinds::default(),
        &[
            cand("D-aaaaaa", wrapped(&[AUTH]), 17, 0.7),
            cand("D-bbbbbb", wrapped(&[AUTH, ADMIN]), 19, 0.8),
        ],
    );
    assert!(carried.is_empty());
}

/// Decided conventions keep their place when only evidence changes: a diff of the
/// file shows the evidence lines, not every card moved.
#[test]
fn decided_conventions_are_ordered_by_id_not_by_strength() {
    let mut p = ConventionsFile::merge(
        None,
        "e1",
        FileKinds::default(),
        &[
            cand("D-aaaaaa", wrapped(&[AUTH]), 17, 0.7),
            cand("D-bbbbbb", Rule::Calls { callee: "lib/log.ts#log".into() }, 19, 0.9),
        ],
    );
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    let ids = |f: &ConventionsFile| -> Vec<String> {
        f.conventions.iter().map(|c| c.id.clone()).collect()
    };
    // The weaker one grows stronger than the other: the order stays.
    let again = ConventionsFile::merge(
        Some(p.clone()),
        "e2",
        FileKinds::default(),
        &[
            cand("D-aaaaaa", wrapped(&[AUTH]), 19, 0.95),
            cand("D-bbbbbb", Rule::Calls { callee: "lib/log.ts#log".into() }, 19, 0.6),
        ],
    );
    assert_eq!(ids(&again), ["D-aaaaaa", "D-bbbbbb"]);
    let again = ConventionsFile::merge(
        Some(again),
        "e3",
        FileKinds::default(),
        &[
            cand("D-aaaaaa", wrapped(&[AUTH]), 15, 0.5),
            cand("D-bbbbbb", Rule::Calls { callee: "lib/log.ts#log".into() }, 19, 0.99),
        ],
    );
    assert_eq!(ids(&again), ["D-aaaaaa", "D-bbbbbb"]);
    // What was accepted is what the first run that met it accepted had.
    let a = again
        .conventions
        .iter()
        .find(|c| c.id == "D-aaaaaa")
        .unwrap();
    assert_eq!(a.accepted_evidence.as_ref().unwrap().holders, 17);
    assert_eq!(a.evidence.holders, 15);
}
