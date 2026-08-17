use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::Instant,
};

use drift_engine::next_routes::next_api_route_identity;
use drift_engine::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedHelperImport,
    AcceptedRequestValidator, AcceptedSecurityHelper, AcceptedTenantHelper, AuthGuardBehavior,
    AuthorizationHelperBehavior, AuthorizationHelperKind, BaselineStatus, BaselineViolation,
    ConventionDispatch, ConventionKind, DiffFile, DiffScope, DirectDataAccessRule, EnforcementMode,
    Fact, FactKind, FindingStatus, GraphEdgeKind, GraphNodeKind, ParsedDiff, Phase4SecurityPolicy,
    Phase6AcceptedHelper, Phase6CorsContract, Phase6RawSqlContract, Phase6SecurityContract,
    Phase6SecurityProof, Phase6SsrfContract, RequestValidatorBehavior, RequestValidatorKind,
    RouteSecurityBoundaryProof, RuleFinding, ScanCapability, SecurityBoundaryProof,
    SecurityProofStatus, Severity, accepted_phase5_contract_from_requires,
    build_auth_boundary_proofs_for_file, build_phase4_security_proof_with_policy,
    build_phase6_security_proofs_for_file, classify_findings_against_diff,
    materialize_direct_data_access_findings_with_sources, phase6_proof_to_json,
    sensitive_field_source_is_trusted, sensitive_response_field_rejections,
};
use serde_json::json;

use crate::protocol::{
    CheckBaselineViolation, CheckEvidence, CheckFact, CheckFinding, CheckGraphData, CheckRequest,
    CheckResult, ENGINE_CHECK_RESULT_SCHEMA_VERSION, EngineCompleteness, GraphEdge, GraphNode,
    adapter_versions, capability_stats, engine_stats,
};

