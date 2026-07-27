use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;

use crate::{
    AcceptedSecurityHelper, Fact, FactExtractError, FactKind, SecurityParserGap,
    SecurityProofResult, SecurityProofStatus, extract_typescript_facts,
    next_routes::next_api_route_identity,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6AcceptedHelper {
    pub helper_id: String,
    pub module: String,
    pub symbol: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6SsrfContract {
    pub contract_id: String,
    pub accepted_allowlist_helpers: Vec<Phase6AcceptedHelper>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6RawSqlContract {
    pub contract_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6CorsContract {
    pub contract_id: String,
    pub allowed_origins: Vec<String>,
    pub allow_credentials: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Phase6SecurityContract {
    Ssrf(Phase6SsrfContract),
    RawSql(Phase6RawSqlContract),
    Cors(Phase6CorsContract),
    Csrf {
        contract_id: String,
        accepted_helpers: Vec<AcceptedSecurityHelper>,
    },
    RateLimit {
        contract_id: String,
        accepted_helpers: Vec<AcceptedSecurityHelper>,
        route_paths: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6SecurityProof {
    pub route_id: String,
    pub file_path: String,
    pub handler_symbol: String,
    pub ssrf: Phase6SsrfProof,
    pub raw_sql: Phase6RawSqlProof,
    pub cors: Phase6CorsProof,
    pub csrf: Phase6GuardProof,
    pub rate_limit: Phase6GuardProof,
    pub parser_gaps: Vec<SecurityParserGap>,
    pub result: SecurityProofResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6SsrfProof {
    pub required: bool,
    pub proven: bool,
    pub outbound_requests: Vec<Phase6OutboundRequestProof>,
    pub allowlist_proofs: Vec<Phase6HelperProof>,
    pub missing_proof: Vec<Phase6MissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6OutboundRequestProof {
    pub fact_id: String,
    pub sink_id: String,
    pub api: String,
    pub url_source: Phase6UrlSource,
    pub start_line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase6UrlSource {
    Constant,
    RequestInput,
    Allowlisted,
    Unknown,
}

impl Phase6UrlSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase6UrlSource::Constant => "constant",
            Phase6UrlSource::RequestInput => "request_input",
            Phase6UrlSource::Allowlisted => "allowlisted",
            Phase6UrlSource::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6RawSqlProof {
    pub required: bool,
    pub proven: bool,
    pub raw_sql_calls: Vec<Phase6RawSqlCallProof>,
    pub parameterized_sql: Vec<Phase6ParameterizedSqlProof>,
    pub missing_proof: Vec<Phase6MissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6RawSqlCallProof {
    pub fact_id: String,
    pub sink_id: String,
    pub query_shape: String,
    pub uses_untrusted_input: bool,
    pub start_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6ParameterizedSqlProof {
    pub fact_id: String,
    pub sink_id: String,
    pub parameterization: String,
    pub start_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6CorsProof {
    pub required: bool,
    pub proven: bool,
    pub policies: Vec<Phase6CorsPolicyProof>,
    pub missing_proof: Vec<Phase6MissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6CorsPolicyProof {
    pub fact_id: String,
    pub origin: Option<String>,
    pub credentials: bool,
    pub dynamic_origin: bool,
    pub start_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6GuardProof {
    pub required: bool,
    pub proven: bool,
    pub guard_calls: Vec<Phase6HelperProof>,
    pub missing_proof: Vec<Phase6MissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6HelperProof {
    pub fact_id: String,
    pub helper_id: String,
    pub symbol: String,
    pub edge_id: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase6MissingProof {
    pub code: String,
    pub fact_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VarTaint {
    RequestInput,
    Allowlisted,
    DynamicRequestInput,
    Unknown,
}

pub fn build_phase6_security_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &Phase6SecurityContract,
) -> Result<Phase6SecurityProof, FactExtractError> {
    let file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let facts = extract_typescript_facts(&file_path, source)?;
    let route = facts
        .iter()
        .find(|fact| fact.kind == FactKind::RouteDeclared)
        .cloned()
        .unwrap_or(Fact {
            kind: FactKind::RouteDeclared,
            file_path: file_path.clone(),
            name: "unknown".to_string(),
            value: None,
            imported_name: None,
            start_line: 1,
            end_line: source.lines().count().max(1),
        });
    Ok(build_phase6_route_security_proof(
        &file_path, source, &facts, &route, contract,
    ))
}

pub fn build_phase6_security_proofs_for_file(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &Phase6SecurityContract,
) -> Result<Vec<Phase6SecurityProof>, FactExtractError> {
    let file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let facts = extract_typescript_facts(&file_path, source)?;
    let routes = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::RouteDeclared)
        .cloned()
        .collect::<Vec<_>>();
    Ok(routes
        .iter()
        .map(|route| build_phase6_route_security_proof(&file_path, source, &facts, route, contract))
        .collect())
}

fn build_phase6_route_security_proof(
    file_path: &str,
    source: &str,
    facts: &[Fact],
    route: &Fact,
    contract: &Phase6SecurityContract,
) -> Phase6SecurityProof {
    let route_id = format!("route:{file_path}:{}", route.name);
    let lines = source.lines().collect::<Vec<_>>();
    let mut parser_gaps = Vec::new();
    let mut ssrf = Phase6SsrfProof::not_required();
    let mut raw_sql = Phase6RawSqlProof::not_required();
    let mut cors = Phase6CorsProof::not_required();
    let mut csrf = Phase6GuardProof::not_required();
    let mut rate_limit = Phase6GuardProof::not_required();

    match contract {
        Phase6SecurityContract::Ssrf(contract) => {
            ssrf = build_ssrf_proof(file_path, &lines, facts, route, contract, &mut parser_gaps);
        }
        Phase6SecurityContract::RawSql(_) => {
            raw_sql = build_raw_sql_proof(file_path, &lines, facts, route);
        }
        Phase6SecurityContract::Cors(contract) => {
            cors = build_cors_proof(file_path, &lines, route, contract, &mut parser_gaps);
        }
        Phase6SecurityContract::Csrf {
            accepted_helpers, ..
        } => {
            if is_mutation_method(&route.name) {
                csrf = build_guard_proof(
                    file_path,
                    facts,
                    &lines,
                    route,
                    GuardProofConfig {
                        helpers: accepted_helpers,
                        protection_kind: "csrf",
                        missing_code: "missing_csrf_guard",
                        not_dominating_code: "csrf_guard_not_dominating_sink",
                    },
                );
            }
        }
        Phase6SecurityContract::RateLimit {
            accepted_helpers, ..
        } => {
            rate_limit = build_guard_proof(
                file_path,
                facts,
                &lines,
                route,
                GuardProofConfig {
                    helpers: accepted_helpers,
                    protection_kind: "rate_limit",
                    missing_code: "missing_rate_limit_guard",
                    not_dominating_code: "rate_limit_guard_not_dominating_sink",
                },
            );
        }
    }

    let has_missing = [
        &ssrf.missing_proof,
        &raw_sql.missing_proof,
        &cors.missing_proof,
        &csrf.missing_proof,
        &rate_limit.missing_proof,
    ]
    .into_iter()
    .any(|missing| !missing.is_empty());
    let proof_status = if parser_gaps.iter().any(|gap| gap.blocks_enforcement) {
        SecurityProofStatus::ParserGap
    } else if has_missing {
        SecurityProofStatus::MissingProof
    } else {
        SecurityProofStatus::Proven
    };

    Phase6SecurityProof {
        route_id,
        file_path: file_path.to_string(),
        handler_symbol: route.name.clone(),
        ssrf,
        raw_sql,
        cors,
        csrf,
        rate_limit,
        parser_gaps,
        result: SecurityProofResult { proof_status },
    }
}

fn build_ssrf_proof(
    file_path: &str,
    lines: &[&str],
    facts: &[Fact],
    route: &Fact,
    contract: &Phase6SsrfContract,
    parser_gaps: &mut Vec<SecurityParserGap>,
) -> Phase6SsrfProof {
    let imports = accepted_imports(facts, &contract.accepted_allowlist_helpers);
    let taints = variable_taints(lines, route, &imports);
    let mut outbound_requests = Vec::new();
    let mut allowlist_proofs = Vec::new();
    let mut missing_codes = BTreeSet::new();
    let mut missing_fact_ids = Vec::new();

    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        let Some((api, argument)) = outbound_call_argument(line) else {
            continue;
        };
        let (source_kind, helper_proof) =
            classify_outbound_argument(file_path, line_number, argument, &taints, &imports);
        let fact_id = fact_id(file_path, "outbound_request", line_number);
        let sink_id = sink_id(file_path, "outbound_request", line_number);
        outbound_requests.push(Phase6OutboundRequestProof {
            fact_id: fact_id.clone(),
            sink_id,
            api: api.to_string(),
            url_source: source_kind,
            start_line: line_number,
        });
        if let Some(helper_proof) = helper_proof {
            allowlist_proofs.push(helper_proof);
        }
        match source_kind {
            Phase6UrlSource::RequestInput => {
                missing_codes.insert("request_controlled_url".to_string());
                missing_fact_ids.push(fact_id);
            }
            Phase6UrlSource::Unknown if argument_is_dynamic_request(argument, &taints) => {
                missing_codes.insert("request_controlled_url".to_string());
                missing_fact_ids.push(fact_id);
                if !argument_assigned_from_known_but_unaccepted_helper(
                    lines,
                    route,
                    argument,
                    &contract.accepted_allowlist_helpers,
                ) {
                    parser_gaps.push(SecurityParserGap {
                        parser_gap_id: format!(
                            "parser_gap:{file_path}:{line_number}:unsupported_dynamic_outbound_url"
                        ),
                        code: "unsupported_dynamic_outbound_url".to_string(),
                        file_path: file_path.to_string(),
                        reason: "Unsupported dynamic outbound URL prevents deterministic allowlist proof"
                            .to_string(),
                        blocks_enforcement: true,
                    });
                }
            }
            _ => {}
        }
    }

    let proven = !outbound_requests.is_empty()
        && missing_codes.is_empty()
        && !parser_gaps
            .iter()
            .any(|gap| gap.code == "unsupported_dynamic_outbound_url");
    Phase6SsrfProof {
        required: true,
        proven,
        outbound_requests,
        allowlist_proofs,
        missing_proof: missing_codes
            .into_iter()
            .map(|code| Phase6MissingProof {
                code,
                fact_ids: missing_fact_ids.clone(),
            })
            .collect(),
    }
}

fn build_raw_sql_proof(
    file_path: &str,
    lines: &[&str],
    _facts: &[Fact],
    route: &Fact,
) -> Phase6RawSqlProof {
    let taints = variable_taints(lines, route, &BTreeMap::new());
    let mut sql_vars = BTreeMap::<String, String>::new();
    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        if let Some(var) = assigned_variable(line) {
            let shape = if line.contains('`') && line.contains("${") {
                Some("template")
            } else if line.contains(" + ") {
                Some("concat")
            } else {
                None
            };
            if let Some(shape) = shape {
                sql_vars.insert(var.to_string(), shape.to_string());
            }
        }
    }

    let mut raw_sql_calls = Vec::new();
    let mut parameterized_sql = Vec::new();
    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        if is_parameterized_sql_line(line) {
            parameterized_sql.push(Phase6ParameterizedSqlProof {
                fact_id: fact_id(file_path, "parameterized_sql", line_number),
                sink_id: sink_id(file_path, "raw_sql", line_number),
                parameterization: "placeholder_array".to_string(),
                start_line: line_number,
            });
            continue;
        }
        if is_raw_sql_line(line) {
            let argument = first_call_argument(line).unwrap_or_default();
            let query_shape = raw_sql_shape(line, argument, &sql_vars);
            let uses_untrusted_input = line_uses_request_taint(line, &taints)
                || argument
                    .split(|character: char| !is_identifier_char(character))
                    .any(|part| matches!(taints.get(part), Some(VarTaint::RequestInput)));
            raw_sql_calls.push(Phase6RawSqlCallProof {
                fact_id: fact_id(file_path, "raw_sql", line_number),
                sink_id: sink_id(file_path, "raw_sql", line_number),
                query_shape,
                uses_untrusted_input,
                start_line: line_number,
            });
        }
    }

    let unsafe_calls = raw_sql_calls
        .iter()
        .filter(|call| call.uses_untrusted_input || call.query_shape == "unknown")
        .collect::<Vec<_>>();
    let missing_proof = if unsafe_calls.is_empty() {
        Vec::new()
    } else {
        vec![Phase6MissingProof {
            code: "raw_sql_unparameterized".to_string(),
            fact_ids: unsafe_calls
                .iter()
                .map(|call| call.fact_id.clone())
                .collect::<Vec<_>>(),
        }]
    };
    Phase6RawSqlProof {
        required: true,
        proven: missing_proof.is_empty(),
        raw_sql_calls,
        parameterized_sql,
        missing_proof,
    }
}

fn build_cors_proof(
    file_path: &str,
    lines: &[&str],
    route: &Fact,
    contract: &Phase6CorsContract,
    parser_gaps: &mut Vec<SecurityParserGap>,
) -> Phase6CorsProof {
    let mut policies = Vec::new();
    let mut credentials = false;
    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        if header_line_name(line, "Access-Control-Allow-Credentials")
            && line.to_ascii_lowercase().contains("true")
        {
            credentials = true;
        }
    }
    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        if !header_line_name(line, "Access-Control-Allow-Origin") {
            continue;
        }
        let origin = static_header_value(line);
        let dynamic_origin = origin.is_none();
        if dynamic_origin {
            parser_gaps.push(SecurityParserGap {
                parser_gap_id: format!(
                    "parser_gap:{file_path}:{line_number}:unsupported_dynamic_cors_origin"
                ),
                code: "unsupported_dynamic_cors_origin".to_string(),
                file_path: file_path.to_string(),
                reason: "Dynamic CORS origin prevents deterministic policy proof".to_string(),
                blocks_enforcement: true,
            });
        }
        policies.push(Phase6CorsPolicyProof {
            fact_id: fact_id(file_path, "cors_policy", line_number),
            origin,
            credentials,
            dynamic_origin,
            start_line: line_number,
        });
    }

    let mut missing = Vec::new();
    for policy in &policies {
        if policy.dynamic_origin {
            missing.push(Phase6MissingProof {
                code: "unsupported_dynamic_cors_origin".to_string(),
                fact_ids: vec![policy.fact_id.clone()],
            });
            continue;
        }
        let Some(origin) = policy.origin.as_deref() else {
            continue;
        };
        let code = if origin == "*" && policy.credentials {
            Some("wildcard_origin_with_credentials")
        } else if !contract.allowed_origins.is_empty()
            && !contract
                .allowed_origins
                .iter()
                .any(|allowed| allowed == origin)
        {
            Some("disallowed_origin")
        } else if policy.credentials && !contract.allow_credentials {
            Some("credentials_not_allowed")
        } else {
            None
        };
        if let Some(code) = code {
            missing.push(Phase6MissingProof {
                code: code.to_string(),
                fact_ids: vec![policy.fact_id.clone()],
            });
        }
    }

    Phase6CorsProof {
        required: true,
        proven: !policies.is_empty() && missing.is_empty(),
        policies,
        missing_proof: missing,
    }
}

struct GuardProofConfig<'a> {
    helpers: &'a [AcceptedSecurityHelper],
    protection_kind: &'a str,
    missing_code: &'a str,
    not_dominating_code: &'a str,
}

fn build_guard_proof(
    file_path: &str,
    facts: &[Fact],
    lines: &[&str],
    route: &Fact,
    config: GuardProofConfig<'_>,
) -> Phase6GuardProof {
    let helpers = config.helpers;
    let protection_kind = config.protection_kind;
    let helper_imports = accepted_security_imports(facts, helpers);
    let sink_line = first_protected_sink_line(facts, lines, route);
    let mut guard_calls = Vec::new();
    for fact in facts {
        if fact.kind != FactKind::SymbolCalled
            || !route_contains(route, fact.start_line)
            || !helper_imports.contains_key(&fact.name)
        {
            continue;
        }
        let helper = helper_imports.get(&fact.name).expect("helper import");
        guard_calls.push(Phase6HelperProof {
            fact_id: fact_id(file_path, protection_kind, fact.start_line),
            helper_id: helper.helper_id.clone(),
            symbol: fact.name.clone(),
            edge_id: format!(
                "edge:{protection_kind}-dominates:{file_path}:{}",
                fact.start_line
            ),
            start_line: fact.start_line,
            end_line: fact.end_line,
        });
    }
    let dominating = sink_line.is_none_or(|sink| {
        guard_calls.iter().any(|guard| {
            guard.start_line < sink && !line_is_inside_callback(lines, guard.start_line)
        })
    });
    let proven = !guard_calls.is_empty() && dominating;
    let code = if guard_calls.is_empty() {
        config.missing_code
    } else {
        config.not_dominating_code
    };
    let missing_fact_ids = sink_line
        .map(|line| vec![fact_id(file_path, protection_kind, line)])
        .unwrap_or_else(|| vec![fact_id(file_path, protection_kind, route.start_line)]);
    let guard_fact_ids = guard_calls
        .iter()
        .map(|guard| guard.fact_id.clone())
        .collect::<Vec<_>>();
    Phase6GuardProof {
        required: true,
        proven,
        guard_calls,
        missing_proof: (!proven)
            .then(|| Phase6MissingProof {
                code: code.to_string(),
                fact_ids: if guard_fact_ids.is_empty() {
                    missing_fact_ids
                } else {
                    guard_fact_ids.into_iter().chain(missing_fact_ids).collect()
                },
            })
            .into_iter()
            .collect(),
    }
}

fn variable_taints(
    lines: &[&str],
    route: &Fact,
    allowlist_imports: &BTreeMap<String, Phase6AcceptedHelper>,
) -> BTreeMap<String, VarTaint> {
    let mut taints = BTreeMap::new();
    for line_number in route.start_line..=route.end_line {
        let line = line_at(lines, line_number);
        let Some(var) = assigned_variable(line) else {
            continue;
        };
        let rhs = line.split_once('=').map(|(_, rhs)| rhs).unwrap_or_default();
        let taint = if contains_request_input(rhs) {
            VarTaint::RequestInput
        } else if let Some((helper, argument)) = helper_call(rhs, allowlist_imports) {
            let argument_taint = identifier_taint(argument, &taints);
            if matches!(
                argument_taint,
                Some(VarTaint::RequestInput | VarTaint::DynamicRequestInput)
            ) && !helper.module.is_empty()
            {
                VarTaint::Allowlisted
            } else {
                VarTaint::Unknown
            }
        } else if let Some(argument) = first_call_argument(rhs) {
            if identifier_taint(argument, &taints).is_some_and(|taint| {
                matches!(
                    taint,
                    VarTaint::RequestInput | VarTaint::DynamicRequestInput
                )
            }) {
                VarTaint::DynamicRequestInput
            } else {
                VarTaint::Unknown
            }
        } else {
            identifier_taint(rhs.trim().trim_end_matches(';'), &taints).unwrap_or(VarTaint::Unknown)
        };
        taints.insert(var.to_string(), taint);
    }
    taints
}

fn classify_outbound_argument(
    file_path: &str,
    line_number: usize,
    argument: &str,
    taints: &BTreeMap<String, VarTaint>,
    imports: &BTreeMap<String, Phase6AcceptedHelper>,
) -> (Phase6UrlSource, Option<Phase6HelperProof>) {
    if contains_request_input(argument) {
        return (Phase6UrlSource::RequestInput, None);
    }
    if argument.starts_with('"') || argument.starts_with('\'') || argument.starts_with('`') {
        return (Phase6UrlSource::Constant, None);
    }
    if let Some((helper, _)) = helper_call(argument, imports) {
        return (
            Phase6UrlSource::Allowlisted,
            Some(Phase6HelperProof {
                fact_id: fact_id(file_path, "outbound_allowlist", line_number),
                helper_id: helper.helper_id.clone(),
                symbol: helper.symbol.clone(),
                edge_id: format!("edge:outbound-allowlist:{file_path}:{line_number}"),
                start_line: line_number,
                end_line: line_number,
            }),
        );
    }
    match identifier_taint(argument, taints) {
        Some(VarTaint::RequestInput) => (Phase6UrlSource::RequestInput, None),
        Some(VarTaint::Allowlisted) => (Phase6UrlSource::Allowlisted, None),
        Some(VarTaint::DynamicRequestInput) => (Phase6UrlSource::Unknown, None),
        _ => (Phase6UrlSource::Unknown, None),
    }
}

fn accepted_imports(
    facts: &[Fact],
    helpers: &[Phase6AcceptedHelper],
) -> BTreeMap<String, Phase6AcceptedHelper> {
    let mut imports = BTreeMap::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
    {
        for helper in helpers {
            if fact.value.as_deref() == Some(helper.module.as_str())
                && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
            {
                imports.insert(fact.name.clone(), helper.clone());
            }
        }
    }
    imports
}

fn accepted_security_imports(
    facts: &[Fact],
    helpers: &[AcceptedSecurityHelper],
) -> BTreeMap<String, AcceptedSecurityHelper> {
    let mut imports = BTreeMap::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
    {
        for helper in helpers {
            if fact.value.as_deref() == Some(helper.module.as_str())
                && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
            {
                imports.insert(fact.name.clone(), helper.clone());
            }
        }
    }
    imports
}

fn helper_call<'a, 'b>(
    text: &'b str,
    imports: &'a BTreeMap<String, Phase6AcceptedHelper>,
) -> Option<(&'a Phase6AcceptedHelper, &'b str)> {
    for (local_name, helper) in imports {
        let marker = format!("{local_name}(");
        if text.contains(&marker) {
            return first_call_argument(text).map(|argument| (helper, argument));
        }
    }
    None
}

fn argument_is_dynamic_request(argument: &str, taints: &BTreeMap<String, VarTaint>) -> bool {
    identifier_taint(argument, taints)
        .is_some_and(|taint| matches!(taint, VarTaint::DynamicRequestInput))
}

fn argument_assigned_from_known_but_unaccepted_helper(
    lines: &[&str],
    route: &Fact,
    argument: &str,
    helpers: &[Phase6AcceptedHelper],
) -> bool {
    let variable = argument.trim();
    if variable.is_empty() || !variable.chars().all(is_identifier_char) {
        return false;
    }
    (route.start_line..=route.end_line).any(|line_number| {
        let line = line_at(lines, line_number);
        assigned_variable(line) == Some(variable)
            && helpers
                .iter()
                .any(|helper| line.contains(&format!("{}(", helper.symbol)))
    })
}

fn identifier_taint(text: &str, taints: &BTreeMap<String, VarTaint>) -> Option<VarTaint> {
    let trimmed = text.trim().trim_end_matches(';');
    if let Some(taint) = taints.get(trimmed).copied() {
        return Some(taint);
    }
    trimmed
        .split(|character: char| !is_identifier_char(character))
        .find_map(|part| taints.get(part).copied())
}

fn outbound_call_argument(line: &str) -> Option<(&'static str, &str)> {
    if line.contains("fetch(") {
        return first_call_argument_for(line, "fetch(").map(|arg| ("fetch", arg));
    }
    for receiver in ["axios", "http", "https"] {
        for method in ["get", "post", "put", "patch", "delete", "request"] {
            let marker = format!("{receiver}.{method}(");
            if line.contains(&marker) {
                return first_call_argument_for(line, &marker).map(|arg| (receiver, arg));
            }
        }
    }
    None
}

fn contains_request_input(text: &str) -> bool {
    text.contains("request.nextUrl.searchParams.get(")
        || text.contains("new URL(request.url).searchParams.get(")
        || text.contains("request.headers.get(")
        || text.contains("cookies().get(")
        || text.contains("params.")
        || text.contains("context.params.")
        || text.contains("request.json()")
        || text.contains("request.formData()")
        || text.contains("request.text()")
}

fn line_uses_request_taint(line: &str, taints: &BTreeMap<String, VarTaint>) -> bool {
    contains_request_input(line)
        || line
            .split(|character: char| !is_identifier_char(character))
            .any(|part| {
                matches!(
                    taints.get(part),
                    Some(VarTaint::RequestInput | VarTaint::DynamicRequestInput)
                )
            })
}

fn is_raw_sql_line(line: &str) -> bool {
    line.contains("$queryRawUnsafe")
        || line.contains("$executeRawUnsafe")
        || line.contains("pool.query(")
        || line.contains("client.query(")
        || line.contains("db.query(")
        || line.contains("connection.query(")
        || line.contains("sequelize.query(")
}

fn is_parameterized_sql_line(line: &str) -> bool {
    (line.contains(".query(") && line.contains(", ["))
        || (line.contains(".query(") && line.contains("values: ["))
        || line.contains("$queryRaw`")
        || line.contains("$executeRaw`")
}

fn raw_sql_shape(line: &str, argument: &str, sql_vars: &BTreeMap<String, String>) -> String {
    if line.contains('`') && line.contains("${") {
        "template".to_string()
    } else if line.contains(" + ") {
        "concat".to_string()
    } else if let Some(shape) = sql_vars.get(argument.trim()) {
        shape.clone()
    } else if argument.chars().all(is_identifier_char) {
        "unknown".to_string()
    } else {
        "raw_string".to_string()
    }
}

fn header_line_name(line: &str, header: &str) -> bool {
    line.to_ascii_lowercase()
        .contains(&header.to_ascii_lowercase())
}

fn static_header_value(line: &str) -> Option<String> {
    let value_text = if line.contains(".set(") {
        line.split_once(',')?.1
    } else if header_line_name(line, "Access-Control-Allow-Origin") {
        let lower = line.to_ascii_lowercase();
        let header = "access-control-allow-origin";
        let header_start = lower.find(header)?;
        let after_header = &line[header_start + header.len()..];
        after_header.split_once(':')?.1
    } else {
        line.split_once(':')?.1
    };
    let quote = value_text
        .chars()
        .find(|value| *value == '"' || *value == '\'')?;
    let after_quote = value_text.split_once(quote)?.1;
    let value = after_quote.split_once(quote)?.0.trim();
    (!value.is_empty() && !value.eq_ignore_ascii_case("Access-Control-Allow-Origin"))
        .then(|| value.to_string())
}

fn first_protected_sink_line(facts: &[Fact], lines: &[&str], route: &Fact) -> Option<usize> {
    facts
        .iter()
        .filter(|fact| route_contains(route, fact.start_line))
        .filter(|fact| {
            matches!(
                fact.kind,
                FactKind::DataOperationDetected
                    | FactKind::RawSqlCalled
                    | FactKind::OutboundRequestCalled
            )
        })
        .map(|fact| fact.start_line)
        .chain((route.start_line..=route.end_line).filter(|line| {
            let text = line_at(lines, *line);
            text.contains("Response.json(") || text.contains("NextResponse.json(")
        }))
        .min()
}

fn line_is_inside_callback(lines: &[&str], line_number: usize) -> bool {
    lines
        .iter()
        .take(line_number.saturating_sub(1))
        .rev()
        .take_while(|line| !line.contains("export "))
        .any(|line| {
            (line.contains("=>") && line.contains('{'))
                || line.contains(".then(")
                || line.contains(".catch(")
                || line.contains(".forEach(")
                || line.contains(".map(")
        })
}

fn route_contains(route: &Fact, line: usize) -> bool {
    route.start_line <= line && line <= route.end_line
}

fn is_mutation_method(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

fn assigned_variable(line: &str) -> Option<&str> {
    let before_equals = line.split_once('=')?.0.trim();
    let variable = before_equals
        .strip_prefix("const ")
        .or_else(|| before_equals.strip_prefix("let "))
        .or_else(|| before_equals.strip_prefix("var "))
        .unwrap_or(before_equals)
        .trim();
    (!variable.is_empty() && variable.chars().all(is_identifier_char)).then_some(variable)
}

fn first_call_argument(text: &str) -> Option<&str> {
    let after_open = text.split_once('(')?.1;
    Some(after_open.split_once(')')?.0.split(',').next()?.trim())
}

fn first_call_argument_for<'a>(text: &'a str, marker: &str) -> Option<&'a str> {
    let after_marker = text.split(marker).nth(1)?;
    Some(after_marker.split_once(')')?.0.split(',').next()?.trim())
}

fn line_at<'a>(lines: &'a [&str], line_number: usize) -> &'a str {
    lines
        .get(line_number.saturating_sub(1))
        .copied()
        .unwrap_or("")
}

fn is_identifier_char(value: char) -> bool {
    value == '_' || value == '$' || value.is_ascii_alphanumeric()
}

fn fact_id(file_path: &str, kind: &str, line: usize) -> String {
    format!("fact:{kind}:{file_path}:{line}")
}

fn sink_id(file_path: &str, kind: &str, line: usize) -> String {
    format!("sink:{kind}:{file_path}:{line}")
}

impl Phase6SsrfProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            outbound_requests: Vec::new(),
            allowlist_proofs: Vec::new(),
            missing_proof: Vec::new(),
        }
    }
}

impl Phase6RawSqlProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            raw_sql_calls: Vec::new(),
            parameterized_sql: Vec::new(),
            missing_proof: Vec::new(),
        }
    }
}

impl Phase6CorsProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            policies: Vec::new(),
            missing_proof: Vec::new(),
        }
    }
}

