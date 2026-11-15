// The component gallery: every @drift/ui component in its states. Used for
// design review, axe checks and visual regression screenshots (both themes,
// both densities).
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  BarChart,
  BarList,
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  CodeView,
  type Column,
  ConfidenceTier,
  TierBadge,
  ConfirmDialog,
  ContextMenu,
  DataTable,
  Dialog,
  DiffView,
  Drawer,
  EmptyState,
  ErrorState,
  EvidenceChip,
  Icon,
  IconButton,
  Input,
  KeyValue,
  Kbd,
  LineChart,
  Menu,
  Popover,
  Progress,
  RadioGroup,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Sparkline,
  Spinner,
  SplitPane,
  StackedBar,
  Stat,
  StateLabel,
  StatusDot,
  Switch,
  TabPanel,
  Tabs,
  Tag,
  Timeline,
  TimelineItem,
  Tooltip,
  Tree,
  type TreeNode,
  contrast,
  iconNames,
  directions,
  type as typeScale,
  useTheme,
  useToast,
} from "@drift/ui";
import { GraphCanvas } from "@drift/ui/graph";
import { SignatureGallery } from "./SignatureGallery";

const TS = `import { withWorkspace } from "@/lib/auth";

// Every workspace route is wrapped (68 of 70).
export const GET = withWorkspace(async (req, { workspaceId }) => {
  const rows = await db.link.findMany({ where: { workspaceId } });
  return NextResponse.json(rows, { status: 200 });
});

export function Footer({ year = 2026 }: { year?: number }) {
  return <footer className="footer">Acme · {year}</footer>;
}
`;
const PY = `from fastapi import APIRouter, Depends

router = APIRouter()

@router.get("/items/{item_id}")
async def read_item(item_id: int, user=Depends(current_user)):
    """Return one item the user may see."""
    return {"id": item_id, "owner": user.id}  # owned
`;

function Section({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: string }) {
  return (
    <section id={`g-${id}`} className="gl-section" aria-labelledby={`g-${id}-h`}>
      <h2 id={`g-${id}-h`} className="t-h2">
        {title}
      </h2>
      {note && <p className="t-secondary t-body-sm">{note}</p>}
      <div className="gl-body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gl-row">
      <div className="gl-row__label">{label}</div>
      <div className="gl-row__items">{children}</div>
    </div>
  );
}

