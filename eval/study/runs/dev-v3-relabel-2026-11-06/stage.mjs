// Stages the blind relabel, under rubric v3, of the TypeScript dev-set default-tier proposals (decision D7) whose
// card is new or changed at main fcec231 since runs/dev-v3-2026-11-06 (labelled at main debc33a).
// Kept with the run as its record. Run once, from the root of the checkout, after prepare.mjs wrote ts/:
//
//   node eval/study/runs/dev-v3-relabel-2026-11-06/stage.mjs stage --checkouts DIR --cache DIR
//   node eval/study/prompt.mjs label --run eval/study/runs/dev-v3-relabel-2026-11-06/ts/relabel --labeller A --rubric v3
//   node eval/study/runs/dev-v3-relabel-2026-11-06/stage.mjs batches
//
// `stage` reads ts/run.json and ts/queue.json (prepare.mjs output at fcec231; nothing in them changes) and the
// dev-v3 ts part (queue.json, final.jsonl), and writes:
//   ts/carried.jsonl  dev-v3 v3 final labels carried over, in final.jsonl's row format with source "carried":
//                     - "identical": uid shown at both mains, same pinned repo commit, and the card a labeller sees
//                       (the census block without rank and tier line) byte-identical (rule 4);
//                     - "summary-only": same, except the card's first line (the summary text, changed by #49);
//                       the other card lines identical. Carried only in the D7 default tier, where all 10 are
//                       layering summaries that gained a wording change, by the lead's decision for this round.
//   ts/relabel/       a harness run of the default-tier uids whose card is new or otherwise changed (9), built like
//                     dev-v3's relabel/ sub-runs: run.json with `run` renamed, `relabel_of` added and `checkout` set to
//                     the shared read-only dev clones; queue.json filtered to those uids
//   ts/views/d7/      the part with decision D7's tier (eval/study/tier-d7.json) applied as a derived view, as
//                     dev-v3's view-d7.mjs does (member count = role size from proposals/<repo>.yaml)
// and stage.json: per tier, shown / carried (identical, summary-only) / to label / left unlabelled, the census
// `tier:` line check against D7, and the dev-v3 uids no longer shown.
// Suggestion-tier proposals whose card is new or changed are out of scope: unlabelled, so they count as WRONG in any
// all-shown figure; only the D7 default-tier figures of this run are complete.
// `batches` reads ts/relabel/prompts/index.json and writes batches.json: one batch per (labeller, repo) prompt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, checkTier, die, parseArgs, parseCensus, parseYaml, readJson, readJsonl, rubricText, ruleKind, sha256Text, tierMembers, tierOf } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const rel = (p) => relative(root, p);
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const PREV = join(here, "..", "dev-v3-2026-11-06", "ts");
const D7 = readJson(join(here, "..", "..", "tier-d7.json")).tier;
if (checkTier(D7).length) die(`tier-d7.json: ${checkTier(D7).join("; ")}`);
// The lead's list for this round: the D7 default-tier uids whose card is new or changed in more than its summary.
const EXPECTED = ["cal.com/D-c54406", "documenso/D-32c861", "documenso/D-a0eee5", "dub/D-345913", "infisical/D-c4efb8", "infisical/D-f674a5", "midday/D-50255f", "ai/D-fc5ef7", "supabase/D-c2e88c"];
const card = (block) => block.replace(/^\s*\d+\. /, ""); // what a labeller is shown (prompt.mjs stripRank)
const firstLine = (s) => s.split("\n")[0];
const restLines = (s) => s.split("\n").slice(1).join("\n");
const idOf = (s) => (firstLine(s).match(/^\[(D-[0-9a-f]+)\]/) ?? [])[1];

// Items with D7's tier, the member count read back from proposals/<repo>.yaml (view-d7.mjs).
function withD7(dir) {
  const queue = readJson(join(dir, "queue.json"));
  const yaml = new Map();
  const conv = (p) => {
    if (!yaml.has(p.repo)) {
      const f = join(dir, "proposals", `${p.repo}.yaml`);
      yaml.set(p.repo, new Map(existsSync(f) ? (parseYaml(readFileSync(f, "utf8"))?.conventions ?? []).map((c) => [c.id, c]) : []));
    }
    return yaml.get(p.repo).get(p.id);
  };
  return queue.items.map((p) => {
    const e = conv(p)?.evidence;
    const q = { ...p, members: tierMembers(e) ?? p.members, python_members: e?.python_members ?? p.python_members ?? null };
    return { ...q, tier: tierOf(q, D7) };
  });
}

