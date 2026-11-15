//! A router, a blueprint or a URLconf mounted more than once answers on each mount, so
//! each is an entry point with its own route: what reads a route's path (which gateway
//! location reaches it) must see every path the handler answers.

use std::path::Path;

use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `METHOD route symbol` of each http entry point of `path`, sorted.
fn routes(r: &Path, path: &str) -> Vec<String> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    // Every listing, as `drift security` reads it ([`drift_core::Listed`]).
    let repo = repo.listed();
    let f = repo.files.iter().find(|f| f.path == path).unwrap();
    let mut out: Vec<String> = f
        .entry_points
        .iter()
        .filter(|e| e.kind == "http")
        .map(|e| {
            format!(
                "{} {} {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                e.symbol
            )
        })
        .collect();
    out.sort();
    out
}

#[test]
fn a_fastapi_router_included_twice_has_a_route_for_each_mount() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/rules.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.get(\"/{rule_id}\")\nasync def get_rule(rule_id: str):\n    return {}\n",
    );
    write(
        r,
        "app/once.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/ping\")\nasync def ping():\n    return {}\n",
    );
    // `api` is itself mounted twice: every combination is a path.
    write(
        r,
        "app/main.py",
        "from fastapi import APIRouter, FastAPI\n\nfrom app.once import router as once_router\nfrom app.rules import router as rules_router\n\napi = APIRouter()\napi.include_router(rules_router)\n\napp = FastAPI()\napp.include_router(api, prefix=\"/v1\")\napp.include_router(api, prefix=\"/v2\")\napp.include_router(rules_router, prefix=\"/admin\")\napp.include_router(once_router, prefix=\"/internal\")\n",
    );
    assert_eq!(
        routes(r, "app/rules.py"),
        [
            "GET /admin/rules/{rule_id} get_rule",
            "GET /v1/rules/{rule_id} get_rule",
            "GET /v2/rules/{rule_id} get_rule",
        ]
    );
    assert_eq!(routes(r, "app/once.py"), ["GET /internal/ping ping"]);
}

#[test]
fn a_flask_blueprint_registered_twice_has_a_route_for_each_mount() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/items.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"items\", __name__, url_prefix=\"/items\")\n\n\n@bp.route(\"/<int:item_id>\")\ndef show(item_id):\n    return {}\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.items import bp\n\napp = Flask(__name__)\napp.register_blueprint(bp)\napp.register_blueprint(bp, url_prefix=\"/v2/items\")\n",
    );
    assert_eq!(
        routes(r, "shop/items.py"),
        [
            "GET /items/<int:item_id> show",
            "GET /v2/items/<int:item_id> show",
        ]
    );
}

#[test]
fn a_django_urlconf_included_twice_has_a_route_for_each_mount() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "manage.py", "");
    write(
        r,
        "mysite/settings.py",
        "ROOT_URLCONF = \"mysite.urls\"\nINSTALLED_APPS = [\"blog\"]\n",
    );
    write(r, "mysite/__init__.py", "");
    write(
        r,
        "mysite/urls.py",
        "from django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"blog.urls\")),\n    path(\"v2/\", include(\"blog.urls\")),\n]\n",
    );
    write(r, "blog/__init__.py", "");
    write(
        r,
        "blog/urls.py",
        "from django.urls import path\n\nfrom blog import views\n\nurlpatterns = [\n    path(\"posts/<int:pk>\", views.post),\n]\n",
    );
    write(
        r,
        "blog/views.py",
        "from django.http import JsonResponse\n\n\ndef post(request, pk):\n    return JsonResponse({})\n",
    );
    assert_eq!(
        routes(r, "blog/views.py"),
        ["ANY /v1/posts/<int:pk> post", "ANY /v2/posts/<int:pk> post"]
    );
}

