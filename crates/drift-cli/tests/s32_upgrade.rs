//! `drift upgrade` (stream S32): after a newer Drift is installed, one report of what it
//! reads differently in the files an older Drift wrote, and `--apply` for only what
//! changes no decision a person made.
//!
//! The fixtures are `.drift/` files as an older Drift wrote them: a policy without
//! `accepted_evidence` (Drift kept it only from S8 on), a lock without the line of a
//! violation the older reading did not see, a security baseline without the inventory
//! stamp (as before S5), and `.claude/settings.json` as `drift export claude-settings`
//! wrote it before `drift practices promote` existed (no deny entry).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

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

/// `drift --no-cache ARGS` in `root`: exit code, stdout, stderr.
fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    drift_with(root, &["--no-cache"], args, &[])
}

/// `drift PRE ARGS` in `root` with `env` set: exit code, stdout, stderr.
fn drift_with(
    root: &Path,
    pre: &[&str],
    args: &[&str],
    env: &[(&str, &str)],
) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(pre)
        .args(args)
        .current_dir(root)
        .envs(env.iter().copied())
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
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Every file under `root` but `.git`, with its bytes and modification time.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, (Vec<u8>, SystemTime)> {
    fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<PathBuf, (Vec<u8>, SystemTime)>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.file_name().is_some_and(|n| n == ".git") {
                continue;
            }
            if p.is_dir() {
                walk(&p, root, out);
            } else {
                let meta = std::fs::metadata(&p).unwrap();
                out.insert(
                    p.strip_prefix(root).unwrap().to_path_buf(),
                    (std::fs::read(&p).unwrap(), meta.modified().unwrap()),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

const GUARDED: &str = "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// The policy without its `accepted_evidence` blocks: as a Drift from before S8 wrote it.
fn without_accepted_evidence(yaml: &str) -> String {
    let mut out = String::new();
    let mut skipping = false;
    for line in yaml.lines() {
        if line == "  accepted_evidence:" {
            skipping = true;
            continue;
        }
        if skipping && line.starts_with("    ") {
            continue;
        }
        skipping = false;
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// A Next.js app whose HTTP handlers are wrapped in `withAuth` but two (r38, r39),
/// after `drift init` and every proposal accepted, rewritten as an older Drift wrote
/// it; with `older_reading`, the lock lacks r39's lines, as a Drift whose reading did
/// not see that violation wrote it. Committed.
fn repo(older_reading: bool) -> tempfile::TempDir {
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
    // Functions outside the routes, so `withAuth` is measured as rarer elsewhere (the
    // miner's lift gate): with the routes alone no convention is mined, the lock holds
    // no violation and there is nothing for an upgrade to read differently.
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    write(r, ".gitignore", ".drift/cache/\n");
    let (code, out, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{out}{err}");
    let yaml = read(r, ".drift/conventions.yaml");
    let ids: Vec<&str> = yaml
        .split("- id: ")
        .skip(1)
        .filter(|b| b.contains("status: proposed"))
        .map(|b| &b[..8])
        .collect();
    assert!(!ids.is_empty(), "{yaml}");
    let (code, out, err) = drift(r, &["review", "--accept", &ids.join(",")]);
    assert_eq!(code, 0, "{out}{err}");
    let yaml = read(r, ".drift/conventions.yaml");
    write(
        r,
        ".drift/conventions.yaml",
        &without_accepted_evidence(&yaml),
    );
    let lock = read(r, "drift.lock");
    assert!(lock.contains("app/api/r39/route.ts#GET"), "{lock}");
    if older_reading {
        let older: String = lock
            .lines()
            .filter(|l| !l.contains("app/api/r39/route.ts"))
            .map(|l| format!("{l}\n"))
            .collect();
        write(r, "drift.lock", &older);
    }
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "drift as an older version wrote it"]);
    dir
}

/// Pins: the dry run reports the violation the older reading did not see as one that
/// appears only because the reading changed, says what each file records (and that the
/// lock records no Drift version), exits 3, and changes no byte and no modification time.
/// Before S32 there was no `drift upgrade`: the person met the violation in `drift check`
/// with nothing to say it was not their change.
#[test]
fn the_dry_run_reports_and_changes_no_byte() {
    let dir = repo(true);
    let r = dir.path();
    let before = snapshot(r);
    let (code, out, err) = drift(r, &["upgrade"]);
    assert_eq!(code, 3, "{out}{err}");
    assert!(
        out.contains(" appear only because this Drift reads the code differently")
            && !out.contains("\n  0 appear only because"),
        "{out}"
    );
    assert!(out.contains("app/api/r39/route.ts#GET (line "), "{out}");
    assert!(
        out.contains("newly violated by code that did not change: "),
        "{out}"
    );
    assert!(
        out.contains("when accepted: not recorded (accepted before Drift kept it)"),
        "{out}"
    );
    assert!(
        out.contains("  drift.lock: records no Drift version"),
        "{out}"
    );
    assert!(out.contains("Nothing was changed."), "{out}");
    assert!(
        out.contains("(drift upgrade --apply does it): drift upgrade --apply"),
        "{out}"
    );
    assert_eq!(before, snapshot(r), "the dry run changed a file");
}

/// Pins: `--apply` baselines the violation the reading added (its member line and its
/// fingerprint line), not the one in code added since (r40); it changes no decision
/// (the policy is byte-identical), and a second run changes nothing at all.
#[test]
fn apply_baselines_only_what_the_reading_added_and_twice_is_once() {
    let dir = repo(true);
    let r = dir.path();
    write(r, "app/api/r40/route.ts", UNGUARDED);
    let policy = read(r, ".drift/conventions.yaml");
    let (_, out, err) = drift(r, &["upgrade", "--apply"]);
    let lock = read(r, "drift.lock");
    assert!(
        lock.lines()
            .any(|l| l.ends_with(" app/api/r39/route.ts#GET") && !l.contains('~')),
        "{out}{err}\n{lock}"
    );
    assert!(
        lock.lines()
            .any(|l| (l.starts_with("#~ ") || l.contains(" ~"))
                && l.ends_with(" app/api/r39/route.ts#GET")),
        "{lock}"
    );
    assert!(
        !lock.contains("r40"),
        "a change's violation was baselined:\n{lock}"
    );
    assert_eq!(
        read(r, ".drift/conventions.yaml"),
        policy,
        "a decision changed"
    );
    assert!(out.contains("Done\n  - baselined "), "{out}");

    let after = snapshot(r);
    let (_, out, err) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(
        after,
        snapshot(r),
        "a second --apply changed a file: {out}{err}"
    );
    let (_, out, _) = drift(r, &["upgrade"]);
    assert!(
        out.contains("0 appear only because this Drift reads the code differently"),
        "{out}"
    );
    assert!(
        out.contains(" in code that changed since") && !out.contains("\n  0 in code that changed"),
        "{out}"
    );
}

/// Pins: a policy, or a security baseline, written by a newer Drift is refused with the
/// upgrade advice, exit 2, and nothing is changed, `--apply` included.
#[test]
fn files_of_a_newer_drift_are_refused() {
    let dir = repo(true);
    let r = dir.path();
    let yaml = read(r, ".drift/conventions.yaml");
    let newer = yaml.replacen("version: 1\n", "version: 9\n", 1);
    assert_ne!(newer, yaml, "{yaml}");
    write(r, ".drift/conventions.yaml", &newer);
    let before = snapshot(r);
    let (code, out, err) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(code, 2, "{out}{err}");
    assert!(out.contains("was written by a newer Drift"), "{out}");
    assert!(out.contains("nothing was changed"), "{out}");
    assert_eq!(before, snapshot(r));

    write(r, ".drift/conventions.yaml", &yaml);
    write(
        r,
        ".drift/security.lock",
        "# drift security baseline\n# inventory: 99\n# fail: no-guard\nno-guard\tapp/api/r38/route.ts#GET GET /api/r38\n",
    );
    let before = snapshot(r);
    let (code, out, _) = drift(r, &["upgrade", "--apply", "--security-baseline"]);
    assert_eq!(code, 2, "{out}");
    assert!(
        out.contains(".drift/security.lock was written by a newer Drift (inventory 99"),
        "{out}"
    );
    assert_eq!(before, snapshot(r));
}

/// Pins: a half-written `drift.lock` is named with the line that is not a lock line, and
/// nothing is changed (`Lock::load` would skip the line; an upgrade that writes the
/// file must not).
#[test]
fn a_half_written_lock_is_named_with_its_line() {
    let dir = repo(true);
    let r = dir.path();
    let lock = read(r, "drift.lock");
    write(r, "drift.lock", &format!("{lock}D-abc"));
    let n = lock.lines().count() + 1;
    let before = snapshot(r);
    let (code, out, _) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(code, 2, "{out}");
    assert!(
        out.contains(&format!("drift.lock line {n}: `D-abc`")),
        "{out}"
    );
    assert_eq!(before, snapshot(r));
}

/// The permission entries `drift export claude-settings` wrote before `drift practices
/// promote` existed (`git show 1d4f5265:crates/drift-cli/src/lookup.rs`).
const OLDER_ALLOW: &[&str] = &[
    "Bash(drift card:*)",
    "Bash(drift map:*)",
    "Bash(drift example:*)",
    "Bash(drift check:*)",
    "Bash(drift practices:*)",
    "mcp__drift__drift_rules_for",
    "mcp__drift__drift_example",
    "mcp__drift__drift_check",
    "mcp__drift__drift_explain",
    "mcp__drift__drift_map",
    "mcp__drift__drift_card",
    "mcp__drift__drift_security",
    "mcp__drift__drift_practices",
    "mcp__drift__drift_setup_questions",
    "mcp__drift__drift_investigate_items",
];

fn settings(allow: &[&str]) -> String {
    let mut allow: Vec<&str> = allow.to_vec();
    allow.push("Bash(ls:*)");
    let mut t = serde_json::to_string_pretty(&serde_json::json!({
        "permissions": { "allow": allow },
        "theme": "dark",
    }))
    .unwrap();
    t.push('\n');
    t
}

/// Pins: settings an older Drift wrote and nobody edited are refreshed (the deny entry
/// that keeps `drift practices promote` from being pre-approved is added; the person's
/// own entries and keys are kept); settings that lack one of Drift's older entries were
/// edited by a person and are left byte for byte, with the command to refresh them.
#[test]
fn older_settings_are_refreshed_and_edited_ones_left() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, ".claude/settings.json", &settings(OLDER_ALLOW));
    let edited = settings(&OLDER_ALLOW[1..]);
    write(r, ".claude/settings.local.json", &edited);
    let (code, out, _) = drift(r, &["upgrade"]);
    assert_eq!(code, 3, "{out}");
    assert!(
        out.contains(".claude/settings.json (claude-settings): older"),
        "{out}"
    );
    assert!(
        out.contains(".claude/settings.local.json (claude-settings): edited"),
        "{out}"
    );

    let (code, out, _) = drift(r, &["upgrade", "--apply"]);
    // What is left is the edited file, for a person.
    assert_eq!(code, 3, "{out}");
    assert!(
        out.contains("drift export claude-settings --write .claude/settings.local.json"),
        "{out}"
    );
    let v: Value = serde_json::from_str(&read(r, ".claude/settings.json")).unwrap();
    assert_eq!(
        v["permissions"]["deny"],
        serde_json::json!(["Bash(drift practices promote:*)"]),
        "{v}"
    );
    let allow = v["permissions"]["allow"].as_array().unwrap();
    assert!(allow.contains(&Value::from("Bash(ls:*)")), "{v}");
    assert_eq!(v["theme"], "dark", "{v}");
    assert_eq!(read(r, ".claude/settings.local.json"), edited);

    // Refreshed once: the next run finds it current and writes nothing.
    let after = snapshot(r);
    let (_, out, _) = drift(r, &["upgrade", "--apply"]);
    assert!(
        out.contains(".claude/settings.json (claude-settings): current"),
        "{out}"
    );
    assert_eq!(after, snapshot(r));
}

/// Pins: an unstamped security baseline (as before S5) is read as inventory 1 and left
/// byte for byte by `--apply`; only `--security-baseline` writes it, stamped, with every
/// finding it held.
#[test]
fn the_security_baseline_is_touched_only_when_asked() {
    let dir = repo(false);
    let r = dir.path();
    let (code, out, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{out}{err}");
    let stamped = read(r, ".drift/security.lock");
    let findings: Vec<&str> = stamped.lines().filter(|l| !l.starts_with('#')).collect();
    assert!(!findings.is_empty(), "{stamped}");
    let older: String = stamped
        .lines()
        .filter(|l| !l.starts_with("# inventory:") && !l.starts_with("# fail:"))
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, ".drift/security.lock", &older);

    let (_, out, _) = drift(r, &["upgrade", "--apply"]);
    assert!(out.contains("inventory 1 (no stamp)"), "{out}");
    assert_eq!(read(r, ".drift/security.lock"), older);

    let (_, out, err) = drift(r, &["upgrade", "--apply", "--security-baseline"]);
    let now = read(r, ".drift/security.lock");
    assert!(
        now.lines()
            .any(|l| l.starts_with("# inventory: ") && l != "# inventory: 1"),
        "{out}{err}\n{now}"
    );
    for f in &findings {
        assert!(now.lines().any(|l| l == *f), "{f} was dropped:\n{now}");
    }
}

/// Pins: `--json` is the same document on every run (sorted, no time), with the
/// documented schema and the three groups of new violations.
#[test]
fn the_json_report_is_deterministic() {
    let dir = repo(true);
    let r = dir.path();
    let (code, a, err) = drift(r, &["upgrade", "--json"]);
    assert_eq!(code, 3, "{a}{err}");
    let (_, b, _) = drift(r, &["upgrade", "--json"]);
    assert_eq!(a, b);
    let v: Value = serde_json::from_str(&a).unwrap();
    assert_eq!(v["schema"], "drift-upgrade");
    assert_eq!(v["version"], 1);
    assert_eq!(v["pending"], true);
    let reading = v["violations"]["reading_only"].as_array().unwrap();
    assert!(!reading.is_empty(), "{v}");
    assert!(
        reading
            .iter()
            .all(|r| r["member"] == "app/api/r39/route.ts#GET"),
        "{v}"
    );
    assert!(
        v["violations"]["changed_code"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let lock = v["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "drift.lock")
        .unwrap();
    assert!(lock.get("written_by").is_none(), "{lock}");
    assert!(
        v["conventions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["accepted"].is_null()),
        "{v}"
    );
}

/// Pins: where there is no git history (the checkout's `.git` gone, and git kept from
/// looking above it), every new violation is one Drift cannot tell about, and `--apply`
/// baselines none of them: `drift.lock` keeps every byte. Before this was pinned, a
/// failure of git could have read as "nothing changed since", which baselines.
#[test]
fn without_git_nothing_is_baselined() {
    let dir = repo(true);
    let r = dir.path();
    std::fs::remove_dir_all(r.join(".git")).unwrap();
    let ceiling = r.parent().unwrap().to_string_lossy().into_owned();
    let env = [("GIT_CEILING_DIRECTORIES", ceiling.as_str())];
    let lock = read(r, "drift.lock");
    let (code, out, err) = drift_with(r, &["--no-cache"], &["upgrade", "--apply"], &env);
    assert_eq!(code, 3, "{out}{err}");
    assert!(out.contains("\n  0 appear only because"), "{out}");
    assert!(
        out.contains("there is no git history to compare with"),
        "{out}"
    );
    assert!(out.contains("app/api/r39/route.ts#GET (line "), "{out}");
    assert!(!out.contains("\nDone\n"), "{out}");
    assert_eq!(
        read(r, "drift.lock"),
        lock,
        "a violation Drift cannot tell about was baselined"
    );
}

/// Pins: in a shallow clone, the commit that baselined a convention may be missing, so
/// every new violation is one Drift cannot tell about and `--apply` baselines none.
#[test]
fn a_shallow_clone_baselines_nothing() {
    let dir = repo(true);
    let r = dir.path();
    // A second commit, so a clone of depth 1 is cut short.
    write(r, "lib/more.ts", "export const more = 1;\n");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "more"]);
    let parent = tempfile::tempdir().unwrap();
    let url = format!("file://{}", r.display());
    git(parent.path(), &["clone", "-q", "--depth", "1", &url, "c"]);
    let c = parent.path().join("c");
    let lock = read(&c, "drift.lock");
    let (code, out, err) = drift(&c, &["upgrade", "--apply"]);
    assert_eq!(code, 3, "{out}{err}");
    assert!(out.contains("the clone is shallow"), "{out}");
    assert!(out.contains("\n  0 appear only because"), "{out}");
    assert_eq!(
        read(&c, "drift.lock"),
        lock,
        "a shallow clone's violation was baselined"
    );
}

/// Pins: a line a person took out of `drift.lock` (here, only in the working copy) is
/// their decision: the violation it held is one Drift cannot tell about, and `--apply`
/// does not put the line back.
#[test]
fn a_lock_line_a_person_took_out_is_not_put_back() {
    let dir = repo(false);
    let r = dir.path();
    let lock: String = read(r, "drift.lock")
        .lines()
        .filter(|l| !l.contains("app/api/r39/route.ts"))
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, "drift.lock", &lock);
    let (code, out, err) = drift(r, &["upgrade", "--apply"]);
    assert_eq!(code, 3, "{out}{err}");
    assert!(out.contains("\n  0 appear only because"), "{out}");
    assert!(out.contains("app/api/r39/route.ts#GET (line "), "{out}");
    assert_eq!(read(r, "drift.lock"), lock);
}

/// Pins: the dry run with the fact cache on changes no file Drift reads as policy and
/// prints the same report before and after the cache exists (the cache row says
/// whether the cache is in use, not whether this run created its directory).
#[test]
fn the_dry_run_reads_the_same_with_the_cache() {
    let dir = repo(true);
    let r = dir.path();
    let policy = read(r, ".drift/conventions.yaml");
    let lock = read(r, "drift.lock");
    let (code, a, err) = drift_with(r, &[], &["upgrade", "--json"], &[]);
    assert_eq!(code, 3, "{a}{err}");
    let (_, b, _) = drift_with(r, &[], &["upgrade", "--json"], &[]);
    assert_eq!(a, b, "the first run's cache changed the report");
    assert_eq!(read(r, ".drift/conventions.yaml"), policy);
    assert_eq!(read(r, "drift.lock"), lock);
}
