use serde_json::Value;

use crate::{Fact, FactKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedAuthHelper {
    pub guard_id: String,
    pub symbol: String,
    pub behavior: AuthGuardBehavior,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Phase4SecurityPolicy {
    pub accepted_auth_helpers: Vec<AcceptedAuthHelper>,
    pub auth_helper_imports: Vec<AcceptedHelperImport>,
    pub authorization_helpers: Vec<AcceptedAuthorizationHelper>,
    pub tenant_helpers: Vec<AcceptedTenantHelper>,
    pub tenant_keys: Vec<String>,
    pub tenant_sources: Vec<String>,
    pub data_operations: Vec<String>,
}

impl Phase4SecurityPolicy {
    pub fn from_auth_helpers(accepted_auth_helpers: &[AcceptedAuthHelper]) -> Self {
        Self {
            accepted_auth_helpers: accepted_auth_helpers.to_vec(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedHelperImport {
    pub symbol: String,
    pub import_source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthGuardBehavior {
    Throws,
    ReturnsUser,
    ReturnsSession,
    Boolean,
    Unknown,
}

impl AuthGuardBehavior {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthGuardBehavior::Throws => "throws",
            AuthGuardBehavior::ReturnsUser => "returns_user",
            AuthGuardBehavior::ReturnsSession => "returns_session",
            AuthGuardBehavior::Boolean => "boolean",
            AuthGuardBehavior::Unknown => "unknown",
        }
    }
}

pub fn accepted_auth_helper_for_call<'a>(
    call: &Fact,
    facts: &[Fact],
    accepted_auth_helpers: &'a [AcceptedAuthHelper],
) -> Option<&'a AcceptedAuthHelper> {
    accepted_auth_helpers.iter().find(|helper| {
        facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.name == call.name
                && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
        })
    })
}

pub fn accepted_phase4_auth_helper_for_call<'a>(
    call: &Fact,
    facts: &[Fact],
    policy: &'a Phase4SecurityPolicy,
) -> Option<&'a AcceptedAuthHelper> {
    policy.accepted_auth_helpers.iter().find(|helper| {
        facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.name == call.name
                && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
                && helper_import_matches(
                    fact,
                    policy
                        .auth_helper_imports
                        .iter()
                        .find(|contract| contract.symbol == helper.symbol)
                        .and_then(|contract| contract.import_source.as_deref()),
                )
        })
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedRequestValidator {
    pub validator_id: String,
    pub symbol: String,
    pub kind: RequestValidatorKind,
    pub behavior: RequestValidatorBehavior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestValidatorKind {
    Schema,
    SchemaMethod,
    Helper,
}

impl RequestValidatorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestValidatorKind::Schema => "schema",
            RequestValidatorKind::SchemaMethod => "schema_method",
            RequestValidatorKind::Helper => "helper",
        }
    }
}

/// The one call name a candidate-sourced convention can ever name that is a **method on a schema
/// object** rather than a free function.
///
/// `is_validation_candidate_symbol` (`candidate_command.rs`) admits exactly three shapes:
/// `validate*`, `*validator*`, and the literal `safeparse`. The first two are free functions and
/// the `Helper` arm below already proves them. `safeParse` is not a free function — it is always
/// written `SomeSchema.safeParse(body)` — and the `Helper` arm's `call.value.is_none()` test
/// rejected exactly that shape, so every convention the proposer inferred from `safeParse` usage
/// proved nothing and flagged its own conforming routes.
///
/// `parse` and `parseAsync` are deliberately NOT here even though `RequestValidatorKind::Schema`
/// names them. They cannot reach this list — no proposer emits them as a validator *symbol* — and
/// admitting `parse` would let `JSON.parse(body)` satisfy a validation contract, which is a false
/// negative on a security check. The `Schema` arm handles them the safe way, by requiring the
/// receiver to be the accepted schema.
pub const SCHEMA_METHOD_VALIDATOR_SYMBOLS: &[&str] = &["safeParse"];

