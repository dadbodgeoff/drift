//! Helpers defined more than once (hygiene, not a concern of the map): a top-level
//! function of one name defined in two or more production files, whose copies call the
//! same things. The facts hold no body text, so "the same helper" is read from what
//! they do hold, conservatively:
//!
//! - the same name, a plain function at the top level of its file (no method, no
//!   component), in a file that is neither a test nor demonstration code (generated
//!   files are never scanned);
//! - not the file's entry point, not a name a framework chose (`main`, `handler`,
//!   `GET`, `upgrade`, `__init__`, ...), and referenced somewhere in the repository:
//!   a function nothing in the repository calls or wraps with is one a framework
//!   finds by name, where the same name in every file is the interface;
//! - the same shape: what the copies all call is at least two thirds of what the
//!   largest of them calls, and holds at least [`MIN_SHARED`] callees that say
//!   something ([`evidence`]): not a builtin or a global (`str`, `isinstance`,
//!   `fetch`), and a chain counted once (`sha256(..).hexdigest()` is one callee, so a
//!   one-line wrapper is no evidence). A callee in the copy's own file counts by its
//!   name (`_headers()` in each file is one callee), any other by where it is defined.
//!
//! Two functions that only share a name, or one callee, are not said to be copies.
//! The reading is linear in the repository: one pass over the symbols, one over their
//! calls, and a grouping per name bounded by [`MAX_DEFINITIONS`].

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind};
use serde::Serialize;

use crate::roles::{NonProduction, is_test_path};

/// Callees that say something ([`evidence`]) every copy shares at least: one shared
/// callee is a coincidence (two `get`s that both call the same client).
pub const MIN_SHARED: usize = 2;
/// Definitions of one name read at most, first by path and line: a name defined in
/// more files than this is an interface, and the grouping stays bounded.
pub const MAX_DEFINITIONS: usize = 64;

/// Names a framework or a runtime chose: the same name in many files is the interface,
/// not a copy.
const ENTRY_NAMES: &[&str] = &[
    "main",
    "handler",
    "lambda_handler",
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "default",
    "middleware",
    "setup",
    "teardown",
    "lifespan",
    "upgrade",
    "downgrade",
    "create_app",
    "loader",
    "action",
    "getServerSideProps",
    "getStaticProps",
    "getStaticPaths",
    "generateMetadata",
    "generateStaticParams",
];

/// One definition of a helper.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct HelperCopy {
    pub path: String,
    pub line: u32,
    /// The package of the file (`""` for the root package).
    pub package: String,
}

/// A helper defined more than once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DuplicateHelper {
    /// The function's name, the same in every copy.
    pub name: String,
    /// Every copy, by path and line: two or more, in two or more files.
    pub copies: Vec<HelperCopy>,
    /// How many callees every copy calls: the evidence that they are one helper.
    pub shared_calls: usize,
}

impl DuplicateHelper {
    /// Copies times shared callees: what the list is ranked by.
    pub fn score(&self) -> usize {
        self.copies.len() * self.shared_calls
    }
}

/// A function of one file that is also defined elsewhere ([`duplicates_in`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileDuplicate {
    pub name: String,
    /// Where the file defines it.
    pub line: u32,
    /// How many callees this definition and the others all call.
    pub shared_calls: usize,
    /// The other copies, by path and line.
    pub others: Vec<HelperCopy>,
}

/// Every helper of the repository defined more than once: by copies times shared
/// callees, then name, then first copy. A name whose definitions fall into two shapes
/// is two helpers.
pub fn duplicate_helpers(facts: &RepoFacts) -> Vec<DuplicateHelper> {
    helpers(facts, None)
}

