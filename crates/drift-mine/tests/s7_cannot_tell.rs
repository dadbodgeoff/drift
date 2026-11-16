//! S7: a mined, accepted rule never fires where Drift cannot read.
//!
//! - A member whose deciding fact is opaque (a call wrapper a factory builds, a wrapper
//!   that does not resolve) is not checked: counted in the rule's standing, never a
//!   violation. Mining and `init`'s lock read it as before.
//! - An entry point the practice map cannot tell for the concern a guard rule's target
//!   does (the cal.com shape: a public tRPC procedure under "procedures use
//!   `authedProcedure`") is set aside the same way. The concern is read from what the
//!   classifier found, never from a name.
//! - A rule whose role emptied, or whose holders fell under the share that made it a
//!   rule, is stale and advises, and says "was block, now advise because ...".
//!
//! Every test here fails before S7: `check` had no three-valued answer, no standing, no
//! map step and no staleness. The fixtures are not any dev repository's code.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{CheckReport, Scope, check, effective_mode, mode_now};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};
use drift_mine::practices::{ConcernReport, PracticesReport, UnitRow, Variant};

const PKG: &str = "worker";
const JOBS: &str = "worker/src/jobs";
const DEFINE: &str = "worker/src/jobs/lib/define-job.ts#defineJob";
/// A wrapper a factory call returns (`export const tracked = makeWrapper(opts)`).
const TRACKED: &str = "api/src/wrap/tracked.ts#tracked";
const MAKE: &str = "api/src/wrap/make.ts#makeWrapper";

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

fn file(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: package.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn call(wrapper: &str) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind: WrapKind::Call,
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

/// 60 plain functions in another package, so a rule of the role has lift.
fn background() -> Vec<FileFacts> {
    (0..60)
        .map(|i| {
            file(
                &format!("api/src/util/u{i}.ts"),
                "api",
                vec![sym(&format!("util{i}"), SymbolKind::Function, |_| {})],
            )
        })
        .collect()
}

/// `wrapped` jobs under `worker/src/jobs/**` wrapped in `defineJob()`, `bare` jobs
/// wrapped in nothing, and the jobs `extra` adds.
fn jobs(wrapped: usize, bare: usize, extra: Vec<FileFacts>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..wrapped {
        let dir = ["billing", "email", "sync"][i % 3];
        files.push(file(
            &format!("{JOBS}/{dir}/job-{i}.ts"),
            PKG,
            vec![sym("default", SymbolKind::Function, |s| {
                s.wraps.push(call(DEFINE))
            })],
        ));
    }
    for i in 0..bare {
        files.push(file(
            &format!("{JOBS}/sync/bare-{i}.ts"),
            PKG,
            vec![sym("default", SymbolKind::Function, |_| {})],
        ));
    }
    files.push(file(
        "worker/src/jobs/lib/define-job.ts",
        PKG,
        vec![sym("defineJob", SymbolKind::Function, |_| {})],
    ));
    files.push(file(
        "api/src/wrap/make.ts",
        "api",
        vec![sym("makeWrapper", SymbolKind::Function, |_| {})],
    ));
    files.push(file(
        "api/src/wrap/tracked.ts",
        "api",
        vec![sym("tracked", SymbolKind::Function, |s| {
            s.made_by = MAKE.into()
        })],
    ));
    files.extend(background());
    files.extend(extra);
    repo(files)
}

/// The two jobs Drift cannot tell: one wrapped in a wrapper a factory builds, one in a
/// wrapper that does not resolve.
fn opaque_jobs() -> Vec<FileFacts> {
    vec![
        file(
            &format!("{JOBS}/sync/made.ts"),
            PKG,
            vec![sym("default", SymbolKind::Function, |s| {
                s.wraps.push(call(TRACKED))
            })],
        ),
        file(
            &format!("{JOBS}/sync/elsewhere.ts"),
            PKG,
            vec![sym("default", SymbolKind::Function, |s| {
                s.wraps.push(call("unresolved:@acme/jobs#wrapIt"))
            })],
        ),
    ]
}

fn wrapped_by(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![target.into()],
    }
}

fn candidate(r: &RepoFacts, target: &str) -> Candidate {
    let cs = mine(r, &MineOptions { max_per_repo: 200 }).candidates;
    cs.iter()
        .find(|c| {
            c.rule == wrapped_by(target)
                || matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Call, any_of }
                    if any_of.iter().any(|a| a == target))
        })
        .cloned()
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (c.role.describe(), c.rule.describe()))
                    .collect::<Vec<_>>()
            )
        })
}

fn accepted(c: &Candidate, mode: Mode) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p.conventions[0].mode = mode;
    p
}

