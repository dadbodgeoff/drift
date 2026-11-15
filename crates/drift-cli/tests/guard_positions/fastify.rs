//! Fastify: the things and the positions.

use super::{Framework, Is, Position, Thing, itself, thing};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "fastify": "5.0.0", "fastify-plugin": "5.0.0", "@fastify/jwt": "9.0.0", "@fastify/auth": "5.0.0", "@fastify/basic-auth": "6.0.0", "@fastify/bearer-auth": "10.0.0", "@fastify/passport": "3.0.0", "@fastify/rate-limit": "10.0.0", "@fastify/sensible": "6.0.0", "@acme/fastify-sso": "1.0.0", "jsonwebtoken": "9.0.0" } }
"#;

/// The hooks of the repository.
const AUTH: &str = r#"import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { lookup } from "./generated/lookup";

export async function verifyJwt(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export async function verifyJwtReadme(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
}

export async function requireKey(request: FastifyRequest, reply: FastifyReply) {
  if (!request.headers["x-api-key"]) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export const requireToken = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    (request as any).user = jwt.verify(String(request.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    reply.code(401).send({ error: "unauthenticated" });
    return;
  }
};

export function requireRole(role: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    if ((request as any).user.role !== role) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}

export async function logOnly(request: FastifyRequest) {
  request.log.info({ url: request.url }, "request");
}

export async function attachUser(request: FastifyRequest) {
  (request as any).user = request.headers["x-user"] ?? null;
}

export async function someOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.url.startsWith("/admin") && !request.headers.authorization) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export async function writesOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === "GET") {
    return;
  }
  if (!request.headers.authorization) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export async function swallows(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn(err);
  }
}

export async function verifiesBare(request: FastifyRequest) {
  await request.jwtVerify();
}

export async function sendsOtherError(request: FastifyRequest, reply: FastifyReply) {
  try {
    (request as any).user = jwt.verify(String(request.headers.authorization), process.env.JWT_SECRET!);
  } catch (err) {
    reply.send(err);
  }
}

export async function unreadBody(request: FastifyRequest) {
  await lookup(request);
}

const table: Record<string, any> = {};
export function makeGuard(kind: string) {
  return table[kind];
}

export function strictOr(strict: boolean) {
  if (strict) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.headers.authorization) return reply.code(401).send({ error: "unauthenticated" });
    };
  }
  return async (_request: FastifyRequest, _reply: FastifyReply) => {};
}

export function laxOr(strict: boolean) {
  if (!strict) {
    return async (_request: FastifyRequest, _reply: FastifyReply) => {};
  }
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.headers.authorization) return reply.code(401).send({ error: "unauthenticated" });
  };
}
"#;

const HEAD: &str = r#"import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";
import fp from "fastify-plugin";
import fastifyPassport from "@fastify/passport";
import { sso } from "@acme/fastify-sso";
import { fromElsewhere } from "./generated/guards";
import {
  verifyJwt, verifyJwtReadme, requireKey, requireToken, requireRole, logOnly, attachUser,
  someOnly, writesOnly, swallows, verifiesBare, sendsOtherError, unreadBody, makeGuard,
  strictOr, laxOr,
} from "./auth";

declare const flag: boolean;
declare const kind: string;
declare const injected: preHandlerHookHandler;
declare const registry: Record<string, preHandlerHookHandler>;
const h = async () => [];
const app = Fastify();
"#;

const TAIL: &str = "app.listen({ port: 3000 });\n";

