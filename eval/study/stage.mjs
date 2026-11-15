// Stage a dev labelling round on any prepared run (or part of one): carry labels that still hold, build the
// relabel sub-run of the rest, and apply a tier as a derived view. It replaces the run-local stage.mjs and
// view-d7.mjs scripts of runs/dev-v3-2026-11-06 and runs/dev-v3-relabel-2026-11-06, which were hard-wired to
// their own runs. Dev runs only: a held-out run labels every shown proposal fresh, so it is refused.
//
//   node eval/study/stage.mjs stage --run DIR --checkouts DIR --cache DIR [options]
//     --tier FILE                 apply FILE's `tier` (e.g. eval/study/tier-d7.json) as a derived view in
//                                 <run>/views/<view>/ (run.json with tier_pre_registered: false, queue.json with
//                                 each item's tier); the member count and python_members are read back from
//                                 <run>/proposals/<repo>.yaml, as the product reads them
//     --view NAME                 the view's name (default: FILE's basename without "tier-" and ".json": d7)
//     --carry-from DIR            an earlier labelled run or part (final.jsonl, queue.json, run.json): carry its
//                                 final label of a uid when rule 4 allows it (below)
//     --carry-summary-only TIER   also carry, in TIER (default|suggestion) only, a card that differs from the
//                                 earlier one in its first (summary) line alone; a lead's decision, recorded in
//                                 stage.json and on each carried row (carried_card: "summary-only")
//     --relabel all|default|suggestion
//                                 which proposals that are not carried go to <run>/relabel/ (default: all); the
//                                 others stay unlabelled, so metrics.mjs counts them as WRONG
//     --expect-relabel uid,uid    stop unless the relabel set is exactly these uids (the lead's list)
//     --candidate-json DIR        `drift census --json --candidate <decision>` of each repo, <DIR>/<repo>.json, by the
//                                 run's binary: copies each proposal's `candidate.guards` into its item as `guards` (what
//                                 a tier with by_language.<lang>.call_wrappers "guards" reads, e.g. tier-d8-candidate.json),
//                                 and stops unless it lists the run's proposals, names the tier's decision and gives
//                                 every proposal the tier applied (the product and the study agree, failing closed)
//     --allow-tier-mismatch TEXT  record census `tier:` lines that differ from the tier applied (or are missing)
//                                 instead of stopping; TEXT says why (e.g. a view of a tier the product does not ship)
//     --purpose TEXT              recorded in relabel/run.json relabel_of.purpose
//     --round TEXT                recorded as `round` on each carried row (its earlier round, if any, as carried_round)
//   node eval/study/stage.mjs batches --run DIR   # <run>/batches.json: one batch per (labeller, repo) prompt
//   node eval/study/stage.mjs final --run DIR [--allow-incomplete TEXT]
//                                                 # <run>/final.jsonl = relabel/final.jsonl + carried.jsonl; refuses
//                                                 # while relabel/ lacks a complete A or B set (lib.mjs labelSetGaps)
//                                                 # unless --allow-incomplete TEXT, recorded in stage.json
//                                                 # `final_incomplete`
//
// Rule 4 (carry): a final label is carried only when the uid is shown now, the repo is pinned at the same commit,
// the card a labeller sees (the census block without its rank; parseCensus already drops the tier line) is
// byte-identical, and the label is under the approved rubric text (lib.mjs APPROVED_RUBRIC: its `rubric` is
// that version and its rubric_sha256, or, for a row that records none, the prompts that produced it, name the
// approved text). Anything else is relabelled or left unlabelled (--relabel).
//
// Writes <run>/carried.jsonl (final.jsonl's row format, source "carried"), <run>/relabel/{run,queue}.json (the
// run with `run` renamed, relabel_of added, params.cache (the outbox root's parent) and params.checkouts set,
// each repo's checkout set to <checkouts>/<repo>, verified at its pin and clean), <run>/views/<view>/ and
// <run>/stage.json. It refuses to restage once relabel/ has prompts. Then:
//
//   node eval/study/prompt.mjs label --run <run>/relabel --labeller A --rubric v3   ... (README steps 2-4)
//   node eval/study/stage.mjs final --run <run>
//   node eval/study/metrics.mjs --run <run>/views/<view> --labels <run>/final.jsonl --json ... > ...
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, LABELS, checkTier, completenessOverride, die, excludedRepos, labelSetGaps, parseArgs, parseCensus, parseYaml, readJson, readJsonl, rubricText, ruleKind, sha256Text, strip, tierMembers, tierOf } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const rel = (p) => {
  const r = relative(root, p);
  return r && !r.startsWith("..") ? r : p;
};
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const USAGE = "usage: stage.mjs stage --run DIR --checkouts DIR --cache DIR [--tier FILE] [--view NAME] [--candidate-json DIR] [--carry-from DIR] [--carry-summary-only TIER] [--relabel all|default|suggestion] [--expect-relabel uids] [--allow-tier-mismatch TEXT] | batches --run DIR | final --run DIR";
if (!["stage", "batches", "final"].includes(cmd) || !args.run) die(USAGE);
const dir = resolve(args.run);
const run = readJson(join(dir, "run.json"));
if (run.manifest?.holdout) die(`${args.run} is a HELD-OUT run: every shown proposal is labelled fresh (no carried labels, no relabel sub-run, no derived view)`);
const queue = readJson(join(dir, "queue.json"));
const sub = join(dir, "relabel");

