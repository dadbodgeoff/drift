use std::collections::{BTreeSet, HashSet};

use sha2::{Digest, Sha256};
use tree_sitter::{Node, Parser};

use crate::{Fact, FactKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessRule {
    pub convention_id: String,
    pub forbidden_imports: Vec<String>,
    /// Repo-relative files the forbidden specifiers resolve to, supplied by the CLI.
    ///
    /// T100: on a diff-scoped check the engine sees only the changed files' graph, so it cannot
    /// work out what `@/lib/prisma` names - the imports that establish that live elsewhere in the
    /// repo. The CLI holds the whole graph and computes it there. Empty on paths that do not
    /// supply it, where matching falls back to specifier comparison as before.
    pub forbidden_module_files: Vec<String>,
    pub severity: Severity,
    pub enforcement_mode: EnforcementMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessViolation {
    pub convention_id: String,
    pub file_path: String,
    pub import_name: String,
    pub import_source: String,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementMode {
    Off,
    Brief,
    Warn,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementResult {
    None,
    Warn,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleFinding {
    pub convention_id: String,
    pub fingerprint: String,
    pub title: String,
    pub message: String,
    pub severity: Severity,
    pub enforcement_result: EnforcementResult,
    pub file_path: String,
    pub import_name: String,
    pub import_source: String,
    pub line: usize,
    /// D5.1: every offending specifier on the grouped import statement, sorted.
    ///
    /// `import_name` stays the first of these so existing evidence, fingerprints and messages
    /// for the single-specifier case are byte-identical to what they were before grouping.
    pub import_names: Vec<String>,
    /// Fingerprints an older version of this rule would have written for the same violation.
    ///
    /// D5.1 turns N per-specifier findings into one per-statement finding, which necessarily
    /// changes the identity of the multi-specifier ones. Without this, every baselined
    /// multi-specifier violation would come back as `new` on the first check after upgrade -
    /// the grandfathering break T-06 describes, arrived at from a different direction.
    pub legacy_fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaselineStatus {
    Active,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineViolation {
    pub convention_id: String,
    pub fingerprint: String,
    pub status: BaselineStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FindingStatus {
    New,
    PreExisting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifiedFinding {
    pub finding: RuleFinding,
    pub status: FindingStatus,
}

pub fn detect_direct_data_access_imports(
    facts: &[Fact],
    rule: &DirectDataAccessRule,
) -> Vec<DirectDataAccessViolation> {
    let api_route_files: HashSet<&str> = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route")
        .map(|fact| fact.file_path.as_str())
        .collect();

    facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
        .filter(|fact| api_route_files.contains(fact.file_path.as_str()))
        .filter_map(|fact| {
            let import_source = fact.value.as_ref()?;
            if !is_forbidden_import(import_source, &rule.forbidden_imports) {
                return None;
            }

            Some(DirectDataAccessViolation {
                convention_id: rule.convention_id.clone(),
                file_path: fact.file_path.clone(),
                import_name: fact.name.clone(),
                import_source: import_source.clone(),
                line: fact.start_line,
            })
        })
        .collect()
}

/// D5.1 + D5.2, with no access to the importing file's source.
///
/// Every specifier is therefore `Unresolved(source_unavailable)` and every grouped finding is
/// retained: the suppress branch requires positive proof of inertness, and no source is no
/// proof. Callers that can read the repository should use
/// [`materialize_direct_data_access_findings_with_sources`]; this one exists for the paths that
/// genuinely cannot (unit tests over a fact vector, and any check request that arrives without
/// a `repo_root`).
pub fn materialize_direct_data_access_findings(
    facts: &[Fact],
    rule: &DirectDataAccessRule,
) -> Vec<RuleFinding> {
    materialize_direct_data_access_findings_with_sources(facts, rule, &|_| None)
}

/// D5.1 (group per import statement) and D5.2 (flag only on use evidence). TDD §5.5.
///
/// `read_source` takes a repo-relative path and returns that file's text, or `None`.
pub fn materialize_direct_data_access_findings_with_sources(
    facts: &[Fact],
    rule: &DirectDataAccessRule,
    read_source: &dyn Fn(&str) -> Option<String>,
) -> Vec<RuleFinding> {
    let violations = detect_direct_data_access_imports(facts, rule);

    // D5.1. One import statement is one finding. Grouped on (file, source, line) - the line is
    // what makes two imports of the same module in one file two statements rather than one.
    //
    // Insertion-ordered rather than sorted, so the finding order out of this function is the
    // fact order it has always been; a reordering here would show up as churn in every
    // consumer that has not sorted, for no gain.
    let mut groups: Vec<ImportStatementGroup> = Vec::new();
    for violation in violations {
        let key = (
            violation.file_path.clone(),
            violation.import_source.clone(),
            violation.line,
        );
        match groups.iter_mut().find(|group| group.key == key) {
            Some(group) => group.violations.push(violation),
            None => groups.push(ImportStatementGroup {
                key,
                violations: vec![violation],
            }),
        }
    }

    // One parse per file, not one per specifier: `route.ts` with four offending specifiers on
    // two lines was otherwise parsed four times.
    let mut source_cache: Vec<(String, Option<String>)> = Vec::new();

    let mut findings = Vec::new();
    for group in groups {
        let (file_path, import_source, line) = group.key.clone();
        let convention_id = group.violations[0].convention_id.clone();

        if !source_cache.iter().any(|(path, _)| *path == file_path) {
            source_cache.push((file_path.clone(), read_source(&file_path)));
        }
        let source = source_cache
            .iter()
            .find(|(path, _)| *path == file_path)
            .and_then(|(_, source)| source.as_deref());

        // D5.2. Classify each specifier separately, then keep the ones the classifier does not
        // prove inert. A statement whose every specifier is inert produces no finding at all.
        let mut retained: Vec<(String, SpecifierUse)> = Vec::new();
        for violation in &group.violations {
            let use_evidence = classify_specifier(&file_path, source, &violation.import_name);
            if use_evidence != SpecifierUse::Inert {
                retained.push((violation.import_name.clone(), use_evidence));
            }
        }
        if retained.is_empty() {
            continue;
        }

        let mut names: Vec<String> = retained.iter().map(|(name, _)| name.clone()).collect();
        names.sort();
        names.dedup();

        let fingerprint = direct_data_access_fingerprint_for(
            &convention_id,
            &file_path,
            &names.join(","),
            &import_source,
        );
        // Every fingerprint the pre-D5.1 rule would have produced for this statement, including
        // for the specifiers D5.2 has since suppressed - a violation that was baselined and is
        // now partly suppressed must still resolve against its old identity. A single-specifier
        // group's own fingerprint is one of them, and is dropped rather than listed twice.
        let legacy_fingerprints = group
            .violations
            .iter()
            .map(direct_data_access_fingerprint)
            .filter(|legacy| *legacy != fingerprint)
            .collect::<Vec<_>>();

        let import_name = names[0].clone();
        findings.push(RuleFinding {
            fingerprint,
            title: "API route imports data access directly".to_string(),
            message: direct_data_access_message(&file_path, &names, &import_source, &retained),
            severity: rule.severity,
            enforcement_result: enforcement_result_for(rule.enforcement_mode),
            convention_id,
            file_path,
            import_name,
            import_source,
            line,
            import_names: names,
            legacy_fingerprints,
        });
    }
    findings
}

struct ImportStatementGroup {
    /// (file path, import source, line) - the identity of one import statement.
    key: (String, String, usize),
    violations: Vec<DirectDataAccessViolation>,
}

pub fn classify_findings_against_baseline(
    findings: Vec<RuleFinding>,
    baseline: &[BaselineViolation],
) -> Vec<ClassifiedFinding> {
    let active_baseline: HashSet<(&str, &str)> = baseline
        .iter()
        .filter(|violation| violation.status == BaselineStatus::Active)
        .map(|violation| {
            (
                violation.convention_id.as_str(),
                violation.fingerprint.as_str(),
            )
        })
        .collect();

    findings
        .into_iter()
        .map(|finding| {
            let status = if active_baseline
                .contains(&(finding.convention_id.as_str(), finding.fingerprint.as_str()))
            {
                FindingStatus::PreExisting
            } else {
                FindingStatus::New
            };

            ClassifiedFinding { finding, status }
        })
        .collect()
}

/// Match a forbidden import specifier.
///
/// Exact match, or a prefix that ends on a path-segment boundary. Bare `contains` was
/// wrong in both directions: forbidding `@/lib/db` also matched `@/lib/dbutils` and
/// `@scope/lib/db-legacy`, while a subpath like `@calcom/prisma/enums` genuinely should
/// match a forbidden `@calcom/prisma`. Requiring the following character to be `/`
/// keeps the subpath behaviour and drops the accidental substring hits.
///
/// Mirrored in packages/cli/src/check/rule-evaluation.ts - keep the two in step.
pub fn is_forbidden_import(import_source: &str, forbidden_imports: &[String]) -> bool {
    forbidden_imports.iter().any(|forbidden| {
        import_source == forbidden
            || import_source
                .strip_prefix(forbidden.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// The violation sentence.
///
/// S10: a bindingless `import "@/lib/prisma";` has no local name, so the general form ("X
/// imports <name> from <source>") would read "imports (side-effect) from ...", naming an
/// engine-internal sentinel as if it were the user's identifier. The side-effect form says
/// what actually happened instead, which is also the more useful instruction: there is no
/// symbol to move, the import itself has to go.
///
/// D5.1 adds the plural form, and D5.2 adds the retention clause. The singular
/// proven-invocation sentence is deliberately unchanged, byte for byte: it is what the 229
/// papermark `@/lib/prisma` findings say today, and those are held at "unchanged" by §7.
fn direct_data_access_message(
    file_path: &str,
    names: &[String],
    import_source: &str,
    retained: &[(String, SpecifierUse)],
) -> String {
    let mut message = if names
        .iter()
        .any(|name| name == crate::facts::SIDE_EFFECT_IMPORT_BINDING)
    {
        format!(
            "{file_path} imports {import_source} for its side effects, executing the data-access module directly; route modules should delegate through the accepted service/data-access layer."
        )
    } else {
        format!(
            "{} imports {} from {} directly; route modules should delegate through the accepted service/data-access layer.",
            file_path,
            names.join(", "),
            import_source
        )
    };

    // §7's gate on D5.2 is not the count of survivors but whether each survivor says what kept
    // it. A finding retained because its use could not be classified reads identically to one
    // retained because a query was proven, unless the message distinguishes them - and then
    // "retained on ambiguity" is indistinguishable from the pre-D5.2 flag-on-import behaviour
    // it is supposed to have replaced.
    let unresolved = retained
        .iter()
        .filter_map(|(name, use_evidence)| match use_evidence {
            SpecifierUse::Unresolved(reason) => Some((name.clone(), *reason)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if let Some((_, reason)) = unresolved.first() {
        let mut unresolved_names = unresolved
            .iter()
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();
        unresolved_names.sort();
        unresolved_names.dedup();
        message.push_str(&format!(
            " Use of {} could not be classified ({}), so the finding is retained rather than suppressed.",
            unresolved_names.join(", "),
            reason
        ));
    }
    message
}

fn direct_data_access_fingerprint(violation: &DirectDataAccessViolation) -> String {
    direct_data_access_fingerprint_for(
        &violation.convention_id,
        &violation.file_path,
        &violation.import_name,
        &violation.import_source,
    )
}

/// The v1 fingerprint, over whatever stands in the import-name slot.
///
/// A single-specifier group passes its one name and so hashes to exactly the value the
/// pre-grouping rule produced. A multi-specifier group passes the comma-joined sorted names,
/// which is a value no single specifier can collide with, and carries the per-specifier values
/// as legacy fingerprints so a stored baseline still matches.
fn direct_data_access_fingerprint_for(
    convention_id: &str,
    file_path: &str,
    import_name: &str,
    import_source: &str,
) -> String {
    let normalized_path = file_path.replace('\\', "/");
    let mut hasher = Sha256::new();
    hasher.update(b"direct-data-access-v1\0");
    hasher.update(convention_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(normalized_path.as_bytes());
    hasher.update(b"\0");
    hasher.update(import_name.as_bytes());
    hasher.update(b"\0");
    hasher.update(import_source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn enforcement_result_for(mode: EnforcementMode) -> EnforcementResult {
    match mode {
        EnforcementMode::Off | EnforcementMode::Brief => EnforcementResult::None,
        EnforcementMode::Warn => EnforcementResult::Warn,
        EnforcementMode::Block => EnforcementResult::Block,
    }
}

// --- D5.2: invocation evidence -----------------------------------------------------------

/// What the importing file's AST proves about one specifier imported from a forbidden module.
///
/// TDD §5.5 resolves v1's posture conflict by splitting it in two, and the split is the whole
/// point: **suppress on absence of evidence, retain on ambiguity of evidence**. They are
/// different states, and one confidence number cannot hold both.
///
/// - [`SpecifierUse::Inert`] — every value-position occurrence is a terminal read. `ItemType`
///   in `req.query.i === ItemType.FOLDER` is a generated enum constant; there is nothing here
///   to call, and no reachable way for this specifier to touch the datastore. Absence.
/// - [`SpecifierUse::Unresolved`] — the specifier is used in a way this classifier cannot
///   follow. Ambiguity, and the prefer-FP-over-FN default holds: retain.
/// - [`SpecifierUse::Invocation`] — positive evidence: called, constructed, or a member call.
///
/// Why this is the opposite trade-off from D4, which the two would otherwise contradict: D4
/// narrows a *name* heuristic, where a miss degrades to a candidate gap somebody can see. D5.2
/// widens on *use* evidence, where a miss is a datastore access nobody is enforcing and nobody
/// is told about. Different failure costs, different defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecifierUse {
    Invocation(&'static str),
    Unresolved(&'static str),
    Inert,
}

/// The importing file could not be read - no `repo_root`, or the path does not resolve.
pub const UNRESOLVED_SOURCE_UNAVAILABLE: &str = "source_unavailable";
/// The importing file was read but did not parse.
pub const UNRESOLVED_SOURCE_UNPARSED: &str = "source_unparsed";
/// `prisma[operation]` - the member is computed, so no syntactic reading of the use exists.
pub const UNRESOLVED_DYNAMIC_MEMBER: &str = "dynamic_member_access";
/// The binding leaves this module (argument, return, object property, …) without being called
/// here, so what happens to it is decided somewhere this rule is not looking.
pub const UNRESOLVED_REFERENCE_ESCAPES: &str = "reference_escapes";
/// The file parsed, but no value-position occurrence of the binding was found in it.
///
/// This is a disagreement between the fact extractor (which saw the import) and this classifier
/// (which cannot see the use), not evidence of inertness — so it retains. See the fall-through
/// in [`classify_specifier_use`].
pub const UNRESOLVED_NO_USE_FOUND: &str = "no_use_found";

const INVOCATION_DIRECT_CALL: &str = "direct_call";
const INVOCATION_MEMBER_CALL: &str = "member_call";
const INVOCATION_NEW: &str = "new_instantiation";
const INVOCATION_ALIASED_CALL: &str = "aliased_call";
const INVOCATION_SIDE_EFFECT: &str = "side_effect_import";

/// How many rounds the alias fixpoint runs before giving up.
///
/// `const a = prisma; const b = a; const c = b; c.user.findMany()` needs three. Eight is past
/// anything written on purpose, and the bound is here because the alternative to a bound is a
/// pathological input deciding how long a check takes.
const ALIAS_ROUNDS: usize = 8;

fn classify_specifier(file_path: &str, source: Option<&str>, binding: &str) -> SpecifierUse {
    // S10. A bindingless `import "@/lib/prisma";` executes the module. That IS the datastore
    // access - there is no binding whose use could be inert - so it never reaches the AST pass.
    if binding == crate::facts::SIDE_EFFECT_IMPORT_BINDING {
        return SpecifierUse::Invocation(INVOCATION_SIDE_EFFECT);
    }
    let Some(source) = source else {
        return SpecifierUse::Unresolved(UNRESOLVED_SOURCE_UNAVAILABLE);
    };
    classify_specifier_use(file_path, source, binding)
}

/// Classify one imported binding's use across a file.
///
/// Separate from [`classify_specifier`] and public so it can be unit-tested directly on a
/// source string, without a fact vector or a repository around it.
pub fn classify_specifier_use(file_path: &str, source: &str, binding: &str) -> SpecifierUse {
    let mut parser = Parser::new();
    let language = if file_path.ends_with(".tsx") || file_path.ends_with(".jsx") {
        tree_sitter_typescript::LANGUAGE_TSX
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT
    };
    if parser.set_language(&language.into()).is_err() {
        return SpecifierUse::Unresolved(UNRESOLVED_SOURCE_UNPARSED);
    }
    let Some(tree) = parser.parse(source, None) else {
        return SpecifierUse::Unresolved(UNRESOLVED_SOURCE_UNPARSED);
    };
    let bytes = source.as_bytes();
    let root = tree.root_node();

    let mut tainted: BTreeSet<String> = BTreeSet::from([binding.to_string()]);
    let mut invocation: Option<&'static str> = None;
    let mut unresolved: Option<&'static str> = None;
    // Occurrences this classifier actually read and proved terminal. Suppression is licensed by
    // this count being non-zero, never by the mere absence of an invocation - see below.
    let mut inert_evidence: usize = 0;

    // A tree with ERROR nodes parsed, but not all of it. `Parser::parse` returning `Some` is not
    // proof the file was understood: tree-sitter recovers from a syntax it does not know by
    // wrapping the region in an ERROR node, and identifiers inside that region are not reliably
    // reachable as `identifier` nodes. Occurrences therefore go MISSING rather than misclassify,
    // which lands on the suppress branch - failing open on exactly the files the parser
    // understood least.
    if root.has_error() {
        unresolved.get_or_insert(UNRESOLVED_SOURCE_UNPARSED);
    }

    for _ in 0..ALIAS_ROUNDS {
        let before = tainted.len();
        let occurrences = tainted_occurrences(root, bytes, &tainted);
        // Snapshot: classification adds aliases, and an alias discovered mid-pass must not
        // change which occurrences this pass was iterating over.
        let mut discovered: BTreeSet<String> = BTreeSet::new();
        for occurrence in occurrences {
            let is_alias = node_text(occurrence, bytes).as_deref() != Some(binding);
            match classify_occurrence(occurrence, bytes, &mut discovered) {
                SpecifierUse::Invocation(reason) => {
                    let reason = if is_alias && reason == INVOCATION_DIRECT_CALL {
                        INVOCATION_ALIASED_CALL
                    } else {
                        reason
                    };
                    invocation.get_or_insert(reason);
                }
                SpecifierUse::Unresolved(reason) => {
                    unresolved.get_or_insert(reason);
                }
                SpecifierUse::Inert => inert_evidence += 1,
            }
        }
        tainted.extend(discovered);
        if tainted.len() == before {
            break;
        }
    }

    // Invocation outranks ambiguity because both retain and only the wording differs: saying
    // "could not be classified" about a `findMany()` we did classify would be a lie in the
    // direction that makes the next reader distrust the ones that are true.
    if let Some(reason) = invocation {
        return SpecifierUse::Invocation(reason);
    }
    if let Some(reason) = unresolved {
        return SpecifierUse::Unresolved(reason);
    }
    // Suppression requires POSITIVE PROOF of inertness, and the proof is at least one
    // value-position occurrence this classifier read and found terminal.
    //
    // Falling through to `Inert` on zero occurrences was the third failure-open path. Reaching
    // here having seen nothing does not mean the specifier is inert; it means the fact extractor
    // and this classifier disagree that the binding is even present - a different parse, a
    // binding form `tainted_occurrences` does not model, a path that resolved to the wrong file.
    // Every one of those is absence of UNDERSTANDING, and §5.5 routes that to the retain branch.
    if inert_evidence == 0 {
        return SpecifierUse::Unresolved(UNRESOLVED_NO_USE_FOUND);
    }
    SpecifierUse::Inert
}

/// Every value-position occurrence of a tainted name, import clauses excluded.
///
/// Import clauses are excluded because a binding's own import is not a use of it - counting it
/// would make every import self-evidencing, which is precisely the pre-D5.2 behaviour.
fn tainted_occurrences<'tree>(
    root: Node<'tree>,
    source: &[u8],
    tainted: &BTreeSet<String>,
) -> Vec<Node<'tree>> {
    let mut found = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "import_statement" {
            continue;
        }
        if node.kind() == "identifier"
            && let Some(text) = node_text(node, source)
            && tainted.contains(&text)
            && !is_declaration_name(node)
        {
            found.push(node);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }
    found
}

/// True when this identifier is the name being *declared* rather than a reference to it.
///
/// Without this, `const prisma = ...` in an unrelated scope, or a parameter named after the
/// import, reads as a use of the import.
fn is_declaration_name(node: Node<'_>) -> bool {
    let Some(parent) = node.parent() else {
        return false;
    };
    matches!(
        parent.kind(),
        "variable_declarator"
            | "function_declaration"
            | "class_declaration"
            | "required_parameter"
            | "optional_parameter"
    ) && parent.child_by_field_name("name") == Some(node)
        || parent.kind() == "required_parameter"
            && parent.child_by_field_name("pattern") == Some(node)
        || parent.kind() == "optional_parameter"
            && parent.child_by_field_name("pattern") == Some(node)
}

fn classify_occurrence(
    occurrence: Node<'_>,
    source: &[u8],
    discovered: &mut BTreeSet<String>,
) -> SpecifierUse {
    let Some(parent) = occurrence.parent() else {
        return SpecifierUse::Inert;
    };
    match parent.kind() {
        "call_expression" if parent.child_by_field_name("function") == Some(occurrence) => {
            SpecifierUse::Invocation(INVOCATION_DIRECT_CALL)
        }
        "new_expression" if parent.child_by_field_name("constructor") == Some(occurrence) => {
            SpecifierUse::Invocation(INVOCATION_NEW)
        }
        "subscript_expression" if parent.child_by_field_name("object") == Some(occurrence) => {
            SpecifierUse::Unresolved(UNRESOLVED_DYNAMIC_MEMBER)
        }
        "member_expression" if parent.child_by_field_name("object") == Some(occurrence) => {
            classify_member_chain(parent, source, discovered)
        }
        // The bare binding in any other position. Not a member read - the whole data-access
        // surface is what moves - so an escape here is unresolved, not inert.
        _ => classify_value_consumption(occurrence, source, discovered, false),
    }
}

/// Walk to the top of a `a.b.c` chain and ask what is done with it.
fn classify_member_chain(
    member: Node<'_>,
    source: &[u8],
    discovered: &mut BTreeSet<String>,
) -> SpecifierUse {
    let mut top = member;
    while let Some(parent) = top.parent() {
        match parent.kind() {
            "member_expression" if parent.child_by_field_name("object") == Some(top) => {
                top = parent;
            }
            // `prisma.user[operation]()` - computed at the far end of a static prefix. Still
            // unclassifiable, and the static prefix does not make it less so.
            "subscript_expression" if parent.child_by_field_name("object") == Some(top) => {
                return SpecifierUse::Unresolved(UNRESOLVED_DYNAMIC_MEMBER);
            }
            _ => break,
        }
    }
    match top.parent() {
        Some(parent)
            if parent.kind() == "call_expression"
                && parent.child_by_field_name("function") == Some(top) =>
        {
            SpecifierUse::Invocation(INVOCATION_MEMBER_CALL)
        }
        Some(parent)
            if parent.kind() == "new_expression"
                && parent.child_by_field_name("constructor") == Some(top) =>
        {
            SpecifierUse::Invocation(INVOCATION_NEW)
        }
        // A member READ. `LinkType.GROUP` is a value, not a handle; the read itself touches
        // nothing. What matters is whether the read result is later called, which is what the
        // alias taint below answers.
        _ => classify_value_consumption(top, source, discovered, true),
    }
}

/// What is done with a value: bound to a name (taint it), compared (inert), or let go.
///
/// `is_member_read` is the one asymmetry, and it is deliberate. When the thing let go is the
/// binding itself (`countUsers(prisma)`) the callee receives the entire data-access surface and
/// can do anything with it, so that is unresolved. When it is a member read
/// (`{ audience: LinkAudienceType.GROUP }`) the callee receives one value; treating that as
/// unresolved would retain essentially every generated-enum import, which is the whole
/// population D5.2 exists to suppress.
///
/// The residual gap, stated rather than hidden: `runQuery(prisma.user.findMany)` - a method
/// reference passed straight out as an argument, never bound to a name - classifies inert and
/// is suppressed. Binding it first (`const f = prisma.user.findMany; runQuery(f)`) is caught,
/// because then the alias exists to be tracked.
fn classify_value_consumption(
    node: Node<'_>,
    source: &[u8],
    discovered: &mut BTreeSet<String>,
    is_member_read: bool,
) -> SpecifierUse {
    let terminal = if is_member_read {
        SpecifierUse::Inert
    } else {
        SpecifierUse::Unresolved(UNRESOLVED_REFERENCE_ESCAPES)
    };
    let mut current = node;
    loop {
        let Some(parent) = current.parent() else {
            return terminal;
        };
        match parent.kind() {
            // Wrappers that neither consume nor move the value.
            "parenthesized_expression"
            | "await_expression"
            | "non_null_expression"
            | "as_expression"
            | "satisfies_expression"
            | "type_assertion"
            | "ternary_expression" => current = parent,
            // A comparison or a unary operator consumes the value and produces a boolean (or
            // `undefined`, for `void`). Nothing survives it that could be invoked.
            //
            // This returns `terminal`, NOT a hardcoded `Inert`, and that distinction is the D5.2
            // regression fix. `is_member_read` is the whole basis on which this classifier is
            // entitled to suppress: a member READ of a generated enum (`ItemType.FOLDER`) is one
            // value and proving it inert is proving something real. The bare binding is the
            // entire data-access surface, and consuming it here proves only that THIS expression
            // does not call it - not that the import is inert. Hardcoding `Inert` in these two
            // arms discarded that asymmetry, and it is what made `const __h = prisma; void __h;`
            // - the canonical shape every evasion cell uses to mark a binding as used - classify
            // inert and suppress a genuine violation on all seven eval repos.
            "binary_expression" if is_comparison(parent, source) => return terminal,
            "unary_expression" => return terminal,
            // Anything else binary (`prisma ?? fallback`, `prisma || legacy`) passes a value
            // through, so keep walking rather than declaring it consumed.
            "binary_expression" => current = parent,
            "variable_declarator" if parent.child_by_field_name("value") == Some(current) => {
                match parent.child_by_field_name("name") {
                    Some(name) => {
                        collect_bound_names(name, source, discovered);
                        return SpecifierUse::Inert;
                    }
                    None => return terminal,
                }
            }
            "assignment_expression" if parent.child_by_field_name("right") == Some(current) => {
                match parent.child_by_field_name("left") {
                    Some(left) if left.kind() == "identifier" => {
                        collect_bound_names(left, source, discovered);
                        return SpecifierUse::Inert;
                    }
                    // `someObject.field = prisma` - the binding is now reachable under a name
                    // this classifier does not model.
                    _ => return terminal,
                }
            }
            _ => return terminal,
        }
    }
}

/// True for the operators whose result is a boolean and whose operands do not survive.
fn is_comparison(node: Node<'_>, source: &[u8]) -> bool {
    node.child_by_field_name("operator")
        .and_then(|operator| node_text(operator, source))
        .is_some_and(|operator| {
            matches!(
                operator.as_str(),
                "==" | "===" | "!=" | "!==" | "<" | "<=" | ">" | ">=" | "instanceof" | "in"
            )
        })
}

/// Add every name a binding pattern introduces to the taint set.
///
/// Covers `const db = prisma`, `const { user } = prisma` and `const [first] = rows`. Scope is
/// deliberately ignored: a same-named binding in another scope produces a false retain, which
/// is the safe direction, and modelling scopes here would duplicate a resolver the engine
/// already has one copy of too many of.
fn collect_bound_names(node: Node<'_>, source: &[u8], discovered: &mut BTreeSet<String>) {
    let mut stack = vec![node];
    while let Some(current) = stack.pop() {
        if matches!(
            current.kind(),
            "identifier" | "shorthand_property_identifier_pattern"
        ) && let Some(text) = node_text(current, source)
        {
            discovered.insert(text);
        }
        let mut cursor = current.walk();
        for child in current.children(&mut cursor) {
            stack.push(child);
        }
    }
}

fn node_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    node.utf8_text(source).ok().map(str::to_string)
}
