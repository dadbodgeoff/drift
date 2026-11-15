//! Rows read by the caller itself, however the query is written, and a guard
//! that looks the caller up in what the request names, on a session a dependency
//! gives (FastAPI with SQLAlchemy).
//!
//! The lowering says, for each statement that reads rows, the class it names and
//! by what it filters them ([`drift_core::controls::ROWS`]): by the caller itself
//! (`.filter(Seat.holder_id == user.id)`, `.filter_by(holder_id=user.id)`), by a
//! value read off other rows, or by anything else. A route is scoped by the caller
//! where every read of it is. A filter under an `or` narrows nothing, and one query
//! by the caller beside another by what the request sent alone scopes the first,
//! not what the route reads.
//!
//! A refusal the map cannot name turns more requests away, never fewer: beside a
//! check every request passes it changes nothing of what is proven.

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
    def __init__(self, id, is_admin):
        self.id = id
        self.is_admin = is_admin


def get_db():
    yield Session()


def current_user(token: str = Depends(oauth2)) -> Caller:
    if not token:
        raise HTTPException(status_code=401)
    return Caller(1, False)


def admin(user: Caller = Depends(current_user)) -> Caller:
    if not user.is_admin:
        raise HTTPException(status_code=403)
    return user


def seated(space: str, db: Session = Depends(get_db), user: Caller = Depends(current_user)):
    seat = db.query(Seat).filter_by(holder_id=user.id, space=space).first()
    if seat is None:
        raise HTTPException(status_code=403)
    return seat


def seat_asked(space: str, db: Session = Depends(get_db), user: Caller = Depends(current_user)):
    return db.query(Seat).filter_by(holder_id=user.id, space=space).first()


def any_seat(space: str, db: Session = Depends(get_db), user: Caller = Depends(current_user)):
    seat = db.query(Seat).filter_by(space=space).first()
    if seat is None:
        raise HTTPException(status_code=403)
    return seat
"#;

const MAIN: &str = r#"from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.deps import Caller, admin, any_seat, current_user, get_db, seat_asked, seated
from app.models import Note, Seat

app = FastAPI()


@app.get("/mine")
def mine(user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    return db.query(Seat).filter(Seat.holder_id == user.id).all()


@app.get("/mine-by")
def mine_by(user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    return db.query(Seat).filter_by(holder_id=user.id).all()


@app.get("/mine-and/{note_id}")
def mine_and(note_id: int, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    seats = db.query(Seat).filter(Seat.holder_id == user.id).all()
    note = db.get(Note, note_id)
    return {"seats": seats, "note": note}


@app.get("/either/{space}")
def either(space: str, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    return db.query(Seat).filter((Seat.holder_id == user.id) | (Seat.space == space)).all()


@app.get("/spaces/{space}/notes")
def notes(space: str, seat=Depends(seated), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=space).all()


@app.get("/spaces/{space}/asked")
def asked(space: str, seat=Depends(seat_asked), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=space).all()


@app.get("/spaces/{space}/any")
def any_notes(space: str, seat=Depends(any_seat), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=space).all()


@app.get("/spaces/{space}/open")
def open_notes(space: str, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    return db.query(Note).filter_by(space=space).all()


@app.get("/people/{person_id}")
def person(person_id: int, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    seat = db.get(Seat, person_id)
    if person_id == user.id:
        return seat
    if not user.is_admin:
        raise HTTPException(status_code=403)
    return seat


@app.get("/people-or-preview/{person_id}")
def person_or_preview(
    person_id: int,
    preview: bool = False,
    user: Caller = Depends(current_user),
    db: Session = Depends(get_db),
):
    seat = db.get(Seat, person_id)
    if person_id == user.id:
        return seat
    if preview:
        return seat
    if not user.is_admin:
        raise HTTPException(status_code=403)
    return seat


@app.delete("/notes/{note_id}", dependencies=[Depends(admin)])
def delete_note(note_id: int, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if note.space == "archive":
        raise HTTPException(status_code=403, detail="archived notes stay")
    db.delete(note)
    return {"ok": True}


@app.delete("/drafts/{note_id}")
def delete_draft(note_id: int, user: Caller = Depends(current_user), db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if note.space == "archive":
        raise HTTPException(status_code=403, detail="archived notes stay")
    db.delete(note)
    return {"ok": True}
"#;

fn repo() -> BTreeMap<String, String> {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "fastapi\nsqlalchemy\n"),
        ("app/__init__.py", ""),
        ("app/models.py", MODELS),
        ("app/deps.py", DEPS),
        ("app/main.py", MAIN),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    authz(dir.path())
}

#[test]
fn rows_filtered_by_the_caller_itself_scope_the_route_however_the_query_is_written() {
    let got = repo();
    assert_eq!(got["/mine"], "known owner_filter", "{got:?}");
    assert_eq!(got["/mine-by"], "known owner_filter", "{got:?}");
    // Beside rows read by what the request sent alone.
    assert!(!got["/mine-and/{note_id}"].starts_with("known"), "{got:?}");
    // Under an `or`, the filter narrows nothing.
    assert!(!got["/either/{space}"].starts_with("known"), "{got:?}");
}

#[test]
fn a_dependency_that_refuses_unless_the_caller_is_found_in_what_the_request_names() {
    let got = repo();
    assert_eq!(
        got["/spaces/{space}/notes"], "known membership_guard",
        "{got:?}"
    );
    // The lookup is made and nothing is refused on it.
    assert!(
        !got["/spaces/{space}/asked"].starts_with("known"),
        "{got:?}"
    );
    // The lookup is of no caller: whether the space has any seat.
    assert!(!got["/spaces/{space}/any"].starts_with("known"), "{got:?}");
    // No lookup at all: every signed-in caller reads any space's notes.
    assert_eq!(got["/spaces/{space}/open"], "none", "{got:?}");
}

#[test]
fn a_refusal_the_map_cannot_name_changes_nothing_beside_a_proven_check() {
    let got = repo();
    // Behind a role guard every request passes: the guard is what is known.
    assert_eq!(got["/notes/{note_id}"], "known role_guard", "{got:?}");
    // Alone, it may be the authorization: unknown, never none and never known.
    assert!(got["/drafts/{note_id}"].starts_with("unknown"), "{got:?}");
}

#[test]
fn a_check_after_a_return_for_the_callers_own_record_is_asked_of_everyone_else() {
    let got = repo();
    // The caller's own record, or a role: every request is one or passes the other.
    assert_eq!(got["/people/{person_id}"], "known role_check", "{got:?}");
    // A second branch returns for a reason that is no caller's: some requests
    // reach neither the own record nor the role.
    assert!(
        got["/people-or-preview/{person_id}"].starts_with("unknown check_not_proven"),
        "{got:?}"
    );
}
