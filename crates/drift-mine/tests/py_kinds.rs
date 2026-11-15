//! Python precision round 6: what a naming or call rule on a class role is about
//! (classes of another kind, `super().m()` overrides), built-in calls, and calls made
//! through in-repo helpers.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::mine::{Candidate, Evidence, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{Convention, ConventionsFile, Lock, Mode, SELECTOR_VERSION, Status};
use drift_mine::roles::units;

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

fn class(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    sym(name, SymbolKind::Class, edit)
}

fn func(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    sym(name, SymbolKind::Function, edit)
}

fn py(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "py".into(),
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

fn extends(s: &mut Symbol, base: &str) {
    s.wraps.push(wrap(base, WrapKind::Extends));
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

/// Unrelated classes and functions, so that no rule is universal in the repo.
fn background(files: &mut Vec<FileFacts>) {
    for i in 0..100 {
        files.push(py(
            &format!("other/c{i}.py"),
            vec![
                class(&format!("C{i}"), |_| {}),
                func(&format!("f{i}"), |_| {}),
            ],
        ));
    }
}

fn find<'c>(cs: &'c [Candidate], rule: &Rule) -> &'c Candidate {
    pick(cs, |c| &c.rule == rule)
}

fn pick(cs: &[Candidate], f: impl Fn(&Candidate) -> bool) -> &Candidate {
    cs.iter().find(|c| f(c)).unwrap_or_else(|| {
        panic!(
            "not mined: {:?}",
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

fn exempt(c: &Candidate) -> Vec<(&str, &str)> {
    let mut v: Vec<(&str, &str)> = c
        .exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.reason.as_str()))
        .collect();
    v.sort();
    v
}

fn violators(files: Vec<FileFacts>, accepted: &[FileFacts], id: &str) -> Vec<String> {
    let base = repo(accepted.to_vec());
    let cs = mined(&base);
    let mut p = ConventionsFile::merge(
        None,
        "test",
        mine(&base, &MineOptions::default()).kinds,
        &cs,
    );
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    let mut v: Vec<String> = check(&repo(files), &p, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == id)
        .map(|v| v.symbol)
        .collect();
    v.sort();
    v
}

const MODEL_SERIALIZER: &str = "pkg:rest_framework#serializers.ModelSerializer";

/// A DRF serializer, with the lineage kind the Python repo pass records for it (W1).
fn serializer(s: &mut Symbol) {
    extends(s, MODEL_SERIALIZER);
    s.traits.push(drift_core::lineage::trait_for(
        drift_core::lineage::SERIALIZER,
    ));
}
const CHOICE_FIELD: &str = "pkg:rest_framework#serializers.ChoiceField";

fn named(pattern: &str) -> Rule {
    Rule::Named {
        pattern: pattern.into(),
    }
}

/// 60 serializers in `app/m*/serializers.py`; field classes named for their base
/// beside some, one misnamed serializer on the followers' base, a plain class.
fn serializers() -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..60 {
        let mut symbols = vec![class(&format!("M{i}Serializer"), serializer)];
        match i {
            0 => symbols.push(class("StatusField", |s| extends(s, CHOICE_FIELD))),
            1 => symbols.push(class("PriceField", |s| {
                extends(s, "pkg:rest_framework#serializers.DecimalField")
            })),
            2 => symbols.push(class("PartSerializerUpdate", serializer)),
            3 => symbols.push(class("Plain", |_| {})),
            _ => {}
        }
        files.push(py(&format!("app/m{i}/serializers.py"), symbols));
    }
    // A field in a serializers file of its own: no follower beside it.
    files.push(py(
        "app/m90/serializers.py",
        vec![class("LoneField", |s| extends(s, CHOICE_FIELD))],
    ));
    background(&mut files);
    files
}

#[test]
fn a_python_class_of_another_kind_is_not_about_a_naming_rule() {
    // Since W1 the serializers form a role of their own (their lineage kind): the field
    // classes and the plain class beside them are in another role, not exempt from this
    // one, and the misnamed serializer is still an outlier.
    let cs = mined(&repo(serializers()));
    let c = find(&cs, &named("*Serializer"));
    assert_eq!(c.role.member_kind.as_deref(), Some("serializer"));
    assert_eq!(outliers(c), ["PartSerializerUpdate"]);
    assert_eq!(exempt(c), Vec::<(&str, &str)>::new());
}

#[test]
fn check_agrees_on_a_naming_rule_and_still_reports_a_misnamed_member() {
    let files = serializers();
    let id = find(&mined(&repo(files.clone())), &named("*Serializer"))
        .id
        .clone();
    let mut after = files.clone();
    after.push(py(
        "app/m40/serializers.py",
        vec![
            class("TagField", |s| extends(s, CHOICE_FIELD)),
            class("TagThing", serializer),
        ],
    ));
    assert_eq!(
        violators(after, &files, &id),
        ["PartSerializerUpdate", "TagThing"]
    );
}

#[test]
fn a_generic_base_under_a_package_line_stays_an_outlier_of_a_naming_rule() {
    // #27's probe: `OrderModel(BaseModel)` among schemas on a package base that may be
    // built on `BaseModel` is a misnamed schema, not another kind.
    let mut files = Vec::new();
    for i in 0..60 {
        files.push(py(
            &format!("app/s{i}/schemas.py"),
            vec![class(&format!("S{i}Schema"), |s| {
                extends(s, "pkg:ninja#Schema")
            })],
        ));
    }
    files[0].symbols.push(class("OrderModel", |s| {
        extends(s, "pkg:pydantic#BaseModel")
    }));
    // A class on the schemas' base that skipped the name: naming and base rules differ.
    files[1]
        .symbols
        .push(class("LegacyThing", |s| extends(s, "pkg:ninja#Schema")));
    background(&mut files);
    // Since W3 a naming rule over plain Python classes (no framework lineage) is not
    // proposed: such a role may mix kinds Drift cannot tell apart.
    let cs = mined(&repo(files.clone()));
    assert!(!cs.iter().any(|c| c.rule == named("*Schema")));
    // Mined over classes of one lineage kind, `OrderModel` is still an outlier.
    for f in &mut files {
        if f.path.ends_with("schemas.py") {
            for s in &mut f.symbols {
                s.traits
                    .push(drift_core::lineage::trait_for(drift_core::lineage::MODEL));
            }
        }
    }
    let cs = mined(&repo(files));
    let c = find(&cs, &named("*Schema"));
    assert_eq!(
        outliers(c),
        ["LegacyThing", "OrderModel"],
        "{:?}",
        exempt(c)
    );
}

#[test]
fn a_helper_in_the_module_that_defines_the_followers_base_is_not_about_their_name() {
    let set = "app/utils/choices.py#ChoiceSet";
    let mut files = vec![py(
        "app/utils/choices.py",
        vec![
            class("ChoiceSet", |_| {}),
            class("Entry", |s| extends(s, "global#tuple")),
        ],
    )];
    for i in 0..60 {
        files.push(py(
            &format!("app/a{i}/choices.py"),
            vec![class(&format!("A{i}Choices"), |s| extends(s, set))],
        ));
    }
    files[1]
        .symbols
        .push(class("StatusThing", |s| extends(s, set)));
    background(&mut files);
    // Plain classes: no naming rule since W3 (see above). Of one lineage kind, the
    // helper in the module that defines their base is still not about their name.
    assert!(
        !mined(&repo(files.clone()))
            .iter()
            .any(|c| c.rule == named("*Choices"))
    );
    for f in &mut files {
        for s in &mut f.symbols {
            if f.path.ends_with("choices.py") {
                s.traits
                    .push(drift_core::lineage::trait_for(drift_core::lineage::MODEL));
            }
        }
    }
    let cs = mined(&repo(files));
    let c = pick(&cs, |c| c.rule == named("*Choices"));
    assert_eq!(outliers(c), ["StatusThing"]);
    assert!(
        exempt(c).contains(&("Entry", "in the module that defines ChoiceSet")),
        "{:?}",
        exempt(c)
    );
}

#[test]
fn typescript_naming_rules_are_unchanged() {
    // The same classes in TypeScript: only `companion_exemption` decides there.
    let files: Vec<FileFacts> = serializers()
        .into_iter()
        .map(|mut f| {
            f.lang = "ts".into();
            f.path = f.path.replace(".py", ".ts");
            // Lineage kinds are Python facts.
            for s in &mut f.symbols {
                s.traits.clear();
            }
            f
        })
        .collect();
    let cs = mined(&repo(files));
    // TypeScript's companions say whom they sit beside; this round's exemption does not.
    // A field with no follower in its file is no companion there: it is exempt only as
    // the role's base-class rule leaves it out (another kind of class), said as such.
    let c = find(&cs, &named("*Serializer"));
    assert!(
        c.exempt.iter().all(
            |e| e.reason.contains(" beside ") || e.reason.contains(" (as for the role's rule ")
        ),
        "{:?}",
        exempt(c)
    );
    let lone = c
        .exempt
        .iter()
        .find(|e| e.symbol == "LoneField")
        .expect("LoneField");
    assert_eq!(lone.code, "another_kind");
    assert!(
        lone.reason
            .ends_with("(as for the role's rule \"extend serializers.ModelSerializer\")"),
        "{}",
        lone.reason
    );
}

const GETTEXT: &str = "pkg:django#utils.translation.gettext_lazy";
const MODEL: &str = "pkg:django#db.models.Model";

/// 30 models files: a model calling `gettext_lazy()` in each, a manager beside some,
/// and a model that does not call it.
fn models() -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![class(&format!("Thing{i}"), |s| {
            extends(s, MODEL);
            s.calls.push(GETTEXT.into());
        })];
        match i {
            0 => symbols.push(class("ThingManager", |s| {
                extends(s, "pkg:django#db.models.Manager")
            })),
            1 => symbols.push(class("NoDeleteQuerySet", |s| {
                extends(s, "pkg:django#db.models.QuerySet")
            })),
            2 => symbols.push(class("Owner", |s| extends(s, MODEL))),
            // A class of another kind that does call it holds the rule: never exempt.
            3 => symbols.push(class("LabelCache", |s| {
                extends(s, "pkg:django#core.cache.backends.base.BaseCache");
                s.calls.push(GETTEXT.into());
            })),
            _ => {}
        }
        files.push(py(&format!("app/m{i}/models.py"), symbols));
    }
    background(&mut files);
    files
}

