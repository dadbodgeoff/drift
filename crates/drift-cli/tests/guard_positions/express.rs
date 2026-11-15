//! Express: the things and the positions.

use super::{Framework, Is, Position, Thing, itself, may_cover, thing};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.0", "passport": "0.7.0", "express-jwt": "8.4.1", "express-oauth2-jwt-bearer": "1.6.0", "express-openid-connect": "2.17.0", "express-session": "1.18.0", "express-async-handler": "1.2.0", "express-rate-limit": "7.0.0", "express-validator": "7.0.0", "helmet": "7.0.0", "cors": "2.8.5", "compression": "1.7.4", "morgan": "1.10.0", "cookie-parser": "1.4.6", "jsonwebtoken": "9.0.0", "@acme/sso": "1.0.0", "keycloak-connect": "24.0.0" } }
"#;

/// The guards of the repository.
const AUTH: &str = r#"import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { lookup } from "./generated/lookup";

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

export function requireToken(req: Request, res: Response, next: NextFunction) {
  try {
    (req as any).user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

export const requireSession = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).session?.user) {
    res.sendStatus(401);
    return;
  }
  next();
};

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if ((req as any).user.role !== role) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

export function logOnly(req: Request, _res: Response, next: NextFunction) {
  console.log(req.method, req.path);
  next();
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  (req as any).user = req.headers["x-user"] ?? null;
  next();
}

export function someOnly(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/admin") && !req.headers.authorization) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

export function writesOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET") {
    return next();
  }
  if (!req.headers.authorization) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

export function goesOn(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

// A library's verification, not caught: it throws for a bad token, so the request
// never reaches the handler; with what status is not read.
export function verifiesUncaught(req: Request, _res: Response, next: NextFunction) {
  (req as any).user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  next();
}

// `jwt.decode` verifies nothing.
export function decodesOnly(req: Request, _res: Response, next: NextFunction) {
  (req as any).user = jwt.decode(String(req.headers.authorization));
  next();
}

// Caught and swallowed: optional identity.
export function verifiesAndSwallows(req: Request, _res: Response, next: NextFunction) {
  try {
    (req as any).user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    (req as any).user = null;
  }
  next();
}

// The caught error handed to Express: refused, with a status that is not read.
export function verifiesAndForwards(req: Request, _res: Response, next: NextFunction) {
  try {
    (req as any).user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch (err) {
    return next(err);
  }
  next();
}

export async function unreadBody(req: Request, _res: Response, next: NextFunction) {
  await lookup(req);
  next();
}

const table: Record<string, any> = {};
export function makeGuard(kind: string) {
  return table[kind];
}

export function strictOr(strict: boolean) {
  if (strict) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
      next();
    };
  }
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function laxOr(strict: boolean) {
  if (!strict) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
    next();
  };
}

export function wrap(fn: any) {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}
"#;

const HEAD: &str = r#"import express, { type RequestHandler } from "express";
import passport from "passport";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import session from "express-session";
import rateLimit from "express-rate-limit";
import asyncHandler from "express-async-handler";
import { body } from "express-validator";
import { expressjwt } from "express-jwt";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import { requiresAuth } from "express-openid-connect";
import { sso } from "@acme/sso";
import * as acme from "@acme/sso";
import { fromElsewhere } from "./generated/guards";
import {
  requireUser, requireToken, requireSession, requireRole, logOnly, attachUser,
  someOnly, writesOnly, goesOn, unreadBody, makeGuard, wrap, strictOr, laxOr,
  verifiesUncaught, decodesOnly, verifiesAndForwards, verifiesAndSwallows,
} from "./auth";

declare const flag: boolean;
declare const kind: string;
declare const injected: RequestHandler;
declare const registry: Record<string, RequestHandler>;
declare const strategy: string;
const secret = process.env.JWT_SECRET!;
const h = (_req: express.Request, res: express.Response) => res.json([]);
const app = express();
const chosen = flag ? requireUser : logOnly;
const byKind = { user: requireUser, anyone: logOnly };
const adminOnly = requireRole("admin");
const requireJwt = passport.authenticate("jwt", { session: false });
const optionalJwt = expressjwt({ secret, algorithms: ["HS256"], credentialsRequired: false });
const limiter = rateLimit({ windowMs: 1000, max: 5 });
const stack = [logOnly, requireUser];
const plainStack = [logOnly, express.json()];
"#;

