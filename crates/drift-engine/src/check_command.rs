use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

use drift_engine::{
    BaselineStatus, BaselineViolation, DiffFile, DiffScope, DirectDataAccessRule, EnforcementMode,
    Fact, FactKind, FindingStatus, ParsedDiff, RuleFinding, Severity,
    classify_findings_against_baseline, classify_findings_against_diff,
    materialize_direct_data_access_findings,
};

use crate::protocol::{
    CheckBaselineViolation, CheckEvidence, CheckFact, CheckFinding, CheckGraphData, CheckRequest,
    CheckResult, ENGINE_CHECK_RESULT_SCHEMA_VERSION, EngineCompleteness, GraphEdge, GraphNode,
    adapter_versions, engine_stats,
};

pub fn check_repo(request: CheckRequest) -> CheckResult {
    let started = Instant::now();
    let mut completeness_reasons = check_limit_reasons(&request);
    completeness_reasons.extend(check_graph_completeness_reasons(&request));
    completeness_reasons.sort();
    completeness_reasons.dedup();
    let can_block = completeness_reasons.is_empty();
    let graph_node_count = request.graph.graph_nodes.len();
    let graph_edge_count = request.graph.graph_edges.len();
    let facts = request
        .scan
        .facts
        .into_iter()
        .filter_map(check_fact_to_engine_fact)
        .collect::<Vec<_>>();
    let baseline = request
        .baseline
        .into_iter()
        .filter_map(check_baseline_to_engine_baseline)
        .collect::<Vec<_>>();
    let diff_scope = diff_scope_from_str(&request.diff.mode);
    let parsed_diff = ParsedDiff {
        files: request
            .diff
            .files
            .unwrap_or_default()
            .into_iter()
            .map(|file| DiffFile {
                path: file.path,
                changed_lines: file.changed_lines,
            })
            .collect(),
    };

    let mut findings = Vec::new();
    for convention in request.contract.conventions {
        if convention.enforcement_capability != "deterministic_check"
            || convention.enforcement_mode == "off"
        {
            continue;
        }
        let severity = severity_from_str(&convention.severity);
        let enforcement_mode = enforcement_mode_from_str(&convention.enforcement_mode);
        let mut rule_findings = if convention.kind == "api_route_no_direct_data_access" {
            let rule = DirectDataAccessRule {
                convention_id: convention.id.clone(),
                forbidden_imports: convention.matcher.forbidden_imports.unwrap_or_default(),
                severity,
                enforcement_mode,
            };
            let mut findings = materialize_direct_data_access_findings(&facts, &rule)
                .into_iter()
                .map(|finding| PendingFinding {
                    fingerprint: finding.fingerprint.clone(),
                    convention_id: finding.convention_id.clone(),
                    rule_id: "api_route_no_direct_data_access".to_string(),
                    title: finding.title,
                    message: finding.message,
                    severity: finding.severity,
                    enforcement_result: finding.enforcement_result,
                    file_path: finding.file_path,
                    import_name: finding.import_name,
                    import_source: finding.import_source,
                    line: finding.line,
                    evidence_id: format!("evidence_{}", &finding.fingerprint[..16]),
                    related_node_ids: Vec::new(),
                })
                .collect::<Vec<_>>();
            findings.extend(graph_direct_data_access_findings(&request.graph, &rule));
            findings
        } else if convention.kind == "api_route_requires_service_delegation" {
            let allowed_delegate_imports = convention
                .matcher
                .allowed_delegate_imports
                .unwrap_or_default();
            graph_service_delegation_findings(
                &request.graph,
                &convention.id,
                severity,
                enforcement_mode,
                &allowed_delegate_imports,
            )
        } else {
            continue;
        };
        dedupe_pending_findings(&mut rule_findings);
        let pending_by_fingerprint = rule_findings
            .iter()
            .map(|finding| (finding.fingerprint.clone(), finding.clone()))
            .collect::<BTreeMap<_, _>>();
        let baseline_classified = classify_findings_against_baseline(
            rule_findings.into_iter().map(RuleFinding::from).collect(),
            &baseline,
        );
        let statuses_by_fingerprint = baseline_classified
            .iter()
            .map(|classified| (classified.finding.fingerprint.clone(), classified.status))
            .collect::<std::collections::BTreeMap<_, _>>();
        let diff_classified = classify_findings_against_diff(
            baseline_classified
                .into_iter()
                .map(|classified| classified.finding)
                .collect(),
            &parsed_diff,
            diff_scope,
        );
        for classified in diff_classified {
            let finding = classified.finding;
            let status_hint = statuses_by_fingerprint
                .get(&finding.fingerprint)
                .copied()
                .unwrap_or(FindingStatus::New);
            findings.push(CheckFinding {
                id: format!("finding_{}", &finding.fingerprint[..16]),
                fingerprint: finding.fingerprint.clone(),
                convention_id: finding.convention_id.clone(),
                rule_id: pending_by_fingerprint
                    .get(&finding.fingerprint)
                    .map(|pending| pending.rule_id.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                title: finding.title,
                message: finding.message,
                severity: severity_to_str(finding.severity).to_string(),
                enforcement_result: if can_block {
                    enforcement_result_to_str(finding.enforcement_result).to_string()
                } else {
                    "none".to_string()
                },
                status_hint: finding_status_to_str(status_hint).to_string(),
                diff_status: diff_status_to_str(classified.diff_status).to_string(),
                evidence: vec![CheckEvidence {
                    file_path: finding.file_path.clone(),
                    start_line: finding.line,
                    end_line: finding.line,
                    evidence_id: pending_by_fingerprint
                        .get(&finding.fingerprint)
                        .map(|pending| pending.evidence_id.clone())
                        .unwrap_or_else(|| format!("evidence_{}", &finding.fingerprint[..16])),
                }],
                related_node_ids: pending_by_fingerprint
                    .get(&finding.fingerprint)
                    .map(|pending| pending.related_node_ids.clone())
                    .unwrap_or_default(),
            });
        }
    }

    let mut stats = engine_stats(0, 0, 0, facts.len(), 0, started.elapsed().as_millis());
    stats.graph_nodes = graph_node_count;
    stats.graph_edges = graph_edge_count;
    stats.truncated = !can_block;
    let diagnostics = completeness_reasons
        .iter()
        .take(request.limits.max_diagnostics)
        .map(|reason| crate::protocol::EngineDiagnostic {
            severity: "warning".to_string(),
            code: "check_limits_exceeded".to_string(),
            message: reason.clone(),
            file_path: None,
        })
        .collect::<Vec<_>>();

    CheckResult {
        schema_version: ENGINE_CHECK_RESULT_SCHEMA_VERSION,
        repo_id: request.repo.repo_id,
        scan_id: request.scan.scan_id,
        engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        rule_engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        adapter_versions: adapter_versions(),
        diff_mode: request.diff.mode,
        stats,
        findings,
        diagnostics,
        completeness: vec![EngineCompleteness {
            scope: "repo".to_string(),
            complete: can_block,
            required_capabilities: vec!["direct_data_access_check".to_string()],
            missing_capabilities: Vec::new(),
            truncated: !can_block,
            can_block,
            reasons: completeness_reasons,
        }],
    }
}

fn check_limit_reasons(request: &CheckRequest) -> Vec<String> {
    let mut reasons = Vec::new();
    let _scan_limits = (
        request.limits.max_files_seen,
        request.limits.max_files_parsed,
        request.limits.max_file_bytes,
    );
    if request.scan.facts.len() > request.limits.max_facts {
        reasons.push(format!(
            "facts_exceeded_limit: {} > {}",
            request.scan.facts.len(),
            request.limits.max_facts
        ));
    }
    if request.graph.graph_nodes.len() > request.limits.max_graph_nodes {
        reasons.push(format!(
            "graph_nodes_exceeded_limit: {} > {}",
            request.graph.graph_nodes.len(),
            request.limits.max_graph_nodes
        ));
    }
    if request.graph.graph_edges.len() > request.limits.max_graph_edges {
        reasons.push(format!(
            "graph_edges_exceeded_limit: {} > {}",
            request.graph.graph_edges.len(),
            request.limits.max_graph_edges
        ));
    }
    if request.limits.follow_symlinks {
        reasons.push("follow_symlinks_not_supported".to_string());
    }
    reasons
}

fn check_graph_completeness_reasons(request: &CheckRequest) -> Vec<String> {
    let nodes_by_id = request
        .graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let api_route_files = api_route_files(&request.graph.graph_edges, &nodes_by_id);
    request
        .graph
        .graph_diagnostics
        .iter()
        .filter(|diagnostic| {
            matches!(
                diagnostic.code.as_str(),
                "unresolved_import" | "unresolved_import_symbol" | "unsupported_namespace_import_symbol"
            )
        })
        .filter_map(|diagnostic| {
            let file_path = diagnostic.file_path.as_deref()?;
            if api_route_files.contains(file_path) {
                Some(match diagnostic.code.as_str() {
                    "unresolved_import" => format!("unresolved_route_import:{file_path}"),
                    "unresolved_import_symbol" => {
                        format!("unresolved_route_import_symbol:{file_path}")
                    }
                    "unsupported_namespace_import_symbol" => {
                        format!("unsupported_route_namespace_import:{file_path}")
                    }
                    _ => unreachable!(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[derive(Clone)]
struct PendingFinding {
    fingerprint: String,
    convention_id: String,
    rule_id: String,
    title: String,
    message: String,
    severity: Severity,
    enforcement_result: drift_engine::EnforcementResult,
    file_path: String,
    import_name: String,
    import_source: String,
    line: usize,
    evidence_id: String,
    related_node_ids: Vec<String>,
}

impl From<PendingFinding> for drift_engine::RuleFinding {
    fn from(value: PendingFinding) -> Self {
        drift_engine::RuleFinding {
            fingerprint: value.fingerprint,
            convention_id: value.convention_id,
            title: value.title,
            message: value.message,
            severity: value.severity,
            enforcement_result: value.enforcement_result,
            file_path: value.file_path,
            import_name: value.import_name,
            import_source: value.import_source,
            line: value.line,
        }
    }
}

fn graph_direct_data_access_findings(
    graph: &CheckGraphData,
    rule: &DirectDataAccessRule,
) -> Vec<PendingFinding> {
    let nodes_by_id = graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let api_route_files = api_route_files(&graph.graph_edges, &nodes_by_id);
    let module_files = graph
        .graph_nodes
        .iter()
        .filter(|node| node.kind == "module")
        .filter_map(|node| string_metadata(node, "file_path").map(|path| (node.id.as_str(), path)))
        .collect::<BTreeMap<_, _>>();
    let module_by_file = module_files
        .iter()
        .map(|(module_id, file_path)| (*file_path, *module_id))
        .collect::<BTreeMap<_, _>>();
    let mut route_modules = BTreeSet::new();
    for file_path in &api_route_files {
        if let Some(module_id) = module_by_file.get(file_path.as_str()) {
            route_modules.insert(*module_id);
        }
    }
    let import_owner_module = graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "IMPORT_DECL_REFERENCES_MODULE")
        .map(|edge| (edge.from.as_str(), edge.to.as_str()))
        .collect::<BTreeMap<_, _>>();
    let resolved_import_edges = graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "IMPORT_RESOLVES_TO_MODULE")
        .collect::<Vec<_>>();
    let evidence_lines = graph
        .graph_evidence
        .iter()
        .map(|evidence| (evidence.id.as_str(), evidence.start_line))
        .collect::<BTreeMap<_, _>>();

    let mut findings = Vec::new();
    for edge in resolved_import_edges {
        let Some(owner_module) = import_owner_module.get(edge.from.as_str()) else {
            continue;
        };
        if !route_modules.contains(owner_module) {
            continue;
        }
        let Some(import_node) = nodes_by_id.get(edge.from.as_str()) else {
            continue;
        };
        let Some(resolved_path) = module_files.get(edge.to.as_str()) else {
            continue;
        };
        let import_source =
            string_metadata(import_node, "source").unwrap_or(import_node.label.as_str());
        if is_forbidden_import_source(import_source, &rule.forbidden_imports) {
            continue;
        }
        let Some((forbidden_module_id, forbidden_path, reexport_chain)) =
            forbidden_graph_import_target(
                edge.to.as_str(),
                import_node,
                resolved_path,
                &graph.graph_edges,
                &module_files,
                &rule.forbidden_imports,
            )
        else {
            continue;
        };
        let file_path = string_metadata(import_node, "file_path")
            .unwrap_or_default()
            .to_string();
        let import_name = string_metadata(import_node, "local_name").unwrap_or(import_source);
        let evidence_id = edge
            .evidence_ids
            .first()
            .cloned()
            .or_else(|| import_node.evidence_ids.first().cloned())
            .unwrap_or_else(|| {
                format!(
                    "evidence_graph_{}",
                    stable_hash(&format!("{}:{}", file_path, import_source))[..16].to_string()
                )
            });
        let line = evidence_lines
            .get(evidence_id.as_str())
            .copied()
            .unwrap_or(1);
        let fingerprint = stable_hash(&format!(
            "{}:{}:graph_direct_data_access:{}",
            rule.convention_id, file_path, forbidden_path
        ));
        let message = if reexport_chain.is_empty() {
            format!(
                "API route {file_path} imports {import_source}, which resolves to forbidden data-access module {forbidden_path}."
            )
        } else {
            format!(
                "API route {file_path} imports {import_source}, which reaches forbidden data-access module {forbidden_path} through a re-export chain."
            )
        };
        let mut related_node_ids = vec![
            edge.from.clone(),
            edge.to.clone(),
            (*owner_module).to_string(),
            forbidden_module_id.to_string(),
        ];
        related_node_ids.extend(reexport_chain);
        related_node_ids.sort();
        related_node_ids.dedup();
        findings.push(PendingFinding {
            fingerprint,
            convention_id: rule.convention_id.clone(),
            rule_id: "api_route_no_direct_data_access".to_string(),
            title: "API route imports data access directly".to_string(),
            message,
            severity: rule.severity,
            enforcement_result: match rule.enforcement_mode {
                EnforcementMode::Block => drift_engine::EnforcementResult::Block,
                EnforcementMode::Warn => drift_engine::EnforcementResult::Warn,
                _ => drift_engine::EnforcementResult::None,
            },
            file_path,
            import_name: import_name.to_string(),
            import_source: import_source.to_string(),
            line,
            evidence_id,
            related_node_ids,
        });
    }
    findings
}

fn graph_service_delegation_findings(
    graph: &CheckGraphData,
    convention_id: &str,
    severity: Severity,
    enforcement_mode: EnforcementMode,
    _allowed_delegate_imports: &[String],
) -> Vec<PendingFinding> {
    let nodes_by_id = graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let api_route_files = api_route_files(&graph.graph_edges, &nodes_by_id);
    let module_files = graph
        .graph_nodes
        .iter()
        .filter(|node| node.kind == "module")
        .filter_map(|node| string_metadata(node, "file_path").map(|path| (node.id.as_str(), path)))
        .collect::<BTreeMap<_, _>>();
    let module_by_file = module_files
        .iter()
        .map(|(module_id, file_path)| (*file_path, *module_id))
        .collect::<BTreeMap<_, _>>();
    let route_modules = api_route_files
        .iter()
        .filter_map(|file_path| module_by_file.get(file_path.as_str()).copied())
        .collect::<BTreeSet<_>>();
    let data_access_modules = role_modules(
        &graph.graph_edges,
        &nodes_by_id,
        &module_by_file,
        "data_access_module",
    );
    let evidence_lines = graph
        .graph_evidence
        .iter()
        .map(|evidence| (evidence.id.as_str(), evidence.start_line))
        .collect::<BTreeMap<_, _>>();

    let mut findings = Vec::new();
    for edge in graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "MODULE_IMPORTS_MODULE")
    {
        if !route_modules.contains(edge.from.as_str())
            || !data_access_modules.contains(edge.to.as_str())
        {
            continue;
        }
        let Some(route_file) = module_files.get(edge.from.as_str()) else {
            continue;
        };
        let Some(data_file) = module_files.get(edge.to.as_str()) else {
            continue;
        };
        let evidence_id = edge.evidence_ids.first().cloned().unwrap_or_else(|| {
            format!(
                "evidence_graph_{}",
                stable_hash(&format!("{route_file}:{data_file}"))[..16].to_string()
            )
        });
        let line = evidence_lines
            .get(evidence_id.as_str())
            .copied()
            .unwrap_or(1);
        let fingerprint = stable_hash(&format!(
            "{convention_id}:{route_file}:requires_service_delegation:{data_file}"
        ));
        findings.push(PendingFinding {
            fingerprint,
            convention_id: convention_id.to_string(),
            rule_id: "api_route_requires_service_delegation".to_string(),
            title: "API route reaches data access without service delegation".to_string(),
            message: format!(
                "API route {route_file} imports data-access module {data_file} directly instead of delegating through an approved service module."
            ),
            severity,
            enforcement_result: enforcement_result_for_mode(enforcement_mode),
            file_path: (*route_file).to_string(),
            import_name: (*data_file).to_string(),
            import_source: (*data_file).to_string(),
            line,
            evidence_id,
            related_node_ids: vec![edge.from.clone(), edge.to.clone()],
        });
    }
    findings
}

fn role_modules<'a>(
    edges: &'a [GraphEdge],
    nodes_by_id: &BTreeMap<&'a str, &'a GraphNode>,
    module_by_file: &BTreeMap<&'a str, &'a str>,
    role_name: &str,
) -> BTreeSet<&'a str> {
    edges
        .iter()
        .filter(|edge| edge.kind == "FILE_HAS_ROLE")
        .filter_map(|edge| {
            let role = nodes_by_id.get(edge.to.as_str())?;
            if string_metadata(role, "role")? != role_name {
                return None;
            }
            let file = nodes_by_id.get(edge.from.as_str())?;
            let file_path = string_metadata(file, "path")?;
            module_by_file.get(file_path).copied()
        })
        .collect()
}

fn api_route_files<'a>(
    edges: &'a [GraphEdge],
    nodes_by_id: &BTreeMap<&'a str, &'a GraphNode>,
) -> BTreeSet<String> {
    edges
        .iter()
        .filter(|edge| edge.kind == "FILE_HAS_ROLE")
        .filter_map(|edge| {
            let role = nodes_by_id.get(edge.to.as_str())?;
            if string_metadata(role, "role")? != "api_route" {
                return None;
            }
            let file = nodes_by_id.get(edge.from.as_str())?;
            string_metadata(file, "path").map(ToOwned::to_owned)
        })
        .collect()
}

fn is_forbidden_graph_import(
    import_node: &GraphNode,
    resolved_path: &str,
    forbidden_imports: &[String],
) -> bool {
    let import_source = string_metadata(import_node, "source").unwrap_or("");
    forbidden_imports.iter().any(|forbidden| {
        resolved_path == forbidden
            || resolved_path.contains(forbidden)
            || import_source == forbidden
            || import_source.contains(forbidden)
    })
}

fn forbidden_graph_import_target<'a>(
    resolved_module_id: &'a str,
    import_node: &GraphNode,
    resolved_path: &'a str,
    edges: &'a [GraphEdge],
    module_files: &BTreeMap<&'a str, &'a str>,
    forbidden_imports: &[String],
) -> Option<(&'a str, &'a str, Vec<String>)> {
    if is_forbidden_graph_import(import_node, resolved_path, forbidden_imports) {
        return Some((resolved_module_id, resolved_path, Vec::new()));
    }
    let mut visited = BTreeSet::new();
    let mut queue = vec![(resolved_module_id, Vec::<String>::new())];
    while let Some((module_id, chain)) = queue.pop() {
        if !visited.insert(module_id) {
            continue;
        }
        for edge in edges
            .iter()
            .filter(|edge| edge.kind == "MODULE_REEXPORTS_MODULE" && edge.from == module_id)
        {
            let Some(target_path) = module_files.get(edge.to.as_str()).copied() else {
                continue;
            };
            let mut next_chain = chain.clone();
            next_chain.push(edge.from.clone());
            next_chain.push(edge.to.clone());
            if forbidden_imports.iter().any(|forbidden| {
                target_path == forbidden || target_path.contains(forbidden)
            }) {
                return Some((edge.to.as_str(), target_path, next_chain));
            }
            queue.push((edge.to.as_str(), next_chain));
        }
    }
    None
}

fn is_forbidden_import_source(import_source: &str, forbidden_imports: &[String]) -> bool {
    forbidden_imports
        .iter()
        .any(|forbidden| import_source == forbidden || import_source.contains(forbidden))
}

fn enforcement_result_for_mode(mode: EnforcementMode) -> drift_engine::EnforcementResult {
    match mode {
        EnforcementMode::Block => drift_engine::EnforcementResult::Block,
        EnforcementMode::Warn => drift_engine::EnforcementResult::Warn,
        _ => drift_engine::EnforcementResult::None,
    }
}

fn string_metadata<'a>(node: &'a GraphNode, key: &str) -> Option<&'a str> {
    node.metadata.get(key).and_then(|value| value.as_str())
}

