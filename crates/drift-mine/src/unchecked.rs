//! Files a scan could not parse for lack of stack, and the files whose verdicts
//! depend on them.
//!
//! A file skipped with [`drift_core::SkipReason::StackUnavailable`] was not parsed
//! *this time* (an address-space limit, strict overcommit): what it holds is unknown,
//! not absent. Every reader of facts degrades on it the same way:
//!
//! - nothing is concluded about the file itself: `check` lists it as unchecked and
//!   computes no fixed lock entries for it, `init` writes nothing, the hooks say so;
//! - a verdict about another file that reads its facts is not trusted either. Such a
//!   file is a *dependent* ([`Unchecked::dependents`]), and its violations are
//!   reported as unsure: listed, never new, never blocking.
//!
//! A file depends on an unchecked one when
//!
//! - it imports it, or names something it defines (a call, wrapper, rendered
//!   component, thrown class, re-export), directly or through modules that re-export
//!   all of it (`export * from`, `from .core import *`): names resolved through such
//!   a barrel stop at the barrel when the module behind it was not parsed;
//! - one of its classes extends a class through it, at any depth (ancestry and
//!   inherited attributes are read from every base);
//! - it is a `"use client"` file that reaches it through in-repo imports (server code
//!   and secrets it reaches are found through the files between);
//! - it has entry points of an adapter that routes through other files (every adapter
//!   but Next.js's file routes), and the unchecked file is of its language: what
//!   mounts the routes, and the hooks, middleware and guards they inherit
//!   (`app.use`, `include_router`, Flask `before_request`, DRF routers, Django
//!   `MIDDLEWARE`, ...), can be in any file. This fails open (to unsure) rather
//!   than guess from the unparsed file's text.
//!
//! (A test file that is unchecked still pairs with its source by path: the scans
//! count it for `has_test`, so its source needs no special case.)

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{ExportKind, FileFacts, RepoFacts, SymbolKind, WrapKind};

use crate::mine::norm_ref;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Unchecked {
    /// Repo-relative paths skipped for lack of stack, sorted.
    pub files: BTreeSet<String>,
    /// Other files whose facts or verdicts may change once those are parsed: path ->
    /// the unchecked files it depends on.
    pub dependents: BTreeMap<String, BTreeSet<String>>,
}

fn module_of(r: &str) -> &str {
    r.split_once('#').map_or(r, |(m, _)| m)
}

fn is_python(path: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, e)| drift_core::ingest::PYTHON_EXTENSIONS.contains(&e))
}

/// Entry points whose route and inherited guards come from the file alone.
const FILE_ROUTED_ADAPTERS: &[&str] = &["nextjs"];

