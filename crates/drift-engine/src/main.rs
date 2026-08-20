use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::Instant,
};

mod candidate_command;
mod check_command;
mod frameworks;
mod protocol;

use candidate_command::infer_candidates;
use check_command::check_repo;
use drift_engine::{
    Fact, FactExtractError, FactKind, GraphEdgeKind, GraphNodeKind, PrismaFactKind, ScanCapability,
    dynamic_middleware_matcher_line, extract_prisma_facts, extract_scan_security_facts,
    extract_typescript_facts_with_report, should_index_path, static_middleware_coverage,
};
use frameworks::{EndpointShape, collect_framework_scan_data, endpoint_shape};
use protocol::*;
use serde_json::json;
use sha2::{Digest, Sha256};

type EngineResult<T> = Result<T, Box<dyn std::error::Error>>;
type ScannedFileFacts = (ScannedFile, Vec<EngineFact>);

#[derive(Default)]
struct ScanFilesResult {
    scanned: Vec<ScannedFileFacts>,
    files_reused: usize,
    /// Files that could not be read or parsed. Surfaced in the scan summary so partial
    /// coverage is reported rather than silently presented as complete.
    files_skipped_unreadable: usize,
    /// Files skipped for exceeding MAX_FILE_BYTES.
    ///
    /// These were counted nowhere. The oversize branch emits a `file_too_large` diagnostic and
    /// returns `Ok(None)`, which landed in an empty match arm, so a skipped 2 MB route left the
    /// scan reporting complete coverage - the same overstatement `files_skipped_unreadable` exists
    /// to prevent, one branch over.
    files_skipped_too_large: usize,
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
            // T-02: `--request-file <path>` reads the request from a file instead of stdin.
            //
            // The request carries the whole graph and every fact, and building it as one JS string
            // on the CLI side cost 105,024,113 chars on papermark against a MAX_STRING_LENGTH of
            // 536,870,888 - which is what made repo size a cliff. Handed a path, the CLI can write
            // it in pieces and nothing has to hold all of it.
            //
            // Same shape as `scan-repo --reuse-manifest`, which already passes bulk data by path.
            // Stdin stays supported: it is the smaller path, and older callers still use it.
            let args: Vec<String> = args.collect();
            let request: CandidateRequest = match request_file_arg(&args)? {
                Some(path) => serde_json::from_str(&fs::read_to_string(&path)?)?,
                None => {
                    let mut input = String::new();
                    io::stdin().read_to_string(&mut input)?;
                    serde_json::from_str(&input)?
                }
            };
            let output = infer_candidates(request);
            println!("{}", serde_json::to_string(&output)?);
            Ok(())
        }
        // BB-2: a cheap handshake any harness can call before it records a measurement. Spawning
        // `scan-repo` just to learn the build profile would cost the measurement it is protecting.
        Some("version") => {
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "schema_version": ENGINE_VERSION_RESULT_SCHEMA_VERSION,
                    "engine_version": drift_engine::DRIFT_ENGINE_VERSION,
                    "build_profile": engine_build_profile(),
                }))?
            );
            Ok(())
        }
        _ => Err("usage: drift-engine scan-repo <repo-root> [--format json|jsonl] [--repo-id <id>] [--scan-id <id>] | check-repo | infer-candidates | version".into()),
    }
}

