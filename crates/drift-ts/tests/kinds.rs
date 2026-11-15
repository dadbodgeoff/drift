//! Facts that say what kind of code a symbol is (TypeScript precision round 4):
//! handlers that read request input, class field decorators, and components bound
//! through `next/dynamic` or `React.lazy`.

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol};
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

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

/// The three-way input fact: `reads_input`, `no_input`, or neither (cannot tell).
fn input(s: &Symbol) -> &'static str {
    let has = |c: &str| s.controls.iter().any(|x| x == c);
    match (has("reads_input"), has("no_input")) {
        (true, false) => "reads",
        (false, true) => "none",
        (false, false) => "unknown",
        _ => panic!("{} has both input facts", s.name),
    }
}

#[test]
fn handlers_that_read_request_input() {
    let r = repo(&[
        (
            "src/routes.ts",
            r#"
import { procedure } from "./trpc";
import { client } from "./client";
import { parseRequestBody, handleError } from "./body";
export const withInput = procedure.query(async ({ ctx, input }) => ctx.get(input.id));
export const noInput = procedure.query(async ({ ctx }) => ctx.user);
export const parsed = async (request: Request) =>
  client({ request, handler: async ({ parsedInput }) => parsedInput.name });
export const sessionOnly = async (request: Request) =>
  client({ request, handler: async ({ authentication }) => authentication.id });
export const sessionWithError = async (request: Request) =>
  client({ request, handler: async ({ authentication }) => handleError(request, authentication) });
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body);
}
export async function PUT(r: Request) {
  return Response.json(await r.json());
}
export async function PATCH(_request: Request) {
  return new Response(await _request.text());
}
export async function DELETE(req: Request) {
  return Response.json(await parseRequestBody(req));
}
export async function OPTIONS(req: Request) {
  return new Response(req.headers.get("origin"));
}
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json(params.id);
}
export async function HEAD() {
  return new Response(null);
}
export const handler = (rq: any, rs: any, next: any) => { rs.json(rq.body); next(); };
export const destructured = (req: any, res: any) => { const { body } = req; res.json(body); };
export const unusedRequest = (_req: any, res: any) => res.json({ ok: true });
export const viaRest = (...args: any[]) => args.length;
"#,
        ),
        (
            "src/actions.ts",
            r#""use server";
export async function save(formData: FormData) {
  return formData.get("name");
}
export async function saveLink(url: string) {
  return url;
}
export async function refresh() {
  return 1;
}
"#,
        ),
        (
            "src/users.controller.ts",
            r#"
import { Body, Controller, Get, Post, Req } from "@nestjs/common";
@Controller("users")
export class UsersController {
  @Post()
  create(@Body() dto: unknown, req: any) {
    return [dto, req.body];
  }
  @Get()
  list() {
    return [];
  }
  @Get("raw")
  raw(@Req() req: any) {
    return req.headers;
  }
}
"#,
        ),
        (
            "src/events.controller.ts",
            r#"
import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
@Controller()
export class EventsController {
  @MessagePattern("sum")
  sum(@Payload() data: number[]) {
    return data.length;
  }
}
"#,
        ),
    ]);
    let routes = file(&r, "src/routes.ts");
    let expect = |f: &FileFacts, name: &str, want: &str| {
        assert_eq!(input(symbol(f, name)), want, "{name}");
    };
    for name in [
        "withInput",
        "parsed",
        "POST",
        "PUT",
        "PATCH",
        "GET",
        "handler",
        "destructured",
    ] {
        expect(routes, name, "reads");
    }
    for name in ["noInput", "HEAD", "unusedRequest"] {
        expect(routes, name, "none");
    }
    // The request handed to a helper or read for headers may be input, and so may
    // a request handed to a wrapper with a handler that takes none of it: the
    // wrapper was given the request (the re-review of PR #37).
    for name in [
        "sessionOnly",
        "sessionWithError",
        "DELETE",
        "OPTIONS",
        "viaRest",
    ] {
        expect(routes, name, "unknown");
    }
    // A server action's arguments are client input, whatever their names.
    let actions = file(&r, "src/actions.ts");
    expect(actions, "save", "reads");
    expect(actions, "saveLink", "reads");
    expect(actions, "refresh", "none");
    let nest = file(&r, "src/users.controller.ts");
    expect(nest, "POST /users", "reads");
    expect(nest, "GET /users", "none");
    expect(nest, "GET /users/raw", "unknown");
    // Facts of the controller class are not its methods' input.
    assert_eq!(input(symbol(nest, "UsersController")), "unknown");
    let events = file(&r, "src/events.controller.ts");
    let sum = events
        .entry_points
        .iter()
        .find(|e| e.route.as_deref().is_some_and(|r| r.contains("sum")))
        .map(|e| symbol(events, &e.symbol))
        .expect("message handler");
    assert_eq!(input(sum), "reads", "@Payload()");
}

