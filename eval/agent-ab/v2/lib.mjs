// Shared helpers for the agent A/B harness v2 (see README.md in this folder).
// Node 22, no dependencies.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, "..", "..", "..");

// ---------- small utilities ----------

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[k] = true;
    else {
      out[k] = next;
      i++;
    }
  }
  return out;
}

export const sh = (cmd, argv, cwd, opts = {}) =>
  execFileSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], ...opts });

/** Run and return { code, stdout, stderr, ms } without throwing. */
export function run(cmd, argv, cwd, opts = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: Date.now() - t };
}

export const sha = (s) => createHash("sha1").update(s).digest("hex");
export const readJson = (p, d = undefined) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return d;
  }
};
export const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2));
};
export const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];

/** Deterministic PRNG (mulberry32) so a run order can be reproduced from --seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(xs, rand) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Files the harness or Drift add; never the agent's work. */
export const ours = (p) => p.startsWith(".drift/") || p.startsWith(".claude/") || p === "drift.lock";
export const source = (p) => /\.[cm]?[jt]sx?$/.test(p);

// ---------- labels and policy ----------

export function loadLabels(file = join(root, "eval/study/labels.jsonl")) {
  const m = new Map();
  for (const l of readJsonl(file)) m.set(l.id, l);
  return m;
}

/** Minimal reader for .drift/conventions.yaml: id, status, mode, summary, evidence.total, role, example. */
export function parseConventions(yaml) {
  const out = [];
  for (const chunk of yaml.split(/\n(?=- id: )/).filter((c) => c.startsWith("- id:"))) {
    const g = (re) => chunk.match(re)?.[1];
    // Scalars may be folded (`key: >-` followed by indented lines).
    const scalar = (key) => {
      const v = g(new RegExp(`\\n  ${key}: (.*)`)) ?? "";
      if (v !== ">-" && v !== "|-") return v;
      return (chunk.match(new RegExp(`\\n  ${key}: [>|]-\\n((?:    .*\\n?)+)`))?.[1] ?? "").replace(/\s+/g, key === "summary" ? " " : "").trim();
    };
    const summary = scalar("summary");
    out.push({
      id: g(/- id: (\S+)/),
      status: g(/\n  status: (\S+)/),
      mode: g(/\n  mode: (\S+)/),
      summary: summary.replace(/^"|"$/g, ""),
      total: Number(g(/\n  evidence:[\s\S]*?\n    total: (\d+)/)),
      role: {
        package: g(/\n  role:[\s\S]*?\n    package: (.*)/),
        dir: g(/\n  role:[\s\S]*?\n    dir: (.*)/),
        file: g(/\n  role:[\s\S]*?\n    file: (.*)/),
        entry: g(/\n  role:[\s\S]*?\n    entry: (.*)/),
        kind: g(/\n  role:[\s\S]*?\n    kind: (.*)/),
      },
      rule: g(/\n  rule:\n    type: (\S+)/),
      example: scalar("example"),
    });
  }
  return out;
}

// ---------- checkouts (sparse, media excluded, capped) ----------
//
// Each run gets its own `git clone --shared --no-checkout` of the dev repo (objects are borrowed
// through alternates, nothing is copied). Unlike `git worktree add`, this leaves the dev repo
// byte-identical: no `.git/worktrees/` metadata and no `extensions.worktreeConfig` in its config.

const SPARSE = ["/*", "!*.png", "!*.jpg", "!*.jpeg", "!*.gif", "!*.webp", "!*.mp4", "!*.mov", "!*.pdf", "!*.ico", "!*.woff", "!*.woff2", "!*.ttf", "!*.mp3", "!*.wav", "!*.zip"];
export const MAX_WORKTREES = 6;
let liveWorktrees = 0;
const waiters = [];