// What a labeller is shown of a proposal (prompt.mjs stripRank).
const card = (block) => String(block).replace(/^\s*\d+\. /, "");
const firstLine = (s) => s.split("\n")[0];
const restLines = (s) => s.split("\n").slice(1).join("\n");
const idOf = (s) => (firstLine(s).match(/^\[(D-[0-9a-f]+)\]/) ?? [])[1];
function compareCard(a, b) {
  if (a === b) return "identical";
  if (idOf(a) && idOf(a) === idOf(b) && restLines(a) === restLines(b)) return "summary-only";
  return "changed";
}

// The rubric text a final row was labelled under: its rubric_sha256, else the one text of the label and
// adjudication prompts of the run that produced it (followed through carried_from for a carried row).
function rubricTextOf(row, sourceDir, depth = 0) {
  if (row.rubric_sha256) return row.rubric_sha256;
  if (depth > 5) return null;
  if (row.source === "carried" && row.carried_from) {
    const from = resolve(root, row.carried_from);
    const prev = existsSync(from) ? readJsonl(from).find((r) => r.uid === row.uid) : null;
    return prev ? rubricTextOf(prev, dirname(from), depth + 1) : null;
  }
  for (const idx of [join(sourceDir, "prompts", "index.json"), join(sourceDir, "relabel", "prompts", "index.json")]) {
    if (!existsSync(idx)) continue;
    const shas = [...new Set(readJson(idx).filter((e) => e.stage === "label" || e.stage === "adjudicate").map((e) => e.rubric_sha256 ?? null))];
    if (shas.length === 1 && shas[0]) return shas[0];
  }
  return null;
}

// Items with the tier applied: the view's (member count and python_members from proposals/<repo>.yaml) or the run's.
// `guards` (the product's word on whether every alternative of a call wrapper is a guard) comes from --candidate-json.
function tiered(tierDef, guardsOf = null) {
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
    const q = { ...p, members: tierMembers(e) ?? p.members, python_members: e?.python_members ?? p.python_members ?? null, ...(guardsOf ? { guards: guardsOf.get(p.uid)?.guards ?? null } : {}) };
    return { ...q, tier: tierOf(q, tierDef) };
  });
}

// --candidate-json DIR: each repo's `census --json --candidate` proposals, by uid, checked against the run's text census.
function candidateOf(jsonDir, decision) {
  const m = new Map();
  for (const r of run.repos) {
    const f = join(jsonDir, `${r.name}.json`);
    if (!existsSync(f)) die(`--candidate-json: ${f} is missing`);
    const j = readJson(f);
    const ids = (j.proposals ?? []).map((p) => p.id);
    const want = queue.items.filter((p) => p.repo === r.name).map((p) => p.id);
    if (JSON.stringify(ids) !== JSON.stringify(want)) die(`--candidate-json: ${f} lists other proposals than the run's census of ${r.name} (${ids.length} against ${want.length}): use the run's binary, --max and checkout`);
    for (const p of j.proposals) {
      if (p.candidate?.decision !== decision) die(`--candidate-json: ${r.name}/${p.id} has no candidate of decision ${decision} (census --json --candidate ${String(decision).toLowerCase()})`);
      m.set(`${r.name}/${p.id}`, { ...p.candidate, commit: j.commit ?? null });
    }
  }
  return m;
}

