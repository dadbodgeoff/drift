//! `drift map`, `drift census --coverage`, the test roles (selector version 4, off by
//! default) and the yield funnel (`DRIFT_FUNNEL`), on a synthetic repository with
//! invented names: a TS app with guarded routes, and a Python service whose API tests
//! share a client helper that its model tests do not use.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"otterworks\" }");
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
    // Guarded routes in two places no folder role spans, so the repo-wide HTTP handler
    // kind role is larger than either place role; and helpers, so a wrapper is rare
    // among functions at large.
    for i in 0..30 {
        for dir in ["app/api", "apps/admin/app/api"] {
            write(
                r,
                &format!("{dir}/p{i:02}/route.ts"),
                if i < 28 { GUARDED } else { UNGUARDED },
            );
        }
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    write(
        r,
        "lib/auth.test.ts",
        "import { withAuth } from \"./auth\";\ntest(\"wraps\", () => { withAuth(1); });\n",
    );
    // A Python service: API tests call the shared client helper, model tests do not.
    write(r, "pyproject.toml", "[project]\nname = \"burrow\"\n");
    write(r, "burrow/__init__.py", "");
    write(r, "burrow/dens.py", "def dig(depth):\n    return depth\n");
    write(r, "tests/__init__.py", "");
    write(
        r,
        "tests/helpers.py",
        "def api_client():\n    return object()\n",
    );
    for i in 0..30 {
        let body = if i < 29 {
            format!(
                "from tests.helpers import api_client\n\n\ndef test_den_{i}():\n    c = api_client()\n    assert c is not None\n"
            )
        } else {
            format!("def test_den_{i}():\n    assert True\n")
        };
        write(r, &format!("tests/api/test_den_{i:02}.py"), &body);
        write(
            r,
            &format!("tests/models/test_depth_{i:02}.py"),
            &format!(
                "from burrow.dens import dig\n\n\ndef test_depth_{i}():\n    assert dig({i}) == {i}\n"
            ),
        );
    }
    dir
}

