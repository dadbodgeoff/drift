// A synthetic multi-package TypeScript monorepo ("acme") for Drift Studio's
// fixtures. Everything here is written for this project (Apache-2.0); the
// `examples/` directory is a copy of Drift's own parser test fixtures
// (crates/drift-ts/tests/fixtures), also ours.
//
// The repo is deterministic and shaped so that Drift learns real conventions
// with a few deliberate outliers: auth wrappers on API routes, a safe-action
// client for server actions, a page shell, an email footer, NestJS guards and
// base classes, a layering boundary (packages/ui must not import apps/web), a
// hook naming scheme, and a handful of risky operations and client leaks.
//
//   import { writeSynthRepo } from "./synth-repo.mjs"; writeSynthRepo(dir, driftRepoRoot)

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const RESOURCES = [
  "links", "domains", "tags", "folders", "webhooks", "tokens", "members", "invites", "billing", "usage",
  "events", "exports", "imports", "audit", "integrations", "customers", "campaigns", "segments", "reports", "alerts",
  "notes", "files", "projects", "teams", "roles", "keys", "quotas", "limits", "settings", "branding",
  "sessions", "devices", "regions", "channels", "rules", "budgets",
];
const ADMIN = ["users", "workspaces", "flags", "jobs", "metrics", "abuse", "refunds", "payouts", "plans", "impersonate", "audit", "health", "cache", "queues", "regions", "invoices", "exports", "emails", "domains", "sso"];
const ACTIONS = [
  "create-link", "update-link", "delete-link", "archive-link", "create-tag", "rename-tag", "invite-member", "remove-member",
  "update-billing", "cancel-plan", "create-webhook", "rotate-token", "create-folder", "move-folder", "update-branding",
  "export-events", "create-campaign", "pause-campaign", "ban-customer",
];
const PAGES = [
  "overview", "links", "analytics", "domains", "tags", "folders", "webhooks", "tokens", "members", "billing",
  "usage", "events", "exports", "integrations", "customers", "campaigns", "segments", "reports", "alerts", "settings", "onboarding",
];
const EMAILS = ["welcome", "invite", "password-reset", "usage-limit", "invoice", "trial-ending", "weekly-report", "domain-verified", "webhook-failed", "export-ready", "member-joined", "plan-changed", "security-alert", "payout-sent", "payout-failed", "login-code", "new-device", "report-shared", "comment-added", "mention", "digest", "renewal", "goodbye"];
const NEST = ["users", "teams", "billing", "projects", "invoices", "reports", "files", "comments", "labels", "milestones", "releases", "deployments", "secrets", "environments", "audits", "notifications", "webhooks", "tokens", "sessions", "regions", "quotas", "alerts", "pipelines", "artifacts"];
const UI = [
  "button", "card", "badge", "dialog", "drawer", "tooltip", "popover", "menu", "tabs", "table", "input", "select", "checkbox",
  "switch", "radio", "avatar", "spinner", "skeleton", "toast", "alert", "breadcrumbs", "pagination", "progress", "slider",
  "stat", "chart-frame", "empty-state", "kbd", "code-block", "split-pane", "tag", "toolbar",
];
const HOOKS = ["use-workspace", "use-links", "use-domains", "use-tags", "use-folders", "use-members", "use-billing", "use-usage", "use-events", "use-session", "use-flags", "use-media-query", "use-debounce", "use-clipboard", "use-keyboard", "use-local-storage", "use-domains-count", "use-invites", "use-tokens", "use-webhooks", "use-exports", "use-plan"];

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(s).replace(/^[a-z]/, (c) => c.toUpperCase());

