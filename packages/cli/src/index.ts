import type {
  AcceptedConvention,
  AuditEvent,
  ConventionCandidate,
  EnforcementMode,
  FactRecord,
  FileSnapshot,
  Finding,
  FindingDiffStatus,
  FindingStatus,
  RepoRecord,
  RepoContract,
  ScanManifest,
  Severity
} from "@drift/core";
import { openDriftStorage, type SqliteDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

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
      return { exitCode: 0, stdout: helpText(parsed), stderr: "" };
    }

    const databasePath = resolveDatabasePath(parsed);
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

  if (group === "init") {
    return initRepo(storage, parsed);
  }

  if (group === "scan") {
    return scanRepo(storage, parsed);
  }

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

  if (group === "baseline" && command === "create") {
    return createBaseline(storage, parsed);
  }

  if (group === "baseline" && command === "status") {
    return baselineStatus(storage, parsed);
  }

  if (group === "baseline" && command === "clear") {
    return clearBaseline(storage, parsed);
  }

  throw new Error(`Unknown command: ${parsed.positional.join(" ")}. Run drift --help.`);
}

function initRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo: RepoRecord;
  database_path: string;
} {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repoRoot = resolveRepoRoot(parsed);
  const repo = repoRecordForRoot(repoRoot, now);
  storage.upsertRepo(repo);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_repo_added_${repo.id}_${now}`,
    repoId: repo.id,
    actor: stringFlag(parsed, "actor") ?? "local-user",
    action: "repo_added",
    targetType: "repo",
    targetId: repo.id,
    metadata: { root_path: repoRoot },
    createdAt: now
  }));

  return {
    repo,
    database_path: requiredDatabasePath(parsed)
  };
}

function scanRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo: RepoRecord;
  scan: ScanManifest;
  candidates: ConventionCandidate[];
  summary: {
    files_indexed: number;
    facts_count: number;
    candidates_count: number;
  };
  database_path: string;
} {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repoRoot = resolveRepoRoot(parsed);
  const repo = repoRecordForRoot(repoRoot, now);
  storage.upsertRepo(repo);

  const files = walkIndexableFiles(repoRoot);
  const scanId = `scan_${hashStable(`${repo.id}:${now}`).slice(0, 16)}`;
  const facts = files.flatMap((filePath) =>
    extractFactsFromFile({
      repoId: repo.id,
      scanId,
      repoRoot,
      filePath
    })
  );
  const snapshots = files.map((filePath) =>
    fileSnapshotForFile({ repoId: repo.id, scanId, repoRoot, filePath })
  );
  const candidates = inferConventionCandidates({
    repoId: repo.id,
    scanId,
    facts,
    now
  });
  const scan: ScanManifest = {
    id: scanId,
    repo_id: repo.id,
    branch: gitOutput(repoRoot, ["branch", "--show-current"]) || "unknown",
    commit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
    dirty: Boolean(gitOutput(repoRoot, ["status", "--porcelain"])),
    scanner_version: "0.1.0",
    adapter_versions: { typescript: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed",
    file_count: files.length,
    fact_count: facts.length,
    finding_count: 0,
    started_at: now,
    completed_at: now
  };

  storage.upsertScanManifest(scan);
  for (const snapshot of snapshots) {
    storage.upsertFileSnapshot(snapshot);
  }
  storage.upsertFacts(facts);
  for (const candidate of candidates) {
    storage.upsertConventionCandidate(candidate);
  }
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_scan_completed_${repo.id}_${scanId}`,
    repoId: repo.id,
    actor: stringFlag(parsed, "actor") ?? "local-user",
    action: "scan_completed",
    targetType: "scan",
    targetId: scanId,
    metadata: {
      files_indexed: files.length,
      facts_count: facts.length,
      candidates_count: candidates.length
    },
    createdAt: now
  }));

  return {
    repo,
    scan,
    candidates,
    summary: {
      files_indexed: files.length,
      facts_count: facts.length,
      candidates_count: candidates.length
    },
    database_path: requiredDatabasePath(parsed)
  };
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

