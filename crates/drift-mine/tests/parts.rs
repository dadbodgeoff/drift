//! Shared parts of a role (F5, error class H): the helpers, factories and fragments the
//! members use are not members, so rules about members do not report them, in mining
//! as in `drift check`. Entry points, default exports, and symbols used from outside
//! the role stay members.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};

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

fn file(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: package.into(),
        lang: if path.ends_with(".tsx") { "tsx" } else { "ts" }.into(),
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

/// The repo, with 40 plain functions and 40 plain components in another package: the
/// baseline a role's rules are contrasted with.
fn repo(mut files: Vec<FileFacts>) -> RepoFacts {
    for i in 0..40 {
        files.push(file(
            &format!("other/src/f{i}.ts"),
            "other",
            vec![sym(
                &format!("f{i}"),
                SymbolKind::Function,
                &[&format!("f{i}")],
                |_| {},
            )],
        ));
        files.push(file(
            &format!("other/src/C{i}.tsx"),
            "other",
            vec![sym(
                &format!("C{i}"),
                SymbolKind::Component,
                &[&format!("C{i}")],
                |_| {},
            )],
        ));
    }
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

fn wrapped_by<'a>(cs: &'a [Candidate], target: &str) -> Option<&'a Candidate> {
    cs.iter().find(
        |c| matches!(&c.rule, Rule::WrappedBy { any_of, .. } if any_of.iter().any(|a| a == target)),
    )
}

fn outliers(c: &Candidate) -> Vec<&str> {
    c.outliers.iter().map(|o| o.symbol.as_str()).collect()
}

fn exempt(c: &Candidate) -> Vec<(&str, &str)> {
    c.exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.reason.as_str()))
        .collect()
}

/// `drift check` with `c` accepted: the symbols it reports.
fn violators(r: &RepoFacts, c: &Candidate) -> Vec<String> {
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    let mut v: Vec<String> = check(r, &p, &Lock::default(), Scope::Accepted, None)
        .violations
        .iter()
        .map(|v| v.symbol.clone())
        .collect();
    v.sort();
    v
}

const PKG: &str = "backend";
const DIR: &str = "backend/src/emails";
const WRAPPER: &str = "backend/src/emails/BaseEmailWrapper.tsx#BaseEmailWrapper";
const BUTTON: &str = "backend/src/emails/BaseButton.tsx#BaseButton";
const LINK: &str = "backend/src/emails/BaseLink.tsx#BaseLink";

/// infisical's emails: 40 templates (default and named exports) render inside
/// `<BaseEmailWrapper>` and render `BaseButton` or `BaseLink`; the wrapper and the two
/// fragments are exported components of the same directory. `extra` adds templates.
fn emails(extra: Vec<FileFacts>) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            let name = format!("Notice{i}Template");
            file(
                &format!("{DIR}/{name}.tsx"),
                PKG,
                vec![sym(
                    &name,
                    SymbolKind::Component,
                    &[&name, "default"],
                    |s| {
                        s.wraps.push(wrap(WRAPPER, WrapKind::Jsx));
                        s.renders.push(WRAPPER.into());
                        s.renders
                            .push(if i % 2 == 0 { BUTTON } else { LINK }.into());
                        s.controls.push("return_jsx".into());
                    },
                )],
            )
        })
        .collect();
    for (path, name, renders) in [
        (
            "BaseEmailWrapper.tsx",
            "BaseEmailWrapper",
            "pkg:@react-email/components#Html",
        ),
        (
            "BaseButton.tsx",
            "BaseButton",
            "pkg:@react-email/components#Button",
        ),
        (
            "BaseLink.tsx",
            "BaseLink",
            "pkg:@react-email/components#Link",
        ),
    ] {
        files.push(file(
            &format!("{DIR}/{path}"),
            PKG,
            vec![sym(name, SymbolKind::Component, &[name], |s| {
                s.renders.push(renders.into());
                s.controls.push("return_jsx".into());
            })],
        ));
    }
    files.extend(extra);
    repo(files)
}

