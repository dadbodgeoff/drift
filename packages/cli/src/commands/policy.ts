import { authorizeContextExport,createContextPolicyMatrix,type RepoContract } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,agentPermissionFlag,hasAnyFlag,optionalContextDefaultModeFlag,optionalPositiveIntegerFlag,optionalRepoRelativeFlag,requiredFlag,requiredNonEmptyFlag,requiredRepoRelativeFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { auditEvent,preflightGovernance } from "../domain/governance.js";
import { MAX_POLICY_SNIPPET_CHARS,guardedSurfaces,policyContextNextCommands,policyContextSummary,policyShowNextCommands,policyShowSummary,policySurface } from "../domain/policy-context.js";
import { policyFileContext } from "../domain/repo-map.js";
import { requiredRepoContract } from "../domain/repo-paths.js";
import { assertFreshScanIfRequired,freshnessRequirement,readinessForStoredScan,scanStatusPayload } from "../domain/scan-status.js";
import { formatPolicyDecisionText,formatPolicyShowText } from "../formatters/policy.js";

export function showPolicy(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const payload = {
    response_schema: "drift.policy.show.v1",
    repo_id: repoId,
    governance: preflightGovernance(),
    summary: policyShowSummary(contract),
    policy: {
      context_egress: contract.context_egress,
      agent_permissions: contract.agent_permissions
    },
    guarded_surfaces: guardedSurfaces(),
    next_commands: policyShowNextCommands(repoId)
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyShowText(payload)
  };
}

export function checkPolicyContext(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contextPath = requiredRepoRelativeFlag(parsed, "path");
  const surface = policySurface(requiredFlag(parsed, "surface"));
  const requestedSnippetChars = optionalPositiveIntegerFlag(parsed, "snippet-chars");
  const requestFullFileContent = parsed.flags.has("full-file");
  const requireFresh = parsed.flags.has("require-fresh");
  if (requestFullFileContent && requestedSnippetChars !== undefined) {
    throw new Error("Use either --full-file or --snippet-chars, not both.");
  }
  const contract = requiredRepoContract(storage, repoId);
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, requireFresh);
  const readiness = readinessForStoredScan(storage, repoId, scanStatus.latest_scan?.id ?? null, "allowed_context");
  const freshness = freshnessRequirement(requireFresh, scanStatus);
  const fileContext = policyFileContext(storage, repoId, contextPath, contract);
  const decision = authorizeContextExport(contract, surface, {
    path: contextPath,
    requested_snippet_chars: requestedSnippetChars,
    request_full_file_content: requestFullFileContent
  });
  const contextPolicy = createContextPolicyMatrix(contract, decision);
  const payload = {
    response_schema: "drift.allowed-context.v1",
    repo_id: repoId,
    path: contextPath,
    request: {
      path: contextPath,
      surface,
      requested_snippet_chars: requestedSnippetChars ?? null,
      request_full_file_content: requestFullFileContent,
      require_fresh: requireFresh
    },
    contract: {
      ready: true,
      id: contract.id,
      source: "accepted_contract"
    },
    readiness,
    governance: preflightGovernance(),
    scan_status: scanStatus,
    freshness_requirement: freshness,
    file_context: fileContext,
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      allow_full_file_content: contract.context_egress.allow_full_file_content,
      max_snippet_chars: contract.context_egress.max_snippet_chars
    },
    summary: policyContextSummary({
      decision,
      fileContext,
      freshness,
      deniedGlobCount: contract.context_egress.denied_globs.length
    }),
    decision,
    context_policy: contextPolicy,
    next_commands: policyContextNextCommands(repoId, contextPath, decision)
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyDecisionText(payload),
    exitCode: decision.allowed ? 0 : 1
  };
}

