//! A rule flags only members that could comply with it. Members it cannot apply to are
//! neither holders nor outliers, but exempt with a code:
//!
//! - `plain_value`: under a naming rule whose followers are values a schema library
//!   builds, a plain value (literals or built-ins only) is not a schema to rename;
//! - `type_only`: "has a test file" is not about a module of types only;
//! - `no_counterpart`: "pass `filters` to `register_type()`" is not about a class whose
//!   subject has no class of the kind every follower passes.
//!
//! Naming rules set a release-stage prefix aside, and compare a name written in another
//! case style (upper snake case) without case
//! ([`name_matches`]): `HARNESS_V1_TOOLS` and `experimental_harnessX` follow `harness*`.
//!
//! The fixtures are generic schemas, helpers and registries, not any dev repository's code.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind, traits};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine, name_matches};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, units};

const PKG: &str = "web";

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

fn trait_(t: &str) -> impl FnOnce(&mut Symbol) {
    let t = t.to_string();
    move |s: &mut Symbol| s.traits.push(t)
}

fn file(path: &str, lang: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: PKG.into(),
        lang: lang.into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

/// Values, functions and classes of another package, so the rules have lift.
fn filler(files: &mut Vec<FileFacts>) {
    for i in 0..60 {
        let mut f = file(
            &format!("api/src/util/u{i}.ts"),
            "ts",
            vec![
                sym(&format!("util{i}"), SymbolKind::Function, |_| {}),
                sym(&format!("Thing{i}"), SymbolKind::Class, |_| {}),
                sym(&format!("value{i}"), SymbolKind::Const, |_| {}),
            ],
        );
        f.package = "api".into();
        files.push(f);
    }
}

fn normalized(mut files: Vec<FileFacts>) -> RepoFacts {
    filler(&mut files);
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

fn candidate<'a>(cs: &'a [Candidate], rule: &Rule) -> &'a Candidate {
    cs.iter()
        .find(|c| &c.rule == rule && c.role.package == PKG)
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (c.role.describe(), c.rule.describe()))
                    .collect::<Vec<_>>()
            )
        })
}

/// A name part of letters only for `i` (`Aa`, `Ab`, ...): a lowercase prefix stops at a digit.
fn alpha(i: usize) -> String {
    format!(
        "{}{}",
        (b'A' + (i / 26) as u8) as char,
        (b'a' + (i % 26) as u8) as char
    )
}

fn named(p: &str) -> Rule {
    Rule::Named { pattern: p.into() }
}

fn outliers(c: &Candidate) -> Vec<&str> {
    let mut v: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    v.sort();
    v
}

fn exempt(c: &Candidate, code: &str) -> Vec<String> {
    let mut v: Vec<String> = c
        .exempt
        .iter()
        .filter(|e| e.code == code)
        .map(|e| format!("{}: {}", e.symbol, e.reason))
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

#[test]
fn names_compare_without_release_stage_or_another_case_style() {
    for (name, pattern) in [
        ("harnessSchema", "*Schema"),
        ("HARNESS_TOOL_SCHEMA", "*Schema"),
        ("user_schema", "*Schema"),
        ("experimental_useChat", "use*"),
        ("unstable_cacheTag", "cache*"),
        ("EXPERIMENTAL_useChat", "use*"),
        ("_internalHelper", "internal*"),
        ("__harnessThing", "harness*"),
        ("EnvironmentsControllerV1", "*Controller"),
        ("toolRegistryV2", "*Registry"),
        ("HARNESS_V1_BUILTIN_TOOLS", "harness*"),
    ] {
        assert!(name_matches(name, pattern), "{name} {pattern}");
    }
    for (name, pattern) in [
        // One word follows no pattern, as before.
        ("Schema", "*Schema"),
        ("useChat", "*Chat2"),
        ("schemaOf", "*Schema"),
        ("user", "use*"),
        ("userSchema", "use*"),
        ("statusSchemaMap", "*Schema"),
        ("experimental", "experimental*"),
        // A camel or Pascal name could be written the team's way: compared as written.
        ("MemberInviteDTO", "*Dto"),
        ("ExternalErrorCodes", "*Code"),
        ("commandSchemas", "*Schema"),
        ("allCategories", "*Category"),
        // No plural in another case style either.
        ("HARNESS_TOOL_SCHEMAS", "*Schema"),
    ] {
        assert!(!name_matches(name, pattern), "{name} {pattern}");
    }
}

/// 40 schema files under `web/src/schemas/`, each `s{i}Schema` (a schema value), and:
///
/// - `s0.ts`: `GenericResponse`, a literal value (plain);
/// - `s1.ts`: `nameRules`, a schema value not named for it (an outlier);
/// - `s2.ts`: `commandSchemas`, an array of schemas (plain; the plural is no follower);
/// - `s3.ts`: `TOOL_NAMES`, plain data from a built-in, in a file of its own.
///
/// `edit` changes the files before they are normalised.
fn schemas(edit: impl FnOnce(&mut Vec<FileFacts>)) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        let mut syms = vec![sym(
            &format!("s{i}Schema"),
            SymbolKind::Const,
            trait_(traits::SCHEMA_VALUE),
        )];
        match i {
            0 => syms.push(sym(
                "GenericResponse",
                SymbolKind::Const,
                trait_(traits::PLAIN_VALUE),
            )),
            1 => syms.push(sym(
                "nameRules",
                SymbolKind::Const,
                trait_(traits::SCHEMA_VALUE),
            )),
            2 => syms.push(sym(
                "commandSchemas",
                SymbolKind::Const,
                trait_(traits::PLAIN_VALUE),
            )),
            _ => {}
        }
        files.push(file(&format!("web/src/schemas/s{i}.ts"), "ts", syms));
    }
    files.push(file(
        "web/src/schemas/names.ts",
        "ts",
        vec![sym(
            "toolNames",
            SymbolKind::Const,
            trait_(traits::PLAIN_VALUE),
        )],
    ));
    edit(&mut files);
    normalized(files)
}