pub fn check_repo(request: CheckRequest) -> CheckResult {
    let started = Instant::now();
    let repo_root = request.repo.repo_root.clone();
    // EW-2. Two kinds of incompleteness, and only one of them is about the whole check.
    //
    // A *limit* breach (too many facts, a truncated graph, symlinks followed) compromises the
    // graph itself: nothing derived from it can be trusted, so every finding is withheld. An
    // *import-scoped* gap is about one import in one file. Whether it touches a given finding
    // is a question with an answer, and answering it per finding is the whole of this change -
    // conflating the two is how a single unfinished import came to hide every violation in a
    // diff (S1-01's kill-switch, honest but check-wide).
    let global_reasons = check_limit_reasons(&request);
    let uncertain_imports = uncertain_route_imports(&request);
    let mut completeness_reasons = global_reasons.clone();
    completeness_reasons.extend(check_graph_completeness_reasons(&request));
    completeness_reasons.sort();
    completeness_reasons.dedup();
    // The check-wide verdict still reports the honest whole-run answer: a run with any gap did
    // not see everything and must not claim it could have blocked cleanly. It no longer decides
    // enforcement on its own.
    let can_block = completeness_reasons.is_empty();
    let graph_intact = global_reasons.is_empty();
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
                is_added: file.is_added,
            })
            .collect(),
    };
    let _contract_metadata = (
        &request.contract.contract_id,
        &request.contract.contract_schema_version,
        &request.contract.waivers,
        &request.contract.exceptions,
    );

    let mut findings = Vec::new();
    let mut security_boundary_proofs = Vec::new();
    // TDD §5.1.4. An accepted convention whose config the engine cannot read, or can read and
    // then discards entirely, enforces nothing while reporting a clean pass — the exact shape of
    // the D1 P0, and the shape D1's first proposed fix would have reproduced. These say so out
    // loud instead.
    let mut config_diagnostics: Vec<crate::protocol::EngineDiagnostic> = Vec::new();
    let mut required_capabilities = BTreeSet::from([ScanCapability::DirectDataAccessCheck]);
    let mut missing_capabilities: BTreeSet<ScanCapability> = BTreeSet::new();
    let mut source_required_kinds: BTreeSet<ConventionKind> = BTreeSet::new();
    // One receipt per convention handed to this engine, pushed on every path out of the loop
    // below. Five of those paths were a bare `continue` producing an empty findings list that no
    // consumer could tell from an evaluator that ran and found nothing.
    let mut evaluation_receipts: Vec<crate::protocol::CheckEvaluationReceipt> = Vec::new();
    for convention in request.contract.conventions {
        let _convention_metadata = (
            &convention.scope,
            &convention.exceptions,
            &convention.governance,
        );
        // Resolved before the capability gate, so even a convention this engine refuses on sight
        // carries the vocabulary's verdict on where its kind belongs. `reached: false` with
        // `dispatch: "none"` is a kind nothing implements; `reached: false` with
        // `dispatch: "engine_direct"` is an implemented kind this run did not enter. Different
        // problems, different fixes, and a bare `continue` said neither.
        let dispatch_target = ConventionKind::from_wire(&convention.kind)
            .map(|kind| dispatch_wire(kind.dispatch()))
            .unwrap_or("none");
        let receipt_for = |reached: bool, inputs: usize, emitted: usize, skip: Option<&str>| {
            crate::protocol::CheckEvaluationReceipt {
                convention_id: convention.id.clone(),
                kind: convention.kind.clone(),
                dispatch: dispatch_target.to_string(),
                reached,
                inputs_considered: inputs,
                findings_emitted: emitted,
                skip_reason: skip.map(ToOwned::to_owned),
            }
        };
        if convention.enforcement_mode == "off" {
            evaluation_receipts.push(receipt_for(false, 0, 0, Some("enforcement_mode_off")));
            continue;
        }
        if convention.enforcement_capability != "deterministic_check" {
            // Every arm below requires `deterministic_check`, so a convention declaring anything
            // weaker cannot reach one whatever the repo contains: accepted, stored, structurally
            // inert. That is the shape docs/decisions/service-delegation-capability.md is about,
            // and this is where it stops being invisible.
            evaluation_receipts.push(receipt_for(
                false,
                0,
                0,
                Some("capability_not_deterministic"),
            ));
            continue;
        }
        // D-P3a: the vocabulary decides which evaluator owns this kind.
        //
        // Twenty-three kinds were dispatched by three mechanisms - a chain of `else if
        // convention.kind == "..."` here, `is_phase6_security_convention` beside it, and a separate
        // chain in packages/cli/src/check/run-check.ts - plus three the schema accepts that neither
        // implements. No single place listed all twenty-three or said where each one went, so a
        // twenty-fourth kind that named no target would have fallen off the end of this chain into
        // `continue` and produced a clean pass for a contract enforcing nothing. That listing is now
        // vocabulary/vocabulary.json, and the match below is exhaustive over the generated enum, so
        // adding a kind without giving it a target does not compile.
        let Some(kind) = ConventionKind::from_wire(&convention.kind) else {
            // Not in the vocabulary at all. The schema rejects these before they reach the engine;
            // reaching here means the two disagree, which is the parity gate's business, not a
            // finding. It is still a convention that enforced nothing, so it still gets a receipt.
            evaluation_receipts.push(receipt_for(false, 0, 0, Some("no_evaluator_for_kind")));
            continue;
        };
        if !matches!(
            kind.dispatch(),
            ConventionDispatch::EngineDirect | ConventionDispatch::EnginePhase6
        ) {
            evaluation_receipts.push(receipt_for(
                false,
                0,
                0,
                Some(match kind.dispatch() {
                    // Nothing evaluates it anywhere: accepting it enforces nothing, which is a
                    // strictly worse state than "someone else's evaluator owns it".
                    ConventionDispatch::None => "no_evaluator_for_kind",
                    _ => "not_dispatched_to_this_evaluator",
                }),
            ));
            continue;
        }
        // D-F1, the part the fact-kind drop was hiding. Every security evaluator below re-reads the
        // route file from disk (`read_repo_file`, five call sites) rather than working from the
        // facts on the wire, and each one `continue`s when the read fails. `repo_root` is
        // `Option<String>` in `CheckRepoContext`, so a caller that omits it - which the protocol
        // permits and only `engine-check.ts` happens never to do - got zero findings for all twelve
        // security kinds and a clean pass, with no diagnostic and `can_block: true`.
        //
        // Saying so is the fix available here. Rewriting the evaluators to work from facts is a
        // different change; reporting a gap Drift has instead of a pass it has not earned is this
        // project's whole premise.
        if kind.requires_engine_source()
            && repo_root.is_none()
            && !is_presence_convention(&convention)
        {
            missing_capabilities.extend(phase6_required_capabilities(kind));
            source_required_kinds.insert(kind);
            evaluation_receipts.push(receipt_for(false, 0, 0, Some("engine_source_unavailable")));
            continue;
        }
        // Facts in scope for this convention, counted before the arms run so that an evaluator
        // that produced nothing is still distinguishable from one that was handed nothing. The
        // caller has already scoped `facts` to this convention's file set.
        let inputs_considered = facts.len();
        let severity = severity_from_str(&convention.severity);
        let enforcement_mode = enforcement_mode_from_str(&convention.enforcement_mode);
        let mut rule_findings = match kind {
            ConventionKind::ApiRouteNoDirectDataAccess => {
                let rule = DirectDataAccessRule {
                    convention_id: convention.id.clone(),
                    forbidden_imports: convention.matcher.forbidden_imports.unwrap_or_default(),
                    forbidden_module_files: convention
                        .matcher
                        .forbidden_module_files
                        .unwrap_or_default(),
                    severity,
                    enforcement_mode,
                };
                // D5.2 (TDD §5.5) classifies each specifier's use over the importing file's AST,
                // because the fact stream cannot answer the question. `new PrismaClient()` emits no
                // fact at all - `walk_node` dispatches on `call_expression`, and a `new_expression`
                // is not one - and a member READ (`LinkType.GROUP`) emits no fact either. To a
                // classifier reading facts alone those two are the same nothing, so suppressing on
                // "no facts" would silently drop the one genuine violation shape §5.5 names.
                // Reading the source at check time is how five security rules in this file already
                // resolve questions the fact stream does not carry; `read_repo_file` is the same
                // door.
                //
                // No `repo_root` means no source, which means every specifier is Unresolved and
                // every finding is retained - D5.1 grouping only, and no suppression on a path that
                // cannot prove inertness.
                let mut findings = materialize_direct_data_access_findings_with_sources(
                    &facts,
                    &rule,
                    &|file_path| read_repo_file(repo_root.as_deref(), file_path),
                )
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
                    symbol: PendingFinding::no_symbol(),
                    legacy_fingerprints: finding.legacy_fingerprints,
                    related_node_ids: Vec::new(),
                })
                .collect::<Vec<_>>();
                findings.extend(graph_direct_data_access_findings(&request.graph, &rule));
                findings
            }
            ConventionKind::ApiRouteRequiresServiceDelegation => {
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
            }
            // CV-3 (option B): presence-only enforcement, beside the proof path rather than
            // replacing it. Selected by the MATCHER rather than the kind, so it is a guard arm and
            // stays where it was in the old chain - after the two layering kinds, before every
            // security kind it can apply to.
            _ if is_presence_convention(&convention) => {
                // CV-3 (option B): presence-only enforcement, beside the proof path rather than replacing
                // it.
                //
                // The capability list says what this actually does. It does NOT claim
                // `control_flow_guard_dominance`, because it does not compute it - that is the whole
                // difference between this path and the one below, and the reason this one can leave
                // quarantine while that one cannot.
                required_capabilities.extend([
                    ScanCapability::SyntaxFacts,
                    ScanCapability::ImportResolution,
                ]);
                presence_findings(
                    &facts,
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                )
            }
            ConventionKind::ApiRouteRequiresAuthHelper => {
                required_capabilities.extend([
                    ScanCapability::SecurityFacts,
                    ScanCapability::AuthBoundaryFacts,
                    ScanCapability::ControlFlowGuardDominance,
                ]);
                let auth_result = security_auth_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(auth_result.proofs);
                auth_result.findings
            }
            ConventionKind::ApiRouteRequiresRequestValidation => {
                required_capabilities.extend([
                    ScanCapability::SecurityFacts,
                    ScanCapability::RequestValidationFacts,
                ]);
                let validation_result = security_request_validation_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(validation_result.proofs);
                validation_result.findings
            }
            ConventionKind::ApiRouteForbidsUntrustedSsrf
            | ConventionKind::ApiRouteForbidsRawSqlWithoutParams
            | ConventionKind::ApiRouteCorsMustMatchPolicy
            | ConventionKind::ApiRouteRequiresCsrfForMutation
            | ConventionKind::ApiRouteRequiresRateLimit => {
                required_capabilities.extend(phase6_required_capabilities(kind));
                let phase6_result = security_phase6_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(phase6_result.proofs);
                phase6_result.findings
            }
            ConventionKind::ApiRouteForbidsSensitiveResponseFields => {
                config_diagnostics.extend(sensitive_response_field_config_diagnostics(
                    &convention.id,
                    convention.requires.as_ref(),
                ));
                let has_phase5_inputs = convention
                    .requires
                    .as_ref()
                    .and_then(accepted_phase5_contract_from_requires)
                    .is_some_and(|accepted| {
                        !accepted.sensitive_response_fields.is_empty()
                            || !accepted.response_serializers.is_empty()
                    });
                if has_phase5_inputs {
                    required_capabilities.extend([
                        ScanCapability::SecurityFacts,
                        ScanCapability::ResponseShapeFacts,
                    ]);
                }
                let phase5_result = security_phase5_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(phase5_result.proofs);
                phase5_result.findings
            }
            ConventionKind::ApiRouteForbidsSecretExposure => {
                let has_phase5_inputs = convention
                    .requires
                    .as_ref()
                    .and_then(accepted_phase5_contract_from_requires)
                    .is_some_and(|accepted| {
                        !accepted.secret_sources.is_empty() || !accepted.log_sinks.is_empty()
                    });
                if has_phase5_inputs {
                    required_capabilities.extend([
                        ScanCapability::SecurityFacts,
                        ScanCapability::SecretExposure,
                    ]);
                }
                let phase5_result = security_phase5_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(phase5_result.proofs);
                phase5_result.findings
            }
            ConventionKind::ApiRouteRequiresTenantScope
            | ConventionKind::ApiRouteRequiresAuthorization
            | ConventionKind::SessionObjectMustComeFromTrustedHelper => {
                required_capabilities.extend([
                    ScanCapability::SecurityFacts,
                    ScanCapability::SessionTrust,
                    ScanCapability::Authorization,
                    ScanCapability::TenantScope,
                ]);
                let phase4_result = security_phase4_findings_and_proofs(
                    &facts,
                    repo_root.as_deref(),
                    &parsed_diff,
                    diff_scope,
                    &convention,
                    severity,
                    enforcement_mode,
                );
                security_boundary_proofs.extend(phase4_result.proofs);
                phase4_result.findings
            }
            // Evaluated elsewhere, or by nobody. `dispatch()` above already skipped every one of
            // these, so this arm exists to make the match exhaustive: a kind added to the
            // vocabulary must be named here, which is the compile error D-P3a is for.
            //
            // Unreachable in practice and still receipted. If the dispatch guard above and this
            // arm ever disagree - a kind whose manifest says `engine_direct` while its arm lands
            // here - the run must say so rather than fall through to a silent clean pass, which is
            // the failure mode the whole exhaustive-match design exists to prevent. A receipt is
            // the only thing standing between a bare `continue` and that pass.
            ConventionKind::MiddlewareMustCoverRoutes
            | ConventionKind::TestExpectedForChangedModule
            | ConventionKind::CustomBriefing
            | ConventionKind::FileRole
            | ConventionKind::ModulePlacement
            | ConventionKind::ImportBoundary
            | ConventionKind::EntrypointFlow
            | ConventionKind::CanonicalHelperReuse
            | ConventionKind::RequiredChangeChecks => {
                evaluation_receipts.push(receipt_for(
                    false,
                    inputs_considered,
                    0,
                    Some("not_dispatched_to_this_evaluator"),
                ));
                continue;
            }
        };
        dedupe_pending_findings(&mut rule_findings);
        // The convention was evaluated. Counted after dedupe and before the diff classification
        // below, so `findings_emitted` is what the RULE produced rather than what survived scope
        // filtering - a rule that fired and was then filtered by `--scope` did run, and a receipt
        // reporting 0 for it would answer the wrong question.
        evaluation_receipts.push(receipt_for(
            true,
            inputs_considered,
            rule_findings.len(),
            None,
        ));
        let pending_by_fingerprint = rule_findings
            .iter()
            .map(|finding| (finding.fingerprint.clone(), finding.clone()))
            .collect::<BTreeMap<_, _>>();
        let statuses_by_fingerprint =
            classify_pending_findings_against_baseline(&rule_findings, &baseline);
        let diff_classified = classify_findings_against_diff(
            rule_findings.into_iter().map(RuleFinding::from).collect(),
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
                // EW-2: withheld iff the graph is compromised outright, or the uncertainty
                // is in *this* finding's own dependency chain. Uncertainty about the evidence
                // and uncertainty elsewhere in the file are different things.
                enforcement_result: if graph_intact
                    && !uncertain_imports.covers(
                        &finding.file_path,
                        &finding.import_source,
                        IMPORT_SCOPED_RULE_IDS.contains(
                            &pending_by_fingerprint
                                .get(&finding.fingerprint)
                                .map(|pending| pending.rule_id.as_str())
                                .unwrap_or(""),
                        ),
                    ) {
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
                    // T-03: carried from the producer, so the CLI can store it on the evidence ref.
                    symbol: pending_by_fingerprint
                        .get(&finding.fingerprint)
                        .and_then(|pending| pending.symbol.clone()),
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
    required_capabilities.extend(missing_capabilities.iter().copied());
    let required_capabilities_vec = required_capabilities.into_iter().collect::<Vec<_>>();
    let missing_capabilities_vec = missing_capabilities.into_iter().collect::<Vec<_>>();
    if !source_required_kinds.is_empty() {
        completeness_reasons.push(format!(
            "repo_root_missing: {} security convention(s) ({}) could not be evaluated because their \
             evaluator reads the route source from disk and no repo_root was supplied",
            source_required_kinds.len(),
            source_required_kinds
                .iter()
                .map(|kind| kind.as_wire())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let can_block = can_block && source_required_kinds.is_empty();
    stats.truncated = !can_block;
    stats.capabilities = capability_stats(&required_capabilities_vec, &missing_capabilities_vec);
    let diagnostics = completeness_reasons
        .iter()
        .take(request.limits.max_diagnostics)
        .map(|reason| crate::protocol::EngineDiagnostic {
            severity: "warning".to_string(),
            // The reasons list carries two unrelated causes now, and one code for both would tell a
            // reader that a missing repo_root is a limit breach. It is not - it is a request that
            // could not be answered.
            code: if reason.starts_with("repo_root_missing:") {
                "check_source_unavailable".to_string()
            } else {
                "check_limits_exceeded".to_string()
            },
            message: reason.clone(),
            file_path: None,
            import_source: None,
        })
        .chain(config_diagnostics)
        .take(request.limits.max_diagnostics)
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
        security_boundary_proofs,
        evaluation_receipts,
        diagnostics,
        completeness: vec![EngineCompleteness {
            scope: "repo".to_string(),
            complete: can_block,
            required_capabilities: required_capabilities_vec
                .iter()
                .map(|capability| capability.as_wire().to_string())
                .collect(),
            missing_capabilities: missing_capabilities_vec
                .iter()
                .map(|capability| capability.as_wire().to_string())
                .collect(),
            truncated: !can_block,
            can_block,
            // EW-2: the graph is sound unless a *limit* was breached. Import-scoped gaps are
            // recorded in `reasons` and handled per finding above.
            graph_intact,
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

/// What Drift could not resolve, split by how precisely it can be attributed.
///
/// `by_import` holds `(file, specifier)` pairs. A direct-data-access finding rests on exactly one
/// claim - the specifier this route imported reaches the forbidden module - so its chain is
/// uncertain precisely when a diagnostic names the same file *and* the same specifier. Not when
/// some other import in that file is unresolved, and not when a different file has a gap.
///
/// `whole_file` holds files carrying an import-scoped diagnostic that names no specifier. Such a
/// diagnostic cannot be shown to be outside any finding's chain, so it is treated as covering
/// every finding in that file. Dropping these instead would be the unsafe direction: it would
/// silently widen enforcement on exactly the payloads Drift understands least. In practice all
/// three codes now carry a specifier, so this is the path for older or hand-built payloads.
///
/// Both are restricted to API-route files, matching `check_graph_completeness_reasons`: a gap in a
/// non-route file already stops the resolver building the edge a finding would need, so no finding
/// exists on the strength of one.
struct UncertainImports {
    by_import: BTreeSet<(String, String)>,
    whole_file: BTreeSet<String>,
}

impl UncertainImports {
    /// Whether this finding's own evidence is what Drift could not establish.
    ///
    /// `precise` is false for findings whose `import_source` is not an import specifier at all -
    /// the security rules put a proof code there. Those get the file-level answer, because
    /// matching a proof code against import specifiers would never hit and would quietly promote
    /// them past a coverage gap they were previously held back by.
    fn covers(&self, file_path: &str, import_source: &str, precise: bool) -> bool {
        if self.whole_file.contains(file_path) {
            return true;
        }
        if !precise {
            // No import-scoped diagnostic on this file at all means nothing to be uncertain
            // about; one that names a *different* specifier still cannot be reasoned about for a
            // non-import finding, so it withholds.
            return self
                .by_import
                .iter()
                .any(|(diagnostic_file, _)| diagnostic_file == file_path);
        }
        self.by_import
            .contains(&(file_path.to_string(), import_source.to_string()))
    }
}

/// Rules whose `import_source` is a real import specifier, and so can be matched against a
/// diagnostic's specifier. Everything else falls back to the file-level answer.
const IMPORT_SCOPED_RULE_IDS: [&str; 2] = [
    "api_route_no_direct_data_access",
    "api_route_requires_service_delegation",
];

fn uncertain_route_imports(request: &CheckRequest) -> UncertainImports {
    let nodes_by_id = request
        .graph
        .graph_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let api_route_files = api_route_files(&request.graph.graph_edges, &nodes_by_id);
    let mut uncertain = UncertainImports {
        by_import: BTreeSet::new(),
        whole_file: BTreeSet::new(),
    };
    for diagnostic in &request.graph.graph_diagnostics {
        if !matches!(
            diagnostic.code.as_str(),
            "unresolved_import"
                | "unresolved_import_symbol"
                | "unsupported_namespace_import_symbol"
        ) {
            continue;
        }
        let Some(file_path) = diagnostic.file_path.as_deref() else {
            continue;
        };
        if !api_route_files.contains(file_path) {
            continue;
        }
        match diagnostic.import_source.as_deref() {
            Some(import_source) => {
                uncertain
                    .by_import
                    .insert((file_path.to_string(), import_source.to_string()));
            }
            None => {
                uncertain.whole_file.insert(file_path.to_string());
            }
        }
    }
    uncertain
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
                "unresolved_import"
                    | "unresolved_import_symbol"
                    | "unsupported_namespace_import_symbol"
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
    /// T-03: the symbol the finding is about, carried through to the evidence the CLI stores.
    ///
    /// `None` where the finding is about a file rather than a symbol within it. Defaulted for
    /// every producer that has no symbol to name, so adding it did not require inventing one.
    symbol: Option<String>,
    legacy_fingerprints: Vec<String>,
    related_node_ids: Vec<String>,
}

impl PendingFinding {
    /// The symbol slot, empty. Producers that name a symbol set it explicitly.
    fn no_symbol() -> Option<String> {
        None
    }
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
            import_names: vec![value.import_name.clone()],
            import_name: value.import_name,
            import_source: value.import_source,
            line: value.line,
            legacy_fingerprints: value.legacy_fingerprints,
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
        .filter(|node| node.kind == GraphNodeKind::Module)
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
        .filter(|edge| edge.kind == GraphEdgeKind::ImportDeclReferencesModule)
        .map(|edge| (edge.from.as_str(), edge.to.as_str()))
        .collect::<BTreeMap<_, _>>();
    let resolved_import_edges = graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == GraphEdgeKind::ImportResolvesToModule)
        .collect::<Vec<_>>();
    let evidence_lines = graph
        .graph_evidence
        .iter()
        .map(|evidence| (evidence.id.as_str(), evidence.start_line))
        .collect::<BTreeMap<_, _>>();

    // T100: the file identities the forbidden specifiers actually name.
    //
    // A convention's `forbidden_imports` holds specifiers - `@/lib/prisma`, `@calcom/prisma` - so
    // matching by string missed every other spelling of the same module. `../../../lib/prisma`
    // resolved to the identical file and passed; a barrel re-exporting the client passed. Both
    // were confirmed bypasses (T93): a real violation reported as a clean check.
    //
    // The repository resolves this for us. Wherever some file imports a forbidden specifier and
    // the resolver placed that edge, the edge target is the file the specifier means. Collecting
    // those targets turns specifier matching into identity matching without a second resolver.
    //
    // Derived rather than assumed, which is what makes it safe in both directions. If nothing
    // imports a forbidden specifier resolvably the set is empty and behaviour is exactly as
    // before. And because entries arrive only through real resolution, a lookalike module
    // (`@/lib/prisma-legacy`) resolves to its own distinct file and never lands here - which is
    // what keeps the T03 negative control green.
    let supplied_forbidden_files = rule.forbidden_module_files.clone();
    let mut forbidden_module_paths = supplied_forbidden_files
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<&str>>();
    // Local derivation still runs, for whole-repo checks where the graph is not scoped.
    let derived = resolved_import_edges
        .iter()
        .filter_map(|edge| {
            let import_node = nodes_by_id.get(edge.from.as_str())?;
            let source = string_metadata(import_node, "source")?;
            if !is_forbidden_import_source(source, &rule.forbidden_imports) {
                return None;
            }
            module_files.get(edge.to.as_str()).copied()
        })
        .collect::<BTreeSet<&str>>();
    forbidden_module_paths.extend(derived);

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
                &forbidden_module_paths,
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
                    &stable_hash(&format!("{}:{}", file_path, import_source))[..16]
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
        let legacy_fingerprints = vec![legacy_direct_data_access_fingerprint(
            &rule.convention_id,
            file_path.as_str(),
            import_name,
            import_source,
        )];
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
            // Left unset deliberately. Data-access findings already carry a symbol by another
            // route, and this path is per FILE import rather than per handler - T-03 is scoped to
            // the presence kinds, whose symbol was missing entirely.
            symbol: PendingFinding::no_symbol(),
            legacy_fingerprints,
            related_node_ids,
        });
    }
    findings
}

struct SecurityAuthEvaluation {
    findings: Vec<PendingFinding>,
    proofs: Vec<serde_json::Value>,
}

struct SecurityRequestValidationEvaluation {
    findings: Vec<PendingFinding>,
    proofs: Vec<serde_json::Value>,
}

struct SecurityPhase4Evaluation {
    findings: Vec<PendingFinding>,
    proofs: Vec<serde_json::Value>,
}

struct SecurityPhase5Evaluation {
    findings: Vec<PendingFinding>,
    proofs: Vec<serde_json::Value>,
}

struct SecurityPhase6Evaluation {
    findings: Vec<PendingFinding>,
    proofs: Vec<serde_json::Value>,
}

fn security_auth_findings_and_proofs(
    facts: &[Fact],
    repo_root: Option<&str>,
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> SecurityAuthEvaluation {
    let accepted_auth_helpers = accepted_auth_helpers_for_convention(convention);
    if accepted_auth_helpers.is_empty() {
        return SecurityAuthEvaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }
    if convention
        .matcher
        .applies_to_file_roles
        .as_ref()
        .is_some_and(|roles| !roles.iter().any(|role| role == "api_route"))
    {
        return SecurityAuthEvaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }
    let files = security_auth_files(facts, parsed_diff, diff_scope);
    let mut findings = Vec::new();
    let mut proofs = Vec::new();

    for file_path in files {
        let Some(source) = read_repo_file(repo_root, &file_path) else {
            continue;
        };
        let route_proofs = match build_auth_boundary_proofs_for_file(
            &file_path,
            &source,
            &accepted_auth_helpers,
        ) {
            Ok(route_proofs) => route_proofs,
            Err(_) => continue,
        };

        for route_proof in route_proofs {
            let sink_line = first_sink_line_for_route(facts, &file_path, &route_proof).unwrap_or(1);
            let missing_code = route_proof
                .missing_proof_codes
                .first()
                .cloned()
                .unwrap_or_else(|| "missing_auth_guard".to_string());
            // T-06: the line is NOT part of the identity. Measured end to end: inserting one
            // comment line above an unchanged handler moved it from line 3 to line 4, changed the
            // fingerprint, and turned a grandfathered violation back into a new one - 13
            // pre_existing became 12 pre_existing and 1 new, with no change to the handler itself.
            //
            // The line-bearing value is emitted as a legacy fingerprint so a baseline written by an
            // older version still matches. That covers every file whose lines have not moved since
            // it was baselined, which is the case a stored baseline is in by definition unless the
            // file was edited first.
            let finding_fingerprint = stable_hash(&format!(
                "{}:{}:{}",
                convention.id, route_proof.route_id, missing_code
            ));
            let legacy_fingerprints = vec![stable_hash(&format!(
                "{}:{}:{}:{}",
                convention.id, route_proof.route_id, missing_code, sink_line
            ))];
            let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
            proofs.push(route_security_proof_json(
                &route_proof,
                convention,
                &finding_id,
            ));
            if route_proof.result.proof_status != SecurityProofStatus::Proven {
                findings.push(PendingFinding {
                    fingerprint: finding_fingerprint,
                    convention_id: convention.id.clone(),
                    rule_id: "api_route_requires_auth_helper".to_string(),
                    title: "API route missing required auth proof".to_string(),
                    message: "Accepted auth helper must dominate protected route sinks."
                        .to_string(),
                    severity,
                    enforcement_result: enforcement_result_for_mode(enforcement_mode),
                    file_path: file_path.clone(),
                    import_name: "auth_guard".to_string(),
                    import_source: missing_code,
                    line: sink_line,
                    evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
                    symbol: PendingFinding::no_symbol(),
                    legacy_fingerprints,
                    related_node_ids: Vec::new(),
                });
            }
        }
    }

    SecurityAuthEvaluation { findings, proofs }
}

fn security_request_validation_findings_and_proofs(
    facts: &[Fact],
    repo_root: Option<&str>,
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> SecurityRequestValidationEvaluation {
    let accepted_validators = accepted_request_validators_for_convention(convention);
    if accepted_validators.is_empty() {
        return SecurityRequestValidationEvaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }
    let proof_scope = request_validation_proof_scope_for_convention(convention);
    let allowed_methods = convention
        .matcher
        .methods
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|method| method.to_uppercase())
        .collect::<Vec<_>>();
    if convention
        .matcher
        .applies_to_file_roles
        .as_ref()
        .is_some_and(|roles| !roles.iter().any(|role| role == "api_route"))
    {
        return SecurityRequestValidationEvaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }

    let files = security_auth_files(facts, parsed_diff, diff_scope);
    let mut findings = Vec::new();
    let mut proofs = Vec::new();

    for file_path in files {
        if !allowed_methods.is_empty()
            && !route_methods_for_file(facts, &file_path)
                .iter()
                .any(|method| allowed_methods.contains(method))
        {
            continue;
        }
        let Some(source) = read_repo_file(repo_root, &file_path) else {
            continue;
        };
        let proof = match drift_engine::build_request_validation_proof_with_scope(
            &file_path,
            &source,
            &accepted_validators,
            &proof_scope,
        ) {
            Ok(proof) => proof,
            Err(_) => continue,
        };
        if !proof.request_validation.required {
            continue;
        }
        let (route_id, handler_symbol) = route_identity_for_file(facts, &file_path)
            .unwrap_or_else(|| (format!("route:{file_path}:unknown"), "unknown".to_string()));
        let missing_code = request_validation_missing_code(&proof);
        let finding_line = request_validation_finding_line(&proof).unwrap_or(1);
        // T-06: identity excludes the line; the line-bearing value stays as a legacy fingerprint
        // so baselines written before this change still match. See the auth-proof site above.
        let finding_fingerprint =
            stable_hash(&format!("{}:{}:{}", convention.id, route_id, missing_code));
        let legacy_fingerprints = vec![stable_hash(&format!(
            "{}:{}:{}:{}",
            convention.id, route_id, missing_code, finding_line
        ))];
        let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
        proofs.push(request_validation_proof_json(
            &proof,
            &route_id,
            &file_path,
            &handler_symbol,
            convention,
            &finding_id,
        ));
        if proof.result.proof_status != SecurityProofStatus::Proven {
            findings.push(PendingFinding {
                fingerprint: finding_fingerprint,
                convention_id: convention.id.clone(),
                rule_id: "api_route_requires_request_validation".to_string(),
                title: "API route uses unvalidated request input".to_string(),
                message: "Accepted request validation must produce the value used by protected route sinks."
                    .to_string(),
                severity,
                enforcement_result: enforcement_result_for_mode(enforcement_mode),
                file_path: file_path.clone(),
                import_name: "request_validation".to_string(),
                import_source: missing_code,
                line: finding_line,
                evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
                symbol: PendingFinding::no_symbol(),
                legacy_fingerprints,
                related_node_ids: Vec::new(),
            });
        }
    }

    SecurityRequestValidationEvaluation { findings, proofs }
}

fn security_phase6_findings_and_proofs(
    facts: &[Fact],
    repo_root: Option<&str>,
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> SecurityPhase6Evaluation {
    let Some(contract) = phase6_contract_for_convention(convention) else {
        return SecurityPhase6Evaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    };
    if convention
        .matcher
        .applies_to_file_roles
        .as_ref()
        .or(convention.matcher.file_roles.as_ref())
        .is_some_and(|roles| !roles.iter().any(|role| role == "api_route"))
    {
        return SecurityPhase6Evaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }

    let allowed_methods = convention
        .matcher
        .methods
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|method| method.to_uppercase())
        .collect::<Vec<_>>();
    let route_paths = phase6_route_paths(convention, &contract);
    let files = security_auth_files(facts, parsed_diff, diff_scope);
    let mut findings = Vec::new();
    let mut proofs = Vec::new();

    // The scope narrowing phase6 applies. Absent or empty means "no narrowing", which is the
    // semantics `path_matches_globs` carried on the `Option`; keeping it here means the field
    // being absent (which is what every proposer-emitted convention looks like — the proposer
    // writes its globs to `scope`, never to `matcher`) still evaluates every api-route file.
    let path_globs = convention
        .matcher
        .path_globs
        .as_deref()
        .unwrap_or_default()
        .to_vec();

    for file_path in files {
        // Was `path_matches_globs`, a prefix/equality shim that could not express `**/`. Phase4
        // (`security_phase4_findings_and_proofs`) and phase5 (`phase5_file_scope_matches`) both
        // narrow with `path_glob_matches`; phase6 was the last caller of the shim, so a
        // `**/`-prefixed scope — the only shape the candidate proposer emits — reduced to an
        // exact-string comparison here and excluded every file.
        if !path_globs.is_empty()
            && !path_globs
                .iter()
                .any(|pattern| path_glob_matches(pattern, &file_path))
        {
            continue;
        }
        if !route_paths.is_empty() {
            let route_path = route_path_from_file(&file_path);
            if route_path.is_none_or(|route_path| !route_paths.contains(&route_path)) {
                continue;
            }
        }
        if !allowed_methods.is_empty()
            && !route_methods_for_file(facts, &file_path)
                .iter()
                .any(|method| allowed_methods.contains(method))
        {
            continue;
        }
        let Some(source) = read_repo_file(repo_root, &file_path) else {
            continue;
        };
        let route_proofs =
            match build_phase6_security_proofs_for_file(&file_path, &source, &contract) {
                Ok(route_proofs) => route_proofs,
                Err(_) => continue,
            };
        for proof in route_proofs {
            if !allowed_methods.is_empty() && !allowed_methods.contains(&proof.handler_symbol) {
                continue;
            }
            if !phase6_proof_required_for_contract(&proof, &convention.kind) {
                continue;
            }
            let missing_code = phase6_missing_code(&proof, &convention.kind);
            let finding_line = phase6_finding_line(&proof);
            // T-06: identity excludes the line; the line-bearing value stays as a legacy
            // fingerprint so baselines written before this change still match. See the auth-proof
            // site above for the measurement that motivated this.
            let finding_fingerprint = stable_hash(&format!(
                "{}:{}:{}",
                convention.id, proof.route_id, missing_code
            ));
            let legacy_fingerprints = vec![stable_hash(&format!(
                "{}:{}:{}:{}",
                convention.id, proof.route_id, missing_code, finding_line
            ))];
            let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
            proofs.push(phase6_proof_to_json(
                &proof,
                &convention.kind,
                &convention.id,
                &convention.enforcement_mode,
                (proof.result.proof_status != SecurityProofStatus::Proven)
                    .then_some(finding_id.as_str()),
            ));
            if proof.result.proof_status != SecurityProofStatus::Proven {
                let (title, message, expected_layer) = phase6_finding_text(&convention.kind);
                findings.push(PendingFinding {
                    fingerprint: finding_fingerprint,
                    convention_id: convention.id.clone(),
                    rule_id: convention.kind.clone(),
                    title: title.to_string(),
                    message: message.to_string(),
                    severity,
                    enforcement_result: enforcement_result_for_mode(enforcement_mode),
                    file_path: proof.file_path.clone(),
                    import_name: expected_layer.to_string(),
                    import_source: missing_code,
                    line: finding_line,
                    evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
                    symbol: PendingFinding::no_symbol(),
                    legacy_fingerprints,
                    related_node_ids: Vec::new(),
                });
            }
        }
    }

    SecurityPhase6Evaluation { findings, proofs }
}

/// The security capability each Phase 6 kind requires, from the one capability vocabulary.
///
/// `is_phase6_security_convention` used to sit beside this, listing the same five kinds a second
/// time. The dispatch table in vocabulary/vocabulary.json says which kinds are Phase 6, and the
/// match in `check_repo` is what routes them here, so the predicate had nothing left to decide.
fn phase6_required_capabilities(kind: ConventionKind) -> Vec<ScanCapability> {
    let capability = match kind {
        ConventionKind::ApiRouteForbidsUntrustedSsrf => ScanCapability::OutboundRequestFacts,
        ConventionKind::ApiRouteForbidsRawSqlWithoutParams => ScanCapability::RawSqlFacts,
        ConventionKind::ApiRouteCorsMustMatchPolicy => ScanCapability::CorsPolicyFacts,
        ConventionKind::ApiRouteRequiresCsrfForMutation => ScanCapability::CsrfFacts,
        ConventionKind::ApiRouteRequiresRateLimit => ScanCapability::RateLimitFacts,
        // Not a Phase 6 kind. Reachable only if the dispatch table and the match in `check_repo`
        // disagree, which the parity gate fails on.
        _ => ScanCapability::SecurityFacts,
    };
    vec![ScanCapability::SecurityFacts, capability]
}

fn phase6_contract_for_convention(
    convention: &crate::protocol::CheckConvention,
) -> Option<Phase6SecurityContract> {
    match convention.kind.as_str() {
        "api_route_forbids_untrusted_ssrf" => {
            Some(Phase6SecurityContract::Ssrf(Phase6SsrfContract {
                contract_id: convention.id.clone(),
                accepted_allowlist_helpers: phase6_helpers_from_requires(
                    convention,
                    "outbound_url_allowlist_helpers",
                ),
            }))
        }
        "api_route_forbids_raw_sql_without_params" => {
            Some(Phase6SecurityContract::RawSql(Phase6RawSqlContract {
                contract_id: convention.id.clone(),
            }))
        }
        "api_route_cors_must_match_policy" => {
            Some(Phase6SecurityContract::Cors(Phase6CorsContract {
                contract_id: convention.id.clone(),
                allowed_origins: string_array_from_requires(convention, "allowed_origins")
                    .or_else(|| {
                        convention
                            .requires
                            .as_ref()
                            .and_then(|requires| requires.get("cors"))
                            .and_then(|cors| cors.get("allowed_origins"))
                            .and_then(json_string_array)
                    })
                    .unwrap_or_default(),
                allow_credentials: bool_from_requires(convention, "allow_credentials")
                    .or_else(|| {
                        convention
                            .requires
                            .as_ref()
                            .and_then(|requires| requires.get("cors"))
                            .and_then(|cors| cors.get("allow_credentials"))
                            .and_then(|value| value.as_bool())
                    })
                    .unwrap_or(false),
            }))
        }
        "api_route_requires_csrf_for_mutation" => Some(Phase6SecurityContract::Csrf {
            contract_id: convention.id.clone(),
            accepted_helpers: security_helpers_from_requires(convention, "csrf_helpers"),
        }),
        "api_route_requires_rate_limit" => Some(Phase6SecurityContract::RateLimit {
            contract_id: convention.id.clone(),
            accepted_helpers: security_helpers_from_requires(convention, "rate_limit_helpers"),
            route_paths: phase6_route_paths_from_convention(convention),
        }),
        _ => None,
    }
}

fn phase6_helpers_from_requires(
    convention: &crate::protocol::CheckConvention,
    key: &str,
) -> Vec<Phase6AcceptedHelper> {
    convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get(key))
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|helper| {
            Some(Phase6AcceptedHelper {
                helper_id: helper.get("helper_id")?.as_str()?.to_string(),
                module: helper.get("module")?.as_str()?.to_string(),
                symbol: helper.get("symbol")?.as_str()?.to_string(),
            })
        })
        .collect()
}

fn security_helpers_from_requires(
    convention: &crate::protocol::CheckConvention,
    key: &str,
) -> Vec<AcceptedSecurityHelper> {
    convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get(key))
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|helper| {
            Some(AcceptedSecurityHelper {
                helper_id: helper.get("helper_id")?.as_str()?.to_string(),
                module: helper.get("module")?.as_str()?.to_string(),
                symbol: helper.get("symbol")?.as_str()?.to_string(),
            })
        })
        .collect()
}

