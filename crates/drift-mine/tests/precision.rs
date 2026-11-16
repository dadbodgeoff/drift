//! Regression tests for the precision gaps (docs/v2/GAPS-2026-11-05.md): classes of
//! true-but-trivial or wrong proposals that reviewers rejected. Each test plants a
//! convention that must still be found next to one that must not be proposed.

use drift_core::{
    EntryPoint, FileFacts, Import, ImportLoad, LintConfig, LintRule, PackageFacts, RepoFacts,
    Symbol, SymbolKind, Wrap, WrapKind,
};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{
    Candidate, MineOptions, Rule, is_tautology, mine_unshown as mine, name_patterns,
};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, RoleSelector, units};

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

fn file_with(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: package.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn func(path: &str, name: &str, edit: impl FnOnce(&mut Symbol)) -> FileFacts {
    file_with(path, "", vec![sym(name, SymbolKind::Function, edit)])
}

fn import(module: &str) -> Import {
    Import {
        module: module.into(),
        names: vec!["x".into()],
        type_only: false,
        load: Default::default(),
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

fn has(cs: &[Candidate], f: impl Fn(&Candidate) -> bool) -> bool {
    cs.iter().any(f)
}

fn avoids(cs: &[Candidate], signal: &str) -> Vec<String> {
    cs.iter()
        .filter(|c| matches!(&c.rule, Rule::Avoids { signal: s } if s == signal))
        .map(|c| c.role.dir.clone())
        .collect()
}

fn lint(path: &str, rule: &str, level: &str) -> LintConfig {
    LintConfig {
        path: path.into(),
        tool: "oxlint".into(),
        inherits: false,
        rules: vec![LintRule {
            rule: rule.into(),
            level: level.into(),
            options: vec![],
        }],
        scoped: vec![],
    }
}

const AUTH: &str = "lib/auth.ts#withAuth";

/// 20 wrapped handlers (one outlier) under `dir`, in package `package`.
fn wrapped_handlers(dir: &str, package: &str) -> Vec<FileFacts> {
    (0..20)
        .map(|i| {
            file_with(
                // Distinct stems, so that no stem becomes a file kind of its own.
                &format!("{dir}/{}-{i}.ts", dir.replace('/', "-")),
                package,
                vec![sym("handler", SymbolKind::Function, |s| {
                    if i != 0 {
                        s.wraps.push(wrap(AUTH, WrapKind::Call));
                    }
                })],
            )
        })
        .collect()
}

// P2: example, sample, demo, playground and integration-test directories are not production.
#[test]
fn demo_and_integration_dirs_form_no_roles() {
    let mut files = wrapped_handlers("src/api", "");
    files.extend(wrapped_handlers(
        "examples/next-app/src",
        "examples/next-app",
    ));
    files.extend(wrapped_handlers("sample/01-cats/src", "sample/01-cats"));
    files.extend(wrapped_handlers("packages/sdk/playground", "packages/sdk"));
    files.extend(wrapped_handlers("integration/hello/src", ""));
    files.push(func("integration/hello/e2e/app.spec.ts", "t", |_| {}));
    // A route folder named `examples` deep inside an app is production code.
    files.extend(wrapped_handlers("apps/www/app/examples", "apps/www"));
    for i in 0..80 {
        files.push(func(&format!("lib/l{i}.ts"), "helper", |_| {}));
    }
    let m = mine(&repo(files.clone()), &MineOptions { max_per_repo: 200 });
    let cs = mined(&repo(files));
    eprintln!("DBG units {} roles {}", m.units, m.roles_considered);
    let wrapped: Vec<String> = cs
        .iter()
        .filter(|c| matches!(c.rule, Rule::WrappedBy { .. }))
        .map(|c| format!("{}:{}", c.role.package, c.role.dir))
        .collect();
    assert!(wrapped.contains(&":src".to_string()), "{wrapped:?}");
    assert!(
        wrapped.iter().any(|w| w.starts_with("apps/www:app")),
        "{wrapped:?}"
    );
    for w in &wrapped {
        assert!(
            !w.contains("examples/next-app")
                && !w.starts_with("sample")
                && !w.contains("playground")
                && !w.contains("integration"),
            "{w} is demo or test code"
        );
    }
}

// P3: what a framework mandates is never proposed.
#[test]
fn framework_mandated_facts_are_not_proposed() {
    let mut files = Vec::new();
    for i in 0..20 {
        files.push(file_with(
            &format!("src/s{i}.service.ts"),
            "",
            vec![sym(&format!("S{i}Service"), SymbolKind::Class, |s| {
                if i != 1 {
                    s.wraps
                        .push(wrap("pkg:@nestjs/common#Injectable", WrapKind::Decorator));
                }
                if i != 2 {
                    s.wraps
                        .push(wrap("src/audit.ts#Audited", WrapKind::Decorator));
                }
            })],
        ));
        files.push(file_with(
            &format!("other/o{i}.ts"),
            "",
            vec![sym(&format!("O{i}"), SymbolKind::Class, |_| {})],
        ));
        // Email templates render React Email primitives and the team's own footer.
        files.push(file_with(
            &format!("emails/e{i}.tsx"),
            "",
            vec![sym(&format!("E{i}"), SymbolKind::Component, |s| {
                if i != 3 {
                    s.wraps
                        .push(wrap("pkg:@react-email/components#Html", WrapKind::Jsx));
                    s.renders.push("pkg:@react-email/components#Text".into());
                }
                if i != 4 {
                    s.renders.push("emails/footer.tsx#Footer".into());
                }
            })],
        ));
        files.push(file_with(
            &format!("ui/c{i}.tsx"),
            "",
            vec![sym(&format!("C{i}"), SymbolKind::Component, |_| {})],
        ));
        // TanStack file routes.
        files.push(file_with(
            &format!("routes/r{i}.tsx"),
            "",
            vec![sym("Route", SymbolKind::Const, |s| {
                if i != 5 {
                    s.calls
                        .push("pkg:@tanstack/react-router#createFileRoute".into());
                }
            })],
        ));
        files.push(file_with(
            &format!("misc/m{i}.ts"),
            "",
            vec![sym("value", SymbolKind::Const, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let deco = |c: &Candidate, name: &str| matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Decorator, any_of } if any_of[0].ends_with(name));
    assert!(
        has(&cs, |c| deco(c, "#Audited")),
        "the team's own decorator"
    );
    assert!(!has(&cs, |c| deco(c, "#Injectable")));
    assert!(has(
        &cs,
        |c| matches!(&c.rule, Rule::Renders { component } if component.ends_with("#Footer"))
    ));
    // The document skeleton (`<Html>`) is mandated; content components are a choice.
    assert!(has(
        &cs,
        |c| matches!(&c.rule, Rule::Renders { component } if component.ends_with("#Text"))
    ));
    assert!(!has(&cs, |c| matches!(
        &c.rule,
        Rule::WrappedBy {
            kind: WrapKind::Jsx,
            ..
        }
    )));
    assert!(!has(
        &cs,
        |c| matches!(&c.rule, Rule::Calls { callee } if callee.ends_with("#createFileRoute"))
    ));
}

#[test]
fn hook_names_and_decorator_flags_are_mandated_only_where_the_framework_is_used() {
    let build = |framework: bool| {
        let mut files = Vec::new();
        for i in 0..20 {
            let mut f = func(
                &format!("src/hooks/h{i}.ts"),
                &format!("useThing{i}"),
                |_| {},
            );
            if i == 0 {
                f.symbols[0].name = "thingHelper".into();
                f.symbols[0].exported_as = vec!["thingHelper".into()];
            }
            if framework {
                f.imports.push(import("pkg:react"));
            }
            files.push(f);
            files.push(func(
                &format!("src/lib/l{i}.ts"),
                &format!("compute{i}"),
                |_| {},
            ));
        }
        let mut r = repo(files);
        for i in 0..20 {
            r.packages.push(PackageFacts {
                path: format!("packages/p{i}"),
                name: format!("@x/p{i}"),
                scripts: vec![],
                dependencies: if framework {
                    vec!["@nestjs/core@^11.0.0".into()]
                } else {
                    vec![]
                },
                compiler_flags: if i == 0 {
                    vec![]
                } else {
                    vec!["emitDecoratorMetadata".into(), "strict".into()]
                },
                manifest: String::new(),
                ..Default::default()
            });
        }
        r.normalize();
        mined(&r)
    };
    let named_use = |cs: &[Candidate]| {
        has(cs, |c| {
            c.rule
                == Rule::Named {
                    pattern: "use*".into(),
                }
        })
    };
    let flag = |cs: &[Candidate], f: &str| {
        has(cs, |c| {
            c.rule
                == Rule::PackageHas {
                    item: format!("flag:{f}"),
                }
        })
    };
    let with = build(true);
    assert!(!named_use(&with), "React requires hook names");
    assert!(
        !flag(&with, "emitDecoratorMetadata"),
        "Nest requires the flag"
    );
    assert!(flag(&with, "strict"), "a flag the team chose");
    let without = build(false);
    assert!(named_use(&without));
    assert!(flag(&without, "emitDecoratorMetadata"));
}

/// ui/** almost never has `signal_fact`; lib/** often does.
fn contrast_repo(edit: impl Fn(&mut Symbol, bool)) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..20 {
        files.push(func(&format!("ui/c{i}.ts"), "view", |s| edit(s, i == 0)));
        files.push(func(&format!("lib/l{i}.ts"), "load", |s| edit(s, i < 12)));
    }
    repo(files)
}

// A lint rule turned off for the code (`explicit-function-return-type: off`) says the
// team does not ask for return types there; `error` makes the rule trivial.
#[test]
fn lint_config_decides_return_type_rules() {
    // ui/** annotates every return but one; lib/** none.
    let base = contrast_repo(|s, on| {
        if s.name == "view" && !on {
            s.controls.push("typed_return".into());
        }
    });
    let typed = |r: &RepoFacts| {
        has(
            &mined(r),
            |c| matches!(&c.rule, Rule::Control { value } if value == "typed_return"),
        )
    };
    assert!(typed(&base), "no lint config: proposed");
    for (level, proposed) in [("error", false), ("off", false), ("warn", true)] {
        let mut r = base.clone();
        r.lint = vec![lint(
            ".oxlintrc.json",
            "explicit-function-return-type",
            level,
        )];
        assert_eq!(typed(&r), proposed, "{level}");
    }
    // A config for another part of the repo does not decide for ui/**.
    let mut r = base.clone();
    r.lint = vec![lint(
        "lib/.oxlintrc.json",
        "explicit-function-return-type",
        "off",
    )];
    assert!(typed(&r));
}

// P4: when the linter already enforces the rule (`error`), it is not proposed.
#[test]
fn lint_config_decides_absence_rules() {
    let base = contrast_repo(|s, on| {
        if on {
            s.controls.push("uses_any".into());
        }
    });
    assert_eq!(
        avoids(&mined(&base), "any"),
        ["ui"],
        "no lint config: proposed"
    );
    // An enforced rule makes it trivial, and `off` says the team allows `any` there:
    // neither is proposed. `warn` states the policy without enforcing it.
    for (level, proposed) in [("error", false), ("off", false), ("warn", true)] {
        let mut r = base.clone();
        r.lint = vec![lint(".oxlintrc.json", "no-explicit-any", level)];
        assert_eq!(!avoids(&mined(&r), "any").is_empty(), proposed, "{level}");
    }
    // A config for another part of the repo does not decide for ui/**.
    let mut r = base.clone();
    r.lint = vec![lint("lib/.oxlintrc.json", "no-explicit-any", "error")];
    assert_eq!(avoids(&mined(&r), "any"), ["ui"]);
}

// P5: avoiding console.* (or bare Error, or process.env) needs corroboration.
#[test]
fn absence_of_console_needs_a_lint_rule_or_a_team_logger() {
    let console = |logger: bool| {
        contrast_repo(move |s, on| {
            if on {
                s.calls.push("global#console.log".into());
            } else if logger {
                s.calls.push("lib/logger.ts#logger.info".into());
            }
        })
    };
    assert!(
        avoids(&mined(&console(false)), "console").is_empty(),
        "incidental"
    );
    assert_eq!(
        avoids(&mined(&console(true)), "console"),
        ["ui"],
        "siblings log via the team's logger"
    );
    let mut warned = console(false);
    warned.lint = vec![lint(".oxlintrc.json", "no-console", "warn")];
    assert_eq!(
        avoids(&mined(&warned), "console"),
        ["ui"],
        "the team's lint policy"
    );

    let throws = |class: bool| {
        contrast_repo(move |s, on| {
            if on {
                s.throws.push("global#Error".into());
            } else if class {
                s.throws.push("lib/errors.ts#AppError".into());
            }
        })
    };
    assert!(avoids(&mined(&throws(false)), "throw_error").is_empty());
    assert_eq!(avoids(&mined(&throws(true)), "throw_error"), ["ui"]);

    // process.env: corroborated by importing the team's env module (a file named
    // for env/config that reads process.env), not by any import named `*Config`.
    let env = |module: &str, name: &str| {
        let mut r = contrast_repo(|s, on| {
            if on {
                s.reads.push("process.env.SECRET".into());
            }
        });
        for f in r.files.iter_mut().filter(|f| f.path.starts_with("ui/")) {
            f.imports.push(Import {
                module: module.into(),
                names: vec![name.into()],
                type_only: false,
                load: Default::default(),
            });
        }
        r.files.push(func("lib/env.ts", "env", |s| {
            s.reads.push("process.env.DATABASE_URL".into());
        }));
        r.files
            .push(func("lib/site-config.ts", "siteConfig", |_| {}));
        r.normalize();
        avoids(&mined(&r), "env")
    };
    assert_eq!(env("lib/env.ts", "env"), ["ui"]);
    assert!(env("lib/site-config.ts", "siteConfig").is_empty());
}

// P6: layering follows the declared dependency graph.
#[test]
fn a_declared_dependency_is_not_a_layering_violation() {
    let build = |declared: bool| {
        let mut files = Vec::new();
        for i in 0..40 {
            let mut f = file_with(&format!("packages/app/src/a{i}.ts"), "packages/app", vec![]);
            f.imports.push(import("packages/ui/src/button.ts"));
            files.push(f);
        }
        for i in 0..60 {
            let mut f = file_with(&format!("packages/ui/src/c{i}.ts"), "packages/ui", vec![]);
            if i == 0 {
                f.imports.push(import("packages/app/src/a1.ts"));
            }
            files.push(f);
        }
        let mut r = repo(files);
        r.packages = vec![
            PackageFacts {
                path: "packages/app".into(),
                name: "@x/app".into(),
                dependencies: vec!["@x/ui@workspace:*".into()],
                ..Default::default()
            },
            PackageFacts {
                path: "packages/ui".into(),
                name: "@x/ui".into(),
                dependencies: if declared {
                    vec!["@x/app@workspace:*".into()]
                } else {
                    vec![]
                },
                ..Default::default()
            },
        ];
        r.normalize();
        mined(&r)
    };
    let layering = |cs: &[Candidate]| !avoids(cs, "import:packages/app").is_empty();
    assert!(
        layering(&build(false)),
        "undeclared upward import closes a cycle"
    );
    assert!(
        !layering(&build(true)),
        "packages/ui declares @x/app: intended"
    );
}

// F2: a deferred load (`import()`, `require()` in a function, a lazy-load helper) of
// a package the importer declares as a peer or optional dependency is how a package
// uses what it may run without, not a layering violation. A static import of it, and
// a deferred load of an undeclared package, still are.
#[test]
fn deferred_loads_of_peer_and_optional_dependencies_are_not_layering_violations() {
    let build = |load: ImportLoad, peer: &[&str], optional: &[&str]| {
        let mut files = Vec::new();
        for i in 0..60 {
            let mut f = file_with(&format!("packages/ui/src/c{i}.ts"), "packages/ui", vec![]);
            if i == 0 {
                f.imports.push(Import {
                    load,
                    ..import(&format!("packages/app/src/a{i}.ts"))
                });
            }
            files.push(f);
        }
        for i in 0..40 {
            let mut f = file_with(&format!("packages/app/src/a{i}.ts"), "packages/app", vec![]);
            f.imports.push(import("packages/ui/src/c5.ts"));
            files.push(f);
        }
        let mut r = repo(files);
        let deps = |d: &[&str]| d.iter().map(|n| format!("{n}@^1.0.0")).collect();
        r.packages = vec![
            PackageFacts {
                path: "packages/app".into(),
                name: "@x/app".into(),
                dependencies: vec!["@x/ui@workspace:*".into()],
                ..Default::default()
            },
            PackageFacts {
                path: "packages/ui".into(),
                name: "@x/ui".into(),
                peer_dependencies: deps(peer),
                optional_dependencies: deps(optional),
                ..Default::default()
            },
        ];
        r.normalize();
        !avoids(&mined(&r), "import:packages/app").is_empty()
    };
    for load in [ImportLoad::Dynamic, ImportLoad::Require, ImportLoad::Lazy] {
        assert!(!build(load, &["@x/app"], &[]), "{load:?} of a peer");
        assert!(
            !build(load, &[], &["@x/app"]),
            "{load:?} of an optional dependency"
        );
        assert!(build(load, &[], &[]), "{load:?} of an undeclared package");
        assert!(
            build(load, &["@x/other"], &[]),
            "{load:?}, another peer declared"
        );
    }
    assert!(
        build(ImportLoad::Static, &["@x/app"], &["@x/app"]),
        "a static import"
    );
}

#[test]
fn only_undeclared_imports_break_layering() {
    // packages/features declares @x/atoms (in packages/platform) but not @x/libraries.
    let mut files = Vec::new();
    for i in 0..60 {
        let mut f = file_with(
            &format!("packages/features/src/f{i}.ts"),
            "packages/features",
            vec![],
        );
        match i {
            0 => f
                .imports
                .push(import("packages/platform/atoms/src/booker.ts")),
            1 => f
                .imports
                .push(import("packages/platform/libraries/src/index.ts")),
            _ => {}
        }
        files.push(f);
    }
    // The platform imports features, so features importing it would close a cycle.
    for (pkg, n) in [("atoms", 10), ("libraries", 10)] {
        for i in 0..n {
            let mut f = file_with(
                &format!("packages/platform/{pkg}/src/p{i}.ts"),
                &format!("packages/platform/{pkg}"),
                vec![],
            );
            f.imports.push(import("packages/features/src/f2.ts"));
            files.push(f);
        }
    }
    let mut r = repo(files);
    let pkg = |path: &str, name: &str, deps: &[&str]| PackageFacts {
        path: path.into(),
        name: name.into(),
        dependencies: deps.iter().map(|d| format!("{d}@workspace:*")).collect(),
        ..Default::default()
    };
    r.packages = vec![
        pkg("packages/features", "@x/features", &["@x/atoms"]),
        pkg("packages/platform/atoms", "@x/atoms", &["@x/features"]),
        pkg(
            "packages/platform/libraries",
            "@x/libraries",
            &["@x/features"],
        ),
    ];
    r.normalize();
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::Avoids {
                    signal: "import:packages/platform".into(),
                }
        })
        .expect("features avoid undeclared platform imports");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    assert_eq!(outliers, ["packages/features/src/f1.ts"]);
    assert!(c.rule.describe().contains(
        "(declared dependencies, and lazy loads of peer or optional dependencies, excepted)"
    ));
}

// P8: CRUD verbs, framework export names and one- or two-file roles are not naming schemes.
#[test]
fn naming_rules_are_team_choices_across_files() {
    let mut files = Vec::new();
    for i in 0..20 {
        let name = if i == 0 {
            "createThing".to_string()
        } else {
            format!("getThing{i}")
        };
        files.push(func(&format!("db/q{i}.ts"), &name, |_| {}));
        let name = if i == 0 {
            "notify".to_string()
        } else {
            format!("sendMail{i}")
        };
        files.push(func(&format!("mail/m{i}.ts"), &name, |_| {}));
        files.push(func(&format!("misc/x{i}.ts"), "run", |_| {}));
    }
    // Next.js route segment config: framework names, whatever the team's taste.
    for i in 0..12 {
        let name = if i < 10 { "maxDuration" } else { "runtime" };
        let mut f = file_with(
            &format!("app/r{i}/route.ts"),
            "",
            vec![
                sym(name, SymbolKind::Const, |_| {}),
                sym("POST", SymbolKind::Function, |_| {}),
            ],
        );
        f.entry_points.push(EntryPoint {
            symbol: "POST".into(),
            kind: "http".into(),
            method: Some("POST".into()),
            route: None,
            adapter: "nextjs".into(),
        });
        files.push(f);
    }
    // Twenty mocks in two files share a prefix because they sit together.
    for f in 0..2 {
        let mut symbols: Vec<Symbol> = (0..10)
            .map(|i| sym(&format!("mockCase{f}{i}"), SymbolKind::Const, |_| {}))
            .collect();
        if f == 0 {
            symbols.push(sym("VALUE", SymbolKind::Const, |_| {}));
        }
        files.push(file_with(&format!("fixtures-lib/m{f}.ts"), "", symbols));
    }
    let cs = mined(&repo(files));
    let named = |p: &str| has(&cs, |c| c.rule == Rule::Named { pattern: p.into() });
    assert!(named("send*"), "a verb the team chose");
    assert!(!named("get*"), "CRUD verb");
    assert!(!named("max*"), "Next.js export name");
    assert!(!named("mock*"), "two files");
}

// P9a: camelCase names have suffixes too, so `*Schema` means what is checked.
#[test]
fn camel_case_names_have_suffix_patterns() {
    assert_eq!(name_patterns("cityTimezonesSchema"), ["city*", "*Schema"]);
    assert_eq!(name_patterns("ZUserSchema"), ["*Schema"]);
    assert!(name_patterns("VALID_MINUTES").is_empty());
    let mut files = Vec::new();
    for i in 0..20 {
        let name = match i {
            0 => "VALID_MINUTES".to_string(),
            i if i % 2 == 0 => format!("thing{i}Schema"),
            _ => format!("ZThing{i}Schema"),
        };
        files.push(file_with(
            &format!("schemas/s{i}.ts"),
            "",
            vec![sym(&name, SymbolKind::Const, |_| {})],
        ));
        files.push(file_with(
            &format!("misc/m{i}.ts"),
            "",
            vec![sym("value", SymbolKind::Const, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::Named {
                    pattern: "*Schema".into(),
                }
        })
        .expect("*Schema");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(outliers, ["VALID_MINUTES"]);
}

// P10: a target named like the role's folder restates the folder.
#[test]
fn rules_restating_the_folder_name_are_not_proposed() {
    let mut files = Vec::new();
    for i in 0..20 {
        files.push(file_with(
            &format!("components/dialogs/d{i}.tsx"),
            "",
            vec![sym(&format!("D{i}"), SymbolKind::Component, |s| {
                if i != 0 {
                    s.renders.push("ui/dialog.tsx#Dialog".into());
                }
                if i != 1 {
                    s.renders.push("ui/dialog.tsx#DialogFooter".into());
                }
                if i != 2 {
                    s.renders.push("ui/button.tsx#Button".into());
                }
            })],
        ));
        files.push(file_with(
            &format!("components/other/o{i}.tsx"),
            "",
            vec![sym(&format!("O{i}"), SymbolKind::Component, |_| {})],
        ));
        files.push(file_with(
            &format!("src/s{i}.service.ts"),
            "",
            vec![sym(&format!("S{i}Service"), SymbolKind::Class, |s| {
                if i != 0 {
                    s.wraps
                        .push(wrap("src/base.service.ts#BaseService", WrapKind::Extends));
                }
            })],
        ));
        files.push(file_with(
            &format!("src/x{i}.ts"),
            "",
            vec![sym(&format!("X{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let renders = |n: &str| {
        has(
            &cs,
            |c| matches!(&c.rule, Rule::Renders { component } if component.ends_with(n)),
        )
    };
    assert!(renders("#Button"));
    assert!(!renders("#Dialog"));
    assert!(!renders("#DialogFooter"));
    assert!(
        has(&cs, |c| matches!(
            &c.rule,
            Rule::WrappedBy {
                kind: WrapKind::Extends,
                ..
            }
        )),
        "a team base class named after the kind is a real choice"
    );
    let agent = RoleSelector {
        package: String::new(),
        dir: "agent".into(),
        file: "*".into(),
        entry: "-".into(),
        kind: SymbolKind::Const,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    };
    assert!(is_tautology(
        &agent,
        &Rule::Calls {
            callee: "pkg:ai#ToolLoopAgent(new)".into()
        }
    ));
    assert!(!is_tautology(
        &agent,
        &Rule::Calls {
            callee: "src/agent/tools.ts#buildTools".into()
        }
    ));
    // A library factory named after the kind is a choice (zod DTOs, not class-validator).
    let dto = RoleSelector {
        file: "*.dto".into(),
        dir: "src".into(),
        kind: SymbolKind::Class,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        ..agent
    };
    assert!(!is_tautology(
        &dto,
        &Rule::WrappedBy {
            kind: WrapKind::Extends,
            any_of: vec!["pkg:nestjs-zod#createZodDto".into()]
        }
    ));
}

// P11: a dependency version rule follows the version most packages use.
#[test]
fn dependency_version_follows_the_workspace() {
    let packages = |majority: &str, minority: &str, odd: usize| -> RepoFacts {
        let mut r = RepoFacts::default();
        for i in 0..20 {
            r.packages.push(PackageFacts {
                path: format!("packages/p{i}"),
                name: format!("@x/p{i}"),
                dependencies: vec![format!(
                    "zod@{}",
                    if i == odd { minority } else { majority }
                )],
                ..Default::default()
            });
        }
        r.normalize();
        r
    };
    let before = packages("3.25.0", "4.1.0", 4);
    let m = mine(&before, &MineOptions { max_per_repo: 100 });
    let c = m
        .candidates
        .iter()
        .find(|c| matches!(&c.rule, Rule::DependencyVersion { name, range: None } if name == "zod"))
        .expect("zod version agrees");
    assert_eq!(c.outliers[0].symbol, "@x/p4");
    assert!(
        c.rule
            .describe()
            .contains("version most workspace packages use")
    );
    let mut policy = ConventionsFile::merge(None, "test", m.kinds.clone(), &m.candidates);
    for c in &mut policy.conventions {
        c.status = Status::Accepted;
    }
    // The workspace upgrades to zod 4 except one package: that one is the violation,
    // not the nineteen that upgraded.
    let after = packages("4.1.0", "3.25.0", 7);
    let report = check(&after, &policy, &Lock::default(), Scope::Accepted, None);
    let violators: Vec<&str> = report
        .violations
        .iter()
        .map(|v| v.symbol.as_str())
        .collect();
    assert_eq!(violators, ["@x/p7"]);
    // The message names the range the workspace agrees on now.
    assert!(
        report.violations[0].summary.ends_with("(zod@4.1.0)"),
        "{}",
        report.violations[0].summary
    );
}

/// `n` packages on `zod@a` and `m` on `zod@b`.
fn zod_workspace(split: &[(&str, usize)]) -> RepoFacts {
    let mut r = RepoFacts::default();
    let mut i = 0;
    for (range, n) in split {
        for _ in 0..*n {
            r.packages.push(PackageFacts {
                path: format!("packages/p{i}"),
                name: format!("@x/p{i}"),
                dependencies: vec![format!("zod@{range}")],
                ..Default::default()
            });
            i += 1;
        }
    }
    r.normalize();
    r
}

fn accepted(rule: Rule, total: usize) -> ConventionsFile {
    let role = RoleSelector {
        package: String::new(),
        dir: ".".into(),
        file: "package.json".into(),
        entry: "-".into(),
        kind: SymbolKind::Package,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    };
    let cand = Candidate {
        id: drift_mine::mine::convention_id(&role, &rule),
        role,
        rule,
        evidence: drift_mine::mine::Evidence {
            holders: total - 1,
            total,
            lower_bound: 0.8,
            lift: 1.0,
            split: vec![],
            role_members: None,
            python_members: None,
        },
        score: 1.0,
        example: "packages/p0/package.json#@x/p0".into(),
        outliers: vec![],
        can_block: true,
        wiring: None,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
    };
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &[cand]);
    p.conventions[0].status = Status::Accepted;
    p
}

fn violators(r: &RepoFacts, p: &ConventionsFile) -> Vec<String> {
    check(r, p, &Lock::default(), Scope::Accepted, None)
        .violations
        .iter()
        .map(|v| v.symbol.clone())
        .collect()
}

// P11: with no strict majority (an upgrade halfway through) nothing is agreed.
#[test]
fn a_tied_workspace_agrees_on_no_version() {
    let rule = Rule::DependencyVersion {
        name: "zod".into(),
        range: None,
    };
    let p = accepted(rule, 4);
    assert!(violators(&zod_workspace(&[("^3.25.0", 2), ("^4.1.0", 2)]), &p).is_empty());
    // String order does not pick a winner either (`^10` sorts before `^9`).
    assert!(violators(&zod_workspace(&[("^9.0.0", 2), ("^10.0.0", 2)]), &p).is_empty());
    assert_eq!(
        violators(&zod_workspace(&[("^9.0.0", 1), ("^10.0.0", 2)]), &p),
        ["@x/p0"]
    );
}

// P11: a pin accepted before the change keeps its id and its meaning, and a fresh
// mine next to it adds no second convention with the same role and rule.
#[test]
fn accepted_version_pins_keep_their_id_and_meaning() {
    let yaml_rule: Rule =
        serde_json::from_str(r#"{"type":"dependency_version","name":"zod","range":"^3.25.0"}"#)
            .expect("old DependencyVersion rules load");
    let pinned = Rule::DependencyVersion {
        name: "zod".into(),
        range: Some("^3.25.0".into()),
    };
    assert_eq!(yaml_rule, pinned);
    assert_eq!(
        serde_json::to_string(&pinned).unwrap(),
        r#"{"type":"dependency_version","name":"zod","range":"^3.25.0"}"#,
        "same serialised form, so the same id as before"
    );
    let old = accepted(pinned, 20);
    let old_id = old.conventions[0].id.clone();
    // Three of five packages upgraded: the pin still flags the upgraded ones, as before.
    let ws = zod_workspace(&[("^3.25.0", 2), ("^4.1.0", 3)]);
    let before = violators(&ws, &old);
    assert_eq!(before, ["@x/p2", "@x/p3", "@x/p4"]);
    // Re-mine a workspace that agrees on 3.25.0 and merge into the old file.
    let fresh_ws = zod_workspace(&[("^3.25.0", 19), ("^4.1.0", 1)]);
    let m = mine(&fresh_ws, &MineOptions { max_per_repo: 100 });
    let merged = ConventionsFile::merge(Some(old), "test", m.kinds.clone(), &m.candidates);
    let mut seen = std::collections::BTreeSet::new();
    for c in &merged.conventions {
        assert!(
            seen.insert((c.role.clone(), c.rule.clone())),
            "duplicate {:?}",
            c.rule
        );
    }
    let kept = merged
        .conventions
        .iter()
        .find(|c| c.id == old_id)
        .expect("old id kept");
    assert_eq!(kept.status, Status::Accepted);
    assert_eq!(kept.summary, "workspace packages depend on zod@^3.25.0");
    // Only the old convention is accepted, so check behaves exactly as before.
    assert_eq!(violators(&ws, &merged), before);
}

// ---------------------------------------------------------------------------
// Python dev study (eval/study/runs/dev-py-2026-11-05): kinds (P1), base chains,
// layering inside one role's scope, file-local roles and `typing.Any`.

fn py(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        lang: "py".into(),
        ..file_with(path, "", symbols)
    }
}

fn class(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    sym(name, SymbolKind::Class, edit)
}

const REPO_BASE: &str = "app/kit/repository.py#RepositoryBase";

/// 30 `repository.py` modules, each a repository (one extends nothing) plus a
/// NamedTuple result type; a `TransactionRepository` base and three subclasses.
fn repositories() -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..30 {
        files.push(py(
            &format!("app/m{i}/repository.py"),
            vec![
                class(&format!("M{i}Repository"), |s| {
                    if i != 0 {
                        s.wraps.push(wrap(REPO_BASE, WrapKind::Extends));
                    }
                }),
                class(&format!("M{i}Result"), |s| {
                    s.wraps
                        .push(wrap("pkg:python:typing#NamedTuple", WrapKind::Extends));
                    s.traits.push("namedtuple".into());
                }),
            ],
        ));
    }
    let tx = "app/tx/repository.py#TransactionRepository";
    let mut tx_file = vec![class("TransactionRepository", |s| {
        s.wraps.push(wrap(REPO_BASE, WrapKind::Extends));
        s.traits.push("base".into());
    })];
    for k in ["Payment", "Refund", "Payout"] {
        tx_file.push(class(&format!("{k}TransactionRepository"), |s| {
            s.wraps.push(wrap(tx, WrapKind::Extends));
        }));
    }
    files.push(py("app/tx/repository.py", tx_file));
    let mut base = py(
        "app/kit/repository.py",
        vec![class("RepositoryBase", |s| s.traits.push("base".into()))],
    );
    base.path = "app/kit/repository.py".into();
    files.push(base);
    repo(files)
}

// P1: base classes and special kinds are not members of the primary classes' role,
// and a class extends what its in-repo base extends.
#[test]
fn class_roles_hold_primary_classes_and_follow_base_chains() {
    let r = repositories();
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Extends,
                    any_of: vec![REPO_BASE.into()],
                }
                && c.role.variety.is_none()
        })
        .expect("repositories extend RepositoryBase");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(
        outliers,
        ["M0Repository"],
        "the NamedTuples and the base are no members; subclasses of the base hold"
    );
    assert_eq!(c.evidence.total, 33);
    // The NamedTuples form a role of their own, described as such.
    let nt = RoleSelector {
        variety: Some("namedtuple".into()),
        ..c.role.clone()
    };
    assert!(
        nt.describe().starts_with("named tuples in "),
        "{}",
        nt.describe()
    );
    // `check` agrees: the subclasses do not violate an accepted rule.
    let mut p = ConventionsFile::merge(None, "test", mine(&r, &MineOptions::default()).kinds, &cs);
    for conv in &mut p.conventions {
        conv.status = Status::Accepted;
    }
    let v = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    assert!(
        v.violations
            .iter()
            .all(|v| !v.symbol.contains("TransactionRepository")),
        "{:?}",
        v.violations
    );
}

#[test]
fn an_ancestor_is_a_candidate_only_when_most_holders_extend_it_directly() {
    // Views extend `ObjectView`, which brings `PermissionMixin` along: the mixin is
    // not a convention of its own.
    let mut files = Vec::new();
    for i in 0..30 {
        files.push(py(
            &format!("app/m{i}/models.py"),
            vec![class(&format!("M{i}"), |_| {})],
        ));
    }
    for i in 0..30 {
        files.push(py(
            &format!("app/v{i}/views.py"),
            vec![class(&format!("V{i}View"), |s| {
                if i != 0 {
                    s.wraps
                        .push(wrap("app/generic.py#ObjectView", WrapKind::Extends));
                }
            })],
        ));
    }
    files.push(py(
        "app/generic.py",
        vec![class("ObjectView", |s| {
            s.wraps
                .push(wrap("app/mixins.py#PermissionMixin", WrapKind::Extends));
        })],
    ));
    let cs = mined(&repo(files));
    let extends = |target: &str| {
        has(&cs, |c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Extends,
                    any_of: vec![target.into()],
                }
        })
    };
    assert!(extends("app/generic.py#ObjectView"));
    assert!(!extends("app/mixins.py#PermissionMixin"));
}

/// Python apps under `app/`: `app/core` (60 files) imports `app/reports` from one,
/// which imports `app/core` from all 10 of its files; `app/api` (60 files) imports
/// `app/reports` from one, and reports never import the api (no cycle).
fn python_apps() -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..60 {
        let mut f = py(&format!("app/core/c{i}.py"), vec![]);
        if i == 0 {
            f.imports.push(import("app/reports/r1.py"));
        }
        files.push(f);
    }
    for i in 0..10 {
        let mut f = py(&format!("app/reports/r{i}.py"), vec![]);
        f.imports.push(import("app/core/c1.py"));
        files.push(f);
    }
    for i in 0..60 {
        let mut f = py(&format!("app/api/a{i}.py"), vec![]);
        if i == 0 {
            f.imports.push(import("app/reports/r2.py"));
        }
        f.imports.push(import("app/core/c2.py"));
        files.push(f);
    }
    repo(files)
}

#[test]
fn layering_needs_a_role_apart_from_the_target_on_the_lower_side() {
    let cs = mined(&python_apps());
    let dirs = avoids(&cs, "import:app/reports");
    // `app/core` is below `app/reports`: proposed.
    assert!(dirs.contains(&"app/core".to_string()), "{dirs:?}");
    // "files in app/**" and "files in the repo" contain app/reports itself.
    assert!(!dirs.contains(&"app".to_string()), "{dirs:?}");
    assert!(!dirs.contains(&"**".to_string()), "{dirs:?}");
    // `app/api` and `app/reports` do not import each other in a cycle.
    assert!(!dirs.contains(&"app/api".to_string()), "{dirs:?}");
}

#[test]
fn a_cycle_is_layering_only_in_its_dominant_direction() {
    // `app/api` imports `app/billing` from 21 files (its handlers from one, its
    // services from all 20); billing imports the api from 3 of 100 files. Billing is
    // below the api, so only "billing avoids api" is layering.
    let mut files = Vec::new();
    for i in 0..60 {
        let mut f = py(&format!("app/api/handlers/h{i}.py"), vec![]);
        if i == 0 {
            f.imports.push(import("app/billing/b1.py"));
        }
        files.push(f);
    }
    for i in 0..20 {
        let mut f = py(&format!("app/api/services/s{i}.py"), vec![]);
        f.imports.push(import("app/billing/b2.py"));
        files.push(f);
    }
    for i in 0..100 {
        let mut f = py(&format!("app/billing/b{i}.py"), vec![]);
        if i < 3 {
            f.imports.push(import("app/api/handlers/h1.py"));
        }
        files.push(f);
    }
    let cs = mined(&repo(files));
    assert!(avoids(&cs, "import:app/billing").is_empty());
    assert_eq!(avoids(&cs, "import:app/api"), ["app/billing"]);
}

#[test]
fn python_rules_need_holders_from_three_files() {
    let jobs = |files: usize| {
        let mut out = Vec::new();
        for f in 0..files {
            let per = 21 / files;
            let symbols: Vec<Symbol> = (0..per)
                .map(|j| {
                    sym(&format!("task{f}_{j}"), SymbolKind::Function, |s| {
                        if f + j != 0 {
                            s.args.push("pkg:celery#Celery.task@99:compression".into());
                        }
                    })
                })
                .collect();
            let mut file = py(&format!("app/plugins/p{f}/tasks.py"), symbols.clone());
            file.entry_points = symbols
                .iter()
                .map(|s| EntryPoint {
                    symbol: s.name.clone(),
                    kind: "job".into(),
                    method: None,
                    route: Some(s.name.clone()),
                    adapter: "celery".into(),
                })
                .collect();
            out.push(file);
        }
        // Other jobs elsewhere, for contrast.
        for i in 0..60 {
            let mut file = py(
                &format!("app/other/o{i}.py"),
                vec![sym("job", SymbolKind::Function, |_| {})],
            );
            file.entry_points.push(EntryPoint {
                symbol: "job".into(),
                kind: "job".into(),
                method: None,
                route: Some("job".into()),
                adapter: "celery".into(),
            });
            out.push(file);
        }
        mined(&repo(out))
    };
    let compression = |cs: &[Candidate]| {
        has(
            cs,
            |c| matches!(&c.rule, Rule::PassesKey { key, .. } if key == "compression"),
        )
    };
    assert!(
        !compression(&jobs(2)),
        "two files: one pattern written twice"
    );
    assert!(compression(&jobs(3)));
}

#[test]
fn avoiding_typing_any_needs_a_lint_rule() {
    let mut files = Vec::new();
    for i in 0..20 {
        files.push(py(
            &format!("ui/c{i}.py"),
            vec![sym("view", SymbolKind::Function, |s| {
                if i == 0 {
                    s.controls.push("uses_any".into());
                }
            })],
        ));
        files.push(py(
            &format!("lib/l{i}.py"),
            vec![sym("load", SymbolKind::Function, |s| {
                if i < 12 {
                    s.controls.push("uses_any".into());
                }
            })],
        ));
    }
    let r = repo(files);
    let cs = mined(&r);
    assert!(avoids(&cs, "typing_any").is_empty());
    assert!(
        avoids(&cs, "any").is_empty(),
        "Python's Any is not TypeScript's any"
    );
    // ESLint's `no-explicit-any` next to the Python code is about TypeScript.
    for level in ["warn", "error"] {
        let mut r = r.clone();
        r.lint = vec![LintConfig {
            tool: "eslint".into(),
            ..lint("eslint.config.js", "no-explicit-any", level)
        }];
        assert!(avoids(&mined(&r), "typing_any").is_empty(), "{level}");
    }
    assert_eq!(
        Rule::Avoids {
            signal: "typing_any".into()
        }
        .describe(),
        "do not use `Any` (typing)"
    );
}

// Conventions accepted as "avoids any" on Python code keep holding for `typing.Any`.
#[test]
fn accepted_python_any_rules_mean_typing_any() {
    let mut files = Vec::new();
    for i in 0..20 {
        files.push(py(
            &format!("ui/c{i}.py"),
            vec![sym("view", SymbolKind::Function, |s| {
                if i == 0 {
                    s.controls.push("uses_any".into());
                }
            })],
        ));
    }
    let r = repo(files);
    let role = RoleSelector {
        package: String::new(),
        dir: "ui".into(),
        file: "*".into(),
        entry: "-".into(),
        kind: SymbolKind::Function,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    };
    let rule = Rule::Avoids {
        signal: "any".into(),
    };
    let c = Candidate {
        id: drift_mine::mine::convention_id(&role, &rule),
        role,
        rule,
        evidence: drift_mine::mine::Evidence {
            holders: 19,
            total: 20,
            lower_bound: 0.76,
            lift: 3.0,
            split: vec![],
            role_members: None,
            python_members: None,
        },
        score: 1.0,
        example: "ui/c1.py#view".into(),
        outliers: vec![],
        can_block: true,
        wiring: None,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
    };
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &[c]);
    p.conventions[0].status = Status::Accepted;
    let v = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    let paths: Vec<&str> = v.violations.iter().map(|v| v.path.as_str()).collect();
    assert_eq!(paths, ["ui/c0.py"]);
}

// ---------------------------------------------------------------------------
// TypeScript dev study, round 2: calls on built code, file-local rules, rules that
// follow path parameters, and version suffixes in names.

fn entry(symbol: &str, kind: &str, route: Option<&str>) -> EntryPoint {
    EntryPoint {
        symbol: symbol.into(),
        kind: kind.into(),
        method: None,
        route: route.map(Into::into),
        adapter: "test".into(),
    }
}

// A component's class-name helper (`cn()`, or an in-repo wrapper over `clsx`) is how
// it is built where classes merge, and so is a value's call when its outliers use a
// sibling of it (`array()` next to `object()`): not proposed. Functions, other
// component calls (screens calling `trackPageView()`) and values whose outliers call
// nothing like it keep their calls rules.
#[test]
fn calls_are_conventions_of_code_that_runs() {
    let mut files = vec![file_with(
        "lib/styles.ts",
        "",
        vec![sym("cx", SymbolKind::Function, |s| {
            s.calls = vec!["pkg:clsx#default".into()];
        })],
    )];
    for i in 0..20 {
        let calls = |c: &str| if i == 0 { vec![] } else { vec![c.to_string()] };
        files.push(file_with(
            &format!("panels/panel-{i}.tsx"),
            "",
            vec![sym(&format!("Panel{i}"), SymbolKind::Component, |s| {
                s.calls = calls("lib/styles.ts#cx");
            })],
        ));
        files.push(file_with(
            &format!("ui/widget-{i}.tsx"),
            "",
            vec![sym(&format!("Widget{i}"), SymbolKind::Component, |s| {
                s.calls = calls("lib/utils.ts#cn");
            })],
        ));
        files.push(file_with(
            &format!("schemas/thing-{i}.ts"),
            "",
            vec![sym(&format!("thing{i}Schema"), SymbolKind::Const, |s| {
                // The outlier is an array schema: a sibling of `z.object()`.
                s.calls = if i == 0 {
                    vec!["pkg:zod#z.array".into()]
                } else {
                    calls("pkg:zod#z.object")
                };
            })],
        ));
        // Dependencies declared with `inject()`; the outlier declares none.
        files.push(file_with(
            &format!("deps/dep-{i}.ts"),
            "",
            vec![sym(&format!("Dep{i}"), SymbolKind::Const, |s| {
                s.calls = calls("lib/di.ts#inject");
            })],
        ));
        files.push(func(&format!("api/route-{i}.ts"), "handle", |s| {
            s.calls = calls("lib/db.ts#getTenant");
        }));
        let mut page = file_with(
            &format!("app/p{i}/page.tsx"),
            "",
            vec![sym("Page", SymbolKind::Component, |s| {
                s.calls = calls("lib/auth.ts#requireUser");
            })],
        );
        page.entry_points.push(entry("Page", "page", None));
        files.push(page);
        // The same kinds elsewhere, without those calls (lift).
        files.push(file_with(
            &format!("misc/m{i}.tsx"),
            "",
            vec![
                sym(&format!("Other{i}"), SymbolKind::Component, |_| {}),
                sym(&format!("value{i}"), SymbolKind::Const, |_| {}),
                sym(&format!("other{i}"), SymbolKind::Const, |_| {}),
                sym(&format!("run{i}"), SymbolKind::Function, |_| {}),
            ],
        ));
    }
    let r = repo(files);
    // TypeScript call rules are never proposed unless the callee is a guard
    // (`mine::hidden_call_rule`).
    let shown = mined(&r);
    let proposed = |callee: &str| {
        has(
            &shown,
            |c| matches!(&c.rule, Rule::Calls { callee: x } if x == callee),
        )
    };
    assert!(!proposed("lib/di.ts#inject"));
    // Named for access control (a tenant scope, a signed-in user): guards stay.
    assert!(proposed("lib/db.ts#getTenant"));
    assert!(proposed("lib/auth.ts#requireUser"), "a guard pages call");
    // What each call rule is about, with every family.
    let cs = mined_every(&r);
    let calls = |callee: &str| {
        has(
            &cs,
            |c| matches!(&c.rule, Rule::Calls { callee: x } if x == callee),
        )
    };
    assert!(!calls("lib/utils.ts#cn"), "how components are built");
    assert!(!calls("lib/styles.ts#cx"), "an in-repo wrapper over clsx");
    assert!(!calls("pkg:zod#z.object"), "how values are built");
    assert!(
        calls("lib/di.ts#inject"),
        "a value whose outlier is built otherwise"
    );
    assert!(calls("lib/db.ts#getTenant"), "what functions do");
    assert!(calls("lib/auth.ts#requireUser"), "what pages do");
}

// A rule held by one file's exports, with its outliers in other files, describes that
// file. A role that is one file (a schema file's tables) is judged within it.
#[test]
fn rules_of_one_file_are_not_rules_of_the_role() {
    let icons: Vec<Symbol> = (0..40)
        .map(|i| {
            sym(&format!("Icon{i}"), SymbolKind::Function, |s| {
                s.wraps
                    .push(wrap("ui/create-icon.ts#createIcon", WrapKind::Call));
            })
        })
        .collect();
    let mut files = vec![file_with("ui/icons.tsx", "", icons)];
    for i in 0..3 {
        files.push(func(&format!("ui/part-{i}.tsx"), "buttonVariants", |_| {}));
    }
    let tables: Vec<Symbol> = (0..40)
        .map(|i| {
            sym(&format!("table{i}"), SymbolKind::Function, |s| {
                if i >= 3 {
                    s.args.push("pkg:drizzle-orm#pgTable@1:id".into());
                }
            })
        })
        .collect();
    files.push(file_with("db/schema.ts", "", tables));
    for i in 0..40 {
        files.push(func(&format!("misc/m{i}.ts"), "run", |_| {}));
    }
    let cs = mined(&repo(files));
    assert!(
        !has(&cs, |c| matches!(&c.rule, Rule::WrappedBy { any_of, .. }
            if any_of == &["ui/create-icon.ts#createIcon".to_string()])),
        "one file's icons"
    );
    assert!(
        has(
            &cs,
            |c| matches!(&c.rule, Rule::PassesKey { key, .. } if key == "id")
        ),
        "a one-file role is judged within its file"
    );
}

// `@ApiParam()` on exactly the handlers whose route has a path parameter follows the
// parameters; a guard missing on one handler with parameters is still an outlier.
#[test]
fn rules_that_follow_path_parameters_are_not_proposed() {
    let mut files = Vec::new();
    for f in 0..4 {
        let mut symbols = Vec::new();
        let mut entries = Vec::new();
        for i in 0..12 {
            let params = i != 0;
            let route = if params {
                format!("/items{f}/:id{i}")
            } else {
                format!("/items{f}")
            };
            let name = format!("GET {route}");
            let guarded = !(f == 0 && i == 1);
            symbols.push(sym(&name, SymbolKind::Function, |s| {
                if params {
                    s.wraps
                        .push(wrap("pkg:@nestjs/swagger#ApiParam", WrapKind::Decorator));
                }
                if guarded {
                    s.wraps
                        .push(wrap("src/auth.ts#Guarded", WrapKind::Decorator));
                }
            }));
            entries.push(entry(&name, "http", Some(&route)));
        }
        let mut file = file_with(&format!("src/items{f}.controller.ts"), "", symbols);
        file.entry_points = entries;
        files.push(file);
    }
    for i in 0..40 {
        files.push(func(&format!("misc/m{i}.ts"), "run", |_| {}));
    }
    let cs = mined(&repo(files));
    let decorated = |w: &str| {
        has(&cs, |c| {
            matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Decorator, any_of }
                if any_of == &[w.to_string()])
        })
    };
    assert!(
        !decorated("pkg:@nestjs/swagger#ApiParam"),
        "follows path params"
    );
    assert!(decorated("src/auth.ts#Guarded"), "a real outlier");
}

