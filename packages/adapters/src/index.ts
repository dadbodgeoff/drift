import { z } from "zod";

export const AdapterCapabilityIdSchema = z.enum([
  "file_discovery",
  "syntax_facts",
  "import_resolution",
  "symbol_linking",
  "route_detection",
  "data_operation_detection",
  "graph_stream",
  "direct_data_access_check",
  "candidate_inference"
]);

export type AdapterCapabilityId = z.infer<typeof AdapterCapabilityIdSchema>;

export const AdapterLanguageSchema = z.enum([
  "typescript",
  "tsx",
  "javascript",
  "jsx"
]);

export type AdapterLanguage = z.infer<typeof AdapterLanguageSchema>;

export const AdapterRuntimeSchema = z.enum([
  "rust_builtin",
  "external_process"
]);

export const AdapterExecutionSchema = z.enum([
  "in_process",
  "subprocess_manifest_only"
]);

export const AdapterCapabilityCertificationSchema = z.enum([
  "declared",
  "fixture_verified",
  "golden_verified"
]);

export const AdapterCapabilityScopeSchema = z.object({
  languages: z.array(AdapterLanguageSchema).min(1),
  frameworks: z.array(z.string().min(1)).optional(),
  file_roles: z.array(z.string().min(1)).optional()
});

export const AdapterCapabilityEvidenceSchema = z.object({
  fixture_ids: z.array(z.string().min(1)),
  test_commands: z.array(z.string().min(1)),
  notes: z.string().min(1).optional()
});

export const AdapterCapabilitySchema = z.object({
  id: AdapterCapabilityIdSchema,
  certification: AdapterCapabilityCertificationSchema,
  scope: AdapterCapabilityScopeSchema,
  evidence: AdapterCapabilityEvidenceSchema,
  can_block: z.boolean(),
  diagnostics: z.array(z.string().min(1))
});

export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export const AdapterManifestSchema = z.object({
  id: z.string().min(1),
  language: z.enum(["typescript", "javascript"]),
  version: z.string().min(1),
  runtime: AdapterRuntimeSchema,
  execution: AdapterExecutionSchema,
  package_name: z.string().min(1).optional(),
  capabilities: z.array(AdapterCapabilitySchema).min(1)
}).superRefine((manifest, context) => {
  if (manifest.runtime === "external_process") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "external adapters are manifest-only in V1 and must not be executable",
      path: ["runtime"]
    });
  }
  for (const capability of manifest.capabilities) {
    if (capability.can_block && capability.certification === "declared") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `blocking capability ${capability.id} must be fixture or golden verified`,
        path: ["capabilities"]
      });
    }
  }
});

export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

export const AdapterEvidenceSchema = z.object({
  id: z.string().min(1),
  file_path: z.string().min(1),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  redaction_state: z.enum(["none", "redacted", "snippet_limited"])
});

export const AdapterFactSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  file_path: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).min(1)
});

export const AdapterGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).min(1)
});

export const AdapterGraphEdgeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).default([])
});

export const AdapterDiagnosticSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const AdapterOutputBatchSchema = z.object({
  schema_version: z.literal("adapter.output.batch.v1"),
  adapter_id: z.string().min(1),
  adapter_version: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  capabilities_used: z.array(z.string().min(1)),
  facts: z.array(AdapterFactSchema),
  graph_nodes: z.array(AdapterGraphNodeSchema),
  graph_edges: z.array(AdapterGraphEdgeSchema),
  evidence: z.array(AdapterEvidenceSchema),
  diagnostics: z.array(AdapterDiagnosticSchema),
  stats_delta: z.record(z.number()).optional()
});

export type AdapterOutputBatch = z.infer<typeof AdapterOutputBatchSchema>;

export const FrameworkEntrypointKindSchema = z.enum([
  "api_route",
  "page_route",
  "server_action",
  "cli_command",
  "cron_job",
  "queue_consumer",
  "webhook_handler",
  "middleware",
  "test_entrypoint",
  "script",
  "migration",
  "lambda_handler",
  "worker"
]);

