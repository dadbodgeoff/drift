import type { AcceptedConvention,BaselineViolation,ConventionException,FactRecord,FileSnapshot } from "@drift/core";
import type { EngineCheckRequest,EngineCheckResult,EngineDiagnostic } from "@drift/engine-contract";
import type { GraphEdge,GraphEvidence,GraphNode } from "@drift/factgraph";
import { parseEngineCheckResult } from "@drift/engine-contract";
import { gitOutput } from "../io/git.js";
import type { ParsedDiff } from "../check/diff.js";
import { runRustEngineWithInput } from "./rust-engine.js";

export interface EngineCheckInput {
  repoId: string;
  repoRoot: string;
  scanId: string;
  contractId?: string;
  contractSchemaVersion?: number;
  contractWaivers?: ConventionException[];
  contractExceptions?: ConventionException[];
  facts: FactRecord[];
  snapshots: FileSnapshot[];
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  graphEvidence?: GraphEvidence[];
  graphDiagnostics?: EngineDiagnostic[];
  conventions: AcceptedConvention[];
  baseline: BaselineViolation[];
  diff: ParsedDiff;
  scope: "changed-hunks" | "changed-files" | "full";
}

export async function runEngineCheck(input: EngineCheckInput): Promise<EngineCheckResult> {
  const request = engineCheckRequest(input);
  const output = await runRustEngineWithInput(["check-repo"], JSON.stringify(request));
  return parseEngineCheckResult(JSON.parse(output) as unknown);
}

export function engineCheckRequest(input: EngineCheckInput): EngineCheckRequest {
  return {
    schema_version: "engine.check.request.v1",
    repo: {
      repo_id: input.repoId,
      repo_root: input.repoRoot,
      branch: gitOutput(input.repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(input.repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(input.repoRoot, ["status", "--porcelain"]))
    },
    graph: {
      require_fresh: false,
      graph_nodes: input.graphNodes ?? [],
      graph_edges: input.graphEdges ?? [],
      graph_evidence: input.graphEvidence ?? [],
      graph_diagnostics: input.graphDiagnostics ?? []
    },
    scan: {
      scan_id: input.scanId,
      file_snapshots: input.snapshots.map((snapshot) => ({
        file_path: snapshot.file_path,
        content_hash: snapshot.content_hash,
        byte_size: snapshot.byte_size,
        indexed: snapshot.indexed
      })),
      facts: input.facts.map((fact) => ({
        kind: fact.kind,
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        imported_name: fact.imported_name,
        start_line: fact.start_line,
        end_line: fact.end_line
      }))
    },
    contract: {
      contract_id: input.contractId ?? input.conventions[0]?.contract_id ?? "contract_unknown",
      contract_schema_version: input.contractSchemaVersion ?? 1,
      conventions: input.conventions.map((convention) => ({
        id: convention.id,
        rule_id: convention.kind,
        kind: convention.kind,
        matcher: convention.matcher as unknown as Record<string, unknown>,
        scope: convention.scope as unknown as Record<string, unknown>,
        requires: securityRequires(convention),
        exceptions: convention.exceptions as unknown as Array<Record<string, unknown>>,
        governance: {
          accepted_by: convention.accepted_by,
          accepted_at: convention.accepted_at,
          updated_at: convention.updated_at,
          expires_at: convention.expires_at,
          rationale: convention.rationale,
          evidence_refs: convention.evidence_refs.map((evidence) => evidence.id),
          counterexample_refs: convention.counterexample_refs.map((evidence) => evidence.id)
        },
        severity: engineConventionSeverity(convention.severity),
        enforcement_mode: convention.enforcement_mode,
        enforcement_capability: convention.enforcement_capability
      })),
      waivers: (input.contractWaivers ?? []).map((waiver) => ({
        id: waiver.id,
        convention_id: waiver.contract_kinds?.[0],
        path_globs: waiver.path_globs,
        reason: waiver.reason
      })),
      exceptions: (input.contractExceptions ?? []).map((exception) => exception as unknown as Record<string, unknown>)
    },
    baseline: input.baseline.map((entry) => ({
      convention_id: entry.convention_id,
      finding_fingerprint: entry.finding_fingerprint,
      status: entry.status
    })),
    diff: {
      mode: input.scope,
      files: input.diff.files.map((file) => ({
        path: file.path,
        changed_lines: [...file.changedLines].sort((a, b) => a - b),
        is_added: file.isAdded
      })),
      deleted_files: input.diff.deletedFiles
    },
    limits: {
      max_files_seen: 100000,
      max_files_parsed: 100000,
      max_file_bytes: 2_000_000,
      max_facts: 500000,
      max_graph_nodes: Math.max(input.graphNodes?.length ?? 0, 100000),
      max_graph_edges: Math.max(input.graphEdges?.length ?? 0, 100000),
      max_diagnostics: 1000,
      follow_symlinks: false
    }
  };
}

function securityRequires(convention: AcceptedConvention): Record<string, unknown> | undefined {
  const conventionWithRequires = convention as AcceptedConvention & { requires?: unknown };
  if (isRecord(conventionWithRequires.requires)) {
    return conventionWithRequires.requires;
  }
  if (convention.kind === "api_route_requires_request_validation") {
    return undefined;
  }
  if (convention.kind !== "api_route_requires_auth_helper" || !convention.matcher.required_calls?.length) {
    return undefined;
  }
  return {
    auth_helpers: convention.matcher.required_calls.map((symbol) => ({
      guard_id: `auth:${symbol}`,
      symbol
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function engineConventionSeverity(severity: AcceptedConvention["severity"]): "info" | "warning" | "error" {
  if (severity === "blocking" || severity === "release_blocking") {
    return "error";
  }
  return severity;
}
