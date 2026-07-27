import { z } from "zod";
import {
  EnforcementCapabilitySchema,
  EntrypointKindSchema,
  EvidenceRefSchema,
  FileRoleSchema
} from "./schemas.js";

const RepoRelativePatternSchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes(".."),
  "pattern must be repo-relative"
);

export const FrameworkNameSchema = z.enum([
  "next_app",
  "next_pages",
  "express",
  "fastify",
  "nest",
  "hono",
  "remix",
  "trpc",
  "graphql",
  "lambda",
  "worker",
  "custom"
]);

export const FrameworkCapabilityNameSchema = z.enum([
  "entrypoint_discovery",
  "route_pattern_resolution",
  "method_resolution",
  "middleware_chain_resolution",
  "request_input_tracking",
  "auth_guard_dominance",
  "validation_dominance",
  "authorization_dominance",
  "tenant_scope_proof"
]);

export const FrameworkCapabilityStatusSchema = z.enum([
  "complete",
  "partial",
  "unsupported",
  "failed"
]);

export const FrameworkCapabilitySchema = z.object({
  schema_version: z.literal("drift.framework.capability.v1"),
  adapter_id: z.string().min(1),
  framework: FrameworkNameSchema,
  capability: FrameworkCapabilityNameSchema,
  status: FrameworkCapabilityStatusSchema,
  can_block: z.boolean(),
  block_requires_accepted_convention: z.boolean(),
  parser_gap_ids: z.array(z.string().min(1)),
  missing_proof_ids: z.array(z.string().min(1))
}).superRefine((capability, context) => {
  if (capability.can_block && capability.status !== "complete") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["can_block"],
      message: "can_block requires complete framework capability"
    });
  }
  if (capability.can_block && !capability.block_requires_accepted_convention) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["block_requires_accepted_convention"],
      message: "blocking framework capability requires accepted convention"
    });
  }
});

export const FrameworkAdapterSchema = z.object({
  schema_version: z.literal("drift.framework.adapter.v1"),
  adapter_id: z.string().min(1),
  framework: FrameworkNameSchema,
  adapter_version: z.string().min(1),
  package_names: z.array(z.string().min(1)),
  entrypoint_kinds: z.array(EntrypointKindSchema),
  supported_patterns: z.array(z.string().min(1)),
  unsupported_patterns: z.array(z.string().min(1)),
  capabilities: z.array(FrameworkCapabilitySchema)
});

export const NormalizedEntrypointFactSchema = z.object({
  schema_version: z.literal("drift.normalized_entrypoint.v1"),
  entrypoint_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  adapter_id: z.string().min(1),
  framework: FrameworkNameSchema,
  kind: EntrypointKindSchema,
  file_path: z.string().min(1),
  exported_symbol: z.string().min(1).optional(),
  handler_symbol: z.string().min(1).optional(),
  route_pattern: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  route_group: z.string().min(1).optional(),
  package_name: z.string().min(1).optional(),
  subdirectory_role: z.string().min(1).optional(),
  middleware_refs: z.array(z.string().min(1)),
  request_source_refs: z.array(z.string().min(1)),
  response_sink_refs: z.array(z.string().min(1)),
  data_operation_refs: z.array(z.string().min(1)),
  confidence_label: z.enum(["certain", "high", "medium", "low", "heuristic"]),
  evidence_refs: z.array(z.string().min(1)),
  parser_gap_ids: z.array(z.string().min(1))
});

export const SubdirectoryConventionSchema = z.object({
  kind: z.literal("subdirectory_convention"),
  id: z.string().min(1),
  version: z.literal(1),
  path_globs: z.array(RepoRelativePatternSchema).min(1),
  package_names: z.array(z.string().min(1)).optional(),
  roles: z.array(z.object({
    role: FileRoleSchema,
    path_globs: z.array(RepoRelativePatternSchema).min(1),
    framework_tags: z.array(FrameworkNameSchema).optional(),
    entrypoint_kinds: z.array(EntrypointKindSchema).optional()
  })).min(1),
  ownership: z.object({
    team: z.string().min(1).optional(),
    service_name: z.string().min(1).optional(),
    package_name: z.string().min(1).optional()
  }).optional(),
  enforcement: z.enum(["briefing", "advisory", "blocking"])
});

export const FrameworkConventionCandidateKindSchema = z.enum([
  "framework_adapter_enabled",
  "framework_entrypoints_require_auth",
  "framework_entrypoints_require_validation",
  "framework_entrypoints_require_authorization",
  "framework_entrypoints_require_tenant_scope",
  "framework_subdirectory_role"
]);