fn string_array_from_requires(
    convention: &crate::protocol::CheckConvention,
    key: &str,
) -> Option<Vec<String>> {
    convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get(key))
        .and_then(json_string_array)
}

fn bool_from_requires(convention: &crate::protocol::CheckConvention, key: &str) -> Option<bool> {
    convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get(key))
        .and_then(|value| value.as_bool())
}

fn json_string_array(value: &serde_json::Value) -> Option<Vec<String>> {
    value.as_array().map(|values| {
        values
            .iter()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect()
    })
}

fn phase6_route_paths(
    convention: &crate::protocol::CheckConvention,
    contract: &Phase6SecurityContract,
) -> Vec<String> {
    match contract {
        Phase6SecurityContract::RateLimit { route_paths, .. } if !route_paths.is_empty() => {
            route_paths.clone()
        }
        _ => phase6_route_paths_from_convention(convention),
    }
}

fn phase6_route_paths_from_convention(
    convention: &crate::protocol::CheckConvention,
) -> Vec<String> {
    convention
        .matcher
        .route_paths
        .clone()
        .or_else(|| {
            convention
                .requires
                .as_ref()
                .and_then(|requires| requires.get("route_paths"))
                .and_then(json_string_array)
        })
        .unwrap_or_default()
}

fn phase6_proof_required_for_contract(proof: &Phase6SecurityProof, kind: &str) -> bool {
    match kind {
        "api_route_forbids_untrusted_ssrf" => proof.ssrf.required,
        "api_route_forbids_raw_sql_without_params" => proof.raw_sql.required,
        "api_route_cors_must_match_policy" => proof.cors.required,
        "api_route_requires_csrf_for_mutation" => proof.csrf.required,
        "api_route_requires_rate_limit" => proof.rate_limit.required,
        _ => false,
    }
}

fn phase6_missing_code(proof: &Phase6SecurityProof, kind: &str) -> String {
    let missing = match kind {
        "api_route_forbids_untrusted_ssrf" => &proof.ssrf.missing_proof,
        "api_route_forbids_raw_sql_without_params" => &proof.raw_sql.missing_proof,
        "api_route_cors_must_match_policy" => &proof.cors.missing_proof,
        "api_route_requires_csrf_for_mutation" => &proof.csrf.missing_proof,
        "api_route_requires_rate_limit" => &proof.rate_limit.missing_proof,
        _ => &proof.ssrf.missing_proof,
    };
    proof
        .parser_gaps
        .first()
        .map(|gap| gap.code.clone())
        .or_else(|| missing.first().map(|missing| missing.code.clone()))
        .unwrap_or_else(|| "missing_phase6_proof".to_string())
}

fn phase6_finding_line(proof: &Phase6SecurityProof) -> usize {
    proof
        .ssrf
        .outbound_requests
        .first()
        .map(|request| request.start_line)
        .or_else(|| {
            proof
                .raw_sql
                .raw_sql_calls
                .first()
                .map(|call| call.start_line)
        })
        .or_else(|| proof.cors.policies.first().map(|policy| policy.start_line))
        .or_else(|| proof.csrf.guard_calls.first().map(|guard| guard.start_line))
        .or_else(|| {
            proof
                .rate_limit
                .guard_calls
                .first()
                .map(|guard| guard.start_line)
        })
        .unwrap_or(1)
}

fn phase6_finding_text(kind: &str) -> (&'static str, &'static str, &'static str) {
    match kind {
        "api_route_forbids_untrusted_ssrf" => (
            "API route allows request-controlled outbound URL",
            "Request-controlled URL reaches outbound request without accepted allowlist proof.",
            "outbound_request",
        ),
        "api_route_forbids_raw_sql_without_params" => (
            "API route uses raw SQL without parameterization",
            "Raw SQL sink uses untrusted input without parameterization proof.",
            "raw_sql",
        ),
        "api_route_cors_must_match_policy" => (
            "CORS policy violates accepted contract",
            "CORS policy must match accepted static origin and credential policy.",
            "cors_policy",
        ),
        "api_route_requires_csrf_for_mutation" => (
            "Mutation route missing CSRF proof",
            "Mutation route lacks accepted CSRF guard or middleware proof.",
            "csrf_guard",
        ),
        "api_route_requires_rate_limit" => (
            "Route missing rate limit proof",
            "Matched route lacks accepted rate-limit guard or middleware proof.",
            "rate_limit_guard",
        ),
        _ => (
            "Security proof missing",
            "Security proof is missing.",
            "security",
        ),
    }
}

fn route_path_from_file(file_path: &str) -> Option<String> {
    next_api_route_identity(file_path).map(|identity| identity.route_path)
}

fn security_phase4_findings_and_proofs(
    facts: &[Fact],
    repo_root: Option<&str>,
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> SecurityPhase4Evaluation {
    let phase4_policy = phase4_policy_for_convention(convention);
    if convention
        .matcher
        .applies_to_file_roles
        .as_ref()
        .is_some_and(|roles| !roles.iter().any(|role| role == "api_route"))
    {
        return SecurityPhase4Evaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }
    let files = security_auth_files(facts, parsed_diff, diff_scope);
    let allowed_methods = convention
        .matcher
        .methods
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|method| method.to_uppercase())
        .collect::<Vec<_>>();
    let path_globs = convention
        .scope
        .as_ref()
        .map(|scope| string_array_field(scope, "path_globs"))
        .unwrap_or_default();
    let mut findings = Vec::new();
    let mut proofs = Vec::new();

    for file_path in files {
        if !path_globs.is_empty()
            && !path_globs
                .iter()
                .any(|pattern| path_glob_matches(pattern, &file_path))
        {
            continue;
        }
        if !allowed_methods.is_empty()
            && !route_methods_for_file(facts, &file_path)
                .iter()
                .any(|method| allowed_methods.contains(method))
        {
            continue;
        }
        let Some(source) = read_repo_file(repo_root, &file_path) else {
            continue;
        };
        let proof =
            match build_phase4_security_proof_with_policy(&file_path, &source, &phase4_policy) {
                Ok(proof) => proof,
                Err(_) => continue,
            };
        let required = match convention.kind.as_str() {
            "api_route_requires_tenant_scope" => proof.tenant.required,
            "api_route_requires_authorization" => proof.authorization.required,
            "session_object_must_come_from_trusted_helper" => proof.session_trust.required,
            _ => false,
        };
        if !required {
            continue;
        }
        let proven = match convention.kind.as_str() {
            "api_route_requires_tenant_scope" => proof.tenant.proven,
            "api_route_requires_authorization" => proof.authorization.proven,
            "session_object_must_come_from_trusted_helper" => proof.session_trust.proven,
            _ => false,
        };
        let (route_id, handler_symbol) = route_identity_for_file(facts, &file_path)
            .unwrap_or_else(|| (format!("route:{file_path}:unknown"), "unknown".to_string()));
        let missing_code = phase4_missing_code(&proof, &convention.kind);
        let finding_line = phase4_finding_line(&proof).unwrap_or(1);
        let finding_fingerprint = stable_hash(&format!(
            "{}:{}:{}:{}",
            convention.id, route_id, missing_code, finding_line
        ));
        let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
        proofs.push(phase4_proof_json(
            &proof,
            &route_id,
            &file_path,
            &handler_symbol,
            convention,
            &finding_id,
        ));
        if !proven || proof.result.proof_status == SecurityProofStatus::ParserGap {
            findings.push(PendingFinding {
                fingerprint: finding_fingerprint,
                convention_id: convention.id.clone(),
                rule_id: convention.kind.clone(),
                title: phase4_finding_title(&convention.kind).to_string(),
                message: "Accepted Phase 4 security proof is required for protected route sinks."
                    .to_string(),
                severity,
                enforcement_result: enforcement_result_for_mode(enforcement_mode),
                file_path: file_path.clone(),
                import_name: phase4_expected_layer(&convention.kind).to_string(),
                import_source: missing_code,
                line: finding_line,
                evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
                symbol: PendingFinding::no_symbol(),
                legacy_fingerprints: Vec::new(),
                related_node_ids: Vec::new(),
            });
        }
    }

    SecurityPhase4Evaluation { findings, proofs }
}

/// TDD §5.1.4 — the dead-config diagnostic, defence in depth for the D1 class of defect.
///
/// The two ways an accepted `api_route_forbids_sensitive_response_fields` convention can enforce
/// nothing while reporting a clean pass, both of which were silent before this existed:
///
/// 1. **The parser could not read an entry.** `accepted_sensitive_response_field` fails closed via
///    `filter_map`, so an unknown `classification` or `source` vanishes with no error. This is the
///    trap that would have made D1's first proposed fix a total no-op: it promoted `source` to a
///    value the allowlist rejected, and the check would have gone on never firing, silently.
/// 2. **Every entry parsed, and the proof then discarded all of them.** `source: "candidate"` is
///    an unreviewed guess and `sensitive_field_source_is_trusted` drops it. A convention made
///    entirely of those has no enforceable field left — which is precisely the state every
///    convention accepted before D1's fix is in, and the non-destructive alternative to migrating
///    those users' state DBs (see docs/decisions/d1-sensitive-field-source-migration.md).
///
/// Either way the user's remedy is the same and is named in the message: re-run
/// `drift conventions accept` on the candidate so provenance is recorded correctly.
fn sensitive_response_field_config_diagnostics(
    convention_id: &str,
    requires: Option<&serde_json::Value>,
) -> Vec<crate::protocol::EngineDiagnostic> {
    let Some(requires) = requires else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();

    let rejections = sensitive_response_field_rejections(requires);
    if !rejections.is_empty() {
        diagnostics.push(crate::protocol::EngineDiagnostic {
            severity: "warning".to_string(),
            code: "convention_config_unreadable".to_string(),
            message: format!(
                "Accepted convention {convention_id} has {} sensitive_response_fields entr{} the \
                 engine cannot read, so they are not being checked: {}. Re-run `drift conventions \
                 accept` for this candidate to record them in a form the check understands.",
                rejections.len(),
                if rejections.len() == 1 { "y" } else { "ies" },
                rejections.join("; ")
            ),
            file_path: None,
            import_source: None,
        });
    }

    let parsed = accepted_phase5_contract_from_requires(requires);
    let fields = parsed
        .as_ref()
        .map(|accepted| accepted.sensitive_response_fields.as_slice())
        .unwrap_or_default();
    if !fields.is_empty()
        && !fields
            .iter()
            .any(|field| sensitive_field_source_is_trusted(&field.source))
    {
        diagnostics.push(crate::protocol::EngineDiagnostic {
            severity: "warning".to_string(),
            code: "convention_config_unenforceable".to_string(),
            message: format!(
                "Accepted convention {convention_id} enforces nothing: all {} of its \
                 sensitive_response_fields carry source \"candidate\", an unreviewed name-heuristic \
                 guess the proof will not enforce on. Re-run `drift conventions accept` for this \
                 candidate to record the fields as reviewed.",
                fields.len()
            ),
            file_path: None,
            import_source: None,
        });
    }

    diagnostics
}

