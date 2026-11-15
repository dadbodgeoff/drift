// Precision and yield of Drift's proposals, from final labels.
//
//   node eval/study/metrics.mjs --run eval/study/runs/NAME [--labels FILE|DIR] [--tier-min 15] [--without a,b] [--json OUT]
//
// --labels defaults to <run>/final.jsonl (written by adjudicate.mjs --merge). Any JSONL whose records have
// `label` and either `uid` or `repo` + `id` works, so the v1 labels (eval/study/labels.jsonl) can be scored too.
//
// Reported, per repo, per rule family and overall:
//   shown         proposals the user is shown (census --max, from queue.json)
//   not-wrong     (ACCEPT + TRIVIAL) / labelled        what agents and CI feel as false alarms
//   accept        ACCEPT / labelled
//   yield         ACCEPT per repo (repos with zero proposals count as zero)
// with Wilson 95% intervals and, for pooled rates, two repo-cluster intervals (percentile bootstrap, and a
// cluster-robust t interval as a cross-check) with the number of clusters. When proposals are unlabelled,
// both rates are also given over all shown proposals with the unlabelled counted as WRONG: that is the
// definition the held-out targets use, so leaving hard cases unlabelled cannot raise a target number.
//
// Tiers: the definition pre-registered in run.json (params.tier, written by prepare.mjs before any
// labelling; for held-out runs it comes from the frozen manifest). Two kinds (lib.mjs checkTier/tierOf):
// "min_members" (default tier = role has >= N members) and "rule_kind" (default tier = structured rule kind
// in the pre-registered list AND role has >= N members). Every other shown proposal is suggestion tier; both
// tiers are reported, and the not-wrong rate is always over all shown proposals, both tiers.
// --tier-min N adds an EXPLORATORY row (role has >= N members, any kind); it never replaces the pre-registered one.
//
// Per language and per framework bucket: the pre-registered tiers (default, suggestion) and all shown, with rates
// over all shown (unlabelled counted as WRONG, the target definition), Wilson and the repo-cluster intervals.
// A repo's language and framework_bucket come from run.json (prepare.mjs copies them from the manifest; the
// primary sets record both). Languages are grouped as the held-out sets are: typescript/javascript, python.
//
// Decisions of 2026-11-05, before any held-out census (README.md decision log, lib.mjs TARGET, COURSE_MATERIAL):
//   D1  the default-tier accept target is met when its point estimate, per language, is >= 95%; the verdict is
//       printed in the bold cell for a primary held-out run only; pooled rows are secondary and get none.
//   D4  the not-wrong target (all shown, both tiers) is judged the same way as D1, in its bold cell.
//   D2  the course-material repos of the set (and any --without a,b) stay in; a sensitivity table repeats the
//       per-language rates without them.
//   D3  a repo that failed census or init is reported as a failure, not swapped, and the run continues.
//
// Exposure check: held-out repos whose conventions were named where product engineers could read them are
// listed in the manifest's `exposed` (copied to run.json params.exposed). For held-out runs, every headline
// rate is printed twice, all repos and excluding the exposed ones, so a leak shows as a gap.
// --exclude-repos a,b adds repos to that list (and turns the check on for dev runs).
//
// Completeness: metrics are computed only once the A and B label sets behind the labels are complete: those of the run
// itself when it holds its own labelling (labels/ or label prompts), and those of its part's relabel sub-run when it is
// a staged derived view (<part>/views/<name>, stage.mjs). Repos an adjudication queue records as excluded are left out
// of the check (they stay unlabelled and count as WRONG). --allow-incomplete TEXT computes them anyway and records TEXT
// and the gaps in both outputs (`incomplete`); a carried-only preview before labelling is the usual reason.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  APPROVED_RUBRIC,
  COURSE_MATERIAL,
  D1_MIN_N,
  d1Met,
  widestInterval,
  DECISIONS,
  FAMILIES,
  TARGET,
  NOT_WRONG_CRITERION,
  TARGET_CRITERION,
  LABELS,
  ci,
  clusterBootstrap,
  clusterT,
  checkTier,
  completenessOverride,
  excludedRepos,
  labelSetGaps,
  shownPath,
  describeTier,
  die,
  loadRun,
  parseArgs,
  pct,
  proposalLanguageGroup,
  readJson,
  readJsonlAll,
  ruleKind,
  table,
  tierMinMembers,
  tierOf,
  uidOf,
  wilson,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.run) die("usage: metrics.mjs --run DIR [--labels FILE|DIR] [--tier-min 15] [--json OUT]");