const TAIL: &str = "app.listen(3000);\n";

const THINGS: &[Thing] = &[
    // a. A function of the repository read to refuse every request without identity.
    thing('a', "if-401", "requireUser", Is::Guard),
    thing('a', "catch-401", "requireToken", Is::Guard),
    thing('a', "arrow-sendStatus", "requireSession", Is::Guard),
    thing('a', "factory", "requireRole(\"admin\")", Is::Guard),
    // b. One read to the end that never refuses.
    thing('b', "logs", "logOnly", Is::Nothing),
    thing('b', "attaches", "attachUser", Is::Nothing),
    // c. One that refuses some requests only, or is not read to the end.
    thing('c', "some-paths", "someOnly", Is::Unknown),
    thing('c', "writes-only", "writesOnly", Is::Unknown),
    thing('c', "goes-on", "goesOn", Is::Unknown),
    thing('c', "unread-call", "unreadBody", Is::Unknown),
    thing('c', "verifies-uncaught", "verifiesUncaught", Is::Unknown),
    thing('c', "decodes-only", "decodesOnly", Is::Unknown),
    thing(
        'c',
        "verifies-and-forwards-the-error",
        "verifiesAndForwards",
        Is::Unknown,
    ),
    thing(
        'b',
        "verifies-and-swallows",
        "verifiesAndSwallows",
        Is::Nothing,
    ),
    // d. A library guard in a listed call shape.
    thing(
        'd',
        "passport",
        "passport.authenticate(\"jwt\", { session: false })",
        Is::Guard,
    ),
    thing(
        'd',
        "passport-bare",
        "passport.authenticate(\"bearer\")",
        Is::Guard,
    ),
    thing(
        'd',
        "passport-fail-with-error",
        "passport.authenticate(\"jwt\", { session: false, failWithError: true })",
        Is::Guard,
    ),
    thing(
        'd',
        "express-jwt",
        "expressjwt({ secret, algorithms: [\"HS256\"] })",
        Is::Guard,
    ),
    thing(
        'd',
        "express-jwt-required",
        "expressjwt({ secret, algorithms: [\"HS256\"], credentialsRequired: true })",
        Is::Guard,
    ),
    thing('d', "oauth2-bearer", "auth()", Is::Guard),
    thing(
        'd',
        "oauth2-bearer-options",
        "auth({ audience: \"api\", issuerBaseURL: \"https://issuer.example\" })",
        Is::Guard,
    ),
    thing('d', "openid-connect", "requiresAuth()", Is::Guard),
    // e. The same libraries with an option that weakens them, or one not understood.
    thing(
        'e',
        "passport-anonymous",
        "passport.authenticate([\"jwt\", \"anonymous\"], { session: false })",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-callback",
        "passport.authenticate(\"jwt\", { session: false }, (_err: unknown, _user: unknown) => {})",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-variable-strategy",
        "passport.authenticate(strategy, { session: false })",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-unknown-option",
        "passport.authenticate(\"jwt\", { session: false, optional: true })",
        Is::Unknown,
    ),
    thing(
        'e',
        "express-jwt-optional",
        "expressjwt({ secret, algorithms: [\"HS256\"], credentialsRequired: false })",
        Is::Nothing,
    ),
    thing(
        'e',
        "express-jwt-variable",
        "expressjwt({ secret, algorithms: [\"HS256\"], credentialsRequired: flag })",
        Is::Unknown,
    ),
    thing(
        'e',
        "express-jwt-unless",
        "expressjwt({ secret, algorithms: [\"HS256\"] }).unless({ path: [\"/health\"] })",
        Is::Unknown,
    ),
    thing(
        'e',
        "express-jwt-spread",
        "expressjwt({ ...registry.options })",
        Is::Unknown,
    ),
    thing(
        'e',
        "oauth2-bearer-optional",
        "auth({ authRequired: false })",
        Is::Nothing,
    ),
    thing(
        'e',
        "oauth2-bearer-scopes-alone",
        "requiredScopes(\"read:items\")",
        Is::Unknown,
    ),
    // f. What never authenticates.
    thing('f', "helmet", "helmet()", Is::Nothing),
    thing('f', "cors", "cors({ origin: true })", Is::Nothing),
    thing('f', "json", "express.json()", Is::Nothing),
    thing(
        'f',
        "urlencoded",
        "express.urlencoded({ extended: true })",
        Is::Nothing,
    ),
    thing('f', "static", "express.static(\"public\")", Is::Nothing),
    thing('f', "compression", "compression()", Is::Nothing),
    thing('f', "morgan", "morgan(\"tiny\")", Is::Nothing),
    thing('f', "cookie-parser", "cookieParser()", Is::Nothing),
    thing(
        'f',
        "rate-limit",
        "rateLimit({ windowMs: 1000, max: 5 })",
        Is::Nothing,
    ),
    thing('f', "validator", "body(\"name\").isString()", Is::Nothing),
    thing(
        'f',
        "session",
        "session({ secret, resave: false, saveUninitialized: false })",
        Is::Nothing,
    ),
    // g. A package on neither list.
    thing('g', "package-call", "sso()", Is::Unknown),
    thing('g', "package-reference", "sso", Is::Unknown),
    thing(
        'g',
        "package-member-call",
        "acme.protect({ realm: \"api\" })",
        Is::Unknown,
    ),
    // h. A value of unknown origin.
    thing(
        'h',
        "conditional",
        "(flag ? requireUser : logOnly)",
        Is::Unknown,
    ),
    thing('h', "logical", "(flag && requireUser)", Is::Unknown),
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
    thing('h', "bound", "requireUser.bind(null)", Is::Unknown),
    thing('h', "binding-of-a-conditional", "chosen", Is::Unknown),
    thing('h', "binding-of-an-object", "byKind", Is::Unknown),
    thing(
        'a',
        "in-place",
        "(req: express.Request, res: express.Response, next: express.NextFunction) => { if (!req.headers.authorization) { return res.status(401).end(); } next(); }",
        Is::Guard,
    ),
    thing(
        'b',
        "in-place-nothing",
        "(req: express.Request, _res: express.Response, next: express.NextFunction) => { console.log(req.path); next(); }",
        Is::Nothing,
    ),
    thing('a', "binding-of-a-factory-call", "adminOnly", Is::Guard),
    thing('d', "binding-of-a-library-call", "requireJwt", Is::Guard),
    thing(
        'e',
        "binding-of-an-optional-call",
        "optionalJwt",
        Is::Nothing,
    ),
    thing('f', "binding-of-a-limiter", "limiter", Is::Nothing),
    thing('i', "binding-of-a-list", "stack", Is::Guard),
    thing(
        'i',
        "binding-of-a-list-of-nothing",
        "plainStack",
        Is::Nothing,
    ),
    // i. A composition.
    thing(
        'i',
        "async-handler-guard",
        "asyncHandler(requireUser)",
        Is::Guard,
    ),
    thing(
        'i',
        "async-handler-nothing",
        "asyncHandler(logOnly)",
        Is::Nothing,
    ),
    thing(
        'i',
        "async-handler-unknown",
        "asyncHandler(sso())",
        Is::Unknown,
    ),
    thing('i', "in-repo-combinator", "wrap(requireUser)", Is::Unknown),
];

