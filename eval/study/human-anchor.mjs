// The human anchor (PLAN-R14 WS-F F5, release gate G8): a plain JSONL form a person fills with the same rubric the
// model labellers use, and the model-vs-human report. Decision D-4's default: the form and the report are built, and
// nothing is labelled until the owner decides who labels and the budget.
//
//   form   --run DIR --out FILE.jsonl [--n 100] [--seed TEXT]   a seeded sample of the run's items, at most 5 per repo
//   report --run DIR --human FILE.jsonl [--json OUT]            agreement of the person's labels with the run's final ones
//
// A census run: each line carries the rubric-v4 card (lib.mjs labellerCard: no evidence numbers) and the empty fields
// of a rubric-v4 label (`label`, `reason`, `checked`); the person reads RUBRIC-v4.md and the checkout. The model's
// label is the run's final.jsonl label.
// A practice run (practices.mjs sample): each line carries the describe card (the unit and the concern, never Drift's
// assignment) and the empty fields of a practice-describe record (`does`, `mechanisms`, `description`, `reason`,
// `checked`); the person reads RUBRIC-practice-describe-v1.md. The model's answer is the final description (A and B
// agreed, else C's).
// The report gives raw agreement and agreement per label (of the items the person gave that label, the share the
// models gave it too), the confusion matrix, and, at n >= 30 (F2), Cohen's kappa and Gwet's AC1. No adjective.
// Until a person has labelled at least 100 items, no accuracy figure is quoted outside the repository without the
// sentence "labelled by models, not maintainers" (F5).
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DESCRIBE_OUTCOMES, LABELS, MIN_N_CHANCE_CORRECTED, cohen, die, gwetAC1, labellerCard, loadRun, parseArgs, pct, readJsonl, readJsonlAll, shuffle, table, uidOf } from "./lib.mjs";

