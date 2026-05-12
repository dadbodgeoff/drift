import type {
  AcceptedConvention,
  AuditEvent,
  ConventionCandidate,
  ConventionScope,
  ConventionStatus,
  EnforcementMode,
  FactRecord,
  FileSnapshot,
  Finding,
  FindingDiffStatus,
  FindingStatus,
  PolicyDecision,
  RepoRecord,
  RepoContract,
  ScanManifest,
  Severity
} from "@drift/core";
import {
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION,
  ConventionScopeSchema,
  RepoContractSchema,
  authorizeContextExport
} from "@drift/core";
import { openDriftStorage, type SqliteDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

interface ScanData {
  files: string[];
  facts: FactRecord[];
  snapshots: FileSnapshot[];
  engineSource: "rust" | "typescript";
}

interface RustEngineScanOutput {
  engine_version: string;
  files: Array<{
    file_path: string;
    content_hash: string;
    byte_size: number;
  }>;
  facts: Array<{
    kind: FactRecord["kind"];
    file_path: string;
    name: string;
    value?: string;
    start_line: number;
    end_line: number;
  }>;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const parsed = parseArgs(argv);
    if (isHelpRequest(parsed)) {
      return { exitCode: 0, stdout: helpText(parsed), stderr: "" };
    }

    if (parsed.positional[0] === "doctor") {
      const result = normalizeCommandResult(doctorRepo(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    }

    if (parsed.positional[0] === "restore") {
      const result = normalizeCommandResult(restoreBackup(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    }

    if (parsed.positional[0] === "backup" && parsed.positional[1] === "verify") {
      const result = normalizeCommandResult(verifyBackup(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
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

  if (group === "scan" && command === "status") {
    return scanStatus(storage, parsed);
  }

  if (group === "init") {
    return initRepo(storage, parsed);
  }

  if (group === "scan") {
    return scanRepo(storage, parsed);
  }

  if (group === "start") {
    return startRepo(storage, parsed);
  }

  if (group === "prepare") {
    return prepareTask(storage, parsed);
  }

  if (group === "checks" && command === "list") {
    return listChecks(storage, parsed);
  }

  if (group === "policy" && command === "show") {
    return showPolicy(storage, parsed);
  }

  if (group === "policy" && command === "check-context") {
    return checkPolicyContext(storage, parsed);
  }

  if (group === "policy" && command === "set-egress") {
    return setEgressPolicy(storage, parsed);
  }

  if (group === "policy" && command === "agent" && maybeId === "grant") {
    return grantAgentPermission(storage, parsed);
  }

  if (group === "conventions" && command === "list") {
    const repoId = resolveRepoId(parsed);
    requiredRepo(storage, repoId);
    const status = optionalConventionStatusFlag(parsed, "status");
    return {
      candidates: storage.listConventionCandidates(repoId, status ? { status } : {})
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
    return showContract(storage, parsed);
  }

  if (group === "contract" && command === "validate") {
    return validateContract(storage, parsed);
  }

  if (group === "contract" && command === "export") {
    return exportContract(storage, parsed);
  }

  if (group === "contract" && command === "import") {
    return importContractDryRun(storage, parsed, requiredValue(maybeId, "contract path"));
  }

  if (group === "findings" && command === "list") {
    return listFindings(storage, parsed);
  }

  if (group === "findings" && command === "mark-fixed") {
    const findingId = requiredValue(maybeId, "finding id");
    return markFindingFixed(storage, parsed, findingId);
  }

  if (group === "findings" && command === "suppress") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "suppressed");
  }

  if (group === "findings" && command === "accept-drift") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "accepted_drift");
  }

  if (group === "findings" && command === "mark-false-positive") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "false_positive");
  }

  if (group === "audit" && command === "list") {
    return listAudit(storage, parsed);
  }

  if (group === "backup" && command === "create") {
    return createBackup(storage, parsed);
  }

  if (group === "backup" && command === "list") {
    return listBackups(storage, parsed);
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

interface ScanStatusChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface RestoreStaleness {
  graph_stale: boolean;
  source_changes: ScanStatusChangeSet;
  staleness_reason: "none" | "repo_root_missing" | "scan_missing";
}

interface RestoreRescanGuidance {
  requires_rescan: boolean;
  next_command: string | null;
}

interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function doctorRepo(parsed: ParsedArgs): CommandPayload {
  const repoRoot = resolveRepoRoot(parsed);
  const repoExists = existsSync(repoRoot);
  const files = repoExists ? walkIndexableFiles(repoRoot) : [];
  const apiRouteCount = files.filter(isApiRoutePath).length;
  const gitInside = repoExists && gitOutput(repoRoot, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const branch = gitInside ? gitOutput(repoRoot, ["branch", "--show-current"]) || "detached" : "unknown";
  const commit = gitInside ? gitOutput(repoRoot, ["rev-parse", "--short", "HEAD"]) || "unknown" : "unknown";
  const databasePath = defaultDatabasePath(repoRoot, parsed, { createDir: false });
  const stateExists = existsSync(databasePath);
  const checks: DoctorCheck[] = [
    {
      id: "repo_root",
      label: "Repo root",
      status: repoExists ? "ok" : "fail",
      detail: repoExists ? repoRoot : `${repoRoot} does not exist`
    },
    {
      id: "git",
      label: "Git repo",
      status: gitInside ? "ok" : "warn",
      detail: gitInside ? `${branch} @ ${commit}` : "not inside a Git worktree"
    },
    {
      id: "package_manifest",
      label: "Package manifest",
      status: repoExists && existsSync(join(repoRoot, "package.json")) ? "ok" : "warn",
      detail: repoExists && existsSync(join(repoRoot, "package.json"))
        ? "package.json found"
        : "package.json not found at repo root"
    },
    {
      id: "typescript_files",
      label: "TS/JS files",
      status: files.length > 0 ? "ok" : "warn",
      detail: `${files.length} indexable file${files.length === 1 ? "" : "s"}`
    },
    {
      id: "api_routes",
      label: "API routes",
      status: apiRouteCount > 0 ? "ok" : "warn",
      detail: `${apiRouteCount} API route file${apiRouteCount === 1 ? "" : "s"}`
    },
    {
      id: "local_state",
      label: "Local state",
      status: stateExists ? "ok" : "warn",
      detail: stateExists ? `existing database at ${databasePath}` : `will create ${databasePath}`
    }
  ];
  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const status = failed > 0 ? "fail" : warnings > 0 ? "warn" : "ok";
  const nextCommand = `drift start --repo-root ${repoRoot} --accept-defaults`;
  const text = [
    "Drift doctor",
    "",
    `Repo: ${repoRoot}`,
    `State: ${databasePath}`,
    "",
    ...checks.map((check) => `${doctorSymbol(check.status)} ${check.label}: ${check.detail}`),
    "",
    status === "fail"
      ? "Fix the failed check before running the first scan."
      : "Next command:",
    status === "fail" ? "" : `  ${nextCommand}`,
    ""
  ].join("\n");

  return {
    payload: parsed.flags.has("json")
      ? {
          status,
          repo_root: repoRoot,
          database_path: databasePath,
          checks,
          next_command: status === "fail" ? null : nextCommand
        }
      : text
  };
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
    engine_source: "rust" | "typescript";
  };
  database_path: string;
} {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repoRoot = resolveRepoRoot(parsed);
  const repo = repoRecordForRoot(repoRoot, now);
  storage.upsertRepo(repo);
  const previousScan = storage.listScanManifests(repo.id).find((scan) => scan.status === "completed");

  const scanId = `scan_${hashStable(`${repo.id}:${now}`).slice(0, 16)}`;
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_scan_started_${repo.id}_${scanId}`,
    repoId: repo.id,
    actor,
    action: "scan_started",
    targetType: "scan",
    targetId: scanId,
    metadata: {
      repo_root: repoRoot,
      previous_scan_id: previousScan?.id ?? null
    },
    createdAt: now
  }));
  try {
    const scanData = collectScanData({ repoId: repo.id, scanId, repoRoot });
    const candidates = inferConventionCandidates({
      repoId: repo.id,
      scanId,
      repoRoot,
      facts: scanData.facts,
      now
    });
    const scan: ScanManifest = {
      id: scanId,
      repo_id: repo.id,
      branch: gitOutput(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(repoRoot, ["status", "--porcelain"])),
      previous_scan_id: previousScan?.id,
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: { typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION },
      rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
      status: "completed",
      file_count: scanData.files.length,
      fact_count: scanData.facts.length,
      finding_count: 0,
      started_at: now,
      completed_at: now
    };

    storage.upsertScanManifest(scan);
    for (const snapshot of scanData.snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFacts(scanData.facts);
    for (const candidate of candidates) {
      storage.upsertConventionCandidate(candidate);
    }
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_scan_completed_${repo.id}_${scanId}`,
      repoId: repo.id,
      actor,
      action: "scan_completed",
      targetType: "scan",
      targetId: scanId,
      metadata: {
        files_indexed: scanData.files.length,
        facts_count: scanData.facts.length,
        candidates_count: candidates.length,
        engine_source: scanData.engineSource
      },
      createdAt: now
    }));

    return {
      repo,
      scan,
      candidates,
      summary: {
        files_indexed: scanData.files.length,
        facts_count: scanData.facts.length,
        candidates_count: candidates.length,
        engine_source: scanData.engineSource
      },
      database_path: requiredDatabasePath(parsed)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown scan failure.";
    const failedScan: ScanManifest = {
      id: scanId,
      repo_id: repo.id,
      branch: gitOutput(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(repoRoot, ["status", "--porcelain"])),
      previous_scan_id: previousScan?.id,
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: { typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION },
      rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
      status: "failed",
      file_count: 0,
      fact_count: 0,
      finding_count: 0,
      started_at: now,
      completed_at: now,
      error_message: errorMessage
    };
    storage.upsertScanManifest(failedScan);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_scan_failed_${repo.id}_${scanId}`,
      repoId: repo.id,
      actor,
      action: "scan_failed",
      targetType: "scan",
      targetId: scanId,
      metadata: { error_message: errorMessage },
      createdAt: now
    }));
    throw error;
  }
}

function scanStatusPayload(storage: SqliteDriftStorage, repoId: string) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}. Run drift scan --repo-root <path> first.`);
  }

  const latestScan = storage.listScanManifests(repoId)[0];
  if (!latestScan) {
    return {
      repo_id: repoId,
      repo_root: repo.root_path,
      latest_scan: null,
      stale: true,
      changes: { added: [], modified: [], deleted: [] },
      next_command: `drift scan --repo-root ${repo.root_path} --json`
    };
  }

  const snapshots = storage.listFileSnapshots(repoId, latestScan.id);
  const repoRootMissing = !existsSync(repo.root_path);
  const changes = repoRootMissing
    ? {
        added: [],
        modified: [],
        deleted: snapshots.map((snapshot) => snapshot.file_path).sort()
      }
    : compareSnapshotsToCurrentFiles(repo.root_path, snapshots);
  const currentBranch = gitOutput(repo.root_path, ["branch", "--show-current"]) || "unknown";
  const invalidationReasons = [
    ...(repoRootMissing ? ["repo_root_missing"] : []),
    ...scanInvalidationReasons(latestScan, { currentBranch })
  ];
  const stale = changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0 ||
    invalidationReasons.length > 0;
  const payload = {
    repo_id: repoId,
    repo_root: repo.root_path,
    current_branch: currentBranch,
    latest_scan: latestScan,
    stale,
    invalidation_reasons: invalidationReasons,
    changes,
    next_command: stale
      ? `drift scan --repo-root ${repo.root_path} --json`
      : `drift prepare "task" --repo ${repoId} --json`
  };
  return payload;
}

function scanStatus(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = stringFlag(parsed, "repo") ?? repoIdForRoot(resolveRepoRoot(parsed));
  const payload = scanStatusPayload(storage, repoId);
  auditScanInvalidationIfNeeded(storage, parsed, payload);

  return {
    payload: parsed.flags.has("json") ? payload : formatScanStatusText(payload)
  };
}

function auditScanInvalidationIfNeeded(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  payload: ReturnType<typeof scanStatusPayload>
): void {
  if (!payload.stale || !payload.latest_scan) {
    return;
  }

  const invalidationKey = hashStable(JSON.stringify({
    scan_id: payload.latest_scan.id,
    reasons: payload.invalidation_reasons,
    changes: payload.changes
  })).slice(0, 16);
  const eventId = sanitizeAuditId(`audit_event_scan_invalidated_${payload.repo_id}_${payload.latest_scan.id}_${invalidationKey}`);
  if (storage.listAuditEvents(payload.repo_id).some((event) => event.id === eventId)) {
    return;
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  storage.appendAuditEvent(auditEvent({
    id: eventId,
    repoId: payload.repo_id,
    actor: stringFlag(parsed, "actor") ?? "local-user",
    action: "scan_invalidated",
    targetType: "scan",
    targetId: payload.latest_scan.id,
    metadata: {
      latest_scan_id: payload.latest_scan.id,
      invalidation_reasons: payload.invalidation_reasons,
      added: payload.changes.added,
      modified: payload.changes.modified,
      deleted: payload.changes.deleted
    },
    createdAt: now
  }));
}

function listFindings(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo_id: string;
  policy: ReturnType<typeof authorizeContextExport>;
  summary: {
    total_count: number;
    filtered_count: number;
    by_status: Partial<Record<FindingStatus, number>>;
    by_severity: Partial<Record<Severity, number>>;
  };
  findings: Finding[];
} {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied findings output: ${policy.reason}`);
  }
  const status = optionalFindingStatusFlag(parsed, "status");
  const severity = optionalSeverityFlag(parsed, "severity");
  const allFindings = storage.listFindings(repoId);
  const findings = allFindings.filter((finding) =>
    (!status || finding.status === status) &&
    (!severity || finding.severity === severity)
  );

  return {
    repo_id: repoId,
    policy,
    summary: {
      total_count: allFindings.length,
      filtered_count: findings.length,
      by_status: countBy(allFindings, (finding) => finding.status),
      by_severity: countBy(allFindings, (finding) => finding.severity)
    },
    findings
  };
}

function startRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const result = scanRepo(storage, parsed);
  const candidate = result.candidates[0];
  const accepted = parsed.flags.has("accept-defaults") && candidate
    ? acceptDefaultCandidate(storage, parsed, candidate)
    : undefined;
  const initialFindings = accepted
    ? runFullRepoCheck(storage, parsed, result.repo.id, result.scan.completed_at ?? result.scan.started_at)
    : [];
  const baselinedCount = accepted
    ? createBaselineForFindings(storage, parsed, result.repo.id, initialFindings).created_count
    : 0;
  const nextCommands = accepted
    ? [
        `drift contract show --repo ${result.repo.id}`,
        `drift baseline status --repo ${result.repo.id}`,
        `drift prepare "task" --repo ${result.repo.id} --json`,
        `drift check --diff main...HEAD --repo ${result.repo.id} --scope changed-hunks`
      ]
    : [
        `drift conventions list --repo ${result.repo.id} --status candidate`,
        candidate
          ? `drift conventions accept ${candidate.id} --severity error --mode block`
          : "drift scan",
        `drift check --diff main...HEAD --repo ${result.repo.id} --scope changed-hunks`
      ];
  const onboardingPayload = {
    ...result,
    accepted,
    baselined_count: baselinedCount,
    onboarding: {
      status: accepted ? "ready" : candidate ? "needs_convention_review" : "needs_more_signal",
      accepted_default: Boolean(accepted),
      baselined_count: baselinedCount,
      candidate_count: result.candidates.length
    },
    state: {
      repo_id: result.repo.id,
      repo_root: result.repo.root_path,
      database_path: result.database_path
    },
    next_commands: nextCommands
  };
  const text = [
    "Drift is ready for this repo.",
    "",
    `Scanned ${result.summary.files_indexed} files.`,
    `Stored ${result.summary.facts_count} facts.`,
    `Found ${result.summary.candidates_count} convention candidate${result.summary.candidates_count === 1 ? "" : "s"}.`,
    ...(accepted ? [
      "",
      "Accepted default convention.",
      `Baselined ${baselinedCount} existing violation${baselinedCount === 1 ? "" : "s"}.`,
      "Ready for AI-assisted work."
    ] : []),
    "",
    candidate
      ? [
          "Top candidate:",
          `  ${candidate.id}`,
          `  ${candidate.statement}`,
          `  Evidence: ${candidate.scoring.supporting_examples_count} matching import${candidate.scoring.supporting_examples_count === 1 ? "" : "s"}.`
        ].join("\n")
      : "No enforceable convention candidates found yet.",
    "",
    "State:",
    `  export DRIFT_DB=${result.database_path}`,
    "",
    "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");

  return {
    payload: parsed.flags.has("json") ? onboardingPayload : text
  };
}

interface PreparedConvention {
  id: string;
  kind: AcceptedConvention["kind"];
  statement: string;
  severity: Severity;
  enforcement_mode: EnforcementMode;
  enforcement_capability: AcceptedConvention["enforcement_capability"];
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  exceptions: AcceptedConvention["exceptions"];
  agent_instruction: string;
}

interface RelevantFile {
  path: string;
  roles: string[];
  reasons: string[];
}

function prepareTask(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const task = requiredValue(parsed.positional.slice(1).join(" ").trim(), "task");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }

  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied prepare output: ${policy.reason}`);
  }

  const activeConventions = contract.conventions.filter((convention) =>
    isActiveConvention(convention, now)
  );
  const conventions = activeConventions.map(preparedConvention);
  const findings = storage
    .listFindings(repoId)
    .filter(isOpenPreflightFinding)
    .map((finding) => ({
      id: finding.id,
      convention_id: finding.convention_id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      diff_status: finding.diff_status,
      enforcement_result: finding.enforcement_result
    }));
  const baseline = baselineSummary(storage, repoId);
  const relevantFiles = relevantFilesForTask({
    repoRoot: repo.root_path,
    task,
    contract: { ...contract, conventions: activeConventions }
  });
  const riskyAreas = riskyAreasForFiles(contract, relevantFiles);
  const redactions = {
    denied_globs: contract.context_egress.denied_globs,
    excluded_file_count: countDeniedFiles(repo.root_path, contract.context_egress.denied_globs),
    snippets_included: false
  };
  const payload = {
    repo_id: repoId,
    task,
    generated_at: now,
    policy,
    contract: {
      id: contract.id,
      schema_version: contract.contract_schema_version,
      updated_at: contract.updated_at
    },
    conventions,
    scan_status: scanStatusPayload(storage, repoId),
    baseline,
    findings,
    relevant_files: relevantFiles,
    risky_areas: riskyAreas,
    required_checks: contract.required_checks,
    safe_commands: contract.safe_commands,
    redactions,
    next_commands: [
      `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`,
      `drift findings list --repo ${repoId} --json`
    ]
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPrepareText(payload)
  };
}

