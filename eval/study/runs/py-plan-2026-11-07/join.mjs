// Joins a census of the Python dev clones at main with the rubric v3 dev labels (runs/dev-v3-2026-11-06), for the
// Python default-tier plan (README.md here). Analysis only: nothing in the product reads it. Run from the root of
// the checkout after the census (README "Commands"):
//
//   node eval/study/runs/py-plan-2026-11-07/join.mjs --census <dir>
//
// <dir>/<part>/<repo>.json is `drift census --json --max 15`; <dir>/<part>/<repo>.txt is
// `drift census --all-outliers --max 15`, the text a labeller is shown (the labelled run's proposals/<repo>.txt
// format), used only to decide card identity. For each part (py, py2) it writes <part>/join.json: every shown
// proposal with its rule kind, the product's tier and tier reason, and its v3 label when, and only when, the card is
// byte-identical to the labelled one (stage.mjs rule 4: same uid, same repo pin, same census block without rank and
// tier line). Otherwise `status` is "changed" (the uid was labelled, its card differs: the old and new lines are
// listed) or "new" (the uid was not shown at debc33a); neither has a label. It also lists the labelled uids no longer
// shown ("gone"). summary.json holds the per-kind counts and the subsets the README discusses.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { die, namesPackage, parseArgs, parseCensus, readJson, readJsonl, ruleKind, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const LABELLED = join(here, "..", "dev-v3-2026-11-06");
const args = parseArgs(process.argv.slice(2));
if (!args.census) die("--census <dir> is required");
const censusDir = resolve(args.census);
const card = (block) => block.replace(/^\s*\d+\. /, ""); // stage.mjs / prompt.mjs stripRank
// Repos the brief forbids scanning; their labels exist in py/final.jsonl but they are not in this census.
const NOT_SCANNED = new Set(["polar", "CTFd"]);

// The rule-kind groups of the plan.
export function kindGroup(p) {
  const k = p.rule_kind;
  if (k === "wrapped_by:decorator") return "decorator";
  if (k === "wrapped_by:extends") return "base";
  if (k === "wrapped_by:call") return callKind(p.rule);
  if (k === "passes_key") return "passes_key";
  if (k === "avoids:import") return "layering";
  return "other";
}
// A Python call wrapper is a FastAPI dependency (`Depends(f)` / `Security(f)` in the handler's signature) or a DRF
// `permission_classes` entry; either way the rule names the wrapped callable. Split by what that callable is, from
// its name only: an auth guard (login, admin, permission, org/tenant context, API key, current user) or a resource
// dependency (a database session or connection). Every alternative of any_of must fall in the class; otherwise
// call:mixed.
const AUTH = /(auth|login|admin|permission|^Is[A-Z]|^Has[A-Z]|current_(user|developer)|api_?key|token|require)/i;
const RESOURCE = /(^|_)(db|session|database|redis|conn(ection)?)(_|$)|_db_|get_db/i;
function callKind(rule) {
  const names = (rule?.any_of ?? []).map((s) => String(s).split("#").pop().split(".").pop());
  if (names.length && names.every((n) => AUTH.test(n))) return "call:auth";
  if (names.length && names.every((n) => RESOURCE.test(n))) return "call:resource";
  return "call:mixed";
}

const pct = (w) => (Number.isFinite(w.p) ? `${(100 * w.p).toFixed(1)}%` : "n/a");
const fmtW = (w) => (w.n ? `${pct(w)} (${w.k}/${w.n}); Wilson ${(100 * w.lo).toFixed(1)}–${(100 * w.hi).toFixed(1)}%` : "n/a (0 shown)");

