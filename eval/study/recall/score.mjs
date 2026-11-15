#!/usr/bin/env node
// Aggregate the recall11 walk records (walk.mjs) into recall, warning rate and fixed share, per language, fold, tier,
// rule family and visibility class (eval/study/research/2026-11-09/recall11.md).
//
//   node eval/study/recall/score.mjs --records DIR [--folds eval/study/folds-r11.json]
//        [--table crates/drift-mine/data/show-policy.json] [--json OUT] [--md OUT] [--cards OUT] [--card-folds 1,2,3,4]
//
// Views: TS/JS repos are read with the product defaults; Python repos both ways: `default` (Python proposals off,
// D13-py, so every Python card is `python_off`) and `optin` (`proposals: {python: on}`), the view the study reports for
// Python. --cards writes the deviation-level detail, for the folds named by --card-folds only (folds 1-4 by default:
// fold 5 is dev3, cited by aggregates only [STRICT]).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARMS, armOf, familyOfKind, groupStatus, inArm, isNew, shownUnderP1, recallByArm, track, visibilityClass, warningsByArm } from "./lib.mjs";
import { die, parseArgs, wilson } from "../lib.mjs";

const a = parseArgs(process.argv.slice(2), {
  defaults: { folds: "eval/study/folds-r11.json", table: "crates/drift-mine/data/show-policy.json", cardFolds: "1,2,3,4" },
});
const folds = JSON.parse(readFileSync(a.folds, "utf8"));
const table = JSON.parse(readFileSync(a.table, "utf8"));
const foldOf = new Map();
for (const f of folds.folds) for (const lang of ["ts", "py"]) for (const r of f[lang]) foldOf.set(`${lang}:${r}`, f.fold);
const cardFolds = new Set(a.cardFolds.split(",").map(Number));

const familyName = (kind) => familyOfKind(table, kind) ?? `none:${kind}`;

// The labelled card precision of a family: suggestion-tier ACCEPT / labelled of the show table's dev run (rubric v3,
// in-sample), overall and per fold of the build set; "?" for repos outside folds-r11.json.
export function labelAccept(lang, family) {
  const rec = (table.languages[lang] || {})[family];
  if (!rec) return null;
  const folds = {};
  for (const [repo, c] of Object.entries(rec.repos)) {
    const f = foldOf.get(`${lang}:${repo}`) ?? "?";
    const x = (folds[f] ||= { accepted: 0, n: 0 });
    x.accepted += c.accepted;
    x.n += c.n;
  }
  return { accepted: rec.accepted, n: rec.n, folds };
}

