//! What is known of an application object ([`drift_core::AppFacts`]): its routes are
//! served at the paths Drift lists only when every use of the object in the
//! repository is one Drift knows to leave the path of a request alone.

use std::path::Path;

use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// What Drift does not know of the application `name` of `path`; none when the file
/// builds no such application.
fn unknown(r: &Path, path: &str, name: &str) -> Option<Vec<String>> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let f = repo.files.iter().find(|f| f.path == path)?;
    f.apps
        .iter()
        .find(|a| a.name == name)
        .map(|a| a.unknown.clone())
}

const CONTEXT: &str = "from uuid import uuid4\n\nfrom fastapi import Request\n\n\nasync def request_context(request: Request, call_next):\n    trace = request.headers.get(\"x-request-id\") or str(uuid4())\n    response = await call_next(request)\n    response.headers[\"x-request-id\"] = trace\n    return response\n\n\nasync def strip_prefix(request: Request, call_next):\n    request.scope[\"path\"] = request.scope[\"path\"].removeprefix(\"/api\")\n    return await call_next(request)\n";

/// A FastAPI service whose `app/main.py` is `main`.
fn fastapi(r: &Path, main: &str) {
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(r, "app/context.py", CONTEXT);
    write(
        r,
        "app/rules.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.get(\"\")\nasync def list_rules():\n    return []\n",
    );
    write(r, "app/main.py", main);
}

/// The application of a service as it is usually written: metadata options, CORS, a
/// middleware function that reads headers, a lifespan that keeps state, routers and a
/// route of its own.
const PLAIN: &str = "from contextlib import asynccontextmanager\n\nfrom fastapi import FastAPI\nfrom fastapi.middleware.cors import CORSMiddleware\n\nfrom app.context import request_context\nfrom app.rules import router\n\n\n@asynccontextmanager\nasync def lifespan(fastapi_app: FastAPI):\n    fastapi_app.state.pool = object()\n    yield\n    fastapi_app.state.pool = None\n\n\napp = FastAPI(\n    title=\"Rules\",\n    docs_url=\"/docs\",\n    openapi_url=\"/openapi.json\",\n    lifespan=lifespan,\n)\napp.add_middleware(CORSMiddleware, allow_origins=[\"*\"])\napp.middleware(\"http\")(request_context)\napp.include_router(router, prefix=\"/v1\")\napp.state.started = True\n\n\n@app.get(\"/health\")\nasync def health():\n    return {}\n";

#[test]
fn an_application_every_use_of_which_is_read_has_nothing_unknown() {
    let dir = tempfile::tempdir().unwrap();
    fastapi(dir.path(), PLAIN);
    assert_eq!(
        unknown(dir.path(), "app/main.py", "app"),
        Some(Vec::<String>::new())
    );
    // A router is not an application.
    assert_eq!(unknown(dir.path(), "app/rules.py", "router"), None);
}

/// Each of these may move the routes, and is named as written.
#[test]
fn what_may_move_the_routes_of_an_application_is_named() {
    let cases: &[(&str, &str, &str)] = &[
        (
            "app = FastAPI(",
            "app = FastAPI(\n    root_path=\"/api\",",
            "`FastAPI(root_path=...)` (app/main.py:17)",
        ),
        (
            "app = FastAPI(",
            "OPTIONS = {\"root_\" + \"path\": \"/api\"}\napp = FastAPI(\n    **OPTIONS,",
            "`FastAPI(**OPTIONS)` (app/main.py:18)",
        ),
        (
            "app.state.started = True\n",
            "app.root_path = \"/api\"\n",
            "`app.root_path` (app/main.py:26)",
        ),
        (
            "app.state.started = True\n",
            "application = StripPrefix(app)\n",
            "`app` passed or assigned as a value (app/main.py:26)",
        ),
        (
            "app.state.started = True\n",
            "app.add_middleware(StripPrefix)\n",
            "`app.add_middleware(StripPrefix)` (app/main.py:26)",
        ),
        (
            "app.middleware(\"http\")(request_context)\n",
            "from app.context import strip_prefix\napp.middleware(\"http\")(strip_prefix)\n",
            "`app.middleware(...)(strip_prefix)` (app/main.py:25)",
        ),
        (
            "app.state.started = True\n",
            "app.router.routes.clear()\n",
            "`app.router.routes.clear(...)` (app/main.py:26)",
        ),
        (
            "    fastapi_app.state.pool = object()\n",
            "    fastapi_app.root_path = \"/api\"\n",
            "`FastAPI(lifespan=...)`, which is handed the application and does more than keep state on it (app/main.py:17)",
        ),
    ];
    for (from, to, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        assert!(PLAIN.contains(from), "{from}");
        fastapi(
            dir.path(),
            &format!(
                "{}\n\nclass StripPrefix:\n    def __init__(self, app):\n        self.app = app\n",
                PLAIN.replacen(from, to, 1)
            ),
        );
        let got = unknown(dir.path(), "app/main.py", "app").unwrap();
        assert!(got.iter().any(|u| u == want), "{to}: {got:#?}");
    }
    // In another file of the service.
    let dir = tempfile::tempdir().unwrap();
    fastapi(dir.path(), PLAIN);
    write(
        dir.path(),
        "app/prefix.py",
        "from app.main import app\n\napp.root_path = \"/api\"\n",
    );
    assert_eq!(
        unknown(dir.path(), "app/main.py", "app").unwrap(),
        ["`app.root_path` (app/prefix.py:3)"]
    );
    // A test may do what it likes with it.
    let dir = tempfile::tempdir().unwrap();
    fastapi(dir.path(), PLAIN);
    write(
        dir.path(),
        "tests/test_app.py",
        "from fastapi.testclient import TestClient\n\nfrom app.main import app\n\nclient = TestClient(app)\n",
    );
    assert_eq!(
        unknown(dir.path(), "app/main.py", "app"),
        Some(Vec::<String>::new())
    );
}

#[test]
fn a_django_application_is_known_by_its_middleware() {
    let project = |r: &Path, middleware: &str| {
        write(r, "manage.py", "");
        write(r, "proj/__init__.py", "");
        write(
            r,
            "proj/settings.py",
            &format!("ROOT_URLCONF = \"proj.urls\"\nMIDDLEWARE = [{middleware}]\n"),
        );
        write(
            r,
            "proj/urls.py",
            "from django.urls import path\n\nfrom proj import views\n\nurlpatterns = [path(\"x\", views.x)]\n",
        );
        write(
            r,
            "proj/views.py",
            "from django.http import JsonResponse\n\n\ndef x(request):\n    return JsonResponse({})\n",
        );
        write(
            r,
            "proj/wsgi.py",
            "import os\n\nfrom django.core.wsgi import get_wsgi_application\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\napplication = get_wsgi_application()\n",
        );
    };
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "\"django.middleware.security.SecurityMiddleware\", \"corsheaders.middleware.CorsMiddleware\"",
    );
    assert_eq!(
        unknown(dir.path(), "proj/wsgi.py", "application"),
        Some(Vec::<String>::new())
    );
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "\"django.middleware.security.SecurityMiddleware\", \"proj.middleware.PrefixMiddleware\"",
    );
    assert_eq!(
        unknown(dir.path(), "proj/wsgi.py", "application").unwrap(),
        ["`proj.middleware.PrefixMiddleware` in MIDDLEWARE"]
    );
}