// P9: a version suffix is not the noun (`EnvironmentsControllerV1` is a `*Controller`).
#[test]
fn version_suffixes_keep_the_noun() {
    assert_eq!(name_patterns("EnvironmentsControllerV1"), ["*Controller"]);
    assert_eq!(name_patterns("sendRequestEmailV2"), ["send*", "*Email"]);
    assert_eq!(name_patterns("SyncAssetV1"), ["*Asset"]);
    assert!(name_patterns("Base64").is_empty());
    assert!(name_patterns("V2").is_empty());
}

// The linter states which way a layer edge goes: `packages/app-store` must not import
// `../features` (a Biome `overrides` entry) makes features importing app-store the
// intended direction, so "features do not import from app-store" is not proposed.
#[test]
fn layering_follows_the_direction_the_linter_states() {
    let mut files = Vec::new();
    for i in 0..60 {
        let mut f = file_with(
            &format!("packages/features/src/f{i}.ts"),
            "packages/features",
            vec![],
        );
        if i == 0 {
            f.imports.push(import("packages/app-store/src/a0.ts"));
        }
        files.push(f);
    }
    for i in 0..20 {
        let mut f = file_with(
            &format!("packages/app-store/src/a{i}.ts"),
            "packages/app-store",
            vec![],
        );
        f.imports.push(import("packages/features/src/f1.ts"));
        files.push(f);
    }
    let r = repo(files);
    let reverse = "import:packages/app-store";
    assert!(
        !avoids(&mined(&r), reverse).is_empty(),
        "without the linter"
    );
    let mut with_lint = r.clone();
    with_lint.lint = vec![LintConfig {
        path: "biome.json".into(),
        tool: "biome".into(),
        scoped: vec![drift_core::ScopedLintRules {
            dirs: vec!["packages/app-store".into()],
            rules: vec![LintRule {
                rule: "no-restricted-imports".into(),
                level: "error".into(),
                options: vec!["../features/**".into()],
            }],
        }],
        ..Default::default()
    }];
    assert!(avoids(&mined(&with_lint), reverse).is_empty());
}

