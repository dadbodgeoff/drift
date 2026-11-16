//! Quart, django-ninja, Litestar and Sanic routes are entry points of the listed
//! reading, with their prefixes, their guards and the hooks before them; what mining
//! reads (the measured reading) has none of them. One small application of each,
//! routed across two files, under `tests/gap_py_adapters_a/`.

use std::path::{Path, PathBuf};

use drift_core::RepoFacts;
use drift_py::{ScanOptions, scan};

fn copy(from: &Path, to: &Path) {
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let target = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
            copy(&e.path(), &target);
        } else {
            std::fs::copy(e.path(), target).unwrap();
        }
    }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/gap_py_adapters_a")
        .join(name)
}

fn scanned(name: &str) -> RepoFacts {
    let dir = tempfile::tempdir().unwrap();
    copy(&fixture(name), dir.path());
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

/// `METHOD route symbol adapter`, and each guard, hook and dependency on it, of every
/// http or websocket entry point of the repository, sorted.
fn entries(repo: &RepoFacts) -> Vec<String> {
    let mut out = Vec::new();
    for f in &repo.files {
        for e in &f.entry_points {
            if e.kind != "http" && e.kind != "websocket" {
                continue;
            }
            let s = f.symbols.iter().find(|s| s.name == e.symbol);
            let wraps: Vec<String> = s
                .map(|s| {
                    s.wraps
                        .iter()
                        .map(|w| format!("{:?}:{}", w.kind, w.wrapper))
                        .chain(s.app_middleware.iter().map(|m| format!("mw:{m}")))
                        .collect()
                })
                .unwrap_or_default();
            out.push(format!(
                "{} {} {} {} {} [{}]",
                e.kind,
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                e.symbol,
                e.adapter,
                wraps.join(", ")
            ));
        }
    }
    out.sort();
    out
}

fn listed(name: &str) -> (Vec<String>, Vec<String>) {
    let repo = scanned(name);
    let measured = entries(&repo);
    let listed = entries(&repo.listed());
    (listed, measured)
}

fn has(list: &[String], want: &str) -> bool {
    list.iter().any(|l| l.starts_with(want))
}

fn line<'a>(list: &'a [String], want: &str) -> &'a str {
    list.iter()
        .find(|l| l.starts_with(want))
        .unwrap_or_else(|| panic!("no `{want}` in {list:#?}"))
}

#[test]
fn quart_is_read_as_flask() {
    let (listed, measured) = listed("quart");
    assert!(!listed.iter().any(|l| l.contains("/?")), "{listed:#?}");
    // The application's own routes, a websocket, and the blueprint under its mount.
    assert!(has(&listed, "http GET /health health flask"), "{listed:#?}");
    assert!(has(&listed, "websocket - /ws ws flask"), "{listed:#?}");
    let show = line(&listed, "http GET /api/items/<int:item_id> show flask");
    assert!(show.contains("app/auth.py#login_required"), "{show}");
    assert!(show.contains("app/items.py#note"), "{show}");
    let create = line(&listed, "http POST /api/items create flask");
    assert!(!create.contains("login_required"), "{create}");
    // What mining reads keeps what it read: the application's routes were not.
    assert!(!has(&measured, "http GET /health"), "{measured:#?}");
    assert!(!has(&measured, "websocket"), "{measured:#?}");
}

#[test]
fn ninja_routes_are_under_the_urlconf_with_the_nearest_auth() {
    let (listed, measured) = listed("ninja");
    let show = line(&listed, "http GET /api/items/{item_id} show ninja");
    assert!(show.contains("api/auth.py#ApiKey"), "{show}");
    // `auth=None` on the operation takes the API's away.
    let create = line(&listed, "http POST /api/items create ninja");
    assert!(!create.contains("ApiKey"), "{create}");
    let health = line(&listed, "http GET /api/health health ninja");
    assert!(!health.contains("ApiKey"), "{health}");
    assert!(
        !listed.iter().any(|l| l.contains("/?")),
        "every mount is read: {listed:#?}"
    );
    assert!(!has(&measured, "http GET /api/items"), "{measured:#?}");
}

