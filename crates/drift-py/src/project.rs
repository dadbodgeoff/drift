//! Python import roots: where `import x` looks for `x` in this repository.
//!
//! Python finds top-level modules on `sys.path`. A checked-out repo has no
//! installed packages, so Drift derives the entries an editable install or a
//! test run would add:
//!
//! - every project (a directory with `pyproject.toml`, `setup.cfg` or `setup.py`)
//!   contributes its configured package directories (setuptools `package-dir` /
//!   `packages.find.where`, poetry `packages[].from`, hatch wheel `packages` /
//!   `sources`, uv `module-root`, pdm `package-dir`, maturin `python-source`,
//!   setup.cfg `package_dir` / `where`, setup.py `package_dir={"": ...}`), a
//!   `src/` directory that is not itself a package, and the project directory;
//! - every directory holding `manage.py` (a Django project root);
//! - the repository root.
//!
//! Paths in configuration that leave the repository are ignored.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

/// True when `dir` holds a regular file (not a symlink) named exactly `name`. Exact
/// case on every file system, so macOS and Linux agree.
pub fn has_file(dir: &Path, name: &str) -> bool {
    std::fs::read_dir(dir).is_ok_and(|it| {
        it.flatten().any(|e| {
            e.file_name().to_str() == Some(name) && e.file_type().is_ok_and(|t| t.is_file())
        })
    })
}

/// True when `dir` is a Python project: it holds `pyproject.toml` or `setup.cfg`, or a
/// `setup.py` that is not a module of a package (`collectors/setup.py` next to an
/// `__init__.py` is code).
pub fn is_project(dir: &Path) -> bool {
    has_file(dir, "pyproject.toml")
        || has_file(dir, "setup.cfg")
        || (has_file(dir, "setup.py") && !has_file(dir, "__init__.py"))
}

/// True when `p` is a real directory (not a symlink).
fn is_real_dir(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.is_dir())
}

#[derive(Debug, Default)]
pub struct Layout {
    root: PathBuf,
    /// Project directory -> its import roots, configured first.
    projects: BTreeMap<PathBuf, Vec<PathBuf>>,
    manage_dirs: BTreeSet<PathBuf>,
    /// Every root in a fixed order: projects (by path), Django roots, repo root.
    all: Vec<PathBuf>,
    /// Import names of the distributions the projects declare as dependencies
    /// (`alembic`, `foo_bar` for `foo-bar`): installed, so a regular package of that
    /// name wins over a namespace portion in the checkout ([`Layout::declares`]).
    declared: BTreeSet<String>,
}

/// `base/rel` normalised lexically; `None` when it leaves `root`.
fn join_inside(root: &Path, base: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for c in Path::new(rel.trim_end_matches('/')).components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            _ => return None,
        }
    }
    out.starts_with(root).then_some(out)
}

fn toml_str<'a>(t: &'a toml::Table, path: &[&str]) -> Option<&'a toml::Value> {
    let mut cur = t.get(path[0])?;
    for k in &path[1..] {
        cur = cur.as_table()?.get(*k)?;
    }
    Some(cur)
}

