//! Python package facts: what each project declares, in the language-neutral
//! [`PackageFacts`] shape `package.json` fills for TypeScript.
//!
//! A package is a directory holding Python code (or an ancestor of one) with a
//! `pyproject.toml`, or with `requirements*.txt` files and no `pyproject.toml`.
//!
//! - **Dependencies** (`name@range`, names normalised as in PEP 503): PEP 621
//!   `[project] dependencies` and `optional-dependencies`, PEP 735
//!   `[dependency-groups]`, Poetry `[tool.poetry.dependencies]`,
//!   `dev-dependencies` and `group.*.dependencies`, and uv's legacy
//!   `[tool.uv] dev-dependencies`. Environment markers are dropped; a dependency
//!   without a version is `*`. A uv workspace root without `[project]` declares its
//!   dependency groups; its members are packages of their own. `requirements*.txt`
//!   files are read when there is no `pyproject.toml`, or when it declares its
//!   dependencies `dynamic` (filled from those files at build time).
//! - **Scripts** are task-runner tasks, the counterpart of npm scripts: `[tool.poe.tasks]`,
//!   `[tool.pdm.scripts]`, `[tool.taskipy.tasks]`, `[tool.hatch.envs.default.scripts]`.
//!   Console entry points (`[project.scripts]`) are like `package.json`'s `bin` and
//!   are not recorded.
//! - **Name**: `[project] name` or `[tool.poetry] name`, normalised.
//! - **Dev only** (facts schema 11): the dependencies declared only in development,
//!   test or lint groups: PEP 735 `[dependency-groups]`, Poetry `dev-dependencies` and
//!   `group.<name>` (any but `main`), uv's `dev-dependencies`, `optional-dependencies`
//!   named `dev`, `test`, `tests` or `lint`, and `requirements-dev.txt` /
//!   `requirements-test.txt`-style files. A name also declared as a runtime
//!   dependency is not dev only.
//!
//! [`declared_entries`] reads the entry points a project declares outside its Python
//! code: console scripts (`[project.scripts]`, `[tool.poetry.scripts]`) and LangGraph
//! graphs (`langgraph.json` `graphs`).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use drift_core::PackageFacts;
use drift_core::ingest::rel_posix;

/// PEP 503 normalised name: lowercase, runs of `-`, `_` and `.` become one `-`.
pub fn normalize_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut sep = false;
    for c in name.trim().chars() {
        if matches!(c, '-' | '_' | '.') {
            sep = true;
            continue;
        }
        if sep && !out.is_empty() {
            out.push('-');
        }
        sep = false;
        out.extend(c.to_lowercase());
    }
    out
}

/// `name@range` from a PEP 508 requirement (`requests[socks] >= 2.0 ; python_version
/// < "3.11"` -> `requests@>=2.0`; a direct reference `x @ https://...` keeps its URL).
/// `None` when the text does not start with a distribution name.
pub fn pep508_dep(req: &str) -> Option<String> {
    let req = req.split(';').next().unwrap_or_default().trim();
    let end = req
        .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .unwrap_or(req.len());
    let name = normalize_name(&req[..end]);
    if name.is_empty() || !req.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        return None;
    }
    let mut rest = req[end..].trim_start();
    if let Some(r) = rest.strip_prefix('[') {
        rest = r
            .split_once(']')
            .map_or("", |(_, after)| after)
            .trim_start();
    }
    let range: String = match rest.strip_prefix('@') {
        Some(url) => url.trim().to_string(),
        None => rest
            .trim_start_matches('(')
            .trim_end_matches(')')
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect(),
    };
    let range = if range.is_empty() { "*".into() } else { range };
    Some(format!("{name}@{range}"))
}

/// Requirements in a `requirements.txt`: one PEP 508 requirement per logical line.
/// Options (`-r`, `-e`, `--hash`), comments, paths and bare URLs are skipped.
pub fn requirements_deps(text: &str) -> Vec<String> {
    let joined = text.replace("\\\r\n", " ").replace("\\\n", " ");
    let mut out = Vec::new();
    for line in joined.lines() {
        // A comment starts with `#` at the start of the line or after whitespace.
        let line = match line.find(" #").or_else(|| line.find("\t#")) {
            Some(i) => &line[..i],
            None if line.trim_start().starts_with('#') => "",
            None => line,
        };
        // Per-requirement options (`--hash=...`) follow the requirement.
        let line = line.split(" --").next().unwrap_or_default().trim();
        if line.is_empty() || line.starts_with('-') || (line.contains("://") && !line.contains('@'))
        {
            continue;
        }
        if let Some(d) = pep508_dep(line) {
            out.push(d);
        }
    }
    out
}