export function setEgressPolicy(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  if (!parsed.flags.has("confirm")) {
    throw new Error("Policy changes require --confirm.");
  }
  if (parsed.flags.has("allow-full-file-content") && parsed.flags.has("deny-full-file-content")) {
    throw new Error("Use either --allow-full-file-content or --deny-full-file-content, not both.");
  }
  if (!hasAnyFlag(parsed, [
    "default-mode",
    "max-snippet-chars",
    "deny-glob",
    "allow-full-file-content",
    "deny-full-file-content"
  ])) {
    throw new Error("Policy changes require at least one egress option.");
  }

  const repoId = resolveRepoId(parsed);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const current = contract.context_egress;
  const defaultMode = optionalContextDefaultModeFlag(parsed, "default-mode") ?? current.default_mode;
  const maxSnippetChars = optionalPositiveIntegerFlag(parsed, "max-snippet-chars") ?? current.max_snippet_chars;
  if (maxSnippetChars > MAX_POLICY_SNIPPET_CHARS) {
    throw new Error(`--max-snippet-chars must be less than or equal to ${MAX_POLICY_SNIPPET_CHARS}.`);
  }
  const denyGlob = optionalRepoRelativeFlag(parsed, "deny-glob");
  const allowFullFileContent = parsed.flags.has("allow-full-file-content")
    ? true
    : parsed.flags.has("deny-full-file-content")
      ? false
      : current.allow_full_file_content;
  const deniedGlobs = denyGlob
    ? [...new Set([...current.denied_globs, denyGlob])]
    : current.denied_globs;
  const nextPolicy = {
    default_mode: defaultMode,
    denied_globs: deniedGlobs,
    max_snippet_chars: maxSnippetChars,
    allow_full_file_content: allowFullFileContent
  };
  const changedFields = [
    current.default_mode !== nextPolicy.default_mode ? "default_mode" : undefined,
    current.max_snippet_chars !== nextPolicy.max_snippet_chars ? "max_snippet_chars" : undefined,
    current.allow_full_file_content !== nextPolicy.allow_full_file_content ? "allow_full_file_content" : undefined,
    JSON.stringify(current.denied_globs) !== JSON.stringify(nextPolicy.denied_globs) ? "denied_globs" : undefined
  ].filter((field): field is string => Boolean(field));
  if (changedFields.length === 0) {
    const payload = {
      repo_id: repoId,
      contract_id: contract.id,
      policy: {
        context_egress: current,
        agent_permissions: contract.agent_permissions
      },
      changed_fields: changedFields
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
        repo_id: repoId,
        policy: payload.policy,
        guarded_surfaces: guardedSurfaces()
      })
    };
  }
  const updatedContract: RepoContract = {
    ...contract,
    context_egress: nextPolicy,
    updated_at: now
  };

  storage.upsertRepoContract(updatedContract);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_policy_egress_${repoId}_${now}`,
    repoId,
    actor,
    action: "policy_changed",
    targetType: "policy",
    targetId: `${contract.id}:context_egress`,
    metadata: {
      changed_fields: changedFields
    },
    createdAt: now
  }));

  const payload = {
    repo_id: repoId,
    contract_id: contract.id,
    policy: {
      context_egress: nextPolicy,
      agent_permissions: updatedContract.agent_permissions
    },
    changed_fields: changedFields
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
      repo_id: repoId,
      policy: payload.policy,
      guarded_surfaces: guardedSurfaces()
    })
  };
}

export function grantAgentPermission(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  if (!parsed.flags.has("confirm")) {
    throw new Error("Agent permission changes require --confirm.");
  }

  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const agent = requiredNonEmptyFlag(parsed, "agent");
  const permission = agentPermissionFlag(parsed, "permission");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const existing = contract.agent_permissions.find((entry) => entry.agent === agent);
  const nextPermissions = existing
    ? [...new Set([...existing.permissions, permission])]
    : [permission];
  const changedFields = existing && existing.permissions.includes(permission)
    ? []
    : ["agent_permissions"];
  if (changedFields.length === 0) {
    const payload = {
      repo_id: repoId,
      contract_id: contract.id,
      policy: {
        context_egress: contract.context_egress,
        agent_permissions: contract.agent_permissions
      },
      changed_fields: changedFields
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
        repo_id: repoId,
        policy: payload.policy,
        guarded_surfaces: guardedSurfaces()
      })
    };
  }
  const agentPermissions = existing
    ? contract.agent_permissions.map((entry) =>
        entry.agent === agent ? { ...entry, permissions: nextPermissions } : entry
      )
    : [...contract.agent_permissions, { agent, permissions: nextPermissions }];
  const updatedContract: RepoContract = {
    ...contract,
    agent_permissions: agentPermissions,
    updated_at: now
  };

  storage.upsertRepoContract(updatedContract);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_agent_permission_${repoId}_${agent}_${permission}_${now}`,
    repoId,
    actor,
    action: "agent_permission_changed",
    targetType: "agent_permission",
    targetId: agent,
    metadata: {
      permission,
      permissions: nextPermissions
    },
    createdAt: now
  }));

  const payload = {
    repo_id: repoId,
    contract_id: contract.id,
    policy: {
      context_egress: updatedContract.context_egress,
      agent_permissions: updatedContract.agent_permissions
    },
    changed_fields: changedFields
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
      repo_id: repoId,
      policy: payload.policy,
      guarded_surfaces: guardedSurfaces()
    })
  };
}

export function revokeAgentPermission(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  if (!parsed.flags.has("confirm")) {
    throw new Error("Agent permission changes require --confirm.");
  }

  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const agent = requiredNonEmptyFlag(parsed, "agent");
  const revokeAll = parsed.flags.has("all");
  if (revokeAll && parsed.flags.has("permission")) {
    throw new Error("Use either --all or --permission, not both.");
  }
  const permission = revokeAll ? undefined : agentPermissionFlag(parsed, "permission");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const existing = contract.agent_permissions.find((entry) => entry.agent === agent);
  if (!existing || (!revokeAll && !existing.permissions.includes(permission!))) {
    const payload = {
      repo_id: repoId,
      contract_id: contract.id,
      policy: {
        context_egress: contract.context_egress,
        agent_permissions: contract.agent_permissions
      },
      changed_fields: [] as string[]
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
        repo_id: repoId,
        policy: payload.policy,
        guarded_surfaces: guardedSurfaces()
      })
    };
  }

  const remainingPermissions = revokeAll
    ? []
    : existing.permissions.filter((entry) => entry !== permission);
  const agentPermissions = remainingPermissions.length > 0
    ? contract.agent_permissions.map((entry) =>
        entry.agent === agent ? { ...entry, permissions: remainingPermissions } : entry
      )
    : contract.agent_permissions.filter((entry) => entry.agent !== agent);
  const updatedContract: RepoContract = {
    ...contract,
    agent_permissions: agentPermissions,
    updated_at: now
  };

  storage.upsertRepoContract(updatedContract);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_agent_permission_revoke_${repoId}_${agent}_${revokeAll ? "all" : permission}_${now}`,
    repoId,
    actor,
    action: "agent_permission_changed",
    targetType: "agent_permission",
    targetId: agent,
    metadata: {
      permission,
      revoked_all: revokeAll,
      revoked: true,
      permissions: remainingPermissions
    },
    createdAt: now
  }));

  const payload = {
    repo_id: repoId,
    contract_id: contract.id,
    policy: {
      context_egress: updatedContract.context_egress,
      agent_permissions: updatedContract.agent_permissions
    },
    changed_fields: ["agent_permissions"]
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyShowText({
      repo_id: repoId,
      policy: payload.policy,
      guarded_surfaces: guardedSurfaces()
    })
  };
}