#[test]
fn a_plain_value_is_not_an_outlier_of_a_naming_rule_over_schemas() {
    let r = schemas(|_| {});
    let cs = mined(&r);
    let c = candidate(&cs, &named("*Schema"));
    assert_eq!(outliers(c), ["nameRules"]);
    assert_eq!(
        exempt(c, "plain_value"),
        [
            "GenericResponse: a plain value (literals or built-ins only), not a schema like the members named `*Schema`",
            "commandSchemas: a plain value (literals or built-ins only), not a schema like the members named `*Schema`",
            "toolNames: a plain value (literals or built-ins only), not a schema like the members named `*Schema`",
        ]
    );
    assert_eq!(c.evidence.holders, 40);
    assert_eq!(c.evidence.total, 41);
    assert!(c.summary().contains("except 3 plain values (not a schema)"));
    // `check` reads the rule as mining does.
    assert_eq!(violators(&r, c), ["nameRules"]);
    // In facts of one file, whether the followers are schemas is undecided: a full scan.
    let p = policy(c);
    let mut one = r.clone();
    one.files.retain(|f| f.path == "web/src/schemas/s0.ts");
    assert!(needs_full_scan(&one, &p));
    let mut alone = r.clone();
    alone.files.retain(|f| f.path == "web/src/schemas/s5.ts");
    assert!(!needs_full_scan(&alone, &p));
    // The exemption itself is undecided there, decided in the full facts.
    let undecided = |facts: &RepoFacts| {
        let all = units(facts, &FileKinds::learn(facts));
        let ctx = RepoContext::new(facts, &all);
        let u = all
            .iter()
            .find(|u| u.name() == "GenericResponse")
            .expect("a unit");
        c.rule
            .exemption_undecided(Some(&c.role), &u.view, &ctx, c.evidence.holders)
    };
    assert!(undecided(&one));
    assert!(!undecided(&r));
}

#[test]
fn a_plain_follower_says_the_name_is_for_plain_values_too() {
    // `s4Schema` is a literal: the rule names plain values, so a plain one may follow it.
    let r = schemas(|files| {
        let f = files
            .iter_mut()
            .find(|f| f.path == "web/src/schemas/s4.ts")
            .unwrap();
        f.symbols[0].traits = vec![traits::PLAIN_VALUE.into()];
    });
    let c = candidate(&mined(&r), &named("*Schema")).clone();
    assert!(exempt(&c, "plain_value").is_empty());
    assert_eq!(
        outliers(&c),
        [
            "GenericResponse",
            "commandSchemas",
            "nameRules",
            "toolNames"
        ]
    );
}

