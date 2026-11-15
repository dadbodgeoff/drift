// The codebase map: Drift's facts aggregated into a graph that stays small
// enough to draw. Areas (Drift's own notion: the first two directory segments,
// see `area()` in crates/drift-mine/src/mine.rs) are the top-level nodes;
// any node can be expanded into directories, then files, then symbols. Import
// edges are aggregated between whatever nodes are visible.
//
// Built once per scan (O(files + imports)); each expand/collapse re-aggregates
// in O(files + distinct file edges), which is a few milliseconds at 36k files.
import { isDeferred, type FileFacts, type MapDependency, type MapPackage, type RepoFacts, type Rule } from "@/shared/contract/drift";
import { layeringTarget } from "@/entities/convention";

export type MapNodeKind = "area" | "dir" | "file" | "symbol" | "more";

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  label: string;
  /** Repo-relative path prefix (or file path) the node stands for. */
  path: string;
  parent: string | null;
  files: number;
  symbols: number;
  package: string;
  /** Entry points by kind (`http`, `page`, ...). */
  entries: Record<string, number>;
  violations: number;
  layer: number;
  expandable: boolean;
  expanded: boolean;
  /** For symbols: kind, line, wrappers/decorators, entry kind. */
  symbol?: { kind: string; line: number; wraps: { wrapper: string; kind: string }[]; entry: string | null; exported: boolean; controls?: string[]; fieldDecorators?: string[]; traits?: string[] };
  /** For `more` nodes: how many children are folded in. */
  folded?: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  /** File-to-file imports aggregated into this edge. */
  weight: number;
  /** Of `weight`, value imports loaded only when the code holding them runs (`import()`, a
   * `require()` in a function, a lazy-load helper; facts schema 6). Drift does not count
   * these against a layering rule when the package declares the target a peer or optional dependency. */
  deferred: number;
  /** Ids of layering conventions this edge breaks (from Drift's outliers). */
  violates: string[];
  /** A layering rule says the source must not import the target (any edge, not only violating ones). */
  forbidden: string[];
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Edges dropped by the edge cap (lightest first). */
  hiddenEdges: number;
  /** Layering rules drawn as overlays: source scope, target area. */
  rules: LayeringOverlay[];
}

export interface LayeringRule {
  id: string;
  status: string;
  /** Role scope: package and directory below it (`**` = the whole package). */
  package: string;
  dir: string;
  rule: Rule;
  /** Files Drift reported as breaking the rule (census outliers or check violations). */
  violators: string[];
}

export interface LayeringOverlay {
  id: string;
  status: string;
  sourceArea: string;
  targetArea: string;
  sourceNode: string | null;
  targetNode: string | null;
  violators: number;
}

export interface BuildOptions {
  expanded: Set<string>;
  /** Children shown per expanded node; the rest fold into one `more` node. */
  maxChildren?: number;
  maxEdges?: number;
  /** Count `import type` edges too. */
  typeOnly?: boolean;
  layering?: LayeringRule[];
  /** New violations per file path. */
  violations?: Map<string, number>;
}

/** Drift's area of a path: the first one or two directory segments. */
export function areaOf(path: string): string {
  const segs = path.split("/");
  const n = Math.min(Math.max(segs.length - 1, 1), 2);
  return segs.length === 1 ? "(root)" : segs.slice(0, n).join("/");
}

interface Dir {
  id: string;
  path: string;
  name: string;
  parent: Dir | null;
  dirs: Map<string, Dir>;
  files: number[];
  total: number;
  symbols: number;
  entries: Record<string, number>;
  areaIdx: number;
}

export class RepoMap {
  readonly files: FileFacts[];
  readonly areas: Dir[] = [];
  private readonly areaIdx = new Map<string, number>();
  /** Per file: the chain of Dir nodes from its area down to its directory. */
  private readonly chain: Dir[][] = [];
  /** Distinct file edges, value vs type-only: src, dst, count. */
  private readonly eSrc: Int32Array;
  private readonly eDst: Int32Array;
  private readonly eW: Int32Array;
  private readonly eTypeW: Int32Array;
  private readonly eDeferW: Int32Array;
  readonly layers: Map<string, number>;
  readonly areaDeps: Map<string, Map<string, number>>;

