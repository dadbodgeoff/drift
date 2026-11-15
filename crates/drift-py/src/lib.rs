//! Drift's Python language parser, built on Astral's ruff parser.
//!
//! Pipeline: ingest (`.py`) -> lower each file (cached by content hash) ->
//! resolve imports with Python's semantics and follow re-exports -> framework
//! adapters (FastAPI, Flask, Django, DRF, Celery) -> [`RepoFacts`] in the same
//! language-neutral shape the TypeScript parser produces.

mod docs;
mod index;
pub mod kinds;
pub mod link;
pub mod lower;
pub mod packages;
pub mod project;
pub mod raw;
pub mod resolve;
pub mod stdlib;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use drift_core::cache::FactCache;
use drift_core::ingest::{self, Lang, PyWalked, rel_posix};
use drift_core::{FileFacts, FileRef, Model, PackageFacts, RepoFacts, in_integration_dir};
use rayon::prelude::*;

use crate::link::{Linker, LoweredFile};
use crate::lower::{LOWERING_VERSION, lower_on_stack};
use crate::project::Layout;
use crate::raw::{RawBase, RawBehind, RawRef, RawRegistration};
use crate::resolve::Resolver;

pub use crate::lower::KWARG_INDEX;

/// Parser tag used in cache keys.
pub fn parser_tag() -> String {
    format!("py-l{LOWERING_VERSION}-{}", env!("CARGO_PKG_VERSION"))
}

/// Most base-class files a single-file scan links; a longer chain falls back to a
/// full scan.
const MAX_BASE_FILES: usize = 64;

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

/// Nearest directory (repo-relative) holding `pyproject.toml`, `setup.cfg` or `setup.py`.
fn package_of(root: &Path, abs: &Path, memo: &mut BTreeMap<PathBuf, String>) -> String {
    let mut dir = abs.parent();
    let mut visited = Vec::new();
    let mut found = String::new();
    while let Some(d) = dir {
        if let Some(v) = memo.get(d) {
            found = v.clone();
            break;
        }
        visited.push(d.to_path_buf());
        if project::is_project(d) {
            found = rel_posix(root, d).unwrap_or_default();
            break;
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
    for p in visited {
        memo.insert(p, found.clone());
    }
    found
}

struct Prepared {
    files: Vec<LoweredFile>,
    skipped: Vec<drift_core::Skipped>,
    resolver: Resolver,
    stats: ScanStats,
    packages: Vec<PackageFacts>,
    declared: BTreeMap<String, Vec<drift_core::EntryPoint>>,
}

/// Absolute paths of every Python file a walk found, analysed or skipped: the
/// files [`packages::packages`] looks for projects around.
fn walked_paths(root: &Path, py: &PyWalked) -> Vec<PathBuf> {
    py.sources
        .iter()
        .map(|c| c.abs_path.clone())
        .chain(py.skipped.iter().map(|s| root.join(&s.path)))
        .collect()
}

/// Package facts of the Python projects in a walk (see [`packages`]).
pub fn packages_of(root: &Path, py: &PyWalked) -> Vec<PackageFacts> {
    let paths = walked_paths(root, py);
    packages::packages(root, paths.iter().map(PathBuf::as_path))
}

/// Entry points the repo's projects declare outside Python code ([`packages::declared_entries`]),
/// resolved to the files that define them: console scripts by module, LangGraph graphs
/// by path.
fn declared_of(
    root: &Path,
    paths: &[PathBuf],
    res: &Resolver,
) -> BTreeMap<String, Vec<drift_core::EntryPoint>> {
    let mut out: BTreeMap<String, Vec<drift_core::EntryPoint>> = BTreeMap::new();
    for d in packages::declared_entries(root, paths.iter().map(PathBuf::as_path)) {
        let (rel, attr) = match d.target {
            packages::EntryTarget::Module { module, attr } => {
                let id = res.resolve(&d.dir.join("__init__.py"), &module);
                if id.contains(':') {
                    continue;
                }
                (id, attr)
            }
            packages::EntryTarget::File { path, attr } => (path, attr),
        };
        let e = drift_core::EntryPoint {
            symbol: attr,
            kind: d.kind.into(),
            method: None,
            route: None,
            adapter: d.adapter.into(),
        };
        let v = out.entry(rel).or_default();
        if !v.contains(&e) {
            v.push(e);
        }
    }
    out
}

/// Directories holding Python files that were read or skipped by path, so project
/// discovery sees every project (as [`ingest::ingest_lang`] would).
fn layout_dirs<'a>(
    root: &Path,
    known: impl Iterator<Item = &'a Path>,
    skipped: &[drift_core::Skipped],
) -> BTreeSet<PathBuf> {
    let mut dirs: BTreeSet<PathBuf> = known
        .filter_map(|p| p.parent().map(Path::to_path_buf))
        .collect();
    dirs.extend(
        skipped
            .iter()
            .filter_map(|s| root.join(&s.path).parent().map(Path::to_path_buf)),
    );
    dirs
}

/// Walk, classify (reading only files the index cannot vouch for), lower. Runs on a
/// pool with the scan's large stacks.
fn prepare(
    root: &Path,
    opts: &ScanOptions,
    walked: Option<(PyWalked, u64)>,
) -> anyhow::Result<Prepared> {
    let (py, started) = match walked {
        Some(w) => w,
        None => {
            let started = index::now_ns();
            (
                ingest::walk(root, opts.threads, &|_| false)?.python,
                started,
            )
        }
    };
    let packages = packages_of(root, &py);
    let paths = walked_paths(root, &py);
    let cache = opts
        .cache_dir
        .as_ref()
        .map(|d| FactCache::new(d, &parser_tag()));
    let old_index = opts
        .cache_dir
        .as_ref()
        .and_then(|d| index::Index::load(d, root));
    let known = index::classify(py.sources, old_index.as_ref(), cache.as_ref(), started);
    if let Some(d) = &opts.cache_dir {
        index::update(d, root, old_index.as_ref(), &known);
    }
    let dirs = layout_dirs(
        root,
        known.iter().map(|k| k.cand.abs_path.as_path()),
        &py.skipped,
    );
    let mut skipped = py.skipped;
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
    skipped.sort();
    let stats = ScanStats {
        files: lowered.len(),
        cache_hits: lowered.iter().filter(|(_, h)| *h).count(),
        parse_errors: lowered.iter().filter(|(f, _)| !f.raw.parse_ok).count(),
    };
    let files = lowered.into_iter().map(|(f, _)| f).collect();
    let resolver = Resolver::new(root, Layout::discover(root, dirs));
    let declared = declared_of(root, &paths, &resolver);
    Ok(Prepared {
        files,
        skipped,
        resolver,
        stats,
        packages,
        declared,
    })
}

/// Scan a repository's Python code and return its facts. Output is deterministic.
pub fn scan(root: &Path, opts: &ScanOptions) -> anyhow::Result<(RepoFacts, ScanStats)> {
    let root = root.canonicalize()?;
    // Every file is parsed, lowered and dropped on these workers' stacks.
    drift_core::stack::pool(opts.threads)?.install(|| scan_inner(&root, opts, None))
}

/// [`scan`] of `root` (canonical) with the Python files of a walk of it already made
/// ([`ingest::Walked::python`]), so a caller that scans the walk's other files too
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
    py: PyWalked,
    started_ns: u64,
) -> anyhow::Result<(RepoFacts, ScanStats)> {
    scan_inner(root, opts, Some((py, started_ns)))
}

