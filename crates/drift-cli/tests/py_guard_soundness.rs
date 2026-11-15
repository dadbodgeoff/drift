//! Python guards, by family: where a sign-in guard or a permission class can hide,
//! each in more than one framework. `drift security` lists a route as having no
//! guard, and the practice map says authentication `none`, only where every guard in
//! reach was read and turns no one away; either says there is a guard only where it
//! covers every request of the entry point. And where a handler scopes its rows by
//! the caller in a way no check or filter records, authorization is unknown with
//! what was found, never `none`.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// A repository with these files.
fn repo(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

fn json(root: &Path, args: &[&str]) -> Value {
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

/// One concern of `drift practices --json --units`.
fn concern(root: &Path, id: &str) -> Value {
    json(root, &["practices", "--json", "--units"])["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no concern {id}"))
        .clone()
}

/// What the map says of the unit of `symbol` (`METHOD symbol` where a symbol has a
/// unit per method): its assignment, and the key it is known by or the reason it is
/// unknown.
fn said<'a>(concern: &'a Value, symbol: &str) -> (&'a str, &'a str) {
    let (method, symbol) = match symbol.split_once(' ') {
        Some((m, s)) => (Some(m), s),
        None => (None, symbol),
    };
    let u = concern["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["symbol"] == symbol && method.is_none_or(|m| u["method"] == m))
        .unwrap_or_else(|| panic!("no unit {symbol}: {:#}", concern["units"]));
    let assignment = u["assignment"].as_str().unwrap();
    let variants = concern["variants"].as_array().unwrap();
    let what = match assignment {
        "known" | "identified" => u["key"].as_str().or_else(|| {
            variants
                .iter()
                .chain(
                    variants
                        .iter()
                        .filter_map(|v| v["alternatives"].as_array())
                        .flatten(),
                )
                .find(|v| v["id"] == u["variant"])
                .and_then(|v| v["key"].as_str())
        }),
        "unknown" => u["reason"].as_str(),
        _ => None,
    };
    (assignment, what.unwrap_or_default())
}

/// How `drift security` lists the entry point of `route` (`METHOD /route` where a
/// route has one per method).
#[derive(Debug, PartialEq, Eq)]
enum Listed {
    /// Counted as guarded, by these.
    Guarded(Vec<String>),
    /// Its guard cannot be read: neither guarded nor without a guard.
    Opaque(Vec<String>),
    /// Listed under "Entry points with no guard".
    NoGuard,
}

fn listed(inventory: &Value, route: &str) -> Listed {
    let (method, route) = match route.split_once(' ') {
        Some((m, r)) => (Some(m), r),
        None => (None, route),
    };
    let e = inventory["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == route && method.is_none_or(|m| e["method"] == m))
        .unwrap_or_else(|| panic!("no entry point {route}: {:#}", inventory["entry_points"]));
    let list = |k: &str| -> Vec<String> {
        e[k].as_array()
            .map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect())
            .unwrap_or_default()
    };
    // As the inventory counts it: guarded by what is proven, whatever else of it
    // could not be read.
    let (guards, opaque) = (list("guards"), list("opaque"));
    if !guards.is_empty() {
        Listed::Guarded(guards)
    } else if !opaque.is_empty() {
        Listed::Opaque(opaque)
    } else {
        Listed::NoGuard
    }
}

fn guarded(by: &[&str]) -> Listed {
    Listed::Guarded(by.iter().map(|s| s.to_string()).collect())
}

fn opaque(what: &[&str]) -> Listed {
    Listed::Opaque(what.iter().map(|s| s.to_string()).collect())
}

/// [STRICT] The most common FastAPI guard answers 401 from the `except` handler of
/// the token's verification, and nowhere else. No fact recorded an answer made in a
/// handler, so the dependency was a wrapper, the route had "no guard" and its
/// authentication read `none`. It is a guard where the `try` is a statement every
/// request reaches and every handler ends by refusing; where that is not proven (the
/// handler answers under a branch, another handler goes on, an earlier return serves
/// some requests) it may be one: unknown, never none. A handler that goes on
/// (`return None`, `pass`) is optional identity: no guard, as before.
#[test]
fn a_fastapi_dependency_that_answers_401_in_the_handler_of_its_verification_is_a_guard() {
    let dir = repo(&[
        ("app/__init__.py", ""),
        (
            "app/deps.py",
            r#"from fastapi import Header, HTTPException, Request, status
from jose import JWTError, jwt

KEY = "k"


def current_principal(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization.removeprefix("Bearer "), KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="sign in first")
    return claims


def several_classes(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except (JWTError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return claims


def any_exception(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="sign in first")
    return claims


def bare_except(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except:
        raise HTTPException(status_code=401, detail="sign in first")
    return claims


def _deny():
    raise HTTPException(status_code=401, detail="sign in first")


def through_a_helper(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        _deny()
    return claims


async def returns_in_the_try(authorization: str = Header(default="")):
    try:
        return jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="sign in first") from exc


class Verifier:
    def __init__(self, audience: str):
        self.audience = audience

    def __call__(self, authorization: str = Header(default="")):
        try:
            return jwt.decode(authorization, KEY, audience=self.audience)
        except JWTError:
            raise HTTPException(status_code=401, detail="sign in first")


def optional_principal(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        return None
    return claims


def swallowing_principal(authorization: str = Header(default="")):
    user = None
    try:
        user = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        pass
    return user


def none_then_on(authorization: str = Header(default="")):
    try:
        user = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        user = None
    return user


def anonymous_first(authorization: str = Header(default="")):
    if not authorization:
        return None
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="sign in first")
    return claims


def only_for_writes(request: Request, authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        if request.method != "GET":
            raise HTTPException(status_code=401, detail="sign in first")
        claims = None
    return claims


def one_handler_goes_on(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except KeyError:
        raise HTTPException(status_code=401, detail="sign in first")
    except JWTError:
        claims = {}
    return claims


def swallowed_outside(authorization: str = Header(default="")):
    claims = None
    try:
        try:
            claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
        except JWTError:
            raise HTTPException(status_code=401, detail="sign in first")
    except Exception:
        pass
    return claims
"#,
        ),
        (
            "app/main.py",
            r#"from fastapi import APIRouter, Depends, FastAPI

from app import deps

app = FastAPI()
members = APIRouter(dependencies=[Depends(deps.current_principal)])
verify = deps.Verifier("api")


@app.get("/named")
def named(claims=Depends(deps.current_principal)):
    return claims


@app.get("/several")
def several(claims=Depends(deps.several_classes)):
    return claims


@app.get("/any")
def any_exception(claims=Depends(deps.any_exception)):
    return claims


@app.get("/bare")
def bare(claims=Depends(deps.bare_except)):
    return claims


@app.get("/helper")
def helper(claims=Depends(deps.through_a_helper)):
    return claims


@app.get("/returns")
def returns(claims=Depends(deps.returns_in_the_try)):
    return claims


@app.get("/instance")
def instance(claims=Depends(verify)):
    return claims


@members.get("/routed")
def routed():
    return {}


@app.get("/optional")
def optional(claims=Depends(deps.optional_principal)):
    return claims


@app.get("/swallowing")
def swallowing(claims=Depends(deps.swallowing_principal)):
    return claims


@app.get("/none-then-on")
def none_then_on(claims=Depends(deps.none_then_on)):
    return claims


@app.get("/anonymous-first")
def anonymous_first(claims=Depends(deps.anonymous_first)):
    return claims


@app.get("/only-for-writes")
def only_for_writes(claims=Depends(deps.only_for_writes)):
    return claims


@app.get("/one-handler-goes-on")
def one_handler_goes_on(claims=Depends(deps.one_handler_goes_on)):
    return claims


@app.get("/swallowed-outside")
def swallowed_outside(claims=Depends(deps.swallowed_outside)):
    return claims


app.include_router(members, prefix="/members")
"#,
        ),
    ]);
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    for (route, symbol, guard) in [
        ("/named", "named", "current_principal"),
        ("/several", "several", "several_classes"),
        ("/any", "any_exception", "any_exception"),
        ("/bare", "bare", "bare_except"),
        ("/returns", "returns", "returns_in_the_try"),
        ("/instance", "instance", "Verifier"),
        ("/members/routed", "routed", "current_principal"),
    ] {
        assert_eq!(listed(&inv, route), guarded(&[guard]), "{route}");
        assert_eq!(
            said(&authn, symbol),
            ("known", format!("dependency:app/deps.py#{guard}").as_str()),
            "{symbol}"
        );
    }
    // The helper that raises is the proof, as it was before.
    assert_eq!(listed(&inv, "/helper"), guarded(&["through_a_helper"]));
    assert_eq!(
        said(&authn, "helper"),
        ("known", "dependency:app/deps.py#_deny")
    );
    // Optional identity: the handler goes on, the route is served to anyone.
    for (route, symbol) in [
        ("/optional", "optional"),
        ("/swallowing", "swallowing"),
        ("/none-then-on", "none_then_on"),
    ] {
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
        assert_eq!(said(&authn, symbol).0, "none", "{symbol}");
    }
    // A 401 in a handler that is not proven to be for every request: it may be the
    // guard. Never a guard, never "no guard".
    for (route, symbol, dep) in [
        ("/anonymous-first", "anonymous_first", "anonymous_first"),
        ("/only-for-writes", "only_for_writes", "only_for_writes"),
        (
            "/one-handler-goes-on",
            "one_handler_goes_on",
            "one_handler_goes_on",
        ),
        (
            "/swallowed-outside",
            "swallowed_outside",
            "swallowed_outside",
        ),
    ] {
        assert_eq!(listed(&inv, route), opaque(&[dep]), "{route}");
        assert_eq!(said(&authn, symbol), ("unknown", "unresolved"), "{symbol}");
    }
}

/// [STRICT] The same guard in Flask: a decorator, a blueprint's `before_request` and
/// the application's, each answering through `abort(401)` in the handler. A hook or
/// decorator that sets the user to `None` and goes on is no guard; one that answers
/// under a branch of the handler may be; one whose `try` is around the view itself
/// answers for what the view raised, and is the wrapper it was.
#[test]
fn a_flask_decorator_or_hook_that_aborts_401_in_the_handler_is_a_guard() {
    let dir = repo(&[(
        "app.py",
        r#"from functools import wraps

from flask import Blueprint, Flask, abort, g, jsonify, request
from itsdangerous import BadSignature, URLSafeSerializer

app = Flask(__name__)
signer = URLSafeSerializer("k")
api = Blueprint("api", __name__)
pages = Blueprint("pages", __name__)


def token_required(view):
    @wraps(view)
    def inner(*args, **kwargs):
        try:
            g.user = signer.loads(request.headers.get("X-Token", ""))
        except BadSignature:
            abort(401)
        return view(*args, **kwargs)

    return inner


def token_optional(view):
    @wraps(view)
    def inner(*args, **kwargs):
        try:
            g.user = signer.loads(request.headers.get("X-Token", ""))
        except BadSignature:
            g.user = None
        return view(*args, **kwargs)

    return inner


def token_for_writes(view):
    @wraps(view)
    def inner(*args, **kwargs):
        try:
            g.user = signer.loads(request.headers.get("X-Token", ""))
        except BadSignature:
            if request.method != "GET":
                abort(401)
            g.user = None
        return view(*args, **kwargs)

    return inner


def map_errors(view):
    @wraps(view)
    def inner(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except BadSignature:
            abort(401)

    return inner


@api.before_request
def sign_in():
    try:
        g.user = signer.loads(request.headers.get("X-Token", ""))
    except BadSignature:
        abort(401)


@pages.before_request
def load_user():
    try:
        g.user = signer.loads(request.headers.get("X-Token", ""))
    except BadSignature:
        g.user = None


@app.get("/required")
@token_required
def required():
    return jsonify(user=g.user)


@app.get("/optional")
@token_optional
def optional():
    return jsonify(user=g.user)


@app.get("/for-writes")
@token_for_writes
def for_writes():
    return jsonify(user=g.user)


@app.get("/mapped")
@map_errors
def mapped():
    return jsonify(ok=True)


@api.get("/orders")
def orders():
    return jsonify(user=g.user)


@pages.get("/home")
def home():
    return jsonify(user=g.user)


app.register_blueprint(api, url_prefix="/api")
app.register_blueprint(pages, url_prefix="/pages")
"#,
    )]);
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    assert_eq!(listed(&inv, "/required"), guarded(&["token_required"]));
    assert_eq!(
        said(&authn, "required"),
        ("known", "decorator:app.py#token_required")
    );
    assert_eq!(listed(&inv, "/api/orders"), guarded(&["sign_in"]));
    assert_eq!(
        said(&authn, "orders"),
        ("known", "dependency:app.py#sign_in")
    );
    for (route, symbol) in [
        ("/optional", "optional"),
        ("/mapped", "mapped"),
        ("/pages/home", "home"),
    ] {
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
        assert_eq!(said(&authn, symbol).0, "none", "{symbol}");
    }
    assert_eq!(listed(&inv, "/for-writes"), opaque(&["token_for_writes"]));
    assert_eq!(said(&authn, "for_writes"), ("unknown", "unresolved"));

    // The application's own hook.
    let dir = repo(&[(
        "app.py",
        r#"from flask import Flask, abort, g, jsonify, request
from itsdangerous import BadSignature, URLSafeSerializer

app = Flask(__name__)
signer = URLSafeSerializer("k")


@app.before_request
def sign_in():
    try:
        g.user = signer.loads(request.headers.get("X-Token", ""))
    except BadSignature:
        abort(401)


@app.get("/orders")
def orders():
    return jsonify(user=g.user)
"#,
    )]);
    let authn = concern(dir.path(), "authn");
    assert_eq!(said(&authn, "orders"), ("known", "app_hook:app.py#sign_in"));
}

/// [STRICT] The same guard in Django: a view decorator and a middleware of
/// `MIDDLEWARE`, each returning a 401 response from the handler. Neither was read:
/// the views had "no guard".
#[test]
fn a_django_decorator_or_middleware_that_returns_401_in_the_handler_is_a_guard() {
    const MANAGE: &str = r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
"#;
    const URLS: &str = r#"from django.urls import path

from shop import views

urlpatterns = [
    path("orders/", views.orders),
    path("catalogue/", views.catalogue),
]
"#;
    let settings = |middleware: &str| {
        format!(
            r#"SECRET_KEY = "x"
ROOT_URLCONF = "shop.urls"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes"]
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"{middleware}]
"#
        )
    };
    let decorated = settings("");
    let dir = repo(&[
        ("manage.py", MANAGE),
        ("shop/__init__.py", ""),
        ("shop/settings.py", &decorated),
        ("shop/urls.py", URLS),
        (
            "shop/auth.py",
            r#"from functools import wraps

from django.core import signing
from django.http import JsonResponse


def token_required(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        try:
            request.account = signing.loads(request.headers.get("X-Token", ""))
        except signing.BadSignature:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    return inner


def token_optional(view):
    @wraps(view)
    def inner(request, *args, **kwargs):
        try:
            request.account = signing.loads(request.headers.get("X-Token", ""))
        except signing.BadSignature:
            request.account = None
        return view(request, *args, **kwargs)

    return inner
"#,
        ),
        (
            "shop/views.py",
            r#"from django.http import JsonResponse

from shop.auth import token_optional, token_required


@token_required
def orders(request):
    return JsonResponse({"account": request.account})


@token_optional
def catalogue(request):
    return JsonResponse({"account": request.account})
"#,
        ),
    ]);
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    assert_eq!(listed(&inv, "/orders"), guarded(&["token_required"]));
    assert_eq!(
        said(&authn, "orders"),
        ("known", "decorator:shop/auth.py#token_required")
    );
    assert_eq!(listed(&inv, "/catalogue"), Listed::NoGuard);
    assert_eq!(said(&authn, "catalogue").0, "none");

    const VIEWS: &str = r#"from django.http import JsonResponse


def orders(request):
    return JsonResponse({"account": request.account})


def catalogue(request):
    return JsonResponse({"account": request.account})
"#;
    let middleware = |handler: &str| {
        format!(
            r#"from django.core import signing
from django.http import JsonResponse


class TokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            request.account = signing.loads(request.headers.get("X-Token", ""))
        except signing.BadSignature:
{handler}
        return self.get_response(request)
"#
        )
    };
    let with = settings(r#", "shop.middleware.TokenMiddleware""#);
    for (handler, orders_listed, orders_said) in [
        (
            r#"            return JsonResponse({"detail": "sign in"}, status=401)"#,
            guarded(&["TokenMiddleware (settings)"]),
            ("known", "config:shop/middleware.py#TokenMiddleware"),
        ),
        (
            r#"            if request.method != "GET":
                return JsonResponse({"detail": "sign in"}, status=401)
            request.account = None"#,
            opaque(&["TokenMiddleware (settings)"]),
            ("unknown", "unresolved"),
        ),
        (
            "            request.account = None",
            Listed::NoGuard,
            ("none", ""),
        ),
    ] {
        let body = middleware(handler);
        let dir = repo(&[
            ("manage.py", MANAGE),
            ("shop/__init__.py", ""),
            ("shop/settings.py", &with),
            ("shop/urls.py", URLS),
            ("shop/middleware.py", &body),
            ("shop/views.py", VIEWS),
        ]);
        let inv = json(dir.path(), &["security", "--json"]);
        let authn = concern(dir.path(), "authn");
        assert_eq!(listed(&inv, "/orders"), orders_listed, "{handler}");
        assert_eq!(said(&authn, "orders"), orders_said, "{handler}");
    }
}

/// [STRICT] An application middleware (Starlette's `@app.middleware("http")`, a
/// `BaseHTTPMiddleware`) that returns 401 from the handler of the verification, then
/// hands the request on: the practice map read the function as unknown and the
/// class as `none`. One that sets the claims to `None` and goes on, or whose `try`
/// is around `call_next`, turns no one away.
#[test]
fn an_application_middleware_that_returns_401_in_the_handler_signs_the_caller_in() {
    let function = r#"from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt

app = FastAPI()


@app.middleware("http")
async def sign_in(request: Request, call_next):
    try:
        request.state.claims = jwt.decode(request.headers.get("authorization", ""), "k")
    except JWTError:
        return JSONResponse({"detail": "sign in first"}, status_code=401)
    return await call_next(request)


@app.get("/orders")
def orders(request: Request):
    return request.state.claims
"#;
    let class = |dispatch: &str| {
        format!(
            r#"from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware

app = FastAPI()


class SignIn(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
{dispatch}


app.add_middleware(SignIn)


@app.get("/orders")
def orders(request: Request):
    return request.state.claims
"#
        )
    };
    let strict = class(
        r#"        try:
            request.state.claims = jwt.decode(request.headers.get("authorization", ""), "k")
        except JWTError:
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)"#,
    );
    let optional = class(
        r#"        try:
            request.state.claims = jwt.decode(request.headers.get("authorization", ""), "k")
        except JWTError:
            request.state.claims = None
        return await call_next(request)"#,
    );
    let mapper = class(
        r#"        try:
            return await call_next(request)
        except JWTError:
            return JSONResponse({"detail": "sign in first"}, status_code=401)"#,
    );
    for (main, want) in [
        (function, ("known", "middleware:app/main.py#sign_in")),
        (strict.as_str(), ("known", "middleware:app/main.py#SignIn")),
        (optional.as_str(), ("none", "")),
        (mapper.as_str(), ("none", "")),
    ] {
        let dir = repo(&[("app/__init__.py", ""), ("app/main.py", main)]);
        assert_eq!(
            said(&concern(dir.path(), "authn"), "orders"),
            want,
            "{main}"
        );
    }
}

const DRF_MANAGE: &str = r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "depot.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
"#;

/// A DRF project `depot` with the app `shipments`: its settings' default permission
/// class, its permission classes, its views and its URLconf.
fn drf(default: &str, permissions: &str, views: &str, urls: &str) -> tempfile::TempDir {
    let settings = format!(
        r#"SECRET_KEY = "x"
ROOT_URLCONF = "depot.urls"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "rest_framework", "shipments"]
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]
REST_FRAMEWORK = {{
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.{default}"],
}}
"#
    );
    repo(&[
        ("manage.py", DRF_MANAGE),
        ("depot/__init__.py", ""),
        ("depot/settings.py", &settings),
        (
            "depot/urls.py",
            r#"from django.urls import include, path

urlpatterns = [path("api/", include("shipments.urls"))]
"#,
        ),
        ("shipments/__init__.py", ""),
        (
            "shipments/models.py",
            r#"from django.db import models


class Shipment(models.Model):
    depot_id = models.IntegerField()
    label = models.CharField(max_length=40)
"#,
        ),
        (
            "shipments/serializers.py",
            r#"from rest_framework import serializers

from shipments.models import Shipment


class ShipmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shipment
        fields = ["id", "depot_id", "label"]
"#,
        ),
        ("shipments/permissions.py", permissions),
        ("shipments/views.py", views),
        ("shipments/urls.py", urls),
    ])
}

/// [STRICT] `IsAuthenticatedOrReadOnly` and `DjangoModelPermissionsOrAnonReadOnly`
/// let `GET`, `HEAD` and `OPTIONS` through for a caller who is not signed in. As the
/// settings' default or on the view they were the guard of every method: a `GET`
/// read `known config:permissions.IsAuthenticatedOrReadOnly` and was counted as
/// guarded. They open a read, guard a write, and of an entry point listed for every
/// method (a `ModelViewSet` on a router, a generic view) they do neither: unknown.
/// A class of the repository built on one that changes nothing is read the same; one
/// that defines `has_permission` is read from that body
/// (`a_permission_class_of_the_repository_is_read_from_its_body`). `AllowAny` and an
/// explicit empty list under the default open the view, as before.
#[test]
fn a_drf_permission_class_that_lets_reads_through_is_no_guard_of_a_read() {
    let dir = drf(
        "IsAuthenticatedOrReadOnly",
        r#"from rest_framework.permissions import IsAuthenticatedOrReadOnly


class StaffOrReadOnly(IsAuthenticatedOrReadOnly):
    message = "staff only"


class DecidesItself(IsAuthenticatedOrReadOnly):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)
"#,
        r#"from rest_framework import generics, permissions, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from shipments.models import Shipment
from shipments.permissions import DecidesItself, StaffOrReadOnly
from shipments.serializers import ShipmentSerializer


class ShipmentViewSet(viewsets.ModelViewSet):
    queryset = Shipment.objects.all()
    serializer_class = ShipmentSerializer


class ModelPermList(generics.ListCreateAPIView):
    permission_classes = [permissions.DjangoModelPermissionsOrAnonReadOnly]
    queryset = Shipment.objects.all()
    serializer_class = ShipmentSerializer


class ModelPermView(APIView):
    permission_classes = [permissions.DjangoModelPermissionsOrAnonReadOnly]
    queryset = Shipment.objects.all()

    def get(self, request):
        return Response({})

    def put(self, request):
        return Response({})


class SubclassView(APIView):
    permission_classes = [StaffOrReadOnly]

    def get(self, request):
        return Response({})

    def post(self, request):
        return Response({})


class DecidesView(APIView):
    permission_classes = [DecidesItself]

    def get(self, request):
        return Response({})


class WithAdmin(APIView):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, permissions.IsAdminUser]

    def get(self, request):
        return Response({})


class StrictView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({})


class AnyoneView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response({})


class EmptyTuple(APIView):
    permission_classes = ()

    def post(self, request):
        return Response({})


class EmptyList(APIView):
    permission_classes = []

    def post(self, request):
        return Response({})


@api_view(["GET", "HEAD", "POST"])
def summary(request):
    return Response({})


@api_view(["OPTIONS", "DELETE"])
@permission_classes([permissions.IsAuthenticatedOrReadOnly])
def purge(request):
    return Response({})
"#,
        r#"from django.urls import path
from rest_framework.routers import DefaultRouter

from shipments import views

router = DefaultRouter()
router.register("shipments", views.ShipmentViewSet)

urlpatterns = [
    path("model-perm-list/", views.ModelPermList.as_view()),
    path("model-perm/", views.ModelPermView.as_view()),
    path("subclass/", views.SubclassView.as_view()),
    path("decides/", views.DecidesView.as_view()),
    path("with-admin/", views.WithAdmin.as_view()),
    path("strict/", views.StrictView.as_view()),
    path("anyone/", views.AnyoneView.as_view()),
    path("empty-tuple/", views.EmptyTuple.as_view()),
    path("empty-list/", views.EmptyList.as_view()),
    path("summary/", views.summary),
    path("purge/", views.purge),
] + router.urls
"#,
    );
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    const DEFAULT: &str = "pkg:rest_framework#permissions.IsAuthenticatedOrReadOnly";
    const MODEL: &str = "pkg:rest_framework#permissions.DjangoModelPermissionsOrAnonReadOnly";
    let opens = |class: &str| {
        format!("identifies:pkg:rest_framework#authentication.SessionAuthentication+opens:{class}")
    };
    // A read: opened, by the class that lets it through. Never a guard.
    for (route, unit, class) in [
        ("GET /api/summary", "GET summary", DEFAULT),
        ("HEAD /api/summary", "HEAD summary", DEFAULT),
        ("OPTIONS /api/purge", "OPTIONS purge", DEFAULT),
        ("GET /api/model-perm", "GET ModelPermView.get", MODEL),
        (
            "GET /api/subclass",
            "GET SubclassView.get",
            "shipments/permissions.py#StaffOrReadOnly",
        ),
    ] {
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
        assert_eq!(
            said(&authn, unit),
            ("known", opens(class).as_str()),
            "{unit}"
        );
    }
    // A write: the class is its guard, as it was.
    for (route, unit, guard, key) in [
        (
            "POST /api/summary",
            "POST summary",
            "permissions.IsAuthenticatedOrReadOnly (settings)",
            format!("config:{DEFAULT}"),
        ),
        (
            "DELETE /api/purge",
            "DELETE purge",
            "permissions.IsAuthenticatedOrReadOnly",
            format!("dependency:{DEFAULT}"),
        ),
        (
            "PUT /api/model-perm",
            "PUT ModelPermView.put",
            "permissions.DjangoModelPermissionsOrAnonReadOnly",
            format!("dependency:{MODEL}"),
        ),
        (
            "POST /api/subclass",
            "POST SubclassView.post",
            "StaffOrReadOnly",
            format!("dependency:{DEFAULT}"),
        ),
    ] {
        assert_eq!(listed(&inv, route), guarded(&[guard]), "{route}");
        assert_eq!(said(&authn, unit), ("known", key.as_str()), "{unit}");
    }
    // Listed for every method: the reads are open and the writes guarded, and the
    // entry point is not either.
    for (route, unit, class) in [
        (
            "/api/shipments",
            "ShipmentViewSet",
            "permissions.IsAuthenticatedOrReadOnly (settings)",
        ),
        (
            "/api/model-perm-list",
            "ModelPermList",
            "permissions.DjangoModelPermissionsOrAnonReadOnly",
        ),
    ] {
        assert_eq!(listed(&inv, route), opaque(&[class]), "{route}");
        assert_eq!(said(&authn, unit), ("unknown", "unresolved"), "{unit}");
    }
    // A class of the repository that decides for itself is read from its own
    // `has_permission`, which replaces the library's: `bool(request.user and
    // request.user.is_authenticated)` refuses every caller who is not signed in,
    // whatever the method (it was not read, and unknown, before such a body was).
    assert_eq!(listed(&inv, "/api/decides"), guarded(&["DecidesItself"]));
    assert_eq!(
        said(&authn, "DecidesView.get"),
        ("known", "dependency:shipments/permissions.py#DecidesItself")
    );
    // Beside a class that guards every method, the read is guarded by that one.
    assert_eq!(
        listed(&inv, "/api/with-admin"),
        guarded(&["permissions.IsAdminUser"])
    );
    assert_eq!(said(&authn, "WithAdmin.get").0, "known");
    assert_eq!(
        listed(&inv, "/api/strict"),
        guarded(&["permissions.IsAuthenticated"])
    );
    // Opened on the view, under a default that guards writes: `AllowAny` is known
    // (`opens`); an empty list leaves the settings' authentication, which identifies
    // the caller and turns no one away: identified, not known.
    for (route, unit, state) in [
        ("/api/anyone", "AnyoneView.post", "known"),
        ("/api/empty-tuple", "EmptyTuple.post", "identified"),
        ("/api/empty-list", "EmptyList.post", "identified"),
    ] {
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
        let (assignment, key) = said(&authn, unit);
        assert_eq!(assignment, state, "{unit}");
        assert!(
            !key.contains("config:") && !key.contains("dependency:"),
            "{unit}: {key}"
        );
    }
}

/// [STRICT] The permission classes of a DRF view that are no list of classes
/// written in place: a tuple built by concatenation (`BASE + (IsAdminUser,)`), a
/// name, classes combined with `|`, a `get_permissions` that tests anything but the
/// request's method or the view's action (one that tests only those is read handler
/// by handler: `drf_get_permissions.rs`), an action's own
/// (`@action(permission_classes=[AllowAny])`). None was read: the view
/// got the settings' default (`known config:permissions.IsAuthenticated`), the
/// class's list where `get_permissions` or the action replaces it, or, for the
/// combined classes, an empty list ("no guard"). Each is unknown; a view that binds
/// a list of classes over such a base, and one that binds nothing, are read as before.
#[test]
fn drf_permission_classes_that_are_not_a_list_written_in_place_are_unknown() {
    let dir = drf(
        "IsAuthenticated",
        r#"from rest_framework import permissions

BASE = (permissions.IsAuthenticated,)
"#,
        r#"from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from shipments.models import Shipment
from shipments.permissions import BASE
from shipments.serializers import ShipmentSerializer

NAMED = [permissions.AllowAny]


class ConcatView(APIView):
    permission_classes = BASE + (permissions.IsAdminUser,)

    def get(self, request):
        return Response({})


class NamedView(APIView):
    permission_classes = NAMED

    def get(self, request):
        return Response({})


class EitherView(APIView):
    permission_classes = [permissions.IsAuthenticated | permissions.AllowAny]

    def get(self, request):
        return Response({})


class DynamicViewSet(viewsets.ModelViewSet):
    queryset = Shipment.objects.all()
    serializer_class = ShipmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action == "list" and self.request.query_params.get("preview"):
            return [permissions.AllowAny()]
        return super().get_permissions()

    def list(self, request):
        return Response([])

    def create(self, request):
        return Response({})


class ActionViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        return Response([])

    @action(detail=False, methods=["post"], permission_classes=[permissions.AllowAny])
    def signup(self, request):
        return Response({})


class ChildOfConcat(ConcatView):
    def post(self, request):
        return Response({})


class OwnListOverConcat(ConcatView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        return Response({})


class DefaultView(APIView):
    def get(self, request):
        return Response({})


@api_view(["GET"])
@permission_classes(NAMED)
def by_name(request):
    return Response({})
"#,
        r#"from django.urls import path
from rest_framework.routers import DefaultRouter

from shipments import views

router = DefaultRouter()
router.register("dynamic", views.DynamicViewSet)
router.register("actions", views.ActionViewSet, basename="actions")

urlpatterns = [
    path("concat/", views.ConcatView.as_view()),
    path("named/", views.NamedView.as_view()),
    path("either/", views.EitherView.as_view()),
    path("child/", views.ChildOfConcat.as_view()),
    path("own-list/", views.OwnListOverConcat.as_view()),
    path("default/", views.DefaultView.as_view()),
    path("by-name/", views.by_name),
] + router.urls
"#,
    );
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    for (route, unit, how) in [
        ("/api/concat", "ConcatView.get", "permission_classes = ..."),
        ("/api/named", "NamedView.get", "permission_classes = NAMED"),
        ("/api/either", "EitherView.get", "permission_classes = ..."),
        ("/api/by-name", "by_name", "permission_classes = NAMED"),
        (
            "GET /api/dynamic",
            "DynamicViewSet.list",
            "get_permissions()",
        ),
        (
            "POST /api/dynamic",
            "DynamicViewSet.create",
            "get_permissions()",
        ),
        (
            "POST /api/actions",
            "ActionViewSet.signup",
            "action(permission_classes=...)",
        ),
        (
            "POST /api/child",
            "ChildOfConcat.post",
            "permission_classes = ...",
        ),
    ] {
        assert_eq!(
            listed(&inv, route),
            opaque(&[&format!("unresolved:{how}")]),
            "{route}"
        );
        assert_eq!(said(&authn, unit), ("unknown", "unresolved"), "{unit}");
    }
    const STRICT: &str = "pkg:rest_framework#permissions.IsAuthenticated";
    for (route, unit, guard, key) in [
        (
            "GET /api/actions",
            "ActionViewSet.list",
            "permissions.IsAuthenticated",
            format!("dependency:{STRICT}"),
        ),
        (
            "PUT /api/own-list",
            "OwnListOverConcat.put",
            "permissions.IsAuthenticated",
            format!("dependency:{STRICT}"),
        ),
        (
            "/api/default",
            "DefaultView.get",
            "permissions.IsAuthenticated (settings)",
            format!("config:{STRICT}"),
        ),
    ] {
        assert_eq!(listed(&inv, route), guarded(&[guard]), "{route}");
        assert_eq!(said(&authn, unit), ("known", key.as_str()), "{unit}");
    }
}

/// The instruments of the units of `concern` that are unknown, with how many units.
fn unknown_instruments(concern: &Value) -> Vec<(String, u64)> {
    concern["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                i["instrument"].as_str().unwrap().to_string(),
                i["members"].as_u64().unwrap(),
            )
        })
        .collect()
}

/// [STRICT] A Django handler that scopes its rows by the caller where the key has
/// no tenant's name and no filter records it: a custom queryset or manager method
/// given the caller (`Shipment.objects.visible_to(request.user.staff)`), a
/// relationship of the caller in a generic view's `get_queryset`
/// (`self.request.user.depot.shipments.all()`), and rows dropped in a loop
/// (`if s.depot_id != request.user.staff.depot_id: continue`). Each read `none`.
/// Each is unknown, with the callee or `scope_unread` named; the same handlers
/// without the caller's value still read `none`.
#[test]
fn a_django_handler_that_scopes_by_the_caller_is_never_none() {
    let dir = drf(
        "IsAuthenticated",
        "",
        r#"from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from shipments.models import Shipment
from shipments.serializers import ShipmentSerializer


class QuerySetMethod(APIView):
    def get(self, request):
        rows = Shipment.objects.visible_to(request.user.staff)
        return Response(ShipmentSerializer(rows, many=True).data)


class ManagerMethod(APIView):
    def get(self, request):
        rows = Shipment.scoped.for_staff(request.user.staff)
        return Response(ShipmentSerializer(rows, many=True).data)


@login_required
def plain_queryset_method(request):
    rows = Shipment.objects.visible_to(request.user.staff)
    return JsonResponse({"rows": [r.label for r in rows]})


class RelationList(generics.ListAPIView):
    serializer_class = ShipmentSerializer

    def get_queryset(self):
        return self.request.user.depot.shipments.all()


class RelationDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ShipmentSerializer

    def get_queryset(self):
        return self.request.user.shipments.filter(label__startswith="A")


class ContinueFilter(APIView):
    def get(self, request):
        out = []
        for s in Shipment.objects.all():
            if s.depot_id != request.user.staff.depot_id:
                continue
            out.append(s.label)
        return Response(out)


@login_required
def plain_continue(request):
    out = []
    for s in list(Shipment.objects.all()):
        if s.depot_id != request.user.depot_id:
            continue
        out.append(s.label)
    return JsonResponse({"rows": out})


class LabelledBy(APIView):
    def get(self, request):
        rows = Shipment.scoped.labelled(request.GET["label"])
        return Response(ShipmentSerializer(rows, many=True).data)


class Everything(APIView):
    def get(self, request):
        return Response(ShipmentSerializer(Shipment.objects.all(), many=True).data)


class PlainList(generics.ListAPIView):
    serializer_class = ShipmentSerializer
    queryset = Shipment.objects.all()


class Greeting(APIView):
    def get(self, request):
        return Response({"name": request.user.username.title()})
"#,
        r#"from django.urls import path

from shipments import views

urlpatterns = [
    path("qs-method/", views.QuerySetMethod.as_view()),
    path("manager-method/", views.ManagerMethod.as_view()),
    path("plain-qs-method/", views.plain_queryset_method),
    path("relation/", views.RelationList.as_view()),
    path("relation/<int:pk>/", views.RelationDetail.as_view()),
    path("continue/", views.ContinueFilter.as_view()),
    path("plain-continue/", views.plain_continue),
    path("labelled/", views.LabelledBy.as_view()),
    path("everything/", views.Everything.as_view()),
    path("plain-list/", views.PlainList.as_view()),
    path("greeting/", views.Greeting.as_view()),
]
"#,
    );
    std::fs::write(
        dir.path().join("shipments/models.py"),
        r#"from django.conf import settings
from django.db import models


class Depot(models.Model):
    name = models.CharField(max_length=40)


class Staff(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    depot = models.ForeignKey(Depot, related_name="staff", on_delete=models.CASCADE)


class ShipmentQuerySet(models.QuerySet):
    def visible_to(self, staff):
        return self.filter(depot_id=staff.depot_id)


class ShipmentManager(models.Manager):
    def for_staff(self, staff):
        return self.get_queryset().filter(depot_id=staff.depot_id)

    def labelled(self, label):
        return self.get_queryset().filter(label=label)


class Shipment(models.Model):
    depot = models.ForeignKey(Depot, related_name="shipments", on_delete=models.CASCADE)
    label = models.CharField(max_length=40)

    objects = ShipmentQuerySet.as_manager()
    scoped = ShipmentManager()
"#,
    )
    .unwrap();
    let authz = concern(dir.path(), "authz");
    for unit in [
        "QuerySetMethod.get",
        "ManagerMethod.get",
        "plain_queryset_method",
        "RelationList",
        "RelationDetail",
        "ContinueFilter.get",
        "plain_continue",
    ] {
        assert_eq!(said(&authz, unit), ("unknown", "unclassified"), "{unit}");
    }
    assert_eq!(
        unknown_instruments(&authz),
        [
            ("scope_unread".to_string(), 4),
            (
                "shipments/models.py#Shipment.objects.visible_to".to_string(),
                2
            ),
            (
                "shipments/models.py#Shipment.scoped.for_staff".to_string(),
                1
            ),
        ]
    );
    // Nothing of the caller goes into what these read.
    for unit in [
        "LabelledBy.get",
        "Everything.get",
        "PlainList",
        "Greeting.get",
    ] {
        assert_eq!(said(&authz, unit).0, "none", "{unit}");
    }
}

/// [STRICT] The same in Flask and FastAPI, with a loader that returns `None` unless
/// the row is the caller's tenant's (`row = load(event_id, g.user.venue_id) or
/// abort(404)`, the conditional-expression spelling, a 404 raised on `None`), a
/// relationship of the caller read as an attribute (`g.user.venue.events`), a
/// repository method given the principal, and rows dropped in a loop or a
/// comprehension. The loader's comparison refuses no one itself, so no check
/// recorded it and the routes read `none`. A value of a dependency that signs no one
/// in (`Depends(get_db)`) is no value of the caller.
#[test]
fn a_loader_given_the_callers_tenant_is_never_none() {
    let dir = repo(&[(
        "app.py",
        r#"from flask import Flask, abort, g, jsonify, request
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
db = SQLAlchemy(app)


class Venue(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    events = db.relationship("Event", backref="venue")


class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venue.id"))
    title = db.Column(db.String(80))


@app.before_request
def sign_in():
    g.user = db.session.get(Venue, request.headers.get("X-Token"))
    if g.user is None:
        abort(401)


def load(event_id, venue_id):
    row = db.session.get(Event, event_id)
    if row is None or row.venue_id != venue_id:
        return None
    return row


def load_any(event_id):
    return db.session.get(Event, event_id)


@app.get("/events/<int:event_id>")
def loader_or_abort(event_id):
    row = load(event_id, g.user.venue_id) or abort(404)
    return jsonify(title=row.title)


@app.get("/events/<int:event_id>/title")
def loader_conditional(event_id):
    row = load(event_id, g.user.venue_id)
    return jsonify(title=row.title) if row else abort(404)


@app.get("/mine")
def relationship():
    return jsonify([e.title for e in g.user.venue.events])


@app.get("/filtered")
def continue_filter():
    out = []
    for e in Event.query.all():
        if e.venue_id != g.user.venue_id:
            continue
        out.append(e.title)
    return jsonify(out)


@app.get("/comprehension")
def comprehension():
    return jsonify([e.title for e in Event.query.all() if e.venue_id == g.user.venue_id])


@app.get("/any/<int:event_id>")
def unscoped(event_id):
    row = load_any(event_id) or abort(404)
    return jsonify(title=row.title)


@app.get("/all")
def everything():
    return jsonify([e.title for e in Event.query.all()])


@app.get("/whoami")
def whoami():
    return jsonify(name=g.user.name)
"#,
    )]);
    let authz = concern(dir.path(), "authz");
    for unit in [
        "loader_or_abort",
        "loader_conditional",
        "relationship",
        "continue_filter",
        "comprehension",
    ] {
        assert_eq!(said(&authz, unit), ("unknown", "unclassified"), "{unit}");
    }
    assert_eq!(
        unknown_instruments(&authz),
        [
            ("scope_unread".to_string(), 3),
            ("app.py#load".to_string(), 2)
        ]
    );
    for unit in ["unscoped", "everything", "whoami"] {
        assert_eq!(said(&authz, unit).0, "none", "{unit}");
    }

    let dir = repo(&[
        ("app/__init__.py", ""),
        (
            "app/db.py",
            r#"from sqlalchemy import Column, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()
engine = create_engine("sqlite://")
SessionLocal = sessionmaker(bind=engine)


class Shipment(Base):
    __tablename__ = "shipments"
    id = Column(Integer, primary_key=True)
    depot_id = Column(String)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
"#,
        ),
        (
            "app/main.py",
            r#"from dataclasses import dataclass

from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import Shipment, get_db

app = FastAPI()


@dataclass
class Principal:
    id: str
    depot_id: str


def current_principal(authorization: str = Header(default="")) -> Principal:
    if not authorization:
        raise HTTPException(status_code=401, detail="sign in first")
    return Principal(id=authorization, depot_id="d1")


def load(db: Session, shipment_id: int, depot_id: str):
    row = db.get(Shipment, shipment_id)
    return row if row is not None and row.depot_id == depot_id else None


class ShipmentRepo:
    def __init__(self, db: Session):
        self.db = db

    def visible_to(self, principal: Principal):
        return self.db.query(Shipment).filter(Shipment.depot_id == principal.depot_id).all()

    def everything(self):
        return self.db.query(Shipment).all()


@app.get("/shipments/{shipment_id}")
def loader(
    shipment_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(current_principal),
):
    row = load(db, shipment_id, principal.depot_id)
    if row is None:
        raise HTTPException(status_code=404)
    return row


@app.get("/shipments")
def repo_method(db: Session = Depends(get_db), principal: Principal = Depends(current_principal)):
    return ShipmentRepo(db).visible_to(principal)


@app.get("/filtered")
def continue_filter(
    db: Session = Depends(get_db), principal: Principal = Depends(current_principal)
):
    out = []
    for s in db.query(Shipment).all():
        if s.depot_id != principal.depot_id:
            continue
        out.append(s)
    return out


@app.get("/all")
def everything(db: Session = Depends(get_db), principal: Principal = Depends(current_principal)):
    return ShipmentRepo(db).everything()


@app.get("/me")
def me(principal: Principal = Depends(current_principal)):
    return {"id": principal.id}
"#,
        ),
    ]);
    let authz = concern(dir.path(), "authz");
    for unit in ["loader", "repo_method", "continue_filter"] {
        assert_eq!(said(&authz, unit), ("unknown", "unclassified"), "{unit}");
    }
    for unit in ["everything", "me"] {
        assert_eq!(said(&authz, unit).0, "none", "{unit}");
    }
}

/// One handler per source and use, appended to `module`: `head` with `<F>` for the
/// handler's name is its decorators and signature, `uses` are bodies with `<S>`
/// where the value goes, `sources` are a name, a statement the body runs first and
/// the expression. Returns the handlers' names.
fn source_by_use(
    module: &mut String,
    head: &dyn Fn(&str) -> String,
    sources: &[(&str, &str, &str)],
    uses: &[(&str, &str)],
) -> Vec<String> {
    let mut names = Vec::new();
    for (source, first, value) in sources {
        for (usage, body) in uses {
            let name = format!("{source}__{usage}");
            let first = match first.is_empty() {
                true => String::new(),
                false => format!("    {first}\n"),
            };
            module.push_str(&format!(
                "\n\n{}{first}{}",
                head(&name).replace("<F>", &name),
                body.replace("<S>", value)
            ));
            names.push(name);
        }
    }
    names
}

/// [STRICT] A value of the caller, whatever it is read off: a claims accessor
/// (`get_jwt()["venue_id"]`, `get_jwt().get(...)`, `get_jwt_identity()`), what a
/// request-scoped holder keeps (`g.principal`, `request.state.claims`,
/// `request.scope["user"]`), the request's own (`request.user`, `request.auth`,
/// `request.session[...]`, also where the request is a typed parameter), what a
/// dependency that signs the caller in gives, and a local assigned from any of
/// these. Only a path with a name that says a subject (`g.user`, `current_user`,
/// `session[...]`) was one: with any other source a route that hands the caller's
/// tenant to a loader, compares it with the row's or filters by it read
/// authorization `none`. Each source is read in each use: handed on (first, last,
/// by keyword), compared before a refusal (a 404, and an exit no check reads),
/// compared to drop rows, and as a filter value. Unknown with what was found;
/// never `none`, never known by this. The same handlers without the caller's value
/// read `none`.
#[test]
fn a_value_of_the_caller_from_any_source_is_never_none() {
    // The route of the report, and its sibling that scopes nothing.
    let dir = repo(&[(
        "app.py",
        r#"from flask import Blueprint, Flask, abort, jsonify
from flask_jwt_extended import JWTManager, get_jwt, jwt_required
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
db = SQLAlchemy(app)
jwt = JWTManager(app)
bp = Blueprint("reservations", __name__, url_prefix="/reservations")


class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer)
    guest_name = db.Column(db.String(80))


def reservation_for(venue_id, reservation_id):
    found = db.session.get(Reservation, reservation_id)
    return found if found is not None and found.venue_id == venue_id else None


@bp.get("/<int:reservation_id>")
@jwt_required()
def show_reservation(reservation_id):
    reservation = reservation_for(get_jwt()["venue_id"], reservation_id) or abort(404)
    return jsonify(id=reservation.id, guest=reservation.guest_name)


@bp.get("/any/<int:reservation_id>")
@jwt_required()
def show_any(reservation_id):
    reservation = db.session.get(Reservation, reservation_id) or abort(404)
    return jsonify(id=reservation.id, guest=reservation.guest_name)


app.register_blueprint(bp)
"#,
    )]);
    let authz = concern(dir.path(), "authz");
    assert_eq!(
        said(&authz, "show_reservation"),
        ("unknown", "unclassified")
    );
    assert_eq!(
        unknown_instruments(&authz),
        [("app.py#reservation_for".to_string(), 1)]
    );
    assert_eq!(said(&authz, "show_any").0, "none");

    // Flask.
    let mut app = String::from(
        r#"from flask import Blueprint, Flask, abort, g, jsonify, session
from flask_jwt_extended import JWTManager, current_user, get_jwt, get_jwt_identity, jwt_required
from flask_login import current_user as login_user
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
db = SQLAlchemy(app)
jwt = JWTManager(app)
bp = Blueprint("reservations", __name__, url_prefix="/reservations")


class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer)
    guest = db.Column(db.String(80))
    cancelled = db.Column(db.Boolean)


class Gone(Exception):
    pass


def load(venue_id, rid):
    found = db.session.get(Reservation, rid)
    return found if found is not None and found.venue_id == venue_id else None


def load_last(rid, venue_id):
    found = db.session.get(Reservation, rid)
    return found if found is not None and found.venue_id == venue_id else None


def load_any(rid):
    return db.session.get(Reservation, rid)


@bp.get("/nothing__handed/<int:rid>")
@jwt_required()
def nothing__handed(rid):
    row = load_any(rid) or abort(404)
    return jsonify(guest=row.guest)


@bp.get("/nothing__compared/<int:rid>")
@jwt_required()
def nothing__compared(rid):
    row = db.session.get(Reservation, rid)
    if row.cancelled:
        abort(404)
    return jsonify(guest=row.guest)


@bp.get("/nothing__refused/<int:rid>")
@jwt_required()
def nothing__refused(rid):
    row = db.session.get(Reservation, rid)
    if row.cancelled:
        return jsonify(error="cancelled"), 400
    return jsonify(guest=row.guest)


@bp.get("/nothing__dropped/<int:rid>")
@jwt_required()
def nothing__dropped(rid):
    return jsonify([r.guest for r in Reservation.query.all() if not r.cancelled])
"#,
    );
    let names = source_by_use(
        &mut app,
        &|_| "@bp.get(\"/<F>/<int:rid>\")\n@jwt_required()\ndef <F>(rid):\n".to_string(),
        &[
            ("get_jwt_item", "", r#"get_jwt()["venue_id"]"#),
            ("get_jwt_get", "", r#"get_jwt().get("venue_id")"#),
            ("get_jwt_identity", "", "get_jwt_identity()"),
            ("jwt_current_user", "", "current_user.venue_id"),
            ("login_current_user", "", "login_user.venue_id"),
            ("g_user", "", "g.user.venue_id"),
            ("g_principal", "", "g.principal.venue_id"),
            ("g_claims_item", "", r#"g.claims["venue_id"]"#),
            ("g_tenant_id", "", "g.tenant_id"),
            ("session_item", "", r#"session["venue_id"]"#),
            ("session_get", "", r#"session.get("venue_id")"#),
            (
                "local_of_get_jwt",
                r#"venue = get_jwt()["venue_id"]"#,
                "venue",
            ),
            ("local_of_g_user", "venue = g.user.venue_id", "venue"),
            (
                "local_claims",
                "claims = get_jwt()",
                r#"claims["venue_id"]"#,
            ),
            (
                "local_or_abort",
                r#"venue = get_jwt().get("venue_id") or abort(403)"#,
                "venue",
            ),
        ],
        &[
            (
                "handed",
                "    row = load(<S>, rid) or abort(404)\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "handed_last",
                "    row = load_last(rid, <S>) or abort(404)\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "handed_keyword",
                "    row = load(rid=rid, venue_id=<S>) or abort(404)\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "compared",
                "    row = db.session.get(Reservation, rid)\n    if row.venue_id != <S>:\n        abort(404)\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "refused",
                "    row = db.session.get(Reservation, rid)\n    if row.venue_id != <S>:\n        return jsonify(error=\"no\"), 400\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "raised",
                "    row = db.session.get(Reservation, rid)\n    if row.venue_id != <S>:\n        raise Gone()\n    return jsonify(guest=row.guest)\n",
            ),
            (
                "dropped",
                "    return jsonify([r.guest for r in Reservation.query.all() if r.venue_id == <S>])\n",
            ),
            (
                "filter_by",
                "    return jsonify([r.guest for r in Reservation.query.filter_by(venue_id=<S>).all()])\n",
            ),
        ],
    );
    app.push_str("\n\napp.register_blueprint(bp)\n");
    let dir = repo(&[("app.py", &app)]);
    let authz = concern(dir.path(), "authz");
    for unit in &names {
        // A query given the caller itself (`filter_by(venue_id=
        // get_jwt_identity())`) finds this caller's rows and no one else's: known,
        // by the value. Every other source here is something read off the caller.
        let want = match unit.as_str() {
            "get_jwt_identity__filter_by" => ("known", "owner_filter:venue_id (session)"),
            _ => ("unknown", "unclassified"),
        };
        assert_eq!(said(&authz, unit), want, "{unit}");
    }
    for unit in ["handed", "compared", "refused", "dropped"] {
        assert_eq!(
            said(&authz, &format!("nothing__{unit}")).0,
            "none",
            "{unit}"
        );
    }

    // Django and DRF: what the request holds of the caller.
    let mut views = String::from(
        r#"from django.contrib.auth.decorators import login_required
from django.http import Http404, JsonResponse

from shipments.models import Shipment


def visible(depot_id):
    return [s for s in Shipment.objects.all() if s.depot_id == depot_id]


def visible_last(label, depot_id):
    return [s for s in Shipment.objects.all() if s.depot_id == depot_id and s.label != label]


def everything():
    return list(Shipment.objects.all())


@login_required
def nothing__handed(request, pk):
    return JsonResponse({"rows": [s.label for s in everything()]})


@login_required
def nothing__compared(request, pk):
    row = everything()[pk]
    if row.label == "":
        raise Http404()
    return JsonResponse({"label": row.label})


@login_required
def nothing__dropped(request, pk):
    return JsonResponse({"rows": [s.label for s in Shipment.objects.all() if s.label]})
"#,
    );
    let names = source_by_use(
        &mut views,
        &|_| "@login_required\ndef <F>(request, pk):\n".to_string(),
        &[
            ("request_user", "", "request.user.depot_id"),
            ("request_auth_item", "", r#"request.auth["depot_id"]"#),
            ("request_auth_attr", "", "request.auth.depot_id"),
            ("request_session_item", "", r#"request.session["depot_id"]"#),
            (
                "request_session_get",
                "",
                r#"request.session.get("depot_id")"#,
            ),
            (
                "local_of_request_user",
                "depot = request.user.depot_id",
                "depot",
            ),
            (
                "local_of_session_get",
                r#"depot = request.session.get("depot_id")"#,
                "depot",
            ),
        ],
        &[
            (
                "handed",
                "    return JsonResponse({\"rows\": [s.label for s in visible(<S>)]})\n",
            ),
            (
                "handed_last",
                "    return JsonResponse({\"rows\": [s.label for s in visible_last(\"x\", <S>)]})\n",
            ),
            (
                "handed_keyword",
                "    return JsonResponse({\"rows\": [s.label for s in visible(depot_id=<S>)]})\n",
            ),
            (
                "compared",
                "    row = everything()[pk]\n    if row.depot_id != <S>:\n        raise Http404()\n    return JsonResponse({\"label\": row.label})\n",
            ),
            (
                "dropped",
                "    return JsonResponse({\"rows\": [s.label for s in Shipment.objects.all() if s.depot_id == <S>]})\n",
            ),
            (
                "filter",
                "    return JsonResponse({\"rows\": [s.label for s in Shipment.objects.filter(depot_id=<S>)]})\n",
            ),
        ],
    );
    let mut urls = String::from(
        "from django.urls import path\n\nfrom shipments import views\n\nurlpatterns = [\n",
    );
    for name in names.iter().map(String::as_str).chain([
        "nothing__handed",
        "nothing__compared",
        "nothing__dropped",
    ]) {
        urls.push_str(&format!("    path(\"{name}/<int:pk>/\", views.{name}),\n"));
    }
    urls.push_str("]\n");
    let dir = drf("IsAuthenticated", "", &views, &urls);
    let authz = concern(dir.path(), "authz");
    for unit in &names {
        assert_eq!(said(&authz, unit), ("unknown", "unclassified"), "{unit}");
    }
    for unit in ["handed", "compared", "dropped"] {
        assert_eq!(
            said(&authz, &format!("nothing__{unit}")).0,
            "none",
            "{unit}"
        );
    }

    // FastAPI and Starlette: the request's state and scope, and what a dependency
    // that signs the caller in gives. A dependency that signs no one in gives no
    // identity, whatever is read off it.
    let mut main = String::from(
        r#"from dataclasses import dataclass

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy import Boolean, Column, Integer, String, create_engine, select
from sqlalchemy.orm import Session, declarative_base, sessionmaker

Base = declarative_base()
SessionLocal = sessionmaker(bind=create_engine("sqlite://"))
app = FastAPI()


class Reservation(Base):
    __tablename__ = "reservations"
    id = Column(Integer, primary_key=True)
    venue_id = Column(Integer)
    guest = Column(String)
    cancelled = Column(Boolean)


@dataclass
class Principal:
    id: str
    account_id: int


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_claims(authorization: str = Header(default="")) -> dict:
    try:
        return jwt.decode(authorization, "k", algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="sign in first")


def current_principal(authorization: str = Header(default="")) -> Principal:
    if not authorization:
        raise HTTPException(status_code=401, detail="sign in first")
    return Principal(id=authorization, account_id=1)


def load(venue_id, db: Session, rid: int):
    row = db.get(Reservation, rid)
    return row if row is not None and row.venue_id == venue_id else None


def load_last(db: Session, rid: int, venue_id):
    row = db.get(Reservation, rid)
    return row if row is not None and row.venue_id == venue_id else None


def load_any(db: Session, rid: int):
    return db.get(Reservation, rid)


@app.get("/nothing__handed/{rid}")
def nothing__handed(rid: int, db: Session = Depends(get_db), _: dict = Depends(current_claims)):
    row = load_any(db, rid)
    if row is None:
        raise HTTPException(status_code=404)
    return row


@app.get("/nothing__handed_db/{rid}")
def nothing__handed_db(rid: int, db: Session = Depends(get_db), _: dict = Depends(current_claims)):
    row = load(db.info, db, rid)
    if row is None:
        raise HTTPException(status_code=404)
    return row


@app.get("/nothing__compared/{rid}")
def nothing__compared(rid: int, db: Session = Depends(get_db), _: dict = Depends(current_claims)):
    row = db.get(Reservation, rid)
    if row.cancelled:
        raise HTTPException(status_code=404)
    return row


@app.get("/nothing__dropped/{rid}")
def nothing__dropped(rid: int, db: Session = Depends(get_db), _: dict = Depends(current_claims)):
    return [r for r in db.query(Reservation).all() if not r.cancelled]


@app.get("/nothing__filter/{rid}")
def nothing__filter(rid: int, db: Session = Depends(get_db), _: dict = Depends(current_claims)):
    return db.execute(select(Reservation).where(Reservation.cancelled.is_(False))).scalars().all()
"#,
    );
    let uses: &[(&str, &str)] = &[
        (
            "handed",
            "    row = load(<S>, db, rid)\n    if row is None:\n        raise HTTPException(status_code=404)\n    return row\n",
        ),
        (
            "handed_last",
            "    row = load_last(db, rid, <S>)\n    if row is None:\n        raise HTTPException(status_code=404)\n    return row\n",
        ),
        (
            "handed_keyword",
            "    row = load(db=db, rid=rid, venue_id=<S>)\n    if row is None:\n        raise HTTPException(status_code=404)\n    return row\n",
        ),
        (
            "compared",
            "    row = db.get(Reservation, rid)\n    if row.venue_id != <S>:\n        raise HTTPException(status_code=404)\n    return row\n",
        ),
        (
            "dropped",
            "    return [r for r in db.query(Reservation).all() if r.venue_id == <S>]\n",
        ),
        (
            "filter_by",
            "    return db.query(Reservation).filter_by(venue_id=<S>).all()\n",
        ),
        (
            "filter",
            "    return db.execute(select(Reservation).where(Reservation.venue_id == <S>)).scalars().all()\n",
        ),
    ];
    let route = "@app.get(\"/<F>/{rid}\")\ndef <F>(rid: int, db: Session = Depends(get_db), ";
    let mut names = source_by_use(
        &mut main,
        &|_| format!("{route}request: Request = None, _: dict = Depends(current_claims)):\n"),
        &[
            ("state_user", "", "request.state.user.venue_id"),
            ("state_principal", "", "request.state.principal.venue_id"),
            (
                "state_claims_item",
                "",
                r#"request.state.claims["venue_id"]"#,
            ),
            ("scope_user", "", r#"request.scope["user"].venue_id"#),
            ("request_user", "", "request.user.venue_id"),
            ("request_auth", "", "request.auth.venue_id"),
            ("request_session_item", "", r#"request.session["venue_id"]"#),
            (
                "local_of_state_user",
                "venue = request.state.user.venue_id",
                "venue",
            ),
        ],
        uses,
    );
    names.extend(source_by_use(
        &mut main,
        &|_| format!("{route}claims: dict = Depends(current_claims)):\n"),
        &[
            ("dep_claims_item", "", r#"claims["venue_id"]"#),
            ("dep_claims_get", "", r#"claims.get("venue_id")"#),
            (
                "local_of_dep_claims",
                r#"venue = claims["venue_id"]"#,
                "venue",
            ),
        ],
        uses,
    ));
    names.extend(source_by_use(
        &mut main,
        &|_| format!("{route}principal: Principal = Depends(current_principal)):\n"),
        &[
            ("dep_principal_attr", "", "principal.account_id"),
            (
                "local_of_dep_principal",
                "account = principal.account_id",
                "account",
            ),
        ],
        uses,
    ));
    let dir = repo(&[("app/__init__.py", ""), ("app/main.py", &main)]);
    let authz = concern(dir.path(), "authz");
    for unit in &names {
        assert_eq!(said(&authz, unit).0, "unknown", "{unit}");
    }
    for unit in ["handed", "handed_db", "compared", "dropped", "filter"] {
        assert_eq!(
            said(&authz, &format!("nothing__{unit}")).0,
            "none",
            "{unit}"
        );
    }
}

/// An ASGI callable that answers 401 by hand unless the request carries the header,
/// as a class (`wrap.py#TokenMiddleware`) and as a function that hands one back
/// (`wrap.py#require_signature`), one that answers so for HTTP scopes only
/// (`http_only`), and two that turn no one away.
const ASGI_WRAPPERS: &str = r#"from starlette.responses import JSONResponse


class TokenMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get("headers") or [])
        if not headers.get(b"authorization"):
            response = JSONResponse({"detail": "sign in"}, status_code=401)
            await response(scope, receive, send)
            return
        await self.inner(scope, receive, send)


def require_signature(inner):
    async def guarded(scope, receive, send):
        headers = dict(scope.get("headers") or [])
        if not headers.get(b"x-signature"):
            await send({"type": "http.response.start", "status": 401, "headers": []})
            await send({"type": "http.response.body", "body": b"unsigned"})
            return
        await inner(scope, receive, send)

    return guarded


def http_only(inner):
    async def guarded(scope, receive, send):
        headers = dict(scope.get("headers") or [])
        if scope["type"] == "http" and not headers.get(b"x-signature"):
            await JSONResponse({"detail": "unsigned"}, status_code=401)(scope, receive, send)
            return
        await inner(scope, receive, send)

    return guarded


def with_logging(inner):
    async def logged(scope, receive, send):
        print(scope["path"])
        await inner(scope, receive, send)

    return logged


def configure(app):
    app.title = "orders"
    return app


def make_worker(app):
    return {"name": app.title}
"#;

/// [STRICT] An application served through what wraps it. `app = Wrapper(api)` under
/// a new name already read unknown; the wrap written in the server call
/// (`uvicorn.run(require_signature(app))`), by a function of the repository that
/// hands back an ASGI callable, read `none`: the function was taken as a helper that
/// registers on its parameter. The wrapper is read as the application's middleware:
/// the guard where its body answers 401 for every request (also by hand, `await
/// response(scope, receive, send)` or the start message with its status), unknown
/// otherwise. A function that hands its parameter back (`app = configure(app)`) and
/// one whose result is not served (`worker = make_worker(app)`) wrap nothing.
#[test]
fn a_server_started_on_a_wrapped_application_is_read_through_the_wrapper() {
    let main = |tail: &str| {
        format!(
            r#"import uvicorn
from fastapi import FastAPI

from app.wrap import (
    TokenMiddleware,
    configure,
    http_only,
    make_worker,
    require_signature,
    with_logging,
)

app = FastAPI()


@app.get("/orders")
def orders():
    return []


{tail}
"#
        )
    };
    for (tail, want, how) in [
        (
            "if __name__ == \"__main__\":\n    uvicorn.run(require_signature(app), port=8000)",
            ("known", "middleware:app/wrap.py#require_signature"),
            Some("`app` served through what `require_signature` hands back (app/main.py:22)"),
        ),
        (
            "if __name__ == \"__main__\":\n    uvicorn.run(TokenMiddleware(app))",
            ("known", "middleware:app/wrap.py#TokenMiddleware"),
            Some("`app` passed to `TokenMiddleware`, which Drift does not read (app/main.py:22)"),
        ),
        (
            "if __name__ == \"__main__\":\n    uvicorn.run(http_only(app))",
            ("unknown", "unresolved"),
            Some("`app` served through what `http_only` hands back (app/main.py:22)"),
        ),
        (
            "if __name__ == \"__main__\":\n    uvicorn.run(with_logging(app))",
            ("unknown", "body_unreadable"),
            Some("`app` served through what `with_logging` hands back (app/main.py:22)"),
        ),
        (
            "application = require_signature(app)",
            ("known", "middleware:app/wrap.py#require_signature"),
            Some("`app` served through what `require_signature` hands back (app/main.py:21)"),
        ),
        // The same application, and something that is not served.
        ("app = configure(app)", ("none", ""), None),
        ("worker = make_worker(app)", ("none", ""), None),
        (
            "if __name__ == \"__main__\":\n    uvicorn.run(app)",
            ("none", ""),
            None,
        ),
    ] {
        let main = main(tail);
        let dir = repo(&[
            ("app/__init__.py", ""),
            ("app/wrap.py", ASGI_WRAPPERS),
            ("app/main.py", &main),
        ]);
        assert_eq!(
            said(&concern(dir.path(), "authn"), "orders"),
            want,
            "{tail}"
        );
        let inv = json(dir.path(), &["security", "--json"]);
        match (how, listed(&inv, "/orders")) {
            // Never "no guard" where the wrapper was not read as one: what was not
            // read is said first.
            (Some(how), Listed::Opaque(what)) if want.0 != "known" => {
                assert_eq!(what[0], how, "{tail}")
            }
            (Some(_), Listed::Guarded(by)) if want.0 == "known" => {
                assert!(by[0].ends_with(" (middleware)"), "{tail}: {by:?}")
            }
            (None, Listed::NoGuard) => {}
            (_, other) => panic!("{tail}: {other:?}"),
        }
    }
}

/// [STRICT] One name bound to the application and then to its wrapper
/// (`app = FastAPI()`, routes, `app = TokenMiddleware(app)`). Of the two bindings
/// one was kept, by sort order: with the wrapper imported from another module that
/// was the wrapper, the name was no application any more and no route on it was
/// listed at all. With a function for a wrapper the routes read `none`, as did those
/// of an application imported from another module and bound again under its name.
#[test]
fn an_application_bound_again_to_its_wrapper_keeps_its_routes() {
    let routes = r#"

@app.get("/orders")
def orders():
    return []


@app.post("/orders")
async def create():
    return {}
"#;
    for (import, wrapper, key) in [
        (
            "from app.wrap import TokenMiddleware",
            "TokenMiddleware",
            "middleware:app/wrap.py#TokenMiddleware",
        ),
        (
            "from app.wrap import require_signature",
            "require_signature",
            "middleware:app/wrap.py#require_signature",
        ),
    ] {
        let main = format!(
            "from fastapi import FastAPI\n\n{import}\n\napp = FastAPI()\n{routes}\n\napp = {wrapper}(app)\n"
        );
        let dir = repo(&[
            ("app/__init__.py", ""),
            ("app/wrap.py", ASGI_WRAPPERS),
            ("app/main.py", &main),
        ]);
        let authn = concern(dir.path(), "authn");
        for unit in ["orders", "create"] {
            assert_eq!(said(&authn, unit), ("known", key), "{wrapper} {unit}");
        }
        let inv = json(dir.path(), &["security", "--json"]);
        assert_eq!(
            inv["entry_points"].as_array().unwrap().len(),
            2,
            "{wrapper}"
        );
    }
    // The application of another module, bound again under its own name.
    let dir = repo(&[
        ("app/__init__.py", ""),
        ("app/wrap.py", ASGI_WRAPPERS),
        (
            "app/api.py",
            "from fastapi import APIRouter, FastAPI\n\nrouter = APIRouter()\n\n\n@router.get(\"/orders\")\ndef orders():\n    return []\n\n\napp = FastAPI()\napp.include_router(router, prefix=\"/v1\")\n",
        ),
        (
            "app/main.py",
            "from app.api import app\nfrom app.wrap import with_logging\n\napp = with_logging(app)\n",
        ),
    ]);
    assert_eq!(
        said(&concern(dir.path(), "authn"), "orders"),
        ("unknown", "body_unreadable")
    );
    assert_eq!(
        listed(&json(dir.path(), &["security", "--json"]), "/v1/orders"),
        opaque(&["`app` served through what `with_logging` hands back (app/main.py:4)"])
    );
}

/// [STRICT] A Starlette application's route table (`Starlette(routes=[Route(...)])`,
/// the list written in place or bound to a name, a `Mount` of more routes under a
/// path) listed nothing: a route that is not listed cannot be judged. Listed, its
/// routes read as a FastAPI application's: `none` on a bare application, and through
/// the wrapper where the application is wrapped.
#[test]
fn a_starlette_route_table_is_listed() {
    let app = |tail: &str| {
        format!(
            r#"from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from app.wrap import TokenMiddleware


async def orders(request):
    return JSONResponse([])


async def create(request):
    return JSONResponse({{}})


async def invoice(request):
    return JSONResponse({{}})


routes = [
    Route("/orders", orders),
    Route("/orders", create, methods=["POST"]),
    Mount("/billing", routes=[Route("/invoices/{{invoice_id}}", invoice, methods=["GET"])]),
]
{tail}
"#
        )
    };
    let bare = app("app = Starlette(debug=False, routes=routes)");
    let dir = repo(&[
        ("app/__init__.py", ""),
        ("app/wrap.py", ASGI_WRAPPERS),
        ("app/main.py", &bare),
    ]);
    let inv = json(dir.path(), &["security", "--json"]);
    let authn = concern(dir.path(), "authn");
    for (route, unit) in [
        ("ANY /orders", "orders"),
        ("POST /orders", "create"),
        ("GET /billing/invoices/{invoice_id}", "invoice"),
    ] {
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
        assert_eq!(said(&authn, unit).0, "none", "{unit}");
    }
    let wrapped = app("api = Starlette(routes=routes)\napp = TokenMiddleware(api)");
    let dir = repo(&[
        ("app/__init__.py", ""),
        ("app/wrap.py", ASGI_WRAPPERS),
        ("app/main.py", &wrapped),
    ]);
    let authn = concern(dir.path(), "authn");
    for unit in ["orders", "create", "invoice"] {
        assert_eq!(
            said(&authn, unit),
            ("known", "middleware:app/wrap.py#TokenMiddleware"),
            "{unit}"
        );
    }
}

/// [STRICT] The middleware an application is built with (`Starlette(routes=...,
/// middleware=[Middleware(X)])`, the same keyword of `FastAPI(...)`) runs for every
/// request, as one given to `add_middleware` does, and was not read: a route behind
/// a middleware of the repository that answers 401 read `none`. A package's that no
/// list knows may be the guard (unknown); Starlette's `@requires(scopes)` turns away
/// a connection without the scope.
#[test]
fn the_middleware_an_application_is_built_with_is_read() {
    let dir = repo(&[
        ("shop/__init__.py", ""),
        (
            "shop/app.py",
            r#"from starlette.applications import Starlette
from starlette.authentication import requires
from starlette.middleware import Middleware
from starlette.middleware.authentication import AuthenticationMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from shop.auth import CookieBackend


@requires("authenticated")
async def basket(request):
    return JSONResponse({"owner": request.user.display_name})


async def catalogue(request):
    return JSONResponse([])


app = Starlette(
    routes=[Route("/basket", basket), Route("/catalogue", catalogue)],
    middleware=[Middleware(AuthenticationMiddleware, backend=CookieBackend())],
)
"#,
        ),
        (
            "shop/auth.py",
            r#"from starlette.authentication import AuthCredentials, AuthenticationBackend, SimpleUser


class CookieBackend(AuthenticationBackend):
    async def authenticate(self, conn):
        who = conn.cookies.get("who")
        if not who:
            return None
        return AuthCredentials(["authenticated"]), SimpleUser(who)
"#,
        ),
    ]);
    let authn = concern(dir.path(), "authn");
    assert_eq!(
        said(&authn, "basket"),
        ("known", "decorator:pkg:starlette#authentication.requires")
    );
    // The backend lets a connection without the cookie through as anonymous: the
    // package's middleware is not read, so this is unknown, never known.
    assert_eq!(said(&authn, "catalogue"), ("unknown", "opaque_wrapper"));
    assert_eq!(
        listed(&json(dir.path(), &["security", "--json"]), "/basket"),
        guarded(&["authentication.requires"])
    );

    let dir = repo(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            r#"from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware


class SignIn(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.headers.get("authorization"):
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)


guarded_app = FastAPI(middleware=[Middleware(GZipMiddleware), Middleware(SignIn)])
plain_app = FastAPI(middleware=[Middleware(GZipMiddleware)])
OPTIONS = [Middleware(SignIn)]
unread_app = FastAPI(middleware=OPTIONS)


@guarded_app.get("/orders")
def orders():
    return []


@plain_app.get("/prices")
def prices():
    return []


@unread_app.get("/stock")
def stock():
    return []
"#,
        ),
    ]);
    let authn = concern(dir.path(), "authn");
    assert_eq!(
        said(&authn, "orders"),
        ("known", "middleware:app/main.py#SignIn")
    );
    assert_eq!(said(&authn, "prices").0, "none");
    assert_eq!(said(&authn, "stock"), ("unknown", "body_unreadable"));
}

/// Middleware for a Starlette route table: one that answers 401 for every request
/// it sees (`ApiKeyMiddleware`), the same as a pure ASGI class (`AsgiKey`), one that
/// answers so for some paths only (`ExceptPublic`) and one that turns no one away
/// (`Timing`).
const TABLE_MIDDLEWARE: &str = r#"from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.headers.get("x-api-key") != request.app.state.api_key:
            return PlainTextResponse("unauthorized", status_code=401)
        return await call_next(request)


class AsgiKey:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get("headers") or [])
        if not headers.get(b"x-api-key"):
            response = PlainTextResponse("unauthorized", status_code=401)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class ExceptPublic(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/public"):
            return await call_next(request)
        if not request.headers.get("x-api-key"):
            return PlainTextResponse("unauthorized", status_code=401)
        return await call_next(request)


class Timing(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["x-took"] = "1"
        return response
"#;

/// The endpoints of the tables, and two applications of another module to mount: a
/// Starlette one (`sub`) and a Flask one (`legacy`).
const TABLE_VIEWS: &str = r#"from flask import Flask
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route


async def version(request):
    return JSONResponse({"version": "1"})


async def list_devices(request):
    return JSONResponse([])


async def show_device(request):
    return JSONResponse({})


sub = Starlette(routes=[Route("/devices", list_devices)])
legacy = Flask(__name__)


@legacy.get("/old")
def old():
    return "old"
"#;

/// [STRICT] Middleware given on the way from a Starlette application to a route:
/// on a `Mount` (`Mount("/api", routes=[...], middleware=[Middleware(X)])`), on the
/// router or application a mount serves, on the `Route` itself. Since route tables
/// are listed, a route under such a mount read authentication `none` and "no
/// guard": only the application's own `middleware=` was read. Every `middleware=`
/// in the chain is read as the application's is: the guard where its body answers
/// 401 for every request, unknown where the list or a class in it is not read
/// (a name, a concatenation, options spread into the call, a package's class no
/// list knows, one that answers for some paths only), nothing where it turns no one
/// away. A route beside the mount is not behind it. Both surfaces agree.
#[test]
fn middleware_given_on_a_starlette_mount_or_route_is_read() {
    let main = |tail: &str| {
        format!(
            r#"from authlib_gateway import GatewayAuthMiddleware
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.wsgi import WSGIMiddleware
from starlette.routing import Mount, Route, Router

from svc.mw import ApiKeyMiddleware, AsgiKey, ExceptPublic, Timing
from svc.views import legacy, list_devices, show_device, sub, version

{tail}
"#
        )
    };
    let key = Some("ApiKeyMiddleware (middleware)");
    // (the table, what each route reads, the guard or what was not read of the
    // first route)
    type Case<'a> = (&'a str, &'a [(&'a str, &'a str)], Option<&'a str>);
    let cases: &[Case] = &[
        // On a mount of routes; a route beside it is not behind it.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", routes=[Route("/devices", list_devices)], middleware=[Middleware(ApiKeyMiddleware)]),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // On a router built in the mount.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", app=Router(routes=[Route("/devices", list_devices)], middleware=[Middleware(ApiKeyMiddleware)])),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // On an application built in the mount, its middleware given by position.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", app=Starlette(False, [Route("/devices", list_devices)], [Middleware(ApiKeyMiddleware)])),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // On a router bound to a name, and on an application bound to one.
        (
            r#"api = Router(routes=[Route("/devices", list_devices)], middleware=[Middleware(ApiKeyMiddleware)])
app = Starlette(routes=[Route("/version", version), Mount("/api", app=api)])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        (
            r#"api = Starlette(routes=[Route("/devices", list_devices)], middleware=[Middleware(ApiKeyMiddleware)])
app = Starlette(routes=[Route("/version", version), Mount("/api", app=api)])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // On the mount of an application of another module, and on what the
        // application that mounts it is built with.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", app=sub, middleware=[Middleware(ApiKeyMiddleware)]),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        (
            r#"app = Starlette(
    routes=[Route("/version", version), Mount("/api", app=sub)],
    middleware=[Middleware(ApiKeyMiddleware)],
)"#,
            &[("ANY /api/devices", "guarded"), ("ANY /version", "guarded")],
            key,
        ),
        // The same application mounted twice, once behind the middleware.
        (
            r#"app = Starlette(routes=[
    Mount("/api", app=sub, middleware=[Middleware(ApiKeyMiddleware)]),
    Mount("/open", app=sub),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /open/devices", "no guard"),
            ],
            key,
        ),
        // On a mount of what wraps another framework's application.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/legacy", app=WSGIMiddleware(legacy), middleware=[Middleware(ApiKeyMiddleware)]),
])"#,
            &[
                ("ANY /?/version", "no guard"),
                ("GET /?/legacy/old", "guarded"),
            ],
            None,
        ),
        // On the route.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Route("/api/devices", list_devices, middleware=[Middleware(ApiKeyMiddleware)]),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // The table bound to a name, the application's middleware by position.
        (
            r#"routes = [Route("/version", version), Mount("/api", routes=[Route("/devices", list_devices)])]
app = Starlette(False, routes, [Middleware(ApiKeyMiddleware)])"#,
            &[("ANY /api/devices", "guarded"), ("ANY /version", "guarded")],
            key,
        ),
        // A mount in a mount: the outer mount's middleware covers the inner routes,
        // whatever the inner one adds.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", routes=[
        Mount("/v1", routes=[Route("/devices", list_devices)]),
        Mount("/v2", routes=[Route("/devices", show_device)], middleware=[Middleware(Timing)]),
    ], middleware=[Middleware(ApiKeyMiddleware)]),
])"#,
            &[
                ("ANY /api/v1/devices", "guarded"),
                ("ANY /api/v2/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            key,
        ),
        // The inner mount's own, and one that is not read around one that is.
        (
            r#"GUARDS = [Middleware(ApiKeyMiddleware)]
app = Starlette(routes=[
    Mount("/api", routes=[
        Mount("/v1", routes=[Route("/devices", list_devices)], middleware=[Middleware(ApiKeyMiddleware)]),
        Mount("/v2", routes=[Route("/devices", show_device)]),
    ], middleware=[Middleware(Timing)]),
    Mount("/b", routes=[Mount("/v1", routes=[Route("/devices", version)], middleware=[Middleware(Timing)])], middleware=GUARDS),
])"#,
            &[
                ("ANY /api/v1/devices", "guarded"),
                ("ANY /api/v2/devices", "no guard"),
                ("ANY /b/v1/devices", "unknown"),
            ],
            key,
        ),
        // A pure ASGI class.
        (
            r#"app = Starlette(routes=[
    Route("/version", version),
    Mount("/api", routes=[Route("/devices", list_devices)], middleware=[Middleware(AsgiKey)]),
])"#,
            &[
                ("ANY /api/devices", "guarded"),
                ("ANY /version", "no guard"),
            ],
            Some("AsgiKey (middleware)"),
        ),
        // The list bound to a name, built by concatenation, or spread into the call.
        (
            r#"GUARDS = [Middleware(ApiKeyMiddleware)]
OPTIONS = {"middleware": GUARDS}
app = Starlette(routes=[
    Mount("/api", routes=[Route("/devices", list_devices)], middleware=GUARDS),
    Mount("/v2", routes=[Route("/devices", show_device)], middleware=GUARDS + [Middleware(Timing)]),
    Mount("/v3", routes=[Route("/devices", version)], **OPTIONS),
    Route("/version", version, middleware=GUARDS),
])"#,
            &[
                ("ANY /api/devices", "unknown"),
                ("ANY /v2/devices", "unknown"),
                ("ANY /v3/devices", "unknown"),
                ("ANY /version", "unknown"),
            ],
            Some("`middleware=` of `Mount(...)` (svc/main.py:14)"),
        ),
        // A class in the list that is not read, or answers for some requests only.
        (
            r#"app = Starlette(routes=[
    Mount("/api", routes=[Route("/devices", list_devices)], middleware=[Middleware(GatewayAuthMiddleware)]),
    Mount("/v2", routes=[Route("/devices", show_device)], middleware=[Middleware(ExceptPublic)]),
    Mount("/v3", routes=[Route("/devices", version)], middleware=[ApiKeyMiddleware]),
])"#,
            &[
                ("ANY /api/devices", "unknown"),
                ("ANY /v2/devices", "unknown"),
                ("ANY /v3/devices", "unknown"),
            ],
            Some("GatewayAuthMiddleware (middleware)"),
        ),
        // Middleware that turns no one away guards nothing.
        (
            r#"app = Starlette(routes=[
    Mount("/api", routes=[Route("/devices", list_devices)], middleware=[Middleware(Timing), Middleware(GZipMiddleware)]),
    Route("/version", version, middleware=[Middleware(Timing)]),
])"#,
            &[
                ("ANY /api/devices", "no guard"),
                ("ANY /version", "no guard"),
            ],
            None,
        ),
        // A mount in a table that is not read (built in a function): the
        // application that holds it, and its middleware, are not known.
        (
            r#"def build():
    return Starlette(
        routes=[Mount("/api", app=sub)],
        middleware=[Middleware(ApiKeyMiddleware)],
    )


app = build()"#,
            &[("ANY /?/api/devices", "unknown")],
            Some("the application whose route table holds `Mount(...)` (svc/main.py:13)"),
        ),
    ];
    for (tail, want, first) in cases {
        let main = main(tail);
        let dir = repo(&[
            ("svc/__init__.py", ""),
            ("svc/mw.py", TABLE_MIDDLEWARE),
            ("svc/views.py", TABLE_VIEWS),
            ("svc/main.py", &main),
        ]);
        // (`sub` and `legacy` serve their own routes too where nothing mounts them.)
        let said = one_answer(dir.path());
        for (route, state) in *want {
            assert_eq!(said.get(*route), Some(state), "{route} of {tail}: {said:?}");
        }
        let Some(first) = first else { continue };
        let inv = json(dir.path(), &["security", "--json"]);
        let by = match want[0].1 {
            "guarded" => guarded(&[first]),
            _ => opaque(&[first]),
        };
        assert_eq!(listed(&inv, want[0].0), by, "{tail}");
    }

    // FastAPI: an application mounted on another keeps the middleware it is built
    // with or given, and gets that of the application it is mounted on.
    for (sub, outer) in [
        (
            "sub = FastAPI(middleware=[Middleware(ApiKeyMiddleware)])",
            "",
        ),
        ("sub = FastAPI()\nsub.add_middleware(ApiKeyMiddleware)", ""),
        ("sub = FastAPI()", "app.add_middleware(ApiKeyMiddleware)"),
    ] {
        let main = format!(
            r#"from fastapi import FastAPI
from starlette.middleware import Middleware

from svc.mw import ApiKeyMiddleware

app = FastAPI()
{sub}
{outer}


@app.get("/version")
def version():
    return {{"version": "1"}}


@sub.get("/devices")
def list_devices():
    return []


app.mount("/api", sub)
"#
        );
        let dir = repo(&[
            ("svc/__init__.py", ""),
            ("svc/mw.py", TABLE_MIDDLEWARE),
            ("svc/main.py", &main),
        ]);
        let said = one_answer(dir.path());
        assert_eq!(said["GET /api/devices"], "guarded", "{sub}");
        let version = if outer.is_empty() {
            "no guard"
        } else {
            "guarded"
        };
        assert_eq!(said["GET /version"], version, "{sub}");
    }
}

