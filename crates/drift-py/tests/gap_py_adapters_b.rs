//! The servers and queues of `lower::servers`: aiohttp, Tornado, Falcon, Django
//! management commands, Channels, Huey and arq. Each is listed for `drift security`
//! (the listed reading, [`drift_core::Listed`]) with its route, kind and what runs
//! before it; mining reads none of it, so the mined facts have none of these entries.

use std::path::Path;

use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// Every entry point of `adapter`, as `path kind METHOD route symbol [wraps]`,
/// sorted: from the listed reading when `listed`, else from what mining reads.
fn entries(r: &Path, adapter: &str, listed: bool) -> Vec<String> {
    let repo = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let repo = if listed {
        repo.listed().into_owned()
    } else {
        repo
    };
    let mut out = Vec::new();
    for f in &repo.files {
        for e in f.entry_points.iter().filter(|e| e.adapter == adapter) {
            // The wraps, then the application middleware (`mw ...`).
            let wraps: Vec<String> = f
                .symbols
                .iter()
                .find(|s| s.name == e.symbol)
                .map(|s| {
                    s.wraps
                        .iter()
                        .map(|w| w.wrapper.clone())
                        .chain(s.app_middleware.iter().map(|m| format!("mw {m}")))
                        .collect()
                })
                .unwrap_or_default();
            out.push(format!(
                "{} {} {} {} {} [{}]",
                f.path,
                e.kind,
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                e.symbol,
                wraps.join(", ")
            ));
        }
    }
    out.sort();
    out.dedup();
    out
}

fn project(r: &Path) {
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
}

/// Pins: aiohttp's `RouteTableDef` decorators in one file and `add_routes`,
/// `router.add_get` / `add_view` and `add_subapp` in another, with the
/// application's `middlewares=` running before every route of that application
/// and its sub-applications, and none before a route of an application without.
#[test]
fn aiohttp_routes_across_files_with_middleware_and_a_subapp() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/views.py",
        "from aiohttp import web\n\nroutes = web.RouteTableDef()\n\n\n@routes.get(\"/items\")\nasync def list_items(request):\n    return web.json_response([])\n\n\n@routes.view(\"/items/{id}\")\nclass ItemView(web.View):\n    async def get(self):\n        return web.json_response({})\n\n    async def delete(self):\n        return web.json_response({})\n",
    );
    write(
        r,
        "app/auth.py",
        "from aiohttp import web\n\n\n@web.middleware\nasync def require_user(request, handler):\n    if request.headers.get(\"Authorization\") is None:\n        raise web.HTTPUnauthorized()\n    return await handler(request)\n",
    );
    write(
        r,
        "app/main.py",
        "from aiohttp import web\n\nfrom app.auth import require_user\nfrom app.views import routes\n\n\nasync def reset(request):\n    return web.Response(text=\"ok\")\n\n\nasync def health(request):\n    return web.Response(text=\"ok\")\n\n\ndef make_app():\n    app = web.Application(middlewares=[require_user])\n    app.add_routes(routes)\n    admin = web.Application()\n    admin.router.add_post(\"/reset\", reset)\n    app.add_subapp(\"/admin\", admin)\n    return app\n\n\ndef make_public():\n    public = web.Application()\n    public.router.add_get(\"/health\", health)\n    return public\n",
    );
    assert_eq!(entries(r, "aiohttp", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "aiohttp", true),
        [
            r#"app/main.py http GET /health health []"#,
            r#"app/main.py http POST /admin/reset reset [mw app/auth.py#require_user]"#,
            r#"app/views.py http DELETE /items/{id} ItemView.delete [pkg:aiohttp#web.View, mw app/auth.py#require_user]"#,
            r#"app/views.py http GET /items list_items [mw app/auth.py#require_user]"#,
            r#"app/views.py http GET /items/{id} ItemView.get [pkg:aiohttp#web.View, mw app/auth.py#require_user]"#,
        ]
    );
}

