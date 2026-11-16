// A practice made a convention (`drift practices promote`, docs/v2/PROMOTE-A-PRACTICE.md §5 item 4), shaped for the
// Practices view's dialog. Pure functions over what Drift printed: the place, the ways, the counts and the exceptions
// all come from `drift practices promote --dry-run --json`; nothing here decides whether a practice qualifies.
import type { PracticeConcern, PracticeExample, PracticeVariant, PromoteListItem, PromoteOutcome, PromoteRefused, PromoteResult, PromoteWay } from "@/shared/contract/drift";
import type { PromoteRequest } from "@/shared/api";
import { BLOCK_FORCED, type CliRefusal, type PlaceChoice, type PlaceKind, cannotBlock, cliRefusal, placeArg, placeChoiceFromArg, placeChoiceOf, placeProblem } from "@/shared/lib/promote";

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
  return res.replay ? replaySentence(res.replay, res.candidate.unit) : null;
}

/** A replay in words (`promote::Replay::sentence`): by line for a file place, whose units share the file's first commit. */
export function replaySentence(r: NonNullable<PromoteResult["replay"]>, unit: string): string {
  return `Of the ${r.recent} ${unitsWord(unit, r.recent)} most recently ${r.by_line ? "added or changed" : "added"} here, ${r.followed} follow it as they stand.`;
}

// ---------- every form of the command (the dialog's choices) ----------

/**
 * What a person chose in the dialog, every form `drift practices promote` has: the ways accepted (the first is the
 * variant the convention is promoted from; none means `--concern`), mechanisms accepted whole, any enforcing way, the
 * place (a directory, one file, a route prefix), block mode, and a promotion below the share (`--force`). The ways,
 * mechanisms and any enforcing way add up: a unit that does any of them follows.
 */
export interface PromoteChoice {
  concern: string;
  ways: string[];
  mechanisms: string[];
  anyEnforcing: boolean;
  place: PlaceChoice;
  block: boolean;
  force: boolean;
}

/** The dialog opened on a variant: that way, in the place Drift names for it (or the root package). */
export function choiceFromVariant(c: Pick<PracticeConcern, "id">, v: Pick<PracticeVariant, "id">, place: string): PromoteChoice {
  return { concern: c.id, ways: [v.id], mechanisms: [], anyEnforcing: false, place: placeChoiceFromArg(place), block: false, force: false };
}

/** The dialog opened on a candidate Drift listed: its form and its place, exactly as its command names them. */
export function choiceFromCandidate(item: Pick<PromoteListItem, "candidate">): PromoteChoice {
  const c = item.candidate;
  return { concern: c.concern, ways: c.ways.map((w) => w.id), mechanisms: [...(c.mechanisms ?? [])], anyEnforcing: !!c.any_enforcing, place: placeChoiceOf(c.place), block: false, force: false };
}

/** The request the dialog sends for a choice; null while its place cannot be passed to `--in` ([`placeProblem`]). */
export function requestOf(ch: PromoteChoice): PromoteRequest | null {
  if (placeProblem(ch.place)) return null;
  const [id, ...rest] = [...new Set(ch.ways)];
  return {
    ...(id ? { id } : {}),
    concern: ch.concern,
    place: placeArg(ch.place),
    with: rest,
    mechanisms: [...new Set(ch.mechanisms)].sort(),
    any_enforcing: ch.anyEnforcing,
    block: ch.block,
    force: ch.force,
  };
}

/** Tick or untick a mechanism accepted whole: kept sorted, as Drift writes them. */
export function toggleMechanism(ms: readonly string[], m: string, on: boolean): string[] {
  const rest = ms.filter((x) => x !== m);
  return on ? [...rest, m].sort() : rest;
}

/**
 * The mechanisms a person may accept whole for a concern: the ones its known ways use, as the map names them
 * (`variants[].mechanisms`), with any the choice already holds; sorted. Drift refuses one no unit uses
 * (`not_a_mechanism`), with the mechanisms it read.
 */
export function mechanismOptions(c: Pick<PracticeConcern, "variants"> | null, chosen: readonly string[]): string[] {
  const read = (c?.variants ?? []).filter((v) => v.kind === "known").flatMap((v) => v.mechanisms ?? []);
  return [...new Set([...read, ...chosen])].sort();
}

/**
 * The ways a person may accept, one checkbox each: those Drift counted in the place (the last answer's `ways` and
 * `other_ways`, by members then id, so a box does not move when ticked), else the concern's known ways, with any the
 * choice holds that neither lists; with their labels and members (null: not counted here).
 */
