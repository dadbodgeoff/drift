// What a `drift check` verdict rests on, per accepted mined rule (check.rs `Standing`), in the words `drift check`
// prints under its report (drift-cli main.rs, after the violations). Nothing here changes the exit code: a member Drift
// could not read is neither a violation nor a pass, and a stale rule advises until a person looks.
import type { CheckStanding } from "@/shared/contract/drift";

/** How one rule stands, most telling first: stale, broken, partly unread, held, or with no member. */
export type StandingState = "stale" | "breaks" | "cannot-tell" | "holds" | "empty";

export const STANDING_STATE: Record<StandingState, { tone: "info" | "warning" | "neutral" | "success"; icon: "info" | "attention" | "dot" | "ok"; label: string }> = {
  stale: { tone: "warning", icon: "attention", label: "stale" },
  breaks: { tone: "warning", icon: "attention", label: "some members break it" },
  "cannot-tell": { tone: "info", icon: "info", label: "some members not checked" },
  holds: { tone: "success", icon: "ok", label: "every member follows it" },
  empty: { tone: "neutral", icon: "dot", label: "no member to check" },
};

/** Members that break the rule (a reviewer's exceptions aside): the members neither following it nor unread. */
export const breaks = (s: Pick<CheckStanding, "members" | "holders" | "not_checked">) => Math.max(0, s.members - s.holders - s.not_checked);

export function standingState(s: CheckStanding): StandingState {
  if (s.stale) return "stale";
  if (s.members === 0) return "empty";
  if (breaks(s) > 0) return "breaks";
  if (s.not_checked > 0) return "cannot-tell";
  return "holds";
}

/** Reasons members were not checked, most members first, then by reason (main.rs, as `drift check` lists them). */
export function notCheckedWhy(s: Pick<CheckStanding, "not_checked_why">): { reason: string; n: number }[] {
  return Object.entries(s.not_checked_why ?? {})
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

/** What `drift check` says of members it could not read (main.rs). */
export const notCheckedText = (s: Pick<CheckStanding, "not_checked" | "members" | "holders">) =>
  `${s.not_checked} of ${s.members} member(s) not checked: Drift could not read what decides the rule for them, and never reports what it cannot read (${s.holders} follow it)`;

/** What `drift check` says of a stale rule, and the two reviews that settle it (main.rs). */
export const staleText = (s: Pick<CheckStanding, "id" | "stale">) =>
  `mined rule is stale: ${s.stale}, so its violations in drift.lock advise until a person looks (a violation not in drift.lock is checked as before)`;

/** Each rule's standing in id order (as Drift lists them); a copy, so the report is not reordered in place. */
export const standingsById = (rows: readonly CheckStanding[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Counts across the rules, for the section's heading. */
export function standingCounts(rows: readonly CheckStanding[]): Record<StandingState, number> {
  const c: Record<StandingState, number> = { stale: 0, breaks: 0, "cannot-tell": 0, holds: 0, empty: 0 };
  for (const s of rows) c[standingState(s)] += 1;
  return c;
}
