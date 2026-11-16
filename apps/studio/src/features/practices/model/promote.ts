// A practice made a convention (`drift practices promote`, docs/v2/PROMOTE-A-PRACTICE.md §5 item 4), shaped for the
// Practices view's dialog. Pure functions over what Drift printed: the place, the ways, the counts and the exceptions
// all come from `drift practices promote --dry-run --json`; nothing here decides whether a practice qualifies.
import type { PracticeExample, PracticeVariant, PromoteResult, PromoteWay } from "@/shared/contract/drift";
import type { PromoteRequest } from "@/shared/api";

/** How many exceptions the dialog lists before "and N more". */
export const EXCEPTIONS_SHOWN = 5;

/**
 * The place a variant may be made a convention in, as Drift names it (`promotable.place`: `apps/api`, `.` the root
 * package); null when Drift says it cannot be (`promotable` null) or names no place (an older Drift).
 */
export function promotablePlace(v: Pick<PracticeVariant, "promotable" | "kind">): string | null {
  if (v.kind !== "known" || !v.promotable) return null;
  return v.promotable.place ?? null;
}

/** The request the dialog sends: the variant, its place, the other ways ticked (once each, in the order ticked) and block mode. */
export function promoteRequest(id: string, place: string, withIds: readonly string[], block: boolean): PromoteRequest {
  return { id, place, with: [...new Set(withIds)].filter((w) => w !== id), block };
}

/** Tick or untick another way (`--with`): ticked ways keep the order they were ticked in. */
export function toggleWay(withIds: readonly string[], id: string, on: boolean): string[] {
  const rest = withIds.filter((w) => w !== id);
  return on ? [...rest, id] : rest;
}

/**
 * The other ways a person may accept too, one checkbox each: the ways already added (`ways` after the first) and the
 * ones Drift lists as present and not added (`other_ways`), by members then id, so a box does not move when ticked.
 */
export function wayChoices(res: PromoteResult): PromoteWay[] {
  return [...res.candidate.ways.slice(1), ...res.candidate.other_ways].sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The exceptions Drift records as they are, the first few listed and the rest counted. */
export function exceptionsShown(res: PromoteResult, n = EXCEPTIONS_SHOWN): { shown: PracticeExample[]; more: number } {
  const all = res.candidate.exceptions;
  return { shown: all.slice(0, n), more: Math.max(0, all.length - n) };
}

/** A unit as the command line names one: `app/api/r38/route.ts:1 GET`. */
export function unitAt(e: PracticeExample): string {
  return `${e.path}:${e.line} ${e.symbol}`;
}

/** `entry_point`, 2 -> `entry points`. */
export function unitsWord(unit: string, n: number): string {
  const w = unit.replace(/_/g, " ");
  return n === 1 ? w : w.endsWith("s") ? w : `${w}s`;
}

/** "38 of the 40 entry points in app/api use the accepted ways": Drift's counts, said plainly. */
export function followsText(res: PromoteResult): string {
  const c = res.candidate;
  const ways = c.ways.length === 1 ? (c.ways[0]?.label ?? "the accepted way") : `one of the ${c.ways.length} accepted ways`;
  return `${c.follows} of the ${c.total} ${unitsWord(c.unit, c.total)} in ${res.place} use ${ways}.`;
}

/** What the replay found, for block mode: "Of the 15 entry points most recently added here, 14 follow it as they stand." Null when none ran. */
export function replayText(res: PromoteResult): string | null {
  const r = res.replay;
  if (!r) return null;
  return `Of the ${r.recent} ${unitsWord(res.candidate.unit, r.recent)} most recently added here, ${r.followed} follow it as they stand.`;
}
