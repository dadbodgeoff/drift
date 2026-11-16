// `drift security --diff-base` in the Studio (#167): the diff payload's contract, the IPC and argv that run it, the
// Changes view, and the code drawer's `drift card` facts (fileCard), checked against what the real binary printed.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvalidArgument, driftArgs } from "../../electron/ops";
import { FixtureApi } from "@/shared/api/fixture";
import { validRef } from "@/entities/check";
import { NOT_COVERED, diffCounts, exposureOf, fileCard, placeOf, roleDirs } from "@/entities/security";
import { Changes } from "@/features/security/SecurityChanges";
import type { EntryRow, Inventory, SecurityDiff } from "@/shared/contract/drift";
import { SecurityDiffEnvelope, SecurityEnvelope, channels } from "@/shared/ipc/contract";
import { facts, json, security, text } from "./helpers";

const repo = { path: "/r", name: "r" };
const entry = (over: Partial<EntryRow>): EntryRow => ({ path: "app/api/x/route.ts", package: "", symbol: "GET", line: 1, kind: "http", method: "GET", route: "/api/x", guards: [], validates: false, reaches: [], reads: [], exposure: "unknown", ...over });

/** Every section filled, in the shape crates/drift-cli/tests/security_diff.rs asserts. */
const full: SecurityDiff = {
  guard_gaps: [
    {
      guard: "withAuth",
      kind: "http",
      package: "",
      dir: "",
      members: 41,
      with_guard: 37,
      entry: { path: "app/api/open/route.ts", symbol: "GET", line: 1, kind: "http", method: "GET", route: "/api/open", guards: [] },
      example: { path: "app/api/r00/route.ts", symbol: "GET", line: 3, kind: "http", method: "GET", route: "/api/r00", guards: ["withAuth"] },
      convention: { id: "D-abcdef", status: "proposed", mode: "advise" },
    },
  ],
  unguarded_reaching: [entry({ path: "app/api/run/route.ts", symbol: "POST", method: "POST", route: "/api/run", reaches: [{ kind: "eval", via: ["app/api/run/route.ts#POST"] }], exposure: "public", boundary: "compose service web publishes ports" })],
  sinks: [{ kind: "eval", path: "app/api/run/route.ts", symbol: "POST", line: 1 }],
  leaks: [{ reaches: "lib/db.ts", clients: ["app/chart.tsx"], example: ["app/chart.tsx", "lib/db.ts"] }],
  now_public: [{ path: "admin/api.ts", symbol: "list", line: 4, kind: "http", method: "GET", route: "/admin", guards: ["withAdmin"] }],
  diff: { base: "main", merge_base: "288a7c8154738efd5cd5a5d1fb485369b86be34b", files: 2 },
};

