//! What [`crate::mine::Rule::ImportsDeclared`] decides: code in a workspace package
//! imports only the packages that package's own `package.json` declares.
//!
//! An import that resolves only because another workspace package or the root happens
//! to install it (a phantom dependency) breaks when that package changes its manifest,
//! and is how a package nobody chose ends up in a build. Drift already reads every
//! import, resolves it, and reads every manifest (`RepoFacts::packages`); this module
//! joins them. It is a rule proposed from the map ([`crate::from_map::manifest`]), never
//! mined, and nothing reads it until a person accepts one.
//!
//! How each import of a production TypeScript or JavaScript file is decided, from the
//! facts alone (the resolver's result and the manifests as read):
//!
//! - **Declared** means named in `dependencies`, `devDependencies`, `peerDependencies`
//!   or `optionalDependencies` of the file's nearest `package.json` (the package the scan
//!   gives the file). Any range counts, the workspace protocol (`workspace:*`) and
//!   catalogs (`catalog:`) included: the rule is about undeclared packages, not about
//!   ranges ([`crate::mine::Rule::DependencyVersion`] is that rule). devDependencies
//!   count for production files too: whether a package may use a devDependency at run
//!   time depends on whether it is bundled or published, which the manifest does not
//!   say, so that split is not this rule's to decide.
//! - A **Node built-in** (`node:fs`, `fs`, as the resolver marks them) never needs
//!   declaring.
//! - The **package's own name** (a self-reference through its `exports`) holds, whether
//!   the resolver kept it as a package or followed it to the package's own files.
//! - An import the resolver followed to a file **inside the repository** (a relative
//!   path, a `paths` alias, a `baseUrl` import or a workspace package by name: the facts
//!   keep where it landed, not how it was written) holds when it lands in the file's own
//!   package or in the root package (the workspace itself, which no package declares).
//!   One that lands in another named workspace package needs that package's name
//!   declared, whichever way it was written: it is the same undeclared edge, and build
//!   tools order and install by the manifest. A package with no name cannot be declared
//!   and is reached by path only, so an import of it is not this rule's. A package
//!   nested inside another (`packages/features/auth` inside `packages/features`) is also
//!   reached by a path or a subpath of the one around it (`@acme/features/auth/x`), and
//!   the facts do not keep which was written, so an import landing there holds when the
//!   file's own package is around it or a package around it is declared.
//! - A **type-only** import also holds when the package's DefinitelyTyped name
//!   (`@types/<name>`, `@types/<scope>__<name>`) is declared: that is where TypeScript
//!   looks for the types of an untyped package.
//! - A **subpath** (`lodash/fp`, `@scope/pkg/sub`) is its package's: the package name is
//!   the first segment, the first two for a scoped name.
//!
//! What is **not checked** (counted, never a violation, never a pass): an import the
//! resolver could not resolve (`unresolved:`, a relative or aliased specifier, or a
//! dynamic one it could not read), a package no manifest of the repository declares
//! (it may come through another package's dependencies, a bundler alias or a global
//! Drift does not read, so Drift cannot say it resolves only by accident), an import
//! that lands in a package whose manifest Drift did not read, a file whose own manifest
//! Drift did not read (a `package.json` that is not JSON gives no facts), a file whose
//! imports were cut short, and every Python file: a Python import names a module, not
//! the distribution that ships it (`yaml` is PyYAML), and Drift's facts do not tie one
//! to the other, so a Python import is never judged here. Test files are not members:
//! the rule's role is a package's production files, as every role is.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, Import, RepoFacts};
use serde::{Deserialize, Serialize};

use crate::context::split_dep;
use crate::mine::Told;
use crate::roles::{View, is_python_package};

/// Why a Python file is never judged by the rule (see the module docs).
pub const PYTHON_WHY: &str = "a Python import names a module, not the distribution that ships it, and Drift's facts do not tie one to the other";

