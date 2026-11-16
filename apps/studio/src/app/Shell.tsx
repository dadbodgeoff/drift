// The app shell: sidebar (jobs), top bar (view, freshness, progress), the
// current view inside its own error boundary, the code drawer, the command
// palette and the keyboard model (g-chords, mod+K, ?).
import { type ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  type Command,
  CommandPalette,
  Dialog,
  DriftMark,
  directionNames,
  directions,
  Icon,
  type IconName,
  IconButton,
  Kbd,
  Menu,
  Progress,
  StateLabel,
  Tooltip,
  inTextField,
  matchKey,
  useTheme,
} from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useCensus, useCheck, useDriftInfo, useFacts, useRescan, useRunState, useSecurity } from "@/entities/drift";
import { reviewCounts, useConventions } from "@/entities/convention";
import { checkCounts } from "@/entities/check";
import { makeSnapshot, sameSnapshot, useHistory, useRecordSnapshot } from "@/entities/history";
import { searchFiles, useFactsIndex } from "@/entities/facts";
import { useSessions } from "@/entities/session";
import { type RepoChange, useApi } from "@/shared/api";
import { type MessageKey, t } from "@/shared/i18n";
import { duration, relTime } from "@/shared/lib/format";
import { type ViewId, href, navigate, useRoute } from "@/shared/lib/router";
import { CodeCtx, type CodeTarget } from "@/shared/ui/code";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { Loading } from "@/shared/ui/QueryState";
import { CodeDrawer } from "./CodeDrawer";
import { NoRepo } from "./NoRepo";

const AttentionView = lazy(() => import("@/features/attention").then((m) => ({ default: m.AttentionView })));
const ConventionsView = lazy(() => import("@/features/conventions").then((m) => ({ default: m.ConventionsView })));
const CheckView = lazy(() => import("@/features/check").then((m) => ({ default: m.CheckView })));
const MapView = lazy(() => import("@/features/map").then((m) => ({ default: m.MapView })));
const SecurityView = lazy(() => import("@/features/security").then((m) => ({ default: m.SecurityView })));
const PracticesView = lazy(() => import("@/features/practices").then((m) => ({ default: m.PracticesView })));
const FunnelView = lazy(() => import("@/features/funnel").then((m) => ({ default: m.FunnelView })));
const SessionsView = lazy(() => import("@/features/sessions").then((m) => ({ default: m.SessionsView })));
const StudiesView = lazy(() => import("@/features/studies").then((m) => ({ default: m.StudiesView })));
const LogsView = lazy(() => import("@/features/logs").then((m) => ({ default: m.LogsView })));
const SettingsView = lazy(() => import("@/features/settings").then((m) => ({ default: m.SettingsView })));
const GalleryView = lazy(() => import("@/features/gallery").then((m) => ({ default: m.GalleryView })));
const FromMapView = lazy(() => import("@/features/from-map").then((m) => ({ default: m.FromMapView })));
const UpgradeView = lazy(() => import("@/features/upgrade").then((m) => ({ default: m.UpgradeView })));
const FeedbackView = lazy(() => import("@/features/feedback").then((m) => ({ default: m.FeedbackView })));

interface NavItem {
  id: ViewId;
  label: MessageKey;
  icon: IconName;
  key: string;
}

const SECTIONS: { title: MessageKey | null; items: NavItem[] }[] = [
  { title: null, items: [{ id: "attention", label: "nav.attention", icon: "home", key: "h" }] },
  {
    title: "nav.review",
    items: [
      { id: "conventions", label: "nav.conventions", icon: "review", key: "c" },
      { id: "funnel", label: "nav.funnel", icon: "filter", key: "f" },
      { id: "from-map", label: "nav.fromMap", icon: "map", key: "w" },
    ],
  },
  {
    title: "nav.investigate",
    items: [
      { id: "check", label: "nav.check", icon: "violation", key: "v" },
      { id: "sessions", label: "nav.sessions", icon: "session", key: "s" },
      { id: "feedback", label: "nav.feedback", icon: "check", key: "b" },
    ],
  },
  {
    title: "nav.understand",
    items: [
      { id: "map", label: "nav.map", icon: "map", key: "m" },
      { id: "security", label: "nav.security", icon: "shield", key: "x" },
      { id: "practices", label: "nav.practices", icon: "layers", key: "p" },
    ],
  },
  { title: "nav.evidence", items: [{ id: "studies", label: "nav.studies", icon: "flask", key: "t" }] },
];
const FOOTER: NavItem[] = [
  { id: "logs", label: "nav.logs", icon: "logs", key: "l" },
  { id: "upgrade", label: "nav.upgrade", icon: "refresh", key: "y" },
  { id: "settings", label: "nav.settings", icon: "settings", key: "," },
  { id: "gallery", label: "nav.gallery", icon: "grid", key: "u" },
];
const ALL = [...SECTIONS.flatMap((s) => s.items), ...FOOTER];