fn scan_inner(
    root: &Path,
    opts: &ScanOptions,
    walked: Option<(PyWalked, u64)>,
) -> anyhow::Result<(RepoFacts, ScanStats)> {
    let p = prepare(root, opts, walked)?;
    let linker = Linker::new(&p.resolver, &p.files).with_declared(p.declared.clone());
    let mut memo = BTreeMap::new();
    let packages: Vec<String> = p
        .files
        .iter()
        .map(|f| package_of(root, &f.abs_path, &mut memo))
        .collect();
    let link_all = |linker: &Linker| -> Vec<FileFacts> {
        (0..p.files.len())
            .into_par_iter()
            .map(|i| linker.link(i, packages[i].clone()))
            .collect()
    };
    let classified = |files: Vec<FileFacts>| -> Vec<FileFacts> {
        let mut repo = RepoFacts {
            files,
            ..empty_facts()
        };
        kinds::classify(&mut repo);
        repo.files.iter_mut().for_each(FileFacts::normalize);
        repo.files
    };
    // The second reading's tables are built beside the first link where the first
    // tables already met a listing made since (most do: a mount, a registration, a
    // hook); a listing only the link itself meets is found after it.
    let early = linker.lists_unmeasured();
    let (linked, measured) = rayon::join(
        || link_all(&linker),
        || early.then(|| linker.measured()).flatten(),
    );
    let measured = if early { measured } else { linker.measured() };
    // Mining's input is held at the listings of the last measured build: where the
    // ones made since change a file, the file is what mining reads, and keeps what
    // `drift security` and the practice map read beside it ([`drift_core::Listed`]).
    // Only the files the second link can read differently are linked again; kinds
    // are a matter of the whole repository, and are classified for each reading.
    let facts = match measured {
        None => classified(linked),
        Some(measured) => {
            let by_new = p
                .files
                .iter()
                .any(|f| f.raw.symbols.iter().any(|s| s.built_by_new));
            let held: Vec<FileFacts> = (0..p.files.len())
                .into_par_iter()
                .map(|i| {
                    if linker.links_differently(&measured, i, by_new) {
                        measured.link(i, packages[i].clone())
                    } else {
                        linked[i].clone()
                    }
                })
                .collect();
            // The two readings are classified side by side.
            let (mut held, full) = rayon::join(|| classified(held), || classified(linked));
            held.par_iter_mut()
                .zip(full)
                .for_each(|(held, full)| held.hold(full));
            held
        }
    };
    let models = p.files.iter().flat_map(models_of).collect();
    let mut repo = RepoFacts {
        schema_version: drift_core::FACTS_SCHEMA_VERSION,
        files: facts,
        skipped: p.skipped,
        models,
        packages: p.packages,
        // Python lint configs (ruff, flake8) are not read yet.
        lint: vec![],
        context_files: vec![],
        key_files: vec![],
        integration_files: vec![],
    };
    // A test file not parsed for lack of stack still exists: it pairs like the others.
    let parsed = repo.files.len();
    let unparsed_tests: Vec<FileFacts> = repo
        .stack_unavailable()
        .into_iter()
        .filter(|p| is_test_file(p))
        .map(|p| FileFacts {
            path: p.to_string(),
            package: package_of(root, &root.join(p), &mut memo),
            ..FileFacts::default()
        })
        .collect();
    repo.files.extend(unparsed_tests);
    pair_tests(&mut repo);
    repo.files.truncate(parsed);
    repo.normalize();
    // The lowered files (every raw fact of the repository, a great many small
    // allocations) are freed on the workers, side by side: one thread freeing them
    // in turn is time the caller waits for nothing.
    drop(linker);
    p.files.into_par_iter().for_each(drop);
    Ok((repo, p.stats))
}