/** Acquire a checkout slot; at most MAX_WORKTREES harness checkouts exist at once (per process). */
export async function withWorktree(repoDir, wt, fn, { cap = MAX_WORKTREES } = {}) {
  while (liveWorktrees >= cap) await new Promise((r) => waiters.push(r));
  liveWorktrees++;
  try {
    addWorktree(repoDir, wt);
    return await fn(wt);
  } finally {
    removeWorktree(repoDir, wt);
    liveWorktrees--;
    waiters.shift()?.();
  }
}

export function addWorktree(repoDir, wt) {
  if (existsSync(wt)) removeWorktree(repoDir, wt);
  mkdirSync(dirname(wt), { recursive: true });
  sh("git", ["clone", "-q", "--shared", "--no-checkout", repoDir, wt]);
  sh("git", ["-C", wt, "sparse-checkout", "set", "--no-cone", ...SPARSE]);
  sh("git", ["-C", wt, "checkout", "-q", "--detach", sh("git", ["-C", repoDir, "rev-parse", "HEAD"]).trim()]);
}

export function removeWorktree(_repoDir, wt) {
  if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
}

/** Hide harness files from `git status` (the checkout's own config; the dev repo is untouched). */
export function hideHarnessFiles(wt, excludeFile) {
  writeFileSync(excludeFile, ".drift/\n.claude/\ndrift.lock\n");
  sh("git", ["-C", wt, "config", "core.excludesFile", excludeFile]);
}

/** Hashes of Drift's policy files and everything under .claude/ (what an agent could tamper with). */
export function tamperHashes(wt) {
  const out = {};
  const files = ["drift.lock", ".drift/conventions.yaml"];
  const walk = (rel) => {
    const abs = join(wt, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const e of readdirSync(abs)) walk(join(rel, e));
    else files.push(rel);
  };
  walk(".claude");
  for (const f of files) out[f] = existsSync(join(wt, f)) ? sha(readFileSync(join(wt, f))) : null;
  return out;
}

/** Paths the agent changed, relative to the worktree (porcelain v1, -z). */
export function changedPaths(wt) {
  const out = sh("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], wt);
  const parts = out.split("\0").filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const st = parts[i].slice(0, 2);
    paths.push(parts[i].slice(3));
    if (st[0] === "R" || st[0] === "C") i++; // skip the rename source
  }
  return paths.filter((p) => !ours(p));
}

/** A patch of everything the agent changed, including new files. */
export function patchOf(wt, paths) {
  if (!paths.length) return "";
  sh("git", ["add", "-A", "-N", "--", ...paths], wt);
  const p = sh("git", ["diff", "--no-color", "--binary", "--", ...paths], wt);
  sh("git", ["reset", "-q"], wt);
  return p;
}

export function resetToPristine(wt) {
  sh("git", ["checkout", "-q", "--", "."], wt);
  sh("git", ["clean", "-fdq"], wt); // keeps ignored harness files (.drift, .claude, drift.lock)
  const left = changedPaths(wt);
  if (left.length) throw new Error(`worktree not pristine after reset: ${left.slice(0, 5).join(", ")}`);
}

// ---------- policy: reviewer-accepted conventions only (S7) ----------

/** sha256 of a file (the drift binary, a policy). */
export const fileHash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
export const policyHash = (dir) => createHash("sha256").update(readFileSync(join(dir, "conventions.yaml"))).update(readFileSync(join(dir, "drift.lock"))).digest("hex").slice(0, 16);

/**
 * The ACCEPT-labelled conventions each repo's policy must contain, for the drift build the task
 * suite was verified with (policy-expect.json). labels.jsonl is a union over Drift versions (it
 * also holds proposals that later fixes removed), so "every ACCEPT label has a proposal" cannot
 * be the test; "exactly the expected ACCEPT ids are proposed, and nothing proposed is
 * unlabelled" is. When convention ids change (a new drift build), building a policy fails
 * until the tasks are re-verified and this file is regenerated (verify-tasks.mjs --write-expect).
 */
export const EXPECT_FILE = join(here, "policy-expect.json");