/// An import that breaks the rule: what it imports, the manifest that should declare
/// it, and where it is declared instead. Carried by the violation
/// ([`crate::check::ImportHit::undeclared`]) so every text that shows it can say how to
/// fix it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Undeclared {
    /// The package name (`zod`, `@acme/ui`), never a subpath.
    pub package: String,
    /// The manifest that should declare it, repo-relative (`packages/web/package.json`).
    pub manifest: String,
    /// The manifests that do declare it (`package.json` for the root), sorted; empty for
    /// a workspace package nobody declares.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub declared_in: Vec<String>,
    /// The directory of the workspace package it is, when it is one (`packages/ui`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub workspace: String,
    /// The import is type-only: the package's `@types/` name would do too.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub type_only: bool,
}

impl Undeclared {
    /// Where it is declared instead, in words: `declared in package.json at the root,
    /// apps/web/package.json`, `the workspace package at packages/ui`.
    pub fn where_words(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        if !self.workspace.is_empty() {
            parts.push(format!("the workspace package at {}", self.workspace));
        }
        if !self.declared_in.is_empty() {
            let named: Vec<String> = self
                .declared_in
                .iter()
                .take(MAX_NAMED)
                .map(|m| {
                    if m == ROOT_MANIFEST {
                        format!("{m} at the root")
                    } else {
                        m.clone()
                    }
                })
                .collect();
            let more = self.declared_in.len().saturating_sub(MAX_NAMED);
            let mut s = format!("declared in {}", named.join(", "));
            if more > 0 {
                s.push_str(&format!(" and {more} more"));
            }
            parts.push(s);
        }
        parts.join("; ")
    }

    /// The fix, as text: what to add where. No command: installing is the person's.
    pub fn fix(&self) -> String {
        let types = if self.type_only {
            format!(
                " (or {}: the import is type-only)",
                types_name(&self.package)
            )
        } else {
            String::new()
        };
        format!("add {} to {}{types}", self.package, self.manifest)
    }

    /// What `drift check` says after the import: `not declared in apps/web/package.json
    /// (declared in package.json at the root); fix: add zod to apps/web/package.json`.
    pub fn describe(&self) -> String {
        let at = self.where_words();
        let at = if at.is_empty() {
            String::new()
        } else {
            format!(" ({at})")
        };
        format!("not declared in {}{at}; fix: {}", self.manifest, self.fix())
    }
}

/// Manifests named per break ([`Undeclared::where_words`]).
const MAX_NAMED: usize = 3;

/// The root manifest's path.
const ROOT_MANIFEST: &str = "package.json";

/// The `package.json` of the package at `dir` (`""` for the root).
pub fn manifest_path(dir: &str) -> String {
    if dir.is_empty() {
        ROOT_MANIFEST.to_string()
    } else {
        format!("{dir}/{ROOT_MANIFEST}")
    }
}

/// The DefinitelyTyped name of a package: `@types/zod`, `@types/scope__name`.
fn types_name(package: &str) -> String {
    match package.strip_prefix('@') {
        Some(scoped) => format!("@types/{}", scoped.replacen('/', "__", 1)),
        None => format!("@types/{package}"),
    }
}

/// One `package.json` Drift read.
#[derive(Debug, Clone, Default)]
struct Manifest<'a> {
    name: &'a str,
    /// Every name it declares, in any of the four sections.
    declares: BTreeSet<&'a str>,
}

/// What the rule reads of a repository: its npm manifests and where each file is. Built
/// once per [`crate::context::RepoContext`].
#[derive(Debug, Clone, Default)]
pub struct Index<'a> {
    /// The `package.json` files Drift read, by package directory.
    manifests: BTreeMap<&'a str, Manifest<'a>>,
    /// Named workspace packages (npm), by name.
    by_name: BTreeMap<&'a str, &'a str>,
    /// The package of each file the scan holds (its nearest `package.json` on disk, read
    /// or not), so an import that lands in a package whose manifest Drift could not read
    /// is not taken for one of the package around it.
    file_package: BTreeMap<&'a str, &'a str>,
}

