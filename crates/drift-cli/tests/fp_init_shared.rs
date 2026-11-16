//! FP (hot paths): `drift init` builds the practice map with its units once, for the
//! proposals from the map and for the security summary, and reads the security
//! inventory once, for the summary and for the security baseline it offers. With
//! `--no-from-map` no proposal asks for the map, so the summary builds it on its own:
//! what init prints of the code (the first run, the security summary, the offer) is the
//! same either way, which pins that the map shared with the proposals is the map the
//! summary built alone before this change.

use std::path::Path;
use std::process::{Command, Stdio};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn init(root: &Path, extra: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .arg("init")
        .args(extra)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const POST = withAuth(async (req: Request) => {\n  const body = await req.json();\n  return Response.json({ ok: body.id });\n});\n";
const UNGUARDED: &str = "export async function POST(req: Request) {\n  const body = await req.json();\n  return Response.json({ ok: body.id });\n}\n";

/// 30 routes, 27 behind `withAuth`, 3 behind nothing.
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
    for i in 0..30 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 27 { GUARDED } else { UNGUARDED },
        );
    }
    dir
}

/// What `drift init` printed before its conventions: the files read, the first run and
/// the security summary.
fn before_conventions(out: &str) -> &str {
    out.split("\nConventions\n").next().unwrap()
}

/// The security baseline offer, if init made one.
fn offer(out: &str) -> Option<&str> {
    out.lines()
        .find(|l| l.starts_with("Security baseline: none yet."))
}

/// Pins: the first run, the security summary and the baseline offer are the same with
/// the proposals from the map (the map shared with the summary) and without them (the
/// summary's own map), and init says something of the code to compare.
#[test]
fn init_prints_the_same_summary_with_the_shared_map() {
    let shared = repo();
    let alone = repo();
    let with = init(shared.path(), &[]);
    let without = init(alone.path(), &["--no-from-map"]);
    let head = before_conventions(&with);
    assert!(head.lines().count() > 1, "init says what it read: {with}");
    assert_eq!(head, before_conventions(&without));
    assert_eq!(offer(&with), offer(&without));
}