impl Phase6GuardProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            guard_calls: Vec::new(),
            missing_proof: Vec::new(),
        }
    }
}

pub fn phase6_proof_to_json(
    proof: &Phase6SecurityProof,
    contract_kind: &str,
    contract_id: &str,
    enforcement_mode: &str,
    finding_id: Option<&str>,
) -> serde_json::Value {
    let parser_gaps = proof
        .parser_gaps
        .iter()
        .map(|gap| {
            json!({
                "parser_gap_id": gap.parser_gap_id,
                "capability": phase6_capability(contract_kind),
                "code": gap.code,
                "file_path": gap.file_path,
                "reason": gap.reason,
                "affected_contract_kinds": [contract_kind],
                "affected_route_ids": [proof.route_id],
                "missing_proof_ids": phase6_missing_codes(proof).into_iter().map(|code| format!("missing_proof:{}:{code}", proof.route_id)).collect::<Vec<_>>(),
                "blocks_enforcement": gap.blocks_enforcement
            })
        })
        .collect::<Vec<_>>();
    let missing_codes = phase6_missing_codes(proof);
    let missing_entries = phase6_missing_entries(proof);
    let missing_proof = missing_entries
        .iter()
        .map(|missing| {
            json!({
                "id": format!("missing_proof:{}:{}", proof.route_id, missing.code),
                "capability": phase6_capability(contract_kind),
                "code": missing.code,
                "blocks_enforcement": true,
                "fact_ids": missing.fact_ids,
                "graph_edge_ids": []
            })
        })
        .collect::<Vec<_>>();
    json!({
        "proof_id": format!("proof:{}:{contract_kind}", proof.route_id),
        "proof_version": "security-boundary-proof/v1",
        "route": route_json(&proof.route_id, &proof.file_path, &proof.handler_symbol),
        "contracts": [{
            "contract_id": contract_id,
            "kind": contract_kind,
            "enforcement_mode": enforcement_mode,
            "capability": "deterministic_check",
            "matched": true
        }],
        "capability_status": [{
            "name": phase6_capability(contract_kind),
            "status": if proof.result.proof_status == SecurityProofStatus::Proven { "complete" } else { "partial" },
            "can_block": true,
            "parser_gap_ids": proof.parser_gaps.iter().map(|gap| gap.parser_gap_id.clone()).collect::<Vec<_>>(),
            "missing_proof_ids": missing_codes.iter().map(|code| format!("missing_proof:{}:{code}", proof.route_id)).collect::<Vec<_>>()
        }],
        "auth": {
            "required": false,
            "proven": false,
            "proof_kind": "none",
            "trusted_guard_calls": [],
            "dominated_sinks": [],
            "undominated_sinks": []
        },
        "ssrf": ssrf_json(&proof.ssrf),
        "raw_sql": raw_sql_json(&proof.raw_sql),
        "cors": cors_json(&proof.cors),
        "csrf": guard_json(&proof.csrf),
        "rate_limit": guard_json(&proof.rate_limit),
        "evidence_refs": phase6_evidence_refs(proof, contract_kind),
        "missing_proof": missing_proof,
        "parser_gaps": parser_gaps,
        "result": {
            "proof_status": security_proof_status(proof.result.proof_status),
            "enforcement_result": if proof.result.proof_status == SecurityProofStatus::Proven { "pass" } else { enforcement_mode },
            "can_block": proof.result.proof_status != SecurityProofStatus::Proven,
            "finding_ids": finding_id.into_iter().collect::<Vec<_>>()
        }
    })
}

