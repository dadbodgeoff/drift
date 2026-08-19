use drift_engine::{
    AcceptedPhase5Contract, FactKind, extract_security_facts_with_phase5, extract_typescript_facts,
};

/// A phase-5 contract that accepts every secret source and one log sink.
///
/// Sink candidates are gated on an accepted contract - see `sink_candidate_facts` - so an
/// extractor test for them has to supply one, the same way the `secret_read` tests do.
fn accepting_phase5() -> AcceptedPhase5Contract {
    AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec![
            "env".to_string(),
            "config".to_string(),
            "secret_manager".to_string(),
        ],
        log_sinks: vec!["console.error".to_string()],
    }
}

#[test]
fn extracts_api_route_imports_exports_calls_and_roles() {
    let source = r#"
import { prisma } from "@/lib/prisma";
import { createWorkspaceInvite } from "@repo/core/services/workspaces";

export async function POST(request: Request) {
  const body = await request.json();
  const invite = await createWorkspaceInvite(body.email);
  return Response.json({ invite }, { status: 201 });
}
"#;

    let facts = extract_typescript_facts("apps/web/app/api/workspaces/route.ts", source)
        .expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route")
    );
    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "prisma"
        && fact.value.as_deref() == Some("@/lib/prisma")));
    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "createWorkspaceInvite"
        && fact.value.as_deref() == Some("@repo/core/services/workspaces")));
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ExportedSymbol && fact.name == "POST")
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RouteDeclared && fact.name == "POST")
    );
    assert!(facts.iter().any(|fact| fact.kind == FactKind::SymbolCalled
        && fact.name == "createWorkspaceInvite"));
}

#[test]
fn grouped_next_api_route_gets_api_route_role() {
    let source = r#"export async function GET() { return Response.json({ ok: true }); }"#;
    let facts = extract_typescript_facts("apps/web/app/(admin)/api/users/route.ts", source)
        .expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route"),
        "missing api_route role: {facts:#?}"
    );
}

/// D-H2. This test used to assert the opposite, and asserting the opposite is what kept 27 real
/// handlers out of every role-scoped convention: `app/(marketing)/about/route.ts` is an HTTP route
/// handler serving `/about`, and Next.js does not care that no folder above it is called `api`.
///
/// The role name stays `api_route`. It is the existing vocabulary for "HTTP route handler" and is
/// what conventions, scope predicates and evidence are keyed on; renaming it would be a much larger
/// change than the one this fixes, and would say nothing new.
#[test]
fn app_route_outside_an_api_folder_still_gets_the_route_role() {
    let source = r#"export async function GET() { return Response.json({ ok: true }); }"#;
    for path in [
        "apps/web/app/(marketing)/about/route.ts",
        // dub's real shape: no auth wrapper, imports prisma directly, previously invisible.
        "apps/web/app/wellknown/[domain]/[file]/route.ts",
        // formbricks' and openstatus's real shapes.
        "apps/web/app/.well-known/openid-configuration/[[...issuer]]/route.ts",
        "apps/status-page/src/app/(status-page)/[domain]/(public)/feed/[type]/route.ts",
        "app/route.ts",
    ] {
        let facts = extract_typescript_facts(path, source).expect("typescript facts");
        assert!(
            facts
                .iter()
                .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route"),
            "{path} is a Next route handler and must carry the route role: {facts:#?}"
        );
    }
}

/// The widening has a boundary, and it is the `app` ancestor. Without one, a file called `route.ts`
/// is an ordinary module - an Express router, or one of formbricks' 28 `modules/**/route.ts`
/// re-export targets, which are imported BY app routes and are not routes themselves.
#[test]
fn a_route_file_outside_an_app_tree_is_not_a_route() {
    let source = r#"export async function GET() { return Response.json({ ok: true }); }"#;
    for path in [
        "server/api/users/route.ts",
        "apps/web/modules/api/v2/management/webhooks/route.ts",
        // Not named `route`, so not a handler however it sits.
        "apps/web/app/api/users/helper.ts",
    ] {
        let facts = extract_typescript_facts(path, source).expect("typescript facts");
        assert!(
            !facts
                .iter()
                .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route"),
            "{path} is not a Next route handler: {facts:#?}"
        );
    }
}

