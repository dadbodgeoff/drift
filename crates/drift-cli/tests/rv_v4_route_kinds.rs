//! Review of PR 148, area 2, item 1, end to end: an entry point of a kind Drift read no
//! route for (here Next.js server actions, which are served at no path) is in no route
//! place. A Next.js app with 40 `/api/...` handlers wrapped in `withAuth` and 11 server
//! actions beside them, in `app/api/actions`: the directories hold the actions too (40
//! of 51 follow, below the share), so the route prefix `.:/api` is the place, and it
//! is offered and accepted. Before, each action's empty route was "compatible" with
//! every prefix, so `.:/api` was 11 of 51 not read (21%, over the 20% limit): refused,
//! never offered, and an accepted route practice reported the actions as "not
//! checked", which no config line could ever settle.

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

fn json(root: &Path, args: &[&str]) -> Value {
    let out = drift(root, args);
    serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"))
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

fn action(i: usize) -> String {
    format!(
        "\"use server\";\n\nexport async function save{i:02}(form: FormData) {{\n  return {{ ok: true }};\n}}\n"
    )
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..40 {
        write(r, &format!("app/api/r{i:02}/route.ts"), WRAPPED);
    }
    for i in 0..11 {
        write(r, &format!("app/api/actions/a{i:02}.ts"), &action(i));
    }
    drift(r, &["init"]);
    dir
}

#[test]
fn server_actions_are_in_no_route_place() {
    let dir = repo();
    let r = dir.path();
    let map = json(r, &["practices", "--units", "--json"]);
    let authn = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap_or_else(|| panic!("no authn concern: {map:#}"));
    let actions = authn["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "server_action")
        .count();
    assert_eq!(actions, 11, "the fixture has its server actions: {authn:#}");
    let variant = authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["label"] == "wrap withAuth")
        .and_then(|x| x["id"].as_str())
        .unwrap_or_else(|| panic!("no `wrap withAuth` variant: {authn:#}"))
        .to_string();
    // Offered.
    let list = json(r, &["practices", "promote", "--list", "--json"]);
    assert!(
        list["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["place"] == ".:/api"),
        "{list:#}"
    );
    // Accepted: the 40 handlers, nothing not read.
    let v = json(
        r,
        &["practices", "promote", &variant, "--in", ".:/api", "--json"],
    );
    assert_eq!(v["written"], true, "{v:#}");
    assert_eq!(v["candidate"]["total"], 40, "{v:#}");
    assert_eq!(v["candidate"]["follows"], 40, "{v:#}");
    assert!(
        v["candidate"]["unknown"].is_null() || v["candidate"]["unknown"] == 0,
        "{v:#}"
    );
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    // Checked: the actions are not "not checked" under it.
    let report = json(r, &["check", "--format", "json"]);
    assert!(
        report["practices_not_checked"]
            .as_array()
            .is_none_or(|n| n.iter().all(|n| n["id"] != id.as_str())),
        "{report:#}"
    );
}
