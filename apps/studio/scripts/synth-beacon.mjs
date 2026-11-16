// A small synthetic monorepo ("beacon") for the Studio's round-11 fixtures. Everything here is written for this
// project (Apache-2.0); no third-party code. It is shaped so that the shipped Drift (a release build) proposes:
//
//   - four block candidates (decision D13), the default tier: an auth wrapper on HTTP handlers whose two outliers
//     are entry points (`needs_confirmation` in `drift review --json`), and two more layering boundaries;
//   - one Python proposal, a DRF serializer naming rule, which Drift withholds while Python proposals are off
//     (decision D13-py), so census reports `python_proposals.withheld: 1`;
//   - set-apart files whose kind a later file shares, so the neighbour gate (round 11, WS-J) has something to hold.
//
//   import { writeBeacon, BEACON } from "./synth-beacon.mjs"; writeBeacon(dir)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Paths the fixture scenario (make-round11-fixtures.mjs) answers and edits. */
export const BEACON = {
  health: "apps/portal/app/api/health/route.ts",
  status: "apps/portal/app/api/status/route.ts",
  fixtures: "packages/core/src/fixtures.ts",
  seed: "packages/core/src/seed.ts",
  legacy: "packages/core/src/legacy.ts",
  /** Added after the answers: the same kind as fixtures.ts (the neighbour gate holds it back when on). */
  moreFixtures: "packages/core/src/fixtures-billing.ts",
  /** Added after the answers: like the holders but for its import of the app (new, not held back). */
  late: "packages/core/src/late.ts",
  /** Added after the answers: a new route without the wrapper (new, an entry point: never held back). */
  route: "apps/portal/app/api/refunds/route.ts",
};

const ROUTES = [
  "accounts", "alerts", "audit", "billing", "branding", "budgets", "channels", "comments", "domains", "events", "exports",
  "feeds", "files", "groups", "imports", "invoices", "keys", "labels", "members", "notes", "orders", "plans", "projects",
  "quotas", "reports", "roles", "tags", "teams", "tokens", "usage", "webhooks",
];

export const GUARDED = `import { withSession } from "../../../lib/session";

export const GET = withSession(async (req: Request) => {
  return Response.json({ ok: true, path: new URL(req.url).pathname });
});
`;
export const UNGUARDED = `export async function GET(req: Request) {
  return Response.json({ ok: true, path: new URL(req.url).pathname });
}
`;
/** A core file that builds test data from the app's types: a different kind of thing from core code. */
export const FIXTURE = (name) => `import { app } from "@beacon/app";
import { factory } from "./factory";

export const ${name} = factory(app);
`;

export function writeBeacon(root) {
  const w = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  const pkg = (dir, name, extra = {}) => w(`${dir}/package.json`, JSON.stringify({ name, private: true, ...extra }, null, 2) + "\n");
  w("package.json", JSON.stringify({ name: "beacon", private: true, workspaces: ["apps/*", "packages/*"] }, null, 2) + "\n");
  w("README.md", "# beacon\n\nA synthetic monorepo for Drift Studio's fixtures.\n");

  // apps/portal: Next.js route handlers, 31 of 33 wrapped in withSession(); the health and status probes are not.
  pkg("apps/portal", "@beacon/portal", { dependencies: { next: "15.5.28", "@beacon/core": "*" } });
  w("apps/portal/lib/session.ts", "export function withSession<T>(handler: T): T {\n  return handler;\n}\n");
  for (const r of ROUTES) w(`apps/portal/app/api/${r}/route.ts`, GUARDED);
  w(BEACON.health, UNGUARDED);
  w(BEACON.status, UNGUARDED);
  for (let i = 0; i < 30; i++) w(`apps/portal/lib/format/f${i}.ts`, `export function format${i}(value: number) {\n  return value.toFixed(${i % 4});\n}\n`);

  // packages/core sits below packages/app: 200 core files import nothing from it; three do.
  pkg("packages/core", "@beacon/core");
  pkg("packages/app", "@beacon/app", { main: "index.ts", dependencies: { "@beacon/core": "*" } });
  w("packages/app/index.ts", "export const app = { name: \"beacon\" };\n");
  for (let i = 0; i < 30; i++) w(`packages/app/src/view${i}.ts`, `import { c${i} } from "../../core/src/c${i}";\n\nexport const view${i} = c${i};\n`);
  for (let i = 0; i < 200; i++) w(`packages/core/src/c${i}.ts`, `export const c${i} = ${i};\n`);
  w("packages/core/src/factory.ts", "export function factory<T>(seed: T) {\n  return { ...seed, id: 1 };\n}\n");
  w(BEACON.fixtures, FIXTURE("fixtures"));
  w(BEACON.seed, FIXTURE("seed"));
  w(BEACON.legacy, 'import { app } from "@beacon/app";\n\nexport const legacy = app.name;\n');

  // packages/ui sits below apps/portal (the portal's views render ui parts): one ui file imports the portal.
  pkg("packages/ui", "@beacon/ui");
  for (let i = 0; i < 120; i++) w(`packages/ui/src/part${i}.ts`, `export const part${i} = "part-${i}";\n`);
  w("packages/ui/src/debug-panel.ts", 'import { format1 } from "../../../apps/portal/lib/format/f1";\n\nexport const debugPanel = () => format1(1);\n');
  for (let i = 0; i < 30; i++) w(`apps/portal/lib/views/v${i}.ts`, `import { part${i} } from "../../../../packages/ui/src/part${i}";\n\nexport const v${i} = part${i};\n`);

  // packages/jobs sits below packages/app (the app schedules jobs): two job files import the app.
  pkg("packages/jobs", "@beacon/jobs");
  for (let i = 0; i < 120; i++) w(`packages/jobs/src/job${i}.ts`, `export function job${i}() {\n  return ${i};\n}\n`);
  for (const n of ["nightly-report", "weekly-digest"]) w(`packages/jobs/src/${n}.ts`, `import { app } from "@beacon/app";\n\nexport const run = () => app.name;\n`);
  for (let i = 0; i < 30; i++) w(`packages/app/src/schedule${i}.ts`, `import { job${i} } from "../../jobs/src/job${i}";\n\nexport const schedule${i} = job${i};\n`);

  // services/worker (Python): DRF serializers, all but one named *Serializer.
  w("services/worker/pyproject.toml", '[project]\nname = "beacon-worker"\nversion = "0.1.0"\n');
  w("services/worker/worker/__init__.py", "");
  w("services/worker/worker/api/__init__.py", "");
  for (let i = 0; i < 30; i++) {
    const name = i === 29 ? "RefundPayload" : `Model${i}Serializer`;
    w(`services/worker/worker/api/m${i}/__init__.py`, "");
    w(`services/worker/worker/api/m${i}/serializers.py`, `from rest_framework import serializers\n\n\nclass ${name}(serializers.ModelSerializer):\n    class Meta:\n        fields = "__all__"\n`);
  }
  w("services/worker/worker/models/__init__.py", "");
  for (let i = 0; i < 24; i++) w(`services/worker/worker/models/m${i}.py`, `class Record${i}:\n    def __init__(self, value):\n        self.value = value\n`);
  w("services/worker/worker/util/__init__.py", "");
  for (let i = 0; i < 30; i++) w(`services/worker/worker/util/u${i}.py`, `def u${i}():\n    return ${i}\n`);
}