fn dedupe_pending_findings(findings: &mut Vec<PendingFinding>) {
    let mut seen = BTreeSet::new();
    findings.retain(|finding| seen.insert(finding.fingerprint.clone()));
}

fn stable_hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn check_fact_to_engine_fact(fact: CheckFact) -> Option<Fact> {
    Some(Fact {
        kind: fact_kind_from_str(&fact.kind)?,
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        imported_name: fact.imported_name,
        start_line: fact.start_line,
        end_line: fact.end_line,
    })
}

fn check_baseline_to_engine_baseline(
    baseline: CheckBaselineViolation,
) -> Option<BaselineViolation> {
    Some(BaselineViolation {
        convention_id: baseline.convention_id,
        fingerprint: baseline.finding_fingerprint,
        status: match baseline.status.as_str() {
            "active" => BaselineStatus::Active,
            "resolved" => BaselineStatus::Resolved,
            _ => return None,
        },
    })
}

fn fact_kind_from_str(kind: &str) -> Option<FactKind> {
    match kind {
        "file_detected" => Some(FactKind::FileDetected),
        "import_used" => Some(FactKind::ImportUsed),
        "re_export_used" => Some(FactKind::ReExportUsed),
        "exported_symbol" => Some(FactKind::ExportedSymbol),
        "symbol_called" => Some(FactKind::SymbolCalled),
        "data_operation_detected" => Some(FactKind::DataOperationDetected),
        "route_declared" => Some(FactKind::RouteDeclared),
        "file_role_detected" => Some(FactKind::FileRoleDetected),
        "test_declared" => Some(FactKind::TestDeclared),
        _ => None,
    }
}

