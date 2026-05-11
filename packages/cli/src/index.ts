import type {
  AcceptedConvention,
  AuditEvent,
  ConventionCandidate,
  EnforcementMode,
  RepoContract,
  Severity
} from "@drift/core";
import { openDriftStorage, type SqliteDriftStorage } from "@drift/storage";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const parsed = parseArgs(argv);
    const databasePath = stringFlag(parsed, "db") ?? process.env.DRIFT_DB;
    if (!databasePath) {
      throw new Error("Missing --db <path> or DRIFT_DB.");
    }

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    try {
      const payload = runCommand(storage, parsed);
      return {
        exitCode: 0,
        stdout: formatOutput(payload, parsed),
        stderr: ""
      };
    } finally {
      storage.close();
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? `${error.message}\n` : "Unknown CLI error.\n"
    };
  }
}

function runCommand(storage: SqliteDriftStorage, parsed: ParsedArgs): unknown {
  const [group, command, maybeId] = parsed.positional;

  if (group === "conventions" && command === "list") {
    const repoId = requiredFlag(parsed, "repo");
    const status = stringFlag(parsed, "status");
    return {
      candidates: storage.listConventionCandidates(repoId, status ? { status: status as never } : {})
    };
  }

  if (group === "conventions" && command === "show") {
    const id = requiredValue(maybeId, "candidate id");
    const candidate = requiredCandidate(storage, id);
    return { candidate };
  }

  if (group === "conventions" && command === "accept") {
    const id = requiredValue(maybeId, "candidate id");
    return acceptCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "reject") {
    const id = requiredValue(maybeId, "candidate id");
    return rejectCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "edit") {
    const id = requiredValue(maybeId, "candidate id");
    return editCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "exception" && maybeId === "add") {
    const conventionId = requiredValue(parsed.positional[3], "convention id");
    return addConventionException(storage, parsed, conventionId);
  }

  if (group === "contract" && command === "show") {
    const repoId = requiredFlag(parsed, "repo");
    const contract = storage.getRepoContract(repoId);
    if (!contract) {
      throw new Error(`No repo contract exists for ${repoId}.`);
    }
    return { contract };
  }

  throw new Error(`Unknown command: ${parsed.positional.join(" ")}`);
}

function acceptCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { accepted: AcceptedConvention; contract: RepoContract } {
  const candidate = requiredCandidate(storage, candidateId);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const severity = (stringFlag(parsed, "severity") ?? candidate.suggested_severity) as Severity;
  const mode = (stringFlag(parsed, "mode") ?? candidate.suggested_enforcement_mode) as EnforcementMode;
  const contractId = storage.getRepoContract(candidate.repo_id)?.id ?? contractIdForRepo(candidate.repo_id);
  const convention: AcceptedConvention = {
    id: conventionIdForCandidate(candidate.id),
    contract_id: contractId,
    kind: candidate.kind,
    statement: candidate.statement,
    rationale: candidate.rationale,
    scope: candidate.scope,
    matcher: candidate.matcher,
    severity,
    enforcement_mode: mode,
    enforcement_capability: candidate.enforcement_capability,
    exceptions: [],
    evidence_refs: candidate.evidence_refs,
    counterexample_refs: candidate.counterexample_refs,
    accepted_by: actor,
    accepted_at: now,
    updated_at: now
  };

  storage.upsertAcceptedConvention(candidate.repo_id, convention);
  storage.upsertConventionCandidate({ ...candidate, status: "accepted" });
  const contract = materializeRepoContract(storage, candidate.repo_id, contractId, now);
  storage.upsertRepoContract(contract);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_accept_${candidate.id}_${now}`,
    repoId: candidate.repo_id,
    actor,
    action: "election_accepted",
    targetType: "convention",
    targetId: convention.id,
    metadata: { candidate_id: candidate.id },
    createdAt: now
  }));

  return { accepted: convention, contract };
}

function rejectCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { candidate: ConventionCandidate } {
  const candidate = requiredCandidate(storage, candidateId);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const reason = requiredFlag(parsed, "reason");
  const rejected = { ...candidate, status: "rejected" as const };

  storage.upsertConventionCandidate(rejected);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_reject_${candidate.id}_${now}`,
    repoId: candidate.repo_id,
    actor,
    action: "election_rejected",
    targetType: "candidate",
    targetId: candidate.id,
    metadata: { reason },
    createdAt: now
  }));

  return { candidate: rejected };
}

function editCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { candidate: ConventionCandidate } {
  const candidate = requiredCandidate(storage, candidateId);
  const statement = stringFlag(parsed, "statement");
  const updated = {
    ...candidate,
    statement: statement ?? candidate.statement
  };

  storage.upsertConventionCandidate(updated);
  return { candidate: updated };
}

function addConventionException(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  conventionId: string
): { convention: AcceptedConvention; contract: RepoContract } {
  const repoId = requiredFlag(parsed, "repo");
  const path = requiredFlag(parsed, "path");
  const reason = requiredFlag(parsed, "reason");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const convention = storage
    .listAcceptedConventions(repoId)
    .find((accepted) => accepted.id === conventionId);
  if (!convention) {
    throw new Error(`Accepted convention not found: ${conventionId}`);
  }

  const updated: AcceptedConvention = {
    ...convention,
    exceptions: [
      ...convention.exceptions,
      {
        id: exceptionIdForConvention(conventionId, path),
        reason,
        path_globs: [path],
        created_by: actor,
        created_at: now
      }
    ],
    updated_at: now
  };

  storage.upsertAcceptedConvention(repoId, updated);
  const contract = materializeRepoContract(storage, repoId, updated.contract_id, now);
  storage.upsertRepoContract(contract);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_exception_${conventionId}_${now}`,
    repoId,
    actor,
    action: "policy_changed",
    targetType: "convention_exception",
    targetId: updated.exceptions.at(-1)?.id ?? conventionId,
    metadata: { convention_id: conventionId, path, reason },
    createdAt: now
  }));

  return { convention: updated, contract };
}

function materializeRepoContract(
  storage: SqliteDriftStorage,
  repoId: string,
  contractId: string,
  now: string
): RepoContract {
  const existing = storage.getRepoContract(repoId);
  const repo = storage.getRepo(repoId);
  if (!repo && !existing) {
    throw new Error(`Unknown repo ${repoId}.`);
  }

  return {
    id: contractId,
    repo_id: repoId,
    contract_schema_version: existing?.contract_schema_version ?? 1,
    repo_fingerprint: repo?.fingerprint ?? existing?.repo_fingerprint ?? "unknown",
    created_at: existing?.created_at ?? now,
    updated_at: now,
    conventions: storage.listAcceptedConventions(repoId),
    rejected_inferences: existing?.rejected_inferences ?? [],
    waivers: existing?.waivers ?? [],
    risky_areas: existing?.risky_areas ?? [],
    safe_commands: existing?.safe_commands ?? [],
    required_checks: existing?.required_checks ?? [],
    context_egress: existing?.context_egress ?? {
      default_mode: "local_only",
      denied_globs: [".env*", "**/*.pem", "**/*.key", "**/*.crt"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: existing?.agent_permissions ?? []
  };
}

function requiredCandidate(storage: SqliteDriftStorage, id: string): ConventionCandidate {
  const candidate = storage.getConventionCandidate(id);
  if (!candidate) {
    throw new Error(`Convention candidate not found: ${id}`);
  }
  return candidate;
}

function auditEvent(input: {
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

function formatOutput(payload: unknown, parsed: ParsedArgs): string {
  if (parsed.flags.has("json")) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  return `${JSON.stringify(payload)}\n`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }

  return { positional, flags };
}

function requiredFlag(parsed: ParsedArgs, key: string): string {
  return requiredValue(stringFlag(parsed, key), `--${key}`);
}

function stringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function requiredValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function conventionIdForCandidate(candidateId: string): string {
  return candidateId.startsWith("candidate_")
    ? `convention_${candidateId.slice("candidate_".length)}`
    : `convention_${candidateId}`;
}

function contractIdForRepo(repoId: string): string {
  return repoId.startsWith("repo_") ? `contract_${repoId.slice("repo_".length)}` : `contract_${repoId}`;
}

function exceptionIdForConvention(conventionId: string, path: string): string {
  return `waiver_${sanitizeAuditId(`${conventionId}_${path}`)}`;
}

function sanitizeAuditId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}
