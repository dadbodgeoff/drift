import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { formatConventionCandidatesText } from "../src/formatters/conventions.js";

/**
 * `conventions list` withholds candidates, and until now only the JSON surface said so.
 *
 * A7 added a coverage floor and T25 quarantined the experimental security kinds. Both wrote a
 * count and an exact reveal command into the payload, and the human formatter rendered neither -
 * so on a real repo the text surface printed `Candidates: 0 returned, 0 filtered, 35 total` and
 * stopped. A reader could see 35 candidates existed, could not learn why none were shown, and had
 * no way to find the flags: `--include-low-confidence` and `--experimental-security` appeared zero
 * times in the CLI's help text.
 *
 * The count and the command are asserted against the JSON payload rather than against literals,
 * because the failure being prevented is the two surfaces disagreeing.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Two interchangeable auth wrappers over several routes, plus one bare route. */
const wrapped = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

async function onboard(): Promise<{ repoId: string; databasePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-hidden-candidates-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/auth.ts"),
    [
      "export const withSession = (handler: unknown) => handler;",
      "export const withWorkspace = (handler: unknown) => handler;",
      ""
    ].join("\n")
  );
  for (const [index, wrapper] of ["withSession", "withWorkspace", "withSession", "withWorkspace"].entries()) {
    await mkdir(join(repoRoot, `app/api/r${index}`), { recursive: true });
    await writeFile(join(repoRoot, `app/api/r${index}/route.ts`), wrapped(wrapper));
  }
  await mkdir(join(repoRoot, "app/api/public"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/public/route.ts"),
    ["export const GET = async () => Response.json({ ok: true });", ""].join("\n")
  );
  await writeFile(join(repoRoot, "package.json"), '{"name":"hidden-candidates","version":"1.0.0"}\n');
  git(repoRoot, "init");
  git(repoRoot, "add", ".");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--now", "2026-05-10T00:00:00.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path };
}

describe("conventions list says what it withheld, in human output", () => {
  it("names the experimental-security count and the exact command that reveals it", async () => {
    const { repoId, databasePath } = await onboard();

    const asJson = await runCli(["--db", databasePath, "conventions", "list", "--repo", repoId, "--json"]);
    const payload = JSON.parse(asJson.stdout);
    // The fixture has to actually hide something, or this test passes by describing nothing.
    expect(payload.experimental_security.hidden_count).toBeGreaterThan(0);

    const asText = await runCli(["--db", databasePath, "conventions", "list", "--repo", repoId]);
    expect(asText.exitCode).toBe(0);
    expect(asText.stdout).toContain(
      `Hidden: ${payload.experimental_security.hidden_count} experimental security candidate`
    );
    // Exact, not paraphrased. A reveal command a reader has to reconstruct is one they will get
    // wrong, and it is already in the payload verbatim.
    expect(asText.stdout).toContain(`Show them: ${payload.experimental_security.reveal_command}`);
    expect(payload.experimental_security.reveal_command).toContain("--experimental-security");
  }, 60_000);

  it("says nothing when nothing was withheld", async () => {
    // The counterpart failure: a listing that claims to be hiding things it is not. With both
    // flags passed, every hidden_count is zero and neither line may appear.
    const { repoId, databasePath } = await onboard();
    const asText = await runCli([
      "--db", databasePath, "conventions", "list", "--repo", repoId,
      "--include-low-confidence", "--experimental-security"
    ]);
    expect(asText.exitCode).toBe(0);
    expect(asText.stdout).not.toContain("Hidden:");
    expect(asText.stdout).not.toContain("Show them:");
  }, 60_000);
});

describe("the candidates formatter", () => {
  const payloadWith = (lowConfidenceHidden: number, securityHidden: number) => ({
    repo_id: "repo_abc",
    status: "candidate" as const,
    filters: { status: "candidate" as const, kind: null, capability: null },
    governance: { read_only: true } as never,
    summary: {
      total_count: 35,
      filtered_count: 0,
      listed_count: 0,
      by_status: {},
      by_capability: {},
      by_kind: {}
    },
    pagination: { limit: null, offset: 0, returned_count: 0, has_more: false, next_offset: null },
    next_commands: [],
    low_confidence: {
      hidden_count: lowConfidenceHidden,
      included: false,
      floor: { min_coverage_ratio: 0.2 },
      reveal_command: "drift conventions list --repo repo_abc --include-low-confidence"
    },
    experimental_security: {
      hidden_count: securityHidden,
      included: false,
      reason: "security heuristics are experimental",
      reveal_command: "drift conventions list --repo repo_abc --experimental-security"
    },
    candidates: []
  });

  it("renders the shape a real repo produced: 0 of 35, with the reason and the way out", () => {
    const text = formatConventionCandidatesText(payloadWith(33, 2));
    expect(text).toMatchInlineSnapshot(`
      "Drift convention candidates

      Repo: repo_abc
      Status: candidate
      Kind: all
      Capability: all
      Candidates: 0 returned, 0 filtered, 35 total
      Hidden: 33 low-confidence candidates below the 20% coverage floor.
        Show them: drift conventions list --repo repo_abc --include-low-confidence
      Hidden: 2 experimental security candidates; the security heuristics are experimental and are not proofs.
        Show them: drift conventions list --repo repo_abc --experimental-security
      Page: offset 0, returned 0, next offset none
      Governance: read-only; human approval required for mutations

        none
      Next commands:

      "
    `);
  });

  it("counts one candidate in the singular", () => {
    const text = formatConventionCandidatesText(payloadWith(1, 1));
    expect(text).toContain("Hidden: 1 low-confidence candidate below the 20% coverage floor.");
    expect(text).toContain("Hidden: 1 experimental security candidate;");
  });
});

describe("help text names the flags the listing points at", () => {
  it("documents --include-low-confidence and --experimental-security", async () => {
    const help = await runCli(["conventions", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--include-low-confidence");
    expect(help.stdout).toContain("--experimental-security");
  });

  it("says that --scope full does not gate", async () => {
    // Handoff-safe wording: full scope classifies every finding as pre-existing, so it cannot
    // reach the blocking count. True whether or not the refusal being added elsewhere has landed.
    const help = await runCli(["check", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--scope full does not gate");
    expect(help.stdout).toContain("--scope changed-hunks in CI");
  });
});
