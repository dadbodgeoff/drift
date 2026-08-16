use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

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
    let scope_file_count = api_route_files
        .iter()
        .copied()
        .chain(graph_api_route_files.iter().map(String::as_str))
        .collect::<BTreeSet<_>>()
        .len();
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
            "path_globs": ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
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
            suggested_enforcement_mode: "warn".to_string(),
            enforcement_capability: "deterministic_check".to_string(),
            confidence_label: "high".to_string(),
            scoring: scoring(
                data_imports.len() + graph_data_imports.len(),
                0,
                scope_file_count,
                unique_evidence_file_count(&data_imports, &graph_data_imports),
                "engine-direct-data-access-v1",
            ),
            required_capabilities: vec![
                "syntax_facts".to_string(),
                "import_resolution".to_string(),
                "route_detection".to_string(),
            ],
            evidence_refs,
            counterexample_refs,
            reason_not_blocking: "candidate_not_accepted".to_string(),
            evidence_fingerprint,
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
            "path_globs": ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
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
    stats.capabilities = capability_stats(&["candidate_inference"], &[]);

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
            reasons: Vec::new(),
        }],
    }
}

fn is_data_access_source(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    lower.contains("prisma")
        || lower.contains("database")
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

    candidates
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
            || matches!(
                lower.as_str(),
                "requireuser" | "getuser" | "getcurrentuser" | "currentuser" | "withworkspace"
            ))
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
        .filter(|file_path| is_data_access_module_path(file_path))
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
    refs
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