fn security_phase5_findings_and_proofs(
    facts: &[Fact],
    repo_root: Option<&str>,
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> SecurityPhase5Evaluation {
    let Some(accepted_phase5) = convention
        .requires
        .as_ref()
        .and_then(accepted_phase5_contract_from_requires)
    else {
        return SecurityPhase5Evaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    };
    if convention
        .matcher
        .applies_to_file_roles
        .as_ref()
        .is_some_and(|roles| !roles.iter().any(|role| role == "api_route"))
    {
        return SecurityPhase5Evaluation {
            findings: Vec::new(),
            proofs: Vec::new(),
        };
    }

    let allowed_methods = convention
        .matcher
        .methods
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|method| method.to_uppercase())
        .collect::<Vec<_>>();
    let path_globs = convention
        .scope
        .as_ref()
        .map(|scope| string_array_field(scope, "path_globs"))
        .unwrap_or_default();
    let files = security_auth_files(facts, parsed_diff, diff_scope);
    let mut findings = Vec::new();
    let mut proofs = Vec::new();

    for file_path in files {
        if !phase5_file_scope_matches(&file_path, &path_globs) {
            continue;
        }
        let route_facts = phase5_route_facts_for_file(facts, &file_path, &allowed_methods);
        if route_facts.is_empty() {
            continue;
        }
        let Some(source) = read_repo_file(repo_root, &file_path) else {
            continue;
        };
        for route_fact in route_facts {
            let proof = match convention.kind.as_str() {
                "api_route_forbids_sensitive_response_fields" => {
                    if accepted_phase5.sensitive_response_fields.is_empty()
                        && accepted_phase5.response_serializers.is_empty()
                    {
                        continue;
                    }
                    match drift_engine::build_response_shape_proof(
                        &file_path,
                        &source,
                        &accepted_phase5,
                    ) {
                        Ok(proof) => phase5_scope_proof_to_route(
                            proof,
                            route_fact.start_line,
                            route_fact.end_line,
                        ),
                        Err(_) => continue,
                    }
                }
                "api_route_forbids_secret_exposure" => {
                    if accepted_phase5.secret_sources.is_empty() {
                        continue;
                    }
                    match drift_engine::build_secret_exposure_proof(
                        &file_path,
                        &source,
                        &accepted_phase5,
                    ) {
                        Ok(proof) => phase5_scope_proof_to_route(
                            proof,
                            route_fact.start_line,
                            route_fact.end_line,
                        ),
                        Err(_) => continue,
                    }
                }
                _ => continue,
            };
            let route_id = format!("route:{}:{}", route_fact.file_path, route_fact.name);
            let handler_symbol = route_fact.name.clone();
            let missing_code = phase5_missing_code(&proof, &convention.kind);
            let finding_line = phase5_finding_line(&proof).unwrap_or(route_fact.start_line);
            let finding_fingerprint = stable_hash(&format!(
                "{}:{}:{}:{}",
                convention.id, route_id, missing_code, finding_line
            ));
            let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
            proofs.push(phase5_proof_json(
                &proof,
                &route_id,
                &file_path,
                &handler_symbol,
                convention,
                &finding_id,
                &missing_code,
            ));
            if proof.result.proof_status != SecurityProofStatus::Proven {
                findings.push(PendingFinding {
                    fingerprint: finding_fingerprint,
                    convention_id: convention.id.clone(),
                    rule_id: convention.kind.clone(),
                    title: phase5_finding_title(&convention.kind).to_string(),
                    message: phase5_finding_message(&convention.kind).to_string(),
                    severity,
                    enforcement_result: enforcement_result_for_mode(enforcement_mode),
                    file_path: file_path.clone(),
                    import_name: "security_boundary".to_string(),
                    import_source: missing_code,
                    line: finding_line,
                    evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
                    symbol: PendingFinding::no_symbol(),
                    legacy_fingerprints: Vec::new(),
                    related_node_ids: Vec::new(),
                });
            }
        }
    }

    SecurityPhase5Evaluation { findings, proofs }
}

/// CV-3: is this convention enforced by presence rather than by a proof?
///
/// Per candidate, not per kind. The family candidates emit `enforcement_semantics: "presence"`; the
/// per-symbol candidates of the same kinds do not, and they keep the guard-dominance path below and
/// stay behind `--experimental-security`.
fn is_presence_convention(convention: &crate::protocol::CheckConvention) -> bool {
    convention.matcher.enforcement_semantics.as_deref() == Some("presence")
}

/// Presence-only enforcement: does this route call a member of the accepted family?
///
/// **What this claims, exactly.** That the route calls one of the accepted helpers, resolved through
/// its import rather than matched as a string. Nothing else. It does not claim the helper runs before
/// anything, that it cannot be bypassed on a branch, or that the route is protected.
///
/// **What it therefore misses, by construction.** A route that calls the wrapper and then routes a
/// sink around it passes. Catching that is `build_auth_boundary_proof`'s job - guard dominance,
/// branch-bypass and callback-boundary analysis - and that tier stays quarantined per
/// docs/architecture/security-heuristic-audit.md. CV-4 pins this as a documented non-catch rather
/// than leaving it implicit, and the ledger's `false_positive_behavior` states it.
///
/// The finding wording follows from that: "does not call any accepted <thing>", never "unprotected"
/// and never "missing auth". A presence check that reported protection would be claiming the proof
/// this path deliberately does not compute, which is the v1 pattern this sprint exists to not repeat.
fn presence_findings(
    facts: &[Fact],
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
    convention: &crate::protocol::CheckConvention,
    severity: Severity,
    enforcement_mode: EnforcementMode,
) -> Vec<PendingFinding> {
    let accepted = presence_accepted_symbols(convention);
    if accepted.is_empty() {
        // No helpers means nothing to look for. Reporting every route as non-compliant here is the
        // F3-class shape that made the rate-limit family strictly worse than what it superseded, so
        // this refuses to produce findings instead.
        return Vec::new();
    }
    let flavors = convention
        .matcher
        .applies_to_route_flavors
        .clone()
        .unwrap_or_default();
    let mut findings = Vec::new();

    for file_path in security_auth_files(facts, parsed_diff, diff_scope) {
        if !presence_file_in_scope(convention, facts, &file_path, &flavors) {
            continue;
        }
        // Per HANDLER, not per file.
        //
        // A Next.js `route.ts` exporting `GET` and `POST` is two independent HTTP endpoints. Asking
        // the question file-wide let a file where only `GET` was wrapped pass entirely, so a route
        // whose `POST` wrote to the database unguarded reported clean - and "wrap the read, forget the
        // write" is the single most likely shape in a half-finished migration, which makes it the
        // worst possible thing for this tier to miss.
        //
        // Each handler is satisfied by an accepted call whose source span INTERSECTS its own. Either
        // nesting direction counts, because both occur: `export const POST = withSession(async () =>
        // {...})` has the call enclosing the handler, while a call inside the handler body sits within
        // it. Intersection is syntactic containment, not control flow - it says which handler a call
        // belongs to, and nothing about whether it runs first.
        let handlers = facts
            .iter()
            .filter(|fact| fact.kind == FactKind::RouteDeclared && fact.file_path == file_path)
            .collect::<Vec<_>>();
        let accepted_calls = facts
            .iter()
            .filter(|fact| {
                fact.kind == FactKind::SymbolCalled
                    && fact.file_path == file_path
                    && presence_call_resolves_to_accepted(facts, &file_path, fact, &accepted)
            })
            .collect::<Vec<_>>();

        // A route file with no handler fact at all is judged file-wide, because there is no handler to
        // attribute anything to. Refusing to judge it would be a silent gap; judging it whole is the
        // same answer the previous behaviour gave.
        let unsatisfied: Vec<Option<&Fact>> = if handlers.is_empty() {
            if accepted_calls.is_empty() {
                vec![None]
            } else {
                Vec::new()
            }
        } else {
            handlers
                .iter()
                .filter(|handler| {
                    !accepted_calls.iter().any(|call| {
                        call.start_line <= handler.end_line && handler.start_line <= call.end_line
                    })
                })
                .map(|handler| Some(*handler))
                .collect()
        };

        for handler in unsatisfied {
            let missing_code = presence_missing_code(&convention.kind);
            // The handler is part of the fingerprint, so two unguarded methods in one file are two
            // findings rather than one that silently stands for both.
            let finding_fingerprint = stable_hash(&format!(
                "{}:{}:{}:{}",
                convention.id,
                file_path,
                handler.map(|fact| fact.name.as_str()).unwrap_or("*"),
                missing_code
            ));
            let finding_id = format!("finding_{}", &finding_fingerprint[..16]);
            let mut symbols = accepted.iter().cloned().collect::<Vec<_>>();
            symbols.sort();
            findings.push(PendingFinding {
            fingerprint: finding_fingerprint,
            convention_id: convention.id.clone(),
            rule_id: convention.kind.clone(),
            title: presence_finding_title(&convention.kind).to_string(),
            // Presence, never protection. See this function's doc comment.
            message: format!(
                "{} does not call any accepted {} ({}). This checks only that one is called - it does not check that it guards the route's work.",
                handler
                    .map(|fact| format!("This route's {} handler", fact.name))
                    .unwrap_or_else(|| "This route".to_string()),
                presence_noun(&convention.kind),
                symbols.join(", ")
            ),
            severity,
            enforcement_result: enforcement_result_for_mode(enforcement_mode),
            file_path: file_path.clone(),
            import_name: "presence".to_string(),
            import_source: missing_code.to_string(),
            line: handler.map(|fact| fact.start_line).unwrap_or(1),
            evidence_id: format!("evidence_{}", &finding_id["finding_".len()..]),
            // T-03: the handler this finding is about, in a field rather than only in the prose.
            //
            // `None` for a route file with no handler fact, which is judged file-wide above - there
            // is genuinely no symbol to name there, and inventing a sentinel would make a file-wide
            // finding look like a per-handler one.
            symbol: handler.map(|fact| fact.name.clone()),
            legacy_fingerprints: Vec::new(),
            related_node_ids: Vec::new(),
        });
        }
    }

    findings
}

/// The accepted symbols, from the matcher's disjunction and from `requires`, so a family accepted
/// through either shape enforces.
fn presence_accepted_symbols(
    convention: &crate::protocol::CheckConvention,
) -> std::collections::BTreeSet<String> {
    let mut symbols = std::collections::BTreeSet::new();
    for symbol in convention
        .matcher
        .required_calls
        .as_ref()
        .into_iter()
        .flatten()
    {
        symbols.insert(symbol.clone());
    }
    if let Some(requires) = convention.requires.as_ref() {
        for key in ["auth_helpers", "rate_limit_helpers", "validators"] {
            if let Some(entries) = requires.get(key).and_then(|value| value.as_array()) {
                for entry in entries {
                    if let Some(symbol) = entry.get("symbol").and_then(|value| value.as_str()) {
                        symbols.insert(symbol.to_string());
                    }
                }
            }
        }
    }
    symbols
}

/// Whether a call resolves to one of the accepted symbols.
///
/// Resolution, never string equality. Three shapes, because those are the three ways a repo actually
/// reaches a shared helper:
///
///   1. a named import, possibly renamed - `import { withSession as w }`, the E-5 shape. The local
///      binding is `w`; what it resolves to is `withSession`.
///   2. a namespace import - `import * as auth from "@/lib/auth"` then `auth.withSession(...)`. The
///      call fact carries the property in `name` and the receiver in `value`, and the import fact
///      binds the namespace with `imported_name: "*"`. Missing this shape reported a genuinely
///      wrapped route as calling no wrapper, on a convention that is visible by default - a false
///      positive on the promoted tier, which is worse than a missed detection here. The same rule
///      already existed in `security_patterns.rs::schema_receiver_matches`; this mirrors it rather
///      than inventing a second answer.
///   3. neither - an unimported local of the same name resolves to nothing and does not satisfy.
fn presence_call_resolves_to_accepted(
    facts: &[Fact],
    file_path: &str,
    call: &Fact,
    accepted: &std::collections::BTreeSet<String>,
) -> bool {
    // (1) the local binding is an import of an accepted symbol.
    let named = facts.iter().any(|fact| {
        fact.kind == FactKind::ImportUsed
            && fact.file_path == file_path
            && fact.name == call.name
            && fact
                .imported_name
                .as_deref()
                .is_some_and(|imported| accepted.contains(imported))
    });
    if named {
        return true;
    }
    // (2) `<namespace>.<accepted>(...)`, where `<namespace>` is a namespace import in this file.
    if !accepted.contains(&call.name) {
        return false;
    }
    let Some(receiver) = call.value.as_deref() else {
        return false;
    };
    // Only a direct property of the namespace: `auth.withSession` resolves, `auth.v2.withSession`
    // does not, because the second hop is not something this fact can account for.
    let namespace = receiver.split('.').next().unwrap_or(receiver);
    namespace == receiver
        && facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.file_path == file_path
                && fact.name == namespace
                && fact.imported_name.as_deref() == Some("*")
        })
}

/// Whether this route is in scope for a presence convention.
///
/// **Deliberately does not match path globs.** The caller has already applied the one scope predicate
/// in the product - `conventionScopeFiles` in `@drift/core` - and passes only the facts of files it
/// selected (`run-check.ts`: `facts.filter((fact) => fileSet.has(fact.file_path))`). Re-deciding scope
/// here would be a second scope engine, which is the BB-11 lesson, and it would be a second scope
/// engine that is WRONG: `path_glob_matches` reduces `**/app/api/**/route.ts` to a `starts_with` on
/// the literal prefix `**/app/api`, so a root-level `app/api/x/route.ts` - the default
/// create-next-app layout - matches nothing. That is F3's exact shape, still live in this matcher, and
/// it is why the first end-to-end run of this path found zero findings on a repo whose routes were all
/// violations. Recorded as a discovery; the phase5 paths that still use it are quarantined and are not
/// changed here.
///
/// What remains is the flavour condition, which is not a scope glob and has no equivalent upstream.
fn presence_file_in_scope(
    convention: &crate::protocol::CheckConvention,
    facts: &[Fact],
    file_path: &str,
    flavors: &[String],
) -> bool {
    let _ = convention;
    // CV-2: a session family is not about cron routes. The flavour is read from the fact the scan
    // emitted, never re-derived from the path here - one classification, made once.
    if !flavors.is_empty() {
        let flavor = facts
            .iter()
            .find(|fact| fact.kind == FactKind::RouteFlavorDetected && fact.file_path == file_path)
            .map(|fact| fact.name.clone())
            .unwrap_or_else(|| "api_route".to_string());
        if !flavors.contains(&flavor) {
            return false;
        }
    }
    true
}

fn presence_missing_code(kind: &str) -> &'static str {
    match kind {
        "api_route_requires_rate_limit" => "no_rate_limit_helper_called",
        "api_route_requires_request_validation" => "no_request_validator_called",
        _ => "no_auth_helper_called",
    }
}

fn presence_finding_title(kind: &str) -> &'static str {
    match kind {
        "api_route_requires_rate_limit" => "API route calls no accepted rate-limit helper",
        "api_route_requires_request_validation" => "API route calls no accepted request validator",
        _ => "API route calls no accepted auth wrapper",
    }
}

fn presence_noun(kind: &str) -> &'static str {
    match kind {
        "api_route_requires_rate_limit" => "rate-limit helper",
        "api_route_requires_request_validation" => "request validator",
        _ => "auth wrapper",
    }
}

fn accepted_auth_helpers_for_convention(
    convention: &crate::protocol::CheckConvention,
) -> Vec<AcceptedAuthHelper> {
    let mut helpers = BTreeMap::<String, AcceptedAuthHelper>::new();
    for symbol in convention
        .matcher
        .required_calls
        .as_ref()
        .into_iter()
        .flatten()
    {
        helpers.insert(
            symbol.clone(),
            AcceptedAuthHelper {
                guard_id: format!("auth:{symbol}"),
                symbol: symbol.clone(),
                behavior: AuthGuardBehavior::Unknown,
            },
        );
    }
    if let Some(auth_helpers) = convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get("auth_helpers"))
        .and_then(|value| value.as_array())
    {
        for helper in auth_helpers {
            if let Some(symbol) = helper.as_str() {
                helpers.insert(
                    symbol.to_string(),
                    AcceptedAuthHelper {
                        guard_id: format!("auth:{symbol}"),
                        symbol: symbol.to_string(),
                        behavior: AuthGuardBehavior::Unknown,
                    },
                );
            } else if let Some(symbol) = helper
                .get("symbol")
                .or_else(|| helper.get("name"))
                .and_then(|value| value.as_str())
            {
                helpers.insert(
                    symbol.to_string(),
                    AcceptedAuthHelper {
                        guard_id: helper
                            .get("guard_id")
                            .and_then(|value| value.as_str())
                            .unwrap_or(symbol)
                            .to_string(),
                        symbol: symbol.to_string(),
                        behavior: helper
                            .get("behavior")
                            .and_then(|value| value.as_str())
                            .map(auth_guard_behavior_from_str)
                            .unwrap_or(AuthGuardBehavior::Unknown),
                    },
                );
            }
        }
    }
    helpers.into_values().collect()
}