// The reviewer's repro: screens (components, not framework entry points) call
// `useAuth()` and `trackPageView()`; two screens do not. Cards call neither.
#[test]
fn screens_keep_their_hook_call_conventions() {
    let mut files = Vec::new();
    for i in 1..=40 {
        files.push(file_with(
            &format!("src/screens/Screen{i}.tsx"),
            "",
            vec![sym(&format!("Screen{i}"), SymbolKind::Component, |s| {
                if i <= 38 {
                    s.calls = vec![
                        "src/lib/auth.ts#trackPageView".into(),
                        "src/lib/auth.ts#useAuth".into(),
                    ];
                }
                s.renders = vec![format!("src/components/Card{i}.tsx#Card{i}")];
            })],
        ));
        files.push(file_with(
            &format!("src/components/Card{i}.tsx"),
            "",
            vec![sym(&format!("Card{i}"), SymbolKind::Component, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    assert!(has(&cs, |c| matches!(&c.rule, Rule::Calls { callee }
        if callee.starts_with("src/lib/auth.ts#"))));
}

// Two service files of 20 functions call `requireUser()`; a newly added `billing.ts`
// with 4 does not. That is an outlier file, not a file-local rule.
#[test]
fn a_new_file_that_skips_the_convention_is_reported() {
    let mut files = Vec::new();
    for f in ["users", "orgs"] {
        let symbols = (1..=20)
            .map(|i| {
                sym(&format!("{f}Op{i}"), SymbolKind::Function, |s| {
                    s.calls = vec!["src/lib/auth.ts#requireUser".into()];
                })
            })
            .collect();
        files.push(file_with(&format!("src/services/{f}.ts"), "", symbols));
    }
    let billing = (1..=4)
        .map(|i| sym(&format!("billingOp{i}"), SymbolKind::Function, |_| {}))
        .collect();
    files.push(file_with("src/services/billing.ts", "", billing));
    for i in 1..=30 {
        files.push(func(
            &format!("src/util/u{i}.ts"),
            &format!("util{i}"),
            |_| {},
        ));
    }
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Calls { callee } if callee == "src/lib/auth.ts#requireUser"))
        .expect("requireUser is the services' convention");
    assert!(
        c.outliers
            .iter()
            .all(|o| o.path == "src/services/billing.ts")
    );
}

/// The reviewer's layering repo: `packages/ui` (`@acme/ui`, 80 files, 2 import
/// `apps/web`) and `apps/web` (`@acme/web`, 80 files importing ui, declared).
fn ui_and_web(lint: Vec<LintConfig>) -> RepoFacts {
    let mut files = vec![file_with("apps/web/src/config.ts", "apps/web", vec![])];
    for i in 1..=80 {
        let mut ui = file_with(&format!("packages/ui/src/c{i}.ts"), "packages/ui", vec![]);
        if i <= 2 {
            ui.imports.push(import("apps/web/src/config.ts"));
        }
        files.push(ui);
        let mut web = file_with(&format!("apps/web/src/p{i}.ts"), "apps/web", vec![]);
        web.imports
            .push(import(&format!("packages/ui/src/c{i}.ts")));
        files.push(web);
    }
    let mut r = repo(files);
    r.packages = vec![
        PackageFacts {
            path: "packages/ui".into(),
            name: "@acme/ui".into(),
            ..Default::default()
        },
        PackageFacts {
            path: "apps/web".into(),
            name: "@acme/web".into(),
            dependencies: vec!["@acme/ui@*".into()],
            ..Default::default()
        },
    ];
    r.lint = lint;
    r.normalize();
    r
}

fn restricted(options: &[&str]) -> Vec<LintRule> {
    vec![LintRule {
        rule: "no-restricted-imports".into(),
        level: "error".into(),
        options: options.iter().map(|o| (*o).into()).collect(),
    }]
}

// Only an `overrides` entry scoped to the whole target that names the role's area as a
// whole states a layering direction. A repo-wide deprecation of a subpath, or an entry
// scoped to part of the target naming a subpath, does not.
#[test]
fn only_whole_area_restrictions_state_a_layering_direction() {
    let ui_avoids_web = |r: &RepoFacts| !avoids(&mined(r), "import:apps/web").is_empty();
    assert!(ui_avoids_web(&ui_and_web(vec![])), "no lint config");
    let root = LintConfig {
        path: ".eslintrc.json".into(),
        tool: "eslint".into(),
        rules: restricted(&["@acme/ui/legacy", "Use @acme/ui/button", "message", "name"]),
        ..Default::default()
    };
    assert!(
        ui_avoids_web(&ui_and_web(vec![root])),
        "a whole-config deprecation"
    );
    let scoped = |dirs: &[&str], options: &[&str]| LintConfig {
        path: ".eslintrc.json".into(),
        tool: "eslint".into(),
        scoped: vec![drift_core::ScopedLintRules {
            dirs: dirs.iter().map(|d| (*d).into()).collect(),
            rules: restricted(options),
        }],
        ..Default::default()
    };
    assert!(
        ui_avoids_web(&ui_and_web(vec![scoped(
            &["apps/web/src"],
            &["@acme/ui/legacy/*"]
        )])),
        "an entry for part of apps/web, naming a subpath"
    );
    assert!(
        ui_avoids_web(&ui_and_web(vec![scoped(
            &["apps/web"],
            &["@acme/ui/legacy/*"]
        )])),
        "a subpath of ui"
    );
    assert!(
        ui_avoids_web(&ui_and_web(vec![scoped(&["apps/web/src"], &["@acme/ui"])])),
        "an entry for part of apps/web"
    );
    // apps/web must not import ui as a whole: ui importing web is the intended way.
    for whole in ["@acme/ui", "@acme/ui/**", "../../packages/ui/*"] {
        assert!(
            !ui_avoids_web(&ui_and_web(vec![scoped(&["apps/web"], &[whole])])),
            "{whole}"
        );
    }
}

// A config with the most `overrides` entries, globs and options Drift reads costs
// little in mining.
#[test]
fn many_scoped_lint_entries_mine_quickly() {
    let options: Vec<String> = (0..64).map(|i| format!("../nothing{i}/**")).collect();
    let options: Vec<&str> = options.iter().map(String::as_str).collect();
    let entries: Vec<drift_core::ScopedLintRules> = (0..64)
        .map(|e| drift_core::ScopedLintRules {
            dirs: (0..64)
                .map(|d| format!("apps/web/d{e}x{d}"))
                .chain(["apps".into()])
                .collect(),
            rules: restricted(&options),
        })
        .collect();
    let configs = (0..8)
        .map(|c| LintConfig {
            path: format!("c{c}/.eslintrc.json"),
            tool: "eslint".into(),
            scoped: entries.clone(),
            ..Default::default()
        })
        .collect();
    let started = std::time::Instant::now();
    assert!(!avoids(&mined(&ui_and_web(configs)), "import:apps/web").is_empty());
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
}

// Python dev study, round 2 (relabel of PR #13): layering against an area's peers,
// refinements of a team base, file kinds split by layer and numbered modules, type
// variables.

/// `python_apps`, with `app/core` importing each of `peers` from `files` files, and
/// each peer (10 files) importing `app/core` back.
fn entangled_apps(peers: &[&str], files: usize) -> Vec<String> {
    let mut r = python_apps();
    for (k, peer) in peers.iter().enumerate() {
        for f in &mut r.files {
            if (1..=files).any(|n| f.path == format!("app/core/c{}.py", 10 * k + n)) {
                f.imports.push(import(&format!("app/{peer}/p1.py")));
            }
        }
        for i in 0..10 {
            let mut f = py(&format!("app/{peer}/p{i}.py"), vec![]);
            f.imports.push(import("app/core/c3.py"));
            r.files.push(f);
        }
    }
    r.normalize();
    avoids(&mined(&r), "import:app/reports")
}

#[test]
fn an_area_entangled_with_its_peers_has_no_layering_rule() {
    // `app/core` sits below `app/reports` (see `python_apps`). Two-way dependencies
    // with several apps next to reports make the boundary incidental.
    assert!(!entangled_apps(&["users", "billing"], 2).contains(&"app/core".to_string()));
    // One stray import of each peer is an outlier, not a dependency.
    assert!(entangled_apps(&["users", "billing"], 1).contains(&"app/core".to_string()));
}

#[test]
fn one_two_way_sibling_keeps_the_other_boundaries() {
    // A foundation app that depends both ways on one app (`core` and `users` through
    // the user model) still sits below the others.
    assert!(entangled_apps(&["users"], 2).contains(&"app/core".to_string()));
    assert!(entangled_apps(&["users"], 5).contains(&"app/core".to_string()));
}

/// 40 classes in `app/models/` (one per module) and 30 plain classes elsewhere. 36
/// models extend `RecordModel`, a team base that extends the team's `Model`; the
/// other four extend nothing, except the first `n` of them, which extend `general`.
fn models(general: Option<&str>, n: usize) -> RepoFacts {
    let record = "app/db.py#RecordModel";
    let model = "app/db.py#Model";
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(py(
            &format!("app/models/m{i}.py"),
            vec![class(&format!("M{i}"), |s| {
                if i >= 4 {
                    s.wraps.push(wrap(record, WrapKind::Extends));
                } else if let Some(g) = general.filter(|_| i < n) {
                    s.wraps.push(wrap(g, WrapKind::Extends));
                }
            })],
        ));
    }
    for i in 0..30 {
        files.push(py(
            &format!("app/svc/s{i}.py"),
            vec![class(&format!("S{i}"), |_| {})],
        ));
    }
    files.push(py(
        "app/db.py",
        vec![
            class("Model", |s| s.traits.push("base".into())),
            class("RecordModel", |s| {
                s.wraps.push(wrap(model, WrapKind::Extends));
                s.traits.push("base".into());
            }),
        ],
    ));
    repo(files)
}

#[test]
fn a_refinement_of_a_team_base_is_no_rule_when_the_outliers_take_the_general_one() {
    let extends_record = |r: &RepoFacts| {
        has(&mined(r), |c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Extends,
                    any_of: vec!["app/db.py#RecordModel".into()],
                }
        })
    };
    // Association tables extend `Model` itself: a choice the team offers.
    assert!(!extends_record(&models(Some("app/db.py#Model"), 4)));
    // Classes that extend nothing are outliers of the rule, and one or two classes
    // that extend `Model` are not yet a variant the team offers.
    assert!(extends_record(&models(None, 0)));
    assert!(extends_record(&models(Some("app/db.py#Model"), 2)));
}

#[test]
fn python_file_kinds_split_by_layer_and_skip_numbered_modules() {
    // 30 apps with UI views (`views.py`, all but one decorated), five of them with
    // REST views (`api/views.py`), and numbered tutorial modules.
    let mut files = Vec::new();
    for i in 0..30 {
        files.push(py(
            &format!("app/a{i}/views.py"),
            vec![class(&format!("A{i}View"), |s| {
                if i != 0 {
                    s.wraps
                        .push(wrap("app/ui.py#register", WrapKind::Decorator));
                }
            })],
        ));
        if i < 5 {
            files.push(py(
                &format!("app/a{i}/api/views.py"),
                vec![class(&format!("A{i}ViewSet"), |_| {})],
            ));
        }
        files.push(py(
            &format!("docs/t{i}/tutorial004_py310.py"),
            vec![class(&format!("T{i}"), |_| {})],
        ));
    }
    let m = mine(&repo(files), &MineOptions { max_per_repo: 200 });
    assert_eq!(m.kinds.kind_of("app/a1/api/views.py"), "api/views");
    assert_eq!(m.kinds.kind_of("app/a1/views.py"), "views");
    assert_eq!(m.kinds.kind_of("docs/t1/tutorial004_py310.py"), "*");
    // The REST views are no outliers of the UI views' rule.
    let c = m
        .candidates
        .iter()
        .find(|c| c.role.file == "views" && matches!(c.rule, Rule::WrappedBy { .. }))
        .expect("UI views are decorated");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(outliers, ["A0View"]);
}

#[test]
fn type_variables_are_in_no_role() {
    // 23 TypeVars passing `bound` and one type alias, in three modules.
    let mut files = Vec::new();
    for f in 0..3 {
        let mut symbols: Vec<Symbol> = (0..8)
            .map(|i| {
                sym(&format!("T_{f}_{i}"), SymbolKind::Variable, |s| {
                    s.calls.push("pkg:python:typing#TypeVar".into());
                    s.args.push("pkg:python:typing#TypeVar@99:bound".into());
                    s.traits.push("type_var".into());
                })
            })
            .collect();
        if f == 0 {
            symbols.pop();
            symbols.push(sym("Alias", SymbolKind::Variable, |_| {}));
        }
        files.push(py(&format!("pkg/m{f}.py"), symbols));
    }
    for i in 0..80 {
        files.push(py(
            &format!("other/v{i}.py"),
            vec![sym(&format!("V{i}"), SymbolKind::Variable, |_| {})],
        ));
    }
    let r = repo(files);
    let cs = mined(&r);
    assert!(
        !has(&cs, |c| matches!(c.rule, Rule::PassesKey { .. })),
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    // Without the trait the TypeVars would hold a `bound` rule with the alias as its
    // outlier.
    let mut plain = r.clone();
    for f in &mut plain.files {
        for s in &mut f.symbols {
            s.traits.clear();
        }
    }
    assert!(has(&mined(&plain), |c| matches!(
        c.rule,
        Rule::PassesKey { .. }
    )));
}

// ---------------------------------------------------------------------------
// Python dev relabel r2 (eval/study/runs/dev-py-r2-2026-11-05): what a rule is about.
// Each test plants the rejected shape next to a true convention of the same shape.

/// 100 plain classes elsewhere, so that a role's rules have lift.
fn plain_classes(files: &mut Vec<FileFacts>) {
    for i in 0..100 {
        files.push(py(
            &format!("other/c{i}.py"),
            vec![class(&format!("C{i}"), |_| {})],
        ));
    }
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

fn extends_rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![target.into()],
    }
}

/// TypedDicts in five modules: all but one extend `base`, the last `other`.
fn typeddicts(base: &str, other: &str) -> RepoFacts {
    let mut files = Vec::new();
    for f in 0..5 {
        files.push(py(
            &format!("app/agents/m{f}.py"),
            (0..4)
                .map(|i| {
                    class(&format!("D{f}x{i}"), |s| {
                        let b = if f == 0 && i == 0 { other } else { base };
                        s.wraps.push(wrap(b, WrapKind::Extends));
                        s.traits.push("typeddict".into());
                    })
                })
                .collect(),
        ));
    }
    plain_classes(&mut files);
    repo(files)
}

#[test]
fn a_rule_naming_the_kind_its_role_is_made_of_is_a_tautology() {
    // "TypedDicts extend TypedDict": the base that made them TypedDicts, whichever
    // module it comes from.
    let cs = mined(&typeddicts(
        "pkg:typing_extensions#TypedDict",
        "pkg:python:typing#TypedDict",
    ));
    assert!(
        !has(&cs, |c| matches!(c.rule, Rule::WrappedBy { .. })),
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    // A team's own TypedDict base is a choice, and so is a refinement of the kind.
    let cs = mined(&typeddicts(
        "app/events.py#EventDict",
        "pkg:typing_extensions#TypedDict",
    ));
    assert!(has(&cs, |c| c.rule == extends_rule("app/events.py#EventDict")));
    let enums = RoleSelector {
        package: String::new(),
        dir: "app".into(),
        file: "*".into(),
        entry: "-".into(),
        kind: SymbolKind::Class,
        variety: Some("enum".into()),
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    };
    assert!(!is_tautology(
        &enums,
        &extends_rule("pkg:python:enum#StrEnum")
    ));
    assert!(is_tautology(&enums, &extends_rule("pkg:python:enum#Enum")));
}

#[test]
fn a_value_typed_enum_base_is_about_enums_of_its_value_type() {
    let enum_class = |name: &str, bases: &[&str]| {
        class(name, |s| {
            for b in bases {
                s.wraps.push(wrap(b, WrapKind::Extends));
            }
            s.traits.push("enum".into());
        })
    };
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/enums.py"),
            (0..5)
                .map(|i| enum_class(&format!("E{f}x{i}"), &["pkg:python:enum#StrEnum"]))
                .collect(),
        ));
    }
    files.push(py(
        "app/worker/enums.py",
        vec![
            // Integer enums cannot be `StrEnum`s: not outliers.
            enum_class("Priority", &["pkg:python:enum#IntEnum"]),
            enum_class("Permission", &["pkg:python:enum#IntFlag"]),
            // A plain `Enum` and a `str` mixin could be: outliers.
            enum_class("RetryAction", &["pkg:python:enum#Enum"]),
            enum_class("Mode", &["global#str", "pkg:python:enum#Enum"]),
        ],
    ));
    plain_classes(&mut files);
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule("pkg:python:enum#StrEnum"))
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (
                        c.role.describe(),
                        c.rule.describe(),
                        c.evidence.holders,
                        c.evidence.total
                    ))
                    .collect::<Vec<_>>()
            )
        });
    assert_eq!(outliers(c), ["Mode", "RetryAction"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 42));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["Mode", "RetryAction"]);
}

/// 40 `*Schema` classes extending `schema`, two helpers named for bases of other kinds,
/// a schema on another base and a class on no base, plus plain classes elsewhere.
fn schema_helpers(schema: &str) -> Vec<FileFacts> {
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/schemas/s{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("S{f}x{i}Schema"), |s| {
                        s.wraps.push(wrap(schema, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/schemas/helpers.py",
        vec![
            // Helpers of other kinds, named for their own base.
            class("RequirementsValidator", |s| {
                s.wraps.push(wrap(
                    "pkg:marshmallow#validate.Validator",
                    WrapKind::Extends,
                ));
            }),
            class("ValueField", |s| {
                s.wraps
                    .push(wrap("pkg:marshmallow#fields.Field", WrapKind::Extends));
            }),
            // A schema on another base, and a class on no base: outliers.
            class("LegacySchema", |s| {
                s.wraps
                    .push(wrap("pkg:marshmallow#Schema", WrapKind::Extends));
            }),
            class("Plain", |_| {}),
        ],
    ));
    plain_classes(&mut files);
    files
}

#[test]
fn a_class_named_for_a_base_of_another_kind_is_no_outlier() {
    // The team's schema base is a class of the repo with no package base: everything
    // it extends is known, so `validate.Validator` is certainly not among it.
    let schema = "app/kit.py#ModelSchema";
    let mut files = schema_helpers(schema);
    files.push(py(
        "app/kit.py",
        vec![class("ModelSchema", |s| s.traits.push("base".into()))],
    ));
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(schema))
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (
                        c.role.describe(),
                        c.rule.describe(),
                        c.evidence.holders,
                        c.evidence.total
                    ))
                    .collect::<Vec<_>>()
            )
        });
    assert_eq!(outliers(c), ["LegacySchema", "Plain"]);
    let exempt: Vec<(&str, &str)> = c
        .exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.reason.as_str()))
        .collect();
    assert_eq!(
        exempt,
        [
            (
                "RequirementsValidator",
                "a validator, named for its base validate.Validator"
            ),
            ("ValueField", "a field, named for its base fields.Field"),
        ]
    );
    assert_eq!((c.evidence.total, c.evidence.role_members), (42, Some(44)));
    // A name-suffix rule over these plain classes (no framework lineage) is not
    // proposed since round 8 (W3): the role may mix kinds Drift cannot tell apart.
    assert!(!cs.iter().any(|c| c.rule
        == Rule::Named {
            pattern: "*Schema".into(),
        }));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["LegacySchema", "Plain"]);
}

#[test]
fn a_class_named_for_the_kind_of_a_base_the_team_base_builds_on_is_an_outlier() {
    // The team's `Schema` extends `BaseModel`: a `*Model` on `BaseModel` skipped the
    // team's base, it is not another kind of class.
    let team = "app/kit.py#Schema";
    let mut files = Vec::new();
    for f in 0..6 {
        files.push(py(
            &format!("app/integrations/i{f}/schemas.py"),
            (0..5)
                .map(|i| {
                    class(&format!("I{f}x{i}"), |s| {
                        s.wraps.push(wrap(team, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/integrations/plain/schemas.py",
        vec![class("PayloadModel", |s| {
            s.wraps
                .push(wrap("pkg:pydantic#BaseModel", WrapKind::Extends));
        })],
    ));
    files.push(py(
        "app/kit.py",
        vec![class("Schema", |s| {
            s.wraps
                .push(wrap("pkg:pydantic#BaseModel", WrapKind::Extends));
            s.traits.push("base".into());
        })],
    ));
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(team))
        .expect("integration schemas extend Schema");
    assert_eq!(outliers(c), ["PayloadModel"]);
}

/// Table classes in five modules calling `Column()`, plus the classes `extra` adds.
fn tables(extra: Vec<Symbol>) -> RepoFacts {
    let column = "pkg:django_tables2#Column";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/tables/t{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("T{f}x{i}Table"), |s| {
                        s.calls.push(column.into());
                        s.args.push(format!("{column}@99:verbose_name"));
                    })
                })
                .collect(),
        ));
    }
    files.push(py("app/tables/extra.py", extra));
    plain_classes(&mut files);
    repo(files)
}

#[test]
fn passing_a_key_to_a_callee_is_about_calls_to_it() {
    let column = "pkg:django_tables2#Column";
    let r = tables(vec![
        // Calls no `Column()`: nothing to pass `verbose_name` to.
        class("AnnotatedTable", |s| {
            s.calls.push("pkg:django_tables2#TemplateColumn".into());
            s.args
                .push("pkg:django_tables2#TemplateColumn@99:verbose_name".into());
        }),
        // Calls it without the key: an outlier.
        class("BareTable", |s| s.calls.push(column.into())),
    ]);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::PassesKey { key, .. } if key == "verbose_name"))
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter()
                    .map(|c| (
                        c.role.describe(),
                        c.rule.describe(),
                        c.evidence.holders,
                        c.evidence.total
                    ))
                    .collect::<Vec<_>>()
            )
        });
    assert_eq!(outliers(c), ["BareTable"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 41));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["BareTable"]);
}

#[test]
fn a_key_most_holders_leave_out_on_other_calls_is_optional() {
    let fieldset = "app/rendering.py#FieldSet";
    let forms = |optional: bool| {
        let mut files = Vec::new();
        for f in 0..5 {
            files.push(py(
                &format!("app/forms/f{f}.py"),
                (0..6)
                    .map(|i| {
                        class(&format!("F{f}x{i}Form"), |s| {
                            s.calls.push(fieldset.into());
                            // The first fieldset of every form has no name, the others do.
                            if f + i > 0 {
                                s.args.push(format!("{fieldset}@99:name"));
                                if optional {
                                    s.omits.push(format!("{fieldset}@99:name"));
                                }
                            }
                        })
                    })
                    .collect(),
            ));
        }
        plain_classes(&mut files);
        repo(files)
    };
    let names = |r: &RepoFacts| {
        has(
            &mined(r),
            |c| matches!(&c.rule, Rule::PassesKey { key, .. } if key == "name"),
        )
    };
    assert!(!names(&forms(true)));
    // A key passed on every call is a convention, as before.
    assert!(names(&forms(false)));
}

#[test]
fn call_order_is_a_rule_for_functions_not_class_bodies() {
    let (first, then) = ("app/auth.py#authenticate", "app/db.py#query");
    let with_order = |s: &mut Symbol, i: usize| {
        s.calls = vec![first.into(), then.into()];
        s.order = if i == 0 {
            vec![then.into(), first.into()]
        } else {
            vec![first.into(), then.into()]
        };
    };
    let mut files = Vec::new();
    for f in 0..5 {
        files.push(py(
            &format!("app/handlers/h{f}.py"),
            (0..5)
                .map(|i| {
                    sym(&format!("h{f}x{i}"), SymbolKind::Function, |s| {
                        with_order(s, f + i)
                    })
                })
                .collect(),
        ));
        files.push(py(
            &format!("app/forms/f{f}.py"),
            (0..5)
                .map(|i| class(&format!("F{f}x{i}"), |s| with_order(s, f + i)))
                .collect(),
        ));
    }
    for i in 0..30 {
        files.push(py(
            &format!("other/o{i}.py"),
            vec![
                sym(&format!("o{i}"), SymbolKind::Function, |_| {}),
                class(&format!("O{i}"), |_| {}),
            ],
        ));
    }
    let cs = mined(&repo(files));
    let before: Vec<SymbolKind> = cs
        .iter()
        .filter(|c| matches!(c.rule, Rule::Before { .. }))
        .map(|c| c.role.kind)
        .collect();
    // Python call order is never proposed since round 6 (`hidden_python_family`); class
    // bodies never had one. Without the hide this read `[SymbolKind::Function]`.
    assert_eq!(before, []);
}

#[test]
fn a_class_has_the_attributes_its_bases_declare_but_not_their_method_calls() {
    let field = "pkg:strawberry_django#filter_field";
    let filters = |base_declares: bool| {
        let mut files = Vec::new();
        for f in 0..8 {
            files.push(py(
                &format!("app/m{f}/filters.py"),
                (0..5)
                    .map(|i| {
                        class(&format!("F{f}x{i}Filter"), |s| {
                            if f == 0 && i < 3 {
                                // `pass` bodies on the team's base.
                                s.wraps
                                    .push(wrap("app/base.py#BaseFilter", WrapKind::Extends));
                            } else {
                                s.calls.push(field.into());
                                s.declares.push(format!("id={field}"));
                            }
                        })
                    })
                    .collect(),
            ));
        }
        files.push(py(
            "app/base.py",
            vec![class("BaseFilter", |s| {
                s.calls.push(field.into());
                if base_declares {
                    s.declares.push(format!("id={field}"));
                }
                s.traits.push("base".into());
            })],
        ));
        plain_classes(&mut files);
        repo(files)
    };
    let calls_field = |r: &RepoFacts| {
        has(
            &mined(r),
            |c| matches!(&c.rule, Rule::Calls { callee } if callee == field),
        )
    };
    // The base declares the fields: every filter has them, nothing to check.
    assert!(!calls_field(&filters(true)));
    // The base only calls it in a method, which a subclass may be meant to override:
    // the `pass` bodies stay outliers.
    let r = filters(false);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Calls { callee } if callee == field))
        .expect("filters call filter_field()");
    assert_eq!(outliers(c), ["F0x0Filter", "F0x1Filter", "F0x2Filter"]);
}

