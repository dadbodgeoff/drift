import { readFileSync } from "node:fs";
import { baseFor, parseEvidence, splitExample, statusOf, suppressionReason, validRef } from "@/entities/check";
import { LOCAL_NOTE, POSTURE, QUEUE_KINDS, QUEUE_NOTE, guardText, isUnguarded, parseGuard, postureOf, posturesIn, siblingsWithoutGuard } from "@/entities/security";
import type { CheckExemption, CheckReport, EntryRow, Inventory, Violation } from "@/shared/contract/drift";
import { describe, expect, it } from "vitest";
import { byConvention, byFile, checkCounts, exemptions, filterExemptions, filterViolations, holdOf, neighbourHolds, stateOf } from "@/entities/check";
import { chainGraph, filterEntries, headline, sinksByKind, sortEntries } from "@/entities/security";
import { check, security } from "./helpers";

describe("check report", () => {
  const r = check();
  it("counts new, blocking, baselined and suppressed", () => {
    const c = checkCounts(r);
    expect(c).toMatchObject({ new: 3, blocking: 2, suppressed: 2 });
    expect(c.baselined).toBe(r.violations.filter((v) => v.baselined && !v.suppressed).length);
  });
  it("groups by convention and by file, new first", () => {
    const g = byConvention(r.violations);
    expect(g[0].counts.new).toBeGreaterThan(0);
    const f = byFile(r.violations);
    expect(f.find((x) => x.key.endsWith("archive-all/route.ts"))?.items).toHaveLength(2);
  });
  it("filters by state and text", () => {
    const only = filterViolations(r.violations, new Set(["suppressed"]), "");
    expect(only.every((v) => stateOf(v) === "suppressed")).toBe(true);
    expect(filterViolations(r.violations, new Set(["new", "baselined", "suppressed"]), "archive-all")).toHaveLength(2);
  });
});

describe("security inventory", () => {
  const inv = security();
  it("summarises entry points, sinks and leaks", () => {
    const h = headline(inv);
    expect(h.entryPoints).toBe(inv.entry_points.length);
    expect(h.reaching).toBeGreaterThan(0);
    // Two groups since #76: a client component importing `db` through the package's barrel
    // (`export { db } from "./client"`) reaches the client module through the re-export.
    expect(h.leakGroups).toBe(2);
    const viaBarrel = inv.client_leaks.find((g) => g.reaches === "packages/db/src/client.ts")!;
    expect(viaBarrel.example).toEqual(["apps/web/components/usage-chart.tsx", "packages/db/src/index.ts", "packages/db/src/client.ts"]);
  });
  it("draws reach chains as a graph", () => {
    const e = inv.entry_points.find((x) => x.reaches.some((r) => r.via.length > 1))!;
    const g = chainGraph(e);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.nodes.some((n) => n.sinks.length > 0)).toBe(true);
  });
  it("sorts reaching entry points first and filters", () => {
    expect(sortEntries(inv.entry_points)[0].reaches.length).toBeGreaterThan(0);
    const raw = filterEntries(inv.entry_points, { q: "", kind: null, unguardedOnly: false, reachingOnly: true, sink: "raw_sql" });
    expect(raw.every((e) => e.reaches.some((r) => r.kind === "raw_sql"))).toBe(true);
    expect(sinksByKind(inv.sinks)[0].items.length).toBeGreaterThanOrEqual(sinksByKind(inv.sinks).at(-1)!.items.length);
  });
});

