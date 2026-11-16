//! Gap promote-membership: two ways a promoted practice, or the reading under it, said
//! "followed" or "guarded" of code it never saw guarded.
//!
//! 1. A route practice ("every route under /api signs in with `withAuth`") was shown
//!    for a module of Next.js server actions in its package. A server action is served
//!    at no route: the check never counts one under a prefix, and the route's guard is
//!    never credited to it, so the rule told an agent about to edit the module that a
//!    guard held which never runs for it. The rule is now shown only for files with an
//!    entry point served at a route; the action's own departure is still said as a
//!    fact, and the check's exit code is unchanged.
//! 2. A guard credited for a check of a value this route does not name: a FastAPI
//!    dependency that finds the caller's seat in the space a query value names, beside
//!    a route about the room its path names, read as a membership guard (a caller of
//!    any space passes it by naming their own); and a Python 401 on a value of the
//!    module (a flag, a name bound to the environment, a field of a module object),
//!    read as sign-in. Both are now unknown, never known and never none.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

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

/// Runs the CLI; its stdout and exit code.
fn run(root: &Path, args: &[&str]) -> (String, Option<i32>) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        matches!(out.status.code(), Some(0 | 1)),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        out.status.code(),
    )
}

fn json(root: &Path, args: &[&str]) -> Value {
    let (out, code) = run(root, args);
    assert_eq!(code, Some(0), "{args:?}: {out}");
    serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"))
}

// ---------- 1. a module of server actions under a route practice ----------

const AUTH: &str = r#"type Handler = (req: Request) => Promise<Response>;

