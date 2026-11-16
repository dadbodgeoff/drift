//! Drift's TypeScript/JavaScript language parser, built on oxc.
//!
//! Pipeline: ingest -> lower each file (cached by content hash) -> resolve
//! modules and re-export chains -> framework adapters -> [`RepoFacts`].

pub mod arena;
pub mod filerouters;
mod flow;
mod index;
pub mod lint;
pub mod lower;
pub mod nextjs;
pub mod repo;
pub mod resolve;
mod typeres;
mod types;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use drift_core::cache::FactCache;
use drift_core::ingest::{self, rel_posix};
use drift_core::{FileFacts, RepoFacts};
use rayon::prelude::*;

pub use crate::index::{integration_files, scan_file, scan_file_walked};
use crate::lower::{LOWERING_VERSION, lower_on_stack};
use crate::resolve::{Linker, LoweredFile, ModuleResolver, discover_workspace, workspace_from};

/// Parser tag used in cache keys.
pub fn parser_tag() -> String {
    format!("ts-l{LOWERING_VERSION}-{}", env!("CARGO_PKG_VERSION"))
}

#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    /// Directory for the fact cache; `None` disables caching.
    pub cache_dir: Option<PathBuf>,
    /// Worker threads; `0` means one per CPU.
    pub threads: usize,
}

#[derive(Debug, Clone, Default)]
pub struct ScanStats {
    pub files: usize,
    pub cache_hits: usize,
    pub parse_errors: usize,
}

/// [`package_of`]'s answers, per directory (its bytes: a lookup neither allocates nor
/// compares path components).
pub(crate) type PackageMemo = HashMap<Vec<u8>, String>;

