//! What a permission test answers a caller who is not signed in (lowering 57):
//! `drift_core::VERDICT_*` on `has_permission` and `test_func`
//! (`Member::unread`), `drift_core::controls::PASSES_TEST_*` on what
//! `user_passes_test` decorates.

use drift_core::controls::{PASSES_TEST_SIGNED_IN, PASSES_TEST_TRUE, PASSES_TEST_UNREAD};
use drift_core::{VERDICT_SIGNED_IN, VERDICT_SUPER, VERDICT_TRUE};
use drift_py::{ScanOptions, scan};

const SOURCE: &str = r#"
from django.contrib.auth.decorators import user_passes_test
from django.utils.decorators import method_decorator
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated

from elsewhere import imported


class AlwaysTrue(BasePermission):
    def has_permission(self, request, view):
        """Anyone."""
        return True


class SignedIn(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class Plain(BasePermission):
    def has_permission(self, req, view):
        return req.user.is_authenticated


class Called(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated()


class Staff(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_staff


class First(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return view.action in request.user.actions


class OrBoth(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_staff or request.user.is_superuser


class SuperAnd(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.depot_id


class SuperFirst(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.depot_id is not None


class SuperOr(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) or request.method in SAFE_METHODS


class ReadOnlyOrStaff(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or request.user.is_staff


class OtherRequest(BasePermission):
    def has_permission(self, request, view):
        return view.request.user.is_authenticated


class Negated(BasePermission):
    def has_permission(self, request, view):
        return not request.user.is_authenticated


class TwoReturns(BasePermission):
    def has_permission(self, request, view):
        if request.method == "GET":
            return True
        return request.user.is_authenticated


class ObjectOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return True


class View:
    def test_func(self):
        return self.request.user.is_authenticated

    def other(self):
        return True


class ViewOther:
    def test_func(self):
        return self.user.is_authenticated


def member(user):
    return user.is_authenticated and user.groups.exists()


def anyone(user):
    return True


def two(user, request):
    return user.is_authenticated


@user_passes_test(lambda u: u.is_authenticated)
def a(request): ...


@user_passes_test(lambda u: True)
def b(request): ...


@user_passes_test(lambda u: u.email)
def c(request): ...


@user_passes_test(member)
def d(request): ...


@user_passes_test(anyone)
def e(request): ...


@user_passes_test(imported)
def f(request): ...


@user_passes_test(two)
def g(request): ...


@user_passes_test(test_func=lambda u: u.is_superuser, login_url="/in")
def h(request): ...


@user_passes_test(anyone)
@user_passes_test(imported)
def i(request): ...


@method_decorator(user_passes_test(lambda u: u.is_staff), name="dispatch")
class J: ...


def k(request): ...
"#;

#[test]
fn what_a_permission_test_answers_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("perms.py"), SOURCE).unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "perms.py").unwrap();
    let symbol = |n: &str| {
        f.symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
    };
    let verdict = |class: &str, method: &str| -> Vec<&str> {
        symbol(class)
            .members
            .iter()
            .find(|m| m.name == method)
            .unwrap_or_else(|| panic!("{class}.{method}"))
            .unread
            .iter()
            .map(String::as_str)
            .filter(|u| u.starts_with("verdict:"))
            .collect()
    };
    assert_eq!(verdict("AlwaysTrue", "has_permission"), [VERDICT_TRUE]);
    for class in ["SignedIn", "Plain", "Called", "Staff", "First", "OrBoth"] {
        assert_eq!(
            verdict(class, "has_permission"),
            [VERDICT_SIGNED_IN],
            "{class}"
        );
    }
    for class in ["SuperAnd", "SuperFirst"] {
        assert_eq!(verdict(class, "has_permission"), [VERDICT_SUPER], "{class}");
    }
    for class in [
        "SuperOr",
        "ReadOnlyOrStaff",
        "OtherRequest",
        "Negated",
        "TwoReturns",
    ] {
        assert!(verdict(class, "has_permission").is_empty(), "{class}");
    }
    // Of the two tests only: no other method has a verdict.
    assert!(verdict("ObjectOnly", "has_object_permission").is_empty());
    assert_eq!(verdict("View", "test_func"), [VERDICT_SIGNED_IN]);
    assert!(verdict("View", "other").is_empty());
    assert!(verdict("ViewOther", "test_func").is_empty());

    let passes = |n: &str| -> Vec<&str> {
        symbol(n)
            .controls
            .iter()
            .map(String::as_str)
            .filter(|c| c.starts_with("passes_test:"))
            .collect()
    };
    for n in ["a", "d", "h", "J"] {
        assert_eq!(passes(n), [PASSES_TEST_SIGNED_IN], "{n}");
    }
    for n in ["b", "e"] {
        assert_eq!(passes(n), [PASSES_TEST_TRUE], "{n}");
    }
    for n in ["c", "f", "g"] {
        assert_eq!(passes(n), [PASSES_TEST_UNREAD], "{n}");
    }
    assert_eq!(passes("i"), [PASSES_TEST_TRUE, PASSES_TEST_UNREAD]);
    for n in ["k", "member", "anyone"] {
        assert!(passes(n).is_empty(), "{n}");
    }
}
