// Render agent prompts for a run from the templates in this directory.
//
//   node eval/study/prompt.mjs label      --run DIR --labeller A|B [--repo NAME] [--outbox-root DIR] [--workdir-root DIR] [--rubric v2|v3]
//   (a practice run, practices.mjs sample: PRACTICE-PROMPT.md, rubric `practices2`, labellers A, B, then C on disagreements)
//   node eval/study/prompt.mjs adjudicate --run DIR [--repo NAME] [--rubric v2|v3]   # after adjudicate.mjs
//   node eval/study/prompt.mjs extract    --run DIR [--labeller E1] [--repo NAME]   # after recall.mjs sources
//   node eval/study/prompt.mjs match      --run DIR [--labeller M1] [--repo NAME]   # after extraction is collected
//
// Writes <run>/prompts/<stage>/<labeller>/<repo>.md and records each one, with the file the agent must
// write, in <run>/prompts/index.json (read by collect.mjs).
//
// Blinding through the file layout:
//   - every (stage, labeller, repo) gets its own outbox, <outbox-root>/<random uuid>/out.jsonl (default root
//     <cache>/outbox, mode 0711, each outbox dir 0700), recorded only in prompts/index.json, outside the Drift
//     repository; no outbox path says which stage, labeller or repo it belongs to;
//   - collect.mjs moves each valid output into the run and deletes its outbox, so finished labels never sit
//     where another agent writes;
//   - labellers A and B of one repo run one after the other: a label prompt is refused while the other
//     labeller's prompt for that repo is rendered but not yet collected;
//   - prompts never say which labeller they are for (collect.mjs fills in `labeller`).
// Any agent running as the orchestrator's user can still list <outbox-root>; the README says what isolation to prefer.
//
// The agent's working directory: every prompt also gets a fresh, EMPTY, neutral directory, <workdir-root>/<random
// uuid>/ (default root <cache>/workdirs; mode 0700), recorded as `cwd` in prompts/index.json and printed with the
// prompt. Launch the agent with exactly that directory as its working directory: never a Drift checkout or worktree,
// the run directory, or a repository checkout (a labeller whose working directory was the orchestrator's worktree
// once wrote a copy of its output there). prompt.mjs refuses a root inside any git work tree, the Drift repository,
// the run directory, a repo checkout or the outbox root. collect.mjs refuses an output while that directory is not
// empty, and flags a missing output when it is not (lib.mjs neutralDirProblems; collect.mjs header).
// Each entry also records `checkout_status`, the repo checkout's `git status --porcelain` lines (outside .drift/) at
// render time: collect.mjs flags any file the agent added or changed there.
//
// The rubric ({{RUBRIC}}): one run uses one rubric. Its label and adjudication prompts all use the rubric of
// the first one rendered (entries from before --rubric existed are v2); a new run gets v3 (decision D6 in the
// README). --rubric names it explicitly, and is refused if it differs from what the run already uses. Each
// index entry records `rubric` and the sha256 of the labeller-facing rubric text (lib.mjs rubricText). Rendering is
// refused when that text differs from the text of the run's earlier prompts (the file was edited: start a new run),
// and, for a held-out run, when it is not the text approved with decision D6 (lib.mjs APPROVED_RUBRIC).
// collect.mjs checks the records' `rubric` and each prompt's text hash against the run's.
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_PRACTICE_RUBRICS, APPROVED_RUBRIC, PRACTICE_RUBRICS, RUBRICS, derivePracticeLabel, checkoutStatus, die, labellerCard, loadRun, neutralDirProblems, parseArgs, parseCensus, promptLeaks, promptOrder, readJson, readJsonl, recordRubricShas, rubricText as renderRubric, sha256Text } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [stage, ...rest] = process.argv.slice(2);
const args = parseArgs(rest, { flags: ["force"] });
const STAGES = { label: "REVIEWER-PROMPT.md", adjudicate: "ADJUDICATOR-PROMPT.md", extract: "EXTRACT-PROMPT.md", match: "MATCH-PROMPT.md", "recall-list": "RECALL-LIST-PROMPT.md", "recall-match": "RECALL-MATCH-PROMPT.md" };
if (!STAGES[stage] || !args.run) die("usage: prompt.mjs label|adjudicate|extract|match --run DIR [--labeller X] [--repo NAME]");
const runDir = resolve(args.run);
const { run, queue } = loadRun(runDir);
// A practice run (practices.mjs sample: queue.json kind "practice"; F6, PLAN-R14 WS-F) has two kinds of prompts, each
// unit rendered by lib.mjs labellerCard and every prompt checked by lib.mjs promptLeaks before it is written:
//   label (describe, PRACTICE-PROMPT.md, rubric practice-describe): A and B see the unit and the concern, never Drift's
//     assignment, and describe what it does; C does the same, blind, for the units whose A and B labels differ;
//   match (PRACTICE-MATCH-PROMPT.md, rubric practice-match): MA, MB and MC see A's, B's and C's descriptions with the
//     assignment and the attributes to check. practices.mjs score derives each label (lib.mjs derivePracticeLabel).
const PRACTICE = queue.kind === "practice";
//   recall-list (RECALL-LIST-PROMPT.md, rubric practice-recall-list): lister L1 sees one package of recall.json and the
//     primary concerns, never the tool's output, and lists the mechanisms; recall-match (RECALL-MATCH-PROMPT.md, rubric
//     practice-recall-match): matcher R1 sees that list and the tool's variants in the package (PREREG §6.4).
const PRACTICE_STAGE = PRACTICE ? { label: "describe", match: "match", "recall-list": "recall-list", "recall-match": "recall-match" }[stage] ?? null : null;
if (PRACTICE && !PRACTICE_STAGE) die("a practice run has describe prompts (label: A, B, then C on disagreements), match prompts (match: MA, MB, MC) and recall prompts (recall-list: L1, recall-match: R1)");
if (!PRACTICE && stage.startsWith("recall-")) die(`${stage} prompts are for practice runs only`);
const RECALL = PRACTICE_STAGE === "recall-list" || PRACTICE_STAGE === "recall-match";
const recallItems = RECALL ? (existsSync(join(runDir, "recall.json")) ? readJson(join(runDir, "recall.json")).items : die("no recall.json in this practice run (practices.mjs sample writes it)")) : [];
const labeller = args.labeller ?? (PRACTICE ? null : { adjudicate: "C", extract: "E1", match: "M1" }[stage]);
if (!labeller) die("--labeller is required");
if (stage === "label" && !["A", "B", ...(PRACTICE ? ["C"] : [])].includes(labeller)) die(`label prompts are for labellers A and B${PRACTICE ? ", and C" : ""}`);
if (PRACTICE_STAGE === "recall-list" && labeller !== "L1") die("recall-list prompts are for the lister L1");
if (PRACTICE_STAGE === "recall-match" && labeller !== "R1") die("recall-match prompts are for the matcher R1");
if (PRACTICE && stage === "match" && !["MA", "MB", "MC"].includes(labeller)) die("practice match prompts are for MA, MB and MC: the matchers of A's, B's and C's descriptions");
if (!PRACTICE && stage === "match" && !existsSync(join(runDir, "final.jsonl"))) die("match prompts are rendered only after labelling is final (adjudicate.mjs --merge writes final.jsonl)");
const outboxRoot = resolve(args.outboxRoot ?? join(run.params.cache, "outbox"));
mkdirSync(outboxRoot, { recursive: true });
chmodSync(outboxRoot, 0o711);
const workdirRoot = resolve(args.workdirRoot ?? join(run.params.cache, "workdirs"));
const workdirBad = neutralDirProblems(workdirRoot, { runDir, outboxRoot, checkouts: (run.repos ?? []).map((r) => r.checkout).filter(Boolean) });
if (!workdirBad.length) mkdirSync(workdirRoot, { recursive: true, mode: 0o711 }); // checked first: nothing is created in a checkout
if (workdirBad.length) die(`the agents' working directories would be under ${workdirRoot}, which is not neutral: ${workdirBad.join("; ")}. Pass --workdir-root DIR: a directory outside every checkout and repository`);