/// Each http entry point of `path` with what guards it there: `METHOD route symbol |
/// the wraps its own mount adds (`?` when they could not be read) | the wraps of its
/// handler on every mount`.
fn guarded(r: &Path, path: &str) -> Vec<String> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    // Every listing, as `drift security` reads it ([`drift_core::Listed`]).
    let repo = repo.listed();
    let f = repo.files.iter().find(|f| f.path == path).unwrap();
    let names = |ws: &[drift_core::Wrap]| -> String {
        ws.iter()
            .map(|w| {
                let short = w.wrapper.rsplit('#').next().unwrap_or_default();
                match w.kind {
                    drift_core::WrapKind::AppHook => format!("{short} (app hook)"),
                    _ => short.to_string(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut out: Vec<String> = f
        .entry_points
        .iter()
        .filter(|e| e.kind == "http")
        .map(|e| {
            let symbol = f.symbols.iter().find(|s| s.name == e.symbol).unwrap();
            let opaque = f.mount(e).is_some_and(|m| m.opaque);
            format!(
                "{} {} {} | {}{} | {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                e.symbol,
                names(f.mount_wraps(e)),
                if opaque { "?" } else { "" },
                names(&symbol.wraps)
            )
        })
        .collect();
    out.sort();
    out
}

const DEPS: &str = "from fastapi import Depends, HTTPException, Request\n\n\ndef get_caller(request: Request):\n    if not request.headers.get(\"authorization\"):\n        raise HTTPException(status_code=401)\n    return request.state.caller\n\n\ndef require_admin(caller=Depends(get_caller)):\n    if caller.role != \"admin\":\n        raise HTTPException(status_code=403)\n    return caller\n\n\ndef audit():\n    return None\n";

/// A router included twice with different dependencies: each mount's entry points
/// carry that mount's guards, whichever prefix sorts first, and the handler's symbol
/// keeps only what every mount gives it. A mount whose dependencies are not a list
/// written at the call is unknown for its own routes, and takes nothing from another.
#[test]
fn a_fastapi_router_included_twice_has_the_guards_of_each_mount() {
    for (guarded_prefix, open_prefix) in [("/admin", "/public"), ("/zadmin", "/open")] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
        write(r, "app/__init__.py", "");
        write(r, "app/deps.py", DEPS);
        write(
            r,
            "app/rules.py",
            "from fastapi import APIRouter, Depends\n\nfrom app.deps import audit\n\nrouter = APIRouter(prefix=\"/rules\", dependencies=[Depends(audit)])\n\n\n@router.get(\"\")\nasync def list_rules():\n    return []\n",
        );
        write(
            r,
            "app/main.py",
            &format!(
                "from fastapi import Depends, FastAPI\n\nfrom app.deps import require_admin\nfrom app.rules import router\n\nOPTIONS = {{}}\nDEPS = [Depends(require_admin)]\n\napp = FastAPI()\napp.include_router(router, prefix=\"{guarded_prefix}\", dependencies=[Depends(require_admin)])\napp.include_router(router, prefix=\"{open_prefix}\")\napp.include_router(router, prefix=\"/var\", dependencies=DEPS)\napp.include_router(router, prefix=\"/spread\", **OPTIONS)\n"
            ),
        );
        let mut want = vec![
            format!("GET {guarded_prefix}/rules list_rules | require_admin get_caller | audit"),
            format!("GET {open_prefix}/rules list_rules |  | audit"),
            "GET /spread/rules list_rules | ? | audit".to_string(),
            "GET /var/rules list_rules | ? | audit".to_string(),
        ];
        want.sort();
        assert_eq!(guarded(r, "app/rules.py"), want, "{guarded_prefix}");
    }
}

/// The guards of a mount are those of every router on its way: a router included in
/// one that is itself mounted twice, once behind a dependency.
#[test]
fn a_nested_fastapi_router_has_the_guards_of_each_way_it_is_mounted() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/deps.py", DEPS);
    write(
        r,
        "app/rules.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.delete(\"/{rule_id}\")\nasync def delete_rule(rule_id: str):\n    return {}\n",
    );
    write(
        r,
        "app/main.py",
        "from fastapi import APIRouter, Depends, FastAPI\n\nfrom app.deps import audit, require_admin\nfrom app.rules import router as rules_router\n\napi = APIRouter(dependencies=[Depends(audit)])\napi.include_router(rules_router)\n\napp = FastAPI()\napp.include_router(api, prefix=\"/admin\", dependencies=[Depends(require_admin)])\napp.include_router(api, prefix=\"/public\")\n",
    );
    assert_eq!(
        guarded(r, "app/rules.py"),
        [
            "DELETE /admin/rules/{rule_id} delete_rule | require_admin get_caller | audit",
            "DELETE /public/rules/{rule_id} delete_rule |  | audit",
        ]
    );
}

/// A Flask blueprint registered on two apps, one of which runs a hook before every
/// request: the hook guards the routes of that app only.
#[test]
fn a_flask_blueprint_registered_on_two_apps_has_the_hooks_of_each() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/items.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"items\", __name__)\n\n\n@bp.route(\"/items\")\ndef items():\n    return {}\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask, abort, request\n\nfrom shop.items import bp\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\n\n\n@admin.before_request\ndef require_staff():\n    if not request.headers.get(\"authorization\"):\n        abort(401)\n\n\nadmin.register_blueprint(bp, url_prefix=\"/admin\")\npublic.register_blueprint(bp, url_prefix=\"/public\")\n",
    );
    assert_eq!(
        guarded(r, "shop/items.py"),
        [
            "GET /admin/items items | require_staff (app hook) | ",
            "GET /public/items items |  | ",
        ]
    );
    // Registered twice on one app: the hook is the handler's on both.
    write(
        r,
        "shop/app.py",
        "from flask import Flask, abort, request\n\nfrom shop.items import bp\n\nadmin = Flask(\"admin\")\n\n\n@admin.before_request\ndef require_staff():\n    if not request.headers.get(\"authorization\"):\n        abort(401)\n\n\nadmin.register_blueprint(bp, url_prefix=\"/v1\")\nadmin.register_blueprint(bp, url_prefix=\"/v2\")\n",
    );
    assert_eq!(
        guarded(r, "shop/items.py"),
        [
            "GET /v1/items items |  | require_staff (app hook)",
            "GET /v2/items items |  | require_staff (app hook)",
        ]
    );
}

/// A Django URLconf included twice: an include adds no guard of its own, so both
/// routes carry what the view is registered with, and nothing is said per mount.
#[test]
fn a_django_urlconf_included_twice_keeps_the_guards_of_the_view() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "manage.py", "");
    write(
        r,
        "mysite/settings.py",
        "ROOT_URLCONF = \"mysite.urls\"\nINSTALLED_APPS = [\"blog\"]\n",
    );
    write(r, "mysite/__init__.py", "");
    write(
        r,
        "mysite/urls.py",
        "from django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"blog.urls\")),\n    path(\"v2/\", include(\"blog.urls\")),\n]\n",
    );
    write(r, "blog/__init__.py", "");
    write(
        r,
        "blog/urls.py",
        "from django.contrib.auth.decorators import login_required\nfrom django.urls import path\n\nfrom blog import views\n\nurlpatterns = [\n    path(\"posts/<int:pk>\", login_required(views.post)),\n    path(\"open/\", views.index),\n]\n",
    );
    write(
        r,
        "blog/views.py",
        "from django.http import JsonResponse\n\n\ndef post(request, pk):\n    return JsonResponse({})\n\n\ndef index(request):\n    return JsonResponse({})\n",
    );
    assert_eq!(
        guarded(r, "blog/views.py"),
        [
            "ANY /v1/open index |  | ",
            "ANY /v1/posts/<int:pk> post |  | contrib.auth.decorators.login_required",
            "ANY /v2/open index |  | ",
            "ANY /v2/posts/<int:pk> post |  | contrib.auth.decorators.login_required",
        ]
    );
}

/// A FastAPI project whose `internal` router (`POST /jobs/lease`) is mounted as
/// `main` writes it; `main` starts with the imports and `app = FastAPI()`.
fn fastapi_with(r: &Path, mounts: &str) {
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/internal.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.post(\"/jobs/lease\")\nasync def lease_job():\n    return {}\n",
    );
    write(
        r,
        "app/main.py",
        &format!(
            "import importlib\n\nfrom fastapi import APIRouter, FastAPI\nfrom fastapi.staticfiles import StaticFiles\nfrom starlette.routing import Mount\n\nfrom app.internal import router as internal_router\n\napp = FastAPI()\n{mounts}\n\n@app.get(\"/health\")\nasync def health():\n    return {{}}\n"
        ),
    );
}

