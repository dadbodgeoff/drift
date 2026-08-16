use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::Instant,
};

mod candidate_command;
mod check_command;
mod protocol;

use candidate_command::infer_candidates;
use check_command::check_repo;
use drift_engine::{
    Fact, FactKind, dynamic_middleware_matcher_line, extract_security_facts,
    extract_typescript_facts, should_index_path, static_middleware_coverage,
};
use protocol::*;
use serde_json::json;
use sha2::{Digest, Sha256};

type EngineResult<T> = Result<T, Box<dyn std::error::Error>>;
type ScannedFileFacts = (ScannedFile, Vec<EngineFact>);

#[derive(Default)]
struct ScanFilesResult {
    scanned: Vec<ScannedFileFacts>,
    files_reused: usize,
}

struct ReuseIndex {
    facts_by_file: BTreeMap<String, Vec<EngineFact>>,
    snapshots_by_file: BTreeMap<String, ScannedFile>,
}

#[derive(Default)]
struct FileDiscoveryResult {
    files: Vec<PathBuf>,
    diagnostics: Vec<EngineDiagnostic>,
}

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
                    let output = scan_repo(
                        &args.repo_root,
                        args.repo_id,
                        args.scan_id,
                        args.reuse_manifest.as_deref(),
                    )?;
                    println!("{}", serde_json::to_string_pretty(&output)?);
                    Ok(())
                }
                OutputFormat::Jsonl => stream_scan_repo(
                    &args.repo_root,
                    args.repo_id,
                    args.scan_id,
                    args.reuse_manifest.as_deref(),
                ),
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
        Some("infer-candidates") => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let request: CandidateRequest = serde_json::from_str(&input)?;
            let output = infer_candidates(request);
            println!("{}", serde_json::to_string(&output)?);
            Ok(())
        }
        _ => Err("usage: drift-engine scan-repo <repo-root> [--format json|jsonl] [--repo-id <id>] [--scan-id <id>] | check-repo | infer-candidates".into()),
    }
}

