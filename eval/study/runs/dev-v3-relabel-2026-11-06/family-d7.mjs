// The D7 default tier of ts/views/d7 split by rule family (call wrappers, layering), with the same intervals
// metrics.mjs gives pooled rates (lib.mjs wilson, clusterBootstrap, clusterT; one cluster per repo with a default-tier
// proposal), since metrics.mjs's family table gives Wilson only. Writes ts/views/d7/families.json and prints a table.
//
//   node eval/study/runs/dev-v3-relabel-2026-11-06/family-d7.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clusterBootstrap, clusterT, readJson, readJsonl, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const view = join(here, "ts", "views", "d7");
const label = new Map(readJsonl(join(here, "ts", "final.jsonl")).map((f) => [f.uid, f.label]));
const items = readJson(join(view, "queue.json")).items.filter((p) => p.tier === "default");
const pct = (x) => (100 * x).toFixed(1) + "%";
const out = {};
const groups = [["all", () => true], ...[...new Set(items.map((p) => p.family))].map((f) => [f, (p) => p.family === f])];
for (const [name, pick] of groups) {
  const sel = items.filter(pick);
  const repos = [...new Set(sel.map((p) => p.repo))];
  const cl = repos.map((r) => ({ k: sel.filter((p) => p.repo === r && label.get(p.uid) === "ACCEPT").length, n: sel.filter((p) => p.repo === r).length }));
  const k = sel.filter((p) => label.get(p.uid) === "ACCEPT").length;
  const unlabelled = sel.filter((p) => !label.has(p.uid)).length; // counted as WRONG (target definition)
  out[name] = { shown: sel.length, accept: k, unlabelled, p: k / sel.length, wilson: wilson(k, sel.length), boot: clusterBootstrap(cl), t: clusterT(cl), repos: repos.length };
  const o = out[name];
  console.log(`${name}: ${pct(o.p)} (${k}/${sel.length}); Wilson ${pct(o.wilson.lo)}–${pct(o.wilson.hi)}; cluster ${pct(o.boot.lo)}–${pct(o.boot.hi)} / ${pct(o.t.lo)}–${pct(o.t.hi)} (${o.repos} repos)${unlabelled ? `; ${unlabelled} unlabelled` : ""}`);
}
writeFileSync(join(view, "families.json"), JSON.stringify(out, null, 2) + "\n");
