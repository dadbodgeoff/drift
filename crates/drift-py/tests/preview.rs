//! Previews of Python content that is about to be written.

use std::path::Path;

use drift_py::{Preview, preview_file};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn lowered(p: Preview) -> (drift_core::FileFacts, Vec<drift_core::Model>) {
    match p {
        Preview::Lowered { facts, models } => (*facts, models),
        other => panic!("not lowered: {other:?}"),
    }
}

#[test]
fn previews_resolve_what_the_content_imports() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"app\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/worker.py",
        "from celery import Celery\n\ncelery_app = Celery(\"w\")\n",
    );
    write(
        r,
        "app/api/__init__.py",
        "from app.api.base import router\n",
    );
    write(
        r,
        "app/api/base.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/v1\")\n",
    );
    write(
        r,
        "app/views_base.py",
        "from rest_framework import viewsets\n\nclass ItemViewSet(viewsets.ModelViewSet):\n    pass\n",
    );
    let r = r.canonicalize().unwrap();
    let r = r.as_path();

    // A task on a Celery app defined elsewhere, a route on a router re-exported by a
    // package `__init__`.
    let (f, _) = lowered(preview_file(
        r,
        "app/tasks.py",
        "from app.worker import celery_app\n\n@celery_app.task\ndef send():\n    pass\n",
    ));
    assert_eq!(f.entry_points[0].kind, "job");
    assert_eq!(f.package, "");
    let (f, _) = lowered(preview_file(
        r,
        "app/api/users.py",
        "from app.api import router\n\n@router.get(\"/users\")\ndef users():\n    return []\n",
    ));
    assert_eq!(f.entry_points[0].kind, "http");
    // A preview does not read the files that mount the router, so what it is mounted
    // under is not known: `?`, never the router's own prefix alone.
    assert_eq!(f.entry_points[0].route.as_deref(), Some("/?/v1/users"));

    // Class-based views nothing registers yet get the entry points a registration gives.
    let (f, _) = lowered(preview_file(
        r,
        "app/views.py",
        "from app.views_base import ItemViewSet\nfrom django.views import View\n\nclass Sub(ItemViewSet):\n    queryset = None\n\nclass Page(View):\n    def get(self, request):\n        pass\n\nclass Plain:\n    pass\n",
    ));
    let entries: Vec<(&str, &str, Option<&str>)> = f
        .entry_points
        .iter()
        .map(|e| (e.symbol.as_str(), e.kind.as_str(), e.method.as_deref()))
        .collect();
    assert_eq!(
        entries,
        [
            ("Page.get", "http", Some("GET")),
            ("Sub", "http", Some("ANY"))
        ]
    );

    // Models, and what a scan would skip or cannot parse.
    let (_, models) = lowered(preview_file(
        r,
        "app/models.py",
        "from django.db import models\n\nclass Item(models.Model):\n    name = models.CharField(max_length=3)\n",
    ));
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].source, "django");
    assert_eq!(
        preview_file(r, "app/gen.py", "# @generated\nx = 1\n"),
        Preview::Skipped
    );
    assert_eq!(preview_file(r, "app/x_pb2.py", "x = 1\n"), Preview::Skipped);
    assert_eq!(preview_file(r, "app/x.pyi", "x: int\n"), Preview::Skipped);
    let deep = format!("x = {}1{}\n", "[\n".repeat(50_000), "\n]".repeat(50_000));
    assert_eq!(preview_file(r, "app/deep.py", &deep), Preview::Skipped);
    assert_eq!(
        preview_file(r, "app/broken.py", "def f(:\n    pass\n"),
        Preview::Unparsed
    );
}
