import { API_ROUTE_SCOPE_GLOBS,DRIFT_CONTRACT_SCHEMA_VERSION,type AcceptedConvention,type ConventionCandidate,type ConventionStatus,type EnforcementMode,type EvidenceRef,type FactRecord,type RejectedInference,type RepoContract,type Severity } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { join } from "node:path";
import { fileLooksLikeDataAccess,resolveImportTarget } from "../engine/import-resolution.js";
import { fileContentHash } from "../io/file-hash.js";
import { contractSummary,defaultRequiredChecksForConventions,defaultRiskyAreasForConventions,defaultSafeCommandsForRepo,materializeRepoContract } from "./contract-materialization.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "./governance.js";
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
    dryRun?: boolean;
  }
): {
  accepted: AcceptedConvention;
  contract: RepoContract;
  changed: boolean;
  governance: ReturnType<typeof mutationGovernance> | ReturnType<typeof preflightGovernance>;
  contract_summary: ReturnType<typeof contractSummary>;
  next_commands: string[];
  dry_run?: boolean;
  write_intent?: boolean;
  would_accept?: boolean;
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
  if (input.dryRun && input.confirmed) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }
  if (!input.confirmed && !input.dryRun) {
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
    requires: candidate.requires,
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

  if (input.dryRun) {
    const previewContract = previewRepoContractWithConvention(storage, candidate.repo_id, contractId, convention, now);
    return {
      accepted: convention,
      contract: previewContract,
      changed: true,
      governance: preflightGovernance(),
      contract_summary: contractSummary(previewContract),
      next_commands: [
        `drift conventions accept ${candidate.id} --repo ${candidate.repo_id} --severity ${severity} --mode ${mode} --confirm --json`
      ],
      dry_run: true,
      write_intent: false,
      would_accept: true
    };
  }

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

function previewRepoContractWithConvention(
  storage: SqliteDriftStorage,
  repoId: string,
  contractId: string,
  convention: AcceptedConvention,
  now: string
): RepoContract {
  const existing = storage.getRepoContract(repoId);
  const repo = storage.getRepo(repoId);
  const acceptedConventions = [
    ...storage.listAcceptedConventions(repoId).filter((accepted) => accepted.id !== convention.id),
    convention
  ];
  return {
    id: contractId,
    repo_id: repoId,
    contract_schema_version: existing?.contract_schema_version ?? DRIFT_CONTRACT_SCHEMA_VERSION,
    repo_fingerprint: repo?.fingerprint ?? existing?.repo_fingerprint ?? "unknown",
    created_at: existing?.created_at ?? now,
    updated_at: now,
    conventions: acceptedConventions,
    rejected_inferences: existing?.rejected_inferences ?? [],
    waivers: existing?.waivers ?? [],
    risky_areas: existing?.risky_areas.length
      ? existing.risky_areas
      : defaultRiskyAreasForConventions(acceptedConventions),
    safe_commands: existing?.safe_commands.length
      ? existing.safe_commands
      : defaultSafeCommandsForRepo(repo?.root_path),
    required_checks: existing?.required_checks.length
      ? existing.required_checks
      : defaultRequiredChecksForConventions(repoId, acceptedConventions),
    context_egress: existing?.context_egress ?? {
      default_mode: "local_only",
      denied_globs: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.crt", "**/*.p12", "**/id_rsa", "**/id_ed25519"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: existing?.agent_permissions ?? []
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

export function candidateEvidenceFingerprint(candidate: ConventionCandidate): string {
  return candidate.evidence_fingerprint ?? hashStable(JSON.stringify({
    id: candidate.id,
    kind: candidate.kind,
    matcher: candidate.matcher,
    evidence: candidate.evidence_refs.map((ref) => ({
      id: ref.id,
      file_path: ref.file_path,
      start_line: ref.start_line ?? null,
      end_line: ref.end_line ?? null,
      symbol: ref.symbol ?? null,
      fact_ids: ref.fact_ids,
      file_hash: ref.file_hash
    }))
  }));
}

export function rejectedInferenceForCandidate(
  candidate: ConventionCandidate,
  input: { reason: string; rejectedBy: string; rejectedAt: string }
): RejectedInference {
  return {
    candidate_id: candidate.id,
    evidence_fingerprint: candidateEvidenceFingerprint(candidate),
    matcher_fingerprint: candidate.matcher_fingerprint,
    scope_fingerprint: candidate.scope_fingerprint,
    reason: input.reason,
    rejected_by: input.rejectedBy,
    rejected_at: input.rejectedAt
  };
}

export function candidateMatchesRejectedInference(
  candidate: ConventionCandidate,
  rejection: RejectedInference
): boolean {
  return rejection.candidate_id === candidate.id &&
    (!rejection.evidence_fingerprint ||
      rejection.evidence_fingerprint === candidateEvidenceFingerprint(candidate));
}

export function filterRejectedConventionCandidates(
  storage: SqliteDriftStorage,
  repoId: string,
  candidates: ConventionCandidate[]
): ConventionCandidate[] {
  const contractRejections = storage.getRepoContract(repoId)?.rejected_inferences ?? [];
  return candidates.filter((candidate) => {
    if (contractRejections.some((rejection) => candidateMatchesRejectedInference(candidate, rejection))) {
      return false;
    }
    const existing = storage.getConventionCandidate(candidate.id);
    return !(existing?.status === "rejected" &&
      candidateEvidenceFingerprint(existing) === candidateEvidenceFingerprint(candidate));
  });
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
  reason_not_blocking: ConventionCandidate["reason_not_blocking"] | null;
  evidence_fingerprint: string | null;
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
    reason_not_blocking: candidate.reason_not_blocking ?? null,
    evidence_fingerprint: candidate.evidence_fingerprint ?? null,
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
    return [`drift scan status --repo ${repoId} --json`];
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
    const dataMatcher = {
      kind: "api_route_no_direct_data_access" as const,
      forbidden_imports: forbiddenImports,
      applies_to_file_roles: ["api_route" as const]
    };
    const dataScope = {
      path_globs: [...API_ROUTE_SCOPE_GLOBS],
      file_roles: ["api_route" as const]
    };
    candidates.push({
      id: `candidate_${hashStable(`${input.repoId}:api_route_no_direct_data_access:${forbiddenImports.join(",")}`).slice(0, 16)}`,
      repo_id: input.repoId,
      scan_id: input.scanId,
      kind: "api_route_no_direct_data_access",
      statement: "API routes should not import data-access clients directly.",
      rationale: "Detected API route imports that look like database/data-access clients.",
      scope: dataScope,
      matcher: dataMatcher,
      requires: { forbidden_imports: forbiddenImports },
      suggested_severity: "error",
      suggested_enforcement_mode: "warn",
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
      matcher_fingerprint: hashStable(JSON.stringify(dataMatcher)),
      scope_fingerprint: hashStable(JSON.stringify(dataScope)),
      evidence_fingerprint: hashStable(JSON.stringify(dataEvidence)),
      required_capabilities: ["syntax_facts", "import_resolution", "route_detection"],
      reason_not_blocking: "candidate_not_accepted",
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
    const serviceMatcher = {
      kind: "api_route_requires_service_delegation" as const,
      allowed_delegate_imports: delegateImports.length > 0
        ? delegateImports
        : ["**/services/**", "**/server/**", "**/data-access/**"],
      applies_to_file_roles: ["api_route" as const]
    };
    const serviceScope = {
      path_globs: [...API_ROUTE_SCOPE_GLOBS],
      file_roles: ["api_route" as const]
    };
    candidates.push({
      id: `candidate_${hashStable(`${input.repoId}:api_route_requires_service_delegation:${delegateImports.join(",") || "default"}`).slice(0, 16)}`,
      repo_id: input.repoId,
      scan_id: input.scanId,
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate business and data-access work through service modules.",
      rationale: serviceImports.length > 0
        ? "Detected API route imports from service modules."
        : "Detected direct data-access imports; service delegation should be reviewed before enforcement.",
      scope: serviceScope,
      matcher: serviceMatcher,
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
      matcher_fingerprint: hashStable(JSON.stringify(serviceMatcher)),
      scope_fingerprint: hashStable(JSON.stringify(serviceScope)),
      evidence_fingerprint: hashStable(JSON.stringify(serviceEvidence)),
      required_capabilities: ["syntax_facts", "import_resolution", "graph_stream"],
      reason_not_blocking: "candidate_not_accepted",
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
