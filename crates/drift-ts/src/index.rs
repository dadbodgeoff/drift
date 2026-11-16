//! Scan index: what each source file held the last time Drift read it.
//!
//! A full scan reads every file. With the index, a later scan reads only files
//! whose `stat` (size, times, inode) changed, and [`scan_file`] computes one
//! file's facts by linking only the files they depend on. Nothing in the index
//! is trusted beyond what it can prove: an entry is reused only when the file's
//! stamp is unchanged and was not "racy" (changed within [`RACY_NS`] of the scan
//! that read it, where a later same-size write could keep the same stamp).
//! Resolution and linking are always recomputed, so files added or removed since
//! the index was written are handled exactly.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use drift_core::cache::FactCache;
use drift_core::ingest::{self, Candidate, FileStamp, Read};
use drift_core::{FileFacts, FileRef, Import, RepoFacts, SkipReason, in_integration_dir};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::lower::{RawFile, lower_on_stack};
use crate::resolve::{
    Linker, LoweredFile, ModuleResolver, all_specs, export_specs, mount_specs, workspace_from,
};
use crate::{PackageMemo, ScanOptions, package_of, parser_tag, repo};

/// Bump when the index layout or the meaning of its entries changes.
const INDEX_VERSION: u32 = 1;
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
pub(crate) struct Entry {
    stamp: FileStamp,
    hash: String,
    /// Content-level skip reason (not UTF-8, generated header, minified, nested too
    /// deep, too costly to parse): one that depends only on the content the stamp
    /// vouches for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skip: Option<SkipReason>,
    /// The file mounts routers (`app.use("/x", router)`, a tRPC router): other files' route prefixes depend on it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    mounts: bool,
    /// The file has module augmentations (`declare module "x" { interface ... }`):
    /// parameter types anywhere may depend on it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    augments: bool,
    /// Changed within [`RACY_NS`] of being read: re-read next time.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    racy: bool,
}

fn index_path(cache_dir: &Path, root: &Path) -> PathBuf {
    let key = ingest::hash_bytes(root.to_string_lossy().as_bytes());
    cache_dir
        .join(format!(
            "index-v{}-{INDEX_VERSION}",
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

/// A source candidate whose content is known, from the index or from reading it now.
pub(crate) struct Known {
    pub cand: Candidate,
    pub hash: String,
    pub skip: Option<SkipReason>,
    mounts: bool,
    augments: bool,
    racy: bool,
    /// Set when the file was read (and lowered) in this run.
    pub raw: Option<RawFile>,
    /// The facts came from the cache rather than from lowering.
    pub cache_hit: bool,
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
            mounts: self.mounts,
            augments: self.augments,
            racy: self.racy,
        })
    }
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
    let key = cache_key(rel, hash);
    if let Some(raw) = cache.and_then(|c| c.get::<RawFile>(&key)) {
        return Ok((raw, true));
    }
    let raw = match ingest::is_component_path(rel) {
        true => crate::sfc::lower_component_on_stack(rel, text),
        false => lower_on_stack(rel, text),
    }
    .map_err(|_| SkipReason::StackUnavailable)?;
    if let Some(c) = cache {
        c.put(&key, &raw);
    }
    Ok((raw, false))
}

/// The key a file's facts are cached under: the hash of its bytes, or for a
/// component ([`crate::sfc`]) a hash of that and its kind, since its facts are of
/// its script, not of the bytes read as a source file.
fn cache_key(rel: &str, hash: &str) -> String {
    match ingest::is_component_path(rel) {
        true => {
            let ext = rel.rsplit_once('.').map_or("", |(_, e)| e);
            ingest::hash_bytes(format!("component {ext}\0{hash}").as_bytes())
        }
        false => hash.to_string(),
    }
}

/// [`ingest::read_source`], or [`ingest::read_component`] for a component.
fn read(cand: &Candidate) -> Option<Read> {
    match ingest::is_component_path(&cand.rel_path) {
        true => ingest::read_component(cand),
        false => ingest::read_source(cand),
    }
}

