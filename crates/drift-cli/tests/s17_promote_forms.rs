//! S17: the new forms of `drift practices promote` (a mechanism accepted whole, any
//! enforcing way, `--concern`), their refusals, the ranked `--list` with the passive
//! candidates apart, and the rule that no surface prints a promote command the command
//! then refuses (audit 9 7.2: pygoat's `practices --path` printed two). Every command a
//! surface prints is run here with `--dry-run` and must be taken.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

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

fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env("DRIFT_TEST_UNSHOWN", "1")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

fn json(root: &Path, args: &[&str]) -> (i32, Value) {
    let (code, out, err) = run(root, args);
    let v = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{args:?}: {e}\n{out}\n{err}"));
    (code, v)
}

/// 40 Next.js routes, 38 wrapped in `withAuth`, after `drift init`.
fn sample() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    drift(r, &["init"]);
    dir
}

/// The `drift practices promote ...` commands in `text`, as argument lists after
/// `drift`: up to the end of the line, a backtick, a `)` or a `;`. Placeholders
/// (`<P-id>`) and `--list` are not commands to run.
fn commands_in(text: &str) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut rest = line;
        while let Some(at) = rest.find("drift practices promote ") {
            let tail = &rest[at..];
            let end = tail.find(['`', ')', ';']).unwrap_or(tail.len());
            let cmd = tail[..end].trim();
            rest = &tail[end.max(1)..];
            if cmd.contains('<') || cmd.contains("--list") || cmd.contains("--block") {
                continue;
            }
            let words: Vec<String> = cmd
                .split_whitespace()
                .skip(1)
                .map(|w| w.trim_matches('\'').to_string())
                .collect();
            if words.len() > 2 && !out.contains(&words) {
                out.push(words);
            }
        }
    }
    out
}

/// Every command in `text` is taken by `drift practices promote` as the code stands.
fn every_command_is_taken(r: &Path, text: &str) -> usize {
    let cmds = commands_in(text);
    for cmd in &cmds {
        let mut args: Vec<&str> = cmd.iter().map(String::as_str).collect();
        args.push("--dry-run");
        let (code, out, err) = run(r, &args);
        assert_eq!(
            code, 0,
            "printed, then refused: {args:?}\n{out}\n{err}\nin:\n{text}"
        );
    }
    cmds.len()
}

