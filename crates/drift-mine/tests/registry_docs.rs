//! F7 and F8 (rubric v3 error analysis, classes G and the documented exception): a
//! class that leaves a registration decorator off because another class already
//! registers its key, and a class whose docstring says it is not what the rule asks.
//! Each test plants the shape next to true outliers of the same rule, and checks
//! mining (`exempt[]` with a reason), `drift check` and the hooks' full-scan decision.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};

fn class(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind: SymbolKind::Class,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    s
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

/// The facts of `files` among 100 plain classes elsewhere (the repo-wide baseline a
/// rule's lift is measured against).
fn repo(mut files: Vec<FileFacts>) -> RepoFacts {
    for i in 0..100 {
        files.push(py(
            &format!("other/c{i}.py"),
            vec![class(&format!("C{i}"), |_| {})],
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

fn find<'c>(cs: &'c [Candidate], rule: &Rule) -> &'c Candidate {
    cs.iter().find(|c| &c.rule == rule).unwrap_or_else(|| {
        panic!(
            "{rule:?} not mined: {:?}",
            cs.iter()
                .map(|c| (c.role.describe(), c.rule.describe()))
                .collect::<Vec<_>>()
        )
    })
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

const REGISTER: &str = "app/utils/filtersets.py#register_filterset";

fn decorated_by(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![target.into()],
    }
}

fn model(i: usize) -> String {
    format!("app/m{i}/models.py#M{i}")
}

/// 60 apps, each with a filterset registered by `@register_filterset` under its
/// `Meta.model`, plus:
/// - `M1ConnectionFilterSet` and `M2ConnectionFilterSet` (in app m0), secondary
///   filtersets of models m1 and m2 that the primary ones already register;
/// - `OrphanFilterSet`, whose model nobody registers, and `NoMetaFilterSet`, with no
///   `Meta`: both forgot the decorator;
/// - `BaseThingFilterSet`, an abstract base (`Meta.abstract = True`).
fn filtersets() -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..60 {
        let mut symbols = vec![class(&format!("M{i}FilterSet"), |s| {
            s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
            s.meta.push(format!("model={}", model(i)));
        })];
        if i == 0 {
            for m in [1, 2] {
                symbols.push(class(&format!("M{m}ConnectionFilterSet"), |s| {
                    s.meta.push(format!("model={}", model(m)));
                }));
            }
            symbols.push(class("OrphanFilterSet", |s| {
                s.meta.push("model=app/m99/models.py#Orphan".into());
            }));
            symbols.push(class("NoMetaFilterSet", |_| {}));
            symbols.push(class("BaseThingFilterSet", |s| {
                s.meta.push("abstract".into());
                // What lowering adds for `Meta.abstract = True`.
                s.traits.push("abstract".into());
            }));
        }
        files.push(py(&format!("app/m{i}/filtersets.py"), symbols));
    }
    files
}

#[test]
fn a_class_whose_registry_key_is_taken_is_no_outlier_of_the_registration_rule() {
    let files = filtersets();
    let r = repo(files.clone());
    let cs = mined(&r);
    let c = find(&cs, &decorated_by(REGISTER));
    assert_eq!(outliers(c), ["NoMetaFilterSet", "OrphanFilterSet"]);
    assert_eq!(
        exempt(c),
        [
            (
                "M1ConnectionFilterSet",
                "its model M1 is already registered with register_filterset() by M1FilterSet"
            ),
            (
                "M2ConnectionFilterSet",
                "its model M2 is already registered with register_filterset() by M2FilterSet"
            ),
        ]
    );
    // The abstract base is in no role: neither an outlier nor exempt.
    assert_eq!((c.evidence.total, c.evidence.role_members), (62, Some(64)));

    // `drift check` agrees with the census.
    let p = accept_all(&r, &cs);
    let id = c.id.clone();
    assert_eq!(
        violators_of(&r, &p, &id),
        ["NoMetaFilterSet", "OrphanFilterSet"]
    );

    // A hook's single-file scan of the file holding the connection filtersets has 1
    // of the 60 registered filtersets: whether M1 is taken is undecided, so it asks
    // for a full scan; the full scan decides it.
    let alone = repo(vec![files[0].clone()]);
    assert!(needs_full_scan(&alone, &p));
    assert!(!needs_full_scan(&r, &p));
    // A new filterset that carries the decorator decides nothing either way.
    let new = repo(vec![py(
        "app/m40/filtersets.py",
        vec![class("M40FilterSet", |s| {
            s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
            s.meta.push("model=app/m40/models.py#M40".into());
        })],
    )]);
    assert!(!needs_full_scan(&new, &p));
    // Nor does a class with no `Meta.model`: it has no key to be taken.
    let no_key = repo(vec![py(
        "app/m41/filtersets.py",
        vec![class("PlainFilterSet", |_| {})],
    )]);
    assert!(!needs_full_scan(&no_key, &p));
}

#[test]
fn a_registry_that_shares_keys_or_has_none_exempts_nobody() {
    // Two registered filtersets share a model: the decorator's registry is not keyed by
    // model, so a third class of that model forgot the decorator like any other.
    let mut shared = filtersets();
    shared[3].symbols[0].meta = vec![format!("model={}", model(4))];
    let r = repo(shared);
    let cs = mined(&r);
    let c = find(&cs, &decorated_by(REGISTER));
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(
        outliers(c),
        [
            "M1ConnectionFilterSet",
            "M2ConnectionFilterSet",
            "NoMetaFilterSet",
            "OrphanFilterSet"
        ]
    );

    // Most registered classes have no key: no keyed registry either.
    let mut unkeyed = filtersets();
    for f in unkeyed.iter_mut().skip(5) {
        f.symbols[0].meta.clear();
    }
    let r = repo(unkeyed);
    let cs = mined(&r);
    let c = find(&cs, &decorated_by(REGISTER));
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
}

#[test]
fn a_decorator_argument_is_the_registry_key() {
    // `@register_type(M{i})`: the registry is keyed by the decorator's argument. A
    // second type of model M1 with that model in its own `Meta` is no outlier; one of an
    // unregistered model is.
    let register_type = "app/graphql/types.py#register_type";
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![class(&format!("M{i}Type"), |s| {
            s.wraps.push(wrap(register_type, WrapKind::Decorator));
            s.decorator_args
                .push(format!("{register_type}={}", model(i)));
        })];
        if i == 0 {
            symbols.push(class("M1SummaryType", |s| {
                s.meta.push(format!("model={}", model(1)));
            }));
            symbols.push(class("M99Type", |s| {
                s.meta.push("model=app/m99/models.py#M99".into());
            }));
        }
        files.push(py(&format!("app/m{i}/types.py"), symbols));
    }
    let cs = mined(&repo(files));
    let c = find(&cs, &decorated_by(register_type));
    assert_eq!(outliers(c), ["M99Type"]);
    assert_eq!(
        exempt(c),
        [(
            "M1SummaryType",
            "its model M1 is already registered with register_type() by M1Type"
        )]
    );
}

const CHOICE_SET: &str = "app/utils/choices.py#ChoiceSet";

#[test]
fn a_documented_exception_is_no_outlier_and_a_mention_is_not_one() {
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![class(&format!("M{i}Choices"), |s| {
            s.wraps.push(wrap(CHOICE_SET, WrapKind::Extends));
        })];
        if i == 0 {
            // `"""... Not a ChoiceSet: ..."""` (what lowering records).
            symbols.push(class("ActionChoices", |s| {
                s.disclaims.push("ChoiceSet=Not a ChoiceSet".into());
            }));
            // `"""A ChoiceSet of colours."""` records nothing: an outlier.
            symbols.push(class("ColourChoices", |_| {}));
            // A disclaimer of another name does not exempt it from this rule.
            symbols.push(class("IconChoices", |s| {
                s.disclaims.push("Enum=not an Enum".into());
            }));
        }
        files.push(py(&format!("app/m{i}/choices.py"), symbols));
    }
    let r = repo(files.clone());
    let cs = mined(&r);
    let rule = Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![CHOICE_SET.into()],
    };
    let c = find(&cs, &rule);
    assert_eq!(outliers(c), ["ColourChoices", "IconChoices"]);
    assert_eq!(
        exempt(c),
        [("ActionChoices", "documented exception: \"Not a ChoiceSet\"")]
    );
    let p = accept_all(&r, &cs);
    let id = c.id.clone();
    assert_eq!(violators_of(&r, &p, &id), ["ColourChoices", "IconChoices"]);
    // The docstring is the class's own fact: a single-file check decides it alone.
    let alone = repo(vec![files[0].clone()]);
    assert_eq!(
        violators_of(&alone, &p, &id),
        ["ColourChoices", "IconChoices"]
    );
    // A class that follows the rule and says something odd in its docstring still
    // holds it: the disclaimer only exempts members that do not follow the rule.
    let mut odd = files.clone();
    odd[1].symbols[0]
        .disclaims
        .push("ChoiceSet=Not a ChoiceSet".into());
    let cs = mined(&repo(odd));
    let c = find(&cs, &rule);
    assert_eq!(c.evidence.holders, 30);
}

