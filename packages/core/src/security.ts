import { z } from "zod";

/**
 * D-P3b: the security capability names, from the one capability vocabulary.
 *
 * Twenty names were declared here and thirteen reported by the engine's `security_capabilities()`,
 * with seven never appearing there: cors_policy_facts, csrf_facts, middleware_coverage,
 * outbound_request_facts, rate_limit_facts, raw_sql_facts, request_validation_facts. Five of the
 * seven were a SECOND NAME for a capability the engine already reported under a shorter one
 * (`ssrf`/`outbound_request_facts`, `raw_sql`/`raw_sql_facts`, `cors_policy`/`cors_policy_facts`,
 * `csrf`/`csrf_facts`, `rate_limit`/`rate_limit_facts`), so the same capability was required under
 * one name and certified under another. The pairs are collapsed onto the `*_facts` names - the ones
 * that reach `stats.capabilities.required` on the wire.
 *
 * This enum had no reference anywhere; every `capability` field it should have typed was
 * `z.string().min(1)`. The parity gate now enforces the correspondence the enum was written to
 * express.
 */
export { SecurityCapabilityNameSchema } from "@drift/vocabulary";
export type { SecurityCapabilityName } from "@drift/vocabulary";

/**
 * The FINDING-level codes, from the one security_missing_proof_code vocabulary.
 *
 * This was thirty-two members written out here and again, byte for byte, in
 * @drift/engine-contract. Neither copy was reachable from the other, and the parity gate
 * could not see the duplication: rule 2 catches a list that is a PROPER SUBSET of a
 * vocabulary, and two identical full-size copies are not subsets of anything.
 *
 * `unknown_reason_code` is a member and is NOT an engine-emittable code. It is what the
 * engine-contract parse boundary normalizes an unrecognized code to (T-17), so an engine
 * newer than its CLI degrades the convention that produced it rather than failing the run.
 * Never readable as "proof satisfied" - not knowing why a proof failed is a refusal.
 */
export { SecurityMissingProofCodeSchema };

/**
 * The SECURITY parser gap codes, from the one security_parser_gap_code vocabulary.
 *
 * Not the same vocabulary as `parser_gap_kind`, despite the name. That one is the repo-wide
 * taxonomy of why a REGION could not be understood; this one is the set of specific
 * constructs a security proof gives up on. The lists are disjoint and the collision is in
 * the English words, not the concept.
 */
export { SecurityParserGapCodeSchema };

// The kinds that carry a security boundary proof, from the one convention vocabulary. This list,
// the identical one in @drift/engine-contract, and EXPERIMENTAL_SECURITY_CONVENTION_KINDS all claim
// to be the same set; the third had twelve entries to these thirteen.
import {
  AuthorizationMissingReasonSchema,
  MiddlewareMismatchReasonSchema,
  RequestUnvalidatedReasonSchema,
  SecurityMissingProofCodeSchema,
  SecurityParserGapCodeSchema,
  SecurityContractKindSchema,
  SessionTrustReasonSchema,
  TenantMissingReasonSchema,
  UndominatedSinkReasonSchema
} from "@drift/vocabulary";

const Phase5SensitiveFieldSchema = z.object({
  field_path: z.string().min(1),
  classification: z.enum(["pii", "credential", "token", "tenant_secret", "internal"]),
  source: z.enum(["contract", "schema", "candidate"])
});

const Phase5ResponseSerializerSchema = z.object({
  serializer_id: z.string().min(1),
  import_source: z.string().min(1),
  imported_name: z.string().min(1).optional(),
  local_name: z.string().min(1).optional(),
  policy: z.enum(["allowlist", "denylist"], {
    errorMap: () => ({ message: "serializer policy must be allowlist or denylist" })
  }),
  filtered_fields: z.array(z.string().min(1))
});

const Phase5SensitiveResponseRequiresSchema = z.object({
  sensitive_response_fields: z.array(Phase5SensitiveFieldSchema).optional(),
  response_serializers: z.array(Phase5ResponseSerializerSchema).optional()
}).strict();

const Phase5SecretExposureRequiresSchema = z.object({
  secret_sources: z.array(z.enum(["env", "config", "secret_manager"])).optional(),
  log_sinks: z.array(z.string().min(1)).optional()
}).strict();

