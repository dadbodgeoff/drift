//! S15c: readings of Python code the first wave of since-measured readings did not
//! reach. Each test pins one reading in the listed facts (`RepoFacts::listed`, what
//! `drift security` and the practice map read), a case beside it that must not
//! take it, and that what mining reads is what the measured build gave it.

use std::path::Path;

use drift_core::{CATCH_RESPONDS, RepoFacts, Symbol, controls};
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

fn has_control(repo: &RepoFacts, path: &str, name: &str, control: &str) -> bool {
    symbol(repo, path, name).controls.iter().any(|c| c == control)
}

/// No reading's marker is left in either copy of the facts: the lowering's
/// `since:` / `measured:` prefixes are the linker's to take off.
fn no_marker_left(repo: &RepoFacts) {
    for f in &repo.files {
        for s in &f.symbols {
            let mark = |c: &String| c.starts_with("since:") || c.starts_with("measured:");
            assert!(!s.controls.iter().any(mark), "{}#{}: {:?}", f.path, s.name, s.controls);
            for m in &s.members {
                assert!(!m.unread.iter().any(mark), "{}#{}.{}", f.path, s.name, m.name);
            }
        }
    }
}

/// The ways the errors concern reads for the units of `symbol` (by prefix):
/// each unit's own key, or its variant's where the unit has none of its own.
fn error_ways(repo: &RepoFacts, prefix: &str) -> Vec<String> {
    let opts = drift_mine::practices::Options {
        units: true,
        ..Default::default()
    };
    let r = drift_mine::practices::practices(repo, &opts);
    let c = r
        .concerns
        .iter()
        .find(|c| c.id == "errors")
        .expect("errors concern");
    c.units
        .iter()
        .filter(|u| u.symbol.starts_with(prefix))
        .map(|u| {
            u.key.clone().unwrap_or_else(|| {
                c.variants
                    .iter()
                    .find(|v| v.id == u.variant)
                    .map_or_else(|| format!("{}:{:?}", u.assignment, u.reason), |v| v.key.clone())
            })
        })
        .collect()
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

/// Item 1: a FastAPI dependency whose `except` turns a bad token into a 403
/// refuses the caller; it maps none of the route's errors (full-stack-fastapi-template
/// `deps.py#get_current_user`, 17 units read "mapped by wrapper"). A dependency
/// whose catch answers 400 still maps the route's errors.
#[test]
fn a_dependency_that_refuses_in_its_catch_maps_no_errors() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "app/deps.py",
        r#"import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

oauth2 = OAuth2PasswordBearer(tokenUrl="/login")
KEY = "k"


def get_current_user(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=403, detail="Could not validate credentials")
    user = lookup(payload["sub"])
    if not user:
        raise HTTPException(status_code=403, detail="Not authenticated")
    return user


def parsed_body(raw: str = ""):
    try:
        return int(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="not a number")
"#,
    );
    write(
        r,
        "app/main.py",
        r#"from fastapi import Depends, FastAPI

from app.deps import get_current_user, parsed_body

app = FastAPI()


@app.get("/me")
def read_me(user=Depends(get_current_user)):
    return {"id": user.id}


@app.get("/n")
def read_n(n=Depends(parsed_body)):
    return {"n": n}
"#,
    );
    let mined = scanned(r);
    no_marker_left(&mined);
    no_marker_left(&mined.listed());
    let me = error_ways(&mined, "read_me");
    assert!(!me.is_empty(), "read_me is a unit");
    assert!(
        !me.iter().any(|k| k.contains("mapped_by_wrapper")),
        "{me:?}"
    );
    let n = error_ways(&mined, "read_n");
    assert!(
        n.iter().any(|k| k.contains("mapped_by_wrapper")),
        "{n:?}"
    );
    // No fact was added: the dependency's catches read as the measured build read them.
    let d = "app/deps.py";
    assert_eq!(
        symbol(&mined, d, "get_current_user").catches,
        symbol(&mined.listed(), d, "get_current_user").catches
    );
}

/// Item 2: a base view's own `handle_exception` that answers what the framework's
/// method raised is how its views' errors become responses (plane
/// `BaseAPIView.handle_exception`). The listed reading marks the member
/// ([`CATCH_RESPONDS`]); one that only logs and hands on stays as it was.
#[test]
fn a_base_views_handle_exception_answers_its_views_errors() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "\"rest_framework\"");
    write(
        r,
        "depot/views.py",
        r#"import logging

from django.core.exceptions import ObjectDoesNotExist
from rest_framework.response import Response
from rest_framework.views import APIView

log = logging.getLogger(__name__)


class BaseAPIView(APIView):
    def handle_exception(self, exc):
        try:
            return super().handle_exception(exc)
        except ObjectDoesNotExist:
            return Response({"error": "not found"}, status=404)


class Quiet(APIView):
    def handle_exception(self, exc):
        log.warning("failed: %s", exc)
        return super().handle_exception(exc)


class ItemView(BaseAPIView):
    def get(self, request):
        return Response({})


class QuietView(Quiet):
    def get(self, request):
        return Response({})
"#,
    );
    write(
        r,
        "depot/urls.py",
        r#"from django.urls import path

from depot import views

urlpatterns = [
    path("items/", views.ItemView.as_view()),
    path("quiet/", views.QuietView.as_view()),
]
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    no_marker_left(&mined);
    no_marker_left(&listed);
    let v = "depot/views.py";
    let responds = |repo: &RepoFacts, class: &str| {
        symbol(repo, v, class)
            .members
            .iter()
            .find(|m| m.name == "handle_exception")
            .unwrap_or_else(|| panic!("{class}.handle_exception"))
            .unread
            .iter()
            .any(|c| c == CATCH_RESPONDS)
    };
    assert!(responds(&listed, "BaseAPIView"));
    assert!(!responds(&listed, "Quiet"));
    // Mining reads what the measured build read.
    assert!(!responds(&mined, "BaseAPIView"));
    assert!(!responds(&mined, "Quiet"));
    let item = error_ways(&mined, "ItemView");
    assert!(
        item.iter().any(|k| k.contains("base_handler")),
        "{item:?}"
    );
    let quiet = error_ways(&mined, "QuietView");
    assert!(
        !quiet.iter().any(|k| k.contains("base_handler")),
        "{quiet:?}"
    );
}

