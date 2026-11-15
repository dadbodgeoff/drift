//! Walk a repository and decide which files to analyse.
//!
//! Safety rules (see the plan's threat model):
//! - never follow symlinks, never leave the root;
//! - respect `.gitignore`, skip dependency and build output directories;
//! - skip files over [`MAX_FILE_BYTES`], declaration files, generated and minified code,
//!   code nested too deep to parse safely ([`crate::nesting`]) and code too costly to
//!   parse ([`crate::speculation`]);
//! - paths are normalised to repo-relative POSIX form in Unicode NFC.

use std::fs;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::facts::{SkipReason, Skipped};

/// Files larger than this are skipped (1 MiB).
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// A single line longer than this marks a file as minified.
const MINIFIED_LINE_CHARS: usize = 5_000;

/// Directory names never analysed as source, even when not gitignored.
const EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    ".drift",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    "storybook-static",
];

/// Extensions the TypeScript/JavaScript parser accepts.
pub const SOURCE_EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

/// Extensions the Python parser accepts (`.pyi` stubs are skipped as declarations).
pub const PYTHON_EXTENSIONS: &[&str] = &["py", "pyi"];

/// Extra directory names never analysed for Python: virtualenvs, caches, build metadata.
/// (A directory holding `pyvenv.cfg` or `conda-meta/` is an environment whatever its name.)
const PYTHON_EXCLUDED_DIRS: &[&str] = &[
    "__pycache__",
    "__pypackages__",
    ".venv",
    "venv",
    ".tox",
    ".nox",
    ".eggs",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "site-packages",
];

/// A directory Python analysis enters although its name is excluded: a regular package
/// named `coverage` (it holds `__init__.py`). A coverage report (`coverage/` of
/// `lcov.info`, `index.html` and copied sources) never does, so it stays excluded, and
/// TypeScript analysis excludes `coverage/` as before.
fn python_package_dir(name: &str, path: &Path) -> bool {
    name == "coverage" && path.join("__init__.py").is_file()
}

/// Which language's files an ingest selects. Each language parser ingests its own files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    /// `.ts`, `.tsx`, `.js`, ... (see [`SOURCE_EXTENSIONS`]).
    TypeScript,
    /// `.py` and `.pyi` (see [`PYTHON_EXTENSIONS`]).
    Python,
}

impl Lang {
    fn extensions(self) -> &'static [&'static str] {
        match self {
            Lang::TypeScript => SOURCE_EXTENSIONS,
            Lang::Python => PYTHON_EXTENSIONS,
        }
    }

    fn excludes_dir(self, name: &str, path: &Path) -> bool {
        (self.excludes_dir_name(name) && !(self == Lang::Python && python_package_dir(name, path)))
            || (self == Lang::Python
                && (path.join("pyvenv.cfg").is_file() || path.join("conda-meta").is_dir()))
    }

    /// Directory names this language's analysis never enters.
    fn excludes_dir_name(self, name: &str) -> bool {
        EXCLUDED_DIRS.contains(&name)
            || (self == Lang::Python
                && (PYTHON_EXCLUDED_DIRS.contains(&name) || name.ends_with(".egg-info")))
    }

    /// The nesting syntax the depth guard scans this language with.
    pub fn syntax(self) -> crate::nesting::Syntax {
        match self {
            Lang::TypeScript => crate::nesting::Syntax::CLike,
            Lang::Python => crate::nesting::Syntax::Python,
        }
    }

    /// TypeScript/JavaScript: parsing `text` would re-read far more than its length
    /// ([`crate::speculation`]).
    fn too_costly(self, rel: &str, text: &str) -> bool {
        self == Lang::TypeScript
            && crate::speculation::too_costly(text, crate::speculation::Dialect::of_path(rel))
    }

    fn is_declaration(self, name: &str) -> bool {
        match self {
            Lang::TypeScript => is_declaration_file(name),
            Lang::Python => name.ends_with(".pyi"),
        }
    }

    fn is_generated_name(self, rel: &str, name: &str) -> bool {
        match self {
            Lang::TypeScript => has_generated_name(name),
            Lang::Python => has_generated_name_py(rel, name),
        }
    }

    fn has_generated_marker(self, text: &str) -> bool {
        match self {
            Lang::TypeScript => has_generated_marker(text),
            Lang::Python => has_generated_marker_py(text),
        }
    }
}

/// A file selected for analysis.
#[derive(Debug, Clone)]
pub struct SourceFile {
    /// Repo-relative POSIX path, NFC.
    pub rel_path: String,
    pub abs_path: PathBuf,
    /// UTF-8 source text.
    pub text: String,
    /// BLAKE3 of the bytes (hex).
    pub hash: String,
}

#[derive(Debug, Default)]
pub struct IngestResult {
    pub files: Vec<SourceFile>,
    pub skipped: Vec<Skipped>,
}