fn template(name: &str, edit: impl FnOnce(&mut Symbol)) -> FileFacts {
    file(
        &format!("{DIR}/{name}.tsx"),
        PKG,
        vec![sym(name, SymbolKind::Component, &[name, "default"], edit)],
    )
}

#[test]
fn fragments_the_templates_render_are_parts_not_outliers() {
    // A template that renders no wrapper is a mistake; the wrapper itself and the
    // fragments every template renders are parts of the templates.
    let r = emails(vec![template("PlainTemplate", |s| {
        s.renders.push(BUTTON.into());
    })]);
    let cs = mined(&r);
    let c = wrapped_by(&cs, WRAPPER).expect("the wrapper convention is still found");
    assert_eq!(outliers(c), ["PlainTemplate"]);
    assert_eq!(
        exempt(c),
        [
            ("BaseButton", "shared part used by 21 members"),
            ("BaseEmailWrapper", "shared part used by 40 members"),
            ("BaseLink", "shared part used by 20 members"),
        ]
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 41));
    assert_eq!(c.evidence.role_members, Some(44));
    // `drift check` agrees: only the template is reported.
    assert_eq!(violators(&r, c), ["PlainTemplate"]);
}

#[test]
fn a_rule_whose_only_outliers_are_parts_has_none() {
    // Every template renders inside the wrapper: the fragments were the only outliers,
    // and they are not members. The rule is kept (a new template that skips the wrapper
    // is still a mistake), with no outliers and the parts listed as exempt.
    let r = emails(vec![]);
    let cs = mined(&r);
    let c = wrapped_by(&cs, WRAPPER).expect("still proposed");
    assert!(c.outliers.is_empty(), "{:?}", c.outliers);
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 40));
    assert_eq!(c.exempt.len(), 3);
    assert!(violators(&r, c).is_empty());
}

#[test]
fn a_part_that_is_also_a_member_in_its_own_right_stays_an_outlier() {
    // `DigestTemplate` is an email of its own (a default export) that two other
    // templates embed: a member. `BaseLink` is also rendered by the web app, outside
    // the emails: an API of its own, a member too.
    let digest = "backend/src/emails/DigestTemplate.tsx#DigestTemplate";
    let mut extra = vec![template("DigestTemplate", |s| {
        s.renders.push(BUTTON.into());
    })];
    for i in 0..2 {
        extra.push(template(&format!("Weekly{i}Template"), |s| {
            s.wraps.push(wrap(WRAPPER, WrapKind::Jsx));
            s.renders.push(WRAPPER.into());
            s.renders.push(digest.into());
        }));
    }
    extra.push(file(
        "backend/web/Footer.tsx",
        PKG,
        vec![sym("Footer", SymbolKind::Component, &["Footer"], |s| {
            s.renders.push(LINK.into());
        })],
    ));
    let r = emails(extra);
    let cs = mined(&r);
    let c = wrapped_by(&cs, WRAPPER).expect("wrapper convention");
    assert_eq!(outliers(c), ["BaseLink", "DigestTemplate"]);
    let ex: Vec<&str> = exempt(c).iter().map(|e| e.0).collect();
    assert_eq!(ex, ["BaseButton", "BaseEmailWrapper"]);
    assert_eq!(violators(&r, c), ["BaseLink", "DigestTemplate"]);
}

const CM: &str = "packages/codemod";
const CREATE: &str = "packages/codemod/src/codemods/lib/create-transformer.ts#createTransformer";

