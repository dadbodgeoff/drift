// What the Check view's verdict rests on, beside the violations: each accepted mined rule's members (`standing[]`),
// what a change adds that a security baseline would hold (`security_advice[]`, PR mode with no baseline) and the
// command that would promote a practice a departure departs from (`practices.departures[].promote`). Prop-driven, so
// each renders without the app around it. None of it changes the exit code.
import { Badge, Button, StateLabel } from "@drift/ui";
import { ADVICE_HEADING, ADVICE_SETTLE, adviceGroups, sinkLabel, splitAt } from "@/entities/security";
import type { CheckStanding, SecurityAdvice, SecurityRatchet } from "@/shared/contract/drift";
import { num, plural } from "@/shared/lib/format";
import { STANDING_STATE, breaks, notCheckedText, notCheckedWhy, staleText, standingCounts, standingState, standingsById } from "./standing";

/** Reasons listed per rule before "+N more", as `drift check` lists them (main.rs `MAX_WHY_LISTED`). */
const WHY_LISTED = 3;

/**
 * Per accepted mined rule: how many members follow it, break it and could not be read (with why), whether it is
 * stale, and the mode it is checked with when that is not the file's. A member not checked is never a violation and
 * never a pass.
 */
export function StandingSection({ rows, summaries, onConvention }: { rows: CheckStanding[]; summaries: ReadonlyMap<string, string>; onConvention(id: string): void }) {
  const c = standingCounts(rows);
  const said = (["stale", "breaks", "cannot-tell", "holds", "empty"] as const).filter((k) => c[k] > 0).map((k) => `${num(c[k])} ${STANDING_STATE[k].label}`);
  return (
    <section id="ck-standing" className="ck-exempt ck-standing" aria-labelledby="ck-standing-title">
      <div className="st-row st-wrap">
        <h3 id="ck-standing-title" className="ck-exempt__title">
          <StateLabel tone="info" icon="info">
            What each rule rests on
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(rows.length)}</span>
        <span className="t-caption t-muted">
          {rows.length ? `Accepted mined rules: ${said.join(", ")}. ` : ""}Members Drift could not read are not checked and never reported: neither a violation nor a pass.
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="t-body-sm t-secondary">
          No accepted mined convention, so nothing here rests on what Drift mined. Accept a proposal in Conventions and its members are counted here: those that follow it, those that break it, and those Drift could not read.
        </p>
      ) : (
        <ul className="ck-exempt__list ck-standing__list" aria-label="Accepted rules and their members">
          {standingsById(rows).map((s) => {
            const st = STANDING_STATE[standingState(s)];
            const why = notCheckedWhy(s);
            return (
              <li key={s.id} className="ck-standing__row">
                <div className="st-row st-wrap">
                  <button type="button" className="st-link dui-mono" onClick={() => onConvention(s.id)}>
                    {s.id}
                  </button>
                  <StateLabel tone={st.tone} icon={st.icon}>
                    {st.label}
                  </StateLabel>
                  <Badge tone={s.mode === "block" ? "danger" : "neutral"} variant="outline">
                    {s.mode === "block" ? "blocks" : "advises"}
                  </Badge>
                  {summaries.get(s.id) && <span className="t-body-sm t-truncate">{summaries.get(s.id)}</span>}
                </div>
                <dl className="ck-standing__counts">
                  <div>
                    <dt>follow it</dt>
                    <dd>{num(s.holders)}</dd>
                  </div>
                  <div>
                    <dt>break it</dt>
                    <dd className={breaks(s) ? "t-warning" : undefined}>{num(breaks(s))}</dd>
                  </div>
                  <div>
                    <dt>not checked</dt>
                    <dd>{num(s.not_checked)}</dd>
                  </div>
                  <div>
                    <dt>members</dt>
                    <dd>{num(s.members)}</dd>
                  </div>
                  <div>
                    <dt>in its role</dt>
                    <dd>{num(s.role)}</dd>
                  </div>
                </dl>
                {s.not_checked > 0 && (
                  <div className="t-caption t-secondary">
                    {notCheckedText(s)}.
                    <ul className="st-plainlist ck-standing__why" aria-label={`Why members of ${s.id} were not checked`}>
                      {why.slice(0, WHY_LISTED).map((w) => (
                        <li key={w.reason}>
                          {w.reason} ({num(w.n)})
                        </li>
                      ))}
                      {why.length > WHY_LISTED && <li className="t-muted">+{why.length - WHY_LISTED} more reasons</li>}
                    </ul>
                  </div>
                )}
                {s.stale && (
                  <p className="t-caption t-secondary">
                    {staleText(s)}. <span className="dui-mono">drift review --advise {s.id}</span> keeps it as advice; <span className="dui-mono">drift review --reject {s.id}</span> drops it.
                  </p>
                )}
                {s.mode_note && <p className="t-caption t-secondary">{s.mode_note}.</p>}
                {!s.whole && <p className="t-caption t-muted">Counted over the files checked only, so whether it is stale is not decided here.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * With no baseline, in PR mode: what the change adds that a baseline would hold, as `drift check --diff-base` advises
 * (never failing). With a baseline, in either scope: what is not in it (`security`, which fails the check when it
 * adds one).
 */
export function SecurityAdviceSection({ advice, ratchet, onOpen, onSecurity }: { advice: SecurityAdvice[]; ratchet: SecurityRatchet | undefined; onOpen(path: string, line: number | null, a: SecurityAdvice): void; onSecurity(): void }) {
  const groups = adviceGroups(advice);
  const added = ratchet ? Object.values(ratchet.added).reduce((n, xs) => n + xs.length, 0) : 0;
  return (
    <section id="ck-security-advice" className="ck-exempt ck-advice" aria-labelledby="ck-security-advice-title">
      <div className="st-row st-wrap">
        <h3 id="ck-security-advice-title" className="ck-exempt__title">
          <StateLabel tone={ratchet ? (added ? "danger" : "success") : advice.length ? "warning" : "success"} icon={ratchet ? (added ? "blocked" : "ok") : advice.length ? "attention" : "ok"}>
            {ratchet ? "Security baseline" : "Security advice"}
          </StateLabel>
        </h3>
        <span className="ck-key__num">{num(ratchet ? added : advice.length)}</span>
        <span className="t-caption t-muted">{ratchet ? "Findings that are not in .drift/security.lock fail the check." : ADVICE_HEADING.replace(/^Security advice: /, "")}</span>
        <button type="button" className="st-link" onClick={onSecurity}>
          Open Security
        </button>
      </div>
      {ratchet ? (
        <div className="t-body-sm st-stack">
          <p className="t-secondary">
            Checked against the repository's security baseline: {plural(added, "finding", "findings")} not in it, {plural(ratchet.gone.length, "finding", "findings")} in it no longer found, {num(ratchet.kept)} still found.
          </p>
          {added > 0 && (
            <ul className="ck-exempt__list" aria-label="Findings not in the security baseline">
              {Object.entries(ratchet.added)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .flatMap(([kind, xs]) =>
                  xs.map((x) => (
                    <li key={`${kind}|${x.key}`} className="ck-advice__row">
                      <Badge tone="danger" variant="outline">
                        {kind}
                      </Badge>
                      <span className="dui-mono t-truncate">{x.key}</span>
                      <span className="dui-mono t-caption t-muted">{x.at}</span>
                    </li>
                  )),
                )}
            </ul>
          )}
        </div>
      ) : groups.length === 0 ? (
        <p className="t-body-sm t-secondary">
          This change adds no entry point where Drift found no guard and none that takes a tenant or owner key nothing checks. The repository has no security baseline, so this is advice either way: it fails nothing.
        </p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.kind} className="st-stack ck-advice__group">
              <h4 className="t-body-sm ck-advice__heading">
                {g.heading} <span className="t-muted">({num(g.rows.length)})</span>
              </h4>
              <ul className="ck-exempt__list" aria-label={g.heading}>
                {g.rows.map((a) => {
                  const at = splitAt(a.at);
                  return (
                    <li key={`${a.kind}|${a.key}`} className="ck-advice__row">
                      <button type="button" className="st-pathlink" onClick={() => onOpen(at.path, at.line, a)}>
                        <span className="dui-mono t-truncate">{a.at}</span>
                        <span className="dui-mono t-accent t-truncate">{a.key}</span>
                      </button>
                      <Badge tone={a.kind === "unscoped-key" ? "warning" : "danger"} variant="outline">
                        {a.kind}
                      </Badge>
                      <span className="t-caption t-secondary ck-exempt__why">
                        {a.read}
                        {a.reaches?.length ? `; reaches ${a.reaches.map(sinkLabel).join(", ")} (fed by the request)` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="t-caption t-secondary">{ADVICE_SETTLE} The Security view writes the baseline, after you confirm.</p>
        </>
      )}
    </section>
  );
}

/** A departure's promote command, for a person to run (an agent may not promote): shown whole and copyable. */
export function PromoteHint({ command, onCopy }: { command: string; onCopy(command: string): void }) {
  return (
    <span className="ck-promote">
      <span className="t-caption t-muted">To make this place's way the rule for new code here:</span>
      <code className="st-cmd ck-promote__cmd">{command}</code>
      <Button size="sm" variant="ghost" icon="copy" onClick={() => onCopy(command)} aria-label={`Copy ${command}`}>
        Copy
      </Button>
    </span>
  );
}
