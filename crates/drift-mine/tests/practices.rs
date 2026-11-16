//! The practice map contract (PLAN-R13 §0): the empty engine output (golden) and the
//! hand-written schema-11 fixtures that the engine and the concern classifiers are
//! built against before the parsers record the new facts.

use drift_core::practice::{valid_header, valid_route};
use drift_core::{CheckOutcome, FACTS_SCHEMA_VERSION, RepoFacts, ResponseVia};
use drift_mine::practices::{self, Options};

const FIXTURES: &[(&str, &str)] = &[
    (
        "next_clerk",
        include_str!("fixtures/practices/next_clerk.facts.json"),
    ),
    (
        "fastapi_split",
        include_str!("fixtures/practices/fastapi_split.facts.json"),
    ),
    (
        "nest_mixed",
        include_str!("fixtures/practices/nest_mixed.facts.json"),
    ),
];

fn fixture(json: &str) -> RepoFacts {
    serde_json::from_str(json).expect("fixture reads as RepoFacts")
}

#[test]
fn empty_engine_output() {
    let report = practices::practices(&RepoFacts::default(), &Options::default());
    insta::assert_json_snapshot!("empty_report", report);
    // It reads back as the same report.
    let json = serde_json::to_string(&report).unwrap();
    let back: practices::PracticesReport = serde_json::from_str(&json).unwrap();
    assert_eq!(back, report);
}

#[test]
fn fixtures_are_canonical_schema_11_facts() {
    for (name, json) in FIXTURES {
        let facts = fixture(json);
        assert_eq!(facts.schema_version, FACTS_SCHEMA_VERSION, "{name}");
        let mut n = facts.clone();
        n.normalize();
        assert_eq!(n, facts, "{name} is not in normalize() order");
        let back = serde_json::to_value(&facts).unwrap();
        let want: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(back, want, "{name} does not round-trip");
    }
}

#[test]
fn the_engine_reads_every_fixture() {
    for (name, json) in FIXTURES {
        let r = practices::practices(&fixture(json), &Options::default());
        assert_eq!(r.version, practices::VERSION, "{name}");
        assert_eq!(r.facts_schema, FACTS_SCHEMA_VERSION, "{name}");
        assert!(
            r.concerns
                .iter()
                .all(|c| practices::concern_title(&c.id).is_some())
        );
    }
}

#[test]
fn fixtures_exercise_every_new_field() {
    let all: Vec<RepoFacts> = FIXTURES.iter().map(|(_, j)| fixture(j)).collect();
    let files = || all.iter().flat_map(|r| &r.files);
    let syms = || files().flat_map(|f| &f.symbols);
    assert!(syms().any(|s| !s.body_checks.is_empty()));
    assert!(syms().any(|s| !s.responses.is_empty()));
    assert!(syms().any(|s| !s.log_calls.is_empty()));
    assert!(syms().any(|s| !s.catches.is_empty()));
    assert!(syms().any(|s| !s.headers.is_empty()));
    assert!(syms().any(|s| !s.inputs.is_empty()));
    assert!(syms().any(|s| !s.handles_errors.is_empty()));
    assert!(files().any(|f| !f.test_requests.is_empty()));
    assert!(files().any(|f| !f.mocks.is_empty()));
    assert!(files().any(|f| !f.route_matchers.is_empty()));
    assert!(
        all.iter()
            .flat_map(|r| &r.packages)
            .any(|p| !p.dev_only.is_empty())
    );
    for o in [
        CheckOutcome::Unauthenticated,
        CheckOutcome::Forbidden,
        CheckOutcome::NotFound,
        CheckOutcome::Throttled,
        CheckOutcome::SignInRedirect,
    ] {
        assert!(
            syms().flat_map(|s| &s.body_checks).any(|b| b.outcome == o),
            "{o:?}"
        );
    }
    for v in [
        ResponseVia::Return,
        ResponseVia::Throw,
        ResponseVia::Setter,
        ResponseVia::Abort,
        ResponseVia::Declared,
        ResponseVia::Redirect,
    ] {
        assert!(
            syms().flat_map(|s| &s.responses).any(|r| r.via == v),
            "{v:?}"
        );
    }
    // A route whose handler is re-exported (its symbol is not in the file).
    assert!(files().any(|f| f.entry_points.iter().any(|e| {
        !f.symbols.iter().any(|s| s.name == e.symbol)
            && f.exports
                .iter()
                .any(|x| x.name == e.symbol && x.kind == drift_core::ExportKind::ReExport)
    })));
    // The string policy holds in the fixtures.
    assert!(syms().flat_map(|s| &s.headers).all(|h| valid_header(h)));
    assert!(
        files()
            .flat_map(|f| &f.route_matchers)
            .flat_map(|m| &m.patterns)
            .all(|p| valid_route(p))
    );
    assert!(
        files()
            .flat_map(|f| &f.test_requests)
            .all(|t| t.route.is_empty() || valid_route(&t.route))
    );
}

