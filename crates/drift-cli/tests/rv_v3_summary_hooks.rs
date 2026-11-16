//! Review fix (area 7, item 7): `drift security --top` ranked a finding whose only
//! guard is a hook the whole app runs as "passes its guard", whatever the hook does.
//!
//! Pins: a hook every request passes whose every refusal is "not allowed" (a 403, as
//! a CSRF check answers) and none "not signed in" is not read as a guard of the
//! caller. The input-fed `eval` behind it ranks with the findings that have no guard
//! (code execution before three open redirects, so it is on the first three), and
//! its line says the guard was not read. A hook that answers 401 stays a guard.
//! Decided by what each hook's body does (its recorded refusals), never by its name.

use std::path::Path;
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Three Flask apps: one whose hook refuses with a 403 unless a session value matches
/// a form value (a CSRF check) before an `eval` of the form; one with three open
/// redirects and no hook; one whose hook answers 401 without a signed-in user before
/// another `eval`.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "app.py",
        r#"from flask import Flask, request, abort, session

app = Flask(__name__)


@app.before_request
def csrf_protect():
    token = session.get("csrf_token")
    if not token or token != request.form.get("csrf_token"):
        abort(403)


@app.route("/run", methods=["POST"])
def run():
    return str(eval(request.form["x"]))
"#,
    );
    write(
        r,
        "other.py",
        r#"from flask import Flask, request, redirect

other = Flask(__name__)


@other.route("/a")
def go_a():
    return redirect(request.args["next"])


@other.route("/b")
def go_b():
    return redirect(request.args["to"])


@other.route("/c")
def go_c():
    return redirect(request.args["back"])
"#,
    );
    write(
        r,
        "signed.py",
        r#"from flask import Flask, request, abort, session

signed = Flask(__name__)


@signed.before_request
def require_user():
    if not session.get("user"):
        abort(401)


@signed.route("/exec", methods=["POST"])
def exec_it():
    return str(eval(request.form["y"]))
"#,
    );
    dir
}

#[test]
fn a_hook_that_only_forbids_is_no_guard_of_the_caller() {
    let dir = repo();
    let (code, out, err) = drift(dir.path(), &["security", "--top", "3"]);
    assert_eq!(code, 0, "{err}");
    // Before: "  4. A caller who passes its guard can send text ... POST /run", after
    // the three redirects, so off a list of three.
    assert!(
        out.contains("  1. A caller, unless a hook the whole app runs turns them away, can send text the server runs as code (eval): POST /run (app.py:"),
        "{out}"
    );
    assert!(
        out.contains("guard not read: only hooks the whole app runs stand in front of it (csrf_protect (app hook))"),
        "{out}"
    );
    assert!(
        out.contains("whether the hooks the whole app runs identify or authorise the caller"),
        "{out}"
    );
    // The redirects follow it; the hook that answers 401 is still a guard, ranked
    // after every finding with none.
    assert!(
        out.contains("  2. A caller Drift found no guard for can"),
        "{out}"
    );
    assert!(!out.contains("POST /exec"), "{out}");
    let (_, all, _) = drift(dir.path(), &["security", "--top", "0"]);
    assert!(
        all.contains("  5. A caller who passes its guard can send text the server runs as code (eval): POST /exec (signed.py:"),
        "{all}"
    );
    assert!(all.contains("behind require_user (app hook)"), "{all}");

    let (_, json, _) = drift(dir.path(), &["security", "--top", "1", "--json"]);
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["top"]["shown"][0]["caller"], "hook_not_read", "{json}");
}
