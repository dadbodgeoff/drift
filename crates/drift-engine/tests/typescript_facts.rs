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
