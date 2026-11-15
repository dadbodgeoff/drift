#!/usr/bin/env node
// Round-10 planning analysis (dev data only, in-sample). Reads the dev v3 label
// runs and the PR-mention table, and prints how much of relabel5's dev accept
// comes from cards that round 5-9 fixes were tuned on, a leave-one-repo-out
// (LORO) view of those fixes, label-noise checks and shown-set policies.
// No held-out file is read. Usage: node r10-history.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runs = path.resolve(here, '../../runs');
const EXCLUDED = new Set(['polar', 'CTFd']);

// Snapshots: product commit and the round whose end it marks.
const SNAP = [
  { key: 'v3', run: 'dev-v3-2026-11-06', commit: 'debc33a', after: 'round 3 (before round 4)', parts: ['ts', 'py', 'py2'] },
  { key: 'r2', run: 'dev-v3-relabel2-2026-11-07', commit: 'feefad6', after: 'round 4', parts: ['ts'] },
  { key: 'r3', run: 'dev-v3-relabel3-2026-11-07', commit: 'e9c6058', after: 'round 5', parts: ['ts', 'py', 'py2'] },
  { key: 'r4', run: 'dev-v3-relabel4-2026-11-07', commit: '2c81ba4', after: 'round 6', parts: ['ts', 'py', 'py2'] },
  { key: 'r5', run: 'dev-v3-relabel5-2026-11-07', commit: 'de57356', after: 'round 9', parts: ['ts', 'py', 'py2'] },
];
const LANG = { ts: 'TS', py: 'Py', py2: 'Py' };

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function loadSnap(s) {
  const cards = new Map();
  for (const p of s.parts) {
    const q = JSON.parse(fs.readFileSync(path.join(runs, s.run, p, 'views/d7/queue.json'), 'utf8')).items;
    const labels = new Map(readJsonl(path.join(runs, s.run, p, 'final.jsonl')).map((r) => [r.uid, r]));
    for (const it of q) {
      if (EXCLUDED.has(it.repo)) continue;
      const l = labels.get(it.uid);
      cards.set(it.uid, {
        uid: it.uid, repo: it.repo, part: p, lang: LANG[p], tier: it.tier, family: it.family,
        kind: it.rule_kind, outliers: it.outliers, holders: it.evidence?.holders, total: it.evidence?.total,
        lb: it.evidence?.lower_bound, lift: it.evidence?.lift, rank: it.rank, summary: it.summary, proposal_lang: it.python_members == null ? 'ts' : 'py',
        label: l ? l.label : 'UNLABELLED', why: l?.wrong_because ?? null, fresh: l ? !l.carried_from : null,
      });
    }
  }
  return cards;
}
const snaps = Object.fromEntries(SNAP.map((s) => [s.key, loadSnap(s)]));
const prs = JSON.parse(fs.readFileSync(path.join(here, 'pr-mentions.json'), 'utf8')).prs;

// id -> repo over every snapshot (ids are content hashes; check uniqueness).
const idRepo = new Map();
const collide = new Set();
for (const c of Object.values(snaps).flatMap((m) => [...m.values()])) {
  const id = c.uid.split('/')[1];
  if (idRepo.has(id) && idRepo.get(id) !== c.repo) collide.add(id);
  idRepo.set(id, c.repo);
}
for (const pr of prs) {
  pr.uids = pr.ids.filter((i) => idRepo.has(i) && !collide.has(i)).map((i) => `${idRepo.get(i)}/${i}`);
  pr.repos = [...new Set(pr.uids.map((u) => u.split('/')[0]))].sort();
}
const touchedBy = (uid, rounds) => prs.filter((p) => rounds.includes(p.round) && p.uids.includes(uid));

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');
const out = {};
const log = (...a) => console.log(...a);
const isA = (c) => c && c.label === 'ACCEPT';

// 1. Accept by snapshot, language and tier.
log('## 1. Per-card accept by snapshot (D7 tier, all shown, unlabelled = WRONG)');
out.snapshots = {};
for (const s of SNAP) {
  const row = {};
  for (const lang of ['TS', 'Py']) {
    const cs = [...snaps[s.key].values()].filter((c) => c.lang === lang);
    if (!cs.length) continue;
    const d = cs.filter((c) => c.tier === 'default');
    row[lang] = { all: [cs.filter(isA).length, cs.length], default: [d.filter(isA).length, d.length],
      not_wrong: [cs.filter((c) => c.label === 'ACCEPT' || c.label === 'TRIVIAL').length, cs.length],
      repos: new Set(cs.map((c) => c.repo)).size };
    log(`${s.key} ${s.commit} after ${s.after} ${lang}: all ${pct(...row[lang].all)}; default ${pct(...row[lang].default)}; not-wrong ${pct(...row[lang].not_wrong)}`);
  }
  out.snapshots[s.key] = row;
}

