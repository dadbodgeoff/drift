// Agent A/B: the same Claude Code task with and without Drift.
//
//   node eval/agent-ab/run.mjs --drift target/release/drift --repos <eval cache>/repos \
//        --work <dir> [--only id,id] [--jobs 4] [--arms control,drift] [--model <id>]
//
// For each task and arm, a fresh worktree of the pinned repo is created.
// - control: the repo as is.
// - drift:   `drift init`, every convention accepted (block where the role has
//            15+ members, else advise), the Claude Code hooks from
//            integrations/claude-code/hooks/hooks.json and the Drift skill.
// Both arms get the same prompt, tools and turn limit. Results: <work>/<task>/<arm>/.
// Score with score.mjs.

import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const drift = resolve(arg("--drift", join(root, "target/release/drift")));
const repos = resolve(arg("--repos"));
const work = resolve(arg("--work"));
const jobs = Number(arg("--jobs", "4"));
const only = arg("--only", "")?.split(",").filter(Boolean);
const arms = arg("--arms", "control,drift").split(",");
const maxTurns = arg("--max-turns", "80");
const timeoutMs = Number(arg("--timeout-min", "25")) * 60_000;
const model = arg("--model", "");

const tasks = JSON.parse(readFileSync(join(here, "tasks.json"), "utf8")).filter(
  (t) => !only.length || only.includes(t.id),
);
const allowed = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "Bash(drift:*)", "Bash(ls:*)", "Bash(git diff:*)", "Bash(git status:*)"];

function setup(task, arm) {
  const dir = join(work, task.id, arm);
  const wt = join(dir, "repo");
  if (existsSync(wt)) execFileSync("git", ["-C", join(repos, task.repo), "worktree", "remove", "--force", wt]);
  mkdirSync(dir, { recursive: true });
  // Images and media are left out of the checkout: they are large and never read.
  execFileSync("git", ["-C", join(repos, task.repo), "worktree", "add", "-q", "--detach", "--no-checkout", wt, "HEAD"]);
  execFileSync("git", ["-C", wt, "sparse-checkout", "set", "--no-cone", "/*", "!*.png", "!*.jpg", "!*.jpeg", "!*.gif", "!*.webp", "!*.mp4", "!*.mov", "!*.pdf"]);
  execFileSync("git", ["-C", wt, "checkout", "-q"]);
  if (arm === "drift") {
    execFileSync(drift, ["init"], { cwd: wt, stdio: "ignore" });
    const yaml = readFileSync(join(wt, ".drift/conventions.yaml"), "utf8");
    // The tiered product as shipped: default-tier conventions block, suggestions (which
    // `review --block` refuses without --force) and small roles advise.
    const tiers = new Map(JSON.parse(execFileSync(drift, ["census", "--json"], { cwd: wt, encoding: "utf8", maxBuffer: 1 << 28 })).proposals.map((p) => [p.id, p.tier]));
    const block = [];
    const accept = [];
    for (const m of yaml.matchAll(/- id: (D-[0-9a-f]+)/g)) (tiers.get(m[1]) === "default" ? block : accept).push(m[1]);
    const a = ["review"];
    if (block.length) a.push("--block", block.join(","));
    if (accept.length) a.push("--accept", accept.join(","));
    execFileSync(drift, a, { cwd: wt, stdio: "ignore" });
    const hooks = JSON.parse(readFileSync(join(root, "integrations/claude-code/hooks/hooks.json"), "utf8"));
    mkdirSync(join(wt, ".claude/skills/drift"), { recursive: true });
    writeFileSync(join(wt, ".claude/settings.json"), JSON.stringify(hooks, null, 2));
    cpSync(join(root, "integrations/claude-code/skills/drift/SKILL.md"), join(wt, ".claude/skills/drift/SKILL.md"));
  }
  return { dir, wt };
}

function runOne(task, arm) {
  const { dir, wt } = setup(task, arm);
  const started = Date.now();
  return new Promise((done) => {
    const p = spawn(
      "claude",
      ["-p", task.prompt, "--output-format", "json", "--permission-mode", "acceptEdits", "--max-turns", maxTurns, "--allowedTools", allowed.join(" "), ...(model ? ["--model", model] : [])],
      { cwd: wt, env: { ...process.env, PATH: `${dirname(drift)}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(join(dir, "claude.json"), out);
      writeFileSync(join(dir, "claude.stderr"), err);
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ task: task.id, repo: task.repo, arm, code, ms: Date.now() - started }, null, 2));
      console.log(`${task.id} ${arm}: exit ${code} in ${Math.round((Date.now() - started) / 1000)} s`);
      done();
    });
  });
}

const queue = tasks.flatMap((t) => arms.map((a) => [t, a]));
async function worker() {
  while (queue.length) {
    const [t, a] = queue.shift();
    try {
      await runOne(t, a);
    } catch (e) {
      console.log(`${t.id} ${a}: setup failed: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
