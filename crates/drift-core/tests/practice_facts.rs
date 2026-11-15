//! Facts schema 11 (the practice facts): schema-10 facts still read, the new fields
//! round-trip, `normalize()` is idempotent and order-independent, every cap holds, and
//! the string policy drops what is no header name or route.

use drift_core::practice::caps;
use drift_core::*;

const SCHEMA10: &str = include_str!("fixtures/schema10.facts.json");

#[test]
fn schema_10_facts_still_read_and_round_trip() {
    let facts: RepoFacts = serde_json::from_str(SCHEMA10).expect("schema 10 facts read");
    assert_eq!(facts.schema_version, 10);
    for f in &facts.files {
        assert!(f.test_requests.is_empty() && f.mocks.is_empty() && f.route_matchers.is_empty());
        for s in &f.symbols {
            assert!(s.body_checks.is_empty() && s.responses.is_empty() && s.log_calls.is_empty());
            assert!(s.catches.is_empty() && s.headers.is_empty() && s.inputs.is_empty());
            assert!(s.handles_errors.is_empty());
        }
    }
    assert!(facts.packages.iter().all(|p| p.dev_only.is_empty()));
    // Nothing new is written for them: the same JSON comes back.
    let back = serde_json::to_value(&facts).unwrap();
    let want: serde_json::Value = serde_json::from_str(SCHEMA10).unwrap();
    assert_eq!(back, want);
    let mut n = facts.clone();
    n.normalize();
    assert_eq!(n, facts, "schema 10 facts are already canonical");
}

fn practice_symbol() -> Symbol {
    Symbol {
        name: "GET".into(),
        exported_as: vec!["GET".into()],
        line: 3,
        body_checks: vec![
            BodyCheck {
                source: "pkg:@clerk/nextjs/server#auth".into(),
                reads: ".orgId".into(),
                compares: "param:orgId".into(),
                outcome: CheckOutcome::Forbidden,
                op: drift_core::check_op::REFUSES_MISMATCH.into(),
                conditional: false,
                condition: String::new(),
                unless: String::new(),
                compares_path: String::new(),
                after: vec![],
            },
            BodyCheck {
                source: "pkg:@clerk/nextjs/server#auth".into(),
                reads: ".userId".into(),
                compares: String::new(),
                outcome: CheckOutcome::Unauthenticated,
                op: String::new(),
                conditional: false,
                condition: String::new(),
                unless: String::new(),
                compares_path: String::new(),
                after: vec![],
            },
        ],
        responses: vec![ResponseFact {
            status: 401,
            via: ResponseVia::Return,
            builder: "pkg:next/server#NextResponse.json".into(),
            model: String::new(),
            keys: vec!["message".into(), "error".into(), "error".into()],
            in_catch: false,
        }],
        log_calls: vec![LogCall {
            callee: "global#console.error".into(),
            level: "error".into(),
            in_catch: true,
            structured: false,
            passes_error: true,
            bound: false,
        }],
        catches: vec![CatchFact {
            catches: vec!["*".into()],
            does: vec!["respond:500".into(), "log".into()],
        }],
        headers: vec!["x-org-id".into(), "authorization".into()],
        inputs: vec!["lib/schemas.ts#CreateLink".into()],
        handles_errors: vec!["*".into()],
        ..Symbol::default()
    }
}

fn practice_file() -> FileFacts {
    FileFacts {
        path: "app/api/x/route.ts".into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![practice_symbol()],
        test_requests: vec![TestRequest {
            method: "GET".into(),
            route: "/api/x/[*]".into(),
            target: "app/api/x/route.ts".into(),
            statuses: vec![404, 401, 401],
            ..TestRequest::default()
        }],
        mocks: vec!["msw:/api/x".into(), "lib/db.ts".into()],
        route_matchers: vec![RouteMatcher {
            binding: "isPublicRoute".into(),
            patterns: vec!["/sign-in(.*)".into(), "/api/webhooks(.*)".into()],
            ..RouteMatcher::default()
        }],
        ..FileFacts::default()
    }
}

fn practice_repo() -> RepoFacts {
    RepoFacts {
        schema_version: FACTS_SCHEMA_VERSION,
        files: vec![practice_file()],
        packages: vec![PackageFacts {
            name: "web".into(),
            dependencies: vec!["next@15".into(), "vitest@2".into()],
            dev_only: vec!["vitest".into(), "eslint".into(), "vitest".into()],
            ..PackageFacts::default()
        }],
        ..RepoFacts::default()
    }
}

#[test]
fn schema_is_11() {
    assert_eq!(FACTS_SCHEMA_VERSION, 11);
}

