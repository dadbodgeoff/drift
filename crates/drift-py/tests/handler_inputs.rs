//! Python handlers record whether they read request input (`reads_input`), provably
//! read none (`no_input`), or neither (not known).

use std::path::Path;

use drift_core::{RepoFacts, controls};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `reads`, `none` or `unknown` for an entry point's symbol.
fn input(repo: &RepoFacts, path: &str, symbol: &str) -> &'static str {
    let f = repo.files.iter().find(|f| f.path == path).unwrap();
    assert!(
        f.entry_points.iter().any(|e| e.symbol == symbol),
        "{symbol} is no entry point of {path}"
    );
    let s = f.symbols.iter().find(|s| s.name == symbol).unwrap();
    let has = |c: &str| s.controls.iter().any(|x| x == c);
    match (has(controls::READS_INPUT), has(controls::NO_INPUT)) {
        (true, false) => "reads",
        (false, true) => "none",
        (false, false) => "unknown",
        _ => panic!("{symbol}: both"),
    }
}

#[test]
fn handlers_say_what_input_they_read() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(
        r,
        "api/main.py",
        r#"from typing import Annotated
from fastapi import BackgroundTasks, Depends, FastAPI, Query, Request
from pydantic import BaseModel

app = FastAPI()


class ItemIn(BaseModel):
    name: str


def get_user():
    return None


def get_db():
    yield None


CurrentUser = Annotated[object, Depends(get_user)]


def helper(request):
    return request


@app.get("/items/{item_id}")
async def read_item(item_id):
    return {"item_id": item_id}


@app.get("/items")
async def list_items(q: str = Query(None)):
    return []


@app.post("/items")
async def create(item: ItemIn):
    return item


@app.get("/me")
async def me(user: CurrentUser):
    return user


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.post("/raw")
async def raw(request: Request):
    return await request.json()


@app.post("/passes")
async def passes(request: Request):
    return helper(request)


@app.post("/bg")
async def bg(tasks: BackgroundTasks, db=Depends(get_db)):
    return {}
"#,
    );
    write(
        r,
        "web/app.py",
        r#"from flask import Flask, request

app = Flask(__name__)


@app.route("/a", methods=["POST"])
def a():
    data = request.get_json()
    return data


@app.route("/b")
def b():
    return "ok"


@app.route("/c/<int:item_id>")
def c(item_id):
    return str(item_id)
"#,
    );
    write(r, "proj/__init__.py", "");
    write(r, "proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    write(
        r,
        "proj/urls.py",
        r#"from django.urls import path
from proj import views

urlpatterns = [
    path("view/", views.view),
    path("page/", views.page),
    path("out/", views.logout_view),
    path("d/<int:pk>/", views.detail),
    path("j/", views.body_json),
    path("v/", views.V.as_view()),
]
"#,
    );
    write(
        r,
        "proj/views.py",
        r#"import json
from django.contrib.auth import logout
from django.shortcuts import redirect, render
from rest_framework.response import Response
from rest_framework.views import APIView


def view(request):
    return request.POST.get("x")


def page(request):
    return render(request, "x.html")


def logout_view(request):
    logout(request)
    return redirect("/")


def detail(request, pk):
    return pk


def body_json(request):
    return json.loads(request.body)


class V(APIView):
    def post(self, request):
        return Response(request.data)

    def get(self, request):
        return Response(self.get_queryset())

    def delete(self, request, pk):
        return Response(status=204)
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
    let cases = [
        ("api/main.py", "read_item", "reads"),
        ("api/main.py", "list_items", "reads"),
        ("api/main.py", "create", "reads"),
        ("api/main.py", "me", "none"),
        ("api/main.py", "ping", "none"),
        ("api/main.py", "raw", "reads"),
        ("api/main.py", "passes", "unknown"),
        ("api/main.py", "bg", "none"),
        ("web/app.py", "a", "reads"),
        ("web/app.py", "b", "none"),
        ("web/app.py", "c", "reads"),
        ("proj/views.py", "view", "reads"),
        ("proj/views.py", "page", "unknown"),
        ("proj/views.py", "logout_view", "none"),
        ("proj/views.py", "detail", "reads"),
        ("proj/views.py", "body_json", "reads"),
        ("proj/views.py", "V.post", "reads"),
        ("proj/views.py", "V.get", "unknown"),
        ("proj/views.py", "V.delete", "reads"),
    ];
    let got: Vec<(&str, &str, &str)> = cases
        .iter()
        .map(|(p, s, _)| (*p, *s, input(&repo, p, s)))
        .collect();
    assert_eq!(got, cases.to_vec());
    // Not an entry point: no input fact.
    let main = repo.files.iter().find(|f| f.path == "api/main.py").unwrap();
    let helper = main.symbols.iter().find(|s| s.name == "helper").unwrap();
    assert!(
        !helper
            .controls
            .iter()
            .any(|c| c == controls::READS_INPUT || c == controls::NO_INPUT)
    );
}
