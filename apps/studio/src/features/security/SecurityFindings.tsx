// The Security view's "Look at these first" (`drift security --top N --json`), "Nothing reaches" (the inventory's
// `unreached`) and the security baseline (`drift security --write-baseline`). Each says what Drift read in its own
// words (entities/security findings.ts); none of it fails a check, except what a baseline a person writes then holds
// a change to, which is why writing one is confirmed and recorded.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, StateLabel, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { baselineKeys, usePolicyFiles, useSecurityTop } from "@/entities/drift";
import { useHistory } from "@/entities/history";
import { TOP_HEADING, UNREACHED_NOT_COUNTED, UNREACHED_WHY, moreRankedText, notRankedParts, rankedLines, sinkAt, sinkLabel, splitNode } from "@/entities/security";
import type { Inventory, SecurityRanked, SecurityTop } from "@/shared/contract/drift";
import { useApi } from "@/shared/api";
import { SECURITY_LOCK, baselineCommand, readSecurityLock } from "@/shared/lib/baseline";
import { num, relTime } from "@/shared/lib/format";
import { log } from "@/shared/lib/log";
import { type CodeTarget, useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";

/** How many findings the tab asks for first; "Show all" asks for every one (`--top 0`). */
export const FIRST_N = 10;

const CALLER_TONE: Record<SecurityRanked["caller"], "danger" | "warning" | "info"> = { anyone: "danger", unread: "warning", hook_not_read: "warning", passes_guard: "info", service: "info" };
const CALLER_LABEL: Record<SecurityRanked["caller"], string> = { anyone: "no guard found", unread: "guard not read", hook_not_read: "app hook not read", passes_guard: "behind a guard", service: "signature checked" };

/** "Look at these first": runs `drift security --top` when the tab opens, the first ten, then every one on request. */
export function FirstTab() {
  const { repo } = useRepo();
  const [all, setAll] = useState(false);
  const q = useSecurityTop(repo, all ? 0 : FIRST_N);
  const openCode = useOpenCode();
  if (q.isLoading) return <Loading label={`Running drift security --top ${all ? 0 : FIRST_N}`} />;
  if (q.error) return <ErrorState title="drift security --top failed" error={q.error} onRetry={() => void q.refetch()} />;
  const top = q.data?.data.top;
  if (!top) return <ErrorState title="drift security --top printed no ranking" error={new Error("its JSON has no `top`: this drift binary may be older than the Studio")} />;
  return <TopList top={top} onOpen={openCode} onAll={all ? undefined : () => setAll(true)} />;
}

/** The ranked findings, as `drift security --top` prints them: rank, what a caller can do and where, what was read and not. */
export function TopList({ top, onOpen, onAll }: { top: SecurityTop; onOpen(t: CodeTarget): void; onAll?: () => void }) {
  const parts = notRankedParts(top.not_ranked);
  const total = top.shown.length + top.more;
  if (!top.shown.length)
    return (
      <div className="st-pad st-stack">
        <EmptyState icon="ok" title="Nothing ranks">
          {parts.length
            ? `No entry point reaches a risky operation in a way Drift can rank. It could not rank ${parts.join(", ")}: those are not findings either way.`
            : "No entry point reaches a risky operation in what Drift read."}
        </EmptyState>
      </div>
    );
  return (
    <div className="st-pad st-stack sc-first">
      <p className="t-secondary t-body-sm">{TOP_HEADING}.</p>
      <ol className="sc-first__list">
        {top.shown.map((r, i) => {
          const l = rankedLines(r);
          if (!l) return null;
          const [sinkPath] = splitNode(r.sink);
          return (
            <li key={`${r.kind}|${r.sink}|${r.caller}|${r.validation}`} className="sc-first__item">
              <span className="sc-first__rank dui-mono" aria-hidden="true">
                {i + 1}
              </span>
              <div className="st-stack sc-first__body">
                <div className="st-row st-wrap">
                  <StateLabel tone={CALLER_TONE[r.caller]} icon={r.caller === "anyone" ? "blocked" : "info"}>
                    {CALLER_LABEL[r.caller]}
                  </StateLabel>
                  <Badge tone="danger" variant="outline">
                    {sinkLabel(r.kind)}
                  </Badge>
                  <button type="button" className="st-link dui-mono t-caption" onClick={() => onOpen({ path: sinkPath, line: r.sink_line, context: { title: sinkLabel(r.kind), detail: `the operation ${r.places.length === 1 ? "this entry point reaches" : `${r.places.length} entry points reach`}`, tone: "danger" } })}>
                    {sinkAt(r)}
                  </button>
                </div>
                <p className="t-body-sm">{l.head}</p>
                <p className="t-caption t-secondary">{l.read}</p>
                <p className="t-caption t-muted">{l.notRead}</p>
                <details className="st-raw">
                  <summary>
                    {num(r.places.length)} {r.places.length === 1 ? "entry point" : "entry points"}
                  </summary>
                  <ul className="st-plainlist">
                    {r.places.map((p) => (
                      <li key={`${p.path}#${p.symbol}:${p.line}`}>
                        <button type="button" className="st-pathlink" onClick={() => onOpen({ path: p.path, line: p.line, context: { title: `${p.method ? `${p.method} ` : ""}${p.route ?? p.symbol}`, detail: `${p.guard}; reaches ${sinkLabel(r.kind)}`, tone: CALLER_TONE[r.caller] === "info" ? "info" : "warning" } })}>
                          <span className="dui-mono t-truncate">
                            {p.path}:{p.line}
                          </span>
                          <span className="dui-mono">{p.method && p.route ? `${p.method} ${p.route}` : (p.route ?? p.symbol)}</span>
                          <span className="t-muted t-caption">{p.guard}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
      {top.more > 0 && (
        <p className="t-body-sm st-row st-wrap">
          <span>{moreRankedText(top.more, total)}</span>
          {onAll && (
            <Button size="sm" variant="secondary" onClick={onAll}>
              Show all {num(total)}
            </Button>
          )}
        </p>
      )}
      {parts.length > 0 && (
        <p className="t-caption t-muted" role="note">
          Not ranked: {parts.join(", ")}. A finding whose guard Drift could not read is not ranked as unguarded: its guard is unknown.
        </p>
      )}
    </div>
  );
}

/** Files nothing Drift read reaches, with what they hold: listed apart, not counted as production code. */
export function Unreached({ inv, onOpen }: { inv: Pick<Inventory, "unreached">; onOpen(t: CodeTarget): void }) {
  const rows = inv.unreached ?? [];
  if (!rows.length)
    return (
      <div className="st-pad">
        <EmptyState icon="ok" title="Every production file is reached">
          Drift found no production file that nothing imports, registers or names. A file like that would be listed here with what it holds, and left out of the entry points and risky operations above.
        </EmptyState>
      </div>
    );
  return (
    <div className="st-pad st-stack">
      <p className="t-secondary t-body-sm">
        {num(rows.length)} production {rows.length === 1 ? "file" : "files"} not reached by anything Drift read: {UNREACHED_WHY}. {UNREACHED_NOT_COUNTED[0].toUpperCase() + UNREACHED_NOT_COUNTED.slice(1)}. Code nothing names cannot run unless something Drift did not read names it (a script run by hand, a loader configured elsewhere): delete it, or check what starts it.
      </p>
      <ul className="st-outliers" aria-label="Files nothing reaches">
        {rows.map((u) => (
          <li key={u.path}>
            <button type="button" className="st-pathlink" onClick={() => onOpen({ path: u.path, context: { title: "nothing Drift read reaches this file", detail: holds(u), tone: u.sinks?.length ? "warning" : "info" } })}>
              <span className="dui-mono t-truncate">{u.path}</span>
              {!u.parsed && <Badge tone="warning">did not parse</Badge>}
              {(u.sinks ?? []).map((k) => (
                <Badge key={k} tone="danger" variant="outline">
                  {sinkLabel(k)}
                </Badge>
              ))}
              <span className="t-muted t-caption">{holds(u)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function holds(u: NonNullable<Inventory["unreached"]>[number]): string {
  const said: string[] = [];
  if (u.sinks?.length) said.push(`${u.sinks.length} kind(s) of risky operation`);
  if (u.unlisted?.length) said.push(`${u.unlisted.length} route-like registration(s), line ${u.unlisted.join(", ")}`);
  if (!u.parsed) said.push("the parser reported errors, so what it holds may be more");
  return said.length ? said.join("; ") : "no risky operation and no route-like registration";
}

/**
 * Whether the repository has a security baseline, and the one write that makes one: `drift security --write-baseline`,
 * confirmed (it decides what `drift check` fails on from then on) and recorded in the audit trail as a review is.
 */
export function BaselineBar() {
  const { repo } = useRepo();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const files = usePolicyFiles(repo);
  const history = useHistory(repo);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!repo) return null;
  const lock = readSecurityLock(files.data?.securityLock);
  const writes = (history.data?.audit ?? []).filter((a) => a.decision === "security-baseline");
  const last = writes[writes.length - 1];
  const write = async () => {
    setBusy(true);
    log("info", "security baseline: write", { repo: repo.path });
    try {
      const entry = await api.securityBaseline(repo);
      await Promise.all(baselineKeys(repo).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (entry.ok) toast.show({ title: "Security baseline written", body: entry.output.split("\n")[0], tone: "success", duration: 6000 });
      else toast.show({ title: "drift security --write-baseline failed", body: entry.output, tone: "danger", duration: 0 });
      log(entry.ok ? "info" : "error", "security baseline: done", { ok: entry.ok });
    } catch (e) {
      toast.show({ title: "drift security --write-baseline failed", body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
      log("error", "security baseline: failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sc-baseline" aria-label="Security baseline">
      <StateLabel tone={lock ? "success" : "neutral"} icon={lock ? "shield" : "dot"}>
        {lock ? "Security baseline" : "No security baseline"}
      </StateLabel>
      <span className="t-body-sm t-secondary sc-baseline__text">
        {lock ? (
          <>
            <span className="dui-mono">{SECURITY_LOCK}</span> holds {num(lock.findings)} {lock.findings === 1 ? "finding" : "findings"}
            {lock.inventory !== null ? ` (inventory version ${lock.inventory})` : ""}. <span className="dui-mono">drift check</span> fails on a finding that is not in it{lock.fail ? ` (of ${lock.fail.join(", ")})` : ""}.
          </>
        ) : (
          <>
            <span className="dui-mono">drift check --diff-base</span> advises on what a change adds and fails on nothing. A baseline accepts today's findings and makes <span className="dui-mono">drift check</span> fail on new ones.
          </>
        )}
        {last && ` Last written from the Studio ${relTime(last.at)} by ${last.user}${last.ok ? "" : " (it failed)"}.`}
      </span>
      <Button size="sm" variant="secondary" icon="shield" disabled={busy || files.isLoading} onClick={() => setConfirm(true)}>
        {lock ? "Write it again…" : "Write the baseline…"}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={lock ? "Write the security baseline again?" : "Write a security baseline?"}
        description={`Drift writes ${SECURITY_LOCK} in this repository with every finding it reads today, accepted as they are. While the file exists, drift check exits 1 when a finding that is not in it appears (an entry point that takes a tenant or owner key nothing checks only advises). Commit the file for it to hold in CI. The write is recorded in the Studio's audit trail.`}
        confirmLabel={lock ? "Write it again" : "Write the baseline"}
        tone="danger"
        onConfirm={() => void write()}
      >
        <code className="st-cmd">{baselineCommand(repo.path)}</code>
        {lock && <p className="t-body-sm">Writing it again keeps the kinds that fail and accepts every finding there is now, including any a change added since.</p>}
      </ConfirmDialog>
    </section>
  );
}
