//! Three things `drift security` says so that what it lists can be trusted and read
//! top down:
//!
//! - a Django `urlpatterns` that unpacks other pattern lists (`[*a_urls, *b_urls]`)
//!   lists their routes, which the last measured build dropped without a word;
//! - a registration written as a route is that no listing accounts for is said to
//!   be not listed, by file and line, in the text and in `--json`;
//! - entry points reaching a risky operation are ordered by what most needs a
//!   person's eye: no guard found first, then where it is reachable from.
//!
//! And `--fail-on`, which makes `drift security --diff-base` exit 1 on what a
//! person named, and only then.

use std::path::Path;
use std::process::{Command, Stdio};

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

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
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

fn json(root: &Path, args: &[&str]) -> Value {
    let (code, out, err) = drift(root, args);
    assert_eq!(code, 0, "{err}");
    serde_json::from_str(&out).unwrap()
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n";

#[test]
fn pattern_lists_unpacked_into_urlpatterns_are_listed() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "manage.py",
        "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"depot.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n",
    );
    write(r, "requirements.txt", "django\n");
    write(r, "depot/__init__.py", "");
    write(
        r,
        "depot/settings.py",
        "SECRET_KEY = \"x\"\nROOT_URLCONF = \"depot.urls\"\nINSTALLED_APPS = []\nMIDDLEWARE = []\n",
    );
    write(
        r,
        "depot/views.py",
        "from django.http import JsonResponse\n\n\ndef crates(request):\n    return JsonResponse({})\n\n\ndef pallets(request):\n    return JsonResponse({})\n\n\ndef health(request):\n    return JsonResponse({})\n",
    );
    write(
        r,
        "depot/urls/__init__.py",
        "from django.urls import path\n\nfrom depot import views\n\nfrom .crates import urlpatterns as crate_urls\nfrom .pallets import urlpatterns as pallet_urls\n\nlocal_urls = [path(\"health/\", views.health)]\n\nurlpatterns = [\n    *crate_urls,\n    *pallet_urls,\n    *local_urls,\n]\n",
    );
    write(
        r,
        "depot/urls/crates.py",
        "from django.urls import path\n\nfrom depot import views\n\nurlpatterns = [path(\"crates/\", views.crates)]\n",
    );
    write(
        r,
        "depot/urls/pallets.py",
        "from django.urls import path\n\nfrom depot import views\n\nurlpatterns = [path(\"pallets/\", views.pallets)]\n",
    );
    let inv = json(r, &["security", "--json"]);
    let mut routes: Vec<String> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str().map(String::from))
        .collect();
    routes.sort();
    assert_eq!(routes, ["/crates", "/health", "/pallets"]);
}

#[test]
fn a_registration_no_listing_accounts_for_is_said_to_be_unlisted() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PACKAGE);
    // `api` is a parameter no call in the file hands a router, and of no type the
    // lowering knows: what registers on it is not read.
    write(
        r,
        "src/routes.ts",
        "export function mount(api: any) {\n  api.get(\"/hidden\", (req: any, res: any) => {\n    res.json({});\n  });\n}\n",
    );
    write(
        r,
        "src/server.ts",
        "import express from \"express\";\n\nconst app = express();\napp.get(\"/seen\", (req, res) => {\n  res.json({});\n});\n",
    );
    let inv = json(r, &["security", "--json"]);
    let routes: Vec<&str> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str())
        .collect();
    assert_eq!(routes, ["/seen"]);
    assert_eq!(
        inv["unlisted"],
        serde_json::json!([{ "path": "src/routes.ts", "line": 2, "reason": "receiver_not_read" }])
    );
    let (_, text, _) = drift(r, &["security"]);
    assert!(
        text.contains("1 place(s) that look served are NOT LISTED")
            && text.contains("src/routes.ts:2"),
        "{text}"
    );
}

#[test]
fn what_reaches_a_risky_operation_is_listed_by_what_needs_a_look_first() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PACKAGE);
    write(
        r,
        "src/auth.ts",
        "import { Request, Response, NextFunction } from \"express\";\n\nexport function requireUser(req: Request, res: Response, next: NextFunction) {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"sign in\" });\n    return;\n  }\n  next();\n}\n",
    );
    // In the file, the guarded route comes first; in the list, the one with no
    // guard does.
    write(
        r,
        "src/server.ts",
        "import express from \"express\";\nimport { requireUser } from \"./auth\";\n\nconst app = express();\n\napp.post(\"/a-guarded\", requireUser, (req, res) => {\n  eval(req.body.code);\n  res.json({});\n});\n\napp.post(\"/b-open\", (req, res) => {\n  eval(req.body.code);\n  res.json({});\n});\n",
    );
    let (_, text, _) = drift(r, &["security"]);
    let section = text
        .split("Entry points reaching risky operations")
        .nth(1)
        .unwrap_or_else(|| panic!("{text}"));
    let (open, guarded) = (
        section.find("/b-open").unwrap(),
        section.find("/a-guarded").unwrap(),
    );
    assert!(open < guarded, "{section}");
}

#[test]
fn fail_on_fails_the_run_only_on_what_was_named() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PACKAGE);
    write(
        r,
        "src/server.ts",
        "import express from \"express\";\n\nexport const app = express();\napp.get(\"/health\", (req, res) => {\n  res.json({});\n});\n",
    );
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "base"]);
    git(r, &["checkout", "-q", "-b", "pr"]);
    write(
        r,
        "src/server.ts",
        "import express from \"express\";\n\nexport const app = express();\napp.get(\"/health\", (req, res) => {\n  res.json({});\n});\napp.post(\"/run\", (req, res) => {\n  eval(req.body.code);\n  res.json({});\n});\n",
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "change"]);
    // Facts for review, as before: exit 0.
    let (code, _, _) = drift(r, &["security", "--diff-base", "main"]);
    assert_eq!(code, 0);
    // A kind the change does not introduce: exit 0.
    let (code, _, _) = drift(r, &["security", "--diff-base", "main", "--fail-on", "leak"]);
    assert_eq!(code, 0);
    // The kinds it does: exit 1, and stderr says which.
    for kinds in ["risky", "unguarded-reaching,leak", "any"] {
        let (code, _, err) = drift(r, &["security", "--diff-base", "main", "--fail-on", kinds]);
        assert_eq!(code, 1, "{kinds}: {err}");
        assert!(err.contains("failing as asked"), "{err}");
    }
    // A name that is none of the kinds is an error, never a pass.
    let (code, _, err) = drift(
        r,
        &["security", "--diff-base", "main", "--fail-on", "everything"],
    );
    assert_eq!(code, 2, "{err}");
}