/// Nearest directory (repo-relative) containing a `package.json`.
pub(crate) fn package_of(root: &Path, abs: &Path, memo: &mut PackageMemo) -> String {
    let mut dir = abs.parent();
    let mut visited = Vec::new();
    let mut found = String::new();
    while let Some(d) = dir {
        if let Some(v) = memo.get(d.as_os_str().as_encoded_bytes()) {
            found = v.clone();
            break;
        }
        visited.push(d);
        if d.join("package.json").is_file() {
            found = rel_posix(root, d).unwrap_or_default();
            break;
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
    for p in visited {
        memo.insert(p.as_os_str().as_encoded_bytes().to_vec(), found.clone());
    }
    found
}

/// Scan a repository and return its facts. Output is deterministic.
pub fn scan(root: &Path, opts: &ScanOptions) -> anyhow::Result<(RepoFacts, ScanStats)> {
    let root = drift_core::fsutil::canonical(root)?;
    // Every file is parsed, lowered and dropped on these workers' stacks.
    drift_core::stack::pool(opts.threads)?.install(|| scan_inner(&root, opts, None))
}

/// [`scan`] of `root` (canonical) with a walk of it already made by [`ingest::walk`]
/// with [`repo::is_config_path`], so a caller that also scans the walk's Python files
/// walks once. `started_ns` is the time just before that walk began (nanoseconds
/// since the Unix epoch): what tells a file changed too close to the walk to trust
/// its stamp next time.
///
/// To be called on a worker of a [`drift_core::stack::pool`] ([`Pool::install`]):
/// every file is parsed, lowered and dropped on the pool's stacks. The caller that
/// scans both languages runs them on one pool, side by side.
///
/// [`Pool::install`]: drift_core::stack::Pool::install
pub fn scan_walked(
    root: &Path,
    opts: &ScanOptions,
    walked: ingest::Walked,
    started_ns: u64,
) -> anyhow::Result<(RepoFacts, ScanStats)> {
    scan_inner(root, opts, Some((walked, started_ns)))
}

fn scan_inner(
    root: &Path,
    opts: &ScanOptions,
    walked: Option<(ingest::Walked, u64)>,
) -> anyhow::Result<(RepoFacts, ScanStats)> {
    let (walked, started) = match walked {
        Some(w) => w,
        None => {
            let started = index::now_ns();
            (
                ingest::walk(root, opts.threads, &repo::is_config_path)?,
                started,
            )
        }
    };
    let cache = opts
        .cache_dir
        .as_ref()
        .map(|d| FactCache::new(d, &parser_tag()));
    let old_index = opts
        .cache_dir
        .as_ref()
        .and_then(|d| index::Index::load(d, root));
    // Files whose stamp is unchanged since the last scan are not read again.
    let known = index::classify(walked.sources, old_index.as_ref(), cache.as_ref(), started);
    if let Some(d) = &opts.cache_dir {
        index::update(d, root, old_index.as_ref(), &known);
    }
    let mut skipped = walked.skipped;
    skipped.extend(known.iter().filter_map(|k| {
        k.skip.map(|reason| drift_core::Skipped {
            path: k.cand.rel_path.clone(),
            reason,
        })
    }));
    let mut lowered: Vec<(LoweredFile, bool)> = Vec::new();
    // Files that have no facts now (changed since the walk, or no stack to lower
    // them on) are skipped with their reason, never left out.
    for r in known
        .into_par_iter()
        .filter(|k| k.skip.is_none())
        .map(|k| index::into_lowered(k, cache.as_ref()))
        .collect::<Vec<_>>()
    {
        match r {
            Ok(f) => lowered.push(f),
            Err(Some(s)) => skipped.push(s),
            Err(None) => {}
        }
    }
    // Nothing more is parsed for a while: the workers' spare arenas go back now.
    rayon::broadcast(|_| arena::release_spare());
    let stats = ScanStats {
        files: lowered.len(),
        cache_hits: lowered.iter().filter(|(_, h)| *h).count(),
        parse_errors: lowered.iter().filter(|(f, _)| !f.raw.parse_ok).count(),
    };
    let files: Vec<LoweredFile> = lowered.into_iter().map(|(f, _)| f).collect();

    let config = repo::read_config(&walked.config);
    let resolver = ModuleResolver::new(root, workspace_from(root, &config.package_jsons));
    let mut linker = Linker::new(&resolver, &files);
    // Files that list what the last measured build did not are linked once more as
    // it listed them: what mining reads.
    let files_measured = measured_files(&files);
    let linker_measured = files_measured
        .as_ref()
        .map(|files| Linker::new(&resolver, files));
    let mut memo = PackageMemo::new();
    let packages: Vec<String> = files
        .iter()
        .map(|f| package_of(root, &f.abs_path, &mut memo))
        .collect();
    let by_path: BTreeMap<&str, &LoweredFile> =
        files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    let repo_types = |rel: &str| by_path.get(rel).map(|f| f.raw.types.clone());
    let types_cache = opts.cache_dir.as_deref().map(typeres::types_cache);
    let augmented = typeres::augmented_names(
        root,
        files.iter().map(|f| &*f.raw.types),
        &skipped,
        types_cache.as_ref(),
    );
    let types = typeres::TypeIndex::new(root, &resolver, &repo_types, augmented, types_cache);
    let facts: Vec<_> = files
        .par_iter()
        .zip(packages.into_par_iter())
        .enumerate()
        .map(|(i, (f, pkg))| {
            let mut facts = match (&linker_measured, &files_measured) {
                (Some(measured), Some(as_measured)) => linker
                    .link(f, pkg.clone())
                    .held_beside(measured.link(&as_measured[i], pkg)),
                _ => linker.link(f, pkg),
            };
            types.annotate(&mut facts);
            facts
        })
        .collect();
    // Every file is linked: what `origin` answered is not asked again.
    linker.forget_origins();

    let mut models: Vec<drift_core::Model> = files
        .iter()
        .flat_map(|f| {
            f.raw.models.iter().map(|m| drift_core::Model {
                path: f.rel_path.clone(),
                name: m.name.clone(),
                source: "drizzle".into(),
                line: m.line,
                fields: m.fields.clone(),
            })
        })
        .collect();
    models.extend(repo::schema_models(&config));
    let (lint, unread) = repo::lint_configs(&config);
    skipped.extend(unread);
    let mut repo = RepoFacts {
        schema_version: drift_core::FACTS_SCHEMA_VERSION,
        files: facts,
        skipped,
        models,
        packages: repo::packages(root, &resolver, &config),
        lint,
        context_files: vec![],
        key_files: vec![],
        integration_files: vec![],
        generated_clients: repo::generated_clients(&config),
    };
    repo::pair_tests(&mut repo);
    repo::mark_cli_entries(&mut repo, root, &config);
    let reexports: BTreeMap<String, repo::Reexports> = files
        .iter()
        .map(|f| {
            let specs = linker.specs_of(&f.rel_path);
            let resolve = |spec: &str| {
                specs
                    .and_then(|s| s.get(spec))
                    .cloned()
                    .unwrap_or_else(|| format!("unresolved:{spec}"))
            };
            (f.rel_path.clone(), repo::Reexports::of(&f.raw, resolve))
        })
        .collect();
    repo::client_leaks(&mut repo, &reexports);
    repo.normalize();
    // Declaration files the type index lowered left spare arenas on the workers.
    rayon::broadcast(|_| arena::release_spare());
    Ok((repo, stats))
}

/// The repo-level facts the TypeScript scan reads from config files: workspace
/// packages (`package.json`) and linter configs, from the config files of a walk
/// made with [`repo::is_config_path`]. The same values a full [`scan`] returns;
/// `None` when a JavaScript linter config could not be parsed for lack of stack
/// (a full scan records it as skipped).
pub fn config_facts(
    root: &Path,
    config: &[ingest::Candidate],
) -> Option<(Vec<drift_core::PackageFacts>, Vec<drift_core::LintConfig>)> {
    let config = repo::read_config(config);
    let resolver = ModuleResolver::new(root, workspace_from(root, &config.package_jsons));
    let packages = repo::packages(root, &resolver, &config);
    let (lint, unread) = repo::lint_configs(&config);
    unread.is_empty().then_some((packages, lint))
}

/// Facts for a file that is about to be written, from its content alone.
///
/// Used before a new file exists, to learn which symbol kinds and entry points it
/// will have. No other file is read, and workspace packages are not mapped, so
/// cross-file facts (mount prefixes, tests, client leaks) are absent and imports
/// of workspace packages stay `pkg:` ids. `Ok(None)` for content a scan would skip
/// (too large, minified, generated, nested too deep, too costly to parse); `Err` when
/// no stack to lower it on could be had, so what it declares is unknown.
pub fn preview_file(
    root: &Path,
    rel_path: &str,
    text: &str,
) -> Result<Option<FileFacts>, drift_core::stack::Unavailable> {
    if text.len() as u64 > ingest::MAX_FILE_BYTES
        || ingest::looks_minified(text)
        || ingest::has_generated_marker(text)
        || drift_core::nesting::too_deep(text, drift_core::nesting::Syntax::CLike)
        || drift_core::speculation::too_costly(
            text,
            drift_core::speculation::Dialect::of_path(rel_path),
        )
    {
        return Ok(None);
    }
    let raw = lower_on_stack(rel_path, text)?;
    // Over its parse budget ([`arena`]): skipped like content the read skips.
    if raw.skip.is_some() {
        return Ok(None);
    }
    let abs_path = root.join(rel_path);
    let file = LoweredFile {
        hash: ingest::hash_bytes(text.as_bytes()),
        raw,
        rel_path: rel_path.to_string(),
        abs_path: abs_path.clone(),
    };
    let resolver = ModuleResolver::new(root, BTreeMap::new());
    let files = [file];
    let linker = Linker::new(&resolver, &files);
    let package = package_of(root, &abs_path, &mut PackageMemo::new());
    let mut facts = match measured_files(&files) {
        Some(as_measured) => linker
            .link(&files[0], package.clone())
            .held_beside(Linker::new(&resolver, &as_measured).link(&as_measured[0], package)),
        None => linker.link(&files[0], package),
    };
    let only = |rel: &str| (rel == files[0].rel_path).then(|| files[0].raw.types.clone());
    let augmented = files[0].raw.types.augments.clone();
    typeres::TypeIndex::new(root, &resolver, &only, augmented, None).annotate(&mut facts);
    Ok(Some(facts))
}

/// One import specifier and how Drift resolved it (for differential testing).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportRow {
    pub file: String,
    pub spec: String,
    pub module: String,
    pub type_only: bool,
}

/// Every import and re-export specifier in the repo with its resolution, uncached.
pub fn debug_imports(root: &Path) -> anyhow::Result<Vec<ImportRow>> {
    let root = drift_core::fsutil::canonical(root)?;
    let ing = ingest::ingest(&root)?;
    // A file no stack could be had for is left out of this debug listing.
    let files: Vec<LoweredFile> = drift_core::stack::pool(0)?.install(|| {
        ing.files
            .into_par_iter()
            .filter_map(|f| {
                let raw = lower_on_stack(&f.rel_path, &f.text).ok()?;
                Some(LoweredFile {
                    rel_path: f.rel_path,
                    abs_path: f.abs_path,
                    hash: f.hash,
                    raw,
                })
            })
            .collect()
    });
    let resolver = ModuleResolver::new(&root, discover_workspace(&root));
    let linker = Linker::new(&resolver, &files);
    let mut rows = Vec::new();
    for f in &files {
        let Some(specs) = linker.specs_of(&f.rel_path) else {
            continue;
        };
        for i in &f.raw.imports {
            rows.push(ImportRow {
                file: f.rel_path.clone(),
                spec: i.spec.clone(),
                module: specs.get(&i.spec).cloned().unwrap_or_default(),
                type_only: i.type_only,
            });
        }
        for e in &f.raw.exports {
            if let lower::RawExportTarget::From { spec, .. }
            | lower::RawExportTarget::All { spec } = &e.target
            {
                rows.push(ImportRow {
                    file: f.rel_path.clone(),
                    spec: spec.clone(),
                    module: specs.get(spec).cloned().unwrap_or_default(),
                    type_only: false,
                });
            }
        }
    }
    rows.sort_by(|a, b| (&a.file, &a.spec).cmp(&(&b.file, &b.spec)));
    rows.dedup_by(|a, b| a.file == b.file && a.spec == b.spec);
    Ok(rows)
}

/// `files` as the last measured build listed them, where one of them lists what
/// that build did not ([`lower::RawFile::measured`]); none where no file does.
fn measured_files(files: &[LoweredFile]) -> Option<Vec<LoweredFile>> {
    files.iter().any(|f| f.raw.measured.is_some()).then(|| {
        files
            .iter()
            .map(|f| LoweredFile {
                rel_path: f.rel_path.clone(),
                abs_path: f.abs_path.clone(),
                hash: f.hash.clone(),
                raw: f
                    .raw
                    .measured
                    .as_deref()
                    .cloned()
                    .unwrap_or_else(|| f.raw.clone()),
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::{PackageMemo, package_of};

    /// One memo shared by every file, asked in either order, gives each file the
    /// package a fresh memo finds for it: the nearest `package.json` above it.
    #[test]
    fn remembered_packages_are_the_nearest_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for (rel, body) in [
            ("package.json", "{}"),
            ("packages/a/package.json", "{}"),
            ("packages/a/nested/b/package.json", "{}"),
            ("src/x.ts", ""),
            ("packages/a/src/deep/y.ts", ""),
            ("packages/a/nested/z.ts", ""),
            ("packages/a/nested/b/src/w.ts", ""),
            ("packages/c/v.ts", ""),
        ] {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let files = [
            ("src/x.ts", ""),
            ("packages/a/src/deep/y.ts", "packages/a"),
            ("packages/a/nested/z.ts", "packages/a"),
            ("packages/a/nested/b/src/w.ts", "packages/a/nested/b"),
            ("packages/c/v.ts", ""),
            ("packages/a/package.json", "packages/a"),
        ];
        for (rel, want) in files {
            assert_eq!(
                package_of(&root, &root.join(rel), &mut PackageMemo::new()),
                want,
                "{rel}"
            );
        }
        for reversed in [false, true] {
            let mut memo = PackageMemo::new();
            let mut order: Vec<_> = files.iter().chain(&files).collect();
            if reversed {
                order.reverse();
            }
            for (rel, want) in order {
                assert_eq!(
                    package_of(&root, &root.join(rel), &mut memo),
                    *want,
                    "{rel}"
                );
            }
        }
    }
}