/// ai's codemods: 60 default-exported codemods wrapped in `createTransformer()`, three
/// of which call `insertCommentOnce`; `lib/` holds `createTransformer`, the comment
/// helper, `removeAwaitFn` (returns `createTransformer(...)`, used by two value
/// codemods `export default removeAwaitFn("x")`), `addAwaitFn` (the same, used by one)
/// and `formatName` (a plain helper one codemod calls). `extra` adds files.
fn codemods(extra: Vec<FileFacts>) -> RepoFacts {
    let lib = |f: &str| format!("{CM}/src/codemods/lib/{f}");
    let mut files: Vec<FileFacts> = (0..60)
        .map(|i| {
            file(
                &format!("{CM}/src/codemods/v{}/codemod-{i}.ts", 4 + i % 4),
                CM,
                vec![sym("default", SymbolKind::Function, &["default"], |s| {
                    s.wraps.push(wrap(CREATE, WrapKind::Call));
                    if i < 3 {
                        s.calls.push(lib("add-comment.ts#insertCommentOnce"));
                    }
                    if i == 3 {
                        s.calls.push(lib("format.ts#formatName"));
                    }
                })],
            )
        })
        .collect();
    // A codemod that forgot its wrapper: a mistake.
    files.push(file(
        &format!("{CM}/src/codemods/v7/forgot.ts"),
        CM,
        vec![sym("default", SymbolKind::Function, &["default"], |_| {})],
    ));
    for (f, name, calls) in [
        ("create-transformer.ts", "createTransformer", vec![]),
        ("add-comment.ts", "insertCommentOnce", vec![]),
        (
            "remove-await-fn.ts",
            "removeAwaitFn",
            vec![CREATE.to_string()],
        ),
        ("add-await-fn.ts", "addAwaitFn", vec![CREATE.to_string()]),
        ("format.ts", "formatName", vec![]),
    ] {
        files.push(file(
            &lib(f),
            CM,
            vec![sym(name, SymbolKind::Function, &[name], |s| {
                s.calls = calls
            })],
        ));
    }
    for (f, factory) in [
        ("v4/remove-await-a.ts", "remove-await-fn.ts#removeAwaitFn"),
        ("v4/remove-await-b.ts", "remove-await-fn.ts#removeAwaitFn"),
        ("v6/add-await.ts", "add-await-fn.ts#addAwaitFn"),
    ] {
        files.push(file(
            &format!("{CM}/src/codemods/{f}"),
            CM,
            vec![sym("default", SymbolKind::Const, &["default"], |s| {
                s.calls.push(lib(factory));
            })],
        ));
    }
    files.extend(extra);
    repo(files)
}

#[test]
fn helpers_the_codemods_call_are_parts() {
    let r = codemods(vec![]);
    let cs = mined(&r);
    let c = wrapped_by(&cs, CREATE).expect("the wrapper convention is still found");
    // The codemod that forgot its wrapper is reported, and so is `formatName`: one
    // codemod calls it. So is `addAwaitFn`: one codemod uses it, and a call to the
    // wrapper somewhere in its body does not make it a factory of members.
    assert_eq!(outliers(c), ["addAwaitFn", "formatName", "default"]);
    assert_eq!(
        c.outliers[2].path,
        format!("{CM}/src/codemods/v7/forgot.ts")
    );
    assert_eq!(
        exempt(c),
        [
            ("insertCommentOnce", "shared part used by 3 members"),
            ("createTransformer", "shared part used by 62 members"),
            ("removeAwaitFn", "shared part used by 2 members"),
        ]
    );
    assert_eq!(violators(&r, c), ["addAwaitFn", "default", "formatName"]);
}

