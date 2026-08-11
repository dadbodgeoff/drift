import type {
  AcceptedConvention,
  ConventionCandidate,
  FactRecord,
  ParserGap,
  SecurityBoundaryProof
} from "@drift/core";

export type SecurityArchitectureAuditAreaKey =
  | "auth_boundary"
  | "middleware_coverage"
  | "data_access"
  | "request_validation"
  | "session_trust"
  | "authorization"
  | "tenant_scope"
  | "sensitive_response"
  | "secret_exposure"
  | "ssrf"
  | "raw_sql"
  | "cors"
  | "csrf"
  | "rate_limit";

export type SecurityArchitectureSemanticRole =
  | "auth_wrapper"
  | "session_source"
  | "body_parser"
  | "validator"
  | "rate_limiter"
  | "error_helper"
  | "tenant_precondition"
  | "tenant_predicate"
  | "data_access"
  | "outbound_request"
  | "raw_sql"
  | "parameterized_sql"
  | "cors_policy"
  | "csrf_guard"
  | "sensitive_field"
  | "response_field"
  | "middleware"
  | "authorization_guard"
  | "secret_reference"
  | "unknown";

export type SecurityArchitectureProofTruth =
  | "accepted_proof"
  | "candidate_only"
  | "fact_inventory"
  | "not_observed";

export type SecurityArchitecturePriority = "high" | "medium" | "low";
export type SecurityArchitectureReportSurface = "priority" | "inventory";

export interface BuildSecurityArchitectureAuditInput {
  repo_id: string;
  scan_id: string | null;
  facts: FactRecord[];
  candidates: ConventionCandidate[];
  accepted_conventions: AcceptedConvention[];
  parser_gaps: ParserGap[];
  proofs: SecurityBoundaryProof[];
}

export interface SecurityArchitectureAuditPattern {
  pattern: string;
  semantic_role: SecurityArchitectureSemanticRole;
  fact_count: number;
  file_count: number;
  files: SecurityArchitectureAuditFileRef[];
  accepted: boolean;
  candidate_only: boolean;
  candidate_ids: string[];
  accepted_convention_ids: string[];
  proof_truth: SecurityArchitectureProofTruth;
  priority: SecurityArchitecturePriority;
  report_surface: SecurityArchitectureReportSurface;
}

export interface SecurityArchitectureAuditFileRef {
  file_path: string;
  start_line: number;
}

export interface SecurityArchitectureAuditArea {
  key: SecurityArchitectureAuditAreaKey;
  title: string;
  observed: boolean;
  pattern_count: number;
  fact_count: number;
  candidate_only_count: number;
  accepted_count: number;
  proof_count: number;
  parser_gap_count: number;
  priority_count: number;
  inventory_count: number;
  patterns: SecurityArchitectureAuditPattern[];
  priority_patterns: SecurityArchitectureAuditPattern[];
}

export interface SecurityArchitectureAudit {
  response_schema: "drift.security.audit.v1";
  repo_id: string;
  scan_id: string | null;
  summary: {
    area_count: number;
    observed_area_count: number;
    api_route_file_count: number;
    fact_count: number;
    candidate_count: number;
    accepted_convention_count: number;
    proof_count: number;
    parser_gap_count: number;
    candidate_only_pattern_count: number;
    priority_pattern_count: number;
    inventory_pattern_count: number;
    signal_to_noise_ratio: number;
  };
  areas: Record<SecurityArchitectureAuditAreaKey, SecurityArchitectureAuditArea>;
  next_steps: string[];
  redactions: {
    source_content_included: false;
    raw_fact_values_included: false;
    snippets_included: false;
  };
}

interface PatternSeed {
  area: SecurityArchitectureAuditAreaKey;
  pattern: string;
  semanticRole: SecurityArchitectureSemanticRole;
  file?: SecurityArchitectureAuditFileRef;
  candidateId?: string;
  acceptedConventionId?: string;
  proofBacked?: boolean;
}

const AREA_TITLES: Record<SecurityArchitectureAuditAreaKey, string> = {
  auth_boundary: "Auth boundary",
  middleware_coverage: "Middleware coverage",
  data_access: "Data access",
  request_validation: "Request validation",
  session_trust: "Session trust",
  authorization: "Authorization",
  tenant_scope: "Tenant scope",
  sensitive_response: "Sensitive response",
  secret_exposure: "Secret exposure",
  ssrf: "SSRF",
  raw_sql: "Raw SQL",
  cors: "CORS",
  csrf: "CSRF",
  rate_limit: "Rate limit"
};

