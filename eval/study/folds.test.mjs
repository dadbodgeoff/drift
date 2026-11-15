// The round-10 folds (PLAN-R10.md §3.2): eval/study/folds-r10.json is exactly what its seed gives for the build set,
// stratified by language, and a hand edit of it fails (hash and recompute checks). The round-11 folds (PLAN-R11.md §5):
// eval/study/folds-r11.json is folds 1-4 of folds-r10.json plus fold 5 = dev3, refused when it, folds-r10.json or a
// dev3 manifest is edited; a mutation check removes each round-11 check in turn.
//
//   node --test eval/study/folds.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  DEV3_RUNS, EXCLUDED, FOLD5, FOLDS_FILE, FOLDS_FILE_R11, METHOD_R11, N_FOLDS, SEED, assignFolds, buildSet, fold5Inputs, foldsProblems, foldsProblemsR11,
  foldsRecord, foldsRecordR11, foldsSha256, foldsSha256R11, loadFolds,
} from "./folds.mjs";
import { repoRootDir, sha256File } from "./lib.mjs";

// Pinned: changing the assignment, seed or method changes this hash, and so needs an edit here too.
const PINNED_SHA256 = "d905505d73514fcbf729e4f6add40fc41b77276fdce340ac87136fca74e17854";
const committed = JSON.parse(readFileSync(join(repoRootDir, FOLDS_FILE), "utf8"));

