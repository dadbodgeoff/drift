//! The guard questions a context answers once each (`authenticates`, `may_authenticate`,
//! `callee_is_guard`, kept per context) answer as they would asked fresh: what one
//! reading answered is never the other reading's, and a second wrapper is not given
//! the first one's answer.

use drift_core::{FileFacts, RepoFacts, Symbol};
use drift_mine::context::RepoContext;
use drift_mine::security::{authenticates, callee_is_guard, may_authenticate};

fn sym(name: &str, calls: &[&str], controls: &[&str]) -> Symbol {
    Symbol {
        name: name.into(),
        exported_as: vec![name.into()],
        calls: calls.iter().map(|s| s.to_string()).collect(),
        controls: controls.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

/// A dependency that answers 401 only in an `except` handler is a guard for the
/// reading made since the measured build and not for mining's; one that may answer it
/// is "may authenticate" for the first only.
fn repo() -> RepoFacts {
    let auth = FileFacts {
        path: "app/auth.py".into(),
        lang: "py".into(),
        symbols: vec![
            sym(
                "current_principal",
                &["pkg:jose#jwt.decode"],
                &[drift_core::controls::HANDLER_REJECTS],
            ),
            sym(
                "for_writes",
                &["pkg:jose#jwt.decode"],
                &[drift_core::controls::HANDLER_MAY_REJECT],
            ),
            sym("get_tenant", &["app/auth.py#current_principal"], &[]),
            sym("plain", &[], &[]),
        ],
        ..Default::default()
    };
    RepoFacts {
        files: vec![auth],
        ..Default::default()
    }
}

/// Pins: a context asked under mining's reading, then turned into the reading since the
/// measured build, answers as a context built for that reading does, not with what it
/// kept (the memo is keyed by the wrapper alone, so it must start empty there).
#[test]
fn a_context_turned_to_the_listing_reading_forgets_what_mining_was_told() {
    let repo = repo();
    let ctx = RepoContext::new(&repo, &[]);
    for dep in ["app/auth.py#current_principal", "app/auth.py#get_tenant"] {
        assert!(!authenticates(&ctx, dep), "mining: {dep}");
    }
    assert!(!may_authenticate(&ctx, "app/auth.py#for_writes"));
    let ctx = ctx.reading_since_measured();
    for dep in ["app/auth.py#current_principal", "app/auth.py#get_tenant"] {
        assert!(authenticates(&ctx, dep), "listing: {dep}");
        // Asked again: the kept answer is the one just given.
        assert!(authenticates(&ctx, dep), "listing, again: {dep}");
    }
    assert!(may_authenticate(&ctx, "app/auth.py#for_writes"));
    assert!(!authenticates(&ctx, "app/auth.py#for_writes"));
}

/// Pins: each wrapper keeps its own answer, whichever is asked first, and a copy of a
/// context answers the same.
#[test]
fn each_wrapper_keeps_its_own_answer() {
    let repo = repo();
    let ctx = RepoContext::new(&repo, &[]).reading_since_measured();
    let fresh = |r: &str| {
        let c = RepoContext::new(&repo, &[]).reading_since_measured();
        (
            authenticates(&c, r),
            may_authenticate(&c, r),
            callee_is_guard(&c, r),
        )
    };
    let all = [
        "app/auth.py#get_tenant",
        "app/auth.py#plain",
        "app/auth.py#for_writes",
        "app/auth.py#current_principal",
        "app/auth.py#missing",
    ];
    for r in all.iter().chain(all.iter().rev()) {
        let kept = (
            authenticates(&ctx, r),
            may_authenticate(&ctx, r),
            callee_is_guard(&ctx, r),
        );
        assert_eq!(kept, fresh(r), "{r}");
        let copy = ctx.clone();
        assert_eq!(
            (
                authenticates(&copy, r),
                may_authenticate(&copy, r),
                callee_is_guard(&copy, r)
            ),
            kept,
            "copy: {r}"
        );
    }
    assert!(authenticates(&ctx, "app/auth.py#get_tenant"));
    assert!(!authenticates(&ctx, "app/auth.py#plain"));
}