fn calls(callee: &str) -> Rule {
    Rule::Calls {
        callee: callee.into(),
    }
}

#[test]
fn a_python_class_of_another_kind_is_not_about_a_call_rule_of_its_class_role() {
    let cs = mined(&repo(models()));
    let c = find(&cs, &calls(GETTEXT));
    assert_eq!(outliers(c), ["Owner"]);
    assert_eq!(
        exempt(c),
        [
            (
                "NoDeleteQuerySet",
                "another kind of class (extends db.models.QuerySet)"
            ),
            (
                "ThingManager",
                "another kind of class (extends db.models.Manager)"
            ),
        ]
    );
}

const SUPER_CALL: &str = "global#super().__call__";

/// 60 hooks (on four bases) that override `__call__` and delegate to `super().__call__()`, one that
/// overrides it without delegating, and helper classes that define no `__call__`.
fn hooks() -> Vec<FileFacts> {
    let bases = ["FilterHook", "ActionHook", "ListHook", "MapHook"];
    let mut files = vec![py(
        "app/plugins/hooks.py",
        bases
            .iter()
            .map(|b| class(b, |s| s.declares.push("__call__=".into())))
            .collect(),
    )];
    for i in 0..60 {
        let mut symbols = vec![class(&format!("Build{i}"), |s| {
            extends(s, &format!("app/plugins/hooks.py#{}", bases[i % 4]));
            s.declares.push("__call__=".into());
            if i != 0 {
                s.calls.push("global#super".into());
                s.calls.push(SUPER_CALL.into());
            }
        })];
        if i < 3 {
            symbols.push(class(&format!("Result{i}"), |s| {
                s.declares.push("__init__=".into());
                s.declares.push("__bool__=".into());
            }));
        }
        files.push(py(&format!("app/perms/m{i}.py"), symbols));
    }
    background(&mut files);
    // Enough other classes for the call to be characteristic of the role.
    for i in 0..300 {
        files.push(py(
            &format!("misc/x{i}.py"),
            vec![class(&format!("X{i}"), |_| {})],
        ));
    }
    files
}