fn paths(r: &CheckReport) -> Vec<&str> {
    let mut v: Vec<&str> = r.violations.iter().map(|v| v.path.as_str()).collect();
    v.sort();
    v
}

/// Pins: an unresolved factory wrapper (and an unresolved one) is not checked and not a
/// violation under an accepted rule; the job that forgot its wrapper still is. Mining and
/// the lock `init` writes (Scope::All) read both as outliers, exactly as before.
#[test]
fn a_wrapper_a_factory_builds_is_not_checked() {
    let r = jobs(45, 1, opaque_jobs());
    let c = candidate(&r, DEFINE);
    // Mining is unchanged: both are outliers of the mined rule.
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    assert!(outliers.contains(&"worker/src/jobs/sync/made.ts"), "{outliers:?}");
    assert!(outliers.contains(&"worker/src/jobs/sync/elsewhere.ts"), "{outliers:?}");

    let p = accepted(&c, Mode::Block);
    let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    assert_eq!(paths(&report), ["worker/src/jobs/sync/bare-0.ts"]);
    let s = report
        .standing
        .iter()
        .find(|s| s.id == p.conventions[0].id)
        .expect("a standing for the accepted rule");
    assert_eq!((s.holders, s.not_checked), (45, 2), "{s:?}");
    assert_eq!(s.members, 48, "{s:?}");
    assert!(
        s.not_checked_why.keys().any(|w| w.contains("makeWrapper()")),
        "{:?}",
        s.not_checked_why
    );
    assert!(
        s.not_checked_why
            .keys()
            .any(|w| w.contains("does not resolve")),
        "{:?}",
        s.not_checked_why
    );
    assert_eq!(s.stale, None);
    assert_eq!(s.mode, "block");

    // The lock `init` writes reads them as mining does: three entries, not one.
    let all = check(&r, &p, &Lock::default(), Scope::All, None);
    assert_eq!(all.violations.len(), 3, "{:?}", paths(&all));
    assert!(all.standing.is_empty());

    // A lock entry of a member not checked is never called fixed.
    let lock = drift_mine::check::baseline(&r, &p);
    let again = check(&r, &p, &lock, Scope::Accepted, None);
    assert!(again.fixed.is_empty(), "{:?}", again.fixed);
}

/// The cal.com shape (`packages/trpc`: 156 of 171 procedures use `authedProcedure`; the
/// 15 others are public, and the practice map cannot tell their sign-in). The rule's
/// target is built on `requireMember`, which the map's sign-in concern classifies: an
/// entry point the map marks unknown there is not checked. One the map reads as having
/// no guard at all stays a violation.
const MEMBER: &str = "core/src/procedures/member.ts#memberProcedure";
const OPEN: &str = "core/src/procedures/open.ts#openProcedure";
const REQUIRE: &str = "core/src/middlewares/session.ts#requireMember";

fn procedures() -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..30 {
        let dir = ["bookings", "teams", "viewer"][i % 3];
        files.push(file(
            &format!("trpc/server/routers/{dir}/r{i}.ts"),
            "trpc",
            vec![sym(&format!("proc{i}"), SymbolKind::Const, |s| {
                s.wraps.push(call(MEMBER))
            })],
        ));
    }
    // Public by design: the map cannot tell how it signs a caller in.
    files.push(file(
        "trpc/server/routers/viewer/public.ts",
        "trpc",
        vec![sym("slots", SymbolKind::Const, |s| s.wraps.push(call(OPEN)))],
    ));
    // Forgot its procedure: the map found no guard at all.
    files.push(file(
        "trpc/server/routers/viewer/forgot.ts",
        "trpc",
        vec![sym("leak", SymbolKind::Const, |_| {})],
    ));
    files.push(file(
        "core/src/procedures/member.ts",
        "core",
        vec![sym("memberProcedure", SymbolKind::Const, |s| {
            s.calls.push(format!("{REQUIRE}(ref)"))
        })],
    ));
    files.push(file(
        "core/src/procedures/open.ts",
        "core",
        vec![sym("openProcedure", SymbolKind::Const, |_| {})],
    ));
    files.push(file(
        "core/src/middlewares/session.ts",
        "core",
        vec![sym("requireMember", SymbolKind::Function, |_| {})],
    ));
    files.extend(background());
    repo(files)
}

/// The practice map's sign-in concern: `instrument` its one way, `public.ts#slots`
/// unknown, `forgot.ts#leak` none.
fn map(instrument: &str) -> PracticesReport {
    let row = |path: &str, symbol: &str, assignment: &str| UnitRow {
        package: "trpc".into(),
        path: path.into(),
        symbol: symbol.into(),
        line: 1,
        assignment: assignment.into(),
        ..UnitRow::default()
    };
    PracticesReport {
        concerns: vec![ConcernReport {
            id: drift_mine::practices::AUTHN.into(),
            variants: vec![Variant {
                key: format!("wrap:{instrument}"),
                instruments: vec![instrument.into()],
                members: 30,
                ..Variant::default()
            }],
            units: vec![
                row("trpc/server/routers/viewer/public.ts", "slots", "unknown"),
                row("trpc/server/routers/viewer/forgot.ts", "leak", "none"),
            ],
            ..ConcernReport::default()
        }],
        ..PracticesReport::default()
    }
}