fn parse_scan_repo_args(args: Vec<String>) -> Result<ScanRepoArgs, Box<dyn std::error::Error>> {
    let repo_root = args.first().ok_or("missing repo root for scan-repo")?;
    let mut parsed = ScanRepoArgs {
        repo_root: PathBuf::from(repo_root),
        format: OutputFormat::Json,
        repo_id: "repo_unknown".to_string(),
        scan_id: "scan_unknown".to_string(),
        reuse_manifest: None,
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
            "--reuse-manifest" => {
                index += 1;
                parsed.reuse_manifest = Some(PathBuf::from(
                    args.get(index)
                        .ok_or("missing value for --reuse-manifest")?,
                ));
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
    reuse_manifest_path: Option<&Path>,
) -> Result<ScanRepoOutput, Box<dyn std::error::Error>> {
    let started = Instant::now();
    let ignore = IgnoreMatcher::from_repo(repo_root);
    let discovery = collect_indexable_files(repo_root, &ignore)?;
    let mut files = discovery.files;
    files.sort();
    let mut resolver = build_resolver_context(repo_root, &files);
    let reuse_index = load_reuse_index(reuse_manifest_path)?;

    let mut scanned_files = Vec::new();
    let mut facts = Vec::new();
    let mut diagnostics = discovery.diagnostics;
    let mut graph_node_count = 0_usize;
    let mut graph_edge_count = 0_usize;
    let scanned = scan_files(repo_root, &files, &mut diagnostics, reuse_index.as_ref())?;
    let files_reused = scanned.files_reused;
    let mut scanned = scanned;
    add_middleware_coverage_facts(&mut scanned.scanned);
    resolver.exported_symbols = exported_symbols_by_file(&scanned.scanned);
    for (file, file_facts) in scanned.scanned {
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
        scanned_files.len().saturating_sub(files_reused),
        facts.len(),
        diagnostics.len(),
        started.elapsed().as_millis(),
    );
    stats.files_reused = files_reused;
    stats.reuse_applied = files_reused > 0;
    stats.graph_nodes = graph_node_count;
    stats.graph_edges = graph_edge_count;
    stats.capabilities = capability_stats(&["file_discovery", "syntax_facts", "graph_stream"], &[]);
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
    reuse_manifest_path: Option<&Path>,
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

    let ignore = IgnoreMatcher::from_repo(repo_root);
    let discovery = collect_indexable_files(repo_root, &ignore)?;
    let mut files = discovery.files;
    files.sort();
    let mut resolver = build_resolver_context(repo_root, &files);
    let reuse_index = load_reuse_index(reuse_manifest_path)?;

    let mut files_parsed = 0_usize;
    let mut files_skipped = 0_usize;
    let mut facts_emitted = 0_usize;
    let mut graph_nodes_emitted = 0_usize;
    let mut graph_edges_emitted = 0_usize;
    let mut diagnostics_emitted = 0_usize;
    let mut scan_diagnostics = discovery.diagnostics;
    let mut scanned = scan_files(
        repo_root,
        &files,
        &mut scan_diagnostics,
        reuse_index.as_ref(),
    )?;
    add_middleware_coverage_facts(&mut scanned.scanned);
    files_skipped += scan_diagnostics.len();
    if !scan_diagnostics.is_empty() {
        diagnostics_emitted += scan_diagnostics.len();
        write_event(
            &mut stdout,
            &ScanStreamEvent::DiagnosticBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                diagnostics: scan_diagnostics,
            },
        )?;
    }
    resolver.exported_symbols = exported_symbols_by_file(&scanned.scanned);
    let files_reused = scanned.files_reused;
    for (file, facts) in scanned.scanned {
        if !reused_file(&file, reuse_index.as_ref()) {
            files_parsed += 1;
        }
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
    stats.files_reused = files_reused;
    stats.reuse_applied = files_reused > 0;
    stats.capabilities = capability_stats(&["file_discovery", "syntax_facts", "graph_stream"], &[]);
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

fn load_reuse_index(path: Option<&Path>) -> EngineResult<Option<ReuseIndex>> {
    let Some(path) = path else {
        return Ok(None);
    };
    let manifest_text = fs::read_to_string(path)?;
    let manifest: ScanReuseManifest = serde_json::from_str(&manifest_text)?;
    if manifest.schema_version != "engine.reuse_manifest.v1" {
        return Err(format!(
            "unsupported reuse manifest schema: {}",
            manifest.schema_version
        )
        .into());
    }
    if manifest.previous_scan_id.trim().is_empty() {
        return Err("reuse manifest previous_scan_id is required".into());
    }

    let mut facts_by_file = BTreeMap::<String, Vec<EngineFact>>::new();
    for fact in manifest.facts {
        facts_by_file
            .entry(fact.file_path.clone())
            .or_default()
            .push(fact);
    }
    let snapshots_by_file = manifest
        .file_snapshots
        .into_iter()
        .filter(|snapshot| snapshot.indexed)
        .map(|snapshot| (snapshot.file_path.clone(), snapshot))
        .collect();
    Ok(Some(ReuseIndex {
        facts_by_file,
        snapshots_by_file,
    }))
}

fn scan_file_with_reuse(
    repo_root: &Path,
    file_path: &Path,
    diagnostics: &mut Vec<EngineDiagnostic>,
    reuse: Option<&ReuseIndex>,
) -> EngineResult<Option<(ScannedFile, Vec<EngineFact>, bool)>> {
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
    let normalized = normalize_path(file_path);
    let file = ScannedFile {
        file_path: normalized.clone(),
        content_hash: hash_file(&absolute_path)?,
        byte_size: metadata.len(),
        indexed: true,
    };
    if let Some(reused_facts) = reusable_facts_for_file(&file, reuse) {
        return Ok(Some((file, reused_facts, true)));
    }
    let source = fs::read_to_string(&absolute_path)?;
    if is_middleware_path(&normalized) && dynamic_middleware_matcher_line(&source).is_some() {
        diagnostics.push(EngineDiagnostic {
            severity: "warning".to_string(),
            code: "unsupported_dynamic_middleware_matcher".to_string(),
            message: "unsupported_dynamic_middleware_matcher".to_string(),
            file_path: Some(normalized.clone()),
        });
    }
    let mut facts = extract_typescript_facts(file_path, &source)?;
    facts.extend(extract_security_facts(file_path, &source, &[])?);
    let facts = facts.into_iter().map(engine_fact).collect();
    Ok(Some((file, facts, false)))
}

fn scan_files(
    repo_root: &Path,
    files: &[PathBuf],
    diagnostics: &mut Vec<EngineDiagnostic>,
    reuse: Option<&ReuseIndex>,
) -> EngineResult<ScanFilesResult> {
    let mut result = ScanFilesResult::default();
    for file_path in files {
        if let Some((file, facts, reused)) =
            scan_file_with_reuse(repo_root, file_path, diagnostics, reuse)?
        {
            if reused {
                result.files_reused += 1;
            }
            result.scanned.push((file, facts));
        }
    }
    Ok(result)
}

fn reusable_facts_for_file(
    file: &ScannedFile,
    reuse: Option<&ReuseIndex>,
) -> Option<Vec<EngineFact>> {
    let reuse = reuse?;
    let previous = reuse.snapshots_by_file.get(&file.file_path)?;
    if previous.content_hash != file.content_hash || previous.byte_size != file.byte_size {
        return None;
    }
    Some(
        reuse
            .facts_by_file
            .get(&file.file_path)
            .cloned()
            .unwrap_or_default(),
    )
}

fn add_middleware_coverage_facts(scanned: &mut [(ScannedFile, Vec<EngineFact>)]) {
    let middleware_fact_sets = scanned
        .iter()
        .filter_map(|(_, facts)| {
            if !facts.iter().any(|fact| fact.kind == "middleware_declared") {
                return None;
            }
            Some(
                facts
                    .iter()
                    .filter_map(middleware_fact_from_engine)
                    .collect::<Vec<_>>(),
            )
        })
        .filter(|facts| !facts.is_empty())
        .collect::<Vec<_>>();
    if middleware_fact_sets.is_empty() {
        return;
    }

    for (_, route_facts) in scanned.iter_mut() {
        if !route_facts
            .iter()
            .any(|fact| fact.kind == "file_role_detected" && fact.name == "api_route")
        {
            continue;
        }
        let route_file_path = route_facts
            .iter()
            .find(|fact| fact.kind == "route_declared")
            .map(|fact| fact.file_path.clone())
            .unwrap_or_else(|| {
                route_facts
                    .first()
                    .map(|fact| fact.file_path.clone())
                    .unwrap_or_default()
            });
        let route_method = route_facts
            .iter()
            .find(|fact| fact.kind == "route_declared")
            .map(|fact| fact.name.as_str())
            .unwrap_or("GET");
        let route_line = route_facts
            .iter()
            .find(|fact| fact.kind == "route_declared")
            .map(|fact| fact.start_line)
            .unwrap_or(1);
        let route_id = format!("route:{route_file_path}:{route_method}");
        let mut new_facts = Vec::new();
        for middleware_facts in &middleware_fact_sets {
            let (matched, _) =
                static_middleware_coverage(middleware_facts, &route_file_path, route_method);
            for middleware in matched {
                let protection_kind = middleware.protection_kind.clone();
                new_facts.push(EngineFact {
                    kind: "middleware_protects_route".to_string(),
                    file_path: route_file_path.clone(),
                    name: middleware.middleware_id.clone(),
                    value: Some(
                        json!({
                            "route_id": route_id,
                            "middleware_id": middleware.middleware_id,
                            "protection_kind": protection_kind,
                        })
                        .to_string(),
                    ),
                    imported_name: Some(protection_kind),
                    start_line: route_line,
                    end_line: route_line,
                });
            }
        }
        route_facts.extend(new_facts);
    }
}

fn middleware_fact_from_engine(fact: &EngineFact) -> Option<Fact> {
    let kind = match fact.kind.as_str() {
        "middleware_declared" => FactKind::MiddlewareDeclared,
        "middleware_matcher_declared" => FactKind::MiddlewareMatcherDeclared,
        _ => return None,
    };
    Some(Fact {
        kind,
        file_path: fact.file_path.clone(),
        name: fact.name.clone(),
        value: fact.value.clone(),
        imported_name: fact.imported_name.clone(),
        start_line: fact.start_line,
        end_line: fact.end_line,
    })
}

fn is_middleware_path(path: &str) -> bool {
    path == "middleware.ts"
        || path == "middleware.js"
        || path.ends_with("/middleware.ts")
        || path.ends_with("/middleware.js")
}

fn reused_file(file: &ScannedFile, reuse: Option<&ReuseIndex>) -> bool {
    reusable_facts_for_file(file, reuse).is_some()
}

fn collect_indexable_files(
    repo_root: &Path,
    ignore: &IgnoreMatcher,
) -> io::Result<FileDiscoveryResult> {
    let mut result = FileDiscoveryResult::default();
    collect_indexable_files_in_dir(repo_root, repo_root, &mut result, ignore)?;
    Ok(result)
}

fn collect_indexable_files_in_dir(
    repo_root: &Path,
    dir: &Path,
    result: &mut FileDiscoveryResult,
    ignore: &IgnoreMatcher,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let relative = path.strip_prefix(repo_root).unwrap_or(&path);
        if ignore.is_ignored(relative) {
            continue;
        }
        if !should_index_path(relative) {
            continue;
        }
        if file_type.is_symlink() {
            if let Err(error) = fs::metadata(&path) {
                let code = if error.kind() == io::ErrorKind::NotFound {
                    "broken_symlink"
                } else {
                    "symlink_target_unreadable"
                };
                result.diagnostics.push(EngineDiagnostic {
                    severity: "warning".to_string(),
                    code: code.to_string(),
                    message: format!(
                        "Skipped symlink {} because its target could not be read: {}",
                        normalize_path(relative),
                        error
                    ),
                    file_path: Some(normalize_path(relative)),
                });
            }
            continue;
        }

        if file_type.is_dir() {
            collect_indexable_files_in_dir(repo_root, &path, result, ignore)?;
        } else if file_type.is_file() && is_typescript_path(&path) {
            result.files.push(relative.to_path_buf());
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
        self.patterns
            .iter()
            .any(|pattern| gitignore_pattern_matches(pattern, &path, file_name))
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
    if pattern.contains('*') {
        if let Some(rest) = pattern.strip_prefix("**/") {
            return wildcard_matches(rest, file_name)
                || wildcard_matches(rest, path)
                || wildcard_matches(pattern, path);
        }
        if pattern.contains('/') {
            return wildcard_matches(pattern, path);
        }
        return path
            .split('/')
            .any(|component| wildcard_matches(pattern, component));
    }
    if pattern.contains('/') {
        return path == pattern || path.starts_with(&format!("{pattern}/"));
    }
    path.split('/').any(|component| component == pattern)
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;

    for pattern_byte in pattern {
        let mut current = vec![false; value.len() + 1];
        if *pattern_byte == b'*' {
            current[0] = previous[0];
            for index in 1..=value.len() {
                current[index] = previous[index] || current[index - 1];
            }
        } else {
            for index in 0..value.len() {
                current[index + 1] = previous[index] && *pattern_byte == value[index];
            }
        }
        previous = current;
    }

    previous[value.len()]
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

fn stable_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn engine_fact(fact: Fact) -> EngineFact {
    EngineFact {
        kind: fact_kind(fact.kind).to_string(),
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        imported_name: fact.imported_name,
        start_line: fact.start_line,
        end_line: fact.end_line,
    }
}

fn fact_kind(kind: FactKind) -> &'static str {
    match kind {
        FactKind::FileDetected => "file_detected",
        FactKind::ImportUsed => "import_used",
        FactKind::ReExportUsed => "re_export_used",
        FactKind::ExportedSymbol => "exported_symbol",
        FactKind::SymbolCalled => "symbol_called",
        FactKind::DataOperationDetected => "data_operation_detected",
        FactKind::RouteDeclared => "route_declared",
        FactKind::FileRoleDetected => "file_role_detected",
        FactKind::TestDeclared => "test_declared",
        FactKind::AuthGuardCalled => "auth_guard_called",
        FactKind::RouteReturnsResponse => "route_returns_response",
        FactKind::CallbackBoundaryDetected => "callback_boundary_detected",
        FactKind::MiddlewareDeclared => "middleware_declared",
        FactKind::MiddlewareMatcherDeclared => "middleware_matcher_declared",
        FactKind::MiddlewareProtectsRoute => "middleware_protects_route",
        FactKind::RequestInputRead => "request_input_read",
        FactKind::SessionRead => "session_read",
        FactKind::TenantSource => "tenant_source",
        FactKind::TenantGuardCalled => "tenant_guard_called",
        FactKind::AuthorizationGuardCalled => "authorization_guard_called",
        FactKind::RequestValidationCalled => "request_validation_called",
        FactKind::ValidatedInputUsed => "validated_input_used",
        FactKind::OutboundRequestCalled => "outbound_request_called",
        FactKind::RawSqlCalled => "raw_sql_called",
        FactKind::ParameterizedSqlUsed => "parameterized_sql_used",
        FactKind::CsrfGuardCalled => "csrf_guard_called",
        FactKind::RateLimitGuardCalled => "rate_limit_guard_called",
        FactKind::CorsPolicyDeclared => "cors_policy_declared",
        FactKind::SensitiveFieldDeclared => "sensitive_field_declared",
        FactKind::ResponseEmitsField => "response_emits_field",
        FactKind::SerializerCalled => "serializer_called",
        FactKind::SecretRead => "secret_read",
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
    package_imports: Vec<PathAlias>,
    base_urls: Vec<String>,
    packages: BTreeMap<String, WorkspacePackage>,
    exported_symbols: BTreeMap<String, BTreeSet<String>>,
}

struct PathAlias {
    pattern: String,
    targets: Vec<String>,
}

struct WorkspacePackage {
    root: String,
    exports: BTreeMap<String, String>,
}

#[derive(Default)]
struct JsTsResolutionConfig {
    aliases: BTreeMap<String, Vec<String>>,
    base_url: Option<String>,
    effective_base_url: String,
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
    let file_is_api_route = facts.iter().any(|fact| {
        fact.kind == "file_role_detected"
            && fact.file_path == file.file_path
            && fact.name == "api_route"
    });
    let import_nodes_by_local_name = facts
        .iter()
        .filter(|fact| fact.kind == "import_used")
        .filter_map(|fact| {
            let source = fact.value.as_ref()?;
            Some((
                fact.name.clone(),
                import_decl_id(
                    &fact.file_path,
                    &file.content_hash,
                    source,
                    &fact.name,
                    fact.start_line,
                    fact.end_line,
                ),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let data_access_import_roots = facts
        .iter()
        .filter(|fact| fact.kind == "import_used")
        .filter_map(|fact| {
            let source = fact.value.as_ref()?;
            let resolved = resolve_import(&fact.file_path, source, resolver);
            if is_data_access_reference(source)
                || resolved.as_deref().is_some_and(is_data_access_reference)
            {
                Some(fact.name.as_str())
            } else {
                None
            }
        })
        .collect::<std::collections::BTreeSet<_>>();

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
    insert_edge(
        &mut edges,
        "FILE_HAS_VERSION",
        &file_node,
        &file_version_node,
        Vec::new(),
        BTreeMap::new(),
    );
    insert_edge(
        &mut edges,
        "FILE_DEFINES_MODULE",
        &file_node,
        &module_node,
        Vec::new(),
        BTreeMap::new(),
    );

    for fact in facts {
        let evidence_id = evidence_id(
            "typescript",
            &fact.file_path,
            &file.content_hash,
            fact.start_line,
            fact.end_line,
        );
        evidence.insert(
            evidence_id.clone(),
            GraphEvidence {
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
                confidence_kind: "deterministic".to_string(),
                extractor: "rust_typescript_graph".to_string(),
                snippet_hash: stable_hash(&format!(
                    "{}:{}:{}",
                    file.content_hash, fact.start_line, fact.end_line
                )),
                redaction_state: "none".to_string(),
            },
        );

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
                insert_edge(
                    &mut edges,
                    "FILE_HAS_ROLE",
                    &file_node,
                    &role_node,
                    vec![evidence_id],
                    BTreeMap::new(),
                );
            }
            "import_used" => {
                let Some(source) = &fact.value else {
                    continue;
                };
                let import_node = import_decl_id(
                    &fact.file_path,
                    &file.content_hash,
                    source,
                    &fact.name,
                    fact.start_line,
                    fact.end_line,
                );
                let resolved = resolve_import(&fact.file_path, source, resolver);
                let should_report_unresolved =
                    resolved.is_none() && should_report_unresolved_import(source, resolver);
                let resolution_status = if resolved.is_some() {
                    "resolved"
                } else if should_report_unresolved {
                    "unresolved"
                } else {
                    "external"
                };
                let resolved_module = resolved.as_ref().map(|path| module_id(path));
                let imported_name = fact.imported_name.as_deref().unwrap_or(&fact.name);
                let mut import_metadata = BTreeMap::from([
                    ("source".to_string(), json!(source)),
                    ("local_name".to_string(), json!(fact.name)),
                    ("imported_name".to_string(), json!(imported_name)),
                    ("file_path".to_string(), json!(fact.file_path)),
                    ("import_kind".to_string(), json!("value")),
                    ("resolution_status".to_string(), json!(resolution_status)),
                ]);
                if let Some(resolved) = &resolved {
                    import_metadata.insert("resolved_file_path".to_string(), json!(resolved));
                }
                if let Some(resolved_module) = &resolved_module {
                    import_metadata
                        .insert("resolved_module_id".to_string(), json!(resolved_module));
                }
                insert_node(
                    &mut nodes,
                    import_node.clone(),
                    "import_decl",
                    &format!("{} from {}", fact.name, source),
                    false,
                    vec![evidence_id.clone()],
                    import_metadata,
                );
                insert_edge(
                    &mut edges,
                    "IMPORT_DECL_REFERENCES_MODULE",
                    &import_node,
                    &module_node,
                    vec![evidence_id.clone()],
                    BTreeMap::new(),
                );
                if let (Some(resolved), Some(resolved_module)) = (&resolved, &resolved_module) {
                    insert_edge(
                        &mut edges,
                        "IMPORT_RESOLVES_TO_MODULE",
                        &import_node,
                        resolved_module,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("resolution_status".to_string(), json!("resolved")),
                            ("resolved_file_path".to_string(), json!(resolved)),
                            ("resolved_module_id".to_string(), json!(resolved_module)),
                        ]),
                    );
                    if let Some(symbol_name) =
                        resolved_import_symbol_name(imported_name, resolved, resolver)
                    {
                        let resolved_symbol = symbol_id(resolved, "function", &symbol_name);
                        insert_edge(
                            &mut edges,
                            "IMPORT_RESOLVES_TO_SYMBOL",
                            &import_node,
                            &resolved_symbol,
                            vec![evidence_id.clone()],
                            BTreeMap::from([
                                ("resolution_status".to_string(), json!("resolved")),
                                ("imported_name".to_string(), json!(symbol_name)),
                                ("local_name".to_string(), json!(fact.name)),
                                ("resolved_file_path".to_string(), json!(resolved)),
                                ("resolved_module_id".to_string(), json!(resolved_module)),
                            ]),
                        );
                    } else if is_symbol_resolvable_import(imported_name)
                        && resolver.exported_symbols.contains_key(resolved)
                    {
                        diagnostics.push(EngineDiagnostic {
                            severity: "warning".to_string(),
                            code: "unresolved_import_symbol".to_string(),
                            message: format!(
                                "Could not resolve imported symbol {imported_name} from {source} in {resolved}."
                            ),
                            file_path: Some(fact.file_path.clone()),
                        });
                    } else if imported_name == "*" {
                        diagnostics.push(EngineDiagnostic {
                            severity: "warning".to_string(),
                            code: "unsupported_namespace_import_symbol".to_string(),
                            message: format!(
                                "Namespace import {source} in {} resolved to {resolved}, but member-level symbol resolution is conservative.",
                                fact.file_path
                            ),
                            file_path: Some(fact.file_path.clone()),
                        });
                    }
                    insert_edge(
                        &mut edges,
                        "MODULE_IMPORTS_MODULE",
                        &module_node,
                        resolved_module,
                        vec![evidence_id.clone()],
                        BTreeMap::new(),
                    );
                    if file_is_api_route
                        && !is_data_access_reference(resolved)
                        && resolved_import_symbol_name(imported_name, resolved, resolver).is_some()
                    {
                        let target_file_node = file_id(resolved);
                        let service_role_node = "file_role:service_module".to_string();
                        insert_node(
                            &mut nodes,
                            target_file_node.clone(),
                            "file",
                            resolved,
                            true,
                            Vec::new(),
                            BTreeMap::from([("path".to_string(), json!(resolved))]),
                        );
                        insert_node(
                            &mut nodes,
                            service_role_node.clone(),
                            "file_role",
                            "service_module",
                            true,
                            vec![evidence_id.clone()],
                            BTreeMap::from([("role".to_string(), json!("service_module"))]),
                        );
                        insert_edge(
                            &mut edges,
                            "FILE_HAS_ROLE",
                            &target_file_node,
                            &service_role_node,
                            vec![evidence_id],
                            BTreeMap::from([
                                ("inferred_from".to_string(), json!("route_import_target")),
                                ("route_file_path".to_string(), json!(fact.file_path)),
                                ("resolved_module_id".to_string(), json!(resolved_module)),
                            ]),
                        );
                    } else if file_is_api_route
                        && !is_data_access_reference(resolved)
                        && resolved_import_symbol_name(imported_name, resolved, resolver).is_none()
                    {
                        diagnostics.push(EngineDiagnostic {
                            severity: "warning".to_string(),
                            code: "ambiguous_route_dependency_service_boundary".to_string(),
                            message: format!(
                                "Could not infer service boundary for route import {source} because {resolved} has no supported exported symbols."
                            ),
                            file_path: Some(fact.file_path.clone()),
                        });
                    }
                } else if should_report_unresolved {
                    diagnostics.push(EngineDiagnostic {
                        severity: "warning".to_string(),
                        code: "unresolved_import".to_string(),
                        message: format!(
                            "Could not resolve import {source} from {}.",
                            fact.file_path
                        ),
                        file_path: Some(fact.file_path.clone()),
                    });
                }
            }
            "re_export_used" => {
                let Some(source) = fact.value.as_deref() else {
                    continue;
                };
                let reexport_node = reexport_id(
                    &fact.file_path,
                    &file.content_hash,
                    source,
                    &fact.name,
                    fact.start_line,
                    fact.end_line,
                );
                insert_node(
                    &mut nodes,
                    reexport_node.clone(),
                    "re_export",
                    &fact.name,
                    false,
                    vec![evidence_id.clone()],
                    BTreeMap::from([
                        ("file_path".to_string(), json!(fact.file_path)),
                        ("source".to_string(), json!(source)),
                        ("exported_name".to_string(), json!(fact.name)),
                    ]),
                );
                if let Some(resolved) = resolve_import(&fact.file_path, source, resolver) {
                    let resolved_module = module_id(&resolved);
                    insert_edge(
                        &mut edges,
                        "MODULE_REEXPORTS_MODULE",
                        &module_node,
                        &resolved_module,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("source".to_string(), json!(source)),
                            ("exported_name".to_string(), json!(fact.name)),
                            ("resolved_file_path".to_string(), json!(resolved)),
                            ("resolved_module_id".to_string(), json!(resolved_module)),
                        ]),
                    );
                    if resolver
                        .exported_symbols
                        .get(&resolved)
                        .is_some_and(|symbols| symbols.contains(&fact.name))
                    {
                        insert_edge(
                            &mut edges,
                            "REEXPORT_RESOLVES_TO_SYMBOL",
                            &reexport_node,
                            &symbol_id(&resolved, "function", &fact.name),
                            vec![evidence_id],
                            BTreeMap::from([
                                ("source".to_string(), json!(source)),
                                ("exported_name".to_string(), json!(fact.name)),
                                ("resolved_file_path".to_string(), json!(resolved)),
                                ("resolved_module_id".to_string(), json!(resolved_module)),
                            ]),
                        );
                    }
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
                insert_edge(
                    &mut edges,
                    "FILE_CONTAINS_SYMBOL",
                    &file_node,
                    &symbol_node,
                    vec![evidence_id.clone()],
                    BTreeMap::new(),
                );
                insert_edge(
                    &mut edges,
                    "MODULE_EXPORTS_SYMBOL",
                    &module_node,
                    &symbol_node,
                    vec![evidence_id],
                    BTreeMap::new(),
                );
            }
            "route_declared" => {
                let route_node = format!("route:{}:{}", fact.name, fact.file_path);
                let endpoint = endpoint_shape(&fact.file_path, &fact.name);
                insert_node(
                    &mut nodes,
                    route_node.clone(),
                    "route",
                    &fact.name,
                    true,
                    vec![evidence_id.clone()],
                    endpoint_metadata(
                        ("method".to_string(), json!(fact.name)),
                        ("file_path".to_string(), json!(fact.file_path)),
                        endpoint.as_ref(),
                    ),
                );
                insert_edge(
                    &mut edges,
                    "ROUTE_DECLARED_IN_FILE",
                    &route_node,
                    &file_node,
                    vec![evidence_id.clone()],
                    BTreeMap::new(),
                );
                if let Some(endpoint) = endpoint {
                    let endpoint_node = endpoint_id(&fact.file_path, &fact.name, &endpoint.pattern);
                    insert_node(
                        &mut nodes,
                        endpoint_node.clone(),
                        "endpoint",
                        &endpoint.pattern,
                        true,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("method".to_string(), json!(fact.name)),
                            ("file_path".to_string(), json!(fact.file_path)),
                            ("route_pattern".to_string(), json!(endpoint.pattern)),
                            ("framework_role".to_string(), json!(endpoint.framework_role)),
                            ("dynamic_params".to_string(), json!(endpoint.dynamic_params)),
                        ]),
                    );
                    insert_edge(
                        &mut edges,
                        "ROUTE_HAS_ENDPOINT",
                        &route_node,
                        &endpoint_node,
                        vec![evidence_id.clone()],
                        BTreeMap::new(),
                    );
                }
                insert_edge(
                    &mut edges,
                    "ROUTE_HANDLED_BY_SYMBOL",
                    &route_node,
                    &symbol_id(
                        &fact.file_path,
                        "function",
                        fact.value.as_deref().unwrap_or(&fact.name),
                    ),
                    vec![evidence_id],
                    BTreeMap::new(),
                );
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
                    optional_receiver_metadata(
                        BTreeMap::from([
                            ("file_path".to_string(), json!(fact.file_path)),
                            ("callee_name".to_string(), json!(fact.name)),
                        ]),
                        fact.value.as_deref(),
                    ),
                );
                insert_edge(
                    &mut edges,
                    "CALLSITE_REFERENCES_SYMBOL",
                    &callsite_node,
                    &module_node,
                    vec![evidence_id.clone()],
                    BTreeMap::from([
                        ("confidence".to_string(), json!("name-only")),
                        ("callee_name".to_string(), json!(fact.name)),
                    ]),
                );
                if let Some(receiver) = fact.value.as_deref() {
                    if let Some(import_node) =
                        import_nodes_by_local_name.get(receiver_root(receiver))
                    {
                        insert_edge(
                            &mut edges,
                            "CALLSITE_REFERENCES_SYMBOL",
                            &callsite_node,
                            import_node,
                            vec![evidence_id.clone()],
                            BTreeMap::from([
                                ("confidence".to_string(), json!("import-alias")),
                                ("callee_name".to_string(), json!(fact.name)),
                                ("receiver_name".to_string(), json!(receiver)),
                                ("local_name".to_string(), json!(receiver_root(receiver))),
                            ]),
                        );
                    }
                } else if let Some(import_node) = import_nodes_by_local_name.get(fact.name.as_str())
                {
                    insert_edge(
                        &mut edges,
                        "CALLSITE_REFERENCES_SYMBOL",
                        &callsite_node,
                        import_node,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("confidence".to_string(), json!("import-alias")),
                            ("callee_name".to_string(), json!(fact.name)),
                            ("local_name".to_string(), json!(fact.name)),
                        ]),
                    );
                }
            }
            "data_operation_detected" => {
                let Some(receiver) = fact.value.as_deref() else {
                    continue;
                };
                if !data_access_import_roots.contains(receiver_root(receiver)) {
                    continue;
                }
                if let Some((store_name, operation_kind)) =
                    data_operation_parts(receiver, fact.imported_name.as_deref())
                {
                    let data_store_node = data_store_id(receiver_root(receiver), store_name);
                    let data_operation_node = data_operation_id(
                        &fact.file_path,
                        &file.content_hash,
                        receiver,
                        &fact.name,
                        fact.start_line,
                        fact.end_line,
                    );
                    insert_node(
                        &mut nodes,
                        data_store_node.clone(),
                        "data_store",
                        store_name,
                        true,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("receiver_root".to_string(), json!(receiver_root(receiver))),
                            ("store_name".to_string(), json!(store_name)),
                            ("file_path".to_string(), json!(fact.file_path)),
                        ]),
                    );
                    insert_node(
                        &mut nodes,
                        data_operation_node.clone(),
                        "data_operation",
                        &fact.name,
                        false,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("file_path".to_string(), json!(fact.file_path)),
                            ("receiver_name".to_string(), json!(receiver)),
                            ("receiver_root".to_string(), json!(receiver_root(receiver))),
                            ("store_name".to_string(), json!(store_name)),
                            ("operation_name".to_string(), json!(fact.name)),
                            ("operation_kind".to_string(), json!(operation_kind)),
                        ]),
                    );
                    let edge_kind = match operation_kind {
                        "read" => "DATA_OPERATION_READS_DATA_STORE",
                        "delete" => "DATA_OPERATION_DELETES_DATA_STORE",
                        "unknown" => "DATA_OPERATION_TOUCHES_DATA_STORE",
                        _ => "DATA_OPERATION_WRITES_DATA_STORE",
                    };
                    insert_edge(
                        &mut edges,
                        edge_kind,
                        &data_operation_node,
                        &data_store_node,
                        vec![evidence_id],
                        BTreeMap::from([
                            ("operation_kind".to_string(), json!(operation_kind)),
                            ("operation_name".to_string(), json!(fact.name)),
                        ]),
                    );
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
    nodes.insert(
        id.clone(),
        GraphNode {
            id,
            kind: kind.to_string(),
            label: label.to_string(),
            stable,
            evidence_ids,
            metadata,
        },
    );
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
    edges.insert(
        id.clone(),
        GraphEdge {
            id,
            kind: kind.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            evidence_ids,
            metadata,
        },
    );
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

