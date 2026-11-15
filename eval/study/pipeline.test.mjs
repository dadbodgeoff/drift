// The whole labelling pipeline on synthetic repos with a stand-in drift binary and synthetic labels:
// prepare -> prompt -> collect -> agree -> adjudicate -> metrics, checked by dry-run.mjs. No network, no real
// repo, no cargo build: it tests the plumbing (run.json language and framework_bucket included), not Drift.
//
//   node --test eval/study/pipeline.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, rubricText, sha256Text } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "study-pipeline-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// A stand-in `drift`: census text and conventions.yaml in the shapes lib.mjs parses, keyed by the repo's name.
const PROPOSALS = {
  "ts-a": [
    ["D-a00001", "wrapped_by", "call", 40],
    ["D-a00002", "passes_key", null, 20],
    ["D-a00003", "calls", null, 50],
    ["D-a00004", "wrapped_by", "jsx", 14],
  ],
  "ts-b": [
    ["D-b00001", "avoids", "import:src/db/**", 30],
    ["D-b00002", "avoids", "any", 30],
    ["D-b00003", "renders", null, 18],
  ],
  "py-c": [
    ["D-c00001", "wrapped_by", "decorator", 15],
    ["D-c00002", "wrapped_by", "extends", 16],
    ["D-c00003", "named", null, 20],
    ["D-c00004", "wrapped_by", "try", 100],
  ],
};
const fakeDrift = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const P = ${JSON.stringify(PROPOSALS)};
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("drift fake-for-tests"); process.exit(0); }
const root = a[a.indexOf("--root") + 1];
// FAKE_PY_OPTIN=1: Python proposals are off unless opted in, as since round 11 (D13-py): census --python-proposals,
// and for init the checkout's .drift/config.yaml "proposals: {python: on}".
const pyOff = process.env.FAKE_PY_OPTIN === "1" && path.basename(root).startsWith("py-");
const cfg = path.join(root, ".drift", "config.yaml");
const optedIn = a.includes("--python-proposals") || (a.includes("init") && fs.existsSync(cfg) && /python: on/.test(fs.readFileSync(cfg, "utf8")));
const props = pyOff && !optedIn ? [] : P[path.basename(root)];
const rule = ([, type, x]) => type === "wrapped_by" ? { type, kind: x, any_of: ["lib/x.ts#w"] } : type === "avoids" ? { type, signal: x } : { type };
// The product's tier line, as D7 gives it for these in-repo rules (Python repos' examples are .py files, and
// Python advises only); FAKE_TIER_FLIP=<id> prints the other tier, FAKE_TIER_OMIT=<id> prints no tier line for
// that proposal.
const DEFAULT_KINDS = ["wrapped_by:call", "avoids:import"];
const python = path.basename(root).startsWith("py-");
const kindOf = ([, type, x]) => type === "wrapped_by" ? "wrapped_by:" + x : type === "avoids" ? (x.startsWith("import:") ? "avoids:import" : "avoids:other") : type;
const tierOf = (p) => {
  const t = !python && DEFAULT_KINDS.includes(kindOf(p)) && p[3] >= 15 ? "default" : "suggestion";
  return process.env.FAKE_TIER_FLIP === p[0] ? (t === "default" ? "suggestion" : "default") : t;
};
if (a.includes("scan")) {
  const n = { "ts-a": [250, 0], "ts-b": [150, 0], "py-c": [230, 20] }[path.basename(root)];
  console.log("drift scan: " + n[0] + " files in 0.01s\\n  cache hits:      0\\n  parse errors:    " + n[1]);
} else if (a.includes("census")) {
  const out = [props.length + " conventions from 100 units in 10 roles", ""];
  props.forEach((p, i) => {
    out.push(" " + (i + 1) + ". [" + p[0] + "] files in src/** follow rule " + p[0]);
    out.push("    evidence: " + (p[3] - 1) + "/" + p[3] + " (lower bound 0.90, lift 2.0)");
    if (process.env.FAKE_TIER_OMIT !== p[0]) out.push("    tier:     " + tierOf(p));
    out.push("    example:  src/ex" + i + (python ? ".py" : ".ts") + "#ex");
    out.push("    outlier:  src/out" + i + ".ts:3 bad");
    out.push("");
  });
  console.log(out.join("\\n"));
} else if (a.includes("init")) {
  fs.mkdirSync(path.join(root, ".drift"), { recursive: true });
  const y = ["version: 1", "conventions:"];
  for (const p of props) {
    y.push("- id: " + p[0], "  role:", "    dir: src", "  rule:");
    for (const [k, v] of Object.entries(rule(p))) y.push(Array.isArray(v) ? "    " + k + ":\\n    - " + v[0] : "    " + k + ": " + JSON.stringify(v));
    y.push("  evidence:", "    holders: " + (p[3] - 1), "    total: " + p[3]);
  }
  fs.writeFileSync(path.join(root, ".drift", "conventions.yaml"), y.join("\\n") + "\\n");
}
`;
const drift = join(tmp, "bin", "drift");
mkdirSync(dirname(drift), { recursive: true });
writeFileSync(drift, fakeDrift);
chmodSync(drift, 0o755);

const git = (dir, ...a) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const LANG = { "ts-a": ["TypeScript", "nextjs"], "ts-b": ["JavaScript", "express_fastify_hono"], "py-c": ["Python", "django"] };
const repos = Object.keys(PROPOSALS).map((name) => {
  const dir = join(tmp, "src", name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), `export const name = ${JSON.stringify(name)};\n`);
  // two more tracked files: the "other members" a labeller opens (collect.mjs counts only tracked files)
  for (const m of ["m1", "m2"]) writeFileSync(join(dir, "src", `${m}.ts`), `export const ${m} = 1;\n`);
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return { name, url: dir, sha: git(dir, "rev-parse", "HEAD"), language: LANG[name][0], framework_bucket: LANG[name][1] };
});
const { tier } = JSON.parse(readFileSync(join(here, "..", "holdout-primary.json"), "utf8"));
const manifest = join(tmp, "dev-synthetic.json");
writeFileSync(manifest, JSON.stringify({ tier, max: 15, pool: 200, repos }));

const RUN = join(tmp, "run");
const node = (script, ...a) => {
  const r = spawnSync(process.execPath, [join(here, script), ...a], { encoding: "utf8" });
  assert.equal(r.status, 0, `${script} ${a.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};

test("prepare -> label A/B -> agree -> adjudicate -> metrics, with synthetic labels", () => {
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", RUN, "--cache", join(tmp, "cache"), "--strict-tier");
  const run = JSON.parse(readFileSync(join(RUN, "run.json"), "utf8"));
  assert.deepEqual(run.repos.map((r) => [r.name, r.status, r.language, r.framework_bucket, r.proposals]), repos.map((r) => [r.name, "ok", r.language, r.framework_bucket, PROPOSALS[r.name].length]));
  assert.deepEqual(run.params.tier, tier);

  for (const L of ["A", "B"]) {
    node("prompt.mjs", "label", "--run", RUN, "--labeller", L, "--rubric", "v3");
    if (L === "A") {
      // a run labelled under v3 (decision D6; new runs default to v4, F1), recorded per prompt
      const idx = JSON.parse(readFileSync(join(RUN, "prompts", "index.json"), "utf8"));
      assert.deepEqual([...new Set(idx.map((e) => e.rubric))], ["v3"]);
      const text = readFileSync(idx[0].prompt, "utf8");
      assert.match(text, /Labelling rubric v3/);
      assert.match(text, /R1\. Outliers that are a different kind of thing/);
      assert.doesNotMatch(text, /decision D6/, "the study-history header is not shown to labellers");
    }
    node("dry-run.mjs", "fill", "--run", RUN, "--stage", "label");
    node("collect.mjs", "--run", RUN, "--stage", "label");
  }
  writeFileSync(join(RUN, "agreement.md"), node("agree.mjs", "--run", RUN, "--json", join(RUN, "agreement.json")));
  node("adjudicate.mjs", "--run", RUN);
  const cases = JSON.parse(readFileSync(join(RUN, "adjudication", "queue.json"), "utf8")).cases;
  assert.ok(cases.length > 0, "the synthetic rule produces disagreements");
  node("prompt.mjs", "adjudicate", "--run", RUN);
  node("dry-run.mjs", "fill", "--run", RUN, "--stage", "adjudicate");
  node("collect.mjs", "--run", RUN, "--stage", "adjudicate");
  node("adjudicate.mjs", "--run", RUN, "--merge");
  // blinding: no label or adjudication prompt says that earlier rubrics or labels exist, or which way a rule moves them
  const prompts = JSON.parse(readFileSync(join(RUN, "prompts", "index.json"), "utf8")).filter((e) => e.stage === "label" || e.stage === "adjudicate");
  assert.ok(prompts.some((e) => e.stage === "adjudicate") && prompts.some((e) => e.labeller === "B"));
  for (const e of prompts) {
    const text = readFileSync(e.prompt, "utf8");
    for (const bad of [/Moves labels/, /\bv2\b/, /\bv1\b/, /study-only/, /earlier (labels|studies|rounds)/i, /\bprior\b/i, /calibrat/i]) assert.doesNotMatch(text, bad, `${e.prompt}`);
    // the recorded hash is the hash of the labeller-facing rubric text, which the prompt contains verbatim
    assert.ok(text.includes(rubricText("v3")), "the prompt contains the labeller-facing rubric text");
    assert.equal(e.rubric_sha256, sha256Text(rubricText("v3")));
    assert.equal(e.rubric_sha256, APPROVED_RUBRIC.sha256, "the committed RUBRIC-v3.md is the text approved with D6");
  }
  // recall: sources -> extract -> match -> score, with synthetic extractor and matcher output
  node("recall.mjs", "sources", "--run", RUN);
  for (const stage of ["extract", "match"]) {
    node("prompt.mjs", stage, "--run", RUN);
    node("dry-run.mjs", "fill", "--run", RUN, "--stage", stage);
    node("collect.mjs", "--run", RUN, "--stage", stage);
  }
  node("recall.mjs", "score", "--run", RUN, "--json", join(RUN, "recall.json"));
  node("metrics.mjs", "--run", RUN, "--json", join(RUN, "metrics.json"));
  const out = node("dry-run.mjs", "check", "--run", RUN, "--metrics", join(RUN, "metrics.json"), "--agreement", join(RUN, "agreement.json"), "--recall", join(RUN, "recall.json"));
  assert.match(out, /final labels, agreement, overall, tier and per-language tables, recall match the synthetic rule/);
  assert.equal(JSON.parse(readFileSync(join(RUN, "recall.json"), "utf8")).overall.n, 3 * 3, "3 code-checkable synthetic items per repo");

  const m = JSON.parse(readFileSync(join(RUN, "metrics.json"), "utf8"));
  assert.deepEqual(m.by_language.map((g) => [g.language, g.repos, g.default_tier.shown, g.suggestion_tier.shown]), [
    ["typescript/javascript", ["ts-a", "ts-b"], 2, 5],
    ["python", ["py-c"], 0, 4],
  ]);
  assert.deepEqual(m.by_framework.map((g) => g.framework_bucket), ["nextjs", "express_fastify_hono", "django"]);
  // rubric and decisions in metrics.json (decision D6); a tier from the manifest is pre-registered
  const idx = JSON.parse(readFileSync(join(RUN, "prompts", "index.json"), "utf8"));
  assert.equal(m.rubric, "v3");
  assert.equal(m.rubric_sha256, idx[0].rubric_sha256);
  assert.deepEqual(m.label_rubrics, { v3: run.repos.reduce((n, r) => n + r.proposals, 0) });
  assert.ok(m.decisions.some((d) => d.id === "D6" && d.status === "approved"));
  assert.equal(run.params.tier_pre_registered, true);
  assert.equal(m.tier.pre_registered, true);
  // a derived view (tier applied after the fact) says so, in the data and in the report
  const VIEW = join(tmp, "view");
  mkdirSync(VIEW, { recursive: true });
  writeFileSync(join(VIEW, "run.json"), JSON.stringify({ ...run, params: { ...run.params, tier_pre_registered: false } }));
  writeFileSync(join(VIEW, "queue.json"), readFileSync(join(RUN, "queue.json")));
  const md = node("metrics.mjs", "--run", VIEW, "--labels", join(RUN, "final.jsonl"), "--json", join(VIEW, "metrics.json"));
  assert.equal(JSON.parse(readFileSync(join(VIEW, "metrics.json"), "utf8")).tier.pre_registered, false);
  assert.match(md, /NOT pre-registered \(run\.json params\.tier_pre_registered: false\)/);
  assert.doesNotMatch(md, /, pre-registered\)/);
});

