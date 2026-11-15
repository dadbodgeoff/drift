//! The exemption gate ([`Rule::exemption_allowed`]) on shapes the first version missed:
//! handlers registered by reference (`router.get("/x", handler)`, `ctrl.method`), and
//! guards called in the handler's body (`authorize()`, `loadProject()`).

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, View, units};
use drift_mine::security::callee_is_guard;
use drift_mine::vocab::grant::{AuthClass, auth_class};
use drift_mine::vocab::refuse::names_access_control;

const ROUTES: &str = "src/server/routes.ts";

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

fn ts(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn wrap(wrapper: &str, kind: WrapKind) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind,
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

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

/// Every rule family, including TypeScript call rules, which are never proposed
/// (`mine::hidden_call_rule`): for what such a rule is about, which still decides
/// `check` on conventions accepted before.
fn mined_every(r: &RepoFacts) -> Vec<Candidate> {
    drift_mine::mine::mine_every_family(r, &MineOptions { max_per_repo: 200 }).candidates
}

fn accept_all(r: &RepoFacts, cs: &[Candidate]) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", mine(r, &MineOptions::default()).kinds, cs);
    for conv in &mut p.conventions {
        conv.status = Status::Accepted;
    }
    p
}

fn violators_of(r: &RepoFacts, p: &ConventionsFile, id: &str) -> Vec<String> {
    let mut v: Vec<String> = check(r, p, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == id)
        .map(|v| v.symbol)
        .collect();
    v.sort();
    v
}

fn outliers(c: &Candidate) -> Vec<&str> {
    c.outliers.iter().map(|o| o.symbol.as_str()).collect()
}

fn listed(cs: &[Candidate]) -> Vec<(String, String, Vec<&str>)> {
    cs.iter()
        .map(|c| (c.role.describe(), c.rule.describe(), outliers(c)))
        .collect()
}

/// `(exemption code, exemption allowed, entry unit)` of `symbol` under `rule`.
fn gate(r: &RepoFacts, rule: &Rule, symbol: &str) -> (Option<String>, bool, bool) {
    let all = units(r, &FileKinds::learn(r));
    let ctx = RepoContext::new(r, &all);
    let u = all
        .iter()
        .find(|u| u.name() == symbol && matches!(u.view, View::Symbol(..)))
        .unwrap_or_else(|| panic!("no unit {symbol}"));
    let View::Symbol(f, s) = u.view else {
        unreachable!()
    };
    (
        rule.exemption(&u.view, &ctx).map(|e| e.code),
        rule.exemption_allowed(&u.view, &ctx),
        ctx.is_entry_unit(f, s),
    )
}

fn calls_rule(callee: &str) -> Rule {
    Rule::Calls {
        callee: callee.into(),
    }
}

fn extends_rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![target.into()],
    }
}

/// The Express routes file: one route per `(path, handler ref)`, each a synthetic route
/// symbol that calls its handler by reference, as `drift-ts` lowers
/// `router.get(path, handler)`.
fn routes(handlers: &[(String, String)]) -> FileFacts {
    let mut f = ts(ROUTES, vec![]);
    for (path, handler) in handlers {
        let name = format!("GET {path}");
        f.symbols.push(sym(&name, SymbolKind::Function, |s| {
            s.exported_as.clear();
            s.calls.push(format!("{handler}(ref)"));
        }));
        f.entry_points.push(EntryPoint {
            symbol: name,
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(path.clone()),
            adapter: "express".into(),
        });
    }
    f
}