fn ssrf_json(proof: &Phase6SsrfProof) -> serde_json::Value {
    json!({
        "required": proof.required,
        "proven": proof.proven,
        "outbound_requests": proof.outbound_requests.iter().map(|request| json!({
            "fact_id": request.fact_id,
            "sink_id": request.sink_id,
            "api": request.api,
            "url_source": request.url_source.as_str()
        })).collect::<Vec<_>>(),
        "allowlist_proofs": proof.allowlist_proofs.iter().map(helper_json).collect::<Vec<_>>(),
        "missing_proof": proof.missing_proof.iter().map(missing_json).collect::<Vec<_>>()
    })
}

fn raw_sql_json(proof: &Phase6RawSqlProof) -> serde_json::Value {
    json!({
        "required": proof.required,
        "proven": proof.proven,
        "raw_sql_calls": proof.raw_sql_calls.iter().map(|call| json!({
            "fact_id": call.fact_id,
            "sink_id": call.sink_id,
            "query_shape": call.query_shape,
            "uses_untrusted_input": call.uses_untrusted_input
        })).collect::<Vec<_>>(),
        "parameterized_sql": proof.parameterized_sql.iter().map(|param| json!({
            "fact_id": param.fact_id,
            "sink_id": param.sink_id,
            "parameterization": param.parameterization
        })).collect::<Vec<_>>(),
        "missing_proof": proof.missing_proof.iter().map(missing_json).collect::<Vec<_>>()
    })
}

