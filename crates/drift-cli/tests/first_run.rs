//! What a new user meets on the first run: the fact cache stays out of git, and
//! a repository with nothing to learn says why.

use std::path::Path;
use std::process::Command;

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

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

fn tiny_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"tiny\" }");
    for i in 0..3 {
        write(
            r,
            &format!("src/f{i}.ts"),
            &format!("export function f{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

#[test]
fn cache_dir_is_ignored_by_git() {
    let dir = tiny_repo();
    let r = dir.path();
    drift(r, &["scan", "--no-cache"]);
    assert!(!r.join(".drift").exists(), "--no-cache writes nothing");

    drift(r, &["scan"]);
    let ignore = std::fs::read_to_string(r.join(".drift/cache/.gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l == "*"), "{ignore}");
    // The marker is written once and left alone afterwards.
    std::fs::write(r.join(".drift/cache/.gitignore"), "*\n# kept\n").unwrap();
    drift(r, &["scan"]);
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/cache/.gitignore")).unwrap(),
        "*\n# kept\n"
    );
}

#[test]
fn nothing_to_learn_says_why() {
    let dir = tiny_repo();
    let r = dir.path();
    for out in [drift(r, &["census"]), drift(r, &["init"])] {
        let reason = out
            .lines()
            .find(|l| l.starts_with("No conventions found:"))
            .unwrap_or_else(|| panic!("no reason in:\n{out}"));
        assert!(reason.contains("roughly 20+"), "{reason}");
        assert!(
            reason.contains("the largest role here has 3 members"),
            "{reason}"
        );
        assert!(!out.contains("Next: `drift review`"), "{out}");
    }
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// A repo whose routes are wrapped in `withAuth`, that convention in block mode,
/// and (with `violate`) one new route without it.
fn blocking_repo(violate: bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        let body = if i < 37 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    drift(r, &["init"]);
    let census: serde_json::Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .expect("withAuth convention")["id"]
        .as_str()
        .unwrap()
        .to_string();
    drift(r, &["review", "--block", &id]);
    if violate {
        write(r, "app/api/new/route.ts", UNGUARDED);
    }
    dir
}

#[test]
fn reinit_says_decisions_are_kept() {
    let dir = blocking_repo(false);
    let r = dir.path();
    let out = drift(r, &["init"]);
    assert!(
        out.contains("(1 earlier decision(s) kept; the rest are proposed"),
        "{out}"
    );
    assert!(!out.contains("(all proposed"), "{out}");
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(policy.contains("status: accepted"), "{policy}");
}

/// Run with stdout connected to a pipe whose reader is already closed.
fn run_into_closed_pipe(root: &Path, args: &[&str]) -> (Option<i32>, String) {
    let (reader, writer) = std::io::pipe().unwrap();
    drop(reader);
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdout(writer)
        .output()
        .unwrap();
    (
        out.status.code(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn check_keeps_its_exit_code_when_stdout_closes() {
    let bad = blocking_repo(true);
    let clean = blocking_repo(false);
    for format in ["text", "json", "sarif"] {
        let args = ["check", "--format", format];
        let (code, err) = run_into_closed_pipe(bad.path(), &args);
        assert_eq!(
            code,
            Some(1),
            "{format}: blocking violations must fail: {err}"
        );
        assert!(
            !err.contains("panicked") && !err.contains("Broken pipe"),
            "{err}"
        );
        let (code, err) = run_into_closed_pipe(clean.path(), &args);
        assert_eq!(code, Some(0), "{format}: nothing blocks: {err}");
    }
    // Read-only commands report the broken pipe as the shell does (128 + SIGPIPE).
    for args in [&["census"][..], &["census", "--json"], &["security"]] {
        let (code, err) = run_into_closed_pipe(bad.path(), args);
        assert_eq!(code, Some(141), "{args:?}: {err}");
        assert!(!err.contains("panicked"), "{err}");
    }
}

#[cfg(unix)]
mod symlinks {
    use super::*;
    use std::os::unix::fs::symlink;

    fn is_empty(dir: &Path) -> bool {
        std::fs::read_dir(dir).unwrap().next().is_none()
    }

    #[test]
    fn dangling_marker_link_creates_nothing_outside() {
        let dir = tiny_repo();
        let r = dir.path();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("git").join("ignore");
        std::fs::create_dir_all(r.join(".drift/cache")).unwrap();
        symlink(&target, r.join(".drift/cache/.gitignore")).unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        for args in [&["scan"][..], &["census"], &["init"]] {
            let out = Command::new(&*BIN)
                .args(args)
                .current_dir(r)
                .env_remove("DRIFT_CACHE_DIR")
                .output()
                .unwrap();
            assert!(out.status.success(), "{args:?}: {out:?}");
            assert!(!target.exists(), "{args:?} wrote through the link");
            let err = String::from_utf8_lossy(&out.stderr);
            assert!(err.contains("running without the fact cache"), "{err}");
        }
        assert!(is_empty(target.parent().unwrap()));
    }

    #[test]
    fn linked_cache_dir_is_not_used() {
        let dir = tiny_repo();
        let r = dir.path();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(r.join(".drift")).unwrap();
        symlink(outside.path(), r.join(".drift/cache")).unwrap();
        drift(r, &["scan"]);
        drift(r, &["init"]);
        assert!(
            is_empty(outside.path()),
            "the cache was written outside the repo"
        );

        // The hooks keep their session state there too: still nothing outside.
        let input = serde_json::json!({
            "session_id": "s1",
            "cwd": r,
            "hook_event_name": "SessionStart",
            "source": "startup",
        });
        let mut child = Command::new(&*BIN)
            .args(["hook", "claude", "SessionStart"])
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        {
            use std::io::Write;
            let mut stdin = child.stdin.take().unwrap();
            stdin.write_all(input.to_string().as_bytes()).unwrap();
        }
        assert!(child.wait_with_output().unwrap().status.success());
        assert!(
            is_empty(outside.path()),
            "session state was written outside the repo"
        );
    }

    #[test]
    fn linked_dir_inside_the_cache_is_not_used() {
        let dir = tiny_repo();
        let r = dir.path();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(r.join(".drift/cache")).unwrap();
        symlink(
            outside.path(),
            r.join(format!(
                ".drift/cache/facts-v{}",
                drift_core::FACTS_SCHEMA_VERSION
            )),
        )
        .unwrap();
        drift(r, &["scan"]);
        assert!(
            is_empty(outside.path()),
            "facts were written outside the repo"
        );
    }
}

#[cfg(unix)]
mod policy_links {
    use super::*;
    use std::os::unix::fs::symlink;

    fn run(root: &Path, args: &[&str]) -> std::process::Output {
        Command::new(&*BIN)
            .args(args)
            .current_dir(root)
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap()
    }

    fn assert_refused(out: &std::process::Output, what: &str) {
        assert_eq!(out.status.code(), Some(2), "{what}: {out:?}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("is a symbolic link"), "{what}: {err}");
    }

    /// A file outside the repository that a link in the repository points to.
    fn victim() -> (tempfile::TempDir, std::path::PathBuf) {
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("bashrc");
        std::fs::write(&file, "export KEEP=1\n").unwrap();
        (outside, file)
    }

    fn unchanged(file: &Path) {
        assert_eq!(std::fs::read_to_string(file).unwrap(), "export KEEP=1\n");
    }

    #[test]
    fn linked_conventions_file_is_never_written() {
        let repo = blocking_repo(false);
        let r = repo.path();
        let conv = r.join(".drift/conventions.yaml");
        // The link's target parses as a policy, so init and review get as far as saving.
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("conventions.yaml");
        let original = std::fs::read_to_string(&conv).unwrap();
        std::fs::write(&file, &original).unwrap();
        std::fs::remove_file(&conv).unwrap();
        symlink(&file, &conv).unwrap();
        assert_refused(&run(r, &["init"]), "init");
        let id = original
            .lines()
            .find_map(|l| l.trim().strip_prefix("- id: "))
            .expect("a convention id");
        assert_refused(&run(r, &["review", "--reject", id]), "review");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), original);
        // A target that is not a policy fails to parse: still never written.
        let (_victim_dir, victim) = victim();
        std::fs::remove_file(&conv).unwrap();
        symlink(&victim, &conv).unwrap();
        assert_eq!(run(r, &["init"]).status.code(), Some(2));
        unchanged(&victim);
    }

    #[test]
    fn linked_lock_is_never_written() {
        let repo = blocking_repo(false);
        let r = repo.path();
        let (_outside, file) = victim();
        std::fs::remove_file(r.join("drift.lock")).unwrap();
        symlink(&file, r.join("drift.lock")).unwrap();
        assert_refused(&run(r, &["init"]), "init");
        unchanged(&file);
    }

    #[test]
    fn linked_drift_dir_is_never_written() {
        let dir = tiny_repo();
        let r = dir.path();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), r.join(".drift")).unwrap();
        assert_refused(&run(r, &["init"]), "init");
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[test]
    fn export_checks_absolute_paths_and_allows_links_inside_the_repo() {
        let repo = blocking_repo(false);
        let r = repo.path();
        let (_outside, file) = victim();
        symlink(&file, r.join("AGENTS.md")).unwrap();
        let abs = r.join("AGENTS.md");
        let abs = abs.to_str().unwrap();
        assert_refused(
            &run(r, &["export", "agents-md", "--write", abs]),
            "absolute path",
        );
        unchanged(&file);

        // CLAUDE.md -> AGENTS.md stays inside the repo: AGENTS.md is updated, the link kept.
        std::fs::remove_file(r.join("AGENTS.md")).unwrap();
        std::fs::write(r.join("AGENTS.md"), "# Agents\n").unwrap();
        symlink("AGENTS.md", r.join("CLAUDE.md")).unwrap();
        let out = run(r, &["export", "agents-md", "--write", "CLAUDE.md"]);
        assert!(out.status.success(), "{out:?}");
        let meta = std::fs::symlink_metadata(r.join("CLAUDE.md")).unwrap();
        assert!(meta.file_type().is_symlink(), "the link is kept");
        let md = std::fs::read_to_string(r.join("AGENTS.md")).unwrap();
        assert!(
            md.starts_with("# Agents\n") && md.contains("drift:start"),
            "{md}"
        );
    }

    #[test]
    fn linked_agents_md_is_never_written() {
        let repo = blocking_repo(false);
        let r = repo.path();
        let (_outside, file) = victim();
        symlink(&file, r.join("AGENTS.md")).unwrap();
        assert_refused(
            &run(r, &["export", "agents-md", "--write", "AGENTS.md"]),
            "export",
        );
        unchanged(&file);
        // A regular file is still updated in place.
        std::fs::remove_file(r.join("AGENTS.md")).unwrap();
        std::fs::write(r.join("AGENTS.md"), "# Agents\n").unwrap();
        assert!(
            run(r, &["export", "agents-md", "--write", "AGENTS.md"])
                .status
                .success()
        );
        let md = std::fs::read_to_string(r.join("AGENTS.md")).unwrap();
        assert!(
            md.starts_with("# Agents\n") && md.contains("drift:start"),
            "{md}"
        );
    }
}

fn git(root: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(root)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The file named `<hash>.json` somewhere under `dir`.
fn cache_entry(dir: &Path, hash: &str) -> Option<std::path::PathBuf> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(found) = cache_entry(&p, hash) {
                return Some(found);
            }
        } else if p
            .file_name()
            .is_some_and(|n| n == format!("{hash}.json").as_str())
        {
            return Some(p);
        }
    }
    None
}

fn hash_of(root: &Path, file: &str) -> String {
    let facts: serde_json::Value = serde_json::from_str(&drift(root, &["facts", file])).unwrap();
    facts["hash"].as_str().unwrap().to_string()
}

#[test]
fn a_committed_cache_cannot_hide_a_violation() {
    let repo = blocking_repo(true);
    let r = repo.path();
    if !git(r, &["init", "-q"]) {
        eprintln!("git not available: skipped");
        return;
    }
    let bad = "app/api/new/route.ts";
    let (_, err) = run_into_closed_pipe(r, &["check"]);
    assert!(err.is_empty(), "{err}");
    // Forge: the violating file's cache entry gets the facts of a wrapped route.
    let cache = r.join(".drift/cache");
    let good = cache_entry(&cache, &hash_of(r, "app/api/r00/route.ts")).unwrap();
    let forged = cache_entry(&cache, &hash_of(r, bad)).unwrap();
    std::fs::copy(&good, &forged).unwrap();
    assert!(git(r, &["add", "-A"]));
    assert!(git(r, &["add", "-f", forged.to_str().unwrap()]));
    assert!(git(r, &["commit", "-qm", "forged cache"]));

    // A fresh clone, as CI checks out a pull request.
    let ci = tempfile::tempdir().unwrap();
    let clone = ci.path().join("clone");
    assert!(git(
        ci.path(),
        &["clone", "-q", r.to_str().unwrap(), "clone"]
    ));
    let check = |cache_env: Option<&Path>| {
        let mut cmd = Command::new(&*BIN);
        cmd.arg("check")
            .current_dir(&clone)
            .env_remove("DRIFT_CACHE_DIR");
        if let Some(dir) = cache_env {
            cmd.env("DRIFT_CACHE_DIR", dir);
        }
        cmd.output().unwrap()
    };
    // The forgery works when that cache is used on purpose ...
    let fooled = check(Some(&clone.join(".drift/cache")));
    assert_eq!(
        fooled.status.code(),
        Some(0),
        "the forged entry should hide it: {fooled:?}"
    );
    // ... and by default the tracked cache is ignored, so the violation still fails.
    let out = check(None);
    assert_eq!(out.status.code(), Some(1), "{out:?}");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("git tracks files under .drift/cache"), "{err}");
    assert!(String::from_utf8_lossy(&out.stdout).contains(bad));
}

#[test]
fn hooks_deny_agent_writes_under_drift() {
    let repo = blocking_repo(false);
    let r = repo.path();
    for rel in [
        ".drift/cache/x",
        ".drift/cache/sessions/s1.json",
        ".drift/conventions.yaml",
        "drift.lock",
    ] {
        let input = serde_json::json!({
            "session_id": "s1",
            "cwd": r,
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "tool_input": { "file_path": r.join(rel), "content": "{}" },
        });
        let mut child = Command::new(&*BIN)
            .args(["hook", "claude", "PreToolUse"])
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        {
            use std::io::Write;
            let mut stdin = child.stdin.take().unwrap();
            stdin.write_all(input.to_string().as_bytes()).unwrap();
        }
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success());
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(
            v["hookSpecificOutput"]["permissionDecision"], "deny",
            "{rel}: {v}"
        );
    }
}

/// `drift` with its exit code, stdout and stderr; never asserts success.
fn run_full(root: &Path, args: &[&str]) -> (Option<i32>, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code(),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
    )
}

/// Pipe a Claude Code hook event into `drift hook claude <event>`, as the plugin does.
fn hook(
    root: &Path,
    event: &str,
    extra: serde_json::Value,
    cache: Option<&Path>,
) -> Option<serde_json::Value> {
    use std::io::Write;
    let mut input =
        serde_json::json!({ "session_id": "first", "cwd": root, "hook_event_name": event });
    for (k, v) in extra.as_object().unwrap() {
        input[k] = v.clone();
    }
    let mut cmd = Command::new(&*BIN);
    cmd.args(["hook", "claude", event])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped());
    if let Some(dir) = cache {
        cmd.env("DRIFT_CACHE_DIR", dir);
    }
    let mut child = cmd.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "{event}: {out:?}");
    let text = String::from_utf8(out.stdout).unwrap();
    (!text.trim().is_empty()).then(|| serde_json::from_str(&text).unwrap())
}