const { run, queue } = loadRun(args.run);
const labelsPath = args.labels ?? join(args.run, "final.jsonl");
if (!existsSync(labelsPath)) die(`no labels at ${labelsPath}${args.labels ? "" : " (run adjudicate.mjs --merge first, or pass --labels)"}`);
const preTier = run.params?.tier ?? null; // { kind: "min_members", value } | { kind: "rule_kind", default, suggestion }
if (preTier && checkTier(preTier).length) die(`run.json params.tier is invalid: ${checkTier(preTier).join("; ")}`);
const tierDef = preTier ?? { kind: "min_members", value: Number(args.tierMin ?? 15) };
const tierMin = tierMinMembers(tierDef);
// A tier is pre-registered when run.json has one and does not say otherwise: a dev manifest without a tier gets the
// min_members default, and a derived view applies a tier after the fact (both carry tier_pre_registered: false).
const preRegistered = !!preTier && run.params?.tier_pre_registered !== false;
const tierNote = preRegistered ? "pre-registered" : preTier ? "NOT pre-registered (run.json params.tier_pre_registered: false)" : "NOT pre-registered (run.json has no params.tier)";
// The rubric: from the run's prompts (prompts/index.json records it per prompt since decision D6; earlier entries
// are v2), else from the label records' own `rubric` field. null when neither says (carried v1-era labels).
const promptIndexPath = join(args.run, "prompts", "index.json");
const promptEntries = existsSync(promptIndexPath) ? readJson(promptIndexPath).filter((e) => e.stage === "label" || e.stage === "adjudicate") : [];
const tierShort = tierDef.kind === "rule_kind" ? `default rule kinds, ≥ ${tierMin} members` : `≥ ${tierMin} members`;
// Under a rule_kind tier, --tier-min N (any kind, >= N members) is always another definition, so always exploratory.
const exploreMin = args.tierMin !== undefined && (Number(args.tierMin) !== tierMin || tierDef.kind !== "min_members") ? Number(args.tierMin) : null;

const hasLabelling = (d) => existsSync(join(d, "labels")) || (existsSync(join(d, "prompts", "index.json")) && readJson(join(d, "prompts", "index.json")).some((e) => e.stage === "label"));
const labelledDirs = [hasLabelling(args.run) ? args.run : null, run.view_of && existsSync(join(args.run, "..", "..", "relabel", "run.json")) ? join(args.run, "..", "..", "relabel") : null].filter(Boolean);
const incomplete = completenessOverride(
  labelledDirs.flatMap((d) => labelSetGaps(d, readJson(join(d, "queue.json")), { skipRepos: excludedRepos(d) }).map((g) => (d === args.run ? g : { ...g, repo: `${g.repo} (${shownPath(d)})` }))),
  args.allowIncomplete,
  "metrics.mjs",
);

const labels = new Map();
for (const r of readJsonlAll(labelsPath)) {
  const uid = uidOf(r);
  if (labels.has(uid)) die(`${labelsPath}: two labels for ${uid}`);
  if (!LABELS.includes(r.label)) die(`${r._src}: bad label ${r.label}`);
  labels.set(uid, r);
}
// F1 (PLAN-R14 WS-F): labels under rubric v4 (cards without Drift's evidence numbers) are never pooled with labels made
// under earlier rubrics, which saw them.
{
  const vs = new Set([...labels.values()].map((r) => r.rubric ?? "not recorded"));
  if (vs.has("v4") && vs.size > 1) die(`${labelsPath}: v4 labels are never mixed with earlier rubrics in one rate (F1); found ${[...vs].sort().join(", ")}`);
}
// F3 (PLAN-R14 WS-F): a run prepared under it (run.json params.decisions has "F3") is judged on n >= 30 and the quoted
// (widest) lower bound; earlier runs keep the 2026-11-05 point-estimate rule (past sets are not re-read).
const F3 = (run.params?.decisions ?? []).includes("F3");
const F3_CRITERION = `met when n ≥ ${D1_MIN_N} and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3, PLAN-R14 WS-F: minimum n ${D1_MIN_N} and the quoted lower bound)`;
const D1_TEXT = F3 ? F3_CRITERION : TARGET_CRITERION;
const D4_TEXT = F3 ? F3_CRITERION.replace("F3, PLAN-R14 WS-F", "F3 for D4, PLAN-R14 WS-F") : NOT_WRONG_CRITERION;
// F4: the same rates with every adjudicated item counted as WRONG.
const labelsAdjWrong = new Map([...labels].map(([u, r]) => [u, r.source === "adjudicated" ? { ...r, label: "WRONG" } : r]));
const adjudicatedCount = [...labels.values()].filter((r) => r.source === "adjudicated").length;
const shownUids = new Set(queue.items.map((p) => p.uid));
const rubricInfo = (() => {
  const label_rubrics = {};
  for (const r of labels.values()) if (shownUids.has(uidOf(r))) label_rubrics[r.rubric ?? "not recorded"] = (label_rubrics[r.rubric ?? "not recorded"] ?? 0) + 1;
  const labelVersions = Object.keys(label_rubrics).filter((k) => k !== "not recorded");
  const unrecorded = !!label_rubrics["not recorded"];
  const promptVersions = [...new Set(promptEntries.map((e) => e.rubric ?? "v2"))];
  // the run's prompts and the scored records (stamped by collect.mjs, carried by adjudicate.mjs --merge)
  const shas = [...new Set([...promptEntries.map((e) => e.rubric_sha256), ...[...labels.values()].map((r) => r.rubric_sha256)].filter(Boolean))];
  let rubric;
  if (args.labels) {
    // scored with --labels: the labels say which rubric they were made under, not this run's prompts
    rubric = labelVersions.length > 1 || (labelVersions.length && unrecorded) ? "mixed" : labelVersions.length ? labelVersions[0] : null;
  } else {
    const v = [...new Set([...promptVersions, ...labelVersions])];
    rubric = v.length > 1 ? "mixed" : v.length ? v[0] : null;
  }
  if (shas.length > 1) rubric = "mixed"; // two rubric texts under one version: never report the version alone
  const sameText = rubric !== "mixed" && rubric !== null && shas.length === 1;
  return { rubric, rubric_sha256: sameText ? shas[0] : null, rubric_sha256s: shas, label_rubrics };
})();
// A held-out run is scored only on the rubric text approved with decision D6 (defence in depth: prepare.mjs and
// prompt.mjs refuse any other).
if (run.manifest?.holdout && (rubricInfo.rubric !== APPROVED_RUBRIC.version || rubricInfo.rubric_sha256 !== APPROVED_RUBRIC.sha256))
  die(`held-out run: its labels are not all under the rubric text approved with decision ${APPROVED_RUBRIC.decision} (${APPROVED_RUBRIC.sha256.slice(0, 12)}): rubric ${rubricInfo.rubric}, texts ${rubricInfo.rubric_sha256s.map((h) => h.slice(0, 12)).join(", ") || "none recorded"}`);