fn cors_json(proof: &Phase6CorsProof) -> serde_json::Value {
    json!({
        "required": proof.required,
        "proven": proof.proven,
        "policies": proof.policies.iter().map(|policy| json!({
            "fact_id": policy.fact_id,
            "origin": policy.origin,
            "credentials": policy.credentials,
            "dynamic_origin": policy.dynamic_origin
        })).collect::<Vec<_>>(),
        "missing_proof": proof.missing_proof.iter().map(missing_json).collect::<Vec<_>>()
    })
}

fn guard_json(proof: &Phase6GuardProof) -> serde_json::Value {
    json!({
        "required": proof.required,
        "proven": proof.proven,
        "guard_calls": proof.guard_calls.iter().map(helper_json).collect::<Vec<_>>(),
        "missing_proof": proof.missing_proof.iter().map(missing_json).collect::<Vec<_>>()
    })
}

fn helper_json(helper: &Phase6HelperProof) -> serde_json::Value {
    json!({
        "fact_id": helper.fact_id,
        "helper_id": helper.helper_id,
        "symbol": helper.symbol,
        "edge_id": helper.edge_id,
        "start_line": helper.start_line,
        "end_line": helper.end_line
    })
}

fn missing_json(missing: &Phase6MissingProof) -> serde_json::Value {
    json!({
        "code": missing.code,
        "fact_ids": missing.fact_ids
    })
}

