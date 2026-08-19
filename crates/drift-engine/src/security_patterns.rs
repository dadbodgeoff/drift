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
    /// S4: what the CLI resolved this helper's specifier to, and how it got there.
    ///
    /// `None` means the CLI shipped no table for this helper - an older CLI, or a helper the
    /// contract gave no module for at all. Matching then behaves exactly as it did before this
    /// sprint, which is what makes the whole change revertible by reverting the TypeScript field
    /// (`unresolved_mode_falls_back_and_says_so`).
    pub identity: Option<HelperModuleIdentity>,
}

/// How an accepted helper's module identity was arrived at.
///
/// The engine mirror of `protocol::AcceptedHelperResolutionMode`. Separate from the wire type on
/// purpose: `protocol` is what deserialises, this is what the matchers reason over, and the
/// matchers live in a module that must not depend on request shapes.
///
/// **Dispatch on this, never on whether `files` is empty.** `resolve_import` only resolves into
/// the scan snapshot, so every helper that legitimately lives in `node_modules` - `next-auth`,
/// `@clerk/nextjs`, the most common real-world auth contract there is - arrives with an empty
/// `files` and always will. "Empty table, fall back to strings" would therefore retain the tier-1
/// semantics this sprint exists to remove, permanently and silently, for exactly those helpers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelperResolutionMode {
    /// Resolved inside the repo. `files` is the identity and matching compares resolved modules.
    RepoResolved,
    /// A bare package specifier that resolved to nothing - by design, not by failure. Matching
    /// stays on the exact specifier.
    External,
    /// A repo-relative specifier that resolved to nothing. Matching stays on the exact specifier
    /// too, but this one is a degradation and the proof says so.
    Unresolved,
}

impl HelperResolutionMode {
    /// The spelling this mode takes in an emitted proof - the same one the CLI sent.
    pub fn as_wire(self) -> &'static str {
        match self {
            HelperResolutionMode::RepoResolved => "repo_resolved",
            HelperResolutionMode::External => "external",
            HelperResolutionMode::Unresolved => "unresolved",
        }
    }
}

/// One accepted helper's resolved module identity.
///
/// `files` means "modules that plausibly supply this helper", NOT "modules proven to be it": the
/// re-export closure that produced it compares symbol NAMES, so a barrel re-exporting one name
/// from two modules contributes both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperModuleIdentity {
    /// The specifier as the contract typed it. What `External` and `Unresolved` match on.
    pub specifier: String,
    pub mode: HelperResolutionMode,
    pub files: Vec<String>,
    /// A package-shaped specifier that resolves to a repo file. A fact, not a verdict - it is the
    /// tsconfig-paths hijack shape and equally the shape of a workspace package or a scoped alias.
    /// Carried into the proof so a reader can see it; never a finding on its own.
    pub package_specifier_resolves_in_repo: bool,
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
                        .find(|contract| contract.symbol == helper.symbol),
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
            && import_source.is_none_or(|expected| {
                // No identity is available on this path: `AcceptedAuthorizationHelper` carries a
                // specifier of its own and `authorization_helpers` is not one of the requires
                // lists the CLI resolves, so there is nothing to dispatch on. Tier 1, honestly.
                helper_module_matches(&fact.file_path, fact.value.as_deref(), expected, None)
            })
    })
}

fn helper_import_matches(fact: &Fact, contract: Option<&AcceptedHelperImport>) -> bool {
    let Some(contract) = contract else {
        return true;
    };
    let Some(expected) = contract.import_source.as_deref() else {
        return true;
    };
    helper_module_matches(
        &fact.file_path,
        fact.value.as_deref(),
        expected,
        contract.identity.as_ref(),
    )
}