struct EndpointShape {
    pattern: String,
    framework_role: &'static str,
    dynamic_params: Vec<String>,
}

fn endpoint_metadata(
    method: (String, serde_json::Value),
    file_path: (String, serde_json::Value),
    endpoint: Option<&EndpointShape>,
) -> BTreeMap<String, serde_json::Value> {
    let mut metadata = BTreeMap::from([method, file_path]);
    if let Some(endpoint) = endpoint {
        metadata.insert("route_pattern".to_string(), json!(endpoint.pattern));
        metadata.insert("framework_role".to_string(), json!(endpoint.framework_role));
        metadata.insert("dynamic_params".to_string(), json!(endpoint.dynamic_params));
    }
    metadata
}

fn receiver_root(receiver: &str) -> &str {
    receiver.split('.').next().unwrap_or(receiver)
}

fn endpoint_shape(file_path: &str, method: &str) -> Option<EndpointShape> {
    let normalized = file_path.replace('\\', "/");
    if is_next_app_route_path(&normalized) {
        let route_path = strip_before_segment(&normalized, "app/api/")?
            .strip_suffix("/route.ts")
            .or_else(|| strip_before_segment(&normalized, "app/api/")?.strip_suffix("/route.tsx"))
            .or_else(|| strip_before_segment(&normalized, "app/api/")?.strip_suffix("/route.js"))
            .or_else(|| {
                strip_before_segment(&normalized, "app/api/")?.strip_suffix("/route.jsx")
            })?;
        let (pattern, dynamic_params) = route_pattern_from_segments(route_path);
        return Some(EndpointShape {
            pattern,
            framework_role: "next_app_route",
            dynamic_params,
        });
    }
    if let Some(route_path) = strip_pages_api_route(&normalized) {
        let (pattern, dynamic_params) = route_pattern_from_segments(route_path);
        return Some(EndpointShape {
            pattern,
            framework_role: "next_pages_api",
            dynamic_params,
        });
    }
    if method.is_empty() {
        return None;
    }
    None
}

