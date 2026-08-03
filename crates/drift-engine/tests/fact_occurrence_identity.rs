use drift_engine::{FactKind, extract_typescript_facts};

// EW-6 / DET-1: two occurrences on one line are two facts.
//
// A `Fact` carried a line but no column, so two identical calls on the same line were byte-for-byte
// identical facts. The CLI derives a fact's stored id from (scan, file, kind, name, value, line),
// which made them the same row - and `ON CONFLICT(id) DO UPDATE` silently collapsed them.
//
// The visible symptom was a count mismatch: the full scan path reports the engine's emission count
// while the incremental path reports stored rows, so the two disagreed. But the mismatch is not a
// counting artifact. The second call really was dropped: nothing downstream could see it, and for a
// tool whose marketed claim is determinism, a count that differs by code path invites exactly the
// question you least want asked.
//
// The discriminator is the column, not an occurrence ordinal. A column is real information about
// where the code is, so it also improves the evidence a finding carries; an ordinal would be a
// number whose only purpose is to differ.

#[test]
fn two_identical_calls_on_one_line_are_two_distinguishable_facts() {
    let source = "const a = db.query(); const b = db.query();\n";
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");

    let calls = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SymbolCalled && fact.name == "query")
        .collect::<Vec<_>>();

    assert_eq!(
        calls.len(),
        2,
        "both calls must be emitted, or there is nothing to distinguish: {facts:#?}"
    );
    assert_eq!(
        calls[0].start_line, calls[1].start_line,
        "same line, by construction"
    );
    assert_ne!(
        calls[0].start_column, calls[1].start_column,
        "identical calls on one line must differ by column, or they collapse to one stored fact"
    );
    // Ordered by position, so a consumer reading facts in emission order reads the file in order.
    assert!(calls[0].start_column < calls[1].start_column);
}

#[test]
fn columns_are_one_based_so_they_match_what_an_editor_shows() {
    // A column reported as 0 for the first character is an off-by-one in every error message it
    // ever appears in. Lines are already 1-based here; columns must agree.
    let source = "db.query();\n";
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");

    let call = facts
        .iter()
        .find(|fact| fact.kind == FactKind::SymbolCalled && fact.name == "query")
        .expect("the call fact");

    assert_eq!(call.start_line, 1);
    assert_eq!(call.start_column, 1);
    assert!(
        call.end_column > call.start_column,
        "an end column must be past the start"
    );
}

#[test]
fn two_imports_of_one_module_on_one_line_stay_distinguishable() {
    // The same shape for imports, which is where the count divergence was first noticed: a line
    // carrying two import declarations is legal and rare, and rare is where silent collapse hides.
    let source = "import { a } from \"@/lib/db\"; import { b } from \"@/lib/db\";\n";
    let facts = extract_typescript_facts("apps/web/app/api/users/route.ts", source)
        .expect("typescript facts");

    let imports = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
        .collect::<Vec<_>>();

    assert_eq!(imports.len(), 2, "{facts:#?}");
    assert_ne!(imports[0].start_column, imports[1].start_column);
}
