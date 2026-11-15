//! What the hooks answer does not depend on how they get there: the security
//! inventory is read beside the practice map, repository-level results are kept on
//! disk between hook processes, and none of that may show in an answer. Each test
//! plays edits through `drift hook claude` and checks the answers are those of the
//! code as it is on disk at that moment: after a second edit, after the kept results
//! are damaged, and against a run that keeps nothing.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// The hook's whole standard output (empty when it says nothing), with `env` set.
fn hook_raw(root: &Path, session: &str, event: &str, extra: Value, env: &[(&str, &str)]) -> String {
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .envs(env.iter().copied())
        .args(["hook", "claude", event])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "hooks always exit 0: {out:?}");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// What the hook tells the agent (`additionalContext`), if anything.
fn hook(root: &Path, session: &str, event: &str, extra: Value) -> Option<String> {
    said(&hook_raw(root, session, event, extra, &[]))
}

fn said(out: &str) -> Option<String> {
    if out.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(out).expect("hook output is JSON");
    assert!(v.get("decision").is_none(), "facts never block: {v}");
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .map(str::to_string)
}

/// What the hook tells the person (`systemMessage`), if anything.
fn told_person(out: &str) -> Option<String> {
    if out.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(out).expect("hook output is JSON");
    v["systemMessage"].as_str().map(str::to_string)
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn wrote(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Write", "tool_input": { "file_path": root.join(rel) } })
}

const GUARDED: &str = "from fastapi import APIRouter\nfrom app.deps import CurrentUser\n\nrouter = APIRouter()\n\n\n@router.get(\"/things\")\ndef list_things(user: CurrentUser):\n    return []\n\n\n@router.post(\"/things\")\ndef add_thing(user: CurrentUser):\n    return {}\n";
const UNGUARDED: &str = "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/widgets\")\ndef list_widgets():\n    return []\n\n\n@router.delete(\"/widgets\")\ndef drop_widgets():\n    return {}\n";
/// `UNGUARDED` with a third route, which also runs a shell command.
const UNGUARDED_SHELL: &str = "import subprocess\n\nfrom fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/widgets\")\ndef list_widgets():\n    return []\n\n\n@router.delete(\"/widgets\")\ndef drop_widgets():\n    return {}\n\n\n@router.put(\"/widgets\")\ndef pack_widgets(name: str):\n    subprocess.run(f\"tar czf {name} /data\", shell=True)\n    return {}\n";
const DEPS: &str = "from typing import Annotated\n\nfrom fastapi import Depends, HTTPException\nfrom fastapi.security import OAuth2PasswordBearer\n\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\")\n\n\ndef get_current_user(token: str = Depends(oauth2)):\n    if not token:\n        raise HTTPException(status_code=401)\n    return token\n\n\nCurrentUser = Annotated[str, Depends(get_current_user)]\n";

/// A FastAPI service under `svc/`: twelve router modules in `svc/app/api`, eleven
/// behind `CurrentUser` and one (`legacy.py`) behind nothing. `drift init` has run and
/// nothing is accepted.
fn service() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1.0\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/deps.py", DEPS);
    for i in 0..11 {
        write(r, &format!("svc/app/api/r{i:02}.py"), GUARDED);
    }
    write(r, "svc/app/api/legacy.py", UNGUARDED);
    drift(r, &["init"]);
    dir
}

const WIDGETS: &str = "svc/app/api/widgets.py";

/// The steps of one session on `r`, each answer as the hook printed it: start, write
/// a file that departs, add a route that runs a shell command, end the turn, bring
/// the file into line, end the turn. `between` runs before every hook.
fn play(r: &Path, env: &[(&str, &str)], between: &dyn Fn(&Path)) -> Vec<String> {
    let mut out = Vec::new();
    let mut step = |event: &str, extra: Value| {
        between(r);
        out.push(hook_raw(r, "s1", event, extra, env));
    };
    step("SessionStart", json!({ "source": "startup" }));
    write(r, WIDGETS, UNGUARDED);
    step("PostToolUse", wrote(r, WIDGETS));
    write(r, WIDGETS, UNGUARDED_SHELL);
    step("PostToolUse", wrote(r, WIDGETS));
    step("Stop", json!({ "stop_hook_active": false }));
    write(r, WIDGETS, GUARDED);
    step("PostToolUse", wrote(r, WIDGETS));
    step("Stop", json!({ "stop_hook_active": false }));
    // A second session starts from the code as the first left it.
    between(r);
    out.push(hook_raw(
        r,
        "s2",
        "SessionStart",
        json!({ "source": "startup" }),
        env,
    ));
    write(r, WIDGETS, UNGUARDED_SHELL);
    between(r);
    out.push(hook_raw(r, "s2", "PostToolUse", wrote(r, WIDGETS), env));
    out
}

