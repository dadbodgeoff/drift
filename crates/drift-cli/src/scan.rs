//! One scan over every language Drift parses: TypeScript/JavaScript and Python.
//! Each parser ingests its own files; the results are merged into one
//! [`RepoFacts`] and normalised, so output stays deterministic.

use std::path::Path;

use drift_core::RepoFacts;
pub use drift_ts::{ScanOptions, ScanStats};

/// Scan `root` with every language parser and merge the facts. One walk of the
/// repository finds the files of both, and the two languages are scanned side by
/// side on one pool of workers (the same workers, and the same stacks, each had to
/// itself in turn before): the scan takes as long as the longer of the two.
pub fn scan(root: &Path, opts: &ScanOptions) -> anyhow::Result<(RepoFacts, ScanStats)> {
    let canonical = drift_core::fsutil::canonical(root)?;
    // Before the walk: a file changed this close to it is read again next time.
    let started_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut walked = drift_core::ingest::walk(&canonical, opts.threads, &walked_config)?;
    let deployments = drift_mine::serverless::read_configs(&walked.config);
    let py_walked = std::mem::take(&mut walked.python);
    let py_opts = drift_py::ScanOptions {
        cache_dir: opts.cache_dir.clone(),
        threads: opts.threads,
    };
    let (ts, py) = drift_core::stack::pool(opts.threads)?.install(|| {
        drift_core::stack::both(
            || drift_ts::scan_walked(&canonical, opts, walked, started_ns),
            || drift_py::scan_walked(&canonical, &py_opts, py_walked, started_ns),
        )
    });
    // The TypeScript scan's error first, as when it ran first.
    let (mut repo, mut stats) = ts?;
    let (py, py_stats) = py?;
    merge(&mut repo, py);
    apply_packages(root, &mut repo);
    drift_mine::serverless::list(&mut repo, &deployments);
    stats.files += py_stats.files;
    stats.cache_hits += py_stats.cache_hits;
    stats.parse_errors += py_stats.parse_errors;
    Ok((listed_where_asked(root, repo), stats))
}

/// The facts every command reads: those of the measured build's listings, or, where
/// a person turned the experimental feature on
/// ([`drift_mine::policy::LISTED_ENTRY_POINTS_FEATURE`]), those with every listing
/// ([`RepoFacts::listed`]), so that what is mined and checked is what `drift
/// security` and the practice map read.
fn listed_where_asked(root: &Path, facts: RepoFacts) -> RepoFacts {
    match drift_mine::policy::listed_entry_points(root) {
        true => facts.into_listed(),
        false => facts,
    }
}

/// Facts sufficient to check the file `rel`, identical to a full [`scan`]'s for that
/// file (its facts, the models it declares, every package and linter config), from
/// one walk: the TypeScript or the Python single-file scan, plus the other
/// language's package facts and, for a file below an `integration` directory, its
/// `integration_files`. `Ok(None)` when a full scan is
/// needed (no index yet, a package manifest or schema file, or a file that cannot
/// be done exactly).
pub fn scan_file(root: &Path, opts: &ScanOptions, rel: &str) -> anyhow::Result<Option<RepoFacts>> {
    if drift_py::packages::is_manifest(rel) || opts.cache_dir.is_none() {
        return Ok(None);
    }
    let root = drift_core::fsutil::canonical(root)?;
    // A file neither parser reads and no repo-level pass reads (`.md`, `.css`, ...): no
    // facts, as the TypeScript single-file scan would say after the walk.
    if !analysed(rel) && !drift_ts::repo::is_config_path(rel) {
        let mut facts = RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            ..RepoFacts::default()
        };
        apply_packages(&root, &mut facts);
        facts.normalize();
        return Ok(Some(facts));
    }
    // Whether an `integration/` directory is a test suite only decides anything about
    // a file below one: only then are the other language's files there looked up.
    let suite_matters = drift_core::in_integration_dir(rel);
    let mut walked = drift_core::ingest::walk(&root, opts.threads, &walked_config)?;
    let deployments = drift_mine::serverless::read_configs(&walked.config);
    let py = std::mem::take(&mut walked.python);
    let python = std::path::Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| drift_core::ingest::PYTHON_EXTENSIONS.contains(&e));
    let mut facts = if python {
        let py_opts = drift_py::ScanOptions {
            cache_dir: opts.cache_dir.clone(),
            threads: opts.threads,
        };
        let Some(mut facts) = drift_py::scan_file_walked(&root, &py_opts, rel, py)? else {
            return Ok(None);
        };
        if !facts.files.is_empty() {
            // A linter config no stack could be had for: a full scan records it.
            let Some((packages, lint)) = drift_ts::config_facts(&root, &walked.config) else {
                return Ok(None);
            };
            facts.packages.extend(packages);
            facts.lint = lint;
        }
        if !facts.files.is_empty() && suite_matters {
            facts.integration_files.extend(drift_ts::integration_files(
                &root,
                opts.cache_dir.as_deref(),
                &walked.sources,
            ));
        }
        facts
    } else {
        let packages = drift_py::packages_of(&root, &py);
        let Some(mut facts) = drift_ts::scan_file_walked(&root, opts, rel, walked)? else {
            return Ok(None);
        };
        if !facts.files.is_empty() {
            facts.packages.extend(packages);
        }
        if !facts.files.is_empty() && suite_matters {
            facts.integration_files.extend(drift_py::integration_files(
                &root,
                opts.cache_dir.as_deref(),
                &py.sources,
            ));
        }
        facts
    };
    apply_packages(&root, &mut facts);
    facts.normalize();
    // The entry points a deployment file names, decided as a full scan decides them;
    // where that needs files this scan did not read, a full scan is needed.
    if drift_mine::serverless::list(&mut facts, &deployments).needs_repo(&root, rel) {
        return Ok(None);
    }
    Ok(Some(listed_where_asked(&root, facts)))
}

