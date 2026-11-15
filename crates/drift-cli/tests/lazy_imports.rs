//! Layering rules (`avoids` an `import:` area) and deferred loads: a package that
//! declares a workspace package as a peer or optional dependency loads it lazily
//! (`import()`, a `require()` inside a function, a lazy-load helper), and such a load
//! is no layering violation. A static import of it still is, and so is a deferred
//! load of a package it does not declare. Mining, `drift check`, a single-file check
//! (what the hooks run), the hooks and `drift census` agree.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_ts::{ScanOptions, scan, scan_file};
use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

const STATIC: &str = "packages/core/src/static.ts";
const DYNAMIC: &str = "packages/core/src/dynamic.ts";
const REQUIRED: &str = "packages/core/src/required.ts";
const LAZY: &str = "packages/core/src/lazy.ts";
const OTHER_DYNAMIC: &str = "packages/core/src/other-dynamic.ts";
const EAGER: &str = "packages/core/src/eager.ts";

/// `packages/core` sits below `packages/micro` and `packages/other`, which import it
/// from many files; core declares `@x/micro` as an optional peer dependency and does
/// not declare `@x/other`.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    );
    write(
        r,
        "packages/core/package.json",
        r#"{ "name": "@x/core", "peerDependencies": { "@x/micro": "^1.0.0" }, "peerDependenciesMeta": { "@x/micro": { "optional": true } } }"#,
    );
    for p in ["micro", "other"] {
        write(
            r,
            &format!("packages/{p}/package.json"),
            &format!(r#"{{ "name": "@x/{p}", "main": "index.ts" }}"#),
        );
        write(
            r,
            &format!("packages/{p}/index.ts"),
            "export * from './src/x0';\n",
        );
        for i in 0..30 {
            write(
                r,
                &format!("packages/{p}/src/x{i}.ts"),
                &format!(
                    "import {{ c{i} }} from '../../core/src/c{i}';\nexport const x{i} = c{i};\n"
                ),
            );
        }
    }
    for i in 0..80 {
        write(
            r,
            &format!("packages/core/src/c{i}.ts"),
            &format!("export const c{i} = {i};\n"),
        );
    }
    write(
        r,
        "packages/core/src/helper.ts",
        "export async function optionalRequire(name: string) {\n  try {\n    return await import(name);\n  } catch {\n    return undefined;\n  }\n}\n",
    );
    write(
        r,
        STATIC,
        "import { x0 } from '@x/micro';\nexport const s = x0;\n",
    );
    write(
        r,
        DYNAMIC,
        "export async function load() {\n  return import('@x/micro');\n}\n",
    );
    write(
        r,
        REQUIRED,
        "export function load() {\n  return require('../../micro/src/x2');\n}\n",
    );
    write(
        r,
        LAZY,
        "import { optionalRequire } from './helper';\nexport async function load() {\n  return optionalRequire('@x/micro');\n}\n",
    );
    // A helper called at module scope loads with the module: it counts.
    write(
        r,
        EAGER,
        "import { optionalRequire } from './helper';\nexport const m = optionalRequire('@x/micro');\n",
    );
    write(
        r,
        OTHER_DYNAMIC,
        "export async function load() {\n  return import('@x/other');\n}\n",
    );
    dir
}

fn avoid<'c>(cs: &'c [Candidate], area: &str) -> &'c Candidate {
    let signal = format!("import:{area}");
    cs.iter()
        .find(|c| matches!(&c.rule, Rule::Avoids { signal: s } if *s == signal))
        .unwrap_or_else(|| panic!("no rule avoiding {area}"))
}

fn outliers(c: &Candidate) -> Vec<&str> {
    c.outliers.iter().map(|o| o.path.as_str()).collect()
}