#[test]
fn registry_and_docstring_exemptions_are_deterministic() {
    let a = mined(&repo(filtersets()));
    let mut rev = filtersets();
    rev.reverse();
    for f in &mut rev {
        f.symbols.reverse();
    }
    let b = mined(&repo(rev));
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

// ---------------------------------------------------------------------------
// Review of #53: where a documented exception may not apply, and a registry the
// single-file facts cannot judge.

use drift_core::EntryPoint;
use drift_mine::context::RepoContext;
use drift_mine::roles::{View, units};

/// Why `rule` exempts `name` in `r`, if it does.
fn exemption(r: &RepoFacts, rule: &Rule, name: &str) -> Option<String> {
    let all = units(r, &Default::default());
    let ctx = RepoContext::new(r, &all);
    let (f, s) = r
        .files
        .iter()
        .flat_map(|f| f.symbols.iter().map(move |s| (f, s)))
        .find(|(_, s)| s.name == name)
        .expect("symbol");
    rule.exemption(&View::Symbol(f, s), &ctx).map(|e| e.reason)
}

fn one_class(path: &str, edit: impl FnOnce(&mut Symbol)) -> RepoFacts {
    repo(vec![py(path, vec![class("Odd", edit)])])
}

#[test]
fn a_documented_exception_needs_the_one_exact_target_of_a_base_class_rule() {
    let extends = |targets: &[&str]| Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: targets.iter().map(|t| t.to_string()).collect(),
    };
    let r = one_class("app/m0/choices.py", |s| {
        s.disclaims.push("ChoiceSet=Not a ChoiceSet".into());
    });
    assert_eq!(
        exemption(&r, &extends(&[CHOICE_SET]), "Odd").as_deref(),
        Some("documented exception: \"Not a ChoiceSet\"")
    );
    // One disclaimed alternative says nothing about the others.
    assert_eq!(
        exemption(
            &r,
            &extends(&[CHOICE_SET, "app/utils/enums.py#Enum"]),
            "Odd"
        ),
        None
    );
    // The whole name: a qualified spelling of the target counts, another module's
    // class of the same last name, or a shorter name, does not.
    let named = |written: &str, target: &str| {
        let r = one_class("app/m0/choices.py", |s| {
            s.disclaims.push(format!("{written}=not a {written}"));
        });
        exemption(&r, &extends(&[target]), "Odd").is_some()
    };
    assert!(named("choices.ChoiceSet", CHOICE_SET));
    assert!(named("utils.choices.ChoiceSet", CHOICE_SET));
    assert!(!named("other.ChoiceSet", CHOICE_SET));
    assert!(!named("Set", CHOICE_SET));
    assert!(named("db.models.Model", "pkg:django#db.models.Model"));
    assert!(!named("models.Model", "pkg:django#db.models.Model"));
    assert!(!named("Model", "pkg:django#db.models.Model"));
}

