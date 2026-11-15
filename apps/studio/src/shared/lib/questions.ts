// Block candidates' one question, where the view or the fixture API needs it (crates/drift-mine/src/calibrate.rs;
// entities/convention/calibration.ts re-exports these). The questions themselves always come from
// `drift review --json`, in the desktop app and in fixture mode (fixtures/<repo>/review-questions.json).
import type { QuestionFile, ReviewQuestion } from "@/shared/contract/drift";

/** The question, as Drift asks it (`calibrate::QUESTION`). */
export const QUESTION = "Are these the same kind of thing?";

/** Rule kinds Drift counts as auth or validation (`calibrate::auth_or_validation`): by kind, every wrapper included. */
export function authOrValidationKind(ruleKind: string | null | undefined): boolean {
  if (!ruleKind) return true; // unknown: as one [STRICT]
  return ruleKind.startsWith("wrapped_by:") || ["calls", "passes_key", "control", "before"].includes(ruleKind);
}

/** What an answer of "different" sends: the files picked, the entry points ticked in them, and those left flagged. */
export interface AnswerPlan {
  /** Picked files that cover a flagged member: what Drift writes to `different_kind` (calibrate.rs `different`). */
  setApart: string[];
  confirmEntry: string[];
  /** Entry points (`path#symbol`) in a picked file without their tick: they stay flagged. */
  kept: string[];
  /** Flagged members the files cover. */
  covered: number;
}

/**
 * The plan for picked files and ticked entry points, as `calibrate::different` makes it: [STRICT] a picked file whose
 * flags all stay flagged is not written (an exemption that covers nothing now would only cover members added later).
 */
export function answerPlan(q: Pick<ReviewQuestion, "flagged">, picked: ReadonlySet<string>, ticked: ReadonlySet<string>): AnswerPlan {
  const plan: AnswerPlan = { setApart: [], confirmEntry: [], kept: [], covered: 0 };
  for (const f of q.flagged) {
    if (!picked.has(f.path)) continue;
    let covers = false;
    for (const m of f.members) {
      const key = `${f.path}#${m.symbol}`;
      if (!m.needs_confirmation) {
        covers = true;
        plan.covered++;
      } else if (ticked.has(key)) {
        covers = true;
        plan.covered++;
        plan.confirmEntry.push(key);
      } else plan.kept.push(key);
    }
    if (covers) plan.setApart.push(f.path);
  }
  return plan;
}

/** Entry points of a file that need their own tick. */
export function needsTick(f: QuestionFile): string[] {
  return f.members.filter((m) => m.needs_confirmation).map((m) => `${f.path}#${m.symbol}`);
}