/// Decide what each candidate holds, reading only files the index cannot vouch for.
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
                    mounts: e.mounts,
                    augments: e.augments,
                    racy: false,
                    raw: None,
                    cache_hit: false,
                    cand,
                });
            }
            let racy = cand.stamp.changed_ns().saturating_add(RACY_NS) >= started_ns;
            let (hash, lowered) = match read(&cand)? {
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
                    mounts: false,
                    augments: false,
                    racy,
                    raw: None,
                    cache_hit: false,
                    cand,
                },
                Ok((raw, hit)) => Known {
                    hash,
                    // Over its parse budget: skipped like content the read skips.
                    skip: raw.skip,
                    mounts: !raw.mounts.is_empty()
                        || !raw.nest_applies.is_empty()
                        || !raw.nest_global_guards.is_empty()
                        || !raw.node_listener_refs.is_empty()
                        || raw.nest_prefixed
                        // A tRPC router's composition sets its procedures' paths.
                        || !raw.trpc.routers.is_empty(),
                    augments: !raw.types.augments.is_empty(),
                    racy,
                    raw: Some(raw),
                    cache_hit: hit,
                    cand,
                },
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
    if let Some(raw) = cache.and_then(|c| c.get::<RawFile>(&cache_key(&k.cand.rel_path, &k.hash))) {
        return Ok((make(k.hash.clone(), raw), true));
    }
    // Not cached (cache cleared): read it again. The content is what the index says
    // unless the file changed since the walk, in which case the newer content wins.
    match read(&k.cand).ok_or(None)? {
        Read::Source(f) => {
            let (raw, hit) = lower_cached(&f.rel_path, &f.hash, &f.text, cache).map_err(Some)?;
            if let Some(reason) = raw.skip {
                return Err(Some(reason));
            }
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

/// Record what this run knows, if it differs from the loaded index. A run that
/// read no components (`components` false: a single-file scan) keeps what the
/// index knows of them.
pub(crate) fn update(
    cache_dir: &Path,
    root: &Path,
    old: Option<&Index>,
    known: &[Known],
    components: bool,
) {
    let mut entries: BTreeMap<String, Entry> = known
        .iter()
        .filter_map(|k| Some((k.cand.rel_path.clone(), k.entry()?)))
        .collect();
    if !components && let Some(old) = old {
        entries.extend(
            old.entries
                .iter()
                .filter(|(p, _)| ingest::is_component_path(p))
                .map(|(p, e)| (p.clone(), e.clone())),
        );
    }
    if old.is_none_or(|i| i.entries != entries) {
        Index::save(cache_dir, root, entries);
    }
}

fn is_config_path(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name == "package.json" || name.ends_with(".prisma") || name.ends_with(".sql")
}

fn is_source_path(rel: &str) -> bool {
    Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ingest::SOURCE_EXTENSIONS.contains(&e))
}

fn empty_facts() -> RepoFacts {
    RepoFacts {
        schema_version: drift_core::FACTS_SCHEMA_VERSION,
        ..RepoFacts::default()
    }
}

/// Facts for the single TypeScript/JavaScript file `rel`, identical to its entry in
/// a full [`crate::scan`], plus the database models it declares and the repo's
/// workspace packages and linter configs (which checks read), and, when `rel` is
/// below an `integration` directory, where the other files below one are
/// ([`RepoFacts::integration_files`]).
/// Other files and models are not included.
///
/// Returns `Ok(None)` when this cannot be done cheaply and exactly: no cache or no
/// index yet (a full scan writes one), `rel` is a Python file, or a `package.json`,
/// Prisma or SQL file (repo-level facts). Returns no files when `rel` is not an
/// analysed source.
pub fn scan_file(root: &Path, opts: &ScanOptions, rel: &str) -> anyhow::Result<Option<RepoFacts>> {
    scan_file_with(root, opts, rel, None)
}

/// [`scan_file`] with a walk of `root` (canonical) already made by
/// [`ingest::walk`] with [`repo::is_config_path`], so a caller that also needs the
/// walk's Python files walks once.
pub fn scan_file_walked(
    root: &Path,
    opts: &ScanOptions,
    rel: &str,
    walked: ingest::Walked,
) -> anyhow::Result<Option<RepoFacts>> {
    scan_file_with(root, opts, rel, Some(walked))
}

fn scan_file_with(
    root: &Path,
    opts: &ScanOptions,
    rel: &str,
    walked: Option<ingest::Walked>,
) -> anyhow::Result<Option<RepoFacts>> {
    // Python files are scanned by drift-py.
    let python = Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ingest::PYTHON_EXTENSIONS.contains(&e));
    if python || is_config_path(rel) {
        return Ok(None);
    }
    if !is_source_path(rel) {
        return Ok(Some(empty_facts()));
    }
    let Some(cache_dir) = &opts.cache_dir else {
        return Ok(None);
    };
    let root = drift_core::fsutil::canonical(root)?;
    let Some(index) = Index::load(cache_dir, &root) else {
        return Ok(None);
    };
    let cache = FactCache::new(cache_dir, &parser_tag());
    // Every file is parsed, lowered and dropped on these workers' stacks.
    drift_core::stack::pool(opts.threads)?
        .install(|| scan_file_inner(&root, opts, cache_dir, &index, &cache, rel, walked))
}