export const FrameworkConventionCandidateSchema = z.object({
  schema_version: z.literal("drift.framework.convention_candidate.v1"),
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: FrameworkConventionCandidateKindSchema,
  framework: FrameworkNameSchema,
  adapter_id: z.string().min(1),
  scope: z.object({
    path_globs: z.array(RepoRelativePatternSchema).min(1),
    package_names: z.array(z.string().min(1)).optional(),
    route_patterns: z.array(z.string().min(1)).optional(),
    methods: z.array(z.string().min(1)).optional(),
    entrypoint_kinds: z.array(EntrypointKindSchema).optional()
  }),
  suggested_enforcement_mode: z.enum(["brief", "warn", "block"]),
  enforcement_capability: EnforcementCapabilitySchema,
  confidence_label: z.enum(["low", "medium", "high"]),
  evidence_refs: z.array(EvidenceRefSchema),
  counterexample_refs: z.array(EvidenceRefSchema),
  cannot_block_reason: z.string().min(1).optional()
}).superRefine((candidate, context) => {
  if (
    candidate.suggested_enforcement_mode === "block" &&
    candidate.enforcement_capability !== "deterministic_check"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suggested_enforcement_mode"],
      message: "blocking framework candidates require deterministic capability"
    });
  }
});

export const FrameworkElectionSchema = z.object({
  schema_version: z.literal("drift.framework.election.v1"),
  election_id: z.string().min(1),
  repo_id: z.string().min(1),
  candidate_id: z.string().min(1),
  decision: z.enum(["accepted", "rejected", "edited"]),
  actor: z.string().min(1),
  decided_at: z.string().datetime(),
  before_hash: z.string().min(1).optional(),
  after_hash: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  accepted_contract_ids: z.array(z.string().min(1)),
  evidence_refs: z.array(z.string().min(1))
});

export const FrameworkParserGapSchema = z.object({
  schema_version: z.literal("drift.framework.parser_gap.v1"),
  parser_gap_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  adapter_id: z.string().min(1),
  framework: FrameworkNameSchema.optional(),
  file_path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  code: z.enum([
    "unsupported_framework_pattern",
    "route_binding_unresolved",
    "handler_unresolved",
    "dynamic_router_registration",
    "decorator_metadata_unresolved",
    "middleware_chain_unresolved",
    "rpc_procedure_unresolved",
    "graphql_resolver_unresolved",
    "serverless_event_shape_unresolved"
  ]),
  reason: z.string().min(1),
  affected_entrypoint_ids: z.array(z.string().min(1)),
  affected_contract_kinds: z.array(z.string().min(1)),
  blocks_enforcement: z.boolean(),
  suggested_next_step: z.string().min(1)
}).superRefine((gap, context) => {
  if (
    gap.start_line !== undefined &&
    gap.end_line !== undefined &&
    gap.end_line < gap.start_line
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_line"],
      message: "end_line must be greater than or equal to start_line"
    });
  }
});

export const FrameworkEntrypointReadModelSchema = z.object({
  schema_version: z.literal("drift.framework_entrypoints.read_model.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  summary: z.object({
    entrypoint_count: z.number().int().nonnegative(),
    supported_count: z.number().int().nonnegative(),
    parser_gap_count: z.number().int().nonnegative(),
    unsupported_count: z.number().int().nonnegative(),
    blocking_gap_count: z.number().int().nonnegative()
  }),
  by_framework: z.array(z.object({
    framework: FrameworkNameSchema,
    adapter_id: z.string().min(1),
    entrypoint_count: z.number().int().nonnegative(),
    capability_status: FrameworkCapabilityStatusSchema,
    can_block: z.boolean()
  })),
  entrypoints: z.array(z.object({
    entrypoint_id: z.string().min(1),
    framework: FrameworkNameSchema,
    kind: EntrypointKindSchema,
    file_path: z.string().min(1),
    route_pattern: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    proof_status: z.string().min(1).optional(),
    parser_gap_codes: z.array(z.string().min(1))
  }))
});

export type FrameworkName = z.infer<typeof FrameworkNameSchema>;
export type FrameworkCapability = z.infer<typeof FrameworkCapabilitySchema>;
export type FrameworkAdapter = z.infer<typeof FrameworkAdapterSchema>;
export type NormalizedEntrypointFact = z.infer<typeof NormalizedEntrypointFactSchema>;
export type SubdirectoryConvention = z.infer<typeof SubdirectoryConventionSchema>;
export type FrameworkConventionCandidate = z.infer<typeof FrameworkConventionCandidateSchema>;
export type FrameworkElection = z.infer<typeof FrameworkElectionSchema>;
export type FrameworkParserGap = z.infer<typeof FrameworkParserGapSchema>;
export type FrameworkEntrypointReadModel = z.infer<typeof FrameworkEntrypointReadModelSchema>;
