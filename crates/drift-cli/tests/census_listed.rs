//! `drift census --listed`: mining over every entry point Drift lists.
//!
//! Mining's input is held at the entry points of the last measured build, so a
//! route listed since (registered in a function, here) is no member of the roles
//! conventions are mined for: the guard nearly all such routes share is in the
//! security inventory and in no proposal. `--listed` mines over the listed reading
//! instead, as a preview of the next measured round. The default is unchanged.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn census(root: &Path, extra: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "census", "--json"])
        .args(extra)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// Every string of the proposals' rules and summaries, for a guard's name to be
/// looked up in.
fn proposed(v: &Value) -> String {
    serde_json::to_string(&v["proposals"]).unwrap()
}

/// A repository whose forty guarded routes, and one open one, are registered in a
/// function: listed since the measured build.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let mut server = String::from(
        "import express from \"express\";\nimport { requireAuth } from \"./auth\";\n\nexport function configure(app: express.Express) {\n",
    );
    for i in 0..40 {
        server.push_str(&format!(
            "  app.get(\"/things/{i}\", requireAuth, (req, res) => {{ res.json({{ n: {i} }}); }});\n"
        ));
    }
    server.push_str("  app.get(\"/open\", (req, res) => { res.json({}); });\n}\n\nconst app = express();\nconfigure(app);\nexport default app;\n");
    // Code that is no handler, so that the guard is rarer elsewhere than among
    // the handlers (a convention must be).
    for i in 0..70 {
        let p = dir.path().join(format!("src/lib/compute{i}.ts"));
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(
            p,
            format!("export function compute{i}(a: number) {{\n  return a * {i};\n}}\n"),
        )
        .unwrap();
    }
    for (rel, text) in [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/auth.ts",
            "export function requireAuth(req: any, res: any, next: any) {\n  if (!req.user) {\n    return res.status(401).json({ error: \"unauthorized\" });\n  }\n  next();\n}\n",
        ),
        ("src/server.ts", server.as_str()),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

#[test]
fn routes_listed_since_the_measured_build_are_mined_only_when_asked() {
    let dir = repo();
    let measured = census(dir.path(), &[]);
    assert!(
        !proposed(&measured).contains("requireAuth"),
        "{}",
        proposed(&measured)
    );
    let listed = census(dir.path(), &["--listed"]);
    assert!(
        proposed(&listed).contains("requireAuth"),
        "{}",
        serde_json::to_string_pretty(&listed).unwrap()
    );
}

fn run(root: &Path, args: &[&str]) -> (i32, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ),
    )
}

#[test]
fn the_experimental_feature_makes_every_command_mine_and_check_the_listed_routes() {
    let dir = repo();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".drift")).unwrap();
    std::fs::write(
        root.join(".drift/config.yaml"),
        "experimental: [listed_entry_points]\n",
    )
    .unwrap();
    // The census with no flag is the listed one.
    let mined = census(root, &[]);
    assert!(
        proposed(&mined).contains("requireAuth"),
        "{}",
        proposed(&mined)
    );
    let id = mined["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| serde_json::to_string(p).unwrap().contains("requireAuth"))
        .and_then(|p| p["id"].as_str())
        .unwrap()
        .to_string();
    // `init` writes it, and its one outlier is baselined. Without the proposals from the
    // practice map (S10): the practice map always reads the listed routes, so its own
    // sign-in proposal, accepted below with the rest, would report `/added` with the
    // feature off too; this test is about what mining reads.
    let (code, out) = run(root, &["init", "--no-from-map"]);
    assert_eq!(code, 0, "{out}");
    let policy = std::fs::read_to_string(root.join(".drift/conventions.yaml")).unwrap();
    assert!(policy.contains(&id), "{policy}");
    // Accepted in block mode, a route added without the guard fails the check.
    let accepted = policy.replacen("status: proposed", "status: accepted", usize::MAX);
    std::fs::write(root.join(".drift/conventions.yaml"), accepted).unwrap();
    let server = std::fs::read_to_string(root.join("src/server.ts")).unwrap();
    std::fs::write(
        root.join("src/server.ts"),
        server.replacen(
            "  app.get(\"/open\"",
            "  app.get(\"/added\", (req, res) => { res.json({ added: true }); });\n  app.get(\"/open\"",
            1,
        ),
    )
    .unwrap();
    let (_, out) = run(root, &["check", "--strict"]);
    assert!(out.contains(&id), "{out}");
    // With the feature off the same check reads the measured build's routes, where
    // these are no entry points: the convention has no members to depart.
    std::fs::write(root.join(".drift/config.yaml"), "").unwrap();
    let (_, out) = run(root, &["check", "--strict"]);
    assert!(
        !out.contains("/added") && out.contains("no new violations"),
        "{out}"
    );
}
