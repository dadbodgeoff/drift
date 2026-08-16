use std::collections::BTreeSet;
use std::path::Path;

use crate::next_routes::next_api_route_identity;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactKind {
    FileDetected,
    ImportUsed,
    ReExportUsed,
    ExportedSymbol,
    SymbolCalled,
    DataOperationDetected,
    RouteDeclared,
    FileRoleDetected,
    RouteFlavorDetected,
    TestDeclared,
    AuthGuardCalled,
    RouteReturnsResponse,
    CallbackBoundaryDetected,
    MiddlewareDeclared,
    MiddlewareMatcherDeclared,
    MiddlewareProtectsRoute,
    RequestInputRead,
    SessionRead,
    TenantSource,
    TenantGuardCalled,
    AuthorizationGuardCalled,
    RequestValidationCalled,
    ValidatedInputUsed,
    OutboundRequestCalled,
    RawSqlCalled,
    ParameterizedSqlUsed,
    CsrfGuardCalled,
    RateLimitGuardCalled,
    CorsPolicyDeclared,
    SensitiveFieldDeclared,
    ResponseEmitsField,
    SerializerCalled,
    SecretRead,
    /// Declared in a schema file rather than inferred from a call site. `data_store` graph nodes
    /// are built today from TypeScript usage alone (`prisma.link.findMany()` implies a `link`
    /// store); these say what the repository actually declares, which is the difference between
    /// "some code calls this" and "this table exists".
    DataModelDeclared,
    DataModelFieldDeclared,
    DataModelRelationDeclared,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fact {
    pub kind: FactKind,
    pub file_path: String,
    pub name: String,
    pub value: Option<String>,
    pub imported_name: Option<String>,
    /// S1-05: how (if at all) this import's runtime use is proven.
    /// `Some(RUNTIME_USE_VALUE_POSITION)` - the local binding appears in a value position
    /// (T12's identifier-usage partition). `Some(RUNTIME_USE_DYNAMIC)` - the import is
    /// runtime by construction (`require()` / dynamic `import()`), for which no type-only
    /// reading exists. `None` - no runtime use provable; downstream stays conservative.
    pub runtime_use: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    /// EW-6 (DET-1): 1-based column, which is what makes two occurrences on one line two facts.
    ///
    /// Without it, `db.query(); db.query();` on a single line produced byte-identical facts, and
    /// the CLI's fact id - derived from (scan, file, kind, name, value, line) - collapsed them into
    /// one stored row. The full-scan path counted the engine's emissions and the incremental path
    /// counted rows, so the two disagreed; the deeper problem was that the second occurrence was
    /// genuinely lost rather than merely miscounted.
    ///
    /// A column rather than an occurrence ordinal, because a column is true independently of
    /// emission order and improves the evidence a finding carries. 1-based to match `start_line`
    /// and to match what an editor shows.
    pub start_column: usize,
    pub end_column: usize,
}

/// Runtime use proven because the binding appears in a value position.
pub const RUNTIME_USE_VALUE_POSITION: &str = "value_position";
/// Runtime use proven by construction: `require()` and dynamic `import()` always execute.
pub const RUNTIME_USE_DYNAMIC: &str = "dynamic";
/// S10. Runtime use proven by construction for a *bindingless* import declaration
/// (`import "@acme/db";`). Executing the module for its side effects is the only thing such
/// an import does, so it is a runtime dependency by definition - there is no type-only
/// reading of it, and nothing for member-level symbol resolution to say about it.
pub const RUNTIME_USE_SIDE_EFFECT: &str = "side_effect";

/// S10. The local name recorded for a side-effect import, which binds nothing.
///
/// Deliberately not a legal JavaScript identifier: this name flows into the import node's
/// `local_name` metadata and into binding-keyed lookups (call-site receivers, data-access
/// binding roots), and it must never collide with a real binding in any of them.
pub const SIDE_EFFECT_IMPORT_BINDING: &str = "(side-effect)";

struct ImportBinding {
    imported_name: String,
    local_name: String,
}

#[derive(Debug)]
pub enum FactExtractError {
    ParserLanguage(tree_sitter::LanguageError),
    ParseFailed,
    /// The AST nests deeper than the fact walkers can descend without overflowing the stack.
    TooDeep {
        depth_limit: usize,
    },
}

impl std::fmt::Display for FactExtractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FactExtractError::ParserLanguage(error) => {
                write!(formatter, "parser language error: {error}")
            }
            FactExtractError::ParseFailed => write!(formatter, "failed to parse TypeScript source"),
            FactExtractError::TooDeep { depth_limit } => write!(
                formatter,
                "AST nests deeper than {depth_limit} levels, which the fact walkers cannot descend without overflowing the stack (typically a minified or generated bundle)"
            ),
        }
    }
}

impl std::error::Error for FactExtractError {}

