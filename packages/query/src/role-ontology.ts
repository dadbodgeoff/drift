import type { CanonicalRole } from "@drift/core";

export type RoleEdgeKind = "imports" | "calls" | "depends_on";

export interface RoleEdgeInput {
  from_role: CanonicalRole | string;
  to_role: CanonicalRole | string;
  edge_kind: RoleEdgeKind | string;
  rules?: RoleOntologyRule[];
}

export interface RoleEdgeDecision {
  allowed: boolean;
  severity: "allowed" | "advisory" | "warning" | "blocking";
  reason_code: string;
  reason: string;
  source?: "built_in" | "repo_contract";
  rule_id?: string;
}

export interface RoleOntologyRule {
  rule_id: string;
  from_role: CanonicalRole | string;
  to_role: CanonicalRole | string;
  edge_kind?: RoleEdgeKind | string;
  allowed: boolean;
  severity: "allowed" | "advisory" | "warning" | "blocking";
  reason_code: string;
  reason: string;
  source: "repo_contract";
}

export function evaluateRoleEdge(input: RoleEdgeInput): RoleEdgeDecision {
  const fromRole = normalizeRole(input.from_role);
  const toRole = normalizeRole(input.to_role);
  const configuredRule = input.rules?.find((rule) =>
    normalizeRole(rule.from_role) === fromRole &&
    normalizeRole(rule.to_role) === toRole &&
    (!rule.edge_kind || rule.edge_kind === input.edge_kind)
  );
  if (configuredRule) {
    return {
      allowed: configuredRule.allowed,
      severity: configuredRule.severity,
      reason_code: configuredRule.reason_code,
      reason: configuredRule.reason,
      source: configuredRule.source,
      rule_id: configuredRule.rule_id
    };
  }

  if (fromRole === "route" && toRole === "data_access") {
    return {
      allowed: false,
      severity: "blocking",
      reason_code: "route_must_not_import_data_access",
      reason: "Routes must delegate data access through a service layer.",
      source: "built_in"
    };
  }

  if (fromRole === "service" && toRole === "data_access") {
    return allowed("service_may_use_data_access", "Services may own data-access orchestration.");
  }

  if (fromRole === "route" && toRole === "service") {
    return allowed("route_may_delegate_to_service", "Routes may delegate work to services.");
  }

  if (fromRole === "component" && toRole === "data_access") {
    return {
      allowed: false,
      severity: "blocking",
      reason_code: "component_must_not_import_data_access",
      reason: "Components must not import server-side data-access modules.",
      source: "built_in"
    };
  }

  if (fromRole.startsWith("test_")) {
    return allowed("test_dependency_allowed_by_scope", "Tests may depend on scoped subjects.");
  }

  if (fromRole === "migration" && toRole === "data_access") {
    return allowed("migration_may_use_data_access", "Migrations may use data-access primitives.");
  }

  if (fromRole === "script" && toRole === "data_access") {
    return {
      allowed: true,
      severity: "warning",
      reason_code: "script_data_access_allowed_with_risk",
      reason: "Scripts may use data access, but should be treated as side-effecting.",
      source: "built_in"
    };
  }

  if (fromRole === "generated" || toRole === "generated") {
    return {
      allowed: true,
      severity: "advisory",
      reason_code: "generated_edges_ignored_by_default",
      reason: "Generated-code edges are ignored by default.",
      source: "built_in"
    };
  }

  if (fromRole === "unknown" || toRole === "unknown") {
    return {
      allowed: true,
      severity: "advisory",
      reason_code: "unknown_role_lowers_confidence",
      reason: "Unknown roles lower graph confidence and must not create blocking findings by themselves.",
      source: "built_in"
    };
  }

  return allowed("role_edge_unspecified_allowed", "No canonical role rule forbids this edge.");
}

function normalizeRole(role: CanonicalRole | string): CanonicalRole | string {
  switch (role) {
    case "api_route":
      return "route";
    case "service_module":
      return "service";
    case "data_access_module":
    case "repository_module":
    case "storage_module":
      return "data_access";
    case "ui_component":
      return "component";
    case "hook_module":
      return "hook";
    case "schema_module":
      return "schema";
    case "adapter_module":
      return "adapter";
    default:
      return role;
  }
}

function allowed(reasonCode: string, reason: string): RoleEdgeDecision {
  return {
    allowed: true,
    severity: "allowed",
    reason_code: reasonCode,
    reason,
    source: "built_in"
  };
}
