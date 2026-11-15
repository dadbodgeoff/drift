// Check the task suite before spending money on it:
// - every task's target paths land in a role with at least one reviewer-accepted convention
//   (asked of `drift example <path>` with only that convention active, one at a time);
// - every convention a task claims to exercise covers one of its targets;
// - prompts never mention conventions, auth, Drift or "follow patterns";
// - for a target that does not exist yet, `drift example` matches on directory and file kind only
//   (it ignores the symbol kind), so each claimed convention is also checked on a stub: the
//   convention's own example file copied to the target path, which then has real symbols;
// - the suite spans >= 6 repos and all six categories.
//
//   node eval/agent-ab/v2/verify-tasks.mjs --drift <bin> --repos <dir> --work <dir> [--only id,id] [--write-expect]
//
// Writes <work>/verify.json with the covering conventions per target. --write-expect records the
// accepted conventions of each policy in policy-expect.json (for a new drift build, after the
// tasks were re-verified); without it, a policy that does not match policy-expect.json fails.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { EXPECT_FILE, args, buildPolicy, fileHash, here, loadLabels, parseConventions, readJson, run, withWorktree, writeJson } from "./lib.mjs";

const a = args();
const drift = resolve(a.drift);
const repos = resolve(a.repos);
const work = resolve(a.work);
const suite = readJson(a.tasks ? resolve(a.tasks) : join(here, "tasks.json"));
const only = a.only ? String(a.only).split(",") : null;
const tasks = suite.tasks.filter((t) => !only || only.includes(t.id));
const labels = loadLabels();

const BANNED = /convention|\bauth|drift|pattern|guard|permission|decorat|wrapper|middleware|lint|best practice|consistent/i;
const problems = [];
for (const t of tasks) {
  for (const p of t.prompts ?? [t.prompt]) {
    const m = p.match(BANNED);
    if (m) problems.push(`${t.id}: prompt mentions "${m[0]}"`);
  }
  if (!t.targets?.length) problems.push(`${t.id}: no targets`);
  if (!t.exercises?.length) problems.push(`${t.id}: no exercised conventions`);
  if (!"abcdef".includes(t.category)) problems.push(`${t.id}: bad category ${t.category}`);
  if (t.category === "f" && (t.prompts?.length ?? 0) < 3) problems.push(`${t.id}: long session needs 3 prompts`);
  for (const id of t.exercises ?? []) if (labels.get(id)?.label !== "ACCEPT") problems.push(`${t.id}: ${id} is not ACCEPT-labelled`);
}

/** Policy text with only one convention accepted (the rest rejected). */
function isolate(yaml, keep) {
  return yaml
    .split(/\n(?=- id: )/)
    .map((c) => (c.startsWith("- id:") ? c.replace(/\n  status: \S+/, `\n  status: ${c.startsWith(`- id: ${keep}\n`) ? "accepted" : "rejected"}`) : c))
    .join("\n");
}

