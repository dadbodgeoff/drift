//! CV-2: the engine's route-flavour classification must agree with `@drift/core`'s.
//!
//! Two implementations of one rule exist by necessity. The engine classifies at fact time, so the
//! candidate deriver reads a classification instead of matching globs itself - a deriver with its own
//! glob engine is the BB-11 divergence in a new place. The TypeScript side needs the same rule to
//! decide the scope of an accepted convention. Code cannot be shared across the process boundary, so
//! **this table is the seam that holds them together**: it is the same list of paths asserted in
//! packages/core/test/route-flavor-cv2.test.ts, and if either side drifts, one of the two files fails.
//!
//! F3 is why this exists at all. Two glob implementations disagreeing about `**/app/api/**` silently
//! disabled enforcement for the default create-next-app layout while still reporting `can_block: true`.
//! A flavour rule that disagreed across the boundary would put routes in one denominator on the
//! inference side and a different one on the enforcement side - the same class of bug, harder to see.
//!
//! When adding a case here, add it to the TypeScript test too. The pairing is the mechanism.

use std::process::Command;

/// Every case in this table also appears in packages/core/test/route-flavor-cv2.test.ts.
const EXPECTED: &[(&str, &str)] = &[
    // Ordinary routes.
    ("app/api/users/route.ts", "api_route"),
    ("app/api/users/[id]/route.ts", "api_route"),
    ("apps/web/app/(admin)/api/projects/route.ts", "api_route"),
    ("pages/api/users.ts", "api_route"),
    // The substring trap. These are ordinary routes and calling any of them a cron job would move it
    // out of the session family's denominator.
    ("app/api/crontab-editor/route.ts", "api_route"),
    ("app/api/cronjobs-docs/route.ts", "api_route"),
    ("app/api/webhooks-docs/route.ts", "api_route"),
    ("app/api/synchronised/route.ts", "api_route"),
    // Only segments below the api boundary decide flavour.
    ("apps/cron-service/app/api/users/route.ts", "api_route"),
    ("apps/cron/app/api/users/route.ts", "api_route"),
    ("apps/cron/app/api/cron/rollup/route.ts", "cron_job"),
    // Cron, including dub's real shape.
    ("apps/web/app/(ee)/api/cron/aggregate-clicks/route.ts", "cron_job"),
    ("app/api/cron/rollup/route.ts", "cron_job"),
    ("app/api/jobs/nightly/route.ts", "cron_job"),
    ("app/api/scheduled/digest/route.ts", "cron_job"),
    // Webhooks, including dub's real shape.
    ("apps/web/app/(ee)/api/appsflyer/webhook/route.ts", "webhook_handler"),
    ("app/api/webhooks/stripe/route.ts", "webhook_handler"),
    // Both signals: a scheduled job that replays webhooks is a job. Pinned so it cannot silently flip.
    ("app/api/cron/webhooks/replay/route.ts", "cron_job"),
    // Route groups carry no flavour.
    ("apps/web/app/(ee)/api/cron/x/route.ts", "cron_job"),
    ("apps/web/app/(ee)/api/admin/x/route.ts", "api_route"),
];

#[test]
fn engine_route_flavor_matches_the_core_predicate_table() {
    for (path, expected) in EXPECTED {
        assert_eq!(
            drift_engine::route_flavor(path),
            *expected,
            "flavour of {path} must match what @drift/core's routeFlavor returns for it"
        );
    }
}

/// The table is only a seam if the TypeScript side really asserts the same paths. This reads that test
/// file and fails when a case here is missing from it, so the two cannot quietly drift apart.
#[test]
fn every_case_in_this_table_is_also_asserted_in_typescript() {
    let ts_test = std::fs::read_to_string(
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/core/test/route-flavor-cv2.test.ts"),
    )
    .expect("the core route-flavour test must exist - it is the other half of this differential");

    let missing = EXPECTED
        .iter()
        .map(|(path, _)| *path)
        .filter(|path| !ts_test.contains(path))
        .collect::<Vec<_>>();

    assert!(
        missing.is_empty(),
        "these paths are pinned on the engine side but asserted nowhere in \
         packages/core/test/route-flavor-cv2.test.ts, so the two implementations could diverge on \
         them unnoticed: {missing:?}"
    );
}

