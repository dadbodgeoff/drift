//! CV-3 (option B): presence-only enforcement, beside the guard-dominance proof rather than replacing
//! it.
//!
//! **Why this tier exists.** All three kinds CV-3 wanted to promote are enforced by control-flow
//! proofs - `api_route_requires_auth_helper` declares the capability `control_flow_guard_dominance`
//! and its finding reads "Accepted auth helper must dominate protected route sinks". CV-3's own
//! promotion standard excludes control-flow claims, so promoting those unchanged would have surfaced
//! the quarantined tier as a default-visible blocking convention. Option B adds a second, honestly
//! weaker semantics that CAN be promoted: the route calls an accepted member, or it does not.
//!
//! **The three binding conditions this file enforces:**
//!   1. findings claim presence, never protection - no "unprotected", no "missing auth";
//!   2. the non-catch is PINNED, not implied: a wrapper called with a sink outside it passes, and the
//!      test that asserts that silence names the quarantined tier that would catch it;
//!   3. the existing proof path is untouched - a convention without the presence marker still gets
//!      guard dominance.

use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

const PRESENCE_KIND: &str = "api_route_requires_auth_helper";

fn fact(
    kind: &str,
    name: &str,
    start: usize,
    end: usize,
    value: Option<&str>,
    imported: Option<&str>,
) -> Value {
    let mut out = json!({
        "kind": kind,
        "file_path": "app/api/things/route.ts",
        "name": name,
        "start_line": start,
        "end_line": end
    });
    if let Some(value) = value {
        out["value"] = json!(value);
    }
    if let Some(imported) = imported {
        out["imported_name"] = json!(imported);
    }
    out
}

/// A presence-mode family convention over two interchangeable wrappers.
fn presence_convention() -> Value {
    json!({
        "id": "family_auth_presence",
        "kind": PRESENCE_KIND,
        "matcher": {
            "required_calls": ["withSession", "withWorkspace"],
            "applies_to_file_roles": ["api_route"],
            "enforcement_semantics": "presence"
        },
        "requires": {
            "auth_helpers": [
                { "guard_id": "auth:withSession", "symbol": "withSession", "import": "@/lib/auth" },
                { "guard_id": "auth:withWorkspace", "symbol": "withWorkspace", "import": "@/lib/auth" }
            ]
        },
        "severity": "warning",
        "enforcement_mode": "warn",
        "enforcement_capability": "deterministic_check"
    })
}

