//! Authorization of a Python route, as a matrix. Every cell is generated here from
//! tables and read by the built binary, once per generated repository.
//!
//! Two rules, both defaults and neither a list of spellings.
//!
//! (A) `none` needs everything in reach read. What stands at a guard position of a
//! route (a decorator, a dependency, a hook, a base class, a permission class, a
//! middleware) and could not be read can check a role, a tenant or an owner as
//! easily as a sign-in:
//!
//! - u: a value of a package on no list (django-guardian, django-rules,
//!   Flask-Principal and an invented `company_auth` among them): unknown;
//! - n: a function or class of the repository read to the end, with nothing of
//!   authorization in it: nothing (the route reads `none`);
//! - x: one of the repository that is not read to the end (it calls a package's
//!   function no list knows), or a value that is not followed: unknown;
//! - r, t, o: one of the repository that refuses on a role, on the caller's tenant
//!   or on the owner, for every request: known, by that check;
//! - b: one that checks under a branch: unknown (found, not proven);
//! - s: a library's guard on the closed list that only signs the caller in:
//!   nothing;
//! - a: a library's guard on the closed list of those that check a role, a
//!   permission or a scope, in a call shape that makes it check one: a role guard.
//!
//! Every cell has a sign-in guard that is proven, so the route has an authorization
//! unit, and asserts the route the thing covers and a sibling it does not cover:
//! the sibling stays `none`, so the rule cannot pass by calling everything unknown.
//!
//! `DRIFT_MATRIX_DUMP=<file>` writes one line per cell (and fails nothing), which
//! is how the states of two binaries are compared; `DRIFT_MATRIX_KEEP=<dir>` keeps
//! the generated repositories.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// The files of a fixture repository, by path.
type Files = BTreeMap<String, String>;

fn write_at(root: &Path, files: &Files) {
    for (rel, body) in files {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
}

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

const NONE: &str = "none";
const UNKNOWN: &str = "unknown";
const ROLE_GUARD: &str = "known role_guard";
#[allow(dead_code)]
const ROLE_CHECK: &str = "known role_check";
const TENANCY_GUARD: &str = "known tenancy_guard";
#[allow(dead_code)]
const TENANCY_CHECK: &str = "known tenancy_check";
#[allow(dead_code)]
const OWNER_FILTER: &str = "known owner_filter";
const TENANCY_FILTER: &str = "known tenancy_filter";
const OWNER_CHECK: &str = "known owner_check";

/// What the practice map says of the authorization of every HTTP entry point of
/// `root`, by `METHOD route`: `none`, `unknown`, or `known` with the mechanisms of
/// its key (`known role_guard`, `known tenancy_check+tenancy_filter`). A route
/// whose authentication is not known has `authn <state>` in front, since its
/// authorization unit says nothing of the thing under test.
fn answers(root: &Path) -> BTreeMap<String, String> {
    let map = drift(root, &["practices", "--json", "--units"]);
    let concern = |id: &str| -> Value {
        map["concerns"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .cloned()
            .unwrap_or(Value::Null)
    };
    let (authn, authz) = (concern("authn"), concern("authz"));
    let key_of = |c: &Value, u: &Value| -> String {
        let variants: Vec<&Value> = c["variants"].as_array().into_iter().flatten().collect();
        u["key"]
            .as_str()
            .or_else(|| {
                variants
                    .iter()
                    .copied()
                    .chain(
                        variants
                            .iter()
                            .filter_map(|v| v["alternatives"].as_array())
                            .flatten(),
                    )
                    .find(|v| v["id"] == u["variant"])
                    .and_then(|v| v["key"].as_str())
            })
            .unwrap_or_default()
            .to_string()
    };
    let at = |u: &Value| {
        format!(
            "{} {}",
            u["method"].as_str().unwrap_or_default(),
            u["route"].as_str().unwrap_or_default()
        )
    };
    let mut out = BTreeMap::new();
    for u in authn["units"].as_array().into_iter().flatten() {
        let state = u["assignment"].as_str().unwrap();
        out.insert(at(u), format!("no authorization unit (authn {state})"));
    }
    for u in authz["units"].as_array().into_iter().flatten() {
        let said = out.entry(at(u)).or_default();
        *said = match u["assignment"].as_str().unwrap() {
            "known" => {
                let mut mechanisms: Vec<String> = key_of(&authz, u)
                    .split('+')
                    .map(|k| k.split(':').next().unwrap_or_default().to_string())
                    .collect();
                mechanisms.sort();
                mechanisms.dedup();
                format!("known {}", mechanisms.join("+"))
            }
            "unknown" => UNKNOWN.to_string(),
            _ => NONE.to_string(),
        };
    }
    out
}

/// Something written in a cell.
#[derive(Clone, Copy)]
struct Thing {
    /// The provenance letter (the module documentation) and a word for the shape.
    id: &'static str,
    /// What the route it covers reads.
    want: &'static str,
    /// What the module that uses it needs before: imports, a binding.
    pre: &'static str,
    /// The expression written at the position.
    expr: &'static str,
}

const fn thing(
    id: &'static str,
    want: &'static str,
    pre: &'static str,
    expr: &'static str,
) -> Thing {
    Thing {
        id,
        want,
        pre,
        expr,
    }
}

/// A place a thing is written at: the module of one cell and what the module of the
/// application holds for it. `{PRE}` and `{E}` are the thing's, `{C}` the cell's name
/// (its routes are `/{C}/covered` and `/{C}/sibling`), `{M}` its module.
struct Position {
    id: &'static str,
    cell: &'static str,
    main: &'static str,
    /// The things the position takes, by the start of their name; all when empty.
    only: &'static [&'static str],
    /// The things it does not take, by the start of their name.
    not: &'static [&'static str],
    /// The things whose authentication is not known at this position, by name:
    /// the route has no authorization unit, which reads `unknown`.
    unknown: &'static [&'static str],
}

fn fill(template: &str, t: &Thing, cell: &str) -> String {
    template
        .replace("{PRE}", t.pre)
        .replace("{E}", t.expr)
        .replace("{C}", cell)
        .replace("{M}", cell)
}

/// One line of the result: what a cell read, and what it should.
struct Cell {
    table: &'static str,
    position: &'static str,
    thing: &'static str,
    want: &'static str,
    covered: String,
    sibling: String,
}

impl Cell {
    /// A route whose authentication is unknown has no authorization unit: nothing
    /// is said of what a signed-in caller may do there, which is `unknown`.
    fn read(&self) -> &str {
        if self.covered == "no authorization unit (authn unknown)" {
            UNKNOWN
        } else {
            &self.covered
        }
    }

    fn ok(&self) -> bool {
        self.read() == self.want && self.sibling == NONE
    }
}

/// Reads one repository per position, every thing in a module of its own, and
/// returns a cell for each. `base` are the files every repository has; `main` builds
/// the application module from the lines the cells add to it.
fn run(
    table: &'static str,
    positions: &[Position],
    things: &[Thing],
    base: &Files,
    package: &str,
    main: &dyn Fn(&str) -> (String, String),
) -> Vec<Cell> {
    let mut cells = Vec::new();
    let keep = std::env::var("DRIFT_MATRIX_KEEP").ok();
    for p in positions {
        let mut files = base.clone();
        let mut lines = String::new();
        let things: Vec<&Thing> = things
            .iter()
            .filter(|t| p.only.is_empty() || p.only.iter().any(|o| t.id.starts_with(o)))
            .filter(|t| !p.not.iter().any(|o| t.id.starts_with(o)))
            .collect();
        for t in &things {
            let cell = format!("{}_{}", p.id, t.id);
            files.insert(format!("{package}/{cell}.py"), fill(p.cell, t, &cell));
            lines.push_str(&fill(p.main, t, &cell));
        }
        let (path, text) = main(&lines);
        files.insert(path, text);
        let said = match &keep {
            Some(k) => {
                let root = Path::new(k).join(format!("{table}_{}", p.id));
                let _ = std::fs::remove_dir_all(&root);
                write_at(&root, &files);
                answers(&root)
            }
            None => {
                let dir = tempfile::tempdir().unwrap();
                write_at(dir.path(), &files);
                answers(dir.path())
            }
        };
        for t in &things {
            let cell = format!("{}_{}", p.id, t.id);
            // (A Django view is listed for every method, or for the one it defines.)
            let get = |which: &str| {
                said.iter()
                    .find(|(at, _)| {
                        at.split_once(' ').is_some_and(|(_, route)| {
                            let route = route.trim_end_matches('/');
                            route == format!("/{cell}/{which}")
                                || route.starts_with(&format!("/{cell}/{which}/"))
                        })
                    })
                    .map(|(_, state)| state.clone())
                    .unwrap_or_else(|| "not listed".to_string())
            };
            cells.push(Cell {
                table,
                position: p.id,
                thing: t.id,
                want: if p.unknown.contains(&t.id) {
                    UNKNOWN
                } else {
                    t.want
                },
                covered: get("covered"),
                sibling: get("sibling"),
            });
        }
    }
    cells
}

/// Fails with every cell that reads wrong; with `DRIFT_MATRIX_DUMP` set, appends the
/// cells to that file and fails nothing.
fn settle(cells: Vec<Cell>) {
    if let Ok(path) = std::env::var("DRIFT_MATRIX_DUMP") {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        for c in &cells {
            writeln!(
                f,
                "{}\t{}\t{}\t{}\t{}\t{}",
                c.table,
                c.position,
                c.thing,
                c.want,
                c.read(),
                c.sibling
            )
            .unwrap();
        }
        return;
    }
    let wrong: Vec<String> = cells
        .iter()
        .filter(|c| !c.ok())
        .map(|c| {
            format!(
                "{} {} x {}: covered reads '{}' (want '{}'), sibling reads '{}'",
                c.table, c.position, c.thing, c.covered, c.want, c.sibling
            )
        })
        .collect();
    assert!(
        wrong.is_empty(),
        "{} of {} cells read wrong:\n{}",
        wrong.len(),
        cells.len(),
        wrong.join("\n")
    );
}

fn files(list: &[(&str, &str)]) -> Files {
    list.iter()
        .map(|(p, b)| (p.to_string(), b.to_string()))
        .collect()
}

// ---------------------------------------------------------------------------------
// (A) FastAPI: dependencies
// ---------------------------------------------------------------------------------

const FASTAPI_THINGS_PY: &str = r#"import os
from dataclasses import dataclass

from company_auth import verify as vendor_verify
from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPBearer, OAuth2PasswordBearer, SecurityScopes


@dataclass
class User:
    id: str
    role: str
    org_id: str
    scopes: list


@dataclass
class Document:
    id: str
    owner_id: str
    org_id: str


def require_user(authorization: str | None = Header(None)) -> User:
    if not authorization:
        raise HTTPException(status_code=401)
    return User(id=authorization, role="member", org_id="o1", scopes=[])


def require_claims(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return {"sub": authorization, "role": "member"}


def load_document(document_id: str) -> Document:
    return Document(id=document_id, owner_id="u1", org_id="o1")


def paging(limit: int = 10, offset: int = 0):
    return {"limit": limit, "offset": offset}


def get_db():
    db = {"open": True}
    try:
        yield db
    finally:
        db["open"] = False


class Pager:
    def __init__(self, size: int = 10):
        self.size = size

    def __call__(self, page: int = 1):
        return {"page": page, "size": self.size}


def vendor_gate(request: Request):
    vendor_verify(request)
    return True


def require_admin(user: User = Depends(require_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403)
    return user


def require_admin_claim(claims=Depends(require_claims)):
    if claims["role"] != "admin":
        raise HTTPException(status_code=403)
    return claims


class RequireAdmin:
    def __call__(self, user: User = Depends(require_user)):
        if user.role != "admin":
            raise HTTPException(status_code=403)
        return user


class RequireRole:
    def __init__(self, role: str):
        self.role = role

    def __call__(self, user: User = Depends(require_user)):
        if user.role != self.role:
            raise HTTPException(status_code=403)
        return user


def same_org(org_id: str, user: User = Depends(require_user)):
    if user.org_id != org_id:
        raise HTTPException(status_code=403)
    return org_id


def own_document(document_id: str, user: User = Depends(require_user)):
    document = load_document(document_id)
    if document.owner_id != user.id:
        raise HTTPException(status_code=404)
    return document


STRICT = os.environ.get("STRICT") == "1"


def admin_if_strict(user: User = Depends(require_user)):
    if STRICT:
        if user.role != "admin":
            raise HTTPException(status_code=403)
    return user


def same_org_unless_staff(org_id: str, user: User = Depends(require_user)):
    if user.role == "staff":
        return org_id
    if user.org_id != org_id:
        raise HTTPException(status_code=403)
    return org_id


def scoped(security_scopes: SecurityScopes, user: User = Depends(require_user)):
    for scope in security_scopes.scopes:
        if scope not in user.scopes:
            raise HTTPException(status_code=403)
    return user


GUARDS = {"admin": require_admin, "db": get_db}


def pick_guard():
    return GUARDS[os.environ.get("MODE", "admin")]


bearer = HTTPBearer()
oauth2 = OAuth2PasswordBearer(tokenUrl="token", scopes={"items": "Read items"})
"#;

const FASTAPI_USERS_PY: &str = r#"from fastapi_users import FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy

bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy():
    return JWTStrategy(secret="not-a-secret", lifetime_seconds=3600)


auth_backend = AuthenticationBackend(
    name="jwt", transport=bearer_transport, get_strategy=get_jwt_strategy
)


async def get_user_manager():
    yield None


fastapi_users = FastAPIUsers(get_user_manager, [auth_backend])
current_active_user = fastapi_users.current_user(active=True)
current_verified_user = fastapi_users.current_user(active=True, verified=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
current_maybe_superuser = fastapi_users.current_user(superuser=IS_STRICT)
"#;

/// What a FastAPI dependency can be, beside the sign-in every cell has.
const FASTAPI_DEPENDENCIES: &[Thing] = &[
    thing(
        "u_name",
        UNKNOWN,
        "from company_auth import require_scope",
        "require_scope",
    ),
    thing(
        "u_called",
        UNKNOWN,
        "from company_auth import require_scope",
        "require_scope(\"items\")",
    ),
    thing(
        "u_instance",
        UNKNOWN,
        "from company_auth.fastapi import Authorizer\n\nauthorizer = Authorizer(roles=[\"admin\"])",
        "authorizer",
    ),
    thing(
        "u_member",
        UNKNOWN,
        "from company_auth.fastapi import Authorizer\n\nauthorizer = Authorizer()",
        "authorizer.require(\"admin\")",
    ),
    thing(
        "n_function",
        NONE,
        "from svc.things import paging",
        "paging",
    ),
    thing(
        "n_generator",
        NONE,
        "from svc.things import get_db",
        "get_db",
    ),
    thing("n_class", NONE, "from svc.things import Pager", "Pager()"),
    thing(
        "x_calls_unlisted",
        UNKNOWN,
        "from svc.things import vendor_gate",
        "vendor_gate",
    ),
    thing(
        "x_lookup",
        UNKNOWN,
        "from svc.things import GUARDS",
        "GUARDS[\"admin\"]",
    ),
    thing(
        "x_factory",
        UNKNOWN,
        "from svc.things import pick_guard",
        "pick_guard()",
    ),
    thing(
        "x_unresolved",
        UNKNOWN,
        "from svc.missing import require_admin",
        "require_admin",
    ),
    thing(
        "r_function",
        ROLE_GUARD,
        "from svc.things import require_admin",
        "require_admin",
    ),
    thing(
        "r_claim",
        ROLE_GUARD,
        "from svc.things import require_admin_claim",
        "require_admin_claim",
    ),
    thing(
        "r_class",
        ROLE_GUARD,
        "from svc.things import RequireAdmin",
        "RequireAdmin()",
    ),
    // The caller's role against the role the instance was built for.
    thing(
        "r_class_attribute",
        ROLE_GUARD,
        "from svc.things import RequireRole",
        "RequireRole(\"admin\")",
    ),
    thing(
        "t_tenant",
        TENANCY_GUARD,
        "from svc.things import same_org",
        "same_org",
    ),
    thing(
        "o_owner",
        OWNER_CHECK,
        "from svc.things import own_document",
        "own_document",
    ),
    thing(
        "b_branch",
        UNKNOWN,
        "from svc.things import admin_if_strict",
        "admin_if_strict",
    ),
    thing(
        "b_early_return",
        UNKNOWN,
        "from svc.things import same_org_unless_staff",
        "same_org_unless_staff",
    ),
    thing("b_loop", UNKNOWN, "from svc.things import scoped", "scoped"),
    thing("s_bearer", NONE, "from svc.things import bearer", "bearer"),
    thing(
        "s_oauth2_scopes",
        NONE,
        "from svc.things import oauth2",
        "oauth2",
    ),
    thing(
        "s_users_active",
        NONE,
        "from svc.users import current_active_user",
        "current_active_user",
    ),
    thing(
        "s_users_verified",
        NONE,
        "from svc.users import current_verified_user",
        "current_verified_user",
    ),
    thing(
        "a_users_superuser",
        ROLE_GUARD,
        "from svc.users import current_superuser",
        "current_superuser",
    ),
    thing(
        "a_users_superuser_inline",
        ROLE_GUARD,
        "from svc.users import fastapi_users",
        "fastapi_users.current_user(superuser=True)",
    ),
    thing(
        "x_users_superuser_unread",
        UNKNOWN,
        "from svc.users import current_maybe_superuser",
        "current_maybe_superuser",
    ),
];

const FASTAPI_ROUTER: &str = "from svc import {M}\n\napp.include_router({M}.router)\n";

/// Where a FastAPI dependency is written. The sign-in (`require_user`) is a
/// parameter of both handlers.
const FASTAPI_POSITIONS: &[Position] = &[
    Position {
        id: "param",
        cell: "from fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user), extra=Depends({E})):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "annotated",
        cell: "from typing import Annotated\n\nfrom fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(extra: Annotated[object, Depends({E})], who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "alias",
        cell: "from typing import Annotated\n\nfrom fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\nExtra = Annotated[object, Depends({E})]\n\n\n@router.get(\"/{C}/covered\")\ndef covered(extra: Extra, who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
    // FastAPI hands the scopes to a dependency that asks for them, and checks none
    // itself.
    Position {
        id: "security",
        cell: "from fastapi import APIRouter, Depends, Security\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user), extra=Security({E}, scopes=[\"items\"])):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "route",
        cell: "from fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\", dependencies=[Depends({E})])\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "router",
        cell: "from fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter(dependencies=[Depends({E})])\nopen_router = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@open_router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: "from svc import {M}\n\napp.include_router({M}.router)\napp.include_router({M}.open_router)\n",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "include",
        cell: "from fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\nopen_router = APIRouter()\nouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@open_router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\nouter.include_router(router, dependencies=[Depends({E})])\nouter.include_router(open_router)\n",
        main: "from svc import {M}\n\napp.include_router({M}.outer)\n",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "app",
        cell: "from fastapi import Depends, FastAPI\nfrom svc.things import require_user\n{PRE}\n\napp = FastAPI(dependencies=[Depends({E})])\nother = FastAPI()\n\n\n@app.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: "",
        only: &[],
        not: &[],
        unknown: &[],
    },
    // A dependency of the dependency the handler asks for.
    Position {
        id: "sub",
        cell: "from fastapi import APIRouter, Depends\nfrom svc.things import require_user\n{PRE}\n\nrouter = APIRouter()\n\n\ndef outer(who=Depends(require_user), inner=Depends({E})):\n    return who\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(outer)):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        only: &[],
        not: &[],
        unknown: &[],
    },
];

fn fastapi_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "fastapi==0.115.0\nfastapi-users==13.0.0\nuvicorn==0.30.0\ncompany-auth==1.0.0\n",
        ),
        ("svc/__init__.py", ""),
        ("svc/things.py", FASTAPI_THINGS_PY),
        (
            "svc/users.py",
            &FASTAPI_USERS_PY.replace(
                "from fastapi_users import FastAPIUsers\n",
                "import os\n\nfrom fastapi_users import FastAPIUsers\n\nIS_STRICT = os.environ.get(\"STRICT\") == \"1\"\n",
            ),
        ),
    ])
}