impl<'a> Index<'a> {
    pub fn new(repo: &'a RepoFacts) -> Self {
        let mut manifests: BTreeMap<&str, Manifest> = BTreeMap::new();
        for p in repo.packages.iter().filter(|p| !is_python_package(p)) {
            let m = manifests.entry(p.path.as_str()).or_default();
            m.name = p.name.as_str();
            m.declares.extend(
                p.dependencies
                    .iter()
                    .chain(&p.peer_dependencies)
                    .chain(&p.optional_dependencies)
                    .filter_map(|d| split_dep(d).map(|(n, _)| n)),
            );
        }
        let by_name = manifests
            .iter()
            .filter(|(_, m)| !m.name.is_empty())
            .map(|(dir, m)| (m.name, *dir))
            .collect();
        let file_package = repo
            .files
            .iter()
            .chain(&repo.context_files)
            .map(|f| (f.path.as_str(), f.package.as_str()))
            .chain(
                repo.integration_files
                    .iter()
                    .map(|f| (f.path.as_str(), f.package.as_str())),
            )
            .collect();
        Self {
            manifests,
            by_name,
            file_package,
        }
    }

    /// Whether Drift read the `package.json` of the package at `dir`.
    pub fn read(&self, dir: &str) -> bool {
        self.manifests.contains_key(dir)
    }

    /// The package name of the manifest at `dir`, when Drift read it.
    pub fn name(&self, dir: &str) -> Option<&'a str> {
        self.manifests.get(dir).map(|m| m.name)
    }

    /// The manifests other than `own`'s that declare `name`, sorted.
    fn declared_elsewhere(&self, own: &str, name: &str) -> Vec<String> {
        self.manifests
            .iter()
            .filter(|(dir, m)| **dir != own && m.declares.contains(name))
            .map(|(dir, _)| manifest_path(dir))
            .collect()
    }

    /// Whether a named package whose directory holds `dir` (a package nested inside it)
    /// is one of `declares`.
    fn declared_around(&self, declares: &BTreeSet<&str>, dir: &str) -> bool {
        self.manifests.iter().any(|(d, m)| {
            !d.is_empty()
                && *d != dir
                && within(dir, d)
                && !m.name.is_empty()
                && declares.contains(m.name)
        })
    }

    /// The package an in-repo module lands in: the scan's for a file it holds, else the
    /// deepest manifest Drift read whose directory holds it, else the root.
    fn package_of(&self, module: &str) -> &'a str {
        if let Some(p) = self.file_package.get(module) {
            return p;
        }
        self.manifests
            .keys()
            .filter(|d| {
                !d.is_empty()
                    && module
                        .strip_prefix(**d)
                        .is_some_and(|rest| rest.starts_with('/'))
            })
            .max_by_key(|d| d.len())
            .copied()
            .unwrap_or("")
    }
}

/// What the rule says of one import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Holds,
    Breaks(Undeclared),
    /// Not checked, with why in plain words.
    NotChecked(String),
}

/// What the rule says of one file: its imports that break it, and why the others it
/// could not judge were not checked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileVerdict {
    /// `(module, why)` for each breaking import, in the file's import order.
    pub breaks: Vec<(String, Undeclared)>,
    /// Why each import (or the whole file) was not checked.
    pub not_checked: Vec<String>,
    /// Imports of a package (another workspace package or a third-party one) that were
    /// judged: the file is one the rule says something about.
    pub packages: usize,
}

impl FileVerdict {
    /// As `drift check` reads it: a known break is a break whatever else could not be
    /// read; otherwise anything not read leaves the file not checked.
    pub fn told(&self) -> Told {
        if !self.breaks.is_empty() {
            Told::Breaks
        } else if let Some(why) = self.not_checked.first() {
            let more = self.not_checked.len() - 1;
            Told::CannotTell(if more == 0 {
                why.clone()
            } else {
                format!("{why} (and {more} more import(s) not checked)")
            })
        } else {
            Told::Holds
        }
    }
}

