//! The hooks' reaction to the practice map, end to end on generated repositories: what
//! `drift practices` knows about the entry points around a file reaches the agent that
//! writes it. PostToolUse names the concerns the written file's entry points do another
//! way than those around them (advice, once, never a block; nothing accepted is needed);
//! PreToolUse gives the recipe for a new file written where files of any name are entry
//! points, with what most of the package does for the preview concerns (logging,
//! config, data access, where the tests are); the card of an entry-point file says the
//! file's own.

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

fn hook(root: &Path, session: &str, event: &str, extra: Value) -> Option<String> {
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
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
    assert_eq!(out.status.code(), Some(0), "hooks always exit 0");
    let out = String::from_utf8_lossy(&out.stdout);
    let out = out.trim();
    if out.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(out).expect("hook output is JSON");
    assert!(v.get("decision").is_none(), "practices never block: {v}");
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .map(str::to_string)
}

/// `drift ARGS` in `root`, with `stdin` when given: its standard output.
fn drift(root: &Path, args: &[&str], stdin: Option<&str>) -> String {
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "{out:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn wrote(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Write", "tool_input": { "file_path": root.join(rel) } })
}

const GUARDED: &str = "from fastapi import APIRouter\nfrom app.deps import CurrentUser\n\nrouter = APIRouter()\n\n\n@router.get(\"/things\")\ndef list_things(user: CurrentUser):\n    return []\n\n\n@router.post(\"/things\")\ndef add_thing(user: CurrentUser):\n    return {}\n";
const UNGUARDED: &str = "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/widgets\")\ndef list_widgets():\n    return []\n\n\n@router.delete(\"/widgets\")\ndef drop_widgets():\n    return {}\n";

/// `svc/app/deps.py`: the `CurrentUser` dependency, which answers 401 without a token.
const DEPS: &str = "from typing import Annotated\n\nfrom fastapi import Depends, HTTPException\nfrom fastapi.security import OAuth2PasswordBearer\n\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\")\n\n\ndef get_current_user(token: str = Depends(oauth2)):\n    if not token:\n        raise HTTPException(status_code=401)\n    return token\n\n\nCurrentUser = Annotated[str, Depends(get_current_user)]\n";

/// A FastAPI service under `svc/` (its own package): twelve router modules in
/// `svc/app/api`, eleven behind `CurrentUser` and one (`legacy.py`) behind nothing.
/// `drift init` has run and nobody accepted anything: the hooks answer (they are silent
/// in a repository with no `.drift/conventions.yaml`), with no convention to check.
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
    let init = drift(r, &["init"], None);
    // `init` proposes nothing here and leads with what is known all the same.
    assert!(
        init.contains("What the code does (read from the code: facts, not rules)\n  24 http entry points in svc\n    sign-in:     depends on security.OAuth2PasswordBearer + depends on get_current_user in 22; nothing found in 2 (of 24)\n"),
        "{init}"
    );
    assert!(
        init.contains("Worth a look first\n  1. sign-in in svc: no guard found in what Drift read, in 2 places (e.g. svc/app/api/legacy.py:11 drop_widgets); make the usual way the rule for new code: drift practices promote P-f654cf --in svc\n"),
        "{init}"
    );
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(!policy.contains("status: accepted"), "{policy}");
    dir
}

#[test]
fn a_written_file_that_departs_from_the_practices_around_it_is_told_once() {
    let dir = service();
    let r = dir.path();
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));

    write(r, "svc/app/api/widgets.py", UNGUARDED);
    let said = hook(r, "s1", "PostToolUse", wrote(r, "svc/app/api/widgets.py"))
        .expect("the departure is reported with nothing accepted");
    assert!(
        said.starts_with(
            "drift: svc/app/api/widgets.py departs from the practices around it (facts, not rules; nothing is blocked):\n- "
        ),
        "{said}"
    );
    let authn = said
        .lines()
        .find(|l| l.starts_with("- authn: "))
        .unwrap_or_else(|| panic!("{said}"));
    // What the others do, how many of them, the units here, and a unit to copy.
    assert!(
        authn.contains("22 of the 24 other entry points in svc/app/api"),
        "{authn}"
    );
    assert!(authn.contains("get_current_user"), "{authn}");
    assert!(authn.contains("list_widgets:6, drop_widgets:11"), "{authn}");
    assert!(authn.contains("(copy svc/app/api/r"), "{authn}");

    // Once: the same units are not reported again in the session.
    assert_eq!(
        hook(r, "s1", "PostToolUse", wrote(r, "svc/app/api/widgets.py")),
        None
    );
    // Done as the others do it: nothing to say, in any session.
    write(r, "svc/app/api/widgets.py", GUARDED);
    hook(r, "s2", "SessionStart", json!({ "source": "startup" }));
    write(r, "svc/app/api/gadgets.py", GUARDED);
    assert_eq!(
        hook(r, "s2", "PostToolUse", wrote(r, "svc/app/api/gadgets.py")),
        None
    );
}