/** Problems that make a policy unusable for scoring; empty when it is fine. */
export function policyProblems({ repo, convs, labels, expect, headSha, pinnedSha }) {
  const out = [];
  if (pinnedSha && headSha !== pinnedSha) out.push(`${repo}: checkout is at ${headSha}, eval/repos.json pins ${pinnedSha}`);
  const unlabeled = convs.filter((c) => !labels.has(c.id)).map((c) => c.id);
  if (unlabeled.length) out.push(`${repo}: proposals without a reviewer label (convention ids changed?): ${unlabeled.join(", ")}`);
  const accepted = convs.filter((c) => labels.get(c.id)?.label === "ACCEPT").map((c) => c.id);
  const want = expect?.repos?.[repo];
  if (!want) out.push(`${repo}: not in policy-expect.json`);
  else {
    const missing = want.filter((id) => !accepted.includes(id));
    const extra = accepted.filter((id) => !want.includes(id));
    if (missing.length) out.push(`${repo}: expected ACCEPT conventions not proposed by this drift build: ${missing.join(", ")}`);
    if (extra.length) out.push(`${repo}: ACCEPT conventions proposed but not expected: ${extra.join(", ")}`);
  }
  return out;
}

/**
 * Build (once per repo, cached under <work>/policy/<repo>) the policy a team would have after
 * review of the tiered product as shipped: ACCEPT-labelled conventions accepted, in block mode
 * when `census --json` puts them in the default tier and in advise mode otherwise (suggestions,
 * which `drift review --block` refuses without --force, and roles under 15 members); every other
 * proposal rejected. Refuses (throws) when the cache was built by another drift binary, when the
 * checkout is not at the pinned sha, when the proposals do not match the labels as expected, or
 * when the block-mode ids differ from policy-expect.json's `block`. Returns { dir, meta }.
 */
export async function buildPolicy({ work, repos, repo, drift, labels, expect = readJson(EXPECT_FILE), allowDrift = false }) {
  const dir = join(work, "policy", repo);
  const binHash = fileHash(drift);
  const meta = readJson(join(dir, "policy.json"));
  if (meta && existsSync(join(dir, "conventions.yaml"))) {
    if (meta.drift_sha256 !== binHash) throw new Error(`policy for ${repo} in ${dir} was built with another drift binary (${meta.drift_sha256?.slice(0, 12)}, now ${binHash.slice(0, 12)}); use a new --work`);
    return { dir, meta };
  }
  const pinned = readJson(join(root, "eval/repos.json"))?.repos?.find((r) => r.name === repo)?.sha;
  const wt = join(work, "wt", `policy-${repo}`);
  return withWorktree(join(repos, repo), wt, async () => {
    sh(drift, ["init"], wt);
    const convs = parseConventions(readFileSync(join(wt, ".drift/conventions.yaml"), "utf8"));
    const headSha = sh("git", ["rev-parse", "HEAD"], wt).trim();
    const problems = policyProblems({ repo, convs, labels, expect, headSha, pinnedSha: pinned });
    // The product's tier for each proposal (census --json writes no files). Same default --max as init.
    const tiers = new Map(JSON.parse(sh(drift, ["census", "--json"], wt)).proposals.map((p) => [p.id, p.tier]));
    for (const c of convs) if (!tiers.has(c.id)) problems.push(`${repo}: ${c.id} is in conventions.yaml but not in census --json (tier unknown)`);
    if (problems.length && !allowDrift) throw new Error(`policy for ${repo} refused:\n- ${problems.join("\n- ")}`);
    const block = [], advise = [], reject = [];
    for (const c of convs) {
      if (labels.get(c.id)?.label !== "ACCEPT") reject.push(c.id);
      else (tiers.get(c.id) === "default" ? block : advise).push(c.id);
    }
    const wantBlock = expect?.block?.[repo];
    if (wantBlock) {
      const got = [...block].sort(), want = [...wantBlock].sort();
      if (got.join() !== want.join()) {
        problems.push(`${repo}: block-mode ids ${got.join(",") || "(none)"} differ from policy-expect.json block ${want.join(",") || "(none)"}`);
        if (!allowDrift) throw new Error(`policy for ${repo} refused:\n- ${problems.join("\n- ")}`);
      }
    }
    const a = ["review"];
    if (block.length) a.push("--block", block.join(","));
    if (advise.length) a.push("--accept", advise.join(","));
    if (reject.length) a.push("--reject", reject.join(","));
    sh(drift, a, wt);
    mkdirSync(dir, { recursive: true });
    cpSync(join(wt, ".drift/conventions.yaml"), join(dir, "conventions.yaml"));
    cpSync(join(wt, "drift.lock"), join(dir, "drift.lock"));
    const after = parseConventions(readFileSync(join(dir, "conventions.yaml"), "utf8"));
    const labelled = [...labels.values()].filter((l) => l.repo === repo && l.label === "ACCEPT").map((l) => l.id);
    const m = {
      repo,
      sha: headSha,
      drift_version: sh(drift, ["--version"], wt).trim(),
      drift_sha256: binHash,
      policy_hash: policyHash(dir),
      proposed: convs.length,
      accepted: after.filter((c) => c.status === "accepted").map((c) => ({ id: c.id, mode: c.mode, tier: tiers.get(c.id) ?? null, total: c.total, summary: c.summary })),
      rejected: reject,
      unlabeled: convs.filter((c) => !labels.has(c.id)).map((c) => c.id),
      // ACCEPT labels this build does not propose (proposals removed by earlier fixes).
      superseded_labels: labelled.filter((id) => !convs.some((c) => c.id === id)),
      problems,
    };
    writeJson(join(dir, "policy.json"), m);
    return { dir, meta: m };
  });
}

