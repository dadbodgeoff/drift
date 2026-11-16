//! Practice facts of Python code (facts schema 11): one fixture per fact, each with a
//! positive and a negative case, the caps, and a determinism check across thread
//! counts. The whole fixture's practice facts are snapshotted.

use std::path::Path;

use drift_core::practice::caps;
use drift_core::{CheckOutcome, FileFacts, RepoFacts, ResponseVia, Symbol, WrapKind};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scan_at(root: &Path, threads: usize) -> RepoFacts {
    scan(
        root,
        &ScanOptions {
            cache_dir: None,
            threads,
        },
    )
    .expect("scan")
    .0
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

const PYPROJECT: &str = r#"[project]
name = "acme"
dependencies = ["fastapi>=0.115", "django>=5", "flask>=3"]
[project.optional-dependencies]
test = ["respx"]
docs = ["mkdocs"]
[project.scripts]
acme-sync = "tools.sync:main"
[dependency-groups]
dev = ["pytest>=8", "fastapi"]
"#;

/// A repo with every practice fact, and a near miss for each.
fn fixture(r: &Path) {
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(r, "app/db.py", "class SessionLocal:\n    pass\n");
    write(
        r,
        "app/schemas.py",
        "from pydantic import BaseModel\n\nclass ItemIn(BaseModel):\n    name: str\n\nclass ItemOut(BaseModel):\n    id: int\n\nclass Filter(BaseModel):\n    q: str\n",
    );
    // FastAPI providers: one authenticates, one is a resource, one maps errors, and one
    // checks the tenant header against the user (split auth across two providers).
    write(
        r,
        "app/deps.py",
        r#"from typing import Annotated
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from app.db import SessionLocal

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def decode_token(token):
    return token


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate"
    )
    user = decode_token(token)
    if user is None:
        raise credentials_exception
    return user


def require_org(x_org_id: Annotated[str, Header()], user=Depends(get_current_user)):
    if user.org_id != x_org_id:
        raise HTTPException(status_code=403)
    return user


def map_errors():
    try:
        yield
    except KeyError as e:
        raise HTTPException(status_code=404) from e


def not_a_guard(item):
    if not item:
        raise HTTPException(status_code=404)
    return item
"#,
    );
    write(
        r,
        "app/routes.py",
        r#"import logging
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from app.deps import get_current_user, get_db, require_org
from app.schemas import Filter, ItemIn, ItemOut

logger = logging.getLogger(__name__)
router = APIRouter()
service_name = "svc"


def save(item):
    return item


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(item: ItemIn, db=Depends(get_db), user=Depends(require_org)):
    try:
        save(item)
    except ValueError as e:
        logger.exception("bad item", extra={"item": 1})
        raise HTTPException(status_code=422, detail="bad") from e
    except Exception:
        pass
    logger.info("created", exc_info=True)
    return item


@router.get(f"/{service_name}/health")
def health(request: Request, q: Annotated[Filter, Query()]):
    org = request.headers.get("X-Org-Id")
    if not request.state.user:
        raise HTTPException(401)
    if org != request.state.user.org_id:
        return JSONResponse(status_code=403, content={"error": "forbidden", "code": 1})
    print("ok", org)
    return {"ok": True}


def helper(item: ItemIn):
    logger.warning("not a route")
"#,
    );
    write(
        r,
        "app/errors.py",
        r#"from fastapi.responses import JSONResponse


class AppError(Exception):
    pass


async def handle_app_error(request, exc):
    return JSONResponse(status_code=400, content={"detail": "x"})


def drf_handler(exc, context):
    return None
"#,
    );
    write(
        r,
        "app/main.py",
        r#"from fastapi import FastAPI
from fastapi.responses import JSONResponse
from app.errors import AppError, handle_app_error
from app.routes import router

app = FastAPI()
app.include_router(router)
app.add_exception_handler(AppError, handle_app_error)


@app.exception_handler(KeyError)
async def key_error(request, exc):
    return JSONResponse(status_code=404, content={"detail": "missing"})
"#,
    );
    // Django and DRF.
    write(
        r,
        "proj/settings.py",
        r#"ROOT_URLCONF = "proj.urls"
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "proj.middleware.TenantMiddleware",
    "proj.middleware.TimingMiddleware",
]
REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "app.errors.drf_handler",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
}
"#,
    );
    // Middleware: one turns the caller away, one only times the request.
    write(
        r,
        "proj/middleware.py",
        r#"import time
from django.http import JsonResponse


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.headers.get("x-tenant-id"):
            return JsonResponse({"error": "unauthorized"}, status=401)
        return self.get_response(request)


class TimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.time()
        response = self.get_response(request)
        response["x-time"] = str(time.time() - start)
        return response
"#,
    );
    write(r, "proj/__init__.py", "");
    write(
        r,
        "proj/urls.py",
        "from django.urls import path\nfrom shop import views\n\nurlpatterns = [path(\"profile/\", views.profile), path(\"items/\", views.ItemView.as_view()), path(\"admin-items/\", views.AdminItemView.as_view())]\n",
    );
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/views.py",
        r#"from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from django.shortcuts import redirect
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from rest_framework.permissions import IsAdminUser
from shop.serializers import ItemSerializer


def profile(request):
    if not request.user.is_authenticated:
        return redirect("login")
    if not request.user.is_staff:
        raise PermissionDenied
    return JsonResponse({"ok": True}, status=200)


class AdminItemView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response({"id": 1})


class ItemView(APIView):
    serializer_class = ItemSerializer

    def post(self, request):
        s = ItemSerializer(data=request.data)
        if not s.is_valid():
            return Response(s.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response({"id": 1}, status=201)
"#,
    );
    write(
        r,
        "shop/serializers.py",
        "from rest_framework import serializers\n\nclass ItemSerializer(serializers.Serializer):\n    name = serializers.CharField()\n",
    );
    // Flask, flask-login, marshmallow, structlog and loguru.
    write(r, "web/__init__.py", "");
    write(
        r,
        "web/schemas.py",
        "from marshmallow import Schema, fields\n\nclass UserSchema(Schema):\n    name = fields.Str()\n",
    );
    write(
        r,
        "web/app.py",
        r#"import os
import structlog
from flask import Blueprint, Flask, abort, jsonify, request
from flask_login import current_user
from loguru import logger
from web.schemas import UserSchema

app = Flask(__name__)
log = structlog.get_logger()


@app.route("/me", methods=["POST"])
def me():
    if not current_user.is_authenticated:
        abort(401)
    data = UserSchema().load(request.json)
    log.info("loaded", user_id=1)
    logger.warning("plain")
    return jsonify(error="bad"), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "nf"}), 404


@app.before_request
def load_user():
    pass


bp = Blueprint("api", __name__, url_prefix="/api")


@bp.before_request
def check_key():
    if request.headers.get("x-api-key") != os.environ["API_KEY"]:
        abort(401)


@bp.route("/data")
def data():
    return jsonify(ok=1)


app.register_blueprint(bp)
"#,
    );
    // Compared with an env-derived secret: a constant bound from env, a pydantic
    // settings attribute, and an HMAC keyed with one; never with the env name.
    write(
        r,
        "app/settings.py",
        "import os\nfrom pydantic_settings import BaseSettings\n\nWEBHOOK_SECRET = os.environ[\"WEBHOOK_SECRET\"]\n\nclass Settings(BaseSettings):\n    api_key: str = \"\"\n\nsettings = Settings()\n",
    );
    write(
        r,
        "app/hooks.py",
        r#"import hashlib
import hmac
from fastapi import APIRouter, HTTPException, Request
from app.settings import WEBHOOK_SECRET, settings

router = APIRouter()


@router.post("/hook")
async def hook(request: Request):
    body = await request.body()
    expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("x-signature", ""), expected):
        raise HTTPException(status_code=401)
    return {"ok": True}


@router.get("/keyed")
def keyed(request: Request):
    if request.headers.get("x-api-key") != settings.api_key:
        raise HTTPException(status_code=401)
    return {}
"#,
    );
    // Env reads through a constant, a dict of names and a one-line helper.
    write(
        r,
        "app/config.py",
        r#"import os

KEY = "API_KEY"
NAMES = {"db": "DATABASE_URL"}


def _env(name, default=None):
    return os.environ.get(name, default)


def settings():
    a = os.environ[KEY]
    b = os.getenv(NAMES["db"])
    c = _env("REDIS_URL")
    d = _env(dynamic())
    return a, b, c, d


def dynamic():
    return "X"
"#,
    );
    // Entry kinds.
    write(
        r,
        "cli/main.py",
        "import click\n\n@click.group()\ndef cli():\n    pass\n\n@cli.command()\ndef run():\n    pass\n",
    );
    write(
        r,
        "tools/report.py",
        "import argparse\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.parse_args()\n\ndef other():\n    pass\n\nif __name__ == \"__main__\":\n    main()\n",
    );
    write(r, "tools/sync.py", "def main():\n    pass\n");
    write(
        r,
        "tools/plain.py",
        "def main():\n    pass\n\nif __name__ == \"__main__\":\n    main()\n",
    );
    write(
        r,
        "workers/base.py",
        "class QueueConsumer:\n    def handle(self, msg):\n        raise NotImplementedError\n\nclass Helper:\n    def handle(self, msg):\n        pass\n",
    );
    write(
        r,
        "workers/email.py",
        "from workers.base import Helper, QueueConsumer\n\nclass EmailConsumer(QueueConsumer):\n    def handle(self, msg):\n        pass\n\nclass NotConsumer(Helper):\n    pass\n",
    );
    write(
        r,
        "workers/jobs.py",
        "from rq.decorators import job\n\n@job(\"default\")\ndef send():\n    pass\n",
    );
    write(
        r,
        "langgraph.json",
        r#"{"graphs": {"agent": "./agent/graph.py:graph"}}"#,
    );
    write(
        r,
        "agent/graph.py",
        "from langgraph.graph import StateGraph\n\nbuilder = StateGraph(dict)\ngraph = builder.compile()\n",
    );
    // Tests.
    write(r, "tests/__init__.py", "");
    write(
        r,
        "tests/test_api.py",
        r#"from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app import routes

client = TestClient(app)


@patch("app.routes.save")
def test_create(mock_save, monkeypatch):
    monkeypatch.setattr("app.deps.decode_token", lambda t: None)
    monkeypatch.setattr(routes, "save", lambda i: i)
    r = client.post("/items", json={})
    assert r.status_code == 201
    r2 = client.get(f"/items/{1}")
    assert r2.status_code in (404, 401)


def test_other(mocker, respx_mock):
    mocker.patch("requests.get")
    url = "http://testserver/svc/health?x=1"
    resp = client.get(url)
    assert resp.status_code == 200


class TestProfile:
    def test_redirect(self):
        resp = self.client.get("/profile/")
        self.assertEqual(resp.status_code, 302)
"#,
    );
    // Not a test file: no requests or mocks recorded.
    write(
        r,
        "app/sync_client.py",
        "from unittest.mock import patch\nimport httpx\n\nclient = httpx.Client()\n\ndef pull():\n    patch(\"app.db.SessionLocal\")\n    return client.get(\"/upstream\")\n",
    );
}

