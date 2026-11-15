//! Workspace packages: the packages one repository holds (a monorepo's apps, services
//! and libraries) and which package each file belongs to.
//!
//! **What a package is.** A directory with its own manifest: `package.json` for
//! TypeScript/JavaScript, `pyproject.toml`, `setup.cfg` or `setup.py` for Python (a
//! `requirements.txt`-only project too). A file belongs to the package of its nearest
//! manifest of its own language ([`drift_core::FileFacts::package`], "" for the
//! repository root); the scan assigns it. So an app nested without any workspace
//! manifest (`frontend/package.json` beside `backend/services/*/pyproject.toml`) is a
//! package like a declared workspace member. The walk that finds them honours
//! `.gitignore` and `.ignore` and never enters `node_modules`, virtualenvs or vendor
//! directories ([`drift_core::ingest::walk`]).
//!
//! **Declared membership** is read for the report: root `package.json` `workspaces`
//! (npm, yarn, bun, turbo), `pnpm-workspace.yaml`, `lerna.json`, `nx.json`/`turbo.json`
//! (named as the workspace's tools) and `[tool.uv.workspace]` members of any
//! `pyproject.toml`. It never changes which package a file is in.
//!
//! **Order.** Packages are listed by path in code-point order, the root ("") first.
//! Every output here is a function of the facts and the manifests' bytes only.
//!
//! **Override.** `packages:` in `.drift/config.yaml` ([`PackageSettings`]): `roots`
//! (globs) replaces discovery with explicit package roots; `exclude` and `include`
//! (globs) leave packages out of mining and checking.
//!
//! **Single-package repositories.** A repository with at most one package that holds
//! production files ([`Workspace::is_multi`]) is mined, checked and reported exactly as
//! before this module existed: nothing here changes a byte of its output.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::RepoFacts;
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Serialize;

use crate::roles::{NonProduction, is_python_package, is_test_path, package_json_path};

static INTRA_PACKAGE_LAYERING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Whether imports inside one workspace package are layer edges (experimental
/// [`crate::policy::INTRA_PACKAGE_LAYERING_FEATURE`], off by default). Off, they are no
/// layering signal, in mining and in `check` alike, exactly as before workspaces.
pub fn intra_package_layering() -> bool {
    INTRA_PACKAGE_LAYERING.load(std::sync::atomic::Ordering::Relaxed)
}

/// Set [`intra_package_layering`] for this process from the config at `root` (or
/// [`crate::policy::EXPERIMENTAL_ENV`]); a config that cannot be read leaves it off. Every
/// entry point that resolves a project root (the CLI commands, the hooks, MCP) calls it.
pub fn configure(root: &Path) {
    let on = crate::policy::DriftConfig::load(root)
        .map(|c| c.enabled(crate::policy::INTRA_PACKAGE_LAYERING_FEATURE))
        .unwrap_or(false);
    INTRA_PACKAGE_LAYERING.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// One package of the repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Package {
    /// Repo-relative directory ("" for the repository root).
    pub path: String,
    /// Languages of its production files (`ts`, `py`), sorted.
    pub languages: Vec<String>,
    /// Production files analysed in it (tests, examples and fixtures not counted: what
    /// mining reads).
    pub files: usize,
    /// Its manifests, repo-relative, sorted.
    pub manifests: Vec<String>,
    /// The workspace manifests that list it as a member (`package.json workspaces`,
    /// `pnpm-workspace.yaml`, `lerna.json`, `uv workspace`), sorted. Empty: a nested
    /// package no workspace manifest names (it is a package all the same).
    pub declared_by: Vec<String>,
}

/// The repository's packages ([`Workspace::discover`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Workspace {
    /// By path, the root first.
    pub packages: Vec<Package>,
    /// Workspace tools whose manifests are present (`npm`, `pnpm`, `lerna`, `nx`,
    /// `turbo`, `uv`), sorted.
    pub tools: Vec<String>,
}

