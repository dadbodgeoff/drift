#!/usr/bin/env node
/**
 * `drift prepare` quality evaluation.
 *
 * The differentiated claim is that Drift lets an agent *query* a repo's established patterns
 * rather than audit for them afterwards. That claim rests entirely on `prepare`, and it shipped
 * with no test of whether its output is any good - only that it returns something.
 *
 * It was not good. On dub, "add an endpoint that lists workspace invites" returned 25 files of
 * which 24 were arbitrary API routes matched only by "in scope for this convention" - true of
 * every route in the repo - and none matched "invite", even though dub has five invite routes
 * including the one that task is obviously about. The cause was `files.slice(0, 25)` applied in
 * filesystem-walk order, so the cap was exhausted on app/(ee)/api/admin/* before the walk ever
 * reached the relevant directory.
 *
 * So this measures precision rather than presence: for a task, do the files a developer would
 * actually open appear, and appear near the top?
 *
 * Kept out of external-eval.mjs because `prepare` takes ~50s on dub, which would triple the
 * runtime of the suite that gates every change.
 *
 *   node scripts/prepare-quality-eval.mjs
 *   node scripts/prepare-quality-eval.mjs --only dub
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

/**
 * `expectPathSubstring` names the file a developer doing this task would open. `topN` is how far
 * down the list it may appear and still be useful - an agent reads the first handful.
 */
const CASES = [
  {
    repo: "dub",
    task: "add an endpoint that lists workspace invites",
    expectPathSubstring: "api/workspaces/[idOrSlug]/invites/route.ts",
    topN: 5
  },
  {
    repo: "formbricks",
    task: "add an endpoint that returns survey responses",
    expectPathSubstring: "responses",
    topN: 5
  },
  {
    repo: "calcom",
    task: "add an endpoint that lists team bookings",
    expectPathSubstring: "bookings",
    topN: 5
  }
];

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((value) => value.trim())
    : null;

function evaluate(testCase) {
  const root = join(REPOS_DIR, testCase.repo);
  if (!existsSync(root)) {
    return { ...testCase, status: "MISSING_REPO" };
  }

  const home = mkdtempSync(join(tmpdir(), "drift-prepare-eval-"));
  const env = { ...process.env, HOME: home, DRIFT_HOME: home, DRIFT_ENGINE_BIN: ENGINE };
  delete env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;

  const run = (extraEnv, ...cliArgs) => {
    try {
      return execFileSync(process.execPath, [CLI, ...cliArgs], {
        cwd: root,
        env: { ...env, ...extraEnv },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024
      });
    } catch (error) {
      return error.stdout?.toString() ?? "";
    }
  };

  try {
    execFileSync("git", ["reset", "-q", "--hard", "HEAD"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["clean", "-qfd"], { cwd: root, stdio: "ignore" });
    run({}, "start", "--repo-root", ".", "--accept-defaults");

    const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    // The query commands need the database path explicitly; only start/scan derive it from HOME.
    const dbEnv = { DRIFT_DB: join(home, ".drift/repos", repoId, "drift.sqlite") };
    const started = Date.now();
    const output = run(dbEnv, "prepare", testCase.task, "--repo", repoId, "--json");
    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

    let files = [];
    try {
      files = (JSON.parse(output).relevant_files ?? []).map((file) => file.path);
    } catch {
      return { ...testCase, status: "UNPARSEABLE" };
    }

    const rank = files.findIndex((path) => path.includes(testCase.expectPathSubstring));
    const matching = files.filter((path) =>
      path.toLowerCase().includes(testCase.expectPathSubstring.split("/").pop().toLowerCase())
    ).length;

    return {
      ...testCase,
      status: rank >= 0 && rank < testCase.topN ? "PASS" : "FAIL",
      rank: rank >= 0 ? rank + 1 : null,
      returned: files.length,
      matching,
      seconds,
      top: files.slice(0, 3)
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const results = CASES.filter((testCase) => !only || only.includes(testCase.repo)).map(evaluate);

for (const result of results) {
  const rank = result.rank ? `rank ${result.rank}` : "NOT FOUND";
  console.log(
    `  ${result.status === "PASS" ? "ok  " : "FAIL"} ${result.repo.padEnd(11)} ${rank.padEnd(11)}` +
      ` of ${result.returned ?? "?"} returned, ${result.matching ?? 0} relevant (${result.seconds ?? "?"}s)`
  );
  if (result.status !== "PASS") {
    console.log(`       task: ${result.task}`);
    console.log(`       expected a path containing: ${result.expectPathSubstring}`);
    for (const path of result.top ?? []) console.log(`       top: ${path}`);
  }
}

const failed = results.filter((result) => result.status !== "PASS");
console.log(
  failed.length === 0
    ? `\nprepare quality: ${results.length}/${results.length} tasks surface the expected file in the top N`
    : `\n${failed.length} task(s) failed`
);
process.exit(failed.length === 0 ? 0 : 1);