#[test]
fn a_misnamed_class_on_the_holders_base_breaks_the_naming_rule() {
    // Review probe (#27): 40 `*Schema(BaseModel)` classes, a `Plain` and a no-base
    // `LegacySchema`; after accepting, `OrderModel(BaseModel)` is as misnamed as
    // `OrderThing(BaseModel)`.
    let model = "pkg:pydantic#BaseModel";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/schemas/s{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("S{f}x{i}Schema"), |s| {
                        s.wraps.push(wrap(model, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/schemas/plain.py",
        vec![class("Plain", |_| {}), class("LegacySchema", |_| {})],
    ));
    plain_classes(&mut files);
    let r = repo(files.clone());
    let cs = mined(&r);
    // Since round 8 (W3) a naming rule over plain Python classes is not proposed; the
    // base-class rule still is, and still holds the new classes to it.
    assert!(!cs.iter().any(|c| c.rule
        == Rule::Named {
            pattern: "*Schema".into(),
        }));
    let base = cs
        .iter()
        .find(|c| c.rule == extends_rule(model))
        .expect("schemas extend BaseModel")
        .id
        .clone();
    let p = accept_all(&r, &cs);
    files.push(py(
        "app/schemas/new.py",
        vec![
            class("OrderModel", |s| {
                s.wraps.push(wrap(model, WrapKind::Extends))
            }),
            class("OrderThing", |_| {}),
        ],
    ));
    let after = repo(files);
    assert_eq!(
        violators_of(&after, &p, &base),
        ["LegacySchema", "OrderThing", "Plain"]
    );
}

#[test]
fn a_class_of_another_kind_is_no_outlier_even_when_the_targets_ancestry_is_unknown() {
    // The schema base comes from a package (CTFd's `ma.ModelSchema`, django-ninja's
    // `Schema`): what it extends is not in the facts. A validator and a field share
    // nothing with the schemas' line and are named for no kind of theirs: classes of
    // another kind (F3, dev v3 error analysis). A `*Schema` on the library's `Schema`
    // is a schema that skipped the base, and a class on no base is an outlier too.
    for schema in [
        "pkg:flask_marshmallow#Schema",
        "app/models.py#ma.ModelSchema",
    ] {
        let r = repo(schema_helpers(schema));
        let cs = mined(&r);
        let c = cs
            .iter()
            .find(|c| c.rule == extends_rule(schema))
            .expect("schemas extend the base");
        assert_eq!(outliers(c), ["LegacySchema", "Plain"], "{schema}");
        let exempt: Vec<(&str, &str)> = c
            .exempt
            .iter()
            .map(|e| (e.symbol.as_str(), e.reason.as_str()))
            .collect();
        assert_eq!(
            exempt,
            [
                (
                    "RequirementsValidator",
                    "another kind of class (extends validate.Validator)"
                ),
                ("ValueField", "another kind of class (extends fields.Field)"),
            ],
            "{schema}"
        );
        let p = accept_all(&r, &cs);
        assert_eq!(violators_of(&r, &p, &c.id), ["LegacySchema", "Plain"]);
    }
}

#[test]
fn a_misnamed_class_skipping_a_package_team_base_is_reported() {
    // Review probe (#27): 40 `Item…(Schema)` with `from ninja import Schema` and varied
    // names, a `Plain`; after accepting, `OrderModel(BaseModel)` and
    // `OrderThing(BaseModel)` are both reported.
    let schema = "pkg:ninja#Schema";
    let model = "pkg:pydantic#BaseModel";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/schemas/s{f}.py"),
            ["In", "Out", "Create", "Update", "Patch"]
                .iter()
                .map(|k| {
                    class(&format!("Item{f}{k}"), |s| {
                        s.wraps.push(wrap(schema, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py("app/schemas/plain.py", vec![class("Plain", |_| {})]));
    plain_classes(&mut files);
    let r = repo(files.clone());
    let cs = mined(&r);
    let id = cs
        .iter()
        .find(|c| c.rule == extends_rule(schema))
        .expect("schemas extend Schema")
        .id
        .clone();
    let p = accept_all(&r, &cs);
    files.push(py(
        "app/schemas/new.py",
        vec![
            class("OrderModel", |s| {
                s.wraps.push(wrap(model, WrapKind::Extends))
            }),
            class("OrderThing", |s| {
                s.wraps.push(wrap(model, WrapKind::Extends))
            }),
        ],
    ));
    let after = repo(files);
    assert_eq!(
        violators_of(&after, &p, &id),
        ["OrderModel", "OrderThing", "Plain"]
    );
}

#[test]
fn a_single_file_scan_without_the_targets_class_needs_a_full_scan() {
    // A helper named for its base of another kind under an accepted "extend
    // ModelSchema" rule: whether it is exempt depends on `ModelSchema`'s ancestry,
    // which a hook's single-file facts (no `app/kit.py`) do not have.
    let schema = "app/kit.py#ModelSchema";
    let mut files = schema_helpers(schema);
    files.push(py(
        "app/kit.py",
        vec![class("ModelSchema", |s| s.traits.push("base".into()))],
    ));
    let r = repo(files.clone());
    let p = accept_all(&r, &mined(&r));
    let helper = py(
        "app/schemas/more.py",
        vec![class("ExtraField", |s| {
            s.wraps
                .push(wrap("pkg:marshmallow#fields.Field", WrapKind::Extends));
        })],
    );
    let alone = repo(vec![helper.clone()]);
    assert!(drift_mine::check::needs_full_scan(&alone, &p));
    // With the target's file there (a full scan), nothing is undecided.
    files.push(helper);
    assert!(!drift_mine::check::needs_full_scan(&repo(files), &p));
    // A plain new schema decides nothing either way.
    let plain = repo(vec![py(
        "app/schemas/more.py",
        vec![class("MoreSchema", |s| {
            s.wraps.push(wrap(schema, WrapKind::Extends))
        })],
    )]);
    assert!(!drift_mine::check::needs_full_scan(&plain, &p));
}

#[test]
fn a_class_outside_the_rules_role_needs_no_full_scan() {
    // Review probe (#27): `DeviceSerializer(BaseSerializer)` is named for its own base,
    // a kind other than the accepted "extend ModelSchema" rule's, and the hook's
    // single-file facts lack the target's class. The rule is not checked outside its
    // role, so whether it would exempt the class does not matter: no full scan.
    let schema = "app/kit.py#ModelSchema";
    let mut files = schema_helpers(schema);
    files.push(py(
        "app/kit.py",
        vec![class("ModelSchema", |s| s.traits.push("base".into()))],
    ));
    let r = repo(files.clone());
    let cs = mined(&r);
    let id = cs
        .iter()
        .find(|c| c.rule == extends_rule(schema))
        .expect("schemas extend ModelSchema")
        .id
        .clone();
    let p = accept_all(&r, &cs);
    let serializer = py(
        "other/serializers.py",
        vec![class("DeviceSerializer", |s| {
            s.wraps.push(wrap(
                "pkg:rest_framework#serializers.BaseSerializer",
                WrapKind::Extends,
            ));
        })],
    );
    assert!(!drift_mine::check::needs_full_scan(
        &repo(vec![serializer.clone()]),
        &p
    ));
    // The same class in the rule's role still sends the hook to a full scan.
    let mut in_role = serializer.clone();
    in_role.path = "app/schemas/serializers.py".into();
    assert!(drift_mine::check::needs_full_scan(
        &repo(vec![in_role.clone()]),
        &p
    ));
    // And the hook's answer (the single-file check) and a full check agree: the
    // serializer outside the role is no violator, the one inside it is exempt.
    let alone = violators_of(&repo(vec![serializer.clone()]), &p, &id);
    files.push(serializer);
    files.push(in_role);
    let full = violators_of(&repo(files), &p, &id);
    assert!(!alone.iter().any(|v| v == "DeviceSerializer"), "{alone:?}");
    assert!(!full.iter().any(|v| v == "DeviceSerializer"), "{full:?}");
}

#[test]
fn a_subclass_that_reassigns_an_attribute_does_not_inherit_its_calls() {
    // Review probe (#27): `BaseForm.fieldsets = (FieldSet(...),)`; 37 forms call
    // `FieldSet` themselves, 3 inherit `fieldsets` with `pass`, and `PlainForm` has
    // none. After accepting, `SiteForm(BaseForm)` and `RackForm` replace `fieldsets`
    // with plain tuples: both break the rule.
    let fieldset = "app/forms/rendering.py#FieldSet";
    let base = "app/forms/base.py#BaseForm";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/forms/f{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("F{f}{i}Form"), |s| {
                        if f == 0 && i < 3 {
                            s.wraps.push(wrap(base, WrapKind::Extends));
                        } else {
                            s.calls.push(fieldset.into());
                            s.declares.push("fieldsets=".into());
                            s.declares.push(format!("fieldsets={fieldset}"));
                        }
                    })
                })
                .collect(),
        ));
    }
    files.push(py("app/forms/plain.py", vec![class("PlainForm", |_| {})]));
    files.push(py(
        "app/forms/base.py",
        vec![class("BaseForm", |s| {
            s.calls.push(fieldset.into());
            s.declares.push("fieldsets=".into());
            s.declares.push(format!("fieldsets={fieldset}"));
            s.traits.push("base".into());
        })],
    ));
    plain_classes(&mut files);
    let r = repo(files.clone());
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Calls { callee } if callee == fieldset))
        .expect("forms call FieldSet()");
    assert_eq!(outliers(c), ["PlainForm"]);
    let inherited: Vec<&str> = c.inherited.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(inherited, ["F00Form", "F01Form", "F02Form"]);
    let p = accept_all(&r, &cs);
    files.push(py(
        "app/forms/new.py",
        vec![
            class("SiteForm", |s| {
                s.wraps.push(wrap(base, WrapKind::Extends));
                s.declares.push("fieldsets=".into());
            }),
            class("RackForm", |s| s.declares.push("fieldsets=".into())),
            // Inherits `fieldsets` and adds another attribute: holds.
            class("RoomForm", |s| {
                s.wraps.push(wrap(base, WrapKind::Extends));
                s.declares.push("model=".into());
            }),
        ],
    ));
    assert_eq!(
        violators_of(&repo(files), &p, &c.id),
        ["PlainForm", "RackForm", "SiteForm"]
    );
}

// ---------------------------------------------------------------------------
// TypeScript dev study, round 3: rules that follow a table's key structure (P7).

/// A Drizzle schema file in `pkg`: `keyed` tables with an `id` column, `slug` tables
/// keyed by a `.primaryKey()` text column, `composite` join tables with a composite
/// `primaryKey()`, and `unkeyed` tables with no primary key at all. Every table but
/// the composite ones passes `createdAt`.
fn drizzle_schema(
    pkg: &str,
    keyed: usize,
    slug: usize,
    composite: usize,
    unkeyed: usize,
) -> FileFacts {
    let col = |k: &str| format!("pkg:drizzle-orm/pg-core#pgTable@1:{k}");
    let mut tables = Vec::new();
    let mut table = |name: String, edit: &dyn Fn(&mut Symbol)| {
        tables.push(sym(&name, SymbolKind::Function, |s| {
            s.calls.push("pkg:drizzle-orm/pg-core#pgTable".into());
            edit(s);
        }));
    };
    for i in 0..keyed {
        table(format!("table{i}"), &|s| {
            s.args = vec![col("createdAt"), col("id"), col("name")];
            s.calls
                .push("pkg:drizzle-orm/pg-core#uuid().defaultRandom().primaryKey".into());
        });
    }
    for i in 0..slug {
        table(format!("lookup{i}"), &|s| {
            s.args = vec![col("createdAt"), col("slug")];
            s.calls
                .push("pkg:drizzle-orm/pg-core#text().primaryKey".into());
        });
    }
    for i in 0..composite {
        table(format!("assignment{i}"), &|s| {
            s.args = vec![col("tagId"), col("userId")];
            s.calls.push("pkg:drizzle-orm/pg-core#primaryKey".into());
        });
    }
    for i in 0..unkeyed {
        table(format!("log{i}"), &|s| {
            s.args = vec![col("createdAt"), col("message")];
        });
    }
    file_with(&format!("{pkg}/src/schema.ts"), pkg, tables)
}

fn passes(cs: &[Candidate], pkg: &str, key: &str) -> bool {
    has(cs, |c| {
        c.role.package == pkg && matches!(&c.rule, Rule::PassesKey { key: k, .. } if k == key)
    })
}

// "Tables pass `id`" whose every outlier declares its primary key another way (join
// tables, a lookup keyed by slug) follows the key structure: not proposed. The same
// outliers missing `createdAt` are still outliers, and so is a table with no primary
// key at all missing `id`.
#[test]
fn rules_that_follow_the_key_structure_are_not_proposed() {
    let mut files = vec![
        drizzle_schema("packages/a", 54, 1, 5, 0),
        drizzle_schema("packages/b", 56, 0, 3, 1),
    ];
    // Code that is no table, so the schema files' keys stand out (lift).
    for i in 0..400 {
        files.push(func(&format!("misc/m{i}.ts"), "run", |_| {}));
    }
    let cs = mined(&repo(files));
    assert!(!passes(&cs, "packages/a", "id"), "outliers keyed otherwise");
    assert!(
        passes(&cs, "packages/a", "createdAt"),
        "a column the join tables leave out is still a rule"
    );
    assert!(
        passes(&cs, "packages/b", "id"),
        "a table with no primary key is a real outlier"
    );
}

// ---------------------------------------------------------------------------
// Import source (langchain `D-ede63a`: TypedDicts take `TypedDict` from
// typing_extensions, one from typing). Each test plants the true convention next to a
// shape that must not be proposed.

fn imports_from(cs: &[Candidate]) -> Vec<&Candidate> {
    cs.iter()
        .filter(|c| matches!(c.rule, Rule::ImportsFrom { .. }))
        .collect()
}

#[test]
fn members_take_a_backported_name_from_the_source_most_use() {
    let mut r = typeddicts(
        "pkg:typing_extensions#TypedDict",
        "pkg:python:typing#TypedDict",
    );
    // A subclass of a team TypedDict uses `TypedDict` through its base.
    r.files.push(py(
        "app/agents/state.py",
        vec![
            class("AgentState", |s| {
                s.wraps
                    .push(wrap("pkg:typing_extensions#TypedDict", WrapKind::Extends));
                s.traits.push("typeddict".into());
            }),
            class("PlanState", |s| {
                s.wraps
                    .push(wrap("app/agents/state.py#AgentState", WrapKind::Extends));
                s.traits.push("typeddict".into());
            }),
        ],
    ));
    r.normalize();
    let cs = mined(&r);
    let found = imports_from(&cs);
    assert_eq!(
        found.len(),
        1,
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    let c = found[0];
    assert_eq!(
        c.rule,
        Rule::ImportsFrom {
            name: "TypedDict".into(),
            source: "pkg:typing_extensions#TypedDict".into(),
            instead_of: vec!["pkg:python:typing#TypedDict".into()],
        }
    );
    assert_eq!(
        c.rule.describe(),
        "take `TypedDict` from typing_extensions, not typing"
    );
    assert_eq!(outliers(c), ["D0x0"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (21, 22));
    assert_eq!(c.tier(), drift_mine::tier::Tier::Suggestion);
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["D0x0"]);
}

/// Page functions in eight modules (no file kind: one role, `app/**`, that also
/// holds the team's `app/ui/button.py`); `n_direct` of them call `direct` instead of
/// the team's `button` (which wraps `pkg:tagflow#tag.button`).
fn pages(direct: &str, n_direct: usize) -> RepoFacts {
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/pages{f}.py"),
            (0..5)
                .map(|i| {
                    sym(&format!("e{f}x{i}"), SymbolKind::Function, |s| {
                        let k = f * 5 + i;
                        s.calls = vec![if k < n_direct {
                            direct.into()
                        } else {
                            "app/ui/button.py#button".into()
                        }];
                    })
                })
                .collect(),
        ));
    }
    // The wrapper (it forwards its parameters to `tag.button`), and a helper next to
    // it that uses the library on purpose.
    let library = |s: &mut Symbol| {
        s.calls = vec!["pkg:tagflow#tag.button".into()];
        s.traits = vec!["forwards".into()];
    };
    files.push(py(
        "app/ui/button.py",
        vec![
            sym("button", SymbolKind::Function, library),
            sym("icon_button", SymbolKind::Function, library),
        ],
    ));
    for i in 0..60 {
        files.push(py(
            &format!("other/o{i}.py"),
            vec![sym(&format!("o{i}"), SymbolKind::Function, |_| {})],
        ));
    }
    repo(files)
}

#[test]
fn members_take_the_team_version_of_a_library_name() {
    let r = pages("pkg:tagflow#tag.button", 2);
    let cs = mined(&r);
    let found = imports_from(&cs);
    assert_eq!(
        found.len(),
        1,
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    let c = found[0];
    assert_eq!(
        c.rule.describe(),
        "use the team's `button` (app/ui/button.py), not `tagflow.tag.button`"
    );
    // The module that defines the team's version uses the library by design.
    assert_eq!(c.role.file, "*");
    assert_eq!(outliers(c), ["e0x0", "e0x1"]);
    // The split counts each member once, so it adds up to the evidence.
    assert_eq!(
        c.evidence.split,
        [
            ("app/ui/button.py".to_string(), 38),
            ("tagflow.tag.button".to_string(), 2)
        ]
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (38, 40));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["e0x0", "e0x1"]);
}

/// Functions in eight `app/m*/flow*.py` modules call `name`: the first `n_library` take
/// it from `library`, the others from a same-name function at `team` that calls
/// `library` itself, which `edit` can make an entry point.
fn same_name(
    team: &str,
    library: &str,
    n_library: usize,
    edit: impl FnOnce(&mut FileFacts),
) -> RepoFacts {
    let (path, name) = team.split_once('#').unwrap();
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/flow{f}.py"),
            (0..5)
                .map(|i| {
                    sym(&format!("f{f}x{i}"), SymbolKind::Function, |s| {
                        s.calls = vec![if f * 5 + i < n_library {
                            library.into()
                        } else {
                            team.into()
                        }];
                    })
                })
                .collect(),
        ));
    }
    let mut f = py(
        path,
        vec![sym(name, SymbolKind::Function, |s| {
            s.calls = vec![library.into()];
            s.traits = vec!["forwards".into()];
        })],
    );
    edit(&mut f);
    files.push(f);
    for i in 0..60 {
        files.push(py(
            &format!("other/o{i}.py"),
            vec![sym(&format!("o{i}"), SymbolKind::Function, |_| {})],
        ));
    }
    repo(files)
}

#[test]
fn an_entry_point_or_script_is_no_team_version() {
    // polar's backoffice handler `get` calls `pycountry.countries.get`; a script's
    // `run` calls `asyncio.run`. Neither is the team's version of what it calls, even
    // where most members call it (planted here to isolate the guard).
    let handler = |f: &mut FileFacts| {
        f.entry_points.push(EntryPoint {
            symbol: "get".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/orders/{id}".into()),
            adapter: "fastapi".into(),
        })
    };
    let get = "app/orders/endpoints.py#get";
    let countries = "pkg:pycountry#countries.get";
    assert!(imports_from(&mined(&same_name(get, countries, 2, handler))).is_empty());
    assert_eq!(
        imports_from(&mined(&same_name(get, countries, 2, |_| {}))).len(),
        1,
        "the same function, not routed, is a team version"
    );
    let asyncio = "pkg:python:asyncio#run";
    for script in [
        "scripts/sync.py#run",
        ".claude/skills/audit.py#run",
        "app/manage.py#run",
        "app/core/management/commands/sync.py#run",
    ] {
        assert!(
            imports_from(&mined(&same_name(script, asyncio, 2, |_| {}))).is_empty(),
            "{script}"
        );
    }
    assert_eq!(
        imports_from(&mined(&same_name(
            "app/sync/runner.py#run",
            asyncio,
            2,
            |_| {}
        )))
        .len(),
        1
    );
}

/// The review's counterexample: a Django view `login` calls `auth.login`, 27 flow
/// functions call `auth.login`, one function calls the view. "Take `login` from
/// django.contrib.auth, not the view" is no convention: the view is not a version of
/// `auth.login`.
#[test]
fn a_same_name_caller_of_a_library_function_is_no_team_version() {
    let auth = "pkg:django#contrib.auth.login";
    let accounts = |login_path: &str, per_file: usize, callers: usize| {
        let mut files = Vec::new();
        for f in 1..=9 {
            files.push(py(
                &format!("app/accounts/flow{f}.py"),
                (0..per_file)
                    .map(|i| {
                        sym(&format!("flow{f}x{i}"), SymbolKind::Function, |s| {
                            s.calls = vec![auth.into()];
                        })
                    })
                    .collect(),
            ));
        }
        files.push(py(
            login_path,
            // `auth.login(request, user)` forwards the view's `request`.
            vec![sym("login", SymbolKind::Function, |s| {
                s.calls = vec![auth.into(), "pkg:django#shortcuts.redirect".into()];
                s.traits = vec!["forwards".into()];
            })],
        ));
        for c in 0..callers {
            files.push(py(
                &format!("app/accounts/legacy{c}.py"),
                vec![sym(
                    &format!("legacy_login{c}"),
                    SymbolKind::Function,
                    |s| {
                        s.calls = vec![format!("{login_path}#login")];
                    },
                )],
            ));
        }
        for i in 0..60 {
            files.push(py(
                &format!("other/o{i}.py"),
                vec![sym(&format!("o{i}"), SymbolKind::Function, |_| {})],
            ));
        }
        repo(files)
    };
    // As reviewed: a function in `views.py` called from one file. Since the path
    // exclusion was dropped (Misago's admin `render`), the three-file bound and the
    // majority guard stop it.
    let r = accounts("app/accounts/views.py", 3, 1);
    assert!(imports_from(&mined(&r)).is_empty());
    // A routed view called from three files: no team version (an entry point), and the
    // library is the majority source anyway.
    let mut r = accounts("app/accounts/views.py", 3, 3);
    for f in &mut r.files {
        if f.path == "app/accounts/views.py" {
            f.entry_points.push(EntryPoint {
                symbol: "login".into(),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some("/login".into()),
                adapter: "django".into(),
            });
        }
    }
    r.normalize();
    assert!(imports_from(&mined(&r)).is_empty());
    // Not a view, and called from three files (36/39 would clear the bound): the
    // library is still the majority source, and "use the library, not the team's
    // version" is no rule.
    let r = accounts("app/accounts/auth.py", 4, 3);
    assert!(imports_from(&mined(&r)).is_empty());
}

