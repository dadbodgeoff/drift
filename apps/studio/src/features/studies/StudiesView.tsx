// Studies: is Drift right, and does it change what agents do? Precision by rule
// family and by repository (eval/study labels joined with census outputs), and
// the agent A/B arms side by side (eval/agent-ab).
import { useMemo, useState } from "react";
import { Badge, Button, type Column, DataTable, EmptyState, ErrorState, PairedDots, Panel, SegmentedControl, StackedBar, StateLabel, Tag } from "@drift/ui";
import { studyFinal } from "@/entities/convention";
import { type AbArm, type LabelRow, abByModel, acceptRate, agreement, firstRound, modelName, parseLabels, precision, useStudies } from "@/entities/study";
import { num, pct } from "@/shared/lib/format";
import { Loading } from "@/shared/ui/QueryState";
import { RunsSection } from "./RunsSection";

export function StudiesView() {
  const [choose, setChoose] = useState(false);
  const studies = useStudies(choose);
  const data = studies.data;
  const labels = useMemo(() => (data ? parseLabels(data.labels) : null), [data]);
  const second = useMemo(() => (data?.secondOpinion ? parseLabels(data.secondOpinion) : null), [data]);
  // The baseline is the first labelling round only; the later double-label round relabels a subset.
  const prec = useMemo(() => (data && labels ? precision(firstRound(labels.rows), data.census) : null), [data, labels]);
  const kappa = useMemo(() => (labels && second ? agreement(firstRound(labels.rows), second.rows) : null), [labels, second]);
  const ab = useMemo(() => (data ? abByModel(data.ab) : []), [data]);

  if (studies.isLoading) return <Loading label="Loading study data" />;
  if (studies.error) return <ErrorState title="Study data could not be read" error={studies.error} onRetry={() => void studies.refetch()} />;
  if (!data || !prec)
    return (
      <EmptyState icon="flask" title="No study data" action={<Button onClick={() => setChoose(true)}>Choose Drift's eval directory…</Button>}>
        The Studies view reads eval/study/labels.jsonl, census outputs and eval/agent-ab/results-*.json from a Drift checkout.
      </EmptyState>
    );

  const o = prec.overall;
  const labelled = o.n - o.unlabeled;
  const before = acceptRate(o) ?? 0;
  const beforeWrong = o.wrong / Math.max(1, labelled);
  const fin = studyFinal();
  const famRows = Object.entries(fin.families)
    .map(([family, f]) => {
      const b = prec.byFamily.find((r) => r.family === family);
      const bl = b ? b.n - b.unlabeled : 0;
      // Both n: the baseline and the final set count different proposals.
      return { label: `${family} (${bl || "–"} → ${f.n})`, a: b && bl ? (acceptRate(b) ?? null) : null, b: f.rate };
    })
    .sort((x, y) => (y.b ?? 0) - (x.b ?? 0));
  const onlyBefore = prec.byFamily.filter((r) => r.n - r.unlabeled > 0 && !(r.family in fin.families)).map((r) => r.family);
  return (
    <div className="st-page sd">
      <header className="st-pagehead">
        <div>
          <h2 className="t-h1">Is Drift right, and does it change what agents do?</h2>
          <p className="t-secondary">Blind reviewers labelled what Drift proposes on public repositories; agents ran the same tasks with and without Drift.</p>
        </div>
      </header>

      <RunsSection runs={data.runs ?? []} calibrations={data.calibrations ?? []} agreements={data.agreements ?? []} exclusions={data.exclusions ?? []} manifests={data.manifests ?? []} />

      <section className="sd-precision" aria-labelledby="sd-prec-h">
        <div className="st-row st-wrap">
          <h3 id="sd-prec-h" className="st-section-title">First study round: share of proposals a maintainer would accept (TypeScript, PR #4)</h3>
          <Badge tone="neutral" icon="info" title="Labelled before rubric v3 (D6); not comparable with v3 figures">
            rubric v1/v2
          </Badge>
          <Badge tone="warning" icon="attention">
            dev set, not held-out
          </Badge>
        </div>
        <div className="sd-ba">
          <div className="sd-ba__col">
            <div className="dui-overline">Baseline · main before PR #4 (after the study's first fixes)</div>
            <div className="sd-ba__num">{pct(before)}</div>
            <div className="sd-ba__what">accepted by a blind reviewer</div>
            <p className="t-caption t-muted">
              {pct(beforeWrong)} wrong · n={num(labelled)} labelled, one blind label per proposal (first round)
              {kappa && kappa.n > 0 ? ` (${kappa.n} relabelled: κ ${kappa.kappa?.toFixed(2) ?? "–"}, ${pct(kappa.exact)} exact)` : ""} · <span className="dui-mono">{data.source}</span>
            </p>
          </div>
          <div className="sd-ba__arrow" aria-hidden="true" />
          <div className="sd-ba__col is-after">
            <div className="dui-overline">Final · after the fixes (PR #4)</div>
            <div className="sd-ba__num">{(fin.overall.rate * 100).toFixed(1)}%</div>
            <div className="sd-ba__what">accepted · {(fin.overall.notWrong * 100).toFixed(1)}% not wrong</div>
            <p className="t-caption t-muted">n={num(fin.overall.n)} · 57 double-labelled and adjudicated (κ 0.84), 107 keep their first-round label · {fin.study}</p>
          </div>
        </div>
        <p className="st-note">{fin.provenance}</p>
        <p className="st-note">
          An earlier run, before the study's first fixes, measured 52% accepted (n=183); it cannot be reproduced, so it is not shown as data (docs/v2/STUDY-2026-11-05.md).
        </p>
      </section>

      <div className="st-grid st-grid--2">
        <Panel title="By rule family: baseline → final" subtitle="Where to look hardest: families below half are often wrong. Final families are approximate (keyword-bucketed); n is shown for both.">
          <PairedDots rows={famRows} a="Baseline (n labelled)" b="Final, PR #4 (n)" label="Accept rate by rule family, baseline and final" max={1} better="higher" format={(n) => pct(n)} />
          {onlyBefore.length > 0 && <p className="st-note">Baseline only (too few in the final set): {onlyBefore.join(", ")}.</p>}
        </Panel>
        <Panel title="Baseline by repository" subtitle="Accept, trivial and wrong per repository: first-round labels, main before PR #4">
          <ul className="sd-repos">
            {prec.byRepo.map((r) => (
              <li key={r.repo}>
                <span className="dui-mono t-truncate">{r.repo}</span>
                <StackedBar
                  label={r.repo}
                  legend={false}
                  height={10}
                  total={Math.max(1, r.n)}
                  segments={[
                    { label: "accept", value: r.accept, color: "success" },
                    { label: "trivial", value: r.trivial, color: "muted" },
                    { label: "wrong", value: r.wrong, color: "danger" },
                    { label: "unlabelled", value: r.unlabeled, color: 7 },
                  ]}
                />
                <span className="t-num t-body-sm">{r.n ? pct(acceptRate(r) ?? 0) : "–"}</span>
                <span className="t-num t-caption t-muted">n={r.n}</span>
              </li>
            ))}
          </ul>
          <div className="dui-legend">
            <span className="dui-legend__item"><span className="dui-legend__swatch" style={{ background: "var(--color-success)" }} />accept</span>
            <span className="dui-legend__item"><span className="dui-legend__swatch" style={{ background: "var(--color-text-muted)" }} />trivial</span>
            <span className="dui-legend__item"><span className="dui-legend__swatch" style={{ background: "var(--color-danger)" }} />wrong</span>
          </div>
          {prec.staleLabels > 0 && <p className="st-note">{prec.staleLabels} labels refer to proposals the current engine no longer makes.</p>}
        </Panel>
      </div>

      <h3 className="st-section-title">Agent A/B</h3>
      {ab.length === 0 ? (
        <EmptyState title="No A/B results" />
      ) : (
        ab.map((m) => <AbModelView key={m.model} m={m} />)
      )}

      <h3 className="st-section-title">Labelled proposals</h3>
      <Panel padded={false}>
        <ProposalTable rows={prec.proposals} />
      </Panel>
    </div>
  );
}

function AbModelView({ m }: { m: ReturnType<typeof abByModel>[number] }) {
  const arms = Object.keys(m.arms).sort();
  return (
    <Panel title={modelName(m.model)} subtitle={`${m.tasks.length} tasks, one run per cell`} className="sd-ab">
      <div className="sd-arms">
        {arms.map((a) => (
          <ArmCard key={a} name={a} arm={m.arms[a]} />
        ))}
      </div>
      {m.arms.control && m.arms.drift && (
        <div className="sd-pairs">
          <PairedDots
            label={`${modelName(m.model)}: violations of accepted rules per task, without and with Drift`}
            a="without Drift (control)"
            b="with Drift"
            rows={m.tasks.map((t) => ({ label: t.task, a: t.arms.control ? (t.arms.control.violations_accept ?? 0) : null, b: t.arms.drift ? (t.arms.drift.violations_accept ?? 0) : null }))}
            max={Math.max(2, ...m.tasks.flatMap((t) => [t.arms.control?.violations_accept ?? 0, t.arms.drift?.violations_accept ?? 0]))}
          />
          <PairedDots
            label={`${modelName(m.model)}: agent turns per task, without and with Drift`}
            a="without Drift"
            b="with Drift"
            rows={m.tasks.map((t) => ({ label: t.task, a: t.arms.control?.turns ?? null, b: t.arms.drift?.turns ?? null }))}
          />
        </div>
      )}
      <details className="st-raw sd-pertask">
        <summary>Per-task numbers</summary>
      <table className="sd-table">
        <thead>
          <tr>
            <th>Task</th>
            {arms.map((a) => (
              <th key={a} colSpan={3}>
                {a}
              </th>
            ))}
          </tr>
          <tr className="sd-table__sub">
            <th />
            {arms.flatMap((a) => [
              <th key={`${a}v`}>violations</th>,
              <th key={`${a}t`}>turns</th>,
              <th key={`${a}c`}>cost</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {m.tasks.map((t) => (
            <tr key={t.task}>
              <td className="dui-mono">{t.task}</td>
              {arms.flatMap((a) => {
                const r = t.arms[a];
                const v = (r?.violations_accept ?? 0) + (r?.violations_trivial ?? 0) + (r?.violations_wrong ?? 0);
                return [
                  <td key={`${a}v`} className="t-num">
                    {r ? (v ? <StateLabel tone="warning" icon="attention">{v}</StateLabel> : <span className="t-muted">0</span>) : "–"}
                  </td>,
                  <td key={`${a}t`} className="t-num">
                    {r?.turns ?? "–"}
                  </td>,
                  <td key={`${a}c`} className="t-num">
                    {r?.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "–"}
                  </td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </details>
    </Panel>
  );
}

function ArmCard({ name, arm }: { name: string; arm: AbArm }) {
  return (
    <div className={`sd-arm is-${name}`}>
      <div className="st-row">
        <Badge tone={name === "drift" ? "accent" : "neutral"}>{name}</Badge>
        <span className="t-caption t-muted">{arm.runs} runs</span>
      </div>
      <dl className="sd-arm__kv">
        <div>
          <dt>Violations of accepted rules</dt>
          <dd className={arm.accept ? "t-danger" : ""}>{arm.accept}</dd>
        </div>
        <div>
          <dt>Trivial / wrong-rule violations</dt>
          <dd>
            {arm.trivial} / {arm.wrong}
          </dd>
        </div>
        <div>
          <dt>Suppressions added</dt>
          <dd>{arm.suppressions}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{arm.turns}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>${arm.cost.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{arm.seconds} s</dd>
        </div>
      </dl>
    </div>
  );
}

type P = ReturnType<typeof precision>["proposals"][number];

function ProposalTable({ rows }: { rows: P[] }) {
  const [label, setLabel] = useState<"all" | LabelRow["label"] | "none">("all");
  const shown = rows.filter((r) => label === "all" || (label === "none" ? !r.label : r.label === label));
  const tone = (l: string | null) => (l === "ACCEPT" ? "success" : l === "WRONG" ? "danger" : "neutral");
  const columns: Column<P>[] = [
    { id: "repo", header: "Repo", width: 120, mono: true, sortValue: (r) => r.repo, render: (r) => r.repo },
    { id: "id", header: "Id", width: 96, mono: true, render: (r) => r.id },
    { id: "label", header: "Label", width: 100, sortValue: (r) => r.label ?? "", render: (r) => (r.label ? <StateLabel tone={tone(r.label)} icon={r.label === "ACCEPT" ? "ok" : r.label === "WRONG" ? "blocked" : "dot"}>{r.label.toLowerCase()}</StateLabel> : <span className="t-muted">unlabelled</span>) },
    { id: "family", header: "Family", width: 150, sortValue: (r) => r.family, render: (r) => <Tag>{r.family}</Tag> },
    { id: "summary", header: "Proposal", width: 460, render: (r) => r.summary, text: (r) => r.summary },
    { id: "reason", header: "Reviewer's reason", flex: true, minWidth: 260, render: (r) => <span className="t-secondary">{r.reason ?? ""}</span>, text: (r) => r.reason ?? "" },
  ];
  return (
    <div>
      <div className="st-toolbar st-toolbar--tight st-pad-x">
        <SegmentedControl<"all" | LabelRow["label"] | "none">
          label="Label"
          size="sm"
          value={label}
          onValueChange={setLabel}
          items={[
            { value: "all", label: "All", count: rows.length },
            { value: "ACCEPT", label: "Accept", count: rows.filter((r) => r.label === "ACCEPT").length },
            { value: "TRIVIAL", label: "Trivial", count: rows.filter((r) => r.label === "TRIVIAL").length },
            { value: "WRONG", label: "Wrong", count: rows.filter((r) => r.label === "WRONG").length },
            { value: "none", label: "Unlabelled", count: rows.filter((r) => !r.label).length },
          ]}
        />
      </div>
      <DataTable label="Labelled proposals" rows={shown} columns={columns} rowKey={(r) => `${r.repo}:${r.id}`} height={420} storageKey="studies" />
    </div>
  );
}
