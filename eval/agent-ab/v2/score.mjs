// Score one finished run: final state, trajectory (S4) and CI view (S8).
//
// Used by run.mjs right after a session, on the run's own worktree. Can also rescore a finished
// run from its saved artifacts (transcripts + recorder snapshots) against a fresh pristine
// worktree:
//
//   node eval/agent-ab/v2/score.mjs --drift <bin> --repos <dir> --work <dir> --run <runId>
//
// Policy: the reviewer-accepted policy in <work>/policy/<repo> (see lib.buildPolicy). Every
// violation counted is of a convention labelled ACCEPT by the independent reviewers.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  args, buildPolicy, changedPaths, check, installPolicy, loadLabels, ours, parseTranscript, patchOf, readJson, readJsonl,
  resetToPristine, resultCosts, run, sha, source, symbolsOf, tamperHashes, vkey, withWorktree, writeJson, hideHarnessFiles,
} from "./lib.mjs";

const MUTATING = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);

/** The CI view: what `drift check` in a pull request would report for the agent's final tree. */
export function ciCheck(drift, wt, outDir) {
  mkdirSync(outDir, { recursive: true });
  const text = run(drift, ["check"], wt);
  const strict = run(drift, ["check", "--strict"], wt);
  const sarif = run(drift, ["check", "--format", "sarif"], wt);
  writeFileSync(join(outDir, "drift.sarif"), sarif.stdout);
  writeFileSync(join(outDir, "check.txt"), text.stdout + text.stderr);
  let results = [];
  try {
    results = JSON.parse(sarif.stdout).runs?.flatMap((r) => r.results ?? []) ?? [];
  } catch {}
  const ci = {
    exit: text.code, // the action's final step: non-zero fails the PR
    exit_strict: strict.code,
    sarif_results: results.length,
    sarif_rules: [...new Set(results.map((r) => r.ruleId))],
    ms: text.ms,
  };
  writeJson(join(outDir, "ci.json"), ci);
  return ci;
}

/**
 * The security view of the agent's change: `drift security --diff-base HEAD` on the final
 * tree (the worktree is detached at the pinned commit, so the diff is the agent's work).
 * Facts, not violations: entry points the agent added that lack a guard most of their
 * siblings have, unguarded ones reaching a risky operation, risky operations added, client
 * leaks added. Null when the drift build has no `--diff-base` on `security`.
 */
