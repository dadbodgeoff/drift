//! `drift security --json` lists the routes of Elysia, hapi, Restify, h3 and Astro
//! endpoints, which it had no row for, with what guards them: a route behind a
//! hook, an authentication or a middleware that answers 401 is guarded, one with
//! nothing before it has no guard, and one behind what is not read is unknown.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

/// `METHOD route` -> `guarded`, `unknown` or `none`, as `drift security` says.
fn routes(root: &Path) -> BTreeMap<String, String> {
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
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let some = |key: &str| e[key].as_array().is_some_and(|a| !a.is_empty());
            let verdict = match (some("guards"), some("opaque")) {
                (true, _) => "guarded",
                (false, true) => "unknown",
                (false, false) => "none",
            };
            (
                format!(
                    "{} {}",
                    e["method"].as_str().unwrap_or_default(),
                    e["route"].as_str().unwrap_or_default()
                ),
                verdict.to_string(),
            )
        })
        .collect()
}

fn expect(got: &BTreeMap<String, String>, want: &[(&str, &str)]) {
    let want: BTreeMap<String, String> = want
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    assert_eq!(*got, want);
}

#[test]
fn elysia_routes_are_listed_with_their_guards() {
    let dir = write(&[
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
            "import { Elysia, t } from \"elysia\";\nimport { requireUser } from \"./auth\";\n\nexport const users = new Elysia({ prefix: \"/users\" })\n  .get(\"/public\", () => \"hello\")\n  .guard({ beforeHandle: requireUser }, (app) =>\n    app.post(\"/\", ({ body }) => body, { body: t.Object({ name: t.String() }) }),\n  );\n",
        ),
        (
            "src/app.ts",
            "import { Elysia } from \"elysia\";\nimport { cors } from \"@elysiajs/cors\";\nimport { users } from \"./users\";\n\nnew Elysia().use(cors()).get(\"/health\", () => \"ok\").use(users).get(\"/after\", () => \"x\").listen(3000);\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[
            ("GET /after", "unknown"),
            ("GET /health", "none"),
            ("GET /users/public", "none"),
            ("POST /users", "guarded"),
        ],
    );
}

#[test]
fn hapi_routes_are_listed_with_their_authentication() {
    let dir = write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@hapi/hapi": "21.3.0", "@hapi/jwt": "3.2.0" } }"#,
        ),
        (
            "src/server.js",
            r#"const Hapi = require("@hapi/hapi");
const Jwt = require("@hapi/jwt");
const users = require("./users");

const init = async () => {
  const server = Hapi.server({ port: 3000 });
  await server.register(Jwt);
  server.auth.strategy("token", "jwt", { keys: process.env.JWT_KEY, verify: false, validate: () => ({ isValid: true }) });
  server.auth.default("token");
  server.route({ method: "GET", path: "/health", options: { auth: false }, handler: () => "ok" });
  server.route({ method: "GET", path: "/items/{id}", handler: (request) => ({ id: request.params.id }) });
  server.route({ method: "GET", path: "/maybe", options: { auth: { mode: "try" } }, handler: () => "x" });
  await server.register({ plugin: users, routes: { prefix: "/users" } });
  await server.start();
};
init();
"#,
        ),
        (
            "src/users.js",
            r#"module.exports = {
  name: "users",
  register: async (server) => {
    server.route({ method: "GET", path: "/{id}", handler: (request) => ({ id: request.params.id }) });
    server.route({ method: "GET", path: "/mine", options: { auth: "token" }, handler: () => [] });
  },
};
"#,
        ),
    ]);
    // A plugin of the repository registered on the server may set a default
    // authentication or an extension on it, which hapi applies to every route of
    // the server, added before or after (hapi 21.4.13 `lib/auth.js`, `lib/ext.js`):
    // what it sets is not read, so a route with no guard of its own is unknown.
    expect(
        &routes(dir.path()),
        &[
            ("GET /health", "unknown"),
            ("GET /items/:id", "guarded"),
            ("GET /maybe", "unknown"),
            ("GET /users/:id", "unknown"),
            ("GET /users/mine", "guarded"),
        ],
    );
}

#[test]
fn restify_h3_and_astro_routes_are_listed() {
    let restify = write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "restify": "11.1.0" } }"#,
        ),
        (
            "src/server.js",
            r#"const restify = require("restify");
const server = restify.createServer();
function requireUser(req, res, next) {
  if (!req.headers.authorization) {
    return next(new Error("Unauthorized"));
  }
  return next();
}
server.use(restify.plugins.queryParser());
server.get("/items/:id", requireUser, (req, res, next) => { res.send({ id: req.params.id }); next(); });
server.listen(8080);
"#,
        ),
    ]);
    expect(&routes(restify.path()), &[("GET /items/:id", "guarded")]);

    let h3 = write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "h3": "1.13.0" } }"#,
        ),
        (
            "src/app.ts",
            r#"import { createApp, createRouter, createError, defineEventHandler, getHeader } from "h3";
export const app = createApp();
const open = createRouter();
open.get("/health", defineEventHandler(() => "ok"));
app.use(open);
app.use("/admin", defineEventHandler((event) => {
  if (!getHeader(event, "authorization")) {
    throw createError({ statusCode: 401 });
  }
}));
const admin = createRouter();
admin.get("/stats", defineEventHandler(() => ({ n: 1 })));
app.use("/admin", admin.handler);
"#,
        ),
    ]);
    expect(
        &routes(h3.path()),
        &[("GET /admin/stats", "guarded"), ("GET /health", "none")],
    );

    let astro = write(&[
        (
            "package.json",
            r#"{ "name": "site", "dependencies": { "astro": "5.1.0" } }"#,
        ),
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
    expect(&routes(astro.path()), &[("GET /api/users/:id", "guarded")]);
}

/// A Restify `server.param(name, fn)` handler runs before every route whose path
/// has `:name` (restify 12.1.0 `Server.prototype.param`), so it guards them; an
/// Elysia plugin's hook made `.as("scoped")` guards the routes of the instance that
/// uses it.
#[test]
fn restify_param_and_elysia_scoped_hooks_guard_routes() {
    let restify = write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "restify": "12.1.0" } }"#,
        ),
        (
            "src/auth.js",
            r#"function loadOwned(req, res, next, id) {
  if (!req.headers.authorization) {
    return next(new Error("Unauthorized"));
  }
  return next();
}
module.exports = { loadOwned };
"#,
        ),
        (
            "src/server.js",
            r#"const restify = require("restify");
const { loadOwned } = require("./auth");
const server = restify.createServer();
server.param("id", loadOwned);
server.get("/items/:id", (req, res, next) => { res.send({ id: req.params.id }); next(); });
server.get("/raw", (req, res, next) => { res.send({}); next(); });
server.listen(8080);
"#,
        ),
    ]);
    expect(
        &routes(restify.path()),
        &[("GET /items/:id", "guarded"), ("GET /raw", "none")],
    );
    let elysia = write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "elysia": "1.4.32" } }"#,
        ),
        (
            "src/app.ts",
            "import { Elysia } from \"elysia\";\n\nconst auth = new Elysia({ name: \"auth\" })\n  .onBeforeHandle(({ headers, status }: any) => {\n    if (!headers.authorization) {\n      return status(401, \"Unauthorized\");\n    }\n  })\n  .as(\"scoped\");\n\nnew Elysia().use(auth).get(\"/me\", () => \"me\").listen(3000);\n",
        ),
    ]);
    expect(&routes(elysia.path()), &[("GET /me", "guarded")]);
}
