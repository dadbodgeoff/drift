//! The show policy in mining (`drift_mine::show`, eval/study/PLAN-R10.md §4): `mine` proposes
//! a suggestion only with at most one outlier and an admitted family; the default tier and
//! what a person accepted are unaffected.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine, mine_keeping, mine_unshown};
use drift_mine::tier::Tier;

const AUTH: &str = "lib/auth.ts#withAuth";

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

/// 40 routes, 38 wrapped in `withAuth` (a default-tier card with 2 outliers), 20 services
/// in `svc/` of which 19 are named `*Service` (one outlier), and 40 jobs in `jobs/` of
/// which 38 are named `*Job` (two outliers).
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
    for (dir, suffix, n, plain) in [("svc", "Service", 20, 1), ("jobs", "Job", 40, 2)] {
        for i in 0..n {
            let name = if i < n - plain {
                format!("x{i:02}{suffix}")
            } else {
                format!("x{i:02}Helper")
            };
            files.push(ts(&format!("{dir}/m{i:02}.ts"), vec![func(&name, 1)]));
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

fn opts() -> MineOptions {
    MineOptions { max_per_repo: 200 }
}

fn naming_in<'a>(cs: &'a [Candidate], dir: &str) -> Vec<&'a Candidate> {
    cs.iter()
        .filter(|c| matches!(c.rule, Rule::Named { .. }) && c.role.dir == dir)
        .collect()
}

fn outliers(c: &Candidate) -> usize {
    c.evidence.total - c.evidence.holders
}

#[test]
fn mining_proposes_only_what_the_show_policy_shows() {
    let r = repo();
    let all = mine_unshown(&r, &opts()).candidates;
    let shown = mine(&r, &opts()).candidates;
    for c in &all {
        eprintln!(
            "{} {:?} {} {}/{} {:?}",
            c.id,
            c.tier(),
            c.summary(),
            c.evidence.holders,
            c.evidence.total,
            c.rule
        );
    }
    // The miner finds both naming cards; the product proposes the one with one outlier.
    let a = naming_in(&all, "svc");
    let b = naming_in(&all, "jobs");
    assert_eq!(a.len(), 1, "{all:#?}");
    assert_eq!(b.len(), 1, "{all:#?}");
    assert_eq!((outliers(a[0]), outliers(b[0])), (1, 2));
    assert_eq!(a[0].tier(), Tier::Suggestion);
    assert!(shown.iter().any(|c| c.id == a[0].id));
    assert!(shown.iter().all(|c| c.id != b[0].id));
    // The default tier is untouched, outliers and all.
    let default: Vec<&Candidate> = all.iter().filter(|c| c.tier() == Tier::Default).collect();
    assert!(!default.is_empty());
    assert!(default.iter().any(|c| outliers(c) == 2));
    for d in default {
        assert!(shown.contains(d), "{}", d.id);
    }
    // Nothing new, and every suggestion left is one the policy shows.
    for c in &shown {
        assert!(all.contains(c), "{}", c.id);
        assert!(drift_mine::show::candidate_shown(c), "{}", c.id);
    }
}

/// Hysteresis keeps a convention a person accepted, whatever the show policy says.
#[test]
fn an_accepted_convention_is_kept() {
    let r = repo();
    let first = mine_unshown(&r, &opts());
    let b = naming_in(&first.candidates, "jobs")[0].clone();
    let kept = mine_keeping(
        &r,
        &opts(),
        first.kinds.clone(),
        &[(b.role.clone(), b.rule.clone())],
    );
    assert!(kept.candidates.iter().any(|c| c.id == b.id));
    let fresh = mine_keeping(&r, &opts(), first.kinds.clone(), &[]);
    assert!(fresh.candidates.iter().all(|c| c.id != b.id));
}