/// The database models a lowered file declares.
fn models_of(f: &LoweredFile) -> impl Iterator<Item = Model> + '_ {
    f.raw.models.iter().map(|m| Model {
        path: f.rel_path.clone(),
        name: m.name.clone(),
        source: m.source.clone(),
        line: m.line,
        fields: m.fields.clone(),
    })
}

fn empty_facts() -> RepoFacts {
    RepoFacts {
        schema_version: drift_core::FACTS_SCHEMA_VERSION,
        ..RepoFacts::default()
    }
}

fn is_python_path(rel: &str) -> bool {
    Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ingest::PYTHON_EXTENSIONS.contains(&e))
}

/// Link `target` against the smallest set of files that gives the facts a link over
/// every file gives: start from `files` (sorted by path), and add the modules the
/// link looked up and did not have, from `load`, until none is missing. `load`
/// returns the files among the modules it is given that exist (in any order), or
/// `None` to give up. With `max_rounds`, stop early (best effort).
fn link_target(
    res: &Resolver,
    declared: &BTreeMap<String, Vec<drift_core::EntryPoint>>,
    mut files: Vec<LoweredFile>,
    target: &str,
    package: &str,
    max_rounds: Option<usize>,
    mut load: impl FnMut(&BTreeSet<String>) -> Option<Vec<LoweredFile>>,
) -> Option<FileFacts> {
    let mut tried: BTreeSet<String> = files.iter().map(|f| f.rel_path.clone()).collect();
    let mut round = 0;
    loop {
        let ti = files.iter().position(|f| f.rel_path == target)?;
        let (facts, misses, two_readings) = {
            let linker = Linker::tracking(res, &files, target).with_declared(declared.clone());
            // A listing mining does not read yet may be in this link: the file is
            // linked as mining reads it too ([`drift_core::Listed`]), its tables
            // built beside the first link where the first tables met one.
            let early = linker.lists_unmeasured();
            let (facts, measured) = rayon::join(
                || linker.link(ti, package.to_string()),
                || early.then(|| linker.measured()).flatten(),
            );
            let measured = if early { measured } else { linker.measured() };
            match measured {
                Some(measured) => {
                    let held = measured.link(ti, package.to_string());
                    let mut misses = linker.misses();
                    misses.extend(measured.misses());
                    let two = held != facts;
                    (held, misses, two)
                }
                None => (facts, linker.misses(), false),
            }
        };
        // Two readings of one file are a full scan's to give; a preview, which is
        // checked against conventions, is what mining reads.
        let done = |facts: FileFacts| (!two_readings || max_rounds.is_some()).then_some(facts);
        let want: BTreeSet<String> = misses
            .into_iter()
            .filter(|m| tried.insert(m.clone()))
            .collect();
        round += 1;
        if want.is_empty() || max_rounds.is_some_and(|m| round >= m) {
            return done(facts);
        }
        let new = load(&want)?;
        if new.is_empty() {
            return done(facts);
        }
        files.extend(new);
        files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    }
}

/// Facts for the single Python file `rel`, identical to its entry in a full [`scan`],
/// plus the database models it declares and the repo's Python packages (which checks
/// read). Other files and models are not included.
///
/// Returns `Ok(None)` when this cannot be done cheaply and exactly: no cache or no
/// index yet (a full scan writes one), `rel` is not a Python file, a file it
/// depends on can no longer be read, another production file names one of its
/// classes as a base (whether a class is a `base` counts its subclasses across the
/// repo), or the chain of its classes' in-repo bases is longer than
/// [`MAX_BASE_FILES`] files. The base classes' files come back as `context_files`.
/// Returns no files when `rel` is not analysed.
pub fn scan_file(root: &Path, opts: &ScanOptions, rel: &str) -> anyhow::Result<Option<RepoFacts>> {
    if !is_python_path(rel) || opts.cache_dir.is_none() {
        return Ok(None);
    }
    let root = root.canonicalize()?;
    let py = ingest::walk(&root, opts.threads, &|_| false)?.python;
    scan_file_walked(&root, opts, rel, py)
}

/// [`scan_file`] with the Python files of a walk of `root` (canonical) already made.
pub fn scan_file_walked(
    root: &Path,
    opts: &ScanOptions,
    rel: &str,
    py: PyWalked,
) -> anyhow::Result<Option<RepoFacts>> {
    if !is_python_path(rel) {
        return Ok(None);
    }
    let Some(cache_dir) = &opts.cache_dir else {
        return Ok(None);
    };
    let Some(index) = index::Index::load(cache_dir, root) else {
        return Ok(None);
    };
    let cache = FactCache::new(cache_dir, &parser_tag());
    // Every file is parsed, lowered and dropped on these workers' stacks.
    drift_core::stack::pool(opts.threads)?
        .install(|| scan_file_inner(root, cache_dir, &index, &cache, rel, py))
}