export function wayOptions(res: PromoteResult | null, c: Pick<PracticeConcern, "variants"> | null, chosen: readonly string[], labels: Readonly<Record<string, string>> = {}): { id: string; label: string; members: number | null }[] {
  const counted = res ? [...res.candidate.ways, ...res.candidate.other_ways].sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : [];
  const out = counted.map((w) => ({ id: w.id, label: w.label, members: w.members as number | null }));
  if (!res) for (const v of (c?.variants ?? []).filter((x) => x.kind === "known")) out.push({ id: v.id, label: v.label, members: null });
  for (const id of chosen) if (!out.some((w) => w.id === id)) out.push({ id, label: labels[id] ?? c?.variants.find((v) => v.id === id)?.label ?? id, members: null });
  return out.filter((w, i, xs) => xs.findIndex((y) => y.id === w.id) === i);
}

/** Why Drift refuses a choice before it reads anything (the CLI's own code and sentence), or null. */
export function choiceRefusal(ch: PromoteChoice): CliRefusal | null {
  const req = requestOf(ch);
  return req ? cliRefusal(req) : null;
}

/**
 * Whether block mode can be chosen, and if not, why in the CLI's words: never with `--force` (the command line
 * refuses the pair), never where the place holds fewer units Drift can read than the replay reads (the preview's
 * sentence). Otherwise it can be asked, and the replay Drift runs answers.
 */
export function blockOffer(ch: PromoteChoice, last: PromoteResult | null): { can: boolean; why: string | null } {
  if (ch.force) return { can: false, why: BLOCK_FORCED };
  const why = last ? cannotBlock(last.candidate) : null;
  return why ? { can: false, why: `${why}.` } : { can: true, why: null };
}

/**
 * What `--force` would override, from Drift's refusal: the place's share below the 80% a practice needs (`below_share`,
 * the only refusal `--force` lifts). Null for any other answer: Drift cannot be forced to hold code to what it cannot
 * read (`too_unknown`) or to a place too small.
 */
export function forceOffer(o: PromoteOutcome | null): { place: string; follows: number; read: number } | null {
  if (!o || !("refused" in o) || o.refused.code !== "below_share" || !("follows" in o.refused)) return null;
  const r = o.refused as { place: string; follows: number; read: number };
  return { place: r.place, follows: r.follows, read: r.read };
}

/** What `--force` overrides, said before a person ticks it. */
export function forceText(f: { place: string; follows: number; read: number }, unit: string): string {
  const pct = f.read ? Math.round((100 * f.follows) / f.read) : 0;
  return `In ${f.place}, ${f.follows} of the ${f.read} ${unitsWord(unit, f.read)} Drift could read do it the accepted ways (${pct}%), below the 80% a practice needs. Promoting on your word overrides that: it advises only, and never blocks.`;
}

/** Each practice of another form this promotion replaces, as Drift says it (promote.rs `Replaced::sentence`). */
export function replacesText(res: PromoteResult): string[] {
  const verb = res.written ? "Replaces" : "Would replace";
  return (res.replaces ?? []).map((r) => {
    const n = r.narrowed.length;
    const named = r.narrowed.slice(0, 3).join(", ") + (n > 3 ? `, and ${n - 3} more` : "");
    const units = n === 0 ? "No unit that follows it breaks this one." : `${n} ${n === 1 ? "unit that follows it does" : "units that follow it do"} not follow this one, and ${n === 1 ? "is" : "are"} recorded in drift.lock as ${n === 1 ? "it is" : "they are"} (${named}): this rule is narrower there.`;
    return `${verb} ${r.id} (${r.summary}), the practice of another form in the same place: two in one place would report the same units. ${units}`;
  });
}

/** The replay of a block refusal (`block_refused`), when one ran. */
export function refusedReplay(o: PromoteRefused): NonNullable<PromoteResult["replay"]> | null {
  const r = o.refused as { code: string; replay?: unknown };
  if (r.code !== "block_refused" || !r.replay || typeof r.replay !== "object") return null;
  const x = r.replay as { recent?: unknown; followed?: unknown };
  return typeof x.recent === "number" && typeof x.followed === "number" ? (r.replay as NonNullable<PromoteResult["replay"]>) : null;
}

/** The place as a person switches its kind: a directory keeps its path (a file its directory), a file starts from the first file listed, a route place from the first package. */
export function switchPlaceKind(p: PlaceChoice, kind: PlaceKind, hints: { files: readonly string[]; packages: readonly string[] }): PlaceChoice {
  if (kind === p.kind) return p;
  if (kind === "route") return { kind, path: p.kind === "dir" && hints.packages.includes(p.path) ? p.path : (hints.packages[0] ?? "."), prefix: p.prefix ?? "/api" };
  if (kind === "file") return { kind, path: hints.files.find((f) => p.path === "." || f.startsWith(`${p.path}/`)) ?? hints.files[0] ?? "" };
  if (p.kind === "file") return { kind, path: p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/")) : "." };
  return { kind, path: p.path };
}
