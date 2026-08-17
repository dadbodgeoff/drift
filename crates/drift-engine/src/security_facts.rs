use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::security_control_flow::validated_input_uses;
use crate::security_patterns::{
    AcceptedAuthHelper, AcceptedPhase5Contract, AcceptedRequestValidator,
    AcceptedSensitiveResponseField, Phase4SecurityPolicy, RequestValidatorBehavior,
    RequestValidatorKind, accepted_auth_helper_for_call, accepted_authorization_helper_for_call,
    accepted_phase4_auth_helper_for_call, accepted_request_validator_for_call,
    accepted_response_serializer_for_call, static_middleware_matchers,
};
use crate::{Fact, FactExtractError, FactKind, extract_typescript_facts};

/// The validator shapes the scanner recognises *before* any convention has been accepted.
///
/// **The circularity this breaks.** `request_validation_called` is emitted only for calls matching
/// an entry in `accepted_validators`. The scan path passed nothing (`main.rs`, the 3-arg
/// `extract_security_facts`, whose wrapper hard-codes `&[]` on line 20), so the kind had zero
/// instances in every repo Drift has ever scanned. That is not a corpus gap. The proposer's
/// `FAMILY_SPECS` entry for `api_route_requires_request_validation` sources *only* that kind
/// (`candidate_command.rs`), so the family could never form, so no candidate of this kind ever
/// carried `enforcement_semantics: "presence"`, so `presence_findings` was unreachable for it. The
/// enforcement path existed and was tested; nothing could ever route into it.
///
/// Feeding the *accepted* validators into the scan does not fix that, and this is the whole design
/// question: at first scan nothing is accepted yet, so the family that proposes what to accept
/// would still never form. Acceptance cannot be the gate on the input to the thing whose output is
/// acceptance. The honest scan-time gate is therefore **recognised shape**, not acceptance.
///
/// **Why this does not weaken the check.** The acceptance gate is not removed, it stays where it
/// always bound - at check time. `build_request_validation_proof_with_scope` (`security_proof.rs`)
/// re-extracts from source with the convention's real `accepted_validators` and never reads a
/// scanned fact, so nothing here can satisfy a proof. The presence path reads `symbol_called`, not
/// this kind. Scan-time `request_validation_called` is consumed by exactly two things: the
/// proposer, which is meant to see unaccepted code, and the `security-architecture-audit` view.
///
/// This is precisely how the sibling auth family already works - `symbol_called` is unfiltered by
/// acceptance at scan, the proposer nominates, a human accepts, the check enforces. Request
/// validation was the one family sourced from an acceptance-gated kind, and that is the bug.
///
/// **Why the shape filter is load-bearing.** The family's nominator is `always_candidate_symbol`,
/// so every symbol carrying this fact kind joins. Emitting the fact for *every* call would rebuild
/// the 89-member dub family that `FAMILY_SPECS` documents as the reason `symbol_called` was
/// excluded there. This predicate is the narrowing that the nominator does not do, and it is
/// deliberately the same table as `is_validation_candidate_symbol` in `candidate_command.rs`, which
/// already governs the per-symbol candidate of this kind. The two are asserted equal by
/// `scan_time_validator_shapes_match_the_proposer_table` in `tests/scan_time_validators.rs`; they
/// are separate functions only because that one is private to a module this change may not edit.
///
/// **Why the symbol must also resolve to an import.** The consumer of this fact is the family, and
/// `family_member_inputs` (`candidate_command.rs`) drops any symbol for which
/// `dominant_import_source` returns `None` — a symbol with no import can never be a family member.
/// So emitting the fact for a bare method call feeds nothing this change exists to feed. It is not
/// inert either: a second, older per-symbol loop over `request_validation_called`
/// (`candidate_command.rs`, just after the middleware block) emits a candidate that the live
/// `push_request_validation_candidates` path already emits from `symbol_called`, byte for byte and
/// under the same id. Registering an unimportable symbol therefore buys one duplicate candidate and
/// no family member. `safeParse` is exactly that case — always written `Schema.safeParse(body)`,
/// never imported — and it is the sibling proof cell's symbol, which re-extracts with the accepted
/// schema at check time and never wanted a scanned fact.
///
/// The duplicate is still reachable for an imported helper, and belongs to `candidate_command.rs`:
/// two paths propose the same candidate for one kind, and one of them should dedupe or go. Recorded
/// as a handoff rather than fixed here, because that file is not this change's to edit.
pub fn scan_time_request_validators(facts: &[Fact]) -> Vec<AcceptedRequestValidator> {
    let imported = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
        .map(|fact| fact.name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut symbols: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SymbolCalled)
        .filter(|fact| is_recognized_validator_symbol(&fact.name))
        // Mirrors `import_source_for_symbol`: the local binding name is the import fact's `name`.
        .filter(|fact| imported.contains(fact.name.as_str()))
    {
        symbols.insert(fact.name.as_str());
    }
    symbols
        .into_iter()
        .map(|symbol| AcceptedRequestValidator {
            // Same id shape the proposer writes into `requires.validators`, so a family accepted
            // from these facts names its members the way the rest of the pipeline expects.
            validator_id: format!("validator:{symbol}"),
            symbol: symbol.to_string(),
            // Always a free function here. The schema-method shape (`is_schema_method_validator_symbol`)
            // carries a receiver and no import, so it cannot reach this point.
            kind: RequestValidatorKind::Helper,
            // Not a guess. A recognised shape says a validation call happened; it says nothing
            // about whether the helper throws, returns a parsed value or returns a boolean. The
            // contract is what acceptance later pins down, and the proof path reads it from the
            // accepted convention rather than from here.
            behavior: RequestValidatorBehavior::Unknown,
        })
        .collect()
}

/// The shape table shared with `is_validation_candidate_symbol` (`candidate_command.rs`).
///
/// The exclusions are not decoration. `revalidate*` is Next.js cache revalidation, and
/// `*permission*` / `*role*` belong to the authorization family - admitting any of them would put a
/// non-validator into a family whose acceptance then reads as "this route validates its input".
fn is_recognized_validator_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if lower.starts_with("revalidate") || lower.contains("permission") || lower.contains("role") {
        return false;
    }
    lower.starts_with("validate") || lower.contains("validator") || lower == "safeparse"
}

pub fn extract_security_facts(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
) -> Result<Vec<Fact>, FactExtractError> {
    extract_security_facts_with_validation(file_path, source, accepted_auth_helpers, &[])
}

pub fn extract_security_facts_with_validation(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
    accepted_validators: &[AcceptedRequestValidator],
) -> Result<Vec<Fact>, FactExtractError> {
    extract_security_facts_with_policy(
        file_path,
        source,
        &Phase4SecurityPolicy::from_auth_helpers(accepted_auth_helpers),
        accepted_validators,
    )
}

pub fn extract_security_facts_with_policy(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    phase4_policy: &Phase4SecurityPolicy,
    accepted_validators: &[AcceptedRequestValidator],
) -> Result<Vec<Fact>, FactExtractError> {
    extract_security_facts_with_policy_and_phase5(
        file_path,
        source,
        phase4_policy,
        accepted_validators,
        None,
    )
}

pub fn extract_security_facts_with_phase5(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
    accepted_validators: &[AcceptedRequestValidator],
    accepted_phase5: Option<&AcceptedPhase5Contract>,
) -> Result<Vec<Fact>, FactExtractError> {
    extract_security_facts_with_policy_and_phase5(
        file_path,
        source,
        &Phase4SecurityPolicy::from_auth_helpers(accepted_auth_helpers),
        accepted_validators,
        accepted_phase5,
    )
}

