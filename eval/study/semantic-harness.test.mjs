// Tests of the WS-G semantic study harness (eval/study/semantic/harness.mjs), which runs the frozen prompt sem-v1 with
// no product code: the prompt's sha256, the payload, strict reply parsing, the 2-of-3 decision, the structural
// invariant (a reachable entry point is never set apart) and a mutation check of every protection branch and of the
// frozen-model check.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as H from "./semantic/harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "semantic/harness.mjs"), "utf8");

const card = (over = {}) => ({
  id: "D-1", summary: "functions in src/jobs/** are wrapped in defineJob()", blockable: true,
  role: { package: "", dir: "src/jobs", file: "*", entry: "-", kind: "function" },
  evidence: { holders: 40, total: 43, lower_bound: 0.8123, lift: 12.04, split: [] },
  example: { path: "src/jobs/a.ts", symbol: "runA", line: 2 },
  outliers: [
    { path: "src/jobs/util.ts", symbol: "backoff", line: 4 },
    { path: "src/jobs/b.ts", symbol: "runB", line: 1 },
    { path: "src/jobs/route.ts", symbol: "helper", line: 3 },
  ],
  ...over,
});
const files = { "src/jobs/a.ts": "import x\nexport const runA = defineJob(() => 1);\n", "src/jobs/util.ts": "a\nb\nc\nexport function backoff() {}\n", "src/jobs/b.ts": "export function runB() {}\n", "src/jobs/route.ts": "export const GET = 1;\n\nexport function helper() {}\n" };
const read = (p) => files[p] ?? null;
const entries = () => new Map([["src/jobs/a.ts", 0], ["src/jobs/util.ts", 0], ["src/jobs/b.ts", 0], ["src/jobs/route.ts", 1]]);

test("the prompt is the frozen sem-v1", () => {
  assert.equal(H.sha256(H.prompt()), H.PROMPT_SHA256);
  assert.equal(H.PROMPT_SHA256, "95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752");
  assert.equal(H.TEMPERATURE, 0);
  assert.equal(H.SAMPLES, 3);
});

