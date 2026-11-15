//! When an import edge loads its module (`Import::load`): static declarations and
//! top-level `require`, `require()` inside a function, `import()`, and specifiers
//! passed to a lazy-load helper of the repository (a function whose body loads its
//! parameter, found by what it does rather than by its name). Also the peer and
//! optional dependencies of workspace packages.

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, ImportLoad, RepoFacts};
use drift_ts::{ScanOptions, scan, scan_file};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

/// (module, load) of every value import of `path`.
fn loads(r: &RepoFacts, path: &str) -> Vec<(String, ImportLoad)> {
    file(r, path)
        .imports
        .iter()
        .filter(|i| !i.type_only)
        .map(|i| (i.module.clone(), i.load))
        .collect()
}

const MICRO: &str = "packages/micro/index.ts";
const WS: &str = "packages/ws/index.ts";
const OTHER: &str = "packages/other/index.ts";

const FILES: &[(&str, &str)] = &[
    (
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    ),
    (
        "packages/core/package.json",
        r#"{
  "name": "@x/core",
  "dependencies": { "tslib": "2.0.0" },
  "peerDependencies": { "@x/micro": "^1.0.0", "@x/ws": "^1.0.0" },
  "peerDependenciesMeta": { "@x/micro": { "optional": true } },
  "optionalDependencies": { "fsevents": "^2.0.0" }
}"#,
    ),
    (
        "packages/micro/package.json",
        r#"{ "name": "@x/micro", "main": "index.ts" }"#,
    ),
    ("packages/micro/index.ts", "export const micro = 1;\n"),
    (
        "packages/ws/package.json",
        r#"{ "name": "@x/ws", "main": "index.ts" }"#,
    ),
    ("packages/ws/index.ts", "export const ws = 1;\n"),
    (
        "packages/other/package.json",
        r#"{ "name": "@x/other", "main": "index.ts" }"#,
    ),
    ("packages/other/index.ts", "export const other = 1;\n"),
    // Helpers, re-exported through a barrel. Their names say nothing.
    (
        "packages/core/helpers/load.ts",
        "import { createRequire } from 'module';\n\
         export async function optionalRequire(packageName: string, loaderFn?: Function) {\n\
           try {\n\
             return loaderFn ? await loaderFn() : await import(packageName);\n\
           } catch {\n\
             return {};\n\
           }\n\
         }\n\
         export const bring = (context: string, name: string) => createRequire(import.meta.url)(name);\n\
         export function fetchIt(name: string) {\n\
           return require(name);\n\
         }\n\
         // Loads a fixed module, not its parameter: no helper.\n\
         export function notALoader(name: string) {\n\
           return import('./fixed').then((m) => m.pick(name));\n\
         }\n",
    ),
    (
        "packages/core/helpers/fixed.ts",
        "export const pick = (n: string) => n;\n",
    ),
    (
        "packages/core/helpers/index.ts",
        "export * from './load';\n",
    ),
    ("packages/core/src/top.ts", "module.exports = {};\n"),
    (
        "packages/core/src/static.ts",
        "import { micro } from '@x/micro';\nexport const s = micro;\n",
    ),
    (
        "packages/core/src/dynamic.ts",
        "export async function load() {\n  return import('@x/micro');\n}\n",
    ),
    (
        "packages/core/src/required.ts",
        "const top = require('./top');\n\
         require('@x/ws');\n\
         export function load() {\n  return require('@x/micro');\n}\n",
    ),
    (
        "packages/core/src/lazy.ts",
        "import { optionalRequire, bring, fetchIt, notALoader } from '../helpers';\n\
         export async function load() {\n\
           await optionalRequire('@x/micro');\n\
           bring('@x/other', '@x/ws');\n\
           notALoader('@x/other');\n\
         }\n\
         export function relative() {\n  return fetchIt('./fixed');\n}\n",
    ),
    // Loads that run when the module loads: static.
    (
        "packages/core/src/eager.ts",
        "function hard(n: string) {\n  return require(n);\n}\n\
         export const m = hard('@x/micro');\n",
    ),
    (
        "packages/core/src/iife.ts",
        "export const v = (() => require('@x/micro'))();\n\
         export const w = (function () {\n  return require('@x/ws');\n})();\n",
    ),
    (
        "packages/core/src/iife-in-fn.ts",
        "export function f() {\n  return (() => require('@x/micro'))();\n}\n",
    ),
    (
        "packages/core/src/top-await.ts",
        "export const m = await import('@x/micro');\n",
    ),
    (
        "packages/core/src/reexport.ts",
        "export { micro } from '@x/micro';\n\
         export async function load() {\n  return import('@x/micro');\n}\n",
    ),
    (
        "packages/core/src/reexport-helper.ts",
        "import { optionalRequire } from '../helpers';\n\
         export * from '@x/ws';\n\
         export async function load() {\n  return optionalRequire('@x/ws');\n}\n",
    ),
    (
        "packages/core/src/type-and-dynamic.ts",
        "import type { other } from '@x/other';\n\
         export let o: typeof other;\n\
         export async function load() {\n  return import('@x/other');\n}\n",
    ),
    (
        "packages/core/src/both.ts",
        "import { micro } from '@x/micro';\n\
         export async function load() {\n  return [micro, await import('@x/micro')];\n}\n",
    ),
    (
        "packages/core/src/local-helper.ts",
        "function want(spec: string) {\n  return import(spec);\n}\n\
         export const w = () => want('@x/ws');\n",
    ),
];

