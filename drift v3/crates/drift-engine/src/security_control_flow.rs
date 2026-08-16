use crate::{Fact, FactKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DominatedSink {
    pub sink_id: String,
    pub sink_kind: String,
    pub edge_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchedMiddleware {
    pub middleware_id: String,
    pub matcher_fact_id: String,
    pub protects_route_edge_id: String,
    pub protection_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MiddlewareMismatch {
    pub middleware_id: Option<String>,
    pub reason: String,
    pub parser_gap_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedInputUse {
    pub source_input_var: String,
    pub validated_var: String,
    pub sink_fact_id: String,
    pub sink_kind: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretFlowParserGap {
    pub source_line: usize,
    pub sink_line: usize,
    pub code: String,
}

pub fn guard_dominates_straight_line_sinks(facts: &[Fact]) -> Vec<DominatedSink> {
    let Some(first_guard_line) = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::AuthGuardCalled)
        .map(|fact| fact.start_line)
        .min()
    else {
        return Vec::new();
    };

    protected_sinks(facts)
        .into_iter()
        .filter(|sink| first_guard_line < sink.start_line)
        .map(|sink| DominatedSink {
            sink_id: sink_id(sink),
            sink_kind: sink_kind(sink).to_string(),
            edge_id: format!("edge:auth-dominates:{}:{}", sink.file_path, sink.start_line),
        })
        .collect()
}

pub fn undominated_straight_line_reasons(facts: &[Fact]) -> Vec<String> {
    let first_guard_line = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::AuthGuardCalled)
        .map(|fact| fact.start_line)
        .min();

    protected_sinks(facts)
        .into_iter()
        .filter_map(|sink| match first_guard_line {
            Some(line) if line > sink.start_line => Some("guard_after_sink".to_string()),
            Some(_) => None,
            None => Some("no_guard_call".to_string()),
        })
        .collect()
}

pub fn branch_bypass_reasons(source: &str, facts: &[Fact]) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if !line.contains("if") || !line.contains('{') {
            continue;
        }
        let if_line = index + 1;
        let Some(else_line) = lines
            .iter()
            .enumerate()
            .skip(index + 1)
            .find(|(_, candidate)| candidate.contains("else") && candidate.contains('{'))
            .map(|(else_index, _)| else_index + 1)
        else {
            continue;
        };
        let else_end = closing_block_line(&lines, else_line).unwrap_or(else_line);
        let then = if_line + 1..else_line;
        let alternate = else_line + 1..else_end;
        let then_has_guard = has_fact_in_range(facts, FactKind::AuthGuardCalled, then.clone());
        let then_has_sink = has_sink_in_range(facts, then);
        let else_has_guard = has_fact_in_range(facts, FactKind::AuthGuardCalled, alternate.clone());
        let else_has_sink = has_sink_in_range(facts, alternate);

        if (then_has_guard && else_has_sink && !else_has_guard)
            || (else_has_guard && then_has_sink && !then_has_guard)
        {
            return vec!["guard_only_in_one_branch".to_string()];
        }
    }
    Vec::new()
}

pub fn conditional_guard_without_else_reasons(source: &str, facts: &[Fact]) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if !line.contains("if") || !line.contains('{') {
            continue;
        }
        let if_line = index + 1;
        let Some(block_end) = closing_block_line(&lines, if_line) else {
            continue;
        };
        let has_else = lines
            .iter()
            .skip(block_end)
            .take_while(|candidate| {
                candidate.trim().is_empty() || candidate.trim_start().starts_with('}')
            })
            .any(|candidate| candidate.contains("else"))
            || lines
                .get(block_end.saturating_sub(1))
                .is_some_and(|candidate| candidate.contains("else"));
        if has_else {
            continue;
        }
        let guarded_range = if_line + 1..block_end;
        let guard_inside_if = has_fact_in_range(facts, FactKind::AuthGuardCalled, guarded_range);
        let sink_after_if = protected_sinks(facts)
            .iter()
            .any(|fact| fact.start_line > block_end);
        if guard_inside_if && sink_after_if {
            return vec!["guard_only_in_one_branch".to_string()];
        }
    }
    Vec::new()
}

