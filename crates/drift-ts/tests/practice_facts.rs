//! Practice facts (facts schema 11, TS `LOWERING_VERSION` 38): in-body caller checks,
//! request headers, middleware matchers, re-exported and destructured handlers,
//! responses, catch clauses, error handlers, log calls, validated inputs, test
//! requests and mocks, dev-only packages, environment reads through constants and
//! helpers, route templates, and the `cli` and `consumer` entry kinds.

use std::fs;
use std::path::Path;

use drift_core::practice::caps;
use drift_core::{CheckOutcome, FileFacts, RepoFacts, ResponseVia, Symbol};
use drift_ts::{ScanOptions, scan};

const NEXT_PACKAGE: &str = r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }"#;

fn repo_with(files: &[(&str, &str)], threads: usize) -> RepoFacts {
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
            threads,
        },
    )
    .expect("scan")
    .0
}

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    repo_with(files, 1)
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
        .unwrap_or_else(|| panic!("{name} not in {}: {:?}", f.path, names(f)))
}

fn names(f: &FileFacts) -> Vec<&str> {
    f.symbols.iter().map(|s| s.name.as_str()).collect()
}

/// `source reads compares outcome` per check.
fn checks(s: &Symbol) -> Vec<String> {
    s.body_checks
        .iter()
        .map(|c| format!("{} {} {} {:?}", c.source, c.reads, c.compares, c.outcome))
        .collect()
}

/// `status via builder keys in_catch` per response.
fn responses(s: &Symbol) -> Vec<String> {
    s.responses
        .iter()
        .map(|r| {
            format!(
                "{} {:?} {} [{}]{}{}",
                r.status,
                r.via,
                r.builder,
                r.keys.join(","),
                if r.in_catch { " catch" } else { "" },
                if r.model.is_empty() {
                    String::new()
                } else {
                    format!(" model={}", r.model)
                }
            )
        })
        .collect()
}

fn catches(s: &Symbol) -> Vec<String> {
    s.catches
        .iter()
        .map(|c| format!("{} -> {}", c.catches.join(","), c.does.join(",")))
        .collect()
}

fn logs(s: &Symbol) -> Vec<String> {
    s.log_calls
        .iter()
        .map(|l| {
            format!(
                "{} {}{}{}{}",
                l.callee,
                l.level,
                if l.in_catch { " catch" } else { "" },
                if l.structured { " structured" } else { "" },
                if l.passes_error { " error" } else { "" }
            )
        })
        .collect()
}

// ------------------------------------------------------------------ 1. body checks

const AUTH_ROUTE: &str = r#"
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getServerSession } from "next-auth";
import { prisma } from "../../../lib/db";

export async function GET(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (orgId !== req.headers.get("X-Org-Id")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const project = await prisma.project.findFirst({ where: { orgId } });
  if (!project) return NextResponse.json({ error: "missing" }, { status: 404 });
  return NextResponse.json(project);
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
"#;

const AUTH_HELPERS: &str = r#"
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

export async function requireUser() {
  const s = await auth();
  if (!s) throw new TRPCError({ code: "UNAUTHORIZED" });
  return s;
}

export function requireAdmin(user: { role: string }) {
  if (user.role !== "admin") {
    return new Response(null, { status: 403 });
  }
  return null;
}

export function flagged(enabled: boolean) {
  if (!enabled) return new Response(null, { status: 403 });
  return null;
}

export async function caught() {
  try {
    await work();
  } catch (e) {
    const s = await auth();
    if (!s) return new Response(null, { status: 401 });
  }
}

export function middlewareLike(req: Request, res: any, next: () => void) {
  next();
  const user = (req as any).user;
  if (!user) return res.status(401).end();
}

async function work() {}
"#;

const SIGN_IN_PAGE: &str = r#"
import { currentUser } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getLink } from "../../lib/links";

export default async function Page({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const link = await getLink(params.id);
  if (!link) notFound();
  return <div>{link.url}</div>;
}
"#;

fn auth_repo() -> RepoFacts {
    repo(&[
        ("package.json", NEXT_PACKAGE),
        ("app/api/projects/route.ts", AUTH_ROUTE),
        ("lib/auth.ts", AUTH_HELPERS),
        ("lib/db.ts", "export const prisma: any = {};\n"),
        (
            "lib/links.ts",
            "export async function getLink(id: string) { return id; }\n",
        ),
        ("app/links/page.tsx", SIGN_IN_PAGE),
    ])
}

#[test]
fn in_body_checks_name_their_source_member_and_comparison() {
    let r = auth_repo();
    let route = file(&r, "app/api/projects/route.ts");
    assert_eq!(
        checks(symbol(route, "GET")),
        [
            "lib/db.ts#prisma.project.findFirst   NotFound",
            "pkg:@clerk/nextjs/server#auth .orgId header:x-org-id Forbidden",
            "pkg:@clerk/nextjs/server#auth .userId  Unauthenticated",
        ]
    );
    assert_eq!(
        checks(symbol(route, "POST")),
        ["pkg:next-auth#getServerSession .user  Unauthenticated"]
    );
    assert_eq!(symbol(route, "GET").headers, ["x-org-id"]);
    let page = file(&r, "app/links/page.tsx");
    assert_eq!(
        checks(symbol(page, "Page")),
        [
            "lib/links.ts#getLink   NotFound",
            "pkg:@clerk/nextjs/server#currentUser   SignInRedirect",
        ]
    );
}

#[test]
fn helpers_that_throw_or_return_a_rejection_carry_their_own_checks() {
    let r = auth_repo();
    let lib = file(&r, "lib/auth.ts");
    assert_eq!(
        checks(symbol(lib, "requireUser")),
        ["pkg:@clerk/nextjs/server#auth   Unauthenticated"]
    );
    assert_eq!(
        checks(symbol(lib, "requireAdmin")),
        ["param:user .role literal Forbidden"]
    );
    // A 403 next to no subject (a feature switch) is no caller check; nor is a check
    // in a catch clause, or one after the continuation ran.
    assert!(checks(symbol(lib, "flagged")).is_empty());
    assert!(checks(symbol(lib, "middlewareLike")).is_empty());
    // The `if (!s)` in the `catch` is no check on `auth()`. The `try` itself is found:
    // its handler answers 401 for some of what `work()` throws, so it is a check on
    // `work` that is not proven for any request (lowering 60).
    let caught: Vec<_> = symbol(lib, "caught")
        .body_checks
        .iter()
        .map(|c| (c.source.as_str(), c.conditional, c.condition.as_str()))
        .collect();
    assert_eq!(caught, [("lib/auth.ts#work", true, "swallowed")]);
    assert!(
        !symbol(lib, "caught")
            .controls
            .iter()
            .any(|c| c == "rejects_caller")
    );
}

#[test]
fn body_checks_are_capped() {
    let mut body = String::from("import { a } from \"./a\";\nexport function many() {\n");
    for i in 0..(caps::BODY_CHECKS + 6) {
        body.push_str(&format!(
            "  const s{i} = a.f{i}();\n  if (!s{i}) throw new Response(null, {{ status: 401 }});\n"
        ));
    }
    body.push_str("}\n");
    let r = repo(&[("x.ts", &body), ("a.ts", "export const a: any = {};\n")]);
    let s = symbol(file(&r, "x.ts"), "many");
    assert_eq!(s.body_checks.len(), caps::BODY_CHECKS);
    let mut sorted = s.body_checks.clone();
    sorted.sort();
    assert_eq!(sorted, s.body_checks);
    assert!(
        s.body_checks
            .iter()
            .all(|c| c.outcome == CheckOutcome::Unauthenticated)
    );
}

// ------------------------------------------------------------------ headers

#[test]
fn headers_are_read_only_from_literal_names() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "app/api/h/route.ts",
            r#"
import { headers } from "next/headers";
export async function GET(req: Request) {
  const h = await headers();
  const a = h.get("x-api-key");
  const b = (await headers()).get("X-Request-Id");
  const name = "x-dynamic";
  const c = req.headers.get(name);
  const d = req.headers.get("x org");
  return Response.json({ a, b, c, d });
}
"#,
        ),
        (
            "server.ts",
            r#"
import express from "express";
const app = express();
app.get("/x", (req, res) => {
  const t = req.header("Authorization");
  const u = req.headers["x-tenant-id"];
  const v = req.headers.cookie;
  res.header("x-powered-by", "me");
  res.json({ t, u, v });
});
"#,
        ),
    ]);
    assert_eq!(
        symbol(file(&r, "app/api/h/route.ts"), "GET").headers,
        ["x-api-key", "x-request-id"]
    );
    assert_eq!(
        symbol(file(&r, "server.ts"), "GET /x").headers,
        ["authorization", "cookie", "x-tenant-id"]
    );
    let mut many = String::from("export function f(req: Request) {\n");
    for i in 0..(caps::HEADERS + 4) {
        many.push_str(&format!("  req.headers.get(\"x-h{i:02}\");\n"));
    }
    many.push_str("}\n");
    let r = repo(&[("m.ts", &many)]);
    let s = symbol(file(&r, "m.ts"), "f");
    assert_eq!(s.headers.len(), caps::HEADERS);
    assert_eq!(s.headers[0], "x-h00");
}

// ------------------------------------------------------------------ route matchers

