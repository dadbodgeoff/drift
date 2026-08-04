//! CV-1: family aggregation in the candidate deriver.
//!
//! **The problem, measured.** dub uses a member of its auth-wrapper family on 341 of 488 routes
//! (70%), but inference emitted one candidate per helper symbol, so the strongest single shard
//! (`withSession`, 20 files) covered 3.9% of routes - under the 0.2 noise floor that hides
//! low-confidence candidates. The repo's strongest real convention was never even hypothesised,
//! while the enforcement handler for its kind sat reachable and unfed.
//!
//! **The negative controls come first, and they are the point of this file.** An over-aggregating
//! family learner is strictly worse than the fragmentation it replaces, because it gets accepted
//! and then blocks. The three shapes that must never merge are written before anything that
//! measures recall:
//!
//!   1. two unrelated helpers from two modules do not merge
//!   2. a name-lookalike from a foreign module does not join
//!   3. a single helper produces no family at all, so already-passing repos are unchanged
//!
//! Only then does recall get asserted, and determinism after it.

use std::{
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

/// A route file plus the helper it calls and the module that helper resolves to.
struct Route<'a> {
    path: &'a str,
    symbol: &'a str,
    module: &'a str,
    /// Whether the call encloses the handler's work, which is what distinguishes a route wrapper
    /// from a utility the handler happens to call.
    ///
    /// `withSession(async (req) => { return Response.json(...) })` encloses its handler, so the
    /// route's response fact falls inside the call's span. `hashPassword(pw)` is a point call and
    /// encloses nothing. Measured on dub, this is the only thing that separates the real wrapper
    /// family from the crypto utilities that live in the same module.
    wraps: bool,
}

/// A wrapper call, spanning the handler it encloses.
fn wrapper<'a>(path: &'a str, symbol: &'a str, module: &'a str) -> Route<'a> {
    Route { path, symbol, module, wraps: true }
}

/// A point call inside a handler - an ordinary utility, not a wrapper.
fn point_call<'a>(path: &'a str, symbol: &'a str, module: &'a str) -> Route<'a> {
    Route { path, symbol, module, wraps: false }
}

/// Builds an `infer-candidates` request from a list of routes, each contributing the three facts a
/// real scan produces for a wrapped route: the role, the import, and the call.
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
            "kind": "file_role_detected",
            "file_path": route.path,
            "name": "api_route",
            "start_line": 1,
            "end_line": 8
        }));
        facts.push(json!({
            "kind": "import_used",
            "file_path": route.path,
            "name": route.symbol,
            "value": route.module,
            "imported_name": route.symbol,
            "start_line": 1,
            "end_line": 1
        }));
        // A wrapper's call spans lines 3-8 and the handler's response sits at line 5, inside it. A
        // point call occupies line 3 alone, and the response sits outside it at line 5.
        facts.push(json!({
            "kind": "symbol_called",
            "file_path": route.path,
            "name": route.symbol,
            "start_line": 3,
            "end_line": if route.wraps { 8 } else { 3 }
        }));
        facts.push(json!({
            "kind": "route_returns_response",
            "file_path": route.path,
            "name": "GET",
            "start_line": 5,
            "end_line": 6
        }));
    }
    json!({
        "repo": { "repo_id": "repo_cv1" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_cv1",
            "file_snapshots": snapshots,
            "facts": facts
        }
    })
}

fn run_infer_candidates(request: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("infer-candidates")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
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

fn candidates_of_kind<'a>(payload: &'a Value, kind: &str) -> Vec<&'a Value> {
    payload["candidates"]
        .as_array()
        .expect("candidates")
        .iter()
        .filter(|candidate| candidate["kind"] == kind)
        .collect()
}

/// A family candidate is the one whose matcher names more than one required call. The per-symbol
/// candidates it supersedes each name exactly one.
fn family_candidate<'a>(payload: &'a Value, kind: &str) -> Option<&'a Value> {
    candidates_of_kind(payload, kind).into_iter().find(|candidate| {
        candidate["matcher"]["required_calls"]
            .as_array()
            .is_some_and(|calls| calls.len() > 1)
    })
}

