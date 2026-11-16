//! Single-file (incremental) Python scans must give exactly the facts a full scan
//! gives for that file, whatever changed since the scan index was written.

use std::path::Path;

use drift_core::RepoFacts;
use drift_py::{ScanOptions, scan, scan_file};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A repo with every cross-file fact a Python file's facts depend on: router mounts
/// with dependencies across files, `Annotated` aliases and sub-dependencies, a router
/// subclass, a configured instance, a Celery app, Django URLconf includes and a DRF
/// router registration, a Flask blueprint hook, re-exports through `__init__` and
/// star imports, test pairing, models and package manifests; and the repo-wide inputs:
/// Django settings named by an entry script (URL roots, login middleware, DRF
/// defaults), a URLconf no root reaches, a Flask factory passing its app to a hook
/// helper, and a Celery beat schedule naming a task in another file.
fn fixture(r: &Path) {
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\ndependencies = [\"fastapi>=0.115\", \"django>=5\"]\n[tool.poe.tasks]\ntest = \"pytest\"\n",
    );
    write(r, "svc/requirements.txt", "flask==3.1\n");
    write(r, "svc/app.py", "import flask\n");
    // FastAPI
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI, Depends\nfrom app.api import api_router\nfrom app.api.deps import verify\n\napp = FastAPI()\napp.include_router(api_router, prefix=\"/api\", dependencies=[Depends(verify)])\n",
    );
    write(
        r,
        "app/api/__init__.py",
        "from fastapi import APIRouter\nfrom app.api.routes import users, items\n\napi_router = APIRouter()\napi_router.include_router(users.router)\napi_router.include_router(items.router, prefix=\"/items\")\n",
    );
    write(
        r,
        "app/api/deps.py",
        "from typing import Annotated\nfrom fastapi import Depends\nfrom app.auth import Authenticator\nfrom app.db import get_db\n\nSessionDep = Annotated[object, Depends(get_db)]\n\ndef get_current_user(db: SessionDep):\n    return db\n\nCurrentUser = Annotated[object, Depends(get_current_user)]\n_read = Authenticator(scopes=[\"r\"])\n\ndef verify():\n    pass\n",
    );
    write(r, "app/db.py", "def get_db():\n    yield 1\n");
    write(
        r,
        "app/auth.py",
        "class Authenticator:\n    def __init__(self, scopes):\n        self.scopes = scopes\n\n    def __call__(self):\n        return 1\n",
    );
    write(
        r,
        "app/core/router.py",
        "from fastapi import APIRouter\n\nclass VersionedRouter(APIRouter):\n    pass\n",
    );
    write(r, "app/api/routes/__init__.py", "");
    write(
        r,
        "app/api/routes/users.py",
        "from fastapi import APIRouter, Depends\nfrom app.api.deps import CurrentUser, _read\nfrom app.lib import fmt\n\nrouter = APIRouter(prefix=\"/users\")\n\n@router.get(\"/\")\ndef list_users(user: CurrentUser, auth=Depends(_read)):\n    return fmt(user)\n",
    );
    write(
        r,
        "app/api/routes/items.py",
        "from app.core.router import VersionedRouter\n\nrouter = VersionedRouter()\n\n@router.post(\"/\")\ndef create_item():\n    return 1\n",
    );
    write(
        r,
        "app/lib/__init__.py",
        "from .text import *\n__all__ = [\"fmt\"]\n",
    );
    write(r, "app/lib/text.py", "def fmt(x):\n    return str(x)\n");
    write(r, "app/tests/__init__.py", "");
    write(r, "app/tests/test_users.py", "def test_list():\n    pass\n");
    // Celery
    write(
        r,
        "app/worker.py",
        "from celery import Celery\n\ncelery_app = Celery(\"w\")\n",
    );
    write(
        r,
        "app/tasks.py",
        "from app.worker import celery_app\n\n@celery_app.task\ndef send():\n    pass\n",
    );
    // Django + DRF
    write(
        r,
        "manage.py",
        "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"mysite.settings\")\n",
    );
    write(r, "mysite/__init__.py", "");
    write(
        r,
        "mysite/settings.py",
        "ROOT_URLCONF = \"shop.urls\"\nMIDDLEWARE = [\"django.contrib.auth.middleware.LoginRequiredMiddleware\"]\nREST_FRAMEWORK = {\"DEFAULT_PERMISSION_CLASSES\": [\"rest_framework.permissions.IsAuthenticated\"]}\nCELERY_BEAT_SCHEDULE = {\"nightly\": {\"task\": \"app.tasks.send\", \"schedule\": 3600}}\n",
    );
    write(
        r,
        "shop/legacy_urls.py",
        "from django.urls import path\nfrom shop import views\n\nurlpatterns = [path(\"old/\", views.Legacy.as_view())]\n",
    );
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/urls.py",
        "from django.urls import path, include\nfrom django.contrib.auth.decorators import login_required\nfrom shop import views\n\nurlpatterns = [\n    path(\"items/\", login_required(views.ItemList.as_view())),\n    path(\"api/\", include(\"shop.api.urls\")),\n]\n",
    );
    write(
        r,
        "shop/views.py",
        "from django.views.generic import ListView\n\nclass ItemList(ListView):\n    def get(self, request):\n        pass\n\nclass Legacy(ListView):\n    def get(self, request):\n        pass\n",
    );
    write(
        r,
        "shop/models.py",
        "from django.db import models\n\nclass Item(models.Model):\n    name = models.CharField(max_length=10)\n",
    );
    write(r, "shop/api/__init__.py", "");
    write(
        r,
        "shop/api/urls.py",
        "from django.urls import path, include\nfrom rest_framework.routers import DefaultRouter\nfrom shop.api.views import ItemViewSet\n\nrouter = DefaultRouter()\nrouter.register(\"items\", ItemViewSet)\nurlpatterns = [path(\"\", include(router.urls))]\n",
    );
    write(
        r,
        "shop/api/views.py",
        "from rest_framework import viewsets\n\nclass ItemViewSet(viewsets.ModelViewSet):\n    queryset = None\n",
    );
    // Flask blueprint with a hook in another file.
    write(
        r,
        "blog/__init__.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"blog\", __name__, url_prefix=\"/blog\")\n\nfrom blog import hooks, views\n",
    );
    write(
        r,
        "blog/hooks.py",
        "from blog import bp\n\n@bp.before_request\ndef require_login():\n    pass\n",
    );
    write(
        r,
        "blog/factory.py",
        "from flask import Flask\nfrom blog.setup import init_hooks, register\n\ndef create_app():\n    app = Flask(__name__)\n    init_hooks(app)\n    register(app)\n    return app\n",
    );
    write(
        r,
        "blog/setup.py",
        "from blog import bp\n\ndef init_hooks(app):\n    @app.before_request\n    def track():\n        return None\n\ndef register(app):\n    app.register_blueprint(bp)\n",
    );
    write(
        r,
        "blog/views.py",
        "from blog import bp\n\n@bp.route(\"/\")\ndef index():\n    return \"hi\"\n",
    );
    write(r, "app/gen_pb2.py", "x = 1\n");
}

