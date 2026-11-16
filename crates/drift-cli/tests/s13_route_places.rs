//! Stream S13: a practice promoted under a literal route prefix (`--in
//! '.:/api/workspaces/[*]/projects/[*]'`), end to end on a Next.js repository whose
//! project routes are wrapped in `withAuth` and whose public routes are not: `drift
//! check` reports a new project route that departs, and not a new public one. Before
//! this stream `--in` took only a directory, and `.:/…` was refused.

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

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    );
    assert_eq!(
        out.status.code(),
        Some(0),
        "{args:?} failed:\n{stdout}\n{stderr}"
    );
    stdout
}

const AUTH: &str = r#"type Handler = (req: Request) => Promise<Response>;

export function withAuth(h: Handler): Handler {
  return async (req) => {
    if (!req.headers.get("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return h(req);
  };
}
"#;

const WRAPPED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const OPEN: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn project(n: usize) -> String {
    format!("app/api/workspaces/[slug]/projects/[id]/t{n:02}/route.ts")
}

fn public(n: usize) -> String {
    format!("app/api/public/p{n:02}/route.ts")
}

const PREFIX: &str = ".:/api/workspaces/[*]/projects/[*]";

/// 10 project routes wrapped, 10 public routes open; promoted under the prefix.
fn promoted() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for n in 0..10 {
        write(r, &project(n), WRAPPED);
        write(r, &public(n), OPEN);
    }
    drift(r, &["init"]);
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    let variant = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"] == "authn")
        .flat_map(|c| c["variants"].as_array().unwrap())
        .find(|x| x["label"] == "wrap withAuth")
        .and_then(|x| x["id"].as_str())
        .unwrap_or_else(|| panic!("no `wrap withAuth` variant: {v:#}"))
        .to_string();
    let out = drift(
        r,
        &["practices", "promote", &variant, "--in", PREFIX, "--json"],
    );
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    assert_eq!(v["written"], true, "{v:#}");
    assert_eq!(v["baselined"], 0, "{v:#}");
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains("under_route:"), "{yaml}");
    (dir, id)
}

#[test]
fn a_new_route_under_the_prefix_that_departs_is_reported_and_one_outside_is_not() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, &project(10), OPEN);
    write(r, &public(10), OPEN);
    let out = drift(r, &["check", "--format", "json"]);
    let report: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    let mine: Vec<&str> = report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == id.as_str())
        .map(|v| v["path"].as_str().unwrap())
        .collect();
    assert_eq!(mine, [project(10)], "{report:#}");
}