const THINGS: &[Thing] = &[
    // a.
    thing('a', "catch-401", "verifyJwt", Is::Guard),
    thing('a', "catch-send-err", "verifyJwtReadme", Is::Guard),
    thing('a', "if-401", "requireKey", Is::Guard),
    thing('a', "arrow-catch", "requireToken", Is::Guard),
    thing('a', "factory", "requireRole(\"admin\")", Is::Guard),
    thing(
        'a',
        "in-place-catch-send-err",
        "async function (request: any, reply: any) { try { await request.jwtVerify(); } catch (err) { reply.send(err); } }",
        Is::Guard,
    ),
    // b.
    thing('b', "logs", "logOnly", Is::Nothing),
    thing('b', "attaches", "attachUser", Is::Nothing),
    // c.
    thing('c', "some-paths", "someOnly", Is::Unknown),
    thing('c', "writes-only", "writesOnly", Is::Unknown),
    // A handler that swallows what the verification throws refuses no one.
    thing('b', "swallows", "swallows", Is::Nothing),
    thing('c', "verifies-outside-a-try", "verifiesBare", Is::Unknown),
    thing(
        'c',
        "catch-send-err-of-another",
        "sendsOtherError",
        Is::Unknown,
    ),
    thing('c', "unread-call", "unreadBody", Is::Unknown),
    // d.
    thing(
        'd',
        "passport",
        "fastifyPassport.authenticate(\"jwt\", { session: false })",
        Is::Guard,
    ),
    thing('d', "basic-auth", "app.basicAuth", Is::Guard),
    thing('d', "bearer-auth", "app.verifyBearerAuth", Is::Guard),
    // e.
    thing(
        'e',
        "passport-anonymous",
        "fastifyPassport.authenticate([\"jwt\", \"anonymous\"], { session: false })",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-callback",
        "fastifyPassport.authenticate(\"jwt\", { session: false }, async () => {})",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-unknown-option",
        "fastifyPassport.authenticate(\"jwt\", { authInfo: false, optional: true })",
        Is::Unknown,
    ),
    // f.
    thing('f', "rate-limit", "app.rateLimit({ max: 5 })", Is::Nothing),
    // g.
    thing('g', "package-call", "sso()", Is::Unknown),
    thing('g', "package-reference", "sso", Is::Unknown),
    thing('g', "decorator-not-read", "app.verifySso", Is::Unknown),
    thing(
        'g',
        "decorator-call-not-read",
        "app.requireScope(\"read\")",
        Is::Unknown,
    ),
    // h.
    thing(
        'h',
        "conditional",
        "(flag ? verifyJwt : logOnly)",
        Is::Unknown,
    ),
    thing('h', "logical", "(flag && verifyJwt)", Is::Unknown),
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
    // i. `@fastify/auth`: one of them passes by default, all of them under
    // `relation: "and"`.
    thing(
        'i',
        "auth-or-guards",
        "app.auth([verifyJwt, requireKey])",
        Is::Guard,
    ),
    thing('i', "auth-single", "app.auth([verifyJwt])", Is::Guard),
    thing(
        'i',
        "auth-or-with-nothing",
        "app.auth([verifyJwt, logOnly])",
        Is::Nothing,
    ),
    thing(
        'i',
        "auth-or-with-unknown",
        "app.auth([verifyJwt, injected])",
        Is::Unknown,
    ),
    thing(
        'i',
        "auth-and-with-nothing",
        "app.auth([logOnly, verifyJwt], { relation: \"and\" })",
        Is::Guard,
    ),
    thing(
        'i',
        "auth-and-nothing",
        "app.auth([logOnly, attachUser], { relation: \"and\" })",
        Is::Nothing,
    ),
    thing(
        'i',
        "auth-and-unknown",
        "app.auth([logOnly, injected], { relation: \"and\" })",
        Is::Unknown,
    ),
    thing(
        'i',
        "auth-relation-variable",
        "app.auth([verifyJwt, logOnly], { relation: kind as \"and\" })",
        Is::Unknown,
    ),
    thing(
        'i',
        "auth-nested",
        "app.auth([[verifyJwt, requireKey], logOnly])",
        Is::Unknown,
    ),
];

/// `app.decorate("guard", G)` then `{ onRequest: [app.guard] }`: the decorated
/// function is read where it is one named there; what a call built, and a value
/// with no name, is not.
fn decorated(t: &Thing) -> Is {
    let named = t
        .expr
        .strip_prefix("app.")
        .unwrap_or(t.expr)
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_');
    if named || t.name.starts_with("in-place") {
        t.is
    } else {
        Is::Unknown
    }
}

/// A function written in an object a binding holds, or in a route declared in
/// full, is not read as a function of its own.
fn through_a_binding(t: &Thing) -> Is {
    if t.name.starts_with("in-place") {
        Is::Unknown
    } else {
        t.is
    }
}