pub fn extract_typescript_facts(
    file_path: impl AsRef<Path>,
    source: &str,
) -> Result<Vec<Fact>, FactExtractError> {
    let file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let mut parser = Parser::new();
    let language = if file_path.ends_with(".tsx") || file_path.ends_with(".jsx") {
        tree_sitter_typescript::LANGUAGE_TSX
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT
    };
    parser
        .set_language(&language.into())
        .map_err(FactExtractError::ParserLanguage)?;
    let tree = parser
        .parse(source, None)
        .ok_or(FactExtractError::ParseFailed)?;
    let root = tree.root_node();
    let mut facts = Vec::new();

    facts.push(Fact {
        kind: FactKind::FileDetected,
        file_path: file_path.clone(),
        name: file_path.clone(),
        value: None,
        imported_name: None,
        runtime_use: None,
        start_line: 1,
        end_line: source.lines().count().max(1),
        // A file-level fact spans the whole file, so its position is the file's first character.
        // The same holds for the role facts below. These are the only facts whose column is a
        // constant rather than a parse position, and it is a true one.
        start_column: 1,
        end_column: 1,
    });

    let line_count = source.lines().count().max(1);
    let mut is_api_route = false;
    for role in file_roles(&file_path) {
        if role == "api_route" {
            is_api_route = true;
        }
        facts.push(Fact {
            kind: FactKind::FileRoleDetected,
            file_path: file_path.clone(),
            name: role.to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 1,
            end_line: line_count,
            start_column: 1,
            end_column: 1,
        });
    }
    // CV-2: the route's flavour, emitted only for files that are routes at all - a flavour fact on a
    // component would be a classification of something that has no flavour.
    if is_api_route {
        facts.push(Fact {
            kind: FactKind::RouteFlavorDetected,
            file_path: file_path.clone(),
            name: route_flavor(&file_path).to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 1,
            end_line: line_count,
            start_column: 1,
            end_column: 1,
        });
    }

    // Refuse before descending, not while descending. A file too deep to walk is a file this scan
    // did not read, and the caller already has an honest place to put that: the Err arm records a
    // skip and marks repo completeness incomplete. Truncating the walk instead would produce a
    // file that looks scanned and silently contributes no facts - a false clean, which is strictly
    // worse than the crash it would be replacing.
    if exceeds_max_depth(root, MAX_AST_DEPTH) {
        return Err(FactExtractError::TooDeep {
            depth_limit: MAX_AST_DEPTH,
        });
    }

    walk_node(root, source.as_bytes(), &file_path, &mut facts);
    apply_runtime_use_analysis(root, source.as_bytes(), &mut facts);

    Ok(facts)
}

/// Remove `import_used` facts for bindings that are only ever used in *type* positions.
///
/// `import type { X }` and inline `type X` are already skipped syntactically, but a plain
/// value-syntax import whose binding is used only as a type is erased by TypeScript just the
/// same and creates no runtime dependency on the module. On dub this was 39 of 458 baseline
/// findings (8.5%) - shapes like:
///
/// ```ts
/// import { Domain } from "@prisma/client";
/// function f(d: Pick<Domain, "id">) {}   // never a value
/// ```
///
/// The direction of caution matters. Wrongly dropping a real data client would create a
/// silent miss, which is the worst failure class in this codebase, so a binding is dropped
/// only when the AST shows at least one type-position use and *no* value-position use.
/// Absent positive evidence of type usage, the fact is kept.
fn apply_runtime_use_analysis(root: Node<'_>, source: &[u8], facts: &mut Vec<Fact>) {
    let mut value_uses: BTreeSet<String> = BTreeSet::new();
    let mut type_uses: BTreeSet<String> = BTreeSet::new();
    collect_identifier_usage(root, source, &mut value_uses, &mut type_uses);

    facts.retain(|fact| {
        if fact.kind != FactKind::ImportUsed {
            return true;
        }
        // Runtime-by-construction imports (`require()`, dynamic `import()`, and the S10
        // bindingless side-effect import) execute the module regardless of how any binding
        // is used; the type-only erasure below never applies to them.
        //
        // The side-effect case is named explicitly rather than left to fall through. Its
        // binding is the `(side-effect)` sentinel, which no identifier can equal, so
        // `used_as_type` is necessarily false and the retain below would keep it anyway -
        // but that is the filter's *default*, and a default is not a decision. If the
        // sentinel ever became a real name this would silently start erasing the only fact
        // that proves the dependency.
        if matches!(
            fact.runtime_use.as_deref(),
            Some(RUNTIME_USE_DYNAMIC) | Some(RUNTIME_USE_SIDE_EFFECT)
        ) {
            return true;
        }
        let name = fact.name.as_str();
        let used_as_type = type_uses.contains(name);
        let used_as_value = value_uses.contains(name);
        // Drop only on positive evidence: used as a type somewhere and never as a value.
        // A binding with no type use at all, or with any value use, is kept - naming the
        // condition rather than negating it inline, since `!used_as_type || used_as_value`
        // is the same predicate with the reasoning removed.
        let erased_at_runtime = used_as_type && !used_as_value;
        !erased_at_runtime
    });

    // S1-05: carry the value/type verdict forward on the fact rather than recomputing it at
    // the graph-assembly diagnostic site - two copies of the analysis is how the duplicated
    // resolvers in S1-04 diverged. A binding seen in a value position is provably runtime.
    for fact in facts.iter_mut() {
        if fact.kind == FactKind::ImportUsed
            && fact.runtime_use.is_none()
            && value_uses.contains(fact.name.as_str())
        {
            fact.runtime_use = Some(RUNTIME_USE_VALUE_POSITION.to_string());
        }
    }
}

