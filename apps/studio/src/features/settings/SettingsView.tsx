// Settings: the drift binary, appearance, data and privacy, repositories.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, KeyValue, Panel, RadioGroup, StateLabel, Switch, directionNames, directions, useTheme, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys, parseVersion, useCensus, useCheck, useDriftInfo, usePolicyFiles, useReviewLogExport } from "@/entities/drift";
import { checkCounts } from "@/entities/check";
import { logCalibration, parseConventions, pythonProposals } from "@/entities/convention";
import { useClearHistory, useHistory } from "@/entities/history";
import { AUDIT_RETENTION, SNAPSHOT_RETENTION, useApi } from "@/shared/api";
import { IPC_VERSION } from "@/shared/ipc/contract";
import { plural, relTime } from "@/shared/lib/format";

/** The opt-in review log of the open repository: its setting (`review_log` in conventions.yaml) and the two writes, both through `drift review`. */
function useReviewLogState(includePaths: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { repo } = useRepo();
  const files = usePolicyFiles(repo);
  const [busy, setBusy] = useState(false);
  let on = false;
  try {
    on = !!files.data?.conventions && parseConventions(files.data.conventions).review_log === "on";
  } catch {
    // an unreadable policy: shown as off (the Conventions view says why)
  }
  const available = !!repo && !!files.data?.conventions;
  const toggle = async (next: boolean) => {
    if (!repo) return;
    setBusy(true);
    try {
      const out = await api.setReviewLog(repo, next);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.policy(repo) }), qc.invalidateQueries({ queryKey: keys.reviewLog(repo) })]);
      toast.show({ title: next ? "Review log on" : "Review log off", body: out.split("\n")[0], tone: "success", duration: 4000 });
    } catch (e) {
      toast.show({ title: "drift review --set-log failed", body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
    } finally {
      setBusy(false);
    }
  };
  const exportLog = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      const r = await api.exportReviewLog(repo, { includePaths });
      if (r.path) toast.show({ title: "Review log exported", body: r.output || r.path, tone: "success", duration: 5000 });
      else if (r.output) toast.show({ title: "Nothing exported", body: r.output, tone: "neutral", duration: 4000 });
    } catch (e) {
      toast.show({ title: "drift review --export-log failed", body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
    } finally {
      setBusy(false);
    }
  };
  return { on, available, busy, toggle, exportLog, command: `drift review --set-log ${on ? "off" : "on"}` };
}

/** What the review log holds of block candidates' answers (its export read back, ids hashed), as eval/study/maintainer-log.mjs counts them. */
function LogAnswers() {
  const { repo } = useRepo();
  const log = useReviewLogExport(repo);
  if (log.isLoading) return null;
  if (log.error) return <p className="st-note t-caption">The review log could not be read: {log.error instanceof Error ? log.error.message : String(log.error)}</p>;
  const c = logCalibration(log.data ?? null);
  return (
    <p className="t-body-sm t-secondary" data-testid="review-log-answers" style={{ marginTop: 10 }}>
      {!c || c.answered === 0 ? (
        <span>No block candidate&apos;s question answered in this log yet.</span>
      ) : (
        <>
          <b>
            {plural(c.answered, "block candidate", "block candidates")} answered in this log
          </b>{" "}
          (same {c.byAnswer.same}, different {c.byAnswer.different}, not a convention {c.byAnswer["not-a-convention"]}).{" "}
          {c.flagsJudged > 0
            ? `Of the ${c.flagsJudged} flags on the cards answered same or different, ${c.sameKind} kept as the same kind, ${c.setApart} set apart${c.keptFlagged ? `, ${c.keptFlagged} entry point(s) picked but not confirmed` : ""}.`
            : "The cards answered same or different flagged nothing."}
        </>
      )}
    </p>
  );
}