/// A route is given its own path only when every way its router is mounted was read.
/// A router mounted in a way Drift does not follow (in a loop, from a table, by
/// `importlib`, with options spread into the call) is served under a prefix that is
/// not known, written `?`: never at its unprefixed path, which a gateway may not route
/// while it routes the real one.
#[test]
fn a_router_whose_mount_is_not_read_is_under_an_unknown_prefix() {
    let cases = [
        // Read: the path is exact.
        (
            "app.include_router(internal_router, prefix=\"/internal/v1\")\n",
            "POST /internal/v1/jobs/lease lease_job",
        ),
        (
            "for r in [internal_router]:\n    app.include_router(r, prefix=\"/v1\")\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "OPTS = {\"prefix\": \"/v1\"}\napp.include_router(internal_router, **OPTS)\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "for name in [\"app.internal\"]:\n    app.include_router(importlib.import_module(name).router, prefix=\"/v1\")\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "for r, p in [(internal_router, \"/v1\")]:\n    app.include_router(r, prefix=p)\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "v1 = APIRouter(prefix=\"/v1\")\nfor r in [internal_router]:\n    v1.include_router(r)\napp.include_router(v1)\n",
            "POST /?/jobs/lease lease_job",
        ),
        // A Starlette mount: under its path, wherever the mount itself is served.
        (
            "app.router.routes.append(Mount(\"/v1\", app=internal_router))\n",
            "POST /?/v1/jobs/lease lease_job",
        ),
        // An application mounted on another by name: read.
        (
            "sub = FastAPI()\nsub.include_router(internal_router, prefix=\"/internal/v1\")\napp.mount(\"/v1\", sub)\n",
            "POST /v1/internal/v1/jobs/lease lease_job",
        ),
    ];
    for (mounts, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_with(r, mounts);
        assert_eq!(routes(r, "app/internal.py"), [want], "{mounts}");
        assert_eq!(routes(r, "app/main.py"), ["GET /health health"], "{mounts}");
    }
}

/// An application mounted under a path that Drift cannot name may be any application
/// of the project: none of them is then known to answer at its own paths only. Static
/// files are no application.
#[test]
fn an_application_mounted_by_a_call_makes_every_application_inexact() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let include = "app.include_router(internal_router, prefix=\"/internal/v1\")\n";
    fastapi_with(
        r,
        &format!("{include}app.mount(\"/static\", StaticFiles(directory=\"static\"))\n"),
    );
    assert_eq!(
        routes(r, "app/internal.py"),
        ["POST /internal/v1/jobs/lease lease_job"]
    );
    fastapi_with(
        r,
        &format!(
            "{include}\n\ndef make_app():\n    return FastAPI()\n\n\napp.mount(\"/v2\", make_app())\n"
        ),
    );
    assert_eq!(
        routes(r, "app/internal.py"),
        ["POST /?/internal/v1/jobs/lease lease_job"]
    );
    assert_eq!(routes(r, "app/main.py"), ["GET /?/health health"]);
}

/// Flask: a blueprint registered in a loop is under an unknown prefix, and an
/// application a `DispatcherMiddleware` serves under a path is under that path,
/// wherever the dispatcher itself is served.
#[test]
fn a_flask_blueprint_or_app_whose_mount_is_not_read_is_under_an_unknown_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/internal.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"internal\", __name__)\n\n\n@bp.post(\"/jobs/lease\")\ndef lease_job():\n    return {}\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.internal import bp\n\napp = Flask(__name__)\nfor b in [bp]:\n    app.register_blueprint(b, url_prefix=\"/v1\")\n",
    );
    assert_eq!(
        routes(r, "shop/internal.py"),
        ["POST /?/jobs/lease lease_job"]
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask\nfrom werkzeug.middleware.dispatcher import DispatcherMiddleware\n\nfrom shop.internal import bp\n\napp = Flask(__name__)\nadmin = Flask(\"admin\")\nadmin.register_blueprint(bp, url_prefix=\"/internal\")\napp.wsgi_app = DispatcherMiddleware(app.wsgi_app, {\"/v1\": admin})\n",
    );
    assert_eq!(
        routes(r, "shop/internal.py"),
        ["POST /?/v1/internal/jobs/lease lease_job"]
    );
    // Registered where Drift reads it: exact.
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.internal import bp\n\napp = Flask(__name__)\napp.register_blueprint(bp, url_prefix=\"/internal\")\n",
    );
    assert_eq!(
        routes(r, "shop/internal.py"),
        ["POST /internal/jobs/lease lease_job"]
    );
}

/// A router class of the repository that defines `__init__` or `__new__`, itself or
/// through a base of the repository, may give itself a prefix there.
#[test]
fn a_router_class_with_its_own_constructor_is_under_an_unknown_prefix() {
    for (class, expected) in [
        (
            "class VersionedRouter(APIRouter):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, prefix=\"/v1\", **kwargs)\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "class VersionedRouter(APIRouter):\n    def __new__(cls, *args, **kwargs):\n        return APIRouter(prefix=\"/v1\")\n",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "class Base(APIRouter):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, prefix=\"/v1\", **kwargs)\n\n\nclass VersionedRouter(Base):\n    tags = [\"v1\"]\n",
            "POST /?/jobs/lease lease_job",
        ),
        // No constructor of its own: the library's.
        (
            "class VersionedRouter(APIRouter):\n    tags = [\"v1\"]\n",
            "POST /jobs/lease lease_job",
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "pyproject.toml",
            "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
        );
        write(r, "app/__init__.py", "");
        write(
            r,
            "app/internal.py",
            &format!(
                "from fastapi import APIRouter\n\n\n{class}\n\nrouter = VersionedRouter()\n\n\n@router.post(\"/jobs/lease\")\nasync def lease_job():\n    return {{}}\n"
            ),
        );
        write(
            r,
            "app/main.py",
            "from fastapi import FastAPI\n\nfrom app.internal import router\n\napp = FastAPI()\napp.include_router(router)\n",
        );
        assert_eq!(routes(r, "app/internal.py"), [expected], "{class}");
    }
}

/// A prefix that is not a string literal is not the empty prefix: a router built with
/// `prefix=PREFIX`, with a setting, a concatenation, an f-string, options spread into
/// the constructor, or by a class of the repository that may add one of its own, is
/// under `?`, and an interpolation in a route's own path is `?` too.
#[test]
fn a_prefix_that_is_not_a_literal_is_unknown_not_empty() {
    // (how the router is built, the decorator's path, the route)
    let cases = [
        (
            "APIRouter(prefix=\"/v1\")",
            "\"/jobs/lease\"",
            "POST /v1/jobs/lease lease_job",
        ),
        (
            "APIRouter(prefix=PREFIX)",
            "\"/jobs/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "APIRouter(prefix=settings.API_V1_STR)",
            "\"/jobs/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "APIRouter(prefix=PREFIX + \"/jobs\")",
            "\"/lease\"",
            "POST /?/lease lease_job",
        ),
        (
            "APIRouter(prefix=f\"{PREFIX}/jobs\")",
            "\"/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "APIRouter(**OPTIONS)",
            "\"/jobs/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "VersionedRouter()",
            "\"/jobs/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "APIRouter()",
            "f\"/{PREFIX}/jobs/lease\"",
            "POST /?/jobs/lease lease_job",
        ),
        (
            "APIRouter()",
            "PREFIX + \"/jobs/lease\"",
            "POST /? lease_job",
        ),
    ];
    for (ctor, path, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
        write(r, "app/__init__.py", "");
        write(
            r,
            "app/internal.py",
            &format!(
                "from fastapi import APIRouter\n\nfrom app.config import settings\n\nPREFIX = \"/v1\"\nOPTIONS = {{\"prefix\": \"/v1\"}}\n\n\nclass VersionedRouter(APIRouter):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, prefix=\"/v1\", **kwargs)\n\n\nrouter = {ctor}\n\n\n@router.post({path})\nasync def lease_job():\n    return {{}}\n"
            ),
        );
        write(
            r,
            "app/main.py",
            "from fastapi import FastAPI\n\nfrom app.internal import router\n\napp = FastAPI()\napp.include_router(router)\n",
        );
        assert_eq!(routes(r, "app/internal.py"), [want], "{ctor} {path}");
    }
    // Flask: a blueprint's `url_prefix`.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/internal.py",
        "from flask import Blueprint\n\nPREFIX = \"/v1\"\nbp = Blueprint(\"internal\", __name__, url_prefix=PREFIX)\n\n\n@bp.post(\"/jobs/lease\")\ndef lease_job():\n    return {}\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.internal import bp\n\napp = Flask(__name__)\napp.register_blueprint(bp)\n",
    );
    assert_eq!(
        routes(r, "shop/internal.py"),
        ["POST /?/jobs/lease lease_job"]
    );
}

/// A read mount does not stand for the router when the router is also handed on
/// where Drift reads no mount: mounted behind a guard, and again in a loop, it has
/// the read mount's entry and one more under `?` whose guards are not known. A
/// router every reference to which is a decorator or a read mount has no such entry,
/// and a module imported by a computed name makes every router of its root one that
/// may be mounted elsewhere.
#[test]
fn a_router_also_mounted_where_drift_reads_no_mount_has_an_unknown_entry_too() {
    let rules = "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.get(\"\")\nasync def list_rules():\n    return []\n";
    let main = |more: &str| {
        format!(
            "import importlib\n\nfrom fastapi import Depends, FastAPI\n\nfrom app.deps import get_caller, require_admin\nfrom app.rules import router\n\napp = FastAPI()\napp.include_router(router, prefix=\"/admin\", dependencies=[Depends(require_admin)])\n{more}"
        )
    };
    let read = "GET /admin/rules list_rules | require_admin get_caller | ";
    let unseen = "GET /?/rules list_rules | ? | ";
    let cases = [
        // Mounted once: what the mount adds is what guards the handler everywhere.
        (
            "",
            vec!["GET /admin/rules list_rules |  | require_admin get_caller"],
        ),
        (
            "for r in [router]:\n    app.include_router(r, prefix=\"/member\", dependencies=[Depends(get_caller)])\n",
            vec![unseen, read],
        ),
        ("ROUTERS = {\"member\": router}\n", vec![unseen, read]),
        ("mount_all(app, router)\n", vec![unseen, read]),
        ("alias = router\n", vec![unseen, read]),
        // Through its module, an attribute of it, a conditional, a default, the
        // file's namespace.
        (
            "from app import rules\n\nfor m in (rules,):\n    app.include_router(m.router, prefix=\"/member\")\n",
            vec![unseen, read],
        ),
        (
            "app.router.routes.extend(router.routes)\n",
            vec![unseen, read],
        ),
        (
            "app.include_router(router if app.debug else None, prefix=\"/member\")\n",
            vec![unseen, read],
        ),
        (
            "def mount(r=router):\n    app.include_router(r)\n",
            vec![unseen, read],
        ),
        (
            "for r in globals().values():\n    mount_if_router(app, r)\n",
            vec![unseen, read],
        ),
        // Read where it is: a method call on it, a decorator.
        (
            "router.add_api_route(\"/x\", print)\n\n\n@router.get(\"/y\")\nasync def y():\n    return {}\n",
            vec!["GET /admin/rules list_rules |  | require_admin get_caller"],
        ),
        (
            "importlib.import_module(\"app.plugins\").setup(app)\n",
            vec![unseen, read],
        ),
        // A second mount that is read: its own entry, nothing unknown.
        (
            "app.include_router(router, prefix=\"/member\", dependencies=[Depends(get_caller)])\n",
            vec![read, "GET /member/rules list_rules | get_caller | "],
        ),
    ];
    for (more, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
        write(r, "app/__init__.py", "");
        write(r, "app/deps.py", DEPS);
        write(r, "app/rules.py", rules);
        write(r, "app/main.py", &main(more));
        assert_eq!(guarded(r, "app/rules.py"), want, "{more}");
    }
}

/// Django: a pattern list of another module added to `urlpatterns` or included as a
/// tuple is followed; patterns inside `i18n_patterns` are under a language code,
/// which is not read; and with an include Drift cannot follow, every route read is
/// marked as not known to be all of its view's routes.
#[test]
fn django_patterns_drift_cannot_place_are_listed_under_an_unknown_prefix() {
    let project = |r: &Path, root: &str, core: &str| {
        write(r, "manage.py", "");
        write(
            r,
            "proj/settings.py",
            "ROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"core\"]\n",
        );
        write(r, "proj/__init__.py", "");
        write(r, "proj/urls.py", root);
        write(r, "core/__init__.py", "");
        write(r, "core/urls.py", core);
        write(
            r,
            "core/internal_urls.py",
            "from django.urls import path\n\nfrom core import views\n\nurlpatterns = [path(\"jobs/lease\", views.lease_job)]\n",
        );
        write(
            r,
            "core/views.py",
            "from django.http import JsonResponse\n\n\ndef list_rules(request):\n    return JsonResponse({})\n\n\ndef lease_job(request):\n    return JsonResponse({})\n",
        );
    };
    let core = "from django.urls import path\n\nfrom core import views\n\nurlpatterns = [path(\"rules/\", views.list_rules)]\n";
    let claims = |r: &Path| -> Vec<String> {
        routes(r, "core/views.py")
            .into_iter()
            .filter(|x| x.ends_with("lease_job"))
            .collect()
    };
    // `include((imported_patterns, "ops"))`.
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "from django.urls import include, path\nfrom core.internal_urls import urlpatterns as internal_patterns\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n    path(\"internal/\", include(\"core.internal_urls\")),\n    path(\"v1/ops/\", include((internal_patterns, \"ops\"))),\n]\n",
        core,
    );
    assert_eq!(
        claims(dir.path()),
        [
            "ANY /internal/jobs/lease lease_job",
            "ANY /v1/ops/jobs/lease lease_job"
        ]
    );
    // `urlpatterns = [...] + more`.
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "from django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n    path(\"internal/\", include(\"core.internal_urls\")),\n]\n",
        "from django.urls import path\n\nfrom core import views\nfrom core.internal_urls import urlpatterns as more\n\nurlpatterns = [path(\"rules/\", views.list_rules)] + more\n",
    );
    assert_eq!(
        claims(dir.path()),
        [
            "ANY /internal/jobs/lease lease_job",
            "ANY /v1/jobs/lease lease_job"
        ]
    );
    // `i18n_patterns(path(...))`: listed, under a prefix that is not known.
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "from django.conf.urls.i18n import i18n_patterns\nfrom django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n]\nurlpatterns += i18n_patterns(path(\"internal/\", include(\"core.internal_urls\")), prefix_default_language=True)\n",
        core,
    );
    assert_eq!(claims(dir.path()), ["ANY /?/internal/jobs/lease lease_job"]);
    // An include that cannot be followed: each view may be under it too.
    let dir = tempfile::tempdir().unwrap();
    project(
        dir.path(),
        "from django.urls import include, path\n\nfrom proj.plugins import plugin_urls\n\nurlpatterns = [\n    path(\"internal/\", include(\"core.internal_urls\")),\n    path(\"v1/\", include(plugin_urls())),\n]\n",
        core,
    );
    assert_eq!(claims(dir.path()), ["ANY /internal/jobs/lease lease_job"]);
    let repo = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let views = repo
        .files
        .iter()
        .find(|f| f.path == "core/views.py")
        .unwrap();
    assert!(!views.entry_points.is_empty());
    for e in &views.entry_points {
        assert!(views.mount(e).is_some_and(|m| m.elsewhere), "{e:?}");
    }
}

/// A `urlpatterns` that is not a list Drift reads (a comprehension over a table)
/// routes views at paths that are not read. The views its module names are listed
/// under the unknown prefix, never dropped: a function of the request, a view class.
/// A name that is no view (a helper, a constant) is not listed. Mining does not read
/// the listing yet ([`drift_core::Listed`]).
#[test]
fn views_beside_a_urlpatterns_that_is_not_read_are_listed_under_an_unknown_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "manage.py", "");
    write(
        r,
        "config/settings.py",
        "ROOT_URLCONF = \"config.urls\"\nINSTALLED_APPS = [\"shop\"]\n",
    );
    write(r, "config/__init__.py", "");
    write(
        r,
        "config/urls.py",
        "from django.urls import path\n\nfrom shop import views\nfrom shop.naming import slug\n\nROUTES = {\n    slug(\"orders\"): views.list_orders,\n    \"reconcile\": views.reconcile,\n    \"reports\": views.ReportView.as_view(),\n}\nLIMIT = views.PAGE_SIZE\nNAMER = slug\n\nurlpatterns = [path(f\"api/{name}/\", view) for name, view in ROUTES.items()]\n",
    );
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/naming.py",
        "def slug(name):\n    return name.lower()\n",
    );
    write(
        r,
        "shop/views.py",
        "from django.http import JsonResponse\nfrom django.views import View\n\nPAGE_SIZE = 20\n\n\ndef list_orders(request):\n    return JsonResponse({})\n\n\ndef reconcile(request):\n    return JsonResponse({})\n\n\nclass ReportView(View):\n    def get(self, request):\n        return JsonResponse({})\n",
    );
    let listed = routes(r, "shop/views.py");
    assert_eq!(
        listed,
        [
            "ANY /? list_orders",
            "ANY /? reconcile",
            "GET /? ReportView.get"
        ]
    );
    assert!(routes(r, "shop/naming.py").is_empty());
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let views = repo
        .files
        .iter()
        .find(|f| f.path == "shop/views.py")
        .unwrap();
    assert!(views.entry_points.is_empty(), "{:?}", views.entry_points);
}