/// Pins: a Tornado `Application([...])` of tuples and `url()` rules, kept as the
/// regex they are written as; each verb method of a `RequestHandler` its own entry;
/// `prepare` of the handler's base a hook before every verb; and
/// `@tornado.web.authenticated` on one verb only.
#[test]
fn tornado_rules_handlers_prepare_and_authenticated() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/handlers.py",
        "import tornado.web\n\n\nclass BaseHandler(tornado.web.RequestHandler):\n    def prepare(self):\n        self.set_header(\"X-Frame-Options\", \"DENY\")\n\n    def get_current_user(self):\n        return self.get_secure_cookie(\"user\")\n\n\nclass ProfileHandler(BaseHandler):\n    @tornado.web.authenticated\n    def get(self, user_id):\n        self.write({})\n\n    def post(self, user_id):\n        self.write({})\n\n\nclass PingHandler(tornado.web.RequestHandler):\n    def get(self):\n        self.write(\"ok\")\n",
    );
    write(
        r,
        "app/main.py",
        "import os\n\nimport tornado.web\nfrom tornado.web import url\n\nfrom app.handlers import PingHandler, ProfileHandler\n\n\ndef make_app():\n    return tornado.web.Application(\n        [\n            (r\"/ping\", PingHandler),\n            url(r\"/users/([0-9]+)\", ProfileHandler, name=\"profile\"),\n        ],\n        cookie_secret=os.environ[\"COOKIE_SECRET\"],\n    )\n",
    );
    assert_eq!(entries(r, "tornado", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "tornado", true),
        [
            r#"app/handlers.py http GET /ping PingHandler.get [pkg:tornado#web.RequestHandler]"#,
            r#"app/handlers.py http GET /users/([0-9]+) ProfileHandler.get [app/handlers.py#BaseHandler.prepare, app/handlers.py#BaseHandler, pkg:tornado#web.authenticated]"#,
            r#"app/handlers.py http POST /users/([0-9]+) ProfileHandler.post [app/handlers.py#BaseHandler.prepare, app/handlers.py#BaseHandler]"#,
        ]
    );
}

/// Pins: a Falcon `App(middleware=[...])` whose instance's `process_request`
/// runs before every route; `add_route` of one resource twice, once with
/// `suffix=` (its `on_<verb>_<suffix>` responders); `@falcon.before` on one
/// responder only.
#[test]
fn falcon_routes_suffix_middleware_and_before() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/resources.py",
        "import falcon\n\n\ndef require_token(req, resp, resource, params):\n    if req.get_header(\"Authorization\") is None:\n        raise falcon.HTTPUnauthorized()\n\n\nclass ThingsResource:\n    @falcon.before(require_token)\n    def on_post(self, req, resp):\n        resp.media = {}\n\n    def on_get(self, req, resp):\n        resp.media = []\n\n    def on_get_item(self, req, resp, thing_id):\n        resp.media = {}\n",
    );
    write(
        r,
        "app/middleware.py",
        "class Timing:\n    def process_request(self, req, resp):\n        req.context.start = 0\n",
    );
    write(
        r,
        "app/main.py",
        "import falcon\n\nfrom app.middleware import Timing\nfrom app.resources import ThingsResource\n\napp = falcon.App(middleware=[Timing()])\nthings = ThingsResource()\napp.add_route(\"/things\", things)\napp.add_route(\"/things/{thing_id}\", things, suffix=\"item\")\n",
    );
    assert_eq!(entries(r, "falcon", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "falcon", true),
        [
            r#"app/resources.py http GET /things ThingsResource.on_get [app/middleware.py#Timing.process_request]"#,
            r#"app/resources.py http GET /things/{thing_id} ThingsResource.on_get_item [app/middleware.py#Timing.process_request]"#,
            r#"app/resources.py http POST /things ThingsResource.on_post [app/middleware.py#Timing.process_request, app/resources.py#require_token]"#,
        ]
    );
}

/// Pins: each `management/commands/<name>.py` with a `Command` is a `cli` entry
/// named `<name>` at `Command.handle`; a module whose name starts with `_` is not.
#[test]
fn django_management_commands_are_cli_entries() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(r, "app/management/__init__.py", "");
    write(r, "app/management/commands/__init__.py", "");
    write(
        r,
        "app/management/commands/purge.py",
        "from django.core.management.base import BaseCommand\n\n\nclass Command(BaseCommand):\n    help = \"Purge.\"\n\n    def handle(self, *args, **options):\n        return None\n",
    );
    write(
        r,
        "app/management/commands/_shared.py",
        "from django.core.management.base import BaseCommand\n\n\nclass Command(BaseCommand):\n    def handle(self, *args, **options):\n        return None\n",
    );
    assert_eq!(
        entries(r, "django", false)
            .into_iter()
            .filter(|e| e.contains(" cli "))
            .collect::<Vec<_>>(),
        Vec::<String>::new()
    );
    assert_eq!(
        entries(r, "django", true)
            .into_iter()
            .filter(|e| e.contains(" cli "))
            .collect::<Vec<_>>(),
        ["app/management/commands/purge.py cli - purge Command.handle []"]
    );
}