/// The value of `--request-file`, when `infer-candidates` was given one.
///
/// An unknown flag is an error rather than something to skip past: a caller that misspells the
/// only way to pass a large request would otherwise fall through to reading an empty stdin and get
/// a confusing parse failure instead of being told what it typed wrong.
fn request_file_arg(args: &[String]) -> Result<Option<PathBuf>, Box<dyn std::error::Error>> {
    let mut index = 0;
    let mut path = None;
    while index < args.len() {
        match args[index].as_str() {
            "--request-file" => {
                index += 1;
                path = Some(PathBuf::from(
                    args.get(index).ok_or("missing value for --request-file")?,
                ));
            }
            flag => return Err(format!("unknown infer-candidates option: {flag}").into()),
        }
        index += 1;
    }
    Ok(path)
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
    let discovery = collect_indexable_files(repo_root)?;
    let mut files = discovery.files;
    let mut diagnostics = discovery.diagnostics;
    files.sort();
    let mut resolver = build_resolver_context(repo_root, &files, &mut diagnostics);
    let reuse_index = load_reuse_index(reuse_manifest_path)?;

    let mut scanned_files = Vec::new();
    let mut facts = Vec::new();
    let mut graph_node_count = 0_usize;
    let mut graph_edge_count = 0_usize;
    let scanned = scan_files(repo_root, &files, &mut diagnostics, reuse_index.as_ref())?;
    let files_reused = scanned.files_reused;
    let mut scanned = scanned;
    add_middleware_coverage_facts(&mut scanned.scanned);
    let framework_scan_data = collect_framework_scan_data(&repo_id, &scan_id, &scanned.scanned);
    resolver.exported_symbols = exported_symbols_by_file(&scanned.scanned);
    resolver.export_star_sources = export_star_sources_by_file(&scanned.scanned);
    retain_scanned_snapshot_paths(&mut resolver, &scanned.scanned);
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
    stats.capabilities = capability_stats(
        &[
            ScanCapability::FileDiscovery,
            ScanCapability::SyntaxFacts,
            ScanCapability::GraphStream,
        ],
        &[],
    );
    Ok(ScanRepoOutput {
        schema_version: ENGINE_SCAN_RESULT_SCHEMA_VERSION,
        repo_id,
        scan_id,
        engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        build_profile: engine_build_profile(),
        adapter_versions: adapter_versions(),
        file_snapshots: scanned_files,
        facts,
        framework_adapters: framework_scan_data.adapters,
        normalized_entrypoints: framework_scan_data.entrypoints,
        framework_parser_gaps: framework_scan_data.parser_gaps,
        framework_capabilities: framework_scan_data.capabilities,
        diagnostics,
        stats,
        completeness: repo_completeness(
            scanned.files_skipped_unreadable,
            scanned.files_skipped_too_large,
        ),
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
            build_profile: engine_build_profile(),
            fact_kinds: emittable_fact_kind_names(),
            graph_node_kinds: emittable_graph_node_kind_names(),
            graph_edge_kinds: emittable_graph_edge_kind_names(),
        },
    )?;

    let discovery = collect_indexable_files(repo_root)?;
    let mut files = discovery.files;
    files.sort();
    // Resolver-configuration diagnostics (e.g. unsupported_workspace_glob) are streamed in
    // their own batch and do not count as skipped files.
    let mut resolver_diagnostics = Vec::new();
    let mut resolver = build_resolver_context(repo_root, &files, &mut resolver_diagnostics);
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
    let framework_scan_data = collect_framework_scan_data(&repo_id, &scan_id, &scanned.scanned);
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
    if !resolver_diagnostics.is_empty() {
        diagnostics_emitted += resolver_diagnostics.len();
        write_event(
            &mut stdout,
            &ScanStreamEvent::DiagnosticBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                diagnostics: resolver_diagnostics,
            },
        )?;
    }
    resolver.exported_symbols = exported_symbols_by_file(&scanned.scanned);
    resolver.export_star_sources = export_star_sources_by_file(&scanned.scanned);
    retain_scanned_snapshot_paths(&mut resolver, &scanned.scanned);
    if !framework_scan_data.adapters.is_empty() {
        write_event(
            &mut stdout,
            &ScanStreamEvent::FrameworkAdapterBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                framework_adapters: framework_scan_data.adapters,
            },
        )?;
    }
    if !framework_scan_data.entrypoints.is_empty() {
        write_event(
            &mut stdout,
            &ScanStreamEvent::NormalizedEntrypointBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                normalized_entrypoints: framework_scan_data.entrypoints,
            },
        )?;
    }
    if !framework_scan_data.parser_gaps.is_empty() {
        write_event(
            &mut stdout,
            &ScanStreamEvent::FrameworkParserGapBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                framework_parser_gaps: framework_scan_data.parser_gaps,
            },
        )?;
    }
    if !framework_scan_data.capabilities.is_empty() {
        write_event(
            &mut stdout,
            &ScanStreamEvent::FrameworkCapabilityBatch {
                schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
                framework_capabilities: framework_scan_data.capabilities,
            },
        )?;
    }
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
    stats.capabilities = capability_stats(
        &[
            ScanCapability::FileDiscovery,
            ScanCapability::SyntaxFacts,
            ScanCapability::GraphStream,
        ],
        &[],
    );
    write_event(
        &mut stdout,
        &ScanStreamEvent::ScanCompleted {
            schema_version: ENGINE_STREAM_EVENT_SCHEMA_VERSION,
            stats,
            completeness: repo_completeness(
                scanned.files_skipped_unreadable,
                scanned.files_skipped_too_large,
            ),
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
    // Fail closed on an engine change: reparse rather than trust facts produced by different
    // extraction logic. Cheaper to rescan once after an upgrade than to enforce against a
    // stale view of the repo.
    if manifest.engine_version.as_deref() != Some(drift_engine::DRIFT_ENGINE_VERSION) {
        return Ok(None);
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
            import_source: None,
        });
        return Ok(None);
    }
    let normalized = normalize_path(file_path);
    // A declaration file goes to its own reader and never to the TypeScript extractor below - see
    // `is_declaration_path`. `indexed` is true only once a reader for the format actually ran, so
    // a format Drift records but cannot yet parse stays honestly marked as unread.
    if is_declaration_path(file_path) {
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
        let facts = extract_prisma_facts(&source)
            .into_iter()
            .map(|fact| {
                engine_fact(Fact {
                    kind: match fact.kind {
                        PrismaFactKind::ModelDeclared => FactKind::DataModelDeclared,
                        PrismaFactKind::FieldDeclared => FactKind::DataModelFieldDeclared,
                        PrismaFactKind::RelationDeclared => FactKind::DataModelRelationDeclared,
                    },
                    file_path: normalized.clone(),
                    name: fact.name,
                    value: fact.value,
                    imported_name: None,
                    runtime_use: None,
                    start_line: fact.start_line,
                    end_line: fact.end_line,
                    start_column: fact.start_column,
                    end_column: fact.start_column,
                })
            })
            .collect();
        return Ok(Some((file, facts, false)));
    }
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
            import_source: None,
        });
    }
    let (mut facts, parse) = extract_typescript_facts_with_report(file_path, &source)?;
    // D-PA1: say when the grammar could not read the file.
    //
    // No code path in this crate inspected `tree.root_node().has_error()` before this line - an
    // exhaustive grep for `has_error|is_error|ERROR|is_missing` across crates/drift-engine/src
    // returned one hit, a comment. So foreign content under a TypeScript-family extension produced
    // confident facts with `indexed: true` and no diagnostic at all: Python yielded 3
    // `symbol_called`, Go an `ImportUsed` plus 3 `SymbolCalled`, a README saved as `.ts` a
    // `SymbolCalled` with an empty name. Only `.prisma` was guarded, and only by never being parsed.
    //
    // What this does NOT do is drop the facts, and that is a measured decision rather than
    // timidity. Two candidate rules were tried against the corpus and both were wrong:
    //
    //   - a damage-ratio threshold cannot separate the cases. 129 corpus files carry parse errors;
    //     122 sit under 5%, but four real cal.com email components sit at 66-100% because their
    //     JSX bodies do not fit the grammar - while foreign content starts at 22%. Any threshold
    //     either keeps Python or discards cal.com.
    //   - refusing facts from inside ERROR subtrees does the wrong thing in BOTH directions,
    //     measured: `BaseEmailHtml.tsx` fell from 9 facts to 1, losing 8 correct `import_used`
    //     records whose statements parsed perfectly, while every junk fact from the Python and Go
    //     samples survived - tree-sitter had recovered them as well-formed top-level statements
    //     OUTSIDE any ERROR node. Recovery does not put the untrustworthy content where a
    //     structural rule can find it.
    //
    // So the fix is the thing that was actually missing: the file says how much of itself the
    // grammar could not read, once, with numbers. A consumer that needs certainty can act on it;
    // silence gave it nothing to act on.
    if !parse.is_clean() {
        diagnostics.push(EngineDiagnostic {
            severity: "warning".to_string(),
            code: "partial_parse".to_string(),
            message: format!(
                "{} of {} bytes did not fit the {} grammar across {} error node(s) ({:.0}% of the file); facts from this file are incomplete",
                parse.error_bytes,
                parse.source_bytes,
                parse.grammar,
                parse.error_nodes,
                parse.damage_ratio() * 100.0
            ),
            file_path: Some(normalized.clone()),
            import_source: None,
        });
    }
    // Delegated to the library, deliberately, rather than assembled here.
    //
    // What stood here was a call passing `&[]` for the accepted validators. Since
    // `request_validation_called` is emitted only for calls matching an accepted validator, and
    // since this is the only place the scanner extracts security facts, that empty slice gave the
    // kind zero instances in every repo ever scanned - which left the proposer's request-validation
    // family, and the `presence_findings` path behind it, structurally unreachable.
    //
    // The fix is not just the argument: it is that the argument now lives somewhere a test can
    // reach. `main.rs` is the binary, so nothing in `cargo test -p drift-engine` could see this
    // line, and reintroducing the empty slice here left the entire Rust suite green.
    // `extract_scan_security_facts` is the library seam that makes the wiring testable, and
    // `main_rs_delegates_its_security_facts_to_the_library` pins this call site so the seam cannot
    // be quietly bypassed.
    let security_facts = extract_scan_security_facts(file_path, &source, &facts)?;
    facts.extend(security_facts);
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
        // Fail closed on the file, not on the repo. A single unreadable or non-UTF-8
        // file used to propagate its error and abort the entire scan, leaving the repo
        // with no database and no way to onboard. Record it as a diagnostic, mark the
        // file unindexed, and keep going: partial coverage that says so beats no
        // coverage at all, and the gap is visible rather than silent.
        match scan_file_with_reuse(repo_root, file_path, diagnostics, reuse) {
            Ok(Some((file, facts, reused))) => {
                if reused {
                    result.files_reused += 1;
                }
                result.scanned.push((file, facts));
            }
            // The only `Ok(None)` from scan_file_with_reuse is the oversize skip.
            Ok(None) => {
                result.files_skipped_too_large += 1;
            }
            Err(error) => {
                diagnostics.push(EngineDiagnostic {
                    severity: "warning".to_string(),
                    code: skipped_file_code(error.as_ref()).to_string(),
                    message: format!("file skipped: {error}"),
                    file_path: Some(normalize_path(file_path)),
                    import_source: None,
                });
                result.files_skipped_unreadable += 1;
            }
        }
    }
    Ok(result)
}

