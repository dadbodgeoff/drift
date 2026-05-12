import type { FileSnapshot, Finding, FindingStatus, PolicyDecision, RepoContract, ScanManifest, Severity } from "@drift/core";
import { authorizeContextExport, matchesPolicyGlob } from "@drift/core";
import {
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION
} from "@drift/core";
import { openDriftStorage } from "@drift/storage";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";

export interface DriftMcpOptions {
  databasePath: string;
}

export interface DriftMcpHandlers {
  get_scan_status(input: { repo_id: string }): unknown;
  get_repo_contract(input: { repo_id: string }): unknown;
  get_task_preflight(input: { repo_id: string; task: string }): unknown;
  get_conventions(input: { repo_id: string }): unknown;
  get_findings(input: { repo_id: string; status?: FindingStatus; severity?: Severity }): unknown;
  get_allowed_context(input: {
    repo_id: string;
    path: string;
    surface?: PolicyDecision["surface"];
    requested_snippet_chars?: number;
    request_full_file_content?: boolean;
  }): unknown;
}

export interface DriftMcpTool {
  name: keyof DriftMcpHandlers;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

interface RelevantFile {
  path: string;
  roles: string[];
  reasons: string[];
}

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export const DRIFT_MCP_PROTOCOL_VERSION = "2024-11-05";

export const DRIFT_READ_ONLY_MCP_TOOLS: DriftMcpTool[] = [
  {
    name: "get_scan_status",
    description: "Return the latest Drift scan status for a repo.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_repo_contract",
    description: "Return the approved repo contract, policy, and conventions.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_task_preflight",
    description: "Return policy-filtered conventions and findings relevant to a task.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        task: { type: "string" }
      },
      required: ["repo_id", "task"],
      additionalProperties: false
    }
  },
  {
    name: "get_conventions",
    description: "Return accepted conventions for a repo.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_findings",
    description: "Return stored Drift findings for a repo, with optional review filters.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        status: {
          type: "string",
          enum: [
            "new",
            "pre_existing",
            "needs_review",
            "fixed",
            "false_positive",
            "accepted_drift",
            "suppressed"
          ]
        },
        severity: {
          type: "string",
          enum: ["info", "warning", "error"]
        }
      },
      required: ["repo_id"],
      additionalProperties: false
    }
  },
  {
    name: "get_allowed_context",
    description: "Check whether a path can be exposed through an agent-facing surface.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        path: { type: "string" },
        surface: {
          type: "string",
          enum: ["cli-preflight", "cli-check", "mcp", "contract-export", "artifact", "log", "ui"]
        },
        requested_snippet_chars: { type: "number" },
        request_full_file_content: { type: "boolean" }
      },
      required: ["repo_id", "path"],
      additionalProperties: false
    }
  }
];

export function createReadOnlyMcpHandlers(options: DriftMcpOptions): DriftMcpHandlers {
  return {
    get_scan_status: ({ repo_id }) => withStorage(options, (storage) => scanStatusPayload(storage, repo_id)),

    get_repo_contract: ({ repo_id }) => withStorage(options, (storage) => {
      const { contract, policy } = requiredAuthorizedMcpContract(storage, repo_id);
      return {
        repo_id,
        policy,
        contract
      };
    }),

    get_task_preflight: ({ repo_id, task }) => withStorage(options, (storage) => {
      const { contract, policy } = requiredAuthorizedMcpContract(storage, repo_id);
      const now = new Date().toISOString();
      const activeConventions = contract.conventions.filter((convention) =>
        !convention.expires_at || convention.expires_at > now
      );
      const relevantFiles = relevantFilesForTask({
        repoRoot: storage.getRepo(repo_id)!.root_path,
        task,
        contract: { ...contract, conventions: activeConventions }
      });
      return {
        repo_id,
        task,
        policy,
        contract: {
          id: contract.id,
          schema_version: contract.contract_schema_version,
          updated_at: contract.updated_at
        },
        conventions: activeConventions.map((convention) => ({
          id: convention.id,
          kind: convention.kind,
          statement: convention.statement,
          enforcement_mode: convention.enforcement_mode,
          enforcement_capability: convention.enforcement_capability,
          scope: convention.scope,
          matcher: convention.matcher,
          exceptions: convention.exceptions
        })),
        scan_status: scanStatusPayload(storage, repo_id),
        baseline: baselineSummary(storage, repo_id),
        findings: storage.listFindings(repo_id)
          .filter(isOpenPreflightFinding)
          .map(preflightFinding),
        relevant_files: relevantFiles,
        risky_areas: riskyAreasForFiles(contract, relevantFiles),
        required_checks: contract.required_checks,
        safe_commands: contract.safe_commands,
        redactions: {
          denied_globs: contract.context_egress.denied_globs,
          excluded_file_count: countDeniedFiles(storage.getRepo(repo_id)!.root_path, contract.context_egress.denied_globs),
          snippets_included: false
        },
        next_commands: [
          `drift check --repo ${repo_id} --diff main...HEAD --scope changed-hunks --json`,
          `drift findings list --repo ${repo_id} --json`
        ]
      };
    }),

    get_conventions: ({ repo_id }) => withStorage(options, (storage) => {
      const { policy } = requiredAuthorizedMcpContract(storage, repo_id);
      return {
        repo_id,
        policy,
        conventions: storage.listAcceptedConventions(repo_id)
      };
    }),

    get_findings: ({ repo_id, status, severity }) => withStorage(options, (storage) => {
      const { policy } = requiredAuthorizedMcpContract(storage, repo_id);
      const requestedStatus = validateFindingStatus(status);
      const requestedSeverity = validateSeverity(severity);
      const allFindings = storage.listFindings(repo_id);
      const findings = allFindings.filter((finding) =>
        (!requestedStatus || finding.status === requestedStatus) &&
        (!requestedSeverity || finding.severity === requestedSeverity)
      );
      return {
        repo_id,
        policy,
        summary: findingsSummary(allFindings, findings),
        findings
      };
    }),

    get_allowed_context: ({
      repo_id,
      path,
      surface = "mcp",
      requested_snippet_chars,
      request_full_file_content
    }) =>
      withStorage(options, (storage) => {
        requiredMcpRepo(storage, repo_id);
        const contract = requiredContract(storage.getRepoContract(repo_id), repo_id);
        const requestedSurface = validatePolicySurface(surface);
        return {
          repo_id,
          path,
          decision: authorizeContextExport(contract, requestedSurface, {
            path,
            requested_snippet_chars,
            request_full_file_content
          })
        };
      })
  };
}

