// `drift security --diff-base <ref> --json`: what a change introduces since its merge base with the ref, against the
// merge base's own inventory, in the command's five sections. Facts for a pull request to review: the command exits
// 0 whatever it lists, so nothing here fails.
import type { ReactNode } from "react";
import { Badge, EmptyState, ErrorState, Icon, Panel, Tag } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useSecurityDiff } from "@/entities/drift";
import { NOT_COVERED, addedHas, diffCounts, exposureText, guardText, isUnguarded, placeOf, sinkLabel } from "@/entities/security";
import type { EntryRef, EntryRow, SecurityDiff } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { type CodeTarget, useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";

export function SecurityChanges({ base, scopeBar }: { base: string; scopeBar: ReactNode }) {
  const { repo } = useRepo();
  const q = useSecurityDiff(repo, base);
  if (q.isLoading) return <Loading label={`Running drift security --diff-base ${base}`} />;
  if (q.error)
    return (
      <div className="st-page sc">
        {scopeBar}
        <ErrorState title={`drift security --diff-base ${base} failed`} error={q.error} onRetry={() => void q.refetch()}>
          The base must be a git ref in this repository, with full history (a shallow clone has no merge base).
        </ErrorState>
      </div>
    );
  if (!q.data) return null;
  return <Changes d={q.data.data} scopeBar={scopeBar} />;
}

/** `METHOD /route` or the symbol, as Drift names an entry point. */
const what = (e: Pick<EntryRef, "method" | "route" | "symbol">) => `${e.method ? `${e.method} ` : ""}${e.route ?? e.symbol}`;
const guardsText = (e: Pick<EntryRef, "guards" | "opens" | "opaque" | "local" | "basis">) => `${guardText(e)}${e.opens?.length ? `; open: ${e.opens.join(", ")}` : ""}`;

export function Changes({ d, scopeBar }: { d: SecurityDiff; scopeBar: ReactNode }) {
  const openCode = useOpenCode();
  const c = diffCounts(d);
  const open = (t: CodeTarget) => () => openCode(t);
  return (
    <div className="st-page sc sc-changes">
      <header className="sc-head">
        <div className="sc-verdict">
          <div className="dui-overline">drift security --diff-base · facts for review; never fails</div>
          <div className="sc-verdict__line">
            <span className="sc-verdict__num">{num(c.total)}</span>
            <span className="sc-verdict__text">{c.total === 1 ? "fact" : "facts"} this change introduces</span>
          </div>
          <p className="ck-diff t-body-sm">
            <Icon name="info" size={13} />
            <span>
              Changes since <span className="dui-mono">{d.diff.base}</span> (merge base <span className="dui-mono">{d.diff.merge_base.slice(0, 7)}</span>): {num(d.diff.files)} {d.diff.files === 1 ? "file" : "files"} added or changed, compared with the merge base's own inventory, so what was already there is not listed.
            </span>
          </p>
          <p className="t-secondary">
            Facts for review, not violations: <span className="dui-mono">drift security --diff-base</span> exits 0 whatever it lists, so nothing here fails a check, a pull request or an agent.
          </p>
        </div>
        {scopeBar}
      </header>

      {c.total === 0 && (
        <EmptyState icon="ok" title={`This change introduces none of the ${d.added_without_guard ? "six" : "five"}`}>
          No entry point lacking a guard its siblings share, no entry point where Drift found no guard reaching a risky operation, no new risky operation, no new client leak, {d.added_without_guard ? "nothing made internet-facing, and no new request entry point where Drift found no guard." : "and nothing made internet-facing."}
          {c.guardUnknown > 0 && ` ${num(c.guardUnknown)} new ${c.guardUnknown === 1 ? "entry point whose guard is" : "entry points whose guard is"} unknown ${c.guardUnknown === 1 ? "is" : "are"} listed below: unknown, not a finding.`}
        </EmptyState>
      )}

      <Section id="sc-new-gaps" title="New guard gaps" count={c.guardGaps} hint="Entry points in the change lacking a guard most of their siblings have; they did not lack it at the merge base.">
        {d.guard_gaps.map((g) => (
          <li key={`${g.guard}|${g.entry.path}#${g.entry.symbol}`}>
            <button type="button" className="st-pathlink" onClick={open({ path: g.entry.path, line: g.entry.line, context: { title: `lacks ${g.guard}`, detail: `${g.with_guard} of ${g.members} ${g.kind} entry points in ${placeOf(g.package, g.dir)} have it`, tone: "warning" } })}>
              <span className="dui-mono t-truncate">
                {g.entry.path}:{g.entry.line}
              </span>
              <span className="dui-mono">{what(g.entry)}</span>
              <span className="t-muted t-caption">{guardsText(g.entry)}</span>
            </button>
            <div className="t-body-sm sc-change__why">
              <span className="dui-mono">{g.guard}</span> is on {num(g.with_guard)} of {num(g.members)} {g.kind} entry points in {placeOf(g.package, g.dir)}. To copy:{" "}
              <button type="button" className="st-link dui-mono" onClick={open({ path: g.example.path, line: g.example.line, context: { title: `has ${g.guard}` } })}>
                {g.example.path}:{g.example.line} {g.example.symbol}
              </button>
              {g.convention && (
                <>
                  {" · "}
                  <button type="button" className="st-link" onClick={() => navigate("conventions", g.convention!.id)}>
                    {g.convention.status === "accepted" ? `accepted convention ${g.convention.id} (${g.convention.mode === "block" ? "blocks" : "advises"})` : `proposed as ${g.convention.id}`}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </Section>

      <Section id="sc-new-reaching" title="Entry points where Drift found no guard, reaching a risky operation" count={c.unguardedReaching} hint="Entry points in the change where Drift found no guard in what it read, that reach a risky operation; not so at the merge base. Each says how much it saw and did not read.">
        {d.unguarded_reaching.map((e) => (
          <li key={`${e.path}#${e.symbol}:${e.line}`}>
            <button type="button" className="st-pathlink" onClick={open({ path: e.path, line: e.line, context: { title: `${e.kind} ${what(e)}`, detail: `${guardText(e)}; reaches ${e.reaches.map((r) => sinkLabel(r.kind)).join(", ")}`, tone: "danger" } })}>
              <span className="dui-mono t-truncate">
                {e.path}:{e.line}
              </span>
              <span className="dui-mono">{what(e)}</span>
              <Tag tone="info">{e.kind}</Tag>
            </button>
            <div className="t-body-sm sc-change__why st-row st-wrap">
              {e.reaches.map((r) => (
                <Badge key={r.kind} tone="danger" variant="outline">
                  {sinkLabel(r.kind)}
                </Badge>
              ))}
              <span className="t-muted">{exposureOf(e)}</span>
            </div>
          </li>
        ))}
      </Section>

      <Section id="sc-new-sinks" title="Risky operations added" count={c.sinks} hint="Risky operations in changed files that were not at the merge base (detected syntactically).">
        {d.sinks.map((s) => (
          <li key={`${s.kind}|${s.path}#${s.symbol}:${s.line}`}>
            <button type="button" className="st-pathlink" onClick={open({ path: s.path, line: s.line, context: { title: sinkLabel(s.kind), detail: `${s.symbol} at line ${s.line}`, tone: "danger" } })}>
              <span className="dui-mono t-truncate">
                {s.path}:{s.line}
              </span>
              <span className="dui-mono">{s.symbol}</span>
              <Badge tone="danger" variant="outline">
                {sinkLabel(s.kind)}
              </Badge>
            </button>
          </li>
        ))}
      </Section>

      <Section id="sc-new-leaks" title="Client leaks added" count={c.leaks} hint={`"use client" files in the change newly reaching server-only code or secrets; only the new clients are listed.`}>
        {d.leaks.map((g) => (
          <li key={g.reaches}>
            <div className="t-body-sm">
              <span className="dui-mono t-warning">{g.reaches}</span> reached from {num(g.clients.length)} new client {g.clients.length === 1 ? "file" : "files"}:
            </div>
            <ul className="st-plainlist">
              {g.clients.map((f) => (
                <li key={f}>
                  <button type="button" className="st-link dui-mono" onClick={open({ path: f, context: { title: `reaches ${g.reaches}`, detail: g.example.join(" → "), tone: "warning" } })}>
                    {f}
                  </button>
                </li>
              ))}
            </ul>
            {g.example.length > 1 && <div className="t-muted t-caption dui-mono">import chain: {g.example.join(" → ")}</div>}
          </li>
        ))}
      </Section>

      <Section id="sc-now-public" title="Entry points made internet-facing" count={c.nowPublic} hint="Entry points that were not internet-facing at the merge base and are now (the deployment boundary moved, anywhere in the repository).">
        {d.now_public.map((e) => (
          <li key={`${e.path}#${e.symbol}:${e.line}`}>
            <button type="button" className="st-pathlink" onClick={open({ path: e.path, line: e.line, context: { title: `now internet-facing: ${e.kind} ${what(e)}`, detail: guardsText(e), tone: isUnguarded(e) ? "warning" : "info" } })}>
              <span className="dui-mono t-truncate">
                {e.path}:{e.line}
              </span>
              <span className="dui-mono">{what(e)}</span>
              <span className="t-muted t-caption">{guardsText(e)}</span>
            </button>
          </li>
        ))}
      </Section>

      {d.added_without_guard && <AddedEntries d={d} open={open} />}

      <p className="t-muted t-caption">{NOT_COVERED}</p>
    </div>
  );
}

/**
 * The entry points the change adds where Drift found no guard (newer drift), and apart from them those whose guard it
 * could not read: unknown, said as unknown with what it could not read, never as "no guard" and never counted as a fact
 * the change introduces.
 */
function AddedEntries({ d, open }: { d: SecurityDiff; open: (t: CodeTarget) => () => void }) {
  const added = d.added_without_guard ?? [];
  const unknown = d.guard_unknown ?? [];
  const row = (e: EntryRow, tone: "warning" | "info") => (
    <li key={`${e.path}#${e.symbol}:${e.line}`}>
      <button type="button" className="st-pathlink" onClick={open({ path: e.path, line: e.line, context: { title: `${e.kind} ${what(e)}`, detail: addedHas(e), tone } })}>
        <span className="dui-mono t-truncate">
          {e.path}:{e.line}
        </span>
        <span className="dui-mono">{what(e)}</span>
        <Tag tone="info">{e.kind}</Tag>
      </button>
      <div className="t-body-sm sc-change__why st-row st-wrap">
        {tone === "info" && (
          <Badge tone="info" variant="outline">
            guard unknown
          </Badge>
        )}
        <span className={tone === "info" ? undefined : "t-muted"}>{addedHas(e)}</span>
        {tone === "warning" && <span className="t-muted">{exposureOf(e)}</span>}
      </div>
    </li>
  );
  return (
    <>
      <Section id="sc-new-unguarded" title="New entry points where Drift found no guard" count={added.length} hint="Request entry points (http, server actions, GraphQL, RPC) the change adds where Drift found no guard in what it read, whatever their siblings do. Those listed above are not repeated, and one open on purpose (a probe, AllowAny, a checked webhook signature) is not listed.">
        {added.map((e) => row(e, "warning"))}
      </Section>
      <Section id="sc-guard-unknown" title="New entry points whose guard is unknown" count={unknown.length} hint="Drift could not read what may be their guard (a wrapper or a call it does not hold the code of), so it cannot tell whether they require sign-in. Not findings, and not counted above: read the code, or add what Drift could not read.">
        {unknown.map((e) => row(e, "info"))}
      </Section>
    </>
  );
}

function exposureOf(e: EntryRow) {
  return exposureText(e) ?? "exposure unknown";
}

function Section({ id, title, count, hint, children }: { id: string; title: string; count: number; hint: string; children: ReactNode }) {
  return (
    <Panel id={id} title={`${title} (${num(count)})`} subtitle={hint} padded={false}>
      {count ? <ul className="st-outliers sc-changes__list">{children}</ul> : <p className="st-pad t-muted t-body-sm">None.</p>}
    </Panel>
  );
}