/// `drift security` and the practice map give one answer on every HTTP entry point
/// of `root`: counted as guarded where authentication is known by something that
/// enforces, "guard cannot be read" where it is unknown, and "no guard" where it is
/// `none` (or known only as identified or opened). Returns `route -> state`, for
/// the test to say which state it expects.
fn one_answer(root: &Path) -> std::collections::BTreeMap<String, &'static str> {
    let inv = json(root, &["security", "--json"]);
    let authn = concern(root, "authn");
    let mut out = std::collections::BTreeMap::new();
    for e in inv["entry_points"].as_array().unwrap() {
        if e["kind"] != "http" {
            continue;
        }
        let (method, route) = (e["method"].as_str().unwrap(), e["route"].as_str().unwrap());
        let at = format!("{method} {route}");
        let unit = format!("{method} {}", e["symbol"].as_str().unwrap());
        // A handler served at more than one route has a unit for each.
        let mut here = authn.clone();
        here["units"]
            .as_array_mut()
            .unwrap()
            .retain(|u| u["route"].is_null() || u["route"] == e["route"]);
        let (assignment, key) = said(&here, &unit);
        let enforced = key.split('+').any(|u| {
            !matches!(
                u.split(':').next().unwrap_or_default(),
                "identifies" | "opens" | "service_auth" | ""
            )
        });
        let map = match assignment {
            "known" if enforced => "guarded",
            "unknown" => "unknown",
            _ => "no guard",
        };
        let inventory = match listed(&inv, &at) {
            Listed::Guarded(_) => "guarded",
            Listed::Opaque(_) => "unknown",
            Listed::NoGuard => "no guard",
        };
        assert_eq!(
            inventory, map,
            "{at}: the inventory says {inventory}, the practice map {assignment} {key}"
        );
        out.insert(at, map);
    }
    out
}