fn extract_security_facts_with_policy_and_phase5(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    phase4_policy: &Phase4SecurityPolicy,
    accepted_validators: &[AcceptedRequestValidator],
    accepted_phase5: Option<&AcceptedPhase5Contract>,
) -> Result<Vec<Fact>, FactExtractError> {
    let normalized_file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let facts = extract_typescript_facts(file_path, source)?;
    let source_lines: Vec<&str> = source.lines().collect();
    let request_input_facts =
        request_input_read_facts(&normalized_file_path, &facts, &source_lines);
    let mut security_facts = Vec::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SymbolCalled)
    {
        let route = route_for_line(&facts, fact.start_line).unwrap_or("unknown");
        let route_id = format!("route:{}:{route}", fact.file_path);
        if let Some(helper) = accepted_phase4_auth_helper_for_call(fact, &facts, phase4_policy)
            .or_else(|| {
                phase4_policy
                    .auth_helper_imports
                    .is_empty()
                    .then(|| {
                        accepted_auth_helper_for_call(
                            fact,
                            &facts,
                            &phase4_policy.accepted_auth_helpers,
                        )
                    })
                    .flatten()
            })
        {
            security_facts.push(Fact {
                kind: FactKind::AuthGuardCalled,
                file_path: fact.file_path.clone(),
                name: fact.name.clone(),
                value: Some(
                    json!({
                        "guard_id": helper.guard_id,
                        "route_id": route_id,
                        "handler_symbol": route,
                        "behavior": helper.behavior.as_str(),
                    })
                    .to_string(),
                ),
                imported_name: Some(helper.symbol.clone()),
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
            if matches!(
                helper.behavior,
                crate::security_patterns::AuthGuardBehavior::ReturnsSession
                    | crate::security_patterns::AuthGuardBehavior::ReturnsUser
            ) && let Some(line) = source_lines.get(fact.start_line.saturating_sub(1))
                && let Some(variable) = assigned_variable(line)
            {
                security_facts.push(Fact {
                    kind: FactKind::SessionRead,
                    file_path: fact.file_path.clone(),
                    name: variable.clone(),
                    value: Some(
                        json!({
                            "route_id": route_id,
                            "source": "auth_result",
                            "trust": "unknown",
                            "variable": variable,
                            "helper_id": helper.guard_id,
                        })
                        .to_string(),
                    ),
                    imported_name: Some(helper.symbol.clone()),
                    runtime_use: None,
                    start_line: fact.start_line,
                    end_line: fact.end_line,
                    start_column: fact.start_column,
                    end_column: fact.end_column,
                });
            }
            if line_is_inside_callback(&source_lines, fact.start_line) {
                security_facts.push(Fact {
                    kind: FactKind::CallbackBoundaryDetected,
                    file_path: fact.file_path.clone(),
                    name: "callback".to_string(),
                    value: Some(
                        json!({
                            "route_id": route_id,
                            "boundary_kind": "callback",
                            "contains_guard": true,
                            "contains_sink": protected_sink_after_line(&facts, fact.start_line),
                        })
                        .to_string(),
                    ),
                    imported_name: None,
                    runtime_use: None,
                    start_line: fact.start_line,
                    end_line: fact.end_line,
                    start_column: fact.start_column,
                    end_column: fact.end_column,
                });
            }
        } else if let Some(line) = source_lines.get(fact.start_line.saturating_sub(1))
            && let Some(variable) = assigned_variable(line)
            && is_session_like_variable(&variable)
            && line.contains("await")
            && line.contains('(')
            && !line.contains("await request.json()")
            && !line.contains("await request.formData()")
            && !line.contains("await request.text()")
        {
            security_facts.push(Fact {
                kind: FactKind::SessionRead,
                file_path: fact.file_path.clone(),
                name: variable.clone(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "source": "unknown_helper",
                        "trust": "untrusted",
                        "variable": variable,
                    })
                    .to_string(),
                ),
                imported_name: Some(fact.name.clone()),
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
        }
        if let Some(validator) =
            accepted_request_validator_for_call(fact, &facts, accepted_validators)
            && let Some(line) = source_lines.get(fact.start_line.saturating_sub(1))
        {
            let route_id = format!("route:{}:{route}", fact.file_path);
            // For a `Schema` validator the convention names the schema itself. For a
            // `SchemaMethod` validator it names the method, so the schema is the call receiver -
            // report that rather than repeating `safeParse` back as if it were a schema.
            let schema_symbol = match validator.kind {
                RequestValidatorKind::Schema => Some(validator.symbol.clone()),
                RequestValidatorKind::SchemaMethod => fact.value.clone(),
                RequestValidatorKind::Helper => None,
            };
            for (input_var, result_var) in
                validation_input_bindings(&source_lines, fact.start_line, line, &fact.name)
            {
                security_facts.push(Fact {
                    kind: FactKind::RequestValidationCalled,
                    file_path: fact.file_path.clone(),
                    name: fact.name.clone(),
                    value: Some(
                        json!({
                            "validator_id": validator.validator_id,
                            "route_id": route_id,
                            "validator_symbol": validator.symbol,
                            "schema_symbol": schema_symbol,
                            "input_var": input_var,
                            "result_var": result_var,
                            "behavior": validator.behavior.as_str(),
                            "kind": validator.kind.as_str(),
                        })
                        .to_string(),
                    ),
                    imported_name: Some(validator.symbol.clone()),
                    runtime_use: None,
                    start_line: fact.start_line,
                    end_line: fact.end_line,
                    start_column: fact.start_column,
                    end_column: fact.end_column,
                });
            }
        }
        if let Some(phase5) = accepted_phase5
            && let Some(serializer) =
                accepted_response_serializer_for_call(fact, &facts, &phase5.response_serializers)
            && let Some(line) = source_lines.get(fact.start_line.saturating_sub(1))
        {
            security_facts.push(Fact {
                kind: FactKind::SerializerCalled,
                file_path: fact.file_path.clone(),
                name: fact.name.clone(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "serializer_id": serializer.serializer_id,
                        "input_var": call_first_argument(line, &fact.name),
                        "output_var": assigned_variable(line),
                        "policy": serializer.policy.as_str(),
                        "filtered_fields": serializer.filtered_fields,
                    })
                    .to_string(),
                ),
                imported_name: Some(serializer.imported_name.clone()),
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
        }
        if let Some(helper) = accepted_authorization_helper_for_call(
            fact,
            &facts,
            &phase4_policy.authorization_helpers,
        ) && let Some(line) = source_lines.get(fact.start_line.saturating_sub(1))
        {
            if helper.behavior == crate::security_patterns::AuthorizationHelperBehavior::Boolean
                && !boolean_authorization_failure_branch_exits(&source_lines, fact.start_line)
            {
                continue;
            }
            let route_id = format!("route:{}:{route}", fact.file_path);
            let arguments = call_arguments(line, &fact.name);
            let call_text = call_text_from_line(&source_lines, fact.start_line);
            let subject_var = arguments.first().cloned();
            let resource_var = arguments.get(1).and_then(|argument| {
                (!is_quoted_literal(argument)).then(|| argument.trim().to_string())
            });
            let mut roles =
                if helper.kind == crate::security_patterns::AuthorizationHelperKind::Role {
                    arguments
                        .iter()
                        .skip(1)
                        .filter_map(|argument| unquoted_literal(argument))
                        .collect::<Vec<_>>()
                } else {
                    Vec::new()
                };
            roles.extend(string_array_property(&call_text, "requiredRoles"));
            let mut permissions =
                if helper.kind == crate::security_patterns::AuthorizationHelperKind::Policy {
                    arguments
                        .iter()
                        .skip(1)
                        .filter_map(|argument| unquoted_literal(argument))
                        .collect::<Vec<_>>()
                } else {
                    Vec::new()
                };
            permissions.extend(string_array_property(&call_text, "requiredPermissions"));
            security_facts.push(Fact {
                kind: FactKind::AuthorizationGuardCalled,
                file_path: fact.file_path.clone(),
                name: fact.name.clone(),
                value: Some(
                    json!({
                        "guard_id": helper.guard_id,
                        "route_id": route_id,
                        "guard_kind": helper.kind.as_str(),
                        "behavior": helper.behavior.as_str(),
                        "subject_var": subject_var,
                        "resource_var": resource_var,
                        "roles": roles,
                        "permissions": permissions,
                        "dominates_sinks": true,
                    })
                    .to_string(),
                ),
                imported_name: Some(helper.symbol.clone()),
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
        }
        if is_json_response_call(fact) {
            let route_id = format!("route:{}:{route}", fact.file_path);
            security_facts.push(Fact {
                kind: FactKind::RouteReturnsResponse,
                file_path: fact.file_path.clone(),
                name: fact.name.clone(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "handler_symbol": route,
                        "response_id": format!("response:{}:{}", fact.file_path, fact.start_line),
                        "response_kind": "json",
                    })
                    .to_string(),
                ),
                imported_name: None,
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
        }
        if is_outbound_request_call(fact) {
            let route_id = format!("route:{}:{route}", fact.file_path);
            let line = source_lines
                .get(fact.start_line.saturating_sub(1))
                .copied()
                .unwrap_or_default();
            let url_var = call_first_argument(line, &fact.name);
            let url_source = outbound_url_source(line, url_var.as_deref(), &request_input_facts);
            security_facts.push(Fact {
                kind: FactKind::OutboundRequestCalled,
                file_path: fact.file_path.clone(),
                name: fact.name.clone(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "api": outbound_request_api(fact),
                        "url_var": url_var,
                        "url_source": url_source,
                    })
                    .to_string(),
                ),
                imported_name: None,
                runtime_use: None,
                start_line: fact.start_line,
                end_line: fact.end_line,
                start_column: fact.start_column,
                end_column: fact.end_column,
            });
        }
    }
    security_facts.extend(request_input_facts);
    security_facts.extend(raw_sql_facts(&normalized_file_path, &facts, &source_lines));
    security_facts.extend(cors_policy_facts(
        &normalized_file_path,
        &facts,
        &source_lines,
    ));
    security_facts.extend(session_read_facts(
        &normalized_file_path,
        &facts,
        &source_lines,
    ));
    let facts_with_security = facts
        .iter()
        .cloned()
        .chain(security_facts.iter().cloned())
        .collect::<Vec<_>>();
    security_facts.extend(tenant_source_facts(
        &normalized_file_path,
        &facts_with_security,
        &source_lines,
        phase4_policy,
    ));
    security_facts.extend(tenant_guard_facts(
        &normalized_file_path,
        &facts_with_security,
        &source_lines,
        phase4_policy,
    ));
    let combined_facts = facts
        .iter()
        .cloned()
        .chain(security_facts.iter().cloned())
        .collect::<Vec<_>>();
    for validated_use in validated_input_uses(&combined_facts, &source_lines) {
        security_facts.push(Fact {
            kind: FactKind::ValidatedInputUsed,
            file_path: normalized_file_path.clone(),
            name: validated_use.validated_var.clone(),
            value: Some(
                json!({
                    "source_input_var": validated_use.source_input_var,
                    "validated_var": validated_use.validated_var,
                    "sink_kind": validated_use.sink_kind,
                    "sink_fact_id": validated_use.sink_fact_id,
                })
                .to_string(),
            ),
            imported_name: None,
            runtime_use: None,
            start_line: validated_use.start_line,
            end_line: validated_use.end_line,
            // The intermediate representation this is derived from carries lines but no columns, so
            // there is no position to propagate. 1 rather than an invented column.
            start_column: 1,
            end_column: 1,
        });
    }
    if is_middleware_file(
        facts
            .first()
            .map(|fact| fact.file_path.as_str())
            .unwrap_or_default(),
    ) && let Some(middleware_line) = middleware_declaration_line(&source_lines)
    {
        let file_path = facts
            .first()
            .map(|fact| fact.file_path.clone())
            .unwrap_or_else(|| normalized_file_path.clone());
        let middleware_id = format!("middleware:{file_path}");
        let protection_kind = if security_facts
            .iter()
            .any(|fact| fact.kind == FactKind::AuthGuardCalled)
        {
            "auth"
        } else {
            "unknown"
        };
        security_facts.push(Fact {
            kind: FactKind::MiddlewareDeclared,
            file_path: file_path.clone(),
            name: "middleware".to_string(),
            value: Some(
                json!({
                    "middleware_id": middleware_id,
                    "protection_kind": protection_kind,
                })
                .to_string(),
            ),
            imported_name: None,
            runtime_use: None,
            start_line: middleware_line,
            end_line: middleware_line,
            start_column: 1,
            end_column: 1,
        });
        for matcher in static_middleware_matchers(source) {
            security_facts.push(Fact {
                kind: FactKind::MiddlewareMatcherDeclared,
                file_path: file_path.clone(),
                name: matcher.path_pattern.clone(),
                value: Some(
                    json!({
                        "middleware_id": middleware_id,
                        "matcher_kind": if matcher.excluded { "excluded_path" } else { "static_path" },
                        "path_pattern": matcher.path_pattern,
                    })
                    .to_string(),
                ),
                imported_name: None,
                runtime_use: None,
                start_line: matcher.start_line,
                end_line: matcher.end_line,
                // The intermediate representation this is derived from carries lines but no columns, so
                // there is no position to propagate. 1 rather than an invented column.
                start_column: 1,
                end_column: 1,
            });
        }
    }
    security_facts.extend(sensitive_field_declared_facts(
        &normalized_file_path,
        &source_lines,
        accepted_phase5,
    ));
    security_facts.extend(response_emits_field_facts(
        &normalized_file_path,
        &facts,
        &source_lines,
    ));
    security_facts.extend(secret_read_facts(
        &normalized_file_path,
        &source_lines,
        accepted_phase5,
    ));

    Ok(security_facts)
}

fn secret_read_facts(
    file_path: &str,
    lines: &[&str],
    accepted_phase5: Option<&AcceptedPhase5Contract>,
) -> Vec<Fact> {
    let Some(accepted) = accepted_phase5 else {
        return Vec::new();
    };
    let mut facts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        if accepted.secret_sources.iter().any(|source| source == "env")
            && let Some(key) = process_env_key(line)
        {
            let secret_class = classify_secret(&key);
            if secret_class == "unknown" {
                continue;
            }
            facts.push(secret_read_fact(
                file_path,
                line_number,
                secret_class,
                "env",
                Some(redacted_hash(&key)),
            ));
        }
        if accepted
            .secret_sources
            .iter()
            .any(|source| source == "config")
            && line.contains("config.")
        {
            let key = line
                .split("config.")
                .nth(1)
                .and_then(|part| {
                    part.split(|c: char| !is_identifier_char(c))
                        .find(|part| !part.is_empty())
                })
                .unwrap_or("unknown");
            let secret_class = classify_secret(key);
            if secret_class == "unknown" {
                continue;
            }
            facts.push(secret_read_fact(
                file_path,
                line_number,
                secret_class,
                "config",
                None,
            ));
        }
        if accepted
            .secret_sources
            .iter()
            .any(|source| source == "secret_manager")
            && (line.contains("secretManager.get(") || line.contains("secret_manager.get("))
        {
            let key = quoted_value_after(line, "get(").unwrap_or_else(|| "unknown".to_string());
            let secret_class = classify_secret(&key);
            if secret_class == "unknown" {
                continue;
            }
            facts.push(secret_read_fact(
                file_path,
                line_number,
                secret_class,
                "secret_manager",
                Some(redacted_hash(&key)),
            ));
        }
    }
    facts
}

