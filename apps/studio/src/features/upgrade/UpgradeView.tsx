// Upgrade (`drift upgrade --json`, crates/drift-cli/src/upgrade.rs): after a newer Drift is installed, what it reads
// differently in the files an older one wrote, said in one place. Reading it changes nothing. The one write is
// "Apply…": `drift upgrade --apply` (and `--security-baseline` when ticked), offered only for work Drift lists as its
// own, confirmed in a dialog that shows that work and the command; Drift's report of what it did is shown as printed.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, Icon, Panel, useToast } from "@drift/ui";
import { keys } from "@/entities/drift";
import { useRepo } from "@/entities/repo";
import { useApi } from "@/shared/api";
import { type UpgradeOutcome, type UpgradeReport, type UpgradeTodo, type UpgradeViolation, isUpgradeRefusal } from "@/shared/contract/screens";
import { num } from "@/shared/lib/format";
import { log } from "@/shared/lib/log";
import { navigate } from "@/shared/lib/router";
import { Loading } from "@/shared/ui/QueryState";
import { WHO_TEXT, acceptedText, applyCommand, applyWork, canApply, classText, fileLine, leftBy, nowText, readUpgrade, splitConventions, whoOf } from "./model/upgrade";
import { useUpgrade } from "./model/queries";
import "./upgrade.css";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function UpgradeView() {
  const { repo } = useRepo();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useUpgrade(repo);
  const [applied, setApplied] = useState<UpgradeOutcome | null>(null);
  if (q.isLoading) return <Loading label="Running drift upgrade" />;
  if (q.error) return <ErrorState title="drift upgrade could not be read" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const apply = async (securityBaseline: boolean) => {
    if (!repo) return;
    const command = applyCommand(securityBaseline);
    const out = readUpgrade(await api.upgradeApply(repo, { securityBaseline }));
    log(isUpgradeRefusal(out) || out.failed ? "warn" : "info", command, { done: isUpgradeRefusal(out) ? [] : out.done });
    setApplied(out);
    // What it wrote (drift.lock, .drift/security.lock, agent settings) changes what check, security and the policy read.
    await Promise.all([keys.policy(repo), keys.check(repo), keys.security(repo), keys.history(repo)].map((queryKey) => qc.invalidateQueries({ queryKey })));
    if (!isUpgradeRefusal(out) && !out.failed) toast.show({ title: "drift upgrade --apply", body: out.done.length ? out.done.join("\n") : "Nothing needed writing.", tone: "success", duration: 6000 });
  };
  return <Upgrade doc={q.data.data} applied={applied} onApply={repo ? apply : undefined} />;
}