pub fn callback_boundary_reasons(source: &str, facts: &[Fact]) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let guard_in_callback = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::AuthGuardCalled)
        .any(|fact| line_is_inside_callback(&lines, fact.start_line));

    if guard_in_callback {
        vec!["callback_boundary".to_string()]
    } else {
        Vec::new()
    }
}

pub fn unsupported_dynamic_control_flow(source: &str) -> bool {
    source.contains("guards[")
        || source.contains("await guard(")
        || source.contains("computed_handler")
}

pub fn indirect_secret_flow_parser_gaps(
    source: &str,
    secret_vars: &[String],
    log_sinks: &[String],
) -> Vec<SecretFlowParserGap> {
    let lines = source.lines().collect::<Vec<_>>();
    let secret_returning_helpers = secret_returning_helpers(&lines);
    let mut gaps = Vec::new();
    for (helper_name, source_line) in secret_returning_helpers {
        for (index, line) in lines.iter().enumerate() {
            if !line.contains(&format!("{helper_name}(")) {
                continue;
            }
            let Some(assigned) = assigned_variable(line) else {
                continue;
            };
            if secret_vars.iter().any(|secret_var| secret_var == &assigned) {
                continue;
            }
            for (sink_index, sink_line) in lines.iter().enumerate().skip(index + 1) {
                if !line_uses_identifier(sink_line, &assigned) {
                    continue;
                }
                if is_response_sink_line(sink_line)
                    || log_sinks.iter().any(|sink| sink_line.contains(sink))
                {
                    gaps.push(SecretFlowParserGap {
                        source_line,
                        sink_line: sink_index + 1,
                        code: "unsupported_dynamic_control_flow".to_string(),
                    });
                }
            }
        }
    }
    gaps
}

fn secret_returning_helpers(lines: &[&str]) -> Vec<(String, usize)> {
    let mut helpers = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(after_function) = trimmed.strip_prefix("function ")
            && let Some((name, _)) = after_function.split_once('(')
            && !name.is_empty()
        {
            let end_line = closing_block_line(lines, index + 1).unwrap_or(index + 1);
            if lines
                .iter()
                .take(end_line)
                .skip(index + 1)
                .any(line_returns_secret)
            {
                helpers.push((name.to_string(), index + 1));
            }
            continue;
        }
        if let Some(name) = arrow_secret_helper_name(trimmed) {
            helpers.push((name, index + 1));
            continue;
        }
        if let Some(name) = imported_secret_helper_name(trimmed) {
            helpers.push((name, index + 1));
        }
    }
    helpers
}

fn line_returns_secret(candidate: &&str) -> bool {
    candidate.contains("return ")
        && (candidate.contains("process.env")
            || candidate.contains("config.")
            || candidate.contains("secretManager.get(")
            || candidate.contains("secret_manager.get("))
}

fn arrow_secret_helper_name(line: &str) -> Option<String> {
    if !(line.contains("=>")
        && (line.contains("process.env")
            || line.contains("config.")
            || line.contains("secretManager.get(")
            || line.contains("secret_manager.get(")))
    {
        return None;
    }
    assigned_variable(line)
}

fn imported_secret_helper_name(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with("import ") || !trimmed.contains(" from ") {
        return None;
    }
    let names = if let Some(start) = trimmed.find('{') {
        let end = trimmed[start + 1..].find('}')?;
        trimmed[start + 1..start + 1 + end]
            .split(',')
            .filter_map(|part| {
                let local = part
                    .split(" as ")
                    .nth(1)
                    .or_else(|| part.split(" as ").next())
                    .unwrap_or("")
                    .trim();
                (!local.is_empty()).then(|| local.to_string())
            })
            .collect::<Vec<_>>()
    } else {
        let after_import = trimmed.strip_prefix("import ")?;
        let name = after_import.split(" from ").next()?.trim();
        vec![name.to_string()]
    };
    names
        .into_iter()
        .find(|name| secret_helper_name_is_ambiguous(name))
}

fn secret_helper_name_is_ambiguous(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("secret")
        || normalized.contains("token")
        || normalized.contains("apikey")
        || normalized.contains("api_key")
        || normalized.contains("password")
}

