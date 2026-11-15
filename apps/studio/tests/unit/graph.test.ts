import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { RepoMap, areaOf, layerAreas } from "@/features/map";
import type { FileFacts, RepoFacts } from "@/shared/contract/drift";
import { census, facts } from "./helpers";

describe("map aggregation", () => {
  const f = facts();
  const map = new RepoMap(f);

  it("uses Drift's areas (first two directory segments)", () => {
    expect(areaOf("apps/web/app/api/x/route.ts")).toBe("apps/web");
    expect(areaOf("src/x.ts")).toBe("src");
    expect(areaOf("x.ts")).toBe("(root)");
    const g = map.build({ expanded: new Set() });
    expect(g.nodes.every((n) => n.kind === "area")).toBe(true);
    expect(g.nodes.find((n) => n.path === "apps/web")?.files).toBe(f.files.filter((x) => x.path.startsWith("apps/web/")).length);
  });

  it("aggregates file imports into weighted edges between visible nodes", () => {
    const g = map.build({ expanded: new Set() });
    const e = g.edges.find((x) => x.source === "a:apps/web" && x.target === "a:packages/ui");
    expect(e?.weight).toBeGreaterThan(5);
    expect(g.edges.every((x) => x.source !== x.target)).toBe(true);
  });

  it("expands areas into directories and files, folding the tail", () => {
    const g = map.build({ expanded: new Set(["a:apps/web"]), maxChildren: 2 });
    const kids = g.nodes.filter((n) => n.parent === "a:apps/web");
    expect(kids.length).toBe(3);
    expect(kids.at(-1)?.kind).toBe("more");
    // Edges still connect the folded node.
    expect(g.edges.some((e) => e.source.startsWith("m:") || e.target.startsWith("m:"))).toBe(true);
  });

  it("expands a file into its symbols with wrappers", () => {
    const file = "apps/web/app/api/workspaces/[id]/links/route.ts";
    const g = map.build({ expanded: new Set(map.ancestorsOf(file).concat(`f:${file}`)) });
    const sym = g.nodes.find((n) => n.kind === "symbol" && n.path === file && n.label === "GET");
    expect(sym?.symbol?.wraps[0]?.wrapper).toMatch(/withWorkspace/);
    expect(sym?.symbol?.entry).toBe("http");
  });

  it("marks edges that break a layering rule, using Drift's own outliers", () => {
    const rule = census().proposals.find((p) => p.rule.type === "avoids" && p.rule.signal === "import:apps/web")!;
    const g = map.build({
      expanded: new Set(),
      layering: [{ id: rule.id, status: "accepted", package: rule.role.package, dir: rule.role.dir, rule: rule.rule, violators: rule.outliers.map((o) => o.path) }],
    });
    const v = g.edges.find((e) => e.violates.includes(rule.id))!;
    expect(v.source).toBe("a:packages/ui");
    expect(v.target).toBe("a:apps/web");
    expect(g.rules[0]).toMatchObject({ sourceNode: "a:packages/ui", targetNode: "a:apps/web" });
  });

  it("layers areas so cycles share a layer", () => {
    const deps = new Map([
      ["a", new Map([["b", 1]])],
      ["b", new Map([["c", 1]])],
      ["c", new Map([["b", 1]])],
    ]);
    const l = layerAreas(["a", "b", "c", "d"], deps);
    expect(l.get("b")).toBe(l.get("c"));
    expect(l.get("a")).toBe((l.get("b") ?? 0) + 1);
    expect(l.get("d")).toBe(0);
  });
});

describe("deferred loads (facts schema 6)", () => {
  it("counts value imports loaded lazily on each edge, apart from static ones", () => {
    const file = (path: string, imports: FileFacts["imports"]): FileFacts => ({ path, lang: "ts", package: path.split("/").slice(0, 2).join("/"), parse_ok: true, directives: [], imports, symbols: [], entry_points: [] });
    const f: RepoFacts = {
      schema_version: 6,
      skipped: [],
      files: [
        file("packages/core/a.ts", [{ module: "packages/micro/index.ts", names: ["default"], type_only: false, load: "dynamic" }]),
        file("packages/core/b.ts", [{ module: "packages/micro/index.ts", names: ["*"], type_only: false, load: "lazy" }]),
        file("packages/core/c.ts", [{ module: "packages/micro/index.ts", names: ["x"], type_only: false }]),
        file("packages/core/d.ts", [{ module: "packages/micro/index.ts", names: ["T"], type_only: true }]),
        file("packages/micro/index.ts", []),
      ],
    };
    const e = new RepoMap(f).build({ expanded: new Set() }).edges.find((x) => x.source === "a:packages/core" && x.target === "a:packages/micro");
    expect(e).toMatchObject({ weight: 3, deferred: 2 });
  });
});

function synthetic(n: number): RepoFacts {
  const files: FileFacts[] = [];
  for (let i = 0; i < n; i++) {
    const pkg = `packages/p${i % 40}`;
    const path = `${pkg}/src/d${i % 25}/f${i}.ts`;
    const imports = Array.from({ length: 6 }, (_, k) => ({ module: `packages/p${(i + k * 7) % 40}/src/d${(i + k) % 25}/f${(i * 31 + k * 977) % n}.ts`, names: [], type_only: k === 5 }));
    files.push({ path, lang: "ts", package: pkg, parse_ok: true, directives: [], imports, symbols: [{ name: "x", kind: "function", exported_as: ["x"], line: 1, wraps: [] }], entry_points: [] });
  }
  return { schema_version: 4, files, skipped: [] };
}

describe("map performance", () => {
  it("builds and re-aggregates a 36k-file repository quickly", () => {
    const f = synthetic(36_000);
    let t = performance.now();
    const m = new RepoMap(f);
    const build = performance.now() - t;
    t = performance.now();
    const g = m.build({ expanded: new Set(["a:packages/p1", "a:packages/p2"]) });
    const agg = performance.now() - t;
    expect(g.nodes.length).toBeLessThan(200);
    expect(g.edges.length).toBeLessThanOrEqual(600 + g.edges.filter((e) => e.violates.length).length);
    // Budgets with headroom for slow CI machines; typical numbers are logged.
    console.log(`36k synthetic: model ${build.toFixed(0)} ms, aggregate ${agg.toFixed(0)} ms, ${m.edgeCount} distinct file edges`);
    expect(build).toBeLessThan(4000);
    expect(agg).toBeLessThan(400);
  });

  const twenty = new URL("../../fixtures/local/twenty/facts.json.gz", import.meta.url);
  it.skipIf(!existsSync(twenty))("handles twenty (36k files, generated locally)", () => {
    const f = JSON.parse(gunzipSync(readFileSync(twenty)).toString("utf8")) as RepoFacts;
    let t = performance.now();
    const m = new RepoMap(f);
    const build = performance.now() - t;
    t = performance.now();
    const g = m.build({ expanded: new Set([m.areas[0].id]) });
    const agg = performance.now() - t;
    console.log(`twenty: ${f.files.length} files, model ${build.toFixed(0)} ms, aggregate ${agg.toFixed(0)} ms, ${g.nodes.length} nodes, ${g.edges.length} edges`);
    expect(agg).toBeLessThan(400);
  });
});
