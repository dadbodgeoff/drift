//! `drift security` covers production code only: examples, samples, demos,
//! playgrounds, fixtures, tests and integration-test suites are left out, as
//! mining and `check` leave them out.

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

/// An unguarded Next.js route that evaluates request data and reads an env var.
const ROUTE: &str = "export async function POST(req: Request) {\n  const body = await req.text();\n  eval(body);\n  return Response.json({ key: process.env.SECRET_KEY });\n}\n";

#[test]
fn security_leaves_out_non_production_code() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    // Production.
    write(r, "app/api/run/route.ts", ROUTE);
    // A route folder that is merely named like a demo, deep in the app, is production.
    write(r, "app/examples/api/route.ts", ROUTE);
    // Demonstration code: a top-level examples/playground directory and a sample package.
    write(r, "examples/next/app/api/run/route.ts", ROUTE);
    write(r, "playground/app/api/run/route.ts", ROUTE);
    write(
        r,
        "samples/basic/package.json",
        "{ \"name\": \"basic-sample\" }",
    );
    write(r, "samples/basic/app/api/run/route.ts", ROUTE);
    // Tests and fixtures.
    write(r, "tests/fixtures/app/api/run/route.ts", ROUTE);
    write(r, "src/__fixtures__/app/api/run/route.ts", ROUTE);
    // An integration-test suite: standalone tests plus the app they drive.
    write(r, "integration/app/api/run/route.ts", ROUTE);
    write(
        r,
        "integration/run.spec.ts",
        "export const t = () => fetch(\"/api/run\");\n",
    );

    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let inv: Value = serde_json::from_slice(&out.stdout).unwrap();

    let paths = |key: &str| -> Vec<String> {
        let mut v: Vec<String> = inv[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["path"].as_str().unwrap().to_string())
            .collect();
        v.sort();
        v.dedup();
        v
    };
    let production = ["app/api/run/route.ts", "app/examples/api/route.ts"];
    assert_eq!(paths("entry_points"), production);
    assert_eq!(paths("sinks"), production);
    assert_eq!(
        inv["env"]["process.env.SECRET_KEY"],
        serde_json::json!(production)
    );
    // Leaving them out is not silent: tests are not counted, the rest are.
    assert_eq!(inv["left_out"]["files"], 4);
    assert_eq!(
        inv["left_out"]["dirs"],
        serde_json::json!(["examples/", "integration/", "playground/", "samples/"])
    );
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security"])
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(
        text.contains(
            "4 files in non-production paths (examples/, integration/, playground/, ...) left out"
        ),
        "{text}"
    );
    // Nothing was written into the repository.
    assert!(!r.join(".drift").exists());
}

/// A command-line program has no remote caller: it is in the inventory, marked local, once
/// (a console script naming an argparse `main` is one entry point), and neither counted
/// nor listed as having no guard. The headline says how many were left out and why.
#[test]
fn security_does_not_count_local_commands_as_unguarded() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\nversion = \"0\"\ndependencies = [\"fastapi\"]\n[project.scripts]\nacme-report = \"tools.report:main\"\n",
    );
    write(r, "tools/__init__.py", "");
    write(
        r,
        "tools/report.py",
        "import argparse\nimport subprocess\n\ndef main():\n    p = argparse.ArgumentParser()\n    args = p.parse_args()\n    subprocess.run(args.cmd, shell=True)\n\nif __name__ == \"__main__\":\n    main()\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get(\"/items\")\ndef items():\n    return []\n",
    );
    let run = |args: &[&str]| {
        let out = Command::new(&*BIN)
            .arg("--no-cache")
            .args(args)
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };
    let inv: Value = serde_json::from_str(&run(&["security", "--json"])).unwrap();
    let rows: Vec<(String, String, bool)> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["path"].as_str().unwrap().to_string(),
                e["kind"].as_str().unwrap().to_string(),
                e["local"].as_bool().unwrap_or(false),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("app/main.py".to_string(), "http".to_string(), false),
            ("tools/report.py".to_string(), "cli".to_string(), true),
        ]
    );
    assert!(
        inv["entry_points"][0].get("local").is_none(),
        "absent when false"
    );
    let text = run(&["security"]);
    assert!(
        text.starts_with(
            "2 entry points (1 where Drift found no guard in what it read, 1 cli not counted: run locally, no remote caller, "
        ),
        "{text}"
    );
    let bare = &text[text
        .find("\nEntry points where Drift found no guard\n")
        .unwrap()..];
    assert!(bare.contains("http GET /items"), "{bare}");
    assert!(!bare.contains("cli main"), "{bare}");
    let card = run(&["card", "tools/report.py"]);
    assert!(
        card.contains("[cli] main: run locally, no remote caller"),
        "{card}"
    );
}