// The access-control vocabulary (`vocab::refuse`) reads every segment of a target's
// name: a base under an access-control namespace is a guard's base, and no docstring
// exempts from it, as no docstring exempts from `LoginRequiredMixin`.
#[test]
fn a_documented_exception_never_exempts_from_a_base_named_for_access_control() {
    let disclaimed = |target: &str| {
        let written = target.rsplit_once('#').unwrap().1;
        let r = one_class("app/m0/views.py", |s| {
            s.disclaims.push(format!("{written}=not a {written}"));
        });
        let rule = Rule::WrappedBy {
            kind: WrapKind::Extends,
            any_of: vec![target.into()],
        };
        exemption(&r, &rule, "Odd").is_some()
    };
    assert!(disclaimed("pkg:acme#util.Base"));
    assert!(!disclaimed("pkg:acme#auth.Base"));
    assert!(!disclaimed("pkg:acme#LoginRequiredMixin"));
}

#[test]
fn a_docstring_never_exempts_from_a_call_decorator_or_guard_rule() {
    // polar D-31bf00's shape: "endpoints take an auth dependency". An unauthenticated
    // handler that "does not use get_db_session" is an outlier.
    let call = Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![
            "server/auth.py#Authenticator".into(),
            "server/postgres.py#get_db_session".into(),
        ],
    };
    let mut handler = py(
        "server/m0/endpoints.py",
        vec![Symbol {
            name: "export".into(),
            kind: SymbolKind::Function,
            disclaims: vec!["get_db_session=does not use get_db_session".into()],
            ..Default::default()
        }],
    );
    handler.entry_points.push(EntryPoint {
        symbol: "export".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/export".into()),
        adapter: "fastapi".into(),
    });
    let r = repo(vec![handler]);
    assert_eq!(exemption(&r, &call, "export"), None);
    // A decorator rule on functions (`@admins_only` views) is no base-class rule.
    let admins_only = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec!["app/auth.py#admins_only".into()],
    };
    let r = repo(vec![py(
        "app/views/export.py",
        vec![Symbol {
            name: "admin_export_users".into(),
            kind: SymbolKind::Function,
            disclaims: vec!["admins_only=Not an admins_only".into()],
            ..Default::default()
        }],
    )]);
    assert_eq!(exemption(&r, &admins_only, "admin_export_users"), None);
    // Nor a class decorator rule.
    let r = one_class("app/views/export.py", |s| {
        s.disclaims.push("admins_only=Not an admins_only".into());
    });
    assert_eq!(exemption(&r, &admins_only, "Odd"), None);
    // A base class that guards: named for access control, or extended by the
    // classes behind entry points.
    let guard = "app/auth.py#AdminRequiredView";
    let r = one_class("app/views/export.py", |s| {
        s.disclaims
            .push("AdminRequiredView=Not an AdminRequiredView".into());
    });
    let extends = |t: &str| Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![t.into()],
    };
    assert_eq!(exemption(&r, &extends(guard), "Odd"), None);
    let gate = "app/kit.py#Gate";
    let mut view = py(
        "app/views/report.py",
        vec![Symbol {
            name: "Report.get".into(),
            kind: SymbolKind::Function,
            wraps: vec![wrap(gate, WrapKind::Extends)],
            ..Default::default()
        }],
    );
    view.entry_points.push(EntryPoint {
        symbol: "Report.get".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/report".into()),
        adapter: "django".into(),
    });
    let disclaiming = py(
        "app/views/export.py",
        vec![class("Odd", |s| s.disclaims.push("Gate=Not a Gate".into()))],
    );
    let r = repo(vec![view.clone(), disclaiming.clone()]);
    assert_eq!(exemption(&r, &extends(gate), "Odd"), None);
    // Without the entry point that uses it, `Gate` is an ordinary base.
    let r = repo(vec![disclaiming]);
    assert!(exemption(&r, &extends(gate), "Odd").is_some());
}

