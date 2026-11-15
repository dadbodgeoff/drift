// The practice-map measures of round 13 (PLAN-R13 §5; pre-registration PREREG-R13-practices.md), from
// `drift practices --json` (version 1, PLAN-R13 §0.3).
//
//   mcov   --run RUNDIR                    M-cov from a practices-run.mjs run directory: RUNDIR/mcov.json and RUNDIR/mcov.md
//   sample --runs RUNDIR --out DIR --cache DIR [--seed TEXT] [--checkouts DIR]
//                                          the M-acc spot-check sample (stratified per repo x concern x variant), written as a
//                                          practice run: DIR/run.json, DIR/queue.json (kind "practice") and DIR/sample.json.
//                                          Label it with prompt.mjs label / collect.mjs (PRACTICE-PROMPT.md).
//   score  --run DIR                        M-acc, FALSE_NONE and M-apart from the collected A/B (and C) labels: DIR/score.json, DIR/score.md
//
// M-cov (per concern): coverage = (known + none) / total, known_only = known / total, from the concern's population
// counts, per package (by_package) and per repo; pooled over repos, and the per-repo median. The dominant variant is
// the largest KNOWN variant (PLAN-R13 §3); `none` is a variant for coverage but never the dominant one. A repo whose run
// failed, or whose JSON is inconsistent, counts as coverage 0 in the median of every concern that a measured repo has
// units in [STRICT]; a repo with no unit in a concern's population is not in that concern's median.
//
// The sample frame. A variant's full member list is read from `units` (variants[].units, unknown.units) when the JSON
// has it. Version 1 lists only `examples` (3, closest to the medoid) and `exceptions` (members of other variants in the
// variant's places, each naming its variant); without `units` the frame is those, and the sample records frame
// "examples" (PREREG-R13-practices.md, deviation rule P3).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APART_VERDICTS, MIN_N_CHANCE_CORRECTED, PRACTICE_LABELS, clusterBootstrap, cohen, derivePracticeLabel, die, gwetAC1, parseArgs, pct, readJson, readJsonlAll, shuffle, table, uidOf, wilson } from "./lib.mjs";

// The frozen concern ids (PLAN-R13 §0.1).
export const CONCERNS = ["authn", "authz", "errors", "logging", "api", "validation", "config", "data_access", "testing"];
// Amendment 1 (PREREG-R13-practices.md §9): the primary concerns (the route recipe) gate; the others are reported, as a
// preview, against the same bars, and gate nothing.
export const PRIMARY = ["authn", "authz", "validation", "errors", "api"];
export const SECONDARY = ["logging", "config", "data_access", "testing"];
export const TARGET = 0.9; // M-cov known-or-none, per concern, pooled and median
export const KNOWN_ONLY_TARGET = 0.8; // M-cov known_only (co-primary), per concern, pooled and median
export const BARS = {
  acc_point: 0.9, // M-acc point
  acc_lower: 0.8, // M-acc repo-cluster bootstrap lower bound (the primary interval)
  min_n: 100, // labelled units per concern
  min_repos: 30, // repos the units come from, per concern
  false_none_max: 0.05,
  false_none_gate: ["authn", "validation"], // FALSE_NONE gates these, with >= none_min units assigned none
  none_min: 60,
  recall: 0.8, // variant recall (co-primary)
};
// Pre-registered predictions per concern (amendment 1), made before any practices binary exists: coverage
// (known-or-none), known_only, M-acc, FALSE_NONE rate and variant recall. The report states each against its observation.
export const PREDICTIONS = {
  authn: { coverage: 0.92, known_only: 0.8, acc: 0.9, false_none: 0.05, recall: 0.85 },
  api: { coverage: 0.93, known_only: 0.88, acc: 0.9, false_none: 0.05, recall: 0.85 },
  validation: { coverage: 0.9, known_only: 0.7, acc: 0.88, false_none: 0.08, recall: 0.8 },
  data_access: { coverage: 0.92, known_only: 0.9, acc: 0.9, false_none: 0.05, recall: 0.85 },
  errors: { coverage: 0.85, known_only: 0.75, acc: 0.82, false_none: 0.1, recall: 0.75 },
  logging: { coverage: 0.85, known_only: 0.75, acc: 0.82, false_none: 0.1, recall: 0.75 },
  config: { coverage: 0.88, known_only: 0.85, acc: 0.85, false_none: 0.08, recall: 0.8 },
  authz: { coverage: 0.75, known_only: 0.55, acc: 0.75, false_none: 0.15, recall: 0.65 },
  testing: { coverage: 0.7, known_only: 0.6, acc: 0.75, false_none: 0.15, recall: 0.65 },
};
// F6: at most 5 units per repo per concern (a hard cap); none oversampled towards 66 on authn and validation (>= 60
// labelled); at least 2 recall packages per repo.
export const SAMPLE = { cap: 5, min_share: 0.05, none_target: { authn: 66, validation: 66 }, controls_per_line: 2, recall_packages: 2 };
export const SEED = "drift-practices-r13-2026-11-09";