const extra = [...labels.keys()].filter((u) => !shownUids.has(u));

const okRepos = run.repos.filter((r) => r.status === "ok").map((r) => r.name);
const exposed = new Set([...(run.params?.exposed ?? []), ...(args.excludeRepos ? args.excludeRepos.split(",") : [])]);
if (run.manifest?.holdout && existsSync(run.manifest.path)) {
  // the list is append-only: names added after prepare still count
  for (const e of readJson(run.manifest.path).exposed ?? []) exposed.add(e.name);
}
const exposureCheck = run.manifest?.holdout || !!args.excludeRepos;
// A calibration run (run.json `calibration`, written by the run's stage script) relabels a sample to measure a
// rubric change: its rates are not precision results. `calibration: true` takes the default file locations.
const calibration = run.calibration
  ? typeof run.calibration === "object"
    ? { shift: run.calibration.shift ?? null, agreement: run.calibration.agreement ?? null }
    : { shift: join(dirname(String(run.run)), "shift.json"), agreement: join(String(run.run), "agreement.json") }
  : null;
if (calibration) for (const f of [calibration.shift, calibration.agreement]) if (!f || !existsSync(f)) die(`run.json calibration: ${f ?? "a path"} is missing (paths are repo-relative; run from the repo root)`);
const failed = run.repos.filter((r) => r.status !== "ok");
// A run scored on incomplete label sets (--allow-incomplete) is never a headline.
const headlineEligible = !!run.manifest?.holdout && run.manifest?.role === "primary" && !incomplete;

function summarize(items, lab = labels) {
  const c = { shown: items.length, labelled: 0, ACCEPT: 0, TRIVIAL: 0, WRONG: 0 };
  for (const p of items) {
    const l = lab.get(p.uid)?.label;
    if (!l) continue;
    c.labelled++;
    c[l]++;
  }
  c.unlabelled = c.shown - c.labelled;
  c.not_wrong = wilson(c.ACCEPT + c.TRIVIAL, c.labelled);
  c.accept = wilson(c.ACCEPT, c.labelled);
  // Over all shown, unlabelled counted as WRONG (the held-out target definition).
  c.not_wrong_shown = wilson(c.ACCEPT + c.TRIVIAL, c.shown);
  c.accept_shown = wilson(c.ACCEPT, c.shown);
  return c;
}

const inTierAt = (min) => (p) => (p.members ?? 0) >= min;
const inTier = (p) => tierOf(p, tierDef) === "default";
const inSuggestion = (p) => !inTier(p);
const byRepo = (items, names = okRepos) => names.map((name) => ({ name, items: items.filter((p) => p.repo === name) }));