/// Pins item 1: a mechanism accepted whole and any enforcing way, named by concern,
/// preview with --dry-run and --json and write nothing.
#[test]
fn a_mechanism_or_any_enforcing_way_is_promoted_by_concern() {
    let dir = sample();
    let r = dir.path();
    let before = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let (code, v) = json(
        r,
        &[
            "practices",
            "promote",
            "--concern",
            "authn",
            "--any-enforcing",
            "--in",
            "app/api",
            "--dry-run",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["written"], false, "{v}");
    assert_eq!(v["candidate"]["any_enforcing"], true, "{v}");
    assert_eq!(v["candidate"]["follows"], 38, "{v}");
    assert!(
        v["candidate"]["ways"].as_array().is_some_and(Vec::is_empty),
        "{v}"
    );

    let (code, v) = json(
        r,
        &[
            "practices",
            "promote",
            "--concern",
            "authn",
            "--mechanism",
            "wrap",
            "--in",
            "app/api",
            "--dry-run",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["candidate"]["mechanisms"][0], "wrap", "{v}");
    let text = drift(
        r,
        &[
            "practices",
            "promote",
            "--concern",
            "authn",
            "--any-enforcing",
            "--in",
            "app/api",
            "--dry-run",
        ],
    );
    assert!(text.ends_with("Dry run: nothing was written.\n"), "{text}");
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap(),
        before
    );
}

/// Pins item 1's refusals: each says what Drift read and what to do, exits 2 and writes
/// nothing.
#[test]
fn each_new_refusal_says_what_drift_read() {
    let dir = sample();
    let r = dir.path();
    for (args, code, says) in [
        (
            vec![
                "--concern",
                "authn",
                "--mechanism",
                "nosuch",
                "--in",
                "app/api",
            ],
            "not_a_mechanism",
            "The mechanisms Drift read for it here: wrap (",
        ),
        (
            vec!["--concern", "nosuch", "--any-enforcing"],
            "unknown_concern",
            "The concerns Drift read here: ",
        ),
        (
            vec!["--concern", "errors", "--any-enforcing", "--in", "app/api"],
            "no_enforcing",
            "Drift has that reading for authn",
        ),
        (
            vec!["--concern", "authn", "--in", "app/api"],
            "nothing_accepted",
            "--any-enforcing",
        ),
        (
            vec!["--any-enforcing", "--in", "app/api"],
            "no_concern",
            "need --concern",
        ),
    ] {
        let mut all = vec!["practices", "promote"];
        all.extend(args.iter().copied());
        all.push("--json");
        let (exit, v) = json(r, &all);
        assert_eq!(exit, 2, "{all:?}: {v}");
        assert_eq!(v["refused"]["code"], code, "{all:?}: {v}");
        let m = v["message"].as_str().unwrap_or_default();
        assert!(m.contains(says), "{all:?}: {m}");
        all.pop();
        let (exit, _, err) = run(r, &all);
        assert_eq!(exit, 2, "{all:?}");
        assert!(err.contains(says), "{all:?}: {err}");
    }
}

/// Pins items 2 and 4: `--list` gives every candidate a command that is taken (a
/// mechanism or any-enforcing one included), passive candidates apart under their own
/// key and heading and never first, and each candidate's count of departures.
#[test]
fn the_list_ranks_and_sets_passive_candidates_apart() {
    let dir = sample();
    let r = dir.path();
    let (code, v) = json(r, &["practices", "promote", "--list", "--json"]);
    assert_eq!(code, 0, "{v}");
    let active = v["candidates"].as_array().unwrap();
    let passive = v["passive"].as_array().unwrap();
    assert!(!active.is_empty(), "{v}");
    assert!(
        active.iter().all(|c| c["candidate"]["passive"] != true),
        "{v}"
    );
    assert!(
        passive.iter().all(|c| c["candidate"]["passive"] == true),
        "{v}"
    );
    for c in active.iter().chain(passive) {
        let cmd = c["command"].as_str().unwrap();
        assert!(!cmd.contains("promote  "), "{cmd}");
        assert!(c["departures"].is_u64(), "{c}");
    }
    // Ranked: the departures each would settle never rise down the list.
    let n: Vec<u64> = active
        .iter()
        .map(|c| c["departures"].as_u64().unwrap())
        .collect();
    assert!(n.windows(2).all(|w| w[0] >= w[1]), "{n:?}");
    // The sign-in practice settles the two unguarded routes' departures.
    let authn = active
        .iter()
        .find(|c| c["candidate"]["concern"] == "authn" && c["candidate"]["ways"][0].is_object())
        .unwrap_or_else(|| panic!("{v}"));
    assert_eq!(authn["departures"], 2, "{authn}");

    let text = drift(r, &["practices", "promote", "--list"]);
    if !passive.is_empty() {
        let heading = text
            .find("follows by doing nothing")
            .unwrap_or_else(|| panic!("{text}"));
        let first = text.find("    drift practices promote").unwrap();
        assert!(first < heading, "a passive candidate listed first:\n{text}");
    }
    assert!(every_command_is_taken(r, &text) >= active.len(), "{text}");
    let only = drift(r, &["practices", "promote", "--list", "--concern", "authn"]);
    assert!(!only.contains("\n  errors in "), "{only}");
}

/// Pins items 3 and 5: `drift check` names the command that makes a departure's way the
/// rule, and that command is taken.
#[test]
fn a_departure_line_carries_a_command_that_is_taken() {
    let dir = sample();
    let r = dir.path();
    let text = drift(r, &["check"]);
    assert!(
        text.contains("to make it the rule for new code there: `drift practices promote P-"),
        "{text}"
    );
    assert!(every_command_is_taken(r, &text) >= 1, "{text}");
}

const DEPS: &str = "from typing import Annotated\n\nfrom fastapi import Depends, HTTPException\nfrom fastapi.security import OAuth2PasswordBearer\n\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\")\n\n\ndef get_current_user(token: str = Depends(oauth2)):\n    if not token:\n        raise HTTPException(status_code=401)\n    return token\n\n\nCurrentUser = Annotated[str, Depends(get_current_user)]\n";

/// A router module of `n` routes, each behind `CurrentUser` when `guarded`.
fn module(name: &str, n: usize, guarded: bool) -> String {
    let mut s = String::from("from fastapi import APIRouter\n");
    if guarded {
        s.push_str("from app.deps import CurrentUser\n");
    }
    s.push_str("\nrouter = APIRouter()\n");
    for i in 0..n {
        let arg = if guarded { "user: CurrentUser" } else { "" };
        s.push_str(&format!(
            "\n\n@router.get(\"/{name}/{i}\")\ndef {name}_{i}({arg}):\n    return []\n"
        ));
    }
    s
}

/// Pins item 3 (audit 9 7.2): one file whose ten routes all sign in, in a package of
/// fifty whose other forty do not. `drift practices --path` of that file reads only its
/// routes, where the way holds 10 of 10; promoting it in the package is refused (10 of
/// 50). No command it prints may be one the command refuses.
#[test]
fn a_view_of_one_file_prints_no_command_that_is_refused() {
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
    write(r, "svc/app/api/special.py", &module("special", 10, true));
    for f in 0..8 {
        let name = format!("open{f}");
        write(
            r,
            &format!("svc/app/api/{name}.py"),
            &module(&name, 5, false),
        );
    }
    drift(r, &["init"]);
    let one = drift(r, &["practices", "--path", "svc/app/api/special.py"]);
    every_command_is_taken(r, &one);
    let all = drift(
        r,
        &["practices", "--path", "svc/app/api/special.py", "--all"],
    );
    every_command_is_taken(r, &all);
    let v: Value = serde_json::from_str(&drift(
        r,
        &["practices", "--path", "svc/app/api/special.py", "--json"],
    ))
    .unwrap();
    let offered: Vec<&Value> = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["variants"].as_array().unwrap())
        .filter(|x| !x["promotable"].is_null())
        .collect();
    for x in offered {
        let id = x["id"].as_str().unwrap();
        let mut args = vec!["practices", "promote", id, "--dry-run"];
        if let Some(place) = x["promotable"]["place"].as_str() {
            args.extend(["--in", place]);
        }
        let (code, out, err) = run(r, &args);
        assert_eq!(
            code, 0,
            "offered in JSON, then refused: {args:?}\n{out}{err}"
        );
    }
    // The whole map's own offers are taken too.
    let whole = drift(r, &["practices"]);
    every_command_is_taken(r, &whole);
}
