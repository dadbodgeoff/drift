// Agent sessions: a Claude Code transcript as a timeline, with Drift's hook
// messages aligned on it exactly as the agent received them, the session
// state Drift wrote, and diffs of every edit. Secrets are redacted by default.
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  DRIFT_MESSAGE,
  DiffView,
  DriftMessage,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  type IconName,
  Kbd,
  Panel,
  SearchInput,
  SplitPane,
  StateLabel,
  Switch,
  Tag,
  Timeline,
  TimelineItem,
  inTextField,
  langOf,
  useToast,
} from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys } from "@/entities/drift";
import { useApi } from "@/shared/api";
import { type DriftKind, type TimelineEvent, type Transcript, advisedViolations, alignState, filterEvents, primedRules, sessionStats, useSessionState, useSessions, useTranscript } from "@/entities/session";
import type { SessionState } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";
import { bytes, duration, num, relTime } from "@/shared/lib/format";
import { mdCode, mdFence } from "@/shared/lib/markdown";
import { redact, redactLines } from "@/shared/lib/redact";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";

const DRIFT_UI = DRIFT_MESSAGE as Record<DriftKind, { tone: "info" | "warning" | "danger" | "accent" | "neutral"; icon: IconName; label: string; hook: string }>;
/** Drift's hooks in the order they fire in an agent's turn. */
const LIFECYCLE: { hook: string; kinds: DriftKind[]; does: string }[] = [
  { hook: "SessionStart", kinds: ["practices", "brief", "session", "unchecked", "recovered"], does: "gives the recipes of the session's package (practices, facts not rules), then briefs the agent on packages and entry points and names `drift card` as the first stop (also without a policy); records the violations that already exist as the baseline; names files it could not check, whose violations are unknown" },
  { hook: "PreToolUse", kinds: ["primed", "practices", "denied", "lookup"], does: "tells the agent a role's rules before a new file (by what it declares), and the recipe of a new file's kind once (practices, facts not rules); denies writes to .drift/ and drift.lock, by file tools or shell commands; before a search for how auth, validation, errors or routes are done, names the `drift card` that answers it, once per file" },
  {
    hook: "PostToolUse",
    kinds: ["advised", "unchecked", "unsure", "exempt", "practices", "facts"],
    does: "advises on new violations in the edited file, once each; says when the file was not checked, and lists possible violations, not certain, that depend on files not checked; names new members a convention is not about (exempt), once each; names the concerns the file's new entry points do another way than at least 80% of those around them (practices, facts not rules, also with nothing accepted), once each; says what the edit introduced that the code did not have at session start: a risky operation, an entry point reaching one (those with no guard first), client code reaching server-only code or a secret (facts not rules, never blocks), once each; says when an import of the file makes its package depend on a package it did not depend on at session start, and when that makes the two depend on each other, once per pair",
  },
  {
    hook: "Stop",
    kinds: ["blocked", "unsure_start", "unsure_again", "unchecked", "stepped_aside", "recovered", "exempt", "unwired", "facts"],
    does: "blocks the end of the turn on block-mode violations, saying which were unsure at session start (those block once, then are listed as advice); steps aside after 3 blocks or no progress; recovers a missing baseline; names files it could not check; notes exempt members to the person, never blocking; tells the person about code not wired up (experimental, never blocks); when the agent was told a fact about its edits in the turn that still stands, tells the person in one line how many of those the session's code still has and where (practice departures, security facts, package edges; never blocks)",
  },
  { hook: "UserPromptSubmit", kinds: ["unwired"], does: "hands the agent the wiring advice from the last Stop with its next prompt, once (experimental)" },
];
/** How the lifecycle rail counts a kind ("2 advised · 1 not checked · 1 exempt"). */
const KIND_WORD: Partial<Record<DriftKind, string>> = { session: "baseline", stepped_aside: "stepped aside", recovered: "baseline recovered", unchecked: "not checked", unsure: "possible", unsure_start: "unsure at start", unsure_again: "still there (advice)", exempt: "exempt", facts: "introduced", unwired: "not wired up", lookup: "search hint", brief: "brief" };
const MAX_EVENTS = 1500;

