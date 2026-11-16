//! `drift security --json` lists the routes of Quart, django-ninja, Litestar and
//! Sanic applications, each with what stands before it: a guard, unknown, or none.
//! The applications are drift-py's (`crates/drift-py/tests/gap_py_adapters_a/`).

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn copy(from: &Path, to: &Path) {
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let target = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
            copy(&e.path(), &target);
        } else {
            std::fs::copy(e.path(), target).unwrap();
        }
    }
}

/// `METHOD route` of each http entry point, with `guarded`, `unknown` or `no guard`.
fn inventory(name: &str) -> BTreeMap<String, &'static str> {
    let dir = tempfile::tempdir().unwrap();
    let from = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../drift-py/tests/gap_py_adapters_a")
        .join(name);
    copy(&from, dir.path());
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(["security", "--json"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let inv: Value = serde_json::from_slice(&out.stdout).unwrap();
    let mut said = BTreeMap::new();
    for e in inv["entry_points"].as_array().into_iter().flatten() {
        if e["kind"] != "http" {
            continue;
        }
        let some = |k: &str| e[k].as_array().is_some_and(|a| !a.is_empty());
        let state = if some("guards") {
            "guarded"
        } else if some("opaque") {
            "unknown"
        } else {
            "no guard"
        };
        said.insert(
            format!(
                "{} {}",
                e["method"].as_str().unwrap_or_default(),
                e["route"].as_str().unwrap_or_default()
            ),
            state,
        );
    }
    said
}

fn expect(name: &str, want: &[(&str, &[&str])]) {
    let said = inventory(name);
    for (route, states) in want {
        let got = said.get(*route).copied();
        assert!(
            got.is_some_and(|g| states.contains(&g)),
            "{name}: `{route}` is {got:?}, want one of {states:?}; all: {said:#?}"
        );
    }
}

/// A guard whose body is read, or one that is named and not: never "no guard".
const STANDS: &[&str] = &["guarded", "unknown"];
const NONE: &[&str] = &["no guard"];

#[test]
fn quart_routes_are_listed_with_their_guards() {
    expect(
        "quart",
        &[
            ("GET /health", NONE),
            ("GET /api/items/<int:item_id>", STANDS),
            ("POST /api/items", NONE),
        ],
    );
}

#[test]
fn ninja_routes_are_listed_with_their_auth() {
    // What an `auth` callable decides is not read: unknown, never a pass.
    expect(
        "ninja",
        &[
            ("GET /api/items/{item_id}", &["unknown"]),
            ("POST /api/items", NONE),
            ("GET /api/health", NONE),
        ],
    );
}

#[test]
fn litestar_routes_are_listed_with_their_guards() {
    expect(
        "litestar",
        &[
            ("GET /health", NONE),
            ("GET /items/{item_id:int}", STANDS),
            ("POST /items", NONE),
            ("GET /admin/stats", STANDS),
        ],
    );
}

#[test]
fn sanic_routes_are_listed_with_their_guards() {
    expect(
        "sanic",
        &[
            ("GET /api/items/<item_id:int>", STANDS),
            ("GET /api/items", NONE),
            ("POST /api/items", NONE),
        ],
    );
}