#[test]
fn ninja_under_a_urlconf_nothing_reaches_serves_nothing() {
    let dir = tempfile::tempdir().unwrap();
    copy(&fixture("ninja"), dir.path());
    std::fs::write(
        dir.path().join("proj/settings.py"),
        "ROOT_URLCONF = \"proj.other\"\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("proj/other.py"), "urlpatterns = []\n").unwrap();
    let repo = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let listed = entries(&repo.listed());
    assert!(!listed.iter().any(|l| l.contains(" ninja ")), "{listed:#?}");
}

#[test]
fn litestar_handlers_carry_the_guards_of_every_layer() {
    let (listed, measured) = listed("litestar");
    assert!(
        !listed.iter().any(|l| l.contains("/?")),
        "every mount is read: {listed:#?}"
    );
    let health = line(&listed, "http GET /health health litestar");
    assert!(!health.contains("requires_admin"), "{health}");
    let show = line(
        &listed,
        "http GET /items/{item_id:int} ItemController.show litestar",
    );
    assert!(show.contains("app/guards.py#requires_admin"), "{show}");
    let create = line(&listed, "http POST /items ItemController.create litestar");
    assert!(!create.contains("requires_admin"), "{create}");
    // The router's guard, on the handler it names.
    let stats = line(&listed, "http GET /admin/stats stats litestar");
    assert!(stats.contains("app/guards.py#requires_admin"), "{stats}");
    // The decorator registers the handler: it is no wrap of it.
    assert!(!stats.contains("litestar#get"), "{stats}");
    assert!(!has(&measured, "http GET /health"), "{measured:#?}");
}

#[test]
fn a_litestar_layer_with_before_request_is_unknown() {
    let dir = tempfile::tempdir().unwrap();
    copy(&fixture("litestar"), dir.path());
    let main = std::fs::read_to_string(dir.path().join("app/main.py")).unwrap();
    std::fs::write(
        dir.path().join("app/main.py"),
        main.replace("after_request=", "before_request="),
    )
    .unwrap();
    let repo = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let listed = entries(&repo.listed());
    let health = line(&listed, "http GET /health health litestar");
    assert!(health.contains(drift_core::APP_UNREAD), "{health}");
}

#[test]
fn sanic_blueprints_groups_and_hooks() {
    let (listed, measured) = listed("sanic");
    assert!(!listed.iter().any(|l| l.contains("/?")), "{listed:#?}");
    let health = line(&listed, "http GET /health health sanic");
    assert!(health.contains("app/main.py#note"), "{health}");
    assert!(has(&listed, "websocket - /ws feed sanic"), "{listed:#?}");
    let show = line(&listed, "http GET /api/items/<item_id:int> show sanic");
    assert!(show.contains("app/auth.py#authorized"), "{show}");
    assert!(show.contains("app/main.py#note"), "{show}");
    // `add_route` of an `HTTPMethodView`: each handler method.
    let get = line(&listed, "http GET /api/items ItemsView.get sanic");
    assert!(!get.contains("authorized"), "{get}");
    assert!(
        has(&listed, "http POST /api/items ItemsView.post sanic"),
        "{listed:#?}"
    );
    assert!(!has(&measured, "http GET /health"), "{measured:#?}");
}

/// The listed entries of a repository of the files given, beside a `pyproject.toml`.
fn written(files: &[(&str, &str)]) -> Vec<String> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("pyproject.toml"),
        "[project]\nname = \"fx\"\n",
    )
    .unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    let repo = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    entries(&repo.listed())
}

/// Pins: `auth=` given at `add_router` replaces the router's own `auth=`
/// (django-ninja 1.8.0 `Router.build_routers`: the mount's auth is set on the bound
/// router over its own), and an operation's `auth=` replaces both.
#[test]
fn ninja_mount_auth_replaces_the_routers_own() {
    let listed = written(&[
        ("api/__init__.py", ""),
        (
            "api/auth.py",
            "import os\n\nfrom ninja.security import APIKeyHeader\n\n\nclass RouterKey(APIKeyHeader):\n    def authenticate(self, request, key):\n        return key == os.environ.get(\"ROUTER_KEY\")\n\n\nclass MountKey(APIKeyHeader):\n    def authenticate(self, request, key):\n        return key == os.environ.get(\"MOUNT_KEY\")\n",
        ),
        (
            "api/main.py",
            "from ninja import NinjaAPI, Router\n\nfrom api.auth import MountKey, RouterKey\n\napi = NinjaAPI()\nrouter = Router(auth=RouterKey())\n\n\n@router.get(\"/items\")\ndef items(request):\n    return []\n\n\napi.add_router(\"/v1\", router, auth=MountKey())\n",
        ),
        (
            "manage.py",
            "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
        ),
        ("proj/__init__.py", ""),
        ("proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n"),
        (
            "proj/urls.py",
            "from django.urls import path\n\nfrom api.main import api\n\nurlpatterns = [path(\"api/\", api.urls)]\n",
        ),
    ]);
    let items = line(&listed, "http GET /api/v1/items items ninja");
    assert!(items.contains("api/auth.py#MountKey"), "{items}");
    assert!(!items.contains("RouterKey"), "{items}");
}