const ratio = (k, n) => (n > 0 ? k / n : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const close = (a, b) => typeof a === "number" && Math.abs(a - b) <= 0.0005 + 1e-9; // shares are rounded to 3 places (mine::r3)

// ---------------------------------------------------------------------------------------------------------
// M-cov
// ---------------------------------------------------------------------------------------------------------
// Problems with one `drift practices --json` document: what the measures rely on. [] when consistent.
export function shapeProblems(j) {
  const p = [];
  if (!j || typeof j !== "object") return ["not a JSON object"];
  if (j.version !== 1) p.push(`version ${JSON.stringify(j.version)}, the measures read version 1`);
  if (!Array.isArray(j.concerns)) return [...p, "no concerns array"];
  const seen = new Set();
  for (const c of j.concerns) {
    const at = `concern ${c?.id}`;
    if (!CONCERNS.includes(c?.id)) p.push(`${at}: not one of the frozen concern ids`);
    if (seen.has(c?.id)) p.push(`${at}: listed twice`);
    seen.add(c?.id);
    const pop = c?.population ?? {};
    // `identified` (authentication that identifies the caller and turns no one away) is counted apart, absent when 0.
    const [t, k, i, n, u] = [pop.total, pop.known, pop.identified ?? 0, pop.none, pop.unknown];
    if (![t, k, i, n, u].every((x) => Number.isInteger(x) && x >= 0)) {
      p.push(`${at}: population counts are not non-negative integers`);
      continue;
    }
    if (k + i + n + u !== t) p.push(`${at}: known ${k} + identified ${i} + none ${n} + unknown ${u} != total ${t}`);
    if (t > 0 && !close(pop.coverage, (k + i + n) / t)) p.push(`${at}: coverage ${pop.coverage} != (known + identified + none) / total`);
    const vs = c.variants ?? [];
    for (const v of vs) if (!["known", "none", "identified"].includes(v?.kind)) p.push(`${at}: variant ${v?.id} has kind ${JSON.stringify(v?.kind)}`);
    const byKind = (kind) => sum(vs.filter((v) => v.kind === kind).map((v) => v.members ?? 0));
    if (byKind("known") !== k) p.push(`${at}: known variants hold ${byKind("known")} members, population.known is ${k}`);
    if (byKind("identified") !== i) p.push(`${at}: identified variants hold ${byKind("identified")} members, population.identified is ${i}`);
    if (byKind("none") !== n) p.push(`${at}: none variants hold ${byKind("none")} members, population.none is ${n}`);
    if ((c.unknown?.members ?? 0) !== u) p.push(`${at}: unknown.members ${c.unknown?.members ?? 0} != population.unknown ${u}`);
    const ids = new Set(vs.map((v) => v.id));
    for (const b of c.by_package ?? []) {
      for (const v of b.variants ?? []) if (!ids.has(v.id)) p.push(`${at}: package ${b.package} names variant ${v.id}, which the concern does not list`);
      const held = sum((b.variants ?? []).map((v) => v.members ?? 0));
      if (held > (b.total ?? 0)) p.push(`${at}: package ${b.package} variants hold ${held} members, more than its total ${b.total}`);
    }
    if (sum((c.by_package ?? []).map((b) => b.total ?? 0)) > t) p.push(`${at}: by_package totals exceed the population`);
  }
  return p;
}

// The M-cov row of one population: counts and shares, the dominant known variant and the variant count.
function covRow(total, known, none, unknown, knownVariants) {
  const dom = [...knownVariants].sort((a, b) => b.members - a.members || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id)))[0] ?? null;
  return {
    total,
    known,
    none,
    unknown,
    coverage: ratio(known + none, total),
    known_only: ratio(known, total),
    share_known: ratio(known, total),
    share_none: ratio(none, total),
    share_unknown: ratio(unknown, total),
    dominant: dom && dom.members > 0 ? { id: dom.id, label: dom.label ?? null, members: dom.members, share: ratio(dom.members, total) } : null,
    variants: knownVariants.filter((v) => v.members > 0).length,
  };
}
// One concern, repo-wide.
export function concernCov(c) {
  const pop = c.population ?? {};
  // The M-cov rows count `identified` with known, as they did before it was a state of its own (it was known
  // `identifies:`), so the study's numbers compare across builds; its variants are no dominant way.
  const known = (c.variants ?? []).filter((v) => v.kind === "known").map((v) => ({ id: v.id, key: v.key, label: v.label, members: v.members ?? 0 }));
  return { id: c.id, title: c.title ?? null, unit: c.unit ?? null, ...covRow(pop.total ?? 0, (pop.known ?? 0) + (pop.identified ?? 0), pop.none ?? 0, pop.unknown ?? 0, known), left_out: pop.left_out ?? null };
}
// One concern, per package (by_package): known and none from the package's variants and their kinds; the rest of the
// package's total is unknown.
export function packageCov(c) {
  const kind = new Map((c.variants ?? []).map((v) => [v.id, v]));
  return (c.by_package ?? []).map((b) => {
    const vs = (b.variants ?? []).map((v) => ({ id: v.id, key: kind.get(v.id)?.key, label: kind.get(v.id)?.label, kind: kind.get(v.id)?.kind, members: v.members ?? 0 }));
    const known = sum(vs.filter((v) => v.kind === "known" || v.kind === "identified").map((v) => v.members));
    const none = sum(vs.filter((v) => v.kind === "none").map((v) => v.members));
    const total = b.total ?? 0;
    return { concern: c.id, package: b.package, ...covRow(total, known, none, Math.max(0, total - known - none), vs.filter((v) => v.kind === "known")) };
  });
}
// One repo: every concern (the nine, in the frozen order; a concern the JSON leaves out has total 0), its packages, and
// the repo-wide summary recomputed from the concerns.
export function repoCov(j) {
  const problems = shapeProblems(j);
  const byId = new Map((j?.concerns ?? []).map((c) => [c.id, c]));
  const concerns = CONCERNS.map((id) => (byId.has(id) ? concernCov(byId.get(id)) : { id, ...covRow(0, 0, 0, 0, []), left_out: null }));
  const packages = CONCERNS.filter((id) => byId.has(id)).flatMap((id) => packageCov(byId.get(id)));
  const t = sum(concerns.map((c) => c.total));
  const k = sum(concerns.map((c) => c.known));
  const n = sum(concerns.map((c) => c.none));
  const summary = { population: t, known: k, none: n, unknown: t - k - n, coverage: ratio(k + n, t), known_only: ratio(k, t), concerns_at_target: concerns.filter((c) => c.total > 0 && c.coverage >= TARGET).length, target: TARGET };
  return { commit: j?.commit ?? null, facts_schema: j?.facts_schema ?? null, summary, concerns, packages, not_covered: j?.not_covered ?? [], problems };
}
// Pooled over repos: [{ name, cov: repoCov(...) | null, failed: string | null }]. Per concern: the pooled counts and
// coverage, and the per-repo median (repos with units in the concern; failed or inconsistent repos as 0 [STRICT]).
export function pooledCov(repos, target = TARGET) {
  const bad = (r) => Boolean(r.failed) || !r.cov || r.cov.problems.length > 0;
  const good = repos.filter((r) => !bad(r));
  const failed = repos.filter(bad).map((r) => ({ name: r.name, why: r.failed ?? (r.cov ? `inconsistent JSON: ${r.cov.problems.length} problems` : "no result") }));
  const row = (pick) => {
    const rows = good.map((r) => ({ name: r.name, c: pick(r.cov) })).filter((x) => x.c.total > 0);
    const [t, k, n] = ["total", "known", "none"].map((f) => sum(rows.map((x) => x.c[f])));
    // failed repos are 0 in the median of every concern that some measured repo has units in [STRICT]
    const per = rows.length ? [...rows.map((x) => x.c.coverage), ...failed.map(() => 0)] : [];
    const pooled = ratio(k + n, t);
    const med = median(per);
    return {
      repos: rows.length,
      failed: failed.length,
      total: t,
      known: k,
      none: n,
      unknown: t - k - n,
      coverage: pooled,
      known_only: ratio(k, t),
      share_none: ratio(n, t),
      share_unknown: ratio(t - k - n, t),
      median: med,
      min: per.length ? Math.min(...per) : null,
      below_target: rows.filter((x) => x.c.coverage < target).map((x) => x.name).sort(),
      median_known_only: rows.length ? median([...rows.map((x) => x.c.known_only), ...failed.map(() => 0)]) : null,
      at_target: pooled !== null && med !== null && pooled >= target && med >= target,
    };
  };
  // co-primary (amendment 1): known_only >= KNOWN_ONLY_TARGET, pooled and median, beside known-or-none; a concern meets
  // its M-cov bars only with both, and only with units in >= BARS.min_repos repos
  const bars = (c) => ({ ...c, known_only_at_target: c.known_only !== null && c.median_known_only !== null && c.known_only >= KNOWN_ONLY_TARGET && c.median_known_only >= KNOWN_ONLY_TARGET, repos_at_bar: c.repos >= BARS.min_repos });
  const withBars = (c) => {
    const b = bars(c);
    return { ...b, bar_met: b.at_target && b.known_only_at_target && b.repos_at_bar };
  };
  const concerns = CONCERNS.map((id) => ({ id, primary: PRIMARY.includes(id), prediction: PREDICTIONS[id], ...withBars(row((cov) => cov.concerns.find((c) => c.id === id))) }));
  const all = withBars(row((cov) => ({ ...cov.summary, total: cov.summary.population })));
  const primary = concerns.filter((c) => c.primary);
  return { target, known_only_target: KNOWN_ONLY_TARGET, repos: repos.length, failed, concerns, all, concerns_at_target: concerns.filter((c) => c.at_target).length, concerns_with_units: concerns.filter((c) => c.total > 0).length, primary_met: primary.filter((c) => c.bar_met).length, primary_failed: primary.filter((c) => !c.bar_met).map((c) => c.id) };
}
const fx = (x) => (x === null || x === undefined ? "–" : pct(x, 1));
// The M-cov tables (markdown).
export function mcovMarkdown(pool, repos) {
  const out = [`## M-cov (bars per primary concern: known-or-none ≥ ${pct(pool.target)} and known_only ≥ ${pct(pool.known_only_target)}, each pooled and as the per-repo median, from ≥ ${BARS.min_repos} repos)`, ""];
  out.push(
    table(
      ["concern", "tier", "repos", "units", "known", "none", "unknown", "known-or-none (pooled)", "median", "predicted", "known only (pooled)", "median", "predicted", "min", "bars met"],
      [...pool.concerns, { id: "all", ...pool.all }].map((c) => [
        c.id,
        c.primary === undefined ? "–" : c.primary ? "primary" : "secondary",
        c.repos,
        c.total,
        fx(c.total ? c.known / c.total : null),
        fx(c.share_none),
        fx(c.share_unknown),
        fx(c.coverage),
        fx(c.median),
        c.prediction ? pct(c.prediction.coverage) : "–",
        fx(c.known_only),
        fx(c.median_known_only),
        c.prediction ? pct(c.prediction.known_only) : "–",
        fx(c.min),
        c.total ? (c.primary === false ? `(${c.bar_met ? "yes" : "no"})` : c.bar_met ? "yes" : "no") : "–",
      ]),
    ),
  );
  out.push("", `Primary concerns meeting every M-cov bar: ${pool.primary_met} of ${PRIMARY.length}. Failed bars are published: ${pool.primary_failed.join(", ") || "none"}. Secondary concerns (in brackets) gate nothing. ${pool.failed.length ? `Failed or inconsistent repos (0 in every median): ${pool.failed.map((f) => `${f.name} (${f.why})`).join("; ")}.` : "No repo failed."}`, "");
  out.push("## Per repo", "");
  const ok = repos.filter((r) => r.cov);
  out.push(
    table(
      ["repo", ...CONCERNS, "all"],
      repos.map((r) => (r.cov ? [r.name, ...r.cov.concerns.map((c) => (c.total ? `${fx(c.coverage)} (${c.total})` : "–")), fx(r.cov.summary.coverage)] : [r.name, ...CONCERNS.map(() => "failed"), "failed"])),
    ),
  );
  out.push("", "## Per concern and repo: dominant variant and variant count", "");
  out.push(
    table(
      ["repo", "concern", "units", "known", "none", "unknown", "dominant share", "variants"],
      ok.flatMap((r) => r.cov.concerns.filter((c) => c.total > 0).map((c) => [r.name, c.id, c.total, fx(c.share_known), fx(c.share_none), fx(c.share_unknown), fx(c.dominant?.share ?? null), c.variants])),
    ),
  );
  out.push("", "## Per package", "");
  out.push(
    table(
      ["repo", "package", "concern", "units", "known", "none", "unknown", "coverage", "dominant share", "variants"],
      ok.flatMap((r) => r.cov.packages.map((p) => [r.name, p.package, p.concern, p.total, fx(p.share_known), fx(p.share_none), fx(p.share_unknown), fx(p.coverage), fx(p.dominant?.share ?? null), p.variants])),
    ),
  );
  return out.join("\n") + "\n";
}
// The repos of a practices-run.mjs run directory: [{ name, cov, failed }].
export function loadRunRepos(runDir) {
  const d = join(runDir, "repos");
  if (!existsSync(d)) die(`${d}: no per-repo results`);
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const r = readJson(join(d, f));
      return { name: r.name, sha: r.sha, failed: r.failed ?? null, cov: r.practices ? repoCov(r.practices) : null, practices: r.practices ?? null };
    });
}
export function writeMcov(runDir) {
  const repos = loadRunRepos(runDir);
  const pool = pooledCov(repos);
  const perRepo = repos.map((r) => ({ name: r.name, sha: r.sha, failed: r.failed, ...(r.cov ?? {}) }));
  writeFileSync(join(runDir, "mcov.json"), JSON.stringify({ measure: "M-cov", pooled: pool, repos: perRepo }, null, 2) + "\n");
  writeFileSync(join(runDir, "mcov.md"), mcovMarkdown(pool, repos));
  return pool;
}

