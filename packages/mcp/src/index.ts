import type {
  AcceptedConvention,
  AuditChainVerification,
  ConventionKind,
  EnforcementCapability,
  FactRecord,
  FileSnapshot,
  FileRole,
  Finding,
  FindingDiffStatus,
  FindingStatus,
  PolicyDecision,
  RepoContract,
  ScanManifest,
  Severity
} from "@drift/core";
import {
  authorizeContextExport,
  canonicalRepoContractJson,
  canonicalScanStateJson,
  createDriftCapabilities,
  matchesPolicyGlob
} from "@drift/core";
import {
  DRIFT_CONTRACT_SCHEMA_VERSION,
  DRIFT_CORE_VERSION,
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION
} from "@drift/core";
import { createGraphQueryService, fallbackFactRepoMapFiles, type GraphRepoMapFile } from "@drift/query";
import { MIGRATIONS, openDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { DRIFT_READ_ONLY_MCP_TOOLS } from "./tools.js";
import type {
  DriftMcpHandlers,
  DriftMcpOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCliResult,
  PreparedRequiredCheck,
  PreparedRiskArea,
  PreparedWaiver,
  RelevantFile,
  RepoMapFile
} from "./types.js";

export { DRIFT_READ_ONLY_MCP_TOOLS } from "./tools.js";
export type {
  DriftMcpHandlers,
  DriftMcpOptions,
  DriftMcpTool,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCliResult
} from "./types.js";

export const DRIFT_MCP_PROTOCOL_VERSION = "2024-11-05";
export const DRIFT_MCP_VERSION = "0.1.0";

export function createReadOnlyMcpHandlers(options: DriftMcpOptions): DriftMcpHandlers {
  return {
    get_runtime_info: () => ({
      runtime: mcpRuntime(),
      v1_scope: mcpV1Scope(),
      governance: preflightGovernance()
    }),

    get_capabilities: () => ({
      runtime: mcpRuntime(),
      v1_scope: mcpV1Scope(),
      governance: preflightGovernance(),
      capabilities: mcpCapabilities()
    }),

    get_audit_status: ({ repo_id }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "log");
      const verification = storage.verifyAuditChain(requestedRepoId);
      return {
        repo_id: requestedRepoId,
        policy,
        governance: preflightGovernance(),
        audit_integrity: verification,
        summary: auditVerifySummary(verification),
        next_commands: auditVerifyNextCommands(requestedRepoId, verification)
      };
    }),

    get_scan_status: ({ repo_id }) => withStorage(options, (storage) =>
      scanStatusPayload(storage, requiredMcpString(repo_id, "repo_id"))),

    get_repo_contract: ({ repo_id }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { contract, policy } = requiredAuthorizedMcpContract(storage, requestedRepoId);
      return {
        repo_id: requestedRepoId,
        policy,
        governance: preflightGovernance(),
        summary: contractSummary(contract),
        contract_fingerprint: contractFingerprint(contract),
        contract
      };
    }),

    get_repo_map: ({ repo_id, role, path, require_fresh, limit, offset }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      return repoMapPayload(storage, requestedRepoId, {
        surface: "mcp",
        role,
        path: requestedPath,
        requireFresh: Boolean(require_fresh),
        limit: requestedLimit,
        offset: requestedOffset
      });
    }),

    get_task_preflight: ({ repo_id, task, path, require_fresh, now }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedTask = requiredMcpString(task, "task");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const generatedAt = optionalMcpIsoTimestamp(now, "now") ?? new Date().toISOString();
      const { contract, policy } = requiredAuthorizedMcpContract(storage, requestedRepoId);
      const activeConventions = contract.conventions.filter((convention) =>
        !convention.expires_at || convention.expires_at > generatedAt
      );
      const relevantFiles = relevantFilesForTask({
        repoRoot: storage.getRepo(requestedRepoId)!.root_path,
        task: requestedTask,
        contract: { ...contract, conventions: activeConventions },
        targetPath: requestedPath
      });
      const scanStatus = scanStatusPayload(storage, requestedRepoId);
      assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
      const baseline = baselineSummary(storage, requestedRepoId);
      const findings = storage.listFindings(requestedRepoId)
        .filter(isOpenPreflightFinding)
        .map(preflightFinding);
      const riskyAreas = riskyAreasForFiles(contract, relevantFiles);
      const requiredChecks = requiredChecksForFiles(contract, relevantFiles);
      const waivers = waiversForFiles(contract, relevantFiles, generatedAt);
      return {
        repo_id: requestedRepoId,
        task: requestedTask,
        target_path: requestedPath ?? null,
        generated_at: generatedAt,
        policy,
        contract: {
          id: contract.id,
          schema_version: contract.contract_schema_version,
          updated_at: contract.updated_at
        },
        summary: preflightSummary({
          conventions: activeConventions,
          relevantFiles,
          riskyAreas,
          waivers,
          findings,
          requiredChecks,
          safeCommands: contract.safe_commands,
          baseline,
          scanStatus
        }),
        conventions: activeConventions.map(preflightConvention),
        audit_integrity: scanStatus.audit_integrity,
        scan_status: scanStatus,
        freshness_requirement: freshnessRequirement(Boolean(require_fresh), scanStatus),
        baseline,
        findings,
        relevant_files: relevantFiles,
        risky_areas: riskyAreas,
        waivers,
        required_checks: requiredChecks,
        safe_commands: contract.safe_commands,
        governance: preflightGovernance(),
        redactions: {
          denied_globs: contract.context_egress.denied_globs,
          excluded_file_count: countDeniedFiles(
            storage.getRepo(requestedRepoId)!.root_path,
            contract.context_egress.denied_globs
          ),
          snippets_included: false
        },
        next_commands: [
          `drift check --repo ${requestedRepoId} --diff main...HEAD --scope changed-hunks --json`,
          `drift findings list --repo ${requestedRepoId} --json`
        ]
      };
    }),

    get_conventions: ({ repo_id, kind, capability, limit, offset }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId);
      const requestedKind = validateConventionKind(kind);
      const requestedCapability = validateEnforcementCapability(capability);
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      const allConventions = storage.listAcceptedConventions(requestedRepoId);
      const filteredConventions = orderAcceptedConventionsForReview(allConventions.filter((convention) =>
        (!requestedKind || convention.kind === requestedKind) &&
        (!requestedCapability || convention.enforcement_capability === requestedCapability)
      ));
      const conventions = paginateAcceptedConventions(filteredConventions, requestedLimit, requestedOffset);
      return {
        repo_id: requestedRepoId,
        policy,
        filters: {
          kind: requestedKind ?? null,
          capability: requestedCapability ?? null
        },
        summary: conventionSummary(allConventions, filteredConventions, conventions),
        pagination: paginationSummary(filteredConventions.length, conventions.length, requestedLimit, requestedOffset),
        governance: preflightGovernance(),
        conventions
      };
    }),

    get_findings: ({ repo_id, status, severity, diff_status, convention_id, path, limit, offset, require_fresh }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId);
      const requestedStatus = validateFindingStatus(status);
      const requestedSeverity = validateSeverity(severity);
      const requestedDiffStatus = validateFindingDiffStatus(diff_status);
      const requestedConventionId = optionalMcpString(convention_id, "convention_id");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      const scanStatus = scanStatusPayload(storage, requestedRepoId);
      assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
      const allFindings = storage.listFindings(requestedRepoId);
      const filteredFindings = allFindings.filter((finding) =>
        (!requestedStatus || finding.status === requestedStatus) &&
        (!requestedSeverity || finding.severity === requestedSeverity) &&
        (!requestedDiffStatus || finding.diff_status === requestedDiffStatus) &&
        (!requestedConventionId || finding.convention_id === requestedConventionId) &&
        (!requestedPath || findingMatchesPath(finding, requestedPath))
      );
      const orderedFindings = orderFindingsForReview(filteredFindings);
      const findings = paginateFindings(orderedFindings, requestedLimit, requestedOffset);
      return {
        repo_id: requestedRepoId,
        policy,
        governance: preflightGovernance(),
        filters: {
          status: requestedStatus ?? null,
          severity: requestedSeverity ?? null,
          diff_status: requestedDiffStatus ?? null,
          convention_id: requestedConventionId ?? null,
          path: requestedPath ?? null
        },
        scan_status: scanStatus,
        freshness_requirement: freshnessRequirement(Boolean(require_fresh), scanStatus),
        summary: findingsSummary(allFindings, filteredFindings),
        pagination: paginationSummary(filteredFindings.length, findings.length, requestedLimit, requestedOffset),
        findings: findings.map(preflightFinding)
      };
    }),

    get_allowed_context: ({
      repo_id,
      path,
      surface = "mcp",
      requested_snippet_chars,
      request_full_file_content,
      require_fresh
    }) =>
      withStorage(options, (storage) => {
        const requestedRepoId = requiredMcpString(repo_id, "repo_id");
        const requestedPath = requiredRepoRelativeMcpPath(path);
        requiredMcpRepo(storage, requestedRepoId);
        const contract = requiredContract(storage.getRepoContract(requestedRepoId), requestedRepoId);
        const requestedSurface = validatePolicySurface(surface);
        const request = {
          path: requestedPath,
          surface: requestedSurface,
          requested_snippet_chars: requested_snippet_chars ?? null,
          request_full_file_content: request_full_file_content ?? false,
          require_fresh: require_fresh ?? false
        };
        const scanStatus = scanStatusPayload(storage, requestedRepoId);
        assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
        const freshness = freshnessRequirement(Boolean(require_fresh), scanStatus);
        const fileContext = policyFileContext(storage, requestedRepoId, requestedPath, contract);
        const decision = authorizeContextExport(contract, requestedSurface, {
          path: requestedPath,
          requested_snippet_chars,
          request_full_file_content
        });
        return {
          repo_id: requestedRepoId,
          path: requestedPath,
          request,
          governance: preflightGovernance(),
          scan_status: scanStatus,
          freshness_requirement: freshness,
          file_context: fileContext,
          redactions: {
            denied_globs: contract.context_egress.denied_globs,
            allow_full_file_content: contract.context_egress.allow_full_file_content,
            max_snippet_chars: contract.context_egress.max_snippet_chars
          },
          summary: policyContextSummary({
            decision,
            fileContext,
            freshness,
            deniedGlobCount: contract.context_egress.denied_globs.length
          }),
          decision,
          next_commands: policyContextNextCommands(requestedRepoId, requestedPath, decision)
        };
      })
  };
}

