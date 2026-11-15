//! Module resolution with Python's import semantics, on the checked-out tree.
//!
//! For each path entry, importlib's `FileFinder` prefers a regular package
//! (`x/__init__.py`) over a module (`x.py`), and remembers a directory without
//! `__init__.py` as a namespace portion; `PathFinder` takes the first entry that
//! finds a package or module and only falls back to a namespace package when none
//! does. Drift applies the same order to the import roots of [`crate::project`]:
//!
//! 1. the importing file's base directory (the first ancestor that is not a
//!    package: `sys.path[0]` for a script, pytest's `rootdir`-less "prepend" rule);
//! 2. the standard library (`pkg:python:<module>`);
//! 3. the roots of the file's own project, its Django root, every other root.
//!
//! Anything not found is third-party (`pkg:<dotted module>`); an import that
//! starts in the repo but names a missing submodule, or a relative import that
//! leaves its top-level package, is `unresolved:`.
//!
//! A namespace portion only counts when it holds Python code (a `.py` file or a
//! regular package): an installed distribution of the same name would win over an
//! empty directory, and a checkout has no installed distributions to ask.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use drift_core::ingest::rel_posix;

use crate::project::Layout;
use crate::stdlib;

/// What a module name resolved to on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Found {
    /// A regular package: its directory.
    Package(PathBuf),
    /// A `.py` module.
    Module(PathBuf),
    /// A namespace package: its portions, in path order.
    Namespace(Vec<PathBuf>),
}

/// Directory names never treated as import targets (same as ingest exclusions).
const NOT_MODULES: &[&str] = &[
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".nox",
    "site-packages",
];

/// A directory's import roots, and the id of that list of roots.
type Roots = (Arc<Vec<PathBuf>>, u32);

/// The resolver's memos are keyed by a directory's path as written (its bytes, which
/// hash in one pass, where a `Path` hashes component by component). Two spellings of
/// one directory only make two entries with the same value: every memo is a pure
/// function of the tree, which a scan does not change.
pub struct Resolver {
    root: PathBuf,
    layout: Layout,
    /// Per directory: its import roots, and an id that is the same for every directory
    /// with the same roots ([`Resolver::roots_for`]).
    roots: Mutex<HashMap<OsString, Roots>>,
    /// Distinct root lists, by id.
    root_ids: Mutex<HashMap<Vec<PathBuf>, u32>>,
    /// Per directory: its base directory ([`Resolver::basedir`]).
    basedirs: Mutex<HashMap<OsString, PathBuf>>,
    /// Per importing directory, per specifier: the module id.
    cache: Mutex<HashMap<OsString, HashMap<String, String>>>,
    /// An absolute import depends on the importing directory only through its base
    /// directory and its import roots: per (base directory, root list id), per
    /// specifier, the module id.
    absolute: Mutex<HashMap<(OsString, u32), HashMap<String, String>>>,
    /// Per module id, per name: [`Resolver::submodule`].
    submodules: Mutex<HashMap<String, HashMap<String, Option<String>>>>,
    code_dirs: Mutex<HashMap<OsString, bool>>,
    listings: Mutex<HashMap<OsString, Listing>>,
}

/// `memo[a][b]`, cloned, if present.
fn get2<K1, Q, V>(memo: &Mutex<HashMap<K1, HashMap<String, V>>>, a: &Q, b: &str) -> Option<V>
where
    K1: std::hash::Hash + Eq + std::borrow::Borrow<Q>,
    Q: std::hash::Hash + Eq + ?Sized,
    V: Clone,
{
    memo.lock().ok()?.get(a)?.get(b).cloned()
}

fn put2<K1, V>(memo: &Mutex<HashMap<K1, HashMap<String, V>>>, a: K1, b: &str, v: V)
where
    K1: std::hash::Hash + Eq,
{
    if let Ok(mut m) = memo.lock() {
        m.entry(a).or_default().insert(b.to_string(), v);
    }
}

/// A directory's entries by exact (case-preserved) name: `true` for directories.
/// Symlinks are left out, as ingest never follows them.
type Listing = Arc<HashMap<String, bool>>;

/// Entries of `d` that are real files or directories, by exact name.
fn read_listing(d: &Path) -> HashMap<String, bool> {
    let mut out = HashMap::new();
    let Ok(it) = std::fs::read_dir(d) else {
        return out;
    };
    for e in it.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() || !(ft.is_file() || ft.is_dir()) {
            continue;
        }
        if let Some(n) = e.file_name().to_str() {
            out.insert(n.to_string(), ft.is_dir());
        }
    }
    out
}

