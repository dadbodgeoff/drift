// `drift security`: entry points with their guards, validation and reach
// chains; risky operations by kind; client leaks with their import chain;
// environment reads. Drift prescribes nothing here: it lists what the code does.
// With "Changes since base" (`--diff-base`), only what a change introduces (SecurityChanges).
import { createContext, useContext, useMemo, useState } from "react";
import {
  Badge,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  KeyValue,
  Panel,
  SearchInput,
  Select,
  SplitPane,
  StateLabel,
  TabPanel,
  Tabs,
  Tag,
} from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { DiffScope, useDiffScope } from "@/entities/check";
import { useFacts, useSecurity } from "@/entities/drift";
import { INPUT_LABEL, findSymbol, inputOf, useFactsIndex } from "@/entities/facts";
import { identifiedText, notReadShort } from "@/entities/basis";
import { LOCAL_NOTE, type Posture, POSTURE, QUEUE_NOTE, chainGraph, exposureText, filterEntries, guardText, headline, isQueueKind, isUnguarded, parseGuard, placeOf, postureOf, posturesIn, sinkLabel, sinksByKind, sortEntries } from "@/entities/security";
import { type ConventionRow, ruleTargets, useConventions } from "@/entities/convention";
import type { EntryRow, GuardGap, Inventory } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";
import { SecurityChanges } from "./SecurityChanges";

type Tab = "entries" | "gaps" | "sinks" | "leaks" | "env";
const TABS: Tab[] = ["entries", "gaps", "sinks", "leaks", "env"];

/** Guard name -> the accepted conventions that require it (wrapper or decorator rules). */
const GuardLinks = createContext<Map<string, ConventionRow[]>>(new Map());