const AREA_KEYS = Object.keys(AREA_TITLES) as SecurityArchitectureAuditAreaKey[];

const CONVENTION_AREA: Record<string, SecurityArchitectureAuditAreaKey> = {
  api_route_requires_auth_helper: "auth_boundary",
  middleware_must_cover_routes: "middleware_coverage",
  api_route_no_direct_data_access: "data_access",
  api_route_requires_service_delegation: "data_access",
  api_route_requires_request_validation: "request_validation",
  session_object_must_come_from_trusted_helper: "session_trust",
  api_route_requires_authorization: "authorization",
  api_route_requires_tenant_scope: "tenant_scope",
  api_route_forbids_sensitive_response_fields: "sensitive_response",
  api_route_forbids_secret_exposure: "secret_exposure",
  api_route_forbids_untrusted_ssrf: "ssrf",
  api_route_forbids_raw_sql_without_params: "raw_sql",
  api_route_cors_must_match_policy: "cors",
  api_route_requires_csrf_for_mutation: "csrf",
  api_route_requires_rate_limit: "rate_limit"
};

export function buildSecurityArchitectureAudit(input: BuildSecurityArchitectureAuditInput): SecurityArchitectureAudit {
  const patternMap = new Map<string, SecurityArchitectureAuditPattern>();
  const proofedAreas = proofedAreaCounts(input.proofs);

  for (const fact of input.facts) {
    for (const seed of classifyFact(fact)) {
      upsertPattern(patternMap, seed);
    }
  }

  for (const candidate of input.candidates) {
    const area = CONVENTION_AREA[candidate.kind];
    if (!area) {
      continue;
    }
    for (const pattern of candidatePatterns(candidate)) {
      upsertPattern(patternMap, {
        area,
        pattern,
        semanticRole: semanticRoleForConvention(area, pattern),
        candidateId: candidate.id
      });
    }
  }

  for (const convention of input.accepted_conventions) {
    const area = CONVENTION_AREA[convention.kind];
    if (!area) {
      continue;
    }
    for (const pattern of acceptedConventionPatterns(convention)) {
      upsertPattern(patternMap, {
        area,
        pattern,
        semanticRole: semanticRoleForConvention(area, pattern),
        acceptedConventionId: convention.id,
        proofBacked: true
      });
    }
  }

  const areas = Object.fromEntries(AREA_KEYS.map((key) => {
    const patterns = [...patternMap.values()]
      .filter((pattern) => patternKeyArea(pattern) === key)
      .map(finalizePattern)
      .sort(comparePatterns);
    return [key, {
      key,
      title: AREA_TITLES[key],
      observed: patterns.length > 0 || (proofedAreas.get(key) ?? 0) > 0,
      pattern_count: patterns.length,
      fact_count: patterns.reduce((count, pattern) => count + pattern.fact_count, 0),
      candidate_only_count: patterns.filter((pattern) => pattern.candidate_only).length,
      accepted_count: patterns.filter((pattern) => pattern.accepted).length,
      proof_count: proofedAreas.get(key) ?? 0,
      parser_gap_count: input.parser_gaps.filter((gap) => parserGapArea(gap) === key).length,
      priority_count: patterns.filter((pattern) => pattern.report_surface === "priority").length,
      inventory_count: patterns.filter((pattern) => pattern.report_surface === "inventory").length,
      patterns,
      priority_patterns: patterns.filter((pattern) => pattern.report_surface === "priority")
    }];
  })) as Record<SecurityArchitectureAuditAreaKey, SecurityArchitectureAuditArea>;

  const candidateOnlyPatternCount = Object.values(areas)
    .reduce((count, area) => count + area.candidate_only_count, 0);
  const priorityPatternCount = Object.values(areas)
    .reduce((count, area) => count + area.priority_count, 0);
  const inventoryPatternCount = Object.values(areas)
    .reduce((count, area) => count + area.inventory_count, 0);

  return {
    response_schema: "drift.security.audit.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    summary: {
      area_count: AREA_KEYS.length,
      observed_area_count: Object.values(areas).filter((area) => area.observed).length,
      api_route_file_count: new Set(input.facts
        .filter((fact) => fact.kind === "file_role_detected" && fact.name === "api_route")
        .map((fact) => fact.file_path)).size,
      fact_count: input.facts.length,
      candidate_count: input.candidates.length,
      accepted_convention_count: input.accepted_conventions.length,
      proof_count: input.proofs.length,
      parser_gap_count: input.parser_gaps.length,
      candidate_only_pattern_count: candidateOnlyPatternCount,
      priority_pattern_count: priorityPatternCount,
      inventory_pattern_count: inventoryPatternCount,
      signal_to_noise_ratio: Number((priorityPatternCount / Math.max(1, inventoryPatternCount)).toFixed(2))
    },
    areas,
    next_steps: nextSteps(candidateOnlyPatternCount, input.proofs.length, input.parser_gaps.length),
    redactions: {
      source_content_included: false,
      raw_fact_values_included: false,
      snippets_included: false
    }
  };
}