/// Item 5: a path joined from what the request sent, bound to a local and then
/// opened (pygoat `ssrf_lab/app.py#lab1`). A name bound again to a fixed path, a
/// join of fixed parts and a binding that is not followed (a tuple) are no sink.
/// Mining reads none of it.
#[test]
fn a_path_joined_into_a_local_then_opened_is_path_traversal() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "app/ops.py",
        r#"import os

from flask import Flask, request

app = Flask(__name__)


@app.route("/lab1", methods=["POST"])
def lab1():
    name = request.form["file"]
    path = os.path.join(os.getcwd(), name)
    with open(path) as f:
        return f.read()


def rebound(name):
    path = os.path.join("/srv", name)
    path = "/srv/fixed.txt"
    with open(path) as f:
        return f.read()


def fixed():
    path = os.path.join("/srv", "schema.sql")
    with open(path) as f:
        return f.read()


def unfollowed(name):
    path, other = os.path.join("/srv", name), 1
    with open(path) as f:
        return f.read()
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    no_marker_left(&mined);
    no_marker_left(&listed);
    let p = "app/ops.py";
    let fed = format!("{}{}", controls::SINK_FED, "path_traversal");
    let sinks = |repo: &RepoFacts, n: &str| symbol(repo, p, n).sinks.clone();
    assert!(
        sinks(&listed, "lab1").iter().any(|k| k == "path_traversal"),
        "{:?}",
        sinks(&listed, "lab1")
    );
    assert!(has_control(&listed, p, "lab1", &fed));
    for n in ["rebound", "fixed", "unfollowed"] {
        assert!(
            !sinks(&listed, n).iter().any(|k| k == "path_traversal"),
            "{n}: {:?}",
            sinks(&listed, n)
        );
        assert!(!has_control(&listed, p, n, &fed), "{n}");
    }
    // Mining reads what the measured build read.
    assert!(!sinks(&mined, "lab1").iter().any(|k| k == "path_traversal"));
    assert!(!has_control(&mined, p, "lab1", &fed));
}

/// Item 6: a refusal is read from the status the raised class's own definition
/// sets, where the listed reading has one: `Nope` answers 403 whatever it is
/// called, `AuthError` answers 400 however much its name says sign-in. A class
/// whose definition writes no status is read by its name, as before (the marked
/// fallback). The class carries its status (`refusal_status:403`). Mining reads
/// every one by its name, as the measured build did.
#[test]
fn a_refusal_is_read_from_the_raised_class_status() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "deps.py",
        r#"class Nope(Exception):
    status_code = 403


class AuthError(Exception):
    status_code = 400


class Unauthorized(Exception):
    pass


def by_status(token=None):
    if not token:
        return None
    if not valid(token):
        raise Nope()
    return token


def by_name_but_400(token=None):
    if not token:
        return None
    if not valid(token):
        raise AuthError()
    return token


def by_name_unwritten(token=None):
    if not token:
        return None
    if not valid(token):
        raise Unauthorized()
    return token
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    no_marker_left(&mined);
    no_marker_left(&listed);
    let d = "deps.py";
    let some = controls::REJECTS_SOME;
    assert!(has_control(&listed, d, "by_status", some));
    assert!(!has_control(&listed, d, "by_name_but_400", some));
    assert!(has_control(&listed, d, "by_name_unwritten", some));
    let status = format!("{}403", controls::REFUSAL_STATUS);
    assert!(has_control(&listed, d, "Nope", &status));
    for n in ["AuthError", "Unauthorized"] {
        assert!(
            !symbol(&listed, d, n)
                .controls
                .iter()
                .any(|c| c.starts_with(controls::REFUSAL_STATUS)),
            "{n}"
        );
    }
    // Mining reads what the measured build read: by name.
    assert!(!has_control(&mined, d, "by_status", some));
    assert!(has_control(&mined, d, "by_name_but_400", some));
    assert!(has_control(&mined, d, "by_name_unwritten", some));
    assert!(!has_control(&mined, d, "Nope", &status));
}
