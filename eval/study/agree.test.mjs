// agree.mjs under F2 (PLAN-R14 WS-F): below n = 30 only raw agreement is printed; at n >= 30, Cohen's kappa and
// Gwet's AC1, each with a repo-cluster bootstrap interval. No adjective for either.
//
//   node --test eval/study/agree.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "agree-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ADJECTIVES = /slight|fair|moderate|substantial|almost perfect|perfect/i;
function sets(n, disagreeEvery) {
  const rec = (i, label) => JSON.stringify({ uid: `r${i % 6}/D-${String(i).padStart(6, "0")}`, label });
  const a = Array.from({ length: n }, (_, i) => rec(i, i % 3 ? "ACCEPT" : "WRONG"));
  const b = Array.from({ length: n }, (_, i) => rec(i, i % disagreeEvery === 0 ? "TRIVIAL" : i % 3 ? "ACCEPT" : "WRONG"));
  const pa = join(tmp, `a${n}.jsonl`);
  const pb = join(tmp, `b${n}.jsonl`);
  writeFileSync(pa, a.join("\n") + "\n");
  writeFileSync(pb, b.join("\n") + "\n");
  return [pa, pb];
}
const agree = (pa, pb, json) => spawnSync(process.execPath, [join(here, "agree.mjs"), "--a", pa, "--b", pb, "--json", json], { encoding: "utf8" });

test("below n = 30: raw agreement only, no kappa or AC1, no adjective", () => {
  const [pa, pb] = sets(7, 4);
  const r = agree(pa, pb, join(tmp, "small.json"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Exact agreement \(3 labels\)/);
  assert.doesNotMatch(r.stdout, /κ|AC1|kappa/i);
  assert.doesNotMatch(r.stdout, ADJECTIVES);
  assert.match(r.stdout, /n = 7 < 30/);
  const j = JSON.parse(readFileSync(join(tmp, "small.json"), "utf8"));
  assert.equal(j.kappa, null);
  assert.equal(j.ac1, null);
});

test("at n >= 30: Cohen's kappa and Gwet's AC1, each with a bootstrap interval, no adjective", () => {
  const [pa, pb] = sets(40, 5);
  const r = agree(pa, pb, join(tmp, "big.json"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Cohen's κ \(3 labels\) \| -?\d\.\d\d, bootstrap over 6 repos, 95% -?\d\.\d\d–-?\d\.\d\d/);
  assert.match(r.stdout, /Gwet's AC1 \(3 labels\) \| -?\d\.\d\d, bootstrap over 6 repos, 95% -?\d\.\d\d–-?\d\.\d\d/);
  assert.doesNotMatch(r.stdout, ADJECTIVES);
  const j = JSON.parse(readFileSync(join(tmp, "big.json"), "utf8"));
  assert.ok(Number.isFinite(j.kappa) && Number.isFinite(j.ac1));
  assert.ok(Number.isFinite(j.ac1_boot.lo) && j.ac1_boot.lo <= j.ac1);
});
