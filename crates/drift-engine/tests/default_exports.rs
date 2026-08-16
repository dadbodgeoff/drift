use drift_engine::{FactKind, extract_typescript_facts};

// EW-4: `export default <identifier>;` is a default export.
//
// The largest single parser-gap contributor measured on cal.com, and the one blocking its
// ordinary-edit refusal rate. `first_named_declaration_identifier` recognises a default export only
// when it wraps a *declaration* - `export default function f() {}`, `export default class C {}`,
// `export default const x = 1` - so `export default prisma;`, where `prisma` was declared on an
// earlier line, produced no exported-symbol fact at all.
//
// The consequence measured directly on cal.com: 242 diagnostics reading "Could not resolve imported
// symbol default from @calcom/prisma in packages/prisma/index.ts", against a file whose line 112 is
// `export default prisma;`. Every route importing the data layer the ordinary way inherited an
// unresolved symbol on its own import, so after EW-2 scoped demotion to a finding's own chain, those
// findings were still withheld and the check still refused - on a comment-only edit.
//
// So this is not a cosmetic gap. It is the difference between cal.com refusing an ordinary edit and
// enforcing a real violation.

fn exported_names(source: &str) -> Vec<(String, Option<String>)> {
    extract_typescript_facts("packages/prisma/index.ts", source)
        .expect("typescript facts")
        .into_iter()
        .filter(|fact| fact.kind == FactKind::ExportedSymbol)
        .map(|fact| (fact.name, fact.value))
        .collect()
}

#[test]
fn default_export_of_a_bare_identifier_is_an_exported_symbol() {
    // cal.com's packages/prisma/index.ts, reduced to the shape that matters.
    let source = "const prisma: unknown = {};\nexport { prisma };\nexport default prisma;\n";

    let exports = exported_names(source);

    assert!(
        exports.iter().any(|(name, _)| name == "default"),
        "`export default prisma` must export `default`, or every default import of this module \
         reports an unresolved symbol: {exports:?}"
    );
    assert!(
        exports
            .iter()
            .any(|(name, value)| name == "default" && value.as_deref() == Some("prisma")),
        "and it must record which local binding it exports: {exports:?}"
    );
}

// D2 (ground-truth remediation §5.2). This test previously asserted that `export default function
// handler()` produces BOTH `(handler, None)` and `(default, Some("handler"))`. The first of those
// is wrong: a default-exported declaration creates no named export under its own identifier, and
// `exported_symbols_by_file` (main.rs:2174) keys purely on `fact.name`, so `import { handler } from
// "./orders"` resolved against a module that exports no such name.
//
// EW-4's actual subject was the bare-identifier form above (`export default prisma;`), which this
// change leaves untouched - that test still passes verbatim. What EW-4 needed was for `default` to
// be exported at all; it did not need a second fact under the local name.
#[test]
fn default_export_of_a_declaration_exports_default_and_only_default() {
    let source = "export default function handler() { return 1; }\n";

    let exports = exported_names(source);

    assert_eq!(
        exports,
        vec![("default".to_string(), Some("handler".to_string()))],
        "one declaration, one fact: `default` is what importers bind and `handler` is the local \
         binding it names. A second `(handler, None)` fact would claim a named export the module \
         does not have: {exports:?}"
    );
}

#[test]
fn a_default_exported_class_is_canonicalised_the_same_way() {
    // The declaration forms must not disagree with each other. Before D2 the anonymous form
    // produced one fact and the declaration forms produced two, so which shape you wrote decided
    // whether the module also claimed a named export.
    let exports = exported_names("export default class Widget { build() { return 1; } }\n");

    assert_eq!(
        exports,
        vec![("default".to_string(), Some("Widget".to_string()))],
        "{exports:?}"
    );
}

#[test]
fn a_named_function_export_still_exports_its_own_name() {
    // The boundary in the other direction: dropping the local-name fact must apply only to the
    // default form. `export function handler()` genuinely does export `handler`.
    let exports = exported_names("export function handler() { return 1; }\n");

    assert_eq!(exports, vec![("handler".to_string(), None)], "{exports:?}");
}

