//! Pins what Python reports of the registrations written as a route that Drift did
//! not list ([`drift_core::FileFacts::unlisted`]): one entry per registration, with
//! its line and why, for every framework the adapters read. Each case has a twin
//! that is listed and reports nothing, so the report is not noise; what Drift lists
//! with a `?` (a computed path, a router nothing includes) is listed, not reported.

use std::path::Path;

use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `path:line reason` of every unlisted registration of the repository, sorted.
fn unlisted(r: &Path) -> Vec<String> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let mut out: Vec<String> = repo
        .files
        .iter()
        .flat_map(|f| {
            f.unlisted().into_iter().map(move |u| {
                format!(
                    "{}:{} {}",
                    f.path,
                    u.line,
                    serde_json::to_value(u.reason).unwrap().as_str().unwrap()
                )
            })
        })
        .collect();
    out.sort();
    out
}

/// FastAPI: an `include_router` of a router made by a call, of a router that is not
/// in the code Drift read, an `app.mount` of an application built by a call, and an
/// `add_api_route` whose endpoint is a lambda. Their twins (an included router, a
/// mounted application, a named endpoint, a computed prefix or path, which are
/// listed as `?`, and a router nothing includes, listed under `?`) report nothing.
#[test]
fn fastapi_registrations_drift_does_not_follow_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"fa\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    let router = |path: &str| {
        format!(
            "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"{path}\")\ndef handler():\n    return {{}}\n"
        )
    };
    write(r, "app/items.py", &router("/items"));
    write(r, "app/orphan.py", &router("/orphan"));
    write(
        r,
        "app/factory.py",
        "from fastapi import APIRouter, FastAPI\n\n\ndef make_router():\n    return APIRouter()\n\n\ndef make_app():\n    return FastAPI()\n",
    );
    write(
        r,
        "app/sub.py",
        "from fastapi import FastAPI\n\nsubapp = FastAPI()\n\n\n@subapp.get(\"/s\")\ndef s():\n    return {}\n",
    );
    write(
        r,
        "app/main.py",
        concat!(
            "import os\n",
            "from fastapi import FastAPI\n",
            "\n",
            "from app import items\n",
            "from app.factory import make_app, make_router\n",
            "from app.gone import router as gone\n",
            "from app.sub import subapp\n",
            "\n",
            "app = FastAPI()\n",
            "app.include_router(items.router, prefix=os.environ[\"PREFIX\"])\n", // 10 twin
            "app.include_router(make_router())\n",                               // 11
            "app.include_router(gone)\n",                                        // 12
            "app.mount(\"/sub\", subapp)\n",                                     // 13 twin
            "app.mount(\"/x\", make_app())\n",                                   // 14
            "\n",
            "\n",
            "def ping():\n",
            "    return {}\n",
            "\n",
            "\n",
            "app.add_api_route(\"/ping\", ping)\n", // 21 twin
            "app.add_api_route(os.environ[\"P\"], ping)\n", // 22 twin
            "app.add_api_route(\"/lam\", lambda: {})\n", // 23
        ),
    );
    assert_eq!(
        unlisted(r),
        [
            "app/main.py:11 target_not_read",
            "app/main.py:12 not_found",
            "app/main.py:14 target_not_read",
            "app/main.py:23 handler_not_read",
        ]
    );
}

/// Flask: an `add_url_rule` whose view is made by a call, is computed, or is not
/// in the code Drift read; flask-restful's `add_resource` with a computed path.
/// Their twins (a named view, a view class, a computed rule, which is listed as
/// `?`, a literal resource path, and a blueprint nothing registers, listed under
/// `?`) report nothing.
#[test]
fn flask_registrations_drift_does_not_follow_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"fl\"\ndependencies = [\"flask\", \"flask-restful\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/orphan.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"orphan\", __name__)\n\n\n@bp.route(\"/orphan\")\ndef orphan():\n    return \"x\"\n",
    );
    write(
        r,
        "app/views.py",
        "def make_view(name):\n    def v():\n        return name\n    return v\n",
    );
    write(
        r,
        "app/main.py",
        concat!(
            "import os\n",
            "from flask import Flask\n",
            "from flask.views import MethodView\n",
            "from flask_restful import Api, Resource\n",
            "\n",
            "from app import views\n",
            "\n",
            "app = Flask(__name__)\n",
            "api = Api(app)\n",
            "\n",
            "\n",
            "def hello():\n",
            "    return \"x\"\n",
            "\n",
            "\n",
            "class ItemView(MethodView):\n",
            "    def get(self):\n",
            "        return \"x\"\n",
            "\n",
            "\n",
            "class Item(Resource):\n",
            "    def get(self):\n",
            "        return {}\n",
            "\n",
            "\n",
            "app.add_url_rule(\"/hello\", view_func=hello)\n", // 26 twin
            "app.add_url_rule(os.environ[\"R\"], view_func=hello)\n", // 27 twin
            "app.add_url_rule(\"/computed\", view_func=views.make_view(\"x\"))\n", // 28
            "app.add_url_rule(\"/item\", view_func=ItemView.as_view(\"item\"))\n", // 29 twin
            "app.add_url_rule(\"/getattr\", view_func=getattr(views, os.environ[\"V\"]))\n", // 30
            "app.add_url_rule(\"/missing\", view_func=views.nothing_here)\n", // 31
            "api.add_resource(Item, \"/res\")\n",              // 32 twin
            "api.add_resource(Item, os.environ[\"RES\"])\n",   // 33
        ),
    );
    assert_eq!(
        unlisted(r),
        [
            "app/main.py:28 handler_not_read",
            "app/main.py:30 handler_not_read",
            "app/main.py:31 not_found",
            "app/main.py:33 path_not_read",
        ]
    );
}

