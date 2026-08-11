import { nextApiRouteIdentity, type AcceptedConvention, type FactRecord, type ParserGap, type RepoContract, type ScanManifest } from "@drift/core";
import type { openDriftStorage } from "@drift/storage";
import {
  buildCanonicalRouteReadModel,
  buildSecurityBoundaryProofReadModel,
  buildSecurityPhase8ReadModel,
  type CanonicalFactRouteInput
} from "@drift/query";

type DriftStorage = ReturnType<typeof openDriftStorage>;

interface MiddlewareCoverageValue {
  route_id?: string;
  middleware_id?: string;
  protection_kind?: string;
}

interface RequestInputReadValue {
  route_id?: string;
  source?: string;
}

interface ValidatedInputUsedValue {
  route_id?: string;
  sink_kind?: string;
}

interface SessionReadValue {
  route_id?: string;
  trust?: string;
}

interface AuthorizationGuardValue {
  route_id?: string;
  guard_id?: string;
  policy_id?: string;
  roles?: unknown[];
}

interface TenantSourceValue {
  route_id?: string;
  key?: string;
  trusted?: boolean;
}

interface TenantGuardValue {
  route_id?: string;
  tenant_key?: string;
}

interface ResponseEmitsFieldValue {
  route_id?: string;
  field_path?: string;
}

interface SensitiveFieldDeclaredValue {
  source?: string;
}

interface SecretReadValue {
  secret_class?: string;
  source?: string;
}

export function buildSecurityContextPayload(
  storage: DriftStorage,
  repoId: string,
  contract: RepoContract,
  options: { path?: string; changed_files?: string[]; check_id?: string } = {}
) {
  const latestScan = latestSecurityScan(storage.listScanManifests(repoId));
  const proofRuns = typeof storage.listLatestSecurityBoundaryProofRunsForRepo === "function"
    ? storage.listLatestSecurityBoundaryProofRunsForRepo({
        repo_id: repoId,
        check_id: options.check_id,
        file_path: options.path
      })
    : [];
  const fallbackProofs = proofRuns.length === 0 && latestScan
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
        .filter((proof) => !options.path || proof.route.file_path === options.path)
    : [];
  const proofs = proofRuns.length > 0 ? proofRuns.map((run) => run.proof) : fallbackProofs;
  const normalizedEntrypoints = latestScan
    ? storage.listNormalizedEntrypoints(repoId, latestScan.id)
    : [];
  const proofScanId = proofRuns[0]?.scan_id ?? (fallbackProofs.length > 0 ? latestScan?.id ?? null : null);
  const canonicalRoutes = buildCanonicalRouteReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    entrypoints: normalizedEntrypoints,
    proofs: proofs.map((proof) => ({
      proof_scan_id: proofScanId,
      route_id: proof.route.route_id,
      ...(proof.route.normalized_entrypoint_id ? { normalized_entrypoint_id: proof.route.normalized_entrypoint_id } : {}),
      file_path: proof.route.file_path,
      path: proof.route.endpoint?.path ?? null,
      method: proof.route.endpoint?.method ?? proof.route.handler_symbol ?? null
    })),
    fallback_fact_routes: latestScan ? fallbackFactRoutesFromFacts(storage.listFacts(latestScan.id)) : []
  });
  const changedFiles = options.changed_files ?? (options.path ? [options.path] : undefined);
  const phase8 = buildSecurityPhase8ReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    check_id: options.check_id ?? proofRuns[0]?.check_id ?? null,
    proof_scan_id: proofScanId,
    proofs,
    findings: storage.listFindings(repoId).map((finding) => ({
      finding_id: finding.id,
      title: finding.title,
      lifecycle: finding.status
    })),
    accepted_conventions: contract.conventions,
    changed_files: changedFiles,
    known_routes: canonicalRoutes.routes.filter((route) => !options.path || route.file_path === options.path),
    route_source_summary: canonicalRoutes.route_source_summary,
    canonical_route_fallback: canonicalRoutes.fallback
  });
  return {
    response_schema: "drift.security.context.v2",
    repo_id: repoId,
    scan_id: phase8.scan_id,
    check_id: phase8.check_id,
    repo_security_contracts: phase8.repo_security_contracts,
    changed_route_security: phase8.changed_route_security,
    routes: phase8.routes,
    required_proofs: phase8.required_proofs,
    current_proof_status: phase8.current_proof_status,
    missing_proof_summaries: phase8.missing_proof_summaries,
    parser_gap_summaries: phase8.parser_gap_summaries,
    security_capabilities: phase8.security_capabilities,
    route_source_summary: phase8.route_source_summary,
    canonical_route_fallback: phase8.canonical_route_fallback,
    proof_freshness: phase8.proof_freshness,
    do_not_include: phase8.do_not_include,
    redactions: {
      snippets_included: false,
      source_content_included: false,
      request_payloads_included: false,
      secret_values_included: false,
      actor_identity_included: false
    },
    freshness: {
      proof_source: proofRuns.length > 0 ? "proof_run" : fallbackProofs.length > 0 ? "scan_scoped" : "none",
      latest_indexed_scan_id: latestScan?.id ?? null
    },
    next_commands: [
      `drift check --repo ${repoId} --json`,
      `drift repo map --repo ${repoId} --json`
    ]
  };
}

