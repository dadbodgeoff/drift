use std::path::Path;

use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactKind {
    FileDetected,
    ImportUsed,
    ExportedSymbol,
    SymbolCalled,
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
    pub start_line: usize,
    pub end_line: usize,
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
        start_line: 1,
        end_line: source.lines().count().max(1),
    });

    if is_api_route_path(&file_path) {
        facts.push(Fact {
            kind: FactKind::FileRoleDetected,
            file_path: file_path.clone(),
            name: "api_route".to_string(),
            value: None,
            start_line: 1,
            end_line: source.lines().count().max(1),
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
    let source_value = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote);

    for identifier in collect_identifiers(node, source) {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: identifier,
            value: source_value.clone(),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
        });
    }
}

fn extract_call(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    let Some(name) = callable_name(function, source) else {
        return;
    };

    facts.push(Fact {
        kind: FactKind::SymbolCalled,
        file_path: file_path.to_string(),
        name,
        value: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
    });
}

fn extract_export(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    if let Some(name) = first_named_declaration_identifier(node, source) {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            name: name.clone(),
            value: None,
            start_line,
            end_line,
        });

        if is_api_route_path(file_path)
            && matches!(name.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
        {
            facts.push(Fact {
                kind: FactKind::RouteDeclared,
                file_path: file_path.to_string(),
                name,
                value: None,
                start_line,
                end_line,
            });
        }
    }
}

fn collect_identifiers(node: Node<'_>, source: &[u8]) -> Vec<String> {
    let mut identifiers = Vec::new();
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "identifier" || child.kind() == "shorthand_property_identifier_pattern" {
            if let Some(text) = node_text(child, source) {
                identifiers.push(text);
            }
        } else if child.kind() != "string" {
            identifiers.extend(collect_identifiers(child, source));
        }
    }
    identifiers.sort();
    identifiers.dedup();
    identifiers
}

fn callable_name(node: Node<'_>, source: &[u8]) -> Option<String> {
    match node.kind() {
        "identifier" => node_text(node, source),
        "member_expression" => node
            .child_by_field_name("property")
            .and_then(|property| node_text(property, source)),
        _ => None,
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

fn is_api_route_path(file_path: &str) -> bool {
    file_path.ends_with("/route.ts")
        || file_path.ends_with("/route.tsx")
        || file_path.ends_with("/route.js")
        || file_path.ends_with("/route.jsx")
        || file_path.contains("/pages/api/")
}
