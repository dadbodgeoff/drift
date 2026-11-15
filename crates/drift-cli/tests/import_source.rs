//! Import-source rules end to end on Python (the reviews of PR #35): a helper is the
//! team's version of a library function only when it passes its own parameters to
//! every library call of its name. A helper that forwards to an in-repo `session.get`
//! and also reads `os.environ.get`, one that calls `asyncio.run` and
//! `subprocess.run`, and a recursive `dumps` that calls `json.dumps` on a string it
//! builds are no versions of what they call, however many members use them.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

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

/// `helper` is `app/util.py`, defining `name`; 38 functions in eight modules call it
/// and 2 call `library` (`json.dumps`, `requests.get`) themselves.
fn repo(helper: &str, name: &str, import: &str, library: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "app/__init__.py", "");
    write(r, "app/util.py", helper);
    for f in 0..8 {
        write(r, &format!("app/m{f}/__init__.py"), "");
        let mut body = format!("{import}\nfrom app.util import {name}\n\n");
        for i in 0..5 {
            let call = if f * 5 + i < 2 {
                format!("{library}(x)")
            } else {
                format!("{name}(x)")
            };
            body.push_str(&format!("\ndef f{f}x{i}(x):\n    return {call}\n\n"));
        }
        write(r, &format!("app/m{f}/flow{f}.py"), &body);
    }
    for i in 0..60 {
        write(
            r,
            &format!("other/o{i:02}.py"),
            &format!("def o{i}():\n    return {i}\n"),
        );
    }
    dir
}

fn imports_from(root: &Path) -> Vec<String> {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(["census", "--json", "--no-cache", "--max", "1000"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "census failed");
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["rule"]["type"] == "imports_from")
        .map(|p| p["summary"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_forwarding_wrapper_is_the_team_version() {
    let r = repo(
        "import requests\n\n\ndef get(url, **kwargs):\n    return requests.get(url, **kwargs)\n",
        "get",
        "import requests",
        "requests.get",
    );
    let found = imports_from(r.path());
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(
        found[0].ends_with("use the team's `get` (app/util.py), not `requests.get`"),
        "{found:?}"
    );
}

#[test]
fn one_unforwarded_same_name_library_call_is_no_team_version() {
    // The re-check's probe: `session.get` (in-repo) gets the parameters,
    // `os.environ.get` does not.
    let helper = "import os\n\nimport requests\n\nsession = requests.Session()\n\n\ndef get(url, **kwargs):\n    kwargs.setdefault(\"timeout\", float(os.environ.get(\"HTTP_TIMEOUT\", \"10\")))\n    return session.get(url, **kwargs)\n";
    let r = repo(helper, "get", "import os", "os.environ.get");
    assert_eq!(imports_from(r.path()), Vec::<String>::new());
    // `asyncio.run` is not forwarded; `subprocess.run` is.
    let helper = "import asyncio\nimport subprocess\n\n\nasync def _warm():\n    return None\n\n\ndef run(cmd):\n    asyncio.run(_warm())\n    return subprocess.run(cmd, check=True)\n";
    let r = repo(helper, "run", "import asyncio", "asyncio.run");
    assert_eq!(imports_from(r.path()), Vec::<String>::new());
}

#[test]
fn a_recursive_helper_is_no_team_version_of_its_namesake() {
    let helper = "import json\n\n\ndef dumps(obj, depth=0):\n    if depth:\n        return dumps(obj, depth - 1)\n    return json.dumps(str(obj))\n";
    let r = repo(helper, "dumps", "import json", "json.dumps");
    assert_eq!(imports_from(r.path()), Vec::<String>::new());
}