function fallbackFactRoutesFromFacts(facts: FactRecord[]): CanonicalFactRouteInput[] {
  const apiFiles = new Set(facts
    .filter((fact) => fact.kind === "file_role_detected" && fact.name === "api_route")
    .map((fact) => fact.file_path));
  return facts
    .filter((fact) => fact.kind === "route_declared" && apiFiles.has(fact.file_path))
    .map((fact) => ({
      route_id: `route:${fact.file_path}:${fact.name}`,
      file_path: fact.file_path,
      method: fact.name,
      file_role: "api_route"
    }));
}

export function buildLegacySecurityContextPayload(storage: DriftStorage, repoId: string, contract: RepoContract) {
  const latestScan = latestSecurityScan(storage.listScanManifests(repoId));
  const facts = latestScan ? storage.listFacts(latestScan.id, { kind: "middleware_protects_route" }) : [];
  const requestInputFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "request_input_read" }) : [];
  const validatedUseFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "validated_input_used" }) : [];
  const sessionReadFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "session_read" }) : [];
  const authorizationGuardFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "authorization_guard_called" }) : [];
  const tenantSourceFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "tenant_source" }) : [];
  const tenantGuardFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "tenant_guard_called" }) : [];
  const responseFieldFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "response_emits_field" }) : [];
  const sensitiveFieldFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "sensitive_field_declared" }) : [];
  const secretReadFacts = latestScan ? storage.listFacts(latestScan.id, { kind: "secret_read" }) : [];
  const parserGaps = latestScan ? storage.listParserGaps(repoId, latestScan.id) : [];
  const latestScanSecurityProofs = latestScan
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
    : [];
  const securityProofs = latestScanSecurityProofs.length > 0
    ? latestScanSecurityProofs
    : storage.listSecurityBoundaryProofs(repoId);
  const proofReadModel = buildSecurityBoundaryProofReadModel({
    proofs: securityProofs,
    findings: storage.listFindings(repoId).map((finding) => ({
      finding_id: finding.id,
      title: finding.title,
      lifecycle: finding.status
    }))
  });
  const sensitiveResponseProofRoutes = proofReadModel.routes.filter((route) =>
    route.response_shape_required
  );
  const secretExposureProofRoutes = proofReadModel.routes.filter((route) =>
    route.secret_exposure_count > 0 ||
    route.missing_proof_codes.includes("secret_exposure_not_excluded") ||
    route.parser_gap_codes.includes("unsupported_dynamic_control_flow")
  );
  const phase6ProofRoutes = proofReadModel.routes.filter((route) =>
    route.phase6.ssrf.required ||
    route.phase6.raw_sql.required ||
    route.phase6.cors.required ||
    route.phase6.csrf.required ||
    route.phase6.rate_limit.required
  );

  return {
    response_schema: "drift.security.context.v1",
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    accepted_contracts: securityConventions(contract.conventions),
    middleware_coverage: {
      routes: middlewareCoverageRoutes(facts),
      parser_gaps: middlewareParserGaps(parserGaps)
    },
    request_validation: {
      routes: requestValidationRoutes(requestInputFacts, validatedUseFacts),
      parser_gaps: requestValidationParserGaps(parserGaps)
    },
    sensitive_response: {
      routes: sensitiveResponseProofRoutes.length > 0
        ? sensitiveResponseProofRoutes.map((route) => ({
            route_id: route.route_id,
            file_path: route.file_path,
            proof_status: route.proof_status,
            proven: route.response_shape_proven,
            leak_reasons: route.sensitive_response_leak_reasons,
            missing_proof_codes: route.missing_proof_codes,
            parser_gap_codes: route.parser_gap_codes
          }))
        : sensitiveResponseRoutes(responseFieldFacts),
      declared_field_sources: sensitiveFieldSources(sensitiveFieldFacts),
      proof_status: proofStatusForRoutes(sensitiveResponseProofRoutes)
    },
    secret_exposure: {
      reads: secretReadSummaries(secretReadFacts),
      routes: secretExposureProofRoutes.map((route) => ({
        route_id: route.route_id,
        file_path: route.file_path,
        proof_status: route.proof_status,
        secret_exposure_count: route.secret_exposure_count,
        sink_kinds: route.secret_exposure_sink_kinds,
        missing_proof_codes: route.missing_proof_codes,
        parser_gap_codes: route.parser_gap_codes
      })),
      proof_status: proofStatusForRoutes(secretExposureProofRoutes)
    },
    session_trust: {
      routes: sessionTrustRoutes(sessionReadFacts)
    },
    authorization: {
      routes: authorizationRoutes(authorizationGuardFacts)
    },
    tenant_scope: {
      routes: tenantScopeRoutes(tenantSourceFacts, tenantGuardFacts),
      parser_gaps: tenantParserGaps(parserGaps)
    },
    phase6: {
      proof_source: "trusted_check_proof_required",
      routes: phase6ProofRoutes.map((route) => ({
        route_id: route.route_id,
        file_path: route.file_path,
        proof_status: route.proof_status,
        enforcement_result: route.enforcement_result,
        phase6: route.phase6,
        missing_proof_codes: route.missing_proof_codes,
        parser_gap_codes: route.parser_gap_codes
      })),
      parser_gaps: phase6ParserGaps(parserGaps)
    },
    redactions: {
      snippets_included: false,
      source_content_included: false,
      request_payloads_included: false,
      secret_values_included: false
    }
  };
}

