export type DriftIdPrefix =
  | "repo"
  | "scan"
  | "fact"
  | "candidate"
  | "convention"
  | "contract"
  | "finding"
  | "baseline"
  | "policy"
  | "waiver"
  | "agent_session"
  | "policy_decision"
  | "audit_event"
  | "artifact";

export function makeDriftId(prefix: DriftIdPrefix, stablePart: string): string {
  if (!stablePart || /\s/.test(stablePart)) {
    throw new Error("stablePart must be non-empty and contain no whitespace");
  }

  return `${prefix}_${stablePart}`;
}
