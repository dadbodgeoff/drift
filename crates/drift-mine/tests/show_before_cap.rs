//! The caps count shown cards only (round 11, recall11 P1): the 15 proposals per repo and
//! the layering share are taken after the show policy, so a card the policy hides never
//! takes the slot of one it shows. Before, mining capped first and the policy then
//! dropped the hidden cards, which could leave a repo with none of its admitted ones.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine, mine_unshown};
use drift_mine::tier::Tier;

const AUTH: &str = "lib/auth.ts#withAuth";

/// The folders of the hidden cards, and the name their members share.
const HIDDEN: [(&str, &str); 4] = [
    ("jobs", "Job"),
    ("tasks", "Task"),
    ("workers", "Worker"),
    ("runners", "Runner"),
];

fn func(name: &str, line: u32) -> Symbol {
    Symbol {
        name: name.into(),
        kind: SymbolKind::Function,
        exported_as: vec![name.into()],
        line,
        ..Default::default()
    }
}

fn ts(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        hash: "0".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..FileFacts::default()
    }
}

/// 40 routes, 38 wrapped in `withAuth` (a default-tier card); 20 services in `svc/`, 19
/// named `*Service` (one outlier: a suggestion the policy shows); and four folders of 40
/// members, 38 named `*Job`, `*Task`, `*Worker`, `*Runner` (two outliers each:
/// suggestions the policy hides, larger, so they rank above the services, and of
/// different names, so they are not merged into one card).
fn repo() -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        let mut s = func("GET", 3);
        if i < 38 {
            s.wraps.push(Wrap {
                wrapper: AUTH.into(),
                kind: WrapKind::Call,
            });
        }
        let mut f = ts(&format!("app/api/r{i:02}/route.ts"), vec![s]);
        f.entry_points.push(EntryPoint {
            symbol: "GET".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: None,
            adapter: "nextjs".into(),
        });
        files.push(f);
    }
    let mut groups = vec![("svc".to_string(), "Service", 20, 1)];
    for (dir, suffix) in HIDDEN {
        groups.push((dir.to_string(), suffix, 40, 2));
    }
    for (dir, suffix, n, plain) in groups {
        for i in 0..n {
            let name = if i < n - plain {
                format!("x{i:02}{suffix}")
            } else {
                format!("x{i:02}Helper")
            };
            files.push(ts(&format!("{dir}/{dir}{i:02}.ts"), vec![func(&name, 1)]));
        }
    }
    let mut auth = func("withAuth", 1);
    auth.controls = vec![drift_core::controls::REJECTS_CALLER.into(), "throw".into()];
    files.push(ts("lib/auth.ts", vec![auth]));
    let mut r = RepoFacts {
        schema_version: 1,
        files,
        skipped: vec![],
        ..Default::default()
    };
    r.normalize();
    r
}

fn naming_in<'a>(cs: &'a [Candidate], dir: &str) -> Option<&'a Candidate> {
    cs.iter()
        .find(|c| matches!(c.rule, Rule::Named { .. }) && c.role.dir == dir)
}

#[test]
fn hidden_cards_take_no_shown_cards_slot() {
    let r = repo();
    let wide = MineOptions { max_per_repo: 200 };
    let tight = MineOptions { max_per_repo: 3 };
    // The fixture: with every card, the services card is shown and the four job cards
    // are hidden, and the hidden ones fill a cap of 3 ahead of it.
    let all = mine_unshown(&r, &wide).candidates;
    let svc = naming_in(&all, "svc").expect("services card").clone();
    assert!(drift_mine::show::candidate_shown(&svc));
    for (dir, _) in HIDDEN {
        let c = naming_in(&all, dir).expect("a hidden naming card");
        assert!(!drift_mine::show::candidate_shown(c), "{}", c.id);
    }
    let capped_first = mine_unshown(&r, &tight).candidates;
    assert!(
        naming_in(&capped_first, "svc").is_none(),
        "the hidden cards crowd it out of a cap of 3: {capped_first:#?}"
    );
    // The product: the caps count shown cards only, so it is proposed, unchanged.
    let shown = mine(&r, &tight).candidates;
    let got = naming_in(&shown, "svc").expect("the services card is proposed under a cap of 3");
    assert_eq!(got, &svc);
    assert!(shown.iter().any(|c| c.tier() == Tier::Default));
    assert!(shown.len() <= 3, "{shown:#?}");
    for c in &shown {
        assert!(drift_mine::show::candidate_shown(c), "{}", c.id);
        assert!(
            all.contains(c),
            "a card it would not mine uncapped: {}",
            c.id
        );
    }
}

/// With no hidden card in the way, the caps keep what they kept before.
#[test]
fn without_hidden_cards_the_caps_are_unchanged() {
    let r = repo();
    let wide = MineOptions { max_per_repo: 200 };
    let shown_wide = mine(&r, &wide).candidates;
    let unshown_wide = mine_unshown(&r, &wide).candidates;
    // Uncapped, the policy only removes cards.
    for c in &shown_wide {
        assert!(unshown_wide.contains(c), "{}", c.id);
    }
    // A cap of 1 keeps the best shown card, which ranks first anyway.
    let one = mine(&r, &MineOptions { max_per_repo: 1 }).candidates;
    assert_eq!(one.len(), 1, "{one:#?}");
    let best = shown_wide
        .iter()
        .max_by(|a, b| a.score.total_cmp(&b.score))
        .expect("a shown card");
    assert_eq!(one[0].id, best.id);
}
