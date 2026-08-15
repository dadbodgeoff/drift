//! Prisma schema facts.
//!
//! Hand-rolled rather than pulled from a grammar crate, matching the choice recorded for
//! `pnpm-workspace.yaml` parsing in `main.rs`: no new dependency enters the scan path. The subset
//! that matters here is small and line-oriented - block headers, field lines, and `@relation`
//! attributes - and a partial parse degrades to fewer facts rather than to wrong ones.
//!
//! Deliberately NOT routed through tree-sitter. The TypeScript grammar does not reject foreign
//! input: handed a Prisma schema it builds an ERROR-node tree and emits plausible-looking facts.
//! Junk facts are worse than no facts, so this format gets its own reader or none at all.
//!
//! What is extracted, and why each earns its place:
//! - `model` blocks: the declared table set. Grounds `data_store` graph nodes, which today are
//!   inferred from TypeScript call sites alone, and makes "declared but never referenced"
//!   answerable.
//! - field lines: name and type per model, so a field-level question has an answer.
//! - `@relation` fields: the foreign-key graph between models (657 across the corpus).
//!
//! Skipped on purpose: `datasource`, `generator`, block-level `@@` attributes, and comments. They
//! carry no cross-file identity, which is the only thing a fact is useful for here.

/// One parsed declaration from a `.prisma` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrismaFact {
    pub kind: PrismaFactKind,
    /// Model name for a model, `Model.field` for a field or relation.
    pub name: String,
    /// Field type for a field; target model for a relation; `None` for a model.
    pub value: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub start_column: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrismaFactKind {
    ModelDeclared,
    FieldDeclared,
    RelationDeclared,
}

/// Strip a trailing `?` (optional) or `[]` (list) from a declared type, leaving the bare name.
///
/// `Project?` and `LinkTag[]` both name the same entity as `Project` and `LinkTag` - the modifier
/// describes cardinality, not identity, and identity is what joins to a model declaration.
fn bare_type(raw: &str) -> &str {
    raw.trim_end_matches('?').trim_end_matches("[]")
}

/// True for a line that opens a block we care about, returning the declared name.
fn block_header<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(keyword)?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let name = rest.split_whitespace().next()?;
    if name.is_empty() || !line.trim_end().ends_with('{') {
        return None;
    }
    Some(name)
}

pub fn extract_prisma_facts(source: &str) -> Vec<PrismaFact> {
    let mut facts = Vec::new();
    let mut current_model: Option<(String, usize)> = None;

    for (index, raw_line) in source.lines().enumerate() {
        let line_number = index + 1;
        // Comments are stripped before anything else so a `//` cannot fake a field or a brace.
        let without_comment = match raw_line.find("//") {
            Some(position) => &raw_line[..position],
            None => raw_line,
        };
        let line = without_comment.trim();
        if line.is_empty() {
            continue;
        }

        if let Some((model_name, model_start)) = current_model.clone() {
            if line.starts_with('}') {
                facts.push(PrismaFact {
                    kind: PrismaFactKind::ModelDeclared,
                    name: model_name,
                    value: None,
                    start_line: model_start,
                    end_line: line_number,
                    start_column: 1,
                });
                current_model = None;
                continue;
            }
            // `@@unique`, `@@index`, `@@map` - block attributes, not fields.
            if line.starts_with("@@") {
                continue;
            }
            let mut parts = line.split_whitespace();
            let (Some(field_name), Some(field_type)) = (parts.next(), parts.next()) else {
                continue;
            };
            // A field name is an identifier. Anything else is syntax this reader does not model,
            // and guessing at it is how a parser starts emitting facts that are not true.
            if !field_name
                .chars()
                .all(|character| character.is_alphanumeric() || character == '_')
            {
                continue;
            }
            let qualified = format!("{model_name}.{field_name}");
            let column = without_comment.find(field_name).unwrap_or(0) + 1;
            facts.push(PrismaFact {
                kind: PrismaFactKind::FieldDeclared,
                name: qualified.clone(),
                value: Some(bare_type(field_type).to_string()),
                start_line: line_number,
                end_line: line_number,
                start_column: column,
            });
            if line.contains("@relation") {
                facts.push(PrismaFact {
                    kind: PrismaFactKind::RelationDeclared,
                    name: qualified,
                    value: Some(bare_type(field_type).to_string()),
                    start_line: line_number,
                    end_line: line_number,
                    start_column: column,
                });
            }
            continue;
        }

        if let Some(name) = block_header(line, "model") {
            current_model = Some((name.to_string(), line_number));
        }
        // `enum`, `datasource`, `generator`: recognised well enough to not be mistaken for fields,
        // and otherwise ignored. An unclosed block simply yields no model fact.
    }

    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = r#"
// a comment
datasource db {
  provider = "postgresql"
}

model Tag {
  id        String    @id
  name      String
  project   Project?  @relation(fields: [projectId], references: [id])
  projectId String?
  links     LinkTag[]

  @@unique([name, projectId])
  @@index(projectId)
}

enum Status {
  ACTIVE
}
"#;

    #[test]
    fn extracts_model_fields_and_relations() {
        let facts = extract_prisma_facts(SCHEMA);

        let models: Vec<_> = facts
            .iter()
            .filter(|fact| fact.kind == PrismaFactKind::ModelDeclared)
            .map(|fact| fact.name.as_str())
            .collect();
        assert_eq!(models, vec!["Tag"]);

        let fields: Vec<_> = facts
            .iter()
            .filter(|fact| fact.kind == PrismaFactKind::FieldDeclared)
            .map(|fact| (fact.name.as_str(), fact.value.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            fields,
            vec![
                ("Tag.id", "String"),
                ("Tag.name", "String"),
                ("Tag.project", "Project"),
                ("Tag.projectId", "String"),
                ("Tag.links", "LinkTag"),
            ]
        );

        let relations: Vec<_> = facts
            .iter()
            .filter(|fact| fact.kind == PrismaFactKind::RelationDeclared)
            .map(|fact| (fact.name.as_str(), fact.value.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(relations, vec![("Tag.project", "Project")]);
    }

    #[test]
    fn block_attributes_are_not_fields() {
        let facts = extract_prisma_facts(SCHEMA);
        assert!(facts.iter().all(|fact| !fact.name.contains("@@")));
    }

    #[test]
    fn datasource_and_enum_bodies_do_not_become_model_fields() {
        let facts = extract_prisma_facts(SCHEMA);
        // `provider = "postgresql"` sits inside `datasource`, and ACTIVE inside `enum`; neither is
        // inside a model, so neither may produce a field.
        assert!(facts.iter().all(|fact| !fact.name.starts_with("provider")));
        assert!(facts.iter().all(|fact| !fact.name.contains("ACTIVE")));
    }

    #[test]
    fn model_span_covers_the_whole_block() {
        let facts = extract_prisma_facts(SCHEMA);
        let model = facts
            .iter()
            .find(|fact| fact.kind == PrismaFactKind::ModelDeclared)
            .expect("model fact");
        assert!(model.end_line > model.start_line);
    }

    #[test]
    fn a_comment_cannot_fake_a_field() {
        let facts = extract_prisma_facts("model A {\n  // id String @id\n}\n");
        assert!(
            facts
                .iter()
                .all(|fact| fact.kind != PrismaFactKind::FieldDeclared)
        );
    }

    #[test]
    fn empty_and_garbage_input_yield_no_facts_rather_than_wrong_ones() {
        assert!(extract_prisma_facts("").is_empty());
        assert!(extract_prisma_facts("<html><body>not prisma</body></html>").is_empty());
    }
}
