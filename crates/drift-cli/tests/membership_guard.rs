//! A permission class that lets a caller in only where a lookup of the caller in
//! what the request names finds a row: `return Member.objects.filter(member=
//! request.user, workspace__slug=view.workspace_slug).exists()`.
//!
//! Nothing here goes by a name: not the class's, not the model's, not the keys'.
//! The body is read. Every `return` gives `False` or the result of a query, and
//! each of those queries is given a value of the caller under one key and a value
//! of the request under another. A return that gives anything else for some
//! requests (`True`, an `or`, a query the caller is no part of) is no such body,
//! and the class stays what its name alone says: found, not proven.
//!
//! The same body's opening refusal, `if request.user.is_anonymous: return False`,
//! is the sign-in test said of who is not signed in: the class authenticates.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn drift(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// What the practice map says of the authorization of each route, by its path:
/// `known <mechanisms>`, `none`, or `unknown <reason> <obligation>`.
fn authz(root: &Path) -> BTreeMap<String, String> {
    let map = drift(root, &["practices", "--json", "--units"]);
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .cloned()
        .unwrap();
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|v| {
            std::iter::once(v.clone())
                .chain(v["alternatives"].as_array().into_iter().flatten().cloned())
        })
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    let mechanisms: Vec<&str> = key
                        .split('+')
                        .map(|k| k.split(':').next().unwrap_or_default())
                        .collect();
                    format!("known {}", mechanisms.join("+"))
                }
                "unknown" => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

fn repo(permissions: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "django\ndjangorestframework\n"),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            "INSTALLED_APPS = [\"rest_framework\", \"desk\"]\nROOT_URLCONF = \"proj.urls\"\n",
        ),
        ("proj/urls.py", URLS),
        ("desk/__init__.py", ""),
        ("desk/models.py", MODELS),
        ("desk/permissions.py", permissions),
        ("desk/views.py", VIEWS),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

const URLS: &str = r#"from django.urls import path

from desk import views

urlpatterns = [
    path("spaces/<str:slug>/notes/", views.Notes.as_view()),
]
"#;

const MODELS: &str = r#"from django.conf import settings
from django.db import models


class Space(models.Model):
    slug = models.SlugField()


class Seat(models.Model):
    space = models.ForeignKey(Space, on_delete=models.CASCADE)
    holder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    level = models.IntegerField()


class Note(models.Model):
    space = models.ForeignKey(Space, on_delete=models.CASCADE)
    text = models.TextField()
"#;

const VIEWS: &str = r#"from rest_framework.response import Response
from rest_framework.views import APIView

from desk.models import Note
from desk.permissions import Gate


class Notes(APIView):
    permission_classes = [Gate]

    def get(self, request, slug):
        return Response(list(Note.objects.filter(space__slug=slug).values()))
"#;

const HEAD: &str = r#"from rest_framework.permissions import SAFE_METHODS, BasePermission

from desk.models import Seat
"#;

const ROUTE: &str = "/spaces/<str:slug>/notes";

fn said(permissions: &str) -> String {
    let dir = repo(&format!("{HEAD}{permissions}"));
    let got = authz(dir.path());
    got.get(ROUTE)
        .unwrap_or_else(|| panic!("no authorization unit for {ROUTE}: {got:?}"))
        .clone()
}

#[test]
fn a_lookup_of_the_caller_in_what_the_request_names_is_the_check() {
    // One return.
    assert_eq!(
        said(
            r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(holder=request.user, space__slug=view.kwargs["slug"]).exists()
"#
        ),
        "known membership_guard"
    );
    // A return for each kind of request, each of them such a lookup.
    assert_eq!(
        said(
            r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        if request.method in SAFE_METHODS:
            return Seat.objects.filter(
                space__slug=view.kwargs["slug"], holder=request.user
            ).exists()
        return Seat.objects.filter(
            space__slug=view.kwargs["slug"], holder=request.user, level__in=[15, 20]
        ).exists()
"#
        ),
        "known membership_guard"
    );
}

#[test]
fn a_query_on_what_the_lookup_found_narrows_it_and_is_read_with_it() {
    // The rows found by the caller in what the request names, narrowed again.
    assert_eq!(
        said(
            r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        seats = Seat.objects.filter(holder=request.user, space__slug=view.kwargs["slug"])
        if seats.filter(level=20).exists():
            return True
        return seats.exists() and view.kwargs["slug"] != "archive"
"#
        ),
        "known membership_guard"
    );
    // The caller given in the second link of the chain.
    assert_eq!(
        said(
            r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(space__slug=view.kwargs["slug"]).filter(holder=request.user).exists()
"#
        ),
        "known membership_guard"
    );
    // No link of the chain is given the caller.
    let no_caller = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(space__slug=view.kwargs["slug"]).filter(level=20).exists()
"#,
    );
    assert!(
        no_caller.starts_with("unknown check_not_proven"),
        "{no_caller}"
    );
    // The caller is what the second link leaves out.
    let left_out = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(space__slug=view.kwargs["slug"]).exclude(holder=request.user).exists()