function listChecks(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied checks output: ${policy.reason}`);
  }

  const payload = {
    repo_id: repoId,
    policy,
    contract: {
      id: contract.id,
      schema_version: contract.contract_schema_version,
      updated_at: contract.updated_at
    },
    required_checks: contract.required_checks,
    safe_commands: contract.safe_commands
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatChecksText(payload)
  };
}

function markFindingFixed(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  findingId: string
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const evidence = requiredFlag(parsed, "evidence");
  if (!isFileLineEvidence(evidence)) {
    throw new Error("--evidence must be formatted as <file>:<line>.");
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const finding = storage.listFindings(repoId).find((entry) => entry.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }
  if (finding.status === "fixed") {
    const payload = {
      finding,
      evidence,
      changed: false
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatFindingFixedText(payload)
    };
  }

  const updated: Finding = {
    ...finding,
    status: "fixed"
  };
  storage.upsertFinding(updated);
  let resolvedBaselineCount = 0;
  for (const baseline of storage.listBaselineViolations(repoId)) {
    if (
      baseline.status === "active" &&
      baseline.convention_id === finding.convention_id &&
      baseline.finding_fingerprint === finding.fingerprint
    ) {
      storage.upsertBaselineViolation({ ...baseline, status: "resolved" });
      resolvedBaselineCount += 1;
    }
  }
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_finding_fixed_${repoId}_${findingId}_${now}`,
    repoId,
    actor,
    action: "finding_resolved",
    targetType: "finding",
    targetId: findingId,
    metadata: { evidence, resolved_baseline_count: resolvedBaselineCount },
    createdAt: now
  }));

  const payload = {
    finding: updated,
    evidence,
    changed: true
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatFindingFixedText(payload)
  };
}

function resolveFindingWithReason(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  findingId: string,
  status: Extract<FindingStatus, "suppressed" | "accepted_drift" | "false_positive">
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const reason = requiredFlag(parsed, "reason");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const finding = storage.listFindings(repoId).find((entry) => entry.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }
  if (finding.status === "fixed") {
    throw new Error("Finding is already fixed. Reopen it before applying another governance status.");
  }
  if (finding.status === status) {
    const payload = {
      finding,
      reason,
      changed: false
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatFindingResolutionText(payload)
    };
  }

  const updated: Finding = {
    ...finding,
    status
  };
  storage.upsertFinding(updated);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_finding_${status}_${repoId}_${findingId}_${now}`,
    repoId,
    actor,
    action: status === "suppressed" ? "finding_suppressed" : "finding_resolved",
    targetType: "finding",
    targetId: findingId,
    metadata: { reason, status },
    createdAt: now
  }));

  const payload = {
    finding: updated,
    reason,
    changed: true
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatFindingResolutionText(payload)
  };
}

function listAudit(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "log");
  if (!policy.allowed) {
    throw new Error(`Policy denied audit output: ${policy.reason}`);
  }
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const action = optionalAuditActionFlag(parsed, "action");
  const events = storage
    .listAuditEvents(repoId)
    .filter((event) => !action || event.action === action)
    .slice(-(limit ?? Number.POSITIVE_INFINITY));
  const payload = {
    repo_id: repoId,
    action: action ?? null,
    policy,
    count: events.length,
    events
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatAuditListText(payload)
  };
}

function createBackup(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const repo = requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "artifact");
  if (!policy.allowed) {
    throw new Error(`Policy denied backup output: ${policy.reason}`);
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const sourceDatabasePath = requiredDatabasePath(parsed);
  const backupPath = resolveBackupPath(parsed, repoId, now);
  const force = parsed.flags.has("force");
  if (existsSync(backupPath) && !force) {
    throw new Error("Backup output already exists. Pass --force to overwrite it.");
  }
  const backupId = `backup_${hashStable(`${repoId}:${backupPath}:${now}`).slice(0, 16)}`;

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_backup_create_${repoId}_${now}`,
    repoId,
    actor,
    action: "backup_created",
    targetType: "backup",
    targetId: backupId,
    metadata: { backup_path: backupPath },
    createdAt: now
  }));
  storage.checkpoint();
  copyFileSync(sourceDatabasePath, backupPath);

  const manifest = {
    id: backupId,
    repo_id: repoId,
    repo_fingerprint: repo.fingerprint,
    schema_version: storage.getAppliedMigrations().length,
    source_database_path: sourceDatabasePath,
    backup_path: backupPath,
    checksum_sha256: fileContentHash(backupPath),
    size_bytes: statSync(backupPath).size,
    created_at: now
  };
  storage.upsertBackupManifest(manifest);

  return {
    payload: parsed.flags.has("json") ? { manifest, policy } : formatBackupCreatedText(manifest)
  };
}