/// 40 handlers under `controllers/projects/**` that each call `guard` (none when
/// empty), `controllers/billing/refund.ts#refundInvoice` that does not, an unrouted
/// helper beside it, all handlers registered by reference in [`ROUTES`], and the files
/// `extra` adds. Plus plain helpers elsewhere, so the role's rule has lift.
fn express(guard: &str, extra: Vec<FileFacts>) -> RepoFacts {
    let mut files = Vec::new();
    let mut handlers = Vec::new();
    for i in 0..40 {
        let path = format!("controllers/projects/p{}/h{i}.ts", i % 4);
        let name = format!("project{i}");
        files.push(ts(
            &path,
            vec![sym(&name, SymbolKind::Function, |s| {
                if !guard.is_empty() {
                    s.calls.push(guard.into());
                }
            })],
        ));
        handlers.push((format!("/projects/{i}"), format!("{path}#{name}")));
    }
    files.push(ts(
        "controllers/billing/refund.ts",
        vec![sym("refundInvoice", SymbolKind::Function, |_| {})],
    ));
    handlers.push((
        "/billing/refund".into(),
        "controllers/billing/refund.ts#refundInvoice".into(),
    ));
    files.push(ts(
        "lib/billing/format.ts",
        vec![sym("formatInvoice", SymbolKind::Function, |_| {})],
    ));
    files.push(routes(&handlers));
    for i in 0..100 {
        files.push(ts(
            &format!("lib/l{i}.ts"),
            vec![sym(&format!("helper{i}"), SymbolKind::Function, |_| {})],
        ));
    }
    files.extend(extra);
    repo(files)
}

/// Mines `r`, finds "calls `callee`" and checks that `refundInvoice` is its outlier,
/// exempt from nothing, and reported by `check`.
fn reported_without_exemption(r: &RepoFacts, callee: &str) {
    let cs = mined_every(r);
    let c = cs
        .iter()
        .find(|c| c.rule == calls_rule(callee))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["refundInvoice"], "{:?}", listed(&cs));
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    let p = accept_all(r, &cs);
    assert_eq!(violators_of(r, &p, &c.id), ["refundInvoice"]);
}

#[test]
fn a_handler_registered_by_reference_is_an_entry_point() {
    let authorize = "lib/auth.ts#authorize";
    let r = express(authorize, vec![]);
    reported_without_exemption(&r, authorize);
    // The same with `ensureOwnsProject()`, named for ownership.
    let ensure = "lib/projects.ts#ensureOwnsProject";
    assert!(names_access_control(ensure));
    reported_without_exemption(&express(ensure, vec![]), ensure);
    let rule = calls_rule(authorize);
    // The handler has no entry point of its own (its route is the routes file's
    // symbol), but a route calls it by reference: it is one.
    assert_eq!(gate(&r, &rule, "refundInvoice"), (None, false, true));
    // A helper no route registers is not, and the rule's guard alone refuses it.
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, false, false));
    // Only an entry point's reference counts: a wrapped value (`withAuth(handler)`)
    // also calls what it wraps by reference.
    let mut wrapped = express(authorize, vec![]);
    let f = wrapped.files.iter_mut().find(|f| f.path == ROUTES).unwrap();
    f.entry_points
        .retain(|e| e.route.as_deref() != Some("/billing/refund"));
    let r = repo(wrapped.files);
    assert!(!gate(&r, &rule, "refundInvoice").2);
}

#[test]
fn an_in_body_guard_named_for_access_control_refuses_exemptions() {
    // `authorize()` has no definition in the facts: its name decides.
    let authorize = "lib/auth.ts#authorize";
    let r = express(authorize, vec![]);
    let all = units(&r, &FileKinds::learn(&r));
    let ctx = RepoContext::new(&r, &all);
    assert!(callee_is_guard(&ctx, authorize));
    assert!(callee_is_guard(&ctx, "pkg:@casl/ability#ability.can"));
    assert!(!callee_is_guard(&ctx, "lib/format.ts#formatMoney"));
    assert_eq!(
        gate(&r, &calls_rule(authorize), "formatInvoice"),
        (None, false, false)
    );
    assert_eq!(
        gate(
            &r,
            &calls_rule("lib/format.ts#formatMoney"),
            "formatInvoice"
        ),
        (None, true, false)
    );
}

/// `lib/projects.ts#loadProject`, whose body throws `thrown` (just a `throw`
/// when empty), or does not throw at all.
fn load_project(throws: Option<&str>) -> FileFacts {
    ts(
        "lib/projects.ts",
        vec![sym("loadProject", SymbolKind::Function, |s| {
            if let Some(t) = throws {
                s.controls.push("throw".into());
                if !t.is_empty() {
                    s.throws.push(t.into());
                }
            }
        })],
    )
}

