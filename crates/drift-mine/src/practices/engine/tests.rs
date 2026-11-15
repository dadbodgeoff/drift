use super::*;
use drift_core::{EntryPoint, RouteMatcher, Wrap};

/// A classifier that assigns every production entry point the same way.
struct Says(fn() -> Assignment);

fn entries<'a>(cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
    cx.facts
        .files
        .iter()
        .flat_map(|file| {
            file.entry_points
                .iter()
                .filter(|e| e.kind == "http")
                .map(move |entry| UnitRef::Entry {
                    file,
                    entry,
                    symbol: cx.entry_symbol(file, entry).map(|(_, s)| s),
                })
        })
        .collect()
}

impl Concern for Says {
    fn id(&self) -> &'static str {
        AUTHN
    }
    fn unit(&self) -> &'static str {
        "entry_point"
    }
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        entries(cx)
    }
    fn assign<'a>(&self, _cx: &Cx<'a>, _u: &UnitRef<'a>) -> Assignment {
        (self.0)()
    }
}

/// A classifier whose uses are the unit's call wrappers, each with the mechanism its
/// short name says (`withSig` is service auth, `withUser` identifies, `isPublic`
/// opens; anything else wraps).
struct ByWrapper;

impl Concern for ByWrapper {
    fn id(&self) -> &'static str {
        AUTHN
    }
    fn unit(&self) -> &'static str {
        "entry_point"
    }
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        entries(cx)
    }
    fn assign<'a>(&self, _cx: &Cx<'a>, u: &UnitRef<'a>) -> Assignment {
        let UnitRef::Entry {
            symbol: Some(s), ..
        } = u
        else {
            return Assignment::None {
                label: "no guard".into(),
            };
        };
        let uses: Vec<Use> = s
            .wraps
            .iter()
            .map(|w| {
                let m = match short(&w.wrapper) {
                    "withSig" => "service_auth",
                    "withUser" => "identifies",
                    "isPublic" => "opens",
                    _ => "wrap",
                };
                Use {
                    mechanism: m.into(),
                    instrument: w.wrapper.clone(),
                }
            })
            .collect();
        if uses.is_empty() {
            return Assignment::None {
                label: "no guard".into(),
            };
        }
        Assignment::Known {
            label: label_of(&uses),
            uses,
            source: VariantSource::Usage,
        }
    }
}

fn route(path: &str, wrapper: &str, parse_ok: bool) -> FileFacts {
    let r = format!(
        "/{}",
        path.trim_start_matches("app/")
            .trim_end_matches("/route.ts")
    );
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok,
        symbols: vec![Symbol {
            name: "GET".into(),
            exported_as: vec!["GET".into()],
            line: 2,
            wraps: (!wrapper.is_empty())
                .then(|| Wrap {
                    wrapper: wrapper.into(),
                    kind: WrapKind::Call,
                })
                .into_iter()
                .collect(),
            ..Symbol::default()
        }],
        entry_points: vec![EntryPoint {
            symbol: "GET".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(r),
            adapter: "nextjs".into(),
        }],
        ..FileFacts::default()
    }
}

/// `lib/auth.ts` defining guards (each rejects its caller) of these names.
fn guards(names: &[&str]) -> FileFacts {
    FileFacts {
        path: "lib/auth.ts".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: names
            .iter()
            .map(|n| Symbol {
                name: n.to_string(),
                exported_as: vec![n.to_string()],
                line: 1,
                controls: vec![drift_core::controls::REJECTS_CALLER.to_string()],
                ..Symbol::default()
            })
            .collect(),
        ..FileFacts::default()
    }
}

fn known(uses: &[(&str, &str)]) -> Assignment {
    Assignment::Known {
        uses: uses
            .iter()
            .map(|(m, i)| Use {
                mechanism: m.to_string(),
                instrument: i.to_string(),
            })
            .collect(),
        label: "x".into(),
        source: VariantSource::Vocab,
    }
}

fn facts(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        ..RepoFacts::default()
    };
    r.normalize();
    r
}

/// `(known, none, unknown)` with all the rules, and with all but one.
fn both(
    files: Vec<FileFacts>,
    f: fn() -> Assignment,
    off: fn(&mut Guards),
) -> ((usize, usize, usize), (usize, usize, usize)) {
    let facts = facts(files);
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(f))];
    let count = |g: Guards| {
        let p = run(&facts, &Options::default(), &c, g).report.concerns[0]
            .population
            .clone();
        (p.known, p.none, p.unknown)
    };
    let mut g = Guards::ALL;
    off(&mut g);
    (count(Guards::ALL), count(g))
}

fn by_wrapper(files: Vec<FileFacts>) -> PracticesReport {
    let c: Vec<Box<dyn Concern>> = vec![Box::new(ByWrapper)];
    run(&facts(files), &Options::default(), &c, Guards::ALL).report
}

// Mutation checks: each [STRICT] rule is what makes the unit unknown; with the rule
// off, the same facts give a known or a none (so the tests that expect unknown would
// fail).

#[test]
fn mutation_unknown_dominates_known() {
    let (on, off) = both(
        vec![route("app/a/route.ts", "", true)],
        || {
            known(&[
                ("middleware", "pkg:x#mw"),
                ("body_check", "unclassified:check"),
            ])
        },
        |g| g.unknown_dominates = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (1, 0, 0)));
}

#[test]
fn mutation_unparsed() {
    let (on, off) = both(
        vec![route("app/a/route.ts", "", false)],
        || Assignment::None {
            label: "no guard".into(),
        },
        |g| g.unparsed = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (0, 1, 0)));
}

#[test]
fn mutation_false_none() {
    // A route wrapped by an in-repo wrapper the facts do not define.
    let (on, off) = both(
        vec![route("app/a/route.ts", "lib/auth.ts#withAuth", true)],
        || Assignment::None {
            label: "no guard".into(),
        },
        |g| g.false_none = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (0, 1, 0)));
}

#[test]
fn mutation_guard_filter() {
    // `get_db` is defined and rejects no one: no authn instrument.
    let deps = FileFacts {
        path: "app/deps.py".into(),
        lang: "py".into(),
        parse_ok: true,
        symbols: vec![Symbol {
            name: "get_db".into(),
            line: 1,
            ..Symbol::default()
        }],
        ..FileFacts::default()
    };
    let (on, off) = both(
        vec![route("app/a/route.ts", "", true), deps],
        || known(&[("dependency", "app/deps.py#get_db")]),
        |g| g.guard_filter = false,
    );
    assert_eq!((on, off), ((0, 1, 0), (1, 0, 0)));
    // A package's export no guard list knows: unknown, not a guard and not none.
    let (on, off) = both(
        vec![route("app/a/route.ts", "", true)],
        || known(&[("decorator", "pkg:@nestjs/common#UseGuards")]),
        |g| g.guard_filter = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (1, 0, 0)));
    // An app guard whose class rejects callers is one.
    let (on, _) = both(
        vec![route("app/a/route.ts", "", true), guards(&["JwtGuard"])],
        || known(&[("app_guard", "lib/auth.ts#JwtGuard")]),
        |g| g.guard_filter = false,
    );
    assert_eq!(on, (1, 0, 0));
}

fn middleware(patterns: &[(&str, &[&str])]) -> FileFacts {
    let mut mw = route(
        "middleware.ts",
        "pkg:@clerk/nextjs/server#clerkMiddleware",
        true,
    );
    mw.entry_points[0].kind = "middleware".into();
    mw.entry_points[0].route = None;
    // It protects what it matches: a middleware that rejects no one covers nothing.
    mw.symbols[0]
        .calls
        .push("pkg:@clerk/nextjs/server#auth.protect".into());
    mw.route_matchers = patterns
        .iter()
        .map(|(b, ps)| RouteMatcher {
            binding: b.to_string(),
            patterns: ps.iter().map(|p| p.to_string()).collect(),
            opaque: false,
            polarity: drift_core::MatcherPolarity::default(),
        })
        .collect();
    mw
}

