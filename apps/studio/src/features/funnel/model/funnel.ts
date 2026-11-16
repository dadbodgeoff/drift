// What mining dropped (`drift census --why --json`, crates/drift-mine/src/funnel.rs), shaped for the Funnel view.
// Pure functions over what Drift printed: the gates, their order and origins, the counts and the dropped candidates
// are Drift's; nothing here decides what mining should have kept. Observation only: nothing listed is proposed,
// checked or shown to agents.
import { type CensusWhy, FUNNEL_STAGES, type FunnelDropped, type FunnelGate, type FunnelStage } from "@/shared/contract/drift";
import { type MessageKey, t } from "@/shared/i18n";

/** Where a gate's threshold comes from, as the audit of the gates found it (funnel.rs `STUDY`, `PRE_REGISTERED`, `ENGINEERING`, `RATIONALE`). */
export type OriginKind = "study" | "preRegistered" | "engineering" | "rationale" | "other";

export function originKind(origin: string): OriginKind {
  switch (origin) {
    case "study":
      return "study";
    case "pre-registered":
      return "preRegistered";
    case "engineering, no study":
      return "engineering";
    case "engineering, rationale written but not measured":
      return "rationale";
    default:
      return "other";
  }
}

/** Whether the gate comes from the study: measured by it, or its threshold pre-registered for it. */
export function fromStudy(origin: string): boolean {
  const k = originKind(origin);
  return k === "study" || k === "preRegistered";
}

const ORIGIN_KEY: Record<Exclude<OriginKind, "other">, MessageKey> = {
  study: "funnel.originLabel.study",
  preRegistered: "funnel.originLabel.preRegistered",
  engineering: "funnel.originLabel.engineering",
  rationale: "funnel.originLabel.rationale",
};

/** The origin in plain words; one this Studio does not know is quoted as Drift wrote it. */
export function originText(origin: string): string {
  const k = originKind(origin);
  return k === "other" ? t("funnel.originLabel.other", { origin: origin || "?" }) : t(ORIGIN_KEY[k]);
}

const STAGE_KEY: Record<FunnelStage, MessageKey> = {
  roles: "funnel.stage.roles",
  role_mined: "funnel.stage.role_mined",
  observed: "funnel.stage.observed",
  drafted: "funnel.stage.drafted",
  mined: "funnel.stage.mined",
  proposed: "funnel.stage.proposed",
};

/** The stages Drift counted, in its order, each with how many reached it. Empty when this drift counted none. */
export function stageRows(doc: Pick<CensusWhy, "reached">): { stage: FunnelStage; label: string; n: number }[] {
  return FUNNEL_STAGES.flatMap((stage) => {
    const n = doc.reached[stage];
    return typeof n === "number" ? [{ stage, label: t(STAGE_KEY[stage]), n }] : [];
  });
}

/** The gates that dropped something, then those that dropped nothing, each in the order mining applies them. */
export function splitGates(gates: readonly FunnelGate[]): { dropping: FunnelGate[]; quiet: FunnelGate[] } {
  return { dropping: gates.filter((g) => g.dropped > 0), quiet: gates.filter((g) => g.dropped === 0) };
}

/** The gate to show: the one asked for when Drift has it, else the first that dropped something, else none. */
export function selectedGate(doc: Pick<CensusWhy, "gates">, asked: string | null): FunnelGate | null {
  if (asked) {
    const g = doc.gates.find((x) => x.name === asked);
    if (g) return g;
  }
  return doc.gates.find((g) => g.dropped > 0) ?? null;
}

/** The candidates a gate dropped, in Drift's order (strongest first). */
export function droppedAt(doc: Pick<CensusWhy, "dropped">, gate: string): FunnelDropped[] {
  return doc.dropped.filter((d) => d.gate === gate);
}

const TARGET_KEY: Record<string, MessageKey> = {
  repository: "funnel.target.repository",
  dependency: "funnel.target.dependency",
  built_in: "funnel.target.built_in",
  unresolved: "funnel.target.unresolved",
  mixed: "funnel.target.mixed",
};

/** Where the rule's target is defined, in words (funnel.rs `target_words`); "" for `none` or a kind this Studio does not know. */
export function targetText(target: string): string {
  const key = TARGET_KEY[target];
  return key ? t(key) : "";
}

/** What `census --why` says of a dropped candidate after its rule: the gate's detail, where its target is, the default tier, Python. */
export function droppedFacts(d: FunnelDropped): string[] {
  const out: string[] = [];
  if (d.detail) out.push(d.detail);
  const where = targetText(d.target);
  if (where) out.push(where);
  if (d.default_tier) out.push(t("funnel.defaultTier"));
  if (d.lang === "py") out.push(t("funnel.python"));
  return out;
}
