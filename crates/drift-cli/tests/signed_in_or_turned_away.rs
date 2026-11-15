//! A sign-in check written the other way round (Django).
//!
//! `if request.user.is_authenticated: <the page>` / `else: return
//! redirect("login")` turns away every request that has no caller, as `if not
//! request.user.is_authenticated: return redirect("login")` does: the refusal is
//! in the `else`, or follows an `if` whose body always leaves. Read where
//! nothing branches between the test and the refusal, from what the test is for
//! a request that has no caller: the framework's `is_authenticated` and
//! `is_anonymous`, a value of the caller read for its truth or compared with
//! `None`, under any `not`, `and`, `or` and `elif`.
//!
//! The same reading says what is no sign-in check, however it answers: a test
//! that turns away the requests that *have* a caller (`if
//! request.user.is_authenticated: return redirect("login")`, the login page
//! itself), and one that reads only the verb of the request. A 403 or a 404 for
//! having no caller is a sign-in check, and no more than that, where the test
//! reads the framework's own word for being signed in.
//!
//! The facts the measured build recorded are linked as they were for what
//! mining reads.

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

/// What the practice map says of a concern for each route, by its path:
/// `known`, `none`, or `unknown <reason>`.
fn said_of(map: &Value, concern: &str) -> BTreeMap<String, String> {
    map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == concern)
        .and_then(|c| c["units"].as_array())
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "unknown" => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

const VIEWS: &str = r#"from django.core.exceptions import PermissionDenied
from django.http import HttpResponse
from django.shortcuts import redirect, render


def in_else(request):
    if request.user.is_authenticated:
        return render(request, "page.html")
    else:
        return redirect("login")


def after(request):
    if request.user.is_authenticated:
        return render(request, "page.html")
    return redirect("login")


def early(request):
    if not request.user.is_authenticated:
        return redirect("login")
    return render(request, "page.html")


def with_elif(request):
    if request.user.is_authenticated and request.method == "POST":
        return render(request, "posted.html")
    elif request.user.is_authenticated:
        return render(request, "page.html")
    else:
        return redirect("login")


def login_page(request):
    if request.user.is_authenticated:
        return redirect("home")
    else:
        return render(request, "login.html")


def backwards(request):
    if request.user.is_anonymous:
        return render(request, "page.html")
    else:
        return redirect("login")


def else_branches(request):
    if request.user.is_authenticated:
        return render(request, "page.html")
    else:
        if request.method == "POST":
            return render(request, "posted.html")
        return redirect("login")


def after_branches(request):
    if request.user.is_authenticated:
        return render(request, "page.html")
    if request.method == "POST":
        return render(request, "posted.html")
    return redirect("login")


def else_abort(request):
    if request.user.is_authenticated:
        return render(request, "page.html")
    else:
        raise PermissionDenied()


def open_page(request):
    return render(request, "page.html")


def nested(request):
    if request.method == "GET":
        if request.user.is_authenticated:
            return render(request, "page.html")
        else:
            return redirect("login")
    return HttpResponse("posted")


def early_backwards(request):
    if request.user.is_authenticated:
        return redirect("login")
    return render(request, "page.html")


def early_abort(request):
    if not request.user.is_authenticated:
        raise PermissionDenied()
    return render(request, "page.html")


def early_anon(request):
    if request.user.is_anonymous:
        return redirect("login")
    return render(request, "page.html")


def else_anon(request):
    if not request.user.is_anonymous:
        return render(request, "page.html")
    else:
        return redirect("login")


def early_method(request):
    if request.method != "POST":
        return redirect("login")
    return render(request, "posted.html")


def nested_early(request):
    if request.method == "GET":
        if not request.user.is_authenticated:
            return redirect("login")
        return render(request, "page.html")
    return HttpResponse("posted")


def staff_else(request):
    if request.user.is_staff:
        return render(request, "page.html")
    else:
        raise PermissionDenied()


def staff_early(request):
    if not request.user.is_staff:
        raise PermissionDenied()
    return render(request, "page.html")


def both_early(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        raise PermissionDenied()
    return render(request, "page.html")


def cart(request):
    if not request.session.get("cart"):
        raise PermissionDenied()
    return render(request, "cart.html")
"#;

const URLS: &str = r#"from django.urls import path

from site import views

urlpatterns = [
    path("else", views.in_else),
    path("after", views.after),
    path("early", views.early),
    path("elif", views.with_elif),
    path("login", views.login_page),
    path("backwards", views.backwards),
    path("else-branches", views.else_branches),
    path("after-branches", views.after_branches),
    path("else-abort", views.else_abort),
    path("open", views.open_page),
    path("nested", views.nested),
    path("early-backwards", views.early_backwards),
    path("early-abort", views.early_abort),
    path("early-anon", views.early_anon),
    path("else-anon", views.else_anon),
    path("early-method", views.early_method),
    path("nested-early", views.nested_early),
    path("staff-else", views.staff_else),
    path("staff-early", views.staff_early),
    path("both-early", views.both_early),
    path("cart", views.cart),
]
"#;

/// The practice map and the facts of the views.
static READ: std::sync::LazyLock<(Value, Value)> = std::sync::LazyLock::new(|| {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        ("requirements.txt", "django\n"),
        ("site/__init__.py", ""),
        ("site/urls.py", URLS),
        ("site/views.py", VIEWS),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    (
        drift(dir.path(), &["practices", "--json", "--units"]),
        drift(dir.path(), &["scan", "--json"]),
    )
});

static AUTHN: std::sync::LazyLock<BTreeMap<String, String>> =
    std::sync::LazyLock::new(|| said_of(&READ.0, "authn"));

static AUTHZ: std::sync::LazyLock<BTreeMap<String, String>> =
    std::sync::LazyLock::new(|| said_of(&READ.0, "authz"));

fn authn(route: &str) -> &'static str {
    AUTHN
        .get(route)
        .unwrap_or_else(|| panic!("no route {route}: {:?}", *AUTHN))
}

