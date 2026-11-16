// Proposals from the map (`drift census --from-map --json`, crates/drift-cli/src/from_map_cli.rs): what Drift would
// propose from its map of the code, and why each one that qualified is or is not proposed. Read-only: nothing here is
// accepted, written or shown to agents; a proposal is decided in Conventions, where `drift init` writes it as one.
import { Badge, EmptyState, ErrorState, Icon, Panel } from "@drift/ui";
import { useConventions } from "@/entities/convention";
import { useRepo } from "@/entities/repo";
import type { ConventionsFile } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { Loading } from "@/shared/ui/QueryState";
import { type FromMapProposal, type FromMapRead, POLICY_STATE_TEXT, type PolicyState, countsText, heldByReason, policyState } from "./model/fromMap";
import { useFromMap } from "./model/queries";
import "./from-map.css";

export function FromMapView() {
  const { repo } = useRepo();
  const q = useFromMap(repo);
  const conv = useConventions(repo);
  if (q.isLoading) return <Loading label="Running drift census --from-map" />;
  if (q.error) return <ErrorState title="Proposals from the map could not be read" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <FromMap doc={q.data.data} policy={conv.policy} onOpen={(id) => navigate("conventions", id)} />;
}

const STATE_TONE: Record<PolicyState, "success" | "info" | "neutral" | "warning"> = { accepted: "success", proposed: "info", rejected: "neutral", absent: "warning", unknown: "neutral" };

/** The page, from props only. */
export function FromMap({ doc, policy, onOpen }: { doc: FromMapRead; policy: Pick<ConventionsFile, "conventions"> | null; onOpen?(id: string): void }) {
  const groups = heldByReason(doc.held);
  const nothing = !doc.proposals.length && !doc.held.length && !doc.notes.length;
  return (
    <div className="st-page fm">
      <header className="fm-head st-pad st-stack">
        <div className="dui-overline">Review</div>
        <h2 className="t-h1">Proposals from the map</h2>
        <p className="t-secondary t-body-sm">
          What Drift would propose from its map of the code (the practice map and the structure map), and why each one that qualified is or is not proposed. None of them went through the miner&apos;s measured gates. Each
          advises only once a person accepts it, and none is shown to agents before that. Read-only: decide them in Conventions.
        </p>
        <code className="st-cmd">drift census --from-map --json</code>
      </header>
      <div className="st-pad st-stack st-scroll">
        {nothing ? (
          <EmptyState icon="ok" title="Nothing from the map">
            Drift&apos;s map shows no practice, layer or declared rule here that qualifies for a proposal.
          </EmptyState>
        ) : (
          <>
            <Panel title={`Proposed (${num(doc.proposals.length)})`} className="fm-proposed">
              {doc.proposals.length ? (
                <ul className="st-plainlist st-stack">
                  {doc.proposals.map((p) => (
                    <ProposalRow key={p.id} p={p} state={policyState(p.id, policy)} policy={policy} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <p className="t-muted t-body-sm">Nothing is proposed from the map; what qualified and why it is not proposed is below.</p>
              )}
            </Panel>
            {groups.length > 0 && (
              <Panel title={`Not proposed (${num(doc.held.length)})`} className="fm-held">
                <ul className="st-plainlist st-stack">
                  {groups.map((g) => (
                    <li key={`${g.reason}:${g.why}`} className="fm-held__group" data-reason={g.reason}>
                      <div className="t-body-sm">
                        <Icon name="info" size={13} /> {g.why || g.reason}
                      </div>
                      <ul className="st-plainlist fm-held__rows">
                        {g.rows.map((h) => (
                          <li key={h.id} data-id={h.id} className="t-caption">
                            <span className="dui-mono">{h.id}</span> <span className="t-secondary">{h.summary}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {doc.notes.length > 0 && (
              <Panel title={`From the map, for information (${num(doc.notes.length)})`} className="fm-notes">
                <p className="t-caption t-muted">Listed, never written, and nothing checks them.</p>
                <ul className="st-plainlist st-stack">
                  {doc.notes.map((n, i) => (
                    <li key={`${n.note}:${n.id ?? i}`} className="t-body-sm fm-note" data-note={n.note}>
                      {n.id && <span className="dui-mono">{n.id} </span>}
                      <span className="t-secondary">{n.text}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
        {doc.unreadable > 0 && <p className="t-caption t-muted">{num(doc.unreadable)} entries of a shape this Studio does not read are not shown; drift census --from-map prints them.</p>}
      </div>
    </div>
  );
}

function ProposalRow({ p, state, policy, onOpen }: { p: FromMapProposal; state: PolicyState; policy: Pick<ConventionsFile, "conventions"> | null; onOpen?(id: string): void }) {
  const inFile = state === "accepted" || state === "proposed" || state === "rejected";
  return (
    <li className="pr-cand fm-prop" data-id={p.id}>
      <div className="st-row st-wrap fm-prop__head">
        <strong className="t-body">{p.summary}</strong>
        <Badge tone="accent" className="fm-kind">
          from the map · {p.kind || "?"}
        </Badge>
        <Badge tone={STATE_TONE[state]} icon className="fm-state">
          {POLICY_STATE_TEXT[state]}
        </Badge>
      </div>
      <div className="t-caption t-secondary">
        <span className="dui-mono">{p.id}</span>
        {p.place && <> · in {p.place}</>}
        {p.mode && <> · {p.mode} once accepted</>}
      </div>
      <p className="t-body-sm">{countsText(p)}</p>
      {p.sameRule.length > 0 && (
        <ul className="st-plainlist fm-same">
          {p.sameRule.map((t) => (
            <li key={t.id} className="t-caption">
              The same rule read two ways: {onOpen && policyState(t.id, policy) !== "absent" ? <LinkId id={t.id} onOpen={onOpen} /> : <span className="dui-mono">{t.id}</span>} {t.summary} ({t.status}). Accepting both reports one departure twice.
            </li>
          ))}
        </ul>
      )}
      {inFile && onOpen && (
        <div>
          <button type="button" className="st-link fm-open" onClick={() => onOpen(p.id)}>
            Open {p.id} in Conventions
          </button>
        </div>
      )}
    </li>
  );
}

function LinkId({ id, onOpen }: { id: string; onOpen(id: string): void }) {
  return (
    <button type="button" className="st-link dui-mono" onClick={() => onOpen(id)} title="Open in Conventions">
      {id}
    </button>
  );
}
