use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

// S10: the bindingless side-effect import (`import "@acme/database";`).
//
// A side-effect import has no local binding, which is exactly why it was invisible: the
// binding extractor returned an empty binding list and no `import_used` fact was emitted at
// all. But a side-effect import EXECUTES the module - that is its entire purpose - so it is a
// runtime dependency on the forbidden module by definition, and the O-3 evasion matrix
// recorded it as a silent miss (`known_evasion: true`) on all seven eval repos.
//
// These tests assert on the resolution edge and the diagnostics, not on findings, so they
// fail for the resolution reason rather than a downstream one. The two boundaries that make
// the fix safe rather than merely louder are asserted here too: an asset side-effect import
// (`import "./route.css"`) must stay entirely absent from the graph, because an
// `unresolved_import` diagnostic on a route file makes the whole check refuse (exit 3); and a
// lookalike sibling package must resolve to its own module, never the data layer's.

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
    fn import_nodes(&self, from_file: &str, source: &str) -> Vec<&Value> {
        self.nodes
            .iter()
            .filter(|node| {
                node["kind"] == "import_decl"
                    && node["metadata"]["file_path"] == from_file
                    && node["metadata"]["source"] == source
            })
            .collect()
    }

    fn import_nodes_in(&self, from_file: &str) -> Vec<&Value> {
        self.nodes
            .iter()
            .filter(|node| {
                node["kind"] == "import_decl" && node["metadata"]["file_path"] == from_file
            })
            .collect()
    }

    fn resolved_module_for(&self, from_file: &str, source: &str) -> Option<String> {
        let import_node_ids = self
            .import_nodes(from_file, source)
            .into_iter()
            .filter_map(|node| node["id"].as_str())
            .collect::<Vec<_>>();
        self.edges
            .iter()
            .find(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE"
                    && import_node_ids.contains(&edge["from"].as_str().unwrap_or(""))
            })
            .and_then(|edge| edge["metadata"]["resolved_file_path"].as_str())
            .map(ToOwned::to_owned)
    }

    fn diagnostics_on(&self, file_path: &str, code: &str) -> Vec<&Value> {
        self.diagnostics
            .iter()
            .filter(|diagnostic| diagnostic["code"] == code && diagnostic["file_path"] == file_path)
            .collect()
    }
}

/// The core S10 claim: a bindingless import declaration still emits an `import_decl` fact and
/// still resolves to the module it names.
#[test]
fn side_effect_import_resolves_to_its_module() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/side-effect/route.ts";

    let nodes = graph.import_nodes(route, "@acme/database");
    assert_eq!(
        nodes.len(),
        1,
        "a bindingless `import \"@acme/database\"` must emit exactly one import_decl node, got {nodes:?}"
    );
    assert_eq!(
        nodes[0]["metadata"]["import_kind"], "side_effect",
        "the node must record that it carries no binding, so consumers can tell it apart \
         from a value import"
    );
    assert_eq!(
        graph
            .resolved_module_for(route, "@acme/database")
            .as_deref(),
        Some("packages/database/src/index.ts"),
        "the side-effect import must resolve to the data module, which is the edge the \
         direct-data-access rule matches on"
    );
}

/// A side-effect import executes the module: there is no type-only reading of it, so the
/// conservative symbol diagnostics must not fire. Any of them on a route file turns a
/// blockable violation into a fail-closed refusal (exit 3), which would hide the fix.
#[test]
fn side_effect_import_carries_no_conservatism_diagnostic() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/side-effect/route.ts";

    for code in [
        "unresolved_import",
        "unresolved_import_symbol",
        "unsupported_namespace_import_symbol",
    ] {
        assert!(
            graph.diagnostics_on(route, code).is_empty(),
            "{code} must not fire for a side-effect import, got {:?}",
            graph.diagnostics_on(route, code)
        );
    }
}

/// A relative bindingless import of a real TypeScript module resolves like any other.
#[test]
fn relative_side_effect_import_resolves() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/local/route.ts";

    assert_eq!(
        graph.resolved_module_for(route, "./setup").as_deref(),
        Some("app/api/local/setup.ts"),
        "a relative side-effect import is still a module dependency"
    );
    assert!(
        graph.diagnostics_on(route, "unresolved_import").is_empty(),
        "a resolvable relative side-effect import must not be reported unresolved"
    );
}

/// Boundary (a): stylesheet and asset side-effect imports are not module dependencies the
/// resolver can follow. They must produce NO import_decl node - and critically no
/// `unresolved_import` diagnostic, which on a route file makes the entire check refuse.
#[test]
fn asset_side_effect_import_stays_out_of_the_graph() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/asset/route.ts";

    assert!(
        graph.import_nodes_in(route).is_empty(),
        "`import \"./route.css\"` must not become an import_decl, got {:?}",
        graph.import_nodes_in(route)
    );
    assert!(
        graph.diagnostics_on(route, "unresolved_import").is_empty(),
        "an asset import must not be reported as an unresolved module import - that would \
         refuse the check (exit 3) on any route that imports a stylesheet, got {:?}",
        graph.diagnostics_on(route, "unresolved_import")
    );
}

/// Boundary (b): a sibling package whose name shares a prefix with the data layer resolves to
/// its own module. Identity matching, not string matching, is what keeps this silent.
#[test]
fn lookalike_side_effect_import_resolves_to_its_own_module() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/lookalike/route.ts";

    assert_eq!(
        graph
            .resolved_module_for(route, "@acme/database-legacy")
            .as_deref(),
        Some("packages/database-legacy/src/index.ts"),
        "the lookalike must resolve to its own file, never the data layer's"
    );
}

/// Boundary (b): a type-only import is erased at compile time and stays silent. S10 must not
/// widen into "any import declaration is a runtime use".
#[test]
fn type_only_import_emits_no_import_decl() {
    let graph = scan_graph("resolve-side-effect-import");
    let route = "app/api/type-only/route.ts";

    assert!(
        graph.import_nodes_in(route).is_empty(),
        "`import type {{ ... }}` creates no runtime dependency, got {:?}",
        graph.import_nodes_in(route)
    );
}