function listBackups(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "artifact");
  if (!policy.allowed) {
    throw new Error(`Policy denied backup output: ${policy.reason}`);
  }
  const backups = storage.listBackupManifests(repoId);
  const payload = {
    repo_id: repoId,
    policy,
    count: backups.length,
    backups
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatBackupListText(payload)
  };
}

function verifyBackup(parsed: ParsedArgs): CommandPayload {
  const backupPath = requiredValue(parsed.positional[2], "backup path");
  const repoId = requiredFlag(parsed, "repo");
  const expectedChecksum = optionalChecksumFlag(parsed, "checksum");
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }

  const checksum = fileContentHash(backupPath);
  const checksumMatches = expectedChecksum ? checksum === expectedChecksum : null;
  const backupStorage = openDriftStorage({ databasePath: backupPath });
  let schemaVersion = 0;
  let repo: RepoRecord | undefined;
  let policy: ReturnType<typeof authorizeContextExport> | null = null;
  try {
    schemaVersion = backupStorage.getAppliedMigrations().length;
    repo = backupStorage.getRepo(repoId);
    const contract = backupStorage.getRepoContract(repoId);
    policy = contract ? authorizeContextExport(contract, "artifact") : null;
  } finally {
    backupStorage.close();
  }
  if (policy && !policy.allowed) {
    throw new Error(`Policy denied backup verify output: ${policy.reason}`);
  }

  const payload = {
    valid: schemaVersion > 0 && Boolean(repo) && checksumMatches !== false,
    repo_id: repoId,
    policy,
    repo_fingerprint: repo?.fingerprint ?? null,
    backup_path: backupPath,
    schema_version: schemaVersion,
    checksum_sha256: checksum,
    checksum_matches: checksumMatches,
    repo_found: Boolean(repo)
  };

  return {
    exitCode: payload.valid ? 0 : 1,
    payload: parsed.flags.has("json") ? payload : formatBackupVerifyText(payload)
  };
}

function restoreBackup(parsed: ParsedArgs): CommandPayload {
  const backupPath = requiredValue(parsed.positional[1], "backup path");
  const targetDatabasePath = requiredDatabasePath(parsed);
  const repoId = requiredFlag(parsed, "repo");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const dryRun = parsed.flags.has("dry-run");
  const force = parsed.flags.has("force");
  const confirmed = parsed.flags.has("confirm");
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  if (resolve(backupPath) === resolve(targetDatabasePath)) {
    throw new Error("Restore target must be different from the backup path.");
  }
  if (!dryRun && !confirmed) {
    throw new Error("Restore requires --confirm unless --dry-run is used.");
  }
  if (existsSync(targetDatabasePath) && !force && !dryRun) {
    throw new Error("Target database already exists. Pass --force to overwrite it.");
  }

  const checksum = fileContentHash(backupPath);
  const expectedChecksum = optionalChecksumFlag(parsed, "checksum");
  if (expectedChecksum && expectedChecksum !== checksum) {
    throw new Error(`Backup checksum mismatch: expected ${expectedChecksum}, got ${checksum}.`);
  }
  const backupStorage = openDriftStorage({ databasePath: backupPath });
  let schemaVersion = 0;
  let repo: RepoRecord | undefined;
  let restoreStaleness: RestoreStaleness;
  try {
    schemaVersion = backupStorage.getAppliedMigrations().length;
    repo = backupStorage.getRepo(repoId);
    restoreStaleness = restoreStalenessForRepo(backupStorage, repoId);
  } finally {
    backupStorage.close();
  }
  if (schemaVersion === 0) {
    throw new Error(`Backup has no Drift schema migrations: ${backupPath}`);
  }
  if (!repo) {
    throw new Error(`Backup does not contain repo ${repoId}.`);
  }

  const restoreId = `restore_${hashStable(`${repoId}:${backupPath}:${targetDatabasePath}:${now}`).slice(0, 16)}`;
  const restore = {
    id: restoreId,
    repo_id: repoId,
    repo_fingerprint: repo.fingerprint,
    backup_path: backupPath,
    restored_database_path: targetDatabasePath,
    checksum_sha256: checksum,
    schema_version: schemaVersion,
    ...restoreStaleness!,
    ...restoreRescanGuidance(repo, targetDatabasePath, restoreStaleness!),
    dry_run: dryRun,
    restored_at: dryRun ? null : now
  };

  if (dryRun) {
    return {
      payload: parsed.flags.has("json") ? { restore } : formatRestoreText(restore)
    };
  }

  mkdirSync(dirname(targetDatabasePath), { recursive: true });
  copyFileSync(backupPath, targetDatabasePath);

  const restoredStorage = openDriftStorage({ databasePath: targetDatabasePath });
  try {
    restoredStorage.migrate();
    restoredStorage.appendAuditEvent(auditEvent({
      id: `audit_event_restore_${repoId}_${now}`,
      repoId,
      actor,
      action: "restore_completed",
      targetType: "restore",
      targetId: restoreId,
      metadata: {
        backup_path: backupPath,
        checksum_sha256: checksum,
        schema_version: schemaVersion,
        graph_stale: restore.graph_stale,
        requires_rescan: restore.requires_rescan,
        staleness_reason: restore.staleness_reason
      },
      createdAt: now
    }));
    restoredStorage.checkpoint();

    const completedRestore = {
      id: restoreId,
      repo_id: repoId,
      repo_fingerprint: repo.fingerprint,
      backup_path: backupPath,
      restored_database_path: targetDatabasePath,
      checksum_sha256: checksum,
      schema_version: restoredStorage.getAppliedMigrations().length,
      ...restoreStaleness!,
      ...restoreRescanGuidance(repo, targetDatabasePath, restoreStaleness!),
      dry_run: false,
      restored_at: now
    };
    return {
      payload: parsed.flags.has("json") ? { restore: completedRestore } : formatRestoreText(completedRestore)
    };
  } finally {
    restoredStorage.close();
  }
}

function showPolicy(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const payload = {
    repo_id: repoId,
    policy: {
      context_egress: contract.context_egress,
      agent_permissions: contract.agent_permissions
    },
    guarded_surfaces: guardedSurfaces()
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyShowText(payload)
  };
}

function checkPolicyContext(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contextPath = requiredFlag(parsed, "path");
  const surface = policySurface(requiredFlag(parsed, "surface"));
  const requestedSnippetChars = optionalPositiveIntegerFlag(parsed, "snippet-chars");
  const requestFullFileContent = parsed.flags.has("full-file");
  const contract = requiredRepoContract(storage, repoId);
  const decision = authorizeContextExport(contract, surface, {
    path: contextPath,
    requested_snippet_chars: requestedSnippetChars,
    request_full_file_content: requestFullFileContent
  });
  const payload = {
    repo_id: repoId,
    path: contextPath,
    decision
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPolicyDecisionText(payload),
    exitCode: decision.allowed ? 0 : 1
  };
}

function setEgressPolicy(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  if (!parsed.flags.has("confirm")) {
    throw new Error("Policy changes require --confirm.");
  }

  const repoId = resolveRepoId(parsed);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const contract = requiredRepoContract(storage, repoId);
  const current = contract.context_egress;
  const defaultMode = optionalContextDefaultModeFlag(parsed, "default-mode") ?? current.default_mode;
  const maxSnippetChars = optionalPositiveIntegerFlag(parsed, "max-snippet-chars") ?? current.max_snippet_chars;
  const denyGlob = stringFlag(parsed, "deny-glob");
  if (denyGlob && !isRepoRelativePolicyPattern(denyGlob)) {
    throw new Error("--deny-glob must be repo-relative.");
  }
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

function grantAgentPermission(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  if (!parsed.flags.has("confirm")) {
    throw new Error("Agent permission changes require --confirm.");
  }

  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const agent = requiredFlag(parsed, "agent");
  const permission = agentPermissionFlag(parsed, "permission");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
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

function showContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract show: ${policy.reason}`);
  }
  return {
    payload: {
      contract,
      policy
    }
  };
}

function validateContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract validate: ${policy.reason}`);
  }
  RepoContractSchema.parse(contract);
  const payload = {
    valid: true,
    repo_id: repoId,
    policy,
    contract_id: contract.id,
    schema_version: contract.contract_schema_version,
    convention_count: contract.conventions.length
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
  };
}

function exportContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const format = stringFlag(parsed, "format") ?? "json";
  if (format !== "json") {
    throw new Error("--format must be json.");
  }
  const contract = requiredRepoContract(storage, repoId);
  if (!parsed.flags.has("confirm")) {
    throw new Error("Contract export requires --confirm.");
  }

  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract export: ${policy.reason}`);
  }
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_contract_export_${repoId}_${now}`,
    repoId,
    actor,
    action: "contract_exported",
    targetType: "contract",
    targetId: contract.id,
    metadata: {
      format,
      surface: policy.surface,
      mode: policy.mode
    },
    createdAt: now
  }));
  const payload = {
    contract,
    policy
  };
  return {
    payload: parsed.flags.has("json") ? payload : JSON.stringify(payload, null, 2)
  };
}