#[test]
fn middleware_matchers_have_three_states() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "known/middleware.ts",
            r#"
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/api/webhooks(.*)"]);
export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});
export const config = { matcher: ["/api/(.*)", { source: "/trpc/(.*)" }] };
"#,
        ),
        (
            "unknown/middleware.ts",
            r#"
const extra = "/x";
const mixed = createRouteMatcher(["/ok(.*)", extra]);
export function middleware() {}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)", "/api/(.*)"],
};
function createRouteMatcher(_: string[]) { return () => true; }
"#,
        ),
        (
            "none/middleware.ts",
            "export function middleware() {}\nexport const other = { matcher: [\"/a\"] };\n",
        ),
    ]);
    let m = |p: &str| {
        file(&r, p)
            .route_matchers
            .iter()
            .map(|m| {
                format!(
                    "{}={} {:?}{}",
                    m.binding,
                    m.patterns.join(","),
                    m.polarity,
                    if m.opaque { " opaque" } else { "" }
                )
            })
            .collect::<Vec<_>>()
    };
    // Known: every pattern is a route.
    assert_eq!(
        m("known/middleware.ts"),
        [
            "config.matcher=/api/(.*),/trpc/(.*) Applies",
            "isPublicRoute=/api/webhooks(.*),/sign-in(.*) Public"
        ]
    );
    // Unreadable (a negative lookahead, a non-literal): no patterns, never a partial list.
    assert_eq!(
        m("unknown/middleware.ts"),
        ["config.matcher= Applies opaque", "mixed= Unknown opaque"]
    );
    // None declared: no matcher at all (the middleware runs on every route).
    assert!(m("none/middleware.ts").is_empty());
}

#[test]
fn matcher_polarity_follows_its_use_then_its_name() {
    let r = repo(&[(
        "middleware.ts",
        r#"
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
const guarded = createRouteMatcher(["/dashboard(.*)"]);
const open = createRouteMatcher(["/blog(.*)"]);
const isProtectedRoute = createRouteMatcher(["/settings(.*)"]);
const isPublicApi = createRouteMatcher(["/api/public(.*)"]);
const both = createRouteMatcher(["/x"]);
export default clerkMiddleware(async (auth, req) => {
  if (guarded(req)) await auth.protect();
  if (!open(req)) { auth().protect(); }
  if (both(req)) await auth.protect();
  if (!both(req)) await auth.protect();
});
"#,
    )]);
    let pol: Vec<_> = file(&r, "middleware.ts")
        .route_matchers
        .iter()
        .map(|m| format!("{} {:?}", m.binding, m.polarity))
        .collect();
    assert_eq!(
        pol,
        [
            "both Unknown",
            "guarded Applies",
            "isProtectedRoute Applies",
            "isPublicApi Public",
            "open Public",
        ]
    );
}

// ------------------------------------------------------------------ re-exported handlers

#[test]
fn destructured_and_re_exported_handlers_reach_their_origin() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "auth.ts",
            "import NextAuth from \"next-auth\";\nexport const { handlers, auth } = NextAuth({});\n",
        ),
        (
            "app/api/auth/[...nextauth]/route.ts",
            "import { handlers } from \"../../../../auth\";\nexport const { GET, POST } = handlers;\n",
        ),
        (
            "app/api/legacy/route.ts",
            "export { GET, POST as PUT } from \"../../../lib/handlers\";\n",
        ),
        (
            "lib/handlers.ts",
            "export async function GET() { return Response.json({}); }\nexport async function POST() { return Response.json({}, { status: 201 }); }\n",
        ),
    ]);
    let na = file(&r, "app/api/auth/[...nextauth]/route.ts");
    assert_eq!(symbol(na, "GET").derives_from, "auth.ts#handlers.GET");
    assert_eq!(symbol(na, "POST").derives_from, "auth.ts#handlers.POST");
    let kinds: Vec<_> = na.entry_points.iter().map(|e| e.symbol.as_str()).collect();
    assert_eq!(kinds, ["GET", "POST"]);
    let legacy = file(&r, "app/api/legacy/route.ts");
    let origins: Vec<_> = legacy
        .exports
        .iter()
        .map(|e| format!("{}={}", e.name, e.origin))
        .collect();
    assert_eq!(
        origins,
        ["GET=lib/handlers.ts#GET", "PUT=lib/handlers.ts#POST"]
    );
    let entries: Vec<_> = legacy
        .entry_points
        .iter()
        .map(|e| format!("{} {}", e.symbol, e.route.as_deref().unwrap_or("")))
        .collect();
    assert_eq!(entries, ["GET /api/legacy", "PUT /api/legacy"]);
    // The origin carries the facts.
    assert_eq!(
        responses(symbol(file(&r, "lib/handlers.ts"), "POST")),
        ["201 Return global#Response.json []"]
    );
}

// ------------------------------------------------------------------ 2. errors

#[test]
fn catch_clauses_map_errors_to_responses() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "lib/logger.ts",
            "import pino from \"pino\";\nexport const logger = pino();\n",
        ),
        (
            "app/api/x/route.ts",
            r#"
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import * as Sentry from "@sentry/nextjs";
import { logger } from "../../../lib/logger";
export async function GET() {
  try {
    return NextResponse.json(await load());
  } catch (err) {
    logger.error({ err }, "load failed");
    return NextResponse.json({ error: "internal", code: 1 }, { status: 500 });
  }
}
export async function POST() {
  try {
    await load();
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "bad" }, { status: 400 });
    }
    throw e;
  }
  return new NextResponse(null, { status: 204 });
}
export async function PUT() {
  try { await load(); } catch {}
  try { await load(); } catch (e) { Sentry.captureException(e); }
  try { await load(); } catch (e) { throw new Error("wrapped"); }
  try { await load(); } catch (e) { return null; }
  return load();
}
async function load() { return 1; }
"#,
        ),
    ]);
    let f = file(&r, "app/api/x/route.ts");
    assert_eq!(catches(symbol(f, "GET")), ["* -> log,respond:500"]);
    assert_eq!(
        responses(symbol(f, "GET")),
        [
            "200 Return pkg:next/server#NextResponse.json []",
            "500 Return pkg:next/server#NextResponse.json [code,error] catch",
        ]
    );
    assert_eq!(
        catches(symbol(f, "POST")),
        ["pkg:zod#ZodError -> respond:400,rethrow"]
    );
    assert_eq!(
        responses(symbol(f, "POST")),
        [
            "204 Return pkg:next/server#NextResponse(new) []",
            "400 Return pkg:next/server#NextResponse.json [error] catch",
        ]
    );
    assert_eq!(
        catches(symbol(f, "PUT")),
        [
            "* -> report:pkg:@sentry/nextjs#captureException",
            "* -> return",
            "* -> swallow",
            "* -> throw:global#Error",
        ]
    );
    // `return load()` sends no response.
    assert!(symbol(f, "PUT").responses.is_empty());
}

#[test]
fn express_nest_and_trpc_responses() {
    let r = repo(&[
        (
            "server.ts",
            r#"
import express from "express";
const app = express();
app.get("/users/:id", async (req, res) => {
  const user = await find(req.params.id);
  if (!user) {
    res.status(404).json({ message: "not found" });
    return;
  }
  return res.status(200).send(user);
});
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});
export function errorHandler(err: Error, req: any, res: any, next: any) {
  res.sendStatus(500);
}
async function find(id: string) { return id; }
"#,
        ),
        (
            "src/users.controller.ts",
            r#"
import { Controller, Get, Post, Body, HttpCode, HttpException, HttpStatus, NotFoundException, Headers, Catch } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { CreateUserDto, UserDto } from "./dto";
@Controller("users")
export class UsersController {
  @Get(":id")
  @ApiOkResponse({ type: UserDto })
  get(@Headers("x-tenant") tenant: string) {
    if (!tenant) throw new HttpException("no", HttpStatus.FORBIDDEN);
    throw new NotFoundException();
  }
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateUserDto) {
    return dto;
  }
}
@Catch(HttpException)
export class HttpFilter {}
@Catch()
export class AnyFilter {}
"#,
        ),
        (
            "src/dto.ts",
            "export class CreateUserDto {}\nexport class UserDto {}\n",
        ),
        (
            "src/trpc.ts",
            r#"
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { Input } from "./schemas";
export const t = initTRPC.create({ errorFormatter: ({ shape }) => shape });
export const authed = t.procedure;
export const getX = authed.input(Input).output(z.string()).query(({ input }) => {
  if (!input) throw new TRPCError({ code: "NOT_FOUND" });
  return "x";
});
"#,
        ),
        (
            "src/schemas.ts",
            "import { z } from \"zod\";\nexport const Input = z.object({});\n",
        ),
    ]);
    let s = file(&r, "server.ts");
    assert_eq!(
        responses(symbol(s, "GET /users/:id")),
        ["200 Return  []", "404 Setter  [message]"]
    );
    assert_eq!(symbol(s, "app").handles_errors, ["*"]);
    assert_eq!(symbol(s, "errorHandler").handles_errors, ["*"]);
    let c = file(&r, "src/users.controller.ts");
    let get = symbol(c, "GET /users/:id");
    assert_eq!(
        responses(get),
        [
            "200 Declared  [] model=src/dto.ts#UserDto",
            "403 Throw pkg:@nestjs/common#HttpException(new) []",
            "404 Throw pkg:@nestjs/common#NotFoundException(new) []",
        ]
    );
    assert_eq!(get.headers, ["x-tenant"]);
    let post = symbol(c, "POST /users");
    assert_eq!(responses(post), ["201 Declared  []"]);
    assert_eq!(post.inputs, ["src/dto.ts#CreateUserDto"]);
    assert_eq!(
        symbol(c, "HttpFilter").handles_errors,
        ["pkg:@nestjs/common#HttpException"]
    );
    assert_eq!(symbol(c, "AnyFilter").handles_errors, ["*"]);
    let t = file(&r, "src/trpc.ts");
    assert_eq!(symbol(t, "t").handles_errors, ["*"]);
    let get_x = symbol(t, "getX");
    assert_eq!(get_x.inputs, ["src/schemas.ts#Input"]);
    assert_eq!(
        responses(get_x),
        [
            "0 Declared  [] model=pkg:zod#z.string()",
            "404 Throw pkg:@trpc/server#TRPCError(new) []",
        ]
    );
}

