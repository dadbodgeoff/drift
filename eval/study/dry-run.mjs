// Plumbing dry run of the labelling pipeline with SYNTHETIC labels: no labeller agents, dev runs only.
//
//   node eval/study/dry-run.mjs fill  --run DIR --stage label|adjudicate|extract|match
//                                     # write synthetic output into every rendered, uncollected prompt's outbox
//   node eval/study/dry-run.mjs check --run DIR [--metrics DIR/metrics.json] [--agreement DIR/agreement.json]
//                                     [--recall DIR/recall.json]
//                                     # recompute the final labels, the tier tables and recall from the synthetic
//                                     # rule and compare them with what adjudicate.mjs, agree.mjs, metrics.mjs and
//                                     # recall.mjs wrote
//
// It stands in for labellers A, B and C, extractor E1 and matcher M1, so that prepare -> prompt -> collect ->
// agree -> adjudicate -> metrics, and recall (sources -> extract -> match -> score), can be run end to end on dev
// repos before a held-out run (see HELDOUT-RUNBOOK.md, step 2). Labels, documented items and matches are a seeded
// function of the uid or ref; they say nothing about the proposals or the docs. It refuses a held-out run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVED_RUBRIC, LABELS, die, loadRun, memberFileInfo, otherMemberRejection, parseArgs, proposalLanguageGroup, readJson, readJsonl, rng, tierOf } from "./lib.mjs";

const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!["fill", "check"].includes(mode) || !args.run) die("usage: dry-run.mjs fill --run DIR --stage label|adjudicate | check --run DIR [--metrics FILE] [--agreement FILE]");
const { run, queue, byUid } = loadRun(args.run);
if (run.manifest?.holdout || run.manifest?.role !== "dev") die(`${args.run} is a ${run.manifest?.holdout ? "HELD-OUT" : run.manifest?.role} run: synthetic labels are for dev dry runs only`);

// Each synthetic text names its uid and author, so that no two outputs share one (collect.mjs looks for copies).
const REASON = "SYNTHETIC dry-run label (eval/study/dry-run.mjs), not a review";
const reasonFor = (uid, who) => `${REASON}: ${uid} by ${who} in ${run.run}`;
const isSynthetic = (t) => typeof t === "string" && t.startsWith(REASON);
// The synthetic rule. A: 60% ACCEPT, 20% TRIVIAL, 20% WRONG. B: A's label, moved to the next label for 25% of
// proposals. C: sides with reviewer 1 (45%), reviewer 2 (45%) or neither (10%: the label neither gave).
const draw = (key) => rng(`drift-dry-run:${key}`)();
const synthA = (uid) => {
  const h = draw(`A:${uid}`);
  return h < 0.6 ? "ACCEPT" : h < 0.8 ? "TRIVIAL" : "WRONG";
};
const synthB = (uid) => (draw(`B:${uid}`) < 0.25 ? LABELS[(LABELS.indexOf(synthA(uid)) + 1) % 3] : synthA(uid));
const synthC = (uid, shown) => {
  const h = draw(`C:${uid}`);
  if (h < 0.45) return { label: shown[0], sided_with: "1" };
  if (h < 0.9) return { label: shown[1], sided_with: "2" };
  return { label: LABELS.find((l) => !shown.includes(l)), sided_with: "neither" };
};
const synth = (L, uid) => (L === "A" ? synthA(uid) : synthB(uid));
// Recall: 4 documented items per repo (R01 from a lint config, R04 not code-checkable); each checkable item is
// matched FULL (30%), PARTIAL (20%) or NONE at shown, and at the pool one level better for half of the misses.
const DOC_ITEMS = 4;
const synthDoc = (repo, i, sources) => {
  const ref = `${repo}#R${String(i + 1).padStart(2, "0")}`;
  return { ref, repo, source: sources[i % Math.max(1, sources.length)] ?? "dry-run/none", source_kind: i === 0 ? "lint" : "other_doc", quote: "SYNTHETIC", statement: `SYNTHETIC dry-run item ${i + 1} of ${repo} in ${run.run} (eval/study/dry-run.mjs), not a documented convention`, scope: "all files", category: "other", strength: "should", enabled: true, enforced_by: null, code_checkable: i !== DOC_ITEMS - 1 };
};
const synthMatch = (ref) => {
  const h = draw(`M:${ref}`);
  const match = h < 0.3 ? "FULL" : h < 0.5 ? "PARTIAL" : "NONE";
  const pool_match = match === "NONE" && draw(`P:${ref}`) < 0.5 ? "PARTIAL" : match;
  return { match, pool_match };
};