fn required_calls(candidate: &Value) -> Vec<&str> {
    candidate["matcher"]["required_calls"]
        .as_array()
        .expect("required_calls")
        .iter()
        .map(|call| call.as_str().expect("call is a string"))
        .collect()
}

const AUTH: &str = "api_route_requires_auth_helper";

// ---------------------------------------------------------------------------------------------
// Negative control 1: two unrelated helpers do not merge.
// ---------------------------------------------------------------------------------------------

#[test]
fn unrelated_helpers_from_different_modules_do_not_merge() {
    // `withSession` is auth (it resolves under lib/auth and its name nominates). `withCache`
    // resolves under lib/cache and its name nominates nothing. Sharing the `lib` container is not
    // sharing a family - if it were, every `lib/*` helper in a repo would be one convention.
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withCache", "@/lib/cache"),
        wrapper("app/api/d/route.ts", "withCache", "@/lib/cache"),
    ]));

    for candidate in candidates_of_kind(&payload, AUTH) {
        assert!(
            !required_calls(candidate).contains(&"withCache"),
            "withCache resolves to lib/cache and must appear in no auth candidate: {candidate:#?}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Negative control 2: a lookalike from a foreign module is excluded. This is F4's ghost -
// substring matching nominated `isPrismaObj` once already.
// ---------------------------------------------------------------------------------------------

#[test]
fn name_lookalike_from_a_foreign_module_does_not_join_the_family() {
    // `withAuthorHat` contains "auth" and starts with "with", so the name predicate nominates it.
    // It resolves under lib/blog, and the auth cluster covers more files, so it joins nothing.
    // Name similarity nominates; resolved-module identity confirms.
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/e/route.ts", "withAuthorHat", "@/lib/blog/hats"),
        wrapper("app/api/f/route.ts", "withAuthorHat", "@/lib/blog/hats"),
    ]));

    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    let calls = required_calls(family);
    assert!(
        !calls.contains(&"withAuthorHat"),
        "withAuthorHat resolves to lib/blog and must not join the auth family: {calls:?}"
    );
    assert!(
        calls.contains(&"withSession") && calls.contains(&"withWorkspace"),
        "the two lib/auth helpers are the family: {calls:?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Negative control 3: one helper produces no family, so nothing changes for repos that already
// pass. This is the control that keeps taxonomy's candidate set byte-for-byte identical.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_single_helper_produces_no_family_candidate() {
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
    ]));

    assert!(
        family_candidate(&payload, AUTH).is_none(),
        "one helper is already its own family; a second candidate would duplicate its matcher \
         and therefore its id: {payload:#?}"
    );
    let per_symbol = candidates_of_kind(&payload, AUTH);
    assert_eq!(per_symbol.len(), 1, "exactly the candidate today emits: {per_symbol:#?}");
    assert!(
        per_symbol[0].get("superseded_by").is_none(),
        "with no family there is nothing to supersede, and the field must be absent rather than \
         null so the payload is unchanged byte-for-byte: {:#?}",
        per_symbol[0]
    );
}

#[test]
fn a_symbol_with_no_resolvable_import_does_not_join() {
    // Module identity is what confirms membership, so a helper with no resolvable module has
    // nothing to confirm it. A locally defined `withSession` is not the shared helper.
    let mut request = request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withTeam", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withTeam", "@/lib/auth"),
    ]);
    // Drop both `import_used` facts for a third helper, leaving only its calls.
    let facts = request["scan"]["facts"].as_array_mut().expect("facts");
    for path in ["app/api/e/route.ts", "app/api/f/route.ts"] {
        facts.push(json!({
            "kind": "file_role_detected", "file_path": path, "name": "api_route",
            "start_line": 1, "end_line": 8
        }));
        facts.push(json!({
            "kind": "symbol_called", "file_path": path, "name": "withLocalSession",
            "start_line": 3, "end_line": 8
        }));
    }

    let payload = run_infer_candidates(request);
    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    assert!(
        !required_calls(family).contains(&"withLocalSession"),
        "an unresolvable symbol has no module to confirm it: {:?}",
        required_calls(family)
    );
}

