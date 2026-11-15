//! The Python reading findings of the final review of PR 191, as generated matrices
//! read by the built binary (`DRIFT_TEST_BIN` names another binary, which is how a
//! baseline is shown to fail them), once per generated repository:
//!
//! - a class-based view whose class is the route's unit: a check is the unit's only
//!   where the entry method's own body (or what runs for every request) holds it;
//! - a webhook signature verifier, and a sign-in helper, called by the handler or by
//!   a function it calls: known only where it runs for every request, before any work
//!   (what the handler calls other than reading the request), and where nothing
//!   returns before it; one that does not is unknown, never known and never none;
//! - a symbol a person declared for authentication, reached through a helper;
//! - the entry points a change adds to a class that already served the route.
//!
//! Every cell is read on both surfaces (`drift practices` and `drift security`),
//! which must say the same.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, files: &[(&str, &str)]) {
    for (rel, body) in files {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
}

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

/// What each surface says of one entry point.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Said {
    /// The practice map's authentication: `known`, `unknown` or `none`.
    authn: String,
    /// Its authorization, where it has a unit.
    authz: String,
    /// `drift security`: the guards listed, what may be one and cannot be read,
    /// and whether the row says the signature is verified.
    guards: Vec<String>,
    opaque: Vec<String>,
    verifies: bool,
}

/// By `METHOD route`.
fn read(root: &Path) -> BTreeMap<String, Said> {
    let mut out: BTreeMap<String, Said> = BTreeMap::new();
    let map = drift(root, &["practices", "--json", "--units"]);
    for c in map["concerns"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        if id != "authn" && id != "authz" {
            continue;
        }
        for u in c["units"].as_array().into_iter().flatten() {
            let at = format!(
                "{} {}",
                u["method"].as_str().unwrap_or_default(),
                u["route"].as_str().unwrap_or_default()
            );
            let s = out.entry(at).or_default();
            let a = u["assignment"].as_str().unwrap().to_string();
            if id == "authn" {
                s.authn = a;
            } else {
                s.authz = a;
            }
        }
    }
    let inv = drift(root, &["security", "--json"]);
    for e in inv["entry_points"].as_array().unwrap() {
        let at = format!(
            "{} {}",
            e["method"].as_str().unwrap_or_default(),
            e["route"].as_str().unwrap_or_default()
        );
        let list = |k: &str| -> Vec<String> {
            e[k].as_array()
                .into_iter()
                .flatten()
                .map(|x| x.as_str().unwrap().to_string())
                .collect()
        };
        let s = out.entry(at).or_default();
        s.guards = list("guards");
        s.opaque = list("opaque");
        s.verifies = e["verifies_signature"]
            .as_array()
            .is_some_and(|a| !a.is_empty());
    }
    out
}

/// The two surfaces agree on `s`: authentication known iff a guard (or a verified
/// signature) is listed; unknown iff something that may be one cannot be read; none
/// iff neither.
fn agree(at: &str, s: &Said) {
    match s.authn.as_str() {
        "known" => assert!(
            !s.guards.is_empty() || s.verifies,
            "{at}: the map knows authentication, the row lists no guard: {s:?}"
        ),
        "unknown" => assert!(
            s.guards.is_empty() && !s.verifies,
            "{at}: the map is unknown, the row counts a guard: {s:?}"
        ),
        _ => assert!(
            s.guards.is_empty() && !s.verifies && s.opaque.is_empty(),
            "{at}: the map finds none, the row says more: {s:?}"
        ),
    }
}

const KNOWN: &str = "known";
const UNKNOWN: &str = "unknown";
const NONE: &str = "none";

/// The cells that fail, one line each.
fn settle(failures: Vec<String>) {
    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}

// ---------------------------------------------------------------------------------
// A class-based view: the entry method's own body.

const DJANGO_SETTINGS: &str = "SECRET_KEY = \"x\"\nROOT_URLCONF = \"app.urls\"\nINSTALLED_APPS = [\"django.contrib.auth\", \"app\"]\nMIDDLEWARE = [\"django.contrib.sessions.middleware.SessionMiddleware\", \"django.contrib.auth.middleware.AuthenticationMiddleware\"]\n";

/// `{MIXIN}`: the sign-in the views of an authorization cell stand behind, so that
/// authorization is read for them at all.
const DJANGO_HEAD: &str = "from django.contrib.auth.mixins import LoginRequiredMixin\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import HttpResponse, JsonResponse\nfrom django.views import View\n\n\nclass Base({MIXIN}View):\n    pass\n\n\n";

const ROLE_CHECK: &str =
    "        if not request.user.is_staff:\n            raise PermissionDenied\n";
const SIGN_IN_CHECK: &str =
    "        if not request.user.is_authenticated:\n            return HttpResponse(status=401)\n";