const POSITIONS: &[Position] = &[
    Position {
        name: "onRequest",
        code: "app.get(\"@P@/in\", { onRequest: @G@ }, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "preParsing",
        code: "app.get(\"@P@/in\", { preParsing: @G@ }, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "preValidation",
        code: "app.get(\"@P@/in\", { preValidation: @G@ }, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "preHandler",
        code: "app.get(\"@P@/in\", { preHandler: @G@ }, h);\napp.get(\"@P@/out\", { schema: {} }, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "onRequest-array",
        code: "app.get(\"@P@/in\", { onRequest: [@G@] }, h);\napp.get(\"@P@/out\", { onRequest: [] }, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "preHandler-array-of-several",
        code: "app.get(\"@P@/in\", { preHandler: [logOnly, @G@] }, h);\napp.get(\"@P@/out\", { preHandler: [logOnly] }, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "route-onRequest",
        code: "app.route({ method: \"GET\", url: \"@P@/in\", onRequest: @G@, handler: h });\napp.route({ method: \"GET\", url: \"@P@/out\", handler: h });\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: through_a_binding,
    },
    Position {
        name: "route-preHandler-array",
        code: "app.route({ method: \"GET\", url: \"@P@/in\", preHandler: [@G@], handler: h });\napp.route({ method: \"GET\", url: \"@P@/out\", preHandler: [], handler: h });\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: through_a_binding,
    },
    Position {
        name: "options-variable",
        code: "const o@N@ = { onRequest: @G@ };\napp.get(\"@P@/in\", o@N@, h);\nconst p@N@ = { schema: {} };\napp.get(\"@P@/out\", p@N@, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: through_a_binding,
    },
    Position {
        name: "options-spread",
        code: "const o@N@ = { onRequest: [@G@] };\napp.get(\"@P@/in\", { ...o@N@ }, h);\nconst p@N@ = { schema: {} };\napp.get(\"@P@/out\", { ...p@N@ }, h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: through_a_binding,
    },
    Position {
        name: "addHook",
        code: "const app@N@ = Fastify();\nconst other@N@ = Fastify();\napp@N@.addHook(\"onRequest\", @G@);\napp@N@.get(\"@P@/in\", h);\nother@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    // Fastify gives a route the hooks of its instance when the instance is ready:
    // one added below the route runs for it too.
    Position {
        name: "addHook-after-the-route",
        code: "const app@N@ = Fastify();\nconst other@N@ = Fastify();\napp@N@.get(\"@P@/in\", h);\napp@N@.addHook(\"onRequest\", @G@);\nother@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "addHook-preHandler",
        code: "const app@N@ = Fastify();\nconst other@N@ = Fastify();\napp@N@.addHook(\"preHandler\", @G@);\napp@N@.get(\"@P@/in\", h);\nother@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "plugin-encapsulated",
        code: "const app@N@ = Fastify();\napp@N@.register(async (instance) => {\n  instance.addHook(\"onRequest\", @G@);\n  instance.get(\"/in\", h);\n}, { prefix: \"@P@\" });\napp@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "plugin-named-with-prefix",
        code: "async function routes@N@(instance: FastifyInstance) {\n  instance.addHook(\"preHandler\", @G@);\n  instance.get(\"/in\", h);\n}\nconst app@N@ = Fastify();\napp@N@.register(routes@N@, { prefix: \"@P@\" });\napp@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "fastify-plugin",
        code: "const app@N@ = Fastify();\nconst other@N@ = Fastify();\napp@N@.register(fp(async (instance) => {\n  instance.addHook(\"onRequest\", @G@);\n}));\napp@N@.get(\"@P@/in\", h);\nother@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "decorated",
        code: "const app@N@ = Fastify();\napp@N@.decorate(\"guard@N@\", @G@);\napp@N@.get(\"@P@/in\", { onRequest: [(app@N@ as any).guard@N@] }, h);\napp@N@.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: decorated,
    },
];

pub const FASTIFY: Framework = Framework {
    name: "fastify",
    imports: "",
    files: &[("package.json", PACKAGE), ("src/auth.ts", AUTH)],
    file: "src/server.ts",
    head: HEAD,
    tail: TAIL,
    things: THINGS,
    positions: POSITIONS,
    method: "GET",
};