#[test]
fn a_super_call_rule_is_about_the_classes_that_override_the_method() {
    let cs = mined(&repo(hooks()));
    let c = pick(&cs, |c| c.rule == calls(SUPER_CALL));
    assert_eq!(outliers(c), ["Build0"]);
    assert_eq!(
        exempt(c).iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        ["Result0", "Result1", "Result2"]
    );
    assert!(
        exempt(c)[0].1.starts_with("defines no __call__()"),
        "{:?}",
        exempt(c)
    );
}

#[test]
fn python_builtin_calls_are_no_rule() {
    let cs = mined(&repo(hooks()));
    assert!(
        !cs.iter().any(|c| c.rule == calls("global#super")),
        "a bare super() is no convention"
    );
    let mut files = Vec::new();
    for i in 0..30 {
        files.push(py(
            &format!("app/svc/s{i}.py"),
            vec![func(&format!("work{i}"), |s| {
                if i != 0 {
                    s.calls.push("global#str".into());
                }
            })],
        ));
    }
    background(&mut files);
    let cs = mined(&repo(files));
    assert!(!cs.iter().any(|c| c.rule == calls("global#str")));
}

const REDIS: &str = "app/redis.py#get_redis_client";

/// 30 state functions calling `get_redis_client()` directly, two that call it
/// through an in-repo helper, and one that never does.
fn state() -> Vec<FileFacts> {
    let mut files = vec![py("app/redis.py", vec![func("get_redis_client", |_| {})])];
    let mut helpers = vec![func("get_anchor", |s| s.calls.push(REDIS.into()))];
    helpers.push(func("window_range", |s| {
        s.calls.push("app/state/window.py#get_anchor".into())
    }));
    helpers.push(func("window_cell", |s| {
        s.calls.push("app/state/window.py#window_range".into())
    }));
    helpers.push(func("plain_cell", |_| {}));
    files.push(py("app/state/window.py", helpers));
    for i in 0..30 {
        files.push(py(
            &format!("app/state/s{i}.py"),
            vec![func(&format!("acquire{i}"), |s| s.calls.push(REDIS.into()))],
        ));
    }
    background(&mut files);
    files
}