const BODY: &str = "        return JsonResponse({})\n";

/// A class `{name}` on `{base}` with a `get` and a `post`, the check where the cell
/// puts it.
fn view(name: &str, base: &str, check: &str, get: bool, post: bool) -> String {
    format!(
        "class {name}({base}):\n    def get(self, request):\n{}{BODY}\n    def post(self, request):\n{}{BODY}\n\n",
        if get { check } else { "" },
        if post { check } else { "" },
    )
}

/// Which method holds a check, by which kind of view, read for both methods.
#[test]
fn a_check_of_a_class_view_is_the_unit_of_the_method_that_holds_it() {
    // (base of the class: written directly on Django's View, or on a class of the
    // repository that derives from it) × (which methods hold the check).
    let bases = [("Direct", "{MIXIN}View"), ("Derived", "Base")];
    let places = [
        ("in_post", false, true),
        ("in_get", true, false),
        ("in_both", true, true),
        ("nowhere", false, false),
    ];
    let checks = [("authz", ROLE_CHECK), ("authn", SIGN_IN_CHECK)];
    let mut failures = Vec::new();
    for (kind, check) in checks {
        let dir = tempfile::tempdir().unwrap();
        let mixin = if kind == "authz" {
            "LoginRequiredMixin, "
        } else {
            ""
        };
        let mut views = DJANGO_HEAD.replace("{MIXIN}", mixin);
        let mut urls = String::from(
            "from django.urls import path\nfrom app import views\n\nurlpatterns = [\n",
        );
        let mut cells = Vec::new();
        for (b, base) in bases {
            for (p, get, post) in places {
                let name = format!("{b}{}", p.replace('_', ""));
                views.push_str(&view(
                    &name,
                    &base.replace("{MIXIN}", mixin),
                    check,
                    get,
                    post,
                ));
                let route = format!("{}-{p}", b.to_lowercase());
                urls.push_str(&format!(
                    "    path(\"{route}/\", views.{name}.as_view()),\n"
                ));
                cells.push((format!("{b}/{p}"), route, get, post));
            }
        }
        urls.push_str("]\n");
        write(
            dir.path(),
            &[
                ("requirements.txt", "django\n"),
                ("settings.py", DJANGO_SETTINGS),
                ("app/__init__.py", ""),
                ("app/views.py", &views),
                ("app/urls.py", &urls),
            ],
        );
        let said = read(dir.path());
        for (cell, route, get, post) in cells {
            for (method, holds) in [("GET", get), ("POST", post)] {
                let at = format!("{method} /{route}");
                let s = said.get(&at).cloned().unwrap_or_default();
                // The check of the other method is never this method's: the method
                // that holds it is known by it, the other is not known by it.
                let (state, listed) = if kind == "authz" {
                    (
                        s.authz.as_str(),
                        s.guards.iter().any(|g| g.contains("is_staff")),
                    )
                } else {
                    (
                        s.authn.as_str(),
                        s.guards.iter().any(|g| g.contains("is_authenticated")),
                    )
                };
                if holds && state != KNOWN {
                    failures.push(format!(
                        "{kind} {cell} {at}: the method holds the check, read {state}"
                    ));
                }
                if !holds && (state == KNOWN || listed) {
                    failures.push(format!(
                        "{kind} {cell} {at}: another method holds the check, read {state}, guards {:?}",
                        s.guards
                    ));
                }
                if kind == "authn" {
                    agree(&format!("{cell} {at}"), &s);
                }
            }
        }
    }
    settle(failures);
}

// ---------------------------------------------------------------------------------
// A verifier, and a sign-in helper, in a handler or a function it calls.

const FASTAPI_HEAD: &str = r#"import json
import os
import stripe
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
SECRET = os.environ["WH"]
FLAG = os.environ.get("F") == "1"


def fulfil(payload):
    pass


def verify(payload, sig):
    stripe.Webhook.construct_event(payload, sig, SECRET)


def verify_twice_removed(payload, sig):
    verify(payload, sig)


def verify_sometimes(payload, sig):
    if FLAG:
        stripe.Webhook.construct_event(payload, sig, SECRET)


def verify_swallowed(payload, sig):
    try:
        stripe.Webhook.construct_event(payload, sig, SECRET)
    except Exception:
        pass


def current_user(request: Request):
    tok = request.headers.get("authorization")
    if not tok:
        raise HTTPException(status_code=401)
    return tok


"#;