// The re-review of PR #37: a destructured parameter whose keys Drift does not know,
// or a callback handed the request through its wrapper, may read input. None of these
// is `no_input`.
#[test]
fn callbacks_and_destructured_keys_that_may_read_input() {
    let r = repo(&[
        (
            "src/jobs.ts",
            r#"
import { inngest } from "./inngest";
import { Worker } from "bullmq";
import { task } from "@trigger.dev/sdk/v3";
export const welcome = inngest.createFunction(
  { id: "welcome" },
  { event: "user/created" },
  async ({ event, step }) => mail(event.data.email),
);
export const worker = new Worker("q", async ({ data }) => send(data.to));
export const sync = task({ id: "sync", run: async ({ userId }) => load(userId) });
export function createProject({ name, ownerId }: { name: string; ownerId: string }) {
  return [name, ownerId];
}
"#,
        ),
        (
            "src/server.ts",
            r#"
import express from "express";
import multer from "multer";
const upload = multer();
export const r = express.Router();
r.param("id", (req: any, _res: any, next: any, id: string) => { req.user = id; next(); });
r.post("/upload", upload.single("f"), ({ file }: any, res: any) => res.json(store(file)));
r.get("/users/:id", ({ user }: any, res: any) => res.json(user));
"#,
        ),
        (
            "app/api/named/route.ts",
            r#"
import { withBody } from "@/lib/body";
export async function POST(req: Request) {
  return withBody(req, async ({ name }: { name: string }) => Response.json(await save(name)));
}
export async function PUT(req: Request) {
  return withBody(req, async () => Response.json({ ok: true }));
}
export async function PATCH({ headers }: Request) {
  return Response.json(headers.get("x"));
}
export async function DELETE(req: Request) {
  return Response.json(req.headers.get("x"));
}
"#,
        ),
    ]);
    let jobs = file(&r, "src/jobs.ts");
    for name in ["welcome", "sync", "createProject"] {
        assert_eq!(input(symbol(jobs, name)), "unknown", "{name}");
    }
    // The BullMQ worker's processor is its `JOB q` entry point.
    assert_eq!(input(symbol(jobs, "JOB q")), "unknown", "worker");
    let server = file(&r, "src/server.ts");
    for name in ["POST /upload", "GET /users/:id"] {
        assert_eq!(input(symbol(server, name)), "unknown", "{name}");
    }
    let named = file(&r, "app/api/named/route.ts");
    for name in ["POST", "PUT", "PATCH", "DELETE"] {
        assert_eq!(input(symbol(named, name)), "unknown", "{name}");
    }
}