/// Classes in eight `app/m*/types*.py` modules (30 `ObjectType`s) use the team's
/// `Decimal` scalar; two call `decimal.Decimal` themselves. The scalar (`class
/// Decimal(graphene.Float)`, saleor's `graphql/core/scalars.py`) calls `decimal.Decimal`
/// in a method; `extends_library` makes it extend `decimal.Decimal` instead.
fn scalars(extends_library: bool) -> RepoFacts {
    let decimal = "pkg:python:decimal#Decimal";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/types{f}.py"),
            (0..4)
                .map(|i| {
                    class(&format!("T{f}x{i}"), |s| {
                        s.wraps
                            .push(wrap("pkg:graphene#ObjectType", WrapKind::Extends));
                        s.calls = vec![if f * 4 + i < 2 {
                            decimal.into()
                        } else {
                            "app/scalars.py#Decimal".into()
                        }];
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/scalars.py",
        vec![class("Decimal", |s| {
            let base = if extends_library {
                decimal
            } else {
                "pkg:graphene#Float"
            };
            s.wraps.push(wrap(base, WrapKind::Extends));
            s.calls = vec![decimal.into()];
        })],
    ));
    for i in 0..60 {
        files.push(py(
            &format!("other/o{i}.py"),
            vec![class(&format!("O{i}"), |_| {})],
        ));
    }
    repo(files)
}

/// The re-check's counterexamples: a shared helper most members use, that calls a
/// library name of its own name without standing in for it. A GraphQL scalar is no
/// decimal (it does not extend `decimal.Decimal`); a `load()` that reads one settings
/// file cannot replace `json.load(fp)` (it forwards no parameter to it).
#[test]
fn a_helper_that_only_calls_its_namesake_is_no_team_version() {
    assert!(imports_from(&mined(&scalars(false))).is_empty());
    assert_eq!(
        imports_from(&mined(&scalars(true))).len(),
        1,
        "a class that extends the library class is its team version"
    );
    let load = |forwards: bool| {
        let mut r = same_name("app/config.py#load", "pkg:python:json#load", 3, |_| {});
        for f in &mut r.files {
            if f.path == "app/config.py" {
                f.symbols[0].traits = if forwards {
                    vec!["forwards".into()]
                } else {
                    vec![]
                };
                f.symbols[0].calls.push("pkg:python:builtins#open".into());
            }
        }
        r.normalize();
        r
    };
    assert!(imports_from(&mined(&load(false))).is_empty());
    assert_eq!(
        imports_from(&mined(&load(true))).len(),
        1,
        "a load(fp) that passes its own argument to json.load is its team version"
    );
}

#[test]
fn the_same_name_from_unrelated_modules_is_no_import_source() {
    // `tagflow.text` (HTML text) and `sqlalchemy.text` (SQL) share a name only.
    let mut r = pages("pkg:tagflow#tag.button", 0);
    for f in &mut r.files {
        for (i, s) in f.symbols.iter_mut().enumerate() {
            if f.path.contains("/pages") {
                s.calls = vec![if i == 0 {
                    "pkg:sqlalchemy#text".into()
                } else {
                    "pkg:tagflow#text".into()
                }];
            }
        }
    }
    r.normalize();
    assert!(imports_from(&mined(&r)).is_empty());
    // A library name two shared team helpers wrap has no one team version.
    let r = pages("pkg:tagflow#tag.button", 2);
    let mut r2 = r.clone();
    r2.files.push(py(
        "app/widgets/button.py",
        vec![sym("button", SymbolKind::Function, |s| {
            s.calls = vec!["pkg:tagflow#tag.button".into()];
            s.traits = vec!["forwards".into()];
        })],
    ));
    for i in 0..3 {
        r2.files.push(py(
            &format!("app/w{i}/widget{i}.py"),
            vec![sym(&format!("w{i}"), SymbolKind::Function, |s| {
                s.calls = vec!["app/widgets/button.py#button".into()];
            })],
        ));
    }
    r2.normalize();
    assert_eq!(imports_from(&mined(&r)).len(), 1);
    assert!(imports_from(&mined(&r2)).is_empty());
}

// ---------------------------------------------------------------------------
// TypeScript dev study, round 4: facts that tell kinds of code apart (handlers that
// read input, class field decorators, in-file component parts, folders of a kind).

/// Plain functions, classes and components elsewhere, so a role's facts stand out (lift).
fn background(files: &mut Vec<FileFacts>) {
    for i in 0..200 {
        files.push(file_with(
            &format!("misc/m{i}.ts"),
            "misc",
            vec![
                sym("run", SymbolKind::Function, |_| {}),
                sym(&format!("Thing{i}"), SymbolKind::Class, |_| {}),
                sym(&format!("View{i}"), SymbolKind::Component, |_| {}),
            ],
        ));
    }
}

/// The scenario packages below: each is its own role, so they do not nest.
fn in_package(mut files: Vec<FileFacts>, package: &str) -> Vec<FileFacts> {
    for f in &mut files {
        f.path = format!("{package}/{}", f.path);
        f.package = package.into();
    }
    files
}

/// `n` rpc handlers in `dir`, each under `guard`; `edit(i, symbol)` sets the rest.
fn rpc_handlers(dir: &str, n: usize, edit: impl Fn(usize, &mut Symbol)) -> Vec<FileFacts> {
    (0..n)
        .map(|i| {
            let name = format!("proc{i}");
            let mut f = file_with(
                &format!("{dir}/p{i}.ts"),
                "",
                vec![sym(&name, SymbolKind::Function, |s| {
                    s.wraps.push(wrap("src/trpc.ts#guarded", WrapKind::Call));
                    edit(i, s);
                })],
            );
            f.entry_points = vec![entry(&name, "rpc", Some(&name))];
            f
        })
        .collect()
}

fn validates(cs: &[Candidate], package: &str) -> bool {
    has(cs, |c| {
        c.role.package == package
            && matches!(&c.rule, Rule::Control { value } if value == "validates")
    })
}

// "Handlers validate their input" whose every outlier provably reads no input (a
// query working from the session only: `no_input`) follows the input: not proposed.
// An outlier that reads its input without validating it is still one, and so is one
// Drift cannot tell about (no input fact: a request handed to a helper). A guard
// every handler needs is no rule about input, whatever its outliers read.
#[test]
fn rules_that_follow_handler_input_are_not_proposed() {
    let reads = |s: &mut Symbol| s.controls.push("reads_input".into());
    let none = |s: &mut Symbol| s.controls.push("no_input".into());
    let validated = |s: &mut Symbol| {
        s.controls.push("validates".into());
        s.controls.push("reads_input".into());
    };
    let mut files = in_package(
        rpc_handlers(
            "src",
            40,
            |i, s| if i >= 3 { validated(s) } else { none(s) },
        ),
        "a",
    );
    files.extend(in_package(
        rpc_handlers("src", 40, |i, s| match i {
            0 => reads(s),
            1 | 2 => none(s),
            _ => validated(s),
        }),
        "b",
    ));
    files.extend(in_package(
        rpc_handlers("src", 40, |i, s| match i {
            0 => {}
            1 | 2 => none(s),
            _ => validated(s),
        }),
        "u",
    ));
    files.extend(in_package(
        rpc_handlers("src", 40, |i, s| {
            if i < 3 {
                s.wraps.clear();
                none(s);
            } else {
                reads(s);
            }
        }),
        "c",
    ));
    background(&mut files);
    let cs = mined(&repo(files));
    assert!(!validates(&cs, "a"), "outliers take no input");
    assert!(validates(&cs, "b"), "an outlier reads unvalidated input");
    assert!(validates(&cs, "u"), "an outlier that may read input");
    assert!(
        has(&cs, |c| c.role.package == "c"
            && matches!(&c.rule, Rule::WrappedBy { any_of, .. } if any_of == &["src/trpc.ts#guarded".to_string()])),
        "a guard is not conditional on input"
    );
}

/// A `.dto.ts` class in `dir`, decorated with `class_deco` and fields from `fields`.
fn dto(dir: &str, name: &str, class_deco: &[&str], fields: &[&str]) -> FileFacts {
    file_with(
        &format!("{dir}/{name}.dto.ts"),
        "",
        vec![sym(name, SymbolKind::Class, |s| {
            for d in class_deco {
                s.wraps.push(wrap(d, WrapKind::Decorator));
            }
            s.field_decorators = fields.iter().map(|f| (*f).to_string()).collect();
        })],
    )
}

const OBJECT_TYPE: &str = "pkg:@nestjs/graphql#ObjectType";
const INPUT_TYPE: &str = "pkg:@nestjs/graphql#InputType";
const FIELD: &str = "pkg:@nestjs/graphql#Field";
const IS_UUID: &str = "pkg:class-validator#IsUUID";

fn decorated(cs: &[Candidate], package: &str, d: &str) -> bool {
    has(cs, |c| {
        c.role.package == package
            && matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Decorator, any_of } if any_of == &[d.to_string()])
    })
}

// "DTOs are decorated with `@ObjectType()`" whose outliers are REST bodies (fields
// validated by class-validator only) and a GraphQL `@InputType()` describes the
// GraphQL output types: not proposed. A GraphQL type that forgot `@ObjectType()` (it
// has `@Field()`s) and a class with no decorated fields are still outliers.
#[test]
fn outliers_of_another_kind_of_class_are_not_outliers() {
    let mut files = Vec::new();
    for (package, odd) in [("a", 0), ("b", 1), ("c", 2)] {
        let mut group: Vec<FileFacts> = Vec::new();
        let dir = "src";
        for i in 0..40 {
            group.push(dto(
                dir,
                &format!("Out{i}"),
                &[OBJECT_TYPE],
                // Some GraphQL types validate their fields too.
                if i % 5 == 0 {
                    &[FIELD, IS_UUID]
                } else {
                    &[FIELD]
                },
            ));
        }
        match odd {
            0 => {
                group.push(dto(dir, "GetDto", &[], &[IS_UUID]));
                group.push(dto(dir, "ListDto", &[], &[IS_UUID]));
                group.push(dto(dir, "SomeInput", &[INPUT_TYPE], &[FIELD]));
            }
            1 => {
                group.push(dto(dir, "GetDto", &[], &[IS_UUID]));
                group.push(dto(dir, "Forgot", &[], &[FIELD]));
            }
            _ => {
                group.push(dto(dir, "GetDto", &[], &[IS_UUID]));
                group.push(dto(dir, "Bare", &[], &[]));
            }
        }
        files.extend(in_package(group, package));
    }
    background(&mut files);
    let cs = mined(&repo(files));
    assert!(
        !decorated(&cs, "a", OBJECT_TYPE),
        "REST bodies and an input type"
    );
    assert!(
        decorated(&cs, "b", OBJECT_TYPE),
        "a GraphQL type without it"
    );
    assert!(
        decorated(&cs, "c", OBJECT_TYPE),
        "a class with no decorated fields"
    );
}

/// `n` services in `dir/<folder>`, extending `base` when `holds`.
fn services(dir: &str, folder: &str, n: usize, holds: bool) -> Vec<FileFacts> {
    (0..n)
        .map(|i| {
            file_with(
                &format!("{dir}/{folder}/s{i}.service.ts"),
                "",
                vec![sym(&format!("{folder}S{i}"), SymbolKind::Class, |s| {
                    if holds {
                        s.wraps
                            .push(wrap("src/base.ts#ActionHandler", WrapKind::Extends));
                    }
                })],
            )
        })
        .collect()
}

fn extends(cs: &[Candidate], package: &str) -> bool {
    has(cs, |c| {
        c.role.package == package
            && matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Extends, any_of } if any_of == &["src/base.ts#ActionHandler".to_string()])
    })
}

// Outliers in sibling folders with no holder are still outliers. Round 4 tried
// treating such a rule as the folder's (twenty's action handlers next to their
// `registry/` and `services/`), but the review of PR #37 showed the shape is also two
// new modules that each skipped the convention: 120 holders in `handlers/`, one
// lapsed service each in `billing/` and `search/`. Both keep the rule.
#[test]
fn outliers_in_sibling_folders_are_outliers() {
    let mut lapses = services("src", "handlers", 120, true);
    lapses.extend(services("src", "billing", 1, false));
    lapses.extend(services("src", "search", 1, false));
    let mut kinds = services("src", "handlers", 60, true);
    kinds.extend(services("src", "registry", 2, false));
    kinds.extend(services("src", "runner", 3, false));
    let mut files = in_package(lapses, "a");
    files.extend(in_package(kinds, "b"));
    background(&mut files);
    let cs = mined(&repo(files));
    assert!(extends(&cs, "a"), "two modules that each skipped it");
    assert!(extends(&cs, "b"), "folders of another kind look the same");
}

// A page split into in-file parts renders what its parts render: `Page` rendering a
// local `Index` that renders `<Layout>` holds "pages render <Layout>". An exported
// component of the same file is a unit of its own and is not followed.
#[test]
fn pages_render_what_their_in_file_parts_render() {
    let layout = "src/layout.tsx#Layout";
    let mut files = Vec::new();
    for i in 0..30 {
        let path = format!("pages/p{i}.tsx");
        let mut page = sym(&format!("Page{i}"), SymbolKind::Component, |_| {});
        let mut part = sym("Index", SymbolKind::Component, |s| s.exported_as.clear());
        match i {
            0 => page.renders.push(format!("{path}#Index")),
            1 => {
                page.renders.push(format!("{path}#Exported"));
                part = sym("Exported", SymbolKind::Component, |_| {});
            }
            _ => page.renders.push(layout.into()),
        }
        part.renders.push(layout.into());
        files.push(file_with(&path, "", vec![page, part]));
    }
    background(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Renders { component } if component == layout))
        .expect("pages render <Layout>");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    assert!(!outliers.contains(&"pages/p0.tsx"), "{outliers:?}");
    assert!(outliers.contains(&"pages/p1.tsx"), "{outliers:?}");
}

// TypeScript dev study under rubric v3: F6 (an outlier on a sibling wrapper) and F9
// (framework root files).

/// 30 members in `pkg/src/app/**`, each wrapped (`kind`) by one of `targets` in turn;
/// `odd` wrapped by `sibling` and `bare` by nothing; `users` functions in
/// `pkg/lib/admin/**` wrapped by `sibling` too.
fn sibling_scenario(
    pkg: &str,
    kind: WrapKind,
    targets: &[&str],
    sibling: &str,
    users: usize,
) -> Vec<FileFacts> {
    sibling_scenario_with(pkg, kind, targets, sibling, users, 1, false)
}

/// [`sibling_scenario`] with `odd_n` outliers on the sibling (`odd`, `odd1`, ...) and,
/// when `entry`, every member an rpc entry point.
fn sibling_scenario_with(
    pkg: &str,
    kind: WrapKind,
    targets: &[&str],
    sibling: &str,
    users: usize,
    odd_n: usize,
    entry_points: bool,
) -> Vec<FileFacts> {
    let member = |path: String, name: String, wrapper: Option<&str>| {
        let mut f = func(&path, &name, |s| {
            if let Some(w) = wrapper {
                s.wraps.push(wrap(&format!("{pkg}/{w}"), kind));
            }
        });
        if entry_points {
            f.entry_points = vec![entry(&name, "rpc", Some(&name))];
        }
        f
    };
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            member(
                format!("src/app/a{i}.ts"),
                format!("h{i}"),
                Some(targets[i % targets.len()]),
            )
        })
        .collect();
    for i in 0..odd_n {
        let name = if i == 0 {
            "odd".to_string()
        } else {
            format!("odd{i}")
        };
        files.push(member(format!("src/app/{name}.ts"), name, Some(sibling)));
    }
    files.push(member("src/app/bare.ts".into(), "bare".into(), None));
    for i in 0..users {
        files.push(func(
            &format!("lib/admin/b{i}.ts"),
            &format!("admin{i}"),
            |s| {
                s.wraps.push(wrap(&format!("{pkg}/{sibling}"), kind));
            },
        ));
    }
    in_package(files, pkg)
}

fn wrapper_rule_in<'c>(cs: &'c [Candidate], pkg: &str, target: &str) -> &'c Candidate {
    cs.iter()
        .find(|c| {
            c.role.package == pkg
                && (c.role.dir == "src" || c.role.dir == "src/app")
                && matches!(&c.rule, Rule::WrappedBy { any_of, .. }
                    if any_of.iter().any(|a| a == &format!("{pkg}/{target}")))
        })
        .unwrap_or_else(|| {
            panic!(
                "{pkg}: {:?}",
                cs.iter()
                    .filter(|c| c.role.package == pkg)
                    .map(|c| (c.role.describe(), c.rule.describe()))
                    .collect::<Vec<_>>()
            )
        })
}

fn any_of(c: &Candidate) -> Vec<&str> {
    match &c.rule {
        Rule::WrappedBy { any_of, .. } => any_of.iter().map(String::as_str).collect(),
        _ => vec![],
    }
}

// F6: an outlier decorated with a sibling of the rule's decorator (defined in the same
// directory, used by other code, no weaker on security) follows the rule another way:
// the sibling joins the rule's set, as `check` enforces it. It does not join when only
// outliers use it (one, or two that would count as each other's user), when it is
// defined elsewhere, when it is the bare builder a target is built from, when names
// that state no strength meet on entry points, or when either says who may pass
// (`AdminResolver`, `ajax_required` next to `admin_required`).
#[test]
fn an_outlier_on_a_sibling_wrapper_follows_the_rule() {
    const META: &str = "src/decorators/metadata-resolver.decorator.ts#MetadataResolver";
    const CORE: &str = "src/decorators/core-resolver.decorator.ts#CoreResolver";
    const ADMIN: &str = "src/decorators/admin-resolver.decorator.ts#AdminResolver";
    const BARE: &str = "src/decorators/resolver.decorator.ts#Resolver";
    const ELSEWHERE: &str = "src/kit/core-resolver.ts#CoreResolver";
    const DECO: WrapKind = WrapKind::Decorator;
    let mut files = sibling_scenario("joins", DECO, &[META], CORE, 3);
    files.extend(sibling_scenario("alone", DECO, &[META], CORE, 0));
    files.extend(sibling_scenario_with(
        "twice",
        DECO,
        &[META],
        CORE,
        0,
        2,
        false,
    ));
    files.extend(sibling_scenario("apart", DECO, &[META], ELSEWHERE, 3));
    files.extend(sibling_scenario("admin", DECO, &[META], ADMIN, 3));
    files.extend(sibling_scenario("base", DECO, &[META], BARE, 3));
    files.extend(sibling_scenario_with(
        "entry",
        DECO,
        &[META],
        CORE,
        3,
        1,
        true,
    ));
    files.extend(sibling_scenario(
        "required",
        DECO,
        &["app/decorators.ts#admin_required"],
        "app/decorators.ts#ajax_required",
        3,
    ));
    // A call wrapper of the procedures' module, the variant-set shape (midday, whose
    // `publicProcedure` no auth set keeps since #60): only the outlier uses
    // `protectedOrInternalProcedure`, so it stays one.
    files.extend(sibling_scenario(
        "procs",
        WrapKind::Call,
        &[
            "src/trpc/init.ts#protectedProcedure",
            "src/trpc/init.ts#adminProcedure",
        ],
        "src/trpc/init.ts#protectedOrInternalProcedure",
        0,
    ));
    background(&mut files);
    let r = repo(files);
    let cs = mined(&r);

    let c = wrapper_rule_in(&cs, "joins", META);
    assert_eq!(
        any_of(c),
        [format!("joins/{CORE}"), format!("joins/{META}")]
    );
    assert_eq!(outliers(c), ["bare"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (31, 32));
    assert_eq!(
        c.evidence.split,
        [(format!("joins/{META}"), 30), (format!("joins/{CORE}"), 1)]
    );
    assert_eq!(
        c.rule.describe(),
        "are decorated with CoreResolver() or MetadataResolver()"
    );
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["bare"]);

    for pkg in ["alone", "apart", "admin", "base", "entry"] {
        let c = wrapper_rule_in(&cs, pkg, META);
        assert_eq!(any_of(c), [format!("{pkg}/{META}")], "{pkg}");
        assert_eq!(outliers(c), ["bare", "odd"], "{pkg}");
    }
    let c = wrapper_rule_in(&cs, "twice", META);
    assert_eq!(any_of(c), [format!("twice/{META}")]);
    assert_eq!(outliers(c), ["bare", "odd", "odd1"]);
    let c = wrapper_rule_in(&cs, "required", "app/decorators.ts#admin_required");
    assert_eq!(any_of(c).len(), 1);
    assert_eq!(outliers(c), ["bare", "odd"]);
    let c = wrapper_rule_in(&cs, "procs", "src/trpc/init.ts#protectedProcedure");
    assert_eq!(any_of(c).len(), 2);
    assert_eq!(outliers(c), ["bare", "odd"]);
}

// F6's security guard: a sibling whose name states another auth strength than the
// rule's targets never joins its set, however established. `procedure` and
// `maybeAuthenticatedProcedure` next to `authenticatedProcedure` (documenso) stay
// outliers to review; so does `withSession` next to `withWorkspace` (dub: it skips the
// membership checks, which no name ranks). A sibling of the same strength
// (`protectedProcedure`) joins. A set of `authenticatedProcedure` and the bare
// `procedure` no longer holds `procedure` at all (#60), so nothing joins through it.
#[test]
fn a_sibling_weaker_on_security_never_joins_the_rule() {
    const AUTHED: &str = "src/trpc.ts#authenticatedProcedure";
    let mut files = Vec::new();
    for (pkg, targets, sibling) in [
        ("bare", &[AUTHED][..], "src/trpc.ts#procedure"),
        (
            "maybe",
            &[AUTHED][..],
            "src/trpc.ts#maybeAuthenticatedProcedure",
        ),
        (
            "mixed",
            &[AUTHED, AUTHED, AUTHED, "src/trpc.ts#procedure"][..],
            "src/trpc.ts#maybeAuthenticatedProcedure",
        ),
        ("public", &[AUTHED][..], "src/trpc.ts#publicProcedure"),
        ("admin", &[AUTHED][..], "src/trpc.ts#adminProcedure"),
        (
            "session",
            &["src/auth/workspace.ts#withWorkspace"][..],
            "src/auth/session.ts#withSession",
        ),
        (
            "non",
            &[AUTHED][..],
            "src/trpc.ts#nonAuthenticatedProcedure",
        ),
        ("same", &[AUTHED][..], "src/trpc.ts#protectedProcedure"),
        (
            "floor",
            &[AUTHED, AUTHED, AUTHED, "src/trpc.ts#procedure"][..],
            "src/trpc.ts#protectedProcedure",
        ),
    ] {
        files.extend(sibling_scenario(pkg, WrapKind::Call, targets, sibling, 4));
    }
    background(&mut files);
    let mut r = repo(files);
    // The modules that define the procedures, as a full scan of the repository has them
    // (read for context: they hold no member of a role). Since S7 `check` cannot tell a
    // call wrapper whose module the facts lack (`Rule::tell_in`: it may be built on the
    // rule's target there) and reports no violation for it; without these files `odd`
    // was such a member. Mining does not read this (the outliers below are as before).
    for pkg in [
        "bare", "maybe", "mixed", "public", "admin", "session", "non", "same", "floor",
    ] {
        for module in ["src/trpc.ts", "src/auth/workspace.ts", "src/auth/session.ts"] {
            r.context_files
                .push(file_with(&format!("{pkg}/{module}"), pkg, Vec::new()));
        }
    }
    r.normalize();
    let cs = mined(&r);
    for pkg in ["bare", "maybe", "public", "admin", "session", "non"] {
        let target = if pkg == "session" {
            "src/auth/workspace.ts#withWorkspace"
        } else {
            AUTHED
        };
        let c = wrapper_rule_in(&cs, pkg, target);
        assert_eq!(any_of(c), [format!("{pkg}/{target}")], "{pkg}");
        assert_eq!(outliers(c), ["bare", "odd"], "{pkg}");
        let p = accept_all(&r, &cs);
        assert_eq!(violators_of(&r, &p, &c.id), ["bare", "odd"], "{pkg}");
    }
    let c = wrapper_rule_in(&cs, "same", AUTHED);
    assert_eq!(
        any_of(c),
        [
            "same/src/trpc.ts#authenticatedProcedure",
            "same/src/trpc.ts#protectedProcedure"
        ]
    );
    assert_eq!(outliers(c), ["bare"]);
    // A set of `authenticatedProcedure` and the bare `procedure` keeps only its guard
    // (#60): `procedure` satisfies no auth rule, so no proposal holds it, and no
    // sibling joins through it (`maybeAuthenticatedProcedure`, `protectedProcedure`).
    for pkg in ["mixed", "floor"] {
        assert!(
            !cs.iter().any(|c| c.role.package == pkg
                && matches!(&c.rule, Rule::WrappedBy { any_of, .. }
                    if any_of.iter().any(|a| a.ends_with("#procedure")
                        || a.ends_with("#maybeAuthenticatedProcedure")))),
            "{pkg}: {:?}",
            cs.iter()
                .filter(|c| c.role.package == pkg)
                .map(|c| c.rule.describe())
                .collect::<Vec<_>>()
        );
    }
}

/// 30 Next.js pages under `pkg/app/**` whose `generateMetadata` follows `rule` (is
/// wrapped in, calls or renders `target`), a root `app/page.tsx` whose does not, and
/// `extra` nested pages whose does not. With `helper`, the root page also exports a
/// helper that does not follow it.
fn pages_scenario(pkg: &str, target: &str, extra: usize) -> Vec<FileFacts> {
    pages_scenario_with(pkg, WrapKind::Call, None, target, extra, false)
}

fn pages_scenario_with(
    pkg: &str,
    wrap_kind: WrapKind,
    other: Option<fn(&mut Symbol, String)>,
    target: &str,
    extra: usize,
    helper: bool,
) -> Vec<FileFacts> {
    let target = format!("{pkg}/{target}");
    let follows = |s: &mut Symbol| match other {
        Some(set) => set(s, target.clone()),
        None => s.wraps.push(wrap(&target, wrap_kind)),
    };
    let page = |path: &str, follow: bool| {
        let mut f = func(path, "generateMetadata", |s| {
            if follow {
                follows(s);
            }
        });
        // As a real Next page: its default export is the route.
        f.entry_points.push(drift_core::EntryPoint {
            symbol: "default".into(),
            kind: "page".into(),
            method: None,
            route: Some(
                format!("/{}", path.trim_start_matches("app/"))
                    .trim_end_matches("page.tsx")
                    .to_string(),
            ),
            adapter: "nextjs".into(),
        });
        f
    };
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| page(&format!("app/guides/g{i}/page.tsx"), true))
        .collect();
    let mut root = page("app/page.tsx", false);
    if helper {
        root.symbols
            .push(sym("buildHomeMeta", SymbolKind::Function, |_| {}));
    }
    files.push(root);
    for i in 0..extra {
        files.push(page(&format!("app/blog/b{i}/page.tsx"), false));
    }
    in_package(files, pkg)
}

/// `files` as a repo whose `packages` are Next.js apps.
fn next_apps(files: Vec<FileFacts>, packages: &[&str]) -> RepoFacts {
    let mut r = repo(files);
    for p in packages {
        r.packages.push(PackageFacts {
            path: (*p).into(),
            name: (*p).into(),
            dependencies: vec!["next@15.0.0".into(), "react@19.0.0".into()],
            ..Default::default()
        });
    }
    r.normalize();
    r
}

fn page_rule<'c>(cs: &'c [Candidate], pkg: &str) -> Option<&'c Candidate> {
    cs.iter().find(|c| {
        c.role.package == pkg
            && c.role.file == "page"
            && matches!(
                c.rule,
                Rule::WrappedBy { .. } | Rule::Calls { .. } | Rule::Renders { .. }
            )
    })
}

// F9: a framework root file is one of a kind: the docs home page among the guide pages
// (supabase) is no outlier of "pages are wrapped in genGuideMeta()": it is listed as
// exempt, with why, and `check` does not report it. The rule stays proposed when it was
// the only outlier (supabase's root `app/layout.tsx` was labelled a one-off of an
// accepted layout rule), and other pages that break it stay outliers. Only the root
// page's root exports are exempt, not a helper beside them; only in a Next.js app; and
// never from a rule whose wrapper, callee or component says who may pass (`withAuth`,
// `auth()`, `<RequireAuth>`).
#[test]
fn framework_root_files_are_one_offs() {
    const META: &str = "lib/meta.ts#genGuideMeta";
    let mut files = pages_scenario("only", META, 0);
    files.extend(pages_scenario("more", META, 1));
    files.extend(pages_scenario_with(
        "helper",
        WrapKind::Call,
        None,
        META,
        0,
        true,
    ));
    files.extend(pages_scenario("plain", META, 0));
    files.extend(pages_scenario("authed", "lib/auth.ts#withAuth", 0));
    files.extend(pages_scenario_with(
        "calls",
        WrapKind::Call,
        Some(|s, t| s.calls.push(t)),
        "lib/auth.ts#auth",
        0,
        false,
    ));
    files.extend(pages_scenario_with(
        "renders",
        WrapKind::Call,
        Some(|s, t| s.renders.push(t)),
        "components/RequireAuth.tsx#RequireAuth",
        0,
        false,
    ));
    background(&mut files);
    // `plain` is no Next.js app: its `app/page.tsx` is not a root page.
    let r = next_apps(
        files,
        &["only", "more", "helper", "authed", "calls", "renders"],
    );
    let cs = mined(&r);

    let c = page_rule(&cs, "only").expect("the rule with no outlier left");
    assert!(c.outliers.is_empty());
    assert_eq!(
        c.exempt.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        ["only/app/page.tsx"]
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 30));

    let c = page_rule(&cs, "more").expect("the rule with another outlier");
    assert_eq!(
        c.outliers
            .iter()
            .map(|o| o.path.as_str())
            .collect::<Vec<_>>(),
        ["more/app/blog/b0/page.tsx"]
    );
    let exempt: Vec<(&str, &str)> = c
        .exempt
        .iter()
        .map(|e| (e.path.as_str(), e.reason.as_str()))
        .collect();
    assert_eq!(
        exempt,
        [(
            "more/app/page.tsx",
            "the app's root page (app/page.tsx), a framework root file"
        )]
    );
    assert_eq!((c.evidence.total, c.evidence.role_members), (31, Some(32)));
    let p = accept_all(&r, &cs);
    let mut v: Vec<String> = check(&r, &p, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == c.id)
        .map(|v| v.path)
        .collect();
    v.sort();
    assert_eq!(v, ["more/app/blog/b0/page.tsx"]);

    // A helper in the root page is not exempt as the root file's, but it is no
    // `generateMetadata` either: the rule's role is the reserved name's
    // (`RoleSelector::export_name`), so the helper is not one of its members.
    let c = page_rule(&cs, "helper").expect("the rule with a helper in the root page");
    assert_eq!(c.role.export_name.as_deref(), Some("generateMetadata"));
    assert!(outliers(c).is_empty(), "{:?}", c.outliers);
    assert_eq!(
        c.exempt
            .iter()
            .map(|e| e.symbol.as_str())
            .collect::<Vec<_>>(),
        ["generateMetadata"]
    );
    let all = units(&r, &FileKinds::learn(&r));
    let helper = all.iter().find(|u| u.name() == "buildHomeMeta").unwrap();
    assert!(!helper.in_role(&c.role));
    assert!(helper.roles.iter().all(|r| r.export_name.is_none()));

    for pkg in ["plain", "authed", "calls", "renders"] {
        let c = page_rule(&cs, pkg).unwrap_or_else(|| panic!("{pkg}: the rule"));
        assert_eq!(
            c.outliers
                .iter()
                .map(|o| o.path.as_str())
                .collect::<Vec<_>>(),
            [format!("{pkg}/app/page.tsx")],
            "{pkg}"
        );
        assert!(c.exempt.is_empty(), "{pkg}");
    }
}