fn opts(cache: Option<&Path>) -> ScanOptions {
    ScanOptions {
        cache_dir: cache.map(Path::to_path_buf),
        threads: 1,
    }
}

#[test]
fn each_import_edge_says_when_it_loads() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), FILES);
    let (r, _) = scan(dir.path(), &opts(None)).unwrap();
    let st = ImportLoad::Static;
    assert_eq!(
        loads(&r, "packages/core/src/static.ts"),
        [(MICRO.into(), st)]
    );
    assert_eq!(
        loads(&r, "packages/core/src/dynamic.ts"),
        [(MICRO.into(), ImportLoad::Dynamic)]
    );
    // A top-level require (bound or bare) is static; one inside a function is not.
    assert_eq!(
        loads(&r, "packages/core/src/required.ts"),
        [
            ("packages/core/src/top.ts".into(), st),
            (MICRO.into(), ImportLoad::Require),
            (WS.into(), st),
        ]
    );
    // Through a helper that loads its parameter: the parameter's argument only.
    // `notALoader` imports a fixed module, so its argument is no import. A relative
    // specifier is the helper's to load: `./fixed` next to the helper, not the caller.
    assert_eq!(
        loads(&r, "packages/core/src/lazy.ts"),
        [
            ("packages/core/helpers/fixed.ts".into(), ImportLoad::Lazy),
            ("packages/core/helpers/index.ts".into(), st),
            (MICRO.into(), ImportLoad::Lazy),
            (WS.into(), ImportLoad::Lazy),
        ]
    );
    // A helper call, a function called in place, or an `import()` at module scope
    // runs when the module loads; in place inside a function, when that runs.
    assert_eq!(
        loads(&r, "packages/core/src/eager.ts"),
        [(MICRO.into(), st)]
    );
    assert_eq!(
        loads(&r, "packages/core/src/iife.ts"),
        [(MICRO.into(), st), (WS.into(), st)]
    );
    assert_eq!(
        loads(&r, "packages/core/src/iife-in-fn.ts"),
        [(MICRO.into(), ImportLoad::Require)]
    );
    assert_eq!(
        loads(&r, "packages/core/src/top-await.ts"),
        [(MICRO.into(), st)]
    );
    // A module the file re-exports is loaded with it, however else it is loaded.
    assert_eq!(
        loads(&r, "packages/core/src/reexport.ts"),
        [(MICRO.into(), st)]
    );
    assert_eq!(
        loads(&r, "packages/core/src/reexport-helper.ts"),
        [
            ("packages/core/helpers/index.ts".into(), st),
            (WS.into(), st)
        ]
    );
    // A type-only import loads nothing: the value load next to it is kept.
    assert_eq!(
        loads(&r, "packages/core/src/type-and-dynamic.ts"),
        [(OTHER.into(), ImportLoad::Dynamic)]
    );
    assert!(
        file(&r, "packages/core/src/type-and-dynamic.ts")
            .imports
            .iter()
            .any(|i| i.type_only && i.module == OTHER)
    );
    // A module imported both ways is imported statically.
    assert_eq!(loads(&r, "packages/core/src/both.ts"), [(MICRO.into(), st)]);
    // A helper defined in the same file.
    assert_eq!(
        loads(&r, "packages/core/src/local-helper.ts"),
        [(WS.into(), ImportLoad::Lazy)]
    );
    // The helpers' own non-literal loads are no edges; a literal one is.
    let deferred: Vec<(String, ImportLoad)> = loads(&r, "packages/core/helpers/load.ts")
        .into_iter()
        .filter(|(_, l)| !l.is_static())
        .collect();
    assert_eq!(
        deferred,
        [("packages/core/helpers/fixed.ts".into(), ImportLoad::Dynamic)]
    );
}

