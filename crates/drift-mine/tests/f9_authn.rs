//! The authentication reading of a shared-secret refusal (stream F9).
//!
//! `refuses_secret:<header>` says a body leaves, with a refusal, where a request
//! header differs from a value read from the environment. The facts do not show
//! that the value is a secret: an `Origin` or `Host` header compared with the
//! app's public URL reads the same. So the unit is unknown (a check found, not
//! proven), never `service_auth`, which counts it as authenticated.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, controls};
use drift_mine::practices::{self, Options};

/// One TypeScript route handler `GET` whose body carries `controls`.
fn route(controls: Vec<String>) -> RepoFacts {
    RepoFacts {
        files: vec![FileFacts {
            path: "app/api/hook/route.ts".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![Symbol {
                name: "GET".into(),
                exported_as: vec!["GET".into()],
                line: 1,
                controls,
                ..Symbol::default()
            }],
            entry_points: vec![EntryPoint {
                symbol: "GET".into(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some("/api/hook".into()),
                adapter: "nextjs".into(),
            }],
            ..FileFacts::default()
        }],
        ..RepoFacts::default()
    }
}

/// `(assignment, key)` of the `GET` unit for authentication.
fn authn(facts: &RepoFacts) -> (String, String) {
    let opts = Options {
        units: true,
        ..Default::default()
    };
    let r = practices::practices(facts, &opts);
    let c = r
        .concerns
        .iter()
        .find(|c| c.id == practices::AUTHN)
        .expect("authn concern");
    let u = c
        .units
        .iter()
        .find(|u| u.symbol == "GET")
        .expect("GET unit");
    let key = u.key.clone().unwrap_or_else(|| {
        c.variants
            .iter()
            .find(|v| v.id == u.variant)
            .map(|v| v.key.clone())
            .unwrap_or_default()
    });
    (u.assignment.clone(), key)
}

/// Pins: an `Origin` (or `Host`) header compared with an environment value, the
/// body refusing where they differ, read `known service_auth:header:origin`
/// after S15a: a route no credential guards counted as authenticated. It is
/// unknown now, whatever the header.
#[test]
fn an_origin_compared_with_an_environment_value_is_not_service_auth() {
    for header in ["origin", "host", "authorization"] {
        let facts = route(vec![format!("{}{header}", controls::REFUSES_SECRET)]);
        let (assignment, key) = authn(&facts);
        assert!(!key.contains("service_auth"), "{header}: {assignment} {key}");
        assert_eq!(assignment, "unknown", "{header}: {key}");
    }
}
