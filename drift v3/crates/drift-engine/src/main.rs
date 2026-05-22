use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::Instant,
};

mod check_command;
mod protocol;

use check_command::check_repo;
use drift_engine::{Fact, FactKind, extract_typescript_facts, should_index_path};
use protocol::*;
use serde_json::json;
use sha2::{Digest, Sha256};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("scan-repo") => {
            let args = parse_scan_repo_args(args.collect())?;
            match args.format {
                OutputFormat::Json => {
                    let output = scan_repo(&args.repo_root, args.repo_id, args.scan_id)?;
                    println!("{}", serde_json::to_string_pretty(&output)?);
                    Ok(())
                }
                OutputFormat::Jsonl => stream_scan_repo(&args.repo_root, args.repo_id, args.scan_id),
            }
        }
        Some("check-repo") => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let request: CheckRequest = serde_json::from_str(&input)?;
            let output = check_repo(request);
            println!("{}", serde_json::to_string(&output)?);
            Ok(())
        }
        _ => Err("usage: drift-engine scan-repo <repo-root> [--format json|jsonl] [--repo-id <id>] [--scan-id <id>] | check-repo".into()),
    }
}

fn parse_scan_repo_args(args: Vec<String>) -> Result<ScanRepoArgs, Box<dyn std::error::Error>> {
    let repo_root = args.first().ok_or("missing repo root for scan-repo")?;
    let mut parsed = ScanRepoArgs {
        repo_root: PathBuf::from(repo_root),
        format: OutputFormat::Json,
        repo_id: "repo_unknown".to_string(),
        scan_id: "scan_unknown".to_string(),
    };
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--format" => {
                index += 1;
                let format = args.get(index).ok_or("missing value for --format")?;
                parsed.format = match format.as_str() {
                    "json" => OutputFormat::Json,
                    "jsonl" => OutputFormat::Jsonl,
                    _ => return Err("invalid --format, expected json or jsonl".into()),
                };
            }
            "--repo-id" => {
                index += 1;
                parsed.repo_id = args
                    .get(index)
                    .ok_or("missing value for --repo-id")?
                    .to_string();
            }
            "--scan-id" => {
                index += 1;
                parsed.scan_id = args
                    .get(index)
                    .ok_or("missing value for --scan-id")?
                    .to_string();
            }
            flag => return Err(format!("unknown scan-repo option: {flag}").into()),
        }
        index += 1;
    }
    Ok(parsed)
}

fn scan_repo(
    repo_root: &Path,
    repo_id: String,
    scan_id: String,
) -> Result<ScanRepoOutput, Box<dyn std::error::Error>> {
    let started = Instant::now();
    let mut files = Vec::new();
    let ignore = IgnoreMatcher::from_repo(repo_root);
    collect_indexable_files(repo_root, repo_root, &mut files, &ignore)?;
    files.sort();
    let resolver = build_resolver_context(repo_root, &files);

    let mut scanned_files = Vec::new();
    let mut facts = Vec::new();
    let mut diagnostics = Vec::new();
    let mut graph_node_count = 0_usize;
    let mut graph_edge_count = 0_usize;
    for file_path in &files {
        let Some((file, file_facts)) = scan_file(repo_root, file_path, &mut diagnostics)? else {
            continue;
        };
        let graph = graph_for_file(&repo_id, &scan_id, &file, &file_facts, &resolver);
        graph_node_count += graph.nodes.len();
        graph_edge_count += graph.edges.len();
        diagnostics.extend(graph.diagnostics);
        scanned_files.push(file);
        facts.extend(file_facts);
    }

    let mut stats = engine_stats(
        files.len(),
        diagnostics.len(),
        scanned_files.len(),
        facts.len(),
        diagnostics.len(),
        started.elapsed().as_millis(),
    );
    stats.graph_nodes = graph_node_count;
    stats.graph_edges = graph_edge_count;
    Ok(ScanRepoOutput {
        schema_version: ENGINE_SCAN_RESULT_SCHEMA_VERSION,
        repo_id,
        scan_id,
        engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        adapter_versions: adapter_versions(),
        file_snapshots: scanned_files,
        facts,
        diagnostics,
        stats,
        completeness: repo_completeness(),
    })
}

