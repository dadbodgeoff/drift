import type { HelperSimilarityEvidence } from "@drift/core";

export interface HelperFeatureProfile {
  symbol: string;
  file_path?: string;
  module?: string;
  purpose_tags?: string[];
  parameter_shape?: string[];
  return_shape?: string;
  call_dependencies?: string[];
  import_dependencies?: string[];
  body_operation_kinds?: string[];
  evidence_refs?: string[];
}

export interface ScoreHelperSimilarityInput {
  candidate: HelperFeatureProfile;
  canonical: HelperFeatureProfile;
  blockingThreshold?: "deterministic" | "high";
}

export function scoreHelperSimilarity(input: ScoreHelperSimilarityInput): HelperSimilarityEvidence {
  const deterministic = normalizeToken(input.candidate.symbol) === normalizeToken(input.canonical.symbol);
  const matched_features: HelperSimilarityEvidence["matched_features"] = [];
  const missing_features: string[] = [];
  let score = 0;

  if (deterministic) {
    score = 1;
    matched_features.push("name_tokens");
  } else if (tokenOverlap(nameTokens(input.candidate.symbol), nameTokens(input.canonical.symbol)) > 0) {
    score += 0.1;
    matched_features.push("name_tokens");
  } else {
    missing_features.push("name_tokens");
  }

  score += weightedSetMatch("purpose_tags", input.candidate.purpose_tags, input.canonical.purpose_tags, 0.25, matched_features, missing_features);
  score += weightedSetMatch("parameter_shape", input.candidate.parameter_shape, input.canonical.parameter_shape, 0.15, matched_features, missing_features);
  score += weightedScalarMatch("return_shape", input.candidate.return_shape, input.canonical.return_shape, 0.15, matched_features, missing_features);
  score += weightedSetMatch("call_dependencies", input.candidate.call_dependencies, input.canonical.call_dependencies, 0.2, matched_features, missing_features);
  score += weightedSetMatch("import_dependencies", input.candidate.import_dependencies, input.canonical.import_dependencies, 0.1, matched_features, missing_features);
  score += weightedSetMatch("body_operation_kinds", input.candidate.body_operation_kinds, input.canonical.body_operation_kinds, 0.15, matched_features, missing_features);

  const boundedScore = deterministic ? 1 : Math.min(1, Number(score.toFixed(3)));
  const score_band = deterministic
    ? "deterministic"
    : boundedScore >= 0.85
      ? "high"
      : boundedScore >= 0.65
        ? "medium"
        : "low";
  const blocking_allowed = input.blockingThreshold === "deterministic"
    ? score_band === "deterministic"
    : input.blockingThreshold === "high" && (score_band === "high" || score_band === "deterministic");

  return {
    schema_version: "drift.helper_similarity.v1",
    candidate_symbol: input.candidate.symbol,
    candidate_file_path: input.candidate.file_path ?? "unknown",
    canonical_symbol: input.canonical.symbol,
    canonical_module: input.canonical.module ?? input.canonical.file_path ?? input.canonical.symbol,
    score: boundedScore,
    score_band,
    matched_features: [...new Set(matched_features)].sort(),
    missing_features: [...new Set(missing_features)].sort(),
    evidence_refs: [...new Set([
      ...(input.candidate.evidence_refs ?? []),
      ...(input.canonical.evidence_refs ?? [])
    ])].sort(),
    blocking_allowed
  };
}

function weightedSetMatch(
  feature: HelperSimilarityEvidence["matched_features"][number],
  left: string[] | undefined,
  right: string[] | undefined,
  weight: number,
  matched: HelperSimilarityEvidence["matched_features"],
  missing: string[]
): number {
  const leftValues = normalizeSet(left);
  const rightValues = normalizeSet(right);
  if (leftValues.size === 0 || rightValues.size === 0) {
    missing.push(feature);
    return 0;
  }
  const overlap = tokenOverlap(leftValues, rightValues);
  if (overlap === 0) {
    missing.push(feature);
    return 0;
  }
  matched.push(feature);
  return weight * overlap;
}

function weightedScalarMatch(
  feature: HelperSimilarityEvidence["matched_features"][number],
  left: string | undefined,
  right: string | undefined,
  weight: number,
  matched: HelperSimilarityEvidence["matched_features"],
  missing: string[]
): number {
  if (!left || !right || normalizeToken(left) !== normalizeToken(right)) {
    missing.push(feature);
    return 0;
  }
  matched.push(feature);
  return weight;
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((value) => right.has(value)).length;
  const denominator = Math.max(left.size, right.size, 1);
  return intersection / denominator;
}

function normalizeSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeToken).filter(Boolean));
}

function nameTokens(value: string): Set<string> {
  return new Set(value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map(normalizeToken)
    .filter(Boolean));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, "");
}