#[test]
fn what_the_code_already_did_and_what_was_not_scanned_is_not_reported() {
    let dir = service();
    let r = dir.path();
    // No SessionStart scan: the hook cannot tell the agent's units from the code's.
    write(r, "svc/app/api/widgets.py", UNGUARDED);
    assert_eq!(
        hook(r, "s1", "PostToolUse", wrote(r, "svc/app/api/widgets.py")),
        None
    );
    // The session starts with both unguarded files: an edit of either says nothing.
    hook(r, "s2", "SessionStart", json!({ "source": "startup" }));
    for rel in ["svc/app/api/legacy.py", "svc/app/api/widgets.py"] {
        assert_eq!(hook(r, "s2", "PostToolUse", wrote(r, rel)), None, "{rel}");
    }
    // A unit added to one of them is the agent's: it alone is reported.
    write(
        r,
        "svc/app/api/legacy.py",
        &format!("{UNGUARDED}\n\n@router.put(\"/widgets\")\ndef put_widgets():\n    return {{}}\n"),
    );
    let said = hook(r, "s2", "PostToolUse", wrote(r, "svc/app/api/legacy.py")).expect("new unit");
    assert!(said.contains("- authn: "), "{said}");
    // A file with no entry point, and a test, are not the map's units.
    write(r, "svc/app/util.py", "def helper():\n    return 1\n");
    write(r, "svc/tests/test_widgets.py", UNGUARDED);
    for rel in ["svc/app/util.py", "svc/tests/test_widgets.py"] {
        assert_eq!(hook(r, "s2", "PostToolUse", wrote(r, rel)), None, "{rel}");
    }
}

#[test]
fn a_new_file_among_entry_point_files_of_other_names_gets_the_recipe_before_it_is_written() {
    let dir = service();
    let r = dir.path();
    // The session is at the root (not the service's package), so the start brief does
    // not give the service's recipe.
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let said = hook(r, "s1", "PreToolUse", wrote(r, "svc/app/api/widgets.py"))
        .expect("the recipe for a new router module");
    assert!(
        said.contains("drift: practices for svc/app/api/widgets.py (facts, not rules): "),
        "{said}"
    );
    assert!(said.contains("get_current_user"), "{said}");
    // A helper elsewhere in the package is of no recipe's kind.
    assert_eq!(
        hook(
            r,
            "s1",
            "PreToolUse",
            wrote(r, "svc/app/services/widgets.py")
        ),
        None
    );
}

#[test]
fn drift_check_over_mcp_says_the_same_for_the_files_it_is_asked_about() {
    let dir = service();
    let r = dir.path();
    write(r, "svc/app/api/widgets.py", UNGUARDED);
    let ask = |id: u32, args: Value| json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"drift_check","arguments":args}});
    let input = format!(
        "{}\n{}\n{}\n",
        ask(1, json!({ "paths": ["svc/app/api/widgets.py"] })),
        ask(
            2,
            json!({ "paths": ["svc/app/api/r00.py", "svc/app/deps.py"] })
        ),
        ask(3, json!({})),
    );
    let out = drift(r, &["mcp"], Some(&input));
    let replies: Vec<String> = out
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            v["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("{v}"))
                .to_string()
        })
        .collect();
    assert_eq!(replies.len(), 3, "{out}");
    // No convention is accepted: nothing is violated, and the departure is still said.
    assert!(replies[0].starts_with("No new violations.\ndrift: svc/app/api/widgets.py departs from the practices around it (facts, not rules; nothing is blocked):\n- "), "{}", replies[0]);
    assert!(replies[0].contains("- authn: "), "{}", replies[0]);
    // A file that does as the others do, a file with no entry point, and no file named.
    for quiet in &replies[1..] {
        assert_eq!(quiet.trim_end(), "No new violations.", "{quiet}");
    }
}