// ---------- per repo ----------
export function scoreRecord(rec) {
  const byId = (k, pred = () => true) => new Map(rec.census[k].cards.filter(pred).map((c) => [c.id, c]));
  const shown = byId("shown", (c) => c.shown_by_default);
  const shownPy = byId("shown_py", (c) => c.shown_by_default);
  const pool = byId("pool");
  const poolPy = byId("pool_py");
  const p1 = shownUnderP1([...pool.values()]);
  const p1Py = shownUnderP1([...poolPy.values()]);
  const p1b = shownUnderP1([...pool.values()], { defaultInFull: true });
  const p1bPy = shownUnderP1([...poolPy.values()], { defaultInFull: true });
  const cards = new Map();
  for (const c of rec.census.study.cards) {
    const f11 = shownPy.get(c.id) || shown.get(c.id) || poolPy.get(c.id) || pool.get(c.id);
    cards.set(c.id, {
      id: c.id,
      tier: c.tier,
      rule_kind: c.rule_kind,
      family: familyName(c.rule_kind),
      language: c.language,
      outliers: (c.total ?? 0) - (c.holders ?? 0),
      agents: f11 ? f11.agents : false,
      inShown: shown.has(c.id),
      inShownPy: shownPy.has(c.id),
      inPool: pool.has(c.id),
      inPoolPy: poolPy.has(c.id),
      inP1: p1.has(c.id),
      inP1Py: p1Py.has(c.id),
      inP1b: p1b.has(c.id),
      inP1bPy: p1bPy.has(c.id),
      summary: c.summary,
    });
  }
  const studyIds = new Set(cards.keys());
  const missing = [...new Set([...pool.keys(), ...poolPy.keys()])].filter((id) => !studyIds.has(id));
  const { devs, legacy } = track(rec.lock, rec.cps);
  const unknown = { tier: "?", rule_kind: "?", family: "?", language: "?", outliers: 0, agents: false };
  const views = rec.lang === "py" ? ["default", "optin"] : ["default"];
  const attach = (d, view) => {
    const c = cards.get(d.id) || { ...unknown, id: d.id };
    const optin = view === "optin";
    return {
      ...d,
      repo: rec.name,
      fold: rec.fold,
      lang: rec.lang,
      view,
      tier: c.tier,
      family: c.family,
      card_language: c.language,
      arm: cards.has(d.id) ? armOf(c, { optin }) : "all",
      // Under P1 the default listing is P1's (the pool is unchanged).
      arm_p1: cards.has(d.id) ? armOf({ ...c, inShown: c.inP1, inShownPy: c.inP1Py }, { optin }) : "all",
      arm_p1b: cards.has(d.id) ? armOf({ ...c, inShown: c.inP1b, inShownPy: c.inP1bPy }, { optin }) : "all",
      vis: cards.has(d.id) ? visibilityClass(c, table, { optin }) : "unmatched",
    };
  };
  // Gate-off check: the gate-off run's violations are the gate-on run's, flags apart from `n`.
  let discrepancies = 0;
  let compared = 0;
  for (const cp of rec.cps) {
    if (!cp.v_off) continue;
    compared++;
    const on = new Set(cp.v.map(([i, p, s, f]) => `${i} ${p}#${s} ${f.replace("n", "")}`));
    const off = new Set(cp.v_off.map(([i, p, s, f]) => `${i} ${p}#${s} ${f}`));
    for (const k of on) if (!off.has(k)) discrepancies++;
    for (const k of off) if (!on.has(k)) discrepancies++;
  }
  return {
    meta: {
      name: rec.name,
      lang: rec.lang,
      fold: rec.fold,
      commits: rec.first_parent_after,
      commits_back: rec.commits_back,
      checkpoints: rec.checkpoints,
      stride: rec.stride,
      accepted: rec.accepted,
      cards_shown: shown.size,
      cards_shown_py: shownPy.size,
      cards_pool: pool.size,
      cards_pool_py: poolPy.size,
      cards_study: cards.size,
      cards_p1: p1.size,
      cards_p1_py: p1Py.size,
      cards_p1b: p1b.size,
      cards_p1b_py: p1bPy.size,
      f11_ids_missing_from_study: missing.length,
      lock: rec.lock.length,
      new_at_S: rec.new_at_S,
      gate_compared_checkpoints: compared,
      gate_discrepancies: discrepancies,
      secs: rec.secs,
    },
    views: Object.fromEntries(views.map((v) => [v, { devs: devs.map((d) => attach(d, v)), legacy: legacy.map((d) => attach(d, v)) }])),
    cards,
    attach,
  };
}