#[test]
fn framework_root_files_are_found_by_path_below_their_package() {
    use drift_core::{Export, ExportKind};
    use drift_mine::frameworks::root_file;
    let reexport = || Export {
        name: "x".into(),
        origin: "a.ts#x".into(),
        kind: ExportKind::ReExport,
    };
    let next = |d: &str| d == "next" || d == "react";
    let at = |path: &str, package: &str, deps: &dyn Fn(&str) -> bool| {
        let mut f = file_with(path, package, vec![]);
        if path.contains("index.") {
            f.exports = vec![reexport()];
        }
        root_file(&f, deps).map(|(rel, what)| format!("{rel}: {what}"))
    };
    for (path, package, want) in [
        (
            "apps/docs/app/page.tsx",
            "apps/docs",
            "app/page.tsx: the app's root page",
        ),
        (
            "apps/web/src/app/layout.jsx",
            "apps/web",
            "src/app/layout.jsx: the app's root layout",
        ),
        ("pages/_app.tsx", "", "pages/_app.tsx: the app's custom App"),
        (
            "web/src/main.tsx",
            "web",
            "src/main.tsx: the app's entry module",
        ),
        (
            "lib/src/index.mjs",
            "lib",
            "src/index.mjs: the package's barrel",
        ),
    ] {
        assert_eq!(at(path, package, &next).as_deref(), Some(want), "{path}");
    }
    // Nested pages, a page outside its package's root, a `main` outside `src/`, other
    // extensions, a Vite app's `src/pages/index.ts` barrel: not root files.
    for (path, package) in [
        ("apps/docs/app/guides/page.tsx", "apps/docs"),
        ("apps/docs/app/page.tsx", ""),
        ("web/main.ts", "web"),
        ("web/src/main.css", "web"),
        ("web/src/pages/index.ts", "web"),
    ] {
        assert_eq!(at(path, package, &next), None, "{path}");
    }
    // Without Next.js, no root page; without a frontend framework, no entry module (a
    // GitHub Action's `src/main.ts`).
    let none = |_: &str| false;
    assert_eq!(at("apps/docs/app/page.tsx", "apps/docs", &none), None);
    assert_eq!(at("action/src/main.ts", "action", &none), None);
    // An `index.ts` that declares what it exports, or runs a statement of its own, is
    // no barrel.
    let mut own = file_with("lib/index.ts", "lib", vec![]);
    own.exports = vec![Export {
        name: "x".into(),
        origin: "lib/index.ts#x".into(),
        kind: ExportKind::Local,
    }];
    assert_eq!(root_file(&own, none), None);
    let mut side = file_with(
        "lib/index.ts",
        "lib",
        vec![sym("(module)", SymbolKind::Module, |s| {
            s.calls.push("lib/polyfill.ts#install".into());
        })],
    );
    side.exports = vec![reexport()];
    assert_eq!(root_file(&side, none), None);
}

// ---------------------------------------------------------------------------
// Classes of another kind (F3) and the target's own module (F4), from the v3 error
// analysis of the D5 default tier on the dev set: outliers that are a different kind of
// class from the ones that follow the rule are exempt, with a reason, in mining and in
// `check`; a hook's single-file scan defers to a full scan.

fn exempt_of(c: &Candidate) -> Vec<(&str, &str)> {
    c.exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.reason.as_str()))
        .collect()
}

fn listed(cs: &[Candidate]) -> Vec<(String, String, Vec<&str>)> {
    cs.iter()
        .map(|c| (c.role.describe(), c.rule.describe(), outliers(c)))
        .collect()
}

const REGISTERED: &str = "server/src/upgrade/registered.ts#RegisteredCommand";
const COMMAND: &str = "pkg:nest-commander#Command";

/// 50 upgrade commands with the team's decorator and nest-commander's, a question set
/// next to them, and the classes `extra` adds.
fn decorated_commands(extra: Vec<Symbol>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..50 {
        files.push(file_with(
            &format!("server/src/commands/steps/step-{i}.ts"),
            "server",
            vec![sym(&format!("Step{i}Command"), SymbolKind::Class, |s| {
                s.wraps.push(wrap(COMMAND, WrapKind::Decorator));
                s.wraps.push(wrap(REGISTERED, WrapKind::Decorator));
                s.wraps
                    .push(wrap("pkg:nest-commander#CommandRunner", WrapKind::Extends));
            })],
        ));
    }
    let mut questions = vec![sym("ConfirmationQuestion", SymbolKind::Class, |s| {
        s.wraps
            .push(wrap("pkg:nest-commander#QuestionSet", WrapKind::Decorator));
    })];
    questions.extend(extra);
    files.push(file_with(
        "server/src/commands/questions/confirmation.ts",
        "server",
        questions,
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("server/src/util/u{i}.ts"),
            "server",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    repo(files)
}

fn decorated_with(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![target.into()],
    }
}

#[test]
fn a_class_with_another_frameworks_decorator_is_no_outlier_of_a_decorator_rule() {
    // A `@QuestionSet()` class among `@Command()` classes is not a command that forgot
    // the team's decorator. A command that has `@Command()` but not the team's one is,
    // and so is one on the commands' runner with no decorator at all.
    let r = decorated_commands(vec![
        sym("ForgotCommand", SymbolKind::Class, |s| {
            s.wraps.push(wrap(COMMAND, WrapKind::Decorator));
        }),
        // A library decorator named for the commands' kind is the one the team's
        // decorator builds on, for all the facts say: a command that skipped it.
        sym("LegacyCommand", SymbolKind::Class, |s| {
            s.wraps.push(wrap(
                "pkg:legacy-commander#LegacyCommand",
                WrapKind::Decorator,
            ));
        }),
        sym("BareCommand", SymbolKind::Class, |s| {
            s.wraps
                .push(wrap("pkg:nest-commander#CommandRunner", WrapKind::Extends));
        }),
    ]);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == decorated_with(REGISTERED) && c.role.dir == "src/commands")
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(
        outliers(c),
        ["BareCommand", "ForgotCommand", "LegacyCommand"]
    );
    assert_eq!(
        exempt_of(c),
        [(
            "ConfirmationQuestion",
            "another kind of class (decorated with QuestionSet())"
        )]
    );
    let p = accept_all(&r, &cs);
    assert_eq!(
        violators_of(&r, &p, &c.id),
        ["BareCommand", "ForgotCommand", "LegacyCommand"]
    );
    // A hook's scan of the questions file alone has no commands to compare with: it
    // defers to a full scan; the full facts decide.
    let alone = repo(
        r.files
            .iter()
            .filter(|f| f.path.contains("questions"))
            .cloned()
            .collect(),
    );
    assert!(drift_mine::check::needs_full_scan(&alone, &p));
    assert!(!drift_mine::check::needs_full_scan(&r, &p));
}

/// 40 search indexes registered with the team's decorator on the team's base, plus the
/// classes `extra` adds to the search modules.
fn search_indexes(extra: Vec<Symbol>) -> RepoFacts {
    let register = "app/search/__init__.py#register_search";
    let index = "app/search/__init__.py#SearchIndex";
    let mut files = Vec::new();
    for f in 0..8 {
        let mut symbols: Vec<Symbol> = (0..5)
            .map(|i| {
                class(&format!("A{f}x{i}Index"), |s| {
                    s.wraps.push(wrap(register, WrapKind::Decorator));
                    s.wraps.push(wrap(index, WrapKind::Extends));
                })
            })
            .collect();
        if f == 0 {
            symbols.extend(extra.clone());
        }
        files.push(py(&format!("app/a{f}/search.py"), symbols));
    }
    files.push(py(
        "app/search/__init__.py",
        vec![class("SearchIndex", |s| s.traits.push("base".into()))],
    ));
    plain_classes(&mut files);
    repo(files)
}

#[test]
fn a_django_model_or_form_among_search_indexes_is_another_kind() {
    let register = "app/search/__init__.py#register_search";
    let r = search_indexes(vec![
        class("CachedValue", |s| {
            s.wraps
                .push(wrap("pkg:django#db.models.Model", WrapKind::Extends));
        }),
        class("SearchForm", |s| {
            s.wraps
                .push(wrap("pkg:django#forms.Form", WrapKind::Extends));
        }),
        // An index that forgot to register is an outlier.
        class("LostIndex", |s| {
            s.wraps.push(wrap(
                "app/search/__init__.py#SearchIndex",
                WrapKind::Extends,
            ));
        }),
    ]);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == decorated_with(register))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["LostIndex"]);
    assert_eq!(
        exempt_of(c),
        [
            (
                "CachedValue",
                "another kind of class (extends db.models.Model)"
            ),
            ("SearchForm", "another kind of class (extends forms.Form)"),
        ]
    );
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["LostIndex"]);
}

#[test]
fn the_module_that_defines_the_target_is_not_about_the_rule() {
    // `Choice` (a tuple) and a metaclass sit next to `ChoiceSet` in its module; the
    // choice sets elsewhere extend it, and one that does not is an outlier.
    let base = "app/utilities/choices.py#ChoiceSet";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/choices.py"),
            (0..5)
                .map(|i| {
                    class(&format!("M{f}x{i}Choices"), |s| {
                        if (f, i) != (0, 0) {
                            s.wraps.push(wrap(base, WrapKind::Extends));
                        }
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/utilities/choices.py",
        vec![
            class("ChoiceSet", |s| s.traits.push("base".into())),
            class("Choice", |s| {
                s.wraps.push(wrap("global#tuple", WrapKind::Extends));
            }),
            class("UnrelatedHelper", |_| {}),
        ],
    ));
    plain_classes(&mut files);
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["M0x0Choices"]);
    assert_eq!(
        exempt_of(c),
        [
            ("Choice", "in the module that defines ChoiceSet"),
            ("UnrelatedHelper", "in the module that defines ChoiceSet"),
        ]
    );
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["M0x0Choices"]);
}

#[test]
fn a_typescript_base_class_is_not_an_outlier_of_its_own_rule() {
    // Providers extend the team's `BaseProvider`, defined in the role's folder; an
    // `*Error` on `Error` next to a provider is named for its own base; a provider that
    // only implements the interface is an outlier.
    let base = "providers/src/base.provider.ts#BaseProvider";
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![sym(&format!("P{i}Provider"), SymbolKind::Class, |s| {
            s.wraps.push(wrap(base, WrapKind::Extends));
        })];
        if i == 0 {
            symbols.push(sym("UrlBlockedError", SymbolKind::Class, |s| {
                s.wraps.push(wrap("global#Error", WrapKind::Extends));
            }));
        }
        files.push(file_with(
            &format!("providers/src/lib/p{i}/p{i}.provider.ts"),
            "providers",
            symbols,
        ));
    }
    files.push(file_with(
        "providers/src/lib/tool/tool.provider.ts",
        "providers",
        vec![sym("ToolProvider", SymbolKind::Class, |_| {})],
    ));
    files.push(file_with(
        "providers/src/base.provider.ts",
        "providers",
        vec![sym("BaseProvider", SymbolKind::Class, |_| {})],
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("providers/src/util/u{i}.ts"),
            "providers",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["ToolProvider"]);
    assert_eq!(
        exempt_of(c),
        [
            ("BaseProvider", "in the module that defines BaseProvider"),
            ("UrlBlockedError", "a error, named for its base Error"),
        ]
    );
}

// ---------------------------------------------------------------------------
// Review of #45: exemptions stay inside their scope. The reviewer's fixtures.

#[test]
fn an_unauthenticated_handler_in_the_auth_decorators_module_is_an_outlier() {
    // `login_required` is defined in `app/views/auth.py`, which also serves routes:
    // the decorator's module is no exemption for handlers (F4 is for classes).
    let login = "app/views/auth.py#login_required";
    let view = |path: &str, name: &str, guarded: bool| {
        let mut f = py(
            path,
            vec![sym(name, SymbolKind::Function, |s| {
                if guarded {
                    s.wraps.push(wrap(login, WrapKind::Decorator));
                }
            })],
        );
        f.entry_points
            .push(entry(name, "http", Some(&format!("/{name}"))));
        f
    };
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| view(&format!("app/views/v{i}.py"), &format!("page{i}"), true))
        .collect();
    let mut auth = view("app/views/auth.py", "purge_everything", false);
    auth.symbols
        .push(sym("login_required", SymbolKind::Function, |_| {}));
    files.push(auth.clone());
    for i in 0..60 {
        files.push(py(
            &format!("app/util/u{i}.py"),
            vec![sym("helper", SymbolKind::Function, |_| {})],
        ));
    }
    let r = repo(files.clone());
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == decorated_with(login))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["purge_everything"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
    // An agent adds an unguarded DELETE handler to the decorator's module.
    let p = accept_all(&r, &cs);
    let mut more = auth;
    more.symbols
        .push(sym("delete_user", SymbolKind::Function, |_| {}));
    more.entry_points
        .push(entry("delete_user", "http", Some("/admin/users/<uid>")));
    let pos = files
        .iter()
        .position(|f| f.path == "app/views/auth.py")
        .unwrap();
    files[pos] = more;
    let after = repo(files);
    assert_eq!(
        violators_of(&after, &p, &c.id),
        ["delete_user", "purge_everything"]
    );
}

const SERVICE_BASE: &str = "server/src/services/base.service.ts#BaseService";

/// 60 services on the team's `BaseService`, `base.service.ts` defining it (and the
/// classes `in_base` adds), and the classes `extra` adds to the services folder.
fn team_services(in_base: Vec<Symbol>, extra: Vec<Symbol>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..60 {
        files.push(file_with(
            &format!("server/src/services/s{i}.service.ts"),
            "server",
            vec![sym(&format!("S{i}Service"), SymbolKind::Class, |s| {
                s.wraps.push(wrap(SERVICE_BASE, WrapKind::Extends));
            })],
        ));
    }
    let mut base = vec![sym("BaseService", SymbolKind::Class, |_| {})];
    base.extend(in_base);
    files.push(file_with(
        "server/src/services/base.service.ts",
        "server",
        base,
    ));
    for (i, s) in extra.into_iter().enumerate() {
        files.push(file_with(
            &format!("server/src/services/extra-{i}.service.ts"),
            "server",
            vec![s],
        ));
    }
    for i in 0..100 {
        files.push(file_with(
            &format!("server/src/util/u{i}.ts"),
            "server",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    repo(files)
}

fn service(name: &str, base: Option<&str>, decorator: Option<&str>) -> Symbol {
    sym(name, SymbolKind::Class, |s| {
        if let Some(b) = base {
            s.wraps.push(wrap(b, WrapKind::Extends));
        }
        if let Some(d) = decorator {
            s.wraps.push(wrap(d, WrapKind::Decorator));
        }
    })
}

#[test]
fn a_class_named_for_the_followers_kind_is_never_another_kind() {
    // A `*Service` among services is a service that skipped the base, whatever it is
    // built on: an event emitter, an SDK client, Nest's `@Injectable()`, or nothing;
    // a plain `*Service` beside `BaseService` in its module is one too. Only the base
    // itself is exempt.
    let audit = || service("AuditService", None, None);
    let extra = || {
        vec![
            service("BillingService", Some("pkg:events#EventEmitter"), None),
            service("PaymentsService", Some("pkg:some-sdk#SdkClient"), None),
            service("CacheService", None, Some("pkg:@nestjs/common#Injectable")),
            service("PlainService", None, None),
        ]
    };
    let r = team_services(vec![audit()], extra());
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(SERVICE_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(
        outliers(c),
        [
            "AuditService",
            "BillingService",
            "PaymentsService",
            "CacheService",
            "PlainService"
        ]
    );
    assert_eq!(
        exempt_of(c),
        [("BaseService", "in the module that defines BaseService")]
    );
    // After acceptance, new services of each shape are reported.
    let p = accept_all(&r, &cs);
    let mut more = extra();
    more.extend([
        service("RefundService", Some("pkg:events#EventEmitter"), None),
        service("QueueService", None, Some("pkg:@nestjs/common#Injectable")),
    ]);
    let after = team_services(vec![audit(), service("LedgerService", None, None)], more);
    assert_eq!(
        violators_of(&after, &p, &c.id),
        [
            "AuditService",
            "BillingService",
            "CacheService",
            "LedgerService",
            "PaymentsService",
            "PlainService",
            "QueueService",
            "RefundService"
        ]
    );
}

#[test]
fn a_python_service_on_a_client_class_is_a_service() {
    // `HttpService(httpx.Client)` and `MixedService(LogMixin, requests.Session)` among
    // services on `BaseService`: services, so outliers.
    let base = "app/kit.py#BaseService";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/services/m{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("M{f}x{i}Service"), |s| {
                        s.wraps.push(wrap(base, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/services/clients.py",
        vec![
            class("HttpService", |s| {
                s.wraps.push(wrap("pkg:httpx#Client", WrapKind::Extends));
            }),
            class("MixedService", |s| {
                s.wraps.push(wrap("app/kit.py#LogMixin", WrapKind::Extends));
                s.wraps
                    .push(wrap("pkg:requests#Session", WrapKind::Extends));
            }),
        ],
    ));
    files.push(py(
        "app/kit.py",
        vec![
            class("BaseService", |s| s.traits.push("base".into())),
            class("LogMixin", |s| s.traits.push("base".into())),
        ],
    ));
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["HttpService", "MixedService"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
}

#[test]
fn the_classes_that_follow_a_rule_are_counted_within_its_role() {
    // A class outside the role that follows the rule and also extends the validator's
    // base changes nothing about the helper inside it.
    let schema = "app/models.py#ma.ModelSchema";
    let exempt_with = |outside: bool| {
        let mut files = schema_helpers(schema);
        if outside {
            files.push(py(
                "other/x.py",
                vec![class("Weird", |s| {
                    s.wraps.push(wrap(schema, WrapKind::Extends));
                    s.wraps.push(wrap(
                        "pkg:marshmallow#validate.Validator",
                        WrapKind::Extends,
                    ));
                })],
            ));
        }
        let cs = mined(&repo(files));
        let c = cs
            .iter()
            .find(|c| c.rule == extends_rule(schema) && c.role.dir == "app")
            .unwrap_or_else(|| panic!("{:?}", listed(&cs)))
            .clone();
        exempt_of(&c)
            .into_iter()
            .map(|(s, r)| (s.to_string(), r.to_string()))
            .collect::<Vec<_>>()
    };
    let inside = exempt_with(false);
    assert_eq!(inside.len(), 2, "{inside:?}");
    assert_eq!(exempt_with(true), inside);
}

#[test]
fn an_aliased_or_unresolved_base_names_no_other_kind() {
    // Components extend the repo's `Form`; others reach it through an alias the
    // resolver took for a package (`misago/components/form`), or not at all. They are
    // not another kind of class. A class on two package bases is named by its direct
    // base, not the first in order.
    let form = "app/components/form.js#Form";
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(file_with(
            &format!("app/components/c{i}/index.js"),
            "",
            vec![sym(&format!("C{i}Panel"), SymbolKind::Class, |s| {
                s.wraps.push(wrap(form, WrapKind::Extends));
            })],
        ));
    }
    files.push(file_with(
        "app/components/form.js",
        "",
        vec![sym("Form", SymbolKind::Class, |_| {})],
    ));
    files.push(file_with(
        "app/components/aliased/index.js",
        "",
        vec![
            sym("AliasedPanel", SymbolKind::Class, |s| {
                s.wraps.push(wrap(
                    "pkg:misago/components/form#default",
                    WrapKind::Extends,
                ));
            }),
            sym("NamedPanel", SymbolKind::Class, |s| {
                s.wraps.push(wrap("pkg:misago-ui#Form", WrapKind::Extends));
            }),
            sym("LostPanel", SymbolKind::Class, |s| {
                s.wraps
                    .push(wrap("unresolved:~/components/form#Form", WrapKind::Extends));
            }),
            sym("Socket", SymbolKind::Class, |s| {
                s.wraps.push(wrap("pkg:zeta#Zeta", WrapKind::Extends));
                s.wraps.push(wrap("pkg:alpha#Alpha", WrapKind::Extends));
            }),
        ],
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("lib/u{i}.js"),
            "",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(form) && c.role.dir == "app")
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["AliasedPanel", "LostPanel", "NamedPanel"]);
    assert_eq!(
        exempt_of(c),
        [
            ("Socket", "another kind of class (extends Zeta)"),
            ("Form", "in the module that defines Form"),
        ]
    );
}

// ---------------------------------------------------------------------------
// Re-check of #45 (fa29d6a): class-shaped handlers, guards, the class's own place, mixins.

/// A Python view class that is an HTTP entry point.
fn view_class(path: &str, name: &str, edit: impl FnOnce(&mut Symbol)) -> FileFacts {
    let mut f = py(path, vec![class(name, edit)]);
    f.entry_points
        .push(entry(name, "http", Some(&format!("/{name}"))));
    f
}

#[test]
fn an_unguarded_view_class_in_the_auth_decorators_module_is_an_outlier() {
    let auth = "app/api/auth.py#requires_auth";
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            view_class(&format!("app/api/users{i}.py"), &format!("Users{i}"), |s| {
                s.wraps.push(wrap(auth, WrapKind::Decorator));
                s.wraps
                    .push(wrap("pkg:flask#views.MethodView", WrapKind::Extends));
            })
        })
        .collect();
    let mut module = view_class("app/api/auth.py", "DeleteUser", |s| {
        s.wraps
            .push(wrap("pkg:flask#views.MethodView", WrapKind::Extends));
    });
    module
        .symbols
        .push(sym("requires_auth", SymbolKind::Function, |_| {}));
    files.push(module);
    plain_classes(&mut files);
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == decorated_with(auth))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["DeleteUser"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["DeleteUser"]);
}

#[test]
fn an_unguarded_view_class_beside_the_authenticated_base_is_an_outlier() {
    let authed = "app/api/base.py#AuthedView";
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            view_class(&format!("app/api/users{i}.py"), &format!("Users{i}"), |s| {
                s.wraps.push(wrap(authed, WrapKind::Extends));
            })
        })
        .collect();
    let mut base = py(
        "app/api/base.py",
        vec![class("AuthedView", |s| {
            s.wraps
                .push(wrap("pkg:flask#views.MethodView", WrapKind::Extends));
        })],
    );
    base.symbols.push(class("PurgeEverything", |s| {
        s.wraps
            .push(wrap("pkg:flask#views.MethodView", WrapKind::Extends));
    }));
    base.entry_points
        .push(entry("PurgeEverything", "http", Some("/purge")));
    files.push(base);
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(authed))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["PurgeEverything"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
}

#[test]
fn no_class_is_another_kind_under_a_guard() {
    // Controllers carry `@Controller()` and the team's `@Auth()`, which guards their
    // handlers. A `@Resolver()` class among them is no "other kind": a guard rule is
    // about every class of its role.
    let auth = "server/src/auth/auth.decorator.ts#Auth";
    let mut files = Vec::new();
    for i in 0..30 {
        let mut f = file_with(
            &format!("server/src/c{i}/c{i}.controller.ts"),
            "server",
            vec![
                sym(&format!("C{i}Controller"), SymbolKind::Class, |s| {
                    s.wraps
                        .push(wrap("pkg:@nestjs/common#Controller", WrapKind::Decorator));
                    s.wraps.push(wrap(auth, WrapKind::Decorator));
                }),
                sym(&format!("GET /c{i}"), SymbolKind::Function, |s| {
                    s.wraps.push(wrap(auth, WrapKind::Decorator));
                }),
            ],
        );
        f.entry_points.push(entry(
            &format!("GET /c{i}"),
            "http",
            Some(&format!("/c{i}")),
        ));
        files.push(f);
    }
    files.push(file_with(
        "server/src/admin/admin.controller.ts",
        "server",
        vec![sym("AdminResolver", SymbolKind::Class, |s| {
            s.wraps
                .push(wrap("pkg:@nestjs/graphql#Resolver", WrapKind::Decorator));
        })],
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("server/src/util/u{i}.ts"),
            "server",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == decorated_with(auth) && c.role.kind == SymbolKind::Class)
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["AdminResolver"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
}

#[test]
fn python_resources_among_authenticated_views_are_outliers() {
    // `AdminUsers(flask_restful.Resource)` and `Webhook(HTTPEndpoint)` are entry points
    // among views on `AuthedView`, which guards them: neither is another kind.
    let authed = "app/kit.py#AuthedView";
    let mut files: Vec<FileFacts> = (0..40)
        .map(|i| {
            view_class(&format!("app/v{i}/views.py"), &format!("V{i}View"), |s| {
                s.wraps.push(wrap(authed, WrapKind::Extends));
            })
        })
        .collect();
    files.push(view_class("app/admin/views.py", "AdminUsers", |s| {
        s.wraps
            .push(wrap("pkg:flask_restful#Resource", WrapKind::Extends));
    }));
    files.push(view_class("app/hooks/views.py", "Webhook", |s| {
        s.wraps.push(wrap(
            "pkg:starlette#endpoints.HTTPEndpoint",
            WrapKind::Extends,
        ));
    }));
    files.push(py(
        "app/kit.py",
        vec![class("AuthedView", |s| s.traits.push("base".into()))],
    ));
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(authed))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["AdminUsers", "Webhook"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
}

#[test]
fn a_class_in_a_file_or_folder_of_the_followers_kind_is_one_of_them() {
    // `Refunds extends EventEmitter`, alone in `refund.service.ts`, is a service.
    let r = team_services(
        vec![],
        vec![service("Refunds", Some("pkg:events#EventEmitter"), None)],
    );
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(SERVICE_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["Refunds"]);
    // Python: `Refunds(TaskMixin)` and `RefundManager(Redis)` in `services/`.
    let base = "app/kit.py#BaseService";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/services/m{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("M{f}x{i}"), |s| {
                        s.wraps.push(wrap(base, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/services/refunds.py",
        vec![
            class("Refunds", |s| {
                s.wraps
                    .push(wrap("pkg:celery_tools#TaskMixin", WrapKind::Extends));
            }),
            class("RefundManager", |s| {
                s.wraps.push(wrap("pkg:redis#Redis", WrapKind::Extends));
            }),
            // A class named for its own base says what it is, wherever it sits.
            class("AmountValidator", |s| {
                s.wraps.push(wrap(
                    "pkg:marshmallow#validate.Validator",
                    WrapKind::Extends,
                ));
            }),
        ],
    ));
    files.push(py(
        "app/kit.py",
        vec![class("BaseService", |s| s.traits.push("base".into()))],
    ));
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["RefundManager", "Refunds"]);
    assert_eq!(
        exempt_of(c),
        [(
            "AmountValidator",
            "a validator, named for its base validate.Validator"
        )]
    );
    assert_eq!(c.exempt[0].code, "named_for_base");
}

#[test]
fn a_mixin_alone_makes_no_class_another_kind() {
    // Followers spread over folders that name no kind; `Ledger(CacheMixin)` is built on
    // a package mixin only: an outlier. `Socket(Zeta)` is another kind.
    let base = "app/kit.py#Entry";
    let mut files = Vec::new();
    for f in 0..8 {
        files.push(py(
            &format!("app/m{f}/m{f}.py"),
            (0..5)
                .map(|i| {
                    class(&format!("M{f}x{i}Entry"), |s| {
                        s.wraps.push(wrap(base, WrapKind::Extends));
                    })
                })
                .collect(),
        ));
    }
    files.push(py(
        "app/other/misc.py",
        vec![
            class("Ledger", |s| {
                s.wraps
                    .push(wrap("pkg:cachelib#CacheMixin", WrapKind::Extends));
            }),
            class("Socket", |s| {
                s.wraps.push(wrap("pkg:zeta#Zeta", WrapKind::Extends));
            }),
        ],
    ));
    files.push(py(
        "app/kit.py",
        vec![class("Entry", |s| s.traits.push("base".into()))],
    ));
    plain_classes(&mut files);
    let cs = mined(&repo(files));
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["Ledger"]);
    assert_eq!(
        exempt_of(c),
        [("Socket", "another kind of class (extends Zeta)")]
    );
    assert_eq!(c.exempt[0].code, "another_kind");
}

#[test]
fn a_single_file_scan_defers_exemptions_to_a_full_scan() {
    // Whether a rule is a guard, and what its followers are built on, is read from the
    // whole repo: a hook's single-file facts (the edited file and its in-repo bases)
    // with a class that could be exempt defer to a full scan, which decides it.
    let r = team_services(
        vec![],
        vec![service("UrlEmitter", Some("pkg:events#EventEmitter"), None)],
    );
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(SERVICE_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)))
        .clone();
    let p = accept_all(&r, &cs);
    let edited = file_with(
        "server/src/services/new.service.ts",
        "server",
        vec![
            service("NewService", Some(SERVICE_BASE), None),
            service("PingEmitter", Some("pkg:events#EventEmitter"), None),
        ],
    );
    let base = r
        .files
        .iter()
        .find(|f| f.path == "server/src/services/base.service.ts")
        .unwrap()
        .clone();
    let mut alone = repo(vec![edited.clone()]);
    alone.context_files.push(base);
    assert!(drift_mine::check::needs_full_scan(&alone, &p));
    let mut files = r.files.clone();
    files.push(edited);
    let full = repo(files);
    assert!(!drift_mine::check::needs_full_scan(&full, &p));
    let report = check(&full, &p, &Lock::default(), Scope::Accepted, None);
    assert!(
        report
            .violations
            .iter()
            .all(|v| !(v.id == c.id && v.symbol == "PingEmitter")),
        "{report:?}"
    );
    assert!(
        report
            .exempt
            .iter()
            .any(|e| e.id == c.id && e.symbol == "PingEmitter" && e.code == "named_for_base")
    );
}

// ---------------------------------------------------------------------------
// One gate for every exemption (#45 re-check at 058349c): no exemption under a guard
// rule, none for an entry point.

/// A Nest controller file: the class, then its routes (route symbols follow the class,
/// as the TypeScript facts record them).
fn nest_controller(path: &str, class: &str, base: &str, routes: &[&str]) -> FileFacts {
    let mut symbols = vec![sym(class, SymbolKind::Class, |s| {
        s.line = 3;
        s.wraps
            .push(wrap("pkg:@nestjs/common#Controller", WrapKind::Decorator));
        s.wraps.push(wrap(base, WrapKind::Extends));
    })];
    for (k, r) in routes.iter().enumerate() {
        symbols.push(sym(r, SymbolKind::Function, |s| s.line = 5 + k as u32));
    }
    let mut f = file_with(path, "server", symbols);
    for r in routes {
        f.entry_points.push(EntryPoint {
            symbol: (*r).into(),
            kind: "http".into(),
            method: Some("POST".into()),
            route: Some(r.to_string()),
            adapter: "nestjs".into(),
        });
    }
    f
}

#[test]
fn a_nest_base_controller_is_a_guard_and_its_routes_classes_are_never_exempt() {
    // 30 controllers extend the team's `AuthedController`; their routes are methods, so
    // the classes count as entry points and the base as a guard. A webhook controller
    // on a package handler base, named for it, is an outlier.
    let authed = "server/src/auth/authed.ts#AuthedController";
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            nest_controller(
                &format!("server/src/x{i}/x{i}.controller.ts"),
                &format!("X{i}Controller"),
                authed,
                &[&format!("POST /x{i}")],
            )
        })
        .collect();
    files.push(nest_controller(
        "server/src/stripe/stripe.controller.ts",
        "StripeWebhookHandler",
        "pkg:svix-nest#WebhookHandler",
        &["POST /stripe/purge-everything"],
    ));
    files.push(file_with(
        "server/src/auth/authed.ts",
        "server",
        vec![sym("AuthedController", SymbolKind::Class, |_| {})],
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("server/src/util/u{i}.ts"),
            "server",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(authed))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["StripeWebhookHandler"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["StripeWebhookHandler"]);
}