fn scan_file_inner(
    root: &Path,
    opts: &ScanOptions,
    cache_dir: &Path,
    index: &Index,
    cache: &FactCache,
    rel: &str,
    walked: Option<ingest::Walked>,
) -> anyhow::Result<Option<RepoFacts>> {
    let started = now_ns();
    let walked = match walked {
        Some(w) => w,
        None => ingest::walk(root, opts.threads, &repo::is_config_path)?,
    };
    let known = classify(walked.sources, Some(index), Some(cache), started);
    update(cache_dir, root, Some(index), &known, false);
    let kept: BTreeMap<&str, &Known> = known
        .iter()
        .filter(|k| k.skip.is_none())
        .map(|k| (k.cand.rel_path.as_str(), k))
        .collect();
    // Files not parsed for lack of stack: what they hold is unknown, so checks of
    // `rel` must know they are missing (it may be one, or read one).
    let no_stack = stack_unavailable(&known);
    if !kept.contains_key(rel) {
        return Ok(Some(RepoFacts {
            skipped: no_stack,
            ..empty_facts()
        }));
    }
    let config = repo::read_config(&walked.config);
    let resolver = ModuleResolver::new(root, workspace_from(root, &config.package_jsons));

    // The files `rel`'s facts depend on: itself (all its specifiers) and every file
    // that mounts routers (they set route prefixes and inherited middleware), then,
    // following re-exports only, every module those names are resolved through.
    // Rules about `rel` also read the in-repo base classes its classes extend, at
    // any depth: those files are linked with all their specifiers too, round after
    // round until the chain ends, and returned as context.
    let mut full: BTreeSet<String> = std::iter::once(rel.to_string()).collect();
    let (files, linked) = loop {
        let mut loaded: BTreeMap<String, LoweredFile> = BTreeMap::new();
        let mut frontier: BTreeSet<String> = full
            .iter()
            .cloned()
            .chain(
                kept.values()
                    .filter(|k| k.mounts)
                    .map(|k| k.cand.rel_path.clone()),
            )
            .collect();
        while !frontier.is_empty() {
            let level: Vec<Option<(LoweredFile, Vec<String>)>> = frontier
                .par_iter()
                .map(|path| {
                    // A file without facts now (changed, no stack): a full scan records it.
                    let (f, _) = lowered(kept.get(path.as_str())?, Some(cache)).ok()?;
                    let dir = f.abs_path.parent().unwrap_or(&f.abs_path);
                    let targets = needed_specs(&f, &full)
                        .into_iter()
                        .map(|s| resolver.resolve(dir, s))
                        .filter(|m| kept.contains_key(m.as_str()))
                        .collect();
                    Some((f, targets))
                })
                .collect();
            let mut next = BTreeSet::new();
            for item in level {
                let Some((f, targets)) = item else {
                    return Ok(None);
                };
                next.extend(targets);
                loaded.insert(f.rel_path.clone(), f);
            }
            next.retain(|p| !loaded.contains_key(p));
            frontier = next;
        }
        let files: Vec<LoweredFile> = loaded.into_values().collect();
        let linker = Linker::with_specs(&resolver, &files, |f| needed_specs(f, &full));
        // Parameter types are read from whichever files the callees' declarations are in.
        let repo_types = |rel: &str| {
            files
                .iter()
                .find(|f| f.rel_path == rel)
                .map(|f| f.raw.types.clone())
                .or_else(|| Some(lowered(kept.get(rel)?, Some(cache)).ok()?.0.raw.types))
        };
        let augmenting: Vec<std::sync::Arc<crate::types::RawTypes>> = kept
            .values()
            .filter(|k| k.augments)
            .filter_map(|k| lowered(k, Some(cache)).ok())
            .map(|(f, _)| f.raw.types)
            .collect();
        let types_cache = crate::typeres::types_cache(cache_dir);
        let augmented = crate::typeres::augmented_names(
            root,
            augmenting.iter().map(|t| &**t),
            &walked.skipped,
            Some(&types_cache),
        );
        let types = crate::typeres::TypeIndex::new(
            root,
            &resolver,
            &repo_types,
            augmented,
            Some(types_cache),
        );
        let linked: BTreeMap<String, FileFacts> = files
            .iter()
            .filter(|f| full.contains(&f.rel_path))
            .map(|f| {
                let package = package_of(root, &f.abs_path, &mut PackageMemo::new());
                let mut facts = linker.link(f, package);
                types.annotate(&mut facts);
                (f.rel_path.clone(), facts)
            })
            .collect();
        let mut bases: BTreeSet<String> = linked
            .values()
            .flat_map(|f| f.symbols.iter())
            .filter(|s| s.kind == drift_core::SymbolKind::Class)
            .flat_map(|s| s.wraps.iter())
            .filter(|w| w.kind == drift_core::WrapKind::Extends)
            .filter_map(|w| w.wrapper.split_once('#').map(|(m, _)| m.to_string()))
            .filter(|m| kept.contains_key(m.as_str()) && !full.contains(m))
            .collect();
        // ... and the bindings `rel`'s call wrappers are built from, through every
        // binding they derive from (`bookingsProcedure = authedProcedure.use(...)`).
        bases.extend(
            derivation_files(&linked, rel)
                .into_iter()
                .filter(|m| kept.contains_key(m.as_str()) && !full.contains(m)),
        );
        // ... and the files that prove (or not) where the builders of `rel`'s tRPC
        // procedures come from (`api.query(...)`, `api = t.procedure`).
        bases.extend(
            linker
                .trpc_files(&files, rel, &full)
                .into_iter()
                .filter(|m| kept.contains_key(m.as_str()) && !full.contains(m)),
        );
        if bases.is_empty() {
            break (files, linked);
        }
        // A chain this long is not cut short: a full scan decides, so a hook always
        // checks what `drift check` checks.
        if full.len() + bases.len() > MAX_BASE_FILES {
            return Ok(None);
        }
        full.extend(bases);
    };
    // Another file was not parsed. What `rel` reads directly, its bases, routes and
    // test pairing are decided from these facts and `skipped` (`drift_mine::unchecked`);
    // a name resolved through an `export *` barrel may stop at the barrel when the
    // module behind it was not parsed, which only the barrel's facts show: a full
    // scan decides then.
    if !no_stack.is_empty()
        && files.iter().any(|f| {
            f.rel_path != rel
                && f.raw
                    .exports
                    .iter()
                    .any(|e| matches!(e.target, crate::lower::RawExportTarget::All { .. }))
        })
    {
        return Ok(None);
    }
    let target = files
        .iter()
        .find(|f| f.rel_path == rel)
        .expect("target is loaded");
    let mut linked = linked;
    let mut facts = linked.remove(rel).expect("target is linked");
    // Base files are context for rules about `rel`: their class symbols, the bindings
    // derived from others (wrapper chains), and the functions a binding is bound to
    // (what a plain alias names), only.
    let bound: BTreeSet<String> = std::iter::once(&facts)
        .chain(linked.values())
        .flat_map(|f| f.symbols.iter())
        .filter(|s| !s.derives_from.is_empty())
        .map(|s| s.derives_from.clone())
        .collect();
    let context_files: Vec<FileFacts> = linked
        .into_values()
        .map(|f| FileFacts {
            symbols: f
                .symbols
                .into_iter()
                .filter(|s| {
                    s.kind == drift_core::SymbolKind::Class
                        || !s.derives_from.is_empty()
                        || (matches!(
                            s.kind,
                            drift_core::SymbolKind::Function | drift_core::SymbolKind::Component
                        ) && std::iter::once(&s.name)
                            .chain(&s.exported_as)
                            .any(|n| bound.contains(&format!("{}#{n}", f.path))))
                })
                .collect(),
            path: f.path,
            lang: f.lang,
            package: f.package,
            ..FileFacts::default()
        })
        .collect();

    // A test file not parsed for lack of stack still exists: it pairs like the others.
    let all: BTreeSet<String> = kept
        .keys()
        .map(|p| p.to_string())
        .chain(no_stack.iter().map(|s| s.path.clone()))
        .collect();
    facts.has_test = repo::has_test(&facts.path, &all);
    if facts.directives.iter().any(|d| d == "use client") {
        // What it reaches through imports, an unparsed file among them: a full scan.
        if !no_stack.is_empty() {
            return Ok(None);
        }
        let Some(leaks) = client_leaks_of(&resolver, target, &facts, &kept, cache) else {
            return Ok(None);
        };
        facts.client_leaks = leaks;
    }
    let models = target
        .raw
        .models
        .iter()
        .map(|m| drift_core::Model {
            path: target.rel_path.clone(),
            name: m.name.clone(),
            source: "drizzle".into(),
            line: m.line,
            fields: m.fields.clone(),
        })
        .collect();
    // Which `integration/` directories are test suites is learned from all their
    // files. It only decides anything about `rel` when `rel` is below one.
    let mut memo = PackageMemo::new();
    let integration_files = if in_integration_dir(rel) {
        kept.values()
            .filter(|k| k.cand.rel_path != rel && in_integration_dir(&k.cand.rel_path))
            .map(|k| FileRef {
                path: k.cand.rel_path.clone(),
                package: package_of(root, &k.cand.abs_path, &mut memo),
            })
            .collect()
    } else {
        vec![]
    };
    // Checks read the workspace packages (declared dependencies) and linter configs.
    // A config that could not be read for lack of stack: a full scan records it.
    let (lint, unread) = repo::lint_configs(&config);
    if !unread.is_empty() {
        return Ok(None);
    }
    let mut repo = RepoFacts {
        files: vec![facts],
        context_files,
        integration_files,
        models,
        packages: repo::packages(root, &resolver, &config),
        lint,
        skipped: no_stack,
        ..empty_facts()
    };
    repo::mark_cli_entries(&mut repo, root, &config);
    repo.normalize();
    Ok(Some(repo))
}

