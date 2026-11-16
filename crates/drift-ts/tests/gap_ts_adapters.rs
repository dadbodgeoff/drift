//! Routes of Elysia, hapi, Restify, h3 and Astro endpoints, which no adapter read
//! before: every route of such an application was missing from the security
//! inventory and the practice map.
//!
//! Each test builds one small application with routes across two files, a prefix or
//! a group, a guarded and an unguarded route and a request schema, and pins: the
//! routes are listed with their full paths (mounts across files joined), what runs
//! before each is on the route (its wraps, the hooks beside it, or unread), a schema
//! makes the route validate, and all of it is in the listed reading only: the facts
//! mining reads hold none of these routes.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan};

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

/// Every http entry point of the listed reading, of the adapter:
/// `METHOD route | what runs before it | validates`, sorted. What runs before it
/// is each wrap (its own and its mount's) and each hook beside it, by its last
/// name, and `?` for something unread.
fn listed(r: &RepoFacts, adapter: &str) -> Vec<String> {
    let l = r.listed();
    let mut out = Vec::new();
    for f in &l.files {
        for e in f.entry_points.iter().filter(|e| e.adapter == adapter) {
            let Some(s) = f.symbols.iter().find(|s| s.name == e.symbol) else {
                continue;
            };
            let mut before: Vec<String> = s
                .wraps
                .iter()
                .chain(f.mount_wraps(e))
                .map(|w| w.wrapper.clone())
                .chain(s.app_middleware.iter().cloned())
                .chain(
                    f.mount(e)
                        .into_iter()
                        .flat_map(|m| m.app_middleware.clone()),
                )
                .map(|w| {
                    if w.contains("unread") || w.starts_with('?') {
                        "?".to_string()
                    } else {
                        w.rsplit(['#', '.']).next().unwrap_or_default().to_string()
                    }
                })
                .collect();
            before.sort();
            before.dedup();
            out.push(format!(
                "{} {} | {} | {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                before.join(" "),
                if s.controls.iter().any(|c| c == "validates") {
                    "validates"
                } else {
                    "-"
                }
            ));
        }
    }
    out.sort();
    out
}

/// The facts mining reads list no route of the adapter.
fn unmeasured(r: &RepoFacts, adapter: &str) {
    for f in &r.files {
        assert!(
            f.entry_points.iter().all(|e| e.adapter != adapter),
            "{adapter} routes in the measured facts of {}",
            f.path
        );
    }
}

/// Elysia: a prefix in the constructor, a `.guard` with a `beforeHandle`, a route
/// schema, a `.group` with an `onBeforeHandle`, and an instance of another file
/// used by the application.
#[test]
fn elysia_routes_with_guards_groups_and_mounts() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "elysia": "1.2.0", "@elysiajs/cors": "1.2.0" } }"#,
        ),
        (
            "src/auth.ts",
            "export const requireUser = ({ headers, error }: any) => {\n  if (!headers.authorization) {\n    return error(401, \"Unauthorized\");\n  }\n};\n",
        ),
        (
            "src/users.ts",
            "import { Elysia, t } from \"elysia\";\nimport { requireUser } from \"./auth\";\n\nexport const users = new Elysia({ prefix: \"/users\" })\n  .get(\"/public\", () => \"hello\")\n  .guard({ beforeHandle: requireUser }, (app) =>\n    app\n      .get(\"/:id\", ({ params }) => ({ id: params.id }))\n      .post(\"/\", ({ body }) => body, { body: t.Object({ name: t.String() }) }),\n  );\n",
        ),
        (
            "src/app.ts",
            "import { Elysia } from \"elysia\";\nimport { cors } from \"@elysiajs/cors\";\nimport { users } from \"./users\";\nimport { requireUser } from \"./auth\";\n\nconst app = new Elysia()\n  .use(cors())\n  .get(\"/health\", () => \"ok\")\n  .group(\"/admin\", (g) => g.onBeforeHandle(requireUser).get(\"/stats\", () => ({ n: 1 })))\n  .use(users)\n  .get(\"/after\", () => \"x\", { isSignedIn: true })\n  .listen(3000);\n",
        ),
    ]);
    unmeasured(&r, "elysia");
    assert_eq!(
        listed(&r, "elysia"),
        [
            "GET /admin/stats | requireUser | -",
            "GET /after | ? | -",
            "GET /health |  | -",
            "GET /users/:id | requireUser | -",
            "GET /users/public |  | -",
            "POST /users | requireUser | validates",
        ]
    );
}

/// hapi: the server's default authentication guards a route added after it that
/// sets none (not one added before it), `auth: false` is no guard, a route array
/// with a method array and a `validate` schema, and a plugin of another file
/// registered under a prefix, whose routes are served under it with the default
/// unread.
#[test]
fn hapi_routes_with_auth_validation_and_plugins() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@hapi/hapi": "21.3.0", "@hapi/jwt": "3.2.0", "joi": "17.13.0" } }"#,
        ),
        ("src/server.js", HAPI_SERVER),
        ("src/users.js", HAPI_USERS),
    ]);
    unmeasured(&r, "hapi");
    assert_eq!(
        listed(&r, "hapi"),
        [
            "GET /before |  | -",
            "GET /health |  | -",
            "GET /items/:id | required | -",
            "GET /users/:id | ? | -",
            "GET /users/open |  | -",
            "POST /items | required | validates",
            "PUT /items | required | validates",
        ]
    );
}