#[test]
fn a_registry_the_single_file_facts_cannot_judge_needs_a_full_scan() {
    // Review repro: the repo's registry is not keyed (M1 is registered twice). A new
    // file holds two registered filtersets (A, B) and an unregistered one of model A.
    // Its own facts look like a keyed registry, so the single-file scan must not
    // decide: it asks for a full scan, which reports `AOtherFilterSet`.
    let mut files = filtersets();
    files[2].symbols[0].meta = vec![format!("model={}", model(1))];
    let r = repo(files.clone());
    let cs = mined(&r);
    let p = accept_all(&r, &cs);
    let id = find(&cs, &decorated_by(REGISTER)).id.clone();
    let new = py(
        "app/new/filtersets.py",
        vec![
            class("AFilterSet", |s| {
                s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
                s.meta.push("model=app/new/models.py#A".into());
            }),
            class("BFilterSet", |s| {
                s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
                s.meta.push("model=app/new/models.py#B".into());
            }),
            class("AOtherFilterSet", |s| {
                s.meta.push("model=app/new/models.py#A".into());
            }),
        ],
    );
    let alone = repo(vec![new.clone()]);
    assert!(needs_full_scan(&alone, &p));
    files.push(new);
    let full = repo(files);
    assert!(!needs_full_scan(&full, &p));
    assert!(violators_of(&full, &p, &id).contains(&"AOtherFilterSet".to_string()));
}

