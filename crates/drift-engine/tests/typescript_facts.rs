use drift_engine::{FactKind, extract_typescript_facts};

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