// `names`: the repos (clusters) the pooled rate is over; yield counts each of them, zero proposals included.
function pooled(items, names = okRepos, lab = labels) {
  const s = summarize(items, lab);
  const per = byRepo(items, names).map((r) => summarize(r.items, lab));
  for (const [key, k, n] of [
    ["not_wrong", (x) => x.ACCEPT + x.TRIVIAL, (x) => x.labelled],
    ["accept", (x) => x.ACCEPT, (x) => x.labelled],
    ["not_wrong_shown", (x) => x.ACCEPT + x.TRIVIAL, (x) => x.shown],
    ["accept_shown", (x) => x.ACCEPT, (x) => x.shown],
  ]) {
    const cl = per.map((x) => ({ k: k(x), n: n(x) }));
    s[key].boot = clusterBootstrap(cl);
    s[key].t = clusterT(cl);
    s[key].quoted = widestInterval(s[key], s[key].boot, s[key].t); // F3: the interval to quote
  }
  // Yield counts only fully labelled repos: a repo with unlabelled proposals would read as low yield.
  const yields = per.filter((x) => x.unlabelled === 0).map((x) => x.ACCEPT).sort((a, b) => a - b);
  s.yield = {
    repos: yields.length,
    total: yields.reduce((a, b) => a + b, 0),
    mean: yields.reduce((a, b) => a + b, 0) / (yields.length || 1),
    median: yields.length ? (yields[(yields.length - 1) >> 1] + yields[yields.length >> 1]) / 2 : NaN,
    zero: yields.filter((y) => y === 0).length,
  };
  return s;
}

const all = pooled(queue.items);
const tier = pooled(queue.items.filter(inTier));
const suggestion = pooled(queue.items.filter(inSuggestion));
// Proposals tiered without a structured rule (no conventions.yaml entry): suggestion tier under a rule_kind tier.
const unkinded = tierDef.kind === "rule_kind" ? queue.items.filter((p) => !ruleKind(p.rule)).map((p) => p.uid) : [];
const explore = exploreMin !== null ? pooled(queue.items.filter(inTierAt(exploreMin))) : null;
// Language and framework bucket of each repo, as the manifest categorises it (run.json, from prepare.mjs).
const rowOfRepo = new Map(run.repos.map((r) => [r.name, r]));
function languageGroup(lang) {
  if (!lang) return null;
  if (/typescript|javascript|^tsx?$|^jsx?$/i.test(lang)) return "typescript/javascript";
  if (/python/i.test(lang)) return "python";
  return String(lang).toLowerCase();
}
const languageOf = (name) => languageGroup(rowOfRepo.get(name)?.language) ?? languageGroup(run.manifest?.language) ?? "unknown";
const bucketOf = (name) => rowOfRepo.get(name)?.framework_bucket ?? null;
const groupBy = (names, key) => {
  const m = new Map();
  for (const n of names) (m.get(key(n)) ?? m.set(key(n), []).get(key(n))).push(n);
  return [...m];
};
// Per language, by the CONVENTION's language (lib.mjs proposalLanguageGroup: Python when any member of its role is
// Python, or its example is; decision D7), never by its repo's: a Python repo's frontend rules are TypeScript
// rules. A language's clusters are the repos the manifest gives that language plus any repo with a proposal in it,
// so a repo of the set's language with no proposals is still a zero-yield cluster.
const languageItems = (lang) => (lang ? queue.items.filter((p) => proposalLanguageGroup(p) === lang) : queue.items);
const tiersOver = (names, lang = null, lab = labels) => {
  const set = new Set(names);
  const items = languageItems(lang).filter((p) => set.has(p.repo));
  return { repos: names, overall: pooled(items, names, lab), default_tier: pooled(items.filter(inTier), names, lab), suggestion_tier: pooled(items.filter(inSuggestion), names, lab) };
};
// The set's own language (the manifest's, or the one every repo shares): only its row carries a verdict. A
// TypeScript row of a Python set (its frontends' rules) is reported, but it is not the TypeScript set's result.
const repoLanguages = [...new Set(okRepos.map(languageOf))];
const setLanguage = languageGroup(run.manifest?.language) ?? (repoLanguages.length === 1 && repoLanguages[0] !== "unknown" ? repoLanguages[0] : null);
const LANGUAGE_ORDER = ["typescript/javascript", "python"];
const orderOf = (l) => (LANGUAGE_ORDER.includes(l) ? LANGUAGE_ORDER.indexOf(l) : LANGUAGE_ORDER.length);
const conventionLanguages = [...new Set([...okRepos.map(languageOf).filter((l) => l !== "unknown"), ...queue.items.map(proposalLanguageGroup)])].sort((a, b) => orderOf(a) - orderOf(b));
const reposIn = (lang) => okRepos.filter((n) => languageOf(n) === lang || queue.items.some((p) => p.repo === n && proposalLanguageGroup(p) === lang));
// Per rule family within a language: the same pooled rates, with both repo-cluster intervals (clusters: the
// language's repos that have a proposal of that family in that tier), for every family with a shown proposal.
// No secondary script is needed for a per-family interval (runs/dev-v3-relabel-2026-11-06/family-d7.mjs did it).
const familiesOver = (names, lang) => {
  const set = new Set(names);
  const items = languageItems(lang).filter((p) => set.has(p.repo));
  return Object.keys(FAMILIES)
    .map((f) => {
      const fi = items.filter((p) => p.family === f);
      return { family: f, name: FAMILIES[f], overall: pooled(fi, names), default_tier: pooled(fi.filter(inTier), names), suggestion_tier: pooled(fi.filter(inSuggestion), names) };
    })
    .filter((f) => f.overall.shown);
};
const byLanguage = conventionLanguages
  .map((language) => [language, reposIn(language)])
  .filter(([, names]) => names.length)
  .map(([language, names]) => {
    const g = { language, set_language: setLanguage === null || setLanguage === language, ...tiersOver(names, language) };
    const verdict = headlineEligible && g.set_language;
    const p = g.default_tier.accept_shown.p;
    g.target = { criterion: D1_TEXT, rule: F3 ? "F3" : "D1", threshold: TARGET, default_tier_accept: Number.isFinite(p) ? p : null, met: verdict && Number.isFinite(p) ? d1Met(g.default_tier.accept_shown, { f3: F3, target: TARGET }) : null };
    const q = g.overall.not_wrong_shown.p;
    g.not_wrong_target = { criterion: D4_TEXT, rule: F3 ? "F3" : "D4", threshold: TARGET, not_wrong: Number.isFinite(q) ? q : null, met: verdict && Number.isFinite(q) ? d1Met(g.overall.not_wrong_shown, { f3: F3, target: TARGET }) : null };
    g.families = familiesOver(names, language);
    return g;
  });
