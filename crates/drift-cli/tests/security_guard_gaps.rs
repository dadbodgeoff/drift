//! `drift security` lists the guards most entry points of a kind share and the
//! members lacking them: "37 of 40 http entry points have `withAuth`; these 3 do
//! not", with a member to copy from. Learned from the repository, never a rule, and
//! the report ends by saying what it does not cover.

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
const ADMIN: &str = "import { withAuth, withAdmin } from \"@/lib/auth\";\n\nexport const GET = withAuth(withAdmin(async (req: Request) => {\n  return Response.json({ ok: true });\n}));\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// Guards that turn callers away (a guard is a wrapper whose definition rejects).
const AUTH: &str = "import { TRPCError } from \"@trpc/server\";\n\nexport function withAuth<T>(h: T): T {\n  if (!(globalThis as any).user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return h;\n}\nexport function withAdmin<T>(h: T): T {\n  if (!(globalThis as any).user?.admin) {\n    throw new TRPCError({ code: \"FORBIDDEN\" });\n  }\n  return h;\n}\n";

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
    write(r, "lib/auth.ts", AUTH);
    // 37 of 40 routes under app/api are wrapped in withAuth; three are not.
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 37 { GUARDED } else { UNGUARDED },
        );
    }
    // Under app/api/admin, 9 of 10 routes add withAdmin: a narrower role with its own
    // guard. All ten have withAuth, so they add nothing to the withAuth row.
    for i in 0..10 {
        write(
            r,
            &format!("app/api/admin/a{i:02}/route.ts"),
            if i < 9 { ADMIN } else { GUARDED },
        );
    }
    // Plain helpers: the contrast mining needs to propose the withAuth convention
    // (a gap needs no contrast; a convention does).
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> String {
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
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn shared_guards_and_their_exceptions_are_listed() {
    let dir = repo();
    let r = dir.path();
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let gaps = inv["guard_gaps"].as_array().unwrap();
    assert_eq!(gaps.len(), 2, "{gaps:#?}");

    // The whole package's http entry points share withAuth; the three without it are
    // the exceptions, with the first guarded route to copy from.
    let auth = &gaps[0];
    assert_eq!(auth["guard"], "withAuth");
    assert_eq!(auth["package"], "");
    assert_eq!(auth["dir"], "");
    assert_eq!(auth["kind"], "http");
    assert_eq!(auth["members"], 50);
    assert_eq!(auth["with_guard"], 47);
    let exceptions: Vec<&str> = auth["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        exceptions,
        [
            "app/api/r37/route.ts",
            "app/api/r38/route.ts",
            "app/api/r39/route.ts"
        ]
    );
    assert_eq!(auth["exceptions"][0]["guards"], serde_json::json!([]));
    assert_eq!(auth["example"]["path"], "app/api/admin/a00/route.ts");

    // The admin directory has its own guard; its one exception already has withAuth.
    let admin = &gaps[1];
    assert_eq!(admin["guard"], "withAdmin");
    assert_eq!(admin["dir"], "app/api/admin");
    assert_eq!(admin["members"], 10);
    assert_eq!(admin["with_guard"], 9);
    assert_eq!(admin["exceptions"][0]["path"], "app/api/admin/a09/route.ts");
    assert_eq!(
        admin["exceptions"][0]["guards"],
        serde_json::json!(["withAuth"])
    );

    // Every entry point carries its package, so tools can group them.
    assert!(
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["package"] == "")
    );

    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("2 guard(s) shared by at least 90% of the entry points of a kind have exceptions (listed below)"),
        "{text}"
    );
    assert!(
        text.contains("\nGuards most entry points of a kind share, and the exceptions\n  withAuth: 47 of 50 http entry points in the repository have it; 3 do not\n      http GET /api/r37  app/api/r37/route.ts:1  no guard found in what Drift read\n"),
        "{text}"
    );
    assert!(
        text.contains("  withAdmin: 9 of 10 http entry points in app/api/admin/ have it; 1 do not\n      http GET /api/admin/a09  app/api/admin/a09/route.ts:3  withAuth\n      to copy: app/api/admin/a00/route.ts:3 GET\n        export const GET = withAuth(withAdmin(async (req: Request) =› {\n"),
        "{text}"
    );
    assert!(
        text.trim_end()
            .ends_with("not a verdict on its exceptions."),
        "{text}"
    );

    // Limited to one file: only the rows naming it, and the footer stays.
    let text = drift(r, &["--no-cache", "security", "app/api/admin/a09/route.ts"]);
    assert!(text.contains("withAdmin: 9 of 10"), "{text}");
    assert!(!text.contains("withAuth: 47 of 50"), "{text}");
    assert!(text.contains("\nNot covered:"), "{text}");

    // Nothing was written into the repository.
    assert!(!r.join(".drift").exists());
    assert!(inv["guard_gaps"][0].get("convention").is_none());

    // With conventions, each gap names the convention that says the same: proposed
    // after `drift init`, accepted after `drift review --accept`.
    drift(r, &["--no-cache", "init"]);
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let c = &inv["guard_gaps"][0]["convention"];
    assert_eq!(c["status"], "proposed", "{inv:#}");
    assert_eq!(c["mode"], "advise");
    let id = c["id"].as_str().unwrap().to_string();
    assert_eq!(id.len(), 8, "{id}");
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains(&format!("  withAuth: 47 of 50 http entry points in the repository have it; 3 do not\n      proposed as [{id}]: `drift review --accept {id}` makes it a rule\n      http GET /api/r37")),
        "{text}"
    );
    drift(r, &["--no-cache", "review", "--accept", &id]);
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    assert_eq!(inv["guard_gaps"][0]["convention"]["status"], "accepted");
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains(&format!("\n      convention [{id}] accepted, advises\n")),
        "{text}"
    );
}