function proofStatusForRoutes(routes: Array<{ proof_status: string }>): string {
  if (routes.length === 0) {
    return "not_evaluated";
  }
  if (routes.some((route) => route.proof_status === "parser_gap")) {
    return "parser_gap";
  }
  if (routes.some((route) => route.proof_status === "missing_proof")) {
    return "missing_proof";
  }
  return routes.every((route) => route.proof_status === "proven") ? "proven" : "not_evaluated";
}

function latestSecurityScan(scans: ScanManifest[]): ScanManifest | undefined {
  return scans.find((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_check_")
  ) ?? scans.find((scan) => scan.status === "completed") ?? scans[0];
}

function routeIdForFact(routeId: string | undefined, filePath: string): string {
  if (routeId) {
    return routeId;
  }
  const identity = nextApiRouteIdentity(filePath);
  return identity ? `route:${identity.route_path}:unknown` : `route:${filePath}:unknown`;
}

function securityConventions(conventions: AcceptedConvention[]) {
  return conventions
    .filter((convention) =>
      convention.kind === "middleware_must_cover_routes" ||
      convention.kind === "api_route_requires_auth_helper" ||
      convention.kind === "api_route_requires_request_validation" ||
      convention.kind === "api_route_forbids_untrusted_ssrf" ||
      convention.kind === "api_route_forbids_raw_sql_without_params" ||
      convention.kind === "api_route_cors_must_match_policy" ||
      convention.kind === "api_route_requires_csrf_for_mutation" ||
      convention.kind === "api_route_requires_rate_limit" ||
      convention.kind === "api_route_forbids_sensitive_response_fields" ||
      convention.kind === "api_route_forbids_secret_exposure" ||
      convention.kind === "session_object_must_come_from_trusted_helper" ||
      convention.kind === "api_route_requires_authorization" ||
      convention.kind === "api_route_requires_tenant_scope"
    )
    .map((convention) => ({
      id: convention.id,
      kind: convention.kind,
      enforcement_mode: convention.enforcement_mode,
      enforcement_capability: convention.enforcement_capability,
      severity: convention.severity
    }));
}

function sensitiveResponseRoutes(responseFieldFacts: FactRecord[]) {
  const byRoute = new Map<string, {
    route_id: string;
    file_path: string;
    emitted_field_count: number;
  }>();
  for (const fact of responseFieldFacts) {
    const value = parseResponseEmitsFieldValue(fact.value);
    const routeId = value.route_id ?? `route:${fact.file_path}:unknown`;
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      emitted_field_count: 0
    };
    if (value.field_path) {
      entry.emitted_field_count += 1;
    }
    byRoute.set(routeId, entry);
  }
  return [...byRoute.values()].sort((left, right) => left.route_id.localeCompare(right.route_id));
}