// D2: per-language rates again without the set's course-material repos (and any --without).
const without = [...new Set([...(COURSE_MATERIAL[run.manifest?.set_id] ?? []), ...(args.without ? String(args.without).split(",").filter(Boolean) : [])])].filter((n) => okRepos.includes(n));
const sensitivity = without.length
  ? {
      without,
      by_language: byLanguage.map(({ language, repos: names }) => {
        const rest = names.filter((n) => !without.includes(n));
        return { language, removed: names.filter((n) => without.includes(n)), with: tiersOver(names, language), without: tiersOver(rest, language) };
      }),
    }
  : null;
const adjudicatedAsWrong = { adjudicated: adjudicatedCount, by_language: byLanguage.map(({ language, repos: names }) => ({ language, ...tiersOver(names, language, labelsAdjWrong) })) };
const hasBuckets = okRepos.some((n) => bucketOf(n));
const byFramework = hasBuckets
  ? byLanguage.flatMap(({ language, repos: names }) => groupBy(names, (n) => bucketOf(n) ?? "(none)").map(([framework_bucket, ns]) => ({ language, framework_bucket, ...tiersOver(ns, language) })))
  : [];

const repos = byRepo(queue.items).map((r) => ({ name: r.name, language: languageOf(r.name), framework_bucket: bucketOf(r.name), ...summarize(r.items), tier: summarize(r.items.filter(inTier)) }));
const families = Object.keys(FAMILIES)
  .map((f) => ({ family: f, name: FAMILIES[f], ...summarize(queue.items.filter((p) => p.family === f)), tier: summarize(queue.items.filter((p) => p.family === f && inTier(p))) }))
  .filter((f) => f.shown);

// Diagnostic breakdowns available with v2 labels.
const why = { trivial_by: {}, wrong_because: {} };
for (const p of queue.items) {
  const l = labels.get(p.uid);
  const by = l?.trivial_by === "lint" && l.lint_severity ? `lint (${l.lint_severity})` : l?.trivial_by;
  if (l?.label === "TRIVIAL" && by) why.trivial_by[by] = (why.trivial_by[by] ?? 0) + 1;
  if (l?.label === "WRONG" && l.wrong_because) why.wrong_because[l.wrong_because] = (why.wrong_because[l.wrong_because] ?? 0) + 1;
}

const rate = (w) =>
  !Number.isFinite(w.p)
    ? "–"
    : `${ci(w, 1)}${!w.boot ? "" : w.boot.clusters < 2 ? ` (${w.boot.clusters} repo: no cluster interval)` : ` (${w.boot.clusters} repos: bootstrap ${pct(w.boot.lo, 1)}–${pct(w.boot.hi, 1)}, cluster-t ${pct(w.t.lo, 1)}–${pct(w.t.hi, 1)})`}`;