#[test]
fn followers_that_are_not_mostly_schemas_exempt_no_plain_value() {
    // Most followers are made by the repo's own code (no trait): what they are is unknown.
    let r = schemas(|files| {
        for f in files.iter_mut() {
            for s in f.symbols.iter_mut() {
                if s.name.ends_with("Schema") && s.name != "s0Schema" && s.name != "s1Schema" {
                    s.traits.clear();
                }
            }
        }
    });
    let c = candidate(&mined(&r), &named("*Schema")).clone();
    assert!(exempt(&c, "plain_value").is_empty());
    assert_eq!(
        outliers(&c),
        [
            "GenericResponse",
            "commandSchemas",
            "nameRules",
            "toolNames"
        ]
    );
}

/// Values under `web/src/harness/`, each in a file of its own: `harness<Xy>Part` for 40,
/// and `experimental_harnessBeta`, `HARNESS_V1_TOOLS`, `_harnessPrivate` and
/// `otherThing`.
#[test]
fn a_naming_rule_reads_names_without_case_or_release_stage() {
    let mut files = Vec::new();
    for (i, name) in (0..40)
        .map(|i| format!("harness{}Part", alpha(i)))
        .chain(
            [
                "experimental_harnessBeta",
                "HARNESS_V1_TOOLS",
                "_harnessPrivate",
                "otherThing",
            ]
            .map(String::from),
        )
        .enumerate()
    {
        files.push(file(
            &format!("web/src/harness/h{i}.ts"),
            "ts",
            vec![sym(&name, SymbolKind::Const, |_| {})],
        ));
    }
    let r = normalized(files);
    let c = candidate(&mined(&r), &named("harness*")).clone();
    assert_eq!(outliers(&c), ["otherThing"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (43, 44));
    assert_eq!(violators(&r, &c), ["otherThing"]);
}

/// A rule whose last outlier only wrote the pattern in another case style stays
/// proposed, with no outlier: values under `web/src/codes/`, `c{i}Code` for 30 and
/// `EXTERNAL_CODE`. A Pascal name that wrote it otherwise (`ExternalCodes`,
/// `ExternalCODE`) could have followed it, and stays an outlier.
#[test]
fn a_rule_whose_outliers_only_wrote_it_another_way_stays_proposed() {
    let codes = |last: &str| {
        let mut files = Vec::new();
        for i in 0..30 {
            files.push(file(
                &format!("web/src/codes/c{i}.ts"),
                "ts",
                vec![sym(&format!("c{i}Code"), SymbolKind::Const, |_| {})],
            ));
        }
        files.push(file(
            "web/src/codes/external.ts",
            "ts",
            vec![sym(last, SymbolKind::Const, |_| {})],
        ));
        normalized(files)
    };
    let r = codes("EXTERNAL_CODE");
    let c = candidate(&mined(&r), &named("*Code")).clone();
    assert!(c.outliers.is_empty());
    assert_eq!((c.evidence.holders, c.evidence.total), (31, 31));
    assert!(violators(&r, &c).is_empty());
    for last in ["ExternalCodes", "ExternalCODE"] {
        let c = candidate(&mined(&codes(last)), &named("*Code")).clone();
        assert_eq!(outliers(&c), [last]);
    }
    // A rule every member writes the same way is still no candidate.
    assert!(
        !mined(&codes("externalCode"))
            .iter()
            .any(|c| c.rule == named("*Code") && c.role.package == PKG)
    );
}

/// 30 modules under `web/src/lib/` with a test, `types.ts` (types only, no test) and
/// `logic.ts` (code, no test).
fn modules(types_tested: bool) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..30 {
        let mut f = file(
            &format!("web/src/lib/m{i}.ts"),
            "ts",
            vec![sym(&format!("helper{i}"), SymbolKind::Function, |_| {})],
        );
        f.has_test = true;
        files.push(f);
    }
    let mut types = file("web/src/lib/types.ts", "ts", vec![]);
    types.type_only = true;
    types.has_test = types_tested;
    files.push(types);
    files.push(file(
        "web/src/lib/logic.ts",
        "ts",
        vec![sym("compute", SymbolKind::Function, |_| {})],
    ));
    normalized(files)
}

#[test]
fn a_module_of_types_only_needs_no_test() {
    let r = modules(false);
    let c = candidate(&mined(&r), &Rule::HasTest).clone();
    assert_eq!(
        exempt(&c, "type_only"),
        ["(file): declares types only: no code that runs to test"]
    );
    assert_eq!(
        c.outliers
            .iter()
            .map(|o| o.path.as_str())
            .collect::<Vec<_>>(),
        ["web/src/lib/logic.ts"]
    );
    assert!(
        c.summary()
            .contains("except a module of types (with no code to test)")
    );
    let report = check(&r, &policy(&c), &Lock::default(), Scope::Accepted, None);
    assert_eq!(
        report
            .violations
            .iter()
            .map(|v| v.path.as_str())
            .collect::<Vec<_>>(),
        ["web/src/lib/logic.ts"]
    );
    // A module of types that has a test follows the rule: a holder, not exempt.
    let tested = modules(true);
    let c = candidate(&mined(&tested), &Rule::HasTest).clone();
    assert!(exempt(&c, "type_only").is_empty());
    assert_eq!(c.evidence.holders, 31);
}