#[test]
fn body_checks_and_headers() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let deps = file(&repo, "app/deps.py");

    // Authenticate: raises 401 on a missing user, read through a local binding.
    let gcu = symbol(deps, "get_current_user");
    assert_eq!(gcu.body_checks.len(), 1, "{:?}", gcu.body_checks);
    assert_eq!(gcu.body_checks[0].source, "app/deps.py#decode_token");
    assert_eq!(gcu.body_checks[0].outcome, CheckOutcome::Unauthenticated);

    // Tenant: the header compared with the user the other provider gives.
    let org = symbol(deps, "require_org");
    assert_eq!(org.headers, ["x-org-id"]);
    assert_eq!(org.body_checks.len(), 1, "{:?}", org.body_checks);
    let c = &org.body_checks[0];
    assert_eq!(c.source, "app/deps.py#get_current_user");
    assert_eq!(c.reads, ".org_id");
    assert_eq!(c.compares, "header:x-org-id");
    assert_eq!(c.outcome, CheckOutcome::Forbidden);

    // A resource and an error mapper turn nobody away; a 404 on a plain value is no
    // check on the caller.
    for name in ["get_db", "map_errors", "not_a_guard"] {
        assert!(symbol(deps, name).body_checks.is_empty(), "{name}");
    }

    // `request.state.user`, and a header read in the body.
    let routes = file(&repo, "app/routes.py");
    let health = symbol(routes, "health");
    assert_eq!(health.headers, ["x-org-id"]);
    let srcs: Vec<(&str, &str, &str, CheckOutcome)> = health
        .body_checks
        .iter()
        .map(|b| {
            (
                b.source.as_str(),
                b.reads.as_str(),
                b.compares.as_str(),
                b.outcome,
            )
        })
        .collect();
    assert!(
        srcs.contains(&(
            "param:request",
            ".state.user",
            "",
            CheckOutcome::Unauthenticated
        )),
        "{srcs:?}"
    );
    assert!(
        srcs.contains(&(
            "header:x-org-id",
            "",
            "param:request",
            CheckOutcome::Forbidden
        )),
        "{srcs:?}"
    );

    // Django `request.user.is_authenticated` (sign-in redirect) and a staff check.
    let views = file(&repo, "shop/views.py");
    let profile = symbol(views, "profile");
    let got: Vec<(&str, &str, CheckOutcome)> = profile
        .body_checks
        .iter()
        .map(|b| (b.source.as_str(), b.reads.as_str(), b.outcome))
        .collect();
    assert_eq!(
        got,
        [
            (
                "param:request",
                ".user.is_authenticated",
                CheckOutcome::SignInRedirect
            ),
            ("param:request", ".user.is_staff", CheckOutcome::Forbidden),
        ]
    );
    // Flask `current_user`.
    let me = symbol(file(&repo, "web/app.py"), "me");
    assert_eq!(me.body_checks.len(), 1);
    assert_eq!(me.body_checks[0].source, "pkg:flask_login#current_user");
    assert_eq!(me.body_checks[0].reads, ".is_authenticated");
}

#[test]
fn app_level_checkpoints() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let wraps = |path: &str, sym: &str| -> Vec<(String, WrapKind)> {
        symbol(file(&repo, path), sym)
            .wraps
            .iter()
            .map(|w| (w.wrapper.clone(), w.kind))
            .collect()
    };
    let tenant = (
        "proj/middleware.py#TenantMiddleware".to_string(),
        WrapKind::Config,
    );
    let timing = (
        "proj/middleware.py#TimingMiddleware".to_string(),
        WrapKind::Config,
    );
    // A Django view and a DRF view both run the rejecting middleware; the timing one
    // turns nobody away and is no checkpoint.
    let profile = wraps("shop/views.py", "profile");
    assert!(profile.contains(&tenant), "{profile:?}");
    assert!(!profile.contains(&timing), "{profile:?}");
    let item = wraps("shop/views.py", "ItemView.post");
    assert!(item.contains(&tenant), "{item:?}");
    assert!(
        item.contains(&(
            "pkg:rest_framework#permissions.IsAuthenticated".into(),
            WrapKind::Config
        )),
        "{item:?}"
    );
    assert!(
        item.contains(&(
            "pkg:rest_framework#authentication.TokenAuthentication".into(),
            WrapKind::ConfigAuthenticates
        )),
        "{item:?}"
    );
    // A view's own `permission_classes` replaces the default.
    let admin = wraps("shop/views.py", "AdminItemView.get");
    assert!(
        admin.contains(&(
            "pkg:rest_framework#permissions.IsAdminUser".into(),
            WrapKind::Call
        )),
        "{admin:?}"
    );
    assert!(
        !admin.iter().any(|(w, _)| w.ends_with("IsAuthenticated")),
        "{admin:?}"
    );
    // Flask: the app's hook runs before every route (an app hook), the blueprint's before
    // its own routes (a guard of the route, as a call wrapper).
    let data = wraps("web/app.py", "data");
    assert!(
        data.contains(&("web/app.py#check_key".into(), WrapKind::Call)),
        "{data:?}"
    );
    assert!(
        data.contains(&("web/app.py#load_user".into(), WrapKind::AppHook)),
        "{data:?}"
    );
    let me = wraps("web/app.py", "me");
    assert!(
        me.contains(&("web/app.py#load_user".into(), WrapKind::AppHook)),
        "{me:?}"
    );
    assert!(!me.iter().any(|(w, _)| w.ends_with("#check_key")), "{me:?}");
}

#[test]
fn compares_with_env_secrets() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let checks = |path: &str, sym: &str| -> Vec<(String, String, CheckOutcome)> {
        symbol(file(&repo, path), sym)
            .body_checks
            .iter()
            .map(|b| (b.source.clone(), b.compares.clone(), b.outcome))
            .collect()
    };
    let unauth = |h: &str| {
        vec![(
            format!("header:{h}"),
            "env".to_string(),
            CheckOutcome::Unauthenticated,
        )]
    };
    assert_eq!(checks("web/app.py", "check_key"), unauth("x-api-key"));
    assert_eq!(checks("app/hooks.py", "hook"), unauth("x-signature"));
    assert_eq!(checks("app/hooks.py", "keyed"), unauth("x-api-key"));
    // The tenant header compared with the user is no env compare.
    assert_eq!(
        symbol(file(&repo, "app/deps.py"), "require_org").body_checks[0].compares,
        "header:x-org-id"
    );
    // The env name is never echoed.
    let json = serde_json::to_string(&repo).unwrap();
    assert!(!json.contains("\"env:"), "env name echoed");
}

#[test]
fn responses_catches_and_handlers() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let routes = file(&repo, "app/routes.py");
    let create = symbol(routes, "create_item");
    let declared: Vec<_> = create
        .responses
        .iter()
        .filter(|r| r.via == ResponseVia::Declared)
        .collect();
    assert_eq!(declared.len(), 1);
    assert_eq!(declared[0].status, 201);
    assert_eq!(declared[0].model, "app/schemas.py#ItemOut");
    let thrown = create
        .responses
        .iter()
        .find(|r| r.via == ResponseVia::Throw)
        .expect("raise HTTPException");
    assert_eq!(
        (thrown.status, thrown.builder.as_str(), thrown.in_catch),
        (422, "pkg:fastapi#HTTPException", true)
    );
    // `except ValueError` logs and maps to 422; `except Exception: pass` swallows.
    let catches: Vec<(Vec<&str>, Vec<&str>)> = create
        .catches
        .iter()
        .map(|c| {
            (
                c.catches.iter().map(String::as_str).collect(),
                c.does.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert!(
        catches.contains(&(vec!["global#Exception"], vec!["swallow"])),
        "{catches:?}"
    );
    assert!(
        catches.contains(&(
            vec!["global#ValueError"],
            vec!["log", "respond:422", "throw:pkg:fastapi#HTTPException"]
        )),
        "{catches:?}"
    );
    // `JSONResponse(status_code=403, content={...})`: the envelope's keys.
    let health = symbol(routes, "health");
    let json = health
        .responses
        .iter()
        .find(|r| r.status == 403)
        .expect("JSONResponse");
    assert_eq!(json.builder, "pkg:fastapi#responses.JSONResponse");
    assert_eq!(json.keys, ["code", "error"]);
    // A plain dict return is no response fact.
    assert_eq!(health.responses.len(), 2, "{:?}", health.responses);

    // DRF `Response(status=...)`, Flask tuples and `abort`.
    let post = symbol(file(&repo, "shop/views.py"), "ItemView.post");
    let statuses: Vec<u16> = post.responses.iter().map(|r| r.status).collect();
    assert_eq!(statuses, [201, 400]);
    let me = symbol(file(&repo, "web/app.py"), "me");
    let vias: Vec<(u16, ResponseVia)> = me.responses.iter().map(|r| (r.status, r.via)).collect();
    assert!(vias.contains(&(401, ResponseVia::Abort)), "{vias:?}");
    assert!(vias.contains(&(400, ResponseVia::Return)), "{vias:?}");

    // Handlers: decorator, `add_exception_handler`, Flask `errorhandler(404)`, DRF setting.
    let main = file(&repo, "app/main.py");
    assert_eq!(
        symbol(main, "key_error").handles_errors,
        ["global#KeyError"]
    );
    let errors = file(&repo, "app/errors.py");
    assert_eq!(
        symbol(errors, "handle_app_error").handles_errors,
        ["app/errors.py#AppError"]
    );
    assert_eq!(symbol(errors, "drf_handler").handles_errors, ["*"]);
    assert!(symbol(errors, "AppError").handles_errors.is_empty());
    assert_eq!(
        symbol(file(&repo, "web/app.py"), "not_found").handles_errors,
        ["status:404"]
    );
}

#[test]
fn log_calls() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let routes = file(&repo, "app/routes.py");
    let create = symbol(routes, "create_item");
    let calls: Vec<(&str, &str, bool, bool, bool)> = create
        .log_calls
        .iter()
        .map(|l| {
            (
                l.callee.as_str(),
                l.level.as_str(),
                l.in_catch,
                l.structured,
                l.passes_error,
            )
        })
        .collect();
    assert_eq!(
        calls,
        [
            (
                "app/routes.py#logger.exception",
                "exception",
                true,
                true,
                false
            ),
            ("app/routes.py#logger.info", "info", false, false, true),
        ]
    );
    let health = symbol(routes, "health");
    assert_eq!(health.log_calls.len(), 1);
    assert_eq!(
        (
            health.log_calls[0].callee.as_str(),
            health.log_calls[0].level.as_str()
        ),
        ("global#print", "print")
    );
    let me = symbol(file(&repo, "web/app.py"), "me");
    let got: Vec<(&str, &str, bool)> = me
        .log_calls
        .iter()
        .map(|l| (l.callee.as_str(), l.level.as_str(), l.structured))
        .collect();
    assert_eq!(
        got,
        [
            ("pkg:loguru#logger.warning", "warn", false),
            ("web/app.py#log.info", "info", true),
        ]
    );
    // A level-named method on a function-local value is no candidate.
    assert!(
        symbol(file(&repo, "app/deps.py"), "get_db")
            .log_calls
            .is_empty()
    );
}

#[test]
fn inputs() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let routes = file(&repo, "app/routes.py");
    assert_eq!(
        symbol(routes, "create_item").inputs,
        ["app/schemas.py#ItemIn"]
    );
    assert_eq!(symbol(routes, "health").inputs, ["app/schemas.py#Filter"]);
    // Not an entry point: its annotation is no request input.
    assert!(symbol(routes, "helper").inputs.is_empty());
    let views = file(&repo, "shop/views.py");
    assert_eq!(
        symbol(views, "ItemView").inputs,
        ["shop/serializers.py#ItemSerializer"]
    );
    assert_eq!(
        symbol(views, "ItemView.post").inputs,
        ["shop/serializers.py#ItemSerializer"]
    );
    assert_eq!(
        symbol(file(&repo, "web/app.py"), "me").inputs,
        ["web/schemas.py#UserSchema"]
    );
}