/// D-PA3: which of five different things went wrong with a file.
///
/// The single `Err` arm above tagged all of them `file_unreadable`: a genuinely unreadable path, a
/// non-UTF-8 file, an AST too deep to walk, a parse that returned nothing, and a parser that could
/// not be constructed. Only the free-text `message` distinguished them, so anything keying on
/// `code` - the coverage report, the limitations map in
/// packages/cli/src/domain/import-coverage.ts, any user filter - could not tell "this file is a
/// 130 KB minified bundle, split it" from "this file is not text". Those have different answers,
/// and `file_unreadable` was the wrong answer for four of the five.
///
/// `file_unreadable` keeps its name and its meaning: an I/O failure that is not an encoding
/// problem. Nothing that was correctly labelled changes label.
fn skipped_file_code(error: &(dyn std::error::Error + 'static)) -> &'static str {
    if let Some(extract) = error.downcast_ref::<FactExtractError>() {
        return match extract {
            FactExtractError::TooDeep { .. } => "file_too_deep",
            FactExtractError::ParseFailed => "file_parse_failed",
            FactExtractError::ParserLanguage(_) => "parser_language_unavailable",
        };
    }
    if let Some(io_error) = error.downcast_ref::<io::Error>()
        && io_error.kind() == io::ErrorKind::InvalidData
    {
        // What `fs::read_to_string` returns for bytes that are not valid UTF-8. The file is
        // perfectly readable; it is not text this parser can accept.
        return "file_not_utf8";
    }
    "file_unreadable"
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
                    // W5: through the vocabulary rather than as a literal. This is the only fact the
                    // engine synthesises outside the extractors, and it was the only one whose kind
                    // was spelled as a bare string - a fourth copy beside the enum, the handshake
                    // list and check_command's translation table.
                    kind: FactKind::MiddlewareProtectsRoute.as_wire().to_string(),
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
                    runtime_use: None,
                    start_line: route_line,
                    end_line: route_line,
                    // A synthesised relationship fact, not a source occurrence: it has a
                    // line (the route declaration's) but no column, and inventing one
                    // would claim a position in the file that nothing occupies.
                    start_column: 0,
                    end_column: 0,
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
        runtime_use: None,
        start_line: fact.start_line,
        end_line: fact.end_line,
        start_column: fact.start_column,
        end_column: fact.end_column,
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

/// Discover indexable files, honouring `.gitignore` the way git does.
///
/// Uses `ignore::WalkBuilder` rather than a hand-rolled walk so that nested `.gitignore` files and
/// `!` negations work with correct per-directory precedence. The previous implementation read only
/// the repository-root file and discarded every line beginning with `!`, so generated and vendored
/// output inside a package was scanned and could produce findings in files a user cannot fix.
///
/// A first attempt built one `Gitignore` rooted at the repo and added every nested file to it.
/// That is wrong in a way that looks right: `GitignoreBuilder::add()` interprets patterns relative
/// to the *builder* root, so a bare `app` pattern in `apps/server/.gitignore` went repo-wide and
/// swallowed another package's API routes. Per-directory scoping is exactly what WalkBuilder
/// provides.
///
/// Deliberately narrow about which ignore sources are consulted: `.gitignore` only, no global or
/// per-user files and nothing above the repository root, so two machines scanning the same commit
/// see the same files.
fn collect_indexable_files(repo_root: &Path) -> io::Result<FileDiscoveryResult> {
    // A missing or unreadable *root* is a hard failure, not a diagnostic.
    //
    // The hand-rolled walk got this for free: `fs::read_dir(repo_root)?` propagated. WalkBuilder
    // instead yields the failure as an error entry, and treating that like any other unreadable
    // path made a scan of a non-existent repo report an empty repo and exit 0 - reporting success
    // for a repository it never saw, which is the exact failure this product exists to prevent.
    //
    // Per-entry errors deeper in the tree stay diagnostics: partial coverage that says so is
    // honest, and a scan should not be lost to one unreadable subdirectory.
    fs::read_dir(repo_root)?;

    let mut result = FileDiscoveryResult::default();
    let walker = ignore::WalkBuilder::new(repo_root)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .git_global(false)
        .parents(false)
        .ignore(false)
        .hidden(false)
        .follow_links(false)
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                // A directory we cannot traverse is reported, not silently skipped: a scan that
                // quietly saw less than the repo is the failure this product exists to prevent.
                result.diagnostics.push(EngineDiagnostic {
                    severity: "warning".to_string(),
                    code: "unreadable_path".to_string(),
                    message: format!("Skipped a path that could not be read: {error}"),
                    file_path: None,
                    import_source: None,
                });
                continue;
            }
        };
        let path = entry.path();
        let relative = path.strip_prefix(repo_root).unwrap_or(path);
        if relative.as_os_str().is_empty() || !should_index_path(relative) {
            continue;
        }

        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            if let Err(error) = fs::metadata(path) {
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
                    import_source: None,
                });
            }
            continue;
        }
        if file_type.is_file() && (is_typescript_path(path) || is_declaration_path(path)) {
            result.files.push(relative.to_path_buf());
        }
    }
    Ok(result)
}

fn is_typescript_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs")
    )
}

/// Files that DECLARE structure rather than implement it: hashed and located, contents not parsed.
///
/// These get a `file_snapshots` row with `indexed: false`, which is the whole of their treatment
/// here. Two reasons that matters:
///
/// 1. Evidence is hard-coupled to the snapshot. `GraphEvidenceSchema` requires a `file_path` AND a
///    `file_hash`, and `EvidenceRefSchema.file_hash` is `min(1)`, so nothing - no finding, no
///    evidence ref - can attach to a file with no snapshot. Snapshotting is therefore the
///    prerequisite for every later step, and is worth landing on its own.
/// 2. They must NOT reach `extract_typescript_facts`. tree-sitter does not reject foreign input:
///    handed a Prisma schema it builds an ERROR-node tree and emits plausible-looking facts rather
///    than failing. Junk facts are worse than no facts, so the parse is skipped entirely until a
///    real grammar exists for the format.
///
/// `indexed: false` is what keeps consumers honest in the meantime - a rule must not evaluate a
/// file Drift has not read, because every question it asks ("does it export X") would be answered
/// from absence, which reads as a violation rather than as ignorance.
///
/// Scoped to Prisma on measured evidence: 5 of 7 corpus repos carry `.prisma` (315 models, 657
/// typed relations), and 90% of dub's model names already appear in indexed TypeScript, so the
/// facts have something to join to. `.sql` is deliberately excluded - 1,011 files corpus-wide and
/// ~99% of them generated migration journals, i.e. derived output that would flood the index.
fn is_declaration_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("prisma")
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
        kind: fact.kind.as_wire().to_string(),
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        imported_name: fact.imported_name,
        runtime_use: fact.runtime_use,
        start_line: fact.start_line,
        end_line: fact.end_line,
        start_column: fact.start_column,
        end_column: fact.end_column,
    }
}

/// Every vocabulary the engine declares to the CLI at `scan_started`.
///
/// The CLI refuses the stream up front if it does not recognise every member. Without this, a CLI
/// paired with an engine that knows a newer kind failed on the FIRST RECORD OF THAT KIND - line 16
/// of the stream, with `Invalid Drift engine stream event`, naming a Zod enum rather than the
/// actual problem, and aborting a scan already partly done.
///
/// A version comparison would not have caught it. Both sides report engine_version `0.1.0` and
/// `engine.stream.event.v1`, and neither moves when the vocabulary changes - measured. Only the
/// vocabulary itself distinguishes a stale binary from a current one, so the vocabulary is what
/// gets compared.
///
/// W5 (D-G4): the graph vocabularies join the handshake. They were bare `String`s on both sides of
/// the wire, so a node kind this CLI did not know produced a generic Zod parse failure and exit 1,
/// where the fact-kind path had given an exit-3 `engine_vocabulary_mismatch` naming the cause since
/// the handshake was built. Both lists come from vocabulary/vocabulary.json, so neither can be
/// declared here and forgotten in the enum.
fn emittable_fact_kind_names() -> Vec<String> {
    FactKind::all_wire_names()
}

fn emittable_graph_node_kind_names() -> Vec<String> {
    GraphNodeKind::all_wire_names()
}

fn emittable_graph_edge_kind_names() -> Vec<String> {
    GraphEdgeKind::all_wire_names()
}

#[cfg(test)]
mod emittable_fact_kind_tests {
    use super::{
        emittable_fact_kind_names, emittable_graph_edge_kind_names, emittable_graph_node_kind_names,
    };
    use drift_engine::{FactKind, GraphEdgeKind, GraphNodeKind};

