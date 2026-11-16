// `drift check`: the verdict first (does it fail, and why), then one status
// ledger (new and blocks, new and advises, suppressed, baselined, fixed) that
// also filters, then the violations with a detail pane that puts the violating
// code beside the file Drift tells agents to copy (`drift example`).
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, CodeView, EmptyState, ErrorState, EvidenceChip, Icon, SearchInput, SegmentedControl, Skeleton, StateLabel, Tag, TierBadge, inTextField, langOf, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useCheck, useFacts } from "@/entities/drift";
import { DiffScope, type ViolationStatus, VIOLATION_STATUS, byConvention, byFile, checkCounts, exemptions, filterExemptions, holdOf, neighbourHolds, parseEvidence, splitExample, stateOf, statusOf, suppressionReason, useDiffScope } from "@/entities/check";
import { symbolLine, useFactsIndex } from "@/entities/facts";
import { checkTierReasonText, exemptionKind, exemptionKinds, languageText, wireAt, wireFix, wireTitle } from "@/entities/convention";
import { useApi } from "@/shared/api";
import type { CheckConvention, CheckExemption, DiffInfo, NeighbourHold, PracticeDeparture, PracticeNotChecked, StalePractice, Violation } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";
import { num, plural } from "@/shared/lib/format";
import { mdCode, mdTable } from "@/shared/lib/markdown";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";
import { MarkControl } from "@/entities/feedback";
import { PromoteHint, SecurityAdviceSection, StandingSection } from "./Basis";

const PAGE = 100;
const LEDGER: ViolationStatus[] = ["block", "advise", "held", "unsure", "suppressed", "baselined", "fixed"];

function useSource(path: string | null) {
  const api = useApi();
  const { repo } = useRepo();
  return useQuery({ queryKey: ["source", repo?.path, path], enabled: !!repo && !!path, staleTime: 60_000, queryFn: () => api.readSource(repo!, path!) });
}

