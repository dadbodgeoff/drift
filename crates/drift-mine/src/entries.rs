//! The symbol that handles an entry point, through re-exports (PLAN-R13 §2.5).
//!
//! A route file may declare its handler (`export async function GET`) or re-export one
//! declared elsewhere (`export { GET } from "@/lib/handlers"`, Auth.js's
//! `export const { GET, POST } = handlers`). [`entry_symbol`] finds the local symbol
//! first, as the security inventory does, and otherwise follows the file's
//! [`ExportKind::ReExport`] of that name to its origin, at most [`MAX_REEXPORT_HOPS`]
//! hops. Mining and roles are unchanged: this is read by the practice map.

use drift_core::{EntryPoint, ExportKind, FileFacts, RepoFacts, Symbol};

/// Re-export hops followed at most (as `drift-ts/src/repo.rs`).
pub const MAX_REEXPORT_HOPS: usize = 16;

/// The symbol of `file` named or exported as `name`.
fn local<'a>(file: &'a FileFacts, name: &str) -> Option<&'a Symbol> {
    file.symbols
        .iter()
        .find(|s| s.exported_as.iter().any(|e| e == name) || s.name == name)
}

/// The file and symbol that handle `entry` of `file`: a symbol of the file itself, or
/// the origin of a re-export of that name. `None` when neither is in the facts (a
/// re-export of a package, a file not scanned, a cycle).
pub fn entry_symbol<'a>(
    repo: &'a RepoFacts,
    file: &'a FileFacts,
    entry: &EntryPoint,
) -> Option<(&'a FileFacts, &'a Symbol)> {
    if let Some(s) = local(file, &entry.symbol) {
        return Some((file, s));
    }
    let mut at = file;
    let mut name = entry.symbol.clone();
    for _ in 0..MAX_REEXPORT_HOPS {
        let x = at
            .exports
            .iter()
            .find(|x| x.name == name && x.kind == ExportKind::ReExport)?;
        let (path, sym) = x.origin.split_once('#')?;
        let next = repo.files.iter().find(|f| f.path == path)?;
        // `derives_from` of a destructured export (`export const { GET } = handlers`
        // records `GET` deriving from `handlers.GET`) is read by the classifiers.
        if let Some(s) = local(next, sym) {
            return Some((next, s));
        }
        if std::ptr::eq(next, at) && sym == name {
            return None;
        }
        at = next;
        name = sym.to_string();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::Export;

    fn file(path: &str, symbols: &[&str], exports: &[(&str, &str, ExportKind)]) -> FileFacts {
        FileFacts {
            path: path.into(),
            symbols: symbols
                .iter()
                .map(|n| Symbol {
                    name: n.to_string(),
                    ..Symbol::default()
                })
                .collect(),
            exports: exports
                .iter()
                .map(|(n, o, k)| Export {
                    name: n.to_string(),
                    origin: o.to_string(),
                    kind: *k,
                })
                .collect(),
            ..FileFacts::default()
        }
    }

    fn entry(symbol: &str) -> EntryPoint {
        EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/api/x".into()),
            adapter: "nextjs".into(),
        }
    }

    #[test]
    fn follows_reexports_to_the_origin() {
        let repo = RepoFacts {
            files: vec![
                file(
                    "app/api/x/route.ts",
                    &[],
                    &[("GET", "lib/mid.ts#GET", ExportKind::ReExport)],
                ),
                file(
                    "lib/mid.ts",
                    &[],
                    &[("GET", "lib/handlers.ts#legacyGet", ExportKind::ReExport)],
                ),
                file("lib/handlers.ts", &["legacyGet"], &[]),
            ],
            ..RepoFacts::default()
        };
        let (f, s) = entry_symbol(&repo, &repo.files[0], &entry("GET")).unwrap();
        assert_eq!(
            (f.path.as_str(), s.name.as_str()),
            ("lib/handlers.ts", "legacyGet")
        );
        // A local symbol wins.
        let local_repo = RepoFacts {
            files: vec![file("a.ts", &["GET"], &[])],
            ..RepoFacts::default()
        };
        let (f, _) = entry_symbol(&local_repo, &local_repo.files[0], &entry("GET")).unwrap();
        assert_eq!(f.path, "a.ts");
    }

    #[test]
    fn package_reexports_and_cycles_find_nothing() {
        let repo = RepoFacts {
            files: vec![
                file(
                    "a.ts",
                    &[],
                    &[
                        ("GET", "pkg:next-auth#handlers.GET", ExportKind::ReExport),
                        ("POST", "b.ts#POST", ExportKind::ReExport),
                    ],
                ),
                file("b.ts", &[], &[("POST", "a.ts#POST", ExportKind::ReExport)]),
            ],
            ..RepoFacts::default()
        };
        assert!(entry_symbol(&repo, &repo.files[0], &entry("GET")).is_none());
        assert!(entry_symbol(&repo, &repo.files[0], &entry("POST")).is_none());
    }
}
