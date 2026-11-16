// "May be promoted": every practice Drift says may be made a convention now (`drift practices promote --list --json`),
// each with what it accepts (named ways, a mechanism whole, any way that enforces it), its counts and the command
// that promotes it. Each candidate opens the promote dialog on its own form and place (the dry run first; nothing is
// written until a person confirms there). Candidates followed by doing nothing (`passive`) are listed apart, after the
// others, and say so in the dialog too. A candidate whose command an older Drift printed with no id has no action, and
// says why. Units Drift could not read are "not checked", never departures.
import { useState } from "react";
import { Button, EmptyState, ErrorState, Icon, Tag } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { usePromoteList } from "@/entities/drift";
import type { PracticeExample, PracticesReport, PromoteList, PromoteListItem } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";
import { useOpenCode } from "@/shared/ui/code";
import { Loading } from "@/shared/ui/QueryState";
import { acceptsText, candidateKey, candidateKind, candidatesIn, commandShown, exceptionsLine, followsLine, jobsLine, kindText, notCheckedLine, splitPassive, unknownCauseText } from "./model/candidates";
import { EXCEPTIONS_SHOWN, choiceFromCandidate, unitAt } from "./model/promote";
import { PromoteDialog } from "./PromoteDialog";
import { pkgLabel } from "./model/practices";

/** The tab: runs `drift practices promote --list --json` only while it is open; a candidate's Promote opens the dialog. */
export function CandidatesTab({ report, pkg, titleOf }: { report: PracticesReport; pkg: string | null; titleOf(concern: string): string }) {
  const { repo } = useRepo();
  const q = usePromoteList(repo, true);
  const openCode = useOpenCode();
  const [promoting, setPromoting] = useState<PromoteListItem | null>(null);
  if (q.isLoading) return <Loading label={t("practices.candidates.loading")} />;
  if (q.error) return <ErrorState title={t("practices.candidates.failed")} error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return (
    <>
      <CandidateList
        list={q.data.data}
        pkg={pkg}
        titleOf={titleOf}
        onOpen={(e) => openCode({ path: e.path, line: e.line, context: { title: t("practices.candidates.example"), tone: "accent" } })}
        onPromote={setPromoting}
      />
      {promoting && (
        <PromoteDialog
          concern={report.concerns.find((c) => c.id === promoting.candidate.concern) ?? null}
          initial={choiceFromCandidate(promoting)}
          labels={Object.fromEntries([...promoting.candidate.ways, ...promoting.candidate.other_ways].map((w) => [w.id, w.label]))}
          note={promoting.candidate.passive ? t("practices.candidates.passiveNote") : undefined}
          onClose={() => setPromoting(null)}
        />
      )}
    </>
  );
}