#[test]
fn testing_facts() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let t = file(&repo, "tests/test_api.py");
    let reqs: Vec<(&str, &str, Vec<u16>)> = t
        .test_requests
        .iter()
        .map(|r| (r.method.as_str(), r.route.as_str(), r.statuses.clone()))
        .collect();
    assert_eq!(
        reqs,
        [
            ("GET", "/items/[*]", vec![201, 401, 404]),
            ("GET", "/profile", vec![302]),
            ("GET", "/svc/health", vec![200]),
            ("POST", "/items", vec![201, 401, 404]),
        ]
    );
    assert_eq!(
        t.mocks,
        ["app/deps.py", "app/routes.py", "pkg:httpx", "pkg:requests"]
    );
    let other = file(&repo, "app/sync_client.py");
    assert!(other.test_requests.is_empty() && other.mocks.is_empty());
}

/// A route with a non-literal part (an f-string, a variable, a `url_for` call) is
/// `dynamic`; a plain string is not.
#[test]
fn test_requests_dynamic() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "tests/test_dyn.py",
        r#"from flask import url_for

BASE = "/api"


def test_routes(client, item_id):
    client.get("/plain")
    client.get(f"/items/{item_id}")
    url = "/bound"
    client.get(url)
    client.post(url_for("items.create"))
    client.delete(BASE + "/x")
"#,
    );
    let repo = scan_at(r, 1);
    let got: Vec<(&str, &str, bool)> = file(&repo, "tests/test_dyn.py")
        .test_requests
        .iter()
        .map(|t| (t.method.as_str(), t.route.as_str(), t.dynamic))
        .collect();
    assert_eq!(
        got,
        [
            ("DELETE", "", true),
            ("GET", "/bound", true),
            ("GET", "/items/[*]", true),
            ("GET", "/plain", false),
            ("POST", "", true),
        ]
    );
}

#[test]
fn dev_only_packages() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    write(dir.path(), "svc/requirements.txt", "flask==3.1\n");
    write(
        dir.path(),
        "svc/requirements-dev.txt",
        "pytest==8\nflask==3.1\n",
    );
    write(dir.path(), "svc/app.py", "import flask\n");
    let repo = scan_at(dir.path(), 1);
    let root = repo.packages.iter().find(|p| p.path.is_empty()).unwrap();
    // `fastapi` is also a runtime dependency; `mkdocs` is in a feature extra.
    assert_eq!(root.dev_only, ["pytest", "respx"]);
    let svc = repo.packages.iter().find(|p| p.path == "svc").unwrap();
    assert_eq!(svc.dev_only, ["pytest"]);
}

#[test]
fn env_reads_routes_and_entry_kinds() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let settings = symbol(file(&repo, "app/config.py"), "settings");
    assert_eq!(
        settings.reads,
        [
            "os.environ.API_KEY",
            "os.environ.DATABASE_URL",
            "os.environ.REDIS_URL"
        ]
    );
    let entries: Vec<String> = repo
        .files
        .iter()
        .flat_map(|f| {
            f.entry_points.iter().map(move |e| {
                format!(
                    "{} {} {} {} {}",
                    f.path,
                    e.symbol,
                    e.kind,
                    e.route.as_deref().unwrap_or("-"),
                    e.adapter
                )
            })
        })
        .filter(|e| !e.contains(" http "))
        .collect();
    assert_eq!(
        entries,
        [
            "agent/graph.py graph agent_graph - langgraph",
            "cli/main.py cli cli - click",
            "cli/main.py run cli - click",
            "tools/report.py main cli - argparse",
            "tools/sync.py main cli - console_script",
            "workers/email.py EmailConsumer consumer - queue",
            "workers/jobs.py send consumer - rq",
        ]
    );
    let health = file(&repo, "app/routes.py")
        .entry_points
        .iter()
        .find(|e| e.symbol == "health")
        .unwrap();
    // An interpolation in a path is not a path parameter: what it stands for is not read.
    assert_eq!(health.route.as_deref(), Some("/?/health"));
}

/// A console script naming the `main` an `if __name__` guard already runs is one entry
/// point, not two: the one read from the code is kept, and the declared one is added
/// only where the code shows none.
#[test]
fn a_console_script_naming_an_argparse_main_is_one_entry_point() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\nversion = \"0\"\n[project.scripts]\nacme-report = \"tools.report:main\"\nacme-sync = \"tools.sync:main\"\n",
    );
    write(r, "tools/__init__.py", "");
    write(
        r,
        "tools/report.py",
        "import argparse\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.parse_args()\n\nif __name__ == \"__main__\":\n    main()\n",
    );
    write(r, "tools/sync.py", "def main():\n    pass\n");
    let repo = scan_at(r, 1);
    let entries = |path: &str| -> Vec<String> {
        file(&repo, path)
            .entry_points
            .iter()
            .map(|e| format!("{} {} {}", e.symbol, e.kind, e.adapter))
            .collect()
    };
    assert_eq!(entries("tools/report.py"), ["main cli argparse"]);
    assert_eq!(entries("tools/sync.py"), ["main cli console_script"]);
}

/// Loggers whose receiver does not resolve are traced: an attribute set in `__init__`
/// or at class level, a local bound to a factory, a parameter; `bound` for loggers
/// derived with fields.
#[test]
fn traced_and_bound_loggers() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/log.py",
        r#"import logging
import structlog
from loguru import logger as base

log = structlog.get_logger().bind(service="svc")


class Service:
    logger = logging.getLogger("svc.cls")

    def __init__(self, injected, name):
        self.log = logging.getLogger(__name__)
        self.inj = injected
        self.req = base.bind(request_id=name)

    def run(self):
        self.log.info("a")
        self.inj.warning("b")
        self.req.error("c")
        self.logger.debug("d")
        self.cache.info()


def handler(logger, items):
    logger.info("e")
    local = logging.getLogger(__name__)
    local.error("f")
    scoped = structlog.get_logger(user_id=1)
    scoped.info("g")
    log.info("h")
    base.bind(user=1).info("i")
    base.info("j")
    items.get("k")
"#,
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "svc/log.py");
    let calls = |name: &str| -> Vec<(String, String, bool)> {
        symbol(f, name)
            .log_calls
            .iter()
            .map(|l| (l.callee.clone(), l.level.clone(), l.bound))
            .collect()
    };
    let t = |c: &str, l: &str, b: bool| (c.to_string(), l.to_string(), b);
    assert_eq!(
        calls("Service"),
        [
            t("param:injected.warning", "warn", false),
            t("pkg:loguru#logger.error", "error", true),
            t("pkg:python:logging#getLogger().debug", "debug", false),
            t("pkg:python:logging#getLogger().info", "info", false),
        ]
    );
    assert_eq!(
        calls("handler"),
        [
            t("param:logger.info", "info", false),
            t("pkg:loguru#logger.bind().info", "info", true),
            t("pkg:loguru#logger.info", "info", false),
            t("pkg:python:logging#getLogger().error", "error", false),
            t("pkg:structlog#get_logger().info", "info", true),
            t("svc/log.py#log.info", "info", true),
        ]
    );
}