let memberFiles = null;
function record(uid, label, rubric, who) {
  memberFiles ??= memberFileInfo(run, queue);
  const q = byUid.get(uid);
  const ex = q.example?.split("#")[0];
  // What the rubric (v2 and v3 alike) asks a labeller to open: the example, up to 3 outlier files, and two further
  // files that can hold other members (collect.mjs counts only tracked, non-config files of the role's files).
  const base = [ex, ...q.outlier_files.slice(0, 3)].filter(Boolean);
  const info = memberFiles.get(uid);
  const pickFrom = info ? [...(info.candidates ?? info.tracked)].sort() : [];
  const further = pickFrom.filter((f) => !base.includes(f) && !q.outlier_files.includes(f) && !otherMemberRejection(f, info)).slice(0, 2);
  const r = { uid, rubric, label, clear: true, confidence: "high", checked: [...new Set([...base, ...further])], reason: reasonFor(uid, who) };
  if (label === "TRIVIAL") Object.assign(r, { trivial_by: "lint", lint_severity: "error", trivial_evidence: "synthetic" });
  if (label === "WRONG") r.wrong_because = "incidental";
  return r;
}

if (mode === "fill") {
  if (!["label", "adjudicate", "extract", "match"].includes(args.stage)) die("--stage label|adjudicate|extract|match");
  const index = readJson(join(args.run, "prompts", "index.json"));
  const adj = args.stage === "adjudicate" ? readJson(join(args.run, "adjudication", "queue.json")) : null;
  let n = 0;
  for (const e of index) {
    if (e.stage !== args.stage || e.collected || existsSync(e.output)) continue;
    if (!existsSync(e.prompt)) die(`prompt ${e.prompt} is missing`);
    if (args.stage === "extract") {
      const src = join(args.run, "recall", "sources", `${e.repo}.json`);
      const files = existsSync(src) ? readJson(src).files.map((f) => f.path) : [];
      const recs = Array.from({ length: DOC_ITEMS }, (_, i) => synthDoc(e.repo, i, files));
      writeFileSync(e.output, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.log(`${e.stage} ${e.labeller} ${e.repo}: ${recs.length} synthetic records -> outbox`);
      n++;
      continue;
    }
    if (args.stage === "match") {
      const first = queue.items.find((p) => p.repo === e.repo)?.id;
      const recs = e.expected.map((ref) => {
        const { match, pool_match } = synthMatch(ref);
        const ids = (m) => (m !== "NONE" && first ? [first] : []);
        return { ref, match: first ? match : "NONE", proposals: ids(match), pool_match: first ? pool_match : "NONE", pool_proposals: ids(pool_match), followed: "yes", checked: [], reason: reasonFor(ref, e.labeller) };
      });
      writeFileSync(e.output, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.log(`${e.stage} ${e.labeller} ${e.repo}: ${recs.length} synthetic records -> outbox`);
      n++;
      continue;
    }
    const recs = e.expected.map((uid) => {
      if (args.stage === "label") return record(uid, synth(e.labeller, uid), e.rubric ?? "v2", e.labeller);
      const c = adj.cases.find((x) => x.uid === uid);
      const shown = c.order.map((L) => c.reviews[L].label);
      const { label, sided_with } = synthC(uid, shown);
      return { ...record(uid, label, e.rubric ?? "v2", e.labeller), sided_with };
    });
    writeFileSync(e.output, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`${e.stage} ${e.labeller} ${e.repo}: ${recs.length} synthetic records -> outbox`);
    n++;
  }
  console.error(`${n} outboxes filled`);
  process.exit(0);
}

// ---- check: recompute everything downstream of the labels from the synthetic rule ----
const problems = [];
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};
const final = new Map(readJsonl(join(args.run, "final.jsonl")).map((r) => [r.uid, r]));
const adj = readJson(join(args.run, "adjudication", "queue.json"));
const expected = new Map();
let disagreements = 0;
for (const p of queue.items) {
  const a = synthA(p.uid);
  const b = synthB(p.uid);
  if (a === b) expected.set(p.uid, a);
  else {
    disagreements++;
    const c = adj.cases.find((x) => x.uid === p.uid);
    if (!c) problems.push(`${p.uid}: A ${a} / B ${b} disagree but it is not in the adjudication queue`);
    else expected.set(p.uid, synthC(p.uid, c.order.map((L) => c.reviews[L].label)).label);
  }
}
eq("adjudication cases", adj.cases.length, disagreements);
eq("final labels", queue.items.map((p) => final.get(p.uid)?.label ?? null), queue.items.map((p) => expected.get(p.uid)));
for (const r of final.values()) if (!isSynthetic(r.reason)) problems.push(`${r.uid}: final label is not synthetic`);

if (args.agreement) {
  const ag = readJson(args.agreement);
  eq("agreement n", ag.n, queue.items.length);
  eq("agreement disagreements", ag.disagreements.length, disagreements);
}
if (args.metrics) {
  const m = readJson(args.metrics);
  // the dry run renders with the committed rubric, which must be the text approved with decision D6
  eq("metrics rubric", [m.rubric, m.rubric_sha256], [APPROVED_RUBRIC.version, APPROVED_RUBRIC.sha256]);
  const tier = run.params.tier;
  // metrics.mjs groups by the convention's language (lib.mjs proposalLanguageGroup), not the repo's.
  const count = (items) => {
    const c = { shown: items.length, ACCEPT: 0, TRIVIAL: 0, WRONG: 0 };
    for (const p of items) c[expected.get(p.uid)]++;
    return c;
  };
  const pick = (s) => ({ shown: s.shown, ACCEPT: s.ACCEPT, TRIVIAL: s.TRIVIAL, WRONG: s.WRONG });
  const def = (p) => tierOf(p, tier) === "default";
  eq("overall", pick(m.overall), count(queue.items));
  eq("default tier", pick(m.default_tier), count(queue.items.filter(def)));
  eq("suggestion tier", pick(m.suggestion_tier), count(queue.items.filter((p) => !def(p))));
  for (const g of m.by_language) {
    const items = queue.items.filter((p) => proposalLanguageGroup(p) === g.language && g.repos.includes(p.repo));
    eq(`${g.language} overall`, pick(g.overall), count(items));
    eq(`${g.language} default tier`, pick(g.default_tier), count(items.filter(def)));
    eq(`${g.language} suggestion tier`, pick(g.suggestion_tier), count(items.filter((p) => !def(p))));
    const acc = g.default_tier.accept_shown;
    if (g.default_tier.shown && !(acc.lo <= acc.p && acc.p <= acc.hi)) problems.push(`${g.language}: default-tier accept interval does not contain the rate`);
  }
  for (const r of run.repos) eq(`${r.name} framework_bucket`, m.repos.find((x) => x.name === r.name)?.framework_bucket ?? null, r.framework_bucket ?? null);
  const rowsDefault = m.by_language.map((g) => `${g.language}: default ${g.default_tier.ACCEPT}/${g.default_tier.shown}, suggestion ${g.suggestion_tier.ACCEPT}/${g.suggestion_tier.shown}, not-wrong ${g.overall.ACCEPT + g.overall.TRIVIAL}/${g.overall.shown}`);
  console.log(rowsDefault.join("\n"));
}
if (args.recall) {
  const rc = readJson(args.recall);
  const okRepos = run.repos.filter((r) => r.status === "ok").map((r) => r.name);
  const items = okRepos.flatMap((repo) => Array.from({ length: DOC_ITEMS }, (_, i) => synthDoc(repo, i, [])).filter((d) => d.code_checkable).map((d) => {
    const has = queue.items.some((p) => p.repo === repo);
    const m = synthMatch(d.ref);
    return has ? m : { match: "NONE", pool_match: "NONE" };
  }));
  const k = (f) => items.filter(f).length;
  eq("recall items", rc.overall.n, items.length);
  eq("recall@shown strict", rc.overall.shown_strict.k, k((m) => m.match === "FULL"));
  eq("recall@shown lenient", rc.overall.shown_lenient.k, k((m) => m.match !== "NONE"));
  eq("recall@pool lenient", rc.overall.pool_lenient.k, k((m) => m.pool_match !== "NONE"));
  eq("recall lint items", rc.by_source.lint.n, okRepos.length);
  eq("recall repos scored", rc.repos.length, okRepos.length);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`dry run check: ${queue.items.length} proposals, ${disagreements} adjudicated; final labels${args.agreement ? ", agreement" : ""}${args.metrics ? ", overall, tier and per-language tables" : ""}${args.recall ? ", recall" : ""} match the synthetic rule`);
