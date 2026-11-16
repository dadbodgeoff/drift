//! What runs before a Koa, SvelteKit or Nitro route is read, so `drift security`
//! can say "guarded" or "no guard found" for them, and says unknown where what
//! runs before cannot be read.
//!
//! - Koa: `app.use(mw)` and `router.use(mw)` run before what is registered after
//!   them, `router.get(path, mw, handler)` before its handler, `app.use(
//!   router.routes())` mounts the router (under `new Router({ prefix })`). A
//!   middleware refuses with `ctx.throw(401)` or `ctx.status = 401` and a
//!   return; one that only hands on (`await next()`) is nothing; one of a
//!   package no list knows is unknown.
//! - SvelteKit: `handle` of `src/hooks.server.ts` (and each hook a `sequence`
//!   chains) runs before every route, for the paths its `startsWith` tests
//!   select; a `+layout.server` `load` that refuses guards the page loads below
//!   it, and never a `+server` endpoint or a form action.
//! - Nitro: every file of `server/middleware/` runs before every route, for the
//!   paths its `startsWith` tests select, and a route's own `onRequest` hooks
//!   before its handler.
//! - A hook whose test of the path is not read leaves the routes it may cover
//!   unknown, never guarded and never "no guard found" (for Nitro, where every
//!   route reads unknown without a guard, the fact test in drift-ts pins it).

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

/// `METHOD route` -> `guarded`, `unknown` or `none`, as `drift security --json`
/// says.
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

const KOA_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"koa\": \"2.15.0\", \"@koa/router\": \"12.0.0\", \"koa-jwt\": \"4.0.4\" } }\n";

/// Koa middleware: one that throws 401, one that sets the status and returns,
/// one that only times the request, one a package no list knows builds.
const KOA_AUTH: &str = r#"import type { Context, Next } from "koa";
import jwt from "koa-jwt";

export async function requireUser(ctx: Context, next: Next) {
  if (!ctx.state.user) {
    ctx.throw(401, "sign in");
  }
  await next();
}

export async function requireSession(ctx: Context, next: Next) {
  if (!ctx.cookies.get("sid")) {
    ctx.status = 401;
    return;
  }
  await next();
}

export async function timing(ctx: Context, next: Next) {
  const started = Date.now();
  await next();
  ctx.set("X-Time", String(Date.now() - started));
}

export const tokenGuard = jwt({ secret: process.env.JWT_SECRET ?? "" });
"#;

const KOA_ROUTES: &str = r#"import Router from "@koa/router";
import { requireSession, requireUser, timing, tokenGuard } from "./auth";

export const open = new Router();
open.get("/health", timing, async (ctx) => {
  ctx.body = "ok";
});
open.get("/session", requireSession, async (ctx) => {
  ctx.body = "ok";
});
open.get("/token", tokenGuard, async (ctx) => {
  ctx.body = "ok";
});

export const api = new Router({ prefix: "/api" });
api.get("/early", async (ctx) => {
  ctx.body = 1;
});
api.use(requireUser);
api.get("/items", async (ctx) => {
  ctx.body = [];
});

export const late = new Router();
late.get("/late", async (ctx) => {
  ctx.body = 1;
});
"#;

const KOA_APP: &str = r#"import Koa from "koa";
import { requireUser } from "./auth";
import { api, late, open } from "./routes";

const app = new Koa();
app.use(open.routes());
app.use(open.allowedMethods());
app.use(api.routes());
app.use(requireUser);
app.use(late.routes());
app.listen(3000);
"#;

/// Each Koa route reads what runs before it: a refusing middleware guards, one
/// that hands on is no guard, a package's unknown guard is unknown; a
/// `router.use` guards only what is registered after it, an `app.use` only the
/// routers mounted after it.
#[test]
fn koa_middleware_is_read_where_it_runs() {
    let dir = write(&[
        ("package.json", KOA_PACKAGE),
        ("src/auth.ts", KOA_AUTH),
        ("src/routes.ts", KOA_ROUTES),
        ("src/app.ts", KOA_APP),
    ]);
    expect(
        &routes(dir.path()),
        &[
            ("GET /api/early", "none"),
            ("GET /api/items", "guarded"),
            ("GET /health", "none"),
            ("GET /late", "guarded"),
            ("GET /session", "guarded"),
            ("GET /token", "unknown"),
        ],
    );
}

const SVELTE_PACKAGE: &str =
    "{ \"name\": \"web\", \"devDependencies\": { \"@sveltejs/kit\": \"2.5.0\" } }\n";

/// Two hooks chained: one that sends to the sign-in page under `/admin`, one
/// that answers 401 for the routes of the `(api)` group.
const SVELTE_HOOKS: &str = r#"import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const admin: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/admin") && !event.locals.user) {
    redirect(303, "/login");
  }
  return resolve(event);
};

const api: Handle = async ({ event, resolve }) => {
  if (event.route.id?.startsWith("/(api)")) {
    if (!event.locals.user) {
      return new Response("sign in", { status: 401 });
    }
  }
  return resolve(event);
};

export const handle = sequence(admin, api);
"#;