fn phase6_missing_codes(proof: &Phase6SecurityProof) -> Vec<String> {
    [
        &proof.ssrf.missing_proof,
        &proof.raw_sql.missing_proof,
        &proof.cors.missing_proof,
        &proof.csrf.missing_proof,
        &proof.rate_limit.missing_proof,
    ]
    .into_iter()
    .flat_map(|missing| missing.iter().map(|entry| entry.code.clone()))
    .collect::<BTreeSet<_>>()
    .into_iter()
    .collect()
}

fn phase6_missing_entries(proof: &Phase6SecurityProof) -> Vec<Phase6MissingProof> {
    let mut by_code = BTreeMap::<String, BTreeSet<String>>::new();
    for missing in [
        &proof.ssrf.missing_proof,
        &proof.raw_sql.missing_proof,
        &proof.cors.missing_proof,
        &proof.csrf.missing_proof,
        &proof.rate_limit.missing_proof,
    ]
    .into_iter()
    .flat_map(|missing| missing.iter())
    {
        by_code
            .entry(missing.code.clone())
            .or_default()
            .extend(missing.fact_ids.iter().cloned());
    }
    by_code
        .into_iter()
        .map(|(code, fact_ids)| Phase6MissingProof {
            code,
            fact_ids: fact_ids.into_iter().collect(),
        })
        .collect()
}