/// Partition every identifier occurrence into type positions and value positions.
///
/// tree-sitter-typescript exposes these as distinct node kinds: a name used as a type parses
/// as `type_identifier`, and one used as a value parses as `identifier`. That distinction is
/// the grammar's, not a heuristic of ours, which is why this is done on the AST rather than
/// by matching text.
fn collect_identifier_usage(
    node: Node<'_>,
    source: &[u8],
    value_uses: &mut BTreeSet<String>,
    type_uses: &mut BTreeSet<String>,
) {
    // Do not count the import clause itself as a use of its own bindings.
    if node.kind() == "import_statement" {
        return;
    }

    match node.kind() {
        "type_identifier" => {
            if let Some(text) = node_text(node, source) {
                type_uses.insert(text);
            }
        }
        // A qualified type name (`type Row = T.PrismaLike`) parses its module part as a
        // plain `identifier`, and a type query (`keyof typeof T`) wraps one too - but both
        // are type positions erased at compile time. Counting them as value uses made a
        // namespace import used only in types look runtime (S1-05's negative control).
        "nested_type_identifier" | "type_query" => {
            collect_type_context_identifiers(node, source, type_uses);
            return;
        }
        "identifier" | "shorthand_property_identifier" => {
            if let Some(text) = node_text(node, source) {
                value_uses.insert(text);
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_identifier_usage(child, source, value_uses, type_uses);
    }
}

/// Record every identifier under a type-context node as a type use.
fn collect_type_context_identifiers(
    node: Node<'_>,
    source: &[u8],
    type_uses: &mut BTreeSet<String>,
) {
    if matches!(node.kind(), "identifier" | "type_identifier")
        && let Some(text) = node_text(node, source)
    {
        type_uses.insert(text);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_type_context_identifiers(child, source, type_uses);
    }
}

/// How deep the fact walkers may descend.
///
/// `walk_node`, `collect_identifier_usage`, `collect_type_context_identifiers` and the runtime-use
/// analysis all recurse once per AST child. tree-sitter *parses* iteratively, so it hands back a
/// tree far deeper than these walkers can descend: a 129 KB `public/js/vendor.min.js` containing a
/// single 20,000-term `+` chain aborted the whole scan with
/// `fatal runtime error: stack overflow`, exit 1, no database written, and every rerun failing
/// identically. `public/`, `static/` and `assets/` are not skipped and `.js` is indexed, so a
/// vendored bundle is an ordinary thing for a repository to contain.
///
/// Measured crash thresholds were 15k (`+` chains, union types) and 20k (call chains, bracket
/// nesting). 2,000 sits an order of magnitude below the nearest of those and two orders above any
/// hand-written source - the deepest file in this repository's own test corpus is well under 200.
const MAX_AST_DEPTH: usize = 2_000;

/// Measure whether the tree is deeper than `limit`, iteratively.
///
/// Deliberately a cursor walk rather than a recursive one: a recursive depth check would overflow
/// on exactly the inputs it exists to detect.
fn exceeds_max_depth(root: Node<'_>, limit: usize) -> bool {
    let mut cursor = root.walk();
    let mut depth: usize = 0;
    loop {
        if depth > limit {
            return true;
        }
        if cursor.goto_first_child() {
            depth += 1;
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return false;
            }
            depth -= 1;
        }
    }
}

fn walk_node(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    match node.kind() {
        "import_statement" => extract_imports(node, source, file_path, facts),
        "lexical_declaration" | "variable_declaration" => {
            extract_runtime_imports(node, source, file_path, facts)
        }
        "call_expression" => extract_call(node, source, file_path, facts),
        "export_statement" => extract_export(node, source, file_path, facts),
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_node(child, source, file_path, facts);
    }
}

fn extract_imports(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(statement) = node_text(node, source) else {
        return;
    };
    let source_value = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote);

    let bindings = import_value_bindings(&statement);
    if bindings.is_empty() {
        // S10: a bindingless `import "@acme/db";`. No binding is exactly why this shape was
        // invisible - and exactly why it is a violation: an import with nothing to bind exists
        // only to execute the module.
        if let Some(specifier) = source_value.as_deref()
            && is_bindingless_import(&statement)
            && is_module_like_specifier(specifier)
        {
            facts.push(Fact {
                kind: FactKind::ImportUsed,
                file_path: file_path.to_string(),
                name: SIDE_EFFECT_IMPORT_BINDING.to_string(),
                value: source_value.clone(),
                imported_name: Some(SIDE_EFFECT_IMPORT_BINDING.to_string()),
                runtime_use: Some(RUNTIME_USE_SIDE_EFFECT.to_string()),
                start_line: node.start_position().row + 1,
                end_line: node.end_position().row + 1,
                start_column: node.start_position().column + 1,
                end_column: node.end_position().column + 1,
            });
        }
        return;
    }

    for binding in bindings {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: binding.local_name,
            value: source_value.clone(),
            imported_name: Some(binding.imported_name),
            runtime_use: None,
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }
}

/// An import declaration whose clause is the module specifier itself: `import "x";`.
///
/// `import type ...`, `import x from "x"` and `import {} ... ` all fail this - the first
/// because it is erased, the rest because they have a clause before the `from`.
fn is_bindingless_import(statement: &str) -> bool {
    let trimmed = statement.trim();
    let Some(rest) = trimmed.strip_prefix("import") else {
        return false;
    };
    let rest = rest.trim_start();
    rest.starts_with('"') || rest.starts_with('\'')
}

/// Whether a bindingless specifier names a *module* rather than an asset.
///
/// `import "./globals.css"`, `import "../logo.svg"` and friends are bundler instructions, not
/// module dependencies: nothing in a stylesheet can be a data layer, and the resolver cannot
/// follow them because assets are not in the scanned snapshot. Left in, they would each raise
/// an `unresolved_import` diagnostic - and one of those on a route file makes the entire check
/// fail closed (exit 3). That would turn a recall fix into an availability bug.
///
/// The test is a whitelist, not a blacklist of known asset extensions, because the blacklist
/// can only ever be as complete as today's bundler ecosystem while the whitelist errs toward
/// the status quo (silence). A specifier with no extension is module-like; one with an
/// extension is module-like only if that extension is JavaScript or TypeScript. The cost is
/// that `import "@acme/db.core"` stays missed, which is where it already was.
fn is_module_like_specifier(specifier: &str) -> bool {
    let path = specifier
        .split(['?', '#'])
        .next()
        .unwrap_or(specifier)
        .trim_end_matches('/');
    let last_segment = path.rsplit('/').next().unwrap_or(path);
    match last_segment.rsplit_once('.') {
        None => true,
        Some((_, extension)) => matches!(
            extension.to_ascii_lowercase().as_str(),
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts"
        ),
    }
}

