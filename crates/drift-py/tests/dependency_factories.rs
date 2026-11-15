//! A FastAPI dependency made by a factory call (`Depends(auth_dependency())`): the
//! factory's symbol names the callable it returns as a reference call
//! (`<canonical>(ref)`), so mining can read the product's rejection; the route's wrap
//! stays the factory.

use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol, WrapKind};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files.iter().find(|f| f.path == path).unwrap()
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols.iter().find(|s| s.name == name).unwrap()
}

fn refs(s: &Symbol) -> Vec<&str> {
    s.calls
        .iter()
        .map(String::as_str)
        .filter(|c| c.ends_with("(ref)"))
        .collect()
}

fn fixture(r: &Path) {
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/auth.py",
        r#"from fastapi import Header, HTTPException, Request


async def verify(request: Request, authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(401, "Not authenticated")
    return authorization


class BearerAuth:
    def __init__(self, scopes=()):
        self.scopes = scopes

    async def __call__(self, request: Request):
        if not request.headers.get("authorization"):
            raise HTTPException(401, "Not authenticated")
        return request
"#,
    );
    // Factories in another module than what they return.
    write(
        r,
        "app/deps.py",
        r#"import functools
from typing import Annotated
from fastapi import Depends
from fastapi.security import HTTPBearer
from app import auth, missing
from app.auth import BearerAuth, verify

settings = object()


def auth_ref(allow_service_key: bool = True):
    return verify


def auth_attr():
    return auth.verify


def auth_partial():
    return functools.partial(verify, scopes=["read"])


def auth_partial_opaque(f):
    return functools.partial(f)


def auth_instance():
    return BearerAuth(scopes=["read"])


def auth_class():
    return BearerAuth


def auth_soft():
    return HTTPBearer(auto_error=False)


def auth_strict():
    return HTTPBearer()


def auth_unresolved():
    return missing.verify


def get_settings():
    return settings


def auth_inner():
    async def _dep(token: str = ""):
        return token

    return _dep


def auth_local():
    fn = verify
    return fn


AuthDep = Annotated[object, Depends(auth_ref())]
"#,
    );
    write(
        r,
        "app/routes.py",
        r#"from fastapi import APIRouter, Depends
from app.deps import AuthDep, auth_instance, auth_ref

router = APIRouter()
guarded = APIRouter(dependencies=[Depends(auth_ref())])


@router.get("/alias")
async def alias(caller: AuthDep):
    return {}


@router.get("/direct")
async def direct(caller=Depends(auth_instance())):
    return {}


@guarded.get("/router")
async def routed():
    return {}
"#,
    );
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI\nfrom app.routes import guarded, router\n\napp = FastAPI()\napp.include_router(router)\napp.include_router(guarded)\n",
    );
}

#[test]
fn factories_name_what_they_return() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let deps = file(&repo, "app/deps.py");
    let cases: &[(&str, &[&str])] = &[
        ("auth_ref", &["app/auth.py#verify(ref)"]),
        ("auth_attr", &["app/auth.py#verify(ref)"]),
        ("auth_partial", &["app/auth.py#verify(ref)"]),
        ("auth_partial_opaque", &["unresolved:partial(ref)"]),
        ("auth_instance", &["app/auth.py#BearerAuth.__call__(ref)"]),
        ("auth_class", &["app/auth.py#BearerAuth.__call__(ref)"]),
        ("auth_strict", &["pkg:fastapi#security.HTTPBearer(ref)"]),
        // Built soft, a value, a nested def (its body is the factory's) and a local.
        ("auth_soft", &[]),
        ("get_settings", &[]),
        ("auth_inner", &[]),
        ("auth_local", &[]),
    ];
    for (name, want) in cases {
        assert_eq!(refs(symbol(deps, name)), *want, "{name}");
    }
    let opaque = refs(symbol(deps, "auth_unresolved"));
    assert_eq!(opaque.len(), 1, "{opaque:?}");
    assert!(
        opaque[0].starts_with("unresolved:") && opaque[0].ends_with("(ref)"),
        "{opaque:?}"
    );
    // The routes keep the factory as their wrap, in all three forms.
    let routes = file(&repo, "app/routes.py");
    for (route, factory) in [
        ("alias", "app/deps.py#auth_ref"),
        ("direct", "app/deps.py#auth_instance"),
        ("routed", "app/deps.py#auth_ref"),
    ] {
        let wraps: Vec<(WrapKind, &str)> = symbol(routes, route)
            .wraps
            .iter()
            .map(|w| (w.kind, w.wrapper.as_str()))
            .collect();
        assert_eq!(wraps, [(WrapKind::Call, factory)], "{route}");
    }
}

/// A call of an enclosing function's parameter hands control on (the view a decorator
/// wraps) only when it forwards the inner function's own parameters; a dependency
/// factory's verifier parameter, called with a value derived inside, is an ordinary
/// call, so the 401 after it turns the caller away.
#[test]
fn verifier_parameters_are_no_continuation() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "app/guards.py",
        r#"from fastapi import Header, HTTPException, Request


async def default_verify(token):
    return None


def deco(fn):
    async def w(*a, **k):
        resp = await fn(*a, **k)
        if resp is None:
            raise HTTPException(401, "Not authenticated")
        return resp

    return w


def view_deco(view):
    def inner(request, pk):
        resp = view(request, pk)
        if resp is None:
            raise HTTPException(401, "Not authenticated")
        return resp

    return inner


def auth_dependency(verifier=default_verify):
    async def _dep(request: Request, authorization: str = Header(None)):
        tok = authorization.removeprefix("Bearer ")
        caller = await verifier(tok)
        if caller is None:
            raise HTTPException(401, "Not authenticated")
        return caller

    return _dep


def auth_dependency_param(verifier=default_verify):
    async def _dep(request: Request, authorization: str = Header(None)):
        caller = await verifier(authorization)
        if caller is None:
            raise HTTPException(401, "Not authenticated")
        return caller

    return _dep
"#,
    );
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let f = file(&repo, "app/guards.py");
    let rejects = |name: &str| {
        symbol(f, name)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REJECTS_CALLER)
    };
    for name in ["deco", "view_deco"] {
        let s = symbol(f, name);
        assert!(!rejects(name), "{name}: {:?}", s.controls);
        assert!(
            s.after_continuation
                .iter()
                .any(|a| a == "pkg:fastapi#HTTPException"),
            "{name}: {:?}",
            s.after_continuation
        );
    }
    for name in ["auth_dependency", "auth_dependency_param"] {
        assert!(rejects(name), "{name}: {:?}", symbol(f, name).controls);
        assert!(symbol(f, name).after_continuation.is_empty(), "{name}");
    }
}
