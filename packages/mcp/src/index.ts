import type { Finding, FindingStatus, PolicyDecision, RepoContract, ScanManifest, Severity } from "@drift/core";
import { authorizeContextExport } from "@drift/core";
import {
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION
} from "@drift/core";
import { openDriftStorage } from "@drift/storage";
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
        }
      },
      required: ["repo_id", "path"],
      additionalProperties: false
    }
  }
];

export function createReadOnlyMcpHandlers(options: DriftMcpOptions): DriftMcpHandlers {
  return {
    get_scan_status: ({ repo_id }) => withStorage(options, (storage) => {
      const repo = storage.getRepo(repo_id);
      const scans = storage.listScanManifests(repo_id);
      const latestScan = scans[0] ?? null;
      const invalidationReasons = latestScan ? scanInvalidationReasons(latestScan) : [];
      const policy = optionalAuthorizedMcpPolicy(storage, repo_id);
      return {
        repo_id,
        policy,
        repo_root: repo?.root_path ?? null,
        latest_scan: latestScan,
        scan_count: scans.length,
        stale: !latestScan || invalidationReasons.length > 0,
        invalidation_reasons: invalidationReasons
      };
    }),

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
      return {
        repo_id,
        task,
        policy,
        contract: {
          id: contract.id,
          schema_version: contract.contract_schema_version,
          updated_at: contract.updated_at
        },
        conventions: contract.conventions.map((convention) => ({
          id: convention.id,
          kind: convention.kind,
          statement: convention.statement,
          enforcement_mode: convention.enforcement_mode,
          enforcement_capability: convention.enforcement_capability,
          scope: convention.scope,
          matcher: convention.matcher,
          exceptions: convention.exceptions
        })),
        baseline: baselineSummary(storage, repo_id),
        findings: storage.listFindings(repo_id).filter((finding) =>
          !["fixed", "false_positive", "suppressed"].includes(finding.status)
        ),
        required_checks: contract.required_checks,
        safe_commands: contract.safe_commands,
        redactions: {
          denied_globs: contract.context_egress.denied_globs,
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
      const allFindings = storage.listFindings(repo_id);
      const findings = allFindings.filter((finding) =>
        (!status || finding.status === status) &&
        (!severity || finding.severity === severity)
      );
      return {
        repo_id,
        policy,
        summary: findingsSummary(allFindings, findings),
        findings
      };
    }),

    get_allowed_context: ({ repo_id, path, surface = "mcp" }) =>
      withStorage(options, (storage) => {
        const contract = requiredContract(storage.getRepoContract(repo_id), repo_id);
        return {
          repo_id,
          path,
          decision: authorizeContextExport(contract, surface, { path })
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
  const contract = requiredContract(storage.getRepoContract(repoId), repoId);
  const policy = authorizeContextExport(contract, "mcp");
  if (!policy.allowed) {
    throw new Error(`Policy denied MCP output: ${policy.reason}`);
  }
  return { contract, policy };
}

function optionalAuthorizedMcpPolicy(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
): PolicyDecision | null {
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    return null;
  }
  const policy = authorizeContextExport(contract, "mcp");
  if (!policy.allowed) {
    throw new Error(`Policy denied MCP output: ${policy.reason}`);
  }
  return policy;
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
