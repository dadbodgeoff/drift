// The one question a block candidate asks (round 11, WS-K; crates/drift-mine/src/calibrate.rs): "Are these the same
// kind of thing?", with the convention, two or three holders and the members it would flag, by file. Yes accepts the
// card; "No, these are different" sets the picked files apart (a path list `drift check` applies) and accepts it;
// "Not a convention" rejects it. [STRICT] Unanswered, the card stays a candidate; an entry point under an auth or
// validation rule is set apart only with its own, separate tick.
export { QUESTION, type AnswerPlan, answerPlan, authOrValidationKind, needsTick } from "@/shared/lib/questions";

/** The answers the opt-in review log holds (`drift review --export-log`), as eval/study/maintainer-log.mjs `calibration` counts them. */
export interface LogCalibration {
  /** Cards whose last accept or reject was an answer to the question. */
  answered: number;
  byAnswer: { same: number; different: number; "not-a-convention": number };
  /** Flags shown on the cards answered same or different. */
  flagsJudged: number;
  /** Of those, set apart as a different kind. */
  setApart: number;
  /** Entry points picked but not confirmed: they stay flagged. */
  keptFlagged: number;
  /** The rest: kept as the same kind (the flag precision maintainers judge). */
  sameKind: number;
}

const ANSWERS = ["same", "different", "not-a-convention"] as const;
const LOG_ACCEPTS = new Set(["accept", "block", "force_block", "advise", "show_to_agents"]);

/**
 * The block candidates' answers in a review-log export (schema `drift-review-log`), the last decision per card counting:
 * an accept or reject with a `question` record is an answer, one without clears it (maintainer-log.mjs `cards`).
 * Null for anything that is not an export.
 */
export function logCalibration(exported: unknown): LogCalibration | null {
  const x = exported as { schema?: unknown; events?: unknown } | null;
  if (!x || x.schema !== "drift-review-log" || !Array.isArray(x.events)) return null;
  const events = (x.events as Record<string, unknown>[])
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e && typeof e === "object" && typeof e.id === "string")
    // In time order; events of one second keep the order they were logged in.
    .sort((a, b) => (String(a.e.ts) < String(b.e.ts) ? -1 : String(a.e.ts) > String(b.e.ts) ? 1 : a.i - b.i));
  const last = new Map<string, Record<string, unknown> | null>();
  for (const { e } of events) {
    const decided = LOG_ACCEPTS.has(String(e.decision)) || e.decision === "reject";
    if (!decided) continue;
    const q = e.question as Record<string, unknown> | undefined;
    last.set(e.id as string, q && typeof q === "object" && ANSWERS.includes(q.answer as (typeof ANSWERS)[number]) ? q : null);
  }
  const answered = [...last.values()].filter((q): q is Record<string, unknown> => q !== null);
  const n = (q: Record<string, unknown>, k: string) => (Number.isInteger(q[k]) && (q[k] as number) >= 0 ? (q[k] as number) : 0);
  const judged = answered.filter((q) => q.answer !== "not-a-convention");
  const flagsJudged = judged.reduce((t, q) => t + n(q, "flagged"), 0);
  const setApart = judged.reduce((t, q) => t + n(q, "set_apart"), 0);
  const keptFlagged = judged.reduce((t, q) => t + n(q, "kept_flagged"), 0);
  const byAnswer = { same: 0, different: 0, "not-a-convention": 0 };
  for (const q of answered) byAnswer[q.answer as keyof typeof byAnswer]++;
  return { answered: answered.length, byAnswer, flagsJudged, setApart, keptFlagged, sameKind: Math.max(0, flagsJudged - setApart - keptFlagged) };
}