/// One handler: its name, the lines of its body after the request is read, and what
/// the practice map says of its authentication.
type Handler = (&'static str, &'static str, &'static str);

const VERIFIERS: &[Handler] = &[
    // Called by the handler.
    (
        "inline",
        "    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        KNOWN,
    ),
    // Called by a function the handler calls, for every request.
    (
        "helper",
        "    verify(payload, sig)\n    fulfil(payload)\n",
        KNOWN,
    ),
    (
        "helper_twice_removed",
        "    verify_twice_removed(payload, sig)\n    fulfil(payload)\n",
        KNOWN,
    ),
    // The helper verifies for some requests only, or what it raises is swallowed.
    (
        "helper_verifies_sometimes",
        "    verify_sometimes(payload, sig)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "helper_swallows",
        "    verify_swallowed(payload, sig)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    // The handler calls the helper in a `try` that goes on, or under a branch.
    (
        "helper_in_try_pass",
        "    try:\n        verify(payload, sig)\n    except Exception:\n        pass\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "helper_under_branch",
        "    if FLAG:\n        verify(payload, sig)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    // After work the handler did first.
    (
        "inline_after_work",
        "    fulfil(payload)\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n",
        UNKNOWN,
    ),
    (
        "helper_after_work",
        "    fulfil(payload)\n    verify(payload, sig)\n",
        UNKNOWN,
    ),
    (
        "inline_in_finally_after_work",
        "    try:\n        fulfil(payload)\n    finally:\n        stripe.Webhook.construct_event(payload, sig, SECRET)\n",
        UNKNOWN,
    ),
    // After parsing what the request sent: that is not work.
    (
        "inline_after_parse",
        "    data = json.loads(payload)\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(data)\n",
        KNOWN,
    ),
    // After something that returns for some requests.
    (
        "inline_after_if_return",
        "    if FLAG:\n        return {}\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "inline_after_match_return",
        "    match sig:\n        case \"test\":\n            return {}\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "inline_after_while_return",
        "    while not payload:\n        return {}\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "inline_after_for_return",
        "    for part in payload:\n        return part\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    (
        "helper_after_match_return",
        "    match sig:\n        case \"test\":\n            return {}\n    verify(payload, sig)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    // After a case that refuses: what is left is verified.
    (
        "inline_after_match_refusal",
        "    match sig:\n        case \"bad\":\n            raise HTTPException(status_code=400)\n    stripe.Webhook.construct_event(payload, sig, SECRET)\n    fulfil(payload)\n",
        KNOWN,
    ),
];

const SIGN_INS: &[Handler] = &[
    (
        "first",
        "    user = current_user(request)\n    fulfil(payload)\n",
        KNOWN,
    ),
    (
        "after_reading_the_request",
        "    sig = request.headers.get(\"x\")\n    user = current_user(request)\n    fulfil(sig)\n",
        KNOWN,
    ),
    (
        "after_work",
        "    fulfil(payload)\n    user = current_user(request)\n",
        UNKNOWN,
    ),
    (
        "after_match_return",
        "    match request.headers.get(\"kind\"):\n        case \"test\":\n            fulfil(payload)\n            return {}\n    user = current_user(request)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
    // The check is in the handler's own body.
    (
        "check_first",
        "    tok = request.headers.get(\"authorization\")\n    if not tok:\n        raise HTTPException(status_code=401)\n    fulfil(payload)\n",
        KNOWN,
    ),
    (
        "check_after_work",
        "    fulfil(payload)\n    tok = request.headers.get(\"authorization\")\n    if not tok:\n        raise HTTPException(status_code=401)\n",
        UNKNOWN,
    ),
    (
        "after_while_return",
        "    while not payload:\n        return {}\n    user = current_user(request)\n    fulfil(payload)\n",
        UNKNOWN,
    ),
];

fn fastapi_repo(handlers: &[Handler]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let mut main = FASTAPI_HEAD.to_string();
    for (name, body, _) in handlers {
        main.push_str(&format!(
            "@app.post(\"/{name}\")\nasync def {name}(request: Request):\n    payload = await request.body()\n    sig = request.headers.get(\"stripe-signature\")\n{body}    return {{\"ok\": True}}\n\n\n"
        ));
    }
    write(
        dir.path(),
        &[("requirements.txt", "fastapi\nstripe\n"), ("app.py", &main)],
    );
    dir
}

#[test]
fn a_verifier_or_a_sign_in_runs_for_every_request_before_any_work_or_it_is_not_known() {
    let mut failures = Vec::new();
    for handlers in [VERIFIERS, SIGN_INS] {
        let dir = fastapi_repo(handlers);
        let said = read(dir.path());
        for (name, _, want) in handlers {
            let at = format!("POST /{name}");
            let s = said.get(&at).cloned().unwrap_or_default();
            if s.authn != *want {
                failures.push(format!(
                    "{name}: want {want}, the map says {} ({s:?})",
                    s.authn
                ));
            }
            let outcome = std::panic::catch_unwind(|| agree(&at, &s));
            if outcome.is_err() {
                failures.push(format!("{name}: the surfaces disagree ({s:?})"));
            }
            assert_ne!(
                s.authn, NONE,
                "{name}: never none where a verifier or a sign-in is called"
            );
        }
    }
    settle(failures);
}

// ---------------------------------------------------------------------------------
// A declared symbol reached through a helper.

#[test]
fn a_declared_guard_reached_on_every_path_through_a_helper_settles_the_unit() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        &[
            (
                "pyproject.toml",
                "[project]\nname = \"x\"\ndependencies = [\"fastapi\"]\n",
            ),
            ("app/__init__.py", ""),
            (
                "app/auth.py",
                "import os\n\n\ndef require_user(request):\n    token = request.headers.get(\"x-token\")\n    log(token)\n    return token\n\n\ndef log(x):\n    os.environ.get(\"X\")\n",
            ),
            (
                "app/main.py",
                "from fastapi import FastAPI, Request\n\nfrom app.auth import require_user\n\napp = FastAPI()\n\n\n@app.get(\"/direct\")\nasync def direct(request: Request):\n    require_user(request)\n    return []\n\n\nasync def helper(request):\n    return require_user(request)\n\n\n@app.get(\"/via\")\nasync def via(request: Request):\n    await helper(request)\n    return []\n\n\n@app.get(\"/branch\")\nasync def branch(request: Request, debug: bool = False):\n    if not debug:\n        require_user(request)\n    return []\n\n\n@app.get(\"/via_branch\")\nasync def via_branch(request: Request, debug: bool = False):\n    if not debug:\n        await helper(request)\n    return []\n\n\n@app.get(\"/open\")\nasync def open_route(request: Request):\n    return []\n",
            ),
            (
                ".drift/config.yaml",
                "practices:\n  authn:\n    \"app/auth.py#require_user\": \"require_user\"\n\nsetup:\n  I-801a33: {answer: \"guard:app/auth.py#require_user\", seen: \"4172baf0\", by: \"agent\", confirmed_by: \"person\"}\n",
            ),
        ],
    );
    let said = read(dir.path());
    let get = |r: &str| said.get(&format!("GET /{r}")).cloned().unwrap_or_default();
    // On every path, by the handler's own call or through a helper: known, and the
    // inventory lists the declared symbol as the route's guard, on whose word.
    for r in ["direct", "via"] {
        let s = get(r);
        assert_eq!(s.authn, KNOWN, "{r}: {s:?}");
        assert_eq!(
            s.guards,
            ["require_user (declared by a person)"],
            "{r}: {s:?}"
        );
    }
    // Under a branch: not proven, and the row says so as the map does.
    for r in ["branch", "via_branch"] {
        let s = get(r);
        assert_ne!(s.authn, KNOWN, "{r}: {s:?}");
        assert!(s.guards.is_empty(), "{r}: {s:?}");
    }
    // A route that does not run it stays what it was.
    assert_eq!(get("open").authn, NONE);
    assert!(get("open").guards.is_empty());
}

// ---------------------------------------------------------------------------------
// A method added to a class view that already served the route.

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn a_method_added_to_a_class_that_served_the_route_is_an_entry_point_the_change_adds() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let views = |extra: &str| {
        format!(
            "from django.http import JsonResponse\nfrom django.views import View\n\n\nclass Base(View):\n    pass\n\n\nclass Items(Base):\n    def get(self, request):\n        return JsonResponse({{}})\n{extra}\n\nclass Quiet(Base):\n    def get(self, request):\n        return JsonResponse({{}})\n"
        )
    };
    write(
        r,
        &[
            ("requirements.txt", "django\n"),
            ("settings.py", DJANGO_SETTINGS),
            ("app/__init__.py", ""),
            ("app/views.py", &views("")),
            (
                "app/urls.py",
                "from django.urls import path\nfrom app import views\n\nurlpatterns = [\n    path(\"items/\", views.Items.as_view()),\n    path(\"quiet/\", views.Quiet.as_view()),\n]\n",
            ),
        ],
    );
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    let out = Command::new(&*BIN)
        .args(["--no-cache", "init"])
        .current_dir(r)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    git(r, &["checkout", "-qb", "pr"]);
    write(
        r,
        &[(
            "app/views.py",
            &views("\n    def delete(self, request):\n        return JsonResponse({})\n"),
        )],
    );
    git(r, &["add", "app"]);
    git(r, &["commit", "-qm", "pr"]);
    let out = Command::new(&*BIN)
        .args([
            "--no-cache",
            "check",
            "--diff-base",
            "main",
            "--format",
            "json",
        ])
        .current_dir(r)
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(&out.stdout)));
    let added: Vec<String> = report["practices"]["added"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|a| {
            format!(
                "{} {}",
                a["method"].as_str().unwrap_or_default(),
                a["route"].as_str().unwrap_or_default()
            )
        })
        .collect();
    assert_eq!(added, ["DELETE /items"], "{report}");
}