function importContractDryRun(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  contractPath: string
): CommandPayload {
  const dryRun = parsed.flags.has("dry-run");
  if (!dryRun && !parsed.flags.has("confirm")) {
    throw new Error("Contract import requires --confirm unless --dry-run is used.");
  }
  if (!existsSync(contractPath)) {
    throw new Error(`Contract file not found: ${contractPath}`);
  }
  const contract = RepoContractSchema.parse(JSON.parse(readFileSync(contractPath, "utf8")));
  const expectedRepoId = stringFlag(parsed, "repo") ?? contract.repo_id;
  const existingContract = storage.getRepoContract(expectedRepoId);
  const policy = existingContract ? authorizeContextExport(existingContract, "contract-export") : null;
  if (policy && !policy.allowed) {
    throw new Error(`Policy denied contract import: ${policy.reason}`);
  }
  const repo = storage.getRepo(expectedRepoId);
  const expectedFingerprint = existingContract?.repo_fingerprint ?? repo?.fingerprint;
  const conventionImportSummary = summarizeImportedConventions(existingContract, contract);
  const wouldUpdate = !existingContract ||
    hashStable(JSON.stringify(existingContract)) !== hashStable(JSON.stringify(contract));
  const compatibility = {
    compatible: Boolean(repo) &&
      expectedRepoId === contract.repo_id &&
      contract.contract_schema_version <= 1 &&
      (!expectedFingerprint || expectedFingerprint === contract.repo_fingerprint),
    target_repo_exists: Boolean(repo),
    repo_id_matches: expectedRepoId === contract.repo_id,
    repo_fingerprint_matches: expectedFingerprint
      ? expectedFingerprint === contract.repo_fingerprint
      : null,
    schema_supported: contract.contract_schema_version <= 1,
    expected_repo_id: expectedRepoId,
    expected_repo_fingerprint: expectedFingerprint ?? null
  };
  const payload = {
    valid: true,
    dry_run: dryRun,
    imported: false,
    repo_id: contract.repo_id,
    contract_id: contract.id,
    schema_version: contract.contract_schema_version,
    policy,
    convention_count: contract.conventions.length,
    would_update: wouldUpdate,
    added_convention_count: conventionImportSummary.added_count,
    changed_convention_count: conventionImportSummary.changed_count,
    removed_convention_count: conventionImportSummary.removed_count,
    unchanged_convention_count: conventionImportSummary.unchanged_count,
    compatibility
  };
  if (!compatibility.compatible || dryRun) {
    return {
      exitCode: compatibility.compatible ? 0 : 1,
      payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
    };
  }
  if (!wouldUpdate) {
    return {
      payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
    };
  }

  storage.deleteAcceptedConventionsExcept(
    expectedRepoId,
    contract.conventions.map((convention) => convention.id)
  );
  for (const convention of contract.conventions) {
    storage.upsertAcceptedConvention(expectedRepoId, convention);
  }
  storage.upsertRepoContract(contract);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_contract_import_${expectedRepoId}_${now}`,
    repoId: expectedRepoId,
    actor,
    action: "contract_imported",
    targetType: "contract",
    targetId: contract.id,
    metadata: {
      contract_path: contractPath,
      convention_count: contract.conventions.length,
      added_convention_count: conventionImportSummary.added_count,
      changed_convention_count: conventionImportSummary.changed_count,
      removed_convention_count: conventionImportSummary.removed_count,
      unchanged_convention_count: conventionImportSummary.unchanged_count,
      surface: policy?.surface ?? "contract-export",
      mode: policy?.mode ?? null
    },
    createdAt: now
  }));

  const importedPayload = {
    ...payload,
    imported: true
  };
  return {
    payload: parsed.flags.has("json") ? importedPayload : formatContractValidationText(importedPayload)
  };
}

function summarizeImportedConventions(
  existingContract: RepoContract | undefined,
  importedContract: RepoContract
): {
  added_count: number;
  changed_count: number;
  removed_count: number;
  unchanged_count: number;
} {
  const existingById = new Map(
    (existingContract?.conventions ?? []).map((convention) => [convention.id, convention])
  );
  const importedIds = new Set(importedContract.conventions.map((convention) => convention.id));
  let addedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const convention of importedContract.conventions) {
    const existing = existingById.get(convention.id);
    if (!existing) {
      addedCount += 1;
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(convention)) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }
  }

  const removedCount = (existingContract?.conventions ?? [])
    .filter((convention) => !importedIds.has(convention.id)).length;
  return {
    added_count: addedCount,
    changed_count: changedCount,
    removed_count: removedCount,
    unchanged_count: unchangedCount
  };
}

function runCheck(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied check output: ${policy.reason}`);
  }

  const scope = stringFlag(parsed, "scope") ?? "changed-hunks";
  if (!["changed-hunks", "changed-files", "full"].includes(scope)) {
    throw new Error("--scope must be changed-hunks, changed-files, or full.");
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const parsedDiff = scope === "full"
    ? fullRepoDiff(repo.root_path)
    : parseUnifiedDiff(loadDiff(repo.root_path, parsed));
  const baseline = storage.listBaselineViolations(repoId);
  const existingFindings = new Map(
    storage.listFindings(repoId).map((finding) => [finding.fingerprint, finding])
  );
  const checkData = collectScanData({
    repoId,
    scanId: `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
    repoRoot: repo.root_path
  });
  const snapshotsByPath = new Map(checkData.snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const findings: Finding[] = [];

  for (const convention of contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, now)
    ) {
      continue;
    }

    const files = filesForConvention(parsedDiff, convention, scope);
    for (const filePath of files) {
      if (!isApiRoutePath(filePath) || isExceptedPath(filePath, convention, now)) {
        continue;
      }

      for (const importUsed of importFactsForFile(checkData.facts, filePath)) {
        if (!isForbiddenImport(importUsed.value, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(filePath, importUsed.name, importUsed.value, convention, now)) {
          continue;
        }

        const diffStatus = diffStatusFor(filePath, importUsed.start_line, parsedDiff, scope);
        const fingerprint = findingFingerprint(
          convention.id,
          filePath,
          importUsed.name,
          importUsed.value
        );
        const status = baseline.some((entry) =>
          entry.status === "active" &&
          entry.convention_id === convention.id &&
          entry.finding_fingerprint === fingerprint
        ) ? "pre_existing" : preservedGovernanceStatus(existingFindings.get(fingerprint)) ?? "new";
        const snapshot = snapshotsByPath.get(filePath);
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          fingerprint,
          title: "API route imports data access directly",
          message: `${filePath} imports ${importUsed.name} from ${importUsed.value} directly; route modules should delegate through the accepted service/data-access layer.`,
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status,
          diff_status: diffStatus,
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.start_line,
            end_line: importUsed.start_line,
            symbol: importUsed.name,
            import_source: importUsed.value,
            fact_ids: importUsed.fact_id ? [importUsed.fact_id] : [],
            scan_id: checkData.snapshots[0]?.scan_id ?? `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
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
      policy,
      summary: {
        repo_id: repoId,
        scope,
        findings_count: findings.length,
        blocking_count: blockingCount,
        skipped_deleted_files: parsedDiff.deletedFiles,
        engine_source: checkData.engineSource
      },
      findings
    }
  };
}

function isOpenPreflightFinding(finding: Finding): boolean {
  return !["fixed", "false_positive", "suppressed", "accepted_drift"].includes(finding.status);
}

function preservedGovernanceStatus(finding: Finding | undefined): FindingStatus | undefined {
  if (!finding) {
    return undefined;
  }
  if (
    finding.status === "suppressed" ||
    finding.status === "accepted_drift" ||
    finding.status === "false_positive"
  ) {
    return finding.status;
  }
  return undefined;
}

function acceptCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { accepted: AcceptedConvention; contract: RepoContract; changed: boolean } {
  const candidate = requiredCandidate(storage, candidateId);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const severity = optionalSeverityFlag(parsed, "severity") ?? candidate.suggested_severity;
  const mode = optionalEnforcementModeFlag(parsed, "mode") ?? candidate.suggested_enforcement_mode;
  if (mode === "block" && candidate.enforcement_capability !== "deterministic_check") {
    throw new Error("Only deterministic conventions can use --mode block. Use --mode warn, brief, or off for heuristic/briefing conventions.");
  }
  const contractId = storage.getRepoContract(candidate.repo_id)?.id ?? contractIdForRepo(candidate.repo_id);
  const existingAccepted = storage
    .listAcceptedConventions(candidate.repo_id)
    .find((accepted) => accepted.id === conventionIdForCandidate(candidate.id));
  const existingContract = storage.getRepoContract(candidate.repo_id);
  if (
    candidate.status === "accepted" &&
    existingAccepted &&
    existingContract &&
    existingAccepted.severity === severity &&
    existingAccepted.enforcement_mode === mode
  ) {
    return { accepted: existingAccepted, contract: existingContract, changed: false };
  }

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

  return { accepted: convention, contract, changed: true };
}

function acceptDefaultCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidate: ConventionCandidate
): AcceptedConvention {
  return acceptCandidate(
    storage,
    withFlags(parsed, {
      severity: candidate.suggested_severity,
      mode: candidate.suggested_enforcement_mode
    }),
    candidate.id
  ).accepted;
}

function runFullRepoCheck(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  now: string
): Finding[] {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    return [];
  }

  const files = walkIndexableFiles(repo.root_path).filter(isApiRoutePath);
  const diff = {
    files: files.map((path) => ({ path, changedLines: new Set<number>() })),
    deletedFiles: []
  };
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    return [];
  }
  const latestScan = storage.listScanManifests(repoId).find((scan) => scan.status === "completed");
  const snapshotsByPath = new Map(
    latestScan
      ? storage.listFileSnapshots(repoId, latestScan.id).map((snapshot) => [snapshot.file_path, snapshot])
      : []
  );

  const findings: Finding[] = [];
  for (const convention of contract.conventions) {
    if (convention.kind !== "api_route_no_direct_data_access") {
      continue;
    }

    for (const filePath of filesForConvention(diff, convention, "full")) {
      if (isExceptedPath(filePath, convention, now)) {
        continue;
      }
      const source = readFileSync(join(repo.root_path, filePath), "utf8");
      for (const importUsed of extractImports(source)) {
        if (!isForbiddenImport(importUsed.source, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(filePath, importUsed.name, importUsed.source, convention, now)) {
          continue;
        }

        const fingerprint = findingFingerprint(convention.id, filePath, importUsed.name, importUsed.source);
        const snapshot = snapshotsByPath.get(filePath);
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          fingerprint,
          title: "API route imports data access directly",
          message: `${filePath} imports ${importUsed.name} from ${importUsed.source} directly; route modules should delegate through the accepted service/data-access layer.`,
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status: "new",
          diff_status: "touched_existing",
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.line,
            end_line: importUsed.end_line,
            symbol: importUsed.name,
            import_source: importUsed.source,
            fact_ids: [],
            scan_id: latestScan?.id ?? `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
            file_hash: snapshot?.content_hash ?? fileContentHash(join(repo.root_path, filePath)),
            redaction_state: "none"
          }],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }

  return findings;
}

function baselineViolationKey(conventionId: string, findingFingerprint: string): string {
  return `${conventionId}:${findingFingerprint}`;
}

function createBaselineForFindings(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  findings: Finding[]
): { created_count: number } {
  if (findings.length === 0) {
    return { created_count: 0 };
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const scanId = `scan_baseline_${sanitizeAuditId(now)}`;
  storage.upsertScanManifest(baselineScanManifest({
    id: scanId,
    repoId,
    from: "initial-scan",
    now,
    findingCount: findings.length
  }));

  let createdCount = 0;
  const existingBaselines = new Set(storage
    .listBaselineViolations(repoId)
    .map((row) => baselineViolationKey(row.convention_id, row.finding_fingerprint)));
  for (const finding of findings) {
    if (!isBaselineEligibleFinding(finding)) {
      continue;
    }

    const baselineKey = baselineViolationKey(finding.convention_id, finding.fingerprint);
    if (existingBaselines.has(baselineKey)) {
      continue;
    }

    storage.upsertBaselineViolation({
      id: `baseline_${finding.fingerprint.slice(0, 16)}`,
      repo_id: repoId,
      convention_id: finding.convention_id,
      finding_fingerprint: finding.fingerprint,
      file_path: inferFilePathFromMessage(finding.message),
      first_seen_scan_id: scanId,
      first_seen_commit: "initial-scan",
      status: "active",
      created_at: now
    });
    existingBaselines.add(baselineKey);
    createdCount += 1;
  }

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_baseline_create_${repoId}_${now}`,
    repoId,
    actor: stringFlag(parsed, "actor") ?? "local-user",
    action: "baseline_created",
    targetType: "baseline",
    targetId: scanId,
    metadata: { from: "initial-scan", created_count: createdCount },
    createdAt: now
  }));

  return { created_count: createdCount };
}