#[test]
fn small_roles_and_universal_guards_make_no_gap() {
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
        "import { TRPCError } from \"@trpc/server\";\n\nexport function withAuth<T>(h: T): T {\n  if (!(globalThis as any).user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return h;\n}\n",
    );
    // Seven routes, one unguarded: below the population minimum.
    for i in 0..7 {
        write(
            r,
            &format!("app/api/s{i}/route.ts"),
            if i < 6 { GUARDED } else { UNGUARDED },
        );
    }
    // Twelve routes all guarded: nothing lacks the guard.
    for i in 0..12 {
        write(r, &format!("app/all/u{i:02}/route.ts"), GUARDED);
    }
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    // app/api alone is too small, and over the package 18 of 19 have it: 94%, one
    // exception, so the gap is at the package level only.
    let gaps = inv["guard_gaps"].as_array().unwrap();
    assert_eq!(gaps.len(), 1, "{gaps:#?}");
    assert_eq!(gaps[0]["dir"], "");
    assert_eq!(gaps[0]["members"], 19);
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("withAuth: 18 of 19 http entry points in the repository have it; 1 do not"),
        "{text}"
    );
}

/// A `.drift/conventions.yaml` that does not parse costs only the convention links: the
/// inventory is listed, with one warning naming the error, in the text and in the JSON
/// (`warnings`), and the command exits 0.
#[test]
fn a_broken_policy_lists_the_inventory_without_convention_links() {
    let dir = repo();
    let r = dir.path();
    write(r, ".drift/conventions.yaml", "conventions: [\n  - id: [\n");
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let inv: Value = serde_json::from_slice(&out.stdout).unwrap();
    let warnings = inv["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    let w = warnings[0].as_str().unwrap();
    assert!(
        w.starts_with(".drift/conventions.yaml could not be read (")
            && w.contains("without the conventions"),
        "{w}"
    );
    let gaps = inv["guard_gaps"].as_array().unwrap();
    assert!(!gaps.is_empty());
    assert!(
        gaps.iter().all(|g| g.get("convention").is_none()),
        "{gaps:#?}"
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert_eq!(
        text.matches(".drift/conventions.yaml could not be read")
            .count(),
        1,
        "{text}"
    );
    assert!(text.contains("withAuth"), "{text}");
}

/// A route file that only re-exports its handler (`export { GET } from "../v1/x/route"`)
/// is a route of its own: the inventory lists it under its own path, with the guards,
/// reaches and gaps of the code it re-exports, and the card of the file shows it.
#[test]
fn a_route_that_re_exports_its_handler_is_an_entry_point_of_its_own() {
    let dir = repo();
    let r = dir.path();
    write(
        r,
        "app/api/v1/open/route.ts",
        "import { exec } from \"node:child_process\";\n\nexport async function POST(req: Request) {\n  exec((await req.json()).cmd);\n  return Response.json({ ok: true });\n}\n",
    );
    write(
        r,
        "app/api/alias/open/route.ts",
        "export { POST } from \"@/app/api/v1/open/route\";\n",
    );
    write(
        r,
        "app/api/alias/kept/route.ts",
        "export { GET } from \"@/app/api/r00/route\";\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let row = |path: &str| -> Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["path"] == path)
            .unwrap_or_else(|| panic!("{path} is not listed: {:#}", inv["entry_points"]))
            .clone()
    };
    // The alias of an unguarded handler that runs a shell command: no guard, same reach.
    let open = row("app/api/alias/open/route.ts");
    assert_eq!(open["symbol"], "POST");
    assert_eq!(open["route"], "/api/alias/open");
    assert_eq!(open["guards"].as_array().unwrap().len(), 0, "{open:#}");
    assert_eq!(open["reaches"][0]["kind"], "shell_exec", "{open:#}");
    // The alias of a guarded handler carries its guard.
    let kept = row("app/api/alias/kept/route.ts");
    assert_eq!(kept["guards"][0], "withAuth", "{kept:#}");
    // The origin is still listed, once.
    assert_eq!(row("app/api/v1/open/route.ts")["route"], "/api/v1/open");
    let card = drift(r, &["--no-cache", "card", "app/api/alias/open/route.ts"]);
    assert!(
        card.contains("Entry points (1):\n  POST /api/alias/open [http] POST: "),
        "{card}"
    );
    assert!(card.contains("reaches shell_exec"), "{card}");
}
