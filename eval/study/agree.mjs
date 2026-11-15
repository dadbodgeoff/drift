// Inter-labeller agreement between two independent label sets.
//
//   node eval/study/agree.mjs --run eval/study/runs/NAME          # labels/A vs labels/B of that run
//   node eval/study/agree.mjs --a FILE|DIR --b FILE|DIR [--run DIR] # any two label sets
//   options: --json OUT (with --run alone, default <run>/agreement.json), --after-adjudication, --allow-incomplete TEXT
//
// Completeness: with --run, agreement is computed only on complete A and B label sets. It refuses while any repo of
// the run's queue lacks an A or B label, or has a label prompt rendered but not collected (lib.mjs labelSetGaps);
// once, a part's agreement was computed before one repo's B labels were collected. --allow-incomplete TEXT computes
// it anyway and records TEXT and the gaps in both outputs (`incomplete`), to be reported as a deviation.
//
// Ordering (README step 3): within a run, agreement is computed BEFORE adjudication, on the A and B labels C will be
// shown. The JSON records their sha256 (lib.mjs labelSetSha256); adjudicate.mjs refuses to write its queue unless
// <run>/agreement.json holds the sha256 of the labels it queues. Once adjudication/queue.json exists this script
// refuses to run on the run's labels, except with --after-adjudication, which recomputes it only from A and B
// labels unchanged since the queue was written (sha256 checked) and says so in both outputs (never on a held-out run).
//
// Reports coverage (against the run's queue when --run is given), exact agreement, the 3x3 confusion matrix, each
// labeller's label mix, and per-repo agreement. At n >= 30 paired labels (F2, PLAN-R14 WS-F; lib.mjs
// MIN_N_CHANCE_CORRECTED) it also reports Cohen's kappa and Gwet's AC1 on the three labels, each with a repo-cluster
// bootstrap interval, and both for the two binary questions (ACCEPT vs not, WRONG vs not). Below n = 30 it prints raw
// agreement only, and the JSON's kappa and AC1 fields are null. No adjective is printed for either statistic.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { LABELS, MIN_N_CHANCE_CORRECTED, cohen, completenessOverride, gwetAC1, die, indexLabels, labelSetGaps, labelSetSha256, loadRun, parseArgs, pct, readJson, readJsonlAll, rng, table, uidOf } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["allowMixedRubric", "afterAdjudication"] });
const run = args.run ? loadRun(args.run) : null;
const aPath = args.a ?? (run && join(args.run, "labels", "A"));
const bPath = args.b ?? (run && join(args.run, "labels", "B"));
if (!aPath || !bPath) die("usage: agree.mjs --run DIR | --a FILE|DIR --b FILE|DIR");