export function handleMcpJsonRpcRequest(
  options: DriftMcpOptions,
  request: JsonRpcRequest
): JsonRpcResponse | undefined {
  if (request.id === undefined && request.method.startsWith("notifications/")) {
    return undefined;
  }

  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: DRIFT_MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "drift-local",
          version: "0.1.0"
        }
      });
    }

    if (request.method === "tools/list") {
      return response(request.id, {
        tools: DRIFT_READ_ONLY_MCP_TOOLS
      });
    }

    if (request.method === "tools/call") {
      const params = objectParam(request.params);
      const name = stringParam(params, "name");
      const args = objectParam(params.arguments ?? {});
      const handlers = createReadOnlyMcpHandlers(options);
      if (!isReadOnlyToolName(name)) {
        throw new Error(`Unknown read-only Drift MCP tool: ${name}`);
      }

      validateMcpToolArguments(name, args);
      const result = handlers[name](args as never);
      return response(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: false
      });
    }

    return errorResponse(request.id, -32601, `Unsupported MCP method: ${request.method}`);
  } catch (error) {
    return errorResponse(
      request.id,
      -32000,
      error instanceof Error ? error.message : "Unknown Drift MCP error."
    );
  }
}

export async function runReadOnlyMcpStdioServer(
  options: DriftMcpOptions,
  io: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    error?: NodeJS.WritableStream;
  } = {}
): Promise<void> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const error = io.error ?? process.stderr;
  const lines = createInterface({ input });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      const result = handleMcpJsonRpcRequest(options, request);
      if (result) {
        output.write(`${JSON.stringify(result)}\n`);
      }
    } catch (parseError) {
      const result = errorResponse(
        null,
        -32700,
        parseError instanceof Error ? parseError.message : "Invalid JSON-RPC request."
      );
      output.write(`${JSON.stringify(result)}\n`);
      error.write("Drift MCP rejected an invalid JSON-RPC line.\n");
    }
  }
}

export async function runMcpCli(
  argv: string[],
  env: { DRIFT_DB?: string | undefined } = process.env,
  io: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    error?: NodeJS.WritableStream;
  } = {}
): Promise<McpCliResult> {
  const parsed = parseMcpCliArgs(argv);
  const output = io.output ?? process.stdout;
  const error = io.error ?? process.stderr;
  if (parsed.help) {
    output.write(mcpHelpText());
    return { exitCode: 0 };
  }
  if (parsed.version) {
    output.write(`${DRIFT_MCP_VERSION}\n`);
    return { exitCode: 0 };
  }
  if (parsed.error) {
    error.write(`${parsed.error}\n`);
    return { exitCode: 1 };
  }

  const databasePath = resolveMcpDatabasePath(argv, env);
  if (!databasePath) {
    error.write("Missing --db <path> or DRIFT_DB for drift-mcp.\n");
    return { exitCode: 1 };
  }

  await runReadOnlyMcpStdioServer({ databasePath }, io);
  return { exitCode: 0 };
}

