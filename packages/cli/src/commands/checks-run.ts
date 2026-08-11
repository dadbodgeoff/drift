import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { authorizeContextExport } from "@drift/core";
import type { RequiredCheckExecution, RepoContract } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,optionalPositiveIntegerFlag,requiredNonEmptyFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { auditEvent,preflightGovernance } from "../domain/governance.js";
import { contractFingerprint,hashStable } from "../domain/identifiers.js";
import { allRequiredChecks } from "../domain/preflight.js";
import { requiredRepoContract } from "../domain/repo-paths.js";
import { gitOutput } from "../io/git.js";
import { loadDiff } from "../check/diff.js";

export async function runRequiredCheck(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<CommandPayload> {
  const repoId = resolveRepoId(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied checks run output: ${policy.reason}`);
  }

  const command = requiredNonEmptyFlag(parsed, "command");
  const requiredCheck = allRequiredChecks(contract).find((check) => check.command === command);
  if (!requiredCheck) {
    throw new Error(`Command is not required by the active repo contract: ${command}`);
  }
  if (!contract.safe_commands.some((safe) => safe.command === command)) {
    throw new Error(`Command is not an approved safe command: ${command}`);
  }

  const argv = splitCommand(command);
  const timeoutMs = optionalPositiveIntegerFlag(parsed, "timeout-ms") ?? 120000;
  const startedAt = stringFlag(parsed, "now") ?? new Date().toISOString();
  const latestScan = storage.listScanManifests(repoId)[0];
  const agentContractId = agentContractIdForRequiredCommand(contract, command);
  const executionId = `required_check_exec_${hashStable(`${repoId}:${command}:${startedAt}`).slice(0, 16)}`;
  const repoCommit = gitOutput(repo.root_path, ["rev-parse", "HEAD"]) || latestScan?.commit || "unknown";
  const gitBranch = gitOutput(repo.root_path, ["rev-parse", "--abbrev-ref", "HEAD"]) || latestScan?.branch || "unknown";
  const gitStatus = gitOutput(repo.root_path, ["status", "--porcelain"]);
  const worktreeDirty = gitStatus.length > 0 || Boolean(latestScan?.dirty);
  const untrackedFilesPresent = gitStatus.split(/\r?\n/).some((line) => line.startsWith("??"));
  const contractFingerprintValue = contractFingerprint(contract);
  const diffHash = requiredCheckDiffHash(repo.root_path, parsed);
  const lockfileHash = lockfileHashForRepo(repo.root_path);
  const executed = await executeCommand(argv, repo.root_path, timeoutMs);
  const completedAt = new Date().toISOString();
  const status: RequiredCheckExecution["status"] = executed.timedOut
    ? "timed_out"
    : executed.exitCode === 0
      ? "passed"
      : "failed";
  const auditEventId = `audit_${hashStable(`${executionId}:required_check_executed`).slice(0, 16)}`;

  const proof: RequiredCheckExecution = {
    schema_version: "drift.required_check_execution.v1",
    execution_id: executionId,
    repo_id: repoId,
    repo_root: repo.root_path,
    repo_commit: repoCommit,
    git_branch: gitBranch,
    git_commit_sha: repoCommit,
    worktree_dirty: worktreeDirty,
    untracked_files_present: untrackedFilesPresent,
    scan_id: latestScan?.id ?? null,
    repo_contract_id: contract.id,
    agent_contract_id: agentContractId,
    contract_fingerprint: contractFingerprintValue,
    repo_contract_version: contract.contract_schema_version,
    command,
    argv,
    command_hash: sha256(command),
    diff_hash: diffHash,
    lockfile_hash: lockfileHash,
    package_manager: repo.package_manager ?? null,
    cwd: repo.root_path,
    started_at: startedAt,
    completed_at: completedAt,
    timeout_ms: timeoutMs,
    exit_code: executed.exitCode,
    status,
    stdout_hash: sha256(executed.stdout),
    stderr_hash: sha256(executed.stderr),
    stdout_preview: preview(executed.stdout),
    stderr_preview: preview(executed.stderr),
    audit_event_id: auditEventId
  };

  storage.appendAuditEvent(auditEvent({
    id: auditEventId,
    repoId,
    actor: actorFlag(parsed),
    action: "required_check_executed",
    targetType: "required_check_execution",
    targetId: executionId,
    metadata: {
      command,
      command_hash: proof.command_hash,
      status,
      exit_code: executed.exitCode,
      scan_id: proof.scan_id,
      repo_contract_id: contract.id,
      contract_fingerprint: contractFingerprintValue,
      diff_hash: diffHash
    },
    createdAt: completedAt
  }));
  storage.recordRequiredCheckExecution(proof);

  const payload = {
    response_schema: "drift.required-check-execution.v1",
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    execution: proof,
    summary: {
      command,
      status,
      passed: status === "passed",
      exit_code: executed.exitCode,
      timed_out: executed.timedOut,
      worktree_dirty: worktreeDirty,
      diff_hash: diffHash,
      contract_fingerprint: contractFingerprintValue
    }
  };

  return {
    exitCode: status === "passed" ? 0 : 1,
    payload
  };
}

function requiredCheckDiffHash(repoRoot: string, parsed: ParsedArgs): string {
  if (!parsed.flags.has("diff") && !parsed.flags.has("diff-file")) {
    return "no_diff";
  }
  return sha256(loadDiff(repoRoot, parsed));
}

function lockfileHashForRepo(repoRoot: string): string | null {
  for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    const path = `${repoRoot}/${name}`;
    if (existsSync(path)) {
      return sha256(readFileSync(path, "utf8"));
    }
  }
  return null;
}

function executeCommand(argv: string[], cwd: string, timeoutMs: number): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
}

function splitCommand(command: string): string[] {
  const tokens = command.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return tokens.map((token) =>
    token.startsWith("\"") || token.startsWith("'")
      ? token.slice(1, -1)
      : token
  );
}

function agentContractIdForRequiredCommand(contract: RepoContract, command: string): string {
  for (const agentContract of contract.agent_contracts ?? []) {
    if (agentContract.kind !== "required_change_checks") {
      continue;
    }
    if (agentContract.rules.some((rule) =>
      rule.required_checks.some((check) => check.command === command)
    )) {
      return agentContract.id;
    }
  }
  return "repo_contract_required_checks";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function preview(value: string): string {
  return value.slice(0, 4000);
}