#[test]
fn mutation_middleware_coverage() {
    // [STRICT] A matcher that cannot be read proves no coverage: unknown.
    let (on, off) = both(
        vec![
            route("app/a/route.ts", "", true),
            middleware(&[("config.matcher", &[])]),
        ],
        || Assignment::None {
            label: "no guard".into(),
        },
        |g| g.matcher = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (0, 1, 0)));
    let (on, off) = both(
        vec![
            route("app/a/route.ts", "", true),
            middleware(&[("config.matcher", &[])]),
        ],
        || known(&[("middleware", "pkg:@clerk/nextjs/server#clerkMiddleware")]),
        |g| g.matcher = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (1, 0, 0)));
    // A route the matcher excludes: the middleware use is dropped.
    let (on, off) = both(
        vec![
            route("app/a/route.ts", "", true),
            middleware(&[("config.matcher", &["/api/(.*)"])]),
        ],
        || known(&[("middleware", "pkg:@clerk/nextjs/server#clerkMiddleware")]),
        |g| g.matcher = false,
    );
    assert_eq!((on, off), ((0, 1, 0), (1, 0, 0)));
    // A `none` on a route the middleware covers: it may be the guard.
    let (on, off) = both(
        vec![
            route("app/a/route.ts", "", true),
            middleware(&[("config.matcher", &["/a"])]),
        ],
        || Assignment::None {
            label: "no guard".into(),
        },
        |g| g.matcher = false,
    );
    assert_eq!((on, off), ((0, 0, 1), (0, 1, 0)));
    // A public route: the middleware lets it through, so none stands.
    let (on, _) = both(
        vec![
            route("app/a/route.ts", "", true),
            middleware(&[("isPublicRoute", &["/a"])]),
        ],
        || Assignment::None {
            label: "no guard".into(),
        },
        |g| g.matcher = false,
    );
    assert_eq!(on, (0, 1, 0));
}

#[test]
fn a_declared_instrument_is_known_and_its_hint_round_trips() {
    // The route applies the instrument: a declaration settles a unit only where the
    // unit runs it on every path.
    let files = || {
        vec![route(
            "app/a/route.ts",
            "pkg:@nestjs/common#UseGuards",
            true,
        )]
    };
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|| {
        known(&[("decorator", "pkg:@nestjs/common#UseGuards")])
    }))];
    let r = run(&facts(files()), &Options::default(), &c, Guards::ALL).report;
    let i = &r.concerns[0].unknown.instruments[0];
    assert_eq!(i.instrument, "pkg:@nestjs/common#UseGuards");
    assert_eq!(
        i.config_hint,
        r#"practices: {authn: {"pkg:@nestjs/common#UseGuards": "UseGuards"}}"#
    );
    assert_eq!(r.findings[0].kind, FindingKind::Unknown);
    assert_eq!(
        r.findings[0].config_hint.as_deref(),
        Some(i.config_hint.as_str())
    );
    // The hint, written to .drift/config.yaml, is what the config reader accepts ...
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".drift")).unwrap();
    std::fs::write(dir.path().join(".drift/config.yaml"), &i.config_hint).unwrap();
    let cfg = crate::policy::DriftConfig::load(dir.path()).unwrap();
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
    // ... and makes the unit known, from the declaration.
    let opts = Options {
        declared: cfg.practices,
        ..Options::default()
    };
    let r = run(&facts(files()), &opts, &c, Guards::ALL).report;
    let p = &r.concerns[0].population;
    assert_eq!((p.known, p.unknown), (1, 0));
    assert_eq!(r.concerns[0].variants[0].source, VariantSource::Declared);
    // A classifier's own unknown, with that instrument, too.
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|| Assignment::Unknown {
        reason: UnknownReason::Unclassified,
        instrument: "pkg:@nestjs/common#UseGuards".into(),
    }))];
    let r = run(&facts(files()), &opts, &c, Guards::ALL).report;
    assert_eq!(r.concerns[0].population.known, 1);
}

/// `n` routes under `dir` wrapped by `wrapper`.
fn routes(dir: &str, from: usize, n: usize, wrapper: &str) -> Vec<FileFacts> {
    (from..from + n)
        .map(|i| route(&format!("{dir}/r{i:02}/route.ts"), wrapper, true))
        .collect()
}

#[test]
fn a_split_user_policy_folds_into_one_with_alternatives() {
    let mut files = routes("app/api", 0, 30, "lib/auth.ts#withAuth");
    files.extend(routes("app/api/webhooks", 30, 15, "lib/auth.ts#withKey"));
    files.push(guards(&["withAuth", "withKey"]));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    assert_eq!(c.variants.len(), 1, "{:#?}", c.variants);
    let v = &c.variants[0];
    assert_eq!(
        v.key,
        "any_of(wrap:lib/auth.ts#withAuth|wrap:lib/auth.ts#withKey)"
    );
    assert_eq!(v.members, 45);
    assert_eq!(v.alternatives.len(), 2);
    let webhooks = v
        .alternatives
        .iter()
        .find(|a| a.key == "wrap:lib/auth.ts#withKey")
        .unwrap();
    assert_eq!(webhooks.members, 15);
    assert_eq!(webhooks.sets_apart[0].attribute, "dir:app/api/webhooks");
    // Only the shallowest of nested directories.
    assert!(
        webhooks
            .sets_apart
            .iter()
            .all(|s| s.attribute.matches('/').count() <= 2)
    );
    // The recipe sees one policy.
    let rc = &r.recipes[0];
    assert_eq!(rc.concerns[0].variants.len(), 1);
    assert_eq!(rc.concerns[0].variants[0].id, v.id);
}

/// `files` moved under the workspace package `pkg`.
fn in_package(pkg: &str, files: Vec<FileFacts>) -> Vec<FileFacts> {
    files
        .into_iter()
        .map(|mut f| {
            f.path = format!("{pkg}/{}", f.path);
            f.package = pkg.into();
            f
        })
        .collect()
}

/// `n` routes of `pkg` under its `dir`, wrapped by the package's own `guard`.
fn package_routes(pkg: &str, dir: &str, from: usize, n: usize, guard: &str) -> Vec<FileFacts> {
    in_package(
        pkg,
        routes(dir, from, n, &format!("{pkg}/lib/auth.ts#{guard}")),
    )
}

/// One policy is one package's: a monorepo's web app and its service each sign callers
/// in with their own guard, and neither can use the other's. The package sets the
/// smaller variant apart, which is what a split within a package folds on.
#[test]
fn a_split_across_packages_is_two_policies() {
    let (web, api) = ("apps/web", "services/api");
    let mut files = package_routes(web, "app/api", 0, 30, "withAuth");
    files.extend(package_routes(api, "app/api", 30, 15, "withKey"));
    files.extend(in_package(web, vec![guards(&["withAuth"])]));
    files.extend(in_package(api, vec![guards(&["withKey"])]));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    let got: Vec<(&str, usize)> = c
        .variants
        .iter()
        .map(|v| (v.key.as_str(), v.members))
        .collect();
    assert_eq!(
        got,
        [
            ("wrap:apps/web/lib/auth.ts#withAuth", 30),
            ("wrap:services/api/lib/auth.ts#withKey", 15),
        ]
    );
    assert!(
        c.variants.iter().all(|v| v.alternatives.is_empty()),
        "{:#?}",
        c.variants
    );
    // The fold's other conditions hold: one caller class, a structural attribute.
    assert!(
        c.variants[1]
            .sets_apart
            .iter()
            .any(|s| s.attribute == "package:services/api"),
        "{:#?}",
        c.variants[1].sets_apart
    );
    // No label offers one package the other's guard.
    assert!(
        c.variants.iter().all(|v| !v.label.contains(", or ")),
        "{:#?}",
        c.variants
    );
}

