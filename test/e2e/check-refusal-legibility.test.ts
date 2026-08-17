import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * W8. A check that cannot block must not report a pass, and a refusal must say why.
 *
 * Three defects, one theme: the exit code was the only honest field, and in one scope it was not
 * honest either.
 *
 *   W8-1  `--scope full` returns `touched_existing` for every finding (check/diff.ts) and
 *         `fullRepoDiff` marks every file `isAdded: false`, so the added-file rule never fires.
 *         Only `new_in_diff` reaches `blocking_count`, so exit 2 is unreachable - a block-mode
 *         convention plus a real violation exited 0, permanently, in a mode every doc lists as an
 *         ordinary option.
 *   W8-2  the degraded refusal exited 3 with `summary.blocked_reasons` and no `failure` object,
 *         so Drift's own reference workflow - which reads `.failure.code` - printed
 *         "refusal, not a pass: unknown".
 *   W8-3  the engine subprocess had no timeout, so an engine that never exits produced no verdict
 *         at all, in a design where every other outcome is a stated one.
 *
 * Every case here drives the built CLI against a real repository with a real accepted contract,
 * obtained through `drift start --accept-defaults` - the documented scan-then-accept path - so
 * nothing is asserted about a convention the product would not actually have produced.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A real violation of the accepted data-access convention. */
const VIOLATING = `import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

/**
 * The forbidden specifier does not resolve, so the finding's own dependency chain is uncertain and
 * enforcement is withheld from it - the degradation refusal W8-2 is about. Same shape as
 * enforcement-fail-closed.test.ts, which pins the exit code; this file pins its legibility.
 */
const UNRESOLVED_OWN_CHAIN = `import { prisma } from "@/lib/prisma/not-a-real-subpath";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

interface Harness {
  run: (args: string[], env?: NodeJS.ProcessEnv) => { code: number; stdout: string };
  repoRoot: string;
}

async function setup(): Promise<Harness> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-w8-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-w8-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/enforcement-gate-adjacent"), repoRoot, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const baseEnv = {
    ...process.env,
    HOME: home,
    DRIFT_HOME: home,
    DRIFT_ENGINE_BIN: join(REPO_ROOT, "target/release/drift-engine")
  };
  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const exec = (args: string[], env: NodeJS.ProcessEnv = baseEnv) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [cli, ...args], {
          cwd: repoRoot,
          env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024
        })
      };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { code: failure.status ?? 1, stdout: failure.stdout ?? "" };
    }
  };

  exec(["start", "--repo-root", ".", "--accept-defaults"]);
  const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" }).trim();
  const db = join(home, ".drift/repos", repoId, "drift.sqlite");

  return {
    repoRoot,
    run: (args, env) => exec(["--db", db, "--repo", repoId, ...args], env ? { ...baseEnv, ...env } : baseEnv)
  };
}

async function addRoute(repoRoot: string, name: string, source: string): Promise<void> {
  await mkdir(join(repoRoot, "src/app/api", name), { recursive: true });
  await writeFile(join(repoRoot, "src/app/api", name, "route.ts"), source);
  execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });
}

interface CheckPayload {
  check?: { status?: string };
  failure?: { code?: string; type?: string; message?: string; remediation?: string };
  summary?: { blocked_reasons?: string[] };
  findings?: Array<{ enforcement_result?: string; diff_status?: string }>;
}

describe("W8-1 --scope full fails closed instead of passing by construction", () => {
  it("refuses a block-mode contract asked to enforce through --scope full, and says which scope can", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "newbad", VIOLATING);

    const result = run(["check", "--diff", "HEAD", "--scope", "full", "--json"]);

    // The whole point. Before W8-1 this was exit 0 - not because the violation was absent, but
    // because full scope cannot attribute anything to a new hunk, so nothing could ever block.
    expect(
      result.code,
      `--scope full with a block-mode convention and a real violation must not report a pass; got exit ${result.code}`
    ).not.toBe(0);
    expect(result.code).toBe(3);

    const payload = JSON.parse(result.stdout) as CheckPayload;
    expect(payload.failure?.code).toBe("full_scope_cannot_block");
    expect(payload.failure?.type).toBe("refusal");
    expect(payload.check?.status).toBe("refused");
    // A refusal a user cannot act on is barely better than a false pass, so the remediation must
    // name the scope in which the same contract does block.
    expect(payload.failure?.remediation ?? "").toContain("--scope changed-hunks");
    // The findings are reported, not hidden: withheld enforcement is not concealment.
    expect(payload.findings?.length ?? 0).toBeGreaterThan(0);
    expect((payload.summary?.blocked_reasons ?? []).join(" ")).toContain("full_scope_cannot_block");
  }, 240_000);

  it("control: the same contract and the same violation still block under --scope changed-hunks", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "newbad", VIOLATING);

    // Without this the refusal above could be over-refusal wearing a fix's clothes - a check that
    // refuses everything is also a check that never lies.
    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    expect(result.code, result.stdout.slice(0, 400)).toBe(2);
    expect((JSON.parse(result.stdout) as CheckPayload).failure).toBeUndefined();
  }, 240_000);
});

