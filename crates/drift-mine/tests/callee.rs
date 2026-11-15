//! What a call or argument-key rule is about ([`Rule::exemption_in`]):
//!
//! - "pass `k` to `f()`" is about calls to `f`, in TypeScript as in Python: a member
//!   that never calls `f` (code `does_not_call`) passes nothing to it, while one that
//!   calls `f` without `k` is an outlier. Through the shared gate: an entry point that
//!   never calls `f` stays an outlier;
//! - a call or key rule about an in-repo callee is not about the other exports of the
//!   callee's module (code `defining_module`) when no member there follows the rule;
//! - a key rule with no outlier whose key the callee's type requires restates the type
//!   and is not proposed.
//!
//! The fixtures are made-up table builders and routers, not any dev repository's code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, View, units};

const PKG: &str = "db";
const COLUMN: &str = "db/lib/columns.ts#column";
const STAMP: &str = "db/lib/helpers.ts#stamped";

fn sym(name: &str, kind: SymbolKind, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    s
}

fn func(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    sym(name, SymbolKind::Function, edit)
}

fn file(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: PKG.into(),
        lang: "ts".into(),
        parse_ok: true,
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

/// 60 plain functions in another folder, so the rules have lift.
fn background(files: &mut Vec<FileFacts>) {
    for i in 0..60 {
        files.push(file(
            &format!("db/misc/m{i}.ts"),
            vec![func(&format!("misc{i}"), |_| {})],
        ));
    }
}

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

fn key_rule<'c>(cs: &'c [Candidate], key: &str) -> Option<&'c Candidate> {
    cs.iter()
        .find(|c| matches!(&c.rule, Rule::PassesKey { key: k, .. } if k == key))
}

fn outliers(c: &Candidate) -> Vec<&str> {
    c.outliers.iter().map(|o| o.symbol.as_str()).collect()
}

fn exempt(c: &Candidate) -> Vec<(&str, &str)> {
    c.exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.code.as_str()))
        .collect()
}

