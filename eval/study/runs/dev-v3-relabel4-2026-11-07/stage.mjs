// Stages the blind relabel, under rubric v3, of the dev cards that the round-5 merge train (#70-#83) changed, at
// main 88d4030, on all three dev parts (ts, py, py2). Labels nothing. Kept with the run as its record, modelled on
// runs/dev-v3-relabel2-2026-11-07/stage.mjs; run from the root of the checkout, after prepare.mjs wrote <part>/:
//
//   node eval/study/runs/dev-v3-relabel3-2026-11-07/stage.mjs stage --checkouts-ts DIR --checkouts-py DIR \
//     --checkouts-py2 DIR --cache DIR
//   for P in <parts with relabel/>; do node eval/study/prompt.mjs label --run eval/study/runs/dev-v3-relabel3-2026-11-07/$P/relabel --labeller A --rubric v3; done
//   node eval/study/runs/dev-v3-relabel3-2026-11-07/stage.mjs batches
//   (after labelling)  node eval/study/stage.mjs final --run eval/study/runs/dev-v3-relabel3-2026-11-07/<part>
//
// The newest label of each shown uid is looked up in these runs, newest first:
//   ts:  dev-v3-relabel2-2026-11-07/ts (final.jsonl: its relabelled and carried rows), dev-v3-relabel-2026-11-06/ts,
//        dev-v3-2026-11-06/ts
//   py:  dev-v3-2026-11-06/py        py2: dev-v3-2026-11-06/py2
// and the card is compared with the card of THAT run's census (its queue.json block, its views/d7 tier).
//
// Carry rule (the lead's decision, tightened 2026-11-07; recorded on every row):
//   a label is carried when the uid is shown now, its repo is at the same pin, the label is v3 at the approved
//   rubric text, and the card a labeller sees (the census block without its rank) is byte-identical to the labelled
//   one except for the lift figure of its evidence line. Every other line, the example included, must be the same,
//   in the same order. Otherwise the card is relabelled:
//     "new"             no earlier label for the uid;
//     "outliers"        an outlier added or removed (a card that now lists none is still relabelled while shown);
//     "tier"            the D7 tier changed;
//     "other"           outliers and tier unchanged, but another line changed (summary, holders/total or lower
//                       bound, split, exempt or any other line, or the outlier order);
//     "example"         only the example line changed (besides lift);
//     "pin" / "rubric"  the earlier label cannot carry at all.
//
// Writes, per part: <part>/carried.jsonl (final.jsonl's row format, source "carried", with carried_from,
// carried_card and carried_reason), <part>/relabel/{run,queue}.json (the uids to label; checkouts = the read-only
// dev clones, each verified at its pin and clean), <part>/views/d7/{run,queue}.json (decision D7 as a derived view);
// and stage.json. Earlier labels of the cards to relabel are NOT written anywhere in this run (blinding).
// `batches` writes batches.json: one batch per (labeller, repo) prompt.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, LABELS, checkTier, die, parseArgs, parseCensus, parseYaml, readJson, readJsonl, rubricText, ruleKind, sha256Text, strip, tierMembers, tierOf } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const rel = (p) => {
  const r = relative(root, p);
  return r && !r.startsWith("..") ? r : p;
};
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const RUNS = join(here, "..");
const PARTS = ["ts", "py", "py2"];
// A copy of this script in another run directory (restage.sh) may list newer label runs in <run>/sources.json,
// { "ts": [...], "py": [...], "py2": [...] }, newest first, run directories relative to eval/study/runs/.
const SOURCES = existsSync(join(here, "sources.json"))
  ? readJson(join(here, "sources.json"))
  : {
      ts: ["dev-v3-relabel2-2026-11-07/ts", "dev-v3-relabel-2026-11-06/ts", "dev-v3-2026-11-06/ts"],
      py: ["dev-v3-2026-11-06/py"],
      py2: ["dev-v3-2026-11-06/py2"],
    };