/// Django: a `path()` whose view is not in the code Drift read, is a package's,
/// a lambda or made by a call; an `include()` of a module of the repository that
/// does not exist and of patterns made by a call. Their twins (a view, an include
/// of a URLconf, an include of a package's URLconf, which is the package's
/// routes) report nothing.
#[test]
fn django_registrations_drift_does_not_follow_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"dj\"\ndependencies = [\"django\"]\n",
    );
    write(
        r,
        "manage.py",
        "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
    );
    write(r, "proj/__init__.py", "");
    write(r, "shop/__init__.py", "");
    write(r, "proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    write(
        r,
        "shop/views.py",
        "from django.http import HttpResponse\n\n\ndef listing(request):\n    return HttpResponse(\"x\")\n\n\ndef make_view():\n    return listing\n\n\ndef plugin_urls():\n    return []\n",
    );
    write(
        r,
        "shop/urls.py",
        "from django.urls import path\n\nfrom shop import views\n\nurlpatterns = [path(\"x/\", views.listing)]\n",
    );
    write(
        r,
        "proj/urls.py",
        concat!(
            "from django.urls import include, path\n",
            "from django.views.generic import TemplateView\n",
            "\n",
            "from shop import views\n",
            "\n",
            "urlpatterns = [\n",
            "    path(\"list/\", views.listing),\n", // 7 twin
            "    path(\"missing/\", views.not_there),\n", // 8
            "    path(\"about/\", TemplateView.as_view(template_name=\"a.html\")),\n", // 9
            "    path(\"lam/\", lambda request: None),\n", // 10
            "    path(\"made/\", views.make_view()),\n", // 11
            "    path(\"shop/\", include(\"shop.urls\")),\n", // 12 twin
            "    path(\"gone/\", include(\"shop.nowhere\")),\n", // 13
            "    path(\"pkg/\", include(\"allauth.urls\")),\n", // 14 twin
            "    path(\"dyn/\", include(views.plugin_urls())),\n", // 15
            "]\n",
        ),
    );
    assert_eq!(
        unlisted(r),
        [
            "proj/urls.py:10 handler_not_read",
            "proj/urls.py:11 handler_not_read",
            "proj/urls.py:13 not_found",
            "proj/urls.py:15 target_not_read",
            "proj/urls.py:8 not_found",
            "proj/urls.py:9 package_handler",
        ]
    );
}

/// Django: a URLconf `ROOT_URLCONF` does not reach, with every include read, serves
/// nothing, and its routes are not listed. The URLconf it does reach is listed.
#[test]
fn a_django_urlconf_nothing_reaches_is_reported_not_mounted() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"dj\"\ndependencies = [\"django\"]\n",
    );
    write(
        r,
        "manage.py",
        "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
    );
    for p in ["proj/__init__.py", "shop/__init__.py", "old/__init__.py"] {
        write(r, p, "");
    }
    write(r, "proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    write(
        r,
        "shop/views.py",
        "from django.http import HttpResponse\n\n\ndef listing(request):\n    return HttpResponse(\"x\")\n",
    );
    let urls = |p: &str| {
        format!(
            "from django.urls import path\n\nfrom shop import views\n\nurlpatterns = [path(\"{p}/\", views.listing)]\n"
        )
    };
    write(r, "proj/urls.py", &urls("live"));
    write(r, "old/urls.py", &urls("old"));
    assert_eq!(unlisted(r), ["old/urls.py:5 not_mounted"]);
}

