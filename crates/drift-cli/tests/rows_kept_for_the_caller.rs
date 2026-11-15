//! Rows a route hands its data session, where they are the caller's (FastAPI
//! with SQLModel).
//!
//! A route that hands its session the caller's own record and nothing else
//! (`session.add(current_user)`) changes no one else's data: `own_record`. One
//! that builds a row of a model with a field given the caller itself and hands
//! the session that (`Thing(owner_id=current_user.id)`) creates the caller's
//! own: `owner_stamp`. Read from what each call is handed
//! ([`drift_core::controls::ARG_VALUE`], [`drift_core::controls::PKG_ARG_VALUE`]),
//! on whatever the session is called and however the route gets it.
//!
//! Proven where every body of the route was read, no other call of a data
//! session is handed anything else and nothing reads rows by nothing of the
//! caller. A field the request chose, a group read off the caller, a field
//! written again afterwards, a dict with something unpacked into it and a
//! second build that is anyone's prove nothing. A field given through a method
//! of the model that was not read (`model_validate(..., update={...})`) is
//! found, not proven.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn drift(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// What the practice map says of the authorization of each route, by its path:
/// `known <mechanisms>`, `none`, or `unknown <reason> <obligation>`.
fn authz(root: &Path) -> BTreeMap<String, String> {
    let map = drift(root, &["practices", "--json", "--units"]);
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .cloned()
        .unwrap();
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|v| {
            std::iter::once(v.clone())
                .chain(v["alternatives"].as_array().into_iter().flatten().cloned())
        })
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    let mechanisms: Vec<&str> = key
                        .split('+')
                        .map(|k| k.split(':').next().unwrap_or_default())
                        .collect();
                    format!("known {}", mechanisms.join("+"))
                }
                "unknown" => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

const MODELS: &str = r#"from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: int = Field(primary_key=True)
    email: str
    team_id: int
    hashed_password: str


class ThingCreate(SQLModel):
    title: str
    owner_id: int | None = None


class Thing(SQLModel, table=True):
    id: int = Field(primary_key=True)
    title: str
    owner_id: int
"#;

const DEPS: &str = r#"from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from app.models import User

oauth2 = OAuth2PasswordBearer(tokenUrl="token")


def get_db():
    with Session() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]


def get_current_user(session: SessionDep, token: str = Depends(oauth2)) -> User:
    user = session.get(User, token)
    if not user:
        raise HTTPException(status_code=401)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
"#;

const CRUD: &str = r#"from sqlmodel import Session, select

from app.models import User


def get_user_by_email(*, session: Session, email: str):
    return session.exec(select(User).where(User.email == email)).first()


def hash_password(password: str) -> str:
    return password[::-1]
"#;

const MAIN: &str = r#"import redis
from emails import send_welcome
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app import crud
from app.deps import CurrentUser, SessionDep, get_current_user, get_db
from app.models import Thing, ThingCreate, User

app = FastAPI()
cache = redis.Redis()


class NewPassword(BaseModel):
    new_password: str


class NewEmail(BaseModel):
    email: str


@app.patch("/me/password")
def password(session: SessionDep, body: NewPassword, current_user: CurrentUser):
    current_user.hashed_password = crud.hash_password(body.new_password)
    session.add(current_user)
    session.commit()
    return {"ok": True}


@app.patch("/me")
def me(session: SessionDep, body: NewEmail, current_user: CurrentUser):
    existing = crud.get_user_by_email(session=session, email=body.email)
    if existing and existing.id != current_user.id:
        raise HTTPException(status_code=409)
    current_user.email = body.email
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@app.patch("/me/direct")
def me_direct(session: SessionDep, body: NewEmail, current_user: CurrentUser):
    other = session.exec(select(User).where(User.email == body.email)).first()
    current_user.email = other.email
    session.add(current_user)
    session.commit()
    return {"ok": True}


@app.patch("/other/{user_id}")
def other(user_id: int, session: SessionDep, body: NewEmail, current_user: CurrentUser):
    row = session.get(User, user_id)
    row.email = body.email
    session.add(row)
    session.commit()
    return {"ok": True}