function parseMcpCliArgs(argv: string[]): {
  help: boolean;
  version: boolean;
  error?: string;
} {
  let skipNext = false;
  for (const arg of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === "--db") {
      skipNext = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, version: false };
    }
    if (arg === "--version" || arg === "-v") {
      return { help: false, version: true };
    }
    if (arg.startsWith("-")) {
      return {
        help: false,
        version: false,
        error: `Unknown drift-mcp option: ${arg}`
      };
    }
  }
  return { help: false, version: false };
}

function mcpHelpText(): string {
  return [
    "Usage: drift-mcp --db <path>",
    "",
    "Run Drift's read-only MCP server over stdio.",
    "",
    "Options:",
    "  --db <path>     SQLite Drift state database.",
    "  --help, -h      Show this help.",
    "  --version, -v   Show the drift-mcp version.",
    "",
    "Environment:",
    "  DRIFT_DB        Fallback SQLite Drift state database path.",
    ""
  ].join("\n");
}

function withStorage<T>(options: DriftMcpOptions, fn: (storage: ReturnType<typeof openDriftStorage>) => T): T {
  const storage = openDriftStorage({ databasePath: options.databasePath });
  storage.migrate();
  try {
    return fn(storage);
  } finally {
    storage.close();
  }
}

function response(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result
  };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function objectParam(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object params.");
  }
  return value as Record<string, unknown>;
}

function stringParam(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string param: ${key}`);
  }
  return value.trim();
}

export function resolveMcpDatabasePath(
  argv: string[],
  env: { DRIFT_DB?: string | undefined } = process.env
): string | undefined {
  if (argv.includes("--db")) {
    return nonEmptyValue(flagValue(argv, "db"));
  }
  return nonEmptyValue(env.DRIFT_DB);
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function nonEmptyValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mcpRuntime(): {
  mcp_version: string;
  core_version: string;
  scanner_version: string;
  typescript_adapter_version: string;
  rule_engine_version: string;
  contract_schema_version: number;
  supported_sqlite_schema_version: number;
  storage_driver: "sqlite";
} {
  return {
    mcp_version: DRIFT_MCP_VERSION,
    core_version: DRIFT_CORE_VERSION,
    scanner_version: DRIFT_SCANNER_VERSION,
    typescript_adapter_version: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
    rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    supported_sqlite_schema_version: MIGRATIONS.length,
    storage_driver: "sqlite"
  };
}

function mcpV1Scope(): {
  product_mode: "local_first_cli";
  primary_wedge: "typescript_api_route_layering";
  mutation_model: "human_confirmed_governance_only";
  source_mutation: false;
  language_adapters: string[];
  deferred: string[];
} {
  return {
    product_mode: "local_first_cli",
    primary_wedge: "typescript_api_route_layering",
    mutation_model: "human_confirmed_governance_only",
    source_mutation: false,
    language_adapters: ["typescript"],
    deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"]
  };
}

function mcpCapabilities(): ReturnType<typeof createDriftCapabilities> {
  return createDriftCapabilities({
    mcpReadOnlyTools: DRIFT_READ_ONLY_MCP_TOOLS.map((tool) => tool.name)
  });
}

function isReadOnlyToolName(name: string): name is keyof DriftMcpHandlers {
  return DRIFT_READ_ONLY_MCP_TOOLS.some((tool) => tool.name === name);
}

function validateMcpToolArguments(name: keyof DriftMcpHandlers, args: Record<string, unknown>): void {
  const tool = DRIFT_READ_ONLY_MCP_TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unknown read-only Drift MCP tool: ${name}`);
  }

  for (const requiredField of tool.inputSchema.required) {
    if (!(requiredField in args)) {
      throw new Error(`Invalid arguments for ${name}: missing required field ${requiredField}.`);
    }
  }

  if (tool.inputSchema.additionalProperties === false) {
    for (const field of Object.keys(args)) {
      if (!(field in tool.inputSchema.properties)) {
        throw new Error(`Invalid arguments for ${name}: unexpected field ${field}.`);
      }
    }
  }

  for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
    if (!(field in args)) {
      continue;
    }
    const propertySchema = schema as { type?: string; enum?: string[] };
    if (propertySchema.type === "string" && typeof args[field] !== "string") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a string.`);
    }
    if (
      propertySchema.type === "string" &&
      typeof args[field] === "string" &&
      args[field].trim().length === 0
    ) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must not be empty.`);
    }
    if (
      (name === "get_allowed_context" || name === "get_repo_map" || name === "get_task_preflight" || name === "get_findings") &&
      field === "path" &&
      typeof args[field] === "string" &&
      !isRepoRelativeMcpPath(args[field].trim())
    ) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be repo-relative.`);
    }
    if (propertySchema.type === "number" && typeof args[field] !== "number") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a number.`);
    }
    if (field === "requested_snippet_chars" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a positive integer.`);
      }
    }
    if (field === "limit" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a positive integer.`);
      }
    }
    if (field === "offset" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a non-negative integer.`);
      }
    }
    if (propertySchema.type === "boolean" && typeof args[field] !== "boolean") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a boolean.`);
    }
    if (propertySchema.enum && !propertySchema.enum.includes(args[field] as string)) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be one of ${propertySchema.enum.join(", ")}.`);
    }
  }
}

function requiredContract(contract: RepoContract | undefined, repoId: string): RepoContract {
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  return contract;
}

function requiredMcpString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must not be empty.`);
  }
  return trimmed;
}

function optionalMcpString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredMcpString(value, field);
}

function optionalMcpPositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function optionalMcpNonNegativeInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return value;
}

function optionalMcpIsoTimestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = requiredMcpString(value, field);
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return trimmed;
}

function requiredRepoRelativeMcpPath(value: string): string {
  const trimmed = requiredMcpString(value, "path");
  if (!isRepoRelativeMcpPath(trimmed)) {
    throw new Error("path must be repo-relative.");
  }
  return trimmed;
}

function isRepoRelativeMcpPath(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes("..");
}

function requiredAuthorizedMcpContract(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  surface: PolicyDecision["surface"] = "mcp"
): { contract: RepoContract; policy: PolicyDecision } {
  requiredMcpRepo(storage, repoId);
  const contract = requiredContract(storage.getRepoContract(repoId), repoId);
  const policy = authorizeContextExport(contract, surface);
  if (!policy.allowed) {
    throw new Error(`Policy denied MCP output: ${policy.reason}`);
  }
  return { contract, policy };
}

function requiredMcpRepo(storage: ReturnType<typeof openDriftStorage>, repoId: string): void {
  if (!storage.getRepo(repoId)) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
}