function upsertPattern(patternMap: Map<string, SecurityArchitectureAuditPattern>, seed: PatternSeed): void {
  const key = `${seed.area}:${seed.pattern}`;
  const existing = patternMap.get(key);
  const pattern = existing ?? {
    pattern: seed.pattern,
    semantic_role: seed.semanticRole,
    fact_count: 0,
    file_count: 0,
    files: [],
    accepted: false,
    candidate_only: false,
    candidate_ids: [],
    accepted_convention_ids: [],
    proof_truth: "not_observed",
    priority: "low",
    report_surface: "inventory"
  };
  Object.defineProperty(pattern, "__area", { value: seed.area, enumerable: false, configurable: true });
  pattern.semantic_role = strongestSemanticRole(pattern.semantic_role, seed.semanticRole);
  if (seed.file) {
    pattern.fact_count += 1;
    if (!pattern.files.some((file) => file.file_path === seed.file?.file_path && file.start_line === seed.file.start_line)) {
      pattern.files.push(seed.file);
    }
  }
  if (seed.candidateId && !pattern.candidate_ids.includes(seed.candidateId)) {
    pattern.candidate_ids.push(seed.candidateId);
  }
  if (seed.acceptedConventionId && !pattern.accepted_convention_ids.includes(seed.acceptedConventionId)) {
    pattern.accepted_convention_ids.push(seed.acceptedConventionId);
  }
  if (seed.proofBacked) {
    pattern.accepted = true;
  }
  pattern.file_count = new Set(pattern.files.map((file) => file.file_path)).size;
  patternMap.set(key, pattern);
}

function finalizePattern(pattern: SecurityArchitectureAuditPattern): SecurityArchitectureAuditPattern {
  const accepted = pattern.accepted || pattern.accepted_convention_ids.length > 0;
  const candidateOnly = pattern.candidate_ids.length > 0 && !accepted;
  pattern.accepted = accepted;
  pattern.candidate_only = candidateOnly;
  pattern.proof_truth = accepted
    ? "accepted_proof"
    : candidateOnly
      ? "candidate_only"
      : pattern.fact_count > 0
        ? "fact_inventory"
        : "not_observed";
  pattern.priority = patternPriority(pattern);
  pattern.report_surface = pattern.priority === "low" ? "inventory" : "priority";
  pattern.files.sort((left, right) => left.file_path.localeCompare(right.file_path) || left.start_line - right.start_line);
  pattern.candidate_ids.sort();
  pattern.accepted_convention_ids.sort();
  return pattern;
}

function patternKeyArea(pattern: SecurityArchitectureAuditPattern): SecurityArchitectureAuditAreaKey {
  return (pattern as SecurityArchitectureAuditPattern & { __area: SecurityArchitectureAuditAreaKey }).__area;
}