test("prepare.mjs stops when the census's own tier disagrees with the pre-registered tier", () => {
  const run2 = join(tmp, "run-tier-mismatch");
  const r = spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift", drift, "--manifest", manifest, "--run", run2, "--cache", join(tmp, "cache"), "--strict-tier"], {
    encoding: "utf8",
    env: { ...process.env, FAKE_TIER_FLIP: "D-a00002" },
  });
  assert.notEqual(r.status, 0, "a tier mismatch is not a per-repo failure: the run stops");
  assert.match(r.stderr, /ts-a\/D-a00002: the census says tier default, the pre-registered tier gives suggestion \(passes_key, 20 members\)/);
  // Without --strict-tier a dev run records the queue as before (held-out runs are always strict).
  const run3 = join(tmp, "run-tier-lenient");
  const ok = spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift", drift, "--manifest", manifest, "--run", run3, "--cache", join(tmp, "cache")], {
    encoding: "utf8",
    env: { ...process.env, FAKE_TIER_FLIP: "D-a00002" },
  });
  assert.equal(ok.status, 0, ok.stderr);
});

test("prepare.mjs stops when the census prints no tier line for a proposal (the guard fails closed)", () => {
  const run2 = join(tmp, "run-tier-missing");
  const r = spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift", drift, "--manifest", manifest, "--run", run2, "--cache", join(tmp, "cache"), "--strict-tier"], {
    encoding: "utf8",
    env: { ...process.env, FAKE_TIER_OMIT: "D-b00001" },
  });
  assert.notEqual(r.status, 0, "a missing tier line is a mismatch, not agreement: the run stops");
  assert.match(r.stderr, /ts-b\/D-b00001: the census prints no tier line, the pre-registered tier gives default \(avoids:import, 30 members\)/);
  assert.ok(!existsSync(join(run2, "run.json")), "no run record is written");
  // Without --strict-tier a dev run records the queue as before (held-out runs are always strict).
  const run3 = join(tmp, "run-tier-missing-lenient");
  const ok = spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift", drift, "--manifest", manifest, "--run", run3, "--cache", join(tmp, "cache")], {
    encoding: "utf8",
    env: { ...process.env, FAKE_TIER_OMIT: "D-b00001" },
  });
  assert.equal(ok.status, 0, ok.stderr);
});

