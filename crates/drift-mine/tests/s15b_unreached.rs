//! S15b, item 5 (audit 4 §2 "Also noted", audit 1 G3): code that never runs is not
//! production code, and a file that did not parse holds no violation.
//!
//! - A snippet file that does not parse, and a file of an example app that imports
//!   nothing and that nothing imports, registers or lists, are set apart in the
//!   security inventory under their own heading ("not reached by anything Drift
//!   read"), with what they hold, instead of counted as production sinks and unlisted
//!   routes. Decided by what the facts say (imports, registrations, manifest entries,
//!   entry points, `parse_ok`), never by a directory's name: `example-apps` is in no
//!   list of Drift's.
//! - Under an accepted rule, a member in a file the parser reported errors in is not
//!   checked: never a violation.
//!
//! The fixtures are not any dev repository's code.

use drift_core::{FileFacts, Import, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};

fn sym(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
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

fn file(path: &str, parse_ok: bool, imports: &[&str], symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok,
        imports: imports
            .iter()
            .map(|m| Import {
                module: (*m).into(),
                names: vec!["run".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        symbols,
        ..Default::default()
    }
}

fn repo(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn with_sink(kind: &str) -> impl FnOnce(&mut Symbol) + '_ {
    move |s| s.sinks.push(kind.into())
}

/// Pins the inventory: before S15b the snippet's and the example app's sinks were
/// production sinks, and the snippet's registration an unlisted route.
#[test]
fn files_nothing_reaches_are_listed_apart_not_as_production() {
    let mut snippet = file(
        "data/static/codefixes/fix_1.ts",
        false,
        &[],
        vec![sym("fix", with_sink("eval"))],
    );
    snippet.unlisted_routes = vec![3];
    let r = repo(vec![
        file("app/main.ts", true, &["lib/run.ts"], vec![sym("main", |_| {})]),
        file("lib/run.ts", true, &[], vec![sym("run", with_sink("eval"))]),
        snippet,
        file(
            "example-apps/demo/index.ts",
            true,
            &[],
            vec![sym("demo", with_sink("shell_exec"))],
        ),
    ]);
    let inv = drift_mine::security::inventory(&r);
    // `lib/run.ts` imports nothing, but `app/main.ts` imports it: production.
    let sinks: Vec<&str> = inv.sinks.iter().map(|s| s.path.as_str()).collect();
    assert_eq!(sinks, ["lib/run.ts"], "{sinks:?}");
    assert!(inv.unlisted.is_empty(), "{:?}", inv.unlisted);
    let apart: Vec<&str> = inv.unreached.iter().map(|u| u.path.as_str()).collect();
    assert_eq!(
        apart,
        ["data/static/codefixes/fix_1.ts", "example-apps/demo/index.ts"]
    );
    let (snippet, demo) = (&inv.unreached[0], &inv.unreached[1]);
    assert!(!snippet.parsed && demo.parsed);
    assert_eq!(snippet.sinks, vec!["eval".to_string()]);
    assert_eq!(snippet.unlisted, vec![3u32]);
    assert_eq!(demo.sinks, vec!["shell_exec".to_string()]);
    assert!(demo.unlisted.is_empty());
    let text = drift_mine::security::render(&inv, None, 50);
    assert!(
        text.contains("2 files not reached by anything Drift read (data/static/codefixes/fix_1.ts, example-apps/demo/index.ts)"),
        "{text}"
    );
}

/// A file whose directory holds, at any depth, a file that is imported is not set
/// apart: a package's initialiser or barrel that imports nothing itself.
#[test]
fn a_file_beside_or_above_what_is_reached_stays_production() {
    let r = repo(vec![
        file("app/main.ts", true, &["pkg/core/impl.ts"], vec![sym("main", |_| {})]),
        file("pkg/core/impl.ts", true, &["pkg:zod"], vec![sym("impl", |_| {})]),
        file("pkg/index.ts", true, &[], vec![sym("init", with_sink("eval"))]),
    ]);
    let inv = drift_mine::security::inventory(&r);
    assert!(inv.unreached.is_empty(), "{:?}", inv.unreached);
    assert_eq!(inv.sinks.len(), 1);
}

const DEFINE: &str = "worker/src/jobs/lib/define-job.ts#defineJob";

fn job(path: &str, parse_ok: bool, wrapped: bool) -> FileFacts {
    FileFacts {
        package: "worker".into(),
        ..file(
            path,
            parse_ok,
            &[],
            vec![sym("default", |s| {
                if wrapped {
                    s.wraps.push(Wrap {
                        wrapper: DEFINE.into(),
                        kind: WrapKind::Call,
                    })
                }
            })],
        )
    }
}

/// Pins `check`: a job that forgot its wrapper in a file that did not parse is not a
/// violation of the accepted rule; the one in a file that parsed still is. Before S15b
/// both were reported.
#[test]
fn no_violation_is_reported_in_a_file_that_did_not_parse() {
    let mut files: Vec<FileFacts> = (0..45)
        .map(|i| job(&format!("worker/src/jobs/sync/job-{i}.ts"), true, true))
        .collect();
    files.push(job("worker/src/jobs/sync/bare-0.ts", true, false));
    files.push(job("worker/src/jobs/sync/broken.ts", false, false));
    files.push(FileFacts {
        package: "worker".into(),
        ..file(
            "worker/src/jobs/lib/define-job.ts",
            true,
            &[],
            vec![sym("defineJob", |_| {})],
        )
    });
    for i in 0..60 {
        files.push(FileFacts {
            package: "api".into(),
            ..file(
                &format!("api/src/util/u{i}.ts"),
                true,
                &[],
                vec![sym(&format!("util{i}"), |_| {})],
            )
        });
    }
    let r = repo(files);
    let cs = mine(&r, &MineOptions { max_per_repo: 200 }).candidates;
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Call, any_of } if any_of.iter().any(|a| a == DEFINE)))
        .cloned()
        .expect("the wrapper rule is mined");
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(&c));
    p.conventions[0].status = Status::Accepted;
    p.conventions[0].mode = Mode::Block;
    let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    let paths: Vec<&str> = report.violations.iter().map(|v| v.path.as_str()).collect();
    assert_eq!(paths, ["worker/src/jobs/sync/bare-0.ts"], "{paths:?}");
}