/// A workspace package that holds every member of both variants still folds them, as
/// the repository root does.
#[test]
fn a_split_within_one_package_of_a_monorepo_still_folds() {
    let web = "apps/web";
    let mut files = package_routes(web, "app/api", 0, 30, "withAuth");
    files.extend(package_routes(web, "app/api/webhooks", 30, 15, "withKey"));
    files.extend(in_package(web, vec![guards(&["withAuth", "withKey"])]));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    assert_eq!(c.variants.len(), 1, "{:#?}", c.variants);
    let v = &c.variants[0];
    assert_eq!(
        v.key,
        "any_of(wrap:apps/web/lib/auth.ts#withAuth|wrap:apps/web/lib/auth.ts#withKey)"
    );
    assert_eq!(v.members, 45);
    let alts: Vec<(&str, usize)> = v
        .alternatives
        .iter()
        .map(|a| (a.key.as_str(), a.members))
        .collect();
    assert_eq!(
        alts,
        [
            ("wrap:apps/web/lib/auth.ts#withAuth", 30),
            ("wrap:apps/web/lib/auth.ts#withKey", 15),
        ]
    );
}

/// `(key, members)` of each variant, in report order.
fn keyed(variants: &[Variant]) -> Vec<(&str, usize)> {
    variants
        .iter()
        .map(|v| (v.key.as_str(), v.members))
        .collect()
}

/// `(package, members)` of where a variant's units are.
fn packages_of(v: &Variant) -> Vec<(&str, usize)> {
    v.placement
        .packages
        .iter()
        .map(|p| (p.package.as_str(), p.members))
        .collect()
}

/// The fold is decided in each package from that package's own units. A route of
/// another package that uses one of the two guards, the dominant one or the other, is
/// that package's own fact: it does not stop the fold where the split is, and it is
/// not drawn into it. There it stays the variant it is, alone.
#[test]
fn a_split_folds_in_its_package_whatever_another_package_uses() {
    let (web, api) = ("apps/web", "services/api");
    let fold = "any_of(wrap:apps/web/lib/auth.ts#withAuth|wrap:apps/web/lib/auth.ts#withKey)";
    for reaches in ["withAuth", "withKey"] {
        let mut files = package_routes(web, "app/api", 0, 30, "withAuth");
        files.extend(package_routes(web, "app/api/webhooks", 30, 15, "withKey"));
        files.extend(in_package(web, vec![guards(&["withAuth", "withKey"])]));
        // The service's routes use one of the web app's guards.
        let alone = format!("wrap:apps/web/lib/auth.ts#{reaches}");
        files.extend(in_package(
            api,
            routes("app/api", 50, 5, &format!("apps/web/lib/auth.ts#{reaches}")),
        ));
        let r = by_wrapper(files);
        let c = &r.concerns[0];
        assert_eq!(
            keyed(&c.variants),
            [(fold, 45), (alone.as_str(), 5)],
            "{reaches}"
        );
        assert_eq!(c.population.known, 50);
        // The policy is the web app's, with the units it has there.
        let policy = &c.variants[0];
        assert_eq!(packages_of(policy), [(web, 45)], "{reaches}");
        assert_eq!(
            keyed(&policy.alternatives),
            [
                ("wrap:apps/web/lib/auth.ts#withAuth", 30),
                ("wrap:apps/web/lib/auth.ts#withKey", 15),
            ],
            "{reaches}"
        );
        for a in &policy.alternatives {
            assert_eq!(packages_of(a).len(), 1, "{reaches}: {:#?}", a.placement);
            assert_eq!(packages_of(a)[0].0, web, "{reaches}");
        }
        assert_eq!(
            policy.alternatives[1].sets_apart[0].attribute,
            "dir:apps/web/app/api/webhooks"
        );
        // The service's use stands alone, as the same variant the alternative is.
        let own = &c.variants[1];
        assert_eq!(packages_of(own), [(api, 5)], "{reaches}");
        assert!(own.alternatives.is_empty(), "{reaches}");
        assert!(!own.label.contains(", or "), "{reaches}: {}", own.label);
        assert!(
            policy
                .alternatives
                .iter()
                .any(|a| a.id == own.id && a.key == own.key),
            "{reaches}"
        );
        // Each package's profile and recipe name its own policy only.
        let profile = |pkg: &str| -> Vec<(&str, usize)> {
            let p = c.by_package.iter().find(|p| p.package == pkg).unwrap();
            p.variants
                .iter()
                .map(|v| (v.id.as_str(), v.members))
                .collect()
        };
        assert_eq!(profile(web), [(policy.id.as_str(), 45)], "{reaches}");
        assert_eq!(profile(api), [(own.id.as_str(), 5)], "{reaches}");
        // One of the dominant policy's ways alone is not the service's "own way".
        assert_eq!(c.divergence, [], "{reaches}");
        let recipe = |pkg: &str| -> Vec<(&str, &str)> {
            let rc = r.recipes.iter().find(|x| x.package == pkg).unwrap();
            rc.concerns[0]
                .variants
                .iter()
                .map(|v| (v.id.as_str(), v.label.as_str()))
                .collect()
        };
        assert_eq!(
            recipe(web),
            [(policy.id.as_str(), "wrap withAuth, or wrap withKey")],
            "{reaches}"
        );
        assert_eq!(
            recipe(api),
            [(own.id.as_str(), format!("wrap {reaches}").as_str())],
            "{reaches}"
        );
    }
}

/// Nor does another package's use make a split: the web app's three routes with the
/// key are too few to be set apart there, and the service's thirty are the service's
/// own. Counted together they would look like a split of one policy, set apart by the
/// service's package.
#[test]
fn another_packages_units_do_not_make_a_split() {
    let (web, api) = ("apps/web", "services/api");
    let mut files = package_routes(web, "app/api", 0, 40, "withAuth");
    files.extend(package_routes(web, "app/api/webhooks", 40, 3, "withKey"));
    files.extend(in_package(web, vec![guards(&["withAuth", "withKey"])]));
    files.extend(in_package(
        api,
        routes("app/api", 50, 30, "apps/web/lib/auth.ts#withKey"),
    ));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    assert_eq!(
        keyed(&c.variants),
        [
            ("wrap:apps/web/lib/auth.ts#withAuth", 40),
            ("wrap:apps/web/lib/auth.ts#withKey", 33),
        ]
    );
    assert!(
        c.variants.iter().all(|v| v.alternatives.is_empty()),
        "{:#?}",
        c.variants
    );
    assert!(
        c.variants[1]
            .sets_apart
            .iter()
            .any(|s| s.attribute == "package:services/api"),
        "{:#?}",
        c.variants[1].sets_apart
    );
    // Eighteen of the web app's own would fold there.
    let mut files = package_routes(web, "app/api", 0, 30, "withAuth");
    files.extend(package_routes(web, "app/api/webhooks", 30, 18, "withKey"));
    files.extend(in_package(web, vec![guards(&["withAuth", "withKey"])]));
    let c = &by_wrapper(files).concerns[0];
    assert_eq!(c.variants.len(), 1, "{:#?}", c.variants);
    assert_eq!(c.variants[0].alternatives.len(), 2);
}

/// Every package decides for itself, the one with the repository's most common guard
/// or not: a web app and a service that each split their own routes between two of
/// their own guards have one folded policy each, and neither names the other's.
#[test]
fn each_package_folds_its_own_split() {
    let (web, api) = ("apps/web", "services/api");
    let mut files = package_routes(web, "app/api", 0, 30, "withAuth");
    files.extend(package_routes(web, "app/api/webhooks", 30, 15, "withKey"));
    files.extend(in_package(web, vec![guards(&["withAuth", "withKey"])]));
    files.extend(package_routes(api, "app/api", 50, 24, "withCaller"));
    files.extend(package_routes(
        api,
        "app/api/internal",
        80,
        16,
        "withService",
    ));
    files.extend(in_package(
        api,
        vec![guards(&["withCaller", "withService"])],
    ));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    assert_eq!(
        keyed(&c.variants),
        [
            (
                "any_of(wrap:apps/web/lib/auth.ts#withAuth|wrap:apps/web/lib/auth.ts#withKey)",
                45
            ),
            (
                "any_of(wrap:services/api/lib/auth.ts#withCaller|wrap:services/api/lib/auth.ts#withService)",
                40
            ),
        ]
    );
    for (v, pkg, n) in [(&c.variants[0], web, 45), (&c.variants[1], api, 40)] {
        assert_eq!(packages_of(v), [(pkg, n)]);
        assert_eq!(v.alternatives.len(), 2);
        let rc = r.recipes.iter().find(|x| x.package == pkg).unwrap();
        assert_eq!(rc.concerns[0].variants.len(), 1, "{pkg}");
        assert_eq!(rc.concerns[0].variants[0].id, v.id, "{pkg}");
    }
    assert_eq!(c.variants[0].label, "wrap withAuth, or wrap withKey");
    assert_eq!(c.variants[1].label, "wrap withCaller, or wrap withService");
    // The service's policy is its own, as two packages with one guard each are.
    let diverging: Vec<(&str, &str)> = c
        .divergence
        .iter()
        .map(|d| (d.package.as_str(), d.dominant.as_str()))
        .collect();
    assert_eq!(diverging, [(api, c.variants[1].id.as_str())]);
}