// ---------- the engine, end to end, with a test-only authn classifier ----------
//
// The concern classifiers are workstream E's (`practices/<id>.rs`); this stub is only
// here so the engine runs end to end on the fixtures. It is registered nowhere.

use drift_core::{EntryPoint, FileFacts, Symbol, WrapKind};
use drift_mine::practices::{
    AUTHN, Assignment, Concern, Cx, PracticesReport, UnitRef, UnknownReason, Use, VariantKey,
    VariantSource,
};

/// Production entry points (re-exports followed); uses: wraps by kind, sign-in
/// checks in the body, the middleware of the package when its matcher covers the
/// route and its public matcher does not, and markers that open the route.
struct StubAuthn;

const ENTRY_KINDS: &[&str] = &["http", "server_action", "graphql", "rpc", "job"];

fn matches(pattern: &str, route: &str) -> bool {
    let prefix = pattern
        .split(['(', '[', ':', '*'])
        .next()
        .unwrap_or(pattern);
    route.starts_with(prefix.trim_end_matches('/'))
}

fn middleware_use<'a>(cx: &Cx<'a>, file: &'a FileFacts, route: &str) -> Option<Use> {
    let m = cx.facts.files.iter().find(|f| {
        f.package == file.package && f.entry_points.iter().any(|e| e.kind == "middleware")
    })?;
    let runs = match m
        .route_matchers
        .iter()
        .find(|r| r.binding == "config.matcher")
    {
        None => true,
        Some(r) => r.patterns.iter().any(|p| matches(p, route)),
    };
    let public = m
        .route_matchers
        .iter()
        .filter(|r| r.binding != "config.matcher")
        .any(|r| r.patterns.iter().any(|p| matches(p, route)));
    let entry = m.entry_points.iter().find(|e| e.kind == "middleware")?;
    let s = m.symbols.iter().find(|s| s.name == entry.symbol)?;
    let w = s.wraps.first()?;
    (runs && !public).then(|| Use {
        mechanism: "middleware".into(),
        instrument: w.wrapper.clone(),
    })
}

impl Concern for StubAuthn {
    fn id(&self) -> &'static str {
        AUTHN
    }
    fn unit(&self) -> &'static str {
        "entry_point"
    }
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        let mut out = Vec::new();
        for file in &cx.facts.files {
            for entry in &file.entry_points {
                if ENTRY_KINDS.contains(&entry.kind.as_str()) {
                    out.push(UnitRef::Entry {
                        file,
                        entry,
                        symbol: cx.entry_symbol(file, entry).map(|(_, s)| s),
                    });
                }
            }
        }
        out
    }
    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        let UnitRef::Entry {
            file,
            entry,
            symbol,
        } = *unit
        else {
            unreachable!()
        };
        let Some(s) = symbol else {
            return Assignment::Unknown {
                reason: UnknownReason::NoSymbol,
                instrument: String::new(),
            };
        };
        let mut uses = Vec::new();
        for w in &s.wraps {
            let mechanism = match w.kind {
                WrapKind::Call => "wrap",
                WrapKind::Decorator => "decorator",
                WrapKind::Extends => "base",
                WrapKind::Config => "config",
                WrapKind::AppHook => "app_hook",
                WrapKind::Opens => "opens",
                _ => continue,
            };
            uses.push(Use {
                mechanism: mechanism.into(),
                instrument: w.wrapper.clone(),
            });
        }
        for b in &s.body_checks {
            if matches!(
                b.outcome,
                drift_core::CheckOutcome::Unauthenticated
                    | drift_core::CheckOutcome::SignInRedirect
            ) {
                uses.push(Use {
                    mechanism: "body_check".into(),
                    instrument: format!("{}{}", b.source, b.reads),
                });
            }
        }
        if let Some(u) = entry
            .route
            .as_deref()
            .and_then(|r| middleware_use(cx, file, r))
        {
            uses.push(u);
        }
        if uses.is_empty() {
            return Assignment::None {
                label: "no guard".into(),
            };
        }
        let key = VariantKey::new(&uses);
        Assignment::Known {
            label: format!("authn: {}", key.key),
            uses,
            source: VariantSource::Vocab,
        }
    }
}

