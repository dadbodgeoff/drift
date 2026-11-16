//! The restrictions a linter configuration declares that the scan lists apart from
//! what mining reads ([`drift_core::LintConfig::declared`]), for [`crate::declared`]:
//! each with the file and line that declare it.
//!
//! - A JavaScript import restriction read whole is taken by [`crate::declared`] as a
//!   JSON `overrides` entry is; one the scan could not read whole (it leaves files
//!   out, a later part may change it, it is handed to a call) is listed here as not
//!   expressed, with why, and never proposed.
//! - A Python restriction names modules, dotted (`app.db`): each is placed in the
//!   repository by the Python files the scan found, under the configuration's folder
//!   (`app/db/` below it, once), and only a folder that is one layer as Drift counts
//!   layers can be the target of the layering rule. A module that is one file, a name
//!   inside a module, one that matches two folders and one outside the repository are
//!   listed with why. An import-linter contract's source modules are placed the same
//!   way, as the folder whose files the rule is for.
//!
//! Nothing here is read by mining.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use drift_core::{DECLARED_IMPORTS, DECLARED_MODULES, DECLARED_RELATIVE, FileFacts, RepoFacts};

use crate::declared::{Entry, NotKey, Target, area_target, safe};

/// What [`listed`] gives [`crate::declared`].
pub(crate) struct Listed<'r> {
    /// Python restrictions to check, each for one folder.
    pub(crate) entries: Vec<Entry<'r>>,
    /// What cannot be expressed, with the options as written.
    pub(crate) not: BTreeMap<NotKey, BTreeSet<String>>,
}