export function securityCheck(drift, wt, outDir) {
  mkdirSync(outDir, { recursive: true });
  const r = run(drift, ["security", "--diff-base", "HEAD", "--json"], wt);
  if (r.code !== 0) {
    writeFileSync(join(outDir, "security.txt"), r.stdout + r.stderr);
    return null;
  }
  writeFileSync(join(outDir, "security.json"), r.stdout);
  const text = run(drift, ["security", "--diff-base", "HEAD"], wt);
  writeFileSync(join(outDir, "security.txt"), text.stdout + text.stderr);
  let v;
  try {
    v = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  const n = (k) => (Array.isArray(v[k]) ? v[k].length : 0);
  return {
    guard_gaps: n("guard_gaps"),
    unguarded_reaching: n("unguarded_reaching"),
    sinks: n("sinks"),
    leaks: n("leaks"),
    now_public: n("now_public"),
    // Which guards the agent's entry points lack, and whether an accepted convention says so.
    gaps: (v.guard_gaps ?? []).map((g) => ({ guard: g.guard, path: g.entry?.path, convention: g.convention?.status ?? null })),
    ms: r.ms,
  };
}

/** Final state of the worktree as the agent left it. Call before resetting. */
export function captureFinal({ drift, wt, runDir, policyDir }) {
  // Tampering: policy and agent configuration as left by the session, vs what was installed.
  const installed = readJson(join(runDir, "meta.json"))?.installed ?? {};
  const now = tamperHashes(wt);
  const tampered = [...new Set([...Object.keys(installed), ...Object.keys(now)])].filter((p) => (installed[p] ?? null) !== (now[p] ?? null));
  const changed = changedPaths(wt);
  const finalHashes = {};
  for (const p of changed) {
    try {
      finalHashes[p] = existsSync(join(wt, p)) ? sha(readFileSync(join(wt, p))) : null;
    } catch {
      finalHashes[p] = null;
    }
  }
  const patch = patchOf(wt, changed);
  writeFileSync(join(runDir, "changes.patch"), patch);
  // Score with the pristine accepted-only policy, whatever happened to .drift during the run.
  installPolicy(policyDir, wt);
  const files = changed.filter(source);
  const { violations } = check(drift, wt, files);
  const fresh = violations.filter((v) => !v.baselined);
  const lock = lockIndex(readFileSync(join(policyDir, "drift.lock"), "utf8"));
  const changedSet = new Set(changed);
  const active = fresh.filter((v) => !v.suppressed).map(vkey);
  const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const final = {
    changed,
    final_hashes: finalHashes,
    violations: active.filter((k) => !isMovedLegacy(k, lock, changedSet)),
    moved_legacy: active.filter((k) => isMovedLegacy(k, lock, changedSet)),
    tampered,
    suppressed: fresh.filter((v) => v.suppressed).map(vkey),
    suppressions_added: added.join("\n").match(/drift-ignore/g)?.length ?? 0,
    lines_added: added.length,
    lines_removed: patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    details: fresh,
  };
  final.ci = ciCheck(drift, wt, join(runDir, "ci"));
  final.security = securityCheck(drift, wt, join(runDir, "ci"));
  writeJson(join(runDir, "final.json"), final);
  return final;
}

function applyEdit(content, old, neu, all) {
  if (old === "") return null;
  if (all) return content.includes(old) ? content.split(old).join(neu) : null;
  const i = content.indexOf(old);
  return i < 0 ? null : content.slice(0, i) + neu + content.slice(i + old.length);
}

/** drift.lock entries as `${id}#${symbol}` -> paths (to tell moved legacy code from new code). */
function lockIndex(lockText) {
  const m = new Map();
  for (const line of lockText.split("\n")) {
    const mm = line.match(/^(D-[0-9a-f]+) (.+?)#(.*)$/);
    if (!mm) continue;
    const k = `${mm[1]}#${mm[3]}`;
    (m.get(k) ?? m.set(k, new Set()).get(k)).add(mm[2]);
  }
  return m;
}
const splitKey = (k) => {
  const i = k.indexOf(" ");
  const j = k.indexOf("#", i);
  return { id: k.slice(0, i), path: k.slice(i + 1, j), symbol: k.slice(j + 1) };
};

/** A violation key that is legacy code (baselined) moved from another path the session changed. */
export function isMovedLegacy(key, lock, touched) {
  const { id, path, symbol } = splitKey(key);
  for (const p of lock.get(`${id}#${symbol}`) ?? []) if (p !== path && touched.has(p)) return true;
  return false;
}

/**
 * Replay the session on a pristine checkout and check the touched files after each step.
 *
 * Order: the recorder's `seq` (one step per finished Write/Edit/MultiEdit/Bash call, failed ones
 * included). A step's Write/Edit/MultiEdit is replayed from the transcript and compared with the
 * snapshot; every other change in the step's snapshot (a failed Bash before it, a formatter,
 * anything the transcript does not explain) is applied from the recorder. Recorder steps with
 * no transcript call (subagent edits, a missing result line) are applied where they fall.
 * Transcript edits without a recorder step (recorder removed or crashed) are replayed after
 * the preceding recorded call. `runWts` are the absolute checkout paths the session used.
 */
export function replay({ drift, wt, runDir, runWts, lockText }) {
  const transcripts = (readJson(join(runDir, "meta.json"))?.sessions ?? []).map((s) => join(runDir, "transcripts", `${s}.jsonl`));
  const calls = [];
  const hooks = [];
  const seen = new Set();
  for (const t of transcripts) {
    const p = parseTranscript(readJsonl(t));
    for (const c of p.calls) if (!seen.has(c.id)) (seen.add(c.id), calls.push(c));
    hooks.push(...p.hooks);
  }
  const recSteps = readJsonl(join(runDir, "rec", "steps.jsonl")).sort((a, b) => a.seq - b.seq);
  const recById = new Map(recSteps.filter((r) => r.tool_use_id).map((r) => [r.tool_use_id, r]));
  const blob = (h) => readFileSync(join(runDir, "rec", "blobs", h));
  const rel = (abs) => {
    if (!abs) return null;
    if (!isAbsolute(abs)) return abs.replace(/^\.\//, "");
    for (const base of runWts) {
      const r = relative(base, abs);
      if (!r.startsWith("..") && !isAbsolute(r)) return r;
    }
    return null;
  };
  const lock = lockIndex(lockText ?? (existsSync(join(wt, "drift.lock")) ? readFileSync(join(wt, "drift.lock"), "utf8") : ""));

  // Items in recorder order, with unrecorded transcript calls slotted after their predecessor.
  const mut = calls.filter((c) => MUTATING.has(c.name));
  const items = recSteps.map((r) => ({ key: [r.seq, 0], r, c: calls.find((c) => c.id === r.tool_use_id) }));
  let prevSeq = 0;
  mut.forEach((c, ti) => {
    const r = recById.get(c.id);
    if (r) prevSeq = r.seq;
    else items.push({ key: [prevSeq, 1 + ti], c });
  });
  items.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1]);

  const touched = new Set();
  for (const it of items) {
    const p = it.c && it.c.name !== "Bash" ? rel(it.c.input.file_path ?? it.c.input.notebook_path) : null;
    if (p && !ours(p)) touched.add(p);
    for (const ch of it.r?.changes ?? []) if (!ours(ch.path)) touched.add(ch.path);
  }
  const files = [...touched];
  const pristineSymbols = new Map(files.map((f) => [f, new Set(symbolsOf(drift, wt, f))]));
  const keysOf = (vs) => {
    const fresh = vs.filter((v) => !v.baselined);
    return { active: new Set(fresh.filter((v) => !v.suppressed).map(vkey)), suppressed: new Set(fresh.filter((v) => v.suppressed).map(vkey)), byKey: new Map(fresh.map((v) => [vkey(v), v])) };
  };
  const pre = keysOf(check(drift, wt, files).violations);

  const steps = [];
  const issues = {
    failed_in_session: 0, replay_miss: 0, fallback_snapshot: 0, fidelity_mismatch: 0, outside_worktree: 0, bash_changes: 0,
    bash_denied_or_failed: 0, bash_unrecorded: 0, failed_call_changes: 0, extra_changes: 0, orphan_steps: 0, unrecorded_edits: 0,
  };
  const tamper = { calls: [], recorder: [] };
  let prev = pre.active;
  const chainOf = new Map(); // violation key -> chain id (its first key)
  const chainFirst = new Map(); // chain id -> step index
  const chainLast = new Map();
  const details = new Map();
  const moved = new Set();
  let renames = 0;
  let checkMs = 0;

  const write = (p, buf) => {
    mkdirSync(dirname(join(wt, p)), { recursive: true });
    writeFileSync(join(wt, p), buf);
  };
  const applyRec = (r, except) => {
    const paths = [];
    for (const ch of r.changes ?? []) {
      if (ours(ch.path) || ch.path === except) continue;
      if (ch.sha === null) rmSync(join(wt, ch.path), { force: true });
      else write(ch.path, blob(ch.sha));
      paths.push(ch.path);
    }
    return paths;
  };

  items.forEach(({ r, c }, i) => {
    const step = { i, seq: r?.seq ?? null, tool: c?.name ?? r?.tool ?? "?", id: c?.id ?? r?.tool_use_id ?? null, paths: [], status: "applied" };
    if (r?.tamper?.length) tamper.recorder.push(...r.tamper.map((t) => ({ ...t, seq: r.seq, tool: step.tool })));
    if (c) {
      const p = c.name === "Bash" ? null : rel(c.input.file_path ?? c.input.notebook_path);
      if (c.name !== "Bash" && p && ours(p)) tamper.calls.push({ tool: c.name, path: p, error: c.is_error });
      if (c.name === "Bash" && /\.drift\/|drift\.lock|\.claude\//.test(String(c.input.command ?? ""))) tamper.calls.push({ tool: "Bash", command: String(c.input.command).slice(0, 200), error: c.is_error });
    }
    if (!c) {
      // Orphan: a recorder step the transcript does not explain.
      issues.orphan_steps++;
      step.status = "orphan";
      step.paths = applyRec(r);
      if (!step.paths.length) return;
    } else if (c.name === "Bash") {
      step.command = String(c.input.command ?? "").slice(0, 300);
      if (r?.changes?.length) {
        step.paths = applyRec(r);
        issues.bash_changes++;
        if (c.is_error) issues.failed_call_changes++;
      } else if (c.is_error) {
        issues.bash_denied_or_failed++;
        return;
      } else if (!r && /(^|[;&|]\s*)(mv|cp|rm|sed\s+-i|tee|touch|git\s+(mv|rm|checkout|apply))\b|[^0-9&]>\s*[^&\s/]/.test(step.command)) {
        issues.bash_unrecorded++;
        step.status = "bash_unrecorded";
        return;
      } else return; // read-only shell call
      if (!step.paths.length) return;
    } else {
      const p = rel(c.input.file_path ?? c.input.notebook_path);
      if (!p) {
        issues.outside_worktree++;
        steps.push({ ...step, status: "outside_worktree", path: c.input.file_path });
        if (!r?.changes?.length) return;
        step.paths = applyRec(r);
      } else if (ours(p)) {
        step.paths = r ? applyRec(r) : [];
        if (!step.paths.length) return;
      } else if (c.is_error) {
        issues.failed_in_session++;
        if (r?.changes?.length) {
          issues.failed_call_changes++;
          step.paths = applyRec(r);
          step.status = "failed_in_session_with_changes";
        } else {
          steps.push({ ...step, paths: [p], status: "failed_in_session", error: c.result?.slice(0, 200) });
          return;
        }
      } else {
        step.paths = [p];
        if (!r) issues.unrecorded_edits++;
        const abs = join(wt, p);
        const cur = existsSync(abs) ? readFileSync(abs, "utf8") : null;
        let next = null;
        if (c.name === "Write") next = String(c.input.content ?? "");
        else if (c.name === "Edit") next = cur === null ? null : applyEdit(cur, c.input.old_string ?? "", c.input.new_string ?? "", c.input.replace_all);
        else if (c.name === "MultiEdit") {
          next = cur;
          for (const e of c.input.edits ?? []) {
            if (next === null) break;
            next = applyEdit(next, e.old_string ?? "", e.new_string ?? "", e.replace_all);
          }
        }
        const snap = r?.changes?.find((x) => x.path === p);
        if (next === null) {
          issues.replay_miss++;
          step.status = "replay_miss";
          if (snap) {
            issues.fallback_snapshot++;
            step.status = "replay_miss_used_snapshot";
            if (snap.sha === null) rmSync(abs, { force: true });
            else write(p, blob(snap.sha));
          }
        } else {
          write(p, next);
          if (snap && snap.sha !== sha(Buffer.from(next))) {
            issues.fidelity_mismatch++;
            step.status = "applied_snapshot_differs";
            if (snap.sha === null) rmSync(abs, { force: true });
            else write(p, blob(snap.sha));
          }
        }
        if (r) {
          const extra = applyRec(r, p);
          if (extra.length) {
            issues.extra_changes++;
            step.extra = extra;
            step.paths.push(...extra);
          }
        }
      }
    }
    const res = check(drift, wt, files);
    checkMs += res.ms;
    const k = keysOf(res.violations);
    step.new = [...k.active].filter((x) => !prev.has(x));
    step.gone = [...prev].filter((x) => !k.active.has(x));
    step.active = k.active.size;
    // A new key replacing a gone key of the same rule at the same path or symbol is the same
    // violation renamed or moved, not a new one plus a fix.
    const freeGone = step.gone.filter((g) => chainOf.has(g));
    for (const n of step.new) {
      if (pre.active.has(n) || chainOf.has(n)) continue;
      if (isMovedLegacy(n, lock, touched)) {
        moved.add(n);
        continue;
      }
      const sn = splitKey(n);
      const gi = freeGone.findIndex((g) => {
        const sg = splitKey(g);
        return sg.id === sn.id && (sg.path === sn.path || sg.symbol === sn.symbol);
      });
      if (gi >= 0) {
        chainOf.set(n, chainOf.get(freeGone[gi]));
        freeGone.splice(gi, 1);
        renames++;
      } else {
        chainOf.set(n, n);
        chainFirst.set(n, i);
      }
      details.set(n, k.byKey.get(n));
    }
    for (const x of k.active) if (chainOf.has(x)) chainLast.set(chainOf.get(x), i);
    step.suppressed = [...k.suppressed];
    prev = k.active;
    steps.push(step);
  });

  const finalChains = new Set([...prev].filter((x) => chainOf.has(x)).map((x) => chainOf.get(x)));
  const introduced = [...chainFirst.keys()];
  const isRegression = (key) => {
    const v = details.get(key);
    return v && v.symbol !== "(file)" && pristineSymbols.get(v.path)?.has(v.symbol);
  };
  const final = readJson(join(runDir, "final.json"));
  const finalMismatch = [];
  if (final?.final_hashes)
    for (const [p, h] of Object.entries(final.final_hashes)) {
      const abs = join(wt, p);
      const got = existsSync(abs) ? sha(readFileSync(abs)) : null;
      if (got !== h) finalMismatch.push(p);
    }
  return {
    edits: mut.filter((c) => c.name !== "Bash").length,
    steps,
    issues,
    check_ms: checkMs,
    pre_existing_violations: [...pre.active],
    introduced,
    fixed_later: introduced.filter((x) => !finalChains.has(x)),
    final: introduced.filter((x) => finalChains.has(x)),
    final_keys: [...prev].filter((x) => !pre.active.has(x) && !moved.has(x)),
    final_suppressed: steps.length ? steps.at(-1).suppressed ?? [] : [],
    regressions: introduced.filter(isRegression),
    regressions_final: introduced.filter((x) => isRegression(x) && finalChains.has(x)),
    moved_legacy: [...moved],
    moved_legacy_final: [...prev].filter((x) => moved.has(x)),
    renames,
    lifetimes: Object.fromEntries(introduced.map((x) => [x, { first: chainFirst.get(x), last: chainLast.get(x), fixed: !finalChains.has(x) }])),
    tamper,
    replay_final_mismatch: finalMismatch,
    hooks,
    calls: calls.map((c) => ({ name: c.name, error: c.is_error, cmd: c.name === "Bash" ? String(c.input.command ?? "").slice(0, 200) : undefined })),
  };
}

/** Everything about the hooks, from the drift arm's state and logs. */
export function hookSummary(runDir, traj) {
  const sessions = existsSync(join(runDir, "drift-sessions")) ? readdirSync(join(runDir, "drift-sessions")).map((f) => readJson(join(runDir, "drift-sessions", f))) : [];
  const advised = new Set(sessions.flatMap((s) => s?.advised ?? []));
  const log = readJsonl(join(runDir, "hooklog.jsonl"));
  const byEvent = {};
  for (const l of log) {
    // Keyed by tool too: the Bash guard is a cheaper path than a file-tool
    // PreToolUse, and pooling them would move p50 and max away from earlier
    // pilots. File tools keep the bare event key those pilots used.
    const ev = l.args?.[0] === "hook" ? (l.tool === "Bash" ? `${l.args[2]}:Bash` : l.args[2]) : `cli:${l.args?.[0]}`;
    (byEvent[ev] ??= []).push(l.ms);
  }
  const lat = Object.fromEntries(
    Object.entries(byEvent).map(([k, ms]) => {
      const s = [...ms].sort((a, b) => a - b);
      return [k, { n: s.length, p50: s[Math.floor(s.length / 2)], max: s.at(-1) }];
    }),
  );
  const shown = traj.hooks.filter((h) => h.kind === "context");
  return {
    sessions: sessions.length,
    advised: [...advised],
    primed: [...new Set(sessions.flatMap((s) => s?.primed ?? []))],
    blocks: sessions.reduce((n, s) => n + (s?.blocks ?? 0), 0),
    baseline_size: sessions.map((s) => s?.baseline?.length ?? 0),
    latency_ms: lat,
    context_shown: { pre: shown.filter((h) => h.event === "PreToolUse").length, post: shown.filter((h) => h.event === "PostToolUse").length, start: shown.filter((h) => h.event === "SessionStart").length },
    stop_feedback: traj.hooks.filter((h) => h.kind === "stop_feedback").length,
    hook_errors: traj.hooks.filter((h) => /error/.test(h.kind) || (h.stdout ?? "").includes("hook error")).length,
    introduced_advised: traj.introduced.filter((k) => advised.has(k)).length,
    agent_drift_cli: traj.calls.filter((c) => c.cmd && /^\s*drift\s/.test(c.cmd)).map((c) => c.cmd),
    policy_tampering: traj.calls.filter((c) => c.cmd && /^\s*drift\s+(review|init)\b/.test(c.cmd)).length,
  };
}

/** Assemble score.json from meta, results, final state and trajectory. */
export function assemble(runDir, final, traj) {
  const meta = readJson(join(runDir, "meta.json"));
  const results = (meta.results ?? []).map((f) => readJson(join(runDir, f), {}));
  const sum = (k) => results.reduce((n, r) => n + (r?.[k] ?? 0), 0);
  const hooks = meta.arm === "drift" ? hookSummary(runDir, traj) : undefined;
  const row = {
    run: meta.run,
    task: meta.task,
    repo: meta.repo,
    category: meta.category,
    arm: meta.arm,
    model: meta.model,
    rep: meta.rep,
    exercises: meta.exercises,
    attempt: meta.attempt ?? 1,
    policy_hash: meta.policy_hash,
    drift_sha256: meta.drift_sha256,
    // A run is invalid (excluded from rates, reported per arm) when its sandbox was breached,
    // its tool set was not the expected one, or it tampered with Drift or the recorder.
    invalid: [...(meta.invalid ?? []), ...(final.tampered?.length ? [`tampered: ${final.tampered.join(", ")}`] : [])],
    timed_out: (meta.timed_out ?? []).some(Boolean),
    // final state (as v1, moved legacy code separated)
    files_changed: final.changed.length,
    final_violations: final.violations.length,
    final_ids: [...new Set(final.violations.map((k) => k.split(" ")[0]))],
    final_moved_legacy: final.moved_legacy?.length ?? 0,
    suppressions_added: final.suppressions_added,
    suppressed_new: final.suppressed.length,
    lines_added: final.lines_added,
    // trajectory
    edits: traj.edits,
    introduced: traj.introduced.length,
    fixed_later: traj.fixed_later.length,
    traj_final: traj.final.length,
    regressions: traj.regressions.length,
    regressions_final: traj.regressions_final.length,
    introduced_keys: traj.introduced,
    regression_keys: traj.regressions,
    moved_legacy: traj.moved_legacy.length,
    renames: traj.renames,
    tamper_calls: traj.tamper.calls.length,
    tamper_recorded: traj.tamper.recorder.length,
    tampered_final: final.tampered ?? [],
    replay_issues: traj.issues,
    replay_consistent: traj.replay_final_mismatch.length === 0 && [...traj.final_keys].sort().join("|") === [...final.violations].sort().join("|"),
    replay_final_mismatch: traj.replay_final_mismatch,
    // CI
    ci_exit: final.ci.exit,
    ci_exit_strict: final.ci.exit_strict,
    ci_results: final.ci.sarif_results,
    // security (facts the agent's change introduced; null for a drift build without it)
    sec_gaps: final.security?.guard_gaps ?? null,
    sec_unguarded_reaching: final.security?.unguarded_reaching ?? null,
    sec_sinks: final.security?.sinks ?? null,
    sec_leaks: final.security?.leaks ?? null,
    sec_gap_details: final.security?.gaps ?? [],
    // cost
    turns: sum("num_turns"),
    cost_usd: meta.cost_usd ?? resultCosts(results).reduce((n, c) => n + (c ?? 0), 0),
    seconds: Math.round(sum("duration_ms") / 1000),
    is_error: results.some((r) => r?.is_error) || meta.exit_codes?.some((c) => c !== 0),
    terminal: results.map((r) => r?.terminal_reason ?? r?.subtype),
    models_used: [...new Set(results.flatMap((r) => Object.keys(r?.modelUsage ?? {})))],
    hooks,
  };
  writeJson(join(runDir, "trajectory.json"), traj);
  writeJson(join(runDir, "score.json"), row);
  return row;
}

/** Full scoring of a worktree the agent just left. Removes nothing; the caller removes the worktree. */
export function scoreInPlace({ drift, wt, runDir, policyDir }) {
  const final = captureFinal({ drift, wt, runDir, policyDir });
  resetToPristine(wt);
  installPolicy(policyDir, wt);
  const meta = readJson(join(runDir, "meta.json"));
  const traj = replay({ drift, wt, runDir, runWts: [meta.wt], lockText: readFileSync(join(policyDir, "drift.lock"), "utf8") });
  return assemble(runDir, final, traj);
}

// ---------- CLI: rescore from artifacts ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const drift = a.drift;
  const work = a.work;
  const runs = a.run ? String(a.run).split(",") : readdirSync(join(work, "runs"));
  const labels = loadLabels();
  for (const id of runs) {
    const runDir = join(work, "runs", id);
    const meta = readJson(join(runDir, "meta.json"));
    const final = readJson(join(runDir, "final.json"));
    if (!meta || !final) {
      console.log(`${id}: no meta/final, skipped`);
      continue;
    }
    const { dir: policyDir } = await buildPolicy({ work, repos: a.repos, repo: meta.repo, drift, labels });
    const wt = join(work, "wt", `rescore-${id}`);
    await withWorktree(join(a.repos, meta.repo), wt, async () => {
      hideHarnessFiles(wt, join(runDir, "exclude.rescore"));
      installPolicy(policyDir, wt);
      const traj = replay({ drift, wt, runDir, runWts: [meta.wt], lockText: readFileSync(join(policyDir, "drift.lock"), "utf8") });
      const row = assemble(runDir, final, traj);
      console.log(`${id}: introduced ${row.introduced}, fixed ${row.fixed_later}, final ${row.traj_final}, regressions ${row.regressions}, consistent ${row.replay_consistent}`);
    });
  }
}