fn is_response_sink_line(line: &str) -> bool {
    line.contains("Response.json(")
        || line.contains("NextResponse.json(")
        || line.contains(".json(")
}

pub fn protected_sinks(facts: &[Fact]) -> Vec<&Fact> {
    facts
        .iter()
        .filter(|fact| {
            matches!(
                fact.kind,
                FactKind::DataOperationDetected
                    | FactKind::RouteReturnsResponse
                    | FactKind::OutboundRequestCalled
                    | FactKind::RawSqlCalled
            )
        })
        .collect()
}

pub fn validated_input_uses(facts: &[Fact], lines: &[&str]) -> Vec<ValidatedInputUse> {
    let validations = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::RequestValidationCalled)
        .filter_map(validation_metadata)
        .collect::<Vec<_>>();
    let mut uses = Vec::new();
    for validation in validations {
        for sink in protected_sinks(facts)
            .into_iter()
            .filter(|sink| sink.start_line > validation.validation_line)
        {
            let sink_text = sink_source_text(lines, sink);
            let sink_uses_validated_input = if validation.requires_success_guard {
                if validation.requires_success_guard
                    && !safe_parse_success_guard_dominates(
                        lines,
                        &validation.validated_var,
                        validation.validation_line,
                        sink.start_line,
                    )
                {
                    continue;
                }
                sink_text.contains(&format!("{}.data", validation.validated_var))
                    || safe_parse_aliases(
                        lines,
                        &validation.validated_var,
                        validation.validation_line,
                        sink.start_line,
                    )
                    .iter()
                    .any(|alias| line_uses_identifier(&sink_text, alias))
            } else {
                line_uses_identifier(&sink_text, &validation.validated_var)
            };
            if !sink_uses_validated_input {
                continue;
            }
            uses.push(ValidatedInputUse {
                source_input_var: validation.source_input_var.clone(),
                validated_var: validation.validated_var.clone(),
                sink_fact_id: sink_id(sink),
                sink_kind: sink_kind(sink).to_string(),
                start_line: sink.start_line,
                end_line: sink.end_line,
            });
        }
    }
    uses
}

struct ValidationMetadata {
    source_input_var: String,
    validated_var: String,
    validation_line: usize,
    requires_success_guard: bool,
}

fn validation_metadata(fact: &Fact) -> Option<ValidationMetadata> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    let source_input_var = value.get("input_var")?.as_str()?.to_string();
    let behavior = value.get("behavior")?.as_str()?.to_string();
    let validated_var = value
        .get("result_var")
        .and_then(|result| result.as_str())
        .map(str::to_string)
        .or_else(|| (behavior == "throws").then(|| source_input_var.clone()))?;
    Some(ValidationMetadata {
        source_input_var,
        validated_var,
        validation_line: fact.start_line,
        requires_success_guard: fact.name == "safeParse",
    })
}

fn safe_parse_success_guard_dominates(
    lines: &[&str],
    result_var: &str,
    validation_line: usize,
    sink_line: usize,
) -> bool {
    let success_check = format!("{result_var}.success");
    let failure_check = format!("!{result_var}.success");
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let stripped = strip_strings_and_line_comment(line);
        if line_number <= validation_line || line_number >= sink_line || !stripped.contains("if") {
            continue;
        }
        if stripped.contains(&failure_check) {
            if line_has_exit_after_condition(&stripped, &failure_check) {
                return true;
            }
            if let Some(block_end) = closing_block_line(lines, line_number) {
                let guard_exits = lines
                    .iter()
                    .take(block_end.saturating_sub(1))
                    .skip(line_number)
                    .any(|candidate| line_is_exit_statement(candidate));
                if guard_exits && block_end < sink_line {
                    return true;
                }
            }
        }
        if stripped.contains(&success_check) && !stripped.contains(&failure_check) {
            let Some(block_end) = closing_block_line(lines, line_number) else {
                continue;
            };
            if line_number < sink_line && sink_line < block_end {
                return true;
            }
        }
    }
    false
}