#[test]
fn a_python_function_calls_what_its_in_repo_helpers_call() {
    let cs = mined(&repo(state()));
    let c = pick(&cs, |c| c.rule == calls(REDIS));
    assert_eq!(outliers(c), ["plain_cell"]);
}

#[test]
fn check_counts_a_call_through_an_in_repo_helper() {
    let files = state();
    let id = mined(&repo(files.clone()))
        .into_iter()
        .find(|c| c.rule == calls(REDIS))
        .expect("mined")
        .id;
    let mut after = files.clone();
    after.push(py(
        "app/state/new.py",
        vec![
            func("via_helper", |s| {
                s.calls.push("app/state/window.py#get_anchor".into())
            }),
            func("forgot", |_| {}),
        ],
    ));
    assert_eq!(violators(after, &files, &id), ["forgot", "plain_cell"]);
}

const FILTER: &str = "app/plugins/base.py#FilterHook";
const ACTION: &str = "app/plugins/base.py#ActionHook";

/// 30 filter hooks, two action hooks among them (on the other base the module
/// defines), and one hook on a base of another module.
fn sibling_hooks(action_hooks_elsewhere: usize) -> Vec<FileFacts> {
    let mut files = vec![py(
        "app/plugins/base.py",
        vec![class("FilterHook", |_| {}), class("ActionHook", |_| {})],
    )];
    for i in 0..30 {
        files.push(py(
            &format!("app/hooks/h{i}.py"),
            vec![class(&format!("H{i}Hook"), |s| {
                extends(
                    s,
                    match i {
                        0 => ACTION,
                        1 => "app/legacy/base.py#OldHook",
                        _ => FILTER,
                    },
                )
            })],
        ));
    }
    files.push(py("app/legacy/base.py", vec![class("OldHook", |_| {})]));
    for i in 0..action_hooks_elsewhere {
        files.push(py(
            &format!("app/posting/p{i}.py"),
            vec![class(&format!("P{i}Hook"), |s| extends(s, ACTION))],
        ));
    }
    background(&mut files);
    files
}