function sensitiveFieldSources(facts: FactRecord[]) {
  return [...new Set(facts
    .map((fact) => parseSensitiveFieldDeclaredValue(fact.value).source)
    .filter((source): source is string => typeof source === "string"))].sort();
}

function secretReadSummaries(facts: FactRecord[]) {
  return facts
    .map((fact) => {
      const value = parseSecretReadValue(fact.value);
      return {
        file_path: fact.file_path,
        source: value.source ?? "unknown",
        secret_class: value.secret_class ?? "unknown"
      };
    })
    .sort((left, right) =>
      `${left.file_path}:${left.source}:${left.secret_class}`
        .localeCompare(`${right.file_path}:${right.source}:${right.secret_class}`)
    );
}

function sessionTrustRoutes(sessionFacts: FactRecord[]) {
  const byRoute = new Map<string, {
    route_id: string;
    file_path: string;
    trusted_source_count: number;
    untrusted_source_count: number;
  }>();

  for (const fact of sessionFacts) {
    const value = parseSessionReadValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      trusted_source_count: 0,
      untrusted_source_count: 0
    };
    if (value.trust === "trusted") {
      entry.trusted_source_count += 1;
    } else if (value.trust === "untrusted") {
      entry.untrusted_source_count += 1;
    }
    byRoute.set(routeId, entry);
  }

  return [...byRoute.values()]
    .sort((left, right) => left.route_id.localeCompare(right.route_id))
    .map((entry) => ({
      route_id: entry.route_id,
      file_path: entry.file_path,
      proof_status: "advisory_only",
      advisory_trusted_source_count: entry.trusted_source_count,
      advisory_untrusted_source_count: entry.untrusted_source_count
    }));
}

