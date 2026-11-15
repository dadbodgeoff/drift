// Study runs: precision as eval/study/metrics.mjs scores each run, by tier and by
// language, with the decisions recorded before any held-out census (D1–D4) applied
// the way metrics.mjs applies them. See: the latest run per language; decide: which
// run; dig: tiers, languages, the course-material sensitivity check, families, repos.
import { Fragment, useMemo, useState } from "react";
import { Badge, Panel, Select, StackedBar, StateLabel } from "@drift/ui";
import { type Exclusion, type LabelShift, type LanguageRow, type Rate, type StudyRun, type TierStats, decisionsOf, describeVariant, languageAdvisesOnly, languageLabel, latestAndEarlier, noDefaultTier, parseShift, readRuns, rubricChanged, rubricLabel, tierDefinition, tierLabel } from "@/entities/study";
import type { StudiesData } from "@/shared/api";
import { num, pct } from "@/shared/lib/format";

/** `75.3% [68.1–81.3]`, the Wilson interval; the cluster intervals in the tooltip. */
function RateCell({ r, strong }: { r: Rate | null; strong?: boolean }) {
  if (!r || r.p === null || !r.n) return <span className="t-muted">–</span>;
  const clusters = r.boot && r.t && r.boot.clusters >= 2 ? `${r.boot.clusters} repos: bootstrap ${pct(r.boot.lo ?? 0, 1)}–${pct(r.boot.hi ?? 0, 1)}, cluster-t ${pct(r.t.lo ?? 0, 1)}–${pct(r.t.hi ?? 0, 1)}` : "no cluster interval";
  return (
    <span className="sd-rate" title={`${r.k}/${r.n}; Wilson 95% ${pct(r.lo ?? 0, 1)}–${pct(r.hi ?? 0, 1)}; ${clusters}`}>
      <span className={strong ? "sd-rate__p is-strong" : "sd-rate__p"}>{pct(r.p, 1)}</span>
      <span className="sd-rate__ci">
        [{pct(r.lo ?? 0, 1)}–{pct(r.hi ?? 0, 1)}]
      </span>
    </span>
  );
}

/** The intervals in words: Wilson 95%, then the repo-cluster intervals (bootstrap and cluster-t). */
function intervals(r: Rate | null): string {
  if (!r || r.p === null || !r.n) return "";
  const w = `Wilson ${pct(r.lo ?? 0, 1)}–${pct(r.hi ?? 0, 1)}`;
  const c = r.boot && r.t && r.boot.clusters >= 2 ? `; ${r.boot.clusters} repos: bootstrap ${pct(r.boot.lo ?? 0, 1)}–${pct(r.boot.hi ?? 0, 1)}, cluster-t ${pct(r.t.lo ?? 0, 1)}–${pct(r.t.hi ?? 0, 1)}` : "; no cluster interval";
  return `${r.k}/${r.n}, ${w}${c}`;
}

/** A/B κ before adjudication, with its repo-cluster bootstrap interval. */
function kappaText(a: LabelShift): string {
  const ci = a.kappaBoot && a.kappaBoot.lo != null && a.kappaBoot.hi != null ? ` [${a.kappaBoot.lo.toFixed(2)}–${a.kappaBoot.hi.toFixed(2)}, ${a.kappaBoot.clusters} repos]` : "";
  return `A/B κ ${a.kappa != null ? a.kappa.toFixed(2) : "–"}${ci} over ${num(a.n)} double-labelled, before adjudication`;
}

function exclusionText(e: Exclusion): string {
  return `excluded ${e.repos.length ? e.repos.join(", ") : "proposals"}${e.uids.length ? ` (${e.uids.length} ${e.uids.length === 1 ? "proposal" : "proposals"} left unlabelled)` : ""}`;
}