/// The one table that decides whether a symbol names request validation.
///
/// It has two callers on opposite sides of the scan, and they MUST agree:
///
///   - `scan_time_request_validators` (`security_facts.rs`) decides which calls the scanner emits
///     `request_validation_called` for;
///   - `push_request_validation_candidates` and the request-validation `FAMILY_SPECS` entry
///     (`candidate_command.rs`) decide what to propose from those facts.
///
/// It lives here, in the library, because `candidate_command` is a module of the BINARY - the
/// library cannot import from it, so the shared predicate cannot live there. It was briefly
/// duplicated in both places with a test asserting the two copies agreed case by case; one
/// definition is better than a checked pair, so this is the definition.
///
/// **Why the narrowness is load-bearing.** The family's nominator is `always_candidate_symbol`, so
/// every symbol carrying `request_validation_called` joins the family. This predicate is the only
/// narrowing in that path - without it the family becomes the 89-member aggregate `FAMILY_SPECS`
/// documents, containing `bulkDeleteLinks` and `addDomainToVercel`.
///
/// **Why the exclusions.** `revalidate*` is Next.js cache revalidation; `*permission*` and `*role*`
/// belong to the authorization family. Admitting any of them puts a non-validator into a family
/// whose acceptance then reads as "this route validates its input".
pub fn is_validation_candidate_symbol(symbol: &str) -> bool {
    let lower = symbol.to_ascii_lowercase();
    if lower.starts_with("revalidate") || lower.contains("permission") || lower.contains("role") {
        return false;
    }
    lower.starts_with("validate") || lower.contains("validator") || lower == "safeparse"
}

/// True when a validator symbol names a schema method rather than a free function.
pub fn is_schema_method_validator_symbol(symbol: &str) -> bool {
    SCHEMA_METHOD_VALIDATOR_SYMBOLS.contains(&symbol)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestValidatorBehavior {
    Throws,
    ReturnsParsed,
    Boolean,
    Unknown,
}

impl RequestValidatorBehavior {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestValidatorBehavior::Throws => "throws",
            RequestValidatorBehavior::ReturnsParsed => "returns_parsed",
            RequestValidatorBehavior::Boolean => "boolean",
            RequestValidatorBehavior::Unknown => "unknown",
        }
    }
}

