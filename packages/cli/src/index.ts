import type {
  AcceptedConvention,
  AuditEvent,
  ConventionCandidate,
  EnforcementMode,
  Finding,
  FindingDiffStatus,
  FindingStatus,
  RepoContract,
  Severity
} from "@drift/core";
import { openDriftStorage, type SqliteDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

interface CommandPayload {
  payload: unknown;
  exitCode?: number;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const parsed = parseArgs(argv);
    if (isHelpRequest(parsed)) {
      return { exitCode: 0, stdout: helpText(), stderr: "" };
    }

    const databasePath = stringFlag(parsed, "db") ?? process.env.DRIFT_DB;
    if (!databasePath) {
      throw new Error("Missing --db <path> or DRIFT_DB. Run drift --help.");
    }

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    try {
      const result = normalizeCommandResult(runCommand(storage, parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
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

function runCommand(storage: SqliteDriftStorage, parsed: ParsedArgs): unknown | CommandPayload {
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

  if (group === "findings" && command === "list") {
    const repoId = requiredFlag(parsed, "repo");
    return { findings: storage.listFindings(repoId) };
  }

  if (group === "check") {
    return runCheck(storage, parsed);
  }

  throw new Error(`Unknown command: ${parsed.positional.join(" ")}. Run drift --help.`);
}

function runCheck(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = requiredFlag(parsed, "repo");
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }

  const scope = stringFlag(parsed, "scope") ?? "changed-hunks";
  if (!["changed-hunks", "changed-files", "full"].includes(scope)) {
    throw new Error("--scope must be changed-hunks, changed-files, or full.");
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const diff = loadDiff(repo.root_path, parsed);
  const parsedDiff = parseUnifiedDiff(diff);
  const baseline = storage.listBaselineViolations(repoId);
  const findings: Finding[] = [];

  for (const convention of contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_capability !== "deterministic_check"
    ) {
      continue;
    }

    const files = filesForConvention(parsedDiff, convention, scope);
    for (const filePath of files) {
      if (!isApiRoutePath(filePath) || isExceptedPath(filePath, convention)) {
        continue;
      }

      const source = readFileSync(join(repo.root_path, filePath), "utf8");
      for (const importUsed of extractImports(source)) {
        if (!isForbiddenImport(importUsed.source, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }

        const diffStatus = diffStatusFor(filePath, importUsed.line, parsedDiff, scope);
        const fingerprint = findingFingerprint(
          convention.id,
          filePath,
          importUsed.name,
          importUsed.source
        );
        const status = baseline.some((entry) =>
          entry.status === "active" &&
          entry.convention_id === convention.id &&
          entry.finding_fingerprint === fingerprint
        ) ? "pre_existing" : "new";
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          fingerprint,
          title: "API route imports data access directly",
          message: `${filePath} imports ${importUsed.name} from ${importUsed.source} directly; route modules should delegate through the accepted service/data-access layer.`,
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status,
          diff_status: diffStatus,
          evidence_refs: [],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }

  const blockingCount = findings.filter((finding) =>
    finding.status === "new" &&
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block"
  ).length;

  return {
    exitCode: blockingCount > 0 ? 1 : 0,
    payload: {
      summary: {
        repo_id: repoId,
        scope,
        findings_count: findings.length,
        blocking_count: blockingCount
      },
      findings
    }
  };
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

function normalizeCommandResult(result: unknown | CommandPayload): CommandPayload {
  if (isCommandPayload(result)) {
    return result;
  }
  return { payload: result };
}

function isCommandPayload(value: unknown): value is CommandPayload {
  return Boolean(value && typeof value === "object" && "payload" in value);
}

function isHelpRequest(parsed: ParsedArgs): boolean {
  return parsed.flags.has("help") || parsed.positional[0] === "help" || parsed.positional.length === 0;
}

function helpText(): string {
  return [
    "Drift local repo intelligence",
    "",
    "Usage:",
    "  drift --db <path> <command> [options]",
    "",
    "Core commands:",
    "  drift check --repo <repo_id> --diff main...HEAD --scope changed-hunks --json",
    "  drift check --repo <repo_id> --diff-file <patch> --scope changed-hunks --json",
    "  drift findings list --repo <repo_id> --json",
    "  drift contract show --repo <repo_id> --json",
    "",
    "Convention review:",
    "  drift conventions list --repo <repo_id> --status candidate --json",
    "  drift conventions show <candidate_id> --json",
    "  drift conventions accept <candidate_id> --severity warning --mode warn --json",
    "  drift conventions reject <candidate_id> --reason \"false inference\" --json",
    "  drift conventions edit <candidate_id> --statement \"...\" --json",
    "  drift conventions exception add <convention_id> --repo <repo_id> --path <glob> --reason \"...\" --json",
    "",
    "Global options:",
    "  --db <path>      SQLite database path. Can also use DRIFT_DB.",
    "  --json           Emit machine-readable JSON.",
    "  --help           Show this help.",
    ""
  ].join("\n");
}

interface ParsedDiff {
  files: Array<{ path: string; changedLines: Set<number> }>;
}

interface ImportUsed {
  name: string;
  source: string;
  line: number;
}

function loadDiff(repoRoot: string, parsed: ParsedArgs): string {
  const diffFile = stringFlag(parsed, "diff-file");
  if (diffFile) {
    return readFileSync(diffFile, "utf8");
  }

  const diffRange = stringFlag(parsed, "diff");
  if (diffRange) {
    return execFileSync("git", ["diff", "--unified=0", diffRange], {
      cwd: repoRoot,
      encoding: "utf8"
    });
  }

  throw new Error("Missing --diff <range> or --diff-file <path>.");
}

function parseUnifiedDiff(input: string): ParsedDiff {
  const files: ParsedDiff["files"] = [];
  let current: ParsedDiff["files"][number] | undefined;
  let newLine: number | undefined;

  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      if (current) {
        files.push(current);
      }
      const path = normalizeDiffPath(line.slice(4));
      current = path ? { path, changedLines: new Set<number>() } : undefined;
      newLine = undefined;
      continue;
    }

    if (line.startsWith("@@ ")) {
      newLine = parseHunkStart(line);
      continue;
    }

    if (!current || newLine === undefined || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.changedLines.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      continue;
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  if (current) {
    files.push(current);
  }
  return { files };
}

function filesForConvention(
  diff: ParsedDiff,
  convention: AcceptedConvention,
  scope: string
): string[] {
  const diffFiles = diff.files.map((file) => file.path);
  const scoped = diffFiles.filter((filePath) =>
    (convention.scope.path_globs.length === 0 ||
      convention.scope.path_globs.some((glob) => matchesGlob(filePath, glob))) &&
    !(convention.scope.exclude_path_globs ?? []).some((glob) => matchesGlob(filePath, glob))
  );

  if (scope === "full") {
    return scoped;
  }
  return scoped;
}

function diffStatusFor(
  filePath: string,
  line: number,
  diff: ParsedDiff,
  scope: string
): FindingDiffStatus {
  if (scope === "full") {
    return "touched_existing";
  }

  const file = diff.files.find((entry) => entry.path === filePath);
  if (!file) {
    return "outside_diff";
  }

  if (scope === "changed-files") {
    return "touched_existing";
  }

  return file.changedLines.has(line) ? "new_in_diff" : "touched_existing";
}

function extractImports(source: string): ImportUsed[] {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const match = line.match(/^\s*import\s+(.+?)\s+from\s+["']([^"']+)["']/);
      if (!match) {
        return [];
      }
      return parseImportNames(match[1]).map((name) => ({
        name,
        source: match[2],
        line: index + 1
      }));
    });
}

function parseImportNames(importClause: string): string[] {
  const named = importClause.match(/\{([^}]+)\}/);
  if (named) {
    return named[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/).at(-1)?.trim())
      .filter((name): name is string => Boolean(name));
  }

  const defaultImport = importClause.split(",")[0]?.trim();
  return defaultImport ? [defaultImport] : ["import"];
}

function isForbiddenImport(importSource: string, forbiddenImports: string[]): boolean {
  return forbiddenImports.some((forbidden) =>
    importSource === forbidden || importSource.includes(forbidden)
  );
}

function isApiRoutePath(filePath: string): boolean {
  return (
    /(^|\/)app\/api\/.+\/route\.[jt]sx?$/.test(filePath) ||
    /(^|\/)pages\/api\/.+\.[jt]sx?$/.test(filePath)
  );
}

function isExceptedPath(filePath: string, convention: AcceptedConvention): boolean {
  return convention.exceptions.some((exception) =>
    (exception.path_globs ?? []).some((glob) => matchesGlob(filePath, glob))
  );
}

function enforcementResultFor(mode: EnforcementMode): Finding["enforcement_result"] {
  if (mode === "block") {
    return "block";
  }
  if (mode === "warn") {
    return "warn";
  }
  return "none";
}

function findingFingerprint(
  conventionId: string,
  filePath: string,
  importName: string,
  importSource: string
): string {
  return createHash("sha256")
    .update("direct-data-access-v1\0")
    .update(conventionId)
    .update("\0")
    .update(filePath.replaceAll("\\", "/"))
    .update("\0")
    .update(importName)
    .update("\0")
    .update(importSource)
    .digest("hex");
}

function normalizeDiffPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed === "/dev/null") {
    return undefined;
  }
  return trimmed.replace(/^[ab]\//, "");
}

function parseHunkStart(line: string): number | undefined {
  const match = line.match(/\+(\d+)(?:,\d+)?/);
  return match ? Number(match[1]) : undefined;
}

function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
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