fn phase4_policy_for_convention(
    convention: &crate::protocol::CheckConvention,
) -> Phase4SecurityPolicy {
    let mut helpers = BTreeMap::<String, AcceptedAuthHelper>::new();
    let mut helper_imports = BTreeMap::<String, AcceptedHelperImport>::new();
    if let Some(auth_helpers) = convention
        .requires
        .as_ref()
        .and_then(|requires| requires.get("auth_helpers"))
        .and_then(|value| value.as_array())
    {
        for helper in auth_helpers {
            if let Some(symbol) = helper.as_str() {
                helpers.insert(
                    symbol.to_string(),
                    AcceptedAuthHelper {
                        guard_id: format!("auth:{symbol}"),
                        symbol: symbol.to_string(),
                        behavior: AuthGuardBehavior::Unknown,
                    },
                );
            } else if let Some(symbol) = helper
                .get("symbol")
                .or_else(|| helper.get("name"))
                .and_then(|value| value.as_str())
            {
                helpers.insert(
                    symbol.to_string(),
                    AcceptedAuthHelper {
                        guard_id: helper
                            .get("guard_id")
                            .and_then(|value| value.as_str())
                            .unwrap_or(symbol)
                            .to_string(),
                        symbol: symbol.to_string(),
                        behavior: helper
                            .get("behavior")
                            .and_then(|value| value.as_str())
                            .or_else(|| helper.get("returns").and_then(|value| value.as_str()))
                            .map(auth_guard_behavior_from_str)
                            .unwrap_or(AuthGuardBehavior::Unknown),
                    },
                );
                helper_imports.insert(
                    symbol.to_string(),
                    AcceptedHelperImport {
                        symbol: symbol.to_string(),
                        import_source: helper
                            .get("import")
                            .or_else(|| helper.get("import_source"))
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    },
                );
            }
        }
    }
    Phase4SecurityPolicy {
        accepted_auth_helpers: helpers.into_values().collect(),
        auth_helper_imports: helper_imports.into_values().collect(),
        authorization_helpers: accepted_authorization_helpers_for_phase4_convention(convention),
        tenant_helpers: accepted_tenant_helpers_for_phase4_convention(convention),
        tenant_keys: convention
            .requires
            .as_ref()
            .map(|requires| string_array_field(requires, "tenant_keys"))
            .unwrap_or_default(),
        tenant_sources: convention
            .requires
            .as_ref()
            .map(|requires| string_array_field(requires, "tenant_sources"))
            .unwrap_or_default(),
        data_operations: convention
            .requires
            .as_ref()
            .map(|requires| string_array_field(requires, "data_operations"))
            .unwrap_or_default(),
    }
}

fn auth_guard_behavior_from_str(behavior: &str) -> AuthGuardBehavior {
    match behavior {
        "throws" => AuthGuardBehavior::Throws,
        "returns_user" => AuthGuardBehavior::ReturnsUser,
        "user" => AuthGuardBehavior::ReturnsUser,
        "returns_session" => AuthGuardBehavior::ReturnsSession,
        "session" => AuthGuardBehavior::ReturnsSession,
        "boolean" => AuthGuardBehavior::Boolean,
        _ => AuthGuardBehavior::Unknown,
    }
}

fn accepted_authorization_helpers_for_phase4_convention(
    convention: &crate::protocol::CheckConvention,
) -> Vec<AcceptedAuthorizationHelper> {
    let Some(requires) = &convention.requires else {
        return Vec::new();
    };
    requires
        .get("authorization_helpers")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|helper| {
            let symbol = helper.as_str().or_else(|| {
                helper
                    .get("symbol")
                    .or_else(|| helper.get("name"))
                    .and_then(|value| value.as_str())
            })?;
            Some(AcceptedAuthorizationHelper {
                guard_id: helper
                    .get("guard_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or(symbol)
                    .to_string(),
                symbol: symbol.to_string(),
                import_source: helper
                    .get("import")
                    .or_else(|| helper.get("import_source"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                kind: helper
                    .get("kind")
                    .and_then(|value| value.as_str())
                    .map(authorization_helper_kind_from_str)
                    .unwrap_or_else(|| {
                        if symbol.to_ascii_lowercase().contains("role") {
                            AuthorizationHelperKind::Role
                        } else {
                            AuthorizationHelperKind::Policy
                        }
                    }),
                behavior: helper
                    .get("behavior")
                    .and_then(|value| value.as_str())
                    .map(authorization_helper_behavior_from_str)
                    .unwrap_or_else(|| {
                        if symbol.to_ascii_lowercase().starts_with("can") {
                            AuthorizationHelperBehavior::Boolean
                        } else {
                            AuthorizationHelperBehavior::Throws
                        }
                    }),
            })
        })
        .collect()
}

fn accepted_tenant_helpers_for_phase4_convention(
    convention: &crate::protocol::CheckConvention,
) -> Vec<AcceptedTenantHelper> {
    let Some(requires) = &convention.requires else {
        return Vec::new();
    };
    let tenant_keys = string_array_field(requires, "tenant_keys");
    requires
        .get("tenant_helpers")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|helper| {
            let symbol = helper.as_str().or_else(|| {
                helper
                    .get("symbol")
                    .or_else(|| helper.get("name"))
                    .and_then(|value| value.as_str())
            })?;
            Some(AcceptedTenantHelper {
                helper_id: helper
                    .get("helper_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or(symbol)
                    .to_string(),
                symbol: symbol.to_string(),
                import_source: helper
                    .get("import")
                    .or_else(|| helper.get("import_source"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                tenant_key: helper
                    .get("tenant_key")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                    .or_else(|| tenant_keys.first().cloned())
                    .unwrap_or_else(|| "tenantId".to_string()),
            })
        })
        .collect()
}

fn authorization_helper_kind_from_str(kind: &str) -> AuthorizationHelperKind {
    match kind {
        "role" => AuthorizationHelperKind::Role,
        "policy" => AuthorizationHelperKind::Policy,
        _ => AuthorizationHelperKind::Policy,
    }
}

fn authorization_helper_behavior_from_str(behavior: &str) -> AuthorizationHelperBehavior {
    match behavior {
        "throws" => AuthorizationHelperBehavior::Throws,
        "boolean" => AuthorizationHelperBehavior::Boolean,
        _ => AuthorizationHelperBehavior::Throws,
    }
}

fn accepted_request_validators_for_convention(
    convention: &crate::protocol::CheckConvention,
) -> Vec<AcceptedRequestValidator> {
    let mut validators = BTreeMap::<String, AcceptedRequestValidator>::new();
    if let Some(requires) = &convention.requires {
        if let Some(helper_values) = requires
            .get("validators")
            .and_then(|value| value.as_array())
        {
            for helper in helper_values {
                insert_request_validator_value(
                    &mut validators,
                    helper,
                    RequestValidatorKind::Helper,
                    RequestValidatorBehavior::ReturnsParsed,
                );
            }
        }
        if let Some(schema_values) = requires.get("schemas").and_then(|value| value.as_array()) {
            for schema in schema_values {
                insert_request_validator_value(
                    &mut validators,
                    schema,
                    RequestValidatorKind::Schema,
                    RequestValidatorBehavior::ReturnsParsed,
                );
            }
        }
    }
    validators.into_values().collect()
}

fn request_validation_proof_scope_for_convention(
    convention: &crate::protocol::CheckConvention,
) -> drift_engine::RequestValidationProofScope {
    let Some(requires) = &convention.requires else {
        return drift_engine::RequestValidationProofScope::default();
    };
    drift_engine::RequestValidationProofScope {
        input_sources: string_array_field(requires, "input_sources"),
        sink_kinds: string_array_field(requires, "sinks"),
    }
}

fn string_array_field(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|field| field.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_str().map(str::to_string))
        .collect()
}

fn insert_request_validator_value(
    validators: &mut BTreeMap<String, AcceptedRequestValidator>,
    value: &serde_json::Value,
    default_kind: RequestValidatorKind,
    default_behavior: RequestValidatorBehavior,
) {
    if let Some(symbol) = value.as_str() {
        insert_request_validator(
            validators,
            symbol,
            defaulted_request_validator_kind(symbol, default_kind),
            default_behavior,
            None,
        );
        return;
    }
    let Some(symbol) = value
        .get("symbol")
        .or_else(|| value.get("name"))
        .and_then(|symbol| symbol.as_str())
    else {
        return;
    };
    let kind = value
        .get("kind")
        .and_then(|kind| kind.as_str())
        .map(request_validator_kind_from_str)
        .unwrap_or_else(|| defaulted_request_validator_kind(symbol, default_kind));
    let behavior = value
        .get("behavior")
        .and_then(|behavior| behavior.as_str())
        .map(request_validator_behavior_from_str)
        .unwrap_or(default_behavior);
    let validator_id = value
        .get("validator_id")
        .or_else(|| value.get("id"))
        .and_then(|id| id.as_str());
    insert_request_validator(validators, symbol, kind, behavior, validator_id);
}

fn insert_request_validator(
    validators: &mut BTreeMap<String, AcceptedRequestValidator>,
    symbol: &str,
    kind: RequestValidatorKind,
    behavior: RequestValidatorBehavior,
    validator_id: Option<&str>,
) {
    validators.insert(
        format!("{}:{symbol}", kind.as_str()),
        AcceptedRequestValidator {
            validator_id: validator_id.unwrap_or(symbol).to_string(),
            symbol: symbol.to_string(),
            kind,
            behavior,
        },
    );
}

/// Picks the kind for a validator entry that did not say one.
///
/// The candidate proposer never writes a `kind`: `push_request_validation_candidates`
/// (`candidate_command.rs`) emits every inferred symbol under `requires.validators` with
/// `requires.schemas` left empty, so everything it produces defaulted to `Helper`. That is right
/// for `validateEmail` and wrong for `safeParse`, which is only ever reached as
/// `SomeSchema.safeParse(body)` - and `Helper` requires a call with no receiver. The result was a
/// convention that could be inferred and accepted but could never prove anything, and that
/// therefore flagged the very routes whose `safeParse` calls it had been inferred from.
///
/// An entry that DOES carry an explicit `kind` is left alone, so a hand-authored contract can still
/// pin a symbol to `helper` and get the old matching.
fn defaulted_request_validator_kind(
    symbol: &str,
    default_kind: RequestValidatorKind,
) -> RequestValidatorKind {
    if default_kind == RequestValidatorKind::Helper
        && drift_engine::is_schema_method_validator_symbol(symbol)
    {
        return RequestValidatorKind::SchemaMethod;
    }
    default_kind
}

fn request_validator_kind_from_str(kind: &str) -> RequestValidatorKind {
    match kind {
        "schema" => RequestValidatorKind::Schema,
        "schema_method" => RequestValidatorKind::SchemaMethod,
        _ => RequestValidatorKind::Helper,
    }
}

fn request_validator_behavior_from_str(behavior: &str) -> RequestValidatorBehavior {
    match behavior {
        "throws" => RequestValidatorBehavior::Throws,
        "boolean" => RequestValidatorBehavior::Boolean,
        "unknown" => RequestValidatorBehavior::Unknown,
        _ => RequestValidatorBehavior::ReturnsParsed,
    }
}

fn read_repo_file(repo_root: Option<&str>, file_path: &str) -> Option<String> {
    let repo_root = repo_root?;
    let path = Path::new(repo_root).join(file_path);
    fs::read_to_string(path).ok()
}

fn first_sink_line_for_route(
    facts: &[Fact],
    file_path: &str,
    route_proof: &RouteSecurityBoundaryProof,
) -> Option<usize> {
    let route = facts.iter().find(|fact| {
        fact.file_path == file_path
            && fact.kind == FactKind::RouteDeclared
            && fact.name == route_proof.handler_symbol
    })?;
    facts
        .iter()
        .filter(|fact| {
            fact.file_path == file_path
                && route.start_line <= fact.start_line
                && fact.end_line <= route.end_line
                && matches!(
                    fact.kind,
                    FactKind::DataOperationDetected | FactKind::RouteReturnsResponse
                )
        })
        .map(|fact| fact.start_line)
        .min()
}

fn route_identity_for_file(facts: &[Fact], file_path: &str) -> Option<(String, String)> {
    facts
        .iter()
        .find(|fact| fact.file_path == file_path && fact.kind == FactKind::RouteDeclared)
        .map(|fact| {
            (
                format!("route:{}:{}", fact.file_path, fact.name),
                fact.name.clone(),
            )
        })
}

fn route_methods_for_file(facts: &[Fact], file_path: &str) -> Vec<String> {
    facts
        .iter()
        .filter(|fact| fact.file_path == file_path && fact.kind == FactKind::RouteDeclared)
        .map(|fact| fact.name.to_uppercase())
        .collect()
}

fn phase5_route_facts_for_file<'a>(
    facts: &'a [Fact],
    file_path: &str,
    allowed_methods: &[String],
) -> Vec<&'a Fact> {
    facts
        .iter()
        .filter(|fact| fact.file_path == file_path && fact.kind == FactKind::RouteDeclared)
        .filter(|fact| {
            allowed_methods.is_empty() || allowed_methods.contains(&fact.name.to_uppercase())
        })
        .collect()
}

fn phase5_missing_code(proof: &SecurityBoundaryProof, convention_kind: &str) -> String {
    if convention_kind == "api_route_forbids_sensitive_response_fields" {
        if !proof.response_shape.sensitive_leaks.is_empty() {
            "sensitive_response_field_unfiltered".to_string()
        } else {
            "dynamic_response_shape_missing_proof".to_string()
        }
    } else {
        "secret_exposure_not_excluded".to_string()
    }
}

fn phase5_finding_line(proof: &SecurityBoundaryProof) -> Option<usize> {
    proof
        .response_shape
        .sensitive_leaks
        .first()
        .map(|leak| input_line_from_fact_id(&leak.field_fact_id))
        .or_else(|| {
            proof
                .secret_exposure
                .exposed_secrets
                .first()
                .map(|secret| secret.sink_line)
        })
        .or_else(|| {
            proof
                .parser_gaps
                .first()
                .and_then(|gap| gap.parser_gap_id.split(':').nth_back(1))
                .and_then(|line| line.parse::<usize>().ok())
        })
        .filter(|line| *line > 0)
}

fn phase5_scope_proof_to_route(
    mut proof: SecurityBoundaryProof,
    start_line: usize,
    end_line: usize,
) -> SecurityBoundaryProof {
    proof.response_shape.sensitive_leaks.retain(|leak| {
        line_in_range(
            input_line_from_fact_id(&leak.field_fact_id),
            start_line,
            end_line,
        )
    });
    proof
        .secret_exposure
        .exposed_secrets
        .retain(|secret| line_in_range(secret.sink_line, start_line, end_line));
    proof
        .parser_gaps
        .retain(|gap| line_in_range(phase5_parser_gap_line(gap), start_line, end_line));

    if proof.response_shape.required {
        proof.response_shape.proven =
            proof.response_shape.sensitive_leaks.is_empty() && proof.parser_gaps.is_empty();
    }
    if proof.secret_exposure.required {
        proof.secret_exposure.proven =
            proof.secret_exposure.exposed_secrets.is_empty() && proof.parser_gaps.is_empty();
    }
    let proven = (proof.response_shape.required && proof.response_shape.proven)
        || (proof.secret_exposure.required && proof.secret_exposure.proven);
    proof.result.proof_status = if !proof.parser_gaps.is_empty() {
        SecurityProofStatus::ParserGap
    } else if proven {
        SecurityProofStatus::Proven
    } else {
        SecurityProofStatus::MissingProof
    };
    proof
}

fn phase5_parser_gap_line(gap: &drift_engine::SecurityParserGap) -> usize {
    gap.parser_gap_id
        .split(':')
        .nth_back(1)
        .and_then(|line| line.parse::<usize>().ok())
        .unwrap_or(0)
}

fn line_in_range(line: usize, start_line: usize, end_line: usize) -> bool {
    line >= start_line && line <= end_line
}

fn phase5_finding_title(convention_kind: &str) -> &'static str {
    if convention_kind == "api_route_forbids_sensitive_response_fields" {
        "API route emits sensitive response field"
    } else {
        "API route exposes secret to response or log sink"
    }
}

fn phase5_finding_message(convention_kind: &str) -> &'static str {
    if convention_kind == "api_route_forbids_sensitive_response_fields" {
        "Accepted sensitive response fields must be excluded by an accepted serializer."
    } else {
        "Accepted secret sources must not reach response or log sinks."
    }
}

fn phase5_file_scope_matches(file_path: &str, path_globs: &[String]) -> bool {
    if path_globs.is_empty() {
        return true;
    }
    let route_path = phase5_route_path_from_file(file_path);
    path_globs.iter().any(|pattern| {
        phase5_scope_pattern_matches(pattern, file_path)
            || route_path
                .as_deref()
                .is_some_and(|route_path| phase5_scope_pattern_matches(pattern, route_path))
    })
}

/// Phase5 scope matching: globstar, plus one widening that belongs to phase5 alone.
///
/// A trailing `/*` also matches the bare directory. That is NOT glob semantics — `*` is "any run
/// of characters except `/`", so strict globstar says `/api/users/*` does not match
/// `/api/users`, and `matchesGlob` in `packages/core/src/globs.ts` says exactly that. The
/// widening exists because this is the one scope site that tests patterns against a *route path*
/// (`/api/users`) rather than a repo-relative file path, and scopes for that domain are written
/// `/api/users/*` to mean that route and anything under it.
/// `security_check_repo_phase5.rs::security_phase5_scope_filtering_and_blocking_are_engine_owned`
/// pins the behaviour and is the reason it exists.
///
/// It used to live inside `path_glob_matches`, which made the engine's general-purpose matcher
/// disagree with `matchesGlob` on `("/api/users/*", "/api/users")` — the two answer `true` and
/// `false`. Since phase4 and phase6 only ever hand it file paths, and a file path is never a
/// bare directory, no caller but this one wanted the widening. Moving it here leaves
/// `path_glob_matches` byte-for-byte equivalent to `matchesGlob`'s documented semantics, which
/// is what `glob_engine_parity_tests` and `packages/core/test/glob-parity.test.ts` assert, and
/// leaves phase5's behaviour unchanged.
fn phase5_scope_pattern_matches(pattern: &str, value: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix("/*")
        && value == prefix
    {
        return true;
    }
    path_glob_matches(pattern, value)
}

