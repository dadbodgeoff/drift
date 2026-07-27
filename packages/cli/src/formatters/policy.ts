import type { PolicyDecision,RepoContract } from "@drift/core";
import { policyContextSummary,policyShowSummary } from "../domain/policy-context.js";

export function formatPolicyShowText(payload: {
  repo_id: string;
  policy: Pick<RepoContract, "context_egress" | "agent_permissions">;
  guarded_surfaces: string[];
  summary?: ReturnType<typeof policyShowSummary>;
  next_commands?: string[];
}): string {
  const nextCommands = payload.next_commands ?? [];
  return [
    "Drift policy",
    "",
    `Repo: ${payload.repo_id}`,
    `Mode: ${payload.policy.context_egress.default_mode}`,
    `Denied globs: ${payload.policy.context_egress.denied_globs.join(", ") || "none"}`,
    `Max snippet chars: ${payload.policy.context_egress.max_snippet_chars}`,
    `Full file content: ${payload.policy.context_egress.allow_full_file_content ? "allowed" : "denied"}`,
    `Agent permissions: ${payload.policy.agent_permissions.length}`,
    payload.summary ? `Guarded surfaces: ${payload.summary.guarded_surface_count}` : "",
    "",
    "Guarded surfaces:",
    ...payload.guarded_surfaces.map((surface) => `  ${surface}`),
    nextCommands.length > 0 ? "" : "",
    nextCommands.length > 0 ? "Next commands:" : "",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatPolicyDecisionText(payload: {
  repo_id: string;
  path: string;
  decision: PolicyDecision;
  summary?: ReturnType<typeof policyContextSummary>;
  next_commands?: string[];
}): string {
  const nextCommands = payload.next_commands ?? [];
  return [
    "Drift policy decision",
    "",
    `Repo: ${payload.repo_id}`,
    `Path: ${payload.path}`,
    `Surface: ${payload.decision.surface}`,
    `Decision: ${payload.decision.allowed ? "allowed" : "denied"}`,
    `Mode: ${payload.decision.mode}`,
    payload.summary ? `Indexed: ${payload.summary.indexed ? "yes" : "no"}` : "",
    payload.summary ? `Approved snippet chars: ${payload.summary.approved_snippet_chars}` : "",
    `Reason: ${payload.decision.reason}`,
    nextCommands.length > 0 ? "" : "",
    nextCommands.length > 0 ? "Next commands:" : "",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