fn is_next_app_route_path(file_path: &str) -> bool {
    file_path.ends_with("/route.ts")
        || file_path.ends_with("/route.tsx")
        || file_path.ends_with("/route.js")
        || file_path.ends_with("/route.jsx")
}

fn strip_before_segment<'a>(file_path: &'a str, segment: &str) -> Option<&'a str> {
    let index = file_path.find(segment)?;
    Some(&file_path[index + "app/".len()..])
}

fn strip_pages_api_route(file_path: &str) -> Option<&str> {
    let index = file_path.find("pages/api/")?;
    let route = &file_path[index + "pages/".len()..];
    route
        .strip_suffix(".ts")
        .or_else(|| route.strip_suffix(".tsx"))
        .or_else(|| route.strip_suffix(".js"))
        .or_else(|| route.strip_suffix(".jsx"))
}

fn route_pattern_from_segments(route_path: &str) -> (String, Vec<String>) {
    let mut dynamic_params = Vec::new();
    let segments = route_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if let Some(param) = segment
                .strip_prefix("[[...")
                .and_then(|value| value.strip_suffix("]]"))
            {
                dynamic_params.push(param.to_string());
                format!(":{param}*")
            } else if let Some(param) = segment
                .strip_prefix("[...")
                .and_then(|value| value.strip_suffix(']'))
            {
                dynamic_params.push(param.to_string());
                format!(":{param}*")
            } else if let Some(param) = segment
                .strip_prefix('[')
                .and_then(|value| value.strip_suffix(']'))
            {
                dynamic_params.push(param.to_string());
                format!(":{param}")
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>();
    (format!("/{}", segments.join("/")), dynamic_params)
}

fn data_operation_parts<'a>(
    receiver: &'a str,
    metadata: Option<&str>,
) -> Option<(&'a str, &'static str)> {
    let mut parts = receiver.split('.');
    let _root = parts.next()?;
    let store_name = parts.next()?;
    if store_name.is_empty() {
        return None;
    }
    let operation_kind = metadata
        .and_then(|value| value.split_once(':'))
        .and_then(|(kind, metadata_store)| (metadata_store == store_name).then_some(kind))
        .and_then(|kind| match kind {
            "read" => Some("read"),
            "write" => Some("write"),
            "delete" => Some("delete"),
            "unknown" => Some("unknown"),
            _ => None,
        })?;
    Some((store_name, operation_kind))
}