/// The facts of a view: as mining reads them, and as they are read since
/// (`listed`), where the two differ.
fn facts(view: &str) -> (Value, Value) {
    let file = READ.1["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "site/views.py")
        .unwrap();
    let of = |symbols: &Value| {
        symbols
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == view)
            .cloned()
            .unwrap()
    };
    (of(&file["symbols"]), of(&file["listed"]["symbols"]))
}

fn has_control(symbol: &Value, control: &str) -> bool {
    symbol["controls"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|c| c == control)
}

fn checks(symbol: &Value) -> Vec<&str> {
    symbol["body_checks"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| c["outcome"].as_str().unwrap())
        .collect()
}

#[test]
fn a_refusal_in_the_else_of_the_test_is_the_sign_in_check() {
    assert_eq!(authn("/else"), "known");
    assert_eq!(authn("/else-anon"), "known");
    // As the same check reads written first.
    assert_eq!(authn("/early"), "known");
    assert_eq!(authn("/early-anon"), "known");
}

#[test]
fn a_refusal_after_an_if_whose_body_always_leaves_is_the_sign_in_check() {
    assert_eq!(authn("/after"), "known");
}

#[test]
fn every_branch_of_the_if_asks_for_the_caller() {
    // `if signed_in and posted: ... elif signed_in: ... else: redirect`.
    assert_eq!(authn("/elif"), "known");
}

#[test]
fn a_branch_between_the_test_and_the_refusal_proves_nothing() {
    // The `else` serves some requests before it refuses.
    assert_eq!(authn("/else-branches"), "none");
    // What follows the `if` serves a POST from anyone, then refuses.
    assert_eq!(authn("/after-branches"), "none");
}

#[test]
fn under_a_branch_only_some_requests_take_the_check_is_not_proven() {
    assert_eq!(authn("/nested"), "unknown unresolved");
    assert_eq!(authn("/nested-early"), authn("/nested"));
}

#[test]
fn a_test_that_turns_away_the_signed_in_is_no_sign_in_check() {
    // The login page: a signed-in caller is sent home.
    assert_eq!(authn("/login"), "none");
    assert_eq!(authn("/early-backwards"), "none");
    // `if request.user.is_anonymous: <the page>` / `else: redirect("login")`.
    assert_eq!(authn("/backwards"), "none");
}

#[test]
fn a_test_of_the_verb_alone_is_no_sign_in_check() {
    assert_eq!(authn("/early-method"), "none");
}

#[test]
fn a_403_for_having_no_caller_is_a_sign_in_check_and_no_more() {
    assert_eq!(authn("/early-abort"), "known");
    assert_eq!(authn("/else-abort"), "known");
    // With a role beside it, the role is still read.
    assert_eq!(authn("/both-early"), "known");
    assert_eq!(AUTHZ["/both-early"], "known");
    // No check on the caller's being signed in is listed as one of what they
    // may do.
    let (_, listed) = facts("early_abort");
    assert_eq!(checks(&listed), ["unauthenticated"]);
    // A value kept in the session may be there for a visitor who never signed
    // in: a 403 for lacking it says nothing of that.
    assert_eq!(authn("/cart"), "none");
}

#[test]
fn a_route_that_only_asks_for_a_caller_has_no_authorization() {
    for route in ["/else", "/after", "/elif", "/early", "/else-anon"] {
        assert_eq!(AUTHZ[route], "none", "{route}");
    }
}

#[test]
fn a_route_with_no_check_is_open() {
    assert_eq!(authn("/open"), "none");
}

#[test]
fn what_mining_reads_is_as_the_measured_build_recorded_it() {
    // The `else` form: no check, and an exit that was not read.
    let (measured, listed) = facts("in_else");
    assert!(checks(&measured).is_empty(), "{measured}");
    assert!(has_control(&measured, "unread_exit"));
    assert_eq!(checks(&listed), ["sign_in_redirect"]);
    assert!(!has_control(&listed, "unread_exit"));
    // The check that turns away the signed-in: recorded then, not read since.
    let (measured, listed) = facts("early_backwards");
    assert_eq!(checks(&measured), ["sign_in_redirect"]);
    assert!(checks(&listed).is_empty(), "{listed}");
    // The 403 for having no caller.
    let (measured, _) = facts("early_abort");
    assert_eq!(checks(&measured), ["forbidden"]);
}