export function SecurityView({ tab }: { tab: string | null }) {
  const { repo } = useRepo();
  const sec = useSecurity(repo);
  const conv = useConventions(repo);
  const [postureFilter, setPostureFilter] = useState<Posture | null>(null);
  // Scope: the whole inventory, or what a change introduces since its merge base (the same switch as Check's).
  const scope = useDiffScope(repo?.path);
  const guardIndex = useMemo(() => {
    const m = new Map<string, ConventionRow[]>();
    for (const r of conv.rows) {
      if (r.status !== "accepted" || r.rule.type !== "wrapped_by") continue;
      for (const t of ruleTargets(r.rule)) m.set(t.replace(/\(.*$/, ""), [...(m.get(t.replace(/\(.*$/, "")) ?? []), r]);
    }
    return m;
  }, [conv.rows]);
  const current: Tab = (TABS as string[]).includes(tab ?? "") ? (tab as Tab) : "entries";
  const scopeBar = <DiffScope scope={scope} tool="drift security" command={(b) => `drift security --json${b ? ` --diff-base ${b}` : ""}`} />;
  if (scope.base) return <SecurityChanges base={scope.base} scopeBar={scopeBar} />;
  if (sec.isLoading) return <Loading label="Running drift security" />;
  if (sec.error) return <ErrorState title="drift security failed" error={sec.error} onRetry={() => void sec.refetch()} />;
  if (!sec.data) return null;
  const inv = sec.data.data;
  const h = headline(inv);
  const gaps = inv.guard_gaps ?? [];
  const exposure = exposureCounts(inv);
  const postures = posturesIn(inv);
  const postureCounts: Partial<Record<Posture, number>> = {};
  for (const e of inv.entry_points) postureCounts[postureOf(e)] = (postureCounts[postureOf(e)] ?? 0) + 1;
  return (
    <GuardLinks.Provider value={guardIndex}>
    <div className="st-page st-page--fill sc">
      <header className="sc-head">
        <div className="sc-verdict">
          <div className="dui-overline">drift security · lists what the code does; prescribes nothing</div>
          <div className="sc-verdict__line">
            <span className={`sc-verdict__num${h.unguardedReaching ? " t-danger" : ""}`}>{num(h.reaching)}</span>
            <span className="sc-verdict__text">
              {h.reaching === 1 ? "entry point reaches" : "entry points reach"} a risky operation
              {h.reaching > 0 && (
                <>
                  ; <b className={h.unguardedReaching ? "t-danger" : undefined}>{num(h.unguardedReaching)} of them with no guard found in what Drift read</b>
                </>
              )}
            </span>
          </div>
          <p className="t-secondary">
            {num(h.entryPoints)} entry points, {num(h.sinks)} risky operations detected syntactically, {num(h.leakGroups)} client {h.leakGroups === 1 ? "leak" : "leaks"}, {num(h.envVars)} environment variables read.
            {exposure.known > 0 && (
              <>
                {" "}
                Exposure: {num(exposure.public)} internet-facing, {num(exposure.internal)} internal, {num(exposure.unknown)} unknown, from {inv.boundaries?.rules.some((r) => r.source.startsWith("config")) ? ".drift/config.yaml" : ""}
                {inv.boundaries?.rules.some((r) => r.source.startsWith("config")) && inv.boundaries?.rules.some((r) => r.source.startsWith("compose")) ? " and " : ""}
                {inv.boundaries?.rules.some((r) => r.source.startsWith("compose")) ? "compose files" : ""}.
              </>
            )}
          </p>
          {inv.boundaries?.warnings?.length ? (
            <p className="ck-note" role="note">
              <Icon name="attention" size={13} />
              <span>{inv.boundaries.warnings.join(" ")}</span>
            </p>
          ) : null}
          {inv.unchecked?.length ? (
            <p className="ck-note" role="note">
              <Icon name="attention" size={13} />
              <span>
                <b>{num(inv.unchecked.length)} {inv.unchecked.length === 1 ? "file was" : "files were"} not parsed</b> (no stack large enough could be reserved on this run): {inv.unchecked.slice(0, 3).join(", ")}
                {inv.unchecked.length > 3 ? ", …" : ""}. What {inv.unchecked.length === 1 ? "it holds" : "they hold"} is missing from this inventory.
              </span>
            </p>
          ) : null}
        </div>
        {scopeBar}
        <div className="sc-ledger" role="group" aria-label="Entry points by protection">
          {postures.map((p) => (
            <button key={p} type="button" className={`ck-key is-${POSTURE[p].tone}`} aria-pressed={postureFilter === p} onClick={() => (setPostureFilter(postureFilter === p ? null : p), navigate("security", "entries"))}>
              <StateLabel tone={POSTURE[p].tone} icon={POSTURE[p].icon}>
                {POSTURE[p].label}
              </StateLabel>
              <span className="ck-key__num">{num(postureCounts[p] ?? 0)}</span>
              <span className="ck-key__hint">{POSTURE[p].hint}</span>
            </button>
          ))}
        </div>
      </header>
      <Tabs<Tab>
        label="Security inventory"
        idBase="sec"
        value={current}
        onValueChange={(v) => navigate("security", v)}
        items={[
          { value: "entries", label: "Entry points", count: h.entryPoints },
          { value: "gaps", label: "Shared guards", count: gaps.length },
          { value: "sinks", label: "Risky operations", count: h.sinks },
          { value: "leaks", label: "Client leaks", count: h.leakGroups },
          { value: "env", label: "Environment", count: h.envVars },
        ]}
      />
      <TabPanel idBase="sec" value={current} className="st-tabfill">
        {current === "entries" && <Entries inv={inv} posture={postureFilter} />}
        {current === "gaps" && <Gaps gaps={gaps} />}
        {current === "sinks" && <Sinks inv={inv} />}
        {current === "leaks" && <Leaks inv={inv} />}
        {current === "env" && <Env inv={inv} />}
      </TabPanel>
    </div>
    </GuardLinks.Provider>
  );
}

function GuardChips({ e, max = 3 }: { e: EntryRow; max?: number }) {
  const gs = e.guards.map(parseGuard);
  return (
    <span className="sc-guards">
      {gs.slice(0, max).map((g, i) => (
        <span key={i} className={`sc-guard is-${g.origin.replace(" ", "-")}`} title={g.origin === "code" ? "guard in code" : `guard from ${g.origin}`}>
          <span className="dui-mono">{g.name}</span>
          {g.origin !== "code" && <span className="sc-guard__origin">{g.origin}</span>}
        </span>
      ))}
      {gs.length > max && <span className="t-muted t-caption">+{gs.length - max}</span>}
      {(e.authenticates ?? []).slice(0, 1).map((a) => {
        const g = parseGuard(a);
        return (
          <span key={a} className="sc-guard is-authn" title="identified: the caller is identified and no one is turned away (no guard)">
            <span className="dui-mono">{g.name}</span>
            <span className="sc-guard__origin">{g.origin === "code" ? "authn" : `${g.origin} · authn`}</span>
          </span>
        );
      })}
      {(e.authenticates?.length ?? 0) > 1 && <span className="t-muted t-caption">+{(e.authenticates?.length ?? 0) - 1} authn</span>}
      {(e.wrappers ?? []).slice(0, 1).map((w) => (
        <span key={w} className="sc-guard is-wraps" title="wraps the entry point but turns no caller away: not a guard">
          <span className="dui-mono">{parseGuard(w).name}</span>
          <span className="sc-guard__origin">wraps</span>
        </span>
      ))}
      {(e.wrappers?.length ?? 0) > 1 && <span className="t-muted t-caption">+{(e.wrappers?.length ?? 0) - 1} wraps</span>}
      {(e.opens ?? []).slice(0, 1).map((o) => (
        <span key={o} className="sc-guard is-opens" title="opens the entry point to anyone">
          <span className="dui-mono">{o}</span>
          <span className="sc-guard__origin">opens</span>
        </span>
      ))}
    </span>
  );
}

function Entries({ inv, posture }: { inv: Inventory; posture: Posture | null }) {
  const openCode = useOpenCode();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sink, setSink] = useState("");
  const [unguarded, setUnguarded] = useState(false);
  const [reaching, setReaching] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Set(inv.entry_points.map((e) => e.kind))].sort(), [inv]);
  const sinkKinds = useMemo(() => [...new Set(inv.entry_points.flatMap((e) => e.reaches.map((r) => r.kind)))].sort(), [inv]);
  const rows = useMemo(
    () => sortEntries(filterEntries(inv.entry_points, { q, kind: kind || null, unguardedOnly: unguarded, reachingOnly: reaching, sink: sink || null })).filter((e) => !posture || postureOf(e) === posture),
    [inv, q, kind, sink, unguarded, reaching, posture],
  );
  const key = (e: EntryRow) => `${e.path}#${e.symbol}:${e.line}`;
  const sel = rows.find((r) => key(r) === active) ?? rows[0] ?? null;
  const columns: Column<EntryRow>[] = [
    { id: "kind", header: "Kind", width: 84, sortValue: (e) => e.kind, render: (e) => <Tag tone="info">{e.kind}</Tag>, text: (e) => e.kind },
    { id: "route", header: "Route", width: 240, mono: true, sortValue: (e) => e.route ?? "", render: (e) => (e.route ? `${e.method ?? ""} ${e.route}` : <span className="t-muted">{e.symbol}</span>), text: (e) => `${e.method ?? ""} ${e.route ?? e.symbol}` },
    {
      id: "guards",
      header: "Protection",
      width: 210,
      sortValue: (e) => e.guards.length,
      render: (e) => {
        const p = postureOf(e);
        return e.guards.length || e.authenticates?.length || e.opens?.length ? (
          <GuardChips e={e} max={2} />
        ) : (
          <span className="sc-guards">
            <StateLabel tone={p === "local" ? POSTURE[p].tone : e.reaches.length ? "danger" : "neutral"} icon={p === "local" ? POSTURE[p].icon : e.reaches.length ? "blocked" : "dot"}>
              {POSTURE[p].label}
            </StateLabel>
            {e.wrappers?.length ? <GuardChips e={e} max={0} /> : null}
          </span>
        );
      },
      text: (e) => [...e.guards, ...(e.authenticates ?? []), ...(e.opens ?? [])].join(", ") || `${guardText(e)}${e.wrappers?.length ? ` (wraps ${e.wrappers.join(", ")})` : ""}`,
    },
    { id: "validates", header: "Validates", width: 84, sortValue: (e) => Number(e.validates), render: (e) => (e.validates ? <StateLabel tone="success" icon="ok">yes</StateLabel> : <span className="t-muted">no</span>) },
    {
      id: "reaches",
      header: "Reaches",
      width: 190,
      sortValue: (e) => e.reaches.length,
      render: (e) => (e.reaches.length ? <span className="st-row">{e.reaches.map((r) => <Badge key={r.kind} tone="danger" variant="outline">{sinkLabel(r.kind)}</Badge>)}</span> : <span className="t-muted">–</span>),
      text: (e) => e.reaches.map((r) => r.kind).join(", "),
    },
    { id: "path", header: "File", flex: true, minWidth: 220, mono: true, sortValue: (e) => e.path, render: (e) => `${e.path}:${e.line}`, text: (e) => `${e.path}:${e.line}` },
  ];
  return (
    <SplitPane storageKey="security-entries" initial={Math.max(560, Math.round(window.innerWidth * 0.6))} min={420} max={1600}>
      <div className="st-fill">
        <div className="st-toolbar st-toolbar--tight">
          <SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Path, route or guard" label="Filter entry points" />
          <Select size="sm" label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "", label: "All kinds" }, ...kinds.map((k) => ({ value: k, label: k }))]} />
          <Select size="sm" label="Reaches" value={sink} onChange={(e) => setSink(e.target.value)} options={[{ value: "", label: "Any operation" }, ...sinkKinds.map((k) => ({ value: k, label: sinkLabel(k) }))]} />
          <Checkbox checked={unguarded} onCheckedChange={setUnguarded} label="No guard found" />
          <Checkbox checked={reaching} onCheckedChange={setReaching} label="Reaches risky op" />
          <span className="st-grow" />
          <span className="t-caption t-muted">{num(rows.length)} shown</span>
        </div>
        <DataTable
          label="Entry points"
          rows={rows}
          columns={columns}
          rowKey={key}
          storageKey="security-entries"
          activeKey={sel ? key(sel) : null}
          onActiveChange={(k) => setActive(k)}
          onRowActivate={(e) => openCode({ path: e.path, line: e.line, context: { title: `${e.kind} ${e.method ?? ""} ${e.route ?? e.symbol}`, detail: e.guards.length ? `guards: ${e.guards.join(", ")}` : e.opaque?.length ? `guard unknown: ${e.opaque.join(", ")} cannot be read` : e.local ? LOCAL_NOTE : isQueueKind(e.kind) ? QUEUE_NOTE : `${guardText(e)}${e.wrappers?.length ? `; wrappers: ${e.wrappers.join(", ")}` : ""}`, tone: e.reaches.length && !e.local && !isQueueKind(e.kind) && !(e.guards.length === 0 && e.opaque?.length) ? "danger" : "info" } })}
          rowTone={(e) => (e.reaches.length && isUnguarded(e) ? "danger" : null)}
          empty="No entry points match"
        />
      </div>
      <div className="st-fill st-scroll">{sel ? <EntryDetail e={sel} /> : <EmptyState title="Select an entry point" />}</div>
    </SplitPane>
  );
}

