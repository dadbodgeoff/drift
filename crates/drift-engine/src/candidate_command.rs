use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use drift_engine::next_routes::API_ROUTE_SCOPE_GLOBS;

use crate::protocol::{
    CandidateRequest, CandidateResult, CheckFact, ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION,
    EngineCandidate, EngineCandidateEvidenceRef, EngineCompleteness, GraphEvidence,
    adapter_versions, capability_stats, engine_stats,
};

struct GraphImportEvidence {
    source: String,
    local_name: String,
    file_path: String,
    evidence_id: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    fact_ids: Vec<String>,
    file_hash: String,
}

pub fn infer_candidates(request: CandidateRequest) -> CandidateResult {
    let started = Instant::now();
    let resolved_imports = resolved_imports_by_fact(&request);
    let service_files = role_files(&request, "service_module");
    let data_access_files = data_access_files(&request, &service_files);
    let graph_api_route_files = graph_role_files(&request, "api_route")
        .into_iter()
        .filter(|file_path| is_candidate_scope_file(file_path))
        .collect::<BTreeSet<_>>();
    let api_route_files = request
        .scan
        .facts
        .iter()
        .filter(|fact| fact.kind == "file_role_detected" && fact.name == "api_route")
        .filter(|fact| is_candidate_scope_file(&fact.file_path))
        .map(|fact| fact.file_path.as_str())
        .collect::<BTreeSet<_>>();
    let scope_files = api_route_files
        .iter()
        .copied()
        .chain(graph_api_route_files.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    let scope_file_count = scope_files.len();
    let diff_changed_files = request
        .diff_changed_files
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let imports = request
        .scan
        .facts
        .iter()
        .filter(|fact| fact.kind == "import_used")
        .filter(|fact| api_route_files.contains(fact.file_path.as_str()))
        .collect::<Vec<_>>();
    let data_imports = imports
        .iter()
        .copied()
        .filter(|fact| {
            fact.value.as_deref().is_some_and(|source| {
                is_data_access_source(source)
                    || resolved_imports
                        .get(&import_key(fact))
                        .is_some_and(|resolved| {
                            is_data_access_source(resolved)
                                || data_access_files.contains(resolved.as_str())
                        })
            })
        })
        .collect::<Vec<_>>();
    let graph_data_imports = graph_data_access_imports(&request);
    let service_imports = imports
        .iter()
        .copied()
        .filter(|fact| fact.value.as_deref().is_some_and(is_service_source))
        .collect::<Vec<_>>();
    let file_hashes = request
        .scan
        .file_snapshots
        .iter()
        .map(|snapshot| (snapshot.file_path.as_str(), snapshot.content_hash.as_str()))
        .collect::<BTreeMap<_, _>>();
    let graph_fingerprint = graph_fingerprint(&request);
    let mut candidates = Vec::new();

    if !data_imports.is_empty() || !graph_data_imports.is_empty() {
        let forbidden_imports = data_imports
            .iter()
            .filter_map(|fact| fact.value.as_deref())
            .chain(
                graph_data_imports
                    .iter()
                    .map(|import| import.source.as_str()),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let scope = json!({
            "path_globs": API_ROUTE_SCOPE_GLOBS,
            "file_roles": ["api_route"]
        });
        let matcher = json!({
            "kind": "api_route_no_direct_data_access",
            "forbidden_imports": forbidden_imports,
            "applies_to_file_roles": ["api_route"]
        });
        let evidence_refs = combined_evidence_refs(
            &request.scan.scan_id,
            &data_imports,
            &graph_data_imports,
            &file_hashes,
            "supporting",
        );
        let counterexample_refs = Vec::new();
        let evidence_fingerprint = evidence_fingerprint(&evidence_refs);
        let violating_files = data_imports
            .iter()
            .map(|fact| fact.file_path.as_str())
            .chain(
                graph_data_imports
                    .iter()
                    .map(|import| import.file_path.as_str()),
            )
            .collect::<BTreeSet<_>>();
        let direction =
            baseline_coverage_direction(&violating_files, &scope_files, &diff_changed_files);
        let mut data_access_scoring = scoring(
            data_imports.len() + graph_data_imports.len(),
            0,
            scope_file_count,
            unique_evidence_file_count(&data_imports, &graph_data_imports),
            "engine-direct-data-access-v1",
        );
        data_access_scoring["coverage_direction"] = direction.to_json();
        candidates.push(EngineCandidate {
            candidate_id: candidate_id(
                &request.repo.repo_id,
                "api_route_no_direct_data_access",
                &matcher,
            ),
            candidate_version: 1,
            kind: "api_route_no_direct_data_access".to_string(),
            rule_id: "api_route_no_direct_data_access".to_string(),
            rule_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
            matcher_schema_version: "convention.matcher.v1".to_string(),
            matcher_fingerprint: stable_hash_json(&matcher),
            scope_fingerprint: stable_hash_json(&scope),
            graph_fingerprint: graph_fingerprint.clone(),
            statement: "API routes should not import data-access clients directly.".to_string(),
            rationale: "Detected API route imports that look like database/data-access clients."
                .to_string(),
            scope,
            matcher,
            requires: None,
            suggested_severity: "error".to_string(),
            // E-6 (D-2): direction comes from the baseline scan, never from files the
            // analyzed diff introduced - see baseline_coverage_direction.
            suggested_enforcement_mode: direction.mode.to_string(),
            enforcement_capability: "deterministic_check".to_string(),
            confidence_label: "high".to_string(),
            scoring: data_access_scoring,
            required_capabilities: vec![
                "syntax_facts".to_string(),
                "import_resolution".to_string(),
                "route_detection".to_string(),
            ],
            evidence_refs,
            counterexample_refs,
            reason_not_blocking: "candidate_not_accepted".to_string(),
            evidence_fingerprint,
            superseded_by: None,
        });
    }

    if !service_imports.is_empty() || !data_imports.is_empty() || !graph_data_imports.is_empty() {
        let delegate_imports = service_imports
            .iter()
            .filter_map(|fact| fact.value.as_deref())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let scope = json!({
            "path_globs": API_ROUTE_SCOPE_GLOBS,
            "file_roles": ["api_route"]
        });
        let matcher = json!({
            "kind": "api_route_requires_service_delegation",
            "allowed_delegate_imports": if delegate_imports.is_empty() {
                vec!["**/services/**".to_string(), "**/server/**".to_string(), "**/data-access/**".to_string()]
            } else {
                delegate_imports
            },
            "applies_to_file_roles": ["api_route"]
        });
        let evidence_refs = evidence_refs(
            &request.scan.scan_id,
            &service_imports,
            &file_hashes,
            "supporting",
        );
        let counterexample_refs = combined_evidence_refs(
            &request.scan.scan_id,
            &data_imports,
            &graph_data_imports,
            &file_hashes,
            "counterexample",
        );
        let evidence_fingerprint = evidence_fingerprint(&evidence_refs);
        candidates.push(EngineCandidate {
            candidate_id: candidate_id(&request.repo.repo_id, "api_route_requires_service_delegation", &matcher),
            candidate_version: 1,
            kind: "api_route_requires_service_delegation".to_string(),
            rule_id: "api_route_requires_service_delegation".to_string(),
            rule_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
            matcher_schema_version: "convention.matcher.v1".to_string(),
            matcher_fingerprint: stable_hash_json(&matcher),
            scope_fingerprint: stable_hash_json(&scope),
            graph_fingerprint: graph_fingerprint.clone(),
            statement: "API routes should delegate business and data-access work through service modules.".to_string(),
            rationale: if service_imports.is_empty() {
                "Detected direct data-access imports; service delegation should be reviewed before enforcement."
            } else {
                "Detected API route imports from service modules."
            }.to_string(),
            scope,
            matcher,
            requires: None,
            suggested_severity: "warning".to_string(),
            suggested_enforcement_mode: "warn".to_string(),
            enforcement_capability: "heuristic_check".to_string(),
            confidence_label: if service_imports.is_empty() { "low" } else { "medium" }.to_string(),
            scoring: scoring(
                service_imports.len(),
                data_imports.len() + graph_data_imports.len(),
                scope_file_count,
                unique_fact_file_count(&service_imports),
                "engine-service-delegation-v1",
            ),
            required_capabilities: vec![
                "syntax_facts".to_string(),
                "import_resolution".to_string(),
                "graph_stream".to_string(),
            ],
            evidence_refs,
            counterexample_refs,
            reason_not_blocking: "candidate_not_accepted".to_string(),
            evidence_fingerprint,
            superseded_by: None,
        });
    }

    candidates.extend(security_candidates(
        &request,
        &api_route_files,
        scope_file_count,
        &file_hashes,
        &graph_fingerprint,
    ));

    let mut stats = engine_stats(
        0,
        0,
        0,
        request.scan.facts.len(),
        0,
        started.elapsed().as_millis(),
    );
    stats.graph_nodes = request.graph.graph_nodes.len();
    stats.graph_edges = request.graph.graph_edges.len();
    let data_access_candidate_found = candidates
        .iter()
        .any(|candidate| candidate.kind == "api_route_no_direct_data_access");
    let inference_complete = data_access_candidate_found || scope_file_count == 0;
    stats.capabilities = capability_stats(
        &["candidate_inference"],
        if inference_complete {
            &[]
        } else {
            &["data_access_inference"]
        },
    );

    CandidateResult {
        schema_version: ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION,
        repo_id: request.repo.repo_id,
        scan_id: request.scan.scan_id,
        graph_id: format!("graph_{}", graph_fingerprint),
        engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        rule_engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        adapter_versions: adapter_versions(),
        candidates,
        diagnostics: Vec::new(),
        stats,
        completeness: vec![EngineCompleteness {
            scope: "repo".to_string(),
            complete: true,
            required_capabilities: vec!["candidate_inference".to_string()],
            missing_capabilities: Vec::new(),
            truncated: false,
            can_block: false,
            graph_intact: true,
            reasons: Vec::new(),
        }],
    }
}

/// Surfaces of a data package that are types, enums or schemas rather than a client.
///
/// Importing `@calcom/prisma/enums` gives you generated enum values; importing
/// `@calcom/prisma/zod-utils` gives you validation schemas. Neither is a database client, and
/// treating them as one put four wrong entries in cal.com's learned contract out of six.
///
/// `/schema` is deliberately absent. In a Drizzle repo the schema module *is* part of the data
/// layer - `@openstatus/db/src/schema` is imported at runtime and passed to queries - so
/// excluding it would trade these false positives for a false negative on a real data layer.
const DATA_LAYER_TYPE_SURFACES: [&str; 4] = ["/enums", "/zod-utils", "/types", "/constants"];

/// True when a data-layer name occurs at a path or word boundary rather than mid-identifier.
///
/// `is_data_access_source` matched raw substrings, so `@calcom/lib/isPrismaObj` - a type-guard
/// utility - matched "prisma" inside a camelCase identifier and was recorded as a database
/// client. This is the same boundary principle applied to forbidden-import matching in B3.
fn contains_data_layer_token(lower: &str, token: &str) -> bool {
    let mut from = 0;
    while let Some(offset) = lower[from..].find(token) {
        let start = from + offset;
        let end = start + token.len();
        let before_ok = start == 0
            || !lower[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        let after_ok = end == lower.len()
            || !lower[end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

fn is_data_access_source(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    if lower.contains("@prisma/client/runtime") {
        return false;
    }
    // Compare with any file extension removed, so this catches both the import specifier
    // form (`@calcom/prisma/zod-utils`) and the resolved file form
    // (`packages/prisma/zod-utils.ts`).
    let without_extension = lower
        .rsplit_once('.')
        .map(|(stem, ext)| {
            if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs") {
                stem
            } else {
                lower.as_str()
            }
        })
        .unwrap_or(lower.as_str());
    if DATA_LAYER_TYPE_SURFACES
        .iter()
        .any(|surface| without_extension.ends_with(surface))
    {
        return false;
    }
    contains_data_layer_token(&lower, "prisma")
        || contains_data_layer_token(&lower, "database")
        || lower.contains("/db")
        || lower.ends_with("db")
        || lower.contains("data-access")
}

fn is_next_app_tree_path(file_path: &str) -> bool {
    file_path.split('/').any(|part| part == "app")
}

fn is_data_access_module_path(file_path: &str) -> bool {
    !is_next_app_tree_path(file_path) && is_data_access_source(file_path)
}

fn imports_data_access_as_data_client(file_path: &str) -> bool {
    let lower = file_path.to_ascii_lowercase();
    !is_next_app_tree_path(file_path)
        && !lower.contains("/auth/")
        && !lower.contains("/auth.")
        && !lower.contains("/payment")
        && !lower.contains("/session")
        && !lower.contains("/stripe")
        // `client` must sit at a path or word boundary. Matching it as a bare substring made
        // `videoClient.ts` - a conferencing service that happens to query the database - read
        // as a database client, which inverts the convention: a route importing a service that
        // owns its data access is delegating correctly. `lib/client.ts` and `db/client.ts`
        // still match.
        && (lower.contains("/client")
            || contains_data_layer_token(&lower, "client"))
}

fn security_candidates(
    request: &CandidateRequest,
    api_route_files: &BTreeSet<&str>,
    scope_file_count: usize,
    file_hashes: &BTreeMap<&str, &str>,
    graph_fingerprint: &str,
) -> Vec<EngineCandidate> {
    let mut candidates = Vec::new();
    let route_scope = json!({
        "path_globs": ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        "file_roles": ["api_route"]
    });

    for (symbol, facts) in grouped_route_facts(request, api_route_files, "symbol_called")
        .into_iter()
        .filter(|(symbol, facts)| facts.len() >= 2 && is_auth_candidate_symbol(symbol))
    {
        let matcher = json!({
            "kind": "api_route_requires_auth_helper",
            "required_calls": [symbol],
            "applies_to_file_roles": ["api_route"]
        });
        let requires = json!({
            "auth_helpers": [{
                "guard_id": format!("auth:{symbol}"),
                "symbol": symbol,
                "import": import_source_for_symbol(request, &facts[0].file_path, &symbol)
            }],
            "dominates": ["data_operation", "response"]
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "api_route_requires_auth_helper",
            statement: format!("API routes appear to use `{symbol}` as an auth helper."),
            rationale: "Detected repeated auth-like helper calls in API routes.",
            scope: route_scope.clone(),
            matcher,
            requires: Some(requires),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "medium",
            facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-auth-helper-usage-v1",
            required_capabilities: &["syntax_facts", "security_auth"],
        }));
    }

    push_request_validation_candidates(RequestValidationCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        symbol_filter: is_validation_candidate_symbol,
    });
    let middleware_facts = route_facts(request, api_route_files, "middleware_protects_route");
    if !middleware_facts.is_empty() {
        let route_paths = unique_json_strings(&middleware_facts, "route_path");
        let middleware_ids = unique_json_strings(&middleware_facts, "middleware_id");
        let matcher = json!({
            "kind": "middleware_must_cover_routes",
            "route_paths": route_paths,
            "middleware_ids": middleware_ids,
            "applies_to_file_roles": ["api_route"]
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "middleware_must_cover_routes",
            statement: "API routes appear to rely on middleware protection.".to_string(),
            rationale: "Detected static middleware-to-route protection facts.",
            scope: route_scope.clone(),
            matcher,
            requires: Some(json!({})),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "medium",
            facts: middleware_facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-middleware-protection-v1",
            required_capabilities: &["syntax_facts", "middleware_coverage"],
        }));
    }

    for (symbol, facts) in
        grouped_route_facts(request, api_route_files, "request_validation_called")
            .into_iter()
            .filter(|(_, facts)| facts.len() >= 2)
    {
        let matcher = json!({
            "kind": "api_route_requires_request_validation",
            "applies_to_file_roles": ["api_route"],
            "methods": ["POST", "PUT", "PATCH", "DELETE"],
            "required_calls": [symbol]
        });
        let requires = json!({
            "input_sources": ["body", "query", "params"],
            "sinks": ["data_operation", "response"],
            "validators": [{
                "validator_id": format!("validator:{symbol}"),
                "symbol": symbol,
                "import": import_source_for_symbol(request, &facts[0].file_path, &symbol)
            }],
            "schemas": [],
            "allow_throwing_parse": true,
            "allow_safe_parse_success_guard": true
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "api_route_requires_request_validation",
            statement: format!(
                "Mutation API routes appear to validate request input with `{symbol}`."
            ),
            rationale: "Detected repeated request validation facts.",
            scope: route_scope.clone(),
            matcher,
            requires: Some(requires),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "medium",
            facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-request-validation-v1",
            required_capabilities: &["syntax_facts", "request_validation"],
        }));
    }

    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "authorization_guard_called",
        candidate_kind: "api_route_requires_authorization",
        requires_key: "authorization_helpers",
        capability: "authorization",
        heuristic_id: "security-authorization-helper-v1",
        symbol_filter: always_candidate_symbol,
        requires_module_key: false,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        candidate_kind: "api_route_requires_authorization",
        requires_key: "authorization_helpers",
        capability: "authorization",
        heuristic_id: "security-authorization-helper-v1",
        symbol_filter: is_authorization_candidate_symbol,
        requires_module_key: false,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "tenant_guard_called",
        candidate_kind: "api_route_requires_tenant_scope",
        requires_key: "tenant_helpers",
        capability: "tenant_scope",
        heuristic_id: "security-tenant-helper-v1",
        symbol_filter: always_candidate_symbol,
        requires_module_key: false,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        candidate_kind: "api_route_requires_tenant_scope",
        requires_key: "tenant_helpers",
        capability: "tenant_scope",
        heuristic_id: "security-tenant-helper-v1",
        symbol_filter: is_tenant_candidate_symbol,
        requires_module_key: false,
    });
    push_serializer_candidate(SerializerCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "serializer_called",
        symbol_filter: always_candidate_symbol,
    });
    push_serializer_candidate(SerializerCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        symbol_filter: is_serializer_candidate_symbol,
    });

    let sensitive_facts = route_facts(request, api_route_files, "sensitive_field_declared");
    if !sensitive_facts.is_empty() {
        let fields = sensitive_facts
            .iter()
            .map(|fact| {
                json!({
                    "field_path": json_string_field(fact, "field_path").unwrap_or_else(|| fact.name.clone()),
                    "classification": json_string_field(fact, "classification").unwrap_or_else(|| "internal".to_string()),
                    "source": "candidate"
                })
            })
            .collect::<Vec<_>>();
        let matcher = json!({
            "kind": "api_route_forbids_sensitive_response_fields",
            "applies_to_file_roles": ["api_route"]
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "api_route_forbids_sensitive_response_fields",
            statement:
                "API responses appear to include sensitive fields that need an accepted policy."
                    .to_string(),
            rationale: "Detected candidate sensitive response field facts.",
            scope: route_scope.clone(),
            matcher,
            requires: Some(json!({ "sensitive_response_fields": fields })),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "low",
            facts: sensitive_facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-sensitive-field-v1",
            required_capabilities: &["syntax_facts", "sensitive_response"],
        }));
    }

    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "parameterized_sql_used",
        candidate_kind: "api_route_forbids_raw_sql_without_params",
        requires_key: "raw_sql_safe_wrappers",
        capability: "raw_sql",
        heuristic_id: "security-raw-sql-safe-wrapper-v1",
        symbol_filter: always_candidate_symbol,
        requires_module_key: false,
    });
    for (symbol, facts) in grouped_route_facts(request, api_route_files, "symbol_called")
        .into_iter()
        .filter(|(symbol, facts)| facts.len() >= 2 && is_ssrf_candidate_symbol(symbol))
    {
        let matcher = json!({
            "kind": "api_route_forbids_untrusted_ssrf",
            "required_calls": [symbol],
            "applies_to_file_roles": ["api_route"]
        });
        let requires = json!({
            "outbound_url_allowlist_helpers": [{
                "helper_id": format!("ssrf:{symbol}"),
                "symbol": symbol,
                "module": import_source_for_symbol(request, &facts[0].file_path, &symbol)
            }]
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "api_route_forbids_untrusted_ssrf",
            statement: format!(
                "API routes appear to use `{symbol}` as an outbound URL allowlist helper."
            ),
            rationale: "Detected repeated SSRF allowlist-like helper calls.",
            scope: route_scope.clone(),
            matcher,
            requires: Some(requires),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "medium",
            facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-ssrf-allowlist-v1",
            required_capabilities: &["syntax_facts", "outbound_request_facts"],
        }));
    }
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "csrf_guard_called",
        candidate_kind: "api_route_requires_csrf_for_mutation",
        requires_key: "csrf_helpers",
        capability: "csrf",
        heuristic_id: "security-csrf-helper-v1",
        symbol_filter: always_candidate_symbol,
        requires_module_key: true,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        candidate_kind: "api_route_requires_csrf_for_mutation",
        requires_key: "csrf_helpers",
        capability: "csrf",
        heuristic_id: "security-csrf-helper-v1",
        symbol_filter: is_csrf_candidate_symbol,
        requires_module_key: true,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "rate_limit_guard_called",
        candidate_kind: "api_route_requires_rate_limit",
        requires_key: "rate_limit_helpers",
        capability: "rate_limit",
        heuristic_id: "security-rate-limit-helper-v1",
        symbol_filter: always_candidate_symbol,
        requires_module_key: true,
    });
    push_guard_candidate(GuardCandidateInput {
        candidates: &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        route_scope: &route_scope,
        fact_kind: "symbol_called",
        candidate_kind: "api_route_requires_rate_limit",
        requires_key: "rate_limit_helpers",
        capability: "rate_limit",
        heuristic_id: "security-rate-limit-helper-v1",
        symbol_filter: is_rate_limit_candidate_symbol,
        requires_module_key: true,
    });

    let cors_facts = route_facts(request, api_route_files, "cors_policy_declared");
    if !cors_facts.is_empty() {
        let allowed_origins = cors_facts
            .iter()
            .filter_map(|fact| cors_origin_field(fact))
            .filter(|origin| origin != "*")
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let allow_credentials = cors_facts
            .iter()
            .any(|fact| cors_credentials_field(fact).unwrap_or(false));
        let matcher = json!({
            "kind": "api_route_cors_must_match_policy",
            "applies_to_file_roles": ["api_route"]
        });
        candidates.push(security_candidate_from_facts(SecurityCandidateInput {
            request,
            kind: "api_route_cors_must_match_policy",
            statement: "API routes appear to declare a static CORS policy.".to_string(),
            rationale: "Detected static CORS policy facts.",
            scope: route_scope,
            matcher,
            requires: Some(json!({
                "allowed_origins": allowed_origins,
                "allow_credentials": allow_credentials
            })),
            suggested_severity: "warning",
            enforcement_capability: "deterministic_check",
            confidence_label: "medium",
            facts: cors_facts,
            scope_file_count,
            file_hashes,
            graph_fingerprint,
            heuristic_id: "security-cors-policy-v1",
            required_capabilities: &["syntax_facts", "cors_policy_facts"],
        }));
    }

    // CV-1: the per-symbol candidates above fragment a repo's real convention across every helper
    // name it uses. This derives the family candidates FROM them, so the per-member evidence is
    // still there to explain each membership.
    derive_convention_families(
        &mut candidates,
        request,
        api_route_files,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
    );

    candidates
}