fn strings(v: Option<&toml::Value>) -> Vec<String> {
    match v {
        Some(toml::Value::String(s)) => vec![s.clone()],
        Some(toml::Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect(),
        _ => vec![],
    }
}

/// Package directories configured in `pyproject.toml` (relative to the project).
fn pyproject_dirs(text: &str) -> Vec<String> {
    let Ok(t) = text.parse::<toml::Table>() else {
        return vec![];
    };
    let mut out = Vec::new();
    // setuptools
    if let Some(toml::Value::Table(pd)) = toml_str(&t, &["tool", "setuptools", "package-dir"])
        && let Some(d) = pd.get("").and_then(|v| v.as_str())
    {
        out.push(d.to_string());
    }
    out.extend(strings(toml_str(
        &t,
        &["tool", "setuptools", "packages", "find", "where"],
    )));
    // poetry
    if let Some(toml::Value::Array(pkgs)) = toml_str(&t, &["tool", "poetry", "packages"]) {
        for p in pkgs {
            if let Some(from) = p.get("from").and_then(|v| v.as_str()) {
                out.push(from.to_string());
            }
        }
    }
    // hatch: `packages = ["src/foo"]` puts `src` on the path; `sources = ["src"]` too.
    for key in [
        &["tool", "hatch", "build", "targets", "wheel", "packages"][..],
        &["tool", "hatch", "build", "packages"][..],
    ] {
        for p in strings(toml_str(&t, key)) {
            if let Some((parent, _)) = p.trim_end_matches('/').rsplit_once('/') {
                out.push(parent.to_string());
            }
        }
    }
    for key in [
        &["tool", "hatch", "build", "targets", "wheel", "sources"][..],
        &["tool", "hatch", "build", "sources"][..],
    ] {
        match toml_str(&t, key) {
            Some(toml::Value::Table(m)) => out.extend(m.keys().cloned()),
            other => out.extend(strings(other)),
        }
    }
    // uv build backend (module root defaults to `src`), pdm, maturin
    let backend = toml_str(&t, &["build-system", "build-backend"]).and_then(|v| v.as_str());
    match toml_str(&t, &["tool", "uv", "build-backend", "module-root"]).and_then(|v| v.as_str()) {
        Some(m) => out.push(m.to_string()),
        None if backend == Some("uv_build") => out.push("src".into()),
        None => {}
    }
    out.extend(strings(toml_str(
        &t,
        &["tool", "pdm", "build", "package-dir"],
    )));
    out.extend(strings(toml_str(&t, &["tool", "maturin", "python-source"])));
    out
}

/// `[options] package_dir = =src` and `[options.packages.find] where = src`.
fn setup_cfg_dirs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut section = String::new();
    let mut key = String::new();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('#') || t.starts_with(';') || t.is_empty() {
            continue;
        }
        if t.starts_with('[') && t.ends_with(']') {
            section = t[1..t.len() - 1].trim().to_string();
            key.clear();
            continue;
        }
        let continuation = line.starts_with(' ') || line.starts_with('\t');
        let (k, v) = match t.split_once('=') {
            Some((k, v)) if !continuation || k.trim().is_empty() => {
                if k.trim().is_empty() {
                    (key.clone(), v.trim().to_string())
                } else {
                    key = k.trim().to_string();
                    (key.clone(), v.trim().to_string())
                }
            }
            _ if continuation => (key.clone(), t.to_string()),
            _ => continue,
        };
        match (section.as_str(), k.as_str()) {
            ("options", "package_dir") => {
                // `=src` or `\n    =src`; other entries map single packages.
                if let Some(d) = v.strip_prefix('=') {
                    out.push(d.trim().to_string());
                } else if let Some(d) = t.strip_prefix('=') {
                    out.push(d.trim().to_string());
                }
            }
            ("options.packages.find", "where") if !v.is_empty() => out.push(v),
            _ => {}
        }
    }
    out
}

/// `package_dir={"": "src"}` and `find_packages("src")` / `where="src"` in setup.py.
fn setup_py_dirs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let quoted = |s: &str| -> Option<String> {
        let s = s.trim_start();
        let q = s.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let rest = &s[1..];
        let end = rest.find(q)?;
        Some(rest[..end].to_string())
    };
    if let Some(i) = text.find("package_dir") {
        let rest = &text[i..];
        if let Some(b) = rest.find('{') {
            let body = &rest[b + 1..rest[b..].find('}').map_or(rest.len(), |e| b + e)];
            for entry in body.split(',') {
                if let Some((k, v)) = entry.split_once(':')
                    && quoted(k).is_some_and(|k| k.is_empty())
                    && let Some(v) = quoted(v)
                {
                    out.push(v);
                }
            }
        }
    }
    for pat in ["find_packages(", "find_namespace_packages("] {
        let mut from = 0;
        while let Some(i) = text[from..].find(pat) {
            let args = &text[from + i + pat.len()..];
            let args = args.trim_start();
            let args = args
                .strip_prefix("where")
                .map_or(args, |a| a.trim_start().strip_prefix('=').unwrap_or(a));
            if let Some(v) = quoted(args) {
                out.push(v);
            }
            from += i + pat.len();
        }
    }
    out
}