export const FrameworkAdapterContractSchema = z.object({
  schema_version: z.literal("drift.framework_adapter.v1"),
  adapter_id: z.string().min(1),
  framework: z.string().min(1),
  version: z.string().min(1),
  route_discovery: z.object({
    path_globs: z.array(z.string().min(1)),
    method_exports: z.array(z.string().min(1))
  }),
  method_discovery: z.object({
    exported_handler_methods: z.array(z.string().min(1))
  }),
  handler_shape: z.array(z.string().min(1)),
  middleware_shape: z.array(z.string().min(1)),
  server_client_boundary: z.array(z.string().min(1)),
  config_files: z.array(z.string().min(1)),
  test_conventions: z.array(z.string().min(1)),
  entrypoint_patterns: z.array(FrameworkEntrypointKindSchema),
  data_access_patterns: z.array(z.string().min(1)),
  generated_file_patterns: z.array(z.string().min(1)),
  unsupported_patterns: z.array(z.string().min(1))
});

export type FrameworkAdapterContract = z.infer<typeof FrameworkAdapterContractSchema>;

export function nextAppRouterAdapter(): FrameworkAdapterContract {
  return FrameworkAdapterContractSchema.parse({
    schema_version: "drift.framework_adapter.v1",
    adapter_id: "next_app_router",
    framework: "next",
    version: "0.1.0",
    route_discovery: {
      path_globs: ["app/**/route.ts", "app/**/route.tsx"],
      method_exports: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    },
    method_discovery: {
      exported_handler_methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    },
    handler_shape: ["exported async function METHOD(request?: Request)"],
    middleware_shape: ["middleware.ts export function middleware(request)"],
    server_client_boundary: ["app router route handlers are server-side entrypoints"],
    config_files: ["next.config.js", "next.config.mjs", "next.config.ts"],
    test_conventions: ["*.test.ts", "*.spec.ts", "__tests__/**/*.ts"],
    entrypoint_patterns: ["api_route", "server_action", "middleware"],
    data_access_patterns: ["prisma.*", "db.*", "database.*", "repositories/**"],
    generated_file_patterns: [".next/**", "next-env.d.ts"],
    unsupported_patterns: ["dynamic route handler export names", "runtime reflection over methods"]
  });
}

export function expressAdapter(): FrameworkAdapterContract {
  return FrameworkAdapterContractSchema.parse({
    schema_version: "drift.framework_adapter.v1",
    adapter_id: "express_router",
    framework: "express",
    version: "0.1.0",
    route_discovery: {
      path_globs: ["**/routes/**/*.ts", "**/routes/**/*.js", "**/server.ts", "**/app.ts"],
      method_exports: ["get", "post", "put", "patch", "delete", "all", "use"]
    },
    method_discovery: {
      exported_handler_methods: ["router.METHOD(path, handler)", "app.METHOD(path, handler)"]
    },
    handler_shape: ["router.get('/path', handler)", "app.post('/path', async (req, res) => {})"],
    middleware_shape: ["app.use(middleware)", "router.use(path?, middleware)"],
    server_client_boundary: ["Express handlers are server-side entrypoints"],
    config_files: ["server.ts", "server.js", "app.ts", "app.js"],
    test_conventions: ["*.test.ts", "*.spec.ts", "__tests__/**/*.ts"],
    entrypoint_patterns: ["api_route", "middleware", "webhook_handler"],
    data_access_patterns: ["prisma.*", "db.*", "database.*", "repositories/**"],
    generated_file_patterns: ["dist/**", "build/**"],
    unsupported_patterns: [
      "computed router method names",
      "runtime-loaded route modules",
      "framework wrappers that hide app/router calls"
    ]
  });
}

export const TYPESCRIPT_ADAPTER_MANIFEST: AdapterManifest = AdapterManifestSchema.parse({
  id: "typescript",
  language: "typescript",
  version: "0.1.0",
  runtime: "rust_builtin",
  execution: "in_process",
  package_name: "@drift/engine",
  capabilities: [
    blockingCapability("file_discovery", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-direct-db",
      "mixed-js-ts"
    ]),
    blockingCapability("syntax_facts", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-direct-db",
      "next-prisma-clean-service"
    ]),
    blockingCapability("import_resolution", ["typescript", "tsx", "javascript", "jsx"], [
      "monorepo-alias-db",
      "next-api-service-delegated"
    ]),
    blockingCapability("symbol_linking", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-service-delegated"
    ]),
    blockingCapability("route_detection", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-direct-db",
      "dynamic-route-params"
    ]),
    blockingCapability("data_operation_detection", ["typescript", "tsx", "javascript", "jsx"], [
      "route-write-operation"
    ]),
    blockingCapability("graph_stream", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-service-delegated",
      "monorepo-alias-db"
    ]),
    blockingCapability("direct_data_access_check", ["typescript", "tsx", "javascript", "jsx"], [
      "next-api-direct-db",
      "next-real-repo-chadlike"
    ]),
    {
      id: "candidate_inference",
      certification: "fixture_verified",
      scope: {
        languages: ["typescript", "tsx", "javascript", "jsx"],
        frameworks: ["nextjs"],
        file_roles: ["api_route", "service_module"]
      },
      evidence: {
        fixture_ids: ["next-api-direct-db", "next-api-service-delegated"],
        test_commands: ["cargo test -p drift-engine --test candidate_inference"],
        notes: "Candidate inference is review/propose only and cannot block in V1."
      },
      can_block: false,
      diagnostics: []
    }
  ]
});