/// The entry points of every file but `main.py`, as [`routes`] writes them.
fn table_routes(r: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for path in ["app/views.py", "app/api.py", "app/routes.py"] {
        if r.join(path).exists() {
            out.extend(routes(r, path));
        }
    }
    out
}

/// A route table: what it is, its `app/views.py`, its other files, the routes listed.
type Table = (
    &'static str,
    &'static str,
    &'static [(&'static str, &'static str)],
    &'static [&'static str],
);

const FLASK_VIEWS: &str = "from flask import jsonify\n\n\ndef list_items():\n    return jsonify([])\n\n\ndef lease_job():\n    return jsonify(job=None)\n\n\ndef helper(x):\n    return x\n";
const FASTAPI_VIEWS: &str = "async def list_items():\n    return []\n\n\nasync def lease_job():\n    return {\"job\": None}\n\n\ndef helper(x):\n    return x\n";

/// A route table registered in a loop or from a data structure: the call that
/// registers names no view (a loop variable, a table entry, `getattr`), so which
/// function answers which path is not read. Every view the call may be handed is
/// listed under the unknown prefix, never dropped and never at a path of its own:
/// the functions and view classes the file reads as values, those a table of
/// another module names, and every function of a module handed to `getattr`. A
/// function nothing hands on is not listed. Mining does not read the listing
/// ([`drift_core::Listed`]).
#[test]
fn a_route_table_registered_in_a_loop_lists_its_views_under_an_unknown_prefix() {
    const BOTH: [&str; 2] = ["ANY /? lease_job", "ANY /? list_items"];
    let cases: &[Table] = &[
        (
            "flask add_url_rule over a list of tuples",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app.views import lease_job, list_items\n\napp = Flask(__name__)\n\nROUTES = [\n    (\"/v1/items\", list_items, [\"GET\"]),\n    (\"/v1/jobs/lease\", lease_job, [\"POST\"]),\n]\n\nfor rule, view, methods in ROUTES:\n    app.add_url_rule(rule, view_func=view, methods=methods)\n",
            )],
            &BOTH,
        ),
        (
            "flask add_url_rule over the items of a dict, the rule an f-string",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app import views\n\napp = Flask(__name__)\n\nVIEWS = {\"items\": views.list_items, \"jobs/lease\": views.lease_job}\n\nfor name, view in VIEWS.items():\n    app.add_url_rule(f\"/v1/{name}\", endpoint=name, view_func=view)\n",
            )],
            &BOTH,
        ),
        (
            "flask: the table in another module, the loop in a factory",
            FLASK_VIEWS,
            &[
                (
                    "app/routes.py",
                    "from app import views\n\nROUTES = (\n    (\"/v1/items\", \"items\", views.list_items),\n    (\"/v1/jobs/lease\", \"lease\", views.lease_job),\n)\n",
                ),
                (
                    "app/main.py",
                    "from flask import Flask\n\nfrom app.routes import ROUTES\n\n\ndef create_app():\n    app = Flask(__name__)\n    for r in ROUTES:\n        app.add_url_rule(r[0], r[1], r[2])\n    return app\n\n\napp = create_app()\n",
                ),
            ],
            &BOTH,
        ),
        (
            "flask: a blueprint's rules, under the blueprint's prefix",
            FLASK_VIEWS,
            &[
                (
                    "app/api.py",
                    "from flask import Blueprint\n\nfrom app.views import lease_job, list_items\n\nbp = Blueprint(\"api\", __name__, url_prefix=\"/v1\")\n\nRULES = [(\"/items\", \"items\", list_items), (\"/jobs/lease\", \"lease\", lease_job)]\nfor rule, endpoint, view in RULES:\n    bp.add_url_rule(rule, endpoint, view)\n",
                ),
                (
                    "app/main.py",
                    "from flask import Flask\n\nfrom app.api import bp\n\napp = Flask(__name__)\napp.register_blueprint(bp)\n",
                ),
            ],
            &["ANY /v1/? lease_job", "ANY /v1/? list_items"],
        ),
        (
            "flask: the table an argument of a helper that registers",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app.views import lease_job, list_items\n\n\ndef register(app, routes):\n    for rule, view in routes:\n        app.add_url_rule(rule, view_func=view)\n\n\napp = Flask(__name__)\nregister(app, [(\"/v1/items\", list_items), (\"/v1/jobs/lease\", lease_job)])\n",
            )],
            &BOTH,
        ),
        (
            "flask: the view by getattr of the module (any of its functions)",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app import views\n\napp = Flask(__name__)\nfor name in (\"list_items\", \"lease_job\"):\n    app.add_url_rule(f\"/v1/{name}\", view_func=getattr(views, name))\n",
            )],
            &["ANY /? helper", "ANY /? lease_job", "ANY /? list_items"],
        ),
        (
            "flask: the route decorator called in a loop",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app.views import lease_job, list_items\n\napp = Flask(__name__)\nfor rule, view in ((\"/v1/items\", list_items), (\"/v1/jobs/lease\", lease_job)):\n    app.route(rule, methods=[\"GET\", \"POST\"])(view)\n",
            )],
            &BOTH,
        ),
        (
            "flask: a literal rule, the view a table entry",
            FLASK_VIEWS,
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app.views import lease_job, list_items\n\napp = Flask(__name__)\nHANDLERS = {\"items\": list_items, \"lease\": lease_job}\napp.add_url_rule(\"/v1/items\", view_func=HANDLERS[\"items\"])\napp.add_url_rule(\"/v1/jobs/lease\", view_func=HANDLERS[\"lease\"], methods=[\"POST\"])\n",
            )],
            &BOTH,
        ),
        (
            "flask: view classes in a loop",
            "from flask import jsonify\nfrom flask.views import MethodView\n\n\nclass Items(MethodView):\n    def get(self):\n        return jsonify([])\n\n\nclass Lease(MethodView):\n    def post(self):\n        return jsonify(job=None)\n",
            &[(
                "app/main.py",
                "from flask import Flask\n\nfrom app.views import Items, Lease\n\napp = Flask(__name__)\nfor rule, cls in ((\"/v1/items\", Items), (\"/v1/jobs/lease\", Lease)):\n    app.add_url_rule(rule, view_func=cls.as_view(cls.__name__.lower()))\n",
            )],
            &["GET /? Items.get", "POST /? Lease.post"],
        ),
        (
            "fastapi add_api_route in a loop",
            FASTAPI_VIEWS,
            &[(
                "app/main.py",
                "from fastapi import FastAPI\n\nfrom app.views import lease_job, list_items\n\napp = FastAPI()\n\nROUTES = [\n    (\"/v1/items\", list_items, [\"GET\"]),\n    (\"/v1/jobs/lease\", lease_job, [\"POST\"]),\n]\nfor path, endpoint, methods in ROUTES:\n    app.add_api_route(path, endpoint, methods=methods)\n",
            )],
            &BOTH,
        ),
        (
            "fastapi: a router's routes from a list of records",
            FASTAPI_VIEWS,
            &[
                (
                    "app/api.py",
                    "from dataclasses import dataclass\nfrom typing import Callable\n\nfrom fastapi import APIRouter\n\nfrom app import views\n\n\n@dataclass\nclass Spec:\n    path: str\n    endpoint: Callable\n    method: str = \"GET\"\n\n\nSPECS = [Spec(\"/items\", views.list_items), Spec(\"/jobs/lease\", views.lease_job, \"POST\")]\n\nrouter = APIRouter()\nfor spec in SPECS:\n    router.add_api_route(spec.path, spec.endpoint, methods=[spec.method])\n",
                ),
                (
                    "app/main.py",
                    "from fastapi import FastAPI\n\nfrom app.api import router\n\napp = FastAPI()\napp.include_router(router, prefix=\"/v1\")\n",
                ),
            ],
            &["ANY /v1/? lease_job", "ANY /v1/? list_items"],
        ),
        (
            "fastapi: a comprehension over a dict",
            FASTAPI_VIEWS,
            &[(
                "app/main.py",
                "from fastapi import FastAPI\n\nfrom app.views import lease_job, list_items\n\napp = FastAPI()\nROUTES = {\"/v1/items\": list_items, \"/v1/jobs/lease\": lease_job}\n[app.add_api_route(path, endpoint) for path, endpoint in ROUTES.items()]\n",
            )],
            &BOTH,
        ),
        (
            "fastapi: the verb decorator called in a loop",
            FASTAPI_VIEWS,
            &[(
                "app/main.py",
                "from fastapi import FastAPI\n\nfrom app.views import lease_job, list_items\n\napp = FastAPI()\nfor path, fn in ((\"/v1/items\", list_items), (\"/v1/jobs/lease\", lease_job)):\n    app.post(path)(fn)\n",
            )],
            &BOTH,
        ),
        (
            "fastapi: the table an attribute of another module, the loop in a factory",
            FASTAPI_VIEWS,
            &[
                (
                    "app/routes.py",
                    "from app.views import lease_job, list_items\n\nROUTES = [(\"/v1/items\", list_items), (\"/v1/jobs/lease\", lease_job)]\n",
                ),
                (
                    "app/main.py",
                    "from fastapi import FastAPI\n\nfrom app import routes\n\n\ndef create_app() -> FastAPI:\n    app = FastAPI()\n    for path, endpoint in routes.ROUTES:\n        app.add_api_route(path, endpoint, methods=[\"GET\"])\n    return app\n\n\napp = create_app()\n",
                ),
            ],
            &BOTH,
        ),
    ];
    for (what, views, files, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
        write(r, "app/__init__.py", "");
        write(r, "app/views.py", views);
        for (path, body) in *files {
            write(r, path, body);
        }
        assert_eq!(table_routes(r), *want, "{what}");
        // Held from what mining reads.
        let repo = scan(
            r,
            &ScanOptions {
                cache_dir: None,
                threads: 1,
            },
        )
        .unwrap()
        .0;
        for f in &repo.files {
            assert!(f.entry_points.is_empty(), "{what}: {:?}", f.entry_points);
        }
    }
}