  constructor(facts: RepoFacts) {
    this.files = facts.files;
    const byPath = new Map<string, number>();
    this.files.forEach((f, i) => byPath.set(f.path, i));
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i];
      const area = areaOf(f.path);
      let ai = this.areaIdx.get(area);
      if (ai === undefined) {
        ai = this.areas.length;
        this.areaIdx.set(area, ai);
        this.areas.push(newDir(`a:${area}`, area, area, null, ai));
      }
      const root = this.areas[ai];
      const segs = f.path.split("/");
      const below = area === "(root)" ? [] : segs.slice(area.split("/").length, -1);
      const chain = [root];
      let d = root;
      let prefix = area;
      for (const s of below) {
        prefix = `${prefix}/${s}`;
        let c = d.dirs.get(s);
        if (!c) {
          c = newDir(`d:${prefix}`, prefix, s, d, ai);
          d.dirs.set(s, c);
        }
        d = c;
        chain.push(d);
      }
      d.files.push(i);
      for (const c of chain) {
        c.total++;
        c.symbols += f.symbols.length;
        for (const e of f.entry_points) c.entries[e.kind] = (c.entries[e.kind] ?? 0) + 1;
      }
      this.chain.push(chain);
    }
    // Distinct file edges.
    const pairs = new Map<number, [number, number, number]>();
    const n = this.files.length;
    for (let i = 0; i < n; i++) {
      for (const imp of this.files[i].imports) {
        if (imp.module.includes(":")) continue;
        const j = byPath.get(imp.module);
        if (j === undefined || j === i) continue;
        const k = i * n + j;
        const p = pairs.get(k) ?? [0, 0, 0];
        if (imp.type_only) p[1]++;
        else {
          p[0]++;
          if (isDeferred(imp)) p[2]++;
        }
        pairs.set(k, p);
      }
    }
    this.eSrc = new Int32Array(pairs.size);
    this.eDst = new Int32Array(pairs.size);
    this.eW = new Int32Array(pairs.size);
    this.eTypeW = new Int32Array(pairs.size);
    this.eDeferW = new Int32Array(pairs.size);
    let e = 0;
    for (const [k, [w, tw, dw]] of pairs) {
      this.eSrc[e] = Math.floor(k / n);
      this.eDst[e] = k % n;
      this.eW[e] = w;
      this.eTypeW[e] = tw;
      this.eDeferW[e] = dw;
      e++;
    }
    this.areaDeps = this.computeAreaDeps();
    this.layers = layerAreas(this.areas.map((a) => a.path), this.areaDeps);
  }

  get edgeCount(): number {
    return this.eSrc.length;
  }

  private computeAreaDeps(): Map<string, Map<string, number>> {
    const deps = new Map<string, Map<string, number>>();
    for (let e = 0; e < this.eSrc.length; e++) {
      if (this.eW[e] === 0) continue;
      const a = this.areas[this.chain[this.eSrc[e]][0].areaIdx].path;
      const b = this.areas[this.chain[this.eDst[e]][0].areaIdx].path;
      if (a === b) continue;
      const m = deps.get(a) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + this.eW[e]);
      deps.set(a, m);
    }
    return deps;
  }

  /** The node id for a path prefix or file, if it exists. */
  nodeIdForPath(path: string): string | null {
    const i = this.files.findIndex((f) => f.path === path);
    if (i >= 0) return `f:${path}`;
    for (const a of this.areas) if (a.path === path) return a.id;
    return this.findDir(path)?.id ?? null;
  }

  private findDir(path: string): Dir | null {
    const area = this.areas.find((a) => path === a.path || path.startsWith(`${a.path}/`));
    if (!area) return null;
    let d: Dir = area;
    if (path === area.path) return d;
    for (const s of path.slice(area.path.length + 1).split("/")) {
      const c = d.dirs.get(s);
      if (!c) return null;
      d = c;
    }
    return d;
  }

  /** Ids of every ancestor to expand so that `path` (a file) becomes visible. */
  ancestorsOf(path: string): string[] {
    const i = this.files.findIndex((f) => f.path === path);
    if (i < 0) return [];
    return this.chain[i].map((d) => d.id);
  }

  build(opts: BuildOptions): MapGraph {
    const expanded = opts.expanded;
    const maxChildren = opts.maxChildren ?? 40;
    const maxEdges = opts.maxEdges ?? 600;
    const viol = opts.violations ?? new Map<string, number>();
    const nodes: MapNode[] = [];
    const visibleFile = new Int32Array(this.files.length).fill(-1);
    const nodeIndex = new Map<string, number>();
    const add = (n: MapNode) => {
      nodeIndex.set(n.id, nodes.length);
      nodes.push(n);
      return nodes.length - 1;
    };
    const layerOf = (d: Dir) => this.layers.get(this.areas[d.areaIdx].path) ?? 0;
    const pkgOf = (d: Dir) => {
      const first = this.firstFile(d);
      return first === undefined ? "" : this.files[first].package;
    };
    const violOf = (d: Dir) => {
      let n = 0;
      this.eachFile(d, (i) => {
        n += viol.get(this.files[i].path) ?? 0;
      });
      return n;
    };
    const assign = (d: Dir, idx: number) => this.eachFile(d, (i) => (visibleFile[i] = idx));

    const visit = (d: Dir, parent: string | null) => {
      const isOpen = expanded.has(d.id);
      const idx = add({
        id: d.id,
        kind: parent === null ? "area" : "dir",
        label: parent === null ? d.path : d.name,
        path: d.path,
        parent,
        files: d.total,
        symbols: d.symbols,
        package: pkgOf(d),
        entries: d.entries,
        violations: violOf(d),
        layer: layerOf(d),
        expandable: d.total > 0,
        expanded: isOpen,
      });
      if (!isOpen) {
        assign(d, idx);
        return;
      }
      // Children: directories and files, biggest first; the tail folds into `more`.
      type Child = { dir?: Dir; file?: number; size: number; name: string };
      const kids: Child[] = [
        ...[...d.dirs.values()].map((c) => ({ dir: c, size: c.total, name: c.name })),
        ...d.files.map((i) => ({ file: i, size: 1, name: this.files[i].path.split("/").pop() ?? "" })),
      ].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
      const shown = kids.length > maxChildren + 1 ? kids.slice(0, maxChildren) : kids;
      const rest = kids.slice(shown.length);
      for (const k of shown) {
        if (k.dir) visit(k.dir, d.id);
        else this.visitFile(k.file!, d.id, expanded, add, visibleFile, viol, layerOf(d));
      }
      if (rest.length) {
        const midx = add({
          id: `m:${d.path}`,
          kind: "more",
          label: `${rest.length} more`,
          path: d.path,
          parent: d.id,
          files: rest.reduce((n, k) => n + k.size, 0),
          symbols: 0,
          package: pkgOf(d),
          entries: {},
          violations: 0,
          layer: layerOf(d),
          expandable: false,
          expanded: false,
          folded: rest.length,
        });
        for (const k of rest) {
          if (k.dir) assign(k.dir, midx);
          else visibleFile[k.file!] = midx;
          nodes[midx].violations += k.dir ? violOf(k.dir) : (viol.get(this.files[k.file!].path) ?? 0);
        }
      }
    };
    for (const a of [...this.areas].sort((x, y) => y.total - x.total || x.path.localeCompare(y.path))) visit(a, null);

    // Layering: which files may not import which area, and which actually do.
    const rules = opts.layering ?? [];
    const forbidden = new Map<number, { target: string; id: string }[]>();
    const violators = new Map<number, Set<string>>();
    const byPath = new Map(this.files.map((f, i) => [f.path, i]));
    for (const r of rules) {
      const target = layeringTarget(r.rule);
      if (!target) continue;
      for (let i = 0; i < this.files.length; i++) {
        const f = this.files[i];
        if (inScope(f, r.package, r.dir)) {
          const l = forbidden.get(i) ?? [];
          l.push({ target, id: r.id });
          forbidden.set(i, l);
        }
      }
      for (const p of r.violators) {
        const i = byPath.get(p);
        if (i === undefined) continue;
        const s = violators.get(i) ?? new Set<string>();
        s.add(r.id);
        violators.set(i, s);
      }
    }

    // Aggregate file edges between visible nodes.
    const agg = new Map<string, MapEdge>();
    for (let e = 0; e < this.eSrc.length; e++) {
      const w = this.eW[e] + (opts.typeOnly ? this.eTypeW[e] : 0);
      if (w === 0) continue;
      const s = visibleFile[this.eSrc[e]];
      const t = visibleFile[this.eDst[e]];
      if (s < 0 || t < 0 || s === t) continue;
      const sn = nodes[s];
      const tn = nodes[t];
      // An edge into a node's own descendant is drawn inside the group, not to it.
      const key = `${sn.id}>${tn.id}`;
      let edge = agg.get(key);
      if (!edge) {
        edge = { id: key, source: sn.id, target: tn.id, weight: 0, deferred: 0, violates: [], forbidden: [] };
        agg.set(key, edge);
      }
      edge.weight += w;
      edge.deferred += this.eDeferW[e];
      const src = this.eSrc[e];
      const dstArea = this.areas[this.chain[this.eDst[e]][0].areaIdx].path;
      const rulesHere = forbidden.get(src);
      if (rulesHere && this.eW[e] > 0) {
        for (const r of rulesHere) {
          if (r.target !== dstArea) continue;
          if (!edge.forbidden.includes(r.id)) edge.forbidden.push(r.id);
          if (violators.get(src)?.has(r.id) && !edge.violates.includes(r.id)) edge.violates.push(r.id);
        }
      }
    }
    const all = [...agg.values()].sort((a, b) => b.violates.length - a.violates.length || b.weight - a.weight || a.id.localeCompare(b.id));
    const keep = all.filter((e, i) => i < maxEdges || e.violates.length > 0);

    const overlays: LayeringOverlay[] = rules
      .map((r) => {
        const target = layeringTarget(r.rule);
        if (!target) return null;
        const sourceArea = r.dir === "**" || !r.dir ? r.package || "(root)" : areaOf(`${r.package ? r.package + "/" : ""}${r.dir}/x`);
        const ta = this.areaIdx.get(target);
        const sa = this.areaIdx.get(sourceArea);
        return {
          id: r.id,
          status: r.status,
          sourceArea,
          targetArea: target,
          sourceNode: sa === undefined ? null : this.areas[sa].id,
          targetNode: ta === undefined ? null : this.areas[ta].id,
          violators: r.violators.length,
        };
      })
      .filter((x): x is LayeringOverlay => x !== null);
    return { nodes, edges: keep, hiddenEdges: all.length - keep.length, rules: overlays };
  }

  private visitFile(
    i: number,
    parent: string,
    expanded: Set<string>,
    add: (n: MapNode) => number,
    visibleFile: Int32Array,
    viol: Map<string, number>,
    layer: number,
  ) {
    const f = this.files[i];
    const id = `f:${f.path}`;
    const isOpen = expanded.has(id);
    const entries: Record<string, number> = {};
    for (const e of f.entry_points) entries[e.kind] = (entries[e.kind] ?? 0) + 1;
    visibleFile[i] = add({
      id,
      kind: "file",
      label: f.path.split("/").pop() ?? f.path,
      path: f.path,
      parent,
      files: 1,
      symbols: f.symbols.length,
      package: f.package,
      entries,
      violations: viol.get(f.path) ?? 0,
      layer,
      expandable: f.symbols.length > 0,
      expanded: isOpen,
    });
    if (!isOpen) return;
    const entryOf = new Map(f.entry_points.map((e) => [e.symbol, e.kind]));
    for (const s of f.symbols.slice(0, 60)) {
      const entry = entryOf.get(s.name) ?? s.exported_as.map((x) => entryOf.get(x)).find(Boolean) ?? null;
      add({
        id: `s:${f.path}#${s.name}`,
        kind: "symbol",
        label: s.name,
        path: f.path,
        parent: id,
        files: 0,
        symbols: 1,
        package: f.package,
        entries: entry ? { [entry]: 1 } : {},
        violations: 0,
        layer,
        expandable: false,
        expanded: false,
        symbol: { kind: s.kind, line: s.line, wraps: s.wraps, entry, exported: s.exported_as.length > 0, controls: s.controls, fieldDecorators: s.field_decorators, traits: s.traits },
      });
    }
  }

  private eachFile(d: Dir, fn: (i: number) => void) {
    for (const i of d.files) fn(i);
    for (const c of d.dirs.values()) this.eachFile(c, fn);
  }

  private firstFile(d: Dir): number | undefined {
    if (d.files.length) return d.files[0];
    for (const c of d.dirs.values()) {
      const f = this.firstFile(c);
      if (f !== undefined) return f;
    }
    return undefined;
  }
}