fn stream_scan_repo(
    repo_root: &Path,
    repo_id: String,
    scan_id: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    write_event(
        &mut stdout,
        &ScanStreamEvent::ScanStarted {
            schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
            repo_id: repo_id.clone(),
            scan_id: scan_id.clone(),
            engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        },
    )?;

    let mut files = Vec::new();
    let ignore = IgnoreMatcher::from_repo(repo_root);
    collect_indexable_files(repo_root, repo_root, &mut files, &ignore)?;
    files.sort();
    let resolver = build_resolver_context(repo_root, &files);

    let mut files_parsed = 0_usize;
    let mut files_skipped = 0_usize;
    let mut facts_emitted = 0_usize;
    let mut graph_nodes_emitted = 0_usize;
    let mut graph_edges_emitted = 0_usize;
    let mut diagnostics_emitted = 0_usize;
    for file_path in &files {
        let mut diagnostics = Vec::new();
        let scanned = scan_file(repo_root, file_path, &mut diagnostics)?;
        if !diagnostics.is_empty() {
            diagnostics_emitted += diagnostics.len();
            files_skipped += 1;
            write_event(
                &mut stdout,
                &ScanStreamEvent::DiagnosticBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    diagnostics,
                },
            )?;
        }
        let Some((file, facts)) = scanned else {
            continue;
        };
        files_parsed += 1;
        facts_emitted += facts.len();
        let graph = graph_for_file(&repo_id, &scan_id, &file, &facts, &resolver);
        graph_nodes_emitted += graph.nodes.len();
        graph_edges_emitted += graph.edges.len();
        if !graph.diagnostics.is_empty() {
            diagnostics_emitted += graph.diagnostics.len();
            write_event(
                &mut stdout,
                &ScanStreamEvent::DiagnosticBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    diagnostics: graph.diagnostics,
                },
            )?;
        }
        write_event(
            &mut stdout,
            &ScanStreamEvent::FileSnapshotBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                file_snapshots: vec![file],
            },
        )?;
        if !facts.is_empty() {
            write_event(
                &mut stdout,
                &ScanStreamEvent::FactBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    facts,
                },
            )?;
        }
        if !graph.nodes.is_empty() {
            write_event(
                &mut stdout,
                &ScanStreamEvent::GraphNodeBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    graph_nodes: graph.nodes,
                },
            )?;
        }
        if !graph.edges.is_empty() {
            write_event(
                &mut stdout,
                &ScanStreamEvent::GraphEdgeBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    graph_edges: graph.edges,
                },
            )?;
        }
        if !graph.evidence.is_empty() {
            write_event(
                &mut stdout,
                &ScanStreamEvent::GraphEvidenceBatch {
                    schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                    graph_evidence: graph.evidence,
                },
            )?;
        }
    }

    let mut stats = engine_stats(
        files.len(),
        files_skipped,
        files_parsed,
        facts_emitted,
        diagnostics_emitted,
        started.elapsed().as_millis(),
    );
    stats.graph_nodes = graph_nodes_emitted;
    stats.graph_edges = graph_edges_emitted;
    write_event(
        &mut stdout,
        &ScanStreamEvent::ScanCompleted {
            schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
            stats,
            completeness: repo_completeness(),
        },
    )?;
    stdout.flush()?;
    Ok(())
}

fn write_event(
    writer: &mut impl Write,
    event: &ScanStreamEvent,
) -> Result<(), Box<dyn std::error::Error>> {
    serde_json::to_writer(&mut *writer, event)?;
    writer.write_all(b"\n")?;
    Ok(())
}

fn scan_file(
    repo_root: &Path,
    file_path: &Path,
    diagnostics: &mut Vec<EngineDiagnostic>,
) -> Result<Option<(ScannedFile, Vec<EngineFact>)>, Box<dyn std::error::Error>> {
    let absolute_path = repo_root.join(file_path);
    let metadata = fs::metadata(&absolute_path)?;
    if metadata.len() > MAX_FILE_BYTES {
        diagnostics.push(EngineDiagnostic {
            severity: "warning".to_string(),
            code: "file_too_large".to_string(),
            message: format!(
                "Skipped {} because it is {} bytes, above the {} byte scan limit.",
                normalize_path(file_path),
                metadata.len(),
                MAX_FILE_BYTES
            ),
            file_path: Some(normalize_path(file_path)),
        });
        return Ok(None);
    }
    let source = fs::read_to_string(&absolute_path)?;
    let normalized = normalize_path(file_path);
    let file = ScannedFile {
        file_path: normalized,
        content_hash: hash_file(&absolute_path)?,
        byte_size: metadata.len(),
        indexed: true,
    };
    let facts = extract_typescript_facts(file_path, &source)?
        .into_iter()
        .map(engine_fact)
        .collect();
    Ok(Some((file, facts)))
}

