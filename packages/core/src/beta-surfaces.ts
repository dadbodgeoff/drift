import { z } from "zod";

export const BETA_START_RESPONSE_SCHEMA = "drift.start.result.v1";
export const BETA_DOCTOR_RESPONSE_SCHEMA = "drift.doctor.result.v1";

const MachineVersionsShape = z.object({
  schema_version: z.literal("drift.machine_contract_versions.v1")
}).passthrough();

export const BetaStartResponseSchema = z.object({
  response_schema: z.literal(BETA_START_RESPONSE_SCHEMA),
  repo: z.object({ id: z.string().min(1) }).passthrough(),
  scan: z.object({ id: z.string().min(1) }).passthrough(),
  candidates: z.array(z.unknown()),
  summary: z.object({
    files_indexed: z.number().int().nonnegative(),
    facts_count: z.number().int().nonnegative(),
    diagnostics_count: z.number().int().nonnegative(),
    candidates_count: z.number().int().nonnegative(),
    engine_source: z.enum(["rust", "typescript_fallback"])
  }).passthrough(),
  onboarding: z.object({
    status: z.enum(["ready", "needs_convention_review", "needs_more_signal"]),
    accepted_default: z.boolean(),
    contract_ready: z.boolean(),
    baselined_count: z.number().int().nonnegative(),
    candidate_count: z.number().int().nonnegative()
  }).passthrough(),
  state: z.object({
    repo_id: z.string().min(1),
    repo_root: z.string().min(1),
    database_path: z.string().min(1)
  }).passthrough(),
  accepted: z.unknown().optional(),
  // BB-3: present whenever `accepted` is. Shaped rather than `unknown` because the whole point of
  // the item is that these four facts cannot go missing again - a passthrough field that drops out
  // silently would reproduce the bug at the schema layer.
  acceptance: z.object({
    convention_id: z.string().min(1),
    convention_kind: z.string().min(1),
    mode: z.enum(["off", "brief", "warn", "block"]),
    severity: z.string().min(1),
    baselined_count: z.number().int().nonnegative(),
    blocks_new_violations: z.boolean(),
    upgrade_command: z.string().min(1).nullable(),
    // CV-5: a repo can onboard with more than one convention from this item on, so the count and the
    // per-convention modes are shaped too. Same reasoning as BB-3's four fields: a reader deciding
    // whether onboarding did what they expected needs the count, and a passthrough field that dropped
    // out silently would reproduce BB-3's bug one item later.
    accepted_count: z.number().int().nonnegative(),
    also_accepted: z.array(z.object({
      convention_id: z.string().min(1),
      convention_kind: z.string().min(1),
      mode: z.enum(["off", "brief", "warn", "block"]),
      blocks_new_violations: z.boolean(),
      upgrade_command: z.string().min(1)
    })),
    // Families that exist and were skipped. Shaped, because a silent skip is the failure this names.
    deferred_candidates: z.array(z.object({
      candidate_id: z.string().min(1),
      convention_kind: z.string().min(1),
      coverage_ratio: z.number(),
      evidence_file_count: z.number().int().nonnegative(),
      below_floor_reason: z.enum(["coverage", "evidence_files", "both"]).nullable(),
      review_command: z.string().min(1)
    }))
  }).optional(),
  baselined_count: z.number().int().nonnegative(),
  machine_contract_versions: MachineVersionsShape,
  engine: z.unknown(),
  v1_scope: z.unknown(),
  next_commands: z.array(z.string().min(1))
}).passthrough();

export const BetaDoctorResponseSchema = z.object({
  response_schema: z.literal(BETA_DOCTOR_RESPONSE_SCHEMA),
  status: z.enum(["ok", "warn", "fail"]),
  repo_root: z.string().min(1),
  database_path: z.string().min(1),
  runtime: z.unknown(),
  machine_contract_versions: MachineVersionsShape,
  engine: z.unknown(),
  v1_scope: z.unknown(),
  state_summary: z.unknown(),
  checks: z.array(z.unknown()),
  next_command: z.string().nullable(),
  next_commands: z.array(z.string())
}).passthrough();

export type BetaStartResponse = z.infer<typeof BetaStartResponseSchema>;
export type BetaDoctorResponse = z.infer<typeof BetaDoctorResponseSchema>;