fn is_data_access_reference(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("prisma")
        || lower.contains("database")
        || lower.contains("/db")
        || lower.ends_with("db")
        || lower.contains("data-access")
        || lower.contains("/repositories/")
        || lower.contains("/repository/")
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

fn reexport_id(
    file_path: &str,
    content_hash: &str,
    source: &str,
    exported_name: &str,
    start_line: usize,
    end_line: usize,
) -> String {
    format!(
        "re_export:{file_path}:{}:{source}:{exported_name}:{start_line}-{end_line}",
        hash_prefix(content_hash)
    )
}

fn data_store_id(receiver_root: &str, store_name: &str) -> String {
    format!("data_store:{receiver_root}:{store_name}")
}

fn endpoint_id(file_path: &str, method: &str, route_pattern: &str) -> String {
    format!("endpoint:{method}:{file_path}:{route_pattern}")
}

fn data_operation_id(
    file_path: &str,
    content_hash: &str,
    receiver: &str,
    operation_name: &str,
    start_line: usize,
    end_line: usize,
) -> String {
    format!(
        "data_operation:{file_path}:{}:{receiver}:{operation_name}:{start_line}-{end_line}",
        hash_prefix(content_hash)
    )
}

fn evidence_id(
    adapter_id: &str,
    file_path: &str,
    content_hash: &str,
    start_line: usize,
    end_line: usize,
) -> String {
    format!(
        "evidence:{adapter_id}:{file_path}:{}:{start_line}-{end_line}",
        hash_prefix(content_hash)
    )
}

fn fact_id(fact: &EngineFact) -> String {
    format!(
        "fact:{}:{}:{}:{}-{}",
        fact.kind, fact.file_path, fact.name, fact.start_line, fact.end_line
    )
}

fn build_resolver_context(repo_root: &Path, files: &[PathBuf]) -> ResolverContext {
    let (path_aliases, base_urls) = read_js_ts_config_resolution(repo_root);
    ResolverContext {
        snapshot_paths: files.iter().map(|file| normalize_path(file)).collect(),
        path_aliases,
        package_imports: read_package_imports(repo_root),
        base_urls,
        packages: read_workspace_packages(repo_root),
        exported_symbols: BTreeMap::new(),
    }
}

fn exported_symbols_by_file(
    scanned: &[(ScannedFile, Vec<EngineFact>)],
) -> BTreeMap<String, BTreeSet<String>> {
    let mut exported = BTreeMap::<String, BTreeSet<String>>::new();
    for (file, facts) in scanned {
        for fact in facts {
            if fact.kind != "exported_symbol" {
                continue;
            }
            exported
                .entry(file.file_path.clone())
                .or_default()
                .insert(fact.name.clone());
        }
    }
    exported
}

fn resolved_import_symbol_name(
    imported_name: &str,
    resolved_file_path: &str,
    resolver: &ResolverContext,
) -> Option<String> {
    if imported_name == "*" {
        return None;
    }
    let exports = resolver.exported_symbols.get(resolved_file_path)?;
    exports
        .contains(imported_name)
        .then(|| imported_name.to_string())
}

fn is_symbol_resolvable_import(imported_name: &str) -> bool {
    imported_name != "*"
}

fn resolve_import(from_file: &str, source: &str, resolver: &ResolverContext) -> Option<String> {
    import_bases(from_file, source, resolver)
        .into_iter()
        .flat_map(|base| candidate_paths(&base))
        .find(|candidate| resolver.snapshot_paths.contains(candidate))
}

fn should_report_unresolved_import(source: &str, resolver: &ResolverContext) -> bool {
    source.starts_with('.')
        || resolver
            .path_aliases
            .iter()
            .any(|alias| alias_matches(&alias.pattern, source))
        || resolver
            .packages
            .keys()
            .any(|name| source == name || source.starts_with(&format!("{name}/")))
        || resolver
            .package_imports
            .iter()
            .any(|package_import| alias_matches(&package_import.pattern, source))
        || base_url_import_may_be_local(source, resolver)
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

    for package_import in &resolver.package_imports {
        if !alias_matches(&package_import.pattern, source) {
            continue;
        }
        let captured = alias_capture(&package_import.pattern, source);
        for target in &package_import.targets {
            bases.push(target.replace('*', &captured).replace('\\', "/"));
        }
    }

    for (name, package) in &resolver.packages {
        if source == name {
            if let Some(export) = package.exports.get(".") {
                bases.push(join_repo_path(
                    &package.root,
                    export.trim_start_matches("./"),
                ));
            }
            bases.push(join_repo_path(&package.root, "src/index"));
            bases.push(join_repo_path(&package.root, "index"));
        } else if let Some(rest) = source.strip_prefix(&format!("{name}/")) {
            let export_key = format!("./{rest}");
            if let Some(export) = package.exports.get(&export_key) {
                bases.push(join_repo_path(
                    &package.root,
                    export.trim_start_matches("./"),
                ));
            }
            bases.push(join_repo_path(&package.root, rest));
            bases.push(join_repo_path(&package.root, &format!("src/{rest}")));
        }
    }

    if is_base_url_import(source) {
        for base_url in &resolver.base_urls {
            bases.push(join_repo_path(base_url, source));
        }
    }

    bases
}

fn is_base_url_import(source: &str) -> bool {
    !source.starts_with('.')
        && !source.starts_with('@')
        && !source.starts_with('#')
        && source.contains('/')
}

fn base_url_import_may_be_local(source: &str, resolver: &ResolverContext) -> bool {
    if resolver.base_urls.is_empty() || !is_base_url_import(source) {
        return false;
    }
    let Some(first_segment) = source.split('/').next() else {
        return false;
    };
    resolver.base_urls.iter().any(|base_url| {
        let local_prefix = join_repo_path(base_url, first_segment);
        resolver
            .snapshot_paths
            .iter()
            .any(|path| path == &local_prefix || path.starts_with(&format!("{local_prefix}/")))
    })
}

fn read_js_ts_config_resolution(repo_root: &Path) -> (Vec<PathAlias>, Vec<String>) {
    let mut aliases_by_pattern = BTreeMap::<String, Vec<String>>::new();
    let mut base_urls = Vec::new();
    for config_name in ["tsconfig.json", "jsconfig.json"] {
        if !repo_root.join(config_name).is_file() {
            continue;
        };
        let config = read_js_ts_config_file(
            repo_root,
            Path::new(config_name),
            &mut BTreeSet::<String>::new(),
        );
        let Some(config) = config else {
            continue;
        };
        for (pattern, targets) in config.aliases {
            aliases_by_pattern.insert(pattern, targets);
        }
        if let Some(base_url) = config.base_url {
            push_unique(&mut base_urls, base_url);
        }
    }
    let aliases = aliases_by_pattern
        .into_iter()
        .map(|(pattern, targets)| PathAlias { pattern, targets })
        .collect();
    (aliases, base_urls)
}

fn read_js_ts_config_file(
    repo_root: &Path,
    config_path: &Path,
    seen: &mut BTreeSet<String>,
) -> Option<JsTsResolutionConfig> {
    let normalized_config_path = normalize_path(config_path);
    if !seen.insert(normalized_config_path.clone()) {
        return None;
    }
    let contents = fs::read_to_string(repo_root.join(config_path)).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&contents).ok()?;
    let config_dir = config_path.parent().map(normalize_path).unwrap_or_default();
    let mut config = json
        .get("extends")
        .and_then(|value| value.as_str())
        .and_then(|extended| resolve_extended_config_path(&config_dir, extended))
        .and_then(|extended_path| {
            read_js_ts_config_file(repo_root, Path::new(&extended_path), seen)
        })
        .unwrap_or_default();

    let explicit_base_url = json
        .pointer("/compilerOptions/baseUrl")
        .and_then(|value| value.as_str());
    let effective_base_url = explicit_base_url
        .map(|base_url| join_repo_path(&config_dir, base_url))
        .or_else(|| {
            if config.effective_base_url.is_empty() {
                None
            } else {
                Some(config.effective_base_url.clone())
            }
        })
        .unwrap_or_else(|| config_dir.clone());
    if explicit_base_url.is_some() || config.base_url.is_some() {
        config.base_url = Some(effective_base_url.clone());
    }
    config.effective_base_url = effective_base_url.clone();

    if let Some(paths) = json
        .pointer("/compilerOptions/paths")
        .and_then(|value| value.as_object())
    {
        for (pattern, value) in paths {
            let targets = value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|target| target.as_str())
                .map(|target| normalize_repo_string(&join_repo_path(&effective_base_url, target)))
                .collect::<Vec<_>>();
            if !targets.is_empty() {
                config.aliases.insert(pattern.to_string(), targets);
            }
        }
    }

    Some(config)
}

