//! Results derived from the facts of the whole repository, kept on disk between
//! processes: the practice map with every unit, the keys of the security inventory,
//! the cards mining finds for `drift card`, the index of the search hints.
//!
//! Every hook is a process of its own, and a turn asks the same question of the same
//! code more than once: the PostToolUse of a file with entry points builds the
//! practice map, and the Stop that follows builds it again to say what still stands;
//! `drift check` builds it once more; `drift card` mines the repository for each file
//! asked about. A result kept here is read back instead of computed when, and only
//! when, it was computed from the same inputs.
//!
//! # The key
//!
//! A result is a function of the facts and of a few values read beside them. Its key
//! is a BLAKE3 digest of all of them, as they are in this process at the moment the
//! result is asked for:
//!
//! - the facts themselves ([`facts_digest`]: every file's facts as scanned and linked,
//!   which hold the file's content hash, and the repository-level facts). Not the
//!   inputs of the scan: the scan runs first, every time, and what it returns is what
//!   is digested. An edit that changes any fact of any file changes the key;
//! - the Drift build: its version, its build commit, and the size and modification
//!   time of the running executable (a rebuilt binary computes afresh);
//! - every `DRIFT_*` environment variable and the experimental switches in effect;
//! - what the caller names for the result (`more`): the options the practice map is
//!   built with, the deployment boundary the inventory reads, the file kinds, accepted
//!   rules and switches mining is run with. The values handed to the computation, not
//!   the files they were read from.
//!
//! So there is nothing to invalidate: a key names one answer. A stale answer would
//! take an input the key leaves out; the list above is every input the computations
//! have.
//!
//! # The files
//!
//! `<cache>/derived-v1/<kind>-<key>.json`, beside the fact cache (and under the same
//! rules: not through a link, not when git tracks the directory, see
//! [`crate::project::cache_dir`]). Each holds its own key and the value. Written to a
//! temp file and renamed, so two hooks running at once never see a torn file, and
//! the one that renames last leaves a file equal to the other's. A file that cannot
//! be read, does not parse, or holds another key is not used: the result is computed
//! and the file replaced. Nothing here returns an error or panics: a hook answers
//! whatever state the directory is in.
//!
//! Before a value is written it is read back from its own bytes and compared: a value
//! that does not come back equal (a float that does not survive JSON) is not kept. It
//! is written whole, with the fields that are in process only and no output shows
//! ([`drift_mine::in_process`]): what is read back stands in for the computation.
//!
//! The directory keeps the newest [`KEPT`] files of each kind; a write removes the
//! others.

use std::path::{Path, PathBuf};

use drift_core::RepoFacts;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// The directory under the cache directory. Bump with the layout of the files or the
/// make-up of the key.
const DIR: &str = "derived-v1";

/// Files kept of each kind: the states of the tree a turn goes through.
const KEPT: usize = 6;

/// A temp file older than this was left by a writer that died before its rename.
const TMP_MAX_AGE_SECS: u64 = 3600;

/// The largest file read back (the practice map of a large monorepo is a few MB).
const MAX_BYTES: u64 = 256 * 1024 * 1024;

/// The practice map with every unit listed ([`crate::practices::report_units_kept`]).
pub const PRACTICES: &str = "practices";
/// The keys of the security inventory ([`drift_mine::introduced::security_keys`]).
pub const SECURITY_KEYS: &str = "security-keys";
/// What mining finds for `drift card` ([`crate::card::regularities`]).
pub const MINED: &str = "mined";
/// The index of the search hints and the structure brief
/// ([`crate::lookup::HintIndex::build`]), which SessionStart builds from the whole
/// security inventory.
pub const HINT_INDEX: &str = "hint-index";

/// The kept results of one set of facts.
pub struct Derived {
    dir: PathBuf,
    /// Everything of the key but the kind and what the caller adds.
    base: blake3::Hasher,
}

#[derive(Serialize)]
struct EntryRef<'a, T> {
    key: &'a str,
    value: &'a T,
}

#[derive(Deserialize)]
struct Entry<T> {
    key: String,
    value: T,
}