const out = {};
const prevExpect = readJson(EXPECT_FILE);
const expectOut = {
  "//": prevExpect?.["//"],
  "//drift_sha256": prevExpect?.["//drift_sha256"],
  "//block": prevExpect?.["//block"],
  drift_version: null,
  drift_sha256: fileHash(drift),
  repos: { ...(prevExpect?.repos ?? {}) },
  block: { ...(prevExpect?.block ?? {}) },
};
for (const repo of [...new Set(tasks.map((t) => t.repo))]) {
  const { dir, meta } = await buildPolicy({ work, repos, repo, drift, labels, allowDrift: !!a["write-expect"] });
  for (const p of meta.problems ?? []) problems.push(`policy: ${p}`);
  expectOut.drift_version = meta.drift_version;
  expectOut.repos[repo] = meta.accepted.map((c) => c.id).sort();
  expectOut.block[repo] = meta.accepted.filter((c) => c.mode === "block").map((c) => c.id).sort();
  const yaml = readFileSync(join(dir, "conventions.yaml"), "utf8");
  const examples = new Map(parseConventions(yaml).map((c) => [c.id, c.example?.split("#")[0]]));
  const wt = join(work, "wt", `verify-${repo}`);
  await withWorktree(join(repos, repo), wt, async () => {
    run("mkdir", ["-p", ".drift"], wt);
    writeFileSync(join(wt, "drift.lock"), readFileSync(join(dir, "drift.lock")));
    const cover = new Map(); // path -> [ids]
    const paths = [...new Set(tasks.filter((t) => t.repo === repo).flatMap((t) => t.targets))];
    for (const c of meta.accepted) {
      writeFileSync(join(wt, ".drift/conventions.yaml"), isolate(yaml, c.id));
      for (const p of paths) {
        const r = run(drift, ["example", p], wt);
        if (r.code === 0 && r.stdout.trim() && !/no learned role covers/.test(r.stdout)) (cover.get(p) ?? cover.set(p, []).get(p)).push(c.id);
      }
    }
    // Stub check for new targets: copy the convention's example file to the target and ask again.
    const stubFail = new Map(); // `${path} ${id}` -> reason
    for (const t of tasks.filter((t) => t.repo === repo))
      for (const p of t.targets) {
        if (existsSync(join(wt, p))) continue;
        for (const id of t.exercises.filter((id) => (cover.get(p) ?? []).includes(id))) {
          const ex = examples.get(id);
          if (!ex || !existsSync(join(wt, ex))) continue; // module-level or package rules: nothing to copy
          mkdirSync(dirname(join(wt, p)), { recursive: true });
          copyFileSync(join(wt, ex), join(wt, p));
          writeFileSync(join(wt, ".drift/conventions.yaml"), isolate(yaml, id));
          const r = run(drift, ["example", p], wt);
          if (!(r.code === 0 && r.stdout.trim() && !/no learned role covers/.test(r.stdout))) stubFail.set(`${p} ${id}`, `a stub copied from ${ex} is not in the role`);
          rmSync(join(wt, p), { force: true });
        }
      }
    for (const t of tasks.filter((t) => t.repo === repo)) {
      for (const p of t.targets) for (const id of t.exercises) if (stubFail.has(`${p} ${id}`)) problems.push(`${t.id}: ${id} covers ${p} by directory only: ${stubFail.get(`${p} ${id}`)}`);
      const covering = [...new Set(t.targets.flatMap((p) => cover.get(p) ?? []))];
      const uncovered = t.targets.filter((p) => !(cover.get(p) ?? []).length);
      const missing = t.exercises.filter((id) => !covering.includes(id));
      if (!covering.length) problems.push(`${t.id}: no accepted convention covers any target`);
      for (const p of uncovered) problems.push(`${t.id}: target ${p} is in no accepted role`);
      for (const id of missing) problems.push(`${t.id}: claims ${id} but it covers none of the targets`);
      out[t.id] = { repo, category: t.category, targets: Object.fromEntries(t.targets.map((p) => [p, cover.get(p) ?? []])), exercises: t.exercises, extra: covering.filter((id) => !t.exercises.includes(id)) };
      console.log(`${t.id} [${t.category}] ${t.exercises.join(",")}${out[t.id].extra.length ? ` (also covers ${out[t.id].extra.join(",")})` : ""}${missing.length ? ` MISSING ${missing.join(",")}` : ""}`);
    }
  });
}

const repoSet = new Set(tasks.map((t) => t.repo));
const catSet = new Set(tasks.map((t) => t.category));
if (!only) {
  if (tasks.length < 30) problems.push(`only ${tasks.length} tasks (need >= 30)`);
  if (repoSet.size < 6) problems.push(`only ${repoSet.size} repos (need >= 6)`);
  for (const c of "abcdef") if (!catSet.has(c)) problems.push(`no task in category ${c}`);
}
writeJson(join(work, "verify.json"), { tasks: out, problems });
if (a["write-expect"]) {
  writeFileSync(EXPECT_FILE, JSON.stringify(expectOut, null, 2) + "\n");
  console.log(`wrote ${EXPECT_FILE}`);
}
console.log(`\n${tasks.length} tasks, ${repoSet.size} repos, categories ${[...catSet].sort().join("")}`);
console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "OK");
process.exit(problems.length ? 1 : 0);