#[test]
fn entry_points_are_never_parts() {
    // dub's server actions: 20 wrapped in an auth client; `banPartner` is an unwrapped
    // server action that two other actions call (and a route imports). It is reachable
    // without the client, so it is a member however many members call it.
    let client = "apps/web/lib/actions/safe-action.ts#authActionClient.inputSchema().action";
    let ban = "apps/web/lib/actions/partners/ban-partner.ts#banPartner";
    let action = |path: &str, name: &str, edit: &dyn Fn(&mut Symbol)| {
        let mut f = file(
            path,
            "apps/web",
            vec![sym(name, SymbolKind::Function, &[name], |s| edit(s))],
        );
        f.directives.push("use server".into());
        f.entry_points.push(EntryPoint {
            symbol: name.into(),
            kind: "server_action".into(),
            method: None,
            route: None,
            adapter: "test".into(),
        });
        f
    };
    let mut files: Vec<FileFacts> = (0..20)
        .map(|i| {
            action(
                &format!("apps/web/lib/actions/partners/action-{i}.ts"),
                &format!("action{i}"),
                &|s: &mut Symbol| {
                    s.wraps.push(wrap(client, WrapKind::Call));
                    if i < 2 {
                        s.calls.push(ban.into());
                    }
                },
            )
        })
        .collect();
    files.push(action(
        "apps/web/lib/actions/partners/ban-partner.ts",
        "banPartner",
        &|_: &mut Symbol| {},
    ));
    let r = repo(files);
    let cs = mined(&r);
    let c = wrapped_by(&cs, client).expect("auth client convention");
    assert_eq!(c.role.entry, "server_action");
    assert_eq!(outliers(c), ["banPartner"]);
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(violators(&r, c), ["banPartner"]);
}

#[test]
fn parts_are_decided_the_same_way_whatever_the_file_order() {
    let r = codemods(vec![]);
    let mut shuffled = r.clone();
    shuffled.files.reverse();
    shuffled.normalize();
    let a = serde_json::to_string(&mined(&r)).unwrap();
    let b = serde_json::to_string(&mined(&shuffled)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn a_single_file_scan_of_a_possible_part_needs_a_full_scan() {
    // A hook's single-file facts of `BaseButton.tsx` cannot say who renders it, so
    // whether it is a part is undecided: the hook scans the repo. A full scan decides,
    // and so does a template (a default export is never a part).
    let r = emails(vec![]);
    let c = wrapped_by(&mined(&r), WRAPPER)
        .expect("wrapper convention")
        .clone();
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &[c]);
    p.conventions[0].status = Status::Accepted;
    let only = |path: &str| {
        let mut one = r.clone();
        one.files.retain(|f| f.path == path);
        one
    };
    assert!(drift_mine::check::needs_full_scan(
        &only(&format!("{DIR}/BaseButton.tsx")),
        &p
    ));
    assert!(!drift_mine::check::needs_full_scan(&r, &p));
    let mut plain = repo(vec![template("PlainTemplate", |_| {})]);
    plain.files.retain(|f| f.path.starts_with(DIR));
    assert!(!drift_mine::check::needs_full_scan(&plain, &p));
}

const HANDLERS: &str = "lib/handlers";
const DELETE_USER: &str = "lib/handlers/users.ts#deleteUser";

/// 40 handlers in `lib/handlers/` wrapped in `wrapper`, two of which call
/// `deleteUser`, an unwrapped exported function beside them (the reviewer's fixture of
/// #52). `extra` adds files.
fn handlers(wrapper: &str, extra: Vec<FileFacts>) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            let name = format!("handle{i}");
            file(
                &format!("{HANDLERS}/h{i}.ts"),
                "",
                vec![sym(&name, SymbolKind::Const, &[&name], |s| {
                    s.wraps.push(wrap(wrapper, WrapKind::Call));
                    if i < 2 {
                        s.calls.push(DELETE_USER.into());
                    }
                })],
            )
        })
        .collect();
    files.push(file(
        &format!("{HANDLERS}/users.ts"),
        "",
        vec![sym(
            "deleteUser",
            SymbolKind::Const,
            &["deleteUser"],
            |_| {},
        )],
    ));
    for i in 0..40 {
        files.push(file(
            &format!("util/u{i}.ts"),
            "",
            vec![sym(
                &format!("u{i}"),
                SymbolKind::Const,
                &[&format!("u{i}")],
                |_| {},
            )],
        ));
    }
    files.extend(extra);
    repo(files)
}