function containsSourceValue(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (Array.isArray(payload)) {
    return payload.some(containsSourceValue);
  }

  return Object.entries(payload).some(([key, value]) =>
    [
      "source_value",
      "secret_value",
      "env_value",
      "token_value",
      "cookie_value",
      "header_value",
      "request_payload"
    ].includes(key) || containsSourceValue(value)
  );
}

export const SecurityConventionSchema = z.object({
  contract_id: z.string().min(1),
  kind: SecurityContractKindSchema,
  capability: z.enum(["briefing_only", "heuristic_check", "deterministic_check"]),
  enforcement_mode: z.enum(["off", "brief", "warn", "block"]),
  matcher: z.object({
    file_roles: z.array(z.literal("api_route")).optional(),
    path_globs: z.array(z.string().min(1)).optional(),
    route_paths: z.array(z.string().min(1)).optional(),
    route_path_patterns: z.array(z.string().min(1)).optional(),
    methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])).optional(),
    frameworks: z.array(z.string().min(1)).optional(),
    package_names: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional()
  }),
  scope: z.object({
    check_scope: z.enum(["changed-hunks", "changed-files", "full"]),
    diff_status: z.array(z.enum(["added", "modified", "renamed"])).optional(),
    applies_to: z.enum(["route", "handler", "middleware", "data_operation", "response"]),
    path_globs: z.array(z.string().min(1)).optional(),
    include_pre_existing: z.boolean().optional()
  }),
  requires: z.record(z.unknown()).optional(),
  forbids: z.record(z.unknown()).optional(),
  exceptions: z.array(z.record(z.unknown())).optional(),
  governance: z.object({
    accepted_by: z.string().min(1).optional(),
    accepted_at: z.string().datetime().optional(),
    updated_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
    rationale: z.string().min(1).optional(),
    evidence_refs: z.array(z.string().min(1)).optional(),
    counterexample_refs: z.array(z.string().min(1)).optional()
  }).optional()
}).superRefine((contract, context) => {
  if (contract.enforcement_mode === "block" && contract.capability !== "deterministic_check") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blocking security contracts require deterministic capability"
    });
  }

  if (
    contract.kind !== "api_route_forbids_sensitive_response_fields" &&
    contract.kind !== "api_route_forbids_secret_exposure"
  ) {
    return;
  }

  if (containsSourceValue(contract.requires)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "source values are not allowed in Phase 5 security contracts",
      path: ["requires"]
    });
  }

  const requiresResult = contract.kind === "api_route_forbids_sensitive_response_fields"
    ? Phase5SensitiveResponseRequiresSchema.safeParse(contract.requires ?? {})
    : Phase5SecretExposureRequiresSchema.safeParse(contract.requires ?? {});

  if (!requiresResult.success) {
    for (const issue of requiresResult.error.issues) {
      context.addIssue({
        ...issue,
        path: ["requires", ...issue.path]
      });
    }
    return;
  }

  if (
    contract.enforcement_mode === "block" &&
    contract.kind === "api_route_forbids_sensitive_response_fields"
  ) {
    const fields = Phase5SensitiveResponseRequiresSchema.parse(contract.requires ?? {})
      .sensitive_response_fields ?? [];
    if (fields.some((field) => field.source === "candidate")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidate sensitive fields cannot back blocking enforcement",
        path: ["requires", "sensitive_response_fields"]
      });
    }
  }
});

const SecurityContractMatchSchema = z.object({
  contract_id: z.string().min(1),
  kind: SecurityContractKindSchema,
  enforcement_mode: z.enum(["off", "brief", "warn", "block"]),
  capability: z.enum(["briefing_only", "heuristic_check", "deterministic_check"]),
  matched: z.boolean()
});

const SecurityCapabilityStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["complete", "partial", "unsupported", "failed"]),
  can_block: z.boolean(),
  parser_gap_ids: z.array(z.string().min(1)),
  missing_proof_ids: z.array(z.string().min(1))
});

const SecurityAuthProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  proof_kind: z.enum(["handler_guard", "middleware_guard", "both", "none"]),
  trusted_guard_calls: z.array(z.object({
    fact_id: z.string().min(1),
    guard_id: z.string().min(1),
    symbol: z.string().min(1),
    start_line: z.number().int().positive().optional(),
    end_line: z.number().int().positive().optional(),
    result_var: z.string().min(1).optional()
  })),
  dominated_sinks: z.array(z.object({
    sink_id: z.string().min(1),
    sink_kind: z.enum(["data_operation", "response", "outbound_request", "raw_sql", "secret_log"]),
    edge_id: z.string().min(1)
  })),
  undominated_sinks: z.array(z.object({
    sink_id: z.string().min(1),
    sink_kind: z.string().min(1),
    // PROOF-level, from the one undominated_sink_reason vocabulary. Two producers:
    // security_proof.rs for the straight-line and dynamic cases, security_control_flow.rs
    // for the path-sensitive ones.
    reason: UndominatedSinkReasonSchema,
    fact_ids: z.array(z.string().min(1))
  }))
});

const SecurityMiddlewareProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  matched_middleware: z.array(z.object({
    middleware_id: z.string().min(1),
    matcher_fact_id: z.string().min(1),
    protects_route_edge_id: z.string().min(1),
    protection_kind: z.enum(["auth", "csrf", "rate_limit", "cors", "unknown"])
  })),
  mismatches: z.array(z.object({
    middleware_id: z.string().min(1).optional(),
    // PROOF-level, from the one middleware_mismatch_reason vocabulary.
    reason: MiddlewareMismatchReasonSchema,
    parser_gap_id: z.string().min(1).optional()
  }))
});

const SecurityRequestValidationProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  input_reads: z.array(z.object({
    fact_id: z.string().min(1),
    source: z.enum(["body", "query", "params", "headers", "cookies", "formData"]),
    variable: z.string().min(1).optional(),
    key: z.string().min(1).optional()
  })),
  validations: z.array(z.object({
    fact_id: z.string().min(1),
    validator_symbol: z.string().min(1),
    schema_symbol: z.string().min(1).optional(),
    input_var: z.string().min(1).optional(),
    result_var: z.string().min(1).optional()
  })),
  validated_uses: z.array(z.object({
    fact_id: z.string().min(1).optional(),
    source_input_var: z.string().min(1),
    validated_var: z.string().min(1),
    sink_fact_id: z.string().min(1),
    sink_kind: z.enum(["data_operation", "response", "outbound_request", "raw_sql"])
  })),
  unvalidated_uses: z.array(z.object({
    input_fact_id: z.string().min(1),
    sink_fact_id: z.string().min(1),
    sink_kind: z.enum(["data_operation", "response", "outbound_request", "raw_sql"]),
    // PROOF-level, from the one request_unvalidated_reason vocabulary.
    reason: RequestUnvalidatedReasonSchema
  }))
});

const SecuritySessionTrustProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  trusted_sessions: z.array(z.object({
    fact_id: z.string().min(1),
    variable: z.string().min(1),
    source: z.string().min(1).optional(),
    trust: z.enum(["trusted", "untrusted", "unknown"])
  }).passthrough()),
  missing_trust: z.array(z.object({
    fact_id: z.string().min(1),
    variable: z.string().min(1),
    // PROOF-level, from the one session_trust_reason vocabulary. This was a fourth
    // hand-written copy of a list the engine emitted a non-member of (S1-01).
    reason: SessionTrustReasonSchema
  }))
});

const SecurityAuthorizationProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  role_or_policy_guards: z.array(z.object({
    fact_id: z.string().min(1),
    policy_id: z.string().min(1).optional(),
    roles: z.array(z.string().min(1)).optional().default([]),
    permissions: z.array(z.string().min(1)).optional().default([]),
    resource_var: z.string().min(1).optional(),
    subject_var: z.string().min(1).optional()
  })),
  missing: z.array(z.object({
    // PROOF-level, from the one authorization_missing_reason vocabulary. Two spellings of
    // three concepts, because this enum was widened rather than migrated; only the newer
    // one has a producer, and the older one is held for stored rows.
    reason: AuthorizationMissingReasonSchema,
    sink_fact_id: z.string().min(1).optional()
  }))
});

const SecurityTenantProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  tenant_sources: z.array(z.object({
    fact_id: z.string().min(1),
    source: z.enum(["session", "path_param", "header", "body", "query"]),
    key: z.string().min(1).optional(),
    trusted: z.boolean()
  })),
  predicates: z.array(z.object({
    fact_id: z.string().min(1),
    data_operation_fact_id: z.string().min(1),
    tenant_key: z.string().min(1),
    predicate_kind: z.enum(["equality", "scoped_helper", "policy_helper"])
  })),
  missing: z.array(z.object({
    data_operation_fact_id: z.string().min(1),
    // PROOF-level, from the one tenant_missing_reason vocabulary. Widened the same way
    // authorization_missing_reason was: three design-doc spellings, three engine
    // spellings, and a parser_gap member with no producer at all.
    reason: TenantMissingReasonSchema
  }))
});

const SecurityResponseShapeProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  sensitive_leaks: z.array(z.object({
    field_fact_id: z.string().min(1),
    field_path: z.string().min(1),
    reason: z.enum(["sensitive_field_without_serializer"])
  }))
});

const SecuritySecretSinkProofSchema = z.object({
  secret_fact_id: z.string().min(1),
  secret_class: z.enum(["api_key", "token", "password", "private_key", "unknown"]),
  sink_kind: z.enum(["response", "log"]),
  sink_line: z.number().int().positive(),
  reason: z.enum(["secret_reaches_sink"])
});

const SecurityPhase6MissingProofSchema = z.object({
  code: SecurityMissingProofCodeSchema,
  fact_ids: z.array(z.string().min(1))
});

const SecurityPhase6HelperProofSchema = z.object({
  fact_id: z.string().min(1),
  helper_id: z.string().min(1),
  symbol: z.string().min(1).optional(),
  edge_id: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional()
});

const SecuritySsrfProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  outbound_requests: z.array(z.object({
    fact_id: z.string().min(1),
    sink_id: z.string().min(1),
    api: z.string().min(1),
    url_source: z.enum(["constant", "request_input", "validated_input", "allowlisted", "unknown"])
  })),
  allowlist_proofs: z.array(SecurityPhase6HelperProofSchema),
  missing_proof: z.array(SecurityPhase6MissingProofSchema)
});

const SecurityRawSqlProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  raw_sql_calls: z.array(z.object({
    fact_id: z.string().min(1),
    sink_id: z.string().min(1),
    query_shape: z.enum(["raw_string", "template", "concat", "query_builder", "unknown"]),
    uses_untrusted_input: z.boolean()
  })),
  parameterized_sql: z.array(z.object({
    fact_id: z.string().min(1),
    sink_id: z.string().min(1),
    parameterization: z.string().min(1)
  })),
  missing_proof: z.array(SecurityPhase6MissingProofSchema)
});

const SecurityCorsProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  policies: z.array(z.object({
    fact_id: z.string().min(1),
    origin: z.string().min(1).nullable().optional(),
    credentials: z.boolean(),
    dynamic_origin: z.boolean()
  })),
  missing_proof: z.array(SecurityPhase6MissingProofSchema)
});

const SecurityPhase6GuardProofSchema = z.object({
  required: z.boolean(),
  proven: z.boolean(),
  guard_calls: z.array(SecurityPhase6HelperProofSchema),
  missing_proof: z.array(SecurityPhase6MissingProofSchema)
});

const SecurityMissingProofSchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  code: SecurityMissingProofCodeSchema,
  blocks_enforcement: z.boolean(),
  fact_ids: z.array(z.string().min(1)),
  graph_edge_ids: z.array(z.string().min(1))
});

const SecurityParserGapSchema = z.object({
  parser_gap_id: z.string().min(1),
  capability: z.string().min(1),
  code: SecurityParserGapCodeSchema,
  file_path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  reason: z.string().min(1),
  affected_contract_kinds: z.array(z.string().min(1)),
  affected_route_ids: z.array(z.string().min(1)),
  missing_proof_ids: z.array(z.string().min(1)),
  blocks_enforcement: z.boolean()
});

const SecurityProofEvidenceRefSchema = z.object({
  evidence_id: z.string().min(1),
  fact_id: z.string().min(1).optional(),
  graph_edge_id: z.string().min(1).optional(),
  capability: z.string().min(1),
  kind: z.string().min(1),
  file_path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  role: z.enum([
    "guard",
    "sink",
    "validator",
    "serializer",
    "middleware",
    "policy",
    "parser_gap",
    "missing_proof"
  ])
}).strict();