const REGISTER: &str = "app/core/registry.py#register_type";

/// Python GraphQL types in `app/<m>/graphql/types.py` for 30 models, each
/// `@register_type(models.<M>, filters=<M>Filter)`, with `<M>Filter` defined in
/// `app/<m>/graphql/filters.py`; and `ContentType`, registered for a package model with
/// no `filters`. `edit` changes the files before they are normalised.
fn registry(edit: impl FnOnce(&mut Vec<FileFacts>)) -> RepoFacts {
    let models: Vec<String> = (0..30).map(|i| format!("Kind{i}")).collect();
    let mut files = vec![file(
        "app/core/registry.py",
        "py",
        vec![sym("register_type", SymbolKind::Function, |_| {})],
    )];
    let registered = |name: &str, subject: &str, filters: bool| {
        sym(name, SymbolKind::Class, |s| {
            s.wraps.push(Wrap {
                wrapper: REGISTER.into(),
                kind: WrapKind::Decorator,
            });
            s.calls.push(REGISTER.into());
            s.args.push(format!("{REGISTER}@99:fields"));
            if filters {
                s.args.push(format!("{REGISTER}@99:filters"));
            }
            s.decorator_args.push(format!("{REGISTER}={subject}"));
        })
    };
    for m in &models {
        let app = m.to_ascii_lowercase();
        files.push(file(
            &format!("app/{app}/graphql/types.py"),
            "py",
            vec![registered(
                &format!("{m}Type"),
                &format!("app/{app}/models.py#{m}"),
                true,
            )],
        ));
        files.push(file(
            &format!("app/{app}/graphql/filters.py"),
            "py",
            vec![sym(&format!("{m}Filter"), SymbolKind::Class, |_| {})],
        ));
    }
    files.push(file(
        "app/contenttypes/graphql/types.py",
        "py",
        vec![registered(
            "ContentType",
            "pkg:django#contrib.contenttypes.models.ContentType",
            false,
        )],
    ));
    edit(&mut files);
    normalized(files)
}

fn passes_filters() -> Rule {
    Rule::PassesKey {
        callee: REGISTER.into(),
        index: 99,
        key: "filters".into(),
    }
}

#[test]
fn a_class_with_nothing_of_the_kind_to_pass_is_not_an_outlier() {
    let r = registry(|_| {});
    let c = candidate(&mined(&r), &passes_filters()).clone();
    assert!(c.outliers.is_empty(), "{:?}", c.outliers);
    assert_eq!(
        exempt(&c, "no_counterpart"),
        [
            "ContentType: no ContentTypeFilter exists to pass as `filters`, as each member passes the class named for what it registers"
        ]
    );
    assert!(violators(&r, &c).is_empty());
}

#[test]
fn a_class_whose_counterpart_exists_could_pass_it() {
    // A `ContentTypeFilter` exists somewhere: the member could pass it, so it is flagged.
    let r = registry(|files| {
        files.push(file(
            "app/core/graphql/filters.py",
            "py",
            vec![sym("ContentTypeFilter", SymbolKind::Class, |_| {})],
        ));
    });
    let c = candidate(&mined(&r), &passes_filters()).clone();
    assert!(exempt(&c, "no_counterpart").is_empty());
    assert_eq!(outliers(&c), ["ContentType"]);
}

#[test]
fn a_follower_without_a_counterpart_decides_nothing() {
    // One follower's filter is not named for its model: the name says nothing.
    let r = registry(|files| {
        for f in files.iter_mut() {
            for s in f.symbols.iter_mut() {
                if s.name == "Kind3Filter" {
                    s.name = "PlaceFilter".into();
                    s.exported_as = vec!["PlaceFilter".into()];
                }
            }
        }
    });
    let c = candidate(&mined(&r), &passes_filters()).clone();
    assert!(exempt(&c, "no_counterpart").is_empty());
    assert_eq!(outliers(&c), ["ContentType"]);
}