function load(path) {
  const recs = readJsonlAll(path);
  if (!recs.length) die(`no labels at ${path}`);
  const bad = recs.filter((r) => !LABELS.includes(r.label));
  if (bad.length) die(`${bad.length} records with a label outside ${LABELS.join("|")}, e.g. ${bad[0]._src}: ${JSON.stringify(bad[0].label)}`);
  return indexLabels(recs, path);
}
const A = load(aPath);
const B = load(bPath);
// The run's own A and B labels: ordered against adjudication (see the header).
const runLabels = Boolean(run) && !args.a && !args.b;
const labelsSha = { A: labelSetSha256(A), B: labelSetSha256(B) };
const jsonPath = args.json ?? (runLabels ? join(args.run, "agreement.json") : null);
const adjQueue = runLabels ? join(args.run, "adjudication", "queue.json") : null;
const afterAdj = Boolean(adjQueue && existsSync(adjQueue));
if (afterAdj) {
  if (!args.afterAdjudication)
    die(`${adjQueue} exists: agreement is computed before adjudication and never recomputed after it (README step 3). If it was not computed then, pass --after-adjudication: it is recomputed from the A and B labels only if they are unchanged since the queue was written, and marked as such`);
  if (run.run?.manifest?.holdout) die("--after-adjudication is refused on a held-out run: agreement that was not computed before adjudication is a protocol deviation to report, not to repair");
  const q = readJson(adjQueue).labels_sha256 ?? {};
  if (q.A !== labelsSha.A || q.B !== labelsSha.B) die("labels A/B changed since the adjudication queue was written: this would not be the agreement of the labels C was shown");
} else if (args.afterAdjudication) die("--after-adjudication: this run has no adjudication queue yet; compute agreement without it");
// Complete A and B sets first: against the run's queue, and (for the run's own labels) its prompt index.
const incomplete = run ? completenessOverride(labelSetGaps(args.run, run.queue, { sets: { A, B }, useIndex: runLabels }), args.allowIncomplete, "agree.mjs") : null;
// Two label sets compared within a run must come from one rubric text (records carry it since collect.mjs stamps
// it). --allow-mixed-rubric reports a cross-rubric comparison (a calibration shift, say) instead of refusing.
const texts = [...new Set([...A.values(), ...B.values()].map((r) => r.rubric_sha256).filter(Boolean))];
if (texts.length > 1 && !args.allowMixedRubric) die(`the two label sets name ${texts.length} rubric texts (${texts.map((h) => h.slice(0, 12)).join(", ")}); agreement is computed within one rubric text (--allow-mixed-rubric to compare across them)`);
// With a run, the scope is its queue; otherwise the proposals both files label (e.g. a relabelled sample).
const universe = run ? [...run.byUid.keys()] : [...A.keys()].filter((u) => B.has(u));
const pairs = [];
for (const uid of universe) {
  const a = A.get(uid)?.label;
  const b = B.get(uid)?.label;
  if (a && b) pairs.push({ uid, repo: uid.split("/")[0], a, b });
}
if (!pairs.length) die("no proposal has both labels");

const k3 = cohen(pairs.map((p) => [p.a, p.b]), LABELS);
const a3 = gwetAC1(pairs.map((p) => [p.a, p.b]), LABELS);
const binPairs = (cat) => pairs.map((p) => [p.a === cat ? cat : "other", p.b === cat ? cat : "other"]);
const bin = (cat) => ({ ...cohen(binPairs(cat), [cat, "other"]), ac1: gwetAC1(binPairs(cat), [cat, "other"]).ac1 });
const kAcc = bin("ACCEPT");
const kWrong = bin("WRONG");
const chanceCorrected = pairs.length >= MIN_N_CHANCE_CORRECTED;

// Repo-cluster bootstrap for a statistic of the pairs (kappa, AC1).
function boot(stat, iters = 2000) {
  const repos = [...new Set(pairs.map((p) => p.repo))];
  if (repos.length < 2) return { lo: NaN, hi: NaN, clusters: repos.length };
  const byRepo = new Map(repos.map((r) => [r, pairs.filter((p) => p.repo === r)]));
  const r = rng("agree");
  const ks = [];
  for (let i = 0; i < iters; i++) {
    const sample = [];
    for (let j = 0; j < repos.length; j++) sample.push(...byRepo.get(repos[Math.floor(r() * repos.length)]));
    const k = stat(sample.map((p) => [p.a, p.b]));
    if (Number.isFinite(k)) ks.push(k);
  }
  ks.sort((x, y) => x - y);
  return { lo: ks[Math.floor(0.025 * ks.length)], hi: ks[Math.ceil(0.975 * ks.length) - 1], clusters: repos.length };
}
const kBoot = boot((ps) => cohen(ps, LABELS).kappa);
const acBoot = boot((ps) => gwetAC1(ps, LABELS).ac1);

const confusion = Object.fromEntries(LABELS.map((a) => [a, Object.fromEntries(LABELS.map((b) => [b, 0]))]));
for (const p of pairs) confusion[p.a][p.b]++;
const mix = (M) => {
  const c = Object.fromEntries(LABELS.map((l) => [l, 0]));
  for (const uid of universe) if (M.get(uid)) c[M.get(uid).label]++;
  return c;
};
const repoRows = [...new Set(pairs.map((p) => p.repo))].map((r) => {
  const ps = pairs.filter((p) => p.repo === r);
  return [r, ps.length, pct(ps.filter((p) => p.a === p.b).length / ps.length), ps.filter((p) => p.a !== p.b).map((p) => `${p.uid.split("/")[1]} ${p.a[0]}/${p.b[0]}`).join(", ")];
});
const stat = (x) => (Number.isFinite(x) ? x.toFixed(2) : "undefined (one label only)");
const withBoot = (x, b) => `${stat(x)}, bootstrap over ${b.clusters} repos, 95% ${Number.isFinite(b.lo) ? `${b.lo.toFixed(2)}–${b.hi.toFixed(2)}` : "–"}`;
const missing = (M) => universe.filter((u) => !M.has(u));