/// One convention family: a kind whose members are interchangeable helpers drawn from one module.
struct FamilySpec {
    kind: &'static str,
    /// Every fact kind that already produces a per-symbol candidate of this kind, each with the
    /// nominator that site filters by. Both the dedicated fact kind (`rate_limit_guard_called`)
    /// and the generic `symbol_called` path emit candidates today, so a family that read only one
    /// of them would under-count its own members.
    sources: &'static [FamilySource],
    /// `requires` is the surface the check path reads accepted helpers from, and its key and
    /// per-helper module field differ by kind. The family must mirror whatever the per-symbol
    /// candidate of the same kind emits, or an accepted family would carry no helpers at all.
    requires_key: &'static str,
    helper_id_prefix: &'static str,
    /// The field name the *reader* for this kind expects the helper id under. Derived names do not
    /// work here: `accepted_auth_helpers_for_convention` reads `guard_id`,
    /// `insert_request_validator_value` reads `validator_id`, and `security_helpers_from_requires`
    /// reads `helper_id` - and that last one takes it with `?` inside a `filter_map`, so a wrong key
    /// does not degrade, it silently drops every helper and the accepted convention then flags every
    /// route in scope including the ones that comply.
    helper_id_key: &'static str,
    helper_module_key: &'static str,
    heuristic_id: &'static str,
    required_capabilities: &'static [&'static str],
    noun: &'static str,
    /// How a symbol earns membership once its module matches. Measured on dub, module identity
    /// alone is nowhere near enough, so this is per-kind rather than one rule for all three.
    confirmation: FamilyConfirmation,
}