function template(file) {
  const t = readFileSync(join(here, file), "utf8");
  const m = t.match(/<!-- BEGIN PROMPT -->\n([\s\S]*?)<!-- END PROMPT -->/);
  if (!m) die(`${file} has no BEGIN/END PROMPT markers`);
  return m[1];
}
function fill(t, vars) {
  const out = t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) die(`template placeholder ${m} has no value`);
    return vars[k];
  });
  return out;
}
const fence = (s) => "```text\n" + s + "\n```";
const stripRank = labellerCard; // the block without its rank and its `agents:` line (lib.mjs labellerCard)
// F4 (PLAN-R14 WS-F): under F1 every label and adjudication prompt records the model that runs it (--model; the id is
// committed with the run's data, in prompts/index.json and, by collect.mjs, in each record). A, B and C are three
// different models: C, the adjudicator, never shares A's or B's model.
const model = args.model ? String(args.model) : null;
// Rubric v4 on (F1, PLAN-R14 WS-F): the card without Drift's evidence numbers.
// F1: a uid shows the repo's opaque key instead of its name (collect.mjs maps it back from the index entry).
let uidShown = (uid) => uid;
const card = (p) => `### uid: ${uidShown(p.uid)}\n\n${fence(labellerCard(p.block, { rubric: rubricVersion }))}`;