fn phase5_route_path_from_file(file_path: &str) -> Option<String> {
    next_api_route_identity(file_path).map(|identity| identity.route_path)
}

/// Path-glob matching for security-convention scopes, with globstar semantics.
///
/// **Third dead-path component of D1, and not one the audit named.** This was a pile of
/// suffix special-cases that never implemented `**/` as *zero or more* segments. The consequence
/// is stated verbatim in `packages/core/src/globs.ts`, which fixed the identical bug on the
/// TypeScript side and left this copy untouched:
///
/// > `**/pages/api/**/*.ts` never matched a handler sitting directly in `pages/api/`, at any
/// > depth.
///
/// Every scope the candidate proposer emits is `**/`-prefixed (`candidate_command.rs`'s
/// `route_scope`), and a repo whose routes sit at the root — the default `create-next-app`
/// layout — has zero leading segments for it to match. So `phase5_file_scope_matches` rejected
/// every file of every proposer-produced convention, and the check could not fire on any repo
/// even once its `source` provenance was correct. The three existing tests of the kind all
/// hand-write a scope without the `**/` prefix, so none of them could see it.
///
/// Semantics are `globs.ts`'s, so the two sides of the process boundary agree:
///   `**/`  zero or more complete path segments
///   `/**`  (trailing) the directory itself or anything beneath it
///   `**`   any run of characters, including `/`
///   `*`    any run of characters except `/`
///   `?`    exactly one character except `/`
///
/// Nothing else. This function carried one extra widening — a trailing `/*` also matching the
/// bare directory — which made it answer `true` where `matchesGlob` answers `false` on
/// `("/api/users/*", "/api/users")`, the only input on which the two engines were ever measured
/// to disagree. That widening belongs to phase5's route-path domain and now lives with it, in
/// `phase5_scope_pattern_matches`. `glob_engine_parity_tests` and
/// `packages/core/test/glob-parity.test.ts` hold this equivalence.
fn path_glob_matches(pattern: &str, file_path: &str) -> bool {
    glob_matches_from(pattern.as_bytes(), 0, file_path.as_bytes(), 0)
}

fn glob_matches_from(pattern: &[u8], mut pi: usize, path: &[u8], mut si: usize) -> bool {
    loop {
        if pi >= pattern.len() {
            return si >= path.len();
        }

        // `**/` — zero or more complete segments. The zero case is the whole bug.
        if pattern[pi..].starts_with(b"**/") {
            let rest = pi + 3;
            if glob_matches_from(pattern, rest, path, si) {
                return true;
            }
            for index in si..path.len() {
                if path[index] == b'/' && glob_matches_from(pattern, rest, path, index + 1) {
                    return true;
                }
            }
            return false;
        }

        // Trailing `/**` — this directory, or anything beneath it.
        if pi + 3 == pattern.len() && pattern[pi..] == *b"/**" {
            return si >= path.len() || path[si] == b'/';
        }

        // Bare `**` — any run of characters, separators included.
        if pattern[pi..].starts_with(b"**") {
            let rest = pi + 2;
            for index in si..=path.len() {
                if glob_matches_from(pattern, rest, path, index) {
                    return true;
                }
            }
            return false;
        }

        match pattern[pi] {
            b'*' => {
                let rest = pi + 1;
                let mut index = si;
                loop {
                    if glob_matches_from(pattern, rest, path, index) {
                        return true;
                    }
                    if index >= path.len() || path[index] == b'/' {
                        return false;
                    }
                    index += 1;
                }
            }
            b'?' => {
                if si >= path.len() || path[si] == b'/' {
                    return false;
                }
                pi += 1;
                si += 1;
            }
            literal => {
                if si >= path.len() || path[si] != literal {
                    return false;
                }
                pi += 1;
                si += 1;
            }
        }
    }
}

fn request_validation_missing_code(proof: &SecurityBoundaryProof) -> String {
    proof
        .parser_gaps
        .first()
        .map(|gap| gap.code.clone())
        .or_else(|| {
            proof
                .request_validation
                .unvalidated_uses
                .first()
                .map(|use_proof| use_proof.reason.clone())
        })
        .unwrap_or_else(|| "request_input_not_validated".to_string())
}

/// Reads the line out of a sink id.
///
/// Sink ids are `sink:{file}:{line}:{symbol}` (`security_control_flow.rs::sink_id`), NOT the
/// `...:{line}` shape every other id in this file uses (`security_proof.rs::fact_id`). Feeding one
/// to `input_line_from_fact_id` therefore parses the *symbol* as the line, fails, and yields 0 -
/// which `request_validation_finding_line` then filters away, so every request-validation finding
/// ever emitted reported line 1 regardless of where the unvalidated sink actually was. The line was
/// a default, not a measurement.
fn sink_line_from_sink_id(sink_fact_id: &str) -> usize {
    let mut segments = sink_fact_id.rsplit(':');
    segments.next();
    segments
        .next()
        .and_then(|line| line.parse::<usize>().ok())
        .unwrap_or(0)
}

fn request_validation_finding_line(proof: &SecurityBoundaryProof) -> Option<usize> {
    proof
        .request_validation
        .unvalidated_uses
        .first()
        .map(|use_proof| sink_line_from_sink_id(&use_proof.sink_fact_id))
        .filter(|line| *line > 0)
        // No input-fact fallback here, deliberately. One was added alongside the sink-id parser fix
        // and is removed again: `sink_line_from_sink_id` yields 0 only for an id with fewer than
        // two `:`-segments or a non-numeric line, and `security_control_flow.rs:745-747` emits
        // neither, so the arm was unreachable. Deleting it leaves the whole suite green — the
        // definition of a path no test can hold down, which is the shape this work exists to
        // remove rather than add.
        .or_else(|| {
            proof
                .parser_gaps
                .first()
                .and_then(|gap| gap.parser_gap_id.split(':').nth_back(1))
                .and_then(|line| line.parse::<usize>().ok())
        })
        .filter(|line| *line > 0)
}

fn input_line_from_fact_id(fact_id: &str) -> usize {
    fact_id
        .rsplit(':')
        .next()
        .and_then(|line| line.parse::<usize>().ok())
        .unwrap_or(0)
}

fn security_line_evidence_refs(
    route_id: &str,
    file_path: &str,
    capability: &str,
    role: &str,
    kind: &str,
    fact_ids: Vec<String>,
) -> Vec<serde_json::Value> {
    let mut refs = Vec::new();
    let mut seen = BTreeSet::new();
    for fact_id in fact_ids {
        if fact_id.is_empty() || !seen.insert(fact_id.clone()) {
            continue;
        }
        let line = input_line_from_fact_id(&fact_id);
        let mut evidence = serde_json::Map::new();
        evidence.insert(
            "evidence_id".to_string(),
            json!(format!("evidence:{route_id}:{fact_id}:{kind}")),
        );
        evidence.insert("fact_id".to_string(), json!(fact_id));
        evidence.insert("capability".to_string(), json!(capability));
        evidence.insert("kind".to_string(), json!(kind));
        evidence.insert("file_path".to_string(), json!(file_path));
        if line > 0 {
            evidence.insert("start_line".to_string(), json!(line));
            evidence.insert("end_line".to_string(), json!(line));
        }
        evidence.insert("role".to_string(), json!(role));
        refs.push(serde_json::Value::Object(evidence));
    }
    refs
}