export const BUILTIN_ADAPTER_MANIFESTS: readonly AdapterManifest[] = [
  TYPESCRIPT_ADAPTER_MANIFEST
];

export function adapterManifestById(adapterId: string): AdapterManifest | undefined {
  return BUILTIN_ADAPTER_MANIFESTS.find((manifest) => manifest.id === adapterId);
}

export function certifiedCapabilitiesForAdapter(
  adapterId: string,
  options: { blockingOnly?: boolean } = {}
): AdapterCapabilityId[] {
  const manifest = adapterManifestById(adapterId);
  if (!manifest) {
    return [];
  }
  return manifest.capabilities
    .filter((capability) => !options.blockingOnly || capability.can_block)
    .map((capability) => capability.id)
    .sort((left, right) => left.localeCompare(right));
}

export function missingRequiredCapabilities(input: {
  adapterId: string;
  requiredCapabilities: string[];
}): string[] {
  const certified = new Set(certifiedCapabilitiesForAdapter(input.adapterId));
  return uniqueSorted(input.requiredCapabilities.filter((capability) => !certified.has(capability as AdapterCapabilityId)));
}

export function assertCertifiedCapability(input: {
  adapterId: string;
  capabilityId: string;
  requiresBlocking?: boolean;
}): AdapterCapability {
  const manifest = adapterManifestById(input.adapterId);
  const capability = manifest?.capabilities.find((item) => item.id === input.capabilityId);
  if (!manifest || !capability || (input.requiresBlocking && !capability.can_block)) {
    throw new Error(`Adapter ${input.adapterId} does not certify required capability ${input.capabilityId}.`);
  }
  return capability;
}

export function validateAdapterOutputBatch(input: {
  manifest: AdapterManifest;
  batch: unknown;
}): AdapterOutputBatch {
  const manifest = AdapterManifestSchema.parse(input.manifest);
  const batch = AdapterOutputBatchSchema.parse(input.batch);
  if (batch.adapter_id !== manifest.id) {
    throw new Error(`Adapter output id ${batch.adapter_id} does not match manifest ${manifest.id}.`);
  }
  if (batch.adapter_version !== manifest.version) {
    throw new Error(`Adapter output version ${batch.adapter_version} does not match manifest ${manifest.version}.`);
  }

  const certifiedCapabilities = new Set(manifest.capabilities.map((capability) => capability.id));
  for (const capability of batch.capabilities_used) {
    if (!certifiedCapabilities.has(capability as AdapterCapabilityId)) {
      throw new Error(`Adapter ${manifest.id} uses uncertified capability ${capability}.`);
    }
  }

  const evidenceIds = new Set(batch.evidence.map((evidence) => evidence.id));
  for (const record of [...batch.facts, ...batch.graph_nodes, ...batch.graph_edges]) {
    for (const evidenceId of record.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Adapter ${manifest.id} output ${record.id} references missing evidence ${evidenceId}.`);
      }
    }
  }

  return batch;
}

function blockingCapability(
  id: AdapterCapabilityId,
  languages: AdapterLanguage[],
  fixtureIds: string[]
): AdapterCapability {
  return {
    id,
    certification: "fixture_verified",
    scope: {
      languages,
      frameworks: ["nextjs"],
      file_roles: ["api_route", "service_module"]
    },
    evidence: {
      fixture_ids: fixtureIds,
      test_commands: ["cargo test -p drift-engine", "pnpm verify:ci"],
      notes: "Certified through deterministic Rust parser/graph fixtures before use in blocking checks."
    },
    can_block: true,
    diagnostics: []
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