describe("security --diff-base: contract and IPC", () => {
  it("validates the diff payload as its own shape, and the inventory as before", () => {
    const d = json<SecurityDiff>("acme/security-diff.json");
    expect(SecurityDiffEnvelope.safeParse(d).success).toBe(true);
    expect(SecurityEnvelope.safeParse(d).success).toBe(false);
    expect(SecurityDiffEnvelope.safeParse(security()).success).toBe(false);
    const loaded = (data: unknown) => ({ data, at: 0, cached: false, provenance: { commit: null, branch: null, driftVersion: null } });
    expect(channels.security.res.safeParse(loaded(d)).success).toBe(true);
    expect(channels.security.res.safeParse(loaded(security())).success).toBe(true);
    expect(channels.security.res.safeParse(loaded({ guard_gaps: [] })).success).toBe(false);
    // What acme's change introduces (the unguarded routes after the sessions), as the real binary wrote it.
    expect(d.diff).toMatchObject({ base: "main", files: 9 });
    expect(d.guard_gaps.map((g) => [g.entry.path, g.guard, g.with_guard, g.members, g.example.path, g.convention?.id])).toEqual([
      ["apps/web/app/api/workspaces/[id]/archive-all/route.ts", "withWorkspace", 70, 74, "apps/web/app/api/workspaces/[id]/alerts/route.ts", "D-b0d245"],
      ["apps/web/app/api/workspaces/[id]/ping/route.ts", "withWorkspace", 70, 74, "apps/web/app/api/workspaces/[id]/alerts/route.ts", "D-b0d245"],
    ]);
    expect(json<SecurityDiff>("beacon/security-diff.json").guard_gaps.length).toBe(1);
  });

  it("takes a base only as a plain ref, in the request schema and again in the main process", () => {
    expect(channels.security.req.safeParse([repo]).success).toBe(true);
    expect(channels.security.req.safeParse([repo, { base: "origin/main" }]).success).toBe(true);
    for (const bad of ["-x", "--output=/tmp/x", "a..b", "x.lock", "a b", ""]) {
      expect(channels.security.req.safeParse([repo, { base: bad }]).success, bad).toBe(false);
      expect(validRef(bad), bad).toBe(false);
    }
    expect(driftArgs("/r", { op: "security" })).toEqual(["--root", "/r", "security", "--json"]);
    expect(driftArgs("/r", { op: "security", base: null })).toEqual(["--root", "/r", "security", "--json"]);
    expect(driftArgs("/r", { op: "security", base: "origin/main" })).toEqual(["--root", "/r", "security", "--json", "--diff-base", "origin/main"]);
    for (const bad of ["-x", "a..b", "HEAD@{1}", "main^", "a:b", ".hidden"]) expect(() => driftArgs("/r", { op: "security", base: bad }), bad).toThrow(InvalidArgument);
  });

  it("fixture mode serves the diff Drift wrote for main, refuses any other base and a broken policy as Drift did", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      try {
        return new Response(text(String(u).replace(/^\//, "")), { status: 200 });
      } catch {
        return new Response("", { status: 404 });
      }
    }) as typeof fetch;
    try {
      const api = new FixtureApi("/", 0);
      const acme = { path: "/work/acme", name: "acme" };
      expect((await api.securityDiff(acme, { base: "main" })).data).toEqual(json("acme/security-diff.json"));
      await expect(api.securityDiff(acme, { base: "origin/dev" })).rejects.toThrow("drift security failed: --diff-base: base ref `origin/dev` not found");
      const broken = { path: "/work/broken", name: "broken" };
      const errors = json<Record<string, { exit: number; message: string }>>("broken/errors.json");
      expect(errors.security).toEqual(errors.check);
      await expect(api.security(broken)).rejects.toThrow(`drift security failed: ${errors.security.message}`);
      await expect(api.securityDiff(broken, { base: "main" })).rejects.toThrow(`drift security failed: ${errors.security.message}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps NOT_COVERED equal to Drift's own text", () => {
    const src = readFileSync(new URL("../../../../crates/drift-mine/src/security.rs", import.meta.url), "utf8");
    expect(src).toContain(`pub const NOT_COVERED: &str = "${NOT_COVERED}";`);
  });
});

describe("security --diff-base: the Changes view", () => {
  it("counts each section as the --github line does", () => {
    expect(diffCounts(full)).toEqual({ guardGaps: 1, unguardedReaching: 1, sinks: 1, leaks: 1, nowPublic: 1, addedWithoutGuard: 0, guardUnknown: 0, total: 5 });
    expect(diffCounts(json<SecurityDiff>("acme/security-diff.json"))).toMatchObject({ guardGaps: 2, total: 2 });
    expect(placeOf("", "")).toBe("the repository");
    expect(placeOf("apps/web", "")).toBe("package apps/web");
    expect(placeOf("apps/web", "apps/web/app/api")).toBe("apps/web/app/api/");
  });

  it("renders the five sections, says it never fails, and what is not covered", () => {
    const html = renderToStaticMarkup(createElement(Changes, { d: full, scopeBar: null }));
    for (const t of ["New guard gaps (1)", "Entry points where Drift found no guard, reaching a risky operation (1)", "Risky operations added (1)", "Client leaks added (1)", "Entry points made internet-facing (1)"]) expect(html, t).toContain(t);
    expect(html).toContain("facts for review; never fails");
    expect(html).toContain("exits 0 whatever it lists");
    expect(html).toContain("merge base <span class=\"dui-mono\">288a7c8</span>");
    expect(html).toContain("withAuth</span> is on 37 of 41 http entry points in the repository");
    expect(html).toContain("app/api/r00/route.ts:3 GET");
    expect(html).toContain("proposed as D-abcdef");
    expect(html).toContain("internet-facing (compose service web publishes ports)");
    expect(html).toContain("eval()");
    expect(html).toContain("lib/db.ts");
    expect(html).toContain("withAdmin");
    expect(html).toContain(NOT_COVERED.slice(0, 40));
    expect(html).not.toContain("This change introduces none of the five");
  });

  it("says when a change introduces nothing", () => {
    const empty: SecurityDiff = { guard_gaps: [], unguarded_reaching: [], sinks: [], leaks: [], now_public: [], diff: full.diff };
    const html = renderToStaticMarkup(createElement(Changes, { d: empty, scopeBar: null }));
    expect(html).toContain("This change introduces none of the five");
    expect(html.match(/None\./g)?.length).toBe(5);
  });
});

describe("drift card's facts for one file (fileCard)", () => {
  const inv = security();
  const byPath = new Map(facts().files.map((f) => [f.path, f]));
  const card = (p: string) => fileCard(inv, byPath.get(p)!);

  it("lists role directories as security.rs role_dirs does", () => {
    expect(roleDirs("apps/web", "apps/web/app/api/x/route.ts")).toEqual(["", "apps/web/app", "apps/web/app/api", "apps/web/app/api/x"]);
    expect(roleDirs("", "src/a.ts")).toEqual(["", "src"]);
    expect(roleDirs("", "a.ts")).toEqual([""]);
  });

  // The expected values are `drift card <path>` on acme, printed by the release build of main that wrote the fixtures.
  it("an unguarded route: no wrapper, exposure unknown, 70/74 siblings carry withWorkspace, one to copy", () => {
    const c = card("apps/web/app/api/workspaces/[id]/archive-all/route.ts");
    expect(c.entries.map((e) => [e.method, e.route, e.kind, e.guards, e.exposure])).toEqual([["GET", "/api/workspaces/[id]/archive-all", "http", [], "unknown"]]);
    expect(c.siblings).toEqual([
      { kind: "http", tooFew: false, where: "apps/web/app/api/workspaces/[id]/", members: 74, shares: [{ guard: "withWorkspace", n: 70 }], copy: expect.objectContaining({ path: "apps/web/app/api/workspaces/[id]/alerts/route.ts", line: 5, symbol: "GET" }) },
    ]);
    expect(c.unknown).toEqual(["exposure (no compose service or `security:` setting in .drift/config.yaml covers this path)", "checks inside handler bodies other than sign-in checks, and anything applied outside this repository"]);
  });

  it("the member to copy from is never the file itself", () => {
    const c = card("apps/web/app/api/workspaces/[id]/alerts/route.ts");
    expect(c.entries.map((e) => e.guards)).toEqual([["withWorkspace"], ["withWorkspace"]]);
    expect(c.siblings[0]).toMatchObject({ members: 74, copy: { path: "apps/web/app/api/workspaces/[id]/audit/route.ts", line: 5 } });
  });

  it("a file with no entry point: the siblings of every kind in its package", () => {
    const c = card("apps/web/lib/auth.ts");
    expect(c.entries).toEqual([]);
    expect(c.siblings.map((s) => (s.tooFew ? [s.kind] : [s.kind, s.where, s.members, s.shares.map((g) => `${g.guard} ${g.n}`), s.copy?.path ?? null]))).toEqual([
      ["http", "package apps/web", 97, ["withWorkspace 70", "withAdmin 19"], "apps/web/app/api/workspaces/[id]/alerts/route.ts"],
      ["page", "package apps/web", 21, [], null],
      ["server_action", "apps/web/lib/", 19, ["authActionClient.inputSchema().action 18"], "apps/web/lib/actions/archive-link.ts"],
    ]);
  });

  it("decorated controllers: the narrowest place with enough siblings", () => {
    const c = card("apps/api/src/users/users.controller.ts");
    // Since the round-13 gap round, `@UseGuards(AuthGuard)` is named by the guard it applies.
    expect(c.entries.map((e) => e.guards)).toEqual([["AuthGuard"], ["AuthGuard"]]);
    expect(c.siblings[0]).toMatchObject({ where: "apps/api/src/", members: 49, shares: [{ guard: "AuthGuard", n: 47 }], copy: { path: "apps/api/src/alerts/alerts.controller.ts", line: 10 } });
  });

  it("names what is not known: a file not parsed, unresolved imports; no exposure note from a drift that reports none", () => {
    const f = { path: "src/a.ts", package: "", imports: [{ module: "unresolved:@acme/x", names: [], type_only: false }] };
    const inv2: Inventory = { entry_points: [entry({ path: "src/a.ts" })], sinks: [], client_leaks: [], env: { API_KEY: ["src/a.ts"] }, unchecked: ["src/a.ts"], boundaries: { rules: [] } };
    const c = fileCard(inv2, f);
    expect(c.reads).toEqual(["API_KEY"]);
    expect(c.siblings).toEqual([{ kind: "http", tooFew: true }]);
    expect(c.unknown).toEqual([
      "what this file declares (not parsed)",
      "1 import(s) unresolved (@acme/x), so what they reach is not followed",
      "exposure (no compose service or `security:` setting in .drift/config.yaml covers this path)",
      "checks inside handler bodies other than sign-in checks, and anything applied outside this repository",
    ]);
    const { boundaries: _b, ...older } = inv2;
    expect(fileCard(older, f).unknown).not.toContain("exposure (no compose service or `security:` setting in .drift/config.yaml covers this path)");
    expect(exposureOf({ rules: [{ dir: "", exposure: "internal", source: "config" }, { dir: "api", exposure: "public", source: "compose" }] }, "api/x.ts")).toEqual({ exposure: "public", source: "compose" });
    expect(exposureOf({ rules: [{ dir: "api", exposure: "public", source: "compose" }] }, "apix/x.ts").exposure).toBe("unknown");
  });

  // Behind a gateway Drift reads, exposure is each route's (security.rs `Boundaries::expose`): the rows of one file differ,
  // and an unknown one says what was not read instead of "nothing covers this path".
  it("exposure route by route: each row keeps its own, and an unknown one gives the gateway's reason", () => {
    const gw = "gateway edge (deploy/nginx.conf)";
    const may = `${gw} may route /x/{id} to api: location ~ ^/x is a regular expression, which Drift does not evaluate`;
    const f = { path: "api/app/main.py", package: "api", imports: [] };
    const inv2: Inventory = {
      entry_points: [
        entry({ path: f.path, symbol: "rules", route: "/v1/rules", exposure: "public", boundary: `${gw} routes /v1/rules to api` }),
        entry({ path: f.path, symbol: "claim", route: "/internal/claim", exposure: "internal", boundary: `${gw} routes no location to /internal/claim on api: reachable only inside the compose network` }),
        entry({ path: f.path, symbol: "x", route: "/x/{id}", exposure: "unknown", boundary: may }),
        entry({ path: f.path, symbol: "y", route: "/x/{id}/y", exposure: "unknown", boundary: may }),
      ],
      sinks: [],
      client_leaks: [],
      env: {},
      boundaries: { rules: [{ dir: "api", exposure: "public", source: "compose service api in deploy/compose.yaml is routed by gateway edge" }] },
    };
    const c = fileCard(inv2, f);
    expect(c.entries.map((e) => e.exposure)).toEqual(["public", "internal", "unknown", "unknown"]);
    expect(c.unknown).toEqual([`exposure (${may})`, "checks inside handler bodies other than sign-in checks, and anything applied outside this repository"]);
    // A file of the service with no entry point takes the service's rule: known, so nothing to say.
    expect(fileCard(inv2, { ...f, path: "api/app/db.py" }).unknown).toEqual(["checks inside handler bodies other than sign-in checks, and anything applied outside this repository"]);
  });
});
