use drift_engine::{
    detect_direct_data_access_imports, extract_typescript_facts, DirectDataAccessRule,
};

#[test]
fn flags_forbidden_data_access_imports_inside_api_routes() {
    let source = r#"
import { prisma } from "@/lib/prisma";
import { createWorkspaceInvite } from "@repo/core/services/workspaces";

export async function POST() {
  return Response.json(await createWorkspaceInvite(prisma));
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/workspaces/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string(), "@repo/database".to_string()],
    };

    let violations = detect_direct_data_access_imports(&facts, &rule);

    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].convention_id, "convention_no_direct_data_access");
    assert_eq!(violations[0].file_path, "apps/web/app/api/workspaces/route.ts");
    assert_eq!(violations[0].import_name, "prisma");
    assert_eq!(violations[0].import_source, "@/lib/prisma");
    assert_eq!(violations[0].line, 2);
}

#[test]
fn does_not_flag_service_layer_imports_inside_api_routes() {
    let source = r#"
import { createWorkspaceInvite } from "@repo/core/services/workspaces";

export async function POST() {
  return Response.json(await createWorkspaceInvite());
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/workspaces/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string(), "@repo/database".to_string()],
    };

    assert!(detect_direct_data_access_imports(&facts, &rule).is_empty());
}

#[test]
fn does_not_flag_forbidden_imports_outside_api_routes() {
    let source = r#"
import { prisma } from "@/lib/prisma";

export async function loadWorkspace() {
  return prisma.workspace.findMany();
}
"#;
    let facts = extract_typescript_facts("packages/core/services/workspaces.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
    };

    assert!(detect_direct_data_access_imports(&facts, &rule).is_empty());
}

#[test]
fn flags_monorepo_and_relative_database_aliases() {
    let source = r#"
import { db } from "../../server/db";
import { client } from "@repo/database";

export async function GET() {
  return Response.json(await client.workspace.findMany());
}
"#;
    let facts = extract_typescript_facts("app/api/workspaces/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["../../server/db".to_string(), "@repo/database".to_string()],
    };

    let violations = detect_direct_data_access_imports(&facts, &rule);

    assert_eq!(violations.len(), 2);
    assert!(violations.iter().any(|violation| violation.import_name == "db"
        && violation.import_source == "../../server/db"));
    assert!(violations.iter().any(|violation| violation.import_name == "client"
        && violation.import_source == "@repo/database"));
}