/// What confirms that a same-module symbol really belongs to a family.
///
/// Measured on dub at `30e2e036`, module identity alone over-aggregates badly, because a real
/// module exports heterogeneous symbols: `@/lib/auth` exports `withSession` and `withAdmin`, and
/// also `hashPassword`, `hashToken` and `validatePassword`. Recruiting on the module produced a
/// 9-member auth family containing three crypto utilities, and an 89-member "request validation"
/// family containing `bulkDeleteLinks` and `addDomainToVercel`. An accepted family like that would
/// count a route calling `hashPassword` as authenticated - a false negative in enforcement, which
/// is exactly the theater this sprint exists not to re-ship.
#[derive(PartialEq, Eq)]
enum FamilyConfirmation {
    /// The symbol's call must textually enclose the handler's work: its source span strictly
    /// contains a response, data operation or request-input fact in the same file. That is what a
    /// route wrapper *is* - `withSession(async (req) => { ...work... })` encloses its handler,
    /// while `hashPassword(pw)` is a point call inside one.
    ///
    /// This is a syntactic containment test between two facts, NOT a dominance claim. It says "this
    /// call is the wrapper of the handler", not "this guard runs before that sink on every path" -
    /// the latter is the quarantined control-flow reasoning and nothing here computes it.
    ///
    /// Measured on dub this separates perfectly: withWorkspace 181 of 183 files, withAdmin 33 of
    /// 33, withSession 16 of 17 - and getSession, hashPassword, hashToken, validatePassword all 0.
    WrapsHandler,
    /// The symbol was already positively detected by a dedicated fact kind, so nothing needs
    /// confirming and nothing is recruited by module. Aggregation here is only the union of what
    /// the extractor already identified - which is still one candidate instead of N, without the
    /// recruitment that over-aggregated.
    ///
    /// Used where the helper is genuinely a point call inside the handler rather than a wrapper:
    /// dub calls `await ratelimit(...)` in the body, so a wrapper test would empty the family and a
    /// module test would fill it with everything the module exports.
    AlreadyDetected,
}

struct FamilySource {
    fact_kind: &'static str,
    nominator: fn(&str) -> bool,
}

/// The three kinds this sprint aggregates. Each one's enforcement handler already exists and is
/// reachable; what never arrived was a candidate whose coverage cleared the noise floor.
const FAMILY_SPECS: &[FamilySpec] = &[
    FamilySpec {
        kind: "api_route_requires_auth_helper",
        sources: &[FamilySource {
            fact_kind: "symbol_called",
            nominator: is_auth_candidate_symbol,
        }],
        requires_key: "auth_helpers",
        helper_id_prefix: "auth",
        helper_id_key: "guard_id",
        helper_module_key: "import",
        heuristic_id: "security-auth-helper-family-v1",
        required_capabilities: &["syntax_facts", "security_auth"],
        noun: "auth",
        // dub's wrappers enclose their handlers; its crypto utilities do not.
        confirmation: FamilyConfirmation::WrapsHandler,
    },
    FamilySpec {
        kind: "api_route_requires_request_validation",
        // Only the dedicated fact kind. Adding `symbol_called` here is what produced an 89-member
        // family on dub: every symbol the dominant module exported joined, validators and bulk
        // delete operations alike.
        sources: &[FamilySource {
            fact_kind: "request_validation_called",
            nominator: always_candidate_symbol,
        }],
        requires_key: "validators",
        helper_id_prefix: "validator",
        helper_id_key: "validator_id",
        helper_module_key: "import",
        heuristic_id: "security-request-validation-family-v1",
        required_capabilities: &["syntax_facts", "request_validation"],
        noun: "request validation",
        confirmation: FamilyConfirmation::AlreadyDetected,
    },
    FamilySpec {
        kind: "api_route_requires_rate_limit",
        sources: &[
            FamilySource {
                fact_kind: "rate_limit_guard_called",
                nominator: always_candidate_symbol,
            },
            // A name-nominated rate limiter is a positive detection in its own right - the name
            // predicate for this kind is narrow (`ratelimit`, `throttle`, `limiter`) rather than the
            // broad substring logic auth uses, so it does not need module recruitment behind it.
            FamilySource {
                fact_kind: "symbol_called",
                nominator: is_rate_limit_candidate_symbol,
            },
        ],
        requires_key: "rate_limit_helpers",
        helper_id_prefix: "rate_limit",
        helper_id_key: "helper_id",
        helper_module_key: "module",
        heuristic_id: "security-rate-limit-family-v1",
        required_capabilities: &["syntax_facts", "rate_limit_facts"],
        noun: "rate limit",
        confirmation: FamilyConfirmation::AlreadyDetected,
    },
];

/// CV-2: each route file's flavour, read from the `route_flavor_detected` fact the scan emits.
///
/// Read, not derived. The deriver matching globs of its own is the BB-11 divergence in a new place, and
/// the classification already happened once at fact time. A file with no flavour fact - a repo scanned
/// before this existed - reads as `api_route`, which is the unconditioned answer and keeps such a repo
/// behaving exactly as it did.
fn route_flavors_by_file(request: &CandidateRequest) -> BTreeMap<&str, &str> {
    request
        .scan
        .facts
        .iter()
        .filter(|fact| fact.kind == "route_flavor_detected")
        .map(|fact| (fact.file_path.as_str(), fact.name.as_str()))
        .collect()
}

/// The denominator for one flavour: how many files in scope are of it.
///
/// This is what conditioning is for. dub's 494 route files are 358 app, 111 cron and 25 webhook, and a
/// session family measured against all 494 is measured partly against routes it was never about.
fn flavor_scope_file_count(
    scope_files: &BTreeSet<&str>,
    flavors: &BTreeMap<&str, &str>,
    flavor: &str,
) -> usize {
    scope_files
        .iter()
        .filter(|file| flavors.get(**file).copied().unwrap_or("api_route") == flavor)
        .count()
}

/// A candidate member of a family, before the module cluster decides whether it joins.
struct FamilyMemberInput<'a> {
    symbol: String,
    facts: Vec<&'a CheckFact>,
    module: String,
    family_key: String,
    /// True when a name predicate nominated this symbol, or a dedicated fact kind detected it
    /// positively. Only nominated symbols can establish a family's module; the rest can only join
    /// one that already exists.
    nominated: bool,
    /// True when this symbol's calls textually enclose the handler's work in at least two files -
    /// the structural signature of a route wrapper. See `FamilyConfirmation::WrapsHandler`.
    wraps_handler: bool,
}

