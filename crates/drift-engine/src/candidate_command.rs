use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::protocol::{
    CandidateRequest, CandidateResult, CheckFact, ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION,
    EngineCandidate, EngineCandidateEvidenceRef, EngineCompleteness, GraphEvidence,
    adapter_versions, engine_stats,
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
            suggested_severity: "error".to_string(),
            suggested_enforcement_mode: "block".to_string(),
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
                "route_role_detection".to_string(),
            ],
            evidence_refs: combined_evidence_refs(
                &request.scan.scan_id,
                &data_imports,
                &graph_data_imports,
                &file_hashes,
                "supporting",
            ),
            counterexample_refs: Vec::new(),
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
                "route_flow_graph".to_string(),
            ],
            evidence_refs: evidence_refs(&request.scan.scan_id, &service_imports, &file_hashes, "supporting"),
            counterexample_refs: combined_evidence_refs(&request.scan.scan_id, &data_imports, &graph_data_imports, &file_hashes, "counterexample"),
        });
    }

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
    let mut files = role_files(request, "data_access_module");
    for fact in &request.scan.facts {
        if fact.kind == "import_used"
            && !service_files.contains(fact.file_path.as_str())
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
            let import_source = fact.value.clone();
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
