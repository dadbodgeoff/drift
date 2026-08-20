//! R8-01, R8-05, R8-07. What the engine sees when a data-layer import is laundered through a
//! local binding.
//!
//! The four modules below are the same import (`db` from `./db`) published four ways. Only the
//! first carries a `from` clause on its export statement, and that single syntactic difference
//! used to be the whole of what the pipeline keyed on: `extract_export` tests
//! `node.child_by_field_name("source")`, and only the branch behind that test emits
//! `re_export_used` - which is the only fact `main.rs` projects onto a
//! `MODULE_REEXPORTS_MODULE` edge, which is the only edge either chain walker follows.
//!
//! `apply_export_alias_analysis` closes the fact half of that gap. The three laundering modules
//! now say what they are doing, and the edge census below is unchanged - which is the point of
//! this file at this step. R8-05 and R8-07 are inert by construction: the facts exist, nothing
//! projects them, and no verdict moves. "No behaviour change" is the claim those steps make, and
//! a claim nobody measured is what this workstream keeps finding.
//!
//! Committed at R8-01 asserting the pre-change census, so the emitters landed as a diff in an
//! expectation rather than as a sentence in a commit message.

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

/// The new facts move no edge. Reverting the walkers later returns the product to today's
/// verdicts while leaving the relation measurable in the fact stream - a useful state, not a
/// broken one.
#[test]
fn the_new_facts_do_not_yet_reach_the_graph() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_laundering_fixture(dir.path());
    let result = scan(dir.path());

    assert_eq!(
        edges_of_kind(&result, "MODULE_ALIASES_MODULE"),
        Vec::<String>::new(),
    );
}