fn collect_indexable_files(
    repo_root: &Path,
    dir: &Path,
    files: &mut Vec<PathBuf>,
    ignore: &IgnoreMatcher,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(repo_root).unwrap_or(&path);
        if ignore.is_ignored(relative) {
            continue;
        }
        if !should_index_path(relative) {
            continue;
        }

        if file_type.is_dir() {
            collect_indexable_files(repo_root, &path, files, ignore)?;
        } else if file_type.is_file() && is_typescript_path(&path) {
            files.push(relative.to_path_buf());
        }
    }
    Ok(())
}

#[derive(Default)]
struct IgnoreMatcher {
    patterns: Vec<String>,
}

impl IgnoreMatcher {
    fn from_repo(repo_root: &Path) -> Self {
        let Ok(contents) = fs::read_to_string(repo_root.join(".gitignore")) else {
            return Self::default();
        };
        let patterns = contents
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with('!'))
            .map(|line| line.trim_start_matches('/').to_string())
            .collect();
        Self { patterns }
    }

    fn is_ignored(&self, relative: &Path) -> bool {
        let path = normalize_path(relative);
        let file_name = relative
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(path.as_str());
        self.patterns.iter().any(|pattern| gitignore_pattern_matches(pattern, &path, file_name))
    }
}

fn gitignore_pattern_matches(pattern: &str, path: &str, file_name: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix("/**") {
        let prefix = prefix.trim_end_matches('/');
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if let Some(prefix) = pattern.strip_suffix('/') {
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return file_name.ends_with(suffix) || path.ends_with(suffix);
    }
    if pattern.contains('/') {
        return path == pattern || path.starts_with(&format!("{pattern}/"));
    }
    path.split('/').any(|component| component == pattern)
}

fn is_typescript_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs")
    )
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn engine_fact(fact: Fact) -> EngineFact {
    EngineFact {
        kind: fact_kind(fact.kind).to_string(),
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        start_line: fact.start_line,
        end_line: fact.end_line,
    }
}

fn fact_kind(kind: FactKind) -> &'static str {
    match kind {
        FactKind::FileDetected => "file_detected",
        FactKind::ImportUsed => "import_used",
        FactKind::ExportedSymbol => "exported_symbol",
        FactKind::SymbolCalled => "symbol_called",
        FactKind::RouteDeclared => "route_declared",
        FactKind::FileRoleDetected => "file_role_detected",
        FactKind::TestDeclared => "test_declared",
    }
}

fn normalize_path(path: &Path) -> String {
    normalize_repo_string(&path.to_string_lossy())
}

struct GraphBatch {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    evidence: Vec<GraphEvidence>,
    diagnostics: Vec<EngineDiagnostic>,
}

struct ResolverContext {
    snapshot_paths: BTreeSet<String>,
    path_aliases: Vec<PathAlias>,
    packages: BTreeMap<String, WorkspacePackage>,
}

struct PathAlias {
    pattern: String,
    targets: Vec<String>,
}

struct WorkspacePackage {
    root: String,
    export: Option<String>,
}