// ---------------------------------------------------------------------------------------------
// Recall - only now that the controls are pinned.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_dub_shaped_repo_yields_one_family_with_union_coverage() {
    // dub's shape: one name-nominated seed (`withSession`) and four wrappers that nominate nothing
    // but come from the same module. Per-symbol, the best shard covers 2 of 10 files (0.2). As a
    // family it covers all 10.
    //
    // `withWorkspace` joining here is not a rehabilitation of the hardcoded name that was removed
    // from `is_auth_candidate_symbol` - it joins because it resolves where `withSession` resolves,
    // which is a fact about the repo rather than a string in the engine.
    let mut routes = Vec::new();
    for (index, symbol) in ["withSession", "withWorkspace", "withAdmin", "withTeam", "withPartner"]
        .into_iter()
        .enumerate()
    {
        for suffix in ["a", "b"] {
            routes.push(wrapper(
                Box::leak(format!("app/api/r{index}{suffix}/route.ts").into_boxed_str()),
                symbol,
                "@/lib/auth",
            ));
        }
    }
    let payload = run_infer_candidates(request_from_routes(&routes));

    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    let calls = required_calls(family);
    assert_eq!(calls.len(), 5, "every same-module wrapper is a member: {calls:?}");
    assert_eq!(
        calls,
        vec!["withAdmin", "withPartner", "withSession", "withTeam", "withWorkspace"],
        "members are sorted, so the matcher fingerprint and candidate id are stable"
    );

    // Union coverage: 10 of 10 route files, where the best single shard was 2.
    let coverage = family["scoring"]["coverage_ratio"].as_f64().expect("coverage_ratio");
    assert!(
        coverage > 0.99,
        "coverage is the union of files satisfied by any member, not one member's share: {coverage}"
    );

    // Per-member evidence, so `conventions show` can answer "why is withWorkspace in this family".
    let helpers = family["requires"]["auth_helpers"].as_array().expect("auth_helpers");
    assert_eq!(helpers.len(), 5);
    let workspace = helpers
        .iter()
        .find(|helper| helper["symbol"] == "withWorkspace")
        .expect("withWorkspace is recorded as a member");
    assert_eq!(workspace["evidence_file_count"], 2);
    assert_eq!(
        workspace["joined_by"], "module",
        "withWorkspace joined on module identity, and saying so is how a reviewer audits the merge"
    );
    let session = helpers
        .iter()
        .find(|helper| helper["symbol"] == "withSession")
        .expect("withSession is recorded as a member");
    assert_eq!(
        session["joined_by"], "name_and_module",
        "withSession is the nominated seed that established the module"
    );
}

#[test]
fn per_symbol_candidates_survive_but_are_marked_superseded() {
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
    ]));

    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    let family_id = family["candidate_id"].as_str().expect("candidate_id");

    let per_symbol = candidates_of_kind(&payload, AUTH)
        .into_iter()
        .filter(|candidate| required_calls(candidate).len() == 1)
        .collect::<Vec<_>>();
    assert_eq!(
        per_symbol.len(),
        1,
        "the per-symbol candidate carrying the seed's own evidence is still there: {per_symbol:#?}"
    );
    for candidate in per_symbol {
        assert_eq!(
            candidate["superseded_by"], family_id,
            "a reviewer must not accept a fragment of a convention the family now speaks for"
        );
    }
    assert!(
        family.get("superseded_by").is_none(),
        "the family supersedes nothing"
    );
}

#[test]
fn family_candidate_id_is_stable_across_runs() {
    let build = || {
        request_from_routes(&[
            wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
            wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
            wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
            wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
        ])
    };
    let first = run_infer_candidates(build());
    let second = run_infer_candidates(build());

    let left = family_candidate(&first, AUTH).expect("family");
    let right = family_candidate(&second, AUTH).expect("family");
    assert_eq!(left["candidate_id"], right["candidate_id"]);
    assert_eq!(left["matcher_fingerprint"], right["matcher_fingerprint"]);
}

