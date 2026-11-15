//! Whether a body that turns callers away does so for every request (lowering 56):
//! `drift_core::controls::REJECTS_SOME` where a request that passed no refusal
//! returns, runs off the end or is handed on, `REFUSES_ALL` for a body that never
//! returns. `REJECTS_CALLER` is recorded as it was beside either.

use drift_core::controls::{REFUSES_ALL, REJECTS_CALLER, REJECTS_SOME};
use drift_py::{ScanOptions, scan};

const DEPS: &str = r#"
from django.http import JsonResponse
from fastapi import HTTPException, status
from flask import abort, g, redirect, request, session, url_for
from rest_framework.exceptions import NotAuthenticated


def early_return(authorization=None):
    if not authorization:
        return None
    user = lookup(authorization)
    if user is None:
        raise HTTPException(401)
    return user


def under_presence(authorization=None):
    user = None
    if authorization:
        user = lookup(authorization)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def presence_else(authorization=None):
    if authorization:
        user = lookup(authorization)
        if user is None:
            raise HTTPException(401)
        return user
    return None


def and_presence(authorization=None):
    if authorization and not valid(authorization):
        raise HTTPException(401)
    return authorization


def and_a_flag(authorization=None):
    if not authorization and not settings.OPEN:
        raise HTTPException(401)
    return authorization


def path_first(request, authorization=None):
    if request.url.path.startswith("/public"):
        return None
    if not authorization:
        raise HTTPException(401)
    return lookup(authorization)


def flag_then_refuse(preview=False):
    if preview:
        return None
    raise HTTPException(status_code=401)


def in_a_loop(tokens):
    for t in tokens:
        if not t:
            raise HTTPException(401)
    return tokens


def swallowed(authorization=None):
    try:
        if not authorization:
            raise HTTPException(401)
    except Exception:
        pass
    return authorization


def handler_returns(authorization=None):
    try:
        claims = decode(authorization)
    except ValueError:
        return None
    if claims is None:
        raise HTTPException(401)
    return claims


def named_class(authorization=None):
    if not authorization:
        return None
    if not valid(authorization):
        raise NotAuthenticated()
    return authorization


def decorator(view):
    def inner(*args, **kwargs):
        if not request.headers.get("Authorization"):
            return view(*args, **kwargs)
        if not valid(request.headers["Authorization"]):
            abort(401)
        return view(*args, **kwargs)

    return inner


def handed_on_first(view):
    def inner(*args, **kwargs):
        response = view(*args, **kwargs)
        if not session.get("user_id"):
            return redirect(url_for("auth.login"))
        return response

    return inner


def yields_first():
    yield
    if not session.get("user_id"):
        abort(401)


class Middleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/public"):
            return self.get_response(request)
        if not request.headers.get("Authorization"):
            return JsonResponse({"detail": "sign in"}, status=401)
        return self.get_response(request)


def strict(authorization=None):
    if not authorization:
        raise HTTPException(401)
    return lookup(authorization)


def refused_then_returns(authorization=None):
    if not authorization:
        raise HTTPException(401)
    if authorization == "internal":
        return SYSTEM
    return lookup(authorization)


def either_absent(token=None, session_id=None):
    if not token and not session_id:
        raise HTTPException(401)
    return token or session_id


def or_absent(user=None):
    if user is None or not user.active:
        raise HTTPException(401)
    return user


def elif_chain(authorization=None):
    if not authorization:
        raise HTTPException(401)
    elif authorization == "internal":
        return SYSTEM
    else:
        return lookup(authorization)


def credential_or_refused(credentials=None, api_key=None):
    if credentials is not None and credentials.scheme.lower() == "bearer":
        return resolve(credentials.credentials)
    if api_key and api_key == settings.API_KEY:
        return api_key
    if api_key and not settings.API_KEY:
        logger.error("no key configured")
    logger.warning("refused")
    raise HTTPException(status_code=401)