export function GalleryView() {
  const theme = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<"one" | "two" | "three">("one");
  const [seg, setSeg] = useState<"a" | "b" | "c">("a");
  const [checked, setChecked] = useState(true);
  const [sw, setSw] = useState(true);
  const [radio, setRadio] = useState<"x" | "y">("x");
  const [q, setQ] = useState("withWorkspace");
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pop, setPop] = useState(false);
  const popRef = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState(new Set(["apps", "apps/web"]));
  const [sel, setSel] = useState<string | null>("apps/web/lib");
  const rows = useMemo(() => Array.from({ length: 12000 }, (_, i) => ({ id: `r${i}`, path: `apps/web/app/api/r${String(i).padStart(5, "0")}/route.ts`, n: (i * 7919) % 1000, kind: ["http", "page", "server_action"][i % 3] })), []);
  const [selRows, setSelRows] = useState<Set<string>>(new Set(["r2"]));
  const columns: Column<(typeof rows)[number]>[] = [
    { id: "kind", header: "Kind", width: 120, sortValue: (r) => r.kind, render: (r) => <Tag tone="info">{r.kind}</Tag> },
    { id: "path", header: "Path", flex: true, mono: true, sortValue: (r) => r.path, render: (r) => r.path },
    { id: "n", header: "Imports", width: 100, align: "right", sortValue: (r) => r.n, render: (r) => r.n },
  ];
  const tree: TreeNode[] = [
    {
      id: "apps",
      label: "apps",
      icon: "folder",
      detail: "214",
      children: [
        { id: "apps/web", label: "web", icon: "folder", detail: "160", children: [{ id: "apps/web/lib", label: "lib", icon: "folder", detail: "31" }, { id: "apps/web/app", label: "app", icon: "folder", detail: "112", hasChildren: true }] },
        { id: "apps/api", label: "api", icon: "folder", detail: "54", hasChildren: true },
      ],
    },
    { id: "packages", label: "packages", icon: "folder", detail: "96", hasChildren: true },
    { id: "README.md", label: "README.md", icon: "file" },
  ];
  const t = directions[theme.direction].themes[theme.theme];

  return (
    <div className="st-page gl">
      <header className="st-pagehead">
        <div>
          <h2 className="t-h1">@drift/ui</h2>
          <p className="t-secondary">Every component in every state. Theme: {theme.theme} · density: {theme.density}</p>
        </div>
        <div className="st-row">
          <SegmentedControl
            label="Theme"
            size="sm"
            value={theme.preference.replace("-hc", "") as "dark" | "light"}
            onValueChange={(v) => theme.setPreference(v)}
            items={[
              { value: "dark", label: "Dark", icon: "moon" },
              { value: "light", label: "Light", icon: "sun" },
            ]}
          />
          <SegmentedControl
            label="Density"
            size="sm"
            value={theme.density}
            onValueChange={theme.setDensity}
            items={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <Switch checked={theme.highContrast} onCheckedChange={theme.setHighContrast} label="High contrast" />
        </div>
      </header>

      <nav className="gl-toc" aria-label="Gallery sections">
        {["signature", "colour", "type", "buttons", "inputs", "choice", "navigation", "status", "evidence", "overlays", "data", "states", "code", "timeline", "charts", "graph", "icons"].map((s) => (
          <a key={s} href={`#/gallery`} onClick={(e) => (e.preventDefault(), document.getElementById(`g-${s}`)?.scrollIntoView())}>
            {s}
          </a>
        ))}
      </nav>

      <Section id="signature" title="Signature components" note="The pieces that carry Drift's identity, each with its state matrix, in the current direction.">
        <SignatureGallery />
      </Section>

      <Section id="colour" title="Colour" note="Semantic roles from tokens; the number is the WCAG contrast of the text role on that surface.">
        <div className="gl-swatches">
          {(["bg", "surface", "sunken", "raised", "overlay", "hover", "selected"] as const).map((k) => (
            <div key={k} className="gl-swatch" style={{ background: `var(--color-${k})` }}>
              <span className="gl-swatch__name">{k}</span>
              <span className="gl-swatch__ratio">{contrast(t.color.textPrimary, t.color[k]).toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div className="gl-swatches">
          {(["accent", "success", "warning", "danger", "info"] as const).map((k) => (
            <div key={k} className="gl-swatch gl-swatch--state" style={{ background: `var(--color-${k}-subtle, var(--color-accent-subtle))`, color: `var(--color-${k}${k === "accent" ? "-text" : ""})` }}>
              <span className="gl-swatch__name">{k}</span>
              <span className="gl-swatch__ratio">{contrast(t.color[k === "accent" ? "accentText" : k], t.color.surface).toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div className="gl-swatches">
          {t.categorical.map((c, i) => (
            <div key={c} className="gl-chip" style={{ background: `var(--data-cat-${i + 1})` }} title={`data-cat-${i + 1} ${c}`} />
          ))}
          <span className="gl-gap" />
          {t.sequential.map((c, i) => (
            <div key={c} className="gl-chip" style={{ background: `var(--data-seq-${i + 1})` }} title={`data-seq-${i + 1} ${c}`} />
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography" note="Inter and JetBrains Mono, self-hosted. Metrics use tabular numerals.">
        {Object.entries(typeScale).map(([k, s]) => (
          <div key={k} className="gl-type">
            <span className="gl-type__meta dui-mono">
              {k} {s.size}/{s.line} {s.weight}
            </span>
            <span className={`t-${k}`}>{k === "code" ? "const GET = withWorkspace(handler)" : k === "display" ? "1,284" : "Drift learns your codebase's conventions"}</span>
          </div>
        ))}
      </Section>

      <Section id="buttons" title="Buttons">
        {(["primary", "secondary", "ghost", "subtle", "danger"] as const).map((v) => (
          <Row key={v} label={v}>
            <Button variant={v}>Accept</Button>
            <Button variant={v} icon="check" shortcut="a">
              With shortcut
            </Button>
            <Button variant={v} size="sm">
              Small
            </Button>
            <Button variant={v} loading>
              Loading
            </Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
          </Row>
        ))}
        <Row label="icon">
          <IconButton icon="refresh" label="Rescan" />
          <IconButton icon="sun" label="Theme" variant="secondary" />
          <IconButton icon="sidebar" label="Toggle sidebar" pressed />
          <IconButton icon="x" label="Close" size="sm" />
        </Row>
      </Section>

      <Section id="inputs" title="Inputs">
        <Row label="text">
          <Input placeholder="Placeholder" aria-label="Example input" />
          <Input defaultValue="apps/web/lib/auth.ts" icon="file" aria-label="With icon" />
          <Input defaultValue="not a path" invalid aria-label="Invalid input" />
          <Input defaultValue="disabled" disabled aria-label="Disabled input" />
        </Row>
        <Row label="search">
          <SearchInput value={q} onValueChange={setQ} label="Search example" />
          <SearchInput value="" onValueChange={() => undefined} shortcut="mod+k" label="Search with shortcut" placeholder="Search or jump to…" />
        </Row>
        <Row label="select">
          <Select label="Kind" options={[{ value: "http", label: "HTTP handlers" }, { value: "page", label: "Pages" }]} />
          <Select label="Small select" size="sm" options={[{ value: "a", label: "Any operation" }]} />
        </Row>
      </Section>

      <Section id="choice" title="Checkbox, switch, radio">
        <Row label="checkbox">
          <Checkbox checked={checked} onCheckedChange={setChecked} label="New violations" />
          <Checkbox checked={false} onCheckedChange={() => undefined} label="Baselined" hint="legacy, in drift.lock" />
          <Checkbox checked={false} indeterminate onCheckedChange={() => undefined} label="Some selected" />
          <Checkbox checked onCheckedChange={() => undefined} label="Disabled" disabled />
        </Row>
        <Row label="switch">
          <Switch checked={sw} onCheckedChange={setSw} label="Layering rules" />
          <Switch checked={false} onCheckedChange={() => undefined} label="Type imports" />
        </Row>
        <Row label="radio">
          <RadioGroup<"x" | "y"> label="Density" value={radio} onValueChange={setRadio} orientation="horizontal" options={[{ value: "x", label: "Comfortable" }, { value: "y", label: "Compact" }]} />
        </Row>
      </Section>

      <Section id="navigation" title="Tabs, segmented control, breadcrumbs">
        <Tabs<"one" | "two" | "three"> label="Example tabs" idBase="gtabs" value={tab} onValueChange={setTab} items={[{ value: "one", label: "Entry points", count: 202 }, { value: "two", label: "Risky operations", count: 16 }, { value: "three", label: "Disabled", disabled: true }]} />
        <TabPanel idBase="gtabs" value={tab}>
          <p className="t-secondary" style={{ padding: "8px 0" }}>
            Panel for {tab}.
          </p>
        </TabPanel>
        <Row label="segmented">
          <SegmentedControl<"a" | "b" | "c"> label="Group by" value={seg} onValueChange={setSeg} items={[{ value: "a", label: "By convention" }, { value: "b", label: "By file" }, { value: "c", label: "With count", count: 12 }]} />
        </Row>
        <Breadcrumbs items={[{ label: "apps", onClick: () => undefined }, { label: "web", onClick: () => undefined }, { label: "app/api/workspaces/[id]/route.ts" }]} />
      </Section>

      <Section id="status" title="Badges, tags, status">
        <Row label="badge">
          {(["neutral", "accent", "success", "warning", "danger", "info"] as const).map((x) => (
            <Badge key={x} tone={x} icon>
              {x}
            </Badge>
          ))}
          <Badge tone="danger" variant="outline">
            2 new
          </Badge>
          <Badge tone="accent" variant="solid">
            solid
          </Badge>
        </Row>
        <Row label="tag">
          <Tag>D-ed1ec0</Tag>
          <Tag tone="accent">withWorkspace</Tag>
          <Tag tone="danger">raw_sql</Tag>
          <Tag tone="info">http GET</Tag>
        </Row>
        <Row label="state">
          <StateLabel tone="danger" icon="blocked">
            blocking
          </StateLabel>
          <StateLabel tone="warning">advised</StateLabel>
          <StateLabel tone="success">accepted</StateLabel>
          <StateLabel tone="neutral" icon="dot">
            baselined
          </StateLabel>
          <StatusDot tone="success">drift 0.1.0</StatusDot>
          <StatusDot tone="danger">not found</StatusDot>
        </Row>
        <Row label="kbd">
          <Kbd>mod+k</Kbd>
          <Kbd>g c</Kbd>
          <Kbd>shift+R</Kbd>
        </Row>
      </Section>

      <Section id="evidence" title="Evidence and confidence">
        <Row label="evidence">
          <EvidenceChip holders={53} total={54} lowerBound={0.9} lift={36.5} />
          <EvidenceChip holders={21} total={22} lowerBound={0.78} lift={10.6} compact />
          <EvidenceChip holders={8} total={11} lowerBound={0.48} />
        </Row>
        <Row label="confidence">
          <ConfidenceTier hint={{ family: "Call wrappers", rate: 0.91, n: 22, source: "STUDY-2026-11-05" }} />
          <ConfidenceTier hint={{ family: "Decorators", rate: 0.59, n: 22, source: "STUDY-2026-11-05" }} />
          <ConfidenceTier hint={{ family: "Naming", rate: 0.44, n: 23, source: "STUDY-2026-11-05" }} />
          <ConfidenceTier tier="suggestion" />
        </Row>
        <Row label="tier">
          <TierBadge tier="default" />
          <TierBadge tier="suggestion" reason="rule kind is suggestion-only (calls)" />
          <TierBadge tier="suggestion" reason="names a package symbol" />
          <TierBadge tier="suggestion" reason="Python conventions advise only (decision D7)" />
          <TierBadge tier="suggestion" reason="decorators, base classes and JSX wrappers are suggestions since decision D7 (wrapped_by:decorator)" />
          <TierBadge tier="suggestion" reason="9 members; the default tier needs 15" compact />
        </Row>
        <Row label="stat">
          <div className="gl-stats">
            <Stat label="New violations" value="2" tone="danger" icon="attention" delta={{ value: 2, label: "since last scan", good: "down" }} />
            <Stat label="Entry points" value="202" icon="bolt" hint="38 unguarded" chart={<Sparkline label="trend" values={[180, 184, 190, 202]} />} />
            <Stat label="Accepted" value="60%" tone="success" onClick={() => undefined} shortcut="g c" />
          </div>
        </Row>
        <KeyValue columns={2} items={[{ key: "Package", value: "apps/web", mono: true }, { key: "Directory", value: "app/api/workspaces", mono: true }, { key: "Members", value: "70" }, { key: "Lower bound", value: "0.902", mono: true }]} />
      </Section>

      <Section id="overlays" title="Overlays" note="Each opens on click; all trap focus and close with Escape.">
        <Row label="open">
          <Tooltip content="Holders over total: 53 of 54 follow the rule">
            <Button>Tooltip</Button>
          </Tooltip>
          <Button ref={popRef} onClick={() => setPop(!pop)}>
            Popover
          </Button>
          <Popover open={pop} onOpenChange={setPop} anchor={popRef} label="Example popover">
            <p className="t-body-sm" style={{ maxWidth: 260 }}>
              A popover holds small forms or details. Escape closes it and returns focus.
            </p>
          </Popover>
          <Menu
            label="Actions"
            trigger={<Button iconRight="chevron-down">Menu</Button>}
            items={[
              { id: "a", label: "Accept", icon: "check", shortcut: "a", onSelect: () => undefined },
              { id: "b", label: "Block", icon: "blocked", shortcut: "b", onSelect: () => undefined },
              "separator",
              { id: "r", label: "Reject", icon: "x", shortcut: "r", danger: true, onSelect: () => undefined },
            ]}
          />
          <ContextMenu label="Context menu" items={[{ id: "copy", label: "Copy path", icon: "copy", onSelect: () => undefined }, { id: "open", label: "Open code", icon: "code", onSelect: () => undefined }]}>
            <span className="gl-context" tabIndex={0}>
              Right-click me
            </span>
          </ContextMenu>
          <Button onClick={() => setDialog(true)}>Dialog</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Confirm
          </Button>
          <Button onClick={() => setDrawer(true)}>Drawer</Button>
          <Button onClick={() => toast.show({ title: "Accepted D-ed1ec0", body: "drift review --accept D-ed1ec0", countdown: true, duration: 5000, action: { label: "Undo", shortcut: "u", onClick: () => undefined } })}>Toast</Button>
        </Row>
        <div className="gl-static">
          <div className="dui-dialog dui-dialog--sm gl-static__dialog" role="presentation">
            <header className="dui-dialog__head">
              <h3 className="dui-dialog__title">Accept D-ed1ec0 in block mode?</h3>
            </header>
            <p className="dui-dialog__desc">New violations will fail drift check and stop the agent's turn.</p>
            <footer className="dui-dialog__foot">
              <Button>Cancel</Button>
              <Button variant="danger">Block</Button>
            </footer>
          </div>
          <div className="dui-toast gl-static__toast" role="presentation">
            <Icon name="ok" size={16} className="dui-toast__icon" />
            <div className="dui-toast__text">
              <div className="dui-toast__title">Accepted D-ed1ec0</div>
              <div className="dui-toast__body">drift review --accept D-ed1ec0</div>
            </div>
            <Button size="sm" shortcut="u">
              Undo
            </Button>
          </div>
        </div>
        <Dialog open={dialog} onOpenChange={setDialog} title="Keyboard shortcuts" description="Every action has a key." footer={<Button variant="primary" onClick={() => setDialog(false)}>Done</Button>}>
          <p>Dialogs trap focus and restore it to the button that opened them.</p>
        </Dialog>
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Clear history?" description="Snapshots and the audit trail are deleted." confirmLabel="Clear" tone="danger" onConfirm={() => undefined} />
        <Drawer open={drawer} onOpenChange={setDrawer} title="apps/web/lib/auth.ts" subtitle="line 3">
          <CodeView text={TS} lang="ts" focusLine={4} label="Example code" />
        </Drawer>
      </Section>

      <Section id="data" title="Data" note="The table holds 12,000 rows and renders only what is visible; the tree is virtualized with APG keyboard navigation.">
        <div className="gl-data">
          <div className="gl-data__table">
            <DataTable label="Example table" rows={rows} columns={columns} rowKey={(r) => r.id} height={300} selection={{ mode: "multi", selected: selRows, onChange: setSelRows }} storageKey="gallery" />
          </div>
          <div className="gl-data__tree">
            <Tree label="Example tree" nodes={tree} expanded={expanded} onExpandedChange={setExpanded} selected={sel} onSelect={setSel} height={300} />
          </div>
        </div>
        <div className="gl-split">
          <SplitPane storageKey="gallery" initial={260} min={160} max={520}>
            <div className="st-pad t-secondary">Left pane: drag the handle or focus it and use the arrow keys.</div>
            <div className="st-pad t-secondary">Right pane</div>
          </SplitPane>
        </div>
      </Section>

      <Section id="states" title="Empty, error, loading">
        <div className="gl-states">
          <div className="dui-panel">
            <EmptyState icon="ok" title="No new violations" action={<Button size="sm">View baselined</Button>}>
              Legacy violations are baselined in drift.lock and never fail.
            </EmptyState>
          </div>
          <div className="dui-panel">
            <ErrorState title="drift check failed" error={new Error("no .drift/conventions.yaml: run `drift init` first")} onRetry={() => undefined} />
          </div>
          <div className="dui-panel st-pad st-stack">
            <Skeleton lines={4} />
            <div className="st-row">
              <Spinner size={14} /> <span className="t-secondary">Scanning files</span>
            </div>
            <Progress value={0.62} label="Reviewed" />
            <Progress label="Scanning" />
            <Progress value={1} label="Done" tone="success" />
          </div>
        </div>
      </Section>

      <Section id="code" title="Code and diff" note="Escaped highlighting for TypeScript and Python; line focus and gutter markers.">
        <div className="gl-code">
          <div className="dui-panel gl-code__box">
            <CodeView text={TS} lang="ts" focusLine={4} markers={[{ line: 4, tone: "danger", label: "violation" }, { line: 9, tone: "info", label: "example" }]} label="TypeScript example" height={280} />
          </div>
          <div className="dui-panel gl-code__box">
            <CodeView text={PY} lang="py" focusLine={6} markers={[{ line: 5, tone: "accent", label: "decorator" }]} label="Python example" height={280} />
          </div>
        </div>
        <DiffView
          label="Example diff"
          lang="ts"
          hunks={[{ oldStart: 1, newStart: 1, lines: [" import { db } from \"@acme/db\";", " import { NextResponse } from \"next/server\";", "+import { withWorkspace } from \"@/lib/auth\";", " ", "-export async function GET(req: Request) {", "+export const GET = withWorkspace(async (req, { workspaceId }) => {", "   const count = await db.link.count({ where: { workspaceId } });"] }]}
        />
      </Section>

      <Section id="timeline" title="Timeline">
        <Timeline label="Example timeline">
          <TimelineItem time="+0:00" icon="user" tone="info" title="User" meta="prompt">
            <p>Add a link-count endpoint.</p>
          </TimelineItem>
          <TimelineItem time="+0:12" icon="edit" tone="accent" title={<span className="dui-mono">Write route.ts</span>} />
          <TimelineItem time="+0:13" icon="attention" tone="warning" title={<StateLabel tone="warning">Drift: advised</StateLabel>} meta="PostToolUse">
            <pre className="ss-code">drift: 2 new convention violation(s) (advice).</pre>
          </TimelineItem>
          <TimelineItem time="+0:31" icon="blocked" tone="danger" title={<StateLabel tone="danger" icon="blocked">Drift: blocked the end of the turn</StateLabel>} meta="Stop" />
        </Timeline>
      </Section>

      <Section id="charts" title="Charts" note="Token colours; each chart has a text summary and a hidden data table.">
        <div className="gl-charts">
          <div className="dui-panel st-pad">
            <BarList label="Entry points by kind" items={[{ label: "http", text: "http", value: 128, color: 0 }, { label: "page", text: "page", value: 21, color: 1 }, { label: "server_action", text: "server_action", value: 19, color: 2 }, { label: "job", text: "job", value: 4, color: 3 }]} />
          </div>
          <div className="dui-panel st-pad">
            <StackedBar label="Conventions" segments={[{ label: "blocking", value: 3, color: "danger" }, { label: "accepted", value: 6, color: "success" }, { label: "proposed", value: 3, color: "accent" }, { label: "rejected", value: 1, color: "muted" }]} />
          </div>
          <div className="dui-panel st-pad">
            <BarChart label="Violations by arm" series={[{ label: "control", color: 7 }, { label: "drift", color: 0 }]} data={[{ label: "dub", values: [0, 0] }, { label: "immich", values: [1, 0] }, { label: "infisical", values: [2, 1] }]} />
          </div>
          <div className="dui-panel st-pad">
            <LineChart label="Accept rate over time" labels={["w1", "w2", "w3", "w4"]} series={[{ label: "accept", values: [41, 52, 55, 60], color: "success" }, { label: "wrong", values: [40, 32, 28, 24], color: "danger" }]} />
          </div>
        </div>
      </Section>

      <Section id="graph" title="Graph canvas" note="React Flow with ELK layout in a web worker.">
        <div className="gl-graph">
          <GraphCanvas
            label="Example graph"
            minimap={false}
            nodes={[
              { id: "a", parent: null, width: 140, height: 40, data: { label: "apps/web" } },
              { id: "b", parent: null, width: 140, height: 40, data: { label: "packages/ui" } },
              { id: "c", parent: null, width: 140, height: 40, data: { label: "packages/db" } },
              { id: "d", parent: null, width: 140, height: 40, data: { label: "packages/utils" } },
            ]}
            edges={[
              { id: "ab", source: "a", target: "b" },
              { id: "ac", source: "a", target: "c" },
              { id: "bd", source: "b", target: "d" },
            ]}
          />
        </div>
      </Section>

      <Section id="icons" title="Icons" note="16 px grid, 1.5 px stroke.">
        <div className="gl-icons">
          {iconNames.map((n) => (
            <span key={n} className="gl-icon" title={n}>
              <Icon name={n} />
              <span className="t-caption t-muted">{n}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