export function Shell({ platform }: { platform: string }) {
  const api = useApi();
  const { repo, recent, open, select } = useRepo();
  const [route] = useRoute();
  const [code, setCode] = useState<CodeTarget | null>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [changed, setChanged] = useState<RepoChange | null>(null);
  const theme = useTheme();

  const info = useDriftInfo();
  const facts = useFacts(repo);
  useCensus(repo);
  const check = useCheck(repo);
  const security = useSecurity(repo);
  const conv = useConventions(repo);
  const sessions = useSessions(repo, false);
  const history = useHistory(repo);
  const record = useRecordSnapshot(repo);
  const steps = useRunState(repo, facts.refreshing);
  const rescanAll = useRescan(repo, facts.refresh);
  const ix = useFactsIndex(facts.data?.data);

  const rescan = async () => {
    setChanged(null);
    await rescanAll();
  };

  useEffect(() => api.onRepoChanged((c) => repo && c.repo === repo.path && setChanged(c)), [api, repo]);
  useEffect(() => setChanged(null), [repo]);

  // Remember what this scan saw, once per fresh scan, so the next one can say what changed.
  const recorded = useRef<number | null>(null);
  useEffect(() => {
    const f = facts.data;
    if (!repo || !f || f.cached || !check.data || !security.data || !history.data || conv.loading) return;
    if (recorded.current === f.at) return;
    recorded.current = f.at;
    const snap = makeSnapshot({
      at: f.at,
      commit: f.provenance.commit,
      files: f.data.files.length,
      pending: conv.rows.filter((r) => r.status === "proposed").map((r) => r.id),
      check: check.data.data,
      security: security.data.data,
    });
    const last = history.data.snapshots.at(-1);
    if (!last || !sameSnapshot(last, snap)) record.mutate(snap);
  }, [repo, facts.data, check.data, security.data, history.data, conv.loading, conv.rows, record]);

  const counts = {
    // What the Conventions view's "To review" lists (its count and progress read the same helper).
    pending: reviewCounts(conv.rows).toReview,
    newViolations: check.data ? checkCounts(check.data.data).new : 0,
    sessions: sessions.data?.length ?? 0,
  };
  const badge: Partial<Record<ViewId, number>> = { conventions: counts.pending, check: counts.newViolations };

  // Keyboard: mod+K palette, g-chords for views, ? for help.
  const chord = useRef<number>(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchKey(e, "mod+k")) {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (inTextField(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']")) return;
      if (e.key === "g" && !e.shiftKey) {
        chord.current = Date.now();
        return;
      }
      if (Date.now() - chord.current < 1200) {
        const item = ALL.find((i) => i.key === e.key);
        chord.current = 0;
        if (item) {
          e.preventDefault();
          navigate(item.id);
        }
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === "R" && e.shiftKey) {
        e.preventDefault();
        void rescan();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const commands = useMemo<Command[]>(() => {
    const cs: Command[] = ALL.map((i) => ({ id: i.id, group: "Views", label: t(i.label), icon: i.icon, shortcut: `g ${i.key}`, run: () => navigate(i.id) }));
    cs.push(
      { id: "rescan", group: "Actions", label: "Rescan the repository", icon: "refresh", shortcut: "shift+R", run: () => void rescan() },
      { id: "open", group: "Actions", label: t("shell.openRepo"), icon: "folder", run: () => void open() },
      { id: "theme-dark", group: "Actions", label: "Theme: dark", icon: "moon", run: () => theme.setPreference("dark") },
      { id: "theme-light", group: "Actions", label: "Theme: light", icon: "sun", run: () => theme.setPreference("light") },
      { id: "hc", group: "Actions", label: `High contrast: ${theme.highContrast ? "off" : "on"}`, icon: "contrast", run: () => theme.setHighContrast(!theme.highContrast) },
      { id: "density", group: "Actions", label: `Density: ${theme.density === "compact" ? "comfortable" : "compact"}`, icon: "layers", run: () => theme.setDensity(theme.density === "compact" ? "comfortable" : "compact") },
      ...directionNames.map((d) => ({ id: `direction-${d}`, group: "Actions", label: `Direction: ${directions[d].label}`, detail: directions[d].thesis, icon: "layers" as const, run: () => theme.setDirection(d) })),
      { id: "help", group: "Actions", label: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", run: () => setHelp(true) },
    );
    for (const r of recent) cs.push({ id: `repo:${r.path}`, group: "Repositories", label: r.name, detail: r.path, icon: "repo", run: () => select(r) });
    for (const r of conv.rows) cs.push({ id: r.id, group: "Conventions", label: r.summary, detail: r.id, icon: "review", keywords: r.id, run: () => navigate("conventions", r.id) });
    for (const s of sessions.data ?? []) cs.push({ id: s.id, group: "Sessions", label: s.title ?? s.id, detail: s.id.slice(0, 8), icon: "session", run: () => navigate("sessions", s.id) });
    return cs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, conv.rows, sessions.data, theme.highContrast, theme.density, theme.direction]);

  const searchCmd = (q: string): Command[] =>
    ix
      ? searchFiles(ix, q, 30).map((p) => ({ id: p, group: "Files", label: p.split("/").pop() ?? p, detail: p, icon: "file" as IconName, run: () => setCode({ path: p }) }))
      : [];

  const current = ALL.find((i) => i.id === route.view) ?? ALL[0];
  const f = facts.data;
  const view = !repo ? (
    <NoRepo onOpen={() => void open()} />
  ) : (
    <ErrorBoundary key={`${route.view}:${repo.path}`} name={t(current.label)}>
      <Suspense fallback={<Loading />}>{renderView(route.view, route.param, route.query)}</Suspense>
    </ErrorBoundary>
  );

  return (
    <CodeCtx.Provider value={setCode}>
      <div className="st-shell" data-platform={platform}>
        <a className="st-skip" href="#main">
          Skip to content
        </a>
        <aside className="st-sidebar" aria-label="Navigation">
          <div className="st-brand st-drag">
            <DriftMark size={22} />
            <span className="st-brand__name">{t("app.name")}</span>
            {api.mode === "fixture" && (
              <Badge tone="info" title="The browser build reads fixtures produced by the real drift binary">
                fixtures
              </Badge>
            )}
          </div>
          <Menu
            label={t("shell.switchRepo")}
            items={[
              ...recent.map((r) => ({ id: r.path, label: r.name, icon: (r.path === repo?.path ? "check" : "repo") as IconName, onSelect: () => select(r) })),
              "separator" as const,
              { id: "open", label: t("shell.openRepo"), icon: "folder" as IconName, onSelect: () => void open() },
            ]}
            trigger={
              <button type="button" className="st-repo">
                <Icon name="repo" size={14} />
                <span className="st-repo__text">
                  <span className="st-repo__name">{repo?.name ?? t("shell.noRepo")}</span>
                  {f && (
                    <span className="st-repo__meta">
                      {f.provenance.branch ?? "detached"} · {f.provenance.commit ?? "no commit"}
                    </span>
                  )}
                </span>
                <Icon name="chevron-down" size={12} />
              </button>
            }
          />
          <nav className="st-nav">
            {SECTIONS.map((s, si) => (
              <div key={si} className="st-nav__section">
                {s.title && <div className="st-nav__title">{t(s.title)}</div>}
                {s.items.map((i) => (
                  <NavLink key={i.id} item={i} active={route.view === i.id} count={badge[i.id]} />
                ))}
              </div>
            ))}
          </nav>
          <div className="st-nav st-nav--footer">
            {FOOTER.map((i) => (
              <NavLink key={i.id} item={i} active={route.view === i.id} />
            ))}
          </div>
        </aside>

        <div className="st-main">
          <header className="st-topbar st-drag">
            <div className="st-topbar__title">
              <h1 className="t-h3">{t(current.label)}</h1>
              {f && (
                <span className="st-fresh" title={`Facts produced ${new Date(f.at).toLocaleString()} ${f.cached ? "(cached)" : ""}`}>
                  <Icon name="clock" size={12} />
                  {f.cached ? "cached scan, " : ""}
                  {t("shell.scanned", { when: relTime(f.at) })}
                  {f.provenance.commit && (
                    <>
                      {" "}
                      {t("shell.at", { commit: "" })}
                      <span className="dui-mono">{f.provenance.commit}</span>
                    </>
                  )}
                  {f.ms ? <span className="t-muted"> · {duration(f.ms)}</span> : null}
                </span>
              )}
              {changed && changed.changed > 0 && (
                <Tooltip content={changed.sample.join("\n") || t("shell.staleBody", { n: changed.changed })}>
                  <span tabIndex={0}>
                    <StateLabel tone="warning" icon="attention">
                      {t("shell.stale")}: {t("shell.staleBody", { n: changed.changed })}
                    </StateLabel>
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="st-topbar__actions st-nodrag">
              {steps.length > 0 && (
                <div className="st-steps" role="status" aria-live="polite">
                  <Progress label={t("shell.scanning")} />
                  <span>{steps.map((s) => t(`steps.${s}` as MessageKey)).join(" · ")}</span>
                </div>
              )}
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void rescan()} disabled={!repo || steps.length > 0} shortcut="shift+R">
                {t("shell.rescan")}
              </Button>
              <button type="button" className="st-palette-btn" onClick={() => setPalette(true)}>
                <Icon name="search" size={14} />
                <span>{t("shell.palette")}</span>
                <Kbd>mod+k</Kbd>
              </button>
              <Menu
                label={t("shell.theme")}
                items={[
                  { id: "dark", label: "Dark", icon: theme.preference === "dark" ? "check" : "moon", onSelect: () => theme.setPreference("dark") },
                  { id: "light", label: "Light", icon: theme.preference === "light" ? "check" : "sun", onSelect: () => theme.setPreference("light") },
                  { id: "system", label: "Match system", icon: theme.preference === "system" ? "check" : "contrast", onSelect: () => theme.setPreference("system") },
                  "separator",
                  { id: "hc", label: t("shell.highContrast"), icon: theme.highContrast ? "check" : "contrast", onSelect: () => theme.setHighContrast(!theme.highContrast) },
                  { id: "density", label: theme.density === "compact" ? "Comfortable density" : "Compact density", icon: "layers", onSelect: () => theme.setDensity(theme.density === "compact" ? "comfortable" : "compact") },
                  "separator",
                  ...directionNames.map((d) => ({ id: `direction-${d}`, label: directions[d].label, icon: theme.direction === d ? ("check" as const) : ("layers" as const), onSelect: () => theme.setDirection(d) })),
                ]}
                trigger={<IconButton icon={theme.theme.startsWith("light") ? "sun" : "moon"} label={t("shell.theme")} />}
              />
            </div>
          </header>
          <main id="main" className="st-content" tabIndex={-1}>
            {view}
          </main>
          <footer className="st-status" aria-label="Status">
            <span className={info.data?.path ? "" : "t-danger"} title={info.data?.path ?? undefined}>
              <Icon name="logs" size={12} /> {info.data?.version ?? t("shell.driftMissing")}
              {info.data?.path && <span className="t-muted dui-mono"> {info.data.path}</span>}
            </span>
            {info.data && !info.data.censusJson && <span className="t-warning">census --json unavailable</span>}
            <span className="st-grow" />
            {facts.data && <span className="t-muted">{facts.data.data.files.length.toLocaleString()} files</span>}
            <span className="t-muted">
              <Icon name="shield" size={12} /> {t("app.noTelemetry")}
            </span>
          </footer>
        </div>
      </div>
      <CodeDrawer target={code} onClose={() => setCode(null)} />
      <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} search={searchCmd} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
    </CodeCtx.Provider>
  );
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  return (
    <a href={href(item.id)} className={`st-nav__item${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} size={15} />
      <span className="st-nav__label">{t(item.label)}</span>
      {count ? <span className="st-nav__count">{count.toLocaleString()}</span> : <span className="st-nav__key">g {item.key}</span>}
    </a>
  );
}

function renderView(view: ViewId, param: string | null, query: URLSearchParams): ReactNode {
  switch (view) {
    case "attention":
      return <AttentionView />;
    case "conventions":
      return <ConventionsView selectedId={param} />;
    case "check":
      return <CheckView />;
    case "map":
      return <MapView focus={query.get("focus")} />;
    case "security":
      return <SecurityView tab={param} />;
    case "practices":
      return <PracticesView tab={param} concern={query.get("concern")} />;
    case "funnel":
      return <FunnelView gate={param} />;
    case "sessions":
      return <SessionsView sessionId={param} />;
    case "studies":
      return <StudiesView />;
    case "logs":
      return <LogsView />;
    case "settings":
      return <SettingsView />;
    case "gallery":
      return <GalleryView />;
    case "from-map":
      return <FromMapView />;
    case "upgrade":
      return <UpgradeView />;
    case "feedback":
      return <FeedbackView />;
  }
}

function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const rows: [string, string][] = [
    ["mod+k", "Command palette: views, files, conventions, sessions"],
    ...ALL.map((i) => [`g ${i.key}`, t(i.label)] as [string, string]),
    ["shift+R", "Rescan"],
    ["j k", "Next / previous (lists)"],
    ["a r b", "Accept, reject, block (review)"],
    ["u", "Undo the last decision (within 5 s)"],
    ["o", "Open the example in the code drawer"],
    ["n shift+N", "Next / previous Drift event (sessions)"],
    ["esc", "Close"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="md">
      <table className="st-keys">
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k + label}>
              <td>
                <Kbd>{k}</Kbd>
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