#[test]
fn a_guard_not_named_for_access_control_is_one_by_its_callers() {
    // `loadProject` says nothing about access in its name; it is a guard because
    // the handlers (entry points by reference) call it in two places or more and its
    // body can throw.
    let ensure = "lib/projects.ts#loadProject";
    assert!(!names_access_control(ensure));
    let r = express(ensure, vec![load_project(Some("lib/errors.ts#NotFound"))]);
    reported_without_exemption(&r, ensure);
    let rule = calls_rule(ensure);
    assert_eq!(gate(&r, &rule, "refundInvoice"), (None, false, true));
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, false, false));
    let r = express(ensure, vec![load_project(Some(""))]);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, false, false));
    // A helper every handler calls whose body cannot reject anyone is not a guard.
    let r = express(ensure, vec![load_project(None)]);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, true, false));
    // Nor is one that throws but only one entry point calls.
    let mut files = express("", vec![load_project(Some(""))]).files;
    files
        .iter_mut()
        .find(|f| f.path.ends_with("/h0.ts"))
        .unwrap()
        .symbols[0]
        .calls
        .push(ensure.into());
    let r = repo(files);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, true, false));
}

#[test]
fn a_guard_shaped_by_its_definition_refuses_exemptions() {
    // Called by one handler only, but it throws an error named for turning the caller
    // away, directly or through a function it calls.
    let ensure = "lib/projects.ts#loadProject";
    let rule = calls_rule(ensure);
    let one_caller = |extra: Vec<FileFacts>| {
        let mut files = express("", extra).files;
        files
            .iter_mut()
            .find(|f| f.path.ends_with("/h0.ts"))
            .unwrap()
            .symbols[0]
            .calls
            .push(ensure.into());
        repo(files)
    };
    let r = one_caller(vec![load_project(Some("lib/errors.ts#ForbiddenError"))]);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, false, false));
    let through = ts(
        "lib/projects.ts",
        vec![sym("loadProject", SymbolKind::Function, |s| {
            s.calls.push("lib/access.ts#assertMember".into());
        })],
    );
    let member = ts(
        "lib/access.ts",
        vec![sym("assertMember", SymbolKind::Function, |s| {
            s.controls.push("throw".into());
            s.throws.push("lib/errors.ts#UnauthorizedError".into());
        })],
    );
    let r = one_caller(vec![through, member]);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, false, false));
    // An error not named for it (`NotFound`) is no rejection.
    let r = one_caller(vec![load_project(Some("lib/errors.ts#NotFound"))]);
    assert_eq!(gate(&r, &rule, "formatInvoice"), (None, true, false));
}

const BASE: &str = "lib/base.ts#BaseController";