/// The flavour has to arrive as a fact, because that is what lets the deriver score per-flavour
/// denominators without matching a single glob of its own.
#[test]
fn scanning_a_route_emits_its_flavour_as_a_fact() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    for (relative, _) in [
        ("app/api/users/route.ts", ()),
        ("app/api/cron/rollup/route.ts", ()),
        ("app/api/webhooks/stripe/route.ts", ()),
    ] {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(
            &path,
            "export async function POST() { return Response.json({ ok: true }); }\n",
        )
        .expect("write");
    }

    let payload = scan_repo(root);
    let facts = payload["facts"].as_array().expect("facts");

    let flavor_of = |file: &str| -> Option<String> {
        facts.iter().find_map(|fact| {
            (fact["kind"] == "route_flavor_detected" && fact["file_path"] == file)
                .then(|| fact["name"].as_str().unwrap_or_default().to_string())
        })
    };

    assert_eq!(flavor_of("app/api/users/route.ts").as_deref(), Some("api_route"));
    assert_eq!(flavor_of("app/api/cron/rollup/route.ts").as_deref(), Some("cron_job"));
    assert_eq!(
        flavor_of("app/api/webhooks/stripe/route.ts").as_deref(),
        Some("webhook_handler")
    );
}

/// A file that is not a route has no flavour. Emitting one would be classifying something that has
/// none, and it would put non-routes into flavour denominators.
#[test]
fn a_non_route_file_gets_no_flavour_fact() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let path = root.join("lib/cron/scheduler.ts");
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    // Named `cron` on purpose: if flavour were emitted for every file, this is the one that would
    // wrongly acquire a cron flavour.
    std::fs::write(&path, "export const schedule = () => undefined;\n").expect("write");

    let payload = scan_repo(root);

    let flavors = payload["facts"]
        .as_array()
        .expect("facts")
        .iter()
        .filter(|fact| fact["kind"] == "route_flavor_detected")
        .count();
    assert_eq!(flavors, 0, "a library module is not a route and has no flavour");
}

fn scan_repo(repo_root: &std::path::Path) -> serde_json::Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("scan-repo")
        .arg(repo_root)
        .arg("--format")
        .arg("json")
        .arg("--repo-id")
        .arg("repo_cv2")
        .arg("--scan-id")
        .arg("scan_cv2")
        .output()
        .expect("run scan-repo");
    assert!(
        output.status.success(),
        "scan failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("scan json")
}

// ---------------------------------------------------------------------------------------------
// CV-2 in the deriver: families are conditioned on flavour, and only when the repo has flavours.
// Negative controls first - the one that matters is that an unflavoured repo is UNCHANGED.
// ---------------------------------------------------------------------------------------------

use serde_json::{Value, json};
use std::io::Write;

struct Route<'a> {
    path: &'a str,
    symbol: &'a str,
    module: &'a str,
    flavor: &'a str,
}