pub fn accepted_request_validator_for_call<'a>(
    call: &Fact,
    facts: &[Fact],
    accepted_validators: &'a [AcceptedRequestValidator],
) -> Option<&'a AcceptedRequestValidator> {
    accepted_validators
        .iter()
        .find(|validator| match validator.kind {
            RequestValidatorKind::Helper => {
                call.value.is_none()
                    && (call.name == validator.symbol
                        || imported_symbol_matches(facts, &call.name, &validator.symbol))
            }
            // The accepted symbol IS the method (`safeParse`), so the receiver is whichever schema
            // this route happens to use and is not named by the convention. Requiring a receiver
            // keeps a bare `safeParse(x)` free function out of this arm - that shape belongs to
            // `Helper`.
            RequestValidatorKind::SchemaMethod => {
                call.name == validator.symbol && call.value.is_some()
            }
            RequestValidatorKind::Schema => {
                matches!(call.name.as_str(), "parse" | "parseAsync" | "safeParse")
                    && call.value.as_deref().is_some_and(|receiver| {
                        schema_receiver_matches(facts, receiver, &validator.symbol)
                    })
            }
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedPhase5Contract {
    pub sensitive_response_fields: Vec<AcceptedSensitiveResponseField>,
    pub response_serializers: Vec<AcceptedResponseSerializer>,
    pub secret_sources: Vec<String>,
    pub log_sinks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedSensitiveResponseField {
    pub field_path: String,
    pub classification: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedResponseSerializer {
    pub serializer_id: String,
    pub import_source: String,
    pub imported_name: String,
    pub local_name: Option<String>,
    pub policy: ResponseSerializerPolicy,
    pub filtered_fields: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseSerializerPolicy {
    Allowlist,
    Denylist,
}

impl ResponseSerializerPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            ResponseSerializerPolicy::Allowlist => "allowlist",
            ResponseSerializerPolicy::Denylist => "denylist",
        }
    }
}

pub fn accepted_phase5_contract_from_requires(requires: &Value) -> Option<AcceptedPhase5Contract> {
    let sensitive_response_fields = requires
        .get("sensitive_response_fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(accepted_sensitive_response_field)
        .collect::<Vec<_>>();
    let response_serializers = requires
        .get("response_serializers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(accepted_response_serializer)
        .collect::<Vec<_>>();
    let secret_sources = string_array_field(requires, "secret_sources")
        .into_iter()
        .filter(|source| matches!(source.as_str(), "env" | "config" | "secret_manager"))
        .collect::<Vec<_>>();
    let log_sinks = string_array_field(requires, "log_sinks");

    if sensitive_response_fields.is_empty()
        && response_serializers.is_empty()
        && secret_sources.is_empty()
        && log_sinks.is_empty()
    {
        return None;
    }

    Some(AcceptedPhase5Contract {
        sensitive_response_fields,
        response_serializers,
        secret_sources,
        log_sinks,
    })
}

pub fn accepted_response_serializer_for_call<'a>(
    call: &Fact,
    facts: &[Fact],
    accepted_serializers: &'a [AcceptedResponseSerializer],
) -> Option<&'a AcceptedResponseSerializer> {
    accepted_serializers.iter().find(|serializer| {
        let expected_local = serializer
            .local_name
            .as_deref()
            .unwrap_or(serializer.serializer_id.as_str());
        call.name == expected_local
            && facts.iter().any(|fact| {
                fact.kind == FactKind::ImportUsed
                    && fact.name == call.name
                    && fact.value.as_deref() == Some(serializer.import_source.as_str())
                    && fact.imported_name.as_deref() == Some(serializer.imported_name.as_str())
            })
    })
}

/// Every `source` value an accepted sensitive-response field may carry. These are **provenance**:
/// where the claim "this field is sensitive" came from, not where it is in a lifecycle.
///
/// - `contract` — hand-authored in a repo contract.
/// - `schema`   — the user wrote a `driftSensitive` marker on the field.
/// - `candidate`— the name heuristic guessed it, and no human has reviewed the guess.
/// - `accepted_inference` — a heuristic guess a human signed off on by running
///   `drift conventions accept`. Stamped at the accept path
///   (`packages/cli/src/domain/convention-candidates.ts`).
///
/// This list is the only place that decides which values parse. Adding a value anywhere else
/// without adding it here silently drops the field — the trap that made D1's first proposed fix
/// a complete no-op, because it promoted `source` to a value this allowlist rejected and nothing
/// reported an error. `sensitive_response_field_rejections` exists so that can never be silent
/// again.
pub const SENSITIVE_FIELD_SOURCES: &[&str] =
    &["contract", "schema", "candidate", "accepted_inference"];

/// Every `classification` an accepted sensitive-response field may carry.
pub const SENSITIVE_FIELD_CLASSIFICATIONS: &[&str] =
    &["pii", "credential", "token", "tenant_secret", "internal"];

fn accepted_sensitive_response_field(value: &Value) -> Option<AcceptedSensitiveResponseField> {
    let field_path = value.get("field_path")?.as_str()?.to_string();
    let classification = value.get("classification")?.as_str()?.to_string();
    if !SENSITIVE_FIELD_CLASSIFICATIONS.contains(&classification.as_str()) {
        return None;
    }
    let source = value.get("source")?.as_str()?.to_string();
    if !SENSITIVE_FIELD_SOURCES.contains(&source.as_str()) {
        return None;
    }
    Some(AcceptedSensitiveResponseField {
        field_path,
        classification,
        source,
    })
}

/// Names every `sensitive_response_fields` entry `accepted_sensitive_response_field` refused to
/// parse, and why (TDD §5.1.4).
///
/// Both allowlists above fail **closed and silent**: an unreadable entry is dropped by
/// `filter_map` and the accepted convention goes on reporting a clean pass over a field it is not
/// checking. That silence is the reason D1 could have survived its own fix — a `source` value the
/// allowlist rejected would have produced exactly the pre-fix behaviour, with nothing said. This
/// function is the counterpart that makes the drop loud; `check_command` turns each entry into an
/// engine diagnostic.
pub fn sensitive_response_field_rejections(requires: &Value) -> Vec<String> {
    let Some(entries) = requires
        .get("sensitive_response_fields")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            if accepted_sensitive_response_field(entry).is_some() {
                return None;
            }
            let label = entry
                .get("field_path")
                .and_then(Value::as_str)
                .map(|field_path| format!("field {field_path}"))
                .unwrap_or_else(|| format!("entry {index}"));
            let reason = match (
                entry.get("field_path").and_then(Value::as_str),
                entry.get("classification").and_then(Value::as_str),
                entry.get("source").and_then(Value::as_str),
            ) {
                (None, _, _) => "missing field_path".to_string(),
                (_, None, _) => "missing classification".to_string(),
                (_, Some(classification), _)
                    if !SENSITIVE_FIELD_CLASSIFICATIONS.contains(&classification) =>
                {
                    format!(
                        "unknown classification {classification:?} (expected one of {})",
                        SENSITIVE_FIELD_CLASSIFICATIONS.join(", ")
                    )
                }
                (_, _, None) => "missing source".to_string(),
                (_, _, Some(source)) => format!(
                    "unknown source {source:?} (expected one of {})",
                    SENSITIVE_FIELD_SOURCES.join(", ")
                ),
            };
            Some(format!("{label}: {reason}"))
        })
        .collect()
}