fn resolve_extended_config_path(config_dir: &str, extended: &str) -> Option<String> {
    if !extended.starts_with('.') {
        return None;
    }
    let base = join_repo_path(config_dir, extended);
    if base.ends_with(".json") {
        Some(base)
    } else {
        Some(format!("{base}.json"))
    }
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn read_package_imports(repo_root: &Path) -> Vec<PathAlias> {
    let Ok(contents) = fs::read_to_string(repo_root.join("package.json")) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return Vec::new();
    };
    let Some(imports) = json.get("imports").and_then(|value| value.as_object()) else {
        return Vec::new();
    };
    imports
        .iter()
        .filter_map(|(pattern, value)| {
            if !pattern.starts_with('#') {
                return None;
            }
            let target = package_export_target(value)?;
            Some(PathAlias {
                pattern: pattern.to_string(),
                targets: vec![normalize_repo_string(target.trim_start_matches("./"))],
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
            packages.insert(
                name.to_string(),
                WorkspacePackage {
                    root: package_root,
                    exports: package_meta
                        .get("exports")
                        .map(read_package_exports)
                        .unwrap_or_default(),
                },
            );
        }
    }
    packages
}

fn read_package_exports(value: &serde_json::Value) -> BTreeMap<String, String> {
    let mut exports = BTreeMap::new();
    if let Some(target) = package_export_target(value) {
        exports.insert(".".to_string(), target);
        return exports;
    }
    let Some(object) = value.as_object() else {
        return exports;
    };
    for (key, value) in object {
        if !key.starts_with('.') {
            continue;
        }
        if let Some(target) = package_export_target(value) {
            exports.insert(key.to_string(), target);
        }
    }
    exports
}

fn package_export_target(value: &serde_json::Value) -> Option<String> {
    if let Some(target) = value.as_str() {
        return Some(target.to_string());
    }
    if let Some(array) = value.as_array() {
        return array.iter().find_map(package_export_target);
    }
    let object = value.as_object()?;
    for key in ["import", "default", "require", "module", "types"] {
        if let Some(target) = object.get(key).and_then(package_export_target) {
            return Some(target);
        }
    }
    None
}

fn workspace_globs(value: &serde_json::Value) -> Option<Vec<String>> {
    if let Some(array) = value.as_array() {
        return Some(
            array
                .iter()
                .filter_map(|entry| entry.as_str().map(ToOwned::to_owned))
                .collect(),
        );
    }
    value
        .get("packages")
        .and_then(|packages| packages.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|entry| entry.as_str().map(ToOwned::to_owned))
                .collect()
        })
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
    let mut candidates = vec![
        base.to_string(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.mts"),
        format!("{base}.cts"),
        format!("{base}.js"),
        format!("{base}.jsx"),
        format!("{base}.mjs"),
        format!("{base}.cjs"),
        format!("{base}/index.ts"),
        format!("{base}/index.tsx"),
        format!("{base}/index.mts"),
        format!("{base}/index.cts"),
        format!("{base}/index.js"),
        format!("{base}/index.jsx"),
        format!("{base}/index.mjs"),
        format!("{base}/index.cjs"),
    ];
    for (runtime_ext, source_exts) in [
        (".js", [".ts", ".tsx", ".mts", ".cts"].as_slice()),
        (".jsx", [".tsx", ".ts"].as_slice()),
        (".mjs", [".mts", ".ts", ".tsx"].as_slice()),
        (".cjs", [".cts", ".ts", ".tsx"].as_slice()),
    ] {
        if let Some(stripped) = base.strip_suffix(runtime_ext) {
            candidates.extend(
                source_exts
                    .iter()
                    .map(|source_ext| format!("{stripped}{source_ext}")),
            );
        }
    }
    candidates
}

fn join_repo_path(left: &str, right: &str) -> String {
    normalize_repo_string(&format!(
        "{}/{}",
        left.trim_end_matches('/'),
        right.trim_start_matches('/')
    ))
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
