use drift_engine::{Fact, FactKind, extract_typescript_facts};

// D3 (ground-truth remediation §5.3): a LOCAL `export { name };` is an exported symbol.
//
// `extract_export` gated its specifier handling on the statement having a `source` child - the
// `from` clause. A local `export { internalHelper };` has no source child, no declaration child and
// is not a default export, so it fell through all four arms and emitted nothing. The symbol is
// exported and importable; the engine simply could not see it. It was the audit's sole recall miss
// (6 of 7 runtime declarations found).
//
// Four of the five export shapes in the audit's matrix were ALREADY implemented and are pinned here
// as boundaries rather than rebuilt: `export { x } from "./y"`, `export { a as b } from "./y"`,
// `export * from "./y"`, and the type-only forms.

fn facts(source: &str) -> Vec<Fact> {
    extract_typescript_facts("lib/util.ts", source).expect("typescript facts")
}

fn exported(source: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let mut rows: Vec<_> = facts(source)
        .into_iter()
        .filter(|fact| fact.kind == FactKind::ExportedSymbol)
        .map(|fact| (fact.name, fact.value, fact.imported_name))
        .collect();
    rows.sort();
    rows
}

#[test]
fn a_local_export_specifier_is_an_exported_symbol() {
    let source = "function internalHelper() { return 1; }\nexport { internalHelper };\n";

    assert_eq!(
        exported(source),
        vec![("internalHelper".to_string(), None, None)],
        "`export {{ internalHelper }}` exports a runtime symbol an importer can name"
    );
}

#[test]
fn a_local_export_alias_records_the_local_binding_in_imported_name() {
    // Follows EW-4's established convention for the re-export case: `name` is what this module
    // exports, `imported_name` is the other name. Deliberately NOT `value` - that field means "the
    // module specifier" / "the local binding of a default" elsewhere in the extractor.
    //
    // The asymmetry with the re-export case, stated because the field's meaning shifts: there
    // `imported_name` is resolved in the TARGET module, here there is no target module and it names
    // a binding declared in this same file.
    let source = "function helper() { return 1; }\nexport { helper as renamedHelper };\n";

    assert_eq!(
        exported(source),
        vec![(
            "renamedHelper".to_string(),
            None,
            Some("helper".to_string())
        )],
        "the exported name is the alias; the local binding is metadata"
    );
}

#[test]
fn a_local_export_does_not_claim_a_module_dependency() {
    // The negative that matters. `ReExportUsed` is what `export_star_sources_by_file`
    // (main.rs:2192) and the `MODULE_REEXPORTS_MODULE` edge read. A local export names no source
    // module, so emitting one would invent a dependency that does not exist - and an
    // `export * `-shaped one would additionally open the export-star chain.
    let source = "function internalHelper() { return 1; }\nexport { internalHelper };\n";
    let facts = facts(source);

    assert!(
        !facts.iter().any(|fact| fact.kind == FactKind::ReExportUsed),
        "a local export is not a re-export: {facts:#?}"
    );
    assert!(
        !facts.iter().any(|fact| fact.kind == FactKind::ImportUsed),
        "and it does not make this file an importer: {facts:#?}"
    );
}

#[test]
fn a_multi_specifier_local_export_emits_one_fact_each() {
    let source = "const a = 1;\nconst b = 2;\nfunction c() {}\nexport { a, b as bee, c };\n";

    assert_eq!(
        exported(source),
        vec![
            ("a".to_string(), None, None),
            ("bee".to_string(), None, Some("b".to_string())),
            ("c".to_string(), None, None),
        ],
        "each specifier is its own exported symbol"
    );
}

#[test]
fn a_type_only_local_export_is_not_a_runtime_symbol() {
    // Existing behaviour, extended to the new branch rather than changed. `exported_symbol` models
    // RUNTIME symbols; a future consumer needing type exports gets a distinct `exported_type` kind.
    assert_eq!(
        exported("type T = { a: number };\nexport type { T };\n"),
        vec![],
        "`export type {{ T }}` is erased"
    );
    assert_eq!(
        exported("type T = { a: number };\nconst v = 1;\nexport { type T, v };\n"),
        vec![("v".to_string(), None, None)],
        "an inline `type` specifier is skipped and its neighbours are not"
    );
}

#[test]
fn an_exported_interface_is_still_not_a_runtime_symbol() {
    // `first_named_declaration_identifier` (facts.rs) matches only function/generator/class/
    // lexical/variable declarations, so `export interface` emits nothing. Pinned as a record of
    // existing behaviour - the audit's `WidgetShape` case, correctly absent from its denominator.
    assert_eq!(
        exported("export interface WidgetShape {\n  id: string;\n}\n"),
        vec![]
    );
}

#[test]
fn a_declaration_export_is_not_double_counted_by_the_specifier_branch() {
    // The boundary the specifier branch could easily cross. `export const config = { api: {} }` and
    // `export default { retries: 3 }` both contain braces; only a clause that OPENS with `{` is a
    // specifier list.
    assert_eq!(
        exported("export const config = { api: { bodyParser: false } };\n"),
        vec![("config".to_string(), None, None)],
        "a declaration whose initialiser is an object literal is one named export"
    );
    assert_eq!(
        exported("export default { retries: 3 };\n"),
        vec![("default".to_string(), None, None)],
        "an anonymous default object is one default export"
    );
}

#[test]
fn a_reexport_specifier_is_still_handled_by_the_reexport_branch_alone() {
    // The four already-implemented matrix rows, pinned as boundaries. `export { x } from "./y"` has
    // a `source` child, so the local branch must not also fire on it - which would emit a second,
    // sourceless exported-symbol fact for the same span.
    let facts = facts("export { helper } from \"./other\";\n");

    let exported_symbols: Vec<_> = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ExportedSymbol)
        .collect();
    assert!(
        exported_symbols.is_empty(),
        "a re-export is modelled by ImportUsed + ReExportUsed, not by an exported-symbol fact: \
         {facts:#?}"
    );
    assert_eq!(
        facts
            .iter()
            .filter(|fact| fact.kind == FactKind::ReExportUsed)
            .count(),
        1,
        "{facts:#?}"
    );
}

#[test]
fn a_star_reexport_is_untouched() {
    let facts = facts("export * from \"./other\";\n");
    let star = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ReExportUsed)
        .expect("the export-star fact the chain map reads");
    assert_eq!(star.name, "*", "{facts:#?}");
    assert_eq!(star.value.as_deref(), Some("./other"), "{facts:#?}");
}