/// CV-1: aggregate per-symbol candidates of one kind into a single family candidate whose matcher
/// is a disjunction over its members and whose coverage is the union of the files they satisfy.
///
/// **Why.** dub uses a member of its auth-wrapper family on 341 of 488 routes (70%), but inference
/// emitted one candidate per helper symbol, so the strongest single shard (`withSession`, 20 files)
/// covered 3.9% of routes - under the 0.2 noise floor. The repo's strongest real convention was
/// never hypothesised, while the enforcement handler for its kind sat reachable and unfed.
///
/// **Why this is not a new heuristic.** The family claim is presence-of-a-family-member: a call
/// either resolves to the family's module or it does not, exactly as deterministic as the shipped
/// data-access kind. No control flow is consulted here.
///
/// **Name-similarity nominates; resolved-module identity confirms.** This ordering is the whole
/// safety property and it is the F4 lesson applied before the fact - substring matching nominated
/// `isPrismaObj` once already. A symbol joins a family only because it resolves to the module a
/// *nominated* seed resolves to, so the engine never encodes any repo's vocabulary: `withWorkspace`
/// can join dub's auth family because it comes from the same module as `withSession`, not because
/// the string "withWorkspace" appears anywhere in this source. That distinction is why
/// `does_not_recognise_repo_specific_wrappers_as_auth_helpers` stays green - a fixture whose only
/// symbol is `withWorkspace` has no nominated seed, so it forms no family.
fn derive_convention_families(
    candidates: &mut Vec<EngineCandidate>,
    request: &CandidateRequest,
    api_route_files: &BTreeSet<&str>,
    scope_file_count: usize,
    file_hashes: &BTreeMap<&str, &str>,
    graph_fingerprint: &str,
) {
    let route_scope = json!({
        "path_globs": ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        "file_roles": ["api_route"]
    });

    let flavors = route_flavors_by_file(request);
    for spec in FAMILY_SPECS {
        let inputs = family_member_inputs(spec, request, api_route_files);
        let members = match spec.confirmation {
            // Every member here was already positively detected - by a dedicated fact kind, or by a
            // narrow name predicate - so the family is their union and nothing is recruited on
            // module identity.
            //
            // The `nominated` filter is load-bearing, not a formality. `family_member_inputs`
            // collects every symbol called in a route, because the `WrapsHandler` kinds need that
            // wide net to find members their name predicate would miss. Taking all of it here
            // produced a 249-member "rate limit" family on dub containing `capitalize`, `nanoid` and
            // `uuid` - every symbol the repo calls in a route.
            FamilyConfirmation::AlreadyDetected => inputs
                .iter()
                .filter(|input| input.nominated)
                .collect::<Vec<_>>(),
            // Module identity narrows the field; the wrapper test decides. Both are required: the
            // module keeps a wrapper from an unrelated subsystem out, and the wrapper test keeps the
            // module's own utilities out.
            FamilyConfirmation::WrapsHandler => {
                let Some(dominant) = dominant_family_key(&inputs) else {
                    continue;
                };
                inputs
                    .iter()
                    .filter(|input| {
                        family_keys_match(&input.family_key, &dominant) && input.wraps_handler
                    })
                    .collect::<Vec<_>>()
            }
        };
        // A one-member family is identical in effect to the per-symbol candidate that already
        // exists, and emitting it would duplicate that candidate's matcher - and therefore its id.
        // Nothing is added, so nothing is emitted: already-passing repos keep their exact candidate
        // set, which is CV-1's third negative control.
        if members.len() < 2 {
            continue;
        }

        // CV-2: condition on route flavour.
        //
        // A member is assigned to a flavour by the flavour of the files it actually covers. dub's
        // session wrappers cover app routes; a signature helper covers cron routes. Splitting here
        // means each family is scored against the denominator it is actually about, and - the part
        // that matters when one is accepted in block mode - a cron route is never in scope for the
        // session family, so it cannot be flagged for missing a wrapper it was never meant to use.
        //
        // A flavour present in the repo but with no members of its own yields no family for that
        // flavour, rather than an empty one. And when every member sits in one flavour and that is the
        // only flavour in the repo, the family is emitted UNCONDITIONED - `applies_to_route_flavors`
        // is omitted - so a repo with no cron paths gets exactly what it got before flavours existed.
        // That is CV-2's red #2: conditioning must not manufacture flavours from noise.
        let present_flavors = scope_flavors_present(api_route_files, &flavors);
        let mut per_flavor: BTreeMap<&str, Vec<&FamilyMemberInput<'_>>> = BTreeMap::new();
        for member in &members {
            for flavor in member_flavors(member, &flavors) {
                per_flavor.entry(flavor).or_default().push(member);
            }
        }

        for (flavor, flavor_members) in per_flavor {
            // Same threshold as the unconditioned family: one member is not a family.
            if flavor_members.len() < 2 {
                continue;
            }
            let conditioned = present_flavors.len() > 1;
            emit_family_candidate(FamilyEmitInput {
                candidates,
                request,
                spec,
                members: &flavor_members,
                route_scope: &route_scope,
                flavor: conditioned.then_some(flavor),
                scope_file_count: if conditioned {
                    flavor_scope_file_count(api_route_files, &flavors, flavor)
                } else {
                    scope_file_count
                },
                file_hashes,
                graph_fingerprint,
            });
        }
    }
}

/// Which flavours actually appear among the repo's route files.
///
/// Used to decide whether to condition at all. One flavour means the repo has no cron or webhook
/// routes, so the family is emitted unconditioned and behaves exactly as it did before flavours
/// existed - CV-2's red #2, that conditioning must not manufacture flavours from noise.
fn scope_flavors_present<'a>(
    scope_files: &BTreeSet<&'a str>,
    flavors: &BTreeMap<&'a str, &'a str>,
) -> BTreeSet<&'static str> {
    scope_files
        .iter()
        .map(|file| match flavors.get(*file).copied().unwrap_or("api_route") {
            "cron_job" => "cron_job",
            "webhook_handler" => "webhook_handler",
            _ => "api_route",
        })
        .collect()
}

/// The flavours a member is evidenced in - the flavours of the files its calls actually appear in.
///
/// A helper used in both app and cron routes belongs to both families, which is correct: it is
/// genuinely a member of each. Assignment follows the evidence rather than a guess about intent.
fn member_flavors<'a>(
    member: &FamilyMemberInput<'_>,
    flavors: &BTreeMap<&'a str, &'a str>,
) -> BTreeSet<&'static str> {
    member
        .facts
        .iter()
        .map(|fact| {
            match flavors
                .get(fact.file_path.as_str())
                .copied()
                .unwrap_or("api_route")
            {
                "cron_job" => "cron_job",
                "webhook_handler" => "webhook_handler",
                _ => "api_route",
            }
        })
        .collect()
}

struct FamilyEmitInput<'a> {
    candidates: &'a mut Vec<EngineCandidate>,
    request: &'a CandidateRequest,
    spec: &'a FamilySpec,
    members: &'a [&'a FamilyMemberInput<'a>],
    route_scope: &'a Value,
    /// `None` emits an unconditioned family, omitting `applies_to_route_flavors` entirely.
    flavor: Option<&'a str>,
    scope_file_count: usize,
    file_hashes: &'a BTreeMap<&'a str, &'a str>,
    graph_fingerprint: &'a str,
}

/// Emit one family candidate and mark the per-symbol candidates it now speaks for.
fn emit_family_candidate(input: FamilyEmitInput<'_>) {
    let FamilyEmitInput {
        candidates,
        request,
        spec,
        members,
        route_scope,
        flavor,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
    } = input;

    let symbols = members
        .iter()
        .map(|member| member.symbol.clone())
        .collect::<Vec<_>>();
    // Members arrive ordered already, because `family_member_inputs` collects into a BTreeMap - that
    // map, not this sort, is what actually makes the matcher fingerprint stable. The sort stays as a
    // guard on that invariant rather than as its cause, so that a future change to the collection type
    // cannot silently start churning candidate ids.
    let mut sorted_symbols = symbols.clone();
    sorted_symbols.sort();

    let mut matcher = json!({
        "kind": spec.kind,
        "required_calls": sorted_symbols.clone(),
        "applies_to_file_roles": ["api_route"]
    });
    if spec.kind == "api_route_requires_request_validation" {
        // Mirrors the per-symbol validation candidate: only mutations are in scope.
        matcher["methods"] = json!(["POST", "PUT", "PATCH", "DELETE"]);
    }
    // CV-2: present only when the repo actually has more than one flavour, so an unconditioned repo's
    // matcher - and therefore its fingerprint and candidate id - is byte-identical to before.
    if let Some(flavor) = flavor {
        matcher["applies_to_route_flavors"] = json!([flavor]);
    }

    // Per-member evidence, so `conventions show` can answer "why is this symbol in this family".
    // `requires` is not fingerprinted, so counts here never destabilise the id.
    let helpers = members
        .iter()
        .map(|member| {
            json!({
                spec.helper_id_key:
                    format!("{}:{}", spec.helper_id_prefix, member.symbol),
                "symbol": member.symbol,
                spec.helper_module_key: member.module,
                "evidence_file_count": unique_fact_file_count(&member.facts),
                "joined_by": if member.nominated { "name_and_module" } else { "module" }
            })
        })
        .collect::<Vec<_>>();
    let mut requires = json!({ spec.requires_key: helpers });
    if spec.kind == "api_route_requires_auth_helper" {
        requires["dominates"] = json!(["data_operation", "response"]);
    }
    if spec.kind == "api_route_requires_request_validation" {
        requires["input_sources"] = json!(["body", "query", "params"]);
        requires["sinks"] = json!(["data_operation", "response"]);
        requires["schemas"] = json!([]);
        requires["allow_throwing_parse"] = json!(true);
        requires["allow_safe_parse_success_guard"] = json!(true);
    }

    // Union coverage: the count of distinct files satisfied by ANY member, which is the whole point of
    // the aggregation. When conditioned, only the facts in this flavour count, or a flavour's coverage
    // would be computed from evidence outside it.
    let mut facts = members
        .iter()
        .flat_map(|member| member.facts.iter().copied())
        .collect::<Vec<_>>();
    if let Some(flavor) = flavor {
        let flavors = route_flavors_by_file(request);
        facts.retain(|fact| {
            flavors
                .get(fact.file_path.as_str())
                .copied()
                .unwrap_or("api_route")
                == flavor
        });
    }
    facts.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.start_line.cmp(&right.start_line))
            .then(left.name.cmp(&right.name))
    });
    facts.dedup_by(|left, right| {
        left.file_path == right.file_path
            && left.start_line == right.start_line
            && left.name == right.name
    });

    // Named in the statement whenever the family is conditioned, including the app-route case. A
    // reviewer reading "one of 5 auth helpers" cannot otherwise tell that this family deliberately
    // does not cover the repo's 112 cron routes.
    let flavor_phrase = match flavor {
        Some("cron_job") => " on cron routes",
        Some("webhook_handler") => " on webhook routes",
        Some(_) => " on application routes",
        None => "",
    };
    let family = security_candidate_from_facts(SecurityCandidateInput {
        request,
        kind: spec.kind,
        statement: format!(
            "API routes appear to require one of {} {} helpers{} ({}).",
            sorted_symbols.len(),
            spec.noun,
            flavor_phrase,
            sorted_symbols.join(", ")
        ),
        rationale: match spec.confirmation {
            FamilyConfirmation::WrapsHandler => {
                "Aggregated helpers that resolve to one module and wrap their route handlers."
            }
            // No module test is applied to these kinds, and claiming one in the string a reviewer
            // reads before accepting would be a lie about how the family was formed.
            FamilyConfirmation::AlreadyDetected => {
                "Aggregated separately detected helpers of one kind into a single family."
            }
        },
        scope: route_scope.clone(),
        matcher,
        requires: Some(requires),
        suggested_severity: "warning",
        enforcement_capability: "deterministic_check",
        confidence_label: "medium",
        facts,
        scope_file_count,
        file_hashes,
        graph_fingerprint,
        heuristic_id: spec.heuristic_id,
        required_capabilities: spec.required_capabilities,
    });

    // The per-symbol candidates stay - they carry the per-member evidence - but they are no longer the
    // thing to accept, and saying so is what stops a reviewer accepting five fragments of one
    // convention.
    let family_id = family.candidate_id.clone();
    let member_set = symbols.iter().cloned().collect::<BTreeSet<_>>();
    for candidate in candidates.iter_mut() {
        if candidate.kind != spec.kind || candidate.candidate_id == family_id {
            continue;
        }
        let superseded = candidate.matcher["required_calls"]
            .as_array()
            .is_some_and(|calls| {
                !calls.is_empty()
                    && calls
                        .iter()
                        .all(|call| call.as_str().is_some_and(|call| member_set.contains(call)))
            });
        if superseded {
            candidate.superseded_by = Some(family_id.clone());
        }
    }
    candidates.push(family);
}