fn secret_read_fact(
    file_path: &str,
    line_number: usize,
    secret_class: &str,
    source: &str,
    env_key_hash: Option<String>,
) -> Fact {
    let mut value = json!({
        "secret_class": secret_class,
        "source": source,
    });
    if let Some(hash) = env_key_hash
        && let Some(object) = value.as_object_mut()
    {
        object.insert("env_key_hash".to_string(), json!(hash));
    }
    Fact {
        kind: FactKind::SecretRead,
        file_path: file_path.to_string(),
        name: "secret_read".to_string(),
        value: Some(value.to_string()),
        imported_name: None,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

fn process_env_key(line: &str) -> Option<String> {
    if let Some(after_env) = line.split("process.env.").nth(1) {
        return after_env
            .split(|c: char| !is_identifier_char(c))
            .find(|part| !part.is_empty())
            .map(ToString::to_string);
    }
    let after_bracket = line.split("process.env[").nth(1)?;
    let quote = after_bracket.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &after_bracket[quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn classify_secret(key: &str) -> &'static str {
    let normalized = key.to_ascii_lowercase();
    if normalized.contains("api_key") || normalized.contains("apikey") {
        "api_key"
    } else if normalized.contains("token") {
        "token"
    } else if normalized.contains("password") {
        "password"
    } else if normalized.contains("private_key") || normalized.contains("privatekey") {
        "private_key"
    } else {
        "unknown"
    }
}

fn redacted_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn response_emits_field_facts(file_path: &str, facts: &[Fact], lines: &[&str]) -> Vec<Fact> {
    let response_variables = response_variable_fields(lines);
    let mut response_facts = Vec::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SymbolCalled && is_json_response_call(fact))
    {
        let Some(line) = lines.get(fact.start_line.saturating_sub(1)) else {
            continue;
        };
        let Some(argument) = call_argument_text(line, &fact.name) else {
            continue;
        };
        let route = route_for_line(facts, fact.start_line).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        let response_id = format!("response:{file_path}:{}", fact.start_line);
        let (fields, source_var) = if argument.trim_start().starts_with('{') {
            (object_field_entries(argument.trim()), None)
        } else if is_identifier(argument.trim()) {
            let variable = argument.trim().to_string();
            (
                response_variables
                    .get(variable.as_str())
                    .cloned()
                    .unwrap_or_default(),
                Some(variable),
            )
        } else {
            (Vec::new(), None)
        };
        for field in fields {
            response_facts.push(response_emits_field_fact(
                file_path,
                fact.start_line,
                &route_id,
                &response_id,
                &field.field_path,
                source_var.as_deref(),
                field.source_expr.as_deref(),
            ));
        }
    }
    response_facts
}

#[derive(Clone)]
struct ResponseFieldEntry {
    field_path: String,
    source_expr: Option<String>,
}

fn response_variable_fields(lines: &[&str]) -> BTreeMap<String, Vec<ResponseFieldEntry>> {
    let mut variables = BTreeMap::new();
    for line in lines {
        let trimmed = line.trim();
        let Some((left, right)) = trimmed.split_once('=') else {
            continue;
        };
        let Some(variable) = left
            .trim()
            .strip_prefix("const ")
            .or_else(|| left.trim().strip_prefix("let "))
        else {
            continue;
        };
        let variable = variable.trim();
        if is_identifier(variable) && right.trim_start().starts_with('{') {
            variables.insert(variable.to_string(), object_field_entries(right.trim()));
        }
    }
    variables
}

fn response_emits_field_fact(
    file_path: &str,
    line_number: usize,
    route_id: &str,
    response_id: &str,
    field_path: &str,
    source_var: Option<&str>,
    source_expr: Option<&str>,
) -> Fact {
    let mut value = json!({
        "route_id": route_id,
        "response_id": response_id,
        "field_path": field_path,
        "classification": "unknown",
        "response_kind": "json",
    });
    if let Some(source_var) = source_var
        && let Some(object) = value.as_object_mut()
    {
        object.insert("source_var".to_string(), json!(source_var));
    }
    if let Some(source_expr) = source_expr
        && let Some(object) = value.as_object_mut()
    {
        object.insert("source_expr".to_string(), json!(source_expr));
        if source_var.is_none()
            && let Some(source_var) = source_expr
                .split('.')
                .next()
                .filter(|part| is_identifier(part))
        {
            object.insert("source_var".to_string(), json!(source_var));
        }
    }
    Fact {
        kind: FactKind::ResponseEmitsField,
        file_path: file_path.to_string(),
        name: field_path.to_string(),
        value: Some(value.to_string()),
        imported_name: None,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

/// The text of a call's first argument, brackets balanced.
///
/// **Fourth dead-path component of D1, and not one the audit named.** The `)`-at-depth-0 arm used
/// to end with `.split(',').next()`, which is a depth-blind split applied *after* the depth
/// tracking has already done its job. A top-level comma cannot reach that arm — it returns from
/// the `,`-at-depth-0 arm first — so every comma still present is inside braces and belongs to the
/// argument. Splitting on it truncated `res.json({ id, email, password })` to `{ id`, so a
/// response literal emitted a `response_emits_field` fact for its **first field only** and every
/// later field was invisible to the leak proof.
///
/// That is why `pages/api/route-leak.ts` proved clean even with correct provenance and a scope
/// that matched: `password` is the third key. The single-key fixtures the phase-5 tests use
/// (`Response.json({ user: { email } })`) have no top-level comma, so none of them could see it.
fn call_argument_text<'a>(line: &'a str, call_name: &str) -> Option<&'a str> {
    let marker = format!("{call_name}(");
    let after_marker = line.split(&marker).nth(1)?;
    let mut depth = 0_i32;
    for (index, character) in after_marker.char_indices() {
        match character {
            '(' | '{' | '[' => depth += 1,
            ')' if depth == 0 => return Some(after_marker[..index].trim()),
            ')' | '}' | ']' => depth -= 1,
            ',' if depth == 0 => return Some(after_marker[..index].trim()),
            _ => {}
        }
    }
    None
}

fn object_field_entries(object_text: &str) -> Vec<ResponseFieldEntry> {
    if object_text.contains("...") {
        return Vec::new();
    }
    let object = object_text
        .trim()
        .trim_start_matches('{')
        .trim_end_matches(';')
        .trim_end_matches(')')
        .trim_end_matches('}')
        .trim();
    object_field_entries_inner(object, "")
}

fn object_field_entries_inner(object: &str, prefix: &str) -> Vec<ResponseFieldEntry> {
    let mut fields = Vec::new();
    for part in split_top_level_commas(object) {
        let trimmed = part.trim();
        if trimmed.is_empty() || trimmed.contains("...") {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = clean_object_key(key);
            if key.is_empty() {
                continue;
            }
            let path = if prefix.is_empty() {
                key.clone()
            } else {
                format!("{prefix}.{key}")
            };
            let value = value.trim();
            if value.starts_with('{') {
                fields.extend(object_field_entries_inner(
                    value.trim_start_matches('{').trim_end_matches('}').trim(),
                    &path,
                ));
            } else {
                fields.push(ResponseFieldEntry {
                    field_path: path,
                    source_expr: source_expression(value),
                });
            }
        } else {
            let key = clean_object_key(trimmed);
            if !key.is_empty() {
                fields.push(ResponseFieldEntry {
                    field_path: if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    },
                    source_expr: Some(key),
                });
            }
        }
    }
    fields
}

fn source_expression(value: &str) -> Option<String> {
    let expr = value
        .trim()
        .trim_end_matches(';')
        .trim_end_matches(',')
        .trim();
    let valid = expr
        .split('.')
        .all(|part| !part.is_empty() && part.chars().all(is_identifier_char));
    valid.then(|| expr.to_string())
}

fn split_top_level_commas(value: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0_i32;
    let mut start = 0;
    for (index, character) in value.char_indices() {
        match character {
            '{' | '[' | '(' => depth += 1,
            '}' | ']' | ')' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&value[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&value[start..]);
    parts
}

fn clean_object_key(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn sensitive_field_declared_facts(
    file_path: &str,
    lines: &[&str],
    accepted_phase5: Option<&AcceptedPhase5Contract>,
) -> Vec<Fact> {
    let mut facts = Vec::new();
    if let Some(accepted) = accepted_phase5 {
        for field in &accepted.sensitive_response_fields {
            facts.push(sensitive_field_fact(file_path, 1, field));
        }
    }

    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        if let Some((field_path, classification)) = schema_sensitive_field(line) {
            facts.push(sensitive_field_fact_from_parts(
                file_path,
                line_number,
                field_path,
                classification,
                "schema",
            ));
        } else if let Some((field_path, classification)) = candidate_sensitive_field(line) {
            facts.push(sensitive_field_fact_from_parts(
                file_path,
                line_number,
                field_path,
                classification,
                "candidate",
            ));
        }
    }

    facts
}

fn sensitive_field_fact(
    file_path: &str,
    line_number: usize,
    field: &AcceptedSensitiveResponseField,
) -> Fact {
    sensitive_field_fact_from_parts(
        file_path,
        line_number,
        field.field_path.clone(),
        field.classification.clone(),
        field.source.as_str(),
    )
}

fn sensitive_field_fact_from_parts(
    file_path: &str,
    line_number: usize,
    field_path: String,
    classification: String,
    source: &str,
) -> Fact {
    Fact {
        kind: FactKind::SensitiveFieldDeclared,
        file_path: file_path.to_string(),
        name: field_path.clone(),
        value: Some(
            json!({
                "field_path": field_path,
                "classification": classification,
                "source": source,
            })
            .to_string(),
        ),
        imported_name: None,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

fn schema_sensitive_field(line: &str) -> Option<(String, String)> {
    if !line.contains("driftSensitive") {
        return None;
    }
    let field_path = object_field_name(line)?;
    let classification = quoted_value_after(line, "driftSensitive")
        .filter(|value| {
            matches!(
                value.as_str(),
                "pii" | "credential" | "token" | "tenant_secret" | "internal"
            )
        })
        .unwrap_or_else(|| "internal".to_string());
    Some((field_path, classification))
}

fn candidate_sensitive_field(line: &str) -> Option<(String, String)> {
    let field_path = object_field_name(line)?;
    let classification = match field_path.as_str() {
        "password" => "credential",
        "token" | "apiToken" | "accessToken" | "refreshToken" => "token",
        _ => return None,
    };
    Some((field_path, classification.to_string()))
}

fn object_field_name(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let before_colon = trimmed.split_once(':')?.0.trim();
    let field = before_colon
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .trim_start_matches("readonly ")
        .to_string();
    (!field.is_empty() && field.chars().all(|c| c == '_' || c.is_ascii_alphanumeric()))
        .then_some(field)
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty() && value.chars().all(is_identifier_char)
}

fn quoted_value_after(line: &str, marker: &str) -> Option<String> {
    let after_marker = line.split(marker).nth(1)?;
    let quote_index = after_marker.find(['"', '\''])?;
    let quote = after_marker.as_bytes()[quote_index] as char;
    let after_quote = &after_marker[quote_index + 1..];
    let end_index = after_quote.find(quote)?;
    Some(after_quote[..end_index].to_string())
}

fn call_first_argument(line: &str, call_name: &str) -> Option<String> {
    let marker = format!("{call_name}(");
    let after_marker = line.split(&marker).nth(1)?;
    let argument = after_marker.split_once(')')?.0.split(',').next()?.trim();
    (!argument.is_empty() && argument.chars().all(is_identifier_char)).then(|| argument.to_string())
}

fn validation_input_variable(line: &str, call_name: &str) -> Option<String> {
    call_first_argument(line, call_name).or_else(|| {
        line.contains("parseRequestBody(")
            .then(|| assigned_variable(line))
            .flatten()
    })
}

fn validation_input_bindings(
    lines: &[&str],
    line_number: usize,
    line: &str,
    call_name: &str,
) -> Vec<(String, Option<String>)> {
    if let Some(input_var) = validation_input_variable(line, call_name) {
        return vec![(input_var, assigned_variable(line))];
    }
    if !line.contains("parseRequestBody(") {
        return Vec::new();
    }
    destructured_assignment_variables(lines, line_number)
        .into_iter()
        .map(|variable| (variable.clone(), Some(variable)))
        .collect()
}

fn call_arguments(line: &str, call_name: &str) -> Vec<String> {
    let marker = format!("{call_name}(");
    let Some(after_marker) = line.split(&marker).nth(1) else {
        return Vec::new();
    };
    let Some(arguments) = after_marker.split_once(')').map(|(arguments, _)| arguments) else {
        return Vec::new();
    };
    arguments
        .split(',')
        .map(str::trim)
        .filter(|argument| !argument.is_empty())
        .map(str::to_string)
        .collect()
}

fn call_text_from_line(lines: &[&str], line_number: usize) -> String {
    let mut text = String::new();
    let mut depth = 0i32;
    for line in lines.iter().skip(line_number.saturating_sub(1)).take(40) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(line);
        for character in line.chars() {
            if character == '(' {
                depth += 1;
            } else if character == ')' {
                depth -= 1;
            }
        }
        if !text.is_empty() && depth <= 0 && line.contains(')') {
            break;
        }
    }
    text
}

fn string_array_property(text: &str, property: &str) -> Vec<String> {
    let Some(after_property) = text.split(property).nth(1) else {
        return Vec::new();
    };
    let Some(after_open) = after_property.split_once('[').map(|(_, after)| after) else {
        return Vec::new();
    };
    let Some(array_text) = after_open.split_once(']').map(|(array, _)| array) else {
        return Vec::new();
    };
    array_text
        .split(',')
        .filter_map(unquoted_literal)
        .collect::<Vec<_>>()
}

fn is_quoted_literal(argument: &str) -> bool {
    let trimmed = argument.trim();
    (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
}

fn unquoted_literal(argument: &str) -> Option<String> {
    let trimmed = argument.trim();
    if !(trimmed.starts_with('"') || trimmed.starts_with('\'')) {
        return None;
    }
    let quote = trimmed.chars().next()?;
    let value = trimmed.trim_matches(quote);
    (!value.is_empty()).then(|| value.to_string())
}

fn boolean_authorization_failure_branch_exits(lines: &[&str], line_number: usize) -> bool {
    if line_number == 0 {
        return false;
    }
    let branch_lines = lines
        .iter()
        .skip(line_number.saturating_sub(1))
        .take(6)
        .copied()
        .collect::<Vec<_>>();
    let branch_text = branch_lines.join("\n");
    branch_text.contains("if")
        && branch_text.contains('!')
        && (branch_text.contains("return ") || branch_text.contains("throw "))
}

fn request_input_read_facts(file_path: &str, facts: &[Fact], lines: &[&str]) -> Vec<Fact> {
    let mut request_facts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let route = route_for_line(facts, line_number).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        if line.contains("await request.json()") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "body",
                    variable,
                    None,
                ));
            }
        } else if line.contains("await request.formData()") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "formData",
                    variable,
                    None,
                ));
            }
        } else if line.contains("await request.text()") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "body",
                    variable,
                    None,
                ));
            }
        } else if line.contains("parseRequestBody(") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "body",
                    variable,
                    None,
                ));
            } else {
                for variable in destructured_assignment_variables(lines, line_number) {
                    request_facts.push(request_input_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        "body",
                        variable,
                        None,
                    ));
                }
            }
        } else if line.contains("request.nextUrl.searchParams.get(")
            || line.contains("new URL(request.url).searchParams.get(")
        {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "query",
                    variable,
                    quoted_argument(line, "searchParams.get("),
                ));
            }
        } else if line.contains("request.headers.get(") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "headers",
                    variable,
                    quoted_argument(line, "headers.get("),
                ));
            }
        } else if line.contains("cookies().get(") || line.contains("request.cookies.get(") {
            if let Some(variable) = assigned_variable(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id,
                    "cookies",
                    variable,
                    quoted_argument(line, "cookies().get(")
                        .or_else(|| quoted_argument(line, "request.cookies.get(")),
                ));
            }
        } else if (line.contains("params.") || line.contains("context.params."))
            && let Some(variable) = assigned_variable(line)
        {
            let key = line
                .split("params.")
                .nth(1)
                .map(|value| identifier_prefix(value).to_string());
            request_facts.push(request_input_fact(
                file_path,
                line_number,
                route_id,
                "params",
                variable,
                key,
            ));
        } else if line.contains("} = params") {
            for variable in destructured_names(line) {
                request_facts.push(request_input_fact(
                    file_path,
                    line_number,
                    route_id.clone(),
                    "params",
                    variable.clone(),
                    Some(variable),
                ));
            }
        }
    }
    request_facts
}