fn stub() -> Vec<Box<dyn Concern>> {
    vec![Box::new(StubAuthn)]
}

fn run(facts: &RepoFacts) -> PracticesReport {
    practices::practices_with(facts, &Options::default(), &stub())
}

#[test]
fn engine_goldens_on_the_fixtures() {
    for (name, json) in FIXTURES {
        let r = run(&fixture(json));
        insta::assert_json_snapshot!(format!("engine_{name}"), r);
        insta::assert_snapshot!(format!("engine_{name}_text"), practices::render(&r, false));
    }
}

/// A deterministic shuffle (no rand dependency): reverse, then interleave halves.
fn shuffled(facts: &RepoFacts, seed: usize) -> RepoFacts {
    let mut f = facts.clone();
    f.files.reverse();
    let n = f.files.len();
    if n > 2 {
        f.files.rotate_left(seed % n);
        let (a, b) = f.files.split_at(n / 2);
        let mut mixed = Vec::with_capacity(n);
        for i in 0..n.div_ceil(2) {
            if let Some(x) = b.get(i) {
                mixed.push(x.clone());
            }
            if let Some(x) = a.get(i) {
                mixed.push(x.clone());
            }
        }
        f.files = mixed;
    }
    for file in &mut f.files {
        file.symbols.reverse();
        file.entry_points.reverse();
    }
    f
}

#[test]
fn engine_output_does_not_depend_on_file_order() {
    for (name, json) in FIXTURES {
        let facts = fixture(json);
        let want = serde_json::to_string_pretty(&run(&facts)).unwrap();
        for seed in 0..4 {
            let got = serde_json::to_string_pretty(&run(&shuffled(&facts, seed))).unwrap();
            assert_eq!(got, want, "{name}, shuffle {seed}");
        }
    }
}

fn concern<'r>(r: &'r PracticesReport, id: &str) -> &'r practices::ConcernReport {
    r.concerns.iter().find(|c| c.id == id).expect("concern")
}

#[test]
fn a_reexported_handler_is_read_at_its_origin() {
    let facts = fixture(FIXTURES[0].1);
    let r = run(&facts);
    let c = concern(&r, AUTHN);
    // `app/api/legacy/route.ts` re-exports GET from lib/handlers.ts: it is assigned
    // (its symbol was found), not unknown for want of a symbol.
    assert!(
        c.unknown
            .reasons
            .iter()
            .all(|x| x.reason != UnknownReason::NoSymbol),
        "{:?}",
        c.unknown
    );
}

#[test]
fn split_auth_is_one_key() {
    let facts = fixture(FIXTURES[0].1);
    let r = run(&facts);
    let c = concern(&r, AUTHN);
    // The project routes and the re-exported legacy one are covered by clerkMiddleware
    // AND check auth().userId in the body: one variant with both uses, not two.
    let v = c
        .variants
        .iter()
        .find(|v| v.mechanisms == ["body_check", "middleware"])
        .unwrap_or_else(|| panic!("{:#?}", c.variants));
    assert_eq!(v.members, 3, "{v:#?}");
    assert_eq!(c.variants.len(), 2, "{:#?}", c.variants);
    assert!(v.key.contains('+'));
}