fn accepted_response_serializer(value: &Value) -> Option<AcceptedResponseSerializer> {
    let serializer_id = value.get("serializer_id")?.as_str()?.to_string();
    let import_source = value.get("import_source")?.as_str()?.to_string();
    let imported_name = value
        .get("imported_name")
        .and_then(Value::as_str)
        .unwrap_or(serializer_id.as_str())
        .to_string();
    let local_name = value
        .get("local_name")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let policy = match value.get("policy")?.as_str()? {
        "allowlist" => ResponseSerializerPolicy::Allowlist,
        "denylist" => ResponseSerializerPolicy::Denylist,
        _ => return None,
    };
    let filtered_fields = string_array_field(value, "filtered_fields");

    Some(AcceptedResponseSerializer {
        serializer_id,
        import_source,
        imported_name,
        local_name,
        policy,
        filtered_fields,
    })
}

fn string_array_field(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect()
}

fn imported_symbol_matches(facts: &[Fact], local_name: &str, accepted_symbol: &str) -> bool {
    facts.iter().any(|fact| {
        fact.kind == FactKind::ImportUsed
            && fact.name == local_name
            && fact.imported_name.as_deref() == Some(accepted_symbol)
    })
}

fn imported_symbol_matches_with_source(
    facts: &[Fact],
    local_name: &str,
    accepted_symbol: &str,
    import_source: Option<&str>,
) -> bool {
    facts.iter().any(|fact| {
        fact.kind == FactKind::ImportUsed
            && fact.name == local_name
            && fact.imported_name.as_deref() == Some(accepted_symbol)
            && helper_import_matches(fact, import_source)
    })
}

fn helper_import_matches(fact: &Fact, import_source: Option<&str>) -> bool {
    import_source.is_none_or(|expected| fact.value.as_deref() == Some(expected))
}

fn receiver_root(receiver: &str) -> &str {
    receiver.split('.').next().unwrap_or(receiver)
}

fn schema_receiver_matches(facts: &[Fact], receiver: &str, accepted_symbol: &str) -> bool {
    if receiver_root(receiver) == accepted_symbol
        || imported_symbol_matches(facts, receiver_root(receiver), accepted_symbol)
    {
        return true;
    }
    let mut parts = receiver.split('.');
    let Some(namespace) = parts.next() else {
        return false;
    };
    let Some(symbol) = parts.next() else {
        return false;
    };
    symbol == accepted_symbol
        && parts.next().is_none()
        && facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.name == namespace
                && fact.imported_name.as_deref() == Some("*")
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticMiddlewareMatcher {
    pub path_pattern: String,
    pub excluded: bool,
    pub start_line: usize,
    pub end_line: usize,
}

pub fn static_middleware_matchers(source: &str) -> Vec<StaticMiddlewareMatcher> {
    let lines = source.lines().collect::<Vec<_>>();
    let mut matchers = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if !line.contains("matcher") {
            continue;
        }
        let start_line = index + 1;
        let mut matcher_text = line.to_string();
        if line.contains('[') && !line.contains(']') {
            for next in lines.iter().skip(index + 1) {
                matcher_text.push('\n');
                matcher_text.push_str(next);
                if next.contains(']') {
                    break;
                }
            }
        }
        for value in quoted_values(&matcher_text) {
            if value.starts_with('/') || value.starts_with("!/") {
                matchers.push(StaticMiddlewareMatcher {
                    excluded: value.starts_with("!/"),
                    path_pattern: value.trim_start_matches('!').to_string(),
                    start_line,
                    end_line: start_line,
                });
            }
        }
    }
    matchers
}

