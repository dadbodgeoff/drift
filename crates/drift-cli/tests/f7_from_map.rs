//! Proposals from the map at `drift init` (fix F7): what `init` writes is the same on
//! every run, the mined part of it does not depend on the proposals, `--no-from-map`
//! writes the file as before this build, and a proposal a person accepts by hand in
//! the file is baselined once, as `drift review` would have.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Status};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    );
    assert!(out.status.success(), "{args:?} failed:\n{stdout}\n{stderr}");
    stdout
}

/// 40 routes, 38 wrapped in `withAuth` (r38 and r39 are not), with 30 helpers: the
/// repository of `s10_from_map.rs`, where `init` proposes the sign-in practice.
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

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

fn policy(r: &Path) -> ConventionsFile {
    ConventionsFile::load(r).unwrap().expect("a policy")
}

fn mined(r: &Path) -> Vec<Convention> {
    policy(r)
        .conventions
        .into_iter()
        .filter(|c| c.from_map.is_none())
        .collect()
}

fn version_line(yaml: &str) -> String {
    yaml.lines()
        .find(|l| l.starts_with("version:"))
        .unwrap_or_default()
        .to_string()
}

fn lock_lines(r: &Path, id: &str) -> Vec<String> {
    read(r, LOCK_FILE)
        .lines()
        .filter(|l| l.starts_with(&format!("{id} ")))
        .map(str::to_string)
        .collect()
}

/// Pins: `init --no-from-map` run twice writes the same bytes.
#[test]
fn no_from_map_twice_is_byte_identical() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init", "--no-from-map"]);
    let (yaml, lock) = (read(r, CONVENTIONS_FILE), read(r, LOCK_FILE));
    drift(r, &["init", "--no-from-map"]);
    assert_eq!(read(r, CONVENTIONS_FILE), yaml);
    assert_eq!(read(r, LOCK_FILE), lock);
}

/// Pins: `init` run twice, with its proposals from the map, writes the same bytes.
#[test]
fn init_twice_is_byte_identical() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let (yaml, lock) = (read(r, CONVENTIONS_FILE), read(r, LOCK_FILE));
    assert!(yaml.contains("from_map: practice"), "{yaml}");
    drift(r, &["init"]);
    assert_eq!(read(r, CONVENTIONS_FILE), yaml);
    assert_eq!(read(r, LOCK_FILE), lock);
}

/// Pins: what is mined (every convention without `from_map:`) and the lock are the
/// same with and without `--no-from-map`, and with `--no-from-map` a single-package
/// repository with no rule of a new form is written as version 1, as before this
/// build. Where the proposals alone raise the format, `init` says so in one line.
#[test]
fn the_mined_part_does_not_depend_on_the_proposals() {
    let a = repo();
    let ra = a.path();
    let out = drift(ra, &["init"]);
    let b = repo();
    let rb = b.path();
    drift(rb, &["init", "--no-from-map"]);
    assert_eq!(mined(ra), mined(rb));
    assert_eq!(read(ra, LOCK_FILE), read(rb, LOCK_FILE));
    let plain = read(rb, CONVENTIONS_FILE);
    assert_eq!(version_line(&plain), "version: 1", "{plain}");
    let with = read(ra, CONVENTIONS_FILE);
    let raised = policy(ra)
        .conventions
        .iter()
        .any(|c| c.from_map.is_some() && drift_mine::policy::misread_before_forms(c));
    if raised {
        assert_eq!(version_line(&with), "version: 3", "{with}");
        assert!(out.contains("is now policy format 3 because"), "{out}");
        assert!(
            out.contains("`drift init --no-from-map` writes none of them"),
            "{out}"
        );
    } else {
        assert_eq!(version_line(&with), version_line(&plain), "{with}");
        assert!(!out.contains("is now policy format"), "{out}");
    }
}

/// Pins: a proposal from the map a person accepts by editing the file is baselined
/// on the next `init` (before: never, so its two differing routes were reported as new
/// violations), and only once: a further `init` changes nothing.
#[test]
fn a_proposal_accepted_by_hand_is_baselined_once() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let mut p = policy(r);
    let id = {
        let c = p
            .conventions
            .iter_mut()
            .find(|c| {
                c.from_map.as_deref() == Some("practice")
                    && matches!(&c.rule, drift_mine::mine::Rule::Practice { concern, .. } if concern == "authn")
            })
            .expect("the sign-in proposal");
        assert_eq!(c.status, Status::Proposed);
        assert!(
            lock_lines(r, &c.id).is_empty(),
            "a proposal is not baselined"
        );
        c.status = Status::Accepted;
        c.id.clone()
    };
    p.save(r).unwrap();
    drift(r, &["init"]);
    assert_eq!(
        lock_lines(r, &id),
        vec![
            format!("{id} app/api/r38/route.ts#GET"),
            format!("{id} app/api/r39/route.ts#GET"),
        ]
    );
    let lock = read(r, LOCK_FILE);
    drift(r, &["init"]);
    assert_eq!(read(r, LOCK_FILE), lock);
}