/// Every repeated helper call of one family's kind, with the module it resolves to.
///
/// A symbol whose import cannot be resolved is excluded: module identity is what confirms
/// membership, so a symbol with no resolvable module has nothing to confirm it. Locally defined
/// helpers land here, and excluding them is deliberate - a same-named local function is not the
/// shared helper the family is about.
fn family_member_inputs<'a>(
    spec: &FamilySpec,
    request: &'a CandidateRequest,
    api_route_files: &BTreeSet<&str>,
) -> Vec<FamilyMemberInput<'a>> {
    let mut merged: BTreeMap<String, (Vec<&'a CheckFact>, bool)> = BTreeMap::new();
    for source in spec.sources {
        for (symbol, facts) in grouped_route_facts(request, api_route_files, source.fact_kind) {
            let nominated = (source.nominator)(&symbol);
            let entry = merged.entry(symbol).or_insert_with(|| (Vec::new(), false));
            entry.0.extend(facts);
            entry.1 = entry.1 || nominated;
        }
    }

    merged
        .into_iter()
        // Two distinct FILES, where the per-symbol sites take two distinct facts - so a helper used
        // twice inside one file gets a per-symbol candidate but not family membership. Deliberate and
        // deliberately stricter: a family's coverage is counted in files, so a member that cannot
        // move the file count is a member that only adds a name to the disjunction.
        .filter(|(_, (facts, _))| unique_fact_file_count(facts) >= 2)
        .filter_map(|(symbol, (facts, nominated))| {
            let module = dominant_import_source(request, &facts, &symbol)?;
            let family_key = module_family_key(&module);
            let wraps_handler = wrapping_file_count(request, &facts) >= 2;
            Some(FamilyMemberInput {
                symbol,
                facts,
                module,
                family_key,
                nominated,
                wraps_handler,
            })
        })
        .collect()
}

/// The module family a family's members must share, chosen as the nominated cluster covering the
/// most files.
///
/// Only nominated symbols vote. That is what keeps a lookalike out: a helper named `withAuthorHat`
/// resolving to `lib/blog/` nominates its own cluster, but `lib/auth/`'s cluster covers more files
/// and wins, so the lookalike joins nothing. Ties break on the key so the choice is deterministic.
fn dominant_family_key(inputs: &[FamilyMemberInput<'_>]) -> Option<String> {
    let mut scores: BTreeMap<&str, usize> = BTreeMap::new();
    // Nominated AND wrapping. Nomination alone was not enough: a nominated point call could
    // establish a module and then contribute nothing to the family it created, leaving an
    // `api_route_requires_auth_helper` family whose members were all non-nominated wrappers from a
    // neighbouring module - `withErrorHandler` and `withLogging` reading as auth because a
    // `getSession` call next door voted for their package. The seed has to be a member.
    for input in inputs
        .iter()
        .filter(|input| input.nominated && input.wraps_handler)
    {
        *scores.entry(input.family_key.as_str()).or_insert(0) +=
            unique_fact_file_count(&input.facts);
    }
    scores
        .into_iter()
        .max_by(|(left_key, left_score), (right_key, right_score)| {
            left_score
                .cmp(right_score)
                .then_with(|| right_key.cmp(left_key))
        })
        .map(|(key, _)| key.to_string())
}

/// The import specifier most of this symbol's calls resolve to, ties broken lexicographically.
///
/// Taking the first occurrence's specifier made family formation depend on fact order: a `withPartner`
/// imported from `@/lib/auth/partner` in one route and `@/lib/billing/partner` in another produced a
/// family in one traversal order and none in the reverse. "Resolved-module identity confirms" has to
/// mean the symbol's actual module, not whichever file the scan happened to visit first.
fn dominant_import_source(
    request: &CandidateRequest,
    facts: &[&CheckFact],
    symbol: &str,
) -> Option<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for fact in facts {
        if let Some(source) = import_source_for_symbol(request, &fact.file_path, symbol) {
            *counts.entry(source).or_insert(0) += 1;
        }
    }
    counts
        .into_iter()
        .max_by(|(left_key, left_count), (right_key, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_key.cmp(left_key))
        })
        .map(|(source, _)| source)
}

/// How many distinct files hold a call of this symbol whose source span strictly encloses that
/// file's handler work - a response, a data operation, or a request-input read.
///
/// This is the structural signature of a route wrapper. `withSession(async (req) => { ... })` has a
/// span covering everything it wraps, so the handler's own facts fall inside it; `hashPassword(pw)`
/// is a point call and encloses nothing. Measured on dub: withWorkspace 181 of 183 files, withAdmin
/// 33 of 33, and getSession, hashPassword, hashToken and validatePassword all zero.
///
/// Two files rather than one, matching the repetition threshold membership already uses - a single
/// wrapped route is not yet evidence of a family.
///
/// This is a containment test between two syntactic spans. It is NOT the guard-dominance claim that
/// stays quarantined: it says this call is the handler's wrapper, and says nothing about execution
/// order, branch reachability, or whether the guard can be bypassed.
fn wrapping_file_count(request: &CandidateRequest, facts: &[&CheckFact]) -> usize {
    const HANDLER_WORK: &[&str] = &[
        "route_returns_response",
        "data_operation_detected",
        "request_input_read",
    ];
    facts
        .iter()
        .filter(|fact| fact.end_line > fact.start_line)
        .filter(|call| {
            request.scan.facts.iter().any(|work| {
                HANDLER_WORK.contains(&work.kind.as_str())
                    && work.file_path == call.file_path
                    && work.start_line > call.start_line
                    && work.end_line <= call.end_line
            })
        })
        .map(|fact| fact.file_path.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

/// The family key of a resolved import specifier: its non-generic path segments, joined.
///
/// Container words are dropped, so `@/lib/auth`, `apps/web/lib/auth` and `server/auth` all key on
/// `auth`, and `@/lib/cache` keys on `cache` and never merges with it. What remains is a *sequence*
/// rather than a single segment, because a single segment collapses real monorepo layouts: keying on
/// the first non-generic segment made `packages/api/src/auth` and `packages/api/src/middleware` both
/// key on `api`, merging a repo's entire API package into one family. As sequences they are
/// `api/auth` and `api/middleware`, which do not merge.
///
/// Clustering is by prefix, handled in `family_keys_match`, so `auth` and `auth/session` are one
/// family - a module and its submodule - while `api/auth` and `api/middleware` are two.
fn module_family_key(module: &str) -> String {
    const GENERIC_SEGMENTS: &[&str] = &[
        "", ".", "..", "@", "~", "src", "lib", "libs", "app", "apps", "web", "packages", "pkg",
        "modules", "internal", "shared", "common", "utils", "util", "helpers", "index", "dist",
        "server", "node_modules",
    ];
    let lower = module.trim().to_ascii_lowercase();
    let trimmed = lower
        .strip_suffix(".ts")
        .or_else(|| lower.strip_suffix(".tsx"))
        .or_else(|| lower.strip_suffix(".js"))
        .unwrap_or(lower.as_str())
        .to_string();

    let segments = trimmed
        .split('/')
        .enumerate()
        .filter(|(index, segment)| {
            // A leading `@scope` is a package scope or a path alias, never the family -
            // `@upstash/ratelimit` is the `ratelimit` family and `@/lib/auth` is the `auth` family.
            !(GENERIC_SEGMENTS.contains(segment) || (*index == 0 && segment.starts_with('@')))
        })
        .map(|(_, segment)| segment)
        .collect::<Vec<_>>();

    if segments.is_empty() {
        return trimmed;
    }
    segments.join("/")
}

/// Whether two family keys name the same family: equal, or one a path-prefix of the other.
///
/// `auth` and `auth/session` are a module and its submodule and belong together. `api/auth` and
/// `api/middleware` share only a container and do not. Prefix comparison is per segment, so `auth`
/// does not match `authorization`.
fn family_keys_match(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let (shorter, longer) = if left.len() < right.len() {
        (left, right)
    } else {
        (right, left)
    };
    longer
        .strip_prefix(shorter)
        .is_some_and(|rest| rest.starts_with('/'))
}


struct SecurityCandidateInput<'a> {
    request: &'a CandidateRequest,
    kind: &'a str,
    statement: String,
    rationale: &'a str,
    scope: Value,
    matcher: Value,
    requires: Option<Value>,
    suggested_severity: &'a str,
    enforcement_capability: &'a str,
    confidence_label: &'a str,
    facts: Vec<&'a CheckFact>,
    scope_file_count: usize,
    file_hashes: &'a BTreeMap<&'a str, &'a str>,
    graph_fingerprint: &'a str,
    heuristic_id: &'a str,
    required_capabilities: &'a [&'a str],
}