const out = [];
const secondary = run.manifest?.role === "secondary";
out.push(`# Precision: ${run.run}${secondary ? " (SECONDARY — not a headline result)" : ""}`);
out.push("");
if (incomplete) {
  out.push(`> **Computed on INCOMPLETE A/B label sets** (\`--allow-incomplete\`: ${incomplete.reason}). Not labelled: ${incomplete.gaps.join("; ")}.`);
  out.push("");
}
if (secondary) {
  out.push(`> **SECONDARY — not a headline result.** Held-out set ${run.manifest.set_id} was demoted to secondary before any held-out data (see its manifest's \`decision\`): its repos' conventions were exposed. Report these numbers only as an exploratory secondary check, with the exposure disclosed.`);
  out.push("");
}
out.push(`- drift: ${run.drift.version} commit ${run.drift.commit ?? "unrecorded"}${run.drift.dirty ? " (DIRTY)" : ""}, binary sha256 ${run.drift.binary_sha256.slice(0, 12)}`);
out.push(`- manifest: ${run.manifest.path}${run.manifest.holdout ? " (HELD-OUT)" : ""}, ${okRepos.length} repos ok${failed.length ? `, ${failed.length} failed: ${failed.map((r) => r.name).join(", ")}` : ""}`);
if (failed.length)
  out.push(`- **${failed.length} repos failed** (decision D3: reported as failures, not swapped; the run continues with the rest): ${failed.map((r) => `${r.name} (${r.status})`).join("; ")}`);
