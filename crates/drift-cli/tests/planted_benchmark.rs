//! The planted-vulnerability benchmark (`eval/security/planted`).
//!
//! Eighteen vulnerabilities in common shapes and one control. `expected.json` says
//! what `drift security --json` reports of each; this test holds the build to it,
//! both ways: a find that is lost fails, and so does a miss that is found, until
//! the file says what the build does. The score in the fixture's README is then
//! the build's, not a claim.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eval/security/planted")
}

#[test]
fn the_build_finds_what_the_manifest_says_it_finds() {
    // A copy: the scan writes nothing, and a copy keeps it so whatever the
    // fixture's place in the repository is.
    let dir = tempfile::tempdir().unwrap();
    for rel in ["package.json", "app.ts", "py/app.py", "py/requirements.txt"] {
        let to = dir.path().join(rel);
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::copy(fixture().join(rel), to).unwrap();
    }
    let expected: Value =
        serde_json::from_str(&std::fs::read_to_string(fixture().join("expected.json")).unwrap())
            .unwrap();
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let inventory: Value = serde_json::from_slice(&out.stdout).unwrap();
    let listed: BTreeSet<(String, String, String)> = inventory["sinks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            let text = |k: &str| s[k].as_str().unwrap().to_string();
            (text("path"), text("symbol"), text("kind"))
        })
        .collect();
    let text = |v: &Value, k: &str| v[k].as_str().unwrap().to_string();
    let (mut found, mut wrong) = (0, Vec::new());
    let cases = expected["cases"].as_array().unwrap();
    for c in cases {
        let is = listed.contains(&(text(c, "path"), text(c, "symbol"), text(c, "kind")));
        match (c["expect"].as_str().unwrap(), is) {
            ("found", true) => found += 1,
            ("missed", false) => {}
            ("found", false) => wrong.push(format!("{}: no longer found", text(c, "id"))),
            ("missed", true) => wrong.push(format!(
                "{}: found now; say so in expected.json and in the README's score",
                text(c, "id")
            )),
            (other, _) => panic!("{}: expect is `{other}`", text(c, "id")),
        }
    }
    for c in expected["safe"].as_array().unwrap() {
        if listed
            .iter()
            .any(|(path, symbol, _)| *path == text(c, "path") && *symbol == text(c, "symbol"))
        {
            wrong.push(format!("{}: a control is flagged", text(c, "id")));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}\nlisted: {listed:#?}");
    // The score the README states.
    assert_eq!((found, cases.len()), (16, 18));
}

/// A property written under a key read off a parameter (`target[key] = value`,
/// `setattr(target, name, value)`) is a risk where a request chooses the key. In
/// a helper the parameter is whatever its callers pass: the write is listed where
/// an entry point reaches it with a value each call handed on, and nowhere else.
#[test]
fn a_write_under_a_key_is_listed_only_where_a_request_reaches_it() {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/store.ts",
            "export function put(target: any, key: string, value: unknown) {\n  target[key] = value;\n}\n\nexport function remember(cache: any, key: string, value: unknown) {\n  cache[key] = value;\n}\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { put, remember } from \"./store\";\n\nconst app = express();\nconst settings: any = {};\nconst cache: any = {};\n\napp.post(\"/settings\", (req, res) => {\n  put(settings, req.body.key, req.body.value);\n  res.json(settings);\n});\n\napp.get(\"/warm\", (req, res) => {\n  remember(cache, \"started\", Date.now());\n  res.json({ ok: true });\n});\n\nexport default app;\n",
        ),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success());
    let inventory: Value = serde_json::from_slice(&out.stdout).unwrap();
    let writes: Vec<&str> = inventory["sinks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["kind"] == "dynamic_key_write")
        .map(|s| s["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(writes, ["put"], "{inventory:#}");
}