/// [STRICT] `drift security` did not read an application's middleware: a route
/// behind a middleware that answers 401 for every request was listed under "Entry
/// points with no guard" while the practice map said `known middleware:...`. The
/// inventory takes the practice map's reading of each middleware: the guard where
/// it is read as one, "guard cannot be read" where it may be (it answers for some
/// requests only, a package's that no list knows), nothing where it turns no one
/// away.
#[test]
fn the_inventory_reads_an_applications_middleware_as_the_practice_map_does() {
    let dir = repo(&[
        ("svc/__init__.py", ""),
        (
            "svc/auth.py",
            r#"from fastapi import Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware


class SignIn(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.headers.get("authorization"):
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)


class Verify(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            request.state.claims = jwt.decode(request.headers.get("authorization", ""), "k")
        except JWTError:
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)


class ExceptPublic(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/public"):
            return await call_next(request)
        if not request.headers.get("authorization"):
            return JSONResponse({"detail": "sign in first"}, status_code=401)
        return await call_next(request)


class LoadClaims(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            request.state.claims = jwt.decode(request.headers.get("authorization", ""), "k")
        except JWTError:
            request.state.claims = None
        return await call_next(request)
"#,
        ),
        (
            "svc/apps.py",
            r#"from authlib_gateway import GatewayAuthMiddleware
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from svc.auth import ExceptPublic, LoadClaims, SignIn, Verify

plain = FastAPI()
plain.add_middleware(SignIn)

handler = FastAPI()
handler.add_middleware(CORSMiddleware, allow_origins=["*"])
handler.add_middleware(Verify)

some = FastAPI()
some.add_middleware(ExceptPublic)

package = FastAPI()
package.add_middleware(GatewayAuthMiddleware)

optional = FastAPI()
optional.add_middleware(LoadClaims)
optional.add_middleware(CORSMiddleware, allow_origins=["*"])

function = FastAPI()


@function.middleware("http")
async def sign_in(request: Request, call_next):
    if not request.headers.get("authorization"):
        return JSONResponse({"detail": "sign in first"}, status_code=401)
    return await call_next(request)


@plain.get("/plain")
def behind_plain():
    return []


@handler.get("/handler")
def behind_handler():
    return []


@some.get("/some")
def behind_some():
    return []


@package.get("/package")
def behind_package():
    return []


@optional.get("/optional")
def behind_optional():
    return []


@function.get("/function")
def behind_function():
    return []
"#,
        ),
    ]);
    let said: Vec<(String, &str)> = one_answer(dir.path()).into_iter().collect();
    let said: Vec<(&str, &str)> = said.iter().map(|(r, s)| (r.as_str(), *s)).collect();
    assert_eq!(
        said,
        [
            ("GET /function", "guarded"),
            ("GET /handler", "guarded"),
            ("GET /optional", "no guard"),
            ("GET /package", "unknown"),
            ("GET /plain", "guarded"),
            ("GET /some", "unknown"),
        ]
    );
    let inv = json(dir.path(), &["security", "--json"]);
    assert_eq!(listed(&inv, "/plain"), guarded(&["SignIn (middleware)"]));
    assert_eq!(listed(&inv, "/handler"), guarded(&["Verify (middleware)"]));
    assert_eq!(
        listed(&inv, "/function"),
        guarded(&["sign_in (middleware)"])
    );
    assert_eq!(
        listed(&inv, "/some"),
        opaque(&["ExceptPublic (middleware)"])
    );
    assert_eq!(
        listed(&inv, "/package"),
        opaque(&["GatewayAuthMiddleware (middleware)"])
    );
}

/// [STRICT] A dependency or decorator that could not be read was a wrapper to
/// `drift security`: `Depends(GUARDS["user"])` listed its route under "Entry points
/// with no guard" (`wrappers: unresolved:GUARDS[...]`) while the practice map said
/// unknown. What could not be read may be the guard: "guard cannot be read" on both.
#[test]
fn a_dependency_that_could_not_be_read_is_never_no_guard_in_the_inventory() {
    let dir = repo(&[
        ("app/__init__.py", ""),
        (
            "app/deps.py",
            "GUARDS = {}\n\n\ndef get_db():\n    yield None\n",
        ),
        (
            "app/main.py",
            r#"from fastapi import APIRouter, Depends, FastAPI

from app.deps import GUARDS, get_db
from .absent import require_member

app = FastAPI()
keyed = APIRouter(dependencies=[Depends(GUARDS["member"])])


@app.get("/subscript")
def subscript(user=Depends(GUARDS["user"])):
    return {}


@app.get("/called")
def called(user=Depends(GUARDS.get("user"))):
    return {}


@keyed.get("/routed")
def routed():
    return {}


@app.get("/unresolved-import")
def unresolved_import(user=Depends(require_member)):
    return {}


@app.get("/read")
def read(db=Depends(get_db)):
    return {}


app.include_router(keyed)
"#,
        ),
    ]);
    let said: Vec<(String, &str)> = one_answer(dir.path()).into_iter().collect();
    let said: Vec<(&str, &str)> = said.iter().map(|(r, s)| (r.as_str(), *s)).collect();
    assert_eq!(
        said,
        [
            ("GET /called", "unknown"),
            ("GET /read", "no guard"),
            ("GET /routed", "unknown"),
            ("GET /subscript", "unknown"),
            ("GET /unresolved-import", "unknown"),
        ]
    );
    let inv = json(dir.path(), &["security", "--json"]);
    assert_eq!(
        listed(&inv, "/subscript"),
        opaque(&["unresolved:GUARDS[...]"])
    );

    // A Flask decorator from a module that is not there.
    let dir = repo(&[
        (
            "shop/app.py",
            r#"from flask import Flask, jsonify

from .absent import members_only

app = Flask(__name__)


@app.get("/orders")
@members_only
def orders():
    return jsonify([])


@app.get("/catalogue")
def catalogue():
    return jsonify([])
"#,
        ),
        ("shop/__init__.py", ""),
    ]);
    let said: Vec<(String, &str)> = one_answer(dir.path()).into_iter().collect();
    let said: Vec<(&str, &str)> = said.iter().map(|(r, s)| (r.as_str(), *s)).collect();
    assert_eq!(
        said,
        [("GET /catalogue", "no guard"), ("GET /orders", "unknown")]
    );
}

/// [STRICT] Every hook a Flask application runs before its requests was a guard to
/// `drift security`, whatever it did: a route behind a hook that opens a database
/// session, sets `g.user = None` or logs was counted as guarded ("guarded only by
/// hooks the whole app runs") while the practice map said `none`. A hook is a guard
/// where it answers 401, or redirects to sign-in, for every request; "guard cannot
/// be read" where it does so for some requests only; no guard otherwise. The same
/// for `before_app_request` on a blueprint and for a blueprint's own
/// `before_request`, with one answer from the inventory and the practice map on
/// each.
#[test]
fn a_hook_is_a_guard_only_where_it_turns_callers_away() {
    const HOOKS: &[(&str, &str, &str)] = &[
        (
            "answers 401",
            "    if not session.get(\"user_id\"):\n        abort(401)",
            "guarded",
        ),
        (
            "redirects to sign-in",
            "    if \"user_id\" not in session:\n        return redirect(url_for(\"auth.login\"))",
            "guarded",
        ),
        (
            "answers 401 in the handler of the verification",
            "    try:\n        g.user = signer.loads(request.headers.get(\"X-Token\", \"\"))\n    except BadSignature:\n        abort(401)",
            "guarded",
        ),
        (
            "answers 401 for some paths",
            "    if request.path.startswith(\"/admin\") and not session.get(\"user_id\"):\n        abort(401)",
            "unknown",
        ),
        (
            "opens a database session",
            "    g.db = connect()",
            "no guard",
        ),
        (
            "loads the user or none",
            "    try:\n        g.user = signer.loads(request.headers.get(\"X-Token\", \"\"))\n    except BadSignature:\n        g.user = None",
            "no guard",
        ),
        (
            "logs",
            "    app_log.info(\"%s %s\", request.method, request.path)",
            "no guard",
        ),
    ];
    const HEAD: &str = r#"import logging

from flask import Blueprint, Flask, abort, g, jsonify, redirect, request, session, url_for
from itsdangerous import BadSignature, URLSafeSerializer

from shop.db import connect

app_log = logging.getLogger("shop")
signer = URLSafeSerializer("k")
"#;
    for (what, body, want) in HOOKS {
        // On the application, on a blueprint for the whole application, and on a
        // blueprint for its own routes (with a second blueprint beside it that has
        // no hook).
        let on_app = format!(
            "{HEAD}app = Flask(__name__)\n\n\n@app.before_request\ndef hook():\n{body}\n\n\n@app.get(\"/orders\")\ndef orders():\n    return jsonify([])\n"
        );
        let app_wide = format!(
            "{HEAD}app = Flask(__name__)\nbp = Blueprint(\"shop\", __name__)\n\n\n@bp.before_app_request\ndef hook():\n{body}\n\n\n@app.get(\"/orders\")\ndef orders():\n    return jsonify([])\n\n\napp.register_blueprint(bp)\n"
        );
        let on_blueprint = format!(
            "{HEAD}app = Flask(__name__)\nbp = Blueprint(\"shop\", __name__)\nother = Blueprint(\"other\", __name__)\n\n\n@bp.before_request\ndef hook():\n{body}\n\n\n@bp.get(\"/orders\")\ndef orders():\n    return jsonify([])\n\n\n@other.get(\"/prices\")\ndef prices():\n    return jsonify([])\n\n\napp.register_blueprint(bp)\napp.register_blueprint(other)\n"
        );
        for (where_, source) in [
            ("before_request on the application", &on_app),
            ("before_app_request on a blueprint", &app_wide),
            ("before_request on a blueprint", &on_blueprint),
        ] {
            let dir = repo(&[
                ("shop/__init__.py", ""),
                ("shop/db.py", "def connect():\n    return object()\n"),
                ("shop/app.py", source),
            ]);
            let said = one_answer(dir.path());
            assert_eq!(said["GET /orders"], *want, "{what}, {where_}: {said:?}");
            if let Some(prices) = said.get("GET /prices") {
                assert_eq!(*prices, "no guard", "{what}, {where_}");
            }
        }
    }
}

/// A URLconf included through django-decorator-include's
/// `decorator_include(login_required, "app.urls")` was followed by nothing: its
/// views were not listed, so nothing was said of them. They are listed under the
/// include's path, behind the decorators where each is a name (Django's
/// `login_required` is the guard), and behind what could not be read otherwise
/// (unknown, never `none`).
#[test]
fn views_included_through_decorator_include_are_listed_behind_its_decorators() {
    let dir = repo(&[
        (
            "manage.py",
            "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n",
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            "SECRET_KEY = \"x\"\nROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"django.contrib.auth\", \"members\", \"partners\", \"pages\"]\nMIDDLEWARE = []\n",
        ),
        (
            "proj/urls.py",
            r#"from decorator_include import decorator_include
from django.contrib.auth.decorators import login_required
from django.urls import include, path

from proj.checks import CHECKS

urlpatterns = [
    path("members/", decorator_include(login_required, "members.urls")),
    path("partners/", decorator_include([CHECKS["partner"]], "partners.urls")),
    path("pages/", include("pages.urls")),
]
"#,
        ),
        ("proj/checks.py", "CHECKS = {}\n"),
        ("members/__init__.py", ""),
        (
            "members/urls.py",
            "from django.urls import path\n\nfrom members import views\n\nurlpatterns = [path(\"orders/\", views.orders)]\n",
        ),
        (
            "members/views.py",
            "from django.http import JsonResponse\n\n\ndef orders(request):\n    return JsonResponse({})\n",
        ),
        ("partners/__init__.py", ""),
        (
            "partners/urls.py",
            "from django.urls import path\n\nfrom partners import views\n\nurlpatterns = [path(\"offers/\", views.offers)]\n",
        ),
        (
            "partners/views.py",
            "from django.http import JsonResponse\n\n\ndef offers(request):\n    return JsonResponse({})\n",
        ),
        ("pages/__init__.py", ""),
        (
            "pages/urls.py",
            "from django.urls import path\n\nfrom pages import views\n\nurlpatterns = [path(\"about/\", views.about)]\n",
        ),
        (
            "pages/views.py",
            "from django.http import JsonResponse\n\n\ndef about(request):\n    return JsonResponse({})\n",
        ),
    ]);
    let said: Vec<(String, &str)> = one_answer(dir.path()).into_iter().collect();
    let said: Vec<(&str, &str)> = said.iter().map(|(r, s)| (r.as_str(), *s)).collect();
    assert_eq!(
        said,
        [
            ("ANY /members/orders", "guarded"),
            ("ANY /pages/about", "no guard"),
            ("ANY /partners/offers", "unknown"),
        ]
    );
    assert_eq!(
        listed(
            &json(dir.path(), &["security", "--json"]),
            "/members/orders"
        ),
        guarded(&["contrib.auth.decorators.login_required"])
    );
}

/// [STRICT] A 401 proves a guard only where every request the body lets through
/// has passed a refusal of a caller with no identity. `if not authorization: return
/// None` before the 401 for a token that is not valid is optional identity: the
/// dependency was the route's guard on both surfaces. The same for a 401 under `if
/// authorization:` only, in the `else`-less branch of a presence test, behind an
/// `and` with the credential's presence, after a return on a condition that says
/// nothing of the caller, and for a guard the body calls after such a return or
/// under a branch. Each is unknown and "guard cannot be read", never a guard and
/// never none. What stays a guard: a refusal every request passes, a return after
/// it, a branch that returns only for a caller with a credential where every other
/// request is refused, a refusal written in a helper that never returns.
#[test]
fn a_refusal_only_some_requests_reach_proves_no_guard() {
    let fastapi = repo(&[
        ("app/__init__.py", ""),
        (
            "app/deps.py",
            r#"from fastapi import Header, HTTPException, Request
from jose import JWTError, jwt

KEY = "k"


def lookup(token):
    return None


def verify(token: str):
    if token != KEY:
        raise HTTPException(status_code=401)
    return {"sub": "u"}


def deny():
    raise HTTPException(status_code=401, detail="sign in first")


def current_user(authorization: str | None = Header(None)):
    if not authorization:
        return None
    user = lookup(authorization)
    if user is None:
        raise HTTPException(401)
    return user


def under_presence(authorization: str | None = Header(None)):
    user = None
    if authorization:
        user = lookup(authorization)
        if user is None:
            raise HTTPException(401)
    return user


def presence_else(authorization: str | None = Header(None)):
    if authorization:
        user = lookup(authorization)
        if user is None:
            raise HTTPException(401)
        return user
    return None


def and_presence(authorization: str | None = Header(None)):
    if authorization and authorization != KEY:
        raise HTTPException(401)
    return authorization


def public_paths(request: Request, authorization: str | None = Header(None)):
    if request.url.path.startswith("/public"):
        return None
    if not authorization:
        raise HTTPException(401)
    return lookup(authorization)


def preview_flag(authorization: str | None = Header(None), preview: bool = False):
    if preview:
        return None
    raise HTTPException(status_code=401)


def verified_after_return(authorization: str | None = Header(None)):
    if not authorization:
        return None
    return verify(authorization)


def verified_under_branch(authorization: str | None = Header(None)):
    if authorization:
        return verify(authorization)
    return None


def before_the_try(authorization: str | None = Header(None)):
    if not authorization:
        return None
    try:
        claims = jwt.decode(authorization, KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401)
    return claims


class Bearer:
    def __call__(self, authorization: str | None = Header(None)):
        if not authorization:
            return None
        if authorization != KEY:
            raise HTTPException(status_code=401)
        return authorization


def strict(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(401)
    user = lookup(authorization)
    if user is None:
        raise HTTPException(401)
    return user


def refused_then_returns(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401)
    if authorization == "internal":
        return {"sub": "internal"}
    return lookup(authorization)


def credential_or_refused(authorization: str | None = Header(None), x_api_key: str | None = Header(None)):
    if authorization is not None and authorization.startswith("Bearer "):
        return lookup(authorization)
    if x_api_key and x_api_key == KEY:
        return x_api_key
    raise HTTPException(status_code=401, detail="sign in first")


def refused_by_a_helper(authorization: str | None = Header(None)):
    user = lookup(authorization)
    if user is None:
        deny()
    return user


def verified(authorization: str | None = Header(None)):
    return verify(authorization)


def session_user(authorization: str | None = Header(None)):
    if not authorization:
        return None
    return lookup(authorization)
"#,
        ),
        (
            "app/main.py",
            r#"from fastapi import Depends, FastAPI

from . import deps

app = FastAPI()


@app.get("/current-user")
def a(user=Depends(deps.current_user)):
    return {"user": user}


@app.get("/under-presence")
def b(user=Depends(deps.under_presence)):
    return {"user": user}


@app.get("/presence-else")
def c(user=Depends(deps.presence_else)):
    return {"user": user}


@app.get("/and-presence")
def d(user=Depends(deps.and_presence)):
    return {"user": user}


@app.get("/public-paths")
def e(user=Depends(deps.public_paths)):
    return {"user": user}


@app.get("/preview-flag")
def f(user=Depends(deps.preview_flag)):
    return {"user": user}


@app.get("/verified-after-return")
def g(user=Depends(deps.verified_after_return)):
    return {"user": user}


@app.get("/verified-under-branch")
def h(user=Depends(deps.verified_under_branch)):
    return {"user": user}


@app.get("/before-the-try")
def i(user=Depends(deps.before_the_try)):
    return {"user": user}


@app.get("/bearer")
def j(user=Depends(deps.Bearer())):
    return {"user": user}


@app.get("/strict")
def k(user=Depends(deps.strict)):
    return {"user": user}


@app.get("/refused-then-returns")
def l(user=Depends(deps.refused_then_returns)):
    return {"user": user}


@app.get("/credential-or-refused")
def m(user=Depends(deps.credential_or_refused)):
    return {"user": user}


@app.get("/refused-by-a-helper")
def n(user=Depends(deps.refused_by_a_helper)):
    return {"user": user}


@app.get("/verified")
def o(user=Depends(deps.verified)):
    return {"user": user}


@app.get("/session-user")
def p(user=Depends(deps.session_user)):
    return {"user": user}
"#,
        ),
    ]);
    let answers = one_answer(fastapi.path());
    for route in [
        "/current-user",
        "/under-presence",
        "/presence-else",
        "/and-presence",
        "/public-paths",
        "/preview-flag",
        "/verified-after-return",
        "/verified-under-branch",
        "/before-the-try",
        "/bearer",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "unknown", "{route}");
    }
    for route in [
        "/strict",
        "/refused-then-returns",
        "/credential-or-refused",
        "/refused-by-a-helper",
        "/verified",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "guarded", "{route}");
    }
    // No refusal at all: optional identity, plainly.
    assert_eq!(answers["GET /session-user"], "no guard");
    let inv = json(fastapi.path(), &["security", "--json"]);
    assert_eq!(listed(&inv, "/current-user"), opaque(&["current_user"]));

    let flask = repo(&[(
        "app/__init__.py",
        r#"import functools

from flask import Flask, abort, g, jsonify, request, session

app = Flask(__name__)


def lookup(token):
    return None


def with_user(view):
    @functools.wraps(view)
    def inner(*args, **kwargs):
        token = request.headers.get("Authorization")
        if not token:
            g.user = None
            return view(*args, **kwargs)
        user = lookup(token)
        if user is None:
            abort(401)
        g.user = user
        return view(*args, **kwargs)

    return inner


def login_required(view):
    @functools.wraps(view)
    def inner(*args, **kwargs):
        token = request.headers.get("Authorization")
        if not token:
            abort(401)
        g.user = lookup(token) or abort(401)
        return view(*args, **kwargs)

    return inner


def require_login():
    if not session.get("user_id"):
        abort(401)


@app.get("/with-user")
@with_user
def a():
    return jsonify(user=g.user)


@app.get("/login-required")
@login_required
def b():
    return jsonify(user=g.user)


@app.get("/check-after-preview")
def c():
    if request.args.get("preview"):
        return jsonify(preview=True)
    if not session.get("user_id"):
        abort(401)
    return jsonify(ok=True)


@app.get("/check-under-branch")
def d():
    if request.args.get("full"):
        if not session.get("user_id"):
            abort(401)
    return jsonify(ok=True)


@app.get("/check")
def e():
    if not session.get("user_id"):
        abort(401)
    return jsonify(ok=True)


@app.get("/call-under-branch")
def f():
    if request.args.get("full"):
        require_login()
    return jsonify(ok=True)


@app.get("/call-after-preview")
def h():
    if request.args.get("preview"):
        return jsonify(preview=True)
    require_login()
    return jsonify(ok=True)


@app.get("/call")
def i():
    require_login()
    return jsonify(ok=True)


@app.get("/refused-at-the-end")
def j():
    if session.get("user_id"):
        return jsonify(ok=True)
    abort(401)


@app.get("/nothing")
def k():
    return jsonify(ok=True)
"#,
    )]);
    let answers = one_answer(flask.path());
    for route in [
        "/with-user",
        "/check-after-preview",
        "/check-under-branch",
        "/call-under-branch",
        "/call-after-preview",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "unknown", "{route}");
    }
    for route in [
        "/login-required",
        "/check",
        "/call",
        // The refusal follows an `if` that returns for the caller it found: every
        // request without one reaches it (Python lowering 71).
        "/refused-at-the-end",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "guarded", "{route}");
    }
    assert_eq!(answers["GET /nothing"], "no guard");

    let django = repo(&[
        (
            "manage.py",
            "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["shop"]
ROOT_URLCONF = "proj.urls"
MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
    "shop.middleware.TokenMiddleware",
]
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from shop import views

urlpatterns = [
    path("with-token/", views.with_token_view),
    path("token-required/", views.token_required_view),
    path("plain/", views.plain),
]
"#,
        ),
        ("shop/__init__.py", ""),
        (
            "shop/middleware.py",
            r#"from django.http import JsonResponse


class TokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/public"):
            return self.get_response(request)
        if not request.headers.get("Authorization"):
            return JsonResponse({"detail": "sign in"}, status=401)
        return self.get_response(request)
"#,
        ),
        (
            "shop/views.py",
            r#"import functools

from django.http import JsonResponse


def lookup(token):
    return None


def with_token(view):
    @functools.wraps(view)
    def inner(request, *args, **kwargs):
        token = request.headers.get("Authorization")
        if not token:
            return view(request, *args, **kwargs)
        user = lookup(token)
        if user is None:
            return JsonResponse({"detail": "sign in"}, status=401)
        request.principal = user
        return view(request, *args, **kwargs)

    return inner


def token_required(view):
    @functools.wraps(view)
    def inner(request, *args, **kwargs):
        token = request.headers.get("Authorization")
        if not token:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    return inner


@with_token
def with_token_view(request):
    return JsonResponse({})


@token_required
def token_required_view(request):
    return JsonResponse({})


def plain(request):
    return JsonResponse({})
"#,
        ),
    ]);
    let answers = one_answer(django.path());
    // The middleware lets `/public...` through: the guard of the other requests,
    // and of no route by proof.
    assert_eq!(answers["ANY /plain"], "unknown");
    assert_eq!(answers["ANY /with-token"], "unknown");
    assert_eq!(answers["ANY /token-required"], "guarded");
    let inv = json(django.path(), &["security", "--json"]);
    assert_eq!(
        listed(&inv, "/plain"),
        opaque(&["TokenMiddleware (settings)"])
    );
    assert_eq!(
        listed(&inv, "/token-required"),
        guarded(&["token_required"])
    );
}