function createBaseline(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  created_count: number;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
} {
  const repoId = requiredFlag(parsed, "repo");
  const from = requiredFlag(parsed, "from");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }

  const scanId = `scan_baseline_${sanitizeAuditId(now)}`;
  storage.upsertScanManifest(baselineScanManifest({
    id: scanId,
    repoId,
    from,
    now,
    findingCount: storage.listFindings(repoId).length
  }));

  let createdCount = 0;
  for (const finding of storage.listFindings(repoId)) {
    if (finding.status === "fixed" || finding.status === "false_positive") {
      continue;
    }

    storage.upsertBaselineViolation({
      id: `baseline_${finding.fingerprint.slice(0, 16)}`,
      repo_id: repoId,
      convention_id: finding.convention_id,
      finding_fingerprint: finding.fingerprint,
      file_path: finding.evidence_refs[0]?.file_path ?? inferFilePathFromMessage(finding.message),
      first_seen_scan_id: scanId,
      first_seen_commit: from,
      status: "active",
      created_at: now
    });
    createdCount += 1;
  }

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_baseline_create_${repoId}_${now}`,
    repoId,
    actor,
    action: "baseline_created",
    targetType: "baseline",
    targetId: scanId,
    metadata: { from, created_count: createdCount },
    createdAt: now
  }));

  return {
    created_count: createdCount,
    baseline: storage.listBaselineViolations(repoId)
  };
}

function baselineStatus(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo_id: string;
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
  const repoId = requiredFlag(parsed, "repo");
  const rows = storage.listBaselineViolations(repoId);
  const byConvention = new Map<string, { active_count: number; resolved_count: number }>();

  for (const row of rows) {
    const counts = byConvention.get(row.convention_id) ?? { active_count: 0, resolved_count: 0 };
    if (row.status === "active") {
      counts.active_count += 1;
    } else {
      counts.resolved_count += 1;
    }
    byConvention.set(row.convention_id, counts);
  }

  return {
    repo_id: repoId,
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };
}

function clearBaseline(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  resolved_count: number;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
} {
  const repoId = requiredFlag(parsed, "repo");
  const conventionId = requiredFlag(parsed, "convention");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  let resolvedCount = 0;

  for (const row of storage.listBaselineViolations(repoId)) {
    if (row.convention_id !== conventionId || row.status !== "active") {
      continue;
    }

    storage.upsertBaselineViolation({ ...row, status: "resolved" });
    resolvedCount += 1;
  }

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_baseline_clear_${repoId}_${conventionId}_${now}`,
    repoId,
    actor,
    action: "baseline_cleared",
    targetType: "baseline",
    targetId: conventionId,
    metadata: { convention_id: conventionId, resolved_count: resolvedCount },
    createdAt: now
  }));

  return {
    resolved_count: resolvedCount,
    baseline: storage.listBaselineViolations(repoId)
  };
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

function resolveDatabasePath(parsed: ParsedArgs): string | undefined {
  const explicit = stringFlag(parsed, "db") ?? process.env.DRIFT_DB;
  if (explicit) {
    return explicit;
  }

  if (parsed.positional[0] === "init" || parsed.positional[0] === "scan") {
    return defaultDatabasePath(resolveRepoRoot(parsed), parsed);
  }

  return undefined;
}

function requiredDatabasePath(parsed: ParsedArgs): string {
  return requiredValue(resolveDatabasePath(parsed), "database path");
}

function resolveRepoRoot(parsed: ParsedArgs): string {
  return resolve(stringFlag(parsed, "repo-root") ?? process.cwd());
}

function defaultDatabasePath(repoRoot: string, parsed: ParsedArgs): string {
  const stateRoot = resolve(
    stringFlag(parsed, "state-root") ??
      process.env.DRIFT_STATE_ROOT ??
      join(homedir(), ".drift", "repos")
  );
  const repoId = repoIdForRoot(repoRoot);
  const dir = join(stateRoot, repoId);
  mkdirSync(dir, { recursive: true });
  return join(dir, "drift.sqlite");
}

