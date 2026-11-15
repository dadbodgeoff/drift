//! Companions of a naming rule's followers ([`Rule::exemption_in`], code `companion`):
//! an export that shares its file with a member that follows the name scheme and is
//! something that member is built with, not a member of its kind. A helper the follower
//! calls, an `UPPER_SNAKE` constant beside it, or a class on another line than every
//! follower in the file. Through the shared gate ([`Rule::exemption_allowed`]): never
//! for an entry point. Never for a file's default export, for a peer of the followers'
//! shape, or for a member in a file without a follower.
//!
//! The fixtures are generic jobs, providers and schemas, not any dev repository's code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, View, units};

const PKG: &str = "worker";
const JOBS: &str = "worker/src/jobs";
const PROVIDERS: &str = "worker/src/providers";
const SCHEMAS: &str = "worker/src/schemas";
const BASE: &str = "worker/src/providers/base.ts#BaseProvider";
const ZOD: &str = "pkg:zod#z.object";

fn sym(name: &str, kind: SymbolKind, exported: &[&str], edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind,
        exported_as: exported.iter().map(|e| e.to_string()).collect(),
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    s
}

fn exported(name: &str, kind: SymbolKind, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    sym(name, kind, &[name], edit)
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

fn extends(base: &str) -> Wrap {
    Wrap {
        wrapper: base.into(),
        kind: WrapKind::Extends,
    }
}

/// 40 job files under `worker/src/jobs/`, each exporting `job{i}Handler`, and:
///
/// - `job0.ts`: `loadRecord`, which `job0Handler` calls (a companion);
/// - `job1.ts`: `exportReport`, which nothing in its file uses (a peer, misnamed);
/// - `job2.ts`: `runNightly`, its file's default export, which `job2Handler` calls;
/// - `cleanup.ts`: `cleanup` alone in its file (no follower beside it).
///
/// 40 provider files under `worker/src/providers/`, each a class `P{i}Provider` on
/// `BaseProvider`, and:
///
/// - `p0.ts`: `RateLimitError extends Error` (another line: a companion);
/// - `p1.ts`: `P1Options`, a plain class beside a follower on the base (a companion);
/// - `p2.ts`: the follower is plain (no base), and so is `P2Settings` beside it (a peer);
/// - `p3.ts`: `P3Client extends BaseProvider`, on the followers' line (a peer).
///
/// 40 schema files under `worker/src/schemas/`, each `s{i}Schema = z.object(...)`, and:
///
/// - `s0.ts`: `MAX_NAME_LENGTH`, an `UPPER_SNAKE` constant (a companion);
/// - `s1.ts`: `nameRules = z.object(...)`, unused (a peer, misnamed).
///
/// Plus 60 plain functions, classes and values in another package, so the rules have
/// lift. `edit` changes the repo before it is normalised.
fn repo(edit: impl FnOnce(&mut Vec<FileFacts>)) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        let path = format!("{JOBS}/job{i}.ts");
        let mut syms = vec![exported(
            &format!("job{i}Handler"),
            SymbolKind::Function,
            |s| match i {
                0 => s.calls.push(format!("{path}#loadRecord")),
                2 => s.calls.push(format!("{path}#runNightly")),
                _ => {}
            },
        )];
        match i {
            0 => syms.push(exported("loadRecord", SymbolKind::Function, |_| {})),
            1 => syms.push(exported("exportReport", SymbolKind::Function, |_| {})),
            2 => syms.push(sym(
                "runNightly",
                SymbolKind::Function,
                &["default"],
                |_| {},
            )),
            _ => {}
        }
        files.push(file(&path, syms));
    }
    files.push(file(
        &format!("{JOBS}/cleanup.ts"),
        vec![exported("cleanup", SymbolKind::Function, |_| {})],
    ));
    files.push(file(
        &format!("{PROVIDERS}/base.ts"),
        vec![exported("BaseProvider", SymbolKind::Class, |_| {})],
    ));
    for i in 0..40 {
        let path = format!("{PROVIDERS}/p{i}.ts");
        let mut syms = vec![exported(&format!("P{i}Provider"), SymbolKind::Class, |s| {
            if i != 2 {
                s.wraps.push(extends(BASE));
            }
        })];
        match i {
            0 => syms.push(exported("RateLimitError", SymbolKind::Class, |s| {
                s.wraps.push(extends("global#Error"));
            })),
            1 => syms.push(exported("P1Options", SymbolKind::Class, |_| {})),
            2 => syms.push(exported("P2Settings", SymbolKind::Class, |_| {})),
            3 => syms.push(exported("P3Client", SymbolKind::Class, |s| {
                s.wraps.push(extends(BASE));
            })),
            _ => {}
        }
        files.push(file(&path, syms));
    }
    for i in 0..40 {
        let path = format!("{SCHEMAS}/s{i}.ts");
        let mut syms = vec![exported(&format!("s{i}Schema"), SymbolKind::Const, |s| {
            s.calls.push(ZOD.into());
        })];
        match i {
            0 => syms.push(exported("MAX_NAME_LENGTH", SymbolKind::Const, |_| {})),
            1 => syms.push(exported("nameRules", SymbolKind::Const, |s| {
                s.calls.push(ZOD.into());
            })),
            _ => {}
        }
        files.push(file(&path, syms));
    }
    for i in 0..60 {
        let mut f = file(
            &format!("api/src/util/u{i}.ts"),
            vec![
                exported(&format!("util{i}"), SymbolKind::Function, |_| {}),
                exported(&format!("Thing{i}"), SymbolKind::Class, |_| {}),
                exported(&format!("value{i}"), SymbolKind::Const, |_| {}),
            ],
        );
        f.package = "api".into();
        files.push(f);
    }
    edit(&mut files);
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

