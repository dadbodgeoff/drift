use std::collections::HashSet;

use crate::{Fact, FactKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessRule {
    pub convention_id: String,
    pub forbidden_imports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessViolation {
    pub convention_id: String,
    pub file_path: String,
    pub import_name: String,
    pub import_source: String,
    pub line: usize,
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

fn is_forbidden_import(import_source: &str, forbidden_imports: &[String]) -> bool {
    forbidden_imports
        .iter()
        .any(|forbidden| import_source == forbidden || import_source.contains(forbidden))
}