/**
 * The neighbour gate (round 11, WS-J): off by default, on only where DRIFT_NEIGHBOUR_GATE=on is set for every Drift a
 * person runs. The Studio passes it to the drift it runs, so it shows what the hooks and the CLI hold back there.
 */
function NeighbourGatePanel() {
  const { repo } = useRepo();
  const check = useCheck(repo, true);
  const gate = check.data?.provenance.neighbourGate ?? null;
  const held = check.data ? checkCounts(check.data.data).held : null;
  return (
    <Panel title="Neighbour gate" subtitle="Experimental and off by default: not admitted until the dev4 check measures it.">
      <div className="st-row" style={{ flexWrap: "wrap", gap: 12 }} data-testid="neighbour-gate-state">
        {gate === null ? (
          <StateLabel tone="neutral" icon="info">
            {check.isLoading ? "unknown until drift check runs" : "unknown (this Studio's main process does not report it)"}
          </StateLabel>
        ) : gate === "on" ? (
          <StateLabel tone="info" icon="info">
            on (DRIFT_NEIGHBOUR_GATE=on){held !== null ? `: ${held} warning(s) held back in the last check` : ""}
          </StateLabel>
        ) : (
          <StateLabel tone="neutral" icon="info">
            off (the default)
          </StateLabel>
        )}
      </div>
      <ul className="st-plainlist st-bullets" style={{ marginTop: 10 }}>
        <li>
          On, <code className="dui-mono">drift check</code>, the hooks, MCP and PR mode hold back a new warning nearer the members its convention sets apart (exemptions, reviewers&apos; exceptions, files set apart as a different
          kind) than its holders: listed as held back, never new, never failing. Never on an entry point, under a guard rule or under a validation rule.
        </li>
        <li>
          It is set in the environment, not in the repository: <code className="dui-mono">DRIFT_NEIGHBOUR_GATE=on</code> where the Studio is started turns it on for the drift the Studio runs, as it does for the hooks and the CLI there.
        </li>
      </ul>
    </Panel>
  );
}