#[test]
fn the_guard_filter_drops_a_dependency_that_rejects_no_one() {
    let facts = fixture(FIXTURES[1].1);
    let r = run(&facts);
    let c = concern(&r, AUTHN);
    let keys: Vec<&str> = c.variants.iter().map(|v| v.key.as_str()).collect();
    assert!(
        keys.iter().all(|k| !k.contains("get_db")),
        "get_db is no guard: {keys:?}"
    );
    assert!(
        c.variants
            .iter()
            .any(|v| v.key.contains("get_current_user")),
        "{keys:?}"
    );
}

/// One handler file with one entry point, wrapped by `wrapper` (none when empty).
fn one_route(path: &str, wrapper: &str, parse_ok: bool) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok,
        symbols: vec![Symbol {
            name: "GET".into(),
            exported_as: vec!["GET".into()],
            line: 3,
            wraps: if wrapper.is_empty() {
                Vec::new()
            } else {
                vec![drift_core::Wrap {
                    wrapper: wrapper.into(),
                    kind: WrapKind::Call,
                }]
            },
            ..Symbol::default()
        }],
        entry_points: vec![EntryPoint {
            symbol: "GET".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!(
                "/{}",
                path.trim_start_matches("app/")
                    .trim_end_matches("/route.ts")
            )),
            adapter: "nextjs".into(),
        }],
        ..FileFacts::default()
    }
}

fn repo(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        schema_version: FACTS_SCHEMA_VERSION,
        files,
        ..RepoFacts::default()
    };
    r.normalize();
    r
}

/// A classifier that says what it is told, to test the engine's own rules.
struct Says(fn(&UnitRef) -> Assignment);

impl Concern for Says {
    fn id(&self) -> &'static str {
        AUTHN
    }
    fn unit(&self) -> &'static str {
        "entry_point"
    }
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        StubAuthn.population(cx)
    }
    fn assign<'a>(&self, _cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        (self.0)(unit)
    }
}

fn says(facts: &RepoFacts, f: fn(&UnitRef) -> Assignment) -> practices::Population {
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(f))];
    let r = practices::practices_with(facts, &Options::default(), &c);
    r.concerns[0].population.clone()
}

#[test]
fn strict_unknown_dominates_known() {
    // [STRICT] One unclassified instrument beside a known one: the unit is unknown.
    let facts = repo(vec![one_route("app/a/route.ts", "", true)]);
    let p = says(&facts, |_| Assignment::Known {
        uses: vec![
            Use {
                mechanism: "middleware".into(),
                instrument: "pkg:@clerk/nextjs/server#clerkMiddleware".into(),
            },
            Use {
                mechanism: "body_call".into(),
                instrument: "unclassified:checkThing".into(),
            },
        ],
        label: "x".into(),
        source: VariantSource::Vocab,
    });
    assert_eq!((p.known, p.unknown), (0, 1), "{p:?}");
}

#[test]
fn strict_unparsed_is_never_known_or_none() {
    // [STRICT] A file the parser reported errors in: best-effort facts, unknown.
    let facts = repo(vec![one_route("app/a/route.ts", "", false)]);
    let p = says(&facts, |_| Assignment::None {
        label: "no guard".into(),
    });
    assert_eq!((p.none, p.unknown), (0, 1), "{p:?}");
}

#[test]
fn strict_no_false_none() {
    // [STRICT] A `none` on a route wrapped by an in-repo wrapper the facts lack: that
    // wrapper may be the guard, so the unit is unknown (opaque_wrapper), never none.
    let facts = repo(vec![one_route(
        "app/a/route.ts",
        "lib/auth.ts#withAuth",
        true,
    )]);
    let c: Vec<Box<dyn Concern>> = vec![Box::new(Says(|_| Assignment::None {
        label: "no guard".into(),
    }))];
    let r = practices::practices_with(&facts, &Options::default(), &c);
    let p = &r.concerns[0].population;
    assert_eq!((p.none, p.unknown), (0, 1), "{p:?}");
    assert_eq!(
        r.concerns[0].unknown.reasons[0].reason,
        UnknownReason::OpaqueWrapper
    );
    assert_eq!(
        r.concerns[0].unknown.instruments[0].instrument,
        "lib/auth.ts#withAuth"
    );
}

