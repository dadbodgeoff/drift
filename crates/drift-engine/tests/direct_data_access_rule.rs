use drift_engine::{
    BaselineStatus, BaselineViolation, DirectDataAccessRule, EnforcementMode, EnforcementResult,
    FindingStatus, Severity, classify_findings_against_baseline, detect_direct_data_access_imports,
    extract_typescript_facts, materialize_direct_data_access_findings,
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
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let violations = detect_direct_data_access_imports(&facts, &rule);

    assert_eq!(violations.len(), 1);
    assert_eq!(
        violations[0].convention_id,
        "convention_no_direct_data_access"
    );
    assert_eq!(
        violations[0].file_path,
        "apps/web/app/api/workspaces/route.ts"
    );
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
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    assert!(detect_direct_data_access_imports(&facts, &rule).is_empty());
}

#[test]
fn does_not_flag_type_only_data_access_imports_inside_api_routes() {
    let source = r#"
import type { PrismaClient } from "@/lib/prisma";

export async function GET() {
  return Response.json({ ok: true });
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/health/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
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
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
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
    let facts =
        extract_typescript_facts("app/api/workspaces/route.ts", source).expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["../../server/db".to_string(), "@repo/database".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let violations = detect_direct_data_access_imports(&facts, &rule);

    assert_eq!(violations.len(), 2);
    assert!(
        violations
            .iter()
            .any(|violation| violation.import_name == "db"
                && violation.import_source == "../../server/db")
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.import_name == "client"
                && violation.import_source == "@repo/database")
    );
}

#[test]
fn materializes_direct_data_access_findings_with_stable_line_independent_fingerprints() {
    let first_source = r#"
import { prisma } from "@/lib/prisma";

export async function POST() {
  return Response.json(await prisma.workspace.findMany());
}
"#;
    let shifted_source = r#"


import { prisma } from "@/lib/prisma";

export async function POST() {
  return Response.json(await prisma.workspace.findMany());
}
"#;
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let first_facts =
        extract_typescript_facts("apps/web/app/api/workspaces/route.ts", first_source)
            .expect("typescript facts");
    let shifted_facts =
        extract_typescript_facts("apps/web/app/api/workspaces/route.ts", shifted_source)
            .expect("typescript facts");

    let first_findings = materialize_direct_data_access_findings(&first_facts, &rule);
    let shifted_findings = materialize_direct_data_access_findings(&shifted_facts, &rule);

    assert_eq!(first_findings.len(), 1);
    assert_eq!(shifted_findings.len(), 1);
    assert_eq!(
        first_findings[0].fingerprint,
        shifted_findings[0].fingerprint
    );
    assert_eq!(first_findings[0].severity, Severity::Error);
    assert_eq!(
        first_findings[0].enforcement_result,
        EnforcementResult::Block
    );
    assert_eq!(
        first_findings[0].title,
        "API route imports data access directly"
    );
}

#[test]
fn direct_data_access_fingerprint_changes_when_import_source_changes() {
    let prisma_source = r#"
import { prisma } from "@/lib/prisma";
export async function POST() { return Response.json(await prisma.user.findMany()); }
"#;
    let database_source = r#"
import { prisma } from "@repo/database";
export async function POST() { return Response.json(await prisma.user.findMany()); }
"#;
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string(), "@repo/database".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Warning,
        enforcement_mode: EnforcementMode::Warn,
    };

    let prisma_facts = extract_typescript_facts("apps/web/app/api/users/route.ts", prisma_source)
        .expect("typescript facts");
    let database_facts =
        extract_typescript_facts("apps/web/app/api/users/route.ts", database_source)
            .expect("typescript facts");

    let prisma_findings = materialize_direct_data_access_findings(&prisma_facts, &rule);
    let database_findings = materialize_direct_data_access_findings(&database_facts, &rule);

    assert_ne!(
        prisma_findings[0].fingerprint,
        database_findings[0].fingerprint
    );
    assert_eq!(prisma_findings[0].severity, Severity::Warning);
    assert_eq!(
        prisma_findings[0].enforcement_result,
        EnforcementResult::Warn
    );
}

