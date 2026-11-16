// Review: a triage queue. j/k move, a accept, r reject, b block (confirmed),
// o open the example, Enter expands outliers, u undoes within the grace period.
// Every decision shows the exact `drift review` command it runs.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  EvidenceChip,
  EvidenceGauge,
  Icon,
  Kbd,
  Panel,
  Progress,
  SearchInput,
  SegmentedControl,
  Selector,
  SplitPane,
  StackedBar,
  StateLabel,
  Tag,
  TierBadge,
  inTextField,
  useToast,
} from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys, useCheck, useFacts, useQuestions } from "@/entities/drift";
import { VIOLATION_STATUS, statusOf } from "@/entities/check";
import { type ConventionRow, type FineOutlier, MIN_BLOCK_ROLE_SIZE, RECORD_MIN_CARDS, blockDecision, capSuggestions, forceBlockIsDanger, memberKey, reviewCounts, reviewOrder, splitOutliers, suggestionRecord, trackRecord, undecided, blocksInNameOnly, describeDecision, exemptionKind, exemptionKinds, importSource, keyTypeText, languageText, layeringTarget, ruleTargets, practiceText, shortRef, tierReasonText, uncheckedFilesText, uncheckedMembersText, useConventions, WIRING_FLAG_HELP, wireAt, agentsHiddenText, verifyText, BLOCK_CANDIDATE_TEXT, isBlockCandidate, type PythonProposalsState, pythonProposalsText, QUESTION, answerPlan, needsTick, ACCURACY, REVIEW_FIRST_TEXT, pctOf } from "@/entities/convention";
import { symbolLine, useFactsIndex } from "@/entities/facts";
import { useHistory } from "@/entities/history";
import { type Answer, type AuditEntry, type Decision, useApi } from "@/shared/api";
import type { Exempt, PolicyDifferentKind, ReviewQuestion } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";
import { num, relTime } from "@/shared/lib/format";
import { mdCode, mdFence, mdTable } from "@/shared/lib/markdown";
import { log } from "@/shared/lib/log";
import { navigate } from "@/shared/lib/router";
import { answerCommand, exemptCommand, reviewCommand } from "@/shared/lib/review";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";

type Filter = "review" | "accepted" | "rejected" | "all";
type TierFilter = "all" | "default" | "suggestion";
const GRACE_MS = 5000;

const statusLabel: Record<ConventionRow["status"], { tone: "accent" | "success" | "neutral" | "info"; icon: "dot" | "ok" | "x" | "info"; text: string }> = {
  proposed: { tone: "accent", icon: "dot", text: "proposed" },
  accepted: { tone: "success", icon: "ok", text: "accepted" },
  rejected: { tone: "neutral", icon: "x", text: "rejected" },
  not_in_policy: { tone: "info", icon: "info", text: "not in policy" },
};

export function command(repoPath: string, d: Decision, id: string) {
  return reviewCommand(repoPath, d, [id]);
}