#[test]
fn preserves_direct_data_access_alias_import_sources() {
    let source = r#"
import { db } from "../../server/db";
import { client } from "@repo/database";

export async function GET() {
  return Response.json(await client.workspace.findMany());
}
"#;

    let facts =
        extract_typescript_facts("app/api/workspaces/route.ts", source).expect("typescript facts");

    let import_sources: Vec<&str> = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
        .filter_map(|fact| fact.value.as_deref())
        .collect();

    assert!(import_sources.contains(&"../../server/db"));
    assert!(import_sources.contains(&"@repo/database"));
}

#[test]
fn detects_data_operation_shaped_member_calls() {
    let source = r#"
import { db } from "@/lib/db";

export async function GET() {
  const users = await db.user.findMany();
  await logger.info("loaded users");
  await logger.user.findMany();
  return Response.json(users);
}
"#;

    let facts =
        extract_typescript_facts("app/api/users/route.ts", source).expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "findMany"
                && fact.value.as_deref() == Some("db.user")
                && fact.imported_name.as_deref() == Some("read:user"))
    );
    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "info"
                && fact.value.as_deref() == Some("logger"))
    );
    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "findMany"
                && fact.value.as_deref() == Some("logger.user"))
    );
}

#[test]
fn classifies_data_operation_risk_kinds_conservatively() {
    let source = r#"
import { prisma } from "@/lib/prisma";

export async function POST() {
  await prisma.user.create({});
  await prisma.session.deleteMany({});
  await prisma.audit.customVerb({});
  await logger.user.deleteMany({});
}
"#;

    let facts =
        extract_typescript_facts("app/api/users/route.ts", source).expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "create"
                && fact.value.as_deref() == Some("prisma.user")
                && fact.imported_name.as_deref() == Some("write:user"))
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "deleteMany"
                && fact.value.as_deref() == Some("prisma.session")
                && fact.imported_name.as_deref() == Some("delete:session"))
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "customVerb"
                && fact.value.as_deref() == Some("prisma.audit")
                && fact.imported_name.as_deref() == Some("unknown:audit"))
    );
    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::DataOperationDetected
                && fact.name == "deleteMany"
                && fact.value.as_deref() == Some("logger.user"))
    );
}

#[test]
fn skips_type_only_imports_as_value_import_facts() {
    let source = r#"
import type { PrismaClient } from "@/lib/prisma";
import { type DbConfig, db } from "@/lib/db";

export async function GET() {
  return Response.json(await db.user.findMany());
}
"#;

    let facts =
        extract_typescript_facts("app/api/users/route.ts", source).expect("typescript facts");

    assert!(!facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "PrismaClient"
        && fact.value.as_deref() == Some("@/lib/prisma")));
    assert!(!facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "DbConfig"
        && fact.value.as_deref() == Some("@/lib/db")));
    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "db"
        && fact.value.as_deref() == Some("@/lib/db")));
}

#[test]
fn extracts_commonjs_and_dynamic_import_bindings() {
    let source = r#"
const { prisma, db: database } = require("@/lib/prisma");
const auth = await import("@/server/auth");

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
"#;

    let facts =
        extract_typescript_facts("app/api/users/route.ts", source).expect("typescript facts");

    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "prisma"
        && fact.imported_name.as_deref() == Some("prisma")
        && fact.value.as_deref() == Some("@/lib/prisma")));
    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "database"
        && fact.imported_name.as_deref() == Some("db")
        && fact.value.as_deref() == Some("@/lib/prisma")));
    assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
        && fact.name == "auth"
        && fact.imported_name.as_deref() == Some("default")
        && fact.value.as_deref() == Some("@/server/auth")));
}

