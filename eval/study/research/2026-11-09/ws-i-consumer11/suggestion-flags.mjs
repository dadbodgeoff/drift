#!/usr/bin/env node
// Suggestion-tier flag precision per fold, before -> after, for two census directories (WS-I record):
//   node eval/study/research/2026-11-09/ws-i-consumer11/suggestion-flags.mjs <before dir> <after dir>
// The same reading as generalise.mjs §5 (defaultTier: ACCEPT / shown, and (mistake + look) / the A and B per-outlier
// verdicts, followed through carried rows; a card whose outlier count is not the labelled one is untraced), on the
// suggestion-tier cards instead of the default tier. Build-set data only (generalise's path checks apply).
import { FOLD5 } from "../../../folds.mjs";
import { IN_SAMPLE, defaultTier, loadAll, loadCensusDir, pct, verdictsOf, withLabel } from "../../../generalise.mjs";

const [bdir, adir] = process.argv.slice(2);
const { folds, snaps, dev3 } = loadAll();
const now = snaps[IN_SAMPLE];
const labels = new Map([...now.labels, ...(dev3?.labels ?? new Map())]);
const isF5 = (c) => folds.repos.get(c.repo)?.fold === FOLD5;
const vOf = (c) => {
  const l = isF5(c) ? dev3?.cards.get(c.uid) : now.cards.get(c.uid);
  if (!l || l.outliers !== c.outliers) return null;
  return verdictsOf(isF5(c) ? dev3 : now, l);
};
const asDefault = (cs) => cs.map((c) => ({ ...withLabel(c, labels), tier: c.tier === "suggestion" ? "default" : "other" }));
for (const lang of ["ts", "py"]) {
  const [b, a] = [bdir, adir].map((d) => asDefault(loadCensusDir(d, folds).filter((c) => c.lang === lang)));
  const [tb, ta] = [b, a].map((cs) => defaultTier(cs, folds, vOf));
  console.log(`## ${lang === "ts" ? "TS" : "Python"}: suggestion tier per fold (ACCEPT / shown; flag precision), before -> after`);
  for (const k of Object.keys(tb)) {
    const t = (x) => `${pct(x.accept, x.shown)}, flag precision ${pct(x.flags.real, x.flags.n)}${x.flags.untraced ? ` (${x.flags.untraced} untraced)` : ""}`;
    console.log(`   ${/^\d$/.test(k) ? `fold ${k}` : k === "build" ? "folds 1-4" : "all five"}: ${t(tb[k])} -> ${t(ta[k])}`);
  }
}