/// `const before = [G]; app.get(path, ...before, h)`: the binding is read where
/// what it holds is the guard; what else a spread brings is not written at the
/// route, so nothing is never proven through it.
fn through_a_binding(t: &Thing) -> Is {
    match t.is {
        // A function written in the array is not read there.
        Is::Guard if !t.name.starts_with("in-place") => Is::Guard,
        _ => Is::Unknown,
    }
}

const POSITIONS: &[Position] = &[
    Position {
        name: "argument",
        code: "app.get(\"@P@/in\", @G@, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "argument-of-several",
        code: "app.get(\"@P@/in\", logOnly, @G@, express.json(), h);\napp.get(\"@P@/out\", logOnly, express.json(), h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "argument-array",
        code: "app.get(\"@P@/in\", [logOnly, @G@], h);\napp.get(\"@P@/out\", [logOnly], h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "argument-spread",
        code: "const before@N@ = [@G@];\napp.get(\"@P@/in\", ...before@N@, h);\napp.get(\"@P@/out\", h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: through_a_binding,
    },
    Position {
        name: "route-chain",
        code: "app.route(\"@P@/in\").get(@G@, h);\napp.route(\"@P@/out\").get(h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "router-use",
        code: "const r@N@ = express.Router();\nr@N@.get(\"/before\", h);\nr@N@.use(@G@);\nr@N@.get(\"/after\", h);\napp.use(\"@P@\", r@N@);\n",
        covered: "@P@/after",
        sibling: "@P@/before",
        reads: itself,
    },
    Position {
        name: "router-use-path",
        code: "const r@N@ = express.Router();\nr@N@.use(\"/in\", @G@);\nr@N@.get(\"/in/items\", h);\nr@N@.get(\"/out/items\", h);\napp.use(\"@P@\", r@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "app-use",
        code: "const app@N@ = express();\napp@N@.get(\"@P@/before\", h);\napp@N@.use(@G@);\napp@N@.get(\"@P@/after\", h);\n",
        covered: "@P@/after",
        sibling: "@P@/before",
        reads: itself,
    },
    Position {
        name: "app-use-path",
        code: "const app@N@ = express();\napp@N@.use(\"@P@/in\", @G@);\napp@N@.get(\"@P@/in/items\", h);\napp@N@.get(\"@P@/out/items\", h);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    // A path with a parameter is not evaluated: what is given for it may run for a
    // route it can take, and never for a router mounted at a path a segment written
    // out sets apart.
    Position {
        name: "app-use-path-with-a-parameter",
        code: "const app@N@ = express();\nconst s@N@ = express.Router();\ns@N@.get(\"/items\", h);\napp@N@.use(\"@P@/in/:org\", @G@);\napp@N@.get(\"@P@/in/acme/items\", h);\napp@N@.use(\"@P@/out\", s@N@);\n",
        covered: "@P@/in/acme/items",
        sibling: "@P@/out/items",
        reads: may_cover,
    },
    Position {
        name: "mount",
        code: "const r@N@ = express.Router();\nr@N@.get(\"/items\", h);\nconst s@N@ = express.Router();\ns@N@.get(\"/items\", h);\napp.use(\"@P@/in\", @G@, r@N@);\napp.use(\"@P@/out\", s@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "mount-no-path",
        code: "const app@N@ = express();\nconst r@N@ = express.Router();\nr@N@.get(\"@P@/in\", h);\napp@N@.get(\"@P@/out\", h);\napp@N@.use(@G@, r@N@);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "mount-of-mount",
        code: "const inner@N@ = express.Router();\ninner@N@.get(\"/items\", h);\nconst outer@N@ = express.Router();\nouter@N@.use(\"/v1\", inner@N@);\nconst s@N@ = express.Router();\ns@N@.get(\"/items\", h);\napp.use(\"@P@/in\", @G@, outer@N@);\napp.use(\"@P@/out\", s@N@);\n",
        covered: "@P@/in/v1/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    // A router mounted at two paths with a guard given for one of them: the other
    // is not covered.
    Position {
        name: "mount-at-one-of-two-paths",
        code: "const r@N@ = express.Router();\nr@N@.get(\"/items\", h);\napp.use(\"@P@/in\", @G@, r@N@);\napp.use(\"@P@/out\", r@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "mount-at-several-paths",
        code: "const r@N@ = express.Router();\nr@N@.get(\"/items\", h);\nconst s@N@ = express.Router();\ns@N@.get(\"/items\", h);\napp.use([\"@P@/in\", \"@P@/also\"], @G@, r@N@);\napp.use([\"@P@/out\"], s@N@);\n",
        covered: "@P@/in/items",
        sibling: "@P@/out/items",
        reads: itself,
    },
    Position {
        name: "route-at-several-paths",
        code: "app.get([\"@P@/in\", \"@P@/also\"], @G@, h);\napp.get([\"@P@/out\"], h);\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
];

pub const EXPRESS: Framework = Framework {
    name: "express",
    imports: "",
    files: &[("package.json", PACKAGE), ("src/auth.ts", AUTH)],
    file: "src/server.ts",
    head: HEAD,
    tail: TAIL,
    things: THINGS,
    positions: POSITIONS,
    method: "GET",
};
