//! Hono: the things and the positions.

use super::{Framework, Is, Position, Thing, itself, may_cover, thing};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "hono": "4.6.0", "@hono/zod-validator": "0.4.0", "@hono/clerk-auth": "2.0.0", "@acme/hono-sso": "1.0.0", "@hono/zod-openapi": "0.16.0", "zod": "3.23.0" } }
"#;

/// The middleware of the repository.
const AUTH: &str = r#"import type { Context, MiddlewareHandler, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verify } from "hono/jwt";
import { lookup } from "./generated/lookup";

export async function requireUser(c: Context, next: Next) {
  if (!c.req.header("authorization")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
}

export async function requireToken(c: Context, next: Next) {
  try {
    c.set("user", await verify(String(c.req.header("authorization")), process.env.JWT_SECRET!));
  } catch {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
}

export async function throwsUnauthorized(c: Context, next: Next) {
  if (!c.req.header("authorization")) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  await next();
}

export const viaFactory = createMiddleware(async (c, next) => {
  if (!c.req.header("authorization")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
});

export function requireRole(role: string) {
  return async (c: Context, next: Next) => {
    if (!c.get("user")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (c.get("user").role !== role) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}

export async function logOnly(c: Context, next: Next) {
  console.log(c.req.method, c.req.path);
  await next();
}

export async function attachUser(c: Context, next: Next) {
  c.set("user", c.req.header("x-user") ?? null);
  await next();
}

export async function someOnly(c: Context, next: Next) {
  if (c.req.path.startsWith("/admin") && !c.req.header("authorization")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
}

export async function writesOnly(c: Context, next: Next) {
  if (c.req.method === "GET") {
    return next();
  }
  if (!c.req.header("authorization")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
}

export async function unreadBody(c: Context, next: Next) {
  await lookup(c);
  await next();
}

const table: Record<string, any> = {};
export function makeGuard(kind: string) {
  return table[kind];
}

export function strictOr(strict: boolean): MiddlewareHandler {
  if (strict) {
    return async (c, next) => {
      if (!c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
      await next();
    };
  }
  return async (_c, next) => {
    await next();
  };
}

export function laxOr(strict: boolean): MiddlewareHandler {
  if (!strict) {
    return async (_c, next) => {
      await next();
    };
  }
  return async (c, next) => {
    if (!c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
    await next();
  };
}
"#;

const HEAD: &str = r#"import { Hono, type MiddlewareHandler } from "hono";
import { jwt } from "hono/jwt";
import { bearerAuth } from "hono/bearer-auth";
import { basicAuth } from "hono/basic-auth";
import { every, some, except } from "hono/combine";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { clerkMiddleware } from "@hono/clerk-auth";
import { sso } from "@acme/hono-sso";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { fromElsewhere } from "./generated/guards";
import {
  requireUser, requireToken, throwsUnauthorized, viaFactory, requireRole, logOnly, attachUser,
  someOnly, writesOnly, unreadBody, makeGuard, strictOr, laxOr,
} from "./auth";

declare const flag: boolean;
declare const kind: string;
declare const injected: MiddlewareHandler;
declare const registry: Record<string, MiddlewareHandler>;
const secret = process.env.JWT_SECRET!;
const token = process.env.API_TOKEN!;
const schema = z.object({ name: z.string() });
const h = (c: any) => c.json([]);
const app = new Hono();
"#;

const TAIL: &str = "export default app;\n";

const THINGS: &[Thing] = &[
    // a.
    thing('a', "if-401", "requireUser", Is::Guard),
    thing('a', "catch-401", "requireToken", Is::Guard),
    thing(
        'a',
        "throws-http-exception",
        "throwsUnauthorized",
        Is::Guard,
    ),
    thing('a', "create-middleware", "viaFactory", Is::Guard),
    thing('a', "factory", "requireRole(\"admin\")", Is::Guard),
    // b.
    thing('b', "logs", "logOnly", Is::Nothing),
    thing('b', "attaches", "attachUser", Is::Nothing),
    // c.
    thing('c', "some-paths", "someOnly", Is::Unknown),
    thing('c', "writes-only", "writesOnly", Is::Unknown),
    thing('c', "unread-call", "unreadBody", Is::Unknown),
    // d.
    thing('d', "jwt", "jwt({ secret })", Is::Guard),
    thing(
        'd',
        "jwt-cookie",
        "jwt({ secret, cookie: \"session\", alg: \"HS256\" })",
        Is::Guard,
    ),
    thing('d', "bearer-auth", "bearerAuth({ token })", Is::Guard),
    thing(
        'd',
        "bearer-auth-verify",
        "bearerAuth({ verifyToken: async (given) => given === token })",
        Is::Guard,
    ),
    thing(
        'd',
        "basic-auth",
        "basicAuth({ username: \"ops\", password: token })",
        Is::Guard,
    ),
    // e.
    thing(
        'e',
        "jwt-unknown-option",
        "jwt({ secret, optional: true })",
        Is::Unknown,
    ),
    thing(
        'e',
        "jwt-spread",
        "jwt({ ...registry.options })",
        Is::Unknown,
    ),
    thing(
        'e',
        "jwt-variable",
        "jwt(registry.options as any)",
        Is::Unknown,
    ),
    thing(
        'e',
        "bearer-auth-unknown-option",
        "bearerAuth({ token, allowAnonymous: true })",
        Is::Unknown,
    ),
    thing(
        'e',
        "bearer-auth-no-options",
        "bearerAuth({} as any)",
        Is::Unknown,
    ),
    // f.
    thing('f', "cors", "cors()", Is::Nothing),
    thing('f', "logger", "logger()", Is::Nothing),
    thing('f', "secure-headers", "secureHeaders()", Is::Nothing),
    thing(
        'f',
        "validator",
        "zValidator(\"json\", schema)",
        Is::Nothing,
    ),
    // g.
    thing('g', "package-call", "sso()", Is::Unknown),
    thing('g', "package-reference", "sso", Is::Unknown),
    thing('g', "clerk-middleware", "clerkMiddleware()", Is::Unknown),
    // h.
    thing(
        'h',
        "conditional",
        "(flag ? requireUser : logOnly)",
        Is::Unknown,
    ),
    thing('h', "computed", "registry[kind]", Is::Unknown),
    thing('h', "member-unread", "registry.user", Is::Unknown),
    thing('h', "declared", "injected", Is::Unknown),
    thing('h', "unresolved-import", "fromElsewhere", Is::Unknown),
    thing(
        'h',
        "factory-not-followed",
        "makeGuard(\"user\")",
        Is::Unknown,
    ),
    // A factory that hands back one of two functions written in its body: which
    // one runs is not read, whichever the call asks for.
    thing(
        'h',
        "factory-of-two-closures",
        "strictOr(false)",
        Is::Unknown,
    ),
    thing(
        'h',
        "factory-of-two-closures-lax-first",
        "laxOr(true)",
        Is::Unknown,
    ),
    // i. `hono/combine`.
    thing(
        'i',
        "every-with-a-guard",
        "every(logOnly, requireUser)",
        Is::Guard,
    ),
    thing(
        'i',
        "every-of-nothing",
        "every(logOnly, attachUser)",
        Is::Nothing,
    ),
    thing(
        'i',
        "every-with-unknown",
        "every(logOnly, injected)",
        Is::Unknown,
    ),
    thing(
        'i',
        "some-of-guards",
        "some(requireUser, bearerAuth({ token }))",
        Is::Guard,
    ),
    thing(
        'i',
        "some-with-nothing",
        "some(requireUser, logOnly)",
        Is::Nothing,
    ),
    thing(
        'i',
        "some-with-unknown",
        "some(requireUser, injected)",
        Is::Unknown,
    ),
    thing(
        'i',
        "some-with-a-predicate",
        "some((c) => c.req.header(\"x-internal\") === \"1\", requireUser)",
        Is::Unknown,
    ),
    thing(
        'i',
        "except",
        "except(\"/public/*\", requireUser)",
        Is::Unknown,
    ),
];

const POSITIONS: &[Position] = &[
    Position {
        name: "handler-position",
        code: "app.get(\"@P@/in\", @G@, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "handler-position-of-several",
        code: "app.get(\"@P@/in\", logOnly, @G@, h);\napp.get(\"@P@/out\", logOnly, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "use-path",
        code: "const app@N@ = new Hono();\napp@N@.use(\"@P@/in/*\", @G@);\napp@N@.get(\"@P@/in/items\", h);\napp@N@.get(\"@P@/out/items\", h);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "use-star",
        code: "const app@N@ = new Hono();\nconst other@N@ = new Hono();\napp@N@.use(\"*\", @G@);\napp@N@.get(\"@P@/in\", h);\nother@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "use",
        code: "const app@N@ = new Hono();\napp@N@.get(\"@P@/before\", h);\napp@N@.use(@G@);\napp@N@.get(\"@P@/after\", h);\n",
        covered: "@P@/after",
        sibling: "@P@/before",
        reads: itself,
    },
    Position {
        name: "sub-app-use",
        code: "const sub@N@ = new Hono();\nsub@N@.use(@G@);\nsub@N@.get(\"/items\", h);\nconst open@N@ = new Hono();\nopen@N@.get(\"/items\", h);\napp.route(\"@P@/in\", sub@N@);\napp.route(\"@P@/out\", open@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "mount-under-a-guarded-path",
        code: "const app@N@ = new Hono();\nconst sub@N@ = new Hono();\nsub@N@.get(\"/items\", h);\nconst open@N@ = new Hono();\nopen@N@.get(\"/items\", h);\napp@N@.use(\"@P@/in/*\", @G@);\napp@N@.route(\"@P@/in\", sub@N@);\napp@N@.route(\"@P@/out\", open@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    // A path with a parameter is not evaluated: what is given for it may run for a
    // route it can take, and never for a router mounted at a path a segment written
    // out sets apart.
    Position {
        name: "use-path-with-a-parameter",
        code: "const app@N@ = new Hono();\nconst open@N@ = new Hono();\nopen@N@.get(\"/items\", h);\napp@N@.use(\"@P@/in/:org/*\", @G@);\napp@N@.get(\"@P@/in/acme/items\", h);\napp@N@.route(\"@P@/out\", open@N@);\n",
        covered: "@P@/in/acme/items",
        sibling: "@P@/out/items",
        reads: may_cover,
    },
    Position {
        name: "openapi-use-path",
        code: "const app@N@ = new OpenAPIHono();\napp@N@.use(\"@P@/in/*\", @G@);\napp@N@.openapi(createRoute({ method: \"get\", path: \"@P@/in/items\" }), h);\napp@N@.openapi(createRoute({ method: \"get\", path: \"@P@/out/items\" }), h);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "base-path",
        code: "const api@N@ = new Hono().basePath(\"@P@\");\napi@N@.use(\"/in/*\", @G@);\napi@N@.get(\"/in/items\", h);\napi@N@.get(\"/out/items\", h);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
];

pub const HONO: Framework = Framework {
    name: "hono",
    imports: "",
    files: &[("package.json", PACKAGE), ("src/auth.ts", AUTH)],
    file: "src/server.ts",
    head: HEAD,
    tail: TAIL,
    things: THINGS,
    positions: POSITIONS,
    method: "GET",
};
