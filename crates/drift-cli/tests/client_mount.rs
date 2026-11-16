//! A transport mounted on an HTTP client is no application mounted on a server.
//!
//! `session.mount("https://", adapter)` (requests) is written as Starlette's
//! `app.mount("/v1", sub)` is. Read as a mount of an application Drift could not
//! name, it put every route of the project under a prefix that is not known
//! (`/?/items`): no route could be matched with a gateway, a test or another
//! listing. What a client's transport is mounted under is a URL with a scheme; a
//! path an application is served under has none.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn routes(root: &Path) -> BTreeSet<String> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str().map(String::from))
        .collect()
}

fn repo(client: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "fastapi\nrequests\n"),
        ("app/__init__.py", ""),
        (
            "app/main.py",
            "from fastapi import APIRouter, FastAPI\n\nrouter = APIRouter()\n\n\n@router.get(\"/items\")\ndef items():\n    return []\n\n\napp = FastAPI()\napp.include_router(router, prefix=\"/api\")\n",
        ),
        ("app/client.py", client),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

#[test]
fn a_transport_mounted_on_a_client_leaves_every_route_where_it_is() {
    let dir = repo(
        "import requests\nfrom requests.adapters import HTTPAdapter\n\n\ndef fetch(url):\n    session = requests.Session()\n    session.mount(\"https://\", HTTPAdapter(max_retries=3))\n    return session.get(url)\n",
    );
    assert_eq!(
        routes(dir.path()),
        BTreeSet::from(["/api/items".to_string()])
    );
}

/// An application mounted under a path, built where it is mounted, is still one
/// Drift cannot name: the routes of the project may be served under it.
#[test]
fn an_application_mounted_under_a_path_is_still_not_followed() {
    let dir =
        repo("from app.main import app\n\n\ndef build(make):\n    app.mount(\"/v2\", make(app))\n");
    let got = routes(dir.path());
    assert!(got.iter().any(|r| r.contains('?')), "{got:?}");
}
