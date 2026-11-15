//! Two ways a route is scoped to who calls that were found and never proven:
//!
//! - TypeScript: a query filtered by a value of the caller's own (`where: { userId:
//!   req.user.id }`). Where the value came from was not recorded, so every such
//!   filter read "found, not proven". It is now read where the lowering reads the
//!   value off the caller and every request reaches the call.
//! - Python: a FastAPI dependency that hands back the row the verified token names
//!   (`def get_current_user(db, token): ... return db.get(User, claims.sub)`). What
//!   it returned was no value of the caller, so no comparison with it was proven.
//!   It is one where every dependency its returns read their value off signs the
//!   caller in.
//!
//! What the request sent, a filter only some requests reach, and a dependency that
//! returns what no authentication gave stay what they were.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

/// What the practice map says of the authorization of each route, by its path:
/// `known <mechanisms>`, `none`, or `unknown`.
fn authz(root: &Path) -> BTreeMap<String, String> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
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
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

#[test]
fn a_typescript_query_filtered_by_the_callers_own_value_is_the_scope() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.get("/mine", requireUser, async (req, res) => {
  res.json(await prisma.note.findMany({ where: { userId: req.user.id } }));
});
app.get("/tenant", requireUser, async (req, res) => {
  const orgId = req.user.orgId;
  res.json(await prisma.note.findMany({ where: { orgId } }));
});
app.get("/sent", requireUser, async (req, res) => {
  res.json(await prisma.note.findMany({ where: { userId: req.query.userId } }));
});
app.get("/some", requireUser, async (req, res) => {
  if (req.query.mine) {
    return res.json(await prisma.note.findMany({ where: { userId: req.user.id } }));
  }
  res.json(await prisma.note.findMany({ where: { userId: req.query.userId } }));
});
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["/mine"], "known owner_filter", "{got:?}");
    assert_eq!(got["/tenant"], "known tenancy_filter", "{got:?}");
    assert_eq!(got["/sent"], "unknown", "{got:?}");
    assert_eq!(got["/some"], "unknown", "{got:?}");
}

const DEPS: &str = r#"from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from app.db import engine
from app.models import TokenPayload, User

oauth2 = OAuth2PasswordBearer(tokenUrl="/login")


def get_db():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(oauth2)]


def get_current_user(session: SessionDep, token: TokenDep) -> User:
    try:
        payload = jwt.decode(token, "k", algorithms=["HS256"])
        token_data = TokenPayload(**payload)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=403, detail="Could not validate credentials")
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_first_user(session: SessionDep) -> User:
    return session.get(User, 1)


FirstUser = Annotated[User, Depends(get_first_user)]
"#;

#[test]
fn a_dependency_that_loads_the_row_the_token_names_gives_the_caller() {
    let dir = write(&[
        ("requirements.txt", "fastapi\nsqlmodel\npyjwt\n"),
        ("app/__init__.py", ""),
        (
            "app/db.py",
            "from sqlmodel import create_engine\n\nengine = create_engine(\"sqlite://\")\n",
        ),
        (
            "app/models.py",
            "from sqlmodel import Field, SQLModel\n\n\nclass User(SQLModel, table=True):\n    id: int = Field(primary_key=True)\n    is_superuser: bool = False\n\n\nclass Item(SQLModel, table=True):\n    id: int = Field(primary_key=True)\n    owner_id: int\n\n\nclass TokenPayload(SQLModel):\n    sub: int\n",
        ),
        ("app/deps.py", DEPS),
        (
            "app/main.py",
            r#"from fastapi import FastAPI, HTTPException

from app.deps import CurrentUser, FirstUser, SessionDep
from app.models import Item

app = FastAPI()


@app.get("/owner/{id}")
def owner(session: SessionDep, current_user: CurrentUser, id: int):
    item = session.get(Item, id)
    if item.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return item


@app.delete("/owner-or-role/{id}")
def owner_or_role(session: SessionDep, current_user: CurrentUser, id: int):
    item = session.get(Item, id)
    if not current_user.is_superuser and (item.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    session.delete(item)
    return {"ok": True}


@app.get("/not-the-caller/{id}")
def not_the_caller(session: SessionDep, token_user: CurrentUser, first: FirstUser, id: int):
    item = session.get(Item, id)
    if item.owner_id != first.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return item
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["/owner/{id}"], "known owner_check", "{got:?}");
    assert_eq!(got["/owner-or-role/{id}"], "known owner_check", "{got:?}");
    assert_eq!(got["/not-the-caller/{id}"], "unknown", "{got:?}");
}