// Held-out runs, on a scratch harness: a git repository with this harness's prepare.mjs, lib.mjs, tier-d5.json
// and tier-d7.json, and registered, frozen held-out manifests of made-up sets: secondary sets that hold D7 (their
// tier, D7a), D5 (their tier before D7a) or another tier, and a primary set that holds D7 (the primaries' tier) or D5. The "other tier" cases
// have to be made up: every registered manifest holds its set's tier. Nothing here builds Drift or clones a repo: a run that
// passes every check reaches the build, where the scratch tree has no Cargo.toml.
const harness = async (name) => {
  const { CORE_SCHEME, coreSha } = await import("./lib.mjs");
  const h = join(tmp, name);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const g = (...a) => {
    const r = spawnSync("git", ["-C", h, "-c", "commit.gpgsign=false", ...a], { env, encoding: "utf8" });
    assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  mkdirSync(join(h, "eval", "study", "runs"), { recursive: true });
  writeFileSync(join(h, "eval", "study", "runs", ".keep"), "");
  for (const f of ["prepare.mjs", "lib.mjs", "tier-d5.json", "tier-d7.json", "RUBRIC-v3.md"]) writeFileSync(join(h, "eval", "study", f), readFileSync(join(here, f)));
  const d5 = JSON.parse(readFileSync(join(here, "tier-d5.json"), "utf8")).tier;
  const d7 = JSON.parse(readFileSync(join(here, "tier-d7.json"), "utf8")).tier;
  const base = { holdout: true, status: "frozen", role: "secondary", frozen_at: "2026-01-01T00:00:00Z", reserves: { repos: [] }, max: 15, pool: 200 };
  const sets = {
    "eval/holdout-s7.json": { ...base, set_id: "t-s7", repos: [{ name: "x", url: "https://github.com/example/x", sha: "1".repeat(40) }], tier: d7 },
    "eval/holdout-other.json": { ...base, set_id: "t-other", repos: [{ name: "y", url: "https://github.com/example/y", sha: "2".repeat(40) }], tier: { ...d7, default: { ...d7.default, min_members: 16 } } },
    "eval/holdout-s5.json": { ...base, set_id: "t-s5", repos: [{ name: "v", url: "https://github.com/example/v", sha: "5".repeat(40) }], tier: d5 },
    "eval/holdout-p7.json": { ...base, role: "primary", set_id: "t-p7", repos: [{ name: "z", url: "https://github.com/example/z", sha: "3".repeat(40) }], tier: d7 },
    "eval/holdout-p5.json": { ...base, role: "primary", set_id: "t-p5", repos: [{ name: "w", url: "https://github.com/example/w", sha: "4".repeat(40) }], tier: d5 },
  };
  for (const [p, m] of Object.entries(sets)) writeFileSync(join(h, p), JSON.stringify(m, null, 2) + "\n");
  const registry = { scheme: CORE_SCHEME, manifests: Object.fromEntries(Object.entries(sets).map(([p, m]) => [p, coreSha(m)])) };
  writeFileSync(join(h, "eval", "study", "holdout-manifests.json"), JSON.stringify(registry, null, 2) + "\n");
  g("init", "-q");
  g("add", ".");
  g("commit", "-qm", "harness");
  const run = (manifest, runDir, ...extra) =>
    spawnSync(process.execPath, [join(h, "eval", "study", "prepare.mjs"), "--manifest", join(h, manifest), "--run", runDir.startsWith("/") ? runDir : join(h, runDir), "--cache", join(tmp, `cache-${name}`), "--drift-src", h, ...extra], { encoding: "utf8" });
  return { h, g, run };
};

test("prepare.mjs refuses a held-out manifest whose tier is not D7's (primary: D7, secondary: D7a)", async () => {
  const { h, run } = await harness("harness-tier");
  writeFileSync(join(h, "stop"), "untracked: stops a run that passes every check before the build\n");
  for (const [manifest, runDir] of [["eval/holdout-s7.json", "eval/study/runs/a"], ["eval/holdout-p7.json", "eval/study/runs/c"]]) {
    const ok = run(manifest, runDir);
    assert.notEqual(ok.status, 0);
    assert.match(ok.stderr, /held-out run .*: commit everything first/, `${manifest}: ${ok.stderr}`);
  }
  const other = run("eval/holdout-other.json", "eval/study/runs/b");
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /held-out run .*: its tier is not eval\/study\/tier-d7\.json's tier \(decision D7a\)/, other.stderr);
  // A secondary set still on D5's tier (before D7a) is refused too.
  const s5 = run("eval/holdout-s5.json", "eval/study/runs/e");
  assert.notEqual(s5.status, 0);
  assert.match(s5.stderr, /held-out run .*: its tier is not eval\/study\/tier-d7\.json's tier \(decision D7a\)/, s5.stderr);
  const p5 = run("eval/holdout-p5.json", "eval/study/runs/d");
  assert.notEqual(p5.status, 0);
  assert.match(p5.stderr, /held-out run .*: its tier is not eval\/study\/tier-d7\.json's tier \(decision D7\)/, p5.stderr);
  assert.ok(!existsSync(join(tmp, "cache-harness-tier", "repos")), "nothing was cloned");
});

test("prepare.mjs confines a held-out run to eval/study/runs/<name>", async () => {
  const { run } = await harness("harness-rundir");
  for (const dir of [join(tmp, "outside-run"), "eval/study/runs/a/b", "eval/study", "eval/study/runs"]) {
    const r = run("eval/holdout-s7.json", dir);
    assert.notEqual(r.status, 0, dir);
    assert.match(r.stderr, /--run must be eval\/study\/runs\/<name> inside --drift-src/, `${dir}: ${r.stderr}`);
  }
});

test("prepare.mjs commits a start record before a held-out census; the product commit skips run-record commits", async () => {
  const { h, g, run } = await harness("harness-start");
  const F = g("rev-parse", "HEAD");
  // The preflight (--only none) runs no census and needs no start record: it reaches the build of F.
  const pre = run("eval/holdout-s7.json", "eval/study/runs/r", "--only", "none");
  assert.match(pre.stderr, new RegExp(`building drift ${F.slice(0, 12)}`), pre.stderr);
  assert.ok(!existsSync(join(h, "eval", "study", "runs", "r", "start.json")));
  // A census: the first invocation writes the start record and stops.
  const first = run("eval/holdout-s7.json", "eval/study/runs/r");
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /wrote the start record eval\/study\/runs\/r\/start\.json\. Commit it/, first.stderr);
  const start = JSON.parse(readFileSync(join(h, "eval", "study", "runs", "r", "start.json"), "utf8"));
  assert.deepEqual({ ...start, started_at: null }, { held_out: true, status: "started", manifest: "eval/holdout-s7.json", set_id: "t-s7", core_sha256: start.core_sha256, product_commit: F, started_at: null });
  // Uncommitted, it still stops.
  assert.match(run("eval/holdout-s7.json", "eval/study/runs/r").stderr, /start\.json exists but is not committed/);
  // Committed, the run passes and builds F, not the start-record commit.
  g("add", "eval/study/runs/r/start.json");
  g("commit", "-qm", "held-out run start");
  assert.notEqual(g("rev-parse", "HEAD"), F);
  const second = run("eval/holdout-s7.json", "eval/study/runs/r");
  assert.match(second.stderr, new RegExp(`building drift ${F.slice(0, 12)}`), second.stderr);
});

test("prepare.mjs restricts held-out run names to [A-Za-z0-9._-]+", async () => {
  const { run } = await harness("harness-names");
  for (const name of ["ü", 'a"b', "a b"]) {
    const r = run("eval/holdout-s7.json", `eval/study/runs/${name}`);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /the run name .* may use only A-Z, a-z, 0-9, "\.", "_" and "-"/, `${name}: ${r.stderr}`);
  }
});

test("prepare.mjs refuses a committed start record that is null", async () => {
  const { h, g, run } = await harness("harness-null-start");
  mkdirSync(join(h, "eval", "study", "runs", "r"), { recursive: true });
  writeFileSync(join(h, "eval", "study", "runs", "r", "start.json"), "null\n");
  g("add", ".");
  g("commit", "-qm", "null start record");
  const r = run("eval/holdout-s7.json", "eval/study/runs/r");
  assert.notEqual(r.status, 0);
  // Refused before any census: the history check reports it (prepare.mjs's own object check backs it up).
  assert.match(r.stderr, /eval\/study\/runs\/r\/start\.json: a start record that is not an object|start\.json at HEAD is not a start record \(an object\)/, r.stderr);
  assert.doesNotMatch(r.stderr, /TypeError/);
});

test("prepare.mjs: moving product code into runs/ is not a runs-only commit (no rename detection)", async () => {
  const { h, g, run } = await harness("harness-rename");
  mkdirSync(join(h, "src"), { recursive: true });
  writeFileSync(join(h, "src", "a.rs"), "pub fn a() -> u32 { 1 }\n".repeat(20));
  g("add", ".");
  g("commit", "-qm", "product code");
  g("mv", "src/a.rs", "eval/study/runs/z-a.rs");
  g("commit", "-qm", "move product code into runs/");
  const head = g("rev-parse", "HEAD");
  const pre = run("eval/holdout-s7.json", "eval/study/runs/r", "--only", "none");
  assert.match(pre.stderr, new RegExp(`building drift ${head.slice(0, 12)}`), pre.stderr);
});

test("prepare.mjs --python-proposals: the Python opt-in view in both census runs and in init, recorded in run.json; refused for a held-out run", () => {
  const [, , pyC] = repos;
  const m = join(tmp, "dev-py-optin.json");
  writeFileSync(m, JSON.stringify({ tier, max: 15, pool: 200, repos: [pyC] }));
  const env = { ...process.env, FAKE_PY_OPTIN: "1" };
  const prep = (runDir, ...extra) => spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift", drift, "--manifest", m, "--run", runDir, "--cache", join(tmp, "cache-py-optin"), "--strict-tier", ...extra], { encoding: "utf8", env });
  // without the opt-in: the product's default, no Python proposal
  const off = prep(join(tmp, "run-py-off"));
  assert.equal(off.status, 0, off.stderr);
  const offRun = JSON.parse(readFileSync(join(tmp, "run-py-off", "run.json"), "utf8"));
  assert.equal(offRun.params.python_proposals, false);
  assert.equal(offRun.repos[0].proposals, 0);
  // with it: the census proposals, the pool and the conventions.yaml rules (the init opt-in) are all there
  const on = prep(join(tmp, "run-py-on"), "--python-proposals");
  assert.equal(on.status, 0, on.stderr);
  const run = JSON.parse(readFileSync(join(tmp, "run-py-on", "run.json"), "utf8"));
  assert.equal(run.params.python_proposals, true);
  assert.deepEqual([run.repos[0].status, run.repos[0].proposals, run.repos[0].pool], ["ok", PROPOSALS["py-c"].length, PROPOSALS["py-c"].length]);
  const q = JSON.parse(readFileSync(join(tmp, "run-py-on", "queue.json"), "utf8")).items;
  assert.ok(q.length && q.every((it) => it.rule_kind), "every opted-in proposal has its conventions.yaml rule (init was opted in too)");
  assert.doesNotMatch(on.stderr, /in census but not in conventions\.yaml/);
  // the study tooling commit the run was prepared with
  assert.match(run.harness.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof run.harness.eval_dirty, "boolean");
  // the checkout is left clean: the opt-in config went with .drift/
  assert.ok(!existsSync(join(run.repos[0].checkout, ".drift")), "no .drift/ left in the checkout");
  // a held-out run never takes it (its parameters come from the frozen manifest)
  const held = join(tmp, "holdout-py-optin.json");
  writeFileSync(held, JSON.stringify({ holdout: true, tier, max: 15, pool: 200, repos: [pyC] }));
  const r = spawnSync(process.execPath, [join(here, "prepare.mjs"), "--drift-src", join(here, "..", ".."), "--manifest", held, "--run", join(tmp, "run-py-held"), "--python-proposals"], { encoding: "utf8", env });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /held-out run .*--python-proposals is not allowed/);
});

test("techcheck.mjs: clone, scan, >= 200 parseable files; failures get the next reserve, in order", () => {
  const [tsA, tsB, pyC] = repos;
  const m = join(tmp, "techcheck-manifest.json");
  writeFileSync(m, JSON.stringify({ repos: [tsA, tsB], reserves: { repos: [pyC, { name: "gone", url: join(tmp, "no-such-repo"), sha: "0".repeat(40) }] }, replaced: [] }));
  const r = spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", join(tmp, "tc-cache"), "--json", join(tmp, "tc.json")], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(readFileSync(join(tmp, "tc.json"), "utf8"));
  assert.deepEqual(out.results.map((x) => [x.name, x.clone, x.scan, x.parseable, x.pass]), [["ts-a", true, true, 250, true], ["ts-b", true, true, 150, false]]);
  assert.deepEqual(out.reserves.map((x) => [x.name, x.parseable, x.pass]), [["py-c", 210, true]]);
  assert.deepEqual(out.replaced.map((e) => [e.repo, e.reserve]), [["ts-b", "py-c"]]);
  assert.match(out.replaced[0].reason, /fewer than 200 parseable files \(150\)/);
  // a reserve that fails is itself replaced by the next reserve (swaps chain); a failed clone fails the check
  writeFileSync(m, JSON.stringify({ repos: [tsA, tsB], reserves: { repos: [{ name: "gone", url: join(tmp, "no-such-repo"), sha: "0".repeat(40) }, pyC] }, replaced: [] }));
  spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", join(tmp, "tc-cache"), "--reserves", "2", "--json", join(tmp, "tc.json")], { encoding: "utf8" });
  const chain = JSON.parse(readFileSync(join(tmp, "tc.json"), "utf8"));
  assert.match(chain.reserves[0].reason, /clone failed/);
  assert.deepEqual(chain.replaced.map((e) => [e.repo, e.reserve]), [["ts-b", "gone"], ["gone", "py-c"]]);
  assert.equal(chain.replaced[1].reason, "technical check: clone failed (git fetch of the pinned sha)");
  // reasons are committed in `replaced`: no local path in them
  const committed = [out, chain].flatMap((x) => [...x.replaced, ...[...x.results, ...x.reserves].map((y) => y.reason)]);
  assert.ok(!JSON.stringify(committed).includes(tmp), `no local path in a reason: ${JSON.stringify(committed)}`);
});

test("techcheck.mjs: a stray file in a checkout is an environment error: exit 3, no swap entry", () => {
  const [tsA, tsB, pyC] = repos;
  const m = join(tmp, "techcheck-env.json");
  writeFileSync(m, JSON.stringify({ repos: [tsA, tsB], reserves: { repos: [pyC] }, replaced: [] }));
  const cacheDir = join(tmp, "tc-env-cache");
  const run = () => spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", cacheDir, "--json", join(tmp, "tc-env.json")], { encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 1, first.stderr); // ts-b: fewer than 200 parseable files, a rule-1 failure
  writeFileSync(join(cacheDir, "repos", "ts-a", "stray.txt"), "left behind\n");
  const r = run();
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /ENVIRONMENT ERROR, not a rule-1 failure: ts-a: <cache>\/repos\/ts-a is at the pinned sha but has modified, untracked or ignored files .*stray\.txt.*Fix: delete it/);
  assert.doesNotMatch(r.stdout, /Append to|"replaced"|"reserve"/);
  const out = JSON.parse(readFileSync(join(tmp, "tc-env.json"), "utf8"));
  assert.deepEqual([out.env_error.repo, out.replaced], ["ts-a", []]);
  assert.ok(!out.env_error.message.includes(cacheDir), "no local path in the recorded message");
});