pub fn dynamic_middleware_matcher_line(source: &str) -> Option<usize> {
    source.lines().enumerate().find_map(|(index, line)| {
        let trimmed = line.trim();
        if trimmed.starts_with("matcher:")
            && !trimmed.contains('"')
            && !trimmed.contains('\'')
            && !trimmed.contains('[')
        {
            Some(index + 1)
        } else {
            None
        }
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedTenantHelper {
    pub helper_id: String,
    pub symbol: String,
    pub import_source: Option<String>,
    pub tenant_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedAuthorizationHelper {
    pub guard_id: String,
    pub symbol: String,
    pub import_source: Option<String>,
    pub kind: AuthorizationHelperKind,
    pub behavior: AuthorizationHelperBehavior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorizationHelperKind {
    Role,
    Policy,
}

impl AuthorizationHelperKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthorizationHelperKind::Role => "role",
            AuthorizationHelperKind::Policy => "policy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorizationHelperBehavior {
    Throws,
    Boolean,
}

impl AuthorizationHelperBehavior {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthorizationHelperBehavior::Throws => "throws",
            AuthorizationHelperBehavior::Boolean => "boolean",
        }
    }
}

pub fn accepted_authorization_helper_for_call<'a>(
    call: &Fact,
    facts: &[Fact],
    accepted_helpers: &'a [AcceptedAuthorizationHelper],
) -> Option<&'a AcceptedAuthorizationHelper> {
    accepted_helpers.iter().find(|helper| {
        if helper.import_source.is_some() {
            return imported_symbol_matches_with_source(
                facts,
                &call.name,
                &helper.symbol,
                helper.import_source.as_deref(),
            );
        }
        call.name == helper.symbol || imported_symbol_matches(facts, &call.name, &helper.symbol)
    })
}

fn quoted_values(value: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut chars = value.char_indices().peekable();
    while let Some((_, current)) = chars.next() {
        if current != '"' && current != '\'' {
            continue;
        }
        let quote = current;
        let mut quoted = String::new();
        for (_, next) in chars.by_ref() {
            if next == quote {
                break;
            }
            quoted.push(next);
        }
        if !quoted.is_empty() {
            values.push(quoted);
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn security_phase5_contract_input_normalizes_accepted_requires() {
        let requires = json!({
            "sensitive_response_fields": [{
                "field_path": "user.email",
                "classification": "pii",
                "source": "contract"
            }],
            "response_serializers": [{
                "serializer_id": "serializePublicUser",
                "import_source": "@/lib/serializers/user",
                "imported_name": "serializePublicUser",
                "local_name": "publicUser",
                "policy": "denylist",
                "filtered_fields": ["user.email"]
            }],
            "secret_sources": ["env", "config", "secret_manager"],
            "log_sinks": ["console.error", "logger.error"]
        });
        let accepted = accepted_phase5_contract_from_requires(&requires).expect("accepted input");

        assert_eq!(
            accepted.sensitive_response_fields[0].field_path,
            "user.email"
        );
        assert_eq!(
            accepted.response_serializers[0].serializer_id,
            "serializePublicUser"
        );
        assert_eq!(accepted.secret_sources, ["env", "config", "secret_manager"]);
        assert_eq!(accepted.log_sinks, ["console.error", "logger.error"]);
    }

    #[test]
    fn security_phase5_contract_input_rejects_wrong_serializer_import_identity() {
        let requires = json!({
            "response_serializers": [{
                "serializer_id": "serializePublicUser",
                "import_source": "@/lib/serializers/user",
                "imported_name": "serializePublicUser",
                "local_name": "publicUser",
                "policy": "denylist",
                "filtered_fields": ["user.email"]
            }]
        });
        let accepted = accepted_phase5_contract_from_requires(&requires).expect("accepted input");
        let call = Fact {
            kind: FactKind::SymbolCalled,
            file_path: "app/api/users/route.ts".to_string(),
            name: "publicUser".to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 4,
            end_line: 4,
            start_column: 1,
            end_column: 1,
        };
        let wrong_import_facts = vec![Fact {
            kind: FactKind::ImportUsed,
            file_path: "app/api/users/route.ts".to_string(),
            name: "publicUser".to_string(),
            value: Some("@/lib/unsafe-serializers".to_string()),
            imported_name: Some("serializePublicUser".to_string()),
            runtime_use: None,
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1,
        }];
        assert!(
            accepted_response_serializer_for_call(
                &call,
                &wrong_import_facts,
                &accepted.response_serializers,
            )
            .is_none(),
            "wrong import path must not satisfy serializer proof"
        );

        let right_import_facts = vec![Fact {
            kind: FactKind::ImportUsed,
            file_path: "app/api/users/route.ts".to_string(),
            name: "publicUser".to_string(),
            value: Some("@/lib/serializers/user".to_string()),
            imported_name: Some("serializePublicUser".to_string()),
            runtime_use: None,
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1,
        }];
        let serializer = accepted_response_serializer_for_call(
            &call,
            &right_import_facts,
            &accepted.response_serializers,
        )
        .expect("accepted serializer");
        assert_eq!(serializer.serializer_id, "serializePublicUser");
        assert_eq!(serializer.filtered_fields, ["user.email"]);
    }
}
