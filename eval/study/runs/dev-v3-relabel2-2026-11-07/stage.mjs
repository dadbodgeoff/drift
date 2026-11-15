// Stages the blind relabel, under rubric v3, of the TypeScript dev-set suggestion-tier proposals (decision D7) whose
// card is new or changed at main feefad6 since runs/dev-v3-2026-11-06 (labelled at main debc33a). The default tier
// carries over from runs/dev-v3-relabel-2026-11-06 (fcec231), which labelled it completely.
// Kept with the run as its record. Run from the root of the checkout, after prepare.mjs wrote ts/:
//
//   node eval/study/runs/dev-v3-relabel2-2026-11-07/stage.mjs stage --checkouts DIR --cache DIR
//   node eval/study/prompt.mjs label --run eval/study/runs/dev-v3-relabel2-2026-11-07/ts/relabel --labeller A --rubric v3
//   node eval/study/runs/dev-v3-relabel2-2026-11-07/stage.mjs batches
//
// `stage` reads ts/run.json and ts/queue.json (prepare.mjs output at feefad6; nothing in them changes), the dev-v3
// ts part (queue.json, final.jsonl) and the relabel-2026-11-06 ts part (queue.json, final.jsonl), and writes:
//   ts/carried.jsonl  labels carried over, in final.jsonl's row format with source "carried":
//                     - default tier: relabel-2026-11-06's ts/final.jsonl row (itself relabelled there or carried
//                       there from dev-v3), when the card is byte-identical to the one relabel-2026-11-06 queued
//                       (same pinned repo commit). Every default-tier card must be so, or the script stops;
//                     - suggestion tier: dev-v3's v3 final row, when the card a labeller sees (the census block
//                       without rank and tier line) is byte-identical to dev-v3's, at the same pin (rule 4).
//   ts/relabel/       a harness run of the suggestion-tier uids whose card is new or changed (summary-only changes
//                     included) since dev-v3, built like relabel-2026-11-06's relabel/: run.json with `run` renamed,
//                     `relabel_of` added and `checkout` set to the read-only dev clones; queue.json filtered to them.
//                     The set must equal relabel-2026-11-06's stage.json `unlabelled_suggestion` (53), or it stops.
//   ts/views/d7/      the part with decision D7's tier (eval/study/tier-d7.json) applied as a derived view, as
//                     dev-v3's view-d7.mjs does (member count = role size from proposals/<repo>.yaml)
// and stage.json: per tier, shown / carried / to label, the census `tier:` line check against D7, every card
// checked against relabel-2026-11-06's (the product did not change between fcec231 and feefad6), and the
// dev-v3 uids no longer shown.
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
const V3 = join(here, "..", "dev-v3-2026-11-06", "ts");
const R1DIR = join(here, "..", "dev-v3-relabel-2026-11-06");
const R1 = join(R1DIR, "ts");
const D7 = readJson(join(here, "..", "..", "tier-d7.json")).tier;
if (checkTier(D7).length) die(`tier-d7.json: ${checkTier(D7).join("; ")}`);
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
  if (!args.checkouts) die("--checkouts is required (the read-only dev clones the labellers open)");
  const dir = join(here, "ts");
  const run = readJson(join(dir, "run.json"));
  const bad = run.repos.filter((r) => r.status !== "ok");
  if (bad.length) die(`ts: repos not ok: ${bad.map((r) => `${r.name} (${r.status})`).join(", ")}`);
  const items = withD7(dir);

  // The product's census tier line against lib.mjs tierOf under D7.
  const censusTier = new Map();
  for (const r of run.repos) for (const p of parseCensus(readFileSync(join(dir, "proposals", `${r.name}.txt`), "utf8")).proposals) censusTier.set(`${r.name}/${p.id}`, p.census_tier ?? null);
  const tierMismatch = items.filter((p) => censusTier.get(p.uid) !== p.tier).map((p) => ({ uid: p.uid, census: censusTier.get(p.uid), d7: p.tier }));
  if (tierMismatch.length) die(`census tier line differs from D7's tierOf for ${tierMismatch.length} proposals`);

  const sha = new Map(run.repos.map((r) => [r.name, r.sha]));
  const load = (d) => ({
    sha: new Map(readJson(join(d, "run.json")).repos.map((r) => [r.name, r.sha])),
    commit: readJson(join(d, "run.json")).drift.commit,
    queue: new Map(readJson(join(d, "queue.json")).items.map((p) => [p.uid, p])),
    final: new Map(readJsonl(join(d, "final.jsonl")).map((f) => [f.uid, f])),
  });
  const v3 = load(V3);
  const r1 = load(R1);
  const r1Stage = readJson(join(R1DIR, "stage.json"));
  const classify = (prev, p) => {
    const o = prev.queue.get(p.uid);
    if (!o) return "new";
    if (prev.sha.get(p.repo) !== sha.get(p.repo)) return "pin differs";
    const a = card(o.block), b = card(p.block);
    if (a === b) return "identical";
    if (idOf(a) === idOf(b) && restLines(a) === restLines(b) && firstLine(a) !== firstLine(b)) return "summary-only";
    return "changed";
  };

  // The product did not change between fcec231 and feefad6: every shown card must equal relabel-2026-11-06's,
  // and the shown set must be the same. Otherwise the lead's scope (53 suggestion cards) no longer holds.
  const vsR1 = items.map((p) => ({ uid: p.uid, tier: p.tier, card: classify(r1, p) }));
  const notR1 = vsR1.filter((x) => x.card !== "identical");
  const r1Gone = [...r1.queue.keys()].filter((u) => !items.some((p) => p.uid === u));
  if (notR1.length || r1Gone.length) die(`cards differ from relabel-2026-11-06 (fcec231): ${notR1.map((x) => `${x.uid} (${x.tier}, ${x.card})`).join(", ")}${r1Gone.length ? `; no longer shown: ${r1Gone.join(", ")}` : ""}`);

  const carried = [];
  const todo = [];
  const rows = [];
  const round = "2026-11-07 dev-v3-relabel2";
  for (const p of items) {
    const st = classify(v3, p);
    if (p.tier === "default") {
      const f = r1.final.get(p.uid);
      if (!f || f.rubric !== "v3") die(`${p.uid}: default tier without a v3 label in relabel-2026-11-06`);
      const { round: fr, _src, ...rest } = f;
      carried.push({ ...rest, source: "carried", carried_source: f.source, carried_from: rel(join(R1, "final.jsonl")), carried_card: "identical", ...(f.source === "carried" ? { carried_origin: { source: f.carried_source, from: f.carried_from, card: f.carried_card } } : {}), ...(fr ? { carried_round: fr } : {}), round });
      rows.push({ uid: p.uid, tier: p.tier, card_vs_dev_v3: st, card_vs_relabel_2026_11_06: "identical", kind: ruleKind(p.rule) ?? null, action: "carried", carried_from: "relabel-2026-11-06" });
      continue;
    }
    const f = v3.final.get(p.uid);
    const carry = f && f.rubric === "v3" && st === "identical";
    rows.push({ uid: p.uid, tier: p.tier, card_vs_dev_v3: st, card_vs_relabel_2026_11_06: "identical", kind: ruleKind(p.rule) ?? null, action: carry ? "carried" : "relabel", ...(carry ? { carried_from: "dev-v3-2026-11-06" } : {}) });
    if (carry) {
      const { round: fr, _src, ...rest } = f;
      carried.push({ ...rest, source: "carried", carried_source: f.source, carried_from: rel(join(V3, "final.jsonl")), carried_card: st, ...(fr ? { carried_round: fr } : {}), round });
    } else todo.push(p);
  }
  const todoUids = todo.map((p) => p.uid).sort();
  const expected = r1Stage.unlabelled_suggestion.map((x) => x.uid).sort();
  if (JSON.stringify(todoUids) !== JSON.stringify(expected)) die(`suggestion-tier uids to relabel differ from relabel-2026-11-06's unlabelled list:\n  got ${todoUids.length}: ${todoUids.join(" ")}\n  expected ${expected.length}: ${expected.join(" ")}`);
  writeFileSync(join(dir, "carried.jsonl"), carried.map((f) => JSON.stringify(f)).join("\n") + (carried.length ? "\n" : ""));

  // relabel/: the suggestion-tier uids whose card is new or changed, labelled blind by A and B.
  const todoRepos = new Set(todo.map((p) => p.repo));
  const co = resolve(args.checkouts);
  const relItems = readJson(join(dir, "queue.json")).items.filter((p) => todoUids.includes(p.uid));
  const sub = {
    ...run,
    run: rel(join(dir, "relabel")),
    relabel_of: { run: run.run, uids: relItems.map((p) => p.uid), purpose: "rubric v3 blind relabel of the D7 suggestion-tier TypeScript dev proposals whose card is new or changed at main feefad6 since runs/dev-v3-2026-11-06" },
    params: { ...run.params, cache: resolve(args.cache), checkouts: co }, // cache: prompt.mjs puts the outboxes in <cache>/outbox
    repos: run.repos.filter((r) => todoRepos.has(r.name)).map((r) => ({ ...r, checkout: join(co, r.name) })),
  };
  for (const r of sub.repos) {
    if (!existsSync(join(r.checkout, ".git"))) die(`no checkout at ${r.checkout}`);
  }
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
    return { shown: r.length, carried_from_relabel_2026_11_06: c((x) => x.carried_from === "relabel-2026-11-06"), carried_from_dev_v3: c((x) => x.carried_from === "dev-v3-2026-11-06"), to_label: c((x) => x.action === "relabel"), to_label_new: c((x) => x.action === "relabel" && x.card_vs_dev_v3 === "new"), to_label_changed: c((x) => x.action === "relabel" && x.card_vs_dev_v3 !== "new") };
  };
  const perRepo = {};
  for (const p of todo) perRepo[p.repo] = (perRepo[p.repo] ?? 0) + 1;
  const summary = {
    rubric: { version: "v3", sha256: v3sha },
    product: { commit: run.drift.commit, binary_sha256: run.drift.binary_sha256, dirty: run.drift.dirty },
    previous: { dev_v3: { run: rel(V3), commit: v3.commit }, relabel_2026_11_06: { run: rel(R1), commit: r1.commit } },
    d7_tier: "eval/study/tier-d7.json",
    census_tier_vs_d7_mismatches: tierMismatch,
    cards_vs_relabel_2026_11_06: { identical: vsR1.length - notR1.length, differ: notR1, no_longer_shown: r1Gone },
    default: tally("default"),
    suggestion: tally("suggestion"),
    all: tally("all"),
    relabel: todoUids,
    relabel_per_repo: perRepo,
    previous_not_shown: [...v3.queue.keys()].filter((u) => !items.some((p) => p.uid === u)),
    proposals: rows,
  };
  writeFileSync(join(here, "stage.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`ts: ${items.length} shown, all ${vsR1.length - notR1.length} cards identical to relabel-2026-11-06; D7 default ${summary.default.shown} (carried from relabel-2026-11-06 ${summary.default.carried_from_relabel_2026_11_06}); suggestion ${summary.suggestion.shown} (carried from dev-v3 ${summary.suggestion.carried_from_dev_v3}, to label ${summary.suggestion.to_label}: ${summary.suggestion.to_label_new} new, ${summary.suggestion.to_label_changed} changed); census tier vs D7 mismatches ${tierMismatch.length}`);
  console.log(Object.entries(perRepo).map(([r, n]) => `${r} ${n}`).join(", "));
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