/** The page, from props only. `onApply` runs the write; without it nothing can be applied (a read-only rendering). */
export function Upgrade({ doc, applied, onApply }: { doc: UpgradeOutcome; applied?: UpgradeOutcome | null; onApply?(securityBaseline: boolean): Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="st-page ug">
      <header className="ug-head st-pad st-stack">
        <div className="dui-overline">Upgrade</div>
        <h2 className="t-h1">What this Drift reads differently</h2>
        <p className="t-secondary t-body-sm">
          After a newer Drift is installed: what it reads differently in the files an older one wrote, and what is left to do and by whom. Reading this changes nothing. Applying does only what changes no decision a person made: it
          never accepts, rejects, promotes or changes a mode, and never deletes a line.
        </p>
        <code className="st-cmd">drift upgrade --json</code>
      </header>
      <div className="st-pad st-stack st-scroll">
        {applied && <Applied out={applied} />}
        {isUpgradeRefusal(doc) ? (
          <Panel title="Drift refused" className="ug-refused">
            <p className="ck-note" role="alert">
              <Icon name="blocked" size={14} />
              <span>Nothing was read further and nothing was changed.</span>
            </p>
            <ul className="st-plainlist t-body-sm">
              {[...doc.newer, ...doc.unreadable].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {doc.unreadable.length > 0 && <p className="t-caption t-muted">Restore the file from git (git checkout -- &lt;file&gt;) or finish the edit, then run drift upgrade again.</p>}
          </Panel>
        ) : (
          <Report r={doc} onApply={onApply ? () => setConfirm(true) : undefined} />
        )}
      </div>
      {confirm && !isUpgradeRefusal(doc) && onApply && <ApplyDialog r={doc} onApply={onApply} onClose={() => setConfirm(false)} />}
    </div>
  );
}

function Report({ r, onApply }: { r: UpgradeReport; onApply?(): void }) {
  const by = leftBy(r);
  const can = canApply(r);
  const { changed, unchanged } = splitConventions(r.conventions);
  const v = r.violations;
  return (
    <>
      <p className="t-caption t-muted ug-drift">Read by {r.drift ? `drift ${r.drift}` : "this Drift"}.</p>
      {r.pending ? (
        <Panel
          title={`Left to do (${num(r.left.length)})`}
          className="ug-left"
          actions={
            can.apply && onApply ? (
              <Button size="sm" variant="primary" icon="play" onClick={onApply}>
                Apply…
              </Button>
            ) : undefined
          }
        >
          <ul className="st-plainlist st-stack">
            {(["apply", "security_baseline", "person", "other"] as const).flatMap((w) => by[w]).map((t, i) => (
              <TodoRow key={`${t.by}:${i}`} t={t} />
            ))}
          </ul>
          {!can.apply && <p className="t-caption t-muted">Nothing here is work drift upgrade --apply does: each is for a person, with the command to run.</p>}
        </Panel>
      ) : (
        <EmptyState icon="ok" title="Nothing to do">
          This Drift reads the files an older one wrote as they are; drift upgrade exits 0.
        </EmptyState>
      )}
      {r.failed && (
        <p className="ck-note" role="alert">
          <Icon name="attention" size={14} />
          <span>A write failed: {r.failed}. Nothing after it was written.</span>
        </p>
      )}
      <Panel title="Files Drift wrote" className="ug-files">
        <table className="pr-table">
          <caption className="dui-sr">Files Drift wrote</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">As this Drift reads it</th>
            </tr>
          </thead>
          <tbody>
            {r.files.map((f) => (
              <tr key={f.path} data-path={f.path} className={f.present ? undefined : "is-absent"}>
                <th scope="row" className="dui-mono">
                  {f.path}
                </th>
                <td>
                  <div>{fileLine(f)}</div>
                  {f.notes.map((n) => (
                    <div key={n} className="t-caption t-secondary">
                      {n}
                    </div>
                  ))}
                  {f.present && (
                    <details className="ug-records">
                      <summary className="t-caption t-muted">What it records</summary>
                      <p className="t-caption t-secondary">{f.records}</p>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title={`Accepted conventions (${num(r.conventions.length)}), read with this Drift`} className="ug-conventions">
        {changed.length ? (
          <ul className="st-plainlist st-stack">
            {changed.map((c) => (
              <li key={c.id} data-id={c.id} className="t-body-sm">
                <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", c.id)} title="Open in Conventions">
                  {c.id}
                </button>{" "}
                {c.summary}
                <div className="t-caption t-secondary">
                  {c.classes.map(classText).join("; ")} · when accepted: {acceptedText(c)} · now: {nowText(c)}
                  {c.reading_only > 0 && ` · ${c.reading_only} new only because the reading changed`}
                  {c.changed_code > 0 && ` · ${c.changed_code} in code that changed`}
                  {c.cannot_tell > 0 && ` · ${c.cannot_tell} new violation(s) Drift cannot tell about`}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-muted t-body-sm">None reads differently now.</p>
        )}
        {unchanged.length > 0 && (
          <details className="st-raw ug-unchanged">
            <summary>{num(unchanged.length)} unchanged</summary>
            <ul className="st-plainlist t-caption">
              {unchanged.map((c) => (
                <li key={c.id}>
                  <span className="dui-mono">{c.id}</span> {c.summary} · now: {nowText(c)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
      <Panel title="New violations, by what made them" className="ug-violations">
        <ViolationList title="Only because this Drift reads the code differently (drift upgrade --apply baselines them)" rows={v.reading_only} cls="reading" />
        <ViolationList title="In code that changed since the convention was baselined (drift check reports them)" rows={v.changed_code} cls="changed" />
        <ViolationList title="Drift cannot tell which (for a person)" rows={v.cannot_tell} cls="cannot" />
      </Panel>
      <Panel title="Security baseline" className="ug-security">
        {r.security.present ? (
          <ul className="st-plainlist t-body-sm">
            <li>
              .drift/security.lock: {r.security.stamped ? `stamped inventory ${r.security.inventory ?? "?"}` : `no inventory stamp (read as inventory ${r.security.inventory ?? 1})`}; this Drift: inventory {r.security.this_inventory}
            </li>
            <li>
              {num(r.security.new_in_drift_total)} finding(s) of kinds or detectors newer than the baseline
              {Object.keys(r.security.new_in_drift).length > 0 && ` (${Object.entries(r.security.new_in_drift).map(([k, n]) => `${k}: ${n}`).join(", ")})`}; they fail nothing until it records them
            </li>
            <li>{num(r.security.failing_not_in_baseline)} finding(s) not in it, of kinds it knows, fail drift check (a change&apos;s, or this Drift reading an old kind in more places)</li>
          </ul>
        ) : (
          <p className="t-muted t-body-sm">No .drift/security.lock: there is no baseline to read against this Drift.</p>
        )}
      </Panel>
      <Panel title="Agent integrations" className="ug-integrations">
        {r.integrations.length ? (
          <ul className="st-plainlist st-stack t-body-sm">
            {r.integrations.map((x) => (
              <li key={x.path} data-path={x.path}>
                <span className="dui-mono">{x.path}</span> <Badge tone={x.state === "current" ? "success" : x.state === "older" ? "info" : "warning"}>{x.state}</Badge> <span className="t-secondary">{x.note}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-muted t-body-sm">No agent instructions or Claude Code settings Drift wrote were found.</p>
        )}
      </Panel>
    </>
  );
}

function TodoRow({ t }: { t: UpgradeTodo }) {
  const who = whoOf(t);
  return (
    <li className="ug-todo" data-by={t.by}>
      <div className="st-row st-wrap ug-todo__head">
        <Badge tone={who === "person" ? "warning" : who === "other" ? "neutral" : "info"} icon>
          {WHO_TEXT[who]}
        </Badge>
        <span className="t-body-sm">{t.what}</span>
      </div>
      <code className="st-cmd ug-cmd">{t.command}</code>
    </li>
  );
}

function ViolationList({ title, rows, cls }: { title: string; rows: UpgradeViolation[]; cls: string }) {
  return (
    <div className={`ug-vlist ug-vlist--${cls}`}>
      <div className="dui-overline">
        {title}: {num(rows.length)}
      </div>
      {rows.length > 0 && (
        <ul className="st-plainlist t-caption">
          {rows.map((x) => (
            <li key={`${x.id} ${x.member}`}>
              <span className="dui-mono">
                {x.id} {x.member}:{x.line}
              </span>
              {x.base && <span className="t-secondary"> · compared with {x.base}</span>}
              {x.why && <span className="t-secondary"> · {x.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What `--apply` did, as Drift reported it: what it wrote, a failed write, or a refusal. */
function Applied({ out }: { out: UpgradeOutcome }) {
  if (isUpgradeRefusal(out))
    return (
      <Panel title="drift upgrade --apply refused" className="ug-applied">
        <p className="ck-note" role="alert">
          <Icon name="blocked" size={14} />
          <span>Nothing was changed: {[...out.newer, ...out.unreadable].join("; ")}</span>
        </p>
      </Panel>
    );
  return (
    <Panel title="What drift upgrade --apply did" className="ug-applied">
      {out.done.length ? (
        <ul className="st-plainlist t-body-sm">
          {out.done.map((d) => (
            <li key={d}>
              <Icon name="ok" size={13} /> {d}
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-muted t-body-sm">Nothing needed writing.</p>
      )}
      {out.failed && (
        <p className="ck-note" role="alert">
          <Icon name="attention" size={14} />
          <span>A write failed: {out.failed}. Nothing after it was written.</span>
        </p>
      )}
    </Panel>
  );
}

function ApplyDialog({ r, onApply, onClose }: { r: UpgradeReport; onApply(securityBaseline: boolean): Promise<void>; onClose(): void }) {
  const can = canApply(r);
  const [security, setSecurity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = applyWork(r, security);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(security);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      size="md"
      title="Apply the upgrade"
      description="drift upgrade --apply does only what changes no decision a person made. It never accepts, rejects, promotes or demotes a convention, never changes a mode and never deletes a line."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || work.length === 0} loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      <div className="st-stack ug-dialog">
        <div className="dui-overline">What it does, as drift upgrade listed it</div>
        {work.length ? (
          <ul className="st-plainlist t-body-sm ug-work">
            {work.map((t, i) => (
              <li key={i}>{t.what}</li>
            ))}
          </ul>
        ) : (
          <p className="t-muted t-body-sm">Nothing without --security-baseline: tick it below to do that part.</p>
        )}
        {can.securityBaseline && (
          <Checkbox
            checked={security}
            onCheckedChange={setSecurity}
            label="Also write .drift/security.lock again (--security-baseline)"
            hint="Adds only the findings that are new in this Drift and stamps this Drift's inventory; every finding it held is kept, and the kinds that fail stay as they are."
          />
        )}
        <p className="t-caption t-muted">What is left for a person stays listed; the Studio does not do it.</p>
        <code className="st-cmd">{applyCommand(security)}</code>
        {error && (
          <p className="ck-note" role="alert">
            <Icon name="attention" size={14} />
            <span>drift upgrade --apply failed: {error}</span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
