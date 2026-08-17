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
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
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

/** What a caller needs in order to author a portable contract for the temp repo. */
export interface ImportedContractContext {
  repoId: string;
  contractId: string;
  repoFingerprint: string;
  now: string;
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
  /**
   * A unified diff for `check --diff-file`, when the run needs a diff to classify against.
   *
   * `--scope full` classifies every finding `touched_existing` by construction
   * (`crates/drift-engine/src/diff.rs:137`), and `blockingCount` counts only `new_in_diff`
   * (`packages/cli/src/check/run-check.ts:821`) — so a full-scope check can never exit 2, however
   * real its findings. A canary that wants to assert the blocked exit code has to supply the diff
   * the exit code is about, and pass `scope: "changed-hunks"` with it.
   */
  diffPatch?: string;
  /**
   * Conventions to install through `drift contract import`, for kinds the proposer cannot emit.
   *
   * THIS IS A NARROW EXCEPTION AND IT IS NOT A BACK DOOR. `acceptKinds` above is the only path a
   * *proposable* kind may take, because a hand-built convention proves nothing about the
   * proposer-to-prover seam. Two kinds have no proposer at all
   * (`api_route_forbids_secret_exposure`, `session_object_must_come_from_trusted_helper`: zero
   * `ConventionKind::` occurrences in candidate_command.rs), so for those the documented
   * `drift contract import drift.lock --repo <id> --confirm` (docs/agent-integration.md:84) is
   * the *only* way the enforcement arm is reachable at all, and a canary that refuses it is
   * asserting the absence of a path rather than testing the one that exists.
   *
   * What keeps it honest: the contract goes through the real CLI command — schema validation,
   * `hasConventionEvaluator`, fingerprint compatibility, `--confirm` — and this helper never calls
   * `storage.upsertAcceptedConvention`. A caller that uses this for a proposable kind is faking,
   * and `assertNoProposerFor` below exists so the canary must prove it isn't.
   */
  importConventions?: (context: ImportedContractContext) => readonly unknown[];
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
  /** `contract import --json` payload, or null when no contract was imported. */
  importPayload: any | null;
  /** Absolute path of the hand-authored contract file, or null. */
  importedContractPath: string | null;
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

    let importPayload: any | null = null;
    let importedContractPath: string | null = null;
    if (options.importConventions) {
      const contractId = `contract_${repoId}`;
      const importNow = nextNow();
      const conventions = options.importConventions({
        repoId,
        contractId,
        repoFingerprint: readRepoFingerprint(databasePath, repoId),
        now: importNow
      });
      importedContractPath = join(dir, "drift.lock");
      await writeFile(
        importedContractPath,
        `${JSON.stringify(
          portableContract({
            repoId,
            contractId,
            repoFingerprint: readRepoFingerprint(databasePath, repoId),
            now: importNow
          }, conventions),
          null,
          2
        )}\n`
      );
      const imported = await runCli([
        "--db", databasePath,
        "contract", "import", importedContractPath,
        "--repo", repoId,
        "--now", importNow,
        "--confirm",
        "--json"
      ]);
      expect(
        imported.exitCode,
        `${options.fixture} contract import stderr:\n${imported.stderr}\nstdout:\n${imported.stdout}`
      ).toBe(0);
      importPayload = parseJson(imported.stdout, `${options.fixture} contract import`);
      expect(
        importPayload.imported,
        `${options.fixture}: contract import reported no write. Compatibility: ` +
          `${JSON.stringify(importPayload.compatibility)}`
      ).toBe(true);
    }

    const checkArgs = [
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--scope", options.scope ?? "full",
      "--now", nextNow(),
      "--json"
    ];
    if (options.diffPatch !== undefined) {
      const diffPath = join(dir, "diff.patch");
      await writeFile(diffPath, options.diffPatch);
      checkArgs.push("--diff-file", diffPath);
    }
    const check = await runCli(checkArgs);
    const checkPayload = parseJson(check.stdout, `${options.fixture} check`);

    return {
      repoRoot,
      stateRoot,
      databasePath,
      repoId,
      scanPayload,
      startPayload,
      acceptPayloads,
      importPayload,
      importedContractPath,
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
 * The portable identity of the temp repo, read from the repo row `scan` created.
 *
 * `contract import` compares the file's `repo_fingerprint` against this and refuses on mismatch,
 * so a contract cannot be imported into a repository it was not written for. The value is the
 * repo's own, never invented here.
 */
function readRepoFingerprint(databasePath: string, repoId: string): string {
  const storage = openDriftStorage({ databasePath });
  try {
    const repo = storage.getRepo(repoId);
    expect(repo, `no repo row for ${repoId}`).toBeTruthy();
    return (repo as { fingerprint: string }).fingerprint;
  } finally {
    storage.close();
  }
}

/**
 * The smallest `RepoContract` that `contract import` accepts, wrapped around the caller's
 * conventions.
 *
 * Everything outside `conventions` is contract boilerplate the schema requires and this exercise
 * has no opinion about — the caller supplies the only part under test.
 */
function portableContract(
  context: ImportedContractContext,
  conventions: readonly unknown[]
): Record<string, unknown> {
  return {
    id: context.contractId,
    repo_id: context.repoId,
    contract_schema_version: 1,
    repo_fingerprint: context.repoFingerprint,
    created_at: context.now,
    updated_at: context.now,
    conventions,
    rejected_inferences: [],
    waivers: [],
    risky_areas: [],
    safe_commands: [],
    required_checks: [],
    context_egress: {
      default_mode: "local_only",
      denied_globs: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: [],
    agent_contracts: []
  };
}

/**
 * The precondition on `importConventions`: this kind has no proposer, on this repo, right now.
 *
 * Asserted from the run rather than from a grep, so the day someone teaches the proposer to emit
 * the kind, the canary that took the import shortcut fails and has to be rewritten as a real
 * `acceptKinds` workflow instead of quietly continuing to test the weaker path.
 */
export function assertNoProposerFor(result: WorkflowResult, kind: string, label: string): void {
  const kinds = (result.startPayload.candidates ?? []).map((candidate: any) => candidate.kind);
  expect(
    kinds,
    `${label}: the proposer emitted ${kind}. Contract import is permitted only for kinds with no ` +
      `proposer; this one now has one, so the canary must go through conventions accept instead.`
  ).not.toContain(kind);
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