fn extends_rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![target.into()],
    }
}

#[test]
fn a_class_on_a_sibling_base_of_the_target_is_not_about_it() {
    let cs = mined(&repo(sibling_hooks(1)));
    let c = pick(&cs, |c| c.rule == extends_rule(FILTER));
    assert_eq!(outliers(c), ["H1Hook"]);
    assert_eq!(
        exempt(c),
        [(
            "H0Hook",
            "extends ActionHook, which the module of FilterHook defines beside it"
        )]
    );
}

#[test]
fn a_sibling_base_only_one_class_extends_is_no_sibling() {
    let cs = mined(&repo(sibling_hooks(0)));
    let c = pick(&cs, |c| c.rule == extends_rule(FILTER));
    assert_eq!(outliers(c), ["H0Hook", "H1Hook"]);
}

fn accepted(r: &RepoFacts, c: &Candidate) -> ConventionsFile {
    let mut p = ConventionsFile::merge(
        None,
        "test",
        mine(r, &MineOptions::default()).kinds,
        std::slice::from_ref(c),
    );
    p.conventions[0].status = Status::Accepted;
    p
}

fn only(r: &RepoFacts, path: &str) -> RepoFacts {
    let mut one = r.clone();
    one.files.retain(|f| f.path == path);
    one
}

#[test]
fn a_single_file_scan_of_a_class_of_another_kind_needs_a_full_scan() {
    // The followers are in other files: facts of one file cannot decide the exemption.
    // (A call rule of a plain-class role: since W1 a naming rule's role is of one
    // member kind, which holds no class of another kind.)
    let r = repo(models());
    let p = accepted(&r, find(&mined(&r), &calls(GETTEXT)));
    assert!(needs_full_scan(&only(&r, "app/m0/models.py"), &p));
    assert!(!needs_full_scan(&r, &p));
    // A file of followers alone is decided.
    assert!(!needs_full_scan(&only(&r, "app/m10/models.py"), &p));
}

const RESPONSE: &str = "pkg:rest_framework#response.Response";

fn handler(path: &str, name: &str, edit: impl FnOnce(&mut Symbol)) -> FileFacts {
    let mut f = py(path, vec![func(name, edit)]);
    f.entry_points.push(drift_core::EntryPoint {
        symbol: name.into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some(format!("/{name}")),
        adapter: "django".into(),
    });
    f
}

/// 40 HTTP handlers that return `Response()`, one through a helper of another file,
/// one that does not.
fn handlers() -> Vec<FileFacts> {
    let mut files = vec![py(
        "app/api/helpers.py",
        vec![func("answer", |s| s.calls.push(RESPONSE.into()))],
    )];
    for i in 0..40 {
        files.push(handler(
            &format!("app/api/v{i}.py"),
            &format!("view{i}"),
            |s| match i {
                0 => s.calls.push("app/api/helpers.py#answer".into()),
                1 => s.calls.push("pkg:django#http.FileResponse".into()),
                _ => s.calls.push(RESPONSE.into()),
            },
        ));
    }
    background(&mut files);
    files
}

/// A convention accepted on `handlers()` before such rules were hidden from mining: it
/// is still checked.
fn accepted_handler_rule(r: &RepoFacts) -> ConventionsFile {
    let kinds = mine(r, &MineOptions::default()).kinds;
    let role = units(r, &kinds)
        .into_iter()
        .find(|u| u.path() == "app/api/v5.py")
        .and_then(|u| u.roles.into_iter().find(|x| x.entry == "http"))
        .expect("handlers have a role");
    let mut p = ConventionsFile::merge(None, "test", kinds, &[]);
    p.conventions.push(Convention {
        id: "D-000001".into(),
        status: Status::Accepted,
        mode: Mode::Advise,
        summary: "HTTP handlers call Response()".into(),
        role,
        rule: calls(RESPONSE),
        evidence: Evidence {
            holders: 39,
            total: 40,
            lower_bound: 0.87,
            lift: 5.0,
            split: vec![],
            role_members: None,
            python_members: Some(40),
        },
        example: "app/api/v5.py#view5".into(),
        selector_version: SELECTOR_VERSION,
        agents: None,
        exceptions: Vec::new(),
        different_kind: Vec::new(),
        promoted_from_hidden: false,
    });
    p
}

