//! Planted tests for rules beyond wrappers and calls: ordering, avoidance,
//! throws, tests, library preference, model fields and package config.

use drift_core::{FileFacts, Import, Model, PackageFacts, RepoFacts, Symbol, SymbolKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};

fn func(path: &str, name: &str, edit: impl FnOnce(&mut Symbol)) -> FileFacts {
    let mut s = Symbol {
        name: name.into(),
        kind: SymbolKind::Function,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![s],
        ..Default::default()
    }
}

fn file(path: &str, edit: impl FnOnce(&mut FileFacts)) -> FileFacts {
    let mut f = FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        ..Default::default()
    };
    edit(&mut f);
    f
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
    mine(r, &MineOptions { max_per_repo: 100 }).candidates
}

fn find(cs: &[Candidate], f: impl Fn(&Rule) -> bool) -> Option<&Candidate> {
    cs.iter().find(|c| f(&c.rule))
}

/// Accept every candidate and run check.
fn check_all(r: &RepoFacts) -> drift_mine::check::CheckReport {
    let m = mine(r, &MineOptions { max_per_repo: 100 });
    let mut p = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    check(r, &p, &Lock::default(), Scope::Accepted, None)
}

const AUTH: &str = "lib/auth.ts#requireUser";
const DB: &str = "lib/db.ts#db.query";

#[test]
fn ordering_is_learned_and_reversals_are_outliers() {
    let mut files = Vec::new();
    for i in 0..30 {
        let reversed = i >= 29;
        files.push(func(&format!("api/r{i}.ts"), "handler", |s| {
            s.calls = vec![AUTH.into(), DB.into()];
            s.order = if reversed {
                vec![DB.into(), AUTH.into()]
            } else {
                vec![AUTH.into(), DB.into()]
            };
        }));
    }
    let r = repo(files);
    let cs = mined(&r);
    let c = find(
        &cs,
        |r| matches!(r, Rule::Before { first, then } if first == AUTH && then == DB),
    )
    .expect("auth-before-db ordering");
    assert_eq!(c.outliers.len(), 1);
    assert_eq!(c.outliers[0].path, "api/r29.ts");
    assert!(
        find(
            &cs,
            |r| matches!(r, Rule::Before { first, .. } if first == DB)
        )
        .is_none(),
        "the reverse order is not a convention"
    );
}

#[test]
fn avoidance_needs_contrast_with_the_rest_of_the_code() {
    let mut files = Vec::new();
    for i in 0..20 {
        // ui/** almost never reads env (it uses the team's env module); lib/** often does.
        let mut ui = func(&format!("ui/c{i}.ts"), "view", |s| {
            if i == 0 {
                s.reads = vec!["process.env.SECRET".into()];
            }
        });
        if i != 0 {
            ui.imports.push(Import {
                module: "lib/env.ts".into(),
                names: vec!["env".into()],
                type_only: false,
                load: Default::default(),
            });
        }
        files.push(ui);
        files.push(func(&format!("lib/l{i}.ts"), "load", |s| {
            if i < 12 {
                s.reads = vec!["process.env.DATABASE_URL".into()];
            }
            // eval appears nowhere else, so avoiding it is not a learned convention.
        }));
    }
    // The env module the ui imports is the one place that reads process.env.
    files.push(func("lib/env.ts", "env", |s| {
        s.reads = vec!["process.env.DATABASE_URL".into()];
    }));
    let r = repo(files);
    let cs = mined(&r);
    let c = find(
        &cs,
        |r| matches!(r, Rule::Avoids { signal } if signal == "env"),
    )
    .expect("ui avoids env reads");
    assert_eq!(c.role.dir, "ui");
    assert_eq!(c.outliers[0].path, "ui/c0.ts");
    assert!(
        find(
            &cs,
            |r| matches!(r, Rule::Avoids { signal } if signal.starts_with("sink:"))
        )
        .is_none()
    );
}