/// 40 handlers on the team's `TeamHandler`, each with a `get` route (Python names a
/// view's routes `Class.method`), plus the classes `extra` adds.
fn authed_handlers(extra: Vec<FileFacts>) -> RepoFacts {
    let authed = "app/kit.py#TeamHandler";
    let mut files = Vec::new();
    for i in 0..40 {
        let name = format!("H{i}Handler");
        let mut f = py(
            &format!("app/h{i}/handlers.py"),
            vec![class(&name, |s| {
                s.wraps.push(wrap(authed, WrapKind::Extends))
            })],
        );
        f.entry_points.push(entry(
            &format!("{name}.get"),
            "http",
            Some(&format!("/h{i}")),
        ));
        files.push(f);
    }
    files.push(py(
        "app/kit.py",
        vec![class("TeamHandler", |s| s.traits.push("base".into()))],
    ));
    files.extend(extra);
    plain_classes(&mut files);
    repo(files)
}

#[test]
fn no_exemption_under_a_python_guard() {
    // `StripeWebhookEndpoint(HTTPEndpoint)` is named for its own base, and would be
    // exempt under another rule; `PurgeResource(Resource)` is a route's class. Under
    // `TeamHandler`, which guards the routes, both are outliers.
    let authed = "app/kit.py#TeamHandler";
    let mut purge = py(
        "app/purge/handlers.py",
        vec![class("PurgeResource", |s| {
            s.wraps
                .push(wrap("pkg:flask_restful#Resource", WrapKind::Extends));
        })],
    );
    purge
        .entry_points
        .push(entry("PurgeResource.post", "http", Some("/purge")));
    let r = authed_handlers(vec![
        py(
            "app/stripe/handlers.py",
            vec![class("StripeWebhookEndpoint", |s| {
                s.wraps.push(wrap(
                    "pkg:starlette#endpoints.HTTPEndpoint",
                    WrapKind::Extends,
                ));
            })],
        ),
        purge,
    ]);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(authed))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["PurgeResource", "StripeWebhookEndpoint"]);
    assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
}

#[test]
fn named_for_base_and_enum_exemptions_go_through_the_gate() {
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, View, units};
    let exemption = |r: &RepoFacts, rule: &Rule, symbol: &str| {
        let all = units(r, &FileKinds::learn(r));
        let ctx = RepoContext::new(r, &all);
        let u = all
            .iter()
            .find(|u| u.name() == symbol && matches!(u.view, View::Symbol(..)))
            .unwrap();
        (
            rule.exemption(&u.view, &ctx).map(|e| e.code),
            rule.exemption_allowed(&u.view, &ctx),
        )
    };
    // named_for_base: a field among handlers, allowed until the rule is a guard.
    let authed = "app/kit.py#TeamHandler";
    let field = || {
        py(
            "app/f/fields.py",
            vec![class("PriorityField", |s| {
                s.wraps
                    .push(wrap("pkg:django#forms.ChoiceField", WrapKind::Extends));
            })],
        )
    };
    let plain = {
        let mut files = vec![field()];
        files.push(py(
            "app/kit.py",
            vec![class("TeamHandler", |s| s.traits.push("base".into()))],
        ));
        for i in 0..10 {
            files.push(py(
                &format!("app/h{i}/handlers.py"),
                vec![class(&format!("H{i}Handler"), |s| {
                    s.wraps.push(wrap(authed, WrapKind::Extends))
                })],
            ));
        }
        repo(files)
    };
    let rule = extends_rule(authed);
    assert_eq!(
        exemption(&plain, &rule, "PriorityField"),
        (Some("named_for_base".into()), true)
    );
    let guarded = authed_handlers(vec![field()]);
    assert_eq!(exemption(&guarded, &rule, "PriorityField"), (None, false));
    // enum: an integer enum under "extend StrEnum", allowed until an entry point is
    // built on `StrEnum` (the rule is then a guard), and never for an entry point.
    let str_enum = "pkg:python:enum#StrEnum";
    let int_enum = |name: &str| {
        class(name, |s| {
            s.wraps
                .push(wrap("pkg:python:enum#IntEnum", WrapKind::Extends));
            s.traits.push("enum".into());
        })
    };
    let rule = extends_rule(str_enum);
    let enums = repo(vec![py("app/e.py", vec![int_enum("Priority")])]);
    assert_eq!(
        exemption(&enums, &rule, "Priority"),
        (Some("enum".into()), true)
    );
    let mut view = py(
        "app/v.py",
        vec![class("StatusView", |s| {
            s.wraps.push(wrap(str_enum, WrapKind::Extends));
        })],
    );
    view.entry_points
        .push(entry("StatusView", "http", Some("/s")));
    let guarded = repo(vec![py("app/e.py", vec![int_enum("Priority")]), view]);
    assert_eq!(exemption(&guarded, &rule, "Priority"), (None, false));
    let mut entry_enum = py("app/e.py", vec![int_enum("Priority")]);
    entry_enum
        .entry_points
        .push(entry("Priority", "http", Some("/p")));
    assert_eq!(
        exemption(&repo(vec![entry_enum]), &rule, "Priority"),
        (None, false)
    );
}

#[test]
fn a_base_named_for_access_control_is_a_guard() {
    // `TenantScopedModel` guards no entry point, but its name says access control: a
    // field named for its own base among the models is not exempt from it, while the
    // same field is under a plain team base.
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, View, units};
    let with_base = |base: &str| {
        let mut files = vec![py(
            "app/m/fields.py",
            vec![class("PriorityField", |s| {
                s.wraps
                    .push(wrap("pkg:django#forms.ChoiceField", WrapKind::Extends));
            })],
        )];
        files.push(py(
            "app/kit.py",
            vec![class(base.rsplit('#').next().unwrap(), |s| {
                s.traits.push("base".into())
            })],
        ));
        for i in 0..10 {
            files.push(py(
                &format!("app/m{i}/models.py"),
                vec![class(&format!("M{i}"), |s| {
                    s.wraps.push(wrap(base, WrapKind::Extends))
                })],
            ));
        }
        let r = repo(files);
        let all = units(&r, &FileKinds::learn(&r));
        let ctx = RepoContext::new(&r, &all);
        let u = all.iter().find(|u| u.name() == "PriorityField").unwrap();
        extends_rule(base)
            .exemption(&u.view, &ctx)
            .map(|e| e.code)
            .filter(|_| matches!(u.view, View::Symbol(..)))
    };
    assert_eq!(
        with_base("app/kit.py#TeamModel"),
        Some("named_for_base".into())
    );
    for guard in [
        "app/kit.py#TenantScopedModel",
        "app/kit.py#RowLevelSecurityModel",
        "app/kit.py#LoginRequiredMixin",
    ] {
        assert_eq!(with_base(guard), None, "{guard}");
    }
    assert!(drift_mine::vocab::refuse::names_access_control(
        "app/auth.py#requires_auth"
    ));
    assert!(drift_mine::vocab::refuse::names_access_control(
        "pkg:x#policies.ReadPolicy"
    ));
    for name in [
        "app/kit.ts#AuthedController",
        "app/kit.py#TokenAuthenticator",
        "app/kit.py#RequestAuthorizer",
        "app/kit.ts#GuardedRoute",
        "app/kit.py#SecuredView",
    ] {
        assert!(
            drift_mine::vocab::refuse::names_access_control(name),
            "{name}"
        );
    }
    assert!(!drift_mine::vocab::refuse::names_access_control(
        "app/kit.py#ChoiceSet"
    ));
}

// ---------------------------------------------------------------------------
// Classes a route runs are entry classes (follow-up to #45): a route whose handler
// constructs a class or calls a method on it is that class's route, and what the class
// extends guards it.

const HANDLER_BASE: &str = "src/lib/base.handler.ts#BaseHandler";

/// 30 Express handler classes on the team's `BaseHandler` (`src/handlers/*.handler.ts`),
/// a route per handler in `src/routes.ts` when `routed` (`app.post("/x", (req, res) =>
/// new XHandler().handle(req, res))`), the base, 100 plain classes and `extra`. Each
/// `extra_routes` entry is a route calling the given callee.
fn express_handlers(routed: bool, extra: Vec<FileFacts>, extra_routes: &[&str]) -> RepoFacts {
    let mut files = Vec::new();
    let mut routes = Vec::new();
    for i in 0..30 {
        let path = format!("src/handlers/x{i}.handler.ts");
        let name = format!("X{i}Handler");
        if routed {
            routes.push((format!("POST /x{i}"), format!("{path}#{name}(new)")));
        }
        files.push(file_with(
            &path,
            "",
            vec![sym(&name, SymbolKind::Class, |s| {
                s.wraps.push(wrap(HANDLER_BASE, WrapKind::Extends))
            })],
        ));
    }
    for (k, callee) in extra_routes.iter().enumerate() {
        routes.push((format!("POST /extra{k}"), (*callee).to_string()));
    }
    let mut r = file_with(
        "src/routes.ts",
        "",
        routes
            .iter()
            .map(|(name, callee)| {
                sym(name, SymbolKind::Function, |s| {
                    s.exported_as.clear();
                    s.calls.push(callee.clone());
                })
            })
            .collect(),
    );
    for (name, _) in &routes {
        r.entry_points.push(entry(name, "http", Some(name)));
    }
    files.push(r);
    files.push(file_with(
        "src/lib/base.handler.ts",
        "",
        vec![sym("BaseHandler", SymbolKind::Class, |_| {})],
    ));
    for i in 0..100 {
        files.push(file_with(
            &format!("src/util/u{i}.ts"),
            "",
            vec![sym(&format!("U{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    files.extend(extra);
    repo(files)
}

/// `src/handlers/<file>.handler.ts` with one class on a package base it is named for.
fn package_processor(file: &str, name: &str, base: &str) -> FileFacts {
    file_with(
        &format!("src/handlers/{file}.handler.ts"),
        "",
        vec![sym(name, SymbolKind::Class, |s| {
            s.wraps.push(wrap(base, WrapKind::Extends))
        })],
    )
}

const STRIPE: &str = "src/handlers/stripe.handler.ts#StripeWebhookProcessor";

#[test]
fn an_express_handler_class_a_route_constructs_is_never_exempt() {
    // The reviewers' repro (#45): every route constructs a `BaseHandler` subclass, and
    // one constructs `StripeWebhookProcessor extends WebhookProcessor` (svix), named for
    // its base. The processor is the route's class, and `BaseHandler` guards the routes
    // that run its subclasses: it is an outlier, never exempt.
    let r = express_handlers(
        true,
        vec![package_processor(
            "stripe",
            "StripeWebhookProcessor",
            "pkg:svix#WebhookProcessor",
        )],
        &[&format!("{STRIPE}(new)")],
    );
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(HANDLER_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["StripeWebhookProcessor"]);
    assert!(
        c.exempt
            .iter()
            .all(|e| e.symbol != "StripeWebhookProcessor"),
        "{:?}",
        exempt_of(c)
    );
    let p = accept_all(&r, &cs);
    assert_eq!(violators_of(&r, &p, &c.id), ["StripeWebhookProcessor"]);
}

#[test]
fn a_class_a_route_runs_is_an_entry_class_and_its_bases_guard() {
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, units};
    // (the processor is an entry class, svix's base is a guard, `BaseHandler` is a guard,
    // `X3Handler` is an entry class)
    let probe = |r: &RepoFacts| {
        let all = units(r, &FileKinds::learn(r));
        let ctx = RepoContext::new(r, &all);
        (
            ctx.is_entry_class("src/handlers/stripe.handler.ts", "StripeWebhookProcessor"),
            ctx.is_guard("pkg:svix#WebhookProcessor"),
            ctx.is_guard(HANDLER_BASE),
            ctx.is_entry_class("src/handlers/x3.handler.ts", "X3Handler"),
        )
    };
    let processor = || {
        let mut f = package_processor(
            "stripe",
            "StripeWebhookProcessor",
            "pkg:svix#WebhookProcessor",
        );
        f.symbols[0].exported_as.push("default".into());
        f
    };
    // Each way a handler runs a class directly: constructs it, passes a method as the
    // handler, or (Python) calls it or a method on a fresh instance; a default export is
    // reached by its exported name. What it is built on then guards the route.
    for callee in [
        format!("{STRIPE}(new)"),
        format!("{STRIPE}.handle(ref)"),
        format!("{STRIPE}().handle"),
        STRIPE.to_string(),
        "src/handlers/stripe.handler.ts#default(new)".to_string(),
    ] {
        let r = express_handlers(false, vec![processor()], &[&callee]);
        assert_eq!(probe(&r), (true, true, false, false), "{callee}");
    }
    // A static or class method call (`Choices.values()`) makes the class the route's,
    // but runs nothing of its bases: they guard nothing.
    let r = express_handlers(false, vec![processor()], &[&format!("{STRIPE}.verify")]);
    assert_eq!(probe(&r), (true, false, false, false));
    // Two steps away is not direct: a manager or a field of the class.
    for callee in [
        format!("{STRIPE}.objects.filter"),
        format!("{STRIPE}.client.send"),
    ] {
        let r = express_handlers(false, vec![processor()], &[&callee]);
        assert_eq!(probe(&r), (false, false, false, false), "{callee}");
    }
    // Routes that construct the team's handlers make its base a guard.
    let r = express_handlers(true, vec![processor()], &[]);
    assert_eq!(probe(&r), (false, false, true, true));
}

#[test]
fn under_a_base_routes_run_no_member_is_exempt() {
    // `BaseHandler` guards the routes that construct its subclasses. A processor no
    // route runs is still an outlier under it: the rule is a guard rule.
    let r = express_handlers(
        true,
        vec![package_processor(
            "csv",
            "CsvExportProcessor",
            "pkg:csv-kit#ExportProcessor",
        )],
        &[],
    );
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(HANDLER_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["CsvExportProcessor"]);
    assert!(
        c.exempt.iter().all(|e| e.symbol != "CsvExportProcessor"),
        "{:?}",
        exempt_of(c)
    );
}

#[test]
fn a_helper_class_only_a_non_entry_function_constructs_stays_exempt() {
    // No route runs the handlers here (they are dispatched elsewhere), so `BaseHandler`
    // guards nothing. `CsvExportProcessor`, named for its package base, is constructed
    // by a plain function, not a route: it stays exempt. Once a route constructs it, it
    // is the route's class and an outlier.
    let helper = || package_processor("csv", "CsvExportProcessor", "pkg:csv-kit#ExportProcessor");
    let builder = func("src/jobs/export.ts", "runExport", |s| {
        s.calls
            .push("src/handlers/csv.handler.ts#CsvExportProcessor(new)".into())
    });
    let r = express_handlers(false, vec![helper(), builder.clone()], &[]);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(HANDLER_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert!(outliers(c).is_empty(), "{:?}", outliers(c));
    assert!(
        exempt_of(c).contains(&(
            "CsvExportProcessor",
            "a processor, named for its base ExportProcessor"
        )),
        "{:?}",
        exempt_of(c)
    );
    let r = express_handlers(
        false,
        vec![helper(), builder],
        &["src/handlers/csv.handler.ts#CsvExportProcessor(new)"],
    );
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(HANDLER_BASE))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert_eq!(outliers(c), ["CsvExportProcessor"]);
}

#[test]
fn a_flask_view_that_instantiates_a_class_makes_it_an_entry_class() {
    // The Python analogue: 40 view functions each return `XHandler().handle(request)`
    // (`x.py#XHandler` and `x.py#XHandler().handle` in their calls); one runs
    // `StripeWebhookProcessor(WebhookProcessor)` (svix), named for its base. It is an
    // outlier; a processor only a task builds stays exempt.
    let base = "app/kit.py#BaseHandler";
    let with = |routed_stripe: bool| {
        let mut files = Vec::new();
        let mut views = Vec::new();
        for i in 0..40 {
            let module = format!("app/h{i}/handlers.py");
            let name = format!("H{i}Handler");
            views.push((
                format!("h{i}_view"),
                vec![
                    format!("{module}#{name}"),
                    format!("{module}#{name}().handle"),
                ],
            ));
            files.push(py(
                &module,
                vec![class(&name, |s| {
                    s.wraps.push(wrap(base, WrapKind::Extends))
                })],
            ));
        }
        let stripe = "app/stripe/handlers.py#StripeWebhookProcessor";
        if routed_stripe {
            views.push((
                "stripe_view".into(),
                vec![stripe.to_string(), format!("{stripe}().handle")],
            ));
        }
        let mut routes = py(
            "app/routes.py",
            views
                .iter()
                .map(|(n, calls)| sym(n, SymbolKind::Function, |s| s.calls = calls.clone()))
                .collect(),
        );
        for (n, _) in &views {
            routes.entry_points.push(entry(n, "http", Some(n)));
        }
        files.push(routes);
        files.push(py(
            "app/kit.py",
            vec![class("BaseHandler", |s| s.traits.push("base".into()))],
        ));
        files.push(py(
            "app/stripe/handlers.py",
            vec![class("StripeWebhookProcessor", |s| {
                s.wraps.push(wrap(
                    "pkg:svix#webhooks.WebhookProcessor",
                    WrapKind::Extends,
                ))
            })],
        ));
        plain_classes(&mut files);
        repo(files)
    };
    for routed in [true, false] {
        let r = with(routed);
        let cs = mined(&r);
        let c = cs
            .iter()
            .find(|c| c.rule == extends_rule(base))
            .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
        // Either way the views run `BaseHandler` subclasses, so the rule is a guard.
        assert_eq!(outliers(c), ["StripeWebhookProcessor"], "routed: {routed}");
        assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
    }
}

#[test]
fn a_python_helper_only_a_task_instantiates_stays_exempt() {
    // Counter-case: the handlers are not run by views, and `ReportProcessor(Processor)`
    // is only instantiated by a Celery task body, which is not an entry point here.
    let base = "app/kit.py#BaseHandler";
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(py(
            &format!("app/h{i}/handlers.py"),
            vec![class(&format!("H{i}Handler"), |s| {
                s.wraps.push(wrap(base, WrapKind::Extends))
            })],
        ));
    }
    files.push(py(
        "app/kit.py",
        vec![class("BaseHandler", |s| s.traits.push("base".into()))],
    ));
    files.push(py(
        "app/report/handlers.py",
        vec![class("ReportProcessor", |s| {
            s.wraps
                .push(wrap("pkg:pipeline#Processor", WrapKind::Extends))
        })],
    ));
    files.push(py(
        "app/report/tasks.py",
        vec![sym("build_report", SymbolKind::Function, |s| {
            s.calls = vec![
                "app/report/handlers.py#ReportProcessor".into(),
                "app/report/handlers.py#ReportProcessor().run".into(),
            ]
        })],
    ));
    plain_classes(&mut files);
    let r = repo(files);
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == extends_rule(base))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert!(outliers(c).is_empty(), "{:?}", outliers(c));
    assert_eq!(
        exempt_of(c),
        [(
            "ReportProcessor",
            "a processor, named for its base Processor"
        )]
    );
}

#[test]
fn a_single_file_scan_defers_a_class_a_route_elsewhere_may_run() {
    // The hook's single-file facts for `stripe.handler.ts` (with the base file as
    // context) hold no route: the processor looks exempt there. A route in another file
    // constructs it, so the facts defer to a full scan, which reports it.
    let stripe = package_processor(
        "stripe",
        "StripeWebhookProcessor",
        "pkg:svix#WebhookProcessor",
    );
    let full = express_handlers(true, vec![stripe.clone()], &[&format!("{STRIPE}(new)")]);
    let cs = mined(&express_handlers(true, vec![], &[]));
    let p = accept_all(&full, &cs);
    let c = p
        .conventions
        .iter()
        .find(|c| c.rule == extends_rule(HANDLER_BASE))
        .unwrap();
    assert_eq!(violators_of(&full, &p, &c.id), ["StripeWebhookProcessor"]);
    let mut alone = repo(vec![stripe]);
    alone.context_files.push(
        full.files
            .iter()
            .find(|f| f.path == "src/lib/base.handler.ts")
            .unwrap()
            .clone(),
    );
    assert!(drift_mine::check::needs_full_scan(&alone, &p));
    // A class the gate already refuses in the file's own facts is decided there: a
    // route in the same file constructs it.
    let mut own = package_processor(
        "stripe",
        "StripeWebhookProcessor",
        "pkg:svix#WebhookProcessor",
    );
    own.symbols
        .push(sym("POST /stripe", SymbolKind::Function, |s| {
            s.exported_as.clear();
            s.calls.push(format!("{STRIPE}(new)"));
        }));
    own.entry_points
        .push(entry("POST /stripe", "http", Some("/stripe")));
    assert!(!drift_mine::check::needs_full_scan(&repo(vec![own]), &p));
}

// F1 (review of #51): a hook's single-file facts with a call wrapper whose binding sits
// in a file the scan did not load cannot tell whether that binding is built on the
// rule's wrapper: the hook falls back to a full scan. With the file as context (what
// the TypeScript single-file scan loads), it decides, and agrees with a full check.
#[test]
fn an_open_call_wrapper_chain_needs_a_full_scan() {
    let mut files = wrapped_handlers("app/api", "");
    for i in 0..80 {
        files.push(func(&format!("lib/l{i}.ts"), "helper", |_| {}));
    }
    let r = repo(files.clone());
    let cs = mined(&r);
    let id = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Call,
                    any_of: vec![AUTH.into()],
                }
        })
        .unwrap_or_else(|| panic!("handlers are wrapped in withAuth: {cs:?}"))
        .id
        .clone();
    let p = accept_all(&r, &cs);
    let new = file_with(
        "app/api/app-api-new.ts",
        "",
        vec![sym("handler", SymbolKind::Function, |s| {
            s.wraps
                .push(wrap("lib/bookings.ts#bookingsAuth", WrapKind::Call));
        })],
    );
    let bookings = |derives_from: &str| FileFacts {
        path: "lib/bookings.ts".into(),
        lang: "ts".into(),
        symbols: vec![sym("bookingsAuth", SymbolKind::Const, |s| {
            s.derives_from = derives_from.into();
        })],
        ..Default::default()
    };
    let alone = repo(vec![new.clone()]);
    assert!(drift_mine::check::needs_full_scan(&alone, &p));
    // The binding's file as context: built on withAuth, the handler holds the rule.
    let mut with_context = alone.clone();
    with_context.context_files = vec![bookings("lib/auth.ts#withAuth.use()")];
    assert!(!drift_mine::check::needs_full_scan(&with_context, &p));
    assert!(violators_of(&with_context, &p, &id).is_empty());
    // Built on nothing: decided too, and a violation, as in a full check.
    let mut plain = alone.clone();
    plain.context_files = vec![bookings("")];
    assert!(!drift_mine::check::needs_full_scan(&plain, &p));
    assert_eq!(violators_of(&plain, &p, &id), ["handler"]);
    files.push(new);
    files.push(bookings(""));
    assert!(violators_of(&repo(files), &p, &id).contains(&"handler".to_string()));
}

