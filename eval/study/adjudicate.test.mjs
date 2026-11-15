// adjudicate.mjs --exclude-repos: whole repos left out of adjudication and merge, with a recorded reason.
//
//   node --test eval/study/adjudicate.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "study-adjudicate-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const item = (repo, id) => ({ uid: `${repo}/${id}`, repo, id, rank: 1, example: `${repo}/a.ts#f`, outlier_files: [`${repo}/b.ts`] });
const rec = (p, label) => ({
  uid: p.uid,
  rubric: "v3",
  label,
  ...(label === "WRONG" ? { wrong_because: "legit_outliers" } : {}),
  clear: true,
  confidence: "high",
  reason: "a reason long enough to pass",
  checked: [`${p.repo}/a.ts`, `${p.repo}/b.ts`, `${p.repo}/c.ts`, `${p.repo}/d.ts`],
});
function setup(name) {
  const run = join(tmp, name);
  const items = [item("r1", "D-1"), item("r1", "D-2"), item("r2", "D-3")];
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "run.json"), JSON.stringify({ run, params: {}, repos: [{ name: "r1", status: "ok" }, { name: "r2", status: "ok" }] }));
  writeFileSync(join(run, "queue.json"), JSON.stringify({ items }));
  for (const [L, labels] of [["A", ["ACCEPT", "WRONG"]], ["B", ["ACCEPT", "ACCEPT"]]]) {
    mkdirSync(join(run, "labels", L), { recursive: true });
    // r2 has no labels: its labeller never ran
    writeFileSync(join(run, "labels", L, "r1.jsonl"), items.slice(0, 2).map((p, i) => JSON.stringify({ ...rec(p, labels[i]), labeller: L })).join("\n") + "\n");
  }
  // agreement first (README step 3): adjudicate.mjs queues only labels whose agreement is recorded. r2 has no labels,
  // so agree.mjs refuses unless the gap is acknowledged with --allow-incomplete, which it records.
  const refused = spawnSync(process.execPath, [join(here, "agree.mjs"), "--run", run], { encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /A r2: 0 of 1 labelled/);
  const ag = spawnSync(process.execPath, [join(here, "agree.mjs"), "--run", run, "--allow-incomplete", "r2's labeller was stopped"], { encoding: "utf8" });
  assert.equal(ag.status, 0, ag.stderr);
  assert.match(ag.stdout, /Computed on INCOMPLETE label sets/);
  const rec2 = JSON.parse(readFileSync(join(run, "agreement.json"), "utf8")).incomplete;
  assert.equal(rec2.reason, "r2's labeller was stopped");
  assert.deepEqual(rec2.gaps, ["A r2: 0 of 1 labelled", "B r2: 0 of 1 labelled"]);
  return { run, items };
}
const adj = (...a) => spawnSync(process.execPath, [join(here, "adjudicate.mjs"), ...a], { encoding: "utf8" });

test("a repo without labels stops adjudication unless it is excluded, with a reason, and the exclusion is recorded", () => {
  const { run } = setup("ex1");
  assert.notEqual(adj("--run", run).status, 0);
  const noReason = adj("--run", run, "--exclude-repos", "r2");
  assert.notEqual(noReason.status, 0);
  assert.match(noReason.stderr, /--exclude-reason/);
  assert.notEqual(adj("--run", run, "--exclude-repos", "nope", "--exclude-reason", "a reason long enough").status, 0);
  const ok = adj("--run", run, "--exclude-repos", "r2", "--exclude-reason", "its labeller was stopped");
  assert.equal(ok.status, 0, ok.stderr);
  const q = JSON.parse(readFileSync(join(run, "adjudication", "queue.json"), "utf8"));
  assert.deepEqual(q.excluded.repos, ["r2"]);
  assert.deepEqual(q.excluded.uids, ["r2/D-3"]);
  assert.equal(q.excluded.reason, "its labeller was stopped");
  assert.deepEqual(q.cases.map((c) => c.uid), ["r1/D-2"]);
});

test("--merge uses the recorded exclusion, refuses a different one, and leaves the excluded repo out of final.jsonl", () => {
  const { run } = setup("ex2");
  assert.equal(adj("--run", run, "--exclude-repos", "r2", "--exclude-reason", "its labeller was stopped").status, 0);
  mkdirSync(join(run, "labels", "C"), { recursive: true });
  const q = JSON.parse(readFileSync(join(run, "adjudication", "queue.json"), "utf8"));
  const c = q.cases[0];
  const sided = String(c.order.indexOf("A") + 1); // C sides with A (WRONG)
  writeFileSync(join(run, "labels", "C", "r1.jsonl"), JSON.stringify({ ...rec(item("r1", "D-2"), "WRONG"), labeller: "C", sided_with: sided }) + "\n");
  const bad = adj("--run", run, "--merge", "--exclude-repos", "r1");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /differs from the exclusion recorded/);
  const m = adj("--run", run, "--merge");
  assert.equal(m.status, 0, m.stderr);
  assert.match(m.stdout, /excluded r2 \(1 proposals, not in final\.jsonl\)/);
  const final = readFileSync(join(run, "final.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(final.map((f) => [f.uid, f.label, f.source]), [["r1/D-1", "ACCEPT", "agreed"], ["r1/D-2", "WRONG", "adjudicated"]]);
});