#[test]
fn files_with_tests_and_thrown_classes() {
    let mut files = Vec::new();
    for i in 0..20 {
        let mut f = func(&format!("services/s{i}.ts"), &format!("getThing{i}"), |s| {
            if i != 3 {
                s.throws = vec!["lib/errors.ts#AppError".into()];
            }
        });
        f.has_test = i != 7;
        files.push(f);
        files.push(func(&format!("scripts/x{i}.ts"), "run", |_| {}));
    }
    let r = repo(files);
    let cs = mined(&r);
    let t = find(&cs, |r| *r == Rule::HasTest).expect("services have tests");
    assert_eq!(t.outliers[0].path, "services/s7.ts");
    assert_eq!(t.outliers[0].symbol, "(file)");
    let th = find(
        &cs,
        |r| matches!(r, Rule::Throws { class } if class.ends_with("#AppError")),
    )
    .expect("services throw AppError");
    assert_eq!(th.outliers[0].path, "services/s3.ts");
    assert!(th.rule.describe().contains("throw AppError"));
}

#[test]
fn one_library_per_slot() {
    let mut files = Vec::new();
    for i in 0..31 {
        let lib = if i == 30 { "pkg:dayjs" } else { "pkg:date-fns" };
        files.push(file(&format!("src/f{i}.ts"), |f| {
            f.imports = vec![Import {
                module: lib.into(),
                names: vec!["format".into()],
                type_only: false,
                load: Default::default(),
            }];
        }));
    }
    let r = repo(files);
    let cs = mined(&r);
    let c = find(
        &cs,
        |r| matches!(r, Rule::PrefersLibrary { preferred, .. } if preferred == "date-fns"),
    )
    .expect("date-fns preferred");
    assert_eq!(c.outliers[0].path, "src/f30.ts");
    assert!(
        c.rule
            .describe()
            .starts_with("use date-fns for dates, not dayjs")
    );
}

#[test]
fn model_fields_and_package_config() {
    let mut r = repo(vec![]);
    for i in 0..26 {
        r.models.push(Model {
            path: "prisma/schema.prisma".into(),
            name: format!("M{i}"),
            source: "prisma".into(),
            line: i + 1,
            fields: if i == 5 {
                vec!["id".into()]
            } else if i % 2 == 0 {
                vec!["createdAt".into(), "id".into()]
            } else {
                vec!["created_at".into(), "id".into()]
            },
        });
    }
    for i in 0..21 {
        r.packages.push(PackageFacts {
            path: format!("packages/p{i}"),
            name: format!("@x/p{i}"),
            scripts: if i == 2 { vec![] } else { vec!["lint".into()] },
            dependencies: vec![if i == 4 {
                "react@^18.2.0".into()
            } else {
                "react@^18.3.1".into()
            }],
            compiler_flags: vec![],
            manifest: String::new(),
            ..Default::default()
        });
    }
    // The workspace root is not a peer of its packages.
    r.packages.push(PackageFacts {
        name: "root".into(),
        ..Default::default()
    });
    r.normalize();
    let cs = mined(&r);
    let m = find(&cs, |r| matches!(r, Rule::ModelHas { .. })).expect("models have createdAt");
    assert_eq!(
        m.rule,
        Rule::ModelHas {
            field: "createdAt".into()
        }
    );
    assert_eq!(m.outliers[0].symbol, "M5");
    let p = find(
        &cs,
        |r| matches!(r, Rule::PackageHas { item } if item == "script:lint"),
    )
    .expect("packages define lint");
    assert_eq!(p.outliers[0].path, "packages/p2/package.json");
    let d = find(
        &cs,
        |r| matches!(r, Rule::DependencyVersion { name, range: None } if name == "react"),
    )
    .expect("react version agrees");
    assert_eq!(d.outliers[0].symbol, "@x/p4");
    // The agreed range is evidence, not part of the rule.
    assert_eq!(d.evidence.split[0], ("^18.3.1".to_string(), 20));

    // check reports the same outliers against model and package units.
    let report = check_all(&r);
    let paths: Vec<_> = report
        .violations
        .iter()
        .map(|v| format!("{}#{}", v.path, v.symbol))
        .collect();
    assert!(paths.contains(&"prisma/schema.prisma#M5".to_string()));
    assert!(paths.contains(&"packages/p2/package.json#@x/p2".to_string()));
    assert!(paths.contains(&"packages/p4/package.json#@x/p4".to_string()));
    assert!(!paths.iter().any(|p| p.starts_with("package.json")));
}