/// The skip records of the files a run could not parse for lack of stack.
pub(crate) fn stack_unavailable(known: &[Known]) -> Vec<drift_core::Skipped> {
    known
        .iter()
        .filter(|k| k.skip == Some(SkipReason::StackUnavailable))
        .map(|k| drift_core::Skipped {
            path: k.cand.rel_path.clone(),
            reason: SkipReason::StackUnavailable,
        })
        .collect()
}

/// The TypeScript/JavaScript files among `sources` (candidates of a walk of `root`,
/// canonical) that are below an `integration` directory and that a full scan
/// analyses, as [`RepoFacts::integration_files`] lists them: for a single-file scan
/// of a file in another language. The index (in `cache_dir`) vouches for unchanged
/// files; any other is read, not lowered.
pub fn integration_files(
    root: &Path,
    cache_dir: Option<&Path>,
    sources: &[Candidate],
) -> Vec<FileRef> {
    let cands: Vec<&Candidate> = sources
        .iter()
        .filter(|c| in_integration_dir(&c.rel_path))
        .collect();
    if cands.is_empty() {
        return vec![];
    }
    let index = cache_dir.and_then(|d| Index::load(d, root));
    let analysed = |c: &Candidate| match index.as_ref().and_then(|i| i.entries.get(&c.rel_path)) {
        Some(e) if e.stamp == c.stamp && !e.racy => e.skip.is_none(),
        _ => matches!(ingest::read_source(c), Some(Read::Source(_))),
    };
    let kept: Vec<&Candidate> = cands.into_par_iter().filter(|c| analysed(c)).collect();
    let mut memo = PackageMemo::new();
    kept.into_iter()
        .map(|c| FileRef {
            path: c.rel_path.clone(),
            package: package_of(root, &c.abs_path, &mut memo),
        })
        .collect()
}