#[test]
fn responses_and_catches_are_capped() {
    let mut body = String::from("export function many(x: number) {\n");
    for i in 0..(caps::RESPONSES + 4) {
        body.push_str(&format!(
            "  if (x === {i}) return Response.json({{}}, {{ status: {} }});\n",
            400 + i
        ));
        body.push_str(&format!(
            "  try {{ x++; }} catch (e{i}) {{ return Response.json({{}}, {{ status: {} }}); }}\n",
            500 + i
        ));
    }
    body.push_str("}\n");
    let r = repo(&[("x.ts", &body)]);
    let s = symbol(file(&r, "x.ts"), "many");
    assert_eq!(s.responses.len(), caps::RESPONSES);
    assert_eq!(s.catches.len(), caps::CATCHES);
}

// ------------------------------------------------------------------ 3. logging

#[test]
fn log_calls_record_level_structure_and_the_caught_error() {
    let r = repo(&[
        (
            "lib/log.ts",
            "import pino from \"pino\";\nimport winston from \"winston\";\nexport const logger = pino();\nexport const wlog = winston.createLogger({});\n",
        ),
        (
            "src/job.ts",
            r#"
import { logger, wlog } from "../lib/log";
export async function run(items: any) {
  logger.info({ count: 1 }, "start");
  wlog.warning("deprecated");
  console.log("plain");
  Math.log(2);
  items.error("not a logger");
  try {
    await run(items);
  } catch (err) {
    console.error("failed", err);
    logger.error({ error: err }, "failed");
  }
}
"#,
        ),
        (
            "src/svc.ts",
            r#"
import { Injectable, Logger } from "@nestjs/common";
@Injectable()
export class Svc {
  private readonly logger = new Logger(Svc.name);
  work() {
    this.logger.log("working");
  }
}
"#,
        ),
    ]);
    assert_eq!(
        logs(symbol(file(&r, "src/job.ts"), "run")),
        [
            "global#console.error error catch error",
            "global#console.log log",
            "lib/log.ts#logger.error error catch structured error",
            "lib/log.ts#logger.info info structured",
            "lib/log.ts#wlog.warning warn",
        ]
    );
    assert_eq!(
        logs(symbol(file(&r, "src/svc.ts"), "Svc")),
        ["pkg:@nestjs/common#Logger.log log"]
    );
    // Acquisition needs no new fact: the module logger's calls hold its factory.
    assert_eq!(
        symbol(file(&r, "lib/log.ts"), "logger").calls,
        ["pkg:pino#default"]
    );
    let mut many = String::from("import pino from \"pino\";\n");
    for i in 0..(caps::LOG_CALLS + 8) {
        many.push_str(&format!("export const l{i:02} = pino();\n"));
    }
    many.push_str("export function f() {\n");
    for i in 0..(caps::LOG_CALLS + 8) {
        many.push_str(&format!("  l{i:02}.info(\"x\");\n"));
    }
    many.push_str("}\n");
    let r = repo(&[("m.ts", &many)]);
    assert_eq!(
        symbol(file(&r, "m.ts"), "f").log_calls.len(),
        caps::LOG_CALLS
    );
}

// ------------------------------------------------------------------ 4. inputs

#[test]
fn inputs_name_the_schema_request_input_is_validated_into() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "lib/schemas.ts",
            "import { z } from \"zod\";\nimport * as yup from \"yup\";\nexport const Create = z.object({});\nexport const Update = z.object({});\nexport const YupBody = yup.object({});\nexport const VSchema = {};\nexport class Dto {}\nexport const Config = z.object({});\n",
        ),
        (
            "app/api/a/route.ts",
            r#"
import { Create, Update, Config, VSchema } from "../../../lib/schemas";
import * as v from "valibot";
export async function POST(req: Request) {
  const data = Create.parse(await req.json());
  return Response.json(data);
}
export async function PUT(req: Request) {
  const body = await req.json();
  const res = Update.safeParse(body);
  const cfg = Config.parse({ debug: true });
  const ext = Config.parse(await (await fetch("https://x")).json());
  return Response.json({ res, cfg, ext });
}
export async function PATCH(request: Request) {
  return Response.json(v.parse(VSchema, await request.json()));
}
"#,
        ),
        (
            "server.ts",
            r#"
import express from "express";
import { plainToInstance } from "class-transformer";
import { YupBody, Dto } from "./lib/schemas";
const app = express();
app.post("/a", async (req, res) => {
  await YupBody.validate(req.body);
  const dto = plainToInstance(Dto, req.body);
  res.json(dto);
});
"#,
        ),
        (
            "actions.ts",
            r#"
"use server";
import { actionClient } from "./safe";
import { Create } from "./lib/schemas";
export const createThing = actionClient.schema(Create).action(async ({ parsedInput }) => parsedInput);
"#,
        ),
        ("safe.ts", "export const actionClient: any = {};\n"),
    ]);
    let a = file(&r, "app/api/a/route.ts");
    assert_eq!(symbol(a, "POST").inputs, ["lib/schemas.ts#Create"]);
    // `Config` validates no request input.
    assert_eq!(symbol(a, "PUT").inputs, ["lib/schemas.ts#Update"]);
    assert_eq!(symbol(a, "PATCH").inputs, ["lib/schemas.ts#VSchema"]);
    assert_eq!(
        symbol(file(&r, "server.ts"), "POST /a").inputs,
        ["lib/schemas.ts#Dto", "lib/schemas.ts#YupBody"]
    );
    assert_eq!(
        symbol(file(&r, "actions.ts"), "createThing").inputs,
        ["lib/schemas.ts#Create"]
    );
    let mut many =
        String::from("export async function f(req: Request) {\n  const b = await req.json();\n");
    for i in 0..(caps::INPUTS + 3) {
        many.push_str(&format!("  S{i}.parse(b);\n"));
    }
    many.push_str("}\n");
    for i in 0..(caps::INPUTS + 3) {
        many.push_str(&format!("const S{i}: any = {{}};\n"));
    }
    let r = repo(&[("m.ts", &many)]);
    assert_eq!(symbol(file(&r, "m.ts"), "f").inputs.len(), caps::INPUTS);
}

// ------------------------------------------------------------------ 5. testing facts

#[test]
fn tests_record_requests_statuses_and_mocks() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        ("lib/db.ts", "export const db = {};\n"),
        (
            "app/api/p/route.ts",
            "export async function GET() { return Response.json({}); }\n",
        ),
        (
            "app/api/p/route.test.ts",
            r#"
import { vi, it, expect } from "vitest";
import { GET } from "./route";
vi.mock("../../../lib/db");
vi.mock("next-auth");
it("rejects", async () => {
  const res = await GET();
  expect(res.status).toBe(401);
});
it("works", async () => {
  const res = await GET();
  expect(res.status).toEqual(200);
});
"#,
        ),
        (
            "e2e/api.spec.ts",
            r#"
import request from "supertest";
import { test, expect } from "@playwright/test";
import { http, HttpResponse } from "msw";
import { app } from "../server";
export const handlers = [
  http.get("https://billing.example.com/v1/invoices/:id", () => HttpResponse.json({})),
];
const id = "abc";
test("a", async ({ page }) => {
  await request(app).get(`/api/projects/${id}`).expect(401);
  const res = await fetch("http://localhost:3000/api/hooks", { method: "POST" });
  expect(res.status).toBe(400);
  await page.goto("/dashboard");
});
await request(app).delete("/api/x");
"#,
        ),
        ("server.ts", "export const app = {};\n"),
        (
            "lib/client.ts",
            "import request from \"supertest\";\nexport const r = (app: any) => request(app).get(\"/api/not-a-test\");\n",
        ),
    ]);
    let unit = file(&r, "app/api/p/route.test.ts");
    let reqs: Vec<_> = unit
        .test_requests
        .iter()
        .map(|t| format!("{} {} {} {:?}", t.method, t.route, t.target, t.statuses))
        .collect();
    assert_eq!(
        reqs,
        [
            "GET  app/api/p/route.ts [200]",
            "GET  app/api/p/route.ts [401]"
        ]
    );
    assert_eq!(unit.mocks, ["lib/db.ts", "pkg:next-auth"]);
    let e2e = file(&r, "e2e/api.spec.ts");
    let reqs: Vec<_> = e2e
        .test_requests
        .iter()
        .map(|t| {
            format!(
                "{} {} {:?}{}",
                t.method,
                t.route,
                t.statuses,
                if t.dynamic { " dynamic" } else { "" }
            )
        })
        .collect();
    assert_eq!(
        reqs,
        [
            "DELETE /api/x []",
            "GET /api/projects/[*] [400, 401] dynamic",
            "GET /dashboard [400, 401]",
            "POST /api/hooks [400, 401]",
        ]
    );
    // The direct handler calls are not dynamic: their target is known.
    assert!(unit.test_requests.iter().all(|t| !t.dynamic));
    assert_eq!(e2e.mocks, ["msw:/v1/invoices/[*]"]);
    // Not a test file: no requests.
    assert!(file(&r, "lib/client.ts").test_requests.is_empty());

    let mut many = String::from("import request from \"supertest\";\nconst app = {};\n");
    for i in 0..(caps::TEST_REQUESTS + 10) {
        many.push_str(&format!("request(app).get(\"/r{i:03}\");\n"));
    }
    let r = repo(&[("t/many.test.ts", &many)]);
    assert_eq!(
        file(&r, "t/many.test.ts").test_requests.len(),
        caps::TEST_REQUESTS
    );
}