#[test]
fn check_covers_file_units_and_new_files() {
    let mut files = Vec::new();
    for i in 0..20 {
        let mut f = file(&format!("lib/l{i}.ts"), |_| {});
        f.has_test = i != 0;
        files.push(f);
        files.push(file(&format!("app/a{i}.ts"), |_| {}));
    }
    let r = repo(files);
    let report = check_all(&r);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.path == "lib/l0.ts" && v.symbol == "(file)")
    );
}

#[test]
fn every_rule_kind_round_trips_through_conventions_yaml() {
    use drift_mine::mine::Evidence;
    use drift_mine::roles::RoleSelector;
    let rules = vec![
        Rule::Throws {
            class: "lib/errors.ts#AppError".into(),
        },
        Rule::Named {
            pattern: "use*".into(),
        },
        Rule::Before {
            first: AUTH.into(),
            then: DB.into(),
        },
        Rule::Avoids {
            signal: "sink:raw_sql".into(),
        },
        Rule::HasTest,
        Rule::PrefersLibrary {
            group: "dates".into(),
            preferred: "date-fns".into(),
        },
        Rule::ModelHas {
            field: "createdAt".into(),
        },
        Rule::PackageHas {
            item: "script:lint".into(),
        },
        Rule::DependencyVersion {
            name: "react".into(),
            range: None,
        },
        Rule::DependencyVersion {
            name: "react".into(),
            range: Some("^18.3.1".into()),
        },
    ];
    let cands: Vec<Candidate> = rules
        .into_iter()
        .map(|rule| {
            let role = RoleSelector {
                package: String::new(),
                dir: "src".into(),
                file: "*".into(),
                entry: "-".into(),
                kind: SymbolKind::Function,
                variety: None,
                export_name: None,
                member_kind: None,
                shape: None,
                also: vec![],
            };
            Candidate {
                id: drift_mine::mine::convention_id(&role, &rule),
                role,
                rule,
                evidence: Evidence {
                    holders: 9,
                    total: 10,
                    lower_bound: 0.8,
                    lift: 2.0,
                    split: vec![],
                    role_members: None,
                    python_members: None,
                },
                score: 1.0,
                example: "src/a.ts#a".into(),
                outliers: vec![],
                can_block: false,
                wiring: None,
                exempt: vec![],
                inherited: vec![],
                derived: vec![],
            }
        })
        .collect();
    let dir = std::env::temp_dir().join(format!("drift-rules-yaml-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &cands);
    // Accepted, so the show policy (`drift_mine::show`), which drops hidden proposals
    // when the file is read, keeps every kind.
    for c in &mut p.conventions {
        c.status = drift_mine::policy::Status::Accepted;
    }
    p.save(&dir).unwrap();
    let back = ConventionsFile::load(&dir).unwrap().unwrap();
    std::fs::remove_dir_all(&dir).ok();
    let mut want: Vec<Rule> = cands.iter().map(|c| c.rule.clone()).collect();
    let mut got: Vec<Rule> = back.conventions.iter().map(|c| c.rule.clone()).collect();
    want.sort();
    got.sort();
    assert_eq!(got, want);
}

fn importing(path: &str, modules: &[&str]) -> FileFacts {
    file(path, |f| {
        f.imports = modules
            .iter()
            .map(|m| Import {
                module: (*m).into(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect();
    })
}

#[test]
fn import_avoidance_is_only_proposed_against_upward_layers() {
    let mut files = Vec::new();
    // packages/app depends on packages/ui and packages/shared.
    for i in 0..40 {
        files.push(importing(
            &format!("packages/app/src/a{i}.ts"),
            &["packages/ui/src/button.ts", "packages/shared/src/util.ts"],
        ));
    }
    // packages/ui never imports packages/app except one file (a cycle), and rarely
    // imports packages/shared (a foundation; avoiding it is not a rule).
    for i in 0..60 {
        let mut m = vec![];
        if i == 0 {
            m.push("packages/app/src/a1.ts");
        }
        if i < 2 {
            m.push("packages/shared/src/util.ts");
        }
        files.push(importing(&format!("packages/ui/src/c{i}.ts"), &m));
    }
    let r = repo(files);
    let cs = mined(&r);
    let avoided: Vec<&str> = cs
        .iter()
        .filter_map(|c| match &c.rule {
            Rule::Avoids { signal } => Some(signal.as_str()),
            _ => None,
        })
        .collect();
    assert!(avoided.contains(&"import:packages/app"), "{avoided:?}");
    assert!(!avoided.contains(&"import:packages/shared"), "{avoided:?}");
}

#[test]
fn package_subpaths_count_as_the_same_export() {
    use drift_mine::mine::norm_ref;
    assert_eq!(
        norm_ref("pkg:@nestjs/common/decorators#Controller"),
        "pkg:@nestjs/common#Controller"
    );
    assert_eq!(norm_ref("pkg:zod/v4#z"), "pkg:zod#z");
    assert_eq!(
        norm_ref("pkg:node:fs/promises#readFile"),
        "pkg:node:fs/promises#readFile"
    );
    assert_eq!(norm_ref("lib/auth.ts#withAuth"), "lib/auth.ts#withAuth");
    let rule = Rule::WrappedBy {
        kind: drift_core::WrapKind::Decorator,
        any_of: vec!["pkg:@nestjs/common#Controller".into()],
    };
    let f = func("a.controller.ts", "A", |s| {
        s.wraps.push(drift_core::Wrap {
            wrapper: "pkg:@nestjs/common/decorators#Controller".into(),
            kind: drift_core::WrapKind::Decorator,
        });
    });
    let ctx = drift_mine::context::RepoContext::default();
    assert!(rule.holds(&drift_mine::roles::View::Symbol(&f, &f.symbols[0]), &ctx));
}

#[test]
fn npm_and_python_packages_are_separate_roles() {
    // 21 npm packages, 20 with a `lint` script and a shared react version.
    let npm = || {
        let mut r = repo(vec![]);
        for i in 0..21 {
            r.packages.push(PackageFacts {
                path: format!("packages/p{i}"),
                name: format!("@x/p{i}"),
                scripts: if i == 2 { vec![] } else { vec!["lint".into()] },
                dependencies: vec!["react@^18.3.1".into()],
                ..Default::default()
            });
        }
        r
    };
    let mut mixed = npm();
    // Python projects declare neither npm scripts nor react, and use another range of
    // a dependency that also exists on npm.
    for i in 0..4 {
        mixed.packages.push(PackageFacts {
            path: format!("py/s{i}"),
            name: format!("s{i}"),
            dependencies: vec!["react@>=0.1".into()],
            manifest: format!("py/s{i}/pyproject.toml"),
            ..Default::default()
        });
    }
    let mut ts = npm();
    ts.normalize();
    mixed.normalize();
    let lint = |r: &RepoFacts| {
        let cs = mined(r);
        let c = find(
            &cs,
            |r| matches!(r, Rule::PackageHas { item } if item == "script:lint"),
        )
        .expect("packages define lint")
        .clone();
        (c.role.clone(), c.evidence.holders, c.evidence.total)
    };
    // Same role and evidence with or without the Python packages.
    assert_eq!(lint(&mixed), lint(&ts));
    assert_eq!(lint(&mixed).2, 21);
    // No npm convention is checked against a pyproject.
    let report = check_all(&mixed);
    let paths: Vec<_> = report.violations.iter().map(|v| v.path.as_str()).collect();
    assert!(paths.contains(&"packages/p2/package.json"), "{paths:?}");
    assert!(!paths.iter().any(|p| p.starts_with("py/")), "{paths:?}");
}