#[test]
fn a_single_file_scan_of_a_call_through_another_files_helper_needs_a_full_scan() {
    let r = repo(handlers());
    let p = accepted_handler_rule(&r);
    let reported: Vec<String> = check(&r, &p, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .map(|v| v.symbol)
        .collect();
    assert_eq!(reported, ["view1"]);
    // `answer` is in a file the scan lacks: undecided.
    assert!(needs_full_scan(&only(&r, "app/api/v0.py"), &p));
    // A handler that calls the callee itself, or calls nothing of the repo, is decided
    // alone.
    assert!(!needs_full_scan(&only(&r, "app/api/v5.py"), &p));
    assert!(!needs_full_scan(&only(&r, "app/api/v1.py"), &p));
    assert!(!needs_full_scan(&r, &p));
}

// Hidden Python families (a separate decision): call order, `os.environ` avoidance,
// and calls on HTTP handler functions are never proposed for Python.

#[test]
fn python_calls_on_http_handlers_are_not_proposed() {
    let r = repo(handlers());
    assert!(
        !mined(&r).iter().any(|c| c.rule == calls(RESPONSE)),
        "a handler's response call is not proposed"
    );
}

#[test]
fn python_calls_on_other_functions_are_still_proposed() {
    let cs = mined(&repo(state()));
    pick(&cs, |c| c.rule == calls(REDIS));
}

const FLASH: &str = "pkg:flask#flash";
const REDIRECT: &str = "pkg:flask#redirect";

/// 40 functions that flash before they redirect, one that redirects first; in `lang`.
fn ordered(lang: &str) -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..40 {
        let mut f = py(
            &format!("app/views/v{i}.py"),
            vec![func(&format!("act{i}"), |s| {
                s.calls.push(FLASH.into());
                s.calls.push(REDIRECT.into());
                s.order = if i == 0 {
                    vec![REDIRECT.into(), FLASH.into()]
                } else {
                    vec![FLASH.into(), REDIRECT.into()]
                };
            })],
        );
        f.lang = lang.into();
        if lang == "ts" {
            f.path = f.path.replace(".py", ".ts");
        }
        files.push(f);
    }
    background(&mut files);
    files
}

fn before() -> Rule {
    Rule::Before {
        first: FLASH.into(),
        then: REDIRECT.into(),
    }
}

#[test]
fn python_call_order_is_not_proposed_but_typescripts_is() {
    assert!(
        !mined(&repo(ordered("py")))
            .iter()
            .any(|c| c.rule == before())
    );
    let ts = mined(&repo(ordered("ts")));
    pick(&ts, |c| c.rule == before());
}

#[test]
fn python_os_environ_avoidance_is_not_proposed() {
    let mut files = Vec::new();
    for i in 0..60 {
        files.push(py(
            &format!("app/core/c{i}.py"),
            vec![sym(&format!("LIMIT_{i}"), SymbolKind::Const, |s| {
                if i == 0 {
                    s.reads.push("os.environ.LIMIT".into());
                }
            })],
        ));
    }
    for i in 0..60 {
        files.push(py(
            &format!("app/settings/s{i}.py"),
            vec![sym(&format!("KEY_{i}"), SymbolKind::Const, |s| {
                s.reads.push("os.environ.KEY".into())
            })],
        ));
    }
    background(&mut files);
    let cs = mined(&repo(files));
    assert!(
        !cs.iter().any(|c| matches!(
            &c.rule,
            Rule::Avoids { signal } if signal == "os_environ"
        )),
        "{:?}",
        cs.iter()
            .map(|c| (c.role.describe(), c.rule.describe()))
            .collect::<Vec<_>>()
    );
}
