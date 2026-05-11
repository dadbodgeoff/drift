use std::{
    env, fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

use drift_engine::{Fact, FactKind, extract_typescript_facts, should_index_path};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
struct ScanRepoOutput {
    engine_version: String,
    files: Vec<ScannedFile>,
    facts: Vec<EngineFact>,
}

#[derive(Debug, Serialize)]
struct ScannedFile {
    file_path: String,
    content_hash: String,
    byte_size: u64,
}

#[derive(Debug, Serialize)]
struct EngineFact {
    kind: String,
    file_path: String,
    name: String,
    value: Option<String>,
    start_line: usize,
    end_line: usize,
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
            let repo_root = args
                .next()
                .ok_or("missing repo root for scan-repo")?;
            let output = scan_repo(Path::new(&repo_root))?;
            println!("{}", serde_json::to_string_pretty(&output)?);
            Ok(())
        }
        _ => Err("usage: drift-engine scan-repo <repo-root>".into()),
    }
}

fn scan_repo(repo_root: &Path) -> Result<ScanRepoOutput, Box<dyn std::error::Error>> {
    let mut files = Vec::new();
    collect_indexable_files(repo_root, repo_root, &mut files)?;
    files.sort();

    let mut scanned_files = Vec::new();
    let mut facts = Vec::new();
    for file_path in files {
        let absolute_path = repo_root.join(&file_path);
        let source = fs::read_to_string(&absolute_path)?;
        let metadata = fs::metadata(&absolute_path)?;
        scanned_files.push(ScannedFile {
            file_path: normalize_path(&file_path),
            content_hash: hash_file(&absolute_path)?,
            byte_size: metadata.len(),
        });
        for fact in extract_typescript_facts(&file_path, &source)? {
            facts.push(engine_fact(fact));
        }
    }

    Ok(ScanRepoOutput {
        engine_version: drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        files: scanned_files,
        facts,
    })
}

fn collect_indexable_files(
    repo_root: &Path,
    dir: &Path,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(repo_root).unwrap_or(&path);
        if !should_index_path(relative) {
            continue;
        }

        if path.is_dir() {
            collect_indexable_files(repo_root, &path, files)?;
        } else if path.is_file() && is_typescript_path(&path) {
            files.push(relative.to_path_buf());
        }
    }
    Ok(())
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
    path.to_string_lossy().replace('\\', "/")
}