#[test]
fn practice_facts_round_trip_and_serialise_canonically() {
    let mut facts = practice_repo();
    facts.normalize();
    let json = serde_json::to_string_pretty(&facts).unwrap();
    let back: RepoFacts = serde_json::from_str(&json).unwrap();
    assert_eq!(back, facts);
    let s = &facts.files[0].symbols[0];
    assert_eq!(s.headers, ["authorization", "x-org-id"]);
    assert_eq!(s.responses[0].keys, ["error", "message"]);
    assert_eq!(s.catches[0].does, ["log", "respond:500"]);
    assert_eq!(facts.files[0].test_requests[0].statuses, [401, 404]);
    assert_eq!(facts.packages[0].dev_only, ["eslint", "vitest"]);
    // Enums serialise snake_case.
    let v = serde_json::to_value(s).unwrap();
    assert_eq!(v["body_checks"][0]["outcome"], "forbidden");
    assert_eq!(v["responses"][0]["via"], "return");
    let out: CheckOutcome = serde_json::from_str("\"sign_in_redirect\"").unwrap();
    assert_eq!(out, CheckOutcome::SignInRedirect);
    let via: ResponseVia = serde_json::from_str("\"declared\"").unwrap();
    assert_eq!(via, ResponseVia::Declared);
}

#[test]
fn empty_practice_fields_are_omitted() {
    let v = serde_json::to_value(Symbol::default()).unwrap();
    for k in [
        "body_checks",
        "responses",
        "log_calls",
        "catches",
        "headers",
        "inputs",
        "handles_errors",
        "truncated",
    ] {
        assert!(v.get(k).is_none(), "{k}");
    }
    let v = serde_json::to_value(FileFacts::default()).unwrap();
    for k in ["test_requests", "mocks", "route_matchers", "truncated"] {
        assert!(v.get(k).is_none(), "{k}");
    }
    let v = serde_json::to_value(TestRequest::default()).unwrap();
    assert!(v.get("dynamic").is_none());
    let v = serde_json::to_value(RouteMatcher::default()).unwrap();
    assert!(v.get("opaque").is_none() && v.get("polarity").is_none());
    let v = serde_json::to_value(PackageFacts::default()).unwrap();
    assert!(v.get("dev_only").is_none());
}