fn fastapi_main(lines: &str) -> (String, String) {
    (
        "svc/main.py".to_string(),
        format!("from fastapi import FastAPI\n\napp = FastAPI()\n\n{lines}"),
    )
}

#[test]
fn a_fastapi_dependency_is_read_for_authorization_at_every_position() {
    settle(run(
        "fastapi",
        FASTAPI_POSITIONS,
        FASTAPI_DEPENDENCIES,
        &fastapi_base(),
        "svc",
        &fastapi_main,
    ));
}

// ---------------------------------------------------------------------------------
// (A) Flask: decorators and hooks
// ---------------------------------------------------------------------------------

const FLASK_THINGS_PY: &str = r#"import os
from dataclasses import dataclass
from functools import wraps

from company_auth import verify as vendor_verify
from flask import abort, g, request
from flask_login import current_user


@dataclass
class Document:
    id: str
    owner_id: str
    org_id: str


def load_document(document_id):
    return Document(id=document_id, owner_id="u1", org_id="v1")


def timed(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        g.started = True
        return view(*args, **kwargs)

    return wrapper


def vendor_checked(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        vendor_verify(request)
        return view(*args, **kwargs)

    return wrapper


def admins_only(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user.role != "admin":
            abort(403)
        return view(*args, **kwargs)

    return wrapper


def require_role(role):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if current_user.role != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapper

    return decorator


def same_org(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user.org_id != request.args.get("org_id"):
            abort(403)
        return view(*args, **kwargs)

    return wrapper


def owner_only(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        document = load_document(request.args["document_id"])
        if document.owner_id != current_user.id:
            abort(404)
        return view(*args, **kwargs)

    return wrapper


STRICT = os.environ.get("STRICT") == "1"


def admins_if_strict(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if STRICT:
            if current_user.role != "admin":
                abort(403)
        return view(*args, **kwargs)

    return wrapper


GUARDS = {"admin": admins_only}


def note_request():
    g.started = True


def vendor_hook():
    vendor_verify(request)


def admins_hook():
    if current_user.role != "admin":
        abort(403)


def org_hook():
    if current_user.org_id != request.args.get("org_id"):
        abort(403)


def admins_hook_if_strict():
    if STRICT:
        if current_user.role != "admin":
            abort(403)


HOOKS = {"admin": admins_hook}
"#;

/// What a decorator of a Flask view can be, inside the sign-in every cell has.
const FLASK_DECORATORS: &[Thing] = &[
    thing(
        "u_name",
        UNKNOWN,
        "from company_auth import check_tenant",
        "check_tenant",
    ),
    thing(
        "u_called",
        UNKNOWN,
        "from company_auth import require_scope",
        "require_scope(\"items\")",
    ),
    thing(
        "u_principal",
        UNKNOWN,
        "from flask_principal import Permission, RoleNeed\n\nadmin_permission = Permission(RoleNeed(\"admin\"))",
        "admin_permission.require(http_exception=403)",
    ),
    thing("n_decorator", NONE, "from app.things import timed", "timed"),
    thing(
        "n_library",
        NONE,
        "from flask_cors import cross_origin",
        "cross_origin()",
    ),
    thing(
        "x_calls_unlisted",
        UNKNOWN,
        "from app.things import vendor_checked",
        "vendor_checked",
    ),
    thing(
        "x_lookup",
        UNKNOWN,
        "from app.things import GUARDS",
        "GUARDS[\"admin\"]",
    ),
    thing(
        "r_decorator",
        ROLE_GUARD,
        "from app.things import admins_only",
        "admins_only",
    ),
    thing(
        "r_factory",
        ROLE_GUARD,
        "from app.things import require_role",
        "require_role(\"admin\")",
    ),
    thing(
        "t_tenant",
        TENANCY_GUARD,
        "from app.things import same_org",
        "same_org",
    ),
    thing(
        "o_owner",
        OWNER_CHECK,
        "from app.things import owner_only",
        "owner_only",
    ),
    thing(
        "b_branch",
        UNKNOWN,
        "from app.things import admins_if_strict",
        "admins_if_strict",
    ),
    thing(
        "s_fresh",
        NONE,
        "from flask_login import fresh_login_required",
        "fresh_login_required",
    ),
    thing(
        "s_jwt",
        NONE,
        "from flask_jwt_extended import jwt_required",
        "jwt_required()",
    ),
    thing(
        "s_httpauth",
        NONE,
        "from flask_httpauth import HTTPBasicAuth\n\nauth = HTTPBasicAuth()",
        "auth.login_required",
    ),
    thing(
        "a_httpauth_role",
        ROLE_GUARD,
        "from flask_httpauth import HTTPTokenAuth\n\nauth = HTTPTokenAuth()",
        "auth.login_required(role=\"admin\")",
    ),
    thing(
        "a_httpauth_roles",
        ROLE_GUARD,
        "from flask_httpauth import HTTPBasicAuth\n\nauth = HTTPBasicAuth()",
        "auth.login_required(role=[\"admin\", \"editor\"])",
    ),
    thing(
        "s_authlib",
        NONE,
        "from authlib.integrations.flask_oauth2 import ResourceProtector\n\nrequire_oauth = ResourceProtector()",
        "require_oauth()",
    ),
    thing(
        "a_authlib_scope",
        ROLE_GUARD,
        "from authlib.integrations.flask_oauth2 import ResourceProtector\n\nrequire_oauth = ResourceProtector()",
        "require_oauth(\"profile\")",
    ),
];

const FLASK_BLUEPRINT: &str = "from app import {M}\n\napp.register_blueprint({M}.bp)\n";

/// Where a decorator of a Flask view is written: inside Flask-Login's
/// `login_required`, which both routes have.
const FLASK_DECORATOR_POSITIONS: &[Position] = &[
    Position {
        id: "under",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@bp.get(\"/{C}/covered\")\n@login_required\n@{E}\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "alias",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nextra = {E}\n\n\n@bp.get(\"/{C}/covered\")\n@login_required\n@extra\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    },
    // Flask applies the list of a view class last first: the first is innermost.
    Position {
        id: "method_view",
        cell: "from flask import Blueprint\nfrom flask.views import MethodView\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\nclass Covered(MethodView):\n    decorators = [{E}, login_required]\n\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(MethodView):\n    decorators = [login_required]\n\n    def get(self):\n        return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func=Covered.as_view(\"covered\"))\nbp.add_url_rule(\"/{C}/sibling\", view_func=Sibling.as_view(\"sibling\"))\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "method",
        cell: "from flask import Blueprint\nfrom flask.views import MethodView\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\nclass Covered(MethodView):\n    decorators = [login_required]\n\n    @{E}\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(MethodView):\n    decorators = [login_required]\n\n    def get(self):\n        return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func=Covered.as_view(\"covered\"))\nbp.add_url_rule(\"/{C}/sibling\", view_func=Sibling.as_view(\"sibling\"))\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "url_rule",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\ndef covered():\n    return {\"ok\": True}\n\n\ndef sibling():\n    return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func=login_required({E}(covered)), methods=[\"GET\"])\nbp.add_url_rule(\"/{C}/sibling\", view_func=login_required(sibling), methods=[\"GET\"])\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    },
];

fn flask_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "flask==3.0.0\nflask-login==0.6.3\nflask-jwt-extended==4.6.0\nflask-httpauth==4.8.0\nauthlib==1.3.0\nflask-cors==4.0.0\nflask-principal==0.4.0\ncompany-auth==1.0.0\n",
        ),
        ("app/__init__.py", ""),
        ("app/things.py", FLASK_THINGS_PY),
    ])
}

fn flask_main(lines: &str) -> (String, String) {
    (
        "app/main.py".to_string(),
        format!("from flask import Flask\n\napp = Flask(__name__)\n\n{lines}"),
    )
}

#[test]
fn a_flask_decorator_is_read_for_authorization_at_every_position() {
    settle(run(
        "flask",
        FLASK_DECORATOR_POSITIONS,
        FLASK_DECORATORS,
        &flask_base(),
        "app",
        &flask_main,
    ));
}

/// What a function Flask runs before a request can be.
const FLASK_HOOKS: &[Thing] = &[
    thing(
        "u_name",
        UNKNOWN,
        "from company_auth import check_tenant",
        "check_tenant",
    ),
    thing(
        "n_function",
        NONE,
        "from app.things import note_request",
        "note_request",
    ),
    thing(
        "x_calls_unlisted",
        UNKNOWN,
        "from app.things import vendor_hook",
        "vendor_hook",
    ),
    thing(
        "x_lookup",
        UNKNOWN,
        "from app.things import HOOKS",
        "HOOKS[\"admin\"]",
    ),
    thing(
        "r_function",
        ROLE_GUARD,
        "from app.things import admins_hook",
        "admins_hook",
    ),
    thing(
        "t_tenant",
        TENANCY_GUARD,
        "from app.things import org_hook",
        "org_hook",
    ),
    thing(
        "b_branch",
        UNKNOWN,
        "from app.things import admins_hook_if_strict",
        "admins_hook_if_strict",
    ),
];

/// Where a hook is registered. Both routes have Flask-Login's `login_required`.
const FLASK_HOOK_POSITIONS: &[Position] = &[
    Position {
        id: "bp_call",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nopen_bp = Blueprint(\"{C}_open\", __name__)\nbp.before_request({E})\n\n\n@bp.get(\"/{C}/covered\")\n@login_required\ndef covered():\n    return {\"ok\": True}\n\n\n@open_bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from app import {M}\n\napp.register_blueprint({M}.bp)\napp.register_blueprint({M}.open_bp)\n",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "bp_decorator",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nopen_bp = Blueprint(\"{C}_open\", __name__)\nbp.before_request({E})\n\n\n@bp.before_request\ndef before():\n    return None\n\n\n@bp.get(\"/{C}/covered\")\n@login_required\ndef covered():\n    return {\"ok\": True}\n\n\n@open_bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from app import {M}\n\napp.register_blueprint({M}.bp)\napp.register_blueprint({M}.open_bp)\n",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "app_call",
        cell: "from flask import Flask\nfrom flask_login import login_required\n{PRE}\n\napp = Flask(__name__)\nother = Flask(\"other\")\napp.before_request({E})\n\n\n@app.get(\"/{C}/covered\")\n@login_required\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: "",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "app_wide",
        cell: "from flask import Blueprint, Flask\nfrom flask_login import login_required\n{PRE}\n\napp = Flask(__name__)\nother = Flask(\"other\")\nauth_bp = Blueprint(\"{C}_auth\", __name__)\nbp = Blueprint(\"{C}\", __name__)\nauth_bp.before_app_request({E})\n\n\n@bp.get(\"/{C}/covered\")\n@login_required\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n\n\napp.register_blueprint(auth_bp)\napp.register_blueprint(bp)\n",
        main: "",
        only: &[],
        not: &[],
        unknown: &[],
    },
];

#[test]
fn a_flask_hook_is_read_for_authorization_at_every_position() {
    settle(run(
        "flask_hook",
        FLASK_HOOK_POSITIONS,
        FLASK_HOOKS,
        &flask_base(),
        "app",
        &flask_main,
    ));
}

// ---------------------------------------------------------------------------------
// (A) Django: decorators, tests, bases
// ---------------------------------------------------------------------------------

const DJANGO_THINGS_PY: &str = r#"import os
from functools import wraps

from company_auth import verify as vendor_verify
from django.core.exceptions import PermissionDenied
from django.http import Http404

from app.models import Order


def timed(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        request.started = True
        return view(request, *args, **kwargs)

    return wrapper


def vendor_checked(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        vendor_verify(request)
        return view(request, *args, **kwargs)

    return wrapper


def admins_only(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.user.role != "admin":
            raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapper


def same_org(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.user.org_id != request.GET.get("org_id"):
            raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapper


def owner_only(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        order = Order.objects.get(pk=request.GET["order"])
        if order.owner_id != request.user.id:
            raise Http404
        return view(request, *args, **kwargs)

    return wrapper


STRICT = os.environ.get("STRICT") == "1"


def admins_if_strict(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if STRICT:
            if request.user.role != "admin":
                raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapper


GUARDS = {"admin": admins_only}


def is_editor(user):
    return user.is_staff and user.has_perm("app.change_order")


def is_current(user):
    if not user.is_authenticated:
        return False
    return user.is_active


def on_paid_plan(user):
    return user.profile.plan == "pro"
"#;

const DJANGO_MODELS_PY: &str = r#"from django.db import models


class Order(models.Model):
    org_id = models.IntegerField()
    owner = models.ForeignKey("auth.User", on_delete=models.CASCADE)
"#;

/// What a decorator of a Django view can be, inside the `login_required` every
/// cell has.
const DJANGO_DECORATORS: &[Thing] = &[
    thing(
        "u_name",
        UNKNOWN,
        "from company_auth.django import tenant_required",
        "tenant_required",
    ),
    thing(
        "u_guardian",
        UNKNOWN,
        "from guardian.decorators import permission_required_or_403",
        "permission_required_or_403(\"app.view_order\")",
    ),
    thing(
        "u_guardian_object",
        UNKNOWN,
        "from guardian.decorators import permission_required as object_permission_required\n\nfrom app.models import Order",
        "object_permission_required(\"app.view_order\", (Order, \"pk\", \"pk\"))",
    ),
    thing(
        "u_rules",
        UNKNOWN,
        "from rules.contrib.views import permission_required as rules_permission_required",
        "rules_permission_required(\"app.view_order\")",
    ),
    thing("n_decorator", NONE, "from app.things import timed", "timed"),
    thing(
        "n_library",
        NONE,
        "from django.views.decorators.cache import never_cache",
        "never_cache",
    ),
    thing(
        "x_calls_unlisted",
        UNKNOWN,
        "from app.things import vendor_checked",
        "vendor_checked",
    ),
    thing(
        "x_lookup",
        UNKNOWN,
        "from app.things import GUARDS",
        "GUARDS[\"admin\"]",
    ),
    thing(
        "r_decorator",
        ROLE_GUARD,
        "from app.things import admins_only",
        "admins_only",
    ),
    thing(
        "t_tenant",
        TENANCY_GUARD,
        "from app.things import same_org",
        "same_org",
    ),
    thing(
        "o_owner",
        OWNER_CHECK,
        "from app.things import owner_only",
        "owner_only",
    ),
    thing(
        "b_branch",
        UNKNOWN,
        "from app.things import admins_if_strict",
        "admins_if_strict",
    ),
    thing(
        "s_login",
        NONE,
        "from django.contrib.auth.decorators import login_required as signed_in",
        "signed_in",
    ),
    thing(
        "a_permission",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import permission_required",
        "permission_required(\"app.view_order\")",
    ),
    thing(
        "a_permission_raise",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import permission_required",
        "permission_required(\"app.view_order\", raise_exception=True)",
    ),
    thing(
        "a_staff",
        ROLE_GUARD,
        "from django.contrib.admin.views.decorators import staff_member_required",
        "staff_member_required",
    ),
    // `user_passes_test`: a role guard by what the test asks, never by its name.
    thing(
        "a_test_superuser",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.is_superuser)",
    ),
    thing(
        "a_test_permission",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.has_perm(\"app.view_order\"))",
    ),
    thing(
        "a_test_group",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.is_authenticated and u.groups.filter(name=\"editors\").exists())",
    ),
    thing(
        "a_test_named",
        ROLE_GUARD,
        "from django.contrib.auth.decorators import user_passes_test\n\n\ndef is_editor(user):\n    return user.is_staff and user.has_perm(\"app.change_order\")",
        "user_passes_test(is_editor)",
    ),
    thing(
        "s_test_named",
        NONE,
        "from django.contrib.auth.decorators import user_passes_test\n\n\ndef is_current(user):\n    if not user.is_authenticated:\n        return False\n    return user.is_active",
        "user_passes_test(is_current)",
    ),
    // A test of another module is not read.
    thing(
        "x_test_of_another_module",
        UNKNOWN,
        "from django.contrib.auth.decorators import user_passes_test\n\nfrom app.things import is_editor",
        "user_passes_test(is_editor)",
    ),
    thing(
        "s_test_active",
        NONE,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.is_active)",
    ),
    thing(
        "s_test_signed_in_active",
        NONE,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.is_authenticated and u.is_active)",
    ),
    thing(
        "s_test_staff_or_active",
        NONE,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.is_staff or u.is_active)",
    ),
    thing(
        "x_test_other",
        UNKNOWN,
        "from django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(lambda u: u.profile.plan == \"pro\")",
    ),
    thing(
        "x_test_imported",
        UNKNOWN,
        "from company_auth import can_see\nfrom django.contrib.auth.decorators import user_passes_test",
        "user_passes_test(can_see)",
    ),
];

const DJANGO_INCLUDE: &str = "    path(\"\", include(\"app.{M}\")),\n";

/// Where a decorator of a Django view is written: inside `login_required`.
const DJANGO_DECORATOR_POSITIONS: &[Position] = &[
    Position {
        id: "under",
        cell: "from django.contrib.auth.decorators import login_required\nfrom django.http import JsonResponse\nfrom django.urls import path\n{PRE}\n\n\n@login_required\n@{E}\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n\n\n@login_required\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", covered),\n    path(\"{C}/sibling\", sibling),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "urlconf",
        cell: "from django.contrib.auth.decorators import login_required\nfrom django.http import JsonResponse\nfrom django.urls import path\n{PRE}\n\n\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n\n\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", login_required({E}(covered))),\n    path(\"{C}/sibling\", login_required(sibling)),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        // (A test given where the view is registered is not on the view's symbol.)
        not: &["a_test", "s_test", "x_test"],
        unknown: &[],
    },
    Position {
        id: "method_decorator",
        cell: "from django.contrib.auth.decorators import login_required\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator(login_required, name=\"dispatch\")\n@method_decorator({E}, name=\"dispatch\")\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n@method_decorator(login_required, name=\"dispatch\")\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        not: &[],
        unknown: &[],
    },
    // A test for each method, by name: the route of one method reads its own test,
    // never the other method's. The sibling's `get` has a test of the account's
    // state only, and the thing is on its `post`.
    Position {
        id: "method_named_pair",
        cell: "from django.contrib.auth.decorators import login_required, user_passes_test\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator(login_required, name=\"dispatch\")\n@method_decorator({E}, name=\"get\")\n@method_decorator(user_passes_test(lambda u: u.is_active), name=\"post\")\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n@method_decorator(login_required, name=\"dispatch\")\n@method_decorator({E}, name=\"post\")\n@method_decorator(user_passes_test(lambda u: u.is_active), name=\"get\")\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        not: &[],
        unknown: &[],
    },
];

const DJANGO_SETTINGS: &str = "SECRET_KEY = \"not-a-secret\"\nROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\n    \"django.contrib.auth\",\n    \"django.contrib.contenttypes\",\n    \"django.contrib.sessions\",\n    \"rest_framework\",\n    \"guardian\",\n    \"rules\",\n    \"app\",\n]\nMIDDLEWARE = [\n    \"django.middleware.security.SecurityMiddleware\",\n    \"django.contrib.sessions.middleware.SessionMiddleware\",\n    \"django.middleware.common.CommonMiddleware\",\n    \"django.middleware.csrf.CsrfViewMiddleware\",\n    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n]\n";

const DJANGO_MANAGE: &str = "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n";

fn django_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "django==5.0.0\ndjangorestframework==3.15.0\ndjango-guardian==2.4.0\nrules==3.4\ncompany-auth==1.0.0\n",
        ),
        ("manage.py", DJANGO_MANAGE),
        ("proj/__init__.py", ""),
        ("proj/settings.py", DJANGO_SETTINGS),
        ("app/__init__.py", ""),
        ("app/models.py", DJANGO_MODELS_PY),
        ("app/things.py", DJANGO_THINGS_PY),
    ])
}

fn django_urls(lines: &str) -> (String, String) {
    (
        "proj/urls.py".to_string(),
        format!("from django.urls import include, path\n\nurlpatterns = [\n{lines}]\n"),
    )
}

#[test]
fn a_django_decorator_is_read_for_authorization_at_every_position() {
    settle(run(
        "django",
        DJANGO_DECORATOR_POSITIONS,
        DJANGO_DECORATORS,
        &django_base(),
        "app",
        &django_urls,
    ));
}

const DJANGO_MIXINS_PY: &str = r#"from company_auth import can_see
from django.contrib.auth.mixins import UserPassesTestMixin
from django.core.exceptions import PermissionDenied


class TitleMixin:
    title = "Orders"

    def page_title(self):
        return self.title


class StaffOnly(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_staff


class EditorsOnly(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.has_perm("app.change_order")


class ActiveOnly(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_active


class SignedInAndActive(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_authenticated and self.request.user.is_active


class VendorTested(UserPassesTestMixin):
    def test_func(self):
        return can_see(self.request)


class SignedInTest(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_authenticated


class Audited(SignedInTest):
    audit = True


class StaffTest(SignedInTest):
    def test_func(self):
        return self.request.user.is_staff


# The order Python looks `test_func` up in: `Audited`, `StaffTest`, `SignedInTest`.
class DiamondTest(Audited, StaffTest):
    pass


class SwappedTest(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_authenticated

    def staff_only(self):
        return self.request.user.is_staff

    def get_test_func(self):
        return self.staff_only


class NeverRuns:
    def authorize(self, request):
        if not request.user.is_staff:
            raise PermissionDenied


class StaffDispatch:
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_staff:
            raise PermissionDenied
        return super().dispatch(request, *args, **kwargs)
"#;

/// What a base of a Django view class can be, after `LoginRequiredMixin`.
const DJANGO_BASES: &[Thing] = &[
    thing(
        "u_guardian",
        UNKNOWN,
        "from guardian.mixins import PermissionRequiredMixin as ObjectPermissionMixin",
        "ObjectPermissionMixin",
    ),
    thing(
        "u_guardian_list",
        UNKNOWN,
        "from guardian.mixins import PermissionListMixin",
        "PermissionListMixin",
    ),
    thing(
        "u_rules",
        UNKNOWN,
        "from rules.contrib.views import PermissionRequiredMixin as RulesPermissionMixin",
        "RulesPermissionMixin",
    ),
    thing(
        "u_company",
        UNKNOWN,
        "from company_auth.mixins import TenantMixin",
        "TenantMixin",
    ),
    thing(
        "n_mixin",
        NONE,
        "from app.mixins import TitleMixin",
        "TitleMixin",
    ),
    thing(
        "s_access",
        NONE,
        "from django.contrib.auth.mixins import AccessMixin",
        "AccessMixin",
    ),
    thing(
        "a_permission",
        ROLE_GUARD,
        "from django.contrib.auth.mixins import PermissionRequiredMixin",
        "PermissionRequiredMixin",
    ),
    thing(
        "a_test_staff",
        ROLE_GUARD,
        "from app.mixins import StaffOnly",
        "StaffOnly",
    ),
    thing(
        "a_test_permission",
        ROLE_GUARD,
        "from app.mixins import EditorsOnly",
        "EditorsOnly",
    ),
    thing(
        "s_test_active",
        NONE,
        "from app.mixins import ActiveOnly",
        "ActiveOnly",
    ),
    thing(
        "s_test_signed_in_active",
        NONE,
        "from app.mixins import SignedInAndActive",
        "SignedInAndActive",
    ),
    thing(
        "x_test_unread",
        UNKNOWN,
        "from app.mixins import VendorTested",
        "VendorTested",
    ),
    // By the order Python looks `test_func` up in, not the order the bases are
    // written down a chain: a diamond runs `StaffTest`'s.
    thing(
        "a_test_diamond",
        ROLE_GUARD,
        "from app.mixins import DiamondTest",
        "DiamondTest",
    ),
    // `get_test_func` hands back another method: what runs is not `test_func`.
    thing(
        "x_test_swapped",
        UNKNOWN,
        "from app.mixins import SwappedTest",
        "SwappedTest",
    ),
    // A method with a role check that nothing runs refuses no one: never a role
    // guard.
    thing(
        "n_never_runs",
        NONE,
        "from app.mixins import NeverRuns",
        "NeverRuns",
    ),
    // A `dispatch` that refuses on a role runs for every request.
    thing(
        "a_dispatch_staff",
        ROLE_CHECK,
        "from app.mixins import StaffDispatch",
        "StaffDispatch",
    ),
];

const DJANGO_BASE_POSITIONS: &[Position] = &[
    Position {
        id: "base",
        cell: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\n{PRE}\n\n\nclass Covered(LoginRequiredMixin, {E}, View):\n    permission_required = \"app.view_order\"\n\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        // (Among the view's own bases the mixin is also named as the guard:
        // `known role_check+role_guard`, read in the position below.)
        not: &["a_dispatch"],
        // (Among the view's own bases a mixin whose body refuses on a role is a
        // role guard by that body alone, found and not proven: unknown.)
        unknown: &["n_never_runs"],
    },
    // After the view class, whose `dispatch` hands on to no base after it: the
    // mixin's `dispatch` never runs. (One of the repository whose `dispatch` may run
    // is found, not proven: unknown.)
    Position {
        id: "after_view",
        cell: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\n{PRE}\n\n\nclass Covered(LoginRequiredMixin, View, {E}):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        only: &["a_dispatch", "n_"],
        not: &[],
        unknown: &["a_dispatch_staff"],
    },
    // Through a base class of the repository.
    Position {
        id: "inherited",
        cell: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\n{PRE}\n\n\nclass Guarded(LoginRequiredMixin, {E}, View):\n    permission_required = \"app.view_order\"\n\n\nclass Covered(Guarded):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        only: &[],
        not: &[],
        // (Authentication does not read a test that is not `is_authenticated`,
        // `is_staff` or `is_superuser` through a base of the repository.)
        unknown: &["a_test_permission", "s_test_active"],
    },
];

#[test]
fn a_base_of_a_django_view_is_read_for_authorization() {
    let mut base = django_base();
    base.insert("app/mixins.py".to_string(), DJANGO_MIXINS_PY.to_string());
    settle(run(
        "django_base",
        DJANGO_BASE_POSITIONS,
        DJANGO_BASES,
        &base,
        "app",
        &django_urls,
    ));
}

// ---------------------------------------------------------------------------------
// (A) Django REST framework: permission classes
// ---------------------------------------------------------------------------------

const DRF_PERMISSIONS_PY: &str = r#"from rest_framework.permissions import BasePermission


class Anyone(BasePermission):
    def has_permission(self, request, view):
        return True


class IsOrgAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == "admin")
"#;

/// What a DRF permission class can be, beside `IsAuthenticated`.
const DRF_PERMISSIONS: &[Thing] = &[
    thing(
        "u_company",
        UNKNOWN,
        "from company_auth.drf import HasTenant",
        "HasTenant",
    ),
    thing(
        "u_oauth_toolkit",
        UNKNOWN,
        "from oauth2_provider.contrib.rest_framework import TokenHasScope",
        "TokenHasScope",
    ),
    thing(
        "u_guardian",
        UNKNOWN,
        "from rest_framework_guardian.permissions import ObjectPermissions",
        "ObjectPermissions",
    ),
    thing(
        "s_authenticated",
        NONE,
        "from rest_framework.permissions import IsAuthenticated as SignedIn",
        "SignedIn",
    ),
    thing(
        "a_admin",
        ROLE_GUARD,
        "from rest_framework.permissions import IsAdminUser",
        "IsAdminUser",
    ),
    thing(
        "a_model_permissions",
        ROLE_GUARD,
        "from rest_framework.permissions import DjangoModelPermissions",
        "DjangoModelPermissions",
    ),
    // A permission class of the repository decides in `has_permission`, whose
    // comparison is not in the facts: found by its name, not proven.
    thing(
        "b_repo_class",
        UNKNOWN,
        "from app.permissions import IsOrgAdmin",
        "IsOrgAdmin",
    ),
];

const DRF_HEAD: &str = "from django.urls import path\nfrom rest_framework import generics\nfrom rest_framework.decorators import api_view, permission_classes\nfrom rest_framework.permissions import IsAuthenticated\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n{PRE}\n\n\nclass Sibling(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n\n\n";

const DRF_URLS: &str = "\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n";

/// Where a DRF permission class is given: the id and the class `Covered`.
const DRF_POSITIONS: &[(&str, &str)] = &[
    (
        "api_view",
        "class Covered(APIView):\n    permission_classes = [IsAuthenticated, {E}]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    ),
    (
        "tuple",
        "class Covered(APIView):\n    permission_classes = (IsAuthenticated, {E})\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    ),
    (
        "inherited",
        "class Base(APIView):\n    permission_classes = [IsAuthenticated, {E}]\n\n\nclass Covered(Base):\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    ),
    (
        "reassigned",
        "class Covered(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n\n\nCovered.permission_classes = [IsAuthenticated, {E}]\n",
    ),
];

#[test]
fn a_drf_permission_class_is_read_for_authorization_at_every_position() {
    let positions: Vec<Position> = DRF_POSITIONS
        .iter()
        .map(|(id, class)| Position {
            id,
            cell: Box::leak(format!("{DRF_HEAD}{class}{DRF_URLS}").into_boxed_str()),
            main: DJANGO_INCLUDE,
            only: &[],
            not: &[],
            unknown: &[],
        })
        .collect();
    let mut base = django_base();
    base.insert(
        "app/permissions.py".to_string(),
        DRF_PERMISSIONS_PY.to_string(),
    );
    settle(run(
        "drf",
        &positions,
        DRF_PERMISSIONS,
        &base,
        "app",
        &django_urls,
    ));
}

// ---------------------------------------------------------------------------------
// (A) FastAPI and Starlette: middleware of the application
// ---------------------------------------------------------------------------------

const ASGI_MIDDLEWARE_PY: &str = r#"from company_auth import verify as vendor_verify
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["x-timed"] = "1"
        return response


class VendorMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        vendor_verify(request)
        return await call_next(request)


class AdminsOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.state.user.role != "admin":
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        return await call_next(request)
"#;

const ASGI_MIDDLEWARE: &[Thing] = &[
    thing(
        "u_company",
        UNKNOWN,
        "from company_auth.middleware import TenantMiddleware",
        "TenantMiddleware",
    ),
    thing(
        "n_cors",
        NONE,
        "from starlette.middleware.cors import CORSMiddleware",
        "CORSMiddleware",
    ),
    thing(
        "n_repo",
        NONE,
        "from svc.middleware import TimingMiddleware",
        "TimingMiddleware",
    ),
    thing(
        "x_calls_unlisted",
        UNKNOWN,
        "from svc.middleware import VendorMiddleware",
        "VendorMiddleware",
    ),
    thing(
        "r_repo",
        ROLE_GUARD,
        "from svc.middleware import AdminsOnlyMiddleware",
        "AdminsOnlyMiddleware",
    ),
];

const ASGI_MIDDLEWARE_POSITIONS: &[Position] = &[
    Position {
        id: "added",
        cell: "from fastapi import Depends, FastAPI\nfrom svc.things import require_user\n{PRE}\n\napp = FastAPI()\nother = FastAPI()\napp.add_middleware({E})\n\n\n@app.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: "",
        only: &[],
        not: &[],
        unknown: &[],
    },
    Position {
        id: "built_with",
        cell: "from fastapi import Depends, FastAPI\nfrom starlette.middleware import Middleware\nfrom svc.things import require_user\n{PRE}\n\napp = FastAPI(middleware=[Middleware({E})])\nother = FastAPI()\n\n\n@app.get(\"/{C}/covered\")\ndef covered(who=Depends(require_user)):\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling(who=Depends(require_user)):\n    return {\"ok\": True}\n",
        main: "",
        only: &[],
        not: &[],
        unknown: &[],
    },
];

#[test]
fn a_middleware_of_an_asgi_application_is_read_for_authorization() {
    let mut base = fastapi_base();
    base.insert(
        "svc/middleware.py".to_string(),
        ASGI_MIDDLEWARE_PY.to_string(),
    );
    settle(run(
        "asgi_middleware",
        ASGI_MIDDLEWARE_POSITIONS,
        ASGI_MIDDLEWARE,
        &base,
        "svc",
        &|_| ("svc/empty.py".to_string(), String::new()),
    ));
}

// ---------------------------------------------------------------------------------
// (B) `known` needs one side read off the caller, the other off the request or the
// resource
// ---------------------------------------------------------------------------------
//
// A comparison that refuses, or a filter, is a check of the caller only where one
// side is a value of the caller by the closed list of sources and the other is a
// value of the row, of the request or of what the body was handed:
//
// - caller x (row | request): the check (known);
// - request x request, row x request, row x setting, row x literal, caller x
//   caller, caller x setting, setting x request: found, and not proven to be the
//   caller's (unknown, never `known`);
// - what a dependency gives is the caller's only where the dependency signs the
//   caller in, and the request's wherever a dependency that returns a header is
//   used.
//
// The sibling route of every cell has the same sign-in and no comparison: `none`.

const SOURCES_THINGS_PY: &str = r#"import os
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from sqlalchemy import Column, String, create_engine, select, text
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()
engine = create_engine("sqlite://")
SessionLocal = sessionmaker(bind=engine)


class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True)
    org_id = Column(String)
    owner_id = Column(String)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Settings(BaseSettings):
    default_org_id: str = "acme"


settings = Settings()
DEFAULT_ORG = "acme"


@dataclass
class User:
    id: str
    role: str
    org_id: str


class Payload(BaseModel):
    org_id: str


def require_user(authorization: str | None = Header(None)) -> User:
    if not authorization:
        raise HTTPException(status_code=401)
    return User(id=authorization, role="member", org_id="o1")


CurrentUser = Annotated[User, Depends(require_user)]


def require_claims(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return {"sub": authorization, "org_id": "o1"}


def org_header(x_org_id: str = Header(...)):
    return x_org_id


def current_org(request: Request):
    return request.state.user.org_id


def requested_org(request: Request):
    return request.query_params.get("org")


def default_org():
    return settings.default_org_id


def default_org_of(org_id=DEFAULT_ORG):
    return org_id


def load_document(document_id: str) -> Document:
    return Document(id=document_id, org_id="o1", owner_id="u1")


def load_documents():
    return [load_document("d1")]


def assert_same_org(org_id, other_org_id):
    if org_id != other_org_id:
        raise HTTPException(status_code=403)


class Access:
    def check(self, org_id, other_org_id):
        if org_id != other_org_id:
            raise HTTPException(status_code=403)


def same_or_value_error(org_id, other_org_id):
    if org_id != other_org_id:
        raise ValueError("another organisation")


def docs_keyword(db, org_id):
    return db.query(Document).filter_by(org_id=org_id).all()


def docs_expression(db, org_id):
    return db.query(Document).filter(Document.org_id == org_id).all()


def docs_select(db, org_id):
    return db.execute(select(Document).where(Document.org_id == org_id)).all()


def docs_in_memory(db, org_id):
    return [d for d in load_documents() if d.org_id == org_id]


def docs_sql(db, org_id):
    return db.execute(text("select * from documents where org_id = :v"), {"v": org_id}).all()


class Documents:
    def keyword(self, db, org_id):
        return db.query(Document).filter_by(org_id=org_id).all()

    def expression(self, db, org_id):
        return db.query(Document).filter(Document.org_id == org_id).all()

    def select(self, db, org_id):
        return db.execute(select(Document).where(Document.org_id == org_id)).all()

    def in_memory(self, db, org_id):
        return [d for d in load_documents() if d.org_id == org_id]

    def sql(self, db, org_id):
        return db.execute(text("select * from documents where org_id = :v"), {"v": org_id}).all()
"#;

const SOURCES_HEAD: &str = "import os\n\nfrom fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Request\nfrom sqlalchemy import select, text\n\nfrom svc.things import (\n    DEFAULT_ORG,\n    Access,\n    CurrentUser,\n    Document,\n    Documents,\n    Payload,\n    User,\n    assert_same_org,\n    current_org,\n    default_org,\n    default_org_of,\n    docs_expression,\n    docs_in_memory,\n    docs_keyword,\n    docs_select,\n    docs_sql,\n    get_db,\n    load_document,\n    load_documents,\n    org_header,\n    require_claims,\n    require_user,\n    requested_org,\n    same_or_value_error,\n    settings,\n)\n\nrouter = APIRouter()\n";

/// Whose a side is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Whose {
    Caller,
    Request,
    Row,
    Fixed,
}

/// One side of a comparison, or the value of a filter: the parameters and the
/// statements the function that reads it needs, and the expression.
struct Side {
    id: &'static str,
    whose: Whose,
    /// What the route's path adds for it (a path parameter).
    route: &'static str,
    params: &'static [&'static str],
    setup: &'static str,
    expr: &'static str,
    /// What a query filtered by it reads ([`TENANCY_FILTER`] for a value of the
    /// caller the lowering takes for the session's).
    filter: &'static str,
}

const USER: &str = "user: User = Depends(require_user)";

const SIDES: &[Side] = &[
    // --- the caller, by each source of the closed list ---------------------------
    Side {
        id: "c_dependency",
        whose: Whose::Caller,
        route: "",
        params: &[],
        setup: "",
        expr: "user.org_id",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_claims",
        whose: Whose::Caller,
        route: "",
        params: &["claims=Depends(require_claims)"],
        setup: "",
        expr: "claims[\"org_id\"]",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_holder",
        whose: Whose::Caller,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "request.state.user.org_id",
        filter: TENANCY_FILTER,
    },
    // What a helper returns, read by the closed list in its body.
    Side {
        id: "c_helper",
        whose: Whose::Caller,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "current_org(request)",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_local",
        whose: Whose::Caller,
        route: "",
        params: &[],
        setup: "    own_org_id = user.org_id\n",
        expr: "own_org_id",
        filter: TENANCY_FILTER,
    },
    // What a dependency gives through an annotation that names it
    // (`CurrentUser = Annotated[User, Depends(require_user)]`).
    Side {
        id: "c_annotated",
        whose: Whose::Caller,
        route: "",
        params: &["signed_in: CurrentUser"],
        setup: "",
        expr: "signed_in.org_id",
        filter: TENANCY_FILTER,
    },
    // --- the request -------------------------------------------------------------
    Side {
        id: "q_parameter",
        whose: Whose::Request,
        route: "",
        params: &["org_id: str"],
        setup: "",
        expr: "org_id",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_header",
        whose: Whose::Request,
        route: "",
        params: &["x_org_id: str = Header(...)"],
        setup: "",
        expr: "x_org_id",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_header_read",
        whose: Whose::Request,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "request.headers[\"x-org-id\"]",
        filter: "known tenancy_requested",
    },
    // A dependency that returns a header: the request's wherever it is used.
    Side {
        id: "q_dependency_header",
        whose: Whose::Request,
        route: "",
        params: &["asked_org_id: str = Depends(org_header)"],
        setup: "",
        expr: "asked_org_id",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_body",
        whose: Whose::Request,
        route: "",
        params: &["body: Payload"],
        setup: "",
        expr: "body.org_id",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_cookie",
        whose: Whose::Request,
        route: "",
        params: &["org_id_cookie: str = Cookie(None)"],
        setup: "",
        expr: "org_id_cookie",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_helper",
        whose: Whose::Request,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "requested_org(request)",
        filter: "known tenancy_requested",
    },
    // --- the resource ------------------------------------------------------------
    Side {
        id: "w_loaded",
        whose: Whose::Row,
        route: "",
        params: &["document_id: str"],
        setup: "    document = load_document(document_id)\n",
        expr: "document.org_id",
        filter: UNKNOWN,
    },
    Side {
        id: "w_session",
        whose: Whose::Row,
        route: "",
        params: &["document_id: str", "db=Depends(get_db)"],
        setup: "    row = db.get(Document, document_id)\n",
        expr: "row.org_id",
        filter: UNKNOWN,
    },
    // --- a setting, the environment, a constant, a literal -------------------------
    Side {
        id: "f_setting",
        whose: Whose::Fixed,
        route: "",
        params: &[],
        setup: "",
        expr: "settings.default_org_id",
        filter: UNKNOWN,
    },
    Side {
        id: "f_environment",
        whose: Whose::Fixed,
        route: "",
        params: &[],
        setup: "",
        expr: "os.environ[\"ORG_ID\"]",
        filter: UNKNOWN,
    },
    Side {
        id: "f_constant",
        whose: Whose::Fixed,
        route: "",
        params: &[],
        setup: "",
        expr: "DEFAULT_ORG",
        filter: UNKNOWN,
    },
    Side {
        id: "f_literal",
        whose: Whose::Fixed,
        route: "",
        params: &[],
        setup: "",
        expr: "\"acme\"",
        filter: "known tenancy_literal",
    },
    // --- more of the closed list ------------------------------------------------
    Side {
        id: "c_request_user",
        whose: Whose::Caller,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "request.user.org_id",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_session",
        whose: Whose::Caller,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "request.session[\"org_id\"]",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_scope",
        whose: Whose::Caller,
        route: "",
        params: &["request: Request"],
        setup: "",
        expr: "request.scope[\"user\"].org_id",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_claims_get",
        whose: Whose::Caller,
        route: "",
        params: &["claims=Depends(require_claims)"],
        setup: "",
        expr: "claims.get(\"org_id\")",
        filter: TENANCY_FILTER,
    },
    Side {
        id: "c_str",
        whose: Whose::Caller,
        route: "",
        params: &[],
        setup: "",
        expr: "str(user.org_id)",
        filter: TENANCY_FILTER,
    },
    // --- more of the request -----------------------------------------------------
    Side {
        id: "q_path",
        whose: Whose::Request,
        route: "/{org_path}",
        params: &["org_path: str"],
        setup: "",
        expr: "org_path",
        filter: "known tenancy_requested",
    },
    Side {
        id: "q_query",
        whose: Whose::Request,
        route: "",
        params: &["org_query: str = Query(...)"],
        setup: "",
        expr: "org_query",
        filter: "known tenancy_requested",
    },
    // What a dependency gives that is a setting, and what a helper called with
    // nothing gives back of its default: neither the caller's nor a resource.
    Side {
        id: "f_dependency",
        whose: Whose::Fixed,
        route: "",
        params: &["fixed_org: str = Depends(default_org)"],
        setup: "",
        expr: "fixed_org",
        filter: UNKNOWN,
    },
    Side {
        id: "f_helper_default",
        whose: Whose::Fixed,
        route: "",
        params: &[],
        setup: "",
        expr: "default_org_of()",
        filter: UNKNOWN,
    },
    // A header, when sent, in place of the caller's organization: either.
    Side {
        id: "u_header_or_caller",
        whose: Whose::Fixed,
        route: "",
        params: &["x_org_or: str | None = Header(None)"],
        setup: "",
        expr: "(x_org_or or user.org_id)",
        filter: UNKNOWN,
    },
    // A body model under a name that says the caller: a name is no source.
    Side {
        id: "q_body_named",
        whose: Whose::Request,
        route: "",
        params: &["session_user: Payload"],
        setup: "",
        expr: "session_user.org_id",
        filter: "known tenancy_requested",
    },
];

fn side(id: &str) -> &'static Side {
    SIDES
        .iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| panic!("no side {id}"))
}

/// The pairs compared: every caller source against the row and the request, and
/// the pairs that are no check of the caller.
fn pairs() -> Vec<(&'static Side, &'static Side)> {
    let mut out = Vec::new();
    for c in SIDES.iter().filter(|s| s.whose == Whose::Caller) {
        for other in [
            "w_loaded",
            "w_session",
            "q_parameter",
            "q_header",
            "q_dependency_header",
            "q_body",
            "q_path",
            "q_query",
            "q_body_named",
        ] {
            out.push((c, side(other)));
        }
    }
    for (a, b) in [
        // request x request
        ("q_header", "q_parameter"),
        ("q_header", "q_path"),
        ("q_dependency_header", "q_path"),
        ("q_query", "q_path"),
        ("q_body_named", "q_parameter"),
        ("q_header_read", "q_parameter"),
        ("q_dependency_header", "q_parameter"),
        ("q_body", "q_parameter"),
        ("q_cookie", "q_parameter"),
        ("q_helper", "q_parameter"),
        // row x request
        ("w_loaded", "q_parameter"),
        ("w_loaded", "q_header"),
        ("w_loaded", "q_dependency_header"),
        ("w_loaded", "q_helper"),
        ("w_session", "q_header_read"),
        ("w_loaded", "q_path"),
        ("w_loaded", "q_body_named"),
        // row x setting, environment, constant, literal
        ("w_loaded", "f_setting"),
        ("w_loaded", "f_environment"),
        ("w_loaded", "f_constant"),
        ("w_loaded", "f_literal"),
        ("w_session", "f_setting"),
        ("w_session", "f_literal"),
        // caller x caller
        ("c_dependency", "c_claims"),
        ("c_dependency", "c_holder"),
        // caller x setting
        ("c_dependency", "f_setting"),
        ("c_dependency", "f_environment"),
        ("c_dependency", "f_constant"),
        ("c_claims", "f_constant"),
        ("c_dependency", "f_dependency"),
        ("c_dependency", "f_helper_default"),
        ("c_holder", "f_dependency"),
        ("c_dependency", "u_header_or_caller"),
        ("w_loaded", "u_header_or_caller"),
        // setting x request
        ("f_setting", "q_parameter"),
        ("f_constant", "q_header"),
        ("f_setting", "q_path"),
    ] {
        out.push((side(a), side(b)));
    }
    out
}

/// The parameters of a function that reads these sides: the sign-in, then each
/// side's own, those without a default first.
fn parameters(sides: &[&Side], user: bool) -> String {
    let mut all: Vec<&str> = Vec::new();
    for p in sides.iter().flat_map(|s| s.params.iter().copied()) {
        if !all.contains(&p) {
            all.push(p);
        }
    }
    if user {
        all.push(USER);
    }
    all.sort_by_key(|p| p.contains('='));
    all.join(", ")
}

/// What the route's path adds for these sides.
fn route(sides: &[&Side]) -> String {
    let mut out = String::new();
    for s in sides {
        if !out.contains(s.route) {
            out.push_str(s.route);
        }
    }
    out
}

fn setup(sides: &[&Side]) -> String {
    let mut out = String::new();
    for s in sides {
        if !out.contains(s.setup) {
            out.push_str(s.setup);
        }
    }
    out
}

const SIBLING: &str = "\n\n@router.get(\"/{C}/sibling\")\ndef sibling(user: User = Depends(require_user)):\n    return {\"ok\": True}\n";

/// Reads one repository of generated cells: each a module with its routes
/// `/<cell>/covered` and `/<cell>/sibling`.
fn run_cells(
    table: &'static str,
    position: &'static str,
    key: &str,
    cells: Vec<(String, &'static str, String)>,
) -> Vec<Cell> {
    let mut files = fastapi_base();
    files.insert(
        "requirements.txt".to_string(),
        "fastapi==0.115.0\nsqlalchemy==2.0.30\npydantic-settings==2.3.0\nuvicorn==0.30.0\n"
            .to_string(),
    );
    files.insert("svc/things.py".to_string(), SOURCES_THINGS_PY.to_string());
    files.remove("svc/users.py");
    run_generated(
        table,
        position,
        key,
        files,
        "svc",
        &|cell| format!("from svc import {cell}\n\napp.include_router({cell}.router)\n"),
        &fastapi_main,
        cells,
    )
}

/// Reads one repository of generated cells, each a module `<package>/<cell>.py`
/// with its routes `/<cell>/covered` and `/<cell>/sibling`: `base` are the files
/// every repository has, `register` the line the application module takes for a
/// cell, `main` the application module.
#[allow(clippy::too_many_arguments)]
fn run_generated(
    table: &'static str,
    position: &'static str,
    key: &str,
    mut files: Files,
    package: &str,
    register: &dyn Fn(&str) -> String,
    main: &dyn Fn(&str) -> (String, String),
    cells: Vec<(String, &'static str, String)>,
) -> Vec<Cell> {
    let mut lines = String::new();
    for (id, _, text) in &cells {
        let cell = format!("{position}_{id}");
        files.insert(format!("{package}/{cell}.py"), text.replace("{C}", &cell));
        lines.push_str(&register(&cell));
    }
    let (path, text) = main(&lines);
    files.insert(path, text);
    // The key filtered and compared by, under another name ([`KEYS`]): every
    // `org_id` of the repository, the model's column, the caller's attribute, the
    // claim, the parameters and locals named for it.
    let table: &'static str = if key == "org_id" {
        table
    } else {
        for text in files.values_mut() {
            *text = text.replace("org_id", key);
        }
        Box::leak(format!("{table}_{key}").into_boxed_str())
    };
    let said = match std::env::var("DRIFT_MATRIX_KEEP").ok() {
        Some(k) => {
            let root = Path::new(&k).join(format!("{table}_{position}"));
            let _ = std::fs::remove_dir_all(&root);
            write_at(&root, &files);
            answers(&root)
        }
        None => {
            let dir = tempfile::tempdir().unwrap();
            write_at(dir.path(), &files);
            answers(dir.path())
        }
    };
    cells
        .into_iter()
        .map(|(id, want, _)| {
            let cell = format!("{position}_{id}");
            let get = |which: &str| {
                said.iter()
                    .find(|(at, _)| {
                        at.split_once(' ').is_some_and(|(_, r)| {
                            r == format!("/{cell}/{which}")
                                || r.starts_with(&format!("/{cell}/{which}/"))
                        })
                    })
                    .map(|(_, state)| state.clone())
                    .unwrap_or_else(|| "not listed".to_string())
            };
            Cell {
                table,
                position,
                thing: Box::leak(id.into_boxed_str()),
                want,
                covered: get("covered"),
                sibling: get("sibling"),
            }
        })
        .collect()
}

/// The key a cell filters or compares by: `org_id`, named for a tenant, and names on
/// no list, in either case ([`run_generated`] writes the repository with it).
const KEYS: &[&str] = &[
    "org_id",
    "estate_id",
    "harbour_id",
    "kennelId",
    "guildId",
    "x",
];

/// Every key with every place (or form) of a table.
fn keyed(places: &[&'static str]) -> Vec<(&'static str, &'static str)> {
    KEYS.iter()
        .flat_map(|k| places.iter().map(move |p| (*k, *p)))
        .collect()
}

/// What a cell whose key is `key` reads at `place`, where `want` is what it reads
/// with `org_id`; `None` for a cell no value of the caller is in (but a row's value
/// against a literal), which is read with `org_id` only.
///
/// A value of the caller compared or filtered by is looked at whatever the key is
/// called: never `none`. What a check is known by is where its sides come from, and
/// a name only names it: a filter by the caller's value, and a comparison of the
/// caller's value with the row's or the request's, are a tenant's where a name says
/// one (the key, or the other side's own name: `org_path`, `X-Org-Id`,
/// `Depends(org_header)`), and otherwise found and not named (unknown). The caller's
/// value against a literal in the view's own body is a role check, as the caller's
/// `role` is; under a key named for a tenant it is no tenant check, and not proven
/// as a role either (unknown).
fn for_key(key: &str, want: &'static str, sides: &[&Side], place: &str) -> Option<&'static str> {
    if key == "org_id" {
        return Some(want);
    }
    let caller = sides
        .iter()
        .any(|s| s.whose == Whose::Caller || s.id == "u_header_or_caller");
    // A row's value against a literal, refused with a 403, is no check of the
    // caller whatever the key is called: never a role's (found, not proven). (A 404
    // or a `ValueError` on it reads `none` where the key names nothing: a refusal
    // on what no name says and no value of the caller is in.)
    if !caller {
        let row = sides.iter().any(|s| s.whose == Whose::Row);
        let literal = sides.iter().any(|s| s.id == "f_literal");
        let forbidden = !matches!(place, "handler_404" | "helper_value_error");
        return (row && literal && forbidden).then_some(UNKNOWN);
    }
    // A name of the other side that says a tenant, beside the key, where the
    // comparison is written with the side itself (a helper or a method compares its
    // own parameters, named for the key).
    let written = matches!(place, "handler" | "handler_404" | "dependency");
    let named = written
        && sides.iter().any(|s| {
            s.whose != Whose::Caller
                && format!("{} {} {}", s.expr, s.route, s.params.join(" "))
                    .replace("org_id", "")
                    .to_ascii_lowercase()
                    .contains("org")
        });
    Some(match want {
        // A query given the caller itself under a keyword (`filter_by(estate_id=
        // get_jwt_identity())`) finds this caller's rows and no one else's,
        // whatever the key is called: the value says so, not the name. What is
        // read off the caller (`current_user.org_id`, a claim) says a group of
        // the caller, which only a key named for one makes a scope.
        _ if sides.len() == 1 && sides[0].id == "c_identity" && place == "keyword" => OWNER_FILTER,
        _ if sides.len() == 1 => UNKNOWN,
        TENANCY_CHECK | TENANCY_GUARD if named => want,
        _ if place == "handler" && sides.iter().any(|s| s.id == "f_literal") => ROLE_CHECK,
        _ => UNKNOWN,
    })
}

/// A comparison of two sides that refuses, where it is written: in the handler
/// (refusing with 403, and with 404), in a dependency of the route, in a method of
/// a service the handler calls with the two values, in a helper it calls with
/// them, and in a helper that raises `ValueError`; with every key of [`KEYS`].
#[test]
fn a_comparison_is_a_check_of_the_caller_only_by_where_its_sides_come_from() {
    let mut cells = Vec::new();
    for (key, place) in keyed(&[
        "handler",
        "handler_404",
        "dependency",
        "method",
        "helper",
        "helper_value_error",
    ]) {
        let mut generated = Vec::new();
        for (a, b) in pairs() {
            // (A dependency of the route that answers 403 on a value it compares
            // with a literal is read as a role guard by its own body, whose sides
            // are not asked for: a row's value against a literal there is not a
            // cell of this table.)
            if place == "dependency" && (a.id, b.id) == ("w_session", "f_literal") {
                continue;
            }
            let proven = (a.whose == Whose::Caller
                && matches!(b.whose, Whose::Row | Whose::Request))
                || (b.whose == Whose::Caller && matches!(a.whose, Whose::Row | Whose::Request));
            // In the function that compares them, the facts name the key on
            // neither side of these (an item of a mapping, what a helper returns,
            // against a member of a model or of what a session's query gave): the
            // refusal is found, and not as a tenant's.
            let unnamed = matches!(place, "handler" | "handler_404" | "dependency")
                && matches!(
                    (a.id, b.id),
                    (
                        "c_claims" | "c_session" | "c_claims_get",
                        "w_session" | "q_body" | "q_body_named"
                    ) | (
                        "c_helper",
                        "w_loaded" | "w_session" | "q_body" | "q_body_named"
                    )
                );
            // A `ValueError` says nothing of what the exit is for: found, not proven,
            // whatever the sides.
            let want = match (proven && !unnamed, place) {
                (false, _) | (_, "helper_value_error") => UNKNOWN,
                (true, "dependency") => TENANCY_GUARD,
                (true, _) => TENANCY_CHECK,
            };
            let both = [a, b];
            let status = if place == "handler_404" { 404 } else { 403 };
            let body = match place {
                "handler" | "handler_404" => format!(
                    "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    if {} != {}:\n        raise HTTPException(status_code={status})\n    return {{\"ok\": True}}\n",
                    route(&both),
                    parameters(&both, true),
                    setup(&both),
                    a.expr,
                    b.expr
                ),
                "dependency" => format!(
                    "\n\ndef same_org({}):\n{}    if {} != {}:\n        raise HTTPException(status_code=403)\n\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered(user: User = Depends(require_user), checked=Depends(same_org)):\n    return {{\"ok\": True}}\n",
                    parameters(&both, true),
                    setup(&both),
                    a.expr,
                    b.expr,
                    route(&both),
                ),
                "method" => format!(
                    "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    Access().check({}, {})\n    return {{\"ok\": True}}\n",
                    route(&both),
                    parameters(&both, true),
                    setup(&both),
                    a.expr,
                    b.expr
                ),
                "helper_value_error" => format!(
                    "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    same_or_value_error({}, {})\n    return {{\"ok\": True}}\n",
                    route(&both),
                    parameters(&both, true),
                    setup(&both),
                    a.expr,
                    b.expr
                ),
                _ => format!(
                    "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    assert_same_org({}, {})\n    return {{\"ok\": True}}\n",
                    route(&both),
                    parameters(&both, true),
                    setup(&both),
                    a.expr,
                    b.expr
                ),
            };
            let Some(want) = for_key(key, want, &[a, b], place) else {
                continue;
            };
            generated.push((
                format!("{}_x_{}", a.id, b.id),
                want,
                format!("{SOURCES_HEAD}{body}{SIBLING}"),
            ));
        }
        cells.extend(run_cells("sides", place, key, generated));
    }
    settle(cells);
}

/// A query filtered by a key, by where the value comes from: a keyword of the ORM,
/// an expression of the ORM, a `select`, and a filter in memory and SQL written as
/// text, which no fact records as a scope (found, never `none` and never `known`);
/// in the handler, in a dependency of the route, in a helper and in a method the
/// handler hands the value to; with every key of [`KEYS`].
#[test]
fn a_filter_is_the_callers_scope_only_by_where_its_value_comes_from() {
    let mut cells = Vec::new();
    for (key, place) in keyed(&["handler", "dependency", "helper", "method"]) {
        for form in ["keyword", "expression", "select", "in_memory", "sql"] {
            let mut generated = Vec::new();
            for value in SIDES {
                let one = [value];
                let with_db = |params: String| {
                    if params.contains("db=Depends(get_db)") {
                        params
                    } else {
                        format!("{params}, db=Depends(get_db)")
                    }
                };
                let query = match form {
                    "keyword" => format!(
                        "    return db.query(Document).filter_by(org_id={}).all()\n",
                        value.expr
                    ),
                    "expression" => format!(
                        "    return db.query(Document).filter(Document.org_id == {}).all()\n",
                        value.expr
                    ),
                    "select" => format!(
                        "    return db.execute(select(Document).where(Document.org_id == {})).all()\n",
                        value.expr
                    ),
                    "in_memory" => format!(
                        "    return [d for d in load_documents() if d.org_id == {}]\n",
                        value.expr
                    ),
                    _ => format!(
                        "    return db.execute(text(\"select * from documents where org_id = :v\"), {{\"v\": {}}}).all()\n",
                        value.expr
                    ),
                };
                let Some(want) = for_key(key, filter_want(place, form, value), &[value], place)
                else {
                    continue;
                };
                let body = match place {
                    "handler" => format!(
                        "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}{query}",
                        route(&one),
                        with_db(parameters(&one, true)),
                        setup(&one),
                    ),
                    "dependency" => format!(
                        "\n\ndef scoped({}):\n{}{query}\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered(user: User = Depends(require_user), docs=Depends(scoped)):\n    return docs\n",
                        with_db(parameters(&one, true)),
                        setup(&one),
                        route(&one),
                    ),
                    "helper" => format!(
                        "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    return docs_{form}(db, {})\n",
                        route(&one),
                        with_db(parameters(&one, true)),
                        setup(&one),
                        value.expr,
                    ),
                    _ => format!(
                        "\n\n@router.get(\"/{{C}}/covered{}\")\ndef covered({}):\n{}    return Documents().{form}(db, {})\n",
                        route(&one),
                        with_db(parameters(&one, true)),
                        setup(&one),
                        value.expr,
                    ),
                };
                generated.push((
                    value.id.to_string(),
                    want,
                    format!("{SOURCES_HEAD}{body}{SIBLING}"),
                ));
            }
            cells.extend(run_cells(
                "filters",
                Box::leak(format!("{place}_{form}").into_boxed_str()),
                key,
                generated,
            ));
        }
    }
    settle(cells);
}

/// What a filter by `value` reads: in memory or in SQL written as text, never a
/// scope (found); a value of the caller, the caller's tenant; what the request
/// sent, the tenant it asked for; a literal, one tenant named; anything else found,
/// not proven.
fn filter_want(place: &str, form: &str, value: &Side) -> &'static str {
    if form == "in_memory" || form == "sql" {
        return UNKNOWN;
    }
    match place {
        "handler" => value.filter,
        // [STRICT] What a dependency hands the handler may be the rows the route
        // answers with, filtered there by the caller's tenant or by a value not
        // read: never proven to be the route's scope, never an absence. A lookup
        // by what the request sent is the dependency's own work (the api key of the
        // organisation in a header: drift-mine's
        // `a_query_a_dependency_runs_is_not_the_routes_scope`), no scope of the
        // route. (An expression of the ORM, and a path parameter, leave a
        // comparison of the dependency's body that no fact records: unknown.)
        "dependency" if value.filter == REQUESTED && form == "keyword" && value.id != "q_path" => {
            NONE
        }
        "dependency" => UNKNOWN,
        // Handed to a body below: what the calls of the reach pass for the
        // parameter it filters by. The caller's is the caller's tenant; what the
        // request sent is the tenant it asked for in a function, and found, not
        // proven, in a method; a literal handed on is no literal there.
        _ if value.filter == TENANCY_FILTER => TENANCY_FILTER,
        "helper" if value.filter == REQUESTED => REQUESTED,
        _ => UNKNOWN,
    }
}

// ---------------------------------------------------------------------------------
// (B) Flask and Django: the same sides, by their own sources
// ---------------------------------------------------------------------------------

/// A side of a Flask or Django view: `route` is what the URL rule adds (a URL
/// variable), `params` the view's parameters after `request` for Django.
const fn side_of(
    id: &'static str,
    whose: Whose,
    route: &'static str,
    params: &'static [&'static str],
    setup: &'static str,
    expr: &'static str,
    filter: &'static str,
) -> Side {
    Side {
        id,
        whose,
        route,
        params,
        setup,
        expr,
        filter,
    }
}

const REQUESTED: &str = "known tenancy_requested";
const LITERAL_FILTER: &str = "known tenancy_literal";

const FLASK_SOURCES_PY: &str = r#"import os

from flask import abort
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Document(db.Model):
    id = db.Column(db.String, primary_key=True)
    org_id = db.Column(db.String)


DEFAULT_ORG = "acme"


def load_document(document_id):
    return Document.query.get(document_id)


def assert_same_org(org_id, other_org_id):
    if org_id != other_org_id:
        abort(403)


class Access:
    def check(self, org_id, other_org_id):
        if org_id != other_org_id:
            abort(403)
"#;

const FLASK_SOURCES_HEAD: &str = "import os\n\nfrom flask import Blueprint, abort, current_app, g, request, session\nfrom flask_jwt_extended import get_jwt, get_jwt_identity\nfrom flask_login import current_user, login_required\n\nfrom app.sources import DEFAULT_ORG, Access, Document, assert_same_org, load_document\n\nbp = Blueprint(\"{C}\", __name__)\n";

const FLASK_SIDES: &[Side] = &[
    side_of(
        "c_current_user",
        Whose::Caller,
        "",
        &[],
        "",
        "current_user.org_id",
        TENANCY_FILTER,
    ),
    side_of(
        "c_g_user",
        Whose::Caller,
        "",
        &[],
        "",
        "g.user.org_id",
        TENANCY_FILTER,
    ),
    side_of(
        "c_jwt",
        Whose::Caller,
        "",
        &[],
        "",
        "get_jwt()[\"org_id\"]",
        TENANCY_FILTER,
    ),
    side_of(
        "c_identity",
        Whose::Caller,
        "",
        &[],
        "",
        "get_jwt_identity()",
        TENANCY_FILTER,
    ),
    side_of(
        "c_session",
        Whose::Caller,
        "",
        &[],
        "",
        "session[\"org_id\"]",
        TENANCY_FILTER,
    ),
    side_of(
        "c_local",
        Whose::Caller,
        "",
        &[],
        "    own_org_id = current_user.org_id\n",
        "own_org_id",
        TENANCY_FILTER,
    ),
    side_of(
        "q_view_arg",
        Whose::Request,
        "/<org_path>",
        &["org_path"],
        "",
        "org_path",
        REQUESTED,
    ),
    side_of(
        "q_args",
        Whose::Request,
        "",
        &[],
        "",
        "request.args[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "q_header",
        Whose::Request,
        "",
        &[],
        "",
        "request.headers[\"X-Org-Id\"]",
        REQUESTED,
    ),
    side_of(
        "q_json",
        Whose::Request,
        "",
        &[],
        "",
        "request.json[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "q_cookie",
        Whose::Request,
        "",
        &[],
        "",
        "request.cookies[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "w_loaded",
        Whose::Row,
        "/<document_id>",
        &["document_id"],
        "    document = load_document(document_id)\n",
        "document.org_id",
        UNKNOWN,
    ),
    side_of(
        "w_query",
        Whose::Row,
        "/<document_id>",
        &["document_id"],
        "    row = Document.query.get(document_id)\n",
        "row.org_id",
        UNKNOWN,
    ),
    side_of(
        "f_config",
        Whose::Fixed,
        "",
        &[],
        "",
        "current_app.config[\"DEFAULT_ORG\"]",
        UNKNOWN,
    ),
    side_of(
        "f_environment",
        Whose::Fixed,
        "",
        &[],
        "",
        "os.environ[\"ORG_ID\"]",
        UNKNOWN,
    ),
    side_of(
        "f_constant",
        Whose::Fixed,
        "",
        &[],
        "",
        "DEFAULT_ORG",
        UNKNOWN,
    ),
    side_of(
        "f_literal",
        Whose::Fixed,
        "",
        &[],
        "",
        "\"acme\"",
        LITERAL_FILTER,
    ),
];

const DJANGO_SOURCES_PY: &str = r#"import os

from django.core.exceptions import PermissionDenied

DEFAULT_ORG = "acme"


def assert_same_org(org_id, other_org_id):
    if org_id != other_org_id:
        raise PermissionDenied


class Access:
    def check(self, org_id, other_org_id):
        if org_id != other_org_id:
            raise PermissionDenied
"#;

const DJANGO_SOURCES_HEAD: &str = "import os\n\nfrom django.conf import settings\nfrom django.contrib.auth.decorators import login_required\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import JsonResponse\nfrom django.urls import path\n\nfrom app.models import Order\nfrom app.sources import DEFAULT_ORG, Access, assert_same_org\n";

const DJANGO_SIDES: &[Side] = &[
    side_of(
        "c_request_user",
        Whose::Caller,
        "",
        &[],
        "",
        "request.user.org_id",
        TENANCY_FILTER,
    ),
    side_of(
        "c_session",
        Whose::Caller,
        "",
        &[],
        "",
        "request.session[\"org_id\"]",
        TENANCY_FILTER,
    ),
    side_of(
        "c_local",
        Whose::Caller,
        "",
        &[],
        "    own_org_id = request.user.org_id\n",
        "own_org_id",
        TENANCY_FILTER,
    ),
    side_of(
        "q_url_kwarg",
        Whose::Request,
        "/<str:org_path>",
        &["org_path"],
        "",
        "org_path",
        REQUESTED,
    ),
    side_of(
        "q_get",
        Whose::Request,
        "",
        &[],
        "",
        "request.GET[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "q_post",
        Whose::Request,
        "",
        &[],
        "",
        "request.POST[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "q_header",
        Whose::Request,
        "",
        &[],
        "",
        "request.headers[\"X-Org-Id\"]",
        REQUESTED,
    ),
    side_of(
        "q_meta",
        Whose::Request,
        "",
        &[],
        "",
        "request.META[\"HTTP_X_ORG_ID\"]",
        REQUESTED,
    ),
    side_of(
        "q_cookie",
        Whose::Request,
        "",
        &[],
        "",
        "request.COOKIES[\"org_id\"]",
        REQUESTED,
    ),
    side_of(
        "w_loaded",
        Whose::Row,
        "/<str:order_id>",
        &["order_id"],
        "    order = Order.objects.get(pk=order_id)\n",
        "order.org_id",
        UNKNOWN,
    ),
    // A row the request chose, held by a local named like the caller: a name is no
    // source.
    side_of(
        "w_named_user",
        Whose::Row,
        "",
        &[],
        "    user = Order.objects.get(pk=request.GET[\"uid\"])\n",
        "user.org_id",
        UNKNOWN,
    ),
    side_of(
        "w_named_current_user",
        Whose::Row,
        "",
        &[],
        "    current_user = Order.objects.get(pk=request.GET[\"uid\"])\n",
        "current_user.org_id",
        UNKNOWN,
    ),
    side_of(
        "f_settings",
        Whose::Fixed,
        "",
        &[],
        "",
        "settings.DEFAULT_ORG",
        UNKNOWN,
    ),
    side_of(
        "f_environment",
        Whose::Fixed,
        "",
        &[],
        "",
        "os.environ[\"ORG_ID\"]",
        UNKNOWN,
    ),
    side_of(
        "f_constant",
        Whose::Fixed,
        "",
        &[],
        "",
        "DEFAULT_ORG",
        UNKNOWN,
    ),
    side_of(
        "f_literal",
        Whose::Fixed,
        "",
        &[],
        "",
        "\"acme\"",
        LITERAL_FILTER,
    ),
];

/// Every caller source against each row and request entry, and the pairs that are
/// no check of the caller: request x request, row x request, row x fixed, caller x
/// caller, caller x fixed, fixed x request.
fn pairs_of(sides: &'static [Side]) -> Vec<(&'static Side, &'static Side)> {
    let of = |w: Whose| sides.iter().filter(move |s| s.whose == w);
    let mut out = Vec::new();
    for c in of(Whose::Caller) {
        for other in of(Whose::Row).chain(of(Whose::Request)) {
            out.push((c, other));
        }
    }
    let first = |w: Whose| of(w).next().unwrap();
    let request = of(Whose::Request).next().unwrap();
    for q in of(Whose::Request).skip(1) {
        out.push((q, request));
    }
    for w in of(Whose::Row) {
        for x in of(Whose::Request).chain(of(Whose::Fixed)) {
            out.push((w, x));
        }
    }
    // Row x row: neither is the caller's.
    let row = first(Whose::Row);
    for w in of(Whose::Row).skip(1) {
        out.push((row, w));
    }
    let caller = first(Whose::Caller);
    for c in of(Whose::Caller).skip(1) {
        out.push((caller, c));
    }
    for f in of(Whose::Fixed) {
        out.push((caller, f));
        out.push((f, request));
    }
    out
}

/// The parameters a Flask or Django view takes for these sides.
fn view_params(sides: &[&Side]) -> Vec<&'static str> {
    let mut all: Vec<&'static str> = Vec::new();
    for p in sides.iter().flat_map(|s| s.params.iter().copied()) {
        if !all.contains(&p) {
            all.push(p);
        }
    }
    all
}

fn expected(a: &Side, b: &Side) -> &'static str {
    let proven = (a.whose == Whose::Caller && matches!(b.whose, Whose::Row | Whose::Request))
        || (b.whose == Whose::Caller && matches!(a.whose, Whose::Row | Whose::Request));
    if proven { TENANCY_CHECK } else { UNKNOWN }
}

/// An item of the session against an item of the request: the facts name the key
/// on neither side, and the refusal is not read as a tenant's (unknown).
fn items(a: &Side, b: &Side) -> bool {
    a.id == "c_session" && matches!(b.id, "q_args" | "q_json" | "q_cookie" | "q_get" | "q_post")
}

/// Flask: `abort(403)` is recorded as a check only where its test names the
/// caller (a word of a subject, a header, a value of a dependency): a test of what
/// `get_jwt()` or a local holds against anything but a header, and one in a body
/// below the view whose parameters say nothing, is a refusal that was not read
/// (unknown, never `none`).
fn flask_expected(place: &str, a: &Side, b: &Side) -> &'static str {
    let unnamed = place != "handler"
        || (matches!(a.id, "c_jwt" | "c_identity" | "c_local") && b.id != "q_header")
        || (matches!(b.id, "c_jwt" | "c_identity" | "c_local") && a.id != "q_header")
        || items(a, b);
    if unnamed { UNKNOWN } else { expected(a, b) }
}

/// The test a cell's body runs on the two sides, where it sits.
fn compared(place: &str, a: &Side, b: &Side, refuse: &str) -> String {
    match place {
        "handler" => format!("    if {} != {}:\n        {refuse}\n", a.expr, b.expr),
        "method" => format!("    Access().check({}, {})\n", a.expr, b.expr),
        _ => format!("    assert_same_org({}, {})\n", a.expr, b.expr),
    }
}

/// A comparison of two sides that refuses, in a Flask view, in a helper and in a
/// method it calls with the two values.
#[test]
fn a_flask_comparison_is_a_check_of_the_caller_only_by_where_its_sides_come_from() {
    let mut cells = Vec::new();
    for (key, place) in keyed(&["handler", "helper", "method"]) {
        let mut generated = Vec::new();
        for (a, b) in pairs_of(FLASK_SIDES) {
            let both = [a, b];
            let body = format!(
                "\n\n@bp.get(\"/{{C}}/covered{}\")\n@login_required\ndef covered({}):\n{}{}    return {{\"ok\": True}}\n",
                route(&both),
                view_params(&both).join(", "),
                setup(&both),
                compared(place, a, b, "abort(403)"),
            );
            let Some(want) = for_key(key, flask_expected(place, a, b), &[a, b], place) else {
                continue;
            };
            generated.push((
                format!("{}_x_{}", a.id, b.id),
                want,
                format!("{FLASK_SOURCES_HEAD}{body}{FLASK_SIBLING}"),
            ));
        }
        cells.extend(run_flask("flask_sides", place, key, generated));
    }
    settle(cells);
}

/// A Flask-SQLAlchemy query filtered by a tenant key, by where the value comes
/// from: a keyword, an expression.
#[test]
fn a_flask_filter_is_the_callers_scope_only_by_where_its_value_comes_from() {
    let mut cells = Vec::new();
    for (key, form) in keyed(&["keyword", "expression"]) {
        let mut generated = Vec::new();
        for value in FLASK_SIDES {
            let one = [value];
            let query = match form {
                "keyword" => format!("Document.query.filter_by(org_id={}).all()", value.expr),
                _ => format!(
                    "Document.query.filter(Document.org_id == {}).all()",
                    value.expr
                ),
            };
            let body = format!(
                "\n\n@bp.get(\"/{{C}}/covered{}\")\n@login_required\ndef covered({}):\n{}    return {{\"n\": len({query})}}\n",
                route(&one),
                view_params(&one).join(", "),
                setup(&one),
            );
            let Some(want) = for_key(key, value.filter, &[value], form) else {
                continue;
            };
            generated.push((
                value.id.to_string(),
                want,
                format!("{FLASK_SOURCES_HEAD}{body}{FLASK_SIBLING}"),
            ));
        }
        cells.extend(run_flask("flask_filters", form, key, generated));
    }
    settle(cells);
}

const FLASK_SIBLING: &str =
    "\n\n@bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n";

fn run_flask(
    table: &'static str,
    position: &'static str,
    key: &str,
    cells: Vec<(String, &'static str, String)>,
) -> Vec<Cell> {
    let mut files = flask_base();
    files.insert(
        "requirements.txt".to_string(),
        "flask==3.0.0\nflask-login==0.6.3\nflask-jwt-extended==4.6.0\nflask-sqlalchemy==3.1.1\n"
            .to_string(),
    );
    files.insert("app/sources.py".to_string(), FLASK_SOURCES_PY.to_string());
    run_generated(
        table,
        position,
        key,
        files,
        "app",
        &|cell| format!("from app import {cell}\n\napp.register_blueprint({cell}.bp)\n"),
        &flask_main,
        cells,
    )
}

/// A comparison of two sides that refuses, in a Django view, in a helper and in a
/// method it calls with the two values.
#[test]
fn a_django_comparison_is_a_check_of_the_caller_only_by_where_its_sides_come_from() {
    let mut cells = Vec::new();
    for (key, place) in keyed(&["handler", "helper", "method"]) {
        let mut generated = Vec::new();
        for (a, b) in pairs_of(DJANGO_SIDES) {
            let both = [a, b];
            let params: String = view_params(&both)
                .iter()
                .map(|p| format!(", {p}"))
                .collect();
            let body = format!(
                "\n\n@login_required\ndef covered(request{params}):\n{}{}    return JsonResponse({{\"ok\": True}})\n{}",
                setup(&both),
                compared(place, a, b, "raise PermissionDenied"),
                django_cell_urls(&route(&both)),
            );
            let want = if place == "handler" && items(a, b) {
                UNKNOWN
            } else {
                expected(a, b)
            };
            let Some(want) = for_key(key, want, &[a, b], place) else {
                continue;
            };
            generated.push((
                format!("{}_x_{}", a.id, b.id),
                want,
                format!("{DJANGO_SOURCES_HEAD}{DJANGO_SIBLING}{body}"),
            ));
        }
        cells.extend(run_django("django_sides", place, key, generated));
    }
    settle(cells);
}

/// A Django query filtered by a tenant key, by where the value comes from.
#[test]
fn a_django_filter_is_the_callers_scope_only_by_where_its_value_comes_from() {
    let mut cells = Vec::new();
    for key in KEYS {
        let mut generated = Vec::new();
        for value in DJANGO_SIDES {
            let one = [value];
            let params: String = view_params(&one).iter().map(|p| format!(", {p}")).collect();
            let body = format!(
                "\n\n@login_required\ndef covered(request{params}):\n{}    return JsonResponse({{\"n\": Order.objects.filter(org_id={}).count()}})\n{}",
                setup(&one),
                value.expr,
                django_cell_urls(&route(&one)),
            );
            let Some(want) = for_key(key, value.filter, &[value], "keyword") else {
                continue;
            };
            generated.push((
                value.id.to_string(),
                want,
                format!("{DJANGO_SOURCES_HEAD}{DJANGO_SIBLING}{body}"),
            ));
        }
        cells.extend(run_django("django_filters", "keyword", key, generated));
    }
    settle(cells);
}

const DJANGO_SIBLING: &str =
    "\n\n@login_required\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n";

fn django_cell_urls(route: &str) -> String {
    format!(
        "\n\nurlpatterns = [\n    path(\"{{C}}/covered{route}\", covered),\n    path(\"{{C}}/sibling\", sibling),\n]\n"
    )
}

fn run_django(
    table: &'static str,
    position: &'static str,
    key: &str,
    cells: Vec<(String, &'static str, String)>,
) -> Vec<Cell> {
    let mut files = django_base();
    files.insert("app/sources.py".to_string(), DJANGO_SOURCES_PY.to_string());
    run_generated(
        table,
        position,
        key,
        files,
        "app",
        &|cell| DJANGO_INCLUDE.replace("{M}", cell),
        &django_urls,
        cells,
    )
}

// ---------------------------------------------------------------------------------
// What a constructor binds: an attribute of `self` a check reads
// ---------------------------------------------------------------------------------

/// How a class binds `actor` and `target` from what it is built with. `{CHECK}` is
/// the method that compares a row with `self.target`. The view builds it with the
/// caller first and a row the request chose second; the cell is the check where the
/// caller's value is what `self.target` holds by the parameters Python passes.
const CONSTRUCTORS: &[(&str, &str, &str)] = &[
    // `__init__(self, actor, target)`: `target` is the row.
    (
        "init_target_row",
        "class Checker:\n    def __init__(self, actor, target):\n        self.actor = actor\n        self.target = target\n{CHECK}",
        UNKNOWN,
    ),
    // `__init__(self, target, actor)`: `target` is the caller.
    (
        "init_target_caller",
        "class Checker:\n    def __init__(self, target, actor):\n        self.actor = actor\n        self.target = target\n{CHECK}",
        TENANCY_CHECK,
    ),
    // Bound from the caller, then bound again to a row.
    (
        "init_rebound_attribute",
        "class Checker:\n    def __init__(self, target, actor):\n        self.actor = actor\n        self.target = target\n        self.target = Order.objects.get(pk=actor.pk)\n{CHECK}",
        UNKNOWN,
    ),
    (
        "init_rebound_under_branch",
        "class Checker:\n    def __init__(self, target, actor):\n        self.actor = actor\n        self.target = target\n        if actor is not None:\n            self.target = Order.objects.get(pk=actor.pk)\n{CHECK}",
        UNKNOWN,
    ),
    (
        "init_rebound_parameter",
        "class Checker:\n    def __init__(self, target, actor):\n        target = Order.objects.get(pk=actor.pk)\n        self.actor = actor\n        self.target = target\n{CHECK}",
        UNKNOWN,
    ),
    (
        "init_rebound_in_method",
        "class Checker:\n    def __init__(self, target, actor):\n        self.actor = actor\n        self.target = target\n\n    def load(self):\n        self.target = Order.objects.first()\n{CHECK}",
        UNKNOWN,
    ),
    // A dataclass: the fields in order.
    (
        "dataclass_target_caller",
        "@dataclass\nclass Checker:\n    target: Any\n    actor: Any\n{CHECK}",
        TENANCY_CHECK,
    ),
    (
        "dataclass_target_row",
        "@dataclass\nclass Checker:\n    actor: Any\n    target: Any\n{CHECK}",
        UNKNOWN,
    ),
    // An inherited dataclass: the base's fields come first, so `target` is the row.
    (
        "dataclass_inherited",
        "@dataclass\nclass Base:\n    actor: Any\n\n\n@dataclass\nclass Checker(Base):\n    target: Any\n{CHECK}",
        UNKNOWN,
    ),
    // `ClassVar` is no field; `KW_ONLY` and `field(init=False)` change the
    // parameters: the constructor is not read.
    (
        "dataclass_classvar",
        "@dataclass\nclass Checker:\n    kind: ClassVar[str] = \"x\"\n    actor: Any = None\n    target: Any = None\n{CHECK}",
        UNKNOWN,
    ),
    (
        "dataclass_no_init_field",
        "@dataclass\nclass Checker:\n    seen: Any = field(init=False, default=None)\n    actor: Any = None\n    target: Any = None\n{CHECK}",
        UNKNOWN,
    ),
    (
        "dataclass_kw_only",
        "@dataclass(kw_only=True)\nclass Checker:\n    target: Any = None\n    actor: Any = None\n{CHECK}",
        UNKNOWN,
    ),
    (
        "dataclass_post_init",
        "@dataclass\nclass Checker:\n    target: Any\n    actor: Any\n\n    def __post_init__(self):\n        self.target = Order.objects.first()\n{CHECK}",
        UNKNOWN,
    ),
];

const CONSTRUCTOR_CHECK: &str = "\n    def check(self, order):\n        if order.org_id != self.target.org_id:\n            raise PermissionDenied\n";

#[test]
fn an_attribute_a_constructor_binds_is_the_callers_by_the_parameters_python_passes() {
    let mut generated = Vec::new();
    for (id, class, want) in CONSTRUCTORS {
        let class = class.replace("{CHECK}", CONSTRUCTOR_CHECK);
        let body = format!(
            "from dataclasses import dataclass, field\nfrom typing import Any, ClassVar\n\n{DJANGO_SOURCES_HEAD}\n\n{class}{DJANGO_SIBLING}\n\n@login_required\ndef covered(request, order_id):\n    order = Order.objects.get(pk=order_id)\n    checker = Checker(request.user, Order.objects.get(pk=request.GET[\"uid\"]))\n    checker.check(order)\n    return JsonResponse({{\"ok\": True}})\n{}",
            django_cell_urls("/<str:order_id>"),
        );
        generated.push((id.to_string(), *want, body));
    }
    settle(run_django("constructors", "built", "org_id", generated));
}

// ---------------------------------------------------------------------------------
// The method that really runs, in class-based views
// ---------------------------------------------------------------------------------
//
// A check in a method a view calls on `self`, or in a method the framework calls
// (`get_queryset`, `get_object`), is read for the class the route is bound to, by
// its method resolution order: the base view's route runs the base's method; a
// subclass that overrides nothing runs it too; a subclass that overrides it runs
// the override (here one that checks nothing); a sibling's override changes nothing
// for the base's route. Each cell also has a sibling route, a view of the same
// framework with the same sign-in and no check: `none`.

/// A framework's base view with a check, a method that overrides the check with
/// none, and how a class is routed. `{B}` is a class name, `{C}` the cell.
struct ClassView {
    id: &'static str,
    head: &'static str,
    /// The base view, `{B}`, with the check.
    base: &'static str,
    /// The body of a subclass of `{B}` that overrides the check with none.
    over: &'static str,
    /// The body of a subclass of `{B}` that overrides nothing.
    keep: &'static str,
    /// What the base's route reads.
    want: &'static str,
    /// The routes: covered (`{X}`, the bound class) and the sibling.
    urls: &'static str,
    /// The sibling view.
    sibling: &'static str,
}

const CLASS_VIEWS: &[ClassView] = &[
    ClassView {
        id: "flask_method_view",
        head: "from flask import Blueprint\nfrom flask.views import MethodView\nfrom flask_jwt_extended import get_jwt, jwt_required\nfrom werkzeug.exceptions import Forbidden\n\nfrom app.sources import Document\n\nbp = Blueprint(\"{C}\", __name__)\n",
        base: "class {B}(MethodView):\n    decorators = [jwt_required()]\n\n    def authorize(self, document_id):\n        document = Document.query.get(document_id)\n        if document.org_id != get_jwt()[\"org_id\"]:\n            raise Forbidden()\n\n    def get(self, document_id):\n        self.authorize(document_id)\n        return {\"ok\": True}\n",
        over: "    def authorize(self, document_id):\n        return None\n",
        keep: "    init_every_request = False\n",
        want: TENANCY_CHECK,
        urls: "bp.add_url_rule(\"/{C}/covered/<document_id>\", view_func={X}.as_view(\"covered\"))\nbp.add_url_rule(\"/{C}/sibling\", view_func=Plain.as_view(\"sibling\"))\n",
        sibling: "class Plain(MethodView):\n    decorators = [jwt_required()]\n\n    def get(self):\n        return {\"ok\": True}\n",
    },
    ClassView {
        id: "django_view",
        head: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import JsonResponse\nfrom django.shortcuts import get_object_or_404\nfrom django.urls import path\nfrom django.views import View\n\nfrom app.models import Order\n",
        base: "class {B}(LoginRequiredMixin, View):\n    def has_access(self):\n        order = get_object_or_404(Order, pk=self.kwargs[\"pk\"])\n        if order.org_id != self.request.user.org_id:\n            raise PermissionDenied\n\n    def get(self, request, pk):\n        self.has_access()\n        return JsonResponse({\"ok\": True})\n",
        over: "    def has_access(self):\n        return None\n",
        keep: "    http_method_names = [\"get\"]\n",
        want: TENANCY_CHECK,
        urls: "urlpatterns = [\n    path(\"{C}/covered/<int:pk>\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n",
    },
    ClassView {
        id: "django_detail",
        head: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\nfrom django.views.generic import DetailView\n\nfrom app.models import Order\n",
        base: "class {B}(LoginRequiredMixin, DetailView):\n    model = Order\n\n    def get_queryset(self):\n        return Order.objects.filter(org_id=self.request.user.org_id)\n",
        over: "    def get_queryset(self):\n        return Order.objects.all()\n",
        keep: "    template_name = \"order.html\"\n",
        want: TENANCY_FILTER,
        urls: "urlpatterns = [\n    path(\"{C}/covered/<int:pk>\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n",
    },
    ClassView {
        id: "drf_get_object",
        head: "from django.shortcuts import get_object_or_404\nfrom django.urls import path\nfrom rest_framework.exceptions import PermissionDenied\nfrom rest_framework.permissions import IsAuthenticated\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n\nfrom app.models import Order\n",
        base: "class {B}(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get_object(self, pk):\n        order = get_object_or_404(Order, pk=pk)\n        if order.org_id != self.request.user.org_id:\n            raise PermissionDenied()\n        return order\n\n    def get(self, request, pk):\n        order = self.get_object(pk)\n        return Response({\"id\": order.id})\n",
        over: "    def get_object(self, pk):\n        return get_object_or_404(Order, pk=pk)\n",
        keep: "    throttle_classes = []\n",
        want: TENANCY_CHECK,
        urls: "urlpatterns = [\n    path(\"{C}/covered/<int:pk>\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    },
    ClassView {
        id: "drf_list",
        head: "from django.urls import path\nfrom rest_framework import generics\nfrom rest_framework.permissions import IsAuthenticated\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n\nfrom app.models import Order\n",
        base: "class {B}(generics.ListAPIView):\n    permission_classes = [IsAuthenticated]\n\n    def get_queryset(self):\n        return Order.objects.filter(org_id=self.request.user.org_id)\n",
        over: "    def get_queryset(self):\n        return Order.objects.all()\n",
        keep: "    pagination_class = None\n",
        want: TENANCY_FILTER,
        urls: "urlpatterns = [\n    path(\"{C}/covered\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    },
    // The framework runs the method itself, for every request, before the handler:
    // read for a route bound to a method of the class too.
    ClassView {
        id: "django_dispatch",
        head: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import JsonResponse\nfrom django.shortcuts import get_object_or_404\nfrom django.urls import path\nfrom django.views import View\n\nfrom app.models import Order\n",
        base: "class {B}(LoginRequiredMixin, View):\n    def dispatch(self, request, *args, **kwargs):\n        order = get_object_or_404(Order, pk=kwargs[\"pk\"])\n        if order.org_id != request.user.org_id:\n            raise PermissionDenied\n        return super().dispatch(request, *args, **kwargs)\n\n    def get(self, request, pk):\n        return JsonResponse({\"ok\": True})\n",
        over: "    def dispatch(self, request, *args, **kwargs):\n        return View.dispatch(self, request, *args, **kwargs)\n",
        keep: "    http_method_names = [\"get\"]\n",
        want: TENANCY_CHECK,
        urls: "urlpatterns = [\n    path(\"{C}/covered/<int:pk>\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n",
    },
    ClassView {
        id: "django_setup",
        head: "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import JsonResponse\nfrom django.shortcuts import get_object_or_404\nfrom django.urls import path\nfrom django.views import View\n\nfrom app.models import Order\n",
        base: "class {B}(LoginRequiredMixin, View):\n    def setup(self, request, *args, **kwargs):\n        super().setup(request, *args, **kwargs)\n        order = get_object_or_404(Order, pk=kwargs[\"pk\"])\n        if order.org_id != request.user.org_id:\n            raise PermissionDenied\n\n    def get(self, request, pk):\n        return JsonResponse({\"ok\": True})\n",
        over: "    def setup(self, request, *args, **kwargs):\n        View.setup(self, request, *args, **kwargs)\n",
        keep: "    http_method_names = [\"get\"]\n",
        want: TENANCY_CHECK,
        urls: "urlpatterns = [\n    path(\"{C}/covered/<int:pk>\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(LoginRequiredMixin, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n",
    },
    ClassView {
        id: "drf_initial",
        head: "from django.urls import path\nfrom rest_framework.exceptions import PermissionDenied\nfrom rest_framework.permissions import IsAuthenticated\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n",
        base: "class {B}(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def initial(self, request, *args, **kwargs):\n        super().initial(request, *args, **kwargs)\n        if not request.user.is_staff:\n            raise PermissionDenied()\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        over: "    def initial(self, request, *args, **kwargs):\n        APIView.initial(self, request, *args, **kwargs)\n",
        keep: "    throttle_classes = []\n",
        want: ROLE_CHECK,
        urls: "urlpatterns = [\n    path(\"{C}/covered\", {X}.as_view()),\n    path(\"{C}/sibling\", Plain.as_view()),\n]\n",
        sibling: "class Plain(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
    },
];

/// Where the check sits, for the class the route is bound to: the base, which
/// calls it on `self` or has the framework call it; a subclass that inherits it; a
/// subclass that overrides it with none; the base again, beside a sibling subclass
/// that overrides it. Then by the order Python looks a method up in (C3), whatever
/// the classes are called: a subclass of the override (`Leaf(Over)`, `Over(Base)`:
/// the override); a diamond (`Leaf(Left, Right)`, both on `Base`, `Right`
/// overriding: the override, which comes before `Base`); a class after the base
/// among the bound class's bases (`Leaf(Base, Aside)`, `Aside` overriding: the
/// base's); bases with no consistent order (`Leaf(Base, Sub)`, `Sub(Base)`:
/// Python refuses the class, and nothing is known).
const CLASS_PLACES: &[&str] = &[
    "on_self",
    "inherited",
    "overridden",
    "sibling_override",
    "override_inherited",
    "diamond",
    "mixin_after",
    "no_order",
];

#[test]
fn the_method_that_runs_is_the_bound_classs() {
    let mut cells = Vec::new();
    for v in CLASS_VIEWS {
        let mut generated = Vec::new();
        for place in CLASS_PLACES {
            let base = v.base.replace("{B}", "Base");
            // What a route bound to a class that runs the override reads.
            let overridden = if v.id == "drf_get_object" {
                UNKNOWN
            } else {
                NONE
            };
            let (classes, bound, want) = match *place {
                "on_self" => (base, "Base", v.want),
                "inherited" => (
                    format!("{base}\n\nclass Sub(Base):\n{}", v.keep),
                    "Sub",
                    v.want,
                ),
                // (DRF: the override's own `get_object_or_404(Order, pk=pk)` is a lookup
                // by a key whose value the facts do not trace: unknown, as before.)
                "overridden" => (
                    format!("{base}\n\nclass Over(Base):\n{}", v.over),
                    "Over",
                    if v.id == "drf_get_object" {
                        UNKNOWN
                    } else {
                        NONE
                    },
                ),
                "sibling_override" => (
                    format!(
                        "{base}\n\nclass Over(Base):\n{}\n\nclass Kept(Base):\n{}",
                        v.over, v.keep
                    ),
                    "Base",
                    v.want,
                ),
                "override_inherited" => (
                    format!(
                        "{base}\n\nclass Over(Base):\n{}\n\nclass Leaf(Over):\n{}",
                        v.over, v.keep
                    ),
                    "Leaf",
                    overridden,
                ),
                "diamond" => (
                    format!(
                        "{base}\n\nclass Left(Base):\n{}\n\nclass Right(Base):\n{}\n\nclass Leaf(Left, Right):\n{}",
                        v.keep, v.over, v.keep
                    ),
                    "Leaf",
                    overridden,
                ),
                "mixin_after" => (
                    format!(
                        "{base}\n\nclass Aside:\n{}\n\nclass Leaf(Base, Aside):\n{}",
                        v.over, v.keep
                    ),
                    "Leaf",
                    v.want,
                ),
                _ => (
                    format!(
                        "{base}\n\nclass Sub(Base):\n{}\n\nclass Leaf(Base, Sub):\n{}",
                        v.keep, v.keep
                    ),
                    "Leaf",
                    UNKNOWN,
                ),
            };
            // (A `dispatch` of the repository that comes before `LoginRequiredMixin`
            // in a subclass's order: whether the caller is signed in is not read,
            // and the route has no authorization unit.)
            let want =
                if v.id == "django_dispatch" && !matches!(*place, "on_self" | "sibling_override") {
                    UNKNOWN
                } else {
                    want
                };
            generated.push((
                place.to_string(),
                want,
                format!(
                    "{}\n\n{classes}\n\n{}\n\n{}",
                    v.head,
                    v.sibling,
                    v.urls.replace("{X}", bound)
                ),
            ));
        }
        cells.extend(if v.id.starts_with("flask") {
            run_flask("class_views", v.id, "org_id", generated)
        } else {
            run_django("class_views", v.id, "org_id", generated)
        });
    }
    settle(cells);
}

// ---------------------------------------------------------------------------------
// What leaves the handler: a value kept on an object of the module, a query API no
// fact reads, a role the request sends
// ---------------------------------------------------------------------------------

/// The files written to a fresh directory, which lives as long as the value.
fn written(files: &Files) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write_at(dir.path(), files);
    dir
}

/// How a body keeps a value on an object of its module, `{V}` being the value: a
/// context variable, a thread-local, a module-level dict, `setattr`, and a helper
/// of the module that does one of them.
const KEPT: &[(&str, &str)] = &[
    ("contextvar_set", "current_org.set({V})"),
    ("local_attribute", "_local.org = {V}"),
    ("module_subscript", "CURRENT[\"org\"] = {V}"),
    ("setattr", "setattr(_local, \"org\", {V})"),
    ("helper", "remember_org({V})"),
];

const KEPT_HEAD: &str = "import threading\nfrom contextvars import ContextVar\n\ncurrent_org = ContextVar(\"current_org\")\n_local = threading.local()\nCURRENT = {}\n\n\ndef remember_org(org):\n    _local.org = org\n";

const FASTAPI_KEPT_MODELS: &str = "from sqlalchemy import Column, Integer, String\nfrom sqlalchemy.orm import declarative_base\n\nBase = declarative_base()\n\n\nclass Visit(Base):\n    __tablename__ = \"visits\"\n    id = Column(Integer, primary_key=True)\n    org_id = Column(String)\n";

/// A value kept on an object of the module by a body the route runs (a FastAPI
/// dependency or middleware, a Flask decorator or hook) may be read by code the
/// route does not call (a repository, an ORM event, a manager) to scope its rows:
/// the route is never `none`, though its own query is unscoped. A sibling that runs
/// none of it is `none` (a middleware runs for every route: its cells have none).
#[test]
fn a_value_kept_outside_the_handler_is_never_none() {
    let mut cells = Vec::new();
    // FastAPI: a dependency, then a middleware.
    let mut deps = format!(
        "{KEPT_HEAD}\nfrom fastapi import Depends, FastAPI, Header, HTTPException\nfrom sqlalchemy.orm import Session\n\nfrom svc.models import Visit\n\napp = FastAPI()\n\n\ndef current_user(authorization: str | None = Header(None)):\n    if not authorization:\n        raise HTTPException(status_code=401)\n    return authorization\n\n\ndef get_db():\n    yield Session()\n"
    );
    for (id, keeps) in KEPT {
        deps.push_str(&format!(
            "\n\ndef keep_{id}(user=Depends(current_user)):\n    {}\n    return user\n\n\n@app.get(\"/{id}/covered\")\ndef {id}_covered(user=Depends(keep_{id}), db: Session = Depends(get_db)):\n    return db.query(Visit).all()\n\n\n@app.get(\"/{id}/sibling\")\ndef {id}_sibling(user=Depends(current_user), db: Session = Depends(get_db)):\n    return db.query(Visit).all()\n",
            keeps.replace("{V}", "user")
        ));
    }
    let fastapi = |main: String| {
        files(&[
            ("requirements.txt", "fastapi==0.115.0\nsqlalchemy==2.0.0\n"),
            ("svc/__init__.py", ""),
            ("svc/models.py", FASTAPI_KEPT_MODELS),
            ("svc/main.py", &main),
        ])
    };
    let said = answers(written(&fastapi(deps)).path());
    let get = |said: &BTreeMap<String, String>, r: &str| {
        said.get(r).cloned().unwrap_or_else(|| "not listed".into())
    };
    for (id, _) in KEPT {
        cells.push(Cell {
            table: "kept",
            position: "fastapi_dependency",
            thing: id,
            want: UNKNOWN,
            covered: get(&said, &format!("GET /{id}/covered")),
            sibling: get(&said, &format!("GET /{id}/sibling")),
        });
    }
    for (id, keeps) in KEPT {
        let main = format!(
            "{KEPT_HEAD}\nfrom fastapi import Depends, FastAPI, Header, HTTPException, Request\nfrom sqlalchemy.orm import Session\nfrom starlette.middleware.base import BaseHTTPMiddleware\n\nfrom svc.models import Visit\n\napp = FastAPI()\n\n\nclass Keep(BaseHTTPMiddleware):\n    async def dispatch(self, request: Request, call_next):\n        {}\n        return await call_next(request)\n\n\napp.add_middleware(Keep)\n\n\ndef current_user(authorization: str | None = Header(None)):\n    if not authorization:\n        raise HTTPException(status_code=401)\n    return authorization\n\n\ndef get_db():\n    yield Session()\n\n\n@app.get(\"/covered\")\ndef covered(user=Depends(current_user), db: Session = Depends(get_db)):\n    return db.query(Visit).all()\n",
            keeps.replace("{V}", "request.headers.get(\"x-org\")")
        );
        let said = answers(written(&fastapi(main)).path());
        cells.push(Cell {
            table: "kept",
            position: "fastapi_middleware",
            thing: id,
            want: UNKNOWN,
            covered: get(&said, "GET /covered"),
            sibling: NONE.to_string(),
        });
    }
    // Flask: a decorator of the view, then a hook of the blueprint.
    let flask_head = format!(
        "{KEPT_HEAD}\nfrom functools import wraps\n\nfrom flask import Blueprint, Flask, abort, g, request\n\nfrom app.models import Visit\n\napp = Flask(__name__)\n\n\ndef login_needed(view):\n    @wraps(view)\n    def inner(*args, **kwargs):\n        token = request.headers.get(\"Authorization\")\n        if not token:\n            abort(401)\n        g.user = token\n        return view(*args, **kwargs)\n\n    return inner\n"
    );
    let flask = |main: String| {
        files(&[
            (
                "requirements.txt",
                "flask==3.0.0\nflask-sqlalchemy==3.1.1\n",
            ),
            ("app/__init__.py", ""),
            (
                "app/models.py",
                "from flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()\n\n\nclass Visit(db.Model):\n    id = db.Column(db.Integer, primary_key=True)\n    org_id = db.Column(db.String)\n",
            ),
            ("app/main.py", &main),
        ])
    };
    let mut decorators = flask_head.clone();
    let mut hooks = flask_head.clone();
    for (id, keeps) in KEPT {
        let keeps = keeps.replace("{V}", "g.user");
        decorators.push_str(&format!(
            "\n\ndef keep_{id}(view):\n    @wraps(view)\n    def inner(*args, **kwargs):\n        {keeps}\n        return view(*args, **kwargs)\n\n    return inner\n\n\n@app.get(\"/{id}/covered\")\n@login_needed\n@keep_{id}\ndef {id}_covered():\n    return [v.id for v in Visit.query.all()]\n\n\n@app.get(\"/{id}/sibling\")\n@login_needed\ndef {id}_sibling():\n    return [v.id for v in Visit.query.all()]\n"
        ));
        hooks.push_str(&format!(
            "\n\n{id}_bp = Blueprint(\"{id}\", __name__)\n{id}_open = Blueprint(\"{id}_open\", __name__)\n\n\n@{id}_bp.before_request\ndef keep_{id}():\n    {}\n\n\n@{id}_bp.get(\"/{id}/covered\")\n@login_needed\ndef {id}_covered():\n    return [v.id for v in Visit.query.all()]\n\n\n@{id}_open.get(\"/{id}/sibling\")\n@login_needed\ndef {id}_sibling():\n    return [v.id for v in Visit.query.all()]\n\n\napp.register_blueprint({id}_bp)\napp.register_blueprint({id}_open)\n",
            keeps.replace("g.user", "request.headers.get(\"X-Org\")")
        ));
    }
    for (position, main) in [("flask_decorator", decorators), ("flask_hook", hooks)] {
        let said = answers(written(&flask(main)).path());
        for (id, _) in KEPT {
            cells.push(Cell {
                table: "kept",
                position,
                thing: id,
                want: UNKNOWN,
                covered: get(&said, &format!("GET /{id}/covered")),
                sibling: get(&said, &format!("GET /{id}/sibling")),
            });
        }
    }
    // Django: a middleware of the repository in `MIDDLEWARE` that keeps a value of
    // the caller, or hands it to a package's call that may keep it
    // (`set_current_tenant(request.user.account)`, django-multitenant); it turns no
    // one away. Every view it serves is never `none`. Beside it, one that hands the
    // value to a logger only: `none`.
    let kept_by_call: Vec<(&str, &str, &str)> = KEPT
        .iter()
        .map(|(id, keeps)| (*id, *keeps, UNKNOWN))
        .chain([
            ("package_call", "set_current_tenant({V})", UNKNOWN),
            ("logged", "logger.info(\"tenant %s\", {V})", NONE),
        ])
        .collect();
    for (id, keeps, want) in &kept_by_call {
        let middleware = format!(
            "{KEPT_HEAD}\nimport logging\n\nfrom django_multitenant.utils import set_current_tenant\n\nlogger = logging.getLogger(__name__)\n\n\nclass Keep:\n    def __init__(self, get_response):\n        self.get_response = get_response\n\n    def __call__(self, request):\n        if request.user.is_authenticated:\n            {}\n        return self.get_response(request)\n",
            keeps.replace("{V}", "request.user.account")
        );
        let mut repo = django_base();
        repo.insert(
            "requirements.txt".into(),
            "django==5.0\ndjango-multitenant==4.1.0\n".into(),
        );
        repo.insert("app/middleware.py".into(), middleware);
        repo.insert(
            "proj/settings.py".into(),
            DJANGO_SETTINGS.replace(
                "    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n",
                "    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n    \"app.middleware.Keep\",\n",
            ),
        );
        repo.insert(
            "app/views.py".into(),
            "from django.contrib.auth.decorators import login_required\nfrom django.http import JsonResponse\nfrom django.urls import path\n\nfrom app.models import Order\n\n\n@login_required\ndef covered(request):\n    return JsonResponse({\"n\": Order.objects.count()})\n\n\nurlpatterns = [path(\"covered\", covered)]\n".into(),
        );
        repo.insert(
            "proj/urls.py".into(),
            "from django.urls import include, path\n\nurlpatterns = [path(\"\", include(\"app.views\"))]\n".into(),
        );
        let said = answers(written(&repo).path());
        cells.push(Cell {
            table: "kept",
            position: "django_middleware",
            thing: id,
            want,
            covered: get(&said, "ANY /covered"),
            sibling: NONE.to_string(),
        });
    }
    settle(cells);
}

/// What filters the rows through an API the facts do not read is never `none`: a
/// comparison or a keyword with what a holder keeps (Peewee's `.where(...)`,
/// `get_or_none(...)`), a session variable set on the connection for row-level
/// security (whatever it is called), a value of the caller inside a dict handed to a
/// call, a model's manager of the repository. A role compared with a literal is a
/// role check only where the role is read off the caller: one the request sends (a
/// header, a body field, a query parameter) is found, not proven. Each beside a
/// route that reads plainly (`none`, or a role read off the caller).
#[test]
fn a_query_api_not_read_and_a_role_the_request_sends_are_not_read_as_facts() {
    let mut cells = Vec::new();
    let get = |said: &BTreeMap<String, String>, r: &str| {
        said.get(r).cloned().unwrap_or_else(|| "not listed".into())
    };
    // Flask, Peewee.
    let peewee = "from functools import wraps\n\nfrom flask import Flask, abort, g, request\nfrom peewee import CharField, Model\n\napp = Flask(__name__)\n\n\nclass Award(Model):\n    funder_id = CharField()\n\n\nclass Reviewer:\n    def __init__(self, sub, funder_id):\n        self.sub = sub\n        self.funder_id = funder_id\n\n\ndef reviewer_required(view):\n    @wraps(view)\n    def inner(*args, **kwargs):\n        token = request.headers.get(\"Authorization\")\n        if not token:\n            abort(401)\n        g.reviewer = Reviewer(token, token.split(\":\")[0])\n        return view(*args, **kwargs)\n\n    return inner\n\n\n@app.get(\"/where\")\n@reviewer_required\ndef where():\n    return [a.id for a in Award.select().where(Award.funder_id == g.reviewer.funder_id)]\n\n\n@app.get(\"/get_or_none\")\n@reviewer_required\ndef get_or_none():\n    return {\"id\": Award.get_or_none(Award.funder_id == g.reviewer.funder_id).id}\n\n\n@app.get(\"/keyword\")\n@reviewer_required\ndef keyword():\n    return {\"id\": Award.get_or_none(funder_id=g.reviewer.funder_id).id}\n\n\n@app.get(\"/sibling\")\n@reviewer_required\ndef sibling():\n    return [a.id for a in Award.select()]\n\n\n@app.post(\"/role_header\")\n@reviewer_required\ndef role_header():\n    if request.headers.get(\"X-Role\") != \"lab_manager\":\n        abort(403)\n    return {\"ok\": True}\n";
    let said = answers(
        written(&files(&[
            ("requirements.txt", "flask==3.0.0\npeewee==3.17.0\n"),
            ("app.py", peewee),
        ]))
        .path(),
    );
    for (thing, route, want) in [
        ("where", "GET /where", UNKNOWN),
        ("get_or_none", "GET /get_or_none", UNKNOWN),
        ("keyword", "GET /keyword", UNKNOWN),
        ("role_header", "POST /role_header", UNKNOWN),
    ] {
        cells.push(Cell {
            table: "query_api",
            position: "flask_peewee",
            thing,
            want,
            covered: get(&said, route),
            sibling: get(&said, "GET /sibling"),
        });
    }
    // FastAPI, SQLAlchemy: session variables and roles.
    let fastapi = "from fastapi import Depends, FastAPI, Header, HTTPException\nfrom pydantic import BaseModel\nfrom sqlalchemy import text\nfrom sqlalchemy.orm import Session\n\nfrom svc.models import Visit\n\napp = FastAPI()\n\n\nclass Caller:\n    def __init__(self, sub: str, lab_id: str, role: str):\n        self.sub = sub\n        self.lab_id = lab_id\n        self.role = role\n\n\ndef current_user(authorization: str | None = Header(None)) -> Caller:\n    if not authorization:\n        raise HTTPException(status_code=401)\n    return Caller(authorization, authorization[:4], \"member\")\n\n\ndef get_db():\n    yield Session()\n\n\ndef set_lab(db: Session, lab_id: str):\n    db.execute(text(\"SELECT set_config('app.current', :v, true)\"), {\"v\": lab_id})\n\n\nclass Body(BaseModel):\n    acting_role: str\n\n\n@app.get(\"/set_config\")\ndef set_config(user: Caller = Depends(current_user), db: Session = Depends(get_db)):\n    db.execute(text(\"SELECT set_config('app.current', :v, true)\"), {\"v\": user.lab_id})\n    return db.query(Visit).all()\n\n\n@app.get(\"/set_local\")\ndef set_local(user: Caller = Depends(current_user), db: Session = Depends(get_db)):\n    db.execute(text(\"SET LOCAL app.current = :v\"), {\"v\": user.lab_id})\n    return db.query(Visit).all()\n\n\n@app.get(\"/helper\")\ndef helper(user: Caller = Depends(current_user), db: Session = Depends(get_db)):\n    set_lab(db, user.lab_id)\n    return db.query(Visit).all()\n\n\n@app.get(\"/sibling\")\ndef sibling(user: Caller = Depends(current_user), db: Session = Depends(get_db)):\n    return db.query(Visit).all()\n\n\n@app.post(\"/role_header\")\ndef role_header(x_role: str = Header(\"\"), user: Caller = Depends(current_user)):\n    if x_role != \"lab_manager\":\n        raise HTTPException(status_code=403)\n    return {\"ok\": True}\n\n\n@app.post(\"/role_body\")\ndef role_body(body: Body, user: Caller = Depends(current_user)):\n    if body.acting_role != \"lab_manager\":\n        raise HTTPException(status_code=403)\n    return {\"ok\": True}\n\n\n@app.post(\"/role_query\")\ndef role_query(acting_role: str, user: Caller = Depends(current_user)):\n    if acting_role != \"lab_manager\":\n        raise HTTPException(status_code=403)\n    return {\"ok\": True}\n\n\n@app.post(\"/role_caller\")\ndef role_caller(user: Caller = Depends(current_user)):\n    if user.role != \"lab_manager\":\n        raise HTTPException(status_code=403)\n    return {\"ok\": True}\n";
    let said = answers(
        written(&files(&[
            ("requirements.txt", "fastapi==0.115.0\nsqlalchemy==2.0.0\n"),
            ("svc/__init__.py", ""),
            ("svc/models.py", FASTAPI_KEPT_MODELS),
            ("svc/main.py", fastapi),
        ]))
        .path(),
    );
    for (thing, route, want) in [
        ("set_config", "GET /set_config", UNKNOWN),
        ("set_local", "GET /set_local", UNKNOWN),
        ("helper", "GET /helper", UNKNOWN),
        ("role_header", "POST /role_header", UNKNOWN),
        ("role_body", "POST /role_body", UNKNOWN),
        ("role_query", "POST /role_query", UNKNOWN),
    ] {
        cells.push(Cell {
            table: "query_api",
            position: "fastapi_sqlalchemy",
            thing,
            want,
            covered: get(&said, route),
            sibling: get(&said, "GET /sibling"),
        });
    }
    cells.push(Cell {
        table: "query_api",
        position: "fastapi_sqlalchemy",
        thing: "role_caller",
        want: ROLE_CHECK,
        covered: get(&said, "POST /role_caller"),
        sibling: get(&said, "GET /sibling"),
    });
    // Django: a model's manager of the repository.
    let mut django = django_base();
    django.insert(
        "app/scoped.py".into(),
        "import threading\n\nfrom django.contrib.auth.decorators import login_required\nfrom django.db import models\nfrom django.http import JsonResponse\n\n_local = threading.local()\n\n\nclass ScopedManager(models.Manager):\n    def get_queryset(self):\n        return super().get_queryset().filter(org_id=getattr(_local, \"org\", None))\n\n\nclass Visit(models.Model):\n    org_id = models.CharField(max_length=20)\n    objects = ScopedManager()\n\n\nclass Note(models.Model):\n    org_id = models.CharField(max_length=20)\n\n\n@login_required\ndef covered(request):\n    return JsonResponse({\"ids\": [v.id for v in Visit.objects.all()]})\n\n\n@login_required\ndef sibling(request):\n    return JsonResponse({\"ids\": [n.id for n in Note.objects.all()]})".into(),
    );
    django.insert(
        "proj/urls.py".into(),
        "from django.urls import path\n\nfrom app import scoped\n\nurlpatterns = [\n    path(\"scoped/covered\", scoped.covered),\n    path(\"scoped/sibling\", scoped.sibling),\n]\n".into(),
    );
    let said = answers(written(&django).path());
    cells.push(Cell {
        table: "query_api",
        position: "django_manager",
        thing: "manager_of_the_repository",
        want: UNKNOWN,
        covered: get(&said, "ANY /scoped/covered"),
        sibling: get(&said, "ANY /scoped/sibling"),
    });
    settle(cells);
}

/// A decorator written ABOVE Flask's route decorator wraps a function no request
/// reaches: whatever it checks, a role, a tenant, an owner, or what it leaves
/// unread, is nothing of the route, which reads as it does without it (`none`).
#[test]
fn a_flask_decorator_above_the_route_decorator_checks_nothing_of_the_route() {
    let above = [Position {
        id: "above",
        cell: "from flask import Blueprint\nfrom flask_login import login_required\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@{E}\n@bp.get(\"/{C}/covered\")\n@login_required\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\n@login_required\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        only: &[],
        not: &[],
        unknown: &[],
    }];
    let things: Vec<Thing> = FLASK_DECORATORS
        .iter()
        .map(|t| Thing { want: NONE, ..*t })
        .collect();
    settle(run(
        "flask",
        &above,
        &things,
        &flask_base(),
        "app",
        &flask_main,
    ));
}