/// [STRICT] A DRF permission class of the repository was a guard through its base:
/// `class ReadOnlyOrStaff(BasePermission)` counted as one whatever its
/// `has_permission` returns, `return True` included. It is read from its body: a
/// guard where `has_permission` refuses a caller who is not signed in on every
/// request, no guard where it is `True` (or where the class defines no method over
/// `BasePermission`), unknown otherwise: a compound, a call, a test of the view
/// only, `has_object_permission` alone, a library class with a method added, the
/// base's test `or` something. A subclass of `IsAuthenticated` that overrides
/// `has_permission` is its override: `return True` opens it, `super()... and ...`
/// keeps the base's refusal. `authentication_classes` alone identify and never
/// guard. Library classes keep the library's meaning.
#[test]
fn a_permission_class_of_the_repository_is_read_from_its_body() {
    let classes = [
        // (class, base, body of the class)
        (
            "AlwaysTrue",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return True\n",
        ),
        ("Nothing", "BasePermission", "    message = \"no\"\n"),
        (
            "SubTrue",
            "IsAuthenticated",
            "    def has_permission(self, request, view):\n        return True\n",
        ),
        (
            "SignedIn",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return bool(request.user and request.user.is_authenticated)\n",
        ),
        (
            "SignedInPlain",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return request.user.is_authenticated\n",
        ),
        (
            "SignedInFirst",
            "BasePermission",
            "    def has_permission(self, request, view):\n        if not request.user or not request.user.is_authenticated:\n            return False\n        return request.user.depot_id is not None\n",
        ),
        (
            "SubSuperAnd",
            "IsAuthenticated",
            "    def has_permission(self, request, view):\n        return super().has_permission(request, view) and request.user.depot_id is not None\n",
        ),
        ("SubPlain", "IsAuthenticated", "    message = \"sign in\"\n"),
        (
            "ReadOnlyOrStaff",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return request.method in SAFE_METHODS or request.user.is_staff\n",
        ),
        (
            "OnlyView",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return view.action != \"destroy\"\n",
        ),
        (
            "Compound",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return request.user.is_authenticated or request.headers.get(\"X-Key\") == \"k\"\n",
        ),
        (
            "CallsOut",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return allowed(request)\n",
        ),
        (
            "OtherRequest",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return view.request.user.is_authenticated\n",
        ),
        (
            "ObjectOnly",
            "BasePermission",
            "    def has_object_permission(self, request, view, obj):\n        return obj.owner_id == request.user.id\n",
        ),
        (
            "SubAddsMethod",
            "IsAuthenticated",
            "    def has_object_permission(self, request, view, obj):\n        return obj.owner_id == request.user.id\n",
        ),
        (
            "SubSuperOr",
            "IsAuthenticated",
            "    def has_permission(self, request, view):\n        return super().has_permission(request, view) or request.method == \"GET\"\n",
        ),
        (
            "SuperOverBase",
            "BasePermission",
            "    def has_permission(self, request, view):\n        return super().has_permission(request, view) and view.action != \"destroy\"\n",
        ),
        (
            "SuperOverReadOnly",
            "IsAuthenticatedOrReadOnly",
            "    def has_permission(self, request, view):\n        return super().has_permission(request, view) and view.action != \"destroy\"\n",
        ),
        ("Bound", "BasePermission", "    has_permission = allowed\n"),
    ];
    let mut permissions = String::from(
        "from rest_framework.permissions import (\n    SAFE_METHODS,\n    BasePermission,\n    IsAuthenticated,\n    IsAuthenticatedOrReadOnly,\n)\n\n\ndef allowed(*args):\n    return True\n",
    );
    let mut views = String::from(
        "from rest_framework.authentication import TokenAuthentication\nfrom rest_framework.response import Response\nfrom rest_framework.views import APIView\n\nfrom shipments import permissions\n",
    );
    let mut urls = String::from(
        "from django.urls import path\n\nfrom shipments import views\n\nurlpatterns = [\n",
    );
    for (class, base, body) in classes {
        permissions.push_str(&format!("\n\nclass {class}({base}):\n{body}"));
        views.push_str(&format!(
            "\n\nclass {class}View(APIView):\n    permission_classes = [permissions.{class}]\n\n    def get(self, request):\n        return Response([])\n"
        ));
        urls.push_str(&format!(
            "    path(\"{class}/\", views.{class}View.as_view()),\n"
        ));
    }
    // A mixin in the chain, and identification with no permission class.
    permissions.push_str(
        "\n\nclass Mixin:\n    def has_permission(self, request, view):\n        return request.user.is_authenticated\n\n\nclass ThroughMixin(Mixin, BasePermission):\n    message = \"sign in\"\n",
    );
    views.push_str(
        "\n\nclass ThroughMixinView(APIView):\n    permission_classes = [permissions.ThroughMixin]\n\n    def get(self, request):\n        return Response([])\n\n\nclass IdentifiedView(APIView):\n    authentication_classes = [TokenAuthentication]\n\n    def get(self, request):\n        return Response([])\n",
    );
    urls.push_str(
        "    path(\"ThroughMixin/\", views.ThroughMixinView.as_view()),\n    path(\"Identified/\", views.IdentifiedView.as_view()),\n]\n",
    );
    let dir = drf("AllowAny", &permissions, &views, &urls);
    let answers = one_answer(dir.path());
    let authn = concern(dir.path(), "authn");
    let inv = json(dir.path(), &["security", "--json"]);
    for class in ["AlwaysTrue", "Nothing", "SubTrue"] {
        assert_eq!(answers[&format!("GET /api/{class}")], "no guard", "{class}");
        assert_eq!(
            said(&authn, &format!("{class}View.get")).0,
            "known",
            "{class}: it opens the view"
        );
    }
    for class in [
        "SignedIn",
        "SignedInPlain",
        "SignedInFirst",
        "SubSuperAnd",
        "ThroughMixin",
    ] {
        assert_eq!(answers[&format!("GET /api/{class}")], "guarded", "{class}");
        assert_eq!(
            said(&authn, &format!("{class}View.get")),
            (
                "known",
                format!("dependency:shipments/permissions.py#{class}").as_str()
            ),
            "{class}"
        );
        assert_eq!(listed(&inv, &format!("/api/{class}")), guarded(&[class]));
    }
    // The library's class under a name of the repository: the library's meaning.
    assert_eq!(answers["GET /api/SubPlain"], "guarded");
    for class in [
        "ReadOnlyOrStaff",
        "OnlyView",
        "Compound",
        "CallsOut",
        "OtherRequest",
        "ObjectOnly",
        "SubAddsMethod",
        "SubSuperOr",
        "SuperOverBase",
        "SuperOverReadOnly",
        "Bound",
    ] {
        assert_eq!(answers[&format!("GET /api/{class}")], "unknown", "{class}");
        assert_eq!(listed(&inv, &format!("/api/{class}")), opaque(&[class]));
    }
    // Identified, not guarded.
    assert_eq!(answers["GET /api/Identified"], "no guard");

    // A class of the repository as the settings' default.
    let dir = drf(
        "AllowAny",
        "from rest_framework.permissions import BasePermission\n\n\nclass Open(BasePermission):\n    def has_permission(self, request, view):\n        return True\n\n\nclass Staff(BasePermission):\n    def has_permission(self, request, view):\n        return bool(request.user and request.user.is_staff)\n",
        "from rest_framework.response import Response\nfrom rest_framework.views import APIView\n\n\nclass Things(APIView):\n    def get(self, request):\n        return Response([])\n",
        "from django.urls import path\n\nfrom shipments import views\n\nurlpatterns = [path(\"things/\", views.Things.as_view())]\n",
    );
    let settings = dir.path().join("depot/settings.py");
    let text = std::fs::read_to_string(&settings).unwrap();
    for (class, answer) in [("Open", "no guard"), ("Staff", "guarded")] {
        let default = format!("shipments.permissions.{class}");
        std::fs::write(
            &settings,
            text.replace("rest_framework.permissions.AllowAny", &default),
        )
        .unwrap();
        assert_eq!(one_answer(dir.path())["GET /api/things"], answer, "{class}");
    }
}

/// [STRICT] Django's `user_passes_test(<test>)` and `UserPassesTestMixin` guard by
/// the test they run, and were guards whatever it said: `lambda u: True` counted.
/// The test is read: a guard only where it is false for a caller who is not signed
/// in (`u.is_authenticated`, `u.is_staff`, an `and` with one; `test_func` reading
/// `self.request.user`), no guard where it is `True`, unknown otherwise (another
/// attribute, a function of another module, a test given in the URLconf, a view
/// with the mixin and no `test_func`).
#[test]
fn a_django_user_test_guards_by_what_it_tests() {
    let dir = repo(&[
        (
            "manage.py",
            "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            "INSTALLED_APPS = [\"django.contrib.auth\", \"shop\"]\nROOT_URLCONF = \"proj.urls\"\nMIDDLEWARE = [\"django.middleware.common.CommonMiddleware\"]\n",
        ),
        (
            "proj/urls.py",
            r#"from django.contrib.auth.decorators import user_passes_test
from django.urls import path

from shop import views

urlpatterns = [
    path("lambda-true/", views.lambda_true),
    path("lambda-staff/", views.lambda_staff),
    path("lambda-auth/", views.lambda_auth),
    path("lambda-and/", views.lambda_and),
    path("lambda-other/", views.lambda_other),
    path("named-auth/", views.named_auth),
    path("named-true/", views.named_true),
    path("imported/", views.imported),
    path("true-and-unread/", views.true_and_unread),
    path("true-and-login/", views.true_and_login),
    path("mixin-auth/", views.MixinAuth.as_view()),
    path("mixin-true/", views.MixinTrue.as_view()),
    path("mixin-other/", views.MixinOther.as_view()),
    path("mixin-none/", views.MixinNone.as_view()),
    path("mixin-base/", views.MixinThroughBase.as_view()),
    path("mixin-base-true/", views.MixinOverBase.as_view()),
    path("method-decorator/", views.Decorated.as_view()),
    path("in-urls/", user_passes_test(lambda u: True)(views.plain)),
]
"#,
        ),
        ("shop/__init__.py", ""),
        (
            "shop/tests_of.py",
            "def elsewhere(user):\n    return user.is_authenticated\n",
        ),
        (
            "shop/views.py",
            r#"from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.mixins import UserPassesTestMixin
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View

from shop.tests_of import elsewhere


def is_member(user):
    return user.is_authenticated and user.groups.filter(name="members").exists()


def anyone(user):
    return True


@user_passes_test(lambda u: True)
def lambda_true(request):
    return JsonResponse({})


@user_passes_test(lambda u: u.is_staff)
def lambda_staff(request):
    return JsonResponse({})


@user_passes_test(lambda u: u.is_authenticated)
def lambda_auth(request):
    return JsonResponse({})


@user_passes_test(lambda u: u.is_authenticated and u.email.endswith("@example.com"))
def lambda_and(request):
    return JsonResponse({})


@user_passes_test(lambda u: u.email.endswith("@example.com"))
def lambda_other(request):
    return JsonResponse({})


@user_passes_test(is_member)
def named_auth(request):
    return JsonResponse({})


@user_passes_test(anyone)
def named_true(request):
    return JsonResponse({})


@user_passes_test(elsewhere)
def imported(request):
    return JsonResponse({})


@user_passes_test(anyone)
@user_passes_test(elsewhere)
def true_and_unread(request):
    return JsonResponse({})


@login_required
@user_passes_test(anyone)
def true_and_login(request):
    return JsonResponse({})


def plain(request):
    return JsonResponse({})


class MixinAuth(UserPassesTestMixin, View):
    def test_func(self):
        return self.request.user.is_authenticated

    def get(self, request):
        return JsonResponse({})


class MixinTrue(UserPassesTestMixin, View):
    def test_func(self):
        return True

    def get(self, request):
        return JsonResponse({})


class MixinOther(UserPassesTestMixin, View):
    def test_func(self):
        return self.request.GET.get("k") == "v"

    def get(self, request):
        return JsonResponse({})


class MixinNone(UserPassesTestMixin, View):
    def get(self, request):
        return JsonResponse({})


class StaffMixin(UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_staff


class MixinThroughBase(StaffMixin, View):
    def get(self, request):
        return JsonResponse({})


class MixinOverBase(StaffMixin, View):
    def test_func(self):
        return True

    def get(self, request):
        return JsonResponse({})


@method_decorator(user_passes_test(lambda u: True), name="dispatch")
class Decorated(View):
    def get(self, request):
        return JsonResponse({})
"#,
        ),
    ]);
    one_answer(dir.path());
    let authn = concern(dir.path(), "authn");
    let inv = json(dir.path(), &["security", "--json"]);
    const TEST: &str = "contrib.auth.decorators.user_passes_test";
    const MIXIN: &str = "contrib.auth.mixins.UserPassesTestMixin";
    for (unit, route) in [
        ("lambda_staff", "/lambda-staff"),
        ("lambda_auth", "/lambda-auth"),
        ("lambda_and", "/lambda-and"),
        ("named_auth", "/named-auth"),
    ] {
        assert_eq!(
            said(&authn, unit),
            ("known", format!("decorator:pkg:django#{TEST}").as_str()),
            "{unit}"
        );
        assert_eq!(listed(&inv, route), guarded(&[TEST]), "{route}");
    }
    for (unit, route) in [
        ("lambda_true", "/lambda-true"),
        ("named_true", "/named-true"),
        ("Decorated.get", "/method-decorator"),
        ("MixinTrue.get", "/mixin-true"),
        ("MixinOverBase.get", "/mixin-base-true"),
    ] {
        assert_eq!(said(&authn, unit).0, "none", "{unit}");
        assert_eq!(listed(&inv, route), Listed::NoGuard, "{route}");
    }
    for (unit, route, what) in [
        ("lambda_other", "/lambda-other", TEST),
        ("imported", "/imported", TEST),
        ("true_and_unread", "/true-and-unread", TEST),
        (
            "plain",
            "/in-urls",
            "contrib.auth.decorators.user_passes_test()",
        ),
        ("MixinOther.get", "/mixin-other", MIXIN),
        ("MixinNone.get", "/mixin-none", MIXIN),
    ] {
        assert_eq!(said(&authn, unit), ("unknown", "unresolved"), "{unit}");
        assert_eq!(listed(&inv, route), opaque(&[what]), "{route}");
    }
    // A test that is `True` beside a guard: the guard's.
    assert_eq!(said(&authn, "true_and_login").0, "known");
    assert_eq!(
        listed(&inv, "/true-and-login"),
        guarded(&["contrib.auth.decorators.login_required"])
    );
    // The mixin with a test that requires sign-in is the guard it was.
    for (unit, route) in [
        ("MixinAuth.get", "/mixin-auth"),
        ("MixinThroughBase.get", "/mixin-base"),
    ] {
        assert_eq!(
            said(&authn, unit),
            ("known", format!("base:pkg:django#{MIXIN}").as_str()),
            "{unit}"
        );
        assert_eq!(
            listed(&inv, route),
            guarded(&[&format!("{MIXIN} (base)")]),
            "{route}"
        );
    }
}

/// [STRICT] One answer on both surfaces, and never a fact on one where the other
/// holds an unknown that could change it. Three places where a Python route had
/// two:
///
/// - a handler that calls something whose definition is not in the facts: the
///   practice map said unknown (only where the call was awaited), `drift security`
///   "no guard". Unknown on both, awaited or not;
/// - a wrapper that could not be read beside a proven guard: the map said unknown,
///   the inventory guarded. The wrapper cannot remove the guard, and it may answer
///   before the guard runs (a cache around the view). Where it cannot (a FastAPI
///   dependency: every dependency runs before the handler; a decorator inside the
///   guard) the guard decides on both; where it may (a decorator outside the guard)
///   both say unknown;
/// - a view guarded by a base class (`LoginRequiredMixin`): known to the map, "no
///   guard" to the inventory, which did not read bases.
#[test]
fn a_python_route_has_one_answer_on_both_surfaces() {
    let fastapi = repo(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            r#"from fastapi import Depends, FastAPI, Header, HTTPException, Request

from app.generated import check_request, load_things
from somewhere import GUARDS

app = FastAPI()


def strict(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(401)
    return authorization


@app.get("/unread-await")
async def unread_await(request: Request):
    await check_request(request)
    return {}


@app.get("/unread-sync")
def unread_sync(request: Request):
    check_request(request)
    return {}


@app.get("/unread-load")
async def unread_load():
    return await load_things()


@app.get("/unread-await-and-guard")
async def unread_await_and_guard(request: Request, user=Depends(strict)):
    await check_request(request)
    return {}


@app.get("/unread-dependency")
def unread_dependency(x=Depends(GUARDS["audit"])):
    return {}


@app.get("/unread-dependency-and-guard", dependencies=[Depends(GUARDS["audit"])])
def unread_dependency_and_guard(user=Depends(strict)):
    return {}


@app.get("/guard")
def guard(user=Depends(strict)):
    return {}


@app.get("/nothing")
def nothing():
    return {}
"#,
        ),
    ]);
    let answers = one_answer(fastapi.path());
    for route in [
        "/unread-await",
        "/unread-sync",
        "/unread-load",
        "/unread-dependency",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "unknown", "{route}");
    }
    for route in [
        "/unread-await-and-guard",
        "/unread-dependency-and-guard",
        "/guard",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "guarded", "{route}");
    }
    assert_eq!(answers["GET /nothing"], "no guard");
    let inv = json(fastapi.path(), &["security", "--json"]);
    let authn = concern(fastapi.path(), "authn");
    assert_eq!(listed(&inv, "/unread-sync"), opaque(&["check_request"]));
    // The guard decides, and what was not read beside it is still listed.
    assert_eq!(
        said(&authn, "unread_dependency_and_guard"),
        ("known", "dependency:app/main.py#strict")
    );
    let row = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == "/unread-dependency-and-guard")
        .unwrap();
    assert_eq!(row["guards"], serde_json::json!(["strict"]));
    assert_eq!(row["opaque"], serde_json::json!(["unresolved:GUARDS[...]"]));

    let flask = repo(&[(
        "app/__init__.py",
        r#"import functools

from flask import Flask, abort, jsonify, session

from app.generated import audited
from somewhere import checks

app = Flask(__name__)


def login_required(view):
    @functools.wraps(view)
    def inner(*args, **kwargs):
        if not session.get("user_id"):
            abort(401)
        return view(*args, **kwargs)

    return inner


@app.get("/unread-outside")
@audited
@login_required
def unread_outside():
    return jsonify(ok=True)


@app.get("/unread-inside")
@login_required
@audited
def unread_inside():
    return jsonify(ok=True)


@app.get("/unread-only")
@audited
def unread_only():
    return jsonify(ok=True)


@app.get("/named-check")
def named_check():
    checks.verify()
    return jsonify(ok=True)
"#,
    )]);
    let answers = one_answer(flask.path());
    // Outside the guard it may answer first: unknown on both. Inside, the guard
    // has run.
    assert_eq!(answers["GET /unread-outside"], "unknown");
    assert_eq!(answers["GET /unread-inside"], "guarded");
    assert_eq!(answers["GET /unread-only"], "unknown");
    // A call that only its name says guards, in a package that is not read.
    assert_eq!(answers["GET /named-check"], "unknown");
    let inv = json(flask.path(), &["security", "--json"]);
    assert_eq!(
        listed(&inv, "/unread-outside"),
        opaque(&["login_required", "audited"])
    );

    let django = repo(&[
        (
            "manage.py",
            r#"import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["django.contrib.auth", "shop"]
ROOT_URLCONF = "proj.urls"
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from shop import views

urlpatterns = [
    path("login-mixin/", views.Login.as_view()),
    path("permission-mixin/", views.Permission.as_view()),
    path("plain/", views.Plain.as_view()),
]
"#,
        ),
        ("shop/__init__.py", ""),
        (
            "shop/views.py",
            r#"from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.http import JsonResponse
from django.views import View


class Login(LoginRequiredMixin, View):
    def get(self, request):
        return JsonResponse({})


class Permission(PermissionRequiredMixin, View):
    permission_required = "shop.view"

    def get(self, request):
        return JsonResponse({})


class Plain(View):
    def get(self, request):
        return JsonResponse({})
"#,
        ),
    ]);
    let answers = one_answer(django.path());
    assert_eq!(answers["GET /login-mixin"], "guarded");
    assert_eq!(answers["GET /permission-mixin"], "guarded");
    assert_eq!(answers["GET /plain"], "no guard");
    let inv = json(django.path(), &["security", "--json"]);
    assert_eq!(
        listed(&inv, "/login-mixin"),
        guarded(&["contrib.auth.mixins.LoginRequiredMixin (base)"])
    );
}