/// Django REST framework: a viewset that is not in the code Drift read, and a
/// prefix that is computed, on a DRF router. Their twin (a viewset registered at a
/// literal prefix) and a `register` of another library (an admin site, a plugin
/// registry) report nothing.
#[test]
fn drf_router_registrations_drift_does_not_follow_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"drf\"\ndependencies = [\"django\", \"djangorestframework\"]\n",
    );
    write(
        r,
        "manage.py",
        "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
    );
    write(r, "proj/__init__.py", "");
    write(r, "shop/__init__.py", "");
    write(r, "proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    write(
        r,
        "shop/views.py",
        "from rest_framework import viewsets\n\n\nclass ItemViewSet(viewsets.ModelViewSet):\n    pass\n",
    );
    write(
        r,
        "shop/registry.py",
        "class Registry:\n    def register(self, name, thing):\n        pass\n\n\nplugins = Registry()\n",
    );
    write(
        r,
        "proj/urls.py",
        concat!(
            "import os\n",
            "from django.urls import include, path\n",
            "from rest_framework.routers import DefaultRouter\n",
            "\n",
            "from shop import views\n",
            "from shop.registry import plugins\n",
            "\n",
            "router = DefaultRouter()\n",
            "router.register(\"items\", views.ItemViewSet)\n", // 9 twin
            "router.register(\"ghosts\", views.GhostViewSet)\n", // 10
            "router.register(os.environ[\"P\"], views.ItemViewSet)\n", // 11
            "plugins.register(\"items\", views.GhostViewSet)\n", // 12 twin
            "\n",
            "urlpatterns = [path(\"api/\", include(router.urls))]\n",
        ),
    );
    assert_eq!(
        unlisted(r),
        ["proj/urls.py:10 not_found", "proj/urls.py:11 path_not_read",]
    );
}

/// Starlette: a route table that is no list Drift reads, a `WebSocketRoute`, and a
/// `Route` whose endpoint is a lambda. The twin (a `Route` of a named endpoint) is
/// listed and reports nothing.
#[test]
fn starlette_tables_drift_does_not_read_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"st\"\ndependencies = [\"starlette\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/main.py",
        concat!(
            "from starlette.applications import Starlette\n",
            "from starlette.responses import JSONResponse\n",
            "from starlette.routing import Route, WebSocketRoute\n",
            "\n",
            "from app.more import extra_routes\n",
            "\n",
            "\n",
            "async def orders(request):\n",
            "    return JSONResponse({})\n",
            "\n",
            "\n",
            "async def feed(websocket):\n",
            "    await websocket.accept()\n",
            "\n",
            "\n",
            "app = Starlette(\n",
            "    routes=[\n",
            "        Route(\"/orders\", orders),\n", // 18 twin
            "        WebSocketRoute(\"/feed\", feed),\n", // 19
            "        Route(\"/lam\", lambda request: JSONResponse({})),\n", // 20
            "    ]\n",
            ")\n",
            "other = Starlette(routes=extra_routes())\n", // 23
        ),
    );
    write(r, "app/more.py", "def extra_routes():\n    return []\n");
    assert_eq!(
        unlisted(r),
        [
            "app/main.py:19 table_not_read",
            "app/main.py:20 handler_not_read",
            "app/main.py:23 table_not_read",
        ]
    );
}

/// A route decorator on an application of a framework Drift has no adapter for is
/// said where it is written as a route is (a verb and a path from the root), as
/// TypeScript says of `x.get("/path", handler)`; a decorator of the same name that
/// is no route (`@cache.get("key")`) and a test file's say nothing.
#[test]
fn a_route_decorator_on_a_receiver_drift_does_not_read_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"sn\"\ndependencies = [\"sanic\"]\n",
    );
    write(r, "app/__init__.py", "");
    let body = concat!(
        "from sanic import Sanic\n",
        "\n",
        "from app.cache import cache\n",
        "\n",
        "srv = Sanic(\"x\")\n",
        "\n",
        "\n",
        "@srv.get(\"/hidden\")\n", // 8
        "async def hidden(request):\n",
        "    return None\n",
        "\n",
        "\n",
        "@cache.get(\"key\")\n",
        "def cached():\n",
        "    return None\n",
    );
    write(r, "app/server.py", body);
    write(r, "tests/test_server.py", body);
    write(
        r,
        "app/cache.py",
        "class Cache:\n    def get(self, k):\n        return lambda f: f\n\n\ncache = Cache()\n",
    );
    assert_eq!(unlisted(r), ["app/server.py:8 receiver_not_read"]);
}