function optionalAuthorizedMcpPolicy(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
): PolicyDecision | null {
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    return null;
  }
  return authorizeContextExport(contract, "mcp");
}

function scanStatusPayload(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const scans = storage.listScanManifests(repoId);
  const latestScan = latestIndexedScan(scans) ?? null;
  const indexedScanCount = scans.filter((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_restore_")
  ).length;
  const policy = optionalAuthorizedMcpPolicy(storage, repoId);
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const repoRootMissing = !existsSync(repo.root_path);
  const currentBranch = repoRootMissing
    ? "unknown"
    : gitOutput(repo.root_path, ["branch", "--show-current"]) || "unknown";
  const invalidationReasons = latestScan
    ? [
        ...(repoRootMissing ? ["repo_root_missing"] : []),
        ...scanInvalidationReasons(latestScan, { currentBranch })
      ]
    : [];
  const changes = latestScan
    ? repoRootMissing
      ? {
          added: [],
          modified: [],
          deleted: snapshots.map((snapshot) => snapshot.file_path).sort()
        }
      : compareSnapshotsToCurrentFiles(repo.root_path, snapshots)
    : emptyChanges();
  const stale = !latestScan ||
    invalidationReasons.length > 0 ||
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0;
  const sourceChangeCount = changes.added.length + changes.modified.length + changes.deleted.length;
  const auditIntegrity = storage.verifyAuditChain(repoId);
  const nextCommands = scanStatusNextCommands(repoId, repo.root_path, stale);

  return {
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    repo_root: repo.root_path,
    current_branch: currentBranch,
    latest_scan: latestScan,
    scan_fingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    audit_integrity: auditIntegrity,
    indexed_file_count: latestScan?.file_count ?? 0,
    source_change_count: sourceChangeCount,
    scan_count: indexedScanCount,
    summary: scanStatusSummary({
      latestScanId: latestScan?.id ?? null,
      scanCount: indexedScanCount,
      indexedFileCount: latestScan?.file_count ?? 0,
      sourceChangeCount,
      stale,
      invalidationCount: latestScan ? invalidationReasons.length : 1,
      auditValid: auditIntegrity.valid
    }),
    stale,
    invalidation_reasons: invalidationReasons,
    changes,
    next_command: nextCommands[0],
    next_commands: nextCommands
  };
}

function scanStatusSummary(options: {
  latestScanId: string | null;
  scanCount: number;
  indexedFileCount: number;
  sourceChangeCount: number;
  stale: boolean;
  invalidationCount: number;
  auditValid: boolean;
}): {
  latest_scan_id: string | null;
  scan_count: number;
  indexed_file_count: number;
  source_change_count: number;
  stale: boolean;
  invalidation_count: number;
  audit_valid: boolean;
} {
  return {
    latest_scan_id: options.latestScanId,
    scan_count: options.scanCount,
    indexed_file_count: options.indexedFileCount,
    source_change_count: options.sourceChangeCount,
    stale: options.stale,
    invalidation_count: options.invalidationCount,
    audit_valid: options.auditValid
  };
}

function scanStatusNextCommands(repoId: string, repoRoot: string, stale: boolean): string[] {
  return stale
    ? [
        `drift scan --repo-root ${repoRoot} --json`,
        `drift doctor --repo-root ${repoRoot} --json`
      ]
    : [
        `drift prepare "task" --repo ${repoId} --json`,
        `drift repo map --repo ${repoId} --json`,
        `drift audit verify --repo ${repoId} --json`
      ];
}

function auditVerifySummary(verification: AuditChainVerification): {
  valid: boolean;
  event_count: number;
  verified_count: number;
  broken_at_event_id: string | null;
  reason_count: number;
  head_event_hash: string | null;
} {
  return {
    valid: verification.valid,
    event_count: verification.event_count,
    verified_count: verification.verified_count,
    broken_at_event_id: verification.broken_at_event_id,
    reason_count: verification.reasons.length,
    head_event_hash: verification.head_event_hash
  };
}

function auditVerifyNextCommands(repoId: string, verification: AuditChainVerification): string[] {
  return verification.valid
    ? [
        `drift audit list --repo ${repoId} --json`,
        `drift backup create --repo ${repoId} --confirm --json`
      ]
    : [
        `drift audit list --repo ${repoId} --json`,
        `drift doctor --repo-root . --json`
      ];
}

function freshnessRequirement(
  required: boolean,
  scanStatus: ReturnType<typeof scanStatusPayload>
): {
  required: boolean;
  satisfied: boolean;
  next_command: string;
  invalidation_reasons: string[];
} {
  return {
    required,
    satisfied: !scanStatus.stale,
    next_command: scanStatus.next_command,
    invalidation_reasons: scanStatus.invalidation_reasons
  };
}

function assertFreshScanIfRequired(
  repoId: string,
  scanStatus: ReturnType<typeof scanStatusPayload>,
  required: boolean
): void {
  if (!required || !scanStatus.stale) {
    return;
  }
  throw new Error(
    `Scan is stale for ${repoId}. Run ${scanStatus.next_command}; omit require_fresh to inspect stale context.`
  );
}

function policyContextSummary(input: {
  decision: PolicyDecision;
  fileContext: ReturnType<typeof policyFileContext>;
  freshness: ReturnType<typeof freshnessRequirement>;
  deniedGlobCount: number;
}): {
  allowed: boolean;
  mode: PolicyDecision["mode"];
  surface: PolicyDecision["surface"];
  indexed: boolean;
  matched_convention_count: number;
  risky_area_count: number;
  open_finding_count: number;
  freshness_required: boolean;
  freshness_satisfied: boolean;
  denied_glob_count: number;
  approved_snippet_chars: number;
} {
  return {
    allowed: input.decision.allowed,
    mode: input.decision.mode,
    surface: input.decision.surface,
    indexed: input.fileContext.indexed,
    matched_convention_count: input.fileContext.convention_ids.length,
    risky_area_count: input.fileContext.risky_area_ids.length,
    open_finding_count: input.fileContext.open_finding_ids.length,
    freshness_required: input.freshness.required,
    freshness_satisfied: input.freshness.satisfied,
    denied_glob_count: input.deniedGlobCount,
    approved_snippet_chars: input.decision.approved_snippet_chars
  };
}

function policyContextNextCommands(repoId: string, contextPath: string, decision: PolicyDecision): string[] {
  if (!decision.allowed) {
    return [`drift policy show --repo ${repoId} --json`];
  }
  return [
    `drift prepare "task" --repo ${repoId} --path ${contextPath} --json`,
    `drift repo map --repo ${repoId} --path ${contextPath} --json`,
    `drift policy show --repo ${repoId} --json`
  ];
}

function policyFileContext(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  filePath: string,
  contract: RepoContract
): {
  path: string;
  indexed: boolean;
  roles: string[];
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
} {
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const file = repoMapFiles(snapshots, facts, contract, findings, graphMap?.files ?? [])
    .find((entry) => entry.path === filePath);
  if (!file) {
    return {
      path: filePath,
      indexed: false,
      roles: [],
      convention_ids: repoMapConventionIds(contract, filePath),
      risky_area_ids: repoMapRiskyAreaIds(contract, filePath),
      open_finding_ids: repoMapOpenFindingIds(findings, filePath)
    };
  }
  return {
    path: file.path,
    indexed: true,
    roles: file.roles,
    convention_ids: file.convention_ids,
    risky_area_ids: file.risky_area_ids,
    open_finding_ids: file.open_finding_ids
  };
}

function repoMapPayload(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  options: {
    surface: PolicyDecision["surface"];
    role?: FileRole;
    path?: string;
    requireFresh?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const { contract, policy } = requiredAuthorizedMcpContract(storage, repoId, options.surface);
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const allFiles = repoMapFiles(snapshots, facts, contract, findings, graphMap?.files ?? []);
  const files = allFiles.filter((file) =>
    (!options.role || file.roles.includes(options.role)) &&
    (!options.path || file.path === options.path || matchesPolicyGlob(file.path, options.path))
  );
  const offset = options.offset ?? 0;
  const listedFiles = paginateRepoMapFiles(files, options.limit, offset);
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, Boolean(options.requireFresh));
  return {
    repo_id: repoId,
    repo_root: repo.root_path,
    policy,
    governance: preflightGovernance(),
    latest_scan: latestScan ?? null,
    scan_fingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    scan_status: scanStatus,
    filters: {
      role: options.role ?? null,
      path: options.path ?? null
    },
    summary: repoMapSummary(allFiles, files, listedFiles),
    impact_summary: repoMapImpactSummary(listedFiles),
    pagination: paginationSummary(files.length, listedFiles.length, options.limit, offset),
    freshness_requirement: freshnessRequirement(Boolean(options.requireFresh), scanStatus),
    files: listedFiles,
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false
    },
    next_commands: [
      `drift prepare "task" --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]
  };
}

function repoMapFiles(
  snapshots: FileSnapshot[],
  facts: FactRecord[],
  contract: RepoContract,
  findings: Finding[],
  graphFiles: GraphRepoMapFile[] = []
): RepoMapFile[] {
  return decorateRepoMapFiles(
    mergeGraphAndFactRepoMapFiles(graphFiles, fallbackFactRepoMapFiles(snapshots, facts)),
    contract,
    findings
  );
}

function mergeGraphAndFactRepoMapFiles(graphFiles: GraphRepoMapFile[], factFiles: GraphRepoMapFile[]): GraphRepoMapFile[] {
  const factByPath = new Map(factFiles.map((file) => [file.path, file]));
  const graphByPath = new Map(graphFiles.map((file) => [file.path, file]));
  const paths = uniqueSorted([...graphByPath.keys(), ...factByPath.keys()]);
  return paths.map((path) => {
    const graphFile = graphByPath.get(path);
    const factFile = factByPath.get(path);
    if (!graphFile) {
      return factFile!;
    }
    if (!factFile) {
      return graphFile;
    }
    return {
      path,
      content_hash: graphFile.content_hash,
      byte_size: graphFile.byte_size,
      indexed: graphFile.indexed,
      roles: uniqueSorted([...graphFile.roles, ...factFile.roles]),
      imports: uniqueSorted([...graphFile.imports, ...factFile.imports]),
      exported_symbols: uniqueSorted([...graphFile.exported_symbols, ...factFile.exported_symbols]),
      calls: uniqueSorted([...graphFile.calls, ...factFile.calls]),
      graph_node_ids: uniqueSorted([...graphFile.graph_node_ids, ...factFile.graph_node_ids]),
      evidence_ids: uniqueSorted([...graphFile.evidence_ids, ...factFile.evidence_ids]),
      fact_count: Math.max(graphFile.fact_count, factFile.fact_count)
    };
  });
}

function decorateRepoMapFiles(
  files: GraphRepoMapFile[],
  contract: RepoContract,
  findings: Finding[]
): RepoMapFile[] {
  return files.map((file) => ({
    path: file.path,
    content_hash: file.content_hash,
    byte_size: file.byte_size,
    indexed: file.indexed,
    roles: file.roles,
    imports: file.imports,
    exported_symbols: file.exported_symbols,
    calls: file.calls,
    convention_ids: repoMapConventionIds(contract, file.path),
    risky_area_ids: repoMapRiskyAreaIds(contract, file.path),
    open_finding_ids: repoMapOpenFindingIds(findings, file.path),
    fact_count: file.fact_count
  })).sort((left, right) => left.path.localeCompare(right.path));
}

function repoMapConventionIds(contract: RepoContract, filePath: string): string[] {
  return uniqueSorted(contract.conventions
    .filter((convention) =>
      convention.scope.path_globs.some((glob) => matchesPolicyGlob(filePath, glob)) &&
      !(convention.scope.exclude_path_globs ?? []).some((glob) => matchesPolicyGlob(filePath, glob))
    )
    .map((convention) => convention.id));
}

function repoMapRiskyAreaIds(contract: RepoContract, filePath: string): string[] {
  return uniqueSorted(contract.risky_areas
    .filter((area) => area.path_globs.some((glob) => matchesPolicyGlob(filePath, glob)))
    .map((area) => area.id));
}

function repoMapOpenFindingIds(findings: Finding[], filePath: string): string[] {
  return uniqueSorted(findings
    .filter((finding) =>
      isOpenPreflightFinding(finding) &&
      finding.evidence_refs.some((ref) => ref.file_path === filePath)
    )
    .map((finding) => finding.id));
}

function findingMatchesPath(finding: Finding, path: string): boolean {
  return finding.evidence_refs.some((ref) =>
    ref.file_path === path ||
    matchesPolicyGlob(ref.file_path, path)
  );
}

function orderFindingsForReview(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function paginateFindings(findings: Finding[], limit: number | undefined, offset: number): Finding[] {
  return limit === undefined
    ? findings.slice(offset)
    : findings.slice(offset, offset + limit);
}

function orderAcceptedConventionsForReview(conventions: AcceptedConvention[]): AcceptedConvention[] {
  return [...conventions].sort((left, right) =>
    left.accepted_at.localeCompare(right.accepted_at) ||
    left.id.localeCompare(right.id)
  );
}

function paginateAcceptedConventions(
  conventions: AcceptedConvention[],
  limit: number | undefined,
  offset: number
): AcceptedConvention[] {
  return limit === undefined
    ? conventions.slice(offset)
    : conventions.slice(offset, offset + limit);
}

function paginateRepoMapFiles(files: RepoMapFile[], limit: number | undefined, offset: number): RepoMapFile[] {
  return limit === undefined
    ? files.slice(offset)
    : files.slice(offset, offset + limit);
}

function paginationSummary(total: number, returnedCount: number, limit: number | undefined, offset: number): {
  limit: number | null;
  offset: number;
  returned_count: number;
  has_more: boolean;
  next_offset: number | null;
} {
  const nextOffset = offset + returnedCount;
  const hasMore = nextOffset < total;
  return {
    limit: limit ?? null,
    offset,
    returned_count: returnedCount,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null
  };
}

function repoMapImpactSummary(files: RepoMapFile[]): {
  convention_coverage_count: number;
  risky_file_count: number;
  open_finding_count: number;
} {
  return {
    convention_coverage_count: files.filter((file) => file.convention_ids.length > 0).length,
    risky_file_count: files.filter((file) => file.risky_area_ids.length > 0).length,
    open_finding_count: files.reduce((count, file) => count + file.open_finding_ids.length, 0)
  };
}

function repoMapSummary(allFiles: RepoMapFile[], filteredFiles: RepoMapFile[], listedFiles: RepoMapFile[]): {
  indexed_file_count: number;
  filtered_file_count: number;
  listed_file_count: number;
  role_counts: Record<string, number>;
  import_count: number;
  export_count: number;
  call_count: number;
} {
  const roleCounts: Record<string, number> = {};
  for (const file of listedFiles) {
    for (const role of file.roles) {
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
  }
  return {
    indexed_file_count: allFiles.length,
    filtered_file_count: filteredFiles.length,
    listed_file_count: listedFiles.length,
    role_counts: roleCounts,
    import_count: listedFiles.reduce((count, file) => count + file.imports.length, 0),
    export_count: listedFiles.reduce((count, file) => count + file.exported_symbols.length, 0),
    call_count: listedFiles.reduce((count, file) => count + file.calls.length, 0)
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function latestIndexedScan(scans: ScanManifest[]): ScanManifest | undefined {
  return scans.find((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_check_")
  ) ?? scans.find((scan) => scan.status === "completed") ?? scans[0];
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function scanInvalidationReasons(scan: ScanManifest, input: { currentBranch?: string } = {}): string[] {
  const reasons: string[] = [];
  if (input.currentBranch && scan.branch !== input.currentBranch) {
    reasons.push("branch_changed");
  }
  if (scan.scanner_version !== DRIFT_SCANNER_VERSION) {
    reasons.push("scanner_version_changed");
  }
  if (scan.adapter_versions.typescript !== DRIFT_TYPESCRIPT_ADAPTER_VERSION) {
    reasons.push("adapter_version_changed:typescript");
  }
  if (scan.rule_engine_version !== DRIFT_RULE_ENGINE_VERSION) {
    reasons.push("rule_engine_version_changed");
  }
  return reasons;
}

function emptyChanges(): { added: string[]; modified: string[]; deleted: string[] } {
  return { added: [], modified: [], deleted: [] };
}

function compareSnapshotsToCurrentFiles(
  repoRoot: string,
  snapshots: FileSnapshot[]
): { added: string[]; modified: string[]; deleted: string[] } {
  if (!existsSync(repoRoot)) {
    return emptyChanges();
  }

  const previous = new Map(snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const currentFiles = walkIndexableFiles(repoRoot);
  const current = new Set(currentFiles);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const filePath of currentFiles) {
    const snapshot = previous.get(filePath);
    if (!snapshot) {
      added.push(filePath);
      continue;
    }
    if (fileContentHash(join(repoRoot, filePath)) !== snapshot.content_hash) {
      modified.push(filePath);
    }
  }

  for (const filePath of previous.keys()) {
    if (!current.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort()
  };
}

function walkIndexableFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipPath(entry.name)) {
        continue;
      }

      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && isTypescriptPath(entry.name)) {
        files.push(relative(repoRoot, absolutePath).replaceAll("\\", "/"));
      }
    }
  };
  visit(repoRoot);
  return files.sort();
}

function shouldSkipPath(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "target",
    "vendor"
  ].includes(name);
}

function isTypescriptPath(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

function fileContentHash(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function contractFingerprint(contract: RepoContract): string {
  return createHash("sha256").update(canonicalRepoContractJson(contract)).digest("hex");
}

function scanFingerprint(manifest: ScanManifest, snapshots: FileSnapshot[]): string {
  return createHash("sha256").update(canonicalScanStateJson({ manifest, snapshots })).digest("hex");
}

function baselineSummary(storage: ReturnType<typeof openDriftStorage>, repoId: string): {
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
  const rows = storage.listBaselineViolations(repoId);
  const byConvention = new Map<string, { active_count: number; resolved_count: number }>();
  for (const row of rows) {
    const counts = byConvention.get(row.convention_id) ?? { active_count: 0, resolved_count: 0 };
    if (row.status === "active") {
      counts.active_count += 1;
    } else {
      counts.resolved_count += 1;
    }
    byConvention.set(row.convention_id, counts);
  }

  return {
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };
}

function relevantFilesForTask(input: {
  repoRoot: string;
  task: string;
  contract: RepoContract;
  targetPath?: string;
}): RelevantFile[] {
  const tokens = tokenizeTask(input.task);
  const deniedGlobs = input.contract.context_egress.denied_globs;
  if (!existsSync(input.repoRoot)) {
    return input.targetPath
      ? [relevantFileForPath(input.targetPath, tokens, input.contract, "requested path")].filter(
          (file): file is RelevantFile => Boolean(file)
        )
      : [];
  }
  const files = walkIndexableFiles(input.repoRoot)
    .filter((filePath) => !deniedGlobs.some((glob) => matchesPolicyGlob(filePath, glob)))
    .map((filePath) => relevantFileForPath(filePath, tokens, input.contract))
    .filter((file): file is RelevantFile => Boolean(file))
    .slice(0, 25);
  if (
    input.targetPath &&
    !deniedGlobs.some((glob) => matchesPolicyGlob(input.targetPath!, glob)) &&
    !files.some((file) => file.path === input.targetPath)
  ) {
    const targetFile = relevantFileForPath(input.targetPath, tokens, input.contract, "requested path");
    if (targetFile) {
      files.unshift(targetFile);
    }
  } else if (input.targetPath) {
    const existing = files.find((file) => file.path === input.targetPath);
    if (existing && !existing.reasons.includes("requested path")) {
      existing.reasons = uniqueSorted([...existing.reasons, "requested path"]);
    }
  }
  return files.slice(0, 25);
}

function relevantFileForPath(
  filePath: string,
  tokens: Set<string>,
  contract: RepoContract,
  forcedReason?: string
): RelevantFile | undefined {
  const reasons = new Set<string>();
  const roles = new Set<string>();
  if (forcedReason) {
    reasons.add(forcedReason);
  }
  if (isApiRoutePath(filePath)) {
    roles.add("api_route");
  }

  for (const token of tokens) {
    if (filePath.toLowerCase().includes(token)) {
      reasons.add(`task token: ${token}`);
    }
  }

  for (const convention of contract.conventions) {
    const inScope = convention.scope.path_globs.some((glob) => matchesPolicyGlob(filePath, glob));
    if (inScope) {
      reasons.add(`in scope for ${convention.id}`);
      for (const role of convention.scope.file_roles ?? []) {
        roles.add(role);
      }
    }
  }

  if (reasons.size === 0) {
    return undefined;
  }
  return {
    path: filePath,
    roles: [...roles].sort(),
    reasons: [...reasons].sort()
  };
}

function riskyAreasForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): PreparedRiskArea[] {
  return contract.risky_areas.flatMap((area) => {
    const matchedFiles = relevantFiles
      .filter((file) => area.path_globs.some((glob) => matchesPolicyGlob(file.path, glob)))
      .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...area, matched_files: matchedFiles }] : [];
  });
}

function waiversForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[],
  now: string
): PreparedWaiver[] {
  return contract.waivers.flatMap((waiver) => {
    if (waiverStatus(waiver, now) !== "active") {
      return [];
    }
    const pathGlobs = waiver.path_globs ?? [];
    const matchedFiles = pathGlobs.length === 0
      ? relevantFiles.map((file) => file.path)
      : relevantFiles
          .filter((file) => pathGlobs.some((glob) => matchesPolicyGlob(file.path, glob)))
          .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...waiver, status: "active", matched_files: matchedFiles }] : [];
  });
}

function waiverStatus(
  waiver: RepoContract["waivers"][number],
  now: string
): "active" | "expired" {
  return waiver.expires_at && waiver.expires_at <= now ? "expired" : "active";
}

function requiredChecksForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): PreparedRequiredCheck[] {
  return contract.required_checks.flatMap((check) => {
    const matchedFiles = relevantFiles
      .filter((file) => requiredCheckMatchesFile(check, file.path, file.roles))
      .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...check, matched_files: matchedFiles }] : [];
  });
}

function requiredCheckMatchesFile(
  check: RepoContract["required_checks"][number],
  filePath: string,
  roles: string[]
): boolean {
  return scopeMatchesFile(check.applies_to, filePath, roles);
}

function scopeMatchesFile(
  scope: RepoContract["required_checks"][number]["applies_to"],
  filePath: string,
  roles: string[]
): boolean {
  if ((scope.exclude_path_globs ?? []).some((glob) => matchesPolicyGlob(filePath, glob))) {
    return false;
  }
  const pathMatches = scope.path_globs.length === 0 ||
    scope.path_globs.some((glob) => matchesPolicyGlob(filePath, glob));
  const roleMatches = !scope.file_roles?.length ||
    scope.file_roles.some((role) => roles.includes(role));
  return pathMatches && roleMatches;
}

function contractSummary(contract: RepoContract): {
  convention_count: number;
  risky_area_count: number;
  required_check_count: number;
  safe_command_count: number;
  waiver_count: number;
  rejected_inference_count: number;
} {
  return {
    convention_count: contract.conventions.length,
    risky_area_count: contract.risky_areas.length,
    required_check_count: contract.required_checks.length,
    safe_command_count: contract.safe_commands.length,
    waiver_count: contract.waivers.length,
    rejected_inference_count: contract.rejected_inferences.length
  };
}

function conventionSummary(
  allConventions: AcceptedConvention[],
  filteredConventions: AcceptedConvention[],
  listedConventions: AcceptedConvention[]
): {
  total_count: number;
  filtered_count: number;
  listed_count: number;
  deterministic_count: number;
  heuristic_count: number;
  briefing_only_count: number;
  blocking_count: number;
} {
  return {
    total_count: allConventions.length,
    filtered_count: filteredConventions.length,
    listed_count: listedConventions.length,
    deterministic_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "deterministic_check"
    ).length,
    heuristic_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "heuristic_check"
    ).length,
    briefing_only_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "briefing_only"
    ).length,
    blocking_count: allConventions.filter((convention) =>
      convention.enforcement_mode === "block"
    ).length
  };
}

function preflightSummary(input: {
  conventions: AcceptedConvention[];
  relevantFiles: RelevantFile[];
  riskyAreas: PreparedRiskArea[];
  waivers: PreparedWaiver[];
  findings: Array<{ enforcement_result: Finding["enforcement_result"] }>;
  requiredChecks: PreparedRequiredCheck[];
  safeCommands: RepoContract["safe_commands"];
  baseline: ReturnType<typeof baselineSummary>;
  scanStatus: ReturnType<typeof scanStatusPayload>;
}): {
  convention_count: number;
  relevant_file_count: number;
  risky_area_count: number;
  waiver_count: number;
  finding_count: number;
  blocking_finding_count: number;
  required_check_count: number;
  safe_command_count: number;
  baseline_active_count: number;
  scan_stale: boolean;
} {
  return {
    convention_count: input.conventions.length,
    relevant_file_count: input.relevantFiles.length,
    risky_area_count: input.riskyAreas.length,
    waiver_count: input.waivers.length,
    finding_count: input.findings.length,
    blocking_finding_count: input.findings.filter((finding) =>
      finding.enforcement_result === "block"
    ).length,
    required_check_count: input.requiredChecks.length,
    safe_command_count: input.safeCommands.length,
    baseline_active_count: input.baseline.active_count,
    scan_stale: input.scanStatus.stale
  };
}

function preflightGovernance(): {
  read_only: true;
  agent_can_mutate: false;
  allowed_agent_actions: string[];
  human_approval_required_for: string[];
} {
  return {
    read_only: true,
    agent_can_mutate: false,
    allowed_agent_actions: ["read_context", "request_preflight", "propose_resolution"],
    human_approval_required_for: [
      "accept_convention",
      "reject_convention",
      "edit_convention",
      "add_exception",
      "add_contract_waiver",
      "mark_needs_review",
      "suppress_finding",
      "accept_drift",
      "mark_false_positive",
      "change_policy",
      "grant_agent_permission",
      "export_contract",
      "import_contract",
      "create_backup",
      "restore_backup"
    ]
  };
}

function isOpenPreflightFinding(finding: Finding): boolean {
  return !["fixed", "false_positive", "suppressed", "accepted_drift", "expired"].includes(finding.status);
}

function preflightConvention(convention: AcceptedConvention): {
  id: string;
  kind: AcceptedConvention["kind"];
  statement: string;
  severity: Severity;
  enforcement_mode: AcceptedConvention["enforcement_mode"];
  enforcement_capability: AcceptedConvention["enforcement_capability"];
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  exceptions: AcceptedConvention["exceptions"];
  agent_instruction: string;
} {
  return {
    id: convention.id,
    kind: convention.kind,
    statement: convention.statement,
    severity: convention.severity,
    enforcement_mode: convention.enforcement_mode,
    enforcement_capability: convention.enforcement_capability,
    scope: convention.scope,
    matcher: convention.matcher,
    exceptions: convention.exceptions,
    agent_instruction: instructionForConvention(convention)
  };
}

function instructionForConvention(convention: AcceptedConvention): string {
  if (convention.kind === "api_route_no_direct_data_access") {
    const forbidden = (convention.matcher.forbidden_imports ?? []).join(", ");
    return [
      "When editing API route files, do not import data-access clients directly.",
      forbidden ? `Forbidden imports: ${forbidden}.` : "",
      "Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
    ].filter(Boolean).join(" ");
  }

  if (convention.kind === "api_route_requires_service_delegation") {
    const delegates = (convention.matcher.allowed_delegate_imports ?? []).join(", ");
    return [
      "When editing API route files, keep route modules thin and delegate business/data-access work to the service layer.",
      delegates ? `Observed delegate imports: ${delegates}.` : "",
      "Treat this as briefing guidance unless the repo later upgrades it to a deterministic check."
    ].filter(Boolean).join(" ");
  }

  return `${convention.statement} Follow its scope, matcher, and exceptions.`;
}

function preflightFinding(finding: Finding): Pick<
  Finding,
  "id" | "convention_id" | "title" | "severity" | "status" | "diff_status" | "enforcement_result"
> & {
  evidence_ref_count: number;
  first_evidence: Pick<Finding["evidence_refs"][number], "file_path" | "start_line" | "import_source" | "symbol"> | null;
} {
  const firstEvidence = finding.evidence_refs[0] ?? null;
  return {
    id: finding.id,
    convention_id: finding.convention_id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    diff_status: finding.diff_status,
    enforcement_result: finding.enforcement_result,
    evidence_ref_count: finding.evidence_refs.length,
    first_evidence: firstEvidence
      ? {
          file_path: firstEvidence.file_path,
          start_line: firstEvidence.start_line,
          import_source: firstEvidence.import_source,
          symbol: firstEvidence.symbol
        }
      : null
  };
}

function tokenizeTask(task: string): Set<string> {
  return new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function countDeniedFiles(repoRoot: string, deniedGlobs: string[]): number {
  if (deniedGlobs.length === 0 || !existsSync(repoRoot)) {
    return 0;
  }
  return walkIndexableFiles(repoRoot).filter((filePath) =>
    deniedGlobs.some((glob) => matchesPolicyGlob(filePath, glob))
  ).length;
}

function isApiRoutePath(filePath: string): boolean {
  return /(^|\/)(app|pages)\/api\/.+\.(ts|tsx|js|jsx)$/.test(filePath) ||
    /(^|\/)route\.(ts|tsx|js|jsx)$/.test(filePath);
}

function findingsSummary(allFindings: Finding[], filteredFindings: Finding[]): {
  total_count: number;
  filtered_count: number;
  by_status: Partial<Record<FindingStatus, number>>;
  by_severity: Partial<Record<Severity, number>>;
  by_diff_status: Partial<Record<FindingDiffStatus, number>>;
} {
  return {
    total_count: allFindings.length,
    filtered_count: filteredFindings.length,
    by_status: countBy(allFindings, (finding) => finding.status),
    by_severity: countBy(allFindings, (finding) => finding.severity),
    by_diff_status: countBy(allFindings, (finding) => finding.diff_status)
  };
}

function validateFindingStatus(status: FindingStatus | undefined): FindingStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (
    status === "new" ||
    status === "pre_existing" ||
    status === "needs_review" ||
    status === "fixed" ||
    status === "false_positive" ||
    status === "accepted_drift" ||
    status === "suppressed" ||
    status === "expired"
  ) {
    return status;
  }
  throw new Error("status must be new, pre_existing, needs_review, fixed, false_positive, accepted_drift, suppressed, or expired.");
}

function validateSeverity(severity: Severity | undefined): Severity | undefined {
  if (!severity) {
    return undefined;
  }
  if (severity === "info" || severity === "warning" || severity === "error") {
    return severity;
  }
  throw new Error("severity must be info, warning, or error.");
}

function validateConventionKind(kind: ConventionKind | undefined): ConventionKind | undefined {
  if (!kind) {
    return undefined;
  }
  if (
    kind === "api_route_no_direct_data_access" ||
    kind === "api_route_requires_service_delegation" ||
    kind === "api_route_requires_auth_helper" ||
    kind === "test_expected_for_changed_module" ||
    kind === "custom_briefing"
  ) {
    return kind;
  }
  throw new Error("kind must be api_route_no_direct_data_access, api_route_requires_service_delegation, api_route_requires_auth_helper, test_expected_for_changed_module, or custom_briefing.");
}

function validateEnforcementCapability(capability: EnforcementCapability | undefined): EnforcementCapability | undefined {
  if (!capability) {
    return undefined;
  }
  if (capability === "briefing_only" || capability === "heuristic_check" || capability === "deterministic_check") {
    return capability;
  }
  throw new Error("capability must be briefing_only, heuristic_check, or deterministic_check.");
}

function validateFindingDiffStatus(diffStatus: FindingDiffStatus | undefined): FindingDiffStatus | undefined {
  if (!diffStatus) {
    return undefined;
  }
  if (diffStatus === "new_in_diff" || diffStatus === "touched_existing" || diffStatus === "outside_diff") {
    return diffStatus;
  }
  throw new Error("diff_status must be new_in_diff, touched_existing, or outside_diff.");
}

function validatePolicySurface(surface: PolicyDecision["surface"]): PolicyDecision["surface"] {
  if (
    surface === "cli-preflight" ||
    surface === "cli-check" ||
    surface === "mcp" ||
    surface === "contract-export" ||
    surface === "artifact" ||
    surface === "log" ||
    surface === "ui"
  ) {
    return surface;
  }
  throw new Error("surface must be cli-preflight, cli-check, mcp, contract-export, artifact, log, or ui.");
}

function countBy<T, K extends string>(
  entries: T[],
  keyFor: (entry: T) => K
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const entry of entries) {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