out.push(`- labels: ${labelsPath} (${labels.size} records${extra.length ? `; ${extra.length} not in this run's queue, ignored` : ""})`);
if (calibration) out.push(`- kind: **calibration** (a relabel that measures a rubric change, not a precision result): shift ${calibration.shift}, agreement ${calibration.agreement}`);
out.push(`- default tier: ${describeTier(tierDef)} (${tierNote})`);
out.push(`- rubric: ${rubricInfo.rubric ?? "not recorded"}${rubricInfo.rubric_sha256 ? ` (labeller-facing text sha256 ${rubricInfo.rubric_sha256.slice(0, 12)}…)` : rubricInfo.rubric_sha256s.length > 1 ? ` (MIXED rubric texts: ${rubricInfo.rubric_sha256s.map((h) => h.slice(0, 12)).join(", ")})` : ""}; label records by rubric: ${Object.entries(rubricInfo.label_rubrics).map(([k, v]) => `${k} ${v}`).join(", ")}`);
out.push(`- decisions: ${DECISIONS.map((d) => `${d.id} (${d.status})`).join(", ")}; see README.md decision log`);
if (unkinded.length) out.push(`- ${unkinded.length} shown proposals have no structured rule and are suggestion tier: ${unkinded.join(", ")}`);
out.push("");
out.push("## Overall");
out.push("");
out.push(
  table(
    ["", "Shown", "Labelled", "ACCEPT", "TRIVIAL", "WRONG", "Not-wrong rate", "Accept rate", "Yield (ACCEPT/repo)"],
    [
      ["All proposals", all],
      [`Default tier (${tierShort}, ${preRegistered ? "pre-registered" : "not pre-registered"})`, tier],
      [`Suggestion tier (everything else)`, suggestion],
    ].map(([n, s]) => [
      n,
      s.shown,
      s.labelled,
      s.ACCEPT,
      s.TRIVIAL,
      s.WRONG,
      rate(s.not_wrong),
      rate(s.accept),
      `${s.yield.mean.toFixed(1)} mean, ${s.yield.median} median, ${s.yield.zero}/${s.yield.repos} repos with none${s.yield.repos < okRepos.length ? ` (${okRepos.length - s.yield.repos} partly labelled repos excluded)` : ""}`,
    ]),
  ),
);
if (all.unlabelled) {
  const hiA = wilson(all.ACCEPT + all.unlabelled, all.shown).p;
  const hiN = wilson(all.ACCEPT + all.TRIVIAL + all.unlabelled, all.shown).p;
  out.push("");
  out.push(`**${all.unlabelled} shown proposals have no label** (excluded above). Over all ${all.shown} shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:`);
  out.push("");
  out.push(
    table(
      ["", "Not-wrong", "Accept"],
      [
        ["All proposals, unlabelled = WRONG", rate(all.not_wrong_shown), rate(all.accept_shown)],
        [`Default tier, unlabelled = WRONG`, rate(tier.not_wrong_shown), rate(tier.accept_shown)],
        [`Suggestion tier, unlabelled = WRONG`, rate(suggestion.not_wrong_shown), rate(suggestion.accept_shown)],
        ["All proposals, unlabelled = ACCEPT (upper bound)", pct(hiN, 1), pct(hiA, 1)],
      ],
    ),
  );
  out.push("");
  out.push(`Unlabelled: ${queue.items.filter((p) => !labels.has(p.uid)).map((p) => p.uid).join(", ")}`);
}
let exposure = null;
if (exposureCheck) {
  const hit = okRepos.filter((n) => exposed.has(n));
  const clean = pooled(queue.items.filter((p) => !exposed.has(p.repo)));
  const cleanTier = pooled(queue.items.filter((p) => !exposed.has(p.repo) && inTier(p)));
  exposure = { exposed: hit, clean: { repos: okRepos.length - hit.length, ...clean }, clean_tier: cleanTier };
  out.push("");
  out.push(`## Exposure check: all repos vs excluding exposed (${hit.length} of ${okRepos.length} repos exposed)`);
  out.push("");
  out.push(`Exposed: ${hit.join(", ") || "none"}. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.`);
  out.push("");
  const rowOf = (name, s, t, n) => [name, n, s.shown, rate(s.not_wrong_shown), rate(s.accept_shown), rate(t.accept_shown), `${pct(s.not_wrong.p, 1)} / ${pct(s.accept.p, 1)}`, s.yield.mean.toFixed(1)];
  out.push(
    table(
      ["", "Repos", "Shown", "Not-wrong", "Accept", "Default-tier accept", "(labelled: not-wrong / accept)", "Yield"],
      [rowOf("All repos", all, tier, okRepos.length), rowOf("Excluding exposed", clean, cleanTier, okRepos.length - hit.length)],
    ),
  );
  if (okRepos.length - hit.length < 5) out.push("", `Only ${okRepos.length - hit.length} unexposed repos: the comparison has little power; report it, but do not read a small gap as evidence of no leak.`);
}
{
  out.push("");
  out.push("## Per language and tier");
  out.push("");
  out.push(
    `Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is ${D1_TEXT}; the not-wrong target is ${D4_TEXT}; the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict.${headlineEligible ? "" : incomplete ? " Incomplete label sets (--allow-incomplete): no verdicts." : " Not a primary held-out run: no verdicts."}`,
  );
  out.push("");
  const tierRows = (label, g) => [
    [label, "Default tier", g.default_tier],
    [label, "Suggestion tier", g.suggestion_tier],
    [label, "All shown (both tiers)", g.overall],
  ];
  const groups = byLanguage.length > 1 ? [...byLanguage, { language: "all languages (pooled, secondary)", pooled: true, ...tiersOver(okRepos) }] : byLanguage;
  // No proposals in the denominator: no verdict, as the JSON's met: null (never NOT MET from NaN >= 0.95).
  const verdictIn = (g) => (w, none) =>
    !Number.isFinite(w.p) ? `no verdict (${none}, n = 0)` : !headlineEligible ? (incomplete ? "no verdict (incomplete label sets, --allow-incomplete)" : "no verdict (not a primary held-out run)") : g.set_language === false ? "no verdict (not this set's language)" : d1Met(w, { f3: F3, target: TARGET }) ? "MET" : "NOT MET";
  out.push(
    table(
      ["Language", "Tier", "Repos", "Shown", "Labelled", "ACCEPT", "TRIVIAL", "WRONG", "Accept", "Not-wrong"],
      groups.flatMap((g) => {
        const verdict = verdictIn(g);
        return tierRows(g.language, g).map(([lang, t, s]) => [
          lang,
          t,
          g.repos.length,
          s.shown,
          s.labelled,
          s.ACCEPT,
          s.TRIVIAL,
          s.WRONG,
          t === "Default tier" && !g.pooled
            ? `**${rate(s.accept_shown)}**; target ${D1_TEXT}: **${verdict(s.accept_shown, "no default-tier proposals")}**`
            : rate(s.accept_shown),
          t.startsWith("All") && !g.pooled ? `**${rate(s.not_wrong_shown)}**; target ${D4_TEXT}: **${verdict(s.not_wrong_shown, "no proposals shown")}**` : rate(s.not_wrong_shown),
        ]);
      }),
    ),
  );
  out.push("");
  // F4: the same rows with every adjudicated item counted as WRONG
  out.push(`With adjudicated items counted as WRONG (F4; ${adjudicatedCount} adjudicated):`);
  out.push("");
  out.push(table(["Language", "Default-tier accept", "Not-wrong (all shown)"], adjudicatedAsWrong.by_language.map((g) => [g.language, rate(g.default_tier.accept_shown), rate(g.overall.not_wrong_shown)])));
  out.push("");
  out.push("## Per language, tier and rule family");
  out.push("");
  out.push("Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.");
  out.push("");
  out.push(
    table(
      ["Language", "Family", "Tier", "Shown", "ACCEPT", "TRIVIAL", "WRONG", "Accept", "Not-wrong"],
      byLanguage.flatMap((g) =>
        g.families.flatMap((f) =>
          [
            ["Default tier", f.default_tier],
            ["Suggestion tier", f.suggestion_tier],
            ["All shown", f.overall],
          ]
            // "All shown" only when both tiers have proposals (otherwise it repeats the one tier's row)
            .filter(([t, x]) => x.shown && (t !== "All shown" || (f.default_tier.shown && f.suggestion_tier.shown)))
            .map(([t, x]) => [g.language, f.name, t, x.shown, x.ACCEPT, x.TRIVIAL, x.WRONG, rate(x.accept_shown), rate(x.not_wrong_shown)]),
        ),
      ),
    ),
  );
  if (sensitivity) {
    out.push("");
    out.push(`## Sensitivity: without ${sensitivity.without.join(", ")} (decision D2)`);
    out.push("");
    out.push("Course-material repos stay in, as pre-registered: the with-them rows are the result, the without-them rows a sensitivity check. Over all shown, unlabelled counted as WRONG.");
    out.push("");
    out.push(
      table(
        ["Language", "Repos", "", "Shown", "Default n", "Default-tier accept", "Not-wrong (all shown)"],
        sensitivity.by_language.flatMap((g) =>
          [
            ["with them (result)", g.with],
            [g.removed.length ? `without ${g.removed.join(", ")}` : "without (none of them in this language)", g.without],
          ].map(([what, x]) => [g.language, x.repos.length, what, x.overall.shown, x.default_tier.shown, rate(x.default_tier.accept_shown), rate(x.overall.not_wrong_shown)]),
        ),
      ),
    );
  }
  if (byFramework.length) {
    out.push("");
    out.push("## Per framework bucket");
    out.push("");
    out.push("Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.");
    out.push("");
    out.push(
      table(
        ["Language", "Framework bucket", "Repos", "Shown", "Default n", "Default-tier accept", "Suggestion n", "Suggestion accept", "Not-wrong (all shown)"],
        byFramework.map((g) => [g.language, g.framework_bucket, g.repos.length, g.overall.shown, g.default_tier.shown, rate(g.default_tier.accept_shown), g.suggestion_tier.shown, rate(g.suggestion_tier.accept_shown), rate(g.overall.not_wrong_shown)]),
      ),
    );
  }
}
if (explore) {
  out.push("");
  out.push(`## Exploratory, not pre-registered: tier ≥ ${exploreMin} members, any rule kind`);
  out.push("");
  out.push(`Not a result: the pre-registered tier is ${describeTier(tierDef)}. Shown ${explore.shown}, labelled ${explore.labelled}; not-wrong ${rate(explore.not_wrong)}; accept ${rate(explore.accept)}.`);
}
out.push("");
out.push("## Per repo");
out.push("");
out.push(
  table(
    ["Repo", "Shown", "A", "T", "W", "Not-wrong", "Accept", "Yield", `Tier n`, "Tier accept"],
    repos.map((r) => [r.name, r.shown, r.ACCEPT, r.TRIVIAL, r.WRONG, ci(r.not_wrong), ci(r.accept), r.ACCEPT, r.tier.shown, ci(r.tier.accept)]),
  ),
);
out.push("");
out.push("## Per rule family");
out.push("");
out.push(
  table(
    ["Family", "n", "A", "T", "W", "Accept", "Not-wrong", "Tier n", "Tier accept"],
    families.map((f) => [f.name, f.shown, f.ACCEPT, f.TRIVIAL, f.WRONG, ci(f.accept), ci(f.not_wrong), f.tier.shown, ci(f.tier.accept)]),
  ),
);
if (Object.keys(why.trivial_by).length || Object.keys(why.wrong_because).length) {
  out.push("");
  out.push("## Why not accepted");
  out.push("");
  out.push(`- TRIVIAL by: ${Object.entries(why.trivial_by).map(([k, v]) => `${k} ${v}`).join(", ") || "–"}`);
  out.push(`- WRONG because: ${Object.entries(why.wrong_because).map(([k, v]) => `${k} ${v}`).join(", ") || "–"}`);
}
console.log(out.join("\n"));

if (args.json) {
  const plain = (s) => JSON.parse(JSON.stringify(s));
  writeFileSync(
    args.json,
    JSON.stringify(
      { run: run.run, kind: calibration ? "calibration" : "precision", ...(calibration ? { calibration } : {}), secondary, headline_eligible: headlineEligible, ...(incomplete ? { incomplete } : {}), drift: run.drift, manifest: run.manifest, labels: labelsPath, rubric: rubricInfo.rubric, rubric_sha256: rubricInfo.rubric_sha256, rubric_sha256s: rubricInfo.rubric_sha256s, label_rubrics: rubricInfo.label_rubrics, decisions: DECISIONS, tier: { definition: tierDef, min_members: tierMin, pre_registered: preRegistered, unkinded }, overall: plain(all), default_tier: plain(tier), suggestion_tier: plain(suggestion), exploratory: explore && { min_members: exploreMin, ...plain(explore) }, exposure: exposure && plain(exposure), failed_repos: failed.map((r) => ({ name: r.name, status: r.status })), by_language: plain(byLanguage), adjudicated_as_wrong: plain(adjudicatedAsWrong), f3: F3, sensitivity: sensitivity && plain(sensitivity), by_framework: plain(byFramework), repos: plain(repos), families: plain(families), why },
      null,
      2,
    ) + "\n",
  );
}
