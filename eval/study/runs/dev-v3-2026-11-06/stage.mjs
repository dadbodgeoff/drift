// Stages the v3 dev relabel (rubric v3, decision D6) of every shown proposal at main, for three dev parts:
//   ts   eval/repos.json       (16 TypeScript/JavaScript dev repos)
//   py   eval/repos-py.json    (8 Python dev repos)
//   py2  eval/repos-py-2.json  (12 Python dev repos, never labelled before)
// Kept with the run as its record; run once, from the root of the checkout, after prepare.mjs wrote each part:
//
//   node eval/study/runs/dev-v3-2026-11-06/stage.mjs stage --checkouts-ts DIR --checkouts-py DIR --checkouts-py2 DIR --cache DIR
//   node eval/study/prompt.mjs label --run eval/study/runs/dev-v3-2026-11-06/<part>/relabel --labeller A --rubric v3
//   node eval/study/runs/dev-v3-2026-11-06/stage.mjs batches
//
// `stage` reads each part's run.json and queue.json (prepare.mjs output; nothing in them changes) and writes, per part:
//   carried.jsonl   v3 labels carried from runs/calib-v3-2026-11-06 (rule 4: only for a proposal whose uid, pinned
//                   repo commit and card text, the census block as a labeller sees it, without rank and tier line,
//                   are identical), in final.jsonl's row format with source "carried"
//   relabel/        a harness run restricted to the uids that are not carried, built like the r2 relabel/ sub-runs:
//                   the part's run.json with `run` renamed and `relabel_of` added, `checkout` set to the shared
//                   read-only dev clones the labellers open; its queue.json filtered to those uids
//   views/d5/       the part with decision D5's tier (eval/study/tier-d5.json) applied as a derived view, not
//                   pre-registered for these dev manifests (repos-py-2.json pre-registers rule 5's tier)
// and stage.json: per part and tier, the proposals shown, carried and to label, and the census `tier:` line check.
// `batches` reads each relabel/prompts/index.json and writes batches.json: one labeller batch per (labeller, repo)
// prompt, as the protocol requires (README "Launching"; REVIEWER-PROMPT.md "Isolation").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, die, parseArgs, parseCensus, readJson, readJsonl, rubricText, sha256Text, tierOf } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const rel = (p) => relative(root, p);
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const CALIB = join(here, "..", "calib-v3-2026-11-06");
const D5 = readJson(join(here, "..", "..", "tier-d5.json")).tier;
const PARTS = [
  { part: "ts", checkouts: "checkoutsTs", calib: "ts" },
  { part: "py", checkouts: "checkoutsPy", calib: "py" },
  { part: "py2", checkouts: "checkoutsPy2", calib: null },
];
const card = (block) => block.replace(/^\s*\d+\. /, ""); // what a labeller is shown (prompt.mjs stripRank)
const count = (items, tierOfItem) => {
  const c = { shown: items.length, default: 0, suggestion: 0 };
  for (const p of items) c[tierOfItem(p)]++;
  return c;
};

