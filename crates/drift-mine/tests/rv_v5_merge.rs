//! Review fix (PR 148, area 3 item 2): an undecided proposal from the map whose id
//! mining now drafts (a layering proposal's id is mining's for its role and rule)
//! becomes mining's proposal in `ConventionsFile::merge_carrying`. Before, it kept
//! `from_map: layering`, and the from-map step that replaces undecided proposals then
//! dropped it from the conventions file: the draft `drift init` printed was in no file
//! and offered by no review. A decided one is kept as the person decided it.

use drift_core::SymbolKind;
use drift_mine::mine::{Candidate, Evidence, Rule, convention_id};
use drift_mine::policy::{ConventionsFile, Status};
use drift_mine::roles::{FileKinds, RoleSelector};

fn role() -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: "core".into(),
        file: "*".into(),
        entry: "-".into(),
        kind: SymbolKind::Module,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

fn candidate() -> Candidate {
    let rule = Rule::Avoids {
        signal: "import:ui/screens".into(),
    };
    Candidate {
        id: convention_id(&role(), &rule),
        role: role(),
        rule,
        evidence: Evidence {
            holders: 40,
            total: 41,
            lower_bound: 0.9,
            lift: 2.0,
            split: vec![],
            role_members: None,
            python_members: None,
        },
        score: 1.0,
        example: "core/c0.ts#(file)".into(),
        outliers: vec![],
        can_block: false,
        wiring: None,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
    }
}

/// The file `drift init` wrote while only the map proposed the rule.
fn proposed_from_map(status: Status) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "e", FileKinds::default(), &[candidate()]);
    let c = &mut p.conventions[0];
    c.from_map = Some("layering".into());
    c.status = status;
    p
}

#[test]
fn an_undecided_map_proposal_mining_drafts_becomes_minings() {
    let cand = candidate();
    let (merged, _) = ConventionsFile::merge_carrying(
        Some(proposed_from_map(Status::Proposed)),
        "e",
        FileKinds::default(),
        std::slice::from_ref(&cand),
    );
    let c = merged.conventions.iter().find(|c| c.id == cand.id).unwrap();
    assert_eq!(c.from_map, None, "{c:?}");
    assert_eq!(c.status, Status::Proposed);
    assert_eq!(c.evidence.total, 41);
}

#[test]
fn a_decided_map_rule_keeps_where_it_came_from() {
    let cand = candidate();
    for status in [Status::Accepted, Status::Rejected] {
        let (merged, _) = ConventionsFile::merge_carrying(
            Some(proposed_from_map(status)),
            "e",
            FileKinds::default(),
            std::slice::from_ref(&cand),
        );
        let c = merged.conventions.iter().find(|c| c.id == cand.id).unwrap();
        assert_eq!(c.from_map.as_deref(), Some("layering"), "{status:?}");
        assert_eq!(c.status, status);
    }
}
