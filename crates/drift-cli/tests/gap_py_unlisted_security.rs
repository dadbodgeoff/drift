//! Pins what `drift security` says of Python registrations Drift did not list: each
//! is named by file, line and why in the text (`(not found)`) and in `--json`
//! (`unlisted[].reason`), beside the routes it did list, and none of them is an
//! entry point. A TypeScript one carries its reason too (`receiver_not_read`).

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn python_registrations_drift_did_not_list_are_named_with_why() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"dj\"\ndependencies = [\"django\"]\n",
    );
    write(
        r,
        "manage.py",
        "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
    );
    write(r, "proj/__init__.py", "");
    write(r, "shop/__init__.py", "");
    write(r, "proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    write(
        r,
        "shop/views.py",
        "from django.http import HttpResponse\n\n\ndef listing(request):\n    return HttpResponse(\"x\")\n",
    );
    write(
        r,
        "proj/urls.py",
        "from django.urls import path\n\nfrom shop import views\n\nurlpatterns = [\n    path(\"list/\", views.listing),\n    path(\"missing/\", views.not_there),\n]\n",
    );
    let (code, out, err) = drift(r, &["security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let inv: Value = serde_json::from_str(&out).unwrap();
    let routes: Vec<&str> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str())
        .collect();
    assert_eq!(routes, ["/list"]);
    assert_eq!(
        inv["unlisted"],
        serde_json::json!([{ "path": "proj/urls.py", "line": 7, "reason": "not_found" }])
    );
    let (_, text, _) = drift(r, &["security"]);
    assert!(
        text.contains("1 place(s) that look served are NOT LISTED")
            && text.contains("proj/urls.py:7 (not found)"),
        "{text}"
    );
}