fn scan_file_inner(
    root: &Path,
    cache_dir: &Path,
    index: &index::Index,
    cache: &FactCache,
    rel: &str,
    py: PyWalked,
) -> anyhow::Result<Option<RepoFacts>> {
    let started = index::now_ns();
    let packages = packages_of(root, &py);
    let paths = walked_paths(root, &py);
    let known = index::classify(py.sources, Some(index), Some(cache), started);
    index::update(cache_dir, root, Some(index), &known);
    let kept: BTreeMap<&str, &index::Known> = known
        .iter()
        .filter(|k| k.skip.is_none())
        .map(|k| (k.cand.rel_path.as_str(), k))
        .collect();
    // Files not parsed for lack of stack: what they hold is unknown, so checks of
    // `rel` must know they are missing (it may be one, or read one).
    let no_stack: Vec<drift_core::Skipped> = known
        .iter()
        .filter(|k| k.skip == Some(drift_core::SkipReason::StackUnavailable))
        .map(|k| drift_core::Skipped {
            path: k.cand.rel_path.clone(),
            reason: drift_core::SkipReason::StackUnavailable,
        })
        .collect();
    let Some(target) = kept.get(rel) else {
        return Ok(Some(RepoFacts {
            skipped: no_stack,
            ..empty_facts()
        }));
    };
    let dirs = layout_dirs(
        root,
        known.iter().map(|k| k.cand.abs_path.as_path()),
        &py.skipped,
    );
    let resolver = Resolver::new(root, Layout::discover(root, dirs));
    let declared = declared_of(root, &paths, &resolver);
    let load = |want: &BTreeSet<String>| -> Option<Vec<LoweredFile>> {
        let ks: Vec<&index::Known> = want
            .iter()
            .filter_map(|m| kept.get(m.as_str()).copied())
            .collect();
        ks.into_par_iter()
            // A file without facts now (changed, no stack): a full scan records it.
            .map(|k| index::lowered(k, Some(cache)).ok().map(|(f, _)| f))
            .collect()
    };
    // The target and every file whose content reaches other files' facts. A beat
    // schedule adds `cron` entries only to a file that defines the Celery task it
    // names, and names tasks by Celery name, which any task file can claim first: so
    // when the target defines tasks and the repo has beats, every task file too.
    let tasks = target.tasks && kept.values().any(|k| k.beats);
    let callers = index::app_callers(kept.values().copied());
    let first: BTreeSet<String> = kept
        .values()
        .filter(|k| {
            k.global
                || (tasks && k.tasks)
                || callers.contains(k.cand.rel_path.as_str())
                || k.cand.rel_path == rel
        })
        .map(|k| k.cand.rel_path.clone())
        .collect();
    let Some(files) = load(&first) else {
        return Ok(None);
    };
    let models: Vec<Model> = files
        .iter()
        .filter(|f| f.rel_path == rel)
        .flat_map(models_of)
        .collect();
    let package = package_of(root, &target.cand.abs_path, &mut BTreeMap::new());
    let Some(facts) = link_target(&resolver, &declared, files, rel, &package, None, &load) else {
        return Ok(None);
    };
    // Another file was not parsed. What `rel` reads directly, its bases, routes and
    // test pairing are decided from these facts and `skipped` (`drift_mine::unchecked`);
    // a name imported from a module that star-imports (`from .core import *`) may stop
    // there when the module behind it was not parsed, which only that module's facts
    // show: a full scan decides then.
    if !no_stack.is_empty() {
        let modules: BTreeSet<&str> = facts
            .imports
            .iter()
            .map(|i| i.module.as_str())
            .chain(facts.symbols.iter().flat_map(|s| {
                s.wraps
                    .iter()
                    .map(|w| w.wrapper.as_str())
                    .chain(s.calls.iter().map(String::as_str))
                    .chain(s.throws.iter().map(String::as_str))
            }))
            .map(|r| r.split_once('#').map_or(r, |(m, _)| m))
            .filter(|m| *m != rel)
            .collect();
        let star = modules.iter().filter_map(|m| kept.get(m)).any(|k| {
            index::lowered(k, Some(cache)).map_or(true, |(f, _)| !f.raw.star_imports.is_empty())
        });
        if star {
            return Ok(None);
        }
    }
    // Kind facts ([`kinds::classify`]) read other files. When another production
    // file may extend one of its classes (`base` counts subclasses), a full scan
    // decides.
    let classes: BTreeSet<&str> = facts
        .symbols
        .iter()
        .filter(|s| s.kind == drift_core::SymbolKind::Class)
        .map(|s| s.name.as_str())
        .collect();
    let in_repo = |r: &str| {
        r.split_once('#')
            .is_some_and(|(m, _)| m != rel && kept.contains_key(m))
    };
    let extended_elsewhere = !classes.is_empty()
        && kept.values().any(|k| {
            k.cand.rel_path != rel
                && !kinds::is_test_code(&k.cand.rel_path)
                && k.bases.iter().any(|b| classes.contains(b.as_str()))
        });
    if extended_elsewhere {
        return Ok(None);
    }
    // The files of the in-repo bases, at any depth (inherited kinds, and rules that
    // follow base chains read them), and of in-repo decorators (whether one wraps a
    // task-queue decorator: jobs). Linked as a full scan links them.
    let link_file = |m: &str| -> Option<FileFacts> {
        let files = load(&std::iter::once(m.to_string()).collect())?;
        let k = kept.get(m)?;
        let pkg = package_of(root, &k.cand.abs_path, &mut BTreeMap::new());
        link_target(&resolver, &declared, files, m, &pkg, None, &load)
    };
    let modules_of = |f: &FileFacts, kind: drift_core::SymbolKind, wrap: drift_core::WrapKind| {
        f.symbols
            .iter()
            .filter(|s| s.kind == kind)
            .flat_map(|s| &s.wraps)
            .filter(|w| w.kind == wrap && in_repo(&w.wrapper))
            .filter_map(|w| w.wrapper.split_once('#').map(|(m, _)| m.to_string()))
            .collect::<BTreeSet<String>>()
    };
    let mut bases: BTreeMap<String, FileFacts> = BTreeMap::new();
    let mut frontier = modules_of(
        &facts,
        drift_core::SymbolKind::Class,
        drift_core::WrapKind::Extends,
    );
    while let Some(m) = frontier.pop_first() {
        if bases.contains_key(&m) {
            continue;
        }
        // A chain this long is not cut short: a full scan decides.
        if bases.len() >= MAX_BASE_FILES {
            return Ok(None);
        }
        let Some(f) = link_file(&m) else {
            return Ok(None);
        };
        frontier.extend(
            modules_of(
                &f,
                drift_core::SymbolKind::Class,
                drift_core::WrapKind::Extends,
            )
            .into_iter()
            .filter(|b| !bases.contains_key(b)),
        );
        bases.insert(m, f);
    }
    let mut others = bases.clone();
    for m in modules_of(
        &facts,
        drift_core::SymbolKind::Function,
        drift_core::WrapKind::Decorator,
    ) {
        if let std::collections::btree_map::Entry::Vacant(e) = others.entry(m) {
            let Some(f) = link_file(e.key()) else {
                return Ok(None);
            };
            e.insert(f);
        }
    }
    let mut mini = RepoFacts {
        files: std::iter::once(facts).chain(others.into_values()).collect(),
        ..empty_facts()
    };
    kinds::classify(&mut mini);
    let mut facts = mini.files.swap_remove(0);
    // Test pairing over the test files of the repo ([`pair_tests`]).
    let mut memo = BTreeMap::new();
    let mut pairing = RepoFacts {
        files: std::iter::once(rel)
            .chain(kept.keys().copied().filter(|p| is_test_file(p)))
            // A test file not parsed for lack of stack still exists.
            .chain(
                no_stack
                    .iter()
                    .map(|s| s.path.as_str())
                    .filter(|p| is_test_file(p)),
            )
            .map(|p| FileFacts {
                path: p.to_string(),
                package: if p == rel {
                    package.clone()
                } else {
                    package_of(root, &root.join(p), &mut memo)
                },
                ..FileFacts::default()
            })
            .collect(),
        ..empty_facts()
    };
    pair_tests(&mut pairing);
    facts.has_test = pairing.files[0].has_test;
    // Base files are context for rules about `rel`: their class symbols only.
    let context_files = bases
        .into_values()
        .map(|f| FileFacts {
            path: f.path,
            lang: f.lang,
            package: f.package,
            symbols: f
                .symbols
                .into_iter()
                .filter(|s| s.kind == drift_core::SymbolKind::Class)
                .collect(),
            ..FileFacts::default()
        })
        .collect();
    // Which `integration/` directories are test suites is learned from all their
    // files. It only decides anything about `rel` when `rel` is below one.
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
    let mut repo = RepoFacts {
        files: vec![facts],
        models,
        packages,
        context_files,
        skipped: no_stack,
        integration_files,
        ..empty_facts()
    };
    repo.normalize();
    Ok(Some(repo))
}

