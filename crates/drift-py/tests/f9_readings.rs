//! F9: fixes of review R9 to the Python readings S15c added, which only the listed
//! reading takes (`RepoFacts::listed`). Each test pins one, beside a case that must
//! stay as it was read.
//!
//! - An error class whose `__init__` hands its base a value that is not a literal
//!   (`super().__init__(code)`) says no status of its own: it is not read as its
//!   base's 401.
//! - A view whose own body answers its errors is known by that way even where a
//!   base of its class is not read; only a view nothing else is read for is
//!   unknown by the base.

use std::path::Path;

use drift_core::{RepoFacts, Symbol, controls};
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

/// The ways the errors concern reads for the units of `symbol` (by prefix):
/// each unit's own key, or its variant's, or `unknown:<reason>`.
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

/// Pins: `class Denied(AppError): def __init__(self, code): super().__init__(code)`
/// with `AppError.status_code = 401` read as 401, so `raise Denied(404)` refused
/// the caller. The positional value is not read: no status. A message literal
/// beside nothing else (`super().__init__("no")`) still leaves the base's 401.
#[test]
fn a_status_handed_to_the_base_by_a_parameter_is_not_the_bases() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "errs.py",
        r#"class AppError(Exception):
    status_code = 401


class Denied(AppError):
    def __init__(self, code):
        super().__init__(code)


class Fixed(AppError):
    def __init__(self):
        super().__init__("no")
"#,
    );
    let mined = scanned(r);
    let listed = mined.listed();
    let status = |name: &str| {
        symbol(&listed, "errs.py", name)
            .controls
            .iter()
            .filter(|c| c.starts_with(controls::REFUSAL_STATUS))
            .cloned()
            .collect::<Vec<_>>()
    };
    assert!(status("Denied").is_empty(), "{:?}", status("Denied"));
    assert_eq!(status("Fixed"), vec![format!("{}401", controls::REFUSAL_STATUS)]);
}

/// Pins: S15c made a view unknown wherever a base of its class is not read
/// (`ItemView(Mixin, APIView)` with `Mixin` from a module that is not there), even
/// where its own `try` answers its errors, which was known before S15c. That way
/// stays known; a view with no handling of its own is unknown by the base, never
/// "framework default".
#[test]
fn a_view_that_answers_its_own_errors_stays_known_by_an_unread_base() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_project(r, "\"rest_framework\"");
    write(
        r,
        "depot/views.py",
        r#"from rest_framework.response import Response
from rest_framework.views import APIView

from depot.missing import Mixin


def load():
    return {}


class ItemView(Mixin, APIView):
    def get(self, request):
        try:
            return Response(load())
        except Exception:
            return Response({"error": "failed"}, status=500)


class PlainView(Mixin, APIView):
    def get(self, request):
        return Response(load())
"#,
    );
    write(
        r,
        "depot/urls.py",
        r#"from django.urls import path

from depot import views

urlpatterns = [
    path("items/", views.ItemView.as_view()),
    path("plain/", views.PlainView.as_view()),
]
"#,
    );
    let mined = scanned(r);
    let item = error_ways(&mined, "ItemView");
    assert!(!item.is_empty(), "no ItemView unit");
    assert!(item.iter().all(|k| k.contains("in_body_try")), "{item:?}");
    let plain = error_ways(&mined, "PlainView");
    assert!(!plain.is_empty(), "no PlainView unit");
    assert!(plain.iter().all(|k| k.starts_with("unknown")), "{plain:?}");
}