export function handleMcpJsonRpcRequest(
  options: DriftMcpOptions,
  request: JsonRpcRequest
): JsonRpcResponse | undefined {
  if (!request.id && request.method.startsWith("notifications/")) {
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

function withStorage<T>(options: DriftMcpOptions, fn: (storage: ReturnType<typeof openDriftStorage>) => T): T {
  const storage = openDriftStorage({ databasePath: options.databasePath });
  storage.migrate();
  try {
    return fn(storage);
  } finally {
    storage.close();
  }
}

function repoOnlySchema(): DriftMcpTool["inputSchema"] {
  return {
    type: "object",
    properties: {
      repo_id: { type: "string" }
    },
    required: ["repo_id"],
    additionalProperties: false
  };
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
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string param: ${key}`);
  }
  return value;
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
    if (propertySchema.type === "number" && typeof args[field] !== "number") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a number.`);
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

function requiredAuthorizedMcpContract(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
): { contract: RepoContract; policy: PolicyDecision } {
  requiredMcpRepo(storage, repoId);
  const contract = requiredContract(storage.getRepoContract(repoId), repoId);
  const policy = authorizeContextExport(contract, "mcp");
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
  const latestScan = scans[0] ?? null;
  const policy = optionalAuthorizedMcpPolicy(storage, repoId);
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const repoRootMissing = !existsSync(repo.root_path);
  const invalidationReasons = latestScan
    ? [
        ...(repoRootMissing ? ["repo_root_missing"] : []),
        ...scanInvalidationReasons(latestScan)
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

  return {
    repo_id: repoId,
    policy,
    repo_root: repo.root_path,
    latest_scan: latestScan,
    scan_count: scans.length,
    stale: !latestScan ||
      invalidationReasons.length > 0 ||
      changes.added.length > 0 ||
      changes.modified.length > 0 ||
      changes.deleted.length > 0,
    invalidation_reasons: invalidationReasons,
    changes
  };
}

function scanInvalidationReasons(scan: ScanManifest): string[] {
  const reasons: string[] = [];
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
}): RelevantFile[] {
  const tokens = tokenizeTask(input.task);
  const deniedGlobs = input.contract.context_egress.denied_globs;
  if (!existsSync(input.repoRoot)) {
    return [];
  }
  return walkIndexableFiles(input.repoRoot)
    .filter((filePath) => !deniedGlobs.some((glob) => matchesPolicyGlob(filePath, glob)))
    .map((filePath) => relevantFileForPath(filePath, tokens, input.contract))
    .filter((file): file is RelevantFile => Boolean(file))
    .slice(0, 25);
}

function relevantFileForPath(
  filePath: string,
  tokens: Set<string>,
  contract: RepoContract
): RelevantFile | undefined {
  const reasons = new Set<string>();
  const roles = new Set<string>();
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
): RepoContract["risky_areas"] {
  const relevantPaths = relevantFiles.map((file) => file.path);
  return contract.risky_areas.filter((area) =>
    relevantPaths.some((filePath) =>
      area.path_globs.some((glob) => matchesPolicyGlob(filePath, glob))
    )
  );
}

function isOpenPreflightFinding(finding: Finding): boolean {
  return !["fixed", "false_positive", "suppressed", "accepted_drift"].includes(finding.status);
}

function preflightFinding(finding: Finding): Pick<
  Finding,
  "id" | "convention_id" | "title" | "severity" | "status" | "diff_status" | "enforcement_result"
> {
  return {
    id: finding.id,
    convention_id: finding.convention_id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    diff_status: finding.diff_status,
    enforcement_result: finding.enforcement_result
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
} {
  return {
    total_count: allFindings.length,
    filtered_count: filteredFindings.length,
    by_status: countBy(allFindings, (finding) => finding.status),
    by_severity: countBy(allFindings, (finding) => finding.severity)
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
    status === "suppressed"
  ) {
    return status;
  }
  throw new Error("status must be new, pre_existing, needs_review, fixed, false_positive, accepted_drift, or suppressed.");
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