/// The Python files among `sources` (candidates of a walk of `root`, canonical)
/// that are below an `integration` directory and that a full scan analyses, as
/// [`RepoFacts::integration_files`] lists them: for a single-file scan of a file in
/// another language. The index (in `cache_dir`) vouches for unchanged files; any
/// other is read, not lowered.
pub fn integration_files(
    root: &Path,
    cache_dir: Option<&Path>,
    sources: &[ingest::Candidate],
) -> Vec<FileRef> {
    let cands: Vec<&ingest::Candidate> = sources
        .iter()
        .filter(|c| in_integration_dir(&c.rel_path))
        .collect();
    if cands.is_empty() {
        return vec![];
    }
    let index = cache_dir.and_then(|d| index::Index::load(d, root));
    let kept: Vec<&ingest::Candidate> = cands
        .into_par_iter()
        .filter(|c| index::analysed(c, index.as_ref()))
        .collect();
    let mut memo = BTreeMap::new();
    kept.into_iter()
        .map(|c| FileRef {
            path: c.rel_path.clone(),
            package: package_of(root, &c.abs_path, &mut memo),
        })
        .collect()
}

/// What [`preview_file`] learned about content that is about to be written.
#[derive(Debug, Clone, PartialEq)]
pub enum Preview {
    /// A scan would skip this content (too large, generated, minified, nested too
    /// deep, a stub or a generated file name): no convention applies to it.
    Skipped,
    /// The content does not parse, or could not be lowered (no stack to lower it or
    /// a module it imports on could be had): what it declares is unknown.
    Unparsed,
    /// Its facts and the database models it declares.
    Lowered {
        facts: Box<FileFacts>,
        models: Vec<Model>,
    },
}

