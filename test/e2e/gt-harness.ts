// Ground-truth audit harness (TDD §4.1, phase 0a).
//
// The audit found a P0 (D1) that three existing tests could not see, because all three
// hand-build the accepted convention — two with `"source": "contract"`, one via
// `storage.upsertAcceptedConvention`. Every one of them starts downstream of the seam that
// was actually broken: the proposer emits a `source` value the prover discards.
//
// So the defining property of this harness is negative. It obtains its convention from the
// candidate proposer by running the documented workflow, and it never calls
// `upsertAcceptedConvention` and never hand-writes a `requires` block. A test that injects
// its convention is not evidence for any conclusion this plan draws.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

/**
 * `pnpm build:engine` builds *release*, but the e2e suite runs the *debug* binary. A stale
 * debug binary silently tests old engine behaviour against new TypeScript, and presents as
 * "my fix didn't take" — an hour into a track, when nobody is re-reading setup notes. So the
 * harness rebuilds it rather than documenting that someone else should.
 */
export const DEBUG_ENGINE = resolve("target/debug/drift-engine");

let debugEngineBuilt = false;

export function ensureDebugEngine(): void {
  if (debugEngineBuilt) return;
  execFileSync("cargo", ["build", "-p", "drift-engine"], {
    cwd: resolve("."),
    stdio: "inherit"
  });
  debugEngineBuilt = true;
}

const tempDirs: string[] = [];

export async function cleanupGtTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export interface WorkflowOptions {
  /** Fixture directory name under test/fixtures, gt- prefix included. */
  fixture: string;
  /** Candidate kinds to accept. Every candidate of a listed kind is accepted. */
  acceptKinds?: readonly string[];
  severity?: string;
  mode?: string;
  scope?: "full" | "changed-hunks";
  now?: string;
}

export interface WorkflowResult {
  repoRoot: string;
  stateRoot: string;
  databasePath: string;
  repoId: string;
  scanPayload: any;
  startPayload: any;
  /** One entry per `conventions accept` invocation, in acceptance order. */
  acceptPayloads: any[];
  checkPayload: any;
  checkExitCode: number;
  checkStderr: string;
}