export function installPolicy(policyDir, wt) {
  mkdirSync(join(wt, ".drift"), { recursive: true });
  cpSync(join(policyDir, "conventions.yaml"), join(wt, ".drift/conventions.yaml"));
  cpSync(join(policyDir, "drift.lock"), join(wt, "drift.lock"));
}

// ---------- drift check ----------

export const vkey = (v) => `${v.id} ${v.path}#${v.symbol}`;

/** `drift check --format json` on some files; returns { violations, ms }. Exit 1 (blocking) is fine. */
export function check(drift, wt, files) {
  const present = files.filter((f) => existsSync(join(wt, f)) && source(f));
  if (!present.length) return { violations: [], ms: 0 };
  const r = run(drift, ["check", "--format", "json", ...present], wt);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    throw new Error(`drift check failed (${r.code}): ${r.stderr.slice(0, 400)}`);
  }
  return { violations: parsed.violations ?? [], ms: r.ms };
}

/** Symbols defined in a file (names and entry-point symbols), from `drift facts`. */
export function symbolsOf(drift, wt, file) {
  if (!existsSync(join(wt, file)) || !source(file)) return [];
  const r = run(drift, ["facts", file], wt);
  try {
    const f = JSON.parse(r.stdout);
    return [...(f.symbols ?? []).map((s) => s.name), ...(f.entry_points ?? []).map((e) => e.symbol)];
  } catch {
    return [];
  }
}

// ---------- Claude Code transcripts ----------