#[test]
fn extracts_next_route_handlers_declared_as_exported_constants() {
    let source = r#"
export const GET = async () => Response.json({ ok: true });
"#;

    let facts =
        extract_typescript_facts("app/api/users/route.ts", source).expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ExportedSymbol && fact.name == "GET")
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RouteDeclared && fact.name == "GET")
    );
}

#[test]
fn detects_package_and_module_roles_from_paths() {
    let source = "export function run() { return true; }\n";
    let cases = [
        ("packages/cli/src/commands/scan.ts", "cli_command_module"),
        ("packages/core/src/domain.ts", "core_module"),
        ("packages/query/src/index.ts", "query_module"),
        ("packages/factgraph/src/index.ts", "factgraph_module"),
        (
            "packages/adapters/typescript/src/index.ts",
            "adapter_module",
        ),
        ("packages/storage/src/sqlite-storage.ts", "storage_module"),
        (
            "packages/cli/src/engine/rust-engine.ts",
            "engine_bridge_module",
        ),
        ("packages/mcp/src/tools.ts", "mcp_module"),
        ("packages/cli/test/cli.test.ts", "test"),
        ("vitest.config.ts", "config"),
    ];

    for (path, role) in cases {
        let facts = extract_typescript_facts(path, source).expect("typescript facts");
        assert!(
            facts
                .iter()
                .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == role),
            "missing {role} for {path}: {facts:#?}"
        );
    }
}

/// T12: a value-syntax import whose binding is only ever used as a type is erased by
/// TypeScript just as `import type` is, and creates no runtime dependency. On dub this shape
/// accounted for 39 of 458 baseline findings.
#[test]
fn skips_value_syntax_imports_used_only_in_type_positions() {
    let source = r#"
import { Domain } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rows = await prisma.domain.findMany();
  return Response.json(rows);
}

function shape(input: Pick<Domain, "id" | "slug">) {
  return input;
}
"#;

    let facts =
        extract_typescript_facts("app/api/domains/route.ts", source).expect("typescript facts");

    // Domain is only ever a type: no runtime dependency on @prisma/client from this route.
    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::ImportUsed && fact.name == "Domain"),
        "Domain is used only in a type position and must not be a value import"
    );
    // prisma is called, so it must survive - dropping it would be a silent miss.
    assert!(
        facts.iter().any(|fact| fact.kind == FactKind::ImportUsed
            && fact.name == "prisma"
            && fact.value.as_deref() == Some("@/lib/prisma")),
        "prisma is called at runtime and must remain a value import"
    );
}

#[test]
fn keeps_imports_used_as_both_type_and_value() {
    // The Prisma namespace is a real runtime import (error classes) even though it also
    // appears in type positions. Ambiguity must resolve toward keeping the fact.
    let source = r#"
import { Prisma } from "@prisma/client";

export async function GET() {
  try {
    return Response.json({});
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return Response.json({ code: error.code });
    }
    throw error;
  }
}

function widen(input: Prisma.UserWhereInput) {
  return input;
}
"#;

    let facts = extract_typescript_facts("app/api/x/route.ts", source).expect("typescript facts");
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ImportUsed && fact.name == "Prisma"),
        "a binding used as both a value and a type must be kept"
    );
}

#[test]
fn keeps_imports_with_no_type_usage_evidence() {
    // No type position anywhere: the fact must be kept regardless of how the value is used.
    let source = r#"
import { db } from "@/lib/db";

export async function GET() {
  return Response.json(await db.user.findMany());
}
"#;

    let facts = extract_typescript_facts("app/api/y/route.ts", source).expect("typescript facts");
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ImportUsed && fact.name == "db")
    );
}

