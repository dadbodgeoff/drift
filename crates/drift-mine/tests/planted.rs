//! Mining tests on synthetic repos with planted conventions and outliers.

use std::collections::BTreeSet;

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, baseline, check};
use drift_mine::mine::{MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};

fn route(path: &str, wrapper: Option<&str>, extra_call: Option<&str>) -> FileFacts {
    let mut s = Symbol {
        name: "GET".into(),
        kind: SymbolKind::Function,
        exported_as: vec!["GET".into()],
        line: 3,
        wraps: vec![],
        calls: vec!["global#Response.json".into()],
        renders: vec![],
        args: vec![],
        controls: vec![],
        string_literals: 0,
        suppressions: vec![],
        reads: vec![],
        throws: vec![],
        sinks: vec![],
        order: vec![],
        traits: vec![],
        field_decorators: vec![],
        derives_from: String::new(),
        returns_wrapped_by: vec![],
        made_by: String::new(),
        omits: vec![],
        declares: vec![],
        meta: vec![],
        decorator_args: vec![],
        disclaims: vec![],
        arg_types: vec![],
        after_continuation: vec![],
        members: vec![],
        server_reads: vec![],
        ..Symbol::default()
    };
    if let Some(w) = wrapper {
        s.wraps.push(Wrap {
            wrapper: w.into(),
            kind: WrapKind::Call,
        });
    }
    if let Some(c) = extra_call {
        s.calls.push(c.into());
    }
    FileFacts {
        path: path.into(),
        hash: "0".into(),
        lang: "ts".into(),
        package: String::new(),
        parse_ok: true,
        symbols: vec![s],
        entry_points: vec![EntryPoint {
            symbol: "GET".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: None,
            adapter: "nextjs".into(),
        }],
        ..FileFacts::default()
    }
}

fn helper(path: &str) -> FileFacts {
    FileFacts {
        path: path.into(),
        hash: "0".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![Symbol {
            name: "util".into(),
            kind: SymbolKind::Function,
            exported_as: vec!["util".into()],
            line: 1,
            wraps: vec![],
            calls: vec!["global#Response.json".into()],
            renders: vec![],
            args: vec![],
            controls: vec![],
            string_literals: 0,
            suppressions: vec![],
            reads: vec![],
            throws: vec![],
            sinks: vec![],
            order: vec![],
            traits: vec![],
            field_decorators: vec![],
            derives_from: String::new(),
            returns_wrapped_by: vec![],
            made_by: String::new(),
            omits: vec![],
            declares: vec![],
            meta: vec![],
            decorator_args: vec![],
            disclaims: vec![],
            arg_types: vec![],
            after_continuation: vec![],
            members: vec![],
            server_reads: vec![],
            ..Symbol::default()
        }],
        ..FileFacts::default()
    }
}

const AUTH: &str = "lib/auth.ts#withAuth";
const SESSION: &str = "lib/auth.ts#withSession";

/// `lib/auth.ts`, where both wrappers turn a caller away
/// ([`drift_core::controls::REJECTS_CALLER`]): a variant set of them is a set of guards.
fn auth_module() -> FileFacts {
    let guard = |name: &str| Symbol {
        name: name.into(),
        kind: SymbolKind::Function,
        exported_as: vec![name.into()],
        line: 1,
        controls: vec![drift_core::controls::REJECTS_CALLER.into(), "throw".into()],
        ..Default::default()
    };
    FileFacts {
        path: "lib/auth.ts".into(),
        hash: "0".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![guard("withAuth"), guard("withSession")],
        ..FileFacts::default()
    }
}

/// 40 routes, 38 wrapped in withAuth (lower bound ~0.83), plus 30 helpers that
/// share the universal call. (18 of 20 would be rejected: its lower bound is ~0.70.)
fn planted() -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        let w = if i < 38 { Some(AUTH) } else { None };
        files.push(route(&format!("app/api/r{i:02}/route.ts"), w, None));
    }
    for i in 0..30 {
        files.push(helper(&format!("lib/h{i:02}.ts")));
    }
    let mut r = RepoFacts {
        schema_version: 1,
        files,
        skipped: vec![],
        ..Default::default()
    };
    r.normalize();
    r
}

#[test]
fn finds_planted_convention_and_names_its_outliers() {
    let m = mine(&planted(), &MineOptions::default());
    let c = m
        .candidates
        .iter()
        .find(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Call,
                    any_of: vec![AUTH.into()],
                }
        })
        .expect("planted convention not found");
    assert_eq!((c.evidence.holders, c.evidence.total), (38, 40));
    let outliers: Vec<_> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    assert_eq!(outliers, ["app/api/r38/route.ts", "app/api/r39/route.ts"]);
    assert!(c.can_block);
}

#[test]
fn universal_facts_are_not_conventions() {
    // Every unit calls Response.json: lift is 1, so it must never be proposed.
    let m = mine(&planted(), &MineOptions::default());
    assert!(
        m.candidates.iter().all(
            |c| !matches!(&c.rule, Rule::Calls { callee } if callee == "global#Response.json")
        )
    );
}