fn graph_for_file(
    repo_id: &str,
    scan_id: &str,
    file: &ScannedFile,
    facts: &[EngineFact],
    resolver: &ResolverContext,
) -> GraphBatch {
    let mut nodes = BTreeMap::<String, GraphNode>::new();
    let mut edges = BTreeMap::<String, GraphEdge>::new();
    let mut evidence = BTreeMap::<String, GraphEvidence>::new();
    let mut diagnostics = Vec::new();
    let file_node = file_id(&file.file_path);
    let file_version_node = file_version_id(&file.file_path, &file.content_hash);
    let module_node = module_id(&file.file_path);
    let import_nodes_by_local_name = facts
        .iter()
        .filter(|fact| fact.kind == "import_used")
        .filter_map(|fact| {
            let source = fact.value.as_ref()?;
            Some((
                fact.name.clone(),
                import_decl_id(&fact.file_path, &file.content_hash, source, &fact.name, fact.start_line, fact.end_line),
            ))
        })
        .collect::<BTreeMap<_, _>>();

    insert_node(
        &mut nodes,
        file_node.clone(),
        "file",
        &file.file_path,
        true,
        Vec::new(),
        BTreeMap::from([("path".to_string(), json!(file.file_path))]),
    );
    insert_node(
        &mut nodes,
        file_version_node.clone(),
        "file_version",
        &format!("{}@{}", file.file_path, hash_prefix(&file.content_hash)),
        false,
        Vec::new(),
        BTreeMap::from([
            ("file_path".to_string(), json!(file.file_path)),
            ("content_hash".to_string(), json!(file.content_hash)),
            ("byte_size".to_string(), json!(file.byte_size)),
        ]),
    );
    insert_node(
        &mut nodes,
        module_node.clone(),
        "module",
        &file.file_path,
        true,
        Vec::new(),
        BTreeMap::from([("file_path".to_string(), json!(file.file_path))]),
    );
    insert_edge(&mut edges, "FILE_HAS_VERSION", &file_node, &file_version_node, Vec::new(), BTreeMap::new());
    insert_edge(&mut edges, "FILE_DEFINES_MODULE", &file_node, &module_node, Vec::new(), BTreeMap::new());

    for fact in facts {
        let evidence_id = evidence_id("typescript", &fact.file_path, &file.content_hash, fact.start_line, fact.end_line);
        evidence.insert(evidence_id.clone(), GraphEvidence {
            id: evidence_id.clone(),
            repo_id: repo_id.to_string(),
            scan_id: scan_id.to_string(),
            artifact_id: file_version_id(&fact.file_path, &file.content_hash),
            file_path: fact.file_path.clone(),
            file_hash: file.content_hash.clone(),
            start_line: fact.start_line,
            end_line: fact.end_line,
            adapter_id: "typescript".to_string(),
            adapter_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
            fact_ids: vec![fact_id(fact)],
            redaction_state: "none".to_string(),
        });

        match fact.kind.as_str() {
            "file_role_detected" => {
                let role_node = format!("file_role:{}", fact.name);
                insert_node(
                    &mut nodes,
                    role_node.clone(),
                    "file_role",
                    &fact.name,
                    true,
                    vec![evidence_id.clone()],
                    BTreeMap::from([("role".to_string(), json!(fact.name))]),
                );
                insert_edge(&mut edges, "FILE_HAS_ROLE", &file_node, &role_node, vec![evidence_id], BTreeMap::new());
            }
            "import_used" => {
                let Some(source) = &fact.value else {
                    continue;
                };
                let import_node = import_decl_id(&fact.file_path, &file.content_hash, source, &fact.name, fact.start_line, fact.end_line);
                insert_node(
                    &mut nodes,
                    import_node.clone(),
                    "import_decl",
                    &format!("{} from {}", fact.name, source),
                    false,
                    vec![evidence_id.clone()],
                    BTreeMap::from([
                        ("source".to_string(), json!(source)),
                        ("local_name".to_string(), json!(fact.name)),
                        ("file_path".to_string(), json!(fact.file_path)),
                    ]),
                );
                insert_edge(&mut edges, "IMPORT_DECL_REFERENCES_MODULE", &import_node, &module_node, vec![evidence_id.clone()], BTreeMap::new());
                if let Some(resolved) = resolve_import(&fact.file_path, source, resolver) {
                    let resolved_module = module_id(&resolved);
                    insert_edge(&mut edges, "IMPORT_RESOLVES_TO_MODULE", &import_node, &resolved_module, vec![evidence_id.clone()], BTreeMap::new());
                    insert_edge(&mut edges, "MODULE_IMPORTS_MODULE", &module_node, &resolved_module, vec![evidence_id], BTreeMap::new());
                } else if should_report_unresolved_import(source, resolver) {
                    diagnostics.push(EngineDiagnostic {
                        severity: "warning".to_string(),
                        code: "unresolved_import".to_string(),
                        message: format!("Could not resolve import {source} from {}.", fact.file_path),
                        file_path: Some(fact.file_path.clone()),
                    });
                }
            }
            "exported_symbol" => {
                let symbol_node = symbol_id(&fact.file_path, "function", &fact.name);
                insert_node(
                    &mut nodes,
                    symbol_node.clone(),
                    "symbol",
                    &fact.name,
                    true,
                    vec![evidence_id.clone()],
                    BTreeMap::from([
                        ("file_path".to_string(), json!(fact.file_path)),
                        ("symbol_kind".to_string(), json!("function")),
                        ("exported".to_string(), json!(true)),
                    ]),
                );
                insert_edge(&mut edges, "FILE_CONTAINS_SYMBOL", &file_node, &symbol_node, vec![evidence_id.clone()], BTreeMap::new());
                insert_edge(&mut edges, "MODULE_EXPORTS_SYMBOL", &module_node, &symbol_node, vec![evidence_id], BTreeMap::new());
            }
            "route_declared" => {
                let route_node = format!("route:{}:{}", fact.name, fact.file_path);
                insert_node(
                    &mut nodes,
                    route_node.clone(),
                    "route",
                    &fact.name,
                    true,
                    vec![evidence_id.clone()],
                    BTreeMap::from([
                        ("method".to_string(), json!(fact.name)),
                        ("file_path".to_string(), json!(fact.file_path)),
                    ]),
                );
                insert_edge(&mut edges, "ROUTE_DECLARED_IN_FILE", &route_node, &file_node, vec![evidence_id.clone()], BTreeMap::new());
                insert_edge(&mut edges, "ROUTE_HANDLED_BY_SYMBOL", &route_node, &symbol_id(&fact.file_path, "function", &fact.name), vec![evidence_id], BTreeMap::new());
            }
            "symbol_called" => {
                let callsite_node = format!(
                    "callsite:{}:{}:{}:{}-{}",
                    fact.file_path,
                    hash_prefix(&file.content_hash),
                    fact.name,
                    fact.start_line,
                    fact.end_line
                );
                insert_node(
                    &mut nodes,
                    callsite_node.clone(),
                    "callsite",
                    &fact.name,
                    false,
                    vec![evidence_id.clone()],
                    optional_receiver_metadata(BTreeMap::from([
                        ("file_path".to_string(), json!(fact.file_path)),
                        ("callee_name".to_string(), json!(fact.name)),
                    ]), fact.value.as_deref()),
                );
                insert_edge(&mut edges, "CALLSITE_REFERENCES_SYMBOL", &callsite_node, &module_node, vec![evidence_id.clone()], BTreeMap::from([
                    ("confidence".to_string(), json!("name-only")),
                    ("callee_name".to_string(), json!(fact.name)),
                ]));
                if let Some(receiver) = fact.value.as_deref() {
                    if let Some(import_node) = import_nodes_by_local_name.get(receiver_root(receiver)) {
                        insert_edge(&mut edges, "CALLSITE_REFERENCES_SYMBOL", &callsite_node, import_node, vec![evidence_id.clone()], BTreeMap::from([
                            ("confidence".to_string(), json!("import-alias")),
                            ("callee_name".to_string(), json!(fact.name)),
                            ("receiver_name".to_string(), json!(receiver)),
                            ("local_name".to_string(), json!(receiver_root(receiver))),
                        ]));
                    }
                }
            }
            _ => {}
        }
    }

    GraphBatch {
        nodes: nodes.into_values().collect(),
        edges: edges.into_values().collect(),
        evidence: evidence.into_values().collect(),
        diagnostics,
    }
}