/// Normalise a path relative to `root` into POSIX, NFC form.
pub fn rel_posix(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut out = String::with_capacity(rel.as_os_str().len());
    for c in rel.components() {
        match c {
            std::path::Component::Normal(s) => {
                if !out.is_empty() {
                    out.push('/');
                }
                let s = s.to_string_lossy();
                // A name already in NFC (every ASCII name is) is its own normal form:
                // the walk names every file in the tree, so most skip the rebuild.
                if s.is_ascii() || unicode_normalization::is_nfc(&s) {
                    out.push_str(&s);
                } else {
                    out.extend(s.nfc());
                }
            }
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// Hash bytes with BLAKE3, returning lowercase hex.
pub fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn is_source(path: &Path, lang: Lang) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| lang.extensions().contains(&e))
}

fn is_declaration_file(name: &str) -> bool {
    name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
}

/// True when the file's *leading* comment block carries a generated-code marker.
///
/// Only the header counts: a doc comment such as "Auto-generated when omitted"
/// further down must not hide hand-written code from analysis (or let an agent
/// switch the gate off by mentioning the word).
pub fn has_generated_marker(text: &str) -> bool {
    let mut header = String::new();
    let mut in_block = false;
    for line in text.trim_start_matches('\u{feff}').lines().take(40) {
        let t = line.trim();
        if in_block {
            header.push_str(t);
            header.push('\n');
            if t.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if t.is_empty() || t.starts_with("#!") || t == "'use strict';" || t == "\"use strict\";" {
            continue;
        }
        if let Some(rest) = t.strip_prefix("//") {
            header.push_str(rest);
            header.push('\n');
        } else if t.starts_with("/*") {
            header.push_str(t);
            header.push('\n');
            in_block = !t.contains("*/");
        } else {
            break; // first line of code: the header is over
        }
    }
    let h = header.to_ascii_lowercase();
    [
        "@generated",
        "do not edit",
        "auto-generated",
        "autogenerated",
        "automatically generated",
        "code generated by",
        "generated by",
    ]
    .iter()
    .any(|m| h.contains(m))
}

/// `foo.gen.ts`, `foo.generated.tsx`, `foo_pb.js` style generated file names.
pub fn has_generated_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains(".gen.")
        || lower.contains(".generated.")
        || lower.ends_with("_pb.js")
        || lower.ends_with("_pb.ts")
}

/// Lowercased leading comment text of a Python file (`#` lines before the first
/// statement, skipping a shebang and encoding line).
fn python_header(text: &str) -> String {
    let mut header = String::new();
    for line in text.trim_start_matches('\u{feff}').lines().take(40) {
        let t = line.trim();
        if t.is_empty() || t.starts_with("#!") {
            continue;
        }
        match t.strip_prefix('#') {
            Some(rest) => {
                header.push_str(rest);
                header.push('\n');
            }
            None => break,
        }
    }
    header.to_ascii_lowercase()
}

/// Python counterpart of [`has_generated_marker`]: `# Generated by the protocol buffer
/// compiler.  DO NOT EDIT!`, `# Generated by Django 5.0 on ...`, `# @generated`.
pub fn has_generated_marker_py(text: &str) -> bool {
    let h = python_header(text);
    [
        "@generated",
        "do not edit",
        "auto-generated",
        "autogenerated",
        "automatically generated",
        "code generated by",
        "generated by",
    ]
    .iter()
    .any(|m| h.contains(m))
}

/// Generated Python by name or place: protobuf/gRPC output (`x_pb2.py`, `x_pb2_grpc.py`),
/// numbered Django migrations (`migrations/0001_initial.py`) and the `__init__.py` of a
/// `migrations/` package, and Alembic / Flask-Migrate revisions (`alembic/versions/*`,
/// `migrations/versions/*`). Other modules under a `migrations/` directory (Django's
/// own `django/db/migrations/autodetector.py`, an Alembic `env.py`) are code.
pub fn has_generated_name_py(rel: &str, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with("_pb2.py") || lower.ends_with("_pb2_grpc.py") || lower.ends_with("_pb2.pyi")
    {
        return true;
    }
    let dirs: Vec<&str> = rel.split('/').collect();
    let dirs = &dirs[..dirs.len().saturating_sub(1)];
    let numbered = |n: &str| {
        let b = n.as_bytes();
        b.len() > 8 && b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'_' && n.ends_with(".py")
    };
    match dirs.last() {
        Some(&"migrations") => numbered(name) || name == "__init__.py",
        Some(&"versions") => {
            dirs.len() >= 2 && matches!(dirs[dirs.len() - 2], "alembic" | "migrations")
        }
        _ => false,
    }
}

/// True when any line is long enough to indicate minified output.
pub fn looks_minified(text: &str) -> bool {
    text.lines().any(|l| l.len() > MINIFIED_LINE_CHARS)
}

/// Build a matcher from `.gitattributes` lines marked `linguist-generated`.
fn generated_attributes(root: &Path) -> Option<Gitignore> {
    let text = crate::fsutil::read_regular_to_string(
        &root.join(".gitattributes"),
        crate::fsutil::MAX_CONFIG_BYTES,
    )
    .ok()?;
    let mut b = GitignoreBuilder::new(root);
    let mut any = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let mut it = line.split_whitespace();
        let Some(pattern) = it.next() else { continue };
        let generated = it.any(|a| a == "linguist-generated" || a == "linguist-generated=true");
        if generated && b.add_line(None, pattern).is_ok() {
            any = true;
        }
    }
    if any { b.build().ok() } else { None }
}