// ------------------------------------------------------------------ 6. dev_only

#[test]
fn dev_only_lists_dependencies_declared_only_for_development() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "x",
                "dependencies": { "zod": "^3", "react": "^18" },
                "peerDependencies": { "typescript": "^5" },
                "devDependencies": { "vitest": "^2", "zod": "^3", "typescript": "^5", "msw": "^2" } }"#,
        ),
        (
            "packages/a/package.json",
            r#"{ "name": "a", "dependencies": { "pino": "^9" } }"#,
        ),
        ("index.ts", "export const x = 1;\n"),
    ]);
    let root = r.packages.iter().find(|p| p.path.is_empty()).unwrap();
    assert_eq!(root.dev_only, ["msw", "vitest"]);
    let a = r.packages.iter().find(|p| p.path == "packages/a").unwrap();
    assert!(a.dev_only.is_empty());
}

// ------------------------------------------------------------------ 7. structure fixes

#[test]
fn env_reads_through_constants_dicts_and_helpers() {
    let r = repo(&[
        (
            "lib/env.ts",
            r#"
export const env = (k: string) => process.env[k] ?? "";
export function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}
export function notAHelper(name: string) {
  console.log(name);
  return name;
}
"#,
        ),
        (
            "src/config.ts",
            r#"
import { env, requireEnv, notAHelper } from "../lib/env";
const KEY = "DATABASE_URL";
const NAMES = { stripe: "STRIPE_SECRET_KEY" };
export function config() {
  return {
    db: process.env[KEY],
    redis: process.env["REDIS_URL"],
    stripe: process.env[NAMES.stripe],
    token: env("API_TOKEN"),
    secret: requireEnv("JWT_SECRET"),
    label: notAHelper("NOT_AN_ENV"),
    lower: env("lowercase"),
    plain: process.env.PLAIN,
  };
}
"#,
        ),
    ]);
    assert_eq!(
        symbol(file(&r, "src/config.ts"), "config").reads,
        [
            "process.env.API_TOKEN",
            "process.env.DATABASE_URL",
            "process.env.JWT_SECRET",
            "process.env.PLAIN",
            "process.env.REDIS_URL",
            "process.env.STRIPE_SECRET_KEY",
        ]
    );
}

#[test]
fn template_literal_routes_keep_literal_parts() {
    let r = repo(&[
        (
            "server.ts",
            r#"
import express from "express";
import { router } from "./routes";
const base = "svc";
const app = express();
app.get(`/${base}/health`, (req, res) => res.json({}));
app.use(`/${base}/v1`, router);
"#,
        ),
        (
            "routes.ts",
            r#"
import express from "express";
export const router = express.Router();
router.post(`/items/${config.kind}/:id`, (req, res) => res.json({}));
const config = { kind: "a" };
"#,
        ),
    ]);
    let routes = |p: &str| {
        file(&r, p)
            .entry_points
            .iter()
            .map(|e| {
                format!(
                    "{} {}",
                    e.method.as_deref().unwrap_or(""),
                    e.route.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(routes("server.ts"), ["GET /{base}/health"]);
    assert_eq!(routes("routes.ts"), ["POST /{base}/v1/items/{kind}/:id"]);
}

#[test]
fn package_bin_scripts_are_cli_entry_points() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "@acme/tool", "bin": { "acme": "./dist/cli.js", "acme-dev": "./bin/dev.mjs" } }"#,
        ),
        (
            "src/cli.ts",
            "import { run } from \"./run\";\nrun(process.argv);\n",
        ),
        ("bin/dev.mjs", "console.log(\"dev\");\n"),
        ("src/run.ts", "export function run(_: string[]) {}\n"),
        (
            "packages/one/package.json",
            r#"{ "name": "one", "bin": "./index.js" }"#,
        ),
        ("packages/one/index.js", "console.log(1);\n"),
    ]);
    let cli = |p: &str| {
        file(&r, p)
            .entry_points
            .iter()
            .map(|e| {
                format!(
                    "{} {} {}",
                    e.kind,
                    e.symbol,
                    e.route.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(cli("src/cli.ts"), ["cli (module) acme"]);
    assert_eq!(cli("bin/dev.mjs"), ["cli (module) acme-dev"]);
    assert_eq!(cli("packages/one/index.js"), ["cli (module) one"]);
    assert!(cli("src/run.ts").is_empty());
}

#[test]
fn queue_and_stream_handlers_are_consumer_entry_points() {
    let r = repo(&[
        (
            "workers/email.ts",
            r#"
import Queue from "bull";
import { send } from "./send";
const emails = new Queue("emails");
emails.process("welcome", async (job) => {
  await send(job.data);
});
"#,
        ),
        (
            "workers/events.ts",
            r#"
import { Kafka } from "kafkajs";
const consumer = new Kafka({}).consumer({ groupId: "g" });
await consumer.run({ eachMessage: async ({ message }) => { console.log(message); } });
"#,
        ),
        (
            "workers/amqp.ts",
            r#"
import amqp from "amqplib";
const channel: any = await (await amqp.connect("x")).createChannel();
channel.consume("orders", (msg: any) => console.log(msg));
"#,
        ),
        (
            "workers/plain.ts",
            "const q: any = {};\nq.process(async () => {});\n",
        ),
        (
            "workers/send.ts",
            "export async function send(_: unknown) {}\n",
        ),
    ]);
    let entries = |p: &str| {
        file(&r, p)
            .entry_points
            .iter()
            .map(|e| {
                format!(
                    "{} {} {} {}",
                    e.kind,
                    e.adapter,
                    e.symbol,
                    e.route.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        entries("workers/email.ts"),
        ["consumer bull CONSUMER welcome welcome"]
    );
    assert_eq!(
        symbol(file(&r, "workers/email.ts"), "CONSUMER welcome").calls,
        ["workers/send.ts#send"]
    );
    assert_eq!(
        entries("workers/events.ts"),
        ["consumer kafkajs CONSUMER consumer consumer"]
    );
    assert_eq!(
        entries("workers/amqp.ts"),
        ["consumer amqplib CONSUMER orders orders"]
    );
    assert!(entries("workers/plain.ts").is_empty());
}

// ------------------------------------------------------------------ determinism, golden

fn golden_files() -> Vec<(&'static str, &'static str)> {
    vec![
        ("package.json", NEXT_PACKAGE),
        ("app/api/projects/route.ts", AUTH_ROUTE),
        ("lib/auth.ts", AUTH_HELPERS),
        ("lib/db.ts", "export const prisma: any = {};\n"),
        (
            "lib/links.ts",
            "export async function getLink(id: string) { return id; }\n",
        ),
        ("app/links/page.tsx", SIGN_IN_PAGE),
        (
            "middleware.ts",
            "export function middleware() {}\nexport const config = { matcher: [\"/api/(.*)\"] };\n",
        ),
        (
            "app/api/projects/route.test.ts",
            "import { GET } from \"./route\";\nimport { it, expect, vi } from \"vitest\";\nvi.mock(\"../../../lib/db\");\nit(\"x\", async () => { const r = await GET(new Request(\"http://x\")); expect(r.status).toBe(401); });\n",
        ),
    ]
}

#[test]
fn practice_facts_are_identical_across_runs_and_thread_counts() {
    let one = serde_json::to_string(&repo_with(&golden_files(), 1)).unwrap();
    let again = serde_json::to_string(&repo_with(&golden_files(), 1)).unwrap();
    let four = serde_json::to_string(&repo_with(&golden_files(), 4)).unwrap();
    assert_eq!(one, again);
    assert_eq!(one, four);
}

#[test]
fn practice_facts_golden() {
    let r = repo(&golden_files());
    let mut out = serde_json::Map::new();
    for f in &r.files {
        let mut file = serde_json::Map::new();
        for (k, v) in [
            (
                "test_requests",
                serde_json::to_value(&f.test_requests).unwrap(),
            ),
            ("mocks", serde_json::to_value(&f.mocks).unwrap()),
            (
                "route_matchers",
                serde_json::to_value(&f.route_matchers).unwrap(),
            ),
        ] {
            if v.as_array().is_some_and(|a| !a.is_empty()) {
                file.insert(k.into(), v);
            }
        }
        for s in &f.symbols {
            let v = serde_json::to_value(s).unwrap();
            let mut sym = serde_json::Map::new();
            for k in [
                "body_checks",
                "responses",
                "log_calls",
                "catches",
                "headers",
                "inputs",
                "handles_errors",
            ] {
                if let Some(x) = v.get(k) {
                    sym.insert(k.into(), x.clone());
                }
            }
            if !sym.is_empty() {
                file.insert(s.name.clone(), sym.into());
            }
        }
        if !file.is_empty() {
            out.insert(f.path.clone(), file.into());
        }
    }
    insta::assert_snapshot!(
        "practice_facts",
        serde_json::to_string_pretty(&serde_json::Value::Object(out)).unwrap()
    );
}

#[test]
fn response_vias_cover_redirects() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "app/api/r/route.ts",
            r#"
import { NextResponse } from "next/server";
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/login", req.url));
}
"#,
        ),
    ]);
    let s = symbol(file(&r, "app/api/r/route.ts"), "GET");
    assert_eq!(s.responses.len(), 1);
    assert_eq!(s.responses[0].via, ResponseVia::Redirect);
    assert_eq!(s.responses[0].status, 307);
}

// ------------------------------------------------------------------ review additions

#[test]
fn checks_against_env_secrets_and_webhook_verifiers_compare_env() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "lib/stripe.ts",
            "import Stripe from \"stripe\";\nexport const stripe = new Stripe(\"k\");\n",
        ),
        (
            "app/api/cron/route.ts",
            r#"
import { timingSafeEqual } from "node:crypto";
const CRON_SECRET = process.env.CRON_SECRET!;
export async function GET(req: Request) {
  if (req.headers.get("x-api-key") !== process.env.API_KEY) {
    return new Response(null, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const sig = req.headers.get("x-signature") ?? "";
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(process.env.SIGNING_KEY!))) {
    return new Response(null, { status: 401 });
  }
  if (req.headers.get("x-plan") !== "pro") {
    return new Response(null, { status: 401 });
  }
  return Response.json({});
}
"#,
        ),
        (
            "app/api/webhooks/route.ts",
            r#"
import { stripe } from "../../../lib/stripe";
import { Webhook } from "svix";
import { Webhooks } from "@octokit/webhooks";
const gh = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET! });
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    return new Response(null, { status: 400 });
  }
  const wh = new Webhook(process.env.SVIX_SECRET!);
  wh.verify(body, {});
  await gh.verify(body, sig);
  return Response.json({ event });
}
"#,
        ),
    ]);
    assert_eq!(
        checks(symbol(file(&r, "app/api/cron/route.ts"), "GET")),
        [
            "header:authorization  env Unauthenticated",
            "header:x-api-key  env Unauthenticated",
            "header:x-plan  literal Unauthenticated",
            "header:x-signature  env Unauthenticated",
        ]
    );
    let hooks = checks(symbol(file(&r, "app/api/webhooks/route.ts"), "POST"));
    assert_eq!(
        hooks,
        [
            "lib/stripe.ts#stripe.webhooks.constructEvent  env Unauthenticated",
            "pkg:@octokit/webhooks#Webhooks(new).verify  env Unauthenticated",
            "pkg:svix#Webhook(new).verify  env Unauthenticated",
        ]
    );
    // The env names are never echoed in a check.
    assert!(!hooks.iter().any(|c| c.contains("SECRET")));
}