fn drift(root: &Path, args: &[&str], env: &[(&str, &Path)]) -> String {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn json(s: &str) -> Value {
    serde_json::from_str(s).unwrap()
}

#[test]
fn map_is_read_only_bounded_and_deterministic() {
    let dir = repo();
    let r = dir.path();
    let a = drift(r, &["map", "--json", "--max", "3"], &[]);
    assert!(!r.join(".drift").exists(), "map writes nothing");
    assert_eq!(a, drift(r, &["map", "--json", "--max", "3"], &[]));
    let v = json(&a);
    assert_eq!(v["roles"]["largest"].as_array().unwrap().len(), 3);
    assert!(v["roles"]["count"].as_u64().unwrap() > 3);
    // One file: its layer and roles, and a few peers.
    let f = json(&drift(
        r,
        &["map", "--json", "--file", "app/api/p03/route.ts"],
        &[],
    ));
    assert_eq!(f["layer"], "app/api");
    assert_eq!(f["package"], "");
    assert!(!f["roles"].as_array().unwrap().is_empty());
    assert!(f["peers"].as_array().unwrap().len() <= 5);
    let id = f["roles"][0]["id"].as_str().unwrap();
    let role = json(&drift(r, &["map", "--json", "--role", id], &[]));
    assert_eq!(role["id"], id);
    // A test file is in a test role, described but not mined while test roles are off.
    let t = json(&drift(
        r,
        &["map", "--json", "--file", "tests/api/test_den_03.py"],
        &[],
    ));
    assert!(
        t["roles"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["test"] == true && r["mined"] == false),
        "{t}"
    );
    // The text view says the names are data.
    assert!(drift(r, &["map"], &[]).starts_with("(Names come from the repository"));
}

#[test]
fn funnel_and_test_roles_leave_the_default_census_unchanged() {
    let dir = repo();
    let r = dir.path();
    let base = drift(r, &["census", "--json", "--max", "15"], &[]);
    let funnel = r.join("funnel.json");
    let counted = drift(
        r,
        &["census", "--json", "--max", "15"],
        &[("DRIFT_FUNNEL", &funnel)],
    );
    assert_eq!(base, counted, "counting changes nothing");
    let f = json(&std::fs::read_to_string(&funnel).unwrap());
    let rows = f["rows"].as_array().unwrap();
    let n = |family: &str, stage: &str| -> u64 {
        rows.iter()
            .filter(|r| r["family"] == family && r["stage"] == stage)
            .map(|r| r["n"].as_u64().unwrap())
            .sum()
    };
    assert!(n("-", "roles") > 0);
    assert!(n("wrapped_by:call", "shown") >= 1, "{f}");
    // Nothing of the test pass is counted while test roles are off.
    assert!(
        rows.iter()
            .all(|r| !r["family"].as_str().unwrap().starts_with("test:"))
    );
    std::fs::remove_file(&funnel).unwrap();

    // Test roles on: every production proposal is exactly what it was.
    let tested = json(&drift(
        r,
        &[
            "census",
            "--json",
            "--max",
            "15",
            "--test-roles",
            "--python-proposals",
        ],
        &[("DRIFT_FUNNEL", &funnel)],
    ));
    let plain = json(&drift(
        r,
        &["census", "--json", "--max", "15", "--python-proposals"],
        &[],
    ));
    let production = |v: &Value| -> Vec<Value> {
        v["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["role"].get("shape").is_none())
            .map(|p| p["id"].clone())
            .collect()
    };
    assert_eq!(production(&tested), production(&plain));
    // The API tests' shared client is a test-role draft (Python calls advise only, and the
    // show policy admits no Python call family, so it is not proposed).
    let f = json(&std::fs::read_to_string(&funnel).unwrap());
    let drafted: u64 = f["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["family"] == "test:calls" && r["stage"] == "drafted")
        .map(|r| r["n"].as_u64().unwrap())
        .sum();
    assert!(drafted >= 1, "{f}");
}

#[test]
fn census_coverage_reports_production_and_test_maps_apart() {
    let dir = repo();
    let r = dir.path();
    let c = json(&drift(r, &["census", "--coverage", "--json"], &[]));
    // 60 test modules, the helpers and package init under `tests/`, and one TS test.
    assert_eq!(c["test"]["files"], 63);
    let in_role = c["test"]["test_role"]["files"].as_u64().unwrap();
    // The one TS test is alone in its shape: no role of 8.
    assert!((60..=62).contains(&in_role), "{}", c["test"]);
    assert!(c["production"]["files"].as_u64().unwrap() >= 33);
    // The 30 routes are in a role keyed by their entry kind and file kind.
    assert!(c["production"]["kind_keyed"]["files"].as_u64().unwrap() >= 30);
    assert!(
        c["headline"]["files_under_shown_convention"]["files"]
            .as_u64()
            .unwrap()
            >= 30
    );
    assert_eq!(c["measures"]["1_parsed"]["pct"], 100.0);
    let text = drift(r, &["census", "--coverage"], &[]);
    for want in [
        "Map coverage:",
        "Production map",
        "Test map",
        "Packages",
        "Unmapped files by reason",
    ] {
        assert!(text.contains(want), "{want}: {text}");
    }
    assert!(
        !r.join(".drift").exists(),
        "census --coverage writes nothing"
    );
}

/// Kind roles are additive: with them on, every proposal of a place role is exactly the
/// one mining makes without them, even where the per-repo cap is one card (a repo-wide
/// kind role's draft never takes a place role's slot).
#[test]
fn kind_roles_never_displace_place_cards() {
    let dir = repo();
    let r = dir.path();
    for max in ["1", "2", "15"] {
        let places = |v: &Value| -> Vec<Value> {
            v["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|p| p["role"].get("shape").is_none())
                .map(|p| p["id"].clone())
                .collect()
        };
        let off = json(&drift(r, &["census", "--json", "--max", max], &[]));
        let on = json(&drift(
            r,
            &["census", "--json", "--max", max, "--kind-roles"],
            &[],
        ));
        assert_eq!(places(&on), places(&off), "--max {max}");
        assert!(!places(&off).is_empty());
        if max == "15" {
            // The routes' wrapper is a convention of the repo-wide HTTP handler role too.
            assert!(
                on["proposals"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["role"]["shape"] == "ts:entry"),
                "{on}"
            );
        }
    }
}
