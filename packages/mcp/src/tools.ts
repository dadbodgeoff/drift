import type { DriftMcpTool } from "./types.js";

export const DRIFT_READ_ONLY_MCP_TOOLS: DriftMcpTool[] = [
  {
    name: "get_runtime_info",
    description: "Return Drift runtime, schema, support-scope, and read-only governance metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    name: "get_capabilities",
    description: "Return Drift V1 CLI and MCP capability metadata without reading repo source.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    name: "get_audit_status",
    description: "Return read-only audit hash-chain verification status for a repo.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_scan_status",
    description: "Return the latest Drift scan status for a repo, including parser-gap quality.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_repo_contract",
    description: "Return the approved repo contract, policy, and conventions.",
    inputSchema: repoOnlySchema()
  },
  {
    name: "get_repo_map",
    description: "Return the latest indexed file-role/import/export/call map and parser-gap quality without source snippets.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        role: {
          type: "string",
          enum: [
            "api_route",
            "server_module",
            "service_module",
            "data_access_module",
            "component",
            "test",
            "config",
            "cli_command_module",
            "core_module",
            "query_module",
            "factgraph_module",
            "adapter_module",
            "storage_module",
            "engine_bridge_module",
            "mcp_module",
            "docs",
            "package_manifest"
          ]
        },
        path: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
        require_fresh: { type: "boolean" }
      },
      required: ["repo_id"],
      additionalProperties: false
    }
  },
  {
    name: "get_security_context",
    description: "Return accepted security contract context and middleware coverage summaries without source snippets.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        path: { type: "string" },
        changed_files: { type: "array", items: { type: "string" } },
        check_id: { type: "string" },
        require_fresh: { type: "boolean" }
      },
      required: ["repo_id"],
      additionalProperties: false
    }
  },
  {
    name: "get_task_preflight",
    description: "Return policy-filtered conventions, findings, and parser-gap quality relevant to a task.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        task: { type: "string" },
        path: { type: "string" },
        require_fresh: { type: "boolean" },
        now: { type: "string" }
      },
      required: ["repo_id", "task"],
      additionalProperties: false
    }
  },
  {
    name: "get_conventions",
    description: "Return accepted conventions for a repo.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "api_route_no_direct_data_access",
            "api_route_requires_service_delegation",
            "api_route_requires_auth_helper",
            "middleware_must_cover_routes",
            "session_object_must_come_from_trusted_helper",
            "api_route_requires_authorization",
            "api_route_requires_tenant_scope",
            "test_expected_for_changed_module",
            "custom_briefing"
          ]
        },
        capability: {
          type: "string",
          enum: ["briefing_only", "heuristic_check", "deterministic_check"]
        },
        limit: { type: "number" },
        offset: { type: "number" }
      },
      required: ["repo_id"],
      additionalProperties: false
    }
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
            "suppressed",
            "expired"
          ]
        },
        severity: {
          type: "string",
          enum: ["info", "warning", "error"]
        },
        diff_status: {
          type: "string",
          enum: ["new_in_diff", "touched_existing", "outside_diff"]
        },
        convention_id: { type: "string" },
        path: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
        require_fresh: { type: "boolean" }
      },
      required: ["repo_id"],
      additionalProperties: false
    }
  },
  {
    name: "get_required_check_executions",
    description: "Return stored required-check execution proof for a repo without running commands.",
    inputSchema: {
      type: "object",
      properties: {
        repo_id: { type: "string" },
        command: { type: "string" },
        scan_id: { type: "string" },
        repo_contract_id: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" }
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
        request_full_file_content: { type: "boolean" },
        require_fresh: { type: "boolean" }
      },
      required: ["repo_id", "path"],
      additionalProperties: false
    }
  }
];

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
