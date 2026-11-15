//! A check with no convention in scope (nothing accepted yet, or everything rejected)
//! answers without building the repository's units and contexts: its report is the
//! files that were not checked and nothing else, whatever the policy proposes and
//! whatever the lock holds.

use std::collections::BTreeSet;

use drift_core::{FileFacts, Import, RepoFacts, SkipReason, Skipped, Symbol, SymbolKind};
use drift_mine::check::{Scope, check, check_gated};
use drift_mine::mine::{MineOptions, Rule, mine_every_family as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};

const LOG: &str = "lib/audit.ts#recordAudit";

fn func(path: &str, calls: &[&str], imports: &[&str]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: m.to_string(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        symbols: vec![Symbol {
            name: "run".into(),
            kind: SymbolKind::Function,
            exported_as: vec!["run".into()],
            line: 1,
            calls: calls.iter().map(|c| c.to_string()).collect(),
            ..Default::default()
        }],
        ..Default::default()
    }
}

/// 30 services that call the audit log and one that does not, 20 UI files that have
/// no reason to, and one file that was not parsed for lack of stack.
fn planted() -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            func(
                &format!("src/s/svc{i}.ts"),
                &[LOG],
                &["lib/audit.ts", "lib/db.ts"],
            )
        })
        .collect();
    files.extend((0..20).map(|i| func(&format!("src/ui/v{i}.ts"), &[], &["lib/ui.ts"])));
    files.push(func("src/s/late.ts", &[], &["lib/db.ts"]));
    let mut r = RepoFacts {
        files,
        skipped: vec![Skipped {
            path: "src/s/huge.ts".into(),
            reason: SkipReason::StackUnavailable,
        }],
        ..Default::default()
    };
    r.normalize();
    r
}

#[test]
fn nothing_in_scope_reports_the_unchecked_files_and_nothing_else() {
    let r = planted();
    let m = mine(&r, &MineOptions { max_per_repo: 100 });
    let mut p = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    p.conventions
        .retain(|c| matches!(&c.rule, Rule::Calls { callee } if callee == LOG));
    assert_eq!(
        p.conventions.len(),
        1,
        "the plant mines the calls convention"
    );
    // A lock entry of a convention out of scope is not "fixed": it is not looked at.
    let lock = Lock {
        entries: [(p.conventions[0].id.clone(), "src/s/late.ts#run".to_string())].into(),
    };
    let only: BTreeSet<String> = ["src/s/late.ts".to_string()].into();

    // Proposed only: `Scope::Accepted` has nothing in scope.
    let want = r#"{"violations":[],"fixed":[],"unchecked":["src/s/huge.ts"]}"#;
    for neighbour in [false, true] {
        let report = check_gated(&r, &p, &lock, Scope::Accepted, None, neighbour);
        assert_eq!(serde_json::to_string(&report).unwrap(), want);
    }
    // A file filter still filters the unchecked files.
    let report = check(&r, &p, &lock, Scope::Accepted, Some(&only));
    assert_eq!(
        serde_json::to_string(&report).unwrap(),
        r#"{"violations":[],"fixed":[]}"#
    );

    // Everything rejected: `Scope::All` has nothing in scope either.
    for c in &mut p.conventions {
        c.status = Status::Rejected;
    }
    let report = check(&r, &p, &lock, Scope::All, None);
    assert_eq!(serde_json::to_string(&report).unwrap(), want);

    // With the convention accepted the same facts are checked as they always were:
    // the outlier is found, and its lock entry is not reported fixed.
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    let report = check(&r, &p, &lock, Scope::Accepted, None);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.path == "src/s/late.ts" && v.baselined),
        "{:?}",
        report.violations
    );
    assert!(report.fixed.is_empty());
}
