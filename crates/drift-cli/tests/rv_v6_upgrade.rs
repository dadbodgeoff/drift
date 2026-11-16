//! Review fixes of `drift upgrade` and `drift feedback export --out` (PR 148, area 5):
//!
//! - `drift upgrade --apply` baselines only what a different Drift's reading added: never
//!   the breaks of a convention that was an undecided proposal at the commit it is
//!   compared with and was accepted since, and nothing at all when the policy at that
//!   commit names this same Drift.
//! - A CRLF `AGENTS.md` whose Drift block is current reads as current.
//! - A `security.lock` with a byte-order mark is read, as `drift check` reads it.
//! - A security baseline stamped with an older inventory is a to-do even when nothing
//!   newer is found today.
//! - `--out` (and every other path a person names for a file Drift writes) is checked as
//!   it will be written: `..`, links and letter case do not reach Drift's policy.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::ratchet::INVENTORY_VERSION;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap()
}

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// `drift --no-cache ARGS` in `root`: exit code, stdout and stderr together.
fn drift(root: &Path, args: &[&str]) -> (i32, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .env_remove("CLAUDE_CODE_SESSION_ID")
        .env_remove("GITHUB_STEP_SUMMARY")
        .stdin(Stdio::null())
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

const GUARDED: &str = "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// A Next.js app whose HTTP handlers are wrapped in `withAuth` but two (r38, r39), after
/// `drift init` (proposals undecided). Not committed.
fn app() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 10..40 {
        let body = if i < 38 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i}/route.ts"), body);
    }
    // So `withAuth` is measured as rarer elsewhere and the convention is mined.
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    write(r, ".gitignore", ".drift/cache/\n");
    let (code, out) = drift(r, &["init"]);
    assert_eq!(code, 0, "{out}");
    dir
}

/// The ids of the proposals in the policy.
fn proposed(root: &Path) -> String {
    let yaml = read(root, ".drift/conventions.yaml");
    let ids: Vec<&str> = yaml
        .split("- id: ")
        .skip(1)
        .filter(|b| b.contains("status: proposed"))
        .map(|b| &b[..8])
        .collect();
    assert!(!ids.is_empty(), "{yaml}");
    ids.join(",")
}

/// The policy's `engine:` set to an older Drift's.
fn older_engine(root: &Path) {
    let yaml = read(root, ".drift/conventions.yaml");
    let out: String = yaml
        .lines()
        .map(|l| {
            if l.starts_with("engine: ") {
                "engine: drift 0.0.1\n".to_string()
            } else {
                format!("{l}\n")
            }
        })
        .collect();
    assert_ne!(out, yaml);
    write(root, ".drift/conventions.yaml", &out);
}

/// The lock without r39's lines: as a Drift whose reading did not see that violation
/// wrote it.
fn drop_r39(root: &Path) {
    let lock = read(root, "drift.lock");
    assert!(lock.contains("app/api/r39/route.ts#GET"), "{lock}");
    let older: String = lock
        .lines()
        .filter(|l| !l.contains("app/api/r39/route.ts"))
        .map(|l| format!("{l}\n"))
        .collect();
    write(root, "drift.lock", &older);
}

/// Pins (review item 2, same version): the policy at the compared commit was written by
/// this very Drift, so no new violation can be a reading change: r39, missing from the
/// lock, is one Drift cannot tell about, and `--apply` leaves `drift.lock` byte for
/// byte. Before, it was baselined as "this Drift reads the code differently".
#[test]
fn the_same_drift_on_both_sides_baselines_nothing() {
    let dir = app();
    let r = dir.path();
    let ids = proposed(r);
    let (code, out) = drift(r, &["review", "--accept", &ids]);
    assert_eq!(code, 0, "{out}");
    drop_r39(r);
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "init and accept, this Drift"]);
    let lock = read(r, "drift.lock");
    let (code, out) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(code, 3, "{out}");
    assert!(out.contains("\n  0 appear only because"), "{out}");
    assert!(out.contains("was written by this same Drift"), "{out}");
    assert!(out.contains("app/api/r39/route.ts#GET (line "), "{out}");
    assert_eq!(read(r, "drift.lock"), lock, "a same-Drift violation was baselined");
}