#[test]
fn octokit_verify_on_a_module_binding_is_a_check() {
    let r = repo(&[(
        "src/hooks.ts",
        r#"
import { Webhooks } from "@octokit/webhooks";
export async function handle(body: string, sig: string) {
  const gh = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET! });
  await gh.verify(body, sig);
}
"#,
    )]);
    assert_eq!(
        checks(symbol(file(&r, "src/hooks.ts"), "handle")),
        ["pkg:@octokit/webhooks#Webhooks(new).verify  env Unauthenticated"]
    );
}

#[test]
fn nest_guards_and_public_metadata() {
    let r = repo(&[
        (
            "src/app.module.ts",
            r#"
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtGuard } from "./jwt.guard";
@Module({ providers: [{ provide: APP_GUARD, useClass: JwtGuard }, JwtGuard] })
export class AppModule {}
"#,
        ),
        (
            "src/jwt.guard.ts",
            "export class JwtGuard {}\nexport class RolesGuard {}\n",
        ),
        (
            "src/public.ts",
            "import { SetMetadata } from \"@nestjs/common\";\nexport const IS_PUBLIC = \"isPublic\";\nexport const Public = () => SetMetadata(IS_PUBLIC, true);\n",
        ),
        (
            "src/items.controller.ts",
            r#"
import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { JwtGuard, RolesGuard } from "./jwt.guard";
import { Public } from "./public";
@Controller("items")
@UseGuards(JwtGuard)
export class ItemsController {
  @Get()
  @UseGuards(RolesGuard, AuthGuard("api-key"))
  list() { return []; }
  @Get("open")
  @Public()
  open() { return []; }
}
"#,
        ),
    ]);
    assert_eq!(
        symbol(file(&r, "src/app.module.ts"), "AppModule").decorator_args,
        ["APP_GUARD=src/jwt.guard.ts#JwtGuard"]
    );
    let c = file(&r, "src/items.controller.ts");
    assert_eq!(
        symbol(c, "GET /items").decorator_args,
        [
            "pkg:@nestjs/common#UseGuards=pkg:@nestjs/passport#AuthGuard",
            "pkg:@nestjs/common#UseGuards=src/jwt.guard.ts#JwtGuard",
            "pkg:@nestjs/common#UseGuards=src/jwt.guard.ts#RolesGuard",
        ]
    );
    let open = symbol(c, "GET /items/open");
    assert_eq!(
        open.decorator_args,
        ["pkg:@nestjs/common#UseGuards=src/jwt.guard.ts#JwtGuard"]
    );
    // `@Public()` needs no new fact: the handler's wraps hold the decorator, and its
    // definition calls `SetMetadata`. The metadata key is not echoed.
    assert!(
        open.wraps
            .iter()
            .any(|w| w.wrapper == "src/public.ts#Public")
    );
    assert!(
        symbol(file(&r, "src/public.ts"), "Public")
            .calls
            .iter()
            .any(|c| c == "pkg:@nestjs/common#SetMetadata")
    );
    // The controller class itself carries no `UseGuards=` entry (its handlers do).
    assert!(symbol(c, "ItemsController").decorator_args.is_empty());
}

/// A constant-time compare answers a boolean and refuses no one by itself: it is a
/// check only where its answer decides a refusal, as the condition of a branch that
/// refuses (lowering 73). Its call ignored, logged or bound to a name never tested
/// records no check.
#[test]
fn a_constant_time_compare_is_a_check_only_where_its_answer_refuses() {
    let head = "import { timingSafeEqual } from \"node:crypto\";\nconst secret = Buffer.from(process.env.CRON_SECRET ?? \"\");\nexport async function GET(req: Request) {\n  const given = Buffer.from(req.headers.get(\"authorization\") ?? \"\");\n";
    let tail = "  return Response.json({});\n}\n";
    let cases = [
        (
            "tested",
            "  if (!timingSafeEqual(given, secret)) {\n    return new Response(null, { status: 401 });\n  }\n",
            true,
        ),
        ("ignored", "  timingSafeEqual(given, secret);\n", false),
        (
            "logged",
            "  console.log(timingSafeEqual(given, secret));\n",
            false,
        ),
        (
            "assigned",
            "  const ok = timingSafeEqual(given, secret);\n",
            false,
        ),
    ];
    let mut files: Vec<(String, String)> = vec![("package.json".into(), NEXT_PACKAGE.into())];
    for (name, body, _) in &cases {
        files.push((
            format!("app/api/{name}/route.ts"),
            format!("{head}{body}{tail}"),
        ));
    }
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    let r = repo(&refs);
    for (name, _, checked) in cases {
        let got = checks(symbol(file(&r, &format!("app/api/{name}/route.ts")), "GET"));
        assert_eq!(!got.is_empty(), checked, "{name}: {got:?}");
    }
}

#[test]
fn built_in_conversions_stand_for_what_they_convert() {
    let r = repo(&[(
        "hook.ts",
        r#"
import crypto from "node:crypto";
export async function POST(req: Request) {
  const client = req.headers.get("x-auth-client");
  const expected = process.env.API_KEY;
  if (!expected || !client) return new Response(null, { status: 401 });
  const a = Uint8Array.from(Buffer.from(client));
  const b = Uint8Array.from(Buffer.from(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response(null, { status: 401 });
  }
  return Response.json({});
}
"#,
    )]);
    assert_eq!(
        checks(symbol(file(&r, "hook.ts"), "POST")),
        [
            "header:x-auth-client   Unauthenticated",
            "header:x-auth-client  env Unauthenticated",
            "header:x-auth-client .length env Unauthenticated",
        ]
    );
}

/// The Studio acme fixture's shape: `@Controller` then a class-level
/// `@UseGuards(AuthGuard)` with a local guard class, no method guards. Every handler
/// carries the guard argument; an unguarded controller's handlers carry none.
#[test]
fn class_level_use_guards_reach_every_handler() {
    let ctrl = |n: &str, guarded: bool| {
        format!(
            r#"
import {{ Controller, Get, Param, Post, Body, UseGuards }} from "@nestjs/common";
{imp}import {{ Svc }} from "./svc";

@Controller("{n}")
{deco}export class C {{
  constructor(private readonly service: Svc) {{}}

  @Get(":id")
  get(@Param("id") id: string) {{
    return this.service.get(id);
  }}

  @Post()
  create(@Body() body: Record<string, unknown>) {{
    return this.service.create(body);
  }}
}}
"#,
            imp = if guarded {
                "import { AuthGuard } from \"../common/auth.guard\";\n"
            } else {
                ""
            },
            deco = if guarded {
                "@UseGuards(AuthGuard)\n"
            } else {
                ""
            },
        )
    };
    let alerts = ctrl("alerts", true);
    let releases = ctrl("releases", false);
    let r = repo(&[
        (
            "apps/api/package.json",
            r#"{ "name": "@acme/api", "dependencies": { "@nestjs/common": "10.4.0" } }"#,
        ),
        (
            "apps/api/src/common/auth.guard.ts",
            r#"
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return Boolean(ctx.switchToHttp().getRequest().headers.authorization);
  }
}
"#,
        ),
        ("apps/api/src/alerts/alerts.controller.ts", &alerts),
        ("apps/api/src/alerts/svc.ts", "export class Svc {}\n"),
        ("apps/api/src/releases/releases.controller.ts", &releases),
        ("apps/api/src/releases/svc.ts", "export class Svc {}\n"),
    ]);
    let guarded = file(&r, "apps/api/src/alerts/alerts.controller.ts");
    let handlers: Vec<&Symbol> = guarded
        .symbols
        .iter()
        .filter(|s| guarded.entry_points.iter().any(|e| e.symbol == s.name))
        .collect();
    assert_eq!(handlers.len(), 2);
    for h in handlers {
        assert_eq!(
            h.decorator_args,
            ["pkg:@nestjs/common#UseGuards=apps/api/src/common/auth.guard.ts#AuthGuard"],
            "{}",
            h.name
        );
    }
    let open = file(&r, "apps/api/src/releases/releases.controller.ts");
    assert!(open.symbols.iter().all(|s| s.decorator_args.is_empty()));
    assert_eq!(
        symbol(file(&r, "apps/api/src/common/auth.guard.ts"), "AuthGuard").headers,
        ["authorization"]
    );
}

