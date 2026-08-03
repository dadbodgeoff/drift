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

#[test]
fn default_export_of_a_declaration_still_works() {
    // The shape that always worked. Pinned so the fix does not move it.
    let source = "export default function handler() { return 1; }\n";

    let exports = exported_names(source);

    assert!(
        exports.iter().any(|(name, _)| name == "handler"),
        "{exports:?}"
    );
    assert!(
        exports
            .iter()
            .any(|(name, value)| name == "default" && value.as_deref() == Some("handler")),
        "{exports:?}"
    );
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