function classifyFact(fact: FactRecord): PatternSeed[] {
  const file = { file_path: fact.file_path, start_line: fact.start_line };
  if (fact.kind === "symbol_called") {
    return classifySymbolCall(fact, file);
  }
  if (fact.kind === "request_validation_called") {
    return [{ area: "request_validation", pattern: fact.name, semanticRole: "validator", file }];
  }
  if (fact.kind === "authorization_guard_called") {
    return [{ area: "authorization", pattern: fact.name, semanticRole: "authorization_guard", file }];
  }
  if (fact.kind === "tenant_source") {
    return [{ area: "tenant_scope", pattern: fact.name, semanticRole: "tenant_precondition", file }];
  }
  if (fact.kind === "tenant_guard_called") {
    return [{ area: "tenant_scope", pattern: fact.name, semanticRole: "tenant_predicate", file }];
  }
  if (fact.kind === "middleware_protects_route") {
    return [{ area: "middleware_coverage", pattern: fact.name, semanticRole: "middleware", file }];
  }
  if (fact.kind === "data_operation_detected") {
    if (isGenericDataOperationName(fact.name)) {
      return [];
    }
    return [{ area: "data_access", pattern: fact.name, semanticRole: "data_access", file }];
  }
  if (fact.kind === "outbound_request_called") {
    return [{
      area: "ssrf",
      pattern: outboundUrlSource(fact.value),
      semanticRole: "outbound_request",
      file
    }];
  }
  if (fact.kind === "raw_sql_called") {
    return [{ area: "raw_sql", pattern: fact.name, semanticRole: "raw_sql", file }];
  }
  if (fact.kind === "parameterized_sql_used") {
    return [{ area: "raw_sql", pattern: fact.name, semanticRole: "parameterized_sql", file }];
  }
  if (fact.kind === "cors_policy_declared") {
    return [{ area: "cors", pattern: fact.name, semanticRole: "cors_policy", file }];
  }
  if (fact.kind === "sensitive_field_declared" || fact.kind === "response_emits_field") {
    return [{ area: "sensitive_response", pattern: fact.name, semanticRole: "sensitive_field", file }];
  }
  if (fact.kind === "secret_read") {
    return [{ area: "secret_exposure", pattern: fact.name, semanticRole: "secret_reference", file }];
  }
  return [];
}

function classifySymbolCall(fact: FactRecord, file: SecurityArchitectureAuditFileRef): PatternSeed[] {
  const name = fact.name;
  const lower = name.toLowerCase();
  const seeds: PatternSeed[] = [];

  if (name === "parseRequestBody") {
    seeds.push({ area: "request_validation", pattern: name, semanticRole: "body_parser", file });
    return seeds;
  }
  if (isParserMethod(name) && fact.value) {
    seeds.push({ area: "request_validation", pattern: `${safePattern(fact.value)}.${name}`, semanticRole: "validator", file });
    return seeds;
  }
  if (looksLikeValidator(lower)) {
    seeds.push({ area: "request_validation", pattern: name, semanticRole: "validator", file });
  }
  if (looksLikeAuthBoundary(lower)) {
    seeds.push({ area: "auth_boundary", pattern: name, semanticRole: "auth_wrapper", file });
  }
  if (looksLikeSessionSource(lower)) {
    seeds.push({ area: "session_trust", pattern: name, semanticRole: "session_source", file });
  }
  if (looksLikeAuthorizationGuard(lower)) {
    seeds.push({ area: "authorization", pattern: name, semanticRole: "authorization_guard", file });
  }
  if (looksLikeTenantPrecondition(lower)) {
    seeds.push({ area: "tenant_scope", pattern: name, semanticRole: "tenant_precondition", file });
  }
  if (looksLikeCsrfGuard(lower)) {
    seeds.push({ area: "csrf", pattern: name, semanticRole: "csrf_guard", file });
  }
  if (name === "exceededLimitError") {
    seeds.push({ area: "rate_limit", pattern: name, semanticRole: "error_helper", file });
    return seeds;
  }
  if (looksLikeRateLimiter(lower)) {
    seeds.push({ area: "rate_limit", pattern: name, semanticRole: "rate_limiter", file });
  }
  if (looksLikeCorsPolicy(lower)) {
    seeds.push({ area: "cors", pattern: name, semanticRole: "cors_policy", file });
  }
  return seeds;
}

function candidatePatterns(candidate: ConventionCandidate): string[] {
  if (candidate.status === "rejected") {
    return [];
  }
  const candidates = [
    ...unknownStringArray(candidate.matcher, "required_calls"),
    ...unknownStringArray(candidate.matcher, "forbidden_imports"),
    ...requiresSymbols(candidate.requires)
  ];
  return uniqueSorted(candidates.map(safePattern).filter(Boolean));
}

function acceptedConventionPatterns(convention: AcceptedConvention): string[] {
  const candidates = [
    ...unknownStringArray(convention.matcher, "required_calls"),
    ...unknownStringArray(convention.matcher, "forbidden_imports"),
    ...requiresSymbols(convention.requires)
  ];
  return uniqueSorted(candidates.map(safePattern).filter(Boolean));
}