// 2. Lineage of relabel5 cards against a baseline, with PR attribution.
function lineage(baseKey, lang, rounds) {
  const base = snaps[baseKey], now = snaps.r5;
  const nowC = [...now.values()].filter((c) => c.lang === lang);
  const baseC = [...base.values()].filter((c) => c.lang === lang);
  const cls = { held_A: [], flipped_to_A: [], new_A: [], held_nonA: [], flipped_from_A: [], new_nonA: [] };
  for (const c of nowC) {
    const b = base.get(c.uid);
    if (!b) cls[isA(c) ? 'new_A' : 'new_nonA'].push(c);
    else if (isA(c)) cls[isA(b) ? 'held_A' : 'flipped_to_A'].push(c);
    else cls[isA(b) ? 'flipped_from_A' : 'held_nonA'].push(c);
  }
  const hidden = baseC.filter((b) => !now.has(b.uid));
  const hiddenA = hidden.filter(isA), hiddenW = hidden.filter((b) => !isA(b));
  const touched = (c) => touchedBy(c.uid, rounds).length > 0;
  const res = {
    baseline: baseKey, lang, shown_now: nowC.length, accept_now: nowC.filter(isA).length,
    shown_base: baseC.length, accept_base: baseC.filter(isA).length,
    classes: Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, { n: v.length, pr_touched: v.filter(touched).length }])),
    hidden: { accept: hiddenA.length, accept_pr_touched: hiddenA.filter(touched).length,
      nonaccept: hiddenW.length, nonaccept_pr_touched: hiddenW.filter(touched).length },
  };
  // Counterfactual 1: undo every relabel5 card change that a round-5..9 PR names by id.
  //  - a flipped card a PR names returns to its baseline label;
  //  - a new card a PR names is removed; a hidden baseline card a PR names returns.
  let A = res.accept_now, N = res.shown_now;
  for (const c of cls.flipped_to_A) if (touched(c)) A -= 1;
  for (const c of cls.flipped_from_A) if (touched(c)) A += 1;
  for (const c of cls.new_A) if (touched(c)) { A -= 1; N -= 1; }
  for (const c of cls.new_nonA) if (touched(c)) N -= 1;
  for (const b of hidden) if (touched(b)) { N += 1; if (isA(b)) A += 1; }
  res.undo_named = { accept: A, shown: N };
  // Gains: accepts now that were not accepts at the baseline.
  const gains = [...cls.flipped_to_A, ...cls.new_A];
  res.gain_cards = gains.length;
  res.gain_named = gains.filter(touched).length;
  res.gain_named_repo_share = (() => {
    const m = {};
    for (const c of gains) m[c.repo] = (m[c.repo] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  })();
  return { res, cls, hidden };
}

log('\n## 2. Lineage of relabel5 cards, PR attribution (a PR "names" a card when its body cites the id)');
out.lineage = [];
for (const [baseKey, lang, rounds] of [['r2', 'TS', [5, 6, 8, 9]], ['v3', 'TS', [4, 5, 6, 8, 9]], ['v3', 'Py', [4, 5, 6, 8, 9]], ['r3', 'Py', [6, 8, 9]]]) {
  const { res } = lineage(baseKey, lang, rounds);
  out.lineage.push({ ...res, rounds });
  log(`${lang} vs ${baseKey} (PR rounds ${rounds.join(',')}): now ${pct(res.accept_now, res.shown_now)}; base ${pct(res.accept_base, res.shown_base)}`);
  log(`  classes: ${Object.entries(res.classes).map(([k, v]) => `${k} ${v.n} (named ${v.pr_touched})`).join('; ')}`);
  log(`  hidden since base: ACCEPT ${res.hidden.accept} (named ${res.hidden.accept_pr_touched}), non-ACCEPT ${res.hidden.nonaccept} (named ${res.hidden.nonaccept_pr_touched})`);
  log(`  gains (accepts now, not at base): ${res.gain_cards}, named by a PR ${res.gain_named}; by repo ${res.gain_named_repo_share.map(([r, n]) => `${r} ${n}`).join(', ')}`);
  log(`  undo every PR-named change: ${pct(res.undo_named.accept, res.undo_named.shown)}`);
}

