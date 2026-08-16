import {
  BUILTIN_SEMANTIC_CAPABILITIES,
  SCAN_CAPABILITIES,
  SemanticCoverageContractSchema,
  type ParserGap,
  type ParserGapV2,
  type ScanCapabilityReport,
  type SemanticCoverageContract,
  type SemanticCoverageScope
} from "@drift/core";
import type { DriftReadiness } from "./readiness.js";

export interface BuildSemanticCoverageInput {
  repo_id: string;
  scan_id: string;
  scope: SemanticCoverageScope;
  scope_id: string;
  required_capabilities: string[];
  certified_capabilities: string[];
  missing_capabilities: string[];
  unsupported_capabilities?: string[];
  readiness: DriftReadiness;
  parser_gaps?: Array<ParserGap | ParserGapV2>;
  unsupported_pattern_ids?: string[];
  generated_at: string;
}

export interface BuildSemanticCoverageFromCapabilityReportInput {
  repo_id: string;
  scan_id: string;
  scope: SemanticCoverageScope;
  scope_id: string;
  capability_report?: Pick<
    ScanCapabilityReport,
    "certified_capabilities" | "required_capabilities" | "missing_capabilities"
  > | null;
  readiness: DriftReadiness;
  parser_gaps?: Array<ParserGap | ParserGapV2>;
  generated_at: string;
}

/**
 * D-S1: what a task preflight needs before it can say anything about a route.
 *
 * `route_flow` is the right requirement - preflight is about which routes a task touches and what
 * they reach - and it is now a capability the engine certifies, so requiring it is a question with a
 * possible "yes". It was spelled `ts.route_flow.v1`, a member of a namespace the engine has never
 * emitted a single string from, so it was required on every call and certified on none.
 */
const DEFAULT_PREFLIGHT_CAPABILITIES = ["route_flow"] as const;

/**
 * D-S1: the translation table that used to sit here is gone, because there is one namespace now.
 *
 * It mapped seven scan-capability names onto `ts.*.v1` ids. Four of the seven - `data_operations`,
 * `data_operation_facts`, `fact_graph`, `route_flow` - are strings the engine has never emitted, and
 * three the engine emits on every scan (`graph_stream`, `route_detection`,
 * `data_operation_detection`) were absent. A normal scan reports `required: ["file_discovery",
 * "syntax_facts", "graph_stream"]`; `graph_stream` translated to nothing and became an unknown
 * capability, `ts.route_flow.v1` was required by the constant above and appeared in no certified
 * list, and `decision` came out `"refuse"` on every repo, on every `prepare` and every
 * `get_task_preflight`. Measured against synthetic perfect readiness - blocking_allowed, confidence
 * 1.0, zero parser gaps - still "refuse". One commit ever touched this file, a workspace move; the
 * table has never matched the engine.
 *
 * It was a set of plausible-sounding synonyms written from memory rather than from source, so the
 * fix is not a corrected table. `SCAN_CAPABILITIES` is generated into both languages from
 * vocabulary/vocabulary.json, and an id outside it is unknown - still a refusal, but a true one.
 */
const SEMANTIC_CAPABILITIES = new Map(
  BUILTIN_SEMANTIC_CAPABILITIES.map((capability) => [capability.capability_id, capability])
);

const KNOWN_CAPABILITIES = new Set<string>(SCAN_CAPABILITIES);

export function buildSemanticCoverage(input: BuildSemanticCoverageInput): SemanticCoverageContract {
  const parserGaps = input.parser_gaps ?? [];
  const requiredCapabilities = uniqueSorted(input.required_capabilities);
  const certifiedCapabilities = new Set(input.certified_capabilities);
  const missingCapabilities = new Set(input.missing_capabilities);
  const unsupportedCapabilities = new Set(input.unsupported_capabilities ?? []);
  const gapAffectedCapabilities = new Set(parserGaps.flatMap((gap) =>
    "affected_capabilities" in gap ? gap.affected_capabilities : []
  ));

  const completeCapabilities = requiredCapabilities.filter((capability) =>
    certifiedCapabilities.has(capability) &&
    !missingCapabilities.has(capability) &&
    !unsupportedCapabilities.has(capability) &&
    !gapAffectedCapabilities.has(capability)
  );
  const partialCapabilities = requiredCapabilities.filter((capability) =>
    gapAffectedCapabilities.has(capability) &&
    !missingCapabilities.has(capability) &&
    !unsupportedCapabilities.has(capability)
  );
  const failClosedReasons = [
    ...[...missingCapabilities].map((capability) => `missing_capability:${capability}`),
    ...[...unsupportedCapabilities].map((capability) => `unsupported_capability:${capability}`)
  ];

  return SemanticCoverageContractSchema.parse({
    schema_version: "drift.semantic_coverage.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    scope: input.scope,
    scope_id: input.scope_id,
    required_capabilities: requiredCapabilities,
    complete_capabilities: completeCapabilities,
    partial_capabilities: partialCapabilities,
    missing_capabilities: uniqueSorted([...missingCapabilities]),
    unsupported_capabilities: uniqueSorted([...unsupportedCapabilities]),
    parser_gap_ids: uniqueSorted(parserGaps.map(parserGapId)),
    unsupported_pattern_ids: uniqueSorted(input.unsupported_pattern_ids ?? []),
    confidence: input.readiness.confidence,
    decision: missingCapabilities.size > 0 || unsupportedCapabilities.size > 0
      ? "refuse"
      : input.readiness.decision,
    reasons: uniqueSorted([...input.readiness.reasons, ...failClosedReasons]),
    generated_at: input.generated_at
  });
}