/// The functions `path` defines that are also defined elsewhere, with the other
/// copies: by line. Empty for a file the facts do not hold, a test, or a file with no
/// such function. Reads the repository once (the names `path` defines only).
pub fn duplicates_in(facts: &RepoFacts, path: &str) -> Vec<FileDuplicate> {
    let path = path.trim_start_matches("./");
    let Some(file) = facts.files.iter().find(|f| f.path == path) else {
        return Vec::new();
    };
    let names: BTreeSet<&str> = file
        .symbols
        .iter()
        .filter(|s| candidate(file, s))
        .map(|s| s.name.as_str())
        .collect();
    if names.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<FileDuplicate> = helpers(facts, Some(&names))
        .into_iter()
        .filter_map(|h| {
            let own = h.copies.iter().find(|c| c.path == path)?.line;
            Some(FileDuplicate {
                name: h.name,
                line: own,
                shared_calls: h.shared_calls,
                others: h.copies.into_iter().filter(|c| c.path != path).collect(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.line.cmp(&b.line).then(a.name.cmp(&b.name)));
    out
}

/// A plain top-level function no framework names.
fn candidate(file: &FileFacts, s: &Symbol) -> bool {
    s.kind == SymbolKind::Function
        && !s.name.contains('.')
        && !(s.name.starts_with("__") && s.name.ends_with("__"))
        && !ENTRY_NAMES.contains(&s.name.as_str())
        && !file.entry_points.iter().any(|e| e.symbol == s.name)
        && !crate::mine::framework_reserved_name(file, s)
}

/// A reference without what it is used as (`path#f(ref)`, `path#C(new)`).
fn bare(reference: &str) -> &str {
    reference
        .trim_end_matches("(ref)")
        .trim_end_matches("(new)")
}

/// What a definition calls, with a callee of its own file by name only.
fn shape<'a>(file: &'a FileFacts, s: &'a Symbol) -> BTreeSet<(bool, &'a str)> {
    s.calls
        .iter()
        .map(|c| {
            let c = bare(c);
            match c.split_once('#') {
                Some((p, n)) if p == file.path => (true, n),
                _ => (false, c),
            }
        })
        .collect()
}

/// How many of the callees say what the function is: those of the repository or of a
/// package (not a builtin or a global), a chain of calls counted once.
fn evidence(shape: &BTreeSet<(bool, &str)>) -> usize {
    shape
        .iter()
        .filter(|(_, c)| !c.starts_with("global#"))
        .map(|(own, c)| (*own, c.split_once('(').map_or(*c, |(root, _)| root)))
        .collect::<BTreeSet<_>>()
        .len()
}

struct Cluster<'a> {
    /// What every member calls.
    common: BTreeSet<(bool, &'a str)>,
    /// The largest member's callees.
    largest: usize,
    members: Vec<usize>,
}

fn helpers(facts: &RepoFacts, only: Option<&BTreeSet<&str>>) -> Vec<DuplicateHelper> {
    let non_production = NonProduction::learn(facts);
    // One definition per file and name: of an overload's signatures and its
    // implementation, the one that calls the most.
    let mut by_name: BTreeMap<&str, BTreeMap<&str, (&FileFacts, &Symbol)>> = BTreeMap::new();
    for f in &facts.files {
        if is_test_path(&f.path) || non_production.contains(&f.path, &f.package) {
            continue;
        }
        for s in &f.symbols {
            if only.is_some_and(|o| !o.contains(s.name.as_str())) || !candidate(f, s) {
                continue;
            }
            let slot = by_name
                .entry(s.name.as_str())
                .or_default()
                .entry(f.path.as_str())
                .or_insert((f, s));
            if s.calls.len() > slot.1.calls.len() {
                *slot = (f, s);
            }
        }
    }
    by_name.retain(|_, defs| defs.len() >= 2);
    if by_name.is_empty() {
        return Vec::new();
    }
    // What the repository calls, wraps with or hands on, of those names.
    let mut referenced: BTreeSet<(&str, &str)> = BTreeSet::new();
    let mut note = |reference: &'_ str| {
        if let Some((p, n)) = bare(reference).split_once('#')
            && let Some((name, defs)) = by_name.get_key_value(n)
            && let Some((path, _)) = defs.get_key_value(p)
        {
            referenced.insert((*path, *name));
        }
    };
    for f in &facts.files {
        for s in &f.symbols {
            s.calls.iter().for_each(|c| note(c));
            s.wraps.iter().for_each(|w| note(&w.wrapper));
            for m in &s.members {
                m.calls.iter().for_each(|c| note(c));
            }
        }
    }
    let mut out: Vec<DuplicateHelper> = Vec::new();
    for (name, defs) in &by_name {
        // By path (the map's order), the referenced ones only.
        let defs: Vec<(&FileFacts, &Symbol)> = defs
            .iter()
            .filter(|(path, _)| referenced.contains(&(**path, *name)))
            .map(|(_, d)| *d)
            .take(MAX_DEFINITIONS)
            .collect();
        if defs.len() < 2 {
            continue;
        }
        let shapes: Vec<BTreeSet<(bool, &str)>> = defs.iter().map(|(f, s)| shape(f, s)).collect();
        let mut clusters: Vec<Cluster> = Vec::new();
        for (i, sh) in shapes.iter().enumerate() {
            if evidence(sh) < MIN_SHARED {
                continue;
            }
            let joined = clusters.iter_mut().find_map(|c| {
                let common: BTreeSet<(bool, &str)> = c.common.intersection(sh).copied().collect();
                let largest = c.largest.max(sh.len());
                (evidence(&common) >= MIN_SHARED && 3 * common.len() >= 2 * largest).then(|| {
                    c.common = common;
                    c.largest = largest;
                    c.members.push(i);
                })
            });
            if joined.is_none() {
                clusters.push(Cluster {
                    common: sh.clone(),
                    largest: sh.len(),
                    members: vec![i],
                });
            }
        }
        for c in clusters {
            if c.members.len() < 2 {
                continue;
            }
            let mut copies: Vec<HelperCopy> = c
                .members
                .iter()
                .map(|&i| HelperCopy {
                    path: defs[i].0.path.clone(),
                    line: defs[i].1.line,
                    package: defs[i].0.package.clone(),
                })
                .collect();
            copies.sort();
            out.push(DuplicateHelper {
                name: name.to_string(),
                copies,
                shared_calls: c.common.len(),
            });
        }
    }
    out.sort_by(|a, b| {
        b.score()
            .cmp(&a.score())
            .then(a.name.cmp(&b.name))
            .then(a.copies.cmp(&b.copies))
    });
    out
}

/// The findings of the helpers defined more than once: the best-ranked group of each
/// name, at most [`super::caps::DUPLICATE_FINDINGS`], those with a copy in the scope.
pub(super) fn findings(
    facts: &RepoFacts,
    package: Option<&str>,
    path: Option<&str>,
) -> Vec<super::Finding> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    duplicate_helpers(facts)
        .into_iter()
        .filter(|h| {
            h.copies
                .iter()
                .any(|c| package.is_none_or(|p| c.package == p) && path.is_none_or(|p| c.path == p))
        })
        .filter(|h| seen.insert(h.name.clone()))
        .take(super::caps::DUPLICATE_FINDINGS)
        .map(|h| {
            let example = |c: &HelperCopy| super::Example {
                path: c.path.clone(),
                symbol: h.name.clone(),
                line: c.line,
            };
            let one_package = h.copies.iter().all(|c| c.package == h.copies[0].package);
            super::Finding {
                kind: super::FindingKind::DuplicateHelper,
                concern: HYGIENE.to_string(),
                package: one_package.then(|| h.copies[0].package.clone()),
                members: h.copies.len(),
                examples: h
                    .copies
                    .iter()
                    .take(super::caps::EXAMPLES)
                    .map(example)
                    .collect(),
                key: Some(h.name.clone()),
                copies: h
                    .copies
                    .iter()
                    .take(super::caps::COPIES)
                    .map(example)
                    .collect(),
                shared_calls: Some(h.shared_calls),
                ..super::Finding::default()
            }
        })
        .collect()
}

/// The `concern` of a duplicate-helper finding: the area the map's "not covered yet"
/// names, which is no concern of the map.
pub const HYGIENE: &str = "hygiene";

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{EntryPoint, FACTS_SCHEMA_VERSION, Wrap, WrapKind};

    fn func(name: &str, line: u32, calls: &[&str]) -> Symbol {
        Symbol {
            name: name.into(),
            kind: SymbolKind::Function,
            line,
            calls: calls.iter().map(|c| c.to_string()).collect(),
            ..Symbol::default()
        }
    }

    fn file(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: if path.ends_with(".py") { "py" } else { "ts" }.into(),
            package: package.into(),
            parse_ok: true,
            symbols,
            ..FileFacts::default()
        }
    }

    fn repo(files: Vec<FileFacts>) -> RepoFacts {
        RepoFacts {
            schema_version: FACTS_SCHEMA_VERSION,
            files,
            ..RepoFacts::default()
        }
    }

    /// A caller of `name` in each of `paths`, so the copies are referenced.
    fn callers(name: &str, paths: &[&str]) -> FileFacts {
        let calls: Vec<String> = paths.iter().map(|p| format!("{p}#{name}")).collect();
        let calls: Vec<&str> = calls.iter().map(String::as_str).collect();
        file(
            &format!("svc/use_{name}.py"),
            "svc",
            vec![func(&format!("use_{name}"), 1, &calls)],
        )
    }

    const FETCH: &[&str] = &[
        "pkg:httpx#AsyncClient",
        "pkg:python:json#loads",
        "global#str",
    ];

    fn summary(h: &[DuplicateHelper]) -> Vec<(String, Vec<String>, usize)> {
        h.iter()
            .map(|h| {
                (
                    h.name.clone(),
                    h.copies
                        .iter()
                        .map(|c| format!("{}:{}", c.path, c.line))
                        .collect(),
                    h.shared_calls,
                )
            })
            .collect()
    }

    #[test]
    fn a_function_defined_in_two_files_with_the_same_calls_is_one_helper_twice() {
        let r = repo(vec![
            file("a/util.py", "a", vec![func("fetch_json", 4, FETCH)]),
            file("b/util.py", "b", vec![func("fetch_json", 9, FETCH)]),
            callers("fetch_json", &["a/util.py", "b/util.py"]),
        ]);
        assert_eq!(
            summary(&duplicate_helpers(&r)),
            [(
                "fetch_json".to_string(),
                vec!["a/util.py:4".to_string(), "b/util.py:9".to_string()],
                3
            )]
        );
        // For one file: the other copy, with its package.
        let own = duplicates_in(&r, "./b/util.py");
        assert_eq!(own.len(), 1);
        assert_eq!((own[0].name.as_str(), own[0].line), ("fetch_json", 9));
        assert_eq!(own[0].shared_calls, 3);
        assert_eq!(
            own[0].others,
            [HelperCopy {
                path: "a/util.py".into(),
                line: 4,
                package: "a".into()
            }]
        );
        assert_eq!(duplicates_in(&r, "svc/use_fetch_json.py"), []);
        assert_eq!(duplicates_in(&r, "no/such.py"), []);
    }

    /// A callee in the copy's own file counts by name: each file's `_headers` is one
    /// callee, though it is defined in two places.
    #[test]
    fn a_callee_of_the_copys_own_file_counts_by_its_name() {
        let r = repo(vec![
            file(
                "a/client.py",
                "a",
                vec![
                    func("_headers", 1, &[]),
                    func("call", 5, &["a/client.py#_headers", "pkg:httpx#post"]),
                ],
            ),
            file(
                "b/client.py",
                "b",
                vec![
                    func("_headers", 1, &[]),
                    func("call", 7, &["b/client.py#_headers", "pkg:httpx#post"]),
                ],
            ),
            callers("call", &["a/client.py", "b/client.py"]),
        ]);
        // `_headers` itself calls nothing: no evidence it is one helper.
        assert_eq!(
            summary(&duplicate_helpers(&r)),
            [(
                "call".to_string(),
                vec!["a/client.py:5".to_string(), "b/client.py:7".to_string()],
                2
            )]
        );
    }

    #[test]
    fn a_shared_name_is_not_a_copy() {
        let ep = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/items".into()),
            adapter: "fastapi".into(),
        };
        // Under one name: different things; one shared callee that says something and a
        // shared builtin; and three shared callees of five (under two thirds).
        let mut files = vec![
            file("a/x.py", "a", vec![func("load", 1, FETCH)]),
            file(
                "b/x.py",
                "b",
                vec![func(
                    "load",
                    1,
                    &[
                        "pkg:sqlalchemy#select",
                        "pkg:sqlalchemy#orm.Session.execute",
                    ],
                )],
            ),
            file(
                "c/x.py",
                "c",
                vec![func(
                    "load",
                    1,
                    &["pkg:httpx#AsyncClient", "global#str", "pkg:redis#Redis"],
                )],
            ),
            file(
                "d/x.py",
                "d",
                vec![func(
                    "load",
                    1,
                    &[
                        "pkg:httpx#AsyncClient",
                        "pkg:python:json#loads",
                        "global#str",
                        "pkg:python:gzip#open",
                        "pkg:python:csv#reader",
                    ],
                )],
            ),
            callers("load", &["a/x.py", "b/x.py", "c/x.py", "d/x.py"]),
        ];
        // A one-line wrapper (one chain), and builtins only: no evidence.
        let sha: &[&str] = &[
            "pkg:python:hashlib#sha256",
            "pkg:python:hashlib#sha256().hexdigest",
        ];
        let builtins: &[&str] = &["global#str", "global#isinstance", "global#len"];
        for (name, calls) in [("_sha256", sha), ("_text", builtins)] {
            files.push(file(
                &format!("k/{name}_a.py"),
                "k",
                vec![func(name, 1, calls)],
            ));
            files.push(file(
                &format!("k/{name}_b.py"),
                "k",
                vec![func(name, 1, calls)],
            ));
            files.push(callers(
                name,
                &[&format!("k/{name}_a.py"), &format!("k/{name}_b.py")],
            ));
        }
        // Names a framework chose, a method, a dunder, a component, an entry point.
        for (i, name) in ["main", "handler", "GET", "upgrade", "__init__", "Svc.run"]
            .iter()
            .enumerate()
        {
            files.push(file(&format!("e/{i}a.py"), "e", vec![func(name, 1, FETCH)]));
            files.push(file(&format!("e/{i}b.py"), "e", vec![func(name, 1, FETCH)]));
            files.push(callers(
                name,
                &[&format!("e/{i}a.py"), &format!("e/{i}b.py")],
            ));
        }
        let mut card = func("Card", 1, FETCH);
        card.kind = SymbolKind::Component;
        files.push(file("f/a.tsx", "f", vec![card.clone()]));
        files.push(file("f/b.tsx", "f", vec![card]));
        for p in ["g/a.py", "g/b.py"] {
            let mut f = file(p, "g", vec![func("list_items", 1, FETCH)]);
            f.entry_points = vec![ep("list_items")];
            files.push(f);
        }
        files.push(callers("list_items", &["g/a.py", "g/b.py"]));
        // One file only, twice.
        files.push(file(
            "h/a.py",
            "h",
            vec![func("twice", 1, FETCH), func("twice", 9, FETCH)],
        ));
        files.push(callers("twice", &["h/a.py"]));
        // Tests and their helpers.
        files.push(file(
            "i/tests/test_a.py",
            "i",
            vec![func("make_client", 1, FETCH)],
        ));
        files.push(file(
            "i/tests/test_b.py",
            "i",
            vec![func("make_client", 1, FETCH)],
        ));
        files.push(callers(
            "make_client",
            &["i/tests/test_a.py", "i/tests/test_b.py"],
        ));
        // Nothing in the repository calls it: a framework finds it by name.
        files.push(file("j/a.py", "j", vec![func("on_startup", 1, FETCH)]));
        files.push(file("j/b.py", "j", vec![func("on_startup", 1, FETCH)]));
        let r = repo(files);
        assert_eq!(summary(&duplicate_helpers(&r)), []);
        for f in &r.files {
            assert_eq!(duplicates_in(&r, &f.path), [], "{}", f.path);
        }
    }

    /// A copy used only as a dependency or a decorator is referenced.
    #[test]
    fn a_copy_wrapped_with_is_referenced() {
        let mut user = func("handler_a", 1, &[]);
        user.wraps = vec![
            Wrap {
                wrapper: "a/deps.py#get_db".into(),
                kind: WrapKind::Call,
            },
            Wrap {
                wrapper: "b/deps.py#get_db".into(),
                kind: WrapKind::Call,
            },
        ];
        let db = &["a/db.py#SessionLocal", "pkg:sqlalchemy#orm.Session.close"];
        let db_b = &["b/db.py#SessionLocal", "pkg:sqlalchemy#orm.Session.close"];
        let r = repo(vec![
            file("a/deps.py", "a", vec![func("get_db", 3, db)]),
            file("b/deps.py", "b", vec![func("get_db", 3, db_b)]),
            file("a/api.py", "a", vec![user]),
        ]);
        // `SessionLocal` is another file's in each: only the session's close is shared.
        assert_eq!(summary(&duplicate_helpers(&r)), []);
        let same = &[
            "pkg:sqlalchemy#orm.sessionmaker",
            "pkg:sqlalchemy#orm.Session.close",
        ];
        let mut r = r;
        r.files[0].symbols[0].calls = same.iter().map(|c| c.to_string()).collect();
        r.files[1].symbols[0].calls = same.iter().map(|c| c.to_string()).collect();
        assert_eq!(
            summary(&duplicate_helpers(&r)),
            [(
                "get_db".to_string(),
                vec!["a/deps.py:3".to_string(), "b/deps.py:3".to_string()],
                2
            )]
        );
    }

    /// Two shapes under one name are two helpers; the list is ranked by copies times
    /// shared callees, and the findings keep one per name, with every copy up to the cap.
    #[test]
    fn helpers_are_ranked_and_capped() {
        let other: &[&str] = &["pkg:redis#Redis", "pkg:python:json#dumps"];
        let mut files = Vec::new();
        let mut paths: Vec<String> = Vec::new();
        for i in 0..10 {
            let p = format!("s{i:02}/log.py");
            files.push(file(
                &p,
                &format!("s{i:02}"),
                vec![func("configure", 2, FETCH)],
            ));
            paths.push(p);
        }
        for i in 0..2 {
            let p = format!("r{i}/log.py");
            files.push(file(&p, "r", vec![func("configure", 5, other)]));
            paths.push(p);
        }
        for name in ["a1", "a2", "a3", "a4", "a5", "a6"] {
            for d in ["x", "y"] {
                let p = format!("{d}/{name}.py");
                files.push(file(&p, "one", vec![func(name, 1, other)]));
                paths.push(p);
            }
        }
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        files.push(callers("configure", &refs));
        for name in ["a1", "a2", "a3", "a4", "a5", "a6"] {
            files.push(callers(name, &refs));
        }
        let r = repo(files);
        let all = duplicate_helpers(&r);
        let ranked: Vec<(&str, usize, usize)> = all
            .iter()
            .map(|h| (h.name.as_str(), h.copies.len(), h.shared_calls))
            .collect();
        assert_eq!(
            ranked,
            [
                ("configure", 10, 3),
                ("a1", 2, 2),
                ("a2", 2, 2),
                ("a3", 2, 2),
                ("a4", 2, 2),
                ("a5", 2, 2),
                ("a6", 2, 2),
                ("configure", 2, 2),
            ]
        );
        let found = findings(&r, None, None);
        let names: Vec<&str> = found.iter().filter_map(|f| f.key.as_deref()).collect();
        assert_eq!(names, ["configure", "a1", "a2", "a3", "a4"]);
        let first = &found[0];
        assert_eq!(first.kind, super::super::FindingKind::DuplicateHelper);
        assert_eq!((first.concern.as_str(), first.members), (HYGIENE, 10));
        assert_eq!(first.package, None);
        assert_eq!(first.copies.len(), super::super::caps::COPIES);
        assert_eq!(first.examples.len(), super::super::caps::EXAMPLES);
        assert_eq!(first.shared_calls, Some(3));
        assert_eq!(found[1].package.as_deref(), Some("one"));
        // In a scope: the helpers with a copy there.
        let scoped = findings(&r, Some("r"), None);
        assert_eq!(scoped.len(), 1);
        assert_eq!(
            (scoped[0].key.as_deref(), scoped[0].members),
            (Some("configure"), 2)
        );
        assert_eq!(findings(&r, None, Some("x/a6.py")).len(), 1);
        assert_eq!(findings(&r, Some("nowhere"), None), []);
    }
}