function EntryDetail({ e }: { e: EntryRow }) {
  const openCode = useOpenCode();
  const { repo } = useRepo();
  const facts = useFacts(repo);
  const ix = useFactsIndex(facts.data?.data);
  const sym = ix ? findSymbol(ix, e.path, e.symbol) : undefined;
  const input = sym ? inputOf(sym) : null;
  const g = useMemo(() => chainGraph(e), [e]);
  return (
    <div className="st-pad st-stack">
      <div className="st-row st-wrap">
        <Tag tone="info">{e.kind}</Tag>
        {e.method && <Tag>{e.method}</Tag>}
        <span className="dui-mono">{e.route ?? e.symbol}</span>
      </div>
      <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => openCode({ path: e.path, line: e.line })}>
        <Icon name="file" size={14} />
        <span className="dui-mono">
          {e.path}:{e.line}
        </span>
        <span className="dui-mono t-accent">{e.symbol}</span>
      </button>
      <KeyValue
        items={[
          {
            key: "Protection",
            value: (
              <StateLabel tone={POSTURE[postureOf(e)].tone} icon={POSTURE[postureOf(e)].icon}>
                {POSTURE[postureOf(e)].label}
              </StateLabel>
            ),
          },
          { key: "Guards", value: e.guards.length ? <GuardList guards={e.guards} /> : e.opaque?.length ? <span className="t-muted">unknown: <span className="dui-mono">{e.opaque.join(", ")}</span> may be a guard and cannot be read</span> : <span className="t-muted">{guardText(e)}{e.wrappers?.length ? "; its wrappers turn no caller away" : ""}</span> },
          ...(e.basis ? [{ key: "Not read", value: e.basis.not_read.length ? <span className="dui-mono">{e.basis.not_read.map(notReadShort).join(", ")}</span> : <span className="t-muted">nothing listed: {e.basis.bodies} bodies read{e.basis.followed?.length ? `, ${e.basis.followed.length} followed` : ""}; that is not proof either</span> }] : []),
          ...(e.wrappers?.length ? [{ key: "Wrappers", value: <span className="dui-mono" title="wrap the entry point but turn no caller away (a FastAPI Depends(get_db), an error mapper): not guards">{e.wrappers.join(" > ")}</span> }] : []),
          ...(e.authenticates?.length ? [{ key: "Identified", value: <span className="dui-mono">{identifiedText(e.authenticates)}</span> }] : []),
          ...(e.opens?.length ? [{ key: "Opens", value: <span className="dui-mono t-warning">{e.opens.join(", ")}</span> }] : []),
          ...(input ? [{ key: "Request input", value: <span title={INPUT_LABEL[input].why}>{INPUT_LABEL[input].label}</span> }] : []),
          { key: "Exposure", value: e.boundary ? exposureText(e) : <span className="t-muted">unknown: nothing in the repository says (set security.internal or security.public in .drift/config.yaml, or add a compose file)</span> },
          { key: "Validates input", value: e.validates ? "yes, with a schema" : "no schema validation seen" },
          { key: "Env vars read", value: e.reads.length ? e.reads.join(", ") : "none", mono: e.reads.length > 0 },
        ]}
      />
      <Panel title="Reach chains" subtitle="Internal calls from this entry point to each risky operation (up to four hops)">
        {g.nodes.length === 0 ? <p className="t-muted t-body-sm">This entry point reaches no risky operation.</p> : <ChainGraph entry={e} onOpen={(p, s) => openCode({ path: p, context: { title: `Hop ${s} in the reach chain from ${e.symbol}` } })} />}
      </Panel>
    </div>
  );
}