test("the committed folds are what the recorded seed gives (recomputed from the dev manifests)", () => {
  assert.equal(committed.seed, SEED);
  assert.deepEqual(committed, foldsRecord(buildSet(), committed.seed));
  assert.deepEqual(foldsProblems(committed), []);
  assert.equal(committed.sha256, foldsSha256(committed));
  assert.equal(committed.sha256, PINNED_SHA256);
  const r = spawnSync(process.execPath, ["eval/study/folds.mjs", "--check"], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the build set: 16 TS/JS and 18 Python repos, never polar or CTFd, each in exactly one fold", () => {
  const set = buildSet();
  assert.equal(set.ts.length, 16);
  assert.equal(set.py.length, 18);
  const all = committed.folds.flatMap((f) => [...f.ts, ...f.py]);
  assert.equal(all.length, 34);
  assert.equal(new Set(all).size, 34);
  for (const x of EXCLUDED) assert.ok(!all.includes(x), x);
  assert.deepEqual([...all].sort(), [...set.ts, ...set.py].sort());
  assert.deepEqual(committed.languages, { ts: 16, py: 18 });
});

test("stratified by language: every fold has 4 TS/JS repos and 4 or 5 Python repos", () => {
  assert.equal(committed.folds.length, N_FOLDS);
  assert.deepEqual(committed.folds.map((f) => f.fold), [1, 2, 3, 4]);
  assert.deepEqual(committed.folds.map((f) => f.ts.length), [4, 4, 4, 4]);
  assert.deepEqual(committed.folds.map((f) => f.py.length), [5, 5, 4, 4]);
  const set = buildSet();
  for (const f of committed.folds) {
    for (const r of f.ts) assert.ok(set.ts.includes(r), r);
    for (const r of f.py) assert.ok(set.py.includes(r), r);
  }
});

test("the shuffle is deterministic, depends on the seed, and ignores manifest order", () => {
  const set = buildSet();
  assert.deepEqual(assignFolds(set), assignFolds(set));
  assert.deepEqual(assignFolds({ ts: [...set.ts].reverse(), py: [...set.py].reverse() }), assignFolds(set));
  assert.notDeepEqual(assignFolds(set, `${SEED}x`).folds, assignFolds(set).folds);
});

test("a hand edit fails: a moved repo, a re-hashed edit and a new seed are each refused", () => {
  const swap = structuredClone(committed);
  [swap.folds[0].ts[0], swap.folds[1].ts[0]] = [swap.folds[1].ts[0], swap.folds[0].ts[0]];
  assert.match(foldsProblems(swap).join("; "), /sha256 .* does not match/);
  const rehashed = { ...swap, sha256: foldsSha256(swap) };
  assert.doesNotMatch(foldsProblems(rehashed).join("; "), /does not match/);
  assert.match(foldsProblems(rehashed).join("; "), /not what seed/);
  const reseeded = foldsRecord(buildSet(), `${SEED}-b`);
  assert.deepEqual(foldsProblems(reseeded), [`seed "${SEED}-b" is not the recorded seed "${SEED}"`]);
  const dir = mkdtempSync(join(tmpdir(), "folds-"));
  try {
    writeFileSync(join(dir, "f.json"), JSON.stringify(swap));
    assert.throws(() => loadFolds(join(dir, "f.json")), /was edited/);
    writeFileSync(join(dir, "f.json"), JSON.stringify(committed));
    assert.equal(loadFolds(join(dir, "f.json")).repos.size, 34);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("loadFolds maps every repo to its fold and language", () => {
  const { repos } = loadFolds();
  for (const f of committed.folds) {
    for (const r of f.ts) assert.deepEqual(repos.get(r), { fold: f.fold, lang: "ts" });
    for (const r of f.py) assert.deepEqual(repos.get(r), { fold: f.fold, lang: "py" });
  }
});

// ---------- round 11: folds-r11.json (PLAN-R11.md §5) ----------


const PINNED_SHA256_R11 = "e948705c184db3da2cd14159da93ccfc4230d6bd2627442411e6678f887e4a3f";
const committed11 = JSON.parse(readFileSync(join(repoRootDir, FOLDS_FILE_R11), "utf8"));
const DEV3_TS = ["T01", "T02", "T03", "T06", "T07", "T08", "T13", "T14", "T15", "T16", "T17", "T18"];
const DEV3_PY = ["P01", "P03", "P04", "P06", "P07", "P09", "P10", "P12"];

// A copy of the files the round-11 record is computed from, so a test can tamper with one of them.
function fixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "folds11-"));
  const files = ["eval/repos.json", "eval/repos-py.json", "eval/repos-py-2.json", FOLDS_FILE, FOLDS_FILE_R11];
  for (const run of Object.values(DEV3_RUNS)) {
    files.push(`${run}/manifest.json`, `${run}/run.json`);
    files.push(JSON.parse(readFileSync(join(repoRootDir, run, "manifest.json"), "utf8")).source.manifest);
  }
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(repoRootDir, f), join(dir, f));
  }
  return dir;
}
const editJson = (root, f, edit) => {
  const j = JSON.parse(readFileSync(join(root, f), "utf8"));
  edit(j);
  writeFileSync(join(root, f), JSON.stringify(j, null, 2) + "\n");
};

test("folds-r11: the committed file is what folds-r10.json and the dev3 census manifests give", () => {
  assert.deepEqual(committed11, foldsRecordR11());
  assert.deepEqual(foldsProblemsR11(committed11), []);
  assert.equal(committed11.sha256, foldsSha256R11(committed11));
  assert.equal(committed11.sha256, PINNED_SHA256_R11);
  assert.equal(committed11.seed, SEED);
  assert.equal(committed11.method, METHOD_R11);
  assert.deepEqual(committed11.base, { file: FOLDS_FILE, sha256: PINNED_SHA256 });
  const r = spawnSync(process.execPath, ["eval/study/folds.mjs", "--check"], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /folds-r11\.json: ok/);
});

