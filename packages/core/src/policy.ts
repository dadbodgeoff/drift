import type { PolicyDecision, RepoContract } from "./domain.js";

export function authorizeContextExport(
  contract: RepoContract,
  surface: PolicyDecision["surface"],
  input: { path?: string } = {}
): PolicyDecision {
  if (
    input.path &&
    contract.context_egress.denied_globs.some((glob) => matchesGlob(input.path!, glob))
  ) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: `path matches denied context glob: ${input.path}`,
      max_snippet_chars: 0
    };
  }

  const mode = contract.context_egress.default_mode;
  if (mode === "approval_required") {
    return {
      allowed: false,
      surface,
      mode,
      reason: "context export requires approval",
      max_snippet_chars: contract.context_egress.max_snippet_chars
    };
  }

  return {
    allowed: true,
    surface,
    mode,
    reason: input.path ? "context path is allowed by repo policy" : "metadata-only local preflight packet",
    max_snippet_chars: contract.context_egress.max_snippet_chars
  };
}

export function matchesPolicyGlob(filePath: string, glob: string): boolean {
  return matchesGlob(filePath, glob);
}

function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}