/// The ignore files a walk reads in every directory (`.gitignore`, `.ignore`).
const IGNORE_FILES: &[&str] = &[".gitignore", ".ignore"];

/// An ignore file in `dir` the walker must not read: a FIFO, device or socket
/// (reading one blocks or never ends), or a link to anything outside `root` (such as
/// `/dev/zero`, which a repository can commit as a symbolic link). A regular file,
/// or a link to one inside the repository, is read as usual.
fn unsafe_ignore_file(root: &Path, dir: &Path) -> Option<PathBuf> {
    IGNORE_FILES.iter().find_map(|name| {
        let p = dir.join(name);
        let meta = fs::symlink_metadata(&p).ok()?;
        let t = meta.file_type();
        let ok = if t.is_symlink() {
            // Dangling, or a link to a directory: reading fails at once, harmlessly.
            match (fs::metadata(&p), p.canonicalize()) {
                (Ok(m), Ok(real)) => real.starts_with(root) && (m.is_file() || m.is_dir()),
                _ => true,
            }
        } else {
            t.is_file() || t.is_dir()
        };
        (!ok).then_some(p)
    })
}

/// Fail when the root's own ignore file is unsafe ([`unsafe_ignore_file`]): the
/// walker reads it before anything else, so the whole walk would hang.
fn check_root_ignore_files(root: &Path) -> anyhow::Result<()> {
    if let Some(p) = unsafe_ignore_file(root, root) {
        anyhow::bail!(
            "{} is not a regular file in the repository (a FIFO, a device, or a link outside it): refusing to read it",
            p.display()
        );
    }
    Ok(())
}

/// Whether the walk may enter the directory `dir`: not when one of its ignore
/// files is unsafe. The directory is skipped with one warning per process.
fn may_enter(root: &Path, dir: &Path) -> bool {
    let Some(p) = unsafe_ignore_file(root, dir) else {
        return true;
    };
    static WARNED: std::sync::Mutex<std::collections::BTreeSet<PathBuf>> =
        std::sync::Mutex::new(std::collections::BTreeSet::new());
    if WARNED.lock().is_ok_and(|mut w| w.insert(p.clone())) {
        eprintln!(
            "drift: skipping {}: {} is not a regular file (a FIFO, a device, or a link outside the repository)",
            rel_posix(root, dir).unwrap_or_default(),
            rel_posix(root, &p).unwrap_or_default()
        );
    }
    false
}

/// Directories a walk never enters (dependencies, VCS, build output, Drift's own cache).
const WALK_EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    ".turbo",
    ".drift",
    "dist",
    "build",
];

/// What `stat` says about a file: enough to tell that it changed since it was read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileStamp {
    pub size: u64,
    /// Modification and status-change times in nanoseconds since the epoch.
    pub mtime_ns: u64,
    pub ctime_ns: u64,
    pub ino: u64,
}

impl FileStamp {
    pub fn of(meta: &fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let ns = |s: i64, n: i64| (s.max(0) as u64) * 1_000_000_000 + n.max(0) as u64;
            Self {
                size: meta.len(),
                mtime_ns: ns(meta.mtime(), meta.mtime_nsec()),
                ctime_ns: ns(meta.ctime(), meta.ctime_nsec()),
                ino: meta.ino(),
            }
        }
        #[cfg(not(unix))]
        {
            let mtime_ns = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos() as u64);
            Self {
                size: meta.len(),
                mtime_ns,
                ctime_ns: mtime_ns,
                ino: 0,
            }
        }
    }

    /// Latest of the modification and status-change times.
    pub fn changed_ns(&self) -> u64 {
        self.mtime_ns.max(self.ctime_ns)
    }
}

/// A file found by [`walk`], not read yet.
#[derive(Debug, Clone)]
pub struct Candidate {
    /// Repo-relative POSIX path, NFC.
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub stamp: FileStamp,
}

/// Python files found by [`walk`], with Python's directory exclusions applied
/// (the same files [`ingest_lang`] visits for [`Lang::Python`]).
#[derive(Debug, Default)]
pub struct PyWalked {
    /// `.py` files that pass the path-level filters, sorted by path. Their content is
    /// checked by [`read_source_lang`].
    pub sources: Vec<Candidate>,
    /// Python files skipped for path-level reasons (generated name, `.pyi`, size).
    pub skipped: Vec<Skipped>,
}

/// One walk of the repository.
#[derive(Debug, Default)]
pub struct Walked {
    /// Source files that pass the path-level filters, sorted by path. Their content
    /// is checked by [`read_source`].
    pub sources: Vec<Candidate>,
    /// Source files skipped for path-level reasons (name, declaration, size).
    pub skipped: Vec<Skipped>,
    /// Files the repo passes read (`package.json`, `*.prisma`, `*.sql`, linter
    /// configs), sorted by path, at most [`MAX_FILE_BYTES`] each. They may sit in
    /// directories that source analysis excludes (`vendor/`, `out/`).
    pub config: Vec<Candidate>,
    /// Python files, for the Python parser (TypeScript analysis ignores them).
    pub python: PyWalked,
}

