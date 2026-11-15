// The codebase map: areas, directories, files and symbols as Drift sees them,
// import edges aggregated between visible nodes, layering rules as overlays
// and violating edges highlighted. Visual grammar: docs/DESIGN.md, "Map".
import { useEffect, useMemo, useRef, useState } from "react";
import { GraphCanvas, type GraphEdge, type GraphNode } from "@drift/ui/graph";
import { Badge, Button, EmptyState, ErrorState, Icon, IconButton, KeyValue, SearchInput, SegmentedControl, StateLabel, Switch, Tag, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useCheck, useDriftMap, useFacts } from "@/entities/drift";
import { UNKNOWN_BASE_TITLE, isUnknownBase, layeringTarget, shortRef, useConventions } from "@/entities/convention";
import { stateOf } from "@/entities/check";
import { INPUT_LABEL, inputOf, searchFiles, symbolTrait, useFactsIndex } from "@/entities/facts";
import { num } from "@/shared/lib/format";
import { log } from "@/shared/lib/log";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";
import { type LayeringRule, type MapEdge, type MapGraph, type MapNode, RepoMap, packageDependencies } from "./model/graph";
import { type EdgeData, type NodeData, edgeTypes, nodeTypes } from "./nodes";

type ColorBy = "package" | "layer" | "health";
const MAX_VISIBLE = 420;