/// 30 controllers on the team's `BaseController`, whose methods the routes file
/// registers by reference through an instance (`c0.list`), a webhook handler built on
/// a package's class whose method is registered through an instance or statically
/// (`how`; `"unrouted"` leaves the routes file out), and plain classes elsewhere.
fn controllers(how: &str) -> RepoFacts {
    let mut files = Vec::new();
    let mut handlers = Vec::new();
    for i in 0..30 {
        let path = format!("controllers/c{i}.controller.ts");
        let class = format!("C{i}Controller");
        let instance = format!("c{i}");
        files.push(ts(
            &path,
            vec![
                sym(&class, SymbolKind::Class, |s| {
                    s.wraps.push(wrap(BASE, WrapKind::Extends));
                }),
                sym(&instance, SymbolKind::Const, |s| {
                    s.calls.push(format!("{path}#{class}(new)"));
                }),
            ],
        ));
        handlers.push((format!("/c{i}"), format!("{path}#{instance}.list")));
    }
    let webhook = "controllers/stripe/webhook.controller.ts";
    let mut handler = vec![sym("StripeWebhookHandler", SymbolKind::Class, |s| {
        s.wraps
            .push(wrap("pkg:svix-express#WebhookHandler", WrapKind::Extends));
    })];
    match how {
        "instance" => {
            handler.push(sym("stripeWebhook", SymbolKind::Const, |s| {
                s.calls.push(format!("{webhook}#StripeWebhookHandler(new)"));
            }));
            handlers.push(("/stripe".into(), format!("{webhook}#stripeWebhook.handle")));
        }
        "static" => {
            handlers.push((
                "/stripe".into(),
                format!("{webhook}#StripeWebhookHandler.handle"),
            ));
        }
        _ => {}
    }
    files.push(ts(webhook, handler));
    files.push(ts(
        "lib/base.ts",
        vec![sym("BaseController", SymbolKind::Class, |s| {
            s.traits.push("base".into());
        })],
    ));
    if how != "unrouted" {
        files.push(routes(&handlers));
    }
    for i in 0..100 {
        files.push(ts(
            &format!("other/o{i}.ts"),
            vec![sym(&format!("O{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    repo(files)
}

#[test]
fn a_controller_registered_by_reference_is_an_entry_class() {
    let rule = extends_rule(BASE);
    // With no routes, `BaseController` guards nothing and the handler, named for its
    // own base of another kind, is exempt.
    let r = controllers("unrouted");
    assert!(!names_access_control(BASE));
    let (code, allowed, entry) = gate(&r, &rule, "StripeWebhookHandler");
    assert!(code.is_some() && allowed && !entry, "{code:?}");
    for how in ["instance", "static"] {
        let r = controllers(how);
        assert_eq!(
            gate(&r, &rule, "StripeWebhookHandler"),
            (None, false, true),
            "{how}"
        );
        let all = units(&r, &FileKinds::learn(&r));
        let ctx = RepoContext::new(&r, &all);
        // The base of controllers routed by reference guards them.
        assert!(ctx.is_guard(BASE), "{how}");
        let cs = mined(&r);
        let c = cs
            .iter()
            .find(|c| c.rule == rule)
            .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
        assert_eq!(outliers(c), ["StripeWebhookHandler"], "{how}");
        assert!(c.exempt.is_empty(), "{how}: {:?}", c.exempt);
        let p = accept_all(&r, &cs);
        assert_eq!(violators_of(&r, &p, &c.id), ["StripeWebhookHandler"]);
    }
}

#[test]
fn access_control_words() {
    for name in [
        "lib/auth.ts#authorize",
        "lib/auth.ts#authorise",
        "lib/auth.ts#authenticate",
        "lib/auth.ts#authenticateRequest",
        "lib/session.ts#requireUser",
        "lib/session.ts#requireUserId",
        "app/session.server.ts#require_user",
        "pkg:@casl/ability#ability.can",
        "lib/abilities.ts#can",
        "lib/abilities.ts#canEditProject",
        "pkg:django#contrib.auth.decorators.user_passes_test",
        // Once `parts.rs`' and `mine.rs`' own lists.
        "lib/a.ts#protect",
        "lib/a.ts#verifyCredentials",
        "app/kit.py#AdminOnlyView",
        "app/kit.py#StaffRequiredMixin",
        "lib/projects.ts#checkOwnership",
        "lib/projects.ts#ownsProject",
        "lib/teams.ts#assertMember",
        "lib/teams.ts#ensureMembership",
        "lib/billing.ts#isEntitled",
        "lib/billing.ts#requireEntitlement",
        "lib/flags.ts#isAllowed",
        // Deliberate: `members` is `member`, so a list helper over-includes. It only
        // refuses exemptions.
        "lib/teams.ts#listMembers",
    ] {
        assert!(names_access_control(name), "{name}");
    }
    for name in [
        "lib/orders.ts#cancel",
        "lib/orders.ts#cancelOrder",
        "lib/files.ts#scan",
        "lib/jobs.ts#candidate",
        "lib/users.ts#user",
        "lib/users.ts#getUser",
        "lib/users.ts#requireConfig",
        "lib/media.ts#canvas",
        "lib/media.ts#Scanner",
        "lib/tests.ts#passesTest",
    ] {
        assert!(!names_access_control(name), "{name}");
    }
}

#[test]
fn or_throw_is_stricter_not_weaker() {
    // `or` weakens a name (`withAuthOrNull`), unless what follows it turns the caller
    // away: `getUserOrThrow` is no opening.
    for name in [
        "lib/session.ts#getUserOrThrow",
        "lib/teams.ts#assertMemberOrThrow",
        "lib/session.ts#getCurrentUserOrThrow",
        "app/auth.py#get_user_or_404",
        "lib/session.ts#requireUserOrRedirect",
    ] {
        assert_ne!(auth_class(name), AuthClass::Public, "{name}");
    }
    for name in [
        "lib/auth.ts#withAuthOrNull",
        "lib/session.ts#getUserOrNull",
        "lib/auth.ts#authOrAnonymous",
        // Result-style: the error is returned, no caller is turned away.
        "server/procedures.ts#userOrErrorProcedure",
        "lib/session.ts#getUserOrError",
    ] {
        assert_eq!(auth_class(name), AuthClass::Public, "{name}");
    }
    let r = express("", vec![]);
    let all = units(&r, &FileKinds::learn(&r));
    let ctx = RepoContext::new(&r, &all);
    assert!(callee_is_guard(&ctx, "lib/teams.ts#assertMemberOrThrow"));
    assert!(callee_is_guard(&ctx, "lib/session.ts#requireUserOrThrow"));
    assert!(!callee_is_guard(&ctx, "lib/auth.ts#withAuthOrNull"));
}

// #52 x #62: a handler registered by reference is an entry point, so it is never a
// shared part of its role (#52's shared_part goes through the gate), even under an
// in-body guard the gate cannot tell by its name or definition. Every handler calls
// `checkProject()` (not named for access control, no definition in the facts);
// `refundInvoice` does not, and two handlers of the role also call it, which is what
// makes a symbol a shared part.
#[test]
fn a_by_reference_handler_is_never_a_shared_part() {
    let guard = "lib/projects.ts#checkProject";
    assert!(!names_access_control(guard));
    let mut files = express(guard, vec![]).files;
    for h in ["/h0.ts", "/h1.ts"] {
        files
            .iter_mut()
            .find(|f| f.path.ends_with(h) && f.path.contains("/p"))
            .unwrap()
            .symbols[0]
            .calls
            .push("controllers/billing/refund.ts#refundInvoice".into());
    }
    let r = repo(files);
    let all = units(&r, &FileKinds::learn(&r));
    let ctx = RepoContext::new(&r, &all);
    assert!(!callee_is_guard(&ctx, guard));
    let rule = calls_rule(guard);
    // Allowed by the callee's name, refused as an entry point.
    assert_eq!(gate(&r, &rule, "refundInvoice"), (None, false, true));
    let cs = mined_every(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == rule)
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert!(outliers(c).contains(&"refundInvoice"), "{:?}", listed(&cs));
    assert!(
        !c.exempt.iter().any(|e| e.symbol == "refundInvoice"),
        "{:?}",
        c.exempt
    );
    let u = all
        .iter()
        .find(|u| matches!(u.view, View::Symbol(_, s) if s.name == "refundInvoice"))
        .unwrap();
    for role in &u.roles {
        assert_eq!(rule.part_exemption(role, &u.view, &ctx), None, "{role:?}");
    }
    let p = accept_all(&r, &cs);
    assert!(violators_of(&r, &p, &c.id).contains(&"refundInvoice".to_string()));
}

// F10 (#59) review: a rule whose holders all sit in one subtree is never narrowed to it
// past an unguarded handler. 40 handlers under `controllers/projects/**` call the guard;
// `refundInvoice`, alone in `controllers/billing/`, does not; all are registered by
// reference. With `authorize()` (a guard by its name) and with `checkProject()` (no
// guard by name or definition: only the handler being an entry point by reference
// stops the narrowing), the rule keeps its role and `refundInvoice` stays reported.
#[test]
fn a_rule_is_never_narrowed_past_an_unguarded_by_reference_handler() {
    for guard in ["lib/auth.ts#authorize", "lib/projects.ts#checkProject"] {
        let r = express(guard, vec![]);
        reported_without_exemption(&r, guard);
        let cs = mined_every(&r);
        let c = cs.iter().find(|c| c.rule == calls_rule(guard)).unwrap();
        assert!(
            !c.role.dir.contains("projects"),
            "{guard}: narrowed to {}",
            c.role.dir
        );
    }
}