const parts = {};
for (const part of ["py", "py2"]) {
  const run = readJson(join(LABELLED, part, "run.json"));
  const queue = new Map(readJson(join(LABELLED, part, "queue.json")).items.map((p) => [p.uid, p]));
  const labels = new Map(readJsonl(join(LABELLED, part, "final.jsonl")).map((f) => [f.uid, f]));
  const rows = [];
  const scanned = [];
  for (const r of run.repos) {
    if (NOT_SCANNED.has(r.name)) continue;
    const jf = join(censusDir, part, `${r.name}.json`);
    const tf = join(censusDir, part, `${r.name}.txt`);
    if (!existsSync(jf) || !existsSync(tf)) die(`${part}/${r.name}: census output missing in ${censusDir}`);
    const js = JSON.parse(readFileSync(jf, "utf8"));
    const text = parseCensus(readFileSync(tf, "utf8"));
    const ids = js.proposals.map((p) => p.id).join(",");
    if (ids !== text.proposals.map((p) => p.id).join(",")) die(`${part}/${r.name}: the JSON and text census list different proposals`);
    scanned.push({ repo: r.name, sha: r.sha, shown: js.proposals.length, tiers: js.tiers, commit: js.commit });
    const blocks = new Map(text.proposals.map((p) => [p.id, p]));
    for (const p of js.proposals) {
      const uid = `${r.name}/${p.id}`;
      const t = blocks.get(p.id);
      const old = queue.get(uid);
      const lab = labels.get(uid);
      const now = card(t.block);
      let status;
      let diff = null;
      if (!old) status = "new";
      else if (card(old.block) === now) status = lab ? "identical" : "identical_unlabelled";
      else {
        status = "changed";
        const a = card(old.block).split("\n");
        const b = now.split("\n");
        diff = { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
      }
      const row = {
        uid,
        repo: r.name,
        id: p.id,
        rank: p.rank,
        summary: p.summary,
        rule_kind: p.rule_kind ?? ruleKind(p.rule),
        group: null,
        tier: p.tier,
        tier_reason: p.tier_reason,
        language: p.language,
        names_package: p.names_package ?? namesPackage(p.rule),
        members: p.role?.members ?? null,
        evidence: { holders: p.evidence?.holders, total: p.evidence?.total, lower_bound: p.evidence?.lower_bound, lift: p.evidence?.lift },
        rule: p.rule,
        example: `${p.example.path}#${p.example.symbol}`,
        outliers: p.outliers_total,
        exempt: p.exempt?.length ?? 0,
        status,
        label: status === "identical" ? lab.label : null,
        wrong_because: status === "identical" ? lab.wrong_because : null,
        trivial_by: status === "identical" ? lab.trivial_by : null,
        label_reason: status === "identical" ? lab.reason : null,
        // For a changed card only: what the old card was labelled. Not this card's label; never counted as one.
        old_label: status === "changed" && lab ? { label: lab.label, wrong_because: lab.wrong_because } : null,
        diff,
        block: now,
      };
      row.group = kindGroup(row);
      // The D5 conditions a Python default tier would keep on top of the rule kind (tier-d7.json): every symbol
      // the rule names is in the repository, and the role has >= 15 members.
      row.d5_conditions = !row.names_package && (row.members ?? 0) >= js.params.tier.min_members;
      rows.push(row);
    }
  }
  const shownNow = new Set(rows.map((r) => r.uid));
  const gone = [...queue.values()]
    .filter((p) => !NOT_SCANNED.has(p.repo) && !shownNow.has(p.uid))
    .map((p) => ({ uid: p.uid, rule_kind: p.rule_kind, summary: p.summary, label: labels.get(p.uid)?.label ?? null, wrong_because: labels.get(p.uid)?.wrong_because ?? null }));
  parts[part] = { rows, gone, scanned };
  writeFileSync(
    join(here, part, "join.json"),
    JSON.stringify({ part, labels_from: `eval/study/runs/dev-v3-2026-11-06/${part}/final.jsonl`, labelled_at: run.drift.commit, not_scanned: [...NOT_SCANNED].filter((n) => run.repos.some((r) => r.name === n)), scanned, proposals: rows, gone }, null, 2) + "\n",
  );
}

// ---------- summary ----------
// Python figures are over the Python proposals only (census `language: "py"`, the product's convention_language):
// the TypeScript-side proposals of these repos' frontends are TypeScript under D7 and are counted apart.
const shownAll = [...parts.py.rows, ...parts.py2.rows];
const all = shownAll.filter((r) => r.language === "py");
const tsSide = shownAll.filter((r) => r.language !== "py");
const GROUPS = ["call:auth", "call:resource", "call:mixed", "decorator", "base", "passes_key", "layering", "other"];
function tally(rows) {
  const c = { shown: rows.length, ACCEPT: 0, TRIVIAL: 0, WRONG: 0, unlabelled: 0, changed: 0, new: 0, wrong_because: {} };
  for (const r of rows) {
    if (r.label) c[r.label]++;
    else c.unlabelled++;
    if (r.status === "changed") c.changed++;
    if (r.status === "new") c.new++;
    if (r.label === "WRONG") c.wrong_because[r.wrong_because ?? "none"] = (c.wrong_because[r.wrong_because ?? "none"] ?? 0) + 1;
  }
  const labelled = c.ACCEPT + c.TRIVIAL + c.WRONG;
  // The target definition: ACCEPT over all shown, unlabelled counted as WRONG. Then two bounds that are not
  // labels: over the labelled cards only, and the ceiling if every unlabelled card came back ACCEPT.
  c.accept_all_shown = wilson(c.ACCEPT, c.shown);
  c.accept_labelled = wilson(c.ACCEPT, labelled);
  c.accept_ceiling = wilson(c.ACCEPT + c.unlabelled, c.shown);
  return c;
}
const by = (rows, f) => Object.fromEntries([...new Set(rows.map(f))].sort().map((k) => [k, rows.filter((r) => f(r) === k)]));
const line = (r) => `${r.uid} [${r.rule_kind}] ${r.label ?? r.status}${r.wrong_because ? ` ${r.wrong_because}` : ""}${r.old_label ? ` (old card: ${r.old_label.label}${r.old_label.wrong_because ? ` ${r.old_label.wrong_because}` : ""})` : ""}`;
const summary = {
  note: "Dev figures (py was used for tuning, py2 is a dev set too): optimistic, never a held-out result. accept_all_shown is the target definition (unlabelled counted as WRONG); accept_labelled and accept_ceiling are bounds, not labels.",
  census: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.scanned])),
  status: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Object.fromEntries(Object.entries(by(v.rows, (r) => r.status)).map(([s, rs]) => [s, rs.length]))])),
  unlabelled: shownAll.filter((r) => !r.label).map((r) => `${line(r)} lang=${r.language}`),
  gone: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.gone.map((g) => `${g.uid} [${g.rule_kind}] ${g.label}${g.wrong_because ? ` ${g.wrong_because}` : ""}`)])),
  python: {
    all: tally(all),
    all_d5_conditions: tally(all.filter((r) => r.d5_conditions)),
    by_group: {},
    by_group_d5_conditions: {},
    by_rule_kind: Object.fromEntries(Object.entries(by(all, (r) => r.rule_kind ?? "none")).map(([k, rs]) => [k, tally(rs)])),
    wrong: Object.fromEntries(Object.entries(by(all.filter((r) => r.label === "WRONG"), (r) => r.wrong_because ?? "none")).map(([k, rs]) => [k, rs.map((r) => ({ uid: r.uid, group: r.group, d5_conditions: r.d5_conditions, summary: r.summary, reason: r.label_reason }))])),
  },
  typescript_side: { all: tally(tsSide), uids: tsSide.map(line) },
};
for (const g of GROUPS) {
  const rows = all.filter((r) => r.group === g);
  summary.python.by_group[g] = { py: tally(rows.filter((r) => parts.py.rows.includes(r))), py2: tally(rows.filter((r) => parts.py2.rows.includes(r))), both: tally(rows), uids: rows.map(line) };
  summary.python.by_group_d5_conditions[g] = tally(rows.filter((r) => r.d5_conditions));
}
// Candidate subsets (README "Smallest subset"): Python proposals of these kinds, under the D5 conditions.
const subset = (name, f) => {
  const rows = all.filter((r) => r.d5_conditions && f(r));
  return { name, ...tally(rows), repos: [...new Set(rows.map((r) => r.repo))].length, uids: rows.map(line) };
};
const isCall = (r) => r.group.startsWith("call:");
summary.subsets = [
  subset("auth call wrappers + layering", (r) => r.group === "call:auth" || r.group === "layering"),
  subset("auth call wrappers", (r) => r.group === "call:auth"),
  subset("layering", (r) => r.group === "layering"),
  subset("call wrappers (all) + layering", (r) => isCall(r) || r.group === "layering"),
  subset("call wrappers + layering + decorators", (r) => isCall(r) || r.group === "layering" || r.group === "decorator"),
  subset("D5 Python kinds (call, decorator, base, passes_key, layering)", (r) => r.group !== "other"),
];
// Wilson lower bound with zero WRONG, by n: how many clean dev cards it takes to show >= 95% with 95% confidence.
summary.zero_wrong_n_for_lower_95 = (() => {
  for (let n = 1; n < 500; n++) if (wilson(n, n).lo >= 0.95) return n;
  return null;
})();
writeFileSync(join(here, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

const P = summary.python;
console.log(`python: ${P.all.shown} shown (A ${P.all.ACCEPT} T ${P.all.TRIVIAL} W ${P.all.WRONG} unl ${P.all.unlabelled}) ${fmtW(P.all.accept_all_shown)}; typescript side ${summary.typescript_side.all.shown}`);
for (const g of GROUPS) {
  const t = P.by_group[g].both;
  const d = P.by_group_d5_conditions[g];
  console.log(`${g.padEnd(13)} shown ${String(t.shown).padStart(3)}  A ${t.ACCEPT} T ${t.TRIVIAL} W ${t.WRONG} unl ${t.unlabelled}  all-shown ${fmtW(t.accept_all_shown)}  | D5-cond ${d.shown}: A ${d.ACCEPT} W ${d.WRONG} unl ${d.unlabelled}, ${fmtW(d.accept_all_shown)}, ceiling ${fmtW(d.accept_ceiling)}  ${JSON.stringify(t.wrong_because)}`);
}
for (const s of summary.subsets) console.log(`subset ${s.name} (${s.repos} repos): ${fmtW(s.accept_all_shown)}; labelled only ${fmtW(s.accept_labelled)}; ceiling ${fmtW(s.accept_ceiling)}`);
console.log(`status ${JSON.stringify(summary.status)} gone ${JSON.stringify(summary.gone)}; zero-WRONG n for Wilson lower >= 95%: ${summary.zero_wrong_n_for_lower_95}`);
