use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

// X-T (E-5 regression pin, previously verified only behaviorally): `export *` from an
// EXTERNAL / unresolvable target makes the export chain open - the star target's export set
// is invisible to the scan, so the absence of a symbol is unprovable and the conservative
// `unresolved_import_symbol` diagnostic must NOT fire on a route importing an undeclared
// name through that barrel. A false diagnostic there is a false finding waiting to happen:
// any such diagnostic on a route file makes S1-01 refuse where it could block.
//
// The closed-chain control in the same fixture keeps this from decaying into blanket
// suppression: when every star target is local and resolvable, the export set is complete,
// absence IS provable, and the diagnostic must still fire.
//
// Like runtime_provable_imports.rs alongside, these assert on emitted diagnostics and
// edges, not downstream findings, so a regression fails for the resolution reason.

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/fixtures")
        .join(name)
}

struct ScanGraph {
    nodes: Vec<Value>,
    edges: Vec<Value>,
    diagnostics: Vec<Value>,
}

fn scan_graph(name: &str) -> ScanGraph {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            fixture(name).to_str().expect("utf8 fixture path"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_fixture",
            "--scan-id",
            "scan_fixture",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed on {name}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut graph = ScanGraph {
        nodes: Vec::new(),
        edges: Vec::new(),
        diagnostics: Vec::new(),
    };
    for line in String::from_utf8(output.stdout)
        .expect("utf8 stdout")
        .lines()
    {
        let event = serde_json::from_str::<Value>(line).expect("json line");
        match event["event"].as_str() {
            Some("graph_node_batch") => graph
                .nodes
                .extend(event["graph_nodes"].as_array().cloned().unwrap_or_default()),
            Some("graph_edge_batch") => graph
                .edges
                .extend(event["graph_edges"].as_array().cloned().unwrap_or_default()),
            Some("diagnostic_batch") => graph
                .diagnostics
                .extend(event["diagnostics"].as_array().cloned().unwrap_or_default()),
            _ => {}
        }
    }
    graph
}

impl ScanGraph {
    fn diagnostics_on(&self, file_path: &str, code: &str) -> Vec<&Value> {
        self.diagnostics
            .iter()
            .filter(|diagnostic| diagnostic["code"] == code && diagnostic["file_path"] == file_path)
            .collect()
    }

    fn import_node_ids(&self, from_file: &str, source: &str) -> Vec<&str> {
        self.nodes
            .iter()
            .filter(|node| {
                node["kind"] == "import_decl"
                    && node["metadata"]["file_path"] == from_file
                    && node["metadata"]["source"] == source
            })
            .filter_map(|node| node["id"].as_str())
            .collect()
    }

    fn resolved_module_for(&self, from_file: &str, source: &str) -> Option<String> {
        let import_node_ids = self.import_node_ids(from_file, source);
        self.edges
            .iter()
            .find(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE"
                    && import_node_ids.contains(&edge["from"].as_str().unwrap_or(""))
            })
            .and_then(|edge| edge["metadata"]["resolved_file_path"].as_str())
            .map(ToOwned::to_owned)
    }
}

/// Open chain: `export * from "some-npm-pkg"` cannot be resolved, so an undeclared symbol
/// imported through the barrel may exist inside the external package - absence is
/// unprovable and no symbol-conservatism diagnostic may fire on the route.
#[test]
fn undeclared_symbol_through_external_star_stays_silent() {
    let graph = scan_graph("resolve-external-star");
    let route = "app/api/open-chain/route.ts";

    assert_eq!(
        graph
            .resolved_module_for(route, "@acme/open-barrel")
            .as_deref(),
        Some("packages/open-barrel/src/index.ts"),
        "module-level resolution to the barrel is the precondition: without it the \
         absence of a symbol diagnostic would be vacuous"
    );
    assert!(
        graph
            .diagnostics_on(route, "unresolved_import_symbol")
            .is_empty(),
        "an open export chain (external star target) makes symbol absence unprovable; \
         the conservative diagnostic must not fire, got {:?}",
        graph.diagnostics_on(route, "unresolved_import_symbol")
    );
}

/// Closed-chain control: every star target is local and resolvable, the export set is
/// complete, and the missing symbol is provably absent - the diagnostic MUST fire.
/// Guards the open-chain pin against decaying into blanket suppression.
#[test]
fn undeclared_symbol_through_closed_star_chain_still_fires() {
    let graph = scan_graph("resolve-external-star");
    let route = "app/api/closed-chain/route.ts";

    assert_eq!(
        graph
            .resolved_module_for(route, "@acme/closed-barrel")
            .as_deref(),
        Some("packages/closed-barrel/src/index.ts"),
        "closed-chain barrel must resolve at module level"
    );
    assert_eq!(
        graph
            .diagnostics_on(route, "unresolved_import_symbol")
            .len(),
        1,
        "with a fully resolvable star chain the symbol is provably absent; the \
         conservative diagnostic must fire exactly once, got {:?}",
        graph.diagnostics_on(route, "unresolved_import_symbol")
    );
}