/// Most in-repo modules a preview reads to resolve what the content imports.
const PREVIEW_MAX_FILES: usize = 64;
/// Most rounds of module loading a preview makes.
const PREVIEW_MAX_ROUNDS: usize = 6;

/// A Python file of the repo as a scan would lower it, read from disk for a preview;
/// `Ok(None)` for files a scan would skip or cannot read, `Err` when no stack to
/// lower it on could be had.
fn read_for_preview(
    root: &Path,
    module: &str,
) -> Result<Option<LoweredFile>, drift_core::stack::Unavailable> {
    let abs = root.join(module);
    let name = module.rsplit('/').next().unwrap_or(module);
    if !module.ends_with(".py") || ingest::has_generated_name_py(module, name) {
        return Ok(None);
    }
    let Some(text) = std::fs::symlink_metadata(&abs)
        .ok()
        .filter(|m| m.is_file() && m.len() <= ingest::MAX_FILE_BYTES)
        .and_then(|_| std::fs::read(&abs).ok())
    else {
        return Ok(None);
    };
    let hash = ingest::hash_bytes(&text);
    let Ok(text) = String::from_utf8(text) else {
        return Ok(None);
    };
    if ingest::has_generated_marker_py(&text)
        || ingest::looks_minified(&text)
        || drift_core::nesting::too_deep(&text, Lang::Python.syntax())
    {
        return Ok(None);
    }
    Ok(Some(LoweredFile {
        raw: lower_on_stack(module, &text)?,
        rel_path: module.to_string(),
        abs_path: abs,
        hash,
    }))
}

/// Facts for a Python file that is about to be written, from its content.
///
/// Used before a new file exists, to learn which symbol kinds and entry points it
/// will have. The modules it imports from the repo are read (a few levels, at most
/// [`PREVIEW_MAX_FILES`]) so routers, Celery apps and base classes defined elsewhere
/// are recognised; files that mount routers or register views elsewhere are not, so
/// inherited guards are absent and the route of a router is under a prefix that is
/// not known (`/?/users`). A class-based view (a DRF viewset,
/// a Django or Flask view class) that nothing registers yet is given the HTTP entry
/// points a registration would give it. Only this file's own project roots are
/// import roots, so imports of sibling projects stay `pkg:` ids.
pub fn preview_file(root: &Path, rel_path: &str, text: &str) -> Preview {
    let name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    if text.len() as u64 > ingest::MAX_FILE_BYTES
        || !name.ends_with(".py")
        || ingest::has_generated_name_py(rel_path, name)
        || ingest::has_generated_marker_py(text)
        || ingest::looks_minified(text)
        || drift_core::nesting::too_deep(text, Lang::Python.syntax())
    {
        return Preview::Skipped;
    }
    // On a thread whose stack covers the content and short modules, so most
    // previews start one thread; a longer module it imports gets its own.
    drift_core::stack::with_stack_for(text.len(), || preview_inner(root, rel_path, text))
        .unwrap_or(Preview::Unparsed)
}

fn preview_inner(root: &Path, rel: &str, text: &str) -> Preview {
    // No stack to lower it on: what it declares is unknown.
    let Ok(raw) = lower_on_stack(rel, text) else {
        return Preview::Unparsed;
    };
    if !raw.parse_ok {
        return Preview::Unparsed;
    }
    let abs = root.join(rel);
    let target = LoweredFile {
        hash: ingest::hash_bytes(text.as_bytes()),
        raw,
        rel_path: rel.to_string(),
        abs_path: abs.clone(),
    };
    let dirs = abs.parent().map(Path::to_path_buf).into_iter();
    let resolver = Resolver::new(root, Layout::discover(root, dirs));
    let package = package_of(root, &abs, &mut BTreeMap::new());
    // Modules read so far (`None`: not a file a scan would analyse), shared by both links.
    let mut read: BTreeMap<String, Option<LoweredFile>> = BTreeMap::new();
    let mut link = |target: &LoweredFile| {
        link_target(
            &resolver,
            &BTreeMap::new(),
            vec![target.clone()],
            rel,
            &package,
            Some(PREVIEW_MAX_ROUNDS),
            |want| {
                let mut out = Vec::new();
                for m in want {
                    if !read.contains_key(m) {
                        if read.len() >= PREVIEW_MAX_FILES {
                            break;
                        }
                        // A module no stack could be had for: the preview's facts
                        // would be incomplete, so it gives none.
                        read.insert(m.clone(), read_for_preview(root, m).ok()?);
                    }
                    out.extend(read[m].iter().cloned());
                }
                Some(out)
            },
        )
    };
    let mut target = target;
    let Some(mut facts) = link(&target) else {
        return Preview::Unparsed;
    };
    // View classes nothing registers yet get the entry points a registration gives.
    let entered: BTreeSet<&str> = facts
        .entry_points
        .iter()
        .map(|e| e.symbol.as_str())
        .collect();
    let unregistered: Vec<(String, String)> = target
        .raw
        .symbols
        .iter()
        .filter(|s| s.kind == drift_core::SymbolKind::Class && s.owner.is_none())
        .filter(|s| {
            let handlers: Vec<&str> = target
                .raw
                .symbols
                .iter()
                .filter(|h| h.owner.as_deref() == Some(s.name.as_str()))
                .map(|h| h.name.as_str())
                .collect();
            let viewish = s.view.is_some()
                || !handlers.is_empty()
                || s.wraps.iter().any(|(b, k)| {
                    *k == drift_core::WrapKind::Extends && lower::adapters::is_view_base(b)
                });
            viewish
                && !entered.contains(s.name.as_str())
                && !handlers.iter().any(|h| entered.contains(h))
        })
        .map(|s| {
            (
                s.name.clone(),
                s.view.clone().unwrap_or_else(|| "django".into()),
            )
        })
        .collect();
    if !unregistered.is_empty() {
        for (name, adapter) in unregistered {
            target.raw.registrations.push(RawRegistration {
                target: RawRef {
                    base: RawBase::Local(name),
                    member: String::new(),
                },
                router: None,
                adapter,
                route: String::new(),
                methods: vec![],
                guards: vec![],
                unmeasured: false,
                candidate: false,
                behind: RawBehind::default(),
                shapes: vec![],
                since_guards: vec![],
            });
        }
        match link(&target) {
            Some(f) => facts = f,
            None => return Preview::Unparsed,
        }
    }
    let models = models_of(&target).collect();
    Preview::Lowered {
        facts: Box::new(facts),
        models,
    }
}