/// A digest of `facts`: equal for equal facts, on any machine and with any number of
/// threads. Each file's facts are digested on their own (side by side), then the
/// digests in the facts' order with everything else the facts hold.
pub fn facts_digest(facts: &RepoFacts) -> blake3::Hash {
    // Named one by one: a field added to the facts does not compile until it is here.
    let RepoFacts {
        schema_version,
        files,
        skipped,
        models,
        packages,
        lint,
        context_files,
        key_files,
        integration_files,
        generated_clients,
        listed_files,
        listed_skipped,
    } = facts;
    let of_files = |files: &[drift_core::FileFacts]| -> Vec<blake3::Hash> {
        let mut buf = Vec::new();
        files
            .iter()
            .map(|f| {
                buf.clear();
                // Writing JSON into memory does not fail.
                let _ = serde_json::to_writer(&mut buf, f);
                blake3::hash(&buf)
            })
            .collect()
    };
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get().min(8));
    let chunk = files.len().div_ceil(threads).max(1);
    let per_file: Vec<Vec<blake3::Hash>> = std::thread::scope(|s| {
        let mut chunks = files.chunks(chunk);
        let first = chunks.next();
        let of_files = &of_files;
        let started: Vec<_> = chunks
            .map(|c| {
                let thread = std::thread::Builder::new().spawn_scoped(s, move || of_files(c));
                (c, thread.ok())
            })
            .collect();
        let mut out = vec![first.map(of_files).unwrap_or_default()];
        for (c, thread) in started {
            out.push(match thread.map(|t| t.join()) {
                Some(Ok(digests)) => digests,
                // No thread could be started, or it failed: here.
                _ => of_files(c),
            });
        }
        out
    });
    let mut h = blake3::Hasher::new();
    h.update(b"drift facts 1\0");
    h.update(&schema_version.to_le_bytes());
    h.update(&(files.len() as u64).to_le_bytes());
    for d in per_file.iter().flatten() {
        h.update(d.as_bytes());
    }
    let rest = serde_json::to_vec(&(
        skipped,
        models,
        packages,
        lint,
        context_files,
        key_files,
        integration_files,
    ))
    .unwrap_or_default();
    h.update(&rest);
    // Where there are none the digest is what it was before the facts held them.
    if !generated_clients.is_empty() {
        h.update(b"generated clients\0");
        h.update(&serde_json::to_vec(generated_clients).unwrap_or_default());
    }
    if !listed_files.is_empty() || !listed_skipped.is_empty() {
        h.update(b"listed files\0");
        for d in of_files(listed_files) {
            h.update(d.as_bytes());
        }
        h.update(&serde_json::to_vec(listed_skipped).unwrap_or_default());
    }
    h.finalize()
}