// ------------------------------------------------------------------ gap round

/// novu's shape: `RequireAuthentication()` returns `applyDecorators(UseGuards(G), ...)`
/// (or another decorator), reached through a barrel; a composition of it adds its
/// guards too. Each handler that uses one carries the guards; classes do not.
#[test]
fn composed_decorators_bring_their_guards_to_each_handler() {
    let r = repo(&[
        (
            "src/auth/auth.decorator.ts",
            r#"
import { applyDecorators, UseGuards } from "@nestjs/common";
import { ApiBearerAuth } from "@nestjs/swagger";
import { CommunityGuard } from "./community.guard";
import { RolesGuard } from "./roles.guard";
export function RequireAuthentication() {
  if (process.env.EE) {
    const { RequireAuthentication: EE } = require("@acme/ee-auth");
    return EE();
  }
  return applyDecorators(UseGuards(CommunityGuard), ApiBearerAuth());
}
export const AdminOnly = () => applyDecorators(RequireAuthentication(), UseGuards(RolesGuard));
export const Documented = () => applyDecorators(ApiBearerAuth());
"#,
        ),
        (
            "src/auth/community.guard.ts",
            "export class CommunityGuard {}\n",
        ),
        ("src/auth/roles.guard.ts", "export class RolesGuard {}\n"),
        ("src/auth/index.ts", "export * from \"./auth.decorator\";\n"),
        (
            "src/items.controller.ts",
            r#"
import { Controller, Get, Post } from "@nestjs/common";
import { RequireAuthentication, AdminOnly, Documented } from "./auth";
@Controller("items")
export class ItemsController {
  @Get()
  @RequireAuthentication()
  list() { return []; }
  @Post()
  @AdminOnly()
  create() { return {}; }
  @Get("docs")
  @Documented()
  docs() { return {}; }
}
@Controller("all")
@RequireAuthentication()
export class AllController {
  @Get()
  list() { return []; }
}
"#,
        ),
    ]);
    let c = file(&r, "src/items.controller.ts");
    let g = |n: &str| symbol(c, n).decorator_args.clone();
    assert_eq!(
        g("GET /items"),
        ["pkg:@nestjs/common#UseGuards=src/auth/community.guard.ts#CommunityGuard"]
    );
    assert_eq!(
        g("POST /items"),
        [
            "pkg:@nestjs/common#UseGuards=src/auth/community.guard.ts#CommunityGuard",
            "pkg:@nestjs/common#UseGuards=src/auth/roles.guard.ts#RolesGuard",
        ]
    );
    assert!(g("GET /items/docs").is_empty());
    assert_eq!(
        g("GET /all"),
        ["pkg:@nestjs/common#UseGuards=src/auth/community.guard.ts#CommunityGuard"]
    );
    assert!(g("AllController").is_empty());
}

#[test]
fn guard_methods_record_whether_they_return_a_non_constant() {
    let r = repo(&[(
        "src/guards.ts",
        r#"
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
@Injectable()
export class KeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    return req.headers["x-key"] === process.env.KEY;
  }
}
@Injectable()
export class OpenGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
export class ArrowGuard {
  canActivate = () => Promise.resolve(true);
  check = (v: string) => v.length > 3;
}
"#,
    )]);
    let f = file(&r, "src/guards.ts");
    let member = |class: &str, m: &str| {
        symbol(f, class)
            .members
            .iter()
            .find(|x| x.name == m)
            .unwrap_or_else(|| panic!("{class}.{m}"))
            .returns_nonconstant_bool
    };
    assert!(member("KeyGuard", "canActivate"));
    assert!(!member("OpenGuard", "canActivate"));
    assert!(!member("ArrowGuard", "canActivate"));
    assert!(member("ArrowGuard", "check"));
}

#[test]
fn documented_statuses_do_not_reject_the_caller() {
    let r = repo(&[(
        "src/docs.ts",
        r#"
import { applyDecorators, UnauthorizedException } from "@nestjs/common";
import { ApiResponse, ApiUnauthorizedResponse } from "@nestjs/swagger";
class ErrorDto {}
export const ApiCommonResponses = () =>
  applyDecorators(ApiResponse(ErrorDto, 401, false), ApiUnauthorizedResponse({ description: "Unauthorized" }));
export function spec() {
  return { responses: { 401: { description: "Unauthorized" } } };
}
export function guard(user: unknown) {
  if (!user) throw new UnauthorizedException("Unauthorized");
}
"#,
    )]);
    let f = file(&r, "src/docs.ts");
    let rejects = |n: &str| symbol(f, n).controls.iter().any(|c| c == "rejects_caller");
    assert!(!rejects("ApiCommonResponses"));
    assert!(!rejects("spec"));
    assert!(rejects("guard"));
    assert!(symbol(f, "ApiCommonResponses").responses.is_empty());
}

#[test]
fn fastify_route_schemas_are_inputs() {
    let r = repo(&[
        (
            "src/routes.ts",
            r#"
import { CreateBody } from "./schemas";
export const register = async (server: any) => {
  server.route({
    method: "POST",
    url: "/items",
    schema: { body: CreateBody, querystring: { type: "object" } },
    handler: async (req: any) => req.body,
  });
  server.route({ method: "GET", url: "/plain", handler: async () => ({}) });
};
"#,
        ),
        ("src/schemas.ts", "export const CreateBody = {};\n"),
    ]);
    let f = file(&r, "src/routes.ts");
    assert_eq!(
        symbol(f, "POST /items").inputs,
        [
            "pkg:fastify#schema.querystring",
            "src/schemas.ts#CreateBody"
        ]
    );
    assert!(symbol(f, "GET /plain").inputs.is_empty());
}

/// infisical's shape: inline plugins registered with a prefix register routers
/// (`server.register(async (v1) => { await v1.register(routes) }, { prefix })`), and
/// routes inside a prefixed inline plugin take its prefix.
#[test]
fn fastify_inline_plugin_prefixes_reach_entry_routes() {
    let r = repo(&[
        (
            "src/index.ts",
            r#"
import { registerV1Routes } from "./v1";
export const main = async (server: any) => {
  await server.register(
    async (v1Server: any) => {
      await v1Server.register(registerV1Routes);
    },
    { prefix: "/api/v1" }
  );
  await server.register(
    async (s: any) => {
      s.route({ method: "GET", url: "/health", handler: async () => ({}) });
    },
    { prefix: "/status" }
  );
};
"#,
        ),
        (
            "src/v1/index.ts",
            r#"
import { registerProjectRouter } from "./project-router";
export const registerV1Routes = async (server: any) => {
  await server.register(
    async (projectRouter: any) => {
      await projectRouter.register(registerProjectRouter);
    },
    { prefix: "/projects" }
  );
};
"#,
        ),
        (
            "src/v1/project-router.ts",
            r#"
export const registerProjectRouter = async (server: any) => {
  server.route({ method: "GET", url: "/:projectId", handler: async () => ({}) });
};
"#,
        ),
    ]);
    let routes = |p: &str| {
        file(&r, p)
            .entry_points
            .iter()
            .map(|e| e.route.clone().unwrap_or_default())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        routes("src/v1/project-router.ts"),
        ["/api/v1/projects/:projectId"]
    );
    assert_eq!(routes("src/index.ts"), ["/status/health"]);
}

// ------------------------------------------------------------------ calls through parameters

/// infisical's shape: a route plugin's `server` parameter, used in the handlers it
/// registers (`server.services.x.y()`), and a parameter typed with an in-repo class.
#[test]
fn calls_through_parameters_are_recorded() {
    let r = repo(&[
        (
            "src/router.ts",
            r#"
import { UsersService } from "./users.service";
type FastifyZodProvider = any;
export const registerRouter = async (server: FastifyZodProvider) => {
  server.route({
    method: "GET",
    url: "/:id",
    handler: async (req: any) => {
      const p = await server.services.project.getProject({ id: req.params.id });
      req.log.info("x");
      return p;
    },
  });
};
export async function list(svc: UsersService, next: () => void, opts: any) {
  next();
  opts.run();
  svc.repo.find();
  svc.get("x").run();
  return svc.all();
}
"#,
        ),
        ("src/users.service.ts", "export class UsersService {}\n"),
    ]);
    let f = file(&r, "src/router.ts");
    let route = symbol(f, "GET /:id");
    assert!(
        route
            .calls
            .iter()
            .any(|c| c == "param:server.services.project.getProject"),
        "{:?}",
        route.calls
    );
    // Request plumbing is the framework's.
    assert!(!route.calls.iter().any(|c| c.starts_with("param:req")));
    let list = symbol(f, "list");
    let params: Vec<&String> = list
        .calls
        .iter()
        .filter(|c| c.starts_with("param:") || c.contains("UsersService"))
        .collect();
    assert_eq!(
        params,
        [
            "param:svc.all",
            "param:svc.get",
            "param:svc.repo.find",
            "src/users.service.ts#UsersService.all",
            "src/users.service.ts#UsersService.get",
            "src/users.service.ts#UsersService.repo.find",
        ]
    );
}

