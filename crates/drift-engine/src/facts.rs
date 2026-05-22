use std::path::Path;

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
    TestDeclared,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fact {
    pub kind: FactKind,
    pub file_path: String,
    pub name: String,
    pub value: Option<String>,
    pub imported_name: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
}

struct ImportBinding {
    imported_name: String,
    local_name: String,
}

#[derive(Debug)]
pub enum FactExtractError {
    ParserLanguage(tree_sitter::LanguageError),
    ParseFailed,
}

impl std::fmt::Display for FactExtractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FactExtractError::ParserLanguage(error) => {
                write!(formatter, "parser language error: {error}")
            }
            FactExtractError::ParseFailed => write!(formatter, "failed to parse TypeScript source"),
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
        start_line: 1,
        end_line: source.lines().count().max(1),
    });

    let line_count = source.lines().count().max(1);
    for role in file_roles(&file_path) {
        facts.push(Fact {
            kind: FactKind::FileRoleDetected,
            file_path: file_path.clone(),
            name: role.to_string(),
            value: None,
            imported_name: None,
            start_line: 1,
            end_line: line_count,
        });
    }

    walk_node(root, source.as_bytes(), &file_path, &mut facts);

    Ok(facts)
}

fn walk_node(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    match node.kind() {
        "import_statement" => extract_imports(node, source, file_path, facts),
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

    for binding in import_value_bindings(&statement) {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: binding.local_name,
            value: source_value.clone(),
            imported_name: Some(binding.imported_name),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
        });
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
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
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
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
    });
}

fn extract_export(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let statement = node_text(node, source);
    if let Some(source_value) = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote)
    {
        if let Some(statement) = statement.as_deref() {
            for identifier in reexport_value_identifiers(&statement) {
                facts.push(Fact {
                    kind: FactKind::ImportUsed,
                    file_path: file_path.to_string(),
                    name: identifier.clone(),
                    value: Some(source_value.clone()),
                    imported_name: None,
                    start_line: node.start_position().row + 1,
                    end_line: node.end_position().row + 1,
                });
                facts.push(Fact {
                    kind: FactKind::ReExportUsed,
                    file_path: file_path.to_string(),
                    name: identifier,
                    value: Some(source_value.clone()),
                    imported_name: None,
                    start_line: node.start_position().row + 1,
                    end_line: node.end_position().row + 1,
                });
            }
        }
    }

    if let Some(name) = first_named_declaration_identifier(node, source) {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            name: name.clone(),
            value: None,
            imported_name: None,
            start_line,
            end_line,
        });

        if is_next_pages_api_path(file_path) {
            facts.push(Fact {
                kind: FactKind::RouteDeclared,
                file_path: file_path.to_string(),
                name: "default".to_string(),
                value: Some(name.clone()),
                imported_name: None,
                start_line,
                end_line,
            });
        } else if is_api_route_path(file_path)
            && matches!(name.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
        {
            facts.push(Fact {
                kind: FactKind::RouteDeclared,
                file_path: file_path.to_string(),
                name: name.clone(),
                value: None,
                imported_name: None,
                start_line,
                end_line,
            });
        }
        if statement
            .as_deref()
            .is_some_and(|value| value.trim_start().starts_with("export default"))
        {
            facts.push(Fact {
                kind: FactKind::ExportedSymbol,
                file_path: file_path.to_string(),
                name: "default".to_string(),
                value: Some(name),
                imported_name: None,
                start_line,
                end_line,
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
    if export_clause.starts_with('*') {
        return vec!["*".to_string()];
    }

    let mut identifiers = Vec::new();
    if let Some(named_start) = export_clause.find('{') {
        if let Some(named_end) = export_clause[named_start + 1..].find('}') {
            let named_exports = &export_clause[named_start + 1..named_start + 1 + named_end];
            for specifier in named_exports.split(',') {
                let specifier = specifier.trim();
                if specifier.is_empty() || specifier.starts_with("type ") {
                    continue;
                }
                if let Some((_, exported_name)) = specifier.split_once(" as ") {
                    push_import_identifier(&mut identifiers, exported_name);
                } else {
                    push_import_identifier(&mut identifiers, specifier);
                }
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

fn data_operation_shape<'a>(
    receiver: &'a str,
    operation_name: &str,
) -> Option<(String, &'static str)> {
    let mut parts = receiver.split('.');
    let _root = parts.next()?;
    let store_name = parts.next()?;
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

fn first_named_declaration_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "function_declaration"
            || child.kind() == "generator_function_declaration"
            || child.kind() == "class_declaration"
        {
            if let Some(name) = child
                .child_by_field_name("name")
                .and_then(|name| node_text(name, source))
            {
                return Some(name);
            }
        }
        if let Some(name) = first_named_declaration_identifier(child, source) {
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
    file_path.ends_with("/route.ts")
        || file_path.ends_with("/route.tsx")
        || file_path.ends_with("/route.js")
        || file_path.ends_with("/route.jsx")
        || is_next_pages_api_path(file_path)
}

fn is_next_pages_api_path(file_path: &str) -> bool {
    file_path.contains("/pages/api/") || file_path.starts_with("pages/api/")
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