function requiresSymbols(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const symbolKeys = new Set([
    "auth_helpers",
    "validators",
    "schemas",
    "authorization_guards",
    "tenant_guards",
    "response_serializers",
    "secret_sanitizers",
    "ssrf_sanitizers",
    "allowlist_proofs",
    "parameterized_sql_helpers",
    "csrf_guards",
    "rate_limit_helpers",
    "cors_policies"
  ]);
  return Object.entries(record).flatMap(([key, entry]) => {
    if (!symbolKeys.has(key)) {
      return [];
    }
    if (!Array.isArray(entry)) {
      return typeof entry === "string" ? [entry] : [];
    }
    return entry.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).symbol === "string") {
        return [(item as Record<string, string>).symbol];
      }
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).imported_name === "string") {
        return [(item as Record<string, string>).imported_name];
      }
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).local_name === "string") {
        return [(item as Record<string, string>).local_name];
      }
      return [];
    });
  });
}

function unknownStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function semanticRoleForConvention(
  area: SecurityArchitectureAuditAreaKey,
  pattern: string
): SecurityArchitectureSemanticRole {
  const lower = pattern.toLowerCase();
  if (area === "request_validation") {
    return pattern === "parseRequestBody" ? "body_parser" : "validator";
  }
  if (area === "auth_boundary") {
    return "auth_wrapper";
  }
  if (area === "session_trust") {
    return "session_source";
  }
  if (area === "authorization") {
    return "authorization_guard";
  }
  if (area === "tenant_scope") {
    return lower.includes("where") || lower.includes("predicate") ? "tenant_predicate" : "tenant_precondition";
  }
  if (area === "rate_limit") {
    return pattern === "exceededLimitError" ? "error_helper" : "rate_limiter";
  }
  if (area === "data_access") {
    return "data_access";
  }
  if (area === "ssrf") {
    return "outbound_request";
  }
  if (area === "raw_sql") {
    return "raw_sql";
  }
  if (area === "cors") {
    return "cors_policy";
  }
  if (area === "csrf") {
    return "csrf_guard";
  }
  if (area === "sensitive_response") {
    if (lower.includes("sanitize") || lower.includes("redact") || lower.includes("mask") || lower.includes("serializer")) {
      return "response_field";
    }
    return "sensitive_field";
  }
  if (area === "secret_exposure") {
    return "secret_reference";
  }
  if (area === "middleware_coverage") {
    return "middleware";
  }
  return "unknown";
}

