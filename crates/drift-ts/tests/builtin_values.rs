//! A member a parameter's object type literal gives a built-in value's type
//! (TypeScript lowering 72): a method called on it is the built-in's, recorded as
//! `builtin_value:<parameter>.<member>` in the listed reading only. What mining reads
//! is what it was.

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol};
use drift_ts::{ScanOptions, scan};

fn scanned(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

const LIB: &str = r#"import type { Thing } from "./thing";

export function joined(params: { path: string[] }) {
  return params.path.join("/");
}

export function trimmed(opts: { name: string; count: number }) {
  return opts.name.trim() + opts.count.toFixed(0);
}

export function generic(params: { path: Array<string> }) {
  return params.path.join("/");
}

export function readonlyArray(params: { path: readonly string[] }) {
  return params.path.join("/");
}

// Not a built-in's: a type Drift would have to resolve, a union, a member of a member,
// a member the literal does not declare, a parameter destructured.
export function named(params: { path: Thing }) {
  return params.path.join("/");
}

export function union(params: { path: string[] | Thing }) {
  return params.path.join("/");
}

export function deeper(params: { path: string[] }) {
  return params.path.length.toFixed(0);
}

export function undeclared(params: { path: string[] }) {
  return params.other.join("/");
}

export function destructured({ path }: { path: string[] }) {
  return path.join("/");
}
"#;

#[test]
fn a_method_of_a_member_a_type_literal_gives_a_built_in_type_is_the_built_ins() {
    let facts = scanned(&[
        ("package.json", r#"{ "name": "web" }"#),
        (
            "thing.ts",
            "export type Thing = { join(s: string): string };\n",
        ),
        ("lib.ts", LIB),
    ]);
    let listed = facts.listed();
    let f = listed.files.iter().find(|f| f.path == "lib.ts").unwrap();
    let builtin = |name: &str| -> Vec<String> {
        symbol(f, name)
            .controls
            .iter()
            .filter(|c| c.starts_with(drift_core::controls::BUILTIN_VALUE))
            .cloned()
            .collect()
    };
    assert_eq!(builtin("joined"), ["builtin_value:params.path"]);
    assert_eq!(
        builtin("trimmed"),
        ["builtin_value:opts.count", "builtin_value:opts.name"]
    );
    assert_eq!(builtin("generic"), ["builtin_value:params.path"]);
    assert_eq!(builtin("readonlyArray"), ["builtin_value:params.path"]);
    for name in ["named", "union", "deeper", "undeclared", "destructured"] {
        assert!(builtin(name).is_empty(), "{name}: {:?}", builtin(name));
    }
    // What mining reads holds none of it.
    let mined = facts.files.iter().find(|f| f.path == "lib.ts").unwrap();
    for s in &mined.symbols {
        assert!(
            !s.controls
                .iter()
                .any(|c| c.starts_with(drift_core::controls::BUILTIN_VALUE)),
            "{}: {:?}",
            s.name,
            s.controls
        );
    }
}