describe("one status vocabulary for violations", () => {
  const v = (o: Partial<Violation>): Violation => ({ id: "D-1", path: "a.ts", symbol: "f", line: 3, summary: "", evidence: "87/93", example: "b.ts#g", mode: "advise", baselined: false, suppressed: false, ...o });
  it("maps check's fields to new·blocks, new·advises, suppressed, baselined", () => {
    expect(statusOf(v({ mode: "block" }))).toBe("block");
    expect(statusOf(v({}))).toBe("advise");
    expect(statusOf(v({ suppressed: true, mode: "block" }))).toBe("suppressed");
    expect(statusOf(v({ baselined: true }))).toBe("baselined");
    // Depends on a file drift could not parse: never new, never blocks.
    expect(statusOf(v({ unsure: true, mode: "block" }))).toBe("unsure");
    expect(statusOf(v({ unsure: true, baselined: true }))).toBe("baselined");
  });
  it("counts unsure violations and files not checked apart from new ones", () => {
    const r = { violations: [v({ mode: "block" }), v({ unsure: true, mode: "block", symbol: "g" })], fixed: [], unchecked: ["big.ts"] };
    expect(checkCounts(r)).toMatchObject({ new: 1, blocking: 1, unsure: 1, unchecked: 1 });
    expect(byFile(r.violations)[0].counts).toMatchObject({ new: 1, unsure: 1 });
    expect(checkCounts({ violations: [], fixed: [] }).unchecked).toBe(0);
  });
  it("counts and lists warnings the neighbour gate held back, never as new (WS-J)", () => {
    const hold = { id: "D-1a2b3c", path: "src/core/tool-b.ts", symbol: "(file)", line: 1, nearest_apart: "src/core/tool-a.ts#(file)", apart_code: "reviewed", apart_distance: 0, nearest_holder: "src/core/c30.ts#(file)", holder_distance: 0.25 };
    const held = v({ suppressed_neighbour: true, mode: "block", path: hold.path, symbol: hold.symbol, id: hold.id });
    const r = { violations: [v({ mode: "block" }), held], fixed: [], suppressed_neighbour: [hold] } as CheckReport;
    expect(stateOf(held)).toBe("held");
    expect(statusOf(held)).toBe("held");
    expect(statusOf(v({ suppressed_neighbour: true, baselined: true }))).toBe("baselined");
    expect(checkCounts(r)).toMatchObject({ new: 1, blocking: 1, held: 1 });
    expect(byFile(r.violations).find((g) => g.key === hold.path)?.counts).toMatchObject({ new: 0, held: 1 });
    expect(neighbourHolds(r)).toEqual([hold]);
    expect(holdOf(neighbourHolds(r), held)).toEqual(hold);
    expect(holdOf(neighbourHolds(r), r.violations[0])).toBeNull();
    // Older drift omits the list; malformed entries are dropped.
    expect(neighbourHolds({ violations: [], fixed: [] })).toEqual([]);
    expect(neighbourHolds({ violations: [], fixed: [], suppressed_neighbour: [hold, { ...hold, holder_distance: "x" }, null] } as unknown as CheckReport)).toEqual([hold]);
  });
  it("reads evidence and example as check prints them", () => {
    expect(parseEvidence("87/93")).toEqual({ holders: 87, total: 93 });
    expect(parseEvidence("n/a")).toBeNull();
    expect(splitExample("apps/web/app/api/admin/abuse/route.ts#GET")).toEqual({ path: "apps/web/app/api/admin/abuse/route.ts", symbol: "GET" });
  });
  it("finds the drift-ignore reason above a declaration, for the right id", () => {
    const src = readFileSync(new URL("../../fixtures/acme/sources/apps/web/app/api/workspaces/[id]/ping/route.ts", import.meta.url), "utf8");
    expect(suppressionReason(src, 5, "D-b0d245")).toBe("load balancer health probe, intentionally public");
    expect(suppressionReason(src, 5, "D-ed1ec0")).toBe("load balancer health probe, intentionally public");
    expect(suppressionReason(src, 5, "D-000000")).toBeNull();
  });
});