def nested_presence(token=None):
    if token:
        user = lookup(token)
        if user:
            return user
    raise HTTPException(401)


def else_refuses(token=None):
    if token:
        return lookup(token)
    else:
        raise HTTPException(401)


def key_in_a_loop(x_api_key=None):
    for key in KEYS:
        if compare(key, x_api_key):
            return key
    raise HTTPException(401)


def inline(token=None):
    user = lookup(token) or abort(401)
    return user


def in_a_with(token=None):
    with span("auth"):
        if not token:
            abort(401)
    return token


def proven_try(authorization=None):
    try:
        claims = decode(authorization)
    except ValueError:
        raise HTTPException(status_code=401)
    if claims.get("scope") and bad(claims):
        raise HTTPException(status_code=401)
    return claims


def answers(request):
    if not request.headers.get("Authorization"):
        return JsonResponse({"detail": "sign in"}, status=401)
    return None


def good_decorator(view):
    def inner(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)

    return inner


class Both:
    def required(self, token=None):
        if not token:
            abort(401)
        return token

    def optional(self, token=None):
        if not token:
            return None
        if not valid(token):
            abort(401)
        return token


def deny():
    raise HTTPException(status_code=401, detail="sign in first")


def deny_by_answer():
    logger.warning("refused")
    abort(401)


def nothing(authorization=None):
    if not authorization:
        return None
    return lookup(authorization)


def bad_input(limit=10):
    if limit <= 100:
        return limit
    raise ValueError("limit")
"#;

#[test]
fn a_refusal_that_not_every_request_passes_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("deps.py"), DEPS).unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "deps.py").unwrap();
    let symbol = |n: &str| {
        f.symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
    };
    let controls = |n: &str| -> Vec<&str> {
        symbol(n)
            .controls
            .iter()
            .map(String::as_str)
            .filter(|c| [REJECTS_SOME, REFUSES_ALL].contains(c))
            .collect()
    };
    for n in [
        "early_return",
        "under_presence",
        "presence_else",
        "and_presence",
        "and_a_flag",
        "path_first",
        "flag_then_refuse",
        "in_a_loop",
        "swallowed",
        "handler_returns",
        "named_class",
        "decorator",
        "handed_on_first",
        "yields_first",
        "Middleware",
    ] {
        assert_eq!(controls(n), [REJECTS_SOME], "{n}");
    }
    for n in [
        "strict",
        "refused_then_returns",
        "either_absent",
        "or_absent",
        "elif_chain",
        "credential_or_refused",
        "nested_presence",
        "else_refuses",
        "key_in_a_loop",
        "inline",
        "in_a_with",
        "proven_try",
        "answers",
        "good_decorator",
        // One method refuses every request: which one is used, the class does not say.
        "Both",
        // No refusal of a caller at all.
        "nothing",
        "bad_input",
    ] {
        assert!(controls(n).is_empty(), "{n}: {:?}", controls(n));
    }
    for n in ["deny", "deny_by_answer"] {
        assert_eq!(controls(n), [REFUSES_ALL], "{n}");
    }
    // The refusal is recorded as it was, beside what says it proves no guard: the
    // measured reading holds the one and never reads the other.
    for n in [
        "early_return",
        "under_presence",
        "decorator",
        "Middleware",
        "strict",
        "deny",
    ] {
        assert!(
            symbol(n).controls.iter().any(|c| c == REJECTS_CALLER),
            "{n}"
        );
    }
    // A method's own facts say it: a class is read by the method that runs.
    let unread = |class: &str, method: &str| -> Vec<&str> {
        symbol(class)
            .members
            .iter()
            .find(|m| m.name == method)
            .unwrap()
            .unread
            .iter()
            .map(String::as_str)
            .filter(|c| *c == REJECTS_SOME)
            .collect()
    };
    assert_eq!(unread("Middleware", "__call__"), [REJECTS_SOME]);
    assert_eq!(unread("Both", "optional"), [REJECTS_SOME]);
    assert!(unread("Both", "required").is_empty());
}
