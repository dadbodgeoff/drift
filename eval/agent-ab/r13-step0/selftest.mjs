// Scorer self-test, no model calls: on each task's prepared repo, put the original unit back
// (the reverse of the removal commit) and score it. Every concern must pass on the original;
// a run that changes nothing must score "none" or "fail" on every concern.
//
//   node eval/agent-ab/r13-step0/selftest.mjs --drift <bin> --work <dir of a run.mjs --prepare-only>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { args, changedPaths, patchOf, readJson, run, sh } from "../v2/lib.mjs";
import { withCheckout } from "./wt.mjs";
import { addedText, judge, newEntryPoints } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const a = args();
const drift = resolve(a.drift);
const work = resolve(a.work);
const suite = readJson(join(here, "tasks.json"));
const out = [];
let bad = 0;
for (const t of suite.tasks) {
  const repo = join(work, "repos", t.id);
  const { base, commit } = JSON.parse(readFileSync(join(repo, "PREPARED"), "utf8"));
  const baseInv = readJson(join(work, "base-inv", `${t.id}.json`));
  for (const variant of ["original", "empty"]) {
    await withCheckout(repo, join(work, "wt", `self-${t.id}`), async (wt) => {
      if (variant === "original") {
        const diff = sh("git", ["diff", "--binary", commit, base], wt);
        const p = join(work, `self-${t.id}.patch`);
        writeFileSync(p, diff);
        sh("git", ["apply", p], wt);
      }
      const changed = changedPaths(wt);
      const added = addedText(patchOf(wt, changed));
      const inv = JSON.parse(run(drift, ["security", "--json"], wt).stdout);
      const eps = newEntryPoints(inv, baseInv);
      const res = t.concerns.map((c) => ({ concern: c.concern, ...judge(c, eps, added) }));
      const ok = variant === "original" ? res.every((r) => r.auto === "pass") : res.every((r) => r.auto !== "pass");
      if (!ok) bad++;
      out.push({ task: t.id, variant, eps: eps.map((e) => `${e.symbol}[${e.guards.join(",")}]${e.validates ? "+v" : ""}`), res, ok });
      console.log(`${ok ? "ok  " : "BAD "} ${t.id} ${variant}: ${res.map((r) => `${r.concern}=${r.auto}${r.why ? ` (${r.why})` : ""}`).join(" ")} | ${eps.length} new entry points`);
    });
  }
}
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "selftest.json"), JSON.stringify(out, null, 2));
console.log(bad ? `${bad} BAD` : "selftest OK");
process.exit(bad ? 1 : 0);
