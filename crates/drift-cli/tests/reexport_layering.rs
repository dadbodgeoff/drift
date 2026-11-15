//! Layering rules (`avoids` an `import:` area) and re-exports: `export { x } from`,
//! `export * from` and `export * as ns from` a module load it with the file, so each
//! is an import of it and breaks a rule that the importing layer avoids its area.
//! Type-only imports and re-exports (`import type`, `import { type X }`, `export type
//! { X } from`, `export { type X } from`) load nothing at run time and break no
//! layering rule. Mining, `drift check`, a single-file check (what the hooks run),
//! the hooks and `drift census` agree.

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
const NAMED: &str = "packages/core/src/named.ts";
const ALL: &str = "packages/core/src/all.ts";
const NAMESPACE: &str = "packages/core/src/namespace.ts";
const TYPE_IMPORT: &str = "packages/core/src/type-import.ts";
const INLINE_TYPE_IMPORT: &str = "packages/core/src/inline-type-import.ts";
const TYPE_REEXPORT: &str = "packages/core/src/type-reexport.ts";
const INLINE_TYPE_REEXPORT: &str = "packages/core/src/inline-type-reexport.ts";
const TYPE_ALL: &str = "packages/core/src/type-all.ts";

/// Every core file the tests look at, and whether it breaks "core does not import
/// from packages/app".
const CASES: &[(&str, bool)] = &[
    (STATIC, true),
    (NAMED, true),
    (ALL, true),
    (NAMESPACE, true),
    (TYPE_IMPORT, false),
    (INLINE_TYPE_IMPORT, false),
    (TYPE_REEXPORT, false),
    (INLINE_TYPE_REEXPORT, false),
    (TYPE_ALL, false),
];

/// `packages/core` sits below `packages/app`, which imports it from many files and
/// which core does not declare.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    );
    write(r, "packages/core/package.json", r#"{ "name": "@x/core" }"#);
    write(
        r,
        "packages/app/package.json",
        r#"{ "name": "@x/app", "main": "index.ts" }"#,
    );
    write(r, "packages/app/index.ts", "export const app = 1;\n");
    write(
        r,
        "packages/app/src/types.ts",
        "export interface Session { id: string }\nexport const session = 1;\n",
    );
    for i in 0..30 {
        write(
            r,
            &format!("packages/app/src/x{i}.ts"),
            &format!("import {{ c{i} }} from '../../core/src/c{i}';\nexport const x{i} = c{i};\n"),
        );
    }
    for i in 0..200 {
        write(
            r,
            &format!("packages/core/src/c{i}.ts"),
            &format!("export const c{i} = {i};\n"),
        );
    }
    write(
        r,
        STATIC,
        "import { app } from '@x/app';\nexport const s = app;\n",
    );
    write(r, NAMED, "export { app } from '@x/app';\n");
    write(r, ALL, "export * from '../../app/src/types';\n");
    write(r, NAMESPACE, "export * as app from '@x/app';\n");
    write(
        r,
        TYPE_IMPORT,
        "import type { Session } from '../../app/src/types';\nexport let s: Session | undefined;\n",
    );
    write(
        r,
        INLINE_TYPE_IMPORT,
        "import { type Session } from '../../app/src/types';\nexport let s: Session | undefined;\n",
    );
    write(
        r,
        TYPE_REEXPORT,
        "export type { Session } from '../../app/src/types';\n",
    );
    write(
        r,
        INLINE_TYPE_REEXPORT,
        "export { type Session } from '../../app/src/types';\n",
    );
    write(r, TYPE_ALL, "export type * from '../../app/src/types';\n");
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

fn breakers() -> Vec<&'static str> {
    let mut b: Vec<&str> = CASES.iter().filter(|(_, b)| *b).map(|(p, _)| *p).collect();
    b.sort_unstable();
    b
}