export function findTranscript(sessionId, home = homedir()) {
  const base = join(home, ".claude", "projects");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const p = join(base, d, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Tool calls in transcript order: [{ id, name, input, is_error, result }].
 * Also returns hook events seen by the agent (additional context, blocks, system messages).
 */
export function parseTranscript(lines) {
  const calls = [];
  const byId = new Map();
  const hooks = [];
  for (const l of lines) {
    if (l.isSidechain) continue;
    if (l.type === "assistant" && Array.isArray(l.message?.content))
      for (const c of l.message.content)
        if (c.type === "tool_use" && !byId.has(c.id)) {
          const call = { id: c.id, name: c.name, input: c.input ?? {}, is_error: undefined, result: undefined, ts: l.timestamp };
          calls.push(call);
          byId.set(c.id, call);
        }
    if (l.type === "user" && Array.isArray(l.message?.content))
      for (const c of l.message.content)
        if (c.type === "tool_result" && byId.has(c.tool_use_id)) {
          const call = byId.get(c.tool_use_id);
          const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
          call.is_error = c.is_error === true || /^<tool_use_error>/.test(text);
          call.result = text.slice(0, 2000);
        }
    if (l.attachment?.type === "hook_additional_context")
      hooks.push({ kind: "context", event: l.attachment.hookEvent, tool: l.attachment.toolUseID, text: [].concat(l.attachment.content ?? []).join("\n"), ts: l.timestamp });
    if (l.attachment?.type === "hook_success" || l.attachment?.type === "hook_blocking_error" || l.attachment?.type === "hook_error")
      hooks.push({ kind: l.attachment.type, event: l.attachment.hookEvent, name: l.attachment.hookName, ms: l.attachment.durationMs, stdout: (l.attachment.stdout ?? "").slice(0, 3000), ts: l.timestamp });
    if (l.type === "system" && l.subtype === "stop_hook_summary")
      hooks.push({ kind: "stop_summary", prevented: l.preventedContinuation, ms: (l.hookInfos ?? []).map((h) => h.durationMs), errors: l.hookErrors, ts: l.timestamp });
    if (l.type === "user" && typeof l.message?.content === "string" && /Stop hook feedback/i.test(l.message.content))
      hooks.push({ kind: "stop_feedback", text: l.message.content.slice(0, 3000), ts: l.timestamp });
    if (l.type === "user" && Array.isArray(l.message?.content))
      for (const c of l.message.content)
        if (c.type === "text" && /Stop hook feedback/i.test(c.text ?? "")) hooks.push({ kind: "stop_feedback", text: c.text.slice(0, 3000), ts: l.timestamp });
  }
  return { calls, hooks };
}

// ---------- cost ----------

/** $ per MTok: input, output, 5m cache write, 1h cache write, cache read (claude-api skill, 2026-10). */
export const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5, 0.125, 0.2, 0.01],
  "claude-sonnet-5-5": [2, 10, 2.5, 4, 0.2],
  "claude-opus-5-5": [4, 20, 5, 8, 0.2],
};

/**
 * Cost of each `claude -p` result in order. A resumed call (`--resume`) reports the session's
 * cumulative `total_cost_usd` (and output tokens, API time), so its own cost is the increase
 * over the previous result of the same session. `num_turns` and `duration_ms` are per call.
 */
export function resultCosts(results) {
  const prev = new Map();
  return results.map((r) => {
    const total = r?.total_cost_usd;
    if (total == null) return null;
    const p = prev.get(r.session_id) ?? 0;
    prev.set(r.session_id, total);
    return total >= p ? total - p : total;
  });
}

/** Cost of a (possibly killed) session from its transcript's per-message usage (cumulative). */
export function costFromTranscript(lines, model) {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const seen = new Set();
  let usd = 0;
  for (const l of lines) {
    const m = l.message;
    if (l.type !== "assistant" || !m?.usage || seen.has(m.id)) continue;
    seen.add(m.id);
    const u = m.usage;
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
    usd += ((u.input_tokens ?? 0) * p[0] + (u.output_tokens ?? 0) * p[1] + w5m * p[2] + w1h * p[3] + (u.cache_read_input_tokens ?? 0) * p[4]) / 1e6;
  }
  return usd;
}

// ---------- statistics ----------

/** Wilson score interval for k successes in n trials (95%). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Percentile bootstrap 95% interval of stat(sample). */
export function bootstrap(xs, stat, { B = 4000, seed = 7 } = {}) {
  if (!xs.length) return [NaN, NaN];
  const rand = rng(seed);
  const vals = [];
  for (let b = 0; b < B; b++) {
    const s = Array.from({ length: xs.length }, () => xs[Math.floor(rand() * xs.length)]);
    vals.push(stat(s));
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * B)], vals[Math.floor(0.975 * B)]];
}
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