"#,
    );
    assert!(
        left_out.starts_with("unknown check_not_proven"),
        "{left_out}"
    );
}

#[test]
fn a_body_that_lets_some_request_in_without_the_lookup_proves_nothing() {
    // `True` for some requests.
    let open_for_reads = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        if request.method in SAFE_METHODS:
            return True
        return Seat.objects.filter(holder=request.user, space__slug=view.kwargs["slug"]).exists()
"#,
    );
    assert!(
        open_for_reads.starts_with("unknown check_not_proven"),
        "{open_for_reads}"
    );
    // An `or` beside the lookup.
    let or_a_flag = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return (
            view.kwargs["slug"] == "public"
            or Seat.objects.filter(holder=request.user, space__slug=view.kwargs["slug"]).exists()
        )
"#,
    );
    assert!(
        or_a_flag.starts_with("unknown check_not_proven"),
        "{or_a_flag}"
    );
    // A lookup the caller is no part of: whether the space has any seat.
    let not_the_caller = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(space__slug=view.kwargs["slug"]).exists()
"#,
    );
    assert!(
        not_the_caller.starts_with("unknown check_not_proven"),
        "{not_the_caller}"
    );
    // A lookup of the caller in nothing the request names: any seat anywhere.
    let anywhere = said(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(holder=request.user).exists()
"#,
    );
    assert!(
        anywhere.starts_with("unknown check_not_proven"),
        "{anywhere}"
    );
}

/// A Django project whose views are plain functions behind a decorator of the
/// repository, and the routes of [`WRAPPED_URLS`].
fn wrapped(guards: &str, views: &str) -> BTreeMap<String, String> {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "django\n"),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            "INSTALLED_APPS = [\"django.contrib.auth\", \"desk\"]\nROOT_URLCONF = \"proj.urls\"\n",
        ),
        ("proj/urls.py", WRAPPED_URLS),
        ("desk/__init__.py", ""),
        ("desk/models.py", MODELS),
        ("desk/guards.py", guards),
        ("desk/views.py", views),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    authz(dir.path())
}

const WRAPPED_URLS: &str = r#"from django.urls import path

from desk import views

urlpatterns = [
    path("spaces/<str:slug>/notes/", views.notes),
    path("spaces/<str:slug>/mine/", views.mine),
    path("spaces/<str:slug>/beside/", views.beside),
    path("spaces/<str:slug>/group/", views.group),
]
"#;

const GUARDS_HEAD: &str = r#"from functools import wraps

from django.http import JsonResponse

from desk.models import Seat
"#;

const WRAPPED_VIEWS: &str = r#"from django.contrib.auth.decorators import login_required
from django.http import JsonResponse

from desk.guards import seated
from desk.models import Note, Seat


@login_required
@seated
def notes(request, slug):
    return JsonResponse({"notes": list(Note.objects.filter(space__slug=slug).values())})


@login_required
def mine(request, slug):
    seats = Seat.objects.filter(holder=request.user)
    return JsonResponse({"seats": list(seats.values())})


@login_required
def beside(request, slug):
    seats = Seat.objects.filter(holder=request.user)
    notes = Note.objects.filter(space__slug=slug)
    return JsonResponse({"seats": list(seats.values()), "notes": list(notes.values())})


@login_required
def group(request, slug):
    seats = Seat.objects.filter(level=request.user.level)
    return JsonResponse({"seats": list(seats.values())})
"#;

const NOTES: &str = "/spaces/<str:slug>/notes";

#[test]
fn a_wrapper_that_calls_the_view_only_after_the_lookup_is_the_check() {
    // The refusal first, then the view.
    let early = wrapped(
        &format!(
            r#"{GUARDS_HEAD}

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not Seat.objects.filter(holder=request.user, space__slug=kwargs["slug"]).exists():
            return JsonResponse({{"error": "no"}}, status=403)
        return view(request, *args, **kwargs)

    return wrapper
"#
        ),
        WRAPPED_VIEWS,
    );
    assert_eq!(early[NOTES], "known membership_guard", "{early:?}");
    // The view under the test, through a local, for each of two kinds of request.
    let under = wrapped(
        &format!(
            r#"{GUARDS_HEAD}

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.method == "GET":
            if Seat.objects.filter(holder=request.user, space__slug=kwargs["slug"]).exists():
                return view(request, *args, **kwargs)
        else:
            seat = Seat.objects.filter(
                holder=request.user, space__slug=kwargs["slug"], level__gte=15
            ).first()
            if seat is not None:
                return view(request, *args, **kwargs)
        return JsonResponse({{"error": "no"}}, status=403)

    return wrapper
"#
        ),
        WRAPPED_VIEWS,
    );
    assert_eq!(under[NOTES], "known membership_guard", "{under:?}");
}