export function ConventionsView({ selectedId }: { selectedId: string | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const openCode = useOpenCode();
  const { repo } = useRepo();
  const conv = useConventions(repo);
  const facts = useFacts(repo);
  const ix = useFactsIndex(facts.data?.data);
  const history = useHistory(repo);
  const check = useCheck(repo);
  // Each block candidate's one question (`drift review --json`): holders, and the members it would flag, by file.
  const questions = useQuestions(repo, !!conv.rows?.some(isBlockCandidate));
  const [filter, setFilter] = useState<Filter>("review");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [q, setQ] = useState("");
  // Every suggestion to review, not only the best few census lists (`drift review --all`).
  const [allSuggestions, setAllSuggestions] = useState(false);
  const [allOutliers, setAllOutliers] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<ConventionRow | null>(null);
  const [confirmInit, setConfirmInit] = useState(false);
  const pendingRef = useRef<{ id: string; decision: Decision; timer: number; toast: number } | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{ id: string; decision: Decision } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = conv.rows;
  // The default tier first, then suggestions best first (census rank); past the cap, suggestions to review
  // wait behind "Show all". A search looks through all of them.
  const ordered = useMemo(() => reviewOrder(rows), [rows]);
  const capped = useMemo(() => capSuggestions(ordered, conv.suggestionCap), [ordered, conv.suggestionCap]);
  const passes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (r: ConventionRow) => {
      const okStatus = filter === "all" || (filter === "review" ? undecided(r) : r.status === filter);
      const okTier = tierFilter === "all" || r.tier === tierFilter;
      return okStatus && okTier && (!needle || r.summary.toLowerCase().includes(needle) || r.id.includes(needle) || r.family.toLowerCase().includes(needle));
    };
  }, [filter, tierFilter, q]);
  const uncapped = allSuggestions || q.trim() !== "";
  const shown = useMemo(() => (uncapped ? ordered : capped.listed).filter(passes), [uncapped, ordered, capped, passes]);
  const hiddenHere = capped.hidden.filter(passes).length;
  const selected = rows.find((r) => r.id === selectedId) ?? shown[0] ?? null;
  // One set behind the progress line, the "To review" tab and the navigation badge (reviewCounts).
  const rc = reviewCounts(rows);
  const done = rc.done;

  // A filter the person picks stays picked: the selection moves into the filtered list. Only a
  // convention opened from elsewhere (a link, the palette) widens the filters to show it.
  const filtersRef = useRef(`${filter}|${tierFilter}|${q}|${allSuggestions}`);
  useEffect(() => {
    if (conv.loading) return;
    const filters = `${filter}|${tierFilter}|${q}|${allSuggestions}`;
    const filtersChanged = filters !== filtersRef.current;
    filtersRef.current = filters;
    const hidden = !!selectedId && rows.some((r) => r.id === selectedId) && !shown.some((r) => r.id === selectedId);
    if (!selectedId && shown[0]) navigate("conventions", shown[0].id);
    else if (hidden && filtersChanged) {
      if (shown[0]) navigate("conventions", shown[0].id);
    } else if (hidden) {
      if (filter !== "all" || tierFilter !== "all") {
        setFilter("all");
        setTierFilter("all");
      }
      if (capped.hidden.some((r) => r.id === selectedId)) setAllSuggestions(true);
    }
  }, [selectedId, shown, rows, filter, tierFilter, q, allSuggestions, capped, conv.loading]);
  useEffect(() => setAllOutliers(false), [selected?.id]);
  // The opt-in review log: a card the person opens is recorded as shown (`drift review --shown`), once per
  // card while this view is open, and only when the log is on (Drift records nothing otherwise).
  const shownLogged = useRef(new Set<string>());
  const logOn = conv.policy?.review_log === "on";
  const shownId = selected && selected.status !== "not_in_policy" ? selected.id : null;
  useEffect(() => {
    if (!repo || !logOn || !shownId) return;
    const key = `${repo.path}\u0000${shownId}`;
    if (shownLogged.current.has(key)) return;
    shownLogged.current.add(key);
    void api.reviewShown(repo, [shownId]).catch(() => undefined);
  }, [api, repo, logOn, shownId]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-id="${selected?.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  const move = (delta: number) => {
    if (!shown.length) return;
    const i = Math.max(0, shown.findIndex((r) => r.id === selected?.id));
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + delta))];
    if (next) navigate("conventions", next.id);
  };

  const run = async (decision: Decision, id: string) => {
    if (!repo) return;
    try {
      const entry = await api.review(repo, decision, [id]);
      log(entry.ok ? "info" : "error", `review ${decision} ${id}`, { command: entry.command, output: entry.output });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.policy(repo) }), qc.invalidateQueries({ queryKey: keys.check(repo) }), qc.invalidateQueries({ queryKey: keys.history(repo) })]);
      if (!entry.ok) toast.show({ title: `drift review failed for ${id}`, body: entry.output, tone: "danger", duration: 0 });
      else if (entry.output.trim()) toast.show({ title: `${decisionPast(decision)} ${id}`, body: entry.output.trim().split("\n").at(-1), tone: "success", duration: 3000 });
    } catch (e) {
      toast.show({ title: `drift review failed for ${id}`, body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
    } finally {
      setPendingDecision(null);
    }
  };

  /** A reviewer's "fine because…" (`drift review --exempt`), or with a null reason its removal: written at once (it is its own undo). */
  const markFine = async (row: ConventionRow, member: string, reason: string | null) => {
    if (!repo) return;
    let entry: AuditEntry;
    try {
      entry = await api.exempt(repo, row.id, member, reason);
    } catch (e) {
      toast.show({ title: `drift review failed for ${row.id}`, body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
      return;
    }
    log(entry.ok ? "info" : "error", `review ${entry.decision} ${row.id} ${member}`, { command: entry.command, output: entry.output });
    await Promise.all([qc.invalidateQueries({ queryKey: keys.policy(repo) }), qc.invalidateQueries({ queryKey: keys.check(repo) }), qc.invalidateQueries({ queryKey: keys.history(repo) })]);
    if (!entry.ok) toast.show({ title: `drift review failed for ${row.id}`, body: entry.output, tone: "danger", duration: 0 });
    else toast.show({ title: reason === null ? `Checked again: ${member}` : `Marked fine: ${member}`, body: <code className="dui-mono">{entry.command}</code>, tone: "success", duration: 3500 });
  };

  /** A block candidate's answer (`drift review --answer`): written at once, like an exception. */
  const answerQuestion = async (row: ConventionRow, answer: Answer, setApart: string[], confirmEntry: string[]) => {
    if (!repo) return;
    let entry: AuditEntry;
    try {
      entry = await api.answer(repo, row.id, answer, setApart, confirmEntry);
    } catch (e) {
      toast.show({ title: `drift review failed for ${row.id}`, body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 });
      return;
    }
    log(entry.ok ? "info" : "error", `review answer ${answer} ${row.id}`, { command: entry.command, output: entry.output });
    await Promise.all([keys.policy(repo), keys.check(repo), keys.history(repo), keys.questions(repo), keys.census(repo), keys.reviewLog(repo)].map((queryKey) => qc.invalidateQueries({ queryKey })));
    if (!entry.ok) toast.show({ title: `drift review failed for ${row.id}`, body: entry.output, tone: "danger", duration: 0 });
    else toast.show({ title: answer === "not-a-convention" ? `Rejected ${row.id}: not a convention` : answer === "different" ? `Accepted ${row.id}, files set apart` : `Accepted ${row.id}`, body: <code className="dui-mono">{entry.command}</code>, tone: "success", duration: 3500 });
  };

  const decide = (decision: Decision, row: ConventionRow) => {
    if (!repo || row.status === "not_in_policy") return;
    // A new decision commits any pending one immediately.
    flushPending();
    const cmd = command(repo.path, decision, row.id);
    const timer = window.setTimeout(() => {
      pendingRef.current = null;
      void run(decision, row.id);
    }, GRACE_MS);
    const toastId = toast.show({
      title: `${decisionPast(decision)} ${row.id}`,
      body: <code className="dui-mono">{cmd}</code>,
      tone: decision === "block" || decision === "force_block" ? "warning" : "neutral",
      duration: GRACE_MS,
      countdown: true,
      action: { label: t("conventions.undo"), shortcut: "u", onClick: undo },
    });
    pendingRef.current = { id: row.id, decision, timer, toast: toastId };
    setPendingDecision({ id: row.id, decision });
    // Advance to the next proposal.
    const nextRow = shown.find((r, i) => i > shown.findIndex((x) => x.id === row.id) && r.status === "proposed" && r.id !== row.id);
    if (nextRow) navigate("conventions", nextRow.id);
  };

  function flushPending() {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    toast.dismiss(p.toast);
    pendingRef.current = null;
    void run(p.decision, p.id);
  }

  function undo() {
    const p = pendingRef.current;
    if (!p) {
      toast.show({ title: "Nothing to undo", body: "Decisions already written can be changed with another decision (drift review has no reset yet).", duration: 3500 });
      return;
    }
    window.clearTimeout(p.timer);
    toast.dismiss(p.toast);
    pendingRef.current = null;
    setPendingDecision(null);
    log("info", `undo ${p.decision} ${p.id}`);
    navigate("conventions", p.id);
  }

  // Commit a pending decision when leaving the view.
  useEffect(() => () => flushPending(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing or reloading the window during the grace period commits the decision rather than dropping it.
  useEffect(() => {
    const onUnload = () => flushPending();
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openExample = (row: ConventionRow) => {
    const line = row.example.line ?? (ix ? symbolLine(ix, row.example.path, row.example.symbol) : null);
    openCode({ path: row.example.path, line, context: { title: `Example of ${row.id}: ${row.example.symbol}`, detail: row.summary, tone: "accent" } });
  };
  const openOutlier = (row: ConventionRow, o: { path: string; line: number; symbol: string }) =>
    openCode({ path: o.path, line: o.line, context: { title: `Outlier of ${row.id}: ${o.symbol} does not follow it`, detail: row.summary, tone: "warning" } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']")) return;
      if (!selected) return;
      const k = e.key;
      if (k === "j" || k === "ArrowDown") move(1);
      else if (k === "k" || k === "ArrowUp") move(-1);
      else if (k === "a") decide("accept", selected);
      else if (k === "r") decide("reject", selected);
      // Wiring rules never block (#38): drift review --block refuses them, even with --force.
      else if (k === "b" && !selected.experimental) setConfirmBlock(selected);
      else if (k === "d" && selected.status === "accepted" && selected.mode === "block") decide("advise", selected);
      else if (k === "u") undo();
      else if (k === "o") openExample(selected);
      else if (k === "Enter") setAllOutliers((x) => !x);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (conv.loading) return <Loading label="Loading conventions" />;
  if (conv.policyError) return <ErrorState title="conventions.yaml could not be read" error={conv.policyError} />;
  if (!conv.policy && rows.length === 0)
    return (
      <>
        <EmptyState
          icon="review"
          title={t("conventions.noPolicy")}
          action={
            <Button variant="primary" icon="play" onClick={() => setConfirmInit(true)}>
              {t("conventions.runInit")}
            </Button>
          }
        >
          {t("conventions.noPolicyBody")}
          {conv.census && conv.census.conventions === 0 && <NoConventions c={conv.census} />}
          {conv.census && <CensusUnchecked paths={conv.census.unchecked} />}
          <PythonProposalsNote state={conv.pythonProposals} />
        </EmptyState>
        <ConfirmDialog
          open={confirmInit}
          onOpenChange={setConfirmInit}
          title="Run drift init?"
          description="Drift writes .drift/conventions.yaml (every convention proposed, none enforced) and drift.lock in this repository."
          confirmLabel={t("conventions.runInit")}
          onConfirm={() =>
            repo &&
            api.init(repo).then(
              (m) => (
                toast.show({ title: "drift init", body: m, tone: "success" }),
                // Check too: its `conventions[]` says which policy proposals Drift still shows (hiddenByShowPolicy).
                Promise.all([qc.invalidateQueries({ queryKey: keys.policy(repo) }), qc.invalidateQueries({ queryKey: keys.check(repo) })])
              ),
              (e: unknown) => toast.show({ title: "drift init failed", body: e instanceof Error ? e.message : String(e), tone: "danger", duration: 0 }),
            )
          }
        >
          <code className="st-cmd">drift --root {repo?.path} init</code>
        </ConfirmDialog>
      </>
    );

  const counts = {
    review: rc.toReview,
    accepted: rows.filter((r) => r.status === "accepted").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    all: rows.length,
  };

  return (
    <div className="st-review">
      <SplitPane storageKey="review" initial={420} min={300} max={640}>
        <div className="st-queue">
          <div className="st-queue__head">
            <div className="st-queue__progress">
              <div className="st-row">
                <span className="t-title">{t("conventions.progress", { done, total: rc.total })}</span>
                <span className="st-grow" />
                <span className="t-caption t-muted" title={t("conventions.target")}>
                  <Icon name="clock" size={12} /> 15 in 5 min
                </span>
              </div>
              <Progress value={rc.total ? done / rc.total : 0} label={t("conventions.progress", { done, total: rc.total })} tone={done === rc.total ? "success" : "accent"} />
              {rc.notInPolicy > 0 && (
                <span className="t-caption t-muted cv-newcount">
                  {num(rc.notInPolicy)} of them new since the last drift init: run it to add {rc.notInPolicy === 1 ? "it" : "them"} to the policy
                </span>
              )}
            </div>
            <SegmentedControl<Filter>
              label="Show"
              size="sm"
              value={filter}
              onValueChange={setFilter}
              items={[
                { value: "review", label: "To review", count: counts.review },
                { value: "accepted", label: "Accepted", count: counts.accepted },
                { value: "rejected", label: "Rejected", count: counts.rejected },
                { value: "all", label: "All", count: counts.all },
              ]}
            />
            {rows.some((r) => r.tier) && (
              <SegmentedControl<TierFilter>
                label="Tier"
                size="sm"
                value={tierFilter}
                onValueChange={setTierFilter}
                items={[
                  { value: "all", label: "Any tier" },
                  { value: "default", label: "Default tier", count: rows.filter((r) => r.tier === "default").length },
                  { value: "suggestion", label: "Suggestions", count: rows.filter((r) => r.tier === "suggestion").length },
                ]}
              />
            )}
            <SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Filter by rule, id or family" label="Filter conventions" />
            {!conv.censusAvailable && (
              <p className="st-note">
                <Icon name="info" size={12} /> {t("conventions.noCensus")}
              </p>
            )}
            {conv.census && <CensusUnchecked paths={conv.census.unchecked} />}
            <PythonProposalsNote state={conv.pythonProposals} />
            {rows.some(isBlockCandidate) && (
              <p className="st-note cv-reviewfirst" role="note">
                <Icon name="attention" size={12} className="t-warning" /> <b>Start with the block candidates.</b> {REVIEW_FIRST_TEXT} See {ACCURACY.doc}.
              </p>
            )}
          </div>
          <div className="st-queue__list" ref={listRef} role={shown.length ? "listbox" : undefined} aria-label={shown.length ? "Conventions" : undefined}>
            {shown.length === 0 && (
              <EmptyState icon="ok" title={rows.length === 0 ? "No conventions yet" : filter === "review" ? "Everything is reviewed" : "No conventions match"}>
                {rows.length === 0 && conv.census && <NoConventions c={conv.census} />}
              </EmptyState>
            )}
            {shown.map((r) => {
              const st = statusLabel[r.status];
              const hint = trackRecord(r);
              const isPending = pendingDecision?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={r.id === selected?.id}
                  data-id={r.id}
                  className={`st-qitem${r.id === selected?.id ? " is-selected" : ""}`}
                  onClick={() => navigate("conventions", r.id)}
                >
                  <span className="st-qitem__top">
                    <StateLabel tone={isPending ? "warning" : st.tone} icon={isPending ? "clock" : st.icon}>
                      {isPending ? `${pendingDecision!.decision}…` : st.text}
                    </StateLabel>
                    {r.status === "accepted" && r.mode === "block" && (blocksInNameOnly(r) ? <Badge tone="warning" icon="attention" title={`The policy says block, but a role of ${r.members} members only advises`}>block · advises</Badge> : <Badge tone="danger" icon="blocked">block</Badge>)}
                    <span className="st-grow" />
                    <span className="dui-mono t-caption t-muted">{r.id}</span>
                  </span>
                  <span className="st-qitem__summary">{r.summary}</span>
                  <span className="st-qitem__meta">
                    <EvidenceChip compact holders={r.evidence.holders} total={r.evidence.total} lowerBound={r.evidence.lower_bound} />
                    {r.tier && <TierBadge compact tier={r.tier} reason={tierReasonText(r, conv.params?.tier?.min_members)} />}
                    {r.experimental && <span className="st-qitem__fam">experimental</span>}
                    {isBlockCandidate(r) ? (
                      <span className="st-qitem__fam cv-qcandidate t-warning" title={`Drift: ${BLOCK_CANDIDATE_TEXT}`}>
                        block candidate
                      </span>
                    ) : (
                      agentsHiddenText(r) && (
                        <span className="st-qitem__fam cv-qagents" title={agentsHiddenText(r)!}>
                          not shown to agents
                        </span>
                      )
                    )}
                    {verifyText(r) && (
                      <span className="st-qitem__fam cv-qverify" title={r.verify!.text}>
                        {verifyText(r)}
                      </span>
                    )}
                    {hint && (
                      <span className={`st-qitem__fam${hint.rate < 0.5 ? " t-warning" : ""}`} title={`${hint.scope === "suggestion" ? "Suggestion-tier" : "All-tier"} labels: ${Math.round(hint.rate * 100)}% accepted of ${hint.n}`}>
                        {r.family} {Math.round(hint.rate * 100)}%
                      </span>
                    )}
                    {r.uncheckedMembers > 0 && (
                      <span className="t-caption t-warning cv-qunchecked" title={uncheckedMembersText(r.uncheckedMembers)!}>
                        <Icon name="attention" size={11} /> {num(r.uncheckedMembers)} not checked
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {conv.suggestionCap != null && (hiddenHere > 0 || (allSuggestions && capped.hidden.length > 0)) && q.trim() === "" && (
              <p className="st-note cv-capnote" data-testid="suggestion-cap">
                <Icon name="info" size={12} />{" "}
                {allSuggestions
                  ? `All ${num(capped.suggestions)} suggestions to review, best first.`
                  : `Showing ${num(conv.suggestionCap)} of ${num(capped.suggestions)} suggestions to review, best first by their evidence (lower bound, then fewer outliers, then lift); ${num(capped.hidden.length)} more.`}{" "}
                <Button size="sm" variant="ghost" onClick={() => setAllSuggestions((v) => !v)}>
                  {allSuggestions ? `Show the best ${num(conv.suggestionCap)}` : "Show all"}
                </Button>
              </p>
            )}
          </div>
          <div className="st-queue__keys" aria-hidden="true">
            <span><Kbd>j</Kbd><Kbd>k</Kbd> move</span>
            <span><Kbd>a</Kbd> accept</span>
            <span><Kbd>r</Kbd> reject</span>
            <span><Kbd>b</Kbd> block</span>
            <span><Kbd>d</Kbd> advise</span>
            <span><Kbd>u</Kbd> undo</span>
            <span><Kbd>o</Kbd> example</span>
          </div>
        </div>
        <div className="st-detail">
          {selected ? (
            <Detail
              row={selected}
              repoPath={repo?.path ?? "."}
              threshold={conv.params?.min_lower_bound ?? null}
              minMembers={conv.params?.tier?.min_members ?? MIN_BLOCK_ROLE_SIZE}
              violations={(check.data?.data.violations ?? []).filter((v) => v.id === selected.id).map(statusOf)}
              allOutliers={allOutliers}
              setAllOutliers={setAllOutliers}
              onDecide={(d) => (d === "block" || d === "force_block" ? setConfirmBlock(selected) : decide(d, selected))}
              onExample={() => openExample(selected)}
              onFine={(member, reason) => markFine(selected, member, reason)}
              question={isBlockCandidate(selected) ? (questions.data?.candidates.find((c) => c.id === selected.id) ?? null) : null}
              questionError={questions.error instanceof Error ? questions.error.message : null}
              onAnswer={(a, files, confirm) => answerQuestion(selected, a, files, confirm)}
              onOutlier={(o) => openOutlier(selected, o)}
              wiring={conv.wiringState}
              onRegistry={(path, line) => openCode({ path, line: line > 0 ? line : undefined, context: { title: `Registry of ${selected.id}`, detail: selected.summary, tone: "info" } })}
              audit={(history.data?.audit ?? []).filter((a) => a.ids.includes(selected.id))}
              pending={pendingDecision?.id === selected.id ? pendingDecision.decision : null}
              onCopy={() => {
                void navigator.clipboard?.writeText(conventionMarkdown(selected));
                toast.show({ title: t("common.copied"), body: "Convention copied as Markdown", duration: 2000, tone: "success" });
              }}
            />
          ) : (
            <EmptyState icon="review" title="Choose a convention" />
          )}
        </div>
      </SplitPane>
      <ConfirmDialog
        open={!!confirmBlock}
        onOpenChange={(o) => !o && setConfirmBlock(null)}
        title={t("conventions.blockTitle", { id: confirmBlock?.id ?? "" })}
        description={
          confirmBlock && confirmBlock.members < MIN_BLOCK_ROLE_SIZE
            ? t("conventions.blockSmall", { n: confirmBlock.members })
            : confirmBlock && blockDecision(confirmBlock) === "force_block"
              ? describeDecision("force_block", confirmBlock)
              : t("conventions.blockBody")
        }
        confirmLabel={confirmBlock && blockDecision(confirmBlock) === "force_block" ? (forceBlockIsDanger(confirmBlock) ? "Block anyway" : "Block with --force") : t("conventions.block")}
        tone="danger"
        onConfirm={() => confirmBlock && decide(blockDecision(confirmBlock), confirmBlock)}
      >
        {confirmBlock && (
          <div className="st-stack">
            <p>{confirmBlock.summary}</p>
            {confirmBlock.tier === "suggestion" && <TierBadge tier="suggestion" reason={tierReasonText(confirmBlock, conv.params?.tier?.min_members)} />}
            {blockDecision(confirmBlock) === "force_block" && <p className="t-caption t-secondary cv-blockrecord">{recordText(confirmBlock)}</p>}
            <code className="st-cmd">{command(repo?.path ?? ".", blockDecision(confirmBlock), confirmBlock.id)}</code>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function decisionPast(d: Decision) {
  return d === "accept" ? "Accepted" : d === "reject" ? "Rejected" : d === "advise" ? "Advising" : "Blocking";
}

function Detail({
  row,
  repoPath,
  threshold,
  minMembers,
  violations,
  allOutliers,
  setAllOutliers,
  onDecide,
  onExample,
  onFine,
  question,
  questionError,
  onAnswer,
  onOutlier,
  wiring,
  onRegistry,
  audit,
  pending,
  onCopy,
}: {
  row: ConventionRow;
  repoPath: string;
  threshold: number | null;
  /** Members the default tier needs (census `params.tier.min_members`). */
  minMembers: number;
  /** Statuses of this convention's violations in the last drift check. */
  violations: ReturnType<typeof statusOf>[];
  allOutliers: boolean;
  setAllOutliers(v: boolean): void;
  onDecide(d: Decision): void;
  onExample(): void;
  /** Mark `member` fine with `reason` (`drift review --exempt`), or with null check it again (`--unexempt`). */
  onFine(member: string, reason: string | null): Promise<void>;
  /** The block candidate's one question (`drift review --json`); null when it is not one, or not loaded. */
  question: ReviewQuestion | null;
  questionError: string | null;
  onAnswer(answer: Answer, setApart: string[], confirmEntry: string[]): Promise<void>;
  onOutlier(o: { path: string; line: number; symbol: string }): void;
  /** Whether census ran with the experimental wiring flag on (`census.wiring`). */
  wiring: "on" | "off" | "unknown";
  onRegistry(path: string, line: number): void;
  audit: { at: number; user: string; decision: AuditEntry["decision"]; command: string; ok: boolean }[];
  pending: Decision | null;
  onCopy(): void;
}) {
  const st = statusLabel[row.status];
  const lang = languageText(row.language, row.evidence, row.evidence.role_members ?? row.members);
  const hint = trackRecord(row);
  const { open, fine } = splitOutliers(row);
  const visible = allOutliers ? open : open.slice(0, OUTLIERS_SHOWN);
  // A reviewer's exception goes on a convention in the policy that something checks (not a rejected one).
  const canFine = row.status === "accepted" || row.status === "proposed";
  const [fineFor, setFineFor] = useState<string | null>(null);
  const [fineText, setFineText] = useState("");
  useEffect(() => setFineFor(null), [row.id]);
  const layer = layeringTarget(row.rule);
  const source = importSource(row.rule);
  // An import-source rule's exempt members are the role's members that do not use the thing: collapsed (#35).
  const [exemptOpenFor, setExemptOpenFor] = useState<string | null>(null);
  const exemptOpen = !source || exemptOpenFor === row.id;
  const canDecide = row.status !== "not_in_policy";
  const outliersRef = useRef<HTMLElement | null>(null);
  return (
    <div className="st-detail__inner cv">
      <header className="st-detail__head cv-head">
        <div className="st-row st-wrap cv-meta">
          <StateLabel tone={st.tone} icon={st.icon}>
            {st.text}
          </StateLabel>
          {row.status === "accepted" &&
            (blocksInNameOnly(row) ? (
              <Badge tone="warning" icon="attention" title={`conventions.yaml says block; drift check advises because the role has ${row.members} members (blocking needs ${MIN_BLOCK_ROLE_SIZE})`}>
                block in policy · advises
              </Badge>
            ) : (
              <Badge tone={row.mode === "block" ? "danger" : "neutral"} icon={row.mode === "block" ? "blocked" : "info"}>
                {row.mode}
                {row.mode === "block" && row.tier === "suggestion" ? " (forced)" : ""}
              </Badge>
            ))}
          <Tag>{row.id}</Tag>
          {row.tier && <TierBadge tier={row.tier} reason={tierReasonText(row, minMembers)} />}
          {isBlockCandidate(row) ? (
            <Badge tone="warning" variant="outline" icon="attention" className="cv-candidate" title="A default-tier convention no one has accepted yet (decision D13): Drift shows it to you first and keeps it from agents (hooks, MCP, drift check text, AGENTS.md) until you accept it here or with drift review --accept. Accepting it in block mode is what lets it block.">
              {BLOCK_CANDIDATE_TEXT}
            </Badge>
          ) : row.status !== "rejected" && agentsHiddenText(row) && (
            <Badge variant="outline" icon="info" className="cv-agents" title="Drift keeps it from agents (hooks, MCP, drift check text, AGENTS.md) until its rule family meets the admission bar (85% accepted of at least 10 labelled cards on the latest dev run), or until you show it with drift review --show-to-agents. You still see and review it here.">
              {agentsHiddenText(row)}
            </Badge>
          )}
          {verifyText(row) && (
            <Badge variant="outline" icon="info" className="cv-verify" title={`Experimental (agents.verify: on, unvalidated): the host agent ran Drift's frozen verifier prompt 3 times over MCP (drift_verify_card); 2 of 3 passing samples show the suggestion to agents while its card stays the same. Drift: ${row.verify!.text}.`}>
              {verifyText(row)}
            </Badge>
          )}
          {lang && (
            <Badge variant="outline" className="cv-lang" title={lang.why}>
              {lang.label}
            </Badge>
          )}
          {row.experimental && (
            <Badge tone="warning" icon="attention" className="cv-experimental" title="An experimental wiring rule: a suggestion that never blocks, checked only while the feature is on">
              experimental · never blocks
            </Badge>
          )}
          {row.promotedFromPractice && (
            <Badge variant="outline" icon="layers" className="cv-promoted" title="A person made this practice a convention from the practice map (drift practices promote); the id is the variant it came from">
              promoted from the practice map · {row.promotedFromPractice}
            </Badge>
          )}
          {row.rank && <span className="t-caption t-muted">rank {row.rank}</span>}
          <span className="st-grow" />
          <Button size="sm" variant="ghost" icon="copy" onClick={onCopy}>
            {t("common.exportMd")}
          </Button>
        </div>
        <h2 className="t-h1 st-detail__title">{row.summary}</h2>
        {row.status === "accepted" && (
          <div className="st-row st-wrap cv-violations">
            {violations.length === 0 ? (
              <StateLabel tone="success" icon="ok">
                no violations in the last drift check
              </StateLabel>
            ) : (
              (["block", "advise", "held", "unsure", "suppressed", "baselined"] as const)
                .filter((s) => violations.includes(s))
                .map((s) => (
                  <StateLabel key={s} tone={VIOLATION_STATUS[s].tone} icon={VIOLATION_STATUS[s].icon}>
                    {violations.filter((x) => x === s).length} {VIOLATION_STATUS[s].label}
                  </StateLabel>
                ))
            )}
            {violations.length > 0 && (
              <button type="button" className="st-link t-body-sm" onClick={() => navigate("check")}>
                See them in Check
              </button>
            )}
          </div>
        )}
        <Selector
          label="Role this convention applies to"
          parts={[
            { key: "package", value: row.role.package === "*" ? "(every package)" : row.role.package || "(root)", mono: true },
            { key: "directory", value: `${row.role.dir}/**`, mono: true },
            { key: "file kind", value: row.role.file, mono: true },
            ...(row.role.entry && row.role.entry !== "-" ? [{ key: "entry point", value: row.role.entry, mono: true }] : []),
            { key: "symbol", value: row.role.kind, mono: true },
            ...(row.role.variety ? [{ key: "class kind", value: row.role.variety, mono: true }] : []),
            ...(row.role.export_name ? [{ key: "exported as", value: row.role.export_name, mono: true }] : []),
            ...(row.role.member_kind ? [{ key: "member kind", value: row.role.member_kind, mono: true }] : []),
            ...(row.role.shape ? [{ key: "shape", value: row.role.shape, mono: true }] : []),
            ...(row.role.also?.length ? [{ key: "also covers", value: row.role.also.map((r) => (r.file === "*" ? `${r.dir}/**` : `${r.dir}/** (${r.file})`)).join(", "), mono: true }] : []),
          ]}
          trailing={
            <span className="t-caption t-muted">
              {num(row.members)} members{row.experimental ? " · a wiring rule: advises, never blocks" : !row.blockable ? ` · advise only (blocking needs ${MIN_BLOCK_ROLE_SIZE})` : row.tier === "suggestion" ? " · a suggestion: advises unless blocked with --force" : ""}
            </span>
          }
        />
      </header>

      {isBlockCandidate(row) && (question ? <QuestionPanel q={question} repoPath={repoPath} onAnswer={onAnswer} /> : questionError ? <p className="st-pad t-caption t-muted cv-question__error" role="alert">The one question needs drift review --json: {questionError}</p> : null)}
      {row.differentKind.length > 0 && <SetApartList files={row.differentKind} exempt={row.exempt ?? []} />}

      <Panel
        ref={outliersRef}
        className="cv-sec cv-outliers"
        title={
          <>
            {t("conventions.outliers")} <span className="t-muted">{row.outliers === null ? "?" : num(open.length)}</span>
            {fine.length > 0 && <span className="t-muted t-caption cv-outliers__fine"> · {num(fine.length)} marked fine</span>}
          </>
        }
        subtitle={
          source && source.not.length > 0
            ? `Members that import ${source.name} from ${source.not.length === 1 ? source.not[0] : `one of ${source.not.join(", ")}`} instead of ${source.from}`
            : canFine
              ? "Members that do not follow the rule: legacy code, mistakes, or legitimate exceptions (mark one fine, with why)"
              : "Members that do not follow the rule: legacy code, legitimate exceptions, or mistakes"
        }
        actions={
          open.length > OUTLIERS_SHOWN ? (
            <Button size="sm" variant="ghost" shortcut="enter" onClick={() => setAllOutliers(!allOutliers)}>
              {allOutliers ? "Show fewer" : `Show all ${open.length}`}
            </Button>
          ) : undefined
        }
        padded={false}
      >
        {row.outliers === null ? (
          <p className="st-pad t-muted">Outliers come from drift census --json, which did not report this convention.</p>
        ) : open.length === 0 ? (
          <p className="st-pad t-muted">{fine.length ? "None left: every outlier is marked fine." : t("conventions.noOutliers")}</p>
        ) : (
          <ul className="st-outliers cv-outliers__list">
            {visible.map((o) => {
              const key = memberKey(o);
              return (
                <li key={key} className="cv-outlier">
                  <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => onOutlier(o)}>
                    <Icon name="attention" size={13} className="t-warning" />
                    <span className="dui-mono cv-outlier__path">{o.path}</span>
                    <span className="dui-mono cv-outlier__sym">{o.symbol}</span>
                    <span className="t-muted t-caption">:{o.line}</span>
                  </button>
                  {canFine && fineFor !== key && (
                    <Button size="sm" variant="ghost" className="cv-outlier__fine" onClick={() => (setFineFor(key), setFineText(""))} title={`Mark ${o.symbol} as a legitimate exception: drift check then lists it as exempt, not as a violation`}>
                      Fine because…
                    </Button>
                  )}
                  {fineFor === key && (
                    <form
                      className="cv-fineform"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const reason = oneLine(fineText);
                        if (!reason || [...reason].length > MAX_REASON) return;
                        setFineFor(null);
                        void onFine(key, reason);
                      }}
                    >
                      <label className="t-caption t-secondary" htmlFor={`fine-${row.id}`}>
                        Fine because (agents see it; at most {MAX_REASON} characters)
                      </label>
                      <span className="dui-input cv-fineform__input">
                      <input
                        id={`fine-${row.id}`}
                        autoFocus
                        maxLength={MAX_REASON}
                        value={fineText}
                        placeholder="why this member is a legitimate exception"
                        onChange={(e) => setFineText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setFineFor(null);
                          }
                        }}
                      />
                      </span>
                      <div className="st-row st-wrap cv-fineform__actions">
                        <Button size="sm" variant="primary" type="submit" disabled={!oneLine(fineText)}>
                          Mark fine
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setFineFor(null)}>
                          Cancel
                        </Button>
                        <code className="st-cmd t-caption">{exemptCommand(repoPath, row.id, key, oneLine(fineText) || "<why>")}</code>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {fine.length > 0 && <FineList fine={fine} canEdit={canFine} onOpen={(o) => o.line !== null && onOutlier({ path: o.path, symbol: o.symbol, line: o.line })} onUndo={(m) => void onFine(m, null)} />}
      </Panel>

      <section className="cv-evidence" aria-label={t("conventions.evidence")}>
        <div className="cv-evidence__gauge">
          <div className="dui-overline cv-label">{t("conventions.evidence")}</div>
          <EvidenceGauge
            holders={row.evidence.holders}
            total={row.evidence.total}
            lowerBound={row.evidence.lower_bound}
            lift={row.evidence.lift}
            threshold={threshold}
            onOutliers={() => outliersRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
          />
          {row.evidence.role_members != null && row.evidence.role_members !== row.evidence.total && (
            <p className="t-caption t-secondary cv-about">
              Counted over the {num(row.evidence.total)} members the rule is about, in a role of {num(row.evidence.role_members)}
              {row.exempt?.length ? `: ${num(row.exempt.length)} not about it (listed below, not outliers)` : ""}. The role's size decides the tier and whether it may block.
            </p>
          )}
          {row.uncheckedMembers > 0 && (
            <p className="t-caption cv-unchecked" role="note">
              <Icon name="attention" size={12} className="t-warning" />
              <span>
                <b>{uncheckedMembersText(row.uncheckedMembers)}</b>: {row.uncheckedMembers === 1 ? "its file depends" : "their files depend"} on a file census could not parse (no stack large enough to parse it could be reserved on
                that run), so {row.uncheckedMembers === 1 ? "its verdict" : "their verdicts"} may change once that file is parsed.
              </span>
            </p>
          )}
          {row.evidence.split && row.evidence.split.length > 1 && (
            <div className="cv-split">
              <div className="dui-overline cv-label">{t("conventions.split")}</div>
              <StackedBar label="Variants" segments={row.evidence.split.map(([w, n], i) => ({ label: shortRef(w), value: n, color: i }))} />
            </div>
          )}
        </div>
        <aside className="cv-track" aria-label="Track record of this rule family">
          <div className="dui-overline cv-label">Track record</div>
          {hint ? (
            <>
              <div className="cv-track__value">
                <span className="cv-track__num">{Math.round(hint.rate * 100)}%</span>
                <span className="t-secondary">
                  of {hint.family.toLowerCase()} {hint.scope === "suggestion" ? "suggestions" : "rules"} accepted
                </span>
              </div>
              <div className="cv-track__bar" aria-hidden="true">
                <span style={{ width: `${hint.rate * 100}%` }} />
              </div>
              <p className="t-caption t-muted">
                Blind reviewers, n={hint.n}
                {hint.scope === "suggestion" ? ", suggestion-tier cards only (the record agents' admission reads)" : ""}
                {hint.notWrong !== null ? `, ${Math.round(hint.notWrong * 100)}% not wrong` : ""}. {hint.source}.
              </p>
              {hint.rate < 0.5 && (
                <StateLabel tone="warning" icon="attention">
                  Often wrong: look closely at the outliers
                </StateLabel>
              )}
            </>
          ) : (
            <p className="t-caption t-muted">The precision study has too few {row.family.toLowerCase()} rules to say.</p>
          )}
          {row.tier === "default" && row.language !== "py" && (
            // The beta's out-of-sample figure (docs/ACCURACY.md): the record above is in-sample, on the repositories Drift was tuned on.
            <p className="t-caption t-secondary cv-track__oos">
              In sample, as above. Out of sample, on repositories Drift was not tuned on: {ACCURACY.defaultTier.k} of {ACCURACY.defaultTier.n} default-tier cards accepted ({pctOf(ACCURACY.defaultTier)}%, Wilson {ACCURACY.defaultTier.lo}–{ACCURACY.defaultTier.hi}%). {ACCURACY.doc}.
            </p>
          )}
        </aside>
      </section>

      <div className="cv-grid">
        <Panel
          className="st-span2 cv-sec"
          title={t("conventions.example")}
          subtitle="A typical member: the file Drift tells agents to copy (drift example)"
          actions={
            <Button size="sm" variant="ghost" icon="code" shortcut="o" onClick={onExample}>
              {t("common.openCode")}
            </Button>
          }
        >
          <button type="button" className="st-pathlink st-pathlink--wrap cv-example" onClick={onExample}>
            <Icon name="file" size={14} />
            <span className="dui-mono">{row.example.path}</span>
            <span className="dui-mono t-accent">{row.example.symbol}</span>
            {row.example.line && <span className="t-muted t-caption">:{row.example.line}</span>}
          </button>
        </Panel>
        <Panel className="st-span2 cv-sec" title={t("conventions.rule")} subtitle={row.family}>
          <div className="st-row st-wrap" style={{ marginBottom: 10 }}>
            {ruleTargets(row.rule).map((x) => (
              <Tag key={x}>{x}</Tag>
            ))}
          </div>
          {row.rule.type === "practice" && (
            <p className="t-body-sm t-secondary cv-practice-rule" style={{ marginBottom: 10 }}>
              {practiceText(row.rule)}: drift check reports a new unit of this place that does {row.rule.concern} another way, or not at all, as the practice map reads it. Units it cannot read are never reported, and the units that did it another way when it was promoted are recorded in drift.lock as they are.{" "}
              <button type="button" className="st-link" onClick={() => navigate("practices", "concerns", { concern: row.rule.type === "practice" ? row.rule.concern : "" })}>
                Open the practice map
              </button>
            </p>
          )}
          {row.namesPackage && (
            <p className="t-body-sm t-secondary" style={{ marginBottom: 10 }}>
              Names a package&apos;s symbol, not the repository&apos;s own: under decision D5 such a rule is a suggestion, because a library&apos;s API is not a team convention to enforce.
            </p>
          )}
          {row.experimental && <WiringNote row={row} wiring={wiring} onRegistry={onRegistry} />}
          {row.tierReason === "language_advise" && (
            <p className="t-body-sm t-secondary cv-tier-why" style={{ marginBottom: 10 }}>
              Python conventions advise only (decision D7): no Python rule kind is in the default tier, so this convention is a suggestion whatever its kind. It can still be blocked on purpose (Block anyway); Python gets a default tier only by a new decision, and blocking only once that tier measures ≥ 95% on a held-out run.
            </p>
          )}
          {row.tierReason === "rule_kind_d7" && (
            <p className="t-body-sm t-secondary cv-tier-why" style={{ marginBottom: 10 }}>
              A suggestion since decision D7: the default tier keeps only call wrappers and layering (TypeScript/JavaScript). Decorators, base classes and JSX layout wrappers were accepted far less often on the dev labels, so they advise.
            </p>
          )}
          {source && (
            <p className="t-body-sm t-secondary cv-importsfrom" style={{ marginBottom: 10 }}>
              Members that use <span className="dui-mono">{source.name}</span> import it from <span className="dui-mono">{source.from}</span>
              {source.not.length > 0 && (
                <>
                  , not from{" "}
                  {source.not.map((m, i) => (
                    <span key={m}>
                      {i > 0 ? " or " : ""}
                      <span className="dui-mono">{m}</span>
                    </span>
                  ))}
                </>
              )}
              .
            </p>
          )}
          {row.rule.type === "passes_key" && row.keyType && (
            <p className="t-body-sm t-secondary cv-keytype" style={{ marginBottom: 10 }}>
              <Badge tone={row.keyType === "required" ? "info" : "neutral"} variant="outline">
                type: {row.keyType}
              </Badge>{" "}
              {keyTypeText(row.keyType, row.rule.key)}
            </p>
          )}
          {layer && (
            <p className="t-body-sm t-secondary" style={{ marginBottom: 10 }}>
              Layering: files in this role must not import from <span className="dui-mono">{layer}/**</span>.{" "}
              <button type="button" className="st-link" onClick={() => navigate("map")}>
                See it on the map
              </button>
            </p>
          )}
          <details className="st-raw">
            <summary>Rule as in conventions.yaml</summary>
            <pre className="dui-mono">{JSON.stringify(row.rule, null, 2)}</pre>
          </details>
        </Panel>
        {(row.exempt?.length ?? 0) > 0 && (
          <Panel
            className="st-span2 cv-sec cv-exempt"
            title={
              <>
                Not about these <span className="t-muted">{row.exempt!.length}</span>
              </>
            }
            subtitle={
              source
                ? `Role members the rule is not about, mostly ones that do not use ${source.name}: Drift's reason is on each (not outliers, not counted)`
                : "Role members the rule is not about, with Drift's reason: not outliers, and not counted in the evidence"
            }
            actions={
              source ? (
                <Button size="sm" variant="ghost" aria-expanded={exemptOpen} onClick={() => setExemptOpenFor(exemptOpen ? null : row.id)}>
                  {exemptOpen ? "Hide" : `Show ${row.exempt!.length}`}
                </Button>
              ) : undefined
            }
            padded={false}
          >
            <ExemptKinds exempt={row.exempt!} />
            {exemptOpen && (
              <ul className="st-outliers">
                {row.exempt!.map((o) => {
                  const kind = exemptionKind(o.code);
                  return (
                    <li key={`${o.path}#${o.symbol}`}>
                      <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => onOutlier(o)}>
                        <Icon name="dot" size={13} className="t-muted" />
                        <span className="dui-mono cv-outlier__path">{o.path}</span>
                        <span className="dui-mono">{o.symbol}</span>
                        <span className="t-muted t-caption">:{o.line}</span>
                        {kind && (
                          <Tag className="cv-exempt__kind" title={`${kind.why} (code ${kind.code})`}>
                            {kind.label}
                          </Tag>
                        )}
                        <span className="t-caption t-secondary cv-exempt__why">{o.reason}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
        {(row.inherited?.length ?? 0) > 0 && (
          <Panel
            className="st-span2 cv-sec"
            title={
              <>
                Hold it through a base <span className="t-muted">{row.inherited!.length}</span>
              </>
            }
            subtitle="Holders whose in-repo base class declares it, not their own body"
            padded={false}
          >
            <ul className="st-outliers">
              {row.inherited!.map((o) => (
                <li key={`${o.path}#${o.symbol}`}>
                  <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => onOutlier(o)}>
                    <Icon name="ok" size={13} className="t-success" />
                    <span className="dui-mono cv-outlier__path">{o.path}</span>
                    <span className="dui-mono">{o.symbol}</span>
                    <span className="t-muted t-caption">:{o.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {(row.derived?.length ?? 0) > 0 && (
          <Panel
            className="st-span2 cv-sec"
            title={
              <>
                Hold it through a derived wrapper <span className="t-muted">{row.derived!.length}</span>
              </>
            }
            subtitle="Holders wrapped in a binding built on the rule's wrapper (it only adds middleware, a schema or metadata)"
            padded={false}
          >
            <ul className="st-outliers">
              {row.derived!.map((o) => (
                <li key={`${o.path}#${o.symbol}`}>
                  <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => onOutlier(o)}>
                    <Icon name="ok" size={13} className="t-success" />
                    <span className="dui-mono cv-outlier__path">{o.path}</span>
                    <span className="dui-mono">{o.symbol}</span>
                    <span className="t-muted t-caption">:{o.line}</span>
                    <span className="t-caption t-secondary cv-exempt__why">
                      {shortRef(o.wrapper)}, built on {shortRef(o.from)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <Panel className="st-span2 cv-sec" title={t("conventions.audit")} subtitle="Decisions made in this Studio (Drift itself keeps no history)">
          {audit.length === 0 ? (
            <p className="t-muted t-body-sm">{t("conventions.noAudit")}</p>
          ) : (
            <ul className="st-audit">
              {audit
                .slice()
                .reverse()
                .map((a, i) => (
                  <li key={i}>
                    <StateLabel tone={a.ok ? "success" : "danger"} icon={a.ok ? "ok" : "blocked"}>
                      {a.decision}
                    </StateLabel>
                    <span>{a.user}</span>
                    <span className="t-muted">{relTime(a.at)}</span>
                    <code className="st-cmd">{a.command}</code>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="st-actions cv-actions" role="group" aria-label="Decision">
        <Button variant="primary" icon="check" shortcut="a" onClick={() => onDecide("accept")} disabled={!canDecide || !!pending}>
          {t("conventions.accept")}
        </Button>
        {row.status === "accepted" && row.mode === "block" ? (
          <Button variant="secondary" icon="info" shortcut="d" onClick={() => onDecide("advise")} disabled={!canDecide || !!pending}>
            Set to advise
          </Button>
        ) : (
          <Button
            variant={blockDecision(row) !== "force_block" || forceBlockIsDanger(row) ? "danger" : "secondary"}
            icon="blocked"
            shortcut="b"
            className="cv-blockbtn"
            onClick={() => onDecide(blockDecision(row))}
            disabled={!canDecide || !!pending || row.experimental}
            title={row.experimental ? "Wiring rules never block: drift review --block refuses them, even with --force" : blockDecision(row) === "force_block" ? `A suggestion: blocking it needs --force, after you confirm. ${recordText(row)}` : undefined}
          >
            {blockDecision(row) !== "force_block" ? t("conventions.block") : forceBlockIsDanger(row) ? "Block anyway" : "Block…"}
          </Button>
        )}
        <Button variant="secondary" icon="x" shortcut="r" onClick={() => onDecide("reject")} disabled={!canDecide || !!pending}>
          {t("conventions.reject")}
        </Button>
        <div className="st-actions__cmd">
          <span className="t-caption t-muted">{t("conventions.willRun")}</span>
          <code className="st-cmd" title="The command this decision runs">
            {canDecide ? command(repoPath, pending ?? "accept", row.id) : "run drift init to add it to the policy"}
          </code>
        </div>
        <span className="st-actions__hint t-caption t-muted">{pending ? `${pending} pending: u to undo` : "Applies after 5 s; u undoes"}</span>
      </div>
    </div>
  );
}

/** What a wiring rule (#38) registers where, from census's `wiring` hint; and whether the flag is off. */
function WiringNote({ row, wiring, onRegistry }: { row: ConventionRow; wiring: "on" | "off" | "unknown"; onRegistry(path: string, line: number): void }) {
  const reg = row.wiring?.registry ?? null;
  const rule = row.rule;
  return (
    <div className="cv-wiring" style={{ marginBottom: 10 }}>
      {wiring === "off" && (
        <p className="t-body-sm cv-wiring__off">
          <StateLabel tone="warning" icon="attention">
            Inert
          </StateLabel>{" "}
          The experimental wiring feature is off, so drift check, the hooks and PR mode skip this convention, and drift init drops it. Turn it on with{" "}
          <span className="dui-mono">{WIRING_FLAG_HELP}</span>.
        </p>
      )}
      {rule.type === "registered_in" && (
        <p className="t-body-sm t-secondary">
          Members are listed in {reg ? <strong>{reg.label}</strong> : <span className="dui-mono">{rule.slot}</span>}
          {rule.path ? (
            <>
              {" "}
              of <span className="dui-mono">{reg ? wireAt(reg) : rule.path}</span>
            </>
          ) : (
            " (some list of that kind, in any file)"
          )}
          {row.wiring?.lists && row.wiring.lists > 1 ? `, a family of ${num(row.wiring.lists)} lists` : ""}
          {rule.reach ? ", directly or in the lists it reaches" : ""}
          {rule.named ? (
            <>
              {" "}
              (members named <span className="dui-mono">{rule.named}</span>)
            </>
          ) : null}
          .{reg?.like ? ` Like ${reg.like.name}${reg.like.line > 0 ? `, listed at line ${reg.like.line}` : ""}.` : ""}
        </p>
      )}
      {rule.type === "mirrors_keys" && (
        <p className="t-body-sm t-secondary">
          Keys added to <span className="dui-mono">{rule.from}</span> are also added to <span className="dui-mono">{rule.to}</span>
          {row.wiring?.history ? `: learned from ${num(row.wiring.history.commits)} commits of git history${row.wiring.history.head ? ` (to ${row.wiring.history.head.slice(0, 7)})` : ""}` : ""}.
        </p>
      )}
      {reg && (
        <Button size="sm" variant="ghost" icon="code" onClick={() => onRegistry(reg.path, reg.line)} style={{ marginTop: 6 }}>
          Open {reg.path.split("/").pop()}
          {reg.line > 0 ? ` at line ${reg.line}` : ""}
        </Button>
      )}
    </div>
  );
}

export function conventionMarkdown(r: ConventionRow): string {
  const lines = [
    `**Drift convention ${mdCode(r.id)}** (${r.status}${r.status === "accepted" ? `, ${r.mode}` : ""})`,
    "",
    `> ${mdCode(r.summary)}`,
    "",
    mdTable(
      ["Evidence", "Value"],
      [
        ["Follow it", `${r.evidence.holders}/${r.evidence.total}`],
        ["Lower bound", r.evidence.lower_bound.toFixed(2)],
        ["Lift", r.evidence.lift.toFixed(1)],
        ...(r.tier ? [["Tier", `${r.tier}${tierReasonText(r) ? ` (${tierReasonText(r)})` : ""}`]] : []),
        ...(r.language ? [["Language", languageText(r.language)!.label]] : []),
        ...(r.exempt?.length ? [["Not about", exemptionKinds(r.exempt).map((k) => `${k.n} ${k.label}`).join(", ")]] : []),
        ...(r.uncheckedMembers > 0 ? [["Not checked", uncheckedMembersText(r.uncheckedMembers)!]] : []),
      ],
    ),
    "",
    `Example: ${mdCode(`${r.example.path}#${r.example.symbol}`)}`,
  ];
  if (r.outliers?.length) lines.push("", "Outliers:", mdFence(r.outliers.map((o) => `${o.path}:${o.line} ${o.symbol}`).join("\n")));
  return lines.join("\n");
}

/** How many exempt members each of Drift's exemption kinds (`exempt[].code`) took out of the rule. */
function ExemptKinds({ exempt }: { exempt: { code?: string }[] }) {
  const kinds = exemptionKinds(exempt).filter((k) => k.code);
  if (kinds.length === 0) return null;
  return (
    <div className="st-row st-wrap cv-exempt__kinds" aria-label="Exempt members by kind">
      {kinds.map((k) => (
        <span key={k.code} className="t-caption t-secondary" title={exemptionKind(k.code)!.why}>
          <span className="t-num">{num(k.n)}</span> {k.label}
        </span>
      ))}
    </div>
  );
}

/** Files census could not parse for lack of stack (census `unchecked`, #32): left out of every count, so a role may be larger than it shows. */
/** Decision D13-py: while census says Python proposals are off and it withheld some, say so and how to turn them on. */
function PythonProposalsNote({ state: p }: { state: PythonProposalsState | null }) {
  const head = pythonProposalsText(p);
  if (!head || p?.state !== "off") return null;
  return (
    <p className="st-note cv-python-off" role="note">
      <Icon name="info" size={12} /> <b>{head}</b>. Turn them on with <span className="dui-mono">{p.optIn}</span>; Python conventions you accepted, Python facts and the security inventory are unaffected.
    </p>
  );
}

function CensusUnchecked({ paths }: { paths: string[] }) {
  const head = uncheckedFilesText(paths);
  if (!head) return null;
  return (
    <details className="st-note cv-unchecked-files">
      <summary>
        <Icon name="attention" size={12} className="t-warning" /> <b>{head}</b>: left out of every count, so roles and evidence may be larger than shown
      </summary>
      <ul className="st-plainlist">
        {paths.slice(0, 8).map((p) => (
          <li key={p} className="dui-mono t-caption t-truncate" title={p}>
            {p}
          </li>
        ))}
        {paths.length > 8 && <li className="t-caption t-muted">and {num(paths.length - 8)} more</li>}
      </ul>
    </details>
  );
}

/** Why census proposed nothing: what a role needs, and the largest role Drift saw (`largest_role`). Numbers as census --json states them. */
function NoConventions({ c }: { c: { units: number; roles: number; largestRole: { summary: string; members: number } | null } }) {
  return (
    <p className="t-body-sm t-secondary st-nocv">
      Drift read {num(c.units)} units (symbols, files, models and packages) in {num(c.roles)} roles and proposed nothing: a convention needs a role of roughly 20 or more similar
      symbols where one pattern clearly dominates and is rarer elsewhere.
      {c.largestRole && (
        <>
          {" "}
          The largest role here, apart from the role of whole files, has {num(c.largestRole.members)} {c.largestRole.members === 1 ? "member" : "members"}:{" "}
          <span className="dui-mono">{c.largestRole.summary}</span>.
        </>
      )}
    </p>
  );
}

/** Outliers a card lists before "Show all". */
const OUTLIERS_SHOWN = 5;
/** Longest reason Drift accepts for an exception (`drift_mine::policy::MAX_EXCEPTION_REASON`). */
const MAX_REASON = 120;

/** A reason as Drift stores it: whitespace collapsed, trimmed. */
function oneLine(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean).join(" ");
}

/** A suggestion's rule-family record (suggestion-tier labels), as the block button and its dialog say it. */
function recordText(row: ConventionRow): string {
  const r = suggestionRecord(row);
  if (!r) return "Its rule family has no suggestion-tier record Drift reported, so blocking it is not offered as the red action.";
  // Floored, as Drift's own text does, so a rate just under half never reads as half.
  const pct = Math.floor(r.rate * 100);
  const why = forceBlockIsDanger(row) ? "" : r.n < RECORD_MIN_CARDS ? ` (fewer than ${RECORD_MIN_CARDS} labelled, so not offered as the red action)` : " (under half, so not offered as the red action)";
  return `Its rule family's suggestions were accepted ${pct}% of ${r.n} on the dev labels${why}.`;
}

/** Outliers a reviewer marked fine (conventions.yaml `exceptions`), each with the reason and a way to check it again. */
function FineList({ fine, canEdit, onOpen, onUndo }: { fine: FineOutlier[]; canEdit: boolean; onOpen(o: FineOutlier): void; onUndo(member: string): void }) {
  return (
    <div className="cv-finelist">
      <div className="dui-overline cv-label st-pad">Marked fine by a reviewer</div>
      <ul className="st-outliers">
        {fine.map((o) => (
          <li key={o.member} className="cv-outlier">
            <button type="button" className="st-pathlink st-pathlink--wrap" onClick={() => onOpen(o)} disabled={o.line === null}>
              <Icon name="ok" size={13} className="t-success" />
              <span className="dui-mono cv-outlier__path">{o.path}</span>
              <span className="dui-mono cv-outlier__sym">{o.symbol}</span>
              {o.line !== null ? <span className="t-muted t-caption">:{o.line}</span> : <span className="t-muted t-caption">not an outlier now</span>}
              <span className="t-caption t-secondary cv-exempt__why">fine because {o.reason}</span>
            </button>
            {canEdit && (
              <Button size="sm" variant="ghost" className="cv-outlier__fine" onClick={() => onUndo(o.member)} title="Remove the exception: drift check reports it again (drift review --unexempt)">
                Check again
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Files a person set apart as a different kind, answering the one question (conventions.yaml `different_kind`), as
 * `drift review --show` lists them: each with the entry points confirmed one by one, and how many of its members
 * census lists as exempt for it now (code `different_kind`). An entry point under an auth or validation rule that was
 * not confirmed is not covered: it stays flagged [STRICT].
 */
function SetApartList({ files, exempt }: { files: PolicyDifferentKind[]; exempt: Exempt[] }) {
  return (
    <Panel className="cv-sec cv-setapart" title={`Set apart as a different kind (${num(files.length)} ${files.length === 1 ? "file" : "files"})`} subtitle='Answered "No, these are different": drift check lists their members as exempt (code different_kind), not as violations'>
      <ul className="st-outliers st-pad">
        {files.map((f) => {
          const now = exempt.filter((e) => e.code === "different_kind" && e.path === f.path).length;
          return (
            <li key={f.path} className="cv-setapart__file">
              <Icon name="ok" size={13} className="t-success" /> <span className="dui-mono">{f.path}</span>
              {f.entry_points?.length ? <span className="t-caption t-secondary"> · entry points confirmed: {f.entry_points.join(", ")}</span> : null}
              <span className="t-caption t-muted"> · {now ? `${num(now)} member(s) exempt now` : "no member exempt now"}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * A block candidate's one question (round 11, WS-K): the convention's holders and the members it would flag, by file,
 * and "Are these the same kind of thing?". Yes accepts; "No, these are different" lets the person pick the files that
 * are, with a separate tick for each entry point under an auth or validation rule [STRICT], and accepts with them set
 * apart; "Not a convention" rejects. Every answer shows the drift review command it runs.
 */
export function QuestionPanel({ q, repoPath, onAnswer }: { q: ReviewQuestion; repoPath: string; onAnswer(answer: Answer, setApart: string[], confirmEntry: string[]): Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPicking(false);
    setPicked(new Set());
    setTicked(new Set());
  }, [q.id]);
  const plan = answerPlan(q, picked, ticked);
  const files = q.flagged.filter((f) => picked.has(f.path)).map((f) => f.path);
  const toggle = (set: Set<string>, key: string, put: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    put(next);
  };
  const send = async (a: Answer, setApart: string[], confirm: string[]) => {
    setBusy(true);
    try {
      await onAnswer(a, setApart, confirm);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="cv-sec cv-question" title={QUESTION} subtitle="One question for this block candidate. Unanswered, it stays a candidate and reaches no agent.">
      <div className="st-pad st-stack">
        <div>
          <p className="t-caption t-secondary">These follow it ({num(q.holders_total)} of {num(q.members)})</p>
          <ul className="st-outliers cv-question__holders">
            {q.holders.map((h, i) => (
              <li key={`${h.path}#${h.symbol}`}>
                <Icon name="ok" size={13} className="t-success" /> <span className="dui-mono">{h.path}</span> <span className="dui-mono">{h.symbol}</span> <span className="t-muted t-caption">:{h.line}</span>
                {i === 0 && <span className="t-muted t-caption"> (the example)</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="t-caption t-secondary">
            It would flag {num(q.flagged_total)} in {num(q.flagged.length)} file(s){picking ? ": tick the files whose members are a different kind" : ""}
          </p>
          {q.flagged.length === 0 ? (
            <p className="t-muted">None in the code now.</p>
          ) : (
            <ul className="st-outliers cv-question__flagged">
              {q.flagged.map((f) => (
                <li key={f.path} className="cv-question__file">
                  <label className="st-row">
                    {picking && <input type="checkbox" checked={picked.has(f.path)} onChange={() => toggle(picked, f.path, setPicked)} aria-label={`Set apart ${f.path}`} />}
                    <Icon name="attention" size={13} className="t-warning" />
                    <span className="dui-mono">{f.path}</span>
                    <span className="dui-mono t-secondary">{f.members.map((m) => m.symbol).join(", ")}</span>
                    {f.members.some((m) => m.needs_confirmation) && (
                      <Badge tone="warning" variant="outline" title="An entry point under an auth or validation rule: setting its file apart covers it only if you also tick it below">
                        entry point
                      </Badge>
                    )}
                  </label>
                  {picking &&
                    picked.has(f.path) &&
                    needsTick(f).map((m) => (
                      <label key={m} className="st-row cv-question__entry">
                        <input type="checkbox" checked={ticked.has(m)} onChange={() => toggle(ticked, m, setTicked)} aria-label={`Also set apart the entry point ${m}`} />
                        <span className="t-body-sm">
                          Also set apart <span className="dui-mono">{m}</span>: an entry point under an auth or validation rule, which drift check would then no longer flag
                        </span>
                      </label>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
        {!picking ? (
          <div className="st-row st-wrap cv-question__answers">
            <Button variant="primary" icon="ok" disabled={busy} onClick={() => void send("same", [], [])}>
              Yes, the same kind
            </Button>
            <Button variant="secondary" disabled={busy || q.flagged.length === 0} onClick={() => setPicking(true)} title={q.flagged.length === 0 ? "It flags nothing now" : "Pick the files whose flagged members are a different kind: they are set apart by path, and the card is accepted"}>
              No, these are different…
            </Button>
            <Button variant="ghost" icon="x" disabled={busy} onClick={() => void send("not-a-convention", [], [])}>
              Not a convention
            </Button>
          </div>
        ) : (
          <div className="st-stack cv-question__pick">
            <p className="t-body-sm cv-question__plan">
              {files.length === 0
                ? "Tick at least one file."
                : `${plan.setApart.length} file(s) set apart: ${plan.covered} flagged member(s) exempt${plan.kept.length ? `; ${plan.kept.length} entry point(s) stay flagged (not ticked)${files.length > plan.setApart.length ? `, so ${files.length - plan.setApart.length} picked file(s) are not written` : ""}` : ""}. The card is then accepted.`}
            </p>
            <div className="st-row st-wrap">
              <Button variant="primary" disabled={busy || files.length === 0} onClick={() => void send("different", files, plan.confirmEntry)}>
                Accept with these set apart
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPicking(false)}>
                Back
              </Button>
            </div>
            {files.length > 0 && <code className="st-cmd">{answerCommand(repoPath, q.id, "different", files, plan.confirmEntry)}</code>}
          </div>
        )}
      </div>
    </Panel>
  );
}
