// PR/CI mode (S8): for finished runs, rebuild the agent's change as a pull request would carry
// it (a diff against the pinned commit) and run `drift check` the way the GitHub action does:
// the exit code of `drift check` (fails on new violations of block-mode conventions), the
// `--strict` exit code, and SARIF for code scanning. Answers "would Drift in CI have caught what
// the agent left?" without in-session hooks (by default for the control arm).
//
//   node eval/agent-ab/v2/ci.mjs --drift <bin> --repos <dir> --work <dir> [--arm control|drift|all] [--run id,id] [--jobs 3]
//
// Writes <work>/runs/<run>/ci-pr/{pr.diff, drift.sarif, check.txt, ci.json} and prints a table.
// run.mjs already computes the same check on the agent's worktree before removing it
// (runs/<run>/ci); this script re-derives it from the saved patch alone, so it also works
// with another Drift build or policy (--policy-work <dir> to take policies from elsewhere).

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, buildPolicy, hideHarnessFiles, installPolicy, loadLabels, readJson, run, withWorktree } from "./lib.mjs";
import { ciCheck } from "./score.mjs";

const a = args();
const drift = resolve(a.drift);
const repos = resolve(a.repos);
const work = resolve(a.work);
const policyWork = resolve(a["policy-work"] ?? work);
const arm = a.arm ?? "control";
const jobs = Math.min(Number(a.jobs ?? 3), 6);
const labels = loadLabels();
const ids = (a.run ? String(a.run).split(",") : readdirSync(join(work, "runs"))).filter((id) => {
  const m = readJson(join(work, "runs", id, "meta.json"));
  return m && existsSync(join(work, "runs", id, "changes.patch")) && (arm === "all" || m.arm === arm);
});

const out = [];
const queue = [...ids];
async function worker() {
  while (queue.length) {
    const id = queue.shift();
    const runDir = join(work, "runs", id);
    const meta = readJson(join(runDir, "meta.json"));
    const score = readJson(join(runDir, "score.json"), {});
    const { dir: policyDir } = await buildPolicy({ work: policyWork, repos, repo: meta.repo, drift, labels });
    const wt = join(work, "wt", `ci-${id}`);
    await withWorktree(join(repos, meta.repo), wt, async () => {
      const dest = join(runDir, "ci-pr");
      mkdirSync(dest, { recursive: true });
      hideHarnessFiles(wt, join(dest, "exclude"));
      installPolicy(policyDir, wt);
      copyFileSync(join(runDir, "changes.patch"), join(dest, "pr.diff"));
      const ap = run("git", ["apply", "--whitespace=nowarn", join(dest, "pr.diff")], wt);
      const ci = ap.code === 0 || !readJson(join(runDir, "final.json"))?.changed?.length ? ciCheck(drift, wt, dest) : { error: `git apply failed: ${ap.stderr.slice(0, 300)}` };
      writeFileSync(join(dest, "ci.json"), JSON.stringify(ci, null, 2));
      out.push({ id, task: meta.task, arm: meta.arm, model: meta.model, left: score.final_violations ?? null, ...ci });
    });
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

console.log(`| Run | violations left in changed files | CI exit | strict exit | SARIF results | rules |`);
console.log(`| --- | --- | --- | --- | --- | --- |`);
for (const r of out.sort((x, y) => x.id.localeCompare(y.id)))
  console.log(`| ${r.id} | ${r.left ?? "?"} | ${r.error ? "error" : r.exit} | ${r.exit_strict ?? "–"} | ${r.sarif_results ?? "–"} | ${(r.sarif_rules ?? []).join(", ")} |`);
const left = out.filter((r) => r.left > 0);
console.log(`\n${left.length} of ${out.length} runs left violations; CI would have failed ${left.filter((r) => r.exit !== 0).length} of them; ${out.filter((r) => r.exit !== 0 && !(r.left > 0)).length} CI failures with nothing left in changed files.`);
writeFileSync(join(work, `ci-${arm}.json`), JSON.stringify(out, null, 2));