#[test]
fn class_field_decorators_are_facts_of_the_class() {
    let r = repo(&[(
        "src/user.dto.ts",
        r#"
import { Field, ObjectType } from "@nestjs/graphql";
import { IsUUID } from "class-validator";
@ObjectType()
export class UserDTO {
  @Field(() => String)
  id: string;
  @Field()
  @IsUUID()
  workspaceId: string;
  name: string;
  @Field()
  get label(): string { return this.name; }
}
export class GetUserDto {
  @IsUUID()
  id: string;
}
export class Plain {
  id: string;
}
"#,
    )]);
    let f = file(&r, "src/user.dto.ts");
    assert_eq!(
        symbol(f, "UserDTO").field_decorators,
        ["pkg:@nestjs/graphql#Field", "pkg:class-validator#IsUUID"]
    );
    assert_eq!(
        symbol(f, "GetUserDto").field_decorators,
        ["pkg:class-validator#IsUUID"]
    );
    assert!(symbol(f, "Plain").field_decorators.is_empty());
    // Field decorators stay off the class's own wraps and calls.
    let dto = symbol(f, "UserDTO");
    assert_eq!(dto.wraps.len(), 1);
    assert!(!dto.calls.iter().any(|c| c.ends_with("#Field")));
}

#[test]
fn lazily_loaded_components_render_their_module() {
    let r = repo(&[
        (
            "components/Layout.tsx",
            "export default function Layout({ children }: any) { return <main>{children}</main>; }\nexport function Shell({ children }: any) { return <div>{children}</div>; }\n",
        ),
        (
            "pages/a.tsx",
            r#"
import dynamic from "next/dynamic";
import React, { lazy } from "react";
const Layout = dynamic(() => import("../components/Layout"));
const Shell = lazy(() => import("../components/Layout").then((m) => m.Shell));
const Other = React.lazy(() => import("../components/Layout"));
const Wrapped = lazy(() => import("../components/Layout").then((m) => ({ default: m.Shell })));
const Deep = lazy(() => import("../components/Layout").then((m) => m.Shell.Inner));
export default function Page() {
  return <Layout><Shell><Other /><Wrapped /><Deep /></Shell></Layout>;
}
"#,
        ),
    ]);
    let page = symbol(file(&r, "pages/a.tsx"), "Page");
    assert!(
        page.renders
            .contains(&"components/Layout.tsx#Layout".to_string()),
        "{:?}",
        page.renders
    );
    assert!(
        page.renders
            .contains(&"components/Layout.tsx#Shell".to_string()),
        "{:?}",
        page.renders
    );
    // `Other` and `Wrapped` resolve; `m.Shell.Inner` is no export of the module.
    let local: Vec<&str> = page
        .renders
        .iter()
        .filter_map(|r| r.strip_prefix("pages/a.tsx#"))
        .collect();
    assert_eq!(local, ["Deep"], "{:?}", page.renders);
}

#[test]
fn bindings_built_on_another_by_builder_steps_derive_from_it() {
    let r = repo(&[
        (
            "src/trpc.ts",
            r#"
import { initTRPC } from "@trpc/server";
import { createSafeActionClient } from "next-safe-action";
import * as mw from "./mw";
const t = initTRPC.create();
export const procedure = t.procedure;
export const authedProcedure = procedure.use(mw.isAuthed).use(mw.log);
export const bookingsProcedure = authedProcedure.input(schema).use(async ({ next }) => next());
export const metaProcedure = authedProcedure.meta({ authRequired: false });
export const actionClient = createSafeActionClient().use(async ({ next }) => next());
export const authedClient = actionClient.use(async ({ next }) => next());
export const schemaClient = (authedClient as any).inputSchema(schema);
export const skipped = authedProcedure.unstable_skip();
export const viaFactory = makeProcedure(authedProcedure);
export const fromGlobal = fetch;
export const value = 1;
"#,
        ),
        (
            "src/mw.ts",
            "export const isAuthed = 1;\nexport const log = 2;\n",
        ),
        (
            "src/alias.ts",
            "import { bookingsProcedure } from \"./trpc\";\nexport const p = bookingsProcedure;\nexport default bookingsProcedure.use(x);\n",
        ),
    ]);
    let f = file(&r, "src/trpc.ts");
    for (name, want) in [
        ("procedure", "src/trpc.ts#t.procedure"),
        ("authedProcedure", "src/trpc.ts#procedure.use().use()"),
        (
            "bookingsProcedure",
            "src/trpc.ts#authedProcedure.input().use()",
        ),
        // Middleware reads metadata (`authRequired: false`): no additive step.
        ("metaProcedure", ""),
        // A factory call builds the client: it derives from nothing.
        ("actionClient", ""),
        ("authedClient", "src/trpc.ts#actionClient.use()"),
        ("schemaClient", "src/trpc.ts#authedClient.inputSchema()"),
        // A step Drift does not know may replace what it is called on.
        ("skipped", ""),
        ("viaFactory", ""),
        ("fromGlobal", ""),
        ("value", ""),
    ] {
        assert_eq!(symbol(f, name).derives_from, want, "{name}");
    }
    let a = file(&r, "src/alias.ts");
    assert_eq!(symbol(a, "p").derives_from, "src/trpc.ts#bookingsProcedure");
    assert_eq!(
        symbol(a, "default").derives_from,
        "src/trpc.ts#bookingsProcedure.use()"
    );
}

