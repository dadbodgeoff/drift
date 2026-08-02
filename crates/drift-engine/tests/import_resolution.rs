use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

// S1-04 / E-2, E-3, E-4: resolver coverage. `forbiddenModuleFiles_` derives forbidden module
// identities from IMPORT_RESOLVES_TO_MODULE edges, so a specifier the resolver never resolves
// falls back to string matching — the measured recall bypass on dub/formbricks/openstatus.
// These tests assert on emitted edges, not findings, so they fail for the resolution reason
// rather than a downstream one.

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
    /// The module file an import specifier resolves to, via the IMPORT_RESOLVES_TO_MODULE
    /// edge emitted for the import_decl in `from_file` with exactly `source`.
    fn resolved_module_for(&self, from_file: &str, source: &str) -> Option<String> {
        let import_node_ids: Vec<&str> = self
            .nodes
            .iter()
            .filter(|node| {
                node["kind"] == "import_decl"
                    && node["metadata"]["file_path"] == from_file
                    && node["metadata"]["source"] == source
            })
            .filter_map(|node| node["id"].as_str())
            .collect();
        self.edges
            .iter()
            .find(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE"
                    && import_node_ids.contains(&edge["from"].as_str().unwrap_or(""))
            })
            .and_then(|edge| edge["metadata"]["resolved_file_path"].as_str())
            .map(ToOwned::to_owned)
    }

    fn import_decl_exists(&self, from_file: &str, source: &str) -> bool {
        self.nodes.iter().any(|node| {
            node["kind"] == "import_decl"
                && node["metadata"]["file_path"] == from_file
                && node["metadata"]["source"] == source
        })
    }
}

/// E-2 (S1-04 Gap 1): a workspace declared ONLY in pnpm-workspace.yaml — never in
/// package.json#workspaces — must still make its packages resolvable. formbricks and dub
/// declare workspaces exactly this way, which is why the T100 fix worked on cal.com
/// (package.json#workspaces) and nowhere else.
#[test]
fn pnpm_workspace_yaml_package_import_resolves_to_module() {
    let graph = scan_graph("resolve-pnpm-workspace");
    let route = "app/api/users/route.ts";

    assert_eq!(
        graph.resolved_module_for(route, "@acme/database").as_deref(),
        Some("packages/database/src/index.ts"),
        "package entry import must resolve via pnpm-workspace.yaml packages"
    );
    assert_eq!(
        graph
            .resolved_module_for(route, "@acme/database/src/client")
            .as_deref(),
        Some("packages/database/src/client.ts"),
        "package subpath import must resolve via pnpm-workspace.yaml packages"
    );
}

/// Negative controls for E-2, same commit (risk register row 1): resolving more must not
/// over-match. The sibling lookalike package resolves to its OWN module — never to the real
/// data package — and a type-only import produces no import_decl at all (T12).
#[test]
fn pnpm_workspace_negative_controls_stay_silent() {
    let graph = scan_graph("resolve-pnpm-workspace");
    let route = "app/api/users/route.ts";

    let legacy = graph.resolved_module_for(route, "@acme/database-legacy");
    assert_ne!(
        legacy.as_deref(),
        Some("packages/database/src/index.ts"),
        "sibling lookalike must never cross-resolve to the real package"
    );
    if let Some(resolved) = &legacy {
        assert!(
            resolved.starts_with("packages/database-legacy/"),
            "lookalike may only resolve into its own package, got {resolved}"
        );
    }

    // `import type {{ DatabaseMarker }}` is erased at runtime: no import_decl node, therefore
    // no edge for the matcher to consume. The value import of the same specifier appears as
    // local name `prisma`; the type-only binding must not.
    let type_only_decl = graph.nodes.iter().any(|node| {
        node["kind"] == "import_decl"
            && node["metadata"]["file_path"] == route
            && node["metadata"]["local_name"] == "DatabaseMarker"
    });
    assert!(
        !type_only_decl,
        "type-only import must not produce an import_decl node"
    );
    assert!(
        graph.import_decl_exists(route, "@acme/database"),
        "the value import of the same package must still be recorded"
    );
}