fn phase4_missing_fact_ids(proof: &SecurityBoundaryProof) -> Vec<String> {
    proof
        .tenant
        .missing
        .iter()
        .map(|missing| missing.data_operation_fact_id.clone())
        .chain(
            proof
                .authorization
                .missing
                .iter()
                .filter_map(|missing| missing.sink_fact_id.clone()),
        )
        .chain(
            proof
                .session_trust
                .missing_trust
                .iter()
                .map(|missing| missing.fact_id.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn phase5_proof_json(
    proof: &SecurityBoundaryProof,
    route_id: &str,
    file_path: &str,
    handler_symbol: &str,
    convention: &crate::protocol::CheckConvention,
    finding_id: &str,
    missing_code: &str,
) -> serde_json::Value {
    let missing_codes = if proof.result.proof_status == SecurityProofStatus::Proven {
        Vec::new()
    } else {
        vec![missing_code.to_string()]
    };
    let missing_proof_ids = missing_codes
        .iter()
        .map(|code| format!("missing_proof:{route_id}:{code}"))
        .collect::<Vec<_>>();
    let parser_gap_ids = proof
        .parser_gaps
        .iter()
        .map(|gap| gap.parser_gap_id.clone())
        .collect::<Vec<_>>();
    let missing_fact_ids = proof
        .response_shape
        .sensitive_leaks
        .iter()
        .map(|leak| leak.field_fact_id.clone())
        .chain(
            proof
                .secret_exposure
                .exposed_secrets
                .iter()
                .map(|secret| secret.secret_fact_id.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let missing_proof = missing_codes
        .iter()
        .enumerate()
        .map(|(index, code)| {
            json!({
                "id": missing_proof_ids[index],
                "capability": if convention.kind == "api_route_forbids_sensitive_response_fields" {
                    "response_shape_facts"
                } else {
                    "secret_exposure"
                },
                "code": code,
                "blocks_enforcement": true,
                "fact_ids": missing_fact_ids.clone(),
                "graph_edge_ids": []
            })
        })
        .collect::<Vec<_>>();
    let evidence_refs = security_line_evidence_refs(
        route_id,
        file_path,
        if convention.kind == "api_route_forbids_sensitive_response_fields" {
            "response_shape_facts"
        } else {
            "secret_exposure"
        },
        "missing_proof",
        missing_code,
        missing_fact_ids.clone(),
    );
    let parser_gaps = proof
        .parser_gaps
        .iter()
        .map(|gap| {
            json!({
                "parser_gap_id": gap.parser_gap_id,
                "capability": if convention.kind == "api_route_forbids_sensitive_response_fields" {
                    "response_shape_facts"
                } else {
                    "secret_exposure"
                },
                "code": gap.code,
                "file_path": gap.file_path,
                "reason": gap.reason,
                "affected_contract_kinds": [convention.kind.clone()],
                "affected_route_ids": [route_id],
                "missing_proof_ids": missing_proof_ids.clone(),
                "blocks_enforcement": gap.blocks_enforcement
            })
        })
        .collect::<Vec<_>>();

    json!({
        "proof_id": format!("proof:{route_id}:phase5"),
        "proof_version": "security-boundary-proof/v1",
        "route": route_json(route_id, file_path, handler_symbol),
        "contracts": [{
            "contract_id": convention.id,
            "kind": convention.kind,
            "enforcement_mode": convention.enforcement_mode,
            "capability": convention.enforcement_capability,
            "matched": true
        }],
        "capability_status": [{
            "name": if convention.kind == "api_route_forbids_sensitive_response_fields" {
                "response_shape_facts"
            } else {
                "secret_exposure"
            },
            "status": if proof.result.proof_status == SecurityProofStatus::Proven { "complete" } else { "partial" },
            "can_block": true,
            "parser_gap_ids": parser_gap_ids,
            "missing_proof_ids": missing_proof_ids
        }],
        "auth": {
            "required": false,
            "proven": false,
            "proof_kind": "none",
            "trusted_guard_calls": [],
            "dominated_sinks": [],
            "undominated_sinks": []
        },
        "response_shape": {
            "required": proof.response_shape.required,
            "proven": proof.response_shape.proven,
            "sensitive_leaks": proof.response_shape.sensitive_leaks.iter().map(|leak| json!({
                "field_fact_id": leak.field_fact_id,
                "field_path": leak.field_path,
                "reason": leak.reason
            })).collect::<Vec<_>>()
        },
        "sinks": {
            "secrets": proof.secret_exposure.exposed_secrets.iter().map(|secret| json!({
                "secret_fact_id": secret.secret_fact_id,
                "secret_class": secret.secret_class,
                "sink_kind": secret.sink_kind,
                "sink_line": secret.sink_line,
                "reason": secret.reason
            })).collect::<Vec<_>>()
        },
        "missing_proof": missing_proof,
        "parser_gaps": parser_gaps,
        "evidence_refs": evidence_refs,
        "result": {
            "proof_status": security_proof_status(&proof.result.proof_status),
            "enforcement_result": if proof.result.proof_status == SecurityProofStatus::Proven {
                "pass"
            } else {
                convention.enforcement_mode.as_str()
            },
            "can_block": proof.result.proof_status != SecurityProofStatus::Proven,
            "finding_ids": if proof.result.proof_status == SecurityProofStatus::Proven {
                Vec::<String>::new()
            } else {
                vec![finding_id.to_string()]
            }
        }
    })
}

fn route_security_proof_json(
    proof: &RouteSecurityBoundaryProof,
    convention: &crate::protocol::CheckConvention,
    finding_id: &str,
) -> serde_json::Value {
    let missing_proof_ids = if proof.result.proof_status == SecurityProofStatus::Proven {
        Vec::new()
    } else {
        proof
            .missing_proof_codes
            .iter()
            .map(|code| format!("missing_proof:{}:{code}", proof.route_id))
            .collect::<Vec<_>>()
    };
    let parser_gap_ids = proof
        .parser_gaps
        .iter()
        .map(|gap| gap.parser_gap_id.clone())
        .collect::<Vec<_>>();
    let parser_gaps = proof
        .parser_gaps
        .iter()
        .map(|gap| {
            json!({
                "parser_gap_id": gap.parser_gap_id,
                "capability": "control_flow_guard_dominance",
                "code": gap.code,
                "file_path": gap.file_path,
                "reason": gap.reason,
                "affected_contract_kinds": ["api_route_requires_auth_helper"],
                "affected_route_ids": [proof.route_id.clone()],
                "missing_proof_ids": missing_proof_ids,
                "blocks_enforcement": gap.blocks_enforcement
            })
        })
        .collect::<Vec<_>>();
    let mut undominated_fact_ids = proof
        .undominated_sinks
        .iter()
        .flat_map(|sink| sink.fact_ids.iter().cloned())
        .collect::<Vec<_>>();
    undominated_fact_ids.sort();
    undominated_fact_ids.dedup();
    let missing_proof = proof
        .missing_proof_codes
        .iter()
        .enumerate()
        .map(|(index, code)| {
            json!({
                "id": missing_proof_ids[index],
                "capability": "control_flow_guard_dominance",
                "code": code,
                "blocks_enforcement": true,
                "fact_ids": undominated_fact_ids.clone(),
                "graph_edge_ids": []
            })
        })
        .collect::<Vec<_>>();
    let evidence_refs = security_line_evidence_refs(
        &proof.route_id,
        &proof.file_path,
        "control_flow_guard_dominance",
        if proof.auth.proven {
            "guard"
        } else {
            "missing_proof"
        },
        "auth_boundary",
        proof
            .trusted_guard_calls
            .iter()
            .map(|guard| guard.fact_id.clone())
            .chain(undominated_fact_ids.clone())
            .collect(),
    );

    json!({
        "proof_id": format!("proof:{}:auth", proof.route_id),
        "proof_version": "security-boundary-proof/v1",
        "route": route_json(&proof.route_id, &proof.file_path, &proof.handler_symbol),
        "contracts": [{
            "contract_id": convention.id,
            "kind": "api_route_requires_auth_helper",
            "enforcement_mode": convention.enforcement_mode,
            "capability": convention.enforcement_capability,
            "matched": true
        }],
        "capability_status": [{
            "name": "control_flow_guard_dominance",
            "status": "partial",
            "can_block": true,
            "parser_gap_ids": parser_gap_ids,
            "missing_proof_ids": missing_proof_ids
        }],
        "auth": {
            "required": proof.auth.required,
            "proven": proof.auth.proven,
            "proof_kind": if proof.auth.proven { "handler_guard" } else { "none" },
            "trusted_guard_calls": proof.trusted_guard_calls.iter().map(|guard| json!({
                "fact_id": guard.fact_id,
                "guard_id": guard.guard_id,
                "symbol": guard.symbol,
                "start_line": guard.start_line,
                "end_line": guard.end_line
            })).collect::<Vec<_>>(),
            "dominated_sinks": proof.auth.dominated_sinks.iter().map(|sink| json!({
                "sink_id": sink.sink_id,
                "sink_kind": sink.sink_kind,
                "edge_id": sink.edge_id
            })).collect::<Vec<_>>(),
            "undominated_sinks": proof.undominated_sinks.iter().map(|sink| json!({
                "sink_id": sink.sink_id,
                "sink_kind": sink.sink_kind,
                "reason": sink.reason,
                "fact_ids": sink.fact_ids
            })).collect::<Vec<_>>()
        },
        "missing_proof": missing_proof,
        "parser_gaps": parser_gaps,
        "evidence_refs": evidence_refs,
        "result": {
            "proof_status": security_proof_status(&proof.result.proof_status),
            "enforcement_result": if proof.result.proof_status == SecurityProofStatus::Proven {
                "pass"
            } else {
                convention.enforcement_mode.as_str()
            },
            "can_block": proof.result.proof_status != SecurityProofStatus::Proven,
            "finding_ids": if proof.result.proof_status == SecurityProofStatus::Proven {
                Vec::<String>::new()
            } else {
                vec![finding_id.to_string()]
            }
        }
    })
}

fn request_validation_proof_json(
    proof: &SecurityBoundaryProof,
    route_id: &str,
    file_path: &str,
    handler_symbol: &str,
    convention: &crate::protocol::CheckConvention,
    finding_id: &str,
) -> serde_json::Value {
    let missing_codes = if proof.result.proof_status == SecurityProofStatus::Proven {
        Vec::new()
    } else if !proof.request_validation.unvalidated_uses.is_empty() {
        proof
            .request_validation
            .unvalidated_uses
            .iter()
            .map(|use_proof| use_proof.reason.clone())
            .collect::<Vec<_>>()
    } else {
        vec![request_validation_missing_code(proof)]
    };
    let missing_proof_ids = missing_codes
        .iter()
        .map(|code| format!("missing_proof:{route_id}:{code}"))
        .collect::<Vec<_>>();
    let parser_gap_ids = proof
        .parser_gaps
        .iter()
        .map(|gap| gap.parser_gap_id.clone())
        .collect::<Vec<_>>();
    let missing_fact_ids = proof
        .request_validation
        .unvalidated_uses
        .iter()
        .flat_map(|use_proof| {
            [
                use_proof.input_fact_id.clone(),
                use_proof.sink_fact_id.clone(),
            ]
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let missing_proof = missing_codes
        .iter()
        .enumerate()
        .map(|(index, code)| {
            json!({
                "id": missing_proof_ids[index],
                "capability": "request_validation_facts",
                "code": code,
                "blocks_enforcement": true,
                "fact_ids": missing_fact_ids.clone(),
                "graph_edge_ids": []
            })
        })
        .collect::<Vec<_>>();
    let parser_gaps = proof
        .parser_gaps
        .iter()
        .map(|gap| {
            json!({
                "parser_gap_id": gap.parser_gap_id,
                "capability": "request_validation_facts",
                "code": gap.code,
                "file_path": gap.file_path,
                "reason": gap.reason,
                "affected_contract_kinds": ["api_route_requires_request_validation"],
                "affected_route_ids": [route_id],
                "missing_proof_ids": missing_proof_ids.clone(),
                "blocks_enforcement": gap.blocks_enforcement
            })
        })
        .collect::<Vec<_>>();
    let validations = proof
        .request_validation
        .validations
        .iter()
        .map(|validation| {
            let mut object = serde_json::Map::new();
            object.insert("fact_id".to_string(), json!(validation.fact_id));
            object.insert(
                "validator_symbol".to_string(),
                json!(validation.validator_symbol),
            );
            if let Some(schema_symbol) = &validation.schema_symbol {
                object.insert("schema_symbol".to_string(), json!(schema_symbol));
            }
            if let Some(input_var) = &validation.input_var {
                object.insert("input_var".to_string(), json!(input_var));
            }
            if let Some(result_var) = &validation.result_var {
                object.insert("result_var".to_string(), json!(result_var));
            }
            serde_json::Value::Object(object)
        })
        .collect::<Vec<_>>();
    let evidence_refs = security_line_evidence_refs(
        route_id,
        file_path,
        "request_validation_facts",
        if proof.request_validation.proven {
            "validator"
        } else {
            "missing_proof"
        },
        "request_validation_boundary",
        proof
            .request_validation
            .input_reads
            .iter()
            .map(|input| input.fact_id.clone())
            .chain(
                proof
                    .request_validation
                    .validations
                    .iter()
                    .map(|validation| validation.fact_id.clone()),
            )
            .chain(
                proof
                    .request_validation
                    .validated_uses
                    .iter()
                    .map(|use_proof| use_proof.fact_id.clone()),
            )
            .chain(missing_fact_ids.clone())
            .collect(),
    );

    json!({
        "proof_id": format!("proof:{route_id}:request_validation"),
        "proof_version": "security-boundary-proof/v1",
        "route": route_json(route_id, file_path, handler_symbol),
        "contracts": [{
            "contract_id": convention.id,
            "kind": "api_route_requires_request_validation",
            "enforcement_mode": convention.enforcement_mode,
            "capability": convention.enforcement_capability,
            "matched": true
        }],
        "capability_status": [{
            "name": "request_validation_facts",
            "status": if proof.result.proof_status == SecurityProofStatus::Proven { "complete" } else { "partial" },
            "can_block": true,
            "parser_gap_ids": parser_gap_ids,
            "missing_proof_ids": missing_proof_ids
        }],
        "auth": {
            "required": false,
            "proven": false,
            "proof_kind": "none",
            "trusted_guard_calls": [],
            "dominated_sinks": [],
            "undominated_sinks": []
        },
        "request_validation": {
            "required": proof.request_validation.required,
            "proven": proof.request_validation.proven,
            "input_reads": proof.request_validation.input_reads.iter().map(|input| {
                let mut object = serde_json::Map::new();
                object.insert("fact_id".to_string(), json!(input.fact_id));
                object.insert("source".to_string(), json!(input.source));
                object.insert("variable".to_string(), json!(input.variable));
                if let Some(key) = &input.key {
                    object.insert("key".to_string(), json!(key));
                }
                serde_json::Value::Object(object)
            }).collect::<Vec<_>>(),
            "validations": validations,
            "validated_uses": proof.request_validation.validated_uses.iter().map(|use_proof| json!({
                "fact_id": use_proof.fact_id,
                "source_input_var": use_proof.source_input_var,
                "validated_var": use_proof.validated_var,
                "sink_fact_id": use_proof.sink_fact_id,
                "sink_kind": use_proof.sink_kind
            })).collect::<Vec<_>>(),
            "unvalidated_uses": proof.request_validation.unvalidated_uses.iter().map(|use_proof| json!({
                "input_fact_id": use_proof.input_fact_id,
                "sink_fact_id": use_proof.sink_fact_id,
                "sink_kind": use_proof.sink_kind,
                "reason": use_proof.reason
            })).collect::<Vec<_>>()
        },
        "missing_proof": missing_proof,
        "parser_gaps": parser_gaps,
        "evidence_refs": evidence_refs,
        "result": {
            "proof_status": security_proof_status(&proof.result.proof_status),
            "enforcement_result": if proof.result.proof_status == SecurityProofStatus::Proven {
                "pass"
            } else {
                convention.enforcement_mode.as_str()
            },
            "can_block": proof.result.proof_status != SecurityProofStatus::Proven,
            "finding_ids": if proof.result.proof_status == SecurityProofStatus::Proven {
                Vec::<String>::new()
            } else {
                vec![finding_id.to_string()]
            }
        }
    })
}

fn phase4_missing_code(proof: &SecurityBoundaryProof, convention_kind: &str) -> String {
    match convention_kind {
        "api_route_requires_tenant_scope" => proof
            .tenant
            .missing
            .first()
            .map(|missing| missing.reason.clone())
            .unwrap_or_else(|| "tenant_predicate_missing".to_string()),
        "api_route_requires_authorization" => proof
            .authorization
            .missing
            .first()
            .map(|missing| missing.reason.clone())
            .unwrap_or_else(|| "authorization_guard_missing".to_string()),
        "session_object_must_come_from_trusted_helper" => proof
            .session_trust
            .missing_trust
            .first()
            .map(|missing| {
                if missing.reason == "derived_from_request" {
                    "session_not_trusted".to_string()
                } else {
                    missing.reason.clone()
                }
            })
            .unwrap_or_else(|| "session_not_trusted".to_string()),
        _ => "missing_proof".to_string(),
    }
}

fn phase4_finding_line(proof: &SecurityBoundaryProof) -> Option<usize> {
    proof
        .tenant
        .missing
        .first()
        .and_then(|missing| missing.data_operation_fact_id.rsplit(':').next())
        .and_then(|line| line.parse::<usize>().ok())
        .or_else(|| {
            proof
                .authorization
                .missing
                .first()
                .and_then(|missing| missing.sink_fact_id.as_deref())
                .and_then(|sink_id| sink_id.rsplit(':').next())
                .and_then(|line| line.parse::<usize>().ok())
        })
        .or_else(|| {
            proof
                .session_trust
                .missing_trust
                .first()
                .and_then(|missing| missing.fact_id.rsplit(':').next())
                .and_then(|line| line.parse::<usize>().ok())
        })
}

fn phase4_finding_title(kind: &str) -> &'static str {
    match kind {
        "api_route_requires_tenant_scope" => "API route missing required tenant scope proof",
        "api_route_requires_authorization" => "API route missing required authorization proof",
        "session_object_must_come_from_trusted_helper" => "API route uses untrusted session object",
        _ => "API route missing required security proof",
    }
}

fn phase4_expected_layer(kind: &str) -> &'static str {
    match kind {
        "api_route_requires_tenant_scope" => "tenant_scope",
        "api_route_requires_authorization" => "authorization",
        "session_object_must_come_from_trusted_helper" => "session_trust",
        _ => "security_boundary",
    }
}

fn phase4_proof_json(
    proof: &SecurityBoundaryProof,
    route_id: &str,
    file_path: &str,
    handler_symbol: &str,
    convention: &crate::protocol::CheckConvention,
    finding_id: &str,
) -> serde_json::Value {
    let missing_code = phase4_missing_code(proof, &convention.kind);
    let missing_proof_ids = if proof.result.proof_status == SecurityProofStatus::Proven {
        Vec::new()
    } else {
        vec![format!("missing_proof:{route_id}:{missing_code}")]
    };
    let parser_gap_ids = proof
        .parser_gaps
        .iter()
        .map(|gap| gap.parser_gap_id.clone())
        .collect::<Vec<_>>();
    let parser_gaps = proof
        .parser_gaps
        .iter()
        .map(|gap| {
            json!({
                "parser_gap_id": gap.parser_gap_id,
                "capability": phase4_expected_layer(&convention.kind),
                "code": gap.code,
                "file_path": gap.file_path,
                "reason": gap.reason,
                "affected_contract_kinds": [convention.kind.clone()],
                "affected_route_ids": [route_id],
                "missing_proof_ids": missing_proof_ids.clone(),
                "blocks_enforcement": gap.blocks_enforcement
            })
        })
        .collect::<Vec<_>>();
    let missing_fact_ids = phase4_missing_fact_ids(proof);
    let missing_proof = missing_proof_ids
        .iter()
        .map(|id| {
            json!({
                "id": id,
                "capability": phase4_expected_layer(&convention.kind),
                "code": missing_code,
                "blocks_enforcement": true,
                "fact_ids": missing_fact_ids.clone(),
                "graph_edge_ids": []
            })
        })
        .collect::<Vec<_>>();
    let evidence_refs = security_line_evidence_refs(
        route_id,
        file_path,
        phase4_expected_layer(&convention.kind),
        if proof.result.proof_status == SecurityProofStatus::Proven {
            "guard"
        } else {
            "missing_proof"
        },
        &missing_code,
        proof
            .session_trust
            .trusted_sessions
            .iter()
            .map(|session| session.fact_id.clone())
            .chain(
                proof
                    .authorization
                    .role_or_policy_guards
                    .iter()
                    .map(|guard| guard.fact_id.clone()),
            )
            .chain(
                proof
                    .tenant
                    .tenant_sources
                    .iter()
                    .map(|source| source.fact_id.clone()),
            )
            .chain(
                proof
                    .tenant
                    .predicates
                    .iter()
                    .map(|predicate| predicate.fact_id.clone()),
            )
            .chain(missing_fact_ids.clone())
            .collect(),
    );

    json!({
        "proof_id": format!("proof:{route_id}:phase4"),
        "proof_version": "security-boundary-proof/v1",
        "route": route_json(route_id, file_path, handler_symbol),
        "contracts": [{
            "contract_id": convention.id,
            "kind": convention.kind,
            "enforcement_mode": convention.enforcement_mode,
            "capability": convention.enforcement_capability,
            "matched": true
        }],
        "capability_status": [{
            "name": phase4_expected_layer(&convention.kind),
            "status": if proof.result.proof_status == SecurityProofStatus::Proven { "complete" } else { "partial" },
            "can_block": true,
            "parser_gap_ids": parser_gap_ids,
            "missing_proof_ids": missing_proof_ids
        }],
        "auth": {
            "required": false,
            "proven": false,
            "proof_kind": "none",
            "trusted_guard_calls": [],
            "dominated_sinks": [],
            "undominated_sinks": []
        },
        "session_trust": {
            "required": proof.session_trust.required,
            "proven": proof.session_trust.proven,
            "trusted_sessions": proof.session_trust.trusted_sessions.iter().map(|session| json!({
                "fact_id": session.fact_id,
                "variable": session.variable,
                "trust": session.trust,
                "source": session.derived_from
            })).collect::<Vec<_>>(),
            "missing_trust": proof.session_trust.missing_trust.iter().map(|missing| json!({
                "fact_id": missing.fact_id,
                "variable": missing.variable,
                "reason": missing.reason
            })).collect::<Vec<_>>()
        },
        "authorization": {
            "required": proof.authorization.required,
            "proven": proof.authorization.proven,
            "role_or_policy_guards": proof.authorization.role_or_policy_guards.iter().map(|guard| {
                let mut object = serde_json::Map::new();
                object.insert("fact_id".to_string(), json!(guard.fact_id));
                object.insert("roles".to_string(), json!(guard.roles));
                object.insert("permissions".to_string(), json!(guard.permissions));
                if let Some(policy_id) = &guard.policy_id {
                    object.insert("policy_id".to_string(), json!(policy_id));
                }
                if let Some(resource_var) = &guard.resource_var {
                    object.insert("resource_var".to_string(), json!(resource_var));
                }
                if let Some(subject_var) = &guard.subject_var {
                    object.insert("subject_var".to_string(), json!(subject_var));
                }
                serde_json::Value::Object(object)
            }).collect::<Vec<_>>(),
            "missing": proof.authorization.missing.iter().map(|missing| json!({
                "reason": missing.reason,
                "sink_fact_id": missing.sink_fact_id
            })).collect::<Vec<_>>()
        },
        "tenant": {
            "required": proof.tenant.required,
            "proven": proof.tenant.proven,
            "tenant_sources": proof.tenant.tenant_sources.iter().map(|source| json!({
                "fact_id": source.fact_id,
                "source": source.source,
                "key": source.key,
                "trusted": source.trusted
            })).collect::<Vec<_>>(),
            "predicates": proof.tenant.predicates.iter().map(|predicate| json!({
                "fact_id": predicate.fact_id,
                "data_operation_fact_id": predicate.data_operation_fact_id,
                "tenant_key": predicate.tenant_key,
                "predicate_kind": predicate.predicate_kind
            })).collect::<Vec<_>>(),
            "missing": proof.tenant.missing.iter().map(|missing| json!({
                "data_operation_fact_id": missing.data_operation_fact_id,
                "reason": missing.reason
            })).collect::<Vec<_>>()
        },
        "missing_proof": missing_proof,
        "parser_gaps": parser_gaps,
        "evidence_refs": evidence_refs,
        "result": {
            "proof_status": security_proof_status(&proof.result.proof_status),
            "enforcement_result": if proof.result.proof_status == SecurityProofStatus::Proven {
                "pass"
            } else {
                convention.enforcement_mode.as_str()
            },
            "can_block": proof.result.proof_status != SecurityProofStatus::Proven,
            "finding_ids": if proof.result.proof_status == SecurityProofStatus::Proven {
                Vec::<String>::new()
            } else {
                vec![finding_id.to_string()]
            }
        }
    })
}

fn security_proof_status(status: &SecurityProofStatus) -> &'static str {
    match status {
        SecurityProofStatus::Proven => "proven",
        SecurityProofStatus::MissingProof => "missing_proof",
        SecurityProofStatus::ParserGap => "parser_gap",
    }
}

fn route_endpoint(file_path: &str, handler_symbol: &str) -> serde_json::Value {
    let Some(identity) = next_api_route_identity(file_path) else {
        return json!({ "method": handler_symbol });
    };
    json!({
        "path": identity.route_path,
        "method": handler_symbol,
        "framework": identity.framework
    })
}

fn route_json(route_id: &str, file_path: &str, handler_symbol: &str) -> serde_json::Value {
    let mut route = serde_json::Map::new();
    route.insert("route_id".to_string(), json!(route_id));
    if let Some(entrypoint_id) = normalized_entrypoint_id(file_path, handler_symbol) {
        route.insert("normalized_entrypoint_id".to_string(), json!(entrypoint_id));
    }
    route.insert("file_path".to_string(), json!(file_path));
    route.insert("file_role".to_string(), json!("api_route"));
    route.insert(
        "endpoint".to_string(),
        route_endpoint(file_path, handler_symbol),
    );
    route.insert("handler_symbol".to_string(), json!(handler_symbol));
    serde_json::Value::Object(route)
}

fn normalized_entrypoint_id(file_path: &str, handler_symbol: &str) -> Option<String> {
    next_api_route_identity(file_path).map(|identity| {
        let framework = if identity.framework == "next_pages_api" {
            "next_pages"
        } else {
            "next_app"
        };
        format!(
            "entrypoint:{framework}:{}:{handler_symbol}",
            identity.file_path
        )
    })
}

fn security_auth_files(
    facts: &[Fact],
    parsed_diff: &ParsedDiff,
    diff_scope: DiffScope,
) -> BTreeSet<String> {
    let api_route_files = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route")
        .map(|fact| fact.file_path.clone())
        .collect::<BTreeSet<_>>();
    if matches!(diff_scope, DiffScope::Full) {
        return api_route_files;
    }
    let changed_files = parsed_diff
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<BTreeSet<_>>();
    api_route_files
        .into_iter()
        .filter(|file| changed_files.contains(file))
        .collect()
}

/// The wire spelling of a dispatch target, for the receipt.
///
/// Hand-written rather than generated because `ConventionDispatch` carries no `as_wire` - and
/// exhaustive, so a target added to vocabulary/vocabulary.json fails this match rather than
/// serialising as something plausible. The strings are the manifest's own `dispatch` values.
fn dispatch_wire(dispatch: ConventionDispatch) -> &'static str {
    match dispatch {
        ConventionDispatch::EngineDirect => "engine_direct",
        ConventionDispatch::EnginePhase6 => "engine_phase6",
        ConventionDispatch::Cli => "cli",
        ConventionDispatch::None => "none",
    }
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
        .filter(|node| node.kind == GraphNodeKind::Module)
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
        .filter(|edge| edge.kind == GraphEdgeKind::ModuleImportsModule)
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
                &stable_hash(&format!("{route_file}:{data_file}"))[..16]
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
            symbol: PendingFinding::no_symbol(),
            legacy_fingerprints: Vec::new(),
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
        .filter(|edge| edge.kind == GraphEdgeKind::FileHasRole)
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
        .filter(|edge| edge.kind == GraphEdgeKind::FileHasRole)
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
    forbidden_module_paths: &BTreeSet<&str>,
) -> bool {
    // Resolved identity is the reliable signal. The `resolved_path == forbidden` comparison below
    // pits a file path against a specifier and can only match when the forbidden entry is itself
    // a path, which is why the relative-import and barrel bypasses survived.
    if forbidden_module_paths.contains(resolved_path) {
        return true;
    }
    let import_source = string_metadata(import_node, "source").unwrap_or("");
    if is_forbidden_import_source(import_source, forbidden_imports) {
        return true;
    }
    forbidden_imports
        .iter()
        .any(|forbidden| path_is_forbidden_module(resolved_path, forbidden))
}

/// Does this resolved file path name the forbidden module?
///
/// A forbidden entry written as a path is usually extensionless - `src/lib/db` for the file
/// `src/lib/db.ts`, or for `src/lib/db/index.ts` - so equality alone is not enough and the code
/// here used a bare `contains` to bridge the gap. That let the entry match anything it was merely
/// a prefix of: `src/lib/db` accepted `src/lib/db-legacy.ts` and `src/lib/dbutils.ts`, flagging
/// routes that import neither the data layer nor anything that re-exports it.
///
/// The boundary is what distinguishes them. `src/lib/db` continues into the real module at `.` (an
/// extension) or `/` (a directory), and into a lookalike at an ordinary name character. This is the
/// same reasoning as `rules::is_forbidden_import`, which cannot simply be reused because a
/// specifier must NOT break on `.`: `@/lib/db` and `@/lib/db.server` are different modules.
fn path_is_forbidden_module(resolved_path: &str, forbidden: &str) -> bool {
    resolved_path == forbidden
        || resolved_path
            .strip_prefix(forbidden)
            .is_some_and(|rest| rest.starts_with('/') || rest.starts_with('.'))
}

fn forbidden_graph_import_target<'a>(
    resolved_module_id: &'a str,
    import_node: &GraphNode,
    resolved_path: &'a str,
    edges: &'a [GraphEdge],
    module_files: &BTreeMap<&'a str, &'a str>,
    forbidden_imports: &[String],
    forbidden_module_paths: &BTreeSet<&str>,
) -> Option<(&'a str, &'a str, Vec<String>)> {
    if is_forbidden_graph_import(
        import_node,
        resolved_path,
        forbidden_imports,
        forbidden_module_paths,
    ) {
        return Some((resolved_module_id, resolved_path, Vec::new()));
    }
    let mut visited = BTreeSet::new();
    let mut queue = vec![(resolved_module_id, Vec::<String>::new())];
    while let Some((module_id, chain)) = queue.pop() {
        if !visited.insert(module_id) {
            continue;
        }
        for edge in edges.iter().filter(|edge| {
            edge.kind == GraphEdgeKind::ModuleReexportsModule && edge.from == module_id
        }) {
            let Some(target_path) = module_files.get(edge.to.as_str()).copied() else {
                continue;
            };
            let mut next_chain = chain.clone();
            next_chain.push(edge.from.clone());
            next_chain.push(edge.to.clone());
            // Identity first: a re-export chain ending at the forbidden module's own file is a
            // violation however the intermediate modules are named. Specifier comparison stays as
            // the fallback for bare package names that resolve to no local file.
            if forbidden_module_paths.contains(target_path)
                || forbidden_imports
                    .iter()
                    .any(|forbidden| path_is_forbidden_module(target_path, forbidden))
            {
                return Some((edge.to.as_str(), target_path, next_chain));
            }
            queue.push((edge.to.as_str(), next_chain));
        }
    }
    None
}

/// One predicate for "is this specifier a forbidden one", shared with the direct rule.
///
/// This used to be a second, laxer copy: `import_source.contains(forbidden)`. T100 fixed the
/// direct rule's copy (`rules::is_forbidden_import`) to require a path-segment boundary and left
/// this one alone, so the two disagreed - and the graph loop uses this one as a *skip*-filter, on
/// the reasoning that a direct specifier match is the direct rule's job. `@/lib/db-legacy`
/// substring-matched here and got skipped, while the direct rule correctly declined to match it,
/// so a barrel re-exporting the real data layer was examined by neither path.
///
/// It is also the derivation filter for `forbidden_module_paths` a few lines up, where the same
/// laxity ran the other way: a lookalike's resolved file was recorded as if it were the forbidden
/// module, which is the false positive the comment there claims cannot happen. Both directions
/// close by deleting the copy.
fn is_forbidden_import_source(import_source: &str, forbidden_imports: &[String]) -> bool {
    drift_engine::is_forbidden_import(import_source, forbidden_imports)
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

fn classify_pending_findings_against_baseline(
    findings: &[PendingFinding],
    baseline: &[BaselineViolation],
) -> BTreeMap<String, FindingStatus> {
    let active_baseline = baseline
        .iter()
        .filter(|violation| violation.status == BaselineStatus::Active)
        .map(|violation| {
            (
                violation.convention_id.as_str(),
                violation.fingerprint.as_str(),
            )
        })
        .collect::<BTreeSet<_>>();

    findings
        .iter()
        .map(|finding| {
            let matched = active_baseline
                .contains(&(finding.convention_id.as_str(), finding.fingerprint.as_str()))
                || finding.legacy_fingerprints.iter().any(|fingerprint| {
                    active_baseline
                        .contains(&(finding.convention_id.as_str(), fingerprint.as_str()))
                });
            (
                finding.fingerprint.clone(),
                if matched {
                    FindingStatus::PreExisting
                } else {
                    FindingStatus::New
                },
            )
        })
        .collect()
}

fn stable_hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn legacy_direct_data_access_fingerprint(
    convention_id: &str,
    file_path: &str,
    import_name: &str,
    import_source: &str,
) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"direct-data-access-v1\0");
    hasher.update(convention_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(file_path.replace('\\', "/").as_bytes());
    hasher.update(b"\0");
    hasher.update(import_name.as_bytes());
    hasher.update(b"\0");
    hasher.update(import_source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn check_fact_to_engine_fact(fact: CheckFact) -> Option<Fact> {
    Some(Fact {
        // D-F1: the whole vocabulary, from the generated table.
        //
        // This was a hand-written match that named 30 of the 36 fact kinds. The six it omitted -
        // cors_policy_declared, csrf_guard_called, outbound_request_called, parameterized_sql_used,
        // rate_limit_guard_called, raw_sql_called - fell through a `_ => None` arm and were dropped
        // by the `filter_map` at the call site, silently. Four of them (all but the two csrf/
        // rate-limit kinds, which nothing emits yet) are produced by security_facts.rs, survive the
        // scan, the schema and storage, and then vanished on the way into the rule evaluator.
        //
        // It went unnoticed because `security_phase6_findings_and_proofs` re-reads the route file
        // from disk and re-extracts, so the facts came back by another route. That mask holds only
        // while `repo_root` is present, and the wire protocol declares it `Option<String>`
        // (`CheckRepoContext`). engine-check.ts always sets it; any other caller that does not gets
        // zero findings for all five Phase 6 conventions with nothing reporting a gap.
        //
        // `from_wire` is generated from the same manifest as the enum, so the two cannot come apart
        // again: a new variant with no wire mapping is not a missing arm, it is a file that does not
        // exist until the generator runs.
        kind: FactKind::from_wire(&fact.kind)?,
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        imported_name: fact.imported_name,
        runtime_use: fact.runtime_use,
        start_line: fact.start_line,
        end_line: fact.end_line,
        start_column: fact.start_column,
        end_column: fact.end_column,
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

#[cfg(test)]
mod path_glob_boundary_tests {
    use super::{path_glob_matches, phase5_scope_pattern_matches};

    /// The globstar port (TDD §5.1, discovered during D1).
    ///
    /// The previous matcher was a pile of prefix/suffix special cases that never implemented
    /// `**/` as *zero or more* segments. `packages/core/src/globs.ts:13-14` documents the
    /// identical bug, fixed on the TypeScript side and never ported here; a comment at
    /// `presence_file_in_scope` recorded it as still live and deliberately did not change it.
    ///
    /// The zero-segment rows are the whole defect: every scope the candidate proposer emits is
    /// `**/`-prefixed, and a repo whose routes sit at the root — the default create-next-app
    /// layout — has no leading segments to consume. Both the app-router and pages-router forms
    /// failed, so no proposer-produced convention of an affected kind could match any file.
    #[test]
    fn globstar_prefixes_match_zero_leading_segments() {
        // The exact patterns `candidate_command.rs`'s `route_scope` emits.
        for (pattern, path) in [
            ("**/app/api/**/route.ts", "app/api/users/route.ts"),
            ("**/app/api/**/route.ts", "app/api/route.ts"),
            ("**/pages/api/**/*.ts", "pages/api/route-leak.ts"),
            ("**/pages/api/**/*.ts", "pages/api/nested/handler.ts"),
        ] {
            assert!(
                path_glob_matches(pattern, path),
                "{pattern} must match root-level {path} — `**/` is zero or more segments"
            );
        }

        // And still match when the leading segments are actually there (a monorepo mount).
        for (pattern, path) in [
            ("**/app/api/**/route.ts", "apps/web/app/api/users/route.ts"),
            ("**/pages/api/**/*.ts", "apps/web/pages/api/handler.ts"),
        ] {
            assert!(path_glob_matches(pattern, path), "{pattern} vs {path}");
        }
    }

    #[test]
    fn globstar_patterns_still_reject_what_they_should() {
        for (pattern, path) in [
            ("**/app/api/**/route.ts", "app/api/users/handler.ts"),
            ("**/pages/api/**/*.ts", "pages/app/handler.ts"),
            // `*` does not cross a separator.
            ("app/api/*/route.ts", "app/api/a/b/route.ts"),
            // The old matcher answered true here: it reduced this to
            // `starts_with("app/api") && ends_with("/route.ts")`, so a sibling directory whose
            // name merely began with "api" matched. Tightening, and worth pinning.
            ("app/api/**/route.ts", "app/apixyz/route.ts"),
        ] {
            assert!(
                !path_glob_matches(pattern, path),
                "{pattern} must not match {path}"
            );
        }
    }

    /// A trailing `/*` also matches the directory itself, because `phase5_file_scope_matches`
    /// tests these patterns against a *route path* and scopes are written as `/api/users/*` to
    /// mean that route and anything under it. Strict globstar would drop the bare-directory
    /// case, which
    /// `security_check_repo_phase5.rs::security_phase5_scope_filtering_and_blocking_are_engine_owned`
    /// pins — it went red without this and is the reason the widening exists.
    ///
    /// Same three assertions as before, moved off `path_glob_matches` and onto the function
    /// that now owns the widening. `path_glob_matches` used to carry it, which made it the one
    /// input where the engine's matcher and `matchesGlob` disagreed; the row below pins that
    /// they no longer do.
    #[test]
    fn a_trailing_star_still_matches_the_directory_itself() {
        assert!(phase5_scope_pattern_matches("/api/users/*", "/api/users"));
        assert!(phase5_scope_pattern_matches(
            "/api/users/*",
            "/api/users/detail"
        ));
        assert!(!phase5_scope_pattern_matches("/api/users/*", "/api/admin"));

        // And the general-purpose matcher is now strictly globstar, exactly as
        // `matchesGlob("/api/users", "/api/users/*")` answers on the TypeScript side.
        assert!(!path_glob_matches("/api/users/*", "/api/users"));
        assert!(path_glob_matches("/api/users/*", "/api/users/detail"));
    }
}

/// Cross-process parity for the two glob engines.
///
/// Drift has two of them, on opposite sides of the CLI/engine process boundary:
/// `matchesGlob` in `packages/core/src/globs.ts`, and `path_glob_matches` above. They have no
/// shared code and cannot have any, so the only thing holding them together is a differential.
/// They have disagreed before — `globs.ts` fixed the zero-segment `**/` bug and the Rust copy
/// was left as a prefix shim for as long as it took someone to notice.
///
/// The comparison is deliberately between the two GLOB ENGINES and nothing else. The obvious
/// alternative — run `conventionScopeFiles` against the engine's scope narrowing — is not a
/// glob comparison at all. `convention-scope.ts:34-48` gates every api-route convention on
/// `isNextApiRoutePath` first, and `:45-47` then short-circuits the *default* api-route glob
/// set (`API_ROUTE_SCOPE_GLOBS`, the D-H2 eight) out of the comparison entirely, answering from
/// that role check alone. A scope comparison run through it measures a role predicate rather
/// than a matcher, and would agree for the wrong reason. Measured while writing this: the
/// security proposer's narrower three-glob `route_scope` is *not* the default set, so it does
/// not hit the short-circuit — but the role gate in front of it applies either way, so the CLI
/// scope surface is never a bare glob engine.
///
/// Mechanics: `test/canary/glob-parity.json` carries the input (the proposer's literal emitted
/// glob set and a fixture path list) and one `selected` list. This test asserts
/// `path_glob_matches` reproduces `selected` exactly; `packages/core/test/glob-parity.test.ts`
/// asserts `matchesGlob` reproduces the same `selected` from the same input. `selected` was
/// generated from the Rust matcher's real output, never hand-written, and both sides recompute
/// it from scratch on every run — so a change to EITHER matcher alone turns its own side red.
/// There is no regeneration flag on purpose: if this goes red the matcher moved, and the
/// question is which of the two is now wrong, not how to refresh the file.
#[cfg(test)]
mod glob_engine_parity_tests {
    use super::path_glob_matches;

    #[test]
    fn rust_matcher_reproduces_the_shared_parity_selection() {
        let artifact_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../test/canary/glob-parity.json"
        );
        let raw = std::fs::read_to_string(artifact_path)
            .unwrap_or_else(|error| panic!("read {artifact_path}: {error}"));
        let artifact: serde_json::Value =
            serde_json::from_str(&raw).expect("parse glob-parity.json");

        let globs = string_list(&artifact["globs"]);
        let files = string_list(&artifact["files"]);
        let expected = string_list(&artifact["selected"]);
        assert!(
            !globs.is_empty() && !files.is_empty(),
            "the artifact must carry inputs"
        );

        // Input order, not sorted: a stable selection order is part of what parity means.
        let selected = files
            .iter()
            .filter(|file| globs.iter().any(|glob| path_glob_matches(glob, file)))
            .cloned()
            .collect::<Vec<_>>();

        assert_eq!(
            selected, expected,
            "`path_glob_matches` no longer reproduces test/canary/glob-parity.json. Either the \
             Rust matcher regressed, or it changed and `matchesGlob` in packages/core/src/globs.ts \
             must change with it — decide from the documented semantics above `path_glob_matches`, \
             do not edit the artifact to match."
        );

        // The single-pattern rows, for the semantics the proposer's glob set does not reach.
        let cases = artifact["pattern_cases"].as_array().expect("pattern_cases");
        assert!(!cases.is_empty(), "the artifact must carry pattern cases");
        for case in cases {
            let pattern = case["pattern"].as_str().expect("pattern");
            let path = case["path"].as_str().expect("path");
            let expected = case["matches"].as_bool().expect("matches");
            assert_eq!(
                path_glob_matches(pattern, path),
                expected,
                "path_glob_matches({pattern:?}, {path:?}) disagrees with test/canary/glob-parity.json"
            );
        }
    }

    fn string_list(value: &serde_json::Value) -> Vec<String> {
        value
            .as_array()
            .expect("array")
            .iter()
            .map(|entry| entry.as_str().expect("string").to_string())
            .collect()
    }
}

#[cfg(test)]
mod finding_fingerprint_dc3_tests {
    use super::legacy_direct_data_access_fingerprint;

    /// D-C3: the third copy of the fingerprint recipe.
    ///
    /// `legacy_fingerprints` exists so a graph-derived finding matches a baseline the import-based
    /// path wrote, which is only true while this function agrees byte for byte with
    /// `direct_data_access_fingerprint` in rules.rs and `findingFingerprint` in
    /// packages/cli/src/check/finding-fingerprint.ts. It is private and had no test, so it could
    /// have drifted from both and taken every stored baseline's continuity with it.
    ///
    /// The digests are the ones asserted in
    /// crates/drift-engine/tests/finding_fingerprint_differential_dc3.rs and
    /// packages/cli/test/frozen-contracts.test.ts.
    #[test]
    fn legacy_fingerprint_matches_the_other_two_implementations() {
        assert_eq!(
            legacy_direct_data_access_fingerprint(
                "convention_x",
                "apps/web/app/api/users/route.ts",
                "prisma",
                "@/lib/prisma"
            ),
            "f89345641d5764b90d14c8ce1f569170c0d67bc6788356ba11764a17f83a36a5"
        );
        assert_eq!(
            legacy_direct_data_access_fingerprint(
                "convention_no_direct_db",
                "app/api/items/route.ts",
                "db",
                "@/lib/db"
            ),
            "03a8e3c929e01da4d31ecd949629e4822f454eb51fe78421df1f88cc8283cecf"
        );
    }

    /// Windows separators must normalise, or the same violation fingerprints differently depending
    /// on which platform wrote the baseline. Pinned on the TypeScript side; pinned here too, because
    /// "the other implementation tests it" is how the three came apart in the first place.
    #[test]
    fn legacy_fingerprint_normalises_path_separators() {
        assert_eq!(
            legacy_direct_data_access_fingerprint("c", "a\\b\\route.ts", "s", "src"),
            legacy_direct_data_access_fingerprint("c", "a/b/route.ts", "s", "src")
        );
    }
}