#[test]
fn member_order_in_the_facts_does_not_change_the_family_id() {
    // The same repo, described with the routes in the opposite order. A candidate id that moved
    // here would churn every accepted contract on a re-scan.
    let forward = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
    ]));
    let reversed = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
    ]));

    assert_eq!(
        family_candidate(&forward, AUTH).expect("family")["candidate_id"],
        family_candidate(&reversed, AUTH).expect("family")["candidate_id"]
    );
}

// ---------------------------------------------------------------------------------------------
// The same mechanism, the other two kinds.
// ---------------------------------------------------------------------------------------------

#[test]
fn rate_limit_helpers_from_one_module_aggregate_into_a_family() {
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "ratelimit", "@upstash/ratelimit"),
        wrapper("app/api/b/route.ts", "ratelimit", "@upstash/ratelimit"),
        wrapper("app/api/c/route.ts", "throttleRequest", "@upstash/ratelimit"),
        wrapper("app/api/d/route.ts", "throttleRequest", "@upstash/ratelimit"),
    ]));

    let family =
        family_candidate(&payload, "api_route_requires_rate_limit").expect("a rate-limit family");
    assert_eq!(required_calls(&family.clone()), vec!["ratelimit", "throttleRequest"]);
    // Rate limit's per-symbol candidate keys its helper module under `module`, not `import`, and a
    // family that used the other key would hand the check path helpers it cannot read.
    let helpers = family["requires"]["rate_limit_helpers"]
        .as_array()
        .expect("rate_limit_helpers");
    assert_eq!(helpers[0]["module"], "@upstash/ratelimit");
}

#[test]
fn a_scoped_package_keys_on_the_package_not_the_scope() {
    // `@upstash/ratelimit` and `@upstash/redis` are different families: an npm scope is a namespace,
    // not a module family. Asserted through auth, which is the kind that clusters on module.
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@acme/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@acme/auth"),
        wrapper("app/api/c/route.ts", "withBilling", "@acme/billing"),
        wrapper("app/api/d/route.ts", "withBilling", "@acme/billing"),
    ]));

    for candidate in candidates_of_kind(&payload, AUTH) {
        let calls = required_calls(candidate);
        assert!(
            !calls.contains(&"withBilling"),
            "two packages under one scope are two families: {calls:?}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Negative control 4, and the one real dub taught. Module identity is NOT sufficient: a module
// exports heterogeneous symbols, and recruiting on the module alone put `hashPassword`, `hashToken`
// and `validatePassword` into dub's auth family beside its real wrappers. An accepted family like
// that would count a route calling `hashPassword` as authenticated.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_utility_from_the_familys_own_module_does_not_join() {
    // The exact shape measured on dub: `@/lib/auth` exports the wrappers AND the crypto helpers.
    // The wrappers enclose their handlers; `hashPassword` is a point call inside one. Only the
    // wrappers are the convention.
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
        point_call("app/api/e/route.ts", "hashPassword", "@/lib/auth"),
        point_call("app/api/f/route.ts", "hashPassword", "@/lib/auth"),
    ]));

    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    let calls = required_calls(family);
    assert!(
        !calls.contains(&"hashPassword"),
        "a same-module utility called inside a handler is not a wrapper, and counting it would let \
         a route that only hashes a password read as authenticated: {calls:?}"
    );
    assert_eq!(
        calls,
        vec!["withSession", "withWorkspace"],
        "the family is exactly the helpers that enclose their handlers"
    );
}