impl Unchecked {
    pub fn of(repo: &RepoFacts) -> Self {
        let files: BTreeSet<String> = repo
            .stack_unavailable()
            .into_iter()
            .map(str::to_string)
            .collect();
        if files.is_empty() {
            return Self::default();
        }
        // Modules whose names may resolve no further because of an unchecked file:
        // the file itself, and every module that re-exports all of one, at any depth.
        let mut reach: BTreeMap<String, BTreeSet<String>> = files
            .iter()
            .map(|f| (f.clone(), std::iter::once(f.clone()).collect()))
            .collect();
        loop {
            let mut changed = false;
            for f in &repo.files {
                let via: BTreeSet<String> = f
                    .exports
                    .iter()
                    .filter(|e| e.kind == ExportKind::ReExportAll)
                    .filter_map(|e| reach.get(module_of(&e.origin)))
                    .flatten()
                    .cloned()
                    .collect();
                if via.is_empty() {
                    continue;
                }
                let e = reach.entry(f.path.clone()).or_default();
                let before = e.len();
                e.extend(via);
                changed |= e.len() != before;
            }
            if !changed {
                break;
            }
        }
        let hit = |r: &str| reach.get(module_of(r));
        let all: Vec<&FileFacts> = repo.files.iter().chain(&repo.context_files).collect();
        let mut dependents: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut add = |path: &str, on: &BTreeSet<String>| {
            if !on.is_empty() {
                dependents
                    .entry(path.to_string())
                    .or_default()
                    .extend(on.iter().cloned());
            }
        };

        // Classes whose ancestry runs through an unchecked file, at any depth.
        let mut incomplete: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        loop {
            let mut changed = false;
            for f in &all {
                for s in f.symbols.iter().filter(|s| s.kind == SymbolKind::Class) {
                    let via: BTreeSet<String> = s
                        .wraps
                        .iter()
                        .filter(|w| w.kind == WrapKind::Extends)
                        .flat_map(|w| {
                            hit(&w.wrapper)
                                .into_iter()
                                .chain(incomplete.get(norm_ref(&w.wrapper).as_ref()))
                                .flatten()
                                .cloned()
                                .collect::<Vec<_>>()
                        })
                        .collect();
                    if via.is_empty() {
                        continue;
                    }
                    for n in std::iter::once(&s.name).chain(&s.exported_as) {
                        let e = incomplete.entry(format!("{}#{n}", f.path)).or_default();
                        let before = e.len();
                        e.extend(via.iter().cloned());
                        changed |= e.len() != before;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        for (class, on) in &incomplete {
            add(module_of(class), on);
        }

        for f in &repo.files {
            let refs = f
                .imports
                .iter()
                .map(|i| i.module.as_str())
                .chain(f.exports.iter().map(|e| e.origin.as_str()))
                .chain(f.symbols.iter().flat_map(|s| {
                    s.wraps
                        .iter()
                        .map(|w| w.wrapper.as_str())
                        .chain(s.calls.iter().map(String::as_str))
                        .chain(s.renders.iter().map(String::as_str))
                        .chain(s.throws.iter().map(String::as_str))
                }));
            let direct: BTreeSet<String> = refs.filter_map(hit).flatten().cloned().collect();
            add(&f.path, &direct);
            let routed = f
                .entry_points
                .iter()
                .any(|e| !FILE_ROUTED_ADAPTERS.contains(&e.adapter.as_str()));
            if routed {
                let mounts: BTreeSet<String> = files
                    .iter()
                    .filter(|u| is_python(u) == is_python(&f.path))
                    .map(|u| u.to_string())
                    .collect();
                add(&f.path, &mounts);
            }
        }

        // `"use client"` files reaching one through in-repo imports.
        let imports: BTreeMap<&str, Vec<&str>> = repo
            .files
            .iter()
            .map(|f| {
                (
                    f.path.as_str(),
                    f.imports.iter().map(|i| i.module.as_str()).collect(),
                )
            })
            .collect();
        for f in repo
            .files
            .iter()
            .filter(|f| f.directives.iter().any(|d| d == "use client"))
        {
            let mut seen: BTreeSet<&str> = BTreeSet::new();
            let mut stack = vec![f.path.as_str()];
            let mut reached: BTreeSet<String> = BTreeSet::new();
            while let Some(p) = stack.pop() {
                for m in imports.get(p).into_iter().flatten() {
                    if let Some(u) = files.get(*m) {
                        reached.insert(u.clone());
                    } else if seen.insert(m) {
                        stack.push(m);
                    }
                }
            }
            add(&f.path, &reached);
        }
        dependents.retain(|p, _| !files.contains(p));
        Self { files, dependents }
    }

    /// No file was skipped for lack of stack.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// What is concluded about `path` may be wrong: it is unchecked, or depends on an
    /// unchecked file.
    pub fn uncertain(&self, path: &str) -> bool {
        self.files.contains(path) || self.dependents.contains_key(path)
    }

    /// The first unchecked file `path` depends on, if it is a dependent.
    pub fn depends_on(&self, path: &str) -> Option<&str> {
        self.dependents
            .get(path)
            .and_then(|s| s.first())
            .map(String::as_str)
    }

    /// One line for people: how many files were not parsed, and why.
    pub fn note(&self) -> Option<String> {
        if self.files.is_empty() {
            return None;
        }
        Some(format!(
            "{} file(s) not checked: no thread stack large enough to parse them could be reserved (an address-space or memory limit on this run); what they hold is unknown, not absent. A run with more memory checks them.",
            self.files.len()
        ))
    }
}

#[cfg(test)]
mod tests {
    use drift_core::{EntryPoint, Import, Skipped, Symbol, Wrap};

    use super::*;

    fn file(path: &str) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: if is_python(path) { "py" } else { "ts" }.into(),
            parse_ok: true,
            ..FileFacts::default()
        }
    }

    fn class(name: &str, base: &str) -> Symbol {
        Symbol {
            name: name.into(),
            kind: SymbolKind::Class,
            line: 1,
            wraps: vec![Wrap {
                wrapper: base.into(),
                kind: WrapKind::Extends,
            }],
            ..Symbol::default()
        }
    }

    fn import(module: &str) -> Import {
        Import {
            module: module.into(),
            names: vec!["x".into()],
            type_only: false,
            load: Default::default(),
        }
    }

    #[test]
    fn dependents_are_what_reads_an_unchecked_file() {
        let mut importer = file("a/imports.ts");
        importer.imports.push(import("lib/big.ts"));
        let mut caller = file("a/calls.ts");
        caller.symbols.push(Symbol {
            name: "f".into(),
            calls: vec!["lib/big.ts#helper".into()],
            ..Symbol::default()
        });
        // `Mid` extends a class of the unchecked file; `Leaf` extends `Mid`.
        let mut mid = file("a/mid.py");
        mid.symbols.push(class("Mid", "lib/big.py#Base"));
        let mut leaf = file("a/leaf.py");
        leaf.symbols.push(class("Leaf", "a/mid.py#Mid"));
        let mut client = file("a/client.tsx");
        client.directives.push("use client".into());
        client.imports.push(import("a/imports.ts"));
        let mut route = file("a/routes.py");
        route.entry_points.push(EntryPoint {
            symbol: "index".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/".into()),
            adapter: "fastapi".into(),
        });
        let mut page = file("app/page.tsx");
        page.entry_points.push(EntryPoint {
            symbol: "default".into(),
            kind: "page".into(),
            method: None,
            route: Some("/".into()),
            adapter: "nextjs".into(),
        });
        let mut other = file("a/other.ts");
        other.imports.push(import("pkg:zod"));
        // `a/barrel.ts` re-exports all of the unchecked file, `a/outer.ts` all of the
        // barrel; `a/user.ts` names something through the outer barrel only.
        let mut barrel = file("a/barrel.ts");
        barrel.exports.push(drift_core::Export {
            name: "*".into(),
            origin: "lib/big.ts#*".into(),
            kind: ExportKind::ReExportAll,
        });
        let mut outer = file("a/outer.ts");
        outer.exports.push(drift_core::Export {
            name: "*".into(),
            origin: "a/barrel.ts#*".into(),
            kind: ExportKind::ReExportAll,
        });
        let mut user = file("a/user.ts");
        user.symbols.push(Symbol {
            name: "g".into(),
            wraps: vec![Wrap {
                wrapper: "a/outer.ts#withAuth".into(),
                kind: WrapKind::Call,
            }],
            ..Symbol::default()
        });
        let repo = RepoFacts {
            files: vec![
                importer, caller, mid, leaf, client, route, page, other, barrel, outer, user,
            ],
            skipped: vec![
                Skipped {
                    path: "lib/big.ts".into(),
                    reason: drift_core::SkipReason::StackUnavailable,
                },
                Skipped {
                    path: "lib/big.py".into(),
                    reason: drift_core::SkipReason::StackUnavailable,
                },
                Skipped {
                    path: "gen.ts".into(),
                    reason: drift_core::SkipReason::Generated,
                },
            ],
            ..RepoFacts::default()
        };
        let deps = |u: &Unchecked| -> Vec<(String, String)> {
            u.dependents
                .iter()
                .map(|(p, on)| (p.clone(), on.iter().cloned().collect::<Vec<_>>().join(",")))
                .collect()
        };
        let pairs = |v: &[(&str, &str)]| -> Vec<(String, String)> {
            v.iter()
                .map(|(a, b)| (a.to_string(), b.to_string()))
                .collect()
        };
        let u = Unchecked::of(&repo);
        assert_eq!(
            u.files.iter().map(String::as_str).collect::<Vec<_>>(),
            ["lib/big.py", "lib/big.ts"]
        );
        // `a/routes.py` routes through other files: any Python file could mount it or
        // set its guards. Next.js file routes do not.
        assert_eq!(
            deps(&u),
            pairs(&[
                ("a/barrel.ts", "lib/big.ts"),
                ("a/calls.ts", "lib/big.ts"),
                ("a/client.tsx", "lib/big.ts"),
                ("a/imports.ts", "lib/big.ts"),
                ("a/leaf.py", "lib/big.py"),
                ("a/mid.py", "lib/big.py"),
                ("a/outer.ts", "lib/big.ts"),
                ("a/routes.py", "lib/big.py"),
                ("a/user.ts", "lib/big.ts"),
            ])
        );
        assert!(u.uncertain("lib/big.ts") && u.uncertain("a/leaf.py"));
        assert!(!u.uncertain("a/other.ts") && !u.uncertain("app/page.tsx"));
        assert!(u.note().unwrap().starts_with("2 file(s) not checked"));
    }

    #[test]
    fn no_stack_skip_means_nothing_is_uncertain() {
        let mut f = file("a.ts");
        f.imports.push(import("gen.ts"));
        let repo = RepoFacts {
            files: vec![f],
            skipped: vec![Skipped {
                path: "gen.ts".into(),
                reason: drift_core::SkipReason::Generated,
            }],
            ..RepoFacts::default()
        };
        let u = Unchecked::of(&repo);
        assert!(u.is_empty() && u.dependents.is_empty() && u.note().is_none());
    }
}
