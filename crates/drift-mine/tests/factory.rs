//! A factory of a call-wrapper rule's members ([`Rule::exemption_in`], code `factory`):
//! a function that returns a function wrapped in the rule's wrapper
//! ([`drift_core::Symbol::returns_wrapped_by`]) is not a member that lacks the wrapper,
//! however few members use it. Through the shared gate ([`Rule::exemption_allowed`]):
//! never for an entry point, never under a guard rule. A call to the wrapper anywhere
//! else in a body makes no factory.
//!
//! The fixtures are background jobs (`defineJob()`), not any dev repository's code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, View, units};

const PKG: &str = "worker";
const JOBS: &str = "worker/src/jobs";
const DEFINE: &str = "worker/src/jobs/lib/define-job.ts#defineJob";
const GUARDED: &str = "worker/src/jobs/lib/with-auth.ts#withAuth";
const FACTORY: &str = "makeCronJob";

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

fn wrap(wrapper: &str) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind: WrapKind::Call,
    }
}

/// 45 jobs under `worker/src/jobs/**`, each `export default target(async (job) => ...)`;
/// `forgot.ts`, a job without it (a mistake); in `lib/`, the target itself,
/// [`FACTORY`] (returns `target(async () => ...)`, used by one value job
/// `export default makeCronJob("0 * * * *")`) and `retryLater` (calls the target in
/// its body but returns something else, used by one job). Plus 60 plain functions in
/// another package, so the rule has lift. `edit` changes the factory's symbol and
/// `extra` adds files.
fn jobs(target: &str, edit: impl FnOnce(&mut Symbol), extra: Vec<FileFacts>) -> RepoFacts {
    let lib = |f: &str| format!("{JOBS}/lib/{f}");
    let target_file = target.split_once('#').unwrap().0.to_string();
    let target_name = target.split_once('#').unwrap().1.to_string();
    let mut files: Vec<FileFacts> = (0..45)
        .map(|i| {
            let dir = ["billing", "email", "sync"][i % 3];
            file(
                &format!("{JOBS}/{dir}/job-{i}.ts"),
                vec![sym("default", SymbolKind::Function, &["default"], |s| {
                    s.wraps.push(wrap(target));
                    if i == 0 {
                        s.calls.push(lib("retry-later.ts#retryLater"));
                    }
                })],
            )
        })
        .collect();
    files.push(file(
        &format!("{JOBS}/sync/forgot.ts"),
        vec![sym("default", SymbolKind::Function, &["default"], |_| {})],
    ));
    files.push(file(
        &target_file,
        vec![sym(
            &target_name,
            SymbolKind::Function,
            &[&target_name],
            |_| {},
        )],
    ));
    let mut factory = sym(FACTORY, SymbolKind::Function, &[FACTORY], |s| {
        s.calls.push(target.into());
        s.returns_wrapped_by.push(target.into());
    });
    edit(&mut factory);
    files.push(file(&lib("make-cron-job.ts"), vec![factory]));
    files.push(file(
        &lib("retry-later.ts"),
        vec![sym(
            "retryLater",
            SymbolKind::Function,
            &["retryLater"],
            |s| {
                s.calls.push(target.into());
            },
        )],
    ));
    files.push(file(
        &format!("{JOBS}/email/hourly-digest.ts"),
        vec![sym("default", SymbolKind::Const, &["default"], |s| {
            s.calls.push(lib(&format!("make-cron-job.ts#{FACTORY}")));
        })],
    ));
    for i in 0..60 {
        let mut f = file(
            &format!("api/src/util/u{i}.ts"),
            vec![sym(
                &format!("util{i}"),
                SymbolKind::Function,
                &[&format!("util{i}")],
                |_| {},
            )],
        );
        f.package = "api".into();
        files.push(f);
    }
    files.extend(extra);
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

fn rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![target.into()],
    }
}

fn candidate<'a>(cs: &'a [Candidate], target: &str) -> &'a Candidate {
    cs.iter()
        .find(|c| c.rule == rule(target) && c.role.package == PKG)
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
    c.outliers.iter().map(|o| o.symbol.as_str()).collect()
}

fn exempt_codes(c: &Candidate) -> Vec<(&str, &str)> {
    c.exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.code.as_str()))
        .collect()
}

