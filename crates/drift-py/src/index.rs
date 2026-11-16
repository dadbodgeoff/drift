//! Python scan index: what each `.py` file held the last time Drift read it.
//!
//! The Python counterpart of the TypeScript index (`drift_ts`): a later scan reads
//! only files whose `stat` (size, times, inode) changed, and [`crate::scan_file`]
//! links one file against the files its facts depend on. An entry is reused only
//! when the file's stamp is unchanged and was not "racy" (changed within
//! [`RACY_NS`] of the scan that read it). Resolution and linking are always
//! recomputed, so files added or removed since the index was written are handled
//! exactly.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use drift_core::SkipReason;
use drift_core::cache::FactCache;
use drift_core::ingest::{self, Candidate, FileStamp, Lang, Read};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::link::LoweredFile;
use crate::lower::lower_on_stack;
use crate::parser_tag;
use crate::raw::{RawBase, RawFile};

/// Bump when the index layout or the meaning of its entries changes.
const INDEX_VERSION: u32 = 5;
/// A file changed this close to the scan that read it may change again with the same stamp.
const RACY_NS: u64 = 2_000_000_000;

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct Index {
    version: u32,
    parser: String,
    root: String,
    entries: BTreeMap<String, Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    stamp: FileStamp,
    hash: String,
    /// Content-level skip reason (not UTF-8, generated header, minified, too deep):
    /// one that depends only on the content the stamp vouches for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skip: Option<SkipReason>,
    /// Other files' entry points and guards depend on what the file contains (see
    /// [`is_global`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    global: bool,
    /// The file defines Celery tasks (see [`defines_tasks`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    tasks: bool,
    /// The file has Celery beat entries.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    beats: bool,
    /// What the file says about app factories (see [`AppPasses`]).
    #[serde(default, skip_serializing_if = "AppPasses::is_empty")]
    passes: AppPasses,
    /// Names the file's classes extend (see [`base_names`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    bases: Vec<String>,
    /// Changed within [`RACY_NS`] of being read: re-read next time.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    racy: bool,
}

/// True when the file's raw facts reach other files' facts by what they *contain*
/// rather than by being imported: router mounts and URLconf includes (route prefixes,
/// inherited guards, which URLconfs serve requests), view registrations (entry points
/// of the views' files), Flask hooks (guards of a blueprint's routes), app factories
/// passing their app to helpers (see [`AppPasses`]), `request.urlconf` assignments, Celery beat entries
/// (`cron` entry points of the tasks' files), error handlers registered by call
/// (`add_exception_handler`) or by DRF's `EXCEPTION_HANDLER` (what the handlers' files
/// handle), GraphQL schemas (`graphql` entry points of the files of their root
/// types and resolvers), and Django's entry scripts and settings
/// files (the settings modules: URL roots and global guards). Settings modules named
/// elsewhere and the modules they star-import are found by lookup.
pub(crate) fn is_global(rel: &str, raw: &RawFile) -> bool {
    use crate::link::config::{is_entry_script, is_settings_file};
    !raw.mounts.is_empty()
        || !raw.registrations.is_empty()
        || !raw.hooks.is_empty()
        || !raw.request_urlconfs.is_empty()
        || !raw.dependency_overrides.is_empty()
        || !raw.beats.is_empty()
        || !raw.error_handlers.is_empty()
        // A GraphQL schema: the entry points of its root types' files.
        || !raw.graphql.schemas.is_empty()
        || raw
            .settings
            .drf
            .as_ref()
            .is_some_and(|d| d.exception_handler.is_some())
        || is_entry_script(rel)
        || is_settings_file(rel)
}

/// Names that decide whether a file's app passes (`init_hooks(app)` in `create_app()`)
/// reach a hook helper. Almost every function passes a local to some call, and only
/// passes to a helper (a function that registers hooks or blueprints on a parameter)
/// alias an app, so a file is linked as a caller only when one of its callee names
/// reaches a helper's name, through renamed imports. Names are a superset of
/// resolution: an import `as` keeps the imported name, a module attribute its last
/// segment, and a renaming re-export is followed through `renames`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AppPasses {
    /// Functions of this file that are helpers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub helpers: Vec<String>,
    /// Names of the functions this file passes a function-local value to.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub callees: Vec<String>,
    /// Imports bound under another name: (local name, imported name).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub renames: Vec<(String, String)>,
}