/// The modules a rule about `rel`'s call wrappers reads: the module of each in-repo
/// wrapper binding, then, for each binding whose module is linked, the module of the
/// binding it derives from ([`drift_core::Symbol::derives_from`]), to the end of the
/// chain. Modules not yet linked are returned for the next round.
fn derivation_files(linked: &BTreeMap<String, FileFacts>, rel: &str) -> BTreeSet<String> {
    let mut pending: Vec<String> = linked
        .get(rel)
        .into_iter()
        .flat_map(|f| f.symbols.iter())
        .flat_map(|s| s.wraps.iter())
        .filter(|w| w.kind == drift_core::WrapKind::Call)
        .map(|w| w.wrapper.clone())
        .collect();
    // ... and what `rel`'s bindings are bound to: a plain alias of a function
    // (`export const generateMetadata = generateReferenceMetadata`) is that function,
    // whose facts mining reads (`drift_mine::roles::FunctionAliases`).
    pending.extend(
        linked
            .get(rel)
            .into_iter()
            .flat_map(|f| f.symbols.iter())
            .filter(|s| !s.derives_from.is_empty())
            .map(|s| s.derives_from.clone()),
    );
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = BTreeSet::new();
    while let Some(r) = pending.pop() {
        if !seen.insert(r.clone()) || r.starts_with("pkg:") || r.starts_with("global#") {
            continue;
        }
        let Some((module, rest)) = r.split_once('#') else {
            continue;
        };
        let name = rest.split(['.', '(']).next().unwrap_or(rest);
        let Some(f) = linked.get(module) else {
            out.insert(module.to_string());
            continue;
        };
        if let Some(s) = f
            .symbols
            .iter()
            .find(|s| s.name == name || s.exported_as.iter().any(|e| e == name))
            && !s.derives_from.is_empty()
        {
            pending.push(s.derives_from.clone());
        }
    }
    out
}