function policySurface(value: string): PolicyDecision["surface"] {
  if (
    value === "cli-preflight" ||
    value === "cli-check" ||
    value === "mcp" ||
    value === "contract-export" ||
    value === "artifact" ||
    value === "log" ||
    value === "ui"
  ) {
    return value;
  }

  throw new Error("--surface must be cli-preflight, cli-check, mcp, contract-export, artifact, log, or ui.");
}

function guardedSurfaces(): PolicyDecision["surface"][] {
  return [
    "cli-preflight",
    "cli-check",
    "mcp",
    "contract-export",
    "artifact",
    "log",
    "ui"
  ];
}

function optionalContextDefaultModeFlag(
  parsed: ParsedArgs,
  name: string
): RepoContract["context_egress"]["default_mode"] | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "local_only" || value === "redacted" || value === "approval_required") {
    return value;
  }
  throw new Error("--default-mode must be local_only, redacted, or approval_required.");
}

function agentPermissionFlag(
  parsed: ParsedArgs,
  name: string
): RepoContract["agent_permissions"][number]["permissions"][number] {
  const value = requiredFlag(parsed, name);
  if (value === "read_context" || value === "request_preflight" || value === "propose_resolution") {
    return value;
  }
  throw new Error("--permission must be read_context, request_preflight, or propose_resolution.");
}

function optionalAuditActionFlag(parsed: ParsedArgs, name: string): AuditEvent["action"] | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (isAuditAction(value)) {
    return value;
  }
  throw new Error(`--${name} must be ${AUDIT_ACTIONS.join(", ")}.`);
}

const AUDIT_ACTIONS = [
  "repo_added",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "election_accepted",
  "election_rejected",
  "election_edited",
  "finding_resolved",
  "finding_suppressed",
  "policy_changed",
  "agent_permission_changed",
  "backup_created",
  "restore_completed",
  "contract_exported",
  "contract_imported",
  "adapter_upgraded",
  "scan_invalidated",
  "baseline_created",
  "baseline_cleared"
] as const satisfies readonly AuditEvent["action"][];

function isAuditAction(value: string): value is AuditEvent["action"] {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function optionalFindingStatusFlag(parsed: ParsedArgs, name: string): FindingStatus | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "new" ||
    value === "pre_existing" ||
    value === "needs_review" ||
    value === "fixed" ||
    value === "false_positive" ||
    value === "accepted_drift" ||
    value === "suppressed"
  ) {
    return value;
  }
  throw new Error("--status must be new, pre_existing, needs_review, fixed, false_positive, accepted_drift, or suppressed.");
}

function optionalSeverityFlag(parsed: ParsedArgs, name: string): Severity | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "info" || value === "warning" || value === "error") {
    return value;
  }
  throw new Error("--severity must be info, warning, or error.");
}

function optionalConventionStatusFlag(parsed: ParsedArgs, name: string): ConventionStatus | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "candidate" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "archived" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error("--status must be candidate, accepted, rejected, archived, or expired.");
}

function optionalEnforcementModeFlag(parsed: ParsedArgs, name: string): EnforcementMode | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "off" || value === "brief" || value === "warn" || value === "block") {
    return value;
  }
  throw new Error("--mode must be off, brief, warn, or block.");
}

function preparedConvention(convention: AcceptedConvention): PreparedConvention {
  return {
    id: convention.id,
    kind: convention.kind,
    statement: convention.statement,
    severity: convention.severity,
    enforcement_mode: convention.enforcement_mode,
    enforcement_capability: convention.enforcement_capability,
    scope: convention.scope,
    matcher: convention.matcher,
    exceptions: convention.exceptions,
    agent_instruction: instructionForConvention(convention)
  };
}

function instructionForConvention(convention: AcceptedConvention): string {
  if (convention.kind === "api_route_no_direct_data_access") {
    const forbidden = (convention.matcher.forbidden_imports ?? []).join(", ");
    return [
      "When editing API route files, do not import data-access clients directly.",
      forbidden ? `Forbidden imports: ${forbidden}.` : "",
      "Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
    ].filter(Boolean).join(" ");
  }

  if (convention.kind === "api_route_requires_service_delegation") {
    const delegates = (convention.matcher.allowed_delegate_imports ?? []).join(", ");
    return [
      "When editing API route files, keep route modules thin and delegate business/data-access work to the service layer.",
      delegates ? `Observed delegate imports: ${delegates}.` : "",
      "Treat this as briefing guidance unless the repo later upgrades it to a deterministic check."
    ].filter(Boolean).join(" ");
  }

  return `${convention.statement} Follow its scope, matcher, and exceptions.`;
}

function baselineSummary(storage: SqliteDriftStorage, repoId: string): {
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
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
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };
}

function relevantFilesForTask(input: {
  repoRoot: string;
  task: string;
  contract: RepoContract;
}): RelevantFile[] {
  if (!existsSync(input.repoRoot)) {
    return [];
  }

  const tokens = tokenizeTask(input.task);
  const deniedGlobs = input.contract.context_egress.denied_globs;
  const files = walkIndexableFiles(input.repoRoot)
    .filter((filePath) => !deniedGlobs.some((glob) => matchesGlob(filePath, glob)))
    .map((filePath) => relevantFileForPath(filePath, tokens, input.contract))
    .filter((file): file is RelevantFile => Boolean(file));

  return files.slice(0, 25);
}

function relevantFileForPath(
  filePath: string,
  tokens: Set<string>,
  contract: RepoContract
): RelevantFile | undefined {
  const reasons = new Set<string>();
  const roles = new Set<string>();
  if (isApiRoutePath(filePath)) {
    roles.add("api_route");
  }

  for (const token of tokens) {
    if (filePath.toLowerCase().includes(token)) {
      reasons.add(`task token: ${token}`);
    }
  }

  for (const convention of contract.conventions) {
    const inScope = convention.scope.path_globs.some((glob) => matchesGlob(filePath, glob));
    if (inScope) {
      reasons.add(`in scope for ${convention.id}`);
      for (const role of convention.scope.file_roles ?? []) {
        roles.add(role);
      }
    }
  }

  if (reasons.size === 0) {
    return undefined;
  }

  return {
    path: filePath,
    roles: [...roles].sort(),
    reasons: [...reasons].sort()
  };
}

function riskyAreasForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): RepoContract["risky_areas"] {
  const relevantPaths = relevantFiles.map((file) => file.path);
  return contract.risky_areas.filter((area) =>
    relevantPaths.some((filePath) =>
      area.path_globs.some((glob) => matchesGlob(filePath, glob))
    )
  );
}