/// Does this import spelling name the accepted helper's module?
///
/// The one question every accepted-helper matcher in this engine asks, and the one it used to
/// answer with `spelling == expected`. That answer is right only when the contract's spelling and
/// the route author's spelling are the same string, which is why `../../lib/auth` and `@/lib/auth`
/// - one file - were two different helpers, and why a barrel was a third.
///
/// The rules, dispatched on `mode` and never on whether `files` is empty:
///
///   - no identity, `External`, `Unresolved`: exact specifier equality. Byte for byte what this
///     engine did before Sprint 4, so none of those three can produce a finding that did not
///     already exist, and none can accept an import that was not already accepted.
///   - `RepoResolved`: exact equality, or the spelling denotes one of the resolved `files`.
///
/// Callers pass the accepted specifier and the identity separately because the identity is
/// optional and the specifier is not: an accepted helper always has a spelling to fall back to.
pub fn helper_module_matches(
    importing_file: &str,
    spelling: Option<&str>,
    expected_specifier: &str,
    identity: Option<&HelperModuleIdentity>,
) -> bool {
    let Some(spelling) = spelling else {
        return false;
    };
    if spelling == expected_specifier {
        return true;
    }
    match identity {
        Some(identity) if identity.mode == HelperResolutionMode::RepoResolved => {
            // The mapping is derived ONCE, from the whole (specifier, files) pair, and then used
            // to read the spelling. Deriving it per candidate file instead made the re-export
            // closure unreachable: `files` for a contract naming `@/lib` is
            // `["lib/auth.ts", "lib/index.ts"]`, and `lib/auth.ts` - the entry the closure exists
            // to supply - shares no trailing segment with `@/lib`, so the per-file derivation
            // found no mapping and refused a file it was literally holding in the list.
            let Some(candidate) = candidate_module_path(
                importing_file,
                spelling,
                expected_specifier,
                &identity.files,
            ) else {
                return false;
            };
            identity.files.iter().any(|file| {
                let target = module_key(file);
                target == candidate || target.starts_with(&format!("{candidate}/"))
            })
        }
        _ => false,
    }
}

/// Does `spelling`, written in `importing_file`, denote the module at `file`?
///
/// Two spellings, two relations, and they are not the same question:
///
///   - relative (`../../lib/auth`): pure path arithmetic against the importing file. Exact, and
///     it needs nothing the engine does not have.
///   - anything else (`@/lib/auth`, `~/lib`): the engine has no tsconfig and cannot resolve an
///     alias. What it does have is the contract's OWN specifier next to the file that specifier
///     resolved to, which is a worked example of the alias mapping: `@/lib/auth` beside
///     `lib/auth.ts` says `@/` and the repo root are the same place. `spelling` is rewritten
///     through that correspondence and compared as a path. A spelling in a different namespace
///     than the contract's shares no such example and does not match.
///
/// Either way, two path relations count, and the second is the one to be careful about:
///
///   - **equal**: the spelling names the resolved module. Nothing is widened.
///   - **ancestor**: the spelling names a DIRECTORY the resolved module lives under - the barrel
///     case, `@/lib` reaching `lib/auth.ts` through `lib/index.ts`. This is the one deliberately
///     broadened acceptance in this sprint, and it is broadened in the safe direction only:
///     the route's spelling is wider than the contract's, never the other way round. It is NOT
///     the subpath relation the forbidden-import path uses. That one widens the CONTRACT, so a
///     helper accepted at `@/lib` would absorb `@/lib/attacker-controlled` and any module a
///     caller can add under that prefix becomes an accepted helper. Here the contract still names
///     exactly one module and the question is only whether the author reached it through a
///     barrel above it.
///
///     The residual it does admit, stated rather than assumed away: if `lib/index.ts` re-exports
///     some OTHER `requireUser` - not the one in `lib/auth.ts` - this accepts it. A contract that
///     names the barrel itself does better, because then the CLI's re-export closure supplies the
///     real answer in `files` and the equality relation carries it.
fn candidate_module_path(
    importing_file: &str,
    spelling: &str,
    expected_specifier: &str,
    files: &[String],
) -> Option<String> {
    let candidate = if is_relative_specifier(spelling) {
        repo_path_for_relative_specifier(importing_file, spelling)?
    } else {
        let (head, root) = contract_alias_mapping(expected_specifier, files)?;
        module_key(spelling)
            .strip_prefix(head.as_str())
            .map(|tail| format!("{root}{tail}"))?
    };
    (!candidate.is_empty()).then_some(candidate)
}

fn is_relative_specifier(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../")
}

/// A module path with the parts that are spelling rather than identity removed: the extension,
/// and the `/index` that a directory import resolves through.
fn module_key(path: &str) -> String {
    let path = path.replace('\\', "/");
    let stripped = [
        ".d.ts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
    ]
    .iter()
    .find_map(|extension| path.strip_suffix(extension))
    .unwrap_or(path.as_str());
    stripped
        .strip_suffix("/index")
        .unwrap_or(stripped)
        .to_string()
}

/// `app/api/projects/route.ts` + `../../../lib/auth` = `lib/auth`.
///
/// `None` when the specifier climbs out of the repo root, which cannot denote a file the CLI
/// resolved inside it.
fn repo_path_for_relative_specifier(importing_file: &str, spelling: &str) -> Option<String> {
    let importing_file = importing_file.replace('\\', "/");
    let directory = importing_file.rsplit_once('/').map_or("", |(head, _)| head);
    let mut parts: Vec<&str> = Vec::new();
    for segment in directory.split('/').chain(spelling.split('/')) {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            segment => parts.push(segment),
        }
    }
    Some(module_key(&parts.join("/")))
}