/// Walk `root` once: TypeScript/JavaScript source candidates for analysis, the
/// files `is_config` selects by repo-relative path (read by repo-level passes), and
/// Python source candidates ([`Walked::python`]).
/// Never follows symlinks; respects `.gitignore` and `.ignore` files (not global or
/// `.git/info/exclude` rules, so results do not depend on the machine). `threads` 0
/// means the walker's default. Output is sorted by path.
pub fn walk(
    root: &Path,
    threads: usize,
    is_config: &(dyn Fn(&str) -> bool + Sync),
) -> anyhow::Result<Walked> {
    let root = root.canonicalize()?;
    check_root_ignore_files(&root)?;
    let generated = generated_attributes(&root);
    let filter_root = root.clone();
    let walker = WalkBuilder::new(&root)
        .follow_links(false)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .threads(threads)
        .filter_entry(move |e| {
            let name = e.file_name().to_string_lossy();
            let dir = e.file_type().is_some_and(|t| t.is_dir());
            !(dir && WALK_EXCLUDED_DIRS.contains(&name.as_ref()))
                && (!dir || may_enter(&filter_root, e.path()))
        })
        .build_parallel();
    // (candidate, TypeScript source, config, Python source, name not UTF-8)
    type Found = (Candidate, bool, bool, bool, bool);
    let found: std::sync::Mutex<Vec<Found>> = std::sync::Mutex::new(Vec::new());
    walker.run(|| {
        let root = &root;
        let found = &found;
        Box::new(move |entry| {
            let Ok(entry) = entry else {
                return ignore::WalkState::Continue;
            };
            let is_file = entry
                .file_type()
                .is_some_and(|ft| ft.is_file() && !ft.is_symlink());
            if !is_file {
                return ignore::WalkState::Continue;
            }
            let path = entry.path();
            let Some(rel) = rel_posix(root, path) else {
                return ignore::WalkState::Continue;
            };
            let source = is_source(path, Lang::TypeScript);
            let config = is_config(&rel);
            let python = is_source(path, Lang::Python);
            if !source && !config && !python {
                return ignore::WalkState::Continue;
            }
            let Ok(meta) = entry.metadata() else {
                return ignore::WalkState::Continue;
            };
            let c = Candidate {
                rel_path: rel,
                abs_path: path.to_path_buf(),
                stamp: FileStamp::of(&meta),
            };
            // A path that is not UTF-8 has no exact repo-relative name: two such
            // files could share one (`?` for each bad byte).
            let bad_name = path.to_str().is_none();
            if let Ok(mut f) = found.lock() {
                f.push((c, source, config, python, bad_name));
            }
            ignore::WalkState::Continue
        })
    });
    let mut found = found.into_inner().unwrap_or_default();
    // By name on disk too, so files whose names normalise alike (NFC and NFD forms
    // of one name) come in the same order on every walk; only the first is kept.
    found.sort_by(|a, b| {
        (a.0.rel_path.as_str(), &a.0.abs_path).cmp(&(b.0.rel_path.as_str(), &b.0.abs_path))
    });
    found.dedup_by(|b, a| a.0.rel_path == b.0.rel_path);

    let mut out = Walked::default();
    let mut envs = EnvDirs::default();
    for (c, source, config, python, bad_name) in found {
        if bad_name {
            let skip = Skipped {
                path: c.rel_path,
                reason: SkipReason::NotUtf8,
            };
            if python {
                out.python.skipped.push(skip);
            } else if source {
                out.skipped.push(skip);
            }
            continue;
        }
        // A file can be both (`eslint.config.js`).
        if config && c.stamp.size <= MAX_FILE_BYTES {
            out.config.push(c.clone());
        }
        if python {
            walk_python(&root, &c, generated.as_ref(), &mut envs, &mut out.python);
        }
        if !source {
            continue;
        }
        // Source analysis also skips these directories (the config walk does not).
        let mut dirs = c.rel_path.split('/');
        dirs.next_back();
        if dirs.any(|d| EXCLUDED_DIRS.contains(&d)) {
            continue;
        }
        let name = c.rel_path.rsplit('/').next().unwrap_or(&c.rel_path);
        let reason = if has_generated_name(name) {
            Some(SkipReason::Generated)
        } else if is_declaration_file(name) {
            Some(SkipReason::Declaration)
        } else if generated.as_ref().is_some_and(|g| {
            g.matched_path_or_any_parents(&c.abs_path, false)
                .is_ignore()
        }) {
            Some(SkipReason::Generated)
        } else if c.stamp.size > MAX_FILE_BYTES {
            Some(SkipReason::TooLarge)
        } else {
            None
        };
        match reason {
            Some(reason) => out.skipped.push(Skipped {
                path: c.rel_path,
                reason,
            }),
            None => out.sources.push(c),
        }
    }
    out.skipped.sort();
    out.python.skipped.sort();
    Ok(out)
}