/// Data-access calls filtering on a tenant-like key, with where the value came from.
#[test]
fn scoped_queries() {
    use drift_core::ScopeSource as S;
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/models.py",
        "class Item:\n    pass\n\nclass Project:\n    pass\n",
    );
    write(
        r,
        "shop/tenancy.py",
        r#"from django.db.models import Q
from django.shortcuts import get_object_or_404
from fastapi import Depends, Header
from sqlalchemy import select
from shop.models import Item, Project


def get_current_user():
    return None


def list_items(request, org_id):
    a = Item.objects.filter(organization=request.user.organization)
    b = Item.objects.filter(organization_id=org_id)
    c = get_object_or_404(Project, workspace__id=7, pk=1)
    d = Item.objects.filter(Q(team=request.user.team))
    e = Item.objects.filter(name="x", account_type="y")
    f = Item.objects.exclude(tenant=request.profile.tenant)
    g = Item.objects.get(org=request.GET["org"])
    return a, b, c, d, e, f, g


def sa(session, x_tenant_id: str = Header(), user=Depends(get_current_user)):
    session.execute(select(Item).where(Item.tenant_id == x_tenant_id))
    return session.execute(select(Item).where(Item.org_id == user.org_id))


def unknown(session, value):
    org = lookup(value)
    return session.query(Item).filter_by(org_id=org)
"#,
    );
    let mut many = String::from("from shop.models import Item\n\ndef many(request):\n");
    for key in [
        "org_id",
        "organization_id",
        "tenant_id",
        "team_id",
        "workspace_id",
        "account_id",
        "org",
        "team",
        "tenant",
        "workspace",
    ] {
        many.push_str(&format!(
            "    Item.objects.filter({key}=request.user.org)\n"
        ));
    }
    write(r, "shop/many.py", &many);
    let repo = scan_at(r, 1);
    let f = file(&repo, "shop/tenancy.py");
    let q = |name: &str| -> Vec<(String, String, S)> {
        symbol(f, name)
            .scoped_queries
            .iter()
            .map(|x| (x.callee.clone(), x.key.clone(), x.source))
            .collect()
    };
    let filter = "shop/models.py#Item.objects.filter".to_string();
    assert_eq!(
        q("list_items"),
        [
            (
                "pkg:django#shortcuts.get_object_or_404".into(),
                "workspace__id".into(),
                S::Literal
            ),
            (
                "shop/models.py#Item.objects.exclude".into(),
                "tenant".into(),
                S::Session
            ),
            (filter.clone(), "organization".into(), S::Session),
            (filter.clone(), "organization_id".into(), S::Param),
            (filter.clone(), "team".into(), S::Session),
            (
                "shop/models.py#Item.objects.get".into(),
                "org".into(),
                S::Param
            ),
        ]
    );
    let where_ = "pkg:sqlalchemy#select().where".to_string();
    assert_eq!(
        q("sa"),
        [
            (where_.clone(), "org_id".into(), S::Session),
            (where_, "tenant_id".into(), S::Header),
        ]
    );
    assert_eq!(q("unknown"), [(String::new(), "org_id".into(), S::Unknown)]);
    let m = symbol(file(&repo, "shop/many.py"), "many");
    assert_eq!(
        m.scoped_queries.len(),
        drift_core::practice::caps::SCOPED_QUERIES
    );
    assert!(
        m.truncated.iter().any(|t| t == "scoped_queries"),
        "{:?}",
        m.truncated
    );
}

/// One distribution ships an empty `acme/__init__.py`; the others are PEP 420
/// portions. Its imports of `acme.<sub>` resolve to the sibling that ships `acme/<sub>/`.
#[test]
fn namespace_with_one_regular_package() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for p in ["alpha", "beta", "gamma"] {
        write(
            r,
            &format!("pkgs/{p}/pyproject.toml"),
            &format!("[project]\nname = \"acme-{p}\"\n"),
        );
    }
    write(
        r,
        "pkgs/alpha/acme/alpha/__init__.py",
        "def a():\n    pass\n",
    );
    write(r, "pkgs/beta/acme/beta/core.py", "def b():\n    pass\n");
    write(r, "pkgs/gamma/acme/__init__.py", "");
    write(
        r,
        "pkgs/gamma/acme/gamma.py",
        "import acme.alpha\nfrom acme.beta import core\nfrom acme import beta\n\ndef g():\n    core.b()\n",
    );
    let repo = scan_at(r, 1);
    let g = file(&repo, "pkgs/gamma/acme/gamma.py");
    let modules: Vec<&str> = g.imports.iter().map(|i| i.module.as_str()).collect();
    assert!(
        modules.contains(&"pkgs/alpha/acme/alpha/__init__.py"),
        "{modules:?}"
    );
    assert!(
        modules.contains(&"pkgs/beta/acme/beta/core.py"),
        "{modules:?}"
    );
    assert!(modules.contains(&"pkgs/beta/acme/beta"), "{modules:?}");
    assert!(
        !modules.iter().any(|m| m.starts_with("unresolved:")),
        "{modules:?}"
    );
    assert_eq!(symbol(g, "g").calls, ["pkgs/beta/acme/beta/core.py#b"]);
}

/// Every new list stays within its cap, whatever the file holds.
#[test]
fn caps_hold() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let mut body = String::from(
        "import logging\nfrom fastapi import HTTPException, Request\nlogger = logging.getLogger(__name__)\n",
    );
    for i in 0..40 {
        body.push_str(&format!("logger{i} = logging.getLogger(\"l{i}\")\n"));
    }
    body.push_str("\ndef big(request: Request, user):\n");
    for i in 0..40 {
        body.push_str(&format!(
            "    logger{i}.info(\"m{i}\", extra={{\"k{i}\": {i}}})\n"
        ));
        body.push_str(&format!("    request.headers.get(\"x-h{i}\")\n"));
        body.push_str(&format!(
            "    try:\n        pass\n    except E{i}:\n        logger.error(\"e\")\n"
        ));
        body.push_str(&format!(
            "    if user.v{i} != request.headers.get(\"x-h{i}\"):\n        raise HTTPException(status_code=403)\n"
        ));
        body.push_str(&format!(
            "    if user.w{i}:\n        raise HTTPException(status_code={})\n",
            400 + i
        ));
    }
    write(r, "big.py", &body);
    let mut test = String::from("from unittest.mock import patch\n\n");
    for i in 0..300 {
        test.push_str(&format!(
            "@patch(\"m{i}.x\")\ndef test_{i}(client):\n    r = client.get(\"/r{i}\")\n    assert r.status_code == 200\n"
        ));
    }
    write(r, "tests/test_big.py", &test);
    let repo = scan_at(r, 1);
    let s = symbol(file(&repo, "big.py"), "big");
    assert_eq!(s.log_calls.len(), caps::LOG_CALLS);
    assert_eq!(s.headers.len(), caps::HEADERS);
    assert_eq!(s.catches.len(), caps::CATCHES);
    assert_eq!(s.body_checks.len(), caps::BODY_CHECKS);
    assert_eq!(s.responses.len(), caps::RESPONSES);
    let t = file(&repo, "tests/test_big.py");
    assert_eq!(t.test_requests.len(), caps::TEST_REQUESTS);
    assert_eq!(t.mocks.len(), caps::MOCKS);
}

/// Lowered twice, on 1 and on 4 threads: byte-identical facts.
#[test]
fn deterministic_across_threads() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let one = serde_json::to_string(&scan_at(dir.path(), 1)).unwrap();
    let again = serde_json::to_string(&scan_at(dir.path(), 1)).unwrap();
    let four = serde_json::to_string(&scan_at(dir.path(), 4)).unwrap();
    assert_eq!(one, again);
    assert_eq!(one, four);
}

/// The fixture's practice facts, file by file.
#[test]
fn practice_facts_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let repo = scan_at(dir.path(), 1);
    let mut out = serde_json::Map::new();
    for f in &repo.files {
        let mut syms = serde_json::Map::new();
        for s in &f.symbols {
            let v = serde_json::json!({
                "body_checks": s.body_checks,
                "responses": s.responses,
                "log_calls": s.log_calls,
                "catches": s.catches,
                "headers": s.headers,
                "inputs": s.inputs,
                "handles_errors": s.handles_errors,
                "scoped_queries": s.scoped_queries,
            });
            let empty = v
                .as_object()
                .unwrap()
                .values()
                .all(|x| x.as_array().is_some_and(Vec::is_empty));
            if !empty {
                syms.insert(s.name.clone(), v);
            }
        }
        let mut fv = serde_json::Map::new();
        if !syms.is_empty() {
            fv.insert("symbols".into(), syms.into());
        }
        if !f.test_requests.is_empty() {
            fv.insert("test_requests".into(), serde_json::json!(f.test_requests));
        }
        if !f.mocks.is_empty() {
            fv.insert("mocks".into(), serde_json::json!(f.mocks));
        }
        if !fv.is_empty() {
            out.insert(f.path.clone(), fv.into());
        }
    }
    let packages: Vec<_> = repo
        .packages
        .iter()
        .map(|p| serde_json::json!({"path": p.path, "dev_only": p.dev_only}))
        .collect();
    out.insert("(packages)".into(), packages.into());
    insta::assert_snapshot!(
        "practice_facts",
        serde_json::to_string_pretty(&sorted(serde_json::Value::Object(out))).unwrap()
    );
}

/// `v` with every object's keys in sorted order, whether or not serde_json preserves
/// insertion order (a feature another workspace crate may turn on).
fn sorted(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(m) => {
            let mut items: Vec<(String, serde_json::Value)> = m.into_iter().collect();
            items.sort_by(|a, b| a.0.cmp(&b.0));
            serde_json::Value::Object(items.into_iter().map(|(k, x)| (k, sorted(x))).collect())
        }
        serde_json::Value::Array(a) => {
            serde_json::Value::Array(a.into_iter().map(sorted).collect())
        }
        other => other,
    }
}

/// A method of a local, or of a parameter no annotation types, is not recorded: the
/// body that hands it a value says so ([`drift_core::controls::UNREAD_CALL`]). A typed
/// receiver's method and a module-level name's call are recorded, and a call given
/// nothing or a literal hands nothing on.
#[test]
fn a_value_handed_to_a_call_the_facts_do_not_record_is_said() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/svc.py",
        "class Store:\n    def load(self, key):\n        return key\n\n\ndef untyped(exporter, key):\n    return exporter.run(key)\n\n\ndef local(key):\n    rows = []\n    rows.append(key)\n    return rows\n\n\ndef keyword(exporter, key):\n    return exporter.run(key=key)\n\n\ndef typed(store: Store, key):\n    return store.load(key)\n\n\ndef literal(exporter, rows):\n    exporter.flush()\n    rows.pop(-1)\n    rows.sort(key=lambda r: r.created)\n    return rows.get(\"k\")\n\n\ndef named(key):\n    return str(key)\n",
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let unread = |name: &str| {
        symbol(f, name)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::UNREAD_CALL)
    };
    for name in ["untyped", "local", "keyword"] {
        assert!(unread(name), "{name}: {:?}", symbol(f, name).controls);
    }
    for name in ["typed", "literal", "named"] {
        assert!(!unread(name), "{name}: {:?}", symbol(f, name).controls);
    }
}