function hashIndex(s: string, n: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

function colorFor(n: MapNode, by: ColorBy): string {
  if (by === "package") return `var(--data-cat-${hashIndex(n.package || "(root)", 8) + 1})`;
  if (by === "layer") return `var(--data-seq-${Math.min(6, n.layer + 1)})`;
  return n.violations ? "var(--color-danger)" : "var(--color-border-strong)";
}

/** Magnitude on a log scale, 1..6, for the sequential ramp: 1-2 files, 3-9, 10-29, 30-99, 100-299, 300+. */
export function depthOf(files: number): number {
  if (files < 3) return 1;
  return Math.min(6, 1 + Math.floor(Math.log10(files / 3) * 2) + 1);
}

function size(n: MapNode): { width: number; height: number } {
  if (n.kind === "symbol") return { width: 196, height: 58 };
  if (n.kind === "more") return { width: 160, height: 52 };
  if (n.kind === "file") return { width: 216, height: Object.keys(n.entries).length ? 80 : 58 };
  // Size by file count (square root, so area reads as magnitude), capped to keep the layout calm.
  const w = Math.round(168 + Math.min(220, Math.sqrt(n.files) * 14));
  const h = Math.round(58 + Math.min(34, Math.sqrt(n.files) * 2.6));
  return { width: w, height: h + (Object.keys(n.entries).length ? 24 : 0) };
}

export function MapView({ focus }: { focus: string | null }) {
  const { repo } = useRepo();
  const facts = useFacts(repo);
  const conv = useConventions(repo);
  const check = useCheck(repo);
  const openCode = useOpenCode();
  const toast = useToast();
  const ix = useFactsIndex(facts.data?.data);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("package");
  const [typeOnly, setTypeOnly] = useState(false);
  const [rulesOn, setRulesOn] = useState(true);
  const [q, setQ] = useState("");
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const [lastToggled, setLastToggled] = useState<string | null>(null);

  const map = useMemo(() => {
    if (!facts.data) return null;
    const t0 = performance.now();
    const m = new RepoMap(facts.data.data);
    log("info", "map model built", { files: m.files.length, edges: m.edgeCount, ms: Math.round(performance.now() - t0) });
    return m;
  }, [facts.data]);

  const layering: LayeringRule[] = useMemo(() => {
    const out: LayeringRule[] = [];
    const viol = check.data?.data.violations ?? [];
    for (const r of conv.rows) {
      if (r.status === "rejected" || !layeringTarget(r.rule)) continue;
      const fromCheck = viol.filter((v) => v.id === r.id).map((v) => v.path);
      const fromCensus = (r.outliers ?? []).map((o) => o.path);
      out.push({ id: r.id, status: r.status, package: r.role.package, dir: r.role.dir, rule: r.rule, violators: [...new Set([...fromCheck, ...fromCensus])] });
    }
    return out;
  }, [conv.rows, check.data]);

  const violations = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of check.data?.data.violations ?? []) if (stateOf(v) === "new") m.set(v.path, (m.get(v.path) ?? 0) + 1);
    return m;
  }, [check.data]);

  // Focus a package from elsewhere (?focus=apps/web): expand it.
  useEffect(() => {
    if (!map || !focus) return;
    const id = map.nodeIdForPath(focus);
    if (id) {
      setExpanded(new Set([id]));
      setSelected(id);
    }
  }, [map, focus]);

  const graph: MapGraph | null = useMemo(() => {
    if (!map) return null;
    const t0 = performance.now();
    const g = map.build({ expanded, typeOnly, layering: rulesOn ? layering : [], violations });
    log("debug", "map aggregated", { nodes: g.nodes.length, edges: g.edges.length, ms: Math.round(performance.now() - t0) });
    return g;
  }, [map, expanded, typeOnly, rulesOn, layering, violations]);

  const neighbours = useMemo(() => {
    if (!graph || !selected) return null;
    const s = new Set<string>([selected]);
    for (const e of graph.edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [graph, selected]);

  const gnodes: GraphNode[] = useMemo(
    () =>
      (graph?.nodes ?? []).map((n) => {
        const data: NodeData = { node: n, color: colorFor(n, colorBy), depth: depthOf(n.kind === "file" ? n.symbols : n.files), share: map ? n.files / Math.max(1, map.files.length) : 0, ariaLabel: `${n.kind} ${n.path}, ${n.files} files${n.violations ? `, ${n.violations} new violations` : ""}`, dim: !!neighbours && !neighbours.has(n.id) && !n.expanded };
        return { id: n.id, parent: n.parent, ...size(n), type: "map", data };
      }),
    [graph, colorBy, neighbours, map],
  );
  const gedges: GraphEdge[] = useMemo(() => {
    if (!graph) return [];
    const es: GraphEdge[] = graph.edges.map((e) => {
      const data: EdgeData = { weight: e.weight, violates: e.violates, forbidden: e.forbidden, dim: !!selected && e.source !== selected && e.target !== selected };
      return { id: e.id, source: e.source, target: e.target, type: "map", data, emphasis: e.violates.length > 0 };
    });
    if (rulesOn)
      for (const r of graph.rules) {
        if (!r.sourceNode || !r.targetNode || r.sourceNode === r.targetNode) continue;
        // A visible import that violates the rule already draws (and names) it: one marked edge, not two lines side by side.
        if (graph.edges.some((e) => e.violates.includes(r.id))) continue;
        const data: EdgeData = { weight: 0, violates: [], forbidden: [r.id], rule: true, dim: false };
        es.push({ id: `rule:${r.id}`, source: r.sourceNode, target: r.targetNode, type: "map", data, emphasis: true });
      }
    return es;
  }, [graph, rulesOn, selected]);

  const toggle = (id: string) => {
    if (!graph) return;
    const n = graph.nodes.find((x) => x.id === id);
    if (!n || !n.expandable) return;
    const next = new Set(expanded);
    if (next.has(id)) {
      // Collapse the node and everything inside it.
      for (const x of [...next]) if (x === id || x.slice(2).startsWith(n.path + "/") || x.slice(2) === n.path) next.delete(x);
    } else {
      const children = n.kind === "file" ? Math.min(60, n.symbols) : 41;
      if (graph.nodes.length + children > MAX_VISIBLE) {
        toast.show({ title: "Too many nodes to draw", body: `The map shows at most ${MAX_VISIBLE} nodes. Collapse something first.`, tone: "warning" });
        return;
      }
      next.add(id);
    }
    setLastToggled(id);
    setExpanded(next);
  };

  const reveal = (path: string) => {
    if (!map) return;
    const anc = map.ancestorsOf(path);
    setExpanded(new Set([...expanded, ...anc]));
    setSelected(`f:${path}`);
    setQ("");
  };

  // Enter toggles the selected node; Escape clears the selection.
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        toggle(selected);
      } else if (e.key === "Escape" && selected) setSelected(null);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });

  if (facts.isLoading) return <Loading label="Loading the map" />;
  if (facts.error) return <ErrorState title="No facts to draw" error={facts.error} onRetry={() => void facts.refetch()} />;
  if (!graph || !map) return <EmptyState title="No facts yet" />;

  const sel = selected ? graph.nodes.find((n) => n.id === selected) : null;
  const selEdge = selected && !sel ? (graph.edges.find((e) => e.id === selected) ?? null) : null;
  const selRule = selected?.startsWith("rule:") ? graph.rules.find((r) => `rule:${r.id}` === selected) : null;
  const matches = q && ix ? searchFiles(ix, q, 8) : [];
  const violating = graph.edges.filter((e) => e.violates.length).length;

  return (
    <div className="mp" ref={box}>
      <div className="mp-toolbar">
        <SegmentedControl<ColorBy>
          label="Colour by"
          size="sm"
          value={colorBy}
          onValueChange={setColorBy}
          items={[
            { value: "package", label: "Package" },
            { value: "layer", label: "Layer" },
            { value: "health", label: "Health" },
          ]}
        />
        <Switch checked={rulesOn} onCheckedChange={setRulesOn} label="Layering rules" />
        <Switch checked={typeOnly} onCheckedChange={setTypeOnly} label="Type imports" />
        <div className="mp-search">
          <SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Reveal a file" label="Reveal a file on the map" />
          {matches.length > 0 && (
            <ul className="mp-search__results" role="listbox" aria-label="Files">
              {matches.map((p) => (
                <li key={p} role="option" aria-selected="false">
                  <button type="button" onClick={() => reveal(p)} className="dui-mono">
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button size="sm" variant="ghost" icon="minus" onClick={() => (setExpanded(new Set()), setSelected(null))} disabled={!expanded.size}>
          Collapse all
        </Button>
        <span className="st-grow" />
        <span className="mp-stats t-caption t-muted" aria-live="polite">
          {num(graph.nodes.length)} nodes · {num(graph.edges.length)} edges{graph.hiddenEdges ? ` (+${num(graph.hiddenEdges)} lighter hidden)` : ""} · {num(map.files.length)} files
          {layoutMs !== null && ` · layout ${Math.round(layoutMs)} ms`}
        </span>
      </div>
      <Legend colorBy={colorBy} violating={violating} rules={graph.rules.length} />
      <div className="mp-body">
        <div className="mp-canvas">
          <GraphCanvas
            nodes={gnodes}
            edges={gedges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            label={`Map of ${repo?.name}: ${graph.nodes.length} nodes, ${graph.edges.length} import edges, ${violating} violating`}
            selected={selected}
            onNodeClick={setSelected}
            onNodeDoubleClick={toggle}
            onEdgeClick={setSelected}
            onPaneClick={() => setSelected(null)}
            onLayout={(ms) => setLayoutMs(ms)}
            minimapColor={(_, data) => {
              const d = data as NodeData | undefined;
              return !d || (d.node.expanded && d.node.kind !== "symbol") ? "transparent" : `var(--data-seq-${d.depth})`;
            }}
            fitKey={`${repo?.path}:${[...expanded].sort().join(",")}`}
            focusId={lastToggled}
          >
          </GraphCanvas>
        </div>
        <aside className="mp-side" aria-label="Selection">
          {sel ? (
            <NodePanel node={sel} graph={graph} onToggle={() => toggle(sel.id)} onOpen={(line) => openCode({ path: sel.path, line })} onSelect={setSelected} />
          ) : selRule ? (
            <RulePanel id={selRule.id} rule={selRule} summary={conv.rows.find((r) => r.id === selRule.id)?.summary ?? ""} />
          ) : selEdge ? (
            <EdgePanel edge={selEdge} graph={graph} layering={layering} summaries={new Map(conv.rows.map((r) => [r.id, r.summary]))} onOpen={(p) => openCode({ path: p })} onSelect={setSelected} />
          ) : (
            <Overview graph={graph} onSelect={setSelected} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({ colorBy, violating, rules }: { colorBy: ColorBy; violating: number; rules: number }) {
  return (
    <div className="mp-legend" role="group" aria-label="Legend">
      <div className="mp-legend__title">Legend</div>
      <div className="mp-legend__row">
        <span className="mp-legend__depth" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} style={{ background: `var(--data-seq-${i})` }} />
          ))}
        </span>
        depth = files beneath (1–2 … 300+); size grows with files
      </div>
      <div className="mp-legend__row">
        <span className="mp-legend__edge" /> imports (width = count)
      </div>
      <div className="mp-legend__row">
        <span className="mp-legend__edge is-violating" /> violates a layering rule ({violating})
      </div>
      <div className="mp-legend__row">
        <span className="mp-legend__edge is-rule" /> layering rule: must not import ({rules})
      </div>
      <div className="mp-legend__row">
        <span className="mp-legend__swatches" aria-hidden="true">
          {colorBy === "health" ? (
            <span style={{ background: "var(--color-danger)" }} />
          ) : (
            [1, 2, 3, 4].map((i) => <span key={i} style={{ background: `var(--data-${colorBy === "layer" ? "seq" : "cat"}-${colorBy === "layer" ? i + 1 : i})` }} />)
          )}
        </span>
        {colorBy === "package" ? "package" : colorBy === "layer" ? "dependency layer (dark: imports few areas)" : "has new violations"}
      </div>
      <div className="mp-legend__row t-muted">double-click or Enter expands</div>
    </div>
  );
}

function Overview({ graph, onSelect }: { graph: MapGraph; onSelect(id: string): void }) {
  const top = graph.nodes.filter((n) => n.kind === "area").sort((a, b) => b.files - a.files).slice(0, 12);
  const viol = graph.edges.filter((e) => e.violates.length);
  const max = Math.max(1, ...top.map((n) => n.files));
  return (
    <div className="mp-panel">
      {viol.length > 0 ? (
        <section className="mp-panel__lead">
          <h3 className="t-h4">Boundaries broken</h3>
          <ul className="mp-list">
            {viol.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(e.id)}>
                  <StateLabel tone="danger" icon="attention">
                    {e.violates.join(", ")}
                  </StateLabel>
                  <span className="dui-mono t-truncate t-caption">
                    {e.source.slice(2)} → {e.target.slice(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="t-caption t-muted">No import breaks a layering rule.</p>
      )}
      <section>
        <h3 className="t-h4">Areas by size</h3>
        <p className="t-caption t-muted">Drift's areas: the first two path segments. Select one to see what it imports.</p>
        <ul className="mp-list mp-areas">
          {top.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => onSelect(n.id)}>
                <span className="mp-areas__swatch" aria-hidden="true" style={{ background: `var(--data-seq-${depthOf(n.files)})` }} />
                <span className="dui-mono t-truncate">{n.label}</span>
                <span className="st-grow" />
                {n.violations > 0 && (
                  <StateLabel tone="danger" icon="attention">
                    {n.violations}
                  </StateLabel>
                )}
                <span className="mp-areas__bar" aria-hidden="true">
                  <span style={{ width: `${(n.files / max) * 100}%` }} />
                </span>
                <span className="mp-areas__n">{num(n.files)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NodePanel({ node, graph, onToggle, onOpen, onSelect }: { node: MapNode; graph: MapGraph; onToggle(): void; onOpen(line?: number): void; onSelect(id: string): void }) {
  const out = graph.edges.filter((e) => e.source === node.id).sort((a, b) => b.weight - a.weight);
  const inc = graph.edges.filter((e) => e.target === node.id).sort((a, b) => b.weight - a.weight);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.path ?? id;
  return (
    <div className="mp-panel">
      <div className="st-row">
        <Badge>{node.kind}</Badge>
        <span className="st-grow" />
        {node.expandable && (
          <Button size="sm" variant="secondary" icon={node.expanded ? "minus" : "plus"} onClick={onToggle} shortcut="enter">
            {node.expanded ? "Collapse" : "Expand"}
          </Button>
        )}
      </div>
      <h3 className="mp-panel__title dui-mono">{node.path}</h3>
      <KeyValue
        items={[
          ...(node.kind !== "symbol" ? [{ key: "Files", value: num(node.files) }] : []),
          { key: "Symbols", value: num(node.symbols) },
          { key: "Package", value: node.package || "(root)", mono: true },
          { key: "Layer", value: String(node.layer) },
          ...(node.violations ? [{ key: "New violations", value: <span className="t-danger">{node.violations}</span> }] : []),
        ]}
      />
      {Object.keys(node.entries).length > 0 && (
        <div className="mp-panel__section">
          <div className="dui-overline">Entry points</div>
          <div className="st-row st-wrap">
            {Object.entries(node.entries).map(([k, c]) => (
              <Tag key={k} tone="info">
                {k} {c}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {node.symbol && (
        <div className="mp-panel__section">
          <div className="dui-overline">Wrappers and decorators</div>
          {node.symbol.wraps.length === 0 ? (
            <p className="t-muted t-body-sm">none</p>
          ) : (
            <div className="st-row st-wrap">
              {node.symbol.wraps.map((w, i) => (
                <Tag key={i} title={isUnknownBase(w.wrapper) ? UNKNOWN_BASE_TITLE : w.wrapper}>
                  {w.kind}: {shortRef(w.wrapper)}
                </Tag>
              ))}
            </div>
          )}
          {node.symbol.entry && (
            <>
              <div className="dui-overline" style={{ marginTop: 10 }}>
                Request input
              </div>
              <Tag tone={inputOf(node.symbol) === "reads" ? "info" : undefined} title={INPUT_LABEL[inputOf(node.symbol)].why}>
                {INPUT_LABEL[inputOf(node.symbol)].label}
              </Tag>
            </>
          )}
          {(node.symbol.fieldDecorators?.length ?? 0) > 0 && (
            <>
              <div className="dui-overline" style={{ marginTop: 10 }}>
                Field decorators
              </div>
              <div className="st-row st-wrap">
                {node.symbol.fieldDecorators!.map((d) => (
                  <Tag key={d} title={d}>
                    @{shortRef(d)}
                  </Tag>
                ))}
              </div>
            </>
          )}
          {(node.symbol.traits?.length ?? 0) > 0 && (
            <>
              <div className="dui-overline" style={{ marginTop: 10 }}>
                Kind and purpose
              </div>
              <div className="st-row st-wrap mp-traits">
                {node.symbol.traits!.map((tr) => (
                  <Tag key={tr} tone={symbolTrait(tr).purpose ? "info" : undefined} title={symbolTrait(tr).why}>
                    {symbolTrait(tr).label}
                  </Tag>
                ))}
              </div>
            </>
          )}
          <Button size="sm" icon="code" onClick={() => onOpen(node.symbol!.line)} style={{ marginTop: 10 }}>
            Open at line {node.symbol.line}
          </Button>
        </div>
      )}
      {node.kind === "file" && (
        <Button size="sm" icon="code" onClick={() => onOpen()} style={{ marginTop: 12 }}>
          Open file
        </Button>
      )}
      <EdgeList title="Imports" edges={out} other={(e) => name(e.target)} onSelect={onSelect} />
      <EdgeList title="Imported by" edges={inc} other={(e) => name(e.source)} onSelect={onSelect} />
      {node.kind === "area" && <PackageDeps path={node.path} />}
    </div>
  );
}

/**
 * A package's dependencies as `drift map --json` lists them: production and test apart (round 13). The graph above
 * draws every import from the scan, test files' included; this says which package edges only tests make.
 */
function PackageDeps({ path }: { path: string }) {
  const { repo } = useRepo();
  const map = useDriftMap(repo);
  if (map.isLoading) return null;
  if (map.error) return <p className="t-caption t-muted mp-panel__section">drift map --json is not available here: {map.error instanceof Error ? map.error.message : String(map.error)}</p>;
  const deps = packageDependencies(map.data?.data.packages, path);
  if (!deps) return null;
  return (
    <div className="mp-panel__section" data-testid="package-deps">
      <div className="dui-overline">Package dependencies (drift map)</div>
      {deps.production.length === 0 && deps.test.length === 0 ? (
        <p className="t-muted t-body-sm">none: imports no other package</p>
      ) : (
        <ul className="mp-list mp-deps">
          {deps.production.map((d) => (
            <li key={`p:${d.package}`}>
              <span className="dui-mono t-truncate">{d.package || "(root)"}</span>
              <span className="st-grow" />
              <span className="t-muted t-caption">{num(d.files)} files</span>
            </li>
          ))}
          {deps.test.map((d) => (
            <li key={`t:${d.package}`} className="is-test">
              <span className="dui-mono t-truncate">{d.package || "(root)"}</span>
              <Tag title={d.alsoProduction ? "tests import it too" : "only tests (or a dev-only dependency) import it: not a production dependency"}>{d.alsoProduction ? "tests too" : "test only"}</Tag>
              <span className="st-grow" />
              <span className="t-muted t-caption">{num(d.files)} files</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EdgeList({ title, edges, other, onSelect }: { title: string; edges: MapEdge[]; other(e: MapEdge): string; onSelect(id: string): void }) {
  if (!edges.length) return null;
  return (
    <div className="mp-panel__section">
      <div className="dui-overline">
        {title} ({edges.length})
      </div>
      <ul className="mp-list">
        {edges.slice(0, 12).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect(e.id)}>
              {e.violates.length > 0 && <Icon name="attention" size={12} className="t-danger" label="violates a layering rule" />}
              <span className="dui-mono t-truncate">{other(e)}</span>
              <span className="st-grow" />
              <span className="t-muted t-caption">{num(e.weight)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EdgePanel({ edge, graph, layering, summaries, onOpen, onSelect }: { edge: MapEdge; graph: MapGraph; layering: LayeringRule[]; summaries: Map<string, string>; onOpen(p: string): void; onSelect(id: string): void }) {
  const src = graph.nodes.find((n) => n.id === edge.source);
  const dst = graph.nodes.find((n) => n.id === edge.target);
  return (
    <div className="mp-panel">
      <Badge tone={edge.violates.length ? "danger" : "neutral"} icon={edge.violates.length ? "attention" : undefined}>
        {edge.violates.length ? "violating edge" : "imports"}
      </Badge>
      <h3 className="mp-panel__title">
        <button type="button" className="st-link dui-mono" onClick={() => src && onSelect(src.id)}>
          {src?.path}
        </button>
        <Icon name="arrow-right" size={14} />
        <button type="button" className="st-link dui-mono" onClick={() => dst && onSelect(dst.id)}>
          {dst?.path}
        </button>
      </h3>
      <KeyValue
        items={[
          { key: "Imports", value: num(edge.weight) },
          // Facts schema 6: `import()`, a `require()` in a function or a lazy-load helper.
          ...(edge.deferred ? [{ key: "Loaded lazily", value: num(edge.deferred) }] : []),
        ]}
      />
      {edge.deferred > 0 && (
        <p className="t-muted t-caption">
          Loaded only when the code that holds the import runs. Drift does not count such a load against a layering rule when the importing package declares the target a peer or optional dependency.
        </p>
      )}
      {edge.violates.map((id) => {
        const r = layering.find((l) => l.id === id);
        const files = (r?.violators ?? []).filter((p) => src && (p === src.path || p.startsWith(src.path + "/")));
        return (
          <div key={id} className="mp-panel__section">
            <div className="st-row">
              <Tag tone="danger">{id}</Tag>
              <span className="t-body-sm">{summaries.get(id)}</span>
            </div>
            <div className="dui-overline" style={{ marginTop: 8 }}>
              Files breaking it
            </div>
            <ul className="mp-list">
              {files.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => onOpen(p)}>
                    <Icon name="file" size={12} />
                    <span className="dui-mono t-truncate">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function RulePanel({ id, rule, summary }: { id: string; rule: { sourceArea: string; targetArea: string; status: string; violators: number }; summary: string }) {
  return (
    <div className="mp-panel">
      <div className="st-row">
        <Tag>{id}</Tag>
        <Badge tone={rule.status === "accepted" ? "success" : "accent"}>{rule.status}</Badge>
        <span className="st-grow" />
        <IconButton icon="review" label="Open in Conventions" onClick={() => (location.hash = `#/conventions/${id}`)} />
      </div>
      <h3 className="mp-panel__title">{summary}</h3>
      <KeyValue
        items={[
          { key: "Scope", value: rule.sourceArea, mono: true },
          { key: "Must not import", value: `${rule.targetArea}/**`, mono: true },
          { key: "Breaking it", value: num(rule.violators) },
        ]}
      />
    </div>
  );
}