#[test]
fn small_roles_produce_nothing() {
    let mut files: Vec<_> = (0..6)
        .map(|i| route(&format!("app/api/r{i}/route.ts"), Some(AUTH), None))
        .collect();
    files.push(route("app/api/x/route.ts", None, None));
    files.extend((0..30).map(|i| helper(&format!("lib/h{i:02}.ts"))));
    let r = RepoFacts {
        schema_version: 1,
        files,
        skipped: vec![],
        ..Default::default()
    };
    assert!(mine(&r, &MineOptions::default()).candidates.is_empty());
}

#[test]
fn weak_majorities_are_rejected() {
    // 12 of 20 (60%): Wilson lower bound is far below 0.75.
    let mut files: Vec<FileFacts> = (0..20)
        .map(|i| {
            route(
                &format!("app/api/r{i:02}/route.ts"),
                (i < 12).then_some(AUTH),
                None,
            )
        })
        .collect();
    files.extend((0..30).map(|i| helper(&format!("lib/h{i:02}.ts"))));
    let r = RepoFacts {
        schema_version: 1,
        files,
        skipped: vec![],
        ..Default::default()
    };
    assert!(mine(&r, &MineOptions::default()).candidates.is_empty());
}

#[test]
fn alternatives_form_a_variant_set() {
    // 10 withAuth + 9 withSession + 1 unwrapped: neither alone passes, together they do.
    let mut files: Vec<FileFacts> = (0..20)
        .map(|i| {
            let w = if i < 10 {
                Some(AUTH)
            } else if i < 19 {
                Some(SESSION)
            } else {
                None
            };
            route(&format!("app/api/r{i:02}/route.ts"), w, None)
        })
        .collect();
    files.extend((0..30).map(|i| helper(&format!("lib/h{i:02}.ts"))));
    files.push(auth_module());
    let r = RepoFacts {
        schema_version: 1,
        files,
        skipped: vec![],
        ..Default::default()
    };
    let m = mine(&r, &MineOptions::default());
    let c = &m.candidates[0];
    assert_eq!(
        c.rule,
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec![AUTH.into(), SESSION.into()]
        }
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (19, 20));
    assert_eq!(
        c.evidence.split,
        vec![(AUTH.to_string(), 10), (SESSION.to_string(), 9)]
    );
}

#[test]
fn file_order_does_not_change_results() {
    let a = planted();
    let mut b = a.clone();
    b.files.reverse();
    let ma = mine(&a, &MineOptions::default());
    let mb = mine(&b, &MineOptions::default());
    let ids = |m: &drift_mine::mine::Mined| {
        m.candidates
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&ma), ids(&mb));
}

#[test]
fn check_blocks_only_new_violations_of_accepted_block_conventions() {
    let repo = planted();
    let m = mine(&repo, &MineOptions::default());
    let mut policy = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    let lock = baseline(&repo, &policy);
    let id = m.candidates[0].id.clone();

    // Proposed conventions never report in check.
    assert!(
        check(&repo, &policy, &lock, Scope::Accepted, None)
            .violations
            .is_empty()
    );

    let c = policy.get_mut(&id).unwrap();
    c.status = Status::Accepted;
    c.mode = Mode::Block;
    let r = check(&repo, &policy, &lock, Scope::Accepted, None);
    assert_eq!(r.violations.len(), 2);
    assert_eq!(r.blocking().count(), 0, "legacy outliers are baselined");

    // An agent adds a new unwrapped route in the same role.
    let mut changed = repo.clone();
    changed
        .files
        .push(route("app/api/new/route.ts", None, None));
    changed.normalize();
    let r = check(&changed, &policy, &lock, Scope::Accepted, None);
    let blocking: Vec<_> = r.blocking().map(|v| v.path.as_str()).collect();
    assert_eq!(blocking, ["app/api/new/route.ts"]);

    // A hand-edited policy cannot make a role under 15 members block: it advises.
    let mut small = policy.clone();
    small.get_mut(&id).unwrap().evidence.total = 14;
    let r = check(&changed, &small, &lock, Scope::Accepted, None);
    assert_eq!(r.blocking().count(), 0);
    assert!(r.new_violations().all(|v| v.mode == "advise"));
    small.get_mut(&id).unwrap().evidence.total = 15;
    let r = check(&changed, &small, &lock, Scope::Accepted, None);
    assert_eq!(r.blocking().count(), 1, "15 members may block");

    // Fixing a legacy outlier shows up as a removable lock entry.
    let mut fixed = repo.clone();
    let idx = fixed
        .files
        .iter()
        .position(|f| f.path == "app/api/r38/route.ts")
        .unwrap();
    fixed.files[idx] = route("app/api/r38/route.ts", Some(AUTH), None);
    let r = check(&fixed, &policy, &lock, Scope::Accepted, None);
    assert_eq!(r.fixed.len(), 1);
    let only: BTreeSet<String> = ["app/api/r39/route.ts".to_string()].into();
    assert_eq!(
        check(
            &fixed,
            &policy,
            &Lock::default(),
            Scope::Accepted,
            Some(&only)
        )
        .violations
        .len(),
        1
    );
}