#[test]
fn a_wrapper_that_calls_the_view_past_the_lookup_proves_nothing() {
    // Some requests reach the view under no lookup.
    let open_for_reads = wrapped(
        &format!(
            r#"{GUARDS_HEAD}

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.method == "GET":
            return view(request, *args, **kwargs)
        if not Seat.objects.filter(holder=request.user, space__slug=kwargs["slug"]).exists():
            return JsonResponse({{"error": "no"}}, status=403)
        return view(request, *args, **kwargs)

    return wrapper
"#
        ),
        WRAPPED_VIEWS,
    );
    assert_ne!(
        open_for_reads[NOTES], "known membership_guard",
        "{open_for_reads:?}"
    );
    assert!(
        !open_for_reads[NOTES].starts_with("known"),
        "{open_for_reads:?}"
    );
    // The lookup is made and its answer is not what lets the request through.
    let unused = wrapped(
        &format!(
            r#"{GUARDS_HEAD}

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        request.seated = Seat.objects.filter(
            holder=request.user, space__slug=kwargs["slug"]
        ).exists()
        return view(request, *args, **kwargs)

    return wrapper
"#
        ),
        WRAPPED_VIEWS,
    );
    assert!(!unused[NOTES].starts_with("known"), "{unused:?}");
    // The lookup held for the requests that are refused.
    let inverted = wrapped(
        &format!(
            r#"{GUARDS_HEAD}

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if Seat.objects.filter(holder=request.user, space__slug=kwargs["slug"]).exists():
            return JsonResponse({{"error": "no"}}, status=403)
        return view(request, *args, **kwargs)

    return wrapper
"#
        ),
        WRAPPED_VIEWS,
    );
    assert!(!inverted[NOTES].starts_with("known"), "{inverted:?}");
}

const SEATED: &str = r#"

def seated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        return view(request, *args, **kwargs)

    return wrapper
"#;

#[test]
fn rows_found_by_the_caller_itself_are_the_callers_whatever_the_key_is_called() {
    let got = wrapped(&format!("{GUARDS_HEAD}{SEATED}"), WRAPPED_VIEWS);
    // `holder` is on no list of keys: the value is the caller.
    assert_eq!(
        got["/spaces/<str:slug>/mine"], "known owner_filter",
        "{got:?}"
    );
    // Beside rows read by what the request sent alone, it scopes its own query,
    // not what the route reads.
    assert!(
        !got["/spaces/<str:slug>/beside"].starts_with("known"),
        "{got:?}"
    );
    // What is read off the caller is a group or a setting of the caller: no proof
    // under a key that names nothing.
    assert!(
        !got["/spaces/<str:slug>/group"].starts_with("known"),
        "{got:?}"
    );
}

/// The route's authorization is proven, by any mechanism. A route whose guard
/// signs no one in has no authorization unit at all, and is not.
fn known(permissions: &str) -> bool {
    let dir = repo(&format!("{HEAD}{permissions}"));
    authz(dir.path())
        .get(ROUTE)
        .is_some_and(|said| said.starts_with("known"))
}

#[test]
fn a_lookup_of_the_caller_among_rows_a_literal_picks_is_a_role() {
    // The caller holds a place no request chose: a seat of level 15 or more,
    // anywhere.
    assert_eq!(
        said(
            r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(level__gte=15, holder=request.user).exists()
"#
        ),
        "known role_guard"
    );
    // Any seat at all: the caller has one, which says nothing of what they may do.
    assert!(!known(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(holder=request.user).exists()
"#
    ),);
    // Rows a literal picks, and no caller among what is looked up: whether anyone
    // holds such a seat.
    assert!(!known(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return Seat.objects.filter(level__gte=15).exists()
"#
    ),);
    // Some request is let in without the lookup.
    assert!(!known(
        r#"

class Gate(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return Seat.objects.filter(level__gte=15, holder=request.user).exists()
"#
    ),);
}

#[test]
fn the_caller_is_the_caller_whatever_the_request_parameter_is_annotated_with() {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "django\ndjangorestframework\n"),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            "INSTALLED_APPS = [\"rest_framework\", \"desk\"]\nROOT_URLCONF = \"proj.urls\"\n",
        ),
        (
            "proj/urls.py",
            "from django.urls import path\n\nfrom desk import views\n\nurlpatterns = [\n    path(\"plain/<int:pk>/\", views.Plain.as_view()),\n    path(\"annotated/<int:pk>/\", views.Annotated.as_view()),\n    path(\"asked/<int:pk>/\", views.Asked.as_view()),\n]\n",
        ),
        ("desk/__init__.py", ""),
        ("desk/models.py", MODELS),
        (
            "desk/views.py",
            r#"from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from desk.models import Seat


class Plain(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        Seat.objects.get(holder=request.user, pk=pk).delete()
        return Response(status=204)


class Annotated(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        Seat.objects.get(holder=request.user, pk=pk).delete()
        return Response(status=204)


class Asked(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        Seat.objects.get(holder=request.data["holder"], pk=pk).delete()
        return Response(status=204)
"#,
        ),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let got = authz(dir.path());
    assert_eq!(got["/plain/<int:pk>"], "known owner_filter", "{got:?}");
    assert_eq!(got["/annotated/<int:pk>"], "known owner_filter", "{got:?}");
    // What the request sent under the same key, annotated or not.
    assert!(!got["/asked/<int:pk>"].starts_with("known"), "{got:?}");
}