test("the payload: the card, M1 the example, then the outliers in (path, line, symbol) order", () => {
  const y = H.buildPayload(card(), "acme", read, entries());
  assert.deepEqual(y.members.map((m) => [m.key, m.flagged]), [["src/jobs/a.ts#runA", false], ["src/jobs/b.ts#runB", true], ["src/jobs/route.ts#helper", true], ["src/jobs/util.ts#backoff", true]]);
  assert.match(y.message, /^Repository: acme\n/);
  assert.match(y.message, /evidence: 40\/43 \(lower bound 0\.81, lift 12\.0\)/);
  assert.match(y.message, /### M1 \(follows, the example\): src\/jobs\/a\.ts:2 runA\n    1  import x\n    2  export const runA/);
  assert.match(y.message, /Reply with 4 entries in "kinds" and 3 in "outliers"\.$/);
  assert.equal(y.outliers_total, 3);
  // The hash covers the members' protection.
  const y2 = H.buildPayload(card(), "acme", read, new Map([...entries(), ["src/jobs/util.ts", 1]]));
  assert.notEqual(y.content_hash, y2.content_hash);
  // More than 12 outliers: 12 judged, all listed on the card up to 30.
  const many = card({ outliers: Array.from({ length: 40 }, (_, i) => ({ path: `src/jobs/x${String(i).padStart(2, "0")}.ts`, symbol: `f${i}`, line: 1 })) });
  const ym = H.buildPayload(many, "acme", read, new Map(many.outliers.map((o) => [o.path, 0])));
  assert.equal(ym.members.filter((m) => m.flagged).length, H.JUDGED_OUTLIERS);
  assert.match(ym.message, /… and 10 more outliers/);
});

test("replies are read strictly", () => {
  assert.deepEqual(H.parseSample('ok {"kinds": ["same", "other"], "outliers": ["legit"], "why": "w"}', 2, 1), { kinds: ["same", "other"], outliers: ["legit"], why: "w" });
  for (const [bad, n, f] of [[{ kinds: ["same"], outliers: [] }, 2, 0], [{ kinds: ["same"], outliers: ["legit"] }, 1, 0], [{ kinds: ["maybe"], outliers: [] }, 1, 0], [{ kinds: ["same"], outliers: ["wrong"] }, 1, 1], ["no json", 0, 0], [3, 0, 0], [null, 0, 0]]) assert.equal(H.parseSample(bad, n, f), null, JSON.stringify(bad));
});

const S = (kinds, outliers) => ({ kinds, outliers });
function fixtureChecks(M) {
  const failed = [];
  const ck = (name, f) => { try { if (!f()) failed.push(name); } catch (e) { failed.push(`${name}: ${e.message}`); } };
  const y = M.buildPayload(card(), "acme", read, entries());
  ck("a member of a file with entry points is protected", () => y.members.find((m) => m.symbol === "helper").protected === true);
  ck("a helper in a file without entry points is not", () => y.members.find((m) => m.symbol === "backoff").protected === false);
  ck("every member of an entry role is protected", () => M.buildPayload(card({ role: { ...card().role, entry: "http" } }), "acme", read, entries()).members.filter((m) => m.flagged).every((m) => m.protected));
  ck("a file the facts do not know is protected", () => M.buildPayload(card(), "acme", read, new Map([["src/jobs/a.ts", 0]])).members.filter((m) => m.flagged).every((m) => m.protected));
  // Every sample: every flag another kind and legit. Only the unprotected ones go.
  const all = S(["same", "other", "other", "other"], ["legit", "legit", "legit"]);
  ck("a protected flag is kept whatever the samples say", () => JSON.stringify(M.decide(y.members, [all, all, all]).set_apart) === JSON.stringify(["src/jobs/b.ts#runB", "src/jobs/util.ts#backoff"]));
  // 2 of 3, per member.
  const a = S(["same", "same", "same", "other"], ["mistake", "look", "legit"]);
  const b = S(["same", "same", "same", "other"], ["mistake", "legit", "mistake"]);
  const c = S(["same", "other", "same", "same"], ["legit", "one_off", "not_violation"]);
  const o = M.decide(y.members, [a, b, c]);
  ck("2 of 3: runB kept (mistake), backoff set apart (other), no majority kept", () => JSON.stringify(o.set_apart) === JSON.stringify(["src/jobs/util.ts#backoff"]) && o.members[2].flag === null && o.kept === 2);
  ck("exactly three samples", () => { try { M.decide(y.members, [a, b]); return false; } catch { return true; } });
  return failed;
}

test("the real harness passes every fixture check", () => assert.deepEqual(fixtureChecks(H), []));

test("only replies from the frozen model decide a card; a reply that never parses fails closed", async () => {
  const y = { ...H.buildPayload(card(), "acme", read, entries()), listedOutliers: card().outliers };
  const reply = JSON.stringify({ kinds: ["same", "same", "same", "other"], outliers: ["mistake", "mistake", "legit"] });
  const fake = (model, good = true) => async () => ({ exit: 0, raw: good ? reply : "nope", models_used: [model], tokens: { input_tokens: 1, output_tokens: 1 }, cost_usd: 0 });
  const other = await H.runAll([y], { model: "m", call: fake("another-model"), cwd: tmpdir() });
  assert.match(other.outcomes[0].error, /frozen model/);
  assert.equal(other.samples.length, 3);
  const bad = await H.runAll([y], { model: "m", call: fake("another-model", false), cwd: tmpdir() });
  assert.equal(bad.samples.every((s) => s.attempts === 2 && !s.ok), true, "a reply that does not parse is retried once");
});

const MUTANTS = [
  ["protect-role", "  if (p.role?.entry && p.role.entry !== \"-\") return true; // mutation:protect-role\n", ""],
  ["protect-unknown", "  if (!entryFiles.has(member.path)) return true; // mutation:protect-unknown\n", "  if (!entryFiles.has(member.path)) return false;\n"],
  ["protect-file", "  return entryFiles.get(member.path) > 0; // mutation:protect-file", "  return false;"],
  ["decide-protected", "const setApart = m.flagged && !m.protected && (k.value === \"other\" || (f.value != null && !REAL.has(f.value))); // mutation:decide-protected", "const setApart = m.flagged && (k.value === \"other\" || (f.value != null && !REAL.has(f.value)));"],
];

test("mutation check: breaking any protection branch fails a fixture check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "semh-mut-"));
  try {
    for (const [i, [what, from, to]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `mutant "${what}": its text must occur exactly once`);
      const f = join(dir, `mutant-${i}.mjs`);
      writeFileSync(f, SRC.replace(from, to).replace('join(here, "semantic-prompt-v1.txt")', JSON.stringify(H.PROMPT_FILE)));
      const failed = fixtureChecks(await import(pathToFileURL(f).href));
      assert.ok(failed.length > 0, `mutant "${what}" passed every fixture check`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("mutation check: without the frozen-model check, another model decides a card", async () => {
  const dir = mkdtempSync(join(tmpdir(), "semh-mut-"));
  try {
    const from = "const modelOk = models.size === 1 && sha256([...models][0]) === MODEL_SHA256; // mutation:model";
    assert.equal(SRC.split(from).length, 2);
    const f = join(dir, "mutant-model.mjs");
    writeFileSync(f, SRC.replace(from, "const modelOk = true;").replace('join(here, "semantic-prompt-v1.txt")', JSON.stringify(H.PROMPT_FILE)));
    const M = await import(pathToFileURL(f).href);
    const y = { ...M.buildPayload(card(), "acme", read, entries()), listedOutliers: card().outliers };
    const reply = JSON.stringify({ kinds: ["same", "same", "same", "other"], outliers: ["mistake", "mistake", "legit"] });
    const r = await M.runAll([y], { model: "m", call: async () => ({ exit: 0, raw: reply, models_used: ["another-model"] }), cwd: tmpdir() });
    assert.ok(!r.outcomes[0].error, "the mutant decides with another model, so the real check is what refuses it");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
