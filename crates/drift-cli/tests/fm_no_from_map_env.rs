//! `DRIFT_NO_FROM_MAP` at `drift init`: set to anything but empty or `0`, it does what
//! `--no-from-map` does, so a script that also runs a binary from before the flag (the
//! study's frozen one, which ignores the variable) can ask for mined proposals only.
//! Pins: with the variable set, `init` writes no convention with `from_map:`, and
//! `conventions.yaml` is byte for byte the one `--no-from-map` writes; its mined part
//! is the mined part of a plain `init`. Before the variable, `init` with it set wrote
//! the from-map proposals.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{Convention, ConventionsFile};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const ENV: &str = "DRIFT_NO_FROM_MAP";

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift init` with `args`, and `DRIFT_NO_FROM_MAP` set to `env` (unset when `None`).
fn init(root: &Path, args: &[&str], env: Option<&str>) -> String {
    let mut cmd = Command::new(&*BIN);
    cmd.arg("init")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove(ENV);
    if let Some(v) = env {
        cmd.env(ENV, v);
    }
    let out = cmd.output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(
        out.status.success(),
        "init {args:?} ({env:?}) failed:\n{stdout}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    stdout
}

/// The repository of `s10_from_map.rs`: 40 routes, 38 wrapped in `withAuth`, with 30
/// helpers, on which a plain `init` proposes the sign-in practice from the map.
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
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i:02}() {{ return {i}; }}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    dir
}

fn yaml(r: &Path) -> String {
    std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap()
}

fn conventions(r: &Path) -> Vec<Convention> {
    ConventionsFile::load(r)
        .unwrap()
        .expect("a policy")
        .conventions
}

fn mined(r: &Path) -> Vec<Convention> {
    conventions(r)
        .into_iter()
        .filter(|c| c.from_map.is_none())
        .collect()
}

#[test]
fn the_variable_writes_what_the_flag_writes() {
    let plain = repo();
    init(plain.path(), &[], None);
    assert!(
        yaml(plain.path()).contains("from_map:"),
        "the fixture must propose from the map, or this test pins nothing"
    );

    let by_env = repo();
    let out = init(by_env.path(), &[], Some("1"));
    assert!(
        !yaml(by_env.path()).contains("from_map:"),
        "{}",
        yaml(by_env.path())
    );
    assert!(
        conventions(by_env.path())
            .iter()
            .all(|c| c.from_map.is_none())
    );
    assert!(!out.contains("From the map"), "{out}");

    let by_flag = repo();
    init(by_flag.path(), &["--no-from-map"], None);
    assert_eq!(yaml(by_env.path()), yaml(by_flag.path()));
    // The mined part is the mined part of a plain init.
    assert_eq!(mined(by_env.path()), mined(plain.path()));
}

#[test]
fn empty_or_zero_leaves_the_proposals_on() {
    for v in ["", "0"] {
        let dir = repo();
        init(dir.path(), &[], Some(v));
        assert!(
            conventions(dir.path()).iter().any(|c| c.from_map.is_some()),
            "{ENV}={v:?}: {}",
            yaml(dir.path())
        );
    }
}
