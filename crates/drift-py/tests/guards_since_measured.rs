//! Guards read since the measured build (a settings middleware that answers 401 in
//! an `except` handler, DRF permission classes that could not be read) are in the
//! reading `drift security` and the practice map take (`RepoFacts::listed`), and
//! not in the one mining takes: its wraps are what the measured build gave it.

use std::path::Path;

use drift_core::{RepoFacts, Wrap, WrapKind};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn wraps(repo: &RepoFacts, path: &str, symbol: &str) -> Vec<Wrap> {
    let f = repo.files.iter().find(|f| f.path == path).unwrap();
    f.symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("{symbol}"))
        .wraps
        .iter()
        .filter(|w| w.kind != WrapKind::Extends)
        .cloned()
        .collect()
}

fn wrap(wrapper: &str, kind: WrapKind) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind,
    }
}

#[test]
fn guards_read_since_the_measured_build_are_held_out_of_what_mining_reads() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "manage.py",
        "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"depot.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n",
    );
    write(r, "depot/__init__.py", "");
    write(
        r,
        "depot/settings.py",
        r#"SECRET_KEY = "x"
ROOT_URLCONF = "depot.urls"
INSTALLED_APPS = ["rest_framework"]
MIDDLEWARE = ["depot.middleware.TokenMiddleware"]
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}
"#,
    );
    write(
        r,
        "depot/middleware.py",
        r#"from django.core import signing
from django.http import JsonResponse


class TokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            request.account = signing.loads(request.headers.get("X-Token", ""))
        except signing.BadSignature:
            return JsonResponse({"detail": "sign in"}, status=401)
        return self.get_response(request)
"#,
    );
    write(
        r,
        "depot/views.py",
        r#"from django.http import JsonResponse
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

BASE = (permissions.IsAuthenticated,)


def plain(request):
    return JsonResponse({})


class Concat(APIView):
    permission_classes = BASE + (permissions.IsAdminUser,)

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
    path("plain/", views.plain),
    path("concat/", views.Concat.as_view()),
]
"#,
    );
    let mined = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let listed = mined.listed();
    const MIDDLEWARE: &str = "depot/middleware.py#TokenMiddleware";
    const DEFAULT: &str = "pkg:rest_framework#permissions.IsAuthenticated";
    // What `drift security` and the practice map read.
    assert_eq!(
        wraps(&listed, "depot/views.py", "plain"),
        [wrap(MIDDLEWARE, WrapKind::Config)]
    );
    assert_eq!(
        wraps(&listed, "depot/views.py", "Concat.get"),
        [
            wrap(MIDDLEWARE, WrapKind::Config),
            wrap("unresolved:permission_classes = ...", WrapKind::Call),
        ]
    );
    // What mining reads: the measured build's.
    assert!(wraps(&mined, "depot/views.py", "plain").is_empty());
    assert_eq!(
        wraps(&mined, "depot/views.py", "Concat.get"),
        [wrap(DEFAULT, WrapKind::Config)]
    );
}

/// Routes listed since the measured build (an application bound again to a wrapper
/// imported from another module, a Starlette route table) are entry points of the
/// reading `drift security` takes, and of none mining reads. The middleware given
/// on a `Mount` of a table is read in that reading only.
#[test]
fn routes_listed_since_the_measured_build_are_held_out_of_what_mining_reads() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/wrap.py",
        "class TokenMiddleware:\n    def __init__(self, inner):\n        self.inner = inner\n\n    async def __call__(self, scope, receive, send):\n        await self.inner(scope, receive, send)\n",
    );
    write(
        r,
        "app/rebound.py",
        "from fastapi import FastAPI\n\nfrom app.wrap import TokenMiddleware\n\napp = FastAPI()\n\n\n@app.get(\"/orders\")\ndef orders():\n    return []\n\n\napp = TokenMiddleware(app)\n",
    );
    write(
        r,
        "app/table.py",
        "from starlette.applications import Starlette\nfrom starlette.responses import JSONResponse\nfrom starlette.routing import Route\n\n\nasync def invoices(request):\n    return JSONResponse([])\n\n\napp = Starlette(routes=[Route(\"/invoices\", invoices)])\n",
    );
    let mined = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let listed = mined.listed();
    let routes = |repo: &RepoFacts, path: &str| -> Vec<String> {
        let f = repo.files.iter().find(|f| f.path == path).unwrap();
        f.entry_points
            .iter()
            .map(|e| e.route.clone().unwrap_or_default())
            .collect()
    };
    assert_eq!(routes(&listed, "app/rebound.py"), ["/orders"]);
    assert_eq!(routes(&listed, "app/table.py"), ["/invoices"]);
    assert!(routes(&mined, "app/rebound.py").is_empty());
    assert!(routes(&mined, "app/table.py").is_empty());

    // An application mounted in a route table, behind the mount's middleware:
    // mining reads the mount as the measured build did (under a prefix that is not
    // known, behind nothing).
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc.py",
        r#"from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import Mount


class ApiKey(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not request.headers.get("x-api-key"):
            return PlainTextResponse("unauthorized", status_code=401)
        return await call_next(request)


api = FastAPI()


@api.get("/things")
def things():
    return []


app = Starlette(routes=[Mount("/api", app=api, middleware=[Middleware(ApiKey)])])
"#,
    );
    let mined = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let behind = |repo: &RepoFacts| -> Vec<String> {
        let f = repo.files.iter().find(|f| f.path == "svc.py").unwrap();
        let things = f.symbols.iter().find(|s| s.name == "things").unwrap();
        things.app_middleware.clone()
    };
    let listed = mined.listed();
    assert_eq!(routes(&listed, "svc.py"), ["/api/things"]);
    assert_eq!(behind(&listed), ["svc.py#ApiKey"]);
    assert_eq!(routes(&mined, "svc.py"), ["/?/api/things"]);
    assert!(behind(&mined).is_empty());

    // A URLconf included through `decorator_include`.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "manage.py",
        "import os\nimport sys\n\nif __name__ == \"__main__\":\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n    from django.core.management import execute_from_command_line\n\n    execute_from_command_line(sys.argv)\n",
    );
    write(r, "proj/__init__.py", "");
    write(
        r,
        "proj/settings.py",
        "SECRET_KEY = \"x\"\nROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"members\"]\nMIDDLEWARE = []\n",
    );
    write(
        r,
        "proj/urls.py",
        "from decorator_include import decorator_include\nfrom django.contrib.auth.decorators import login_required\nfrom django.urls import path\n\nurlpatterns = [path(\"members/\", decorator_include(login_required, \"members.urls\"))]\n",
    );
    write(r, "members/__init__.py", "");
    write(
        r,
        "members/urls.py",
        "from django.urls import path\n\nfrom members import views\n\nurlpatterns = [path(\"orders/\", views.orders)]\n",
    );
    write(
        r,
        "members/views.py",
        "from django.http import JsonResponse\n\n\ndef orders(request):\n    return JsonResponse({})\n",
    );
    let mined = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    assert_eq!(
        routes(&mined.listed(), "members/views.py"),
        ["/members/orders"]
    );
    assert!(routes(&mined, "members/views.py").is_empty());
}