#[test]
fn caller_classes_identifies_and_opens_never_fold() {
    for other in [
        "lib/auth.ts#withSig",
        "lib/auth.ts#withUser",
        "lib/auth.ts#isPublic",
    ] {
        let mut files = routes("app/api", 0, 30, "lib/auth.ts#withAuth");
        files.extend(routes("app/api/webhooks", 30, 15, other));
        files.push(guards(&["withAuth"]));
        let r = by_wrapper(files);
        let c = &r.concerns[0];
        assert_eq!(c.variants.len(), 2, "{other}: {:#?}", c.variants);
        assert!(
            c.variants.iter().all(|v| v.alternatives.is_empty()),
            "{other}"
        );
        // Declared public (`opens`) is a known variant, not none. A caller identified
        // and no one turned away is its own state, identified, counted apart.
        let identified = other.ends_with("withUser");
        for v in &c.variants {
            let want = if identified && v.key.starts_with("identifies:") {
                VariantKind::Identified
            } else {
                VariantKind::Known
            };
            assert_eq!(v.kind, want, "{other}: {}", v.key);
        }
        assert_eq!(c.population.none, 0);
        assert_eq!(
            (c.population.known, c.population.identified),
            if identified { (30, 15) } else { (45, 0) },
            "{other}"
        );
    }
}

#[test]
fn an_interleaved_split_is_an_unexplained_split_and_ranks_first() {
    // withAuth and withKey on alternate routes of one directory: nothing sets them
    // apart. Plus unguarded routes and an unknown instrument.
    let mut files: Vec<FileFacts> = (0..25)
        .map(|i| {
            let w = if i % 5 < 3 {
                "lib/auth.ts#withAuth"
            } else {
                "lib/auth.ts#withKey"
            };
            route(&format!("app/api/r{i:02}/route.ts"), w, true)
        })
        .collect();
    files.extend(routes("app/api", 40, 2, ""));
    files.extend(routes("app/api", 50, 3, "pkg:some-lib#withThing"));
    files.push(guards(&["withAuth", "withKey"]));
    let r = by_wrapper(files);
    let kinds: Vec<FindingKind> = r.findings.iter().map(|f| f.kind).collect();
    assert_eq!(
        kinds,
        [
            FindingKind::UnexplainedSplit,
            FindingKind::None,
            FindingKind::Unknown
        ],
        "{:#?}",
        r.findings
    );
    let f = &r.findings[0];
    assert_eq!((f.concern.as_str(), f.members), (AUTHN, 10));
    assert_eq!(f.variants.len(), 2);
    assert_eq!(r.findings[2].members, 3);
    assert_eq!(
        r.concerns[0]
            .variants
            .iter()
            .filter(|v| !v.alternatives.is_empty())
            .count(),
        0
    );
    // The recipe's second variant: nothing sets it apart.
    let d = r.recipes[0].concerns[0].differs.as_ref().unwrap();
    assert_eq!((d.members, d.attribute.as_deref()), (10, None));
    assert_eq!(r.recipes[0].concerns[0].none, 2);
    assert_eq!(r.recipes[0].concerns[0].unknown, 3);
    let copy = r.recipes[0].concerns[0].copy.as_ref().unwrap();
    assert!(
        copy.line > 0 && copy.path.starts_with("app/api/"),
        "{copy:?}"
    );
}

fn placed_with(attrs: &[&str]) -> Placed {
    Placed {
        path: "app/x/route.ts".into(),
        src: "app/x/route.ts".into(),
        package: String::new(),
        symbol: "GET".into(),
        line: 1,
        sub: 0,
        entry_kind: None,
        method: None,
        route: None,
        stem: "route".into(),
        dirs: Vec::new(),
        roles: Vec::new(),
        attrs: attrs.iter().map(|a| a.to_string()).collect(),
        outcome: Outcome::None {
            label: String::new(),
        },
        unscoped: None,
        backing: Backing::default(),
        unsettled: false,
    }
}

#[test]
fn sets_apart_uses_the_guarded_wilson_statistic() {
    // 9/9 of the variant under webhooks vs 0/170 of the dominant one; one attribute
    // tried, so z is the plain 95% one.
    let mut placed: Vec<Placed> = (0..9)
        .map(|_| placed_with(&["dir:app/api/webhooks"]))
        .collect();
    placed.extend((0..170).map(|_| placed_with(&["dir:app/api/other"])));
    let v: Vec<usize> = (0..9).collect();
    let d: Vec<usize> = (9..179).collect();
    let s = sets_apart(&placed, &v, &d, &[]);
    assert_eq!(s[0].attribute, "dir:app/api/webhooks");
    assert_eq!((s[0].in_variant, s[0].in_dominant), ([9, 9], [0, 170]));
    let want = crate::mine::wilson_lower_bound(9, 9) - crate::mine::wilson_upper_bound(0, 170);
    assert!((s[0].separation - r3(want)).abs() < 1e-9, "{s:?}");
    assert_eq!(s[0].purity, 1.0);
    // Fewer than 5 members: nothing is said.
    assert!(sets_apart(&placed, &v[..4], &d, &[]).is_empty());
    // More attributes tried: a wider interval, a smaller separation.
    let mut wide: Vec<Placed> = (0..9)
        .map(|i| {
            placed_with(&[
                "dir:app/api/webhooks",
                &format!("stem:a{i}"),
                &format!("role:R-{i}"),
            ])
        })
        .collect();
    wide.extend((0..170).map(|_| placed_with(&["dir:app/api/other"])));
    let s2 = sets_apart(&wide, &v, &d, &[]);
    assert!(s2[0].separation < s[0].separation, "{s2:?}");
    // Nested directories: only the shallowest; the instrument's own module never.
    let mut nested: Vec<Placed> = (0..9)
        .map(|_| {
            placed_with(&[
                "dir:app/api/webhooks",
                "dir:app/api/webhooks/stripe",
                "imports:lib/sig.ts",
            ])
        })
        .collect();
    nested.extend((0..170).map(|_| placed_with(&["dir:app/api/other"])));
    let s3 = sets_apart(&nested, &v, &d, &["lib/sig.ts#verify".to_string()]);
    let attrs: Vec<&str> = s3.iter().map(|s| s.attribute.as_str()).collect();
    assert_eq!(attrs, ["dir:app/api/webhooks"]);
}

#[test]
fn the_normal_quantile_is_right() {
    assert!((normal_upper_quantile(0.025) - 1.959_964).abs() < 1e-5);
    assert!((normal_upper_quantile(0.005) - 2.575_829).abs() < 1e-5);
    assert!((normal_upper_quantile(0.5)).abs() < 1e-9);
    assert!((normal_upper_quantile(0.0025) - 2.807_034).abs() < 1e-5);
}

#[test]
fn first_segment_is_route_shaped() {
    assert_eq!(first_segment("/api/x/[id]").as_deref(), Some("/api"));
    assert_eq!(first_segment("/").as_deref(), Some("/"));
    assert_eq!(first_segment("api"), None);
}

