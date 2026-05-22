import type { AuditEvent } from "@drift/core";
import { sanitizeAuditId } from "./identifiers.js";

export function preflightGovernance(): {
  read_only: true;
  agent_can_mutate: false;
  allowed_agent_actions: string[];
  human_approval_required_for: string[];
} {
  return {
    read_only: true,
    agent_can_mutate: false,
    allowed_agent_actions: ["read_context", "request_preflight", "propose_resolution"],
    human_approval_required_for: [
      "accept_convention",
      "reject_convention",
      "edit_convention",
      "add_exception",
      "add_contract_waiver",
      "mark_needs_review",
      "suppress_finding",
      "accept_drift",
      "mark_false_positive",
      "change_policy",
      "grant_agent_permission",
      "export_contract",
      "import_contract",
      "create_backup",
      "restore_backup"
    ]
  };
}

export function mutationGovernance(): {
  read_only: false;
  agent_can_mutate: false;
  human_approved_mutation: true;
  human_approval_required_for_agent_replay: true;
} {
  return {
    read_only: false,
    agent_can_mutate: false,
    human_approved_mutation: true,
    human_approval_required_for_agent_replay: true
  };
}

export function auditEvent(input: {
  id: string;
  repoId: string;
  actor: string;
  action: AuditEvent["action"];
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}): AuditEvent {
  return {
    id: sanitizeAuditId(input.id),
    repo_id: input.repoId,
    actor: input.actor,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    metadata: input.metadata,
    created_at: input.createdAt
  };
}