test("techcheck.mjs --prune: each checkout is deleted once checked; the verdicts and swaps are unchanged", () => {
  const [tsA, tsB, pyC] = repos;
  const m = join(tmp, "techcheck-prune.json");
  writeFileSync(m, JSON.stringify({ repos: [tsA, tsB], reserves: { repos: [pyC] }, replaced: [] }));
  const cacheDir = join(tmp, "tc-prune-cache");
  const r = spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", cacheDir, "--prune", "--min-free-gb", "0", "--json", join(tmp, "tc-prune.json")], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(readFileSync(join(tmp, "tc-prune.json"), "utf8"));
  assert.deepEqual(out.results.map((x) => [x.name, x.parseable, x.pass]), [["ts-a", 250, true], ["ts-b", 150, false]]);
  assert.deepEqual(out.reserves.map((x) => [x.name, x.pass]), [["py-c", true]]);
  assert.deepEqual(out.replaced.map((e) => [e.repo, e.reserve]), [["ts-b", "py-c"]]);
  assert.equal(out.pruned, true);
  assert.deepEqual(readdirSync(join(cacheDir, "repos")), [], "no checkout is left");
});

test("techcheck.mjs --prune refuses a name that is not a plain directory name: exit 3, nothing fetched or deleted", () => {
  const [tsA] = repos;
  const m = join(tmp, "techcheck-prune-name.json");
  writeFileSync(m, JSON.stringify({ repos: [{ ...tsA, name: "../keep" }], reserves: { repos: [] }, replaced: [] }));
  const cacheDir = join(tmp, "tc-prune-name-cache");
  mkdirSync(join(cacheDir, "keep"), { recursive: true });
  writeFileSync(join(cacheDir, "keep", "sentinel.txt"), "kept\n");
  const r = spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", cacheDir, "--prune", "--json", join(tmp, "tc-prune-name.json")], { encoding: "utf8" });
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /ENVIRONMENT ERROR, not a rule-1 failure: \.\.\/keep: --prune deletes <cache>\/repos\/<name> for a plain name only/);
  assert.doesNotMatch(r.stdout, /Append to/);
  assert.ok(existsSync(join(cacheDir, "keep", "sentinel.txt")), "nothing outside <cache>/repos is deleted");
  assert.ok(!existsSync(join(cacheDir, "keep", ".git")), "nothing is fetched");
});

test("techcheck.mjs --min-free-gb: too little free disk is an environment error before any fetch, never a rule-1 swap", () => {
  const [tsA, tsB, pyC] = repos;
  const m = join(tmp, "techcheck-disk.json");
  writeFileSync(m, JSON.stringify({ repos: [tsA, tsB], reserves: { repos: [pyC] }, replaced: [] }));
  const cacheDir = join(tmp, "tc-disk-cache");
  const r = spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", cacheDir, "--min-free-gb", "1000000000", "--json", join(tmp, "tc-disk.json")], { encoding: "utf8" });
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /ENVIRONMENT ERROR, not a rule-1 failure: ts-a: [\d.]+ GB free on the cache's filesystem, under --min-free-gb 1000000000/);
  assert.doesNotMatch(r.stdout, /Append to|"replaced"|"reserve"/);
  assert.deepEqual(JSON.parse(readFileSync(join(tmp, "tc-disk.json"), "utf8")).replaced, []);
  assert.ok(!existsSync(join(cacheDir, "repos", "ts-a")), "nothing is fetched");
  const bad = spawnSync(process.execPath, [join(here, "techcheck.mjs"), "--manifest", m, "--drift", drift, "--cache", cacheDir, "--min-free-gb", "lots"], { encoding: "utf8" });
  assert.equal(bad.status, 2, bad.stderr);
});

test("the committed dry-run manifest lists dev repos only, under the primary sets' tier", () => {
  const read = (f) => JSON.parse(readFileSync(join(here, f), "utf8"));
  const m = read("dry-run-dev.json");
  const dev = [...read("../repos.json").repos, ...read("../repos-py.json").repos];
  for (const r of m.repos) assert.ok(dev.some((d) => d.url === r.url && d.sha === r.sha && d.name === r.name), `${r.name} is not a dev repo at its dev sha`);
  const primary = read("../holdout-primary.json");
  assert.deepEqual([m.tier, m.max, m.pool], [primary.tier, primary.max, primary.pool]);
  const langs = new Set(m.repos.map((r) => r.language));
  assert.ok(langs.has("Python") && m.repos.length >= 3, "two languages, so the per-language tables have two rows");
});

test("dry-run.mjs refuses a held-out run", () => {
  const dir = join(tmp, "held");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ manifest: { holdout: true, role: "primary" }, repos: [], params: {} }));
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ items: [] }));
  const r = spawnSync(process.execPath, [join(here, "dry-run.mjs"), "fill", "--run", dir, "--stage", "label"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /HELD-OUT run: synthetic labels are for dev dry runs only/);
});