#[test]
fn the_second_edit_is_answered_from_the_second_edit() {
    let dir = service();
    let r = dir.path();
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));

    write(r, WIDGETS, UNGUARDED);
    let first = hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)).expect("the file departs");
    assert!(first.contains("list_widgets:6, drop_widgets:11"), "{first}");
    assert!(!first.contains("pack_widgets"), "{first}");
    assert!(!first.contains("shell_exec"), "{first}");

    // The second edit: its answer is of the file as it is now. The units it names
    // are at their new lines, the new unit is among them, and the shell command the
    // new route runs is said, after the practices.
    write(r, WIDGETS, UNGUARDED_SHELL);
    let second = hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)).expect("a new unit departs");
    assert!(
        second.contains("list_widgets:8, drop_widgets:13, pack_widgets:18"),
        "{second}"
    );
    let practices = second
        .find("departs from the practices around it")
        .unwrap_or_else(|| panic!("{second}"));
    let security = second
        .find("now does what it did not at session start")
        .unwrap_or_else(|| panic!("{second}"));
    assert!(practices < security, "{second}");
    assert!(
        second.contains("pack_widgets:18) has no guard")
            && second.contains("runs a shell command (shell_exec)"),
        "{second}"
    );

    // The turn ends on that code: the person is told what stands, counted now.
    let stop = hook_raw(r, "s1", "Stop", json!({ "stop_hook_active": false }), &[]);
    let line = told_person(&stop).expect("what stands is said");
    assert!(
        line.contains("3 practice departure(s) in svc/app/api/widgets.py")
            && line.contains("security fact(s) new since session start in svc/app/api/widgets.py"),
        "{line}"
    );

    // The third edit brings the file into line: nothing to say, and nothing stands.
    write(r, WIDGETS, GUARDED);
    assert_eq!(hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)), None);
    // Back to the first content: every unit of it was said already.
    write(r, WIDGETS, UNGUARDED);
    assert_eq!(hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)), None);
    // And to the second: the same.
    write(r, WIDGETS, UNGUARDED_SHELL);
    assert_eq!(hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)), None);
    // A new session on that code starts with it: the file's units are not the new
    // agent's, whatever an earlier process kept about an earlier state of the file.
    write(r, WIDGETS, GUARDED);
    hook(r, "s2", "SessionStart", json!({ "source": "startup" }));
    assert_eq!(hook(r, "s2", "PostToolUse", wrote(r, WIDGETS)), None);
    write(r, WIDGETS, UNGUARDED_SHELL);
    let again = hook(r, "s2", "PostToolUse", wrote(r, WIDGETS)).expect("new to this session");
    assert_eq!(again, second);
}

/// The directories of kept results under the cache directory (`derived-v<n>`).
fn kept_dirs(r: &Path) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(r.join(".drift/cache"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("derived"))
        .map(|e| e.path())
        .collect()
}

/// The kept files, sorted by name.
fn kept_files(r: &Path) -> Vec<std::path::PathBuf> {
    let mut out: Vec<_> = kept_dirs(r)
        .iter()
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
        .map(|e| e.path())
        .collect();
    out.sort();
    out
}