// 3. LORO over the fixes: for each repo, the PR-named card changes whose PR names
//    no other dev repo (the rule would not have been written without this repo).
log('\n## 3. LORO over round 5-9 fixes (PRs that name cards in only one repo, or in <=2 repos)');
const prodPrs = prs.filter((p) => [5, 6, 8, 9].includes(p.round) && p.uids.length);
for (const p of prodPrs) log(`#${p.pr} r${p.round} ${p.head}: ${p.uids.length} ids in ${p.repos.length} repos (${p.repos.join(', ')})`);
out.loro = {};
for (const lang of ['TS', 'Py']) {
  const base = lang === 'TS' ? snaps.r2 : snaps.v3;
  const now = snaps.r5;
  const repos = [...new Set([...now.values()].filter((c) => c.lang === lang).map((c) => c.repo))].sort();
  const rows = [];
  let tA = 0, tN = 0, kA = 0, kN = 0, k2A = 0, k2N = 0;
  for (const r of repos) {
    const nowC = [...now.values()].filter((c) => c.lang === lang && c.repo === r);
    const baseC = [...base.values()].filter((c) => c.lang === lang && c.repo === r);
    // Undo the changes whose naming PRs all cite fewer than `k` other repos.
    const undo = (minOther) => {
      const ok = (uid) => {
        const t = touchedBy(uid, [5, 6, 8, 9]);
        if (!t.length) return true; // not named: keep as is
        return t.some((p) => p.repos.filter((x) => x !== r).length >= minOther);
      };
      let A = nowC.filter(isA).length, N = nowC.length;
      for (const c of nowC) {
        const b = base.get(c.uid);
        if (ok(c.uid)) continue;
        if (!b) { N -= 1; if (isA(c)) A -= 1; } else if (isA(c) !== isA(b)) A += isA(b) ? 1 : -1;
      }
      for (const b of baseC) if (!now.has(b.uid) && !ok(b.uid)) { N += 1; if (isA(b)) A += 1; }
      return [A, N];
    };
    const [a1, n1] = undo(1), [a2, n2] = undo(2);
    const A = nowC.filter(isA).length, N = nowC.length;
    tA += A; tN += N; kA += a1; kN += n1; k2A += a2; k2N += n2;
    rows.push({ repo: r, now: [A, N], base: [baseC.filter(isA).length, baseC.length], loro1: [a1, n1], loro2: [a2, n2] });
  }
  out.loro[lang] = { rows, total: [tA, tN], loro1: [kA, kN], loro2: [k2A, k2N] };
  log(`${lang}: now ${pct(tA, tN)}; undo single-repo fixes ${pct(kA, kN)}; undo fixes naming <=2 repos ${pct(k2A, k2N)}`);
  for (const x of rows) if (x.loro1[0] !== x.now[0] || x.loro1[1] !== x.now[1] || x.loro2[0] !== x.now[0] || x.loro2[1] !== x.now[1])
    log(`   ${x.repo}: base ${pct(...x.base)} now ${pct(...x.now)} loro1 ${pct(...x.loro1)} loro2 ${pct(...x.loro2)}`);
}

// 4. Repo concentration of the dev gain: leave one repo out of the rate itself.
log('\n## 4. Leave-one-repo-out of the baseline->relabel5 gain');
out.gain_loro = {};
for (const [lang, bk] of [['TS', 'r2'], ['TS', 'v3'], ['Py', 'v3']]) {
  const nowC = [...snaps.r5.values()].filter((c) => c.lang === lang);
  const baseC = [...snaps[bk].values()].filter((c) => c.lang === lang);
  const rate = (cs) => cs.filter(isA).length / cs.length;
  const full = rate(nowC) - rate(baseC);
  const per = [...new Set(nowC.map((c) => c.repo))].map((r) => {
    const g = rate(nowC.filter((c) => c.repo !== r)) - rate(baseC.filter((c) => c.repo !== r));
    return [r, g];
  }).sort((a, b) => a[1] - b[1]);
  const perRepo = [...new Set(nowC.map((c) => c.repo))].map((r) => {
    const n = nowC.filter((c) => c.repo === r), b = baseC.filter((c) => c.repo === r);
    return { repo: r, now: [n.filter(isA).length, n.length], base: [b.filter(isA).length, b.length] };
  });
  out.gain_loro[`${lang}_${bk}`] = { full, per, perRepo };
  log(`${lang} ${bk}->r5 gain ${(100 * full).toFixed(1)} pts; leaving one repo out ranges ${(100 * per[0][1]).toFixed(1)} (${per[0][0]}) to ${(100 * per.at(-1)[1]).toFixed(1)} (${per.at(-1)[0]})`);
  const ups = perRepo.map((x) => ({ ...x, d: x.now[0] - x.base[0] - 0 })).sort((a, b) => (b.now[0] / b.now[1] - b.base[0] / (b.base[1] || 1)) - (a.now[0] / a.now[1] - a.base[0] / (a.base[1] || 1)));
  log('   per repo (base -> now): ' + ups.map((x) => `${x.repo} ${x.base[0]}/${x.base[1]}->${x.now[0]}/${x.now[1]}`).join(', '));
}