/// One part of a key: its length, then its bytes, so no two lists of parts make the
/// same stream.
fn part(h: &mut blake3::Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

/// The size and modification time of the running executable: what tells one build
/// from another when both say the same version. `None` when it cannot be read.
fn executable_stamp() -> Option<(u64, u128)> {
    let meta = std::fs::metadata(std::env::current_exe().ok()?).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some((meta.len(), modified))
}

impl Derived {
    /// The kept results of `facts`, in `cache_dir` (the fact cache's directory; none:
    /// the cache is off). `None` when nothing may be kept: no cache directory, or the
    /// running executable cannot be told from another build.
    pub fn of(cache_dir: Option<PathBuf>, facts: &RepoFacts) -> Option<Self> {
        let dir = cache_dir?.join(DIR);
        let (size, modified) = executable_stamp()?;
        let mut base = blake3::Hasher::new();
        part(&mut base, b"drift derived 1");
        part(&mut base, env!("CARGO_PKG_VERSION").as_bytes());
        part(
            &mut base,
            option_env!("DRIFT_BUILD_COMMIT").unwrap_or("").as_bytes(),
        );
        part(&mut base, &size.to_le_bytes());
        part(&mut base, &modified.to_le_bytes());
        part(&mut base, facts_digest(facts).as_bytes());
        part(
            &mut base,
            &[u8::from(drift_mine::workspace::intra_package_layering())],
        );
        // Every switch a person or a test sets from outside (sorted, as bytes).
        let mut vars: Vec<(std::ffi::OsString, std::ffi::OsString)> = std::env::vars_os()
            .filter(|(k, _)| k.as_encoded_bytes().starts_with(b"DRIFT_"))
            .collect();
        vars.sort();
        part(&mut base, &(vars.len() as u64).to_le_bytes());
        for (k, v) in &vars {
            part(&mut base, k.as_encoded_bytes());
            part(&mut base, v.as_encoded_bytes());
        }
        Some(Self { dir, base })
    }

    fn key(&self, kind: &str, more: &[u8]) -> String {
        let mut h = self.base.clone();
        part(&mut h, kind.as_bytes());
        part(&mut h, more);
        h.finalize().to_hex().to_string()
    }

    fn path(&self, kind: &str, key: &str) -> PathBuf {
        self.dir.join(format!("{kind}-{}.json", &key[..32]))
    }

    /// The value of `kind` kept for these facts and `more`, if one is: its file reads,
    /// parses and holds this key.
    pub fn get<T: DeserializeOwned>(&self, kind: &str, more: &[u8]) -> Option<T> {
        let key = self.key(kind, more);
        let bytes = drift_core::fsutil::read_regular(&self.path(kind, &key), MAX_BYTES).ok()?;
        let entry: Entry<T> = serde_json::from_slice(&bytes).ok()?;
        (entry.key == key).then_some(entry.value)
    }

    /// Keep `value` as the value of `kind` for these facts and `more`. Best effort: a
    /// value that does not read back equal, or a directory that cannot be written,
    /// only costs the computation next time.
    pub fn put<T: Serialize + DeserializeOwned + PartialEq>(
        &self,
        kind: &str,
        more: &[u8],
        value: &T,
    ) {
        let key = self.key(kind, more);
        let path = self.path(kind, &key);
        // Whole: with the fields no output shows ([`drift_mine::in_process`]), or a
        // value that has one would never read back equal, and never be kept.
        let Ok(bytes) =
            drift_mine::in_process::whole(|| serde_json::to_vec(&EntryRef { key: &key, value }))
        else {
            return;
        };
        // What a reader will get must be what was computed.
        if !serde_json::from_slice::<Entry<T>>(&bytes).is_ok_and(|e| e.value == *value) {
            return;
        }
        // Never through a link a repository planted (see `project::cache_dir`).
        if crate::project::link_under_drift(&path).is_some()
            || std::fs::create_dir_all(&self.dir).is_err()
        {
            return;
        }
        let tmp = format!(".{kind}-{}.{}.tmp", &key[..16], std::process::id());
        if drift_core::fsutil::write_atomic(&path, &tmp, &bytes).is_ok() {
            self.prune(kind, &path);
        }
    }

    /// The value of `kind` for these facts and `more`: the one kept, else `make`'s,
    /// which is then kept.
    pub fn get_or<T: Serialize + DeserializeOwned + PartialEq>(
        &self,
        kind: &str,
        more: &[u8],
        make: impl FnOnce() -> T,
    ) -> T {
        if let Some(v) = self.get(kind, more) {
            return v;
        }
        let v = make();
        self.put(kind, more, &v);
        v
    }

    /// Remove all but the newest [`KEPT`] files of `kind` (never `written`, the file
    /// just renamed into place), and temp files their writers left behind.
    fn prune(&self, kind: &str, written: &Path) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let prefix = format!("{kind}-");
        let mut of_kind: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
        for e in entries.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            let Ok(modified) = e.metadata().and_then(|m| m.modified()) else {
                continue;
            };
            if name.ends_with(".tmp") {
                if modified
                    .elapsed()
                    .is_ok_and(|age| age.as_secs() > TMP_MAX_AGE_SECS)
                {
                    let _ = std::fs::remove_file(e.path());
                }
            } else if name.starts_with(&prefix) && name.ends_with(".json") {
                of_kind.push((modified, e.path()));
            }
        }
        // Newest first; by name among equal times, so every process agrees.
        of_kind.sort_by(|a, b| b.cmp(a));
        for (_, p) in of_kind.into_iter().skip(KEPT) {
            if p != written {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

/// [`Derived::get_or`] where results may be kept, else `make`'s value.
pub fn get_or<T: Serialize + DeserializeOwned + PartialEq>(
    derived: Option<&Derived>,
    kind: &str,
    more: &[u8],
    make: impl FnOnce() -> T,
) -> T {
    match derived {
        Some(d) => d.get_or(kind, more, make),
        None => make(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{FileFacts, Symbol};

    fn facts(n: usize) -> RepoFacts {
        RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: (0..n)
                .map(|i| FileFacts {
                    path: format!("src/f{i:03}.ts"),
                    hash: format!("{i:064x}"),
                    symbols: vec![Symbol {
                        name: format!("f{i}"),
                        line: i as u32,
                        ..Symbol::default()
                    }],
                    ..FileFacts::default()
                })
                .collect(),
            ..RepoFacts::default()
        }
    }

    #[test]
    fn the_digest_is_of_every_fact_and_of_their_order() {
        let a = facts(40);
        assert_eq!(facts_digest(&a), facts_digest(&a.clone()));
        assert_eq!(facts_digest(&facts(0)), facts_digest(&facts(0)));
        let mut seen = std::collections::BTreeSet::new();
        seen.insert(facts_digest(&a).to_hex().to_string());
        // One fact of one file, anywhere in the list.
        for i in [0, 1, 19, 38, 39] {
            let mut b = a.clone();
            b.files[i].symbols[0].line += 1;
            assert!(seen.insert(facts_digest(&b).to_hex().to_string()), "{i}");
            let mut b = a.clone();
            b.files[i].hash = "0".repeat(63) + "f";
            assert!(seen.insert(facts_digest(&b).to_hex().to_string()), "{i}");
        }
        // The files' order, their number, and each repository-level fact.
        let mut b = a.clone();
        b.files.swap(3, 4);
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
        assert!(seen.insert(facts_digest(&facts(39)).to_hex().to_string()));
        assert!(seen.insert(facts_digest(&facts(41)).to_hex().to_string()));
        let mut b = a.clone();
        b.schema_version += 1;
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
        let mut b = a.clone();
        b.skipped.push(drift_core::Skipped {
            path: "src/big.ts".into(),
            reason: drift_core::SkipReason::TooLarge,
        });
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
        let mut b = a.clone();
        b.context_files.push(a.files[0].clone());
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
        let mut b = a.clone();
        b.integration_files.push(drift_core::FileRef {
            path: "integration/a.ts".into(),
            package: String::new(),
        });
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
        let mut b = a.clone();
        b.key_files.push(drift_core::KeyFile {
            path: ".env.example".into(),
            keys: vec![("A".into(), 1)],
        });
        assert!(seen.insert(facts_digest(&b).to_hex().to_string()));
    }

    #[test]
    fn a_value_is_kept_for_its_facts_its_kind_and_what_the_caller_adds() {
        let dir = tempfile::tempdir().unwrap();
        let cache = || Some(dir.path().to_path_buf());
        let a = facts(3);
        let d = Derived::of(cache(), &a).unwrap();
        assert_eq!(d.get::<Vec<u32>>("k", b""), None);
        let mut made = 0;
        let mut make = || {
            made += 1;
            vec![1u32, 2, 3]
        };
        assert_eq!(d.get_or("k", b"", &mut make), vec![1, 2, 3]);
        assert_eq!(d.get_or("k", b"", &mut make), vec![1, 2, 3]);
        // Another process, the same facts.
        let again = Derived::of(cache(), &a.clone()).unwrap();
        assert_eq!(again.get_or("k", b"", &mut make), vec![1, 2, 3]);
        assert_eq!(made, 1);
        // Another kind, another addition, other facts: each its own value.
        assert_eq!(d.get::<Vec<u32>>("other", b""), None);
        assert_eq!(d.get::<Vec<u32>>("k", b"x"), None);
        let other = Derived::of(cache(), &facts(4)).unwrap();
        assert_eq!(other.get::<Vec<u32>>("k", b""), None);
        // No cache directory: nothing is kept, and the value is made.
        assert!(Derived::of(None, &a).is_none());
        assert_eq!(get_or(None, "k", b"", || 7u32), 7);
    }

    #[test]
    fn a_damaged_file_is_not_used_and_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let a = facts(3);
        let d = Derived::of(Some(dir.path().to_path_buf()), &a).unwrap();
        d.put("k", b"", &vec![1u32, 2, 3]);
        let path = d.path("k", &d.key("k", b""));
        let good = std::fs::read(&path).unwrap();
        // Another kind's file under this name: it holds another key.
        d.put("j", b"", &vec![9u32]);
        let foreign = std::fs::read(d.path("j", &d.key("j", b""))).unwrap();
        let wrong_shape = String::from_utf8(good.clone())
            .unwrap()
            .replace("[1,2,3]", "{\"a\":1}");
        for bad in [
            &b""[..],
            b"not json",
            &good[..good.len() / 2],
            &foreign,
            wrong_shape.as_bytes(),
            b"{\"key\":\"\",\"value\":[1,2,3]}",
            b"\xff\xfe\x00",
        ] {
            std::fs::write(&path, bad).unwrap();
            assert_eq!(d.get::<Vec<u32>>("k", b""), None, "{bad:?}");
            assert_eq!(d.get_or("k", b"", || vec![4u32]), vec![4]);
            assert_eq!(d.get::<Vec<u32>>("k", b""), Some(vec![4]));
        }
        // A directory where the file should be: not used, and nothing fails.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(d.get::<Vec<u32>>("k", b""), None);
        assert_eq!(d.get_or("k", b"", || vec![5u32]), vec![5]);
        // The cache directory is a file: nothing can be kept, and nothing fails.
        let file = dir.path().join("a-file");
        std::fs::write(&file, "x").unwrap();
        let d = Derived::of(Some(file), &a).unwrap();
        assert_eq!(d.get_or("k", b"", || vec![6u32]), vec![6]);
        assert_eq!(d.get::<Vec<u32>>("k", b""), None);
    }

    #[test]
    fn a_value_that_does_not_read_back_equal_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let d = Derived::of(Some(dir.path().to_path_buf()), &facts(1)).unwrap();
        // NaN is written as null, which is no float to read back.
        d.put("k", b"", &vec![f64::NAN]);
        assert_eq!(d.get::<Vec<f64>>("k", b""), None);
        assert!(!d.path("k", &d.key("k", b"")).exists());
        d.put("k", b"", &vec![0.1f64, 1.0 / 3.0]);
        assert_eq!(d.get::<Vec<f64>>("k", b""), Some(vec![0.1, 1.0 / 3.0]));
    }

    #[test]
    fn only_the_newest_files_of_a_kind_stay() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().to_path_buf();
        let stamp = |p: &Path, secs: u64| {
            let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000 + secs);
            std::fs::File::options()
                .write(true)
                .open(p)
                .unwrap()
                .set_modified(t)
                .unwrap();
        };
        let mut paths = Vec::new();
        for i in 0..KEPT + 3 {
            let d = Derived::of(Some(cache.clone()), &facts(i)).unwrap();
            d.put("k", b"", &i);
            let p = d.path("k", &d.key("k", b""));
            stamp(&p, i as u64);
            paths.push(p);
        }
        // Another kind is not counted with it, and an old temp file is cleared.
        let other = Derived::of(Some(cache.clone()), &facts(0)).unwrap();
        other.put("j", b"", &0u32);
        let tmp = cache.join(DIR).join(".k-dead.1.tmp");
        std::fs::write(&tmp, "x").unwrap();
        stamp(&tmp, 0);
        let d = Derived::of(Some(cache.clone()), &facts(100)).unwrap();
        d.put("k", b"", &100usize);
        let left: Vec<bool> = paths.iter().map(|p| p.exists()).collect();
        let want: Vec<bool> = (0..KEPT + 3).map(|i| i >= 4).collect();
        assert_eq!(left, want);
        assert!(d.path("k", &d.key("k", b"")).exists());
        assert!(other.path("j", &other.key("j", b"")).exists());
        assert!(!tmp.exists());
    }
}
