// Score an agent A/B run.
//
//   node eval/agent-ab/score.mjs --drift target/release/drift --work <dir> --labels <dir with *.jsonl> [--out score.json]
//
// For every <work>/<task>/<arm>/repo worktree:
// - files the agent changed or added (Drift's own files excluded);
// - new violations in those files of conventions accepted at the start of the run,
//   split by the independent label of each convention (ACCEPT / TRIVIAL / WRONG);
// - `drift-ignore` suppressions the agent added (a way to game the check);
// - turns, cost and time from Claude Code's JSON result.
// Control arms are scored against the same policy as the Drift arm of the task.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const drift = resolve(arg("--drift", "target/release/drift"));
const work = resolve(arg("--work"));
const labelsDir = arg("--labels");
const out = arg("--out");

const labels = new Map();
if (labelsDir)
  for (const f of readdirSync(labelsDir).filter((f) => f.endsWith(".jsonl")))
    for (const line of readFileSync(join(labelsDir, f), "utf8").split("\n").filter(Boolean)) {
      try {
        const l = JSON.parse(line);
        labels.set(l.id, l.label);
      } catch {}
    }

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
const ours = (p) => p.startsWith(".drift/") || p.startsWith(".claude/") || p === "drift.lock";
const source = (p) => /\.[cm]?[jt]sx?$/.test(p);

const rows = [];
for (const task of readdirSync(work).sort()) {
  const policyFrom = join(work, task, "drift", "repo");
  for (const arm of ["control", "drift"]) {
    const dir = join(work, task, arm);
    const wt = join(dir, "repo");
    if (!existsSync(wt)) {
      if (existsSync(join(dir, "score.json"))) rows.push(JSON.parse(readFileSync(join(dir, "score.json"), "utf8")));
      continue;
    }
    const status = sh("git", ["status", "--porcelain", "--untracked-files=all"], wt)
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, ""));
    const changed = status.filter((p) => !ours(p));
    if (arm === "control" && existsSync(join(policyFrom, ".drift/conventions.yaml"))) {
      cpSync(join(policyFrom, ".drift/conventions.yaml"), join(wt, ".drift/conventions.yaml"));
      cpSync(join(policyFrom, "drift.lock"), join(wt, "drift.lock"));
    }
    const files = changed.filter(source);
    let violations = [];
    if (files.length && existsSync(join(wt, ".drift/conventions.yaml"))) {
      let raw;
      try {
        raw = sh(drift, ["check", "--format", "json", ...files], wt);
      } catch (e) {
        raw = e.stdout; // exit 1 when something blocks
      }
      violations = JSON.parse(raw).violations.filter((v) => !v.baselined);
    }
    const diff = sh("git", ["diff", "--no-color"], wt);
    // Keep what the agent wrote, so worktrees can be removed after scoring.
    sh("git", ["add", "-A", "-N", "--", ...changed], wt);
    writeFileSync(join(dir, "changes.patch"), sh("git", ["diff", "--no-color", "--", ...changed], wt));
    const added = files
      .filter((f) => existsSync(join(wt, f)))
      .map((f) => {
        try {
          sh("git", ["ls-files", "--error-unmatch", f], wt);
          return "";
        } catch {
          return readFileSync(join(wt, f), "utf8");
        }
      })
      .join("\n");
    const suppressions = (diff.split("\n").filter((l) => l.startsWith("+")).join("\n") + added).match(/drift-ignore/g)?.length ?? 0;
    let result = {};
    try {
      result = JSON.parse(readFileSync(join(dir, "claude.json"), "utf8"));
    } catch {}
    const by = (lab) => violations.filter((v) => !v.suppressed && (labels.get(v.id) ?? "UNLABELED") === lab);
    const row = {
      task,
      arm,
      files_changed: changed.length,
      violations_accept: by("ACCEPT").length,
      violations_trivial: by("TRIVIAL").length,
      violations_wrong: by("WRONG").length,
      violations_unlabeled: by("UNLABELED").length,
      suppressed: violations.filter((v) => v.suppressed).length,
      suppressions_added: suppressions,
      ids: [...new Set(violations.map((v) => `${v.id}:${labels.get(v.id) ?? "?"}`))],
      turns: result.num_turns,
      cost_usd: result.total_cost_usd,
      seconds: result.duration_ms ? Math.round(result.duration_ms / 1000) : undefined,
      is_error: result.is_error,
      model: Object.keys(result.modelUsage ?? {}).join(","),
    };
    writeFileSync(join(dir, "score.json"), JSON.stringify(row, null, 2));
    rows.push(row);
  }
}

const sum = (arm, k) => rows.filter((r) => r.arm === arm).reduce((n, r) => n + (r[k] ?? 0), 0);
console.log("| Task | Arm | Files | Violations (accepted rules) | trivial | wrong | Suppressions added | Turns | Cost | Time |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows)
  console.log(
    `| ${r.task} | ${r.arm} | ${r.files_changed} | ${r.violations_accept} | ${r.violations_trivial} | ${r.violations_wrong} | ${r.suppressions_added} | ${r.turns ?? "–"} | ${r.cost_usd != null ? "$" + r.cost_usd.toFixed(2) : "–"} | ${r.seconds ?? "–"} s |`,
  );
for (const arm of ["control", "drift"])
  console.log(
    `\n${arm}: ${sum(arm, "violations_accept")} violations of accepted rules, ${sum(arm, "violations_trivial")} trivial, ${sum(arm, "violations_wrong")} wrong, ${sum(arm, "suppressions_added")} suppressions added, $${sum(arm, "cost_usd").toFixed(2)}, ${sum(arm, "turns")} turns`,
  );
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