const indexPath = join(runDir, "prompts", "index.json");
const index = existsSync(indexPath) ? readJson(indexPath) : [];
const written = [];
const rubricStage = (e) => (PRACTICE ? e.stage === stage : e.stage === "label" || e.stage === "adjudicate");
const usedRubrics = [...new Set(index.filter(rubricStage).map((e) => e.rubric ?? "v2"))];
// The default for a new run: v4 (F1), except a held-out run, which keeps the text approved with D6 until a recorded
// decision approves another (lib.mjs APPROVED_RUBRIC); practice runs use their own rubric.
const rubricVersion = PRACTICE ? PRACTICE_RUBRICS[PRACTICE_STAGE] : args.rubric ?? usedRubrics[0] ?? (run.manifest?.holdout ? APPROVED_RUBRIC.version : "v4");
if (PRACTICE && args.rubric && args.rubric !== rubricVersion) die(`a practice run's ${stage} prompts use the rubric ${rubricVersion}`);
// F1 and F4 apply to every run labelled under v4 or a practice rubric: masked repository, the leak check, model ids.
const F1 = PRACTICE || rubricVersion === "v4";
if (!PRACTICE && String(rubricVersion).startsWith("practice")) die(`the rubric ${rubricVersion} is for practice runs only`);
if (!RUBRICS[rubricVersion]) die(`--rubric must be one of ${Object.keys(RUBRICS).join(", ")}`);
if (usedRubrics.some((v) => v !== rubricVersion))
  die(`this run's label/adjudication prompts use rubric ${usedRubrics.join(", ")}; one run uses one rubric (decision D6): start a new run directory for ${rubricVersion}`);
const rubricText = renderRubric(rubricVersion);
const rubricSha256 = sha256Text(rubricText); // of the labeller-facing text
// One run, one rubric TEXT: a label or adjudication prompt rendered earlier with another text of the same version
// (the rubric file was edited in between) would mix two rubrics under one label.
// Read from the index AND from the collected records, which collect.mjs stamps: clearing the index hides nothing.
const otherTexts = [...new Set([...index.filter((e) => rubricStage(e) && e.rubric_sha256).map((e) => e.rubric_sha256), ...(PRACTICE_STAGE && PRACTICE_STAGE !== "describe" ? [] : recordRubricShas(runDir))].filter((h) => h !== rubricSha256))];
if (otherTexts.length)
  die(`${RUBRICS[rubricVersion]} has changed since this run's earlier prompts were rendered (their rubric text sha256 ${otherTexts.map((h) => h.slice(0, 12)).join(", ")}, now ${rubricSha256.slice(0, 12)}); one run uses one rubric text: start a new run directory`);
// A held-out run uses exactly the rubric text approved with its decision (lib.mjs APPROVED_RUBRIC).
if (!PRACTICE && run.manifest?.holdout && (stage === "label" || stage === "adjudicate") && (rubricVersion !== APPROVED_RUBRIC.version || rubricSha256 !== APPROVED_RUBRIC.sha256))
  die(`held-out run: the rubric text (${rubricVersion}, sha256 ${rubricSha256.slice(0, 12)}) is not the one approved with decision ${APPROVED_RUBRIC.decision} (${APPROVED_RUBRIC.version}, ${APPROVED_RUBRIC.sha256.slice(0, 12)}); a rubric change after approval needs a new recorded decision`);

if (PRACTICE && rubricSha256 !== APPROVED_PRACTICE_RUBRICS[rubricVersion].sha256)
  die(`practice run: the ${rubricVersion} rubric text (sha256 ${rubricSha256.slice(0, 12)}) is not the one pre-registered in ${APPROVED_PRACTICE_RUBRICS.prereg} (${APPROVED_PRACTICE_RUBRICS[rubricVersion].sha256.slice(0, 12)}); a rubric change needs a new id and a recorded amendment`);