/// The rule's verdict on the file `f` ([`Verdict`] of each import).
pub fn judge(f: &FileFacts, idx: &Index<'_>) -> FileVerdict {
    let mut out = FileVerdict::default();
    if f.lang == "py" {
        out.not_checked.push(PYTHON_WHY.to_string());
        return out;
    }
    let Some(own) = idx.manifests.get(f.package.as_str()) else {
        out.not_checked.push(format!(
            "Drift did not read its manifest {}",
            manifest_path(&f.package)
        ));
        return out;
    };
    if f.truncated.iter().any(|t| t == "imports") {
        out.not_checked
            .push("its imports were cut short, so Drift did not read them all".to_string());
        return out;
    }
    for i in &f.imports {
        match import_verdict(f, own, i, idx) {
            (Verdict::Holds, counted) => out.packages += usize::from(counted),
            (Verdict::Breaks(u), _) => {
                out.packages += 1;
                out.breaks.push((i.module.clone(), u));
            }
            (Verdict::NotChecked(why), _) => out.not_checked.push(why),
        }
    }
    out
}

/// One import's verdict, and whether it was an import of a package the rule judged.
fn import_verdict(
    f: &FileFacts,
    own: &Manifest<'_>,
    i: &Import,
    idx: &Index<'_>,
) -> (Verdict, bool) {
    let m = i.module.as_str();
    if let Some(spec) = m.strip_prefix("unresolved:") {
        return (
            Verdict::NotChecked(format!("Drift could not resolve its import `{spec}`")),
            false,
        );
    }
    if m.starts_with("pkg:node:") {
        return (Verdict::Holds, false);
    }
    let manifest = manifest_path(&f.package);
    let breaks = |package: &str, workspace: &str| Undeclared {
        package: package.to_string(),
        manifest: manifest.clone(),
        declared_in: idx.declared_elsewhere(&f.package, package),
        workspace: workspace.to_string(),
        type_only: i.type_only,
    };
    if let Some(name) = crate::map::imported_package_name(m) {
        if name.is_empty() {
            return (
                Verdict::NotChecked(format!("Drift cannot tell the package of `{m}`")),
                false,
            );
        }
        if name == own.name
            || own.declares.contains(name.as_str())
            || (i.type_only && own.declares.contains(types_name(&name).as_str()))
        {
            return (Verdict::Holds, name != own.name);
        }
        if let Some(&dir) = idx.by_name.get(name.as_str()) {
            if dir == f.package {
                return (Verdict::Holds, false);
            }
            return (Verdict::Breaks(breaks(&name, dir)), true);
        }
        let u = breaks(&name, "");
        if u.declared_in.is_empty() {
            return (
                Verdict::NotChecked(format!(
                    "no manifest of the repository declares {name}, so Drift cannot tell how it resolves (another package's dependency, a bundler alias, a global)"
                )),
                false,
            );
        }
        return (Verdict::Breaks(u), true);
    }
    // Resolved to a file of the repository.
    let target = idx.package_of(m);
    if target == f.package || target.is_empty() {
        return (Verdict::Holds, false);
    }
    let Some(t) = idx.manifests.get(target) else {
        return (
            Verdict::NotChecked(format!(
                "it imports code of {target}, whose manifest Drift did not read"
            )),
            false,
        );
    };
    if t.name.is_empty() {
        return (Verdict::Holds, false);
    }
    if own.declares.contains(t.name) {
        return (Verdict::Holds, true);
    }
    // A package nested inside another (`packages/features/auth` in `packages/features`):
    // the file's own package around it, or a declared package around it, reaches it by
    // a path or subpath (`@acme/features/auth/x`).
    if (!f.package.is_empty() && within(target, &f.package))
        || idx.declared_around(&own.declares, target)
    {
        return (Verdict::Holds, true);
    }
    (Verdict::Breaks(breaks(t.name, target)), true)
}

/// Whether directory `dir` is `ancestor` or under it (`""` holds every directory).
fn within(dir: &str, ancestor: &str) -> bool {
    ancestor.is_empty()
        || dir == ancestor
        || dir
            .strip_prefix(ancestor)
            .is_some_and(|r| r.starts_with('/'))
}