/// The files the walk collects for repo-level passes: those the TypeScript scan
/// reads, and the deployment files ([`drift_mine::serverless`]).
fn walked_config(rel: &str) -> bool {
    drift_ts::repo::is_config_path(rel) || drift_mine::serverless::is_config_path(rel)
}

/// A file Drift reads at all: a source, a file repo-level passes read (`package.json`,
/// Prisma, SQL, linter configs) or a Python project manifest.
pub fn read_by_drift(rel: &str) -> bool {
    analysed(rel) || drift_ts::repo::is_config_path(rel) || drift_py::packages::is_manifest(rel)
}

/// A TypeScript/JavaScript or Python source by its extension.
fn analysed(rel: &str) -> bool {
    std::path::Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            drift_core::ingest::SOURCE_EXTENSIONS.contains(&e)
                || drift_core::ingest::PYTHON_EXTENSIONS.contains(&e)
        })
}

/// `packages:` in `.drift/config.yaml` ([`drift_mine::workspace::apply`]); without it,
/// or with a config that cannot be read, the facts are as scanned.
fn apply_packages(root: &Path, facts: &mut RepoFacts) {
    if let Ok(cfg) = drift_mine::policy::DriftConfig::load(root) {
        drift_mine::workspace::apply(&cfg.packages, facts);
    }
}