// GIT_OPTIONAL_LOCKS=0: `git status` never refreshes the index of a clone that must stay read-only.
const git = (d, ...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

if (cmd === "stage") {
  if (!args.cache) die("--cache is required (the outbox root's parent; a neutral path outside the repository)");
  if (!args.checkouts) die("--checkouts is required (the read-only clones the labellers open, <checkouts>/<repo>)");
  if (existsSync(join(sub, "prompts", "index.json"))) die(`${rel(sub)} already has prompts (labelling has started): it is never restaged; use a new run`);
  const v3sha = sha256Text(rubricText(APPROVED_RUBRIC.version));
  if (v3sha !== APPROVED_RUBRIC.sha256) die(`RUBRIC-${APPROVED_RUBRIC.version}.md's labeller-facing text is not the approved one (${v3sha.slice(0, 12)})`);
  const bad = run.repos.filter((r) => r.status !== "ok");
  if (bad.length) die(`repos not ok: ${bad.map((r) => `${r.name} (${r.status})`).join(", ")}`);
  const scope = args.relabel ?? "all";
  if (!["all", "default", "suggestion"].includes(scope)) die("--relabel all|default|suggestion");
  const summaryOnly = args.carrySummaryOnly ?? null;
  if (summaryOnly && !["default", "suggestion"].includes(summaryOnly)) die("--carry-summary-only default|suggestion");
  if (summaryOnly && !args.carryFrom) die("--carry-summary-only needs --carry-from");

  // ---- the tier: a derived view's, or the run's own ----
  let tierDef = run.params?.tier;
  let viewName = null;
  let tierFile = null;
  if (args.tier) {
    tierFile = resolve(args.tier);
    tierDef = readJson(tierFile).tier;
    viewName = args.view ?? basename(tierFile).replace(/^tier-/, "").replace(/\.json$/, "");
    if (!/^[A-Za-z0-9._-]+$/.test(viewName)) die(`--view ${JSON.stringify(viewName)}: use A-Z, a-z, 0-9, ".", "_" and "-"`);
  }
  if (!tierDef) die("the run has no params.tier: pass --tier FILE");
  if (checkTier(tierDef).length) die(`invalid tier: ${checkTier(tierDef).join("; ")}`);
  const needsGuards = Object.values(tierDef.default?.by_language ?? {}).some((o) => o?.call_wrappers === "guards");
  if (needsGuards && !args.candidateJson) die(`the tier admits a call wrapper only when every alternative is a guard, which only the product can tell: pass --candidate-json DIR (census --json --candidate ${String(tierDef.decision).toLowerCase()})`);
  const candidates = args.candidateJson ? candidateOf(resolve(args.candidateJson), tierDef.decision) : null;
  const items = tiered(tierDef, candidates);
  if (candidates) {
    const off = items.filter((p) => candidates.get(p.uid).tier !== p.tier);
    if (off.length) die(`the product's candidate tier differs from the tier applied for ${off.length} proposals, e.g. ${off[0].uid} (product ${candidates.get(off[0].uid).tier} ${candidates.get(off[0].uid).reason ?? ""}, applied ${off[0].tier})`);
  }
  const tierOfUid = new Map(items.map((p) => [p.uid, p.tier]));

  // ---- the product's census tier line against the tier applied ----
  const censusTier = new Map();
  for (const r of run.repos) {
    const f = join(dir, "proposals", `${r.name}.txt`);
    if (!existsSync(f)) die(`${rel(f)} is missing`);
    for (const p of parseCensus(readFileSync(f, "utf8")).proposals) censusTier.set(`${r.name}/${p.id}`, p.census_tier ?? null);
  }
  const tierMismatch = items.filter((p) => censusTier.get(p.uid) !== p.tier).map((p) => ({ uid: p.uid, census: censusTier.get(p.uid) ?? null, applied: p.tier }));
  if (tierMismatch.length && !args.allowTierMismatch)
    die(`the census tier line differs from the tier applied (or is missing) for ${tierMismatch.length} proposals, e.g. ${tierMismatch[0].uid} (census ${tierMismatch[0].census}, applied ${tierMismatch[0].applied}); pass --allow-tier-mismatch TEXT to record them instead`);

  // ---- carry (rule 4) ----
  const carried = [];
  const notCarried = [];
  const cardOf = new Map();
  let carrySource = null;
  if (args.carryFrom) {
    const src = resolve(args.carryFrom);
    const pRun = readJson(join(src, "run.json"));
    if (pRun.manifest?.holdout) die("--carry-from names a held-out run");
    const pQueue = new Map(readJson(join(src, "queue.json")).items.map((p) => [p.uid, p]));
    const pFinal = readJsonl(join(src, "final.jsonl"));
    const pSha = new Map(pRun.repos.map((r) => [r.name, r.sha]));
    const sha = new Map(run.repos.map((r) => [r.name, r.sha]));
    const now = new Map(queue.items.map((p) => [p.uid, p]));
    carrySource = { run: rel(src), commit: pRun.drift?.commit ?? null, final: rel(join(src, "final.jsonl")) };
    const seen = new Set();
    for (const f of pFinal) {
      if (seen.has(f.uid)) die(`${rel(join(src, "final.jsonl"))}: two rows for ${f.uid}`);
      seen.add(f.uid);
      const p = now.get(f.uid);
      const o = pQueue.get(f.uid);
      let why = null;
      let st = null;
      if (!p) why = "not shown now";
      else if (!o) why = "not in the earlier queue";
      else if (!LABELS.includes(f.label)) why = `label ${JSON.stringify(f.label)}`;
      else if (f.rubric !== APPROVED_RUBRIC.version) why = `label rubric ${f.rubric ?? "not recorded"}`;
      else if (rubricTextOf(f, src) !== APPROVED_RUBRIC.sha256) why = `rubric text ${rubricTextOf(f, src)?.slice(0, 12) ?? "not recorded"}, not the approved one`;
      else if (pSha.get(f.repo ?? p.repo) !== sha.get(p.repo)) why = "repo pin differs";
      else {
        st = compareCard(card(o.block), card(p.block));
        cardOf.set(f.uid, st);
        if (st === "changed") why = "card changed";
        else if (st === "summary-only" && summaryOnly !== tierOfUid.get(f.uid)) why = "card summary changed";
      }
      if (why) {
        notCarried.push({ uid: f.uid, why });
        continue;
      }
      const { round, ...row } = strip(f);
      carried.push({ ...row, source: "carried", carried_source: f.source, carried_from: rel(join(src, "final.jsonl")), carried_card: st, ...(round ? { carried_round: round } : {}), ...(args.round ? { round: args.round } : {}) });
    }
    for (const p of queue.items) if (!cardOf.has(p.uid)) cardOf.set(p.uid, pQueue.has(p.uid) ? (pSha.get(p.repo) !== sha.get(p.repo) ? "pin differs" : compareCard(card(pQueue.get(p.uid).block), card(p.block))) : "new");
  }
  const carriedUids = new Set(carried.map((f) => f.uid));
  const inScope = (p) => scope === "all" || tierOfUid.get(p.uid) === scope;
  const todo = queue.items.filter((p) => !carriedUids.has(p.uid) && inScope(p));
  const unlabelled = queue.items.filter((p) => !carriedUids.has(p.uid) && !inScope(p));
  const todoUids = todo.map((p) => p.uid);
  if (args.expectRelabel !== undefined) {
    const want = String(args.expectRelabel).split(",").map((s) => s.trim()).filter(Boolean).sort();
    if (JSON.stringify([...todoUids].sort()) !== JSON.stringify(want)) die(`the uids to relabel differ from --expect-relabel:\n  got      ${[...todoUids].sort().join(" ")}\n  expected ${want.join(" ")}`);
  }

  // ---- relabel/: the uids to label in this round, on the read-only clones ----
  const co = resolve(args.checkouts);
  const todoRepos = new Set(todo.map((p) => p.repo));
  const subRepos = run.repos.filter((r) => todoRepos.has(r.name)).map((r) => ({ ...r, checkout: join(co, r.name) }));
  for (const r of subRepos) {
    if (!existsSync(join(r.checkout, ".git"))) die(`no checkout at ${r.checkout}`);
    const head = git(r.checkout, "rev-parse", "HEAD").stdout.trim();
    if (head !== r.sha) die(`${r.checkout} is at ${head.slice(0, 12)}, not the pinned ${r.sha.slice(0, 12)}`);
    const st = git(r.checkout, "status", "--porcelain", "--ignored", "--untracked-files=all").stdout.trim();
    if (st) die(`${r.checkout} is not clean (modified, untracked or ignored files): labellers must open the repo at its pin`);
  }
  writeFileSync(join(dir, "carried.jsonl"), carried.map((f) => JSON.stringify(f)).join("\n") + (carried.length ? "\n" : ""));
  if (todo.length) {
    const subRun = {
      ...run,
      run: rel(sub),
      relabel_of: { run: run.run, uids: todoUids, purpose: args.purpose ?? `labelling round: the proposals of ${run.run} ${args.carryFrom ? `not carried from ${carrySource.run}` : "shown"}${scope === "all" ? "" : `, ${scope} tier only`}` },
      params: { ...run.params, cache: resolve(args.cache), checkouts: co }, // cache: prompt.mjs puts the outboxes in <cache>/outbox
      repos: subRepos,
    };
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "run.json"), JSON.stringify(subRun, null, 2) + "\n");
    writeFileSync(join(sub, "queue.json"), JSON.stringify({ run: subRun.run, items: todo }, null, 2) + "\n");
  }

  // ---- views/<name>/: the tier as a derived view ----
  if (viewName) {
    const vdir = join(dir, "views", viewName);
    const view = {
      ...run,
      run: rel(vdir),
      params: { ...run.params, tier: tierDef, tier_pre_registered: false, tier_pre_registered_note: `derived view: ${rel(tierFile)}'s tier${tierDef.decision ? ` (decision ${tierDef.decision})` : ""} applied after the census; not pre-registered for this dev manifest` },
      view_of: { run: run.run, items: "all shown proposals", tier_from: rel(tierFile) },
    };
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, "run.json"), JSON.stringify(view, null, 2) + "\n");
    writeFileSync(join(vdir, "queue.json"), JSON.stringify({ run: view.run, items }, null, 2) + "\n");
  }

  const action = (p) => (carriedUids.has(p.uid) ? "carried" : inScope(p) ? "relabel" : "unlabelled");
  const rows = items.map((p) => ({ uid: p.uid, tier: p.tier, kind: ruleKind(p.rule) ?? null, ...(candidates ? { reason: candidates.get(p.uid).reason ?? null, guards: p.guards } : {}), ...(args.carryFrom ? { card: cardOf.get(p.uid) } : {}), action: action(p) }));
  const tally = (t) => {
    const r = rows.filter((x) => t === "all" || x.tier === t);
    const c = (f) => r.filter(f).length;
    return { shown: r.length, carried: c((x) => x.action === "carried"), carried_summary_only: c((x) => x.action === "carried" && x.card === "summary-only"), to_label: c((x) => x.action === "relabel"), unlabelled: c((x) => x.action === "unlabelled") };
  };
  const summary = {
    run: run.run,
    rubric: { version: APPROVED_RUBRIC.version, sha256: v3sha },
    product: { commit: run.drift?.commit ?? null, binary_sha256: run.drift?.binary_sha256 ?? null },
    tier: tierFile ? { from: rel(tierFile), decision: tierDef.decision ?? null, view: rel(join(dir, "views", viewName)) } : { from: "run.json params.tier", decision: tierDef.decision ?? null, view: null },
    ...(candidates ? { candidate_json: { dir: rel(resolve(args.candidateJson)), commits: [...new Set([...candidates.values()].map((c) => c.commit))], agrees: items.length } } : {}),
    census_tier_mismatches: tierMismatch,
    ...(tierMismatch.length ? { census_tier_mismatches_allowed: args.allowTierMismatch } : {}),
    carry_from: carrySource,
    carry_summary_only: summaryOnly,
    relabel_scope: scope,
    default: tally("default"),
    suggestion: tally("suggestion"),
    all: tally("all"),
    relabel: todoUids,
    unlabelled: unlabelled.map((p) => p.uid),
    not_carried: notCarried,
    repos: run.repos.map((r) => {
      const mine = rows.filter((x) => x.uid.startsWith(`${r.name}/`));
      return { repo: r.name, shown: mine.length, carried: mine.filter((x) => x.action === "carried").length, to_label: mine.filter((x) => x.action === "relabel").length, unlabelled: mine.filter((x) => x.action === "unlabelled").length };
    }),
    proposals: rows,
  };
  writeFileSync(join(dir, "stage.json"), JSON.stringify(summary, null, 2) + "\n");
  const s = (t) => `${t.shown} (carried ${t.carried}${t.carried_summary_only ? `, ${t.carried_summary_only} summary-only` : ""}, to label ${t.to_label}, unlabelled ${t.unlabelled})`;
  console.log(`${run.run}: ${items.length} shown; default ${s(summary.default)}; suggestion ${s(summary.suggestion)}; relabel ${todo.length} in ${subRepos.length} repos${todo.length ? ` -> ${rel(sub)}` : " (nothing to label)"}; census tier mismatches ${tierMismatch.length}${viewName ? `; view ${rel(join(dir, "views", viewName))}` : ""}`);
} else if (cmd === "batches") {
  if (!existsSync(join(sub, "run.json"))) die(`${rel(sub)} does not exist: run stage first (or nothing was left to label)`);
  const out = { rule: "one batch = one (labeller, repo) prompt, launched as one fresh agent (README 'Launching'; REVIEWER-PROMPT.md 'Isolation'); A and B of one repo never at the same time", batches: [] };
  const index = existsSync(join(sub, "prompts", "index.json")) ? readJson(join(sub, "prompts", "index.json")) : [];
  const sq = readJson(join(sub, "queue.json"));
  for (const r of readJson(join(sub, "run.json")).repos) {
    const n = sq.items.filter((p) => p.repo === r.name).length;
    for (const L of ["A", "B"]) {
      const e = index.find((x) => x.stage === "label" && x.labeller === L && x.repo === r.name);
      out.batches.push({ labeller: L, repo: r.name, proposals: n, prompt: e ? rel(e.prompt) : rel(join(sub, "prompts", "label", L, `${r.name}.md`)), output: e?.output ?? null, status: e ? (e.collected ? "collected" : "rendered") : "not rendered (prompt.mjs renders it once the other labeller's output for this repo is collected)" });
    }
  }
  writeFileSync(join(dir, "batches.json"), JSON.stringify(out, null, 2) + "\n");
  for (const b of out.batches.filter((x) => x.output)) console.log(`${b.labeller} ${b.repo} (${b.proposals}): ${b.prompt} -> ${b.output}`);
  console.error(`${out.batches.length} batches -> ${rel(join(dir, "batches.json"))}`);
} else {
  // final: the round's final labels, each shown uid at most once.
  const carriedPath = join(dir, "carried.jsonl");
  if (!existsSync(carriedPath)) die("run stage first (carried.jsonl is missing)");
  const carried = readJsonl(carriedPath);
  let labelled = [];
  let incomplete = null;
  if (existsSync(join(sub, "queue.json"))) {
    const subQueue = readJson(join(sub, "queue.json"));
    incomplete = completenessOverride(labelSetGaps(sub, subQueue, { skipRepos: excludedRepos(sub) }), args.allowIncomplete, `stage.mjs final (${rel(sub)})`);
    const want = subQueue.items.map((p) => p.uid);
    const f = join(sub, "final.jsonl");
    if (!existsSync(f)) die(`${rel(f)} is missing: finish the round (adjudicate.mjs --run ${rel(sub)} --merge) first`);
    labelled = readJsonl(f);
    const got = new Set(labelled.map((r) => r.uid));
    const missing = want.filter((u) => !got.has(u));
    if (missing.length) die(`${rel(f)} lacks ${missing.length} of the relabel uids, e.g. ${missing.slice(0, 3).join(", ")}`);
  }
  const shown = new Set(queue.items.map((p) => p.uid));
  const seen = new Set();
  for (const r of [...labelled, ...carried]) {
    if (!shown.has(r.uid)) die(`${r.uid} is not shown in ${run.run}`);
    if (seen.has(r.uid)) die(`${r.uid} is both relabelled and carried (or twice in one file)`);
    if (r.rubric !== APPROVED_RUBRIC.version) die(`${r.uid}: rubric ${r.rubric ?? "not recorded"}, not ${APPROVED_RUBRIC.version}`);
    seen.add(r.uid);
  }
  const rows = [...labelled, ...carried].map(strip);
  const stPath = join(dir, "stage.json");
  if (incomplete && !existsSync(stPath)) die("stage.json is missing: cannot record --allow-incomplete");
  writeFileSync(join(dir, "final.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  // The override is recorded with the staging (and dropped once a later final is complete).
  const st = existsSync(stPath) ? readJson(stPath) : null;
  if (st && (incomplete || st.final_incomplete)) {
    const { final_incomplete: _prev, ...rest } = st;
    writeFileSync(stPath, JSON.stringify({ ...rest, ...(incomplete ? { final_incomplete: { ...incomplete, rows: rows.length } } : {}) }, null, 2) + "\n");
  }
  if (incomplete) console.log(`INCOMPLETE A/B label sets (--allow-incomplete: ${incomplete.reason}), recorded in ${rel(stPath)}: ${incomplete.gaps.join("; ")}`);
  const by = rows.reduce((o, r) => ((o[r.source] = (o[r.source] ?? 0) + 1), o), {});
  console.log(`${rows.length} final labels -> ${rel(join(dir, "final.jsonl"))} (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}); ${queue.items.length - rows.length} of ${queue.items.length} shown unlabelled`);
}
