// Study data (eval/study, eval/agent-ab): labels joined with census proposals,
// and the agent A/B results arm by arm.
import type { AbRow, Census } from "@/shared/contract/drift";

export type { AbRow };
import { type RuleFamily, ruleFamily } from "@/entities/convention";

export type Label = "ACCEPT" | "TRIVIAL" | "WRONG";
export interface LabelRow {
  repo: string;
  id: string;
  label: Label;
  clear?: boolean;
  reason?: string;
  /** Set on relabelling rounds appended later (`2026-11-05 double-label`); absent in the first round. */
  round?: string;
}

export function parseLabels(text: string): { rows: LabelRow[]; malformed: number } {
  const rows: LabelRow[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.repo === "string" && typeof o.id === "string" && ["ACCEPT", "TRIVIAL", "WRONG"].includes(o.label))
        rows.push({ repo: o.repo, id: o.id, label: o.label, clear: o.clear, reason: typeof o.reason === "string" ? o.reason : undefined, round: typeof o.round === "string" ? o.round : undefined });
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { rows, malformed };
}

/** The first labelling round: rows without a `round`. Later rounds relabel a subset and must not be mixed in. */
export function firstRound(rows: LabelRow[]): LabelRow[] {
  return rows.filter((r) => !r.round);
}

/** Later labels for the same proposal supersede earlier ones within a round (corrections append). */
export function latestLabels(rows: LabelRow[]): Map<string, LabelRow> {
  const m = new Map<string, LabelRow>();
  for (const r of rows) m.set(`${r.repo}\u0000${r.id}`, r);
  return m;
}

export interface Tally {
  n: number;
  accept: number;
  trivial: number;
  wrong: number;
  unlabeled: number;
}

const empty = (): Tally => ({ n: 0, accept: 0, trivial: 0, wrong: 0, unlabeled: 0 });

function count(t: Tally, l: Label | undefined) {
  t.n++;
  if (l === "ACCEPT") t.accept++;
  else if (l === "TRIVIAL") t.trivial++;
  else if (l === "WRONG") t.wrong++;
  else t.unlabeled++;
}

/** Share accepted among labelled proposals. */
export function acceptRate(t: Tally): number | null {
  const labelled = t.n - t.unlabeled;
  return labelled ? t.accept / labelled : null;
}

export interface Precision {
  overall: Tally;
  byFamily: ({ family: RuleFamily } & Tally)[];
  byRepo: ({ repo: string } & Tally)[];
  /** Labels whose proposal is not in the current census (older engine, re-mined away). */
  staleLabels: number;
  proposals: { repo: string; id: string; summary: string; family: RuleFamily; label: Label | null; reason: string | null }[];
}

export function precision(labels: LabelRow[], census: Record<string, Census>): Precision {
  const latest = latestLabels(labels);
  const fam = new Map<RuleFamily, Tally>();
  const repo = new Map<string, Tally>();
  const overall = empty();
  const used = new Set<string>();
  const proposals: Precision["proposals"] = [];
  for (const [name, c] of Object.entries(census).sort(([a], [b]) => a.localeCompare(b))) {
    const r = repo.get(name) ?? empty();
    repo.set(name, r);
    for (const p of c.proposals) {
      const k = `${name}\u0000${p.id}`;
      const l = latest.get(k);
      if (l) used.add(k);
      const f = ruleFamily(p.rule);
      const ft = fam.get(f) ?? empty();
      fam.set(f, ft);
      count(ft, l?.label);
      count(r, l?.label);
      count(overall, l?.label);
      proposals.push({ repo: name, id: p.id, summary: p.summary, family: f, label: l?.label ?? null, reason: l?.reason ?? null });
    }
  }
  return {
    overall,
    byFamily: [...fam].map(([family, t]) => ({ family, ...t })).sort((a, b) => b.n - a.n || a.family.localeCompare(b.family)),
    byRepo: [...repo].map(([repo, t]) => ({ repo, ...t })).sort((a, b) => b.n - a.n || a.repo.localeCompare(b.repo)),
    staleLabels: [...latest.keys()].filter((k) => !used.has(k)).length,
    proposals,
  };
}

/** Exact agreement and Cohen's kappa between two labellings of the same proposals. */
export function agreement(a: LabelRow[], b: LabelRow[]): { n: number; exact: number; kappa: number | null } {
  const la = latestLabels(a);
  const pairs: [Label, Label][] = [];
  for (const [k, r] of latestLabels(b)) {
    const x = la.get(k);
    if (x) pairs.push([x.label, r.label]);
  }
  const n = pairs.length;
  if (!n) return { n: 0, exact: 0, kappa: null };
  const cats: Label[] = ["ACCEPT", "TRIVIAL", "WRONG"];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([x]) => x === c).length / n) * (pairs.filter(([, y]) => y === c).length / n), 0);
  return { n, exact: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

// ---------- agent A/B (eval/agent-ab/results-*.json, written by score.mjs) ----------


export interface AbArm {
  runs: number;
  accept: number;
  trivial: number;
  wrong: number;
  suppressions: number;
  turns: number;
  cost: number;
  seconds: number;
  errors: number;
}

export interface AbModel {
  model: string;
  arms: Record<string, AbArm>;
  tasks: { task: string; arms: Record<string, AbRow | undefined> }[];
}

export function abByModel(sets: { name: string; rows: AbRow[] }[]): AbModel[] {
  const out: AbModel[] = [];
  for (const s of sets) {
    const models = new Map<string, AbRow[]>();
    for (const r of s.rows) {
      const m = r.model || s.name;
      models.set(m, [...(models.get(m) ?? []), r]);
    }
    for (const [model, rows] of models) {
      const arms: Record<string, AbArm> = {};
      const tasks = new Map<string, Record<string, AbRow>>();
      for (const r of rows) {
        const a = (arms[r.arm] ??= { runs: 0, accept: 0, trivial: 0, wrong: 0, suppressions: 0, turns: 0, cost: 0, seconds: 0, errors: 0 });
        a.runs++;
        a.accept += r.violations_accept ?? 0;
        a.trivial += r.violations_trivial ?? 0;
        a.wrong += r.violations_wrong ?? 0;
        a.suppressions += r.suppressions_added ?? 0;
        a.turns += r.turns ?? 0;
        a.cost += r.cost_usd ?? 0;
        a.seconds += r.seconds ?? 0;
        if (r.is_error) a.errors++;
        const t = tasks.get(r.task) ?? {};
        t[r.arm] = r;
        tasks.set(r.task, t);
      }
      out.push({ model, arms, tasks: [...tasks].sort(([a], [b]) => a.localeCompare(b)).map(([task, arms]) => ({ task, arms })) });
    }
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

/** `claude-haiku-5-5` -> `Haiku 5.5`. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}