fn session_read_facts(file_path: &str, facts: &[Fact], lines: &[&str]) -> Vec<Fact> {
    let mut session_facts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let Some(variable) = assigned_variable(line) else {
            continue;
        };
        let source = if line.contains("request.headers.get(") {
            Some("headers")
        } else if line.contains("await request.json()")
            || line.contains("await request.formData()")
            || line.contains("await request.text()")
        {
            Some("body")
        } else if line.contains("cookies().get(") || line.contains("request.cookies.get(") {
            Some("cookies")
        } else {
            None
        };
        let Some(source) = source else {
            continue;
        };
        if !is_session_like_variable(&variable) {
            continue;
        }
        let route = route_for_line(facts, line_number).unwrap_or("unknown");
        session_facts.push(Fact {
            kind: FactKind::SessionRead,
            file_path: file_path.to_string(),
            name: variable.clone(),
            value: Some(
                json!({
                    "route_id": format!("route:{file_path}:{route}"),
                    "source": source,
                    "trust": "untrusted",
                    "variable": variable,
                })
                .to_string(),
            ),
            imported_name: None,
            runtime_use: None,
            start_line: line_number,
            end_line: line_number,
            start_column: 1,
            end_column: 1,
        });
    }
    session_facts
}

fn tenant_source_facts(
    file_path: &str,
    facts: &[Fact],
    lines: &[&str],
    phase4_policy: &Phase4SecurityPolicy,
) -> Vec<Fact> {
    let trusted_session_variables = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SessionRead)
        .filter_map(|fact| {
            let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
            (value.get("source")?.as_str()? == "auth_result")
                .then(|| value.get("variable")?.as_str().map(str::to_string))
                .flatten()
        })
        .collect::<Vec<_>>();
    let body_variables = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::RequestInputRead)
        .filter_map(|fact| {
            let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
            (value.get("source")?.as_str()? == "body")
                .then(|| value.get("variable")?.as_str().map(str::to_string))
                .flatten()
        })
        .collect::<Vec<_>>();
    let mut tenant_facts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let route = route_for_line(facts, line_number).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        if let Some(variable) = assigned_variable(line) {
            for key in &phase4_policy.tenant_keys {
                if phase4_policy
                    .tenant_sources
                    .iter()
                    .any(|source| source == "session")
                    && trusted_session_variables.iter().any(|session_var| {
                        line.contains(&format!("{session_var}.user.{key}"))
                            || line.contains(&format!("{session_var}.{key}"))
                    })
                {
                    let session_variable = trusted_session_variables
                        .iter()
                        .find(|session_var| {
                            line.contains(&format!("{}.user.{key}", session_var))
                                || line.contains(&format!("{}.{key}", session_var))
                        })
                        .cloned();
                    tenant_facts.push(tenant_source_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        &variable,
                        TenantSourceFactMetadata {
                            source: "session",
                            tenant_key: key,
                            trusted: true,
                            session_variable,
                        },
                    ));
                } else if phase4_policy
                    .tenant_sources
                    .iter()
                    .any(|source| source == "path_param" || source == "params")
                    && (line.contains(&format!("params.{key}"))
                        || line.contains(&format!("context.params.{key}")))
                {
                    tenant_facts.push(tenant_source_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        &variable,
                        TenantSourceFactMetadata {
                            source: "path_param",
                            tenant_key: key,
                            trusted: false,
                            session_variable: None,
                        },
                    ));
                } else if phase4_policy
                    .tenant_sources
                    .iter()
                    .any(|source| source == "query" || source == "search_params")
                    && line.contains("searchParams.get(")
                    && quoted_argument(line, "searchParams.get(").as_deref() == Some(key.as_str())
                {
                    tenant_facts.push(tenant_source_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        &variable,
                        TenantSourceFactMetadata {
                            source: "query",
                            tenant_key: key,
                            trusted: false,
                            session_variable: None,
                        },
                    ));
                } else if phase4_policy
                    .tenant_sources
                    .iter()
                    .any(|source| source == "body")
                    && body_variables
                        .iter()
                        .any(|body_var| line.contains(&format!("{body_var}.{key}")))
                {
                    tenant_facts.push(tenant_source_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        &variable,
                        TenantSourceFactMetadata {
                            source: "body",
                            tenant_key: key,
                            trusted: false,
                            session_variable: None,
                        },
                    ));
                }
            }
        }
        if line.contains("} = params") {
            for (key, variable) in destructured_aliases(line) {
                if phase4_policy.tenant_keys.contains(&key)
                    && phase4_policy
                        .tenant_sources
                        .iter()
                        .any(|source| source == "path_param" || source == "params")
                {
                    tenant_facts.push(tenant_source_fact(
                        file_path,
                        line_number,
                        route_id.clone(),
                        &variable,
                        TenantSourceFactMetadata {
                            source: "path_param",
                            tenant_key: &key,
                            trusted: false,
                            session_variable: None,
                        },
                    ));
                }
            }
        }
    }
    tenant_facts
}