fn named(pattern: &str) -> Rule {
    Rule::Named {
        pattern: pattern.into(),
    }
}

fn candidate<'a>(cs: &'a [Candidate], pattern: &str) -> &'a Candidate {
    cs.iter()
        .find(|c| c.rule == named(pattern) && c.role.package == PKG)
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (c.role.describe(), c.rule.describe()))
                    .collect::<Vec<_>>()
            )
        })
}

fn outliers(c: &Candidate) -> Vec<&str> {
    let mut v: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    v.sort();
    v
}

fn companions(c: &Candidate) -> Vec<(&str, &str)> {
    let mut v: Vec<(&str, &str)> = c
        .exempt
        .iter()
        .filter(|e| e.code == "companion")
        .map(|e| (e.symbol.as_str(), e.reason.as_str()))
        .collect();
    v.sort();
    v
}

fn policy(c: &Candidate) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p
}

/// `drift check` with `c` accepted: the symbols it reports.
fn violators(r: &RepoFacts, c: &Candidate) -> Vec<String> {
    let report = check(r, &policy(c), &Lock::default(), Scope::Accepted, None);
    let mut v: Vec<String> = report.violations.iter().map(|v| v.symbol.clone()).collect();
    v.sort();
    v
}

/// `(exemption code, gate allows)` of `name` under `c`'s rule, as a member of its role,
/// in the full facts.
fn gate(r: &RepoFacts, c: &Candidate, name: &str) -> (Option<String>, bool) {
    let all = units(r, &FileKinds::learn(r));
    let ctx = RepoContext::new(r, &all);
    let u = all
        .iter()
        .find(|u| u.name() == name && matches!(u.view, View::Symbol(..)))
        .expect("a unit");
    (
        c.rule
            .exemption_in(Some(&c.role), &u.view, &ctx)
            .map(|e| e.code),
        c.rule.exemption_allowed(&u.view, &ctx),
    )
}

#[test]
fn a_helper_a_follower_uses_in_its_file_is_a_companion() {
    let r = repo(|_| {});
    let cs = mined(&r);
    let c = candidate(&cs, "*Handler");
    assert_eq!(
        companions(c),
        [(
            "loadRecord",
            "a helper of job0Handler, which uses it in its file"
        )]
    );
    // An unused peer beside a follower, a default export its follower calls, and a
    // function alone in its file stay outliers.
    assert_eq!(outliers(c), ["cleanup", "exportReport", "runNightly"]);
    assert_eq!(violators(&r, c), ["cleanup", "exportReport", "runNightly"]);
    assert_eq!(gate(&r, c, "loadRecord"), (Some("companion".into()), true));
}

#[test]
fn a_class_on_another_line_than_its_files_followers_is_a_companion() {
    let r = repo(|_| {});
    let cs = mined(&r);
    let c = candidate(&cs, "*Provider");
    assert_eq!(
        companions(c),
        [
            (
                "P1Options",
                "a plain class beside P1Provider, which follows the scheme on its base"
            ),
            (
                "RateLimitError",
                "another kind of class (extends Error) beside P0Provider, which follows the scheme"
            ),
        ]
    );
    // A plain class beside a plain follower, and a class on the followers' base, are
    // peers: misnamed members.
    assert_eq!(outliers(c), ["P2Settings", "P3Client"]);
    assert_eq!(violators(&r, c), ["P2Settings", "P3Client"]);
}