function authorizationRoutes(authorizationFacts: FactRecord[]) {
  const byRoute = new Map<string, {
    route_id: string;
    file_path: string;
    guard_ids: Set<string>;
    role_count: number;
  }>();

  for (const fact of authorizationFacts) {
    const value = parseAuthorizationGuardValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      guard_ids: new Set<string>(),
      role_count: 0
    };
    entry.guard_ids.add(value.policy_id ?? value.guard_id ?? fact.name);
    entry.role_count += Array.isArray(value.roles)
      ? value.roles.filter((role) => typeof role === "string").length
      : 0;
    byRoute.set(routeId, entry);
  }

  return [...byRoute.values()]
    .sort((left, right) => left.route_id.localeCompare(right.route_id))
    .map((entry) => ({
      route_id: entry.route_id,
      file_path: entry.file_path,
      proof_status: "advisory_only",
      advisory_guard_ids: [...entry.guard_ids].sort(),
      advisory_role_count: entry.role_count
    }));
}

function tenantScopeRoutes(tenantSourceFacts: FactRecord[], tenantGuardFacts: FactRecord[]) {
  const byRoute = new Map<string, {
    route_id: string;
    file_path: string;
    tenant_keys: Set<string>;
    trusted_source_count: number;
    predicate_count: number;
  }>();

  for (const fact of tenantSourceFacts) {
    const value = parseTenantSourceValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      tenant_keys: new Set<string>(),
      trusted_source_count: 0,
      predicate_count: 0
    };
    entry.tenant_keys.add(value.key ?? fact.name);
    if (value.trusted === true) {
      entry.trusted_source_count += 1;
    }
    byRoute.set(routeId, entry);
  }

  for (const fact of tenantGuardFacts) {
    const value = parseTenantGuardValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      tenant_keys: new Set<string>(),
      trusted_source_count: 0,
      predicate_count: 0
    };
    entry.tenant_keys.add(value.tenant_key ?? fact.name);
    entry.predicate_count += 1;
    byRoute.set(routeId, entry);
  }

  return [...byRoute.values()]
    .sort((left, right) => left.route_id.localeCompare(right.route_id))
    .map((entry) => ({
      route_id: entry.route_id,
      file_path: entry.file_path,
      proof_status: "advisory_only",
      advisory_tenant_keys: [...entry.tenant_keys].sort(),
      advisory_trusted_source_count: entry.trusted_source_count,
      advisory_predicate_count: entry.predicate_count
    }));
}

function requestValidationRoutes(inputFacts: FactRecord[], validatedUseFacts: FactRecord[]) {
  const byRoute = new Map<string, {
    route_id: string;
    file_path: string;
    input_sources: Set<string>;
    validated_sink_kinds: Set<string>;
  }>();

  for (const fact of inputFacts) {
    const value = parseRequestInputReadValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      input_sources: new Set<string>(),
      validated_sink_kinds: new Set<string>()
    };
    if (value.source) {
      entry.input_sources.add(value.source);
    }
    byRoute.set(routeId, entry);
  }

  for (const fact of validatedUseFacts) {
    const value = parseValidatedInputUsedValue(fact.value);
    const routeId = routeIdForFact(value.route_id, fact.file_path);
    const entry = byRoute.get(routeId) ?? {
      route_id: routeId,
      file_path: fact.file_path,
      input_sources: new Set<string>(),
      validated_sink_kinds: new Set<string>()
    };
    if (value.sink_kind) {
      entry.validated_sink_kinds.add(value.sink_kind);
    }
    byRoute.set(routeId, entry);
  }

  return [...byRoute.values()]
    .sort((left, right) => left.route_id.localeCompare(right.route_id))
    .map((entry) => ({
      route_id: entry.route_id,
      file_path: entry.file_path,
      proof_status: "not_evaluated",
      proven: false,
      input_sources: [...entry.input_sources].sort(),
      validated_sink_kinds: [...entry.validated_sink_kinds].sort()
    }));
}