/// What is read stays read: a registration whose view is named is listed at its
/// path, beside a table; a route decorator called on a named view is a route at the
/// path written (a listing the measured build did not make); and a call of the same
/// shape on something that is no router gives nothing.
#[test]
fn a_registration_that_names_its_view_is_listed_at_its_path() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/views.py", FLASK_VIEWS);
    write(
        r,
        "app/main.py",
        "from flask import Flask\n\nfrom app.views import lease_job, list_items\n\napp = Flask(__name__)\napp.add_url_rule(\"/v1/items\", view_func=list_items)\napp.route(\"/v1/jobs/lease\", methods=[\"POST\"])(lease_job)\n",
    );
    assert_eq!(
        routes(r, "app/views.py"),
        ["ANY /v1/items list_items", "POST /v1/jobs/lease lease_job"]
    );
    // `handlers.get(kind)(payload)`: a dict, not a router.
    write(
        r,
        "app/main.py",
        "from flask import Flask\n\nfrom app.views import helper, lease_job, list_items\n\napp = Flask(__name__)\napp.add_url_rule(\"/v1/items\", view_func=list_items)\nHANDLERS = {\"lease\": lease_job}\n\n\ndef dispatch(kind, payload):\n    return HANDLERS.get(kind)(helper(payload))\n",
    );
    assert_eq!(routes(r, "app/views.py"), ["ANY /v1/items list_items"]);
}

