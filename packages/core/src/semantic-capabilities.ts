import type {
  ConventionRuleCapabilityReference,
  ConventionRuleCapabilityValidationResult,
  SemanticCapabilityContract
} from "./domain.js";

export const BUILTIN_SEMANTIC_CAPABILITIES: readonly SemanticCapabilityContract[] = [
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.file_discovery.v1",
    display_name: "TS/JS file discovery",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["path"],
    emitted_fact_kinds: ["file_detected"],
    emitted_node_kinds: ["file", "module"],
    emitted_edge_kinds: [],
    parser_gap_kinds: [],
    fixture_suites: ["ts-static-imports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.syntax_facts.v1",
    display_name: "TS/JS syntax facts",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast"],
    emitted_fact_kinds: ["exported_symbol", "symbol_called", "route_declared", "file_role_detected"],
    emitted_node_kinds: ["symbol", "callsite", "route", "role"],
    emitted_edge_kinds: ["FILE_HAS_ROLE"],
    parser_gap_kinds: ["parser_error", "partial_parse"],
    fixture_suites: ["ts-static-imports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.static_imports.v1",
    display_name: "Static import extraction",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast", "graph"],
    emitted_fact_kinds: ["import_used", "re_export_used"],
    emitted_node_kinds: ["import", "re_export"],
    emitted_edge_kinds: ["MODULE_IMPORTS_MODULE", "MODULE_REEXPORTS_MODULE"],
    parser_gap_kinds: ["unresolved_import"],
    fixture_suites: ["ts-static-imports", "ts-reexports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.import_resolution.v1",
    display_name: "Static import resolution",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["graph"],
    emitted_fact_kinds: ["import_used", "re_export_used"],
    emitted_node_kinds: ["module"],
    emitted_edge_kinds: ["IMPORT_RESOLVES_TO_MODULE"],
    parser_gap_kinds: ["unresolved_import", "unresolved_import_symbol"],
    fixture_suites: ["ts-tsconfig-paths", "ts-workspace-packages", "ts-static-imports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.data_operations.v1",
    display_name: "Supported data operation detection",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast", "graph"],
    emitted_fact_kinds: ["data_operation_detected"],
    emitted_node_kinds: ["data_store", "data_operation"],
    emitted_edge_kinds: ["DATA_OPERATION_READS_DATA_STORE"],
    parser_gap_kinds: ["computed_call_unresolved", "chained_call_partial"],
    fixture_suites: ["route-direct-data-access", "ts-computed-calls", "ts-chained-calls"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.route_flow.v1",
    display_name: "Route to service to data flow",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["graph"],
    emitted_fact_kinds: ["route_declared", "data_operation_detected", "file_role_detected"],
    emitted_node_kinds: ["route", "endpoint", "data_operation", "role"],
    emitted_edge_kinds: ["ROUTE_HAS_ENDPOINT", "MODULE_IMPORTS_MODULE", "DATA_OPERATION_READS_DATA_STORE"],
    parser_gap_kinds: ["unresolved_import", "dynamic_import_unresolved", "computed_call_unresolved"],
    fixture_suites: ["route-service-data-flow", "route-direct-data-access"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "query"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.dynamic_imports.v1",
    display_name: "Dynamic import resolution",
    language: "typescript",
    support: "deferred",
    certification: "unsupported",
    can_block: false,
    evidence_classes: ["unsupported_pattern"],
    emitted_fact_kinds: [],
    emitted_node_kinds: [],
    emitted_edge_kinds: [],
    parser_gap_kinds: ["dynamic_import_unresolved"],
    fixture_suites: ["ts-dynamic-imports"],
    required_for_beta_claims: [],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.computed_calls.v1",
    display_name: "Computed call resolution",
    language: "typescript",
    support: "deferred",
    certification: "unsupported",
    can_block: false,
    evidence_classes: ["unsupported_pattern"],
    emitted_fact_kinds: [],
    emitted_node_kinds: [],
    emitted_edge_kinds: [],
    parser_gap_kinds: ["computed_call_unresolved"],
    fixture_suites: ["ts-computed-calls"],
    required_for_beta_claims: [],
    owner: "rust_engine"
  }
] as const;

export function validateConventionRuleCapabilities(input: {
  rule: ConventionRuleCapabilityReference;
  capabilities?: readonly SemanticCapabilityContract[];
}): ConventionRuleCapabilityValidationResult {
  const knownCapabilities = new Set(
    (input.capabilities ?? BUILTIN_SEMANTIC_CAPABILITIES).map((capability) => capability.capability_id)
  );
  const missing_capabilities = input.rule.requires_capabilities
    .filter((capability) => !knownCapabilities.has(capability));

  return {
    valid: missing_capabilities.length === 0,
    missing_capabilities
  };
}