#[test]
fn registrations_count_production_code_only() {
    // A registered example class does not make its model's key taken.
    let mut files = filtersets();
    files.push(py(
        "examples/demo/filtersets.py",
        vec![class("DemoFilterSet", |s| {
            s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
            s.meta.push("model=app/m99/models.py#Orphan".into());
        })],
    ));
    let r = repo(files);
    let c = find(&mined(&r), &decorated_by(REGISTER)).clone();
    assert!(outliers(&c).contains(&"OrphanFilterSet"), "{:?}", c.exempt);
}

// F7 goes through #45's gate (`Rule::exemption_allowed`): a registration decorator that
// also decorates an entry point is a guard as `drift security` reads guards, and no
// member is exempt from a guard rule, so the secondary filtersets whose model is taken
// are outliers again. (F7 has no guard check of its own; F8's guard-shape check
// overlaps the gate, so this is the case only the gate decides.)
#[test]
fn a_taken_registry_key_exempts_nobody_from_a_guard_decorator() {
    let mut files = filtersets();
    let mut view = py(
        "app/api/views.py",
        vec![Symbol {
            name: "export_things".into(),
            kind: SymbolKind::Function,
            exported_as: vec!["export_things".into()],
            line: 3,
            wraps: vec![wrap(REGISTER, WrapKind::Decorator)],
            ..Default::default()
        }],
    );
    view.entry_points.push(drift_core::EntryPoint {
        symbol: "export_things".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/things/export".into()),
        adapter: "flask".into(),
    });
    files.push(view);
    let r = repo(files);
    let cs = mined(&r);
    let c = find(&cs, &decorated_by(REGISTER));
    assert!(exempt(c).is_empty(), "{:?}", exempt(c));
    assert_eq!(
        outliers(c),
        [
            "M1ConnectionFilterSet",
            "M2ConnectionFilterSet",
            "NoMetaFilterSet",
            "OrphanFilterSet"
        ]
    );
    let p = accept_all(&r, &cs);
    assert_eq!(
        violators_of(&r, &p, &c.id),
        [
            "M1ConnectionFilterSet",
            "M2ConnectionFilterSet",
            "NoMetaFilterSet",
            "OrphanFilterSet"
        ]
    );
}