fn severity_from_str(severity: &str) -> Severity {
    match severity {
        "info" => Severity::Info,
        "warning" => Severity::Warning,
        _ => Severity::Error,
    }
}

fn severity_to_str(severity: Severity) -> &'static str {
    match severity {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Error => "error",
    }
}

fn enforcement_mode_from_str(mode: &str) -> EnforcementMode {
    match mode {
        "brief" => EnforcementMode::Brief,
        "warn" => EnforcementMode::Warn,
        "block" => EnforcementMode::Block,
        _ => EnforcementMode::Off,
    }
}

fn enforcement_result_to_str(result: drift_engine::EnforcementResult) -> &'static str {
    match result {
        drift_engine::EnforcementResult::None => "none",
        drift_engine::EnforcementResult::Warn => "warn",
        drift_engine::EnforcementResult::Block => "block",
    }
}

fn finding_status_to_str(status: FindingStatus) -> &'static str {
    match status {
        FindingStatus::New => "new",
        FindingStatus::PreExisting => "pre_existing",
    }
}

fn diff_scope_from_str(scope: &str) -> DiffScope {
    match scope {
        "changed-files" => DiffScope::ChangedFiles,
        "full" => DiffScope::Full,
        _ => DiffScope::ChangedHunks,
    }
}

fn diff_status_to_str(status: drift_engine::DiffStatus) -> &'static str {
    match status {
        drift_engine::DiffStatus::NewInDiff => "new_in_diff",
        drift_engine::DiffStatus::TouchedExisting => "touched_existing",
        drift_engine::DiffStatus::OutsideDiff => "outside_diff",
    }
}