fn safe_parse_aliases(
    lines: &[&str],
    result_var: &str,
    validation_line: usize,
    sink_line: usize,
) -> Vec<String> {
    let data_expr = format!("{result_var}.data");
    lines
        .iter()
        .enumerate()
        .filter(|(index, line)| {
            let line_number = index + 1;
            validation_line < line_number && line_number < sink_line && line.contains(&data_expr)
        })
        .filter_map(|(_, line)| assigned_variable(line))
        .collect()
}

fn sink_source_text(lines: &[&str], sink: &Fact) -> String {
    let start_line = sink.start_line;
    let end_line = if sink.kind == FactKind::RouteReturnsResponse {
        sink.start_line
    } else {
        sink.end_line
    };
    if start_line == 0 {
        return String::new();
    }
    lines
        .iter()
        .skip(start_line.saturating_sub(1))
        .take(end_line.saturating_sub(start_line).saturating_add(1))
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_has_exit_after_condition(line: &str, condition: &str) -> bool {
    line.split(condition)
        .nth(1)
        .is_some_and(|after| after.contains("return") || after.contains("throw"))
}

fn line_is_exit_statement(line: &str) -> bool {
    let stripped = strip_strings_and_line_comment(line);
    let trimmed = stripped.trim();
    trimmed.starts_with("return ") || trimmed == "return" || trimmed.starts_with("throw ")
}

fn strip_strings_and_line_comment(line: &str) -> String {
    let mut stripped = String::new();
    let mut chars = line.chars().peekable();
    let mut quote: Option<char> = None;
    while let Some(current) = chars.next() {
        if quote.is_none() && current == '/' && chars.peek() == Some(&'/') {
            break;
        }
        if let Some(active_quote) = quote {
            if current == '\\' {
                let _ = chars.next();
                continue;
            }
            if current == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(current, '"' | '\'' | '`') {
            quote = Some(current);
            continue;
        }
        stripped.push(current);
    }
    stripped
}

fn assigned_variable(line: &str) -> Option<String> {
    let before_equals = line.split_once('=')?.0.trim();
    let variable = before_equals
        .strip_prefix("const ")
        .or_else(|| before_equals.strip_prefix("let "))
        .or_else(|| before_equals.strip_prefix("var "))
        .unwrap_or(before_equals)
        .trim();
    (!variable.is_empty()
        && variable.chars().all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        }))
    .then(|| variable.to_string())
}

fn line_uses_identifier(line: &str, identifier: &str) -> bool {
    line.split(|character: char| {
        character != '_' && character != '$' && !character.is_ascii_alphanumeric()
    })
    .any(|token| token == identifier)
}