fn insert_node(
    nodes: &mut BTreeMap<String, GraphNode>,
    id: String,
    kind: &str,
    label: &str,
    stable: bool,
    evidence_ids: Vec<String>,
    metadata: BTreeMap<String, serde_json::Value>,
) {
    nodes.insert(id.clone(), GraphNode {
        id,
        kind: kind.to_string(),
        label: label.to_string(),
        stable,
        evidence_ids,
        metadata,
    });
}

fn insert_edge(
    edges: &mut BTreeMap<String, GraphEdge>,
    kind: &str,
    from: &str,
    to: &str,
    evidence_ids: Vec<String>,
    metadata: BTreeMap<String, serde_json::Value>,
) {
    let id = format!("edge:{from}:{kind}:{to}");
    edges.insert(id.clone(), GraphEdge {
        id,
        kind: kind.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        evidence_ids,
        metadata,
    });
}

fn optional_receiver_metadata(
    mut metadata: BTreeMap<String, serde_json::Value>,
    receiver: Option<&str>,
) -> BTreeMap<String, serde_json::Value> {
    if let Some(receiver) = receiver {
        metadata.insert("receiver_name".to_string(), json!(receiver));
        metadata.insert("receiver_root".to_string(), json!(receiver_root(receiver)));
    }
    metadata
}

