// Self-test of the scorer and the report, with no model calls. Synthetic immich sessions:
//
//  1 decorator-insert: a route inserted between an existing @Authenticated and its handler
//    (regression on GET /albums/:id/map-markers), then fixed; a missing old_string; a Bash-made
//    undecorated controller (recorder only); an Edit that failed in session. Then the final
//    state is captured, assembled with a drift arm's hook state (introduced_advised), and the
//    replay must agree with the final tree.
//  2 failed Bash: `sed -i` removes a decorator and the command fails (no recorder step of its
//    own); the next Write's snapshot carries the change. Must equal the same change as a Write.
//  3 orphan: the same change from a recorder step with no transcript call (a subagent's Edit).
//  4 moved legacy: `git mv` of a controller with a baselined violation and no code change.
//  5 Write, then MultiEdit renaming the new route, then `rm`: one violation chain per rule,
//    renamed once, fixed by the deletion.
//  6 fidelity: an Edit whose replay differs from the snapshot, and a missing old_string with a
//    snapshot to fall back on.
//  7 two sessions (a resumed chain), the second fixing the first's violation.
//  8 tampering: an Edit to .drift/conventions.yaml and a recorder-seen change to drift.lock.
//  9 report: Wilson values and the paired/cluster output on a synthetic work dir.
// 10 policy refusal when convention ids and labels disagree.
// 11 detection of files written outside the checkout.
//
//   node eval/agent-ab/v2/selftest.mjs --drift <bin> --repos <dir> --work <dir>

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, buildPolicy, here, hideHarnessFiles, installPolicy, loadLabels, policyProblems, resetToPristine, sha, tamperHashes, wilson, withWorktree, writeJson } from "./lib.mjs";
import { assemble, captureFinal, replay } from "./score.mjs";
import { diffSnapshots, snapshotOutside, snapshotTree, writesOutside } from "./sandbox.mjs";

const a = args();
const drift = resolve(a.drift);
const repos = resolve(a.repos);
const work = resolve(a.work);
const { dir: policyDir } = await buildPolicy({ work, repos, repo: "immich", drift, labels: loadLabels() });
const lockText = readFileSync(join(policyDir, "drift.lock"), "utf8");
const pristine = (p) => readFileSync(join(repos, "immich", p), "utf8");

const fakeWt = "/fake/run/worktree";
const CTL = "server/src/controllers/album.controller.ts";
const SYNC = "server/src/controllers/sync.controller.ts";
const use = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id, err = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: err, content: err ? "<tool_use_error>failed</tool_use_error>" : "ok" }] } });
const abs = (p) => `${fakeWt}/${p}`;