/// Directories (absolute) already checked for being a Python environment.
#[derive(Default)]
struct EnvDirs(std::collections::HashMap<PathBuf, bool>);

impl EnvDirs {
    /// True when `dir` holds `pyvenv.cfg` or `conda-meta/`, as [`Lang::excludes_dir`] checks.
    fn is_env(&mut self, dir: &Path) -> bool {
        if let Some(v) = self.0.get(dir) {
            return *v;
        }
        let v = dir.join("pyvenv.cfg").is_file() || dir.join("conda-meta").is_dir();
        self.0.insert(dir.to_path_buf(), v);
        v
    }
}

/// Apply [`ingest_lang`]'s Python rules to a walked `.py`/`.pyi` file: directories it
/// would not enter, then the path-level skips in the same order.
fn walk_python(
    root: &Path,
    c: &Candidate,
    generated: Option<&Gitignore>,
    envs: &mut EnvDirs,
    out: &mut PyWalked,
) {
    let name = c.rel_path.rsplit('/').next().unwrap_or_default();
    // Every directory between the root and the file, by its name on disk.
    let mut dir = c.abs_path.parent();
    while let Some(d) = dir.filter(|d| *d != root && d.starts_with(root)) {
        let dname = d
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default();
        if (Lang::Python.excludes_dir_name(&dname) && !python_package_dir(&dname, d))
            || envs.is_env(d)
        {
            return;
        }
        dir = d.parent();
    }
    let reason = if Lang::Python.is_generated_name(&c.rel_path, name) {
        Some(SkipReason::Generated)
    } else if Lang::Python.is_declaration(name) {
        Some(SkipReason::Declaration)
    } else if generated.is_some_and(|g| {
        g.matched_path_or_any_parents(&c.abs_path, false)
            .is_ignore()
    }) {
        Some(SkipReason::Generated)
    } else if c.stamp.size > MAX_FILE_BYTES {
        Some(SkipReason::TooLarge)
    } else {
        None
    };
    match reason {
        Some(reason) => out.skipped.push(Skipped {
            path: c.rel_path.clone(),
            reason,
        }),
        None => out.sources.push(c.clone()),
    }
}

/// What reading a candidate found.
#[derive(Debug)]
pub enum Read {
    Source(SourceFile),
    /// Skipped for its content (not UTF-8, generated header, minified); `hash` is of the bytes.
    Skipped {
        hash: String,
        reason: SkipReason,
    },
}

/// Read a TypeScript/JavaScript candidate and apply the content filters. `None` when it cannot be read.
pub fn read_source(c: &Candidate) -> Option<Read> {
    read_source_lang(c, Lang::TypeScript)
}

/// Read a candidate of `lang` and apply that language's content filters, in the
/// order [`ingest_lang`] applies them. `None` when it cannot be read.
pub fn read_source_lang(c: &Candidate, lang: Lang) -> Option<Read> {
    let bytes = fs::read(&c.abs_path).ok()?;
    let hash = hash_bytes(&bytes);
    let text = match String::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => {
            return Some(Read::Skipped {
                hash,
                reason: SkipReason::NotUtf8,
            });
        }
    };
    // The same content gates, in the same order, as `ingest_lang`.
    let reason = if lang.has_generated_marker(&text) {
        Some(SkipReason::Generated)
    } else if looks_minified(&text) {
        Some(SkipReason::Minified)
    } else if crate::nesting::too_deep(&text, lang.syntax()) {
        Some(SkipReason::TooDeep)
    } else if lang.too_costly(&c.rel_path, &text) {
        Some(SkipReason::TooCostly)
    } else {
        None
    };
    Some(match reason {
        Some(reason) => Read::Skipped { hash, reason },
        None => Read::Source(SourceFile {
            rel_path: c.rel_path.clone(),
            abs_path: c.abs_path.clone(),
            text,
            hash,
        }),
    })
}

/// Walk `root` and return the TypeScript/JavaScript files to analyse plus the ones
/// skipped and why.
///
/// Output is sorted by path, so it does not depend on filesystem walk order.
pub fn ingest(root: &Path) -> anyhow::Result<IngestResult> {
    ingest_lang(root, Lang::TypeScript)
}

