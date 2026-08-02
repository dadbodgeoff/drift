use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

// S1-05 / E-5: namespace, dynamic `import()`, `require()` and `export *` chains provable at
// runtime. The engine's member-level symbol resolution is conservative; before this task the
// conservatism emitted `unresolved_import_symbol` / `unsupported_namespace_import_symbol`
// diagnostics on route files even when runtime use was provable from the AST (T12's
// identifier-usage partition) or the symbol was reachable through an `export *` chain - and
// any such diagnostic on a route file makes S1-01 refuse (exit 3) where it could block.
//
// These tests assert on emitted diagnostics and edges, not findings, so they fail for the
// resolution reason rather than a downstream one.

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
    for line in String::from_utf8(output.stdout).expect("utf8 stdout").lines() {
        let event = serde_json::from_str::<Value>(line).expect("json line");
        match event["event"].as_str() {
            Some("graph_node_batch") => graph
                .nodes
                .extend(event["graph_nodes"].as_array().cloned().unwrap_or_default()),
            Some("graph_edge_batch") => graph
                .edges
                .extend(event["graph_edges"].as_array().cloned().unwrap_or_default()),
            Some("diagnostic_batch") => graph.diagnostics.extend(
                event["diagnostics"].as_array().cloned().unwrap_or_default(),
            ),
            _ => {}
        }
    }
    graph
}

impl ScanGraph {
    fn diagnostics_on(&self, file_path: &str, code: &str) -> Vec<&Value> {
        self.diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic["code"] == code && diagnostic["file_path"] == file_path
            })
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

    /// The symbol node an import resolves to, via IMPORT_RESOLVES_TO_SYMBOL.
    fn resolved_symbol_for(&self, from_file: &str, source: &str) -> Option<String> {
        let import_node_ids = self.import_node_ids(from_file, source);
        self.edges
            .iter()
            .find(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_SYMBOL"
                    && import_node_ids.contains(&edge["from"].as_str().unwrap_or(""))
            })
            .and_then(|edge| edge["to"].as_str())
            .map(ToOwned::to_owned)
    }
}

/// E-5 (S1-05, `export *` chains): a named import whose symbol arrives through an
/// `export *` re-export chain must resolve to the symbol in its DECLARING file, and the
/// conservative `unresolved_import_symbol` diagnostic must not fire on the importing route.
#[test]
fn named_import_resolves_through_export_star_chain() {
    let graph = scan_graph("resolve-runtime-provable");
    let route = "app/api/chain/route.ts";

    assert_eq!(
        graph.resolved_module_for(route, "@acme/database").as_deref(),
        Some("packages/database/src/index.ts"),
        "module-level resolution is a precondition (E-2 behaviour)"
    );
    assert_eq!(
        graph.resolved_symbol_for(route, "@acme/database").as_deref(),
        Some("symbol:packages/database/src/client.ts:function:prisma"),
        "prisma must resolve through the export * chain to its declaring file"
    );
    assert!(
        graph.diagnostics_on(route, "unresolved_import_symbol").is_empty(),
        "no unresolved_import_symbol may fire for a symbol reachable through the chain, got {:?}",
        graph.diagnostics_on(route, "unresolved_import_symbol")
    );
}

/// E-5 (S1-05, namespace): `import * as db` whose binding appears in a value position is
/// runtime by proof - the conservative namespace diagnostic must not fire on that route.
#[test]
fn value_used_namespace_import_is_runtime_provable() {
    let graph = scan_graph("resolve-runtime-provable");
    let route = "app/api/namespace/route.ts";

    assert_eq!(
        graph.resolved_module_for(route, "@acme/database").as_deref(),
        Some("packages/database/src/index.ts"),
        "namespace import must still resolve at module level"
    );
    assert!(
        graph
            .diagnostics_on(route, "unsupported_namespace_import_symbol")
            .is_empty(),
        "a namespace binding used as a value is provably runtime; the conservative \
         diagnostic must not fire, got {:?}",
        graph.diagnostics_on(route, "unsupported_namespace_import_symbol")
    );
}

/// E-5 (S1-05, dynamic/require): `await import(m)` and `require(m)` are runtime by
/// construction - no type-only reading exists - so member-level conservatism must not
/// put a symbol diagnostic on the route.
#[test]
fn dynamic_import_and_require_are_runtime_by_construction() {
    let graph = scan_graph("resolve-runtime-provable");

    for route in ["app/api/dynamic/route.ts", "app/api/require/route.ts"] {
        assert_eq!(
            graph.resolved_module_for(route, "@acme/database").as_deref(),
            Some("packages/database/src/index.ts"),
            "{route}: runtime import must resolve at module level"
        );
        assert!(
            graph.diagnostics_on(route, "unresolved_import_symbol").is_empty(),
            "{route}: a runtime-by-construction import must not carry a symbol \
             conservatism diagnostic, got {:?}",
            graph.diagnostics_on(route, "unresolved_import_symbol")
        );
        assert!(
            graph
                .diagnostics_on(route, "unsupported_namespace_import_symbol")
                .is_empty(),
            "{route}: no namespace conservatism diagnostic for runtime imports"
        );
    }
}

/// Negative control (S1-05 direction of caution): a namespace binding with NO usage
/// evidence at all must STAY conservative - the diagnostic still fires. Guards against
/// over-suppression turning the fix into a silent miss.
#[test]
fn unused_namespace_import_stays_conservative() {
    let graph = scan_graph("resolve-runtime-provable");
    let route = "app/api/unused-namespace/route.ts";

    assert_eq!(
        graph
            .diagnostics_on(route, "unsupported_namespace_import_symbol")
            .len(),
        1,
        "an unused namespace binding has no provable runtime use; the conservative \
         diagnostic must remain"
    );
}

/// Negative control (parent DoD): `import * as T` used ONLY in type positions
/// (`type Row = T.PrismaLike`, `keyof typeof T`) is erased at compile time. It must not
/// count as runtime use: no import_decl node, no namespace diagnostic. The type-only named
/// import in the same file must stay silent too (T12 pin).
#[test]
fn pure_type_usage_of_namespace_import_is_not_runtime_use() {
    let graph = scan_graph("resolve-runtime-provable");
    let route = "app/api/typeonly-namespace/route.ts";

    assert!(
        graph.import_node_ids(route, "@acme/database").is_empty(),
        "a namespace import used only in type positions is erased at runtime and must \
         not produce an import_decl node"
    );
    assert!(
        graph
            .diagnostics_on(route, "unsupported_namespace_import_symbol")
            .is_empty(),
        "no namespace conservatism diagnostic for a type-erased namespace import"
    );
    assert!(
        graph.diagnostics_on(route, "unresolved_import_symbol").is_empty(),
        "no symbol diagnostic of any kind on the type-only route"
    );
}