/// Pins: Channels' `ProtocolTypeRouter` -> `AuthMiddlewareStack` -> `URLRouter`
/// of patterns in another file: each consumer a `websocket` entry at its path,
/// with `AuthMiddlewareStack` a fact that it identifies the caller (no guard);
/// a consumer of patterns nothing routes is not listed.
#[test]
fn channels_websocket_routes_through_the_auth_stack() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/consumers.py",
        "from channels.generic.websocket import AsyncWebsocketConsumer\n\n\nclass ChatConsumer(AsyncWebsocketConsumer):\n    async def connect(self):\n        await self.accept()\n\n\nclass EchoConsumer(AsyncWebsocketConsumer):\n    async def connect(self):\n        await self.accept()\n",
    );
    write(
        r,
        "app/routing.py",
        "from django.urls import path, re_path\n\nfrom app import consumers\n\nwebsocket_urlpatterns = [\n    re_path(r\"ws/chat/(?P<room>\\w+)/$\", consumers.ChatConsumer.as_asgi()),\n    path(\"ws/echo/\", consumers.EchoConsumer.as_asgi()),\n]\n",
    );
    write(
        r,
        "app/asgi.py",
        "from channels.auth import AuthMiddlewareStack\nfrom channels.routing import ProtocolTypeRouter, URLRouter\nfrom django.core.asgi import get_asgi_application\n\nfrom app.routing import websocket_urlpatterns\n\napplication = ProtocolTypeRouter(\n    {\n        \"http\": get_asgi_application(),\n        \"websocket\": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),\n    }\n)\n",
    );
    assert_eq!(entries(r, "channels", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "channels", true),
        [
            r#"app/consumers.py websocket - /ws/chat/(?P<room>\w+) ChatConsumer [pkg:channels#auth.AuthMiddlewareStack, pkg:channels#generic.websocket.AsyncWebsocketConsumer]"#,
            r#"app/consumers.py websocket - /ws/echo EchoConsumer [pkg:channels#auth.AuthMiddlewareStack, pkg:channels#generic.websocket.AsyncWebsocketConsumer]"#,
        ]
    );
}

/// Pins: Huey's `@huey.task()` is a `job`, `@huey.periodic_task(...)` a `job`
/// and a `cron`, with the instance imported into a second file.
#[test]
fn huey_tasks_and_periodic_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/tasks.py",
        "from huey import RedisHuey, crontab\n\nhuey = RedisHuey(\"fx\")\n\n\n@huey.task()\ndef send_mail(to):\n    return to\n\n\n@huey.periodic_task(crontab(minute=\"0\", hour=\"3\"))\ndef nightly():\n    return None\n",
    );
    write(
        r,
        "app/more.py",
        "from app.tasks import huey\n\n\n@huey.task(retries=2)\ndef resize(image_id):\n    return image_id\n",
    );
    assert_eq!(entries(r, "huey", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "huey", true),
        [
            r#"app/more.py job - - resize []"#,
            r#"app/tasks.py cron - - nightly []"#,
            r#"app/tasks.py job - - nightly []"#,
            r#"app/tasks.py job - - send_mail []"#,
        ]
    );
}

/// Pins: arq's `WorkerSettings.functions` are `job`s and its `cron_jobs`
/// (`cron(f, ...)`) `cron`s, of functions defined in another file.
#[test]
fn arq_worker_settings_functions_and_cron_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    project(r);
    write(
        r,
        "app/jobs.py",
        "async def download(ctx, url):\n    return url\n\n\nasync def cleanup(ctx):\n    return None\n",
    );
    write(
        r,
        "app/worker.py",
        "from arq import cron\n\nfrom app.jobs import cleanup, download\n\n\nclass WorkerSettings:\n    functions = [download]\n    cron_jobs = [cron(cleanup, hour=3, minute=0)]\n",
    );
    assert_eq!(entries(r, "arq", false), Vec::<String>::new());
    assert_eq!(
        entries(r, "arq", true),
        [
            r#"app/jobs.py cron - cleanup cleanup []"#,
            r#"app/jobs.py job - download download []"#,
        ]
    );
}