// Before anything is written: the leak check over the rubric text and every unit's card (the per-prompt check below
// then covers the template too).
if (PRACTICE) {
  const leaks = [...promptLeaks(rubricText), ...(RECALL ? recallItems : queue.items).flatMap((p) => promptLeaks(labellerCard(p)).map((x) => `${p.uid}: ${x}`))];
  if (leaks.length) die(`the practice cards fail the leak check (${leaks.slice(0, 5).join("; ")}); nothing was written`);
}
const ABC = ["A", "B", "C"];
if (F1 && (stage === "label" || stage === "adjudicate" || PRACTICE)) {
  if (!model) die("--model ID is required under rubric v4 and for practice runs (F4): the id of the model that will run these prompts, committed with the run");
  // A, B and C (the describers, or the census labellers and adjudicator) run on three different models
  const others = ABC.includes(labeller) ? [...new Set(index.filter((e) => (e.stage === "label" || e.stage === "adjudicate") && ABC.includes(e.labeller) && e.labeller !== labeller && e.model).map((e) => `${e.labeller}=${e.model}`))] : [];
  const clash = others.filter((x) => x.split("=").slice(1).join("=") === model);
  if (clash.length) die(`--model ${model}: labeller ${clash.map((x) => x.split("=")[0]).join(", ")} of this run already runs on it; A, B and C run on three different models (F4)`);
  const mine = [...new Set(index.filter((e) => e.labeller === labeller && e.model).map((e) => e.model))];
  if (mine.length && !mine.includes(model)) die(`--model ${model}: labeller ${labeller} of this run runs on ${mine.join(", ")}; one labeller, one model`);
}
// F1: the repository is masked in the prompt: an opaque key for its name, no URL or commit, and its checkout through a
// symlink with an opaque name (the source itself may still reveal it).
const maskedKey = (name) => `R-${createHash("sha256").update(`${run.run}:${name}`).digest("hex").slice(0, 6)}`;
function maskedDir(r) {
  const root = join(run.params.cache, "masked");
  mkdirSync(root, { recursive: true, mode: 0o711 });
  const link = join(root, randomUUID());
  symlinkSync(resolve(r.checkout), link);
  return link;
}
for (const r of run.repos) {
  if (r.status !== "ok" || (args.repo && args.repo !== r.name)) continue;
  let props = (RECALL ? recallItems : queue.items).filter((p) => p.repo === r.name);
  const done = (st, L) => index.some((e) => e.stage === st && e.labeller === L && e.repo === r.name && e.collected);
  const recsOf = (L) => new Map(readJsonl(join(runDir, "labels", L, `${r.name}.jsonl`)).map((x) => [x.uid, x]));
  let described = null;
  if (PRACTICE && stage === "label" && labeller === "C") {
    if (!["A", "B"].every((L) => done("label", L)) || !["MA", "MB"].every((L) => done("match", L))) {
      console.error(`${r.name}: skipped; C describes after A's and B's descriptions and their matches (MA, MB) are collected`);
      continue;
    }
    const [a, b, ma, mb] = ["A", "B", "MA", "MB"].map(recsOf);
    const lab = (p, d, m) => (d.has(p.uid) && m.has(p.uid) ? derivePracticeLabel(p.assigned?.kind, d.get(p.uid).does, m.get(p.uid).same) : null);
    props = props.filter((p) => lab(p, a, ma) && lab(p, b, mb) && lab(p, a, ma) !== lab(p, b, mb));
  }
  if (PRACTICE_STAGE === "recall-match") {
    if (!done("recall-list", "L1")) {
      console.error(`${r.name}: skipped; R1 matches L1's lists once they are collected`);
      continue;
    }
    described = recsOf("L1");
    props = props.filter((p) => described.has(p.uid));
  }
  if (PRACTICE && stage === "match") {
    const of = labeller.slice(1);
    if (!done("label", of)) {
      console.error(`${r.name}: skipped; ${labeller} matches ${of}'s descriptions once they are collected`);
      continue;
    }
    described = recsOf(of);
    props = props.filter((p) => described.has(p.uid));
  }
  const same = index.find((e) => e.stage === stage && e.labeller === labeller && e.repo === r.name);
  if (same?.collected && !args.force) die(`${stage} ${labeller} ${r.name} was already collected (final); --force to render it again`);
  if (same && !same.collected && existsSync(same.output)) die(`${stage} ${labeller} ${r.name} has output waiting in its outbox; run collect.mjs first`);
  // ...and the other way round: no label or adjudication output may appear while an extractor or matcher
  // for the repo is still working (they are blind to proposals and labels).
  if (stage === "label" || stage === "adjudicate") {
    const open = index.find((e) => (e.stage === "extract" || e.stage === "match") && e.repo === r.name && !e.collected);
    if (open) {
      console.error(`${r.name}: skipped; a ${open.stage} prompt for it (${open.labeller}) is outstanding (collect it first)`);
      continue;
    }
  }
  if (stage === "label") {
    const other = index.find((e) => e.stage === "label" && e.labeller !== labeller && e.repo === r.name && !e.collected);
    if (other) {
      console.error(`${r.name}: skipped; labeller ${other.labeller}'s prompt is outstanding (collect its output first: A and B of one repo never run at the same time)`);
      continue;
    }
  }
  // Extractors and matchers must be blind to labels: never render them while any label or adjudication
  // output for the repo can still sit in an outbox. Matching additionally waits for final.jsonl, when every
  // label is inside the run directory.
  if (!PRACTICE && (stage === "match" || stage === "extract")) {
    const open = index.find((e) => (e.stage === "label" || e.stage === "adjudicate") && e.repo === r.name && !e.collected);
    if (open) {
      console.error(`${r.name}: skipped; a ${open.stage} prompt for it (${open.labeller}) is outstanding (collect it first)`);
      continue;
    }
  }
  if (same && !same.collected) {
    rmSync(dirname(same.output), { recursive: true, force: true });
    if (same.cwd) rmSync(same.cwd, { recursive: true, force: true });
  }
  const box = join(outboxRoot, randomUUID());
  const cwd = join(workdirRoot, randomUUID());
  const output = join(box, "out.jsonl");
  uidShown = F1 ? (uid) => (uid.startsWith(`${r.name}/`) ? `${maskedKey(r.name)}/${uid.slice(r.name.length + 1)}` : uid) : (uid) => uid;
  const base = F1
    ? { REPO: maskedKey(r.name), REPO_URL: "address withheld", REPO_SHA: "withheld", REPO_DIR: maskedDir(r), OUTPUT_FILE: output, RUBRIC: rubricText }
    : { REPO: r.name, REPO_URL: r.url, REPO_SHA: r.sha, REPO_DIR: r.checkout, OUTPUT_FILE: output, RUBRIC: rubricText };
  let vars;
  let expected;
  if (PRACTICE) {
    if (!props.length) continue;
    const order = promptOrder(props, { run: run.run, labeller, repo: r.name });
    const cardOf = (p) => (RECALL ? labellerCard(p, { list: described?.get(p.uid) ?? null }) : labellerCard(p, { match: described?.get(p.uid) ?? null }));
    vars = { ...base, COUNT: String(props.length), UNITS: order.map((p) => `### uid: ${uidShown(p.uid)}\n\n${fence(cardOf(p))}`).join("\n\n") };
    expected = props.map((p) => p.uid);
  } else if (stage === "label") {
    if (!props.length) continue;
    const order = promptOrder(props, { run: run.run, labeller, repo: r.name });
    vars = { ...base, COUNT: String(props.length), PROPOSALS: order.map(card).join("\n\n") };
    expected = props.map((p) => p.uid);
  } else if (stage === "adjudicate") {
    const qPath = join(runDir, "adjudication", "queue.json");
    if (!existsSync(qPath)) die("run adjudicate.mjs first (it writes adjudication/queue.json)");
    // Shuffled: queue order is census rank, which is in tier order.
    const cases = promptOrder(
      readJson(qPath).cases.filter((c) => c.repo === r.name),
      { run: run.run, labeller, repo: r.name },
    );
    if (!cases.length) continue;
    const review = (n, l) =>
      [
        `**Reviewer ${n}: ${l.label}**${l.trivial_by ? ` (trivial_by: ${l.trivial_by}${l.trivial_evidence ? `; ${l.trivial_evidence}` : ""})` : ""}${l.wrong_because ? ` (wrong_because: ${l.wrong_because})` : ""}`,
        `- reason: ${l.reason}`,
        `- checked: ${(l.checked ?? []).join(", ") || "(not recorded)"}`,
        l.outliers?.length ? `- outlier verdicts: ${l.outliers.map((o) => `${o.symbol}: ${o.verdict}`).join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    vars = {
      ...base,
      COUNT: String(cases.length),
      CASES: cases
        .map((c) => [card(queue.items.find((p) => p.uid === c.uid)), review(1, c.reviews[c.order[0]]), review(2, c.reviews[c.order[1]])].join("\n\n"))
        .join("\n\n---\n\n"),
    };
    expected = cases.map((c) => c.uid);
  } else if (stage === "extract") {
    const sPath = join(runDir, "recall", "sources", `${r.name}.json`);
    if (!existsSync(sPath)) die(`run recall.mjs sources first (missing ${sPath})`);
    const s = readJson(sPath);
    vars = { ...base, SOURCES: s.files.length ? s.files.map((f) => `- \`${f.path}\` (${f.kind})`).join("\n") : "(none found automatically)" };
    expected = null;
  } else {
    const dPath = join(runDir, "recall", "docs", `${r.name}.jsonl`);
    if (!existsSync(dPath)) continue;
    const items = readJsonl(dPath).filter((d) => d.enabled !== false && d.code_checkable !== false);
    if (!items.length) continue;
    const shownIds = new Set(props.map((p) => p.id));
    const poolPath = join(runDir, "pool", `${r.name}.txt`);
    const pool = existsSync(poolPath) ? parseCensus(readFileSync(poolPath, "utf8")).proposals.filter((p) => !shownIds.has(p.id)) : [];
    vars = {
      ...base,
      ITEMS: items.map((d) => `- **${d.ref}** (${d.category}, ${d.strength}; ${d.source}): ${d.statement}  \n  scope: ${d.scope}`).join("\n"),
      SHOWN: props.length ? promptOrder(props, { run: run.run, labeller, repo: r.name, list: "shown" }).map((p) => fence(stripRank(p.block))).join("\n\n") : "(none)",
      POOL: pool.length ? promptOrder(pool, { run: run.run, labeller, repo: r.name, list: "pool" }).map((p) => fence(stripRank(p.block))).join("\n\n") : "(none)",
    };
    expected = items.map((d) => d.ref);
  }
  const text = fill(template(PRACTICE ? (RECALL ? STAGES[stage] : PRACTICE_STAGE === "match" ? "PRACTICE-MATCH-PROMPT.md" : "PRACTICE-PROMPT.md") : STAGES[stage]), vars);
  // the leak check (F1): the whole prompt; and the prompt without its cards for the repo's name
  const frame = fill(template(PRACTICE ? (RECALL ? STAGES[stage] : PRACTICE_STAGE === "match" ? "PRACTICE-MATCH-PROMPT.md" : "PRACTICE-PROMPT.md") : STAGES[stage]), Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, ["PROPOSALS", "UNITS", "CASES", "SHOWN", "POOL", "ITEMS", "SOURCES"].includes(k) ? "" : v])));
  const leaks = F1 ? [...promptLeaks(text), ...promptLeaks(frame, { repo: r.name })] : [];
  if (leaks.length) die(`${r.name}: the ${stage} prompt fails the leak check (${leaks.join(", ")}); nothing was written`);
  const path = join(runDir, "prompts", stage, labeller, `${r.name}.md`);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(box, { mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  writeFileSync(path, text);
  const entry = { stage, labeller, repo: r.name, prompt: path, output, cwd, checkout_status: checkoutStatus(r.checkout), expected, rubric: rubricVersion, rubric_sha256: rubricSha256, ...(model ? { model } : {}), ...(F1 ? { masked_dir: base.REPO_DIR, repo_key: base.REPO } : {}), rendered_at: new Date().toISOString() };
  const i = index.findIndex((e) => e.stage === stage && e.labeller === labeller && e.repo === r.name);
  if (i >= 0) index[i] = entry;
  else index.push(entry);
  written.push(entry);
}
mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
for (const e of written) console.log(`${e.prompt}\n    launch in (cwd) ${e.cwd}\n    -> agent writes ${e.output}${e.expected ? ` (${e.expected.length} records)` : ""}`);
console.error(`${written.length} ${stage} prompts for ${labeller} (rubric ${rubricVersion})`);
