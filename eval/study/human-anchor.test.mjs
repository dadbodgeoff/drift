// human-anchor.mjs (PLAN-R14 WS-F F5): the JSONL form a person fills, and the model-vs-human report. Nothing is
// labelled here (decision D-4's default): the tests fill the form synthetically.
//
//   node --test eval/study/human-anchor.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promptLeaks } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "human-anchor-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const run = (...a) => spawnSync(process.execPath, [join(here, "human-anchor.mjs"), ...a], { encoding: "utf8" });
const jsonl = (p) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// A census run: 8 repos x 6 proposals, final labels agreed.
function censusRun(dir) {
  mkdirSync(dir, { recursive: true });
  const items = [];
  const final = [];
  for (let r = 0; r < 8; r++)
    for (let i = 0; i < 6; i++) {
      const uid = `repo${r}/D-${r}${i}0000`;
      items.push({ uid, repo: `repo${r}`, id: `D-${r}${i}0000`, block: ` ${i + 1}. [D-${r}${i}0000] app: handlers are wrapped in withAuth()\n    evidence: 40/42 (lower bound 0.84, lift 3.0)\n    example:  app/a.ts#GET\n    outlier:  app/b.ts:3 POST` });
      final.push({ uid, repo: `repo${r}`, label: i % 3 ? "ACCEPT" : "WRONG", source: "agreed", rubric: "v4" });
    }
  writeFileSync(join(dir, "run.json"), JSON.stringify({ run: dir, manifest: { holdout: false }, params: {}, repos: Array.from({ length: 8 }, (_, r) => ({ name: `repo${r}`, checkout: `/x/repo${r}`, status: "ok" })) }));
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ run: dir, items }));
  writeFileSync(join(dir, "final.jsonl"), final.map((x) => JSON.stringify(x)).join("\n") + "\n");
  return { items, final };
}

test("form: up to --n items, at most 5 per repo, seeded; each line a v4 card with no evidence numbers and empty answer fields", () => {
  const dir = join(tmp, "census");
  censusRun(dir);
  const out = join(tmp, "form.jsonl");
  const r = run("form", "--run", dir, "--out", out, "--n", "30", "--seed", "s1");
  assert.equal(r.status, 0, r.stderr);
  const lines = jsonl(out);
  assert.equal(lines.length, 30);
  const per = new Map();
  for (const l of lines) per.set(l.repo, (per.get(l.repo) ?? 0) + 1);
  assert.ok([...per.values()].every((n) => n <= 5));
  for (const l of lines) {
    assert.equal(l.kind, "census");
    assert.equal(l.rubric, "v4");
    assert.equal(l.label, null);
    assert.equal(l.reason, null);
    assert.deepEqual(l.checked, []);
    assert.deepEqual(promptLeaks(l.card), []);
    assert.doesNotMatch(l.card, /evidence|lower bound|lift|\d+\/\d+/);
  }
  // deterministic, and refused over an existing form
  const out2 = join(tmp, "form2.jsonl");
  run("form", "--run", dir, "--out", out2, "--n", "30", "--seed", "s1");
  assert.deepEqual(jsonl(out2).map((l) => l.uid), lines.map((l) => l.uid));
  assert.notEqual(run("form", "--run", dir, "--out", out, "--n", "30").status, 0);
});

test("report: model-vs-human agreement per label; unfilled lines are not labelled; below n = 30 raw agreement only", () => {
  const dir = join(tmp, "census2");
  const { final } = censusRun(dir);
  const out = join(tmp, "form-r.jsonl");
  run("form", "--run", dir, "--out", out, "--n", "40", "--seed", "s2");
  const lines = jsonl(out);
  const model = new Map(final.map((f) => [f.uid, f.label]));
  // the person agrees except on every fifth line, and leaves two lines blank
  const filled = lines.map((l, i) => (i >= 38 ? l : { ...l, label: i % 5 === 0 ? (model.get(l.uid) === "ACCEPT" ? "WRONG" : "ACCEPT") : model.get(l.uid), reason: "read the handlers", checked: ["app/a.ts"] }));
  const human = join(tmp, "human.jsonl");
  writeFileSync(human, filled.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const json = join(tmp, "report.json");
  const r = run("report", "--run", dir, "--human", human, "--json", json);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(json, "utf8"));
  assert.equal(j.labelled, 38);
  assert.equal(j.unfilled, 2);
  assert.equal(j.agreement.po, 30 / 38);
  assert.ok(Number.isFinite(j.agreement.kappa) && Number.isFinite(j.agreement.ac1), "n = 38 >= 30");
  const acc = j.per_label.find((x) => x.label === "ACCEPT");
  assert.ok(acc.human_n > 0 && acc.agree <= acc.human_n);
  assert.match(r.stdout, /Labelled by a person/);
  assert.doesNotMatch(r.stdout, /substantial|almost perfect|moderate/);
  // a small anchor: raw agreement only
  const small = join(tmp, "human-small.jsonl");
  writeFileSync(small, filled.slice(0, 10).map((x) => JSON.stringify(x)).join("\n") + "\n");
  const j2 = JSON.parse((run("report", "--run", dir, "--human", small, "--json", join(tmp, "r2.json")), readFileSync(join(tmp, "r2.json"), "utf8")));
  assert.equal(j2.agreement.kappa, null);
  // an invalid label is refused
  writeFileSync(small, JSON.stringify({ ...filled[0], label: "MAYBE" }) + "\n");
  assert.notEqual(run("report", "--run", dir, "--human", small).status, 0);
});