export function withAuth(h: Handler): Handler {
  return async (req) => {
    if (!req.headers.get("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return h(req);
  };
}
"#;

const WRAPPED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const ACTIONS: &str =
    "\"use server\";\n\nexport async function save(form: FormData) {\n  return { ok: true };\n}\n";

/// 12 `/api` handlers wrapped in `withAuth` and, in `app/api/actions/a.ts`, a module
/// of one server action that signs no one in; the practice `.:/api` promoted.
fn next_app() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..12 {
        write(r, &format!("app/api/r{i:02}/route.ts"), WRAPPED);
    }
    write(r, "app/api/actions/a.ts", ACTIONS);
    run(r, &["init"]);
    let map = json(r, &["practices", "--json"]);
    let variant = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"] == "authn")
        .flat_map(|c| c["variants"].as_array().unwrap().iter())
        .find(|v| v["label"] == "wrap withAuth")
        .and_then(|v| v["id"].as_str())
        .unwrap_or_else(|| panic!("no `wrap withAuth` variant: {map:#}"))
        .to_string();
    let v = json(
        r,
        &["practices", "promote", &variant, "--in", ".:/api", "--json"],
    );
    assert_eq!(v["written"], true, "{v:#}");
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    (dir, id)
}

/// Pins hole 1: the route practice is not shown for the module of server actions
/// (`drift example`, which lists the conventions that cover a file, as the hooks and
/// the MCP tools read them), and is for a handler under the prefix. The check reports
/// no violation of it, counts nothing of it as not checked (no route places a server
/// action under a prefix), still says the action's departure as a fact, and exits 0.
/// Before, `drift example app/api/actions/a.ts` printed the `/api` routes' rule.
#[test]
fn a_route_practice_is_not_shown_for_a_module_of_server_actions() {
    let (dir, id) = next_app();
    let r = dir.path();
    let (handler, _) = run(r, &["example", "app/api/r00/route.ts"]);
    assert!(handler.contains(&id), "{handler}");
    let (actions, _) = run(r, &["example", "app/api/actions/a.ts"]);
    assert!(!actions.contains(&id), "{actions}");
    let (text, code) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{text}");
    assert!(
        text.contains("app/api/actions/a.ts: authn"),
        "the action's departure is still said: {text}"
    );
    let report = json(r, &["check", "--format", "json"]);
    let mentions = |field: &str| {
        report[field]
            .as_array()
            .is_some_and(|a| a.iter().any(|x| x["id"] == id.as_str()))
    };
    assert!(!mentions("violations"), "{report:#}");
    assert!(!mentions("practices_not_checked"), "{report:#}");
}

// ---------- 2. a guard on a value the route does not name ----------

const REQUIREMENTS: &str = "fastapi\nsqlalchemy\n";

const MODELS: &str = r#"from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Seat(Base):
    __tablename__ = "seats"
    id = Column(Integer, primary_key=True)
    holder_id = Column(Integer)
    space = Column(String)


class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    space = Column(String)
    text = Column(String)
"#;

const DEPS: &str = r#"from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.models import Seat

oauth2 = OAuth2PasswordBearer(tokenUrl="token")


class Caller:
    def __init__(self, id):
        self.id = id


def get_db():
    yield Session()


def current_user(token: str = Depends(oauth2)) -> Caller:
    if not token:
        raise HTTPException(status_code=401)
    return Caller(1)


def seated(space: str, db: Session = Depends(get_db), user: Caller = Depends(current_user)):
    seat = db.query(Seat).filter_by(holder_id=user.id, space=space).first()
    if seat is None:
        raise HTTPException(status_code=403)
    return seat
"#;

const MAIN: &str = r#"import os

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.deps import Caller, current_user, get_db, seated
from app.models import Note

app = FastAPI()

LOCKED = False
OPEN = os.environ.get("OPEN") == "1"


class Gate:
    ready = False


gate = Gate()


@app.get("/spaces/{space}/notes")
def notes(space: str, seat=Depends(seated), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=space).all()


@app.get("/rooms/{room}/notes")
def room_notes(room: str, seat=Depends(seated), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=room).all()


@app.get("/flag")
def flag():
    if not LOCKED:
        raise HTTPException(status_code=401, detail="no")
    return {"ok": True}


@app.get("/env")
def env():
    if not OPEN:
        raise HTTPException(status_code=401, detail="no")
    return {"ok": True}


@app.get("/field")
def field():
    if not gate.ready:
        raise HTTPException(status_code=401, detail="no")
    return {"ok": True}


@app.get("/me")
def me(user: Caller = Depends(current_user)):
    return {"id": user.id}
"#;

/// What the practice map says of `concern` for each route: `known <key>`, `none`, or
/// `unknown <reason>`.
fn readings(root: &Path, concern: &str) -> BTreeMap<String, String> {
    let map = json(root, &["practices", "--json", "--units"]);
    let c = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == concern)
        .cloned()
        .unwrap_or_else(|| panic!("no {concern}: {map:#}"));
    let key_of = |u: &Value| {
        u["key"]
            .as_str()
            .or_else(|| {
                c["variants"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|v| v["id"] == u["variant"])
                    .and_then(|v| v["key"].as_str())
            })
            .unwrap_or_default()
            .to_string()
    };
    c["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => format!("known {}", key_of(u)),
                "unknown" => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

fn fastapi_app() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", REQUIREMENTS);
    write(r, "app/__init__.py", "");
    write(r, "app/models.py", MODELS);
    write(r, "app/deps.py", DEPS);
    write(r, "app/main.py", MAIN);
    dir
}

/// Pins hole 2, permission: a FastAPI dependency that finds the caller's seat in the
/// space it is handed. FastAPI hands a dependency's parameter from the path only
/// where the path declares that name, and from the query otherwise, so behind
/// `/rooms/{room}/notes` the space is a value the caller sends beside the URL: a
/// caller of any space passes by naming their own. Behind `/spaces/{space}/notes` it
/// may be the URL's, but the facts of a lookup read off a model's rows do not say
/// which value of the request it took, so that cannot be told either. Both are found,
/// not proven: unknown, never known and never none. (Where the facts name the
/// parameter, a lookup of the one the path declares is still the check: the unit
/// test `a_guard_tied_by_a_value_beside_the_url_ties_nothing` in `authz.rs`.)
/// Before, both read "known membership_guard".
#[test]
fn a_membership_guard_on_a_value_beside_the_route_is_not_proven() {
    let dir = fastapi_app();
    let got = readings(dir.path(), "authz");
    for route in ["/rooms/{room}/notes", "/spaces/{space}/notes"] {
        assert_eq!(got[route], "unknown check_not_proven", "{route}: {got:?}");
    }
}

/// Pins hole 2, sign-in: a 401 on a value of the module (a constant, a name bound to
/// an environment read, a field of an object the module made) signs no one in: every
/// request gets the same answer. Unknown, never known and never none. A dependency
/// that refuses a request with no token is still sign-in. Before, the three read
/// "known body_check:app/main.py#...".
#[test]
fn a_sign_in_check_on_a_value_of_the_module_is_not_proven() {
    let dir = fastapi_app();
    let got = readings(dir.path(), "authn");
    for route in ["/flag", "/env", "/field"] {
        assert_eq!(got[route], "unknown check_not_proven", "{route}: {got:?}");
    }
    assert!(got["/me"].starts_with("known "), "{got:?}");
}