fn policy(r: &RepoFacts, c: &Candidate) -> ConventionsFile {
    let kinds = mine(r, &MineOptions::default()).kinds;
    let mut p = ConventionsFile::merge(None, "test", kinds, std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p
}

fn violators(r: &RepoFacts, c: &Candidate) -> Vec<String> {
    let mut v: Vec<String> = check(r, &policy(r, c), &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == c.id)
        .map(|v| v.symbol)
        .collect();
    v.sort();
    v
}

/// 40 tables in `db/src/tables/`, each calling `column(name, { withTimezone })`, but:
/// `table0` calls it without the key (a mistake), `table1` declares no column at all,
/// and `table2` declares its column through the helper [`STAMP`], which passes the key.
/// `key` is the parameter-type fact of every call passing the key (`required`, ...).
fn tables(key: Option<&str>, edit: impl Fn(usize, &mut Symbol)) -> RepoFacts {
    let passes = |s: &mut Symbol| {
        s.calls.push(COLUMN.into());
        s.args.push(format!("{COLUMN}@1:withTimezone"));
        if let Some(k) = key {
            s.arg_types.push(format!("{COLUMN}@1:withTimezone={k}"));
        }
    };
    let mut files = vec![
        file("db/lib/columns.ts", vec![func("column", |_| {})]),
        file("db/lib/helpers.ts", vec![func("stamped", |s| passes(s))]),
    ];
    for i in 0..40 {
        files.push(file(
            &format!("db/src/tables/t{i}.ts"),
            vec![func(&format!("table{i}"), |s| {
                match i {
                    0 => s.calls.push(COLUMN.into()),
                    1 => {}
                    2 => s.calls.push(STAMP.into()),
                    _ => passes(s),
                }
                edit(i, s);
            })],
        ));
    }
    background(&mut files);
    repo(files)
}

#[test]
fn a_key_rule_is_about_calls_to_the_callee_in_typescript() {
    let r = tables(None, |_, _| {});
    let cs = mined(&r);
    let c = key_rule(&cs, "withTimezone").expect("tables pass `withTimezone`");
    assert_eq!(outliers(c), ["table0"], "{:?}", exempt(c));
    assert_eq!(
        exempt(c),
        [("table1", "does_not_call"), ("table2", "does_not_call")]
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (37, 38));
    assert_eq!(violators(&r, c), ["table0"]);
}

#[test]
fn an_entry_point_that_never_calls_the_callee_stays_an_outlier() {
    // The same tables, each an HTTP handler: one that skips the call is reachable
    // code, and the gate refuses it every exemption.
    let mut r = tables(None, |_, _| {});
    for f in &mut r.files {
        if f.path.starts_with("db/src/tables/") {
            let name = f.symbols[0].name.clone();
            f.entry_points.push(EntryPoint {
                symbol: name.clone(),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some(format!("/{name}")),
                adapter: "express".into(),
            });
        }
    }
    let cs = mined(&r);
    let c = key_rule(&cs, "withTimezone").expect("handlers pass `withTimezone`");
    assert_eq!(
        outliers(c),
        ["table0", "table1", "table2"],
        "{:?}",
        exempt(c)
    );
    assert!(exempt(c).is_empty());
    assert_eq!(violators(&r, c), ["table0", "table1", "table2"]);
}

#[test]
fn a_single_file_scan_of_a_member_that_never_calls_needs_a_full_scan() {
    // Whether the callee guards an entry point elsewhere (which refuses the exemption)
    // is read from every file.
    let r = tables(None, |_, _| {});
    let cs = mined(&r);
    let p = policy(&r, key_rule(&cs, "withTimezone").unwrap());
    let one = |path: &str| {
        let mut one = r.clone();
        one.files.retain(|f| f.path == path);
        one
    };
    assert!(needs_full_scan(&one("db/src/tables/t1.ts"), &p));
    assert!(!needs_full_scan(&r, &p));
    // A member that calls the callee and passes the key is decided alone.
    assert!(!needs_full_scan(&one("db/src/tables/t5.ts"), &p));
}

#[test]
fn a_required_key_no_member_skips_restates_the_type() {
    // Every table that calls `column()` passes the key: no outlier.
    let none_left = |key: Option<&str>| {
        let all = |i: usize, s: &mut Symbol| {
            if i == 0 {
                // Passed in an argument the call facts do not list (`column(...spec)`),
                // so the key rule's holders are not the call rule's.
                s.calls.clear();
                s.args.push(format!("{COLUMN}@1:withTimezone"));
                if let Some(k) = key {
                    s.arg_types.push(format!("{COLUMN}@1:withTimezone={k}"));
                }
            }
        };
        key_rule(&mined(&tables(key, all)), "withTimezone").map(|c| c.outliers.len())
    };
    // The type requires it: the compiler rejects a call without it, and nobody skips it.
    assert_eq!(none_left(Some("required")), None);
    // Optional, unknown or no type facts: a convention the compiler does not enforce.
    assert_eq!(none_left(Some("optional")), Some(0));
    assert_eq!(none_left(Some("unknown")), Some(0));
    assert_eq!(none_left(None), Some(0));
    // A required key with an outlier left is still proposed.
    let c = mined(&tables(Some("required"), |_, _| {}));
    assert_eq!(
        key_rule(&c, "withTimezone").map(outliers),
        Some(vec!["table0"])
    );
}

const ROUTER: &str = "db/src/trpc/init.ts#createRouter";

/// 150 router files under `db/src/trpc/routers/`, each exporting a value built with
/// `createRouter({ procedures })` (`router0` leaves the key out), and
/// `db/src/trpc/init.ts`, which defines `createRouter` next to `publicProcedure` (calls
/// nothing) and `createCaller` (calls `createRouter()` without the key).
/// `init_follows` makes `publicProcedure` pass the key: the module holds a member.
/// `callee` names what the values call (the rule's callee).
fn routers(callee: &str, init_follows: bool) -> RepoFacts {
    let value = |name: &str, calls: bool, key: bool| {
        sym(name, SymbolKind::Const, |s| {
            if calls {
                s.calls.push(callee.into());
            }
            if key {
                s.args.push(format!("{callee}@0:procedures"));
            }
        })
    };
    let mut files = vec![file(
        "db/src/trpc/init.ts",
        vec![
            value("createRouter", false, false),
            value("publicProcedure", init_follows, init_follows),
            value("createCaller", true, false),
        ],
    )];
    for i in 0..150 {
        files.push(file(
            &format!("db/src/trpc/routers/r{i}.ts"),
            vec![value(&format!("router{i}"), true, i != 0)],
        ));
    }
    for i in 0..300 {
        files.push(file(
            &format!("db/misc/v{i}.ts"),
            vec![value(&format!("value{i}"), false, false)],
        ));
    }
    repo(files)
}

#[test]
fn the_callees_module_is_not_a_member_of_its_key_rule() {
    let r = routers(ROUTER, false);
    let cs = mined(&r);
    let c = key_rule(&cs, "procedures").unwrap_or_else(|| {
        panic!(
            "{:?}",
            cs.iter()
                .map(|c| (c.role.describe(), c.rule.describe()))
                .collect::<Vec<_>>()
        )
    });
    assert_eq!(outliers(c), ["router0"], "{:?}", exempt(c));
    assert_eq!(
        exempt(c),
        [
            ("createCaller", "defining_module"),
            ("createRouter", "does_not_call"),
            ("publicProcedure", "defining_module"),
        ]
    );
    assert_eq!(violators(&r, c), ["router0"]);
    // In facts of one file, the callee's module waits for a full scan (the callee may
    // guard an entry point elsewhere).
    let p = policy(&r, c);
    let mut one = r.clone();
    one.files.retain(|f| f.path == "db/src/trpc/init.ts");
    assert!(needs_full_scan(&one, &p));
}

#[test]
fn a_callees_module_whose_exports_follow_the_rule_holds_members() {
    // `publicProcedure` passes the key: the module holds members, so its export that
    // calls `createRouter()` without the key is an outlier like any other.
    let cs = mined(&routers(ROUTER, true));
    let c = key_rule(&cs, "procedures").expect("values pass `procedures`");
    let mut o = outliers(c);
    o.sort();
    assert_eq!(o, ["createCaller", "router0"], "{:?}", exempt(c));
}

#[test]
fn a_call_rule_in_one_file_of_the_callees_module_needs_a_full_scan() {
    // A call convention (accepted before TypeScript call rules were hidden, or about a
    // guard) exempts the callee module's exports only where the gate lets them through,
    // which a single-file scan cannot tell.
    let mut r = routers(ROUTER, false);
    // No export of the module calls `createRouter()`.
    for f in &mut r.files {
        for s in &mut f.symbols {
            if s.name == "createCaller" {
                s.calls.clear();
            }
        }
    }
    let cs = drift_mine::mine::mine_every_family(&r, &MineOptions { max_per_repo: 200 }).candidates;
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Calls { callee } if callee == ROUTER))
        .expect("values call createRouter");
    assert!(
        exempt(c).contains(&("publicProcedure", "defining_module")),
        "{:?}",
        exempt(c)
    );
    let p = policy(&r, c);
    let mut one = r.clone();
    one.files.retain(|f| f.path == "db/src/trpc/init.ts");
    assert!(needs_full_scan(&one, &p));
    // The rule itself says so for the module's export, whatever else asks for a scan.
    let all = units(&one, &FileKinds::learn(&one));
    let ctx = RepoContext::new(&one, &all);
    let file = &one.files[0];
    let export = file
        .symbols
        .iter()
        .find(|s| s.name == "publicProcedure")
        .unwrap();
    assert!(c.rule.exemption_undecided(
        Some(&c.role),
        &View::Symbol(file, export),
        &ctx,
        c.evidence.holders
    ));
    let mut member = r.clone();
    member
        .files
        .retain(|f| f.path == "db/src/trpc/routers/r7.ts");
    assert!(!needs_full_scan(&member, &p));
}
