// The Practices view model (features/practices/model): sorting, shares, the coverage bar, the per-package filter and the
// cross-package comparison, on the acme fixture (PLAN-R13 §0.3 shape) and on small hand-made reports.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FINDING_KIND,
  HYGIENE,
  attributeText,
  comparison,
  concernIn,
  concernsIn,
  copiesMore,
  coverageBar,
  dominantOf,
  differsText,
  examplesIn,
  findingText,
  findingsIn,
  gaps,
  groupHint,
  groupMore,
  groupsOf,
  isPreview,
  letterOf,
  packagesOf,
  pct,
  pkgLabel,
  recipeConcerns,
  recipesIn,
  setsApartText,
  sortConcerns,
  sortVariants,
  summaryIn,
  unknownReason,
  variantHint,
  variantLabel,
  variantName,
} from "@/features/practices";
import { PRACTICE_CONCERNS, PRACTICE_PRIMARY, type PracticeConcern, type PracticeFinding, type PracticeVariant, type PracticesReport } from "@/shared/contract/drift";
import { json } from "./helpers";

const acme = () => json<PracticesReport>("acme/practices.json");
const concern = (id: string) => acme().concerns.find((c) => c.id === id)!;
/** The engine's own output on its fixtures (crates/drift-mine/tests/snapshots, insta: JSON after the header). */
const engine = (name: string) => {
  const snap = readFileSync(new URL(`../../../../crates/drift-mine/tests/snapshots/practices__engine_${name}.snap`, import.meta.url), "utf8");
  return JSON.parse(snap.slice(snap.indexOf("\n---\n") + 5)) as PracticesReport;
};

function variant(p: Partial<PracticeVariant> & { id: string; key: string; members: number }): PracticeVariant {
  return {
    label: p.key,
    kind: "known",
    mechanisms: [],
    instruments: [],
    source: "usage",
    share: 0,
    where: { packages: [], dirs: [], roles: [], entry_kinds: [], methods: [] },
    sets_apart: [],
    examples: [],
    exceptions: [],
    exceptions_more: 0,
    conventions: [],
    promotable: null,
    ...p,
  };
}

describe("the acme practices fixture is a consistent §0.3 report", () => {
  it("counts add up: population, variants, packages and the summary", () => {
    const r = acme();
    expect(r.version).toBe(1);
    expect(r.concerns.map((c) => c.id)).toEqual(sortConcerns(r.concerns).map((c) => c.id));
    for (const c of r.concerns) {
      const p = c.population;
      expect(p.known + p.none + p.unknown, c.id).toBe(p.total);
      expect(c.variants.filter((v) => v.kind === "known").reduce((s, v) => s + v.members, 0), c.id).toBe(p.known);
      expect(c.variants.filter((v) => v.kind === "none").reduce((s, v) => s + v.members, 0), c.id).toBe(p.none);
      expect(c.unknown.members, c.id).toBe(p.unknown);
      expect(c.by_package.reduce((s, b) => s + b.total, 0), c.id).toBe(p.total);
      expect(c.variants.map((v) => v.id), c.id).toEqual(sortVariants(c.variants).map((v) => v.id));
      for (const v of c.variants) {
        expect(v.id).toMatch(/^P-[0-9a-f]{6}$/);
        expect(v.share).toBeCloseTo(v.members / p.total, 3);
        expect(v.examples.length).toBeLessThanOrEqual(3);
        expect(v.exceptions.length).toBeLessThanOrEqual(10);
        expect(v.sets_apart.length).toBeLessThanOrEqual(3);
        for (const w of Object.values(v.where)) expect(w.length).toBeLessThanOrEqual(8);
      }
    }
    const s = r.summary;
    expect(s.population).toBe(r.concerns.reduce((n, c) => n + c.population.total, 0));
    expect(s.concerns_at_target).toBe(r.concerns.filter((c) => c.population.coverage >= s.target).length);
    // What the fixture is for: every concern, the two apps as packages, unknowns somewhere.
    expect(r.concerns.map((c) => c.id)).toEqual([...PRACTICE_CONCERNS]);
    expect(packagesOf(r).slice(0, 2)).toEqual(["apps/web", "apps/api"]);
    expect(r.concerns.some((c) => c.unknown.members > 0)).toBe(true);
  });
});

