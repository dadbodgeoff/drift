use drift_engine::{
    BaselineStatus, BaselineViolation, DirectDataAccessRule, EnforcementMode, EnforcementResult,
    FindingStatus, Severity, SpecifierUse, UNRESOLVED_DYNAMIC_MEMBER, UNRESOLVED_REFERENCE_ESCAPES,
    classify_findings_against_baseline, classify_specifier_use, detect_direct_data_access_imports,
    extract_typescript_facts, materialize_direct_data_access_findings,
    materialize_direct_data_access_findings_with_sources,
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

// --- D5.1: one import statement is one finding (TDD §5.5) -----------------------------------

/// Measured, not assumed: papermark's 35 `@prisma/client` findings sit on 30 import lines, and
/// 4 of those lines carry more than one specifier. Grouping is worth 35 -> 30. It is a message
/// quality change, and this test exists so nobody has to take the 14% on faith.
#[test]
fn one_import_statement_with_two_specifiers_is_one_finding() {
    let source = r#"
import { prisma, auditLog } from "@/lib/prisma";
export async function POST() {
  await auditLog.write({});
  return Response.json(await prisma.user.findMany());
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

    // Two per-specifier violations, still detected as two - the detection layer is unchanged.
    assert_eq!(detect_direct_data_access_imports(&facts, &rule).len(), 2);

    let findings = materialize_direct_data_access_findings_with_sources(&facts, &rule, &|_| {
        Some(source.to_string())
    });

    assert_eq!(findings.len(), 1, "one import statement, one finding");
    assert_eq!(findings[0].import_names, vec!["auditLog", "prisma"]);
    assert!(
        findings[0]
            .message
            .contains("imports auditLog, prisma from @/lib/prisma"),
        "the grouped message must name every offending specifier: {}",
        findings[0].message
    );
}

/// Two imports of the same module on two lines stay two findings: the grouping key is the
/// statement, not the module.
#[test]
fn two_import_statements_from_one_module_stay_two_findings() {
    let source = r#"
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/prisma";
export async function POST() {
  await auditLog.write({});
  return Response.json(await prisma.user.findMany());
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

    let findings = materialize_direct_data_access_findings_with_sources(&facts, &rule, &|_| {
        Some(source.to_string())
    });

    assert_eq!(findings.len(), 2);
}

/// A baselined violation must not come back as `new` because grouping changed its identity.
///
/// The single-specifier fingerprint is unchanged by construction (it hashes one name, exactly
/// as before). The multi-specifier one cannot be, so it carries the old per-specifier values as
/// legacy fingerprints, which the check command already matches baselines against.
#[test]
fn a_grouped_finding_carries_the_pre_grouping_fingerprints() {
    let grouped_source = r#"
import { prisma, auditLog } from "@/lib/prisma";
export async function POST() {
  await auditLog.write({});
  return Response.json(await prisma.user.findMany());
}
"#;
    let split_source = r#"
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/prisma";
export async function POST() {
  await auditLog.write({});
  return Response.json(await prisma.user.findMany());
}
"#;
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };
    let path = "apps/web/app/api/users/route.ts";

    let split_facts = extract_typescript_facts(path, split_source).expect("typescript facts");
    let split = materialize_direct_data_access_findings_with_sources(&split_facts, &rule, &|_| {
        Some(split_source.to_string())
    });
    // Each of these is a single-specifier finding, so each fingerprint is byte-identical to what
    // the pre-D5.1 rule wrote for the same specifier.
    let mut pre_grouping = split
        .iter()
        .map(|finding| finding.fingerprint.clone())
        .collect::<Vec<_>>();
    pre_grouping.sort();

    let grouped_facts = extract_typescript_facts(path, grouped_source).expect("typescript facts");
    let grouped =
        materialize_direct_data_access_findings_with_sources(&grouped_facts, &rule, &|_| {
            Some(grouped_source.to_string())
        });
    assert_eq!(grouped.len(), 1);
    let mut legacy = grouped[0].legacy_fingerprints.clone();
    legacy.sort();

    assert_eq!(
        legacy, pre_grouping,
        "the grouped finding must resolve against both fingerprints a stored baseline could hold"
    );
    assert!(
        !legacy.contains(&grouped[0].fingerprint),
        "the current fingerprint is not its own legacy value"
    );
}

// --- D5.2: invocation evidence, and the two branches (TDD §5.5) -----------------------------

const ROUTE: &str = "apps/web/app/api/links/route.ts";

/// The measured papermark shape. `LinkType` is a generated enum imported as a VALUE (the
/// `import type` skip never sees it) and read as a member. There is nothing to call.
#[test]
fn an_enum_member_read_is_inert() {
    let source = r#"
import { LinkType } from "@prisma/client";
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  return Response.json({ grouped: kind === LinkType.GROUP });
}
"#;
    assert_eq!(
        classify_specifier_use(ROUTE, source, "LinkType"),
        SpecifierUse::Inert
    );
}

/// `PrismaClient` is the one genuine violation shape §5.5 names, and it appears zero times in
/// papermark. It also emits NO fact: `walk_node` dispatches on `call_expression` and a
/// `new_expression` is not one. A classifier over `symbol_called` facts alone therefore sees
/// exactly the same nothing here as it sees for the inert enum above - which is why this
/// classifier reads the AST instead of the fact stream, and why this test is the one that
/// would have caught the shortcut.
#[test]
fn a_new_instantiation_is_invocation_evidence() {
    let source = r#"
import { PrismaClient } from "@prisma/client";
export async function GET() {
  const client = new PrismaClient();
  return Response.json(await client.link.findMany());
}
"#;
    assert!(matches!(
        classify_specifier_use(ROUTE, source, "PrismaClient"),
        SpecifierUse::Invocation(_)
    ));
}

#[test]
fn a_member_call_is_invocation_evidence() {
    let source = r#"
import { prisma } from "@/lib/prisma";
export async function GET() { return Response.json(await prisma.link.findMany()); }
"#;
    assert!(matches!(
        classify_specifier_use(ROUTE, source, "prisma"),
        SpecifierUse::Invocation(_)
    ));
}

/// §5.5's own reassignment example. The read emits no fact and `q()` names a local, so this is
/// invisible to the fact stream; the alias fixpoint is what resolves it.
#[test]
fn a_member_read_bound_to_a_name_and_then_called_is_invocation_evidence() {
    let source = r#"
import { prisma } from "@/lib/prisma";
export async function GET() {
  const q = prisma.link.findMany;
  return Response.json(await q());
}
"#;
    assert!(matches!(
        classify_specifier_use(ROUTE, source, "prisma"),
        SpecifierUse::Invocation(_)
    ));
}

/// The two branches §5.5 requires be kept distinct, asserted as distinct.
///
/// A single confidence score cannot express this pair: both sides have zero invocation facts,
/// and they must land on opposite verdicts. Absence suppresses; ambiguity retains.
#[test]
fn absence_of_evidence_and_ambiguity_of_evidence_are_different_verdicts() {
    let absent = r#"
import { ItemType } from "@prisma/client";
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t");
  return Response.json({ folder: t === ItemType.FOLDER });
}
"#;
    let ambiguous = r#"
import { prisma } from "@/lib/prisma";
export async function GET(request: Request) {
  const store = new URL(request.url).searchParams.get("store") as string;
  return Response.json(await prisma[store].findMany());
}
"#;

    assert_eq!(
        classify_specifier_use(ROUTE, absent, "ItemType"),
        SpecifierUse::Inert,
        "no invocation facts at all is absence: suppress"
    );
    assert_eq!(
        classify_specifier_use(ROUTE, ambiguous, "prisma"),
        SpecifierUse::Unresolved(UNRESOLVED_DYNAMIC_MEMBER),
        "a computed member is ambiguity, not absence: retain, and say why"
    );
}