#[test]
fn classifies_findings_as_pre_existing_when_active_baseline_matches() {
    let source = r#"
import { prisma } from "@/lib/prisma";
export async function POST() { return Response.json(await prisma.user.findMany()); }
"#;
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");
    let findings = materialize_direct_data_access_findings(&facts, &rule);
    let baseline = vec![BaselineViolation {
        convention_id: findings[0].convention_id.clone(),
        fingerprint: findings[0].fingerprint.clone(),
        status: BaselineStatus::Active,
    }];

    let classified = classify_findings_against_baseline(findings, &baseline);

    assert_eq!(classified.len(), 1);
    assert_eq!(classified[0].status, FindingStatus::PreExisting);
}

#[test]
fn classifies_findings_as_new_when_baseline_is_resolved_or_missing() {
    let source = r#"
import { prisma } from "@/lib/prisma";
export async function POST() { return Response.json(await prisma.user.findMany()); }
"#;
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");
    let findings = materialize_direct_data_access_findings(&facts, &rule);
    let resolved_baseline = vec![BaselineViolation {
        convention_id: findings[0].convention_id.clone(),
        fingerprint: findings[0].fingerprint.clone(),
        status: BaselineStatus::Resolved,
    }];

    let classified = classify_findings_against_baseline(findings.clone(), &resolved_baseline);
    let unbaselined = classify_findings_against_baseline(findings, &[]);

    assert_eq!(classified[0].status, FindingStatus::New);
    assert_eq!(unbaselined[0].status, FindingStatus::New);
}

// --- S10: the bindingless side-effect import ------------------------------------------------

/// `import "@/lib/prisma";` binds nothing, so no `import_used` fact was emitted and the rule
/// had nothing to match: a silent miss on every eval repo (O-3 matrix, `known_evasion: true`
/// x7). A side-effect import executes the module, which IS a runtime dependency on the data
/// layer, so it must produce a finding attributed to the route itself.
#[test]
fn flags_bindingless_side_effect_import_of_a_forbidden_module() {
    let source = r#"
import "@/lib/prisma";

export async function GET() {
  return new Response("ok");
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let violations = detect_direct_data_access_imports(&facts, &rule);

    assert_eq!(
        violations.len(),
        1,
        "a side-effect import of the forbidden module is a runtime dependency on it"
    );
    assert_eq!(violations[0].file_path, "apps/web/app/api/users/route.ts");
    assert_eq!(violations[0].import_source, "@/lib/prisma");
    assert_eq!(violations[0].line, 2);

    let findings = materialize_direct_data_access_findings(&facts, &rule);
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].enforcement_result, EnforcementResult::Block);
}

/// Negative control for the same change: stylesheet and asset side-effect imports are not
/// module dependencies. They must stay entirely silent - a `.css` import can never be a data
/// layer, and treating it as an unresolved module import would refuse real routes.
#[test]
fn does_not_flag_asset_side_effect_imports() {
    let source = r#"
import "./styles.css";
import "../theme.scss";
import "@/assets/logo.svg";

export async function GET() {
  return new Response("ok");
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/assets".to_string(), "./styles.css".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    assert!(
        detect_direct_data_access_imports(&facts, &rule).is_empty(),
        "asset side-effect imports must not become import_used facts at all"
    );
}

/// Negative control: `import type` binds nothing at runtime either, but it is erased by the
/// compiler. S10 must not widen into "every import declaration is a runtime use".
#[test]
fn does_not_flag_type_only_import_of_a_forbidden_module() {
    let source = r#"
import type { Prisma } from "@/lib/prisma";

export async function GET() {
  const q: Prisma | null = null;
  return Response.json({ q });
}
"#;
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    assert!(detect_direct_data_access_imports(&facts, &rule).is_empty());
}
