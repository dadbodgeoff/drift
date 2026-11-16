// The practices that may be promoted now (`drift practices promote --list --json`), in words. Pure functions over what
// Drift printed: which candidates there are, their counts and their order are Drift's; nothing here decides whether
// a practice qualifies. Units Drift could not read are "not checked", never departures.
import type { PracticeUnknownReason, PromoteCandidate, PromoteList, PromoteListItem, PromoteRefused, PromoteUnknownCause } from "@/shared/contract/drift";
import { readUnknownCause } from "@/shared/contract/read";
import { mechanismWords } from "@/entities/convention";
import { type MessageKey, t } from "@/shared/i18n";
import { unitsWord } from "./promote";

/** What a candidate accepts: named ways (0), a mechanism whole (1), any way that enforces the concern (2), as Drift's `breadth`. */
export type CandidateKind = "ways" | "mechanism" | "enforcing";

export function candidateKind(c: Pick<PromoteCandidate, "mechanisms" | "any_enforcing">): CandidateKind {
  if (c.any_enforcing) return "enforcing";
  if (c.mechanisms?.length) return "mechanism";
  return "ways";
}

const KIND_KEY: Record<CandidateKind, MessageKey> = {
  ways: "practices.candidates.kindWays",
  mechanism: "practices.candidates.kindMechanism",
  enforcing: "practices.candidates.kindEnforcing",
};

/** "named ways", "a mechanism whole", "any enforcing way". */
export function kindText(c: Pick<PromoteCandidate, "mechanisms" | "any_enforcing">): string {
  return t(KIND_KEY[candidateKind(c)]);
}

/**
 * What it accepts, in a sentence of its own per kind: "Accepts wrap withAdmin.", "Accepts mechanism wrap whole: any
 * entry point here that does it by wrap follows, whichever instrument it names.", "Accepts any way that enforces it:
 * ...". A candidate Drift built from more than one (a request can mix them) gets each sentence.
 */
export function acceptsText(c: PromoteCandidate): string {
  const unit = unitsWord(c.unit, 1);
  const parts: string[] = [];
  if (c.ways.length) parts.push(t("practices.candidates.acceptsWays", { ways: c.ways.map((w) => w.label).join(" or ") }));
  if (c.mechanisms?.length) parts.push(t("practices.candidates.acceptsMechanism", { mechanisms: c.mechanisms.map(mechanismWords).join(" or "), unit }));
  if (c.any_enforcing) parts.push(t("practices.candidates.acceptsEnforcing", { unit }));
  return parts.join(" ");
}

/** "19 of the 20 entry points in apps/web/app/api/admin follow it." */
export function followsLine(item: Pick<PromoteListItem, "place" | "candidate">): string {
  const c = item.candidate;
  return t("practices.candidates.follows", { follows: c.follows, total: c.total, units: unitsWord(c.unit, c.total), place: item.place });
}

/** The units that do it another way or not at all: recorded as they are, so only new code is reported. */
export function exceptionsLine(c: PromoteCandidate): string {
  const n = c.exceptions.length;
  return n ? t("practices.candidates.exceptions", { n, units: unitsWord(c.unit, n) }) : t("practices.candidates.noExceptions");
}

/** What Drift could not read: "not checked", never a departure. */
export function notCheckedLine(c: Pick<PromoteCandidate, "unit" | "unknown">): string {
  if (c.unknown === 0) return t("practices.candidates.readEvery", { unit: unitsWord(c.unit, 1) });
  if (c.unknown === 1) return t("practices.candidates.notCheckedOne", { unit: unitsWord(c.unit, 1) });
  return t("practices.candidates.notChecked", { n: c.unknown, units: unitsWord(c.unit, c.unknown) });
}

/** Background jobs left out of a concern about the caller; null when there are none (or an older Drift). */
export function jobsLine(c: Pick<PromoteCandidate, "jobs">): string | null {
  const n = c.jobs ?? 0;
  if (n <= 0) return null;
  return n === 1 ? t("practices.candidates.jobsOne") : t("practices.candidates.jobsMany", { n });
}

const REASON_KEY: Partial<Record<PracticeUnknownReason, MessageKey>> = {
  body_unreadable: "practices.reason.body_unreadable",
  opaque_wrapper: "practices.reason.opaque_wrapper",
  unresolved: "practices.reason.unresolved",
  partly_read: "practices.reason.partly_read",
  unparsed: "practices.reason.unparsed",
};

/** The reasons outside a unit, in Drift's words (promote.rs `reason_words`); any other reads as code Drift could not read. */
export function causeReason(reason: string): string {
  const key = REASON_KEY[reason as PracticeUnknownReason];
  return t(key ?? "practices.reason.other");
}

/**
 * The one cause every unit Drift could not read shares, as promote.rs `cause_sentence` says it: what it is, then the
 * `.drift/config.yaml` line that would let Drift read it, or that no line names it.
 */
export function unknownCauseText(cause: PromoteUnknownCause): { what: string; hint: string | null; after: string } {
  return {
    what: t("practices.candidates.cause", { n: cause.units, reason: causeReason(cause.reason), instrument: cause.instrument }),
    hint: cause.hint ?? null,
    after: cause.hint ? t("practices.candidates.causeHint") : t("practices.candidates.causeNoHint"),
  };
}

/** The cause a refusal for units Drift could not read names (`too_unknown` `cause`, newer drift); null otherwise. */
export function refusalCause(r: PromoteRefused["refused"]): PromoteUnknownCause | null {
  return r.code === "too_unknown" && r.cause !== undefined ? readUnknownCause(r.cause) : null;
}

/**
 * The command Drift prints for a candidate, when it promotes it: a candidate of no named way (a mechanism or any
 * enforcing way) gets `drift practices promote  --in <place>` from a Drift whose command takes variant ids only,
 * which promotes nothing, so it is not shown.
 */
export function commandShown(item: Pick<PromoteListItem, "command">): string | null {
  const cmd = item.command.trim();
  if (!cmd || /\bpromote\s+--in\b/.test(cmd)) return null;
  return cmd;
}

/** The candidates of one package (null: every package), in Drift's order. */
export function candidatesIn(list: PromoteList, pkg: string | null): PromoteListItem[] {
  return pkg === null ? list.candidates : list.candidates.filter((x) => x.candidate.place.package === pkg);
}

/**
 * The list as the view shows it: the candidates that hold code to something first, in Drift's order, then those
 * followed by doing nothing (`passive`), apart and never first.
 */
export function splitPassive(items: readonly PromoteListItem[]): { active: PromoteListItem[]; passive: PromoteListItem[] } {
  return { active: items.filter((x) => !x.candidate.passive), passive: items.filter((x) => x.candidate.passive) };
}

/** A stable key for a candidate: its place, concern, kind, ways and mechanisms. */
export function candidateKey(item: PromoteListItem): string {
  const c = item.candidate;
  return [item.place, c.concern, candidateKind(c), c.ways.map((w) => w.id).join(","), (c.mechanisms ?? []).join(",")].join("|");
}
