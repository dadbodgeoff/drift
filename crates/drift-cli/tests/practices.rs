//! `drift practices`: the practice map, read-only (PLAN-R13 §4). It writes nothing, exits
//! 0, checks its scope, and has no promote command (deferred, round 13).

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..12 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> (bool, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.success(),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const CONCERNS: &[&str] = &[
    "authn",
    "authz",
    "errors",
    "logging",
    "api",
    "validation",
    "config",
    "data_access",
    "testing",
];

#[test]
fn json_is_version_1_and_nothing_is_written() {
    let dir = repo();
    let r = dir.path();
    let (ok, out, err) = drift(r, &["practices", "--json"]);
    assert!(ok, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["version"], 1);
    assert_eq!(v["facts_schema"], 11);
    assert_eq!(v["scope"]["concern"], Value::Null);
    assert_eq!(v["summary"]["target"], 0.9);
    for c in v["concerns"].as_array().unwrap() {
        assert!(CONCERNS.contains(&c["id"].as_str().unwrap()), "{c}");
        let p = &c["population"];
        assert_eq!(
            p["total"].as_u64().unwrap(),
            p["known"].as_u64().unwrap()
                + p["none"].as_u64().unwrap()
                + p["unknown"].as_u64().unwrap(),
            "{c}"
        );
    }
    assert!(!v["not_covered"].as_array().unwrap().is_empty());
    // Read-only, as `drift map`: no .drift directory, no fact cache.
    assert!(!r.join(".drift").exists());
    // The same bytes twice.
    let (_, again, _) = drift(r, &["practices", "--json"]);
    assert_eq!(again, out);
}

#[test]
fn scope_is_checked_and_echoed() {
    let dir = repo();
    let r = dir.path();
    let (ok, out, err) = drift(
        r,
        &[
            "practices",
            "--json",
            "--concern",
            "authn",
            "--package",
            ".",
            "--path",
            "app/api/r01/route.ts",
        ],
    );
    assert!(ok, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["scope"]["concern"], "authn");
    assert_eq!(v["scope"]["package"], ".");
    assert_eq!(v["scope"]["path"], "app/api/r01/route.ts");
    assert!(
        v["concerns"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["id"] == "authn")
    );
    let (ok, _, err) = drift(r, &["practices", "--concern", "auth"]);
    assert!(!ok);
    assert!(
        err.contains("no concern `auth`") && err.contains("data_access"),
        "{err}"
    );
    let (ok, _, err) = drift(r, &["practices", "--package", "apps/nope"]);
    assert!(!ok);
    assert!(err.contains("no package `apps/nope`"), "{err}");
    let (ok, _, err) = drift(r, &["practices", "--path", "app/api/nope.ts"]);
    assert!(!ok);
    assert!(err.contains("was not scanned"), "{err}");
}

#[test]
fn text_says_facts_not_rules() {
    let dir = repo();
    let r = dir.path();
    let (ok, out, err) = drift(r, &["practices"]);
    assert!(ok, "{err}");
    assert!(out.starts_with("Practices (facts, not rules): "), "{out}");
    assert!(out.contains("Not covered yet: "), "{out}");
}

#[test]
fn there_is_no_promote_command_and_all_gives_the_tables() {
    let dir = repo();
    let r = dir.path();
    let (ok, _, _) = drift(r, &["practices", "promote", "P-000000"]);
    assert!(!ok, "promotion is deferred");
    let (ok, out, err) = drift(r, &["practices", "--all"]);
    assert!(ok, "{err}");
    assert!(out.starts_with("Practices (facts, not rules): "), "{out}");
    let (ok, out, err) = drift(r, &["practices", "--json"]);
    assert!(ok, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(v["recipes"].is_array() && v["findings"].is_array(), "{v}");
}

#[test]
fn units_need_json_and_are_listed_with_it() {
    let dir = repo();
    let r = dir.path();
    let (ok, _, _) = drift(r, &["practices", "--units"]);
    assert!(!ok, "--units requires --json");
    let (ok, out, err) = drift(r, &["practices", "--json", "--units"]);
    assert!(ok, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    for c in v["concerns"].as_array().unwrap() {
        let total = c["population"]["total"].as_u64().unwrap() as usize;
        let units = c["units"].as_array().map_or(0, |u| u.len());
        assert_eq!(units, total, "{c}");
    }
}

/// A liveness or readiness probe is public on purpose: a `GET` on a well-known probe
/// path, alone or under a mount prefix, whose handler reads no input is the variant
/// "opens probe", not "no guard". The path and the absence of input decide, in Python
/// and in TypeScript; a handler's name does not.
#[test]
fn a_probe_that_reads_no_input_is_recorded_as_open() {
    let dir = repo();
    let r = dir.path();
    write(
        r,
        "app/api/health/route.ts",
        "export async function GET() {\n  return Response.json({ ok: true });\n}\n",
    );
    write(
        r,
        "app/api/ping/route.ts",
        "export async function GET() {\n  return Response.json({ ok: true });\n}\n",
    );
    write(r, "svc/requirements.txt", "fastapi\n");
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/billing/health\")\ndef status():\n    return {\"status\": \"ok\"}\n\n\n@app.get(\"/readyz\")\nasync def ready():\n    return {\"ready\": True}\n\n\n@app.get(\"/health/{name}\")\ndef health_check(name: str):\n    return {\"name\": name}\n\n\n@app.get(\"/health\")\ndef health_of(tenant: str):\n    return {\"tenant\": tenant}\n\n\n@app.post(\"/healthz\")\ndef healthz():\n    return {}\n",
    );
    let (ok, out, err) = drift(r, &["practices", "--json", "--units"]);
    assert!(ok, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap();
    let label = |path: &str, symbol: &str| -> String {
        let u = authn["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["path"] == path && u["symbol"] == symbol)
            .unwrap_or_else(|| panic!("no unit {path} {symbol}: {}", authn["units"]));
        let variant = authn["variants"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == u["variant"])
            .unwrap_or_else(|| panic!("no variant for {u}"));
        format!(
            "{} {}",
            u["assignment"].as_str().unwrap(),
            variant["label"].as_str().unwrap()
        )
    };
    for (path, symbol) in [
        ("app/api/health/route.ts", "GET"),
        ("svc/app/main.py", "status"),
        ("svc/app/main.py", "ready"),
    ] {
        assert_eq!(label(path, symbol), "known opens probe", "{path} {symbol}");
    }
    for (path, symbol) in [
        // Not a probe path.
        ("app/api/ping/route.ts", "GET"),
        // Named for a health check, but the path ends in a parameter it reads.
        ("svc/app/main.py", "health_check"),
        // A probe path whose handler reads a query parameter.
        ("svc/app/main.py", "health_of"),
        // A probe is not written to.
        ("svc/app/main.py", "healthz"),
    ] {
        assert_eq!(
            label(path, symbol),
            "none no guard found in what Drift read",
            "{path} {symbol}"
        );
    }
    let (ok, text, err) = drift(r, &["practices", "--all"]);
    assert!(ok, "{err}");
    assert!(text.contains("opens probe"), "{text}");
}