/// Walk `root` and return `lang`'s files to analyse plus the ones skipped and why.
pub fn ingest_lang(root: &Path, lang: Lang) -> anyhow::Result<IngestResult> {
    let root = root.canonicalize()?;
    check_root_ignore_files(&root)?;
    let generated = generated_attributes(&root);
    let mut out = IngestResult::default();

    let filter_root = root.clone();
    let walker = WalkBuilder::new(&root)
        .follow_links(false)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .filter_entry(move |e| {
            let name = e.file_name().to_string_lossy();
            let dir = e.file_type().is_some_and(|t| t.is_dir());
            !(dir && lang.excludes_dir(&name, e.path()))
                && (!dir || may_enter(&filter_root, e.path()))
        })
        .build();

    for entry in walker {
        let Ok(entry) = entry else { continue };
        let Some(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_file() || ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if !is_source(path, lang) {
            continue;
        }
        let Some(rel) = rel_posix(&root, path) else {
            continue;
        };
        if path.to_str().is_none() {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::NotUtf8,
            });
            continue;
        }
        let name = entry.file_name().to_string_lossy();

        if lang.is_generated_name(&rel, &name) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::Generated,
            });
            continue;
        }
        if lang.is_declaration(&name) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::Declaration,
            });
            continue;
        }
        if let Some(g) = &generated
            && g.matched_path_or_any_parents(path, false).is_ignore()
        {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::Generated,
            });
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > MAX_FILE_BYTES {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::TooLarge,
            });
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        let hash = hash_bytes(&bytes);
        let Ok(text) = String::from_utf8(bytes) else {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::NotUtf8,
            });
            continue;
        };
        if lang.has_generated_marker(&text) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::Generated,
            });
            continue;
        }
        if looks_minified(&text) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::Minified,
            });
            continue;
        }
        if crate::nesting::too_deep(&text, lang.syntax()) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::TooDeep,
            });
            continue;
        }
        if lang.too_costly(&rel, &text) {
            out.skipped.push(Skipped {
                path: rel,
                reason: SkipReason::TooCostly,
            });
            continue;
        }
        out.files.push(SourceFile {
            rel_path: rel,
            abs_path: path.to_path_buf(),
            text,
            hash,
        });
    }

    out.files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out.skipped.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    #[test]
    fn selects_sources_and_skips_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "src/a.ts", "export const a = 1;\n");
        write(
            r,
            "src/b.tsx",
            "export default function B() { return null }\n",
        );
        write(r, "src/types.d.ts", "declare const x: number;\n");
        write(r, "src/gen.ts", "// @generated by protoc\nexport {}\n");
        write(r, "src/min.js", &format!("var a={};\n", "1".repeat(6000)));
        write(r, "node_modules/x/index.js", "module.exports = 1\n");
        write(r, "dist/a.js", "1\n");
        write(r, "README.md", "# hi\n");

        let res = ingest(r).unwrap();
        let paths: Vec<_> = res.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["src/a.ts", "src/b.tsx"]);
        let skipped: Vec<_> = res
            .skipped
            .iter()
            .map(|s| (s.path.as_str(), s.reason))
            .collect();
        assert_eq!(
            skipped,
            [
                ("src/gen.ts", SkipReason::Generated),
                ("src/min.js", SkipReason::Minified),
                ("src/types.d.ts", SkipReason::Declaration),
            ]
        );
    }

    #[test]
    fn respects_gitignore_and_linguist_generated() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, ".gitignore", "ignored/\n");
        write(r, ".gitattributes", "src/api/** linguist-generated=true\n");
        write(r, "ignored/x.ts", "export {}\n");
        write(r, "src/api/client.ts", "export {}\n");
        write(r, "src/ok.ts", "export {}\n");
        let res = ingest(r).unwrap();
        let paths: Vec<_> = res.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["src/ok.ts"]);
        assert_eq!(res.skipped[0].reason, SkipReason::Generated);
    }

    #[test]
    fn generated_markers_only_count_in_the_header() {
        assert!(has_generated_marker("// @generated by protoc\nexport {}\n"));
        assert!(has_generated_marker(
            "#!/usr/bin/env node\n/**\n * DO NOT EDIT: generated by openapi\n */\nexport {}\n"
        ));
        assert!(!has_generated_marker(
            "import x from 'y';\n/** Stable id. Auto-generated when omitted. */\nexport const a = 1;\n"
        ));
        assert!(!has_generated_marker(
            "export const t = `<!-- AUTOGENERATED: DO NOT EDIT -->`;\n"
        ));
        assert!(!has_generated_marker(
            "// Removes some auto-generated text\n".repeat(0).as_str()
        ));
        assert!(has_generated_name("routeTree.gen.ts"));
        assert!(has_generated_name("schema.generated.tsx"));
        assert!(!has_generated_name("generator.ts"));
    }

    #[test]
    fn python_ingest_selects_python_and_skips_stubs_venvs_and_generated() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "app/main.py", "import os\n");
        write(r, "app/main.ts", "export {}\n");
        write(r, "app/types.pyi", "def f() -> int: ...\n");
        write(r, "app/api_pb2.py", "x = 1\n");
        write(
            r,
            "app/gen.py",
            "#!/usr/bin/env python\n# Generated by the protocol buffer compiler.  DO NOT EDIT!\nx = 1\n",
        );
        write(r, "shop/migrations/0001_initial.py", "x = 1\n");
        write(r, "shop/migrations/__init__.py", "");
        write(r, "lib/migrations/autodetector.py", "x = 1\n");
        write(r, "migrations/versions/ab12_add.py", "x = 1\n");
        write(r, "condaenv/conda-meta/history", "\n");
        write(r, "condaenv/lib/python3.12/os.py", "x = 1\n");
        write(
            r,
            "deep.py",
            &format!("x = {}1{}\n", "(\n".repeat(2000), "\n)".repeat(2000)),
        );
        write(
            r,
            "deep.ts",
            &format!(
                "export const x = {}1{};\n",
                "(\n".repeat(2000),
                "\n)".repeat(2000)
            ),
        );
        write(r, "app/__pycache__/main.py", "x = 1\n");
        write(r, "env/pyvenv.cfg", "home = /usr\n");
        write(r, "env/lib/x.py", "x = 1\n");
        write(r, ".venv/lib/y.py", "x = 1\n");
        write(r, "pkg.egg-info/z.py", "x = 1\n");
        write(r, "app/doc.py", "x = 1\n# generated by hand, later\n");
        let res = ingest_lang(r, Lang::Python).unwrap();
        let paths: Vec<_> = res.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "app/doc.py",
                "app/main.py",
                "lib/migrations/autodetector.py"
            ]
        );
        let skipped: Vec<_> = res
            .skipped
            .iter()
            .map(|s| (s.path.as_str(), s.reason))
            .collect();
        assert_eq!(
            skipped,
            [
                ("app/api_pb2.py", SkipReason::Generated),
                ("app/gen.py", SkipReason::Generated),
                ("app/types.pyi", SkipReason::Declaration),
                ("deep.py", SkipReason::TooDeep),
                ("migrations/versions/ab12_add.py", SkipReason::Generated),
                ("shop/migrations/0001_initial.py", SkipReason::Generated),
                ("shop/migrations/__init__.py", SkipReason::Generated),
            ]
        );
        // The walk selects the same Python files, with the same skips once read.
        let walked = walk(r, 0, &|_| false).unwrap().python;
        let mut skipped_by_walk = walked.skipped.clone();
        let mut read_paths = Vec::new();
        for c in &walked.sources {
            match read_source_lang(c, Lang::Python).unwrap() {
                Read::Source(f) => read_paths.push(f.rel_path),
                Read::Skipped { reason, .. } => skipped_by_walk.push(Skipped {
                    path: c.rel_path.clone(),
                    reason,
                }),
            }
        }
        skipped_by_walk.sort();
        assert_eq!(read_paths, paths);
        assert_eq!(skipped_by_walk, res.skipped);
        // The TypeScript ingest is unchanged and never sees Python.
        let ts = ingest(r).unwrap();
        let paths: Vec<_> = ts.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["app/main.ts"]);
        assert_eq!(ts.skipped[0].path, "deep.ts");
        assert_eq!(ts.skipped[0].reason, SkipReason::TooDeep);
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_symlinks_out_of_root() {
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), "secret.ts", "export const s = 1\n");
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/a.ts", "export {}\n");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.ts"),
            dir.path().join("src/s.ts"),
        )
        .unwrap();
        let res = ingest(dir.path()).unwrap();
        let paths: Vec<_> = res.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["src/a.ts"]);
    }

    #[test]
    fn rel_paths_are_posix_and_nfc() {
        let root = Path::new("/r");
        // "e" + combining acute (NFD) normalises to the precomposed form.
        let p = Path::new("/r/caf\u{0065}\u{0301}/x.ts");
        assert_eq!(rel_posix(root, p).unwrap(), "caf\u{00e9}/x.ts");
        assert!(rel_posix(root, Path::new("/other/x.ts")).is_none());
        // Names already in NFC (ASCII or not) are kept as they are, empty components
        // and `.` dropped, as when every name was rebuilt.
        for (path, want) in [
            ("/r/src/./a.ts", "src/a.ts"),
            ("/r/caf\u{00e9}/\u{4e2d}/x.ts", "caf\u{00e9}/\u{4e2d}/x.ts"),
            ("/r/a\u{0308}/\u{00f1}/x.ts", "\u{00e4}/\u{00f1}/x.ts"),
            ("/r", ""),
        ] {
            let p = Path::new(path);
            assert_eq!(rel_posix(root, p).unwrap(), want, "{path}");
            let slow: Vec<String> = p
                .strip_prefix(root)
                .unwrap()
                .components()
                .filter_map(|c| match c {
                    std::path::Component::Normal(s) => {
                        Some(s.to_string_lossy().nfc().collect::<String>())
                    }
                    _ => None,
                })
                .collect();
            assert_eq!(rel_posix(root, p).unwrap(), slow.join("/"), "{path}");
        }
        assert!(rel_posix(root, Path::new("/r/../x.ts")).is_none());
    }

    /// `f` on another thread: `None` when it has not finished within `secs` (a hang).
    fn within<T: Send + 'static>(secs: u64, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(std::time::Duration::from_secs(secs)).ok()
    }

    #[cfg(unix)]
    fn mkfifo(p: &Path) -> bool {
        std::process::Command::new("mkfifo")
            .arg(p)
            .status()
            .is_ok_and(|s| s.success())
    }

    /// A `.gitignore` the walker would block on (a FIFO) or read forever (a link to
    /// `/dev/zero`, which git can commit): its directory is skipped, the rest walked.
    #[cfg(unix)]
    #[test]
    fn unsafe_ignore_files_skip_their_directory_instead_of_hanging() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path().to_path_buf();
        write(&r, "src/a.ts", "export const a = 1;\n");
        write(&r, "fifo/b.ts", "export const b = 1;\n");
        write(&r, "zero/c.ts", "export const c = 1;\n");
        write(&r, "linked/d.ts", "export const d = 1;\n");
        write(&r, "inside/e.ts", "export const e = 1;\n");
        write(&r, "shared.gitignore", "*.gen.ts\n");
        std::os::unix::fs::symlink("/dev/zero", r.join("zero/.gitignore")).unwrap();
        std::os::unix::fs::symlink("/etc/hostname", r.join("linked/.ignore")).unwrap();
        // A link to a regular file inside the repository is read as before.
        std::os::unix::fs::symlink("../shared.gitignore", r.join("inside/.gitignore")).unwrap();
        let fifo = mkfifo(&r.join("fifo/.gitignore"));
        let walked =
            within(20, move || walk(&r, 2, &|_| false).unwrap()).expect("the walk finished");
        let paths: Vec<_> = walked.sources.iter().map(|c| c.rel_path.as_str()).collect();
        let mut want = vec!["inside/e.ts", "src/a.ts"];
        if !fifo {
            want.insert(0, "fifo/b.ts");
        }
        assert_eq!(paths, want);
        let r = dir.path().to_path_buf();
        let ing = within(20, move || ingest(&r).unwrap()).expect("the ingest finished");
        let paths: Vec<_> = ing.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, want);
    }

    /// The root's own ignore file is read before anything else: an unsafe one is an
    /// error, not a hang.
    #[cfg(unix)]
    #[test]
    fn an_unsafe_root_ignore_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.ts", "export const a = 1;\n");
        std::os::unix::fs::symlink("/dev/zero", dir.path().join(".gitignore")).unwrap();
        let r = dir.path().to_path_buf();
        let err = within(20, move || walk(&r, 1, &|_| false).map(|_| ()))
            .expect("the walk finished")
            .unwrap_err();
        assert!(err.to_string().contains(".gitignore"), "{err}");
        let r = dir.path().to_path_buf();
        assert!(within(20, move || ingest(&r).is_err()).expect("the ingest finished"));
    }

    /// `.gitattributes` as a FIFO or a link to `/dev/zero`: no generated patterns, no hang.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_gitattributes_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.ts", "export const a = 1;\n");
        std::os::unix::fs::symlink("/dev/zero", dir.path().join(".gitattributes")).unwrap();
        let r = dir.path().to_path_buf();
        let walked = within(20, move || walk(&r, 1, &|_| false).unwrap()).expect("finished");
        assert_eq!(walked.sources.len(), 1);
        let fifo = tempfile::tempdir().unwrap();
        write(fifo.path(), "a.ts", "export const a = 1;\n");
        if mkfifo(&fifo.path().join(".gitattributes")) {
            let r = fifo.path().to_path_buf();
            let walked = within(20, move || walk(&r, 1, &|_| false).unwrap()).expect("finished");
            assert_eq!(walked.sources.len(), 1);
        }
    }

    /// File names that are not UTF-8 have no exact repo-relative path (two of them
    /// would share one): skipped as not UTF-8, never two facts for one path.
    #[cfg(target_os = "linux")]
    #[test]
    fn non_utf8_file_names_are_skipped_once() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "src/ok.ts", "export const a = 1;\n");
        for name in [
            &b"bad\xffname.ts"[..],
            &b"bad\xfename.ts"[..],
            &b"py\xff.py"[..],
        ] {
            let p = r.join("src").join(std::ffi::OsStr::from_bytes(name));
            fs::write(p, "export const z = 1;\n").unwrap();
        }
        let walked = walk(r, 2, &|_| false).unwrap();
        let paths: Vec<_> = walked.sources.iter().map(|c| c.rel_path.as_str()).collect();
        assert_eq!(paths, ["src/ok.ts"]);
        let skipped: Vec<_> = walked
            .skipped
            .iter()
            .map(|s| (s.path.as_str(), s.reason))
            .collect();
        assert_eq!(skipped, [("src/bad\u{fffd}name.ts", SkipReason::NotUtf8)]);
        assert_eq!(walked.python.sources.len(), 0);
        assert_eq!(walked.python.skipped[0].reason, SkipReason::NotUtf8);
        let ing = ingest(r).unwrap();
        let paths: Vec<_> = ing.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["src/ok.ts"]);
        assert!(ing.skipped.iter().all(|s| s.reason == SkipReason::NotUtf8));
    }

    /// Two names that normalise to one path (NFC and NFD forms, distinct on Linux):
    /// one file, the same one on every walk.
    #[cfg(target_os = "linux")]
    #[test]
    fn names_that_normalise_alike_give_one_file() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "caf\u{00e9}/x.ts", "export const nfc = 1;\n");
        write(r, "cafe\u{0301}/x.ts", "export const nfd = 1;\n");
        let first = walk(r, 4, &|_| false).unwrap();
        assert_eq!(first.sources.len(), 1);
        assert_eq!(first.sources[0].rel_path, "caf\u{00e9}/x.ts");
        for _ in 0..10 {
            let again = walk(r, 4, &|_| false).unwrap();
            assert_eq!(again.sources[0].abs_path, first.sources[0].abs_path);
        }
    }
}