/// A handler routed on two blueprints or two applications, one of which runs a
/// `before_request` hook: the hook guards the route it runs for, and the other route
/// does not carry it. The same of a hook registered under a branch of a factory
/// that builds more than one application: it is a hook only some of them have
/// (`?` in [`drift_core::Symbol::app_middleware`]), never a guard of the route.
#[test]
fn a_hook_is_a_guard_of_the_routes_it_runs_for_only() {
    const AUTH: &str = "from flask import abort, request\n\n\ndef require_staff():\n    if not request.headers.get(\"Authorization\"):\n        abort(401)\n";
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(r, "shop/auth.py", AUTH);
    // Two route decorators, on two applications.
    write(
        r,
        "shop/app.py",
        "from flask import Flask, jsonify\n\nfrom shop.auth import require_staff\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\nadmin.before_request(require_staff)\n\n\n@admin.route(\"/admin/orders\")\n@public.route(\"/public/orders\")\ndef list_orders():\n    return jsonify([])\n",
    );
    assert_eq!(
        guarded(r, "shop/app.py"),
        [
            "GET /admin/orders list_orders | require_staff (app hook) | ",
            "GET /public/orders list_orders |  | ",
        ]
    );
    // Two route decorators, on two blueprints of one application.
    write(
        r,
        "shop/app.py",
        "from flask import Blueprint, Flask, jsonify\n\nfrom shop.auth import require_staff\n\nstaff = Blueprint(\"staff\", __name__, url_prefix=\"/staff\")\nshop = Blueprint(\"shop\", __name__, url_prefix=\"/shop\")\nstaff.before_request(require_staff)\n\n\n@staff.route(\"/orders\")\n@shop.route(\"/orders\")\ndef list_orders():\n    return jsonify([])\n\n\napp = Flask(__name__)\napp.register_blueprint(staff)\napp.register_blueprint(shop)\n",
    );
    assert_eq!(
        guarded(r, "shop/app.py"),
        [
            "GET /shop/orders list_orders |  | ",
            "GET /staff/orders list_orders | require_staff | ",
        ]
    );
    // The view registered on two blueprints by call.
    write(
        r,
        "shop/views.py",
        "from flask import jsonify\n\n\ndef list_orders():\n    return jsonify([])\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Blueprint, Flask\n\nfrom shop.auth import require_staff\nfrom shop.views import list_orders\n\nstaff = Blueprint(\"staff\", __name__, url_prefix=\"/staff\")\nstaff.before_request(require_staff)\nstaff.add_url_rule(\"/orders\", view_func=list_orders)\n\nshop = Blueprint(\"shop\", __name__, url_prefix=\"/shop\")\nshop.add_url_rule(\"/orders\", view_func=list_orders)\n\napp = Flask(__name__)\napp.register_blueprint(staff)\napp.register_blueprint(shop)\n",
    );
    assert_eq!(
        guarded(r, "shop/views.py"),
        [
            "ANY /shop/orders list_orders |  | ",
            "ANY /staff/orders list_orders | require_staff | ",
        ]
    );
    // Both at one path, on two applications: which answers is not read.
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.auth import require_staff\nfrom shop.views import list_orders\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\nadmin.before_request(require_staff)\nadmin.add_url_rule(\"/orders\", view_func=list_orders)\npublic.add_url_rule(\"/orders\", view_func=list_orders)\n",
    );
    assert_eq!(
        guarded(r, "shop/views.py"),
        ["ANY /orders list_orders | ? | "]
    );
    // A hook registered under a branch of the one factory both applications are
    // built by.
    write(
        r,
        "shop/items.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"items\", __name__)\n\n\n@bp.route(\"/items\")\ndef items():\n    return {}\n",
    );
    write(
        r,
        "shop/app.py",
        "from flask import Flask\n\nfrom shop.auth import require_staff\nfrom shop.items import bp\n\n\ndef create_app(name, staff_only=False):\n    app = Flask(name)\n    if staff_only:\n        app.before_request(require_staff)\n    app.register_blueprint(bp, url_prefix=\"/api\")\n    return app\n\n\nadmin = create_app(\"admin\", staff_only=True)\npublic = create_app(\"public\")\n",
    );
    assert_eq!(guarded(r, "shop/items.py"), ["GET /api/items items |  | "]);
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let listed = repo.listed();
    let items = |repo: &drift_core::RepoFacts| {
        let f = repo
            .files
            .iter()
            .find(|f| f.path == "shop/items.py")
            .unwrap();
        f.symbols
            .iter()
            .find(|s| s.name == "items")
            .unwrap()
            .clone()
    };
    assert_eq!(
        items(&listed).app_middleware,
        ["?shop/auth.py#require_staff"]
    );
    // What mining reads is what the measured build gave it.
    assert_eq!(items(&repo).wraps.len(), 1, "{:?}", items(&repo).wraps);
    assert!(items(&repo).app_middleware.is_empty());
}

