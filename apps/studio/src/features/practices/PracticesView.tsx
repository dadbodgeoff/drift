// `drift practices`: what the codebase does for each cross-cutting concern (eval/study/PLAN-R13.md §3, §4, §9). Read-only:
// facts, not rules, and nothing here is enforced (promotion to a rule comes in a later round). The default view is
// the recipe per package and kind of entry point, then the findings Drift ranks; every concern's variant table is
// the drill-down. Drift decides every count, split and config line; the Studio derives none of them.
import { useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, Icon, KeyValue, Panel, SegmentedControl, Select, TabPanel, Tabs, Tag, seriesColor, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { usePractices } from "@/entities/drift";
import { noneText, notReadShort } from "@/entities/basis";
import type { PracticeConcern, PracticeExample, PracticeFinding, PracticeGroup, PracticeRecipe, PracticeVariant, PracticesReport } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";
import {
  type ConcernScope,
  type CoverageBar as Bar,
  FINDING_KIND,
  HYGIENE,
  comparison,
  concernTitle,
  concernsIn,
  differsText,
  dominantOf,
  examplesIn,
  findingText,
  findingsIn,
  gaps,
  groupHint,
  groupMore,
  groupsOf,
  isPreview,
  letterOf,
  packagesOf,
  pct,
  pkgLabel,
  recipeConcerns,
  recipesIn,
  setsApartText,
  summaryIn,
  unknownReason,
  variantHint,
  variantLabel,
  variantName,
} from "./model/practices";

const KNOWN = seriesColor("accent");
const NONE = seriesColor("muted");
const IDENTIFIED = seriesColor("warning");

type Tab = "recipe" | "findings" | "concerns";
const TABS: Tab[] = ["recipe", "findings", "concerns"];

export function PracticesView({ tab, concern }: { tab: string | null; concern: string | null }) {
  const { repo } = useRepo();
  const q = usePractices(repo);
  const [pkg, setPkg] = useState<string | null>(null);
  if (q.isLoading) return <Loading label="Running drift practices" />;
  if (q.error) return <ErrorState title="drift practices failed" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const current: Tab = (TABS as string[]).includes(tab ?? "") ? (tab as Tab) : "recipe";
  return <Practices report={q.data.data} tab={current} concernParam={concern} pkg={pkg} setPkg={setPkg} />;
}

function Practices({ report, tab, concernParam, pkg: pkgState, setPkg }: { report: PracticesReport; tab: Tab; concernParam: string | null; pkg: string | null; setPkg(p: string | null): void }) {
  const packages = useMemo(() => packagesOf(report), [report]);
  // A package filter left over from another repository falls back to the whole repository.
  const pkg = pkgState !== null && packages.includes(pkgState) ? pkgState : null;
  const rows = useMemo(() => concernsIn(report, pkg), [report, pkg]);
  const summary = useMemo(() => summaryIn(report, pkg), [report, pkg]);
  const recipes = useMemo(() => recipesIn(report, pkg), [report, pkg]);
  const findings = useMemo(() => findingsIn(report, pkg), [report, pkg]);
  if (!report.concerns.length || report.summary.population === 0)
    return (
      <div className="st-page pr">
        <Header report={report} summary={summary} packages={packages} pkg={pkg} setPkg={setPkg} />
        <EmptyState icon="map" title="Drift describes no practice in this repository yet">
          <p>
            No concern has units here: no entry points, handlers or symbols a concern describes. Run <code className="st-cmd">drift practices</code> after adding code, or check that the scan covers it (Attention lists skipped files).
          </p>
        </EmptyState>
      </div>
    );
  return (
    <div className="st-page st-page--fill pr">
      <Header report={report} summary={summary} packages={packages} pkg={pkg} setPkg={setPkg} />
      <Tabs<Tab>
        label="Practices"
        idBase="pr"
        value={tab}
        onValueChange={(v) => navigate("practices", v)}
        items={[
          { value: "recipe", label: "Recipe", count: recipes.length },
          { value: "findings", label: "Findings", count: findings.length },
          { value: "concerns", label: "All concerns", count: rows.length },
        ]}
      />
      <TabPanel idBase="pr" value={tab} className="st-tabfill">
        {tab === "recipe" && <Recipes report={report} recipes={recipes} pkg={pkg} />}
        {tab === "findings" && <Findings report={report} findings={findings} pkg={pkg} />}
        {tab === "concerns" && <Concerns report={report} rows={rows} pkg={pkg} concernParam={concernParam} />}
      </TabPanel>
    </div>
  );
}

function Header({ report, summary, packages, pkg, setPkg }: { report: PracticesReport; summary: ReturnType<typeof summaryIn>; packages: string[]; pkg: string | null; setPkg(p: string | null): void }) {
  return (
    <header className="pr-head">
      <div className="sc-verdict">
        <div className="dui-overline">drift practices · read-only: what the code does, facts not rules</div>
        <div className="sc-verdict__line">
          <span className="sc-verdict__num">
            {num(summary.atTarget)}
            <span className="t-muted">/{num(summary.concerns)}</span>
          </span>
          <span className="sc-verdict__text">
            {summary.concerns === 1 ? "concern" : "concerns"} at the {pct(report.summary.target)} coverage target{pkg !== null ? ` in ${pkgLabel(pkg)}` : ""}
          </span>
        </div>
        <p className="t-secondary">
          {num(summary.bar.total)} units described: {num(summary.bar.known)} known, {summary.bar.identified ? `${num(summary.bar.identified)} identified (the caller identified, no one turned away), ` : ""}{num(summary.bar.none)} none (nothing found in what Drift read), {num(summary.bar.unknown)} unknown. Nothing here is checked: a practice becomes a rule only through review.
        </p>
      </div>
      <div className="pr-head__tools">
        <Select
          size="sm"
          label="Package"
          value={pkg === null ? "" : `pkg:${pkg}`}
          onChange={(e) => setPkg(e.target.value ? e.target.value.slice(4) : null)}
          options={[{ value: "", label: "All packages" }, ...packages.map((p) => ({ value: `pkg:${p}`, label: pkgLabel(p) }))]}
          disabled={packages.length === 0}
        />
        <code className="st-cmd" title="The command this view runs">
          drift practices --json
        </code>
      </div>
    </header>
  );
}

// ---------- the recipe ----------

function Recipes({ report, recipes, pkg }: { report: PracticesReport; recipes: PracticeRecipe[]; pkg: string | null }) {
  if (!recipes.length)
    return (
      <EmptyState icon="info" title={pkg !== null ? `No recipe in ${pkgLabel(pkg)}` : "No recipe"}>
        A recipe needs entry points (routes, server actions, handlers) that the recipe concerns describe: authentication, authorization, validation, errors and API design.
      </EmptyState>
    );
  return (
    <div className="st-pad st-stack pr-recipes st-scroll">
      <p className="t-secondary t-body-sm">
        For each package and kind of entry point: how most of them do each recipe concern, the second way when there is one, a file to copy, and how many do none of it. What agents are told about a new file of that kind.
      </p>
      {recipes.map((x) => (
        <Recipe key={x.id} report={report} recipe={x} />
      ))}
    </div>
  );
}

function Recipe({ report, recipe }: { report: PracticesReport; recipe: PracticeRecipe }) {
  const openCode = useOpenCode();
  return (
    <Panel
      className="pr-recipe"
      title={
        <span className="st-row">
          <Tag tone="info">{recipe.role}</Tag> <span>{recipe.label}</span>
        </span>
      }
      subtitle={`${num(recipe.population)} entry points · ${recipe.id}`}
      padded={false}
    >
      <table className="pr-table">
        <caption className="dui-sr">{recipe.label}: the recipe</caption>
        <thead>
          <tr>
            <th scope="col">Concern</th>
            <th scope="col">Most do</th>
            <th scope="col">Second way</th>
            <th scope="col">Copy</th>
            <th scope="col" className="is-num">
              None
            </th>
            <th scope="col" className="is-num">
              Unknown
            </th>
          </tr>
        </thead>
        <tbody>
          {recipeConcerns(recipe).map((c) => {
            const [a, b] = c.variants;
            return (
              <tr key={c.concern}>
                <th scope="row">
                  <button type="button" className="st-link" onClick={() => navigate("practices", "concerns", { concern: c.concern })}>
                    {concernTitle(report, c.concern)}
                  </button>
                  <div className="t-caption t-muted">{num(c.total)} here</div>
                </th>
                <td>{a ? <Share label={a.label} share={a.share} members={a.members} /> : <span className="t-muted">nothing known</span>}</td>
                <td>
                  {b ? (
                    <>
                      <Share label={b.label} share={b.share} members={b.members} />
                      {c.differs && (
                        <div className={`t-caption${c.differs.attribute ? " t-muted" : " t-warning"}`}>
                          {c.differs.attribute ? "" : <Icon name="attention" size={11} />} {differsText(c.differs)}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="t-muted">–</span>
                  )}
                </td>
                <td>
                  {c.copy ? (
                    <button type="button" className="st-link dui-mono pr-copy" onClick={() => openCode({ path: c.copy!.path, line: c.copy!.line, context: { title: `To copy: ${a?.label ?? concernTitle(report, c.concern)}`, detail: recipe.label, tone: "accent" } })}>
                      {c.copy.path}:{c.copy.line}
                    </button>
                  ) : (
                    <span className="t-muted">–</span>
                  )}
                </td>
                <td className={`is-num${c.none ? " t-danger" : ""}`}>{num(c.none)}</td>
                <td className={`is-num${c.unknown ? " t-warning" : ""}`}>{num(c.unknown)}</td>
              </tr>
            );
          })}
          {/* What most of the package does for the preview concerns, as Drift states it (only where at least 60% do). */}
          {(recipe.preview ?? []).map((p) => (
            <tr key={`preview-${p.concern}`}>
              <th scope="row">
                <button type="button" className="st-link" onClick={() => navigate("practices", "concerns", { concern: p.concern })}>
                  {concernTitle(report, p.concern)}
                </button>{" "}
                <Tag>preview</Tag>
                <div className="t-caption t-muted">of {num(p.total)}</div>
              </th>
              <td>
                <Share label={p.label} share={p.share} members={p.members} />
              </td>
              <td>
                <span className="t-muted">–</span>
              </td>
              <td>
                {p.copy ? (
                  <button type="button" className="st-link dui-mono pr-copy" onClick={() => openCode({ path: p.copy!.path, line: p.copy!.line || 1, context: { title: `To copy: ${p.label}`, detail: recipe.label, tone: "accent" } })}>
                    {p.copy.line ? `${p.copy.path}:${p.copy.line}` : p.copy.path}
                  </button>
                ) : (
                  <span className="t-muted">–</span>
                )}
              </td>
              <td className="is-num t-muted">–</td>
              <td className="is-num t-muted">–</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Share({ label, share, members }: { label: string; share: number; members: number }) {
  return (
    <span className="pr-share">
      <span>{label}</span>
      <span className="t-caption t-muted">
        <b className="t-primary">{pct(share)}</b> · {num(members)}
      </span>
    </span>
  );
}

// ---------- findings ----------

function Findings({ report, findings, pkg }: { report: PracticesReport; findings: PracticeFinding[]; pkg: string | null }) {
  if (!findings.length)
    return (
      <EmptyState icon="ok" title={pkg !== null ? `Nothing to look at in ${pkgLabel(pkg)}` : "Nothing to look at"}>
        No key left unscoped, no unexplained split, no helper defined twice, no authentication or validation recorded as none, and no unknown instrument.
      </EmptyState>
    );
  return (
    <div className="st-pad st-stack st-scroll">
      <p className="t-secondary t-body-sm">What to look at first, as Drift ranks it: a tenant or owner key a signed-in caller names and nothing scopes, then two ways with nothing that sets them apart, then helpers defined more than once, then authentication or validation recorded as none, then what Drift cannot classify with the line that makes it known.</p>
      <ol className="pr-findings">
        {findings.map((f, i) => (
          <Finding key={`${f.kind}|${f.concern}|${f.package}|${f.instrument}|${f.key}|${i}`} report={report} f={f} />
        ))}
      </ol>
    </div>
  );
}

function Finding({ report, f }: { report: PracticesReport; f: PracticeFinding }) {
  const t = findingText(report, f);
  const k = FINDING_KIND[f.kind];
  return (
    <li className={`pr-finding is-${f.kind}`}>
      <div className="st-row st-wrap">
        <Tag tone={k.tone}>{k.label}</Tag>
        {f.concern === HYGIENE ? (
          <span className="t-caption">Hygiene</span>
        ) : (
          <button type="button" className="st-link t-caption" onClick={() => navigate("practices", "concerns", { concern: f.concern })}>
            {concernTitle(report, f.concern)}
          </button>
        )}
        {f.concern !== HYGIENE && isPreview(f.concern) && <Tag>preview</Tag>}
        <span className="t-caption t-muted">{f.package === null ? (f.kind === "duplicate_helper" ? "across packages" : "whole repository") : pkgLabel(f.package)}</span>
      </div>
      <p className="pr-finding__title">{t.title}</p>
      <p className="t-body-sm t-secondary">{t.detail}</p>
      {f.kind === "unexplained_split" && f.variants.length > 0 && (
        <p className="t-body-sm">
          {f.variants.map((id, i) => (
            <span key={id}>
              {i > 0 && " vs "}
              <b>{variantLabel(report, f.concern, id)}</b>
            </span>
          ))}
        </p>
      )}
      {f.config_hint && <ConfigHint hint={f.config_hint} />}
      {f.kind === "duplicate_helper" ? (
        (f.copies?.length ?? 0) > 0 && <Examples compact items={f.copies ?? []} context={(e) => ({ title: t.title, detail: `One of ${f.members} copies of ${e.symbol}`, tone: "warning" })} />
      ) : (
        f.examples.length > 0 && <Examples compact items={f.examples} context={(e) => ({ title: t.title, detail: `${concernTitle(report, f.concern)}: ${e.symbol}`, tone: f.kind === "none" || f.kind === "unscoped_key" ? "warning" : "info" })} />
      )}
    </li>
  );
}

/** A `.drift/config.yaml` line as Drift wrote it, to copy. */
function ConfigHint({ hint }: { hint: string }) {
  const toast = useToast();
  return (
    <div className="pr-hint">
      <span className="t-caption t-muted">In .drift/config.yaml:</span>
      <pre className="st-cmd pr-hint__yaml" data-testid="config-hint">
        {hint}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        icon="copy"
        onClick={() =>
          void navigator.clipboard?.writeText(hint).then(
            () => toast.show({ title: "Copied the config line", tone: "success", duration: 2000 }),
            () => toast.show({ title: "Could not copy", body: "Select the line and copy it instead.", tone: "warning", duration: 3000 }),
          )
        }
      >
        Copy
      </Button>
    </div>
  );
}

// ---------- every concern's variant table (the drill-down) ----------

function Concerns({ report, rows, pkg, concernParam }: { report: PracticesReport; rows: ConcernScope[]; pkg: string | null; concernParam: string | null }) {
  const selected = rows.find((r) => r.concern.id === concernParam) ?? rows[0] ?? null;
  const target = report.summary.target;
  return (
    <div className="pr-body">
      <nav className="pr-concerns st-scroll" aria-label="Concerns">
        <ul className="pr-concerns__list">
          {rows.map((r) => (
            <li key={r.concern.id}>
              <button type="button" className={`pr-concern${r === selected ? " is-selected" : ""}`} aria-current={r === selected ? "true" : undefined} onClick={() => navigate("practices", "concerns", { concern: r.concern.id })}>
                <span className="pr-concern__head">
                  <span className="pr-concern__title">
                    {r.concern.title}
                    {isPreview(r.concern.id) && <Tag>preview</Tag>}
                  </span>
                  <span className={`pr-concern__cov${r.bar.atTarget ? "" : " t-warning"}`}>{pct(r.bar.coverage)}</span>
                </span>
                <CoverageMeter bar={r.bar} label={`${r.concern.title} coverage`} compact />
                <span className="t-caption t-muted">
                  {num(r.counts.total)} {unitWord(r.concern.unit, r.counts.total)} · {r.variants.length} {r.variants.length === 1 ? "variant" : "variants"}
                  {r.concern.divergence.length && pkg === null ? ` · ${r.concern.divergence.length} ${r.concern.divergence.length === 1 ? "package differs" : "packages differ"}` : ""}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="t-muted t-body-sm st-pad">No concern has units in {pkg !== null ? pkgLabel(pkg) : "this repository"}.</li>}
        </ul>
        <Gaps rows={rows} target={target} notCovered={report.not_covered} />
      </nav>
      {selected ? <ConcernDetail key={`${selected.concern.id}|${pkg ?? ""}`} scope={selected} target={target} /> : <EmptyState title="Choose a concern" />}
    </div>
  );
}

/** Known, none and unknown shares of a population, with the target marked. Text beside it carries the numbers. */
function CoverageMeter({ bar, label, compact = false }: { bar: Bar; label: string; compact?: boolean }) {
  const summary = `${label}: ${pct(bar.coverage)} (${bar.known} known, ${bar.identified ? `${bar.identified} identified, ` : ""}${bar.none} none in what Drift read, ${bar.unknown} unknown of ${bar.total}); target ${pct(bar.target)}${bar.atTarget ? ", reached" : `, ${bar.toTarget} more to classify`}`;
  return (
    <div className={`pr-meter${compact ? " is-compact" : ""}`} role="img" aria-label={summary}>
      <div className="pr-meter__bar" aria-hidden="true">
        {bar.total === 0 ? (
          <span className="pr-meter__empty" />
        ) : (
          <>
            {bar.known > 0 && <span className="pr-meter__seg" style={{ flexGrow: bar.known, background: KNOWN }} title={`known ${bar.known}`} />}
            {(bar.identified ?? 0) > 0 && <span className="pr-meter__seg" style={{ flexGrow: bar.identified, background: IDENTIFIED }} title={`identified ${bar.identified}`} />}
            {bar.none > 0 && <span className="pr-meter__seg" style={{ flexGrow: bar.none, background: NONE }} title={`none ${bar.none}: nothing found in what Drift read`} />}
            {bar.unknown > 0 && <span className="pr-meter__seg is-unknown" style={{ flexGrow: bar.unknown }} title={`unknown ${bar.unknown}`} />}
          </>
        )}
        <span className="pr-meter__target" style={{ left: `${bar.target * 100}%` }} />
      </div>
      {!compact && (
        <div className="dui-legend" aria-hidden="true">
          <span className="dui-legend__item">
            <span className="dui-legend__swatch" style={{ background: KNOWN }} />
            known <b>{num(bar.known)}</b> {pct(bar.knownShare)}
          </span>
          {(bar.identified ?? 0) > 0 && (
            <span className="dui-legend__item">
              <span className="dui-legend__swatch" style={{ background: IDENTIFIED }} />
              identified <b>{num(bar.identified ?? 0)}</b> {pct(bar.identifiedShare)}
            </span>
          )}
          <span className="dui-legend__item">
            <span className="dui-legend__swatch" style={{ background: NONE }} />
            none <b>{num(bar.none)}</b> {pct(bar.noneShare)} in what Drift read
          </span>
          <span className="dui-legend__item">
            <span className="dui-legend__swatch is-unknown" />
            unknown <b>{num(bar.unknown)}</b> {pct(bar.unknownShare)}
          </span>
          <span className="dui-legend__item">
            <span className="pr-meter__tick" />
            target {pct(bar.target)}
            {bar.atTarget ? " · reached" : ` · ${num(bar.toTarget)} more to classify`}
          </span>
        </div>
      )}
    </div>
  );
}

function ConcernDetail({ scope, target }: { scope: ConcernScope; target: number }) {
  const c = scope.concern;
  const [active, setActive] = useState<string | null>(null);
  const sel = scope.variants.find((r) => r.variant.id === active) ?? scope.variants[0] ?? null;
  const cmp = scope.package === null ? comparison(c) : null;
  // Groups first (variants sharing their instrument, Drift's own rows); the variant table is the drill-down.
  const groups = groupsOf(c, scope.package);
  const [mode, setMode] = useState<"groups" | "variants">("groups");
  const shown = groups ? mode : "variants";
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const selGroup = groups?.find((g) => g.id === activeGroup) ?? groups?.[0] ?? null;
  const drill = (variantId: string) => {
    setActive(variantId);
    setMode("variants");
  };
  return (
    <>
      <section className="pr-variants st-scroll" aria-label={`${c.title}: variants`}>
        <div className="st-pad st-stack">
          <div>
            <h2 className="pr-title">
              {c.title} {isPreview(c.id) && <Tag>preview</Tag>}
            </h2>
            <p className="t-secondary t-body-sm">
              {num(scope.counts.total)} {unitWord(c.unit, scope.counts.total)}
              {scope.package !== null ? ` in ${pkgLabel(scope.package)}` : ""}, {pct(scope.bar.coverage)} described (target {pct(target)}).
              {isPreview(c.id) ? " A preview: a recipe adds only what at least 60% of the package does, and a file's card what the file does, each marked as a preview." : ""}
              {scope.package === null && c.population.left_out.tests + c.population.left_out.non_production > 0
                ? ` Left out: ${num(c.population.left_out.tests)} in tests, ${num(c.population.left_out.non_production)} outside production code.`
                : ""}
            </p>
          </div>
          <CoverageMeter bar={scope.bar} label={`${c.title} coverage`} />
          {groups && (
            <SegmentedControl<"groups" | "variants">
              label="Rows"
              size="sm"
              value={shown}
              onValueChange={setMode}
              items={[
                { value: "groups", label: `By shared instrument (${groups.length})` },
                { value: "variants", label: `Every variant (${scope.variants.length})` },
              ]}
            />
          )}
          {shown === "groups" && groups ? (
            <ol className="pr-stack" aria-label="Variants grouped by the instrument they share">
              {groups.map((g) => (
                <li key={g.id}>
                  <GroupRow c={c} g={g} selected={g === selGroup} onSelect={() => setActiveGroup(g.id)} onDrill={drill} />
                </li>
              ))}
            </ol>
          ) : scope.variants.length === 0 ? (
            <EmptyState icon="info" title="No variant is known here">
              Every unit is unknown: what it does cannot be told yet. The reasons are below.
            </EmptyState>
          ) : (
            <ol className="pr-stack" aria-label="Variants by share">
              {scope.variants.map((r) => (
                <li key={r.variant.id}>
                  <button type="button" className={`pr-variant${r === sel ? " is-selected" : ""}${r.variant.kind === "none" ? " is-none" : ""}`} aria-pressed={r === sel} onClick={() => setActive(r.variant.id)}>
                    <span className="pr-variant__letter" aria-hidden="true">
                      {letterOf(c, r.variant.id)}
                    </span>
                    <span className="pr-variant__label">
                      {r.variant.kind === "none" ? noneText(r.variant.label, r.variant.not_read).replace(/^none: /, "") : r.variant.label}
                      {r.variant.kind === "none" && <Tag>none</Tag>}
                      {r.variant.kind === "identified" && <Tag tone="warning">identified</Tag>}
                      {r.variant.source === "declared" && <Tag tone="info">declared</Tag>}
                      {r.variant.alternatives?.length ? <Tag tone="info">split policy</Tag> : null}
                    </span>
                    <span className="pr-variant__track" aria-hidden="true">
                      <span className="pr-variant__fill" style={{ width: `${r.share * 100}%`, background: r.variant.kind === "none" ? NONE : r.variant.kind === "identified" ? IDENTIFIED : KNOWN }} />
                    </span>
                    <span className="pr-variant__num">
                      <b>{pct(r.share)}</b> <span className="t-muted">{num(r.members)}</span>
                    </span>
                    <span className="pr-variant__hint t-caption t-muted">{variantHint(r.variant)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {cmp && <Compare c={c} cmp={cmp} />}
          <Unknown c={c} scope={scope} />
        </div>
      </section>
      <aside className="pr-detail st-scroll" aria-label={shown === "groups" ? "Group" : "Variant"}>
        {shown === "groups" && selGroup ? <GroupDetail c={c} g={selGroup} onDrill={drill} /> : sel ? <VariantDetail c={c} v={sel.variant} pkg={scope.package} /> : <EmptyState title="No variant to show" />}
      </aside>
    </>
  );
}

/** One group: the instrument its variants share, its share, and its top sub-variants (each a way into the variant table). */
function GroupRow({ c, g, selected, onSelect, onDrill }: { c: PracticeConcern; g: PracticeGroup; selected: boolean; onSelect(): void; onDrill(id: string): void }) {
  const more = groupMore(g);
  return (
    <div className={`pr-group${selected ? " is-selected" : ""}${g.kind === "none" ? " is-none" : ""}`}>
      <button type="button" className="pr-variant pr-group__head" aria-pressed={selected} onClick={onSelect}>
        <span className="pr-variant__letter" aria-hidden="true">
          {g.variants > 1 ? g.variants : "1"}
        </span>
        <span className="pr-variant__label">
          {g.label}
          {g.kind === "none" && <Tag>none</Tag>}
          {g.kind === "identified" && <Tag tone="warning">identified</Tag>}
          {g.class && <Tag tone="info">{g.class}</Tag>}
        </span>
        <span className="pr-variant__track" aria-hidden="true">
          <span className="pr-variant__fill" style={{ width: `${g.share * 100}%`, background: g.kind === "none" ? NONE : g.kind === "identified" ? IDENTIFIED : KNOWN }} />
        </span>
        <span className="pr-variant__num">
          <b>{pct(g.share)}</b> <span className="t-muted">{num(g.members)}</span>
        </span>
        <span className="pr-variant__hint t-caption t-muted">{groupHint(g)}</span>
      </button>
      {g.variants > 1 && (
        <ul className="pr-group__subs">
          {g.top.map((t) => {
            const row = c.variants.some((v) => v.id === t.id);
            return (
              <li key={t.id}>
                {row ? (
                  <button type="button" className="st-link" onClick={() => onDrill(t.id)} title="Open it in the variant table">
                    {t.label}
                  </button>
                ) : (
                  <span title="In the tail: too few members for a row of its own">{t.label}</span>
                )}
                <span className="t-muted t-caption">{num(t.members)}</span>
              </li>
            );
          })}
          {more > 0 && <li className="t-muted t-caption">and {num(more)} more</li>}
        </ul>
      )}
    </div>
  );
}

function GroupDetail({ c, g, onDrill }: { c: PracticeConcern; g: PracticeGroup; onDrill(id: string): void }) {
  return (
    <div className="st-pad st-stack">
      <div>
        <div className="st-row st-wrap">
          <Tag tone={g.kind === "known" ? "accent" : undefined}>{g.kind}</Tag>
          {g.class && <Tag tone="info">{g.class}</Tag>}
          <span className="dui-mono t-muted t-caption">{g.id}</span>
        </div>
        <h3 className="pr-detail__title">{g.label}</h3>
        <p className="t-secondary t-body-sm">
          {num(g.members)} of {num(c.population.total)} {unitWord(c.unit, c.population.total)} ({pct(g.share)}), {num(g.variants)} {g.variants === 1 ? "variant" : "variants"}.
        </p>
      </div>
      <KeyValue
        items={[
          { key: "Shared instrument", value: g.instrument ? <span className="dui-mono">{g.instrument}</span> : <span className="t-muted">{g.kind === "none" ? "none: nothing found in what Drift read" : "none shared (the tail)"}</span> },
          { key: "Applied by", value: g.mechanisms.length ? g.mechanisms.join(", ") : <span className="t-muted">–</span> },
          ...(g.class ? [{ key: "Callers", value: g.class }] : []),
        ]}
      />
      <Panel title="Sub-variants" subtitle="The top ways inside the group, by members">
        <ul className="st-plainlist t-body-sm">
          {g.top.map((t) => (
            <li key={t.id}>
              {c.variants.some((v) => v.id === t.id) ? (
                <button type="button" className="st-link" onClick={() => onDrill(t.id)}>
                  {t.label}
                </button>
              ) : (
                t.label
              )}{" "}
              <span className="t-muted">· {num(t.members)}</span>
            </li>
          ))}
          {groupMore(g) > 0 && <li className="t-muted t-caption">and {num(groupMore(g))} more in the variant table</li>}
        </ul>
      </Panel>
      {g.examples.length > 0 && (
        <Panel title="Examples">
          <Examples compact items={g.examples} context={(e) => ({ title: g.label, detail: `${c.title}: ${e.symbol}`, tone: g.kind === "none" ? "info" : "accent" })} />
        </Panel>
      )}
    </div>
  );
}

function Compare({ c, cmp }: { c: PracticeConcern; cmp: NonNullable<ReturnType<typeof comparison>> }) {
  return (
    <Panel title="Across packages" subtitle={c.divergence.length ? `${c.divergence.length} ${c.divergence.length === 1 ? "package does" : "packages do"} it another way than the repository's dominant variant` : "Each package's share of every variant"} padded={false}>
      <div className="pr-compare" role="region" aria-label={`${c.title} across packages`} tabIndex={0}>
        <table className="pr-table">
          <caption className="dui-sr">{c.title}: each package's share of every variant</caption>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col" className="is-num">
                Units
              </th>
              <th scope="col" className="is-num">
                Covered
              </th>
              {cmp.variants.map((v) => (
                <th key={v.id} scope="col" className="is-num" title={v.label}>
                  {letterOf(c, v.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.package} className={r.divergent ? "is-divergent" : undefined}>
                <th scope="row" className="dui-mono">
                  {pkgLabel(r.package)}
                </th>
                <td className="is-num">{num(r.total)}</td>
                <td className="is-num">{pct(r.coverage)}</td>
                {cmp.variants.map((v) => (
                  <td key={v.id} className={`is-num${r.divergent?.dominant === v.id ? " is-dominant" : ""}`}>
                    {r.members[v.id] ? pct(r.shares[v.id]) : <span className="t-muted">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.divergence.length > 0 && (
        <ul className="st-plainlist st-pad t-body-sm">
          {c.divergence.map((d) => (
            <li key={d.package}>
              <Icon name="attention" size={12} className="t-warning" /> <span className="dui-mono">{pkgLabel(d.package)}</span> mostly does {variantName(c, d.dominant)} ({num(d.members)}), where the repository mostly does {variantName(c, d.repo_dominant)}.
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Unknown({ c, scope }: { c: PracticeConcern; scope: ConcernScope }) {
  const n = scope.counts.unknown;
  if (n === 0) return null;
  const ex = examplesIn(c.unknown.examples, scope.package);
  return (
    <Panel title={`Unknown (${num(n)})`} subtitle="Counted against coverage, never as a variant: what Drift could not tell, and why" className="pr-unknown">
      {scope.package !== null && <p className="t-caption t-muted">Reasons and instruments are for the whole repository ({num(c.unknown.members)} unknown).</p>}
      <ul className="pr-reasons">
        {c.unknown.reasons.map((r) => {
          const why = unknownReason(r.reason);
          return (
            <li key={r.reason}>
              <span className="pr-reasons__n">{num(r.members)}</span>
              <span>
                <b>{why.label}</b> <span className="t-muted t-body-sm">{why.hint}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {c.unknown.instruments.length > 0 && (
        <>
          <div className="dui-overline">Instruments not classified</div>
          <ul className="st-plainlist t-body-sm pr-instruments">
            {c.unknown.instruments.map((i) => (
              <li key={i.instrument}>
                <span className="dui-mono">{i.instrument}</span> <span className="t-muted">· {num(i.members)}</span>
                {i.config_hint && <ConfigHint hint={i.config_hint} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {ex.length > 0 && (
        <>
          <div className="dui-overline">Examples</div>
          <Examples items={ex} context={(e) => ({ title: `${c.title}: unknown`, detail: `${e.symbol}: Drift cannot tell what it does for ${c.title.toLowerCase()}`, tone: "warning" })} />
        </>
      )}
    </Panel>
  );
}

function VariantDetail({ c, v, pkg }: { c: PracticeConcern; v: PracticeVariant; pkg: string | null }) {
  const d = dominantOf(c);
  const ex = examplesIn(v.examples, pkg);
  const exc = examplesIn(v.exceptions, pkg);
  return (
    <div className="st-pad st-stack">
      <div>
        <div className="st-row st-wrap">
          <span className="pr-variant__letter">{letterOf(c, v.id)}</span>
          <Tag tone={v.kind === "known" ? "accent" : undefined}>{v.kind}</Tag>
          <Tag>{v.source}</Tag>
          <span className="dui-mono t-muted t-caption">{v.id}</span>
        </div>
        <h3 className="pr-detail__title">{v.kind === "none" ? noneText(v.label, v.not_read) : v.label}</h3>
        {v.kind === "none" && (
          <p className="t-secondary t-body-sm">
            Nothing found in what Drift read, not a fact about the code.{" "}
            {v.not_read?.length ? <>Seen and not read: <span className="dui-mono">{v.not_read.map(notReadShort).join(", ")}</span>.</> : "Drift lists nothing it saw and did not read; that is no proof either."}
          </p>
        )}
        {v.kind === "identified" && <p className="t-secondary t-body-sm">The caller is identified and no one is turned away: no guard. Never a way to copy.</p>}
        <p className="t-secondary t-body-sm">
          {num(v.members)} of {num(c.population.total)} {unitWord(c.unit, c.population.total)} ({pct(v.share)}) in the repository{d && d.id === v.id ? ": the dominant way" : ""}.
        </p>
        {v.key && <code className="st-cmd pr-key">{v.key}</code>}
      </div>
      {v.alternatives?.length ? (
        <Panel title="A split policy" subtitle="Any of these, counted as one way; each alternative's own share">
          <ul className="st-plainlist t-body-sm">
            {v.alternatives.map((a) => (
              <li key={a.id}>
                {a.label} <span className="t-muted">· {num(a.members)} ({pct(a.share)})</span>
                {a.where.dirs[0] && <span className="t-muted t-caption"> · mostly {a.where.dirs[0].dir}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel title="Where" subtitle={pkg !== null ? "For the whole repository" : undefined}>
        <KeyValue
          items={[
            { key: "Packages", value: list(v.where.packages.map((p) => `${pkgLabel(p.package)} ${p.members} (${pct(p.share_of_package)} of it)`)), mono: true },
            { key: "Directories", value: list(v.where.dirs.map((x) => `${x.dir} ${x.members}`)), mono: true },
            { key: "Roles", value: list(v.where.roles.map((x) => `${x.role} ${x.members}`)), mono: true },
            { key: "Entry kinds", value: list(v.where.entry_kinds.map((x) => `${x.kind} ${x.members}`)) },
            { key: "Methods", value: list(v.where.methods.map((x) => `${x.method} ${x.members}`)) },
          ]}
        />
      </Panel>
      <Panel title="What sets it apart" subtitle={d && d.id !== v.id ? `Against ${letterOf(c, d.id)} ${d.label}, the dominant variant` : "Against the rest of the population"}>
        {v.sets_apart.length ? (
          <ul className="pr-apart">
            {v.sets_apart.map((s) => (
              <li key={s.attribute}>
                <span>{setsApartText(c, v, s)}</span>
                <span className="t-caption t-muted">
                  separation {s.separation.toFixed(2)} · purity {pct(s.purity)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-muted t-body-sm">Nothing sets it apart: it is spread like the rest.</p>
        )}
        <p className="t-caption t-muted">A property of the counts, not a verdict.</p>
      </Panel>
      <Panel title="Examples" subtitle="Members to copy, closest to the variant's most common place">
        {ex.length ? <Examples items={ex} context={(e) => ({ title: `${letterOf(c, v.id)} ${v.label}`, detail: `${c.title}: ${e.symbol}`, tone: v.kind === "none" ? "info" : "accent" })} /> : <p className="t-muted t-body-sm">No example in {pkg !== null ? pkgLabel(pkg) : "the repository"} among the ones Drift lists.</p>}
      </Panel>
      {exc.length > 0 && (
        <Panel title={`Exceptions (${num(exc.length + (pkg !== null ? 0 : v.exceptions_more))})`} subtitle="Units in this variant's places that do it another way">
          <Examples items={exc} label={(e) => variantName(c, (e as PracticeExample & { variant: string }).variant)} context={(e) => ({ title: `Does it another way: ${variantName(c, (e as PracticeExample & { variant: string }).variant)}`, detail: `where ${v.label} is the rule of the place`, tone: "warning" })} />
          {pkg === null && v.exceptions_more > 0 && <p className="t-caption t-muted">and {num(v.exceptions_more)} more</p>}
        </Panel>
      )}
      {v.conventions.length > 0 && (
        <Panel title="Conventions that say the same" subtitle="Review decides what is a rule; this view changes nothing">
          <ul className="st-plainlist t-body-sm">
            {v.conventions.map((x) => (
              <li key={x.id}>
                <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", x.id)}>
                  {x.id}
                </button>{" "}
                {x.status}
                {x.status === "accepted" ? ` (${x.mode === "block" ? "blocks" : "advises"})` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Examples({ items, context, label, compact = false }: { items: PracticeExample[]; context(e: PracticeExample): { title: string; detail?: string; tone?: "danger" | "warning" | "info" | "accent" }; label?(e: PracticeExample): string; compact?: boolean }) {
  const openCode = useOpenCode();
  return (
    <ul className={`st-outliers${compact ? " pr-examples--compact" : ""}`}>
      {items.map((e) => (
        <li key={`${e.path}#${e.symbol}:${e.line}`}>
          <button type="button" className="st-pathlink pr-example" onClick={() => openCode({ path: e.path, line: e.line, context: context(e) })}>
            <span className="dui-mono pr-example__path">{e.path}</span>
            <span className="pr-example__what">
              <span className="dui-mono">
                {e.symbol}:{e.line}
              </span>
              {label && <span className="t-muted t-caption">{label(e)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Gaps({ rows, target, notCovered }: { rows: ConcernScope[]; target: number; notCovered: string[] }) {
  const g = gaps(rows);
  return (
    <div className="pr-gaps st-pad">
      <div className="dui-overline">Gaps</div>
      {g.length === 0 ? (
        <p className="t-body-sm t-muted">Every concern shown is at the {pct(target)} target.</p>
      ) : (
        <ul className="st-plainlist t-body-sm">
          {g.map((r) => (
            <li key={r.concern.id}>
              <button type="button" className="st-link" onClick={() => navigate("practices", "concerns", { concern: r.concern.id })}>
                {r.concern.title}
              </button>{" "}
              {pct(r.bar.coverage)}: {num(r.counts.unknown)} unknown, {num(r.bar.toTarget)} to classify for {pct(target)}
            </li>
          ))}
        </ul>
      )}
      {notCovered.length > 0 && <p className="t-caption t-muted">Not described by this Drift yet: {notCovered.join("; ")}.</p>}
    </div>
  );
}

function list(xs: string[]) {
  return xs.length ? xs.join(", ") : <span className="t-muted">–</span>;
}

/** The population's unit in words: `entry_point` -> entry points. */
function unitWord(unit: string, n: number): string {
  const w = unit.replace(/_/g, " ");
  return n === 1 ? w : w.endsWith("s") ? w : `${w}s`;
}