#[test]
fn strict_unreadable_matcher_proves_no_coverage() {
    // [STRICT] A middleware whose config.matcher could not be read (no patterns): a
    // route it may cover is unknown, neither none nor guarded by it.
    let mut mw = one_route(
        "middleware.ts",
        "pkg:@clerk/nextjs/server#clerkMiddleware",
        true,
    );
    mw.symbols[0].name = "default".into();
    mw.symbols[0].exported_as = vec!["default".into()];
    // It protects what it matches (a middleware that rejects no one covers nothing).
    mw.symbols[0]
        .calls
        .push("pkg:@clerk/nextjs/server#auth.protect".into());
    mw.entry_points = vec![EntryPoint {
        symbol: "default".into(),
        kind: "middleware".into(),
        method: None,
        route: None,
        adapter: "nextjs".into(),
    }];
    mw.route_matchers = vec![drift_core::RouteMatcher {
        binding: "config.matcher".into(),
        patterns: Vec::new(),
        ..Default::default()
    }];
    let facts = repo(vec![one_route("app/a/route.ts", "", true), mw]);
    let none = says(&facts, |_| Assignment::None {
        label: "no guard".into(),
    });
    assert_eq!((none.none, none.unknown), (0, 1), "{none:?}");
    let known = says(&facts, |_| Assignment::Known {
        uses: vec![Use {
            mechanism: "middleware".into(),
            instrument: "pkg:@clerk/nextjs/server#clerkMiddleware".into(),
        }],
        label: "x".into(),
        source: VariantSource::Vocab,
    });
    assert_eq!((known.known, known.unknown), (0, 1), "{known:?}");
}

#[test]
fn tests_and_non_production_are_left_out_and_counted() {
    let facts = repo(vec![
        one_route("app/a/route.ts", "", true),
        one_route("app/a/route.test.ts", "", true),
        one_route("examples/demo/app/b/route.ts", "", true),
    ]);
    let p = says(&facts, |_| Assignment::None {
        label: "no guard".into(),
    });
    assert_eq!(p.total, 1, "{p:?}");
    assert_eq!(
        (p.left_out.tests, p.left_out.non_production),
        (1, 1),
        "{p:?}"
    );
}

#[test]
fn a_wrapper_variant_is_promotable_and_its_exceptions_are_listed() {
    // 10 routes wrapped in withAuth (a guard: it rejects callers), 2 with nothing.
    let mut files: Vec<FileFacts> = (0..10)
        .map(|i| one_route(&format!("app/r{i}/route.ts"), "lib/auth.ts#withAuth", true))
        .collect();
    files.extend((10..12).map(|i| one_route(&format!("app/r{i}/route.ts"), "", true)));
    files.push(FileFacts {
        path: "lib/auth.ts".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![Symbol {
            name: "withAuth".into(),
            exported_as: vec!["withAuth".into()],
            line: 1,
            controls: vec![drift_core::controls::REJECTS_CALLER.to_string()],
            ..Symbol::default()
        }],
        ..FileFacts::default()
    });
    let facts = repo(files);
    // Read only for a report that shows it (`Options::promotable`).
    assert!(
        concern(&run(&facts), AUTHN)
            .variants
            .iter()
            .all(|v| v.promotable.is_none())
    );
    let opts = Options {
        promotable: true,
        ..Options::default()
    };
    let r = practices::practices_with(&facts, &opts, &stub());
    let c = concern(&r, AUTHN);
    let top = &c.variants[0];
    assert_eq!(
        (top.members, top.key.as_str()),
        (10, "wrap:lib/auth.ts#withAuth")
    );
    // 10 of the 12 routes of the root package (and of `app`) follow it: promotable
    // there, the broadest place, though the report lists no unit.
    assert!(c.units.is_empty());
    let p = top.promotable.as_ref().expect("promotable");
    assert_eq!(p.rule, "practice");
    assert_eq!(p.role, "");
    assert_eq!(p.place.as_deref(), Some("."));
    let none = c
        .variants
        .iter()
        .find(|v| v.kind == practices::VariantKind::None)
        .unwrap();
    assert!(none.promotable.is_none());
    // The two unguarded routes are the exceptions in withAuth's place.
    assert_eq!(top.exceptions.len(), 2, "{:#?}", top.exceptions);
    assert!(top.exceptions.iter().all(|e| e.variant == none.id));
    // Card lines: an unguarded file is told what its package mostly does.
    let lines =
        practices::card_lines_with(&facts, &Options::default(), &stub(), "app/r10/route.ts");
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(lines[0].contains("the package mostly"), "{lines:?}");
    let hook = practices::package_line_with(&facts, &Options::default(), &stub(), "").unwrap();
    assert!(
        hook.starts_with("drift: practices in . (facts, not rules): authn "),
        "{hook}"
    );
    // Every line an agent gets names a member to copy with its line.
    assert!(hook.contains("copy app/r0/route.ts:3"), "{hook}");
    assert!(lines[0].contains("route.ts:3"), "{lines:?}");
    let agent = practices::render_agent(&r, &[]);
    assert!(agent.len() <= practices::AGENT_CHARS, "{agent}");
    assert!(
        agent.contains("new http entry points in .: authn: "),
        "{agent}"
    );
    assert!(
        !agent.contains("unknown") && !agent.contains('%'),
        "{agent}"
    );
}