#[test]
fn default_export_of_an_anonymous_expression_is_still_a_default_export() {
    // No identifier to record, but `default` is unambiguously exported - and an importer writing
    // `import x from "./m"` resolves to it. Reporting nothing here is the same defect as the
    // identifier case, reached by a different route.
    for source in [
        "export default { retries: 3 };\n",
        "export default () => 1;\n",
        "export default createClient();\n",
    ] {
        let exports = exported_names(source);
        assert!(
            exports.iter().any(|(name, _)| name == "default"),
            "`{}` exports default: {exports:?}",
            source.trim()
        );
    }
}

#[test]
fn a_named_export_is_not_turned_into_a_default_export() {
    // The boundary. Widening "any export statement exports default" would make every module claim a
    // default export it does not have, which turns a missing-symbol gap into a wrong answer.
    let source = "export const prisma: unknown = {};\n";

    let exports = exported_names(source);

    assert!(
        exports.iter().any(|(name, _)| name == "prisma"),
        "{exports:?}"
    );
    assert!(
        !exports.iter().any(|(name, _)| name == "default"),
        "a named export must not manufacture a default export: {exports:?}"
    );
}

#[test]
fn a_type_only_default_export_is_not_a_runtime_symbol() {
    // `export default interface` is not legal, but `export type { X as default }` is - and it is
    // erased. Nothing runtime should be claimed for it.
    let source = "type Config = { a: number };\nexport type { Config as default };\n";

    let exports = exported_names(source);

    assert!(
        !exports.iter().any(|(name, _)| name == "default"),
        "a type-only default export creates no runtime symbol: {exports:?}"
    );
}

/// EW-4, the re-export hop. `export { default as prisma } from "./m"` re-exports the DEFAULT under a
/// name, and the source name is `default`, not the alias.
///
/// Found while correcting the evasion matrix for papermark, whose data layer only default-exports.
/// The barrel shapes S03-S05 have to re-export it in this form, and `reexport_value_identifiers`
/// recorded only the alias - so the derived `import_used` fact claimed to import `prisma` from a
/// module that exports only `default`, and the engine reported `unresolved_import_symbol` against a
/// barrel that is in fact perfectly resolvable. A false gap, on the shape a default-only data layer
/// forces every barrel over it to use.
#[test]
fn default_reexport_records_default_as_the_source_name() {
    let facts = extract_typescript_facts(
        "app/api/x/data.ts",
        "export { default as prisma } from \"@/lib/prisma\";\n",
    )
    .expect("typescript facts");

    let imported = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ImportUsed)
        .expect("a re-export makes the module an importer of its source");
    assert_eq!(
        imported.name, "prisma",
        "the local/exported name is the alias: {facts:#?}"
    );
    assert_eq!(
        imported.imported_name.as_deref(),
        Some("default"),
        "but the name resolved in the SOURCE module is `default` - resolving the alias there is what \
         produced a false unresolved_import_symbol: {facts:#?}"
    );

    let reexport = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ReExportUsed)
        .expect("the re-export fact");
    assert_eq!(reexport.name, "prisma");
    assert_eq!(reexport.imported_name.as_deref(), Some("default"));
}

#[test]
fn a_plain_named_reexport_still_records_no_separate_source_name() {
    // The boundary: `export { prisma } from "./m"` re-exports the name it already has, so there is
    // nothing to record and the previous behaviour must not change.
    let facts = extract_typescript_facts(
        "app/api/x/data.ts",
        "export { prisma } from \"@/lib/prisma\";\n",
    )
    .expect("typescript facts");

    let imported = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ImportUsed)
        .expect("import fact");
    assert_eq!(imported.name, "prisma");
    assert_eq!(imported.imported_name.as_deref(), None, "{facts:#?}");
}

#[test]
fn a_renamed_named_reexport_records_the_source_name() {
    // `export { prisma as db } from "./m"` exports `db` and resolves `prisma` in the source. Same
    // property as the default case, and it was wrong in the same way.
    let facts = extract_typescript_facts(
        "app/api/x/data.ts",
        "export { prisma as db } from \"@/lib/prisma\";\n",
    )
    .expect("typescript facts");

    let imported = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ImportUsed)
        .expect("import fact");
    assert_eq!(imported.name, "db", "{facts:#?}");
    assert_eq!(
        imported.imported_name.as_deref(),
        Some("prisma"),
        "{facts:#?}"
    );
}