fn table_at<'a>(t: &'a toml::Table, path: &[&str]) -> Option<&'a toml::Value> {
    let mut cur = t.get(path[0])?;
    for k in &path[1..] {
        cur = cur.as_table()?.get(*k)?;
    }
    Some(cur)
}

/// Optional-dependency groups (extras) that hold development tools, not features.
const DEV_EXTRAS: &[&str] = &["dev", "lint", "test", "tests"];

/// The name of a `name@range` dependency.
fn dep_name(d: &str) -> &str {
    d.split_once('@').map_or(d, |(n, _)| n)
}

fn pep508_list(v: Option<&toml::Value>, out: &mut Vec<String>) {
    if let Some(toml::Value::Array(a)) = v {
        out.extend(a.iter().filter_map(|x| x.as_str()).filter_map(pep508_dep));
    }
}

/// Range of a Poetry dependency value: `"^1.2"`, `{ version = "^1.2" }`, or the
/// source kind (`path:`, `git:`, `url:`) of a dependency without a version.
fn poetry_ranges(v: &toml::Value) -> Vec<String> {
    match v {
        toml::Value::String(s) => vec![s.split_whitespace().collect()],
        toml::Value::Table(t) => {
            if let Some(s) = t.get("version").and_then(|x| x.as_str()) {
                return vec![s.split_whitespace().collect()];
            }
            for kind in ["path", "git", "url"] {
                if let Some(s) = t.get(kind).and_then(|x| x.as_str()) {
                    return vec![format!("{kind}:{s}")];
                }
            }
            vec!["*".into()]
        }
        // Multiple constraints, one per Python version or platform.
        toml::Value::Array(a) => a.iter().flat_map(poetry_ranges).collect(),
        _ => vec!["*".into()],
    }
}

fn poetry_table(v: Option<&toml::Value>, out: &mut Vec<String>) {
    let Some(toml::Value::Table(t)) = v else {
        return;
    };
    for (name, spec) in t {
        if name == "python" {
            continue;
        }
        let name = normalize_name(name);
        for r in poetry_ranges(spec) {
            let r = if r.is_empty() { "*".to_string() } else { r };
            out.push(format!("{name}@{r}"));
        }
    }
}

fn keys(v: Option<&toml::Value>) -> Vec<String> {
    v.and_then(|v| v.as_table())
        .map(|t| t.keys().cloned().collect())
        .unwrap_or_default()
}

/// What a `pyproject.toml` declares: name, dependencies, task names, and whether its
/// dependencies are `dynamic` (read from requirements files at build time).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Pyproject {
    pub name: String,
    pub dependencies: Vec<String>,
    pub scripts: Vec<String>,
    pub dynamic_dependencies: bool,
    /// Names of the dependencies declared in a development, test or lint group (see
    /// the module docs), sorted; a name may also be a runtime dependency.
    pub dev_dependencies: Vec<String>,
    /// Console script targets (`module:attr`), sorted.
    pub console_scripts: Vec<String>,
}