/** The list itself, from props only. `onPromote`: a candidate's Promote action (absent: the list is shown without one). */
export function CandidateList({ list, pkg, titleOf, onOpen, onPromote }: { list: PromoteList; pkg: string | null; titleOf(concern: string): string; onOpen?(e: PracticeExample): void; onPromote?(item: PromoteListItem): void }) {
  const items = candidatesIn(list, pkg);
  const { active, passive } = splitPassive(items);
  return (
    <div className="st-pad st-stack st-scroll pr-candidates">
      <p className="t-secondary t-body-sm">{t("practices.candidates.intro")}</p>
      {items.length === 0 ? (
        <EmptyState icon="info" title={pkg !== null ? t("practices.candidates.emptyIn", { pkg: pkgLabel(pkg) }) : t("practices.candidates.empty")}>
          {t("practices.candidates.emptyBody")}
        </EmptyState>
      ) : (
        <>
          {active.length ? (
            <ul className="st-plainlist st-stack pr-candidates__list" data-testid="candidates-active">
              {active.map((x) => (
                <Candidate key={candidateKey(x)} item={x} titleOf={titleOf} onOpen={onOpen} onPromote={onPromote} />
              ))}
            </ul>
          ) : (
            <p className="t-muted t-body-sm">{t("practices.candidates.noActive")}</p>
          )}
          {passive.length > 0 && (
            <section className="st-stack pr-candidates__passive" aria-label={t("practices.candidates.passiveTitle")} data-testid="candidates-passive">
              <h3 className="dui-overline">{t("practices.candidates.passiveTitle")}</h3>
              <p className="t-caption t-muted">{t("practices.candidates.passiveBody")}</p>
              <ul className="st-plainlist st-stack pr-candidates__list">
                {passive.map((x) => (
                  <Candidate key={candidateKey(x)} item={x} titleOf={titleOf} onOpen={onOpen} onPromote={onPromote} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {list.promoted.length > 0 && <p className="t-caption t-muted pr-candidates__promoted">{t("practices.candidates.promoted", { ids: list.promoted.join(", ") })}</p>}
      {list.declined > 0 && <p className="t-caption t-muted pr-candidates__declined">{t("practices.candidates.declined", { n: list.declined })}</p>}
    </div>
  );
}

function Candidate({ item, titleOf, onOpen, onPromote }: { item: PromoteListItem; titleOf(concern: string): string; onOpen?(e: PracticeExample): void; onPromote?(item: PromoteListItem): void }) {
  const c = item.candidate;
  const cause = c.unknown_cause ? unknownCauseText(c.unknown_cause) : null;
  const jobs = jobsLine(c);
  const cmd = commandShown(item);
  const shown = c.exceptions.slice(0, EXCEPTIONS_SHOWN);
  const more = c.exceptions.length - shown.length;
  return (
    <li className={`pr-cand is-${candidateKind(c)}${c.passive ? " is-passive" : ""}`} data-kind={candidateKind(c)}>
      <div className="st-row st-wrap pr-cand__head">
        <span className="t-title pr-cand__title">{t("practices.candidates.title", { concern: titleOf(c.concern), place: item.place })}</span>
        <Tag tone={candidateKind(c) === "ways" ? undefined : "info"}>{kindText(c)}</Tag>
      </div>
      <p className="t-body-sm pr-cand__accepts">{acceptsText(c)}</p>
      <p className="t-body-sm pr-cand__follows">{followsLine(item)}</p>
      <p className="t-caption t-secondary pr-cand__exceptions">{exceptionsLine(c)}</p>
      {shown.length > 0 && (
        <ul className="st-plainlist dui-mono t-caption">
          {shown.map((e) => (
            <li key={unitAt(e)}>{unitAt(e)}</li>
          ))}
          {more > 0 && <li className="t-muted">{t("practices.candidates.exceptionsMore", { n: more })}</li>}
        </ul>
      )}
      <p className="t-caption t-muted pr-cand__notchecked">{notCheckedLine(c)}</p>
      {cause && (
        <div className="ck-note pr-cand__cause" role="note">
          <Icon name="info" size={14} />
          <span>
            {cause.what} {cause.after}
            {cause.hint && (
              <>
                {" "}
                <code className="st-cmd" data-testid="cause-hint">
                  {cause.hint}
                </code>
              </>
            )}
          </span>
        </div>
      )}
      {jobs && <p className="t-caption t-muted pr-cand__jobs">{jobs}</p>}
      {c.example && (
        <p className="t-caption">
          {t("practices.candidates.example")}:{" "}
          {onOpen ? (
            <button type="button" className="st-link dui-mono" onClick={() => onOpen(c.example!)}>
              {unitAt(c.example)}
            </button>
          ) : (
            <span className="dui-mono">{unitAt(c.example)}</span>
          )}
        </p>
      )}
      {cmd ? <code className="st-cmd pr-cand__cmd">{cmd}</code> : <p className="t-caption t-muted pr-cand__nocmd">{t("practices.candidates.noCommand")}</p>}
      {cmd && onPromote && (
        <div className="st-row st-wrap pr-cand__action">
          <Button variant={c.passive ? "secondary" : "primary"} size="sm" icon="check" onClick={() => onPromote(item)} aria-label={`${t("practices.candidates.promote")} ${t("practices.candidates.title", { concern: titleOf(c.concern), place: item.place })}`}>
            {t("practices.candidates.promote")}
          </Button>
          <span className="t-caption t-muted">{t("practices.candidates.promoteHint")}</span>
        </div>
      )}
    </li>
  );
}
