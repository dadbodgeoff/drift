import { createHash } from "node:crypto";
import { AgentTaskSchema, API_ROUTE_SCOPE_GLOBS, type AgentTask, type AgentTaskIntent, type EntrypointKind } from "@drift/core";

export function classifyAgentTask(taskText: string): AgentTask {
  const normalized = taskText.trim();
  const lower = normalized.toLowerCase();
  const taskIntent = taskIntentFor(lower);
  const likelyEntrypoints = likelyEntrypointKinds(lower);
  const targetArea = targetAreaFor(lower);

  return AgentTaskSchema.parse({
    schema_version: "drift.agent_task.v1",
    task_id: `agent_task_${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`,
    task_text: normalized,
    task_intent: taskIntent,
    target_area: targetArea,
    likely_files: likelyFilesFor(lower, likelyEntrypoints, targetArea),
    likely_entrypoint_kinds: likelyEntrypoints,
    required_context: requiredContextFor(taskIntent, likelyEntrypoints),
    risky_contracts: riskyContractsFor(lower, likelyEntrypoints),
    required_checks: requiredChecksFor(taskIntent, likelyEntrypoints),
    forbidden_actions: forbiddenActionsFor(taskIntent),
    human_approval_needed: humanApprovalNeeded(lower, taskIntent)
  });
}

function taskIntentFor(task: string): AgentTaskIntent {
  if (/\b(fix|bug|broken|error|regression)\b/.test(task)) {
    return "bugfix";
  }
  if (/\b(refactor|cleanup|rename|move)\b/.test(task)) {
    return "refactor";
  }
  if (/\b(test|spec|coverage)\b/.test(task)) {
    return "test_addition";
  }
  if (/\b(migration|migrate|schema)\b/.test(task)) {
    return "migration";
  }
  if (/\b(dependency|upgrade|bump|package)\b/.test(task)) {
    return "dependency_update";
  }
  if (/\b(config|setting|env)\b/.test(task)) {
    return "config_change";
  }
  if (/\b(auth|security|permission|secret)\b/.test(task)) {
    return "security_change";
  }
  if (/\b(performance|perf|speed|slow|optimize)\b/.test(task)) {
    return "performance_change";
  }
  if (/\b(add|create|implement|support|filter|search|endpoint)\b/.test(task)) {
    return "feature";
  }
  return "unknown";
}

function likelyEntrypointKinds(task: string): EntrypointKind[] {
  if (/\b(endpoint|api|route|handler)\b/.test(task)) {
    return ["api_route"];
  }
  if (/\bcron|schedule|scheduled\b/.test(task)) {
    return ["cron_job"];
  }
  if (/\bwebhook\b/.test(task)) {
    return ["webhook_handler"];
  }
  if (/\bcli|command\b/.test(task)) {
    return ["cli_command"];
  }
  return [];
}

function targetAreaFor(task: string): string | null {
  if (/\b(user|users|account|accounts|profile|profiles)\b/.test(task)) {
    return "user_management";
  }
  if (/\b(auth|login|session|permission)\b/.test(task)) {
    return "auth";
  }
  if (/\b(project|projects)\b/.test(task)) {
    return "project_management";
  }
  if (/\b(billing|payment|subscription)\b/.test(task)) {
    return "billing";
  }
  return null;
}

function likelyFilesFor(task: string, entrypoints: EntrypointKind[], targetArea: string | null): string[] {
  const files = new Set<string>();
  if (entrypoints.includes("api_route")) {
    for (const glob of API_ROUTE_SCOPE_GLOBS) {
      files.add(glob);
    }
  }
  if (targetArea === "user_management" || /\buser|users\b/.test(task)) {
    files.add("**/*user*");
    files.add("**/*users*");
  }
  return [...files].sort();
}

function requiredContextFor(intent: AgentTaskIntent, entrypoints: EntrypointKind[]): string[] {
  const context = new Set(["repo_map", "accepted_conventions"]);
  if (entrypoints.length > 0) {
    context.add("route_flow");
  }
  if (intent === "feature" || intent === "bugfix") {
    context.add("change_impact");
    context.add("test_intelligence");
  }
  return [...context].sort();
}

function riskyContractsFor(task: string, entrypoints: EntrypointKind[]): string[] {
  const risky = new Set<string>();
  if (entrypoints.includes("api_route")) {
    risky.add("api_route_no_direct_data_access");
  }
  if (/\b(auth|security|secret|payment|billing)\b/.test(task)) {
    risky.add("sensitive_operation");
  }
  return [...risky].sort();
}

function requiredChecksFor(intent: AgentTaskIntent, entrypoints: EntrypointKind[]): string[] {
  const checks = new Set<string>();
  if (entrypoints.includes("api_route")) {
    checks.add("drift check --scope changed-hunks");
  }
  if (intent === "feature" || intent === "bugfix" || intent === "test_addition") {
    checks.add("test");
  }
  return [...checks].sort();
}

function forbiddenActionsFor(intent: AgentTaskIntent): string[] {
  const actions = new Set(["modify_repo_contract", "create_waiver"]);
  if (intent !== "migration") {
    actions.add("edit_migrations_without_approval");
  }
  return [...actions].sort();
}

function humanApprovalNeeded(task: string, intent: AgentTaskIntent): boolean {
  return intent === "migration" ||
    intent === "dependency_update" ||
    intent === "security_change" ||
    /\b(secret|payment|billing|delete|destructive)\b/.test(task);
}
