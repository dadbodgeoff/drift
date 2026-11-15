// Home: what needs a person now. Each block has a count and a key to jump.
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { BarList, Badge, Button, EvidenceChip, Icon, type IconName, Kbd, type LoopStation, LoopStrip, Panel, Skeleton, StackedBar, StateLabel } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys, useCheck, useFacts, useSecurity } from "@/entities/drift";
import { ACCURACY, conventionLanguage, countConventions, familyHint, pctOf, useConventions } from "@/entities/convention";
import { VIOLATION_STATUS, checkCounts, stateOf, statusOf } from "@/entities/check";
import { diffSnapshots, makeSnapshot, useHistory } from "@/entities/history";
import { SKIP_REASON, failsClosed, overview } from "@/entities/facts";
import { advisedViolations, primedRules, useSessions } from "@/entities/session";
import { headline } from "@/entities/security";
import { useApi } from "@/shared/api";
import { t } from "@/shared/i18n";
import { num, plural, relTime } from "@/shared/lib/format";
import { middlePath } from "@/shared/lib/path";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";
import { WiringPanel } from "./WiringPanel";

export function AttentionView() {
  const api = useApi();
  const { repo } = useRepo();
  const facts = useFacts(repo);
  const conv = useConventions(repo);
  const check = useCheck(repo);
  const security = useSecurity(repo);
  const history = useHistory(repo);
  const sessions = useSessions(repo, false);
  const openCode = useOpenCode();

  const withState = (sessions.data ?? []).filter((s) => s.hasState).slice(0, 20);
  const states = useQueries({
    queries: withState.map((s) => ({ queryKey: keys.sessionState(repo!, s.id), queryFn: () => api.readSessionState(repo!, s.id), staleTime: 30_000 })),
  });
  const spoke = withState
    .map((s, i) => ({ s, st: states[i]?.data }))
    .filter((x) => x.st && (advisedViolations(x.st).length > 0 || (x.st.blocks ?? 0) > 0));

  const counts = countConventions(conv.rows);
  const reviewable = conv.rows.filter((r) => r.status !== "not_in_policy");
  const pending = conv.rows.filter((r) => r.status === "proposed");
  const cc = check.data ? checkCounts(check.data.data) : null;
  const newV = (check.data?.data.violations ?? []).filter((v) => stateOf(v) === "new");

  const cur = useMemo(() => {
    if (!facts.data || !check.data || !security.data) return null;
    return makeSnapshot({
      at: facts.data.at,
      commit: facts.data.provenance.commit,
      files: facts.data.data.files.length,
      pending: pending.map((p) => p.id),
      check: check.data.data,
      security: security.data.data,
    });
  }, [facts.data, check.data, security.data, pending]);
  const prev = history.data && facts.data ? (history.data.snapshots.filter((s) => s.at < facts.data!.at).at(-1) ?? null) : null;
  const diff = cur && prev ? diffSnapshots(prev, cur) : null;
  const sec = security.data ? headline(security.data.data) : null;
  const secChanges = diff ? diff.unguarded.added.length + diff.reaching.added.length + diff.sinks.added.length + diff.leaks.added.length : 0;

  const ov = useMemo(() => (facts.data ? overview(facts.data.data) : null), [facts.data]);
  const enforced = states.reduce(
    (n, q) => ({ primed: n.primed + primedRules(q.data).length, advised: n.advised + advisedViolations(q.data).length, blocks: n.blocks + (q.data?.blocks ?? 0) }),
    { primed: 0, advised: 0, blocks: 0 },
  );
  const decided = reviewable.length - pending.length;
  const loop: LoopStation[] = [
    {
      step: "Learn",
      value: ov ? num(ov.files) : "–",
      unit: "files read",
      detail: conv.census ? `${num(conv.census.units)} units in ${num(conv.census.roles)} roles, by structure only` : ov ? `${num(ov.symbols)} symbols` : undefined,
      onClick: () => navigate("map"),
      shortcut: "g m",
    },
    {
      step: "Propose",
      value: num(conv.rows.length),
      unit: "conventions with evidence",
      detail: conv.params
        ? `each at lower bound ≥ ${conv.params.min_lower_bound} and lift ≥ ${conv.params.min_lift}${conv.params.min_lift_external_call ? ` (${conv.params.min_lift_external_call} for library calls and directives)` : ""}`
        : undefined,
      onClick: () => navigate("conventions"),
      shortcut: "g c",
    },
    {
      step: "Decide",
      value: conv.policy ? `${num(decided)}/${num(reviewable.length)}` : "–",
      unit: conv.policy ? "decided by people" : "no policy yet: drift init",
      detail: conv.policy
        ? `${counts.accepted} accepted (${counts.blocking} block${counts.blockInPolicyOnly ? `; ${counts.blockInPolicyOnly} more block in policy but advise: role under 15` : ""}) · ${counts.rejected} rejected`
        : undefined,
      tone: pending.length ? "accent" : undefined,
      onClick: () => navigate("conventions"),
      shortcut: "g c",
    },
    {
      step: "Enforce",
      value: num(enforced.primed + enforced.advised + enforced.blocks),
      unit: "times Drift spoke to agents",
      detail: `${enforced.primed} primed · ${enforced.advised} advised · ${enforced.blocks} blocked, in ${(sessions.data ?? []).filter((s) => s.hasState).length > withState.length ? `the latest ${withState.length} sessions with Drift state` : plural(withState.length, "session", "sessions")}`,
      onClick: () => navigate("sessions"),
      shortcut: "g s",
    },
    {
      // The beta's figure (docs/ACCURACY.md): out of sample first; the in-sample one is named as such.
      step: "Measure",
      value: `${pctOf(ACCURACY.shown)}%`,
      unit: "of shown TS/JS cards accepted on repos Drift was not tuned on",
      detail: `${ACCURACY.shown.k} of ${ACCURACY.shown.n}, labelled blind · ${ACCURACY.shownInSample}% in-sample (the build set) · ${ACCURACY.doc}`,
      onClick: () => navigate("studies"),
      shortcut: "g t",
    },
  ];
  const loopBlock = (
    <section className="at-loop" aria-labelledby="at-loop-title">
      <div className="at-loop__head">
        <h3 id="at-loop-title" className="st-section-title">
          How Drift works on {repo?.name}
        </h3>
        <span className="t-caption t-muted">Learned from the code, proposed with evidence, decided by people, enforced on agents, measured.</span>
      </div>
      <LoopStrip label={`Drift's loop on ${repo?.name ?? "this repository"}`} stations={loop} />
    </section>
  );
  const allClear = !!(cc && sec && conv.policy && pending.length === 0 && cc.new === 0 && spoke.length === 0 && secChanges === 0);

  // Severity first: what blocks, then what advises, then what waits for a decision.
  const attnCards = [
    { key: "proposals", severity: pending.length ? 1 : 0, node: (
        <AttnCard
          icon="review"
          title={t("attention.pending")}
          keys="g c"
          tone={pending.length ? "accent" : "neutral"}
          value={conv.loading ? null : pending.length}
          meta={conv.policy ? t("attention.pendingHint", { n: reviewable.length - pending.length, total: reviewable.length }) : t("conventions.noPolicy")}
          onOpen={() => navigate("conventions")}
        >
          {pending.slice(0, 4).map((r) => (
            <button key={r.id} type="button" className="st-attn__row st-attn__row--2" onClick={() => navigate("conventions", r.id)}>
              <span className="st-attn__line">
                <span className="dui-mono t-caption t-muted">{r.id}</span>
                <EvidenceChip compact holders={r.evidence.holders} total={r.evidence.total} lowerBound={r.evidence.lower_bound} />
                {(() => {
                  const h = familyHint(r.family, conventionLanguage(r.example.path));
                  return h && h.rate < 0.5 ? (
                    <Badge tone="warning" icon="attention" title={`${h.family}: ${Math.round(h.rate * 100)}% accepted in the study`}>
                      look closely
                    </Badge>
                  ) : null;
                })()}
              </span>
              <span className="st-attn__summary">{r.summary}</span>
            </button>
          ))}
        </AttnCard>
    ) },
    { key: "violations", severity: cc?.blocking ? 3 : cc?.new ? 2 : 0, node: (
        <AttnCard
          icon="violation"
          title={t("attention.newViolations")}
          keys="g v"
          tone={cc?.blocking ? "danger" : cc?.new ? "warning" : "neutral"}
          value={cc ? cc.new : null}
          meta={cc ? (diff ? t("attention.newSince", { n: diff.newViolations.added.length }) : t("attention.firstScan")) : check.isError ? "drift check failed" : undefined}
          badge={cc?.blocking ? <StateLabel tone="danger" icon="blocked">{cc.blocking} blocking</StateLabel> : undefined}
          onOpen={() => navigate("check")}
        >
          {newV.slice(0, 4).map((v) => (
            <button
              key={`${v.id}${v.path}${v.symbol}`}
              type="button"
              className="st-attn__row"
              onClick={() => openCode({ path: v.path, line: v.line, context: { title: v.summary, detail: `${v.id} · ${v.evidence} · copy ${v.example}`, tone: v.mode === "block" ? "danger" : "warning" } })}
            >
              <StateLabel tone={VIOLATION_STATUS[statusOf(v)].tone} icon={VIOLATION_STATUS[statusOf(v)].icon}>
                {VIOLATION_STATUS[statusOf(v)].label}
              </StateLabel>
              <span className="dui-mono t-caption t-muted">{v.id}</span>
              <span className="dui-mono t-truncate" title={`${v.path}:${v.line}`}>
                {middlePath(v.path, 40)}:{v.line}
              </span>
              <span className="t-muted t-caption">{v.symbol}</span>
              {diff?.newViolations.added.includes(`${v.id} ${v.path}#${v.symbol}`) && <Badge tone="info">new since last scan</Badge>}
            </button>
          ))}
        </AttnCard>
    ) },
    { key: "sessions", severity: spoke.some((x) => (x.st?.blocks ?? 0) > 0) ? 3 : spoke.length ? 2 : 0, node: (
        <AttnCard
          icon="session"
          title={t("attention.sessions")}
          keys="g s"
          tone={spoke.some((x) => (x.st?.blocks ?? 0) > 0) ? "danger" : spoke.length ? "warning" : "neutral"}
          value={sessions.isLoading ? null : spoke.length}
          meta={sessions.data ? `of ${plural(sessions.data.length, "session", "sessions")} in this repository` : undefined}
          onOpen={() => navigate("sessions")}
        >
          {spoke.slice(0, 4).map(({ s, st }) => (
            <button key={s.id} type="button" className="st-attn__row" onClick={() => navigate("sessions", s.id)}>
              {(st?.blocks ?? 0) > 0 ? (
                <StateLabel tone="danger" icon="blocked">
                  blocked {st!.blocks}×
                </StateLabel>
              ) : (
                <StateLabel tone="warning" icon="attention">
                  advised
                </StateLabel>
              )}
              <span className="t-truncate">{s.title ?? s.id}</span>
              <span className="t-muted t-caption">{relTime(s.modified)}</span>
            </button>
          ))}
        </AttnCard>
    ) },
    { key: "security", severity: secChanges ? 2 : 0, node: (
        <AttnCard
          icon="shield"
          title={t("attention.security")}
          keys="g x"
          tone={secChanges ? "warning" : "neutral"}
          value={sec ? (diff ? secChanges : "n/a") : null}
          meta={diff ? t("attention.securitySince") : sec ? t("attention.firstScan") : undefined}
          onOpen={() => navigate("security")}
        >
          {diff && (
            <ul className="st-attn__list">
              <SecLine label="unguarded entry points" added={diff.unguarded.added} />
              <SecLine label="entry points reaching risky operations" added={diff.reaching.added} />
              <SecLine label="risky operations" added={diff.sinks.added} />
              <SecLine label="client leak groups" added={diff.leaks.added} />
            </ul>
          )}
        </AttnCard>
    ) },
  ].sort((x, y) => y.severity - x.severity);

  return (
    <div className="st-page">
      <header className="st-pagehead">
        <div>
          <h2 className="t-h1">{repo?.name}</h2>
          <p className="t-secondary">
            {t("attention.subtitle")}
            {prev && (
              <>
                {" "}
                · compared with the scan {relTime(prev.at)}
                {prev.commit && (
                  <>
                    {" "}
                    at <span className="dui-mono">{prev.commit}</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {loopBlock}

      {allClear && (
        <div className="st-allclear" role="status">
          <Icon name="ok" size={16} /> <b>{t("attention.allClear")}</b> <span className="t-secondary">{t("attention.allClearBody")}</span>
        </div>
      )}

      <div className="st-attn">
        {attnCards.map((c, i) => (
          <div key={c.key} className={`st-attn__slot${i === 0 && c.severity >= 2 ? " is-lead" : ""}`}>
            {c.node}
          </div>
        ))}
      </div>

      <h3 className="st-section-title">{t("attention.vitals")}</h3>
      <div className="st-grid st-grid--vitals">
        <Panel title="Codebase" subtitle={facts.data ? `${num(facts.data.data.files.length)} files Drift scanned` : undefined}>
          {ov ? (
            <div className="st-vitals">
              <Vital label="Files" value={num(ov.files)} />
              <Vital label="Packages" value={num(ov.packages.length)} />
              <Vital label="Symbols" value={num(ov.symbols)} />
              <Vital label="Entry points" value={num(ov.entryPointTotal)} />
              <Vital label="Parse errors" value={num(ov.parseErrors.length)} tone={ov.parseErrors.length ? "warning" : undefined} />
              <Vital label="Skipped" value={num(ov.skipped.reduce((n, s) => n + s.count, 0))} tone={ov.skipped.some((s) => failsClosed(s.reason)) ? "warning" : undefined} />
            </div>
          ) : (
            <Skeleton lines={3} />
          )}
          {ov && ov.languages.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <StackedBar label="Files by language" segments={ov.languages.slice(0, 6).map((l, i) => ({ label: l.lang, value: l.count, color: i }))} />
            </div>
          )}
        </Panel>
        <Panel title="Entry points by framework" subtitle={ov ? plural(ov.entryPointTotal, "entry point", "entry points") : undefined}>
          {ov ? (
            <BarList
              label="Entry points by adapter and kind"
              items={ov.entryPoints.slice(0, 8).map((e, i) => ({ label: <span><span className="t-muted">{e.adapter}</span> {e.kind}</span>, text: `${e.adapter} ${e.kind}`, value: e.count, color: i % 8, onClick: () => navigate("security") }))}
            />
          ) : (
            <Skeleton lines={5} />
          )}
        </Panel>
        <Panel title="Conventions" subtitle={conv.policy ? conv.policy.engine : undefined} actions={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate("conventions")}>Review</Button>}>
          {conv.loading ? (
            <Skeleton lines={3} />
          ) : (
            <>
              <StackedBar
                label="Conventions by status"
                segments={[
                  { label: "blocking", value: counts.blocking, color: "danger" },
                  { label: "accepted, advising", value: counts.accepted - counts.blocking, color: "success" },
                  { label: "proposed", value: counts.proposed, color: "accent" },
                  { label: "rejected", value: counts.rejected, color: "muted" },
                ]}
              />
              <div className="st-vitals" style={{ marginTop: 14 }}>
                <Vital label="Baselined in drift.lock" value={num(conv.lock.length)} />
                <Vital label="Suppressed" value={cc ? num(cc.suppressed) : "–"} />
                <Vital label="Held back (neighbour gate)" value={cc ? (check.data?.provenance.neighbourGate === "off" ? "gate off" : num(cc.held)) : "–"} />
                <Vital label="Fixed lock entries" value={cc ? num(cc.fixed) : "–"} />
              </div>
            </>
          )}
        </Panel>
        <Panel title="Packages" subtitle={ov ? `${ov.packages.length} with source files` : undefined}>
          {ov ? <BarList label="Files per package" items={ov.packages.slice(0, 8).map((p) => ({ label: <span className="dui-mono">{p.path || "(root)"}</span>, text: p.path || "(root)", value: p.files, color: "info", onClick: () => navigate("map", null, p.path ? { focus: p.path } : undefined) }))} /> : <Skeleton lines={5} />}
        </Panel>
        {conv.wiring && <WiringPanel wiring={conv.wiring} violations={check.data?.data.violations ?? null} />}
        {ov && ov.skipped.length > 0 && (
          <Panel title="Skipped files" subtitle="Drift did not analyse these: no facts, and no convention is checked in them">
            <ul className="at-skips">
              {ov.skipped.map((s) => {
                const r = SKIP_REASON[s.reason];
                return (
                  <li key={s.reason}>
                    <div className="st-row st-wrap">
                      {failsClosed(s.reason) ? (
                        <StateLabel tone="warning" icon="attention">
                          {r?.label ?? s.reason}
                        </StateLabel>
                      ) : (
                        <span className="t-title">{r?.label ?? s.reason}</span>
                      )}
                      <span className="t-num t-secondary">{num(s.count)}</span>
                      <span className="dui-mono t-caption t-muted">{s.reason}</span>
                    </div>
                    <p className="t-caption t-muted">{r?.why ?? "Reported by drift scan."}</p>
                    {(failsClosed(s.reason) || s.reason === "not_utf8") && (
                      <ul className="st-plainlist">
                        {s.paths.slice(0, 8).map((p) => (
                          <li key={p} className="dui-mono t-body-sm t-truncate" title={p}>
                            {p}
                          </li>
                        ))}
                        {s.count > 8 && <li className="t-caption t-muted">and {num(s.count - 8)} more</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        {ov && ov.parseErrors.length > 0 && (
          <Panel title="Parse errors" subtitle="Facts for these files are best-effort">
            <ul className="st-plainlist">
              {ov.parseErrors.slice(0, 12).map((p) => (
                <li key={p}>
                  <button type="button" className="st-link dui-mono" onClick={() => openCode({ path: p })}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function AttnCard(props: { icon: IconName; title: string; keys: string; value: number | "n/a" | null; meta?: string; tone: "accent" | "danger" | "warning" | "neutral"; badge?: React.ReactNode; onOpen(): void; children?: React.ReactNode }) {
  return (
    <section className={`st-attn__card is-${props.tone}`} aria-label={props.title}>
      <button type="button" className="st-attn__head" onClick={props.onOpen}>
        <span className="st-attn__icon">
          <Icon name={props.icon} size={16} />
        </span>
        <span className="st-attn__title">{props.title}</span>
        <Kbd>{props.keys}</Kbd>
      </button>
      <div className="st-attn__value">
        {props.value === null ? <Skeleton width={48} height={28} /> : props.value === "n/a" ? <span className="t-display t-muted" title="Nothing to compare with yet">–</span> : <span className="t-display">{props.value.toLocaleString()}</span>}
        {props.badge}
      </div>
      {props.meta && <div className="st-attn__meta">{props.meta}</div>}
      {props.children && <div className="st-attn__rows">{props.children}</div>}
    </section>
  );
}

function SecLine({ label, added }: { label: string; added: string[] }) {
  return (
    <li>
      <span className={added.length ? "t-warning" : "t-muted"}>+{added.length}</span> {label}
      {added.length > 0 && <span className="dui-mono t-muted t-caption st-attn__sample"> {added[0]}</span>}
    </li>
  );
}

function Vital({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="st-vital">
      <div className="st-vital__label">{label}</div>
      <div className={`st-vital__value${tone ? ` t-${tone}` : ""}`}>{value}</div>
    </div>
  );
}