const out = [];
out.push(`# Agreement: ${aPath} vs ${bPath}`);
out.push("");
if (incomplete) {
  out.push(`**Computed on INCOMPLETE label sets** (\`--allow-incomplete\`: ${incomplete.reason}). Not labelled: ${incomplete.gaps.join("; ")}.`);
  out.push("");
}
if (afterAdj) {
  out.push("**Recomputed after adjudication** (`--after-adjudication`), from A and B labels unchanged since the adjudication queue was written (sha256 checked): the figures are those of the labels C was shown.");
  out.push("");
}
out.push(
  table(
    ["", ""],
    [
      ["Proposals in scope", universe.length],
      ["Labelled by both", `${pairs.length}${missing(A).length || missing(B).length ? ` (missing: A ${missing(A).length}, B ${missing(B).length})` : ""}`],
      ["Exact agreement (3 labels)", pct(k3.po, 1)],
      ...(chanceCorrected
        ? [
            ["Cohen's κ (3 labels)", withBoot(k3.kappa, kBoot)],
            ["Gwet's AC1 (3 labels)", withBoot(a3.ac1, acBoot)],
            ["ACCEPT vs not: agreement / κ / AC1", `${pct(kAcc.po, 1)} / ${stat(kAcc.kappa)} / ${stat(kAcc.ac1)}`],
            ["WRONG vs not: agreement / κ / AC1", `${pct(kWrong.po, 1)} / ${stat(kWrong.kappa)} / ${stat(kWrong.ac1)}`],
          ]
        : [
            ["Chance-corrected agreement", `not reported: n = ${pairs.length} < ${MIN_N_CHANCE_CORRECTED}`],
            ["ACCEPT vs not: agreement", pct(kAcc.po, 1)],
            ["WRONG vs not: agreement", pct(kWrong.po, 1)],
          ]),
      ["Disagreements to adjudicate", pairs.filter((p) => p.a !== p.b).length],
    ],
  ),
);
out.push("");
out.push("Confusion matrix (rows A, columns B):");
out.push("");
out.push(table(["A \\ B", ...LABELS], LABELS.map((a) => [a, ...LABELS.map((b) => confusion[a][b])])));
out.push("");
const ma = mix(A);
const mb = mix(B);
out.push(table(["Label mix", ...LABELS], [["A", ...LABELS.map((l) => ma[l])], ["B", ...LABELS.map((l) => mb[l])]]));
out.push("");
out.push(table(["Repo", "Both", "Agree", "Disagreements (A/B)"], repoRows));
if (texts.length > 1) out.push("", `Rubric texts: **mixed** (${texts.map((h) => h.slice(0, 12)).join(", ")}).`);
console.log(out.join("\n"));

if (jsonPath)
  writeFileSync(
    jsonPath,
    JSON.stringify({ a: aPath, b: bPath, labels_sha256: labelsSha, computed_at: new Date().toISOString(), ...(afterAdj ? { after_adjudication: true } : {}), ...(incomplete ? { incomplete } : {}), rubric_sha256s: texts, n: pairs.length, scope: universe.length, exact: k3.po, min_n_chance_corrected: MIN_N_CHANCE_CORRECTED, kappa: chanceCorrected ? k3.kappa : null, kappa_boot: chanceCorrected ? kBoot : null, ac1: chanceCorrected ? a3.ac1 : null, ac1_boot: chanceCorrected ? acBoot : null, accept_vs_not: chanceCorrected ? kAcc : { po: kAcc.po }, wrong_vs_not: chanceCorrected ? kWrong : { po: kWrong.po }, confusion, mix: { A: ma, B: mb }, disagreements: pairs.filter((p) => p.a !== p.b) }, null, 2) + "\n",
  );