/// What the contract's alias head corresponds to in repo-path space, as `(head, root)`.
///
/// The engine has no tsconfig and cannot resolve an alias. What it has is the contract's own
/// specifier beside the files that specifier resolved to, which is a worked example of the
/// mapping: `@/lib/auth` next to `lib/auth.ts` says `@/` and the repo root are the same place.
///
/// **One mapping, derived from the whole list, not one per candidate.** `files` is a re-export
/// closure, and its members are chosen by what they EXPORT, not by what they are called - so for
/// a contract naming `@/lib` the list is `["lib/auth.ts", "lib/index.ts"]` and only the second
/// has anything in common with the specifier. Asking each file in turn to explain the alias, and
/// refusing the ones that cannot, threw away every closure member: `@/lib/auth` denotes
/// `lib/auth.ts`, `lib/auth.ts` is right there in `files`, and the route was still reported as
/// using an unknown helper - while the same file spelled `../../../lib/auth` was accepted, which
/// is the one-module-two-verdicts defect this sprint exists to remove, reintroduced one layer
/// down.
///
/// The anchor is whichever file shares the LONGEST trailing run of segments with the specifier.
/// Longest rather than first because a closure can contain a decoy: for `@/server/auth` over
/// `["server/auth.ts", "vendor/auth.ts"]` both share `auth`, and only the first shares
/// `server/auth`. Ties keep the earlier file, and `files` arrives sorted, so the answer is stable.
///
/// `None` when no file shares a segment with the specifier. That means the contract's spelling
/// and the repo's paths have nothing in common - a bare package name against an unrelated path -
/// and there is no example to reason from, so no non-relative spelling matches.
fn contract_alias_mapping(expected_specifier: &str, files: &[String]) -> Option<(String, String)> {
    let specifier_key = module_key(expected_specifier);
    let mut best: Option<(usize, String, String)> = None;
    for file in files {
        let target = module_key(file);
        let shared = shared_path_suffix(&specifier_key, &target);
        if shared.is_empty() {
            continue;
        }
        let segments = shared.split('/').count();
        if best.as_ref().is_none_or(|(best, _, _)| segments > *best) {
            best = Some((
                segments,
                specifier_key[..specifier_key.len() - shared.len()].to_string(),
                target[..target.len() - shared.len()].to_string(),
            ));
        }
    }
    best.map(|(_, head, root)| (head, root))
}