fn policy(c: &Candidate) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p
}

/// `drift check` with `c` accepted: the symbols it reports, and those it lists exempt
/// as factories.
fn checked(r: &RepoFacts, c: &Candidate) -> (Vec<String>, Vec<String>) {
    let report = check(r, &policy(c), &Lock::default(), Scope::Accepted, None);
    let mut v: Vec<String> = report.violations.iter().map(|v| v.symbol.clone()).collect();
    v.sort();
    let f = report
        .exempt
        .iter()
        .filter(|e| e.code == "factory")
        .map(|e| e.symbol.clone())
        .collect();
    (v, f)
}

/// `(exemption code, gate allows)` of the factory under `rule`, in the full facts.
fn gate(r: &RepoFacts, rule: &Rule) -> (Option<String>, bool) {
    let all = units(r, &FileKinds::learn(r));
    let ctx = RepoContext::new(r, &all);
    let u = all
        .iter()
        .find(|u| u.name() == FACTORY && matches!(u.view, View::Symbol(..)))
        .expect("the factory is a unit");
    (
        rule.exemption(&u.view, &ctx).map(|e| e.code),
        rule.exemption_allowed(&u.view, &ctx),
    )
}

#[test]
fn a_factory_of_wrapped_jobs_is_not_an_outlier() {
    let r = jobs(DEFINE, |_| {}, vec![]);
    let cs = mined(&r);
    let c = candidate(&cs, DEFINE);
    // The job that forgot its wrapper is reported, and so is `retryLater`: it calls the
    // wrapper but returns no wrapped function. The factory is used by one job only, so
    // it is no shared part (#52), but what it returns carries the wrapper.
    assert_eq!(outliers(c), ["retryLater", "default"]);
    assert!(
        exempt_codes(c).contains(&(FACTORY, "factory")),
        "{:?}",
        c.exempt
    );
    let why = c.exempt.iter().find(|e| e.symbol == FACTORY).unwrap();
    assert_eq!(
        why.reason,
        "a factory: returns a function wrapped in defineJob()"
    );
    // `drift check` agrees and lists it exempt.
    let (violators, factories) = checked(&r, c);
    assert_eq!(violators, ["default", "retryLater"]);
    assert_eq!(factories, [FACTORY]);
    assert_eq!(gate(&r, &c.rule), (Some("factory".into()), true));
}

#[test]
fn only_the_returned_value_and_an_exact_target_make_a_factory() {
    // Wrapped in another call than the rule's: not a factory of these jobs.
    let other = jobs(
        DEFINE,
        |s| s.returns_wrapped_by = vec!["worker/src/jobs/lib/trace.ts#withTrace".into()],
        vec![],
    );
    let cs = mined(&other);
    assert!(outliers(candidate(&cs, DEFINE)).contains(&FACTORY));
    // A method chain on the target (`defineJob.retry`) is not the target.
    let chained = jobs(
        DEFINE,
        |s| s.returns_wrapped_by = vec![format!("{DEFINE}.retry")],
        vec![],
    );
    assert_eq!(gate(&chained, &rule(DEFINE)), (None, true));
    // A class is never one.
    let class = jobs(DEFINE, |s| s.kind = SymbolKind::Class, vec![]);
    assert_eq!(gate(&class, &rule(DEFINE)).0, None);
}

/// The factory under a guard rule: named for access control (`withAuth`), or a target
/// that wraps an entry point somewhere in the repo (`defineJob` on a route).
#[test]
fn a_factory_under_a_guard_rule_is_reported() {
    let named = jobs(GUARDED, |_| {}, vec![]);
    assert_eq!(gate(&named, &rule(GUARDED)), (None, false));
    let cs = mined(&named);
    let c = candidate(&cs, GUARDED);
    assert!(outliers(c).contains(&FACTORY), "{:?}", c.exempt);
    assert!(!exempt_codes(c).contains(&(FACTORY, "factory")));
    let (violators, factories) = checked(&named, c);
    assert!(violators.contains(&FACTORY.to_string()));
    assert!(factories.is_empty());

    // `defineJob` also wraps a route handler: a guard as `drift security` reads one.
    let mut route = file(
        "worker/src/http/run.ts",
        vec![sym("POST", SymbolKind::Function, &["POST"], |s| {
            s.wraps.push(wrap(DEFINE));
        })],
    );
    route.entry_points.push(EntryPoint {
        symbol: "POST".into(),
        kind: "http".into(),
        method: Some("POST".into()),
        route: Some("/run".into()),
        adapter: "nextjs".into(),
    });
    let guarding = jobs(DEFINE, |_| {}, vec![route]);
    assert_eq!(gate(&guarding, &rule(DEFINE)), (None, false));
    let cs = mined(&guarding);
    let c = candidate(&cs, DEFINE);
    assert!(outliers(c).contains(&FACTORY), "{:?}", c.exempt);
    assert!(checked(&guarding, c).0.contains(&FACTORY.to_string()));
}