// 5. Label noise: relabel5 cards relabelled only because the lift figure changed.
log('\n## 5. Label stability on relabel5 lift-only relabels and other relabels');
const stage = JSON.parse(fs.readFileSync(path.join(runs, 'dev-v3-relabel5-2026-11-07/stage.json'), 'utf8'));
out.noise = {};
for (const part of ['ts', 'py', 'py2']) {
  for (const p of stage.parts[part].proposals) {
    if (p.action !== 'relabel' || !p.label_from) continue;
    const prev = readJsonl(path.join(runs, p.label_from, 'final.jsonl')).find((r) => r.uid === p.uid);
    const now = snaps.r5.get(p.uid);
    if (!prev || !now) continue;
    const k = `${p.reason}`;
    out.noise[k] ??= { n: 0, same: 0, toA: 0, fromA: 0, cases: [] };
    const o = out.noise[k];
    o.n += 1;
    if (prev.label === now.label) o.same += 1;
    else { if (now.label === 'ACCEPT') o.toA += 1; if (prev.label === 'ACCEPT') o.fromA += 1; o.cases.push(`${p.uid} ${prev.label}->${now.label}`); }
  }
}
for (const [k, o] of Object.entries(out.noise)) log(`${k}: ${o.n} relabelled with an earlier label; same ${o.same}; to ACCEPT ${o.toA}; from ACCEPT ${o.fromA}; ${o.cases.join('; ')}`);