const HAPI_SERVER: &str = r#"const Hapi = require("@hapi/hapi");
const Jwt = require("@hapi/jwt");
const Joi = require("joi");
const users = require("./users");

const init = async () => {
  const server = Hapi.server({ port: 3000 });
  await server.register(Jwt);
  server.auth.strategy("token", "jwt", { keys: process.env.JWT_KEY, verify: false, validate: () => ({ isValid: true }) });
  server.route({ method: "GET", path: "/before", handler: () => "x" });
  server.auth.default("token");
  server.route({ method: "GET", path: "/health", options: { auth: false }, handler: () => "ok" });
  server.route([
    { method: "GET", path: "/items/{id}", handler: (request) => ({ id: request.params.id }) },
    {
      method: ["POST", "PUT"],
      path: "/items",
      options: { validate: { payload: Joi.object({ name: Joi.string() }) } },
      handler: (request) => request.payload,
    },
  ]);
  await server.register({ plugin: users, routes: { prefix: "/users" } });
  await server.start();
};
init();
"#;

const HAPI_USERS: &str = r#"module.exports = {
  name: "users",
  register: async (server) => {
    server.route({ method: "GET", path: "/{id}", handler: (request) => ({ id: request.params.id }) });
    server.route({ method: "GET", path: "/open", options: { auth: false }, handler: () => [] });
  },
};
"#;

/// Restify: what `server.use` adds runs for every route (a plugin Restify ships is
/// nothing), a handler chain before the last handler, a versioned route, `del`.
#[test]
fn restify_routes_with_handler_chains() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "restify": "11.1.0" } }"#,
        ),
        (
            "src/auth.js",
            r#"function requireUser(req, res, next) {
  if (!req.headers.authorization) {
    res.send(401, { error: "unauthorized" });
    return next(false);
  }
  return next();
}
module.exports = { requireUser };
"#,
        ),
        (
            "src/server.js",
            r#"const restify = require("restify");
const { requireUser } = require("./auth");
const server = restify.createServer();
server.use(restify.plugins.bodyParser());
server.get("/health", (req, res, next) => { res.send({ ok: true }); next(); });
server.get({ path: "/items/:id", version: "1.0.0" }, requireUser, (req, res, next) => { res.send({ id: req.params.id }); next(); });
server.del("/items/:id", [requireUser], (req, res, next) => { res.send(204); next(); });
server.listen(8080);
"#,
        ),
    ]);
    unmeasured(&r, "restify");
    assert_eq!(
        listed(&r, "restify"),
        [
            "DELETE /items/:id | requireUser | -",
            "GET /health |  | -",
            "GET /items/:id | requireUser | -",
        ]
    );
}

/// h3: routers mounted under a path within the file and from another file, an
/// event handler `app.use` gives for a path, and a handler's `onRequest` hooks.
#[test]
fn h3_routers_mounts_and_hooks() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "h3": "1.13.0" } }"#,
        ),
        (
            "src/auth.ts",
            r#"import { createError, getHeader, type H3Event } from "h3";
export function requireUser(event: H3Event) {
  if (!getHeader(event, "authorization")) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
}
"#,
        ),
        (
            "src/api.ts",
            r#"import { createRouter, defineEventHandler, readBody } from "h3";
import { requireUser } from "./auth";
export const api = createRouter()
  .get("/items/:id", defineEventHandler({ onRequest: [requireUser], handler: (event) => ({ id: event.context.params?.id }) }))
  .post("/items", defineEventHandler(async (event) => readBody(event)));
"#,
        ),
        (
            "src/app.ts",
            r#"import { createApp, createRouter, defineEventHandler } from "h3";
import { api } from "./api";
import { requireUser } from "./auth";
export const app = createApp();
const open = createRouter();
open.get("/health", defineEventHandler(() => "ok"));
app.use(open);
app.use("/admin", defineEventHandler((event) => requireUser(event)));
const admin = createRouter();
admin.get("/stats", defineEventHandler(() => ({ n: 1 })));
app.use("/admin", admin.handler);
app.use("/api", api.handler);
"#,
        ),
    ]);
    unmeasured(&r, "h3");
    assert_eq!(
        listed(&r, "h3"),
        [
            "GET /admin/stats | app use 8 | -",
            "GET /api/items/:id | requireUser | -",
            "GET /health |  | -",
            "POST /api/items |  | -",
        ]
    );
}

/// Astro: an endpoint's route from its file path, and the package's middleware as
/// what runs before it; in a package with none, the endpoint's own body decides.
#[test]
fn astro_endpoints_with_and_without_middleware() {
    let astro = r#"{ "name": "site", "dependencies": { "astro": "5.1.0" } }"#;
    let r = repo(&[
        ("package.json", astro),
        (
            "src/middleware.ts",
            r#"export async function onRequest(context: any, next: () => Promise<Response>) {
  if (!context.cookies.get("session")) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next();
}
"#,
        ),
        (
            "src/pages/api/users/[id].ts",
            "export async function GET({ params }: any) {\n  return new Response(JSON.stringify({ id: params.id }));\n}\n",
        ),
    ]);
    unmeasured(&r, "astro");
    assert_eq!(listed(&r, "astro"), ["GET /api/users/:id | onRequest | -"]);
    let bare = repo(&[
        ("package.json", astro),
        (
            "src/pages/api/health.ts",
            "export const GET = () => new Response(\"ok\");\n",
        ),
    ]);
    assert_eq!(listed(&bare, "astro"), ["GET /api/health |  | -"]);
}
