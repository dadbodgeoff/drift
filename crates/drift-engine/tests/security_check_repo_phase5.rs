use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn security_phase5_contract_input_reaches_rust_check_repo_capabilities() {
    let repo_root = temp_repo("phase5_contract_input");
    let route_path = repo_root.join("app/api/users/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { serializePublicUser } from '@/lib/serializers/user';",
            "export async function GET() {",
            "  const user = { email: 'redacted@example.test' };",
            "  return Response.json(serializePublicUser(user));",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5",
            "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("import_used", "serializePublicUser", 1, 1, Some("@/lib/serializers/user"), Some("serializePublicUser")),
                fact("symbol_called", "serializePublicUser", 4, 4, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["app/api/users/**/route.ts"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }],
                    "response_serializers": [{
                        "serializer_id": "serializePublicUser",
                        "import_source": "@/lib/serializers/user",
                        "imported_name": "serializePublicUser",
                        "local_name": "serializePublicUser",
                        "policy": "denylist",
                        "filtered_fields": ["user.email"]
                    }],
                    "secret_sources": ["env", "config", "secret_manager"],
                    "log_sinks": ["console.error", "logger.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }, {
                "id": "security_api_secret_exposure",
                "kind": "api_route_forbids_secret_exposure",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["app/api/users/**/route.ts"]
                },
                "requires": {
                    "secret_sources": ["env", "config", "secret_manager"],
                    "log_sinks": ["console.error", "logger.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let required = payload["stats"]["capabilities"]["required"]
        .as_array()
        .expect("required capabilities")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    assert!(
        required.contains(&"response_shape_facts"),
        "missing response shape capability: {payload:#?}"
    );
    assert!(
        required.contains(&"secret_exposure"),
        "missing secret exposure capability: {payload:#?}"
    );
}

#[test]
fn security_phase5_scope_filtering_and_blocking_are_engine_owned() {
    let repo_root = temp_repo("phase5_scope_filtering");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\nexport async function POST() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );
    write_route(
        &repo_root,
        "app/api/admin/route.ts",
        "export async function GET() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );
    write_route(
        &repo_root,
        "lib/user-helper.ts",
        "export function userPayload(email: string) {\n  return { user: { email } };\n}\n",
    );
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  return Response.json({ apiKey });\n}\n",
    );

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5_scope",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5_scope",
            "facts": [
                fact_for_path("app/api/users/route.ts", "file_role_detected", "api_route", 1, 8, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "POST", 5, 8, None, None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 7, 7, Some("Response"), None),
                fact_for_path("app/api/admin/route.ts", "file_role_detected", "api_route", 1, 4, None, None),
                fact_for_path("app/api/admin/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/admin/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None),
                fact_for_path("lib/user-helper.ts", "file_role_detected", "service", 1, 3, None, None),
                fact_for_path("app/api/secrets/route.ts", "file_role_detected", "api_route", 1, 4, None, None),
                fact_for_path("app/api/secrets/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/secrets/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_scope",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/users/*"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }, {
                "id": "security_api_secret_exposure",
                "kind": "api_route_forbids_secret_exposure",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/secrets/*"]
                },
                "requires": {
                    "secret_sources": ["env"],
                    "log_sinks": ["console.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 2, "{payload:#?}");
    assert!(
        findings.iter().any(|finding| finding["rule_id"]
            == "api_route_forbids_sensitive_response_fields"
            && finding["evidence"][0]["file_path"] == "app/api/users/route.ts"),
        "expected only matching GET /api/users sensitive finding: {payload:#?}"
    );
    assert!(
        findings.iter().any(
            |finding| finding["rule_id"] == "api_route_forbids_secret_exposure"
                && finding["evidence"][0]["file_path"] == "app/api/secrets/route.ts"
        ),
        "expected only matching /api/secrets secret finding: {payload:#?}"
    );
    assert!(
        findings.iter().all(|finding| {
            finding["evidence"][0]["file_path"] != "app/api/admin/route.ts"
                && finding["evidence"][0]["file_path"] != "lib/user-helper.ts"
        }),
        "admin/helper files must be out of Phase 5 route scope: {payload:#?}"
    );
    let proofs = payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs");
    assert!(
        proofs.iter().any(|proof| {
            proof["route"]["route_id"] == "route:app/api/users/route.ts:GET"
                && proof["route"]["normalized_entrypoint_id"]
                    == "entrypoint:next_app:app/api/users/route.ts:GET"
        }),
        "{payload:#?}"
    );
    assert!(
        proofs.iter().any(|proof| {
            proof["route"]["route_id"] == "route:app/api/secrets/route.ts:GET"
                && proof["route"]["normalized_entrypoint_id"]
                    == "entrypoint:next_app:app/api/secrets/route.ts:GET"
        }),
        "{payload:#?}"
    );
}

#[test]
fn security_phase5_get_contract_does_not_block_post_leak_in_same_route_file() {
    let repo_root = temp_repo("phase5_mixed_methods");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  return Response.json({ ok: true });\n}\nexport async function POST() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5_methods",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5_methods",
            "facts": [
                fact_for_path("app/api/users/route.ts", "file_role_detected", "api_route", 1, 7, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "GET", 1, 3, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "POST", 4, 7, None, None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 2, 2, Some("Response"), None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 6, 6, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_methods",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/users/*"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    assert!(
        payload["findings"].as_array().expect("findings").is_empty(),
        "{payload:#?}"
    );
}

/// F5, S6-01, end to end: the AST-sourced `secret_read` reaches the proof, not just the extractor.
///
/// The route logs a status code and mentions the env key it deliberately does NOT log, in a
/// trailing comment. The line scan read that comment as a secret read, and a secret read on a line
/// that is also a log sink is a direct exposure, so this route was `missing_proof` and blocked -
/// for a comment.
///
/// The sink on this line is real code either way, which is what isolates S6-01 from S6-02: only the
/// read moved to the AST here.
#[test]
fn a_secret_name_in_a_trailing_comment_is_not_a_secret_read() {
    let repo_root = temp_repo("phase5_trailing_comment_secret");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const status = 200;\n  console.error(status); // never log process.env.API_KEY\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_trailing_comment",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a secret name in a comment is not a secret read: {payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );
}

/// The control for the test above: the same shape with the read as real code still blocks.
///
/// Without this, "no finding" would be satisfied by a secret-exposure check that stopped working.
#[test]
fn a_secret_read_on_a_real_log_sink_line_still_blocks() {
    let repo_root = temp_repo("phase5_real_log_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const status = 200;\n  console.error(process.env.API_KEY);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_real_log_sink",
        &repo_root,
        5,
        4,
    ));

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        findings[0]["rule_id"], "api_route_forbids_secret_exposure",
        "{payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "{payload:#?}"
    );
}

/// F5, S6-02. The defect as reported: adding a comment creates a security finding.
///
/// `is_response_sink_line` was three `.contains()` calls and the log-sink test was
/// `log_sinks.iter().any(|sink| line.contains(sink))`, so commenting a log call OUT was
/// indistinguishable from leaving it in. This route reads a secret and never logs it; the only
/// `console.error` in the file is behind a `//`.
#[test]
fn a_commented_out_log_call_is_not_a_secret_sink() {
    let repo_root = temp_repo("phase5_commented_log_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  // console.error(apiKey);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_commented_log",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a commented-out log call is not a sink: {payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );
}

/// The same hole through a string literal rather than a comment.
///
/// A line that merely SPELLS a sink is not a sink. Documentation strings that name the thing they
/// tell you not to do are the common shape, and the substring test could not tell one from a call.
///
/// The response on the last line is deliberately free of both `apiKey` and `hint`. A string
/// literal can still TAINT a variable - `line_uses_identifier` reads raw lines, so the `apiKey`
/// token inside this string marks `hint` as carrying the secret - and that lives in the taint
/// fixpoint, which is not this sprint. Written the other way this test would be measuring the
/// fixpoint instead of the sink test it is named for.
#[test]
fn a_secret_name_inside_a_string_literal_is_not_a_secret_sink() {
    let repo_root = temp_repo("phase5_string_literal_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  const hint = \"never console.error(apiKey) in a handler\";\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_string_literal",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a sink named inside a string is not a sink: {payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );
}

/// Control for the log-sink rewrite: a secret assigned to a variable and then genuinely logged
/// still blocks. This is the taint path rather than the same-line path, so it covers the half of
/// `secret_sink_exposures` the two tests above do not.
#[test]
fn a_secret_variable_logged_on_a_real_call_still_blocks() {
    let repo_root = temp_repo("phase5_tainted_log_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  console.error(apiKey);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_tainted_log",
        &repo_root,
        5,
        4,
    ));

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "{payload:#?}"
    );
}

/// Control for the response-sink rewrite: a secret returned in the body still blocks.
#[test]
fn a_secret_returned_in_a_response_still_blocks() {
    let repo_root = temp_repo("phase5_response_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  return Response.json({ apiKey });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_response_sink",
        &repo_root,
        4,
        3,
    ));

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "{payload:#?}"
    );
}

/// B1, S6-06. A member chain broken across lines is still a response sink.
///
/// S6-02 keyed sinks on `symbol_called.start_line`, which is the CALL EXPRESSION's line - `res`,
/// on line 3 - while the secret is on the `.json` line, line 5. So they never met and a secret
/// returned in a response body silently stopped being reported. Prettier breaks chains of three or
/// more links by default, so this is the ordinary spelling.
///
/// The sink line is asserted, not just the finding count: landing on line 3 and reporting a
/// finding for some other reason would pass a count-only test.
#[test]
fn a_response_sink_split_across_lines_still_blocks() {
    let repo_root = temp_repo("phase5_chain_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET(req, res) {\n  const apiKey = process.env.API_KEY;\n  return res\n    .status(500)\n    .json({ error: apiKey });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_chain_sink",
        &repo_root,
        6,
        5,
    ));

    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "{payload:#?}"
    );
    assert_eq!(
        secret_sinks(&payload),
        vec![("response".to_string(), 5)],
        "the sink is where `.json` is written, not where the chain starts: {payload:#?}"
    );
}

/// B2, S6-06. A log sink with no receiver still blocks.
///
/// `log_sinks` is free text in the contract with nothing requiring a dotted name, and a directly
/// imported reporter is the common shape. S6-02 read `symbol_called`, whose `value` is `None` for
/// an `identifier` callee, and dropped every one of them on a `let Some(receiver) else continue`.
#[test]
fn a_receiver_less_log_sink_still_blocks() {
    let repo_root = temp_repo("phase5_bare_sink");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "import { captureException } from \"@sentry/node\";\nexport async function GET() {\n  const apiKey = process.env.API_KEY;\n  captureException(apiKey);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request_with_sinks(
        "repo_phase5_bare_sink",
        &repo_root,
        6,
        5,
        &["captureException"],
    ));

    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "{payload:#?}"
    );
    assert_eq!(
        secret_sinks(&payload),
        vec![("log".to_string(), 4)],
        "{payload:#?}"
    );
}

/// The reported defect, in the shape that survived S6-02: a comment on a REAL sink line.
///
/// `secret_sink_exposures` asked `line_uses_identifier(raw_line, variable)`, so a genuine
/// `console.error("start")` whose line happened to also contain the token `apiKey` inside a
/// comment produced an exposure. The sink was never in doubt; the reference was. This involves no
/// taint propagation - it is the direct variable-on-sink-line branch.
#[test]
fn a_comment_on_a_real_sink_line_is_not_a_reference() {
    let repo_root = temp_repo("phase5_comment_on_sink_line");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  console.error(\"start\"); // apiKey is never logged\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_comment_on_sink",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "a comment sharing a sink's line is not an argument to it: {payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );
}

/// B4, S6-08. Response wins over log when one line holds both kinds of sink.
///
/// `sink_kinds_by_line` inserts whichever sink it meets first and then OVERRIDES with `response`.
/// The walk meets the outer `console.error` before the inner `Response.json`, so without that
/// override this line reports `log`. A doc comment claimed the precedence; nothing measured it, and
/// deleting the override left the whole Rust suite green.
///
/// `sink_kind` is not cosmetic - it is what the finding tells a reader the secret escaped THROUGH,
/// and "we logged it" and "we returned it to the caller" are different incidents.
#[test]
fn a_line_that_is_both_sinks_reports_the_response() {
    let repo_root = temp_repo("phase5_sink_precedence");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  return console.error(Response.json({ apiKey }));\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_precedence",
        &repo_root,
        4,
        3,
    ));

    assert_eq!(
        secret_sinks(&payload),
        vec![("response".to_string(), 3)],
        "response must win over log on a line holding both: {payload:#?}"
    );
}

/// B4, S6-08. The contract's `secret_sources` allowlist is the only thing that means anything here.
///
/// `secret_read_facts` gates each `secret_source_read` on the accepted list. Deleting that gate
/// left the entire Rust suite green while making a contract that accepts ONLY `env` start flagging
/// `config.password` - a route going from `proven` to `missing_proof` because an allowlist stopped
/// being an allowlist. Nothing pinned it.
#[test]
fn a_source_the_contract_did_not_accept_is_not_a_secret() {
    let repo_root = temp_repo("phase5_sources_gate");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const pw = config.password;\n  console.error(pw);\n  return Response.json({ ok: true });\n}\n",
    );

    // The contract accepts `env` and says nothing about `config`.
    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_sources_gate",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "config is not an accepted secret source here: {payload:#?}"
    );
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );
}

/// B4, S6-08. The key comes from the READ's span, not from its line.
///
/// `span_text` was the newest and trickiest code in this sprint - byte-offset slicing with a
/// non-char-boundary fallback - and had no test at all. Replacing its single-line branch with "the
/// whole line" kept the suite green while losing a true finding, because both reads on the line
/// below then resolve to the FIRST key on it:
///
///     console.error(process.env.PORT, process.env.API_KEY);
///
/// `PORT` classifies as `unknown` and is dropped, so a whole-line `span_text` drops `API_KEY` too
/// and the route reports `proven`. That is a line scan growing back inside the fix for a line scan.
#[test]
fn a_second_secret_on_a_line_is_read_from_its_own_span() {
    let repo_root = temp_repo("phase5_span_text");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  console.error(process.env.PORT, process.env.API_KEY);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_span_text",
        &repo_root,
        4,
        3,
    ));

    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "the second read on the line is its own read: {payload:#?}"
    );
    assert_eq!(
        secret_sinks(&payload),
        vec![("log".to_string(), 2)],
        "{payload:#?}"
    );
}

/// B4, S6-08. The response predicate is exactly `json`, and widening it is a detection change.
///
/// `res.send(apiKey)` is a real leak that neither the pre-PR engine nor this one reports, because
/// the predicate has always been the `.json(` catch-all and nothing else. Widening it to
/// `json | send` passed the whole suite while turning this route from `proven` to `missing_proof`.
///
/// This test does not argue that the false negative is GOOD. It argues that changing it is a
/// detection change, which needs its own evidence and its own eval numbers, and must not ride
/// along inside a false-positive fix. Deleting this test is the honest way to widen the predicate.
#[test]
fn the_response_predicate_does_not_reach_beyond_json() {
    let repo_root = temp_repo("phase5_response_predicate");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET(req, res) {\n  const apiKey = process.env.API_KEY;\n  res.send(apiKey);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_response_predicate",
        &repo_root,
        5,
        4,
    ));

    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "`send` is not part of the response predicate: {payload:#?}"
    );
}

// ---------------------------------------------------------------------------------------------
// B5, S6-09. The detection changes, pinned.
//
// Moving secret exposure off a line scan and onto the tree was described as a false-positive fix.
// It is not only that. Measured case by case against the pre-PR engine at check-repo, this branch
// REMOVES three findings and ADDS six, and every one of the six is a true positive the text scan
// missed rather than a widened predicate. Neither number was in the original write-up, and a
// detection change nobody wrote down is how an eval baseline moves without anyone deciding it
// should. They are pinned here so that they are decisions rather than side effects.
// ---------------------------------------------------------------------------------------------

/// REMOVAL. A token elsewhere on a sink's line is not an argument to that sink.
///
/// This is the same mechanism as the comment fix and it reaches further than comments and strings:
/// the old test asked whether the LINE contained the token, so a second statement sharing the line
/// was attributed to the sink. `console.error("boot")` does not log `apiKey` merely because an
/// unrelated assignment sits after the semicolon.
///
/// Worth pinning because it is the one removal that is not obviously about comments, and because
/// the neighbouring case - `const x = apiKey; console.error(x);` on one line - must still fire.
#[test]
fn a_token_elsewhere_on_a_sink_line_is_not_an_exposure() {
    let repo_root = temp_repo("phase5_token_elsewhere");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  console.error(\"boot\"); const other = apiKey;\n  return Response.json({ ok: true });\n}\n",
    );
    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_token_elsewhere",
        &repo_root,
        5,
        4,
    ));
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "proven",
        "{payload:#?}"
    );

    // The neighbour: assigned on the same line and then genuinely logged, which must still block.
    let repo_root = temp_repo("phase5_token_same_line_logged");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  const copy = apiKey; console.error(copy);\n  return Response.json({ ok: true });\n}\n",
    );
    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_token_same_line_logged",
        &repo_root,
        5,
        4,
    ));
    assert_eq!(
        secret_exposure_proof_status(&payload),
        "missing_proof",
        "a secret copied and then logged on one line is still logged: {payload:#?}"
    );
}

/// ADDED. Every one of these was `proven` before and is `missing_proof` now, and every one is a
/// real leak the text scan could not see.
///
///   - `logger?.error(x)` - the line does not contain the literal `logger.error`
///   - `Response.json ({ x })` - the line does not contain the literal `.json(`
///   - a second statement on a line whose FIRST secret classified `unknown`; the old scanner
///     `continue`d and abandoned the whole line
///   - `secretManager\n  .get("K")` - the accessor is split across lines
///   - arguments split across lines - the sink's line did not contain the token
///
/// They are one test because they are one decision: a tree sees a call however it is spelled, and
/// the alternative to accepting these is to reintroduce formatting sensitivity on purpose.
struct DetectionCase {
    name: &'static str,
    source: &'static str,
    line_count: usize,
    response_line: usize,
    log_sinks: &'static [&'static str],
    secret_sources: &'static [&'static str],
}

#[test]
fn detections_the_line_scan_missed_now_fire() {
    let cases: &[DetectionCase] = &[
        DetectionCase {
            name: "optional_chain",
            source: "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  logger?.error(apiKey);\n  return Response.json({ ok: true });\n}\n",
            line_count: 5,
            response_line: 4,
            log_sinks: &["logger.error"],
            secret_sources: &["env"],
        },
        DetectionCase {
            name: "space_before_paren",
            source: "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  return Response.json ({ apiKey });\n}\n",
            line_count: 4,
            response_line: 3,
            log_sinks: &["console.error"],
            secret_sources: &["env"],
        },
        DetectionCase {
            name: "second_statement_after_unknown",
            source: "export async function GET() {\n  const port = process.env.PORT; const pw = config.password; console.error(pw);\n  return Response.json({ ok: true });\n}\n",
            line_count: 4,
            response_line: 3,
            log_sinks: &["console.error"],
            secret_sources: &["env", "config", "secret_manager"],
        },
        DetectionCase {
            name: "wrapped_secret_manager",
            source: "export async function GET() {\n  const key = secretManager\n    .get(\"API_KEY\");\n  console.error(key);\n  return Response.json({ ok: true });\n}\n",
            line_count: 6,
            response_line: 5,
            log_sinks: &["console.error"],
            secret_sources: &["env", "config", "secret_manager"],
        },
        DetectionCase {
            name: "arguments_split_across_lines",
            source: "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  console.error(\n    apiKey\n  );\n  return Response.json({ ok: true });\n}\n",
            line_count: 7,
            response_line: 6,
            log_sinks: &["console.error"],
            secret_sources: &["env"],
        },
    ];

    for case in cases {
        let DetectionCase {
            name,
            source,
            line_count,
            response_line,
            log_sinks,
            secret_sources,
        } = case;
        let repo_root = temp_repo(&format!("phase5_added_{name}"));
        write_route(&repo_root, "app/api/secrets/route.ts", source);
        let payload = run_check_repo(secret_exposure_request_full(
            &format!("repo_phase5_added_{name}"),
            &repo_root,
            *line_count,
            *response_line,
            log_sinks,
            secret_sources,
        ));
        assert_eq!(
            secret_exposure_proof_status(&payload),
            "missing_proof",
            "{name} must be detected: {payload:#?}"
        );
    }
}

/// S6-04. The parser-gap scanners stay text-based ON PURPOSE, and this pins that they did.
///
/// S6-02 moved the SINK test off the line and onto the AST, which is why the commented-out
/// `console.error(value)` below is no longer a secret sink. `indirect_secret_flow_parser_gaps` in
/// security_control_flow.rs still reads it as one, and that is correct: it emits
/// `blocks_enforcement: true`, so over-firing REFUSES TO ENFORCE. A gap that fires when it need
/// not costs a refusal; a gap that stops firing costs a silent pass on a helper flow the engine
/// cannot follow. Those are not symmetric, and the conservative side is where this belongs.
///
/// So this test asserts the over-firing survived, deliberately, on exactly the input the sink fix
/// made safe elsewhere in the same file. If someone later "fixes" the gap scanner to skip comments
/// for consistency with S6-02, this goes red and asks them to argue for it rather than assume it.
#[test]
fn parser_gaps_still_fire_on_the_same_inputs() {
    let repo_root = temp_repo("phase5_parser_gap_pin");
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "function getApiKey() {\n  return process.env.API_KEY;\n}\n\nexport async function GET() {\n  const value = getApiKey();\n  // console.error(value);\n  return Response.json({ ok: true });\n}\n",
    );

    let payload = run_check_repo(secret_exposure_request(
        "repo_phase5_parser_gap",
        &repo_root,
        9,
        8,
    ));

    assert_eq!(
        secret_exposure_proof_status(&payload),
        "parser_gap",
        "the indirect-helper gap must still fire on a commented sink: {payload:#?}"
    );

    let proof = payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs")
        .iter()
        .find(|proof| proof["route"]["route_id"] == "route:app/api/secrets/route.ts:GET")
        .expect("secrets route proof");
    let gaps = proof["parser_gaps"].as_array().expect("parser gaps");
    assert_eq!(gaps.len(), 1, "{payload:#?}");
    assert_eq!(
        gaps[0]["code"], "unsupported_dynamic_control_flow",
        "{payload:#?}"
    );
    assert_eq!(
        gaps[0]["blocks_enforcement"], true,
        "an over-firing gap is only conservative while it blocks: {payload:#?}"
    );
}

/// The scan facts a secret-exposure check needs for one GET route in `app/api/secrets/route.ts`,
/// plus the accepted phase-5 contract that turns `env` into an accepted secret source and
/// `console.error` into a log sink.
///
/// `response_line` is where `Response.json(` sits, because the route-returns-response fact is what
/// makes the route a route as far as the check is concerned.
fn secret_exposure_request(
    repo_id: &str,
    repo_root: &std::path::Path,
    line_count: usize,
    response_line: usize,
) -> Value {
    secret_exposure_request_with_sinks(
        repo_id,
        repo_root,
        line_count,
        response_line,
        &["console.error"],
    )
}

/// The `(sink_kind, sink_line)` pairs the proof reports, which is where a sink LANDED rather than
/// merely whether one was found.
fn secret_sinks(payload: &Value) -> Vec<(String, u64)> {
    payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs")
        .iter()
        .find(|proof| proof["route"]["route_id"] == "route:app/api/secrets/route.ts:GET")
        .expect("secrets route proof")["sinks"]["secrets"]
        .as_array()
        .expect("sinks")
        .iter()
        .map(|sink| {
            (
                sink["sink_kind"].as_str().expect("sink kind").to_string(),
                sink["sink_line"].as_u64().expect("sink line"),
            )
        })
        .collect()
}

fn secret_exposure_request_with_sinks(
    repo_id: &str,
    repo_root: &std::path::Path,
    line_count: usize,
    response_line: usize,
    log_sinks: &[&str],
) -> Value {
    secret_exposure_request_full(
        repo_id,
        repo_root,
        line_count,
        response_line,
        log_sinks,
        &["env"],
    )
}

fn secret_exposure_request_full(
    repo_id: &str,
    repo_root: &std::path::Path,
    line_count: usize,
    response_line: usize,
    log_sinks: &[&str],
    secret_sources: &[&str],
) -> Value {
    let log_sinks = log_sinks.iter().map(|sink| json!(sink)).collect::<Vec<_>>();
    let secret_sources = secret_sources
        .iter()
        .map(|source| json!(source))
        .collect::<Vec<_>>();
    json!({
        "repo": {
            "repo_id": repo_id,
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5_secret",
            "facts": [
                fact_for_path("app/api/secrets/route.ts", "file_role_detected", "api_route", 1, line_count, None, None),
                fact_for_path("app/api/secrets/route.ts", "route_declared", "GET", 1, line_count, None, None),
                fact_for_path("app/api/secrets/route.ts", "symbol_called", "json", response_line, response_line, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_secret",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_secret_exposure",
                "kind": "api_route_forbids_secret_exposure",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/secrets/*"]
                },
                "requires": {
                    "secret_sources": secret_sources,
                    "log_sinks": log_sinks
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    })
}

fn secret_exposure_proof_status(payload: &Value) -> &str {
    payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs")
        .iter()
        .find(|proof| proof["route"]["route_id"] == "route:app/api/secrets/route.ts:GET")
        .expect("secrets route proof")["result"]["proof_status"]
        .as_str()
        .expect("proof status")
}

fn fact(
    kind: &str,
    name: &str,
    start_line: usize,
    end_line: usize,
    value: Option<&str>,
    imported_name: Option<&str>,
) -> Value {
    fact_for_path(
        "app/api/users/route.ts",
        kind,
        name,
        start_line,
        end_line,
        value,
        imported_name,
    )
}

fn fact_for_path(
    file_path: &str,
    kind: &str,
    name: &str,
    start_line: usize,
    end_line: usize,
    value: Option<&str>,
    imported_name: Option<&str>,
) -> Value {
    json!({
        "kind": kind,
        "file_path": file_path,
        "name": name,
        "value": value,
        "imported_name": imported_name,
        "start_line": start_line,
        "end_line": end_line
    })
}

fn write_route(repo_root: &std::path::Path, file_path: &str, source: &str) {
    let route_path = repo_root.join(file_path);
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(route_path, source).expect("write route");
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

fn temp_repo(name: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "drift-security-check-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp repo");
    path
}