test("folds-r11: folds 1-4 are folds-r10.json's exactly; fold 5 is dev3 (12 TS/JS, 8 Python keys); 54 repos, each once", () => {
  assert.deepEqual(committed11.folds.slice(0, N_FOLDS), committed.folds);
  assert.deepEqual(committed11.folds.map((f) => f.fold), [1, 2, 3, 4, FOLD5]);
  assert.deepEqual(committed11.folds[4], { fold: 5, ts: DEV3_TS, py: DEV3_PY });
  assert.deepEqual(committed11.languages, { ts: 28, py: 26 });
  const all = committed11.folds.flatMap((f) => [...f.ts, ...f.py]);
  assert.equal(all.length, 54);
  assert.equal(new Set(all).size, 54);
  for (const x of EXCLUDED) assert.ok(!all.includes(x), x);
  const f5 = fold5Inputs();
  assert.deepEqual(f5.problems, []);
  assert.deepEqual(f5.set, { ts: DEV3_TS, py: DEV3_PY });
  assert.deepEqual(Object.keys(committed11.fold5), ["ts", "py"]);
  const { repos } = loadFolds();
  assert.equal(repos.size, 54);
  for (const k of DEV3_TS) assert.deepEqual(repos.get(k), { fold: 5, lang: "ts" });
  for (const k of DEV3_PY) assert.deepEqual(repos.get(k), { fold: 5, lang: "py" });
  assert.deepEqual(repos.get("dub"), { fold: 4, lang: "ts" });
});

test("folds-r11: a hand edit, a changed round-10 file and a changed dev3 manifest are each refused", () => {
  const swap = structuredClone(committed11);
  [swap.folds[4].ts[0], swap.folds[0].ts[0]] = [swap.folds[0].ts[0], swap.folds[4].ts[0]];
  assert.match(foldsProblemsR11(swap).join("; "), /sha256 .* does not match/);
  const rehashed = { ...swap, sha256: foldsSha256R11(swap) };
  const p = foldsProblemsR11(rehashed).join("; ");
  assert.doesNotMatch(p, /does not match/);
  assert.match(p, /folds 1-4 are not/);
  assert.match(p, /fold 5 is not the dev3/);
  const dropped = structuredClone(committed11);
  dropped.folds[4].py = dropped.folds[4].py.slice(1);
  dropped.sha256 = foldsSha256R11(dropped);
  assert.match(foldsProblemsR11(dropped).join("; "), /fold 5 is not the dev3/);
  const rebased = structuredClone(committed11);
  rebased.base.sha256 = "0".repeat(64);
  rebased.sha256 = foldsSha256R11(rebased);
  assert.match(foldsProblemsR11(rebased).join("; "), /base sha256 .* is not/);
  const root = fixtureRoot();
  try {
    assert.deepEqual(foldsProblemsR11(committed11, root), []);
    assert.equal(loadFolds(join(root, FOLDS_FILE_R11), root).repos.size, 54);
    // folds-r10.json edited: its own checks fail, and so does the round-11 record built on it.
    editJson(root, FOLDS_FILE, (j) => { [j.folds[0].ts[0], j.folds[1].ts[0]] = [j.folds[1].ts[0], j.folds[0].ts[0]]; });
    assert.match(foldsProblemsR11(committed11, root).join("; "), /folds-r10\.json fails its own checks/);
    assert.throws(() => loadFolds(join(root, FOLDS_FILE_R11), root), /folds-r11\.json: .*fails its own checks/);
  } finally {
    rmSync(root, { recursive: true });
  }
  for (const [what, edit, want] of [
    ["a pin changed in the census manifest", (r) => editJson(r, `${DEV3_RUNS.ts}/manifest.json`, (j) => { j.repos[0].sha = "0".repeat(40); }), /not the one its census ran from|not the current slot occupants/],
    ["a repo dropped from the census manifest, run.json updated", (r) => {
      editJson(r, `${DEV3_RUNS.py}/manifest.json`, (j) => { j.repos.pop(); });
      editJson(r, `${DEV3_RUNS.py}/run.json`, (j) => { j.manifest.sha256 = sha256File(join(r, DEV3_RUNS.py, "manifest.json")); });
    }, /not the current slot occupants/],
    ["the frozen pool changed", (r) => editJson(r, "eval/dev3-2026-11-08.json", (j) => { j.burned = [{ name: "x" }]; }), /eval\/dev3-2026-11-08\.json: sha256 is not/],
  ]) {
    const r = fixtureRoot();
    try {
      edit(r);
      assert.match(foldsProblemsR11(committed11, r).join("; "), want, what);
    } finally {
      rmSync(r, { recursive: true });
    }
  }
});

