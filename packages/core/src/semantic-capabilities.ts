import type {
  ConventionRuleCapabilityReference,
  ConventionRuleCapabilityValidationResult,
  SemanticCapabilityContract
} from "./domain.js";

/**
 * D-S1: what each capability claims, in the one capability namespace.
 *
 * Every `capability_id` here used to be of the form `ts.<name>.v1` and none of them was ever a
 * string the engine emitted. The engine reports bare names - `graph_stream`, `route_detection`,
 * `data_operation_detection` - so this list and `certified_capabilities()` had ZERO overlap by
 * construction, and `packages/query/src/semantic-coverage.ts` carried a hand-written table to bridge
 * them. That table named four capabilities the engine has never emitted (`data_operations`,
 * `data_operation_facts`, `fact_graph`, `route_flow`) and omitted three of the engine's real ones,
 * so `ts.route_flow.v1` - required on every `prepare` and every `get_task_preflight` - was never
 * certified and `semantic_coverage.decision` was the literal string "refuse" on every repo, even
 * with blocking_allowed readiness, confidence 1.0 and zero parser gaps.
 *
 * The bare namespace won: it is the one on the wire. See the `scan_capability` note in
 * vocabulary/vocabulary.json for the count of producer sites on each side.
 *
 * The `emitted_*_kinds` fields were wrong in the same way and for the same reason - written from
 * memory rather than from source. `role` is not a graph node kind (`file_role` is), `import` is not
 * one either (`import_decl`), and `unresolved_import_symbol`, `computed_call_unresolved` and
 * `chained_call_partial` are not parser gap kinds. All five came from `GraphNodeRecordSchema`, a
 * dead sixth copy of the graph vocabulary that has since been deleted.
 * `scripts/vocabulary-parity.mjs` now fails when any of these fields names something outside its
 * vocabulary, which is what makes the corrected values checkable rather than merely asserted.
 */
export const BUILTIN_SEMANTIC_CAPABILITIES: readonly SemanticCapabilityContract[] = [
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "file_discovery",
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
    capability_id: "syntax_facts",
    display_name: "TS/JS syntax facts",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast"],
    emitted_fact_kinds: ["exported_symbol", "symbol_called", "route_declared", "file_role_detected"],
    emitted_node_kinds: ["symbol", "callsite", "route", "file_role"],
    emitted_edge_kinds: ["FILE_HAS_ROLE"],
    parser_gap_kinds: ["parser_error", "partial_parse"],
    fixture_suites: ["ts-static-imports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "static_imports",
    display_name: "Static import extraction",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast", "graph"],
    emitted_fact_kinds: ["import_used", "re_export_used"],
    emitted_node_kinds: ["import_decl", "re_export"],
    emitted_edge_kinds: ["MODULE_IMPORTS_MODULE", "MODULE_REEXPORTS_MODULE"],
    parser_gap_kinds: ["unresolved_import"],
    fixture_suites: ["ts-static-imports", "ts-reexports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "import_resolution",
    display_name: "Static import resolution",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["graph"],
    emitted_fact_kinds: ["import_used", "re_export_used"],
    emitted_node_kinds: ["module"],
    emitted_edge_kinds: ["IMPORT_RESOLVES_TO_MODULE"],
    parser_gap_kinds: ["unresolved_import", "unresolved_symbol"],
    fixture_suites: ["ts-tsconfig-paths", "ts-workspace-packages", "ts-static-imports"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "data_operation_detection",
    display_name: "Supported data operation detection",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["ast", "graph"],
    emitted_fact_kinds: ["data_operation_detected"],
    emitted_node_kinds: ["data_store", "data_operation"],
    emitted_edge_kinds: ["DATA_OPERATION_READS_DATA_STORE"],
    parser_gap_kinds: ["unresolved_symbol"],
    fixture_suites: ["route-direct-data-access", "ts-computed-calls", "ts-chained-calls"],
    required_for_beta_claims: ["narrow_route_layering"],
    owner: "rust_engine"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "route_flow",
    display_name: "Route to service to data flow",
    language: "typescript",
    support: "supported",
    certification: "certified_deterministic",
    can_block: true,
    evidence_classes: ["graph"],
    emitted_fact_kinds: ["route_declared", "data_operation_detected", "file_role_detected"],
    emitted_node_kinds: ["route", "endpoint", "data_operation", "file_role"],
    emitted_edge_kinds: ["ROUTE_HAS_ENDPOINT", "MODULE_IMPORTS_MODULE", "DATA_OPERATION_READS_DATA_STORE"],
    parser_gap_kinds: ["unresolved_import", "dynamic_import_unresolved"],
    fixture_suites: ["route-service-data-flow", "route-direct-data-access"],
    required_for_beta_claims: ["narrow_route_layering"],
    // The query layer assembles the flow; every node, edge and fact it assembles it FROM is emitted
    // by the engine, which is why the engine can certify the evidence. That distinction is why this
    // capability could be required on every preflight and certified by nobody.
    owner: "query"
  },
  {
    schema_version: "drift.semantic_capability.v1",
    capability_id: "dynamic_imports",
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
    capability_id: "computed_calls",
    display_name: "Computed call resolution",
    language: "typescript",
    support: "deferred",
    certification: "unsupported",
    can_block: false,
    evidence_classes: ["unsupported_pattern"],
    emitted_fact_kinds: [],
    emitted_node_kinds: [],
    emitted_edge_kinds: [],
    parser_gap_kinds: ["unresolved_symbol"],
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
