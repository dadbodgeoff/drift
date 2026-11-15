// `drift check --format json`, grouped for display.
import { exemptionKind } from "@/entities/convention";
import type { CheckExemption, CheckReport, NeighbourHold, Violation } from "@/shared/contract/drift";

/**
 * `unsure`: would be new, but its file depends on a file drift could not parse (`unchecked`), so it is not counted as new.
 * `held`: would be new, but the neighbour gate held it back (`suppressed_neighbour`): never new, never fails.
 */
export type ViolationState = "new" | "baselined" | "suppressed" | "held" | "unsure";

export function stateOf(v: Violation): ViolationState {
  if (v.suppressed) return "suppressed";
  if (v.baselined) return "baselined";
  if (v.suppressed_neighbour) return "held";
  if (v.unsure) return "unsure";
  return "new";
}

export interface CheckCounts {
  new: number;
  blocking: number;
  baselined: number;
  suppressed: number;
  /** Held back by the neighbour gate. */
  held: number;
  unsure: number;
  fixed: number;
  /** Files not checked (not parsed for lack of stack). */
  unchecked: number;
}

export function checkCounts(r: CheckReport): CheckCounts {
  const n = { new: 0, blocking: 0, baselined: 0, suppressed: 0, held: 0, unsure: 0, fixed: r.fixed.length, unchecked: r.unchecked?.length ?? 0 };
  for (const v of r.violations) {
    const s = stateOf(v);
    n[s]++;
    if (s === "new" && v.mode === "block") n.blocking++;
  }
  return n;
}

export interface ViolationGroup {
  key: string;
  title: string;
  /** For convention groups: the rule text and evidence. */
  detail?: string;
  mode?: string;
  items: Violation[];
  counts: Record<ViolationState, number>;
}

function group(vs: Violation[], keyOf: (v: Violation) => string, title: (v: Violation) => string, detail?: (v: Violation) => string): ViolationGroup[] {
  const m = new Map<string, ViolationGroup>();
  for (const v of vs) {
    const k = keyOf(v);
    let g = m.get(k);
    if (!g) {
      g = { key: k, title: title(v), detail: detail?.(v), items: [], counts: { new: 0, baselined: 0, suppressed: 0, held: 0, unsure: 0 } };
      m.set(k, g);
    }
    g.items.push(v);
    g.counts[stateOf(v)]++;
    if (v.mode === "block") g.mode = "block";
    else g.mode ??= v.mode;
  }
  // New violations first, then size, then key (stable).
  return [...m.values()].sort(
    (a, b) => b.counts.new - a.counts.new || b.items.length - a.items.length || a.key.localeCompare(b.key),
  );
}

export function byConvention(vs: Violation[]): ViolationGroup[] {
  return group(
    vs,
    (v) => v.id,
    (v) => v.id,
    (v) => `${v.summary} (${v.evidence})`,
  );
}

export function byFile(vs: Violation[]): ViolationGroup[] {
  return group(
    vs,
    (v) => v.path,
    (v) => v.path,
  );
}

export function filterViolations(vs: Violation[], states: Set<ViolationState>, q: string): Violation[] {
  const needle = q.trim().toLowerCase();
  return vs.filter(
    (v) =>
      states.has(stateOf(v)) &&
      (!needle ||
        v.path.toLowerCase().includes(needle) ||
        v.id.toLowerCase().includes(needle) ||
        v.symbol.toLowerCase().includes(needle) ||
        v.summary.toLowerCase().includes(needle)),
  );
}

/**
 * Members `drift check` did not check because their convention is not about them (#45),
 * sorted by convention, path and symbol. Older drift omits the field; malformed entries
 * are dropped (the main process validates only the report's top level).
 */
export function exemptions(r: CheckReport): CheckExemption[] {
  const raw: unknown = (r as { exempt?: unknown }).exempt;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is CheckExemption =>
        !!e && typeof e === "object" && typeof e.id === "string" && typeof e.path === "string" && typeof e.symbol === "string" && typeof e.line === "number" && typeof e.reason === "string",
    )
    // `code` is optional (newer drift); a malformed one is dropped, not the member.
    .map((e) => (e.code === undefined || typeof e.code === "string" ? e : { id: e.id, path: e.path, symbol: e.symbol, line: e.line, reason: e.reason }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path) || a.symbol.localeCompare(b.symbol) || a.line - b.line);
}

/**
 * Warnings the neighbour gate held back (WS-J), sorted by convention, path and symbol. Older drift omits the field;
 * malformed entries are dropped.
 */