/// The longest suffix the two paths share, cut at a `/` boundary.
fn shared_path_suffix(left: &str, right: &str) -> String {
    let left_parts = left.split('/').collect::<Vec<_>>();
    let right_parts = right.split('/').collect::<Vec<_>>();
    let mut shared = 0;
    while shared < left_parts.len()
        && shared < right_parts.len()
        && left_parts[left_parts.len() - 1 - shared] == right_parts[right_parts.len() - 1 - shared]
    {
        shared += 1;
    }
    right_parts[right_parts.len() - shared..].join("/")
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

    fn identity(mode: HelperResolutionMode, files: &[&str]) -> HelperModuleIdentity {
        identity_for("@/lib/auth", mode, files)
    }

    fn identity_for(
        specifier: &str,
        mode: HelperResolutionMode,
        files: &[&str],
    ) -> HelperModuleIdentity {
        HelperModuleIdentity {
            specifier: specifier.to_string(),
            mode,
            files: files.iter().map(|file| (*file).to_string()).collect(),
            package_specifier_resolves_in_repo: false,
        }
    }

    /// B1: the alias mapping comes from the file that best explains the specifier, not from
    /// whichever file happens to share a segment with it.
    ///
    /// `files` is a re-export closure and can hold a decoy: `vendor/auth.ts` shares `auth` with
    /// `@/server/auth`, and `server/auth.ts` shares `server/auth`. Anchoring on the decoy makes
    /// the head `@/server/` and the root `vendor/`, a mapping that explains the contract's own
    /// specifier only by accident and refuses every other spelling in the namespace - including
    /// `@/vendor/auth`, which names a file sitting in `files`.
    ///
    /// This is the assertion the `>`-to-`<` mutation on the anchor comparison survived when the
    /// first round of these tests went in, which is why it is here.
    #[test]
    fn the_anchor_is_the_file_that_best_explains_the_specifier() {
        let route = "app/api/projects/route.ts";
        let decoyed = identity_for(
            "@/server/auth",
            HelperResolutionMode::RepoResolved,
            &["server/auth.ts", "vendor/auth.ts"],
        );
        assert!(
            helper_module_matches(
                route,
                Some("@/vendor/auth"),
                "@/server/auth",
                Some(&decoyed)
            ),
            "a closure member must be reachable through the mapping the specifier really licenses"
        );
        assert!(
            helper_module_matches(
                route,
                Some("@/server/auth"),
                "@/server/auth",
                Some(&decoyed)
            ),
            "the contract's own specifier must still match"
        );
    }

    /// S4-02: the guarantee that makes this sprint revertible by reverting the CLI field alone.
    ///
    /// With no table, matching is byte-for-byte what it was before Sprint 4: the exact specifier
    /// and nothing else. Every spelling the resolved path accepts is refused here, so a repo whose
    /// CLI stops sending the field goes back to the old answers rather than to some third
    /// behaviour that exists in neither version.
    ///
    /// `Unresolved` is the same fallback, said out loud rather than inferred. The two cases with a
    /// deliberately NON-empty `files` are the important half of this test: they are contradictory
    /// input - a mode that resolved nothing, carrying resolved files - and they are here because
    /// dispatching on `files.is_empty()` instead of on `mode` would pass every other assertion in
    /// this suite while silently retaining tier-1 matching for every external helper. Only a case
    /// where the two disagree can tell those implementations apart.
    #[test]
    fn unresolved_mode_falls_back_and_says_so() {
        let route = "app/api/projects/route.ts";
        for (label, supplied) in [
            ("no table at all", None),
            (
                "unresolved, with files it has no business having",
                Some(identity(HelperResolutionMode::Unresolved, &["lib/auth.ts"])),
            ),
            (
                "external, with files it has no business having",
                Some(identity(HelperResolutionMode::External, &["lib/auth.ts"])),
            ),
        ] {
            assert!(
                helper_module_matches(route, Some("@/lib/auth"), "@/lib/auth", supplied.as_ref()),
                "{label}: the exact specifier must still match"
            );
            assert!(
                !helper_module_matches(route, Some("@/lib"), "@/lib/auth", supplied.as_ref()),
                "{label}: a barrel must not match without a repo_resolved identity"
            );
            assert!(
                !helper_module_matches(
                    route,
                    Some("../../../lib/auth"),
                    "@/lib/auth",
                    supplied.as_ref()
                ),
                "{label}: a relative spelling must not match without a repo_resolved identity"
            );
        }
    }

    /// The same three spellings, with the identity that licenses two of them. Without this the
    /// test above passes trivially on an implementation that never matches anything.
    #[test]
    fn repo_resolved_identity_is_what_licenses_the_other_spellings() {
        let route = "app/api/projects/route.ts";
        let resolved = identity(HelperResolutionMode::RepoResolved, &["lib/auth.ts"]);
        assert!(helper_module_matches(
            route,
            Some("@/lib/auth"),
            "@/lib/auth",
            Some(&resolved)
        ));
        assert!(helper_module_matches(
            route,
            Some("@/lib"),
            "@/lib/auth",
            Some(&resolved)
        ));
        assert!(helper_module_matches(
            route,
            Some("../../../lib/auth"),
            "@/lib/auth",
            Some(&resolved)
        ));
    }

    /// The acceptance is not widened downwards, in any mode.
    ///
    /// A helper accepted at `@/lib/auth` covers `@/lib/auth`. It does not cover
    /// `@/lib/auth/attacker-controlled`, and it does not cover a sibling that merely shares a
    /// parent. That relation - the specifier plus everything beneath it - belongs to the FORBIDDEN
    /// import path, where widening only ever bans more. Reused here it would mean any module a
    /// caller can add under an accepted prefix becomes an accepted auth helper.
    #[test]
    fn an_accepted_helper_does_not_absorb_the_modules_beneath_it() {
        let route = "app/api/projects/route.ts";
        let resolved = identity(HelperResolutionMode::RepoResolved, &["lib/auth.ts"]);
        for spelling in [
            "@/lib/auth/attacker-controlled",
            "../../../lib/auth/attacker-controlled",
            "@/lib/auth-lookalike",
            "../../../lib/authorization",
        ] {
            assert!(
                !helper_module_matches(route, Some(spelling), "@/lib/auth", Some(&resolved)),
                "{spelling} must not satisfy a helper accepted at @/lib/auth"
            );
        }
    }

    /// A spelling that climbs out of the repo cannot denote a file the CLI resolved inside it, and
    /// a spelling in a namespace the contract never demonstrated has nothing to be read against.
    #[test]
    fn spellings_the_repo_cannot_account_for_do_not_match() {
        let route = "app/api/projects/route.ts";
        let resolved = identity(HelperResolutionMode::RepoResolved, &["lib/auth.ts"]);
        for spelling in ["../../../../../lib/auth", "~/lib/auth", "some-package/auth"] {
            assert!(
                !helper_module_matches(route, Some(spelling), "@/lib/auth", Some(&resolved)),
                "{spelling} must not match"
            );
        }
    }
}
