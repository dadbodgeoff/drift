// Validation and argv for the Upgrade and Feedback channels (ops.ts builds the rest). Pure functions, unit-tested in
// tests/unit/screens.test.ts. Every value is checked here again, whatever the channel schema let through.
import { InvalidArgument, assertBool, assertConventionIds, assertMember } from "./ops";

/** A person's verdict on a report: `drift feedback mark --true` or `--wrong`. */
export type Verdict = "true" | "wrong";

export function assertVerdict(v: unknown): Verdict {
  if (v === "true" || v === "wrong") return v;
  throw new InvalidArgument("verdict must be true or wrong");
}

/** The longest `--why` Drift keeps (feedback.rs `MAX_WHY`). */
export const MAX_WHY = 300;

/** A control character other than whitespace, which Drift refuses in a reason (feedback.rs `why_text`). */
const control = (s: string) => [...s].some((c) => /\p{Cc}/u.test(c) && !/\s/u.test(c));

/** A mark's reason as Drift keeps it: whitespace collapsed, 1 to 300 characters, no control characters. */
export function assertWhy(w: unknown): string {
  if (typeof w !== "string" || w.length > 4000 || control(w)) throw new InvalidArgument("expected a one-line reason");
  const t = w.trim().split(/\s+/).join(" ");
  if (!t || [...t].length > MAX_WHY) throw new InvalidArgument(`the reason must be 1 to ${MAX_WHY} characters`);
  return t;
}

/**
 * `drift feedback mark` arguments after the subcommand: the verdict, the reason attached with `=` (so a reason that
 * reads like a flag stays a value), then `--` and the convention id and member, so a member is never read as a flag.
 */
export function markFlags(id: unknown, member: unknown, verdict: unknown, why: unknown): string[] {
  const [cid] = assertConventionIds([id]);
  const m = assertMember(member);
  const v = assertVerdict(verdict);
  return [v === "true" ? "--true" : "--wrong", ...(why === null || why === undefined ? [] : [`--why=${assertWhy(why)}`]), "--", cid, m];
}

/** `drift upgrade` arguments: the report as JSON, and with `apply` what changes no decision a person made (`--security-baseline` only when asked). */
export function upgradeFlags(apply: boolean, securityBaseline: unknown): string[] {
  if (!apply) return ["--json"];
  return ["--apply", ...(assertBool(securityBaseline, "securityBaseline") ? ["--security-baseline"] : []), "--json"];
}