/// A mock library named bare is recorded wherever it stands in a dotted chain: as a
/// decorator (`@respx.mock`, `@responses.activate`), under a longer chain
/// (`respx.mock.get(...)`), and through `from respx import mock`. A chain that only
/// passes through other names is not one. (The chain is read once, from its base: the
/// release `stack_bound` test, which lowers a chain of the size cap, is what times it.)
/// What a service class's method does for authorization, read from the method alone
/// (lowering 24): the conditions that raise an error class, its scoped queries and the
/// keys its calls pass; and the class an `Annotated[...]` dependency alias annotates.
#[test]
fn a_service_methods_own_checks_and_a_dependency_alias_are_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/errors.py",
        "class ForbiddenError(Exception):\n    pass\n",
    );
    write(
        r,
        "app/services.py",
        r#"from fastapi import HTTPException
from sqlalchemy import select

from app.errors import ForbiddenError
from app.models import Rule


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_rules(self, org_id, user_id=None):
        if org_id != self.caller.org_id:
            raise ForbiddenError("another organization")
        if user_id is not None and user_id != self.caller.user_id:
            raise ForbiddenError("another user")
        return select(Rule).where(Rule.org_id == org_id)

    def check(self, org_id, other):
        active = {}
        if org_id != active.id:
            raise HTTPException(status_code=403)
        if not org_id:
            return None
        try:
            return other.load(org_id)
        except KeyError:
            if org_id != self.caller.org_id:
                raise ForbiddenError("in a handler: says nothing")


def plain(org_id, caller):
    if org_id != caller.org_id:
        raise ForbiddenError("another organization")
    if org_id == "x":
        raise ValueError("a builtin is no class of the repo")
"#,
    );
    write(r, "app/models.py", "class Rule:\n    org_id = None\n");
    write(
        r,
        "app/deps.py",
        r#"from typing import Annotated

from fastapi import Depends

from app.services import RuleBook


def get_rule_book() -> RuleBook:
    return RuleBook(None)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
OptionalDep = Annotated[RuleBook | None, Depends(get_rule_book)]
TextDep = Annotated[str, Depends(get_rule_book)]
PLAIN = Depends(get_rule_book)
"#,
    );
    let repo = scan_at(r, 1);
    let deps = file(&repo, "app/deps.py");
    assert_eq!(
        symbol(deps, "RuleBookDep").alias_of,
        "app/services.py#RuleBook"
    );
    assert_eq!(
        symbol(deps, "OptionalDep").alias_of,
        "app/services.py#RuleBook"
    );
    // A builtin is named as one, and a bare `Depends` has no type at all.
    assert_eq!(symbol(deps, "TextDep").alias_of, "global#str");
    assert_eq!(symbol(deps, "PLAIN").alias_of, "");

    let services = file(&repo, "app/services.py");
    let class = symbol(services, "RuleBook");
    let member = |name: &str| {
        class
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    };
    let raised = |c: &drift_core::RaiseCheck| {
        (
            c.source.clone(),
            c.reads.clone(),
            c.compares.clone(),
            c.raises.clone(),
            c.status,
        )
    };
    let forbidden = "app/errors.py#ForbiddenError".to_string();
    let own = |a: &str, b: &str, c: &str| {
        (
            a.to_string(),
            b.to_string(),
            c.to_string(),
            forbidden.clone(),
            0,
        )
    };
    let list = member("list_rules");
    assert_eq!(
        list.raise_checks.iter().map(raised).collect::<Vec<_>>(),
        [
            own("param:org_id", "", "param:self"),
            // `user_id is not None`: a test of the value itself.
            own("param:user_id", "", ""),
            own("param:user_id", "", "param:self"),
        ]
    );
    assert_eq!(
        list.scoped_queries
            .iter()
            .map(|q| (q.callee.as_str(), q.key.as_str(), q.source))
            .collect::<Vec<_>>(),
        [(
            "pkg:sqlalchemy#select().where",
            "org_id",
            drift_core::ScopeSource::Param
        )]
    );
    // A raise that states its status carries it; a comparison with a value that could
    // not be read is still a comparison; a `return` and a raise in an `except` handler
    // are no raise checks.
    assert_eq!(
        member("check")
            .raise_checks
            .iter()
            .map(raised)
            .collect::<Vec<_>>(),
        [(
            "param:org_id".to_string(),
            String::new(),
            drift_core::UNREAD_COMPARE.to_string(),
            "pkg:fastapi#HTTPException".to_string(),
            403
        )]
    );
    // The same of a plain function. A builtin's class is recorded too (lowering 35):
    // what an exit is for is in what its condition compares, not in the class raised.
    assert_eq!(
        symbol(services, "plain")
            .raise_checks
            .iter()
            .map(raised)
            .collect::<Vec<_>>(),
        [
            (
                "param:org_id".to_string(),
                String::new(),
                "literal".to_string(),
                "global#ValueError".to_string(),
                0
            ),
            own("param:org_id", "", "param:caller")
        ]
    );
    // Additive: a symbol with none of these has none of the new keys.
    let json = serde_json::to_value(symbol(deps, "get_rule_book")).unwrap();
    for key in ["alias_of", "raise_checks"] {
        assert!(json.get(key).is_none(), "{key}");
    }
}

#[test]
fn a_mock_library_named_bare_is_a_mock_wherever_it_stands_in_a_chain() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "tests/__init__.py", "");
    let cases = [
        (
            "decorated",
            "import respx\n\n\n@respx.mock\ndef test_x():\n    pass\n",
            vec!["pkg:httpx"],
        ),
        (
            "activated",
            "import responses\n\n\n@responses.activate\ndef test_x():\n    pass\n",
            vec!["pkg:requests"],
        ),
        (
            "chained",
            "import respx\n\n\ndef test_x():\n    respx.mock.get(\"http://x/\").respond(200)\n",
            vec!["pkg:httpx"],
        ),
        (
            "imported",
            "from respx import mock\n\n\ndef test_x():\n    route = mock.routes\n",
            vec!["pkg:httpx"],
        ),
        (
            "other",
            "import respx\nimport responses\n\n\ndef test_x():\n    a = respx.models.mock\n    b = responses.matchers.activate\n",
            vec![],
        ),
    ];
    for (name, body, _) in &cases {
        write(r, &format!("tests/test_{name}.py"), body);
    }
    // A long chain (under the scan's nesting limit) is read from its base.
    write(
        r,
        "tests/test_long.py",
        &format!(
            "import respx\n\n\ndef test_x():\n    v = respx.mock{}\n",
            ".b".repeat(200)
        ),
    );
    let repo = scan_at(r, 1);
    for (name, _, mocks) in &cases {
        assert_eq!(
            &file(&repo, &format!("tests/test_{name}.py")).mocks,
            mocks,
            "{name}"
        );
    }
    assert_eq!(file(&repo, "tests/test_long.py").mocks, ["pkg:httpx"]);
}

/// A check records how its condition compares ([`drift_core::check_op`]): whether the
/// caller is turned away where the two values differ or where they match, through
/// `not`, and nothing for a test of the value itself.
#[test]
fn a_check_records_which_way_its_comparison_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/errors.py",
        "class ForbiddenError(Exception):\n    pass\n",
    );
    write(
        r,
        "app/services.py",
        r#"from fastapi import HTTPException

from app.errors import ForbiddenError


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def differs(self, org_id):
        if org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def matches(self, org_id):
        if org_id == self.caller.org_id:
            raise ForbiddenError("your own organization")

    def not_among(self, org_id):
        if org_id not in self.caller.org_ids:
            raise ForbiddenError("another organization")

    def negated(self, org_id):
        if not (org_id == self.caller.org_id):
            raise ForbiddenError("another organization")

    def negated_twice(self, org_id):
        if not (org_id != self.caller.org_id):
            raise ForbiddenError("your own organization")

    def asked(self, org_id):
        if not self.caller.org_id or org_id is None:
            raise ForbiddenError("no organization")

    def ordered(self, level):
        if self.caller.level < level:
            raise ForbiddenError("too low")

    def stated(self, org_id, user):
        if user.org_id == org_id:
            raise HTTPException(status_code=403, detail="forbidden")
"#,
    );
    let repo = scan_at(r, 1);
    let class = symbol(file(&repo, "app/services.py"), "RuleBook");
    let ops = |name: &str| -> Vec<String> {
        class
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("{name}"))
            .raise_checks
            .iter()
            .map(|c| c.op.clone())
            .collect()
    };
    assert_eq!(ops("differs"), ["ne"]);
    assert_eq!(ops("matches"), ["eq"]);
    assert_eq!(ops("not_among"), ["ne"]);
    assert_eq!(ops("negated"), ["ne"]);
    assert_eq!(ops("negated_twice"), ["eq"]);
    assert_eq!(ops("asked"), ["", ""]);
    assert_eq!(ops("ordered"), ["other"]);
    // The body check of the same condition says the same.
    let stated = class.members.iter().find(|m| m.name == "stated").unwrap();
    assert_eq!(stated.raise_checks[0].op, "eq");
    assert_eq!(stated.body_checks[0].op, "eq");
    // Additive: a test of the value itself has no `op` key.
    let asked = class.members.iter().find(|m| m.name == "asked").unwrap();
    let json = serde_json::to_value(&asked.raise_checks[0]).unwrap();
    assert!(json.get("op").is_none(), "{json}");
}

/// A method records the repository's decorators on it
/// ([`drift_core::Member::decorators`]): what runs around its body, canonical,
/// outermost first; a built-in's or a package's is not recorded.
#[test]
fn a_method_records_its_decorators() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/guards.py",
        "def require_role(role):\n    def wrap(fn):\n        return fn\n    return wrap\n\n\ndef audited(fn):\n    return fn\n",
    );
    write(
        r,
        "app/services.py",
        "import functools\n\nfrom app.guards import audited, require_role\n\n\nclass RuleBook:\n    @audited\n    @require_role(\"admin\")\n    def delete_rule(self, rule_id):\n        return rule_id\n\n    @staticmethod\n    def plain(x):\n        return x\n\n    @functools.cache\n    def cached(self):\n        return 1\n\n    def ping(self):\n        return True\n",
    );
    let repo = scan_at(r, 1);
    let class = symbol(file(&repo, "app/services.py"), "RuleBook");
    let member = |name: &str| class.members.iter().find(|m| m.name == name).unwrap();
    assert_eq!(
        member("delete_rule").decorators,
        ["app/guards.py#audited", "app/guards.py#require_role"]
    );
    assert!(member("plain").decorators.is_empty());
    assert!(member("cached").decorators.is_empty());
    // Additive: a method with none has no `decorators` key.
    let json = serde_json::to_value(member("ping")).unwrap();
    assert!(json.get("decorators").is_none(), "{json}");
}

