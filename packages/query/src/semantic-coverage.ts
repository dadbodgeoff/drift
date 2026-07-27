import {
  BUILTIN_SEMANTIC_CAPABILITIES,
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

const DEFAULT_PREFLIGHT_CAPABILITIES = ["ts.route_flow.v1"] as const;

const SCAN_CAPABILITY_TO_SEMANTIC_CAPABILITY: Record<string, string> = {
  file_discovery: "ts.file_discovery.v1",
  syntax_facts: "ts.syntax_facts.v1",
  import_resolution: "ts.import_resolution.v1",
  data_operations: "ts.data_operations.v1",
  data_operation_facts: "ts.data_operations.v1",
  fact_graph: "ts.route_flow.v1",
  route_flow: "ts.route_flow.v1"
};

const SEMANTIC_CAPABILITIES = new Map(
  BUILTIN_SEMANTIC_CAPABILITIES.map((capability) => [capability.capability_id, capability])
);

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
    ...required.capabilities.filter((capabilityId) =>
      SEMANTIC_CAPABILITIES.get(capabilityId)?.support !== "supported"
    )
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

function normalizeCapability(value: string): string | null {
  if (SEMANTIC_CAPABILITIES.has(value)) {
    return value;
  }
  return SCAN_CAPABILITY_TO_SEMANTIC_CAPABILITY[value] ?? null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