    /// The handshake must cover every variant of the generated enums.
    ///
    /// Before W5 this pinned a hand-written `EMITTABLE_FACT_KINDS` list against a hand-written
    /// `FactKind` enum, because Rust cannot enumerate an enum's variants - a count assertion, which
    /// caught a missing entry only by tripping on the number. `FactKind::ALL` is now generated from
    /// the same manifest as the enum, so the two cannot come apart; the counts stay as a pin on the
    /// manifest itself, which is what a reviewer reads.
    #[test]
    fn every_vocabulary_member_is_declared() {
        assert_eq!(FactKind::ALL.len(), 40);
        assert_eq!(GraphNodeKind::ALL.len(), 18);
        assert_eq!(GraphEdgeKind::ALL.len(), 22);
    }

    #[test]
    fn declared_kinds_are_unique_sorted_and_named() {
        for names in [
            emittable_fact_kind_names(),
            emittable_graph_node_kind_names(),
            emittable_graph_edge_kind_names(),
        ] {
            let mut sorted = names.clone();
            sorted.sort();
            assert_eq!(
                names, sorted,
                "handshake list must be sorted for stable comparison"
            );
            let unique: std::collections::BTreeSet<_> = names.iter().collect();
            assert_eq!(
                unique.len(),
                names.len(),
                "two variants map to the same wire string"
            );
        }
    }