export function SettingsView() {
  const api = useApi();
  const qc = useQueryClient();
  const info = useDriftInfo();
  const theme = useTheme();
  const toast = useToast();
  const { repo, recent, forget } = useRepo();
  const history = useHistory(repo);
  const clear = useClearHistory(repo);
  const [confirm, setConfirm] = useState(false);
  const d = info.data;
  const [includePaths, setIncludePaths] = useState(false);
  const review = useReviewLogState(includePaths);
  const census = useCensus(repo);
  const python = pythonProposals(census.data?.data ?? null);
  const choose = async (reset: boolean) => {
    const next = await api.chooseDrift(reset);
    qc.setQueryData(keys.info, next);
    await qc.invalidateQueries();
    toast.show({ title: next.path ? `Using ${next.version ?? "drift"}` : "drift not found", body: next.path ?? next.error, tone: next.path ? "success" : "warning" });
  };
  return (
    <div className="st-page st-settings">
      <Panel title="Drift binary" subtitle="The Studio runs this binary for every view; it never analyses code itself.">
        <KeyValue
          items={[
            { key: "Path", value: d?.path ?? <StateLabel tone="danger" icon="blocked">not found</StateLabel>, mono: true },
            { key: "Version", value: d?.version ?? "–", mono: true },
            { key: "Found via", value: d?.source ?? "–" },
            { key: "census --json", value: d?.censusJson ? <StateLabel tone="success" icon="ok">available</StateLabel> : <StateLabel tone="warning" icon="attention">missing: outliers are not shown</StateLabel> },
            { key: "Understands", value: `facts schema 4, census schema 1 (this is ${parseVersion(d?.version ?? null) ?? "an unknown version"})` },
          ]}
        />
        {d?.error && <p className="st-note">{d.error}</p>}
        <div className="st-row" style={{ marginTop: 14 }}>
          <Button icon="folder" onClick={() => void choose(false)} disabled={api.mode !== "electron"}>
            Choose binary…
          </Button>
          <Button variant="ghost" icon="refresh" onClick={() => void choose(true)} disabled={api.mode !== "electron"}>
            Auto-detect on PATH
          </Button>
        </div>
      </Panel>

      <Panel title="Appearance">
        <div className="st-settings__grid">
          <RadioGroup
            label="Visual direction"
            value={theme.direction}
            onValueChange={(v) => theme.setDirection(v)}
            options={directionNames.map((d) => ({ value: d, label: directions[d].label, hint: directions[d].thesis }))}
          />
          <RadioGroup
            label="Theme"
            value={theme.preference.replace("-hc", "") as "dark" | "light" | "system"}
            onValueChange={(v) => theme.setPreference(v)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "Match the system" },
            ]}
          />
          <RadioGroup
            label="Density"
            value={theme.density}
            onValueChange={theme.setDensity}
            options={[
              { value: "comfortable", label: "Comfortable", hint: "30 px controls, 32 px rows" },
              { value: "compact", label: "Compact", hint: "26 px controls and rows" },
            ]}
          />
          <div>
            <div className="dui-overline" style={{ marginBottom: 8 }}>
              Contrast
            </div>
            <Switch checked={theme.highContrast} onCheckedChange={theme.setHighContrast} label="High contrast (7:1 text)" />
          </div>
        </div>
      </Panel>

      <Panel title="Data and privacy" subtitle="Nothing is sent anywhere: no telemetry, no network access except what you ask for.">
        <ul className="st-plainlist st-bullets">
          <li>Drift's fact cache for each repository lives in the app's data directory (DRIFT_CACHE_DIR), not in the repository.</li>
          <li>
            Scan snapshots (to say what changed "since the last scan") and the audit trail of review decisions are kept per repository in the app's data directory, keyed by the
            repository root and its remote. Retention: the last {SNAPSHOT_RETENTION.count} snapshots within {SNAPSHOT_RETENTION.days} days; the last {AUDIT_RETENTION.count} decisions within {AUDIT_RETENTION.days} days.
          </li>
          <li>The only writes to a repository are drift review and drift init, after you choose them (the review log below is drift review's, and only when you turn it on).</li>
          <li>Transcripts are read from ~/.claude/projects and never copied.</li>
        </ul>
        <KeyValue
          items={[
            { key: "Repository", value: repo?.path ?? "–", mono: true },
            { key: "Snapshots", value: `${history.data?.snapshots.length ?? 0}${history.data?.snapshots.length ? `, latest ${relTime(history.data.snapshots.at(-1)!.at)}` : ""}` },
            { key: "Decisions", value: String(history.data?.audit.length ?? 0) },
          ]}
        />
        <div className="st-row" style={{ marginTop: 14 }}>
          <Button variant="danger" icon="x" onClick={() => setConfirm(true)} disabled={!repo}>
            Clear history for this repository
          </Button>
        </div>
      </Panel>

      <Panel title="Python proposals" subtitle="Decision D13-py: Drift makes mined Python proposals, every one a suggestion, unless you turn them off.">
        <div className="st-row" style={{ flexWrap: "wrap", gap: 12 }} data-testid="python-proposals-state">
          {python === null ? (
            <StateLabel tone="neutral" icon="info">
              unknown until census runs
            </StateLabel>
          ) : python.state === "off" ? (
            <StateLabel tone="neutral" icon="info">
              off{python.withheld > 0 ? `: ${python.withheld} not made in this repository` : ""}
            </StateLabel>
          ) : (
            <StateLabel tone="success" icon="ok">
              on (the default, or a Drift older than D13-py)
            </StateLabel>
          )}
        </div>
        <ul className="st-plainlist st-bullets" style={{ marginTop: 10 }}>
          <li>
            Turn them off with <code className="dui-mono">proposals: {"{python: off}"}</code> in <code className="dui-mono">.drift/config.yaml</code>; remove that line to turn them back on. Then run census or <code className="dui-mono">drift init</code> again.
          </li>
          <li>Python conventions you accepted are kept and checked; Python facts and the security inventory are unaffected.</li>
        </ul>
      </Panel>

      <Panel
        title="Review log"
        subtitle="Opt-in and local: off unless you turn it on, written only in this repository, never sent anywhere. For the study of how often maintainers accept what Drift proposes (decision D10.3)."
      >
        <div className="st-row" style={{ flexWrap: "wrap", gap: 16 }}>
          <Switch
            checked={review.on}
            disabled={!review.available || review.busy}
            onCheckedChange={(v) => void review.toggle(v)}
            label="Record my review decisions in this repository"
            data-testid="review-log-switch"
          />
        </div>
        <ul className="st-plainlist st-bullets" style={{ marginTop: 10 }}>
          <li>
            When on, each decision made here or in <code className="dui-mono">drift review</code> (accept, reject, block, advise, show to agents, marked fine and its reason) and each card you open is appended to{" "}
            <code className="dui-mono">.drift/review-log/</code>, with the card's rule kind, family, tier, evidence and Drift's version. It holds no source code, no file contents, no repository name or remote and nothing about who you are.
          </li>
          <li>
            An answer to a block candidate's one question is recorded with what you saw and chose: the answer, how many holders and flagged members were shown, how many you set apart as a different kind, and the entry points you picked
            but did not confirm (they stay flagged). The members set apart and kept flagged are listed by <code className="dui-mono">path#symbol</code>, hashed in the export like every member. The flags you did not set apart are your
            &quot;these are the same kind&quot;: the precision of a card&apos;s flags as maintainers judge it.
          </li>
          <li>
            The directory ignores itself in git (a <code className="dui-mono">.gitignore</code> of <code className="dui-mono">*</code>). The setting is <code className="dui-mono">review_log: on</code> in{" "}
            <code className="dui-mono">.drift/conventions.yaml</code>; the switch runs <code className="dui-mono">{review.command}</code>.
          </li>
          <li>The export is a study file you can share: convention ids, paths and symbols are replaced by hashes keyed with this repository's own random salt, and reasons by their length, unless you include them.</li>
        </ul>
        {review.on && <LogAnswers />}
        <div className="st-row" style={{ marginTop: 14, flexWrap: "wrap", gap: 16 }}>
          <Button icon="export" onClick={() => void review.exportLog()} disabled={!review.available || review.busy} data-testid="review-log-export">
            Export review log…
          </Button>
          <Switch checked={includePaths} onCheckedChange={setIncludePaths} label="Include ids, paths, symbols and reasons as they are" disabled={!review.available} />
        </div>
      </Panel>

      <NeighbourGatePanel />

      <Panel title="Repositories">
        <ul className="st-plainlist">
          {recent.map((r) => (
            <li key={r.path} className="st-row">
              <span className="t-title">{r.name}</span>
              <span className="dui-mono t-muted t-truncate">{r.path}</span>
              {r.path === repo?.path && <Badge tone="accent">open</Badge>}
              <span className="st-grow" />
              <Button size="sm" variant="ghost" onClick={() => void forget(r)} disabled={api.mode !== "electron"}>
                Forget
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="About">
        <KeyValue
          items={[
            { key: "Mode", value: api.mode === "electron" ? "Desktop app" : "Browser with fixtures" },
            { key: "IPC contract", value: `v${IPC_VERSION}` },
          ]}
        />
      </Panel>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear history for this repository?"
        description="Snapshots and the Studio's decision audit trail are deleted. The repository, conventions.yaml and drift.lock are not touched."
        confirmLabel="Clear history"
        tone="danger"
        onConfirm={() => clear.mutate(undefined, { onSuccess: () => toast.show({ title: "History cleared", tone: "success", duration: 2500 }) })}
      />
    </div>
  );
}
