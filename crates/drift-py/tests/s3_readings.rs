//! S3: readings of Python code that the security inventory and the practice map
//! take (`RepoFacts::listed`) and mining does not. Each test pins one of them, and
//! that what mining reads is what the measured build gave it.

use std::path::Path;

use drift_core::{RepoFacts, Symbol, WrapKind, controls, not_always};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scanned(root: &Path) -> RepoFacts {
    scan(
        root,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

fn symbol<'a>(repo: &'a RepoFacts, path: &str, name: &str) -> &'a Symbol {
    let f = repo
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path}"));
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{path}#{name}"))
}

fn call_wraps(repo: &RepoFacts, path: &str, name: &str) -> Vec<String> {
    symbol(repo, path, name)
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Call)
        .map(|w| w.wrapper.clone())
        .collect()
}

fn has_control(repo: &RepoFacts, path: &str, name: &str, control: &str) -> bool {
    symbol(repo, path, name)
        .controls
        .iter()
        .any(|c| c == control)
}

fn django_project(r: &Path, apps: &str) {
    write(
        r,
        "manage.py",
        "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"depot.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n",
    );
    write(r, "depot/__init__.py", "");
    write(
        r,
        "depot/settings.py",
        &format!(
            "SECRET_KEY = \"x\"\nROOT_URLCONF = \"depot.urls\"\nINSTALLED_APPS = [{apps}]\nMIDDLEWARE = []\n"
        ),
    );
}

/// Fix 1: DRF reads `permission_classes` only on its own views. On a plain Django
/// `View` (plane `license/api/views/admin.py:430`) the attribute guards nothing, so
/// the listed reading drops it; on a base that is not read the reading is unknown
/// (an `unresolved:` wrap), never the class credited. Mining keeps the measured
/// build's wraps.
#[test]
fn permission_classes_count_only_where_drf_reads_them() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "\"rest_framework\"");
    write(
        r,
        "depot/views.py",
        r#"from django.http import JsonResponse
from django.views import View
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from vendorkit.views import VendorView


class SignOut(View):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return JsonResponse({})


class Drf(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({})


class Other(VendorView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return JsonResponse({})
"#,
    );
    write(
        r,
        "depot/urls.py",
        r#"from django.urls import path

from depot import views

urlpatterns = [
    path("signout/", views.SignOut.as_view()),
    path("drf/", views.Drf.as_view()),
    path("other/", views.Other.as_view()),
]
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    const PERM: &str = "pkg:rest_framework#permissions.IsAuthenticated";
    let v = "depot/views.py";
    assert!(
        !call_wraps(&listed, v, "SignOut.post")
            .iter()
            .any(|w| w == PERM),
        "{:?}",
        call_wraps(&listed, v, "SignOut.post")
    );
    assert!(call_wraps(&listed, v, "Drf.get").iter().any(|w| w == PERM));
    let other = call_wraps(&listed, v, "Other.get");
    assert!(!other.iter().any(|w| w == PERM), "{other:?}");
    assert!(
        other
            .iter()
            .any(|w| w.starts_with("unresolved:permission_classes, run only if")),
        "{other:?}"
    );
    // What mining reads: as the measured build gave it.
    assert!(
        call_wraps(&mined, v, "SignOut.post")
            .iter()
            .any(|w| w == PERM)
    );
}

/// Fix 3, withdrawn (review R5, row 2): reading a `raise` in an `except` handler as
/// skipping nothing changed the lowering both readings share, and so the
/// `conditional` of what mining reads. Pins that what mining reads is as the
/// measured build gave it: the check after the `try` stays
/// `after_conditional_return`, in both readings, as after a `return` there.
#[test]
fn a_raise_in_an_except_handler_leaves_what_mining_reads_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(
        r,
        "app/deps.py",
        r#"import jwt
from fastapi import HTTPException


def lookup(sub):
    return None


def get_current_user(token: str):
    try:
        payload = jwt.decode(token, "k", algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=403, detail="bad token")
    user = lookup(payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="no user")
    return user


def get_optional_user(token: str):
    try:
        payload = jwt.decode(token, "k", algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    user = lookup(payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="no user")
    return user
"#,
    );
    let repo = scanned(r);
    let listed = repo.listed();
    let checks = |facts: &RepoFacts, name: &str| -> Vec<(bool, String)> {
        symbol(facts, "app/deps.py", name)
            .raise_checks
            .iter()
            .filter(|c| c.status == 404)
            .map(|c| (c.conditional, c.condition.clone()))
            .collect()
    };
    let after = || [(true, not_always::AFTER_CONDITIONAL_RETURN.to_string())];
    for facts in [&repo, &*listed] {
        assert_eq!(checks(facts, "get_current_user"), after());
        assert_eq!(checks(facts, "get_optional_user"), after());
    }
}

/// Fix 4: a parameter the framework parses by its declared type before the
/// handler runs is validated input. Decided from the annotation (FastAPI) or the
/// route's converter (Django), never from a list of type names: `uuid.UUID` and
/// `<uuid:pk>` parse; `str` and `<str:slug>` take anything. Listed reading only.
#[test]
fn parameters_parsed_by_their_types_are_typed_input() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(
        r,
        "api/main.py",
        r#"import uuid

from fastapi import FastAPI

app = FastAPI()


@app.delete("/items/{id}")
def delete_item(id: uuid.UUID):
    return {"ok": True}


@app.get("/search")
def search(q: str):
    return []
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let m = "api/main.py";
    assert!(has_control(
        &listed,
        m,
        "delete_item",
        controls::INPUT_TYPED
    ));
    assert!(!has_control(&listed, m, "search", controls::INPUT_TYPED));
    assert!(!has_control(
        &mined,
        m,
        "delete_item",
        controls::INPUT_TYPED
    ));

    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "");
    write(
        r,
        "depot/views.py",
        r#"from django.http import JsonResponse


def item(request, pk):
    return JsonResponse({})


def page(request, slug):
    return JsonResponse({})
"#,
    );
    write(
        r,
        "depot/urls.py",
        r#"from django.urls import path

from depot import views

urlpatterns = [
    path("items/<uuid:pk>/", views.item),
    path("pages/<str:slug>/", views.page),
]
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let v = "depot/views.py";
    assert!(has_control(&listed, v, "item", controls::INPUT_TYPED));
    assert!(!has_control(&listed, v, "page", controls::INPUT_TYPED));
    assert!(!has_control(&mined, v, "item", controls::INPUT_TYPED));
}

/// Fix 5: `response_model=None` turns FastAPI's return-annotation model off. The
/// lowering notes it, and only the listed reading carries it, so the practice map
/// does not read `-> Message` as the response model there.
#[test]
fn response_model_none_is_noted_in_the_listed_reading_only() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(
        r,
        "api/main.py",
        r#"from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Message(BaseModel):
    message: str


@app.get("/raw", response_model=None)
def raw() -> Message:
    return Message(message="x")


@app.get("/typed")
def typed() -> Message:
    return Message(message="x")
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let m = "api/main.py";
    assert!(has_control(&listed, m, "raw", controls::NO_RESPONSE_MODEL));
    assert!(!has_control(
        &listed,
        m,
        "typed",
        controls::NO_RESPONSE_MODEL
    ));
    assert!(!has_control(&mined, m, "raw", controls::NO_RESPONSE_MODEL));
}