/// Parse a `pyproject.toml`; invalid TOML declares nothing.
pub fn read_pyproject(text: &str) -> Pyproject {
    let Ok(t) = text.parse::<toml::Table>() else {
        return Pyproject::default();
    };
    let mut deps = Vec::new();
    let mut dev = Vec::new();
    pep508_list(table_at(&t, &["project", "dependencies"]), &mut deps);
    if let Some(toml::Value::Table(extras)) = table_at(&t, &["project", "optional-dependencies"]) {
        for (k, v) in extras {
            if DEV_EXTRAS.contains(&normalize_name(k).as_str()) {
                pep508_list(Some(v), &mut dev);
            }
            pep508_list(Some(v), &mut deps);
        }
    }
    // PEP 735 groups; `{ include-group = "..." }` entries are tables and skipped.
    if let Some(toml::Value::Table(groups)) = t.get("dependency-groups") {
        for v in groups.values() {
            pep508_list(Some(v), &mut deps);
            pep508_list(Some(v), &mut dev);
        }
    }
    pep508_list(table_at(&t, &["tool", "uv", "dev-dependencies"]), &mut deps);
    pep508_list(table_at(&t, &["tool", "uv", "dev-dependencies"]), &mut dev);
    poetry_table(table_at(&t, &["tool", "poetry", "dependencies"]), &mut deps);
    for into in [&mut deps, &mut dev] {
        poetry_table(table_at(&t, &["tool", "poetry", "dev-dependencies"]), into);
    }
    if let Some(toml::Value::Table(groups)) = table_at(&t, &["tool", "poetry", "group"]) {
        for (name, g) in groups {
            poetry_table(g.get("dependencies"), &mut deps);
            if name != "main" {
                poetry_table(g.get("dependencies"), &mut dev);
            }
        }
    }
    let mut scripts = Vec::new();
    for path in [
        &["tool", "poe", "tasks"][..],
        &["tool", "pdm", "scripts"][..],
        &["tool", "taskipy", "tasks"][..],
        &["tool", "hatch", "envs", "default", "scripts"][..],
    ] {
        scripts.extend(keys(table_at(&t, path)));
    }
    // pdm's `_` table holds settings shared by its scripts, not a script.
    scripts.retain(|s| s != "_");
    let name = table_at(&t, &["project", "name"])
        .or_else(|| table_at(&t, &["tool", "poetry", "name"]))
        .and_then(|v| v.as_str())
        .map(normalize_name)
        .unwrap_or_default();
    let dynamic_dependencies = matches!(
        table_at(&t, &["project", "dynamic"]),
        Some(toml::Value::Array(a)) if a.iter().any(|x| x.as_str() == Some("dependencies"))
    );
    let mut dev_dependencies: Vec<String> = dev.iter().map(|d| dep_name(d).to_string()).collect();
    dev_dependencies.sort();
    dev_dependencies.dedup();
    let mut console_scripts = Vec::new();
    for path in [
        &["project", "scripts"][..],
        &["tool", "poetry", "scripts"][..],
    ] {
        if let Some(toml::Value::Table(t)) = table_at(&t, path) {
            for v in t.values() {
                let target = match v {
                    toml::Value::String(s) => Some(s.as_str()),
                    toml::Value::Table(x) => x.get("callable").and_then(|c| c.as_str()),
                    _ => None,
                };
                if let Some(target) = target {
                    console_scripts.push(target.trim().to_string());
                }
            }
        }
    }
    console_scripts.sort();
    console_scripts.dedup();
    Pyproject {
        name,
        dependencies: deps,
        scripts,
        dynamic_dependencies,
        dev_dependencies,
        console_scripts,
    }
}

/// A requirements file that lists development tools (`requirements-dev.txt`,
/// `requirements_test.txt`, `requirements-lint.txt`).
fn is_dev_requirements(name: &str) -> bool {
    let stem = name
        .trim_start_matches("requirements")
        .trim_end_matches(".txt")
        .to_ascii_lowercase();
    ["dev", "test", "lint"].iter().any(|w| stem.contains(w))
}

/// `requirements.txt`, `requirements-dev.txt`, `requirements_test.txt`, ...
pub fn is_requirements_file(name: &str) -> bool {
    name.starts_with("requirements") && name.ends_with(".txt")
}

/// Regular files (not symlinks) directly in `dir`, by exact name, sorted.
fn file_names(dir: &Path) -> BTreeSet<String> {
    let Ok(it) = std::fs::read_dir(dir) else {
        return BTreeSet::new();
    };
    it.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .collect()
}