/// `x.onError(arg)` and `x.setErrorHandler(arg)` register an app error handler only
/// when the argument is a handler: a function written in place, or a name bound at
/// module level or imported. Anything else is the call reporting an error to a
/// callback (`callbacks.onError("stream closed")`), which handles nothing.
#[test]
fn only_a_handler_argument_registers_an_error_handler() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "hono": "4.0.0", "fastify": "5.0.0" } }"#,
        ),
        (
            "src/errors.ts",
            r#"
export function handleError(err: Error, req: any, reply: any) {
  reply.status(500).send({ error: err.message });
}
"#,
        ),
        (
            "src/app.ts",
            r#"
import { Hono } from "hono";
import Fastify from "fastify";
import { handleError } from "./errors";

function localHandler(err: Error, req: any, reply: any) {
  reply.status(500).send({ error: err.message });
}

export function arrow() {
  const app = new Hono();
  app.onError((err, c) => c.json({ error: err.message }, 500));
  return app;
}

export function functionExpression() {
  const app = new Hono();
  app.onError(function (err, c) {
    return c.json({ error: err.message }, 500);
  });
  return app;
}

export function importedName() {
  const server = Fastify();
  server.setErrorHandler(handleError);
  return server;
}

export function moduleLevelName() {
  const server = Fastify();
  server.setErrorHandler(localHandler);
  return server;
}

type Callbacks = { onError: (e?: unknown) => void; setErrorHandler: (e: unknown) => void };

export function startSimulationStream(callbacks: Callbacks) {
  callbacks.onError("stream closed");
}

export function reportsAnObject(callbacks: Callbacks) {
  callbacks.onError({ message: "stream closed" });
}

export function reportsANumber(callbacks: Callbacks) {
  callbacks.setErrorHandler(500);
}

export function reportsNothing(callbacks: Callbacks) {
  callbacks.onError();
}

export function reportsANewError(callbacks: Callbacks) {
  callbacks.onError(new Error("stream closed"));
}

export function reportsTheCaughtError(callbacks: Callbacks) {
  try {
    JSON.parse("{");
  } catch (err) {
    callbacks.onError(err);
  }
}
"#,
        ),
        (
            "src/top.ts",
            r#"
import { Hono } from "hono";
export const app = new Hono();
app.onError((err, c) => c.json({ error: err.message }, 500));
"#,
        ),
        (
            "src/stream.ts",
            r#"
declare const stream: { onError: (e: unknown) => void };
stream.onError("closed");
export const started = true;
"#,
        ),
    ]);
    // The symbols of a file that handle errors, with what they handle.
    let handlers = |path: &str| -> Vec<(String, Vec<String>)> {
        let mut out: Vec<(String, Vec<String>)> = file(&r, path)
            .symbols
            .iter()
            .filter(|s| !s.handles_errors.is_empty())
            .map(|s| (s.name.clone(), s.handles_errors.clone()))
            .collect();
        out.sort();
        out
    };
    let any = |name: &str| (name.to_string(), vec!["*".to_string()]);
    // The four that register. `startSimulationStream` and the five `reports...`
    // functions hand `onError` or `setErrorHandler` something that is no handler.
    assert_eq!(
        handlers("src/app.ts"),
        [
            any("arrow"),
            any("functionExpression"),
            any("importedName"),
            any("moduleLevelName"),
        ]
    );
    // At module level too: the registration is the module's, the report is no one's.
    assert_eq!(handlers("src/top.ts"), [any("(module)")]);
    assert_eq!(handlers("src/stream.ts"), []);
}

/// A method of a local, or of a parameter whose type names no class, is not recorded:
/// the body that hands it a value says so ([`drift_core::controls::UNREAD_CALL`]). An
/// imported function's call is recorded, and a call given nothing, a literal or a
/// callback written in place hands nothing on.
#[test]
fn a_value_handed_to_a_call_the_facts_do_not_record_is_said() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "lib/store.ts",
            "export function load(key: string) {\n  return key;\n}\n",
        ),
        (
            "lib/x.ts",
            "import { load } from \"./store\";\n\nexport function untyped(exporter: any, key: string) {\n  return exporter.run(key);\n}\n\nexport function local(key: string) {\n  const rows: string[] = [];\n  rows.push(key);\n  return rows;\n}\n\nexport function named(key: string) {\n  return load(key);\n}\n\nexport function literal(exporter: any, rows: any) {\n  exporter.flush();\n  rows.get(\"k\");\n  return rows.map((r: any) => r.id);\n}\n",
        ),
    ]);
    let f = file(&r, "lib/x.ts");
    let unread = |name: &str| {
        symbol(f, name)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::UNREAD_CALL)
    };
    for name in ["untyped", "local"] {
        assert!(unread(name), "{name}: {:?}", symbol(f, name).controls);
    }
    for name in ["named", "literal"] {
        assert!(!unread(name), "{name}: {:?}", symbol(f, name).controls);
    }
}

/// A check records how its condition compares ([`drift_core::check_op`]): whether the
/// caller is turned away where the two values differ or where they match, through `!`
/// and through the `else` that rejects, also where the other value could not be read;
/// nothing for a test of the value itself.
#[test]
fn a_check_records_which_way_its_comparison_refuses() {
    let route = |name: &str, check: &str| {
        (
            format!("app/api/{name}/route.ts"),
            format!(
                "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getSession }} from \"../../../lib/session\";\n\nexport async function GET(req: NextRequest) {{\n  const session = await getSession();\n  const row = await load(req);\n{check}\n  return NextResponse.json({{ ok: true }});\n}}\n\nasync function load(req: NextRequest) {{\n  return {{ orgId: req.nextUrl.pathname }};\n}}\n"
            ),
        )
    };
    let forbid = "return NextResponse.json({ error: \"Forbidden\" }, { status: 403 });";
    let cases = [
        (
            "differs",
            format!("  if (session.orgId !== row.orgId) {{\n    {forbid}\n  }}"),
            "ne",
        ),
        (
            "matches",
            format!("  if (session.orgId === row.orgId) {{\n    {forbid}\n  }}"),
            "eq",
        ),
        (
            "negated",
            format!("  if (!(session.orgId === row.orgId)) {{\n    {forbid}\n  }}"),
            "ne",
        ),
        (
            "otherwise",
            format!(
                "  if (session.orgId === row.orgId) {{\n    console.info(\"ok\");\n  }} else {{\n    {forbid}\n  }}"
            ),
            "ne",
        ),
        (
            "asked",
            format!("  if (!session.orgId) {{\n    {forbid}\n  }}"),
            "",
        ),
        (
            "nothing",
            format!("  if (session.orgId === null) {{\n    {forbid}\n  }}"),
            "",
        ),
    ];
    let mut files: Vec<(String, String)> = vec![
        ("package.json".into(), NEXT_PACKAGE.into()),
        (
            "lib/session.ts".into(),
            "export async function getSession(): Promise<{ orgId: string }> {\n  return { orgId: \"o\" };\n}\n".into(),
        ),
    ];
    files.extend(cases.iter().map(|(name, check, _)| route(name, check)));
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    let r = repo(&borrowed);
    for (name, _, op) in &cases {
        let get = symbol(file(&r, &format!("app/api/{name}/route.ts")), "GET");
        let forbidden: Vec<&drift_core::BodyCheck> = get
            .body_checks
            .iter()
            .filter(|c| c.outcome == drift_core::CheckOutcome::Forbidden)
            .collect();
        assert_eq!(forbidden.len(), 1, "{name}: {:?}", get.body_checks);
        assert_eq!(forbidden[0].op, *op, "{name}: {:?}", forbidden[0]);
        assert_eq!(forbidden[0].reads, ".orgId", "{name}");
    }
}