/// A module-level name bound to `None` (or `...`) is bound later
/// ([`drift_core::controls::LATE_BOUND`]); one bound to a value is not.
#[test]
fn a_module_name_bound_to_nothing_is_late_bound() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/state.py",
        "from typing import Optional\n\nrule_book = None\nclient: Optional[object] = None\nlater = ...\nNAMES = {\"a\": 1}\n\n\ndef init(caller):\n    global rule_book\n    rule_book = object()\n",
    );
    let repo = scan_at(r, 1);
    let state = file(&repo, "app/state.py");
    let late = |name: &str| {
        symbol(state, name)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::LATE_BOUND)
    };
    for name in ["rule_book", "client", "later"] {
        assert!(late(name), "{name}");
    }
    assert!(!late("NAMES"));
}

/// A check inside a branch only some requests take is recorded as conditional
/// ([`drift_core::RaiseCheck::conditional`]): under another `if`, in the `elif` of a
/// branch that goes on, in a loop. One after a branch that leaves, in a `try` or a
/// `with`, is not.
#[test]
fn a_check_under_another_branch_is_conditional() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/errors.py",
        "class ForbiddenError(Exception):\n    pass\n",
    );
    write(
        r,
        "app/services.py",
        r#"from app.errors import ForbiddenError


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def flat(self, org_id):
        if not org_id:
            raise ValueError("no organization")
        try:
            with open("x") as f:
                if org_id != self.caller.org_id:
                    raise ForbiddenError("another organization")
        finally:
            pass

    def nested(self, org_id, scope):
        if scope == "org":
            if org_id != self.caller.org_id:
                raise ForbiddenError("another organization")

    def chained(self, org_id, scope):
        if scope == "global":
            scope = "all"
        elif org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def after_leaving(self, org_id):
        if not org_id:
            raise ValueError("no organization")
        elif org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def looped(self, org_ids):
        for org_id in org_ids:
            if org_id != self.caller.org_id:
                raise ForbiddenError("another organization")
"#,
    );
    let repo = scan_at(r, 1);
    let class = symbol(file(&repo, "app/services.py"), "RuleBook");
    let conditional = |name: &str| -> Vec<bool> {
        class
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("{name}"))
            .raise_checks
            .iter()
            .filter(|c| c.raises.ends_with("ForbiddenError"))
            .map(|c| c.conditional)
            .collect()
    };
    assert_eq!(conditional("flat"), [false]);
    assert_eq!(conditional("nested"), [true]);
    assert_eq!(conditional("chained"), [true]);
    assert_eq!(conditional("after_leaving"), [false]);
    assert_eq!(conditional("looped"), [true]);
    // Additive: a check every request reaches has no `conditional` key.
    let flat = class.members.iter().find(|m| m.name == "flat").unwrap();
    let json = serde_json::to_value(&flat.raise_checks).unwrap();
    assert!(!json.to_string().contains("conditional"), "{json}");
}

/// A method called on a local or on what a dependency injects is recorded by what the
/// receiver is ([`drift_core::Symbol::receiver_calls`]), and by the receiver's name
/// where that cannot be told and the call hands a value on. A plain value's method is
/// not recorded. What a function hands back and what `__init__` binds are facts too.
#[test]
fn a_call_on_a_local_or_an_injected_value_is_recorded_by_its_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/services.py",
        r#"from sqlalchemy.orm import Session


class Repo:
    def __init__(self, db: Session):
        self.db = db

    def find(self, key):
        return self.db.get(Repo, key)


class RuleBook(Repo):
    def __init__(self, db: Session, caller, clock=None):
        super().__init__(db)
        self.caller = caller
        self.repo = Repo(db)

    def list_rules(self, org_id):
        self.db.execute(org_id)
        self.repo.db.flush()
        self.caller.audit(org_id)
        self.caller.touch()
        return self.find(org_id)
"#,
    );
    write(
        r,
        "app/deps.py",
        r#"from typing import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.services import RuleBook

SessionLocal = sessionmaker()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_rule_book(db=Depends(get_db)) -> RuleBook:
    return RuleBook(db, None)


def get_exporter(request: Request):
    return request.app.state.exporter


def pick(flag) -> RuleBook:
    if flag:
        return RuleBook(None, None)
    return None
"#,
    );
    write(
        r,
        "app/routes.py",
        r#"from fastapi import APIRouter, Depends

from app.deps import get_db, get_exporter, get_rule_book
from app.services import RuleBook

router = APIRouter()


@router.get("/built")
async def built(org_id: str, db=Depends(get_db)):
    svc = RuleBook(db, None)
    return svc.list_rules(org_id)


@router.get("/injected")
async def injected(org_id: str, service=Depends(get_rule_book), exporter=Depends(get_exporter)):
    rows = service.list_rules(org_id)
    return exporter.run(rows)


@router.get("/plain")
async def plain(org_id: str, names: list[str], other):
    out = []
    out.append(org_id)
    label = ", ".join(names)
    counts = {}
    counts.update(a=org_id)
    names.append(label)
    for row in names:
        row.attach(org_id)
    other.notify(org_id)
    other.ping()
    return out
"#,
    );
    let repo = scan_at(r, 1);
    let routes = file(&repo, "app/routes.py");
    assert_eq!(
        symbol(routes, "built").receiver_calls,
        ["app/services.py#RuleBook().list_rules"]
    );
    assert_eq!(
        symbol(routes, "injected").receiver_calls,
        [
            "app/deps.py#get_exporter().run",
            "app/deps.py#get_rule_book().list_rules"
        ]
    );
    // A list, a dict and a string are plain values; a loop variable and a parameter
    // with no type are not known, and named where a value is handed to them.
    assert_eq!(
        symbol(routes, "plain").receiver_calls,
        ["local:row.attach", "param:other.notify"]
    );
    let deps = file(&repo, "app/deps.py");
    assert_eq!(
        symbol(deps, "get_db").returns_instance,
        "app/deps.py#SessionLocal"
    );
    assert_eq!(
        symbol(deps, "get_db").returns_type,
        "pkg:sqlalchemy#orm.Session"
    );
    assert_eq!(
        symbol(deps, "get_rule_book").returns_instance,
        "app/services.py#RuleBook"
    );
    assert_eq!(symbol(deps, "get_exporter").returns_instance, "");
    // Two returns that disagree: only the annotation says what comes back.
    assert_eq!(symbol(deps, "pick").returns_instance, "");
    assert_eq!(
        symbol(deps, "pick").returns_type,
        "app/services.py#RuleBook"
    );
    let services = file(&repo, "app/services.py");
    let service = symbol(services, "RuleBook");
    assert_eq!(
        service.attr_types,
        ["repo=app/services.py#Repo"],
        "{:?}",
        service.attr_types
    );
    assert_eq!(
        symbol(services, "Repo").attr_types,
        ["db=pkg:sqlalchemy#orm.Session"]
    );
    let list = service
        .members
        .iter()
        .find(|m| m.name == "list_rules")
        .unwrap();
    assert_eq!(
        list.receiver_calls,
        [
            // Through an attribute `__init__` builds.
            "app/services.py#Repo.db.flush",
            // An attribute the class's own `__init__` does not type, a value handed on:
            // named by the class, for a base class's `__init__` to say what it is.
            "app/services.py#RuleBook.caller.audit",
            "app/services.py#RuleBook.db.execute",
            // A method the class body does not define: a base's.
            "app/services.py#RuleBook.find",
        ]
    );
    // Additive: a symbol with none of these has none of the new keys.
    let json = serde_json::to_value(symbol(deps, "get_exporter")).unwrap();
    for key in [
        "receiver_calls",
        "returns_instance",
        "returns_type",
        "attr_types",
    ] {
        assert!(json.get(key).is_none(), "{key}");
    }
    // The control that says a value was handed to an unrecorded call is unchanged.
    for name in ["built", "injected", "plain"] {
        assert!(
            symbol(routes, name)
                .controls
                .iter()
                .any(|c| c == drift_core::controls::UNREAD_CALL),
            "{name}"
        );
    }
}

/// A message consumer is an entry point of its own kind: a subclass of an in-repo base
/// that defines `consume` and uses a messaging library in its body. A base only named
/// for one (`BaseRabbitMQConsumer`, an acronym being a word of its own) is not listed
/// in the listed reading: it is said, with its line, as named only. A class that only
/// shares the method name is none.
#[test]
fn a_subclass_of_a_queue_consumer_base_is_a_consumer_entry_point() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/base.py",
        r#"import aio_pika


class BaseRabbitMQConsumer:
    def __init__(self, url):
        self.url = url

    async def consume(self):
        raise NotImplementedError


class Intake:
    async def consume(self):
        connection = await aio_pika.connect_robust("amqp://")
        return connection


class Reader:
    def consume(self):
        return None
"#,
    );
    write(
        r,
        "app/consumer.py",
        r#"import asyncio

from app.base import BaseRabbitMQConsumer, Intake, Reader


class AbConsumer(BaseRabbitMQConsumer):
    async def _messages_handler(self, *messages):
        return None


class OrderIntake(Intake):
    pass


class FileReader(Reader):
    pass


async def _run():
    consumer = AbConsumer("amqp://")
    await consumer.consume()


if __name__ == "__main__":
    asyncio.run(_run())
"#,
    );
    let repo = scan_at(r, 1);
    // A base that uses a library is a listing made since the measured build:
    // `drift security` reads it, mining does not yet ([`drift_core::Listed`]).
    let consumer = file(&repo, "app/consumer.py");
    assert!(consumer.entry_points.is_empty());
    let entries: Vec<String> = consumer
        .listed_entry_points()
        .iter()
        .map(|e| format!("{} {} {}", e.symbol, e.kind, e.adapter))
        .collect();
    assert_eq!(entries, ["OrderIntake consumer aio_pika"]);
    assert_eq!(
        consumer.unlisted(),
        [drift_core::UnlistedRoute {
            line: 6,
            reason: drift_core::UnlistedReason::NamedOnly
        }]
    );
}