export const PER_REPO = 5;
// The seeded sample: items sorted by uid, shuffled, at most PER_REPO per repo, the first n.
export function anchorSample(items, { n = 100, seed = "drift-human-anchor" } = {}) {
  const per = new Map();
  const out = [];
  for (const q of shuffle([...items].sort((a, b) => a.uid.localeCompare(b.uid)), seed)) {
    if (out.length >= n) break;
    if ((per.get(q.repo) ?? 0) >= PER_REPO) continue;
    per.set(q.repo, (per.get(q.repo) ?? 0) + 1);
    out.push(q);
  }
  return out;
}
export function formLine(q, practice) {
  return practice
    ? { uid: q.uid, repo: q.repo, kind: "practice", rubric: "practice-describe", card: labellerCard(q), does: null, mechanisms: [], description: null, reason: null, checked: [], labeller: "human", labelled_at: null }
    : { uid: q.uid, repo: q.repo, kind: "census", rubric: "v4", card: labellerCard(q.block, { rubric: "v4" }), label: null, reason: null, checked: [], labeller: "human", labelled_at: null };
}
// The models' answer per uid: final.jsonl labels (census), or the final description (practice).
export function modelAnswers(runDir, practice) {
  if (!practice) {
    const f = join(runDir, "final.jsonl");
    return new Map((existsSync(f) ? readJsonl(f) : []).map((r) => [uidOf(r), r.label]));
  }
  const ix = Object.fromEntries(["A", "B", "C"].map((L) => [L, new Map(readJsonlAll(join(runDir, "labels", L)).map((r) => [uidOf(r), r]))]));
  const out = new Map();
  for (const uid of new Set([...ix.A.keys(), ...ix.B.keys()])) {
    const [a, b, c] = ["A", "B", "C"].map((L) => ix[L].get(uid));
    const v = a && b && a.does === b.does ? a.does : c?.does ?? null;
    if (v) out.set(uid, v);
  }
  return out;
}
export function anchorReport(human, model, cats) {
  const filled = human.filter((h) => h.answer !== null && h.answer !== undefined);
  const bad = filled.filter((h) => !cats.includes(h.answer));
  if (bad.length) throw new Error(`${bad.length} human answers are not one of ${cats.join("|")}, e.g. ${JSON.stringify(bad[0].answer)} for ${bad[0].uid}`);
  const pairs = filled.filter((h) => model.has(h.uid)).map((h) => [model.get(h.uid), h.answer]);
  const n = pairs.length;
  const po = n ? pairs.filter(([m, h]) => m === h).length / n : NaN;
  const confusion = Object.fromEntries(cats.map((h) => [h, Object.fromEntries(cats.map((m) => [m, 0]))]));
  for (const [m, h] of pairs) confusion[h][m]++;
  return {
    items: human.length,
    labelled: filled.length,
    unfilled: human.length - filled.length,
    without_model: filled.filter((h) => !model.has(h.uid)).length,
    agreement: { n, po, kappa: n >= MIN_N_CHANCE_CORRECTED ? cohen(pairs, cats).kappa : null, ac1: n >= MIN_N_CHANCE_CORRECTED ? gwetAC1(pairs, cats).ac1 : null },
    per_label: cats.map((l) => {
      const hs = pairs.filter(([, h]) => h === l);
      return { label: l, human_n: hs.length, agree: hs.filter(([m]) => m === l).length, model_n: pairs.filter(([m]) => m === l).length };
    }),
    confusion,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (!args.run) die("usage: human-anchor.mjs form --run DIR --out FILE [--n 100] [--seed TEXT] | report --run DIR --human FILE [--json OUT]");
  const runDir = resolve(args.run);
  const { queue } = loadRun(runDir);
  const practice = queue.kind === "practice";
  if (mode === "form") {
    if (!args.out) die("form: --out FILE is required");
    if (existsSync(args.out)) die(`${args.out} exists: a form is drawn once`);
    const items = anchorSample(queue.items, { n: Number(args.n ?? 100), seed: args.seed ?? "drift-human-anchor" });
    writeFileSync(args.out, items.map((q) => JSON.stringify(formLine(q, practice))).join("\n") + "\n");
    console.log(`form: ${items.length} items (${practice ? "practice, describe step" : "census, rubric v4"}) in ${args.out}; fill the answer fields and leave the rest as written`);
    return;
  }
  if (mode === "report") {
    if (!args.human) die("report: --human FILE is required");
    const cats = practice ? DESCRIBE_OUTCOMES : LABELS;
    const human = readJsonl(resolve(args.human)).map((h) => ({ uid: uidOf(h), answer: practice ? h.does : h.label }));
    let rep;
    try {
      rep = anchorReport(human, modelAnswers(runDir, practice), cats);
    } catch (e) {
      die(e.message);
    }
    const out = [
      `# Human anchor: ${runDir}`,
      "",
      `Labelled by a person: ${rep.labelled} of ${rep.items} items (${rep.unfilled} left blank${rep.without_model ? `; ${rep.without_model} have no model answer` : ""}). Compared with the models' final ${practice ? "descriptions" : "labels"} on ${rep.agreement.n}.`,
      "",
      table(["", ""], [["Raw agreement", pct(rep.agreement.po, 1)], ...(rep.agreement.kappa === null ? [["Chance-corrected agreement", `not reported: n = ${rep.agreement.n} < ${MIN_N_CHANCE_CORRECTED}`]] : [["Cohen's κ", Number.isFinite(rep.agreement.kappa) ? rep.agreement.kappa.toFixed(2) : "undefined"], ["Gwet's AC1", Number.isFinite(rep.agreement.ac1) ? rep.agreement.ac1.toFixed(2) : "undefined"]])]),
      "",
      table(["Person's label", "Items", "Models gave it too", "Models gave it (all)"], rep.per_label.map((l) => [l.label, l.human_n, l.human_n ? `${l.agree} (${pct(l.agree / l.human_n)})` : "–", l.model_n])),
      "",
      "Confusion (rows: the person; columns: the models):",
      "",
      table(["person \\ models", ...cats], cats.map((h) => [h, ...cats.map((m) => rep.confusion[h][m])])),
    ];
    if (rep.labelled < 100) out.push("", `Fewer than 100 items labelled by a person: no accuracy figure is quoted outside the repository without "labelled by models, not maintainers" (F5).`);
    console.log(out.join("\n"));
    if (args.json) writeFileSync(args.json, JSON.stringify({ run: runDir, kind: practice ? "practice" : "census", ...rep }, null, 2) + "\n");
    return;
  }
  die("usage: human-anchor.mjs form|report ...");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
