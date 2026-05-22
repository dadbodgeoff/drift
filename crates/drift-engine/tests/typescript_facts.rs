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
fn detects_package_and_module_roles_from_paths() {
    let source = "export function run() { return true; }\n";
    let cases = [
        ("packages/cli/src/commands/scan.ts", "cli_command_module"),
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