pub fn static_middleware_coverage(
    middleware_facts: &[Fact],
    route_file_path: &str,
    route_method: &str,
) -> (Vec<MatchedMiddleware>, Vec<MiddlewareMismatch>) {
    let Some(route_path) = route_path_from_file(route_file_path) else {
        return (
            Vec::new(),
            vec![MiddlewareMismatch {
                middleware_id: None,
                reason: "unknown_framework".to_string(),
                parser_gap_id: None,
            }],
        );
    };
    let middleware_id = middleware_facts
        .iter()
        .find(|fact| fact.kind == FactKind::MiddlewareDeclared)
        .and_then(metadata_middleware_id);
    let protection_kind = middleware_facts
        .iter()
        .find(|fact| fact.kind == FactKind::MiddlewareDeclared)
        .and_then(metadata_protection_kind)
        .unwrap_or_else(|| "unknown".to_string());

    let mut matched = Vec::new();
    let mut mismatches = Vec::new();
    for matcher in middleware_facts
        .iter()
        .filter(|fact| fact.kind == FactKind::MiddlewareMatcherDeclared)
    {
        let metadata = matcher
            .value
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok());
        let pattern = metadata
            .as_ref()
            .and_then(|value| {
                value
                    .get("path_pattern")
                    .and_then(|pattern| pattern.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| matcher.name.clone());
        let excluded = metadata
            .as_ref()
            .and_then(|value| value.get("matcher_kind"))
            .and_then(|kind| kind.as_str())
            == Some("excluded_path");
        if excluded && static_matcher_covers_path(&pattern, &route_path) {
            return (
                Vec::new(),
                vec![MiddlewareMismatch {
                    middleware_id: middleware_id.clone(),
                    reason: "path_not_matched".to_string(),
                    parser_gap_id: None,
                }],
            );
        }
        if static_matcher_covers_path(&pattern, &route_path)
            && static_matcher_covers_method(&pattern, route_method)
        {
            let middleware_id = middleware_id
                .clone()
                .unwrap_or_else(|| format!("middleware:{}", matcher.file_path));
            matched.push(MatchedMiddleware {
                matcher_fact_id: fact_id(matcher),
                protects_route_edge_id: format!(
                    "edge:middleware-protects:{}:{}",
                    middleware_id, route_file_path
                ),
                middleware_id,
                protection_kind: protection_kind.clone(),
            });
        } else if !static_matcher_covers_path(&pattern, &route_path) {
            mismatches.push(MiddlewareMismatch {
                middleware_id: middleware_id.clone(),
                reason: "path_not_matched".to_string(),
                parser_gap_id: None,
            });
        } else {
            mismatches.push(MiddlewareMismatch {
                middleware_id: middleware_id.clone(),
                reason: "method_not_matched".to_string(),
                parser_gap_id: None,
            });
        }
    }
    (matched, mismatches)
}

fn metadata_middleware_id(fact: &Fact) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    value
        .get("middleware_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn metadata_protection_kind(fact: &Fact) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    value
        .get("protection_kind")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn route_path_from_file(file_path: &str) -> Option<String> {
    if let Some(rest) = file_path
        .strip_prefix("app/")
        .and_then(|path| path.strip_suffix("/route.ts"))
    {
        return Some(format!("/{}", rest.trim_end_matches('/')));
    }
    if let Some(rest) = file_path
        .strip_prefix("pages")
        .and_then(|path| path.strip_suffix(".ts"))
    {
        return Some(rest.to_string());
    }
    None
}

fn static_matcher_covers_path(pattern: &str, route_path: &str) -> bool {
    let pattern = pattern
        .trim()
        .rsplit_once('#')
        .map(|(path, _)| path)
        .unwrap_or_else(|| pattern.trim());
    if pattern == route_path {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix("/:path*") {
        return route_path == prefix || route_path.starts_with(&format!("{prefix}/"));
    }
    if let Some(prefix) = pattern.strip_suffix("(.*)") {
        return route_path == prefix || route_path.starts_with(prefix);
    }
    false
}

fn static_matcher_covers_method(pattern: &str, route_method: &str) -> bool {
    if let Some((_, method)) = pattern.trim().rsplit_once('#') {
        method.eq_ignore_ascii_case(route_method)
    } else {
        true
    }
}

fn fact_id(fact: &Fact) -> String {
    format!(
        "fact:{}:{}:{}",
        fact.file_path, fact.kind as u8, fact.start_line
    )
}

fn sink_id(fact: &Fact) -> String {
    format!("sink:{}:{}:{}", fact.file_path, fact.start_line, fact.name)
}

fn sink_kind(fact: &Fact) -> &'static str {
    match fact.kind {
        FactKind::DataOperationDetected => "data_operation",
        FactKind::RouteReturnsResponse => "response",
        FactKind::OutboundRequestCalled => "outbound_request",
        FactKind::RawSqlCalled => "raw_sql",
        _ => "unknown",
    }
}

fn closing_block_line(lines: &[&str], start_line: usize) -> Option<usize> {
    let mut depth = 1_i32;
    for (index, line) in lines.iter().enumerate().skip(start_line) {
        depth += line.matches('{').count() as i32;
        depth -= line.matches('}').count() as i32;
        if depth == 0 {
            return Some(index + 1);
        }
    }
    None
}

fn has_fact_in_range(facts: &[Fact], kind: FactKind, range: std::ops::Range<usize>) -> bool {
    facts
        .iter()
        .any(|fact| fact.kind == kind && range.contains(&fact.start_line))
}

fn has_sink_in_range(facts: &[Fact], range: std::ops::Range<usize>) -> bool {
    protected_sinks(facts)
        .iter()
        .any(|fact| range.contains(&fact.start_line))
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
