pub const DRIFT_ENGINE_VERSION: &str = "0.1.0";

mod diff;
mod facts;
mod rules;

use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

pub use diff::{
    DiffClassifiedFinding, DiffFile, DiffScope, DiffStatus, ParsedDiff,
    classify_findings_against_diff, parse_unified_diff,
};
pub use facts::{Fact, FactExtractError, FactKind, extract_typescript_facts};
pub use rules::{
    BaselineStatus, BaselineViolation, ClassifiedFinding, DirectDataAccessRule,
    DirectDataAccessViolation, EnforcementMode, EnforcementResult, FindingStatus, RuleFinding,
    Severity, classify_findings_against_baseline, detect_direct_data_access_imports,
    materialize_direct_data_access_findings,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

const SKIPPED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "target",
    "vendor",
];

const SKIPPED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "pem", "key", "crt",
];

pub fn should_index_path(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    let normalized = path.to_string_lossy();

    if normalized.starts_with(".env") || normalized.contains("/.env") {
        return false;
    }

    if path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .any(|part| SKIPPED_DIRS.contains(&part))
    {
        return false;
    }

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| SKIPPED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
    {
        return false;
    }

    true
}

pub fn fingerprint_file(path: impl AsRef<Path>) -> io::Result<FileFingerprint> {
    let path = path.as_ref();
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        hasher.update(&buffer[..read]);
    }

    Ok(FileFingerprint {
        path: normalize_path(path),
        bytes,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn normalize_path(path: &Path) -> String {
    PathBuf::from(path).to_string_lossy().replace('\\', "/")
}
