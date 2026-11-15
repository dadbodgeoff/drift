//! Mining's input is held at the entry points of the last build whose mined proposals
//! were measured (`drift_core::Listed`): a listing made since is in `drift security`
//! and the practice map, and changes nothing `drift census` reads.

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

fn drift(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// The opt-in census as the in-sample study digests it: without the build and the place.
fn census(root: &Path) -> Value {
    let mut v = drift(
        root,
        &[
            "--no-cache",
            "census",
            "--json",
            "--max",
            "15",
            "--python-proposals",
        ],
    );
    let o = v.as_object_mut().unwrap();
    o.remove("commit");
    o.remove("root");
    v
}

/// `(route, guards)` of every HTTP entry point `drift security` lists.
fn routes(root: &Path) -> Vec<(String, Vec<String>)> {
    let v = drift(root, &["--no-cache", "security", "--json"]);
    let mut out: Vec<(String, Vec<String>)> = v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "http")
        .map(|e| {
            let guards = e["guards"].as_array().unwrap().iter();
            (
                e["route"].as_str().unwrap().to_string(),
                guards.map(|g| g.as_str().unwrap().to_string()).collect(),
            )
        })
        .collect();
    out.sort();
    out
}

const VIEWS: [&str; 8] = [
    "orders",
    "invoices",
    "refunds",
    "carts",
    "coupons",
    "returns",
    "shipments",
    "payments",
];

/// A Django project of eight views, with `urls` as its root URLconf.
fn django(root: &Path, urls: &str) {
    write(
        root,
        "pyproject.toml",
        "[project]\nname = \"shop\"\nversion = \"0.1.0\"\ndependencies = [\"django\"]\n",
    );
    write(root, "proj/__init__.py", "");
    write(
        root,
        "proj/settings.py",
        "ROOT_URLCONF = \"proj.urls\"\nMIDDLEWARE = [\"django.middleware.common.CommonMiddleware\"]\n",
    );
    write(root, "proj/urls.py", urls);
    write(root, "shop/__init__.py", "");
    let mut views = String::from(
        "from django.contrib.auth.decorators import login_required\nfrom django.http import JsonResponse\n\n",
    );
    for v in VIEWS {
        views.push_str(&format!(
            "@login_required\ndef {v}(request):\n    return JsonResponse({{\"{v}\": request.GET.get(\"page\")}})\n\n\n"
        ));
    }
    write(root, "shop/views.py", &views);
}

fn paths() -> String {
    VIEWS
        .iter()
        .map(|v| format!("    path(\"{v}/\", views.{v}),\n"))
        .collect()
}

/// Patterns written as arguments of `i18n_patterns(...)` are served under a language
/// code Drift does not read: a registration it cannot place, and one the measured
/// build did not list. `drift security` lists each view under `/?/`; `drift census`
/// reads the repository as if the views were routed nowhere, which is how the
/// measured build read it. That this says something: the same views in a plain
/// `urlpatterns` list, which the measured build did read, give another census.
#[test]
fn a_registration_drift_cannot_place_is_listed_and_leaves_the_census_unchanged() {
    let import = "from django.urls import path\n\nfrom shop import views\n\n";
    let (i18n, none, list) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    django(
        i18n.path(),
        &format!(
            "from django.conf.urls.i18n import i18n_patterns\n{import}urlpatterns = i18n_patterns(\n{})\n",
            paths()
        ),
    );
    django(none.path(), "urlpatterns = []\n");
    django(
        list.path(),
        &format!("{import}urlpatterns = [\n{}]\n", paths()),
    );

    let listed = routes(i18n.path());
    assert_eq!(listed.len(), VIEWS.len(), "{listed:?}");
    assert!(
        listed.iter().all(|(route, guards)| route.starts_with("/?/")
            && guards == &["contrib.auth.decorators.login_required"]),
        "{listed:?}"
    );
    assert!(routes(none.path()).is_empty());

    assert_eq!(census(i18n.path()), census(none.path()));
    assert_ne!(census(list.path()), census(none.path()));
}

/// A router mounted behind a guard and also handed on where no mount is read
/// (`ALL = [router]`) may be mounted once more, unguarded: `drift security` lists
/// each route twice, the unread mount under `/?/` with no guard. Mining still reads
/// each handler as the measured build did: one entry point, guarded by its mount.
#[test]
fn a_router_handed_on_is_listed_twice_and_mined_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"api\"\nversion = \"0.1.0\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/auth.py",
        "from fastapi import Header, HTTPException\n\n\ndef require_key(x_key: str = Header()):\n    if x_key != \"k\":\n        raise HTTPException(status_code=401)\n",
    );
    write(
        r,
        "app/routes.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/orders\")\ndef orders():\n    return []\n",
    );
    write(
        r,
        "app/main.py",
        "from fastapi import Depends, FastAPI\n\nfrom app.auth import require_key\nfrom app.routes import router\n\napp = FastAPI()\napp.include_router(router, prefix=\"/v1\", dependencies=[Depends(require_key)])\nALL = [router]\n",
    );

    assert_eq!(
        routes(r),
        [
            ("/?/orders".to_string(), vec![]),
            ("/v1/orders".to_string(), vec!["require_key".to_string()]),
        ]
    );

    let facts = drift(r, &["--no-cache", "scan", "--json"]);
    let file = facts["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "app/routes.py")
        .unwrap();
    let symbol = |symbols: &Value| {
        let all = symbols.as_array().unwrap().iter();
        all.clone().find(|s| s["name"] == "orders").unwrap().clone()
    };
    let route = |entries: &Value| -> Vec<String> {
        let all = entries.as_array().unwrap().iter();
        all.map(|e| e["route"].as_str().unwrap().to_string())
            .collect()
    };
    // What mining reads.
    assert_eq!(route(&file["entry_points"]), ["/v1/orders"]);
    assert_eq!(
        symbol(&file["symbols"])["wraps"][0]["wrapper"],
        "app/auth.py#require_key"
    );
    // What `drift security` and the practice map read.
    let listed = &file["listed"];
    assert_eq!(route(&listed["entry_points"]), ["/?/orders", "/v1/orders"]);
    assert_eq!(symbol(&listed["symbols"])["wraps"], serde_json::json!([]));
}