export function buildSemanticCoverageFromCapabilityReport(
  input: BuildSemanticCoverageFromCapabilityReportInput
): SemanticCoverageContract {
  const required = normalizeRequiredCapabilities([
    ...DEFAULT_PREFLIGHT_CAPABILITIES,
    ...(input.capability_report?.required_capabilities ?? [])
  ]);
  const certified = normalizeKnownCapabilities(input.capability_report?.certified_capabilities ?? []);
  const reportedMissing = normalizeKnownCapabilities([
    ...(input.capability_report?.missing_capabilities ?? []),
    ...input.readiness.missing_capabilities
  ]);
  const unsupported = uniqueSorted([
    ...required.unknown_capabilities,
    // A required capability whose contract says `deferred` or `unsupported` cannot back a decision.
    // A required capability with NO contract is not unsupported - `symbol_linking` and
    // `candidate_inference` are engine capabilities with no semantic contract written for them, and
    // `?.support !== "supported"` used to read absent-contract as unsupported, which is how a
    // vocabulary this file did not fully know turned into a fail-closed refusal.
    ...required.capabilities.filter((capabilityId) => {
      const contract = SEMANTIC_CAPABILITIES.get(capabilityId);
      return contract !== undefined && contract.support !== "supported";
    })
  ]);
  const certifiedCapabilities = new Set(certified);
  const reportedMissingCapabilities = new Set(reportedMissing);
  const unsupportedCapabilities = new Set(unsupported);
  const gapAffectedCapabilities = new Set((input.parser_gaps ?? []).flatMap((gap) =>
    "affected_capabilities" in gap ? gap.affected_capabilities : []
  ));
  const uncertifiedRequiredCapabilities = required.capabilities.filter((capabilityId) =>
    !certifiedCapabilities.has(capabilityId) &&
    !reportedMissingCapabilities.has(capabilityId) &&
    !unsupportedCapabilities.has(capabilityId) &&
    !gapAffectedCapabilities.has(capabilityId)
  );

  return buildSemanticCoverage({
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    scope: input.scope,
    scope_id: input.scope_id,
    required_capabilities: uniqueSorted([
      ...required.capabilities,
      ...required.unknown_capabilities
    ]),
    certified_capabilities: certified,
    missing_capabilities: uniqueSorted([
      ...reportedMissing,
      ...uncertifiedRequiredCapabilities,
      ...required.unknown_capabilities
    ]),
    unsupported_capabilities: unsupported,
    readiness: input.readiness,
    parser_gaps: input.parser_gaps,
    generated_at: input.generated_at
  });
}

function parserGapId(gap: ParserGap | ParserGapV2): string {
  return "parser_gap_id" in gap ? gap.parser_gap_id : gap.gap_id;
}

function normalizeRequiredCapabilities(values: string[]): {
  capabilities: string[];
  unknown_capabilities: string[];
} {
  const capabilities: string[] = [];
  const unknownCapabilities: string[] = [];
  for (const value of values) {
    const normalized = normalizeCapability(value);
    if (normalized) {
      capabilities.push(normalized);
    } else {
      unknownCapabilities.push(value);
    }
  }
  return {
    capabilities: uniqueSorted(capabilities),
    unknown_capabilities: uniqueSorted(unknownCapabilities)
  };
}

function normalizeKnownCapabilities(values: string[]): string[] {
  return uniqueSorted(values.flatMap((value) => {
    const normalized = normalizeCapability(value);
    return normalized ? [normalized] : [];
  }));
}

/**
 * A capability id, or null when this build does not know it.
 *
 * One namespace means membership, not translation. A member of the vocabulary that has no semantic
 * capability contract - `symbol_linking`, say, or `candidate_inference` - is still a real capability
 * the engine reports, so it passes here and is judged on whether it was certified. Only a string
 * outside the vocabulary entirely is unknown, and unknown fails closed.
 */
function normalizeCapability(value: string): string | null {
  return KNOWN_CAPABILITIES.has(value) ? value : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