impl AppPasses {
    fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub(crate) fn of(raw: &RawFile) -> Self {
        use crate::raw::{RawBase, RawBinding};
        let mut callees: Vec<String> = Vec::new();
        for p in &raw.app_passes {
            let r = &p.callee;
            let base = match &r.base {
                RawBase::Import { name, .. } => name,
                RawBase::Local(n) | RawBase::Global(n) | RawBase::Star(n) => n,
            };
            callees.push(base.clone());
            let last = r.member.rsplit('.').next().unwrap_or_default();
            let last = last.split(['(', '[']).next().unwrap_or_default();
            if !last.is_empty() {
                callees.push(last.to_string());
            }
        }
        callees.sort();
        callees.dedup();
        let renames = raw
            .bindings
            .iter()
            .filter_map(|(local, b)| match b {
                RawBinding::Import { name, .. } if name != local && name != "*" => {
                    Some((local.clone(), name.clone()))
                }
                _ => None,
            })
            .collect();
        Self {
            helpers: raw.factory_params.iter().map(|(n, _)| n.clone()).collect(),
            callees,
            renames,
        }
    }
}

/// Files whose app passes may reach a helper (see [`AppPasses`]).
pub(crate) fn app_callers<'k>(known: impl Iterator<Item = &'k Known> + Clone) -> BTreeSet<&'k str> {
    let mut names: BTreeSet<&str> = known
        .clone()
        .flat_map(|k| k.passes.helpers.iter().map(String::as_str))
        .collect();
    if names.is_empty() {
        return BTreeSet::new();
    }
    // Every local name a helper is imported under, through chains of renames.
    loop {
        let before = names.len();
        for k in known.clone() {
            for (local, name) in &k.passes.renames {
                if names.contains(name.as_str()) {
                    names.insert(local);
                }
            }
        }
        if names.len() == before {
            break;
        }
    }
    known
        .filter(|k| k.passes.callees.iter().any(|c| names.contains(c.as_str())))
        .map(|k| k.cand.rel_path.as_str())
        .collect()
}

/// True when the file may define a Celery task: a file-level Celery entry point or a
/// `@x.task` route. A beat entry names its task by Celery name, which can be any
/// file's, so with beats in the repo these files are linked too.
pub(crate) fn defines_tasks(raw: &RawFile) -> bool {
    raw.entry_points.iter().any(|e| e.adapter == "celery")
        || raw.routes.iter().any(|r| r.verb == "task")
}

fn index_path(cache_dir: &Path, root: &Path) -> PathBuf {
    let key = ingest::hash_bytes(root.to_string_lossy().as_bytes());
    cache_dir
        .join(format!(
            "index-py-v{}-{INDEX_VERSION}",
            drift_core::FACTS_SCHEMA_VERSION
        ))
        .join(format!("{}.json", &key[..16]))
}

impl Index {
    pub(crate) fn load(cache_dir: &Path, root: &Path) -> Option<Self> {
        let bytes = std::fs::read(index_path(cache_dir, root)).ok()?;
        let idx: Self = serde_json::from_slice(&bytes).ok()?;
        (idx.version == INDEX_VERSION
            && idx.parser == parser_tag()
            && idx.root == root.to_string_lossy())
        .then_some(idx)
    }

    /// Best effort and atomic: a failed write only costs a full read next time.
    fn save(cache_dir: &Path, root: &Path, entries: BTreeMap<String, Entry>) {
        let idx = Self {
            version: INDEX_VERSION,
            parser: parser_tag(),
            root: root.to_string_lossy().into_owned(),
            entries,
        };
        let path = index_path(cache_dir, root);
        let Some(dir) = path.parent() else { return };
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
        let Ok(bytes) = serde_json::to_vec(&idx) else {
            return;
        };
        let tmp = format!(".index.{}.tmp", std::process::id());
        let _ = drift_core::fsutil::write_atomic(&path, &tmp, &bytes);
        // Temp files left by writers killed before their rename.
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let stale = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 3600);
            if stale && e.file_name().to_string_lossy().ends_with(".tmp") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

pub(crate) fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64)
}

/// A Python candidate whose content is known, from the index or from reading it now.
pub(crate) struct Known {
    pub cand: Candidate,
    pub hash: String,
    pub skip: Option<SkipReason>,
    pub global: bool,
    pub tasks: bool,
    pub beats: bool,
    pub passes: AppPasses,
    /// Names the file's classes extend (see [`base_names`]).
    pub bases: Vec<String>,
    racy: bool,
    /// Set when the file was read (and lowered) in this run.
    raw: Option<RawFile>,
    /// The facts came from the cache rather than from lowering.
    cache_hit: bool,
}