/// Pins (review item 2): a convention that was an undecided proposal at the commit that
/// first wrote it, and was accepted in a later commit, is a person's decision made since:
/// its breaks are left to a person and never baselined, even with an older Drift named
/// at that commit. Before, the init commit served as the baseline point and r39 was
/// appended to `drift.lock` as a reading change.
#[test]
fn a_proposal_accepted_later_is_not_a_reading_change() {
    let dir = app();
    let r = dir.path();
    older_engine(r);
    drop_r39(r);
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "init, an older Drift"]);
    let ids = proposed(r);
    let (code, out) = drift(r, &["review", "--accept", &ids]);
    assert_eq!(code, 0, "{out}");
    assert!(
        !read(r, "drift.lock").contains("app/api/r39/route.ts"),
        "the fixture needs r39 out of the lock"
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "accept"]);
    let lock = read(r, "drift.lock");
    let (code, out) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(code, 3, "{out}");
    assert!(out.contains("\n  0 appear only because"), "{out}");
    assert!(out.contains("was an undecided proposal at commit"), "{out}");
    assert_eq!(read(r, "drift.lock"), lock, "an accepted proposal's break was baselined");
}

/// Pins (review item 4): `drift export agents-md --write` keeps a CRLF AGENTS.md CRLF,
/// and `drift upgrade` then reads its block as current. Before, the CRLF block never
/// equalled the LF one, so the file read as "differs" (exit 3) forever.
#[test]
fn a_crlf_agents_file_reads_as_current() {
    let dir = app();
    let r = dir.path();
    write(r, "AGENTS.md", "# Agents\r\n\r\nBe nice.\r\n");
    let (code, out) = drift(r, &["export", "agents-md", "--write", "AGENTS.md"]);
    assert_eq!(code, 0, "{out}");
    assert!(read(r, "AGENTS.md").contains("\r\n<!-- drift:end -->"));
    let (_, out) = drift(r, &["upgrade"]);
    assert!(out.contains("AGENTS.md (agents-md): current"), "{out}");
    assert!(!out.contains("drift export agents-md --write AGENTS.md"), "{out}");
}

/// Pins (review item 5): a security baseline saved with a byte-order mark is read as
/// `drift check` reads it, not refused as broken (exit 2).
#[test]
fn a_security_baseline_with_a_byte_order_mark_is_read() {
    let dir = app();
    let r = dir.path();
    let (code, out) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{out}");
    let text = read(r, ".drift/security.lock");
    write(r, ".drift/security.lock", &format!("\u{feff}{text}"));
    let (code, out) = drift(r, &["upgrade"]);
    assert_ne!(code, 2, "{out}");
    assert!(!out.contains("is not a finding"), "{out}");
    assert!(
        out.contains(&format!(
            ".drift/security.lock: inventory {INVENTORY_VERSION} (this Drift"
        )),
        "{out}"
    );
}

/// Pins (lead's list): a security baseline stamped with an older inventory is a to-do
/// even when no finding of a newer kind is there today (a later one would fail
/// nothing), and `--apply --security-baseline` stamps it again with nothing else
/// changed. Before, the report said nothing was left to do.
#[test]
fn an_older_stamp_is_left_to_do() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "lib/a.ts", "export function a() {\n  return 1;\n}\n");
    assert!(INVENTORY_VERSION > 1);
    write(
        r,
        ".drift/security.lock",
        "# drift security baseline\n# inventory: 1\n# fail: no-guard\n",
    );
    let (code, out) = drift(r, &["upgrade"]);
    assert_eq!(code, 3, "{out}");
    assert!(out.contains(".drift/security.lock is stamped inventory 1"), "{out}");
    assert!(
        out.contains("(only with --security-baseline): drift upgrade --apply --security-baseline"),
        "{out}"
    );
    let (code, out) = drift(r, &["upgrade", "--apply", "--security-baseline"]);
    assert_eq!(code, 0, "{out}");
    let now = read(r, ".drift/security.lock");
    assert!(now.lines().any(|l| l == format!("# inventory: {INVENTORY_VERSION}")), "{now}");
    assert!(now.lines().any(|l| l == "# fail: no-guard"), "{now}");
}