fn receiver_root(receiver: &str) -> &str {
    receiver.split('.').next().unwrap_or(receiver)
}

fn file_id(file_path: &str) -> String {
    format!("file:{file_path}")
}

fn file_version_id(file_path: &str, content_hash: &str) -> String {
    format!("file_version:{file_path}:{}", hash_prefix(content_hash))
}

fn module_id(file_path: &str) -> String {
    format!("module:{file_path}")
}

fn symbol_id(file_path: &str, symbol_kind: &str, name: &str) -> String {
    format!("symbol:{file_path}:{symbol_kind}:{name}")
}

fn import_decl_id(
    file_path: &str,
    content_hash: &str,
    source: &str,
    local_name: &str,
    start_line: usize,
    end_line: usize,
) -> String {
    format!(
        "import_decl:{file_path}:{}:{source}:{local_name}:{start_line}-{end_line}",
        hash_prefix(content_hash)
    )
}

fn evidence_id(adapter_id: &str, file_path: &str, content_hash: &str, start_line: usize, end_line: usize) -> String {
    format!("evidence:{adapter_id}:{file_path}:{}:{start_line}-{end_line}", hash_prefix(content_hash))
}

fn fact_id(fact: &EngineFact) -> String {
    format!("fact:{}:{}:{}:{}-{}", fact.kind, fact.file_path, fact.name, fact.start_line, fact.end_line)
}

fn build_resolver_context(repo_root: &Path, files: &[PathBuf]) -> ResolverContext {
    ResolverContext {
        snapshot_paths: files.iter().map(|file| normalize_path(file)).collect(),
        path_aliases: read_tsconfig_path_aliases(repo_root),
        packages: read_workspace_packages(repo_root),
    }
}

fn resolve_import(from_file: &str, source: &str, resolver: &ResolverContext) -> Option<String> {
    import_bases(from_file, source, resolver)
        .into_iter()
        .flat_map(|base| candidate_paths(&base))
        .find(|candidate| resolver.snapshot_paths.contains(candidate))
}

fn should_report_unresolved_import(source: &str, resolver: &ResolverContext) -> bool {
    source.starts_with('.')
        || resolver.path_aliases.iter().any(|alias| alias_matches(&alias.pattern, source))
        || resolver.packages.keys().any(|name| source == name || source.starts_with(&format!("{name}/")))
}

fn import_bases(from_file: &str, source: &str, resolver: &ResolverContext) -> Vec<String> {
    if source.starts_with('.') {
        let base = Path::new(from_file)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(source);
        return vec![normalize_path(&base)];
    }

    let mut bases = Vec::new();
    for alias in &resolver.path_aliases {
        if !alias_matches(&alias.pattern, source) {
            continue;
        }
        let captured = alias_capture(&alias.pattern, source);
        for target in &alias.targets {
            bases.push(target.replace('*', &captured).replace('\\', "/"));
        }
    }

    for (name, package) in &resolver.packages {
        if source == name {
            if let Some(export) = &package.export {
                bases.push(join_repo_path(&package.root, export.trim_start_matches("./")));
            }
            bases.push(join_repo_path(&package.root, "src/index"));
            bases.push(join_repo_path(&package.root, "index"));
        } else if let Some(rest) = source.strip_prefix(&format!("{name}/")) {
            bases.push(join_repo_path(&package.root, rest));
            bases.push(join_repo_path(&package.root, &format!("src/{rest}")));
        }
    }

    bases
}