/// What the application serving each route of `shop/items.py` may have that Drift
/// did not read, and the hooks only some of its applications have: `route |
/// app_middleware of the route's mount | of the symbol`, sorted. `listed`: as `drift
/// security` reads it, else as mining does.
fn unread(r: &Path, listed: bool) -> Vec<String> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let repo = if listed {
        repo.listed().into_owned()
    } else {
        repo
    };
    let f = repo
        .files
        .iter()
        .find(|f| f.path == "shop/items.py")
        .unwrap();
    let symbol = f.symbols.iter().find(|s| s.name == "items").unwrap();
    let mut out: Vec<String> = f
        .entry_points
        .iter()
        .map(|e| {
            format!(
                "{} | {} | {} | {}",
                e.route.as_deref().unwrap_or("-"),
                f.mount(e)
                    .map_or(String::new(), |m| m.app_middleware.join(" ")),
                symbol.app_middleware.join(" "),
                symbol
                    .wraps
                    .iter()
                    .map(|w| w.wrapper.rsplit('#').next().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })
        .collect();
    out.sort();
    out
}

/// An application that goes where Drift does not read what is registered on it may
/// have a guard that was not seen: its routes say so
/// ([`drift_core::APP_UNREAD`]), and are never read as having no guard. The other
/// application, which went nowhere, says nothing. Where the function it is passed
/// to is one of the repository that registers a hook on its parameter, the hook is
/// read. A hook added to what a factory returned is one only some of the factory's
/// applications have. Passed to a server, to instrumentation or to a function of
/// the repository that registers nothing: nothing is said. Mining reads none of it.
#[test]
fn an_application_that_goes_where_drift_does_not_read_may_have_a_guard() {
    const ITEMS: &str = "from flask import Blueprint\n\nbp = Blueprint(\"items\", __name__)\n\n\n@bp.route(\"/items\")\ndef items():\n    return {}\n";
    const AUTH: &str = "from flask import abort, request\n\n\ndef require_staff():\n    if not request.headers.get(\"Authorization\"):\n        abort(401)\n";
    const TWO: &str = "admin.register_blueprint(bp, url_prefix=\"/admin\")\npublic.register_blueprint(bp, url_prefix=\"/public\")\n";
    const HEAD: &str = "from flask import Flask\n\nfrom shop.auth import require_staff\nfrom shop.items import bp\n\n";
    let cases: &[(&str, String, &[&str])] = &[
        (
            "the hook registries written directly",
            format!(
                "{HEAD}admin = Flask(\"admin\")\npublic = Flask(\"public\")\nadmin.before_request_funcs.setdefault(None, []).append(require_staff)\n{TWO}"
            ),
            &[
                "/admin/items | ?unread:`admin.before_request_funcs.setdefault(...)` (shop/app.py:8) |  | ",
                "/public/items |  |  | ",
            ],
        ),
        (
            "passed to a function of a package",
            format!(
                "from corp_auth import protect\n{HEAD}admin = Flask(\"admin\")\npublic = Flask(\"public\")\nprotect(admin)\n{TWO}"
            ),
            &[
                "/admin/items | ?unread:`admin` passed to `protect`, which Drift does not read (shop/app.py:9) |  | ",
                "/public/items |  |  | ",
            ],
        ),
        (
            "built by a class of the repository with its own constructor",
            format!(
                "{HEAD}class AdminApp(Flask):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, **kwargs)\n        self.before_request(require_staff)\n\n\nadmin = AdminApp(\"admin\")\npublic = Flask(\"public\")\n{TWO}"
            ),
            &[
                "/?/admin/items | ?unread:`AdminApp`, a class of the repository with its own constructor (shop/app.py:12) |  | ",
                "/public/items |  |  | ",
            ],
        ),
        (
            "passed to a helper of the repository that registers the hook: read",
            format!(
                "{HEAD}def init_auth(app):\n    app.before_request(require_staff)\n\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\ninit_auth(admin)\n{TWO}"
            ),
            &["/admin/items |  |  | ", "/public/items |  |  | "],
        ),
        (
            "a hook added to what a factory returned",
            format!(
                "{HEAD}def make_app(name, prefix):\n    app = Flask(name)\n    app.register_blueprint(bp, url_prefix=prefix)\n    return app\n\n\nadmin = make_app(\"admin\", \"/admin\")\nadmin.before_request(require_staff)\npublic = make_app(\"public\", \"/public\")\n"
            ),
            &["/?/items |  | ?shop/auth.py#require_staff | "],
        ),
        (
            "a factory's application with its hook registries written directly",
            format!(
                "{HEAD}def create_admin():\n    app = Flask(\"admin\")\n    app.register_blueprint(bp, url_prefix=\"/admin\")\n    app.before_request_funcs.setdefault(\"items\", []).append(require_staff)\n    return app\n\n\ndef create_public():\n    app = Flask(\"public\")\n    app.register_blueprint(bp, url_prefix=\"/public\")\n    return app\n"
            ),
            &[
                "/admin/items | ?unread:`app.before_request_funcs.setdefault(...)` (shop/app.py:9) |  | ",
                "/public/items |  |  | ",
            ],
        ),
        (
            "passed to a server, to an extension and to a function that registers nothing",
            format!(
                "import uvicorn\nfrom flask_cors import CORS\n{HEAD}def log_routes(app):\n    print(app.url_map)\n\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\nCORS(admin)\nlog_routes(admin)\nadmin.config[\"DEBUG\"] = False\nuvicorn.run(admin)\n{TWO}"
            ),
            &["/admin/items |  |  | ", "/public/items |  |  | "],
        ),
    ];
    for (what, app, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
        write(r, "shop/__init__.py", "");
        write(r, "shop/items.py", ITEMS);
        write(r, "shop/auth.py", AUTH);
        write(r, "shop/app.py", app);
        assert_eq!(unread(r, true), *want, "{what}");
        for line in unread(r, false) {
            assert!(
                !line.contains('?') || line.starts_with("/?/"),
                "{what}: {line}"
            );
            assert!(!line.contains("unread:"), "{what}: {line}");
        }
    }
    // The helper's hook is the application's, as a hook of its own is.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "shop/__init__.py", "");
    write(r, "shop/items.py", ITEMS);
    write(r, "shop/auth.py", AUTH);
    write(
        r,
        "shop/hooks.py",
        "from shop.auth import require_staff\n\n\ndef init_auth(app):\n    app.before_request(require_staff)\n",
    );
    write(
        r,
        "shop/app.py",
        &format!(
            "from flask import Flask\n\nfrom shop.items import bp\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\n{TWO}"
        ),
    );
    // Passed in another file, where every read of it is an argument of a call.
    write(
        r,
        "shop/wire.py",
        "from mangum import Mangum\n\nfrom shop.app import admin, public\nfrom shop.hooks import init_auth\n\ninit_auth(admin)\nhandler = Mangum(public)\n",
    );
    assert_eq!(
        guarded(r, "shop/items.py"),
        [
            "GET /admin/items items | require_staff (app hook) | ",
            "GET /public/items items |  | ",
        ]
    );
    assert_eq!(
        unread(r, true),
        ["/admin/items |  |  | ", "/public/items |  |  | "]
    );
    // Read as a value there in any other way: it went where Drift does not read.
    write(
        r,
        "shop/wire.py",
        "from shop.app import admin, public\n\nAPPS = {\"admin\": admin}\n",
    );
    assert_eq!(
        unread(r, true),
        [
            "/admin/items | ?unread:`admin` passed or assigned as a value (shop/wire.py:3) |  | ",
            "/public/items |  |  | ",
        ]
    );
}