fn phase6_evidence_refs(
    proof: &Phase6SecurityProof,
    contract_kind: &str,
) -> Vec<serde_json::Value> {
    let capability = phase6_capability(contract_kind);
    let mut refs = Vec::new();
    for request in &proof.ssrf.outbound_requests {
        refs.push(json!({
            "evidence_id": format!("evidence:{}:{}", proof.route_id, request.fact_id),
            "fact_id": request.fact_id,
            "capability": capability,
            "kind": "outbound_request_detected",
            "file_path": proof.file_path,
            "start_line": request.start_line,
            "end_line": request.start_line,
            "role": "sink"
        }));
    }
    for call in &proof.raw_sql.raw_sql_calls {
        refs.push(json!({
            "evidence_id": format!("evidence:{}:{}", proof.route_id, call.fact_id),
            "fact_id": call.fact_id,
            "capability": capability,
            "kind": "raw_sql_called",
            "file_path": proof.file_path,
            "start_line": call.start_line,
            "end_line": call.start_line,
            "role": "sink"
        }));
    }
    for policy in &proof.cors.policies {
        refs.push(json!({
            "evidence_id": format!("evidence:{}:{}", proof.route_id, policy.fact_id),
            "fact_id": policy.fact_id,
            "capability": capability,
            "kind": "cors_policy_detected",
            "file_path": proof.file_path,
            "start_line": policy.start_line,
            "end_line": policy.start_line,
            "role": "policy"
        }));
    }
    for guard in proof
        .csrf
        .guard_calls
        .iter()
        .chain(proof.rate_limit.guard_calls.iter())
    {
        refs.push(json!({
            "evidence_id": format!("evidence:{}:{}", proof.route_id, guard.fact_id),
            "fact_id": guard.fact_id,
            "graph_edge_id": guard.edge_id,
            "capability": capability,
            "kind": "security_guard_called",
            "file_path": proof.file_path,
            "start_line": guard.start_line,
            "end_line": guard.end_line,
            "role": "guard"
        }));
    }
    for gap in &proof.parser_gaps {
        refs.push(json!({
            "evidence_id": format!("evidence:{}:{}", proof.route_id, gap.parser_gap_id),
            "capability": capability,
            "kind": gap.code,
            "file_path": gap.file_path,
            "role": "parser_gap"
        }));
    }
    for missing in phase6_missing_entries(proof) {
        for fact_id in missing.fact_ids {
            refs.push(json!({
                "evidence_id": format!("evidence:{}:{fact_id}:{}", proof.route_id, missing.code),
                "fact_id": fact_id,
                "capability": capability,
                "kind": missing.code,
                "file_path": proof.file_path,
                "role": "missing_proof"
            }));
        }
    }
    refs
}

fn phase6_capability(kind: &str) -> &'static str {
    match kind {
        "api_route_forbids_untrusted_ssrf" => "outbound_request_facts",
        "api_route_forbids_raw_sql_without_params" => "raw_sql_facts",
        "api_route_cors_must_match_policy" => "cors_policy_facts",
        "api_route_requires_csrf_for_mutation" => "csrf_facts",
        "api_route_requires_rate_limit" => "rate_limit_facts",
        _ => "security_facts",
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

fn security_proof_status(status: SecurityProofStatus) -> &'static str {
    match status {
        SecurityProofStatus::Proven => "proven",
        SecurityProofStatus::MissingProof => "missing_proof",
        SecurityProofStatus::ParserGap => "parser_gap",
    }
}