export function CheckView() {
  const { repo } = useRepo();
  // Scope: the whole repository, or what a branch introduces since its merge base with `base` (PR mode).
  const scope = useDiffScope(repo?.path);
  const base = scope.base;
  const check = useCheck(repo, true, base);
  const openCode = useOpenCode();
  const toast = useToast();
  const [mode, setMode] = useState<"convention" | "file">("convention");
  const [shown, setShown] = useState<Set<ViolationStatus>>(new Set(["block", "advise", "held", "unsure", "suppressed"]));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});

  const report = check.data?.data;
  const filtered = useMemo(() => {
    if (!report) return [];
    const needle = q.trim().toLowerCase();
    return report.violations.filter((v) => shown.has(statusOf(v)) && (!needle || [v.path, v.id, v.symbol, v.summary].some((x) => x.toLowerCase().includes(needle))));
  }, [report, shown, q]);
  const groups = useMemo(() => (mode === "convention" ? byConvention(filtered) : byFile(filtered)), [filtered, mode]);
  const openSet = useMemo(() => open ?? new Set(groups.filter((g) => g.counts.new > 0 || groups.length <= 6).map((g) => g.key)), [open, groups]);
  // Keyboard: j/k move through visible violations (the detail follows), Enter opens the code, c the convention.
  const visible = useMemo(() => groups.filter((g) => openSet.has(g.key)).flatMap((g) => g.items.slice(0, limits[g.key] ?? PAGE)), [groups, openSet, limits]);
  const [cursor, setCursor] = useState(0);
  const current = visible[Math.min(cursor, visible.length - 1)] ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']") || !visible.length) return;
      if (e.key === "j") setCursor((c) => Math.min(visible.length - 1, c + 1));
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON" && current) open1(current);
      else if (e.key === "c" && current) navigate("conventions", current.id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scopeBar = <DiffScope scope={scope} tool="drift check" command={(b) => `drift check --format json${b ? ` --diff-base ${b}` : ""}`} onApply={() => setCursor(0)} />;

  if (check.isLoading) return <Loading label={base ? `Running drift check --diff-base ${base}` : "Running drift check"} />;
  if (check.error) {
    const msg = check.error instanceof Error ? check.error.message : String(check.error);
    if (base)
      return (
        <div className="st-page ck">
          {scopeBar}
          <ErrorState title={`drift check --diff-base ${base} failed`} error={check.error} onRetry={() => void check.refetch()}>
            The base must be a git ref in this repository, with full history (a shallow clone has no merge base).
          </ErrorState>
        </div>
      );
    // Only Drift's "no .drift/conventions.yaml: run `drift init` first": a policy it cannot read (a hand edit that broke
    // it, a parse error) is an error to show as Drift said it, not a repository with no policy yet.
    if (/no \.drift\/conventions\.yaml|run `?drift init`? first/.test(msg))
      return (
        <EmptyState icon="review" title={t("conventions.noPolicy")} action={<Button onClick={() => navigate("conventions")}>Go to Conventions</Button>}>
          drift check needs accepted conventions. {t("conventions.noPolicyBody")}
        </EmptyState>
      );
    return <ErrorState title="drift check failed" error={check.error} onRetry={() => void check.refetch()} />;
  }
  if (!report) return null;
  const c = checkCounts(report);
  const counts: Record<ViolationStatus, number> = { block: c.blocking, advise: c.new - c.blocking, held: c.held, unsure: c.unsure, suppressed: c.suppressed, baselined: c.baselined, fixed: c.fixed };
  const unchecked = report.unchecked ?? [];
  const fails = c.blocking > 0;
  const diff = report.diff ?? null;
  const exempt = exemptions(report);
  const holds = neighbourHolds(report);
  /** How the neighbour gate was set for this run (off, the default, unless DRIFT_NEIGHBOUR_GATE=on); unknown from an older Studio main process. */
  const gate = check.data?.provenance.neighbourGate ?? null;

  const toggle = (s: ViolationStatus) => {
    const next = new Set(shown);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setShown(next);
    setCursor(0);
  };
  function open1(v: Violation) {
    openCode({
      path: v.path,
      line: v.line,
      context: { title: `${v.id}: ${v.summary}`, detail: `${VIOLATION_STATUS[statusOf(v)].label} · evidence ${v.evidence} · copy ${v.example}`, tone: stateOf(v) === "new" ? (v.mode === "block" ? "danger" : "warning") : "info" },
    });
  }
  const exportMd = () => {
    const newOnes = report.violations.filter((v) => stateOf(v) === "new");
    const md = [
      `**drift check${diff ? ` --diff-base ${diff.base}` : ""}**: ${c.new} new violation(s), ${c.blocking} blocking, ${c.baselined} baselined, ${c.suppressed} suppressed${holds.length ? `, ${holds.length} held back by the neighbour gate` : ""}${diff ? ` (${diff.new_outside_diff} more outside the diff)` : ""}`,
      "",
      mdTable(
        ["Convention", "Where", "Mode"],
        newOnes.map((v) => [mdCode(v.id), mdCode(`${v.path}:${v.line} ${v.symbol}`), v.mode]),
      ),
      ...(holds.length
        ? [
            "",
            `**Held back by the neighbour gate**: ${holds.length} warning(s) nearer the members their convention sets apart than its holders`,
            "",
            mdTable(
              ["Member", "Convention", "Nearest set apart", "Nearest holder"],
              holds.map((h) => [mdCode(`${h.path}:${h.line} ${h.symbol}`), mdCode(h.id), `${mdCode(h.nearest_apart)} (${h.apart_code}, ${h.apart_distance.toFixed(3)})`, `${mdCode(h.nearest_holder)} (${h.holder_distance.toFixed(3)})`]),
            ),
          ]
        : []),
      ...(exempt.length
        ? [
            "",
            `**Not checked (exempt)**: ${exempt.length} member(s) their convention is not about`,
            "",
            mdTable(
              ["Member", "Convention", "Kind", "Reason"],
              exempt.map((e) => [mdCode(`${e.path}:${e.line} ${e.symbol}`), mdCode(e.id), exemptionKind(e.code)?.label ?? "", e.reason]),
            ),
          ]
        : []),
    ].join("\n");
    void navigator.clipboard?.writeText(md);
    toast.show({ title: t("common.copied"), body: "Check report copied as Markdown", tone: "success", duration: 2000 });
  };

  return (
    <div className="st-page ck">
      <header className={`ck-verdict${fails ? " is-fail" : c.new ? " is-advise" : " is-pass"}`}>
        <div className="dui-overline">drift check</div>
        <div className="ck-verdict__line">
          <StateLabel tone={fails ? "danger" : c.new ? "warning" : "success"} icon={fails ? "blocked" : c.new ? "attention" : "ok"}>
            {fails ? "Fails" : unchecked.length ? "Passes the files checked" : "Passes"}
          </StateLabel>
          <span className="ck-verdict__num">{num(c.new)}</span>
          <span className="ck-verdict__text">
            new {c.new === 1 ? "violation" : "violations"}
            {c.new > 0 && <>, {num(c.blocking)} in block mode</>}
          </span>
          {gate === "on" && (
            <Badge tone="info" variant="outline" icon="info" className="ck-gate" title="DRIFT_NEIGHBOUR_GATE=on in the environment the Studio was started from, as for the hooks and the CLI there: a new warning nearer the members its convention sets apart than its holders is held back (listed, never new). Off by default; not admitted until dev4 measures it.">
              neighbour gate on
            </Badge>
          )}
        </div>
        <p className="t-secondary">
          {fails ? "Exit code 1: block-mode violations fail drift check in CI and stop agents at the end of a turn." : c.new ? "Exit code 0: new violations are advice in CI and to agents." : t("check.cleanBody")}
          {c.new > 0 && " Legacy code is baselined in drift.lock and never fails."}
          {holds.length > 0 && (
            <>
              {" "}
              <button type="button" className="st-link" onClick={() => document.getElementById("ck-held")?.scrollIntoView({ block: "center" })}>
                {plural(holds.length, "warning", "warnings")} held back
              </button>
              {" "}by the neighbour gate: never new, never failing.
            </>
          )}
          {exempt.length > 0 && (
            <>
              {" "}
              <button type="button" className="st-link" onClick={() => document.getElementById("ck-exempt")?.scrollIntoView({ block: "center" })}>
                {plural(exempt.length, "member", "members")} not checked
              </button>
              : their convention is not about {exempt.length === 1 ? "it" : "them"}.
            </>
          )}
        </p>
        {unchecked.length > 0 && <UncheckedNote paths={unchecked} />}
        {diff && <DiffLine d={diff} />}
      </header>

      {scopeBar}

      <div className="ck-ledger" role="group" aria-label="Show violations by status">
        {LEDGER.map((s) => {
          const ui = VIOLATION_STATUS[s];
          return (
            <button
              key={s}
              type="button"
              className={`ck-key is-${ui.tone}`}
              aria-pressed={s === "fixed" ? undefined : shown.has(s)}
              onClick={() => (s === "fixed" ? document.getElementById("ck-fixed")?.scrollIntoView({ block: "center" }) : toggle(s))}
            >
              <StateLabel tone={ui.tone} icon={ui.icon}>
                {ui.label}
              </StateLabel>
              <span className="ck-key__num">{num(counts[s])}</span>
              <span className="ck-key__hint">{ui.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="st-toolbar">
        <SegmentedControl
          label="Group by"
          size="sm"
          value={mode}
          onValueChange={(v) => {
            setMode(v);
            setOpen(null);
          }}
          items={[
            { value: "convention", label: t("check.byConvention") },
            { value: "file", label: t("check.byFile") },
          ]}
        />
        <span className="st-grow" />
        <SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Filter by path, id or rule" label="Filter violations" />
        <Button size="sm" variant="ghost" icon="copy" onClick={exportMd}>
          {t("common.exportMd")}
        </Button>
      </div>

      <div className="ck-body">
        <div className="ck-list">
          {groups.length === 0 ? (
            <EmptyState icon="filter" title={shown.size ? "No violations with these statuses" : "Choose a status above"} />
          ) : (
            <div className="st-groups">
              {groups.map((g) => {
                const isOpen = openSet.has(g.key);
                const limit = limits[g.key] ?? PAGE;
                return (
                  <section key={g.key} className="st-group" aria-label={g.title}>
                    <button
                      type="button"
                      className="st-group__head"
                      aria-expanded={isOpen}
                      onClick={() => {
                        const next = new Set(openSet);
                        if (isOpen) next.delete(g.key);
                        else next.add(g.key);
                        setOpen(next);
                      }}
                    >
                      <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} />
                      {mode === "convention" ? <Tag>{g.title}</Tag> : <span className="dui-mono t-truncate">{g.title}</span>}
                      {g.detail && <span className="t-truncate st-group__detail">{g.detail}</span>}
                      <span className="st-grow" />
                      <span className="ck-counts t-caption">
                        {g.counts.new > 0 && <span className={g.mode === "block" ? "t-danger" : "t-warning"}>{g.counts.new} new</span>}
                        {g.counts.held > 0 && <span className="t-secondary">{g.counts.held} held back</span>}
                        {g.counts.unsure > 0 && <span className="t-secondary">{g.counts.unsure} unsure</span>}
                        {g.counts.suppressed > 0 && <span className="t-secondary">{g.counts.suppressed} suppressed</span>}
                        {g.counts.baselined > 0 && <span className="t-muted">{g.counts.baselined} baselined</span>}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="st-vlist">
                        {g.items.slice(0, limit).map((v) => {
                          const s = VIOLATION_STATUS[statusOf(v)];
                          const i = visible.indexOf(v);
                          return (
                            <li key={`${v.id}|${v.path}|${v.symbol}`}>
                              <button
                                type="button"
                                className={`st-vrow${v === current ? " is-cursor" : ""}`}
                                aria-current={v === current ? "true" : undefined}
                                onClick={() => i >= 0 && setCursor(i)}
                                onDoubleClick={() => open1(v)}
                              >
                                <StateLabel tone={s.tone} icon={s.icon}>
                                  {s.label}
                                </StateLabel>
                                {mode === "file" && <Tag>{v.id}</Tag>}
                                <span className="dui-mono t-truncate">
                                  {mode === "convention" ? v.path : ""}
                                  <span className="t-muted">:{v.line}</span>
                                </span>
                                <span className="dui-mono t-accent">{v.symbol}</span>
                                {v.wire && <Tag className="ck-wiretag">{wireTitle(v.wire)}</Tag>}
                              </button>
                            </li>
                          );
                        })}
                        {g.items.length > limit && (
                          <li>
                            <Button size="sm" variant="ghost" onClick={() => setLimits({ ...limits, [g.key]: limit + PAGE * 5 })}>
                              Show {Math.min(PAGE * 5, g.items.length - limit)} more of {g.items.length - limit}
                            </Button>
                          </li>
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {(report.standing || (report.conventions && !report.conventions.some((k) => k.status === "accepted" && k.rule_kind !== "practice"))) && <StandingSection rows={report.standing ?? []} summaries={new Map(report.violations.map((v) => [v.id, v.summary]))} onConvention={(id) => navigate("conventions", id)} />}
          {(diff || report.security) && (
            <SecurityAdviceSection
              advice={report.security_advice ?? []}
              ratchet={report.security}
              onOpen={(path, line, a) => openCode({ path, line: line ?? undefined, context: { title: `${a.kind}: ${a.key}`, detail: a.read, tone: a.kind === "unscoped-key" ? "warning" : "danger" } })}
              onSecurity={() => navigate("security")}
            />
          )}
          {(report.practices?.departures.length ?? 0) > 0 && <DepartSection departures={report.practices!.departures} />}
          {(report.stale_practices?.length ?? 0) > 0 && <StalePracticesSection stale={report.stale_practices!} />}
          {(report.practices_not_checked?.length ?? 0) > 0 && <PracticesNotCheckedSection rows={report.practices_not_checked!} />}
          {holds.length > 0 && <HeldSection holds={holds} />}
          {exempt.length > 0 && <ExemptSection exempt={exempt} q={q} />}
          <section id="ck-fixed" className="ck-fixed" aria-label="Fixed lock entries">
            <div className="st-row st-wrap">
              <StateLabel tone="success" icon="ok">
                fixed
              </StateLabel>
              <span className="t-caption t-muted">{report.fixed.length ? t("check.fixed", { n: report.fixed.length }) : "No drift.lock entry is fixed yet: every baselined violation still exists."}</span>
            </div>
            {report.fixed.length > 0 && <pre className="dui-mono ck-fixed__list">{report.fixed.join("\n")}</pre>}
          </section>
        </div>
        <aside className="ck-detail" aria-label="Selected violation">
          {current ? (
            <ViolationDetail
              v={current}
              hold={holdOf(holds, current)}
              conv={report.conventions?.find((k) => k.id === current.id) ?? null}
              onOpen={() => open1(current)}
              onRegistry={(w) => openCode({ path: w.path, line: w.line > 0 ? w.line : undefined, context: { title: `${wireTitle(w)}: ${wireFix(w, w.entry?.symbol ?? current.symbol)}`, detail: current.summary, tone: "info" } })}
            />
          ) : (
            <EmptyState icon="violation" title="Select a violation" />
          )}
        </aside>
      </div>
    </div>
  );
}

function ViolationDetail({ v, hold, conv, onOpen, onRegistry }: { v: Violation; hold: NeighbourHold | null; conv: CheckConvention | null; onOpen(): void; onRegistry(w: NonNullable<Violation["wire"]>): void }) {
  const { repo } = useRepo();
  const facts = useFacts(repo);
  const ix = useFactsIndex(facts.data?.data);
  const status = statusOf(v);
  const ui = VIOLATION_STATUS[status];
  const ev = parseEvidence(v.evidence);
  const ex = splitExample(v.example);
  const exLine = ix && ex.symbol ? symbolLine(ix, ex.path, ex.symbol) : null;
  const here = useSource(v.path);
  const wire = v.wire ?? null;
  // A wiring violation (#38): the right pane is the registry to edit, not an example to copy.
  const like = useSource(wire ? wire.path : ex.path || null);
  const reason = status === "suppressed" && here.data ? suppressionReason(here.data, v.line, v.id) : null;
  // The convention's language as check reports it (D7); older drift omits it.
  const lang = languageText(conv?.language ?? null);
  const tierWhy = v.tier === "suggestion" ? checkTierReasonText(conv && conv.tier === v.tier ? conv : null) : null;
  return (
    <div className="ck-detail__inner">
      <div className="st-row st-wrap">
        <StateLabel tone={ui.tone} icon={ui.icon}>
          {ui.label}
        </StateLabel>
        <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", v.id)} title="Open the convention (c)">
          {v.id}
        </button>
        {ev && <EvidenceChip compact holders={ev.holders} total={ev.total} />}
        {v.tier && <TierBadge compact tier={v.tier} reason={tierWhy ?? undefined} />}
        {lang && (
          <Tag className="ck-lang" title={lang.why}>
            {lang.label}
          </Tag>
        )}
      </div>
      <h3 className="ck-detail__title">{v.summary}</h3>
      {tierWhy && (
        <p className="t-caption t-secondary ck-tierwhy">
          A suggestion: {tierWhy}.
        </p>
      )}
      {v.tier === "suggestion" && status === "block" && (
        <p className="ck-note">
          <Icon name="attention" size={13} />
          <span>A suggestion set to block with --force: it fails the check although its evidence is advice-grade.</span>
        </p>
      )}
      {status === "suppressed" && (
        <p className="ck-note is-info">
          <Icon name="info" size={13} />
          <span>
            Suppressed with <span className="dui-mono">drift-ignore</span>
            {reason ? <>: “{reason}”</> : here.isLoading ? "…" : " (no reason found above the declaration)"}
          </span>
        </p>
      )}
      {wire && (
        <p className="ck-note is-info ck-wire">
          <Icon name="info" size={13} />
          <span>
            <strong>{wireTitle(wire)}</strong> (experimental, advice only): {wireFix(wire, wire.entry?.symbol ?? v.symbol)}.
          </span>
        </p>
      )}
      {v.import && (
        <p className="ck-note is-info">
          <Icon name="info" size={13} />
          <span>
            Breaks the rule by importing <span className="dui-mono">{v.import.specifier || v.import.module}</span>
            {v.import.line ? ` (line ${v.import.line})` : ""}.
          </span>
        </p>
      )}
      {status === "held" && (
        <p className="ck-note is-info">
          <Icon name="info" size={13} />
          <span>
            Held back by the neighbour gate: this member is nearer the members its convention sets apart than the ones that hold it, so it is listed, not counted as new, and never fails.
            {hold && (
              <>
                {" "}Nearest set apart <span className="dui-mono">{hold.nearest_apart}</span> ({hold.apart_code === "reviewed" ? "marked fine by a reviewer" : (exemptionKind(hold.apart_code)?.label ?? hold.apart_code)}, distance {hold.apart_distance.toFixed(3)}); nearest holder <span className="dui-mono">{hold.nearest_holder}</span> (distance {hold.holder_distance.toFixed(3)}).
              </>
            )}
          </span>
        </p>
      )}
      {status === "unsure" && (
        <p className="ck-note is-info">
          <Icon name="info" size={13} />
          <span>Unsure: this file depends on a file drift could not parse on this run (no stack large enough could be reserved), so the verdict may change once it is. It is not counted as new and never fails.</span>
        </p>
      )}
      {status === "baselined" && (
        <p className="ck-note">
          <Icon name="dot" size={13} />
          <span>Legacy: recorded in drift.lock when the policy was written. It never fails, and agents are not asked to fix it.</span>
        </p>
      )}
      <div className="ck-pair">
        <figure className="ck-code">
          <figcaption>
            <span className="dui-overline">This code</span>
            <span className="dui-mono t-truncate" title={`${v.path}:${v.line}`}>
              {v.path}:{v.line}
            </span>
          </figcaption>
          {here.data ? (
            <CodeView text={here.data} lang={langOf(v.path)} focusLine={v.line} markers={[{ line: v.line, tone: status === "block" ? "danger" : status === "advise" ? "warning" : "info", label: v.id }]} label={`Source of ${v.path}`} height={220} />
          ) : (
            <Skeleton lines={6} />
          )}
        </figure>
        {wire ? (
          <figure className="ck-code">
            <figcaption>
              <span className="dui-overline">{wire.action === "mirror" ? "Add the key here" : "Register it here"}</span>
              <span className="dui-mono t-truncate" title={wireAt(wire)}>
                {wireAt(wire)} · {wire.label}
              </span>
            </figcaption>
            {like.data ? (
              <CodeView
                text={like.data}
                lang={langOf(wire.path)}
                focusLine={wire.line > 0 ? wire.line : (wire.like?.line ?? null)}
                markers={[
                  ...(wire.line > 0 ? [{ line: wire.line, tone: "info" as const, label: wire.label }] : []),
                  ...(wire.like && wire.like.line > 0 ? [{ line: wire.like.line, tone: "accent" as const, label: `like ${wire.like.name}` }] : []),
                ]}
                label={`Source of ${wire.path}`}
                height={220}
              />
            ) : like.isError ? (
              <p className="t-caption t-muted">The registry file could not be read.</p>
            ) : (
              <Skeleton lines={6} />
            )}
          </figure>
        ) : (
          <figure className="ck-code">
            <figcaption>
              <span className="dui-overline">Copy this (drift example)</span>
              <span className="dui-mono t-truncate" title={v.example}>
                {ex.path}
                {ex.symbol && <span className="t-accent">#{ex.symbol}</span>}
              </span>
            </figcaption>
            {like.data ? (
              <CodeView text={like.data} lang={langOf(ex.path)} focusLine={exLine} markers={exLine ? [{ line: exLine, tone: "accent", label: "example" }] : []} label={`Source of ${ex.path}`} height={220} />
            ) : like.isError ? (
              <p className="t-caption t-muted">The example file could not be read.</p>
            ) : (
              <Skeleton lines={6} />
            )}
          </figure>
        )}
      </div>
      <div className="st-row st-wrap">
        <Button size="sm" icon="code" shortcut="enter" onClick={onOpen}>
          Open code
        </Button>
        {wire && (
          <Button size="sm" variant="secondary" icon="code" className="ck-openreg" onClick={() => onRegistry(wire)}>
            Open {wire.path.split("/").pop()}
            {wire.line > 0 ? ` at line ${wire.line}` : ""}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="review" shortcut="c" onClick={() => navigate("conventions", v.id)}>
          Open convention
        </Button>
      </div>
      <MarkControl key={`${v.id} ${v.path}#${v.symbol}`} id={v.id} member={`${v.path}#${v.symbol}`} />
    </div>
  );
}

/** Files drift check could not read: a pass does not cover them. */
function UncheckedNote({ paths }: { paths: string[] }) {
  return (
    <div className="ck-unchecked" role="note">
      <p className="ck-note">
        <Icon name="attention" size={13} />
        <span>
          <b>
            {num(paths.length)} {paths.length === 1 ? "file was" : "files were"} not checked
          </b>
          : no stack large enough to parse {paths.length === 1 ? "it" : "them"} could be reserved on this run (an address-space or memory limit). Their violations are unknown, not absent; a run with more memory checks them.
        </span>
      </p>
      <ul className="st-plainlist">
        {paths.slice(0, 8).map((p) => (
          <li key={p} className="dui-mono t-body-sm t-truncate" title={p}>
            {p}
          </li>
        ))}
        {paths.length > 8 && <li className="t-caption t-muted">and {num(paths.length - 8)} more</li>}
      </ul>
    </div>
  );
}

/**
 * Warnings the neighbour gate held back (WS-J): each member is nearer the members its convention sets apart than its
 * holders. Counted and listed with both neighbours, never new and never failing; never on an entry point or under a
 * guard or validation rule.
 */
/**
 * What the practice map says of the files the check looked at (`practices.departures`): the concerns a file's entry
 * points do differently from at least 80% of those around them. Drift's facts as it reports them; never a violation,
 * never failing. The Practices view has the whole map.
 */
/** Sorted by convention id, as Drift lists them; a copy so the report is never reordered in place. */
const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Promoted practices none of whose accepted ways any unit of their place uses any more (the guard was renamed or
 * replaced): they report nothing until a person promotes the practice again with the way the code uses now, or rejects
 * the convention. Information, never a failure.
 */
function StalePracticesSection({ stale }: { stale: StalePractice[] }) {
  return (
    <section id="ck-stale-practices" className="ck-exempt ck-stale-practices" aria-labelledby="ck-stale-practices-title">
      <div className="st-row st-wrap">
        <h3 id="ck-stale-practices-title" className="ck-exempt__title">
          <StateLabel tone="info" icon="info">
            Promoted practices that check nothing
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(stale.length)}</span>
        <span className="t-caption t-muted">No unit of the place uses an accepted way any more, so the convention reports nothing. Not a failure.</span>
      </div>
      <ul className="ck-exempt__list" aria-label="Stale promoted practices">
        {byId(stale).map((s) => (
          <li key={s.id} className="ck-exempt__row">
            <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", s.id)}>
              {s.id}
            </button>
            <span className="ck-exempt__reason">
              <span className="t-body-sm">{s.summary}</span>
              <span className="t-caption t-secondary ck-exempt__why">
                {plural(s.units, "unit", "units")} of the concern in its place now, none done an accepted way. Promote the practice again from the{" "}
                <button type="button" className="st-link" onClick={() => navigate("practices")}>
                  practice map
                </button>{" "}
                with the way the code uses now, or reject it: <span className="dui-mono">drift review --reject {s.id}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Per promoted practice, the units of its place the practice map cannot tell: not checked and never reported. Information, never a failure. */
function PracticesNotCheckedSection({ rows }: { rows: PracticeNotChecked[] }) {
  return (
    <section id="ck-practices-not-checked" className="ck-exempt ck-practices-not-checked" aria-labelledby="ck-practices-not-checked-title">
      <div className="st-row st-wrap">
        <h3 id="ck-practices-not-checked-title" className="ck-exempt__title">
          <StateLabel tone="info" icon="info">
            Promoted practices: units Drift could not read
          </StateLabel>
        </h3>
        <span className="t-caption t-muted">Drift cannot tell what these units do for the concern, so it does not check them and never reports them. Not a failure.</span>
      </div>
      <ul className="ck-exempt__list" aria-label="Units of promoted practices not checked">
        {byId(rows).map((r) => (
          <li key={r.id} className="ck-exempt__row">
            <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", r.id)}>
              {r.id}
            </button>
            <span className="t-caption t-secondary">{plural(r.units, "unit", "units")} not checked</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DepartSection({ departures }: { departures: PracticeDeparture[] }) {
  const openCode = useOpenCode();
  const toast = useToast();
  const copy = (command: string) =>
    void navigator.clipboard?.writeText(command).then(
      () => toast.show({ title: "Command copied", body: command, tone: "success", duration: 2500 }),
      () => toast.show({ title: "Could not copy", body: command, tone: "neutral", duration: 5000 }),
    );
  const [limit, setLimit] = useState(PAGE);
  return (
    <section id="ck-practices" className="ck-exempt ck-practices" aria-labelledby="ck-practices-title">
      <div className="st-row st-wrap">
        <h3 id="ck-practices-title" className="ck-exempt__title">
          <StateLabel tone="info" icon="info">
            Practices: done another way here
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(departures.length)}</span>
        <span className="t-caption t-muted">Facts, not rules: a concern these files' entry points do differently from at least 80% of the entry points around them. Never a violation, never failing.</span>
        <button type="button" className="st-link" onClick={() => navigate("practices")}>
          Open Practices
        </button>
      </div>
      <ul className="ck-exempt__list" aria-label="Practice departures">
        {departures.slice(0, limit).map((d) => {
          const first = d.units[0];
          const place = d.dir || (d.package ? `package ${d.package}` : "this repository");
          const does = [...new Set(d.units.map((u) => u.does))].join(" / ");
          return (
            <li key={`${d.concern}|${d.path}|${d.dir}|${d.variant}`} className="ck-exempt__row">
              <button
                type="button"
                className="st-pathlink ck-exempt__member"
                title={`${d.path}${first ? `:${first.line}` : ""}`}
                onClick={() => openCode({ path: d.path, line: first?.line, context: { title: `${d.concern}: done another way here`, detail: `${d.held} of the ${d.others} other entry points in ${place} use ${d.label}`, tone: "info" } })}
              >
                <Icon name="code" size={12} />
                <span className="dui-mono t-truncate">
                  {d.path}
                  {first && <span className="t-muted">:{first.line}</span>}
                </span>
                <span className="dui-mono t-accent">{d.units.map((u) => u.symbol).join(", ")}</span>
              </button>
              <Tag className="ck-exempt__kind">{d.concern}</Tag>
              <span className="ck-exempt__reason">
                <span className="t-caption t-secondary ck-exempt__why">
                  {num(d.held)} of the {num(d.others)} other entry points in <span className="dui-mono">{place}</span> use <span className="dui-mono">{d.label}</span>; here: <span className="dui-mono">{does}</span>
                  {d.example && (
                    <>
                      {" "}
                      <button type="button" className="st-link" onClick={() => openCode({ path: d.example!.path, line: d.example!.line, context: { title: `${d.concern}: ${d.label}`, detail: `the way ${d.held} of ${d.others} do it in ${place}`, tone: "info" } })}>
                        copy {d.example.path}:{d.example.line}
                      </button>
                    </>
                  )}
                </span>
                {d.promote && <PromoteHint command={d.promote} onCopy={copy} />}
              </span>
            </li>
          );
        })}
      </ul>
      {departures.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE * 5)}>
          Show {Math.min(PAGE * 5, departures.length - limit)} more of {departures.length - limit}
        </Button>
      )}
    </section>
  );
}

function HeldSection({ holds }: { holds: NeighbourHold[] }) {
  const openCode = useOpenCode();
  const [limit, setLimit] = useState(PAGE);
  return (
    <section id="ck-held" className="ck-exempt ck-held" aria-labelledby="ck-held-title">
      <div className="st-row st-wrap">
        <h3 id="ck-held-title" className="ck-exempt__title">
          <StateLabel tone="info" icon="info">
            Held back by the neighbour gate
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(holds.length)}</span>
        <span className="t-caption t-muted">Warnings on members nearer the members their convention sets apart (exemptions, reviewers' exceptions, files set apart as a different kind) than the ones that hold it. Never new, never failing. The gate is off unless DRIFT_NEIGHBOUR_GATE=on.</span>
      </div>
      <ul className="ck-exempt__list" aria-label="Warnings held back">
        {holds.slice(0, limit).map((h) => (
          <li key={`${h.id}|${h.path}|${h.symbol}|${h.line}`} className="ck-exempt__row">
            <button
              type="button"
              className="st-pathlink ck-exempt__member"
              title={`${h.path}:${h.line}`}
              onClick={() => openCode({ path: h.path, line: h.line, context: { title: `${h.id}: held back`, detail: `nearest set apart ${h.nearest_apart}; nearest holder ${h.nearest_holder}`, tone: "info" } })}
            >
              <Icon name="code" size={12} />
              <span className="dui-mono t-truncate">
                {h.path}
                <span className="t-muted">:{h.line}</span>
              </span>
              <span className="dui-mono t-accent">{h.symbol}</span>
            </button>
            <button type="button" className="st-link dui-mono ck-exempt__id" onClick={() => navigate("conventions", h.id)} title="Open the convention">
              {h.id}
            </button>
            <span className="ck-exempt__reason">
              <span className="t-caption t-secondary ck-exempt__why">
                like <span className="dui-mono">{h.nearest_apart}</span> ({h.apart_code === "reviewed" ? "marked fine" : (exemptionKind(h.apart_code)?.label ?? h.apart_code)}, {h.apart_distance.toFixed(3)}) more than <span className="dui-mono">{h.nearest_holder}</span> ({h.holder_distance.toFixed(3)})
              </span>
            </span>
          </li>
        ))}
      </ul>
      {holds.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE * 5)}>
          Show {Math.min(PAGE * 5, holds.length - limit)} more of {holds.length - limit}
        </Button>
      )}
    </section>
  );
}

/**
 * Members an accepted convention is not about (#45): drift check counts them as holding,
 * so they never fail, and lists them with Drift's reason so a wrong exemption can be seen.
 */
function ExemptSection({ exempt, q }: { exempt: CheckExemption[]; q: string }) {
  const openCode = useOpenCode();
  const [limit, setLimit] = useState(PAGE);
  const shown = filterExemptions(exempt, q);
  const kinds = exemptionKinds(exempt).filter((k): k is { code: string; label: string; n: number } => !!k.code);
  return (
    <section id="ck-exempt" className="ck-exempt" aria-labelledby="ck-exempt-title">
      <div className="st-row st-wrap">
        <h3 id="ck-exempt-title" className="ck-exempt__title">
          <StateLabel tone="neutral" icon="dot">
            Not checked (exempt)
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(exempt.length)}</span>
        <span className="t-caption t-muted">Members an accepted convention is not about, with Drift's reason. They count as holding and never fail; listed so a wrong exemption can be seen.</span>
      </div>
      {kinds.length > 0 && (
        <div className="st-row st-wrap ck-exempt__kinds" aria-label="Exempt members by kind">
          {kinds.map((k) => (
            <span key={k.code} className="t-caption t-secondary" title={exemptionKind(k.code)!.why}>
              <span className="t-num">{num(k.n)}</span> {k.label}
            </span>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="t-caption t-muted">No exempt member matches the filter.</p>
      ) : (
        <ul className="ck-exempt__list" aria-label="Exempt members">
          {shown.slice(0, limit).map((e) => (
            <li key={`${e.id}|${e.path}|${e.symbol}|${e.line}`} className="ck-exempt__row">
              <button
                type="button"
                className="st-pathlink ck-exempt__member"
                title={`${e.path}:${e.line}`}
                onClick={() => openCode({ path: e.path, line: e.line, context: { title: `${e.id}: not checked`, detail: e.reason, tone: "info" } })}
              >
                <Icon name="code" size={12} />
                <span className="dui-mono t-truncate">
                  {e.path}
                  <span className="t-muted">:{e.line}</span>
                </span>
                <span className="dui-mono t-accent">{e.symbol}</span>
              </button>
              <button type="button" className="st-link dui-mono ck-exempt__id" onClick={() => navigate("conventions", e.id)} title="Open the convention">
                {e.id}
              </button>
              <span className="ck-exempt__reason">
                {exemptionKind(e.code) && (
                  <Tag className="ck-exempt__kind" title={`${exemptionKind(e.code)!.why} (code ${e.code})`}>
                    {exemptionKind(e.code)!.label}
                  </Tag>
                )}
                <span className="t-caption t-secondary ck-exempt__why">{e.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE * 5)}>
          Show {Math.min(PAGE * 5, shown.length - limit)} more of {shown.length - limit}
        </Button>
      )}
    </section>
  );
}

/** What a diff-scoped check compared, and what it left out. */
function DiffLine({ d }: { d: DiffInfo }) {
  return (
    <p className="ck-diff t-body-sm">
      <Icon name="info" size={13} />
      <span>
        Changes since <span className="dui-mono">{d.base}</span> (merge base <span className="dui-mono">{d.merge_base.slice(0, 7)}</span>): {num(d.files_added)} added, {num(d.files_changed)} changed
        {d.files_renamed ? ` (${num(d.files_renamed)} renamed)` : ""}, {num(d.files_deleted)} deleted.{" "}
        {d.policy_changed ? (
          <b>The change edits the policy, so every new violation counts as introduced.</b>
        ) : d.new_outside_diff > 0 ? (
          <>
            {num(d.new_outside_diff)} new {d.new_outside_diff === 1 ? "violation" : "violations"} elsewhere in the repository {d.new_outside_diff === 1 ? "is" : "are"} not shown (Whole repository lists {d.new_outside_diff === 1 ? "it" : "them"}).
          </>
        ) : (
          "Nothing new outside the diff."
        )}
        {d.base_checked ? " The merge base was checked too, to tell what the change caused." : ""}
        {d.base_unchecked?.length ? ` ${num(d.base_unchecked.length)} ${d.base_unchecked.length === 1 ? "file" : "files"} could not be parsed at the merge base, so whether the change caused violations in ${d.base_unchecked.length === 1 ? "it" : "them"}, or in files that depend on ${d.base_unchecked.length === 1 ? "it" : "them"}, is unknown: those outside the changed lines are listed as unsure.` : ""}
      </span>
    </p>
  );
}