export function SessionsView({ sessionId }: { sessionId: string | null }) {
  const { repo } = useRepo();
  const [all, setAll] = useState(false);
  const sessions = useSessions(repo, all);
  const list = useMemo(() => sessions.data ?? [], [sessions.data]);
  const id = sessionId ?? list[0]?.id ?? null;
  const api = useApi();
  const states = useQueries({
    queries: list.map((s) => ({ queryKey: keys.sessionState(repo!, s.id), queryFn: () => api.readSessionState(repo!, s.id), enabled: !!repo && s.hasState, staleTime: 30_000 })),
  });
  useEffect(() => {
    if (!sessionId && list[0]) navigate("sessions", list[0].id);
  }, [sessionId, list]);
  return (
    <div className="st-review">
      <SplitPane storageKey="sessions" initial={320} min={240} max={520}>
        <div className="st-queue">
          <div className="st-queue__head">
            <Switch checked={all} onCheckedChange={setAll} label="All projects" />
          </div>
          <div className="st-queue__list" role="listbox" aria-label="Sessions">
            {sessions.isLoading && <Loading lines={4} />}
            {sessions.error && <ErrorState error={sessions.error} />}
            {!sessions.isLoading && list.length === 0 && (
              <EmptyState icon="session" title={t("sessions.none")}>
                {t("sessions.noneBody")}
              </EmptyState>
            )}
            {list.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={s.id === id} className={`st-qitem${s.id === id ? " is-selected" : ""}`} onClick={() => navigate("sessions", s.id)}>
                <span className="st-qitem__top">
                  <SessionVerdict hasState={s.hasState} state={states[list.indexOf(s)]?.data ?? null} />
                  <span className="st-grow" />
                  <span className="t-caption t-muted">{relTime(s.modified)}</span>
                </span>
                <span className="st-qitem__summary">{s.title ?? s.id}</span>
                <span className="st-qitem__meta">
                  <span className="dui-mono t-caption t-muted">{s.id.slice(0, 8)}</span>
                  <span className="t-caption t-muted">{bytes(s.bytes)}</span>
                  {all && <span className="dui-mono t-caption t-muted t-truncate">{s.project}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="st-detail">{id ? <Session id={id} project={list.find((s) => s.id === id)?.project ?? null} title={list.find((s) => s.id === id)?.title ?? null} /> : <EmptyState icon="session" title="Choose a session" />}</div>
      </SplitPane>
    </div>
  );
}

/** What Drift did in a session, worst first: blocked, advised, primed, quiet. */
function SessionVerdict({ hasState, state }: { hasState: boolean; state: SessionState | null }) {
  if (!hasState) return <span className="t-caption t-muted">no Drift state</span>;
  if (!state) return <span className="t-caption t-muted">Drift state</span>;
  if ((state.blocks ?? 0) > 0)
    return (
      <StateLabel tone="danger" icon="blocked">
        blocked {state.blocks}×{(state.blocks ?? 0) >= 3 ? " · stepped aside" : ""}
      </StateLabel>
    );
  const advised = advisedViolations(state).length;
  if (advised > 0)
    return (
      <StateLabel tone="warning" icon="attention">
        advised {advised}×
      </StateLabel>
    );
  if (primedRules(state).length > 0)
    return (
      <StateLabel tone="accent" icon="sparkle">
        primed {primedRules(state).length} rules
      </StateLabel>
    );
  return (
    <StateLabel tone="neutral" icon="dot">
      Drift stayed quiet
    </StateLabel>
  );
}

function Session({ id, project, title }: { id: string; project: string | null; title: string | null }) {
  const { repo } = useRepo();
  const tr = useTranscript(repo, id);
  const state = useSessionState(repo, id);
  const toast = useToast();
  const [driftOnly, setDriftOnly] = useState(false);
  const [editsOnly, setEditsOnly] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement | null>(null);
  const t0 = tr.transcript?.start ?? null;
  const events = useMemo(() => (tr.transcript ? filterEvents(tr.transcript.events, { driftOnly, editsOnly, showThinking, showSidechain: true, query: q }) : []), [tr.transcript, driftOnly, editsOnly, showThinking, q]);
  const driftIdx = useMemo(() => events.map((e, i) => (e.type === "hook" && e.drift ? i : -1)).filter((i) => i >= 0), [events]);
  const local = project === repo?.path;

  const jump = (dir: 1 | -1) => {
    if (!driftIdx.length) return;
    const next = dir === 1 ? (driftIdx.find((i) => i > cursor) ?? driftIdx[0]) : ([...driftIdx].reverse().find((i) => i < cursor) ?? driftIdx[driftIdx.length - 1]);
    setCursor(next);
    box.current?.querySelector(`#ev-${events[next].seq}`)?.scrollIntoView({ block: "center" });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e) || e.metaKey || e.ctrlKey || document.querySelector("[aria-modal='true']")) return;
      if (e.key === "n") jump(1);
      else if (e.key === "N") jump(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => setCursor(-1), [id]);

  const secretCount = useSecretCount(tr.transcript);

  if (tr.isLoading) return <Loading label="Reading the transcript" />;
  if (tr.error) return <ErrorState title="The transcript could not be read" error={tr.error} />;
  if (!tr.transcript) return null;
  const T = tr.transcript;
  const stats = sessionStats(T);
  const red = (s: string) => (reveal ? s : redact(s).text);
  const redLines = (lines: string[]) => (reveal ? lines : redactLines(lines).lines);

  const exportMd = () => {
    const lines = [`**Agent session** ${mdCode(id)}${T.model ? ` (${T.model})` : ""}: where Drift stepped in`, ""];
    for (const e of T.events) {
      if (e.type === "hook" && e.drift) lines.push(`- ${DRIFT_UI[e.drift.kind].label}${e.drift.ids.length ? ` ${e.drift.ids.map(mdCode).join(", ")}` : ""}`, mdFence(redact(e.text).text));
      if (e.type === "tool" && e.edit) lines.push(`- ${e.name} ${mdCode(e.edit.path)}`);
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
    toast.show({ title: t("common.copied"), body: "Session excerpt copied as Markdown (secrets redacted)", tone: "success", duration: 2000 });
  };

  return (
    <div className="ss" ref={box}>
      <header className="ss-head">
        <div className="st-row st-wrap">
          <span className="dui-mono t-caption t-muted">{id}</span>
          {T.model && <Badge>{T.model}</Badge>}
          {stats.durationMs !== null && <span className="t-caption t-muted">{duration(stats.durationMs)}</span>}
          {T.cwd && <span className="dui-mono t-caption t-muted t-truncate">{T.cwd}</span>}
          <span className="st-grow" />
          <Button size="sm" variant="ghost" icon="copy" onClick={exportMd}>
            {t("common.exportMd")}
          </Button>
        </div>
        {title && <h2 className="t-h2 ss-title">{red(title)}</h2>}
        <p className="t-caption t-muted ss-meta">
          {num(stats.prompts)} prompts · {num(stats.toolCalls)} tool calls · {num(stats.edits)} edits{stats.filesEdited.length ? ` in ${stats.filesEdited.length} files` : ""}
        </p>
        <ol className="ss-life" aria-label="What Drift did at each hook">
          {LIFECYCLE.map((h) => {
            const at = stats.byHook[h.hook] ?? {};
            const n = h.kinds.reduce((m, k) => m + (at[k] ?? 0), 0);
            const worst = h.kinds.find((k) => (at[k] ?? 0) > 0);
            const ui = worst ? DRIFT_UI[worst] : null;
            return (
              <li key={h.hook} className={`ss-life__step${ui ? ` is-${ui.tone}` : ""}`}>
                <span className="ss-life__hook">{h.hook}</span>
                <span className="ss-life__count">{num(n)}</span>
                <span className="ss-life__what">
                  {h.kinds
                    .filter((k) => (at[k] ?? 0) > 0)
                    .map((k) => `${at[k]} ${KIND_WORD[k] ?? k}`)
                    .join(" · ") || "nothing"}
                </span>
                <span className="ss-life__does">{h.does}</span>
              </li>
            );
          })}
        </ol>
        {(stats.drift.denied > 0 || stats.drift.stepped_aside > 0 || stats.uncheckedFiles.length > 0 || stats.unsureFiles.length > 0 || stats.drift.exempt > 0) && (
          <div className="ss-callouts">
            {stats.drift.denied > 0 && (
              <StateLabel tone="danger" icon="blocked">
                {stats.drift.denied} denied {stats.drift.denied === 1 ? "write" : "writes"} to Drift policy (.drift/ or drift.lock)
                {stats.shellDenied > 0 ? `, ${stats.shellDenied} by a shell command` : ""}: policy is changed by people
              </StateLabel>
            )}
            {stats.drift.stepped_aside > 0 && (
              <StateLabel tone="neutral" icon="info">
                Loop guard: Drift stepped aside and left {stats.drift.stepped_aside === 1 ? "a violation" : "violations"} for review
              </StateLabel>
            )}
            {stats.uncheckedFiles.length > 0 && (
              <StateLabel tone="warning" icon="attention">
                {num(stats.uncheckedFiles.length)} {stats.uncheckedFiles.length === 1 ? "file" : "files"} not checked: no stack large enough to parse {stats.uncheckedFiles.length === 1 ? "it" : "them"} could be reserved, so {stats.uncheckedFiles.length === 1 ? "its" : "their"} violations are unknown, not absent
              </StateLabel>
            )}
            {stats.unsureFiles.length > 0 && (
              <StateLabel tone="info" icon="info">
                Possible violations in {num(stats.unsureFiles.length)} {stats.unsureFiles.length === 1 ? "file" : "files"}, not certain: {stats.unsureFiles.length === 1 ? "it depends" : "they depend"} on files not checked
              </StateLabel>
            )}
            {stats.drift.exempt > 0 && (
              <StateLabel tone="neutral" icon="dot">
                {stats.exemptMembers > 0 ? `${num(stats.exemptMembers)} ${stats.exemptMembers === 1 ? "member" : "members"}` : "Members"} of the agent's code not checked: exempt from an accepted convention, with Drift's reason (review them in Check)
              </StateLabel>
            )}
          </div>
        )}
        <Strip transcript={T} events={events} cursor={cursor} onPick={(i) => (setCursor(i), box.current?.querySelector(`#ev-${events[i].seq}`)?.scrollIntoView({ block: "center" }))} />
      </header>

      <div className="ss-body">
        <div className="ss-main">
          <div className="st-toolbar st-toolbar--tight ss-toolbar">
            <Switch checked={driftOnly} onCheckedChange={setDriftOnly} label="Drift only" />
            <Switch checked={editsOnly} onCheckedChange={setEditsOnly} label="Edits only" />
            <Switch checked={showThinking} onCheckedChange={setShowThinking} label="Reasoning" />
            <Switch checked={!reveal} onCheckedChange={(v) => setReveal(!v)} label={`Redact secrets${secretCount ? ` (${secretCount})` : ""}`} />
            <span className="st-grow" />
            <SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Search" label="Search the session" />
            <IconButton size="sm" icon="chevron-up" onClick={() => jump(-1)} disabled={!driftIdx.length} label="Previous Drift event (Shift+N)" />
            <Button size="sm" variant="secondary" icon="chevron-down" onClick={() => jump(1)} disabled={!driftIdx.length} shortcut="n">
              Next Drift event
            </Button>
          </div>
          {events.length === 0 ? (
            <EmptyState icon="filter" title="No events match these filters" />
          ) : (
            <Timeline label="Session timeline">
              {events.slice(0, MAX_EVENTS).map((e, i) => (
                <Event key={e.seq} e={e} t0={t0} red={red} redLines={redLines} active={i === cursor} local={local} />
              ))}
            </Timeline>
          )}
          {events.length > MAX_EVENTS && <p className="t-muted st-pad">{num(events.length - MAX_EVENTS)} more events not shown; narrow the filters.</p>}
          {T.malformed > 0 && <p className="st-note st-pad">{T.malformed} transcript lines could not be parsed and were skipped.</p>}
        </div>
        {/* Focusable: it scrolls on its own when the state is long (unsure_at_start), and keyboard users must be able to scroll it. */}
        <aside className="ss-side" aria-label="Drift's session state" tabIndex={0}>
          <StatePanel transcript={T} state={state.data ?? null} loading={state.isLoading} />
          {stats.filesEdited.length > 0 && (
            <Panel title="Files edited" padded={false}>
              <ul className="st-outliers">
                {stats.filesEdited.map((f) => (
                  <li key={f}>
                    <span className="st-pathlink">
                      <Icon name="edit" size={12} />
                      <span className="dui-mono t-truncate">{f}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function useSecretCount(T: Transcript | null): number {
  return useMemo(() => {
    let n = 0;
    for (const e of T?.events ?? []) {
      const s = e.type === "tool" ? `${JSON.stringify(e.input)}\n${e.result?.text ?? ""}` : e.type === "hook" ? e.text : e.text;
      n += redact(s).count;
      // Diff lines are shown separately, so they count separately.
      if (e.type === "tool" && e.edit) for (const h of e.edit.hunks) n += redactLines(h.lines.map((l) => l.slice(1))).count;
    }
    return n;
  }, [T]);
}

/** Every event as a tick on one time axis; Drift events stand out. */
function Strip({ transcript, events, cursor, onPick }: { transcript: Transcript; events: TimelineEvent[]; cursor: number; onPick(i: number): void }) {
  const a = transcript.start ?? 0;
  const span = Math.max(1, (transcript.end ?? a) - a);
  return (
    <div className="ss-strip" aria-label="Session at a glance" role="group">
      {events.map((e, i) => {
        if (e.time === null) return null;
        const left = ((e.time - a) / span) * 100;
        const kind = e.type === "hook" && e.drift ? e.drift.kind : e.type === "tool" && e.edit ? "edit" : e.type;
        const isDrift = e.type === "hook" && !!e.drift;
        return isDrift ? (
          <button key={e.seq} type="button" className={`ss-tick is-${kind}${i === cursor ? " is-cursor" : ""}`} style={{ left: `${left}%` }} onClick={() => onPick(i)} aria-label={`${DRIFT_UI[(e as { drift: { kind: DriftKind } }).drift.kind].label} at ${new Date(e.time).toLocaleTimeString()}`} />
        ) : (
          <span key={e.seq} className={`ss-tick is-${kind}`} style={{ left: `${left}%` }} aria-hidden="true" />
        );
      })}
    </div>
  );
}

function rel(t: number | null, t0: number | null) {
  if (t === null || t0 === null) return "";
  const s = Math.round((t - t0) / 1000);
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Event({ e, t0, red, redLines, active, local }: { e: TimelineEvent; t0: number | null; red(s: string): string; redLines(lines: string[]): string[]; active: boolean; local: boolean }) {
  const openCode = useOpenCode();
  const id = `ev-${e.seq}`;
  const time = rel(e.time, t0);
  switch (e.type) {
    case "prompt":
      return (
        <TimelineItem id={id} time={time} icon="user" tone="info" title="User" active={active}>
          <pre className="ss-text">{red(e.text)}</pre>
        </TimelineItem>
      );
    case "text":
      return (
        <TimelineItem id={id} time={time} icon="sparkle" title="Assistant" active={active}>
          <pre className="ss-text">{red(e.text)}</pre>
        </TimelineItem>
      );
    case "thinking":
      return (
        <TimelineItem id={id} time={time} icon="brain" tone="muted" title={<span className="t-secondary">Model reasoning</span>} meta={e.redacted ? "not recorded" : undefined} active={active} className="ss-thinking">
          {e.redacted ? (
            <p className="t-caption t-muted">The provider did not include this reasoning in the transcript.</p>
          ) : (
            <details className="ss-details" open>
              <summary>The model's reasoning, not an action</summary>
              <pre className="ss-text ss-text--reasoning">{red(e.text)}</pre>
            </details>
          )}
        </TimelineItem>
      );
    case "tool":
      return (
        <TimelineItem
          id={id}
          time={time}
          icon={e.edit ? "edit" : "tool"}
          tone={e.result?.isError ? "danger" : e.edit ? "accent" : "neutral"}
          title={
            <span className="st-row">
              <span className="dui-mono">{e.name}</span>
              <span className="t-secondary t-truncate dui-mono t-body-sm">{red(e.summary)}</span>
            </span>
          }
          meta={e.result?.isError ? "error" : e.result ? undefined : "no result"}
          active={active}
        >
          {e.edit && (
            <DiffView
              // The diff is repository and agent text like any other: redacted unless revealed.
              // Each hunk is redacted as one text, so secrets that span lines (PEM keys) are caught.
              hunks={e.edit.hunks.map((h) => ({ ...h, lines: redLines(h.lines.map((l) => l.slice(1))).map((l, i) => h.lines[i].slice(0, 1) + l) }))}
              lang={langOf(e.edit.path)}
              created={e.edit.created}
              label={`${e.edit.tool} ${red(e.edit.path)}`}
              maxLines={120}
            />
          )}
          <details className="ss-details">
            <summary>Input{e.result ? " and result" : ""}</summary>
            <pre className="ss-code">{red(JSON.stringify(e.input, null, 2))}</pre>
            {e.result && <pre className={`ss-code${e.result.isError ? " is-error" : ""}`}>{red(e.result.text) || "(empty)"}</pre>}
          </details>
        </TimelineItem>
      );
    case "hook": {
      if (!e.drift)
        return (
          <TimelineItem id={id} time={time} icon="dot" tone="muted" title={<span className="t-secondary">{e.hookName} hook</span>} active={active}>
            <details className="ss-details">
              <summary>Context added by a hook</summary>
              <pre className="ss-code">{red(e.text)}</pre>
            </details>
          </TimelineItem>
        );
      const ui = DRIFT_UI[e.drift.kind];
      return (
        <TimelineItem id={id} time={time} icon={ui.icon} tone={ui.tone === "neutral" ? "muted" : ui.tone} title={<span className="ss-hookname">{e.event}</span>} active={active} className="ss-drift">
          <DriftMessage kind={e.drift.kind} hook={e.event} ids={e.drift.ids} onId={(x) => navigate("conventions", x)} text={red(e.text)}>
            {e.drift.kind === "unchecked" && (e.drift.files?.length ?? 0) > 0 && (
              <ul className="ss-findings ss-unchecked" aria-label="Files not checked">
                {e.drift.files!.map((f) => (
                  <li key={f}>
                    <span className="t-caption t-secondary">not checked</span>
                    <FileRef path={f} local={local} red={red} title={`${f}: not checked (no stack to parse it)`} />
                  </li>
                ))}
                {(e.drift.count ?? 0) > e.drift.files!.length && <li className="t-caption t-muted">and {num(e.drift.count! - e.drift.files!.length)} more</li>}
              </ul>
            )}
            {e.drift.kind === "unsure" && (e.drift.on?.length ?? 0) > 0 && (
              <ul className="ss-findings ss-unchecked" aria-label="Files not checked that these violations depend on">
                {e.drift.on!.map((f) => (
                  <li key={f}>
                    <span className="t-caption t-secondary">depends on, not checked</span>
                    <FileRef path={f} local={local} red={red} title={`${f}: not checked (no stack to parse it)`} />
                  </li>
                ))}
                {e.drift.onMore && <li className="t-caption t-muted">and more files not checked (Drift names the first three)</li>}
              </ul>
            )}
            {e.drift.kind === "session" && e.drift.blocking !== undefined && (
              <p className="t-caption t-secondary ss-modes">
                {e.drift.blocking > 0 ? `${num(e.drift.blocking)} block at end of turn` : "none blocks"} · {num(e.drift.advising ?? 0)} advise only
              </p>
            )}
            {e.drift.kind === "advised" && (e.drift.willBlock ?? 0) > 0 && (
              <p className="t-caption t-secondary ss-modes">
                {num(e.drift.willBlock!)} in block mode (marked blocks): {e.event === "PostToolUse" ? "they block the end of the turn if still there" : "they fail drift check"}
              </p>
            )}
            {(e.drift.notBaselined?.length ?? 0) > 0 && (
              <p className="t-caption t-secondary ss-notbaselined">
                Not baselined: every {e.drift.notBaselined!.join(" and ")} violation counts, because a file of that language changed since HEAD or is untracked.
              </p>
            )}
            {e.drift.findings.length > 0 && (
              <ul className="ss-findings">
                {e.drift.findings.map((f, i) => (
                  <li key={i}>
                    {f.reason !== undefined ? (
                      <span className="ss-exempt">
                        <span className="dui-mono t-accent">{red(f.symbol ?? "")}</span>
                        <span className="t-caption t-muted">not checked against</span>
                        <button type="button" className="st-link dui-mono t-caption" onClick={() => navigate("conventions", f.id)} title={`Open ${f.id}`}>
                          {f.id}
                        </button>
                        <span className="t-caption t-secondary">{red(f.reason)}</span>
                      </span>
                    ) : local && f.path ? (
                      <button
                        type="button"
                        className="st-pathlink"
                        onClick={() => openCode({ path: f.path!, line: f.line, context: { title: f.symbol ? `${f.id} at ${f.symbol}` : `${f.id} in ${f.path}`, tone: e.drift!.kind === "blocked" ? "danger" : "warning" } })}
                      >
                        <Icon name="code" size={12} />
                        <span className="dui-mono t-truncate">
                          {f.path}
                          {f.line !== undefined ? `:${f.line}` : ""}
                        </span>
                        {f.line === undefined && <span className="dui-mono t-caption t-muted">{f.id}</span>}
                        <span className="dui-mono t-accent">{f.symbol}</span>
                      </button>
                    ) : (
                      <span className="dui-mono t-caption">
                        {f.line !== undefined ? `${f.path}:${f.line} ${f.symbol ?? ""}` : `${f.id} ${f.path}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DriftMessage>
        </TimelineItem>
      );
    }
  }
}

/** A file a Drift message names: opens in the code drawer when the session is this repository's. */
function FileRef({ path, local, red, title }: { path: string; local: boolean; red(s: string): string; title: string }) {
  const openCode = useOpenCode();
  return local ? (
    <button type="button" className="st-pathlink" onClick={() => openCode({ path, context: { title, tone: "warning" } })}>
      <Icon name="code" size={12} />
      <span className="dui-mono t-truncate">{red(path)}</span>
    </button>
  ) : (
    <span className="dui-mono t-caption t-truncate">{red(path)}</span>
  );
}

function StatePanel({ transcript, state, loading }: { transcript: Transcript; state: SessionState | null; loading: boolean }) {
  if (loading) return <Loading lines={3} />;
  if (!state)
    return (
      <Panel title="Drift's session state">
        <p className="t-body-sm t-muted">
          No state file for this session in <span className="dui-mono">.drift/cache/sessions/</span>. Drift writes one when its hooks run in this repository. Hook messages in the transcript are still shown.
        </p>
      </Panel>
    );
  const a = alignState(transcript, state);
  return (
    <Panel title="Drift's session state" subtitle={<span className="dui-mono">.drift/cache/sessions/{transcript.sessionId?.slice(0, 8)}….json</span>}>
      <div className="ss-state">
        <div>
          <div className="dui-overline">Baseline</div>
          <p className="t-body-sm">
            {a.baseline} violation{a.baseline === 1 ? "" : "s"}
            {a.baselineExempt > 0 ? ` and ${a.baselineExempt} exempt member${a.baselineExempt === 1 ? "" : "s"}` : ""} existed when the session started (not the agent's doing).
          </p>
        </div>
        {a.unsureAtStart.length > 0 && (
          <div className="ss-unknown">
            <div className="dui-overline">Unsure at start ({a.unsureAtStart.length})</div>
            <p className="t-caption t-secondary">
              Violations reported as unsure when the baseline was recorded: their files depend on a file not checked. A record only: never in the baseline, so one that becomes certain blocks once, with a note that it may predate the session; after that Stop lists it as advice while its file stays as it was when it blocked.
            </p>
            <ul className="ss-statelist">
              {a.unsureAtStart.map((u) => (
                <li key={u.key}>
                  <span className="dui-mono t-caption t-truncate" title={u.key}>
                    {u.key}
                  </span>
                  {u.blockedOnce ? (
                    <span className="t-caption t-muted" title={`Drift's state (unsure_blocked): it blocked once and is listed as advice while ${u.path} is unchanged${u.blockedHash ? ` (blake3 ${u.blockedHash.slice(0, 12)}… when it blocked)` : ""}`}>
                      blocked once, now advice
                    </span>
                  ) : (
                    u.blocked && (
                      <span className="t-caption t-muted" title="A block in the transcript names this violation">
                        blocked
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="dui-overline">Primed ({a.primed.length})</div>
          <ul className="ss-statelist">
            {a.primed.map((p) => (
              <li key={p.id}>
                <Tag>{p.id}</Tag>
                <SeenMark seen={p.seen} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="dui-overline">Advised ({a.advised.length})</div>
          <ul className="ss-statelist">
            {a.advised.map((x) => (
              <li key={x.key}>
                <span className="dui-mono t-caption t-truncate" title={x.key}>
                  {x.key}
                </span>
                <SeenMark seen={x.seen} />
              </li>
            ))}
          </ul>
        </div>
        {a.exempt.length > 0 && (
          <div>
            <div className="dui-overline">Exempt, reported ({a.exempt.length})</div>
            <ul className="ss-statelist">
              {a.exempt.map((x) => (
                <li key={x.key}>
                  <span className="dui-mono t-caption t-truncate" title={`${x.id} ${x.path}#${x.symbol}`}>
                    {x.id} {x.symbol || x.path}
                  </span>
                  <SeenMark seen={x.seen} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="dui-overline">Blocks</div>
          <p className="t-body-sm">
            {a.blocks} recorded · {a.blocksSeen} in the transcript{a.blocks >= 3 ? " · Drift steps aside after 3" : ""}
          </p>
        </div>
        {(state.pending != null || (state.edited?.length ?? 0) > 0) && (
          <div className="ss-wiring">
            <div className="dui-overline">Wiring (experimental)</div>
            {state.pending ? (
              <p className="t-body-sm">Advice from the last Stop is queued: the agent gets it with its next prompt, once.</p>
            ) : (
              <p className="t-body-sm t-secondary">No wiring advice queued.</p>
            )}
            {(state.edited?.length ?? 0) > 0 && (
              <p className="t-caption t-muted">
                {state.edited!.length} file{state.edited!.length === 1 ? "" : "s"} edited since the last Stop, checked for wiring at the end of the turn.
              </p>
            )}
          </div>
        )}
      </div>
      <p className="t-caption t-muted" style={{ marginTop: 10 }}>
        <Kbd>n</Kbd> jumps to the next Drift event.
      </p>
    </Panel>
  );
}

function SeenMark({ seen }: { seen: boolean }) {
  return seen ? (
    <span className="t-success t-caption" title="The matching message is in the transcript">
      <Icon name="check" size={11} /> in transcript
    </span>
  ) : (
    <span className="t-muted t-caption" title="Recorded by Drift; the transcript has no matching message (another session file, or a subagent)">
      not in transcript
    </span>
  );
}