fn run(repo_root: &std::path::Path, facts: Vec<Value>, convention: Value) -> Value {
    run_check_repo(json!({
        "repo": { "repo_id": "repo_cv3", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_cv3", "facts": facts },
        "contract": {
            "contract_id": "contract_cv3",
            "contract_schema_version": 1,
            "conventions": [convention]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }))
}

fn write_route(lines: &[&str]) -> std::path::PathBuf {
    let repo_root = temp_repo();
    let route = repo_root.join("app/api/things/route.ts");
    fs::create_dir_all(route.parent().expect("parent")).expect("mkdir");
    fs::write(&route, lines.join("\n")).expect("write route");
    repo_root
}

// ---------------------------------------------------------------------------------------------
// Negative controls first.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_route_calling_a_family_member_is_silent() {
    let repo_root = write_route(&[
        r#"import { withWorkspace } from "@/lib/auth";"#,
        "export const POST = withWorkspace(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact(
                "import_used",
                "withWorkspace",
                1,
                1,
                Some("@/lib/auth"),
                Some("withWorkspace"),
            ),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withWorkspace", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "calling any member satisfies a disjunction: {payload:#?}"
    );
}

#[test]
fn a_renamed_import_still_satisfies_presence() {
    // Resolution, not string matching. `import { withSession as w }` is the E-5 rename shape, and a
    // presence check that compared call names as strings would flag this route.
    let repo_root = write_route(&[
        r#"import { withSession as w } from "@/lib/auth";"#,
        "export const POST = w(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            // The local binding is `w`; what it resolves to is `withSession`.
            fact(
                "import_used",
                "w",
                1,
                1,
                Some("@/lib/auth"),
                Some("withSession"),
            ),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "w", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a renamed import resolves to an accepted symbol: {payload:#?}"
    );
}

#[test]
fn a_same_named_local_function_does_not_satisfy_presence() {
    // The other direction of the same rule: a locally defined `withSession` is not the shared helper
    // the family is about, and presence must not be satisfiable by naming a function conveniently.
    let repo_root = write_route(&[
        "const withSession = (handler: unknown) => handler;",
        "export const POST = withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            // No import_used fact: nothing resolves this call anywhere.
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withSession", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        1,
        "an unresolved local of the same name is not the accepted helper: {payload:#?}"
    );
}

#[test]
fn a_convention_with_no_accepted_helpers_produces_no_findings() {
    // The F3 shape that made the rate-limit family strictly worse than the candidate it superseded: a
    // convention carrying no helpers must refuse to judge, not flag every route in scope.
    let repo_root = write_route(&[
        "export async function POST() { return Response.json({ ok: true }); }",
        "",
    ]);
    let mut convention = presence_convention();
    convention["matcher"]["required_calls"] = json!([]);
    convention["requires"] = json!({});
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 1, None, None),
            fact("route_declared", "POST", 1, 1, None, None),
            fact(
                "route_returns_response",
                "json",
                1,
                1,
                Some("Response"),
                None,
            ),
        ],
        convention,
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "no helpers means nothing to look for: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Condition 1: the finding claims presence, never protection.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_finding_claims_presence_and_never_protection() {
    let repo_root = write_route(&[
        "export async function POST() { return Response.json({ ok: true }); }",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 1, None, None),
            fact("route_declared", "POST", 1, 1, None, None),
            fact(
                "route_returns_response",
                "json",
                1,
                1,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 1, "{payload:#?}");
    let title = findings[0]["title"].as_str().expect("title");
    let message = findings[0]["message"].as_str().expect("message");

    assert_eq!(title, "API route calls no accepted auth wrapper");
    assert!(
        message.contains("does not call any accepted auth wrapper"),
        "the message must state what was checked: {message}"
    );
    // The words this tier is not entitled to. "unprotected" and "missing auth" are protection claims,
    // and "dominate" belongs to the proof that is still quarantined.
    for forbidden in ["unprotected", "missing auth", "dominate", "protected route"] {
        assert!(
            !title.to_lowercase().contains(forbidden)
                && !message.to_lowercase().contains(forbidden),
            "presence-mode findings must not claim protection, found {forbidden:?} in \
             title={title:?} message={message:?}"
        );
    }
    // And it says out loud what it did not check, so a reader cannot mistake it for the proof.
    assert!(
        message.contains("does not check that it guards"),
        "the message must disclose the limit of the check: {message}"
    );
    assert_eq!(findings[0]["rule_id"], PRESENCE_KIND);
}

// ---------------------------------------------------------------------------------------------
// Condition 3: the documented non-catch, pinned rather than implied.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_guard_called_after_the_sink_is_a_documented_non_catch() {
    // PINNED DOCUMENTED NON-CATCH, at its true shape: ORDERING inside one handler.
    //
    // The handler reads from the database and THEN calls the wrapper. Presence is satisfied - the
    // handler does call an accepted member - and this tier is silent, which is correct for what it
    // claims. Ordering is precisely the thing presence cannot see.
    //
    // The tier that catches it is the guard-dominance proof: `build_auth_boundary_proof` in
    // security_proof.rs, via `guard_dominates_straight_line_sinks`, which is exactly a
    // does-the-guard-precede-the-sink question. It stays quarantined behind `--experimental-security`
    // per docs/architecture/security-heuristic-audit.md, because its valve for undecidable control
    // flow only matches Drift's own fixture strings.
    //
    // Asserted, not merely noted: if presence enforcement ever started reporting this, it would be
    // making a dominance claim it does not compute, and this test fails.
    //
    // NOTE this fixture changed shape once. It used to call the wrapper at MODULE level with the
    // handler below, and that shape is now CAUGHT - per-handler granularity attributes the call to no
    // handler, so the handler counts as unsatisfied. Narrowing what this tier misses is the reason the
    // fixture moved; see `only_the_unwrapped_handler_of_a_multi_handler_route_is_reported`.
    let repo_root = write_route(&[
        r#"import { withWorkspace } from "@/lib/auth";"#,
        r#"import { db } from "@/lib/db";"#,
        "export async function POST() {",
        "  const rows = await db.thing.findMany();",
        "  await withWorkspace();",
        "  return Response.json({ rows });",
        "}",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 7, None, None),
            fact(
                "import_used",
                "withWorkspace",
                1,
                1,
                Some("@/lib/auth"),
                Some("withWorkspace"),
            ),
            fact("import_used", "db", 2, 2, Some("@/lib/db"), Some("db")),
            fact("route_declared", "POST", 3, 7, None, None),
            // The sink runs first; the guard is called after it.
            fact(
                "data_operation_detected",
                "findMany",
                4,
                4,
                Some("db.thing"),
                Some("read:thing"),
            ),
            fact("symbol_called", "withWorkspace", 5, 5, None, None),
            fact(
                "route_returns_response",
                "json",
                6,
                6,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "presence is satisfied by the handler calling a member; whether it runs BEFORE the sink is \
         the quarantined dominance proof's question, and this tier must stay silent rather than \
         half-answer it: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Per-handler granularity. A `route.ts` exporting GET and POST is two independent HTTP endpoints,
// and judging the file as a whole let a half-wrapped file pass entirely.
// ---------------------------------------------------------------------------------------------

#[test]
fn only_the_unwrapped_handler_of_a_multi_handler_route_is_reported() {
    // The false negative independent verification found: GET wrapped, POST naked and writing to the
    // database, and the whole FILE passed. "Wrap the read, forget the write" is the most likely shape
    // in a half-finished migration, which makes it the worst thing for this tier to miss.
    let repo_root = write_route(&[
        r#"import { withSession } from "@/lib/auth";"#,
        r#"import { db } from "@/lib/db";"#,
        "export const GET = withSession(async () => Response.json({ ok: true }));",
        "export async function POST() {",
        "  const created = await db.thing.create({ data: {} });",
        "  return Response.json({ created });",
        "}",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 7, None, None),
            fact(
                "import_used",
                "withSession",
                1,
                1,
                Some("@/lib/auth"),
                Some("withSession"),
            ),
            fact("import_used", "db", 2, 2, Some("@/lib/db"), Some("db")),
            fact("route_declared", "GET", 3, 3, None, None),
            fact("symbol_called", "withSession", 3, 3, None, None),
            fact("route_declared", "POST", 4, 7, None, None),
            fact(
                "data_operation_detected",
                "create",
                5,
                5,
                Some("db.thing"),
                Some("write:thing"),
            ),
            fact(
                "route_returns_response",
                "json",
                6,
                6,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(
        findings.len(),
        1,
        "exactly the unguarded handler: {payload:#?}"
    );
    assert!(
        findings[0]["message"]
            .as_str()
            .is_some_and(|message| message.contains("POST handler")),
        "the finding must name the handler, or a reader cannot tell which endpoint it is about: {:?}",
        findings[0]["message"]
    );
    // And it points at the handler rather than line 1, so the reader lands on the right endpoint.
    assert_eq!(findings[0]["evidence"][0]["start_line"], 4);
}

#[test]
fn two_unwrapped_handlers_are_two_findings() {
    // One finding standing for two unguarded endpoints would understate the work, and would make the
    // count meaningless as a migration measure.
    let repo_root = write_route(&[
        "export async function GET() { return Response.json({ ok: true }); }",
        "export async function POST() { return Response.json({ ok: true }); }",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 2, None, None),
            fact("route_declared", "GET", 1, 1, None, None),
            fact("route_declared", "POST", 2, 2, None, None),
            fact(
                "route_returns_response",
                "json",
                1,
                1,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(payload["findings"].as_array().expect("findings").len(), 2);
}

#[test]
fn a_wrapper_enclosing_its_handler_satisfies_that_handler() {
    // The other nesting direction, which is the ordinary case: the call encloses the handler rather
    // than sitting inside it. Intersection has to accept both or every wrapped route regresses.
    let repo_root = write_route(&[
        r#"import { withSession } from "@/lib/auth";"#,
        "export const POST = withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact(
                "import_used",
                "withSession",
                1,
                1,
                Some("@/lib/auth"),
                Some("withSession"),
            ),
            fact("route_declared", "POST", 2, 4, None, None),
            // The call spans the whole handler.
            fact("symbol_called", "withSession", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(payload["findings"].as_array().expect("findings").len(), 0);
}

// ---------------------------------------------------------------------------------------------
// Namespace imports. Missing this shape reported a genuinely wrapped route as calling no wrapper -
// a false positive on a default-visible convention, which is worse than a missed detection.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_namespace_import_satisfies_presence() {
    // `import * as auth from "@/lib/auth"` then `auth.withSession(...)`. The scanner emits the call
    // with the property in `name` and the receiver in `value`, and binds the namespace with
    // `imported_name: "*"`. The same rule already lives in security_patterns.rs.
    let repo_root = write_route(&[
        r#"import * as auth from "@/lib/auth";"#,
        "export const POST = auth.withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact("import_used", "auth", 1, 1, Some("@/lib/auth"), Some("*")),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withSession", 2, 4, Some("auth"), None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a namespace-imported wrapper is still the accepted wrapper: {payload:#?}"
    );
}

#[test]
fn a_namespace_property_from_an_unimported_object_does_not_satisfy() {
    // The negative control for the shape above: `helpers.withSession(...)` where `helpers` is a local
    // object, not a namespace import, resolves to nothing.
    let repo_root = write_route(&[
        "const helpers = { withSession: (h: unknown) => h };",
        "export const POST = helpers.withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withSession", 2, 4, Some("helpers"), None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        1,
        "a local object is not a namespace import: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Condition 3, other half: the proof path is untouched.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_convention_without_the_presence_marker_still_gets_the_dominance_proof() {
    // Promotion is per candidate. The same kind, the same route, no `enforcement_semantics` - and the
    // guard-dominance path must answer exactly as it did before CV-3, proof object and all.
    let repo_root = write_route(&[
        r#"import { withWorkspace } from "@/lib/auth";"#,
        r#"import { db } from "@/lib/db";"#,
        "const guarded = withWorkspace(async () => Response.json({ ok: true }));",
        "export async function POST() {",
        "  const rows = await db.thing.findMany();",
        "  return Response.json({ rows });",
        "}",
        "",
    ]);
    let mut convention = presence_convention();
    convention["matcher"]
        .as_object_mut()
        .expect("matcher")
        .remove("enforcement_semantics");
    convention["id"] = json!("per_symbol_auth_proof");

    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 7, None, None),
            fact(
                "import_used",
                "withWorkspace",
                1,
                1,
                Some("@/lib/auth"),
                Some("withWorkspace"),
            ),
            fact("import_used", "db", 2, 2, Some("@/lib/db"), Some("db")),
            fact("symbol_called", "withWorkspace", 3, 3, None, None),
            fact("route_declared", "POST", 4, 7, None, None),
            fact(
                "data_operation_detected",
                "findMany",
                5,
                5,
                Some("db.thing"),
                Some("read:thing"),
            ),
            fact(
                "route_returns_response",
                "json",
                6,
                6,
                Some("Response"),
                None,
            ),
        ],
        convention,
    );

    // The undominated sink the presence tier is silent about is exactly what this tier reports.
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        1,
        "the dominance proof still catches the sink outside the wrapper: {payload:#?}"
    );
    assert!(
        payload["security_boundary_proofs"]
            .as_array()
            .is_some_and(|proofs| !proofs.is_empty()),
        "the proof path still emits its proof object: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// CV-2 interaction: a presence family scoped to a flavour ignores the others.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_flavour_scoped_presence_family_ignores_other_flavours() {
    // Geoffrey's condition 2 in its structural form: a session family must not flag a cron route. The
    // flavour is read from the fact the scan emitted, never re-derived from the path here.
    let repo_root = temp_repo();
    let route = repo_root.join("app/api/cron/rollup/route.ts");
    fs::create_dir_all(route.parent().expect("parent")).expect("mkdir");
    fs::write(
        &route,
        "export async function POST() { return Response.json({ ok: true }); }\n",
    )
    .expect("write");

    let mut convention = presence_convention();
    convention["matcher"]["applies_to_route_flavors"] = json!(["api_route"]);
    let cron_fact = |kind: &str, name: &str, start: usize, end: usize| {
        json!({
            "kind": kind,
            "file_path": "app/api/cron/rollup/route.ts",
            "name": name,
            "start_line": start,
            "end_line": end
        })
    };
    let payload = run(
        &repo_root,
        vec![
            cron_fact("file_role_detected", "api_route", 1, 1),
            cron_fact("route_flavor_detected", "cron_job", 1, 1),
            cron_fact("route_declared", "POST", 1, 1),
            cron_fact("route_returns_response", "json", 1, 1),
        ],
        convention,
    );

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a cron route is not in scope for a family conditioned to application routes: {payload:#?}"
    );
}

fn temp_repo() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "drift-cv3-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("create temp repo");
    dir
}

fn run_check_repo(request: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("check-repo")
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

// ---------------------------------------------------------------------------------------------
// CV-4: the evasion shapes the plan names for a required-wrapper matcher.
//
// Presence resolves a call to an ACCEPTED SYMBOL NAME via the file's imports. It does not compare
// module specifiers, which is what makes the barrel case below work - and what makes the
// unrelated-module case a disclosed non-catch rather than a bug. Both directions are pinned, because
// a reader who saw only the first would draw the wrong conclusion about how strong this tier is.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_wrapper_imported_through_a_barrel_satisfies_presence() {
    // CV-4 shape 2. `export { withSession } from "@/lib/auth"` in a barrel, then the route imports
    // from the barrel. Presence keys on the imported symbol, so the indirection is transparent - no
    // chain-following needed, which is why this costs nothing here.
    let repo_root = write_route(&[
        r#"import { withSession } from "@/lib";"#,
        "export const POST = withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            // The specifier is the barrel; the imported name is still the accepted symbol.
            fact(
                "import_used",
                "withSession",
                1,
                1,
                Some("@/lib"),
                Some("withSession"),
            ),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withSession", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a barrel re-export of an accepted wrapper still satisfies presence: {payload:#?}"
    );
}

#[test]
fn a_same_named_wrapper_from_an_unrelated_module_also_satisfies_presence() {
    // PINNED DOCUMENTED NON-CATCH, and the price of the test above.
    //
    // Presence compares the imported SYMBOL, not the module it came from, so a `withSession` exported
    // by some other package satisfies this convention. Verifying the module instead would break the
    // barrel case, because a barrel's specifier is legitimately not the family's module, and following
    // the chain to decide needs the import graph the presence path deliberately does not consult.
    //
    // Recorded in beta-claims.json under false_positive_behavior. Asserted here so it cannot change
    // silently in either direction: if presence starts comparing modules, this test fails and whoever
    // did it has to decide what happens to the barrel.
    let repo_root = write_route(&[
        r#"import { withSession } from "totally-unrelated-package";"#,
        "export const POST = withSession(async () => {",
        "  return Response.json({ ok: true });",
        "});",
        "",
    ]);
    let payload = run(
        &repo_root,
        vec![
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact(
                "import_used",
                "withSession",
                1,
                1,
                Some("totally-unrelated-package"),
                Some("withSession"),
            ),
            fact("route_declared", "POST", 2, 4, None, None),
            fact("symbol_called", "withSession", 2, 4, None, None),
            fact(
                "route_returns_response",
                "json",
                3,
                3,
                Some("Response"),
                None,
            ),
        ],
        presence_convention(),
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "presence compares the imported symbol, not its module - disclosed, not fixed: {payload:#?}"
    );
}

#[test]
fn a_wrong_flavour_member_is_reported_and_the_message_names_what_was_expected() {
    // CV-4 shape 3. A cron route wrapped in the SESSION family's member, checked against the cron
    // family. The session wrapper is not a member of the cron family, so the route is reported - and
    // the message has to name the helpers that would have satisfied it, or the reader cannot tell a
    // wrong-wrapper route from an unwrapped one.
    let repo_root = temp_repo();
    let route = repo_root.join("app/api/cron/rollup/route.ts");
    fs::create_dir_all(route.parent().expect("parent")).expect("mkdir");
    fs::write(
        &route,
        "export const POST = withSession(async () => Response.json({ ok: true }));\n",
    )
    .expect("write");

    let mut convention = presence_convention();
    convention["matcher"]["required_calls"] = json!(["verifyQstashSignature"]);
    convention["matcher"]["applies_to_route_flavors"] = json!(["cron_job"]);
    convention["requires"] = json!({
        "auth_helpers": [{
            "guard_id": "auth:verifyQstashSignature",
            "symbol": "verifyQstashSignature",
            "import": "@/lib/cron"
        }]
    });

    let cron_fact = |kind: &str,
                     name: &str,
                     start: usize,
                     end: usize,
                     value: Option<&str>,
                     imported: Option<&str>| {
        let mut out = json!({
            "kind": kind,
            "file_path": "app/api/cron/rollup/route.ts",
            "name": name,
            "start_line": start,
            "end_line": end
        });
        if let Some(value) = value {
            out["value"] = json!(value);
        }
        if let Some(imported) = imported {
            out["imported_name"] = json!(imported);
        }
        out
    };
    let payload = run(
        &repo_root,
        vec![
            cron_fact("file_role_detected", "api_route", 1, 1, None, None),
            cron_fact("route_flavor_detected", "cron_job", 1, 1, None, None),
            cron_fact(
                "import_used",
                "withSession",
                1,
                1,
                Some("@/lib/auth"),
                Some("withSession"),
            ),
            cron_fact("route_declared", "POST", 1, 1, None, None),
            cron_fact("symbol_called", "withSession", 1, 1, None, None),
            cron_fact(
                "route_returns_response",
                "json",
                1,
                1,
                Some("Response"),
                None,
            ),
        ],
        convention,
    );

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(
        findings.len(),
        1,
        "a session wrapper does not satisfy the cron family: {payload:#?}"
    );
    let message = findings[0]["message"].as_str().expect("message");
    assert!(
        message.contains("verifyQstashSignature"),
        "the message must name the helper that would have satisfied this flavour: {message}"
    );
    // Still presence wording, even in the wrong-family case.
    assert!(!message.to_lowercase().contains("unprotected"), "{message}");
}

#[test]
fn a_test_file_calling_wrappers_is_not_a_route_and_stays_silent() {
    // CV-4 negative control. A test file that exercises the wrappers is not an API route, and a
    // convention scoped to api_route must not reach it. Scope comes from the role fact, so a file with
    // no api_route role contributes no findings whatever it calls.
    let repo_root = temp_repo();
    let spec = repo_root.join("app/api/things/route.test.ts");
    fs::create_dir_all(spec.parent().expect("parent")).expect("mkdir");
    fs::write(
        &spec,
        "it(\"wraps\", () => { withSession(() => null); });\n",
    )
    .expect("write");

    let test_fact = |kind: &str, name: &str| {
        json!({
            "kind": kind,
            "file_path": "app/api/things/route.test.ts",
            "name": name,
            "start_line": 1,
            "end_line": 1
        })
    };
    let payload = run(
        &repo_root,
        vec![
            // `test`, not `api_route`.
            test_fact("file_role_detected", "test"),
            test_fact("test_declared", "wraps"),
            test_fact("symbol_called", "withSession"),
        ],
        presence_convention(),
    );

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a test file is not a route: {payload:#?}"
    );
}