/// True for pytest/unittest file names: `test_x.py`, `x_test.py`, `conftest.py`.
pub fn is_test_file(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    (file.starts_with("test_") && file.ends_with(".py"))
        || file.ends_with("_test.py")
        || file == "conftest.py"
}

/// Mark modules that have a test:
///
/// - `test_<stem>.py` or `<stem>_test.py` anywhere in the same package (pytest
///   collects tests by name, not by place);
/// - a test in a `tests/` (or `test/`) directory that mirrors the module's directory
///   and names the module's words in any order: `account/tests/mutations/auth/
///   test_token_create.py` tests `account/mutations/auth/create_token.py`. The
///   directory below `tests/` must be the end of the module's directory, and the
///   directory above it a prefix of it. One name's words may also be a subset of the
///   other's when the smaller has at least two (`test_external_authentication.py`
///   for `external_authentication_url.py`). A test directly in `tests/` (nothing
///   below it to mirror) only pairs within its own package: a top-level
///   `tests/test_utils.py` is not the test of every `utils.py`.
pub fn pair_tests(repo: &mut RepoFacts) {
    let mut tests: BTreeSet<(String, String)> = BTreeSet::new();
    let mut mirrored: MirroredTests = BTreeMap::new();
    for f in &repo.files {
        let file = f.path.rsplit('/').next().unwrap_or(&f.path);
        if let Some(stem) = file
            .strip_prefix("test_")
            .and_then(|s| s.strip_suffix(".py"))
            .or_else(|| file.strip_suffix("_test.py"))
        {
            tests.insert((f.package.clone(), stem.to_string()));
            let dirs: Vec<&str> = f.path.split('/').collect();
            let dirs = &dirs[..dirs.len() - 1];
            if let Some(i) = dirs.iter().rposition(|d| matches!(*d, "tests" | "test")) {
                let own = |s: &[&str]| s.iter().map(|d| (*d).to_string()).collect::<Vec<_>>();
                mirrored.entry(own(&dirs[i + 1..])).or_default().push((
                    own(&dirs[..i]),
                    f.package.clone(),
                    name_words(stem),
                ));
            }
        }
    }
    for f in &mut repo.files {
        let file = f.path.rsplit('/').next().unwrap_or(&f.path);
        if is_test_file(&f.path) || file == "__init__.py" {
            continue;
        }
        let stem = file.strip_suffix(".py").unwrap_or(file);
        f.has_test = tests.contains(&(f.package.clone(), stem.to_string()))
            || mirrored_test(&f.path, &f.package, stem, &mirrored);
    }
}

/// Tests in a `tests/` directory: directory below `tests/` -> (directory above it,
/// package, words of the tested name).
type MirroredTests = BTreeMap<Vec<String>, Vec<(Vec<String>, String, BTreeSet<String>)>>;

/// Lowercase words of a snake_case module name, singular (`tokens` -> `token`).
fn name_words(stem: &str) -> BTreeSet<String> {
    stem.split('_')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let w = w.to_ascii_lowercase();
            if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") {
                w[..w.len() - 1].to_string()
            } else {
                w
            }
        })
        .collect()
}

fn mirrored_test(path: &str, package: &str, stem: &str, mirrored: &MirroredTests) -> bool {
    let dirs: Vec<&str> = path.split('/').collect();
    let dirs = &dirs[..dirs.len() - 1];
    let words = name_words(stem);
    (0..=dirs.len()).any(|k| {
        let (above, below) = dirs.split_at(dirs.len() - k);
        let key: Vec<String> = below.iter().map(|d| (*d).to_string()).collect();
        mirrored.get(&key).is_some_and(|cands| {
            cands.iter().any(|(prefix, test_package, tw)| {
                (k > 0 || test_package == package)
                    && prefix.len() <= above.len()
                    && prefix.iter().zip(above).all(|(a, b)| a == b)
                    && (*tw == words
                        || (tw.len().min(words.len()) >= 2
                            && (tw.is_subset(&words) || words.is_subset(tw))))
            })
        })
    })
}