/// [STRICT] A Django mixin guards through its `dispatch`, which Python finds only
/// where the mixin comes before the first base that defines `dispatch`: `class
/// Archive(JsonListMixin, ListView, LoginRequiredMixin)` runs `View.dispatch` and
/// the mixin never. It read `known base:...LoginRequiredMixin`. A guard among the
/// bases is one where it comes first in the order methods are looked up in; after
/// a view class (directly, through a view of the repository, or by the order of a
/// diamond) it is none; where what comes before it may define `dispatch` and is
/// not read (a class of the repository with its own `dispatch`, a base that is not
/// in the facts) it is unknown.
#[test]
fn a_django_mixin_guards_only_before_the_view_class() {
    let dir = repo(&[
        (
            "manage.py",
            r#"import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["django.contrib.auth", "shop"]
ROOT_URLCONF = "proj.urls"
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from shop import views

urlpatterns = [
    path("first/", views.First.as_view()),
    path("after-view/", views.AfterView.as_view()),
    path("after-own-view/", views.AfterOwnView.as_view()),
    path("after-plain-mixin/", views.AfterPlainMixin.as_view()),
    path("after-dispatching/", views.AfterDispatching.as_view()),
    path("after-unread/", views.AfterUnread.as_view()),
    path("through-base/", views.ThroughBase.as_view()),
    path("through-bad-base/", views.ThroughBadBase.as_view()),
    path("test-after-view/", views.TestAfterView.as_view()),
    path("diamond/", views.Diamond.as_view()),
]
"#,
        ),
        ("shop/__init__.py", ""),
        (
            "shop/views.py",
            r#"from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.contrib.messages.views import SuccessMessageMixin
from django.http import JsonResponse
from django.views.generic import ListView, View

from shop.generated import Extra


class JsonListMixin:
    def render_to_response(self, context):
        return JsonResponse({})


class Dispatching:
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)


class OwnView(ListView):
    paginate_by = 10


class Protected(LoginRequiredMixin, View):
    pass


class Unprotected(View, LoginRequiredMixin):
    pass


class First(LoginRequiredMixin, ListView):
    def get(self, request):
        return JsonResponse({})


class AfterView(JsonListMixin, ListView, LoginRequiredMixin):
    def get(self, request):
        return JsonResponse({})


class AfterOwnView(OwnView, LoginRequiredMixin):
    def get(self, request):
        return JsonResponse({})


class AfterPlainMixin(JsonListMixin, SuccessMessageMixin, LoginRequiredMixin, ListView):
    def get(self, request):
        return JsonResponse({})


class AfterDispatching(Dispatching, LoginRequiredMixin, ListView):
    def get(self, request):
        return JsonResponse({})


class AfterUnread(Extra, LoginRequiredMixin, ListView):
    def get(self, request):
        return JsonResponse({})


class ThroughBase(Protected):
    def get(self, request):
        return JsonResponse({})


class ThroughBadBase(Unprotected):
    def get(self, request):
        return JsonResponse({})


class TestAfterView(View, UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_staff

    def get(self, request):
        return JsonResponse({})


class Left(LoginRequiredMixin):
    pass


class Right(View, LoginRequiredMixin):
    pass


class Diamond(Left, Right):
    def get(self, request):
        return JsonResponse({})
"#,
        ),
    ]);
    let answers = one_answer(dir.path());
    for route in ["/first", "/after-plain-mixin", "/through-base"] {
        assert_eq!(answers[&format!("GET {route}")], "guarded", "{route}");
    }
    for route in [
        "/after-view",
        "/after-own-view",
        "/through-bad-base",
        "/test-after-view",
        // `Diamond(Left, Right)`: Left, Right, View, LoginRequiredMixin.
        "/diamond",
    ] {
        assert_eq!(answers[&format!("GET {route}")], "no guard", "{route}");
    }
    for route in ["/after-dispatching", "/after-unread"] {
        assert_eq!(answers[&format!("GET {route}")], "unknown", "{route}");
    }
}