if (cmd === "stage") {
  const v3sha = sha256Text(rubricText("v3"));
  if (v3sha !== APPROVED_RUBRIC.sha256) die(`RUBRIC-v3.md's labeller-facing text is not the approved one (${v3sha.slice(0, 12)})`);
  if (!args.cache) die("--cache is required (the outbox root's parent; a neutral path)");
  if (!args.checkouts) die("--checkouts is required (the shared read-only dev clones the labellers open)");
  const dir = join(here, "ts");
  const run = readJson(join(dir, "run.json"));
  const bad = run.repos.filter((r) => r.status !== "ok");
  if (bad.length) die(`ts: repos not ok: ${bad.map((r) => `${r.name} (${r.status})`).join(", ")}`);
  const items = withD7(dir);

  // The product's census tier line (fcec231 implements D7) against lib.mjs tierOf under D7.
  const censusTier = new Map();
  for (const r of run.repos) for (const p of parseCensus(readFileSync(join(dir, "proposals", `${r.name}.txt`), "utf8")).proposals) censusTier.set(`${r.name}/${p.id}`, p.census_tier ?? null);
  const tierMismatch = items.filter((p) => censusTier.get(p.uid) !== p.tier).map((p) => ({ uid: p.uid, census: censusTier.get(p.uid), d7: p.tier }));
  if (tierMismatch.length) die(`census tier line differs from D7's tierOf for ${tierMismatch.length} proposals`);

  // dev-v3's labels: rubric v3 (the approved text), pinned commits.
  const pRun = readJson(join(PREV, "run.json"));
  const pQueue = new Map(readJson(join(PREV, "queue.json")).items.map((p) => [p.uid, p]));
  const pFinal = new Map(readJsonl(join(PREV, "final.jsonl")).map((f) => [f.uid, f]));
  const pSha = new Map(pRun.repos.map((r) => [r.name, r.sha]));
  const sha = new Map(run.repos.map((r) => [r.name, r.sha]));
  const classify = (p) => {
    const o = pQueue.get(p.uid);
    if (!o) return "new";
    if (pSha.get(p.repo) !== sha.get(p.repo)) return "pin differs";
    const a = card(o.block), b = card(p.block);
    if (a === b) return "identical";
    if (idOf(a) === idOf(b) && restLines(a) === restLines(b) && firstLine(a) !== firstLine(b)) return "summary-only";
    return "changed";
  };
  const carried = [];
  const todo = [];
  const unlabelled = [];
  const rows = [];
  for (const p of items) {
    const st = classify(p);
    const f = pFinal.get(p.uid);
    const carry = f && f.rubric !== "v2" && (st === "identical" || (st === "summary-only" && p.tier === "default"));
    rows.push({ uid: p.uid, tier: p.tier, card: st, kind: ruleKind(p.rule) ?? null, action: carry ? "carried" : p.tier === "default" ? "relabel" : "unlabelled" });
    if (carry) {
      const { round, ...rest } = f;
      carried.push({ ...rest, source: "carried", carried_source: f.source, carried_from: rel(join(PREV, "final.jsonl")), carried_card: st, ...(round ? { carried_round: round } : {}), round: "2026-11-06 dev-v3" });
    } else if (p.tier === "default") todo.push(p);
    else unlabelled.push({ uid: p.uid, card: st });
  }
  const todoUids = todo.map((p) => p.uid).sort();
  if (JSON.stringify(todoUids) !== JSON.stringify([...EXPECTED].sort())) die(`default-tier uids to relabel differ from the lead's list:\n  got ${todoUids.join(" ")}\n  expected ${[...EXPECTED].sort().join(" ")}`);
  writeFileSync(join(dir, "carried.jsonl"), carried.map((f) => JSON.stringify(f)).join("\n") + (carried.length ? "\n" : ""));

  // relabel/: the 9 default-tier uids, labelled blind by A and B.
  const todoRepos = new Set(todo.map((p) => p.repo));
  const co = resolve(args.checkouts);
  const relItems = readJson(join(dir, "queue.json")).items.filter((p) => todoUids.includes(p.uid));
  const sub = {
    ...run,
    run: rel(join(dir, "relabel")),
    relabel_of: { run: run.run, uids: relItems.map((p) => p.uid), purpose: "rubric v3 blind relabel of the D7 default-tier TypeScript dev proposals whose card is new or changed (beyond summary text) at main fcec231 since runs/dev-v3-2026-11-06" },
    params: { ...run.params, cache: resolve(args.cache), checkouts: co }, // cache: prompt.mjs puts the outboxes in <cache>/outbox
    repos: run.repos.filter((r) => todoRepos.has(r.name)).map((r) => ({ ...r, checkout: join(co, r.name) })),
  };
  for (const r of sub.repos) if (!existsSync(join(r.checkout, ".git"))) die(`no checkout at ${r.checkout}`);
  mkdirSync(join(dir, "relabel"), { recursive: true });
  writeFileSync(join(dir, "relabel", "run.json"), JSON.stringify(sub, null, 2) + "\n");
  writeFileSync(join(dir, "relabel", "queue.json"), JSON.stringify({ run: sub.run, items: relItems }, null, 2) + "\n");

  // views/d7: D7's tier as a derived view (view-d7.mjs).
  const view = {
    ...run,
    run: rel(join(dir, "views", "d7")),
    params: { ...run.params, tier: D7, tier_pre_registered: false, tier_pre_registered_note: "derived view: decision D7's tier (eval/study/tier-d7.json) applied after the census; not pre-registered for this dev manifest" },
    view_of: { run: run.run, items: "all shown proposals", tier_from: "eval/study/tier-d7.json (decision D7), the tier the product ships and both primary held-out manifests hold" },
  };
  mkdirSync(join(dir, "views", "d7"), { recursive: true });
  writeFileSync(join(dir, "views", "d7", "run.json"), JSON.stringify(view, null, 2) + "\n");
  writeFileSync(join(dir, "views", "d7", "queue.json"), JSON.stringify({ run: view.run, items }, null, 2) + "\n");

  const tally = (tier) => {
    const r = rows.filter((x) => tier === "all" || x.tier === tier);
    const c = (f) => r.filter(f).length;
    return { shown: r.length, carried_identical: c((x) => x.action === "carried" && x.card === "identical"), carried_summary_only: c((x) => x.action === "carried" && x.card === "summary-only"), to_label: c((x) => x.action === "relabel"), unlabelled: c((x) => x.action === "unlabelled") };
  };
  const summary = {
    rubric: { version: "v3", sha256: v3sha },
    product: { commit: run.drift.commit, binary_sha256: run.drift.binary_sha256 },
    previous: { run: rel(PREV), commit: pRun.drift.commit },
    d7_tier: "eval/study/tier-d7.json",
    census_tier_vs_d7_mismatches: tierMismatch,
    default: tally("default"),
    suggestion: tally("suggestion"),
    all: tally("all"),
    relabel: todoUids,
    carried_summary_only: rows.filter((x) => x.action === "carried" && x.card === "summary-only").map((x) => x.uid),
    unlabelled_suggestion: unlabelled,
    previous_not_shown: [...pQueue.keys()].filter((u) => !items.some((p) => p.uid === u)),
    proposals: rows,
  };
  writeFileSync(join(here, "stage.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`ts: ${items.length} shown; D7 default ${summary.default.shown} (carried ${summary.default.carried_identical} identical + ${summary.default.carried_summary_only} summary-only, to label ${summary.default.to_label}); suggestion ${summary.suggestion.shown} (carried ${summary.suggestion.carried_identical}, unlabelled ${summary.suggestion.unlabelled}); census tier vs D7 mismatches ${tierMismatch.length}`);
} else if (cmd === "batches") {
  const out = { rule: "one batch = one (labeller, repo) prompt, launched as one fresh agent (README 'Launching'; REVIEWER-PROMPT.md 'Isolation'); A and B of one repo never at the same time", batches: [] };
  const sub = join(here, "ts", "relabel");
  const index = existsSync(join(sub, "prompts", "index.json")) ? readJson(join(sub, "prompts", "index.json")) : [];
  const queue = readJson(join(sub, "queue.json"));
  for (const r of readJson(join(sub, "run.json")).repos) {
    const n = queue.items.filter((p) => p.repo === r.name).length;
    for (const L of ["A", "B"]) {
      const e = index.find((x) => x.stage === "label" && x.labeller === L && x.repo === r.name);
      out.batches.push({ part: "ts", labeller: L, repo: r.name, proposals: n, prompt: e ? rel(e.prompt) : rel(join(sub, "prompts", "label", L, `${r.name}.md`)), output: e?.output ?? null, status: e ? (e.collected ? "collected" : "rendered") : "not rendered (prompt.mjs renders it once the other labeller's output for this repo is collected)" });
    }
  }
  writeFileSync(join(here, "batches.json"), JSON.stringify(out, null, 2) + "\n");
  for (const b of out.batches.filter((x) => x.output)) console.log(`${b.part} ${b.labeller} ${b.repo} (${b.proposals}): ${b.prompt} -> ${b.output}`);
} else die("usage: stage.mjs stage --checkouts DIR --cache DIR | stage.mjs batches");