#[test]
fn deferred_loads_of_optional_peers_are_not_layering_violations() {
    let dir = repo();
    let r = dir.path();
    let opts = ScanOptions {
        cache_dir: Some(r.join(".drift-cache")),
        threads: 1,
    };
    let (full, _) = scan(r, &opts).unwrap();
    let mined = mine(&full, &MineOptions::default());
    // Only the static import and the module-scope helper call break "core does not
    // import micro"; a dynamic import of
    // a package core does not declare still breaks "core does not import other".
    assert_eq!(
        outliers(avoid(&mined.candidates, "packages/micro")),
        [EAGER, STATIC]
    );
    assert_eq!(
        outliers(avoid(&mined.candidates, "packages/other")),
        [OTHER_DYNAMIC]
    );

    // `drift check` on a full scan and on a single-file scan agree.
    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for conv in &mut policy.conventions {
        conv.status = Status::Accepted;
    }
    let lock = Lock::default();
    for rel in [STATIC, EAGER, DYNAMIC, REQUIRED, LAZY, OTHER_DYNAMIC] {
        let only: BTreeSet<String> = [rel.to_string()].into();
        let whole = check(&full, &policy, &lock, Scope::Accepted, Some(&only));
        let one = scan_file(r, &opts, rel).unwrap().expect("single-file scan");
        let single = check(&one, &policy, &lock, Scope::Accepted, Some(&only));
        assert_eq!(single.violations, whole.violations, "{rel}");
        let layering = whole
            .violations
            .iter()
            .filter(|v| v.path == rel && v.summary.contains("do not import from"))
            .count();
        let expected = usize::from(rel == STATIC || rel == EAGER || rel == OTHER_DYNAMIC);
        assert_eq!(layering, expected, "{rel}: {:?}", whole.violations);
    }
}

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

fn post_edit(root: &Path, rel: &str) -> Option<Value> {
    let input = json!({
        "session_id": "s1",
        "cwd": root,
        "hook_event_name": "PostToolUse",
        "tool_name": "Write",
        "tool_input": { "file_path": root.join(rel) },
    });
    let (code, out) = run(
        root,
        &["hook", "claude", "PostToolUse"],
        Some(&input.to_string()),
    );
    assert_eq!(code, 0, "hooks always exit 0");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

#[test]
fn census_check_and_hooks_agree_on_deferred_loads() {
    let dir = repo();
    let r = dir.path();
    let (_, census) = run(r, &["census", "--json", "--all-outliers"], None);
    let v: Value = serde_json::from_str(&census).unwrap();
    let micro = v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["signal"] == "import:packages/micro")
        .expect("core avoids micro");
    assert_eq!(micro["tier"], "default");
    let paths: Vec<&str> = micro["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, [EAGER, STATIC]);
    let id = micro["id"].as_str().unwrap().to_string();

    run(r, &["init"], None);
    run(r, &["review", "--block", &id], None);
    assert_eq!(
        run(r, &["check"], None).0,
        0,
        "the legacy import is baselined"
    );
    run(r, &["hook", "claude", "SessionStart"], Some(&json!({ "session_id": "s1", "cwd": r, "hook_event_name": "SessionStart", "source": "startup" }).to_string()));

    // New code that loads the optional peer lazily passes check and the hook.
    let new_lazy = "packages/core/src/new-lazy.ts";
    write(
        r,
        new_lazy,
        "import { optionalRequire } from './helper';\nexport async function a() {\n  return [await import('@x/micro'), await optionalRequire('@x/micro')];\n}\nexport function b() {\n  return require('@x/micro');\n}\n",
    );
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 0, "{out}");
    let hooked = post_edit(r, new_lazy);
    assert!(
        hooked.as_ref().is_none_or(|h| !h.to_string().contains(&id)),
        "{hooked:?}"
    );

    // A new static import of it fails both.
    let new_static = "packages/core/src/new-static.ts";
    write(
        r,
        new_static,
        "import { x0 } from '@x/micro';\nexport const n = x0;\n",
    );
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 1, "{out}");
    assert!(out.contains(&id) && out.contains(new_static), "{out}");
    let hooked = post_edit(r, new_static);
    assert!(
        hooked.as_ref().is_some_and(|h| h.to_string().contains(&id)),
        "{hooked:?}"
    );
}
