// The order and default cap of suggestions in the review list (round 8, W4), as `drift review` and
// `drift census` list them (crates/drift-mine/src/rank.rs). No ranking of its own: suggestions are
// ordered by census `rank`, which Drift computes; the Studio only applies the cap census reports.
import type { ConventionRow } from "./conventions";

const STATUS_GROUP: Record<ConventionRow["status"], number> = { accepted: 0, proposed: 1, not_in_policy: 1, rejected: 2 };
const tierGroup = (t: ConventionRow["tier"]) => (t === "default" ? 0 : t === "suggestion" ? 1 : 2);

/** Still to decide: what the cap applies to (decided conventions are always listed). */
export const undecided = (r: ConventionRow) => r.status === "proposed" || r.status === "not_in_policy";

/**
 * Rows as the review list shows them: by status (accepted, to review, rejected), the default tier first in
 * the order given, then suggestions by census `rank` (best first; a row census did not rank keeps its place
 * after them), then rows of unknown tier.
 */
export function reviewOrder(rows: ConventionRow[]): ConventionRow[] {
  const rank = (r: ConventionRow) => (r.tier === "suggestion" ? (r.rank ?? Number.POSITIVE_INFINITY) : 0);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => STATUS_GROUP[a.r.status] - STATUS_GROUP[b.r.status] || tierGroup(a.r.tier) - tierGroup(b.r.tier) || rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The cap census reports (`suggestion_cap.cap`, from `.drift/conventions.yaml` or the default 5) applied to
 * the suggestions still to decide, in the order given: `hidden` are past it. Default-tier and decided rows
 * are never hidden. `cap` null or undefined (all, or a census from before the cap) hides nothing.
 */
export function capSuggestions(ordered: ConventionRow[], cap: number | null | undefined): { listed: ConventionRow[]; hidden: ConventionRow[]; suggestions: number } {
  const listed: ConventionRow[] = [];
  const hidden: ConventionRow[] = [];
  let suggestions = 0;
  for (const r of ordered) {
    if (r.tier === "suggestion" && undecided(r)) {
      suggestions++;
      if (cap != null && suggestions > cap) {
        hidden.push(r);
        continue;
      }
    }
    listed.push(r);
  }
  return { listed, hidden, suggestions };
}