/// Configured package directories of the project in `dir`, then `src/` and `dir` itself.
pub fn project_roots(root: &Path, dir: &Path) -> Vec<PathBuf> {
    let mut rels = Vec::new();
    if has_file(dir, "pyproject.toml")
        && let Ok(t) = std::fs::read_to_string(dir.join("pyproject.toml"))
    {
        rels.extend(pyproject_dirs(&t));
    }
    if has_file(dir, "setup.cfg")
        && let Ok(t) = std::fs::read_to_string(dir.join("setup.cfg"))
    {
        rels.extend(setup_cfg_dirs(&t));
    }
    if has_file(dir, "setup.py")
        && let Ok(t) = std::fs::read_to_string(dir.join("setup.py"))
    {
        rels.extend(setup_py_dirs(&t));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for r in rels {
        if let Some(p) = join_inside(root, dir, &r)
            && is_real_dir(&p)
            && !out.contains(&p)
        {
            out.push(p);
        }
    }
    let src = dir.join("src");
    if is_real_dir(&src) && !has_file(&src, "__init__.py") && !out.contains(&src) {
        out.push(src);
    }
    if !out.iter().any(|p| p == dir) {
        out.push(dir.to_path_buf());
    }
    out
}

impl Layout {
    /// Discover projects among `dirs` (every directory holding Python files) and their ancestors.
    pub fn discover(root: &Path, dirs: impl IntoIterator<Item = PathBuf>) -> Self {
        let mut candidates = BTreeSet::new();
        for d in dirs {
            let mut cur = Some(d.as_path());
            while let Some(c) = cur {
                if !c.starts_with(root) || !candidates.insert(c.to_path_buf()) {
                    break;
                }
                cur = c.parent();
            }
        }
        let mut projects = BTreeMap::new();
        let mut manage_dirs = BTreeSet::new();
        for c in &candidates {
            if is_project(c) {
                projects.insert(c.clone(), project_roots(root, c));
            }
            if has_file(c, "manage.py") {
                manage_dirs.insert(c.clone());
            }
        }
        let mut all: Vec<PathBuf> = Vec::new();
        let mut push = |p: &PathBuf| {
            if !all.contains(p) {
                all.push(p.clone());
            }
        };
        for roots in projects.values() {
            roots.iter().for_each(&mut push);
        }
        manage_dirs.iter().for_each(&mut push);
        push(&root.to_path_buf());
        // The projects' declared dependencies, read as the package facts read them.
        let declared = crate::packages::packages(
            root,
            projects
                .keys()
                .map(|d| d.join("__drift_probe__.py"))
                .collect::<Vec<_>>()
                .iter()
                .map(PathBuf::as_path),
        )
        .into_iter()
        .flat_map(|p| p.dependencies)
        .filter_map(|d| {
            let name = d.split('@').next()?.to_string();
            (!name.is_empty()).then(|| crate::packages::normalize_name(&name).replace('-', "_"))
        })
        .collect();
        Self {
            root: root.to_path_buf(),
            projects,
            manage_dirs,
            all,
            declared,
        }
    }

    /// Whether a project declares a distribution whose import name is `top`.
    pub fn declares(&self, top: &str) -> bool {
        self.declared.contains(&top.to_ascii_lowercase())
    }

    /// Nearest enclosing project directory of `dir`.
    pub fn project_of(&self, dir: &Path) -> Option<&Path> {
        let mut cur = Some(dir);
        while let Some(c) = cur {
            if self.projects.contains_key(c) {
                return Some(self.projects.get_key_value(c)?.0);
            }
            if c == self.root {
                break;
            }
            cur = c.parent();
        }
        None
    }

    /// Import roots for code in `dir`: its own project's first, then its Django root,
    /// then every other root.
    pub fn roots_for(&self, dir: &Path) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        if let Some(p) = self.project_of(dir) {
            out.extend(self.projects[p].iter().cloned());
        }
        let mut cur = Some(dir);
        while let Some(c) = cur {
            if self.manage_dirs.contains(c) {
                out.push(c.to_path_buf());
                break;
            }
            if c == self.root {
                break;
            }
            cur = c.parent();
        }
        for r in &self.all {
            if !out.contains(r) {
                out.push(r.clone());
            }
        }
        out
    }

    /// Repo-relative project directories (for `FileFacts::package`).
    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_package_dirs_from_each_build_backend() {
        assert_eq!(
            pyproject_dirs("[tool.setuptools.package-dir]\n\"\" = \"lib\"\n"),
            ["lib"]
        );
        assert_eq!(
            pyproject_dirs("[tool.setuptools.packages.find]\nwhere = [\"src\"]\n"),
            ["src"]
        );
        assert_eq!(
            pyproject_dirs(
                "[tool.poetry]\npackages = [{ include = \"app\", from = \"python\" }]\n"
            ),
            ["python"]
        );
        assert_eq!(
            pyproject_dirs("[tool.hatch.build.targets.wheel]\npackages = [\"src/foo\"]\n"),
            ["src"]
        );
        assert_eq!(
            pyproject_dirs("[build-system]\nbuild-backend = \"uv_build\"\n"),
            ["src"]
        );
        assert_eq!(
            setup_cfg_dirs(
                "[options]\npackage_dir =\n    =src\n[options.packages.find]\nwhere = lib\n"
            ),
            ["src", "lib"]
        );
        assert_eq!(
            setup_py_dirs("setup(package_dir={'': 'src'}, packages=find_packages(where='src'))"),
            ["src", "src"]
        );
    }

    #[test]
    fn config_paths_cannot_leave_the_repo() {
        let root = Path::new("/r");
        assert!(join_inside(root, Path::new("/r/p"), "../../etc").is_none());
        assert_eq!(
            join_inside(root, Path::new("/r/p"), "./src/").unwrap(),
            Path::new("/r/p/src")
        );
    }
}