struct GuardCandidateInput<'a> {
    candidates: &'a mut Vec<EngineCandidate>,
    request: &'a CandidateRequest,
    api_route_files: &'a BTreeSet<&'a str>,
    scope_file_count: usize,
    file_hashes: &'a BTreeMap<&'a str, &'a str>,
    graph_fingerprint: &'a str,
    route_scope: &'a Value,
    fact_kind: &'a str,
    candidate_kind: &'a str,
    requires_key: &'a str,
    capability: &'a str,
    heuristic_id: &'a str,
    symbol_filter: fn(&str) -> bool,
    requires_module_key: bool,
}

struct SerializerCandidateInput<'a> {
    candidates: &'a mut Vec<EngineCandidate>,
    request: &'a CandidateRequest,
    api_route_files: &'a BTreeSet<&'a str>,
    scope_file_count: usize,
    file_hashes: &'a BTreeMap<&'a str, &'a str>,
    graph_fingerprint: &'a str,
    route_scope: &'a Value,
    fact_kind: &'a str,
    symbol_filter: fn(&str) -> bool,
}

struct RequestValidationCandidateInput<'a> {
    candidates: &'a mut Vec<EngineCandidate>,
    request: &'a CandidateRequest,
    api_route_files: &'a BTreeSet<&'a str>,
    scope_file_count: usize,
    file_hashes: &'a BTreeMap<&'a str, &'a str>,
    graph_fingerprint: &'a str,
    route_scope: &'a Value,
    fact_kind: &'a str,
    symbol_filter: fn(&str) -> bool,
}

fn security_candidate_from_facts(input: SecurityCandidateInput<'_>) -> EngineCandidate {
    let evidence_refs = evidence_refs(
        &input.request.scan.scan_id,
        &input.facts,
        input.file_hashes,
        "supporting",
    );
    let evidence_fingerprint = evidence_fingerprint(&evidence_refs);
    let covered_files = unique_fact_file_count(&input.facts);
    EngineCandidate {
        candidate_id: candidate_id(&input.request.repo.repo_id, input.kind, &input.matcher),
        candidate_version: 1,
        kind: input.kind.to_string(),
        rule_id: input.kind.to_string(),
        rule_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        matcher_schema_version: "convention.matcher.v1".to_string(),
        matcher_fingerprint: stable_hash_json(&input.matcher),
        scope_fingerprint: stable_hash_json(&input.scope),
        graph_fingerprint: input.graph_fingerprint.to_string(),
        statement: input.statement,
        rationale: input.rationale.to_string(),
        scope: input.scope,
        matcher: input.matcher,
        requires: input.requires,
        suggested_severity: input.suggested_severity.to_string(),
        suggested_enforcement_mode: "warn".to_string(),
        enforcement_capability: input.enforcement_capability.to_string(),
        confidence_label: input.confidence_label.to_string(),
        scoring: scoring(
            evidence_refs.len(),
            0,
            input.scope_file_count,
            covered_files,
            input.heuristic_id,
        ),
        required_capabilities: input
            .required_capabilities
            .iter()
            .map(|capability| (*capability).to_string())
            .collect(),
        evidence_refs,
        counterexample_refs: Vec::new(),
        reason_not_blocking: "candidate_not_accepted".to_string(),
        evidence_fingerprint,
        superseded_by: None,
    }
}

fn push_guard_candidate(input: GuardCandidateInput<'_>) {
    for (symbol, facts) in
        grouped_route_facts(input.request, input.api_route_files, input.fact_kind)
            .into_iter()
            .filter(|(symbol, facts)| facts.len() >= 2 && (input.symbol_filter)(symbol))
    {
        let matcher = json!({
            "kind": input.candidate_kind,
            "required_calls": [symbol],
            "applies_to_file_roles": ["api_route"]
        });
        let import_source = import_source_for_symbol(input.request, &facts[0].file_path, &symbol);
        let helper = if input.requires_module_key {
            json!({
                "helper_id": format!("{}:{symbol}", input.capability),
                "symbol": symbol,
                "module": import_source
            })
        } else {
            json!({
                "helper_id": format!("{}:{symbol}", input.capability),
                "symbol": symbol,
                "import": import_source
            })
        };
        let requires = json!({
            input.requires_key: [helper]
        });
        input
            .candidates
            .push(security_candidate_from_facts(SecurityCandidateInput {
                request: input.request,
                kind: input.candidate_kind,
                statement: format!(
                    "API routes appear to use `{symbol}` for {}.",
                    input.capability
                ),
                rationale: "Detected repeated security helper facts.",
                scope: input.route_scope.clone(),
                matcher,
                requires: Some(requires),
                suggested_severity: "warning",
                enforcement_capability: "deterministic_check",
                confidence_label: "medium",
                facts,
                scope_file_count: input.scope_file_count,
                file_hashes: input.file_hashes,
                graph_fingerprint: input.graph_fingerprint,
                heuristic_id: input.heuristic_id,
                required_capabilities: &["syntax_facts"],
            }));
    }
}

fn push_request_validation_candidates(input: RequestValidationCandidateInput<'_>) {
    for (symbol, facts) in
        grouped_route_facts(input.request, input.api_route_files, input.fact_kind)
            .into_iter()
            .filter(|(symbol, facts)| facts.len() >= 2 && (input.symbol_filter)(symbol))
    {
        let matcher = json!({
            "kind": "api_route_requires_request_validation",
            "applies_to_file_roles": ["api_route"],
            "methods": ["POST", "PUT", "PATCH", "DELETE"],
            "required_calls": [symbol]
        });
        let requires = json!({
            "input_sources": ["body", "query", "params"],
            "sinks": ["data_operation", "response"],
            "validators": [{
                "validator_id": format!("validator:{symbol}"),
                "symbol": symbol,
                "import": import_source_for_symbol(input.request, &facts[0].file_path, &symbol)
            }],
            "schemas": [],
            "allow_throwing_parse": true,
            "allow_safe_parse_success_guard": true
        });
        input
            .candidates
            .push(security_candidate_from_facts(SecurityCandidateInput {
                request: input.request,
                kind: "api_route_requires_request_validation",
                statement: format!(
                    "Mutation API routes appear to validate request input with `{symbol}`."
                ),
                rationale: "Detected repeated request validation helper calls.",
                scope: input.route_scope.clone(),
                matcher,
                requires: Some(requires),
                suggested_severity: "warning",
                enforcement_capability: "deterministic_check",
                confidence_label: "medium",
                facts,
                scope_file_count: input.scope_file_count,
                file_hashes: input.file_hashes,
                graph_fingerprint: input.graph_fingerprint,
                heuristic_id: "security-request-validation-v1",
                required_capabilities: &["syntax_facts", "request_validation"],
            }));
    }
}

fn push_serializer_candidate(input: SerializerCandidateInput<'_>) {
    for (symbol, facts) in
        grouped_route_facts(input.request, input.api_route_files, input.fact_kind)
            .into_iter()
            .filter(|(symbol, facts)| facts.len() >= 2 && (input.symbol_filter)(symbol))
    {
        let matcher = json!({
            "kind": "api_route_forbids_sensitive_response_fields",
            "required_calls": [symbol],
            "applies_to_file_roles": ["api_route"]
        });
        let import_source = import_source_for_symbol(input.request, &facts[0].file_path, &symbol)
            .unwrap_or_else(|| "unknown".to_string());
        let requires = json!({
            "response_serializers": [{
                "serializer_id": format!("serializer:{symbol}"),
                "import_source": import_source,
                "imported_name": symbol,
                "local_name": symbol,
                "policy": "denylist",
                "filtered_fields": ["password", "token", "apiToken", "accessToken", "refreshToken"]
            }]
        });
        input
            .candidates
            .push(security_candidate_from_facts(SecurityCandidateInput {
                request: input.request,
                kind: "api_route_forbids_sensitive_response_fields",
                statement: format!("API routes appear to serialize responses with `{symbol}`."),
                rationale: "Detected repeated response serializer-like helper calls.",
                scope: input.route_scope.clone(),
                matcher,
                requires: Some(requires),
                suggested_severity: "warning",
                enforcement_capability: "deterministic_check",
                confidence_label: "medium",
                facts,
                scope_file_count: input.scope_file_count,
                file_hashes: input.file_hashes,
                graph_fingerprint: input.graph_fingerprint,
                heuristic_id: "security-response-serializer-v1",
                required_capabilities: &["syntax_facts", "sensitive_response"],
            }));
    }
}

fn route_facts<'a>(
    request: &'a CandidateRequest,
    api_route_files: &BTreeSet<&str>,
    kind: &str,
) -> Vec<&'a CheckFact> {
    request
        .scan
        .facts
        .iter()
        .filter(|fact| fact.kind == kind && api_route_files.contains(fact.file_path.as_str()))
        .collect()
}

fn grouped_route_facts<'a>(
    request: &'a CandidateRequest,
    api_route_files: &BTreeSet<&str>,
    kind: &str,
) -> BTreeMap<String, Vec<&'a CheckFact>> {
    let mut grouped: BTreeMap<String, Vec<&CheckFact>> = BTreeMap::new();
    for fact in route_facts(request, api_route_files, kind) {
        grouped.entry(fact.name.clone()).or_default().push(fact);
    }
    grouped
}

