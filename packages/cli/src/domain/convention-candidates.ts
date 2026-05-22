import type { AcceptedConvention,ConventionCandidate,ConventionStatus,EnforcementMode,EvidenceRef,FactRecord,RepoContract,Severity } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { join } from "node:path";
import { fileLooksLikeDataAccess,resolveImportTarget } from "../engine/import-resolution.js";
import { fileContentHash } from "../io/file-hash.js";
import { contractSummary,materializeRepoContract } from "./contract-materialization.js";
import { auditEvent,mutationGovernance } from "./governance.js";
import { contractIdForRepo,conventionIdForCandidate,hashStable } from "./identifiers.js";
import { countBy } from "./pagination.js";
import { requiredCandidate,requiredRepo } from "./repo-paths.js";

export function acceptConventionCandidate(
  storage: SqliteDriftStorage,
  input: {
    candidateId: string;
    repoId?: string;
    now: string;
    actor: string;
    severity?: Severity;
    mode?: EnforcementMode;
    confirmed: boolean;
  }
): {
  accepted: AcceptedConvention;
  contract: RepoContract;
  changed: boolean;
  governance: ReturnType<typeof mutationGovernance>;
  contract_summary: ReturnType<typeof contractSummary>;
  next_commands: string[];
} {
  const candidate = requiredCandidate(storage, input.candidateId);
  if (input.repoId) {
    requiredRepo(storage, input.repoId);
    if (candidate.repo_id !== input.repoId) {
      throw new Error(`Convention candidate ${candidate.id} belongs to repo ${candidate.repo_id}, not ${input.repoId}.`);
    }
  }
  const now = input.now;
  const actor = input.actor;
  const severity = input.severity ?? candidate.suggested_severity;
  const mode = input.mode ?? candidate.suggested_enforcement_mode;
  if (mode === "block" && candidate.enforcement_capability !== "deterministic_check") {
    throw new Error("Only deterministic conventions can use --mode block. Use --mode warn, brief, or off for heuristic/briefing conventions.");
  }
  if (!input.confirmed) {
    throw new Error("Convention acceptance requires --confirm.");
  }
  const contractId = storage.getRepoContract(candidate.repo_id)?.id ?? contractIdForRepo(candidate.repo_id);
  const existingAccepted = storage
    .listAcceptedConventions(candidate.repo_id)
    .find((accepted) => accepted.id === conventionIdForCandidate(candidate.id));
  const existingContract = storage.getRepoContract(candidate.repo_id);
  if (
    candidate.status === "accepted" &&
    existingAccepted &&
    existingContract &&
    existingAccepted.severity === severity &&
    existingAccepted.enforcement_mode === mode
  ) {
    return {
      accepted: existingAccepted,
      contract: existingContract,
      changed: false,
      governance: mutationGovernance(),
      contract_summary: contractSummary(existingContract),
      next_commands: acceptedConventionNextCommands(candidate.repo_id)
    };
  }

  const convention: AcceptedConvention = {
    id: conventionIdForCandidate(candidate.id),
    contract_id: contractId,
    kind: candidate.kind,
    statement: candidate.statement,
    rationale: candidate.rationale,
    scope: candidate.scope,
    matcher: candidate.matcher,
    severity,
    enforcement_mode: mode,
    enforcement_capability: candidate.enforcement_capability,
    exceptions: [],
    evidence_refs: candidate.evidence_refs,
    counterexample_refs: candidate.counterexample_refs,
    accepted_by: actor,
    accepted_at: now,
    updated_at: now
  };

  const contract = storage.transaction(() => {
    storage.upsertAcceptedConvention(candidate.repo_id, convention);
    storage.upsertConventionCandidate({ ...candidate, status: "accepted" });
    const materializedContract = materializeRepoContract(storage, candidate.repo_id, contractId, now);
    storage.upsertRepoContract(materializedContract);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_accept_${candidate.id}_${now}`,
      repoId: candidate.repo_id,
      actor,
      action: "election_accepted",
      targetType: "convention",
      targetId: convention.id,
      metadata: { candidate_id: candidate.id },
      createdAt: now
    }));
    return materializedContract;
  });

  return {
    accepted: convention,
    contract,
    changed: true,
    governance: mutationGovernance(),
    contract_summary: contractSummary(contract),
    next_commands: acceptedConventionNextCommands(candidate.repo_id)
  };
}

export function acceptDefaultCandidate(
  storage: SqliteDriftStorage,
  options: { now: string; actor: string },
  candidate: ConventionCandidate
): AcceptedConvention {
  return acceptConventionCandidate(
    storage, {
      candidateId: candidate.id,
      severity: candidate.suggested_severity,
      mode: candidate.suggested_enforcement_mode,
      confirmed: true,
      now: options.now,
      actor: options.actor
    }
  ).accepted;
}

export function conventionCandidateSummary(
  allCandidates: ConventionCandidate[],
  filteredCandidates: ConventionCandidate[],
  listedCandidates: ConventionCandidate[]
): {
  total_count: number;
  filtered_count: number;
  listed_count: number;
  by_status: Partial<Record<ConventionStatus, number>>;
  by_capability: Partial<Record<ConventionCandidate["enforcement_capability"], number>>;
  by_kind: Partial<Record<ConventionCandidate["kind"], number>>;
} {
  return {
    total_count: allCandidates.length,
    filtered_count: filteredCandidates.length,
    listed_count: listedCandidates.length,
    by_status: countBy(allCandidates, (candidate) => candidate.status),
    by_capability: countBy(allCandidates, (candidate) => candidate.enforcement_capability),
    by_kind: countBy(allCandidates, (candidate) => candidate.kind)
  };
}

export function conventionCandidateReviewItem(candidate: ConventionCandidate): {
  id: string;
  repo_id: string;
  kind: ConventionCandidate["kind"];
  statement: string;
  status: ConventionStatus;
  confidence_label: ConventionCandidate["confidence_label"];
  enforcement_capability: ConventionCandidate["enforcement_capability"];
  suggested_severity: Severity;
  suggested_enforcement_mode: EnforcementMode;
  supporting_examples_count: number;
  counterexamples_count: number;
  scope_files_count: number;
  coverage_ratio: number;
  heuristic_id: string;
  evidence_ref_count: number;
  counterexample_ref_count: number;
  first_evidence: Pick<EvidenceRef, "file_path" | "start_line" | "import_source" | "symbol"> | null;
} {
  const firstEvidence = candidate.evidence_refs[0] ?? null;
  return {
    id: candidate.id,
    repo_id: candidate.repo_id,
    kind: candidate.kind,
    statement: candidate.statement,
    status: candidate.status,
    confidence_label: candidate.confidence_label,
    enforcement_capability: candidate.enforcement_capability,
    suggested_severity: candidate.suggested_severity,
    suggested_enforcement_mode: candidate.suggested_enforcement_mode,
    supporting_examples_count: candidate.scoring.supporting_examples_count,
    counterexamples_count: candidate.scoring.counterexamples_count,
    scope_files_count: candidate.scoring.scope_files_count,
    coverage_ratio: candidate.scoring.coverage_ratio,
    heuristic_id: candidate.scoring.heuristic_id,
    evidence_ref_count: candidate.evidence_refs.length,
    counterexample_ref_count: candidate.counterexample_refs.length,
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

export function conventionCandidateListNextCommands(
  repoId: string,
  candidates: ConventionCandidate[]
): string[] {
  const candidate = candidates[0];
  if (!candidate) {
    return [`drift scan --repo ${repoId} --json`];
  }
  return [
    `drift conventions show ${candidate.id} --repo ${repoId} --json`,
    `drift conventions accept ${candidate.id} --repo ${repoId} --severity ${candidate.suggested_severity} --mode ${candidate.suggested_enforcement_mode} --confirm`,
    `drift conventions reject ${candidate.id} --repo ${repoId} --reason "false inference" --confirm`
  ];
}

export function conventionCandidateShowNextCommands(candidate: ConventionCandidate): string[] {
  return [
    `drift conventions accept ${candidate.id} --repo ${candidate.repo_id} --severity ${candidate.suggested_severity} --mode ${candidate.suggested_enforcement_mode} --confirm`,
    `drift conventions reject ${candidate.id} --repo ${candidate.repo_id} --reason "false inference" --confirm`,
    `drift conventions edit ${candidate.id} --repo ${candidate.repo_id} --statement "..." --confirm`
  ];
}

export function conventionCandidateEditNextCommands(candidate: ConventionCandidate): string[] {
  return [
    `drift conventions show ${candidate.id} --repo ${candidate.repo_id} --json`,
    `drift conventions accept ${candidate.id} --repo ${candidate.repo_id} --severity ${candidate.suggested_severity} --mode ${candidate.suggested_enforcement_mode} --confirm`,
    `drift conventions reject ${candidate.id} --repo ${candidate.repo_id} --reason "false inference" --confirm`
  ];
}

export function acceptedConventionNextCommands(repoId: string): string[] {
  return [
    `drift contract show --repo ${repoId} --json`,
    `drift baseline create --repo ${repoId} --from main --confirm --json`,
    `drift prepare "task" --repo ${repoId} --json`,
    `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`
  ];
}

export function rejectedConventionNextCommands(repoId: string): string[] {
  return [
    `drift conventions list --repo ${repoId} --status candidate --json`,
    `drift audit list --repo ${repoId} --action election_rejected --json`
  ];
}

export function exceptionNextCommands(repoId: string): string[] {
  return [
    `drift contract show --repo ${repoId} --json`,
    `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`,
    `drift audit list --repo ${repoId} --action policy_changed --json`
  ];
}

export function inferConventionCandidates(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
  facts: FactRecord[];
  now: string;
}): ConventionCandidate[] {
  const apiRouteFiles = new Set(
    input.facts
      .filter((fact) => fact.kind === "file_role_detected" && fact.name === "api_route")
      .map((fact) => fact.file_path)
  );
  const dataImports = input.facts.filter((fact) =>
    fact.kind === "import_used" &&
    apiRouteFiles.has(fact.file_path) &&
    fact.value &&
    looksLikeDataAccessImport(fact.value, {
      repoRoot: input.repoRoot,
      importerFile: fact.file_path
    })
  );
  const serviceImports = input.facts.filter((fact) =>
    fact.kind === "import_used" &&
    apiRouteFiles.has(fact.file_path) &&
    fact.value &&
    looksLikeServiceImport(fact.value)
  );

  const candidates: ConventionCandidate[] = [];
  if (dataImports.length > 0) {
    const forbiddenImports = [...new Set(dataImports.map((fact) => fact.value).filter(Boolean))] as string[];
    const dataEvidence = evidenceRefsForFacts({
      repoRoot: input.repoRoot,
      scanId: input.scanId,
      kind: "supporting",
      facts: dataImports
    });
    candidates.push({
      id: `candidate_${hashStable(`${input.repoId}:api_route_no_direct_data_access:${forbiddenImports.join(",")}`).slice(0, 16)}`,
      repo_id: input.repoId,
      scan_id: input.scanId,
      kind: "api_route_no_direct_data_access",
      statement: "API routes should not import data-access clients directly.",
      rationale: "Detected API route imports that look like database/data-access clients.",
      scope: {
        path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        file_roles: ["api_route"]
      },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: forbiddenImports,
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "error",
      suggested_enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      confidence_label: "high",
      scoring: {
        supporting_examples_count: dataImports.length,
        counterexamples_count: 0,
        scope_files_count: apiRouteFiles.size,
        coverage_ratio: apiRouteFiles.size === 0 ? 0 : dataImports.length / apiRouteFiles.size,
        heuristic_id: "direct-data-access-import-v1"
      },
      evidence_refs: dataEvidence,
      counterexample_refs: [],
      status: "candidate",
      created_at: input.now
    });
  }

  if (serviceImports.length > 0 || dataImports.length > 0) {
    const delegateImports = [...new Set(serviceImports.map((fact) => fact.value).filter(Boolean))] as string[];
    const serviceEvidence = evidenceRefsForFacts({
      repoRoot: input.repoRoot,
      scanId: input.scanId,
      kind: "supporting",
      facts: serviceImports
    });
    const dataCounterexamples = evidenceRefsForFacts({
      repoRoot: input.repoRoot,
      scanId: input.scanId,
      kind: "counterexample",
      facts: dataImports
    });
    candidates.push({
      id: `candidate_${hashStable(`${input.repoId}:api_route_requires_service_delegation:${delegateImports.join(",") || "default"}`).slice(0, 16)}`,
      repo_id: input.repoId,
      scan_id: input.scanId,
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate business and data-access work through service modules.",
      rationale: serviceImports.length > 0
        ? "Detected API route imports from service modules."
        : "Detected direct data-access imports; service delegation should be reviewed before enforcement.",
      scope: {
        path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        file_roles: ["api_route"]
      },
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: delegateImports.length > 0
          ? delegateImports
          : ["**/services/**", "**/server/**", "**/data-access/**"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: serviceImports.length > 0 ? "medium" : "low",
      scoring: {
        supporting_examples_count: serviceImports.length,
        counterexamples_count: dataImports.length,
        scope_files_count: apiRouteFiles.size,
        coverage_ratio: apiRouteFiles.size === 0 ? 0 : serviceImports.length / apiRouteFiles.size,
        heuristic_id: "api-route-service-delegation-v1"
      },
      evidence_refs: serviceEvidence,
      counterexample_refs: dataCounterexamples,
      status: "candidate",
      created_at: input.now
    });
  }

  return candidates;
}

export function evidenceRefsForFacts(input: {
  repoRoot: string;
  scanId: string;
  kind: EvidenceRef["kind"];
  facts: FactRecord[];
}): EvidenceRef[] {
  const fileHashes = new Map<string, string>();
  return input.facts.map((fact) => {
    const fileHash = fileHashes.get(fact.file_path) ??
      fileContentHash(join(input.repoRoot, fact.file_path));
    fileHashes.set(fact.file_path, fileHash);
    return {
      id: `evidence_${hashStable(`${input.scanId}:${input.kind}:${fact.id}`).slice(0, 16)}`,
      kind: input.kind,
      file_path: fact.file_path,
      start_line: fact.start_line,
      end_line: fact.end_line,
      symbol: fact.name,
      import_source: fact.value,
      fact_ids: [fact.id],
      scan_id: input.scanId,
      file_hash: fileHash,
      redaction_state: "none"
    };
  });
}

export function looksLikeDataAccessImport(
  importSource: string,
  context?: { repoRoot: string; importerFile: string }
): boolean {
  if (rawLooksLikeDataAccessImport(importSource)) {
    return true;
  }

  const resolvedPath = context
    ? resolveImportTarget(context.repoRoot, context.importerFile, importSource)
    : undefined;
  if (!resolvedPath) {
    return false;
  }

  if (rawLooksLikeDataAccessImport(resolvedPath)) {
    return true;
  }

  return fileLooksLikeDataAccess(join(context!.repoRoot, resolvedPath));
}

export function rawLooksLikeDataAccessImport(importSource: string): boolean {
  return /(^|\/|@)(db|database|prisma|drizzle|typeorm|sequelize)(\/|$)/i.test(importSource);
}

export function looksLikeServiceImport(importSource: string): boolean {
  return /(^|\/|@)(services?|service-layer|use-cases?|interactors?|application)(\/|$)/i.test(importSource);
}