fn tenant_guard_facts(
    file_path: &str,
    facts: &[Fact],
    lines: &[&str],
    phase4_policy: &Phase4SecurityPolicy,
) -> Vec<Fact> {
    let mut guard_facts = Vec::new();
    for operation in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::DataOperationDetected)
    {
        let route = route_for_line(facts, operation.start_line).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        let operation_text = lines
            .iter()
            .skip(operation.start_line.saturating_sub(1))
            .take(
                operation
                    .end_line
                    .saturating_sub(operation.start_line)
                    .saturating_add(1),
            )
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        let operation_name = operation
            .value
            .as_deref()
            .map(|receiver| format!("{receiver}.{}", operation.name))
            .unwrap_or_else(|| operation.name.clone());
        for key in &phase4_policy.tenant_keys {
            if operation_text.contains("where:")
                && operation_text.contains(&format!("{key}:"))
                && (operation_text.contains(&format!(".user.{key}"))
                    || operation_text.contains(&format!(".{key}")))
            {
                guard_facts.push(tenant_guard_fact(
                    file_path,
                    operation.start_line,
                    route_id.clone(),
                    &operation_name,
                    "equality",
                    key,
                    None,
                ));
            }
        }
    }
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let route = route_for_line(facts, line_number).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        for helper in &phase4_policy.tenant_helpers {
            if line.contains(&format!("{}(", helper.symbol))
                && helper.import_source.as_deref().is_none_or(|expected| {
                    facts.iter().any(|fact| {
                        fact.kind == FactKind::ImportUsed
                            && fact.name == helper.symbol
                            && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
                            && fact.value.as_deref() == Some(expected)
                    })
                })
            {
                guard_facts.push(tenant_guard_fact(
                    file_path,
                    line_number,
                    route_id.clone(),
                    &helper.symbol,
                    "scoped_helper",
                    &helper.tenant_key,
                    Some(helper.symbol.clone()),
                ));
            }
        }
    }
    guard_facts
}