export const SecurityBoundaryProofSchema = z.object({
  proof_id: z.string().min(1),
  proof_version: z.literal("security-boundary-proof/v1"),
  route: z.object({
    route_id: z.string().min(1),
    normalized_entrypoint_id: z.string().min(1).optional(),
    file_path: z.string().min(1),
    file_role: z.literal("api_route"),
    endpoint: z.object({
      path: z.string().min(1).optional(),
      method: z.string().min(1).optional(),
      framework: z.string().min(1).optional()
    }).optional(),
    handler_symbol: z.string().min(1).optional(),
    start_line: z.number().int().positive().optional(),
    end_line: z.number().int().positive().optional(),
    diff_status: z.enum(["unchanged", "added", "modified", "deleted", "renamed"]).optional()
  }),
  contracts: z.array(SecurityContractMatchSchema),
  capability_status: z.array(SecurityCapabilityStatusSchema),
  auth: SecurityAuthProofSchema,
  middleware: SecurityMiddlewareProofSchema.optional().default({
    required: false,
    proven: false,
    matched_middleware: [],
    mismatches: []
  }),
  request_validation: SecurityRequestValidationProofSchema.optional().default({
    required: false,
    proven: false,
    input_reads: [],
    validations: [],
    validated_uses: [],
    unvalidated_uses: []
  }),
  ssrf: SecuritySsrfProofSchema.optional().default({
    required: false,
    proven: false,
    outbound_requests: [],
    allowlist_proofs: [],
    missing_proof: []
  }),
  raw_sql: SecurityRawSqlProofSchema.optional().default({
    required: false,
    proven: false,
    raw_sql_calls: [],
    parameterized_sql: [],
    missing_proof: []
  }),
  cors: SecurityCorsProofSchema.optional().default({
    required: false,
    proven: false,
    policies: [],
    missing_proof: []
  }),
  csrf: SecurityPhase6GuardProofSchema.optional().default({
    required: false,
    proven: false,
    guard_calls: [],
    missing_proof: []
  }),
  rate_limit: SecurityPhase6GuardProofSchema.optional().default({
    required: false,
    proven: false,
    guard_calls: [],
    missing_proof: []
  }),
  response_shape: SecurityResponseShapeProofSchema.optional().default({
    required: false,
    proven: false,
    sensitive_leaks: []
  }),
  sinks: z.object({
    secrets: z.array(SecuritySecretSinkProofSchema)
  }).optional().default({
    secrets: []
  }),
  session_trust: SecuritySessionTrustProofSchema.optional().default({
    required: false,
    proven: false,
    trusted_sessions: [],
    missing_trust: []
  }),
  authorization: SecurityAuthorizationProofSchema.optional().default({
    required: false,
    proven: false,
    role_or_policy_guards: [],
    missing: []
  }),
  tenant: SecurityTenantProofSchema.optional().default({
    required: false,
    proven: false,
    tenant_sources: [],
    predicates: [],
    missing: []
  }),
  missing_proof: z.array(SecurityMissingProofSchema),
  parser_gaps: z.array(SecurityParserGapSchema),
  evidence_refs: z.array(SecurityProofEvidenceRefSchema).optional().default([]),
  result: z.object({
    proof_status: z.enum(["proven", "violated", "missing_proof", "parser_gap", "advisory_only"]),
    enforcement_result: z.enum(["pass", "brief", "warn", "block"]),
    can_block: z.boolean(),
    finding_ids: z.array(z.string().min(1))
  })
}).superRefine((proof, context) => {
  const phase6MissingCodes = new Set([
    "request_controlled_url",
    "raw_sql_unparameterized",
    "wildcard_origin_with_credentials",
    "disallowed_origin",
    "credentials_not_allowed",
    "unsupported_dynamic_outbound_url",
    "unsupported_dynamic_cors_origin",
    "missing_csrf_guard",
    "csrf_guard_not_dominating_sink",
    "missing_rate_limit_guard",
    "rate_limit_guard_not_dominating_sink"
  ]);
  const phase6ParserGapCodes = new Set([
    "unsupported_dynamic_outbound_url",
    "unsupported_dynamic_cors_origin"
  ]);
  const phase6MissingProof = proof.missing_proof.filter((entry) => phase6MissingCodes.has(entry.code));
  const phase6ParserGaps = proof.parser_gaps.filter((gap) => phase6ParserGapCodes.has(gap.code));

  const requestValidationMissingProof = proof.missing_proof.filter((entry) =>
    entry.capability === "request_validation_facts" ||
    ["request_input_not_validated", "validation_result_not_used", "unknown_validator"].includes(entry.code)
  );
  const blockingRequestValidationParserGaps = proof.parser_gaps.filter((gap) =>
    gap.blocks_enforcement &&
    (gap.capability === "request_validation_facts" ||
      gap.affected_contract_kinds.includes("api_route_requires_request_validation"))
  );

  if (proof.request_validation.required && proof.request_validation.proven) {
    if (
      proof.request_validation.unvalidated_uses.length > 0 ||
      requestValidationMissingProof.length > 0 ||
      blockingRequestValidationParserGaps.length > 0 ||
      proof.request_validation.validated_uses.length === 0 ||
      proof.result.proof_status !== "proven" ||
      proof.result.enforcement_result !== "pass"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "request validation proven proof cannot include missing proof, parser gaps, or unvalidated uses"
      });
    }
  }

  if (
    proof.request_validation.unvalidated_uses.length > 0 &&
    (proof.request_validation.proven || proof.result.proof_status === "proven")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "request validation unvalidated uses require a non-proven proof status"
    });
  }

  if (
    proof.result.proof_status === "proven" &&
    (phase6MissingProof.length > 0 || phase6ParserGaps.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "proven Phase 6 proof cannot include Phase 6 missing proof or parser gaps"
    });
  }

  if (proof.ssrf.required && proof.ssrf.proven) {
    const unsafeOutbound = proof.ssrf.outbound_requests.some((request) =>
      request.url_source === "request_input" || request.url_source === "unknown"
    );
    if (unsafeOutbound || proof.ssrf.missing_proof.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proven SSRF proof cannot include untrusted outbound URLs or missing proof"
      });
    }
  }

  if (proof.raw_sql.required && proof.raw_sql.proven) {
    const parameterizedSinkIds = new Set(proof.raw_sql.parameterized_sql.map((entry) => entry.sink_id));
    const unsafeRawSql = proof.raw_sql.raw_sql_calls.some((call) =>
      !parameterizedSinkIds.has(call.sink_id)
    );
    if (unsafeRawSql || proof.raw_sql.missing_proof.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proven raw SQL proof cannot include unparameterized raw SQL calls or missing proof"
      });
    }
  }

  if (proof.cors.required && proof.cors.proven) {
    const unsafeCorsPolicy = proof.cors.policies.some((policy) =>
      policy.dynamic_origin ||
      (policy.origin === "*" && policy.credentials)
    );
    if (unsafeCorsPolicy || proof.cors.missing_proof.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proven CORS proof cannot include dynamic or unsafe CORS policy evidence"
      });
    }
  }

  if (
    proof.csrf.required &&
    proof.csrf.proven &&
    (proof.csrf.guard_calls.length === 0 || proof.csrf.missing_proof.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "proven CSRF proof requires trusted guard calls and no missing proof"
    });
  }

  if (
    proof.rate_limit.required &&
    proof.rate_limit.proven &&
    (proof.rate_limit.guard_calls.length === 0 || proof.rate_limit.missing_proof.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "proven rate-limit proof requires trusted guard calls and no missing proof"
    });
  }

  if (
    (proof.session_trust.proven && proof.session_trust.missing_trust.length > 0) ||
    (proof.authorization.proven && proof.authorization.missing.length > 0) ||
    (proof.tenant.proven && proof.tenant.missing.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "phase4 proven proof cannot include missing trust, authorization, or tenant proof"
    });
  }

  if (proof.authorization.proven && proof.session_trust.missing_trust.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "authorization proven proof cannot reference untrusted session sources"
    });
  }

  if (
    proof.tenant.proven &&
    proof.tenant.tenant_sources.length > 0 &&
    proof.tenant.tenant_sources.every((source) => !source.trusted)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tenant proven proof requires at least one trusted tenant source"
    });
  }

  const matchedSensitiveResponseContract = proof.contracts.some((contract) =>
    contract.matched && contract.kind === "api_route_forbids_sensitive_response_fields"
  );
  if (matchedSensitiveResponseContract && !proof.response_shape.required) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "matched sensitive response contracts require response_shape proof"
    });
  }

  const matchedSecretExposureContract = proof.contracts.some((contract) =>
    contract.matched && contract.kind === "api_route_forbids_secret_exposure"
  );
  if (
    matchedSecretExposureContract &&
    !proof.capability_status.some((status) => status.name === "secret_exposure")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "matched secret exposure contracts require secret_exposure capability status"
    });
  }
});

export type SecurityConvention = z.infer<typeof SecurityConventionSchema>;
export type SecurityBoundaryProof = z.infer<typeof SecurityBoundaryProofSchema>;