export function neighbourHolds(r: CheckReport): NeighbourHold[] {
  const raw: unknown = (r as { suppressed_neighbour?: unknown }).suppressed_neighbour;
  if (!Array.isArray(raw)) return [];
  const str = (x: unknown) => typeof x === "string";
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  return raw
    .filter(
      (h): h is NeighbourHold =>
        !!h && typeof h === "object" && str(h.id) && str(h.path) && str(h.symbol) && n(h.line) && str(h.nearest_apart) && str(h.apart_code) && n(h.apart_distance) && str(h.nearest_holder) && n(h.holder_distance),
    )
    .sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path) || a.symbol.localeCompare(b.symbol) || a.line - b.line);
}

/** The hold of `v`, if the neighbour gate held it back. */
export function holdOf(holds: NeighbourHold[], v: Violation): NeighbourHold | null {
  return holds.find((h) => h.id === v.id && h.path === v.path && h.symbol === v.symbol) ?? null;
}

/** Exempt members matching a filter, on the same fields as violations plus the reason and the kind (its code and label). */
export function filterExemptions(es: CheckExemption[], q: string): CheckExemption[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return es;
  return es.filter((e) => [e.path, e.id, e.symbol, e.reason, e.code ?? "", exemptionKind(e.code)?.label ?? ""].some((x) => x.toLowerCase().includes(needle)));
}

/** One status vocabulary for violations, used by every view. */
export type ViolationStatus = "block" | "advise" | "held" | "unsure" | "suppressed" | "baselined" | "fixed";

export const VIOLATION_STATUS: Record<ViolationStatus, { tone: "danger" | "warning" | "info" | "neutral" | "success"; icon: "blocked" | "attention" | "info" | "dot" | "ok"; label: string; hint: string }> = {
  block: { tone: "danger", icon: "blocked", label: "new · blocks", hint: "fails drift check and stops agents at the end of a turn" },
  advise: { tone: "warning", icon: "attention", label: "new · advises", hint: "reported to agents and in CI; never fails" },
  held: { tone: "info", icon: "info", label: "held back", hint: "nearer the members its convention sets apart than its holders (neighbour gate); listed, never fails" },
  unsure: { tone: "info", icon: "info", label: "unsure", hint: "depends on a file drift could not parse on that run; never fails until it can" },
  suppressed: { tone: "info", icon: "info", label: "suppressed", hint: "drift-ignore with a reason, listed for reviewers" },
  baselined: { tone: "neutral", icon: "dot", label: "baselined", hint: "legacy, recorded in drift.lock; never fails" },
  fixed: { tone: "success", icon: "ok", label: "fixed", hint: "lock entries no longer violated; safe to prune" },
};

export function statusOf(v: Violation): Exclude<ViolationStatus, "fixed"> {
  const s = stateOf(v);
  if (s !== "new") return s;
  return v.mode === "block" ? "block" : "advise";
}

/** `87/93` from check's evidence field. */
export function parseEvidence(e: string): { holders: number; total: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(e.trim());
  return m ? { holders: Number(m[1]), total: Number(m[2]) } : null;
}

/** The reason in `// drift-ignore D-xxxxxx: <reason>` directly above a violation's line. */
export function suppressionReason(source: string, line: number, id: string): string | null {
  const lines = source.split("\n");
  for (let i = line - 2; i >= Math.max(0, line - 4); i--) {
    const m = /drift-ignore\s+(D-[0-9a-f]+)\s*:\s*(.*?)\s*(\*\/)?\s*$/.exec(lines[i] ?? "");
    if (m && m[1] === id) return m[2] || null;
  }
  return null;
}

/** `path#symbol` from check's example field. */
export function splitExample(e: string): { path: string; symbol: string } {
  const i = e.lastIndexOf("#");
  return i < 0 ? { path: e, symbol: "" } : { path: e.slice(0, i), symbol: e.slice(i + 1) };
}

/** The diff base in effect for a repository: only the repository it was chosen for uses it; any other starts on the whole repository. */
export function baseFor(scope: { repo: string; base: string } | null, repoPath: string | undefined): string | null {
  return scope && repoPath && scope.repo === repoPath ? scope.base : null;
}

const REF = /^[A-Za-z0-9_][A-Za-z0-9._/+-]*$/;
/** The shape the main process accepts for `--diff-base` (it validates again, strictly). */
export const validRef = (r: string) => r.length > 0 && r.length <= 200 && REF.test(r) && !r.includes("..") && !r.endsWith(".lock");