/// The deepest of `packages` (directories, "" the root) that holds `rel`: the package
/// of a file that may not exist yet. "" when none does.
pub fn package_of<'a>(packages: impl IntoIterator<Item = &'a str>, rel: &str) -> &'a str {
    packages
        .into_iter()
        .filter(|p| p.is_empty() || rel.starts_with(&format!("{p}/")))
        .max_by_key(|p| p.len())
        .unwrap_or("")
}

impl Workspace {
    /// The packages of `repo` (scanned at `root`, whose workspace manifests are read
    /// when `root` is given).
    pub fn discover(root: Option<&Path>, repo: &RepoFacts) -> Self {
        let non_production = NonProduction::learn(repo);
        let mut by_path: BTreeMap<String, (BTreeSet<String>, usize, BTreeSet<String>)> =
            BTreeMap::new();
        for f in &repo.files {
            let e = by_path.entry(f.package.clone()).or_default();
            if !is_test_path(&f.path) && !non_production.contains(&f.path, &f.package) {
                e.0.insert(if f.lang == "py" { "py" } else { "ts" }.to_string());
                e.1 += 1;
            }
        }
        // With explicit `packages.roots`, a manifest belongs to the root holding it.
        let explicit = root
            .and_then(|r| crate::policy::DriftConfig::load(r).ok())
            .is_some_and(|c| !c.packages.roots.is_empty());
        let file_packages: Vec<String> = by_path.keys().cloned().collect();
        for p in &repo.packages {
            let manifest = package_json_path(p);
            if is_test_path(&manifest) || non_production.contains(&manifest, &p.path) {
                continue;
            }
            let at = if explicit {
                let probe = format!("{}/_", p.path);
                package_of(file_packages.iter().map(String::as_str), &probe).to_string()
            } else {
                p.path.clone()
            };
            by_path.entry(at).or_default().2.insert(manifest);
        }
        let declared = root.map(|r| declared_members(r, repo)).unwrap_or_default();
        let packages = by_path
            .into_iter()
            .map(|(path, (langs, files, manifests))| {
                let declared_by = declared
                    .members
                    .iter()
                    .filter(|(_, set)| !path.is_empty() && set.is_match(&path))
                    .map(|(by, _)| by.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                Package {
                    path,
                    languages: langs.into_iter().collect(),
                    files,
                    manifests: manifests.into_iter().collect(),
                    declared_by,
                }
            })
            .collect();
        Workspace {
            packages,
            tools: declared.tools.into_iter().collect(),
        }
    }

    /// At least two packages hold production files: the condition under which the census
    /// reports per package and `drift init` writes the policy's `packages`.
    pub fn is_multi(&self) -> bool {
        self.packages.iter().filter(|p| p.files > 0).count() >= 2
    }

    /// The package of `rel` ([`package_of`]).
    pub fn package_of(&self, rel: &str) -> &str {
        package_of(self.packages.iter().map(|p| p.path.as_str()), rel)
    }
}

/// What the workspace manifests declare.
#[derive(Default)]
struct Declared {
    /// (the manifest that declares them, its member globs, its excluded globs).
    members: Vec<(String, Members)>,
    tools: BTreeSet<String>,
}

/// Member globs of one workspace manifest, repo-relative.
struct Members {
    include: GlobSet,
    exclude: GlobSet,
}

impl Members {
    fn is_match(&self, path: &str) -> bool {
        self.include.is_match(path) && !self.exclude.is_match(path)
    }

