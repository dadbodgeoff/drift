//! A body that turns its caller away as not signed in or not allowed
//! (`drift_core::controls::REJECTS_CALLER`): mining reads it to tell a guard dependency
//! (`get_current_user`) from one that opens a database session (`get_db`).

use drift_py::{ScanOptions, scan};

#[test]
fn a_body_that_turns_the_caller_away_rejects_it() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("deps.py"),
        r#"
from fastapi import HTTPException, status
from flask import abort, redirect, url_for


def get_current_user(token=None):
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad")
    if not token:
        raise exc
    return token


def require_admin(user):
    if not user.admin:
        raise HTTPException(status_code=403)


def flask_guard(user):
    if not user:
        abort(401)


def to_login(user):
    if not user:
        return redirect(url_for("auth.login"))


def get_db():
    db = object()
    try:
        yield db
    finally:
        pass


def feature_flag(enabled):
    if not enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


def not_found(x):
    if x is None:
        raise HTTPException(status_code=404, detail="Not found")


def maps_errors(call):
    try:
        return call()
    except AuthError as e:
        raise HTTPException(status_code=401, detail="Unauthorized") from e


def warns(x):
    logger.warning("Unauthorized access attempt")
    if x is None:
        raise ValueError("missing")


async def maps_response(request, call_next):
    response = await call_next(request)
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return response


async def public_or_auth(request, call_next):
    if request.url.path.startswith("/public"):
        return await call_next(request)
    if not request.session.get("user"):
        raise HTTPException(status_code=401)
    return await call_next(request)


def login_required(f):
    def inner(*args, **kwargs):
        if not current_user.is_authenticated:
            abort(401)
        return f(*args, **kwargs)
    return inner


def rate_limited(ip):
    if too_many(ip):
        raise HTTPException(status_code=429, detail="Too many requests")


def quota(user):
    if user.calls > 100:
        raise HTTPException(status_code=403, detail="Rate limit exceeded")


def feature_off():
    if not settings.beta:
        raise HTTPException(status_code=403)


def scheme():
    return OAuth2PasswordBearer(tokenUrl="token", **OPTS)
"#,
    )
    .unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "deps.py").unwrap();
    let rejects = |n: &str| {
        f.symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REJECTS_CALLER)
    };
    for n in [
        "get_current_user",
        "require_admin",
        "flask_guard",
        "to_login",
        "public_or_auth",
        "login_required",
    ] {
        assert!(rejects(n), "{n}");
    }
    for n in [
        "get_db",
        "feature_flag",
        "not_found",
        "maps_errors",
        "warns",
        // After the continuation, a rate limit, a 403 that reads no user: none
        // authenticates a caller.
        "maps_response",
        "rate_limited",
        "quota",
        "feature_off",
    ] {
        assert!(!rejects(n), "{n}");
    }
    // An unpacked `**OPTS` may pass `auto_error`: recorded as a splat.
    let scheme = f.symbols.iter().find(|s| s.name == "scheme").unwrap();
    assert!(
        scheme
            .args
            .iter()
            .any(|a| a.ends_with(&format!(":{}", drift_core::SPLAT_KEY))),
        "{:?}",
        scheme.args
    );
}

/// What a body calls, or raises, only after it hands control on to its continuation, or
/// on what the continuation handed back (`drift_core::Symbol::after_continuation`): the
/// view a decorator wraps under any name, a middleware's `call_next` or
/// `self.get_response`, a dependency's `yield`. A rejection there turns no caller away.
#[test]
fn calls_after_the_continuation_act_on_its_result() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("wrap.py"),
        r#"
from django.core.exceptions import PermissionDenied
from django.shortcuts import redirect
from fastapi import HTTPException


class AuthError(Exception):
    pass


def map_errors(r):
    return r


def ensure(request):
    return request


def audit(r):
    return r


def maps_result(target):
    def inner(*args, **kwargs):
        return map_errors(target(*args, **kwargs))
    return inner


def checks_around(target):
    def inner(request):
        ensure(request)
        response = target(request)
        ensure(request)
        audit(response)
        return response
    return inner


def rejects_after(target):
    def inner(request):
        response = target(request)
        if not request.user.is_authenticated:
            return redirect("/accounts/login/")
        return response
    return inner


def maps_error(view_func):
    def inner(request):
        try:
            return view_func(request)
        except AuthError:
            raise PermissionDenied
    return inner


def checks_unless_public(target):
    def inner(request):
        if request.path == "/public":
            return target(request)
        ensure(request)
        if not request.user.is_authenticated:
            return redirect("/accounts/login/")
        return target(request)
    return inner


async def middleware(request, call_next):
    return map_errors(await call_next(request))


class AuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        audit(response)
        return response


class KeepsView:
    def __init__(self, view):
        self.view = view

    def __call__(self, request):
        return map_errors(self.view(request))


def dependency(request):
    ensure(request)
    yield request
    audit(request)
    if not request.user:
        raise HTTPException(status_code=401)


def deferred(target):
    def inner(request):
        response = target(request)

        def finish():
            return map_errors(response)

        return finish()
    return inner


def deferred_annotated(target):
    def inner(request):
        response: object = target(request)

        def finish():
            return audit(response.status_code)

        return finish()
    return inner


def finds_user(token):
    user = next((u for u in USERS if u == token), None)
    if user is None:
        raise HTTPException(status_code=401)
    audit(user)
    return user


def runs(callback_fn):
    callback_fn()
    audit(1)
"#,
    )
    .unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "wrap.py").unwrap();
    let sym = |n: &str| {
        f.symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
    };
    let after = |n: &str| -> Vec<String> {
        sym(n)
            .after_continuation
            .iter()
            .map(|a| {
                a.rsplit_once('#')
                    .map_or(a.as_str(), |(_, x)| x)
                    .to_string()
            })
            .collect()
    };
    let rejects = |n: &str| {
        sym(n)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REJECTS_CALLER)
    };
    assert_eq!(after("maps_result"), ["map_errors"]);
    // Called before the view too: it may check the caller.
    assert_eq!(after("checks_around"), ["audit"]);
    assert!(after("rejects_after").contains(&"shortcuts.redirect".to_string()));
    assert!(!rejects("rejects_after"));
    assert_eq!(after("maps_error"), ["core.exceptions.PermissionDenied"]);
    // A branch that hands control on and leaves: what follows runs first.
    assert!(
        after("checks_unless_public").is_empty(),
        "{:?}",
        after("checks_unless_public")
    );
    assert!(rejects("checks_unless_public"));
    assert_eq!(after("middleware"), ["map_errors"]);
    assert_eq!(after("AuditMiddleware"), ["audit"]);
    assert_eq!(after("KeepsView"), ["map_errors"]);
    assert_eq!(after("dependency"), ["HTTPException", "audit"]);
    assert!(!rejects("dependency"));
    // What the continuation handed back, used in a function of its own.
    assert_eq!(after("deferred"), ["map_errors"]);
    assert_eq!(after("deferred_annotated"), ["audit"]);
    // The built-in `next(iterator)` hands control to no one.
    assert!(after("finds_user").is_empty(), "{:?}", after("finds_user"));
    assert!(rejects("finds_user"));
    // A function's own parameter is no continuation: only one an enclosing function
    // receives, or a name that says so.
    assert!(after("runs").is_empty(), "{:?}", after("runs"));
}