function parseRequestInputReadValue(value: string | undefined): RequestInputReadValue {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as RequestInputReadValue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseValidatedInputUsedValue(value: string | undefined): ValidatedInputUsedValue {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as ValidatedInputUsedValue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseSessionReadValue(value: string | undefined): SessionReadValue {
  return parseJsonObject<SessionReadValue>(value);
}

function parseAuthorizationGuardValue(value: string | undefined): AuthorizationGuardValue {
  return parseJsonObject<AuthorizationGuardValue>(value);
}

function parseTenantSourceValue(value: string | undefined): TenantSourceValue {
  return parseJsonObject<TenantSourceValue>(value);
}

function parseTenantGuardValue(value: string | undefined): TenantGuardValue {
  return parseJsonObject<TenantGuardValue>(value);
}

function parseResponseEmitsFieldValue(value: string | undefined): ResponseEmitsFieldValue {
  return parseJsonObject<ResponseEmitsFieldValue>(value);
}

function parseSensitiveFieldDeclaredValue(value: string | undefined): SensitiveFieldDeclaredValue {
  return parseJsonObject<SensitiveFieldDeclaredValue>(value);
}

function parseSecretReadValue(value: string | undefined): SecretReadValue {
  return parseJsonObject<SecretReadValue>(value);
}

function parseJsonObject<T>(value: string | undefined): T {
  if (!value) {
    return {} as T;
  }
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" ? parsed : {} as T;
  } catch {
    return {} as T;
  }
}

function middlewareCoverageRoutes(facts: FactRecord[]) {
  const byPath = new Map<string, {
    file_path: string;
    proven: true;
    protection_kinds: Set<string>;
    middleware_ids: Set<string>;
  }>();

  for (const fact of facts) {
    const value = parseMiddlewareCoverageValue(fact.value);
    const entry = byPath.get(fact.file_path) ?? {
      file_path: fact.file_path,
      proven: true,
      protection_kinds: new Set<string>(),
      middleware_ids: new Set<string>()
    };
    if (value.protection_kind) {
      entry.protection_kinds.add(value.protection_kind);
    }
    if (value.middleware_id) {
      entry.middleware_ids.add(value.middleware_id);
    }
    byPath.set(fact.file_path, entry);
  }

  return [...byPath.values()]
    .sort((left, right) => left.file_path.localeCompare(right.file_path))
    .map((entry) => ({
      file_path: entry.file_path,
      proven: entry.proven,
      protection_kinds: [...entry.protection_kinds].sort(),
      middleware_ids: [...entry.middleware_ids].sort()
    }));
}

function parseMiddlewareCoverageValue(value: string | undefined): MiddlewareCoverageValue {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as MiddlewareCoverageValue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function middlewareParserGaps(parserGaps: ParserGap[]) {
  return parserGaps
    .filter((gap) => gap.message === "unsupported_dynamic_middleware_matcher")
    .map((gap) => ({
      reason: gap.message,
      blocking: gap.confidence_impact === "blocks_enforcement"
    }));
}

function requestValidationParserGaps(parserGaps: ParserGap[]) {
  return parserGaps
    .filter((gap) => gap.message === "unsupported_request_input_spread")
    .map((gap) => ({
      reason: gap.message,
      blocking: gap.confidence_impact === "blocks_enforcement"
    }));
}

function phase6ParserGaps(parserGaps: ParserGap[]) {
  return parserGaps
    .filter((gap) =>
      gap.message === "unsupported_dynamic_outbound_url" ||
      gap.message === "unsupported_dynamic_cors_origin"
    )
    .map((gap) => ({
      reason: gap.message,
      blocking: gap.confidence_impact === "blocks_enforcement"
    }));
}

function tenantParserGaps(parserGaps: ParserGap[]) {
  return parserGaps
    .filter((gap) =>
      gap.message === "unsupported_tenant_dynamic_property" ||
      gap.message === "unsupported_tenant_query_object_alias" ||
      gap.message === "unsupported_session_nested_destructure"
    )
    .map((gap) => ({
      reason: gap.message,
      blocking: gap.confidence_impact === "blocks_enforcement"
    }));
}
