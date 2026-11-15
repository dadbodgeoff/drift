// Score one step-0 run: conformance per task-concern pair, tokens, turns, and the
// Read/Grep/Glob calls made before the first edit.
//
// Conformance (automatic) per concern of tasks.json:
// - authn: every entry point the run added (in `drift security --json` on the final tree, not
//   in the base commit's inventory) carries the concern's `guard`. No added entry point: "none".
// - validation with `validates: true`: those entry points are also `validates` in Drift's facts.
// - any concern with `regex`: the lines the run added match it; `antiregex` must not match.
// A concern is "pass" only when every check it names passes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, readJsonl } from "../v2/lib.mjs";

const EDIT = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SEARCH = new Set(["Read", "Grep", "Glob"]);
// Read-only shell commands (PLAN-R14 E1 exploration_calls): every segment of the command line
// starts with one of these and nothing redirects into a file.
const RO = /^(ls|cat|head|tail|grep|rg|find|fd|tree|wc|file|stat|pwd|echo|sed -n|awk|git (status|log|show|diff|ls-files|grep|rev-parse|branch))\b/;
export function readOnlyBash(cmd) {
  if (/(^|[^>&])>(?!&)|\btee\b|-i\b/.test(cmd)) return false;
  return cmd.split(/&&|\|\||;|\|/).every((seg) => RO.test(seg.trim().replace(/^cd \S+\s*$/, "pwd")));
}

export function toolCalls(streamPath) {
  const calls = [];
  for (const l of readJsonl(streamPath)) {
    if (l.type !== "assistant") continue;
    for (const b of l.message?.content ?? []) if (b.type === "tool_use") calls.push({ name: b.name, input: b.input });
  }
  return calls;
}

/** Seconds from the session's first stream line to its first file edit (null without one). */
export function firstEditSeconds(streamPath) {
  // stream-json lines carry no clock; the recorder-free approximation is the transcript's
  // timestamps when present, else null.
  let t0 = null;
  for (const l of readJsonl(streamPath)) {
    const ts = l.timestamp ? Date.parse(l.timestamp) : null;
    if (ts && t0 == null) t0 = ts;
    if (l.type === "assistant" && (l.message?.content ?? []).some((b) => b.type === "tool_use" && EDIT.has(b.name))) return ts && t0 ? Math.round((ts - t0) / 1000) : null;
  }
  return null;
}

export function addedText(patch) {
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

export function newEntryPoints(finalInv, baseInv) {
  const key = (e) => `${e.path}#${e.symbol}#${e.method ?? ""}`;
  const base = new Set((baseInv?.entry_points ?? []).map(key));
  return (finalInv?.entry_points ?? []).filter((e) => !base.has(key(e)) && e.kind !== "layout" && e.kind !== "page");
}

export function judge(concern, eps, added) {
  const checks = [];
  if (concern.guard) {
    if (!eps.length) return { auto: "none", why: "no added entry point in Drift's inventory" };
    const miss = eps.filter((e) => !e.guards.some((g) => g === concern.guard || g.endsWith(`.${concern.guard}`)));
    checks.push(miss.length ? `missing ${concern.guard} on ${miss.map((e) => e.symbol).join(",")}` : null);
  }
  if (concern.validates) {
    if (!eps.length) return { auto: "none", why: "no added entry point in Drift's inventory" };
    const miss = eps.filter((e) => !e.validates);
    checks.push(miss.length ? `not validating: ${miss.map((e) => e.symbol).join(",")}` : null);
  }
  if (concern.regex && !new RegExp(concern.regex).test(added)) checks.push(`no match for /${concern.regex}/`);
  if (concern.antiregex && new RegExp(concern.antiregex).test(added)) checks.push(`matches /${concern.antiregex}/`);
  const fails = checks.filter(Boolean);
  return { auto: fails.length ? "fail" : "pass", why: fails.join("; ") || null };
}

export function scoreRun({ task, runDir, changed, result, baseInv }) {
  const patch = readFileSync(join(runDir, "changes.patch"), "utf8");
  const added = addedText(patch);
  let finalInv = null;
  try {
    finalInv = JSON.parse(readFileSync(join(runDir, "security-full.json"), "utf8"));
  } catch {}
  baseInv ??= readJson(join(runDir, "..", "..", "base-inv", `${task.id}.json`));
  const eps = newEntryPoints(finalInv, baseInv);
  const calls = toolCalls(join(runDir, "stream.jsonl"));
  const firstEdit = calls.findIndex((c) => EDIT.has(c.name));
  const before = firstEdit < 0 ? calls : calls.slice(0, firstEdit);
  const u = result?.usage ?? {};
  const gaps = readJson(join(runDir, "ci", "security.json"))?.guard_gaps ?? null;
  return {
    run: runDir.split("/").pop(),
    task: task.id,
    repo: task.repo,
    files_changed: changed.length,
    changed,
    new_entry_points: eps.map((e) => ({ path: e.path, symbol: e.symbol, guards: e.guards, validates: e.validates })),
    concerns: task.concerns.map((c) => ({ concern: c.concern, ...judge(c, eps, added) })),
    sec_guard_gaps: gaps ? gaps.length : null,
    turns: result?.num_turns ?? null,
    cost_usd: result?.total_cost_usd ?? null,
    seconds: result?.duration_ms ? Math.round(result.duration_ms / 1000) : null,
    is_error: result?.is_error ?? true,
    terminal: result?.subtype ?? null,
    input_tokens: u.input_tokens ?? null,
    output_tokens: u.output_tokens ?? null,
    cache_read_tokens: u.cache_read_input_tokens ?? null,
    cache_creation_tokens: u.cache_creation_input_tokens ?? null,
    tool_calls: calls.length,
    reads_before_edit: before.filter((c) => SEARCH.has(c.name)).length,
    exploration_calls: before.filter((c) => SEARCH.has(c.name) || (c.name === "Bash" && readOnlyBash(String(c.input?.command ?? "")))).length,
    first_edit_s: firstEditSeconds(join(runDir, "stream.jsonl")),
    calls_before_edit: before.length,
    edited: firstEdit >= 0,
  };
}