/** A synthetic run dir: transcripts (one array of lines per session) and recorder steps. */
function scenario(name, sessions, steps, blobs = {}, meta = {}) {
  const runDir = join(work, "runs", `selftest-${name}`);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(join(runDir, "transcripts"), { recursive: true });
  mkdirSync(join(runDir, "rec", "blobs"), { recursive: true });
  for (const [h, content] of Object.entries(blobs)) writeFileSync(join(runDir, "rec", "blobs", h), content);
  writeFileSync(join(runDir, "rec", "steps.jsonl"), steps.map((s, i) => JSON.stringify({ seq: i + 1, ...s })).join("\n") + (steps.length ? "\n" : ""));
  const ids = sessions.map((_, i) => `s${i + 1}`);
  sessions.forEach((lines, i) => writeFileSync(join(runDir, "transcripts", `${ids[i]}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  writeJson(join(runDir, "meta.json"), { run: `selftest-${name}`, task: name, repo: "immich", category: "a", arm: "control", model: "none", sessions: ids, wt: fakeWt, results: [], ...meta });
  return runDir;
}
const blobOf = (content) => [sha(Buffer.from(content)), content];

const results = [];
const eq = (name, got, want) => {
  const g = [...got].sort(), w = [...want].sort();
  const ok = g.length === w.length && g.every((x, i) => x === w[i]);
  results.push([name, ok, ok ? "" : `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`]);
};
const ok = (name, cond, info = "") => results.push([name, !!cond, cond ? "" : info]);

const wt = join(work, "wt", "selftest");
await withWorktree(join(repos, "immich"), wt, async () => {
  hideHarnessFiles(wt, join(work, "selftest.exclude"));
  const fresh = () => {
    resetToPristine(wt);
    installPolicy(policyDir, wt);
  };
  const go = (runDir) => {
    fresh();
    return replay({ drift, wt, runDir, runWts: [fakeWt], lockText });
  };

  // 1 decorator insert, fix, miss, Bash-made file, failed edit; then final capture and assemble.
  {
    const anchor = "  @Authenticated({ permission: Permission.AlbumRead, sharedLink: true })\n  @Get(':id/map-markers')";
    const bad = "  @Authenticated({ permission: Permission.AlbumRead, sharedLink: true })\n  @Get(':id/stats')\n  getAlbumStats(@Param() { id }: UUIDParamDto) {\n    return id;\n  }\n\n  @Get(':id/map-markers')";
    const good = "  @Authenticated({ permission: Permission.AlbumRead })\n  @Get(':id/stats')\n  @Endpoint({ summary: 'Album stats', description: 'Stats', history: new HistoryBuilder().added('v3') })\n  getAlbumStats(@Param() { id }: UUIDParamDto) {\n    return id;\n  }\n\n  @Authenticated({ permission: Permission.AlbumRead, sharedLink: true })\n  @Get(':id/map-markers')";
    const ping = "import { Controller, Get } from '@nestjs/common';\n\n@Controller('ping')\nexport class PingController {\n  @Get()\n  ping() {\n    return 'pong';\n  }\n}\n";
    const [hp] = blobOf(ping);
    const runDir = scenario(
      "decorator",
      [[
        use("t1", "Edit", { file_path: abs(CTL), old_string: anchor, new_string: bad }), res("t1"),
        use("t2", "Edit", { file_path: abs(CTL), old_string: bad, new_string: good }), res("t2"),
        use("t3", "Edit", { file_path: abs(CTL), old_string: "this text is not in the file", new_string: "x" }), res("t3"),
        use("t4", "Bash", { command: "cat > server/src/controllers/ping.controller.ts <<'EOF' ... EOF" }), res("t4"),
        use("t5", "Edit", { file_path: abs(CTL), old_string: "nope", new_string: "x" }), res("t5", true),
      ]],
      [{ tool_use_id: "t4", tool: "Bash", changes: [{ path: "server/src/controllers/ping.controller.ts", sha: hp }] }],
      { [hp]: ping },
      { arm: "drift", installed: {} },
    );
    const traj = go(runDir);
    const P = "server/src/controllers/ping.controller.ts";
    const mm = `${CTL}#GET /albums/:id/map-markers`;
    eq("1 introduced", traj.introduced, [`D-63d2cd ${mm}`, `D-876763 ${mm}`, `D-c10e8e ${CTL}#GET /albums/:id/stats`, `D-63d2cd ${P}#GET /ping`, `D-876763 ${P}#GET /ping`, `D-8ab952 ${P}#PingController`, `D-c10e8e ${P}#GET /ping`, `D-ed6dc0 ${P}#PingController`]);
    eq("1 regressions", traj.regressions, [`D-63d2cd ${mm}`, `D-876763 ${mm}`]);
    eq("1 fixed later", traj.fixed_later, [`D-63d2cd ${mm}`, `D-876763 ${mm}`, `D-c10e8e ${CTL}#GET /albums/:id/stats`]);
    eq("1 final", traj.final, [`D-63d2cd ${P}#GET /ping`, `D-876763 ${P}#GET /ping`, `D-8ab952 ${P}#PingController`, `D-c10e8e ${P}#GET /ping`, `D-ed6dc0 ${P}#PingController`]);
    ok("1 issues", traj.issues.replay_miss === 1 && traj.issues.failed_in_session === 1 && traj.issues.bash_changes === 1, JSON.stringify(traj.issues));
    // The checkout now holds the replayed final state: capture it as the agent's final tree.
    writeJson(join(runDir, "drift-sessions", "s1.json"), { advised: [`D-876763 ${mm}`], primed: [], blocks: 0, baseline: [] });
    const final = captureFinal({ drift, wt, runDir, policyDir });
    eq("1 final state = replay", final.violations, traj.final_keys);
    const row = assemble(runDir, final, traj);
    ok("1 replay consistent", row.replay_consistent === true);
    ok("1 introduced_advised", row.hooks?.introduced_advised === 1, JSON.stringify(row.hooks));
    ok("1 CI fails on what was left", row.ci_exit !== 0 && row.ci_results === 5, `${row.ci_exit} ${row.ci_results}`);
  }

  // The reference for 2 and 3: the same change as a plain Write.
  const noAuth = pristine(SYNC).replace("  @Authenticated({ permission: Permission.SyncStream })\n", "");
  const [hn] = blobOf(noAuth);
  const [hx, x] = blobOf("export const x = 1;\n");
  const ref = go(scenario("ref", [[use("w1", "Write", { file_path: abs(SYNC), content: noAuth }), res("w1")]], [{ tool_use_id: "w1", tool: "Write", changes: [{ path: SYNC, sha: hn }] }], { [hn]: noAuth }));
  eq("ref introduced", ref.introduced, [`D-63d2cd ${SYNC}#POST /sync/stream`, `D-876763 ${SYNC}#POST /sync/stream`]);

  // 2 failed Bash, picked up by the next step's snapshot.
  {
    const t = go(
      scenario(
        "failed-bash",
        [[use("b1", "Bash", { command: `sed -i '/SyncStream })/d' ${SYNC} && npm test` }), res("b1", true), use("w2", "Write", { file_path: abs("server/src/x.ts"), content: x }), res("w2")]],
        [{ tool_use_id: "w2", tool: "Write", changes: [{ path: "server/src/x.ts", sha: hx }, { path: SYNC, sha: hn }] }],
        { [hn]: noAuth, [hx]: x },
      ),
    );
    eq("2 failed Bash = Write", t.introduced, ref.introduced);
    ok("2 counted as extra change", t.issues.extra_changes === 1, JSON.stringify(t.issues));
  }
  // 2b the same with the recorder's own PostToolUseFailure step.
  {
    const t = go(scenario("failed-bash-recorded", [[use("b1", "Bash", { command: `sed -i ... && npm test` }), res("b1", true)]], [{ tool_use_id: "b1", tool: "Bash", event: "PostToolUseFailure", changes: [{ path: SYNC, sha: hn }] }], { [hn]: noAuth }));
    eq("2b failed Bash with its own step", t.introduced, ref.introduced);
  }

  // 3 orphan recorder step.
  {
    const t = go(scenario("orphan", [[]], [{ tool_use_id: "sub-1", tool: "Edit", changes: [{ path: SYNC, sha: hn }] }], { [hn]: noAuth }));
    eq("3 orphan step applied", t.introduced, ref.introduced);
    ok("3 orphan counted", t.issues.orphan_steps === 1);
  }

  // 4 moved legacy (git mv, no code change).
  {
    const moved = "server/src/controllers/sync-stream.controller.ts";
    const [hs, sync] = blobOf(pristine(SYNC));
    const t = go(scenario("moved", [[use("m1", "Bash", { command: `git mv ${SYNC} ${moved}` }), res("m1")]], [{ tool_use_id: "m1", tool: "Bash", changes: [{ path: SYNC, sha: null }, { path: moved, sha: hs }] }], { [hs]: sync }));
    eq("4 nothing introduced", t.introduced, []);
    eq("4 moved legacy", t.moved_legacy, [`D-379261 ${moved}#POST /sync/stream`]);
  }

  // 5 Write, MultiEdit rename of the new route, rm.
  {
    const P = "server/src/controllers/ping.controller.ts";
    const ping = "import { Controller, Get } from '@nestjs/common';\n\n@Controller('ping')\nexport class PingController {\n  @Get('a')\n  ping() {\n    return 'pong';\n  }\n}\n";
    const pong = ping.replace("@Get('a')", "@Get('b')").replace("ping() {", "pong() {");
    const [h1] = blobOf(ping);
    const [h2] = blobOf(pong);
    const t = go(
      scenario(
        "rename",
        [[
          use("w1", "Write", { file_path: abs(P), content: ping }), res("w1"),
          use("e1", "MultiEdit", { file_path: abs(P), edits: [{ old_string: "@Get('a')", new_string: "@Get('b')" }, { old_string: "ping() {", new_string: "pong() {" }] }), res("e1"),
          use("r1", "Bash", { command: `rm ${P}` }), res("r1"),
        ]],
        [
          { tool_use_id: "w1", tool: "Write", changes: [{ path: P, sha: h1 }] },
          { tool_use_id: "e1", tool: "MultiEdit", changes: [{ path: P, sha: h2 }] },
          { tool_use_id: "r1", tool: "Bash", changes: [{ path: P, sha: null }] },
        ],
        { [h1]: ping, [h2]: pong },
      ),
    );
    eq("5 one chain per rule", t.introduced, [`D-63d2cd ${P}#GET /ping/a`, `D-876763 ${P}#GET /ping/a`, `D-8ab952 ${P}#PingController`, `D-c10e8e ${P}#GET /ping/a`, `D-ed6dc0 ${P}#PingController`]);
    ok("5 renamed, not re-introduced", t.renames === 3, `renames ${t.renames}`);
    eq("5 all fixed by rm", t.final, []);
    ok("5 no fidelity issues", t.issues.fidelity_mismatch === 0 && t.issues.replay_miss === 0, JSON.stringify(t.issues));
  }

  // 6 fidelity mismatch and fallback snapshot.
  {
    const [hn2, noAuth2] = blobOf(noAuth);
    const t = go(
      scenario(
        "fidelity",
        [[
          use("e1", "Edit", { file_path: abs(SYNC), old_string: "@Post('stream')", new_string: "@Post('stream')" }), res("e1"),
          use("e2", "Edit", { file_path: abs(SYNC), old_string: "text the agent saw differently", new_string: "y" }), res("e2"),
        ]],
        [{ tool_use_id: "e1", tool: "Edit", changes: [{ path: SYNC, sha: hn2 }] }, { tool_use_id: "e2", tool: "Edit", changes: [{ path: SYNC, sha: hn2 }] }],
        { [hn2]: noAuth2 },
      ),
    );
    ok("6 fidelity mismatch seen", t.issues.fidelity_mismatch === 1, JSON.stringify(t.issues));
    ok("6 fallback snapshot used", t.issues.fallback_snapshot === 1, JSON.stringify(t.issues));
    eq("6 snapshot wins", t.introduced, ref.introduced);
  }

  // 7 two sessions.
  {
    const t = go(
      scenario(
        "sessions",
        [[use("w1", "Write", { file_path: abs(SYNC), content: noAuth }), res("w1")], [use("w2", "Write", { file_path: abs(SYNC), content: pristine(SYNC) }), res("w2")]],
        [{ tool_use_id: "w1", tool: "Write", changes: [{ path: SYNC, sha: hn }] }, { tool_use_id: "w2", tool: "Write", changes: [{ path: SYNC, sha: sha(Buffer.from(pristine(SYNC))) }] }],
        { [hn]: noAuth, [sha(Buffer.from(pristine(SYNC)))]: pristine(SYNC) },
      ),
    );
    eq("7 introduced in session 1", t.introduced, ref.introduced);
    eq("7 fixed in session 2", t.final, []);
  }

  // 8 tampering.
  {
    const t = go(
      scenario(
        "tamper",
        [[use("e1", "Edit", { file_path: abs(".drift/conventions.yaml"), old_string: "mode: block", new_string: "mode: advise" }), res("e1"), use("b1", "Bash", { command: "sed -i d drift.lock" }), res("b1")]],
        [{ tool_use_id: "b1", tool: "Bash", changes: [], tamper: [{ path: "drift.lock", sha: null }] }],
      ),
    );
    ok("8 tamper calls", t.tamper.calls.length === 2, JSON.stringify(t.tamper));
    ok("8 tamper recorded", t.tamper.recorder.length === 1, JSON.stringify(t.tamper));
    fresh();
    const before = tamperHashes(wt);
    writeFileSync(join(wt, ".drift/conventions.yaml"), "tampered");
    const after = tamperHashes(wt);
    ok("8 final hash differs", before[".drift/conventions.yaml"] !== after[".drift/conventions.yaml"]);
  }
});

// 9 statistics and the report.
{
  const [lo, hi] = wilson(3, 10);
  ok("9 wilson(3,10)", Math.abs(lo - 0.1078) < 1e-3 && Math.abs(hi - 0.6032) < 1e-3, `${lo} ${hi}`);
  ok("9 wilson(0,4) upper", Math.abs(wilson(0, 4)[1] - 0.4899) < 1e-3);
  const sw = join(work, "selftest-report");
  rmSync(sw, { recursive: true, force: true });
  for (let t = 1; t <= 6; t++)
    for (const arm of ["control", "drift"])
      for (let r = 1; r <= 2; r++) {
        const fin = arm === "control" && t <= 5 ? 1 : 0;
        writeJson(join(sw, "runs", `t${t}__${arm}__x__r${r}`, "score.json"), { run: `t${t}__${arm}__r${r}`, task: `t${t}`, category: t <= 3 ? "a" : "b", arm, model: "m", final_violations: fin, introduced: fin, fixed_later: 0, regressions: 0, ci_exit: fin, ci_exit_strict: fin, suppressions_added: 0, turns: 1, seconds: 1, cost_usd: 0, invalid: [], replay_consistent: true });
      }
  writeJson(join(sw, "runs", "t6__drift__x__r3", "score.json"), { run: "bad", task: "t6", category: "b", arm: "drift", model: "m", final_violations: 9, introduced: 9, fixed_later: 0, regressions: 0, ci_exit: 1, suppressions_added: 0, turns: 1, seconds: 1, invalid: ["init: tools"], replay_consistent: true });
  const out = execFileSync("node", [join(here, "report.mjs"), "--work", sw], { encoding: "utf8" });
  ok("9 paired over tasks", /\*\*final\*\*: 83% over 6 tasks \(Drift better 5, tie 1, worse 0\) \[/.test(out), out.split("\n").find((l) => l.includes("**final**")));
  ok("9 invalid run excluded and listed", /invalid bad: init: tools/.test(out) && /\| drift \| 12 \| 6 \| 0\/12 0%/.test(out), "");
}

// 10 a drift build whose convention ids differ from the labels is refused.
{
  const labels = new Map([["D-aaa", { repo: "r", label: "ACCEPT" }], ["D-bbb", { repo: "r", label: "WRONG" }]]);
  const expect = { repos: { r: ["D-aaa"] } };
  ok("10 matching ids pass", policyProblems({ repo: "r", convs: [{ id: "D-aaa" }, { id: "D-bbb" }], labels, expect, headSha: "x", pinnedSha: "x" }).length === 0);
  const pr = policyProblems({ repo: "r", convs: [{ id: "D-ccc" }, { id: "D-bbb" }], labels, expect, headSha: "x", pinnedSha: "y" });
  ok("10 changed ids refused", pr.length === 3 && pr.some((x) => /without a reviewer label/.test(x)) && pr.some((x) => /not proposed/.test(x)) && pr.some((x) => /pins/.test(x)), JSON.stringify(pr));
}

// 11 a write outside the checkout is found; the skipped run dirs are not.
{
  const d = join(work, "selftest-outside");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(join(d, "runs", "x"), { recursive: true });
  mkdirSync(join(d, "policy"), { recursive: true });
  writeFileSync(join(d, "policy", "conventions.yaml"), "x");
  const before = snapshotTree(d, ["runs"]);
  writeFileSync(join(d, "runs", "x", "fine.txt"), "x");
  writeFileSync(join(d, "policy", "user-mfa-header.ts"), "x");
  const found = diffSnapshots(before, snapshotTree(d, { skipTop: ["runs"] }));
  eq("11 outside write found", found, [join(d, "policy", "user-mfa-header.ts")]);

  // 11b --work inside HOME and inside the harness repo: the harness's own writes are not a breach,
  // a write to ~/.ssh still is.
  const home = join(work, "selftest-home");
  rmSync(home, { recursive: true, force: true });
  const w = join(home, "drift", "eval-work");
  for (const p of [join(w, "runs", "r1", "rec"), join(w, "homes", "r1", ".claude", "projects", "x"), join(w, "policy"), join(home, ".ssh"), join(home, "repos", "immich")]) mkdirSync(p, { recursive: true });
  writeFileSync(join(home, ".ssh", "known_hosts"), "x");
  writeFileSync(join(home, ".bashrc"), "x");
  const o = { work: w, repos: join(home, "repos"), repoDir: join(home, "repos", "immich"), home, harness: join(home, "drift") };
  const snap = snapshotOutside(o);
  writeFileSync(join(w, "runs", "r1", "rec", "steps.jsonl"), "{}\n");
  writeFileSync(join(w, "homes", "r1", ".claude", "projects", "x", "t.jsonl"), "{}\n");
  writeFileSync(join(w, "ledger.jsonl"), "{}\n");
  writeFileSync(join(home, "notes.txt"), "the operator's own file");
  eq("11b own writes under HOME and the harness repo are not outside", writesOutside(o, snap), []);
  writeFileSync(join(home, ".ssh", "x"), "key");
  eq("11b a write to ~/.ssh is caught", writesOutside(o, snap), [join(home, ".ssh", "x")]);
}

for (const [name, pass, info] of results) console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: ${info}`}`);
process.exit(results.every(([, pass]) => pass) ? 0 : 1);