export function writeSynthRepo(root, driftRoot) {
  const w = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body.replace(/^\n/, ""));
  };

  w("package.json", JSON.stringify({ name: "acme", private: true, workspaces: ["apps/*", "packages/*"] }, null, 2) + "\n");
  w("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler", jsx: "react-jsx" } }, null, 2) + "\n");

  // ---------- packages/db ----------
  w("packages/db/package.json", JSON.stringify({ name: "@acme/db", version: "0.0.0", main: "src/index.ts", dependencies: { "@prisma/client": "5.22.0" } }, null, 2) + "\n");
  w("packages/db/src/client.ts", `
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();
`);
  w("packages/db/src/index.ts", `
export { db } from "./client";
export type { Prisma } from "@prisma/client";
`);
  w("packages/db/prisma/schema.prisma", `
model Link {
  id          String   @id
  workspaceId String
  url         String
  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Workspace {
  id        String   @id
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Member {
  id          String   @id
  workspaceId String
  userId      String
  role        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
`);

  // ---------- packages/utils ----------
  w("packages/utils/package.json", JSON.stringify({ name: "@acme/utils", version: "0.0.0", main: "src/index.ts" }, null, 2) + "\n");
  w("packages/utils/src/index.ts", `
export { formatNumber, formatDate } from "./format";
export { slugify } from "./slug";
export { fingerprint } from "./hash";
`);
  w("packages/utils/src/format.ts", `
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
`);
  w("packages/utils/src/slug.ts", `
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
`);
  w("packages/utils/src/hash.ts", `
import { createHash } from "crypto";

// Not for security: a short cache key.
export function fingerprint(s: string): string {
  return createHash("md5").update(s).digest("hex").slice(0, 8);
}
`);

  // ---------- packages/ui (must not import apps/web) ----------
  w("packages/ui/package.json", JSON.stringify({ name: "@acme/ui", version: "0.0.0", main: "src/index.tsx", dependencies: { react: "19.0.0" } }, null, 2) + "\n");
  w("packages/ui/src/index.tsx", UI.map((u) => `export { ${pascal(u)} } from "./${u}";`).join("\n") + "\n");
  UI.forEach((u, i) => {
    const leaky = u === "stat"; // the layering outlier: reaches into the app
    w(
      `packages/ui/src/${u}.tsx`,
      `
import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";
${leaky ? 'import { currentPlan } from "../../../apps/web/lib/plan";\n' : ""}
export function ${pascal(u)}({ children, value = ${i} }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-${u}" data-value={formatNumber(value)}>
      ${leaky ? "{currentPlan()}" : ""}{children}
    </div>
  );
}
`,
    );
  });

  const ICONS = "arrow check chevron close copy download edit external eye filter flag folder globe heart home info link lock mail menu minus plus search settings star trash upload user".split(" ");
  ICONS.forEach((n) =>
    w(
      `packages/ui/src/icons/${n}.tsx`,
      `
export function ${pascal(n)}Icon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" />;
}
`,
    ),
  );

  // ---------- packages/emails ----------
  w("packages/emails/package.json", JSON.stringify({ name: "@acme/emails", version: "0.0.0", main: "src/index.ts" }, null, 2) + "\n");
  w("packages/emails/src/components/footer.tsx", `
export function Footer({ unsubscribe }: { unsubscribe?: string }) {
  return <footer>Acme Inc. {unsubscribe ? <a href={unsubscribe}>Unsubscribe</a> : null}</footer>;
}
`);
  w("packages/emails/src/components/layout.tsx", `
import type { ReactNode } from "react";

export function EmailLayout({ children }: { children: ReactNode }) {
  return <html><body>{children}</body></html>;
}
`);
  EMAILS.forEach((e) => {
    const outlier = e === "goodbye";
    w(
      `packages/emails/src/templates/${e}.tsx`,
      `
import { EmailLayout } from "../components/layout";
${outlier ? "" : 'import { Footer } from "../components/footer";\n'}
export default function ${pascal(e)}Email({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the ${e.replace(/-/g, " ")} email.</p>
      ${outlier ? "" : "<Footer />"}
    </EmailLayout>
  );
}
`,
    );
  });

  // ---------- apps/web (Next.js) ----------
  w("apps/web/package.json", JSON.stringify({ name: "@acme/web", version: "0.0.0", private: true, dependencies: { next: "15.0.0", react: "19.0.0", zod: "3.23.8", "next-safe-action": "7.9.0", "@acme/db": "0.0.0", "@acme/ui": "0.0.0", "@acme/utils": "0.0.0", "@acme/emails": "0.0.0" } }, null, 2) + "\n");
  w("apps/web/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2) + "\n");
  w("apps/web/lib/auth.ts", `
import { db } from "@acme/db";

type Handler = (req: Request, ctx: { workspaceId: string; userId: string }) => Promise<Response>;

export function withWorkspace(handler: Handler, opts: { requiredPermissions?: string[] } = {}) {
  return async (req: Request) => {
    const session = await getSession(req);
    const member = await db.member.findFirst({ where: { userId: session.userId } });
    if (!member) return new Response("Forbidden", { status: 403 });
    if (opts.requiredPermissions?.length && member.role !== "owner") return new Response("Forbidden", { status: 403 });
    return handler(req, { workspaceId: member.workspaceId, userId: session.userId });
  };
}

export function withAdmin(handler: Handler) {
  return async (req: Request) => {
    const session = await getSession(req);
    if (!session.admin) return new Response("Not found", { status: 404 });
    return handler(req, { workspaceId: "", userId: session.userId });
  };
}

export async function getSession(req: Request): Promise<{ userId: string; admin: boolean }> {
  const token = req.headers.get("authorization") ?? "";
  if (!token) throw new Response("Unauthorized", { status: 401 });
  return { userId: token.slice(7), admin: token.endsWith(":admin") };
}
`);
  w("apps/web/lib/plan.ts", `
export function currentPlan(): string {
  return "pro";
}
`);
  w("apps/web/lib/analytics.ts", `
import { db } from "@acme/db";

export async function eventsFor(workspaceId: string, groupBy: string) {
  return db.$queryRawUnsafe(\`SELECT \${groupBy}, count(*) FROM events WHERE workspace_id = '\${workspaceId}' GROUP BY 1\`);
}
`);
  w("apps/web/lib/actions/safe-action.ts", `
import { createSafeActionClient } from "next-safe-action";
import { getSession } from "../auth";

export const actionClient = createSafeActionClient();

export const authActionClient = actionClient.use(async ({ next }) => {
  const session = await getSession(new Request("http://internal"));
  return next({ ctx: { userId: session.userId } });
});
`);
  w("apps/web/lib/zod.ts", `
import { z } from "zod";

export const idSchema = z.object({ workspaceId: z.string(), id: z.string().optional(), name: z.string().optional() });
`);
  ACTIONS.forEach((a) => {
    const outlier = a === "ban-customer";
    w(
      `apps/web/lib/actions/${a}.ts`,
      outlier
        ? `
"use server";

import { db } from "@acme/db";

export async function banCustomer(workspaceId: string, id: string) {
  await db.member.delete({ where: { id, workspaceId } });
}
`
        : `
"use server";

import { db } from "@acme/db";
import { idSchema } from "../zod";
import { authActionClient } from "./safe-action";

export const ${camel(a)}Action = authActionClient
  .inputSchema(idSchema)
  .action(async ({ parsedInput }) => {
    await db.link.findMany({ where: { workspaceId: parsedInput.workspaceId } });
    return { ok: true };
  });
`,
    );
  });
  RESOURCES.forEach((r, i) => {
    const outlier = r === "invites" || r === "regions";
    const permissions = i % 3 === 0 ? `, { requiredPermissions: ["${r}.write"] }` : "";
    w(
      `apps/web/app/api/workspaces/[id]/${r}/route.ts`,
      outlier
        ? `
import { db } from "@acme/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return NextResponse.json(await db.link.findMany({ where: { workspaceId: id } }));
}
`
        : `
import { db } from "@acme/db";
import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/auth";

export const GET = withWorkspace(async (req, { workspaceId }) => {
  const rows = await db.link.findMany({ where: { workspaceId, archived: false } });
  return NextResponse.json(rows);
});

export const POST = withWorkspace(async (req, { workspaceId }) => {
  const body = await req.json();
  return NextResponse.json(await db.link.create({ data: { ...body, workspaceId } }));
}${permissions});
`,
    );
  });
  ADMIN.forEach((a) => {
    const outlier = a === "health";
    const analytics = a === "metrics";
    w(
      `apps/web/app/api/admin/${a}/route.ts`,
      outlier
        ? `
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true });
}
`
        : `
import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth";
${analytics ? 'import { eventsFor } from "@/lib/analytics";\n' : ""}
export const GET = withAdmin(async (req) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(${analytics ? 'await eventsFor(q.get("workspace") ?? "", q.get("by") ?? "day")' : `{ ${camel(a)}: q.get("page") }`});
});
`,
    );
  });
  w("apps/web/app/api/public/preview/route.ts", `
import { NextResponse } from "next/server";

// Fetches a page title for link previews.
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url") ?? "";
  const html = await (await fetch(target)).text();
  return NextResponse.json({ title: html.match(/<title>(.*?)<\\/title>/)?.[1] ?? null });
}
`);
  w("apps/web/app/api/public/status/route.ts", `
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
`);
  w("apps/web/app/api/oauth/callback/route.ts", `
import { redirect } from "next/navigation";

export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next") ?? "/";
  redirect(next);
}
`);
  w("apps/web/components/page-shell.tsx", `
import type { ReactNode } from "react";
import { Card } from "@acme/ui";

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      <Card>{children}</Card>
    </main>
  );
}
`);
  PAGES.forEach((p) => {
    const outlier = p === "onboarding";
    w(
      `apps/web/app/(dashboard)/[slug]/${p}/page.tsx`,
      `
import { ${outlier ? "Card" : "Stat"} } from "@acme/ui";
${outlier ? "" : 'import { PageShell } from "@/components/page-shell";\n'}
export default async function ${pascal(p)}Page() {
  return (
    ${outlier ? `<Card>${pascal(p)}</Card>` : `<PageShell title="${pascal(p)}">\n      <Stat value={1} />\n    </PageShell>`}
  );
}
`,
    );
  });
  // Client components; one leaks the database client, one a secret.
  const CLIENT = ["link-table", "domain-form", "tag-picker", "folder-tree", "member-list", "billing-card", "usage-chart", "event-feed", "export-dialog", "webhook-form", "token-row", "plan-badge"];
  CLIENT.forEach((c) => {
    const leaksDb = c === "usage-chart";
    const leaksEnv = c === "billing-card";
    w(
      `apps/web/components/${c}.tsx`,
      `
"use client";

import { useState } from "react";
import { Button, Table } from "@acme/ui";
${leaksDb ? 'import { db } from "@acme/db";\n' : ""}import { useWorkspace } from "@/hooks/use-workspace";

export function ${pascal(c)}() {
  const [open, setOpen] = useState(false);
  const ws = useWorkspace();
  ${leaksEnv ? "const key = process.env.STRIPE_SECRET_KEY;\n  " : ""}${leaksDb ? "void db;\n  " : ""}return (
    <Table>
      <Button onClick={() => setOpen(!open)}>{ws.slug}</Button>
    </Table>
  );
}
`,
    );
  });
  HOOKS.forEach((h) => {
    const outlier = h === "use-keyboard";
    const name = outlier ? "keyboardShortcuts" : camel(h);
    w(
      `apps/web/hooks/${h}.ts`,
      `
import { useEffect, useState } from "react";

export function ${name}() {
  const [value, setValue] = useState({ slug: "acme" });
  useEffect(() => {
    setValue((v) => ({ ...v }));
  }, []);
  return value;
}
`,
    );
  });

  // ---------- apps/api (NestJS) ----------
  w("apps/api/package.json", JSON.stringify({ name: "@acme/api", version: "0.0.0", private: true, dependencies: { "@nestjs/common": "10.4.0", "@nestjs/core": "10.4.0", "@acme/db": "0.0.0" } }, null, 2) + "\n");
  w("apps/api/src/common/auth.guard.ts", `
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return Boolean(ctx.switchToHttp().getRequest().headers.authorization);
  }
}
`);
  w("apps/api/src/common/base.service.ts", `
import { db } from "@acme/db";

export abstract class BaseService {
  protected readonly db = db;

  protected log(message: string) {
    console.log(\`[\${this.constructor.name}] \${message}\`);
  }
}
`);
  NEST.forEach((n) => {
    const unguarded = n === "releases";
    const plainService = n === "audits";
    w(
      `apps/api/src/${n}/${n}.controller.ts`,
      `
import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
${unguarded ? "" : 'import { AuthGuard } from "../common/auth.guard";\n'}import { ${pascal(n)}Service } from "./${n}.service";

@Controller("${n}")
${unguarded ? "" : "@UseGuards(AuthGuard)\n"}export class ${pascal(n)}Controller {
  constructor(private readonly service: ${pascal(n)}Service) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
`,
    );
    w(
      `apps/api/src/${n}/${n}.service.ts`,
      `
import { Injectable } from "@nestjs/common";
${plainService ? 'import { db } from "@acme/db";\n' : 'import { BaseService } from "../common/base.service";\n'}
@Injectable()
export class ${pascal(n)}Service${plainService ? "" : " extends BaseService"} {
  async get(id: string) {
    ${plainService ? "" : `this.log("get " + id);\n    `}return ${plainService ? "db" : "this.db"}.link.findFirst({ where: { id } });
  }

  async create(body: Record<string, unknown>) {
    return { id: "new", ...body };
  }
}
`,
    );
  });

  // The root module registers every controller and service (a wiring registry, #38).
  w(
    "apps/api/src/app.module.ts",
    `import { Module } from "@nestjs/common";
${NEST.map((n) => `import { ${pascal(n)}Controller } from "./${n}/${n}.controller";\nimport { ${pascal(n)}Service } from "./${n}/${n}.service";`).join("\n")}

@Module({
  controllers: [
${NEST.map((n) => `    ${pascal(n)}Controller,`).join("\n")}
  ],
  providers: [
${NEST.map((n) => `    ${pascal(n)}Service,`).join("\n")}
  ],
})
export class AppModule {}
`,
  );
  // The team turned on the experimental wiring rules (#38).
  w(".drift/config.yaml", "experimental: [wiring]\n");
  // ---------- services/agents (Python) ----------
  // TypedDicts that take `TypedDict` from typing_extensions, one from typing (an
  // `imports_from` rule, #35), a test double (`test_helper`) and an abstract base a
  // production class extends (`subclassed`).
  w("services/agents/pyproject.toml", `[project]\nname = "acme-agents"\nversion = "0.0.0"\n`);
  w("services/agents/agents/__init__.py", "");
  const STATES = ["plan", "step", "tool", "memory", "trace", "handoff"];
  STATES.forEach((s, f) => {
    const names = ["State", "Input", "Output", "Event"].map((x) => `${pascal(s)}${x}`);
    const last = f === STATES.length - 1;
    w(
      `services/agents/agents/${s}.py`,
      `from typing_extensions import TypedDict\n${last ? "import typing\n" : ""}` +
        names.map((n, i) => `\n\nclass ${n}(${last && i === 3 ? "typing.TypedDict" : "TypedDict"}):\n    ${s}_id: str\n    attempt: int\n`).join(""),
    );
  });
  w("services/agents/agents/fakes.py", `
class FakeClock:
    def now(self) -> float:
        return 0.0
`);
  w("services/agents/agents/gateway.py", `
from abc import ABC, abstractmethod


class Gateway(ABC):
    @abstractmethod
    def send(self, payload: dict) -> None: ...


class HttpGateway(Gateway):
    def send(self, payload: dict) -> None:
        return None
`);

  // ---------- examples: Drift's own parser fixtures ----------
  const fx = join(driftRoot, "crates/drift-ts/tests/fixtures");
  if (existsSync(fx))
    for (const name of ["hono-app", "fastify-app", "trpc-app", "jobs-app", "express-cjs", "signals"]) {
      if (existsSync(join(fx, name))) cpSync(join(fx, name), join(root, "examples", name), { recursive: true });
    }
  return countFiles(root);
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  return n;
}