#[test]
fn a_name_nominated_symbol_that_never_wraps_does_not_seed_a_family() {
    // dub's `getSession` name-nominates (it contains "session") and is called 32 times - always as a
    // point call. It must not drag a family into existence on its own.
    let payload = run_infer_candidates(request_from_routes(&[
        point_call("app/api/a/route.ts", "getSession", "@/lib/auth"),
        point_call("app/api/b/route.ts", "getSession", "@/lib/auth"),
        point_call("app/api/c/route.ts", "hashToken", "@/lib/auth"),
        point_call("app/api/d/route.ts", "hashToken", "@/lib/auth"),
    ]));

    assert!(
        family_candidate(&payload, AUTH).is_none(),
        "no symbol here wraps a handler, so there is no wrapper family to state: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Regression tests for the defects independent verification found in the first CV-1 commit.
// Each of these was a CONFIRMED defect that the 12 tests above did not catch.
// ---------------------------------------------------------------------------------------------

/// The `nominated` filter on `AlreadyDetected` kinds had no test at all: deleting it left 12 of 12
/// green while turning dub's 2-member rate-limit family into a 249-member one holding `capitalize`,
/// `nanoid` and `uuid`. The comment called it "load-bearing, not a formality" and nothing checked.
#[test]
fn an_unnominated_symbol_never_joins_an_already_detected_family() {
    let payload = run_infer_candidates(request_from_routes(&[
        point_call("app/api/a/route.ts", "ratelimit", "@/lib/upstash"),
        point_call("app/api/b/route.ts", "ratelimit", "@/lib/upstash"),
        point_call("app/api/c/route.ts", "ratelimitOrThrow", "@/lib/upstash"),
        point_call("app/api/d/route.ts", "ratelimitOrThrow", "@/lib/upstash"),
        // Called in routes, resolves to the same module, nominates nothing. Every symbol a repo
        // calls in a route reaches this point, so only nomination keeps them out.
        point_call("app/api/e/route.ts", "capitalize", "@/lib/upstash"),
        point_call("app/api/f/route.ts", "capitalize", "@/lib/upstash"),
        point_call("app/api/g/route.ts", "nanoid", "@/lib/upstash"),
        point_call("app/api/h/route.ts", "nanoid", "@/lib/upstash"),
    ]));

    let family = family_candidate(&payload, "api_route_requires_rate_limit")
        .expect("a rate-limit family exists");
    assert_eq!(
        required_calls(family),
        vec!["ratelimit", "ratelimitOrThrow"],
        "membership of an already-detected family is exactly the positively detected symbols"
    );
}

/// An `api_route_requires_auth_helper` family could contain zero auth helpers: a nominated point
/// call established the module key, then non-nominated wrappers from a neighbouring module filled
/// the family alone. `withErrorHandler` and `withLogging` read as auth because a `getSession` call
/// next door voted for their package.
#[test]
fn a_family_cannot_be_seeded_by_a_symbol_that_is_not_itself_a_member() {
    let payload = run_infer_candidates(request_from_routes(&[
        // All from ONE module, so the module rule cannot be what saves this - only the requirement
        // that a family's seed be a member of it can. `getSession` is nominated (it contains
        // "session") but is a point call, so it is not a wrapper and not a member; the two wrappers
        // beside it nominate nothing.
        point_call("app/api/a/route.ts", "getSession", "@/lib/auth"),
        point_call("app/api/b/route.ts", "getSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withErrorHandler", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withErrorHandler", "@/lib/auth"),
        wrapper("app/api/e/route.ts", "withLogging", "@/lib/auth"),
        wrapper("app/api/f/route.ts", "withLogging", "@/lib/auth"),
    ]));

    for candidate in candidates_of_kind(&payload, AUTH) {
        let calls = required_calls(candidate);
        assert!(
            !calls.contains(&"withErrorHandler") && !calls.contains(&"withLogging"),
            "an error handler and a logger are not auth helpers, and a nominated point call in \
             their module must not make them one: {calls:?}"
        );
    }
}

/// Keying a module family on its first non-generic segment collapsed whole monorepo packages:
/// `packages/api/src/auth` and `packages/api/src/middleware` both keyed on `api`.
#[test]
fn sibling_directories_in_one_package_are_not_one_family() {
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "packages/api/src/auth"),
        wrapper("app/api/b/route.ts", "withSession", "packages/api/src/auth"),
        wrapper("app/api/c/route.ts", "withErrorHandler", "packages/api/src/middleware"),
        wrapper("app/api/d/route.ts", "withErrorHandler", "packages/api/src/middleware"),
    ]));

    for candidate in candidates_of_kind(&payload, AUTH) {
        assert!(
            !required_calls(candidate).contains(&"withErrorHandler"),
            "`api/auth` and `api/middleware` share a package, not a family: {:?}",
            required_calls(candidate)
        );
    }
}