/// A check inside a branch only some requests take is recorded as conditional
/// ([`drift_core::BodyCheck::conditional`]): under another `if`, in the `else` of a
/// branch that goes on, in the `else` of a branch that returns an answer (the
/// requests it served are not checked; TS `LOWERING_VERSION` 54), in a loop or a
/// `switch` case. One in the `else` of a branch that turns its own requests away,
/// or in a `try`, is not.
#[test]
fn a_check_under_another_branch_is_conditional() {
    let forbid = "return NextResponse.json({ error: \"Forbidden\" }, { status: 403 });";
    let check = format!("if (session.orgId !== row.orgId) {{ {forbid} }}");
    let cases = [
        (
            "flat",
            format!(
                "  if (!row) {{ return NextResponse.json({{}}, {{ status: 400 }}); }}\n  try {{\n    {check}\n  }} catch {{}}"
            ),
            false,
        ),
        (
            "nested",
            format!("  if (req.method !== \"GET\") {{\n    {check}\n  }}"),
            true,
        ),
        (
            "otherwise",
            format!(
                "  if (req.method === \"GET\") {{\n    console.info(\"read\");\n  }} else {{\n    {check}\n  }}"
            ),
            true,
        ),
        (
            "after",
            format!(
                "  if (req.method === \"GET\") {{\n    return NextResponse.json({{ ok: true }});\n  }} else {{\n    {check}\n  }}"
            ),
            true,
        ),
        (
            "refused",
            format!(
                "  if (!row) {{\n    return NextResponse.json({{}}, {{ status: 400 }});\n  }} else {{\n    {check}\n  }}"
            ),
            false,
        ),
        (
            "looped",
            format!(
                "  for (const id of [row.orgId]) {{\n    if (session.orgId !== id) {{ {forbid} }}\n  }}"
            ),
            true,
        ),
        (
            "switched",
            format!("  switch (req.method) {{\n    case \"POST\":\n      {check}\n  }}"),
            true,
        ),
    ];
    let mut files: Vec<(String, String)> = vec![
        ("package.json".into(), NEXT_PACKAGE.into()),
        (
            "lib/session.ts".into(),
            "export async function getSession(): Promise<{ orgId: string }> {\n  return { orgId: \"o\" };\n}\n".into(),
        ),
    ];
    for (name, body, _) in &cases {
        files.push((
            format!("app/api/{name}/route.ts"),
            format!(
                "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getSession }} from \"../../../lib/session\";\n\nexport async function POST(req: NextRequest) {{\n  const session = await getSession();\n  const row = await load(req);\n{body}\n  return NextResponse.json({{ ok: true }});\n}}\n\nasync function load(req: NextRequest) {{\n  return {{ orgId: req.nextUrl.pathname }};\n}}\n"
            ),
        ));
    }
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    let r = repo(&borrowed);
    for (name, _, conditional) in &cases {
        let post = symbol(file(&r, &format!("app/api/{name}/route.ts")), "POST");
        let forbidden: Vec<&drift_core::BodyCheck> = post
            .body_checks
            .iter()
            .filter(|c| c.outcome == drift_core::CheckOutcome::Forbidden)
            .collect();
        assert_eq!(forbidden.len(), 1, "{name}: {:?}", post.body_checks);
        assert_eq!(forbidden[0].conditional, *conditional, "{name}");
    }
}

/// A call the body makes only for some requests, or whose promise it drops, is a
/// conditional call (TS `LOWERING_VERSION` 50): under a branch, as the right side of
/// `&&`, after a branch that returns (a bare `return;` too), as a statement of its own
/// or under `void` where the callee is `async`. A callee the body also calls on every
/// path is not listed, nor is a dropped call of a function that is not `async`, nor a
/// package's call unless it is a policy library's.
#[test]
fn a_call_only_some_requests_make_is_a_conditional_call() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0", "@casl/ability": "6.0.0" } }"#,
        ),
        (
            "lib/access.ts",
            r#"export function assertSame(a: string, b: string): void {
  if (a === "") return;
  if (a !== b) throw new Error("forbidden");
}
export async function assertAsync(a: string, b: string) {
  if (a !== b) throw new Error("forbidden");
}
export const assertArrow = async (a: string, b: string) => {
  if (a !== b) throw new Error("forbidden");
};
export function assertPromised(a: string, b: string): Promise<void> {
  return assertAsync(a, b);
}
export class Access {
  async check(a: string) {
    assertSame(a, "x");
  }
  plain(a: string) {
    if (a) assertSame(a, "x");
  }
}
"#,
        ),
        (
            "lib/handlers.ts",
            r#"import { ForbiddenError } from "@casl/ability";
import { assertArrow, assertAsync, assertPromised, assertSame } from "./access";

export async function branch(a: string, b: string) {
  if (a) {
    assertSame(a, b);
  }
}
export async function both(a: string, b: string) {
  if (a) assertSame(a, b);
  assertSame(a, b);
}
export async function shortCircuit(a: string, b: string) {
  a && assertSame(a, b);
}
export async function afterReturn(a: string, b: string) {
  if (a === "preview") return;
  assertSame(a, b);
}
export async function dropped(a: string, b: string) {
  assertAsync(a, b);
  void assertArrow(a, b);
  assertPromised(a, b).catch(() => {});
  assertSame(a, b);
}
export async function awaited(a: string, b: string) {
  await assertAsync(a, b);
  const pending = assertArrow(a, b);
  await pending;
  return assertPromised(a, b);
}
export async function policy(ability: unknown, a: string) {
  if (a) ForbiddenError.from(ability).throwUnlessCan("read", "Rule");
  console.log(a);
}
"#,
        ),
    ]);
    let f = file(&r, "lib/handlers.ts");
    let conditional = |name: &str| symbol(f, name).conditional_calls.clone();
    assert_eq!(
        conditional("branch"),
        ["under_branch:lib/access.ts#assertSame"]
    );
    assert!(conditional("both").is_empty(), "{:?}", conditional("both"));
    assert_eq!(
        conditional("shortCircuit"),
        ["under_branch:lib/access.ts#assertSame"]
    );
    assert_eq!(
        conditional("afterReturn"),
        ["after_conditional_return:lib/access.ts#assertSame"]
    );
    assert_eq!(
        conditional("dropped"),
        [
            "not_awaited:lib/access.ts#assertArrow",
            "not_awaited:lib/access.ts#assertAsync",
            "not_awaited:lib/access.ts#assertPromised"
        ]
    );
    assert!(
        conditional("awaited").is_empty(),
        "{:?}",
        conditional("awaited")
    );
    assert_eq!(
        conditional("policy"),
        [
            "under_branch:pkg:@casl/ability#ForbiddenError.from",
            "under_branch:pkg:@casl/ability#ForbiddenError.from().throwUnlessCan"
        ]
    );
    let a = file(&r, "lib/access.ts");
    for (name, is_async) in [
        ("assertSame", false),
        ("assertAsync", true),
        ("assertArrow", true),
        ("assertPromised", true),
    ] {
        assert_eq!(symbol(a, name).is_async, is_async, "{name}");
    }
    // The helper's own check follows a bare `return;`.
    let same = &symbol(a, "assertSame").body_checks;
    assert!(
        same.iter()
            .all(|c| c.conditional && c.condition == "after_conditional_return"),
        "{same:?}"
    );
    let access = symbol(a, "Access");
    let member = |name: &str| access.members.iter().find(|m| m.name == name).unwrap();
    assert!(member("check").is_async && !member("plain").is_async);
    assert!(member("check").conditional_calls.is_empty());
    assert_eq!(
        member("plain").conditional_calls,
        ["under_branch:lib/access.ts#assertSame"]
    );
}

/// A check records what the body calls before it (`after`, TS `LOWERING_VERSION` 50):
/// each callee once, in the order of its first call, without the calls of the
/// condition itself.
#[test]
fn a_check_records_what_the_body_calls_before_it() {
    let r = repo(&[
        ("package.json", NEXT_PACKAGE),
        (
            "lib/store.ts",
            "export async function loadRule(id: string) {\n  return { id, orgId: \"o\" };\n}\nexport async function deleteRule(id: string) {\n  return id;\n}\nexport async function getSession() {\n  return { orgId: \"o\" };\n}\n",
        ),
        (
            "app/api/rules/[id]/route.ts",
            r#"import { NextResponse } from "next/server";
import { deleteRule, getSession, loadRule } from "../../../../lib/store";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await loadRule(params.id);
  await deleteRule(rule.id);
  if (rule.orgId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return new NextResponse(null, { status: 204 });
}
"#,
        ),
    ]);
    let s = symbol(file(&r, "app/api/rules/[id]/route.ts"), "DELETE");
    let after = |outcome: CheckOutcome| -> Vec<String> {
        s.body_checks
            .iter()
            .find(|c| c.outcome == outcome)
            .unwrap_or_else(|| panic!("{:?}", s.body_checks))
            .after
            .clone()
    };
    assert_eq!(
        after(CheckOutcome::Unauthenticated),
        ["lib/store.ts#getSession"]
    );
    assert_eq!(
        after(CheckOutcome::Forbidden),
        [
            "lib/store.ts#getSession",
            "pkg:next/server#NextResponse.json",
            "lib/store.ts#loadRule",
            "lib/store.ts#deleteRule"
        ]
    );
}

/// A middleware or a hook written in place is a symbol of its own that mining does
/// not read (TS `LOWERING_VERSION` 51): the file's `symbols` are what they were, the
/// listed reading holds the function, and the routes registered after it name it in
/// `app_middleware`, which is no wrap.
#[test]
fn a_middleware_written_in_place_is_listed_and_not_mined() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "express": "4.19.0" } }"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
const app = express();
app.get("/before", (req, res) => { res.json({}); });
app.use((req, res, next) => {
  if (!req.headers.authorization) return res.status(401).end();
  next();
});
app.get("/after", (req, res) => { res.json({}); });
"#,
        ),
    ]);
    let f = file(&r, "src/server.ts");
    assert!(
        !names(f).iter().any(|n| n.starts_with("app use")),
        "{:?}",
        names(f)
    );
    assert!(symbol(f, "GET /before").app_middleware.is_empty());
    assert_eq!(
        symbol(f, "GET /after").app_middleware,
        ["src/server.ts#app use 4"]
    );
    assert!(symbol(f, "GET /after").wraps.is_empty());
    let listed = f.listed.as_ref().expect("a listed reading");
    assert_eq!(listed.entry_points, f.entry_points);
    let hook = listed
        .symbols
        .iter()
        .find(|s| s.name == "app use 4")
        .expect("the middleware");
    assert_eq!(
        checks(hook),
        ["param:req .headers.authorization  Unauthenticated"]
    );
}
