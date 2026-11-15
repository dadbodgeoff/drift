// Calibration shift per tier: ACCEPT before (prior.jsonl) and under v3 (v3-final.jsonl), for the drawn and the
// forced uids that a tier puts in its default tier. Reproduces the rule-5 and D5 rows of the README's Results.
//
//   node eval/study/runs/calib-v3-2026-11-06/tier-rows.mjs [--lib FILE] [--tier FILE[#key]]...
//
// Defaults: eval/study/lib.mjs; rule 5's tier as pre-registered (params.tier of runs/dev-ts-r2-2026-11-05/views/rule5,
// since the held-out manifests now hold D5's) and eval/study/tier-d5.json (decision D5, #28). A --tier file may be
// a tier file ({tier}) or a run.json ({params: {tier}}).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const libPath = resolve(opt("--lib")[0] ?? join(here, "..", "..", "lib.mjs"));
const { tierOf, checkTier } = await import(pathToFileURL(libPath).href);
const d5 = join(here, "..", "..", "tier-d5.json");
const rule5 = join(here, "..", "dev-ts-r2-2026-11-05", "views", "rule5", "run.json");
const tierFiles = opt("--tier").length ? opt("--tier") : [rule5, ...(existsSync(d5) ? [d5] : [])];
const read = (f) => readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
const prior = new Map(read(join(here, "prior.jsonl")).map((p) => [p.uid, p]));
const v3 = new Map(read(join(here, "v3-final.jsonl")).map((x) => [x.uid, x]));
const items = ["ts", "py"].flatMap((L) => JSON.parse(readFileSync(join(here, L, "queue.json"), "utf8")).items);
for (const f of tierFiles) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const t = j.tier ?? j.params?.tier;
  const problems = checkTier(t);
  if (problems.length) throw new Error(`${f}: ${problems.join("; ")}`);
  for (const forced of [false, true]) {
    const s = items.filter((q) => !!prior.get(q.uid).forced === forced && v3.has(q.uid) && tierOf(q, t) === "default");
    const acc = (m) => s.filter((q) => m.get(q.uid).label === "ACCEPT").length;
    const label = f === rule5 ? "rule 5 (views/rule5)" : f.split("/").pop();
    console.log(`${label} ${forced ? "forced" : "drawn"} default tier: ${acc(prior)}/${s.length} ACCEPT before, ${acc(v3)}/${s.length} under v3 (${s.map((q) => q.uid).join(", ")})`);
  }
}