/// The handlers' wrapper convention: its outliers and exempt members.
fn handler_rule(r: &RepoFacts, wrapper: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    let cs = mined(r);
    let c = wrapped_by(&cs, wrapper).unwrap_or_else(|| panic!("{cs:#?}"));
    (
        outliers(c).iter().map(|o| o.to_string()).collect(),
        exempt(c).iter().map(|e| e.0.to_string()).collect(),
        violators(r, c),
    )
}

fn importer(path: &str, names: &[&str]) -> FileFacts {
    let mut f = file(path, "", vec![]);
    f.imports.push(drift_core::Import {
        module: format!("{HANDLERS}/users.ts"),
        names: names.iter().map(|n| n.to_string()).collect(),
        type_only: false,
        load: Default::default(),
    });
    f
}

#[test]
fn a_helper_beside_wrapped_handlers_is_a_part_only_under_a_rule_that_guards_nothing() {
    // `withTiming` guards nothing: the helper two handlers call is a part.
    let timing = "lib/timing.ts#withTiming";
    let (out, ex, v) = handler_rule(&handlers(timing, vec![]), timing);
    assert!(out.is_empty(), "{out:?}");
    assert_eq!(ex, ["deleteUser"]);
    assert!(v.is_empty());
    // `withAuth` is named like a guard: an unwrapped symbol under it is reported,
    // whoever uses it.
    for auth in [
        "lib/auth.ts#withAuth",
        "lib/session.ts#requireSession",
        "lib/safe-action.ts#authActionClient.action",
        "lib/wrap.ts#protectedProcedure",
    ] {
        let (out, ex, v) = handler_rule(&handlers(auth, vec![]), auth);
        assert_eq!(out, ["deleteUser"], "{auth}");
        assert!(ex.is_empty(), "{auth}: {ex:?}");
        assert_eq!(v, ["deleteUser"], "{auth}");
    }
}

#[test]
fn a_wrapper_that_guards_an_entry_point_anywhere_is_a_guard() {
    // `withTiming` also wraps a route handler: `drift security` reads it as that
    // route's guard, so the rule is a security boundary and has no parts.
    let timing = "lib/timing.ts#withTiming";
    let mut route = file(
        "app/api/ping/route.ts",
        "",
        vec![sym("GET", SymbolKind::Const, &["GET"], |s| {
            s.wraps.push(wrap(timing, WrapKind::Call));
        })],
    );
    route.entry_points.push(EntryPoint {
        symbol: "GET".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/api/ping".into()),
        adapter: "test".into(),
    });
    let (out, ex, v) = handler_rule(&handlers(timing, vec![route]), timing);
    assert_eq!(out, ["deleteUser"]);
    assert!(ex.is_empty(), "{ex:?}");
    assert_eq!(v, ["deleteUser"]);
}

