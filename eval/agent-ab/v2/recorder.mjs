// Silent PostToolUse hook installed in BOTH arms (in .claude/settings.local.json) so that file
// changes made through Bash (mv, sed -i, cp, rm, redirects), which a transcript cannot replay,
// are still captured. It prints nothing and always exits 0, so the agent never sees it.
//
// After every Write/Edit/MultiEdit/NotebookEdit/Bash call, successful (PostToolUse) or not
// (PostToolUseFailure: a failed `sed -i ... && npm test` may still have changed files), it
// records which files differ from the last snapshot and stores their contents by hash:
//   $AB_REC_DIR/steps.jsonl   {seq, tool_use_id, tool, event, ms, changes: [{path, sha|null}], tamper: [...]}
//   $AB_REC_DIR/blobs/<sha>
// `tamper` lists changes to Drift's policy (.drift/conventions.yaml, drift.lock) and to anything
// under .claude/, which git status cannot show because the harness hides them.
// Worktree root: $AB_WT.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
const dir = process.env.AB_REC_DIR;
const wt = process.env.AB_WT;

function main() {
  if (!dir || !wt) return;
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  mkdirSync(join(dir, "blobs"), { recursive: true });
  const lock = join(dir, "lock");
  for (let i = 0; i < 400; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const statePath = join(dir, "state.json");
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
    const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: wt, encoding: "utf8", maxBuffer: 1 << 28 });
    const parts = out.split("\0").filter(Boolean);
    const paths = new Set(Object.keys(state).filter((k) => k !== "\0tamper"));
    for (let i = 0; i < parts.length; i++) {
      const st = parts[i].slice(0, 2);
      paths.add(parts[i].slice(3));
      if (st[0] === "R" || st[0] === "C") paths.add(parts[++i]);
    }
    const changes = [];
    for (const p of paths) {
      if (p.startsWith(".drift/") || p.startsWith(".claude/") || p === "drift.lock") continue;
      const abs = join(wt, p);
      let cur = null;
      if (existsSync(abs)) {
        try {
          const buf = readFileSync(abs);
          cur = createHash("sha1").update(buf).digest("hex");
          const blob = join(dir, "blobs", cur);
          if (!existsSync(blob)) writeFileSync(blob, buf);
        } catch {
          continue; // a directory or unreadable: not a file change
        }
      }
      if (!(p in state) || state[p] !== cur) {
        changes.push({ path: p, sha: cur });
        state[p] = cur;
      }
    }
    // Policy and agent configuration: hashed directly (ignored by git status).
    const watched = ["drift.lock", ".drift/conventions.yaml"];
    const walk = (rel) => {
      const abs = join(wt, rel);
      if (!existsSync(abs)) return;
      if (statSync(abs).isDirectory()) for (const e of readdirSync(abs)) walk(join(rel, e));
      else watched.push(rel);
    };
    walk(".claude");
    const tstate = state["\0tamper"] ?? {};
    const tamper = [];
    for (const p of new Set([...watched, ...Object.keys(tstate)])) {
      const abs = join(wt, p);
      const cur = existsSync(abs) ? createHash("sha1").update(readFileSync(abs)).digest("hex") : null;
      if (p in tstate ? tstate[p] !== cur : true) {
        if (p in tstate) tamper.push({ path: p, sha: cur });
        tstate[p] = cur;
      }
    }
    state["\0tamper"] = tstate;
    writeFileSync(statePath, JSON.stringify(state));
    const seqPath = join(dir, "seq");
    const seq = (existsSync(seqPath) ? Number(readFileSync(seqPath, "utf8")) : 0) + 1;
    writeFileSync(seqPath, String(seq));
    appendFileSync(
      join(dir, "steps.jsonl"),
      JSON.stringify({ seq, tool_use_id: input.tool_use_id ?? null, tool: input.tool_name ?? null, event: input.hook_event_name ?? null, session: input.session_id ?? null, ms: Date.now() - t0, changes, tamper }) + "\n",
    );
  } finally {
    try {
      rmdirSync(lock);
    } catch {}
  }
}

try {
  main();
} catch (e) {
  try {
    appendFileSync(join(dir, "errors.log"), String(e?.stack ?? e) + "\n");
  } catch {}
}
process.exit(0);
