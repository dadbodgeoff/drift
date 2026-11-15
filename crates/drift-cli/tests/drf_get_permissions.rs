//! A DRF view whose `get_permissions` chooses its permission classes by the
//! request's method or the view's action.
//!
//! The method was a wall: a view that defines it read "permissions not read" for
//! every handler. Where its body is nothing but tests of `self.request.method` or
//! `self.action`, each answered by a list of classes, the linker picks the case
//! each handler takes, and the handler is guarded by those classes: the ones a
//! base declares, the settings' default, and the `permission_classes` the view
//! itself declares do not run beside what the method returns. A body that does
//! anything else is not read, as before.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `Class.handler` -> its guards, or `?` and what is unread where something is.
fn rows(root: &Path) -> BTreeMap<String, String> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let list = |e: &Value, key: &str| -> Vec<String> {
        e[key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().map(String::from))
            .collect()
    };
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let (guards, opaque) = (list(e, "guards"), list(e, "opaque"));
            let said = match opaque.is_empty() {
                true => guards.join("+"),
                false => format!("? {}", opaque.join("+")),
            };
            (e["symbol"].as_str().unwrap().to_string(), said)
        })
        .collect()
}

const PERMISSIONS: &str = r#"from rest_framework.permissions import BasePermission


class Member(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated


class Admin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.user.is_staff)
"#;

const URLS: &str = r#"from django.urls import path

from desk import views

urlpatterns = [
    path("by-method/", views.ByMethod.as_view()),
    path("declared/", views.Declared.as_view()),
    path("by-action/", views.ByAction.as_view({"get": "list", "post": "create"})),
    path("through-base/", views.ThroughBase.as_view({"get": "list", "post": "create"})),
    path("unread/", views.Unread.as_view()),
]
"#;

const VIEWS: &str = r#"from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet

from desk.permissions import Admin, Member


class Base(APIView):
    permission_classes = [IsAuthenticated]


class ByMethod(Base):
    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [Member()]
        return [Admin()]

    def get(self, request):
        return Response([])

    def post(self, request):
        return Response({})


class Declared(Base):
    permission_classes = [Admin]

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [Admin()]

    def get(self, request):
        return Response([])

    def post(self, request):
        return Response({})


class ByAction(ViewSet):
    def get_permissions(self):
        if self.action in ["create", "destroy"]:
            permission_classes = [Admin]
        else:
            permission_classes = [Member]
        return [permission() for permission in permission_classes]

    def list(self, request):
        return Response([])

    def create(self, request):
        return Response({})


class ThroughBase(ViewSet):
    permission_classes = [Member]

    def get_permissions(self):
        if self.action == "create":
            return [Admin()]
        return super().get_permissions()

    def list(self, request):
        return Response([])

    def create(self, request):
        return Response({})


class Unread(Base):
    def get_permissions(self):
        return [permission() for permission in self.pick()]

    def pick(self):
        return [Member]

    def get(self, request):
        return Response([])
"#;

#[test]
fn each_handler_is_guarded_by_what_get_permissions_returns_for_it() {
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
        ("desk/permissions.py", PERMISSIONS),
        ("desk/views.py", VIEWS),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let got = rows(dir.path());
    // By the request's method: not the base's `IsAuthenticated` beside it.
    assert_eq!(got["ByMethod.get"], "Member", "{got:?}");
    assert_eq!(got["ByMethod.post"], "Admin", "{got:?}");
    // What the view declares does not run where the method returns its own: a
    // read it opens to anyone has no guard.
    assert_eq!(got["Declared.get"], "", "{got:?}");
    assert_eq!(got["Declared.post"], "Admin", "{got:?}");
    // By the view's action, through a name bound in each branch.
    assert_eq!(got["ByAction.list"], "Member", "{got:?}");
    assert_eq!(got["ByAction.create"], "Admin", "{got:?}");
    // `super().get_permissions()` is the view's `permission_classes`.
    assert_eq!(got["ThroughBase.list"], "Member", "{got:?}");
    assert_eq!(got["ThroughBase.create"], "Admin", "{got:?}");
    // Anything else is not read: unknown, never a guess.
    assert!(got["Unread.get"].starts_with("? "), "{got:?}");
}
