//! R8-01, R8-05, R8-07, R8-10. What the engine sees when a data-layer import is laundered
//! through a local binding.
//!
//! The four modules below are the same import (`db` from `./db`) published four ways. Only the
//! first carries a `from` clause on its export statement, and that single syntactic difference
//! used to be the whole of what the pipeline keyed on: `extract_export` tests
//! `node.child_by_field_name("source")`, and only the branch behind that test emits
//! `re_export_used` - which is the only fact `main.rs` projects onto a
//! `MODULE_REEXPORTS_MODULE` edge, which is the only edge either chain walker follows.
//!
//! `apply_export_alias_analysis` closes the fact half of that gap, and R8-10 projects both new
//! fact kinds onto a single `MODULE_ALIASES_MODULE` edge (D3) carrying `alias_kind` (D2). The
//! three laundering modules now say what they are doing in the fact stream AND in the graph.
//!
//! R8-10 is still inert as far as *verdicts* go: neither chain walker follows the new edge yet,
//! so no finding moves. What this file pins is that the edge exists, that it is not conflated
//! with `MODULE_REEXPORTS_MODULE` (whose census stays at exactly one), and that an unresolvable
//! specifier produces the fact and no edge - because absence from the scan snapshot is not
//! evidence about what a package contains.
//!
//! Committed at R8-01 asserting the pre-change census, so the emitters and the projection landed
//! as diffs in a committed expectation rather than as sentences in commit messages.

use std::{collections::BTreeMap, fs, path::Path, process::Command};

use serde_json::Value;

/// The Part 0.2 fixture: one data layer, four modules that publish its binding.
///
/// Written as source text rather than assembled from a helper because the shapes *are* the test -
/// a reader has to be able to see that `alias`, `detached` and `factory` differ from `barrel` in
/// nothing that matters to a caller.
fn write_laundering_fixture(root: &Path) {
    let lib = root.join("lib");
    fs::create_dir_all(&lib).expect("create lib dir");

    fs::write(
        lib.join("db.ts"),
        "export const db = { user: { findMany: () => [] } };\n",
    )
    .expect("write db");
    fs::write(lib.join("barrel.ts"), "export { db } from \"./db\";\n").expect("write barrel");
    fs::write(
        lib.join("alias.ts"),
        "import { db } from \"./db\";\nexport const client = db;\n",
    )
    .expect("write alias");
    fs::write(
        lib.join("detached.ts"),
        "import { db } from \"./db\";\nexport { db };\n",
    )
    .expect("write detached");
    fs::write(
        lib.join("factory.ts"),
        "import { db } from \"./db\";\nexport function getClient() {\n  return db;\n}\n",
    )
    .expect("write factory");
}

struct ScanResult {
    facts_by_file: BTreeMap<String, Vec<String>>,
    edges: Vec<Value>,
}

/// Run the real binary over `root` and read the JSONL stream, exactly as the CLI does.
///
/// Through the binary rather than through `extract_typescript_facts` because the projection from
/// facts to graph edges lives in `main.rs`, and the edge census is half of what this file pins.
fn scan(root: &Path) -> ScanResult {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            root.to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_r8",
            "--scan-id",
            "scan_r8",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let mut facts_by_file: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut edges = Vec::new();
    for line in String::from_utf8(output.stdout)
        .expect("utf8 stdout")
        .lines()
    {
        let event: Value = serde_json::from_str(line).expect("json line");
        match event["event"].as_str() {
            Some("fact_batch") => {
                for fact in event["facts"].as_array().expect("facts array") {
                    let Some(file_path) = fact["file_path"].as_str() else {
                        continue;
                    };
                    // `file_detected` and `file_role_detected` are per-file constants that say
                    // nothing about laundering; leaving them in would make the expectations below
                    // move whenever an unrelated role heuristic changes.
                    let Some(summary) = summarize(fact) else {
                        continue;
                    };
                    facts_by_file
                        .entry(file_path.to_string())
                        .or_default()
                        .push(summary);
                }
            }
            Some("graph_edge_batch") => {
                edges.extend(
                    event["graph_edges"]
                        .as_array()
                        .expect("edges array")
                        .iter()
                        .cloned(),
                );
            }
            _ => {}
        }
    }

    ScanResult {
        facts_by_file,
        edges,
    }
}