/// [STRICT] A helper of the repository that returns a value of the caller was no
/// source: `def current_venue_id(): return get_jwt()["venue_id"]` and then
/// `load(rid, current_venue_id())`, or `venue = current_venue_id()` compared with
/// the row's, read authorization `none`. Called with nothing or with the request,
/// a function whose body returns a value of the caller is a source, one call deep,
/// in the same module or another. So is an attribute of a request-scoped holder
/// under a name that says nothing (`g.venue_id`, `request.state.venue_id`) where a
/// hook or a middleware of the repository binds a value of the caller on it. Never
/// `none`, and nothing becomes known by it. A helper that returns a constant, and a
/// holder attribute nothing binds a caller's value on, give nothing: `none` as
/// before.
#[test]
fn a_helper_or_a_holder_that_gives_a_value_of_the_caller_is_a_source() {
    let flask = repo(&[
        (
            "app/__init__.py",
            r#"from flask import Flask, abort, g, jsonify
from flask_jwt_extended import get_jwt, jwt_required

from app import identity
from app.identity import tenant_of_caller
from app.models import Reservation, load, load_any

app = Flask(__name__)


def current_venue_id():
    return get_jwt()["venue_id"]


def default_page_size():
    return 20


@app.before_request
def remember_venue():
    g.venue_id = get_jwt()["venue_id"]
    g.started = 1


@app.get("/handed/<int:rid>")
@jwt_required()
def handed(rid):
    return jsonify(load(rid, current_venue_id()))


@app.get("/compared/<int:rid>")
@jwt_required()
def compared(rid):
    row = load_any(rid)
    venue = current_venue_id()
    if row.venue_id != venue:
        abort(404)
    return jsonify(row)


@app.get("/imported/<int:rid>")
@jwt_required()
def imported(rid):
    return jsonify(load(rid, tenant_of_caller()))


@app.get("/module/<int:rid>")
@jwt_required()
def module(rid):
    return jsonify(load(rid, identity.tenant_of_caller()))


@app.get("/filtered")
@jwt_required()
def filtered():
    return jsonify(Reservation.query.filter_by(venue_id=current_venue_id()).all())


@app.get("/held/<int:rid>")
@jwt_required()
def held(rid):
    return jsonify(load(rid, g.venue_id))


@app.get("/held-compared/<int:rid>")
@jwt_required()
def held_compared(rid):
    row = load_any(rid)
    if row.venue_id != g.venue_id:
        abort(404)
    return jsonify(row)


@app.get("/principal/<int:rid>")
@jwt_required()
def principal(rid):
    return jsonify(load(rid, g.principal.venue_id))


@app.get("/principal-method/<int:rid>")
@jwt_required()
def principal_method(rid):
    return jsonify(load(rid, g.principal.venue()))


@app.get("/control-constant/<int:rid>")
@jwt_required()
def control_constant(rid):
    return jsonify(load(rid, default_page_size()))


@app.get("/control-held/<int:rid>")
@jwt_required()
def control_held(rid):
    return jsonify(load(rid, g.started))


@app.get("/control-nothing/<int:rid>")
@jwt_required()
def control_nothing(rid):
    return jsonify(load_any(rid))
"#,
        ),
        (
            "app/identity.py",
            r#"from flask_jwt_extended import get_jwt


def tenant_of_caller():
    claims = get_jwt()
    return claims["venue_id"]
"#,
        ),
        (
            "app/models.py",
            r#"from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer)


def load(rid, venue_id):
    row = Reservation.query.get(rid)
    if row is None or row.venue_id != venue_id:
        return None
    return row


def load_any(rid):
    return Reservation.query.get(rid)
"#,
        ),
    ]);
    let authz = concern(flask.path(), "authz");
    for unit in [
        "handed",
        "compared",
        "imported",
        "module",
        "filtered",
        "held",
        "held_compared",
        // An attribute or a method of a principal a holder keeps: by the list as it
        // was (rule 5).
        "principal",
        "principal_method",
    ] {
        assert_eq!(said(&authz, unit).0, "unknown", "{unit}");
    }
    for unit in ["control_constant", "control_held", "control_nothing"] {
        assert_eq!(said(&authz, unit).0, "none", "{unit}");
    }
    // What was found is named: the loader, or the comparison.
    let found = unknown_instruments(&authz);
    for instrument in ["app/models.py#load", "scope_unread"] {
        assert!(
            found.iter().any(|(i, _)| i == instrument),
            "{instrument}: {found:?}"
        );
    }

    let fastapi = repo(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            r#"from fastapi import Depends, FastAPI, Header, HTTPException, Request

from app.store import load, load_any

app = FastAPI()


def strict(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(401)
    return authorization


def current_tenant(request: Request):
    return request.user.tenant_id


@app.middleware("http")
async def remember(request: Request, call_next):
    request.state.venue_id = request.session["venue_id"]
    return await call_next(request)


@app.get("/handed/{rid}")
def handed(rid: int, request: Request, user=Depends(strict)):
    return load(rid, current_tenant(request))


@app.get("/held/{rid}")
def held(rid: int, request: Request, user=Depends(strict)):
    return load(rid, request.state.venue_id)


@app.get("/held-compared/{rid}")
def held_compared(rid: int, req: Request, user=Depends(strict)):
    row = load_any(rid)
    if row.venue_id != req.state.venue_id:
        raise HTTPException(404)
    return row


@app.get("/control-nothing/{rid}")
def control_nothing(rid: int, user=Depends(strict)):
    return load_any(rid)
"#,
        ),
        (
            "app/store.py",
            r#"ROWS = {}


def load(rid, tenant_id):
    row = ROWS.get(rid)
    if row is None or row.tenant_id != tenant_id:
        return None
    return row


def load_any(rid):
    return ROWS.get(rid)
"#,
        ),
    ]);
    let authz = concern(fastapi.path(), "authz");
    for unit in ["handed", "held", "held_compared"] {
        assert_eq!(said(&authz, unit).0, "unknown", "{unit}");
    }
    assert_eq!(said(&authz, "control_nothing").0, "none");
}