// ---------- aggregation ----------
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)}%` : "–");
const ci = (k, n) => {
  if (!n) return "–";
  const w = wilson(k, n);
  return `${pct(k, n)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`;
};

function summarise(devs, commits) {
  const st = { deviations: devs.length, fixed: 0, removed: 0, exempted: 0, unfixed: 0 };
  for (const d of devs) st[d.status]++;
  const recall = { off: recallByArm(devs), on: recallByArm(devs, { gate: true }) };
  const warnings = { off: warningsByArm(devs), on: warningsByArm(devs, { gate: true }) };
  return { commits, ...st, recall, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!a.records) die("usage: score.mjs --records DIR");
  const files = readdirSync(a.records).filter((f) => f.endsWith(".json"));
  const repos = [];
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(a.records, f), "utf8"));
    const want = foldOf.get(`${rec.lang}:${rec.name}`);
    if (want === undefined) die(`${rec.name}: not a build-set repo of ${a.folds}`);
    if (want !== rec.fold) die(`${rec.name}: fold ${rec.fold}, ${a.folds} says ${want}`);
    const r = scoreRecord(rec);
    const bf = a.branches && join(a.branches, `${rec.name}.branches.json`);
    if (bf && existsSync(bf)) {
      const b = JSON.parse(readFileSync(bf, "utf8"));
      r.meta.merges = b.merges;
      r.meta.branch_commits = b.branch_commits;
      r.branch = Object.fromEntries(Object.keys(r.views).map((v) => [v, b.devs.map((d) => r.attach(d, v))]));
    }
    repos.push(r);
  }
  const sets = [
    ["ts", "default"],
    ["py", "default"],
    ["py", "optin"],
  ];
  const out = { repos: repos.map((r) => r.meta), sets: {} };
  const md = [];
  for (const [lang, view] of sets) {
    const rs = repos.filter((r) => r.meta.lang === lang);
    if (!rs.length) continue;
    const all = rs.flatMap((r) => r.views[view].devs);
    const legacy = rs.flatMap((r) => r.views[view].legacy);
    const commits = rs.reduce((s, r) => s + r.meta.commits, 0);
    const set = { repos: rs.length, overall: summarise(all, commits), folds: {}, tiers: {}, families: {}, vis: {}, legacy: {} };
    for (const fold of [...new Set(rs.map((r) => r.meta.fold))].sort()) {
      const fr = rs.filter((r) => r.meta.fold === fold);
      set.folds[fold] = {
        repos: fr.length,
        ...summarise(
          all.filter((d) => d.fold === fold),
          fr.reduce((s, r) => s + r.meta.commits, 0),
        ),
      };
    }
    set.tiers = groupStatus(all, (d) => d.tier);
    set.families = groupStatus(all, (d) => `${d.card_language}:${d.family}`);
    set.vis = groupStatus(all, (d) => d.vis);
    set.vis_family = groupStatus(all, (d) => `${d.vis} ${d.card_language}:${d.family}`);
    // Outliers at S that a later commit fixed: the census at S lists them on their card, so a card in the arm
    // "shows" them (no introducing commit to check at; the neighbour gate does not apply to legacy entries).
    const lfixed = legacy.filter((d) => d.status === "fixed");
    set.legacy = {
      overall: groupStatus(legacy, () => "all").all || null,
      vis: groupStatus(legacy, (d) => d.vis),
      families: groupStatus(legacy, (d) => `${d.vis} ${d.card_language}:${d.family}`),
      recall: Object.fromEntries(ARMS.map((arm) => [arm, { k: lfixed.filter((d) => inArm(d.arm, arm)).length, n: lfixed.length }])),
      folds: Object.fromEntries(
        [...new Set(rs.map((r) => r.meta.fold))].sort().map((fold) => {
          const lf = lfixed.filter((d) => d.fold === fold);
          return [fold, Object.fromEntries(ARMS.map((arm) => [arm, { k: lf.filter((d) => inArm(d.arm, arm)).length, n: lf.length }]))];
        }),
      ),
    };
    // Warning rate and fixed share of each family, as if every card of it were shown, gate off; per fold.
    // Candidate show changes for one family (P2: admit the family to the show table under its <= 1 outlier rule;
    // P3: admit it with no outlier rule), people-facing only, the cap aside. What each adds over F11's listing.
    set.proposals = {};
    const famKeys = [...new Set(rs.flatMap((r) => [...r.cards.values()].map((c) => `${c.language}:${c.family}`)))];
    for (const fk of famKeys) {
      for (const [pv, maxOut] of [["P2", 1], ["P3", Infinity]]) {
        const P = { cards: 0, outliers_at_S: 0, legacy_fixed: 0, warnings: 0, fixed: 0, repos: new Set(), folds: {} };
        for (const r of rs) {
          const added = new Set(
            [...r.cards.values()]
              .filter((c) => `${c.language}:${c.family}` === fk && c.tier === "suggestion" && c.outliers <= maxOut)
              .filter((c) => !(view === "optin" ? c.inShownPy : c.inShown))
              .map((c) => c.id),
          );
          if (!added.size) continue;
          const f = (P.folds[r.meta.fold] ||= { cards: 0, legacy_fixed: 0, warnings: 0, fixed: 0 });
          const lg = r.views[view].legacy.filter((d) => added.has(d.id));
          const nw = r.views[view].devs.filter((d) => added.has(d.id) && isNew(d.flags, false));
          const add = (o) => {
            o.cards += added.size;
            o.legacy_fixed += lg.filter((d) => d.status === "fixed").length;
            o.warnings += nw.length;
            o.fixed += nw.filter((d) => d.status === "fixed").length;
          };
          add(P);
          add(f);
          P.outliers_at_S += lg.length;
          P.repos.add(r.meta.name);
        }
        if (!P.cards) continue;
        P.repos = P.repos.size;
        P.label_accept = labelAccept(...fk.split(":"));
        set.proposals[`${pv} ${fk}`] = P;
      }
    }
    md.push("| Proposal (people-facing; cap aside) | Cards added | Repos | Outliers listed at S | Fixed legacy recovered | New warnings / commit | Fixed new recovered | By fold: cards, fixed legacy+new | v3 card accept of the family: all; by fold |");
    md.push("|---|---|---|---|---|---|---|---|---|");
    for (const [k, P] of Object.entries(set.proposals).sort((x, y) => y[1].legacy_fixed + y[1].fixed - x[1].legacy_fixed - x[1].fixed || x[0].localeCompare(y[0]))) {
      const la = P.label_accept;
      const las = la ? `${la.accepted}/${la.n}; ` + Object.entries(la.folds).map(([f, x]) => `${f}: ${x.accepted}/${x.n}`).join(", ") : "–";
      const bf = Object.entries(P.folds).map(([f, x]) => `${f}: ${x.cards}, ${x.legacy_fixed}+${x.fixed}`).join("; ");
      md.push(`| ${k} | ${P.cards} | ${P.repos} | ${P.outliers_at_S} | ${P.legacy_fixed} | ${(P.warnings / commits).toFixed(4)} (${P.warnings}) | ${P.fixed} | ${bf} | ${las} |`);
    }
    md.push("");
    set.family_cost = {};
    for (const d of all) {
      if (!isNew(d.flags, false)) continue;
      const k = `${d.vis} ${d.card_language}:${d.family}`;
      const r = (set.family_cost[k] ||= { warnings: 0, fixed: 0, removed: 0, exempted: 0, unfixed: 0, folds: {}, repos: new Set() });
      r.warnings++;
      r[d.status]++;
      r.repos.add(d.repo);
      const f = (r.folds[d.fold] ||= { warnings: 0, fixed: 0 });
      f.warnings++;
      if (d.status === "fixed") f.fixed++;
    }
    for (const r of Object.values(set.family_cost)) r.repos = r.repos.size;
    out.sets[`${lang}:${view}`] = set;

    // markdown
    const o = set.overall;
    md.push(`## ${lang === "ts" ? "TS/JS" : "Python"}, ${view} view (${rs.length} repos, ${commits} first-parent commits)`);
    md.push("");
    md.push(`Deviations introduced after S: ${o.deviations}; fixed ${o.fixed}, removed ${o.removed}, exempted ${o.exempted}, unfixed ${o.unfixed}.`);
    md.push("");
    md.push("| Arm (nested) | Recall, gate off | Recall, gate on | Warnings / commit (off) | Warnings later fixed (off) |");
    md.push("|---|---|---|---|---|");
    for (const arm of ARMS) {
      const r0 = o.recall.off[arm];
      const r1 = o.recall.on[arm];
      const w = o.warnings.off[arm];
      md.push(`| ${arm} | ${r0.k}/${r0.n} = ${ci(r0.k, r0.n)} | ${r1.k}/${r1.n} = ${ci(r1.k, r1.n)} | ${(w.warnings / commits).toFixed(3)} | ${w.fixed}/${w.warnings} = ${pct(w.fixed, w.warnings)} |`);
    }
    md.push("");
    md.push("| Fold | Repos | Commits | Fixed | Recall shown (off/on) | Recall +candidate (off/on) | Recall all (off/on) | Warnings / commit: shown, +candidate, all | Fixed share of warnings: shown, +candidate, all |");
    md.push("|---|---|---|---|---|---|---|---|---|");
    for (const [fold, f] of Object.entries(set.folds)) {
      const rr = (arm, g) => `${f.recall[g][arm].k}`;
      const wr = (arm) => (f.warnings.off[arm].warnings / f.commits).toFixed(3);
      const fs = (arm) => pct(f.warnings.off[arm].fixed, f.warnings.off[arm].warnings);
      md.push(
        `| ${fold} | ${f.repos} | ${f.commits} | ${f.fixed} | ${rr("shown", "off")}/${rr("shown", "on")} | ${rr("candidate", "off")}/${rr("candidate", "on")} | ${rr("all", "off")}/${rr("all", "on")} | ${wr("shown")}, ${wr("candidate")}, ${wr("all")} | ${fs("shown")}, ${fs("candidate")}, ${fs("all")} |`,
      );
    }
    md.push("");
    md.push("| Visibility class | Deviations | Fixed | Removed | Exempted | Unfixed |");
    md.push("|---|---|---|---|---|---|");
    for (const [k, v] of Object.entries(set.vis)) md.push(`| ${k} | ${v.deviations} | ${v.fixed} | ${v.removed} | ${v.exempted} | ${v.unfixed} |`);
    md.push("");
    md.push("| Class and family | Warnings (gate off) | Fixed | Fixed share | Warnings / commit | Repos | Fixed by fold | v3 card accept (show table): all; by fold |");
    md.push("|---|---|---|---|---|---|---|---|");
    for (const [k, v] of Object.entries(set.family_cost).sort((x, y) => y[1].fixed - x[1].fixed || y[1].warnings - x[1].warnings)) {
      const byFold = Object.entries(v.folds)
        .map(([f, x]) => `${f}: ${x.fixed}/${x.warnings}`)
        .join("; ");
      const [cl, fam] = k.split(" ")[1].split(":");
      const la = labelAccept(cl, fam);
      v.label_accept = la;
      const las = la
        ? `${la.accepted}/${la.n}; ` + Object.entries(la.folds).map(([f, x]) => `${f}: ${x.accepted}/${x.n}`).join(", ")
        : "–";
      md.push(`| ${k} | ${v.warnings} | ${v.fixed} | ${pct(v.fixed, v.warnings)} | ${(v.warnings / commits).toFixed(3)} | ${v.repos} | ${byFold} | ${las} |`);
    }
    md.push("");
    // Proposals P1 (the show policy before the caps) and P1b (P1, the default tier in full): recall and warnings with
    // their default listing, per fold (the pool is unchanged).
    for (const pv of ["p1", "p1b"]) {
      const key = `arm_${pv}`;
      const asP = (ds) => ds.map((d) => ({ ...d, arm: d[key] }));
      const P = (set[pv] = { folds: {} });
      for (const fold of [...[...new Set(rs.map((r) => r.meta.fold))].sort(), "all"]) {
        const fr = fold === "all" ? rs : rs.filter((r) => r.meta.fold === fold);
        const ds = all.filter((d) => fold === "all" || d.fold === fold);
        const ls = legacy.filter((d) => (fold === "all" || d.fold === fold) && d.status === "fixed");
        const cnt = (f) => fr.reduce((x, r) => x + f(r.meta), 0);
        const lr = (dd, k) => Object.fromEntries(["shown", "candidate"].map((arm) => [arm, dd.filter((d) => inArm(d[k], arm)).length]));
        P.folds[fold] = {
          repos: fr.length,
          commits: cnt((m) => m.commits),
          cards_f11: cnt((m) => (view === "optin" ? m.cards_shown_py : m.cards_shown)),
          cards_p: cnt((m) => (view === "optin" ? m[`cards_${pv}_py`] : m[`cards_${pv}`])),
          recall_f11: recallByArm(ds),
          recall_p: recallByArm(asP(ds)),
          warnings_f11: warningsByArm(ds),
          warnings_p: warningsByArm(asP(ds)),
          legacy_fixed: ls.length,
          legacy_f11: lr(ls, "arm"),
          legacy_p: lr(ls, key),
        };
      }
      md.push(`| ${pv === "p1" ? "P1 (show policy before the caps)" : "P1b (P1, default tier in full)"}, fold | Repos | Cards listed F11 → ${pv} | Fixed (new) shown F11 → ${pv} | +candidate | Fixed legacy shown F11 → ${pv} | +candidate | Warnings/commit shown | +candidate | Fixed share of warnings +candidate |`);
      md.push("|---|---|---|---|---|---|---|---|---|---|");
      for (const [fold, f] of Object.entries(P.folds)) {
        const w = (x, arm) => (x[arm].warnings / f.commits).toFixed(3);
        md.push(
          `| ${fold} | ${f.repos} | ${f.cards_f11} → ${f.cards_p} | ${f.recall_f11.shown.k} → ${f.recall_p.shown.k} of ${f.recall_f11.shown.n} | ${f.recall_f11.candidate.k} → ${f.recall_p.candidate.k} | ${f.legacy_f11.shown} → ${f.legacy_p.shown} of ${f.legacy_fixed} | ${f.legacy_f11.candidate} → ${f.legacy_p.candidate} | ${w(f.warnings_f11, "shown")} → ${w(f.warnings_p, "shown")} | ${w(f.warnings_f11, "candidate")} → ${w(f.warnings_p, "candidate")} | ${f.warnings_f11.candidate.fixed}/${f.warnings_f11.candidate.warnings} → ${f.warnings_p.candidate.fixed}/${f.warnings_p.candidate.warnings} |`,
        );
      }
      md.push("");
    }
    // Review-time arm (branches.mjs): deviations a pull request's branch introduced and its merge no longer has.
    const br = rs.filter((r) => r.branch).flatMap((r) => r.branch[view]);
    if (rs.some((r) => r.branch)) {
      const bfix = br.filter((d) => d.status === "fixed");
      const brepos = rs.filter((r) => r.branch);
      set.branches = {
        repos: brepos.length,
        merges: brepos.reduce((x, r) => x + r.meta.merges, 0),
        branch_commits: brepos.reduce((x, r) => x + r.meta.branch_commits, 0),
        status: groupStatus(br, () => "all").all || null,
        recall: { off: recallByArm(bfix), on: recallByArm(bfix, { gate: true }) },
        vis: groupStatus(br, (d) => `${d.vis} ${d.card_language}:${d.family}`),
        folds: Object.fromEntries(
          [...new Set(brepos.map((r) => r.meta.fold))].sort().map((fold) => [fold, groupStatus(br.filter((d) => d.fold === fold), () => "all").all || null]),
        ),
      };
      const B = set.branches;
      md.push(`Review-time arm: ${B.repos} repos walked (merge commits and squash-merged pull requests), ${B.merges} merges, ${B.branch_commits} branch commits checked; branch deviations ${B.status?.deviations ?? 0}: fixed before the merge ${B.status?.fixed ?? 0}, removed ${B.status?.removed ?? 0}, exempted ${B.status?.exempted ?? 0}, merged ${br.filter((d) => d.status === "merged").length}.`);
      md.push("");
      md.push("| Review-time recall (fixed in review) | Gate off | Gate on |");
      md.push("|---|---|---|");
      for (const arm of ARMS) md.push(`| ${arm} | ${B.recall.off[arm].k}/${B.recall.off[arm].n} = ${ci(B.recall.off[arm].k, B.recall.off[arm].n)} | ${B.recall.on[arm].k}/${B.recall.on[arm].n} = ${ci(B.recall.on[arm].k, B.recall.on[arm].n)} |`);
      md.push("");
      md.push("| Review-time, by class and family | Branch deviations | Fixed in review | Removed | Merged |");
      md.push("|---|---|---|---|---|");
      for (const [k, v] of Object.entries(B.vis)) md.push(`| ${k} | ${v.deviations} | ${v.fixed} | ${v.removed} | ${v.merged || 0} |`);
      md.push("");
    }
    const lo = set.legacy.overall;
    if (lo) {
      md.push(`Legacy outliers at S (drift.lock): ${lo.deviations}; fixed ${lo.fixed} (${pct(lo.fixed, lo.deviations)}), removed ${lo.removed}, exempted ${lo.exempted}, unfixed ${lo.unfixed}.`);
      md.push("");
      md.push("| Legacy, by class | Outliers at S | Fixed | Removed | Unfixed |");
      md.push("|---|---|---|---|---|");
      for (const [k, v] of Object.entries(set.legacy.vis)) md.push(`| ${k} | ${v.deviations} | ${v.fixed} (${pct(v.fixed, v.deviations)}) | ${v.removed} | ${v.unfixed} |`);
      md.push("");
      md.push("| Legacy recall (fixed outliers at S on a card of the arm) | All | " + Object.keys(set.legacy.folds).map((f) => `Fold ${f}`).join(" | ") + " |");
      md.push("|---|---|" + Object.keys(set.legacy.folds).map(() => "---|").join(""));
      for (const arm of ARMS) {
        const r = set.legacy.recall[arm];
        md.push(`| ${arm} | ${r.k}/${r.n} = ${ci(r.k, r.n)} | ` + Object.values(set.legacy.folds).map((f) => `${f[arm].k}/${f[arm].n}`).join(" | ") + " |");
      }
      md.push("");
      md.push("| Legacy fixed, by class and family | Outliers at S | Fixed | Fixed share |");
      md.push("|---|---|---|---|");
      for (const [k, v] of Object.entries(set.legacy.families)) if (v.fixed) md.push(`| ${k} | ${v.deviations} | ${v.fixed} | ${pct(v.fixed, v.deviations)} |`);
      md.push("");
    }
  }
  md.push("## Repos");
  md.push("");
  md.push("| Repo | Lang | Fold | Commits after S | Commits back | Checkpoints (stride) | Cards: shown / shown opt-in / pool / mined | Lock | Gate discrepancies | Secs |");
  md.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of out.repos.sort((x, y) => x.fold - y.fold || x.name.localeCompare(y.name)))
    md.push(
      `| ${r.name} | ${r.lang} | ${r.fold} | ${r.commits} | ${r.commits_back} | ${r.checkpoints} (${r.stride}) | ${r.cards_shown} / ${r.cards_shown_py} / ${r.cards_pool_py} / ${r.cards_study} | ${r.lock} | ${r.gate_discrepancies} of ${r.gate_compared_checkpoints} cps | ${r.secs.toFixed(0)} |`,
    );
  if (a.json) writeFileSync(a.json, JSON.stringify(out, null, 1) + "\n");
  if (a.md) writeFileSync(a.md, md.join("\n") + "\n");
  else process.stdout.write(md.join("\n") + "\n");
  if (a.cards) {
    const rows = [];
    for (const r of repos) {
      if (!cardFolds.has(r.meta.fold)) continue;
      // The view the note reports: the opt-in view for Python repos, the default for TS/JS.
      for (const [view, { devs, legacy }] of Object.entries(r.views).filter(([v]) => v === (r.meta.lang === "py" ? "optin" : "default")))
        for (const [population, ds] of [
          ["main_line", devs],
          ["legacy", legacy.filter((d) => d.status !== "unfixed")],
          ["review", r.branch ? r.branch[view] : []],
        ])
        for (const d of ds) {
          const c = r.cards.get(d.id);
          rows.push({
            population,
            repo: d.repo,
            fold: d.fold,
            view,
            id: d.id,
            key: d.key,
            key_at_end: d.keyAtEnd,
            intro_commit: d.introI ?? d.intro,
            merged_in: d.commit ?? null,
            flags: d.flags,
            status: d.status,
            arm: d.arm,
            vis: d.vis,
            tier: d.tier,
            family: d.family,
            summary: c ? c.summary : null,
          });
        }
    }
    writeFileSync(a.cards, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
}