    /// `globs` relative to `base`; entries starting with `!` (pnpm, yarn) and
    /// `exclude` exclude. `None` when nothing is included.
    fn new(base: &str, globs: &[String], exclude: &[String]) -> Option<Self> {
        let mut inc = GlobSetBuilder::new();
        let mut exc = GlobSetBuilder::new();
        let mut any = false;
        let negated = globs.iter().filter_map(|g| g.strip_prefix('!'));
        for (g, neg) in globs
            .iter()
            .filter(|g| !g.starts_with('!'))
            .map(|g| (g.as_str(), false))
            .chain(
                negated
                    .chain(exclude.iter().map(String::as_str))
                    .map(|g| (g, true)),
            )
        {
            let g = g.trim_start_matches("./").trim_end_matches('/');
            if g.is_empty() || g.contains("..") {
                continue;
            }
            let full = if base.is_empty() {
                g.to_string()
            } else {
                format!("{base}/{g}")
            };
            let Ok(glob) = Glob::new(&full) else { continue };
            if neg {
                exc.add(glob);
            } else {
                inc.add(glob);
                any = true;
            }
        }
        if !any {
            return None;
        }
        Some(Self {
            include: inc.build().ok()?,
            exclude: exc.build().ok()?,
        })
    }
}

fn read(root: &Path, rel: &str) -> Option<String> {
    drift_core::fsutil::read_regular_to_string(
        &root.join(rel),
        drift_core::fsutil::MAX_CONFIG_BYTES,
    )
    .ok()
}

fn strings(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn toml_strings(t: &toml::Table, path: &[&str]) -> Vec<String> {
    let mut v: Option<&toml::Value> = None;
    let mut cur = t;
    for (i, k) in path.iter().enumerate() {
        let Some(x) = cur.get(*k) else { return vec![] };
        if i + 1 == path.len() {
            v = Some(x);
        } else if let Some(t) = x.as_table() {
            cur = t;
        } else {
            return vec![];
        }
    }
    v.and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// The workspace manifests at `root`, and the `[tool.uv.workspace]` of every Python
/// project in `repo`.
fn declared_members(root: &Path, repo: &RepoFacts) -> Declared {
    let mut out = Declared::default();
    let add = |by: &str, base: &str, globs: Vec<String>, exclude: Vec<String>| {
        Members::new(base, &globs, &exclude).map(|m| (by.to_string(), m))
    };
    if let Some(v) =
        read(root, "package.json").and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
    {
        let ws = v.get("workspaces");
        let globs = match ws {
            Some(serde_json::Value::Array(_)) => strings(ws),
            Some(o) => strings(o.get("packages")),
            None => vec![],
        };
        if let Some(m) = add("package.json workspaces", "", globs, vec![]) {
            out.tools.insert("npm".into());
            out.members.push(m);
        }
    }
    if let Some(v) = read(root, "pnpm-workspace.yaml")
        .and_then(|t| serde_saphyr::from_str::<serde_json::Value>(&t).ok())
    {
        out.tools.insert("pnpm".into());
        out.members.extend(add(
            "pnpm-workspace.yaml",
            "",
            strings(v.get("packages")),
            vec![],
        ));
    }
    if let Some(v) =
        read(root, "lerna.json").and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
    {
        out.tools.insert("lerna".into());
        out.members
            .extend(add("lerna.json", "", strings(v.get("packages")), vec![]));
    }
    for (file, tool) in [("nx.json", "nx"), ("turbo.json", "turbo")] {
        if root.join(file).is_file() {
            out.tools.insert(tool.into());
        }
    }
    for p in repo.packages.iter().filter(|p| is_python_package(p)) {
        if !p.manifest.ends_with("pyproject.toml") {
            continue;
        }
        let Some(t) = read(root, &p.manifest).and_then(|t| t.parse::<toml::Table>().ok()) else {
            continue;
        };
        let members = toml_strings(&t, &["tool", "uv", "workspace", "members"]);
        if members.is_empty() {
            continue;
        }
        let exclude = toml_strings(&t, &["tool", "uv", "workspace", "exclude"]);
        out.tools.insert("uv".into());
        out.members
            .extend(add("uv workspace", &p.path, members, exclude));
    }
    out
}

/// `packages:` in `.drift/config.yaml`: which directories are packages, and which are
/// mined and checked. Globs are repo-relative directory globs (`backend/services/*`);
/// `.` names the repository root package.
///
/// ```yaml
/// packages:
///   roots: [frontend, backend/services/*, backend/packages/*]  # replaces discovery
///   exclude: [backend/services/legacy]                         # not mined or checked
///   include: [frontend, backend/**]                            # only these
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct PackageSettings {
    /// Explicit package roots: each file is in the deepest one holding it (else the
    /// root package), whatever its manifests say. Empty: discovery ([`Workspace`]).
    #[serde(default)]
    pub roots: Vec<String>,
    /// Packages left out of mining, `check`, the hooks and MCP.
    #[serde(default)]
    pub exclude: Vec<String>,
    /// When set, only these packages are mined and checked.
    #[serde(default)]
    pub include: Vec<String>,
}

impl PackageSettings {
    pub fn is_empty(&self) -> bool {
        self.roots.is_empty() && self.exclude.is_empty() && self.include.is_empty()
    }

    /// `packages` as written; what Drift cannot read is a warning and leaves that
    /// part unset (discovery, nothing excluded).
    pub fn read(v: &serde_json::Value, warnings: &mut Vec<String>) -> Self {
        let file = crate::policy::CONFIG_FILE;
        let Some(map) = v.as_object() else {
            warnings.push(format!(
                "{file}: `packages` must be a mapping of `roots`, `include` and `exclude` (ignored)"
            ));
            return Self::default();
        };
        let mut out = Self::default();
        for (k, v) in map {
            let list: Option<Vec<String>> = serde_json::from_value(v.clone()).ok();
            let slot = match k.as_str() {
                "roots" => &mut out.roots,
                "exclude" => &mut out.exclude,
                "include" => &mut out.include,
                _ => {
                    warnings.push(format!("{file}: unknown setting `packages.{k}` (ignored)"));
                    continue;
                }
            };
            match list {
                Some(l) => *slot = l,
                None => warnings.push(format!(
                    "{file}: `packages.{k}` must be a list of directory globs (ignored)"
                )),
            }
        }
        for g in out.roots.iter().chain(&out.include).chain(&out.exclude) {
            if dir_glob(g).is_none() {
                warnings.push(format!(
                    "{file}: `{}` in `packages` is not a valid glob (ignored)",
                    crate::report::sanitize(g, 80)
                ));
            }
        }
        out
    }
}

/// A directory glob as written (`./x/` is `x`, `.` the root package "").
fn dir_glob(g: &str) -> Option<globset::GlobMatcher> {
    let g = g.trim_start_matches("./").trim_end_matches('/');
    if g.contains("..") {
        return None;
    }
    let g = if g == "." { "" } else { g };
    Glob::new(g).ok().map(|g| g.compile_matcher())
}

fn matchers(globs: &[String]) -> Vec<globset::GlobMatcher> {
    globs.iter().filter_map(|g| dir_glob(g)).collect()
}

/// Apply `packages:` ([`PackageSettings`]) to scanned facts: reassign each file's
/// package to the deepest explicit root holding it (`roots`), then drop the files of
/// excluded packages (`exclude`, or not in `include`). Nothing changes without the
/// setting. Run by every scan (mining, `check`, the hooks, MCP), so all of them see
/// the same packages.
pub fn apply(settings: &PackageSettings, repo: &mut RepoFacts) {
    if settings.is_empty() {
        return;
    }
    let roots = matchers(&settings.roots);
    if !roots.is_empty() {
        let root_of = |path: &str| -> String {
            let mut dir = path;
            while let Some((parent, _)) = dir.rsplit_once('/') {
                if roots.iter().any(|m| m.is_match(parent)) {
                    return parent.to_string();
                }
                dir = parent;
            }
            String::new()
        };
        for f in repo.files.iter_mut().chain(repo.context_files.iter_mut()) {
            f.package = root_of(&f.path);
        }
    }
    let exclude = matchers(&settings.exclude);
    let include = matchers(&settings.include);
    if exclude.is_empty() && include.is_empty() {
        return;
    }
    let kept = |package: &str| {
        !exclude.iter().any(|m| m.is_match(package))
            && (include.is_empty() || include.iter().any(|m| m.is_match(package)))
    };
    let dirs = repo_dirs(&repo.files);
    repo.models
        .retain(|m| kept(package_of(dirs.iter().map(String::as_str), &m.path)));
    repo.files.retain(|f| kept(&f.package));
    repo.packages.retain(|p| kept(&p.path));
}

/// The packages of `files`, sorted.
fn repo_dirs(files: &[drift_core::FileFacts]) -> Vec<String> {
    files
        .iter()
        .map(|f| f.package.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