/// A reviewer's "fine because…" (`exceptions` in conventions.yaml) moves exactly that
/// member of exactly that convention from the violations to the exempt members, with
/// the reason sanitised; it matches on path#symbol (so it survives a line move), keeps
/// the member's lock entry, and changes nothing else: not the tier, the mode, the
/// other outliers, or what a member it does not name reports [STRICT].
#[test]
fn reviewer_exceptions_only_remove_the_member_they_name() {
    let repo = planted();
    let m = mine(&repo, &MineOptions::default());
    let mut policy = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    let lock = baseline(&repo, &policy);
    let id = m.candidates[0].id.clone();
    let c = policy.get_mut(&id).unwrap();
    c.status = Status::Accepted;
    c.mode = Mode::Block;
    let mut changed = repo.clone();
    changed
        .files
        .push(route("app/api/new/route.ts", None, None));
    changed.normalize();
    let before = check(&changed, &policy, &lock, Scope::Accepted, None);
    assert_eq!(before.blocking().count(), 1);

    // An exception for a member that is not an outlier, or for another convention, or
    // for another symbol of the same file, changes nothing.
    let mut inert = policy.clone();
    inert
        .get_mut(&id)
        .unwrap()
        .set_exception("app/api/r00/route.ts#GET", "already wrapped");
    inert
        .get_mut(&id)
        .unwrap()
        .set_exception("app/api/new/route.ts#POST", "another symbol");
    let r = check(&changed, &inert, &lock, Scope::Accepted, None);
    assert_eq!(r.violations, before.violations);
    assert_eq!(r.exempt, before.exempt);
    assert_eq!(r.fixed, before.fixed);
    // Another accepted convention flagging the same member, with its own exception for
    // it: only that convention's violation goes; this one's stays.
    let mut twin = policy.get_mut(&id).unwrap().clone();
    twin.id = "D-ffffff".into();
    twin.mode = Mode::Advise;
    twin.set_exception("app/api/new/route.ts#GET", "another convention");
    let mut two = policy.clone();
    two.conventions.push(twin);
    let r = check(&changed, &two, &lock, Scope::Accepted, None);
    let new: Vec<_> = r
        .violations
        .iter()
        .filter(|v| v.path == "app/api/new/route.ts")
        .map(|v| v.id.as_str())
        .collect();
    assert_eq!(new, [id.as_str()]);
    assert_eq!(r.blocking().count(), 1);
    assert!(
        r.exempt
            .iter()
            .any(|e| e.id == "D-ffffff" && e.path == "app/api/new/route.ts")
    );

    // The new route, marked fine: no longer a violation, listed as exempt with the
    // reviewer's reason, sanitised for agents.
    let mut fine = policy.clone();
    fine.get_mut(&id)
        .unwrap()
        .set_exception("app/api/new/route.ts#GET", "public `health` <check>");
    let r = check(&changed, &fine, &lock, Scope::Accepted, None);
    assert_eq!(r.blocking().count(), 0);
    let left: Vec<_> = r.violations.iter().map(|v| v.path.as_str()).collect();
    assert_eq!(left, ["app/api/r38/route.ts", "app/api/r39/route.ts"]);
    let e: Vec<_> = r
        .exempt
        .iter()
        .filter(|e| e.code == drift_mine::check::REVIEWED)
        .collect();
    assert_eq!(e.len(), 1);
    assert_eq!(
        (e[0].id.as_str(), e[0].path.as_str(), e[0].symbol.as_str()),
        (id.as_str(), "app/api/new/route.ts", "GET")
    );
    assert_eq!(
        e[0].reason,
        "marked fine by a reviewer: public 'health' ‹check›"
    );
    // Same tier and mode as without it.
    let v = &before.violations[0];
    assert!(
        r.violations
            .iter()
            .all(|w| w.tier == v.tier && w.mode == v.mode)
    );

    // It survives the member moving within its file.
    let mut moved = changed.clone();
    let i = moved
        .files
        .iter()
        .position(|f| f.path == "app/api/new/route.ts")
        .unwrap();
    moved.files[i].symbols[0].line = 40;
    let r = check(&moved, &fine, &lock, Scope::Accepted, None);
    assert_eq!(r.blocking().count(), 0);

    // A legacy outlier marked fine keeps its lock entry (not listed as fixed).
    fine.get_mut(&id)
        .unwrap()
        .set_exception("app/api/r38/route.ts#GET", "legacy, being removed");
    let r = check(&changed, &fine, &lock, Scope::Accepted, None);
    assert!(r.fixed.is_empty(), "{:?}", r.fixed);
    assert_eq!(r.violations.len(), 1);
}