#[test]
fn a_session_is_answered_the_same_whatever_was_kept_from_earlier_runs() {
    // With nothing kept between processes: what each kept is removed before the next.
    let cold = service();
    let wiped = play(cold.path(), &[], &|r| {
        for d in kept_dirs(r) {
            std::fs::remove_dir_all(d).unwrap();
        }
    });
    // With whatever each process keeps.
    let warm = service();
    let kept = play(warm.path(), &[], &|_| {});
    assert_eq!(kept, wiped);
    assert!(
        kept.iter().filter(|o| !o.is_empty()).count() >= 5,
        "{kept:#?}"
    );
    // Something was kept, of both kinds: the test is of what it says.
    let names: Vec<String> = kept_files(warm.path())
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.iter().any(|n| n.starts_with("practices-"))
            && names.iter().any(|n| n.starts_with("security-keys-")),
        "{names:?}"
    );
    // Played again on the same repository, now warm from the start, with the first
    // sessions' state gone: the same answers.
    let again = |r: &Path| {
        for s in ["s1", "s2"] {
            std::fs::remove_file(r.join(format!(".drift/cache/sessions/{s}.json"))).unwrap();
        }
        std::fs::remove_file(r.join(WIDGETS)).unwrap();
    };
    again(warm.path());
    assert_eq!(play(warm.path(), &[], &|_| {}), kept);
    // And with the fact cache elsewhere (`DRIFT_CACHE_DIR`): what is kept goes there.
    let elsewhere = tempfile::tempdir().unwrap();
    let dir = elsewhere.path().to_string_lossy().into_owned();
    again(warm.path());
    assert_eq!(
        play(warm.path(), &[("DRIFT_CACHE_DIR", &dir)], &|_| {}),
        kept
    );
    assert!(elsewhere.path().join("derived-v1").is_dir());
}

#[test]
fn damaged_kept_results_are_rebuilt_never_trusted() {
    let clean = service();
    let want = play(clean.path(), &[], &|_| {});

    // Before every hook, every kept file is damaged, each time another way: cut
    // short, emptied, not JSON, JSON of another shape, another file's content (a
    // well-formed entry under the wrong name), a directory, a file that is not UTF-8.
    let dir = service();
    let n = std::cell::Cell::new(0usize);
    let seen = std::cell::Cell::new(0usize);
    let got = play(dir.path(), &[], &|r| {
        // (A directory planted in an earlier round stays where it is.)
        let files: Vec<_> = kept_files(r).into_iter().filter(|f| f.is_file()).collect();
        let texts: Vec<Vec<u8>> = files.iter().map(|f| std::fs::read(f).unwrap()).collect();
        for (i, f) in files.iter().enumerate() {
            seen.set(seen.get() + 1);
            let text = &texts[i];
            match (n.get() + i) % 7 {
                0 => std::fs::write(f, &text[..text.len() / 2]).unwrap(),
                1 => std::fs::write(f, "").unwrap(),
                2 => std::fs::write(f, "drift").unwrap(),
                3 => std::fs::write(f, "{\"key\":[],\"value\":{\"concerns\":7}}").unwrap(),
                4 => std::fs::write(f, &texts[(i + 1) % texts.len()]).unwrap(),
                5 => {
                    std::fs::remove_file(f).unwrap();
                    std::fs::create_dir(f).unwrap();
                }
                _ => std::fs::write(f, [0xff, 0xfe, 0x00, 0x7b]).unwrap(),
            }
        }
        n.set(n.get() + 1);
    });
    assert!(seen.get() >= 8, "kept files were damaged: {}", seen.get());
    assert_eq!(got, want);

    // A kept file that parses and holds its own key, with another value, is the one
    // thing a reader cannot tell from the real one. A repository could commit such a
    // file; a cache directory git tracks is not read at all (`project::cache_dir`),
    // kept results included: the Stop counts what the code has, not what was planted.
    let planted = service();
    let r = planted.path();
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    write(r, WIDGETS, UNGUARDED);
    hook(r, "s1", "PostToolUse", wrote(r, WIDGETS)).expect("the file departs");
    let mut changed = 0;
    for f in kept_files(r) {
        let text = std::fs::read_to_string(&f).unwrap();
        if text.contains("drop_widgets") {
            std::fs::write(&f, text.replace("drop_widgets", "drop_gadgets")).unwrap();
            changed += 1;
        }
    }
    assert!(changed > 0, "the practice map of this code was kept");
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .args(args)
            .current_dir(r)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .unwrap();
        assert!(out.status.success(), "{out:?}");
    };
    git(&["init", "-q"]);
    git(&["add", "-f", ".drift/cache"]);
    git(&["commit", "-q", "-m", "a committed cache"]);
    let stop = hook_raw(r, "s1", "Stop", json!({ "stop_hook_active": false }), &[]);
    let line = told_person(&stop).expect("what stands is said");
    assert!(
        line.contains("2 practice departure(s) in svc/app/api/widgets.py"),
        "{line}"
    );
}

