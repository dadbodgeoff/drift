//! `drift census --json --candidate d8`: the tier decision D8's pre-registered
//! candidate would give each proposal (`eval/study/tier-d8-candidate.json`), beside the
//! shipped tier, which it never changes. Python call wrappers count only when every
//! alternative is a guard, read from the definitions (`security::authenticates`).

use std::path::Path;
use std::process::Command;

use serde_json::Value;

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

fn drift(root: &Path, args: &[&str]) -> (i32, String) {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

fn census(root: &Path, extra: &[&str]) -> Value {
    let mut args = vec!["census", "--json"];
    args.extend_from_slice(extra);
    let (code, out) = drift(root, &args);
    assert_eq!(code, 0, "census {extra:?} failed");
    serde_json::from_str(&out).unwrap()
}

/// A FastAPI app whose routes depend on `get_current_user` (which raises a 401) in
/// `app/api/**`, and on `get_db` alone (which turns no one away) in `app/data/**`.
fn repo(guarded: usize, sessions: usize) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"app\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/db.py",
        "def get_db():\n    db = object()\n    try:\n        yield db\n    finally:\n        pass\n",
    );
    write(
        r,
        "app/auth.py",
        "from fastapi import Depends, HTTPException, status\nfrom fastapi.security import OAuth2PasswordBearer\n\noauth2_scheme = OAuth2PasswordBearer(tokenUrl=\"token\")\n\n\ndef get_current_user(token: str = Depends(oauth2_scheme)):\n    if not token:\n        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=\"no\")\n    return token\n",
    );
    for i in 0..guarded {
        let dep = if i < guarded - 3 {
            "user=Depends(get_current_user)"
        } else {
            ""
        };
        write(
            r,
            &format!("app/api/r{i:02}.py"),
            &format!(
                "from fastapi import APIRouter, Depends\nfrom app.auth import get_current_user\n\nrouter = APIRouter()\n\n\n@router.get(\"/r{i}\")\ndef route_{i}({dep}):\n    return {i}\n"
            ),
        );
    }
    for i in 0..sessions {
        let dep = if i < sessions - 3 {
            "db=Depends(get_db)"
        } else {
            ""
        };
        write(
            r,
            &format!("app/data/d{i:02}.py"),
            &format!(
                "from fastapi import APIRouter, Depends\nfrom app.db import get_db\n\nrouter = APIRouter()\n\n\n@router.get(\"/d{i}\")\ndef data_{i}({dep}):\n    return {i}\n"
            ),
        );
    }
    for i in 0..30 {
        write(
            r,
            &format!("app/h{i:02}.py"),
            &format!("def helper_{i}():\n    return {i}\n"),
        );
    }
    dir
}

fn wrapper<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| {
            p["rule_kind"] == "wrapped_by:call"
                && p["rule"]["any_of"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a.as_str().unwrap().ends_with(&format!("#{name}")))
        })
        .unwrap_or_else(|| panic!("a call wrapper on {name}: {v:#}"))
}

#[test]
fn the_d8_candidate_admits_python_guards_in_large_roles_and_changes_no_tier() {
    let dir = repo(60, 60);
    let r = dir.path();
    let plain = census(r, &[]);
    let with = census(r, &["--candidate", "d8"]);
    // Without the option, nothing about D8 is in the output.
    assert!(plain["params"].get("candidate").is_none(), "{plain:#}");
    for p in plain["proposals"].as_array().unwrap() {
        assert!(p.get("candidate").is_none(), "{p}");
    }
    // With it, every proposal keeps its shipped tier, reason and blockability.
    let strip = |v: &Value| {
        let mut v = v.clone();
        v["params"].as_object_mut().unwrap().remove("candidate");
        for p in v["proposals"].as_array_mut().unwrap() {
            p.as_object_mut().unwrap().remove("candidate");
        }
        v
    };
    assert_eq!(strip(&with), plain, "the candidate only adds fields");
    assert_eq!(with["params"]["tier"]["decision"], "D7");
    assert_eq!(with["params"]["candidate"]["decision"], "D8");
    assert_eq!(with["params"]["candidate"]["py"]["min_members"], 50);
    assert_eq!(with["params"]["candidate"]["py"]["call_wrappers"], "guards");

    let guard = wrapper(&with, "get_current_user");
    assert_eq!(guard["language"], "py");
    assert_eq!(guard["tier"], "suggestion", "Python still advises (D7)");
    assert_eq!(guard["tier_reason"], "language_advise");
    assert_eq!(guard["role"]["members"], 60);
    assert_eq!(guard["candidate"]["guards"], true, "{guard}");
    assert_eq!(guard["candidate"]["tier"], "default", "{guard}");
    assert_eq!(guard["candidate"]["reason"], Value::Null, "{guard}");

    let session = wrapper(&with, "get_db");
    assert_eq!(session["tier"], "suggestion");
    assert_eq!(session["candidate"]["guards"], false, "{session}");
    assert_eq!(session["candidate"]["tier"], "suggestion");
    assert_eq!(session["candidate"]["reason"], "not_guard");

    // Not a call wrapper: no guard question.
    for p in with["proposals"].as_array().unwrap() {
        if p["rule_kind"] != "wrapped_by:call" {
            assert_eq!(p["candidate"]["guards"], Value::Null, "{p}");
        }
        assert_eq!(p["candidate"]["decision"], "D8", "{p}");
    }
}

#[test]
fn the_d8_candidate_floor_is_fifty_python_members() {
    let dir = repo(45, 0);
    let r = dir.path();
    let v = census(r, &["--candidate", "d8"]);
    let guard = wrapper(&v, "get_current_user");
    assert_eq!(guard["role"]["members"], 45);
    assert_eq!(guard["candidate"]["guards"], true, "{guard}");
    assert_eq!(guard["candidate"]["tier"], "suggestion");
    assert_eq!(guard["candidate"]["reason"], "small_role");
}

#[test]
fn the_candidate_needs_json() {
    let dir = tempfile::tempdir().unwrap();
    let (code, _) = drift(dir.path(), &["census", "--candidate", "d8"]);
    assert_ne!(code, 0, "--candidate without --json is refused");
}