/// One fact as a single readable line, or `None` for the per-file constants.
fn summarize(fact: &Value) -> Option<String> {
    let kind = fact["kind"].as_str().expect("fact kind");
    if matches!(kind, "file_detected" | "file_role_detected") {
        return None;
    }
    let name = fact["name"].as_str().unwrap_or("");
    let mut summary = format!("{kind}({name}");
    if let Some(value) = fact["value"].as_str() {
        summary.push_str(&format!(", value={value}"));
    }
    if let Some(imported) = fact["imported_name"].as_str() {
        summary.push_str(&format!(", imported_name={imported}"));
    }
    summary.push(')');
    Some(summary)
}

fn edges_of_kind(result: &ScanResult, kind: &str) -> Vec<String> {
    let mut matching = result
        .edges
        .iter()
        .filter(|edge| edge["kind"] == kind)
        .map(|edge| {
            format!(
                "{} -> {}",
                edge["from"].as_str().unwrap_or(""),
                edge["to"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    matching.sort();
    matching
}

/// `MODULE_ALIASES_MODULE` edges rendered with the `alias_kind` they carry.
///
/// D3 puts both fact kinds on one edge kind, so the edge alone cannot say whether the module
/// aliased a binding or wrapped it in a function. `alias_kind` is where that distinction survives,
/// and asserting the edge without it would pass just as happily if the projection hard-coded one
/// value for both arms.
fn alias_edges(result: &ScanResult) -> Vec<String> {
    let mut matching = result
        .edges
        .iter()
        .filter(|edge| edge["kind"] == "MODULE_ALIASES_MODULE")
        .map(|edge| {
            format!(
                "{} -> {} [{}] {}",
                edge["from"].as_str().unwrap_or(""),
                edge["to"].as_str().unwrap_or(""),
                edge["metadata"]["alias_kind"].as_str().unwrap_or("<none>"),
                edge["metadata"]["exported_name"]
                    .as_str()
                    .unwrap_or("<none>"),
            )
        })
        .collect::<Vec<_>>();
    matching.sort();
    matching
}

/// The whole-scan re-export census: one edge, and it belongs to the module that wrote `from`.
///
/// `MODULE_IMPORTS_MODULE` is deliberately not asserted here. All four laundering modules already
/// have one to `lib/db.ts`, and following *that* edge would close every shape in this fixture at
/// the cost of flagging every service module in every repository that imports its data layer -
/// which is the arrangement the convention exists to permit, not to forbid.
#[test]
fn only_the_module_that_wrote_from_reexports_the_data_layer() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_laundering_fixture(dir.path());
    let result = scan(dir.path());

    assert_eq!(
        edges_of_kind(&result, "MODULE_REEXPORTS_MODULE"),
        vec!["module:lib/barrel.ts -> module:lib/db.ts".to_string()],
    );
}

/// Per-module fact census. Before R8-05/R8-07 the three laundering modules were
/// indistinguishable from an ordinary consumer: an import, and an exported name with no stated
/// relationship between them. The new facts are the stated relationship.
#[test]
fn laundering_modules_emit_an_import_and_an_unrelated_exported_symbol() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_laundering_fixture(dir.path());
    let result = scan(dir.path());

    assert_eq!(
        result.facts_by_file.get("lib/db.ts"),
        Some(&vec!["exported_symbol(db)".to_string()]),
    );

    // The control. `from` on the export statement is the entire reason this one is caught.
    assert_eq!(
        result.facts_by_file.get("lib/barrel.ts"),
        Some(&vec![
            "import_used(db, value=./db)".to_string(),
            "re_export_used(db, value=./db)".to_string(),
        ]),
    );

    // E04. `client` IS `db`, and now one fact says so.
    assert_eq!(
        result.facts_by_file.get("lib/alias.ts"),
        Some(&vec![
            "import_used(db, value=./db, imported_name=db)".to_string(),
            "exported_symbol(client)".to_string(),
            "export_aliases_import(client, value=./db, imported_name=db)".to_string(),
        ]),
    );

    // E04b. `export { db };` - one token away from the barrel, and on the wrong side of the
    // `source`-field test that decides everything downstream.
    assert_eq!(
        result.facts_by_file.get("lib/detached.ts"),
        Some(&vec![
            "import_used(db, value=./db, imported_name=db)".to_string(),
            "exported_symbol(db)".to_string(),
            "export_aliases_import(db, value=./db, imported_name=db)".to_string(),
        ]),
    );

    // E05. Every return of `getClient` is the import. The `exported_symbol` fact still says only
    // that a function of that name exists; the wrap fact is what says what it hands back.
    assert_eq!(
        result.facts_by_file.get("lib/factory.ts"),
        Some(&vec![
            "import_used(db, value=./db, imported_name=db)".to_string(),
            "exported_symbol(getClient)".to_string(),
            "export_wraps_import(getClient, value=./db, imported_name=db)".to_string(),
        ]),
    );
}

/// R8-10. The three laundering modules now reach the graph, on an edge of their own.
///
/// One edge per module, module -> module, over ids that already existed (D3: no new node kind).
/// `factory.ts` is the only `wrap`; the other two are identity claims about a binding.
#[test]
fn each_laundering_module_aliases_the_data_layer_module() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_laundering_fixture(dir.path());
    let result = scan(dir.path());

    assert_eq!(
        alias_edges(&result),
        vec![
            "module:lib/alias.ts -> module:lib/db.ts [alias] client".to_string(),
            "module:lib/detached.ts -> module:lib/db.ts [alias] db".to_string(),
            "module:lib/factory.ts -> module:lib/db.ts [wrap] getClient".to_string(),
        ],
    );
}

/// The new edge is not the old edge wearing a different name.
///
/// The re-export census is still exactly one. If a later refactor ever routes the alias facts
/// through the `re_export_used` arm - which D1 rejected precisely because the evidence span would
/// point at source text containing no `from` - this is the assertion that notices.
#[test]
fn the_alias_edge_does_not_inflate_the_reexport_census() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_laundering_fixture(dir.path());
    let result = scan(dir.path());

    assert_eq!(edges_of_kind(&result, "MODULE_REEXPORTS_MODULE").len(), 1);
    assert_eq!(edges_of_kind(&result, "MODULE_ALIASES_MODULE").len(), 3);
}

/// A specifier that resolves nowhere in the snapshot produces the fact and no edge.
///
/// `drizzle-orm` is a package, not a file. The projection resolves through the same
/// `resolve_import` the re-export arm uses, which filters to snapshot paths, and silence is the
/// designed answer: the engine has not read that package and has nothing to say about what it
/// contains. The fact still records what the module did, so the miss is measurable rather than
/// invisible.
#[test]
fn an_unresolvable_specifier_produces_a_fact_but_no_edge() {
    let dir = tempfile::tempdir().expect("tempdir");
    let lib = dir.path().join("lib");
    fs::create_dir_all(&lib).expect("create lib dir");
    fs::write(
        lib.join("external.ts"),
        "import { db } from \"drizzle-orm\";\nexport const client = db;\n",
    )
    .expect("write external");
    let result = scan(dir.path());

    assert_eq!(
        result.facts_by_file.get("lib/external.ts"),
        Some(&vec![
            "import_used(db, value=drizzle-orm, imported_name=db)".to_string(),
            "exported_symbol(client)".to_string(),
            "export_aliases_import(client, value=drizzle-orm, imported_name=db)".to_string(),
        ]),
    );
    assert_eq!(alias_edges(&result), Vec::<String>::new());
}