/** `py`, `py2`: which dev set a part is, by its manifest. */
function partLabel(r: StudyRun): string {
  return r.part ? `${r.part}${r.manifest ? ` (${r.manifest.replace(/^eval\//, "")})` : ""}` : (r.manifest?.replace(/^eval\//, "") ?? "");
}

function Counts({ s }: { s: TierStats }) {
  return (
    <span className="t-num">
      {num(s.accept)} / {num(s.trivial)} / {num(s.wrong)}
      {s.unlabelled ? <span className="t-warning"> · {num(s.unlabelled)} unlabelled</span> : null}
    </span>
  );
}

function Verdict({ t, what }: { t: { criterion: string; threshold: number; value: number | null; met: boolean | null } | null; what: string }) {
  if (!t) return <span className="t-muted">–</span>;
  if (t.met === null)
    return (
      <span className="t-caption t-muted" title={`${what}: ${t.criterion}. Verdicts are printed for primary held-out runs only.`}>
        no verdict (not held-out)
      </span>
    );
  return t.met ? (
    <StateLabel tone="success" icon="ok" title={t.criterion}>
      met (≥ {pct(t.threshold)})
    </StateLabel>
  ) : (
    <StateLabel tone="danger" icon="blocked" title={t.criterion}>
      not met (&lt; {pct(t.threshold)})
    </StateLabel>
  );
}

export function RunsSection({
  runs: raw,
  calibrations = [],
  agreements = [],
  exclusions = [],
  manifests = [],
}: {
  runs: StudiesData["runs"];
  calibrations?: StudiesData["calibrations"];
  agreements?: NonNullable<StudiesData["agreements"]>;
  exclusions?: NonNullable<StudiesData["exclusions"]>;
  manifests?: StudiesData["manifests"];
}) {
  const { runs, unreadable, coverage } = useMemo(() => readRuns(raw, { agreements, exclusions }), [raw, agreements, exclusions]);
  // The newest round of each language, one card per part (dev-v3: ts, py, py2), each scored with the
  // product's tier when a view applies it; earlier rounds are listed under the cards.
  const { latest, earlier } = useMemo(() => latestAndEarlier(runs), [runs]);
  const [sel, setSel] = useState<string | null>(null);
  const run = runs.find((r) => r.path === sel) ?? latest[0] ?? runs[0] ?? null;
  const unreadableNote = unreadable.length > 0 && (
    <div className="st-note sd-unreadable" role="status">
      <b>
        {unreadable.length} {unreadable.length === 1 ? "run could not be read" : "runs could not be read"}
      </b>{" "}
      (the others are shown):
      <ul className="st-plainlist">
        {unreadable.map((u) => (
          <li key={u.path}>
            <span className="dui-mono">{u.path}</span>: {u.reason}
          </li>
        ))}
      </ul>
    </div>
  );
  // Coverage runs (apps-coverage.mjs) measure what Drift shows, not labels: listed apart, never a round.
  const coverageNote = coverage.length > 0 && (
    <div className="st-note sd-coverage" role="note">
      <b>{coverage.length === 1 ? "1 coverage run" : `${coverage.length} coverage runs`}</b> (no labels, so no round):
      <ul className="st-plainlist">
        {coverage.map((c) => (
          <li key={c.path}>
            <span className="dui-mono">{c.path}</span>: {c.repos} repos
            {c.silentRoot ? `, ${c.silentRoot.repos} of ${c.silentRoot.of} show no card from the root` : ""}
            {c.packages ? `, ${c.packages.total} packages${c.packages.withShown !== null ? ` (${c.packages.withShown} with a shown card)` : ""}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
  if (!runs.length)
    return (
      <>
        <p className="st-note">
          No scored runs: the Studies view reads eval/study/runs/&lt;run&gt;/metrics.json (written by <span className="dui-mono">metrics.mjs --json</span>).
        </p>
        {unreadableNote}
        {coverageNote}
      </>
    );
  return (
    <section className="sd-runs" aria-labelledby="sd-runs-h">
      <div className="st-row st-wrap">
        <h3 id="sd-runs-h" className="st-section-title">
          Latest runs: default-tier precision per language
        </h3>
        {!runs.some((r) => r.role !== "dev") && (
          <Badge tone="warning" icon="attention">
            dev set only, no held-out run yet
          </Badge>
        )}
        {rubricChanged(latest) && (
          <Badge tone="warning" icon="attention" title="These figures were labelled under different rubrics; rubric v3 (D6) applies to the held-out run and later dev rounds">
            rubric changed: {latest.map((r) => `${languageLabel(r.language)} ${rubricLabel(r.rubric)}`).join(" · ")}
          </Badge>
        )}
      </div>
      <div className="sd-latest">
        {latest.map((r) => (
          <button key={r.path} type="button" className={`sd-latest__card${r === run ? " is-selected" : ""}`} onClick={() => setSel(r.path)} aria-pressed={r === run}>
            <span className="dui-overline">
              {languageLabel(r.language)}
              {r.part ? ` · ${r.part}` : ""}
              {` · ${tierLabel(r)}`}
              {` · rubric ${rubricLabel(r.rubric)}`}
            </span>
            <span className="sd-latest__num">{noDefaultTier(r) ? "advise only" : r.defaultTier.acceptShown?.p != null ? pct(r.defaultTier.acceptShown.p, 1) : "–"}</span>
            <span className="t-secondary">{noDefaultTier(r) ? "no default tier: Python conventions advise only (decision D7)" : <>default-tier accept, over {num(r.defaultTier.shown)} shown · target 95% (D1)</>}</span>
            <span className="t-caption t-muted sd-latest__ci">{intervals(r.defaultTier.acceptShown)}</span>
            <span className="t-caption t-secondary">
              not wrong {r.overall.notWrongShown?.p != null ? pct(r.overall.notWrongShown.p, 1) : "–"} of all {num(r.overall.shown)} shown (D4)
            </span>
            <span className="t-caption t-muted sd-latest__ci">{intervals(r.overall.notWrongShown)}</span>
            {r.agreement && <span className="t-caption t-muted sd-latest__kappa">{kappaText(r.agreement)}</span>}
            {r.exclusions.map((e) => (
              <span key={e.path} className="t-caption t-warning sd-latest__excluded">
                {exclusionText(e)}
              </span>
            ))}
            {r.exposure && (
              <span className="t-caption t-secondary sd-latest__without">
                without {r.exposure.exposed.join(", ")}:{" "}
                {noDefaultTier(r) ? "no default tier (D7)" : <>default-tier accept {r.exposure.cleanTier.acceptShown?.p != null ? pct(r.exposure.cleanTier.acceptShown.p, 1) : "–"} over {num(r.exposure.cleanTier.shown)} shown</>} · not wrong{" "}
                {r.exposure.clean.notWrongShown?.p != null ? pct(r.exposure.clean.notWrongShown.p, 1) : "–"}
              </span>
            )}
            {r.variants.length > 0 && (
              <span className="t-caption t-muted sd-latest__variants">
                {r.variants.length === 1 ? "variant" : "variants"} of this run, not a result: {r.variants.map((v) => v.variant).join(", ")} (in the run detail)
              </span>
            )}
            <span className="t-caption t-muted">
              <span className="dui-mono">
                {r.name}
                {r.view ? `/${r.view}` : ""}
              </span>
              {r.manifest ? ` · ${r.manifest}` : ""}
            </span>
          </button>
        ))}
      </div>
      <EarlierRounds earlier={earlier} latest={latest} onSelect={setSel} />

      <div className="st-toolbar">
        <Select
          size="sm"
          label="Run"
          value={run?.path ?? ""}
          onChange={(e) => setSel(e.target.value)}
          options={runs.map((r) => ({
            value: r.path,
            label: `${r.name}${r.view ? ` · ${r.calibration ? "" : "view "}${r.view}` : ""} (${languageLabel(r.language)}, ${r.calibration ? "calibration" : r.role}, rubric ${rubricLabel(r.rubric)})`,
          }))}
        />
        {run && (
          <span className="t-caption t-muted">
            {tierDefinition(run)}
            {run.calibration ? " (a calibration part)" : run.view ? " (a derived view of the run: not pre-registered)" : run.tier?.preRegistered ? " (pre-registered)" : ""} · rubric{" "}
            <span className="dui-mono" title={run.rubric.sha256 ?? undefined}>
              {rubricLabel(run.rubric)}
              {run.rubric.sha256 ? ` ${run.rubric.sha256.slice(0, 8)}` : ""}
            </span>{" "}
            · drift <span className="dui-mono">{run.driftCommit?.slice(0, 7) ?? run.driftVersion ?? "?"}</span> · {run.manifest ?? "no manifest"}
          </span>
        )}
      </div>

      {unreadableNote}
      {coverageNote}
      {run && (run.calibration ? <CalibrationDetail run={run} calibration={calibrationOf(run, calibrations)} /> : <RunDetail run={run} />)}
      <Decisions runs={runs} />
      <Manifests manifests={manifests} runs={runs} />
    </section>
  );
}

/** Every earlier round, with the rubric it was labelled under: a rubric other than the latest round's is marked, since the figures are not comparable as they stand. */
function EarlierRounds({ earlier, latest, onSelect }: { earlier: StudyRun[]; latest: StudyRun[]; onSelect: (path: string) => void }) {
  if (!earlier.length) return null;
  const latestRubric = (lang: string) => latest.find((l) => l.language === lang)?.rubric;
  return (
    <Panel title="Earlier rounds" subtitle="Each earlier run or part, scored the way its card would be; a different rubric is marked">
      <table className="sd-table sd-table--runs sd-earlier">
        <thead>
          <tr>
            <th>Run</th>
            <th>Language</th>
            <th>Rubric</th>
            <th>Default-tier accept</th>
            <th>Not wrong (all shown)</th>
          </tr>
        </thead>
        <tbody>
          {earlier.map((r) => {
            const lr = latestRubric(r.language);
            const differs = lr != null && rubricLabel(lr) !== rubricLabel(r.rubric);
            return (
              <tr key={r.path}>
                <td>
                  <button type="button" className="st-link dui-mono" onClick={() => onSelect(r.path)}>
                    {r.name}
                    {r.view ? `/${r.view}` : ""}
                  </button>
                </td>
                <td>
                  {languageLabel(r.language)}
                  {r.part || r.manifest ? <span className="t-caption t-muted"> · {partLabel(r)}</span> : null}
                </td>
                <td>
                  {differs ? (
                    <StateLabel tone="warning" icon="attention" title={`Labelled under ${rubricLabel(r.rubric)}; the latest ${languageLabel(r.language)} round is ${rubricLabel(lr)}`}>
                      {rubricLabel(r.rubric)}: a different rubric
                    </StateLabel>
                  ) : (
                    rubricLabel(r.rubric)
                  )}
                </td>
                <td>
                  <RateCell r={r.defaultTier.acceptShown} />
                </td>
                <td>
                  <RateCell r={r.overall.notWrongShown} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/**
 * The run's variants (`metrics-<variant>.json`): the same cards scored with one option changed, side by side with
 * the run's own figures. Each is labelled as a variant of this run, with what it changes; none is a result.
 */
function TierCells({ s, strongAccept, strongNotWrong }: { s: TierStats | null; strongAccept?: boolean; strongNotWrong?: boolean }) {
  if (!s)
    return (
      <td colSpan={4} className="t-muted">
        –
      </td>
    );
  return (
    <>
      <td className="t-num">{num(s.shown)}</td>
      <td>
        <Counts s={s} />
      </td>
      <td>
        <RateCell r={s.acceptShown} strong={strongAccept} />
      </td>
      <td>
        <RateCell r={s.notWrongShown} strong={strongNotWrong} />
      </td>
    </>
  );
}

function Variants({ run }: { run: StudyRun }) {
  if (!run.variants.length) return null;
  const tiers = (r: StudyRun): [string, TierStats | null][] => [
    ["Default tier", r.defaultTier],
    ["Suggestion tier", r.suggestionTier],
    ["All shown", r.overall],
  ];
  return (
    <Panel
      title={`Variants of this run (${run.variants.length})`}
      subtitle="The same cards scored another way, from a metrics-<variant>.json beside the run's scoring: a variant of this run, never a result of its own"
    >
      {run.variants.map((v) => {
        const info = describeVariant(v, run);
        const rows = tiers(run).map(([label, s], i) => [label, s, tiers(v)[i][1]] as const).filter(([, s, w]) => (s?.shown ?? 0) > 0 || (w?.shown ?? 0) > 0);
        return (
          <section key={info.file} className="sd-variant" aria-label={`Variant ${info.name} of ${run.name}${run.part ? `/${run.part}` : ""}`}>
            <div className="st-row st-wrap sd-variant__head">
              <Badge tone="neutral" variant="outline">
                variant of this run
              </Badge>
              <b className="dui-mono">{info.name}</b>
              <span className="t-caption t-muted dui-mono">{info.file}</span>
            </div>
            <p className="t-body-sm sd-variant__meaning">{info.meaning}</p>
            <table className="sd-table sd-table--runs sd-variant__table" aria-label={`${run.name}${run.part ? `/${run.part}` : ""} and its variant ${info.name}, by tier`}>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Scored as</th>
                  <th>Shown</th>
                  <th>A / T / W</th>
                  <th>Accept</th>
                  <th>Not wrong</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, s, w]) => (
                  <Fragment key={label}>
                    <tr>
                      <td rowSpan={2}>{label}</td>
                      <td>the run (its result)</td>
                      <TierCells s={s} strongAccept={label === "Default tier"} strongNotWrong={label === "All shown"} />
                    </tr>
                    <tr className="sd-variant__row">
                      <td className="t-secondary">variant {info.name}</td>
                      <TierCells s={w} />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </Panel>
  );
}

/** How a run or part was labelled: A/B agreement before adjudication, what adjudication excluded and why, and the rates with and without the excluded or exposed repos. */
function Labelling({ run }: { run: StudyRun }) {
  if (!run.agreement && !run.exclusions.length && !run.exposure) return null;
  const e = run.exposure;
  return (
    <Panel title="Labelling" subtitle="Two blind labellers (A and B), adjudicated by a third; as the run's agreement.json and adjudication queue record it">
      {run.agreement ? <ShiftSummary s={run.agreement} /> : <p className="t-caption t-muted">No agreement.json for this run.</p>}
      {run.agreement && <p className="t-caption t-muted">{kappaText(run.agreement)}.</p>}
      {run.exclusions.map((x) => (
        <div key={x.path} className="st-note sd-excluded">
          <b>Excluded: {x.repos.join(", ") || "proposals"}.</b> {x.reason}
          {x.uids.length > 0 && (
            <>
              {" "}
              Unlabelled: <span className="dui-mono">{x.uids.join(", ")}</span>.
            </>
          )}
          <span className="t-caption t-muted">
            {" "}
            (<span className="dui-mono">{x.path}/queue.json</span>
            {x.at ? `, ${x.at.slice(0, 10)}` : ""})
          </span>
        </div>
      ))}
      {e && (
        <table className="sd-table sd-table--runs sd-exposure" aria-label={`Rates with and without ${e.exposed.join(", ")}`}>
          <thead>
            <tr>
              <th>Repos</th>
              <th>Shown</th>
              <th>Default-tier accept</th>
              <th>Not wrong (all shown)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>All repos</td>
              <td className="t-num">{num(run.overall.shown)}</td>
              <td>
                <RateCell r={run.defaultTier.acceptShown} strong />
              </td>
              <td>
                <RateCell r={run.overall.notWrongShown} strong />
              </td>
            </tr>
            <tr>
              <td>Without {e.exposed.join(", ")}</td>
              <td className="t-num">{num(e.clean.shown)}</td>
              <td>
                <RateCell r={e.cleanTier.acceptShown} />
              </td>
              <td>
                <RateCell r={e.clean.notWrongShown} />
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** The calibration data of a run: the files its metrics.json names, else the calibration directory it sits in. */
function calibrationOf(run: StudyRun, calibrations: StudiesData["calibrations"]): StudiesData["calibrations"][number] | null {
  const dir = (p: string | null) => (p ? p.slice(0, p.lastIndexOf("/")) : null);
  const named = dir(run.calibrationFiles?.shift ?? null);
  return calibrations.find((c) => c.path === named) ?? calibrations.find((c) => run.path === c.path || run.path.startsWith(`${c.path}/`)) ?? null;
}

/** A calibration: how a new rubric moved labels (prior labels against the new final ones), and how far two labellers agreed under it. Not a precision result. */
function CalibrationDetail({ run, calibration }: { run: StudyRun; calibration: StudiesData["calibrations"][number] | null }) {
  const shift = parseShift(calibration?.shift);
  const agreementDir = run.calibrationFiles?.agreement ? run.calibrationFiles.agreement.slice(0, run.calibrationFiles.agreement.lastIndexOf("/")) : run.path;
  const agreement = parseShift(calibration?.agreements.find((a) => a.path === agreementDir)?.agreement);
  return (
    <div className="sd-run">
      <p className="st-note">
        <b>Calibration, not a precision result.</b> This run relabels proposals under rubric {rubricLabel(run.rubric)} to measure how the rubric moves labels and whether labellers agree
        on it. Its accept rates describe the calibration sample, not Drift.
      </p>
      <div className="st-grid st-grid--2">
        <Panel title={`Labeller agreement, ${run.view ?? run.name}`} subtitle="Two blind labellers under the new rubric, before adjudication">
          {agreement ? <ShiftSummary s={agreement} /> : <p className="t-caption t-muted">No agreement.json for this part.</p>}
        </Panel>
        <Panel title="Label shift: prior labels → new rubric" subtitle={`Every calibration proposal, both languages${shift ? ` (n=${shift.n})` : ""}`}>
          {shift ? (
            <>
              <ShiftSummary s={shift} />
              <ShiftMatrix s={shift} />
            </>
          ) : (
            <p className="t-caption t-muted">No shift.json for this calibration.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ShiftSummary({ s }: { s: LabelShift }) {
  return (
    <p className="t-body-sm">
      κ <b className="sd-rate__p">{s.kappa != null ? s.kappa.toFixed(2) : "–"}</b>
      {s.kappaBoot && s.kappaBoot.lo != null && s.kappaBoot.hi != null && (
        <span className="t-muted">
          {" "}
          [{s.kappaBoot.lo.toFixed(2)}–{s.kappaBoot.hi.toFixed(2)}, {s.kappaBoot.clusters} repos]
        </span>
      )}{" "}
      · {s.exact != null ? pct(s.exact) : "–"} exact over {num(s.n)}
    </p>
  );
}

const LABELS = ["ACCEPT", "TRIVIAL", "WRONG"];

function ShiftMatrix({ s }: { s: LabelShift }) {
  return (
    <table className="sd-table sd-table--runs sd-shift" aria-label="Label shift matrix: rows are prior labels, columns the new rubric's">
      <thead>
        <tr>
          <th>prior ↓ · new →</th>
          {LABELS.map((l) => (
            <th key={l}>{l.toLowerCase()}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {LABELS.map((from) => (
          <tr key={from}>
            <td>{from.toLowerCase()}</td>
            {LABELS.map((to) => {
              const n = s.confusion[from]?.[to] ?? 0;
              return (
                <td key={to} className={`t-num${from === to ? " is-same" : n ? " is-moved" : ""}`}>
                  {num(n)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Decisions recorded with the runs (metrics.json `decisions`): D1–D4, D6 and whatever later runs record. */
function Decisions({ runs }: { runs: StudyRun[] }) {
  const ds = decisionsOf(runs);
  if (!ds.length) return null;
  return (
    <Panel title="Decisions" subtitle="As the runs record them (metrics.json); the study README holds the full log">
      <ul className="sd-decisions">
        {ds.map((d) => (
          <li key={d.id}>
            <span className="dui-mono sd-decisions__id">{d.id}</span>
            <span className="sd-decisions__title">
              {d.title}
              {d.rubricSha256 && <span className="dui-mono t-muted"> · rubric {d.rubricSha256.slice(0, 8)}</span>}
            </span>
            <span className="t-caption t-muted">
              {d.status} · {d.by} · {d.date}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The dev manifests (eval/repos*.json) and which runs used each: a set no run used is unlabelled. */
function Manifests({ manifests, runs }: { manifests: StudiesData["manifests"]; runs: StudyRun[] }) {
  if (!manifests.length) return null;
  return (
    <Panel title="Dev sets" subtitle="Repository manifests Drift is tuned and labelled on (held-out manifests are not read here)">
      <ul className="sd-decisions">
        {manifests.map((m) => {
          const used = [...new Set(runs.filter((r) => r.manifest === m.path).map((r) => r.name))];
          return (
            <li key={m.path}>
              <span className="dui-mono sd-decisions__id">{m.path}</span>
              <span className="sd-decisions__title">
                {num(m.repos)} repos{m.language ? `, ${m.language}` : ""} ·{" "}
                {used.length ? (
                  <span className="t-secondary">labelled in {used.join(", ")}</span>
                ) : (
                  <StateLabel tone="neutral" icon="dot">
                    unlabelled dev set: no run yet
                  </StateLabel>
                )}
              </span>
              {m.note && <span className="t-caption t-muted sd-decisions__note">{m.note}</span>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const FAMILY_TIERS = [
  ["All shown", "overall"],
  ["Default tier", "defaultTier"],
  ["Suggestion tier", "suggestionTier"],
] as const;

/** A language's figures by rule family (metrics.json `by_language[].families[]`, since #68): n, accept and not wrong for all shown and each tier. Runs scored before #68 have none, and show nothing. */
function LanguageFamilies({ run, g }: { run: StudyRun; g: LanguageRow }) {
  if (!g.families.length) return null;
  const lang = languageLabel(g.language);
  const advisesOnly = languageAdvisesOnly(run, g.language);
  return (
    <Panel title={`${lang} by rule family`} subtitle="Rates over all shown in each tier, unlabelled counted as WRONG; Wilson 95% intervals, cluster intervals on hover">
      <div className="sd-families">
        <table className="sd-table sd-table--runs sd-lang-families" aria-label={`${lang}: accept and not wrong per rule family, all shown and by tier`}>
          <thead>
            <tr>
              <th rowSpan={2} scope="col">
                Family
              </th>
              {FAMILY_TIERS.map(([label]) => (
                <th key={label} colSpan={3} scope="colgroup" className="is-group">
                  {label}
                </th>
              ))}
            </tr>
            <tr className="sd-table__sub">
              {FAMILY_TIERS.flatMap(([label]) => [
                <th key={`${label}n`} scope="col" className="is-group">
                  n
                </th>,
                <th key={`${label}a`} scope="col">
                  Accept
                </th>,
                <th key={`${label}w`} scope="col">
                  Not wrong
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {g.families.map((f) => (
              <tr key={f.family || f.name}>
                <th scope="row">{f.name}</th>
                {FAMILY_TIERS.flatMap(([label, key]) => {
                  const s = f[key];
                  return [
                    <td key={`${label}n`} className={s.shown ? "t-num is-group" : "t-num t-muted is-group"} title={s.unlabelled ? `${num(s.unlabelled)} unlabelled, counted as WRONG` : undefined}>
                      {num(s.shown)}
                    </td>,
                    <td key={`${label}a`}>
                      <RateCell r={s.acceptShown} strong={key === "defaultTier"} />
                    </td>,
                    <td key={`${label}w`}>
                      <RateCell r={s.notWrongShown} strong={key === "overall"} />
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {advisesOnly && <p className="t-caption t-muted">No default tier: {lang} conventions advise only (decision D7), so every family is in the suggestion tier.</p>}
    </Panel>
  );
}

function RunDetail({ run }: { run: StudyRun }) {
  const tiers: [string, TierStats | null, boolean][] = [
    ["Default tier", run.defaultTier, true],
    ["Suggestion tier", run.suggestionTier, false],
    ["All shown", run.overall, false],
  ];
  return (
    <div className="sd-run">
      {run.secondary && (
        <p className="st-note">
          <b>Secondary, not a headline result:</b> this held-out set was demoted before any held-out data because its conventions were exposed.
        </p>
      )}
      {run.failedRepos.length > 0 && (
        <p className="st-note">
          <b>{run.failedRepos.length} repos failed</b> (decision D3: reported as failures, not swapped): {run.failedRepos.map((r) => `${r.name} (${r.status})`).join("; ")}
        </p>
      )}
      <div className="st-grid st-grid--2">
        <Panel title="By tier" subtitle="Rates over all shown, unlabelled counted as WRONG (the target definition); Wilson 95% intervals, cluster intervals on hover">
          <table className="sd-table sd-table--runs">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Shown</th>
                <th>A / T / W</th>
                <th>Accept</th>
                <th>Not wrong</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(([label, s, strong]) =>
                s ? (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="t-num">{num(s.shown)}</td>
                    <td>
                      <Counts s={s} />
                    </td>
                    <td>
                      <RateCell r={s.acceptShown} strong={strong} />
                    </td>
                    <td>
                      <RateCell r={s.notWrongShown} strong={label === "All shown"} />
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </Panel>
        <Panel title="Per language (D1, D4)" subtitle="Targets are judged per language on the point estimate (≥ 95%); pooled figures are secondary">
          {run.byLanguage ? (
            <table className="sd-table sd-table--runs">
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Repos</th>
                  <th>Default-tier accept</th>
                  <th>D1</th>
                  <th>Not wrong (all shown)</th>
                  <th>D4</th>
                </tr>
              </thead>
              <tbody>
                {run.byLanguage.map((g) => (
                  <tr key={g.language}>
                    <td>{languageLabel(g.language)}</td>
                    <td className="t-num">{num(g.repos.length)}</td>
                    <td>
                      <RateCell r={g.defaultTier.acceptShown} strong />
                    </td>
                    <td>
                      <Verdict t={g.target} what="D1" />
                    </td>
                    <td>
                      <RateCell r={g.overall.notWrongShown} strong />
                    </td>
                    <td>
                      <Verdict t={g.notWrongTarget} what="D4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="t-caption t-muted">This run's metrics.json predates the per-language tables (eval/study #24): re-score it with metrics.mjs --json to see them.</p>
          )}
        </Panel>
      </div>
      <Variants run={run} />
      {run.byLanguage?.map((g) => <LanguageFamilies key={g.language} run={run} g={g} />)}
      <Labelling run={run} />
      {run.sensitivity && (
        <Panel title={`Sensitivity: without ${run.sensitivity.without.join(", ")} (D2)`} subtitle="Course-material repos stay in, as pre-registered: the with-them rows are the result, the without-them rows a check">
          <table className="sd-table sd-table--runs">
            <thead>
              <tr>
                <th>Language</th>
                <th>Removed</th>
                <th>Default-tier accept, with</th>
                <th>without</th>
                <th>Not wrong, with</th>
                <th>without</th>
              </tr>
            </thead>
            <tbody>
              {run.sensitivity.byLanguage.map((g) => (
                <tr key={g.language}>
                  <td>{languageLabel(g.language)}</td>
                  <td className="dui-mono">{g.removed.join(", ") || "–"}</td>
                  <td>
                    <RateCell r={g.with.defaultTier.acceptShown} strong />
                  </td>
                  <td>
                    <RateCell r={g.without.defaultTier.acceptShown} />
                  </td>
                  <td>
                    <RateCell r={g.with.overall.notWrongShown} strong />
                  </td>
                  <td>
                    <RateCell r={g.without.overall.notWrongShown} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <div className="st-grid st-grid--2">
        <Panel title="By rule family" subtitle="Accept rate among labelled proposals, Wilson 95%">
          <ul className="sd-rfam">
            {run.families
              .slice()
              .sort((a, b) => (b.acceptRate?.p ?? 0) - (a.acceptRate?.p ?? 0))
              .map((f) => (
                <li key={f.family}>
                  <span className="sd-rfam__name">
                    {f.name} <span className="t-muted t-caption">n={f.shown}</span>
                  </span>
                  <span className="sd-rfam__bar" aria-hidden="true">
                    <span style={{ width: `${(f.acceptRate?.p ?? 0) * 100}%` }} className={(f.acceptRate?.p ?? 0) < 0.5 ? "is-low" : undefined} />
                  </span>
                  <span className="sd-rfam__rate">
                    <RateCell r={f.acceptRate} />
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
        <Panel title="By repository" subtitle="Accept, trivial and wrong among the shown proposals">
          <ul className="sd-repos">
            {run.repos.map((r) => (
              <li key={r.name}>
                <span className="dui-mono t-truncate">{r.name}</span>
                <StackedBar
                  label={r.name}
                  legend={false}
                  height={10}
                  total={Math.max(1, r.shown)}
                  segments={[
                    { label: "accept", value: r.accept, color: "success" },
                    { label: "trivial", value: r.trivial, color: "muted" },
                    { label: "wrong", value: r.wrong, color: "danger" },
                  ]}
                />
                <span className="t-num t-body-sm">{r.shown ? pct(r.accept / r.shown) : "–"}</span>
                <span className="t-num t-caption t-muted">n={r.shown}</span>
              </li>
            ))}
          </ul>
          {Object.keys(run.wrongBecause).length > 0 && (
            <p className="st-note">
              WRONG because:{" "}
              {Object.entries(run.wrongBecause)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                .join(", ")}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