fn is_auth_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if is_lifecycle_event_like_symbol(&lower) {
        return false;
    }
    !is_serializer_candidate_symbol(symbol)
        && ((lower.contains("auth")
            && (lower.starts_with("require")
                || lower.starts_with("with")
                || lower.starts_with("get")
                || lower.contains("authenticate")
                || lower.contains("authguard")))
            || lower.contains("session")
            || lower.contains("login")
            // Generic identity-helper shapes only. `"withworkspace"` used to sit in this list
            // and was load-bearing: none of the broader conditions above match it, because it
            // does not start with `get` and contains none of session/login/authenticate/authguard.
            //
            // That literal is dub's auth wrapper, and dub is one of the evaluation repos. The
            // falsification report singled out `withWorkspace` at 253 occurrences as the most
            // useful single output across six repositories - a result that existed because the
            // repo's helper name was compiled into the engine. Production behaviour must never
            // key on a specific codebase's vocabulary, so it is gone, and the candidate goes
            // with it. That is the honest baseline.
            || matches!(
                lower.as_str(),
                "requireuser" | "getuser" | "getcurrentuser" | "currentuser"
            )
            // CV-2: cron and webhook routes authenticate by verifying a request signature, not by
            // holding a session, so none of the conditions above can nominate their guard. Without
            // this, a repo's cron routes have no auth family available at all and the session family
            // is the only one that could ever cover them - which is the miscount CV-2 exists to fix.
            //
            // Deliberately vendor-neutral. `verifyQstashSignature` is nominated because it verifies a
            // signature, not because "qstash" appears here: compiling a specific vendor's vocabulary
            // into the engine is what `withWorkspace` was removed for. Confirmation is unchanged -
            // this only nominates, and a nominee still has to resolve to the family's module and wrap
            // its handler before it joins anything.
            || (lower.starts_with("verify")
                && (lower.contains("signature") || lower.contains("hmac"))))
}

fn is_validation_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if lower.starts_with("revalidate") || lower.contains("permission") || lower.contains("role") {
        return false;
    }
    lower.starts_with("validate") || lower.contains("validator") || lower == "safeparse"
}

fn is_authorization_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if is_lifecycle_event_like_symbol(&lower) {
        return false;
    }
    lower.contains("authorize")
        || lower.contains("permission")
        || lower.contains("requirepermission")
        || lower.contains("requirerole")
        || lower.starts_with("can")
}

fn is_tenant_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if lower.starts_with("throwif") {
        return false;
    }
    (lower.contains("tenant")
        && (lower.contains("scope")
            || lower.contains("guard")
            || lower.contains("filter")
            || lower.contains("where")
            || lower.starts_with("require")))
        || lower.contains("scopeproject")
        || lower.contains("scopeorg")
}

fn is_serializer_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    lower.starts_with("serialize")
        || lower.contains("serializer")
        || lower.contains("redact")
        || lower.contains("sanitize")
}

fn is_csrf_candidate_symbol(symbol: &str) -> bool {
    symbol.to_ascii_lowercase().contains("csrf")
}

fn is_rate_limit_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("exceeded") {
        return false;
    }
    lower.contains("ratelimit")
        || lower.contains("rate_limit")
        || lower.contains("throttle")
        || lower.contains("limiter")
}

fn is_lifecycle_event_like_symbol(lower: &str) -> bool {
    lower.ends_with("authorized")
        || lower.ends_with("deauthorized")
        || lower.ends_with("completed")
        || lower.ends_with("created")
        || lower.ends_with("updated")
        || lower.ends_with("deleted")
        || lower.ends_with("failed")
}

fn is_ssrf_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    (lower.contains("allow") && lower.contains("url"))
        || lower.contains("allowlist")
        || lower.contains("sanitizeurl")
        || lower.contains("safeurl")
}

fn always_candidate_symbol(_: &str) -> bool {
    true
}

fn import_source_for_symbol(
    request: &CandidateRequest,
    file_path: &str,
    symbol: &str,
) -> Option<String> {
    request.scan.facts.iter().find_map(|fact| {
        if fact.kind == "import_used" && fact.file_path == file_path && fact.name == symbol {
            fact.value.clone()
        } else {
            None
        }
    })
}

fn json_value(fact: &CheckFact) -> Option<Value> {
    serde_json::from_str(fact.value.as_deref()?).ok()
}

fn json_string_field(fact: &CheckFact, field: &str) -> Option<String> {
    json_value(fact)?
        .get(field)?
        .as_str()
        .map(ToOwned::to_owned)
}

fn cors_origin_field(fact: &CheckFact) -> Option<String> {
    let value = json_value(fact)?;
    value
        .get("origin")
        .or_else(|| value.get("origins"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn cors_credentials_field(fact: &CheckFact) -> Option<bool> {
    let value = json_value(fact)?;
    value
        .get("allow_credentials")
        .or_else(|| value.get("credentials"))
        .and_then(Value::as_bool)
}

fn unique_json_strings(facts: &[&CheckFact], field: &str) -> Vec<String> {
    facts
        .iter()
        .filter_map(|fact| json_string_field(fact, field))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn is_service_source(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    lower.contains("/service")
        || lower.contains("/services")
        || lower.ends_with("service")
        || lower.ends_with("services")
}

fn is_candidate_scope_file(file_path: &str) -> bool {
    let parts = file_path.split('/').collect::<Vec<_>>();
    !parts
        .windows(2)
        .any(|window| matches!(window, ["test", "fixtures"] | ["tests", "fixtures"]))
        && !parts
            .iter()
            .any(|part| matches!(*part, "__fixtures__" | "__mocks__"))
}

fn role_files<'a>(request: &'a CandidateRequest, role: &str) -> BTreeSet<&'a str> {
    request
        .scan
        .facts
        .iter()
        .filter(|fact| fact.kind == "file_role_detected" && fact.name == role)
        .map(|fact| fact.file_path.as_str())
        .collect()
}

fn data_access_files<'a>(
    request: &'a CandidateRequest,
    service_files: &BTreeSet<&str>,
) -> BTreeSet<&'a str> {
    let mut files = role_files(request, "data_access_module")
        .into_iter()
        .filter(|file_path| is_data_access_module_path(file_path))
        .collect::<BTreeSet<_>>();
    for fact in &request.scan.facts {
        if fact.kind == "import_used"
            && !service_files.contains(fact.file_path.as_str())
            && !is_next_app_tree_path(&fact.file_path)
            && fact.value.as_deref().is_some_and(is_data_access_source)
            && (is_data_access_module_path(&fact.file_path)
                || imports_data_access_as_data_client(&fact.file_path))
        {
            files.insert(fact.file_path.as_str());
        }
    }
    files
}

fn graph_role_files(request: &CandidateRequest, role_name: &str) -> BTreeSet<String> {
    let nodes_by_id = request
        .graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    request
        .graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "FILE_HAS_ROLE")
        .filter_map(|edge| {
            let role = nodes_by_id.get(edge.to.as_str())?;
            if metadata_string(&role.metadata, "role")? != role_name {
                return None;
            }
            let file = nodes_by_id.get(edge.from.as_str())?;
            metadata_string(&file.metadata, "path")
                .or_else(|| metadata_string(&file.metadata, "file_path"))
        })
        .collect()
}

fn graph_data_access_imports(request: &CandidateRequest) -> Vec<GraphImportEvidence> {
    let nodes_by_id = request
        .graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let module_files = request
        .graph
        .graph_nodes
        .iter()
        .filter(|node| node.kind == "module")
        .filter_map(|node| {
            metadata_string(&node.metadata, "file_path").map(|path| (node.id.as_str(), path))
        })
        .collect::<BTreeMap<_, _>>();
    let module_by_file = module_files
        .iter()
        .map(|(module_id, file_path)| (file_path.as_str(), *module_id))
        .collect::<BTreeMap<_, _>>();
    let route_modules = graph_role_files(request, "api_route")
        .into_iter()
        .filter(|file_path| is_candidate_scope_file(file_path))
        .filter_map(|file_path| module_by_file.get(file_path.as_str()).copied())
        .collect::<BTreeSet<_>>();
    let data_modules = graph_role_files(request, "data_access_module")
        .into_iter()
        .filter(|file_path| {
            is_data_access_module_path(file_path) || imports_data_access_as_data_client(file_path)
        })
        .filter_map(|file_path| module_by_file.get(file_path.as_str()).copied())
        .collect::<BTreeSet<_>>();
    let import_owner_module = request
        .graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "IMPORT_DECL_REFERENCES_MODULE")
        .map(|edge| (edge.from.as_str(), edge.to.as_str()))
        .collect::<BTreeMap<_, _>>();
    let evidence_by_id = request
        .graph
        .graph_evidence
        .iter()
        .map(|evidence| (evidence.id.as_str(), evidence))
        .collect::<BTreeMap<_, _>>();

    request
        .graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "IMPORT_RESOLVES_TO_MODULE")
        .filter_map(|edge| {
            let owner_module = import_owner_module.get(edge.from.as_str())?;
            if !route_modules.contains(owner_module) || !data_modules.contains(edge.to.as_str()) {
                return None;
            }
            let import_node = nodes_by_id.get(edge.from.as_str())?;
            let source = metadata_string(&import_node.metadata, "source")
                .or_else(|| metadata_string(&import_node.metadata, "resolved_file_path"))?;
            let local_name = metadata_string(&import_node.metadata, "local_name")
                .unwrap_or_else(|| source.clone());
            let file_path = metadata_string(&import_node.metadata, "file_path")?;
            let evidence = first_graph_evidence(
                edge.evidence_ids
                    .iter()
                    .chain(import_node.evidence_ids.iter()),
                &evidence_by_id,
            );
            Some(GraphImportEvidence {
                source,
                local_name,
                file_path,
                evidence_id: evidence
                    .map(|evidence| evidence.id.clone())
                    .or_else(|| edge.evidence_ids.first().cloned())
                    .or_else(|| import_node.evidence_ids.first().cloned())
                    .unwrap_or_else(|| {
                        format!(
                            "evidence_ref_{}",
                            &stable_hash(&format!("{}:{}", edge.from, edge.to))[..16]
                        )
                    }),
                start_line: evidence.map(|evidence| evidence.start_line),
                end_line: evidence.map(|evidence| evidence.end_line),
                fact_ids: evidence
                    .map(|evidence| evidence.fact_ids.clone())
                    .unwrap_or_default(),
                file_hash: evidence
                    .map(|evidence| evidence.file_hash.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
            })
        })
        .collect()
}

fn first_graph_evidence<'a, I>(
    mut evidence_ids: I,
    evidence_by_id: &BTreeMap<&'a str, &'a GraphEvidence>,
) -> Option<&'a GraphEvidence>
where
    I: Iterator<Item = &'a String>,
{
    evidence_ids.find_map(|id| evidence_by_id.get(id.as_str()).copied())
}

fn resolved_imports_by_fact(request: &CandidateRequest) -> BTreeMap<String, String> {
    request
        .graph
        .graph_nodes
        .iter()
        .filter(|node| node.kind == "import_decl")
        .filter_map(|node| {
            let file_path = metadata_string(&node.metadata, "file_path")?;
            let local_name = metadata_string(&node.metadata, "local_name")?;
            let source = metadata_string(&node.metadata, "source")?;
            let resolved_file_path = metadata_string(&node.metadata, "resolved_file_path")?;
            Some((
                import_key_parts(&file_path, &local_name, &source),
                resolved_file_path,
            ))
        })
        .collect()
}

