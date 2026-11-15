//! What stands at a guard position of a Python route, as a matrix: the position
//! (a decorator, a dependency, a hook, an extension, a middleware, a base, a
//! permission class), where the thing at it comes from, and the framework. Every
//! cell is generated here from tables and read by the built binary, once per
//! generated repository.
//!
//! The rule: a thing at a guard position is a guard, not a guard, or unknown, and
//! unknown is what it is unless something proves one of the other two.
//!
//! - a: a function or class of the repository whose body is read to refuse every
//!   request without identity: a guard;
//! - b: one of the repository whose body is read to the end and never refuses: not
//!   a guard;
//! - c: one of the repository that refuses only some requests, or that cannot be
//!   read to the end: unknown;
//! - d: a library's guard on the closed list, in a call shape on the list: a guard;
//! - e: the same with an option the list says makes it optional: not a guard; with
//!   any other option that is not on the list: unknown;
//! - f: a library's thing on the closed list of what never authenticates: nothing;
//! - g: a value imported from a package on neither list: unknown, never nothing;
//! - h: a value of unknown origin (a lookup, an attribute of something not read, a
//!   conditional expression, what a factory hands back, a name that does not
//!   resolve): unknown.
//! - v: a function of the repository that verifies a token by a library's call
//!   (`jwt.decode`, a serializer's `loads`): uncaught, for every request, a caller
//!   without a valid token never reaches the handler and what it is answered is
//!   not read: unknown, never nothing. With the verification switched off, caught
//!   and swallowed, or made only where a token is sent: not a guard. Caught and
//!   answered 401: a guard.
//!
//! For every cell the test reads the route the position covers and a sibling route
//! it does not cover, on both surfaces (`drift security` and the practice map),
//! which must say the same. `DRIFT_MATRIX_DUMP=<file>` writes one line per cell
//! (and fails nothing), which is how the states of two binaries are compared.

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

fn write(files: &Files) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write_at(dir.path(), files);
    dir
}

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

const GUARDED: &str = "guarded";
const UNKNOWN: &str = "unknown";
const NO_GUARD: &str = "no guard";

/// What both surfaces say of every HTTP entry point of `root`, by `METHOD route`:
/// `guarded` (the practice map knows authentication by something that enforces, the
/// inventory counts a guard), `unknown` (unknown, "guard cannot be read"), `no
/// guard` (none, or known only as identified or opened; listed with no guard). Where
/// the two disagree the state says both.
fn answers(root: &Path) -> BTreeMap<String, String> {
    let inv = drift(root, &["security", "--json"]);
    let map = drift(root, &["practices", "--json", "--units"]);
    let authn = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .expect("no authn concern");
    let variants: Vec<&Value> = authn["variants"].as_array().into_iter().flatten().collect();
    let key_of = |u: &Value| -> String {
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
    let mut said: BTreeMap<String, &'static str> = BTreeMap::new();
    for u in authn["units"].as_array().into_iter().flatten() {
        let at = format!(
            "{} {}",
            u["method"].as_str().unwrap_or_default(),
            u["route"].as_str().unwrap_or_default()
        );
        let state = match u["assignment"].as_str().unwrap() {
            "known"
                if key_of(u).split('+').any(|k| {
                    !matches!(
                        k.split(':').next().unwrap_or_default(),
                        "identifies" | "opens" | "service_auth" | ""
                    )
                }) =>
            {
                GUARDED
            }
            "unknown" => UNKNOWN,
            _ => NO_GUARD,
        };
        said.insert(at, state);
    }
    let mut out = BTreeMap::new();
    for e in inv["entry_points"].as_array().into_iter().flatten() {
        if e["kind"] != "http" {
            continue;
        }
        let at = format!(
            "{} {}",
            e["method"].as_str().unwrap_or_default(),
            e["route"].as_str().unwrap_or_default()
        );
        let some = |k: &str| e[k].as_array().is_some_and(|a| !a.is_empty());
        let inventory = if some("guards") {
            GUARDED
        } else if some("opaque") {
            UNKNOWN
        } else {
            NO_GUARD
        };
        let state = match said.get(&at) {
            Some(m) if *m == inventory => inventory.to_string(),
            Some(m) => format!("map {m} / inventory {inventory}"),
            None => format!("map has no unit / inventory {inventory}"),
        };
        out.insert(at, state);
    }
    for (at, m) in said {
        out.entry(at)
            .or_insert_with(|| format!("map {m} / inventory lists nothing"));
    }
    out
}

/// Something written at a guard position.
#[derive(Clone, Copy)]
struct Thing {
    /// The provenance letter (the module documentation) and a word for the shape.
    id: &'static str,
    /// What the route it covers reads: [`GUARDED`], [`UNKNOWN`] or [`NO_GUARD`].
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
    /// What the covered route reads whatever the thing is, where the position is
    /// one that covers nothing (a decorator above the route decorator).
    always: Option<&'static str>,
    /// The things the position takes, by the start of their name; all when empty.
    only: &'static [&'static str],
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
    framework: &'static str,
    position: &'static str,
    thing: &'static str,
    want: &'static str,
    covered: String,
    sibling: String,
}

impl Cell {
    fn ok(&self) -> bool {
        self.covered == self.want && self.sibling == NO_GUARD
    }
}

