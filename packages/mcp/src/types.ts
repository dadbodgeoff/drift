import type {
  ConventionKind,
  EnforcementCapability,
  FileRole,
  FindingDiffStatus,
  FindingStatus,
  PolicyDecision,
  RepoContract,
  Severity
} from "@drift/core";

export interface DriftMcpOptions {
  databasePath: string;
}

export interface DriftMcpHandlers {
  get_runtime_info(input: Record<string, never>): unknown;
  get_capabilities(input: Record<string, never>): unknown;
  get_audit_status(input: { repo_id: string }): unknown;
  get_scan_status(input: { repo_id: string }): unknown;
  get_repo_contract(input: { repo_id: string }): unknown;
  get_repo_map(input: {
    repo_id: string;
    role?: FileRole;
    path?: string;
    require_fresh?: boolean;
    limit?: number;
    offset?: number;
  }): unknown;
  get_task_preflight(input: { repo_id: string; task: string; path?: string; require_fresh?: boolean; now?: string }): unknown;
  get_conventions(input: {
    repo_id: string;
    kind?: ConventionKind;
    capability?: EnforcementCapability;
    limit?: number;
    offset?: number;
  }): unknown;
  get_findings(input: {
    repo_id: string;
    status?: FindingStatus;
    severity?: Severity;
    diff_status?: FindingDiffStatus;
    convention_id?: string;
    path?: string;
    limit?: number;
    offset?: number;
    require_fresh?: boolean;
  }): unknown;
  get_allowed_context(input: {
    repo_id: string;
    path: string;
    surface?: PolicyDecision["surface"];
    requested_snippet_chars?: number;
    request_full_file_content?: boolean;
    require_fresh?: boolean;
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

export interface RelevantFile {
  path: string;
  roles: string[];
  reasons: string[];
}

export interface RepoMapFile {
  path: string;
  content_hash: string;
  byte_size: number;
  indexed: boolean;
  roles: string[];
  imports: string[];
  exported_symbols: string[];
  calls: string[];
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
  fact_count: number;
}

export type PreparedRequiredCheck = RepoContract["required_checks"][number] & {
  matched_files: string[];
};

export type PreparedRiskArea = RepoContract["risky_areas"][number] & {
  matched_files: string[];
};

export type PreparedWaiver = RepoContract["waivers"][number] & {
  status: "active";
  matched_files: string[];
};

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

export interface McpCliResult {
  exitCode: number;
}