describe("sorting and shares", () => {
  it("sorts variants by members, then key; none by its count like any other", () => {
    const vs = [variant({ id: "P-000001", key: "b", members: 3 }), variant({ id: "P-000002", key: "", members: 9, kind: "none" }), variant({ id: "P-000003", key: "a", members: 3 })];
    expect(sortVariants(vs).map((v) => v.id)).toEqual(["P-000002", "P-000003", "P-000001"]);
  });

  it("orders concerns as §0.1 freezes them", () => {
    const cs = ["testing", "authn", "errors", "zzz"].map((id) => ({ ...concern("authn"), id }) as PracticeConcern);
    expect(sortConcerns(cs).map((c) => c.id)).toEqual(["authn", "errors", "testing", "zzz"]);
    expect(PRACTICE_CONCERNS[0]).toBe("authn");
  });

  it("prints shares as the text form does", () => {
    expect(pct(0.887)).toBe("89%");
    expect(pct(0.001)).toBe("<1%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });
});

describe("the coverage bar", () => {
  it("splits known, none and unknown, and measures (known + none) against the target", () => {
    const b = coverageBar({ total: 186, known: 154, none: 11, unknown: 21 }, 0.9);
    expect(b.knownShare + b.noneShare + b.unknownShare).toBeCloseTo(1, 10);
    expect(b.coverage).toBeCloseTo(165 / 186, 10);
    expect(b.atTarget).toBe(false);
    // 0.9 * 186 = 167.4 -> 168 described units; 165 are.
    expect(b.toTarget).toBe(3);
  });

  it("reaches the target exactly at 90%, and an empty population is not at target", () => {
    expect(coverageBar({ total: 10, known: 8, none: 1, unknown: 1 }, 0.9)).toMatchObject({ atTarget: true, toTarget: 0 });
    expect(coverageBar({ total: 10, known: 8, none: 0, unknown: 2 }, 0.9)).toMatchObject({ atTarget: false, toTarget: 1 });
    expect(coverageBar({ total: 0, known: 0, none: 0, unknown: 0 }, 0.9)).toMatchObject({ atTarget: false, toTarget: 0, coverage: 0, knownShare: 0 });
  });

  it("agrees with Drift's own coverage for every concern", () => {
    const r = acme();
    for (const row of concernsIn(r, null)) expect(row.bar.coverage).toBeCloseTo(row.concern.population.coverage, 3);
    expect(summaryIn(r, null).bar.coverage).toBeCloseTo(r.summary.coverage, 3);
    expect(summaryIn(r, null).atTarget).toBe(r.summary.concerns_at_target);
  });
});

describe("the per-package filter", () => {
  it("rebuilds a concern from by_package: variants, counts and unknown in one package", () => {
    const web = concernIn(concern("authn"), "apps/web", 0.9)!;
    expect(web.counts).toEqual({ total: 116, known: 107, identified: 0, none: 9, unknown: 0 });
    expect(web.variants.map((r) => [r.variant.label, r.members])).toEqual([
      ["wrap withWorkspace, or decorator AuthGuard", 70],
      ["wrap withAdmin", 19],
      ["wrap authActionClient.inputSchema().action", 18],
      ["no guard, nothing opens it", 9],
    ]);
    expect(web.variants[0].share).toBeCloseTo(70 / 116, 10);
    // apps/api: AuthGuard on 47 of its 49 routes; the two `releases` routes have no guard.
    expect(concernIn(concern("authn"), "apps/api", 0.9)!.counts).toEqual({ total: 49, known: 47, identified: 0, none: 2, unknown: 0 });
    const val = concernIn(concern("validation"), "apps/web", 0.9)!;
    expect(val.counts).toEqual({ total: 113, known: 18, identified: 0, none: 59, unknown: 36 });
    expect(val.bar.coverage).toBeCloseTo(concern("validation").by_package.find((b) => b.package === "apps/web")!.coverage, 3);
    expect(val.bar.atTarget).toBe(false);
  });

  it("leaves out concerns with no unit in the package, and sums the rest", () => {
    const r = acme();
    expect(concernIn(concern("authn"), "packages/ui", 0.9)).toBeNull();
    expect(concernsIn(r, "packages/ui")).toEqual([]);
    const s = summaryIn(r, "apps/api");
    const rows = concernsIn(r, "apps/api");
    expect(s.bar.total).toBe(rows.reduce((n, x) => n + x.counts.total, 0));
    expect(s.concerns).toBe(rows.length);
  });

  it("keeps the examples in the package", () => {
    const xs = [{ path: "apps/api/src/a.ts", symbol: "a", line: 1 }, { path: "apps/apix/b.ts", symbol: "b", line: 2 }, { path: "apps/web/c.ts", symbol: "c", line: 3 }];
    expect(examplesIn(xs, "apps/api").map((e) => e.symbol)).toEqual(["a"]);
    expect(examplesIn(xs, null)).toHaveLength(3);
  });
});

describe("the cross-package comparison", () => {
  it("puts packages side by side and marks where one does it another way (divergence)", () => {
    const c = concern("api");
    const cmp = comparison(c)!;
    expect(cmp.rows.map((r) => r.package)).toEqual(c.by_package.map((b) => b.package));
    expect(cmp.variants.map((v) => v.id)).toEqual(c.variants.map((v) => v.id));
    const api = cmp.rows.find((r) => r.package === "apps/api")!;
    expect(api.divergent).toEqual({ dominant: c.divergence[0].dominant, members: 49 });
    expect(cmp.repoDominant).toBe(dominantOf(c)!.id);
    expect(cmp.rows.find((r) => r.package === "apps/web")!.divergent).toBeNull();
    expect(variantName(c, api.divergent!.dominant)).toBe("B builder return_value");
    expect(variantName(c, "unknown")).toBe("unknown");
  });

  it("is absent with one package", () => {
    expect(concern("logging").by_package).toHaveLength(1);
    expect(comparison(concern("logging"))).toBeNull();
  });
});

describe("what sets a variant apart, and its hint", () => {
  it("reads the counts as the plan's sentence: k/n of V where vs k/n of the dominant variant", () => {
    const c = concern("authn");
    const v = c.variants[2];
    const s = v.sets_apart[0];
    expect(setsApartText(c, v, s)).toBe("18/18 of C under apps/web/lib vs 0/70 of A");
    // The dominant variant is set apart from the rest.
    const api = concern("api");
    expect(setsApartText(api, api.variants[0], api.variants[0].sets_apart[0])).toBe("96/96 of A under apps/web/app vs 1/50 of the rest");
    const a = c.variants[0];
    // Nothing sets the dominant authn variant apart: its hint is its place alone.
    expect(variantHint(a)).toBe("apps/web/app/api/workspaces/[id]");
    // A split policy (`any_of(A|B)`) keeps its alternatives.
    expect(a.alternatives?.map((x) => [x.label, x.members])).toEqual([["decorator AuthGuard", 47], ["wrap withWorkspace", 70]]);
  });

  it("names every attribute kind of §3", () => {
    expect(attributeText("dir:apps/web/app/api/webhooks")).toBe("under apps/web/app/api/webhooks");
    expect(attributeText("package:apps/api")).toBe("in package apps/api");
    expect(attributeText("method:POST")).toBe("POST handlers");
    expect(attributeText("entry:http")).toBe("http entry points");
    expect(attributeText("wrap:validation:none")).toBe("also using validation:none");
    expect(attributeText("odd")).toBe("odd");
    expect(letterOf(concern("authn"), "P-ffffff")).toBe("?");
  });
});

describe("unknown, gaps and promotion", () => {
  it("lists concerns below the target, furthest first", () => {
    const r = acme();
    const g = gaps(concernsIn(r, null));
    expect(g.map((x) => x.concern.id)).toEqual(["authz", "validation"]);
    // 0.9 * 154 = 138.6 -> 139 described units; 107 are.
    expect(g[0].bar.toTarget).toBe(32);
    // apps/api: its 47 guarded routes call services whose authorization Drift cannot resolve (unknown).
    expect(gaps(concernsIn(r, "apps/api")).map((x) => [x.concern.id, x.counts.unknown])).toEqual([["authz", 47]]);
  });

  it("explains every unknown reason of §0.3", () => {
    for (const r of ["unparsed", "opaque_wrapper", "unresolved", "no_symbol", "dynamic", "unclassified"]) expect(unknownReason(r).hint.length, r).toBeGreaterThan(20);
    expect(unknownReason("new_reason")).toEqual({ label: "new_reason", hint: "" });
  });

});

describe("the recipe and the findings: Drift's, read as given", () => {
  it("the acme fixture has a recipe per package and kind of entry point, of the recipe concerns only", () => {
    const r = acme();
    expect(r.recipes.map((x) => x.label)).toEqual(["http entry points in apps/web", "http entry points in apps/api", "server_action entry points in apps/web"]);
    for (const x of r.recipes) {
      expect(x.id).toMatch(/^E-[0-9a-f]{6}$/);
      for (const c of x.concerns) {
        expect(PRACTICE_PRIMARY).toContain(c.concern);
        expect(c.variants.length).toBeLessThanOrEqual(2);
        expect(c.variants.reduce((n, v) => n + v.members, 0) + c.none + c.unknown).toBeLessThanOrEqual(c.total);
      }
    }
    const web = r.recipes[0];
    expect(recipeConcerns(web).map((c) => c.concern)).toEqual(["authn", "authz", "validation", "errors", "api"]);
    const authz = web.concerns.find((c) => c.concern === "authz")!;
    expect(authz.copy?.path).toBe("apps/web/app/api/workspaces/[id]/alerts/route.ts");
    expect(differsText(authz.differs!)).toBe("34 POST handlers");
    expect(recipesIn(r, "apps/api").map((x) => x.role)).toEqual(["http"]);
    expect(recipesIn(r, "packages/ui")).toEqual([]);
  });

  it("filters findings by package and keeps the repository-wide ones, in Drift's order", () => {
    const r = acme();
    const KINDS = Object.keys(FINDING_KIND);
    expect(r.findings.map((f) => f.kind)).toEqual([...r.findings.map((f) => f.kind)].sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b)));
    const api = findingsIn(r, "apps/api");
    expect(api.every((f) => f.package === "apps/api" || f.package === null)).toBe(true);
    expect(api.slice(0, 2).map((f) => `${f.kind} ${f.concern}`)).toEqual(["none validation", "none authn"]);
    expect(api.slice(2).every((f) => f.kind === "unknown" && f.concern === "authz" && f.package === null && f.config_hint === null)).toBe(true);
    const unknown = api[2];
    expect(findingText(r, unknown)).toEqual({
      title: `Authorization and tenant scoping: 1 entry point uses ${unknown.instrument} Drift cannot classify`,
      detail: "No config line would make it known: Drift could not resolve it, or it is not an instrument a line can name.",
    });
    expect(findingText(r, api[1]).title).toBe("Authentication in apps/api: 2 entry points, no guard, nothing opens it");
  });

  it("names an unexplained split by Drift's variants, without recomputing it", () => {
    const r = acme();
    const c = concern("authz");
    const f: PracticeFinding = { kind: "unexplained_split", concern: "authz", package: "apps/web", variants: [c.variants[0].id, c.variants[1].id], members: 34, instrument: null, config_hint: null, examples: [] };
    const t = findingText(r, f);
    expect(t.title).toBe("Authorization and tenant scoping in apps/web: two ways, and nothing sets them apart");
    expect(t.detail).toBe(`34 entry points do ${c.variants[1].label} where most do ${c.variants[0].label}; no package, directory, role or kind of entry point separates them.`);
    expect(differsText({ variant: c.variants[1].id, members: 34, attribute: null, examples: [] })).toBe("34, and nothing sets them apart");
  });

  it("lists the finding kinds in Drift's rank order", () => {
    const src = readFileSync(new URL("../../../../crates/drift-mine/src/practices/mod.rs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("pub enum FindingKind {"));
    const variants = [...body.slice(0, body.indexOf("\n}")).matchAll(/^ {4}([A-Z]\w+),$/gm)].map((m) => m[1].replace(/[A-Z]/g, (c, i) => (i ? "_" : "") + c.toLowerCase()));
    expect(Object.keys(FINDING_KIND)).toEqual(variants);
    expect(variants).toEqual(["unscoped_key", "unexplained_split", "none", "unknown", "duplicate_helper"]);
    expect(readFileSync(new URL("../../../../crates/drift-mine/src/practices/dupes.rs", import.meta.url), "utf8")).toContain(`pub const HYGIENE: &str = "${HYGIENE}";`);
  });

  it("says which key a signed-in caller can name, with the units Drift counted", () => {
    const r = acme();
    const c = concern("authz");
    const f: PracticeFinding = { kind: "unscoped_key", concern: "authz", package: "apps/api", variants: [c.variants[0].id], members: 2, instrument: null, config_hint: null, examples: [{ path: "apps/api/app/api/users.py", symbol: "list_notes", line: 17 }], key: "org_id" };
    const t = findingText(r, f);
    expect(t.title).toBe("Authorization and tenant scoping in apps/api: 2 entry points take org_id from the request, and nothing checks or scopes it");
    expect(t.detail).toContain("a signed-in caller can name any org_id");
    expect(t.detail).toContain("is not listed");
    expect(findingText(r, { ...f, members: 1, key: "userId" }).title).toBe("Authorization and tenant scoping in apps/api: 1 entry point takes userId from the request, and nothing checks or scopes it");
    expect(FINDING_KIND.unscoped_key).toEqual({ label: "Unscoped key", tone: "danger" });
    // A package's findings: its own, never another package's.
    const report = { ...r, findings: [f, ...r.findings] };
    expect(findingsIn(report, "apps/api")[0]).toBe(f);
    expect(findingsIn(report, "apps/web")).not.toContain(f);
  });

  it("names a duplicate helper with every copy Drift listed, and the ones it only counted", () => {
    const r = acme();
    const copy = (path: string, line: number) => ({ path, symbol: "fetch_json", line });
    const f: PracticeFinding = {
      kind: "duplicate_helper",
      concern: "hygiene",
      package: null,
      variants: [],
      members: 2,
      instrument: null,
      config_hint: null,
      examples: [copy("apps/api/app/client.py", 6), copy("apps/worker/app/client.py", 7)],
      key: "fetch_json",
      copies: [copy("apps/api/app/client.py", 6), copy("apps/worker/app/client.py", 7)],
      shared_calls: 2,
    };
    expect(findingText(r, f)).toEqual({
      title: "fetch_json is defined in 2 files across packages",
      detail: "Same name, and the copies share 2 calls: one helper written twice. Drift reads what the copies call, not their text.",
    });
    expect(copiesMore(f)).toBe(0);
    const many: PracticeFinding = { ...f, package: "apps/api", members: 11, shared_calls: 1, copies: Array.from({ length: 8 }, (_, i) => copy(`apps/api/s${i}/log.py`, 20 + i)) };
    expect(copiesMore(many)).toBe(3);
    expect(findingText(r, many)).toEqual({
      title: "fetch_json is defined in 11 files in apps/api",
      detail: "Same name, and the copies share 1 call: one helper written 11 times. Drift reads what the copies call, not their text. 3 more copies are not listed.",
    });
    expect(findingText(r, { ...many, members: 9 }).detail).toMatch(/1 more copy is not listed\.$/);
    expect(FINDING_KIND.duplicate_helper).toEqual({ label: "Duplicate helper", tone: "warning" });
    // Across packages: shown for the packages its listed copies are in, and for the whole repository.
    const report = { ...r, findings: [f, many] };
    expect(findingsIn(report, null)).toEqual([f, many]);
    expect(findingsIn(report, "apps/api")).toEqual([f, many]);
    expect(findingsIn(report, "apps/worker")).toEqual([f]);
    expect(findingsIn(report, "apps/web")).toEqual([]);
    // An unknown instrument is still everyone's.
    const unknown = r.findings.find((x) => x.kind === "unknown")!;
    expect(findingsIn({ ...r, findings: [unknown, f] }, "apps/web")).toEqual([unknown]);
    // `""` is the root package (labelled "."), not every package: a helper whose copies are all in other packages
    // is not the root package's; one with a copy in no other package's directory is.
    const date = (path: string) => ({ path, symbol: "formatDate", line: 3 });
    const elsewhere: PracticeFinding = { ...f, key: "formatDate", copies: [date("apps/web/src/date.ts"), date("apps/api/src/date.ts")] };
    const atRoot: PracticeFinding = { ...f, key: "formatDate", copies: [date("scripts/date.ts"), date("apps/web/src/date.ts")] };
    expect(pkgLabel("")).toBe(".");
    expect(findingsIn({ ...r, findings: [elsewhere, atRoot] }, "")).toEqual([atRoot]);
    expect(findingsIn({ ...r, findings: [elsewhere, atRoot] }, null)).toEqual([elsewhere, atRoot]);
  });

  it("reads the engine's own output on its fixtures (root package, none, unknown with its config line)", () => {
    const clerk = engine("next_clerk");
    expect(clerk.recipes[0].package).toBe("");
    expect(pkgLabel(clerk.recipes[0].package)).toBe(".");
    expect(recipesIn(clerk, "").length).toBe(1);
    expect(concernsIn(clerk, "").map((x) => x.concern.id)).toEqual(["authn"]);
    expect(findingText(clerk, clerk.findings[0]).title).toBe("Authentication in .: 1 entry point, no guard");
    const nest = engine("nest_mixed");
    const hint = nest.findings.find((f) => f.kind === "unknown")!;
    expect(hint.config_hint).toMatch(/^practices: \{authn: \{"pkg:@nestjs\/common#\w+": "\w+"\}\}$/);
    expect(nest.concerns[0].unknown.instruments.every((i) => i.config_hint === undefined || i.config_hint.startsWith("practices: {authn: "))).toBe(true);
    expect(concernIn(nest.concerns[0], null, 0.9)!.bar).toMatchObject({ coverage: 0, unknown: 2 });
    const split = engine("fastapi_split");
    expect(recipesIn(split, "services/legacy")[0].concerns[0]).toMatchObject({ variants: [], none: 1, copy: null });
    expect(variantLabel(split, "authn", "P-ffffff")).toBe("P-ffffff");
  });

  it("marks logging, config, data_access and testing as a preview", () => {
    expect(PRACTICE_CONCERNS.filter(isPreview)).toEqual(["logging", "config", "data_access", "testing"]);
  });
});

describe("groups: variants sharing their decisive instrument (concerns[].groups)", () => {
  it("known groups sum to the known units, none groups to the none units, and a group is for the whole repository", () => {
    for (const c of acme().concerns) {
      const g = c.groups ?? [];
      expect(g.filter((x) => x.kind === "known").reduce((n, x) => n + x.members, 0), c.id).toBe(c.population.known);
      expect(g.filter((x) => x.kind === "none").reduce((n, x) => n + x.members, 0), c.id).toBe(c.population.none);
      for (const x of g) expect(x.top.length).toBeLessThanOrEqual(x.variants);
    }
    expect(groupsOf(concern("authz"), null)?.length).toBe(3);
    expect(groupsOf(concern("authz"), "apps/web")).toBeNull();
    expect(groupsOf({ ...concern("authz"), groups: undefined }, null)).toBeNull();
  });

  it("names a group by what its variants share, and its sub-variants in Drift's order", () => {
    const g = concern("authz").groups![0];
    expect(g.label).toBe("2 variants sharing withWorkspace");
    expect(groupHint(g)).toBe(`shares apps/web/lib/auth.ts#withWorkspace${g.mechanisms.length ? ` · by ${g.mechanisms.join(", ")}` : ""}`);
    expect(g.top.map((t) => t.members)).toEqual([36, 34]);
    expect(groupMore(g)).toBe(0);
    const data = concern("data_access").groups![0];
    expect([data.label, data.variants, groupMore(data)]).toEqual(["4 variants sharing @prisma/client", 4, Math.max(0, 4 - data.top.length)]);
    const authn = concern("authn").groups!.find((x) => x.instrument.endsWith("#AuthGuard"))!;
    expect([authn.class, authn.members]).toEqual(["user", 47]);
    expect(groupHint(authn)).toMatch(/^shares apps\/api\/src\/common\/auth\.guard\.ts#AuthGuard · by .* · callers: user$/);
  });
});