/// One wrapped route: role, flavour, import, wrapping call, and the response it encloses.
fn request_from_routes(routes: &[Route<'_>]) -> Value {
    let mut facts = Vec::new();
    let mut snapshots = Vec::new();
    for (index, route) in routes.iter().enumerate() {
        snapshots.push(json!({
            "file_path": route.path,
            "content_hash": format!("{:0>64}", index),
            "byte_size": 120,
            "indexed": true
        }));
        facts.push(json!({
            "kind": "file_role_detected", "file_path": route.path, "name": "api_route",
            "start_line": 1, "end_line": 8
        }));
        facts.push(json!({
            "kind": "route_flavor_detected", "file_path": route.path, "name": route.flavor,
            "start_line": 1, "end_line": 8
        }));
        facts.push(json!({
            "kind": "import_used", "file_path": route.path, "name": route.symbol,
            "value": route.module, "imported_name": route.symbol, "start_line": 1, "end_line": 1
        }));
        facts.push(json!({
            "kind": "symbol_called", "file_path": route.path, "name": route.symbol,
            "start_line": 3, "end_line": 8
        }));
        facts.push(json!({
            "kind": "route_returns_response", "file_path": route.path, "name": "POST",
            "start_line": 5, "end_line": 6
        }));
    }
    json!({
        "repo": { "repo_id": "repo_cv2" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": { "scan_id": "scan_cv2", "file_snapshots": snapshots, "facts": facts }
    })
}

fn infer(request: Value) -> Value {
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("infer-candidates")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("spawn drift-engine");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(request.to_string().as_bytes())
        .expect("write request");
    let output = child.wait_with_output().expect("wait output");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("json output")
}

const AUTH: &str = "api_route_requires_auth_helper";

/// Families of one kind that name more than one required call, with their flavour condition.
fn families(payload: &Value, kind: &str) -> Vec<(Vec<String>, Option<String>, f64)> {
    payload["candidates"]
        .as_array()
        .expect("candidates")
        .iter()
        .filter(|candidate| candidate["kind"] == kind)
        .filter(|candidate| {
            candidate["matcher"]["required_calls"]
                .as_array()
                .is_some_and(|calls| calls.len() > 1)
        })
        .map(|candidate| {
            let calls = candidate["matcher"]["required_calls"]
                .as_array()
                .expect("calls")
                .iter()
                .map(|call| call.as_str().expect("str").to_string())
                .collect::<Vec<_>>();
            let flavor = candidate["matcher"]
                .get("applies_to_route_flavors")
                .and_then(|value| value.as_array())
                .and_then(|values| values.first())
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned);
            let coverage = candidate["scoring"]["coverage_ratio"]
                .as_f64()
                .expect("coverage");
            (calls, flavor, coverage)
        })
        .collect()
}

#[test]
fn a_repo_with_no_flavour_signal_yields_one_unconditioned_family() {
    // CV-2's red #2, and the control that keeps every existing repo unchanged: with only app routes,
    // the family must carry NO flavour condition at all. Emitting `["api_route"]` here would change the
    // matcher fingerprint - and so the candidate id - of every family on every repo that has no cron
    // routes, churning accepted contracts for nothing.
    let payload = infer(request_from_routes(&[
        Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/c/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/d/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
    ]));

    let found = families(&payload, AUTH);
    assert_eq!(found.len(), 1, "one family: {found:?}");
    assert_eq!(found[0].0, vec!["withSession", "withWorkspace"]);
    assert_eq!(
        found[0].1, None,
        "an unflavoured repo must produce an unconditioned family, not one scoped to api_route"
    );
}

#[test]
fn a_cron_route_is_not_in_scope_for_the_session_family() {
    // CV-2's DoD. Session wrappers cover the app routes; a signature helper covers the cron routes.
    // The session family must be conditioned to app routes, or - accepted in block mode - it flags
    // every cron route for missing a wrapper it was never meant to use.
    let payload = infer(request_from_routes(&[
        Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/c/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/d/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/cron/e/route.ts", symbol: "verifyQstashSignature", module: "@/lib/cron", flavor: "cron_job" },
        Route { path: "app/api/cron/f/route.ts", symbol: "verifyQstashSignature", module: "@/lib/cron", flavor: "cron_job" },
    ]));

    let session = families(&payload, AUTH)
        .into_iter()
        .find(|(calls, _, _)| calls.contains(&"withSession".to_string()))
        .expect("a session family");
    assert_eq!(
        session.1.as_deref(),
        Some("api_route"),
        "the session family must be conditioned to app routes: {session:?}"
    );
    assert!(
        !session.0.contains(&"verifyQstashSignature".to_string()),
        "a signature helper is not a member of the session family: {:?}",
        session.0
    );
}

#[test]
fn each_flavour_is_scored_against_its_own_denominator() {
    // The reason conditioning exists. Two app routes and four cron routes: the session family covers
    // 2 of 2 app routes, not 2 of 6 files. Scored globally it would read 0.33 and look far weaker than
    // the convention actually is.
    let payload = infer(request_from_routes(&[
        Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/cron/c/route.ts", symbol: "verifyQstashSignature", module: "@/lib/cron", flavor: "cron_job" },
        Route { path: "app/api/cron/d/route.ts", symbol: "verifyQstashSignature", module: "@/lib/cron", flavor: "cron_job" },
        Route { path: "app/api/cron/e/route.ts", symbol: "verifyHmacSignature", module: "@/lib/cron", flavor: "cron_job" },
        Route { path: "app/api/cron/f/route.ts", symbol: "verifyHmacSignature", module: "@/lib/cron", flavor: "cron_job" },
    ]));

    let cron = families(&payload, AUTH)
        .into_iter()
        .find(|(_, flavor, _)| flavor.as_deref() == Some("cron_job"))
        .expect("a cron family");
    // 4 cron files covered out of 4 cron files in scope, not 4 out of 6.
    assert!(
        (cron.2 - 1.0).abs() < 1e-9,
        "cron coverage is measured against cron routes only: {cron:?}"
    );
}

#[test]
fn a_flavour_with_no_members_of_its_own_yields_no_family() {
    // Conditioning must not invent an empty family for a flavour the repo has but has no convention
    // for. Two cron routes with no shared helper produce no cron family - not one with zero members.
    let payload = infer(request_from_routes(&[
        Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/c/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/d/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/cron/e/route.ts", symbol: "runRollup", module: "@/lib/jobs", flavor: "cron_job" },
        Route { path: "app/api/cron/f/route.ts", symbol: "runDigest", module: "@/lib/jobs", flavor: "cron_job" },
    ]));

    let found = families(&payload, AUTH);
    assert!(
        found.iter().all(|(_, flavor, _)| flavor.as_deref() != Some("cron_job")),
        "no cron family should exist - neither cron helper repeats across two files: {found:?}"
    );
}

#[test]
fn a_helper_used_in_two_flavours_belongs_to_both_families() {
    // Assignment follows the evidence. A wrapper genuinely used on app and cron routes is a member of
    // each family, and pretending otherwise would understate one of them.
    let payload = infer(request_from_routes(&[
        Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/c/route.ts", symbol: "withAudit", module: "@/lib/auth", flavor: "api_route" },
        Route { path: "app/api/cron/d/route.ts", symbol: "withAudit", module: "@/lib/auth", flavor: "cron_job" },
        Route { path: "app/api/cron/e/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "cron_job" },
        Route { path: "app/api/cron/f/route.ts", symbol: "withAudit", module: "@/lib/auth", flavor: "cron_job" },
    ]));

    let found = families(&payload, AUTH);
    let cron = found
        .iter()
        .find(|(_, flavor, _)| flavor.as_deref() == Some("cron_job"))
        .expect("a cron family");
    assert!(
        cron.0.contains(&"withAudit".to_string()) && cron.0.contains(&"withSession".to_string()),
        "both helpers are evidenced on cron routes: {cron:?}"
    );
}

#[test]
fn family_candidate_ids_stay_stable_across_runs_when_conditioned() {
    let build = || {
        request_from_routes(&[
            Route { path: "app/api/a/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
            Route { path: "app/api/b/route.ts", symbol: "withSession", module: "@/lib/auth", flavor: "api_route" },
            Route { path: "app/api/c/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
            Route { path: "app/api/d/route.ts", symbol: "withWorkspace", module: "@/lib/auth", flavor: "api_route" },
            Route { path: "app/api/cron/e/route.ts", symbol: "verifyHmacSignature", module: "@/lib/cron", flavor: "cron_job" },
            Route { path: "app/api/cron/f/route.ts", symbol: "verifyHmacSignature", module: "@/lib/cron", flavor: "cron_job" },
            Route { path: "app/api/cron/g/route.ts", symbol: "verifyWebhookSignature", module: "@/lib/cron", flavor: "cron_job" },
            Route { path: "app/api/cron/h/route.ts", symbol: "verifyWebhookSignature", module: "@/lib/cron", flavor: "cron_job" },
        ])
    };
    let ids = |payload: &Value| {
        payload["candidates"]
            .as_array()
            .expect("candidates")
            .iter()
            .filter(|candidate| candidate["kind"] == AUTH)
            .map(|candidate| candidate["candidate_id"].as_str().unwrap_or("").to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&infer(build())), ids(&infer(build())));
}