/// The scan paths the hooks of `r` took (`DRIFT_HOOK_TRACE`), in order.
fn paths(trace: &Path) -> Vec<String> {
    std::fs::read_to_string(trace)
        .unwrap_or_default()
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).expect("one JSON object per line");
            v["path"].as_str().unwrap().to_string()
        })
        .collect()
}

/// A file with entry points is sure to have the repository scanned for it, so the
/// repository is scanned at once, not after a one-file scan that is thrown away: the
/// hook's path says so. Which scan is made first shows in no answer.
#[test]
fn a_file_with_entry_points_scans_the_repository_at_once_and_answers_the_same() {
    let dir = service();
    let r = dir.path();
    let trace = dir.path().join("trace.jsonl");
    let t = trace.to_string_lossy().into_owned();
    let traced = |session: &str, event: &str, extra: Value| {
        std::fs::remove_file(&trace).ok();
        let out = hook_raw(r, session, event, extra, &[("DRIFT_HOOK_TRACE", &t)]);
        let mut p = paths(&trace);
        assert_eq!(p.len(), 1, "{p:?}");
        (said(&out), p.remove(0))
    };
    const LEGACY: &str = "svc/app/api/legacy.py";
    const UTIL: &str = "svc/app/util.py";
    let more =
        format!("{UNGUARDED}\n\n@router.put(\"/widgets\")\ndef put_widgets():\n    return {{}}\n");

    // Before SessionStart nothing is recorded to compare with: no fact is looked up,
    // and nothing accepted means no conventions check either. No scan at all.
    write(r, LEGACY, &more);
    assert_eq!(
        traced("s0", "PostToolUse", wrote(r, LEGACY)),
        (None, "none".to_string())
    );
    write(r, LEGACY, UNGUARDED);

    traced("s1", "SessionStart", json!({ "source": "startup" }));
    // A file the session started with entry points in: the repository at once.
    write(r, LEGACY, &more);
    let (told, path) = traced("s1", "PostToolUse", wrote(r, LEGACY));
    assert_eq!(path, "full_scan:entry_points");
    let told = told.expect("the new unit departs");
    assert!(told.contains("put_widgets:16"), "{told}");
    // A plain module: its own facts only.
    write(r, UTIL, "def helper():\n    return 1\n");
    assert_eq!(
        traced("s1", "PostToolUse", wrote(r, UTIL)),
        (None, "single_file".to_string())
    );
    // A test file is no unit of the map: no scan.
    write(r, "svc/tests/test_widgets.py", UNGUARDED);
    assert_eq!(
        traced("s1", "PostToolUse", wrote(r, "svc/tests/test_widgets.py")).1,
        "none"
    );
    // A route file written this session: its own facts first (nothing said it has
    // entry points), then the repository; from its second edit on, at once.
    write(r, WIDGETS, UNGUARDED);
    let (first, path) = traced("s1", "PostToolUse", wrote(r, WIDGETS));
    assert_eq!(path, "single_file");
    let first = first.expect("the file departs");
    write(r, WIDGETS, UNGUARDED_SHELL);
    let (second, path) = traced("s1", "PostToolUse", wrote(r, WIDGETS));
    assert_eq!(path, "full_scan:entry_points");
    let second = second.expect("a new unit, and a shell command");

    // The same edits where every file is scanned alone first (a session whose index
    // of entry-point files is gone, so nothing says which files have any): the same
    // answers, by the other path.
    let twin = service();
    let q = twin.path();
    hook(q, "s1", "SessionStart", json!({ "source": "startup" }));
    std::fs::remove_file(q.join(".drift/cache/sessions/agent-hints.idx")).unwrap();
    let alone = |rel: &str, body: &str| {
        write(q, rel, body);
        std::fs::remove_file(&trace).ok();
        let out = hook_raw(
            q,
            "s1",
            "PostToolUse",
            wrote(q, rel),
            &[("DRIFT_HOOK_TRACE", &t)],
        );
        (said(&out), paths(&trace).remove(0))
    };
    assert_eq!(
        alone(LEGACY, &more),
        (Some(told), "single_file".to_string())
    );
    assert_eq!(alone(UTIL, "def helper():\n    return 1\n").0, None);
    assert_eq!(
        alone(WIDGETS, UNGUARDED),
        (Some(first), "single_file".to_string())
    );
    // (From here this session knows the file has entry points, as the first does.)
    assert_eq!(alone(WIDGETS, UNGUARDED_SHELL).0, Some(second));
}