fn opts(cache: &Path, threads: usize) -> ScanOptions {
    ScanOptions {
        cache_dir: Some(cache.to_path_buf()),
        threads,
    }
}

fn full(root: &Path) -> RepoFacts {
    scan(root, &ScanOptions::default()).unwrap().0
}

fn assert_matches_full(root: &Path, cache: &Path, step: &str) {
    let full = full(root);
    for f in &full.files {
        let one = scan_file(root, &opts(cache, 0), &f.path)
            .unwrap()
            .unwrap_or_else(|| panic!("{step}: no single-file scan for {}", f.path));
        assert_eq!(one.files, std::slice::from_ref(f), "{step}: {}", f.path);
        let models: Vec<_> = full
            .models
            .iter()
            .filter(|m| m.path == f.path)
            .cloned()
            .collect();
        assert_eq!(one.models, models, "{step}: models of {}", f.path);
        assert_eq!(one.packages, full.packages, "{step}: packages");
    }
    for s in &full.skipped {
        let one = scan_file(root, &opts(cache, 0), &s.path).unwrap().unwrap();
        assert!(one.files.is_empty(), "{step}: {}", s.path);
    }
}

#[test]
fn single_file_scan_matches_full_scan() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    // No cache, no index, or not Python: a full scan is needed.
    assert!(
        scan_file(r, &ScanOptions::default(), "app/main.py")
            .unwrap()
            .is_none()
    );
    assert!(
        scan_file(r, &opts(cache.path(), 0), "app/main.py")
            .unwrap()
            .is_none()
    );
    let cached = scan(r, &opts(cache.path(), 0)).unwrap().0;
    assert_eq!(cached, full(r));
    assert!(
        scan_file(r, &opts(cache.path(), 0), "web/a.ts")
            .unwrap()
            .is_none()
    );

    // The fixture exercises what it means to.
    let f = |p: &str| {
        scan_file(r, &opts(cache.path(), 0), p)
            .unwrap()
            .unwrap()
            .files[0]
            .clone()
    };
    let users = f("app/api/routes/users.py");
    let e = &users.entry_points[0];
    assert_eq!(e.route.as_deref(), Some("/api/users"));
    let wraps: Vec<&str> = users.symbols[0]
        .wraps
        .iter()
        .map(|w| w.wrapper.as_str())
        .collect();
    assert_eq!(
        wraps,
        [
            "app/api/deps.py#verify",
            "app/api/deps.py#get_current_user",
            "app/db.py#get_db",
            "app/auth.py#Authenticator"
        ],
        "{users:#?}"
    );
    assert_eq!(
        f("app/api/routes/items.py").entry_points[0]
            .route
            .as_deref(),
        Some("/api/items")
    );
    assert!(
        f("app/tasks.py")
            .entry_points
            .iter()
            .any(|e| e.kind == "job")
    );
    assert_eq!(
        f("shop/api/views.py").entry_points[0].route.as_deref(),
        Some("/api/items")
    );
    assert!(f("shop/views.py").symbols.iter().any(|s| {
        s.wraps
            .iter()
            .any(|w| w.wrapper.ends_with("login_required"))
    }));
    assert!(
        f("blog/views.py").symbols[0]
            .wraps
            .iter()
            .any(|w| w.wrapper == "blog/hooks.py#require_login")
    );
    assert!(f("app/api/routes/users.py").has_test);
    let one = scan_file(r, &opts(cache.path(), 0), "shop/models.py")
        .unwrap()
        .unwrap();
    assert_eq!(one.models.len(), 1);
    assert_eq!(one.packages.len(), 2, "{:?}", one.packages);
    assert_matches_full(r, cache.path(), "initial");
    // The repo-wide inputs reach these files' facts.
    let items = f("shop/views.py");
    assert!(
        items
            .entry_points
            .iter()
            .all(|e| e.symbol.starts_with("ItemList")),
        "an unreached URLconf serves nothing: {:?}",
        items.entry_points
    );
    let kinds = |p: &str| -> Vec<drift_core::WrapKind> {
        f(p).symbols
            .iter()
            .flat_map(|s| s.wraps.iter().map(|w| w.kind))
            .collect()
    };
    assert!(kinds("shop/views.py").contains(&drift_core::WrapKind::Config));
    assert!(kinds("shop/api/views.py").contains(&drift_core::WrapKind::Config));
    assert!(kinds("blog/views.py").contains(&drift_core::WrapKind::AppHook));
    assert!(
        f("app/tasks.py")
            .entry_points
            .iter()
            .any(|e| e.kind == "cron"),
        "{:?}",
        f("app/tasks.py").entry_points
    );

    // A setting changes: login middleware and DRF defaults are gone.
    write(
        r,
        "mysite/settings.py",
        "ROOT_URLCONF = \"shop.urls\"\nMIDDLEWARE = []\n",
    );
    assert_matches_full(r, cache.path(), "settings changed");
    // The entry script names other settings, whose root is the legacy URLconf.
    write(
        r,
        "mysite/live.py",
        "ROOT_URLCONF = \"shop.legacy_urls\"\nMIDDLEWARE = [\"django.contrib.auth.middleware.LoginRequiredMiddleware\"]\n",
    );
    write(
        r,
        "manage.py",
        "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"mysite.live\")\n",
    );
    assert_matches_full(r, cache.path(), "entry script changed");
    // The root URLconf includes the legacy one; back to the first settings.
    write(
        r,
        "shop/urls.py",
        "from django.urls import path, include\nfrom shop import views\n\nurlpatterns = [\n    path(\"items/\", views.ItemList.as_view()),\n    path(\"legacy/\", include(\"shop.legacy_urls\")),\n    path(\"api/\", include(\"shop.api.urls\")),\n]\n",
    );
    write(
        r,
        "manage.py",
        "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"mysite.settings\")\n",
    );
    assert_matches_full(r, cache.path(), "root URLconf changed");
    assert!(
        f("shop/views.py")
            .entry_points
            .iter()
            .any(|e| e.symbol.starts_with("Legacy")),
        "the included URLconf is served"
    );
    // The factory (which itself mounts nothing) stops passing its app to the hook
    // helper; the beat names another task.
    write(
        r,
        "blog/factory.py",
        "from flask import Flask\nfrom blog.setup import register\n\ndef create_app():\n    app = Flask(__name__)\n    register(app)\n    return app\n",
    );
    write(
        r,
        "mysite/settings.py",
        "ROOT_URLCONF = \"shop.urls\"\nCELERY_BEAT_SCHEDULE = {\"nightly\": {\"task\": \"app.tasks.other\", \"schedule\": 3600}}\n",
    );
    assert_matches_full(r, cache.path(), "factory and beat changed");
    assert!(!kinds("blog/views.py").contains(&drift_core::WrapKind::AppHook));
    assert!(
        !f("app/tasks.py")
            .entry_points
            .iter()
            .any(|e| e.kind == "cron")
    );

    // Mounting a file that does not exist yet, then creating it.
    write(
        r,
        "app/api/__init__.py",
        "from fastapi import APIRouter\nfrom app.api.routes import users, items, orders\n\napi_router = APIRouter()\napi_router.include_router(users.router)\napi_router.include_router(items.router, prefix=\"/items\")\napi_router.include_router(orders.router, prefix=\"/orders\")\n",
    );
    assert_matches_full(r, cache.path(), "mount of a missing file");
    write(
        r,
        "app/api/routes/orders.py",
        "from fastapi import APIRouter\nfrom app.api.deps import CurrentUser\n\nrouter = APIRouter()\n\n@router.get(\"/{id}\")\ndef get_order(id: int, user: CurrentUser):\n    pass\n",
    );
    assert_matches_full(r, cache.path(), "new mounted file");
    // A typed parameter (`id: int`) is read in the listed reading only: the route
    // file has two readings, mining's without it and the listed one held beside, and
    // the single-file scan gives both as the full scan does. Before, it gave up on
    // any file with two readings (a full scan, silently).
    let whole = full(r);
    let orders = whole
        .files
        .iter()
        .find(|f| f.path == "app/api/routes/orders.py")
        .unwrap();
    let typed = |s: &drift_core::Symbol| {
        s.name == "get_order"
            && s.controls
                .iter()
                .any(|c| c == drift_core::controls::INPUT_TYPED)
    };
    let listed = orders.listed.as_deref().expect("a listed reading");
    assert!(listed.symbols.iter().any(typed), "{listed:?}");
    assert!(!orders.symbols.iter().any(typed), "{:?}", orders.symbols);
    assert_eq!(&f("app/api/routes/orders.py"), orders);
    assert_eq!(
        f("app/api/routes/orders.py").entry_points[0]
            .route
            .as_deref(),
        Some("/api/orders/{id}")
    );
    // A dependency alias changes: routes that use it change.
    write(
        r,
        "app/api/deps.py",
        "from typing import Annotated\nfrom fastapi import Depends\nfrom app.auth import Authenticator\nfrom app.db import get_db\n\nSessionDep = Annotated[object, Depends(get_db)]\n\ndef get_current_user():\n    return 1\n\nCurrentUser = Annotated[object, Depends(get_current_user)]\n_read = Authenticator(scopes=[\"r\"])\n\ndef verify():\n    pass\n",
    );
    assert_matches_full(r, cache.path(), "dependency changed");
    // The source of a star re-export is deleted.
    std::fs::remove_file(r.join("app/lib/text.py")).unwrap();
    assert_matches_full(r, cache.path(), "deleted re-export source");
    // A URLconf stops registering a view; a hook moves.
    write(
        r,
        "shop/api/urls.py",
        "from rest_framework.routers import DefaultRouter\n\nrouter = DefaultRouter()\nurlpatterns = []\n",
    );
    std::fs::remove_file(r.join("blog/hooks.py")).unwrap();
    write(
        r,
        "blog/auth.py",
        "from blog import bp\n\n@bp.before_request\ndef check():\n    pass\n",
    );
    assert_matches_full(r, cache.path(), "registration and hook moved");
    // The router class stops being a router.
    write(
        r,
        "app/core/router.py",
        "class VersionedRouter:\n    pass\n",
    );
    assert_matches_full(r, cache.path(), "router base changed");
    // A test file is removed; a manifest changes.
    std::fs::remove_file(r.join("app/tests/test_users.py")).unwrap();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\ndependencies = [\"fastapi>=0.116\"]\n",
    );
    assert_matches_full(r, cache.path(), "test removed, manifest changed");
    // A same-size rewrite right after a scan is still seen (racy stamps).
    scan(r, &opts(cache.path(), 0)).unwrap();
    write(r, "app/db.py", "def get_xx():\n    yield 1\n");
    assert_matches_full(r, cache.path(), "same-size rewrite");
    assert_eq!(scan(r, &opts(cache.path(), 0)).unwrap().0, full(r));
}