/** Guards outermost first, each with its origin and the accepted conventions that require it. */
function GuardList({ guards }: { guards: string[] }) {
  const links = useContext(GuardLinks);
  return (
    <ol className="sc-guardlist">
      {guards.map((raw, i) => {
        const g = parseGuard(raw);
        const req = links.get(g.name) ?? [];
        return (
          <li key={i}>
            <span className="dui-mono">{g.name}</span>
            {g.origin !== "code" && <span className="sc-guard__origin">{g.origin}</span>}
            {req.map((r) => (
              <button key={r.id} type="button" className="st-link t-caption" onClick={() => navigate("conventions", r.id)} title={r.summary}>
                required by {r.id} ({r.evidence.holders}/{r.evidence.total})
              </button>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

/** Each chain drawn left to right, hops shared between chains drawn once per column. */
function ChainGraph({ entry, onOpen }: { entry: EntryRow; onOpen(path: string, symbol: string): void }) {
  const cols: string[][] = [];
  for (const r of entry.reaches) r.via.forEach((h, i) => ((cols[i] ??= []).includes(h) ? null : cols[i].push(h)));
  const W = 156;
  const H = 40;
  const GX = 28;
  const GY = 14;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) => c.forEach((h, j) => pos.set(`${i}:${h}`, { x: i * (W + GX), y: j * (H + GY) })));
  const sinkCol = cols.length;
  const sinks = [...new Set(entry.reaches.map((r) => r.kind))];
  sinks.forEach((k, j) => pos.set(`sink:${k}`, { x: sinkCol * (W + GX), y: j * (H + GY) }));
  const width = (sinkCol + 1) * (W + GX);
  const height = Math.max(...[...pos.values()].map((p) => p.y)) + H + 4;
  const links: { a: { x: number; y: number }; b: { x: number; y: number }; k: string }[] = [];
  for (const r of entry.reaches) {
    r.via.forEach((h, i) => {
      if (i > 0) links.push({ a: pos.get(`${i - 1}:${r.via[i - 1]}`)!, b: pos.get(`${i}:${h}`)!, k: `${i}${h}${r.kind}` });
    });
    links.push({ a: pos.get(`${r.via.length - 1}:${r.via[r.via.length - 1]}`)!, b: pos.get(`sink:${r.kind}`)!, k: `s${r.kind}${r.via.join()}` });
  }
  return (
    <div className="sec-chain" role="group" aria-label={entry.reaches.map((r) => `${r.via.join(" calls ")} reaches ${sinkLabel(r.kind)}`).join("; ")}>
      <svg width={width} height={height} aria-hidden="true">
        {links.map((l) => (
          <path key={l.k} d={`M${l.a.x + W},${l.a.y + H / 2} C${l.a.x + W + GX / 2},${l.a.y + H / 2} ${l.b.x - GX / 2},${l.b.y + H / 2} ${l.b.x},${l.b.y + H / 2}`} className="sec-chain__link" />
        ))}
      </svg>
      {cols.flatMap((c, i) =>
        c.map((h) => {
          const p = pos.get(`${i}:${h}`)!;
          const [path, sym = ""] = h.split("#");
          return (
            <button key={`${i}:${h}`} type="button" className={`sec-chain__node${i === 0 ? " is-entry" : ""}`} style={{ left: p.x, top: p.y, width: W, height: H }} onClick={() => onOpen(path, sym)} title={h}>
              <span className="dui-mono">{sym || path}</span>
              <span className="t-caption t-muted t-truncate">{path}</span>
            </button>
          );
        }),
      )}
      {sinks.map((k) => {
        const p = pos.get(`sink:${k}`)!;
        return (
          <span key={k} className="sec-chain__node is-sink" style={{ left: p.x, top: p.y, width: W, height: H }}>
            <Icon name="blocked" size={12} /> {sinkLabel(k)}
          </span>
        );
      })}
    </div>
  );
}

function exposureCounts(inv: Inventory) {
  const c = { public: 0, internal: 0, unknown: 0, known: 0 };
  for (const e of inv.entry_points) {
    const x = e.exposure ?? "unknown";
    c[x] += 1;
    if (x !== "unknown") c.known += 1;
  }
  return c;
}

/** Guards most entry points of a kind share, and the members lacking them: learned, not prescribed. */
function Gaps({ gaps }: { gaps: GuardGap[] }) {
  const openCode = useOpenCode();
  if (!gaps.length)
    return (
      <EmptyState icon="ok" title="No guard is shared by 90% of a kind of entry point with exceptions">
        A gap needs a place with at least 8 entry points of one kind, a guard on at least 90% of them, and at least one without it.
      </EmptyState>
    );
  return (
    <div className="st-stack st-pad">
      <p className="t-secondary t-body-sm">
        Where at least 90% of the entry points of one kind in one place share a guard, the ones without it are listed with a member to copy from. The exceptions are often meant (webhooks, health checks, public pages): they are facts to review, not violations, and they fail no check.
      </p>
      {gaps.map((g) => {
        const place = placeOf(g.package, g.dir);
        return (
          <Panel
            key={`${g.package}|${g.kind}|${g.dir}|${g.guard}`}
            title={
              <span className="st-row">
                <Icon name="shield" size={14} className="t-warning" /> <span className="dui-mono">{g.guard}</span>
              </span>
            }
            subtitle={`${num(g.with_guard)} of ${num(g.members)} ${g.kind} entry points in ${place} have it; ${num(g.exceptions.length)} do not`}
            padded={false}
          >
            <ul className="st-outliers">
              {g.exceptions.slice(0, 50).map((e) => (
                <li key={`${e.path}#${e.symbol}:${e.line}`}>
                  <button type="button" className="st-pathlink" onClick={() => openCode({ path: e.path, line: e.line, context: { title: `lacks ${g.guard}`, detail: `${g.with_guard} of ${g.members} ${g.kind} entry points in ${place} have it`, tone: "warning" } })}>
                    <span className="dui-mono t-truncate">{e.path}</span>
                    <span className="dui-mono">{e.method ? `${e.method} ` : ""}{e.route ?? e.symbol}</span>
                    <span className="t-muted t-caption">{guardText(e)}{e.opens?.length ? `; open: ${e.opens.join(", ")}` : ""}</span>
                  </button>
                </li>
              ))}
              {g.exceptions.length > 50 && <li className="t-muted t-caption">+{g.exceptions.length - 50} more</li>}
            </ul>
            {g.convention && (
              <div className="st-pad t-body-sm">
                <button type="button" className="st-link" onClick={() => navigate("conventions", g.convention!.id)}>
                  {g.convention.status === "accepted" ? `Accepted convention ${g.convention.id} (${g.convention.mode === "block" ? "blocks" : "advises"})` : `Proposed as ${g.convention.id}: accept it to make it a rule`}
                </button>
              </div>
            )}
            <div className="st-pad t-body-sm">
              To copy:{" "}
              <button type="button" className="st-link dui-mono" onClick={() => openCode({ path: g.example.path, line: g.example.line, context: { title: `has ${g.guard}` } })}>
                {g.example.path}:{g.example.line} {g.example.symbol}
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function Sinks({ inv }: { inv: Inventory }) {
  const openCode = useOpenCode();
  const groups = useMemo(() => sinksByKind(inv.sinks), [inv]);
  if (!groups.length) return <EmptyState icon="ok" title="No risky operations found" />;
  return (
    <div className="st-grid st-grid--cards st-pad">
      {groups.map((g) => (
        <Panel key={g.kind} title={<span className="st-row"><Icon name="blocked" size={14} className="t-danger" /> {sinkLabel(g.kind)}</span>} subtitle={`${g.items.length} ${g.items.length === 1 ? "place" : "places"}`} padded={false}>
          <ul className="st-outliers">
            {g.items.slice(0, 50).map((s) => (
              <li key={`${s.path}#${s.symbol}:${s.line}`}>
                <button type="button" className="st-pathlink" onClick={() => openCode({ path: s.path, line: s.line, context: { title: sinkLabel(s.kind), detail: `${s.symbol} at line ${s.line}`, tone: "danger" } })}>
                  <span className="dui-mono t-truncate">{s.path}</span>
                  <span className="dui-mono">{s.symbol}</span>
                  <span className="t-muted t-caption">:{s.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function Leaks({ inv }: { inv: Inventory }) {
  const openCode = useOpenCode();
  if (!inv.client_leaks.length) return <EmptyState icon="ok" title="No client code reaches server-only code or secrets" />;
  return (
    <div className="st-stack st-pad">
      {inv.client_leaks.map((g) => (
        <Panel key={g.reaches} title={<span className="st-row"><Icon name="shield" size={14} className="t-warning" /> <span className="dui-mono">{g.reaches}</span></span>} subtitle={`reached from ${g.clients.length} "use client" ${g.clients.length === 1 ? "file" : "files"}; cut the chain at the module nearest the client`}>
          <div className="dui-overline">Import chain</div>
          <ol className="sec-leak">
            {g.example.map((m, i) => (
              <li key={i}>
                {m.includes(":") ? (
                  <Tag tone="warning">{m}</Tag>
                ) : (
                  <button type="button" className="st-link dui-mono" onClick={() => openCode({ path: m })}>
                    {m}
                  </button>
                )}
                {i < g.example.length - 1 && <Icon name="arrow-right" size={12} className="t-muted" />}
              </li>
            ))}
          </ol>
          {g.clients.length > 1 && (
            <details className="st-raw">
              <summary>All {g.clients.length} client files</summary>
              <ul className="st-plainlist">
                {g.clients.map((c) => (
                  <li key={c}>
                    <button type="button" className="st-link dui-mono" onClick={() => openCode({ path: c })}>
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      ))}
    </div>
  );
}

function Env({ inv }: { inv: Inventory }) {
  const openCode = useOpenCode();
  const rows = useMemo(() => Object.entries(inv.env).map(([name, files]) => ({ name, files })), [inv]);
  return (
    <div className="st-fill">
      <DataTable
        label="Environment variables read directly"
        rows={rows}
        rowKey={(r) => r.name}
        defaultSort={{ column: "files", dir: "desc" }}
        onRowActivate={(r) => r.files[0] && openCode({ path: r.files[0], context: { title: `reads process.env.${r.name}` } })}
        columns={[
          { id: "name", header: "Variable", width: 300, mono: true, sortValue: (r) => r.name, render: (r) => r.name },
          { id: "files", header: "Files", width: 80, align: "right", sortValue: (r) => r.files.length, render: (r) => r.files.length },
          { id: "where", header: "Read in", flex: true, mono: true, render: (r) => r.files.slice(0, 3).join(", ") + (r.files.length > 3 ? ` +${r.files.length - 3}` : ""), text: (r) => r.files.join(", ") },
        ]}
        empty="No environment reads"
      />
    </div>
  );
}