#[test]
fn reexports_break_layering_rules_and_type_only_imports_do_not() {
    let dir = repo();
    let r = dir.path();
    let opts = ScanOptions {
        cache_dir: Some(r.join(".drift-cache")),
        threads: 1,
    };
    let (full, _) = scan(r, &opts).unwrap();
    let mined = mine(&full, &MineOptions::default());
    assert_eq!(
        outliers(avoid(&mined.candidates, "packages/app")),
        breakers()
    );

    // `drift check` on a full scan and on a single-file scan agree.
    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for conv in &mut policy.conventions {
        conv.status = Status::Accepted;
    }
    let lock = Lock::default();
    for &(rel, breaks) in CASES {
        let only: BTreeSet<String> = [rel.to_string()].into();
        let whole = check(&full, &policy, &lock, Scope::Accepted, Some(&only));
        let one = scan_file(r, &opts, rel).unwrap().expect("single-file scan");
        assert_eq!(
            &one.files[0],
            full.files.iter().find(|f| f.path == rel).unwrap()
        );
        let single = check(&one, &policy, &lock, Scope::Accepted, Some(&only));
        assert_eq!(single.violations, whole.violations, "{rel}");
        let layering = whole
            .violations
            .iter()
            .filter(|v| v.path == rel && v.summary.contains("do not import from packages/app"))
            .count();
        assert_eq!(
            layering,
            usize::from(breaks),
            "{rel}: {:?}",
            whole.violations
        );
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
fn census_check_and_hooks_agree_on_reexports() {
    let dir = repo();
    let r = dir.path();
    let (_, census) = run(r, &["census", "--json", "--all-outliers"], None);
    let v: Value = serde_json::from_str(&census).unwrap();
    let app = v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["signal"] == "import:packages/app")
        .expect("core avoids app");
    assert_eq!(app["tier"], "default");
    let paths: Vec<&str> = app["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, breakers());
    let id = app["id"].as_str().unwrap().to_string();

    run(r, &["init"], None);
    run(r, &["review", "--block", &id], None);
    assert_eq!(
        run(r, &["check"], None).0,
        0,
        "the legacy code is baselined"
    );
    run(r, &["hook", "claude", "SessionStart"], Some(&json!({ "session_id": "s1", "cwd": r, "hook_event_name": "SessionStart", "source": "startup" }).to_string()));

    // New type-only imports and re-exports pass check and the hook.
    let new_types = "packages/core/src/new-types.ts";
    write(
        r,
        new_types,
        "import type { Session } from '@x/app';\nexport type { Session as S } from '../../app/src/types';\nexport { type Session as T } from '../../app/src/types';\nexport let s: Session | undefined;\n",
    );
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 0, "{out}");
    let hooked = post_edit(r, new_types);
    assert!(
        hooked.as_ref().is_none_or(|h| !h.to_string().contains(&id)),
        "{hooked:?}"
    );

    // Each new value re-export fails both.
    for (rel, body) in [
        (
            "packages/core/src/new-named.ts",
            "export { app as a } from '@x/app';\n",
        ),
        (
            "packages/core/src/new-all.ts",
            "export * from '../../app/src/types';\n",
        ),
        (
            "packages/core/src/new-ns.ts",
            "export * as a from '../../app/src/types';\n",
        ),
    ] {
        write(r, rel, body);
        let (code, out) = run(r, &["check"], None);
        assert_eq!(code, 1, "{rel}: {out}");
        assert!(out.contains(&id) && out.contains(rel), "{rel}: {out}");
        let hooked = post_edit(r, rel);
        assert!(
            hooked.as_ref().is_some_and(|h| h.to_string().contains(&id)),
            "{rel}: {hooked:?}"
        );
        std::fs::remove_file(r.join(rel)).unwrap();
    }
}

/// Python is consistent: `from app.x import *` in an `__init__` (Python's re-export)
/// is an import statement, so it breaks the rule like any other import, and an
/// import under `if TYPE_CHECKING:` (Python's type-only import) does not.
#[test]
fn python_star_reexports_break_layering_rules_and_type_checking_imports_do_not() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"x\"\n");
    write(r, "core/__init__.py", "");
    write(r, "app/__init__.py", "");
    for i in 0..200 {
        write(r, &format!("core/c{i}.py"), &format!("C{i} = {i}\n"));
    }
    for i in 0..30 {
        write(
            r,
            &format!("app/x{i}.py"),
            &format!("from core.c{i} import C{i}\n\nX{i} = C{i}\n"),
        );
    }
    let star = "core/star/__init__.py";
    let named = "core/named/__init__.py";
    let plain = "core/plain.py";
    let typed = "core/typed.py";
    write(r, star, "from app.x1 import *\n");
    write(r, named, "from app.x2 import X2\n\n__all__ = [\"X2\"]\n");
    write(
        r,
        plain,
        "from app.x3 import X3\n\n\ndef f():\n    return X3\n",
    );
    write(
        r,
        typed,
        "from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from app.x4 import X4\n\n\ndef f(x: \"X4\") -> None:\n    return None\n",
    );
    let (facts, _) = drift_py::scan(
        r,
        &drift_py::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let mined = mine(&facts, &MineOptions::default());
    let mut want = vec![named, plain, star];
    want.sort_unstable();
    assert_eq!(outliers(avoid(&mined.candidates, "app")), want);
}