/// The factory as an entry point: its file declares it one, or a route refers to it by
/// reference (`router.post("/cron", makeCronJob)`).
#[test]
fn a_factory_that_is_an_entry_point_is_reported() {
    let declared = {
        let mut r = jobs(DEFINE, |_| {}, vec![]);
        let f = r
            .files
            .iter_mut()
            .find(|f| f.path.ends_with("make-cron-job.ts"))
            .unwrap();
        f.entry_points.push(EntryPoint {
            symbol: FACTORY.into(),
            kind: "http".into(),
            method: Some("POST".into()),
            route: Some("/cron".into()),
            adapter: "express".into(),
        });
        r
    };
    let mut routes = file("worker/src/server/routes.ts", vec![]);
    routes
        .symbols
        .push(sym("POST /cron", SymbolKind::Function, &[], |s| {
            s.calls
                .push(format!("{JOBS}/lib/make-cron-job.ts#{FACTORY}(ref)"));
        }));
    routes.entry_points.push(EntryPoint {
        symbol: "POST /cron".into(),
        kind: "http".into(),
        method: Some("POST".into()),
        route: Some("/cron".into()),
        adapter: "express".into(),
    });
    let by_reference = jobs(DEFINE, |_| {}, vec![routes]);
    for r in [&declared, &by_reference] {
        assert_eq!(gate(r, &rule(DEFINE)), (None, false));
        let all = units(r, &FileKinds::learn(r));
        let ctx = RepoContext::new(r, &all);
        let u = all.iter().find(|u| u.name() == FACTORY).unwrap();
        let View::Symbol(f, s) = u.view else {
            unreachable!()
        };
        assert!(ctx.is_entry_unit(f, s));
        let cs = mined(r);
        let c = candidate(&cs, DEFINE);
        assert!(!exempt_codes(c).contains(&(FACTORY, "factory")));
        let (violators, factories) = checked(r, c);
        assert!(factories.is_empty());
        // Declared an entry point, it sits in a role of entry points, judged by that
        // role's rules; referred to by a route, it stays in the jobs' role, reported.
        assert_eq!(u.in_role(&c.role), std::ptr::eq(r, &by_reference));
        if u.in_role(&c.role) {
            assert!(outliers(c).contains(&FACTORY), "{:?}", c.exempt);
            assert!(violators.contains(&FACTORY.to_string()));
        }
    }
}

#[test]
fn a_single_file_scan_of_a_factory_needs_a_full_scan() {
    // A hook's facts of the factory's file alone cannot see a route in another file
    // that refers to it, or an entry point its target wraps elsewhere: undecided.
    let r = jobs(DEFINE, |_| {}, vec![]);
    let cs = mined(&r);
    let p = policy(candidate(&cs, DEFINE));
    let mut one = r.clone();
    one.files.retain(|f| f.path.ends_with("make-cron-job.ts"));
    assert!(needs_full_scan(&one, &p));
    assert!(!needs_full_scan(&r, &p));
    // A job that holds the rule is decided alone.
    let mut held = r.clone();
    held.files.retain(|f| f.path.ends_with("job-1.ts"));
    assert!(!needs_full_scan(&held, &p));
}

#[test]
fn factories_are_deterministic() {
    let r = jobs(DEFINE, |_| {}, vec![]);
    let a = format!("{:?}", mined(&r));
    let b = format!("{:?}", mined(&r));
    assert_eq!(a, b);
}
