//! Files a person set apart as a different kind of thing (`drift review`'s one question,
//! answer "No, these are different"): a path list `drift check` applies deterministically
//! (exemption code `different_kind`). [STRICT] It never covers an entry point under an auth
//! or validation rule unless the person confirmed that entry point by name, and a
//! single-file scan of a set-apart file under such a rule goes to a full scan.
//!
//! The fixtures are made-up table builders, not any dev repository's code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind};
use drift_mine::calibrate::auth_or_validation;
use drift_mine::check::{DIFFERENT_KIND, Scope, check, needs_full_scan};
use drift_mine::mine::{MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};

const COLUMN: &str = "db/lib/columns.ts#column";

fn func(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind: SymbolKind::Function,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    s
}

fn file(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: "db".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

/// 40 tables, each passing `withTimezone` to `column()`, but `table0`, which calls it
/// without the key; `entry`: every table is also an HTTP handler.
fn tables(entry: bool) -> RepoFacts {
    let mut files = vec![file("db/lib/columns.ts", vec![func("column", |_| {})])];
    for i in 0..40 {
        let mut f = file(
            &format!("db/src/tables/t{i}.ts"),
            vec![func(&format!("table{i}"), |s| {
                s.calls.push(COLUMN.into());
                if i != 0 {
                    s.args.push(format!("{COLUMN}@1:withTimezone"));
                }
            })],
        );
        if entry {
            f.entry_points.push(EntryPoint {
                symbol: format!("table{i}"),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some(format!("/t{i}")),
                adapter: "express".into(),
            });
        }
        files.push(f);
    }
    for i in 0..60 {
        files.push(file(
            &format!("db/misc/m{i}.ts"),
            vec![func(&format!("misc{i}"), |_| {})],
        ));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn policy(r: &RepoFacts) -> ConventionsFile {
    let m = mine(r, &MineOptions { max_per_repo: 200 });
    let c = m
        .candidates
        .iter()
        .find(|c| matches!(&c.rule, Rule::PassesKey { key, .. } if key == "withTimezone"))
        .expect("tables pass `withTimezone`")
        .clone();
    let mut p = ConventionsFile::merge(None, "test", m.kinds, std::slice::from_ref(&c));
    p.conventions[0].status = Status::Accepted;
    p
}

/// `(violations, set-apart exempt members)` of the one convention.
fn verdicts(r: &RepoFacts, p: &ConventionsFile) -> (Vec<String>, Vec<String>) {
    let report = check(r, p, &Lock::default(), Scope::Accepted, None);
    let v = report.violations.iter().map(|v| v.symbol.clone()).collect();
    let e = report
        .exempt
        .iter()
        .filter(|e| e.code == DIFFERENT_KIND)
        .map(|e| e.symbol.clone())
        .collect();
    (v, e)
}

#[test]
fn a_file_set_apart_is_exempt_by_path() {
    let r = tables(false);
    let mut p = policy(&r);
    assert!(auth_or_validation(&p.conventions[0].rule));
    assert_eq!(verdicts(&r, &p), (vec!["table0".into()], vec![]));
    // Another file set apart changes nothing; the outlier's file exempts it.
    p.conventions[0].set_different_kind("db/src/tables/t7.ts", &[]);
    assert_eq!(verdicts(&r, &p), (vec!["table0".into()], vec![]));
    p.conventions[0].set_different_kind("db/src/tables/t0.ts", &[]);
    assert_eq!(verdicts(&r, &p), (vec![], vec!["table0".into()]));
    // Written sorted, one per path, and read back as written.
    let text = serde_saphyr::to_string(&p).unwrap();
    assert!(
        text.contains(
            "  different_kind:\n  - path: db/src/tables/t0.ts\n  - path: db/src/tables/t7.ts\n"
        ),
        "{text}"
    );
}

/// [STRICT] An entry point under an auth or validation rule is covered only once the
/// person confirmed it by name.
#[test]
fn an_entry_point_is_covered_only_once_confirmed() {
    let r = tables(true);
    let mut p = policy(&r);
    p.conventions[0].set_different_kind("db/src/tables/t0.ts", &[]);
    assert_eq!(verdicts(&r, &p), (vec!["table0".into()], vec![]));
    // A confirmation of another symbol does not cover it.
    p.conventions[0].set_different_kind("db/src/tables/t0.ts", &["other".into()]);
    assert_eq!(verdicts(&r, &p), (vec!["table0".into()], vec![]));
    p.conventions[0].set_different_kind("db/src/tables/t0.ts", &["table0".into()]);
    assert_eq!(verdicts(&r, &p), (vec![], vec!["table0".into()]));
    assert_eq!(
        p.conventions[0].different_kind[0].entry_points,
        ["other", "table0"]
    );
}

/// A single-file scan of a set-apart file under an auth or validation rule goes to a full
/// scan: whether a member is an entry point is read from every file.
#[test]
fn a_single_file_scan_of_a_set_apart_file_needs_a_full_scan() {
    let r = tables(false);
    let mut p = policy(&r);
    let one = |path: &str| {
        let mut one = r.clone();
        one.files.retain(|f| f.path == path);
        one
    };
    assert!(!needs_full_scan(&one("db/src/tables/t5.ts"), &p));
    p.conventions[0].set_different_kind("db/src/tables/t5.ts", &[]);
    assert!(needs_full_scan(&one("db/src/tables/t5.ts"), &p));
    assert!(!needs_full_scan(&one("db/src/tables/t6.ts"), &p));
    assert!(!needs_full_scan(&r, &p));
}