#[test]
fn single_file_scans_see_the_same_lazy_edges() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), FILES);
    let cache = dir.path().join(".cache");
    let (full, _) = scan(dir.path(), &opts(Some(&cache))).unwrap();
    for rel in [
        "packages/core/src/lazy.ts",
        "packages/core/src/eager.ts",
        "packages/core/src/reexport-helper.ts",
        "packages/core/src/local-helper.ts",
        "packages/core/src/required.ts",
    ] {
        let one = scan_file(dir.path(), &opts(Some(&cache)), rel)
            .unwrap()
            .expect("single-file scan");
        assert_eq!(&one.files[0], file(&full, rel), "{rel}");
        assert_eq!(one.packages, full.packages, "{rel}");
    }
}

#[test]
fn packages_record_peer_and_optional_dependencies() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), FILES);
    let (r, _) = scan(dir.path(), &opts(None)).unwrap();
    let core = r
        .packages
        .iter()
        .find(|p| p.path == "packages/core")
        .unwrap();
    assert_eq!(core.dependencies, ["tslib@2.0.0"]);
    assert_eq!(core.peer_dependencies, ["@x/micro@^1.0.0", "@x/ws@^1.0.0"]);
    assert_eq!(
        core.optional_dependencies,
        ["@x/micro@^1.0.0", "fsevents@^2.0.0"]
    );
    let json = serde_json::to_value(&r).unwrap();
    let micro = json["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["path"] == "packages/micro")
        .unwrap();
    assert!(
        micro.get("peer_dependencies").is_none() && micro.get("optional_dependencies").is_none(),
        "empty lists are omitted"
    );
    // `load` is omitted for static edges and written for the others.
    let lazy = json["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "packages/core/src/dynamic.ts")
        .unwrap();
    assert_eq!(lazy["imports"][0]["load"], "dynamic");
    let st = json["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "packages/core/src/static.ts")
        .unwrap();
    assert!(st["imports"][0].get("load").is_none());
}

/// A re-export is a static value import of its source, with the names taken from it
/// (`*` for `export *` and `export * as ns`), merged into a value import of the same
/// specifier. Type-only re-exports, and those whose specifiers are all type-only,
/// import nothing; `export {} from` still loads its source.
#[test]
fn reexports_are_static_value_imports() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        &[
            ("package.json", r#"{ "name": "root" }"#),
            (
                "src/m.ts",
                "export const a = 1;\nexport const b = 2;\nexport interface T { x: number }\n",
            ),
            ("src/named.ts", "export { a, b as c } from './m';\n"),
            ("src/all.ts", "export * from './m';\n"),
            ("src/ns.ts", "export * as m from './m';\n"),
            ("src/empty.ts", "export {} from './m';\n"),
            (
                "src/merged.ts",
                "import { a } from './m';\nexport { b } from './m';\nexport const x = a;\n",
            ),
            ("src/mixed.ts", "export { type T, a } from './m';\n"),
            ("src/type.ts", "export type { T } from './m';\n"),
            ("src/inline-type.ts", "export { type T } from './m';\n"),
            ("src/type-all.ts", "export type * from './m';\n"),
        ],
    );
    let (r, _) = scan(dir.path(), &opts(None)).unwrap();
    let imports = |path: &str| -> Vec<(String, Vec<String>, bool, ImportLoad)> {
        file(&r, path)
            .imports
            .iter()
            .map(|i| (i.module.clone(), i.names.clone(), i.type_only, i.load))
            .collect()
    };
    let m = |names: &[&str]| {
        vec![(
            "src/m.ts".to_string(),
            names.iter().map(|n| n.to_string()).collect::<Vec<_>>(),
            false,
            ImportLoad::Static,
        )]
    };
    assert_eq!(imports("src/named.ts"), m(&["a", "b"]));
    assert_eq!(imports("src/all.ts"), m(&["*"]));
    assert_eq!(imports("src/ns.ts"), m(&["*"]));
    assert_eq!(imports("src/empty.ts"), m(&[]));
    assert_eq!(imports("src/merged.ts"), m(&["a", "b"]));
    assert_eq!(imports("src/mixed.ts"), m(&["a"]));
    for path in ["src/type.ts", "src/inline-type.ts", "src/type-all.ts"] {
        assert_eq!(imports(path), [], "{path}");
    }
}