impl Known {
    /// What the index records, `None` when nothing may be: a file skipped for lack
    /// of stack is skipped because of this process, not its content, so it is read
    /// again next time.
    fn entry(&self) -> Option<Entry> {
        (self.skip != Some(SkipReason::StackUnavailable)).then(|| Entry {
            stamp: self.cand.stamp,
            hash: self.hash.clone(),
            skip: self.skip,
            global: self.global,
            tasks: self.tasks,
            beats: self.beats,
            passes: self.passes.clone(),
            bases: self.bases.clone(),
            racy: self.racy,
        })
    }
}

/// Names the file's classes extend, as written (an import's original name, a module
/// attribute's last segment), sorted: a superset of the classes they resolve to, so a
/// single-file scan can tell, without linking, that no other file extends a class.
pub(crate) fn base_names(raw: &RawFile) -> Vec<String> {
    let mut out: Vec<String> = raw
        .symbols
        .iter()
        .filter(|s| s.kind == drift_core::SymbolKind::Class)
        .flat_map(|s| s.wraps.iter())
        .filter(|(_, k)| *k == drift_core::WrapKind::Extends)
        .map(
            |(r, _)| match r.member.rsplit('.').next().filter(|m| !m.is_empty()) {
                Some(m) => m.to_string(),
                None => match &r.base {
                    RawBase::Import { name, .. }
                    | RawBase::Local(name)
                    | RawBase::Global(name)
                    | RawBase::Star(name) => name.clone(),
                },
            },
        )
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Facts for a file's content: from the cache, or lowered (and cached).
/// `Err(StackUnavailable)` when it is not cached and no stack to lower it on could
/// be had.
fn lower_cached(
    rel: &str,
    hash: &str,
    text: &str,
    cache: Option<&FactCache>,
) -> Result<(RawFile, bool), SkipReason> {
    if let Some(raw) = cache.and_then(|c| c.get::<RawFile>(hash)) {
        return Ok((raw, true));
    }
    let raw = lower_on_stack(rel, text).map_err(|_| SkipReason::StackUnavailable)?;
    if let Some(c) = cache {
        c.put(hash, &raw);
    }
    Ok((raw, false))
}

/// Whether a full scan analyses the candidate: from the index entry when it vouches
/// for the file (unchanged, not racy), else by reading it (not lowering).
pub(crate) fn analysed(c: &Candidate, index: Option<&Index>) -> bool {
    match index.and_then(|i| i.entries.get(&c.rel_path)) {
        Some(e) if e.stamp == c.stamp && !e.racy => e.skip.is_none(),
        _ => matches!(
            ingest::read_source_lang(c, Lang::Python),
            Some(Read::Source(_))
        ),
    }
}

/// Decide what each candidate holds, reading only files the index cannot vouch for.
/// Runs on the caller's thread pool ([`drift_core::stack::pool`]).
pub(crate) fn classify(
    sources: Vec<Candidate>,
    index: Option<&Index>,
    cache: Option<&FactCache>,
    started_ns: u64,
) -> Vec<Known> {
    sources
        .into_par_iter()
        .filter_map(|cand| {
            if let Some(e) = index.and_then(|i| i.entries.get(&cand.rel_path))
                && e.stamp == cand.stamp
                && !e.racy
            {
                return Some(Known {
                    hash: e.hash.clone(),
                    skip: e.skip,
                    global: e.global,
                    tasks: e.tasks,
                    beats: e.beats,
                    passes: e.passes.clone(),
                    bases: e.bases.clone(),
                    racy: false,
                    raw: None,
                    cache_hit: false,
                    cand,
                });
            }
            let racy = cand.stamp.changed_ns().saturating_add(RACY_NS) >= started_ns;
            let (hash, lowered) = match ingest::read_source_lang(&cand, Lang::Python)? {
                Read::Skipped { hash, reason } => (hash, Err(reason)),
                Read::Source(f) => {
                    let lowered = lower_cached(&f.rel_path, &f.hash, &f.text, cache);
                    (f.hash, lowered)
                }
            };
            Some(match lowered {
                Err(reason) => Known {
                    hash,
                    skip: Some(reason),
                    global: false,
                    tasks: false,
                    beats: false,
                    passes: AppPasses::default(),
                    bases: vec![],
                    racy,
                    raw: None,
                    cache_hit: false,
                    cand,
                },
                Ok((raw, hit)) => {
                    let rel = &cand.rel_path;
                    Known {
                        hash,
                        skip: None,
                        global: is_global(rel, &raw),
                        tasks: defines_tasks(&raw),
                        beats: !raw.beats.is_empty(),
                        passes: AppPasses::of(&raw),
                        bases: base_names(&raw),
                        racy,
                        raw: Some(raw),
                        cache_hit: hit,
                        cand,
                    }
                }
            })
        })
        .collect()
}

/// The facts of a known source file, or why it has none: `Err(Some(reason))` when it
/// is not cached and either changed since the walk into content a scan skips, or no
/// stack to lower it on could be had; `Err(None)` when it can no longer be read.
pub(crate) fn lowered(
    k: &Known,
    cache: Option<&FactCache>,
) -> Result<(LoweredFile, bool), Option<SkipReason>> {
    let make = |hash: String, raw: RawFile| LoweredFile {
        rel_path: k.cand.rel_path.clone(),
        abs_path: k.cand.abs_path.clone(),
        hash,
        raw,
    };
    if let Some(raw) = &k.raw {
        return Ok((make(k.hash.clone(), raw.clone()), k.cache_hit));
    }
    if let Some(raw) = cache.and_then(|c| c.get::<RawFile>(&k.hash)) {
        return Ok((make(k.hash.clone(), raw), true));
    }
    // Not cached (cache cleared): read it again. The content is what the index says
    // unless the file changed since the walk, in which case the newer content wins.
    match ingest::read_source_lang(&k.cand, Lang::Python).ok_or(None)? {
        Read::Source(f) => {
            let (raw, hit) = lower_cached(&f.rel_path, &f.hash, &f.text, cache).map_err(Some)?;
            Ok((make(f.hash, raw), hit))
        }
        Read::Skipped { reason, .. } => Err(Some(reason)),
    }
}

/// Like [`lowered`], without copying facts read in this run; a file that has none
/// gives its skip record (`None` when it can no longer be read).
pub(crate) fn into_lowered(
    k: Known,
    cache: Option<&FactCache>,
) -> Result<(LoweredFile, bool), Option<drift_core::Skipped>> {
    match k.raw {
        Some(raw) => Ok((
            LoweredFile {
                rel_path: k.cand.rel_path,
                abs_path: k.cand.abs_path,
                hash: k.hash,
                raw,
            },
            k.cache_hit,
        )),
        None => lowered(&k, cache).map_err(|reason| {
            reason.map(|reason| drift_core::Skipped {
                path: k.cand.rel_path.clone(),
                reason,
            })
        }),
    }
}

/// Record what this run knows, if it differs from the loaded index.
pub(crate) fn update(cache_dir: &Path, root: &Path, old: Option<&Index>, known: &[Known]) {
    let entries: BTreeMap<String, Entry> = known
        .iter()
        .filter_map(|k| Some((k.cand.rel_path.clone(), k.entry()?)))
        .collect();
    if old.is_none_or(|i| i.entries != entries) {
        Index::save(cache_dir, root, entries);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lower::lower_file;

    fn known(rel: &str, text: &str) -> Known {
        let raw = lower_file(rel, text);
        Known {
            cand: Candidate {
                rel_path: rel.into(),
                abs_path: PathBuf::from(rel),
                stamp: FileStamp::default(),
            },
            hash: String::new(),
            skip: None,
            global: is_global(rel, &raw),
            tasks: defines_tasks(&raw),
            beats: !raw.beats.is_empty(),
            passes: AppPasses::of(&raw),
            bases: base_names(&raw),
            racy: false,
            raw: None,
            cache_hit: false,
        }
    }

    #[test]
    fn app_callers_follow_helper_names_through_renames() {
        let files = [
            known(
                "app/setup.py",
                "def init_hooks(app):\n    @app.before_request\n    def t():\n        pass\n",
            ),
            known("app/__init__.py", "from .setup import init_hooks as wire\n"),
            // Passes its app to the helper under a re-exported name.
            known(
                "app/factory.py",
                "from flask import Flask\nfrom app import wire\n\ndef create_app():\n    app = Flask(__name__)\n    wire(app)\n    return app\n",
            ),
            // Through a module attribute.
            known(
                "app/other.py",
                "from flask import Flask\nimport app.setup as s\n\ndef make():\n    app = Flask(__name__)\n    s.init_hooks(app)\n",
            ),
            // Passes locals only to functions that are not helpers.
            known(
                "app/plain.py",
                "def f():\n    x = 1\n    print(x)\n    return g(x)\n",
            ),
        ];
        let callers = app_callers(files.iter());
        assert_eq!(
            callers.into_iter().collect::<Vec<_>>(),
            ["app/factory.py", "app/other.py"]
        );
        assert!(files[0].passes.helpers.contains(&"init_hooks".to_string()));
        assert!(!files[4].global);
    }
}