// ---------------------------------------------------------------------------------------------------------
// The M-acc sample
// ---------------------------------------------------------------------------------------------------------
const unitKey = (u) => `${u.path ?? ""}\0${u.symbol ?? ""}\0${u.line ?? 0}`;
const byUnit = (a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")) || String(a.symbol ?? "").localeCompare(String(b.symbol ?? "")) || (a.line ?? 0) - (b.line ?? 0);
const unitOf = (e) => ({ path: e.path ?? "", symbol: e.symbol ?? "", line: e.line ?? 0 });
const uniqUnits = (list) => {
  const m = new Map();
  for (const e of list) if (e?.path) m.set(unitKey(e), unitOf(e));
  return [...m.values()].sort(byUnit);
};
// The sampling frame of one concern: one stratum per variant (known and none) and one for unknown, each with its units.
export function frameOf(c) {
  const total = c.population?.total ?? 0;
  const vs = c.variants ?? [];
  const full = vs.every((v) => Array.isArray(v.units)) && (!(c.unknown?.members > 0) || Array.isArray(c.unknown?.units));
  // An exception names the variant it uses by id, or as `none` / `unknown` (the contract's Exception.variant); `none`
  // is the concern's none variant when it has exactly one, and is not used otherwise.
  const noneIds = vs.filter((v) => v.kind === "none").map((v) => v.id);
  const exceptionsOf = (id) =>
    vs.flatMap((w) => (w.exceptions ?? []).filter((e) => (id === "unknown" ? !e.variant || e.variant === "unknown" : e.variant === id || (e.variant === "none" && noneIds.length === 1 && noneIds[0] === id))));
  const strata = vs.map((v) => ({
    stratum: v.id,
    kind: v.kind,
    key: v.key ?? v.id,
    label: v.label ?? null,
    mechanisms: v.mechanisms ?? [],
    instruments: v.instruments ?? [],
    members: v.members ?? 0,
    share: ratio(v.members ?? 0, total),
    apart: (v.sets_apart ?? []).map((s) => s.attribute).filter(Boolean),
    units: full ? uniqUnits(v.units) : uniqUnits([...(v.examples ?? []), ...exceptionsOf(v.id)]),
  }));
  if ((c.unknown?.members ?? 0) > 0) {
    const u = c.unknown;
    const top = (u.reasons ?? []).slice().sort((a, b) => (b.members ?? 0) - (a.members ?? 0))[0];
    strata.push({
      stratum: "unknown",
      kind: "unknown",
      key: "unknown",
      label: null,
      mechanisms: [],
      instruments: [],
      members: u.members,
      share: ratio(u.members, total),
      apart: [],
      reasons: u.reasons ?? [],
      top_reason: top?.reason ?? null,
      units: full ? uniqUnits(u.units) : uniqUnits([...(u.examples ?? []), ...exceptionsOf("unknown")]),
      unit_reasons: new Map([...(u.examples ?? []), ...(full ? u.units : [])].filter((e) => e?.path && (e.reason || e.instrument)).map((e) => [unitKey(e), { reason: e.reason ?? null, instrument: e.instrument ?? null }])),
    });
  }
  // A unit sits in one stratum: a unit listed under two (an exception tagged with another variant than the one it is
  // an example of) is dropped from both and counted [STRICT: an ambiguous assignment is never labelled].
  const count = new Map();
  for (const s of strata) for (const u of s.units) count.set(unitKey(u), (count.get(unitKey(u)) ?? 0) + 1);
  let ambiguous = 0;
  for (const s of strata) {
    const n = s.units.length;
    s.units = s.units.filter((u) => count.get(unitKey(u)) === 1);
    ambiguous += n - s.units.length;
  }
  return { concern: c.id, title: c.title ?? null, unit: c.unit ?? null, total, frame: full ? "units" : "examples", ambiguous, strata };
}
// How many units each stratum gets, within the hard cap of SAMPLE.cap (5) per repo per concern (F6: no repo dominates a
// concern's sample), in this order:
//   1. a `none` stratum gets min_none units (the oversampling of `none` on authn and validation);
//   2. one unit for each stratum that has a minimum: `unknown`, `none`, then each known variant with share >= min_share,
//      by members (descending), while the cap allows; a stratum with a minimum that gets none is counted (unmet);
//   3. the rest of the cap by D'Hondt over members.
export function allocate(strata, { cap = SAMPLE.cap, min_share = SAMPLE.min_share, min_none = 0 } = {}) {
  const take = strata.map(() => 0);
  let left = cap;
  strata.forEach((s, i) => {
    if (s.kind === "none" && min_none > 0) {
      take[i] = Math.min(min_none, s.units.length, left);
      left -= take[i];
    }
  });
  const rank = (s) => (s.kind === "unknown" ? 0 : s.kind === "none" ? 1 : 2);
  const minimum = strata
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind !== "known" || (s.share ?? 0) >= min_share)
    .sort((a, b) => rank(a.s) - rank(b.s) || b.s.members - a.s.members || a.i - b.i);
  let unmet = 0;
  for (const { s, i } of minimum) {
    if (take[i] > 0 || !s.units.length) continue;
    if (left > 0) {
      take[i] = 1;
      left--;
    } else unmet++;
  }
  for (; left > 0; left--) {
    let best = -1;
    for (let i = 0; i < strata.length; i++) {
      if (take[i] >= strata[i].units.length) continue;
      if (best < 0 || strata[i].members / (take[i] + 1) > strata[best].members / (take[best] + 1)) best = i;
    }
    if (best < 0) break;
    take[best]++;
  }
  return { take, unmet };
}
export const practiceUid = (repo, concern, u) => `${repo}/${concern}/${createHash("sha256").update(unitKey(u)).digest("hex").slice(0, 8)}`;
// The per-concern oversampling of `none` for a set of repos: min_none = ceil(none_target / repos with a `none` member),
// at most the cap, for the concerns in SAMPLE.none_target (authn, validation). Fixed from population counts, before any
// label.
export function sampleSizes(docs, sample = SAMPLE) {
  const out = {};
  for (const id of CONCERNS) {
    const cs = docs.map((j) => (j.concerns ?? []).find((c) => c.id === id)).filter((c) => (c?.population?.total ?? 0) > 0);
    const withNone = cs.filter((c) => (c.population?.none ?? 0) > 0).length;
    out[id] = { repos: cs.length, cap: sample.cap, min_none: sample.none_target[id] && withNone ? Math.min(sample.cap, Math.ceil(sample.none_target[id] / withNone)) : 0 };
  }
  return out;
}
// The sample of one repo's practices JSON: queue items (kind "practice"), the per-concern record, and the population
// of every stratum (for the stratum weights: an item stands for stratum_members / sampled units of its stratum).
//
// Controls for M-apart: each attribute of a non-dominant variant V is also put on the cards of up to controls_per_line
// sampled units of the dominant known variant D. The match card presents every attribute the same way, so the matcher
// cannot tell a variant's own attribute from a control. A line holds when V's units have it and D's controls do not.
export function sampleRepo(repo, j, { seed = SEED, sizes = null, sample = SAMPLE } = {}) {
  const items = [];
  const record = [];
  const population = [];
  const ordered = [...(j.concerns ?? [])].sort((a, b) => CONCERNS.indexOf(a.id) - CONCERNS.indexOf(b.id));
  for (const c of ordered) {
    const f = frameOf(c);
    const size = sizes?.[c.id] ?? { cap: sample.cap, min_none: 0 };
    // strata in a fixed order: members (descending), then key
    f.strata.sort((a, b) => b.members - a.members || String(a.key).localeCompare(String(b.key)));
    const { take, unmet } = allocate(f.strata, { cap: Math.min(size.cap, sample.cap), min_share: sample.min_share, min_none: size.min_none });
    const rec = { repo, concern: c.id, total: f.total, frame: f.frame, ambiguous: f.ambiguous, cap: sample.cap, min_none: size.min_none, unmet_minimum: unmet, strata: [], controls: 0 };
    const mine = [];
    f.strata.forEach((s, i) => {
      const chosen = shuffle(s.units, `${seed}:${repo}:${c.id}:${s.key}`).slice(0, take[i]);
      rec.strata.push({ stratum: s.stratum, kind: s.kind, members: s.members, share: s.share, frame_units: s.units.length, sampled: chosen.length });
      for (const u of chosen) {
        const why = s.unit_reasons?.get(unitKey(u));
        mine.push({
          uid: practiceUid(repo, c.id, u),
          repo,
          kind: "practice",
          concern: c.id,
          concern_title: c.title ?? null,
          unit_kind: c.unit ?? null,
          unit: u,
          assigned:
            s.kind === "unknown"
              ? { kind: "unknown", variant: null, label: null, mechanisms: [], instruments: [], reason: why?.reason ?? null, instrument: why?.instrument ?? null }
              : { kind: s.kind, variant: s.stratum, label: s.label, mechanisms: s.mechanisms, instruments: s.instruments },
          apart: [...s.apart],
          apart_of: Object.fromEntries(s.apart.map((a) => [a, { role: "variant", variant: s.stratum }])),
          stratum: s.stratum,
          stratum_members: s.members,
          stratum_sampled: chosen.length,
          concern_total: f.total,
          share: s.share,
          frame: f.frame,
        });
      }
    });
    const dom = f.strata.filter((s) => s.kind === "known")[0];
    const domItems = dom ? mine.filter((it) => it.stratum === dom.stratum) : [];
    for (const v of f.strata) {
      if (!dom || v.stratum === dom.stratum || !v.apart.length) continue;
      const ctl = shuffle(domItems, `${seed}:${repo}:${c.id}:${v.key}:controls`).slice(0, sample.controls_per_line);
      for (const it of ctl)
        for (const a of v.apart) {
          if (it.apart_of[a]) continue; // already on the card (D's own attribute, or another variant's control)
          it.apart.push(a);
          it.apart_of[a] = { role: "control", variant: v.stratum };
          rec.controls++;
        }
    }
    for (const it of mine) it.apart.sort();
    items.push(...mine);
    record.push(rec);
    population.push({ repo, concern: c.id, total: f.total, strata: rec.strata.map((x) => ({ stratum: x.stratum, kind: x.kind, members: x.members, sampled: x.sampled })) });
  }
  return { items, record, population };
}
// The stratum weights of a sample (F6): each item stands for stratum_members / stratum_sampled units. The weights of
// the sampled strata plus the members of the strata nobody sampled sum to the population.
export function weightsOf(items, population) {
  const w = new Map(items.map((q) => [q.uid, q.stratum_sampled > 0 ? q.stratum_members / q.stratum_sampled : 0]));
  const total = sum(population.map((p) => p.total));
  const unsampled = sum(population.flatMap((p) => p.strata.filter((s) => !s.sampled).map((s) => s.members)));
  return { w, total, covered: total - unsampled, unsampled };
}