// Guard-shaped alternatives of a variant set: error classes named for turning a caller
// away, and libraries' own guards, are read as guards; their open or neutral siblings
// are not.
#[test]
fn rejection_classes_and_library_guards() {
    use drift_mine::security::library_guard;
    use drift_mine::vocab::grant::rejection_class;
    for t in [
        "lib/errors.ts#UnauthorizedError",
        "pkg:@nestjs/common#ForbiddenException",
        "pkg:rest_framework#exceptions.AuthenticationFailed",
        "pkg:starlette#authentication.AuthenticationError",
        "pkg:django#core.exceptions.PermissionDenied",
        "pkg:rest_framework#exceptions.NotAuthenticated",
        "lib/errors.ts#AuthorizationError(new)",
    ] {
        assert!(rejection_class(t), "{t}");
    }
    for t in [
        "pkg:@trpc/server#TRPCError",
        "lib/errors.ts#BadRequestError",
        "pkg:fastapi#HTTPException",
        "lib/errors.ts#AuthorError",
        // A built-in about something else: an operating-system file error.
        "global#PermissionError",
        "pkg:python:builtins#PermissionError",
    ] {
        assert!(!rejection_class(t), "{t}");
    }
    for g in [
        "pkg:rest_framework#permissions.IsAuthenticated",
        "pkg:django#contrib.auth.decorators.login_required",
        "pkg:fastapi#security.OAuth2PasswordBearer",
        "pkg:@fastify/passport#Authenticator(new)",
        "pkg:next-auth/middleware#withAuth",
    ] {
        assert!(library_guard(g), "{g}");
    }
    for g in [
        "pkg:rest_framework#permissions.AllowAny",
        "pkg:fastapi#Depends",
        "pkg:next-safe-action#createSafeActionClient",
        // FastAPI's request forms and credential models are no schemes.
        "pkg:fastapi#security.OAuth2PasswordRequestForm",
        "pkg:fastapi#security.HTTPBasicCredentials",
        "pkg:fastapi#security.SecurityScopes",
        "pkg:iron-session#withIronSessionApiRoute",
    ] {
        assert!(!library_guard(g), "{g}");
    }
}

// The variant-set guard classifier (`security::authenticates`), on definitions: a
// procedure built with a middleware that throws UNAUTHORIZED is a guard; a public one is
// not even when its middleware rejects some callers (rate limits); nor is one built with
// an error-mapping middleware or a logger; nor a package export the classifier does not
// know (`withIronSessionApiRoute`), nor a FastAPI scheme the repo builds with
// `auto_error`; an unresolved in-repo wrapper counts only when its name authenticates.
#[test]
fn authenticates_reads_definitions() {
    use drift_core::controls::REJECTS_CALLER;
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, units};
    use drift_mine::security::authenticates;
    let rejecting = |name: &str| {
        sym(name, SymbolKind::Function, |s| {
            s.controls = vec![REJECTS_CALLER.into(), "throw".into()];
        })
    };
    let built = |name: &str, middleware: &str| {
        sym(name, SymbolKind::Const, |s| {
            s.derives_from = "server/trpc.ts#t.procedure.use()".into();
            s.calls = vec![format!("server/mw.ts#{middleware}(ref)")];
        })
    };
    let r = repo(vec![
        file_with(
            "server/mw.ts",
            "",
            vec![
                rejecting("isAuthed"),
                rejecting("rateLimit"),
                sym("errors", SymbolKind::Function, |s| {
                    s.controls = vec!["throw".into(), "try".into()];
                    s.throws = vec!["pkg:@trpc/server#TRPCError".into()];
                }),
            ],
        ),
        file_with(
            "server/procedures.ts",
            "",
            vec![
                built("authedProcedure", "isAuthed"),
                built("publicProcedure", "rateLimit"),
                built("procedure", "errors"),
            ],
        ),
        file_with(
            "app/deps.py",
            "",
            vec![
                sym("oauth2_optional", SymbolKind::Variable, |s| {
                    s.args = vec!["pkg:fastapi#security.HTTPBearer@99:auto_error".into()];
                }),
                // `APIKeyHeader(**OPTS)`: the options may carry `auto_error=False`.
                sym("header_scheme", SymbolKind::Variable, |s| {
                    s.args = vec![format!(
                        "pkg:fastapi#security.APIKeyHeader@99:{}",
                        drift_core::SPLAT_KEY
                    )];
                }),
                // An in-repo subclass (`super().__init__(auto_error=False)`, or a
                // `__call__` that returns None on a missing token).
                sym("ProjectBearer", SymbolKind::Class, |s| {
                    s.wraps = vec![wrap(
                        "pkg:fastapi#security.OAuth2PasswordBearer",
                        WrapKind::Extends,
                    )];
                    s.calls = vec!["pkg:fastapi#security.OAuth2PasswordBearer.__init__".into()];
                }),
            ],
        ),
    ]);
    let all = units(&r, &FileKinds::learn(&r));
    let ctx = RepoContext::new(&r, &all);
    for (w, want) in [
        ("server/procedures.ts#authedProcedure", true),
        ("server/procedures.ts#authedProcedure.query", true),
        // Names that open access are never guards, whatever their middleware does.
        ("server/procedures.ts#publicProcedure", false),
        // Converting errors caught from deeper code authenticates no one.
        ("server/procedures.ts#procedure", false),
        ("pkg:iron-session#withIronSessionApiRoute", false),
        ("pkg:fastapi#security.OAuth2PasswordBearer", true),
        ("pkg:fastapi#security.HTTPBearer", false),
        ("pkg:fastapi#security.OAuth2PasswordRequestForm", false),
        ("pkg:fastapi#security.APIKeyHeader", false),
        ("app/deps.py#ProjectBearer", false),
        // Not in the facts: only a name that authenticates.
        ("lib/missing.ts#withAuth", true),
        ("lib/missing.ts#withTenantScope", false),
        // `session` and `private` say what a wrapper opens, not that it rejects.
        ("lib/missing.ts#withDbSession", false),
        ("lib/missing.ts#privateRoute", false),
    ] {
        assert_eq!(authenticates(&ctx, w), want, "{w}");
    }
}

// #50's sibling join meets #60: in a set of guards, a sibling named like one
// (`protectedProcedure`) whose definition rejects no caller does not join; it stays an
// outlier to review.
#[test]
fn a_sibling_that_rejects_no_caller_never_joins_a_guard_set() {
    const AUTHED: &str = "src/trpc.ts#authenticatedProcedure";
    let mut files = sibling_scenario(
        "defined",
        WrapKind::Call,
        &[AUTHED],
        "src/trpc.ts#protectedProcedure",
        4,
    );
    files.push(file_with(
        "defined/src/trpc.ts",
        "defined",
        vec![sym("protectedProcedure", SymbolKind::Const, |s| {
            s.derives_from = "defined/src/trpc.ts#t.procedure".into();
        })],
    ));
    background(&mut files);
    let r = repo(files);
    let cs = mined(&r);
    let c = wrapper_rule_in(&cs, "defined", AUTHED);
    assert_eq!(any_of(c), [format!("defined/{AUTHED}")]);
    assert_eq!(outliers(c), ["bare", "odd"]);
}

// The example of a convention is a member every convention of its role is about: a
// rule holds vacuously for a member it exempts, so the module's own base (`BaseEmail`,
// the target of "extend `BaseEmail`") would otherwise satisfy every rule of the role
// and become the example of "named `*Email`" (cal.com, novu's `BaseProvider`).
#[test]
fn the_example_is_never_a_member_exempt_from_a_convention_of_its_role() {
    const BASE: &str = "mailer/templates/_base-email.ts#BaseEmail";
    let mut files = vec![file_with(
        "mailer/templates/_base-email.ts",
        "",
        vec![sym("BaseEmail", SymbolKind::Class, |_| {})],
    )];
    for i in 0..30 {
        let name = if i < 3 {
            format!("Notice{i}")
        } else {
            format!("Thing{i}Email")
        };
        files.push(file_with(
            &format!("mailer/templates/t{i}.ts"),
            "",
            vec![sym(&name, SymbolKind::Class, |s| {
                s.wraps.push(wrap(BASE, WrapKind::Extends));
            })],
        ));
        files.push(file_with(
            &format!("misc/k{i}.ts"),
            "",
            vec![sym(&format!("Keeper{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let cs = mined(&repo(files));
    let extends = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Extends,
                    any_of: vec![BASE.into()],
                }
        })
        .expect("extend BaseEmail");
    assert!(
        extends.exempt.iter().any(|e| e.symbol == "BaseEmail"),
        "{:?}",
        extends.exempt
    );
    let named = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::Named {
                    pattern: "*Email".into(),
                }
        })
        .expect("named *Email");
    assert_eq!(named.role, extends.role);
    for c in [named, extends] {
        assert_ne!(c.example, BASE, "{}", c.id);
        assert!(c.example.starts_with("mailer/templates/t"), "{}", c.example);
    }
}

// The same for a call rule's own target (midday's `createTRPCRouter`, exempt from "call
// `createTRPCRouter()` as its own target, and named like the routers that call it). A
// worker outside the role builds a router too, so it is no shared part of the role.
#[test]
fn the_example_is_never_the_own_target_of_a_convention_of_its_role() {
    const MAKE: &str = "api/trpc/init.ts#createTRPCRouter";
    let mut files = vec![file_with(
        "api/trpc/init.ts",
        "",
        vec![sym("createTRPCRouter", SymbolKind::Function, |_| {})],
    )];
    for i in 0..30 {
        let name = if i < 2 {
            format!("helper{i}")
        } else {
            format!("thing{i}Router")
        };
        files.push(file_with(
            &format!("api/trpc/routers/r{i}.ts"),
            "",
            vec![sym(&name, SymbolKind::Function, |s| {
                if i >= 2 {
                    s.calls.push(MAKE.into());
                }
            })],
        ));
        files.push(func(&format!("misc/m{i}.ts"), &format!("keep{i}"), |_| {}));
    }
    files.push(func("worker/jobs.ts", "jobsRouter", |s| {
        s.calls.push(MAKE.into())
    }));
    let cs = mined_every(&repo(files));
    let calls = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::Calls {
                    callee: MAKE.into(),
                }
        })
        .expect("call createTRPCRouter()");
    assert!(
        calls
            .exempt
            .iter()
            .any(|e| e.symbol == "createTRPCRouter" && e.code == "own_target"),
        "{:?}",
        calls.exempt
    );
    let named = cs
        .iter()
        .find(|c| {
            c.rule
                == Rule::Named {
                    pattern: "*Router".into(),
                }
        })
        .expect("named *Router");
    assert_eq!(named.role, calls.role);
    for c in [named, calls] {
        assert_ne!(c.example, MAKE, "{}", c.id);
        assert!(c.example.starts_with("api/trpc/routers/"), "{}", c.example);
    }
}

// ---------------------------------------------------------------------------
// A class a view only constructs (netbox's `filtersets.X(request.POST, qs).qs`,
// `SearchForm(request.GET)`) is an entry class (#64), and what it is built on guards
// the view. A registry function it is decorated with (`register_filterset` files the
// class in a registry at import and hands it back unchanged) runs nothing with the
// view: it is no guard, and a class that leaves it off is exempt as before (F8's
// taken registry key, F3's another kind). A decorator that changes or wraps the class,
// one named for access control, and every base stay guards.

const FILTERSET_BASE: &str = "app/utilities/base.py#BaseFilterSet";

/// Netbox's filtersets: 30 `app/m<i>/filtersets.py#M<i>FilterSet`s on `BaseFilterSet`
/// (`app/utilities/base.py`),
/// decorated with `app/utilities/filtersets.py#<decorator>` and keyed by their own
/// `Meta.model`; a secondary `M0ConnectionFilterSet` for `M0`'s model without it; a
/// view per filterset that constructs it, and one that constructs the secondary. The
/// decorator files its argument in a registry when `registry`.
fn netbox_filtersets(decorator: &str, registry: bool) -> RepoFacts {
    let target = format!("app/utilities/filtersets.py#{decorator}");
    let mut files = vec![py(
        "app/utilities/filtersets.py",
        vec![sym(decorator, SymbolKind::Function, |s| {
            if registry {
                s.controls.push(drift_core::controls::REGISTERS_ARG.into());
            }
        })],
    )];
    files.push(py(
        "app/utilities/base.py",
        vec![class("BaseFilterSet", |_| {})],
    ));
    let mut views = Vec::new();
    for i in 0..30 {
        let path = format!("app/m{i}/filtersets.py");
        let mut symbols = vec![class(&format!("M{i}FilterSet"), |s| {
            s.wraps.push(wrap(&target, WrapKind::Decorator));
            s.wraps.push(wrap(FILTERSET_BASE, WrapKind::Extends));
            s.meta.push(format!("model=app/m{i}/models.py#M{i}"));
        })];
        if i == 0 {
            symbols.push(class("M0ConnectionFilterSet", |s| {
                s.wraps.push(wrap(FILTERSET_BASE, WrapKind::Extends));
                s.meta.push("model=app/m0/models.py#M0".into());
            }));
            views.push((
                "connections".to_string(),
                format!("{path}#M0ConnectionFilterSet"),
            ));
        }
        views.push((format!("list_m{i}"), format!("{path}#M{i}FilterSet")));
        files.push(py(&path, symbols));
    }
    let mut v = py(
        "app/views.py",
        views
            .iter()
            .map(|(name, callee)| sym(name, SymbolKind::Function, |s| s.calls.push(callee.clone())))
            .collect(),
    );
    for (name, _) in &views {
        v.entry_points.push(entry(name, "http", Some(name)));
    }
    files.push(v);
    for i in 0..60 {
        files.push(py(
            &format!("app/misc/k{i}.py"),
            vec![class(&format!("Keeper{i}"), |_| {})],
        ));
    }
    repo(files)
}

fn decorator_rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![target.into()],
    }
}

fn guards(r: &RepoFacts, target: &str) -> bool {
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, units};
    let all = units(r, &FileKinds::learn(r));
    RepoContext::new(r, &all).is_guard(target)
}

#[test]
fn a_registry_decorator_on_classes_views_construct_is_no_guard() {
    const REGISTER: &str = "app/utilities/filtersets.py#register_filterset";
    let r = netbox_filtersets("register_filterset", true);
    assert!(!guards(&r, REGISTER));
    // What the constructed classes are built on still guards the views.
    assert!(guards(&r, FILTERSET_BASE));
    let cs = mined(&r);
    let c = cs
        .iter()
        .find(|c| c.rule == decorator_rule(REGISTER))
        .unwrap_or_else(|| panic!("{:?}", listed(&cs)));
    assert!(outliers(c).is_empty(), "{:?}", outliers(c));
    assert_eq!(
        c.exempt
            .iter()
            .map(|e| (e.symbol.as_str(), e.code.as_str()))
            .collect::<Vec<_>>(),
        [("M0ConnectionFilterSet", "registered_key")]
    );
    let p = accept_all(&r, &cs);
    assert!(violators_of(&r, &p, &c.id).is_empty());
}

#[test]
fn a_decorator_that_is_no_registry_function_still_guards_the_classes_views_construct() {
    // The same decorator without a registry function's definition (it may set
    // `login_required` on the class, or wrap it), and a registry function named for
    // access control: guards, and the secondary filterset the view constructs is an
    // outlier, as #64 has it.
    for (name, registry) in [
        ("register_filterset", false),
        ("register_permission_filterset", true),
    ] {
        let target = format!("app/utilities/filtersets.py#{name}");
        let r = netbox_filtersets(name, registry);
        assert!(guards(&r, &target), "{name}");
        let cs = mined(&r);
        let c = cs
            .iter()
            .find(|c| c.rule == decorator_rule(&target))
            .unwrap_or_else(|| panic!("{name}: {:?}", listed(&cs)));
        assert_eq!(outliers(c), ["M0ConnectionFilterSet"], "{name}");
        assert!(c.exempt.is_empty(), "{name}: {:?}", exempt_of(c));
        let p = accept_all(&r, &cs);
        assert_eq!(
            violators_of(&r, &p, &c.id),
            ["M0ConnectionFilterSet"],
            "{name}"
        );
    }
}

#[test]
fn a_registry_decorator_on_a_route_class_still_guards() {
    // A registry function on the route's own class, on a class whose method is a route,
    // and on a class a route refers to by reference: what decorates the route's class
    // guards the route, whatever its definition, as before.
    const REGISTER: &str = "app/utilities/views.py#register_view";
    let registry = || {
        py(
            "app/utilities/views.py",
            vec![sym("register_view", SymbolKind::Function, |s| {
                s.controls.push(drift_core::controls::REGISTERS_ARG.into());
            })],
        )
    };
    let view = |name: &str| {
        class(name, |s| {
            s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
        })
    };
    // The class is the entry point.
    let mut own = py("app/views/own.py", vec![view("OwnView")]);
    own.entry_points
        .push(entry("OwnView", "http", Some("/own")));
    assert!(guards(&repo(vec![registry(), own]), REGISTER));
    // A route method of the class.
    let mut method = py(
        "app/views/method.py",
        vec![
            view("MethodView"),
            sym("MethodView.get", SymbolKind::Function, |_| {}),
        ],
    );
    method
        .entry_points
        .push(entry("MethodView.get", "http", Some("/method")));
    assert!(guards(&repo(vec![registry(), method]), REGISTER));
    // A route refers to the class's method by reference.
    let referred = py("app/views/referred.py", vec![view("ReferredView")]);
    let mut urls = py(
        "app/urls.py",
        vec![sym("route", SymbolKind::Function, |s| {
            s.calls
                .push("app/views/referred.py#ReferredView.as_view(ref)".into());
        })],
    );
    urls.entry_points
        .push(entry("route", "http", Some("/referred")));
    assert!(guards(&repo(vec![registry(), referred, urls]), REGISTER));
}

/// Netbox's search indexes: 30 `app/m<i>/search.py#M<i>Index`es on `SearchIndex`,
/// decorated with `app/search.py#register_search`, a `SearchForm` on Django's
/// `forms.Form` in `app/forms/search.py` that a view constructs, the view, and a view
/// class on Django's `View` in `app/legacy/search.py` that a route refers to.
fn netbox_search(registry: bool) -> RepoFacts {
    const REGISTER: &str = "app/search.py#register_search";
    let mut files = vec![py(
        "app/search.py",
        vec![sym("register_search", SymbolKind::Function, |s| {
            if registry {
                s.controls.push(drift_core::controls::REGISTERS_ARG.into());
            }
        })],
    )];
    files.push(py(
        "app/utilities/indexes.py",
        vec![class("SearchIndex", |_| {})],
    ));
    for i in 0..30 {
        files.push(py(
            &format!("app/m{i}/search.py"),
            vec![class(&format!("M{i}Index"), |s| {
                s.wraps.push(wrap(REGISTER, WrapKind::Decorator));
                s.wraps.push(wrap(
                    "app/utilities/indexes.py#SearchIndex",
                    WrapKind::Extends,
                ));
            })],
        ));
    }
    files.push(py(
        "app/forms/search.py",
        vec![class("SearchForm", |s| {
            s.wraps
                .push(wrap("pkg:django#forms.Form", WrapKind::Extends));
        })],
    ));
    // A view class in a search module that a route refers to by reference: an entry
    // class, never exempt.
    files.push(py(
        "app/legacy/search.py",
        vec![class("LegacySearchView", |s| {
            s.wraps
                .push(wrap("pkg:django#views.View", WrapKind::Extends));
        })],
    ));
    let mut urls = py(
        "app/urls.py",
        vec![sym("legacy", SymbolKind::Function, |s| {
            s.calls
                .push("app/legacy/search.py#LegacySearchView.as_view(ref)".into());
        })],
    );
    urls.entry_points
        .push(entry("legacy", "http", Some("/legacy")));
    files.push(urls);
    let mut v = py(
        "app/views.py",
        vec![sym("search", SymbolKind::Function, |s| {
            s.calls.push("app/forms/search.py#SearchForm".into());
        })],
    );
    v.entry_points
        .push(entry("search", "http", Some("/search")));
    files.push(v);
    for i in 0..60 {
        files.push(py(
            &format!("app/misc/k{i}.py"),
            vec![class(&format!("Keeper{i}"), |_| {})],
        ));
    }
    repo(files)
}

#[test]
fn a_form_a_view_constructs_is_exempt_only_under_a_registry_decorator() {
    const REGISTER: &str = "app/search.py#register_search";
    for registry in [true, false] {
        let r = netbox_search(registry);
        let cs = mined(&r);
        let c = cs
            .iter()
            .find(|c| c.rule == decorator_rule(REGISTER))
            .unwrap_or_else(|| panic!("{registry}: {:?}", listed(&cs)));
        if registry {
            assert_eq!(outliers(c), ["LegacySearchView"], "{:?}", exempt_of(c));
            assert_eq!(
                c.exempt
                    .iter()
                    .map(|e| (e.symbol.as_str(), e.code.as_str()))
                    .collect::<Vec<_>>(),
                [("SearchForm", "another_kind")]
            );
        } else {
            // The view runs the form, so it is an entry class and the gate refuses it.
            assert_eq!(outliers(c), ["SearchForm", "LegacySearchView"]);
            assert!(c.exempt.is_empty(), "{:?}", exempt_of(c));
        }
    }
}

#[test]
fn in_one_file_a_class_its_route_constructs_waits_for_the_decorator_definition() {
    // A hook's single-file scan of a filterset module whose own view constructs the
    // secondary filterset: the gate refuses it any exemption there, but the full facts
    // may show the decorator to be a registry function, which would allow one. So the
    // hook asks for a full scan rather than decide on the single file.
    use drift_mine::context::RepoContext;
    use drift_mine::roles::{FileKinds, View, units};
    const REGISTER: &str = "app/utilities/filtersets.py#register_filterset";
    let mut f = py(
        "app/m0/filtersets.py",
        vec![
            class("M0ConnectionFilterSet", |s| {
                s.meta.push("model=app/m0/models.py#M0".into());
            }),
            sym("connections", SymbolKind::Function, |s| {
                s.calls
                    .push("app/m0/filtersets.py#M0ConnectionFilterSet".into());
            }),
        ],
    );
    f.entry_points
        .push(entry("connections", "http", Some("/connections")));
    let r = repo(vec![f]);
    let all = units(&r, &FileKinds::learn(&r));
    let ctx = RepoContext::new(&r, &all);
    let file = &r.files[0];
    let class = file
        .symbols
        .iter()
        .find(|s| s.name == "M0ConnectionFilterSet")
        .unwrap();
    assert!(ctx.entry_only_as_reached(file, class));
    assert!(decorator_rule(REGISTER).exemption_undecided(
        None,
        &View::Symbol(file, class),
        &ctx,
        30
    ));
}