// The review of #51: in a `"use server"` file, only a wrapped function whose one
// parameter is an object pattern is read by key; a later parameter, or a single plain
// one, may be the client's argument. `arguments` reads whatever was passed.
#[test]
fn wrapped_server_functions_keep_client_arguments_after_the_first_parameter() {
    let r = repo(&[(
        "app/actions.ts",
        r#""use server";
import { withAuth } from "./auth";
import { client } from "./client";
export const a = withAuth(async (_session, payload) => save(payload.id));
export const b = withAuth(async ({ ctx }, data) => save(ctx.user, data.id));
export const c = withAuth(async (postId: string) => remove(postId));
export const d = client.action(async ({ ctx }) => reset(ctx.user));
export const e = client.action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));
export const f = withAuth(async function () { return save(arguments[0]); });
export async function g() { return save(arguments[0]); }
export async function h() { return list(); }
"#,
    )]);
    let f = file(&r, "app/actions.ts");
    let input = |n: &str| {
        let c = &symbol(f, n).controls;
        if c.iter().any(|c| c == "reads_input") {
            "reads"
        } else if c.iter().any(|c| c == "no_input") {
            "none"
        } else {
            "unknown"
        }
    };
    for (n, want) in [
        ("a", "reads"),
        ("b", "reads"),
        ("c", "reads"),
        ("d", "none"),
        ("e", "reads"),
        ("f", "reads"),
        ("g", "reads"),
        ("h", "none"),
    ] {
        assert_eq!(input(n), want, "{n}");
    }
    // Outside a `"use server"` file, `arguments` is unknown, never "no input".
    let r = repo(&[(
        "lib/x.ts",
        "export function g() { return save(arguments[0]); }\nexport const k = () => [].map(function () { return arguments.length; });\n",
    )]);
    let f = file(&r, "lib/x.ts");
    assert!(!symbol(f, "g").controls.iter().any(|c| c == "no_input"));
}

// Mining tells a guard from a wrapper that only logs or opens a session by what its
// definition does: a body that throws, returns or redirects a 401/403 or an
// `UNAUTHORIZED` error rejects its caller; one that maps statuses or rethrows does not.
#[test]
fn a_body_that_turns_the_caller_away_rejects_it() {
    let r = repo(&[(
        "server/m.ts",
        r#"
import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
export const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next();
});
export const message = async () => { if (!s) { throw new Error("Unauthorized: Login required."); } };
export function api(req: Request) {
  if (!req.headers.get("x")) {
    return Response.json({ error: "nope" }, { status: 401 });
  }
  return Response.json({});
}
export function express(req: any, res: any) { if (!req.user) { res.status(403).json({}); } }
export async function page() { if (!user) redirect("/login?next=/x"); return null; }
export const rethrow = middleware(async ({ next }) => {
  try { return await next(); } catch (e) { throw convert(e); }
});
export function statusToCode(s: number) {
  switch (s) { case 401: return "UNAUTHORIZED"; default: return "INTERNAL"; }
}
export const notFound = () => { throw new TRPCError({ code: "NOT_FOUND" }); };
export function logs() { console.log("unauthorized attempt"); return 1; }
export const errors = middleware(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    if (e instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED", cause: e });
    throw e;
  }
});
export function warns(x: unknown) {
  console.warn("Unauthorized access attempt");
  if (!x) throw new Error("missing");
}
export function bound() {
  const err = new TRPCError({ code: "FORBIDDEN" });
  if (!user) throw err;
}
export const mapsCatch = middleware(({ next }) =>
  next().catch((e) => {
    if (e instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED" });
    throw e;
  }),
);
export const mapsResult = middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof AuthError) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return result;
});
export const rateLimit = middleware(async ({ ctx, next }) => {
  if (await tooMany(ctx.ip)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Too many requests" });
  }
  return next();
});
export const throttled = (req: any, res: any) => { res.status(429).end(); };
export const userQuota = middleware(async ({ ctx, next }) => {
  if (await overQuota(ctx.user.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Too many requests" });
  }
  return next();
});
export const featureFlag = middleware(({ next }) => {
  if (!flags.beta) throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});
export const apiKeyOrSession = middleware(async ({ ctx, next }) => {
  if (ctx.apiKey) {
    return next({ ctx });
  }
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx });
});
export const chained = t.procedure
  .use(({ next }) => next())
  .use(({ ctx, next }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next();
  });
