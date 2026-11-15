//! tRPC: the things (middleware) and the positions (where a procedure takes one).

use super::{Framework, Is, Position, Thing, itself, thing};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "@trpc/server": "11.0.0", "zod": "3.23.0", "@acme/trpc-sso": "1.0.0" } }
"#;

/// The instance, its base procedure and the middleware of the repository.
const TRPC: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";
import { lookup } from "./generated/lookup";

type Ctx = { user?: { id: string; role: string } };
const t = initTRPC.context<Ctx>().create();
export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const requireSession = async ({ ctx, next }: { ctx: Ctx; next: () => Promise<unknown> }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "sign in" });
  }
  return next();
};

export const logs = t.middleware(async ({ path, next }) => {
  console.log(path);
  return next();
});

export const timing = t.middleware(async ({ next }) => {
  const started = Date.now();
  const result = await next();
  console.log(Date.now() - started);
  return result;
});

export const adminOnly = t.middleware(({ ctx, next, path }) => {
  if (path.startsWith("admin.") && !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});

export const unreadBody = t.middleware(async ({ ctx, next }) => {
  await lookup(ctx);
  return next();
});
"#;

const HEAD: &str = r#"import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ssoMiddleware, createSso } from "@acme/trpc-sso";
import { fromElsewhere } from "./generated/guards";
import {
  router, mergeRouters, publicProcedure, isAuthed, requireSession, logs, timing, adminOnly, unreadBody,
} from "./trpc";

declare const flag: boolean;
declare const kind: string;
declare const injected: any;
declare const registry: Record<string, any>;
"#;

const THINGS: &[Thing] = &[
    // a.
    thing('a', "throws-unauthorized", "isAuthed", Is::Guard),
    thing('a', "plain-function", "requireSession", Is::Guard),
    thing(
        'a',
        "in-place",
        "({ ctx, next }) => { if (!ctx.user) { throw new TRPCError({ code: \"UNAUTHORIZED\" }); } return next(); }",
        Is::Guard,
    ),
    // b.
    thing('b', "logs", "logs", Is::Nothing),
    thing('b', "timing", "timing", Is::Nothing),
    // c.
    thing('c', "some-paths", "adminOnly", Is::Unknown),
    thing('c', "unread-call", "unreadBody", Is::Unknown),
    // g.
    thing('g', "package-reference", "ssoMiddleware", Is::Unknown),
    thing(
        'g',
        "package-call",
        "createSso({ realm: \"api\" })",
        Is::Unknown,
    ),
    // h.
    thing('h', "conditional", "(flag ? isAuthed : logs)", Is::Unknown),
    thing('h', "computed", "registry[kind]", Is::Unknown),
    thing('h', "member-unread", "registry.authed", Is::Unknown),
    thing('h', "declared", "injected", Is::Unknown),
    thing('h', "unresolved-import", "fromElsewhere", Is::Unknown),
];

/// A middleware written in place in a route's own chain is not read: unknown.
fn in_the_route(t: &Thing) -> Is {
    if t.name == "in-place" {
        Is::Unknown
    } else {
        t.is
    }
}

const POSITIONS: &[Position] = &[
    Position {
        name: "use-in-the-chain",
        code: "export const r@N@ = router({\n  c@N@in: publicProcedure.use(@G@).query(() => []),\n  c@N@out: publicProcedure.query(() => []),\n});\n",
        covered: "c@N@in",
        sibling: "c@N@out",
        reads: in_the_route,
    },
    Position {
        name: "use-after-another-and-an-input",
        code: "export const r@N@ = router({\n  c@N@in: publicProcedure.use(logs).input(z.object({ id: z.string() })).use(@G@).query(() => []),\n  c@N@out: publicProcedure.use(logs).input(z.object({ id: z.string() })).query(() => []),\n});\n",
        covered: "c@N@in",
        sibling: "c@N@out",
        reads: in_the_route,
    },
    Position {
        name: "derived-procedure",
        code: "const proc@N@ = publicProcedure.use(@G@);\nexport const r@N@ = router({\n  c@N@in: proc@N@.query(() => []),\n  c@N@out: publicProcedure.query(() => []),\n});\n",
        covered: "c@N@in",
        sibling: "c@N@out",
        reads: itself,
    },
    Position {
        name: "derived-of-a-derived",
        code: "const base@N@ = publicProcedure.use(@G@);\nconst proc@N@ = base@N@.use(timing).input(z.object({ id: z.string() }));\nconst plain@N@ = publicProcedure.use(timing);\nexport const r@N@ = router({\n  c@N@in: proc@N@.query(() => []),\n  c@N@out: plain@N@.query(() => []),\n});\n",
        covered: "c@N@in",
        sibling: "c@N@out",
        reads: itself,
    },
    Position {
        name: "router-in-a-router",
        code: "const proc@N@ = publicProcedure.use(@G@);\nconst inner@N@ = router({ c@N@in: proc@N@.mutation(() => []) });\nexport const r@N@ = router({ inner@N@, c@N@out: publicProcedure.mutation(() => []) });\n",
        covered: "MUTATION c@N@in",
        sibling: "MUTATION c@N@out",
        reads: itself,
    },
    Position {
        name: "merged-routers",
        code: "const proc@N@ = publicProcedure.use(@G@);\nconst a@N@ = router({ c@N@in: proc@N@.query(() => []) });\nconst b@N@ = router({ c@N@out: publicProcedure.query(() => []) });\nexport const r@N@ = mergeRouters(a@N@, b@N@);\n",
        covered: "c@N@in",
        sibling: "c@N@out",
        reads: itself,
    },
];

pub const TRPC_ROUTERS: Framework = Framework {
    name: "trpc",
    imports: "",
    files: &[("package.json", PACKAGE), ("src/trpc.ts", TRPC)],
    file: "src/router.ts",
    head: HEAD,
    tail: "",
    things: THINGS,
    positions: POSITIONS,
    method: "QUERY",
};