/// Handing the client to a callee is the ambiguity branch, not the absence branch: the whole
/// data-access surface leaves the route and what happens to it is decided elsewhere.
#[test]
fn an_escaping_binding_is_unresolved_rather_than_inert() {
    let source = r#"
import { prisma } from "@/lib/prisma";
import { countLinks } from "@/lib/report";
export async function GET() { return Response.json(await countLinks(prisma)); }
"#;
    assert_eq!(
        classify_specifier_use(ROUTE, source, "prisma"),
        SpecifierUse::Unresolved(UNRESOLVED_REFERENCE_ESCAPES)
    );
}

/// An import nothing uses is absence, not ambiguity.
#[test]
fn an_unused_binding_is_inert() {
    let source = r#"
import { ItemType } from "@prisma/client";
export async function GET() { return Response.json({ ok: true }); }
"#;
    assert_eq!(
        classify_specifier_use(ROUTE, source, "ItemType"),
        SpecifierUse::Inert
    );
}

/// Suppression requires proof of inertness, and no source is no proof.
///
/// This is the behaviour on any check request that arrives without a `repo_root`: D5.1 grouping
/// applies, D5.2 suppresses nothing, and the finding says so.
#[test]
fn without_source_nothing_is_suppressed() {
    let source = r#"
import { ItemType } from "@prisma/client";
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t");
  return Response.json({ folder: t === ItemType.FOLDER });
}
"#;
    let facts = extract_typescript_facts(ROUTE, source).expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@prisma/client".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let with_source = materialize_direct_data_access_findings_with_sources(&facts, &rule, &|_| {
        Some(source.to_string())
    });
    assert!(
        with_source.is_empty(),
        "with the source in hand, an inert enum read is suppressed"
    );

    let without_source = materialize_direct_data_access_findings(&facts, &rule);
    assert_eq!(
        without_source.len(),
        1,
        "without the source there is no proof of inertness, so the finding is retained"
    );
    assert!(
        without_source[0]
            .message
            .contains("could not be classified (source_unavailable)"),
        "and it must say that is why: {}",
        without_source[0].message
    );
}

/// S10 again, from D5.2's side. A bindingless import executes the module; there is no binding
/// whose use could be inert, so it must never reach the suppress branch.
#[test]
fn a_side_effect_import_is_never_suppressed() {
    let source = r#"
import "@/lib/prisma";
export async function GET() { return Response.json({ ok: true }); }
"#;
    let facts = extract_typescript_facts(ROUTE, source).expect("typescript facts");
    let rule = DirectDataAccessRule {
        convention_id: "convention_no_direct_data_access".to_string(),
        forbidden_imports: vec!["@/lib/prisma".to_string()],
        forbidden_module_files: Vec::new(),
        severity: Severity::Error,
        enforcement_mode: EnforcementMode::Block,
    };

    let findings = materialize_direct_data_access_findings_with_sources(&facts, &rule, &|_| {
        Some(source.to_string())
    });

    assert_eq!(findings.len(), 1);
    assert!(
        findings[0].message.contains("for its side effects"),
        "and it keeps the side-effect wording rather than gaining a retention clause: {}",
        findings[0].message
    );
    assert!(!findings[0].message.contains("could not be classified"));
}