fn extract_runtime_imports(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(statement) = node_text(node, source) else {
        return;
    };
    let Some(source_value) = runtime_import_source(&statement) else {
        return;
    };
    let Some(binding_clause) = runtime_import_binding_clause(&statement) else {
        return;
    };

    for binding in runtime_import_bindings(binding_clause) {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: binding.local_name,
            value: Some(source_value.clone()),
            imported_name: Some(binding.imported_name),
            // `require()` and dynamic `import()` execute the module by construction; no
            // type-only reading of them exists (S1-05).
            runtime_use: Some(RUNTIME_USE_DYNAMIC.to_string()),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }
}

fn runtime_import_source(statement: &str) -> Option<String> {
    quoted_call_argument(statement, "require(")
        .or_else(|| quoted_call_argument(statement, "import("))
}

fn quoted_call_argument(statement: &str, marker: &str) -> Option<String> {
    let after_marker = statement.split(marker).nth(1)?;
    let quote = after_marker
        .chars()
        .find(|value| *value == '"' || *value == '\'')?;
    let after_quote = after_marker.split_once(quote)?.1;
    let value = after_quote.split_once(quote)?.0.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn runtime_import_binding_clause(statement: &str) -> Option<&str> {
    let trimmed = statement.trim();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))
        .or_else(|| trimmed.strip_prefix("var "))?;
    let (binding_clause, _) = after_keyword.split_once('=')?;
    let binding_clause = binding_clause.trim();
    (!binding_clause.is_empty()).then_some(binding_clause)
}

fn runtime_import_bindings(binding_clause: &str) -> Vec<ImportBinding> {
    let trimmed = binding_clause.trim();
    if trimmed.starts_with('{') {
        let Some(end) = trimmed.find('}') else {
            return Vec::new();
        };
        let mut bindings = Vec::new();
        for specifier in trimmed[1..end].split(',') {
            let specifier = specifier.trim();
            if specifier.is_empty() {
                continue;
            }
            if let Some((imported_name, local_name)) = specifier.split_once(':') {
                push_import_binding(&mut bindings, imported_name, local_name);
            } else {
                push_import_binding(&mut bindings, specifier, specifier);
            }
        }
        bindings
    } else {
        let mut bindings = Vec::new();
        push_import_binding(&mut bindings, "default", trimmed);
        bindings
    }
}

fn extract_call(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    let Some((name, receiver)) = callable_parts(function, source) else {
        return;
    };

    facts.push(Fact {
        kind: FactKind::SymbolCalled,
        file_path: file_path.to_string(),
        name: name.clone(),
        value: receiver.clone(),
        imported_name: None,
        runtime_use: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });

    let Some(receiver) = receiver else {
        return;
    };
    if !is_data_access_binding(receiver_root(&receiver), file_path, facts) {
        return;
    }
    let Some((store_name, operation_kind)) = data_operation_shape(&receiver, &name) else {
        return;
    };
    facts.push(Fact {
        kind: FactKind::DataOperationDetected,
        file_path: file_path.to_string(),
        name,
        value: Some(receiver),
        imported_name: Some(format!("{operation_kind}:{store_name}")),
        runtime_use: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });
}