// 6. WRONG causes on dev (relabel5), and how they compare with what each round fixed.
log('\n## 6. relabel5 WRONG causes (dev)');
out.causes = {};
for (const lang of ['TS', 'Py']) {
  const w = [...snaps.r5.values()].filter((c) => c.lang === lang && c.label === 'WRONG');
  const m = {};
  for (const c of w) m[c.why ?? 'none'] = (m[c.why ?? 'none'] || 0) + 1;
  out.causes[lang] = m;
  log(`${lang} WRONG ${w.length}: ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
// Cause history: for every card that was WRONG at a snapshot, its cause, by snapshot.
for (const s of SNAP) {
  for (const lang of ['TS', 'Py']) {
    const w = [...snaps[s.key].values()].filter((c) => c.lang === lang && c.label === 'WRONG');
    if (!w.length) continue;
    const m = {};
    for (const c of w) m[c.why ?? 'none'] = (m[c.why ?? 'none'] || 0) + 1;
    log(`  ${s.key} ${lang} WRONG ${w.length} of ${[...snaps[s.key].values()].filter((c) => c.lang === lang).length}: ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

// 7. Family stability across repos (relabel5), suggestion tier.
log('\n## 7. Family accept across repos (relabel5, suggestion tier): pooled, repo-mean, LORO min/max, repos');
out.families = {};
for (const lang of ['TS', 'Py']) {
  const cs = [...snaps.r5.values()].filter((c) => c.lang === lang && c.tier === 'suggestion');
  const fams = [...new Set(cs.map((c) => c.family))].sort();
  for (const f of fams) {
    const fc = cs.filter((c) => c.family === f);
    const repos = [...new Set(fc.map((c) => c.repo))];
    const rr = repos.map((r) => { const x = fc.filter((c) => c.repo === r); return x.filter(isA).length / x.length; });
    const loro = repos.map((r) => { const x = fc.filter((c) => c.repo !== r); return x.length ? x.filter(isA).length / x.length : NaN; }).filter((v) => !Number.isNaN(v));
    const row = { n: fc.length, a: fc.filter(isA).length, repos: repos.length, repo_mean: rr.reduce((a, b) => a + b, 0) / rr.length,
      loro_min: Math.min(...loro), loro_max: Math.max(...loro), repo_rates: Object.fromEntries(repos.map((r, i) => [r, rr[i]])) };
    out.families[`${lang}:${f}`] = row;
    log(`${lang} ${f}: ${pct(row.a, row.n)} over ${row.repos} repos; repo-mean ${(100 * row.repo_mean).toFixed(0)}%; LORO ${(100 * row.loro_min).toFixed(0)}-${(100 * row.loro_max).toFixed(0)}%`);
  }
}


// 8. LORO over fixes, by beneficial effect: a PR helps repo X when a card of X it
//    names was not ACCEPT at the baseline and is now ACCEPT, or was not ACCEPT and
//    is no longer shown. A repo's helped cards survive LORO only when the PR
//    helped another repo too (the mechanism has evidence outside the repo).
log('\n## 8. LORO over fixes, by beneficial effect (baseline TS r2 / Py v3; PR rounds 5-9)');
out.loro_benefit = {};
for (const [lang, bk] of [['TS', 'r2'], ['TS', 'v3'], ['Py', 'v3']]) {
  const base = snaps[bk], now = snaps.r5;
  const rounds = bk === 'v3' ? [4, 5, 6, 8, 9] : [5, 6, 8, 9];
  const helped = new Map(); // pr -> Set(repo)
  const help = []; // {uid, repo, prs, kind}
  const consider = (uid, repo, kind) => {
    const ps = touchedBy(uid, rounds);
    for (const p of ps) { if (!helped.has(p.pr)) helped.set(p.pr, new Set()); helped.get(p.pr).add(repo); }
    help.push({ uid, repo, prs: ps.map((p) => p.pr), kind });
  };
  for (const c of now.values()) if (c.lang === lang && isA(c) && !isA(base.get(c.uid))) consider(c.uid, c.repo, base.has(c.uid) ? 'flip' : 'new_A');
  for (const b of base.values()) if (b.lang === lang && !isA(b) && !now.has(b.uid)) consider(b.uid, b.repo, 'hidden_nonA');
  let single = 0, unnamed = 0, multi = 0;
  const singleCases = [];
  for (const h of help) {
    if (!h.prs.length) { unnamed += 1; continue; }
    const ok = h.prs.some((pr) => [...helped.get(pr)].some((r) => r !== h.repo));
    if (ok) multi += 1; else { single += 1; singleCases.push(`${h.uid} (${h.kind}; #${h.prs.join(',#')})`); }
  }
  const prHelp = [...helped.entries()].map(([pr, rs]) => `#${pr}:${rs.size}`).join(' ');
  out.loro_benefit[`${lang}_${bk}`] = { events: help.length, multi, single, unnamed, singleCases, prHelp };
  log(`${lang} vs ${bk}: ${help.length} helpful events (gains + hidden non-ACCEPT); helped >1 repo ${multi}, only this repo ${single}, not named ${unnamed}`);
  log(`   PR -> repos helped: ${prHelp}`);
  log(`   single-repo: ${singleCases.join('; ')}`);
}

// 9. Default tier history.
log('\n## 9. Default tier (TS) lineage v3 -> r5');
{
  const now = [...snaps.r5.values()].filter((c) => c.tier === 'default');
  const v3 = snaps.v3;
  const rows = now.map((c) => {
    const b = v3.get(c.uid);
    return `${c.uid} ${c.kind} ${c.label} out=${c.outliers} v3=${b ? b.label : 'not shown'} named=${touchedBy(c.uid, [4, 5, 6, 8, 9]).map((p) => p.pr).join(',')}`;
  });
  const heldA = now.filter((c) => isA(v3.get(c.uid))).length;
  log(`default r5 ${now.length}: ACCEPT at v3 with the same id ${heldA}; others new or flipped`);
  for (const r of rows) log('   ' + r);
  const v3d = [...v3.values()].filter((c) => c.tier === 'default' && c.lang === 'TS');
  log(`v3 default not shown at r5: ${v3d.filter((b) => !snaps.r5.has(b.uid)).map((b) => `${b.uid} ${b.label}/${b.why}`).join('; ')}`);
  const outl = now.map((c) => c.outliers).sort((a, b) => a - b);
  log(`default outliers per card: median ${outl[Math.floor(outl.length / 2)]}, zero ${outl.filter((x) => x === 0).length}, >=10 ${outl.filter((x) => x >= 10).length}`);
}

// 10. Shown-set policies on relabel5 (yield/precision), with LORO-chosen family lists.
log('\n## 10. Shown-set policies (all shown; ACCEPT/shown, cards per repo, repos with >=1 card); r5, then v3 and r4 (rank is W4\'s only at r5)');
out.policies = {};
for (const sk of ['r5', 'v3', 'r4']) for (const lang of ['TS', 'Py']) {
  const cs = [...snaps[sk].values()].filter((c) => c.lang === lang);
  const repos = [...new Set(cs.map((c) => c.repo))];
  const famRate = (pool, f) => { const x = pool.filter((c) => c.tier === 'suggestion' && c.family === f); return x.length ? [x.filter(isA).length, x.length] : [0, 0]; };
  const policies = {
    'all shown': () => true,
    'default tier only': (c) => c.tier === 'default',
    '<=2 outliers': (c) => c.outliers <= 2,
    '<=1 outlier': (c) => c.outliers <= 1,
    '0 outliers': (c) => c.outliers === 0,
    'no ordering family': (c) => c.family !== 'ordering',
    'no ordering, calls, repo families': (c) => !['ordering', 'calls', 'repo'].includes(c.family),
    'rank <= 5': (c) => c.rank <= 5,
    'rank <= 3': (c) => c.rank <= 3,
    'default + sugg <=1 outlier': (c) => c.tier === 'default' || c.outliers <= 1,
    'default + sugg <=1 outlier, no ordering': (c) => c.tier === 'default' || (c.outliers <= 1 && c.family !== 'ordering'),
  };
  const res = {};
  const evalP = (name, pred) => {
    const s = cs.filter(pred);
    const a = s.filter(isA).length;
    const perRepo = repos.map((r) => s.filter((c) => c.repo === r));
    const withAny = perRepo.filter((x) => x.length).length;
    // repo-mean of per-repo accept among repos with cards
    const rm = perRepo.filter((x) => x.length).map((x) => x.filter(isA).length / x.length);
    res[name] = { accept: a, shown: s.length, per_repo: s.length / repos.length, repos_with_cards: withAny, repo_mean: rm.reduce((p, q) => p + q, 0) / (rm.length || 1),
      accepts_per_repo: a / repos.length, wrong: s.filter((c) => c.label === 'WRONG').length };
  };
  for (const [n, p] of Object.entries(policies)) evalP(n, p);
  // LORO family filter: for each repo, keep the suggestion families whose accept on the OTHER repos is >= t (n >= 5); default tier kept.
  for (const t of [0.5, 0.6, 0.7]) {
    let a = 0, n = 0, w = 0;
    for (const r of repos) {
      const others = cs.filter((c) => c.repo !== r);
      const keep = (c) => { if (c.tier === 'default') return true; const [fa, fn] = famRate(others, c.family); return fn >= 5 && fa / fn >= t; };
      const s = cs.filter((c) => c.repo === r && keep(c));
      a += s.filter(isA).length; n += s.length; w += s.filter((c) => c.label === 'WRONG').length;
    }
    res[`LORO families >= ${t * 100}% (n>=5)`] = { accept: a, shown: n, per_repo: n / repos.length, accepts_per_repo: a / repos.length, wrong: w };
    let a2 = 0, n2 = 0, w2 = 0;
    for (const r of repos) {
      const others = cs.filter((c) => c.repo !== r);
      const keep = (c) => { if (c.tier === 'default') return true; if (c.outliers > 1) return false; const [fa, fn] = famRate(others, c.family); return fn >= 5 && fa / fn >= t; };
      const s = cs.filter((c) => c.repo === r && keep(c));
      a2 += s.filter(isA).length; n2 += s.length; w2 += s.filter((c) => c.label === 'WRONG').length;
    }
    res[`LORO families >= ${t * 100}% + <=1 outlier`] = { accept: a2, shown: n2, per_repo: n2 / repos.length, accepts_per_repo: a2 / repos.length, wrong: w2 };
  }
  out.policies[`${sk}:${lang}`] = res;
  log(`${sk} ${lang} (${repos.length} repos):`);
  for (const [n, r] of Object.entries(res)) log(`   ${n}: ${pct(r.accept, r.shown)}; ${r.per_repo.toFixed(1)} cards/repo; ${r.accepts_per_repo.toFixed(2)} accepts/repo; WRONG ${r.wrong}${r.repos_with_cards != null ? `; repos with cards ${r.repos_with_cards}; repo-mean ${(100 * r.repo_mean).toFixed(0)}%` : ''}`);
}

// 11. Accept by outlier count and by snapshot (does the structure-accept link hold across rounds?).
log('\n## 11. Accept by outlier count, suggestion tier, per snapshot');
for (const s of SNAP) for (const lang of ['TS', 'Py']) {
  const cs = [...snaps[s.key].values()].filter((c) => c.lang === lang && c.tier === 'suggestion');
  if (!cs.length) continue;
  const b = (lo, hi) => { const x = cs.filter((c) => c.outliers >= lo && c.outliers <= hi); return pct(x.filter(isA).length, x.length); };
  log(`${s.key} ${lang}: 0: ${b(0, 0)}; 1: ${b(1, 1)}; 2: ${b(2, 2)}; 3-5: ${b(3, 5)}; 6+: ${b(6, 1e9)}`);
}

// 12. Flag precision by family and tier (relabel5, A and B per-outlier verdicts,
//     followed through carried rows as d10.mjs does), and its spread over repos.
log('\n## 12. Flag precision (mistake+look over all verdicts) by language, tier and family, relabel5');
{
  const root = path.resolve(runs, '../../..');
  const recCache = new Map();
  const recordsOf = (dir) => {
    if (recCache.has(dir)) return recCache.get(dir);
    const m = new Map();
    for (const b of [path.join(dir, 'labels'), path.join(dir, 'relabel', 'labels')]) for (const L of ['A', 'B']) {
      const d = path.join(b, L);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) for (const r of readJsonl(path.join(d, f))) {
        if (r.rubric !== 'v3') continue;
        const e = m.get(r.uid) ?? {}; e[L] = r; m.set(r.uid, e);
      }
    }
    recCache.set(dir, m);
    return m;
  };
  const trace = (uid, finalFile, depth = 0) => {
    if (depth > 8 || !fs.existsSync(finalFile)) return null;
    const row = readJsonl(finalFile).find((r) => r.uid === uid);
    if (!row) return null;
    if (row.source === 'carried' && row.carried_from) return trace(uid, path.resolve(root, row.carried_from), depth + 1);
    const recs = recordsOf(path.dirname(finalFile)).get(uid);
    return recs?.A && recs?.B ? recs : null;
  };
  const REAL = new Set(['mistake', 'look']);
  const agg = {};
  const cardShare = [];
  for (const c of snaps.r5.values()) {
    const recs = trace(c.uid, path.join(runs, 'dev-v3-relabel5-2026-11-07', c.part, 'final.jsonl'));
    if (!recs) continue;
    const v = ['A', 'B'].flatMap((L) => (recs[L].outliers ?? []).map((o) => o.verdict));
    if (!v.length) continue;
    const real = v.filter((x) => REAL.has(x)).length;
    cardShare.push({ c, real, n: v.length });
    for (const k of [`${c.lang} ${c.tier}`, `${c.lang} ${c.tier} ${c.family}`]) {
      agg[k] ??= { real: 0, n: 0, repos: {} };
      agg[k].real += real; agg[k].n += v.length;
      agg[k].repos[c.repo] ??= [0, 0]; agg[k].repos[c.repo][0] += real; agg[k].repos[c.repo][1] += v.length;
    }
  }
  out.flag_precision = {};
  for (const [k, a] of Object.entries(agg).sort()) {
    const rr = Object.values(a.repos).map(([r, n]) => r / n);
    out.flag_precision[k] = { real: a.real, n: a.n, repos: rr.length, repo_min: Math.min(...rr), repo_max: Math.max(...rr) };
    log(`${k}: ${pct(a.real, a.n)} over ${rr.length} repos (repo range ${(100 * Math.min(...rr)).toFixed(0)}-${(100 * Math.max(...rr)).toFixed(0)}%)`);
  }
  // Card label against the share of its flags that labellers call real.
  log('card accept by share of verdicts that are real (cards with outliers):');
  for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.999], [0.999, 1]]) {
    const x = cardShare.filter(({ real, n }) => real / n >= lo && (hi === 1 ? real / n >= 0.999 : real / n < hi));
    log(`   real share [${lo},${hi}${hi === 1 ? ']' : ')'}: ${pct(x.filter(({ c }) => isA(c)).length, x.length)}`);
  }
}