describe("W8-2 a refusal states its cause in the field CI reads", () => {
  it("gives the degraded refusal a failure code while keeping blocked_reasons", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "ownchain", UNRESOLVED_OWN_CHAIN);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    expect(result.code, result.stdout.slice(0, 400)).toBe(3);

    const payload = JSON.parse(result.stdout) as CheckPayload;
    expect(payload.failure?.code).toBe("enforcement_degraded_by_incomplete_coverage");
    expect(payload.failure?.type).toBe("refusal");
    expect(payload.failure?.remediation ?? "").not.toHaveLength(0);
    // Kept, not replaced: the reasons name the file that cost the enforcement, which the code
    // alone does not.
    expect((payload.summary?.blocked_reasons ?? []).join(" ")).toMatch(/ownchain/);
    expect(payload.check?.status).toBe("refused");
  }, 240_000);

  it("the reference workflow's own extraction resolves against a real degraded payload", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "ownchain", UNRESOLVED_OWN_CHAIN);
    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    expect(result.code).toBe(3);

    const payloadFile = join(await mkdtemp(join(tmpdir(), "drift-w8-payload-")), "drift-check.json");
    dirs.push(dirname(payloadFile));
    await writeFile(payloadFile, result.stdout);

    // The program is read out of the workflow rather than restated here. A restated copy is the
    // defect this test exists to catch, one level up: the workflow read a key nothing wrote, and
    // a test that also invented the key would have agreed with it.
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/drift-check-self.yml"), "utf8");
    const extraction = workflow.match(/REFUSAL=\$\(python3 -c "([^"]+)"/)?.[1];
    expect(extraction, "drift-check-self.yml must extract the refusal code with python3").toBeDefined();

    const code = execFileSync(
      "python3",
      ["-c", (extraction as string).replace("drift-check.json", payloadFile)],
      { encoding: "utf8" }
    ).trim();
    expect(code, "the workflow printed 'unknown' here for every degraded run").toBe(
      "enforcement_degraded_by_incomplete_coverage"
    );
  }, 240_000);
});

describe("W8-3 the engine subprocess is capped", () => {
  it("kills an engine that never exits and refuses with its own code", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "newbad", VIOLATING);

    // A stub that starts, holds its pipes open and never exits. `exec` so the signal lands on the
    // sleeping process rather than on a shell that would leave it orphaned, and a duration unique
    // to this test so the pgrep assertion below cannot match someone else's sleep.
    const stubDir = await mkdtemp(join(tmpdir(), "drift-w8-stub-"));
    dirs.push(stubDir);
    const stub = join(stubDir, "drift-engine");
    await writeFile(stub, "#!/bin/sh\nexec sleep 98765\n");
    await chmod(stub, 0o755);

    const startedAt = Date.now();
    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"], {
      DRIFT_ENGINE_BIN: stub,
      DRIFT_ENGINE_TIMEOUT_MS: "3000"
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.code, `expected a refusal, got exit ${result.code}`).toBe(3);
    const payload = JSON.parse(result.stdout) as CheckPayload;
    expect(payload.failure?.code).toBe("engine_timeout");
    expect(payload.failure?.type).toBe("refusal");
    expect(payload.check?.status).toBe("refused");
    expect(payload.findings ?? []).toHaveLength(0);

    // Returning at all is the primary evidence that the child was killed: an unkilled child holds
    // the stdio pipes this promise waits on, so the CLI would still be running. The bound makes
    // that explicit - the stub sleeps for 98765 seconds, and a cap of 3s was set.
    expect(elapsedMs, `the cap did not fire: ${elapsedMs}ms elapsed`).toBeLessThan(120_000);

    // And the process itself is gone, not merely detached from a CLI that gave up on it.
    const survivors = (() => {
      try {
        return execFileSync("pgrep", ["-f", "sleep 98765"], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    })();
    expect(survivors, "the killed engine left a live subprocess behind").toBe("");
  }, 240_000);

  it("ignores a cap that is not a positive integer rather than reading it as 'no cap'", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "newbad", VIOLATING);

    // `DRIFT_ENGINE_TIMEOUT_MS=0` is what an operator produces by unsetting the variable in a shell
    // that still exports the name. Honouring it as "off" would restore the uncapped spawn through
    // the quietest possible typo, so it falls back to the default and the real engine answers
    // normally.
    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"], {
      DRIFT_ENGINE_TIMEOUT_MS: "0"
    });
    expect(result.code, result.stdout.slice(0, 400)).toBe(2);
  }, 240_000);
});