/// A control. A value of any declared FastAPI dependency in a comparison counted
/// as the caller's: `r.region == db.info["region"]` with `db = Depends(get_db)`
/// read authorization unknown, where the body scopes nothing by the caller. What a
/// dependency gives is the caller's where it signs the caller in, which a reader
/// says: compared with the session's or the settings' value the handler reads
/// `none`; compared with the principal's it is unknown, never `none`, as before.
#[test]
fn a_value_of_a_dependency_that_gives_no_identity_is_not_the_callers() {
    let dir = repo(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            r#"from fastapi import Depends, FastAPI, Header, HTTPException

from app.store import load_any

app = FastAPI()


def strict(authorization: str | None = Header(None)):
    if not authorization:
        raise HTTPException(401)
    return {"sub": authorization, "depot_id": 1}


def get_db():
    return SessionLocal()


def get_settings():
    return {"region": "eu"}


@app.get("/db-filter")
def db_filter(db=Depends(get_db), user=Depends(strict)):
    return [r for r in load_any(0) if r.region == db.info["region"]]


@app.get("/settings-loop")
def settings_loop(settings=Depends(get_settings), user=Depends(strict)):
    out = []
    for r in load_any(0):
        if r.region != settings["region"]:
            continue
        out.append(r)
    return out


@app.get("/caller-refusal/{rid}")
def caller_refusal(rid: int, user=Depends(strict)):
    row = load_any(rid)
    if row.depot_id != user["depot_id"]:
        raise HTTPException(410)
    return row


@app.get("/caller-loop")
def caller_loop(principal=Depends(strict)):
    out = []
    for r in load_any(0):
        if r.depot_id != principal["depot_id"]:
            continue
        out.append(r)
    return out


@app.get("/caller-filter")
def caller_filter(principal=Depends(strict)):
    return [r for r in load_any(0) if r.depot_id == principal["depot_id"]]


@app.get("/nothing/{rid}")
def nothing(rid: int, user=Depends(strict)):
    return load_any(rid)
"#,
        ),
        (
            "app/store.py",
            "ROWS = {}\n\n\ndef load_any(rid):\n    return ROWS.get(rid)\n",
        ),
    ]);
    let authz = concern(dir.path(), "authz");
    for unit in ["db_filter", "settings_loop", "nothing"] {
        assert_eq!(said(&authz, unit).0, "none", "{unit}");
    }
    for unit in ["caller_refusal", "caller_loop", "caller_filter"] {
        assert_eq!(said(&authz, unit), ("unknown", "unclassified"), "{unit}");
    }
}
