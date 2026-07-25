import type { ContextPolicyMatrix, PolicyDecision, RepoContract } from "./domain.js";
import { ContextPolicyMatrixSchema } from "./schemas.js";
import { matchesGlob } from "./globs.js";

export type PolicyRedactionState = "none" | "metadata_only" | "snippet_limited" | "denied";

export interface PolicyProof {
  schema_version: "policy.proof.v1";
  surface: PolicyDecision["surface"];
  allowed: boolean;
  mode: PolicyDecision["mode"];
  reason: string;
  max_snippet_chars: number;
  approved_snippet_chars: number;
  snippets_included: boolean;
  source_content_included: boolean;
  context_truncated: boolean;
  redaction_state: PolicyRedactionState;
}

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

export function createPolicyProof(
  decision: PolicyDecision,
  input: {
    snippetsIncluded?: boolean;
    sourceContentIncluded?: boolean;
    contextTruncated?: boolean;
  } = {}
): PolicyProof {
  const snippetsIncluded = Boolean(input.snippetsIncluded);
  const sourceContentIncluded = Boolean(input.sourceContentIncluded);
  const contextTruncated = Boolean(input.contextTruncated);
  return {
    schema_version: "policy.proof.v1",
    surface: decision.surface,
    allowed: decision.allowed,
    mode: decision.mode,
    reason: decision.reason,
    max_snippet_chars: decision.max_snippet_chars,
    approved_snippet_chars: decision.approved_snippet_chars,
    snippets_included: snippetsIncluded,
    source_content_included: sourceContentIncluded,
    context_truncated: contextTruncated,
    redaction_state: policyRedactionState(decision, {
      snippetsIncluded,
      contextTruncated
    })
  };
}

export function createContextPolicyMatrix(
  contract: RepoContract,
  decision: PolicyDecision
): ContextPolicyMatrix {
  const egressLevel = contextEgressLevel(contract, decision);
  return ContextPolicyMatrixSchema.parse({
    schema_version: "drift.context_policy.v1",
    can_read_repo_map: decision.allowed,
    can_read_source_snippets: egressLevel === "snippet_allowed" || egressLevel === "full_file_allowed",
    can_read_contract: decision.allowed,
    can_read_findings: decision.allowed,
    can_execute_commands: false,
    can_modify_contract: false,
    can_create_waiver: false,
    can_request_human_approval: true,
    can_access_secret_like_files: false,
    can_emit_patch: false,
    egress_level: egressLevel
  });
}

function contextEgressLevel(
  contract: RepoContract,
  decision: PolicyDecision
): ContextPolicyMatrix["egress_level"] {
  if (!decision.allowed) {
    return "no_source";
  }
  if (contract.context_egress.allow_full_file_content) {
    return "full_file_allowed";
  }
  if (decision.mode === "redacted") {
    return "snippet_allowed";
  }
  return "symbol_only";
}

function policyRedactionState(
  decision: PolicyDecision,
  input: {
    snippetsIncluded: boolean;
    contextTruncated: boolean;
  }
): PolicyRedactionState {
  if (!decision.allowed || decision.mode === "denied" || decision.mode === "approval_required") {
    return "denied";
  }
  if (decision.mode === "redacted" || input.contextTruncated) {
    return "snippet_limited";
  }
  return input.snippetsIncluded ? "none" : "metadata_only";
}

export function matchesPolicyGlob(filePath: string, glob: string): boolean {
  return matchesGlob(filePath, glob);
}

function isRepoRelativeContextPath(filePath: string): boolean {
  return !filePath.startsWith("/") &&
    !filePath.startsWith("\\") &&
    !filePath.split(/[\\/]+/).includes("..");
}

// Glob semantics live in ./globs.js - the single source of truth shared with
// the CLI and engine contract. Do not reintroduce a local implementation.