function repoRecordForRoot(repoRoot: string, now: string): RepoRecord {
  return {
    id: repoIdForRoot(repoRoot),
    root_path: repoRoot,
    fingerprint: hashStable(repoRoot),
    created_at: now,
    updated_at: now
  };
}

function repoIdForRoot(repoRoot: string): string {
  return `repo_${hashStable(resolve(repoRoot)).slice(0, 16)}`;
}

function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function walkIndexableFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipPath(entry.name)) {
        continue;
      }

      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && isTypescriptPath(entry.name)) {
        files.push(relative(repoRoot, absolutePath).replaceAll("\\", "/"));
      }
    }
  };
  visit(repoRoot);
  return files.sort();
}

function shouldSkipPath(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "target",
    "vendor"
  ].includes(name);
}

function isTypescriptPath(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

function extractFactsFromFile(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
  filePath: string;
}): FactRecord[] {
  const source = readFileSync(join(input.repoRoot, input.filePath), "utf8");
  const facts: FactRecord[] = [
    factRecord(input, "file_detected", basename(input.filePath), undefined, 1, 1)
  ];

  if (isApiRoutePath(input.filePath)) {
    facts.push(factRecord(input, "file_role_detected", "api_route", undefined, 1, 1));
  }

  for (const importUsed of extractImports(source)) {
    facts.push(
      factRecord(
        input,
        "import_used",
        importUsed.name,
        importUsed.source,
        importUsed.line,
        importUsed.line
      )
    );
  }

  return facts;
}

function factRecord(
  input: { repoId: string; scanId: string; filePath: string },
  kind: FactRecord["kind"],
  name: string,
  value: string | undefined,
  startLine: number,
  endLine: number
): FactRecord {
  const id = `fact_${hashStable(`${input.scanId}:${input.filePath}:${kind}:${name}:${value ?? ""}:${startLine}`).slice(0, 16)}`;
  return {
    id,
    repo_id: input.repoId,
    scan_id: input.scanId,
    kind,
    file_path: input.filePath,
    name,
    value,
    start_line: startLine,
    end_line: endLine
  };
}

function fileSnapshotForFile(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
  filePath: string;
}): FileSnapshot {
  const absolutePath = join(input.repoRoot, input.filePath);
  const source = readFileSync(absolutePath);
  return {
    repo_id: input.repoId,
    scan_id: input.scanId,
    file_path: input.filePath,
    content_hash: createHash("sha256").update(source).digest("hex"),
    byte_size: statSync(absolutePath).size,
    indexed: true
  };
}

function inferConventionCandidates(input: {
  repoId: string;
  scanId: string;
  facts: FactRecord[];
  now: string;
}): ConventionCandidate[] {
  const apiRouteFiles = new Set(
    input.facts
      .filter((fact) => fact.kind === "file_role_detected" && fact.name === "api_route")
      .map((fact) => fact.file_path)
  );
  const dataImports = input.facts.filter((fact) =>
    fact.kind === "import_used" &&
    apiRouteFiles.has(fact.file_path) &&
    fact.value &&
    looksLikeDataAccessImport(fact.value)
  );

  if (dataImports.length === 0) {
    return [];
  }

  const forbiddenImports = [...new Set(dataImports.map((fact) => fact.value).filter(Boolean))] as string[];
  return [{
    id: `candidate_${hashStable(`${input.repoId}:api_route_no_direct_data_access:${forbiddenImports.join(",")}`).slice(0, 16)}`,
    repo_id: input.repoId,
    scan_id: input.scanId,
    kind: "api_route_no_direct_data_access",
    statement: "API routes should not import data-access clients directly.",
    rationale: "Detected API route imports that look like database/data-access clients.",
    scope: {
      path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
      file_roles: ["api_route"]
    },
    matcher: {
      kind: "api_route_no_direct_data_access",
      forbidden_imports: forbiddenImports,
      applies_to_file_roles: ["api_route"]
    },
    suggested_severity: "error",
    suggested_enforcement_mode: "block",
    enforcement_capability: "deterministic_check",
    confidence_label: "high",
    scoring: {
      supporting_examples_count: dataImports.length,
      counterexamples_count: 0,
      scope_files_count: apiRouteFiles.size,
      coverage_ratio: apiRouteFiles.size === 0 ? 0 : dataImports.length / apiRouteFiles.size,
      heuristic_id: "direct-data-access-import-v1"
    },
    evidence_refs: [],
    counterexample_refs: [],
    status: "candidate",
    created_at: input.now
  }];
}