#[test]
fn an_upper_snake_constant_beside_a_follower_is_a_companion() {
    let r = repo(|_| {});
    let cs = mined(&r);
    let c = candidate(&cs, "*Schema");
    assert_eq!(
        companions(c),
        [(
            "MAX_NAME_LENGTH",
            "a constant beside s0Schema, which follows the scheme"
        )]
    );
    // A value built like the followers (`z.object`) that nothing uses is a peer.
    assert_eq!(outliers(c), ["nameRules"]);
    // Alone in a file, the constant is an outlier: no follower beside it.
    let alone = repo(|files| {
        let f = files
            .iter_mut()
            .find(|f| f.path == format!("{SCHEMAS}/s0.ts"))
            .unwrap();
        f.symbols.retain(|s| s.name == "MAX_NAME_LENGTH");
    });
    let cs = mined(&alone);
    let c = candidate(&cs, "*Schema");
    assert_eq!(gate(&alone, c, "MAX_NAME_LENGTH"), (None, true));
    assert!(outliers(c).contains(&"MAX_NAME_LENGTH"));
}

/// The helper as an entry point: a route in another file refers to it
/// (`router.post("/load", loadRecord)`).
#[test]
fn a_companion_that_is_an_entry_point_is_reported() {
    let r = repo(|files| {
        let mut routes = file("worker/src/server/routes.ts", vec![]);
        routes
            .symbols
            .push(sym("POST /load", SymbolKind::Function, &[], |s| {
                s.calls.push(format!("{JOBS}/job0.ts#loadRecord(ref)"));
            }));
        routes.entry_points.push(EntryPoint {
            symbol: "POST /load".into(),
            kind: "http".into(),
            method: Some("POST".into()),
            route: Some("/load".into()),
            adapter: "express".into(),
        });
        files.push(routes);
    });
    let cs = mined(&r);
    let c = candidate(&cs, "*Handler");
    assert_eq!(gate(&r, c, "loadRecord"), (None, false));
    assert!(companions(c).is_empty(), "{:?}", c.exempt);
    assert!(outliers(c).contains(&"loadRecord"));
    assert!(violators(&r, c).contains(&"loadRecord".to_string()));
}

#[test]
fn a_single_file_scan_of_a_companion_needs_a_full_scan() {
    // A hook's facts of the helper's file alone cannot see a route in another file that
    // refers to it: undecided. The exemption is for a member of a role only, so on its
    // own the helper does not hold the rule, and the hook scans the repo.
    let r = repo(|_| {});
    let cs = mined(&r);
    let p = policy(candidate(&cs, "*Handler"));
    let mut one = r.clone();
    one.files.retain(|f| f.path == format!("{JOBS}/job0.ts"));
    assert!(needs_full_scan(&one, &p));
    assert!(!needs_full_scan(&r, &p));
    // A file with no companion is decided alone.
    let mut plain = r.clone();
    plain.files.retain(|f| f.path == format!("{JOBS}/job5.ts"));
    assert!(!needs_full_scan(&plain, &p));
}

/// A helper that several members use is a shared part of the role (#52), and keeps
/// that reason.
#[test]
fn a_shared_part_stays_a_shared_part() {
    let r = repo(|files| {
        let at = |files: &mut Vec<FileFacts>, i: usize| {
            files
                .iter()
                .position(|f| f.path == format!("{JOBS}/job{i}.ts"))
                .unwrap()
        };
        let three = at(files, 3);
        files[three]
            .symbols
            .push(exported("loadShared", SymbolKind::Function, |_| {}));
        for i in [3, 4] {
            let k = at(files, i);
            files[k].symbols[0]
                .calls
                .push(format!("{JOBS}/job3.ts#loadShared"));
        }
    });
    let cs = mined(&r);
    let c = candidate(&cs, "*Handler");
    let shared: Vec<&str> = c
        .exempt
        .iter()
        .filter(|e| e.code == "shared_part")
        .map(|e| e.symbol.as_str())
        .collect();
    assert_eq!(shared, ["loadShared"], "{:?}", c.exempt);
    assert!(!companions(c).iter().any(|(s, _)| *s == "loadShared"));
}

/// Python's name-suffix rules exempt nobody (#27): the same files in Python keep
/// every outlier.
#[test]
fn python_has_no_companions() {
    let r = repo(|files| {
        for f in files.iter_mut() {
            f.lang = "py".into();
            f.path = f.path.replace(".ts", ".py");
            for s in &mut f.symbols {
                for c in &mut s.calls {
                    *c = c.replace(".ts#", ".py#");
                }
            }
        }
    });
    let cs = mined(&r);
    let c = candidate(&cs, "*Handler");
    assert!(companions(c).is_empty(), "{:?}", c.exempt);
    assert!(outliers(c).contains(&"loadRecord"));
}

#[test]
fn companions_are_deterministic() {
    let r = repo(|_| {});
    assert_eq!(format!("{:?}", mined(&r)), format!("{:?}", mined(&r)));
}
