//! A member has a shared guard when one of its own guards is built on it: a route
//! wrapped in `withAdmin`, which itself applies `withAuth`, is no exception of the
//! `withAuth` its siblings share. Only exceptions go; the share is still counted by
//! name, and a route with no guard at all is still an exception.
//!
//! Pins: before this, the guard was compared by name alone, so the `withAdmin`
//! route was listed as lacking `withAuth` (a `guard-gap` line of the baseline).

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
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const ADMIN: &str = "import { withAdmin } from \"@/lib/auth\";\n\nexport const GET = withAdmin(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
/// `withAdmin` turns a caller away on its own and then applies `withAuth`.
const AUTH: &str = "import { TRPCError } from \"@trpc/server\";\n\nexport function withAuth<T>(h: T): T {\n  if (!(globalThis as any).user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return h;\n}\n\nexport function withAdmin<T>(h: T): T {\n  if (!(globalThis as any).admin) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return withAuth(h);\n}\n";

#[test]
fn a_guard_built_on_the_shared_one_is_no_exception() {
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
    write(r, "lib/auth.ts", AUTH);
    for i in 0..38 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    write(r, "app/api/admin/route.ts", ADMIN);
    write(r, "app/api/open/route.ts", UNGUARDED);

    let (code, out, err) = drift(r, &["security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let gap = v["guard_gaps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["guard"] == "withAuth")
        .unwrap_or_else(|| panic!("no withAuth gap: {v:#}"))
        .clone();
    let exceptions: Vec<&str> = gap["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["path"].as_str().unwrap())
        .collect();
    // The route with no guard is still an exception; the one built on it is not.
    assert_eq!(exceptions, ["app/api/open/route.ts"], "{gap:#}");
    // The share is counted by name, as before.
    assert_eq!(gap["members"], 40, "{gap:#}");
    assert_eq!(gap["with_guard"], 38, "{gap:#}");

    // The baseline holds no `guard-gap` of the admin route.
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(
        lock.contains("guard-gap\tapp/api/open/route.ts#GET GET /api/open lacks withAuth"),
        "{lock}"
    );
    assert!(
        !lock.contains("app/api/admin/route.ts#GET GET /api/admin lacks"),
        "{lock}"
    );
}