#[test]
fn a_public_procedure_the_map_cannot_tell_is_not_checked() {
    let r = procedures();
    let c = candidate(&r, MEMBER);
    let p = accepted(&c, Mode::Block);
    let mut report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    // Without the map, both outliers are violations, as before.
    assert_eq!(
        paths(&report),
        [
            "trpc/server/routers/viewer/forgot.ts",
            "trpc/server/routers/viewer/public.ts"
        ]
    );
    assert!(drift_mine::check::reads_practice_map(&report, &p));
    report.set_aside_untold(&r, &p, &map(REQUIRE));
    assert_eq!(paths(&report), ["trpc/server/routers/viewer/forgot.ts"]);
    let s = &report.standing[0];
    assert_eq!((s.holders, s.not_checked), (30, 1), "{s:?}");
    assert!(
        s.not_checked_why.keys().any(|w| w.contains("sign-in")),
        "{:?}",
        s.not_checked_why
    );
    assert_eq!(s.mode, "block");

    // The concern is the one whose instruments the target is built on, as the
    // classifier found them: a map whose sign-in is done by something else says
    // nothing of this rule, and the public procedure stays a violation.
    let mut other = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    other.set_aside_untold(
        &r,
        &p,
        &map("core/src/middlewares/apikey.ts#requireKey"),
    );
    assert_eq!(other.violations.len(), 2, "{:?}", paths(&other));
}

/// Pins: a rule whose holders fell under the share that made it a rule is stale and
/// advises (it fails no check and is said), and one whose role emptied is stale too.
#[test]
fn a_stale_rule_advises_and_says_why() {
    let mined_on = jobs(45, 1, vec![]);
    let c = candidate(&mined_on, DEFINE);
    let p = accepted(&c, Mode::Block);
    assert_eq!(effective_mode(&p.conventions[0]), "block");

    // 20 of the 45 jobs lost the wrapper: 25 of 46 follow it now.
    let decayed = jobs(25, 21, vec![]);
    let report = check(&decayed, &p, &Lock::default(), Scope::Accepted, None);
    let s = &report.standing[0];
    assert_eq!((s.holders, s.members), (25, 46), "{s:?}");
    let why = s.stale.as_deref().expect("stale");
    assert!(why.contains("25 of the 46"), "{why}");
    assert_eq!(s.mode, "advise");
    assert!(
        s.mode_note
            .as_deref()
            .is_some_and(|n| n.starts_with("was block, now advise because it is stale: ")),
        "{:?}",
        s.mode_note
    );
    assert!(!report.violations.is_empty());
    assert!(report.violations.iter().all(|v| v.mode == "advise"));
    assert_eq!(report.blocking().count(), 0);

    // The role emptied below the minimum role size.
    let emptied = jobs(4, 1, vec![]);
    let report = check(&emptied, &p, &Lock::default(), Scope::Accepted, None);
    let s = &report.standing[0];
    assert!(
        s.stale
            .as_deref()
            .is_some_and(|w| w.contains("under the 8 a mined rule needs")),
        "{s:?}"
    );
    assert_eq!(report.blocking().count(), 0);
}

/// Pins the one answer for the mode: `effective_mode` is `mode_now` without what a check
/// found, and a convention whose file says block says why it advises.
#[test]
fn the_mode_says_was_block_now_advise() {
    let r = jobs(45, 1, vec![]);
    let c = candidate(&r, DEFINE);
    let mut p = accepted(&c, Mode::Block);
    assert_eq!(mode_now(&p.conventions[0], None), ("block", None));

    // A role under the block minimum advises, and says so.
    p.conventions[0].evidence.role_members = Some(10);
    let (mode, note) = mode_now(&p.conventions[0], None);
    assert_eq!(mode, "advise");
    assert_eq!(effective_mode(&p.conventions[0]), "advise");
    assert_eq!(
        note.as_deref(),
        Some(
            "was block, now advise because its role had 10 members when it was mined, under the 15 needed to block"
        )
    );
    let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    assert_eq!(report.standing[0].mode_note, note);

    // A convention the file sets to advise has nothing to explain.
    p.conventions[0].mode = Mode::Advise;
    assert_eq!(mode_now(&p.conventions[0], Some("anything")), ("advise", None));
}