const RUN_NAME = here.split(/[\\/]/).pop();
const ROUND = RUN_NAME === "dev-v3-relabel3-2026-11-07" ? "2026-11-07 dev-v3-relabel3" : RUN_NAME;
const D7FILE = join(here, "..", "..", "tier-d7.json");
const D7 = readJson(D7FILE).tier;
if (checkTier(D7).length) die(`tier-d7.json: ${checkTier(D7).join("; ")}`);
const card = (block) => String(block).replace(/^\s*\d+\. /, ""); // what a labeller is shown (prompt.mjs stripRank)
// The card with its lift figure blanked: the only part allowed to differ for a label to carry.
const noLift = (s) => s.replace(/^(\s+evidence:\s+\d+\/\d+ \(lower bound [\d.]+, lift )[\d.]+\)/m, "$1#)");
const git = (d, ...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

// Items with D7's tier, the member count read back from proposals/<repo>.yaml (as stage.mjs and view-d7.mjs do).
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

// The rubric text a final row was labelled under (eval/study/stage.mjs rubricTextOf).
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

// A card split into what the carry rule compares. Lines are classified as parseCensus reads them.
function parts(block) {
  const lines = card(block).split("\n");
  const out = { summary: lines[0], evidence: null, lift: null, example: null, outliers: [], other: [] };
  for (const l of lines.slice(1)) {
    let k;
    if ((k = l.match(/^(\s+evidence:\s+\d+\/\d+ \(lower bound [\d.]+), lift ([\d.]+)\)(.*)$/))) {
      out.evidence = k[1] + k[3];
      out.lift = k[2];
    } else if (/^\s+example:\s+/.test(l)) out.example = l.trim();
    else if (/^\s+outlier:\s+/.test(l)) out.outliers.push(l.trim().replace(/^outlier:\s+/, ""));
    else out.other.push(l);
  }
  out.outliers.sort();
  return out;
}
function diff(a, b) {
  const x = parts(a), y = parts(b);
  const added = y.outliers.filter((o) => !x.outliers.includes(o));
  const removed = x.outliers.filter((o) => !y.outliers.includes(o));
  return {
    outliers_added: added,
    outliers_removed: removed,
    outliers_before: x.outliers.length,
    outliers_now: y.outliers.length,
    summary: x.summary !== y.summary,
    evidence: x.evidence !== y.evidence,
    lift: x.lift !== y.lift ? [x.lift, y.lift] : null,
    example: x.example !== y.example ? [x.example, y.example] : null,
    other: JSON.stringify(x.other) !== JSON.stringify(y.other),
  };
}

if (cmd === "stage") {
  const v3sha = sha256Text(rubricText(APPROVED_RUBRIC.version));
  if (v3sha !== APPROVED_RUBRIC.sha256) die(`RUBRIC-${APPROVED_RUBRIC.version}.md's labeller-facing text is not the approved one (${v3sha.slice(0, 12)})`);
  if (!args.cache) die("--cache is required (the outbox root's parent; a neutral path outside the repository)");
  const summary = { run: rel(here), rubric: { version: APPROVED_RUBRIC.version, sha256: v3sha }, product: null, label_sources: SOURCES, d7_tier: rel(D7FILE), carry_rule: "carried when the labeller-visible card is byte-identical except for its rank and lift figure, and the D7 tier is unchanged (the lead's decision, tightened 2026-11-07: a changed example relabels)", parts: {} };
  for (const part of PARTS) {
    const dir = join(here, part);
    const co = args[`checkouts${part[0].toUpperCase()}${part.slice(1)}`];
    if (!co) die(`--checkouts-${part} is required (the read-only dev clones the labellers open)`);
    if (existsSync(join(dir, "relabel", "prompts", "index.json"))) die(`${part}/relabel already has prompts (labelling has started): never restaged`);
    const run = readJson(join(dir, "run.json"));
    const bad = run.repos.filter((r) => r.status !== "ok");
    if (bad.length) die(`${part}: repos not ok: ${bad.map((r) => `${r.name} (${r.status})`).join(", ")}`);
    summary.product ??= { commit: run.drift.commit, binary_sha256: run.drift.binary_sha256, dirty: run.drift.dirty };
    if (run.drift.binary_sha256 !== summary.product.binary_sha256) die(`${part}: another binary than the other parts`);
    const items = withD7(dir);

    // The product's census tier line against lib.mjs tierOf under D7.
    const censusTier = new Map();
    for (const r of run.repos) for (const p of parseCensus(readFileSync(join(dir, "proposals", `${r.name}.txt`), "utf8")).proposals) censusTier.set(`${r.name}/${p.id}`, p.census_tier ?? null);
    const tierMismatch = items.filter((p) => censusTier.get(p.uid) !== p.tier).map((p) => ({ uid: p.uid, census: censusTier.get(p.uid) ?? null, d7: p.tier }));
    if (tierMismatch.length) die(`${part}: census tier line differs from D7's tierOf for ${tierMismatch.length} proposals, e.g. ${tierMismatch[0].uid}`);

    const sha = new Map(run.repos.map((r) => [r.name, r.sha]));
    const sources = SOURCES[part].map((s) => {
      const d = join(RUNS, s);
      const view = join(d, "views", "d7", "queue.json");
      return {
        name: s,
        dir: d,
        commit: readJson(join(d, "run.json")).drift.commit,
        sha: new Map(readJson(join(d, "run.json")).repos.map((r) => [r.name, r.sha])),
        queue: new Map(readJson(join(d, "queue.json")).items.map((p) => [p.uid, p])),
        tier: new Map(readJson(view).items.map((p) => [p.uid, p.tier])),
        final: new Map(readJsonl(join(d, "final.jsonl")).map((f) => [f.uid, f])),
      };
    });
    const carried = [];
    const todo = [];
    const rows = [];
    for (const p of items) {
      const src = sources.find((s) => s.final.has(p.uid));
      const base = { uid: p.uid, tier: p.tier, kind: ruleKind(p.rule) ?? null };
      if (!src) {
        rows.push({ ...base, label_from: null, action: "relabel", reason: "new" });
        todo.push(p);
        continue;
      }
      const f = src.final.get(p.uid);
      const o = src.queue.get(p.uid);
      let reason = null;
      let d = null;
      if (!o) die(`${p.uid}: labelled in ${src.name} but not in its queue`);
      if (!LABELS.includes(f.label) || f.rubric !== APPROVED_RUBRIC.version || rubricTextOf(f, src.dir) !== APPROVED_RUBRIC.sha256) reason = "rubric";
      else if (src.sha.get(p.repo) !== sha.get(p.repo)) reason = "pin";
      else {
        d = diff(o.block, p.block);
        const oldTier = src.tier.get(p.uid);
        if (d.outliers_added.length || d.outliers_removed.length) reason = "outliers";
        else if (oldTier !== p.tier) reason = "tier";
        else if (d.summary || d.evidence || d.other) reason = "other";
        else if (d.example) reason = "example";
        else if (noLift(card(o.block)) !== noLift(card(p.block))) reason = "other"; // e.g. the outliers in another order
        d.tier_before = oldTier;
      }
      const changed = d ? [d.lift ? "lift" : null, d.example ? "example" : null, o.rank !== p.rank ? "rank" : null].filter(Boolean) : [];
      const cardStatus = !d ? null : card(o.block) === card(p.block) ? "identical" : reason ? "changed" : `differs only in ${changed.join(", ")}`;
      const detail = d ? { tier_before: d.tier_before, rank_before: o.rank, rank_now: p.rank, outliers_before: d.outliers_before, outliers_now: d.outliers_now, outliers_added: d.outliers_added.length, outliers_removed: d.outliers_removed.length, summary_changed: d.summary, evidence_changed: d.evidence, other_lines_changed: d.other, lift: d.lift, example_changed: Boolean(d.example) } : null;
      if (reason) {
        rows.push({ ...base, label_from: src.name, card: cardStatus, ...detail, action: "relabel", reason });
        todo.push(p);
        continue;
      }
      const { round, _src, ...row } = strip(f);
      const why = cardStatus === "identical" ? "card identical" : `card ${cardStatus} (every other line byte-identical, D7 tier unchanged)`;
      carried.push({ ...row, source: "carried", carried_source: f.source, carried_from: rel(join(src.dir, "final.jsonl")), carried_card: cardStatus, carried_reason: why, ...(round ? { carried_round: round } : {}), round: ROUND });
      rows.push({ ...base, label_from: src.name, card: cardStatus, ...detail, action: "carried", reason: why });
    }
    writeFileSync(join(dir, "carried.jsonl"), carried.map((f) => JSON.stringify(f)).join("\n") + (carried.length ? "\n" : ""));

    // relabel/: the uids to label, on the read-only dev clones (verified at their pin and clean).
    const todoUids = todo.map((p) => p.uid);
    const todoRepos = new Set(todo.map((p) => p.repo));
    const subRepos = run.repos.filter((r) => todoRepos.has(r.name)).map((r) => ({ ...r, checkout: join(resolve(co), r.name) }));
    for (const r of subRepos) {
      if (!existsSync(join(r.checkout, ".git"))) die(`no checkout at ${r.checkout}`);
      const head = git(r.checkout, "rev-parse", "HEAD").stdout.trim();
      if (head !== r.sha) die(`${r.checkout} is at ${head.slice(0, 12)}, not the pinned ${r.sha.slice(0, 12)}`);
      const st = git(r.checkout, "status", "--porcelain", "--ignored", "--untracked-files=all").stdout.trim();
      if (st) die(`${r.checkout} is not clean (modified, untracked or ignored files): labellers must open the repo at its pin`);
    }
    if (todo.length) {
      const relItems = readJson(join(dir, "queue.json")).items.filter((p) => todoUids.includes(p.uid));
      const sub = {
        ...run,
        run: rel(join(dir, "relabel")),
        relabel_of: { run: run.run, uids: relItems.map((p) => p.uid), purpose: `rubric v3 blind relabel of the ${part} dev proposals whose card is new, or whose outliers, D7 tier or other lines changed, at main ${String(run.drift.commit).slice(0, 7)} since their newest label` },
        params: { ...run.params, cache: resolve(args.cache), checkouts: resolve(co) }, // cache: prompt.mjs puts the outboxes in <cache>/outbox
        repos: subRepos,
      };
      mkdirSync(join(dir, "relabel"), { recursive: true });
      writeFileSync(join(dir, "relabel", "run.json"), JSON.stringify(sub, null, 2) + "\n");
      writeFileSync(join(dir, "relabel", "queue.json"), JSON.stringify({ run: sub.run, items: relItems }, null, 2) + "\n");
    }

    // views/d7: D7's tier as a derived view.
    const view = {
      ...run,
      run: rel(join(dir, "views", "d7")),
      params: { ...run.params, tier: D7, tier_pre_registered: false, tier_pre_registered_note: "derived view: decision D7's tier (eval/study/tier-d7.json) applied after the census; not pre-registered for this dev manifest" },
      view_of: { run: run.run, items: "all shown proposals", tier_from: "eval/study/tier-d7.json (decision D7), the tier the product ships and both primary held-out manifests hold" },
    };
    mkdirSync(join(dir, "views", "d7"), { recursive: true });
    writeFileSync(join(dir, "views", "d7", "run.json"), JSON.stringify(view, null, 2) + "\n");
    writeFileSync(join(dir, "views", "d7", "queue.json"), JSON.stringify({ run: view.run, items }, null, 2) + "\n");

    const tally = (t) => {
      const r = rows.filter((x) => t === "all" || x.tier === t);
      const c = (fn) => r.filter(fn).length;
      return { shown: r.length, carried: c((x) => x.action === "carried"), carried_identical: c((x) => x.action === "carried" && x.card === "identical"), carried_lift_rank: c((x) => x.action === "carried" && x.card !== "identical"), to_label: c((x) => x.action === "relabel"), to_label_by_reason: Object.fromEntries(["new", "outliers", "tier", "other", "example", "pin", "rubric"].map((k) => [k, c((x) => x.action === "relabel" && x.reason === k)])) };
    };
    const perRepo = {};
    for (const p of todo) perRepo[p.repo] = (perRepo[p.repo] ?? 0) + 1;
    const labelled = new Set(sources.flatMap((s) => [...s.final.keys()]));
    summary.parts[part] = {
      run: run.run,
      label_sources: sources.map((s) => ({ run: rel(s.dir), commit: s.commit, labels: s.final.size })),
      census_tier_vs_d7_mismatches: tierMismatch,
      default: tally("default"),
      suggestion: tally("suggestion"),
      all: tally("all"),
      relabel: todoUids,
      relabel_per_repo: perRepo,
      labelled_not_shown: [...labelled].filter((u) => !items.some((p) => p.uid === u)).sort(),
      proposals: rows,
    };
    console.log(`${part}: ${items.length} shown; default ${summary.parts[part].default.shown} (carried ${summary.parts[part].default.carried}, to label ${summary.parts[part].default.to_label}); suggestion ${summary.parts[part].suggestion.shown} (carried ${summary.parts[part].suggestion.carried}, to label ${summary.parts[part].suggestion.to_label}); relabel ${todo.length}: ${JSON.stringify(summary.parts[part].all.to_label_by_reason)}`);
    if (todo.length) console.log(`  ${Object.entries(perRepo).map(([r, n]) => `${r} ${n}`).join(", ")}`);
  }
  writeFileSync(join(here, "stage.json"), JSON.stringify(summary, null, 2) + "\n");
} else if (cmd === "batches") {
  const out = { rule: "one batch = one (labeller, repo) prompt, launched as one fresh agent (README 'Launching'; REVIEWER-PROMPT.md 'Isolation'); A and B of one repo never at the same time", batches: [] };
  for (const part of PARTS) {
    const sub = join(here, part, "relabel");
    if (!existsSync(join(sub, "run.json"))) continue;
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
