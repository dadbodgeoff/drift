import { execFileSync } from "node:child_process";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FindingSchema } from "../../core/src/schemas.js";

/**
 * EW-1 / S10, red #3: symbol-free evidence.
 *
 * `import "@/lib/prisma";` binds nothing. Every other finding this codebase produces carries a
 * symbol in its evidence, and the evidence builder reads that symbol straight off the
 * `import_used` fact's local name - which for a side-effect import is the internal
 * `(side-effect)` sentinel. A sentinel is a fine key for binding-keyed lookups inside the
 * engine and a lie in a user-facing evidence payload, so the two tests below pin the shape of
 * the payload rather than just the existence of the finding:
 *
 *   - `import_source` is present and names the module, because with no symbol it is the only
 *     thing that identifies what the route depends on;
 *   - `symbol` is absent, not the sentinel and not an empty string (the schema forbids empty,
 *     so a naive `?? ""` would fail validation rather than degrade quietly);
 *   - the whole record still validates against `FindingSchema`.
 *
 * These run against the built CLI and the release engine, the same path every finding travels,
 * because the evidence payload is assembled in the CLI from engine output - a Rust-level test
 * cannot see it.
 */

// vitest runs with cwd at the package, so anchor on this file instead of the process cwd.
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface CheckPayload {
  findings?: Array<Record<string, unknown>>;
}

async function checkFixture(fixture: string): Promise<CheckPayload> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-side-effect-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-side-effect-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures", fixture), repoRoot, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const env = {
    ...process.env,
    HOME: home,
    DRIFT_HOME: home,
    DRIFT_ENGINE_BIN: join(REPO_ROOT, "target/release/drift-engine")
  };
  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const run = (args: string[]) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });

  run(["start", "--repo-root", ".", "--accept-defaults"]);
  const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" }).trim();
  return JSON.parse(
    run([
      "--db", join(home, ".drift/repos", repoId, "drift.sqlite"),
      "check", "--repo", repoId, "--diff", "HEAD", "--scope", "full", "--json"
    ])
  ) as CheckPayload;
}

describe("side-effect import evidence", () => {
  it("attributes a finding to the route that only side-effect-imports the data layer", async () => {
    const payload = await checkFixture("side-effect-import-finding");
    const findings = payload.findings ?? [];

    const sideEffect = findings.filter((finding) => {
      const refs = finding.evidence_refs as Array<{ file_path?: string }> | undefined;
      return (refs?.[0]?.file_path ?? "").includes("sideeffect");
    });

    expect(sideEffect, "a bindingless import of the forbidden module executes it").toHaveLength(1);
  }, 180_000);

  it("emits well-formed evidence with no symbol and the specifier intact", async () => {
    const payload = await checkFixture("side-effect-import-finding");
    const finding = (payload.findings ?? []).find((candidate) => {
      const refs = candidate.evidence_refs as Array<{ file_path?: string }> | undefined;
      return (refs?.[0]?.file_path ?? "").includes("sideeffect");
    });
    expect(finding, "the side-effect route must be flagged before its payload can be judged")
      .toBeDefined();

    const evidence = (finding!.evidence_refs as Array<Record<string, unknown>>)[0];

    expect(evidence.import_source, "with no symbol, the specifier is the whole identification")
      .toBe("@/lib/prisma");
    expect(
      evidence.symbol,
      "a side-effect import binds nothing; the `(side-effect)` sentinel is an engine-internal " +
        "lookup key and must never surface as a symbol a user could search for"
    ).toBeUndefined();

    // Schema-valid as a whole, not just field-by-field: `symbol` is `z.string().min(1)`, so
    // both the sentinel-leak and an empty-string stand-in have to be excluded by the same
    // assertion that proves the record is storable.
    const parsed = FindingSchema.safeParse(finding);
    expect(
      parsed.success ? null : parsed.error.issues,
      "a symbol-free finding must still validate"
    ).toBeNull();
  }, 180_000);
});