// ---------------------------------------------------------------------------------------------------------
// Scoring (F6): describe records (labels/A, B, C) and match records (labels/MA, MB, MC) give each labeller's label
// (lib.mjs derivePracticeLabel); A and B agree, or C's is final.
// ---------------------------------------------------------------------------------------------------------
const indexBy = (recs) => new Map(recs.map((r) => [uidOf(r), r]));
// The label of one describing labeller for one item: from their description and their matcher's answer.
export function labelOf(q, desc, match) {
  if (!desc) return null;
  if (!match) return null;
  return derivePracticeLabel(q.assigned?.kind, desc.does, match.same);
}
// The final label from A, B and C: the agreed label, C's, or UNRESOLVED (A and B differ, no C) / UNLABELLED.
export function finalLabel(a, b, c) {
  if (a && b && a === b) return a;
  if (a && b) return c ?? "UNRESOLVED";
  return "UNLABELLED";
}
export function finalApart(attr, a, b, c) {
  const v = (r) => (r?.apart ?? []).find((x) => x.attribute === attr)?.verdict;
  if (a && b && v(a) === v(b) && v(a)) return v(a);
  if (a && b) return v(c) ?? "UNRESOLVED";
  return "UNLABELLED";
}
// The final describe outcome (for FALSE_NONE): agreed, C's, or null.
const finalDoes = (a, b, c) => (a && b && a.does === b.does ? a.does : a && b ? c?.does ?? null : null);
// A rate with its Wilson interval and its repo-cluster bootstrap interval (the primary one: units of one repo are
// correlated). rows: [{ repo, hit: boolean }].
export function rateOf(rows, seed = "drift-practices-r13") {
  const w = wilson(rows.filter((r) => r.hit).length, rows.length);
  const by = new Map();
  for (const r of rows) {
    const c = by.get(r.repo) ?? { k: 0, n: 0 };
    c.n++;
    if (r.hit) c.k++;
    by.set(r.repo, c);
  }
  const cb = clusterBootstrap([...by.values()], { seed });
  return { ...w, cluster_lo: cb.lo, cluster_hi: cb.hi, clusters: cb.clusters };
}
// A stratum-weighted rate (F6) with its repo-cluster bootstrap interval: rows [{ repo, w, hit }], and per repo the
// population mass the rate is over (denominators: { repo: mass }). The point is sum(w * hit) / sum(mass); resampling
// repos recomputes it. Strata nobody sampled are in the mass and count as not hit [STRICT].
export function weightedRate(rows, mass, { iters = 4000, seed = "drift-practices-r13" } = {}) {
  const repos = [...new Set([...Object.keys(mass), ...rows.map((r) => r.repo)])].sort();
  const per = repos.map((repo) => ({ k: sum(rows.filter((r) => r.repo === repo && r.hit).map((r) => r.w)), n: mass[repo] ?? sum(rows.filter((r) => r.repo === repo).map((r) => r.w)) }));
  const N = sum(per.map((x) => x.n));
  const p = N > 0 ? sum(per.map((x) => x.k)) / N : NaN;
  const cb = clusterBootstrap(per, { iters, seed });
  return { p, mass: N, repos: per.filter((x) => x.n > 0).length, cluster_lo: cb.lo, cluster_hi: cb.hi };
}
// "What sets it apart" lines (concern, repo, variant, attribute): the variant's own verdicts and its controls'.
export function apartLines(rows) {
  const lines = new Map();
  for (const r of rows)
    for (const at of r.q.apart ?? []) {
      const of = r.q.apart_of?.[at] ?? { role: "variant", variant: r.q.stratum };
      const key = `${r.q.repo}\0${r.q.concern}\0${of.variant}\0${at}`;
      const l = lines.get(key) ?? { repo: r.q.repo, concern: r.q.concern, variant: of.variant, attribute: at, variant_verdicts: [], control_verdicts: [] };
      (of.role === "control" ? l.control_verdicts : l.variant_verdicts).push(finalApart(at, r.ma, r.mb, r.mc));
      lines.set(key, l);
    }
  const maj = (vs, v) => vs.length > 0 && vs.filter((x) => x === v).length * 2 > vs.length;
  return [...lines.values()].map((l) => ({
    ...l,
    holds: maj(l.variant_verdicts, "TRUE"),
    controlled: l.control_verdicts.length > 0,
    confirmed: maj(l.variant_verdicts, "TRUE") && maj(l.control_verdicts, "FALSE"),
    coincidence: l.control_verdicts.length > 0 && maj(l.control_verdicts, "TRUE"),
  }));
}
// M-acc per concern and pooled. The PRIMARY figure is the stratum-weighted accuracy (F6) over the concern's whole
// population, strata nobody sampled counted as not correct [STRICT], with its repo-cluster bootstrap interval; its lower
// bound is the pass rule (G7), beside the pre-registered prediction. The unweighted rate (every sampled unit in the
// denominator: UNSURE, NOT_IN_POPULATION, UNRESOLVED and UNLABELLED count against it) is reported beside it.
// FALSE_NONE = units assigned none that do the concern (final description DOES, or unresolved [STRICT]) / units assigned
// none, weighted the same way.
export function score(items, labels, population = [], bars = BARS) {
  const ix = Object.fromEntries(["A", "B", "C", "MA", "MB", "MC"].map((L) => [L, indexBy(labels[L] ?? [])]));
  const { w } = weightsOf(items, population);
  const rows = items.map((q) => {
    const [a, b, c] = ["A", "B", "C"].map((L) => ix[L].get(q.uid));
    const [ma, mb, mc] = ["MA", "MB", "MC"].map((L) => ix[L].get(q.uid));
    const la = labelOf(q, a, ma);
    const lb = labelOf(q, b, mb);
    const lc = labelOf(q, c, mc);
    return { q, a, b, c, ma, mb, mc, la, lb, final: finalLabel(la, lb, lc), does: finalDoes(a, b, c), w: w.get(q.uid) ?? 0 };
  });
  const block = (rs, id = null) => {
    const pop = population.filter((p) => id === null || p.concern === id);
    const massBy = (pred) => {
      const m = {};
      for (const p of pop) m[p.repo] = (m[p.repo] ?? 0) + sum(p.strata.filter(pred).map((s) => s.members));
      return m;
    };
    const counts = Object.fromEntries([...PRACTICE_LABELS, "UNRESOLVED", "UNLABELLED"].map((l) => [l, rs.filter((r) => r.final === l).length]));
    const acc = rateOf(rs.map((r) => ({ repo: r.q.repo, hit: r.final === "CORRECT" })));
    const weighted = weightedRate(rs.map((r) => ({ repo: r.q.repo, w: r.w, hit: r.final === "CORRECT" })), massBy(() => true));
    const none = rs.filter((r) => r.q.assigned?.kind === "none");
    const doesIt = (r) => r.does === "DOES" || r.does === null; // unresolved or unlabelled: counted as doing it [STRICT]
    const fn = rateOf(none.map((r) => ({ repo: r.q.repo, hit: doesIt(r) })));
    const fnWeighted = weightedRate(none.map((r) => ({ repo: r.q.repo, w: r.w, hit: doesIt(r) })), massBy((s) => s.kind === "none" && s.sampled > 0));
    const lines = apartLines(rs);
    const controlled = lines.filter((l) => l.controlled);
    const verdicts = lines.flatMap((l) => l.variant_verdicts);
    const pairs = rs.filter((r) => r.la && r.lb).map((r) => [r.la, r.lb]);
    const byKind = Object.fromEntries(["known", "none", "unknown"].map((k) => {
      const sub = rs.filter((r) => r.q.assigned?.kind === k);
      return [k, { n: sub.length, correct: sub.filter((r) => r.final === "CORRECT").length }];
    }));
    const repos = new Set(rs.map((r) => r.q.repo)).size;
    const gateFn = id !== null && bars.false_none_gate.includes(id);
    const met = {
      n: rs.length >= bars.min_n,
      repos: repos >= bars.min_repos,
      // the pass rule: the cluster lower bound of the stratum-weighted accuracy (G7); undefined (< 2 repos) is not met
      acc_lower: Number.isFinite(weighted.cluster_lo) && weighted.cluster_lo >= bars.acc_lower,
      acc_point: Number.isFinite(weighted.p) && weighted.p >= bars.acc_point,
      ...(gateFn ? { false_none: fn.n >= bars.none_min && Number.isFinite(fnWeighted.p) && fnWeighted.p <= bars.false_none_max } : {}),
    };
    return {
      n: rs.length,
      repos,
      primary: id === null ? null : PRIMARY.includes(id),
      prediction: id === null ? null : PREDICTIONS[id] ?? null,
      counts,
      accuracy: weighted,
      accuracy_unweighted: acc,
      by_kind: byKind,
      false_none: { ...fnWeighted, n: fn.n, unweighted: fn },
      apart: {
        units: { ...wilson(verdicts.filter((v) => v === "TRUE").length, verdicts.length), verdicts: Object.fromEntries([...APART_VERDICTS, "UNRESOLVED", "UNLABELLED"].map((v) => [v, verdicts.filter((x) => x === v).length])) },
        lines: lines.length,
        controlled: controlled.length,
        confirmed: wilson(controlled.filter((l) => l.confirmed).length, controlled.length),
        coincidences: controlled.filter((l) => l.coincidence).length,
      },
      // F2: raw agreement always; kappa and AC1 only at n >= 30
      agreement: { n: pairs.length, po: pairs.length ? pairs.filter(([x, y]) => x === y).length / pairs.length : NaN, ...(pairs.length >= MIN_N_CHANCE_CORRECTED ? { kappa: cohen(pairs, PRACTICE_LABELS).kappa, ac1: gwetAC1(pairs, PRACTICE_LABELS).ac1 } : {}), disagreements: rs.filter((r) => r.la && r.lb && r.la !== r.lb).map((r) => r.q.uid) },
      met,
      bar_met: Object.values(met).every(Boolean),
    };
  };
  const concerns = CONCERNS.map((id) => ({ id, ...block(rows.filter((r) => r.q.concern === id), id) })).filter((c) => c.n > 0);
  const primary = PRIMARY.map((id) => concerns.find((c) => c.id === id) ?? { id, n: 0, bar_met: false, missing: true });
  return {
    bars,
    concerns,
    pooled: block(rows),
    primary_met: primary.filter((c) => c.bar_met).length,
    primary_failed: primary.filter((c) => !c.bar_met).map((c) => c.id),
    concerns_met: concerns.filter((c) => c.bar_met).length,
    // F6: authn units reported apart (auth cards are reported apart by metrics.mjs, under rubric v4's strict R3)
    authn_units: concerns.find((c) => c.id === "authn") ?? null,
    unresolved: rows.filter((r) => r.final === "UNRESOLVED").map((r) => r.q.uid),
  };
}
const ci3 = (w) => (w.n ? `${pct(w.p, 1)} [${pct(w.lo, 1)}–${pct(w.hi, 1)}]` : "–");
const cl3 = (w) => (Number.isFinite(w.p) ? `${pct(w.p, 1)} [${Number.isFinite(w.cluster_lo) ? `${pct(w.cluster_lo, 1)}–${pct(w.cluster_hi, 1)}` : "–"}]` : "–");
export function scoreMarkdown(s) {
  const yes = (b) => (b ? "yes" : "no");
  const out = [
    `## M-acc (primary concerns gate: stratum-weighted accuracy, repo-cluster bootstrap lower bound ≥ ${pct(s.bars.acc_lower)} and point ≥ ${pct(s.bars.acc_point)}, n ≥ ${s.bars.min_n} from ≥ ${s.bars.min_repos} repos; FALSE_NONE ≤ ${pct(s.bars.false_none_max)} of ≥ ${s.bars.none_min} units assigned none on ${s.bars.false_none_gate.join(" and ")})`,
    "",
    `Failed bars are published: ${s.primary_failed.length ? s.primary_failed.join(", ") : "none"} of the primary concerns fail. Labelled by models, not maintainers.`,
    "",
  ];
  out.push(
    table(
      ["concern", "tier", "n", "repos", "CORRECT", "WRONG_VARIANT", "MISSED", "FALSE_NONE", "NOT_IN_POP", "UNSURE", "unresolved", "weighted accuracy [cluster 95%]", "unweighted [Wilson]", "predicted", "FALSE_NONE of none, weighted [cluster]", "apart confirmed / coincidences", "A/B agreement", "bars met"],
      [...s.concerns, { id: "pooled", ...s.pooled }].map((c) => [
        c.id,
        c.primary === null ? "–" : c.primary ? "primary" : "secondary",
        c.n,
        c.repos,
        c.counts.CORRECT,
        c.counts.WRONG_VARIANT,
        c.counts.MISSED,
        c.counts.FALSE_NONE,
        c.counts.NOT_IN_POPULATION,
        c.counts.UNSURE,
        c.counts.UNRESOLVED + c.counts.UNLABELLED,
        cl3(c.accuracy),
        ci3(c.accuracy_unweighted),
        c.prediction ? pct(c.prediction.acc) : "–",
        cl3(c.false_none),
        `${c.apart.confirmed.k}/${c.apart.controlled} / ${c.apart.coincidences}`,
        c.agreement.n >= MIN_N_CHANCE_CORRECTED ? `${pct(c.agreement.po, 1)}, κ ${Number.isFinite(c.agreement.kappa) ? c.agreement.kappa.toFixed(2) : "–"}, AC1 ${Number.isFinite(c.agreement.ac1) ? c.agreement.ac1.toFixed(2) : "–"}` : Number.isFinite(c.agreement.po) ? `${pct(c.agreement.po, 1)} (n = ${c.agreement.n})` : "–",
        c.primary === false ? `(${yes(c.bar_met)})` : yes(c.bar_met),
      ]),
    ),
  );
  out.push("", `${s.primary_met} of ${PRIMARY.length} primary concerns meet every M-acc bar.${s.unresolved.length ? ` ${s.unresolved.length} A/B disagreements await C (they count against accuracy until resolved).` : ""} authn units are reported on their own row; auth cards are reported apart by metrics.mjs.`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------
// The variant-recall arm (§9.3, F6): for at least 2 packages per repo, a lister who never sees Drift's output lists the
// mechanisms the package uses for each primary concern; a matcher then marks each as found by one of Drift's variants
// in that package, or missed. Packages are drawn from every package Drift reports units in, for any concern, so the
// choice does not depend on what Drift found for the concern itself.
// ---------------------------------------------------------------------------------------------------------
export function recallSample(repo, j, { seed = SEED, per_repo = SAMPLE.recall_packages } = {}) {
  const pkgs = [...new Set((j.concerns ?? []).flatMap((c) => (c.by_package ?? []).filter((b) => (b.total ?? 0) > 0).map((b) => b.package)))].sort();
  return shuffle(pkgs, `${seed}:recall:${repo}`)
    .slice(0, per_repo)
    .map((pkg) => ({
      uid: `${repo}/recall/pkg-${createHash("sha256").update(pkg).digest("hex").slice(0, 8)}`,
      repo,
      kind: "practice-recall",
      package: pkg,
      concerns: PRIMARY,
      // for the matcher only, never for the lister
      drift_variants: Object.fromEntries(
        PRIMARY.map((id) => {
          const c = (j.concerns ?? []).find((x) => x.id === id);
          const b = (c?.by_package ?? []).find((x) => x.package === pkg);
          const byId = new Map((c?.variants ?? []).map((v) => [v.id, v]));
          return [id, (b?.variants ?? []).map((v) => ({ id: v.id, label: byId.get(v.id)?.label ?? null, kind: byId.get(v.id)?.kind ?? null, mechanisms: byId.get(v.id)?.mechanisms ?? [], instruments: byId.get(v.id)?.instruments ?? [] }))];
        }),
      ),
    }));
}
export const RECALL_MATCH = ["FOUND", "PARTIAL", "MISSED"];
export function recallMarkdown(r) {
  const row = (c) => [c.id ?? "pooled", c.n, c.repos, cl3(c.recall), c.prediction ? pct(c.prediction) : "–", c.id && !PRIMARY.includes(c.id) ? `(${c.met ? "yes" : "no"})` : c.met ? "yes" : "no"];
  return ["", `## Variant recall (FOUND / every mechanism listed, PARTIAL not found; bar: repo-cluster lower bound ≥ ${pct(BARS.recall)} from ≥ ${BARS.min_repos} repos)`, "", table(["concern", "mechanisms", "repos", "recall [cluster 95%]", "predicted", "bar met"], [...r.concerns.map(row), row(r.pooled)]), "", `${r.unmatched.length} packages without a match yet.`, ""].join("\n");
}
// Variant recall: FOUND / every mechanism the lister listed (PARTIAL counts as not found [STRICT]); per concern and pooled,
// with the repo-cluster interval. matches: [{ uid, concerns: { <concern>: [{ match }] } }] (one record per package).
export function recallScore(items, matches, bars = BARS) {
  const M = indexBy(matches);
  const rows = items.flatMap((q) => Object.entries(M.get(q.uid)?.concerns ?? {}).flatMap(([concern, ms]) => (ms ?? []).map((m) => ({ repo: q.repo, concern, hit: m.match === "FOUND" }))));
  const unmatched = items.filter((q) => !M.has(q.uid)).map((q) => q.uid);
  const block = (rs, id = null) => {
    const r = rateOf(rs);
    const repos = new Set(rs.map((x) => x.repo)).size;
    return { id, n: rs.length, repos, recall: r, prediction: id ? PREDICTIONS[id]?.recall ?? null : null, met: Number.isFinite(r.cluster_lo) && r.cluster_lo >= bars.recall && repos >= bars.min_repos };
  };
  return { concerns: CONCERNS.map((id) => block(rows.filter((x) => x.concern === id), id)).filter((c) => c.n > 0), pooled: block(rows), unmatched };
}

// ---------------------------------------------------------------------------------------------------------
// The human gold subset (§9.3, F5; planned, pending the owner's decision D-4): 20 units per primary concern of the M-acc
// sample, about 100. The form and the report are human-anchor.mjs; nothing is labelled.
// ---------------------------------------------------------------------------------------------------------
export function goldSample(items, { seed = SEED, per_concern = 20 } = {}) {
  return PRIMARY.flatMap((id) => shuffle(items.filter((q) => q.concern === id).sort((a, b) => a.uid.localeCompare(b.uid)), `${seed}:gold:${id}`).slice(0, per_concern));
}

// ---------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (mode === "mcov") {
    if (!args.run) die("mcov: --run RUNDIR is required");
    const pool = writeMcov(resolve(args.run));
    console.log(`M-cov: ${pool.concerns_at_target} of ${pool.concerns_with_units} concerns at target (pooled and median ≥ ${pct(pool.target)}); all concerns pooled ${fx(pool.all.coverage)}, median ${fx(pool.all.median)}; ${pool.failed.length} failed repos`);
    return;
  }
  if (mode === "sample") {
    for (const k of ["runs", "out", "cache"]) if (!args[k]) die(`sample: --${k} is required`);
    const src = resolve(args.runs);
    const out = resolve(args.out);
    if (existsSync(join(out, "queue.json"))) die(`${out}/queue.json exists: a sample is drawn once (start a new run directory)`);
    const srcRun = readJson(join(src, "run.json"));
    const seed = args.seed ?? `${SEED}:${srcRun.manifest_set_id ?? basename(src)}`;
    const items = [];
    const record = [];
    const repos = [];
    const recall = [];
    const population = [];
    const all = loadRunRepos(src);
    const usable = (r) => !r.failed && r.practices && !r.cov.problems.length;
    // the per-concern caps and the oversampling of none, from the population counts of the whole set (no label is seen)
    const sizes = sampleSizes(all.filter(usable).map((r) => r.practices));
    for (const r of all) {
      const meta = (srcRun.repos ?? []).find((x) => x.name === r.name) ?? {};
      if (!usable(r)) {
        record.push({ repo: r.name, skipped: r.failed ?? "inconsistent JSON" });
        continue;
      }
      recall.push(...recallSample(r.name, r.practices, { seed }));
      const s = sampleRepo(r.name, r.practices, { seed, sizes });
      items.push(...s.items);
      record.push(...s.record);
      population.push(...s.population);
      const checkout = args.checkouts ? join(resolve(args.checkouts), r.name) : meta.checkout ?? null;
      repos.push({ name: r.name, url: meta.url ?? null, sha: r.sha, checkout, status: checkout && existsSync(checkout) ? "ok" : "no checkout" });
    }
    mkdirSync(out, { recursive: true });
    const run = basename(out);
    const created_at = new Date().toISOString();
    writeFileSync(join(out, "run.json"), JSON.stringify({ run, kind: "practice", prepared_at: created_at, source: src, manifest: srcRun.manifest ?? null, drift: srcRun.drift ?? null, params: { cache: resolve(args.cache), seed, sample: SAMPLE }, repos }, null, 2) + "\n");
    writeFileSync(join(out, "queue.json"), JSON.stringify({ run, kind: "practice", items, population }, null, 2) + "\n");
    writeFileSync(join(out, "sample.json"), JSON.stringify({ seed, sample: SAMPLE, sizes, record }, null, 2) + "\n");
    // the variant-recall arm's packages and the human gold subset (planned, pending funding), drawn with the sample
    writeFileSync(join(out, "recall.json"), JSON.stringify({ run, kind: "practice-recall", items: recall }, null, 2) + "\n");
    writeFileSync(join(out, "gold.json"), JSON.stringify({ run, status: "planned, pending funding", uids: goldSample(items, { seed }).map((q) => q.uid) }, null, 2) + "\n");
    const frames = new Set(record.filter((x) => x.frame).map((x) => x.frame));
    console.log(`sample: ${items.length} units from ${repos.length} repos (${record.filter((x) => x.skipped).length} skipped); frame ${[...frames].join(", ") || "–"}; seed ${seed}`);
    if (repos.some((r) => r.status !== "ok")) console.error(`warning: ${repos.filter((r) => r.status !== "ok").length} repos have no checkout; pass --checkouts DIR before labelling`);
    return;
  }
  if (mode === "score") {
    if (!args.run) die("score: --run DIR is required");
    const d = resolve(args.run);
    const q = readJson(join(d, "queue.json"));
    if (q.kind !== "practice") die(`${d}: not a practice run`);
    const labels = Object.fromEntries(["A", "B", "C", "MA", "MB", "MC"].map((L) => [L, readJsonlAll(join(d, "labels", L))]));
    const s = score(q.items, labels, q.population ?? []);
    // variant recall (§3.4), from recall.json and R1's matches, when they exist
    const recallItems = existsSync(join(d, "recall.json")) ? readJson(join(d, "recall.json")).items : [];
    const r1 = readJsonlAll(join(d, "labels", "R1"));
    s.recall = recallItems.length ? recallScore(recallItems, r1) : null;
    writeFileSync(join(d, "score.json"), JSON.stringify(s, null, 2) + "\n");
    writeFileSync(join(d, "score.md"), scoreMarkdown(s) + (s.recall ? recallMarkdown(s.recall) : ""));
    console.log(`M-acc: ${s.concerns_met} of ${s.concerns.length} concerns meet every bar; primary concerns meeting every bar ${s.primary_met} of ${PRIMARY.length}; pooled weighted ${cl3(s.pooled.accuracy)} over ${s.pooled.n} units`);
    return;
  }
  die("usage: practices.mjs mcov --run RUNDIR | sample --runs RUNDIR --out DIR --cache DIR [--seed TEXT] [--checkouts DIR] | score --run DIR");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
