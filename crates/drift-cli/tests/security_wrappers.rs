//! `drift security` counts as guards only the wrappers that turn callers away: a
//! FastAPI dependency that raises a 401 is a guard; a database session dependency and
//! an exception-mapping decorator wrap the route but reject no one, so they are listed
//! as `wrappers`, never as guards, and no shared-guard row is made of them.

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

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Ten routes depend on `get_current_user` (raises a 401) and `get_db` (yields a
/// session) and are decorated with `map_errors` (turns a `ValueError` into a 400); one
/// route has none of them.
fn repo() -> tempfile::TempDir {
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
    write(
        r,
        "app/errors.py",
        "import functools\n\nfrom fastapi import HTTPException\n\n\ndef map_errors(fn):\n    @functools.wraps(fn)\n    def inner(*args, **kwargs):\n        try:\n            return fn(*args, **kwargs)\n        except ValueError as e:\n            raise HTTPException(status_code=400, detail=str(e))\n\n    return inner\n",
    );
    for i in 0..11 {
        let body = if i < 10 {
            format!(
                "from fastapi import APIRouter, Depends\nfrom app.auth import get_current_user\nfrom app.db import get_db\nfrom app.errors import map_errors\n\nrouter = APIRouter()\n\n\n@router.get(\"/r{i}\")\n@map_errors\ndef route_{i}(user=Depends(get_current_user), db=Depends(get_db)):\n    return {i}\n"
            )
        } else {
            format!(
                "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/r{i}\")\ndef route_{i}():\n    return {i}\n"
            )
        };
        write(r, &format!("app/api/r{i:02}.py"), &body);
    }
    dir
}

#[test]
fn only_wrappers_that_reject_a_caller_are_guards() {
    let dir = repo();
    let r = dir.path();
    let (code, out, err) = drift(r, &["--no-cache", "security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let inv: Value = serde_json::from_str(&out).unwrap();
    let entry = |path: &str| {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["path"] == path)
            .unwrap_or_else(|| panic!("no entry point in {path}: {inv:#}"))
            .clone()
    };
    let e = entry("app/api/r00.py");
    // The dependency and the scheme it depends on are guards; nothing else is.
    let guards: Vec<&str> = e["guards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g.as_str().unwrap())
        .collect();
    assert!(guards.contains(&"get_current_user"), "{e:#}");
    assert!(
        !guards.contains(&"get_db") && !guards.contains(&"map_errors"),
        "{e:#}"
    );
    let wrappers: Vec<&str> = e["wrappers"]
        .as_array()
        .unwrap_or_else(|| panic!("{e:#}"))
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert!(wrappers.contains(&"get_db"), "{e:#}");
    assert!(wrappers.contains(&"map_errors"), "{e:#}");
    let bare = entry("app/api/r10.py");
    assert_eq!(bare["guards"], serde_json::json!([]));
    assert!(bare.get("wrappers").is_none(), "{bare:#}");
    // The shared-guard rows name the guard only: no row for the session or the mapper.
    let gaps: Vec<&str> = inv["guard_gaps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["guard"].as_str().unwrap())
        .collect();
    assert_eq!(
        gaps,
        ["get_current_user", "security.OAuth2PasswordBearer"],
        "{:#}",
        inv["guard_gaps"]
    );
    // The text lists the wrapped route's wrappers apart from its guards.
    let (code, text, err) = drift(r, &["--no-cache", "card", "app/api/r00.py"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.contains("[http] route_0: guards get_current_user › security.OAuth2PasswordBearer; wrappers get_db › map_errors; "),
        "{text}"
    );
    assert!(
        text.contains("Siblings: 11 http entry points in app/api/ carry get_current_user 10/11, "),
        "{text}"
    );
}