#[test]
fn unknown_instruments_say_why() {
    assert_eq!(
        unknown_instrument("unclassified:withThing"),
        Some(UnknownReason::Unclassified)
    );
    assert_eq!(
        unknown_instrument("unresolved:x#y"),
        Some(UnknownReason::Unresolved)
    );
    assert_eq!(unknown_instrument("lib/a.ts#withAuth"), None);
}

/// Under `testing`, only what tests use is offered: the authn dependency a unit's
/// required case is unknown behind is not how the routes are tested.
#[test]
fn testing_hints_name_only_test_instruments() {
    for other in [
        "libs/shared/web/auth.py#CallerGate",
        "lib/auth.ts#withAuth",
        "pkg:fastapi#Depends",
        "pkg:@clerk/nextjs/server#auth",
    ] {
        assert_eq!(config_hint(TESTING, other), None, "{other}");
        assert!(config_hint(AUTHN, other).is_some(), "{other}");
    }
    for test in [
        "tests/conftest.py#client",
        "app/api/a.test.ts#signedIn",
        "pkg:pytest#fixture",
        "pkg:vitest#vi",
    ] {
        assert!(config_hint(TESTING, test).is_some(), "{test}");
    }
}

#[test]
fn pseudo_instruments_get_no_hint() {
    for pseudo in [
        "input",
        "responses",
        "validates",
        "unresolved:x#y",
        "unclassified:withThing",
    ] {
        assert_eq!(config_hint(AUTHN, pseudo), None, "{pseudo}");
    }
    assert!(config_hint(AUTHN, "lib/auth.ts#withAuth").is_some());
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|| Assignment::Unknown {
        reason: UnknownReason::Unclassified,
        instrument: "responses".into(),
    }))];
    let r = run(
        &facts(vec![route("app/a/route.ts", "", true)]),
        &Options::default(),
        &c,
        Guards::ALL,
    )
    .report;
    let i = &r.concerns[0].unknown.instruments[0];
    assert_eq!(
        (i.instrument.as_str(), i.config_hint.as_str()),
        ("responses", "")
    );
    assert_eq!(r.findings[0].config_hint, None);
    assert!(
        serde_json::to_value(i)
            .unwrap()
            .get("config_hint")
            .is_none(),
        "omitted when none"
    );
    // A canonical reference unknown for another reason (dynamic) gets one too, where
    // the unit runs it on every path: declaring it is what makes its units known.
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|| Assignment::Unknown {
        reason: UnknownReason::Dynamic,
        instrument: "lib/auth.ts#withAuth".into(),
    }))];
    let r = run(
        &facts(vec![route("app/a/route.ts", "lib/auth.ts#withAuth", true)]),
        &Options::default(),
        &c,
        Guards::ALL,
    )
    .report;
    assert_eq!(
        r.concerns[0].unknown.instruments[0].config_hint,
        "practices: {authn: {\"lib/auth.ts#withAuth\": \"withAuth\"}}"
    );
    // Where nothing shows the unit running it (an indeterminate middleware), naming
    // it would settle nothing: no hint.
    let r = run(
        &facts(vec![route("app/a/route.ts", "", true)]),
        &Options::default(),
        &c,
        Guards::ALL,
    )
    .report;
    assert_eq!(r.concerns[0].unknown.instruments[0].config_hint, "");
}

#[test]
fn a_declared_opaque_wrapper_makes_a_none_known() {
    // The classifier says none, but the route is wrapped by an in-repo wrapper the
    // facts lack: unknown, with a hint; declared, the unit uses it.
    let files = || vec![route("app/a/route.ts", "lib/auth.ts#withAuth", true)];
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|| Assignment::None {
        label: "no guard".into(),
    }))];
    let r = run(&facts(files()), &Options::default(), &c, Guards::ALL).report;
    let hint = r.concerns[0].unknown.instruments[0].config_hint.clone();
    assert!(!hint.is_empty());
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".drift")).unwrap();
    std::fs::write(dir.path().join(".drift/config.yaml"), &hint).unwrap();
    let opts = Options {
        declared: crate::policy::DriftConfig::load(dir.path())
            .unwrap()
            .practices,
        ..Options::default()
    };
    let r = run(&facts(files()), &opts, &c, Guards::ALL).report;
    assert_eq!(r.concerns[0].population.known, 1, "{:#?}", r.concerns[0]);
}

/// A route wrapped by each of `wrappers` (call wraps).
fn route_with(path: &str, wrappers: &[&str]) -> FileFacts {
    let mut f = route(path, "", true);
    f.symbols[0].wraps = wrappers
        .iter()
        .map(|w| Wrap {
            wrapper: w.to_string(),
            kind: WrapKind::Call,
        })
        .collect();
    f
}

fn sums_hold(c: &ConcernReport) {
    let known: usize = c
        .groups
        .iter()
        .filter(|g| g.kind == VariantKind::Known)
        .map(|g| g.members)
        .sum();
    let none: usize = c
        .groups
        .iter()
        .filter(|g| g.kind == VariantKind::None)
        .map(|g| g.members)
        .sum();
    assert_eq!((known, none), (c.population.known, c.population.none));
    for g in &c.groups {
        let top: usize = g.top.iter().map(|t| t.members).sum();
        assert!(top <= g.members && (g.variants > caps::GROUP_VARIANTS || top == g.members));
    }
}

#[test]
fn variants_sharing_a_guard_are_one_group_with_their_sub_variants() {
    // 12 routes each with withAuth plus a wrapper of its own (12 unique keys, all in
    // the tail), 5 with withAuth alone, 2 with nothing, 3 unknown.
    let mut files: Vec<FileFacts> = (0..12)
        .map(|i| {
            route_with(
                &format!("app/api/r{i:02}/route.ts"),
                &["lib/auth.ts#withAuth", &format!("lib/auth.ts#withOwn{i}")],
            )
        })
        .collect();
    files.extend(routes("app/api", 20, 5, "lib/auth.ts#withAuth"));
    files.extend(routes("app/api", 30, 2, ""));
    files.extend(routes("app/api", 40, 3, "pkg:some-lib#withThing"));
    let own: Vec<String> = (0..12).map(|i| format!("withOwn{i}")).collect();
    let mut names: Vec<&str> = own.iter().map(String::as_str).collect();
    names.push("withAuth");
    files.push(guards(&names));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    // Before: the tail holds the 12 one-unit keys.
    let tail = c.variants.iter().find(|v| v.key == TAIL).unwrap();
    assert_eq!(tail.members, 12);
    // After: one group sharing withAuth, 13 variants, 17 units.
    let g = &c.groups[0];
    assert_eq!(
        (
            g.instrument.as_str(),
            g.class.as_str(),
            g.members,
            g.variants
        ),
        ("lib/auth.ts#withAuth", "user", 17, 13)
    );
    assert_eq!(g.label, "13 variants sharing withAuth");
    assert_eq!(g.top[0].key, "wrap:lib/auth.ts#withAuth");
    assert_eq!(g.top.len(), caps::GROUP_VARIANTS);
    assert!(
        c.groups
            .iter()
            .all(|x| x.instrument.is_empty() || x.members >= 2)
    );
    sums_hold(c);
    // The old rows are unchanged beside it.
    assert!(
        c.variants
            .iter()
            .any(|v| v.key == "wrap:lib/auth.ts#withAuth")
    );
}