function tokenizeTask(task: string): Set<string> {
  return new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function countDeniedFiles(repoRoot: string, deniedGlobs: string[]): number {
  if (deniedGlobs.length === 0 || !existsSync(repoRoot)) {
    return 0;
  }
  return walkIndexableFiles(repoRoot).filter((filePath) =>
    deniedGlobs.some((glob) => matchesGlob(filePath, glob))
  ).length;
}

function formatPrepareText(payload: {
  task: string;
  conventions: PreparedConvention[];
  relevant_files: RelevantFile[];
  next_commands: string[];
}): string {
  return [
    "Drift prepare",
    "",
    `Task: ${payload.task}`,
    "",
    "Conventions:",
    ...payload.conventions.map((convention) => `  ${convention.id}: ${convention.statement}`),
    "",
    "Relevant files:",
    ...payload.relevant_files.map((file) => `  ${file.path}`),
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

function formatChecksText(payload: {
  required_checks: Array<{ command: string; reason?: string }>;
  safe_commands: Array<{ command: string; reason?: string }>;
}): string {
  const requiredChecks = payload.required_checks.length > 0
    ? payload.required_checks.map((check) => `  ${check.command}${check.reason ? ` - ${check.reason}` : ""}`)
    : ["  none"];
  const safeCommands = payload.safe_commands.length > 0
    ? payload.safe_commands.map((command) => `  ${command.command}${command.reason ? ` - ${command.reason}` : ""}`)
    : ["  none"];

  return [
    "Drift checks",
    "",
    "Required checks:",
    ...requiredChecks,
    "",
    "Safe commands:",
    ...safeCommands,
    ""
  ].join("\n");
}

function formatFindingFixedText(payload: { finding: Finding; evidence: string }): string {
  return [
    "Drift finding fixed",
    "",
    `Finding: ${payload.finding.id}`,
    `Status: ${payload.finding.status}`,
    `Evidence: ${payload.evidence}`,
    ""
  ].join("\n");
}

function formatFindingResolutionText(payload: { finding: Finding; reason: string }): string {
  return [
    "Drift finding updated",
    "",
    `Finding: ${payload.finding.id}`,
    `Status: ${payload.finding.status}`,
    `Reason: ${payload.reason}`,
    ""
  ].join("\n");
}

function formatAuditListText(payload: {
  repo_id: string;
  count: number;
  events: AuditEvent[];
}): string {
  return [
    "Drift audit log",
    "",
    `Repo: ${payload.repo_id}`,
    `Events: ${payload.count}`,
    "",
    ...payload.events.map((event) =>
      `${event.created_at} ${event.action} ${event.target_type}:${event.target_id} by ${event.actor}`
    ),
    ""
  ].join("\n");
}

function formatBackupCreatedText(manifest: {
  id: string;
  repo_id: string;
  backup_path: string;
  checksum_sha256: string;
  size_bytes: number;
  created_at: string;
}): string {
  return [
    "Drift backup created",
    "",
    `Backup: ${manifest.id}`,
    `Repo: ${manifest.repo_id}`,
    `Path: ${manifest.backup_path}`,
    `Checksum: ${manifest.checksum_sha256}`,
    `Size: ${manifest.size_bytes} bytes`,
    `Created: ${manifest.created_at}`,
    ""
  ].join("\n");
}

function formatBackupListText(payload: {
  repo_id: string;
  count: number;
  backups: Array<{ id: string; backup_path: string; checksum_sha256: string; created_at: string }>;
}): string {
  return [
    "Drift backups",
    "",
    `Repo: ${payload.repo_id}`,
    `Backups: ${payload.count}`,
    "",
    ...payload.backups.map((backup) =>
      `${backup.created_at} ${backup.id} ${backup.backup_path} ${backup.checksum_sha256}`
    ),
    ""
  ].join("\n");
}

function formatBackupVerifyText(payload: {
  valid: boolean;
  repo_id: string;
  repo_fingerprint: string | null;
  backup_path: string;
  schema_version: number;
  checksum_sha256: string;
  checksum_matches: boolean | null;
  repo_found: boolean;
}): string {
  return [
    "Drift backup verify",
    "",
    `Valid: ${payload.valid}`,
    `Repo: ${payload.repo_id}`,
    `Repo found: ${payload.repo_found}`,
    `Repo fingerprint: ${payload.repo_fingerprint ?? "unknown"}`,
    `Backup: ${payload.backup_path}`,
    `Schema version: ${payload.schema_version}`,
    `Checksum: ${payload.checksum_sha256}`,
    `Checksum matches: ${payload.checksum_matches ?? "not checked"}`,
    ""
  ].join("\n");
}

function formatRestoreText(restore: {
  id: string;
  repo_id: string;
  backup_path: string;
  restored_database_path: string;
  checksum_sha256: string;
  schema_version: number;
  graph_stale?: boolean;
  source_changes?: ScanStatusChangeSet;
  staleness_reason?: string;
  requires_rescan?: boolean;
  next_command?: string | null;
  dry_run?: boolean;
  restored_at: string | null;
}): string {
  return [
    restore.dry_run ? "Drift restore validated" : "Drift restore completed",
    "",
    `Restore: ${restore.id}`,
    `Repo: ${restore.repo_id}`,
    `Backup: ${restore.backup_path}`,
    `Database: ${restore.restored_database_path}`,
    `Schema version: ${restore.schema_version}`,
    `Checksum: ${restore.checksum_sha256}`,
    `Graph stale: ${restore.graph_stale ?? "unknown"}`,
    restore.source_changes
      ? `Source changes: +${restore.source_changes.added.length} ~${restore.source_changes.modified.length} -${restore.source_changes.deleted.length}`
      : "Source changes: unknown",
    restore.staleness_reason ? `Staleness reason: ${restore.staleness_reason}` : "",
    `Requires rescan: ${restore.requires_rescan ?? "unknown"}`,
    restore.next_command ? `Next command: ${restore.next_command}` : "",
    restore.dry_run ? "Dry run: true" : `Restored: ${restore.restored_at}`,
    ""
  ].filter((line) => line !== "").join("\n");
}

function formatScanStatusText(payload: {
  repo_id: string;
  repo_root: string;
  latest_scan: ScanManifest | null;
  stale: boolean;
  invalidation_reasons?: string[];
  changes: ScanStatusChangeSet;
  next_command: string;
}): string {
  return [
    "Drift scan status",
    "",
    `Repo: ${payload.repo_id}`,
    `Root: ${payload.repo_root}`,
    `Latest scan: ${payload.latest_scan?.id ?? "none"}`,
    `State: ${payload.stale ? "stale" : "fresh"}`,
    "",
    `Added: ${payload.changes.added.length}`,
    `Modified: ${payload.changes.modified.length}`,
    `Deleted: ${payload.changes.deleted.length}`,
    `Invalidations: ${payload.invalidation_reasons?.join(", ") || "none"}`,
    "",
    "Next command:",
    `  ${payload.next_command}`,
    ""
  ].join("\n");
}

function formatPolicyShowText(payload: {
  repo_id: string;
  policy: Pick<RepoContract, "context_egress" | "agent_permissions">;
  guarded_surfaces: string[];
}): string {
  return [
    "Drift policy",
    "",
    `Repo: ${payload.repo_id}`,
    `Mode: ${payload.policy.context_egress.default_mode}`,
    `Denied globs: ${payload.policy.context_egress.denied_globs.join(", ") || "none"}`,
    `Max snippet chars: ${payload.policy.context_egress.max_snippet_chars}`,
    `Agent permissions: ${payload.policy.agent_permissions.length}`,
    "",
    "Guarded surfaces:",
    ...payload.guarded_surfaces.map((surface) => `  ${surface}`),
    ""
  ].join("\n");
}

function formatPolicyDecisionText(payload: {
  repo_id: string;
  path: string;
  decision: PolicyDecision;
}): string {
  return [
    "Drift policy decision",
    "",
    `Repo: ${payload.repo_id}`,
    `Path: ${payload.path}`,
    `Surface: ${payload.decision.surface}`,
    `Decision: ${payload.decision.allowed ? "allowed" : "denied"}`,
    `Mode: ${payload.decision.mode}`,
    `Reason: ${payload.decision.reason}`,
    ""
  ].join("\n");
}

function formatContractValidationText(payload: {
  valid: boolean;
  repo_id: string;
  contract_id: string;
  schema_version: number;
  convention_count: number;
}): string {
  return [
    "Drift contract",
    "",
    `Valid: ${payload.valid}`,
    `Repo: ${payload.repo_id}`,
    `Contract: ${payload.contract_id}`,
    `Schema version: ${payload.schema_version}`,
    `Conventions: ${payload.convention_count}`,
    ""
  ].join("\n");
}

function rejectCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { candidate: ConventionCandidate; changed: boolean } {
  const candidate = requiredCandidate(storage, candidateId);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const reason = requiredFlag(parsed, "reason");
  if (candidate.status === "rejected") {
    return { candidate, changed: false };
  }

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

  return { candidate: rejected, changed: true };
}

function editCandidate(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidateId: string
): { candidate: ConventionCandidate; changed_fields: string[] } {
  const candidate = requiredCandidate(storage, candidateId);
  const statement = stringFlag(parsed, "statement");
  const scopeFile = stringFlag(parsed, "scope-file");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const nextScope = scopeFile ? readConventionScopeFile(scopeFile) : candidate.scope;
  const changedFields = [
    statement && statement !== candidate.statement ? "statement" : undefined,
    scopeFile && hashStable(JSON.stringify(nextScope)) !== hashStable(JSON.stringify(candidate.scope)) ? "scope" : undefined
  ].filter((field): field is string => Boolean(field));
  const updated = {
    ...candidate,
    statement: statement ?? candidate.statement,
    scope: nextScope
  };
  if (changedFields.length === 0) {
    return { candidate: updated, changed_fields: changedFields };
  }

  storage.upsertConventionCandidate(updated);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_edit_${candidate.id}_${now}`,
    repoId: candidate.repo_id,
    actor,
    action: "election_edited",
    targetType: "candidate",
    targetId: candidate.id,
    metadata: { changed_fields: changedFields },
    createdAt: now
  }));
  return { candidate: updated, changed_fields: changedFields };
}

function readConventionScopeFile(scopeFile: string): ConventionScope {
  const rawScope = JSON.parse(readFileSync(scopeFile, "utf8"));
  const pathGlobs = Array.isArray(rawScope.path_globs) ? rawScope.path_globs : [];
  const excludePathGlobs = Array.isArray(rawScope.exclude_path_globs) ? rawScope.exclude_path_globs : [];
  const unsafeGlob = [...pathGlobs, ...excludePathGlobs].some((glob) =>
    typeof glob !== "string" || !isRepoRelativePolicyPattern(glob)
  );
  if (unsafeGlob) {
    throw new Error("--scope-file path_globs and exclude_path_globs must be repo-relative.");
  }
  return ConventionScopeSchema.parse(rawScope);
}

function addConventionException(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  conventionId: string
): { convention: AcceptedConvention; contract: RepoContract; changed: boolean } {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const path = requiredFlag(parsed, "path");
  if (!isRepoRelativePolicyPattern(path)) {
    throw new Error("--path must be repo-relative.");
  }
  const reason = requiredFlag(parsed, "reason");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const convention = storage
    .listAcceptedConventions(repoId)
    .find((accepted) => accepted.id === conventionId);
  if (!convention) {
    throw new Error(`Accepted convention not found: ${conventionId}`);
  }
  const duplicate = convention.exceptions.some((exception) =>
    (exception.path_globs ?? []).includes(path)
  );
  if (duplicate) {
    const contract = requiredRepoContract(storage, repoId);
    return { convention, contract, changed: false };
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

  return { convention: updated, contract, changed: true };
}

function createBaseline(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  created_count: number;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
} {
  const repoId = resolveRepoId(parsed);
  const from = requiredFlag(parsed, "from");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = stringFlag(parsed, "actor") ?? "local-user";
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }

  const scanId = `scan_baseline_${sanitizeAuditId(now)}`;

  const findings = storage.listFindings(repoId);
  const existingBaselines = new Set(storage
    .listBaselineViolations(repoId)
    .map((row) => baselineViolationKey(row.convention_id, row.finding_fingerprint)));
  const newBaselineFindings: Finding[] = [];
  for (const finding of findings) {
    if (!isBaselineEligibleFinding(finding)) {
      continue;
    }

    const baselineKey = baselineViolationKey(finding.convention_id, finding.fingerprint);
    if (existingBaselines.has(baselineKey)) {
      continue;
    }

    newBaselineFindings.push(finding);
    existingBaselines.add(baselineKey);
  }

  if (newBaselineFindings.length === 0) {
    return {
      created_count: 0,
      baseline: storage.listBaselineViolations(repoId)
    };
  }

  storage.upsertScanManifest(baselineScanManifest({
    id: scanId,
    repoId,
    from,
    now,
    findingCount: findings.length
  }));

  for (const finding of newBaselineFindings) {
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
  }
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_baseline_create_${repoId}_${now}`,
    repoId,
    actor,
    action: "baseline_created",
    targetType: "baseline",
    targetId: scanId,
    metadata: { from, created_count: newBaselineFindings.length },
    createdAt: now
  }));

  return {
    created_count: newBaselineFindings.length,
    baseline: storage.listBaselineViolations(repoId)
  };
}

function isBaselineEligibleFinding(finding: Finding): boolean {
  return ![
    "fixed",
    "false_positive",
    "suppressed",
    "accepted_drift"
  ].includes(finding.status);
}