/// The id of the `withAuth` convention of `blocking_repo`.
fn with_auth_id(root: &Path) -> String {
    let policy = std::fs::read_to_string(root.join(".drift/conventions.yaml")).unwrap();
    let census: serde_json::Value =
        serde_json::from_str(&drift(root, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(policy.contains(&id), "{policy}");
    id
}

#[test]
fn session_state_stays_out_of_git_with_a_cache_dir() {
    let repo = blocking_repo(false);
    let r = repo.path();
    // The fact cache elsewhere (as in CI, or a private DRIFT_CACHE_DIR): Drift never
    // makes `.drift/cache` for facts, but the hooks still keep session state there.
    std::fs::remove_dir_all(r.join(".drift/cache")).unwrap();
    let facts = tempfile::tempdir().unwrap();
    hook(
        r,
        "SessionStart",
        serde_json::json!({ "source": "startup" }),
        Some(facts.path()),
    )
    .unwrap();
    assert!(r.join(".drift/cache/sessions/first.json").exists());
    let ignore = std::fs::read_to_string(r.join(".drift/cache/.gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l == "*"), "{ignore}");
    if git(r, &["init", "-q"]) {
        let out = Command::new("git")
            .args(["status", "--porcelain", "--untracked-files=all"])
            .current_dir(r)
            .output()
            .unwrap();
        let status = String::from_utf8(out.stdout).unwrap();
        assert!(!status.contains(".drift/cache"), "{status}");
    }
}

#[test]
fn the_end_of_turn_guard_says_why_it_steps_aside() {
    let repo = blocking_repo(false);
    let r = repo.path();
    let stop = |active: bool| {
        hook(
            r,
            "Stop",
            serde_json::json!({ "stop_hook_active": active }),
            None,
        )
    };
    hook(
        r,
        "SessionStart",
        serde_json::json!({ "source": "startup" }),
        None,
    )
    .unwrap();
    write(r, "app/api/n1/route.ts", UNGUARDED);
    assert_eq!(stop(false).unwrap()["decision"], "block");
    // The same violations again: no progress.
    let out = stop(true).unwrap();
    assert!(out.get("decision").is_none(), "{out}");
    let msg = out["systemMessage"].as_str().unwrap();
    assert!(
        msg.starts_with("drift: 1 unresolved violation(s) of "),
        "{msg}"
    );
    assert!(msg.contains("left for review: drift stopped blocking the end of the turn (no progress since its last block)"), "{msg}");
    assert!(msg.contains("`drift check` still fails on them"), "{msg}");
    assert!(!msg.contains("CI will also report"), "{msg}");
    // Two more blocks on new violations, then the session's limit.
    for n in ["n2", "n3"] {
        write(r, &format!("app/api/{n}/route.ts"), UNGUARDED);
        assert_eq!(stop(false).unwrap()["decision"], "block", "{n}");
    }
    write(r, "app/api/n4/route.ts", UNGUARDED);
    let out = stop(false).unwrap();
    assert!(out.get("decision").is_none(), "{out}");
    let msg = out["systemMessage"].as_str().unwrap();
    assert!(
        msg.contains("(it already blocked 3 times this session)"),
        "{msg}"
    );
}

#[test]
fn first_run_texts_name_the_next_step() {
    let repo = blocking_repo(true);
    let r = repo.path();
    let id = with_auth_id(r);
    // A fresh init says proposals are not checked at all, not that they advise.
    std::fs::remove_file(r.join(".drift/conventions.yaml")).unwrap();
    std::fs::remove_file(r.join("drift.lock")).unwrap();
    let init = drift(r, &["init"]);
    assert!(
        init.contains("(all proposed: none is checked until you accept it with `drift review`; accepted conventions advise unless set to block)"),
        "{init}"
    );
    assert!(!init.contains("only advise until"), "{init}");

    // The census is a preview and says what writes it.
    let census = drift(r, &["census"]);
    assert!(census.trim_end().ends_with(
        "Preview only: nothing was written. Next: `drift init` writes these to .drift/conventions.yaml as proposals (keeping decisions already made), then `drift review` decides them."
    ), "{census}");

    // Review: an unknown id says where the ids are; the counts say how many block.
    let (code, _, err) = run_full(r, &["review", "--accept", "D-nope00"]);
    assert_eq!(code, Some(2), "{err}");
    assert!(err.contains("unknown convention D-nope00, nothing was changed. The ids are in .drift/conventions.yaml"), "{err}");
    let blocked = drift(r, &["review", "--block", &id]);
    assert!(blocked.starts_with("1 accepted (1 block), "), "{blocked}");
    let reinit = drift(r, &["init"]);
    assert!(
        reinit.contains("the rest are proposed: none is checked until you accept it"),
        "{reinit}"
    );
    // The re-init baselined app/api/new: a newer route is new.
    write(r, "app/api/newer/route.ts", UNGUARDED);
    let (_, out, _) = run_full(r, &["check"]);
    assert!(out.contains("\nFix: make the code follow the `like` example. Intentional exception: add `// drift-ignore <id>: <reason>`"), "{out}");
    let advised = drift(r, &["review", "--advise", &id]);
    assert!(advised.starts_with("1 accepted (0 block), "), "{advised}");

    // A clean check has nothing to fix.
    std::fs::remove_dir_all(r.join("app/api/newer")).unwrap();
    let (code, out, _) = run_full(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
    assert!(!out.contains("Fix:"), "{out}");

    // Export says whether it created the file or updated it.
    let created = drift(r, &["export", "agents-md", "--write", "AGENTS.md"]);
    assert_eq!(created.trim(), "created AGENTS.md");
    let updated = drift(r, &["export", "agents-md", "--write", "AGENTS.md"]);
    assert_eq!(updated.trim(), "updated AGENTS.md");
}

#[test]
fn every_command_a_new_user_runs_has_help_examples() {
    let repo = blocking_repo(false);
    let r = repo.path();
    for (cmd, example) in [
        ("init", "drift init --max 30"),
        ("census", "drift census --tier default"),
        ("review", "drift review --block D-37416b"),
        ("check", "drift check --diff-base origin/main"),
        ("example", "drift example app/api/new-thing/route.ts"),
        ("security", "drift security --json"),
        ("hook", "| drift hook claude SessionStart"),
        ("mcp", "claude mcp add drift -- drift mcp"),
        ("export", "drift export agents-md --write AGENTS.md"),
    ] {
        let help = drift(r, &[cmd, "--help"]);
        assert!(help.contains(example), "{cmd}:\n{help}");
    }
    // The hook example works as written, from the repository root.
    let help = drift(r, &["hook", "--help"]);
    let json = help
        .lines()
        .find_map(|l| l.trim().strip_prefix("echo '"))
        .and_then(|l| l.split('\'').next())
        .unwrap();
    let mut child = Command::new(&*BIN)
        .args(["hook", "claude", "SessionStart"])
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut child.stdin.take().unwrap(), json.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let context = v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        context
            .lines()
            .any(|l| l.starts_with("Drift: 1 of this repo's 1 accepted conventions block")),
        "{context}"
    );
}