#[test]
fn units_list_every_member_and_sum_to_the_population() {
    for (name, json) in FIXTURES {
        let facts = fixture(json);
        let opts = Options {
            units: true,
            ..Options::default()
        };
        let r = practices::practices_with(&facts, &opts, &stub());
        for c in &r.concerns {
            let p = &c.population;
            let n = |a: &str| c.units.iter().filter(|u| u.assignment == a).count();
            assert_eq!(c.units.len(), p.total, "{name}");
            assert_eq!(
                (n("known"), n("none"), n("unknown")),
                (p.known, p.none, p.unknown),
                "{name}"
            );
            // Each variant's members, and only unknown units have a reason.
            for v in &c.variants {
                assert_eq!(
                    c.units.iter().filter(|u| u.variant == v.id).count(),
                    v.members,
                    "{name} {}",
                    v.id
                );
            }
            assert!(
                c.units
                    .iter()
                    .all(|u| (u.assignment == "unknown") == u.reason.is_some())
            );
            let mut sorted = c.units.clone();
            sorted.sort();
            assert_eq!(sorted, c.units, "{name}");
        }
        // Off by default: the v1 output is unchanged.
        let plain = serde_json::to_value(run(&facts)).unwrap();
        assert!(plain["concerns"][0].get("units").is_none(), "{name}");
    }
}

#[test]
fn every_emitted_hint_makes_its_units_known() {
    // With the registered classifiers: each config_hint, written to
    // .drift/config.yaml, leaves no unit of its concern unknown for its instrument.
    let mut checked = 0;
    for (name, json) in FIXTURES {
        let facts = fixture(json);
        let r = practices::practices(&facts, &Options::default());
        for c in &r.concerns {
            for i in c
                .unknown
                .instruments
                .iter()
                .filter(|i| !i.config_hint.is_empty())
            {
                let dir = tempfile::tempdir().unwrap();
                std::fs::create_dir_all(dir.path().join(".drift")).unwrap();
                std::fs::write(dir.path().join(".drift/config.yaml"), &i.config_hint).unwrap();
                let cfg = drift_mine::policy::DriftConfig::load(dir.path()).unwrap();
                assert!(cfg.warnings.is_empty(), "{name}: {:?}", cfg.warnings);
                let opts = Options {
                    declared: cfg.practices,
                    units: true,
                    ..Options::default()
                };
                let after = practices::practices(&facts, &opts);
                let c2 = after.concerns.iter().find(|x| x.id == c.id).unwrap();
                assert!(
                    c2.unknown
                        .instruments
                        .iter()
                        .all(|x| x.instrument != i.instrument),
                    "{name} {}: {} still unknown after {}",
                    c.id,
                    i.instrument,
                    i.config_hint
                );
                assert!(
                    c2.population.known >= c.population.known + i.members,
                    "{name} {}",
                    c.id
                );
                checked += 1;
            }
            // Never a hint for a pseudo-instrument.
            for i in &c.unknown.instruments {
                if !i.instrument.contains('#') {
                    assert!(
                        i.config_hint.is_empty(),
                        "{name} {}: {}",
                        c.id,
                        i.instrument
                    );
                }
            }
        }
    }
    let _ = checked;
}