/// One import and how Drift resolved it (for differential testing against Python).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportRow {
    pub file: String,
    /// The module as written (`..models`), or `module:name` for a `from` name.
    pub spec: String,
    /// `import`, `from` (the module of a from-import) or `name` (one imported name).
    pub kind: &'static str,
    /// Module id; for `name` rows the submodule's id, or the attribute's origin `module#name`.
    pub module: String,
    pub type_only: bool,
}

/// Every import in the repo's Python files with its resolution, uncached.
pub fn debug_imports(root: &Path) -> anyhow::Result<Vec<ImportRow>> {
    let root = root.canonicalize()?;
    let p =
        drift_core::stack::pool(0)?.install(|| prepare(&root, &ScanOptions::default(), None))?;
    let linker = Linker::new(&p.resolver, &p.files);
    let mut rows = Vec::new();
    for (fi, f) in p.files.iter().enumerate() {
        let specs = linker.specs_of(fi);
        for i in &f.raw.imports {
            let module = specs
                .get(&i.spec)
                .cloned()
                .unwrap_or_else(|| format!("unresolved:{}", i.spec));
            rows.push(ImportRow {
                file: f.rel_path.clone(),
                spec: i.spec.clone(),
                kind: if i.from { "from" } else { "import" },
                module: module.clone(),
                type_only: i.type_only,
            });
            if !i.from {
                continue;
            }
            for n in &i.names {
                if n == "*" {
                    continue;
                }
                let o = linker.origin(&module, n);
                rows.push(ImportRow {
                    file: f.rel_path.clone(),
                    spec: format!("{}:{n}", i.spec),
                    kind: "name",
                    module: o
                        .strip_suffix("#*")
                        .map_or_else(|| link::fold_external(&o), String::from),
                    type_only: i.type_only,
                });
            }
        }
    }
    rows.sort_by(|a, b| (&a.file, &a.spec, a.kind).cmp(&(&b.file, &b.spec, b.kind)));
    rows.dedup_by(|a, b| a.file == b.file && a.spec == b.spec && a.kind == b.kind);
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::FileFacts;

    fn repo(paths: &[&str]) -> RepoFacts {
        RepoFacts {
            files: paths
                .iter()
                .map(|p| FileFacts {
                    path: (*p).into(),
                    lang: "py".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn mirrored_tests_pair_by_module_words() {
        let mut r = repo(&[
            "saleor/graphql/account/mutations/auth/create_token.py",
            "saleor/graphql/account/mutations/auth/deactivate_all_user_tokens.py",
            "saleor/graphql/account/mutations/auth/external_authentication_url.py",
            "saleor/graphql/account/mutations/auth/utils.py",
            "saleor/graphql/account/mixins.py",
            "saleor/graphql/order/mutations/auth/create_token.py",
            "saleor/graphql/account/tests/mutations/auth/test_token_create.py",
            "saleor/graphql/account/tests/mutations/auth/test_tokens_deactivate_all.py",
            "saleor/graphql/account/tests/mutations/auth/test_external_authentication.py",
            "saleor/graphql/account/tests/mutations/auth/test_token.py",
            // A test directly in `tests/` mirrors nothing: it pairs within its package.
            "tests/test_plugin_manager.py",
            "saleor/plugins/manager_plugin.py",
        ]);
        for f in &mut r.files {
            if f.path.starts_with("saleor/") {
                f.package = "saleor".into();
            }
        }
        pair_tests(&mut r);
        let tested: Vec<&str> = r
            .files
            .iter()
            .filter(|f| f.has_test)
            .map(|f| f.path.rsplit('/').next().unwrap())
            .collect();
        assert_eq!(
            tested,
            [
                "create_token.py",
                "deactivate_all_user_tokens.py",
                "external_authentication_url.py",
            ],
            "utils.py and mixins.py have no test; order's create_token.py is not under the mirrored directory"
        );
    }

    /// A Django project whose middleware is all the package's lists nothing made since
    /// the measured build: it is linked once (review 5, finding 7). Asking whether its
    /// own middleware scopes the caller's rows asked for the second reading even where
    /// there is none.
    #[test]
    fn django_with_package_middleware_only_is_linked_once() {
        let dir = tempfile::tempdir().unwrap();
        let w = |p: &str, t: &str| {
            let p = dir.path().join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w("requirements.txt", "django\n");
        w(
            "settings.py",
            "ROOT_URLCONF = \"app.urls\"\nINSTALLED_APPS = [\"django.contrib.auth\"]\nMIDDLEWARE = [\"django.contrib.sessions.middleware.SessionMiddleware\", \"django.contrib.auth.middleware.AuthenticationMiddleware\"]\n",
        );
        w("app/__init__.py", "");
        w(
            "app/views.py",
            "from django.http import JsonResponse\n\n\ndef items(request):\n    return JsonResponse({})\n",
        );
        w(
            "app/urls.py",
            "from django.urls import path\nfrom app import views\nurlpatterns = [path(\"items/\", views.items)]\n",
        );
        let root = dir.path().canonicalize().unwrap();
        let p = drift_core::stack::pool(0)
            .unwrap()
            .install(|| prepare(&root, &ScanOptions::default(), None))
            .unwrap();
        let linker = Linker::new(&p.resolver, &p.files);
        assert!(!linker.lists_unmeasured());
    }
}