    #[test]
    fn the_new_declaration_kinds_are_declared() {
        let names = emittable_fact_kind_names();
        for kind in [
            FactKind::DataModelDeclared,
            FactKind::DataModelFieldDeclared,
            FactKind::DataModelRelationDeclared,
        ] {
            assert!(names.contains(&kind.as_wire().to_string()));
        }
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
    base_urls: Vec<ScopedBaseUrl>,
    packages: BTreeMap<String, WorkspacePackage>,
    exported_symbols: BTreeMap<String, BTreeSet<String>>,
    /// S1-05 (E-5): per file, the raw specifiers of its flattening `export * from "m"`
    /// statements, in declaration order. `export * as ns` is deliberately excluded - it
    /// exports a namespace, not the target's members. Used to resolve imported symbols
    /// through re-export chains.
    export_star_sources: BTreeMap<String, Vec<String>>,
}

/// A tsconfig/jsconfig `paths` alias, scoped to the directory of the config that declared
/// it (`""` for the repo root). S1-04 Gap 3 (E-4): an alias applies only to files under its
/// declaring config's directory — `apps/web`'s `@/lib/*` must not leak to `apps/admin`.
struct PathAlias {
    scope: String,
    pattern: String,
    targets: Vec<String>,
}

/// A tsconfig/jsconfig `baseUrl`, scoped like `PathAlias`.
struct ScopedBaseUrl {
    scope: String,
    base_url: String,
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

/// Resolve against what was read, not against what was found.
///
/// `snapshot_paths` is built from the *discovered* file list, before scanning, while the graph is
/// built from the files that were actually scanned. Anything discovered but skipped - unreadable
/// bytes, over MAX_FILE_BYTES - falls into the gap between those two sets, and the gap is silent in
/// the worst possible way: `resolve_import` answers "yes, that is the module", no module node
/// exists for it, so the IMPORT_RESOLVES_TO_MODULE edge is never created and no `unresolved_import`
/// diagnostic is emitted either. The import simply evaporates.
///
/// Measured: a route importing `@/lib/secret`, whose file is non-UTF-8, produced
/// `partial_coverage: {complete: true, reasons: []}` - while the same route importing a module that
/// does not exist at all correctly produced `unresolved_route_import`. The honest case was the one
/// that reported; the dangerous case was the one that stayed quiet, because `lib/secret.ts` could
/// be the data layer and nothing would ever say Drift had not looked at it.
///
/// Narrowing the set here means those imports are simply unresolved, which they are, and the
/// existing coverage-gap machinery reports them against the importing route - already scoped to the
/// diff, already understood by every consumer. No new diagnostic kind, no second resolver.
fn retain_scanned_snapshot_paths(resolver: &mut ResolverContext, scanned: &[ScannedFileFacts]) {
    let scanned_paths = scanned
        .iter()
        .map(|(file, _)| file.file_path.clone())
        .collect::<BTreeSet<String>>();
    resolver
        .snapshot_paths
        .retain(|path| scanned_paths.contains(path));
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
        GraphNodeKind::File,
        &file.file_path,
        true,
        Vec::new(),
        BTreeMap::from([("path".to_string(), json!(file.file_path))]),
    );
    insert_node(
        &mut nodes,
        file_version_node.clone(),
        GraphNodeKind::FileVersion,
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
        GraphNodeKind::Module,
        &file.file_path,
        true,
        Vec::new(),
        BTreeMap::from([("file_path".to_string(), json!(file.file_path))]),
    );
    insert_edge(
        &mut edges,
        GraphEdgeKind::FileHasVersion,
        &file_node,
        &file_version_node,
        Vec::new(),
        BTreeMap::new(),
    );
    insert_edge(
        &mut edges,
        GraphEdgeKind::FileDefinesModule,
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
                    GraphNodeKind::FileRole,
                    &fact.name,
                    true,
                    vec![evidence_id.clone()],
                    BTreeMap::from([("role".to_string(), json!(fact.name))]),
                );
                insert_edge(
                    &mut edges,
                    GraphEdgeKind::FileHasRole,
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
                let should_report_unresolved = resolved.is_none()
                    && should_report_unresolved_import(&fact.file_path, source, resolver);
                let resolution_status = if resolved.is_some() {
                    "resolved"
                } else if should_report_unresolved {
                    "unresolved"
                } else {
                    "external"
                };
                let resolved_module = resolved.as_ref().map(|path| module_id(path));
                let imported_name = fact.imported_name.as_deref().unwrap_or(&fact.name);
                // S10: a bindingless side-effect import. It binds no symbol, so every
                // member-level judgement below is vacuous for it - there is no symbol to
                // resolve, no namespace to be conservative about, and no delegated service
                // boundary to infer. What it does have is a module dependency, which is the
                // only thing the direct-data-access rule needs.
                let is_side_effect_import =
                    fact.runtime_use.as_deref() == Some(drift_engine::RUNTIME_USE_SIDE_EFFECT);
                let mut import_metadata = BTreeMap::from([
                    ("source".to_string(), json!(source)),
                    ("local_name".to_string(), json!(fact.name)),
                    ("imported_name".to_string(), json!(imported_name)),
                    ("file_path".to_string(), json!(fact.file_path)),
                    (
                        "import_kind".to_string(),
                        json!(if is_side_effect_import {
                            "side_effect"
                        } else {
                            "value"
                        }),
                    ),
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
                    GraphNodeKind::ImportDecl,
                    &format!("{} from {}", fact.name, source),
                    false,
                    vec![evidence_id.clone()],
                    import_metadata,
                );
                insert_edge(
                    &mut edges,
                    GraphEdgeKind::ImportDeclReferencesModule,
                    &import_node,
                    &module_node,
                    vec![evidence_id.clone()],
                    BTreeMap::new(),
                );
                if let (Some(resolved), Some(resolved_module)) = (&resolved, &resolved_module) {
                    insert_edge(
                        &mut edges,
                        GraphEdgeKind::ImportResolvesToModule,
                        &import_node,
                        resolved_module,
                        vec![evidence_id.clone()],
                        BTreeMap::from([
                            ("resolution_status".to_string(), json!("resolved")),
                            ("resolved_file_path".to_string(), json!(resolved)),
                            ("resolved_module_id".to_string(), json!(resolved_module)),
                        ]),
                    );
                    // S1-05 (E-5): symbol resolution follows `export *` chains, and the
                    // conservative diagnostics consult the runtime-use proof carried on
                    // the fact instead of firing unconditionally.
                    let symbol_resolution =
                        resolve_import_symbol(imported_name, resolved, resolver);
                    // Runtime by construction: `require()`, dynamic `import()` (S1-05) and the
                    // bindingless side-effect import (S10) all execute the module outright.
                    // Member-level conservatism has nothing to add about any of them.
                    let runtime_by_construction = matches!(
                        fact.runtime_use.as_deref(),
                        Some(drift_engine::RUNTIME_USE_DYNAMIC)
                            | Some(drift_engine::RUNTIME_USE_SIDE_EFFECT)
                    );
                    let runtime_use_proven = fact.runtime_use.is_some();
                    if let Some(declaring_file) = &symbol_resolution.declaring_file {
                        let resolved_symbol = symbol_id(declaring_file, "function", imported_name);
                        insert_edge(
                            &mut edges,
                            GraphEdgeKind::ImportResolvesToSymbol,
                            &import_node,
                            &resolved_symbol,
                            vec![evidence_id.clone()],
                            BTreeMap::from([
                                ("resolution_status".to_string(), json!("resolved")),
                                ("imported_name".to_string(), json!(imported_name)),
                                ("local_name".to_string(), json!(fact.name)),
                                ("resolved_file_path".to_string(), json!(declaring_file)),
                                ("resolved_module_id".to_string(), json!(resolved_module)),
                            ]),
                        );
                    } else if is_symbol_resolvable_import(imported_name)
                        && resolver.exported_symbols.contains_key(resolved)
                        // An open chain (`export * from "some-external-package"`) means
                        // the symbol may legitimately come from outside the snapshot, so
                        // its absence is not provable.
                        && symbol_resolution.chain_closed
                        // `require()` / dynamic `import()` are runtime by construction;
                        // member-level conservatism must not refuse them (S1-05).
                        && !runtime_by_construction
                    {
                        diagnostics.push(EngineDiagnostic {
                            severity: "warning".to_string(),
                            code: "unresolved_import_symbol".to_string(),
                            message: format!(
                                "Could not resolve imported symbol {imported_name} from {source} in {resolved}."
                            ),
                            file_path: Some(fact.file_path.clone()),
                            import_source: Some(source.to_string()),
                        });
                    } else if imported_name == "*" && !runtime_use_proven {
                        // Emitted only when no runtime use is provable: the binding never
                        // appears in a value position and the import is not runtime by
                        // construction. Keeping this is the S1-05 direction of caution -
                        // an unanalysable namespace import must stay conservative.
                        diagnostics.push(EngineDiagnostic {
                            severity: "warning".to_string(),
                            code: "unsupported_namespace_import_symbol".to_string(),
                            message: format!(
                                "Namespace import {source} in {} resolved to {resolved}, but member-level symbol resolution is conservative.",
                                fact.file_path
                            ),
                            file_path: Some(fact.file_path.clone()),
                            import_source: Some(source.to_string()),
                        });
                    }
                    insert_edge(
                        &mut edges,
                        GraphEdgeKind::ModuleImportsModule,
                        &module_node,
                        resolved_module,
                        vec![evidence_id.clone()],
                        BTreeMap::new(),
                    );
                    // S10: service-boundary inference is symbol-based - a route delegates by
                    // calling something it imported. A side-effect import imports nothing, so
                    // it neither proves a delegation nor leaves one ambiguous; both branches
                    // are skipped rather than reporting a parser gap that does not exist.
                    if is_side_effect_import {
                        // no service-boundary judgement available or needed
                    } else if file_is_api_route
                        && !is_data_access_reference(resolved)
                        && resolved_import_symbol_name(imported_name, resolved, resolver).is_some()
                    {
                        let target_file_node = file_id(resolved);
                        let service_role_node = "file_role:service_module".to_string();
                        insert_node(
                            &mut nodes,
                            target_file_node.clone(),
                            GraphNodeKind::File,
                            resolved,
                            true,
                            Vec::new(),
                            BTreeMap::from([("path".to_string(), json!(resolved))]),
                        );
                        insert_node(
                            &mut nodes,
                            service_role_node.clone(),
                            GraphNodeKind::FileRole,
                            "service_module",
                            true,
                            vec![evidence_id.clone()],
                            BTreeMap::from([("role".to_string(), json!("service_module"))]),
                        );
                        insert_edge(
                            &mut edges,
                            GraphEdgeKind::FileHasRole,
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
                            import_source: Some(source.to_string()),
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
                        import_source: Some(source.to_string()),
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
                    GraphNodeKind::ReExport,
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
                        GraphEdgeKind::ModuleReexportsModule,
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
                    // EW-4: resolve the SOURCE name, not the exported alias.
                    //
                    // `export { default as prisma } from "./m"` exports `prisma` and resolves
                    // `default` in the target. Checking the alias there fails against every
                    // default-only module - which is the shape a barrel over such a data layer is
                    // forced into.
                    let source_name = fact.imported_name.as_deref().unwrap_or(&fact.name);
                    if resolver
                        .exported_symbols
                        .get(&resolved)
                        .is_some_and(|symbols| symbols.contains(source_name))
                    {
                        insert_edge(
                            &mut edges,
                            GraphEdgeKind::ReexportResolvesToSymbol,
                            &reexport_node,
                            &symbol_id(&resolved, "function", source_name),
                            vec![evidence_id],
                            BTreeMap::from([
                                ("source".to_string(), json!(source)),
                                ("exported_name".to_string(), json!(fact.name)),
                                ("source_name".to_string(), json!(source_name)),
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
                    GraphNodeKind::Symbol,
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
                    GraphEdgeKind::FileContainsSymbol,
                    &file_node,
                    &symbol_node,
                    vec![evidence_id.clone()],
                    BTreeMap::new(),
                );
                insert_edge(
                    &mut edges,
                    GraphEdgeKind::ModuleExportsSymbol,
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
                    GraphNodeKind::Route,
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
                    GraphEdgeKind::RouteDeclaredInFile,
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
                        GraphNodeKind::Endpoint,
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
                        GraphEdgeKind::RouteHasEndpoint,
                        &route_node,
                        &endpoint_node,
                        vec![evidence_id.clone()],
                        BTreeMap::new(),
                    );
                }
                // D2 follow-up: target the symbol node that EXISTS.
                //
                // This used to be `fact.value.unwrap_or(fact.name)`. For a Next pages/api route
                // that is the handler's local identifier (`handler`), and a
                // `symbol:<file>:function:handler` node existed only because a default-exported
                // declaration also emitted a second exported-symbol fact under its local name.
                // D2 removed that fact - correctly, since no importer can bind it - which left
                // this edge pointing at a node id that names nothing.
                //
                // `fact.name` is `default` for such a route, which is exactly the symbol node the
                // canonical `(default, value = handler)` fact produces. It is also already what
                // packages/factgraph/src/index.ts:410 emits for this edge, so the Rust and TS
                // graph builders agreed on every other shape and disagreed only on this one.
                insert_edge(
                    &mut edges,
                    GraphEdgeKind::RouteHandledBySymbol,
                    &route_node,
                    &symbol_id(&fact.file_path, "function", &fact.name),
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
                    GraphNodeKind::Callsite,
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
                    GraphEdgeKind::CallsiteReferencesSymbol,
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
                            GraphEdgeKind::CallsiteReferencesSymbol,
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
                        GraphEdgeKind::CallsiteReferencesSymbol,
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
                    let data_store_node = data_store_id(store_name);
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
                        GraphNodeKind::DataStore,
                        store_name,
                        true,
                        vec![evidence_id.clone()],
                        // Only `store_name`, which is the one key true of a merged node.
                        //
                        // `receiver_root` is gone with the id that embedded it, and `file_path` had
                        // to go with it: a table is reached from many files, and this key held
                        // whichever per-file batch merged last - `data_store:prisma:link` carried
                        // 143 evidence ids across 207 edges while reporting a single arbitrary call
                        // site as its `file_path`. The evidence ids are the honest answer to "where
                        // is this touched", and they accumulate correctly across batches.
                        BTreeMap::from([("store_name".to_string(), json!(store_name))]),
                    );
                    insert_node(
                        &mut nodes,
                        data_operation_node.clone(),
                        GraphNodeKind::DataOperation,
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
                        "read" => GraphEdgeKind::DataOperationReadsDataStore,
                        "delete" => GraphEdgeKind::DataOperationDeletesDataStore,
                        "unknown" => GraphEdgeKind::DataOperationTouchesDataStore,
                        _ => GraphEdgeKind::DataOperationWritesDataStore,
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
            "data_model_declared" => {
                // A declared table, grounding the same node usage infers.
                //
                // `data_store` nodes are otherwise built purely from call sites: `prisma.link.x()`
                // implies a `link` store. That infers tables from evidence of use, which is both
                // incomplete (a declared-but-unused table has no node) and imprecise - on calcom it
                // invented stores called `nullable()`, `array()` and `unwrap()`, because
                // `is_data_access_reference` matches "prisma" against the import SOURCE and calcom
                // imports Zod helpers from `@calcom/prisma/zod-utils`, so `schema.nullable().parse()`
                // read as a data operation. Measured: the declared set separates all 10 such false
                // positives from all 68 real tables, with no false negatives.
                //
                // Deliberately NOT a new node or edge kind. Both kind enums are closed and
                // fail-closed - an unknown kind aborts the whole scan transaction at
                // `GraphNodeSchema.parse` - whereas node metadata is an open record that accepts
                // new keys with no schema change. Reusing `data_store` with the same id also means
                // the existing merge does the reconciliation for free: `mergeGraphNodesById` unions
                // evidence ids across batches, so a table that is both declared and used ends up
                // with one node carrying both. Same shape as `file` and `file_role:*` nodes, which
                // already have two producers each.
                //
                // The accessor form is the join key: Prisma declares `model Link`, the client
                // exposes `prisma.link`, so the id is built from the decapitalised name.
                let accessor = accessor_name(&fact.name);
                insert_node(
                    &mut nodes,
                    data_store_id(&accessor),
                    GraphNodeKind::DataStore,
                    &accessor,
                    true,
                    vec![evidence_id.clone()],
                    // Keys disjoint from the usage side's `store_name`, because scalar metadata is
                    // last-writer-wins across batches. Nothing multi-valued belongs here either:
                    // the merge spreads objects and would replace an array rather than union it.
                    BTreeMap::from([
                        ("store_name".to_string(), json!(accessor)),
                        ("declared".to_string(), json!(true)),
                        ("declared_model".to_string(), json!(fact.name)),
                        ("declared_in".to_string(), json!(fact.file_path)),
                    ]),
                );
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
    kind: GraphNodeKind,
    label: &str,
    stable: bool,
    evidence_ids: Vec<String>,
    metadata: BTreeMap<String, serde_json::Value>,
) {
    nodes.insert(
        id.clone(),
        GraphNode {
            id,
            kind,
            label: label.to_string(),
            stable,
            evidence_ids,
            metadata,
        },
    );
}

fn insert_edge(
    edges: &mut BTreeMap<String, GraphEdge>,
    kind: GraphEdgeKind,
    from: &str,
    to: &str,
    evidence_ids: Vec<String>,
    metadata: BTreeMap<String, serde_json::Value>,
) {
    // The edge id embeds the wire name, which is what it embedded before this became an enum -
    // changing it would rewrite every stored edge id for no reason.
    let id = format!("edge:{from}:{}:{to}", kind.as_wire());
    edges.insert(
        id.clone(),
        GraphEdge {
            id,
            kind,
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

/// `Link` -> `link`, `YearInReview` -> `yearInReview`: a Prisma model name as the client exposes it.
///
/// This is the join key between what a schema declares and what code calls. Only the first
/// character changes; Prisma preserves the rest of the model name on the client accessor.
#[cfg(test)]
mod accessor_name_tests {
    use super::accessor_name;

    /// The join key between a declared model and the client accessor code calls.
    #[test]
    fn decapitalises_only_the_first_character() {
        assert_eq!(accessor_name("Link"), "link");
        assert_eq!(accessor_name("YearInReview"), "yearInReview");
        // Prisma keeps the rest of the name verbatim, including embedded capitals and underscores.
        assert_eq!(accessor_name("jackson_store"), "jackson_store");
        assert_eq!(accessor_name("OAuthApp"), "oAuthApp");
        assert_eq!(accessor_name(""), "");
    }
}

fn accessor_name(model_name: &str) -> String {
    let mut characters = model_name.chars();
    match characters.next() {
        Some(first) => first.to_lowercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

/// A logical table, identified by the table alone.
///
/// The id used to be namespaced by the JavaScript client variable
/// (`data_store:{receiver_root}:{store_name}`), which is neither necessary nor sufficient:
///
/// - Not necessary. On dub the three "clients" are one database. `prismaOld` is a literal alias -
///   `import { prisma, prisma as prismaOld }` - and the second datasource it appears to name exists
///   only inside a block comment; `DATABASE_URL_OLD` occurs exactly once in the repo, on that
///   commented line. All ten `data_store:prismaOld:*` nodes were duplicates of a `prisma` node.
/// - Not sufficient. On calcom two genuinely different datasources (postgres and sqlite) are BOTH
///   reached through a variable named `prisma`, so the qualified id already merged two databases
///   into one node. Dropping the qualifier forfeits no separation that existed.
///
/// Measured on dub: 87 nodes for 71 distinct tables before, 71 after, with all 2,119
/// `DATA_OPERATION_*` edges preserved - a merge cannot collapse edges, because an edge id embeds
/// its endpoints and one data_operation has exactly one receiver.
///
/// The client variable is NOT lost: `receiver_root` stays on the `data_operation` node, which is
/// where it is real and where waiver scoping reads it (`run-check.ts`, dataStores filtering).
/// Distinguishing two databases properly would require the datasource behind the resolved client
/// import, which the schema reader deliberately does not extract.
fn data_store_id(store_name: &str) -> String {
    format!("data_store:{store_name}")
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

fn build_resolver_context(
    repo_root: &Path,
    files: &[PathBuf],
    diagnostics: &mut Vec<EngineDiagnostic>,
) -> ResolverContext {
    let (path_aliases, base_urls) = read_js_ts_config_resolution(repo_root, files);
    ResolverContext {
        snapshot_paths: files.iter().map(|file| normalize_path(file)).collect(),
        path_aliases,
        package_imports: read_package_imports(repo_root),
        base_urls,
        packages: read_workspace_packages(repo_root, diagnostics),
        exported_symbols: BTreeMap::new(),
        export_star_sources: BTreeMap::new(),
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

/// S1-05 (E-5): per file, the specifiers of its flattening `export * from "m"` statements in
/// declaration order. `export * as ns` re-exports carry the namespace name (never `"*"`) in
/// their fact, so they are excluded here by construction.
fn export_star_sources_by_file(
    scanned: &[(ScannedFile, Vec<EngineFact>)],
) -> BTreeMap<String, Vec<String>> {
    let mut sources = BTreeMap::<String, Vec<String>>::new();
    for (file, facts) in scanned {
        for fact in facts {
            if fact.kind != "re_export_used" || fact.name != "*" {
                continue;
            }
            let Some(spec) = &fact.value else {
                continue;
            };
            let entry = sources.entry(file.file_path.clone()).or_default();
            if !entry.contains(spec) {
                entry.push(spec.clone());
            }
        }
    }
    sources
}

/// Outcome of resolving an imported symbol against a module's exports, following
/// flattening `export *` chains (S1-05 / E-5).
struct ImportSymbolResolution {
    /// The file that actually declares the symbol, when found (the entry file itself or a
    /// file reached through its `export *` chain).
    declaring_file: Option<String>,
    /// Whether the export set is fully known: every transitive `export *` target resolved
    /// to an in-repo file. When a chain leads out of the repo (e.g. `export * from
    /// "drizzle-orm"`) the symbol may come from there, so absence is NOT provable and the
    /// conservative diagnostic must stay silent.
    chain_closed: bool,
}

fn resolve_import_symbol(
    imported_name: &str,
    resolved_file_path: &str,
    resolver: &ResolverContext,
) -> ImportSymbolResolution {
    if imported_name == "*" {
        return ImportSymbolResolution {
            declaring_file: None,
            chain_closed: false,
        };
    }
    // Breadth-first in declaration order, so the nearest declaration wins and traversal is
    // deterministic when a symbol is reachable through more than one chain.
    let mut visited = BTreeSet::new();
    let mut queue = vec![resolved_file_path.to_string()];
    let mut chain_closed = true;
    let mut index = 0;
    while index < queue.len() {
        let file = queue[index].clone();
        index += 1;
        if !visited.insert(file.clone()) {
            continue;
        }
        if resolver
            .exported_symbols
            .get(&file)
            .is_some_and(|exports| exports.contains(imported_name))
        {
            return ImportSymbolResolution {
                declaring_file: Some(file),
                chain_closed,
            };
        }
        for spec in resolver
            .export_star_sources
            .get(&file)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            match resolve_import(&file, spec, resolver) {
                Some(target) => queue.push(target),
                // The star target is outside the snapshot (external package or
                // unresolvable): the export set is open-ended.
                None => chain_closed = false,
            }
        }
    }
    ImportSymbolResolution {
        declaring_file: None,
        chain_closed,
    }
}

fn resolved_import_symbol_name(
    imported_name: &str,
    resolved_file_path: &str,
    resolver: &ResolverContext,
) -> Option<String> {
    resolve_import_symbol(imported_name, resolved_file_path, resolver)
        .declaring_file
        .map(|_| imported_name.to_string())
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

fn should_report_unresolved_import(
    from_file: &str,
    source: &str,
    resolver: &ResolverContext,
) -> bool {
    // E-4: classification is scope-aware — an alias declared in apps/web must not make an
    // import in apps/dashboard look local (openstatus's apps/web declares a match-all `*`
    // path; unscoped, it reclassified `next/server` repo-wide from external to unresolved).
    source.starts_with('.')
        || resolver.path_aliases.iter().any(|alias| {
            scope_contains(&alias.scope, from_file)
                && alias_pattern_signals_local(&alias.pattern)
                && alias_matches(&alias.pattern, source)
        })
        || resolver
            .packages
            .keys()
            .any(|name| source == name || source.starts_with(&format!("{name}/")))
        || resolver
            .package_imports
            .iter()
            .any(|package_import| alias_matches(&package_import.pattern, source))
        || base_url_import_may_be_local(from_file, source, resolver)
}

/// A match-all `*` paths pattern (`"*": ["./*"]`) matches every specifier, so a match is no
/// evidence the import is local: tsc itself falls back to normal node_modules resolution
/// when the mapped path misses. Such patterns still participate in resolution (a hit is a
/// hit) — they just cannot flag a miss as `unresolved`.
fn alias_pattern_signals_local(pattern: &str) -> bool {
    pattern != "*"
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
    // E-4 precedence, explicit: of the aliases whose scope governs the importing file AND
    // whose pattern matches, only those from the DEEPEST such scope contribute — the config
    // nearest the importing file wins over the root, and a nested alias never leaks to
    // sibling directories. Shallower scopes apply only when no deeper scope has a matching
    // pattern.
    let mut matching_aliases: Vec<&PathAlias> = resolver
        .path_aliases
        .iter()
        .filter(|alias| {
            scope_contains(&alias.scope, from_file) && alias_matches(&alias.pattern, source)
        })
        .collect();
    if let Some(deepest) = matching_aliases.iter().map(|alias| alias.scope.len()).max() {
        matching_aliases.retain(|alias| alias.scope.len() == deepest);
        for alias in matching_aliases {
            let captured = alias_capture(&alias.pattern, source);
            for target in &alias.targets {
                bases.push(target.replace('*', &captured).replace('\\', "/"));
            }
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
        let mut applicable: Vec<&ScopedBaseUrl> = resolver
            .base_urls
            .iter()
            .filter(|entry| scope_contains(&entry.scope, from_file))
            .collect();
        // Nearest baseUrl's candidates first, for the same reason as alias precedence.
        applicable.sort_by_key(|entry| std::cmp::Reverse(entry.scope.len()));
        for entry in applicable {
            bases.push(join_repo_path(&entry.base_url, source));
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

fn base_url_import_may_be_local(from_file: &str, source: &str, resolver: &ResolverContext) -> bool {
    if resolver.base_urls.is_empty() || !is_base_url_import(source) {
        return false;
    }
    let Some(first_segment) = source.split('/').next() else {
        return false;
    };
    resolver.base_urls.iter().any(|entry| {
        if !scope_contains(&entry.scope, from_file) {
            return false;
        }
        let local_prefix = join_repo_path(&entry.base_url, first_segment);
        resolver
            .snapshot_paths
            .iter()
            .any(|path| path == &local_prefix || path.starts_with(&format!("{local_prefix}/")))
    })
}

fn read_js_ts_config_resolution(
    repo_root: &Path,
    files: &[PathBuf],
) -> (Vec<PathAlias>, Vec<ScopedBaseUrl>) {
    // S1-04 Gap 3 (E-4): configs used to be read at the repo root only, so dub's
    // apps/web/tsconfig.json (`@/lib/*`) was never seen — dub has no root tsconfig at all.
    // Discover configs in the root and in every directory that is an ancestor of an indexed
    // file; only in-repo configuration is consulted (determinism, per T102's precedent).
    let mut config_dirs = BTreeSet::<String>::new();
    config_dirs.insert(String::new());
    for file in files {
        let mut ancestor = Path::new(file).parent();
        while let Some(dir) = ancestor {
            let normalized = normalize_path(dir);
            if normalized.is_empty() || !config_dirs.insert(normalized) {
                // Reached the root, or this ancestor chain is already recorded.
                break;
            }
            ancestor = dir.parent();
        }
    }

    let mut aliases_by_scope_pattern = BTreeMap::<(String, String), Vec<String>>::new();
    let mut base_urls = Vec::<ScopedBaseUrl>::new();
    for scope in &config_dirs {
        for config_name in ["tsconfig.json", "jsconfig.json"] {
            let config_path = if scope.is_empty() {
                PathBuf::from(config_name)
            } else {
                Path::new(scope).join(config_name)
            };
            if !repo_root.join(&config_path).is_file() {
                continue;
            }
            let config =
                read_js_ts_config_file(repo_root, &config_path, &mut BTreeSet::<String>::new());
            let Some(config) = config else {
                continue;
            };
            // `read_js_ts_config_file` already resolved `paths` targets and `baseUrl`
            // relative to the DECLARING config's directory (its `effective_base_url`),
            // including through `extends` chains — the scope only governs which files the
            // alias applies to.
            for (pattern, targets) in config.aliases {
                aliases_by_scope_pattern.insert((scope.clone(), pattern), targets);
            }
            if let Some(base_url) = config.base_url
                && !base_urls
                    .iter()
                    .any(|entry| &entry.scope == scope && entry.base_url == base_url)
            {
                base_urls.push(ScopedBaseUrl {
                    scope: scope.clone(),
                    base_url,
                });
            }
        }
    }
    let aliases = aliases_by_scope_pattern
        .into_iter()
        .map(|((scope, pattern), targets)| PathAlias {
            scope,
            pattern,
            targets,
        })
        .collect();
    (aliases, base_urls)
}

/// Does an alias/baseUrl declared at `scope` govern `file_path`? The root scope (`""`)
/// governs everything; a nested scope governs only files strictly under it.
fn scope_contains(scope: &str, file_path: &str) -> bool {
    scope.is_empty() || file_path.starts_with(&format!("{scope}/"))
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
                scope: String::new(),
                pattern: pattern.to_string(),
                targets: vec![normalize_repo_string(target.trim_start_matches("./"))],
            })
        })
        .collect()
}

fn read_workspace_packages(
    repo_root: &Path,
    diagnostics: &mut Vec<EngineDiagnostic>,
) -> BTreeMap<String, WorkspacePackage> {
    let mut packages = BTreeMap::new();
    let mut globs: Vec<(String, &'static str)> = Vec::new();
    if let Ok(contents) = fs::read_to_string(repo_root.join("package.json"))
        && let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents)
    {
        for glob in json
            .get("workspaces")
            .and_then(workspace_globs)
            .unwrap_or_default()
        {
            globs.push((glob, "package.json"));
        }
    }
    // S1-04 Gap 1 (E-2): pnpm monorepos declare workspaces in pnpm-workspace.yaml, often
    // with no package.json#workspaces at all (formbricks, dub). Union both sources.
    for glob in read_pnpm_workspace_globs(repo_root) {
        if !globs.iter().any(|(existing, _)| existing == &glob) {
            globs.push((glob, "pnpm-workspace.yaml"));
        }
    }

    for (glob, declared_in) in globs {
        for package_dir in workspace_package_dirs(repo_root, &glob, declared_in, diagnostics) {
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

/// Candidate package directories for one workspace glob. S1-04 Gap 2 (E-3): previously only
/// `<prefix>/*` was honoured and everything else was silently dropped — openstatus's
/// `packages/**/*` and cal.com's literal `packages/app-store` never produced a package. A
/// shape this function cannot interpret now emits `unsupported_workspace_glob` rather than
/// vanishing: a silently-ignored workspace glob is how Gap 2 stayed invisible.
fn workspace_package_dirs(
    repo_root: &Path,
    glob: &str,
    declared_in: &str,
    diagnostics: &mut Vec<EngineDiagnostic>,
) -> Vec<PathBuf> {
    let has_glob_chars = |value: &str| value.contains(['*', '?', '[', ']', '{', '}', '!']);
    let unsupported = |diagnostics: &mut Vec<EngineDiagnostic>, detail: &str| {
        diagnostics.push(EngineDiagnostic {
            severity: "warning".to_string(),
            code: "unsupported_workspace_glob".to_string(),
            message: format!(
                "Workspace glob {glob} in {declared_in} is not supported by the resolver ({detail}); packages it names will not resolve."
            ),
            file_path: Some(declared_in.to_string()),
            import_source: None,
        });
    };

    if let Some(pattern) = glob.strip_prefix('!') {
        // Exclusions only ever remove packages; not applying one can over-include, never
        // silently drop, but it must still be visible.
        let _ = pattern;
        unsupported(diagnostics, "exclusion patterns are not applied");
        return Vec::new();
    }
    if let Some(prefix) = glob
        .strip_suffix("/**/*")
        .or_else(|| glob.strip_suffix("/**"))
    {
        if !has_glob_chars(prefix) {
            let mut dirs = Vec::new();
            collect_descendant_dirs(&repo_root.join(prefix), 0, &mut dirs);
            return dirs;
        }
    } else if let Some(prefix) = glob.strip_suffix("/*") {
        if !has_glob_chars(prefix) {
            let Ok(entries) = fs::read_dir(repo_root.join(prefix)) else {
                return Vec::new();
            };
            return entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect();
        }
    } else if !has_glob_chars(glob) {
        // A literal entry (`packages/app-store`, `docker`, `apps/web/.react-email`).
        let dir = repo_root.join(glob);
        return if dir.is_dir() { vec![dir] } else { Vec::new() };
    }
    unsupported(diagnostics, "glob shape not recognised");
    Vec::new()
}

/// Every descendant directory (depth >= 1) under `root`, skipping `node_modules` and
/// dot-directories. Bounded so a pathological tree cannot stall the scan.
fn collect_descendant_dirs(root: &Path, depth: usize, dirs: &mut Vec<PathBuf>) {
    const MAX_WORKSPACE_GLOB_DEPTH: usize = 8;
    if depth >= MAX_WORKSPACE_GLOB_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "node_modules" || name.starts_with('.') {
            continue;
        }
        dirs.push(path.clone());
        collect_descendant_dirs(&path, depth + 1, dirs);
    }
}

fn read_pnpm_workspace_globs(repo_root: &Path) -> Vec<String> {
    let Ok(contents) = fs::read_to_string(repo_root.join("pnpm-workspace.yaml")) else {
        return Vec::new();
    };
    parse_pnpm_workspace_packages(&contents)
}

/// Minimal reader for the `packages:` block of `pnpm-workspace.yaml`. The block pnpm
/// documents is a flat sequence of scalar globs, so this is parsed directly rather than
/// through a YAML dependency: the shapes in the wild (quoted/unquoted scalars, trailing
/// comments, inline flow lists, unrelated sibling keys like `catalog:`/`allowBuilds:`) are
/// all covered, and no new dependency enters the scan path.
fn parse_pnpm_workspace_packages(contents: &str) -> Vec<String> {
    let mut globs = Vec::new();
    let mut in_packages = false;
    for raw_line in contents.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let is_top_level_key = !raw_line.starts_with([' ', '\t'])
            && !trimmed.starts_with('-')
            && trimmed.contains(':');
        if is_top_level_key {
            in_packages = false;
            if let Some(rest) = trimmed.strip_prefix("packages:") {
                let rest = rest.trim();
                if rest.is_empty() {
                    in_packages = true;
                } else if let Some(list) = rest
                    .strip_prefix('[')
                    .and_then(|list| list.strip_suffix(']'))
                {
                    for item in list.split(',') {
                        if let Some(glob) = yaml_scalar(item) {
                            push_unique(&mut globs, glob);
                        }
                    }
                }
            }
            continue;
        }
        if in_packages
            && let Some(item) = trimmed.strip_prefix('-')
            && let Some(glob) = yaml_scalar(item)
        {
            push_unique(&mut globs, glob);
        }
    }
    globs
}

/// A YAML scalar as pnpm workspace globs use them: optionally quoted, with an optional
/// trailing comment. Exclusion patterns (`!dir`) are returned as written; the glob layer
/// decides what to do with them.
fn yaml_scalar(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        let scalar = rest.split('"').next().unwrap_or("");
        return (!scalar.is_empty()).then(|| scalar.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix('\'') {
        let scalar = rest.split('\'').next().unwrap_or("");
        return (!scalar.is_empty()).then(|| scalar.to_string());
    }
    let unquoted = trimmed.split(" #").next().unwrap_or("").trim();
    (!unquoted.is_empty()).then(|| unquoted.to_string())
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

#[cfg(test)]
mod resolver_config_tests {
    use super::parse_pnpm_workspace_packages;

    #[test]
    fn parses_quoted_unquoted_comments_and_sibling_keys() {
        let yaml = r#"# header comment
packages:
  - "packages/*"
  - apps/* # trailing comment
  - 'docker'

allowBuilds:
  "@prisma/engines": true
catalog:
  react: 19.0.0
"#;
        assert_eq!(
            parse_pnpm_workspace_packages(yaml),
            vec!["packages/*", "apps/*", "docker"]
        );
    }

    #[test]
    fn parses_inline_flow_list() {
        assert_eq!(
            parse_pnpm_workspace_packages("packages: [\"apps/*\", packages/*]\n"),
            vec!["apps/*", "packages/*"]
        );
    }

    #[test]
    fn sibling_sequences_are_not_packages() {
        let yaml = "onlyBuiltDependencies:\n  - esbuild\npackages:\n  - packages/*\nother:\n  - not-a-glob\n";
        assert_eq!(parse_pnpm_workspace_packages(yaml), vec!["packages/*"]);
    }

    #[test]
    fn missing_packages_block_yields_nothing() {
        assert!(parse_pnpm_workspace_packages("catalog:\n  react: 19.0.0\n").is_empty());
    }
}
