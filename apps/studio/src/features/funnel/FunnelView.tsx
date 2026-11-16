// What mining dropped (`drift census --why --json`, crates/drift-mine/src/funnel.rs): how many candidates reached each
// stage, how many each gate dropped and where its threshold comes from, and the candidates the selected gate dropped.
// Read-only and observation only: nothing listed here is proposed, checked or shown to agents, and the proposals are
// exactly those of `drift census`. Every count and order is Drift's.
import { Badge, EmptyState, ErrorState, Panel } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useFunnel } from "@/entities/drift";
import type { CensusWhy, FunnelGate } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { Loading } from "@/shared/ui/QueryState";
import { droppedAt, droppedFacts, fromStudy, originText, selectedGate, splitGates, stageRows } from "./model/funnel";

export function FunnelView({ gate }: { gate: string | null }) {
  const { repo } = useRepo();
  const q = useFunnel(repo);
  if (q.isLoading) return <Loading label={t("funnel.loading")} />;
  if (q.error) return <ErrorState title={t("funnel.failed")} error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <Funnel doc={q.data.data} gate={gate} onSelect={(name) => navigate("funnel", name)} />;
}

/** The page, from props only. */
export function Funnel({ doc, gate, onSelect }: { doc: CensusWhy; gate: string | null; onSelect?(name: string): void }) {
  const stages = stageRows(doc);
  const { dropping, quiet } = splitGates(doc.gates);
  const selected = selectedGate(doc, gate);
  return (
    <div className="st-page fn">
      <header className="fn-head st-pad st-stack">
        <div className="dui-overline">{t("funnel.overline")}</div>
        <h2 className="t-h1">{t("funnel.title")}</h2>
        <p className="t-secondary t-body-sm">{t("funnel.intro")}</p>
        <code className="st-cmd" title={t("funnel.command")}>
          drift census --why --json
        </code>
      </header>
      <div className="st-pad st-stack st-scroll">
        <Panel title={t("funnel.stages")} className="fn-stages">
          {stages.length ? (
            <ol className="st-plainlist fn-stages__list">
              {stages.map((s) => (
                <li key={s.stage} data-stage={s.stage}>
                  <span className="fn-stages__num">{num(s.n)}</span> <span className="t-secondary">{s.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="t-muted t-body-sm">{t("funnel.noStages")}</p>
          )}
          {doc.cap_note && (
            <p className="t-caption t-secondary fn-capnote" role="note">
              {doc.cap_note}
            </p>
          )}
        </Panel>
        {dropping.length === 0 ? (
          <EmptyState icon="ok" title={t("funnel.empty")}>
            {t("funnel.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <Panel title={t("funnel.gates")} className="fn-gates">
              <GateTable gates={dropping} selected={selected?.name ?? null} onSelect={onSelect} />
            </Panel>
            {selected ? <GateDetail doc={doc} gate={selected} /> : <p className="t-muted t-body-sm">{t("funnel.choose")}</p>}
          </>
        )}
        {quiet.length > 0 && (
          <details className="st-raw fn-quiet">
            <summary>{t("funnel.quiet", { n: quiet.length })}</summary>
            <GateTable gates={quiet} selected={selected?.name ?? null} onSelect={onSelect} />
          </details>
        )}
      </div>
    </div>
  );
}

function GateTable({ gates, selected, onSelect }: { gates: FunnelGate[]; selected: string | null; onSelect?(name: string): void }) {
  return (
    <table className="pr-table fn-table">
      <caption className="dui-sr">{t("funnel.gates")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("funnel.gate")}</th>
          <th scope="col" className="is-num">
            {t("funnel.dropped")}
          </th>
          <th scope="col">{t("funnel.origin")}</th>
        </tr>
      </thead>
      <tbody>
        {gates.map((g) => (
          <tr key={g.name} className={g.name === selected ? "is-selected" : undefined} data-gate={g.name}>
            <th scope="row">
              {onSelect ? (
                <button type="button" className="st-link dui-mono" aria-pressed={g.name === selected} onClick={() => onSelect(g.name)}>
                  {g.name}
                </button>
              ) : (
                <span className="dui-mono">{g.name}</span>
              )}
            </th>
            <td className="is-num">{num(g.dropped)}</td>
            <td>
              <Badge tone={fromStudy(g.origin) ? "success" : "neutral"} className="fn-origin">
                {fromStudy(g.origin) ? t("funnel.fromStudy") : t("funnel.notFromStudy")}
              </Badge>{" "}
              <span className="t-caption t-secondary">{originText(g.origin)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GateDetail({ doc, gate }: { doc: CensusWhy; gate: FunnelGate }) {
  const rows = droppedAt(doc, gate.name);
  return (
    <Panel title={<span className="dui-mono">{t("funnel.droppedAt", { gate: gate.name, n: rows.length })}</span>} className="fn-detail">
      <dl className="fn-detail__facts t-body-sm">
        <dt className="t-secondary">{t("funnel.passes")}</dt>
        <dd>{gate.passes}</dd>
        <dt className="t-secondary">{t("funnel.threshold")}</dt>
        <dd className="dui-mono">{gate.constant}</dd>
        <dt className="t-secondary">{t("funnel.origin")}</dt>
        <dd>
          {originText(gate.origin)} · {t("funnel.source")} <span className="dui-mono">{gate.source}</span>
        </dd>
      </dl>
      {rows.length === 0 ? (
        <p className="t-muted t-body-sm">{t("funnel.noneAt", { gate: gate.name })}</p>
      ) : (
        <ul className="st-plainlist st-stack fn-dropped">
          {rows.map((d, i) => (
            <li key={`${d.id}:${d.family}:${i}`} className="fn-dropped__row" data-id={d.id}>
              <div className="t-body-sm">
                <span className="fn-dropped__num">{t("funnel.holders", { holders: d.holders, members: d.members })}</span> {d.role}: {d.rule}
              </div>
              <div className="t-caption t-secondary">
                <span className="dui-mono">{d.id}</span> · <span className="dui-mono">{d.family}</span>
                {droppedFacts(d).map((f) => (
                  <span key={f}> · {f}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