#[test]
fn a_use_drift_cannot_place_in_the_role_makes_a_member() {
    let timing = "lib/timing.ts#withTiming";
    let mut entry_file = importer(&format!("{HANDLERS}/register.ts"), &["deleteUser"]);
    entry_file.entry_points.push(EntryPoint {
        symbol: "DELETE".into(),
        kind: "http".into(),
        method: Some("DELETE".into()),
        route: Some("/api/users".into()),
        adapter: "test".into(),
    });
    let reexport = {
        let mut f = file("app/api/users/route.ts", "", vec![]);
        f.exports.push(drift_core::Export {
            name: "DELETE".into(),
            origin: DELETE_USER.into(),
            kind: drift_core::ExportKind::ReExport,
        });
        f
    };
    let barrel = {
        let mut f = file(&format!("{HANDLERS}/index.ts"), "", vec![]);
        f.exports.push(drift_core::Export {
            name: "deleteUser".into(),
            origin: DELETE_USER.into(),
            kind: drift_core::ExportKind::ReExport,
        });
        f
    };
    let cases: Vec<(&str, Vec<FileFacts>, Vec<drift_core::PackageFacts>)> = vec![
        // `app.delete("/users/:id", deleteUser)` in module code, or any other use, of
        // a file outside the role: it imports the helper.
        (
            "imported from outside",
            vec![importer("server/routes.ts", &["deleteUser"])],
            vec![],
        ),
        // `import * as users from ...` outside the role.
        (
            "namespace import",
            vec![importer("server/routes.ts", &["*"])],
            vec![],
        ),
        // A file of the role's own directory that holds an entry point.
        ("entry file", vec![entry_file], vec![]),
        // `export { deleteUser as DELETE } from "@/lib/handlers/users"`.
        ("re-exported", vec![reexport], vec![]),
        // A package entry exposes it to code outside the repository.
        (
            "package entry",
            vec![barrel],
            vec![drift_core::PackageFacts {
                name: "app".into(),
                entries: vec![format!("{HANDLERS}/index.ts")],
                ..Default::default()
            }],
        ),
    ];
    for (case, extra, packages) in cases {
        let mut r = handlers(timing, extra);
        r.packages = packages;
        let (out, ex, v) = handler_rule(&r, timing);
        assert_eq!(out, ["deleteUser"], "{case}");
        assert!(ex.is_empty(), "{case}: {ex:?}");
        assert_eq!(v, ["deleteUser"], "{case}");
    }
    // Tests and stories that import it change nothing.
    let r = handlers(
        timing,
        vec![
            importer("server/routes.test.ts", &["deleteUser"]),
            importer("server/__stories__/routes.tsx", &["deleteUser"]),
        ],
    );
    assert_eq!(handler_rule(&r, timing).1, ["deleteUser"]);
}

/// What an import reaches is worked out once per (module, name) and reused for every
/// file that imports the same: another name imported from the same module first
/// still leaves the helper imported from outside the role, so it is a member.
#[test]
fn an_import_of_another_name_from_the_module_does_not_stand_for_it() {
    let timing = "lib/timing.ts#withTiming";
    let r = handlers(
        timing,
        vec![
            importer("server/a.ts", &["listUsers"]),
            importer("server/b.ts", &["deleteUser"]),
        ],
    );
    let (out, ex, v) = handler_rule(&r, timing);
    assert_eq!(out, ["deleteUser"]);
    assert!(ex.is_empty(), "{ex:?}");
    assert_eq!(v, ["deleteUser"]);
    // Imported only by name from a file of the role, it is a part as before.
    let r = handlers(timing, vec![importer("server/a.ts", &["listUsers"])]);
    assert_eq!(handler_rule(&r, timing).1, ["deleteUser"]);
}

#[test]
fn base_classes_and_class_decorators_are_left_to_class_kinds() {
    // 40 classes extend `BaseProcessor`, which is itself a class of the role: F5 does
    // not set it aside (the class-kind exemptions decide classes).
    let base = "src/processors/base.ts#BaseProcessor";
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            let name = format!("Job{i}Processor");
            file(
                &format!("src/processors/p{i}.ts"),
                "",
                vec![sym(&name, SymbolKind::Class, &[&name], |s| {
                    s.wraps.push(wrap(base, WrapKind::Extends));
                })],
            )
        })
        .collect();
    files.push(file(
        "src/processors/base.ts",
        "",
        vec![sym(
            "BaseProcessor",
            SymbolKind::Class,
            &["BaseProcessor"],
            |_| {},
        )],
    ));
    for i in 0..40 {
        files.push(file(
            &format!("other/c{i}.ts"),
            "other",
            vec![sym(
                &format!("K{i}"),
                SymbolKind::Class,
                &[&format!("K{i}")],
                |_| {},
            )],
        ));
    }
    let cs = mined(&repo(files));
    let c = wrapped_by(&cs, base).expect("extends convention");
    // Not a shared part: the target's own class is left to #45's class-kind
    // exemptions (the module that defines the target), never to parts.
    assert!(outliers(c).is_empty(), "{:?}", outliers(c));
    assert_eq!(
        c.exempt
            .iter()
            .map(|e| (e.symbol.as_str(), e.code.as_str()))
            .collect::<Vec<_>>(),
        [("BaseProcessor", "defining_module")]
    );
}