/// The practice maps kept in the derived results under `root` ([`crate::derived`]).
fn kept_maps(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(root.join(".drift/cache/derived-v1"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("practices-"))
        .collect();
    out.sort();
    out
}

/// MCP `drift_check` reads the practice map kept for the facts, as the hooks, `drift
/// check` and `drift card` do, and keeps it when it builds it: the same answer whether
/// it was built, read back or built without a cache.
#[test]
fn drift_check_over_mcp_reads_the_practice_map_kept_for_the_facts() {
    let dir = service();
    let r = dir.path();
    let ask = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_check","arguments":{ "paths": ["svc/app/api/legacy.py"] }}}).to_string() + "\n";
    let said = |args: &[&str]| -> String {
        let out = drift(r, args, Some(&ask));
        let v: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
        v["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let _ = std::fs::remove_dir_all(r.join(".drift/cache/derived-v1"));
    let built = said(&["mcp"]);
    assert!(
        built.contains("drift: svc/app/api/legacy.py departs"),
        "{built}"
    );
    let kept = kept_maps(r);
    assert_eq!(kept.len(), 1, "the map is kept: {kept:?}");
    assert_eq!(said(&["mcp"]), built, "read back");
    assert_eq!(kept_maps(r), kept, "and not built again");
    assert_eq!(said(&["--no-cache", "mcp"]), built, "built without a cache");
    // `drift check` reads the same map.
    drift(r, &["check", "svc/app/api/legacy.py"], None);
    assert_eq!(kept_maps(r), kept);
}

/// The units of `concern` in `drift practices --json --units`, as `symbol -> assignment`.
fn unit_assignments(root: &Path, concern: &str) -> std::collections::BTreeMap<String, String> {
    let out = drift(
        root,
        &["practices", "--json", "--units", "--concern", concern],
        None,
    );
    let v: Value = serde_json::from_str(&out).unwrap();
    v["concerns"][0]["units"]
        .as_array()
        .unwrap_or_else(|| panic!("{v}"))
        .iter()
        .map(|u| {
            (
                u["symbol"].as_str().unwrap().to_string(),
                u["assignment"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn a_call_only_named_like_a_guard_does_not_unsettle_a_proven_guard() {
    let dir = service();
    let r = dir.path();
    write(
        r,
        "svc/app/members.py",
        "from fastapi import HTTPException\n\n\nclass MembersService:\n    def __init__(self, db) -> None:\n        self.db = db\n\n    async def require_member(self, user) -> None:\n        if not user:\n            raise HTTPException(status_code=403)\n\n    async def delete_member(self, member_id: int) -> None:\n        if not member_id:\n            raise ValueError(\"no member\")\n",
    );
    // `MembersService(db).delete_member`: a call Drift cannot follow whose name reads
    // as access control (`member`). Behind the proven `CurrentUser` dependency the
    // route is known to be signed in; with nothing proven it is unknown, not none.
    write(
        r,
        "svc/app/api/members.py",
        "from fastapi import APIRouter\nfrom app.deps import CurrentUser\nfrom app.members import MembersService\n\nrouter = APIRouter()\n\n\n@router.delete(\"/members/{member_id}\")\nasync def guarded_delete(member_id: int, user: CurrentUser):\n    await MembersService(None).delete_member(member_id)\n\n\n@router.delete(\"/open/{member_id}\")\nasync def open_delete(member_id: int):\n    await MembersService(None).delete_member(member_id)\n",
    );
    let units = unit_assignments(r, "authn");
    assert_eq!(units["guarded_delete"], "known", "{units:?}");
    assert_eq!(units["list_things"], "known", "{units:?}");
    assert_eq!(units["open_delete"], "unknown", "{units:?}");
    assert_eq!(units["list_widgets"], "none", "{units:?}");
    // Building the service is no guard, though another of its methods forbids: the
    // guarded route's variant is the dependency alone.
    let out = drift(r, &["practices", "--concern", "authn", "--all"], None);
    assert!(!out.contains("body call MembersService"), "{out}");
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
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {out:?}");
}

/// `drift check` tells a person and CI what the hooks tell an agent: the departures of
/// the files it looked at (every file, the files named, the files a diff touched), in
/// each format, as facts. Nothing is accepted here, so nothing can be violated: the
/// check passes whatever departs.
#[test]
fn drift_check_lists_the_departures_of_the_files_it_looked_at_and_never_fails_on_them() {
    let dir = service();
    let r = dir.path();
    let fact = "authn: 22 of the 22 other entry points in svc/app/api use dependency security.OAuth2PasswordBearer + dependency get_current_user";

    // The whole repository: the route file that was always unguarded.
    let text = drift(r, &["check"], None);
    assert!(
        text.contains("drift: practices (facts, not rules; they never fail the check): 1 file(s) do a concern differently from the entry points around them\n  svc/app/api/legacy.py: authn: "),
        "{text}"
    );
    assert!(text.contains(fact), "{text}");
    let v: Value = serde_json::from_str(&drift(r, &["check", "--format", "json"], None)).unwrap();
    let deps = v["practices"]["departures"].as_array().unwrap();
    assert_eq!(deps.len(), 1, "{deps:#?}");
    assert_eq!(deps[0]["path"], "svc/app/api/legacy.py");
    assert_eq!(deps[0]["concern"], "authn");
    assert_eq!(deps[0]["units"].as_array().unwrap().len(), 2);

    // Files named: only theirs; a file that follows says nothing, and the field is absent.
    let named = drift(r, &["check", "svc/app/api/r00.py"], None);
    assert!(!named.contains("practices"), "{named}");
    let v: Value = serde_json::from_str(&drift(
        r,
        &["check", "--format", "json", "svc/app/api/r00.py"],
        None,
    ))
    .unwrap();
    assert!(v.get("practices").is_none(), "{v}");
    let named = drift(r, &["check", "svc/app/api/legacy.py"], None);
    assert!(named.contains(fact), "{named}");

    // A diff: the files it added or changed, not what the base already had.
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    write(r, "svc/app/api/extra.py", UNGUARDED);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr"]);
    let v: Value = serde_json::from_str(&drift(
        r,
        &["check", "--diff-base", "main", "--format", "json"],
        None,
    ))
    .unwrap();
    let paths: Vec<&str> = v["practices"]["departures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["svc/app/api/extra.py"], "{v:#}");

    // A pull request: a notice on the first departing entry point, and the job summary.
    let summary = r.join("summary.md");
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env("GITHUB_STEP_SUMMARY", &summary)
        .args(["check", "--diff-base", "main", "--format", "github"])
        .current_dir(r)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{out:?}");
    let gh = String::from_utf8_lossy(&out.stdout);
    assert!(
        gh.contains(
            "::notice file=svc/app/api/extra.py,line=6,title=drift practices%3A authn::authn: "
        ),
        "{gh}"
    );
    assert!(
        gh.contains("A fact, not a rule: it does not fail the check."),
        "{gh}"
    );
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(
        md.contains("### Practices\n\nFacts, not rules: they never fail the check. 1 file(s) do a concern differently from at least 80% of the entry points around them.\n\n- `svc/app/api/extra.py`: authn: "),
        "{md}"
    );

    // Code scanning: a note of the run, not a result (nothing to resolve as an alert).
    let sarif: Value = serde_json::from_str(&drift(
        r,
        &["check", "--diff-base", "main", "--format", "sarif"],
        None,
    ))
    .unwrap();
    assert_eq!(sarif["runs"][0]["results"].as_array().unwrap().len(), 0);
    let notes = sarif["runs"][0]["invocations"][0]["toolExecutionNotifications"]
        .as_array()
        .unwrap();
    assert_eq!(notes.len(), 1, "{notes:#?}");
    assert_eq!(notes[0]["level"], "note");
    assert!(
        notes[0]["message"]["text"]
            .as_str()
            .unwrap()
            .starts_with("Practice (a fact, not a rule; it does not fail the check): authn: "),
        "{notes:#?}"
    );
    assert_eq!(
        notes[0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"],
        "svc/app/api/extra.py"
    );
}

/// A route of service `svc` with no guard that calls a function of `lib`, a package
/// no list of Drift's has an entry for: the one thing its reading did not read.
fn unguarded_calling(svc: &str, lib: &str) -> String {
    format!(
        "import {lib}\nfrom fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/widgets\")\ndef list_widgets():\n    return {lib}.fetch_{svc}()\n"
    )
}

/// Two FastAPI services, `alpha/` and `beta/`, each eleven router modules behind
/// `CurrentUser` and `legacy.py` behind nothing, whose route calls a function of a
/// package of its own (`acme_alpha`, `acme_beta`) that Drift does not read. Both
/// routes are the one `none` variant of the repository. `drift init` has run.
fn two_services() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for (svc, lib) in [("alpha", "acme_alpha"), ("beta", "acme_beta")] {
        write(
            r,
            &format!("{svc}/pyproject.toml"),
            &format!(
                "[project]\nname = \"{svc}\"\nversion = \"0.1.0\"\ndependencies = [\"fastapi\", \"{lib}\"]\n"
            ),
        );
        write(r, &format!("{svc}/app/__init__.py"), "");
        write(r, &format!("{svc}/app/api/__init__.py"), "");
        write(r, &format!("{svc}/app/deps.py"), DEPS);
        for i in 0..11 {
            write(r, &format!("{svc}/app/api/r{i:02}.py"), GUARDED);
        }
        write(
            r,
            &format!("{svc}/app/api/legacy.py"),
            &unguarded_calling(svc, lib),
        );
    }
    drift(r, &["init"], None);
    dir
}

/// Every practice-level `none` line names what its own units' readings did not read:
/// a service's line never sends the reader to another service's code. A line of many
/// units (a variant) names their unread items together and how many units it covers.
#[test]
fn a_none_line_names_only_what_its_own_units_did_not_read_on_every_surface() {
    let dir = two_services();
    let r = dir.path();
    // A line about alpha names alpha's unread function, never beta's; and the other way.
    let own = |line: &str, svc: &str| {
        let (mine, theirs) = if svc == "alpha" {
            ("fetch_alpha from acme_alpha", "acme_beta")
        } else {
            ("fetch_beta from acme_beta", "acme_alpha")
        };
        assert!(
            line.contains(&format!("(1 not read: {mine})")),
            "{svc}: {line}"
        );
        assert!(!line.contains(theirs), "{svc}: {line}");
    };
    let line_of = |text: &str, needle: &str| -> String {
        text.lines()
            .find(|l| l.contains(needle))
            .unwrap_or_else(|| panic!("no line with {needle}: {text}"))
            .to_string()
    };

    // `drift check`: each file's departure.
    let text = drift(r, &["check"], None);
    for svc in ["alpha", "beta"] {
        own(
            &line_of(&text, &format!("  {svc}/app/api/legacy.py: authn: ")),
            svc,
        );
    }
    let v: Value = serde_json::from_str(&drift(r, &["check", "--format", "json"], None)).unwrap();
    for d in v["practices"]["departures"].as_array().unwrap() {
        let svc = d["package"].as_str().unwrap();
        own(d["units"][0]["does"].as_str().unwrap(), svc);
    }
    // CI: a notice on each file, and the job summary.
    let summary = r.join("summary.md");
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env("GITHUB_STEP_SUMMARY", &summary)
        .args(["check", "--format", "github"])
        .current_dir(r)
        .output()
        .unwrap();
    let gh = String::from_utf8_lossy(&out.stdout);
    let md = std::fs::read_to_string(&summary).unwrap();
    for svc in ["alpha", "beta"] {
        own(
            &line_of(&gh, &format!("::notice file={svc}/app/api/legacy.py,")),
            svc,
        );
        // Markdown escapes what it quotes.
        own(
            &line_of(&md, &format!("`{svc}/app/api/legacy.py`")).replace('\\', ""),
            svc,
        );
    }

    // `drift practices`: each package's finding counts its own units' unread items.
    let text = drift(r, &["practices"], None);
    for svc in ["alpha", "beta"] {
        let l = line_of(&text, &format!("authn none in {svc}: "));
        assert!(
            l.contains("1 unit(s) with no guard found in what Drift read (1 not read) (e.g. "),
            "{l}"
        );
    }
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"], None)).unwrap();
    for f in v["findings"].as_array().unwrap() {
        if f["kind"] == "none" {
            assert_eq!(f["not_read"].as_array().unwrap().len(), 1, "{f}");
        }
    }
    // The variant table: one variant of two units, the two lists together, said so.
    let text = drift(r, &["practices", "--all", "--concern", "authn"], None);
    let l = line_of(&text, "none: no guard found in what Drift read");
    assert!(
        l.contains(
            "(2 not read across 2 units: fetch_alpha from acme_alpha, fetch_beta from acme_beta)"
        ),
        "{l}"
    );

    // The hook, on a route an agent adds to alpha: alpha's unread function only.
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    write(
        r,
        "alpha/app/api/exports.py",
        &unguarded_calling("alpha", "acme_alpha"),
    );
    let said = hook(r, "s1", "PostToolUse", wrote(r, "alpha/app/api/exports.py"))
        .expect("the departure is reported");
    own(&line_of(&said, "- authn: "), "alpha");
}

const LOGGED: &str = "import logging\nimport os\n\nfrom fastapi import APIRouter\nfrom pydantic import BaseModel\n\nfrom app.deps import CurrentUser\n\nlogger = logging.getLogger(__name__)\nrouter = APIRouter()\n\n\nclass Thing(BaseModel):\n    name: str\n\n\n@router.get(\"/thingsNN\")\ndef list_things(limit: int, user: CurrentUser):\n    logger.info(\"listing things\")\n    return {\"region\": os.environ[\"REGION\"]}\n\n\n@router.post(\"/thingsNN\")\ndef add_thing(thing: Thing, user: CurrentUser):\n    logger.info(\"adding a thing\")\n    return {}\n";
const TESTED: &str = "from fastapi.testclient import TestClient\n\nfrom app.main import app\n\nclient = TestClient(app)\n\n\ndef test_list_things():\n    response = client.get(\"/thingsNN?limit=3\")\n    assert response.status_code == 200\n\n\ndef test_add_thing_needs_a_user():\n    response = client.post(\"/thingsNN\", json={\"name\": \"a\"})\n    assert response.status_code == 401\n";

/// A FastAPI service under `svc/` whose twelve router modules each log through the
/// standard `logging`, read `os.environ` and take a pydantic body, behind
/// `CurrentUser`. Ten of them have a pytest file in `svc/tests/api` that asks for both
/// routes and asserts the 401 of the POST only; `r10.py` and `r11.py` have none.
/// `drift init` has run and nothing is accepted.
fn logged_service() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1.0\"\ndependencies = [\"fastapi\", \"pytest\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    // The app includes each router: a router nothing mounts is served under a prefix
    // that is not known, and no test's request is then known to be for it.
    let includes: String = (0..12)
        .map(|i| format!("from app.api.r{i:02} import router as r{i:02}\n"))
        .chain(["\napp = FastAPI()\n".to_string()])
        .chain((0..12).map(|i| format!("app.include_router(r{i:02})\n")))
        .collect();
    write(
        r,
        "svc/app/main.py",
        &format!("from fastapi import FastAPI\n\n{includes}"),
    );
    write(r, "svc/app/deps.py", DEPS);
    for i in 0..12 {
        let n = format!("{i:02}");
        write(
            r,
            &format!("svc/app/api/r{n}.py"),
            &LOGGED.replace("NN", &n),
        );
        if i < 10 {
            write(
                r,
                &format!("svc/tests/api/test_r{n}.py"),
                &TESTED.replace("NN", &n),
            );
        }
    }
    drift(r, &["init"], None);
    dir
}

/// The recipe an agent gets before it writes a new entry-point file says, after the
/// primary concerns and marked as a preview, the logger and the config read that at
/// least 60% of the package's units share, and where the tests of this kind of entry
/// point are with their runner. `drift practices` prints the same under the recipe and
/// its JSON carries it; a package with nothing of the kind gets no such clause.
#[test]
fn the_recipe_for_a_new_file_adds_what_most_of_the_package_does_for_the_preview_concerns() {
    let dir = logged_service();
    let r = dir.path();
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let said = hook(r, "s1", "PreToolUse", wrote(r, "svc/app/api/widgets.py"))
        .expect("the recipe for a new router module");
    const LOGGING: &str =
        "logging (preview): message logs via logging (24 of 24; copy svc/app/api/r00.py:23)";
    const CONFIG: &str =
        "config (preview): in place os.environ (12 of 12; copy svc/app/api/r00.py:17)";
    const TESTING: &str = "testing (preview): tests in svc/tests/api (pytest) cover 20 of 24 (copy svc/tests/api/test_r00.py)";
    assert!(
        said.starts_with("drift: practices for svc/app/api/widgets.py (facts, not rules): new http entry points in svc: authn: "),
        "{said}"
    );
    // After the primary concerns, in the map's order.
    assert!(
        said.trim_end()
            .ends_with(&format!("; {LOGGING}; {CONFIG}; {TESTING}")),
        "{said}"
    );
    assert!(!said.contains("data_access"), "{said}");

    let text = drift(r, &["practices"], None);
    for line in [LOGGING, CONFIG, TESTING] {
        assert!(text.contains(&format!("\n    {line}\n")), "{line}\n{text}");
    }
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"], None)).unwrap();
    let preview = v["recipes"][0]["preview"]
        .as_array()
        .unwrap_or_else(|| panic!("{}", v["recipes"]));
    let concerns: Vec<&str> = preview
        .iter()
        .map(|p| p["concern"].as_str().unwrap())
        .collect();
    assert_eq!(concerns, ["logging", "config", "testing"]);
    assert_eq!(preview[2]["tests_dir"], "svc/tests/api");
    assert_eq!(preview[2]["runner"], "pytest");
    assert_eq!(preview[2]["members"], 20);
    assert_eq!(preview[2]["total"], 24);

    // A service that logs nothing, reads no config and has no tests: the recipe is what
    // it was, and its JSON has no `preview` field.
    let bare = service();
    let b = bare.path();
    hook(b, "s1", "SessionStart", json!({ "source": "startup" }));
    let said = hook(b, "s1", "PreToolUse", wrote(b, "svc/app/api/widgets.py")).unwrap();
    assert!(!said.contains("(preview)"), "{said}");
    let v: Value = serde_json::from_str(&drift(b, &["practices", "--json"], None)).unwrap();
    assert!(v["recipes"][0].get("preview").is_none(), "{}", v["recipes"]);
}

/// The card of a file with entry points says, after the primary concerns and marked as
/// a preview, the logger its units use, how they read config, and which test file
/// covers each entry point with the required cases it does not assert; of an entry
/// point no test asks for, that none was found. MCP `drift_card` says the same, and a
/// file with no entry point gets none of it.
#[test]
fn the_card_of_an_entry_point_file_adds_the_preview_concerns() {
    let dir = logged_service();
    let r = dir.path();
    let card = drift(r, &["card", "svc/app/api/r03.py"], None);
    let lines: Vec<&str> = card
        .lines()
        .skip_while(|l| !l.starts_with("Practices here"))
        .skip(1)
        .take_while(|l| l.starts_with("  "))
        .collect();
    // The primary concerns first, then the preview ones.
    assert!(lines[0].starts_with("  authn: "), "{card}");
    let first = lines
        .iter()
        .position(|l| l.contains("(preview)"))
        .unwrap_or_else(|| panic!("{card}"));
    assert!(
        lines[..first].iter().all(|l| !l.contains("(preview)"))
            && lines[first..].iter().all(|l| l.contains("(preview)")),
        "{card}"
    );
    let preview = &lines[first..];
    assert_eq!(preview.len(), 3, "{card}");
    assert!(
        preview[0].starts_with("  logging (preview): message logs via logging [P-"),
        "{card}"
    );
    assert!(
        preview[1].starts_with("  config (preview): in place os.environ [P-"),
        "{card}"
    );
    // The POST signs callers in and validates a body: its test asserts the 401 and no
    // 400 or 422; the GET's test asserts neither case it needs.
    assert_eq!(
        preview[2],
        "  testing (preview): add_thing: covered by svc/tests/api/test_r03.py, not asserted: 400/422; list_things: covered by svc/tests/api/test_r03.py, not asserted: 401",
    );
    let untested = drift(r, &["card", "svc/app/api/r11.py"], None);
    assert!(
        untested.contains("\n  testing (preview): add_thing, list_things: no test found\n"),
        "{untested}"
    );

    // The MCP tool gives the same lines.
    let input = format!(
        "{}\n",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_card","arguments":{"path":"svc/app/api/r03.py"}}})
    );
    let out = drift(r, &["mcp"], Some(&input));
    let v: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    let text = v["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("{v}"));
    for line in preview {
        assert!(text.contains(line), "{line}\n{text}");
    }
    // No entry point, no preview.
    let helper = drift(r, &["card", "svc/app/deps.py"], None);
    assert!(!helper.contains("(preview)"), "{helper}");
}
