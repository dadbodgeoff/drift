//! The funnel's record (`drift census --why`, stream S12) observes mining and never
//! changes it: mining with every gate recorded proposes byte for byte what it proposes
//! with nothing recorded. Mining is frozen (the study in `eval/study/` pre-registered it),
//! so this is the property the record must keep. Every name is invented.
//!
//! Before this test only a CLI run against an older binary (`DRIFT_BEFORE_BIN`) pinned
//! it, and nothing pinned that a cap's cut is recorded at all.

use drift_core::{FileFacts, Import, RepoFacts};
use drift_mine::funnel;
use drift_mine::mine::{MineOptions, Mined, mine_with_kinds};
use drift_mine::roles::FileKinds;

fn file(path: &str, imports: &[String]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: m.clone(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        ..Default::default()
    }
}

/// Four lower layers `kit0/` .. `kit3/` (60 files each, the first of which imports a form)
/// below `views/forms/` (12 files, each importing every kit): four layering rules of the
/// same strength, more than the layering share of `--max 4` (one) lets through, so the
/// cap cuts some of them.
fn repo() -> RepoFacts {
    let mut files = Vec::new();
    for k in 0..4 {
        for i in 0..60 {
            let imports = if i == 0 {
                vec!["views/forms/f3.tsx".to_string()]
            } else {
                vec![]
            };
            files.push(file(&format!("kit{k}/k{i}.ts"), &imports));
        }
    }
    for i in 0..12 {
        let imports: Vec<String> = (0..4).map(|k| format!("kit{k}/k2.ts")).collect();
        files.push(file(&format!("views/forms/f{i}.tsx"), &imports));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn mined(r: &RepoFacts) -> Mined {
    mine_with_kinds(r, &MineOptions { max_per_repo: 4 }, FileKinds::learn(r))
}

/// What mining proposes and withholds, as text: the candidates whole, and the withheld
/// cards' ids with their reasons.
fn proposals(m: &Mined) -> String {
    let withheld: Vec<(String, String)> = m
        .withheld
        .iter()
        .map(|w| (w.candidate.id.clone(), format!("{:?}", w.reason)))
        .collect();
    format!(
        "{}\n{withheld:?}\n{} {}",
        serde_json::to_string(&m.candidates).unwrap(),
        m.units,
        m.roles_considered
    )
}

/// Pins that recording every gate changes nothing mining returns, on a repository where
/// a cap cuts, and that the cut is recorded at `cap_avoid`.
#[test]
fn recording_every_gate_changes_nothing_mining_proposes() {
    let r = repo();
    let plain = proposals(&mined(&r));

    funnel::start_counting();
    funnel::record(None);
    let recorded = mined(&r);
    let rows = funnel::take_dropped();
    let _ = funnel::finish();

    assert_eq!(plain, proposals(&recorded), "the record changed what mining returns");
    assert!(
        rows.iter().any(|d| d.gate == "cap_avoid"),
        "no cap_avoid row: {:#?}",
        rows.iter().map(|d| (d.gate, &d.rule)).collect::<Vec<_>>()
    );
}