#[test]
fn groups_never_span_caller_classes_or_known_and_none() {
    // The same instrument applied as service auth and as a user guard: two groups.
    let mut files = routes("app/api", 0, 6, "lib/auth.ts#withSig");
    files.extend((10..16).map(|i| {
        route_with(
            &format!("app/web/r{i:02}/route.ts"),
            &["lib/auth.ts#withAuth", "lib/auth.ts#withSig"],
        )
    }));
    files.extend(routes("app/api", 20, 3, ""));
    files.extend(routes("app/api", 30, 4, "lib/auth.ts#isPublic"));
    files.push(guards(&["withAuth", "withSig"]));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    let classes: Vec<(&str, &str, usize)> = c
        .groups
        .iter()
        .map(|g| (g.class.as_str(), g.instrument.as_str(), g.members))
        .collect();
    // withAuth+withSig units are user-class (a user guard wins), grouped by the user
    // guard; withSig alone is service-class; isPublic opens.
    assert!(
        classes.contains(&("service", "lib/auth.ts#withSig", 6)),
        "{classes:?}"
    );
    assert!(
        classes.contains(&("user", "lib/auth.ts#withAuth", 6)),
        "{classes:?}"
    );
    assert!(
        classes.contains(&("opens", "lib/auth.ts#isPublic", 4)),
        "{classes:?}"
    );
    // Each group's sub-variants are of its class only.
    for g in c.groups.iter().filter(|g| g.class == "service") {
        assert!(
            g.top.iter().all(|t| t.key.starts_with("service_auth:")),
            "{g:?}"
        );
    }
    let none: Vec<&VariantGroup> = c
        .groups
        .iter()
        .filter(|g| g.kind == VariantKind::None)
        .collect();
    assert_eq!(none.len(), 1);
    assert_eq!((none[0].members, none[0].instrument.as_str()), (3, ""));
    sums_hold(c);
}

#[test]
fn groups_are_deterministic_under_file_order() {
    let mut files: Vec<FileFacts> = (0..9)
        .map(|i| {
            route_with(
                &format!("app/api/r{i:02}/route.ts"),
                &["lib/auth.ts#withAuth", &format!("lib/auth.ts#withOwn{i}")],
            )
        })
        .collect();
    let own: Vec<String> = (0..9).map(|i| format!("withOwn{i}")).collect();
    let mut names: Vec<&str> = own.iter().map(String::as_str).collect();
    names.push("withAuth");
    files.push(guards(&names));
    let a = serde_json::to_string(&by_wrapper(files.clone()).concerns[0].groups).unwrap();
    files.reverse();
    let b = serde_json::to_string(&by_wrapper(files).concerns[0].groups).unwrap();
    assert_eq!(a, b);
}

#[test]
fn a_route_guard_is_decisive_over_one_the_app_runs() {
    // Every route has the app-wide throttler and its own withAuth: grouped by withAuth.
    let files: Vec<FileFacts> = (0..6)
        .map(|i| {
            let mut f = route_with(
                &format!("app/api/r{i:02}/route.ts"),
                &["lib/auth.ts#withAuth"],
            );
            f.symbols[0].wraps.push(Wrap {
                wrapper: "lib/auth.ts#Throttle".into(),
                kind: WrapKind::AppHook,
            });
            f
        })
        .collect();
    struct AppAndRoute;
    impl Concern for AppAndRoute {
        fn id(&self) -> &'static str {
            AUTHN
        }
        fn unit(&self) -> &'static str {
            "entry_point"
        }
        fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
            entries(cx)
        }
        fn assign<'a>(&self, _cx: &Cx<'a>, u: &UnitRef<'a>) -> Assignment {
            let UnitRef::Entry {
                symbol: Some(s), ..
            } = u
            else {
                unreachable!()
            };
            let uses: Vec<Use> = s
                .wraps
                .iter()
                .map(|w| Use {
                    mechanism: if w.kind == WrapKind::AppHook {
                        "app_guard"
                    } else {
                        "wrap"
                    }
                    .into(),
                    instrument: w.wrapper.clone(),
                })
                .collect();
            Assignment::Known {
                label: label_of(&uses),
                uses,
                source: VariantSource::Usage,
            }
        }
    }
    let mut files = files;
    files.push(guards(&["withAuth", "Throttle"]));
    let c: Vec<Box<dyn Concern>> = vec![Box::new(AppAndRoute)];
    let r = run(&facts(files), &Options::default(), &c, Guards::ALL).report;
    assert_eq!(r.concerns[0].groups[0].instrument, "lib/auth.ts#withAuth");
}

#[test]
fn two_packages_with_one_mechanism_each_are_two_policies() {
    // apps/web wraps its routes in withWorkspace, apps/api in AuthGuard: the package
    // sets them apart, but they are two policies, never alternatives of one.
    let in_package = |pkg: &str, n: usize, from: usize, wrapper: &str| -> Vec<FileFacts> {
        routes(&format!("{pkg}/app/api"), from, n, wrapper)
            .into_iter()
            .map(|mut f| {
                f.package = pkg.to_string();
                f
            })
            .collect()
    };
    let mut files = in_package("apps/web", 30, 0, "lib/auth.ts#withWorkspace");
    files.extend(in_package("apps/api", 20, 40, "lib/auth.ts#AuthGuard"));
    files.push(guards(&["withWorkspace", "AuthGuard"]));
    let r = by_wrapper(files);
    let c = &r.concerns[0];
    assert!(
        c.variants.iter().all(|v| v.alternatives.is_empty()),
        "{:#?}",
        c.variants
    );
    assert!(c.variants.iter().all(|v| !v.key.starts_with("any_of(")));
    assert_eq!(c.variants.len(), 2);
    // Two recipes, each naming its own package's mechanism only.
    let recipe = |pkg: &str| r.recipes.iter().find(|x| x.package == pkg).unwrap();
    for (pkg, own, other) in [
        ("apps/web", "withWorkspace", "AuthGuard"),
        ("apps/api", "AuthGuard", "withWorkspace"),
    ] {
        let rc = recipe(pkg);
        let labels: Vec<&str> = rc.concerns[0]
            .variants
            .iter()
            .map(|v| v.label.as_str())
            .collect();
        assert_eq!(rc.concerns[0].variants.len(), 1, "{pkg}: {labels:?}");
        assert!(
            labels[0].contains(own) && !labels[0].contains(other),
            "{pkg}: {labels:?}"
        );
    }
}

#[test]
fn config_hints_are_one_block_a_person_merges() {
    let concern = |id: &str, instruments: &[(&str, usize, bool)]| ConcernReport {
        id: id.into(),
        unknown: UnknownReport {
            instruments: instruments
                .iter()
                .map(|(i, members, hint)| InstrumentCount {
                    instrument: i.to_string(),
                    members: *members,
                    config_hint: if *hint {
                        config_hint(id, i).unwrap()
                    } else {
                        String::new()
                    },
                })
                .collect(),
            ..Default::default()
        },
        ..Default::default()
    };
    let r = PracticesReport {
        concerns: vec![
            concern("authn", &[("lib/auth.ts#withThing", 12, true)]),
            // Nothing a line would classify: not in the block, not counted.
            concern("errors", &[("unresolved:x", 4, false)]),
            concern(
                "logging",
                &[
                    ("app/core/loggers.py#logger", 20, true),
                    ("pkg:structlog#get_logger", 3, true),
                ],
            ),
        ],
        ..Default::default()
    };
    assert_eq!(config_hint_counts(&r), (35, 3));
    assert_eq!(
        config_hints(&r),
        "# 35 unit(s) are unknown behind 3 name(s) Drift cannot classify alone.\n\
         # Each line says how a concern is done here; the value is the label reports show.\n\
         # Keep the lines that are right, merge them under one `practices:` key in\n\
         # .drift/config.yaml, and run `drift practices` again.\n\
         practices:\n  authn:\n    \"lib/auth.ts#withThing\": \"withThing\"  # 12 unit(s)\n  logging:\n    \"app/core/loggers.py#logger\": \"logger\"  # 20 unit(s)\n    \"pkg:structlog#get_logger\": \"get_logger\"  # 3 unit(s)\n"
    );
    // The block is the config the engine reads: it parses as the hint lines do.
    let yaml: BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>> =
        serde_saphyr::from_str(&config_hints(&r)).unwrap();
    assert_eq!(
        yaml["practices"]["logging"]["app/core/loggers.py#logger"],
        "logger"
    );
    let none = PracticesReport {
        concerns: vec![concern("errors", &[("unresolved:x", 4, false)])],
        ..Default::default()
    };
    assert_eq!(config_hint_counts(&none), (0, 0));
    assert!(config_hints(&none).starts_with("Nothing to name: "));
}