/// F5, S6-01. A comment cannot read a secret, and neither can a string.
///
/// `secret_read_facts` used to be a pure line scan - `line.split("process.env.")` - with nothing
/// between it and a `//` two columns to the left. Every commented-out `process.env.API_KEY` and
/// every documentation string that spells one out produced a `secret_read` fact, and a
/// `secret_read` fact on a line that also reads as a sink line is a finding. A secret-source read
/// is a `member_expression` or a `subscript_expression` in the AST or it is not a read at all, so
/// this pins that the fact comes off the tree-sitter walk.
///
/// The three decoys are the three shapes the line scan could not tell from the real read: a line
/// comment, a block comment, and a string literal.
#[test]
fn secret_read_facts_come_from_the_ast_not_the_line() {
    let source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  // const shadow = process.env.SHADOW_KEY;
  /* const blocked = process.env.BLOCKED_KEY; */
  const doc = "read process.env.DOC_KEY at boot";
  return Response.json({ ok: true });
}
"#;

    let facts =
        extract_typescript_facts("app/api/secrets/route.ts", source).expect("typescript facts");
    let reads = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SecretSourceRead)
        .collect::<Vec<_>>();

    assert_eq!(reads.len(), 1, "one real secret source read: {facts:#?}");
    assert_eq!(reads[0].name, "env", "{reads:#?}");
    assert_eq!(reads[0].start_line, 3, "{reads:#?}");
}

/// B3, S6-07. A qualified secret source is still a secret source.
///
/// The line scan matched `line.contains("config.")`, `line.split("process.env.")` and
/// `line.contains("secretManager.get(")` - substrings, so any prefix in front of them was
/// irrelevant. S6-01 replaced that with an equality test on the receiver, which quietly stopped
/// recognising `this.config.apiKey`, `globalThis.process.env.API_KEY` and
/// `this.secretManager.get(...)`. All three are ordinary spellings - `this.config` in particular is
/// how every class-based service reads config - and all three lost a real finding.
///
/// The receiver is therefore matched by SUFFIX, which is what "any prefix is irrelevant" means
/// once you are working on a tree instead of a line.
#[test]
fn a_qualified_receiver_is_still_a_secret_source() {
    let source = r#"
export async function GET() {
  const a = this.config.apiKey;
  const b = globalThis.process.env.API_KEY;
  const c = this.secretManager.get("PRIVATE_KEY");
  const d = deps.config.password;
  return Response.json({ ok: true });
}
"#;

    let facts =
        extract_typescript_facts("app/api/secrets/route.ts", source).expect("typescript facts");
    let reads = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SecretSourceRead)
        .map(|fact| (fact.name.as_str(), fact.start_line))
        .collect::<Vec<_>>();

    assert_eq!(
        reads,
        vec![
            ("config", 3),
            ("env", 4),
            ("secret_manager", 5),
            ("config", 6)
        ],
        "{facts:#?}"
    );
}

/// A suffix match is not a substring match: `appConfig` does not end in `.config`.
///
/// Without this the fix for the test above would be free to reach for `contains`, which would make
/// every identifier ending in the letters "config" a secret source.
#[test]
fn a_receiver_that_merely_ends_in_the_word_is_not_a_secret_source() {
    let source = r#"
export async function GET() {
  const a = appConfig.password;
  const b = myprocess.env.API_KEY;
  return Response.json({ ok: true });
}
"#;

    let facts =
        extract_typescript_facts("app/api/secrets/route.ts", source).expect("typescript facts");
    let reads = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SecretSourceRead)
        .collect::<Vec<_>>();

    assert!(reads.is_empty(), "{reads:#?}");
}