function baselineStatus(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo_id: string;
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
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
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
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

function requiredRepoContract(storage: SqliteDriftStorage, repoId: string): RepoContract {
  requiredRepo(storage, repoId);
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  return contract;
}

function requiredRepo(storage: SqliteDriftStorage, repoId: string): RepoRecord {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  return repo;
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
  if (typeof payload === "string") {
    return payload.endsWith("\n") ? payload : `${payload}\n`;
  }
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

  if (
    ["init", "scan", "start"].includes(parsed.positional[0] ?? "") ||
    parsed.flags.has("repo-root") ||
    parsed.flags.has("state-root")
  ) {
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

function resolveRepoId(parsed: ParsedArgs): string {
  return stringFlag(parsed, "repo") ?? repoIdForRoot(resolveRepoRoot(parsed));
}

function defaultDatabasePath(
  repoRoot: string,
  parsed: ParsedArgs,
  options: { createDir?: boolean } = { createDir: true }
): string {
  const stateRoot = resolve(
    stringFlag(parsed, "state-root") ??
      process.env.DRIFT_STATE_ROOT ??
      join(homedir(), ".drift", "repos")
  );
  const repoId = repoIdForRoot(repoRoot);
  const dir = join(stateRoot, repoId);
  if (options.createDir !== false) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "drift.sqlite");
}

function resolveBackupPath(parsed: ParsedArgs, repoId: string, now: string): string {
  const output = resolve(
    stringFlag(parsed, "output") ??
      join(homedir(), ".drift", "backups", repoId)
  );
  if (extname(output) === ".sqlite") {
    mkdirSync(dirname(output), { recursive: true });
    return output;
  }

  mkdirSync(output, { recursive: true });
  return join(output, `${repoId}-${sanitizeAuditId(now)}.drift-backup.sqlite`);
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

function collectScanData(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
}): ScanData {
  const rust = collectScanDataFromRust(input);
  if (rust) {
    return rust;
  }

  const files = walkIndexableFiles(input.repoRoot);
  return {
    files,
    facts: files.flatMap((filePath) =>
      extractFactsFromFile({
        repoId: input.repoId,
        scanId: input.scanId,
        repoRoot: input.repoRoot,
        filePath
      })
    ),
    snapshots: files.map((filePath) =>
      fileSnapshotForFile({
        repoId: input.repoId,
        scanId: input.scanId,
        repoRoot: input.repoRoot,
        filePath
      })
    ),
    engineSource: "typescript"
  };
}

function collectScanDataFromRust(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
}): ScanData | undefined {
  const output = runRustEngine(["scan-repo", input.repoRoot]);
  if (!output) {
    return undefined;
  }
  const parsed = JSON.parse(output) as RustEngineScanOutput;
  return {
    files: parsed.files.map((file) => file.file_path).sort(),
    facts: parsed.facts.map((fact) =>
      factRecord(
        { repoId: input.repoId, scanId: input.scanId, filePath: fact.file_path },
        fact.kind,
        fact.name,
        fact.value ?? undefined,
        fact.start_line,
        fact.end_line
      )
    ),
    snapshots: parsed.files.map((file) => ({
      repo_id: input.repoId,
      scan_id: input.scanId,
      file_path: file.file_path,
      content_hash: file.content_hash,
      byte_size: file.byte_size,
      indexed: true
    })),
    engineSource: "rust"
  };
}

function runRustEngine(args: string[]): string | undefined {
  const explicit = process.env.DRIFT_ENGINE_BIN;
  if (explicit) {
    return execFileSync(explicit, args, { encoding: "utf8" });
  }

  const workspaceRoot = findCargoWorkspaceRoot();
  if (!workspaceRoot) {
    return undefined;
  }

  try {
    return execFileSync("cargo", ["run", "--quiet", "-p", "drift-engine", "--", ...args], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return undefined;
  }
}

function findCargoWorkspaceRoot(): string | undefined {
  let current = dirname(fileURLToPath(import.meta.url));
  while (current !== dirname(current)) {
    if (existsSync(join(current, "Cargo.toml")) && existsSync(join(current, "crates", "drift-engine"))) {
      return current;
    }
    current = dirname(current);
  }
  return undefined;
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

function importFactsForFile(facts: FactRecord[], filePath: string): Array<{
  fact_id: string;
  name: string;
  value: string;
  start_line: number;
}> {
  return facts
    .filter((fact) => fact.kind === "import_used" && fact.file_path === filePath && fact.value)
    .map((fact) => ({
      fact_id: fact.id,
      name: fact.name,
      value: fact.value as string,
      start_line: fact.start_line
    }));
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

function compareSnapshotsToCurrentFiles(
  repoRoot: string,
  snapshots: FileSnapshot[]
): ScanStatusChangeSet {
  const previous = new Map(snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const currentFiles = walkIndexableFiles(repoRoot);
  const current = new Set(currentFiles);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const filePath of currentFiles) {
    const snapshot = previous.get(filePath);
    if (!snapshot) {
      added.push(filePath);
      continue;
    }

    const currentHash = fileContentHash(join(repoRoot, filePath));
    if (currentHash !== snapshot.content_hash) {
      modified.push(filePath);
    }
  }

  for (const filePath of previous.keys()) {
    if (!current.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort()
  };
}

function restoreStalenessForRepo(
  storage: SqliteDriftStorage,
  repoId: string
): RestoreStaleness {
  const emptyChanges = { added: [], modified: [], deleted: [] };
  const repo = storage.getRepo(repoId);
  if (!repo || !existsSync(repo.root_path)) {
    return {
      graph_stale: true,
      source_changes: emptyChanges,
      staleness_reason: "repo_root_missing"
    };
  }

  const latestScan = storage.listScanManifests(repoId).find((scan) => scan.status === "completed");
  if (!latestScan) {
    return {
      graph_stale: true,
      source_changes: emptyChanges,
      staleness_reason: "scan_missing"
    };
  }

  const sourceChanges = compareSnapshotsToCurrentFiles(
    repo.root_path,
    storage.listFileSnapshots(repoId, latestScan.id)
  );
  return {
    graph_stale: sourceChanges.added.length > 0 ||
      sourceChanges.modified.length > 0 ||
      sourceChanges.deleted.length > 0,
    source_changes: sourceChanges,
    staleness_reason: "none"
  };
}

function restoreRescanGuidance(
  repo: RepoRecord,
  targetDatabasePath: string,
  staleness: RestoreStaleness
): RestoreRescanGuidance {
  if (!staleness.graph_stale) {
    return {
      requires_rescan: false,
      next_command: null
    };
  }
  return {
    requires_rescan: true,
    next_command: `drift --db ${targetDatabasePath} scan --repo-root ${repo.root_path} --json`
  };
}

function scanInvalidationReasons(
  scan: ScanManifest,
  input: { currentBranch?: string } = {}
): string[] {
  const reasons: string[] = [];
  if (input.currentBranch && scan.branch !== input.currentBranch) {
    reasons.push("branch_changed");
  }
  if (scan.scanner_version !== DRIFT_SCANNER_VERSION) {
    reasons.push("scanner_version_changed");
  }
  if (scan.adapter_versions.typescript !== DRIFT_TYPESCRIPT_ADAPTER_VERSION) {
    reasons.push("adapter_version_changed:typescript");
  }
  if (scan.rule_engine_version !== DRIFT_RULE_ENGINE_VERSION) {
    reasons.push("rule_engine_version_changed");
  }
  return reasons;
}

function countBy<T, K extends string>(
  entries: T[],
  keyFor: (entry: T) => K
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const entry of entries) {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function fileContentHash(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function inferConventionCandidates(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
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
    looksLikeDataAccessImport(fact.value, {
      repoRoot: input.repoRoot,
      importerFile: fact.file_path
    })
  );
  const serviceImports = input.facts.filter((fact) =>
    fact.kind === "import_used" &&
    apiRouteFiles.has(fact.file_path) &&
    fact.value &&
    looksLikeServiceImport(fact.value)
  );

  const candidates: ConventionCandidate[] = [];
  if (dataImports.length > 0) {
    const forbiddenImports = [...new Set(dataImports.map((fact) => fact.value).filter(Boolean))] as string[];
    candidates.push({
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
    });
  }

  if (serviceImports.length > 0 || dataImports.length > 0) {
    const delegateImports = [...new Set(serviceImports.map((fact) => fact.value).filter(Boolean))] as string[];
    candidates.push({
      id: `candidate_${hashStable(`${input.repoId}:api_route_requires_service_delegation:${delegateImports.join(",") || "default"}`).slice(0, 16)}`,
      repo_id: input.repoId,
      scan_id: input.scanId,
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate business and data-access work through service modules.",
      rationale: serviceImports.length > 0
        ? "Detected API route imports from service modules."
        : "Detected direct data-access imports; service delegation should be reviewed before enforcement.",
      scope: {
        path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        file_roles: ["api_route"]
      },
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: delegateImports.length > 0
          ? delegateImports
          : ["**/services/**", "**/server/**", "**/data-access/**"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: serviceImports.length > 0 ? "medium" : "low",
      scoring: {
        supporting_examples_count: serviceImports.length,
        counterexamples_count: dataImports.length,
        scope_files_count: apiRouteFiles.size,
        coverage_ratio: apiRouteFiles.size === 0 ? 0 : serviceImports.length / apiRouteFiles.size,
        heuristic_id: "api-route-service-delegation-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "candidate",
      created_at: input.now
    });
  }

  return candidates;
}

function looksLikeDataAccessImport(
  importSource: string,
  context?: { repoRoot: string; importerFile: string }
): boolean {
  if (rawLooksLikeDataAccessImport(importSource)) {
    return true;
  }

  const resolvedPath = context
    ? resolveImportTarget(context.repoRoot, context.importerFile, importSource)
    : undefined;
  if (!resolvedPath) {
    return false;
  }

  if (rawLooksLikeDataAccessImport(resolvedPath)) {
    return true;
  }

  return fileLooksLikeDataAccess(join(context!.repoRoot, resolvedPath));
}

function rawLooksLikeDataAccessImport(importSource: string): boolean {
  return /(^|\/|@)(db|database|prisma|drizzle|typeorm|sequelize)(\/|$)/i.test(importSource);
}

function looksLikeServiceImport(importSource: string): boolean {
  return /(^|\/|@)(services?|service-layer|use-cases?|interactors?|application)(\/|$)/i.test(importSource);
}

function resolveImportTarget(
  repoRoot: string,
  importerFile: string,
  importSource: string
): string | undefined {
  if (importSource.startsWith(".")) {
    return firstExistingImportCandidate(repoRoot, join(dirname(importerFile), importSource));
  }

  if (importSource.startsWith("@/")) {
    const withoutAlias = importSource.slice(2);
    return (
      firstExistingImportCandidate(repoRoot, withoutAlias) ??
      firstExistingImportCandidate(repoRoot, join("src", withoutAlias))
    );
  }

  for (const target of tsconfigImportTargets(repoRoot, importSource)) {
    const resolved = firstExistingImportCandidate(repoRoot, target);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function firstExistingImportCandidate(repoRoot: string, target: string): string | undefined {
  const normalized = target.replaceAll("\\", "/").replace(/^\/+/, "");
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    join(normalized, "index.ts").replaceAll("\\", "/"),
    join(normalized, "index.tsx").replaceAll("\\", "/"),
    join(normalized, "index.js").replaceAll("\\", "/"),
    join(normalized, "index.jsx").replaceAll("\\", "/")
  ];

  return candidates.find((candidate) => {
    const absolutePath = join(repoRoot, candidate);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  });
}

function tsconfigImportTargets(repoRoot: string, importSource: string): string[] {
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return [];
  }

  const tsconfig = parseJsonWithComments(readFileSync(tsconfigPath, "utf8"));
  const compilerOptions = objectValue(tsconfig.compilerOptions);
  const paths = objectValue(compilerOptions.paths);
  const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  const targets: string[] = [];

  for (const [pattern, rawMappings] of Object.entries(paths)) {
    const mappings = Array.isArray(rawMappings) ? rawMappings : [];
    const wildcard = pattern.indexOf("*");
    const match = wildcard >= 0
      ? matchWildcardPattern(importSource, pattern)
      : importSource === pattern ? "" : undefined;
    if (match === undefined) {
      continue;
    }

    for (const mapping of mappings) {
      if (typeof mapping !== "string") {
        continue;
      }
      const mapped = wildcard >= 0 ? mapping.replace("*", match) : mapping;
      targets.push(join(baseUrl, mapped).replaceAll("\\", "/"));
    }
  }

  return targets;
}

function matchWildcardPattern(value: string, pattern: string): string | undefined {
  const [prefix, suffix = ""] = pattern.split("*", 2);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return undefined;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

function parseJsonWithComments(source: string): Record<string, unknown> {
  try {
    return JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function fileLooksLikeDataAccess(absolutePath: string): boolean {
  if (!existsSync(absolutePath)) {
    return false;
  }

  const source = readFileSync(absolutePath, "utf8");
  return /@prisma\/client|new\s+PrismaClient|drizzle\s*\(|mongoose\.connect|sequelize|typeorm|pgTable|mysqlTable/i
    .test(source);
}

function doctorSymbol(status: DoctorCheck["status"]): string {
  if (status === "ok") {
    return "OK";
  }
  if (status === "warn") {
    return "WARN";
  }
  return "FAIL";
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
  if (parsed.positional[0] === "doctor") {
    return [
      "Check whether a repo is ready for Drift",
      "",
      "Usage:",
      "  drift doctor --repo-root .",
      "  drift doctor --repo-root . --state-root ~/.drift/repos --json",
      "",
      "What doctor checks:",
      "  repo path, Git state, package manifest, TS/JS files, API routes, and local state location.",
      ""
    ].join("\n");
  }

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
    if (parsed.positional[1] === "status") {
      return [
        "Show scan status",
        "",
        "Usage:",
        "  drift scan status --repo <repo_id> --json",
        "  drift --db <path> scan status --repo <repo_id> --json",
        "",
        "What status does:",
        "  shows the latest scan and compares stored file hashes to the current repo files.",
        ""
      ].join("\n");
    }

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

  if (parsed.positional[0] === "start") {
    return [
      "Start Drift onboarding",
      "",
      "Usage:",
      "  drift start --repo-root .",
      "  drift start --repo-root . --state-root ~/.drift/repos",
      "",
      "What start does:",
      "  creates local state, scans the repo, stores facts, proposes candidates, and prints next commands.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "prepare") {
    return [
      "Prepare an agent preflight packet",
      "",
      "Usage:",
      "  drift --db <path> prepare \"add user search endpoint\" --repo <repo_id> --json",
      "",
      "What prepare returns:",
      "  accepted conventions, baseline summary, open findings, relevant files, policy metadata, and next commands.",
      "  prepare is read-only and does not include source snippets.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "checks") {
    return [
      "List repo checks and safe commands",
      "",
      "Usage:",
      "  drift --db <path> checks list --repo <repo_id> --json",
      "",
      "What checks list returns:",
      "  human-approved required checks and safe commands from the repo contract.",
      "  checks list is read-only and does not run commands.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "policy") {
    return [
      "Inspect and govern context egress policy",
      "",
      "Usage:",
      "  drift --db <path> policy show --repo <repo_id> --json",
      "  drift --db <path> policy check-context --repo <repo_id> --path <file> --surface cli-preflight [--snippet-chars <n>] [--full-file] --json",
      "  drift --db <path> policy set-egress --repo <repo_id> --default-mode redacted --max-snippet-chars 1200 --deny-glob \"secrets/**\" --confirm --json",
      "  drift --db <path> policy agent grant --repo <repo_id> --agent codex --permission request_preflight --confirm --json",
      "",
      "What policy does:",
      "  shows repo context-egress settings, checks outward context surfaces, and changes governance only with --confirm.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "contract") {
    return [
      "Inspect and move repo contracts",
      "",
      "Usage:",
      "  drift --db <path> contract show --repo <repo_id> --json",
      "  drift --db <path> contract validate --repo <repo_id> --json",
      "  drift --db <path> contract export --repo <repo_id> --format json --confirm --json",
      "  drift --db <path> contract import <path> --dry-run --json",
      "  drift --db <path> contract import <path> --confirm --json",
      "",
      "Notes:",
      "  dry-run validates portable contract JSON without mutating state.",
      "  export and confirmed import write audit events for outward contract movement.",
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

  if (parsed.positional[0] === "findings") {
    return [
      "Review findings",
      "",
      "Usage:",
      "  drift --db <path> findings list --repo <repo_id> --json",
      "  drift --db <path> findings list --repo <repo_id> --status new --severity error --json",
      "  drift --db <path> findings mark-fixed <finding_id> --repo <repo_id> --evidence <file:line> --json",
      "  drift --db <path> findings suppress <finding_id> --repo <repo_id> --reason \"...\" --json",
      "  drift --db <path> findings accept-drift <finding_id> --repo <repo_id> --reason \"...\" --json",
      "  drift --db <path> findings mark-false-positive <finding_id> --repo <repo_id> --reason \"...\" --json",
      "",
      "Notes:",
      "  review actions require evidence or a reason and write append-only audit events.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "audit") {
    return [
      "Inspect audit log",
      "",
      "Usage:",
      "  drift --db <path> audit list --repo <repo_id> --json",
      "  drift --db <path> audit list --repo <repo_id> --limit 20 --json",
      "  drift --db <path> audit list --repo <repo_id> --action policy_changed --json",
      "",
      "Notes:",
      "  audit list is read-only and can filter append-only governance events by action.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "backup") {
    return [
      "Back up Drift state",
      "",
      "Usage:",
      "  drift --db <path> backup create --repo <repo_id> --json",
      "  drift --db <path> backup create --repo <repo_id> --output ./backups --json",
      "  drift --db <path> backup list --repo <repo_id> --json",
      "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --json",
      "",
      "Notes:",
      "  backup create writes one SQLite backup artifact containing Drift state, not source code.",
      "  backup verify validates schema, repo identity, and optional checksum without requiring --db.",
      "  it appends a backup_created audit event before copying the database.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "restore") {
    return [
      "Restore Drift state",
      "",
      "Usage:",
      "  drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --json",
      "",
      "Notes:",
      "  restore validates the backup schema and repo id, copies the SQLite backup into the target database,",
      "  runs current migrations, and appends a restore_completed audit event.",
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
    "First run:",
    "  drift doctor --repo-root .",
    "  drift start --repo-root . --accept-defaults",
    "",
    "Core commands:",
    "  drift scan status --repo <repo_id> --json",
    "  drift prepare \"task\" --repo <repo_id> --json",
    "  drift checks list --repo <repo_id> --json",
    "  drift check --repo <repo_id> --diff main...HEAD --scope changed-hunks --json",
    "  drift check --repo <repo_id> --diff-file <patch> --scope changed-hunks --json",
    "  drift findings list --repo <repo_id> --json",
    "  drift findings mark-fixed <finding_id> --repo <repo_id> --evidence <file:line> --json",
    "  drift findings suppress <finding_id> --repo <repo_id> --reason \"...\" --json",
    "  drift audit list --repo <repo_id> --json",
    "  drift backup create --repo <repo_id> --json",
    "  drift backup list --repo <repo_id> --json",
    "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --json",
    "  drift restore <backup.sqlite> --repo <repo_id> --json",
    "  drift contract validate --repo <repo_id> --json",
    "  drift contract export --repo <repo_id> --format json --confirm --json",
    "  drift contract import <path> --dry-run --json",
    "  drift contract import <path> --confirm --json",
    "  drift baseline create --repo <repo_id> --from main --json",
    "  drift baseline status --repo <repo_id> --json",
    "  drift policy show --repo <repo_id> --json",
    "  drift policy check-context --repo <repo_id> --path <file> --surface cli-preflight --json",
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
    "  --state-root     Local Drift state root for init, scan, start, and doctor.",
    "  --json           Emit machine-readable JSON.",
    "  --help           Show this help.",
    ""
  ].join("\n");
}

interface ParsedDiff {
  files: Array<{ path: string; changedLines: Set<number> }>;
  deletedFiles: string[];
}

interface ImportUsed {
  name: string;
  source: string;
  line: number;
  end_line: number;
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
  const deletedFiles = new Set<string>();
  let current: ParsedDiff["files"][number] | undefined;
  let oldPath: string | undefined;
  let newLine: number | undefined;

  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (current) {
        files.push(current);
      }
      const path = normalizeDiffPath(line.slice(4));
      if (!path && oldPath) {
        deletedFiles.add(oldPath);
      }
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
  return { files, deletedFiles: [...deletedFiles].sort() };
}

function fullRepoDiff(repoRoot: string): ParsedDiff {
  return {
    files: walkIndexableFiles(repoRoot).map((path) => ({
      path,
      changedLines: new Set<number>()
    })),
    deletedFiles: []
  };
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
  const imports: ImportUsed[] = [];
  const importPattern = /^\s*import\s+([\s\S]+?)\s+from\s+["']([^"']+)["']/gm;
  for (const match of source.matchAll(importPattern)) {
    const startLine = lineNumberForOffset(source, match.index ?? 0);
    const endLine = lineNumberForOffset(source, (match.index ?? 0) + match[0].length);
    for (const name of parseImportNames(match[1])) {
      imports.push({
        name,
        source: match[2],
        line: startLine,
        end_line: endLine
      });
    }
  }
  return imports;
}

function lineNumberForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
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

function isExceptedPath(filePath: string, convention: AcceptedConvention, now: string): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    (exception.path_globs ?? []).some((glob) => matchesGlob(filePath, glob))
  );
}

function isExceptedImport(
  filePath: string,
  symbol: string,
  importSource: string,
  convention: AcceptedConvention,
  now: string
): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    (
      (exception.path_globs ?? []).some((glob) => matchesGlob(filePath, glob)) ||
      (exception.symbols ?? []).includes(symbol) ||
      (exception.imports ?? []).includes(importSource)
    )
  );
}

function isActiveException(
  exception: AcceptedConvention["exceptions"][number],
  now: string
): boolean {
  return !exception.expires_at || exception.expires_at > now;
}

function isActiveConvention(convention: AcceptedConvention, now: string): boolean {
  return !convention.expires_at || convention.expires_at > now;
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

function withFlags(parsed: ParsedArgs, flags: Record<string, string>): ParsedArgs {
  const next = new Map(parsed.flags);
  for (const [key, value] of Object.entries(flags)) {
    next.set(key, value);
  }
  return {
    positional: parsed.positional,
    flags: next
  };
}

function requiredFlag(parsed: ParsedArgs, key: string): string {
  return requiredValue(stringFlag(parsed, key), `--${key}`);
}

function optionalPositiveIntegerFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsedValue;
}

function isFileLineEvidence(value: string): boolean {
  return /^[^:\n]+:\d+$/.test(value);
}

function isRepoRelativePolicyPattern(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes("..");
}

function optionalChecksumFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`--${key} must be a 64-character hex SHA-256 checksum.`);
  }
  return value.toLowerCase();
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