describe("security: guard origins and protection posture", () => {
  const e = (o: Partial<EntryRow>): EntryRow => ({ path: "a.py", symbol: "v", line: 1, kind: "http", method: "GET", route: "/", guards: [], validates: false, reaches: [], reads: [], ...o });
  it("reads origins from drift's suffixes", () => {
    expect(parseGuard("withAdmin")).toEqual({ name: "withAdmin", origin: "code" });
    expect(parseGuard("IsAuthenticated (settings)")).toEqual({ name: "IsAuthenticated", origin: "settings" });
    expect(parseGuard("load_logged_in_user (app hook)")).toEqual({ name: "load_logged_in_user", origin: "app hook" });
  });
  it("classifies protection; opening and authentication are not guards", () => {
    expect(postureOf(e({ guards: ["withAdmin"] }))).toBe("guarded");
    expect(postureOf(e({ guards: ["TokenPermissions (settings)"] }))).toBe("settings");
    expect(postureOf(e({ guards: ["before_request (app hook)"] }))).toBe("app-hook");
    expect(postureOf(e({ authenticates: ["TokenAuthentication (settings)"] }))).toBe("authenticated");
    expect(postureOf(e({ opens: ["AllowAny"], guards: ["x (settings)"] }))).toBe("open");
    expect(postureOf(e({}))).toBe("unguarded");
  });
  it("lists a local entry point (cli) without counting it as unguarded", () => {
    const cli = e({ kind: "cli", method: null, route: null, local: true, reaches: [{ kind: "shell_exec", via: ["a.py#v"] }] });
    expect(isUnguarded(cli)).toBe(false);
    expect(isUnguarded(e({}))).toBe(true);
    expect(postureOf(cli)).toBe("local");
    const inv = { entry_points: [cli, e({})], sinks: [], client_leaks: [], env: {} } as unknown as Inventory;
    expect(headline(inv)).toMatchObject({ entryPoints: 2, unguarded: 1, unguardedReaching: 0 });
    expect(posturesIn(inv)).toEqual(["guarded", "local", "unguarded"]);
    expect(filterEntries(inv.entry_points, { q: "", kind: null, unguardedOnly: true, reachingOnly: false, sink: null })).toEqual([e({})]);
  });
  it("lists a queue-fed entry point (consumer) without counting it as unguarded, as drift security does", () => {
    // security.rs `EntryRow::unguarded` leaves out `QUEUE_KINDS`: a message consumer has no caller to sign in.
    const consumer = e({ kind: "consumer", method: null, route: null, reaches: [{ kind: "raw_sql", via: ["a.py#v"] }] });
    expect(isUnguarded(consumer)).toBe(false);
    expect(postureOf(consumer)).toBe("queue");
    expect(POSTURE.queue.tone).not.toBe("danger");
    expect(guardText(consumer)).toBe(QUEUE_NOTE);
    const inv = { entry_points: [consumer, e({})], sinks: [], client_leaks: [], env: {} } as unknown as Inventory;
    expect(headline(inv)).toMatchObject({ entryPoints: 2, unguarded: 1, unguardedReaching: 0 });
    expect(posturesIn(inv)).toEqual(["guarded", "queue", "unguarded"]);
    expect(filterEntries(inv.entry_points, { q: "", kind: null, unguardedOnly: true, reachingOnly: false, sink: null })).toEqual([e({})]);
    expect(sortEntries([consumer, e({ reaches: consumer.reaches })])[0].kind).toBe("http");
    // A guard that is read still decides.
    expect(postureOf(e({ kind: "consumer", guards: ["verify_signature"] }))).toBe("guarded");
    // A card's Siblings line says the same of a kind of consumers (card.rs).
    expect(siblingsWithoutGuard({ kind: "consumer" })).toBe(QUEUE_NOTE);
    expect(siblingsWithoutGuard({ kind: "cli", local: true })).toBe(LOCAL_NOTE);
    expect(siblingsWithoutGuard({ kind: "http" })).toBe("none has a guard");
    // The kinds and the wording are security.rs's.
    const src = readFileSync(new URL("../../../../crates/drift-mine/src/security.rs", import.meta.url), "utf8");
    expect(src).toContain(`pub const QUEUE_KINDS: &[&str] = &[${QUEUE_KINDS.map((k) => `"${k}"`).join(", ")}];`);
    expect(src).toContain(`pub const QUEUE_NOTE: &str = "${QUEUE_NOTE}";`);
  });
  it("reads an entry point whose guard cannot be read as neither guarded nor unguarded", () => {
    // `assertSession()` throwing a plain Error: looks like a guard, not proven to reject (security.rs `opaque`).
    const unread = e({ opaque: ["assertSession (body call)"], reaches: [{ kind: "shell_exec", via: ["a.ts#v"] }] });
    expect(isUnguarded(unread)).toBe(false);
    expect(postureOf(unread)).toBe("unknown");
    // A guard that is read decides, whatever else is on the entry point.
    expect(postureOf(e({ guards: ["withAuth"], opaque: ["x (body call)"] }))).toBe("guarded");
    const inv = { entry_points: [unread, e({})], sinks: [], client_leaks: [], env: {} } as unknown as Inventory;
    expect(headline(inv)).toMatchObject({ entryPoints: 2, unguarded: 1, unguardedReaching: 0 });
    expect(posturesIn(inv)).toContain("unknown");
  });
  it("words an unreadable guard as unknown wherever a guard is named, never as absent", () => {
    // The gap list, the changes view and the drawer share one wording (security.rs `EntryRef::has`).
    expect(guardText({ guards: [], opaque: ["requireTenant (body call)"] })).toBe("guard unknown (requireTenant (body call))");
    expect(guardText({ guards: [], local: true })).toBe(LOCAL_NOTE);
    expect(guardText({ guards: ["withAuth", "withAdmin"], opaque: ["x (body call)"] })).toBe("withAuth > withAdmin");
    // No guard is what Drift found in what it read, with how much it saw and did not read (security.rs `EntryRef::has`).
    expect(guardText({ guards: [] })).toBe("no guard found in what Drift read");
    expect(guardText({ guards: [], basis: { bodies: 2, not_read: [{ kind: "package_function", what: "pkg:company_auth#require_scope", why: "" }] } })).toBe("no guard found in what Drift read (1 not read)");
  });
  it("shows only the postures the CLI can express: the acme fixture has no settings, hooks, authenticates or opens", () => {
    const inv = JSON.parse(readFileSync(new URL("../../fixtures/acme/security.json", import.meta.url), "utf8")) as Inventory;
    expect(posturesIn(inv)).toEqual(["guarded", "unguarded"]);
    expect(posturesIn({ ...inv, entry_points: [e({ guards: ["P (settings)"], authenticates: ["A"], opens: ["AllowAny"] })] })).toEqual(["guarded", "settings", "authenticated", "open", "unguarded"]);
  });
});