/// Pins (review item 3): `drift feedback export --out` is refused for Drift's policy and
/// state however the path is spelled: through `..` (which `starts_with` read as inside
/// the feedback directory, or not under `.drift/` at all), in another letter case, through
/// a link to the lock, and for a policy file's name anywhere. Each refused write leaves
/// every file as it was; a path inside the feedback directory or outside `.drift/` is
/// still written. Before, `.drift/feedback/../conventions.yaml` and `x/../drift.lock`
/// were replaced with the feedback JSON.
#[test]
fn feedback_out_never_reaches_the_policy() {
    let dir = app();
    let r = dir.path();
    let policy = read(r, ".drift/conventions.yaml");
    let lock = read(r, "drift.lock");
    #[cfg(unix)]
    std::os::unix::fs::symlink("drift.lock", r.join("notes.json")).unwrap();
    let mut refused = vec![
        ".drift/feedback/../conventions.yaml",
        "x/../drift.lock",
        "./drift.lock",
        ".DRIFT/config.yaml",
        ".drift/feedback/../../drift.LOCK",
        "elsewhere/security.lock",
        "elsewhere/Conventions.yaml",
        ".drift/feedback",
    ];
    if cfg!(unix) {
        refused.push("notes.json");
    }
    for out in refused {
        let (code, text) = drift(r, &["feedback", "export", "--out", out]);
        assert_ne!(code, 0, "{out}: {text}");
        assert!(text.contains("is Drift's policy or state"), "{out}: {text}");
        assert_eq!(read(r, ".drift/conventions.yaml"), policy, "{out}");
        assert_eq!(read(r, "drift.lock"), lock, "{out}");
    }
    assert!(!r.join("elsewhere").exists());
    for out in [".drift/feedback/mine.json", "feedback.json", "x/../y.json"] {
        let (code, text) = drift(r, &["feedback", "export", "--out", out]);
        assert_eq!(code, 0, "{out}: {text}");
    }
    assert!(r.join(".drift/feedback/mine.json").is_file());
    assert!(r.join("y.json").is_file());
}

/// Pins (review item 3, the other paths a person names): `drift export agents-md
/// --write`, `drift export claude-settings --write` and `drift review --export-log` are
/// refused for the same paths. Before, `export agents-md --write x/../drift.lock`
/// replaced the lock with the agents block.
#[test]
fn other_written_paths_never_reach_the_policy() {
    let dir = app();
    let r = dir.path();
    let policy = read(r, ".drift/conventions.yaml");
    let lock = read(r, "drift.lock");
    for args in [
        &["export", "agents-md", "--write", "x/../drift.lock"][..],
        &["export", "agents-md", "--write", ".drift/feedback/../conventions.yaml"],
        &["export", "claude-settings", "--write", ".drift/settings.json"],
        &["review", "--export-log", "a/../drift.lock"],
    ] {
        let (code, text) = drift(r, args);
        assert_ne!(code, 0, "{args:?}: {text}");
        assert!(text.contains("is Drift's policy or state"), "{args:?}: {text}");
        assert_eq!(read(r, ".drift/conventions.yaml"), policy, "{args:?}");
        assert_eq!(read(r, "drift.lock"), lock, "{args:?}");
    }
    assert!(!r.join(".drift/settings.json").exists());
}
