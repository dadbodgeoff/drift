import type { DriftReadiness, DriftReadinessDecision, DriftReadinessSurface, ParserGapLike } from "./readiness.js";

export interface ParserGapQuality {
  schema_version: "drift.parser_gap_quality.v1";
  repo_id: string;
  scan_id: string | null;
  surface: DriftReadinessSurface;
  total_count: number;
  blocking_count: number;
  advisory_count: number;
  by_kind: Record<string, number>;
  by_capability: Record<string, number>;
  by_contract_kind: Record<string, number>;
  top_actions: ParserGapQualityAction[];
  sample_gaps: ParserGapQualitySample[];
  decision: DriftReadinessDecision;
  user_action: string;
}

export interface ParserGapQualityAction {
  suggested_action: string;
  count: number;
}

export interface ParserGapQualitySample {
  parser_gap_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  kind: string;
  confidence_impact: string;
  suggested_action: string;
  affected_capabilities: string[];
  affected_contract_kinds: string[];
  message: string;
}

export interface BuildParserGapQualityInput {
  repo_id: string;
  scan_id: string | null;
  surface: DriftReadinessSurface;
  parser_gaps: ParserGapLike[];
  readiness: DriftReadiness;
  sample_limit?: number;
}

const impactRank: Record<string, number> = {
  blocks_enforcement: 0,
  lowers_flow: 1,
  lowers_file: 2,
  none: 3
};

const v1Actions: Record<string, string> = {
  unresolved_import: "Resolve the import or add resolver configuration, then rerun drift scan.",
  unresolved_symbol: "Resolve the symbol export/import path, then rerun drift scan.",
  dynamic_import_unresolved: "Replace unsupported dynamic import shape or add an explicit static boundary fixture.",
  parser_error: "Fix the parse error before relying on blocking enforcement.",
  partial_parse: "Remove or isolate the unsupported file shape before relying on blocking enforcement.",
  unknown_file_role: "Add an explicit role convention or rename/move the file to a recognized role path.",
  mixed_file_role: "Split mixed responsibilities or add explicit conventions before relying on role enforcement."
};

const defaultV1Action = "Review the parser gap and rerun drift scan after fixing the unsupported pattern.";

export function buildParserGapQuality(input: BuildParserGapQualityInput): ParserGapQuality {
  const gaps = [...input.parser_gaps];
  const sampleLimit = input.sample_limit ?? 5;
  const blocking = gaps.filter((gap) => gap.confidence_impact === "blocks_enforcement");

  return {
    schema_version: "drift.parser_gap_quality.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    surface: input.surface,
    total_count: gaps.length,
    blocking_count: blocking.length,
    advisory_count: gaps.length - blocking.length,
    by_kind: countBy(gaps, (gap) => gap.kind),
    by_capability: countBy(gaps.flatMap(capabilitiesForGap), (capability) => capability),
    by_contract_kind: countBy(gaps.flatMap(contractKindsForGap), (kind) => kind),
    top_actions: topActions(gaps),
    sample_gaps: sampleGaps(gaps, sampleLimit),
    decision: input.readiness.decision,
    user_action: userAction(input.readiness, gaps)
  };
}

function topActions(gaps: ParserGapLike[]): ParserGapQualityAction[] {
  const counts = countBy(gaps, suggestedActionForGap);
  return Object.entries(counts)
    .map(([suggested_action, count]) => ({ suggested_action, count }))
    .sort((left, right) =>
      right.count - left.count ||
      left.suggested_action.localeCompare(right.suggested_action)
    );
}

function sampleGaps(gaps: ParserGapLike[], limit: number): ParserGapQualitySample[] {
  return gaps
    .map((gap) => ({
      parser_gap_id: parserGapId(gap),
      file_path: gap.file_path,
      start_line: gap.start_line,
      end_line: gap.end_line,
      kind: gap.kind,
      confidence_impact: gap.confidence_impact,
      suggested_action: suggestedActionForGap(gap),
      affected_capabilities: capabilitiesForGap(gap),
      affected_contract_kinds: contractKindsForGap(gap),
      message: gap.message
    }))
    .sort((left, right) =>
      (impactRank[left.confidence_impact] ?? 99) - (impactRank[right.confidence_impact] ?? 99) ||
      left.file_path.localeCompare(right.file_path) ||
      left.parser_gap_id.localeCompare(right.parser_gap_id)
    )
    .slice(0, Math.max(0, limit));
}

function userAction(readiness: DriftReadiness, gaps: ParserGapLike[]): string {
  if (gaps.some((gap) => gap.confidence_impact === "blocks_enforcement")) {
    return "Resolve blocking parser gaps before enabling blocking enforcement.";
  }
  if (gaps.length === 0) {
    return "No parser gap action required.";
  }
  if (!readiness.graph_available || !readiness.graph_complete) {
    return "Restore graph evidence and rerun drift scan before relying on blocking enforcement.";
  }
  return "Review advisory parser gaps; blocking enforcement remains limited to complete evidence.";
}

function parserGapId(gap: ParserGapLike): string {
  return "parser_gap_id" in gap ? gap.parser_gap_id : gap.gap_id;
}

function suggestedActionForGap(gap: ParserGapLike): string {
  return "suggested_action" in gap
    ? gap.suggested_action
    : v1Actions[gap.kind] ?? defaultV1Action;
}

function capabilitiesForGap(gap: ParserGapLike): string[] {
  return "affected_capabilities" in gap ? [...gap.affected_capabilities].sort() : [];
}

function contractKindsForGap(gap: ParserGapLike): string[] {
  return "affected_contract_kinds" in gap ? [...gap.affected_contract_kinds].sort() : [];
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