/// A stub of one preview concern over the route files: their handlers as symbols, or
/// for testing their entry points, each assigned by `f` from the route's number
/// (`r07` is 7).
struct Preview {
    id: &'static str,
    f: fn(usize) -> (Assignment, Backing),
}

impl Concern for Preview {
    fn id(&self) -> &'static str {
        self.id
    }
    fn unit(&self) -> &'static str {
        if self.id == TESTING {
            "entry_point"
        } else {
            "symbol"
        }
    }
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        if self.id == TESTING {
            return entries(cx);
        }
        cx.facts
            .files
            .iter()
            .filter(|f| !f.entry_points.is_empty())
            .flat_map(|file| {
                file.symbols
                    .iter()
                    .map(move |symbol| UnitRef::Symbol { file, symbol })
            })
            .collect()
    }
    fn assign<'a>(&self, cx: &Cx<'a>, u: &UnitRef<'a>) -> Assignment {
        self.assign_backed(cx, u).0
    }
    fn assign_backed<'a>(&self, _cx: &Cx<'a>, u: &UnitRef<'a>) -> (Assignment, Backing) {
        let path = &u.file().path;
        let n = path
            .split('/')
            .find_map(|seg| seg.strip_prefix('r')?.parse().ok())
            .unwrap_or_else(|| panic!("{path}"));
        (self.f)(n)
    }
}

fn says(mechanism: &str, instrument: &str, label: &str) -> (Assignment, Backing) {
    (
        Assignment::Known {
            uses: vec![Use {
                mechanism: mechanism.into(),
                instrument: instrument.into(),
            }],
            label: label.into(),
            source: VariantSource::Vocab,
        },
        Backing::default(),
    )
}

/// Routes 0..7 log through pino, the others through `console`.
fn logs(n: usize) -> (Assignment, Backing) {
    if n < 7 {
        says("message", "pino", "message logs via pino")
    } else {
        says("message", "console", "message logs via console")
    }
}

/// Half the routes read config one way, the other half another.
fn reads(n: usize) -> (Assignment, Backing) {
    if n.is_multiple_of(2) {
        says("in_place", "process.env", "in place process.env")
    } else {
        says("env_schema", "envalid", "env schema envalid")
    }
}

/// Six routes reach data through a service; of the other four nothing can be told.
fn data(n: usize) -> (Assignment, Backing) {
    if n < 6 {
        says("service", "prisma", "service prisma")
    } else {
        (
            Assignment::Unknown {
                reason: UnknownReason::Unclassified,
                instrument: String::new(),
            },
            Backing::default(),
        )
    }
}

/// Routes 0..8 have a test beside the others' in `tests/api` (route 0's leaves its 401
/// unasserted, route 1 also has an end-to-end test); route 8 is untested, and whether
/// route 9 is cannot be told.
fn tests_of(n: usize) -> (Assignment, Backing) {
    let unit = format!("apps/web/tests/api/r{n:02}.test.ts");
    match n {
        0..8 => {
            let (a, _) = says("tested_some", "vitest", "tested some vitest");
            let mut tests = vec![unit];
            if n == 1 {
                tests.push("e2e/smoke.spec.ts".into());
            }
            tests.sort();
            (
                a,
                Backing {
                    tests,
                    required: vec!["401".into(), "404".into()],
                    missing: if n == 0 { vec!["401".into()] } else { vec![] },
                    unproven: None,
                    basis: None,
                },
            )
        }
        8 => (
            Assignment::None {
                label: "untested".into(),
            },
            Backing::default(),
        ),
        _ => (
            Assignment::Unknown {
                reason: UnknownReason::RouteNotMatched,
                instrument: String::new(),
            },
            // What a classifier hands over with an unknown is never used.
            Backing {
                tests: vec![unit],
                ..Backing::default()
            },
        ),
    }
}

/// Ten routes of `apps/web` behind `withAuth`, with the four preview concerns stubbed.
fn previewed() -> (RepoFacts, Vec<Box<dyn Concern>>) {
    let web = "apps/web";
    let mut files = package_routes(web, "app/api", 0, 10, "withAuth");
    files.extend(in_package(web, vec![guards(&["withAuth"])]));
    let c: Vec<Box<dyn Concern>> = vec![
        Box::new(ByWrapper),
        Box::new(Preview {
            id: LOGGING,
            f: logs,
        }),
        Box::new(Preview {
            id: CONFIG,
            f: reads,
        }),
        Box::new(Preview {
            id: DATA_ACCESS,
            f: data,
        }),
        Box::new(Preview {
            id: TESTING,
            f: tests_of,
        }),
    ];
    (facts(files), c)
}

/// The recipe of a kind of entry point says, after its primary concerns, what at
/// least 60% of the package does for the preview ones, with something to copy: never
/// a half-and-half split, never a share that unknown units bring under the bar.
#[test]
fn a_recipe_adds_what_most_of_the_package_does_for_the_preview_concerns() {
    let (facts, c) = previewed();
    let r = run(&facts, &Options::default(), &c, Guards::ALL).report;
    assert_eq!(r.recipes.len(), 1, "{:#?}", r.recipes);
    let rc = &r.recipes[0];
    assert_eq!(rc.label, "http entry points in apps/web");
    let said: Vec<(&str, &str, usize, usize)> = rc
        .preview
        .iter()
        .map(|p| (p.concern.as_str(), p.label.as_str(), p.members, p.total))
        .collect();
    assert_eq!(
        said,
        [
            // 7 of 10; config is 5 and 5, data access 6 of 10 with 4 unknown.
            ("logging", "message logs via pino", 7, 10),
            ("data_access", "service prisma", 6, 10),
            // The deepest directory whose tests cover 60% of them: 8 of 10, the
            // untested and the unknown one counted against it.
            ("testing", "tests in apps/web/tests/api (vitest)", 8, 10),
        ]
    );
    let logging = &rc.preview[0];
    assert_eq!(logging.share, 0.7);
    assert!(logging.variant.is_some() && logging.tests_dir.is_none());
    let copy = logging.copy.as_ref().unwrap();
    assert!(
        copy.path.starts_with("apps/web/app/api/r0") && copy.symbol == "GET",
        "{copy:?}"
    );
    let testing = &rc.preview[2];
    assert_eq!(testing.tests_dir.as_deref(), Some("apps/web/tests/api"));
    assert_eq!(testing.runner.as_deref(), Some("vitest"));
    assert_eq!(testing.variant, None);
    assert_eq!(
        testing.copy,
        Some(Example {
            path: "apps/web/tests/api/r00.test.ts".into(),
            symbol: String::new(),
            line: 0,
        })
    );

    // As text: the agent's addition to the recipe, each clause marked as a preview,
    // and the same lines under the recipe people read.
    let primary = super::super::render::agent_recipe(rc).unwrap();
    assert!(!primary.contains("preview"), "{primary}");
    let added = super::super::render::agent_recipe_preview(rc).unwrap();
    assert_eq!(
        added,
        format!(
            "logging (preview): message logs via pino (7 of 10; copy {}:2); data_access (preview): service prisma (6 of 10; copy {}:2); testing (preview): tests in apps/web/tests/api (vitest) cover 8 of 10 (copy apps/web/tests/api/r00.test.ts)",
            copy.path,
            rc.preview[1].copy.as_ref().unwrap().path
        )
    );
    let text = super::super::render::render_recipes(&r);
    assert!(
        text.contains("    logging (preview): message logs via pino (7 of 10; copy "),
        "{text}"
    );
    assert!(!text.contains("config (preview)"), "{text}");
    let agent = super::super::render::render_agent(&r, &[]);
    assert!(agent.contains(&format!("{primary}; {added}\n")), "{agent}");
    assert!(agent.len() <= super::super::render::AGENT_CHARS);

    // The JSON is additive: a recipe with no preview has no such field.
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["recipes"][0]["preview"][0]["concern"], "logging");
    let bare = by_wrapper(package_routes("apps/web", "app/api", 0, 10, "withAuth"));
    assert_eq!(bare.recipes.len(), 1);
    let json = serde_json::to_value(&bare).unwrap();
    assert!(json["recipes"][0].get("preview").is_none(), "{json}");
}