/// A check or a call that does not run for every request says why
/// ([`drift_core::not_always`]) and, where the code states it, when: under a branch,
/// after a branch that returns without refusing, as an operand of `and`, on the right
/// of `or`, in a `try` whose handler serves the request all the same. A callee the body
/// also calls on every path is not listed; a handler that answers with an error
/// swallows nothing; an early `raise` skips nothing.
#[test]
fn a_check_or_a_call_only_some_requests_reach_says_why() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/helpers.py",
        "def assert_same_org(rule, caller):\n    if rule.org_id != caller.org_id:\n        raise PermissionError()\n\n\ndef audit(x):\n    return x\n\n\ndef load(x):\n    return x\n",
    );
    write(
        r,
        "app/svc.py",
        r#"from fastapi import HTTPException

from app.helpers import assert_same_org, audit, load


class RuleBook:
    def _assert(self, rule, caller):
        if rule.visibility == Visibility.SHARED:
            return
        if rule.tenant_id != caller.tenant_id:
            raise HTTPException(status_code=403)

    def get(self, rule_id, caller):
        rule = load(rule_id)
        if rule is None:
            raise HTTPException(status_code=404)
        self._assert(rule, caller)
        return rule

    def update(self, rule_id, caller, preview):
        rule = load(rule_id)
        if preview:
            return {"preview": True}
        self._assert(rule, caller)
        return rule

    def delete(self, rule, caller):
        if caller.org_id is not None and rule.org_id != caller.org_id:
            raise HTTPException(status_code=403)
        return caller.is_support or assert_same_org(rule, caller)

    def swallow(self, rule, caller):
        try:
            assert_same_org(rule, caller)
        except Exception:
            audit("denied")
        return rule

    def both(self, rule, caller, flag):
        if flag:
            assert_same_org(rule, caller)
        assert_same_org(rule, caller)
        for x in rule.items:
            audit(x)
        try:
            load(rule)
        except KeyError:
            return {"error": "x"}, 404
"#,
    );
    let repo = scan_at(r, 1);
    let class = symbol(file(&repo, "app/svc.py"), "RuleBook");
    let member = |name: &str| {
        class
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    };
    let conditional = |name: &str| member(name).conditional_calls.clone();
    let checks = |name: &str| -> Vec<(String, String)> {
        member(name)
            .raise_checks
            .iter()
            .filter(|c| c.op == "ne")
            .map(|c| (c.condition.clone(), c.unless.clone()))
            .collect()
    };
    assert_eq!(
        checks("_assert"),
        [(
            "after_conditional_return".to_string(),
            "not when rule.visibility == Visibility.SHARED".to_string()
        )]
    );
    assert!(conditional("get").is_empty(), "{:?}", conditional("get"));
    assert_eq!(
        conditional("update"),
        ["after_conditional_return:app/svc.py#RuleBook._assert"]
    );
    assert_eq!(
        checks("delete"),
        [(
            "and_operand".to_string(),
            "only when caller.org_id is not None".to_string()
        )]
    );
    assert_eq!(
        conditional("delete"),
        ["bypass_operand:app/helpers.py#assert_same_org"]
    );
    assert_eq!(
        conditional("swallow"),
        ["swallowed:app/helpers.py#assert_same_org"]
    );
    assert_eq!(conditional("both"), ["under_branch:app/helpers.py#audit"]);
    // Additive: a body every call and check of which always runs has neither key.
    let json = serde_json::to_value(member("get")).unwrap().to_string();
    assert!(
        !json.contains("conditional_calls") && !json.contains("unless"),
        "{json}"
    );
}

/// Three more places a call does not run for every request: after a `return` every
/// request reaches, in a function defined inside the body that the body never names
/// again, and in the body of an `elif`, also where the branch before it leaves. A
/// function the body returns (a decorator's wrapper) is read as a body of its own.
#[test]
fn a_call_after_the_return_or_in_a_function_never_called_does_not_run() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/helpers.py",
        "def assert_same_org(rule, caller):\n    if rule.org_id != caller.org_id:\n        raise PermissionError()\n",
    );
    write(
        r,
        "app/svc.py",
        r#"from app.helpers import assert_same_org


def after_return(rule, caller):
    return rule
    assert_same_org(rule, caller)


def never_called(rule, caller):
    def later():
        assert_same_org(rule, caller)

    return rule


def wrapper_returned(view):
    def wrapper(rule, caller):
        assert_same_org(rule, caller)
        return view(rule, caller)

    return wrapper


def in_elif(rule, caller, kind):
    if kind is None:
        raise ValueError()
    elif kind == "org":
        assert_same_org(rule, caller)
    return rule


def in_else(rule, caller, kind):
    if kind is None:
        raise ValueError()
    else:
        assert_same_org(rule, caller)
    return rule
"#,
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let conditional = |name: &str| symbol(f, name).conditional_calls.clone();
    let helper = "app/helpers.py#assert_same_org";
    assert_eq!(
        conditional("after_return"),
        [format!("after_conditional_return:{helper}")]
    );
    assert_eq!(
        conditional("never_called"),
        [format!("under_branch:{helper}")]
    );
    assert!(conditional("wrapper_returned").is_empty());
    assert_eq!(conditional("in_elif"), [format!("under_branch:{helper}")]);
    assert!(conditional("in_else").is_empty());
}

/// `super().__init__(...)` is a call of the one base's method, so a check in the
/// base's constructor can be read; with several bases it stays `super().__init__`. A
/// method called on what a framework object's `state` bag holds is recorded as a
/// call on a receiver that cannot be told.
#[test]
fn a_super_call_names_the_base_and_a_state_bag_hides_its_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/svc.py",
        r#"from fastapi import Request


class Base:
    def __init__(self, caller, org_id):
        if org_id != caller.org_id:
            raise PermissionError()


class Mixin:
    pass


class One(Base):
    def __init__(self, caller, org_id):
        super().__init__(caller, org_id)


class Two(Base, Mixin):
    def __init__(self, caller, org_id):
        super().__init__(caller, org_id)


def from_state(request: Request, caller, org_id):
    return request.app.state.rules.list_checked(caller, org_id)
"#,
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let init = |class: &str| {
        symbol(f, class)
            .members
            .iter()
            .find(|m| m.name == "__init__")
            .unwrap()
            .receiver_calls
            .clone()
    };
    assert_eq!(init("One"), ["app/svc.py#Base.__init__"]);
    assert_eq!(init("Two"), ["local:super().__init__"]);
    assert_eq!(
        symbol(f, "from_state").receiver_calls,
        ["param:request.state.rules.list_checked"]
    );
}

/// What a body does that no check records (lowering 35). `unread_exit`: it turns
/// requests away on a condition the facts do not hold (a comparison bound to a name,
/// `any(...)`, a raise after a branch that returned, an `else` of one, an `assert`).
/// `scope_unread`: it compares or filters by a tenant or owner key outside the
/// condition of a refusing exit (a comprehension, a branch that returns `None`, a path
/// through a tenant, SQL as text). A method's are in `unread`, with `status:403` where
/// it answers 403. A condition that was read, an `assert` that narrows a type and SQL
/// that names no key leave nothing unread; a call or a check in the `else` of a branch
/// that returned is conditional.
#[test]
fn what_a_body_refuses_or_scopes_by_and_no_check_records_is_said() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/helpers.py",
        "def assert_same_org(rule, caller):\n    if rule.org_id != caller.org_id:\n        raise PermissionError()\n",
    );
    write(
        r,
        "app/svc.py",
        r#"from fastapi import HTTPException

from app.helpers import assert_same_org


def flag(rule, caller):
    same = rule.org_id == caller.org_id
    if not same:
        raise HTTPException(status_code=404)
    return rule


def any_of(rule, caller):
    if not any(m.org_id == rule.org_id for m in caller.memberships):
        raise LookupError()
    return rule


def return_then_raise(rule, caller):
    if rule.org_id == caller.org_id:
        return rule
    raise HTTPException(status_code=404)


def else_raise(rule, caller):
    if rule.org_id == caller.org_id:
        return rule
    else:
        raise LookupError()


def asserted(rule, caller):
    assert rule.org_id == caller.org_id
    return rule


def or_none(rule, caller):
    if rule.org_id != caller.org_id:
        return None
    return rule


def comprehension(rules, caller):
    return [r for r in rules if r.org_id == caller.org_id]


def relationship(caller):
    return caller.organization.rules


def raw_sql(db, caller):
    return db.execute("SELECT * FROM rules WHERE org_id = :org", {"org": caller.org_id})


def read(rule, caller):
    if rule is None:
        raise LookupError()
    if rule.org_id != caller.org_id:
        raise ValueError()
    assert rule is not None
    assert isinstance(rule, object)
    return caller.organization.name


def plain_sql(db):
    return db.execute("SELECT * FROM users WHERE active")


def cached_else(rule, caller, cached):
    if cached:
        return cached
    else:
        assert_same_org(rule, caller)
    return rule


def cached_elif(rule, caller, cached):
    if cached:
        return cached
    elif rule.org_id != caller.org_id:
        raise HTTPException(status_code=403)
    return rule


class Service:
    def always_forbidden(self):
        raise HTTPException(status_code=403)

    def flag(self, rule):
        ok = rule.org_id == self.caller.org_id
        if not ok:
            raise HTTPException(status_code=403)
        return rule

    def read(self, rule):
        if rule is None:
            raise LookupError()
        return rule
"#,
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let unread = |name: &str| -> Vec<String> {
        symbol(f, name)
            .controls
            .iter()
            .filter(|c| matches!(c.as_str(), "unread_exit" | "scope_unread"))
            .cloned()
            .collect()
    };
    assert_eq!(unread("flag"), ["scope_unread", "unread_exit"]);
    // The comparison is in the condition of the exit: the exit is what is unread.
    assert_eq!(unread("any_of"), ["unread_exit"]);
    assert_eq!(unread("return_then_raise"), ["scope_unread", "unread_exit"]);
    assert_eq!(unread("else_raise"), ["scope_unread", "unread_exit"]);
    assert_eq!(unread("asserted"), ["scope_unread", "unread_exit"]);
    assert_eq!(unread("or_none"), ["scope_unread"]);
    assert_eq!(unread("comprehension"), ["scope_unread"]);
    assert_eq!(unread("relationship"), ["scope_unread"]);
    assert_eq!(unread("raw_sql"), ["scope_unread"]);
    assert!(unread("read").is_empty(), "{:?}", unread("read"));
    assert!(unread("plain_sql").is_empty());
    // A builtin's class is a raise check as any other.
    assert!(
        symbol(f, "read")
            .raise_checks
            .iter()
            .any(|c| c.raises == "global#ValueError" && c.reads == ".org_id" && c.op == "ne"),
        "{:?}",
        symbol(f, "read").raise_checks
    );
    // The `else` and the `elif` of a branch that returned without refusing.
    assert_eq!(
        symbol(f, "cached_else").conditional_calls,
        ["after_conditional_return:app/helpers.py#assert_same_org"]
    );
    let elif = &symbol(f, "cached_elif").raise_checks;
    assert!(
        !elif.is_empty()
            && elif
                .iter()
                .all(|c| c.condition == "after_conditional_return"),
        "{elif:?}"
    );
    let service = symbol(f, "Service");
    let member = |name: &str| {
        service
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap()
            .unread
            .clone()
    };
    assert_eq!(member("always_forbidden"), ["status:403"]);
    // (`param_flows`, lowering 53: it compares a value of its parameter `rule`.)
    assert_eq!(
        member("flag"),
        ["param_flows", "scope_unread", "status:403", "unread_exit"]
    );
    assert!(member("read").is_empty());
}