fn tenant_guard_fact(
    file_path: &str,
    line_number: usize,
    route_id: String,
    name: &str,
    predicate_kind: &str,
    tenant_key: &str,
    helper_symbol: Option<String>,
) -> Fact {
    Fact {
        kind: FactKind::TenantGuardCalled,
        file_path: file_path.to_string(),
        name: name.to_string(),
        value: Some(
            json!({
                "route_id": route_id,
                "predicate_kind": predicate_kind,
                "tenant_key": tenant_key,
                "data_operation": if predicate_kind == "equality" { Some(name) } else { None },
                "helper_symbol": helper_symbol,
            })
            .to_string(),
        ),
        imported_name: helper_symbol,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

fn tenant_source_fact(
    file_path: &str,
    line_number: usize,
    route_id: String,
    variable: &str,
    metadata: TenantSourceFactMetadata<'_>,
) -> Fact {
    Fact {
        kind: FactKind::TenantSource,
        file_path: file_path.to_string(),
        name: variable.to_string(),
        value: Some(
            json!({
                "route_id": route_id,
                "source": metadata.source,
                "variable": variable,
                "tenant_key": metadata.tenant_key,
                "trusted": metadata.trusted,
                "session_variable": metadata.session_variable,
            })
            .to_string(),
        ),
        imported_name: None,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

struct TenantSourceFactMetadata<'a> {
    source: &'a str,
    tenant_key: &'a str,
    trusted: bool,
    session_variable: Option<String>,
}

fn is_session_like_variable(variable: &str) -> bool {
    let lower = variable.to_ascii_lowercase();
    lower.contains("session") || lower.contains("user") || lower.contains("token")
}

fn request_input_fact(
    file_path: &str,
    line_number: usize,
    route_id: String,
    source: &str,
    variable: String,
    key: Option<String>,
) -> Fact {
    Fact {
        kind: FactKind::RequestInputRead,
        file_path: file_path.to_string(),
        name: variable.clone(),
        value: Some(
            json!({
                "route_id": route_id,
                "source": source,
                "variable": variable,
                "key": key,
                "taint": "untrusted",
            })
            .to_string(),
        ),
        imported_name: None,
        runtime_use: None,
        start_line: line_number,
        end_line: line_number,
        start_column: 1,
        end_column: 1,
    }
}

fn assigned_variable(line: &str) -> Option<String> {
    let before_equals = line.split_once('=')?.0.trim();
    let variable = before_equals
        .strip_prefix("const ")
        .or_else(|| before_equals.strip_prefix("let "))
        .or_else(|| before_equals.strip_prefix("var "))
        .unwrap_or(before_equals)
        .trim();
    (!variable.is_empty() && variable.chars().all(is_identifier_char)).then(|| variable.to_string())
}

fn destructured_assignment_variables(lines: &[&str], line_number: usize) -> Vec<String> {
    let Some(end_line) = lines.get(line_number.saturating_sub(1)) else {
        return Vec::new();
    };
    if !end_line.contains("} =") {
        return Vec::new();
    }
    let mut start_index = None;
    for index in (0..line_number.saturating_sub(1)).rev() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with("const {")
            || trimmed.starts_with("let {")
            || trimmed.starts_with("var {")
        {
            start_index = Some(index);
            break;
        }
        if trimmed.contains(';') || trimmed.ends_with('}') {
            break;
        }
    }
    let Some(start_index) = start_index else {
        return Vec::new();
    };
    lines[start_index + 1..line_number.saturating_sub(1)]
        .iter()
        .filter_map(|line| destructured_binding_variable(line))
        .collect()
}

fn destructured_binding_variable(line: &str) -> Option<String> {
    let without_comment = line.split("//").next().unwrap_or_default();
    let trimmed = without_comment
        .trim()
        .trim_end_matches(',')
        .trim()
        .trim_start_matches("...")
        .trim();
    if trimmed.is_empty() || trimmed.contains('{') || trimmed.contains('}') {
        return None;
    }
    let variable = trimmed
        .split_once(':')
        .map(|(_, alias)| alias.trim())
        .unwrap_or(trimmed)
        .split_once('=')
        .map(|(name, _)| name.trim())
        .unwrap_or_else(|| {
            trimmed
                .split_once(':')
                .map(|(_, alias)| alias.trim())
                .unwrap_or(trimmed)
        });
    (!variable.is_empty() && variable.chars().all(is_identifier_char)).then(|| variable.to_string())
}

fn quoted_argument(line: &str, marker: &str) -> Option<String> {
    let after_marker = line.split(marker).nth(1)?;
    let quote = after_marker
        .chars()
        .find(|value| *value == '"' || *value == '\'')?;
    let after_quote = after_marker.split_once(quote)?.1;
    let value = after_quote.split_once(quote)?.0.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn identifier_prefix(value: &str) -> &str {
    value
        .split(|character: char| !is_identifier_char(character))
        .next()
        .unwrap_or("")
}

fn destructured_names(line: &str) -> Vec<String> {
    let Some(start) = line.find('{') else {
        return Vec::new();
    };
    let Some(end) = line[start + 1..].find('}') else {
        return Vec::new();
    };
    line[start + 1..start + 1 + end]
        .split(',')
        .filter_map(|part| {
            let name = part
                .split(':')
                .next()
                .unwrap_or("")
                .trim()
                .trim_start_matches("...")
                .trim();
            (!name.is_empty() && name.chars().all(is_identifier_char)).then(|| name.to_string())
        })
        .collect()
}

fn destructured_aliases(line: &str) -> Vec<(String, String)> {
    let Some(start) = line.find('{') else {
        return Vec::new();
    };
    let Some(end) = line[start + 1..].find('}') else {
        return Vec::new();
    };
    line[start + 1..start + 1 + end]
        .split(',')
        .filter_map(|part| {
            let mut pieces = part.split(':');
            let key = pieces.next()?.trim().trim_start_matches("...").trim();
            let variable = pieces.next().map(str::trim).unwrap_or(key);
            (key.chars().all(is_identifier_char) && variable.chars().all(is_identifier_char))
                .then(|| (key.to_string(), variable.to_string()))
        })
        .collect()
}

fn is_identifier_char(value: char) -> bool {
    value == '_' || value == '$' || value.is_ascii_alphanumeric()
}

fn is_middleware_file(file_path: &str) -> bool {
    file_path == "middleware.ts"
        || file_path == "middleware.js"
        || file_path.ends_with("/middleware.ts")
        || file_path.ends_with("/middleware.js")
}

fn middleware_declaration_line(lines: &[&str]) -> Option<usize> {
    lines
        .iter()
        .position(|line| line.contains("function middleware") || line.contains("middleware ="))
        .map(|index| index + 1)
}

fn protected_sink_after_line(facts: &[Fact], line: usize) -> bool {
    facts.iter().any(|fact| {
        matches!(
            fact.kind,
            FactKind::DataOperationDetected
                | FactKind::RouteReturnsResponse
                | FactKind::OutboundRequestCalled
                | FactKind::RawSqlCalled
        ) && fact.start_line > line
    })
}

fn line_is_inside_callback(lines: &[&str], line_number: usize) -> bool {
    let target_index = line_number.saturating_sub(1);
    lines
        .iter()
        .enumerate()
        .take(target_index)
        .filter(|(_, line)| {
            (line.contains("=>") && line.contains('{'))
                || line.contains(".then(")
                || line.contains(".catch(")
                || line.contains(".forEach(")
                || line.contains(".map(")
        })
        .any(|(callback_index, _)| open_brace_depth_until(lines, callback_index, target_index) > 0)
}

fn open_brace_depth_until(lines: &[&str], start_index: usize, end_index: usize) -> i32 {
    lines
        .iter()
        .take(end_index)
        .skip(start_index)
        .fold(0_i32, |depth, line| {
            depth + line.matches('{').count() as i32 - line.matches('}').count() as i32
        })
}

fn route_for_line(facts: &[Fact], line: usize) -> Option<&str> {
    facts
        .iter()
        .filter(|fact| fact.kind == FactKind::RouteDeclared)
        .find(|fact| fact.start_line <= line && line <= fact.end_line)
        .or_else(|| {
            facts
                .iter()
                .find(|fact| fact.kind == FactKind::RouteDeclared)
        })
        .map(|fact| fact.name.as_str())
}

fn is_json_response_call(fact: &Fact) -> bool {
    fact.name == "json"
        && matches!(
            fact.value.as_deref(),
            Some("Response") | Some("NextResponse") | Some("res")
        )
}

fn is_outbound_request_call(fact: &Fact) -> bool {
    fact.name == "fetch"
        || matches!(
            (fact.value.as_deref(), fact.name.as_str()),
            (
                Some("axios"),
                "get" | "post" | "put" | "patch" | "delete" | "request"
            ) | (Some("http"), "get" | "request")
                | (Some("https"), "get" | "request")
        )
}

fn outbound_request_api(fact: &Fact) -> &'static str {
    if fact.name == "fetch" {
        "fetch"
    } else if matches!(fact.value.as_deref(), Some("axios")) {
        "axios"
    } else if matches!(fact.value.as_deref(), Some("http")) {
        "http"
    } else if matches!(fact.value.as_deref(), Some("https")) {
        "https"
    } else {
        "request"
    }
}

fn outbound_url_source(line: &str, url_var: Option<&str>, security_facts: &[Fact]) -> &'static str {
    if first_call_argument_text(line).is_some_and(|argument| {
        (argument.starts_with('"') || argument.starts_with('\''))
            || (argument.starts_with('`') && !argument.contains("${"))
    }) {
        return "constant";
    }
    if contains_request_input(line) {
        return "request_input";
    }
    if let Some(url_var) = url_var
        && security_facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestInputRead && fact.name == url_var)
    {
        return "request_input";
    }
    if security_facts.iter().any(|fact| {
        fact.kind == FactKind::RequestInputRead
            && !fact.name.is_empty()
            && line
                .split(|character: char| !is_identifier_char(character))
                .any(|part| part == fact.name)
    }) {
        return "request_input";
    }
    "unknown"
}