/// A preview never takes the room of a primary line in what an agent is given.
#[test]
fn the_agent_text_drops_a_preview_before_a_recipe() {
    let (facts, c) = previewed();
    let mut r = run(&facts, &Options::default(), &c, Guards::ALL).report;
    let rc = r.recipes[0].clone();
    let line = super::super::render::agent_recipe(&rc).unwrap();
    let added = super::super::render::agent_recipe_preview(&rc).unwrap();
    // As many copies of the recipe as fit without their previews.
    let head =
        "drift practices (facts, not rules; how this codebase does it, with a file to copy):";
    let fit = (super::super::render::AGENT_CHARS - head.len() - 1) / (line.len() + 3);
    assert!(fit >= 2, "{line}");
    r.recipes = vec![rc; fit];
    let agent = super::super::render::render_agent(&r, &[]);
    assert_eq!(
        agent.matches("- new http entry points").count(),
        fit,
        "{agent}"
    );
    assert!(agent.len() <= super::super::render::AGENT_CHARS, "{agent}");
    // Not every one of them has room for its preview, and none was dropped for one.
    assert!(agent.matches(&added).count() < fit, "{agent}");
    assert!(!agent.contains("more: `drift practices`"), "{agent}");
}

/// The card of a file with entry points says, after the primary concerns and marked as
/// preview, the file's own logger and data access, what most of the package does when
/// that is another way, and which tests cover each entry point with the required cases
/// they leave unasserted. An unknown is counted, never described.
#[test]
fn the_card_adds_the_preview_concerns_for_a_file_with_entry_points() {
    let (facts, c) = previewed();
    let opts = Options::default();
    let lines = |n: usize| -> Vec<String> {
        card_lines_with(
            &facts,
            &opts,
            &c,
            &format!("apps/web/app/api/r{n:02}/route.ts"),
        )
        .into_iter()
        .filter(|l| l.contains("(preview)"))
        .collect()
    };
    let id = |concern: &str, key: &str| variant_id(concern, key);
    // Route 0: the package's logger and data access; its test leaves 401 unasserted.
    assert_eq!(
        lines(0),
        [
            format!(
                "  logging (preview): message logs via pino [{}]",
                id(LOGGING, "message:pino")
            ),
            format!(
                "  config (preview): in place process.env [{}]",
                id(CONFIG, "in_place:process.env")
            ),
            format!(
                "  data_access (preview): service prisma [{}]",
                id(DATA_ACCESS, "service:prisma")
            ),
            "  testing (preview): GET: covered by apps/web/tests/api/r00.test.ts, not asserted: 401"
                .to_string(),
        ]
    );
    // Route 1: every required case asserted, by two test files.
    assert_eq!(
        lines(1)[3],
        "  testing (preview): GET: covered by apps/web/tests/api/r01.test.ts, e2e/smoke.spec.ts, asserts 401, 404"
    );
    // Route 8: another logger than most of the package, untested; its data access is
    // unknown, so the line says what the package mostly does and nothing of the file.
    let l = lines(8);
    assert!(
        l[0].starts_with(&format!(
            "  logging (preview): message logs via console [{}]; the package mostly: message logs via pino 7/10 (copy apps/web/app/api/r0",
            id(LOGGING, "message:console")
        )),
        "{l:#?}"
    );
    assert!(
        l[2].starts_with("  data_access (preview): the package mostly: service prisma 6/10 (copy apps/web/app/api/r0"),
        "{l:#?}"
    );
    assert_eq!(l[3], "  testing (preview): GET: no test found");
    // Route 9: whether it is tested is unknown, and the test file its classifier
    // handed over with the unknown is not named: no testing line at all.
    let l = lines(9);
    assert_eq!(l.len(), 3, "{l:#?}");
    assert!(
        l.iter()
            .all(|x| !x.contains("testing") && !x.contains("r09.test")),
        "{l:#?}"
    );
    // The primary lines come first and are what they were.
    let all = card_lines_with(&facts, &opts, &c, "apps/web/app/api/r00/route.ts");
    assert!(all[0].starts_with("  authn: "), "{all:#?}");
    assert_eq!(all.len(), 5);
    // A file with no entry point gets no preview line, whatever its symbols do.
    assert_eq!(
        card_lines_with(&facts, &opts, &c, "apps/web/lib/auth.ts"),
        Vec::<String>::new()
    );
}

/// What runs side by side comes back in the order asked, whatever finishes first.
#[test]
fn side_by_side_keeps_the_order_asked() {
    assert_eq!(side_by_side(0, |i| i), Vec::<usize>::new());
    assert_eq!(side_by_side(1, |i| i * 2), vec![0]);
    // The later ones finish first.
    let got = side_by_side(9, |i| {
        std::thread::sleep(std::time::Duration::from_millis(9 - i as u64));
        i * i
    });
    assert_eq!(got, (0..9).map(|i| i * i).collect::<Vec<_>>());
    let (a, b) = beside(|| 6, || 3);
    assert_eq!((a, b), (6, 3));
}

#[test]
#[should_panic(expected = "a classifier failed")]
fn a_panic_beside_the_others_is_passed_on() {
    side_by_side(3, |i| {
        if i == 2 {
            panic!("a classifier failed");
        }
    });
}

/// The registered classifiers run side by side: the report of a repository is the
/// same every time, with every unit listed, and a concern asked for alone is its part
/// of the whole report.
#[test]
fn the_report_is_the_same_run_after_run_and_concern_by_concern() {
    use super::super::common::fixtures;
    for facts in [
        fixtures::next_clerk(),
        fixtures::fastapi_split(),
        fixtures::nest_mixed(),
        fixtures::ts_cases(),
        fixtures::py_cases(),
    ] {
        let opts = Options {
            units: true,
            ..Options::default()
        };
        let first = super::super::practices(&facts, &opts);
        assert!(!first.concerns.is_empty());
        for _ in 0..8 {
            assert_eq!(super::super::practices(&facts, &opts), first);
        }
        for c in &first.concerns {
            let alone = super::super::practices(
                &facts,
                &Options {
                    scope: Scope {
                        concern: Some(c.id.clone()),
                        ..Scope::default()
                    },
                    ..opts.clone()
                },
            );
            assert_eq!(alone.concerns, vec![c.clone()]);
        }
    }
}

/// One instrument is one name, and one line, per concern: two checks found on
/// `verify_org` with different obligations, and the same instrument unclassified in
/// other units, make one line holding all their units, counted once.
#[test]
fn config_hints_count_and_print_one_line_per_instrument() {
    let i = "app/auth.py#verify_org";
    let check = |obligation: &str, members: usize| NotProvenCheck {
        check: format!("check:{i}"),
        obligation: obligation.into(),
        members,
        config_hint: config_hint("authz", i).unwrap(),
        ..Default::default()
    };
    let r = PracticesReport {
        concerns: vec![ConcernReport {
            id: "authz".into(),
            unknown: UnknownReport {
                checks: vec![check("under_branch", 2), check("and_operand", 1)],
                instruments: vec![InstrumentCount {
                    instrument: i.into(),
                    members: 4,
                    config_hint: config_hint("authz", i).unwrap(),
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    };
    assert_eq!(config_hint_counts(&r), (7, 1));
    let hints = config_hints(&r);
    assert!(
        hints.starts_with("# 7 unit(s) are unknown behind 1 name(s)"),
        "{hints}"
    );
    assert!(
        hints.ends_with("practices:\n  authz:\n    \"app/auth.py#verify_org\": \"verify_org\"  # 7 unit(s), 3 with a check found, not proven (under_branch, and_operand)\n"),
        "{hints}"
    );
    // The block parses: no key twice.
    let yaml: BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>> =
        serde_saphyr::from_str(&hints).unwrap();
    assert_eq!(yaml["practices"]["authz"].len(), 1);
}