test("prompt.mjs --rubric: v2 on request, one rubric per run, collect checks the records' rubric", () => {
  const RUN2 = join(tmp, "run-v2");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", RUN2, "--cache", join(tmp, "cache"));
  node("prompt.mjs", "label", "--run", RUN2, "--labeller", "A", "--rubric", "v2");
  const idx = JSON.parse(readFileSync(join(RUN2, "prompts", "index.json"), "utf8"));
  assert.deepEqual([...new Set(idx.map((e) => e.rubric))], ["v2"]);
  assert.match(readFileSync(idx[0].prompt, "utf8"), /Labelling rubric v2/);
  assert.doesNotMatch(readFileSync(idx[0].prompt, "utf8"), /R1\. Outliers/);
  // without --rubric, the run keeps the rubric it already uses
  node("prompt.mjs", "label", "--run", RUN2, "--labeller", "A", "--repo", "ts-a", "--force");
  assert.equal(JSON.parse(readFileSync(join(RUN2, "prompts", "index.json"), "utf8")).find((e) => e.repo === "ts-a").rubric, "v2");
  // another rubric in the same run is refused
  const r = spawnSync(process.execPath, [join(here, "prompt.mjs"), "label", "--run", RUN2, "--labeller", "B", "--rubric", "v3"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /use rubric v2; one run uses one rubric \(decision D6\)/);
  const bad = spawnSync(process.execPath, [join(here, "prompt.mjs"), "label", "--run", RUN2, "--labeller", "A", "--rubric", "v9"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  // a record that names another rubric than its prompt is INVALID; the synthetic v2 records are collected
  node("dry-run.mjs", "fill", "--run", RUN2, "--stage", "label");
  const entry = JSON.parse(readFileSync(join(RUN2, "prompts", "index.json"), "utf8")).find((e) => e.repo === "ts-b");
  const recs = readFileSync(entry.output, "utf8").trim().split("\n").map(JSON.parse);
  writeFileSync(entry.output, recs.map((x) => JSON.stringify({ ...x, rubric: "v3" })).join("\n") + "\n");
  const c = spawnSync(process.execPath, [join(here, "collect.mjs"), "--run", RUN2, "--stage", "label"], { encoding: "utf8" });
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /label A ts-b: INVALID\n {2}.*rubric is "v3", but the prompt was rendered with rubric v2/);
  assert.match(c.stdout, /label A ts-a: ok/);
});

test("F1/F4 (PLAN-R14 WS-F): a new dev run defaults to v4: cards without evidence numbers, the repo masked, --model required, and A, B and C on three models", () => {
  const RUN4 = join(tmp, "run-v4");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", RUN4, "--cache", join(tmp, "cache"));
  assert.deepEqual(JSON.parse(readFileSync(join(RUN4, "run.json"), "utf8")).params.decisions, ["F3"]);
  const noModel = spawnSync(process.execPath, [join(here, "prompt.mjs"), "label", "--run", RUN4, "--labeller", "A"], { encoding: "utf8" });
  assert.equal(noModel.status, 2);
  assert.match(noModel.stderr, /--model ID is required under rubric v4/);
  node("prompt.mjs", "label", "--run", RUN4, "--labeller", "A", "--model", "model-a");
  const idx = JSON.parse(readFileSync(join(RUN4, "prompts", "index.json"), "utf8"));
  assert.deepEqual([...new Set(idx.map((e) => e.rubric))], ["v4"]);
  assert.deepEqual([...new Set(idx.map((e) => e.model))], ["model-a"]);
  for (const e of idx) {
    const text = readFileSync(e.prompt, "utf8");
    assert.match(text, /Labelling rubric v4/);
    assert.doesNotMatch(text, /^\s*evidence:|lower bound|lift \d/m);
    assert.ok(!text.includes(`**${e.repo}**`) && text.includes(e.repo_key), "the repo name is masked in the prompt's frame");
    assert.ok(text.includes(e.masked_dir));
  }
  // B on A's model is refused; a third model for C is required
  node("dry-run.mjs", "fill", "--run", RUN4, "--stage", "label");
  node("collect.mjs", "--run", RUN4, "--stage", "label");
  const same = spawnSync(process.execPath, [join(here, "prompt.mjs"), "label", "--run", RUN4, "--labeller", "B", "--model", "model-a"], { encoding: "utf8" });
  assert.equal(same.status, 2);
  assert.match(same.stderr, /labeller A of this run already runs on it; A, B and C run on three different models/);
  node("prompt.mjs", "label", "--run", RUN4, "--labeller", "B", "--model", "model-b");
  const recs = readFileSync(join(RUN4, "labels", "A", "ts-a.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(recs.every((r) => r.model === "model-a"), "collect.mjs stamps the model");
});

test("one rubric TEXT per run: an edited rubric is refused, collect flags another text, metrics reports mixed", () => {
  // The reviewer's scenario: RUBRIC-v3.md edited between labeller A's prompts and B's. Run on a copy of the scripts,
  // so the committed rubric is never touched.
  const S = join(tmp, "study-copy");
  mkdirSync(S, { recursive: true });
  for (const f of readdirSync(here)) if (/\.(mjs|md)$/.test(f) && !f.endsWith(".test.mjs")) copyFileSync(join(here, f), join(S, f));
  const run = (script, ...a) => spawnSync(process.execPath, [join(S, script), ...a], { encoding: "utf8" });
  const ok = (script, ...a) => {
    const r = run(script, ...a);
    assert.equal(r.status, 0, `${script} ${a.join(" ")}\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const R = join(tmp, "run-rubric-edit");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", R, "--cache", join(tmp, "cache"));
  ok("prompt.mjs", "label", "--run", R, "--labeller", "A", "--rubric", "v3");
  ok("dry-run.mjs", "fill", "--run", R, "--stage", "label");
  ok("collect.mjs", "--run", R, "--stage", "label");
  const rubricPath = join(S, "RUBRIC-v3.md");
  const original = readFileSync(rubricPath, "utf8");
  assert.ok(original.includes("**more than half** of the counted outliers"));
  writeFileSync(rubricPath, original.replace("**more than half** of the counted outliers", "**at least a third** of the counted outliers"));
  const refused = run("prompt.mjs", "label", "--run", R, "--labeller", "B", "--rubric", "v3");
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /RUBRIC-v3\.md has changed since this run's earlier prompts were rendered .* start a new run directory/);
  assert.ok(!JSON.parse(readFileSync(join(R, "prompts", "index.json"), "utf8")).some((e) => e.labeller === "B"), "no B prompt was rendered");
  // a B prompt rendered with another text anyway (say, by an older prompt.mjs): collect rejects its records
  writeFileSync(rubricPath, original);
  ok("prompt.mjs", "label", "--run", R, "--labeller", "B", "--rubric", "v3", "--repo", "ts-a");
  const idxPath = join(R, "prompts", "index.json");
  const idx = JSON.parse(readFileSync(idxPath, "utf8"));
  idx.find((e) => e.labeller === "B").rubric_sha256 = "f".repeat(64);
  writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n");
  ok("dry-run.mjs", "fill", "--run", R, "--stage", "label");
  const c = run("collect.mjs", "--run", R, "--stage", "label");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /label B ts-a: INVALID\n {2}the prompt was rendered with rubric text ffffffffffff, the run's is [0-9a-f]{12}: two rubric texts in one run/);
  // metrics never reports a bare version over two texts
  const mj = join(R, "metrics-mixed.json");
  ok("metrics.mjs", "--run", R, "--labels", join(R, "labels", "A"), "--allow-incomplete", "B's output is INVALID (rubric text)", "--json", mj);
  const m = JSON.parse(readFileSync(mj, "utf8"));
  assert.equal(m.rubric, "mixed");
  assert.equal(m.rubric_sha256, null);
  assert.deepEqual([...m.rubric_sha256s].sort(), [APPROVED_RUBRIC.sha256, "f".repeat(64)].sort());
});

test("a held-out run refuses a rubric text other than the one approved with D6", () => {
  const S = join(tmp, "study-copy-heldout");
  mkdirSync(S, { recursive: true });
  for (const f of readdirSync(here)) if (/\.(mjs|md)$/.test(f) && !f.endsWith(".test.mjs")) copyFileSync(join(here, f), join(S, f));
  writeFileSync(join(S, "RUBRIC-v3.md"), readFileSync(join(S, "RUBRIC-v3.md"), "utf8").replace("**more than half**", "**at least a third**"));
  const R = join(tmp, "run-heldout-rubric");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", R, "--cache", join(tmp, "cache"));
  const runJson = JSON.parse(readFileSync(join(R, "run.json"), "utf8"));
  writeFileSync(join(R, "run.json"), JSON.stringify({ ...runJson, manifest: { ...runJson.manifest, holdout: true, role: "primary" } }));
  const r = spawnSync(process.execPath, [join(S, "prompt.mjs"), "label", "--run", R, "--labeller", "A", "--rubric", "v3"], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /held-out run: the rubric text .* is not the one approved with decision D6 .* needs a new recorded decision/);
});

test("the rubric text survives a cleared index: records carry it; prompt, collect, agree, adjudicate and metrics refuse or report mixed", () => {
  // The re-review's scenario: A collected under the approved text, RUBRIC-v3.md edited, prompts/index.json cleared.
  const S = join(tmp, "study-copy-cleared");
  mkdirSync(S, { recursive: true });
  for (const f of readdirSync(here)) if (/\.(mjs|md)$/.test(f) && !f.endsWith(".test.mjs")) copyFileSync(join(here, f), join(S, f));
  const run = (script, ...a) => spawnSync(process.execPath, [join(S, script), ...a], { encoding: "utf8" });
  const ok = (script, ...a) => {
    const r = run(script, ...a);
    assert.equal(r.status, 0, `${script} ${a.join(" ")}\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const R = join(tmp, "run-cleared-index");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", R, "--cache", join(tmp, "cache"));
  ok("prompt.mjs", "label", "--run", R, "--labeller", "A", "--rubric", "v3");
  ok("dry-run.mjs", "fill", "--run", R, "--stage", "label");
  ok("collect.mjs", "--run", R, "--stage", "label");
  const aRecs = readFileSync(join(R, "labels", "A", "ts-a.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(aRecs.every((r) => r.rubric_sha256 === APPROVED_RUBRIC.sha256), "collect.mjs stamps the prompt's rubric text on every record");
  const rubricPath = join(S, "RUBRIC-v3.md");
  const original = readFileSync(rubricPath, "utf8");
  writeFileSync(rubricPath, original.replace("**more than half** of the counted outliers", "**at least a third** of the counted outliers"));
  const idxPath = join(R, "prompts", "index.json");
  const idx = readFileSync(idxPath, "utf8");
  // (a) the index cleared outright, (b) the hash key deleted from A's entries
  for (const cleared of ["[]\n", JSON.stringify(JSON.parse(idx).map(({ rubric_sha256, ...e }) => e), null, 2) + "\n"]) {
    writeFileSync(idxPath, cleared);
    const r = run("prompt.mjs", "label", "--run", R, "--labeller", "B", "--rubric", "v3");
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /RUBRIC-v3\.md has changed since this run's earlier prompts were rendered .*79316bdc08a6.* start a new run directory/);
  }
  writeFileSync(idxPath, idx);
  writeFileSync(rubricPath, original);
  // B's labels under another text (written by hand, as an older harness could have): every reader notices
  mkdirSync(join(R, "labels", "B"), { recursive: true });
  for (const f of readdirSync(join(R, "labels", "A"))) {
    const recs = readFileSync(join(R, "labels", "A", f), "utf8").trim().split("\n").map(JSON.parse);
    writeFileSync(join(R, "labels", "B", f), recs.map((x) => JSON.stringify({ ...x, labeller: "B", rubric_sha256: "e".repeat(64) })).join("\n") + "\n");
  }
  const ag = run("agree.mjs", "--run", R);
  assert.equal(ag.status, 2, ag.stdout);
  assert.match(ag.stderr, /the two label sets name 2 rubric texts .* agreement is computed within one rubric text/);
  const mixed = ok("agree.mjs", "--run", R, "--allow-mixed-rubric");
  assert.match(mixed.stdout, /Rubric texts: \*\*mixed\*\*/);
  const adj = run("adjudicate.mjs", "--run", R);
  assert.equal(adj.status, 2, adj.stdout + adj.stderr);
  assert.match(adj.stderr, /labels A and B name 2 rubric texts/);
  const mj = join(R, "metrics-b.json");
  ok("metrics.mjs", "--run", R, "--labels", join(R, "labels", "B"), "--json", mj);
  const m = JSON.parse(readFileSync(mj, "utf8"));
  assert.equal(m.rubric, "mixed");
  assert.deepEqual([...m.rubric_sha256s].sort(), [APPROVED_RUBRIC.sha256, "e".repeat(64)].sort());
  // a further prompt in this run is refused too: its records name two texts
  const again = run("prompt.mjs", "label", "--run", R, "--labeller", "A", "--rubric", "v3", "--repo", "ts-a", "--force");
  assert.equal(again.status, 2, again.stdout + again.stderr);
});

test("rubricText refuses a rubric without its '## The setting' heading", () => {
  const S = join(tmp, "study-copy-heading");
  mkdirSync(S, { recursive: true });
  for (const f of readdirSync(here)) if (/\.(mjs|md)$/.test(f) && !f.endsWith(".test.mjs")) copyFileSync(join(here, f), join(S, f));
  writeFileSync(join(S, "RUBRIC-v3.md"), readFileSync(join(S, "RUBRIC-v3.md"), "utf8").replace("## The setting\n", "## Setting\n"));
  const R = join(tmp, "run-heading");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", R, "--cache", join(tmp, "cache"));
  const r = spawnSync(process.execPath, [join(S, "prompt.mjs"), "label", "--run", R, "--labeller", "A", "--rubric", "v3"], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /RUBRIC-v3\.md: no "## The setting" heading/);
});

test("JSON and YAML parse errors carry no part of the text", async () => {
  const { parseJson, parseYaml, readJsonl } = await import("./lib.mjs");
  const secret = "secret-heldout-name-9f3a";
  const f = join(tmp, "bad-manifest.json");
  writeFileSync(f, `{\n  "exposed": [{ "name": '${secret}', "sha": 4f2e9a01 }]\n}\n`);
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { readJson } from ${JSON.stringify(join(here, "lib.mjs"))}; readJson(${JSON.stringify(f)});`], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /bad-manifest\.json: invalid JSON/);
  assert.ok(!/secret-heldout|4f2e9a01|exposed/.test(r.stdout + r.stderr), "no fragment of the text");
  assert.throws(() => parseJson(`{"name": ${secret}}`, "x"), (e) => !e.message.includes(secret) && /x: invalid JSON/.test(e.message));
  assert.throws(() => parseYaml(`conventions:\n- id: ${secret}\n  bad line ${secret}\n`), (e) => !e.message.includes(secret));
  assert.throws(() => parseYaml(`a: "${secret}\\q"\n`), (e) => !e.message.includes(secret));
  const jl = join(tmp, "bad.jsonl");
  writeFileSync(jl, `{"uid": '${secret}'}\n`);
  const msgs = [];
  readJsonl(jl, { onError: (m) => msgs.push(m) });
  assert.equal(msgs.length, 1);
  assert.ok(!msgs[0].includes(secret), msgs[0].replace(secret, "<secret>"));
});

const nodeRun = (script, ...a) => spawnSync(process.execPath, [join(here, script), ...a], { encoding: "utf8" });
// A prepared run with A and B labels collected (synthetic), ready for agreement and adjudication.
function labelledRun(name) {
  const dir = join(tmp, name);
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"), "--strict-tier");
  for (const L of ["A", "B"]) {
    node("prompt.mjs", "label", "--run", dir, "--labeller", L, "--rubric", "v3");
    node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
    node("collect.mjs", "--run", dir, "--stage", "label");
  }
  return dir;
}

test("agreement comes before adjudication: adjudicate.mjs needs agree.mjs's record of the same labels; agree.mjs refuses after the queue", () => {
  const dir = labelledRun("run-order");
  let r = nodeRun("adjudicate.mjs", "--run", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no agreement at .*agreement\.json: run agree\.mjs/);
  // agree.mjs --run writes <run>/agreement.json by default, with the sha256 of each label set
  const md = node("agree.mjs", "--run", dir);
  assert.doesNotMatch(md, /Recomputed after adjudication/);
  const ag = JSON.parse(readFileSync(join(dir, "agreement.json"), "utf8"));
  assert.match(ag.labels_sha256.A, /^[0-9a-f]{64}$/);
  assert.notEqual(ag.labels_sha256.A, ag.labels_sha256.B);
  // an agreement of other labels is refused
  writeFileSync(join(dir, "agreement.json"), JSON.stringify({ ...ag, labels_sha256: { ...ag.labels_sha256, B: "0".repeat(64) } }));
  r = nodeRun("adjudicate.mjs", "--run", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not the agreement of these A and B labels/);
  writeFileSync(join(dir, "agreement.json"), JSON.stringify(ag));
  node("adjudicate.mjs", "--run", dir);
  const queue = JSON.parse(readFileSync(join(dir, "adjudication", "queue.json"), "utf8"));
  assert.deepEqual(queue.labels_sha256, ag.labels_sha256, "agree.mjs and adjudicate.mjs hash the label sets the same way");
  // once the queue exists, agreement is not recomputed, unless asked to, from unchanged labels, and marked
  r = nodeRun("agree.mjs", "--run", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /agreement is computed before adjudication and never recomputed after it/);
  const again = node("agree.mjs", "--run", dir, "--after-adjudication", "--json", join(dir, "agreement-after.json"));
  assert.match(again, /\*\*Recomputed after adjudication\*\*/);
  const after2 = JSON.parse(readFileSync(join(dir, "agreement-after.json"), "utf8"));
  assert.equal(after2.after_adjudication, true);
  assert.deepEqual([after2.exact, after2.kappa, after2.disagreements], [ag.exact, ag.kappa, ag.disagreements]);
  writeFileSync(join(dir, "adjudication", "queue.json"), JSON.stringify({ ...queue, labels_sha256: { A: "0".repeat(64), B: queue.labels_sha256.B } }));
  r = nodeRun("agree.mjs", "--run", dir, "--after-adjudication");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /labels A\/B changed since the adjudication queue was written/);
  // never on a held-out run
  const runJson = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  writeFileSync(join(dir, "run.json"), JSON.stringify({ ...runJson, manifest: { ...runJson.manifest, holdout: true } }));
  r = nodeRun("agree.mjs", "--run", dir, "--after-adjudication");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--after-adjudication is refused on a held-out run/);
  writeFileSync(join(dir, "run.json"), JSON.stringify(runJson));
  // --a/--b comparisons of any two label sets are not ordered against a run's adjudication
  node("agree.mjs", "--a", join(dir, "labels", "A"), "--b", join(dir, "labels", "B"));
});

test("stage.mjs: carry (rule 4), relabel sub-run, derived view, then final.jsonl, for any run", () => {
  assert.ok(existsSync(join(RUN, "final.jsonl")), "the first test's run is labelled");
  // the next round: the same repos at the same pins, with some cards changed since RUN was labelled
  const PART = join(tmp, "round-2");
  mkdirSync(join(PART, "proposals"), { recursive: true });
  const run = JSON.parse(readFileSync(join(RUN, "run.json"), "utf8"));
  writeFileSync(join(PART, "run.json"), JSON.stringify({ ...run, run: PART }));
  for (const f of readdirSync(join(RUN, "proposals"))) copyFileSync(join(RUN, "proposals", f), join(PART, "proposals", f));
  const q = JSON.parse(readFileSync(join(RUN, "queue.json"), "utf8"));
  const edit = {
    "ts-a/D-a00001": (b) => b.replace("follow rule D-a00001", "follow the reworded rule D-a00001"), // default tier: summary line only
    "ts-b/D-b00001": (b) => b.replace("bad", "worse"), // default tier: an outlier line changed
    "ts-a/D-a00003": (b) => b.replace("bad", "worse"), // suggestion tier: changed
  };
  const items = q.items.map((p) => (edit[p.uid] ? { ...p, block: edit[p.uid](p.block) } : p));
  writeFileSync(join(PART, "queue.json"), JSON.stringify({ run: PART, items }));
  const checkouts = join(tmp, "cache", "repos");
  const stage = (...a) => nodeRun("stage.mjs", "stage", "--run", PART, "--checkouts", checkouts, "--cache", join(tmp, "stage-cache"), ...a);
  const D7 = join(here, "tier-d7.json");

  // the census tier lines are D7's: a view under another tier is refused unless the mismatch is recorded
  let r = stage("--tier", join(here, "tier-d5.json"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /census tier line differs from the tier applied .* --allow-tier-mismatch/);
  // the lead's list must match
  r = stage("--tier", D7, "--carry-from", RUN, "--relabel", "default", "--expect-relabel", "ts-a/D-a00001");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /differ from --expect-relabel/);

  r = stage("--tier", D7, "--carry-from", RUN, "--relabel", "default", "--carry-summary-only", "default", "--round", "round 2", "--expect-relabel", "ts-b/D-b00001");
  assert.equal(r.status, 0, r.stderr);
  const carried = readFileSync(join(PART, "carried.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const final1 = new Map(readFileSync(join(RUN, "final.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((f) => [f.uid, f]));
  assert.deepEqual(carried.map((f) => f.uid).sort(), q.items.map((p) => p.uid).filter((u) => !edit[u] || u === "ts-a/D-a00001").sort());
  for (const f of carried) {
    assert.equal(f.label, final1.get(f.uid).label);
    assert.equal(f.source, "carried");
    assert.equal(f.carried_source, final1.get(f.uid).source);
    assert.equal(f.round, "round 2");
    assert.equal(f.carried_card, f.uid === "ts-a/D-a00001" ? "summary-only" : "identical");
    assert.ok(!Object.keys(f).some((k) => k.startsWith("_")), "no reader-internal field (_src) is written");
  }
  const st = JSON.parse(readFileSync(join(PART, "stage.json"), "utf8"));
  assert.deepEqual(st.relabel, ["ts-b/D-b00001"]);
  assert.deepEqual(st.unlabelled, ["ts-a/D-a00003"]);
  assert.deepEqual(st.default, { shown: 2, carried: 1, carried_summary_only: 1, to_label: 1, unlabelled: 0 });
  assert.equal(st.carry_summary_only, "default");
  // relabel/: only the uid to label, on the read-only clones, verified at their pins
  const sub = JSON.parse(readFileSync(join(PART, "relabel", "run.json"), "utf8"));
  assert.deepEqual(sub.relabel_of.uids, ["ts-b/D-b00001"]);
  assert.deepEqual(sub.repos.map((x) => [x.name, x.checkout]), [["ts-b", join(checkouts, "ts-b")]]);
  assert.deepEqual(JSON.parse(readFileSync(join(PART, "relabel", "queue.json"), "utf8")).items.map((p) => p.uid), ["ts-b/D-b00001"]);
  // views/d7: every shown proposal under D7, not pre-registered
  const view = JSON.parse(readFileSync(join(PART, "views", "d7", "run.json"), "utf8"));
  assert.equal(view.params.tier_pre_registered, false);
  assert.deepEqual(view.params.tier, JSON.parse(readFileSync(D7, "utf8")).tier);
  assert.equal(JSON.parse(readFileSync(join(PART, "views", "d7", "queue.json"), "utf8")).items.length, q.items.length);

  // label the sub-run like any run, then merge the round
  const X = join(PART, "relabel");
  for (const L of ["A", "B"]) {
    node("prompt.mjs", "label", "--run", X, "--labeller", L, "--rubric", "v3");
    node("dry-run.mjs", "fill", "--run", X, "--stage", "label");
    node("collect.mjs", "--run", X, "--stage", "label");
  }
  node("agree.mjs", "--run", X);
  node("adjudicate.mjs", "--run", X);
  if (JSON.parse(readFileSync(join(X, "adjudication", "queue.json"), "utf8")).cases.length) {
    node("prompt.mjs", "adjudicate", "--run", X);
    node("dry-run.mjs", "fill", "--run", X, "--stage", "adjudicate");
    node("collect.mjs", "--run", X, "--stage", "adjudicate");
  }
  node("adjudicate.mjs", "--run", X, "--merge");
  r = stage("--tier", D7, "--carry-from", RUN);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already has prompts \(labelling has started\): it is never restaged/);
  // stage.mjs final refuses while relabel/ lacks a complete A or B set, unless --allow-incomplete (in stage.json)
  const bFile = join(X, "labels", "B", "ts-b.jsonl");
  const bText = readFileSync(bFile);
  rmSync(bFile);
  r = nodeRun("stage.mjs", "final", "--run", PART);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /stage\.mjs final \(.*relabel\) needs complete A and B label sets; 1 are not:\n {2}B ts-b: 0 of 1 labelled/);
  r = nodeRun("stage.mjs", "final", "--run", PART, "--allow-incomplete", "test: B's file moved away");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(PART, "stage.json"), "utf8")).final_incomplete.gaps, ["B ts-b: 0 of 1 labelled"]);
  writeFileSync(bFile, bText);
  assert.match(node("stage.mjs", "final", "--run", PART), /final labels .*\(agreed|adjudicated/);
  assert.equal(JSON.parse(readFileSync(join(PART, "stage.json"), "utf8")).final_incomplete, undefined, "a complete final drops the record");
  const fin = readFileSync(join(PART, "final.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(fin.map((f) => f.uid).sort(), [...carried.map((f) => f.uid), "ts-b/D-b00001"].sort());
  node("stage.mjs", "batches", "--run", PART);
  assert.equal(JSON.parse(readFileSync(join(PART, "batches.json"), "utf8")).batches.length, 2);
  // the view scores with the round's labels; the unlabelled suggestion-tier card counts as WRONG
  const m = JSON.parse((node("metrics.mjs", "--run", join(PART, "views", "d7"), "--labels", join(PART, "final.jsonl"), "--json", join(PART, "m.json")), readFileSync(join(PART, "m.json"), "utf8")));
  assert.equal(m.tier.pre_registered, false);
  assert.equal(m.overall.unlabelled, 1);
  const ts = m.by_language.find((g) => g.language === "typescript/javascript");
  assert.deepEqual(ts.families.filter((f) => f.default_tier.shown).map((f) => f.family), ["wrapper", "layering"]);
});

test("stage.mjs refuses a held-out run", () => {
  const dir = join(tmp, "stage-heldout");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ run: dir, manifest: { holdout: true, role: "primary" }, params: {}, repos: [] }));
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ items: [] }));
  const r = nodeRun("stage.mjs", "stage", "--run", dir, "--checkouts", tmp, "--cache", tmp);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /HELD-OUT run: every shown proposal is labelled fresh/);
});

test("stage.mjs --candidate-json: a guard condition reads the product's word, and the product and the study must agree (D8 candidate)", () => {
  const PART = join(tmp, "d8-candidate");
  const repo = join(tmp, "d8-checkouts", "py-a");
  mkdirSync(repo, { recursive: true });
  const git = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(repo, "app.py"), "x = 1\n");
  git("add", "app.py");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
  const sha = git("rev-parse", "HEAD").stdout.trim();
  mkdirSync(join(PART, "proposals"), { recursive: true });
  const d7 = JSON.parse(readFileSync(join(here, "tier-d7.json"), "utf8")).tier;
  writeFileSync(join(PART, "run.json"), JSON.stringify({ run: PART, manifest: { holdout: false, role: "dev" }, drift: { version: "drift test", commit: "c0ffee", binary_sha256: "0".repeat(64) }, params: { tier: d7 }, repos: [{ name: "py-a", sha, status: "ok" }] }));
  const props = [
    ["D-e00001", { type: "wrapped_by", kind: "call", any_of: ["app/deps.py#get_current_user"] }, "HTTP handlers in app/api/** are wrapped in get_current_user()"],
    ["D-e00002", { type: "wrapped_by", kind: "call", any_of: ["app/db.py#get_db"] }, "HTTP handlers in app/data/** are wrapped in get_db()"],
    ["D-e00003", { type: "avoids", signal: "import:events" }, "modules in app/** do not import from events/**"],
  ];
  const block = (id, summary, i) => ` ${i + 1}. [${id}] ${summary}\n    evidence: 57/60 (lower bound 0.86, lift 3.0)\n    tier:     suggestion (Python conventions advise only; decision D7)\n    example:  app/api/r00.py#route_0\n`;
  writeFileSync(join(PART, "proposals", "py-a.txt"), `3 conventions from 200 units in 9 roles (0 default tier, 3 suggestions)\n\nSuggestions: advice only; blocking one needs \`drift review --block <id> --force\`\n\n${props.map(([id, , s], i) => block(id, s, i)).join("\n")}`);
  writeFileSync(join(PART, "queue.json"), JSON.stringify({ run: PART, items: props.map(([id, rule, summary], i) => ({ uid: `py-a/${id}`, repo: "py-a", id, rank: i + 1, summary, rule, members: 60, example: "app/api/r00.py#route_0", python_members: 60, block: block(id, summary, i) })) }));
  const cand = join(tmp, "d8-census");
  mkdirSync(cand, { recursive: true });
  const census = (rows) => writeFileSync(join(cand, "py-a.json"), JSON.stringify({ commit: "c0ffee", proposals: rows.map(([id, tier, reason, guards]) => ({ id, candidate: { decision: "D8", tier, reason, guards } })) }));
  const D8 = join(here, "tier-d8-candidate.json");
  const stage = (...a) => nodeRun("stage.mjs", "stage", "--run", PART, "--checkouts", join(tmp, "d8-checkouts"), "--cache", join(tmp, "d8-cache"), "--tier", D8, "--relabel", "default", "--allow-tier-mismatch", "census tier lines are D7's; the view is the D8 candidate", ...a);

  let r = stage();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /only the product can tell: pass --candidate-json DIR/);
  census([["D-e00001", "default", null, true]]);
  r = stage("--candidate-json", cand);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lists other proposals than the run's census of py-a/);
  // the product says get_db guards: the study's tier follows that word, so agreement is checked on the guard-free rows
  census([["D-e00001", "default", null, true], ["D-e00002", "suggestion", "not_guard", false], ["D-e00003", "suggestion", "small_role", null]]);
  r = stage("--candidate-json", cand);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /product's candidate tier differs from the tier applied for 1 proposals, e\.g\. py-a\/D-e00003/);
  census([["D-e00001", "default", null, true], ["D-e00002", "suggestion", "not_guard", false], ["D-e00003", "default", null, null]]);
  r = stage("--candidate-json", cand, "--view", "d8");
  assert.equal(r.status, 0, r.stderr);
  const items = JSON.parse(readFileSync(join(PART, "views", "d8", "queue.json"), "utf8")).items;
  assert.deepEqual(items.map((p) => [p.id, p.guards, p.tier]), [["D-e00001", true, "default"], ["D-e00002", false, "suggestion"], ["D-e00003", null, "default"]]);
  const st = JSON.parse(readFileSync(join(PART, "stage.json"), "utf8"));
  assert.deepEqual(st.relabel, ["py-a/D-e00001", "py-a/D-e00003"]);
  assert.deepEqual(st.proposals.map((p) => p.reason), [null, "not_guard", null]);
  assert.equal(st.tier.decision, "D8");
  assert.deepEqual(st.candidate_json.commits, ["c0ffee"]);
  assert.equal(st.census_tier_mismatches.length, 2, JSON.stringify(st.census_tier_mismatches));
  assert.ok(!existsSync(join(PART, "relabel", "prompts")), "staged, not labelled");
  // metrics.mjs reads the view's guards, so its default tier is the product's candidate tier
  writeFileSync(join(PART, "none.jsonl"), "");
  // relabel/ is staged but not labelled: metrics refuses until --allow-incomplete says why, and records it
  const refused = spawnSync(process.execPath, [join(here, "metrics.mjs"), "--run", join(PART, "views", "d8"), "--labels", join(PART, "none.jsonl")], { encoding: "utf8" });
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stderr, /metrics\.mjs needs complete A and B label sets; 2 are not:\n {2}A py-a \(.*relabel\): 0 of 2 labelled/);
  const m = JSON.parse((node("metrics.mjs", "--run", join(PART, "views", "d8"), "--labels", join(PART, "none.jsonl"), "--allow-incomplete", "a tier preview before labelling", "--json", join(PART, "m.json")), readFileSync(join(PART, "m.json"), "utf8")));
  assert.equal(m.default_tier.shown, 2);
  assert.equal(m.incomplete.reason, "a tier preview before labelling");
  assert.equal(m.headline_eligible, false);
});

// ---------- 2026-11-07: neutral working directories, stray outputs, complete label sets ----------
// Lessons of dev-v3-relabel3-2026-11-07: a labeller whose working directory was the orchestrator's worktree wrote a
// stray copy of its output there; two B outputs listed too few other members; one part's agreement was first computed
// before a repo's B labels were collected.
const idxOf = (dir) => JSON.parse(readFileSync(join(dir, "prompts", "index.json"), "utf8"));
const entryOf = (dir, L, repo, stage = "label") => idxOf(dir).find((e) => e.stage === stage && e.labeller === L && e.repo === repo);

test("prompt.mjs gives every prompt a fresh, empty working directory outside any checkout, and refuses a root that is not neutral", () => {
  const dir = join(tmp, "cwd-run");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"));
  const out = node("prompt.mjs", "label", "--run", dir, "--labeller", "A", "--rubric", "v3");
  const idx = idxOf(dir);
  assert.equal(idx.length, 3);
  const cwds = idx.map((e) => e.cwd);
  assert.equal(new Set(cwds).size, 3, "one directory per prompt");
  for (const e of idx) {
    assert.match(e.cwd, /\/workdirs\/[0-9a-f-]{36}$/);
    assert.deepEqual(readdirSync(e.cwd), [], "empty");
    assert.notEqual(dirname(e.cwd), dirname(dirname(e.output)), "not the outbox root");
    assert.ok(Array.isArray(e.checkout_status), "the checkout's status is recorded at render time");
    assert.ok(out.includes(`launch in (cwd) ${e.cwd}`));
    assert.match(readFileSync(e.prompt, "utf8"), /Write nothing else, anywhere: no copies, drafts or notes/);
    assert.ok(!readFileSync(e.prompt, "utf8").includes(e.cwd), "the prompt does not name it");
  }
  // a root inside a git work tree (a repo checkout here), the run directory or the outbox root is refused
  for (const [root, why] of [
    [join(tmp, "src", "ts-a", "wd"), /it is inside the git work tree/],
    [join(dir, "wd"), /it is inside the run directory/],
    [join(dirname(dirname(idx[0].output)), "wd"), /it is inside the outbox root/],
  ]) {
    const r = nodeRun("prompt.mjs", "label", "--run", dir, "--labeller", "B", "--rubric", "v3", "--workdir-root", root);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, why);
    assert.match(r.stderr, /is not neutral/);
    assert.ok(!existsSync(root), "a refused root is not created");
  }
});

test("collect.mjs flags outputs outside their outbox: working directory, extra outbox files, checkout writes, copies, twins, stamped fields", () => {
  const dir = join(tmp, "stray-run");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"));
  node("prompt.mjs", "label", "--run", dir, "--labeller", "A", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  const [ea, eb, ec] = ["ts-a", "ts-b", "py-c"].map((r) => entryOf(dir, "A", r));
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  const checkoutB = run.repos.find((r) => r.name === "ts-b").checkout;
  // ts-a: a stray copy in its working directory and in a foreign outbox dir; ts-b: an extra outbox file and a new
  // file in its checkout; py-c: records carrying `labeller`
  writeFileSync(join(ea.cwd, "labels-copy.jsonl"), readFileSync(ea.output));
  const foreign = join(dirname(dirname(ea.output)), "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12));
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "notes.md"), readFileSync(ea.output, "utf8").split("\n")[0]);
  writeFileSync(join(dirname(eb.output), "out.jsonl.bak"), readFileSync(eb.output));
  writeFileSync(join(checkoutB, "labels.jsonl"), "x\n");
  const pc = readFileSync(ec.output, "utf8").trim().split("\n").map(JSON.parse);
  writeFileSync(ec.output, pc.map((x) => JSON.stringify({ ...x, labeller: "A" })).join("\n") + "\n");
  let c = nodeRun("collect.mjs", "--run", dir, "--stage", "label");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /label A ts-a: INVALID\n(.*\n)*? {2}its working directory .* is not empty \(1: labels-copy\.jsonl\): the agent wrote outside its outbox/);
  assert.match(c.stdout, /label A ts-a: INVALID\n(.*\n)*? {2}a copy of its records is outside its outbox: .*labels-copy\.jsonl/);
  assert.match(c.stdout, /a copy of its records is outside its outbox: .*notes\.md/);
  assert.match(c.stdout, /label A ts-b: INVALID\n(.*\n)*? {2}its outbox holds other files besides out\.jsonl: out\.jsonl\.bak/);
  assert.match(c.stdout, /label A ts-b: INVALID\n(.*\n)*? {2}the checkout .* changed since the prompt was rendered \(1: labels\.jsonl\): an agent must not write there/);
  assert.match(c.stdout, /label A py-c: INVALID\n {2}4 records carry `labeller`, `rubric_sha256` or `model`, which only collect\.mjs writes/);
  assert.ok(existsSync(ea.output) && existsSync(eb.output), "nothing invalid is moved");
  assert.equal(entryOf(dir, "A", "ts-a").rejected.length, 1, "each rejection is recorded in the index");
  // moved aside: everything collects; the working directories are removed with the outboxes
  for (const f of [join(ea.cwd, "labels-copy.jsonl"), join(dirname(eb.output), "out.jsonl.bak"), join(checkoutB, "labels.jsonl")]) rmSync(f);
  rmSync(foreign, { recursive: true });
  writeFileSync(ec.output, pc.map((x) => JSON.stringify(x)).join("\n") + "\n");
  c = nodeRun("collect.mjs", "--run", dir, "--stage", "label");
  assert.equal(c.status, 0, c.stdout);
  for (const e of [ea, eb, ec]) assert.ok(!existsSync(e.cwd) && !existsSync(dirname(e.output)));
  // B: a byte-identical output, and records whose reasons are A's
  node("prompt.mjs", "label", "--run", dir, "--labeller", "B", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  const [ba, bb] = ["ts-a", "ts-b"].map((r) => entryOf(dir, "B", r));
  const aLabels = readFileSync(join(dir, "labels", "A", "ts-a.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  writeFileSync(ba.output, aLabels.map(({ labeller, rubric_sha256, ...x }) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(join(dirname(bb.output), "..", "loose.jsonl"), "{}\n");
  copyFileSync(entryOf(dir, "B", "py-c").output, bb.output);
  c = nodeRun("collect.mjs", "--run", dir, "--stage", "label");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /label B ts-a: INVALID\n(.*\n)*? {2}4 records have the same reason text as labeller A's collected label of that uid .*: not an independent label/);
  assert.match(c.stdout, /label B ts-b: INVALID\n(.*\n)*? {2}byte-identical to the output of label B py-c/);
  assert.match(c.stdout, /outbox root .*: 1 loose files that belong to no prompt \(loose\.jsonl\)/);
  rmSync(join(dirname(bb.output), "..", "loose.jsonl"));
});

test("collect.mjs: a missing output waits, is MISSING with --complete or when its working directory holds files; --complete lists incomplete label sets", () => {
  const dir = join(tmp, "missing-run");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"));
  node("prompt.mjs", "label", "--run", dir, "--labeller", "A", "--rubric", "v3");
  let c = nodeRun("collect.mjs", "--run", dir, "--stage", "label");
  assert.equal(c.status, 0, c.stdout);
  assert.match(c.stdout, /label A ts-a: waiting \(no output in its outbox yet\)/);
  assert.match(c.stderr, /3 waiting/);
  c = nodeRun("collect.mjs", "--run", dir, "--stage", "label", "--complete");
  assert.equal(c.status, 1);
  assert.match(c.stdout, /label A ts-a: MISSING \(no output in its outbox .*; --complete\)/);
  // an agent that wrote its output into its working directory instead of its outbox
  const ea = entryOf(dir, "A", "ts-a");
  writeFileSync(join(ea.cwd, "out.jsonl"), "{}\n");
  c = nodeRun("collect.mjs", "--run", dir, "--stage", "label");
  assert.equal(c.status, 1);
  assert.match(c.stdout, /label A ts-a: MISSING from its outbox, and its working directory .* holds 1 files \(out\.jsonl\): the agent wrote outside its outbox/);
  rmSync(join(ea.cwd, "out.jsonl"));
  // A collected, B not rendered: --complete names every missing set
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  node("collect.mjs", "--run", dir, "--stage", "label");
  c = nodeRun("collect.mjs", "--run", dir, "--stage", "label", "--complete");
  assert.equal(c.status, 1);
  assert.match(c.stdout, /INCOMPLETE B ts-a: 0 of 4 labelled \(no prompt rendered\)/);
  assert.equal(nodeRun("collect.mjs", "--run", dir, "--stage", "label", "--labeller", "A", "--complete").status, 0);
});

test("agree.mjs and metrics.mjs refuse while a repo lacks its A or B labels, unless --allow-incomplete, which they record", () => {
  const dir = join(tmp, "incomplete-run");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"));
  node("prompt.mjs", "label", "--run", dir, "--labeller", "A", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  node("collect.mjs", "--run", dir, "--stage", "label");
  node("prompt.mjs", "label", "--run", dir, "--labeller", "B", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  // B of ts-a is still with its agent (the relabel 3 slip): agreement must wait
  rmSync(entryOf(dir, "B", "ts-a").output);
  node("collect.mjs", "--run", dir, "--stage", "label");
  let r = nodeRun("agree.mjs", "--run", dir);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /agree\.mjs needs complete A and B label sets; 1 are not:\n {2}B ts-a: 0 of 4 labelled \(prompt rendered, output not collected\)/);
  assert.ok(!existsSync(join(dir, "agreement.json")), "nothing is written");
  r = nodeRun("agree.mjs", "--run", dir, "--allow-incomplete", "short");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /at least 10 characters/);
  r = nodeRun("agree.mjs", "--run", dir, "--allow-incomplete", "test: ts-a's B agent never finished");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\*\*Computed on INCOMPLETE label sets\*\* \(`--allow-incomplete`: test: ts-a's B agent never finished\)\. Not labelled: B ts-a: 0 of 4 labelled/);
  const ag = JSON.parse(readFileSync(join(dir, "agreement.json"), "utf8"));
  assert.deepEqual(ag.incomplete.gaps, ["B ts-a: 0 of 4 labelled (prompt rendered, output not collected)"]);
  // metrics: the same rule, and an incomplete run is never a headline
  r = nodeRun("metrics.mjs", "--run", dir, "--labels", join(dir, "labels", "A"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /metrics\.mjs needs complete A and B label sets/);
  const mj = join(dir, "m.json");
  r = nodeRun("metrics.mjs", "--run", dir, "--labels", join(dir, "labels", "A"), "--allow-incomplete", "test: preview on A alone", "--json", mj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Computed on INCOMPLETE A\/B label sets/);
  assert.equal(JSON.parse(readFileSync(mj, "utf8")).incomplete.reason, "test: preview on A alone");
  // once complete, the flag is refused as unneeded and the outputs carry no `incomplete`
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  node("collect.mjs", "--run", dir, "--stage", "label", "--complete");
  assert.match(nodeRun("agree.mjs", "--run", dir, "--allow-incomplete", "no longer true at all").stderr, /every A and B label set is complete; drop the flag/);
  node("agree.mjs", "--run", dir);
  assert.equal(JSON.parse(readFileSync(join(dir, "agreement.json"), "utf8")).incomplete, undefined);
});

test("collect.mjs finds a copy of an output among the untracked files of the Drift repository (the relabel 3 stray file)", () => {
  // a stand-in Drift checkout holding a copy of the scripts: lib.mjs takes its repository root from where it lives
  const D = join(tmp, "fake-drift");
  const S = join(D, "eval", "study");
  mkdirSync(S, { recursive: true });
  for (const f of readdirSync(here)) if (/\.(mjs|md|json)$/.test(f) && !f.endsWith(".test.mjs")) copyFileSync(join(here, f), join(S, f));
  writeFileSync(join(D, "Cargo.toml"), "[workspace]\n");
  git(D, "init", "-q");
  git(D, "add", ".");
  git(D, "commit", "-qm", "init");
  const dir = join(tmp, "drift-stray-run");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", dir, "--cache", join(tmp, "cache"));
  // the orchestrator's checkout is no place for an agent's working directory
  const bad = spawnSync(process.execPath, [join(S, "prompt.mjs"), "label", "--run", dir, "--labeller", "A", "--rubric", "v3", "--workdir-root", join(D, "wd")], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /it is inside the git work tree .*fake-drift; it is inside the Drift repository/);
  node("prompt.mjs", "label", "--run", dir, "--labeller", "A", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", dir, "--stage", "label");
  const ea = entryOf(dir, "A", "ts-a");
  writeFileSync(join(D, "ts-a-labels.jsonl"), readFileSync(ea.output));
  const c = spawnSync(process.execPath, [join(S, "collect.mjs"), "--run", dir, "--stage", "label"], { encoding: "utf8" });
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /label A ts-a: INVALID\n {2}a copy of its records is outside its outbox: .*fake-drift\/ts-a-labels\.jsonl/);
  assert.match(c.stdout, /label A ts-b: ok/);
  rmSync(join(D, "ts-a-labels.jsonl"));
  assert.equal(spawnSync(process.execPath, [join(S, "collect.mjs"), "--run", dir, "--stage", "label"], { encoding: "utf8" }).status, 0);
});

test("collect.mjs --repo collects only that repo's output and leaves the others in their outboxes", () => {
  const RUNR = join(tmp, "run-repo");
  node("prepare.mjs", "--drift", drift, "--manifest", manifest, "--run", RUNR, "--cache", join(tmp, "cache-repo"), "--strict-tier");
  node("prompt.mjs", "label", "--run", RUNR, "--labeller", "A", "--rubric", "v3");
  node("dry-run.mjs", "fill", "--run", RUNR, "--stage", "label");
  node("collect.mjs", "--run", RUNR, "--stage", "label", "--labeller", "A", "--repo", "ts-a");
  const idx = JSON.parse(readFileSync(join(RUNR, "prompts", "index.json"), "utf8"));
  const by = Object.fromEntries(idx.map((e) => [e.repo, e]));
  assert.equal(by["ts-a"].collected ? true : false, true);
  assert.ok(existsSync(join(RUNR, "labels", "A", "ts-a.jsonl")));
  for (const r of ["ts-b", "py-c"]) {
    assert.ok(!by[r].collected, `${r} must not be collected`);
    assert.ok(existsSync(by[r].output), `${r}'s output stays in its outbox`);
    assert.ok(!existsSync(join(RUNR, "labels", "A", `${r}.jsonl`)));
  }
});
