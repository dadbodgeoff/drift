//! F5: fixes of review R5 to the Python readings that only the listed reading takes
//! (`RepoFacts::listed`). Each test pins one, and that what mining reads is what the
//! measured build gave it.

use std::path::Path;

use drift_core::{RepoFacts, Symbol, WrapKind, controls};
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

/// The controls only the listed reading has: none of them may be in what mining
/// reads, of any symbol.
const LISTED_ONLY: &[&str] = &[controls::INPUT_TYPED, controls::NO_RESPONSE_MODEL];

fn none_listed_only(mined: &RepoFacts) {
    for f in &mined.files {
        for s in &f.symbols {
            for c in &s.controls {
                assert!(
                    !LISTED_ONLY.contains(&c.as_str()),
                    "{}#{}: {c} reached what mining reads",
                    f.path,
                    s.name
                );
            }
            for w in &s.wraps {
                assert!(
                    !w.wrapper.starts_with("unresolved:permission_classes"),
                    "{}#{}: {}",
                    f.path,
                    s.name,
                    w.wrapper
                );
            }
        }
    }
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

/// Review R5, row 1: a repository whose only readings made since are a typed
/// parameter and `response_model=None` is linked twice, and what mining reads has
/// neither. Before, a file nothing else marked was not linked again, and mining read
/// the listed facts (`input_typed`, `no_response_model` became candidate controls).
/// Row 7: `UploadFile` is a package's class, not read: it parses nothing here.
#[test]
fn readings_made_since_never_reach_what_mining_reads() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(
        r,
        "api/main.py",
        r#"from fastapi import FastAPI, File, UploadFile
from pydantic import BaseModel

app = FastAPI()


class Message(BaseModel):
    message: str


@app.get("/items/{id}")
def by_id(id: int):
    return {"ok": True}


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    return {"ok": True}


@app.get("/raw", response_model=None)
def raw() -> Message:
    return Message(message="x")
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let m = "api/main.py";
    assert!(has_control(&listed, m, "by_id", controls::INPUT_TYPED));
    assert!(!has_control(&listed, m, "upload", controls::INPUT_TYPED));
    assert!(has_control(&listed, m, "raw", controls::NO_RESPONSE_MODEL));
    none_listed_only(&mined);
}

/// Review R5, row 7: a converter the repository registers (its pattern may be
/// `.+`) is not said to parse; the framework's own `int` is.
#[test]
fn a_converter_the_repository_registers_parses_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "");
    write(
        r,
        "depot/views.py",
        r#"from django.http import JsonResponse


def item(request, pk):
    return JsonResponse({})


def ident(request, pk):
    return JsonResponse({})
"#,
    );
    write(
        r,
        "depot/urls.py",
        r#"from django.urls import path, register_converter

from depot import views


class AnyText:
    regex = ".+"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


register_converter(AnyText, "hex")

urlpatterns = [
    path("items/<hex:pk>/", views.item),
    path("ids/<int:pk>/", views.ident),
]
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let v = "depot/views.py";
    assert!(!has_control(&listed, v, "item", controls::INPUT_TYPED));
    assert!(has_control(&listed, v, "ident", controls::INPUT_TYPED));
    none_listed_only(&mined);
}

/// Review R5, row 8: a base of the repository that defines a method no HTTP verb
/// names (`dispatch`) may run `permission_classes` itself. The listed reading says
/// so (an `unresolved:` wrap, unknown), never that they run nowhere. Before, every
/// class of the repository in the chain was passed over unread, and the wraps were
/// dropped. What mining reads keeps the measured build's wraps.
#[test]
fn a_base_of_the_repository_that_dispatches_leaves_the_attributes_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "\"rest_framework\"");
    write(
        r,
        "depot/views.py",
        r#"from django.http import JsonResponse
from django.views import View
from rest_framework.permissions import IsAuthenticated


class Checked(View):
    def dispatch(self, request, *args, **kwargs):
        for p in self.permission_classes:
            p().has_permission(request, self)
        return super().dispatch(request, *args, **kwargs)


class SignOut(Checked):
    permission_classes = [IsAuthenticated]

    def post(self, request):
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
]
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    const PERM: &str = "pkg:rest_framework#permissions.IsAuthenticated";
    let v = "depot/views.py";
    let wraps = call_wraps(&listed, v, "SignOut.post");
    assert!(!wraps.iter().any(|w| w == PERM), "{wraps:?}");
    assert!(
        wraps
            .iter()
            .any(|w| w.starts_with("unresolved:permission_classes, run only if")),
        "{wraps:?}"
    );
    assert!(
        call_wraps(&mined, v, "SignOut.post")
            .iter()
            .any(|w| w == PERM)
    );
    none_listed_only(&mined);
}