fn read_small(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > drift_core::ingest::MAX_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Package facts of every Python project that holds one of `files` (absolute paths
/// of the Python files a scan found, analysed or skipped), sorted by path.
pub fn packages<'a>(root: &Path, files: impl IntoIterator<Item = &'a Path>) -> Vec<PackageFacts> {
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for f in files {
        let mut cur = f.parent();
        while let Some(d) = cur {
            if !d.starts_with(root) || !dirs.insert(d.to_path_buf()) {
                break;
            }
            cur = d.parent();
        }
    }
    let mut out = Vec::new();
    for dir in &dirs {
        let names = file_names(dir);
        let has_pyproject = names.contains("pyproject.toml");
        let reqs: Vec<&String> = names.iter().filter(|n| is_requirements_file(n)).collect();
        if !has_pyproject && reqs.is_empty() {
            continue;
        }
        let Some(rel) = rel_posix(root, dir) else {
            continue;
        };
        let join = |name: &str| {
            if rel.is_empty() {
                name.to_string()
            } else {
                format!("{rel}/{name}")
            }
        };
        let py = if has_pyproject {
            read_small(&dir.join("pyproject.toml"))
                .map(|t| read_pyproject(&t))
                .unwrap_or_default()
        } else {
            Pyproject::default()
        };
        let mut deps = py.dependencies;
        let mut dev: BTreeSet<String> = py.dev_dependencies.into_iter().collect();
        if !has_pyproject || py.dynamic_dependencies {
            for r in &reqs {
                if let Some(t) = read_small(&dir.join(r.as_str())) {
                    let found = requirements_deps(&t);
                    if is_dev_requirements(r) {
                        dev.extend(found.iter().map(|d| dep_name(d).to_string()));
                    }
                    deps.extend(found);
                }
            }
        }
        deps.sort();
        deps.dedup();
        // A name declared anywhere but a dev group (or a dev requirements file) runs.
        let mut runtime: BTreeSet<String> = has_pyproject
            .then(|| read_small(&dir.join("pyproject.toml")))
            .flatten()
            .map(|t| runtime_names(&t))
            .unwrap_or_default();
        if !has_pyproject || py.dynamic_dependencies {
            for r in reqs.iter().filter(|r| !is_dev_requirements(r)) {
                if let Some(t) = read_small(&dir.join(r.as_str())) {
                    runtime.extend(
                        requirements_deps(&t)
                            .iter()
                            .map(|d| dep_name(d).to_string()),
                    );
                }
            }
        }
        let dev_only: Vec<String> = dev
            .into_iter()
            .filter(|n| !runtime.contains(n.as_str()))
            .collect();
        let mut scripts = py.scripts;
        scripts.sort();
        scripts.dedup();
        let manifest = if has_pyproject {
            join("pyproject.toml")
        } else if names.contains("requirements.txt") {
            join("requirements.txt")
        } else {
            join(reqs[0])
        };
        out.push(PackageFacts {
            path: rel,
            name: py.name,
            scripts,
            dependencies: deps,
            peer_dependencies: vec![],
            optional_dependencies: vec![],
            compiler_flags: vec![],
            manifest,
            entries: vec![],
            dev_only,
        });
    }
    out
}

/// Names of the dependencies a `pyproject.toml` declares for running: `[project]
/// dependencies`, optional-dependencies other than [`DEV_EXTRAS`], and Poetry's
/// `dependencies` / `group.main`.
fn runtime_names(text: &str) -> BTreeSet<String> {
    let Ok(t) = text.parse::<toml::Table>() else {
        return BTreeSet::new();
    };
    let mut run = Vec::new();
    pep508_list(table_at(&t, &["project", "dependencies"]), &mut run);
    if let Some(toml::Value::Table(extras)) = table_at(&t, &["project", "optional-dependencies"]) {
        for (k, v) in extras {
            if !DEV_EXTRAS.contains(&normalize_name(k).as_str()) {
                pep508_list(Some(v), &mut run);
            }
        }
    }
    poetry_table(table_at(&t, &["tool", "poetry", "dependencies"]), &mut run);
    if let Some(g) = table_at(&t, &["tool", "poetry", "group", "main"]) {
        poetry_table(g.get("dependencies"), &mut run);
    }
    run.iter().map(|d| dep_name(d).to_string()).collect()
}

/// An entry point a project declares outside its Python code.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct DeclaredEntry {
    /// The directory of the manifest that declares it.
    pub dir: PathBuf,
    pub target: EntryTarget,
    /// `cli` or `agent_graph`.
    pub kind: &'static str,
    /// `console_script` or `langgraph`.
    pub adapter: &'static str,
}

/// What a [`DeclaredEntry`] names.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum EntryTarget {
    /// `pkg.cli:main`: a dotted module and the attribute in it.
    Module { module: String, attr: String },
    /// `./src/agent/graph.py:graph`: a repo-relative file and the attribute in it.
    File { path: String, attr: String },
}

/// Largest `langgraph.json` read.
const MAX_LANGGRAPH_BYTES: u64 = 256 * 1024;

