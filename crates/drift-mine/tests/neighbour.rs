//! The neighbour gate (round 11, WS-J) on planted repos: a new outlier nearer a member
//! a reviewer marked fine than the holders is held back, listed and never new; one nearer
//! the holders warns; nobody set apart warns; never under a guard rule or a validation
//! rule, never on an entry point [STRICT].

use drift_core::{EntryPoint, FileFacts, Import, RepoFacts, Symbol, SymbolKind};
use drift_mine::check::{CheckReport, Scope, check, check_gated};
use drift_mine::mine::{MineOptions, Rule, mine_every_family as mine};
use drift_mine::neighbour::may_hold_back;
use drift_mine::policy::{ConventionsFile, Exception, Lock, Status};

fn import(module: &str) -> Import {
    Import {
        module: module.into(),
        names: vec!["x".into()],
        type_only: false,
        load: Default::default(),
    }
}

fn func(path: &str, calls: &[&str], imports: &[&str]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        imports: imports.iter().map(|m| import(m)).collect(),
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

fn repo(mut files: Vec<FileFacts>) -> RepoFacts {
    for f in &mut files {
        for s in &mut f.symbols {
            s.calls.sort();
        }
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

const LOG: &str = "lib/audit.ts#recordAudit";

/// 30 services that call `log()` and import the database, 20 UI files that do not call
/// it, and three outliers among the services: `s/tool-a.ts` and `s/tool-b.ts` import the
/// CLI helpers (like each other, unlike the services), `s/late.ts` imports what the
/// services import.
fn planted(callee: &str) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..30 {
        files.push(func(
            &format!("s/svc{i}.ts"),
            &[callee],
            &["lib/audit.ts", "lib/db.ts", "lib/cache.ts"],
        ));
    }
    for i in 0..20 {
        files.push(func(&format!("ui/v{i}.ts"), &[], &["lib/ui.ts"]));
    }
    files.push(func("s/tool-a.ts", &[], &["lib/cli.ts", "lib/argv.ts"]));
    files.push(func("s/tool-b.ts", &[], &["lib/cli.ts", "lib/argv.ts"]));
    files.push(func("s/late.ts", &[], &["lib/db.ts", "lib/cache.ts"]));
    for f in &mut files {
        f.path = format!("src/{}", f.path);
    }
    repo(files)
}

/// Mine, accept the `calls` convention, mark `src/s/tool-a.ts#run` fine, and check.
fn checked(r: &RepoFacts, callee: &str, exception: bool) -> CheckReport {
    let m = mine(r, &MineOptions { max_per_repo: 100 });
    let mut p = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    p.conventions
        .retain(|c| matches!(&c.rule, Rule::Calls { callee: k } if k == callee));
    assert_eq!(
        p.conventions.len(),
        1,
        "one calls convention: {:?}",
        m.candidates.iter().map(|c| &c.rule).collect::<Vec<_>>()
    );
    for c in &mut p.conventions {
        c.status = Status::Accepted;
        if exception {
            c.exceptions.push(Exception {
                member: "src/s/tool-a.ts#run".into(),
                reason: "a CLI tool, not a service".into(),
            });
        }
    }
    check_gated(r, &p, &Lock::default(), Scope::Accepted, None, true)
}

fn new_keys(r: &CheckReport) -> Vec<String> {
    r.new_violations()
        .map(|v| format!("{}#{}", v.path, v.symbol))
        .collect()
}

#[test]
fn an_outlier_nearer_a_reviewers_exception_is_held_back_and_listed() {
    let r = planted(LOG);
    let report = checked(&r, LOG, true);
    // tool-b is the tool-a kind of member: held back; late looks like the services: warned.
    assert_eq!(new_keys(&report), vec!["src/s/late.ts#run".to_string()]);
    assert_eq!(
        report.suppressed_neighbour.len(),
        1,
        "{:?}",
        report.suppressed_neighbour
    );
    let h = &report.suppressed_neighbour[0];
    assert_eq!(
        (
            h.path.as_str(),
            h.nearest_apart.as_str(),
            h.apart_code.as_str()
        ),
        ("src/s/tool-b.ts", "src/s/tool-a.ts#run", "reviewed")
    );
    assert!(h.apart_distance < h.holder_distance);
    // Kept in `violations`, marked, never dropped [STRICT]; and listed in the JSON.
    let v = report
        .violations
        .iter()
        .find(|v| v.path == "src/s/tool-b.ts")
        .expect("still a violation");
    assert!(v.suppressed_neighbour);
    assert_eq!(report.held_by_neighbour().count(), 1);
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["suppressed_neighbour"][0]["path"], "src/s/tool-b.ts");
    assert!(
        json["violations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["suppressed_neighbour"] == true)
    );
}

#[test]
fn nobody_set_apart_warns_as_before() {
    let r = planted(LOG);
    let report = checked(&r, LOG, false);
    assert_eq!(
        new_keys(&report),
        vec![
            "src/s/late.ts#run",
            "src/s/tool-a.ts#run",
            "src/s/tool-b.ts#run"
        ]
    );
    assert!(report.suppressed_neighbour.is_empty());
    let json = serde_json::to_value(&report).unwrap();
    assert!(
        json.get("suppressed_neighbour").is_none(),
        "absent when empty: {json}"
    );
}

#[test]
fn a_check_of_one_file_reads_the_holders_and_exceptions_of_the_rest() {
    let r = planted(LOG);
    let m = mine(&r, &MineOptions { max_per_repo: 100 });
    let mut p = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    p.conventions
        .retain(|c| matches!(&c.rule, Rule::Calls { callee } if callee == LOG));
    for c in &mut p.conventions {
        c.status = Status::Accepted;
        c.exceptions.push(Exception {
            member: "src/s/tool-a.ts#run".into(),
            reason: "a CLI tool".into(),
        });
    }
    let only = ["src/s/tool-b.ts".to_string()].into_iter().collect();
    let report = check_gated(&r, &p, &Lock::default(), Scope::Accepted, Some(&only), true);
    assert_eq!(new_keys(&report), Vec::<String>::new());
    assert_eq!(report.suppressed_neighbour.len(), 1);
}

#[test]
fn never_held_back_under_a_guard_rule() {
    // `requireUser` names access control: what no exemption may leave out.
    const GUARD: &str = "lib/auth.ts#requireUser";
    let r = planted(GUARD);
    let report = checked(&r, GUARD, true);
    assert_eq!(
        new_keys(&report),
        vec!["src/s/late.ts#run", "src/s/tool-b.ts#run"]
    );
    assert!(report.suppressed_neighbour.is_empty());
}

#[test]
fn never_held_back_on_an_entry_point_or_under_a_validation_rule() {
    let mut files = vec![func("app/api/x/route.ts", &[], &["lib/db.ts"])];
    files[0].symbols[0].name = "GET".into();
    files[0].symbols[0].exported_as = vec!["GET".into()];
    files[0].entry_points.push(EntryPoint {
        symbol: "GET".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/api/x".into()),
        adapter: "nextjs".into(),
    });
    files.push(func("lib/helper.ts", &[], &["lib/db.ts"]));
    let r = repo(files);
    let units = drift_mine::roles::units(&r, &drift_mine::roles::FileKinds::learn(&r));
    let ctx = drift_mine::context::RepoContext::new(&r, &units);
    let view = |path: &str| {
        units
            .iter()
            .find(|u| u.path() == path && u.name() != "(file)")
            .expect(path)
            .view
    };
    let calls: Rule =
        serde_json::from_str(r#"{"type":"calls","callee":"lib/log.ts#log"}"#).unwrap();
    let validates: Rule =
        serde_json::from_str(r#"{"type":"control","value":"validates"}"#).unwrap();
    assert!(may_hold_back(&calls, &view("lib/helper.ts"), &ctx));
    assert!(
        !may_hold_back(&calls, &view("app/api/x/route.ts"), &ctx),
        "an entry point"
    );
    assert!(
        !may_hold_back(&validates, &view("lib/helper.ts"), &ctx),
        "a validation rule"
    );
}

#[test]
fn off_by_default_and_never_for_the_lock() {
    let r = planted(LOG);
    let m = mine(&r, &MineOptions { max_per_repo: 100 });
    let mut p = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    p.conventions
        .retain(|c| matches!(&c.rule, Rule::Calls { callee } if callee == LOG));
    for c in &mut p.conventions {
        c.status = Status::Accepted;
        c.exceptions.push(Exception {
            member: "src/s/tool-a.ts#run".into(),
            reason: "a CLI tool".into(),
        });
    }
    // Off unless `DRIFT_NEIGHBOUR_GATE=on` (admission withdrawn, round 11).
    if std::env::var_os(drift_mine::check::NEIGHBOUR_GATE_ENV).is_none() {
        let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
        assert!(
            report.suppressed_neighbour.is_empty(),
            "off unless asked for"
        );
        assert_eq!(new_keys(&report).len(), 2);
    }
    let on = check_gated(&r, &p, &Lock::default(), Scope::Accepted, None, true);
    assert_eq!(on.suppressed_neighbour.len(), 1);
    // `init` builds the lock from every violation: the gate never runs there.
    let all = check_gated(&r, &p, &Lock::default(), Scope::All, None, true);
    assert!(all.suppressed_neighbour.is_empty());
}

#[test]
fn a_signature_leaves_out_the_modules_the_rule_names() {
    let r = repo(vec![func(
        "src/s/a.ts",
        &[LOG],
        &["lib/audit.ts", "lib/db.ts"],
    )]);
    let units = drift_mine::roles::units(&r, &drift_mine::roles::FileKinds::learn(&r));
    let u = units.iter().find(|u| u.name() == "run").expect("run");
    let rule = Rule::Calls { callee: LOG.into() };
    let consumers = drift_mine::neighbour::Consumers::learn(&r);
    let sig = drift_mine::neighbour::signature(
        u,
        &consumers,
        &drift_mine::neighbour::rule_modules(&rule),
    );
    let imports: Vec<&str> = sig.imports.iter().map(String::as_str).collect();
    assert_eq!(imports, vec!["lib/db.ts"]);
    assert!(sig.export.contains("export:named") && sig.export.contains("entry:-"));
}