@app.post("/things")
def things(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing.model_validate(body, update={"owner_id": current_user.id})
    session.add(thing)
    session.commit()
    session.refresh(thing)
    return thing


@app.post("/things-kw")
def things_kw(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing(title=body.title, owner_id=current_user.id)
    session.add(thing)
    session.commit()
    return thing


@app.post("/things-asked")
def things_asked(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing(title=body.title, owner_id=body.owner_id)
    session.add(thing)
    session.commit()
    return thing


@app.post("/things-rewritten")
def things_rewritten(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing(title=body.title, owner_id=current_user.id)
    thing.owner_id = body.owner_id
    session.add(thing)
    session.commit()
    return thing


@app.post("/things-spread")
def things_spread(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    extra = body.model_dump()
    thing = Thing.model_validate(body, update={"owner_id": current_user.id, **extra})
    session.add(thing)
    session.commit()
    return thing


@app.post("/things-group")
def things_group(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing(title=body.title, owner_id=current_user.team_id)
    session.add(thing)
    session.commit()
    return thing


@app.post("/things-two")
def things_two(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    mine = Thing(title=body.title, owner_id=current_user.id)
    theirs = Thing(title=body.title, owner_id=body.owner_id)
    session.add(mine)
    session.add(theirs)
    session.commit()
    return mine


@app.post("/things-and-other")
def things_and_other(session: SessionDep, body: ThingCreate, current_user: CurrentUser):
    thing = Thing(title=body.title, owner_id=current_user.id)
    session.add(thing)
    old = session.get(Thing, body.owner_id)
    session.delete(old)
    session.commit()
    return thing


@app.post("/me/welcome")
def welcome(current_user: CurrentUser):
    send_welcome(current_user)
    return {"ok": True}


@app.post("/me/cached")
def cached(current_user: CurrentUser):
    cache.delete(current_user.id)
    return {"ok": True}


@app.post("/me/helper")
def helper(session: SessionDep, body: NewEmail, current_user: CurrentUser):
    keep(session, current_user)
    return {"ok": True}


def keep(session, row):
    session.add(row)
    session.commit()


@app.delete("/me/leave")
def leave(session: SessionDep, current_user: CurrentUser):
    session.delete(current_user)
    session.commit()
    return {"ok": True}


@app.patch("/me/typed")
def typed(body: NewEmail, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.email = body.email
    db.add(user)
    db.commit()
    return {"ok": True}


@app.get("/users-all")
def users_all(session: SessionDep, current_user: CurrentUser):
    return session.exec(select(User)).all()
"#;

static READ: std::sync::LazyLock<BTreeMap<String, String>> = std::sync::LazyLock::new(|| {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "fastapi\nsqlmodel\nredis\n"),
        ("app/__init__.py", ""),
        ("app/models.py", MODELS),
        ("app/deps.py", DEPS),
        ("app/crud.py", CRUD),
        ("app/main.py", MAIN),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    authz(dir.path())
});

fn said(route: &str) -> &'static str {
    READ.get(route)
        .unwrap_or_else(|| panic!("no route {route}: {:?}", *READ))
}

#[test]
fn a_route_that_hands_the_session_the_callers_own_record_and_nothing_else() {
    assert_eq!(said("/me/password"), "known own_record");
    assert_eq!(said("/me/leave"), "known own_record");
    // On a session a parameter types as the package's.
    assert_eq!(said("/me/typed"), "known own_record");
}

#[test]
fn beside_rows_read_by_what_the_request_chose_the_callers_own_record_is_found() {
    // A helper looks another user up by the email the request sent.
    assert_eq!(said("/me"), "unknown check_not_proven other_read_unscoped");
    assert_eq!(
        said("/me/direct"),
        "unknown check_not_proven other_read_unscoped"
    );
}

#[test]
fn a_row_the_request_names_is_not_the_callers_own_record() {
    assert_eq!(said("/other/{user_id}"), "none");
    // A model named for the caller is a class, not who calls.
    assert!(!said("/users-all").starts_with("known"), "{:?}", *READ);
}

#[test]
fn a_row_built_with_a_field_given_the_caller_itself_is_the_callers() {
    assert_eq!(said("/things-kw"), "known owner_stamp");
}

#[test]
fn a_field_given_through_a_method_that_was_not_read_is_found() {
    assert_eq!(said("/things"), "unknown check_not_proven callee_unread");
}

#[test]
fn a_row_whose_owner_is_anyone_else_proves_nothing() {
    // The request chose the owner.
    assert_eq!(said("/things-asked"), "none");
    for route in [
        // Built as the caller's, then written again by what the request sent.
        "/things-rewritten",
        // Something unpacked into the dict after the field.
        "/things-spread",
        // A group read off the caller is not the caller.
        "/things-group",
        // A second build of the model is the request's.
        "/things-two",
    ] {
        assert!(!said(route).starts_with("known"), "{route}: {:?}", *READ);
        assert!(!said(route).contains("owner_stamp"), "{route}: {:?}", *READ);
    }
}

#[test]
fn beside_another_row_handed_to_the_session_the_built_row_is_found() {
    assert_eq!(
        said("/things-and-other"),
        "unknown check_not_proven other_read_unscoped"
    );
}

#[test]
fn what_is_no_data_session_and_a_body_that_was_not_read_prove_nothing() {
    // A package's function, and a client of no data library.
    assert!(!said("/me/welcome").starts_with("known"), "{:?}", *READ);
    assert!(!said("/me/cached").starts_with("known"), "{:?}", *READ);
    // The session is handed on to a helper the facts do not type.
    assert!(!said("/me/helper").starts_with("known"), "{:?}", *READ);
}
