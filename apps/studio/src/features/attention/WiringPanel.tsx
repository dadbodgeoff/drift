// Experimental wiring (#38): what census found as registries and why each was or was not
// proposed, the co-change history it read, and additions not wired up in the last check.
// Shown only while the flag is on (census --json carries `wiring` only then).
import { Button, Panel, StateLabel } from "@drift/ui";
import { historyStatus, registryStatus, wireAt } from "@/entities/convention";
import { stateOf } from "@/entities/check";
import type { CensusWiring, Violation } from "@/shared/contract/drift";
import { num, plural } from "@/shared/lib/format";
import { navigate } from "@/shared/lib/router";
import { useOpenCode } from "@/shared/ui/code";

export function WiringPanel({ wiring, violations }: { wiring: CensusWiring; violations: Violation[] | null }) {
  const openCode = useOpenCode();
  const registries = wiring.registries ?? [];
  const unwired = violations?.filter((v) => v.wire && stateOf(v) === "new") ?? null;
  const history = wiring.cochange ? historyStatus(wiring.cochange.history) : null;
  return (
    <Panel
      className="at-wiring"
      title="Wiring (experimental)"
      subtitle="Where new code must be registered, and whether it was: suggestions that never block"
      actions={
        <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate("check")}>
          Check
        </Button>
      }
    >
      <div className="st-row st-wrap at-wiring__head">
        {unwired === null ? (
          <span className="t-caption t-muted">No drift check yet.</span>
        ) : unwired.length === 0 ? (
          <StateLabel tone="success" icon="ok">
            every new addition is wired up
          </StateLabel>
        ) : (
          <StateLabel tone="warning" icon="attention">
            {plural(unwired.length, "new addition", "new additions")} not wired up
          </StateLabel>
        )}
        {history && wiring.cochange && (
          <span className="t-caption t-secondary" title={history.why}>
            Git history: {history.label}
            {history.ok ? ` · ${plural(wiring.cochange.commits, "key-file commit", "key-file commits")} · ${plural(wiring.cochange.rules, "co-change rule", "co-change rules")}` : " · no co-change rules"}
          </span>
        )}
      </div>
      {registries.length === 0 ? (
        <p className="t-body-sm t-muted">Census found no registry: no list names a role&apos;s members by reference.</p>
      ) : (
        <ul className="at-registries">
          {registries.map((r) => {
            const st = registryStatus(r.status, wiring.params?.min_coverage);
            return (
              <li key={`${r.path}:${r.line}:${r.slot}`}>
                <div className="st-row st-wrap">
                  <StateLabel tone={st.tone} icon={st.tone === "success" ? "ok" : st.tone === "warning" ? "attention" : "info"}>
                    {st.label}
                  </StateLabel>
                  <span className="t-title">{r.label}</span>
                  <button type="button" className="st-link dui-mono t-truncate" onClick={() => openCode({ path: r.path, line: r.line > 0 ? r.line : undefined, context: { title: `Registry: ${r.label}`, detail: r.role_summary, tone: "info" } })}>
                    {wireAt(r)}
                  </button>
                  <span className="t-num t-secondary" title="Role members it names, of the role's members">
                    {num(r.covered)}/{num(r.members)}
                  </span>
                </div>
                <p className="t-caption t-muted">
                  {r.role_summary}
                  {r.lists > 1 ? ` · a family of ${num(r.lists)} lists` : ""}. {st.why}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