/// The middleware of the application that serves a route is a fact of the route
/// (lowering 36): a function registered with `@app.middleware("http")` or by calling
/// the decorator, a class given to `app.add_middleware(...)`, the repository's or a
/// package's. It is no wrap. A second application built on the same router without
/// the middleware (a test's) leaves it marked `?`: only some of the applications
/// that serve the route have it.
#[test]
fn the_middleware_of_the_application_is_a_fact_of_its_routes() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/routes.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\nshared = APIRouter()\n\n\n@router.get(\"/rules\")\nasync def list_rules():\n    return []\n\n\n@shared.get(\"/shared\")\nasync def list_shared():\n    return []\n",
    );
    write(
        r,
        "app/main.py",
        r#"from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware

from app.routes import router, shared


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        return await call_next(request)


async def request_context(request: Request, call_next):
    return await call_next(request)


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])
app.add_middleware(AuthMiddleware)
app.middleware("http")(request_context)
app.include_router(router)
app.include_router(shared)


@app.middleware("http")
async def timing(request: Request, call_next):
    return await call_next(request)
"#,
    );
    write(
        r,
        "app/other.py",
        "from fastapi import FastAPI\n\nfrom app.routes import shared\n\nother = FastAPI()\nother.include_router(shared)\n",
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/routes.py");
    let rules = symbol(f, "list_rules");
    assert_eq!(
        rules.app_middleware,
        [
            "app/main.py#AuthMiddleware",
            "app/main.py#request_context",
            "app/main.py#timing",
            "pkg:starlette#middleware.cors.CORSMiddleware",
        ]
    );
    assert!(rules.wraps.is_empty(), "{:?}", rules.wraps);
    assert_eq!(
        symbol(f, "list_shared").app_middleware,
        [
            "?app/main.py#AuthMiddleware",
            "?app/main.py#request_context",
            "?app/main.py#timing",
            "?pkg:starlette#middleware.cors.CORSMiddleware",
        ]
    );
    assert!(f.mounts.is_empty(), "{:?}", f.mounts);
}

/// A call of an `async def` that the body does not await builds a coroutine and runs
/// nothing: what the callee checks is not checked (second review, S1 k07). It is a
/// conditional call (`not_awaited`, lowering 42), of a function and of a method. An
/// awaited call, one handed to another call (`await gather(a(), b())`,
/// `asyncio.run(a())`), one returned, and a call of a plain `def` are calls as any
/// other.
#[test]
fn a_call_of_an_async_function_that_is_not_awaited_does_not_run() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/helpers.py",
        "async def assert_same_org(rule, caller):\n    if rule.org_id != caller.org_id:\n        raise PermissionError()\n\n\ndef audit(rule):\n    return rule\n",
    );
    write(
        r,
        "app/svc.py",
        r#"import asyncio

from app.helpers import assert_same_org, audit


async def forgotten(rule, caller):
    assert_same_org(rule, caller)
    audit(rule)
    return rule


async def awaited(rule, caller):
    await assert_same_org(rule, caller)
    return rule


async def gathered(rule, caller):
    await asyncio.gather(assert_same_org(rule, caller), asyncio.sleep(0))
    return rule


def handed_back(rule, caller):
    return assert_same_org(rule, caller)


def run(rule, caller):
    asyncio.run(assert_same_org(rule, caller))


async def bound_and_dropped(rule, caller):
    checked = assert_same_org(rule, caller)
    return rule


async def bound_and_awaited(rule, caller):
    pending = assert_same_org(rule, caller)
    await pending
    return rule


class Service:
    async def _check(self, rule):
        if rule.org_id != self.caller.org_id:
            raise PermissionError()

    async def forgotten(self, rule):
        self._check(rule)
        return rule

    async def awaited(self, rule):
        await self._check(rule)
        return rule
"#,
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let conditional = |name: &str| symbol(f, name).conditional_calls.clone();
    assert_eq!(
        conditional("forgotten"),
        ["not_awaited:app/helpers.py#assert_same_org"]
    );
    assert!(conditional("awaited").is_empty());
    assert!(conditional("gathered").is_empty());
    assert!(conditional("handed_back").is_empty());
    assert!(conditional("run").is_empty());
    assert_eq!(
        conditional("bound_and_dropped"),
        ["not_awaited:app/helpers.py#assert_same_org"]
    );
    assert!(conditional("bound_and_awaited").is_empty());
    let member = |name: &str| {
        symbol(f, "Service")
            .members
            .iter()
            .find(|m| m.name == name)
            .unwrap()
            .conditional_calls
            .clone()
    };
    assert_eq!(
        member("forgotten"),
        ["not_awaited:app/svc.py#Service._check"]
    );
    assert!(member("awaited").is_empty());
}

/// A check records what its function calls before it (`after`, lowering 46): each
/// callee once, in the order of its first call, not the calls of the condition itself
/// and not those of another function. A reader follows them to say whether the check
/// refuses only after something was changed.
#[test]
fn a_check_records_what_the_body_calls_before_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for (rel, body) in [
        ("requirements.txt", "fastapi\nsqlalchemy\n"),
        ("app/__init__.py", ""),
        (
            "app/repo.py",
            "from sqlalchemy.orm import Session\n\ndb = Session()\n\n\ndef get_rule(rule_id):\n    return db.get(object, rule_id)\n\n\ndef delete_rule(rule_id):\n    db.delete(get_rule(rule_id))\n    db.commit()\n\n\ndef allowed(rule, caller):\n    return rule.org_id == caller.org_id\n",
        ),
        (
            "app/api.py",
            r#"from fastapi import APIRouter, HTTPException

from app import repo

router = APIRouter()


class Service:
    def __init__(self, caller):
        self.caller = caller

    def remove(self, rule_id):
        rule = repo.get_rule(rule_id)
        rule.archive()
        if rule.org_id != self.caller.org_id:
            raise PermissionError("another organization")
        repo.delete_rule(rule_id)


@router.delete("/rules/{rule_id}")
def late(rule_id: int, caller):
    rule = repo.get_rule(rule_id)
    repo.delete_rule(rule_id)
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403)
    return {}


@router.delete("/checked/{rule_id}")
def first(rule_id: int, caller):
    if not repo.allowed(repo.get_rule(rule_id), caller):
        raise HTTPException(status_code=403)
    repo.delete_rule(rule_id)
    return {}
"#,
        ),
    ] {
        write(root, rel, body);
    }
    let r = scan_at(root, 1);
    let f = file(&r, "app/api.py");
    let after = |name: &str| -> Vec<Vec<String>> {
        let s = symbol(f, name);
        s.body_checks
            .iter()
            .map(|c| c.after.clone())
            .chain(s.raise_checks.iter().map(|c| c.after.clone()))
            .collect()
    };
    let late = after("late");
    assert!(!late.is_empty(), "{:?}", symbol(f, "late"));
    for a in &late {
        assert_eq!(a, &["app/repo.py#get_rule", "app/repo.py#delete_rule"]);
    }
    // The condition's own calls come with the check, not before it.
    let first = after("first");
    assert!(
        !first.is_empty() && first.iter().all(Vec::is_empty),
        "{first:?}"
    );
    // A method's own, with a call on what a local was bound to.
    let service = symbol(f, "Service");
    let remove = service.members.iter().find(|m| m.name == "remove").unwrap();
    assert_eq!(remove.raise_checks.len(), 1, "{remove:?}");
    assert_eq!(
        remove.raise_checks[0].after,
        ["app/repo.py#get_rule", "app/repo.py#get_rule().archive"]
    );
    let json = serde_json::to_string(symbol(f, "first")).unwrap();
    assert!(!json.contains("\"after\""), "{json}");
}

/// A `match` case, a `while` body and a `for` body (or its `else`) that return
/// without refusing serve the requests that take them without what follows: a call
/// or a check after them is made after a conditional return, as after an `if`
/// branch that returns (review 5, finding 3). One that refuses (`raise`), and a
/// loop that only refuses, leave what follows made for every request that is left.
#[test]
fn a_match_case_or_a_loop_that_returns_skips_what_follows() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(
        r,
        "app/svc.py",
        r#"from app.helpers import current_user


def matched(kind, request):
    match kind:
        case "test":
            return {}
    return current_user(request)


def matched_refuses(kind, request):
    match kind:
        case "test":
            raise ValueError()
    return current_user(request)


def whiled(payload, request):
    while not payload:
        return {}
    return current_user(request)


def looped(items, request):
    for item in items:
        return item
    return current_user(request)


def loop_else(items, request):
    for item in items:
        pass
    else:
        return {}
    return current_user(request)


def checked(kind, request):
    match kind:
        case "test":
            return {}
    if not request.user:
        raise PermissionError()
    return request.user
"#,
    );
    write(
        r,
        "app/helpers.py",
        "def current_user(request):\n    return request.user\n",
    );
    let repo = scan_at(r, 1);
    let f = file(&repo, "app/svc.py");
    let after = |name: &str| symbol(f, name).conditional_calls.clone();
    let helper = "after_conditional_return:app/helpers.py#current_user";
    for name in ["matched", "whiled", "looped", "loop_else"] {
        assert_eq!(after(name), [helper], "{name}");
    }
    assert!(
        after("matched_refuses").is_empty(),
        "{:?}",
        after("matched_refuses")
    );
    let checks = &symbol(f, "checked").raise_checks;
    assert!(
        !checks.is_empty()
            && checks
                .iter()
                .all(|c| c.condition == "after_conditional_return"),
        "{checks:?}"
    );
}
