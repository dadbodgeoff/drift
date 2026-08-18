import type { AcceptedConvention,BaselineViolation,ConventionException,FactRecord,FileSnapshot } from "@drift/core";
import type { EngineCheckRequest,EngineCheckResult,EngineDiagnostic } from "@drift/engine-contract";
import type { GraphEdge,GraphEvidence,GraphNode } from "@drift/factgraph";
import { parseEngineCheckResult } from "@drift/engine-contract";
import { gitOutput } from "../io/git.js";
import type { ParsedDiff } from "../check/diff.js";
import { runRustEngineWithInput } from "./rust-engine.js";

/**
 * One accepted security helper's resolved module identity, as it travels to the engine.
 *
 * Structurally the CLI-side `AcceptedHelperIdentity`, restated here because this is the wire shape
 * rather than the computation's. `mode` is not decoration: `external` means the specifier resolved
 * to nothing BY DESIGN (the Rust resolver filters to paths inside the scan snapshot, so anything in
 * `node_modules` never produces an edge), while `unresolved` means a repo specifier resolved to
 * nothing, which is a degradation. A consumer that read an empty `files` without reading `mode`
 * would treat every external auth helper as matching nothing.
 */
export interface AcceptedHelperModuleFile {
  /**
   * The `requires` list this helper came from. `symbol` is unique within a list, not across them,
   * and the engine reads each list separately - so this is what lets a consumer join an identity
   * back to the helper it describes.
   */
  requires_key: string;
  symbol: string;
  /** The specifier as the contract typed it; what the non-`repo_resolved` modes fall back to. */
  specifier: string;
  mode: "repo_resolved" | "external" | "unresolved";
  /**
   * The module the specifier names, plus modules a re-export chain carries the helper's SYMBOL to.
   * A barrel sibling that does not export the symbol is not in here. The closure matches symbol
   * NAMES, so a barrel re-exporting one name from two modules still yields both.
   */
  files: string[];
  /**
   * A package-shaped specifier that resolves to a repo file. States the fact and claims no intent:
   * it is the tsconfig-paths hijack shape, and equally the shape of a workspace package or a scoped
   * path alias. Input to a local-shadow check, not a finding.
   */
  package_specifier_resolves_in_repo?: true;
}

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
  /** Files the forbidden specifiers resolve to; see the matcher note below. */
  forbiddenModuleFiles?: string[];
  /**
   * S3-03: what each accepted security helper's import specifier actually resolves to, and the mode
   * that answer came from. Computed CLI-side for the same reason `forbiddenModuleFiles` is - see
   * the matcher note below. The engine accepts and ignores it; Sprint 4 consumes it.
   */
  acceptedHelperModuleFiles?: AcceptedHelperModuleFile[];
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
        // EW-1: the runtime-use proof must survive the round trip into the check request, or the
        // engine re-imposes member-level symbol conservatism on facts that had already escaped it.
        runtime_use: fact.runtime_use,
        start_line: fact.start_line,
        end_line: fact.end_line,
        // EW-6: and the columns, so two occurrences on one line stay two facts here too.
        start_column: fact.source_span?.start_column ?? 0,
        end_column: fact.source_span?.end_column ?? 0
      }))
    },
    contract: {
      contract_id: input.contractId ?? input.conventions[0]?.contract_id ?? "contract_unknown",
      contract_schema_version: input.contractSchemaVersion ?? 1,
      conventions: input.conventions.map((convention) => ({
        id: convention.id,
        rule_id: convention.kind,
        kind: convention.kind,
        // T100: the engine receives a graph scoped to the changed files, so it cannot derive
        // what a forbidden specifier resolves to - the imports establishing that live in files
        // outside the diff. The caller computes it from the whole graph and passes it here.
        //
        // S3-03: `accepted_helper_module_files` is the same derivation for the other direction -
        // what an ACCEPTED security helper's specifier resolves to - and rides the same surface for
        // the same reason. It belongs here rather than in `requires` because `requires` is the
        // stored contract returned verbatim below: mixing a CLI derivation into it would blur what
        // a human accepted with what this process computed, and would bypass typing, since
        // `requires` crosses the protocol as an untyped `Option<Value>` where a typo-shaped key
        // ships silently.
        matcher: {
          ...(convention.matcher as unknown as Record<string, unknown>),
          // Sorted here, at the last point before the wire. It is built from a Set filled in
          // graph-edge order, so the same repo could otherwise hand the engine the same files in
          // different orders across runs. The determinism digest covers findings and never the
          // request, so nothing downstream would catch it - the same reason
          // `accepted_helper_module_files` is sorted, and the two should not disagree about
          // whether order carries meaning. It does not.
          ...(input.forbiddenModuleFiles?.length
            ? { forbidden_module_files: [...input.forbiddenModuleFiles].sort() }
            : {}),
          ...(input.acceptedHelperModuleFiles?.length
            ? { accepted_helper_module_files: input.acceptedHelperModuleFiles }
            : {})
        },
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
