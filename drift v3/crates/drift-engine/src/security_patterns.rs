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
    Helper,
}

impl RequestValidatorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestValidatorKind::Schema => "schema",
            RequestValidatorKind::Helper => "helper",
        }
    }
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

fn accepted_sensitive_response_field(value: &Value) -> Option<AcceptedSensitiveResponseField> {
    let field_path = value.get("field_path")?.as_str()?.to_string();
    let classification = value.get("classification")?.as_str()?.to_string();
    if !matches!(
        classification.as_str(),
        "pii" | "credential" | "token" | "tenant_secret" | "internal"
    ) {
        return None;
    }
    let source = value.get("source")?.as_str()?.to_string();
    if !matches!(source.as_str(), "contract" | "schema" | "candidate") {
        return None;
    }
    Some(AcceptedSensitiveResponseField {
        field_path,
        classification,
        source,
    })
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
            start_line: 4,
            end_line: 4,
        };
        let wrong_import_facts = vec![Fact {
            kind: FactKind::ImportUsed,
            file_path: "app/api/users/route.ts".to_string(),
            name: "publicUser".to_string(),
            value: Some("@/lib/unsafe-serializers".to_string()),
            imported_name: Some("serializePublicUser".to_string()),
            start_line: 1,
            end_line: 1,
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
            start_line: 1,
            end_line: 1,
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