fn extract_export(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let statement = node_text(node, source);
    if let Some(source_value) = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote)
        && let Some(statement) = statement.as_deref()
    {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        let start_column = node.start_position().column + 1;
        let end_column = node.end_position().column + 1;
        for identifier in reexport_value_identifiers(statement) {
            // `export * as ns from "m"` exports a NAMESPACE named `ns` - it does not
            // flatten `m`'s exports into this file the way a bare `export *` does. Emit
            // the namespace name as a directly exported symbol of this file (so importers
            // of `ns` resolve here) and keep its ReExportUsed name distinct from `*` so
            // the export-star chain map never descends through it.
            if let Some(namespace_name) = identifier.strip_prefix("* as ") {
                facts.push(Fact {
                    kind: FactKind::ImportUsed,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: Some(source_value.clone()),
                    imported_name: Some("*".to_string()),
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                facts.push(Fact {
                    kind: FactKind::ReExportUsed,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: Some(source_value.clone()),
                    imported_name: Some("*".to_string()),
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                facts.push(Fact {
                    kind: FactKind::ExportedSymbol,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: None,
                    imported_name: None,
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                continue;
            }
            // EW-4: `<source> as <exported>` carries both names. The exported alias is what this
            // module exports; `imported_name` is what must be resolved in the target module. Only
            // recording the alias made a re-export of a default (or of any renamed symbol) look
            // unresolvable in its source.
            let (source_name, exported_name) = match identifier.split_once(" as ") {
                Some((source, exported)) => (Some(source.to_string()), exported.to_string()),
                None => (None, identifier.clone()),
            };
            facts.push(Fact {
                kind: FactKind::ImportUsed,
                file_path: file_path.to_string(),
                name: exported_name.clone(),
                value: Some(source_value.clone()),
                imported_name: source_name.clone(),
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
            facts.push(Fact {
                kind: FactKind::ReExportUsed,
                file_path: file_path.to_string(),
                name: exported_name,
                value: Some(source_value.clone()),
                imported_name: source_name,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }
    }

    // EW-4: `export default <expression>;` where the expression is not a declaration.
    //
    // The declaration branch below handles `export default function f() {}` and friends. It cannot
    // see `export default prisma;` - the identifier was declared on an earlier line, so this
    // statement has no declaration child and `first_named_declaration_identifier` returns None,
    // skipping the whole branch. The module then reports no `default` export, and every
    // `import x from "./m"` against it raises `unresolved_import_symbol`.
    //
    // Measured on cal.com: 242 such diagnostics against `packages/prisma/index.ts`, whose line 112
    // is exactly `export default prisma;`. Because that is the *data layer*, every route importing
    // it the ordinary way carried an unresolved symbol on the very import a finding rests on - so
    // the finding stayed withheld and the check refused, on edits as small as adding a comment.
    //
    // Emitted only for an actual `export default`, never for a named export: claiming a default
    // export a module does not have would turn a missing-symbol gap into a wrong answer. Type-only
    // default exports (`export type { X as default }`) are erased and are excluded, matching how
    // every other type-only export is treated here.
    if statement
        .as_deref()
        .is_some_and(is_runtime_default_export_statement)
        && first_named_declaration_identifier(node, source).is_none()
    {
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            name: "default".to_string(),
            // The local binding when there is one (`export default prisma`), so consumers can
            // follow the default back to what it names. Absent for an anonymous expression, where
            // there is nothing to follow - `default` is the whole of what the module exports.
            value: default_export_identifier(node, source),
            imported_name: None,
            runtime_use: None,
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }

    if let Some(name) = first_named_declaration_identifier(node, source) {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        let start_column = node.start_position().column + 1;
        let end_column = node.end_position().column + 1;
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            name: name.clone(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line,
            end_line,
            start_column,
            end_column,
        });

        let is_default_export = statement
            .as_deref()
            .is_some_and(|value| value.trim_start().starts_with("export default"));

        // In a Next.js pages/api module the request handler is the *default* export.
        // Named exports are not handlers: `export const config = { api: { bodyParser:
        // false } }` is Next.js route configuration (the documented idiom for webhooks
        // and uploads), and files also legitimately export helpers and types.
        //
        // Emitting RouteDeclared for every named export meant such a file produced two
        // route declarations both named "default", which collided into duplicate
        // `normalized_entrypoints` rows and aborted onboarding with a UNIQUE constraint
        // failure (cal.com, papermark). It also polluted method resolution, since
        // `config` was reported as a route method.
        if is_next_pages_api_path(file_path) {
            if is_default_export {
                facts.push(Fact {
                    kind: FactKind::RouteDeclared,
                    file_path: file_path.to_string(),
                    name: "default".to_string(),
                    value: Some(name.clone()),
                    imported_name: None,
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
            }
        } else if is_api_route_path(file_path)
            && matches!(name.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
        {
            facts.push(Fact {
                kind: FactKind::RouteDeclared,
                file_path: file_path.to_string(),
                name: name.clone(),
                value: None,
                imported_name: None,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }
        if is_default_export {
            facts.push(Fact {
                kind: FactKind::ExportedSymbol,
                file_path: file_path.to_string(),
                name: "default".to_string(),
                value: Some(name),
                imported_name: None,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }
    }
}

fn import_value_bindings(statement: &str) -> Vec<ImportBinding> {
    let trimmed = statement.trim();
    if !trimmed.starts_with("import ") || trimmed.starts_with("import type ") {
        return Vec::new();
    }

    let mut bindings = Vec::new();
    let import_clause = trimmed
        .trim_start_matches("import")
        .trim()
        .split(" from ")
        .next()
        .unwrap_or("")
        .trim();
    if import_clause.is_empty()
        || import_clause.starts_with('"')
        || import_clause.starts_with('\'')
        || import_clause.starts_with("type ")
    {
        return Vec::new();
    }

    if let Some(named_start) = import_clause.find('{') {
        let default_import = import_clause[..named_start]
            .trim()
            .trim_end_matches(',')
            .trim();
        push_import_binding(&mut bindings, "default", default_import);
        if let Some(named_end) = import_clause[named_start + 1..].find('}') {
            let named_imports = &import_clause[named_start + 1..named_start + 1 + named_end];
            for specifier in named_imports.split(',') {
                let specifier = specifier.trim();
                if specifier.is_empty() || specifier.starts_with("type ") {
                    continue;
                }
                if let Some((imported_name, local_name)) = specifier.split_once(" as ") {
                    push_import_binding(&mut bindings, imported_name, local_name);
                } else {
                    push_import_binding(&mut bindings, specifier, specifier);
                }
            }
        }
    } else if let Some(namespace_name) = import_clause
        .strip_prefix("* as ")
        .and_then(|value| value.split_whitespace().next())
    {
        push_import_binding(&mut bindings, "*", namespace_name);
    } else {
        push_import_binding(
            &mut bindings,
            "default",
            import_clause.trim_end_matches(',').trim(),
        );
    }

    bindings.sort_by(|left, right| {
        left.local_name
            .cmp(&right.local_name)
            .then(left.imported_name.cmp(&right.imported_name))
    });
    bindings.dedup_by(|left, right| {
        left.local_name == right.local_name && left.imported_name == right.imported_name
    });
    bindings
}

fn reexport_value_identifiers(statement: &str) -> Vec<String> {
    let trimmed = statement.trim();
    if !trimmed.starts_with("export ") {
        return Vec::new();
    }
    let export_clause = trimmed
        .trim_start_matches("export")
        .trim()
        .split(" from ")
        .next()
        .unwrap_or("")
        .trim();
    if export_clause.is_empty() || export_clause.starts_with("type ") {
        return Vec::new();
    }
    if let Some(rest) = export_clause.strip_prefix('*') {
        // `export * as ns from "m"`: return the marker `* as ns` so extract_export can
        // treat the namespace re-export differently from a flattening `export *`.
        if let Some(namespace_name) = rest.trim_start().strip_prefix("as ") {
            let name = namespace_name.split_whitespace().next().unwrap_or("");
            if !name.is_empty() && name.chars().all(is_identifier_char) {
                return vec![format!("* as {name}")];
            }
        }
        return vec!["*".to_string()];
    }

    let mut identifiers = Vec::new();
    if let Some(named_start) = export_clause.find('{')
        && let Some(named_end) = export_clause[named_start + 1..].find('}')
    {
        let named_exports = &export_clause[named_start + 1..named_start + 1 + named_end];
        for specifier in named_exports.split(',') {
            let specifier = specifier.trim();
            if specifier.is_empty() || specifier.starts_with("type ") {
                continue;
            }
            if let Some((source_name, exported_name)) = specifier.split_once(" as ") {
                // EW-4: keep BOTH names. The exported alias is what this module exports; the source
                // name is what has to be resolved in the target module, and they are different
                // things. Recording only the alias made `export { default as prisma } from "./m"`
                // claim to import `prisma` from a module that exports only `default`, so the engine
                // reported an unresolved symbol against a barrel that resolves perfectly - the shape
                // every barrel over a default-only data layer is forced to use.
                //
                // Carried as a marker for the same reason `* as ns` is: this function returns names,
                // and threading a pair through every caller to serve one shape would be worse than
                // the marker the caller already knows how to split.
                let source_name = source_name.trim();
                let exported_name = exported_name.trim();
                if !source_name.is_empty()
                    && source_name != exported_name
                    && (source_name == "default" || source_name.chars().all(is_identifier_char))
                {
                    // Pushed directly: `push_import_identifier` keeps only the first
                    // whitespace-separated token, which would reduce the marker to its source name.
                    if exported_name.chars().all(is_identifier_char) {
                        identifiers.push(format!("{source_name} as {exported_name}"));
                    } else {
                        push_import_identifier(&mut identifiers, exported_name);
                    }
                } else {
                    push_import_identifier(&mut identifiers, exported_name);
                }
            } else {
                push_import_identifier(&mut identifiers, specifier);
            }
        }
    }
    identifiers.sort();
    identifiers.dedup();
    identifiers
}

fn push_import_identifier(identifiers: &mut Vec<String>, value: &str) {
    let identifier = value
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    if !identifier.is_empty() && identifier.chars().all(is_identifier_char) {
        identifiers.push(identifier.to_string());
    }
}

fn push_import_binding(bindings: &mut Vec<ImportBinding>, imported_name: &str, local_name: &str) {
    let imported_name = imported_name
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    let local_name = local_name
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    if !imported_name.is_empty()
        && !local_name.is_empty()
        && (imported_name == "*" || imported_name.chars().all(is_identifier_char))
        && local_name.chars().all(is_identifier_char)
    {
        bindings.push(ImportBinding {
            imported_name: imported_name.to_string(),
            local_name: local_name.to_string(),
        });
    }
}

fn is_identifier_char(value: char) -> bool {
    value == '_' || value == '$' || value.is_ascii_alphanumeric()
}

fn callable_parts(node: Node<'_>, source: &[u8]) -> Option<(String, Option<String>)> {
    match node.kind() {
        "identifier" => node_text(node, source).map(|name| (name, None)),
        "member_expression" => {
            let name = node
                .child_by_field_name("property")
                .and_then(|property| node_text(property, source))?;
            let receiver = node
                .child_by_field_name("object")
                .and_then(|object| node_text(object, source));
            Some((name, receiver))
        }
        _ => None,
    }
}

#[cfg(test)]
mod data_operation_shape_tests {
    use super::data_operation_shape;

    #[test]
    fn a_receiver_broken_across_lines_names_the_same_store() {
        let inline = data_operation_shape("prisma.commission", "findMany").expect("shape");
        let wrapped =
            data_operation_shape("prisma.commission\n            ", "findMany").expect("shape");
        assert_eq!(inline.0, "commission");
        // Without the trim these were two different stores, and therefore two graph nodes.
        assert_eq!(inline.0, wrapped.0);
    }

    #[test]
    fn a_whitespace_only_segment_is_not_a_store() {
        assert!(data_operation_shape("prisma.   ", "findMany").is_none());
    }
}

fn data_operation_shape(receiver: &str, operation_name: &str) -> Option<(String, &'static str)> {
    let mut parts = receiver.split('.');
    let _root = parts.next()?;
    // Trimmed because the receiver is raw source text, and a chained call broken across lines
    // carries the newline and indentation into the segment:
    //
    //     prisma.commission
    //         .findMany(...)
    //
    // yielded a store named "commission\n            ", which became its own `data_store` node id.
    // Measured on dub: 96 nodes for 77 distinct stores, so ~9% of the set were whitespace shards of
    // a table that already had a node.
    let store_name = parts.next()?.trim();
    if store_name.is_empty() {
        return None;
    }
    let operation_kind = data_operation_kind(operation_name);
    Some((store_name.to_string(), operation_kind))
}

fn is_data_access_binding(receiver_root: &str, file_path: &str, facts: &[Fact]) -> bool {
    is_data_access_local_name(receiver_root)
        || facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.file_path == file_path
                && fact.name == receiver_root
                && fact.value.as_deref().is_some_and(is_data_access_reference)
        })
}

fn is_data_access_local_name(value: &str) -> bool {
    matches!(value, "db" | "prisma" | "database")
}

fn is_data_access_reference(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("prisma")
        || lower.contains("database")
        || lower.contains("/db")
        || lower.ends_with("db")
        || lower.contains("data-access")
        || lower.contains("/repositories/")
        || lower.contains("/repository/")
}

fn receiver_root(receiver: &str) -> &str {
    receiver.split('.').next().unwrap_or(receiver)
}

fn data_operation_kind(operation_name: &str) -> &'static str {
    let lower = operation_name.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "find"
            | "findfirst"
            | "findfirstorthrow"
            | "findmany"
            | "findunique"
            | "finduniqueorthrow"
            | "get"
            | "getmany"
            | "select"
            | "query"
            | "count"
            | "aggregate"
            | "groupby"
    ) {
        "read"
    } else if matches!(
        lower.as_str(),
        "create"
            | "createmany"
            | "update"
            | "updatemany"
            | "upsert"
            | "insert"
            | "insertmany"
            | "save"
            | "set"
    ) {
        "write"
    } else if matches!(
        lower.as_str(),
        "delete" | "deletemany" | "remove" | "removemany" | "destroy" | "destroymany"
    ) {
        "delete"
    } else {
        "unknown"
    }
}

/// Whether a statement is a default export that exists at runtime.
///
/// `export default X` does. `export type { X as default }` does not - it is erased, like every other
/// type-only export. The check is on the statement text because tree-sitter models a type-only
/// export clause as an ordinary export statement with a `type` keyword child, and the text is what
/// the rest of this module already reasons about.
fn is_runtime_default_export_statement(statement: &str) -> bool {
    let trimmed = statement.trim_start();
    trimmed.starts_with("export default") && !trimmed.starts_with("export default type ")
}

/// The local binding a bare `export default <identifier>;` names, if it is a plain identifier.
///
/// `None` for anything else - an object literal, an arrow, a call - because there is no binding to
/// name and inventing one would be worse than saying nothing.
fn default_export_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .find(|child| child.kind() == "identifier")
        .and_then(|child| node_text(child, source))
}

fn first_named_declaration_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "function_declaration" | "generator_function_declaration" | "class_declaration"
        ) && let Some(name) = child
            .child_by_field_name("name")
            .and_then(|name| node_text(name, source))
        {
            return Some(name);
        }
        if matches!(child.kind(), "lexical_declaration" | "variable_declaration")
            && let Some(name) = first_variable_declaration_identifier(child, source)
        {
            return Some(name);
        }
        if let Some(name) = first_named_declaration_identifier(child, source) {
            return Some(name);
        }
    }
    None
}

fn first_variable_declaration_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator"
            && let Some(name) = child
                .child_by_field_name("name")
                .and_then(|name| node_text(name, source))
        {
            return Some(name);
        }
        if let Some(name) = first_variable_declaration_identifier(child, source) {
            return Some(name);
        }
    }
    None
}

fn node_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    node.utf8_text(source).ok().map(ToOwned::to_owned)
}

fn unquote(value: String) -> String {
    value.trim_matches('"').trim_matches('\'').to_string()
}

/// CV-2: which flavour of route this file is, from its path segments below the api boundary.
///
/// dub's 494 route files are 358 app, 111 cron and 25 webhook. Cron and webhook routes authenticate by
/// signature rather than session, so a session convention scored against one global denominator either
/// has its confidence dragged down by routes it was never about or, accepted, flags every cron route as
/// missing auth.
///
/// Emitted as a fact so the candidate deriver reads a classification instead of matching globs itself -
/// the deriver getting its own glob engine is the BB-11 divergence in a new place. The TypeScript side
/// has one predicate for this, `routeFlavor` in packages/core/src/convention-scope.ts, and the two are
/// held together by a differential test rather than by shared code, which the process boundary does not
/// allow. The names are the existing entrypoint-kind vocabulary rather than new strings.
///
/// Per SEGMENT, never substring: `app/api/crontab-editor/route.ts` is an ordinary route.
pub fn route_flavor(file_path: &str) -> &'static str {
    const CRON_SEGMENTS: &[&str] = &["cron", "crons", "jobs", "scheduled"];
    const WEBHOOK_SEGMENTS: &[&str] = &["webhook", "webhooks"];

    let lower = file_path.to_ascii_lowercase();
    let all = lower.split('/').collect::<Vec<_>>();
    // Only segments below the route root decide flavour: a repo mounted under `apps/cron-service/`
    // does not make every route inside it a cron job.
    //
    // D-H2 made the `None` arm reachable for real paths, and it was wrong: it fell back to the WHOLE
    // path, so `apps/cron/app/wellknown/route.ts` - a route handler in a repo whose app directory is
    // called `cron` - would have been classified `cron_job` and dropped out of the session family's
    // denominator. `app` is the route root when there is no `api` below it, so it is the boundary.
    let route_root = all
        .iter()
        .rposition(|segment| *segment == "api")
        .or_else(|| all.iter().rposition(|segment| *segment == "app"));
    let below = match route_root {
        Some(index) => &all[index + 1..],
        None => &all[..],
    };
    let segments = below
        .iter()
        // Next route groups - `(ee)`, `(admin)` - are organisational and carry no flavour.
        .filter(|segment| !(segment.starts_with('(') && segment.ends_with(')')))
        .map(|segment| {
            segment
                .strip_suffix(".ts")
                .or_else(|| segment.strip_suffix(".tsx"))
                .or_else(|| segment.strip_suffix(".js"))
                .or_else(|| segment.strip_suffix(".jsx"))
                .unwrap_or(segment)
        })
        .collect::<Vec<_>>();

    if segments
        .iter()
        .any(|segment| CRON_SEGMENTS.contains(segment))
    {
        return "cron_job";
    }
    if segments
        .iter()
        .any(|segment| WEBHOOK_SEGMENTS.contains(segment))
    {
        return "webhook_handler";
    }
    "api_route"
}

fn file_roles(file_path: &str) -> Vec<&'static str> {
    let mut roles = Vec::new();
    if is_api_route_path(file_path) {
        roles.push("api_route");
    }
    if is_service_module_path(file_path) {
        roles.push("service_module");
    }
    if is_data_access_module_path(file_path) {
        roles.push("data_access_module");
    }
    if is_cli_command_module_path(file_path) {
        roles.push("cli_command_module");
    }
    if is_core_module_path(file_path) {
        roles.push("core_module");
    }
    if is_query_module_path(file_path) {
        roles.push("query_module");
    }
    if is_factgraph_module_path(file_path) {
        roles.push("factgraph_module");
    }
    if is_adapter_module_path(file_path) {
        roles.push("adapter_module");
    }
    if is_storage_module_path(file_path) {
        roles.push("storage_module");
    }
    if is_engine_bridge_module_path(file_path) {
        roles.push("engine_bridge_module");
    }
    if is_mcp_module_path(file_path) {
        roles.push("mcp_module");
    }
    if is_test_path(file_path) {
        roles.push("test");
    }
    if is_config_path(file_path) {
        roles.push("config");
    }
    roles
}

fn is_api_route_path(file_path: &str) -> bool {
    next_api_route_identity(file_path).is_some()
}

fn is_next_pages_api_path(file_path: &str) -> bool {
    next_api_route_identity(file_path)
        .is_some_and(|identity| identity.framework == "next_pages_api")
}

fn is_service_module_path(file_path: &str) -> bool {
    path_segments(file_path)
        .iter()
        .any(|segment| matches!(segment.as_str(), "service" | "services"))
        || file_path.ends_with(".service.ts")
        || file_path.ends_with(".service.tsx")
        || file_path.ends_with(".service.js")
        || file_path.ends_with(".service.jsx")
}

fn is_data_access_module_path(file_path: &str) -> bool {
    let segments = path_segments(file_path);
    segments.iter().any(|segment| {
        matches!(
            segment.as_str(),
            "db" | "database" | "data-access" | "repositories" | "repository"
        )
    }) || file_path.ends_with("/db.ts")
        || file_path.ends_with("/db.tsx")
        || file_path.ends_with("/database.ts")
        || file_path.ends_with("/database.tsx")
        || file_path.ends_with("/prisma.ts")
        || file_path.ends_with("/prisma.tsx")
}

fn is_cli_command_module_path(file_path: &str) -> bool {
    file_path.contains("/cli/src/commands/") || file_path.starts_with("packages/cli/src/commands/")
}

fn is_core_module_path(file_path: &str) -> bool {
    file_path.contains("/core/src/") || file_path.starts_with("packages/core/src/")
}

fn is_query_module_path(file_path: &str) -> bool {
    file_path.contains("/query/src/") || file_path.starts_with("packages/query/src/")
}

fn is_factgraph_module_path(file_path: &str) -> bool {
    file_path.contains("/factgraph/src/") || file_path.starts_with("packages/factgraph/src/")
}

fn is_adapter_module_path(file_path: &str) -> bool {
    file_path.contains("/adapters/") && file_path.contains("/src/")
}

fn is_storage_module_path(file_path: &str) -> bool {
    file_path.contains("/storage/src/") || file_path.starts_with("packages/storage/src/")
}

fn is_engine_bridge_module_path(file_path: &str) -> bool {
    file_path.contains("/cli/src/engine/") || file_path.starts_with("packages/cli/src/engine/")
}

fn is_mcp_module_path(file_path: &str) -> bool {
    file_path.contains("/mcp/src/") || file_path.starts_with("packages/mcp/src/")
}

fn is_test_path(file_path: &str) -> bool {
    let lower = file_path.to_ascii_lowercase();
    lower.contains("/test/")
        || lower.contains("/tests/")
        || lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with(".test.js")
        || lower.ends_with(".spec.js")
}

fn is_config_path(file_path: &str) -> bool {
    let file_name = file_path
        .rsplit('/')
        .next()
        .unwrap_or(file_path)
        .to_ascii_lowercase();
    file_name.contains(".config.")
        || matches!(
            file_name.as_str(),
            "vite.config.ts"
                | "vitest.config.ts"
                | "eslint.config.js"
                | "eslint.config.mjs"
                | "next.config.js"
                | "next.config.mjs"
                | "next.config.ts"
        )
}

fn path_segments(file_path: &str) -> Vec<String> {
    file_path
        .split('/')
        .map(|segment| segment.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod ast_depth_tests {
    use super::*;

    /// A minified bundle must be refused, not crashed on.
    ///
    /// Reproduced before this guard existed: a 129 KB `public/js/vendor.min.js` holding one
    /// 20,000-term `+` chain aborted the entire scan with `fatal runtime error: stack overflow`,
    /// exit 1, no database written, and every rerun failing identically. `public/` is not skipped
    /// and `.js` is indexed, so this is ordinary repository content.
    #[test]
    fn refuses_a_tree_too_deep_to_walk_instead_of_overflowing() {
        let chain = (0..20_000)
            .map(|index| format!("a{index}"))
            .collect::<Vec<_>>()
            .join("+");
        let source = format!("var z={chain};\n");

        let error = extract_typescript_facts("public/js/vendor.min.js", &source)
            .expect_err("a 20,000-deep expression must be refused");

        assert!(matches!(error, FactExtractError::TooDeep { .. }));
        // The caller turns Err into a recorded skip plus incomplete repo completeness, so the
        // message has to say what the reader should do about it.
        assert!(error.to_string().contains("minified"));
    }

    /// The guard must not fire on real source, or it trades a crash for silent recall loss.
    #[test]
    fn ordinary_source_is_nowhere_near_the_depth_limit() {
        let source = r#"
            import { prisma } from "@/lib/prisma";
            export async function GET() {
              const rows = await prisma.user.findMany({ where: { active: true } });
              return Response.json(rows.map((row) => ({ ...row, seen: true })));
            }
        "#;

        let facts = extract_typescript_facts("app/api/users/route.ts", source)
            .expect("ordinary source must parse");
        assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed));
    }
}