function parseJson(stdout: string, label: string): any {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label}: stdout was not JSON:\n${stdout.slice(0, 2000)}`);
  }
}

/**
 * Runs the documented workflow end to end: scan -> start -> conventions accept -> check.
 *
 * The `conventions accept` step is the whole point. It is the only way a test in this repo
 * exercises the proposer-to-prover seam, and it is the step all three pre-existing tests of
 * D1's kind skip.
 */
export async function runGtWorkflow(options: WorkflowOptions): Promise<WorkflowResult> {
  ensureDebugEngine();

  const previousEngineBin = process.env.DRIFT_ENGINE_BIN;
  process.env.DRIFT_ENGINE_BIN = DEBUG_ENGINE;

  try {
    const dir = await mkdtemp(join(tmpdir(), "drift-gt-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await cp(resolve("test/fixtures", options.fixture), repoRoot, { recursive: true });

    // The audit log is append-only and keys events partly on the timestamp, so reusing one
    // `--now` across steps collides ("event ... already exists"). Step the clock instead.
    const baseNow = Date.parse(options.now ?? "2026-08-16T00:00:00.000Z");
    let step = 0;
    const nextNow = (): string => new Date(baseNow + step++ * 1000).toISOString();

    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", nextNow(),
      "--json"
    ]);
    expect(scan.exitCode, `${options.fixture} scan stderr:\n${scan.stderr}`).toBe(0);
    const scanPayload = parseJson(scan.stdout, `${options.fixture} scan`);

    const start = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", nextNow(),
      "--json"
    ]);
    expect(start.exitCode, `${options.fixture} start stderr:\n${start.stderr}`).toBe(0);
    const startPayload = parseJson(start.stdout, `${options.fixture} start`);

    assertEngineIdentity(startPayload, options.fixture);

    const databasePath: string = startPayload.database_path;
    const repoId: string = startPayload.repo.id;

    const acceptPayloads: any[] = [];
    for (const kind of options.acceptKinds ?? []) {
      const candidates = (startPayload.candidates ?? []).filter((c: any) => c.kind === kind);
      expect(
        candidates.length,
        `${options.fixture}: proposer emitted no candidate of kind ${kind}. ` +
          `Candidates were: ${JSON.stringify((startPayload.candidates ?? []).map((c: any) => c.kind))}. ` +
          `The harness must not fabricate one — see the injection ban in TDD §4.1.`
      ).toBeGreaterThan(0);

      for (const candidate of candidates) {
        const args = ["--db", databasePath, "conventions", "accept", candidate.id];
        if (options.severity) args.push("--severity", options.severity);
        if (options.mode) args.push("--mode", options.mode);
        args.push("--confirm", "--json");
        const accepted = await runCli(args);
        expect(
          accepted.exitCode,
          `${options.fixture} accept ${candidate.id} stderr:\n${accepted.stderr}`
        ).toBe(0);
        acceptPayloads.push(parseJson(accepted.stdout, `${options.fixture} accept`));
      }
    }

    const check = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--scope", options.scope ?? "full",
      "--now", nextNow(),
      "--json"
    ]);
    const checkPayload = parseJson(check.stdout, `${options.fixture} check`);

    return {
      repoRoot,
      stateRoot,
      databasePath,
      repoId,
      scanPayload,
      startPayload,
      acceptPayloads,
      checkPayload,
      checkExitCode: check.exitCode,
      checkStderr: check.stderr
    };
  } finally {
    if (previousEngineBin === undefined) {
      delete process.env.DRIFT_ENGINE_BIN;
    } else {
      process.env.DRIFT_ENGINE_BIN = previousEngineBin;
    }
  }
}

export interface ContractImportOptions {
  /** Fixture directory name under test/fixtures. */
  fixture: string;
  /**
   * Kinds this run intends to enforce by import. The helper asserts the proposer emitted NONE of
   * them, which is the only condition under which importing a hand-authored convention is honest
   * rather than a way around `conventions accept`. A kind the proposer can emit belongs in
   * `runGtWorkflow`.
   */
  importedKinds: readonly string[];
  /**
   * Receives the contract as `drift contract export` wrote it — real `repo_id`, real
   * `repo_fingerprint`, whatever conventions the workflow itself accepted — and returns the
   * contract to import. Push conventions onto `contract.conventions`; do not rebuild the envelope,
   * because the envelope is what makes the import a round-trip of the repo's own contract rather
   * than a fabrication.
   */
  amendContract: (contract: any, context: { repoId: string; contractId: string; now: string }) => any;
  now?: string;
}

export interface ContractImportResult {
  repoRoot: string;
  stateRoot: string;
  databasePath: string;
  repoId: string;
  contractPath: string;
  scanPayload: any;
  startPayload: any;
  exportedContract: any;
  /** `contract import --dry-run --json`, run before the write so its verdict is on record. */
  dryRunPayload: any;
  dryRunExitCode: number;
  importPayload: any;
  importExitCode: number;
  /** Runs `drift check` against the imported contract. Callable more than once. */
  check: (options?: {
    scope?: "full" | "changed-files" | "changed-hunks";
    /** Unified diff text; written to a temp file and passed as `--diff-file`. */
    diff?: string;
  }) => Promise<{ exitCode: number; payload: any; stderr: string }>;
}

/**
 * The documented workflow for the kinds that have no proposer: scan -> start -> contract export
 * -> edit -> contract import -> check (`docs/agent-integration.md`, "Sharing a contract").
 *
 * `runGtWorkflow` cannot reach `session_object_must_come_from_trusted_helper` or
 * `api_route_forbids_secret_exposure` because `candidate_command.rs` contains zero occurrences of
 * either — no candidate of those kinds has ever existed, so there is nothing to `conventions
 * accept`. Import is the one route left, and it is a real, documented, user-reachable one, which
 * is why an arm reached this way is `firing` rather than `unimplemented`.
 *
 * The discipline that keeps this from becoming the injection the §4.1 ban exists to prevent:
 *
 *  - `importedKinds` is asserted ABSENT from the proposer's output. The moment a proposer starts
 *    emitting one of these kinds, this helper fails and the test must move to `runGtWorkflow`.
 *  - The contract is obtained from `drift contract export` and handed back for amendment, so its
 *    `repo_fingerprint` and `repo_id` are the repo's own. A hand-built envelope would sail past the
 *    import compatibility checks that a real user's contract has to satisfy.
 *  - The write goes through `drift contract import --confirm`, so every refusal a user would hit —
 *    fingerprint mismatch, unsupported schema, `convention_kind_has_no_evaluator`, blocking a
 *    non-deterministic capability — applies here too. Nothing calls `upsertAcceptedConvention`.
 *
 * `start` runs with `--accept-defaults` because that is what materialises a contract row for
 * `contract export` to read; with no candidates it materialises an empty one.
 */
export async function runGtContractImportWorkflow(
  options: ContractImportOptions
): Promise<ContractImportResult> {
  ensureDebugEngine();

  const previousEngineBin = process.env.DRIFT_ENGINE_BIN;
  process.env.DRIFT_ENGINE_BIN = DEBUG_ENGINE;

  try {
    const dir = await mkdtemp(join(tmpdir(), "drift-gt-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await cp(resolve("test/fixtures", options.fixture), repoRoot, { recursive: true });

    const baseNow = Date.parse(options.now ?? "2026-08-16T00:00:00.000Z");
    let step = 0;
    const nextNow = (): string => new Date(baseNow + step++ * 1000).toISOString();

    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", nextNow(),
      "--json"
    ]);
    expect(scan.exitCode, `${options.fixture} scan stderr:\n${scan.stderr}`).toBe(0);
    const scanPayload = parseJson(scan.stdout, `${options.fixture} scan`);

    const start = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", nextNow(),
      "--accept-defaults",
      "--json"
    ]);
    expect(start.exitCode, `${options.fixture} start stderr:\n${start.stderr}`).toBe(0);
    const startPayload = parseJson(start.stdout, `${options.fixture} start`);

    assertEngineIdentity(startPayload, options.fixture);

    const databasePath: string = startPayload.database_path;
    const repoId: string = startPayload.repo.id;

    const proposedKinds = (startPayload.candidates ?? []).map((candidate: any) => candidate.kind);
    for (const kind of options.importedKinds) {
      expect(
        proposedKinds,
        `${options.fixture}: the proposer emitted a candidate of kind ${kind}. Import is only an ` +
          `honest route for kinds that have no proposer at all — accept it through ` +
          `runGtWorkflow instead.`
      ).not.toContain(kind);
    }

    const contractPath = join(dir, "drift.lock");
    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", repoId,
      "--output", contractPath,
      "--now", nextNow(),
      "--confirm", "--json"
    ]);
    expect(
      exported.exitCode,
      `${options.fixture} contract export stderr:\n${exported.stderr}`
    ).toBe(0);
    const exportedContract = JSON.parse(readFileSync(contractPath, "utf8"));

    const amended = options.amendContract(exportedContract, {
      repoId,
      contractId: exportedContract.id,
      now: nextNow()
    });
    writeFileSync(contractPath, `${JSON.stringify(amended, null, 2)}\n`);

    const dryRun = await runCli([
      "--db", databasePath,
      "contract", "import", contractPath,
      "--repo", repoId,
      "--now", nextNow(),
      "--dry-run", "--json"
    ]);
    const dryRunPayload = parseJson(dryRun.stdout, `${options.fixture} contract import --dry-run`);

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import", contractPath,
      "--repo", repoId,
      "--now", nextNow(),
      "--confirm", "--json"
    ]);
    const importPayload = parseJson(imported.stdout, `${options.fixture} contract import`);

    const check = async (
      checkOptions: {
        scope?: "full" | "changed-files" | "changed-hunks";
        diff?: string;
      } = {}
    ): Promise<{ exitCode: number; payload: any; stderr: string }> => {
      const args = ["--db", databasePath, "check", "--repo", repoId];
      if (checkOptions.diff !== undefined) {
        const diffPath = join(dir, `check-${step}.patch`);
        writeFileSync(diffPath, checkOptions.diff);
        args.push("--diff-file", diffPath);
      }
      args.push("--scope", checkOptions.scope ?? "full", "--now", nextNow(), "--json");
      const result = await runCli(args);
      return {
        exitCode: result.exitCode,
        payload: parseJson(result.stdout, `${options.fixture} check`),
        stderr: result.stderr
      };
    };

    return {
      repoRoot,
      stateRoot,
      databasePath,
      repoId,
      contractPath,
      scanPayload,
      startPayload,
      exportedContract,
      dryRunPayload,
      dryRunExitCode: dryRun.exitCode,
      importPayload,
      importExitCode: imported.exitCode,
      check
    };
  } finally {
    if (previousEngineBin === undefined) {
      delete process.env.DRIFT_ENGINE_BIN;
    } else {
      process.env.DRIFT_ENGINE_BIN = previousEngineBin;
    }
  }
}

/**
 * Fails loudly at setup, with a legible message, when the run is not driving the binary it
 * thinks it is. Without this, a stale or wrong engine surfaces later as an inexplicable
 * assertion result and gets debugged as a logic bug.
 */
export function assertEngineIdentity(startPayload: any, label: string): void {
  const engine = startPayload?.engine;
  expect(engine, `${label}: start --json reported no engine block`).toBeTruthy();
  expect(
    engine.checksum_matches,
    `${label}: engine checksum mismatch — sha256=${engine.sha256} expected=${engine.expected_sha256} ` +
      `at ${engine.path}. The binary under test is not the one that was built.`
  ).toBe(true);
  expect(
    engine.path,
    `${label}: the run drove ${engine.path}, not the debug binary the e2e suite targets ` +
      `(${DEBUG_ENGINE}). pnpm build:engine builds release; this suite needs debug.`
  ).toBe(DEBUG_ENGINE);
}

/** Reads facts of a kind out of the state DB, normalised and volatile ids dropped. */
export function readFacts(
  databasePath: string,
  scanId: string,
  kind: string
): Array<Record<string, unknown>> {
  const storage = openDriftStorage({ databasePath });
  try {
    return storage
      .listFacts(scanId, { kind })
      .map((fact: any) => ({
        kind: fact.kind,
        name: fact.name,
        value: fact.value,
        file_path: fact.file_path,
        imported_name: fact.imported_name
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  } finally {
    storage.close();
  }
}

export interface GtFinding {
  kind: string | undefined;
  file_path: string | undefined;
  status: string;
  severity: string;
  enforcement_result: string;
  message: string;
}

/**
 * Reads findings out of the state DB, normalised and volatile ids dropped.
 *
 * A finding row carries neither a file path nor a convention kind directly: the path lives on
 * its first evidence ref, and the kind has to be resolved through `convention_id`. Both are
 * what assertions actually want to name, so resolve them here rather than in every test.
 */
export function readFindings(databasePath: string, repoId: string): GtFinding[] {
  const storage = openDriftStorage({ databasePath });
  try {
    const kindByConventionId = new Map<string, string>(
      storage.listAcceptedConventions(repoId).map((convention: any) => [convention.id, convention.kind])
    );
    return storage
      .listFindings(repoId)
      .map((finding: any) => ({
        kind: kindByConventionId.get(finding.convention_id),
        file_path: finding.evidence_refs?.[0]?.file_path,
        status: finding.status,
        severity: finding.severity,
        enforcement_result: finding.enforcement_result,
        message: finding.message
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  } finally {
    storage.close();
  }
}

/** Paths flagged by findings, optionally narrowed to one convention kind. */
export function flaggedPaths(findings: GtFinding[], kind?: string): string[] {
  return findings
    .filter((finding) => (kind ? finding.kind === kind : true))
    .map((finding) => finding.file_path)
    .filter((path): path is string => typeof path === "string")
    .sort();
}