fn merge(into: &mut RepoFacts, other: RepoFacts) {
    into.files.extend(other.files);
    into.skipped.extend(other.skipped);
    into.models.extend(other.models);
    into.packages.extend(other.packages);
    into.context_files.extend(other.context_files);
    into.integration_files.extend(other.integration_files);
    into.generated_clients.extend(other.generated_clients);
    into.generated_clients.sort();
    into.generated_clients.dedup();
    into.normalize();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A file no parser reads gets the facts the walk-and-scan path gave it, without
    /// the walk.
    #[test]
    fn a_file_no_parser_reads_has_the_facts_it_had_without_a_walk() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::write(r.join("package.json"), "{ \"name\": \"t\" }").unwrap();
        std::fs::create_dir_all(r.join("web")).unwrap();
        std::fs::write(r.join("web/a.ts"), "export const a = 1;\n").unwrap();
        std::fs::write(r.join("README.md"), "# t\n").unwrap();
        std::fs::write(r.join("web/site.css"), "a {}\n").unwrap();
        let cache = tempfile::tempdir().unwrap();
        let opts = ScanOptions {
            cache_dir: Some(cache.path().to_path_buf()),
            threads: 1,
        };
        scan(r, &opts).unwrap();
        let canon = drift_core::fsutil::canonical(r).unwrap();
        for rel in ["README.md", "web/site.css", "notes/new.txt"] {
            // What it was: the walk, then the TypeScript single-file scan.
            let walked =
                drift_core::ingest::walk(&canon, 1, &drift_ts::repo::is_config_path).unwrap();
            let mut before = drift_ts::scan_file_walked(&canon, &opts, rel, walked)
                .unwrap()
                .unwrap();
            apply_packages(&canon, &mut before);
            before.normalize();
            let now = scan_file(r, &opts, rel).unwrap().unwrap();
            assert_eq!(
                serde_json::to_string(&now).unwrap(),
                serde_json::to_string(&before).unwrap(),
                "{rel}"
            );
            assert!(now.files.is_empty());
        }
        // Sources and repo-level files still take the walk.
        assert!(!analysed("package.json") && drift_ts::repo::is_config_path("package.json"));
        assert!(analysed("web/a.ts") && analysed("api/b.py"));
    }

    /// One walk finds the files of both languages: the facts are those of each
    /// language scanned on a walk of its own, merged, as a scan was before. Cold, with
    /// the cache it wrote, after an edit, and with a file added and one removed.
    #[test]
    fn one_walk_gives_the_facts_of_a_walk_for_each_language() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::write(r.join("package.json"), "{ \"name\": \"t\" }").unwrap();
        std::fs::write(r.join(".gitignore"), "ignored/\n").unwrap();
        for d in ["web/lib", "api", "ignored", "integration"] {
            std::fs::create_dir_all(r.join(d)).unwrap();
        }
        std::fs::write(
            r.join("web/a.ts"),
            "import { b } from './lib/b';\nexport const a = () => b();\n",
        )
        .unwrap();
        std::fs::write(r.join("web/lib/b.ts"), "export const b = () => 1;\n").unwrap();
        std::fs::write(r.join("web/a.test.ts"), "import { a } from './a';\na();\n").unwrap();
        std::fs::write(
            r.join("api/pyproject.toml"),
            "[project]\nname = \"api\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(r.join("api/__init__.py"), "").unwrap();
        std::fs::write(
            r.join("api/b.py"),
            "from . import c\n\ndef b():\n    c.f()\n",
        )
        .unwrap();
        std::fs::write(r.join("api/c.py"), "def f():\n    pass\n").unwrap();
        std::fs::write(r.join("ignored/x.ts"), "export const x = 1;\n").unwrap();
        std::fs::write(r.join("ignored/y.py"), "y = 1\n").unwrap();
        std::fs::write(r.join("integration/t.py"), "def test_t():\n    pass\n").unwrap();
        // A scan as it was: each language on a walk of its own.
        let apart = |opts: &ScanOptions| {
            let (mut repo, mut stats) = drift_ts::scan(r, opts).unwrap();
            let py_opts = drift_py::ScanOptions {
                cache_dir: opts.cache_dir.clone(),
                threads: opts.threads,
            };
            let (py, py_stats) = drift_py::scan(r, &py_opts).unwrap();
            merge(&mut repo, py);
            apply_packages(r, &mut repo);
            stats.files += py_stats.files;
            (serde_json::to_string(&repo).unwrap(), stats.files)
        };
        let together = |opts: &ScanOptions| {
            let (repo, stats) = scan(r, opts).unwrap();
            (serde_json::to_string(&repo).unwrap(), stats.files)
        };
        let cache_a = tempfile::tempdir().unwrap();
        let cache_b = tempfile::tempdir().unwrap();
        let cached = |d: &tempfile::TempDir, threads| ScanOptions {
            cache_dir: Some(d.path().to_path_buf()),
            threads,
        };
        let none = ScanOptions {
            cache_dir: None,
            threads: 1,
        };
        let check = |what: &str| {
            let want = apart(&none);
            assert_eq!(together(&none), want, "{what}: no cache");
            for threads in [1, 4] {
                // Each with a cache of its own, twice: writing it, then reading it.
                for round in 0..2 {
                    assert_eq!(apart(&cached(&cache_a, threads)), want, "{what} {round}");
                    assert_eq!(
                        together(&cached(&cache_b, threads)),
                        want,
                        "{what}: round {round}, {threads} thread(s)"
                    );
                }
            }
            want
        };
        let first = check("as written");
        assert_eq!(first.1, 7, "{}", first.0);
        assert!(!first.0.contains("ignored/"), "{}", first.0);
        std::fs::write(
            r.join("api/c.py"),
            "def f():\n    pass\n\ndef g():\n    pass\n",
        )
        .unwrap();
        std::fs::write(r.join("web/lib/b.ts"), "export const b = () => 2;\n").unwrap();
        assert_ne!(check("after an edit of each language").0, first.0);
        std::fs::write(r.join("api/d.py"), "from .c import g\n").unwrap();
        std::fs::remove_file(r.join("web/a.test.ts")).unwrap();
        assert_eq!(check("a file added and one removed").1, 7);
    }

    #[test]
    fn mixed_repo_merges_deterministically() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::create_dir_all(r.join("web")).unwrap();
        std::fs::create_dir_all(r.join("api")).unwrap();
        std::fs::write(r.join("web/a.ts"), "export const a = 1;\n").unwrap();
        std::fs::write(r.join("api/__init__.py"), "").unwrap();
        std::fs::write(
            r.join("api/b.py"),
            "from . import c\n\ndef b():\n    c.f()\n",
        )
        .unwrap();
        std::fs::write(r.join("api/c.py"), "def f():\n    pass\n").unwrap();
        let one = |threads| {
            let opts = ScanOptions {
                cache_dir: None,
                threads,
            };
            serde_json::to_string(&scan(r, &opts).unwrap().0).unwrap()
        };
        let a = one(1);
        assert_eq!(a, one(8));
        let facts: RepoFacts = serde_json::from_str(&a).unwrap();
        let paths: Vec<_> = facts.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            ["api/__init__.py", "api/b.py", "api/c.py", "web/a.ts"]
        );
        let b = &facts.files[1].symbols[0];
        assert_eq!(b.calls, ["api/c.py#f"]);
    }

    #[test]
    fn hostile_nesting_is_skipped_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        let deep =
            |open: &str, close: &str, n: usize| format!("{}1{}", open.repeat(n), close.repeat(n));
        std::fs::write(
            r.join("p.py"),
            format!("x = {}\n", deep("(\n", "\n)", 100_000)),
        )
        .unwrap();
        std::fs::write(
            r.join("c.py"),
            format!(
                "def f():\n    return ({}{})\n",
                "g(\n".repeat(80_000),
                ")\n".repeat(80_000)
            ),
        )
        .unwrap();
        std::fs::write(
            r.join("a.py"),
            format!("import os\nx = (os\n{})\n", ".a\n".repeat(200_000)),
        )
        .unwrap();
        std::fs::write(
            r.join("x.ts"),
            format!("export const x = {};\n", deep("(\n", "\n)", 100_000)),
        )
        .unwrap();
        std::fs::write(
            r.join("f.py"),
            format!("x = f\"\"\"{{{}}}\"\"\"\n", deep("(\n", "\n)", 100_000)),
        )
        .unwrap();
        std::fs::write(
            r.join("t.ts"),
            format!("export const t = `${{{}}}`;\n", deep("(\n", "\n)", 100_000)),
        )
        .unwrap();
        // A quote, backtick or `/*` inside a regex does not hide the code after it.
        std::fs::write(
            r.join("r.ts"),
            format!(
                "const r = /`/;\nexport const x = {};\nconst t = `x`;\n",
                deep("(\n", "\n)", 100_000)
            ),
        )
        .unwrap();
        std::fs::write(
            r.join("q.ts"),
            format!(
                "declare const s: string;\nif (s) /[/*'\"]/.test(s);\nexport const x = {};\n// */\n",
                deep("(\n", "\n)", 100_000)
            ),
        )
        .unwrap();
        // Many small hides: a `'` in each line's regex `x < /'/(`.
        std::fs::write(
            r.join("a.ts"),
            format!("const a = {}1;\n", "x</'/(\n".repeat(100_000)),
        )
        .unwrap();
        // A JSX closer before a real template with a `/` in it.
        std::fs::write(
            r.join("j.tsx"),
            format!(
                "export const C = () => (\n  <p>\n    <b>x</b>{{`a/b\n`}}\n  </p>\n);\nconst d = {};\n",
                deep("(\n", "\n)", 100_000)
            ),
        )
        .unwrap();
        std::fs::write(r.join("ok.py"), "def ok():\n    return 1\n").unwrap();
        // Division, regexes and JSX closing tags in real code are scanned.
        std::fs::write(
            r.join("ok.tsx"),
            "export function Ok(p: { a: number; b: number; s: string }) {\n  const r = /[/(]`'/g;\n  const half = (p.a / 2) / p.b;\n  if (/\\//.test(p.s)) return <a href=\"/x\">{p.a}/{p.b}</a>;\n  return <div>{half}</div>;\n}\n",
        )
        .unwrap();
        let (facts, _) = scan(r, &ScanOptions::default()).unwrap();
        let paths: Vec<_> = facts.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["ok.py", "ok.tsx"]);
        let ok = &facts.files[1];
        assert!(ok.parse_ok);
        assert!(
            ok.symbols.iter().any(|s| s.name == "Ok"),
            "{:?}",
            ok.symbols
        );
        let skipped: Vec<_> = facts
            .skipped
            .iter()
            .map(|s| (s.path.as_str(), s.reason))
            .collect();
        use drift_core::SkipReason::TooDeep;
        assert_eq!(
            skipped,
            [
                ("a.py", TooDeep),
                ("a.ts", TooDeep),
                ("c.py", TooDeep),
                ("f.py", TooDeep),
                ("j.tsx", TooDeep),
                ("p.py", TooDeep),
                ("q.ts", TooDeep),
                ("r.ts", TooDeep),
                ("t.ts", TooDeep),
                ("x.ts", TooDeep)
            ]
        );
    }
}