#[test]
fn access_control_words_and_callees_of_entry_points_guard() {
    // Named for a workspace, a team, an ability: guards, like `withAuth`.
    for t in [
        "lib/workspace.ts#withWorkspace",
        "lib/teams.ts#ensureTeamAccess",
        "lib/ability.ts#assertCan",
        "lib/keys.ts#withApiKey",
        "lib/org.ts#withOrganizations",
    ] {
        assert!(drift_mine::vocab::refuse::part_guard_shaped(t), "{t}");
    }
    for t in [
        "packages/codemod/src/codemods/lib/create-transformer.ts#createTransformer",
        "backend/src/services/smtp/emails/BaseEmailWrapper.tsx#BaseEmailWrapper",
        "lib/timing.ts#withTiming",
        "src/canvas.ts#drawCanvas",
    ] {
        assert!(!drift_mine::vocab::refuse::part_guard_shaped(t), "{t}");
    }
    // A calls rule on what a route handler calls is about what guards it: no parts.
    let check = "lib/check.ts#checkThing";
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            let name = format!("helper{i}");
            file(
                &format!("{HANDLERS}/h{i}.ts"),
                "",
                vec![sym(&name, SymbolKind::Function, &[&name], |s| {
                    s.calls.push(check.into());
                    if i < 2 {
                        s.calls.push(DELETE_USER.into());
                    }
                })],
            )
        })
        .collect();
    files.push(file(
        &format!("{HANDLERS}/users.ts"),
        "",
        vec![sym(
            "deleteUser",
            SymbolKind::Function,
            &["deleteUser"],
            |_| {},
        )],
    ));
    let calls_rule = |cs: &[Candidate]| -> Option<Candidate> {
        cs.iter()
            .find(|c| matches!(&c.rule, Rule::Calls { callee } if callee == check))
            .cloned()
    };
    let free = calls_rule(&mined_every(&repo(files.clone()))).expect("calls rule");
    assert!(free.exempt.iter().any(|e| e.symbol == "deleteUser"));
    let mut route = file(
        "app/api/ping/route.ts",
        "",
        vec![sym("GET", SymbolKind::Function, &["GET"], |s| {
            s.calls.push(check.into())
        })],
    );
    route.entry_points.push(EntryPoint {
        symbol: "GET".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/api/ping".into()),
        adapter: "test".into(),
    });
    files.push(route);
    let guarded = calls_rule(&mined_every(&repo(files))).expect("calls rule");
    assert!(guarded.exempt.is_empty(), "{:?}", guarded.exempt);
    assert!(guarded.outliers.iter().any(|o| o.symbol == "deleteUser"));
}

#[test]
fn an_import_of_default_uses_every_export() {
    // `await import("@/lib/handlers/users")` and `require(...)` are recorded as an
    // import of `default`: the route may use any export, so `deleteUser` is a member.
    let timing = "lib/timing.ts#withTiming";
    for names in [["default"], ["*"]] {
        let r = handlers(timing, vec![importer("app/api/users/route.ts", &names)]);
        let (out, ex, _) = handler_rule(&r, timing);
        assert_eq!(out, ["deleteUser"], "{names:?}");
        assert!(ex.is_empty(), "{names:?}");
    }
    // A unit that calls `m.deleteUser()` on such a module uses it.
    let route = file(
        "app/api/users/route.ts",
        "",
        vec![sym("DELETE", SymbolKind::Function, &["DELETE"], |s| {
            s.calls
                .push(format!("{HANDLERS}/users.ts#default.deleteUser"))
        })],
    );
    let (out, ex, _) = handler_rule(&handlers(timing, vec![route]), timing);
    assert_eq!(out, ["deleteUser"]);
    assert!(ex.is_empty());
}