// 13. relabel5 WRONG causes by outlier count (what an outlier cap removes).
log('\n## 13. relabel5 WRONG cards: cause by outlier count, and families of incidental WRONGs');
for (const lang of ['TS', 'Py']) {
  const w = [...snaps.r5.values()].filter((c) => c.lang === lang && c.label === 'WRONG');
  const m = {};
  for (const c of w) { const b = c.outliers === 0 ? '0' : c.outliers === 1 ? '1' : c.outliers <= 3 ? '2-3' : '4+'; m[c.why] ??= {}; m[c.why][b] = (m[c.why][b] || 0) + 1; }
  log(`${lang}: ${Object.entries(m).map(([k, v]) => `${k} {${Object.entries(v).map(([b, n]) => `${b}:${n}`).join(' ')}}`).join('; ')}`);
  const inc = {};
  for (const c of w.filter((c) => c.why === 'incidental')) inc[c.family] = (inc[c.family] || 0) + 1;
  log(`   incidental by family: ${Object.entries(inc).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const mg = {};
  for (const c of w.filter((c) => c.why === 'mixed_group')) mg[c.family] = (mg[c.family] || 0) + 1;
  log(`   mixed_group by family: ${Object.entries(mg).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const lo = {};
  for (const c of w.filter((c) => c.why === 'legit_outliers' || c.why === 'false_outliers')) lo[c.family] = (lo[c.family] || 0) + 1;
  log(`   flag errors (legit+false) by family: ${Object.entries(lo).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
// Same for v3 (before rounds 4-9): the untuned picture.
for (const lang of ['TS', 'Py']) {
  const w = [...snaps.v3.values()].filter((c) => c.lang === lang && c.label === 'WRONG');
  const inc = {}, mg = {}, fl = {};
  for (const c of w) { const t = c.why === 'incidental' ? inc : c.why === 'mixed_group' ? mg : (c.why === 'legit_outliers' || c.why === 'false_outliers') ? fl : null; if (t) t[c.family] = (t[c.family] || 0) + 1; }
  log(`v3 ${lang}: incidental ${JSON.stringify(inc)}; mixed_group ${JSON.stringify(mg)}; flag errors ${JSON.stringify(fl)}`);
}

// 14. Family accept per snapshot (suggestion tier): v3 is the least-tuned reading.
log('\n## 14. Suggestion-tier family accept by snapshot (v3 = before rounds 4-9)');
out.family_history = {};
for (const lang of ['TS', 'Py']) {
  const fams = [...new Set(SNAP.flatMap((s) => [...snaps[s.key].values()].filter((c) => c.lang === lang && c.tier === 'suggestion').map((c) => c.family)))].sort();
  for (const f of fams) {
    const row = {};
    for (const s of SNAP) {
      const x = [...snaps[s.key].values()].filter((c) => c.lang === lang && c.tier === 'suggestion' && c.family === f);
      if (x.length) row[s.key] = [x.filter(isA).length, x.length];
    }
    out.family_history[`${lang}:${f}`] = row;
    log(`${lang} ${f}: ${Object.entries(row).map(([k, [a, n]]) => `${k} ${a}/${n}`).join('  ')}`);
  }
}

// 15. Chased ids: relabel5 cards named by several round 4-9 PRs, by label.
log('\n## 15. How often round 4-9 PRs named each relabel5 card, by label');
out.chased = {};
for (const lang of ['TS', 'Py']) {
  const cs = [...snaps.r5.values()].filter((c) => c.lang === lang);
  const row = {};
  for (const c of cs) {
    const k = touchedBy(c.uid, [4, 5, 6, 8, 9]).length;
    const b = k === 0 ? '0' : k === 1 ? '1' : k <= 3 ? '2-3' : '4+';
    row[b] ??= { ACCEPT: 0, other: 0 };
    row[b][isA(c) ? 'ACCEPT' : 'other'] += 1;
  }
  const still = cs.filter((c) => !isA(c) && touchedBy(c.uid, [5, 6, 8, 9]).length >= 2).map((c) => `${c.uid}(${touchedBy(c.uid, [5, 6, 8, 9]).map((p) => p.pr).join(',')})`);
  out.chased[lang] = { by_times_named: row, nonaccept_named_by_2plus_r5to9: still };
  log(`${lang}: ${Object.entries(row).sort().map(([b, v]) => `named ${b}x: ${v.ACCEPT} A / ${v.other} non-A`).join('; ')}`);
  log(`   non-ACCEPT named by >=2 round 5-9 PRs (${still.length}): ${still.join(' ')}`);
}

// 16. Policies of the plan's mechanisms M1, I1, I2 (per language), on r5 and v3; naming
//     by role shape; accept by repo-base lift for the incidental-prone families.
log('\n## 16. Plan mechanisms on relabel5 and dev-v3; TS naming by role shape; lift bands');
const plainFnNaming = (c) => c.family === 'naming' && c.tier === 'suggestion' && c.roleFile === '*' && c.roleEntry === '-' && c.roleKind === 'function';
for (const s of ['r5', 'v3']) {
  const q = new Map();
  for (const p of ['ts', 'py', 'py2']) {
    const run = SNAP.find((x) => x.key === s).run;
    for (const it of JSON.parse(fs.readFileSync(path.join(runs, run, p, 'views/d7/queue.json'), 'utf8')).items) q.set(it.uid, it.role);
  }
  for (const c of snaps[s].values()) { const r = q.get(c.uid); c.roleFile = r?.file ?? '*'; c.roleEntry = r?.entry; c.roleKind = r?.kind; }
}
out.mechanisms = {};
const hideI = { TS: ['ordering', 'renders', 'calls'], Py: ['ordering', 'repo'] };
for (const s of ['r5', 'v3']) for (const lang of ['TS', 'Py']) {
  const cs = [...snaps[s].values()].filter((c) => c.lang === lang);
  const sugg = (c) => c.tier === 'suggestion';
  const pol = {
    'M1 (no TS naming on plain-function roles)': (c) => !(lang === 'TS' && plainFnNaming(c)),
    'I1 (no ordering)': (c) => !(sugg(c) && c.family === 'ordering'),
    [`I1+I2 (hide ${hideI[lang].join(', ')})`]: (c) => !(sugg(c) && hideI[lang].includes(c.family)),
    'M1+I1+I2': (c) => !(lang === 'TS' && plainFnNaming(c)) && !(sugg(c) && hideI[lang].includes(c.family)),
  };
  for (const [n, f] of Object.entries(pol)) {
    const x = cs.filter(f);
    out.mechanisms[`${s}:${lang}:${n}`] = [x.filter(isA).length, x.length];
    log(`${s} ${lang} ${n}: ${pct(x.filter(isA).length, x.length)} (all shown ${pct(cs.filter(isA).length, cs.length)})`);
  }
}
for (const s of ['v3', 'r5']) {
  const nm = [...snaps[s].values()].filter((c) => c.lang === 'TS' && c.tier === 'suggestion' && c.family === 'naming');
  const g = {};
  for (const c of nm) { const k = `file ${c.roleFile === '*' ? 'any' : 'kind'}, entry ${c.roleEntry ?? '?'}, ${c.roleKind ?? '?'}`; g[k] ??= [0, 0]; g[k][1] += 1; if (isA(c)) g[k][0] += 1; }
  log(`${s} TS naming by role shape: ${Object.entries(g).map(([k, [a, n]]) => `${k} ${a}/${n}`).join('; ')}`);
  log(`   plain-function naming cards: ${nm.filter(plainFnNaming).map((c) => `${c.uid} ${c.label}/${c.why}`).join('; ')}`);
}
for (const s of ['v3', 'r5']) {
  const cs = [...snaps[s].values()].filter((c) => c.tier === 'suggestion');
  const inc = ['calls', 'renders', 'ordering', 'repo', 'argument_key'];
  const band = (lo, hi, f) => { const x = cs.filter((c) => f(c) && c.lift >= lo && c.lift < hi); return pct(x.filter(isA).length, x.length); };
  log(`${s} lift bands, calls/renders/ordering/repo/argument_key vs other families: ${[[0, 2], [2, 4], [4, 8], [8, 1e9]].map(([lo, hi]) => `[${lo},${hi === 1e9 ? 'inf' : hi}) ${band(lo, hi, (c) => inc.includes(c.family))} vs ${band(lo, hi, (c) => !inc.includes(c.family))}`).join('; ')}`);
}
if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1) + '\n');