/// [`crate::mine::Rule::ImportsDeclared`] as mining and `drift init`'s lock read it: the
/// file breaks no part of it that Drift read (what it could not read holds).
pub fn holds(f: &FileFacts, idx: &Index<'_>) -> bool {
    judge(f, idx).breaks.is_empty()
}

/// [`crate::mine::Rule::ImportsDeclared`] as `drift check` reads an accepted convention
/// ([`FileVerdict::told`]).
pub fn tell(view: &View<'_>, idx: &Index<'_>) -> Told {
    match view {
        View::File(f) => judge(f, idx).told(),
        _ => Told::Holds,
    }
}

/// The first import of the unit that breaks the rule, with why; `None` for any other
/// unit, or one that breaks nothing.
pub fn first_break(view: &View<'_>, idx: &Index<'_>) -> Option<(String, Undeclared)> {
    let View::File(f) = view else {
        return None;
    };
    judge(f, idx).breaks.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::PackageFacts;

    fn import(module: &str, type_only: bool) -> Import {
        Import {
            module: module.into(),
            names: vec!["x".into()],
            type_only,
            load: Default::default(),
        }
    }

    fn file(path: &str, package: &str, imports: Vec<Import>) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: "ts".into(),
            package: package.into(),
            parse_ok: true,
            imports,
            ..Default::default()
        }
    }

    fn pkg(path: &str, name: &str, deps: &[&str]) -> PackageFacts {
        PackageFacts {
            path: path.into(),
            name: name.into(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            ..Default::default()
        }
    }

    fn repo(files: Vec<FileFacts>) -> RepoFacts {
        RepoFacts {
            files,
            packages: vec![
                pkg("", "root", &["lodash@4", "vitest@1"]),
                pkg("packages/ui", "@acme/ui", &["react@18"]),
                pkg(
                    "apps/web",
                    "@acme/web",
                    &["@acme/ui@workspace:*", "@types/express@4", "next@14"],
                ),
                pkg("packages/anon", "", &[]),
            ],
            ..Default::default()
        }
    }

    fn verdicts(f: FileFacts) -> FileVerdict {
        let r = repo(vec![
            f,
            file("packages/ui/src/button.tsx", "packages/ui", vec![]),
            file("packages/anon/x.ts", "packages/anon", vec![]),
            file("tools/broken/y.ts", "tools/broken", vec![]),
            file("scripts/z.ts", "", vec![]),
        ]);
        judge(&r.files[0], &Index::new(&r))
    }

    /// Pins each decision of the module docs on one file of `apps/web`.
    #[test]
    fn each_kind_of_import_is_decided_from_the_facts() {
        let f = file(
            "apps/web/a.ts",
            "apps/web",
            vec![
                import("pkg:node:fs", false),                // built-in
                import("pkg:next/navigation", false),        // a subpath of a declared one
                import("packages/ui/src/button.tsx", false), // workspace:* declared
                import("apps/web/lib/b.ts", false),          // alias in its own package
                import("pkg:@acme/web/sub", false),          // self-reference
                import("pkg:express", true),                 // type-only, @types declared
                import("packages/anon/x.ts", false),         // a package with no name
                import("scripts/z.ts", false),               // the root package
            ],
        );
        let v = verdicts(f);
        assert_eq!(v.told(), Told::Holds, "{v:?}");
        assert_eq!(v.packages, 3, "{v:?}");
    }

    /// Pins a phantom dependency: declared by the root only, it breaks, and the break
    /// names the manifest that should declare it and where it is declared instead.
    #[test]
    fn a_package_only_the_root_declares_breaks() {
        let v = verdicts(file(
            "apps/web/a.ts",
            "apps/web",
            vec![import("pkg:lodash/fp", false), import("pkg:express", false)],
        ));
        assert_eq!(v.told(), Told::Breaks);
        let (module, u) = &v.breaks[0];
        assert_eq!(module, "pkg:lodash/fp");
        assert_eq!(u.package, "lodash");
        assert_eq!(u.manifest, "apps/web/package.json");
        assert_eq!(u.declared_in, ["package.json"]);
        assert!(
            u.describe().contains(
                "(declared in package.json at the root); fix: add lodash to apps/web/package.json"
            ),
            "{}",
            u.describe()
        );
        // `express` is declared nowhere (only its types are): not checked, never a break.
        assert_eq!(v.breaks.len(), 1);
        assert!(v.not_checked[0].contains("no manifest of the repository declares express"));
    }

    /// Pins an undeclared workspace package, by path or by name: a break that names it.
    #[test]
    fn an_undeclared_workspace_package_breaks() {
        let r = repo(vec![file(
            "packages/ui/src/a.tsx",
            "packages/ui",
            vec![
                import("apps/web/lib/b.ts", false),
                import("pkg:@acme/web", false),
            ],
        )]);
        let v = judge(&r.files[0], &Index::new(&r));
        assert_eq!(v.breaks.len(), 2, "{v:?}");
        assert!(v.breaks.iter().all(|(_, u)| u.workspace == "apps/web"));
        assert!(
            v.breaks[0]
                .1
                .where_words()
                .contains("the workspace package at apps/web")
        );
    }

    /// Pins a package nested inside another (`packages/ui/auth` inside `packages/ui`):
    /// reached through a subpath of the declared one around it, or by its parent's own
    /// relative path, it holds; a package that declares neither still breaks. Before
    /// this, `@acme/ui/auth/x` from `apps/web` was a break on a real repository.
    #[test]
    fn a_package_nested_in_a_declared_one_holds() {
        let mut r = repo(vec![
            file(
                "apps/web/a.ts",
                "apps/web",
                vec![import("packages/ui/auth/x.ts", false)],
            ),
            file(
                "packages/ui/src/b.ts",
                "packages/ui",
                vec![import("packages/ui/auth/x.ts", false)],
            ),
            file(
                "tools/cli/c.ts",
                "tools/cli",
                vec![import("packages/ui/auth/x.ts", false)],
            ),
            file("packages/ui/auth/x.ts", "packages/ui/auth", vec![]),
        ]);
        r.packages
            .push(pkg("packages/ui/auth", "@acme/ui-auth", &[]));
        r.packages.push(pkg("tools/cli", "@acme/cli", &["zod@3"]));
        let idx = Index::new(&r);
        assert_eq!(judge(&r.files[0], &idx).told(), Told::Holds);
        assert_eq!(judge(&r.files[1], &idx).told(), Told::Holds);
        let v = judge(&r.files[2], &idx);
        assert_eq!(v.breaks.len(), 1, "{v:?}");
        assert_eq!(v.breaks[0].1.package, "@acme/ui-auth");
    }

    /// Pins what is not checked: an unresolved import, a manifest Drift did not read
    /// (the file's own, or the one an import lands in), and Python.
    #[test]
    fn what_drift_cannot_read_is_not_checked() {
        let v = verdicts(file(
            "apps/web/a.ts",
            "apps/web",
            vec![import("unresolved:apps/web/@/x", false)],
        ));
        assert!(matches!(v.told(), Told::CannotTell(_)), "{v:?}");
        let v = verdicts(file(
            "apps/web/a.ts",
            "apps/web",
            vec![import("tools/broken/y.ts", false)],
        ));
        assert!(matches!(v.told(), Told::CannotTell(w) if w.contains("tools/broken")));
        let v = verdicts(file("tools/broken/q.ts", "tools/broken", vec![]));
        assert!(matches!(v.told(), Told::CannotTell(w) if w.contains("tools/broken/package.json")));
        let mut py = file(
            "apps/web/a.py",
            "apps/web",
            vec![import("pkg:lodash", false)],
        );
        py.lang = "py".into();
        assert!(matches!(verdicts(py).told(), Told::CannotTell(w) if w == PYTHON_WHY));
    }

    /// Pins the `@types/` name of a scoped package.
    #[test]
    fn types_names() {
        assert_eq!(types_name("zod"), "@types/zod");
        assert_eq!(types_name("@scope/pkg"), "@types/scope__pkg");
    }
}