if (cmd === "stage") {
  const v3sha = sha256Text(rubricText("v3"));
  if (v3sha !== APPROVED_RUBRIC.sha256) die(`RUBRIC-v3.md's labeller-facing text is not the approved one (${v3sha.slice(0, 12)})`);
  const summary = { rubric: { version: "v3", sha256: v3sha }, d5_tier: "eval/study/tier-d5.json", parts: {} };
  if (!args.cache) die("--cache is required (the outbox root's parent; a neutral path)");
  for (const { part, checkouts, calib } of PARTS) {
    if (!args[checkouts]) die(`--${checkouts.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} is required`);
    const dir = join(here, part);
    const run = readJson(join(dir, "run.json"));
    const queue = readJson(join(dir, "queue.json"));
    const bad = run.repos.filter((r) => r.status !== "ok");
    if (bad.length) die(`${part}: repos not ok: ${bad.map((r) => `${r.name} (${r.status})`).join(", ")}`);
    // The product's census tier line against D5's tierOf (what prepare.mjs --strict-tier checks under a D5 manifest).
    const censusTier = new Map();
    for (const r of run.repos) for (const p of parseCensus(readFileSync(join(dir, "proposals", `${r.name}.txt`), "utf8")).proposals) censusTier.set(`${r.name}/${p.id}`, p.census_tier ?? null);
    const d5Items = queue.items.map((p) => ({ ...p, tier: tierOf(p, D5) }));
    const tierMismatch = d5Items.filter((p) => censusTier.get(p.uid) !== p.tier).map((p) => ({ uid: p.uid, census: censusTier.get(p.uid), d5: p.tier }));

    // Carry v3 labels from the calibration where rule 4 allows it.
    const carried = [];
    const notCarried = [];
    if (calib) {
      const cRun = readJson(join(CALIB, calib, "run.json"));
      const cQueue = new Map(readJson(join(CALIB, calib, "queue.json")).items.map((p) => [p.uid, p]));
      const cIndex = readJson(join(CALIB, calib, "prompts", "index.json"));
      const shas = [...new Set(cIndex.filter((e) => e.stage === "label" || e.stage === "adjudicate").map((e) => e.rubric_sha256))];
      if (shas.length !== 1 || shas[0] !== v3sha) die(`${part}: the calibration's prompts used rubric text ${shas.join(", ")}, not ${v3sha.slice(0, 12)}`);
      const cSha = new Map(cRun.repos.map((r) => [r.name, r.sha]));
      const sha = new Map(run.repos.map((r) => [r.name, r.sha]));
      const now = new Map(queue.items.map((p) => [p.uid, p]));
      for (const f of readJsonl(join(CALIB, calib, "final.jsonl"))) {
        const p = now.get(f.uid);
        const c = cQueue.get(f.uid);
        const why = !p ? "not shown at main" : f.rubric !== "v3" ? `label rubric ${f.rubric}` : cSha.get(f.repo) !== sha.get(f.repo) ? "repo pin differs" : card(c.block) !== card(p.block) ? "census text differs" : null;
        if (why) notCarried.push({ uid: f.uid, why });
        else carried.push({ ...f, source: "carried", carried_source: f.source, carried_from: rel(join(CALIB, calib, "final.jsonl")), round: "2026-11-06 calib-v3" });
      }
    }
    const carriedUids = new Set(carried.map((f) => f.uid));
    writeFileSync(join(dir, "carried.jsonl"), carried.map((f) => JSON.stringify(f)).join("\n") + (carried.length ? "\n" : ""));

    // relabel/: the uids to label in this round.
    const todo = queue.items.filter((p) => !carriedUids.has(p.uid));
    const todoRepos = new Set(todo.map((p) => p.repo));
    const co = resolve(args[checkouts]);
    const sub = {
      ...run,
      run: rel(join(dir, "relabel")),
      relabel_of: { run: run.run, uids: todo.map((p) => p.uid), purpose: "rubric v3 dev relabel (decision D6): every shown proposal at main not carried from runs/calib-v3-2026-11-06" },
      params: { ...run.params, cache: resolve(args.cache), checkouts: co }, // cache: prompt.mjs puts the outboxes in <cache>/outbox
      repos: run.repos.filter((r) => todoRepos.has(r.name)).map((r) => ({ ...r, checkout: join(co, r.name) })),
    };
    for (const r of sub.repos) if (!existsSync(join(r.checkout, ".git"))) die(`${part}: no checkout at ${r.checkout}`);
    mkdirSync(join(dir, "relabel"), { recursive: true });
    writeFileSync(join(dir, "relabel", "run.json"), JSON.stringify(sub, null, 2) + "\n");
    writeFileSync(join(dir, "relabel", "queue.json"), JSON.stringify({ run: sub.run, items: todo }, null, 2) + "\n");

    // views/d5: D5's tier as a derived view.
    const view = {
      ...run,
      run: rel(join(dir, "views", "d5")),
      params: { ...run.params, tier: D5, tier_pre_registered: false, tier_pre_registered_note: "derived view: decision D5's tier (eval/study/tier-d5.json) applied after the census; not pre-registered for this dev manifest" },
      view_of: { run: run.run, items: "all shown proposals", tier_from: "eval/study/tier-d5.json (decision D5), the tier the product ships and every held-out manifest holds" },
    };
    mkdirSync(join(dir, "views", "d5"), { recursive: true });
    writeFileSync(join(dir, "views", "d5", "run.json"), JSON.stringify(view, null, 2) + "\n");
    writeFileSync(join(dir, "views", "d5", "queue.json"), JSON.stringify({ run: view.run, items: d5Items }, null, 2) + "\n");

    const d5Of = new Map(d5Items.map((p) => [p.uid, p.tier]));
    const byD5 = (p) => d5Of.get(p.uid);
    const perRepo = run.repos.map((r) => {
      const all = queue.items.filter((p) => p.repo === r.name);
      return { repo: r.name, shown: all.length, carried: all.filter((p) => carriedUids.has(p.uid)).length, to_label: all.filter((p) => !carriedUids.has(p.uid)).length, d5_default: all.filter((p) => byD5(p) === "default").length };
    });
    summary.parts[part] = {
      run: run.run,
      manifest: run.manifest.path,
      recorded_tier: run.params.tier.kind === "min_members" ? `min_members ${run.params.tier.value} (no tier in the manifest)` : `${run.params.tier.kind} (pre-registered in the manifest: rule 5)`,
      shown: { recorded_tier: count(queue.items, (p) => p.tier), d5: count(queue.items, byD5) },
      carried: { all: carried.length, d5: count(carried.map((f) => queue.items.find((p) => p.uid === f.uid)), byD5) },
      to_label: { all: todo.length, d5: count(todo, byD5) },
      not_carried_from_calibration: notCarried,
      census_tier_vs_d5_mismatches: tierMismatch,
      repos: perRepo,
    };
    console.log(`${part}: ${queue.items.length} shown (D5 default ${summary.parts[part].shown.d5.default}, suggestion ${summary.parts[part].shown.d5.suggestion}); carried ${carried.length}; to label ${todo.length} in ${sub.repos.length} repos; census tier vs D5 mismatches ${tierMismatch.length}`);
  }
  writeFileSync(join(here, "stage.json"), JSON.stringify(summary, null, 2) + "\n");
} else if (cmd === "batches") {
  const out = { rule: "one batch = one (labeller, repo) prompt, launched as one fresh agent (README 'Launching'; REVIEWER-PROMPT.md 'Isolation'); A and B of one repo never at the same time", batches: [] };
  for (const { part } of PARTS) {
    const sub = join(here, part, "relabel");
    const index = existsSync(join(sub, "prompts", "index.json")) ? readJson(join(sub, "prompts", "index.json")) : [];
    const queue = readJson(join(sub, "queue.json"));
    for (const r of readJson(join(sub, "run.json")).repos) {
      const n = queue.items.filter((p) => p.repo === r.name).length;
      for (const L of ["A", "B"]) {
        const e = index.find((x) => x.stage === "label" && x.labeller === L && x.repo === r.name);
        out.batches.push({ part, labeller: L, repo: r.name, proposals: n, prompt: e ? rel(e.prompt) : rel(join(sub, "prompts", "label", L, `${r.name}.md`)), output: e?.output ?? null, status: e ? (e.collected ? "collected" : "rendered") : "not rendered (prompt.mjs renders it once the other labeller's output for this repo is collected)" });
      }
    }
  }
  writeFileSync(join(here, "batches.json"), JSON.stringify(out, null, 2) + "\n");
  for (const b of out.batches.filter((x) => x.output)) console.log(`${b.part} ${b.labeller} ${b.repo} (${b.proposals}): ${b.prompt} -> ${b.output}`);
} else die("usage: stage.mjs stage --checkouts-ts DIR --checkouts-py DIR --checkouts-py2 DIR --cache DIR | stage.mjs batches");
