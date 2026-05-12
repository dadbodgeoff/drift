import type { PolicyDecision, RepoContract } from "./domain.js";

export function authorizeContextExport(
  contract: RepoContract,
  surface: PolicyDecision["surface"],
  input: {
    path?: string;
    requested_snippet_chars?: number;
    request_full_file_content?: boolean;
  } = {}
): PolicyDecision {
  if (input.path && !isRepoRelativeContextPath(input.path)) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: "context path must be repo-relative",
      max_snippet_chars: 0,
      approved_snippet_chars: 0
    };
  }

  if (
    input.path &&
    contract.context_egress.denied_globs.some((glob) => matchesGlob(input.path!, glob))
  ) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: `path matches denied context glob: ${input.path}`,
      max_snippet_chars: 0,
      approved_snippet_chars: 0
    };
  }

  if (input.request_full_file_content && !contract.context_egress.allow_full_file_content) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: "full file content is denied by repo policy",
      max_snippet_chars: 0,
      approved_snippet_chars: 0
    };
  }

  const mode = contract.context_egress.default_mode;
  if (mode === "approval_required") {
    return {
      allowed: false,
      surface,
      mode,
      reason: "context export requires approval",
      max_snippet_chars: contract.context_egress.max_snippet_chars,
      approved_snippet_chars: 0
    };
  }

  const requestedSnippetChars = input.requested_snippet_chars ?? contract.context_egress.max_snippet_chars;
  if (!Number.isInteger(requestedSnippetChars) || requestedSnippetChars <= 0) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: "requested snippet length must be a positive integer",
      max_snippet_chars: contract.context_egress.max_snippet_chars,
      approved_snippet_chars: 0
    };
  }
  const approvedSnippetChars = Math.min(
    requestedSnippetChars,
    contract.context_egress.max_snippet_chars
  );
  const snippetLimited = requestedSnippetChars > contract.context_egress.max_snippet_chars;

  return {
    allowed: true,
    surface,
    mode: snippetLimited ? "redacted" : mode,
    reason: snippetLimited
      ? "requested snippet length exceeds repo policy and was capped"
      : input.path ? "context path is allowed by repo policy" : "metadata-only local preflight packet",
    max_snippet_chars: contract.context_egress.max_snippet_chars,
    approved_snippet_chars: approvedSnippetChars
  };
}

export function matchesPolicyGlob(filePath: string, glob: string): boolean {
  return matchesGlob(filePath, glob);
}

function isRepoRelativeContextPath(filePath: string): boolean {
  return !filePath.startsWith("/") &&
    !filePath.startsWith("\\") &&
    !filePath.split(/[\\/]+/).includes("..");
}

function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}