function proofedAreaCounts(proofs: SecurityBoundaryProof[]): Map<SecurityArchitectureAuditAreaKey, number> {
  const counts = new Map<SecurityArchitectureAuditAreaKey, number>();
  for (const proof of proofs) {
    for (const contract of proof.contracts) {
      const area = CONVENTION_AREA[contract.kind];
      if (area && contract.matched && proof.result.proof_status === "proven") {
        counts.set(area, (counts.get(area) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function parserGapArea(gap: ParserGap): SecurityArchitectureAuditAreaKey | null {
  const kinds = (gap as ParserGap & { affected_contract_kinds?: string[] }).affected_contract_kinds ?? [];
  for (const kind of kinds) {
    const area = CONVENTION_AREA[kind];
    if (area) {
      return area;
    }
  }
  return null;
}

function outboundUrlSource(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const source = parsed.url_source;
    return typeof source === "string" && source.length > 0 ? source : "unknown";
  } catch {
    return "unknown";
  }
}

function safePattern(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/https?:\/\/\S+/g, "url")
    .replace(/['"`]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function isParserMethod(name: string): boolean {
  return name === "parse" || name === "parseAsync" || name === "safeParse" || name === "safeParseAsync";
}

function looksLikeValidator(lower: string): boolean {
  if (lower.startsWith("revalidate") || lower.includes("permission") || lower.includes("role")) {
    return false;
  }
  return lower.includes("schema") || lower.includes("validate") || lower.includes("validator");
}

function looksLikeAuthBoundary(lower: string): boolean {
  return lower === "withworkspace" ||
    lower === "withsession" ||
    lower.includes("requireauth") ||
    lower.includes("requireuser") ||
    lower.includes("authenticate");
}

function looksLikeSessionSource(lower: string): boolean {
  return lower.includes("session") || lower.includes("getuser") || lower.includes("currentuser");
}

function looksLikeAuthorizationGuard(lower: string): boolean {
  if (isLifecycleEventLike(lower) || lower.includes("uri") || lower.endsWith("url")) {
    return false;
  }
  return lower.includes("requirepermission") ||
    lower.includes("requiredpermission") ||
    lower.includes("requirerole") ||
    lower.includes("requiredrole") ||
    lower.includes("canaccess") ||
    lower.includes("authorize");
}

function looksLikeTenantPrecondition(lower: string): boolean {
  return lower.includes("tenant") &&
    (lower.includes("scope") ||
      lower.includes("guard") ||
      lower.includes("filter") ||
      lower.includes("where") ||
      lower.startsWith("require"));
}

function looksLikeCsrfGuard(lower: string): boolean {
  return lower.includes("csrf");
}

function looksLikeRateLimiter(lower: string): boolean {
  if (lower.includes("error") || lower.includes("exceeded")) {
    return false;
  }
  return lower.includes("ratelimit") || lower.includes("rate_limit") || lower.includes("throttle");
}

function looksLikeCorsPolicy(lower: string): boolean {
  return lower === "cors" || lower.includes("cors");
}

function strongestSemanticRole(
  current: SecurityArchitectureSemanticRole,
  next: SecurityArchitectureSemanticRole
): SecurityArchitectureSemanticRole {
  if (current === "unknown") {
    return next;
  }
  if (current === "body_parser" || next === "body_parser") {
    return current === "validator" ? current : next;
  }
  return current;
}

function comparePatterns(left: SecurityArchitectureAuditPattern, right: SecurityArchitectureAuditPattern): number {
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  return Number(right.accepted) - Number(left.accepted) ||
    Number(right.candidate_only) - Number(left.candidate_only) ||
    priorityWeight[right.priority] - priorityWeight[left.priority] ||
    right.fact_count - left.fact_count ||
    left.pattern.localeCompare(right.pattern);
}

function patternPriority(pattern: SecurityArchitectureAuditPattern): SecurityArchitecturePriority {
  if (pattern.accepted || pattern.proof_truth === "accepted_proof") {
    return "high";
  }
  if (pattern.candidate_only) {
    return isWeakCandidatePattern(pattern) ? "low" : "high";
  }
  if (pattern.proof_truth !== "fact_inventory") {
    return "low";
  }
  if (pattern.semantic_role === "raw_sql" ||
    pattern.semantic_role === "secret_reference" ||
    pattern.semantic_role === "tenant_predicate" ||
    pattern.semantic_role === "authorization_guard") {
    return "high";
  }
  if (pattern.semantic_role === "outbound_request") {
    return pattern.pattern === "request_input" || pattern.pattern === "dynamic" ? "high" : "low";
  }
  if (pattern.semantic_role === "sensitive_field") {
    return isGenericSensitiveField(pattern.pattern) ? "low" : "medium";
  }
  if (pattern.semantic_role === "data_access" ||
    pattern.semantic_role === "rate_limiter" ||
    pattern.semantic_role === "cors_policy" ||
    pattern.semantic_role === "parameterized_sql") {
    return "medium";
  }
  return "low";
}

function isWeakCandidatePattern(pattern: SecurityArchitectureAuditPattern): boolean {
  return pattern.semantic_role === "body_parser" ||
    pattern.semantic_role === "error_helper" ||
    pattern.semantic_role === "response_field" ||
    pattern.semantic_role === "tenant_precondition" ||
    pattern.semantic_role === "session_source";
}

function isGenericSensitiveField(pattern: string): boolean {
  return new Set([
    "id",
    "ids",
    "_id",
    "name",
    "slug",
    "success",
    "ok",
    "error",
    "message",
    "status",
    "count",
    "data",
    "deleted",
    "applications",
    "domains",
    "url",
    "urls",
    "clickid",
    "inviteids",
    "iframeable"
  ]).has(pattern.toLowerCase());
}

function isGenericDataOperationName(name: string): boolean {
  return new Set(["then", "catch", "finally", "map", "filter", "forEach", "reduce", "array", "json"]).has(name);
}

function isLifecycleEventLike(lower: string): boolean {
  return lower.endsWith("authorized") ||
    lower.endsWith("deauthorized") ||
    lower.endsWith("completed") ||
    lower.endsWith("created") ||
    lower.endsWith("updated") ||
    lower.endsWith("deleted") ||
    lower.endsWith("failed");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function nextSteps(candidateOnlyPatternCount: number, proofCount: number, parserGapCount: number): string[] {
  const steps = ["Run drift check --json to verify proof-backed enforcement status."];
  if (candidateOnlyPatternCount > 0) {
    steps.push("Review candidate-only security patterns before accepting enforcement.");
  }
  if (proofCount === 0) {
    steps.push("Run a proof-backed security check before treating audit inventory as enforcement truth.");
  }
  if (parserGapCount > 0) {
    steps.push("Resolve parser gaps before relying on complete route security coverage.");
  }
  return steps;
}