/// Reads one repository per position, every thing in a module of its own, and
/// returns a cell for each. `base` are the files every repository has; `main` builds
/// the application module from the lines the cells add to it.
fn run(
    framework: &'static str,
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
                let root = Path::new(k).join(format!("{framework}_{}", p.id));
                write_at(&root, &files);
                answers(&root)
            }
            None => answers(write(&files).path()),
        };
        for t in &things {
            let cell = format!("{}_{}", p.id, t.id);
            // (A Django function view is listed for every method.)
            let get = |which: &str| {
                said.get(&format!("GET /{cell}/{which}"))
                    .or_else(|| said.get(&format!("ANY /{cell}/{which}")))
                    // (Under a prefix that is not read: options unpacked.)
                    .or_else(|| said.get(&format!("GET /?/{cell}/{which}")))
                    .cloned()
                    .unwrap_or_else(|| "not listed".to_string())
            };
            cells.push(Cell {
                framework,
                position: p.id,
                thing: t.id,
                want: p.always.unwrap_or(t.want),
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
                c.framework, c.position, c.thing, c.want, c.covered, c.sibling
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
                c.framework, c.position, c.thing, c.covered, c.want, c.sibling
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
// FastAPI: dependencies
// ---------------------------------------------------------------------------------

const FASTAPI_THINGS_PY: &str = r#"import os

import jwt
from company_auth import verify as vendor_verify
from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse


def require_user(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return authorization


def decode(token: str):
    if not token.startswith("Bearer "):
        raise ValueError("no token")
    return {"sub": token[7:]}


def verified_user(authorization: str = Header("")):
    try:
        claims = decode(authorization)
    except ValueError:
        raise HTTPException(status_code=401)
    return claims


class RequireKey:
    def __init__(self, name: str = "x-key"):
        self.name = name

    def __call__(self, request: Request):
        if self.name not in request.headers:
            raise HTTPException(status_code=401)
        return request.headers[self.name]


require_key = RequireKey()


def require_role(role: str):
    def check(authorization: str | None = Header(None)):
        if not authorization:
            raise HTTPException(status_code=401)
        return role

    return check


def auth_dependency():
    async def get_caller(caller=Depends(require_user)):
        return caller

    return get_caller


caller_dependency = auth_dependency()


def paging_dependency():
    def get_page(page=Depends(paging)):
        return page

    return get_page


page_dependency = paging_dependency()


def get_db():
    db = {"open": True}
    try:
        yield db
    finally:
        db["open"] = False


def paging(limit: int = 10, offset: int = 0):
    return {"limit": limit, "offset": offset}


class Pager:
    def __init__(self, size: int = 10):
        self.size = size

    def __call__(self, page: int = 1):
        return {"page": page, "size": self.size}


def make_pager(size: int):
    def pager(page: int = 1):
        return {"page": page, "size": size}

    return pager


def soft_key(x_key: str | None = Header(None)):
    if not x_key:
        return JSONResponse({"detail": "no key"}, status_code=401)
    return x_key


def lookup_caller(authorization: str | None = Header(None)):
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401)
    return authorization[7:]


def vendor_gate(request: Request):
    vendor_verify(request)
    return True


KEY = os.environ.get("KEY", "")


def decoded(authorization: str = Header("")):
    return jwt.decode(authorization, KEY, algorithms=["HS256"])


def decoded_unverified(authorization: str = Header("")):
    return jwt.decode(authorization, options={"verify_signature": False})


def decoded_or_none(authorization: str = Header("")):
    try:
        return jwt.decode(authorization, KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


def decoded_or_401(authorization: str = Header("")):
    try:
        return jwt.decode(authorization, KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401)


def decoded_if_given(authorization: str | None = Header(None)):
    if authorization:
        return jwt.decode(authorization, KEY, algorithms=["HS256"])
    return None


GUARDS = {"user": require_user, "db": get_db}
STRICT = os.environ.get("STRICT") == "1"


class Registry:
    def __init__(self):
        self.guard = require_user


registry = Registry()


def pick_guard():
    return GUARDS[os.environ.get("MODE", "user")]
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
maybe_user = fastapi_users.current_user(optional=True)
"#;

/// What a FastAPI dependency can be.
const FASTAPI_DEPENDENCIES: &[Thing] = &[
    thing(
        "a_raises",
        GUARDED,
        "from svc.things import require_user",
        "require_user",
    ),
    thing(
        "a_try",
        GUARDED,
        "from svc.things import verified_user",
        "verified_user",
    ),
    thing(
        "a_class",
        GUARDED,
        "from svc.things import RequireKey",
        "RequireKey()",
    ),
    thing(
        "a_instance",
        GUARDED,
        "from svc.things import require_key",
        "require_key",
    ),
    thing(
        "a_factory",
        GUARDED,
        "from svc.things import require_role",
        "require_role(\"admin\")",
    ),
    // What a factory hands back depends on the guard; the name bound to its result
    // is that function.
    thing(
        "a_factory_depends",
        GUARDED,
        "from svc.things import auth_dependency",
        "auth_dependency()",
    ),
    thing(
        "a_factory_depends_bound",
        GUARDED,
        "from svc.things import caller_dependency",
        "caller_dependency",
    ),
    thing(
        "b_factory_depends_bound",
        NO_GUARD,
        "from svc.things import page_dependency",
        "page_dependency",
    ),
    thing("b_db", NO_GUARD, "from svc.things import get_db", "get_db"),
    thing(
        "b_plain",
        NO_GUARD,
        "from svc.things import paging",
        "paging",
    ),
    thing(
        "b_class",
        NO_GUARD,
        "from svc.things import Pager",
        "Pager()",
    ),
    thing(
        "b_factory",
        NO_GUARD,
        "from svc.things import make_pager",
        "make_pager(20)",
    ),
    // A dependency that hands a 401 response back refuses no one: FastAPI gives the
    // value to the handler's parameter, or drops it.
    thing(
        "b_returns_401",
        NO_GUARD,
        "from svc.things import soft_key",
        "soft_key",
    ),
    thing(
        "c_some",
        UNKNOWN,
        "from svc.things import lookup_caller",
        "lookup_caller",
    ),
    thing(
        "c_unread",
        UNKNOWN,
        "from svc.things import vendor_gate",
        "vendor_gate",
    ),
    thing(
        "v_uncaught",
        UNKNOWN,
        "from svc.things import decoded",
        "decoded",
    ),
    thing(
        "v_off",
        NO_GUARD,
        "from svc.things import decoded_unverified",
        "decoded_unverified",
    ),
    thing(
        "v_swallowed",
        NO_GUARD,
        "from svc.things import decoded_or_none",
        "decoded_or_none",
    ),
    thing(
        "v_if_given",
        NO_GUARD,
        "from svc.things import decoded_if_given",
        "decoded_if_given",
    ),
    thing(
        "a_verified",
        GUARDED,
        "from svc.things import decoded_or_401",
        "decoded_or_401",
    ),
    thing(
        "d_bearer",
        GUARDED,
        "from fastapi.security import HTTPBearer\n\nbearer = HTTPBearer()",
        "bearer",
    ),
    thing(
        "d_bearer_inline",
        GUARDED,
        "from fastapi.security import HTTPBearer",
        "HTTPBearer()",
    ),
    thing(
        "d_bearer_described",
        GUARDED,
        "from fastapi.security import HTTPBearer\n\nbearer = HTTPBearer(scheme_name=\"token\", description=\"A token\", auto_error=True)",
        "bearer",
    ),
    thing(
        "d_oauth2",
        GUARDED,
        "from fastapi.security import OAuth2PasswordBearer\n\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\")",
        "oauth2",
    ),
    thing(
        "d_api_key",
        GUARDED,
        "from fastapi.security import APIKeyHeader\n\napi_key = APIKeyHeader(name=\"X-Key\")",
        "api_key",
    ),
    thing(
        "d_basic",
        GUARDED,
        "from fastapi.security import HTTPBasic\n\nbasic = HTTPBasic()",
        "basic",
    ),
    thing(
        "d_users_active",
        GUARDED,
        "from svc.users import fastapi_users",
        "fastapi_users.current_user(active=True)",
    ),
    thing(
        "d_users_bound",
        GUARDED,
        "from svc.users import current_active_user",
        "current_active_user",
    ),
    thing(
        "d_users_plain",
        GUARDED,
        "from svc.users import fastapi_users",
        "fastapi_users.current_user()",
    ),
    thing(
        "e_bearer_soft",
        NO_GUARD,
        "from fastapi.security import HTTPBearer\n\nbearer = HTTPBearer(auto_error=False)",
        "bearer",
    ),
    thing(
        "e_bearer_soft_inline",
        NO_GUARD,
        "from fastapi.security import HTTPBearer",
        "HTTPBearer(auto_error=False)",
    ),
    thing(
        "e_oauth2_soft",
        NO_GUARD,
        "from fastapi.security import OAuth2PasswordBearer\n\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\", auto_error=False)",
        "oauth2",
    ),
    thing(
        "e_api_key_soft",
        NO_GUARD,
        "from fastapi.security import APIKeyHeader\n\napi_key = APIKeyHeader(name=\"X-Key\", auto_error=False)",
        "api_key",
    ),
    thing(
        "e_users_optional",
        NO_GUARD,
        "from svc.users import fastapi_users",
        "fastapi_users.current_user(optional=True)",
    ),
    thing(
        "e_users_optional_bound",
        NO_GUARD,
        "from svc.users import maybe_user",
        "maybe_user",
    ),
    thing(
        "e_bearer_unlisted",
        UNKNOWN,
        "from fastapi.security import HTTPBearer\n\nOPTIONS = {\"auto_error\": False}\nbearer = HTTPBearer(**OPTIONS)",
        "bearer",
    ),
    thing(
        "e_bearer_flag",
        UNKNOWN,
        "import os\n\nfrom fastapi.security import HTTPBearer\n\nbearer = HTTPBearer(auto_error=os.environ.get(\"STRICT\") == \"1\")",
        "bearer",
    ),
    thing(
        "e_users_unlisted",
        UNKNOWN,
        "from svc.users import fastapi_users",
        "fastapi_users.current_user(active=True, get_enabled_backends=None)",
    ),
    thing(
        "f_form",
        NO_GUARD,
        "from fastapi.security import OAuth2PasswordRequestForm",
        "OAuth2PasswordRequestForm",
    ),
    thing(
        "f_limiter",
        NO_GUARD,
        "from fastapi_limiter.depends import RateLimiter",
        "RateLimiter(times=2, seconds=5)",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth import require_login",
        "require_login",
    ),
    thing(
        "g_company_call",
        UNKNOWN,
        "from company_auth import require_scope",
        "require_scope(\"read\")",
    ),
    thing(
        "g_company_scheme",
        UNKNOWN,
        "from company_auth.fastapi import TokenScheme\n\nscheme = TokenScheme(issuer=\"https://id.example\")",
        "scheme",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from svc.things import GUARDS",
        "GUARDS[\"user\"]",
    ),
    thing(
        "h_attribute",
        UNKNOWN,
        "from svc.things import registry",
        "registry.guard",
    ),
    thing(
        "h_conditional",
        UNKNOWN,
        "from svc.things import STRICT, get_db, require_user",
        "require_user if STRICT else get_db",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from svc.missing import guard",
        "guard",
    ),
    thing(
        "h_factory",
        UNKNOWN,
        "from svc.things import pick_guard",
        "pick_guard()",
    ),
];

const FASTAPI_ROUTER: &str = "from svc import {M}\n\napp.include_router({M}.router)\n";

/// Where a FastAPI dependency is written.
const FASTAPI_POSITIONS: &[Position] = &[
    Position {
        id: "param",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends({E})):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "annotated",
        cell: "from typing import Annotated\n\nfrom fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who: Annotated[object, Depends({E})]):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "alias",
        cell: "from typing import Annotated\n\nfrom fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\nWho = Annotated[object, Depends({E})]\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who: Who):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "security",
        cell: "from fastapi import APIRouter, Security\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Security({E}, scopes=[\"read\"])):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "route",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\", dependencies=[Depends({E})])\ndef covered():\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "kwargs",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\nPROTECTED = {\"dependencies\": [Depends({E})]}\n\n\n@router.get(\"/{C}/covered\", **PROTECTED)\ndef covered():\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
    Position {
        id: "router",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter(dependencies=[Depends({E})])\nopen_router = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@open_router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from svc import {M}\n\napp.include_router({M}.router)\napp.include_router({M}.open_router)\n",
        always: None,
        only: &[],
    },
    Position {
        id: "include",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\nopen_router = APIRouter()\nouter = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@open_router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n\n\nouter.include_router(router, dependencies=[Depends({E})])\nouter.include_router(open_router)\n",
        main: "from svc import {M}\n\napp.include_router({M}.outer)\n",
        always: None,
        only: &[],
    },
    Position {
        id: "app_include",
        cell: "from fastapi import APIRouter, Depends, FastAPI\n{PRE}\n\nrouter = APIRouter()\nopen_router = APIRouter()\napp = FastAPI()\n\n\n@router.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@open_router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n\n\napp.include_router(router, dependencies=[Depends({E})])\napp.include_router(open_router)\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "app",
        cell: "from fastapi import Depends, FastAPI\n{PRE}\n\napp = FastAPI(dependencies=[Depends({E})])\nother = FastAPI()\n\n\n@app.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "sub",
        cell: "from fastapi import APIRouter, Depends\n{PRE}\n\nrouter = APIRouter()\n\n\ndef outer(inner=Depends({E})):\n    return inner\n\n\n@router.get(\"/{C}/covered\")\ndef covered(who=Depends(outer)):\n    return {\"ok\": True}\n\n\n@router.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FASTAPI_ROUTER,
        always: None,
        only: &[],
    },
];

fn fastapi_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "fastapi==0.115.0\nfastapi-users==13.0.0\nfastapi-limiter==0.1.6\nuvicorn==0.30.0\n",
        ),
        ("svc/__init__.py", ""),
        ("svc/things.py", FASTAPI_THINGS_PY),
        ("svc/users.py", FASTAPI_USERS_PY),
    ])
}

fn fastapi_main(lines: &str) -> (String, String) {
    (
        "svc/main.py".to_string(),
        format!("from fastapi import FastAPI\n\napp = FastAPI()\n\n{lines}"),
    )
}

