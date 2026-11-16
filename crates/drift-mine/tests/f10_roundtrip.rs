//! F10 (review R10 F-2): `.drift/conventions.yaml` is written the same however often it
//! is loaded and saved.
//!
//! Pins: decided conventions are ordered by id alone (the order chosen when evidence
//! began to be refreshed on every run, so a run moves no decided card), and a load then
//! a save with no change, or a `drift init` that changes nothing, gives the same bytes.

use std::path::Path;

use drift_core::{SymbolKind, WrapKind};
use drift_mine::mine::{Candidate, Evidence, Rule};
use drift_mine::policy::{CONVENTIONS_FILE, ConventionsFile, Status};
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

fn candidates() -> Vec<Candidate> {
    vec![
        cand(
            "D-aaaaaa",
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of: vec!["lib/auth.ts#withAuth".into()],
            },
            15,
            0.6,
        ),
        cand("D-bbbbbb", Rule::Calls { callee: "lib/log.ts#log".into() }, 19, 0.9),
        cand("D-cccccc", Rule::Calls { callee: "lib/audit.ts#audit".into() }, 17, 0.8),
    ]
}

fn ids(f: &ConventionsFile) -> Vec<&str> {
    f.conventions.iter().map(|c| c.id.as_str()).collect()
}

fn bytes(root: &Path) -> Vec<u8> {
    std::fs::read(root.join(CONVENTIONS_FILE)).unwrap()
}

#[test]
fn decided_conventions_are_ordered_by_id_and_a_round_trip_keeps_the_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let mut p = ConventionsFile::merge(None, "e", FileKinds::default(), &candidates());
    for c in &mut p.conventions {
        c.status = if c.id == "D-cccccc" {
            Status::Rejected
        } else {
            Status::Accepted
        };
    }
    // A run of `drift init` after the decisions (it freezes the accepted evidence).
    let p = ConventionsFile::merge(Some(p), "e", FileKinds::default(), &candidates());
    // Accepted first, by id whatever their strength, then rejected.
    assert_eq!(ids(&p), ["D-aaaaaa", "D-bbbbbb", "D-cccccc"]);
    p.save(r).unwrap();
    let first = bytes(r);

    // Load, then save with no change: the same bytes.
    let loaded = ConventionsFile::load(r).unwrap().unwrap();
    assert_eq!(ids(&loaded), ["D-aaaaaa", "D-bbbbbb", "D-cccccc"]);
    loaded.save(r).unwrap();
    assert_eq!(bytes(r), first);

    // A `drift init` that finds the same: the same bytes.
    let loaded = ConventionsFile::load(r).unwrap().unwrap();
    let again = ConventionsFile::merge(Some(loaded), "e", FileKinds::default(), &candidates());
    again.save(r).unwrap();
    assert_eq!(
        String::from_utf8(bytes(r)).unwrap(),
        String::from_utf8(first).unwrap()
    );
}