fn metadata_string(metadata: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    metadata.get(key)?.as_str().map(ToOwned::to_owned)
}

fn import_key(fact: &CheckFact) -> String {
    import_key_parts(
        &fact.file_path,
        &fact.name,
        fact.value.as_deref().unwrap_or_default(),
    )
}

fn import_key_parts(file_path: &str, local_name: &str, source: &str) -> String {
    format!("{file_path}\0{local_name}\0{source}")
}

/// Fraction of in-scope files that may violate a convention before it is treated as an
/// aspiration rather than an established practice.
pub const CONVENTION_MAJORITY_VIOLATION_THRESHOLD: f64 = 0.5;

/// Choose the enforcement mode from the *direction* of the evidence, not just its volume.
///
/// This candidate is inferred from violations, so a repo where direct data access is
/// universal produces the same statement as a repo where it happens once. Enforcing
/// `block` in the first case would reject new routes written exactly like their
/// neighbours - the opposite of holding code to the repo's established patterns, and
/// precisely the code an agent following local convention would write.
///
/// So: when a minority of in-scope files violate, the convention is real and new
/// violations block. When a majority violate, the statement is a refactor goal; it is
/// still materialized with full evidence, but only warns until a human decides otherwise.
pub fn suggested_mode_for_coverage(violating_files: usize, scope_files: usize) -> &'static str {
    if scope_files == 0 {
        return "warn";
    }
    let violation_ratio = (violating_files as f64 / scope_files as f64).min(1.0);
    if violation_ratio > CONVENTION_MAJORITY_VIOLATION_THRESHOLD {
        "warn"
    } else {
        "block"
    }
}

/// The coverage-direction decision, computed from the baseline scan only (E-6 / D-2).
///
/// `demoted` is the explicit marker for a *legitimate* baseline-driven demotion: the
/// repo's own committed files violate in the majority, so the statement is an aspiration
/// and only warns. It is machine-readable in `scoring.coverage_direction` precisely so a
/// block -> warn direction can never move silently - T100's recall improvement demoted
/// taxonomy with nothing in any output saying so.
pub struct CoverageDirection {
    pub violating_files: usize,
    pub scope_files: usize,
    pub violation_ratio: f64,
    pub demoted: bool,
    pub mode: &'static str,
}

impl CoverageDirection {
    pub fn to_json(&self) -> Value {
        json!({
            "violating_files": self.violating_files,
            "scope_files": self.scope_files,
            "violation_ratio": self.violation_ratio,
            "threshold": CONVENTION_MAJORITY_VIOLATION_THRESHOLD,
            "demoted": self.demoted
        })
    }
}

/// Compute enforcement direction from the files that were already part of the repo.
///
/// Files named in `diff_changed_files` (changed relative to the git baseline) are
/// excluded from both the numerator and the denominator: a diff that adds newly-detected
/// violations must not be able to push the violating ratio past the threshold and demote
/// the convention (the T100 pathology, pre-registered as decision D-2). An empty
/// exclusion set reproduces the old computation exactly.
pub fn baseline_coverage_direction(
    violating_files: &BTreeSet<&str>,
    scope_files: &BTreeSet<&str>,
    diff_changed_files: &BTreeSet<&str>,
) -> CoverageDirection {
    let baseline_scope = scope_files
        .iter()
        .filter(|file_path| !diff_changed_files.contains(*file_path))
        .count();
    let baseline_violating = violating_files
        .iter()
        .filter(|file_path| !diff_changed_files.contains(*file_path))
        .count();
    let violation_ratio = if baseline_scope == 0 {
        0.0
    } else {
        (baseline_violating as f64 / baseline_scope as f64).min(1.0)
    };
    CoverageDirection {
        violating_files: baseline_violating,
        scope_files: baseline_scope,
        violation_ratio,
        demoted: baseline_scope > 0 && violation_ratio > CONVENTION_MAJORITY_VIOLATION_THRESHOLD,
        mode: suggested_mode_for_coverage(baseline_violating, baseline_scope),
    }
}

fn scoring(
    supporting: usize,
    counterexamples: usize,
    scope_files: usize,
    covered_scope_files: usize,
    heuristic_id: &str,
) -> Value {
    json!({
        "supporting_examples_count": supporting,
        "counterexamples_count": counterexamples,
        "scope_files_count": scope_files,
        "coverage_ratio": if scope_files == 0 {
            0.0
        } else {
            (covered_scope_files as f64 / scope_files as f64).min(1.0)
        },
        "heuristic_id": heuristic_id
    })
}

fn unique_evidence_file_count(
    facts: &[&CheckFact],
    graph_imports: &[GraphImportEvidence],
) -> usize {
    facts
        .iter()
        .map(|fact| fact.file_path.as_str())
        .chain(graph_imports.iter().map(|import| import.file_path.as_str()))
        .collect::<BTreeSet<_>>()
        .len()
}

fn unique_fact_file_count(facts: &[&CheckFact]) -> usize {
    facts
        .iter()
        .map(|fact| fact.file_path.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

fn evidence_refs(
    scan_id: &str,
    facts: &[&CheckFact],
    file_hashes: &BTreeMap<&str, &str>,
    kind: &str,
) -> Vec<EngineCandidateEvidenceRef> {
    facts
        .iter()
        .map(|fact| {
            let import_source = if fact.kind == "import_used" {
                fact.value.clone()
            } else {
                None
            };
            EngineCandidateEvidenceRef {
                id: format!("evidence_ref_{}", &stable_hash(&fact_key(fact))[..16]),
                kind: kind.to_string(),
                file_path: fact.file_path.clone(),
                start_line: Some(fact.start_line),
                end_line: Some(fact.end_line),
                symbol: Some(fact.name.clone()),
                import_source,
                fact_ids: vec![fact_key(fact)],
                scan_id: scan_id.to_string(),
                file_hash: file_hashes
                    .get(fact.file_path.as_str())
                    .copied()
                    .unwrap_or("unknown")
                    .to_string(),
                redaction_state: "none".to_string(),
            }
        })
        .collect()
}

fn combined_evidence_refs(
    scan_id: &str,
    facts: &[&CheckFact],
    graph_imports: &[GraphImportEvidence],
    file_hashes: &BTreeMap<&str, &str>,
    kind: &str,
) -> Vec<EngineCandidateEvidenceRef> {
    let mut refs = evidence_refs(scan_id, facts, file_hashes, kind);
    refs.extend(
        graph_imports
            .iter()
            .map(|import| EngineCandidateEvidenceRef {
                id: import.evidence_id.clone(),
                kind: kind.to_string(),
                file_path: import.file_path.clone(),
                start_line: import.start_line,
                end_line: import.end_line,
                symbol: Some(import.local_name.clone()),
                import_source: Some(import.source.clone()),
                fact_ids: import.fact_ids.clone(),
                scan_id: scan_id.to_string(),
                file_hash: import.file_hash.clone(),
                redaction_state: "none".to_string(),
            }),
    );
    let mut deduped: Vec<EngineCandidateEvidenceRef> = Vec::new();
    let mut refs_by_key: BTreeMap<String, usize> = BTreeMap::new();
    for reference in refs {
        let key = format!(
            "{}\0{:?}\0{:?}\0{:?}\0{:?}",
            reference.file_path,
            reference.start_line,
            reference.end_line,
            reference.symbol,
            reference.import_source
        );
        if let Some(index) = refs_by_key.get(&key).copied() {
            let existing = &mut deduped[index];
            for fact_id in reference.fact_ids {
                if !existing.fact_ids.contains(&fact_id) {
                    existing.fact_ids.push(fact_id);
                }
            }
            continue;
        }
        refs_by_key.insert(key, deduped.len());
        deduped.push(reference);
    }
    deduped
}

fn fact_key(fact: &CheckFact) -> String {
    format!(
        "fact:{}:{}:{}:{}-{}",
        fact.kind, fact.file_path, fact.name, fact.start_line, fact.end_line
    )
}

fn evidence_fingerprint(refs: &[EngineCandidateEvidenceRef]) -> String {
    stable_hash(&format!(
        "{}",
        json!(
            refs.iter()
                .map(|reference| json!({
                    "id": reference.id,
                    "file_path": reference.file_path,
                    "start_line": reference.start_line,
                    "end_line": reference.end_line,
                    "symbol": reference.symbol,
                    "fact_ids": reference.fact_ids,
                    "file_hash": reference.file_hash
                }))
                .collect::<Vec<_>>()
        )
    ))
}

fn candidate_id(repo_id: &str, kind: &str, matcher: &Value) -> String {
    format!(
        "candidate_{}",
        &stable_hash(&format!("{repo_id}:{kind}:{matcher}"))[..16]
    )
}

fn stable_hash_json(value: &Value) -> String {
    stable_hash(&value.to_string())
}

fn graph_fingerprint(request: &CandidateRequest) -> String {
    stable_hash(&format!(
        "{}:{}",
        request
            .graph
            .graph_nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>()
            .join(","),
        request
            .graph
            .graph_edges
            .iter()
            .map(|edge| edge.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    ))
}

fn stable_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod coverage_direction_tests {
    use super::suggested_mode_for_coverage;

    /// The data-access candidate is inferred *from violations*, so a repo where direct
    /// data access is universal produces the same statement as one where it happens
    /// once. Blocking in the first case would reject new routes written exactly like
    /// their neighbours - the opposite of holding code to established local patterns.
    #[test]
    fn suggests_block_only_when_a_minority_of_routes_violate() {
        // formbricks shape: 1 of 83 routes violates - a real convention with one outlier.
        assert_eq!(suggested_mode_for_coverage(1, 83), "block");
        // Exactly half is still treated as established practice.
        assert_eq!(suggested_mode_for_coverage(5, 10), "block");
        // taxonomy shape: 4 of 7 routes violate - direct access is the local norm.
        assert_eq!(suggested_mode_for_coverage(4, 7), "warn");
        // dub shape: ~323 of 494 routes violate - an aspiration, not a convention.
        assert_eq!(suggested_mode_for_coverage(323, 494), "warn");
        // Universal violation must never block.
        assert_eq!(suggested_mode_for_coverage(10, 10), "warn");
        // A degenerate scope cannot justify blocking.
        assert_eq!(suggested_mode_for_coverage(0, 0), "warn");
    }
}
