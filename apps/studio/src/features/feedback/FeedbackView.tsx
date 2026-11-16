// Feedback (`drift feedback`, crates/drift-cli/src/feedback.rs): the marks a person recorded on reports, true or wrong,
// as `.drift/feedback/marks.json` holds them. A mark is made where a report is shown (Check). The export is a command a
// person runs and reads before sharing: the Studio shows it and never runs it, and nothing is sent anywhere.
import { EmptyState, ErrorState, Icon, Panel } from "@drift/ui";
import { NOTHING_SENT, tally, useMarks } from "@/entities/feedback";
import { useRepo } from "@/entities/repo";
import type { FeedbackMark } from "@/shared/contract/screens";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { Loading } from "@/shared/ui/QueryState";
import "./feedback.css";

export function FeedbackView() {
  const { repo } = useRepo();
  const q = useMarks(repo);
  if (q.isLoading) return <Loading label="Reading .drift/feedback/marks.json" />;
  if (q.error) return <ErrorState title="The marks could not be read" error={q.error} onRetry={() => void q.refetch()} />;
  return <Feedback marks={q.data?.marks ?? []} onOpen={(id) => navigate("conventions", id)} />;
}

/** The page, from props only. */
export function Feedback({ marks, onOpen }: { marks: readonly FeedbackMark[]; onOpen?(id: string): void }) {
  const n = tally(marks);
  return (
    <div className="st-page fbv">
      <header className="fbv-head st-pad st-stack">
        <div className="dui-overline">Feedback</div>
        <h2 className="t-h1">Your marks on Drift&apos;s reports</h2>
        <p className="t-secondary t-body-sm">Whether a report Drift made is true or wrong, in your judgment: mark one from Check, on the violation. {NOTHING_SENT}</p>
        <code className="st-cmd">drift feedback mark &lt;id&gt; &lt;path#symbol&gt; --true|--wrong</code>
      </header>
      <div className="st-pad st-stack st-scroll">
        {marks.length === 0 ? (
          <EmptyState icon="info" title="No marks yet">
            Open a violation in Check and say whether the report is right.
          </EmptyState>
        ) : (
          <Panel title={`Marks (${num(marks.length)}): ${num(n.true)} true, ${num(n.wrong)} wrong`} className="fbv-marks">
            <table className="pr-table">
              <caption className="dui-sr">Marks</caption>
              <thead>
                <tr>
                  <th scope="col">Verdict</th>
                  <th scope="col">Report</th>
                  <th scope="col">Rule kind</th>
                  <th scope="col">Marked</th>
                </tr>
              </thead>
              <tbody>
                {marks.map((m) => (
                  <tr key={`${m.report} ${m.id} ${m.member ?? ""}`} data-id={m.id} data-verdict={m.verdict}>
                    <td>
                      <span className={m.verdict === "true" ? "fbv-true" : "fbv-wrong"}>
                        <Icon name={m.verdict === "true" ? "check" : "x"} size={13} /> {m.verdict}
                      </span>
                    </td>
                    <th scope="row">
                      {m.report === "violation" && onOpen ? (
                        <button type="button" className="st-link dui-mono" onClick={() => onOpen(m.id)} title="Open the convention">
                          {m.id}
                        </button>
                      ) : (
                        <span className="dui-mono">{m.id}</span>
                      )}{" "}
                      {m.member && <span className="dui-mono t-secondary">{m.member}</span>}
                      {m.why && <div className="t-caption t-secondary">why: {m.why}</div>}
                    </th>
                    <td className="dui-mono t-caption">
                      {m.kind}
                      {m.tier ? ` · ${m.tier}` : ""}
                      {m.baselined ? " · legacy (in drift.lock)" : ""}
                    </td>
                    <td className="t-caption">{m.day}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
        <Panel title="Sharing them" className="fbv-export">
          <p className="t-body-sm t-secondary">
            drift feedback export writes one file of counts, rule kinds and verdicts, with ids replaced by keyed hashes: no path, symbol, package, route, repository name, author or commit. Reasons are left out unless you ask for them.
            Drift sends nothing; read the file and share it by hand if you choose to. The Studio does not run it.
          </p>
          <ul className="st-plainlist st-stack">
            <li>
              <code className="st-cmd">drift feedback export --dry-run</code> <span className="t-caption t-muted">print what would be written; write nothing</span>
            </li>
            <li>
              <code className="st-cmd">drift feedback export</code> <span className="t-caption t-muted">write .drift/feedback/drift-feedback.json</span>
            </li>
            <li>
              <code className="st-cmd">drift feedback export --include-reasons</code> <span className="t-caption t-muted">also the reason of each mark (read it first)</span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
