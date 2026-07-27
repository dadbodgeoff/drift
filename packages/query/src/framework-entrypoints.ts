import type {
  FrameworkCapability,
  FrameworkEntrypointReadModel,
  FrameworkParserGap,
  NormalizedEntrypointFact
} from "@drift/core";

export interface BuildFrameworkEntrypointReadModelInput {
  repo_id: string;
  scan_id: string;
  entrypoints: NormalizedEntrypointFact[];
  parser_gaps: FrameworkParserGap[];
  capabilities: FrameworkCapability[];
  proof_status_by_entrypoint_id?: Map<string, string>;
}

const CAPABILITY_STATUS_RANK: Record<FrameworkCapability["status"], number> = {
  complete: 0,
  partial: 1,
  unsupported: 2,
  failed: 3
};

export function buildFrameworkEntrypointReadModel(
  input: BuildFrameworkEntrypointReadModelInput
): FrameworkEntrypointReadModel {
  const gapsById = new Map(input.parser_gaps.map((gap) => [gap.parser_gap_id, gap]));
  const capabilitiesByFramework = new Map<string, FrameworkCapability[]>();

  for (const capability of input.capabilities) {
    const existing = capabilitiesByFramework.get(capability.framework) ?? [];
    existing.push(capability);
    capabilitiesByFramework.set(capability.framework, existing);
  }

  const entrypoints = [...input.entrypoints]
    .sort((left, right) =>
      left.framework.localeCompare(right.framework) ||
      left.file_path.localeCompare(right.file_path) ||
      left.entrypoint_id.localeCompare(right.entrypoint_id)
    )
    .map((entrypoint) => ({
      entrypoint_id: entrypoint.entrypoint_id,
      framework: entrypoint.framework,
      kind: entrypoint.kind,
      file_path: entrypoint.file_path,
      route_pattern: entrypoint.route_pattern,
      method: entrypoint.method,
      proof_status: input.proof_status_by_entrypoint_id?.get(entrypoint.entrypoint_id),
      parser_gap_codes: entrypoint.parser_gap_ids
        .flatMap((gapId) => {
          const code = gapsById.get(gapId)?.code;
          return code ? [code] : [];
        })
        .sort()
    }));

  const entrypointCountByFramework = new Map<string, number>();
  for (const entrypoint of input.entrypoints) {
    entrypointCountByFramework.set(
      entrypoint.framework,
      (entrypointCountByFramework.get(entrypoint.framework) ?? 0) + 1
    );
  }

  const byFramework = [...entrypointCountByFramework.entries()]
    .map(([framework, entrypointCount]) => {
      const capabilities = capabilitiesByFramework.get(framework) ?? [];
      const worstCapability = capabilities
        .slice()
        .sort((left, right) =>
          CAPABILITY_STATUS_RANK[right.status] - CAPABILITY_STATUS_RANK[left.status]
        )[0];
      return {
        framework: framework as FrameworkCapability["framework"],
        adapter_id: worstCapability?.adapter_id ?? `framework_adapter_${framework}`,
        entrypoint_count: entrypointCount,
        capability_status: worstCapability?.status ?? "unsupported",
        can_block: capabilities.some((capability) => capability.can_block)
      };
    })
    .sort((left, right) => left.framework.localeCompare(right.framework));

  return {
    schema_version: "drift.framework_entrypoints.read_model.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    summary: {
      entrypoint_count: input.entrypoints.length,
      supported_count: byFramework.filter((framework) => framework.capability_status === "complete").length,
      parser_gap_count: input.parser_gaps.length,
      unsupported_count: byFramework.filter((framework) => framework.capability_status === "unsupported").length,
      blocking_gap_count: input.parser_gaps.filter((gap) => gap.blocks_enforcement).length
    },
    by_framework: byFramework,
    entrypoints
  };
}