/// F5, S6-06. A sink fact is positioned at its CALLEE, and does not need a receiver.
///
/// `symbol_called` cannot carry either. Measured on the chain below, it reports
/// `name=json value=res\n    .status(500) lines=3-5` - the span of the whole call expression, so
/// its `start_line` is where `res` is written, not where `.json` is. The secret is on the `.json`
/// line, so a sink keyed on that fact lands one place and the secret another and they never meet.
/// And `callable_parts` returns `(name, None)` for a plain `identifier` callee, so a receiver-less
/// sink like `captureException(...)` has no receiver to match a contract's sink string against.
///
/// Neither is recoverable downstream of the fact, which is why this is a fact rather than a
/// smarter reader of an existing one.
#[test]
fn sink_facts_are_positioned_at_the_callee_and_need_no_receiver() {
    let source = r#"export async function GET(req, res) {
  const apiKey = process.env.API_KEY;
  captureException(apiKey);
  return res
    .status(500)
    .json({ error: apiKey });
}
"#;

    let facts = extract_security_facts_with_phase5(
        "app/api/secrets/route.ts",
        source,
        &[],
        &[],
        Some(&accepting_phase5()),
    )
    .expect("security facts");
    let sinks = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SinkCandidateCalled)
        .map(|fact| (fact.name.as_str(), fact.start_line))
        .collect::<Vec<_>>();

    // `.json` is on line 6 even though the call expression starts on line 4, and the
    // receiver-less `captureException` is present at all.
    assert!(
        sinks.contains(&("captureException", 3)),
        "receiver-less callee missing: {sinks:#?}"
    );
    assert!(
        sinks.contains(&("json", 6)),
        "callee position must be the property, not the call: {sinks:#?}"
    );
    assert!(
        sinks.contains(&("status", 5)),
        "every link in the chain is its own callee: {sinks:#?}"
    );
}

/// The identifiers a sink references come from the call's subtree, so a comment or a string
/// sharing the line contributes none of them.
///
/// This is the direct variable-on-sink-line branch of `secret_sink_exposures`, which used
/// `line_uses_identifier` against the RAW LINE. That is why
/// `console.error("start"); // apiKey is never logged` still produced a finding after S6-02: the
/// sink was real, the comment merely shared its line, and a raw-line token test cannot tell.
#[test]
fn sink_identifiers_exclude_comments_and_strings_on_the_same_line() {
    let source = r#"export async function GET() {
  const apiKey = process.env.API_KEY;
  console.error("start"); // apiKey is never logged
  console.warn(apiKey);
}
"#;

    let facts = extract_security_facts_with_phase5(
        "app/api/secrets/route.ts",
        source,
        &[],
        &[],
        Some(&accepting_phase5()),
    )
    .expect("security facts");
    let identifiers = |line: usize| -> Vec<String> {
        facts
            .iter()
            .find(|fact| fact.kind == FactKind::SinkCandidateCalled && fact.start_line == line)
            .and_then(|fact| fact.value.as_deref())
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .and_then(|value| {
                value.get("identifiers").and_then(|identifiers| {
                    identifiers.as_array().map(|entries| {
                        entries
                            .iter()
                            .filter_map(|entry| entry.as_str().map(str::to_string))
                            .collect()
                    })
                })
            })
            .unwrap_or_default()
    };

    assert!(
        !identifiers(3).contains(&"apiKey".to_string()),
        "a comment is not a reference: {:?}",
        identifiers(3)
    );
    assert!(
        identifiers(4).contains(&"apiKey".to_string()),
        "a real argument is: {:?}",
        identifiers(4)
    );
}

/// The other two accepted secret sources reach the walk through different node kinds:
/// `config.password` is a bare `member_expression` and `secretManager.get("K")` is a
/// `call_expression`. Both are decoyed the same way.
#[test]
fn config_and_secret_manager_reads_also_come_from_the_ast() {
    let source = r#"
export async function GET() {
  const password = config.password;
  const key = secretManager.get("PRIVATE_KEY");
  // const shadow = config.password;
  const doc = "secretManager.get('PRIVATE_KEY') is the accessor";
  return Response.json({ ok: true });
}
"#;

    let facts =
        extract_typescript_facts("app/api/secrets/route.ts", source).expect("typescript facts");
    let reads = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SecretSourceRead)
        .map(|fact| (fact.name.as_str(), fact.start_line))
        .collect::<Vec<_>>();

    assert_eq!(
        reads,
        vec![("config", 3), ("secret_manager", 4)],
        "{facts:#?}"
    );
}