/// Most files (the target and its base-class files) a single-file scan links; a
/// longer chain falls back to a full scan. Inheritance chains are short: this only
/// bounds a pathological repo.
const MAX_BASE_FILES: usize = 64;

/// Specifiers whose resolution `rel`'s facts can depend on: all of the specifiers of
/// `rel` and of the base-class files it reads (`full`); for other files, re-export
/// sources and router mounts.
fn needed_specs<'f>(f: &'f LoweredFile, full: &BTreeSet<String>) -> BTreeSet<&'f str> {
    if full.contains(&f.rel_path) {
        return all_specs(f);
    }
    let mut s = export_specs(f);
    s.extend(mount_specs(f));
    s
}

/// `facts.client_leaks` as [`repo::client_leaks`] computes it over the whole repo,
/// from the files `facts` reaches through value imports.
fn client_leaks_of(
    resolver: &ModuleResolver,
    target: &LoweredFile,
    facts: &FileFacts,
    kept: &BTreeMap<&str, &Known>,
    cache: &FactCache,
) -> Option<Vec<String>> {
    let reexports_of = |f: &LoweredFile| {
        let dir = f.abs_path.parent().unwrap_or(&f.abs_path);
        repo::Reexports::of(&f.raw, |spec| resolver.resolve(dir, spec))
    };
    let mut reexports: BTreeMap<String, repo::Reexports> =
        BTreeMap::from([(target.rel_path.clone(), reexports_of(target))]);
    let mut nodes: BTreeMap<String, FileFacts> = BTreeMap::new();
    let value_imports = |f: &FileFacts| -> Vec<String> {
        f.imports
            .iter()
            .filter(|i| repo::leak_edge(i) && kept.contains_key(i.module.as_str()))
            .map(|i| i.module.clone())
            .collect()
    };
    let mut queue = value_imports(facts);
    while let Some(path) = queue.pop() {
        if path == facts.path || nodes.contains_key(&path) {
            continue;
        }
        let (f, _) = lowered(kept.get(path.as_str())?, Some(cache)).ok()?;
        let dir = f.abs_path.parent().unwrap_or(&f.abs_path);
        let mut node = FileFacts {
            path: f.rel_path.clone(),
            directives: f.raw.directives.clone(),
            imports: f
                .raw
                .imports
                .iter()
                .map(|i| Import {
                    module: resolver.resolve(dir, &i.spec),
                    names: i.names.clone(),
                    type_only: i.type_only,
                    load: i.load,
                })
                .collect(),
            ..FileFacts::default()
        };
        node.normalize();
        reexports.insert(path.clone(), reexports_of(&f));
        // `"use server"` modules are boundaries: what they import does not propagate.
        if !node.directives.iter().any(|d| d == "use server") {
            queue.extend(value_imports(&node));
        }
        nodes.insert(path, node);
    }
    let mut mini = RepoFacts {
        files: nodes.into_values().chain([facts.clone()]).collect(),
        ..RepoFacts::default()
    };
    mini.files.sort_by(|a, b| a.path.cmp(&b.path));
    repo::client_leaks(&mut mini, &reexports);
    mini.files
        .into_iter()
        .find(|f| f.path == facts.path)
        .map(|f| f.client_leaks)
}
