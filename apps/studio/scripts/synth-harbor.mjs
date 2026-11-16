// A small synthetic repository ("harbor") for the Studio's Check and Security fixtures (make-harbor-fixtures.mjs).
// Everything here is written for this project (Apache-2.0); no third-party code. It is shaped so that Drift has
// something to say on each surface the Check view's "What each rule rests on", "Security advice" and promote hint,
// and the Security view's "Look at these first", "Nothing reaches" and diff-mode "guard unknown" read:
//
//   - Next.js route handlers, 20 wrapped in withSession(), each reaching a query built by interpolation (lib/db.ts),
//     and a health probe without it: a wrapper rule (mined), a practice departure the place's way can be promoted
//     for (`departures[].promote`), and ranked findings (`security --top`);
//   - two layering boundaries (core and jobs below app), each broken once by a legacy file (in drift.lock);
//   - tools/sweep/sweep.ts, which nothing imports and which imports nothing: a file nothing reaches (`unreached`);
//   - CHANGE: what the branch adds after the policy is accepted: a route with no guard reaching the query (security
//     advice, no baseline), a route calling a guard from a module that is not there (guard unknown), a route wrapped
//     in a wrapper that does not resolve (not checked under the wrapper rule), and most jobs removed (the jobs rule's
//     role falls under 8: stale).
//
//   import { writeHarbor, changeHarbor } from "./synth-harbor.mjs";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROUTES = ["accounts", "alerts", "audit", "billing", "budgets", "channels", "comments", "domains", "events", "exports", "files", "groups", "invoices", "labels", "members", "notes", "orders", "plans", "projects", "reports"];
/** Jobs the branch keeps; the others it removes, with what schedules them. */
const JOBS_KEPT = 6;

const writer = (root) => (rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

export function writeHarbor(root) {
  const w = writer(root);
  w("package.json", JSON.stringify({ name: "harbor", private: true, dependencies: { next: "15.0.0", pg: "8.0.0" } }, null, 2) + "\n");
  w("README.md", "# harbor\n\nA synthetic repository for Drift Studio's fixtures.\n");
  w(
    "lib/session.ts",
    `export function withSession(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!req.headers.get("authorization")) return new Response("unauthorized", { status: 401 });
    return handler(req);
  };
}
`,
  );
  w(
    "lib/db.ts",
    `import { Pool } from "pg";

export const pool = new Pool();

export async function find(table: string, id: string) {
  return pool.query(\`select * from \${table} where id = \${id}\`);
}
`,
  );
  for (const r of ROUTES)
    w(
      `app/api/${r}/route.ts`,
      `import { withSession } from "../../../lib/session";
import { find } from "../../../lib/db";

export const GET = withSession(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("${r}", id));
});
`,
    );
  w("app/api/health/route.ts", "export async function GET() {\n  return Response.json({ ok: true });\n}\n");
  // Nothing imports it and it imports nothing: what it holds is listed apart, not as production code.
  w("tools/sweep/sweep.ts", "export function sweep(code: string) {\n  return eval(code);\n}\n");

  // Layering: packages/core and packages/jobs sit below packages/app; one legacy file of each imports the app.
  w("packages/app/package.json", JSON.stringify({ name: "@harbor/app", private: true, main: "index.ts" }) + "\n");
  w("packages/core/package.json", JSON.stringify({ name: "@harbor/core", private: true }) + "\n");
  w("packages/jobs/package.json", JSON.stringify({ name: "@harbor/jobs", private: true }) + "\n");
  w("packages/app/index.ts", 'export const app = { name: "harbor" };\n');
  for (let i = 0; i < 60; i++) w(`packages/core/src/c${i}.ts`, `export const c${i} = ${i};\n`);
  for (let i = 0; i < 20; i++) w(`packages/app/src/view${i}.ts`, `import { c${i} } from "../../core/src/c${i}";\n\nexport const view${i} = c${i};\n`);
  w("packages/core/src/legacy.ts", 'import { app } from "@harbor/app";\n\nexport const legacy = app.name;\n');
  for (let i = 0; i < 120; i++) w(`packages/jobs/src/job${i}.ts`, `export function job${i}() {\n  return ${i};\n}\n`);
  for (let i = 0; i < 30; i++) w(`packages/app/src/schedule${i}.ts`, `import { job${i} } from "../../jobs/src/job${i}";\n\nexport const schedule${i} = job${i};\n`);
  w("packages/jobs/src/nightly.ts", 'import { app } from "@harbor/app";\n\nexport const run = () => app.name;\n');
}

/** Paths the branch adds. */
export const HARBOR = {
  refunds: "app/api/refunds/route.ts",
  payouts: "app/api/payouts/route.ts",
  ledger: "app/api/ledger/route.ts",
};

export function changeHarbor(root) {
  const w = writer(root);
  w(
    HARBOR.refunds,
    `import { find } from "../../../lib/db";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("refunds", id));
}
`,
  );
  // lib/members.ts is not in the repository: what requireMember does cannot be read.
  w(
    HARBOR.payouts,
    `import { requireMember } from "../../../lib/members";
import { find } from "../../../lib/db";

export async function GET(req: Request) {
  await requireMember();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("payouts", id));
}
`,
  );
  // lib/team.ts is not in the repository either: whether withTeam is withSession cannot be told.
  w(
    HARBOR.ledger,
    `import { withTeam } from "../../../lib/team";

export const GET = withTeam(async (req: Request) => {
  return Response.json({ path: new URL(req.url).pathname });
});
`,
  );
  for (let i = JOBS_KEPT; i < 120; i++) rmSync(join(root, `packages/jobs/src/job${i}.ts`));
  for (let i = JOBS_KEPT; i < 30; i++) rmSync(join(root, `packages/app/src/schedule${i}.ts`));
}