#[test]
fn normalize_is_idempotent_and_order_independent() {
    let mut a = practice_repo();
    a.normalize();
    let mut twice = a.clone();
    twice.normalize();
    assert_eq!(twice, a);

    let mut b = practice_repo();
    let f = &mut b.files[0];
    f.mocks.reverse();
    f.route_matchers[0].patterns.reverse();
    let s = &mut f.symbols[0];
    s.body_checks.reverse();
    s.headers.reverse();
    s.catches[0].does.reverse();
    b.normalize();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

#[test]
fn every_cap_holds() {
    let n = 300;
    let names = |p: &str| (0..n).map(|i| format!("{p}{i:03}")).collect::<Vec<_>>();
    let mut f = practice_file();
    let s = &mut f.symbols[0];
    s.body_checks = names("a")
        .into_iter()
        .map(|source| BodyCheck {
            source,
            ..BodyCheck::default()
        })
        .collect();
    s.responses = (0..n as u16)
        .map(|status| ResponseFact {
            status,
            keys: names("k"),
            ..ResponseFact::default()
        })
        .collect();
    s.log_calls = names("c")
        .into_iter()
        .map(|callee| LogCall {
            callee,
            ..LogCall::default()
        })
        .collect();
    s.catches = names("e")
        .into_iter()
        .map(|c| CatchFact {
            catches: vec![c],
            does: vec![],
        })
        .collect();
    s.headers = names("x-");
    s.inputs = names("i");
    s.handles_errors = names("h");
    f.test_requests = names("/r")
        .into_iter()
        .map(|route| TestRequest {
            route,
            ..TestRequest::default()
        })
        .collect();
    f.mocks = names("m");
    f.route_matchers = names("b")
        .into_iter()
        .map(|binding| RouteMatcher {
            binding,
            patterns: names("/p"),
            ..RouteMatcher::default()
        })
        .collect();
    f.normalize();
    let s = &f.symbols[0];
    assert_eq!(s.body_checks.len(), caps::BODY_CHECKS);
    assert_eq!(s.responses.len(), caps::RESPONSES);
    assert!(
        s.responses
            .iter()
            .all(|r| r.keys.len() == caps::RESPONSE_KEYS)
    );
    assert_eq!(s.log_calls.len(), caps::LOG_CALLS);
    assert_eq!(s.catches.len(), caps::CATCHES);
    assert_eq!(s.headers.len(), caps::HEADERS);
    assert_eq!(s.inputs.len(), caps::INPUTS);
    assert_eq!(s.handles_errors.len(), caps::HANDLES);
    assert_eq!(f.test_requests.len(), caps::TEST_REQUESTS);
    assert_eq!(f.mocks.len(), caps::MOCKS);
    assert_eq!(f.route_matchers.len(), caps::MATCHERS);
    assert!(
        f.route_matchers
            .iter()
            .all(|m| m.patterns.len() == caps::MATCHER_PATTERNS)
    );
    // The first after sorting are kept, whatever order they came in.
    assert_eq!(s.headers[0], "x-000");
    assert_eq!(
        s.headers[caps::HEADERS - 1],
        format!("x-{:03}", caps::HEADERS - 1)
    );
    // Every cut is named, so a reader answers unknown for it.
    assert_eq!(
        s.truncated,
        [
            "body_checks",
            "catches",
            "handles_errors",
            "headers",
            "inputs",
            "log_calls",
            "responses",
            "responses.keys",
        ]
    );
    assert_eq!(
        f.truncated,
        [
            "mocks",
            "route_matchers",
            "route_matchers.patterns",
            "test_requests"
        ]
    );
    assert!(f.route_matchers.iter().all(|m| m.opaque));
    // Idempotent with `truncated` set: nothing more is cut, nothing is forgotten.
    let mut again = f.clone();
    again.normalize();
    assert_eq!(again, f);
}

#[test]
fn each_cap_names_only_its_own_field() {
    // One field at a time, one entry over its cap: exactly that name is recorded.
    type Fill = fn(&mut FileFacts, usize);
    let cases: [(&str, usize, Fill); 12] = [
        ("body_checks", caps::BODY_CHECKS, |f, n| {
            f.symbols[0].body_checks = (0..n)
                .map(|i| BodyCheck {
                    source: format!("s{i:03}"),
                    ..BodyCheck::default()
                })
                .collect()
        }),
        ("responses", caps::RESPONSES, |f, n| {
            f.symbols[0].responses = (0..n as u16)
                .map(|status| ResponseFact {
                    status,
                    ..ResponseFact::default()
                })
                .collect()
        }),
        ("responses.keys", caps::RESPONSE_KEYS, |f, n| {
            f.symbols[0].responses[0].keys = (0..n).map(|i| format!("k{i:03}")).collect()
        }),
        ("log_calls", caps::LOG_CALLS, |f, n| {
            f.symbols[0].log_calls = (0..n)
                .map(|i| LogCall {
                    callee: format!("c{i:03}"),
                    ..LogCall::default()
                })
                .collect()
        }),
        ("catches", caps::CATCHES, |f, n| {
            f.symbols[0].catches = (0..n)
                .map(|i| CatchFact {
                    catches: vec![format!("e{i:03}")],
                    does: vec![],
                })
                .collect()
        }),
        ("headers", caps::HEADERS, |f, n| {
            f.symbols[0].headers = (0..n).map(|i| format!("x-{i:03}")).collect()
        }),
        ("inputs", caps::INPUTS, |f, n| {
            f.symbols[0].inputs = (0..n).map(|i| format!("i{i:03}")).collect()
        }),
        ("handles_errors", caps::HANDLES, |f, n| {
            f.symbols[0].handles_errors = (0..n).map(|i| format!("h{i:03}")).collect()
        }),
        ("test_requests", caps::TEST_REQUESTS, |f, n| {
            f.test_requests = (0..n)
                .map(|i| TestRequest {
                    route: format!("/r{i:03}"),
                    ..TestRequest::default()
                })
                .collect()
        }),
        ("mocks", caps::MOCKS, |f, n| {
            f.mocks = (0..n).map(|i| format!("m{i:03}")).collect()
        }),
        ("route_matchers", caps::MATCHERS, |f, n| {
            f.route_matchers = (0..n)
                .map(|i| RouteMatcher {
                    binding: format!("b{i:03}"),
                    patterns: vec!["/x".into()],
                    ..RouteMatcher::default()
                })
                .collect()
        }),
        ("route_matchers.patterns", caps::MATCHER_PATTERNS, |f, n| {
            f.route_matchers[0].patterns = (0..n).map(|i| format!("/p{i:03}")).collect()
        }),
    ];
    for (name, cap, fill) in cases {
        let mut at_cap = practice_file();
        fill(&mut at_cap, cap);
        at_cap.normalize();
        assert!(at_cap.truncated.is_empty(), "{name} at its cap");
        assert!(at_cap.symbols[0].truncated.is_empty(), "{name} at its cap");

        let mut over = practice_file();
        fill(&mut over, cap + 1);
        over.normalize();
        let mut got = over.truncated.clone();
        got.extend(over.symbols[0].truncated.clone());
        assert_eq!(got, [name], "{name} one over its cap");
    }
}

#[test]
fn pre_amendment_schema_11_facts_still_read() {
    // Schema-11 facts written before the amendments (no `truncated`, `opaque`,
    // `polarity`, `dynamic`, no `invalid` outcome) read with the defaults and write
    // back unchanged.
    let json = serde_json::json!({
        "schema_version": 11,
        "files": [{
            "path": "middleware.ts", "hash": "", "lang": "ts", "package": "",
            "parse_ok": true, "directives": [], "imports": [], "exports": [],
            "symbols": [{
                "name": "GET", "kind": "function", "exported_as": ["GET"], "line": 1,
                "wraps": [], "calls": [], "renders": [], "args": [], "controls": [],
                "string_literals": 0,
                "body_checks": [{"source": "", "reads": "", "compares": "", "outcome": "forbidden"}]
            }],
            "entry_points": [],
            "test_requests": [{"method": "GET", "route": "/a", "target": "", "statuses": [200]}],
            "route_matchers": [{"binding": "config.matcher", "patterns": ["/api(.*)"]}]
        }],
        "skipped": []
    });
    let facts: RepoFacts = serde_json::from_value(json.clone()).expect("reads");
    let f = &facts.files[0];
    assert!(f.truncated.is_empty() && f.symbols[0].truncated.is_empty());
    assert!(!f.test_requests[0].dynamic);
    assert!(!f.route_matchers[0].opaque);
    assert_eq!(f.route_matchers[0].polarity, MatcherPolarity::Unknown);
    assert_eq!(serde_json::to_value(&facts).unwrap(), json);
    let mut n = facts.clone();
    n.normalize();
    assert_eq!(n, facts, "already canonical");
}

#[test]
fn amendment_fields_round_trip() {
    let mut f = practice_file();
    f.test_requests[0].dynamic = true;
    f.route_matchers[0].polarity = MatcherPolarity::Public;
    f.symbols[0].body_checks[0].outcome = CheckOutcome::Invalid;
    f.normalize();
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(v["test_requests"][0]["dynamic"], true);
    assert_eq!(v["route_matchers"][0]["polarity"], "public");
    assert!(v["route_matchers"][0].get("opaque").is_none());
    assert!(
        v["symbols"][0]["body_checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["outcome"] == "invalid")
    );
    let back: FileFacts = serde_json::from_value(v).unwrap();
    assert_eq!(back, f);
    let p: MatcherPolarity = serde_json::from_str("\"applies\"").unwrap();
    assert_eq!(p, MatcherPolarity::Applies);
}

#[test]
fn a_matcher_with_no_readable_pattern_is_opaque() {
    let mut f = practice_file();
    // The Clerk default matcher and a negative lookahead: nothing survives the
    // route check, which reads as unknown, never as "matches nothing".
    f.route_matchers[0].patterns = vec!["/(api|trpc)(.*)".into(), "/((?!_next).*)".into()];
    f.normalize();
    assert!(f.route_matchers[0].patterns.is_empty());
    assert!(f.route_matchers[0].opaque);
    // One pattern dropped, one kept: known patterns, and not all of them.
    let mut f = practice_file();
    f.route_matchers[0].patterns = vec!["/((?!_next).*)".into(), "/sign-in(.*)".into()];
    f.normalize();
    assert_eq!(f.route_matchers[0].patterns, ["/sign-in(.*)"]);
    assert!(f.route_matchers[0].opaque);
    // Every pattern readable: not opaque.
    let mut f = practice_file();
    f.normalize();
    assert!(!f.route_matchers[0].opaque);
    // An empty list from lowering is unknown too.
    let mut f = practice_file();
    f.route_matchers[0].patterns.clear();
    f.normalize();
    assert!(f.route_matchers[0].opaque);
}

#[test]
fn string_policy_drops_what_is_no_header_or_route() {
    let mut f = practice_file();
    let s = &mut f.symbols[0];
    s.headers = vec!["X-Org-Id".into(), "Bearer abc123".into(), "x-org-id".into()];
    f.test_requests[0].route = "hello world".into();
    f.mocks = vec![
        "msw:not a route".into(),
        "msw:/api/ok".into(),
        "lib/db.ts".into(),
    ];
    f.route_matchers[0].patterns = vec![
        "/((?!api|_next).*)".into(),
        "some secret".into(),
        "/dashboard(.*)".into(),
    ];
    f.normalize();
    assert_eq!(f.symbols[0].headers, ["x-org-id"]);
    assert_eq!(f.test_requests[0].route, "");
    assert_eq!(f.mocks, ["lib/db.ts", "msw:/api/ok"]);
    assert_eq!(f.route_matchers[0].patterns, ["/dashboard(.*)"]);
}