/// Pins: `Litestar([...])` takes its route handlers first and `Router("/admin",
/// ...)` its path first (Litestar 2.25.0 `Litestar.__init__`, `Router.__init__`);
/// a handler's `middleware=` may turn a caller away, so it reads unknown.
#[test]
fn litestar_positional_handlers_and_path_and_handler_middleware() {
    let listed = written(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            "from litestar import Litestar, Router, get\n\n\ndef check(app):\n    return app\n\n\n@get(\"/health\")\nasync def health() -> dict:\n    return {}\n\n\n@get(\"/stats\")\nasync def stats() -> dict:\n    return {}\n\n\n@get(\"/guarded\", middleware=[check])\nasync def guarded() -> dict:\n    return {}\n\n\nadmin = Router(\"/admin\", route_handlers=[stats])\napp = Litestar([health, admin, guarded])\n",
        ),
    ]);
    assert!(
        !listed.iter().any(|l| l.contains("/?")),
        "every mount is read: {listed:#?}"
    );
    let health = line(&listed, "http GET /health health litestar");
    assert!(!health.contains("middleware"), "{health}");
    assert!(
        has(&listed, "http GET /admin/stats stats litestar"),
        "{listed:#?}"
    );
    let guarded = line(&listed, "http GET /guarded guarded litestar");
    assert!(guarded.contains("middleware="), "{guarded}");
}

/// Pins: Sanic's `add_route(handler, uri)` of a function answers GET where no
/// methods are given (Sanic 25.12.1 `RouteMixin.add_route`: `methods = {"GET"}`),
/// its methods given second are read, and a group mounted with `url_prefix=` is
/// under both prefixes (`Sanic.blueprint` joins the mount's, the group's and the
/// blueprint's).
#[test]
fn sanic_add_route_defaults_to_get_and_group_prefixes_join() {
    let listed = written(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            "from sanic import Blueprint, Sanic\nfrom sanic.response import json\n\napp = Sanic(\"fx\")\nbp = Blueprint(\"items\", url_prefix=\"/items\")\n\n\n@bp.get(\"/\")\nasync def items(request):\n    return json([])\n\n\nasync def ping(request):\n    return json({})\n\n\nasync def save(request):\n    return json({})\n\n\napp.add_route(ping, \"/ping\")\napp.add_route(save, \"/save\", [\"POST\"])\ngroup = Blueprint.group(bp, url_prefix=\"/api\")\napp.blueprint(group, url_prefix=\"/v1\")\n",
        ),
    ]);
    assert!(has(&listed, "http GET /ping ping sanic"), "{listed:#?}");
    assert!(!has(&listed, "http POST /ping"), "{listed:#?}");
    assert!(has(&listed, "http POST /save save sanic"), "{listed:#?}");
    assert!(!has(&listed, "http GET /save"), "{listed:#?}");
    assert!(has(&listed, "http GET /v1/api/items"), "{listed:#?}");
}

/// Pins: Quart runs `before_request` hooks before a request only and
/// `before_websocket` hooks before a websocket (Quart 0.23.1
/// `Quart.preprocess_request`, `preprocess_websocket`); a blueprint's
/// `before_app_websocket` runs before every websocket of the application.
#[test]
fn quart_websockets_run_their_websocket_hooks() {
    let listed = written(&[
        ("app/__init__.py", ""),
        (
            "app/main.py",
            "from quart import Blueprint, Quart, request, websocket\n\napp = Quart(__name__)\nbp = Blueprint(\"live\", __name__)\n\n\n@app.before_request\nasync def note():\n    request.seen = True\n\n\n@app.before_websocket\nasync def ws_guard():\n    websocket.seen = True\n\n\n@bp.before_app_websocket\nasync def everywhere():\n    websocket.seen = True\n\n\n@app.route(\"/page\")\nasync def page():\n    return \"ok\"\n\n\n@app.websocket(\"/ws\")\nasync def ws():\n    return None\n\n\n@bp.websocket(\"/feed\")\nasync def feed():\n    return None\n\n\napp.register_blueprint(bp, url_prefix=\"/live\")\n",
        ),
    ]);
    let page = line(&listed, "http GET /page page flask");
    assert!(page.contains("app/main.py#note"), "{page}");
    assert!(!page.contains("ws_guard"), "{page}");
    let ws = line(&listed, "websocket - /ws ws flask");
    assert!(!ws.contains("#note"), "{ws}");
    assert!(ws.contains("app/main.py#ws_guard"), "{ws}");
    assert!(ws.contains("app/main.py#everywhere"), "{ws}");
    let feed = line(&listed, "websocket - /live/feed feed flask");
    assert!(feed.contains("app/main.py#ws_guard"), "{feed}");
    assert!(feed.contains("app/main.py#everywhere"), "{feed}");
}
