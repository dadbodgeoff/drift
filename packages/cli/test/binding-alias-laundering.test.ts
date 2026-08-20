import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * D-2, end to end: the same import, published six ways, through the real `drift check`.
 *
 * `export { prisma } from "@/lib/prisma"` was caught. `export const client = prisma` was not, and
 * neither was `export { prisma }`, `export { prisma as client }`, a function returning the binding,
 * or an arrow returning it. The difference is one token of syntax - a `from` clause - and it decided
 * whether the product blocked a route or reported a clean pass on its only shipped convention.
 *
 * The fixture is not four files. It carries the six laundering shapes AND eight negatives that
 * look like them, because the failure mode on this side of the fix is a walk loose enough to flag
 * a member expression or a reassigned `let`, and a fixture with no negatives cannot tell a fix
 * from an over-fit. Each negative is a DELIBERATE miss with a stated reason (R8-13), not an
 * oversight: they are pinned here so that the day one of them starts firing, it is a diff in this
 * file rather than a surprise in someone's CI.
 *
 * `bypass-fixtures.test.ts` is the sibling for the two earlier bypasses and the source of this
 * file's shape, including the `--scope full` refusal: a block-mode contract at full scope refuses
 * (exit 3) rather than reporting a pass it could never have withheld, so the exit code is asserted
 * rather than swallowed and the findings are read out of the refusal payload.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

interface Finding {
  message?: string;
  evidence_refs?: Array<{ file_path?: string }>;
}

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * One onboarding, one check, shared by every case below.
 *
 * The whole point is that a single contract - inferred from the same repo, naming one forbidden
 * specifier - produces all of these verdicts at once. Re-running it per shape would allow six
 * different contracts to be doing the work.
 */
let findingsByRoute: Map<string, Finding>;
let exitCode: number;

beforeAll(async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-alias-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-alias-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/bypass-binding-alias"), repoRoot, { recursive: true });

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

  let stdout = "";
  exitCode = 0;
  try {
    stdout = run([
      "--db", join(home, ".drift/repos", repoId, "drift.sqlite"),
      "check", "--repo", repoId, "--diff", "HEAD", "--scope", "full", "--json"
    ]);
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    exitCode = failure.status ?? 1;
    stdout = failure.stdout?.toString() ?? "";
  }

  const payload = JSON.parse(stdout) as { findings?: Finding[]; failure?: { code?: string } };
  expect(payload.failure?.code).toBe("full_scope_cannot_block");
  findingsByRoute = new Map(
    (payload.findings ?? []).map((finding) => [finding.evidence_refs?.[0]?.file_path ?? "", finding])
  );
}, 300_000);

/** The route names, in the fixture's own directory naming. */
const CAUGHT: Array<[string, string]> = [
  ["barrel", 'export { prisma } from "@/lib/prisma" - the control, caught before R8'],
  ["alias", "export const client = prisma"],
  ["detached", "export { prisma }, no from clause"],
  ["renamed", "export { prisma as client }"],
  ["factory", "export function getClient() { return prisma }"],
  ["arrow", "export const get = () => prisma"]
];

const MISSED: Array<[string, string]> = [
  ["member", "member expression; the fact model has no member path and a claim about which member would be invented"],
  ["reassigned", "reassigned let; the alias claim is false after the assignment, and deciding that needs flow-sensitive binding state"],
  ["conditional", "one branch returns something else; needs the control-flow tier"],
  ["nested", "the return belongs to an inner callback, not to the exported function"],
  ["shadowed", "the returned name is a local declaration, not the import"],
  ["asyncfn", "async returns a Promise, and resolving it is a claim about types this engine does not make"],
  ["external", "the specifier resolves nowhere in the snapshot; absence is not evidence about what a package contains"],
  ["clean1", "negative control: a route delegating through the service layer, which is what the convention exists to permit"]
];

describe("a data-layer import laundered through a local binding", () => {
  it("refuses at full scope, which is where these findings are read from", () => {
    expect(exitCode).toBe(3);
  });

  it.each(CAUGHT)("catches %s - %s", (route) => {
    expect(findingsByRoute.has(`src/app/api/${route}/route.ts`)).toBe(true);
  });

  it.each(MISSED)("does not flag %s - %s", (route) => {
    expect(findingsByRoute.has(`src/app/api/${route}/route.ts`)).toBe(false);
  });

  it("says which mechanism it followed, rather than calling every chain a re-export", () => {
    /**
     * D1 refused to reuse `re_export_used` for the new fact because the evidence span would point
     * at source text containing no `from`. A finding that told the reader to look for a re-export
     * in `export const client = prisma` would be the same untruth one layer up, and the reader who
     * opens the file and finds no re-export learns to distrust the message rather than the code.
     */
    expect(findingsByRoute.get("src/app/api/barrel/route.ts")?.message)
      .toContain("through a re-export chain");
    expect(findingsByRoute.get("src/app/api/alias/route.ts")?.message)
      .toContain("republish its binding");
  });

  it("attributes the finding to the route, naming the specifier the route wrote", () => {
    // The route imports `@/lib/factory`, not the data layer. Naming `@/lib/prisma` as the thing
    // the route imported would send the reader to a line that does not exist in that file.
    const message = findingsByRoute.get("src/app/api/factory/route.ts")?.message ?? "";

    expect(message).toContain("src/app/api/factory/route.ts");
    expect(message).toContain("@/lib/factory");
    expect(message).toContain("src/lib/prisma.ts");
  });
});
