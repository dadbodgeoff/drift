import type { SecurityArchitectureAudit } from "@drift/query";

export function formatSecurityAuditText(payload: SecurityArchitectureAudit): string {
  const areaRows = Object.values(payload.areas)
    .filter((area) => area.observed)
    .map((area) => {
      const patterns = area.priority_patterns.slice(0, 5).map((pattern) =>
        `    ${pattern.pattern} priority:${pattern.priority} role:${pattern.semantic_role} files:${pattern.file_count} facts:${pattern.fact_count} truth:${pattern.proof_truth}`
      );
      return [
        `  ${area.title}: priority ${area.priority_count}, inventory ${area.inventory_count}, candidate-only ${area.candidate_only_count}, accepted ${area.accepted_count}, proofs ${area.proof_count}`,
        ...(patterns.length > 0 ? patterns : ["    no priority signals"])
      ].join("\n");
    });
  return [
    "Drift security audit",
    "",
    `Repo: ${payload.repo_id}`,
    `Scan: ${payload.scan_id ?? "none"}`,
    `Areas: ${payload.summary.observed_area_count} observed of ${payload.summary.area_count}`,
    `API routes: ${payload.summary.api_route_file_count}`,
    `Facts: ${payload.summary.fact_count}`,
    `Candidates: ${payload.summary.candidate_count}`,
    `Accepted conventions: ${payload.summary.accepted_convention_count}`,
    `Proof runs: ${payload.summary.proof_count}`,
    `Parser gaps: ${payload.summary.parser_gap_count}`,
    `Candidate-only patterns: ${payload.summary.candidate_only_pattern_count}`,
    `Priority signals: ${payload.summary.priority_pattern_count}`,
    `Inventory-only patterns: ${payload.summary.inventory_pattern_count}`,
    `Signal/noise ratio: ${payload.summary.signal_to_noise_ratio}`,
    "",
    "Priority areas:",
    ...(areaRows.length > 0 ? areaRows : ["  none"]),
    "",
    "Next steps:",
    ...payload.next_steps.map((step) => `  ${step}`),
    ""
  ].join("\n");
}