const SVELTE_ROUTES: &[(&str, &str)] = &[
    (
        "src/routes/admin/users/+page.server.ts",
        "export async function load() {\n  return { users: [] };\n}\n",
    ),
    (
        "src/routes/about/+page.server.ts",
        "export async function load() {\n  return {};\n}\n",
    ),
    (
        "src/routes/(api)/items/+server.ts",
        "export async function GET() {\n  return new Response(\"[]\");\n}\n",
    ),
    (
        "src/routes/blog/[slug]/+server.ts",
        "export async function GET({ params }: any) {\n  return new Response(params.slug);\n}\n",
    ),
    (
        "src/routes/account/+layout.server.ts",
        "import { redirect } from \"@sveltejs/kit\";\n\nexport async function load({ locals }: any) {\n  if (!locals.user) {\n    redirect(303, \"/login\");\n  }\n  return { user: locals.user };\n}\n",
    ),
    (
        "src/routes/account/settings/+page.server.ts",
        "export async function load() {\n  return { theme: \"dark\" };\n}\n\nexport const actions = {\n  default: async () => {\n    return { saved: true };\n  },\n};\n",
    ),
    (
        "src/routes/account/export/+server.ts",
        "export async function GET() {\n  return new Response(\"csv\");\n}\n",
    ),
];

/// A hook guards the routes its path test selects and no other; a layout's
/// guard covers the page loads below it, not the endpoint or the form action
/// below it, which SvelteKit runs without the layout's load.
#[test]
fn sveltekit_hooks_and_layouts_guard_what_they_run_before() {
    let mut files = vec![
        ("package.json", SVELTE_PACKAGE),
        ("src/hooks.server.ts", SVELTE_HOOKS),
    ];
    files.extend_from_slice(SVELTE_ROUTES);
    let dir = write(&files);
    expect(
        &routes(dir.path()),
        &[
            ("GET /about", "none"),
            ("GET /account", "guarded"),
            ("GET /account/export", "none"),
            ("GET /account/settings", "guarded"),
            ("GET /admin/users", "guarded"),
            ("GET /blog/:slug", "none"),
            ("GET /items", "guarded"),
            // Never the layout's guard; what runs for a form action written in
            // the `actions` object is not read beyond that.
            ("POST /account/settings", "unknown"),
        ],
    );
}

/// A hook that tests the path in a way that is not read (a regular expression)
/// may refuse any route: every route it may cover is unknown, never guarded or
/// "no guard found". A route whose own body refuses stays guarded.
#[test]
fn a_sveltekit_hook_whose_path_test_is_not_read_leaves_its_routes_unknown() {
    let hooks = r#"import { error, type Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  if (/^\/admin/.test(event.url.pathname) && !event.locals.user) {
    error(401, "sign in");
  }
  return resolve(event);
};
"#;
    let dir = write(&[
        ("package.json", SVELTE_PACKAGE),
        ("src/hooks.server.ts", hooks),
        (
            "src/routes/about/+page.server.ts",
            "export async function load() {\n  return {};\n}\n",
        ),
        (
            "src/routes/api/me/+server.ts",
            "import { error } from \"@sveltejs/kit\";\n\nexport async function GET({ locals }: any) {\n  if (!locals.user) {\n    error(401, \"sign in\");\n  }\n  return new Response(locals.user.id);\n}\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[("GET /about", "unknown"), ("GET /api/me", "guarded")],
    );
}

const NUXT_PACKAGE: &str = "{ \"name\": \"web\", \"dependencies\": { \"nuxt\": \"3.13.0\" } }\n";

/// A server middleware that refuses under `/api/private` only, and one that logs.
const NITRO_AUTH: &str = r#"export default defineEventHandler((event) => {
  if (event.path.startsWith("/api/private") && !event.context.user) {
    throw createError({ statusCode: 401, statusMessage: "sign in" });
  }
});
"#;

const NITRO_LOG: &str = r#"export default defineEventHandler((event) => {
  console.log(event.method);
});
"#;

/// Every Nitro server middleware runs before every route, for the paths its
/// test selects; a route's own `onRequest` hook guards it. Before, each of them
/// read unknown.
#[test]
fn nitro_server_middleware_guards_the_routes_it_selects() {
    let dir = write(&[
        ("package.json", NUXT_PACKAGE),
        ("server/middleware/01.auth.ts", NITRO_AUTH),
        ("server/middleware/02.log.ts", NITRO_LOG),
        (
            "server/api/private/data.get.ts",
            "export default defineEventHandler(async () => {\n  return { secret: 1 };\n});\n",
        ),
        (
            "server/api/public.get.ts",
            "export default defineEventHandler(async () => {\n  return { ok: 1 };\n});\n",
        ),
        (
            "server/api/hooked.get.ts",
            "export default defineEventHandler({\n  onRequest: [\n    (event) => {\n      if (!event.context.user) {\n        throw createError({ statusCode: 403 });\n      }\n    },\n  ],\n  handler: async () => ({ ok: 1 }),\n});\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[
            ("GET /api/hooked", "guarded"),
            ("GET /api/private/data", "guarded"),
            // What `defineEventHandler` (a global Nuxt imports) does with the
            // handler is not read: unknown, as before.
            ("GET /api/public", "unknown"),
        ],
    );
}