#[test]
fn single_file_scan_is_deterministic() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    for threads in [1, 4] {
        let cache = tempfile::tempdir().unwrap();
        scan(r, &opts(cache.path(), threads)).unwrap();
    }
    let cache = tempfile::tempdir().unwrap();
    scan(r, &opts(cache.path(), 0)).unwrap();
    for rel in [
        "app/api/routes/users.py",
        "shop/api/views.py",
        "blog/views.py",
    ] {
        let a = serde_json::to_string(&scan_file(r, &opts(cache.path(), 1), rel).unwrap()).unwrap();
        let b = serde_json::to_string(&scan_file(r, &opts(cache.path(), 4), rel).unwrap()).unwrap();
        assert_eq!(a, b, "{rel}");
    }
}

/// Kind facts ([`drift_py::kinds`]) read other files: in-repo job wrappers, test
/// files that mirror a module's directory, and the classes that extend a class. A
/// single-file scan gives the full scan's facts, or falls back (`None`) when a
/// class's bases leave the file or another file may extend one of its classes.
#[test]
fn single_file_scan_has_the_kind_facts_of_a_full_scan() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/worker.py",
        "import dramatiq\n\ndef actor(**options):\n    def decorator(fn):\n        dramatiq.actor(fn, **options)\n        return fn\n    return decorator\n",
    );
    write(
        r,
        "app/order/tasks.py",
        "from app.worker import actor\n\n@actor(priority=1)\nasync def order_created(order_id):\n    pass\n\ndef sign_payload(p):\n    return p\n",
    );
    write(
        r,
        "app/account/mutations/create_token.py",
        "class CreateToken:\n    pass\n\nclass CreateTokenMixin:\n    pass\n",
    );
    write(
        r,
        "app/account/tests/mutations/test_token_create.py",
        "def test_it():\n    pass\n",
    );
    write(r, "app/repos/base.py", "class Repository:\n    pass\n");
    write(
        r,
        "app/repos/users.py",
        "from app.repos.base import Repository\n\nclass UserRepository(Repository):\n    pass\n",
    );
    write(
        r,
        "app/repos/local.py",
        "from enum import Enum\n\nclass Kind(Enum):\n    A = 1\n\nclass SubKind(Kind):\n    pass\n",
    );
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 0,
    };
    let full = scan(r, &opts).unwrap().0;
    let of = |rel: &str| full.files.iter().find(|f| f.path == rel).unwrap().clone();
    let tasks = of("app/order/tasks.py");
    assert_eq!(
        tasks.entry_points.len(),
        1,
        "order_created is a job, the helper is not"
    );
    assert!(of("app/account/mutations/create_token.py").has_test);
    for rel in [
        "app/order/tasks.py",
        "app/worker.py",
        "app/account/mutations/create_token.py",
        "app/repos/local.py",
    ] {
        let one = scan_file(r, &opts, rel).unwrap().expect(rel);
        assert_eq!(one.files, [of(rel)], "{rel}");
    }
    // `UserRepository` extends a class of another file: that file is context.
    let one = scan_file(r, &opts, "app/repos/users.py").unwrap().unwrap();
    assert_eq!(one.files, [of("app/repos/users.py")]);
    let context: Vec<&str> = one.context_files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(context, ["app/repos/base.py"]);
    // `Repository` is extended by another file (`base` counts subclasses): a full
    // scan decides.
    assert!(scan_file(r, &opts, "app/repos/base.py").unwrap().is_none());
}

/// An inherited kind comes through a base in another file: `SubKind(Kind)` is an enum
/// because `Kind(Enum)` is, which only `Kind`'s file says.
#[test]
fn single_file_scan_inherits_kinds_through_other_files() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/kinds.py",
        "from enum import Enum\n\nclass Kind(Enum):\n    A = 1\n",
    );
    write(
        r,
        "app/mid.py",
        "from app.kinds import Kind\n\nclass MidKind(Kind):\n    pass\n",
    );
    write(
        r,
        "app/sub.py",
        "from app.mid import MidKind\n\nclass SubKind(MidKind):\n    pass\n",
    );
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 0,
    };
    let full = scan(r, &opts).unwrap().0;
    let sub = full.files.iter().find(|f| f.path == "app/sub.py").unwrap();
    assert_eq!(sub.symbols[0].traits, ["enum"]);
    let one = scan_file(r, &opts, "app/sub.py").unwrap().unwrap();
    assert_eq!(one.files, std::slice::from_ref(sub));
}