/// Namespace directories nested this deep are still searched for code.
const MAX_NAMESPACE_DEPTH: usize = 3;

fn is_identifier(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with(|c: char| c.is_ascii_digit())
        && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

impl Resolver {
    pub fn new(root: &Path, layout: Layout) -> Self {
        Self {
            root: root.to_path_buf(),
            layout,
            roots: Mutex::new(HashMap::new()),
            root_ids: Mutex::new(HashMap::new()),
            basedirs: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            absolute: Mutex::new(HashMap::new()),
            submodules: Mutex::new(HashMap::new()),
            code_dirs: Mutex::new(HashMap::new()),
            listings: Mutex::new(HashMap::new()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn layout(&self) -> &Layout {
        &self.layout
    }

    fn rel(&self, p: &Path) -> String {
        rel_posix(&self.root, p).unwrap_or_default()
    }

    /// Repo-relative module id for a find result.
    pub fn module_id(&self, f: &Found) -> String {
        match f {
            Found::Package(d) => self.rel(&d.join("__init__.py")),
            Found::Module(p) => self.rel(p),
            Found::Namespace(dirs) => self.rel(&dirs[0]),
        }
    }

    /// Exact-case entries of `d`, cached. Matches importlib's `FileFinder`, which checks
    /// names against a directory listing, so case-insensitive file systems (macOS)
    /// resolve exactly like Linux.
    fn listing(&self, d: &Path) -> Listing {
        let key = d.as_os_str();
        if let Some(l) = self.listings.lock().ok().and_then(|m| m.get(key).cloned()) {
            return l;
        }
        let l = Arc::new(read_listing(d));
        if let Ok(mut m) = self.listings.lock() {
            m.insert(key.to_os_string(), l.clone());
        }
        l
    }

    fn is_file(&self, d: &Path, name: &str) -> bool {
        self.listing(d).get(name) == Some(&false)
    }

    fn is_dir(&self, d: &Path, name: &str) -> bool {
        self.listing(d).get(name) == Some(&true)
    }

    fn is_package(&self, d: &Path) -> bool {
        self.is_file(d, "__init__.py")
    }

    fn has_code_at(&self, d: &Path, depth: usize) -> bool {
        let l = self.listing(d);
        let mut names: Vec<(&String, &bool)> = l.iter().collect();
        names.sort();
        let mut subdirs = Vec::new();
        for (n, dir) in names {
            if !*dir && n.ends_with(".py") {
                return true;
            }
            if *dir {
                let p = d.join(n);
                if self.is_package(&p) {
                    return true;
                }
                if is_identifier(n) && !NOT_MODULES.contains(&n.as_str()) {
                    subdirs.push(p);
                }
            }
        }
        depth < MAX_NAMESPACE_DEPTH && subdirs.iter().any(|s| self.has_code_at(s, depth + 1))
    }

    /// Absolute path of a repo-relative module id.
    fn abs(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// Directories a module's submodules are found in (its `__path__`).
    pub fn search_path(&self, id: &str) -> Option<PathBuf> {
        if id.contains(':') {
            return None;
        }
        let p = self.abs(id);
        if id.ends_with("/__init__.py") || id == "__init__.py" {
            return p.parent().map(Path::to_path_buf);
        }
        let (parent, name) = (p.parent()?, p.file_name()?.to_str()?);
        self.is_dir(parent, name).then_some(p)
    }

    /// True when `d` holds Python code: a `.py` file or a regular package, directly or
    /// in a nested namespace directory (a few levels down).
    fn has_code(&self, d: &Path) -> bool {
        let key = d.as_os_str();
        if let Some(v) = self.code_dirs.lock().ok().and_then(|m| m.get(key).copied()) {
            return v;
        }
        let v = self.has_code_at(d, 0);
        if let Ok(mut m) = self.code_dirs.lock() {
            m.insert(key.to_os_string(), v);
        }
        v
    }

    /// importlib's search for `name` in `locations`.
    pub fn find_in(&self, name: &str, locations: &[PathBuf]) -> Option<Found> {
        if !is_identifier(name) || NOT_MODULES.contains(&name) {
            return None;
        }
        let mut portions = Vec::new();
        for loc in locations {
            let d = loc.join(name);
            let is_dir = self.is_dir(loc, name);
            if is_dir && self.is_package(&d) {
                return Some(Found::Package(d));
            }
            let file = format!("{name}.py");
            if self.is_file(loc, &file) {
                return Some(Found::Module(loc.join(file)));
            }
            if is_dir && self.has_code(&d) {
                portions.push(d);
            }
        }
        (!portions.is_empty()).then_some(Found::Namespace(portions))
    }

    /// The first ancestor of `file` that is not a package directory (memoised per
    /// directory: it depends on `file`'s directory only).
    pub fn basedir(&self, file: &Path) -> PathBuf {
        let dir = file.parent().unwrap_or(&self.root);
        let key = dir.as_os_str();
        if let Some(b) = self.basedirs.lock().ok().and_then(|m| m.get(key).cloned()) {
            return b;
        }
        let b = self.basedir_uncached(dir);
        if let Ok(mut m) = self.basedirs.lock() {
            m.insert(key.to_os_string(), b.clone());
        }
        b
    }

    fn basedir_uncached(&self, dir: &Path) -> PathBuf {
        let mut d = dir.to_path_buf();
        while d != self.root && self.is_package(&d) {
            match d.parent() {
                Some(p) if p.starts_with(&self.root) => d = p.to_path_buf(),
                _ => break,
            }
        }
        d
    }

    /// Import roots for a file in `dir` (excluding its base directory).
    pub fn roots_for(&self, dir: &Path) -> Arc<Vec<PathBuf>> {
        self.roots_entry(dir).0
    }

    /// [`Resolver::roots_for`], with the id of that root list.
    fn roots_entry(&self, dir: &Path) -> Roots {
        let key = dir.as_os_str();
        if let Some(r) = self.roots.lock().ok().and_then(|m| m.get(key).cloned()) {
            return r;
        }
        let roots = self.layout.roots_for(dir);
        let id = match self.root_ids.lock() {
            Ok(mut ids) => {
                let next = ids.len() as u32;
                *ids.entry(roots.clone()).or_insert(next)
            }
            // Never shared with another list: the absolute-import memo misses for it.
            Err(_) => u32::MAX,
        };
        let r = (Arc::new(roots), id);
        if let Ok(mut m) = self.roots.lock() {
            m.insert(key.to_os_string(), r.clone());
        }
        r
    }

    /// How many package levels a relative import may climb from `file`: the depth of
    /// its directory below the deepest import root containing it. (Lenient for
    /// scripts: code that uses relative imports is meant to run as a module.)
    fn package_depth(&self, file: &Path) -> usize {
        let dir = file.parent().unwrap_or(&self.root);
        let roots = self.roots_for(dir);
        let anchor = roots
            .iter()
            .filter(|r| dir.starts_with(r))
            .max_by_key(|r| r.components().count())
            .cloned()
            .unwrap_or_else(|| self.basedir(file));
        dir.strip_prefix(&anchor)
            .map_or(0, |p| p.components().count())
    }

    /// Dotted import name of `file` (`saleor/checkout/tasks.py` -> `saleor.checkout.tasks`),
    /// relative to the deepest import root containing it, else its base directory (a
    /// script is imported by its own name). `None` when a segment is not an identifier.
    pub fn module_name(&self, file: &Path) -> Option<String> {
        let dir = file.parent().unwrap_or(&self.root);
        let roots = self.roots_for(dir);
        let anchor = roots
            .iter()
            .filter(|r| dir.starts_with(r))
            .max_by_key(|r| r.components().count())
            .cloned()
            .unwrap_or_else(|| self.basedir(file));
        let rel = file.strip_prefix(&anchor).ok()?;
        let mut segs: Vec<&str> = rel.iter().map(|c| c.to_str()).collect::<Option<_>>()?;
        let last = segs.pop()?.strip_suffix(".py")?;
        if last != "__init__" {
            segs.push(last);
        }
        (!segs.is_empty() && segs.iter().all(|s| is_identifier(s))).then(|| segs.join("."))
    }

    /// Submodule `name` of module `id`, if it exists (memoised).
    pub fn submodule(&self, id: &str, name: &str) -> Option<String> {
        if let Some(v) = get2(&self.submodules, id, name) {
            return v;
        }
        let v = self
            .search_path(id)
            .and_then(|dir| self.find_in(name, &[dir]).map(|f| self.module_id(&f)))
            .or_else(|| self.sibling_submodule(id, name));
        put2(&self.submodules, id.to_string(), name, v.clone());
        v
    }

    /// Submodule `name` of a top-level regular package `id` (`acme/__init__.py`) that
    /// only a sibling distribution of the same namespace ships: `from acme import beta`
    /// in the distribution whose `acme/__init__.py` makes `acme` a regular package, with
    /// `acme/beta/` in another one (see [`Resolver::merged_portions`]).
    fn sibling_submodule(&self, id: &str, name: &str) -> Option<String> {
        let pkg_dir = self.abs(id.strip_suffix("/__init__.py")?);
        let top = pkg_dir.file_name()?.to_str()?.to_string();
        let parent = pkg_dir.parent()?.to_path_buf();
        let roots = self.roots_for(&pkg_dir);
        // Only a top-level package: its parent is where imports of it start.
        if !roots.contains(&parent) && self.basedir(&pkg_dir.join("__init__.py")) != parent {
            return None;
        }
        let mut locations = vec![parent];
        locations.extend(roots.iter().cloned());
        let portions = self.portions(&top, &locations);
        if portions.len() < 2 {
            return None;
        }
        self.find_in(name, &portions).map(|f| self.module_id(&f))
    }

    /// Directories named `top` in `locations`, in order, without repeats.
    fn portions(&self, top: &str, locations: &[PathBuf]) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        for l in locations {
            let d = l.join(top);
            if self.is_dir(l, top) && !out.contains(&d) {
                out.push(d);
            }
        }
        out
    }

    /// `spec` walked through every portion of its top-level namespace when the walk
    /// from `found` alone does not resolve it: distributions of one namespace in a
    /// workspace (`pkgs/alpha/acme/alpha`, `pkgs/gamma/acme/__init__.py`) are merged
    /// into one `acme/` when they are installed into one site-packages, so what one
    /// regular package hides, the sibling portions hold (pilot G2).
    fn merged_portions(
        &self,
        found: String,
        top: &str,
        locations: &[PathBuf],
        segs: &[&str],
        spec: &str,
    ) -> String {
        if !found.starts_with("unresolved:") || segs.len() < 2 {
            return found;
        }
        let portions = self.portions(top, locations);
        if portions.len() < 2 {
            return found;
        }
        let merged = self.walk(Found::Namespace(portions), &segs[1..], spec);
        if merged.starts_with("unresolved:") {
            found
        } else {
            merged
        }
    }

    /// Canonical module id for `spec` (as written, relative dots included) imported by `file`.
    ///
    /// Memoised per importing directory, and an absolute import also per (base
    /// directory, import roots): [`Resolver::resolve_uncached`] reads nothing else of
    /// the importing file for it, so files in different directories with the same base
    /// and roots (the packages of one project) share the answer.
    pub fn resolve(&self, file: &Path, spec: &str) -> String {
        let dir = file.parent().unwrap_or(&self.root);
        if let Some(v) = get2(&self.cache, dir.as_os_str(), spec) {
            return v;
        }
        let v = if spec.starts_with('.') {
            self.resolve_uncached(file, spec)
        } else {
            let base = self.basedir(file).into_os_string();
            let (_, roots) = self.roots_entry(dir);
            let abs_key = (base, roots);
            match get2(&self.absolute, &abs_key, spec) {
                Some(v) => v,
                None => {
                    let v = self.resolve_uncached(file, spec);
                    if roots != u32::MAX {
                        put2(&self.absolute, abs_key, spec, v.clone());
                    }
                    v
                }
            }
        };
        put2(&self.cache, dir.as_os_str().to_os_string(), spec, v.clone());
        v
    }

    fn walk(&self, start: Found, rest: &[&str], spec: &str) -> String {
        let mut cur = start;
        for seg in rest {
            let dirs = match &cur {
                Found::Package(d) => vec![d.clone()],
                Found::Namespace(p) => p.clone(),
                Found::Module(_) => return format!("unresolved:{spec}"),
            };
            match self.find_in(seg, &dirs) {
                Some(f) => cur = f,
                None => return format!("unresolved:{spec}"),
            }
        }
        self.module_id(&cur)
    }

    fn resolve_uncached(&self, file: &Path, spec: &str) -> String {
        let level = spec.chars().take_while(|c| *c == '.').count();
        let rest = &spec[level..];
        let segs: Vec<&str> = if rest.is_empty() {
            vec![]
        } else {
            rest.split('.').collect()
        };
        if level > 0 {
            if level > self.package_depth(file) {
                return format!("unresolved:{spec}");
            }
            let mut d = file.parent().unwrap_or(&self.root).to_path_buf();
            for _ in 1..level {
                d = match d.parent() {
                    Some(p) => p.to_path_buf(),
                    None => return format!("unresolved:{spec}"),
                };
            }
            let pkg = if self.is_package(&d) {
                Found::Package(d)
            } else {
                Found::Namespace(vec![d])
            };
            return self.walk(pkg, &segs, spec);
        }
        let Some(top) = segs.first().copied() else {
            return format!("unresolved:{spec}");
        };
        let dir = file.parent().unwrap_or(&self.root);
        let base = self.basedir(file);
        let mut locations = vec![base.clone()];
        locations.extend(self.roots_for(dir).iter().cloned());
        if let Some(f @ (Found::Package(_) | Found::Module(_))) =
            self.find_in(top, std::slice::from_ref(&base))
        {
            let package = matches!(f, Found::Package(_));
            let found = self.walk(f, &segs[1..], spec);
            // The importing file's own distribution ships `top/__init__.py`; a sibling
            // portion may ship the submodule.
            return if package {
                self.merged_portions(found, top, &locations, &segs, spec)
            } else {
                found
            };
        }
        if stdlib::is_stdlib(top) {
            return format!("pkg:python:{spec}");
        }
        match self.find_in(top, &locations) {
            // A directory without `__init__.py` named like a declared dependency (an
            // `alembic/` migrations folder): the installed regular package wins over a
            // namespace portion, as importlib's PathFinder decides (pilot G6).
            Some(Found::Namespace(_)) if self.layout.declares(top) => format!("pkg:{spec}"),
            Some(f) => {
                let found = self.walk(f, &segs[1..], spec);
                self.merged_portions(found, top, &locations, &segs, spec)
            }
            None => format!("pkg:{spec}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "").unwrap();
    }

    /// The memos answer as a fresh resolver does: an absolute import is shared between
    /// directories only when both their base directory and their import roots agree.
    /// `pkg/one` and `pkg/two` share the base directory (the repo root: `pkg` and both
    /// are packages) but each is a project whose own roots come first, so `shared`
    /// is a different module from each; files of one directory share every answer.
    #[test]
    fn memoised_answers_are_a_fresh_resolvers() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path().canonicalize().unwrap();
        for f in [
            "pkg/__init__.py",
            "pkg/one/__init__.py",
            "pkg/one/pyproject.toml",
            "pkg/one/shared.py",
            "pkg/one/a.py",
            "pkg/one/b.py",
            "pkg/two/__init__.py",
            "pkg/two/pyproject.toml",
            "pkg/two/shared.py",
            "pkg/two/c.py",
            "pkg/three/__init__.py",
            "pkg/three/d.py",
            "scripts/run.py",
            "scripts/util.py",
        ] {
            write(&r, f);
        }
        let dirs = ["pkg", "pkg/one", "pkg/two", "pkg/three", "scripts"].map(|d| r.join(d));
        let fresh = || Resolver::new(&r, Layout::discover(&r, dirs.clone()));
        let memo = fresh();
        let cases = [
            ("pkg/one/a.py", "shared", "pkg/one/shared.py"),
            ("pkg/two/c.py", "shared", "pkg/two/shared.py"),
            ("pkg/one/b.py", "shared", "pkg/one/shared.py"),
            ("pkg/three/d.py", "pkg.one.shared", "pkg/one/shared.py"),
            ("pkg/one/a.py", "pkg.two.shared", "pkg/two/shared.py"),
            // A project's own directory is an import root: nothing relative above it.
            ("pkg/one/a.py", ".shared", "unresolved:.shared"),
            ("pkg/three/d.py", ".d", "pkg/three/d.py"),
            ("pkg/three/d.py", "..one.shared", "pkg/one/shared.py"),
            ("scripts/run.py", "util", "scripts/util.py"),
            ("pkg/one/a.py", "util", "pkg:util"),
            ("pkg/one/a.py", "os.path", "pkg:python:os.path"),
        ];
        // Twice over, in both orders: answers never depend on what was asked before.
        for round in 0..2 {
            let order: Vec<_> = if round == 0 {
                cases.iter().collect()
            } else {
                cases.iter().rev().collect()
            };
            for (file, spec, want) in order {
                let file = r.join(file);
                assert_eq!(memo.resolve(&file, spec), *want, "{spec} from {file:?}");
                assert_eq!(fresh().resolve(&file, spec), *want, "{spec} from {file:?}");
            }
        }
        assert_eq!(memo.basedir(&r.join("pkg/one/a.py")), r);
        assert_eq!(memo.basedir(&r.join("scripts/run.py")), r.join("scripts"));
        assert_eq!(
            memo.submodule("pkg/one/__init__.py", "shared").as_deref(),
            Some("pkg/one/shared.py")
        );
        assert_eq!(memo.submodule("pkg/one/__init__.py", "missing"), None);
        assert_eq!(
            memo.submodule("pkg/two/__init__.py", "shared").as_deref(),
            Some("pkg/two/shared.py")
        );
    }
}