function newDir(id: string, path: string, name: string, parent: Dir | null, areaIdx: number): Dir {
  return { id, path, name, parent, dirs: new Map(), files: [], total: 0, symbols: 0, entries: {}, areaIdx };
}

/** Whether a file is in a role's scope (package plus directory prefix; `[*]` matches any segment). */
export function inScope(f: FileFacts, pkg: string, dir: string): boolean {
  if (f.package !== pkg) return false;
  if (dir === "**" || dir === "") return true;
  const rel = pkg ? f.path.slice(pkg.length + 1) : f.path;
  const segs = rel.split("/").slice(0, -1);
  const want = dir.split("/");
  if (segs.length < want.length) return false;
  return want.every((w, i) => (w === "[*]" ? segs[i].startsWith("[") && segs[i].endsWith("]") : w === segs[i]));
}

/**
 * Layer of each area: 0 for areas that import no other area, otherwise one more
 * than the deepest area they import, computed on the graph of strongly
 * connected components so cycles share a layer.
 */
export function layerAreas(areas: string[], deps: Map<string, Map<string, number>>): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let counter = 0;
  let comps = 0;
  const strong = (v: string) => {
    // Iterative Tarjan to stay safe on deep graphs.
    const work: [string, string[], number][] = [[v, [...(deps.get(v)?.keys() ?? [])], 0]];
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [node, succ] = top;
      if (top[2] < succ.length) {
        const w = succ[top[2]++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push([w, [...(deps.get(w)?.keys() ?? [])], 0]);
        } else if (onStack.has(w)) low.set(node, Math.min(low.get(node)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
      if (low.get(node) === index.get(node)) {
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.set(w, comps);
        } while (w !== node);
        comps++;
      }
    }
  };
  for (const a of areas) if (!index.has(a)) strong(a);
  // Tarjan emits components in reverse topological order: dependencies first.
  const compLayer = new Array<number>(comps).fill(0);
  const members = new Map<number, string[]>();
  for (const [a, c] of comp) members.set(c, [...(members.get(c) ?? []), a]);
  for (let c = 0; c < comps; c++) {
    let l = 0;
    for (const a of members.get(c) ?? [])
      for (const b of deps.get(a)?.keys() ?? []) {
        const cb = comp.get(b);
        if (cb !== undefined && cb !== c) l = Math.max(l, compLayer[cb] + 1);
      }
    compLayer[c] = l;
  }
  return new Map(areas.map((a) => [a, compLayer[comp.get(a) ?? 0] ?? 0]));
}

/** One package's dependencies as `drift map --json` lists them (round 13): production and test apart. */
export interface PackageDependencies {
  production: MapDependency[];
  /** Imports made by test files, or of a package the importer has only as a dev dependency. */
  test: (MapDependency & { alsoProduction: boolean })[];
}

/** The dependencies of the package at `path` ("" for the root), or null when `drift map` lists no such package. */
export function packageDependencies(packages: readonly MapPackage[] | undefined, path: string): PackageDependencies | null {
  const p = packages?.find((x) => x.path === path);
  if (!p) return null;
  const prod = new Set(p.depends_on.map((d) => d.package));
  return { production: p.depends_on, test: (p.dependencies_test ?? []).map((d) => ({ ...d, alsoProduction: prod.has(d.package) })) };
}