#[test]
fn a_fastapi_dependency_is_a_guard_nothing_or_unknown_at_every_position() {
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
// Flask: decorators
// ---------------------------------------------------------------------------------

const FLASK_THINGS_PY: &str = r#"import os
from functools import wraps

from authlib.integrations.flask_oauth2 import ResourceProtector
from company_auth import verify as vendor_verify
from flask import abort, g, jsonify, request, session
from flask_caching import Cache
from flask_httpauth import HTTPBasicAuth, HTTPTokenAuth
from itsdangerous import BadSignature, URLSafeTimedSerializer
from flask_jwt_extended import verify_jwt_in_request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect


def login_needed(view):
    @wraps(view)
    def inner(*args, **kwargs):
        if not session.get("uid"):
            abort(401)
        return view(*args, **kwargs)

    return inner


def require_key(header="X-Key"):
    def decorate(view):
        @wraps(view)
        def inner(*args, **kwargs):
            if header not in request.headers:
                abort(401)
            return view(*args, **kwargs)

        return inner

    return decorate


def jwt_needed(view):
    @wraps(view)
    def inner(*args, **kwargs):
        verify_jwt_in_request()
        return view(*args, **kwargs)

    return inner


def timed(view):
    @wraps(view)
    def inner(*args, **kwargs):
        g.started = True
        return view(*args, **kwargs)

    return inner


def cached(seconds):
    def decorate(view):
        @wraps(view)
        def inner(*args, **kwargs):
            g.ttl = seconds
            return view(*args, **kwargs)

        return inner

    return decorate


def jwt_if_given(view):
    @wraps(view)
    def inner(*args, **kwargs):
        verify_jwt_in_request(optional=True)
        return view(*args, **kwargs)

    return inner


def token_if_given(view):
    @wraps(view)
    def inner(*args, **kwargs):
        token = request.headers.get("Authorization")
        if token and not token.startswith("Bearer "):
            abort(401)
        return view(*args, **kwargs)

    return inner


def vendor_checked(view):
    @wraps(view)
    def inner(*args, **kwargs):
        vendor_verify(request)
        return view(*args, **kwargs)

    return inner


signer = URLSafeTimedSerializer(os.environ.get("KEY", ""))


def signed(view):
    @wraps(view)
    def inner(*args, **kwargs):
        g.user = signer.loads(request.headers.get("X-Token", ""), max_age=3600)
        return view(*args, **kwargs)

    return inner


def signed_or_none(view):
    @wraps(view)
    def inner(*args, **kwargs):
        try:
            g.user = signer.loads(request.headers.get("X-Token", ""), max_age=3600)
        except BadSignature:
            g.user = None
        return view(*args, **kwargs)

    return inner


basic_auth = HTTPBasicAuth()
token_auth = HTTPTokenAuth(scheme="Bearer")


@basic_auth.verify_password
def verify_password(username, password):
    return username if password == os.environ.get("PASSWORD") else None


@token_auth.verify_token
def verify_token(token):
    return token if token == os.environ.get("TOKEN") else None


require_oauth = ResourceProtector()
csrf = CSRFProtect()
cache = Cache()
limiter = Limiter(get_remote_address)


def require_session():
    if "uid" not in session:
        abort(401)


def strict_jwt():
    verify_jwt_in_request()


def open_db():
    g.db = {"open": True}


def soft_jwt():
    verify_jwt_in_request(optional=True)


def jwt_if_strict():
    if STRICT:
        verify_jwt_in_request()


def denied_response():
    if "uid" not in session:
        return jsonify(error="sign in"), 401
    return None


def admin_gate():
    if request.path.startswith("/admin") and not session.get("uid"):
        abort(401)


def vendor_hook():
    vendor_verify(request)


GUARDS = {"user": login_needed, "timed": timed}
HOOKS = {"session": require_session, "db": open_db}
STRICT = os.environ.get("STRICT") == "1"


class Registry:
    def __init__(self):
        self.guard = login_needed
        self.hook = require_session


registry = Registry()


def pick_guard():
    return GUARDS[os.environ.get("MODE", "user")]


def pick_hook():
    return HOOKS[os.environ.get("MODE", "session")]


DEBUG = os.environ.get("DEBUG") == "1"


def login_unless_debug(view):
    if DEBUG:
        return view
    return login_needed(view)


def hands_on(view):
    return login_needed(view)


def unless_debug(decorator):
    def apply(view):
        if DEBUG:
            return view
        return decorator(view)

    return apply


login_or_open = login_needed if not DEBUG else (lambda v: v)

def login_ifexp(view):
    @wraps(view)
    def inner(*args, **kwargs):
        if not session.get("uid"):
            abort(401)
        return view(*args, **kwargs)

    return view if DEBUG else inner


def login_rebound(view):
    @wraps(view)
    def inner(*args, **kwargs):
        if not session.get("uid"):
            abort(401)
        return view(*args, **kwargs)

    if DEBUG:
        inner = view
    return inner
"#;

/// What a decorator of a Flask view can be.
const FLASK_DECORATORS: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from app.things import login_needed",
        "login_needed",
    ),
    thing(
        "a_repo_called",
        GUARDED,
        "from app.things import require_key",
        "require_key()",
    ),
    thing(
        "a_repo_library_first",
        GUARDED,
        "from app.things import jwt_needed",
        "jwt_needed",
    ),
    thing("b_repo", NO_GUARD, "from app.things import timed", "timed"),
    thing(
        "b_repo_called",
        NO_GUARD,
        "from app.things import cached",
        "cached(60)",
    ),
    thing(
        "b_repo_library_optional",
        NO_GUARD,
        "from app.things import jwt_if_given",
        "jwt_if_given",
    ),
    thing(
        "c_some",
        UNKNOWN,
        "from app.things import token_if_given",
        "token_if_given",
    ),
    thing(
        "c_unread",
        UNKNOWN,
        "from app.things import vendor_checked",
        "vendor_checked",
    ),
    thing(
        "v_uncaught",
        UNKNOWN,
        "from app.things import signed",
        "signed",
    ),
    thing(
        "v_swallowed",
        NO_GUARD,
        "from app.things import signed_or_none",
        "signed_or_none",
    ),
    thing(
        "d_flask_login",
        GUARDED,
        "from flask_login import login_required",
        "login_required",
    ),
    thing(
        "d_flask_login_fresh",
        GUARDED,
        "from flask_login import fresh_login_required",
        "fresh_login_required",
    ),
    thing(
        "d_jwt",
        GUARDED,
        "from flask_jwt_extended import jwt_required",
        "jwt_required()",
    ),
    thing(
        "d_jwt_fresh",
        GUARDED,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(fresh=True)",
    ),
    thing(
        "d_jwt_refresh",
        GUARDED,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(refresh=True)",
    ),
    thing(
        "d_jwt_locations",
        GUARDED,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(locations=[\"headers\"], verify_type=False)",
    ),
    thing(
        "d_jwt_not_optional",
        GUARDED,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(optional=False)",
    ),
    thing(
        "d_httpauth",
        GUARDED,
        "from app.things import basic_auth",
        "basic_auth.login_required",
    ),
    thing(
        "d_httpauth_role",
        GUARDED,
        "from app.things import token_auth",
        "token_auth.login_required(role=\"admin\")",
    ),
    thing(
        "d_authlib",
        GUARDED,
        "from app.things import require_oauth",
        "require_oauth(\"profile\")",
    ),
    thing(
        "d_authlib_plain",
        GUARDED,
        "from app.things import require_oauth",
        "require_oauth()",
    ),
    thing(
        "e_jwt_optional",
        NO_GUARD,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(optional=True)",
    ),
    thing(
        "e_jwt_optional_first",
        NO_GUARD,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(True)",
    ),
    thing(
        "e_httpauth_optional",
        NO_GUARD,
        "from app.things import basic_auth",
        "basic_auth.login_required(optional=True)",
    ),
    thing(
        "e_authlib_optional",
        NO_GUARD,
        "from app.things import require_oauth",
        "require_oauth(\"profile\", optional=True)",
    ),
    thing(
        "e_jwt_flag",
        UNKNOWN,
        "from app.things import STRICT\nfrom flask_jwt_extended import jwt_required",
        "jwt_required(optional=not STRICT)",
    ),
    thing(
        "e_jwt_unlisted",
        UNKNOWN,
        "from flask_jwt_extended import jwt_required",
        "jwt_required(skip_revocation_check=True)",
    ),
    thing(
        "e_jwt_splat",
        UNKNOWN,
        "from flask_jwt_extended import jwt_required\n\nJWT_OPTIONS = {\"optional\": True}",
        "jwt_required(**JWT_OPTIONS)",
    ),
    thing(
        "f_csrf_exempt",
        NO_GUARD,
        "from app.things import csrf",
        "csrf.exempt",
    ),
    thing(
        "f_limiter",
        NO_GUARD,
        "from app.things import limiter",
        "limiter.limit(\"5/minute\")",
    ),
    thing(
        "f_cache",
        NO_GUARD,
        "from app.things import cache",
        "cache.cached(timeout=60)",
    ),
    thing(
        "f_cors",
        NO_GUARD,
        "from flask_cors import cross_origin",
        "cross_origin()",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth import require_login",
        "require_login",
    ),
    thing(
        "g_company_called",
        UNKNOWN,
        "from company_auth import require_scope",
        "require_scope(\"read\")",
    ),
    thing(
        "g_principal",
        UNKNOWN,
        "from flask_principal import Permission, RoleNeed\n\nadmin_permission = Permission(RoleNeed(\"admin\"))",
        "admin_permission.require(http_exception=403)",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from app.things import GUARDS",
        "GUARDS[\"user\"]",
    ),
    thing(
        "h_attribute",
        UNKNOWN,
        "from app.things import registry",
        "registry.guard",
    ),
    thing(
        "h_conditional",
        UNKNOWN,
        "from app.things import STRICT, login_needed, timed",
        "(login_needed if STRICT else timed)",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from app.missing import guard",
        "guard",
    ),
    thing(
        "h_factory",
        UNKNOWN,
        "from app.things import pick_guard",
        "pick_guard()",
    ),
    // Applied under a condition, decided where the decorator is applied: a
    // function that hands the view back unchanged on one branch, a factory that
    // does, one that hands back what another decorator makes of the view, and a
    // conditional value.
    thing(
        "h_debug_branch",
        UNKNOWN,
        "from app.things import login_unless_debug",
        "login_unless_debug",
    ),
    thing(
        "h_returns_call",
        UNKNOWN,
        "from app.things import hands_on",
        "hands_on",
    ),
    thing(
        "h_debug_factory",
        UNKNOWN,
        "from app.things import login_needed, unless_debug",
        "unless_debug(login_needed)",
    ),
    thing(
        "h_debug_value",
        UNKNOWN,
        "from app.things import login_or_open",
        "login_or_open",
    ),
    // The view handed back by an if-expression, or by a local bound to it under a
    // branch.
    thing(
        "h_debug_ifexp",
        UNKNOWN,
        "from app.things import login_ifexp",
        "login_ifexp",
    ),
    thing(
        "h_debug_rebound",
        UNKNOWN,
        "from app.things import login_rebound",
        "login_rebound",
    ),
];

const FLASK_BLUEPRINT: &str = "from app import {M}\n\napp.register_blueprint({M}.bp)\n";

/// Where a decorator of a Flask view is written.
const FLASK_DECORATOR_POSITIONS: &[Position] = &[
    Position {
        id: "under",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@bp.get(\"/{C}/covered\")\n@{E}\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    // Flask registers the function the route decorator is handed: a decorator written
    // above it wraps a function no request reaches.
    Position {
        id: "above",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@{E}\n@bp.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: Some(NO_GUARD),
        only: &[],
    },
    Position {
        id: "alias",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nguard = {E}\n\n\n@bp.get(\"/{C}/covered\")\n@guard\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    Position {
        id: "route_form",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@bp.route(\"/{C}/covered\", methods=[\"GET\"])\n@{E}\ndef covered():\n    return {\"ok\": True}\n\n\n@bp.route(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    Position {
        id: "method_view",
        cell: "from flask import Blueprint\nfrom flask.views import MethodView\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\nclass Covered(MethodView):\n    decorators = [{E}]\n\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(MethodView):\n    def get(self):\n        return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func=Covered.as_view(\"covered\"))\nbp.add_url_rule(\"/{C}/sibling\", view_func=Sibling.as_view(\"sibling\"))\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    // The view class registered by a route decorator on the class (Flask 2.2's
    // `@bp.route` on a `MethodView`, flask-smorest's `Blueprint.route`): its list is
    // not written above the route decorator.
    Position {
        id: "class_route",
        cell: "from flask import Blueprint\nfrom flask.views import MethodView\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@bp.route(\"/{C}/covered\")\nclass Covered(MethodView):\n    decorators = [{E}]\n\n    def get(self):\n        return {\"ok\": True}\n\n\n@bp.route(\"/{C}/sibling\")\nclass Sibling(MethodView):\n    def get(self):\n        return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    Position {
        id: "method",
        cell: "from flask import Blueprint\nfrom flask.views import MethodView\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\nclass Covered(MethodView):\n    @{E}\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(MethodView):\n    def get(self):\n        return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func=Covered.as_view(\"covered\"))\nbp.add_url_rule(\"/{C}/sibling\", view_func=Sibling.as_view(\"sibling\"))\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
    Position {
        id: "url_rule",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\ndef covered():\n    return {\"ok\": True}\n\n\ndef sibling():\n    return {\"ok\": True}\n\n\nbp.add_url_rule(\"/{C}/covered\", view_func={E}(covered), methods=[\"GET\"])\nbp.add_url_rule(\"/{C}/sibling\", view_func=sibling, methods=[\"GET\"])\n",
        main: FLASK_BLUEPRINT,
        always: None,
        only: &[],
    },
];

fn flask_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "flask==3.0.0\nflask-login==0.6.3\nflask-jwt-extended==4.6.0\nflask-httpauth==4.8.0\nauthlib==1.3.0\nflask-wtf==1.2.1\nflask-limiter==3.5.0\nflask-caching==2.1.0\nflask-cors==4.0.0\nflask-principal==0.4.0\nflask-sqlalchemy==3.1.1\nflask-migrate==4.0.5\nflask-marshmallow==1.2.0\n",
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
fn a_flask_decorator_is_a_guard_nothing_or_unknown_at_every_position() {
    settle(run(
        "flask",
        FLASK_DECORATOR_POSITIONS,
        FLASK_DECORATORS,
        &flask_base(),
        "app",
        &flask_main,
    ));
}

// ---------------------------------------------------------------------------------
// Flask: hooks
// ---------------------------------------------------------------------------------

/// What a function Flask runs before a request can be. The expression is the
/// function, not a call of it.
const FLASK_HOOKS: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from app.things import require_session",
        "require_session",
    ),
    thing(
        "a_repo_library_first",
        GUARDED,
        "from app.things import strict_jwt",
        "strict_jwt",
    ),
    thing(
        "b_repo",
        NO_GUARD,
        "from app.things import open_db",
        "open_db",
    ),
    thing(
        "b_repo_library_optional",
        NO_GUARD,
        "from app.things import soft_jwt",
        "soft_jwt",
    ),
    thing(
        "c_some",
        UNKNOWN,
        "from app.things import admin_gate",
        "admin_gate",
    ),
    thing(
        "c_unread",
        UNKNOWN,
        "from app.things import vendor_hook",
        "vendor_hook",
    ),
    thing(
        "c_library_some",
        UNKNOWN,
        "from app.things import jwt_if_strict",
        "jwt_if_strict",
    ),
    thing(
        "d_jwt",
        GUARDED,
        "from flask_jwt_extended import verify_jwt_in_request",
        "verify_jwt_in_request",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth import check_request",
        "check_request",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from app.things import HOOKS",
        "HOOKS[\"session\"]",
    ),
    thing(
        "h_attribute",
        UNKNOWN,
        "from app.things import registry",
        "registry.hook",
    ),
    thing(
        "h_conditional",
        UNKNOWN,
        "from app.things import STRICT, open_db, require_session",
        "(require_session if STRICT else open_db)",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from app.missing import hook",
        "hook",
    ),
    thing(
        "h_factory",
        UNKNOWN,
        "from app.things import pick_hook",
        "pick_hook()",
    ),
];

/// Where a function Flask runs before a request is given.
const FLASK_HOOK_POSITIONS: &[Position] = &[
    Position {
        id: "bp_call",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nopen_bp = Blueprint(\"{C}_open\", __name__)\nbp.before_request({E})\n\n\n@bp.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@open_bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from app import {M}\n\napp.register_blueprint({M}.bp)\napp.register_blueprint({M}.open_bp)\n",
        always: None,
        only: &[],
    },
    Position {
        id: "bp_decorator",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\nopen_bp = Blueprint(\"{C}_open\", __name__)\n\n\n@bp.before_request\ndef before():\n    {E}()\n\n\n@bp.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@open_bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from app import {M}\n\napp.register_blueprint({M}.bp)\napp.register_blueprint({M}.open_bp)\n",
        always: None,
        only: &[],
    },
    Position {
        id: "app_call",
        cell: "from flask import Flask\n{PRE}\n\napp = Flask(__name__)\nother = Flask(\"other\")\napp.before_request({E})\n\n\n@app.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "app_wide",
        cell: "from flask import Blueprint, Flask\n{PRE}\n\napp = Flask(__name__)\nother = Flask(\"other\")\nauth_bp = Blueprint(\"{C}_auth\", __name__)\nbp = Blueprint(\"{C}\", __name__)\nauth_bp.before_app_request({E})\n\n\n@bp.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n\n\napp.register_blueprint(auth_bp)\napp.register_blueprint(bp)\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "body",
        cell: "from flask import Blueprint\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\n\n\n@bp.get(\"/{C}/covered\")\ndef covered():\n    {E}()\n    return {\"ok\": True}\n\n\n@bp.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: FLASK_BLUEPRINT,
        always: None,
        // A call in a handler's own body: the functions of the repository and the
        // library's guards. What a handler calls of a package on no list, or
        // through a value, is read by the rules of a handler's body.
        only: &["a_", "b_", "c_some", "d_"],
    },
];

#[test]
fn a_flask_hook_is_a_guard_nothing_or_unknown_at_every_position() {
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
// Flask: what the application is handed to
// ---------------------------------------------------------------------------------

const FLASK_EXTENSIONS_PY: &str = r#"from flask import abort, g, session


def require_session():
    if "uid" not in session:
        abort(401)


def close_db(exc=None):
    g.pop("db", None)


def init_auth(app):
    app.before_request(require_session)


def init_db(app):
    app.teardown_appcontext(close_db)


class Extension:
    def __init__(self, app=None):
        if app is not None:
            self.init_app(app)

    def init_app(self, app):
        app.extensions["plain"] = self


def make_extension():
    from company_sso import SSO

    return SSO()
"#;

/// What a Flask application can be handed to. The expression is the statement that
/// hands `app` over.
const FLASK_EXTENSIONS: &[Thing] = &[
    thing(
        "a_repo_init",
        GUARDED,
        "from app.extensions import init_auth",
        "init_auth(app)",
    ),
    thing(
        "b_repo_init",
        NO_GUARD,
        "from app.extensions import init_db",
        "init_db(app)",
    ),
    // A method of a class of the repository handed the application: what it
    // registers on it is not read.
    thing(
        "c_repo_class",
        UNKNOWN,
        "from app.extensions import Extension\n\nplain = Extension()",
        "plain.init_app(app)",
    ),
    thing(
        "f_sqlalchemy",
        NO_GUARD,
        "from flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()",
        "db.init_app(app)",
    ),
    thing(
        "f_sqlalchemy_built",
        NO_GUARD,
        "from flask_sqlalchemy import SQLAlchemy",
        "db = SQLAlchemy(app)",
    ),
    thing(
        "f_migrate",
        NO_GUARD,
        "from flask_migrate import Migrate\nfrom flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()",
        "Migrate(app, db)",
    ),
    thing(
        "f_cors",
        NO_GUARD,
        "from flask_cors import CORS",
        "CORS(app)",
    ),
    thing(
        "f_marshmallow",
        NO_GUARD,
        "from flask_marshmallow import Marshmallow\n\nma = Marshmallow()",
        "ma.init_app(app)",
    ),
    // Flask-Login's manager loads the user; it turns no one away by itself.
    thing(
        "f_login_manager",
        NO_GUARD,
        "from flask_login import LoginManager\n\nlogin_manager = LoginManager()",
        "login_manager.init_app(app)",
    ),
    thing(
        "f_jwt_manager",
        NO_GUARD,
        "from flask_jwt_extended import JWTManager",
        "jwt = JWTManager(app)",
    ),
    thing(
        "g_sso_init",
        UNKNOWN,
        "from company_sso import SSO\n\nsso = SSO()",
        "sso.init_app(app)",
    ),
    thing(
        "g_sso_built",
        UNKNOWN,
        "from company_sso import SSO",
        "sso = SSO(app)",
    ),
    thing(
        "g_function",
        UNKNOWN,
        "from company_sso import protect",
        "protect(app)",
    ),
    thing(
        "h_factory",
        UNKNOWN,
        "from app.extensions import make_extension\n\nextension = make_extension()",
        "extension.init_app(app)",
    ),
];

const FLASK_EXTENSION_POSITIONS: &[Position] = &[Position {
    id: "module",
    cell: "from flask import Flask\n{PRE}\n\napp = Flask(__name__)\nother = Flask(\"other\")\n{E}\n\n\n@app.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
    main: "",
    always: None,
    only: &[],
}];

#[test]
fn what_a_flask_application_is_handed_to_is_a_guard_nothing_or_unknown() {
    let mut base = flask_base();
    base.insert(
        "app/extensions.py".to_string(),
        FLASK_EXTENSIONS_PY.to_string(),
    );
    settle(run(
        "flask_extension",
        FLASK_EXTENSION_POSITIONS,
        FLASK_EXTENSIONS,
        &base,
        "app",
        &|_| ("app/empty.py".to_string(), String::new()),
    ));
}

// ---------------------------------------------------------------------------------
// Django: decorators of a view
// ---------------------------------------------------------------------------------

const DJANGO_THINGS_PY: &str = r#"import os
from functools import wraps

from company_auth import verify as vendor_verify
from django.http import JsonResponse


def login_needed(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    return inner


def require_key(header="X-Key"):
    def decorate(view):
        @wraps(view)
        def inner(request, *args, **kwargs):
            if header not in request.headers:
                return JsonResponse({"detail": "no key"}, status=401)
            return view(request, *args, **kwargs)

        return inner

    return decorate


def timed(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        request.started = True
        return view(request, *args, **kwargs)

    return inner


def token_if_given(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        token = request.headers.get("Authorization")
        if token and not token.startswith("Bearer "):
            return JsonResponse({"detail": "bad token"}, status=401)
        return view(request, *args, **kwargs)

    return inner


def vendor_checked(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        vendor_verify(request)
        return view(request, *args, **kwargs)

    return inner


GUARDS = {"user": login_needed, "timed": timed}
STRICT = os.environ.get("STRICT") == "1"


def pick_guard():
    return GUARDS[os.environ.get("MODE", "user")]


DEBUG = os.environ.get("DEBUG") == "1"


def login_unless_debug(view):
    if DEBUG:
        return view
    return login_needed(view)


def hands_on(view):
    return login_needed(view)


def unless_debug(decorator):
    def apply(view):
        if DEBUG:
            return view
        return decorator(view)

    return apply


login_or_open = login_needed if not DEBUG else (lambda v: v)


def hands_on_library(view):
    from django.contrib.auth.decorators import login_required

    return login_required(view)

def login_ifexp(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    return view if DEBUG else inner


def login_rebound(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    if DEBUG:
        inner = view
    return inner
"#;

/// What a decorator of a Django view can be.
const DJANGO_DECORATORS: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from app.things import login_needed",
        "login_needed",
    ),
    thing(
        "a_repo_called",
        GUARDED,
        "from app.things import require_key",
        "require_key()",
    ),
    thing("b_repo", NO_GUARD, "from app.things import timed", "timed"),
    thing(
        "c_some",
        UNKNOWN,
        "from app.things import token_if_given",
        "token_if_given",
    ),
    thing(
        "c_unread",
        UNKNOWN,
        "from app.things import vendor_checked",
        "vendor_checked",
    ),
    thing(
        "d_login_required",
        GUARDED,
        "from django.contrib.auth.decorators import login_required",
        "login_required",
    ),
    thing(
        "d_login_required_called",
        GUARDED,
        "from django.contrib.auth.decorators import login_required",
        "login_required(login_url=\"/sign-in/\")",
    ),
    thing(
        "d_permission_required",
        GUARDED,
        "from django.contrib.auth.decorators import permission_required",
        "permission_required(\"app.view_thing\", raise_exception=True)",
    ),
    thing(
        "d_staff",
        GUARDED,
        "from django.contrib.admin.views.decorators import staff_member_required",
        "staff_member_required",
    ),
    thing(
        "e_login_required_unlisted",
        UNKNOWN,
        "from django.contrib.auth.decorators import login_required",
        "login_required(optional=True)",
    ),
    thing(
        "f_csrf_exempt",
        NO_GUARD,
        "from django.views.decorators.csrf import csrf_exempt",
        "csrf_exempt",
    ),
    thing(
        "f_cache_page",
        NO_GUARD,
        "from django.views.decorators.cache import cache_page",
        "cache_page(60)",
    ),
    thing(
        "f_never_cache",
        NO_GUARD,
        "from django.views.decorators.cache import never_cache",
        "never_cache",
    ),
    thing(
        "f_atomic",
        NO_GUARD,
        "from django.db import transaction",
        "transaction.atomic",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth import require_login",
        "require_login",
    ),
    // django-rules and django-guardian check permissions an anonymous user may be
    // given: neither is read as a sign-in guard, and neither as nothing.
    thing(
        "g_rules",
        UNKNOWN,
        "from rules.contrib.views import permission_required",
        "permission_required(\"things.view_thing\")",
    ),
    thing(
        "g_guardian",
        UNKNOWN,
        "from guardian.decorators import permission_required",
        "permission_required(\"things.view_thing\")",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from app.things import GUARDS",
        "GUARDS[\"user\"]",
    ),
    thing(
        "h_conditional",
        UNKNOWN,
        "from app.things import STRICT, login_needed, timed",
        "(login_needed if STRICT else timed)",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from app.missing import guard",
        "guard",
    ),
    thing(
        "h_factory",
        UNKNOWN,
        "from app.things import pick_guard",
        "pick_guard()",
    ),
    // Applied under a condition, decided where the decorator is applied: a
    // function that hands the view back unchanged on one branch, a factory that
    // does, one that hands back what another decorator makes of the view, and a
    // conditional value.
    thing(
        "h_debug_branch",
        UNKNOWN,
        "from app.things import login_unless_debug",
        "login_unless_debug",
    ),
    thing(
        "h_returns_call",
        UNKNOWN,
        "from app.things import hands_on",
        "hands_on",
    ),
    thing(
        "h_debug_factory",
        UNKNOWN,
        "from app.things import login_needed, unless_debug",
        "unless_debug(login_needed)",
    ),
    thing(
        "h_debug_value",
        UNKNOWN,
        "from app.things import login_or_open",
        "login_or_open",
    ),
    // The view handed back by an if-expression, or by a local bound to it under a
    // branch.
    thing(
        "h_debug_ifexp",
        UNKNOWN,
        "from app.things import login_ifexp",
        "login_ifexp",
    ),
    thing(
        "h_debug_rebound",
        UNKNOWN,
        "from app.things import login_rebound",
        "login_rebound",
    ),
    thing(
        "h_returns_library_call",
        UNKNOWN,
        "from app.things import hands_on_library",
        "hands_on_library",
    ),
];

const DJANGO_INCLUDE: &str = "    path(\"\", include(\"app.{M}\")),\n";

/// Where a decorator of a Django view is written.
const DJANGO_DECORATOR_POSITIONS: &[Position] = &[
    Position {
        id: "function",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\n{PRE}\n\n\n@{E}\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n\n\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", covered),\n    path(\"{C}/sibling\", sibling),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "alias",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\n{PRE}\n\nguard = {E}\n\n\n@guard\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n\n\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", covered),\n    path(\"{C}/sibling\", sibling),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "urlconf",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\n{PRE}\n\n\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n\n\ndef sibling(request):\n    return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", {E}(covered)),\n    path(\"{C}/sibling\", sibling),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "class",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator({E}, name=\"dispatch\")\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "method",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\nclass Covered(View):\n    @method_decorator({E})\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    // `method_decorator` for one method (`name=\"get\"` on the class, or on the
    // method): that method only. The sibling class decorates its `post`, and its
    // `get` is the sibling route.
    Position {
        id: "class_named",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator({E}, name=\"get\")\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n@method_decorator({E}, name=\"post\")\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "class_named_list",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator([{E}], name=\"get\")\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n@method_decorator([{E}], name=\"post\")\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    // `method_decorator` naming a method the class does not define, but inherits
    // (`@method_decorator(X, name="get")` on `Covered(Plain)`): Django replaces
    // `Covered.get` with `X(Plain.get)`. The route's handler is the class, whose
    // methods are its base's: which of them a request runs is not read (unknown,
    // never `no guard`). The sibling inherits the same base undecorated.
    Position {
        id: "class_named_inherited",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\nclass Plain(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n@method_decorator({E}, name=\"get\")\nclass Covered(Plain):\n    pass\n\n\nclass Sibling(Plain):\n    pass\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: Some(UNKNOWN),
        only: &[],
    },
    // A class that inherits a decorated method from its base: by name on the base's
    // class, on the base's method, or on the base's `dispatch`.
    Position {
        id: "inherits_named",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator({E}, name=\"get\")\nclass Base(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Plain(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Covered(Base):\n    pass\n\n\nclass Sibling(Plain):\n    pass\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: Some(UNKNOWN),
        only: &[],
    },
    Position {
        id: "inherits_method",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\nclass Base(View):\n    @method_decorator({E})\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Plain(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Covered(Base):\n    pass\n\n\nclass Sibling(Plain):\n    pass\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: Some(UNKNOWN),
        only: &[],
    },
    Position {
        id: "inherits_dispatch",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\n@method_decorator({E}, name=\"dispatch\")\nclass Base(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Plain(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Covered(Base):\n    pass\n\n\nclass Sibling(Plain):\n    pass\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: Some(UNKNOWN),
        only: &[],
    },
    Position {
        id: "method_other",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.utils.decorators import method_decorator\nfrom django.views import View\n{PRE}\n\n\nclass Covered(View):\n    @method_decorator({E})\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n    @method_decorator({E})\n    def post(self, request):\n        return JsonResponse({\"ok\": True})\n\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
    Position {
        id: "as_view",
        cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\n{PRE}\n\n\nclass Covered(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", {E}(Covered.as_view())),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
        main: DJANGO_INCLUDE,
        always: None,
        only: &[],
    },
];

const DJANGO_SETTINGS: &str = "SECRET_KEY = \"not-a-secret\"\nROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\n    \"django.contrib.auth\",\n    \"django.contrib.contenttypes\",\n    \"django.contrib.sessions\",\n    \"app\",\n]\nMIDDLEWARE = [\n    \"django.middleware.security.SecurityMiddleware\",\n    \"django.contrib.sessions.middleware.SessionMiddleware\",\n    \"django.middleware.common.CommonMiddleware\",\n    \"django.middleware.csrf.CsrfViewMiddleware\",\n    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n]\n";

const DJANGO_MANAGE: &str = "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n";

fn django_base() -> Files {
    files(&[
        (
            "requirements.txt",
            "django==5.0\ndjangorestframework==3.15.0\nrules==3.3\ndjango-guardian==2.4.0\n",
        ),
        ("manage.py", DJANGO_MANAGE),
        ("proj/__init__.py", ""),
        ("proj/settings.py", DJANGO_SETTINGS),
        ("app/__init__.py", ""),
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
fn a_django_decorator_is_a_guard_nothing_or_unknown_at_every_position() {
    settle(run(
        "django",
        DJANGO_DECORATOR_POSITIONS,
        DJANGO_DECORATORS,
        &django_base(),
        "app",
        &django_urls,
    ));
}

// ---------------------------------------------------------------------------------
// Django REST framework: permission classes
// ---------------------------------------------------------------------------------

const DRF_PERMISSIONS_PY: &str = r#"import os

from rest_framework.permissions import SAFE_METHODS, AllowAny, BasePermission, IsAuthenticated


class SignedIn(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class Anyone(BasePermission):
    def has_permission(self, request, view):
        return True


class ReadOnlyOrStaff(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or request.user.is_staff


PERMISSIONS = {"user": IsAuthenticated, "any": AllowAny}
STRICT = os.environ.get("STRICT") == "1"
"#;

/// What a DRF permission class can be.
const DRF_PERMISSIONS: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from app.permissions import SignedIn",
        "SignedIn",
    ),
    thing(
        "b_repo",
        NO_GUARD,
        "from app.permissions import Anyone",
        "Anyone",
    ),
    // It lets a read through for anyone: of a `GET` route its 403 is not read.
    thing(
        "c_repo_reads",
        UNKNOWN,
        "from app.permissions import ReadOnlyOrStaff",
        "ReadOnlyOrStaff",
    ),
    thing(
        "d_is_authenticated",
        GUARDED,
        "from rest_framework.permissions import IsAuthenticated",
        "IsAuthenticated",
    ),
    thing(
        "d_is_admin",
        GUARDED,
        "from rest_framework.permissions import IsAdminUser",
        "IsAdminUser",
    ),
    thing(
        "d_model_permissions",
        GUARDED,
        "from rest_framework.permissions import DjangoModelPermissions",
        "DjangoModelPermissions",
    ),
    // On a route that only reads, it opens.
    thing(
        "e_or_read_only",
        NO_GUARD,
        "from rest_framework.permissions import IsAuthenticatedOrReadOnly",
        "IsAuthenticatedOrReadOnly",
    ),
    thing(
        "f_allow_any",
        NO_GUARD,
        "from rest_framework.permissions import AllowAny",
        "AllowAny",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth.drf import RequiresLogin",
        "RequiresLogin",
    ),
    thing(
        "g_oauth_toolkit",
        UNKNOWN,
        "from oauth2_provider.contrib.rest_framework import TokenHasReadWriteScope",
        "TokenHasReadWriteScope",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from app.permissions import PERMISSIONS",
        "PERMISSIONS[\"user\"]",
    ),
    thing(
        "h_conditional",
        UNKNOWN,
        "from app.permissions import STRICT\nfrom rest_framework.permissions import AllowAny, IsAuthenticated",
        "(IsAuthenticated if STRICT else AllowAny)",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from app.missing import Permission",
        "Permission",
    ),
];

const DRF_HEAD: &str = "from django.urls import path\nfrom rest_framework import generics, viewsets\nfrom rest_framework.decorators import action, api_view, permission_classes\nfrom rest_framework.permissions import IsAuthenticated\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n{PRE}\n\n\nclass Sibling(APIView):\n    def get(self, request):\n        return Response({\"ok\": True})\n\n\n";

const DRF_URLS: &str = "\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n";

/// Where a DRF permission class is given. Each cell's module starts with
/// [`DRF_HEAD`] and ends with [`DRF_URLS`].
type DrfPosition = (&'static str, &'static str, Option<&'static str>);

const DRF_POSITIONS: &[DrfPosition] = &[
    (
        "api_view",
        "class Covered(APIView):\n    permission_classes = [{E}]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        None,
    ),
    (
        "tuple",
        "class Covered(APIView):\n    permission_classes = ({E},)\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        None,
    ),
    (
        "generic",
        "class Covered(generics.ListAPIView):\n    permission_classes = [{E}]\n    queryset = []\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        None,
    ),
    (
        "inherited",
        "class Base(APIView):\n    permission_classes = [{E}]\n\n\nclass Covered(Base):\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        None,
    ),
    (
        "overridden",
        "class Base(APIView):\n    permission_classes = [IsAuthenticated]\n\n\nclass Covered(Base):\n    permission_classes = [{E}]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        None,
    ),
    // The last assignment the module makes wins.
    (
        "reassigned",
        "class Covered(APIView):\n    permission_classes = [IsAuthenticated]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n\n\nCovered.permission_classes = [{E}]\n",
        None,
    ),
    // What `get_permissions` hands back for a request is not read.
    (
        "get_permissions",
        "class Covered(APIView):\n    def get_permissions(self):\n        return [{E}()]\n\n    def get(self, request):\n        return Response({\"ok\": True})\n",
        Some(UNKNOWN),
    ),
];

#[test]
fn a_drf_permission_class_is_a_guard_nothing_or_unknown_at_every_position() {
    let positions: Vec<(String, &DrfPosition)> = DRF_POSITIONS
        .iter()
        .map(|p| (format!("{DRF_HEAD}{}{DRF_URLS}", p.1), p))
        .collect();
    let positions: Vec<Position> = positions
        .iter()
        .map(|(cell, p)| Position {
            id: p.0,
            cell: Box::leak(cell.clone().into_boxed_str()),
            main: DJANGO_INCLUDE,
            always: p.2,
            only: &[],
        })
        .collect();
    let mut base = django_base();
    base.insert(
        "app/permissions.py".to_string(),
        DRF_PERMISSIONS_PY.to_string(),
    );
    base.insert(
        "proj/settings.py".to_string(),
        DJANGO_SETTINGS.replace("    \"app\",\n", "    \"rest_framework\",\n    \"app\",\n"),
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
// FastAPI and Starlette: middleware of the application
// ---------------------------------------------------------------------------------

const ASGI_MIDDLEWARE_PY: &str = r#"from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RequireToken(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if "authorization" not in request.headers:
            return JSONResponse({"detail": "sign in"}, status_code=401)
        return await call_next(request)


class Timing(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["x-took"] = "1"
        return response


class AdminOnly(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/admin") and "authorization" not in request.headers:
            return JSONResponse({"detail": "sign in"}, status_code=401)
        return await call_next(request)


MIDDLEWARES = [RequireToken, Timing]
"#;

/// What a middleware class of an ASGI application can be. The expression is the
/// class, with the options it is added with after it.
const ASGI_MIDDLEWARE: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from svc.middleware import RequireToken",
        "RequireToken",
    ),
    thing(
        "b_repo",
        NO_GUARD,
        "from svc.middleware import Timing",
        "Timing",
    ),
    thing(
        "c_some",
        UNKNOWN,
        "from svc.middleware import AdminOnly",
        "AdminOnly",
    ),
    thing(
        "f_cors",
        NO_GUARD,
        "from starlette.middleware.cors import CORSMiddleware",
        "CORSMiddleware, allow_origins=[\"*\"]",
    ),
    thing(
        "f_gzip",
        NO_GUARD,
        "from starlette.middleware.gzip import GZipMiddleware",
        "GZipMiddleware",
    ),
    thing(
        "f_sessions",
        NO_GUARD,
        "from starlette.middleware.sessions import SessionMiddleware",
        "SessionMiddleware, secret_key=\"not-a-secret\"",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth.asgi import AuthMiddleware",
        "AuthMiddleware",
    ),
    thing(
        "h_subscript",
        UNKNOWN,
        "from svc.middleware import MIDDLEWARES",
        "MIDDLEWARES[0]",
    ),
];

const ASGI_MIDDLEWARE_POSITIONS: &[Position] = &[
    Position {
        id: "added",
        cell: "from fastapi import FastAPI\n{PRE}\n\napp = FastAPI()\nother = FastAPI()\napp.add_middleware({E})\n\n\n@app.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "built_with",
        cell: "from fastapi import FastAPI\nfrom starlette.middleware import Middleware\n{PRE}\n\napp = FastAPI(middleware=[Middleware({E})])\nother = FastAPI()\n\n\n@app.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@other.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "",
        always: None,
        only: &[],
    },
    Position {
        id: "starlette",
        cell: "from starlette.applications import Starlette\nfrom starlette.middleware import Middleware\nfrom starlette.responses import JSONResponse\nfrom starlette.routing import Route\n{PRE}\n\n\nasync def covered(request):\n    return JSONResponse({\"ok\": True})\n\n\nasync def sibling(request):\n    return JSONResponse({\"ok\": True})\n\n\napp = Starlette(routes=[Route(\"/{C}/covered\", covered)], middleware=[Middleware({E})])\nother = Starlette(routes=[Route(\"/{C}/sibling\", sibling)])\n",
        main: "",
        always: None,
        only: &[],
    },
];

#[test]
fn a_middleware_of_an_asgi_application_is_a_guard_nothing_or_unknown() {
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
// Django: bases of a view class
// ---------------------------------------------------------------------------------

const DJANGO_MIXINS_PY: &str = r#"from company_auth.mixins import GateMixin
from django.contrib.auth.mixins import UserPassesTestMixin
from django.http import JsonResponse


class SignedInMixin:
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"detail": "sign in"}, status=401)
        return super().dispatch(request, *args, **kwargs)


class TitleMixin:
    title = "Things"


class GatedMixin(GateMixin):
    section = "things"


class EveryoneTest(UserPassesTestMixin):
    def test_func(self):
        return True


class SignedInTest(EveryoneTest):
    def test_func(self):
        return self.request.user.is_authenticated


class Audited(EveryoneTest):
    audit = True


# The order Python looks `test_func` up in: `Audited`, `SignedInTest`,
# `EveryoneTest`: the signed-in test runs, whatever a depth-first walk finds first.
class DiamondTest(Audited, SignedInTest):
    pass


# The other way round: `EveryoneTest`'s `True` runs only where nothing before it
# defines a test.
class OpenDiamond(Audited, EveryoneTest):
    pass


class SwappedTest(UserPassesTestMixin):
    def test_func(self):
        return True

    def signed_in(self):
        return self.request.user.is_authenticated

    def get_test_func(self):
        return self.signed_in
"#;

/// What a base written before the view class of a Django view can be.
const DJANGO_BASES: &[Thing] = &[
    thing(
        "a_repo",
        GUARDED,
        "from app.mixins import SignedInMixin",
        "SignedInMixin",
    ),
    thing(
        "b_repo",
        NO_GUARD,
        "from app.mixins import TitleMixin",
        "TitleMixin",
    ),
    thing(
        "d_login_required",
        GUARDED,
        "from django.contrib.auth.mixins import LoginRequiredMixin",
        "LoginRequiredMixin",
    ),
    thing(
        "d_permission_required",
        GUARDED,
        "from django.contrib.auth.mixins import PermissionRequiredMixin",
        "PermissionRequiredMixin",
    ),
    // `AccessMixin` alone says what a refusal does and refuses no one.
    thing(
        "f_access",
        NO_GUARD,
        "from django.contrib.auth.mixins import AccessMixin",
        "AccessMixin",
    ),
    thing(
        "f_messages",
        NO_GUARD,
        "from django.contrib.messages.views import SuccessMessageMixin",
        "SuccessMessageMixin",
    ),
    thing(
        "g_company",
        UNKNOWN,
        "from company_auth.mixins import GateMixin",
        "GateMixin",
    ),
    thing(
        "g_guardian",
        UNKNOWN,
        "from guardian.mixins import PermissionRequiredMixin",
        "PermissionRequiredMixin",
    ),
    // A mixin of the repository built on one of a package on no list.
    thing(
        "g_through_repo",
        UNKNOWN,
        "from app.mixins import GatedMixin",
        "GatedMixin",
    ),
    thing(
        "h_unresolved",
        UNKNOWN,
        "from app.missing import Mixin",
        "Mixin",
    ),
    // `UserPassesTestMixin`'s test by the order Python looks `test_func` up in.
    thing(
        "i_test_diamond",
        GUARDED,
        "from app.mixins import DiamondTest",
        "DiamondTest",
    ),
    thing(
        "i_test_open_diamond",
        NO_GUARD,
        "from app.mixins import OpenDiamond",
        "OpenDiamond",
    ),
    // `get_test_func` hands back another method: `test_func` is not what runs.
    thing(
        "i_test_swapped",
        UNKNOWN,
        "from app.mixins import SwappedTest",
        "SwappedTest",
    ),
];

const DJANGO_BASE_POSITIONS: &[Position] = &[Position {
    id: "base",
    cell: "from django.http import JsonResponse\nfrom django.urls import path\nfrom django.views import View\n{PRE}\n\n\nclass Covered({E}, View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nclass Sibling(View):\n    def get(self, request):\n        return JsonResponse({\"ok\": True})\n\n\nurlpatterns = [\n    path(\"{C}/covered\", Covered.as_view()),\n    path(\"{C}/sibling\", Sibling.as_view()),\n]\n",
    main: DJANGO_INCLUDE,
    always: None,
    only: &[],
}];

#[test]
fn a_base_of_a_django_view_is_a_guard_nothing_or_unknown() {
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
// A helper that hands its refusal back, and what the handler does with it
// ---------------------------------------------------------------------------------

/// How a body uses what a helper handed back, with what the route then reads where
/// the helper turns callers away only by the response it returns: the guard where
/// the body returns the value when there is one, for every request; nothing where
/// each call is a statement of its own (the value goes nowhere); unknown where what
/// the body does with it is not read. `{H}` is the call of the helper.
const HAND_BACK_USES: &[(&str, &str, &str)] = &[
    (
        "walrus",
        "    if (denied := {H}) is not None:\n        return denied\n",
        GUARDED,
    ),
    (
        "walrus_truthy",
        "    if denied := {H}:\n        return denied\n",
        GUARDED,
    ),
    (
        "assigned",
        "    denied = {H}\n    if denied:\n        return denied\n",
        GUARDED,
    ),
    (
        "assigned_not_none",
        "    denied = {H}\n    if denied is not None:\n        return denied\n",
        GUARDED,
    ),
    ("dropped", "    {H}\n", NO_GUARD),
    ("kept", "    denied = {H}\n    audit(denied)\n", UNKNOWN),
    (
        "under_branch",
        "    if STRICT:\n        denied = {H}\n        if denied:\n            return denied\n",
        UNKNOWN,
    ),
    (
        "returned_otherwise",
        "    denied = {H}\n    if denied:\n        return {\"ok\": False}\n",
        UNKNOWN,
    ),
];

/// One module per framework: the helper, then a route per use.
fn hand_back_module(head: &str, route: &dyn Fn(&str) -> String, call: &str, tail: &str) -> String {
    let mut out = head.to_string();
    for (id, body, _) in HAND_BACK_USES {
        out.push_str(&route(id));
        out.push_str(&body.replace("{H}", call));
        out.push_str(tail);
    }
    out
}

#[test]
fn a_helper_that_hands_its_refusal_back_guards_only_where_the_handler_returns_it() {
    let flask = hand_back_module(
        "import os\n\nfrom flask import Flask, jsonify, request\n\napp = Flask(__name__)\nSTRICT = os.environ.get(\"STRICT\") == \"1\"\n\n\ndef check_api_key():\n    if request.headers.get(\"X-Key\") != os.environ.get(\"KEY\"):\n        return jsonify(error=\"no key\"), 401\n    return None\n\n\ndef audit(what):\n    return what\n",
        &|id| format!("\n\n@app.get(\"/flask/{id}\")\ndef flask_{id}():\n"),
        "check_api_key()",
        "    return {\"ok\": True}\n",
    );
    let fastapi = hand_back_module(
        "import os\n\nfrom fastapi import FastAPI, Request\nfrom fastapi.responses import JSONResponse\n\napp = FastAPI()\nSTRICT = os.environ.get(\"STRICT\") == \"1\"\n\n\ndef check_api_key(request: Request):\n    if request.headers.get(\"x-key\") != os.environ.get(\"KEY\"):\n        return JSONResponse({\"detail\": \"no key\"}, status_code=401)\n    return None\n\n\ndef audit(what):\n    return what\n",
        &|id| format!("\n\n@app.get(\"/fastapi/{id}\")\ndef fastapi_{id}(request: Request):\n"),
        "check_api_key(request)",
        "    return {\"ok\": True}\n",
    );
    let django_views = hand_back_module(
        "import os\n\nfrom django.http import JsonResponse\n\nSTRICT = os.environ.get(\"STRICT\") == \"1\"\n\n\ndef check_api_key(request):\n    if request.headers.get(\"X-Key\") != os.environ.get(\"KEY\"):\n        return JsonResponse({\"detail\": \"no key\"}, status=401)\n    return None\n\n\ndef audit(what):\n    return what\n",
        &|id| format!("\n\ndef django_{id}(request):\n"),
        "check_api_key(request)",
        "    return JsonResponse({\"ok\": True})\n",
    );
    let mut urls =
        String::from("from django.urls import path\n\nfrom app import views\n\nurlpatterns = [\n");
    for (id, _, _) in HAND_BACK_USES {
        urls.push_str(&format!("    path(\"django/{id}\", views.django_{id}),\n"));
    }
    urls.push_str("]\n");
    let mut cells = Vec::new();
    let repos: Vec<(&'static str, Files)> = vec![
        (
            "flask",
            files(&[("requirements.txt", "flask==3.0.0\n"), ("app.py", &flask)]),
        ),
        (
            "fastapi",
            files(&[
                ("requirements.txt", "fastapi==0.115.0\n"),
                ("main.py", &fastapi),
            ]),
        ),
        ("django", {
            let mut f = django_base();
            f.remove("app/things.py");
            f.insert("app/views.py".to_string(), django_views);
            f.insert("proj/urls.py".to_string(), urls);
            f
        }),
    ];
    for (framework, repo) in repos {
        let said = answers(write(&repo).path());
        for (id, _, want) in HAND_BACK_USES {
            let covered = said
                .get(&format!("GET /{framework}/{id}"))
                .or_else(|| said.get(&format!("ANY /{framework}/{id}")))
                .cloned()
                .unwrap_or_else(|| "not listed".to_string());
            cells.push(Cell {
                framework: "hand_back",
                position: framework,
                thing: id,
                want,
                covered,
                sibling: NO_GUARD.to_string(),
            });
        }
    }
    settle(cells);
}

/// A handler's own body: a package's function on no list called as a statement
/// of its own may be the guard (it can only act by raising); one whose value the
/// body uses is read as any call is, and so is one of a package that never
/// authenticates.
#[test]
fn a_statement_call_of_a_package_on_no_list_in_a_handler_is_never_nothing() {
    let dir = write(&files(&[
        ("requirements.txt", "flask==3.0.0\n"),
        (
            "app.py",
            "from company_auth import check_request, load_profile\nfrom flask import Flask, g\nfrom flask_caching import Cache\n\napp = Flask(__name__)\ncache = Cache(app)\n\n\n@app.get(\"/statement\")\ndef statement():\n    check_request()\n    return {\"ok\": True}\n\n\n@app.get(\"/used\")\ndef used():\n    profile = load_profile()\n    return {\"profile\": profile}\n\n\n@app.get(\"/never\")\ndef never():\n    cache.clear()\n    g.seen = True\n    return {\"ok\": True}\n",
        ),
    ]));
    let said = answers(dir.path());
    assert_eq!(said["GET /statement"], UNKNOWN, "{said:?}");
    assert_eq!(said["GET /used"], NO_GUARD, "{said:?}");
    assert_eq!(said["GET /never"], NO_GUARD, "{said:?}");
}

// ---------------------------------------------------------------------------------
// Django: what the application object is served through
// ---------------------------------------------------------------------------------

/// `application = Gate(application)` in `wsgi.py` (or `asgi.py`) answers before any
/// view, as the wrapper of a FastAPI application does: a class of the repository
/// that is not proven to refuse, and a package's on no list, make every route of
/// the project unknown, never without a guard; a package's that registers no guard
/// (WhiteNoise) changes nothing; and a wrapper only one of two application modules
/// has is not on the way of every request.
#[test]
fn what_djangos_application_is_served_through_is_read() {
    const GATE: &str = "import os\n\n\nclass SharedSecretGate:\n    def __init__(self, app):\n        self.app = app\n\n    def __call__(self, environ, start_response):\n        if environ.get(\"HTTP_X_SECRET\") != os.environ.get(\"SECRET\"):\n            start_response(\"401 Unauthorized\", [])\n            return [b\"\"]\n        return self.app(environ, start_response)\n";
    const VIEWS: &str = "from django.http import JsonResponse\n\n\ndef plain(request):\n    return JsonResponse({\"ok\": True})\n";
    const URLS: &str = "from django.urls import path\n\nfrom app import views\n\nurlpatterns = [path(\"plain\", views.plain)]\n";
    let wsgi = |imports: &str, wrap: &str| {
        format!(
            "import os\n\nfrom django.core.wsgi import get_wsgi_application\n{imports}\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\napplication = get_wsgi_application()\n{wrap}"
        )
    };
    let asgi = "import os\n\nfrom django.core.asgi import get_asgi_application\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\napplication = get_asgi_application()\n";
    let cases: &[(&str, String, Option<&str>, &str)] = &[
        ("no wrapper", wsgi("", ""), None, NO_GUARD),
        (
            "a class of the repository",
            wsgi(
                "from app.gate import SharedSecretGate\n",
                "application = SharedSecretGate(application)\n",
            ),
            None,
            UNKNOWN,
        ),
        (
            "a package on no list",
            wsgi(
                "from company_auth.wsgi import Gate\n",
                "application = Gate(application)\n",
            ),
            None,
            UNKNOWN,
        ),
        (
            "a package that registers no guard",
            wsgi(
                "from whitenoise import WhiteNoise\n",
                "application = WhiteNoise(application)\n",
            ),
            None,
            NO_GUARD,
        ),
        (
            "one of two application modules",
            wsgi(
                "from app.gate import SharedSecretGate\n",
                "application = SharedSecretGate(application)\n",
            ),
            Some(asgi),
            UNKNOWN,
        ),
    ];
    for (what, wsgi, asgi, want) in cases {
        let mut f = django_base();
        f.remove("app/things.py");
        f.insert("app/gate.py".to_string(), GATE.to_string());
        f.insert("app/views.py".to_string(), VIEWS.to_string());
        f.insert("proj/urls.py".to_string(), URLS.to_string());
        f.insert("proj/wsgi.py".to_string(), wsgi.clone());
        if let Some(asgi) = asgi {
            f.insert("proj/asgi.py".to_string(), asgi.to_string());
        }
        let said = answers(write(&f).path());
        assert_eq!(said["ANY /plain"], *want, "{what}: {said:?}");
    }
}

// ---------------------------------------------------------------------------------
// A name is evidence of nothing
// ---------------------------------------------------------------------------------

const NAMES_PY: &str = r#"from functools import wraps

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()


def deny():
    raise HTTPException(status_code=401)


def bad(token: str) -> bool:
    return not token.startswith("Bearer ")


def require_user(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return authorization


def optional_user(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return authorization


def get_optional_user(user=Depends(require_user)):
    return user


def maybe_checked(authorization: str | None = Header(None)):
    if authorization:
        if bad(authorization):
            deny()
    return authorization


def and_named(authorization: str | None = Header(None), no_token: bool = False):
    if no_token and not authorization:
        raise HTTPException(status_code=401)
    return authorization


def two_inner(view):
    @wraps(view)
    def strict(*args, **kwargs):
        raise HTTPException(status_code=401)

    @wraps(view)
    def lenient(*args, **kwargs):
        return view(*args, **kwargs)

    return lenient


@app.get("/named-optional")
def named_optional(user=Depends(optional_user)):
    return {"ok": True}


@app.get("/soft-chain")
def soft_chain(user=Depends(get_optional_user)):
    return {"ok": True}


@app.get("/nested-deny")
def nested_deny(user=Depends(maybe_checked)):
    return {"ok": True}


@app.get("/and-named")
def and_named_route(user=Depends(and_named)):
    return {"ok": True}


@app.get("/two-inner")
@two_inner
def two_inner_route():
    return {"ok": True}


def refused_by_a_helper(authorization: str | None = Header(None)):
    if authorization is None:
        deny()
    return authorization


@app.get("/helper")
def helper_route(user=Depends(refused_by_a_helper)):
    return {"ok": True}
"#;

/// A dependency is read from its body, whatever it is called, and a refusal
/// proves a guard only on the paths of the function that runs.
///
/// - `optional_user` that raises 401 for every request without a token is the
///   guard (its name made it none of one);
/// - `get_optional_user` depends on a guard, which FastAPI runs all the same (the
///   chain stopped at the name: the route read none);
/// - `if authorization:` / `if bad(authorization): deny()` refuses no caller
///   without a token (the call of a function that never returns read as the
///   refusal of every request: known), while `if authorization is None: deny()`
///   is the guard it was;
/// - a refusal under `no_token and not authorization` is not one every caller
///   without a token meets;
/// - a decorator that defines a function that refuses and hands back another
///   that does not proves nothing (it read known).
#[test]
fn a_python_guard_is_read_from_its_body_never_from_its_name() {
    let dir = write(&files(&[
        ("requirements.txt", "fastapi==0.115.0\n"),
        ("main.py", NAMES_PY),
    ]));
    let said = answers(dir.path());
    for (route, want) in [
        ("GET /named-optional", GUARDED),
        ("GET /soft-chain", GUARDED),
        ("GET /nested-deny", UNKNOWN),
        ("GET /helper", GUARDED),
        ("GET /and-named", UNKNOWN),
        ("GET /two-inner", UNKNOWN),
    ] {
        assert_eq!(said[route], want, "{route}: {said:?}");
    }
}

// ---------------------------------------------------------------------------------
// What a repository configures outside the route: a router's options, a
// dependency replaced, Django's MIDDLEWARE
// ---------------------------------------------------------------------------------

/// A FastAPI route class that answers 401 for every request without a signature,
/// one that does nothing, and router options unpacked from a value.
const ROUTER_OPTIONS_PY: &str = r#"from fastapi import Depends, Header, HTTPException, Request
from fastapi.routing import APIRoute


class SignedRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            if "x-signature" not in request.headers:
                raise HTTPException(status_code=401)
            return await original(request)

        return handler


class TimedRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            return await original(request)

        return handler


def require_user(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    return authorization


GUARDED_OPTS = {"dependencies": [Depends(require_user)]}
TAG_OPTS = {"tags": ["x"]}
"#;

/// An option a router is built with whose effect on its routes is not read: the
/// routes it covers are unknown, whatever the option holds (a route class wraps
/// every handler; a namespace's or an API's `decorators` wrap every resource;
/// unpacked options may carry dependencies or decorators), and a router built
/// without it beside them is read as it was.
const ROUTER_OPTIONS: &[Thing] = &[
    thing(
        "route_class_refuses",
        UNKNOWN,
        "from svc.options import SignedRoute",
        "route_class=SignedRoute",
    ),
    thing(
        "route_class_nothing",
        UNKNOWN,
        "from svc.options import TimedRoute",
        "route_class=TimedRoute",
    ),
    thing(
        "route_class_package",
        UNKNOWN,
        "from vendor_routes import VendorRoute",
        "route_class=VendorRoute",
    ),
    thing(
        "decorators_guard",
        UNKNOWN,
        "from flask_login import login_required",
        "decorators=[login_required]",
    ),
    thing(
        "decorators_nothing",
        UNKNOWN,
        "\n\ndef timed(f):\n    return f\n",
        "decorators=[timed]",
    ),
    thing(
        "splat_guard",
        UNKNOWN,
        "from svc.options import GUARDED_OPTS",
        "**GUARDED_OPTS",
    ),
    thing(
        "splat_nothing",
        UNKNOWN,
        "OPTS = {\"decorators\": []}\nTAG_OPTS = {\"tags\": [\"x\"]}\n",
        "**TAG_OPTS",
    ),
];

#[test]
fn a_router_option_whose_effect_is_not_read_makes_its_routes_unknown() {
    let fastapi = [Position {
        id: "api_router",
        cell: "from fastapi import APIRouter\n{PRE}\n\nrouter = APIRouter({E})\nplain = APIRouter()\n\n\n@router.get(\"/{C}/covered\")\ndef covered():\n    return {\"ok\": True}\n\n\n@plain.get(\"/{C}/sibling\")\ndef sibling():\n    return {\"ok\": True}\n",
        main: "from svc import {M}\n\napp.include_router({M}.router)\napp.include_router({M}.plain)\n",
        always: None,
        only: &["route_class", "splat_guard"],
    }];
    let mut base = fastapi_base();
    base.insert("svc/options.py".into(), ROUTER_OPTIONS_PY.into());
    let mut cells = run(
        "fastapi",
        &fastapi,
        ROUTER_OPTIONS,
        &base,
        "svc",
        &fastapi_main,
    );
    let flask = |package: &'static str| {
        [
            Position {
                id: "api",
                cell: if package == "flask_restx" {
                    "from flask import Blueprint\nfrom flask_restx import Api, Resource\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\napi = Api(bp, {E})\nopen_bp = Blueprint(\"{C}_open\", __name__)\nopen_api = Api(open_bp)\n\n\nclass Covered(Resource):\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(Resource):\n    def get(self):\n        return {\"ok\": True}\n\n\napi.add_resource(Covered, \"/{C}/covered\")\nopen_api.add_resource(Sibling, \"/{C}/sibling\")\n"
                } else {
                    "from flask import Blueprint\nfrom flask_restful import Api, Resource\n{PRE}\n\nbp = Blueprint(\"{C}\", __name__)\napi = Api(bp, {E})\nopen_bp = Blueprint(\"{C}_open\", __name__)\nopen_api = Api(open_bp)\n\n\nclass Covered(Resource):\n    def get(self):\n        return {\"ok\": True}\n\n\nclass Sibling(Resource):\n    def get(self):\n        return {\"ok\": True}\n\n\napi.add_resource(Covered, \"/{C}/covered\")\nopen_api.add_resource(Sibling, \"/{C}/sibling\")\n"
                },
                main: "from app import {M}\n\napp.register_blueprint({M}.bp)\napp.register_blueprint({M}.open_bp)\n",
                always: None,
                only: &["decorators", "splat_nothing"],
            },
            Position {
                id: "namespace",
                cell: "from flask_restx import Namespace, Resource\n{PRE}\n\nns = Namespace(\"{C}\", {E})\nopen_ns = Namespace(\"{C}_open\")\n\n\n@ns.route(\"/covered\")\nclass Covered(Resource):\n    def get(self):\n        return {\"ok\": True}\n\n\n@open_ns.route(\"/sibling\")\nclass Sibling(Resource):\n    def get(self):\n        return {\"ok\": True}\n",
                main: "from app import {M}\n\napi.add_namespace({M}.ns, path=\"/{C}\")\napi.add_namespace({M}.open_ns, path=\"/{C}\")\n",
                always: None,
                only: if package == "flask_restx" {
                    &["decorators", "splat_nothing"]
                } else {
                    &["none"]
                },
            },
        ]
    };
    for package in ["flask_restx", "flask_restful"] {
        let base = files(&[
            (
                "requirements.txt",
                "flask==3.0.0\nflask-login==0.6.3\nflask-restx==1.3.0\nflask-restful==0.3.10\n",
            ),
            ("app/__init__.py", ""),
        ]);
        let main = |lines: &str| {
            (
                "app/main.py".to_string(),
                format!(
                    "from flask import Flask\nfrom flask_restx import Api\n\napp = Flask(__name__)\napi = Api(app)\n\n{lines}"
                ),
            )
        };
        cells.extend(run(
            package,
            &flask(package),
            ROUTER_OPTIONS,
            &base,
            "app",
            &main,
        ));
    }
    settle(cells);
}

/// What replaces a dependency in production code (`app.dependency_overrides[dep] =
/// ...`), however it is written: a route that depends on it, directly or through
/// another dependency, is unknown, never known by the body that does not run. One
/// replaced in a test changes nothing.
const OVERRIDES: &[(&str, &str, &str)] = &[
    (
        "subscript",
        "app.dependency_overrides[require_user] = anonymous\n",
        UNKNOWN,
    ),
    (
        "under_branch",
        "if os.environ.get(\"DEV\") == \"1\":\n    app.dependency_overrides[require_user] = anonymous\n",
        UNKNOWN,
    ),
    (
        "update",
        "app.dependency_overrides.update({require_user: anonymous})\n",
        UNKNOWN,
    ),
    (
        "setdefault",
        "app.dependency_overrides.setdefault(require_user, anonymous)\n",
        UNKNOWN,
    ),
    (
        "in_function",
        "\n\ndef configure(app):\n    app.dependency_overrides[require_user] = lambda: \"dev\"\n\n\nconfigure(app)\n",
        UNKNOWN,
    ),
    (
        "unread_key",
        "for dep in DEV_DEPENDENCIES:\n    app.dependency_overrides[dep] = anonymous\n",
        UNKNOWN,
    ),
    ("in_tests", "", GUARDED),
];

#[test]
fn a_dependency_replaced_in_production_code_is_never_the_guard() {
    const AUTH: &str = "from fastapi import Depends, Header, HTTPException\n\n\ndef require_user(authorization: str | None = Header(None)):\n    if not authorization:\n        raise HTTPException(status_code=401)\n    return authorization\n\n\ndef current_user(user=Depends(require_user)):\n    return user\n\n\ndef anonymous():\n    return \"anonymous\"\n\n\nDEV_DEPENDENCIES = [require_user]\n";
    let mut cells = Vec::new();
    for (how, line, want) in OVERRIDES {
        for (by, dep) in [("direct", "require_user"), ("through", "current_user")] {
            let main = format!(
                "import os\n\nfrom fastapi import Depends, FastAPI\n\nfrom svc.auth import DEV_DEPENDENCIES, anonymous, current_user, require_user\n\napp = FastAPI()\n{line}\n\n@app.get(\"/covered\")\ndef covered(user=Depends({dep})):\n    return {{\"user\": user}}\n\n\n@app.get(\"/sibling\")\ndef sibling():\n    return {{\"ok\": True}}\n"
            );
            let mut repo = files(&[
                ("requirements.txt", "fastapi==0.115.0\n"),
                ("svc/__init__.py", ""),
                ("svc/auth.py", AUTH),
                ("svc/main.py", &main),
            ]);
            if *how == "in_tests" {
                repo.insert(
                    "tests/conftest.py".into(),
                    "from svc.auth import anonymous, require_user\nfrom svc.main import app\n\napp.dependency_overrides[require_user] = anonymous\n".into(),
                );
            }
            let said = answers(write(&repo).path());
            let get = |r: &str| said.get(r).cloned().unwrap_or_else(|| "not listed".into());
            cells.push(Cell {
                framework: "fastapi_overrides",
                position: how,
                thing: by,
                want,
                covered: get("GET /covered"),
                sibling: get("GET /sibling"),
            });
        }
    }
    settle(cells);
}

/// A middleware of `MIDDLEWARE` runs before every view Django serves: a package's on
/// no list (`corp_sso.middleware.RequireEmployeeMiddleware`) may turn a caller away
/// or answer in the view's place, so every view is unknown, never without a guard,
/// however the list is built; one of a package the list says guards nothing
/// (WhiteNoise) changes nothing.
#[test]
fn a_django_middleware_of_a_package_on_no_list_is_never_nothing() {
    const BASE: &str = "SECRET_KEY = \"not-a-secret\"\nROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"django.contrib.auth\", \"django.contrib.contenttypes\", \"app\"]\nMIDDLEWARE = [\n    \"django.middleware.security.SecurityMiddleware\",\n    \"django.contrib.sessions.middleware.SessionMiddleware\",\n    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n]\n";
    // The settings files of one way of adding the middleware `m`.
    type Settings<'a> = &'a dyn Fn(&str) -> Vec<(&'static str, String)>;
    let hows: &[(&str, Settings)] = &[
        ("listed", &|m| {
            vec![(
                "proj/settings.py",
                BASE.replace(
                    "    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n",
                    &format!(
                        "    \"django.contrib.auth.middleware.AuthenticationMiddleware\",\n    \"{m}\",\n"
                    ),
                ),
            )]
        }),
        ("plus_equals", &|m| {
            vec![(
                "proj/settings.py",
                format!("{BASE}MIDDLEWARE += [\"{m}\"]\n"),
            )]
        }),
        ("append", &|m| {
            vec![(
                "proj/settings.py",
                format!("{BASE}MIDDLEWARE.append(\"{m}\")\n"),
            )]
        }),
        ("insert", &|m| {
            vec![(
                "proj/settings.py",
                format!("{BASE}MIDDLEWARE.insert(0, \"{m}\")\n"),
            )]
        }),
        ("other_module", &|m| {
            vec![
                ("proj/base.py", BASE.to_string()),
                (
                    "proj/settings.py",
                    format!(
                        "from proj.base import *  # noqa\n\nMIDDLEWARE = MIDDLEWARE + [\"{m}\"]\n"
                    ),
                ),
            ]
        }),
    ];
    let mut cells = Vec::new();
    for (how, settings) in hows {
        for (package, middleware, want) in [
            (
                "unlisted",
                "corp_sso.middleware.RequireEmployeeMiddleware",
                UNKNOWN,
            ),
            (
                "whitenoise",
                "whitenoise.middleware.WhiteNoiseMiddleware",
                NO_GUARD,
            ),
            // A middleware of the repository built on the package's: what it
            // inherits runs, and is not read.
            ("repo_on_unlisted", "app.mw.Gate", UNKNOWN),
            // One built on Django's mixin that turns no one away.
            ("repo_on_django", "app.mw.Stamp", NO_GUARD),
        ] {
            let mut repo = django_base();
            repo.remove("app/things.py");
            repo.insert(
                "requirements.txt".into(),
                "django==5.0\nwhitenoise==6.6.0\ncorp-sso==1.0\n".into(),
            );
            for (path, text) in settings(middleware) {
                repo.insert(path.into(), text);
            }
            repo.insert(
                "app/views.py".into(),
                "from django.http import JsonResponse\n\n\ndef covered(request):\n    return JsonResponse({\"ok\": True})\n".into(),
            );
            repo.insert(
                "app/mw.py".into(),
                "from corp_sso.middleware import RequireEmployeeMiddleware\nfrom django.utils.deprecation import MiddlewareMixin\n\n\nclass Gate(RequireEmployeeMiddleware):\n    exempt = [\"/health\"]\n\n\nclass Stamp(MiddlewareMixin):\n    def process_response(self, request, response):\n        response[\"X-Stamp\"] = \"1\"\n        return response\n".into(),
            );
            repo.insert(
                "proj/urls.py".into(),
                "from django.urls import path\n\nfrom app import views\n\nurlpatterns = [path(\"covered\", views.covered)]\n".into(),
            );
            let said = answers(write(&repo).path());
            cells.push(Cell {
                framework: "django_middleware",
                position: how,
                thing: package,
                want,
                covered: said
                    .get("ANY /covered")
                    .cloned()
                    .unwrap_or_else(|| "not listed".into()),
                // Every view of the project is covered.
                sibling: NO_GUARD.to_string(),
            });
        }
    }
    settle(cells);
}