fn contains_request_input(text: &str) -> bool {
    text.contains("request.nextUrl.searchParams.get(")
        || text.contains("new URL(request.url).searchParams.get(")
        || text.contains("request.headers.get(")
        || text.contains("cookies().get(")
        || text.contains("request.cookies.get(")
        || text.contains("params.")
        || text.contains("context.params.")
        || text.contains("request.json()")
        || text.contains("request.formData()")
        || text.contains("request.text()")
}

fn first_call_argument_text(line: &str) -> Option<&str> {
    let after_open = line.split_once('(')?.1;
    let argument = after_open.split_once(')')?.0.split(',').next()?.trim();
    (!argument.is_empty()).then_some(argument)
}

fn raw_sql_facts(file_path: &str, facts: &[Fact], lines: &[&str]) -> Vec<Fact> {
    let mut raw_sql_facts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let route = route_for_line(facts, line_number).unwrap_or("unknown");
        let route_id = format!("route:{file_path}:{route}");
        if line.contains("$queryRawUnsafe") || line.contains("$executeRawUnsafe") {
            raw_sql_facts.push(Fact {
                kind: FactKind::RawSqlCalled,
                file_path: file_path.to_string(),
                name: "raw_sql".to_string(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "sink_id": format!("raw_sql:{}:{}", file_path, line_number),
                        "query_shape": raw_sql_query_shape(line),
                        "uses_untrusted_input": true,
                    })
                    .to_string(),
                ),
                imported_name: None,
                runtime_use: None,
                start_line: line_number,
                end_line: line_number,
                start_column: 1,
                end_column: 1,
            });
        } else if line.contains("$queryRaw`")
            || line.contains("$executeRaw`")
            || (line.contains(".query(") && line.contains('['))
        {
            raw_sql_facts.push(Fact {
                kind: FactKind::ParameterizedSqlUsed,
                file_path: file_path.to_string(),
                name: "parameterized_sql".to_string(),
                value: Some(
                    json!({
                        "route_id": route_id,
                        "sink_id": format!("raw_sql:{}:{}", file_path, line_number),
                        "parameterization": if line.contains(".query(") { "placeholder_array" } else { "tagged_template_safe" },
                    })
                    .to_string(),
                ),
                imported_name: None,
                runtime_use: None,
                start_line: line_number,
                end_line: line_number,
                start_column: 1,
                end_column: 1,
            });
        }
    }
    raw_sql_facts
}