function looksLikeDataAccessImport(importSource: string): boolean {
  return /(^|\/|@)(db|database|prisma|drizzle|typeorm|sequelize)(\/|$)/i.test(importSource);
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
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

function helpText(parsed: ParsedArgs): string {
  if (parsed.positional[0] === "init") {
    return [
      "Create local Drift state",
      "",
      "Usage:",
      "  drift init --repo-root . --json",
      "  drift init --repo-root . --state-root ~/.drift/repos --json",
      "",
      "Notes:",
      "  init creates or opens the local SQLite database and registers the repo.",
      "  without --db, Drift stores state under ~/.drift/repos/<repo_id>/drift.sqlite.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "scan") {
    return [
      "Scan a repo",
      "",
      "Usage:",
      "  drift scan --repo-root . --json",
      "  drift scan --repo-root . --state-root ~/.drift/repos --json",
      "",
      "What scan does:",
      "  registers the repo, snapshots TS/JS files, stores facts, and proposes deterministic convention candidates.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "check") {
    return [
      "Run deterministic checks",
      "",
      "Usage:",
      "  drift --db <path> check --repo <repo_id> --diff main...HEAD --scope changed-hunks --json",
      "  drift --db <path> check --repo <repo_id> --diff-file <patch> --scope changed-hunks --json",
      "",
      "Options:",
      "  --repo <repo_id>       Repo id in Drift storage.",
      "  --diff <range>         Git diff range to evaluate, for example main...HEAD.",
      "  --diff-file <patch>    Read a unified diff from a file.",
      "  --scope changed-hunks  Check only findings on changed lines.",
      "  --scope changed-files  Check findings anywhere in changed files.",
      "  --scope full           Classify all evaluated findings as full-scope.",
      "  --json                 Emit machine-readable JSON.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "conventions") {
    return [
      "Review inferred conventions",
      "",
      "Usage:",
      "  drift --db <path> conventions list --repo <repo_id> --status candidate --json",
      "  drift --db <path> conventions show <candidate_id> --json",
      "  drift --db <path> conventions accept <candidate_id> --severity warning --mode warn --json",
      "  drift --db <path> conventions reject <candidate_id> --reason \"false inference\" --json",
      "  drift --db <path> conventions edit <candidate_id> --statement \"...\" --json",
      "  drift --db <path> conventions exception add <convention_id> --repo <repo_id> --path <glob> --reason \"...\" --json",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "baseline") {
    return [
      "Manage baselines",
      "",
      "Usage:",
      "  drift --db <path> baseline create --repo <repo_id> --from main --json",
      "  drift --db <path> baseline status --repo <repo_id> --json",
      "  drift --db <path> baseline clear --repo <repo_id> --convention <convention_id> --json",
      "",
      "Notes:",
      "  create baselines currently stored findings so existing violations do not block future checks.",
      "  clear marks matching baseline rows resolved; it does not delete history.",
      ""
    ].join("\n");
  }

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
    "  drift baseline create --repo <repo_id> --from main --json",
    "  drift baseline status --repo <repo_id> --json",
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

function baselineScanManifest(input: {
  id: string;
  repoId: string;
  from: string;
  now: string;
  findingCount: number;
}): ScanManifest {
  return {
    id: input.id,
    repo_id: input.repoId,
    branch: input.from,
    commit: input.from,
    dirty: false,
    scanner_version: "0.1.0",
    adapter_versions: { baseline: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed",
    file_count: 0,
    fact_count: 0,
    finding_count: input.findingCount,
    started_at: input.now,
    completed_at: input.now
  };
}

function inferFilePathFromMessage(message: string): string {
  return message.split(" imports ")[0] || "unknown";
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
