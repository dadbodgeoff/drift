import type { PolicyDecision,RepoContract } from "@drift/core";
import { policyFileContext } from "./repo-map.js";
import { freshnessRequirement } from "./scan-status.js";

export const MAX_POLICY_SNIPPET_CHARS = 50_000;

export function policySurface(value: string): PolicyDecision["surface"] {
  if (
    value === "cli-preflight" ||
    value === "cli-check" ||
    value === "mcp" ||
    value === "contract-export" ||
    value === "artifact" ||
    value === "log" ||
    value === "ui"
  ) {
    return value;
  }

  throw new Error("--surface must be cli-preflight, cli-check, mcp, contract-export, artifact, log, or ui.");
}

export function guardedSurfaces(): PolicyDecision["surface"][] {
  return [
    "cli-preflight",
    "cli-check",
    "mcp",
    "contract-export",
    "artifact",
    "log",
    "ui"
  ];
}

export function policyShowSummary(contract: RepoContract): {
  default_mode: RepoContract["context_egress"]["default_mode"];
  denied_glob_count: number;
  agent_permission_count: number;
  guarded_surface_count: number;
  allow_full_file_content: boolean;
  max_snippet_chars: number;
} {
  return {
    default_mode: contract.context_egress.default_mode,
    denied_glob_count: contract.context_egress.denied_globs.length,
    agent_permission_count: contract.agent_permissions.length,
    guarded_surface_count: guardedSurfaces().length,
    allow_full_file_content: contract.context_egress.allow_full_file_content,
    max_snippet_chars: contract.context_egress.max_snippet_chars
  };
}

export function policyShowNextCommands(repoId: string): string[] {
  return [
    `drift policy check-context --repo ${repoId} --path <file> --surface cli-preflight --json`,
    `drift policy set-egress --repo ${repoId} --default-mode redacted --confirm --json`,
    `drift audit list --repo ${repoId} --action policy_changed --json`
  ];
}

export function policyContextSummary(input: {
  decision: PolicyDecision;
  fileContext: ReturnType<typeof policyFileContext>;
  freshness: ReturnType<typeof freshnessRequirement>;
  deniedGlobCount: number;
}): {
  allowed: boolean;
  mode: PolicyDecision["mode"];
  surface: PolicyDecision["surface"];
  indexed: boolean;
  matched_convention_count: number;
  risky_area_count: number;
  open_finding_count: number;
  freshness_required: boolean;
  freshness_satisfied: boolean;
  denied_glob_count: number;
  approved_snippet_chars: number;
} {
  return {
    allowed: input.decision.allowed,
    mode: input.decision.mode,
    surface: input.decision.surface,
    indexed: input.fileContext.indexed,
    matched_convention_count: input.fileContext.convention_ids.length,
    risky_area_count: input.fileContext.risky_area_ids.length,
    open_finding_count: input.fileContext.open_finding_ids.length,
    freshness_required: input.freshness.required,
    freshness_satisfied: input.freshness.satisfied,
    denied_glob_count: input.deniedGlobCount,
    approved_snippet_chars: input.decision.approved_snippet_chars
  };
}

export function policyContextNextCommands(repoId: string, contextPath: string, decision: PolicyDecision): string[] {
  if (!decision.allowed) {
    return [`drift policy show --repo ${repoId} --json`];
  }
  return [
    `drift prepare "task" --repo ${repoId} --path ${contextPath} --json`,
    `drift repo map --repo ${repoId} --path ${contextPath} --json`,
    `drift policy show --repo ${repoId} --json`
  ];
}