fn raw_sql_query_shape(line: &str) -> &'static str {
    if line.contains('`') && line.contains("${") {
        "template"
    } else if line.contains(" + ") {
        "concat"
    } else {
        "raw_string"
    }
}

fn cors_policy_facts(file_path: &str, facts: &[Fact], lines: &[&str]) -> Vec<Fact> {
    let Some((origin_line, origin)) = header_literal(lines, "Access-Control-Allow-Origin") else {
        return Vec::new();
    };
    let credentials = header_literal(lines, "Access-Control-Allow-Credentials")
        .is_some_and(|(_, value)| value.eq_ignore_ascii_case("true"));
    let route = route_for_line(facts, origin_line).unwrap_or("unknown");
    vec![Fact {
        kind: FactKind::CorsPolicyDeclared,
        file_path: file_path.to_string(),
        name: "cors_policy".to_string(),
        value: Some(
            json!({
                "route_id": format!("route:{file_path}:{route}"),
                "origins": origin,
                "credentials": credentials,
                "source": "route",
            })
            .to_string(),
        ),
        imported_name: None,
        runtime_use: None,
        start_line: origin_line,
        end_line: origin_line,
        start_column: 1,
        end_column: 1,
    }]
}

fn header_literal(lines: &[&str], header: &str) -> Option<(usize, String)> {
    let header_marker = format!("\"{header}\"");
    lines.iter().enumerate().find_map(|(index, line)| {
        if !line.contains(&header_marker) {
            return None;
        }
        let after_colon = line.split_once(':')?.1.trim();
        let quote = after_colon
            .chars()
            .find(|value| *value == '"' || *value == '\'')?;
        let after_quote = after_colon.split_once(quote)?.1;
        let value = after_quote.split_once(quote)?.0.trim();
        (!value.is_empty()).then(|| (index + 1, value.to_string()))
    })
}

#[cfg(test)]
mod response_argument_tests {
    use super::{call_argument_text, object_field_entries};

    /// The comma-truncation fix (TDD §5.1, discovered during D1).
    ///
    /// The `)`-at-depth-0 arm used to end with `.split(',').next()` — a depth-BLIND split
    /// applied after the depth tracking had already done its job. A top-level comma can never
    /// reach that arm, because the `,`-at-depth-0 arm returns first; so every comma still
    /// present is inside braces and belongs to the argument. Splitting on it truncated the
    /// literal at its first key.
    #[test]
    fn a_multi_key_response_literal_is_not_truncated_at_its_first_comma() {
        let line = "  res.json({ id: user.id, email: user.email, password: user.password });";
        let argument = call_argument_text(line, "json").expect("argument");
        assert_eq!(
            argument,
            "{ id: user.id, email: user.email, password: user.password }"
        );

        let fields = object_field_entries(argument)
            .into_iter()
            .map(|entry| entry.field_path)
            .collect::<Vec<_>>();
        // Before the fix this was `["id"]`, so a route leaking `password` as its third key
        // proved clean: the leak proof never saw a `response_emits_field` fact for it.
        assert_eq!(fields, vec!["id", "email", "password"]);
    }

    /// The shapes that already worked, pinned so the fix is visibly a widening. Every phase-5
    /// fixture in the repo uses the single-key form, which is why none of them could see this.
    #[test]
    fn single_argument_and_multi_argument_calls_are_unchanged() {
        assert_eq!(
            call_argument_text("  return Response.json({ user: { email } });", "json"),
            Some("{ user: { email } }")
        );
        // A genuine top-level comma still ends the first argument.
        assert_eq!(
            call_argument_text("  res.status(200).json(payload, extra);", "json"),
            Some("payload")
        );
        assert_eq!(
            call_argument_text("  res.json(serializePublicUser(user));", "json"),
            Some("serializePublicUser(user)")
        );
    }
}
