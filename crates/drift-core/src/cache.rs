//! Content-addressed cache for per-file facts.
//!
//! Facts produced by a language parser depend only on a file's bytes and the
//! parser version, so they are keyed by `(schema, parser, content hash)`.
//! Entries are immutable: a changed file gets a new key, unchanged files cost
//! nothing on the next scan, and CI can restore the directory as-is.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::facts::FACTS_SCHEMA_VERSION;

#[derive(Debug, Clone)]
pub struct FactCache {
    dir: PathBuf,
}

impl FactCache {
    /// `parser_tag` identifies the parser and its version (e.g. `ts-0.1.0`).
    pub fn new(root_cache_dir: &Path, parser_tag: &str) -> Self {
        let dir = root_cache_dir
            .join(format!("facts-v{FACTS_SCHEMA_VERSION}"))
            .join(parser_tag);
        Self { dir }
    }

    fn path_for(&self, hash: &str) -> Option<PathBuf> {
        if hash.len() < 4 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        Some(self.dir.join(&hash[..2]).join(format!("{hash}.json")))
    }

    pub fn get<T: DeserializeOwned>(&self, hash: &str) -> Option<T> {
        let p = self.path_for(hash)?;
        let bytes = fs::read(p).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// Best effort: a failed write only costs a re-parse next time.
    pub fn put<T: Serialize>(&self, hash: &str, value: &T) {
        let Some(p) = self.path_for(hash) else { return };
        if p.exists() {
            return;
        }
        let Some(parent) = p.parent() else { return };
        if fs::create_dir_all(parent).is_err() {
            return;
        }
        let Ok(bytes) = serde_json::to_vec(value) else {
            return;
        };
        // Write to a temp file then rename, so concurrent agents never see a torn entry.
        let tmp = format!(".{}.{}.tmp", &hash[..8], std::process::id());
        let _ = crate::fsutil::write_atomic(&p, &tmp, &bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_bad_keys() {
        let dir = tempfile::tempdir().unwrap();
        let c = FactCache::new(dir.path(), "test");
        let h = crate::ingest::hash_bytes(b"x");
        assert!(c.get::<Vec<u32>>(&h).is_none());
        c.put(&h, &vec![1u32, 2, 3]);
        assert_eq!(c.get::<Vec<u32>>(&h), Some(vec![1, 2, 3]));
        c.put("../../etc", &vec![1u32]);
        assert!(c.get::<Vec<u32>>("../../etc").is_none());
    }
}