fn identifier(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with(|c: char| c.is_ascii_digit())
        && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// `module:attr` (an attribute path `a.b` keeps its first name).
fn split_target(s: &str) -> Option<(&str, &str)> {
    let (module, attr) = s.split_once(':')?;
    let attr = attr.trim().split(['.', ' ', '[']).next()?;
    identifier(attr).then_some((module.trim(), attr))
}

/// Entry points the projects holding `files` declare (see [`DeclaredEntry`]), sorted:
/// console scripts of every `pyproject.toml`, and the graphs of every
/// `langgraph.json`, in the directories [`packages`] looks at.
pub fn declared_entries<'a>(
    root: &Path,
    files: impl IntoIterator<Item = &'a Path>,
) -> Vec<DeclaredEntry> {
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for f in files {
        let mut cur = f.parent();
        while let Some(d) = cur {
            if !d.starts_with(root) || !dirs.insert(d.to_path_buf()) {
                break;
            }
            cur = d.parent();
        }
    }
    let mut out = Vec::new();
    for dir in &dirs {
        let names = file_names(dir);
        if names.contains("pyproject.toml")
            && let Some(t) = read_small(&dir.join("pyproject.toml"))
        {
            for s in read_pyproject(&t).console_scripts {
                let Some((module, attr)) = split_target(&s) else {
                    continue;
                };
                if !module.split('.').all(identifier) {
                    continue;
                }
                out.push(DeclaredEntry {
                    dir: dir.clone(),
                    target: EntryTarget::Module {
                        module: module.to_string(),
                        attr: attr.to_string(),
                    },
                    kind: "cli",
                    adapter: "console_script",
                });
            }
        }
        if names.contains("langgraph.json") {
            let path = dir.join("langgraph.json");
            let small = std::fs::symlink_metadata(&path)
                .is_ok_and(|m| m.is_file() && m.len() <= MAX_LANGGRAPH_BYTES);
            let json = small
                .then(|| std::fs::read_to_string(&path).ok())
                .flatten()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
            let Some(graphs) = json
                .as_ref()
                .and_then(|j| j.get("graphs"))
                .and_then(|g| g.as_object())
            else {
                continue;
            };
            for g in graphs.values() {
                let spec = match g {
                    serde_json::Value::String(s) => Some(s.as_str()),
                    serde_json::Value::Object(o) => o.get("path").and_then(|p| p.as_str()),
                    _ => None,
                };
                let Some((file, attr)) = spec.and_then(split_target) else {
                    continue;
                };
                let Some(rel) = rel_file(root, dir, file) else {
                    continue;
                };
                out.push(DeclaredEntry {
                    dir: dir.clone(),
                    target: EntryTarget::File {
                        path: rel,
                        attr: attr.to_string(),
                    },
                    kind: "agent_graph",
                    adapter: "langgraph",
                });
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// A `.py` path written relative to `dir` (`./src/graph.py`), as a repo-relative path;
/// `None` when it leaves the repo or is not a Python file.
fn rel_file(root: &Path, dir: &Path, file: &str) -> Option<String> {
    if !file.ends_with(".py") || file.starts_with('/') {
        return None;
    }
    let base = rel_posix(root, dir)?;
    let mut segs: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for part in file.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segs.pop()?;
            }
            p => segs.push(p),
        }
    }
    Some(segs.join("/"))
}

/// Python package manifests whose content [`packages`] reads.
pub fn is_manifest(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name == "pyproject.toml" || name == "langgraph.json" || is_requirements_file(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pep508_requirements() {
        assert_eq!(
            normalize_name("Django_REST.framework"),
            "django-rest-framework"
        );
        assert_eq!(
            pep508_dep("requests[socks] >= 2.0, <3 ; python_version < \"3.11\"").unwrap(),
            "requests@>=2.0,<3"
        );
        assert_eq!(pep508_dep("PyYAML").unwrap(), "pyyaml@*");
        assert_eq!(
            pep508_dep("pkg @ https://example.com/pkg-1.0.whl").unwrap(),
            "pkg@https://example.com/pkg-1.0.whl"
        );
        assert_eq!(pep508_dep("Django (>=4.2)").unwrap(), "django@>=4.2");
        assert!(pep508_dep("./local/path").is_none());
        assert!(pep508_dep("").is_none());
        assert_eq!(
            requirements_deps(
                "# pinned\n-r base.txt\n-e git+https://x/y.git#egg=y\nDjango==5.2.1  # web\nboto3>=1.0 \\\n  --hash=sha256:abc\nhttps://x/z.whl\n\ncelery[redis]~=5.4\n"
            ),
            ["django@==5.2.1", "boto3@>=1.0", "celery@~=5.4"]
        );
    }

    #[test]
    fn pyproject_sources() {
        let p = read_pyproject(
            r#"
[project]
name = "My_App"
dynamic = ["version"]
dependencies = ["fastapi[standard]>=0.115", "numpy>=1.26; python_version<'3.13'"]
scripts = { app = "app.cli:main" }
[project.optional-dependencies]
s3 = ["boto3"]
[dependency-groups]
dev = ["pytest>=8", { include-group = "lint" }]
lint = ["ruff"]
[tool.poe.tasks]
test = "pytest"
lint = "ruff check"
"#,
        );
        assert_eq!(p.name, "my-app");
        assert_eq!(
            p.dependencies,
            [
                "fastapi@>=0.115",
                "numpy@>=1.26",
                "boto3@*",
                "pytest@>=8",
                "ruff@*"
            ]
        );
        assert_eq!(p.scripts, ["lint", "test"]);
        assert!(!p.dynamic_dependencies);

        let poetry = read_pyproject(
            r#"
[tool.poetry]
name = "svc"
[tool.poetry.dependencies]
python = "^3.12"
Django = "^5.0"
lib = { path = "../lib", develop = true }
pkg = { version = ">= 1.2", extras = ["x"] }
[tool.poetry.group.dev.dependencies]
pytest = "^8"
"#,
        );
        assert_eq!(poetry.name, "svc");
        assert_eq!(
            poetry.dependencies,
            ["django@^5.0", "lib@path:../lib", "pkg@>=1.2", "pytest@^8"]
        );
        assert!(read_pyproject("not toml [").dependencies.is_empty());
        assert!(read_pyproject("[project]\ndynamic = [\"dependencies\"]\n").dynamic_dependencies);
    }

    #[test]
    fn packages_of_projects_holding_python() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        let write = |rel: &str, body: &str| {
            let p = r.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        write(
            "pyproject.toml",
            "[tool.uv.workspace]\nmembers = [\"libs/*\"]\n[dependency-groups]\ndev = [\"ruff\"]\n",
        );
        write(
            "libs/core/pyproject.toml",
            "[project]\nname = \"acme-core\"\ndependencies = [\"pydantic>=2\"]\n",
        );
        write("libs/core/acme_core/__init__.py", "");
        write(
            "libs/app/pyproject.toml",
            "[project]\nname = \"acme-app\"\ndynamic = [\"dependencies\"]\n",
        );
        write("libs/app/requirements.txt", "acme-core\nfastapi==0.115.0\n");
        write("libs/app/app.py", "");
        write("svc/requirements-dev.txt", "pytest\n");
        write("svc/requirements.txt", "django>=5\n");
        write("svc/manage.py", "");
        // No Python below: not a package.
        write("rust/pyproject.toml", "[project]\nname = \"ext\"\n");
        let files = [
            r.join("libs/core/acme_core/__init__.py"),
            r.join("libs/app/app.py"),
            r.join("svc/manage.py"),
        ];
        let root = r.canonicalize().unwrap();
        let files: Vec<PathBuf> = files.iter().map(|f| f.canonicalize().unwrap()).collect();
        let ps = packages(&root, files.iter().map(PathBuf::as_path));
        let got: Vec<(&str, &str, &str, Vec<&str>)> = ps
            .iter()
            .map(|p| {
                (
                    p.path.as_str(),
                    p.name.as_str(),
                    p.manifest.as_str(),
                    p.dependencies.iter().map(String::as_str).collect(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                ("", "", "pyproject.toml", vec!["ruff@*"]),
                (
                    "libs/app",
                    "acme-app",
                    "libs/app/pyproject.toml",
                    vec!["acme-core@*", "fastapi@==0.115.0"]
                ),
                (
                    "libs/core",
                    "acme-core",
                    "libs/core/pyproject.toml",
                    vec!["pydantic@>=2"]
                ),
                (
                    "svc",
                    "",
                    "svc/requirements.txt",
                    vec!["django@>=5", "pytest@*"]
                ),
            ]
        );
    }
}