describe("PR mode's diff base belongs to one repository (#19)", () => {
  it("applies a base only to the repository it was chosen for", () => {
    const scope = { repo: "/work/acme", base: "origin/main" };
    expect(baseFor(scope, "/work/acme")).toBe("origin/main");
    // Switching repositories starts on the whole repository, never another repo's base.
    expect(baseFor(scope, "/work/other")).toBeNull();
    expect(baseFor(scope, undefined)).toBeNull();
    expect(baseFor(null, "/work/acme")).toBeNull();
  });

  it("accepts only plain git refs, as the main process does", () => {
    expect(["main", "origin/main", "v1.2.0"].every(validRef)).toBe(true);
    expect(["", "-x", "a..b", "x.lock", "a b"].some(validRef)).toBe(false);
  });
});

describe("members drift check did not check (#45)", () => {
  // `check --format json` `exempt` as crates/drift-mine/src/check.rs serialises it (`Exemption`).
  const ex = (o: Partial<CheckExemption>): CheckExemption => ({ id: "D-1a2b3c", path: "src/services/s00.service.ts", symbol: "Watcher", line: 5, reason: "another kind of class (extends EventEmitter)", ...o });
  const report = (exempt?: unknown): CheckReport => ({ violations: [], fixed: [], ...(exempt === undefined ? {} : { exempt }) }) as CheckReport;

  it("reads them sorted by convention, path and symbol; older drift has none", () => {
    const b = ex({ path: "src/services/base.service.ts", symbol: "BaseService", line: 1, reason: "in the module that defines BaseService" });
    const other = ex({ id: "D-000aaa", symbol: "Ticker" });
    expect(exemptions(report([ex({}), b, other]))).toEqual([other, b, ex({})]);
    expect(exemptions(report())).toEqual([]);
    // The acme fixture, regenerated with the current binary (round 9 F): the outlier a reviewer marked fine
    // (conventions.yaml `exceptions`, code `reviewed`), and the one #45 gives it (the base class's own module is
    // exempt from the base-class rule).
    expect(exemptions(check()).map((e) => [e.id, e.path, e.symbol, e.code])).toEqual([
      ["D-b0d245", "apps/web/app/api/oauth/callback/route.ts", "GET", "reviewed"],
      ["D-df89fd", "apps/api/src/common/base.service.ts", "BaseService", "defining_module"],
    ]);
  });

  it("drops malformed entries instead of failing the view", () => {
    expect(exemptions(report([ex({}), null, { id: "D-1a2b3c", path: "x.ts" }, ex({ line: "5" as unknown as number })]))).toEqual([ex({})]);
    expect(exemptions(report("nope"))).toEqual([]);
    // `code` is optional: kept when a string, dropped (not the member) when malformed.
    expect(exemptions(report([ex({ code: "another_kind" })]))[0].code).toBe("another_kind");
    expect(exemptions(report([ex({ code: 7 as unknown as string })]))).toEqual([ex({})]);
  });

  it("filters on path, id, symbol and reason", () => {
    const all = [ex({}), ex({ id: "D-4d5e6f", path: "app/models.py", symbol: "BaseModel", reason: "in the module that defines BaseModel" })];
    expect(filterExemptions(all, "eventemitter")).toEqual([all[0]]);
    expect(filterExemptions(all, "models.py")).toEqual([all[1]]);
    expect(filterExemptions(all, "  ")).toEqual(all);
  });
});
