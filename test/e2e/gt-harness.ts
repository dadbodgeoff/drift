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