export const aliased = middleware(async ({ next: go }) => {
  const r = await go();
  if (!r.ok && r.error instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED" });
  return r;
});
export const computed = middleware(async (opts) => {
  const r = await opts["next"]();
  if (!r.ok) throw new TRPCError({ code: "UNAUTHORIZED" });
  return r;
});
export const expressAfter = (req: any, res: any, proceed: any) => {
  proceed();
  if (res.locals.user === undefined) res.status(401);
};
export const koaAfter = async (ctx: any, onward: any) => {
  await onward();
  if (!ctx.state.user) ctx.throw(new HttpError({ status: 401 }));
};
export function mapAuthErrors(r: any) {
  if (!r.ok && r.error instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED" });
  return r;
}
export const mapped = middleware(async ({ next }) => mapAuthErrors(await next()));
export const checked = middleware(async ({ ctx, next }) => {
  assertUser(ctx);
  return next();
});
export const afterNext = middleware(async ({ ctx, next }) => {
  const out = await next();
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return out;
});
"#,
    )]);
    let f = file(&r, "server/m.ts");
    let rejects = |n: &str| symbol(f, n).controls.iter().any(|c| c == "rejects_caller");
    // A 403 next to a user or session read is a guard's; a branch that hands control on
    // and returns does not hide the check after it; each inline middleware has its own
    // continuation.
    for n in [
        "isAuthed",
        "message",
        "api",
        "express",
        "page",
        "bound",
        "apiKeyOrSession",
        "chained",
        // On its own a mapper rejects; mining does not read it into a middleware that
        // calls it on the continuation's result (`after_continuation` below).
        "mapAuthErrors",
    ] {
        assert!(rejects(n), "{n}");
    }
    // An error-mapping middleware converts what it catches from deeper code; rejection
    // words in a log call say nothing about an unrelated throw.
    for n in [
        "rethrow",
        "statusToCode",
        "notFound",
        "logs",
        "errors",
        "warns",
        // A rejection in a `.catch()` callback, after the continuation or on its
        // result, a rate limit, or a 403 that reads no user: none authenticates.
        "mapsCatch",
        "mapsResult",
        "rateLimit",
        "throttled",
        "userQuota",
        "featureFlag",
        "afterNext",
        // The continuation under another name: a destructured alias, `opts["next"]`,
        // Express's and Koa's positional parameter.
        "aliased",
        "computed",
        "expressAfter",
        "koaAfter",
        "mapped",
    ] {
        assert!(!rejects(n), "{n}");
    }
    // A call on the continuation's result acts on what it handed back; one before it
    // does not.
    let after = |n: &str| symbol(f, n).after_continuation.clone();
    assert_eq!(after("mapped"), ["server/m.ts#mapAuthErrors"]);
    assert!(after("checked").is_empty(), "{:?}", after("checked"));
}