/// The listed restrictions of every configuration of `repo` at `warn` or `error`.
pub(crate) fn listed(repo: &RepoFacts) -> Listed<'_> {
    let mut out = Listed {
        entries: Vec::new(),
        not: BTreeMap::new(),
    };
    let py: Vec<&FileFacts> = repo.files.iter().filter(|f| f.lang == "py").collect();
    for c in &repo.lint {
        for d in c
            .declared
            .iter()
            .filter(|d| matches!(d.level.as_str(), "warn" | "error"))
        {
            let at = format!("{}:{}", c.path, d.line);
            if let Some(limit) = d.limits.first() {
                let (why, words) = limit_words(limit);
                out.not
                    .entry((at, d.dir.clone(), why, words.to_string()))
                    .or_default()
                    .extend(d.options.iter().cloned());
                continue;
            }
            match d.rule.as_str() {
                // [`crate::declared`]'s `entries` takes these.
                DECLARED_IMPORTS => {}
                DECLARED_RELATIVE => {
                    let words = "it bans relative imports, and Drift has no rule kind for how an import is written";
                    out.not
                        .entry((at, d.dir.clone(), "relative", words.to_string()))
                        .or_default()
                        .extend(d.options.iter().cloned());
                }
                DECLARED_MODULES if d.sources.is_empty() => out.entries.push(Entry {
                    config: &c.path,
                    level: &d.level,
                    dir: d.dir.as_str().into(),
                    options: &d.options,
                    at: Some(at),
                    python: true,
                }),
                DECLARED_MODULES => {
                    for src in &d.sources {
                        match place(&py, base_of(&c.path), src) {
                            Ok(folder) => out.entries.push(Entry {
                                config: &c.path,
                                level: &d.level,
                                dir: Cow::Owned(folder),
                                options: &d.options,
                                at: Some(at.clone()),
                                python: true,
                            }),
                            Err((why, words)) => {
                                out.not
                                    .entry((at.clone(), d.dir.clone(), why, words))
                                    .or_default()
                                    .insert(src.clone());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// What a Python module `option`, forbidden by the configuration at `config` for the
/// folder `dir`, names ([`crate::declared`]'s `target_of`, for Python).
pub(crate) fn target_of(
    areas: &BTreeSet<String>,
    files: &[&FileFacts],
    config: &str,
    dir: &str,
    option: &str,
) -> Target {
    let py: Vec<&FileFacts> = files.iter().copied().filter(|f| f.lang == "py").collect();
    match place(&py, base_of(config), option) {
        Ok(path) => area_target(areas, files, dir, option, path),
        Err((why, words)) => Target::Not(why, words),
    }
}

/// The folder of the configuration at `path`.
fn base_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// The words for a [`drift_core::DeclaredLint::limits`] entry.
fn limit_words(limit: &str) -> (&'static str, &'static str) {
    match limit {
        "ignores" => (
            "ignores",
            "it leaves some files or imports out, and Drift's rule covers every file of a place and every import of the layer",
        ),
        "indirect" => (
            "indirect",
            "the contract forbids indirect imports too (a chain through other modules), and Drift's layering rule checks direct imports only",
        ),
        "overridden" => (
            "overridden",
            "a later setting of the same configuration changes it for part of the folder or for files Drift cannot place, so it does not say one thing for the whole folder",
        ),
        "unread_after" => (
            "unread_after",
            "a later part of the configuration was not read (a file it imports, a plugin's preset, a call that builds settings) and may change it",
        ),
        "computed" => (
            "computed",
            "it is handed to a call Drift does not know to keep it as written",
        ),
        _ => ("unread", "Drift could not read it whole"),
    }
}

/// The repository folder of the Python module `dotted` (`app.db` -> `backend/app/db`),
/// found by the Python files below `base` (the configuration's folder), or, where none
/// is, anywhere: the one folder `<root>/app/db/` whose files are there. Why not,
/// otherwise.
fn place(py: &[&FileFacts], base: &str, dotted: &str) -> Result<String, (&'static str, String)> {
    let valid = !dotted.is_empty()
        && dotted
            .split('.')
            .all(|s| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_'));
    if !valid {
        return Err((
            "pattern",
            format!(
                "`{}` is not one module name, and Drift's layering rule names one layer",
                safe(dotted)
            ),
        ));
    }
    // Below the configuration's folder first, then anywhere in the repository (a
    // `ruff.toml` in `core/` names modules from the source root).
    let (mut folders, mut modules) = matches(py, base, dotted);
    if folders.is_empty() && modules.is_empty() && !base.is_empty() {
        (folders, modules) = matches(py, "", dotted);
    }
    if folders.len() == 1 {
        return Ok(folders.into_iter().next().unwrap_or_default());
    }
    if folders.len() > 1 {
        let named: Vec<String> = folders.iter().take(3).map(|f| safe(f)).collect();
        return Err((
            "ambiguous",
            format!(
                "`{}` matches more than one folder of this repository (`{}`), so Drift cannot tell which it names",
                safe(dotted),
                named.join("`, `")
            ),
        ));
    }
    if let Some(m) = modules.first() {
        return Err((
            "not_a_layer",
            format!(
                "`{}` is the module `{}`, one file, and Drift's layering rule names whole layers",
                safe(dotted),
                safe(m)
            ),
        ));
    }
    // A name inside a module of the repository (`app.utils.helper`).
    let mut prefix = dotted;
    while let Some((head, _)) = prefix.rsplit_once('.') {
        let (f, m) = matches(py, "", head);
        if !f.is_empty() || !m.is_empty() {
            return Err((
                "partial",
                format!(
                    "it bans a name inside `{}`, and Drift's rule is about whole layers",
                    safe(head)
                ),
            ));
        }
        prefix = head;
    }
    Err((
        "package",
        format!(
            "`{}` names a module outside this repository, and Drift's layering rule is about this repository's own code",
            safe(dotted)
        ),
    ))
}

/// The folders (`<root>/a/b`) and the module files (`<root>/a/b.py`) the module `a.b`
/// can be, below `base`, sorted.
fn matches(py: &[&FileFacts], base: &str, dotted: &str) -> (Vec<String>, Vec<String>) {
    let rel = dotted.replace('.', "/");
    let dir_tail = format!("{rel}/");
    let file_tail = format!("{rel}.py");
    let mut folders = BTreeSet::new();
    let mut modules = BTreeSet::new();
    for f in py {
        let p = f.path.as_str();
        let below = if base.is_empty() {
            Some(p)
        } else {
            p.strip_prefix(base).and_then(|r| r.strip_prefix('/'))
        };
        let Some(rest) = below else { continue };
        let start = p.len() - rest.len();
        // Each segment boundary of `rest` where the module's path can start.
        let mut at = 0usize;
        loop {
            let tail = &rest[at..];
            if tail.starts_with(&dir_tail) {
                folders.insert(p[..start + at + rel.len()].to_string());
            } else if tail == file_tail {
                modules.insert(p[..start + at + file_tail.len()].to_string());
            }
            match tail.find('/') {
                Some(i) => at += i + 1,
                None => break,
            }
        }
    }
    (folders.into_iter().collect(), modules.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn py(path: &str) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: "py".into(),
            ..Default::default()
        }
    }

    /// Pins how a dotted module is placed: one folder below the configuration's
    /// folder, or why not (a file, two folders, a name inside a module, outside).
    #[test]
    fn python_modules_are_placed_by_the_files() {
        let files = [
            py("backend/app/db/session.py"),
            py("backend/app/api/routes.py"),
            py("backend/app/utils.py"),
            py("tools/app/db/x.py"),
        ];
        let f: Vec<&FileFacts> = files.iter().collect();
        assert_eq!(place(&f, "backend", "app.db"), Ok("backend/app/db".into()));
        assert_eq!(place(&f, "", "app.db").unwrap_err().0, "ambiguous");
        assert_eq!(
            place(&f, "backend/app/api", "app.db"),
            Err(("ambiguous", place(&f, "", "app.db").unwrap_err().1))
        );
        assert_eq!(
            place(&f, "backend", "app.utils").unwrap_err().0,
            "not_a_layer"
        );
        assert_eq!(
            place(&f, "backend", "app.utils.helper").unwrap_err().0,
            "partial"
        );
        assert_eq!(place(&f, "backend", "requests").unwrap_err().0, "package");
        assert_eq!(place(&f, "backend", "app.*").unwrap_err().0, "pattern");
    }
}
