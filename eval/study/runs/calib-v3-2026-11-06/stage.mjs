// Stages the rubric v3 calibration relabel (decision D6): a blind relabel, under v3, of a stratified sample of
// already-labelled dev proposals. Kept with the run as its record; run once, from the root of the checkout:
//
//   node eval/study/runs/calib-v3-2026-11-06/stage.mjs --ts-run DIR --py-run DIR --checkouts-ts DIR --checkouts-py DIR --cache DIR
//
// --ts-run: runs/dev-ts-r2-2026-11-05 (main, from PR #25); --py-run:
// runs/dev-py-r2-2026-11-05 (main). Each run's queue.json, run.json and final.jsonl are read; nothing in them
// changes. Writes, under this directory:
//   ts/ and py/   harness runs restricted to the sample (run.json, queue.json), as the r2 relabel/ sub-runs were;
//   prior.jsonl   the label each sampled uid had before (its final.jsonl row), for the v2 -> v3 comparison;
//   sample.json   the strata, the seed and which uids were forced in and why.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { die, parseArgs, readJson, readJsonl, shuffle, strip, tierOf } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
for (const k of ["tsRun", "pyRun", "checkoutsTs", "checkoutsPy", "cache"]) if (!args[k]) die(`--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} is required`);
const SEED = "drift-rubric-v3-calibration-2026-11-06";
// The rule-kind tier of rule 5, as the primary held-out manifests defined it at staging (not pre-registered for the
// dev manifests). The manifests hold D5's tier since #28; rule 5 is kept, byte for byte, in the rule-5 views.
const TIER = readJson(join(here, "..", "dev-ts-r2-2026-11-05", "views", "rule5", "run.json")).params.tier;

// Forced in: every case named in decision D6, and every A/B disagreement of the two r2 rounds (the v2-labelled rounds).
const FORCED = {
  ts: {
    "restated decorator": ["twenty/D-6429a5", "twenty/D-7e503c", "immich/D-4fc758"],
    "key the callee's type requires": ["infisical/D-d9b44e", "infisical/D-1b2542", "twenty/D-47b768", "twenty/D-006db2"],
    "mandatory library primitives": ["dub/D-e25af3", "dub/D-a23ff8", "dub/D-3fad9a", "dub/D-024a81", "dub/D-418256"],
    "A/B disagreement, ts-r2": ["ai/D-fc5ef7", "supabase/D-d8dcea", "novu/D-4512a2", "midday/D-efc6d4", "midday/D-98e729"],
  },
  py: {
    "A/B disagreement, py-r2": ["polar/D-fb4011", "netbox/D-310ec7", "saleor/D-e36ea5", "langchain/D-468530"],
    "co-located helper outliers (one ACCEPT, one WRONG)": ["CTFd/D-560792", "CTFd/D-f6c1fb"],
  },
};
// Others: per language and tier, 10 drawn at random; half from proposals whose current label is from the
// v2-labelled r2 round where the cell has them, the rest from earlier rounds.
const PER_CELL = 10;
const isR2 = (f) => /\b(ts|py)-r2\b/.test(f.round ?? "");

const out = { seed: SEED, tier: TIER, per_cell: PER_CELL, forced: FORCED, languages: {} };
const prior = [];
for (const [lang, src, checkouts] of [["ts", args.tsRun, args.checkoutsTs], ["py", args.pyRun, args.checkoutsPy]]) {
  const run = readJson(join(src, "run.json"));
  const queue = readJson(join(src, "queue.json"));
  const final = new Map(readJsonl(join(src, "final.jsonl")).map((f) => [f.uid, strip(f)]));
  const items = queue.items.map((p) => ({ ...p, tier: tierOf(p, TIER) }));
  const byUid = new Map(items.map((p) => [p.uid, p]));
  const forced = Object.values(FORCED[lang]).flat();
  for (const u of forced) if (!byUid.has(u) || !final.has(u)) die(`${lang}: forced uid ${u} is not a labelled shown proposal of ${src}`);
  const picked = [...forced];
  const cells = {};
  for (const tier of ["default", "suggestion"]) {
    const pool = items.filter((p) => p.tier === tier && !forced.includes(p.uid) && final.has(p.uid));
    const r2 = shuffle(pool.filter((p) => isR2(final.get(p.uid))).map((p) => p.uid).sort(), `${SEED}:${lang}:${tier}:r2`);
    const older = shuffle(pool.filter((p) => !isR2(final.get(p.uid))).map((p) => p.uid).sort(), `${SEED}:${lang}:${tier}:older`);
    const nR2 = Math.min(r2.length, PER_CELL / 2);
    const take = [...r2.slice(0, nR2), ...older.slice(0, PER_CELL - nR2)];
    cells[tier] = { pool: pool.length, pool_r2: r2.length, drawn: take };
    picked.push(...take);
  }
  const sample = items.filter((p) => picked.includes(p.uid)); // queue order
  const repos = [...new Set(sample.map((p) => p.repo))];
  const dir = join(here, lang);
  mkdirSync(dir, { recursive: true });
  const sub = {
    ...run,
    run: `eval/study/runs/calib-v3-2026-11-06/${lang}`,
    relabel_of: { run: run.run, uids: sample.map((p) => p.uid), purpose: "rubric v3 calibration (decision D6): blind relabel under v3" },
    // a calibration run, not a precision result: metrics.mjs reports kind "calibration" with these files
    calibration: { shift: "eval/study/runs/calib-v3-2026-11-06/shift.json", agreement: `eval/study/runs/calib-v3-2026-11-06/${lang}/agreement.json` },
    params: { ...run.params, tier: TIER, tier_note: "rule 5's rule-kind tier from eval/holdout-primary.json, applied as a derived view; not pre-registered for the dev manifests", cache: resolve(args.cache), checkouts: resolve(checkouts) },
    repos: run.repos.filter((r) => repos.includes(r.name)).map((r) => ({ ...r, checkout: join(resolve(checkouts), r.name) })),
  };
  for (const r of sub.repos) if (!existsSync(join(r.checkout, ".git"))) die(`${lang}: no checkout at ${r.checkout}`);
  writeFileSync(join(dir, "run.json"), JSON.stringify(sub, null, 2) + "\n");
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ run: sub.run, items: sample }, null, 2) + "\n");
  for (const p of sample) {
    const f = final.get(p.uid);
    prior.push({ uid: p.uid, repo: p.repo, id: p.id, language: lang, tier: p.tier, rule_kind: p.rule_kind, label: f.label, wrong_because: f.wrong_because ?? null, trivial_by: f.trivial_by ?? null, prior_round: f.round ?? (f.source === "carried" ? "carried, no round (v1 study)" : null), prior_rubric: isR2(f) ? "v2" : "pre-r2 (v1 rubric, or v2 rounds before r2)", forced: Object.entries(FORCED[lang]).find(([, l]) => l.includes(p.uid))?.[0] ?? null, from: `${run.run}/final.jsonl` });
  }
  out.languages[lang] = { source: run.run, uids: sample.length, repos, cells };
}
writeFileSync(join(here, "prior.jsonl"), prior.map((p) => JSON.stringify(p)).join("\n") + "\n");
writeFileSync(join(here, "sample.json"), JSON.stringify(out, null, 2) + "\n");
console.log(Object.entries(out.languages).map(([l, x]) => `${l}: ${x.uids} uids in ${x.repos.length} repos`).join("\n"));