// Mutation check: each round-11 check, broken in a copy of folds.mjs, lets some tampered record through.
const FSRC = readFileSync(join(repoRootDir, "eval/study/folds.mjs"), "utf8");
const FOLD_MUTANTS = [
  ["no round-10 self-check", /^.*\/\/ mutation:r10$/m],
  ["no hash check", /^.*\/\/ mutation:hash$/m],
  ["no base hash check", /^.*\/\/ mutation:base$/m],
  ["no folds 1-4 check", /^.*\/\/ mutation:folds14$/m],
  ["no dev3 manifest checks", /^.*\/\/ mutation:fold5src$/m],
  ["no fold-5 check", /^.*\/\/ mutation:fold5$/m],
];
test("mutation check: removing any round-11 check (and the whole-file check) lets a tampered record pass", async () => {
  const tampered = (M, root) => {
    const out = [];
    const t = { ...committed11, method: `${committed11.method}, edited` };
    out.push(M.foldsProblemsR11(t, root).length > 0); // hash (the method is checked by nothing else but the whole-file check)
    const t3 = structuredClone(committed11);
    t3.folds[4].py = t3.folds[4].py.slice(1);
    t3.sha256 = M.foldsSha256R11(t3);
    out.push(M.foldsProblemsR11(t3, root).length > 0); // fold 5 alone
    const t4 = structuredClone(committed11);
    t4.base.sha256 = "0".repeat(64);
    t4.sha256 = M.foldsSha256R11(t4);
    out.push(M.foldsProblemsR11(t4, root).length > 0); // base alone
    const t5 = structuredClone(committed11);
    t5.folds[0].ts = [...t5.folds[0].ts].reverse();
    t5.sha256 = M.foldsSha256R11(t5);
    out.push(M.foldsProblemsR11(t5, root).length > 0); // folds 1-4 alone
    const r = fixtureRoot();
    try {
      editJson(r, FOLDS_FILE, (j) => { j.seed = `${j.seed}x`; });
      out.push(M.foldsProblemsR11(committed11, r).length > 0); // round-10 file
    } finally {
      rmSync(r, { recursive: true });
    }
    const r2 = fixtureRoot();
    try {
      editJson(r2, "eval/dev3-2026-11-08-py.json", (j) => { j.exposed = [{ repo: "x" }]; });
      out.push(M.foldsProblemsR11(committed11, r2).length > 0); // frozen pool
    } finally {
      rmSync(r2, { recursive: true });
    }
    return out;
  };
  const real = await import(pathToFileURL(join(repoRootDir, "eval/study/folds.mjs")).href);
  assert.deepEqual(tampered(real), [true, true, true, true, true, true]);
  const dir = mkdtempSync(join(tmpdir(), "folds-mut-"));
  try {
    for (const [i, [what, re]] of FOLD_MUTANTS.entries()) {
      assert.equal((FSRC.match(new RegExp(re.source, "gm")) ?? []).length, 1, what);
      // Each mutant drops its check and the whole-file check (which would otherwise catch everything).
      const src = FSRC.replace(re, "").replace(/^.*\/\/ mutation:whole$/m, "").replace('from "./lib.mjs"', `from ${JSON.stringify(pathToFileURL(join(repoRootDir, "eval/study/lib.mjs")).href)}`);
      const f = join(dir, `m${i}.mjs`);
      writeFileSync(f, src);
      const got = tampered(await import(pathToFileURL(f).href));
      assert.ok(got.includes(false), `mutant "${what}" still refuses every tampered record`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