/// A module and its own submodule ARE one family - the prefix rule that makes the test above safe
/// must not also split `@/lib/auth` from `@/lib/auth/session`.
#[test]
fn a_module_and_its_submodule_are_one_family() {
    let payload = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth/workspace"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth/workspace"),
    ]));

    let family = family_candidate(&payload, AUTH).expect("an auth family exists");
    assert_eq!(required_calls(family), vec!["withSession", "withWorkspace"]);
}

/// Family formation depended on which occurrence of a symbol the scan visited first: a helper
/// imported from two different specifiers produced a family in one fact order and none in the
/// reverse.
#[test]
fn a_symbol_imported_from_two_modules_forms_the_same_family_either_way() {
    let build = |reversed: bool| {
        let mut routes = vec![
            wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
            wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
            wrapper("app/api/c/route.ts", "withPartner", "@/lib/auth/partner"),
            wrapper("app/api/d/route.ts", "withPartner", "@/lib/auth/partner"),
            // The same symbol, once, through a foreign specifier. The majority must win.
            wrapper("app/api/e/route.ts", "withPartner", "@/lib/billing/partner"),
        ];
        if reversed {
            routes.reverse();
        }
        request_from_routes(&routes)
    };

    let forward = run_infer_candidates(build(false));
    let reversed = run_infer_candidates(build(true));

    let left = family_candidate(&forward, AUTH).expect("a family in forward order");
    let right = family_candidate(&reversed, AUTH).expect("a family in reversed order");
    assert_eq!(required_calls(left), required_calls(right));
    assert_eq!(left["candidate_id"], right["candidate_id"]);
}

/// The helper id field name has to be the one the READER for that kind expects.
/// `security_helpers_from_requires` takes `helper_id` with `?` inside a `filter_map`, so a family
/// that emitted `rate_limit_id` carried no helpers at all - and an accepted convention with no
/// helpers flags every route in scope, including the routes that call a member. Strictly worse than
/// the per-symbol candidate it supersedes.
#[test]
fn family_helper_entries_use_the_field_name_their_reader_expects() {
    let auth = run_infer_candidates(request_from_routes(&[
        wrapper("app/api/a/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/b/route.ts", "withSession", "@/lib/auth"),
        wrapper("app/api/c/route.ts", "withWorkspace", "@/lib/auth"),
        wrapper("app/api/d/route.ts", "withWorkspace", "@/lib/auth"),
    ]));
    let helpers = family_candidate(&auth, AUTH).expect("auth family")["requires"]["auth_helpers"]
        .as_array()
        .expect("auth_helpers")
        .clone();
    for helper in &helpers {
        assert!(
            helper.get("guard_id").and_then(|id| id.as_str()).is_some(),
            "accepted_auth_helpers_for_convention reads `guard_id`: {helper:#?}"
        );
    }

    let rate_limit = run_infer_candidates(request_from_routes(&[
        point_call("app/api/a/route.ts", "ratelimit", "@/lib/upstash"),
        point_call("app/api/b/route.ts", "ratelimit", "@/lib/upstash"),
        point_call("app/api/c/route.ts", "ratelimitOrThrow", "@/lib/upstash"),
        point_call("app/api/d/route.ts", "ratelimitOrThrow", "@/lib/upstash"),
    ]));
    let helpers = family_candidate(&rate_limit, "api_route_requires_rate_limit")
        .expect("rate-limit family")["requires"]["rate_limit_helpers"]
        .as_array()
        .expect("rate_limit_helpers")
        .clone();
    for helper in &helpers {
        // Both are taken with `?`, so either one missing drops the helper silently.
        assert!(
            helper.get("helper_id").and_then(|id| id.as_str()).is_some(),
            "security_helpers_from_requires reads `helper_id`: {helper:#?}"
        );
        assert!(
            helper.get("module").and_then(|id| id.as_str()).is_some(),
            "security_helpers_from_requires reads `module` with `?` too: {helper:#?}"
        );
    }
}