fn read_tsconfig_path_aliases(repo_root: &Path) -> Vec<PathAlias> {
    let Ok(contents) = fs::read_to_string(repo_root.join("tsconfig.json")) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return Vec::new();
    };
    let base_url = json
        .pointer("/compilerOptions/baseUrl")
        .and_then(|value| value.as_str())
        .unwrap_or(".");
    let Some(paths) = json.pointer("/compilerOptions/paths").and_then(|value| value.as_object()) else {
        return Vec::new();
    };
    paths
        .iter()
        .filter_map(|(pattern, value)| {
            let targets = value
                .as_array()?
                .iter()
                .filter_map(|target| target.as_str())
                .map(|target| normalize_repo_string(&join_repo_path(base_url, target)))
                .collect::<Vec<_>>();
            Some(PathAlias {
                pattern: pattern.to_string(),
                targets,
            })
        })
        .collect()
}

fn read_workspace_packages(repo_root: &Path) -> BTreeMap<String, WorkspacePackage> {
    let mut packages = BTreeMap::new();
    let Ok(contents) = fs::read_to_string(repo_root.join("package.json")) else {
        return packages;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return packages;
    };
    let workspace_globs = json
        .get("workspaces")
        .and_then(workspace_globs)
        .unwrap_or_default();

    for glob in workspace_globs {
        let Some(prefix) = glob.strip_suffix("/*") else {
            continue;
        };
        let workspace_root = repo_root.join(prefix);
        let Ok(entries) = fs::read_dir(&workspace_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let package_dir = entry.path();
            if !package_dir.is_dir() {
                continue;
            }
            let Ok(package_json) = fs::read_to_string(package_dir.join("package.json")) else {
                continue;
            };
            let Ok(package_meta) = serde_json::from_str::<serde_json::Value>(&package_json) else {
                continue;
            };
            let Some(name) = package_meta.get("name").and_then(|value| value.as_str()) else {
                continue;
            };
            let package_root = package_dir
                .strip_prefix(repo_root)
                .ok()
                .map(normalize_path)
                .unwrap_or_else(|| normalize_path(&package_dir));
            let export = package_meta
                .get("exports")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned);
            packages.insert(name.to_string(), WorkspacePackage {
                root: package_root,
                export,
            });
        }
    }
    packages
}

fn workspace_globs(value: &serde_json::Value) -> Option<Vec<String>> {
    if let Some(array) = value.as_array() {
        return Some(array.iter().filter_map(|entry| entry.as_str().map(ToOwned::to_owned)).collect());
    }
    value
        .get("packages")
        .and_then(|packages| packages.as_array())
        .map(|array| array.iter().filter_map(|entry| entry.as_str().map(ToOwned::to_owned)).collect())
}

fn alias_matches(pattern: &str, source: &str) -> bool {
    if let Some(star_index) = pattern.find('*') {
        let prefix = &pattern[..star_index];
        let suffix = &pattern[star_index + 1..];
        return source.starts_with(prefix) && source.ends_with(suffix);
    }
    source == pattern
}

fn alias_capture(pattern: &str, source: &str) -> String {
    let Some(star_index) = pattern.find('*') else {
        return String::new();
    };
    let prefix = &pattern[..star_index];
    let suffix = &pattern[star_index + 1..];
    let end = if suffix.is_empty() {
        source.len()
    } else {
        source.len().saturating_sub(suffix.len())
    };
    source[prefix.len()..end].to_string()
}

fn candidate_paths(base: &str) -> Vec<String> {
    vec![
        base.to_string(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.js"),
        format!("{base}.jsx"),
        format!("{base}/index.ts"),
        format!("{base}/index.tsx"),
        format!("{base}/index.js"),
        format!("{base}/index.jsx"),
    ]
}

fn join_repo_path(left: &str, right: &str) -> String {
    normalize_repo_string(&format!("{}/{}", left.trim_end_matches('/'), right.trim_start_matches('/')))
}

fn normalize_repo_string(value: &str) -> String {
    let mut parts = Vec::new();
    for component in Path::new(value).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            _ => {}
        }
    }
    parts.join("/")
}

fn hash_prefix(hash: &str) -> &str {
    &hash[..hash.len().min(12)]
}
