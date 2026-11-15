// The code drawer: any view opens a file at a line, with Drift's facts for it, and what `drift card <path>` says
// about it (entry points with guards and exposure, risky operations, siblings, conventions, what is not known).
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, CodeView, Drawer, EmptyState, Icon, Skeleton, Tag, langOf } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useFacts, useSecurity } from "@/entities/drift";
import { GUARD_FACT, INPUT_LABEL, inputOf, rejectsCaller, symbolTrait, useFactsIndex } from "@/entities/facts";
import { UNKNOWN_BASE_TITLE, isUnknownBase, madeByTag, shortRef, useConventions } from "@/entities/convention";
import { identifiedText } from "@/entities/basis";
import { LOCAL_NOTE, MIN_ROLE_SIZE, exposureText, fileCard, guardText, siblingsWithoutGuard, sinkLabel } from "@/entities/security";
import { useApi } from "@/shared/api";
import type { FileFacts } from "@/shared/contract/drift";
import { navigate } from "@/shared/lib/router";
import { type CodeTarget, useOpenCode } from "@/shared/ui/code";

export function CodeDrawer({ target, onClose }: { target: CodeTarget | null; onClose(): void }) {
  const api = useApi();
  const { repo } = useRepo();
  const facts = useFacts(repo);
  const ix = useFactsIndex(facts.data?.data);
  const src = useQuery({
    queryKey: ["source", repo?.path, target?.path],
    enabled: !!repo && !!target,
    staleTime: 60_000,
    queryFn: () => api.readSource(repo!, target!.path),
  });
  const file = target && ix ? ix.byPath.get(target.path) : undefined;
  const markers = target?.markers ?? (target?.line ? [{ line: target.line, tone: target.context?.tone ?? "accent", label: target.context?.title ?? "focus" }] : []);
  const copy = () => target && navigator.clipboard?.writeText(`${target.path}${target.line ? `:${target.line}` : ""}`);
  return (
    <Drawer
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="dui-mono">{target?.path}</span>}
      subtitle={target?.line ? `line ${target.line}${file ? ` · ${file.lang} · package ${file.package || "(root)"}` : ""}` : file ? `${file.lang} · package ${file.package || "(root)"}` : undefined}
      actions={<Button size="sm" variant="ghost" icon="copy" onClick={copy}>Copy path</Button>}
      width={860}
    >
      {target?.context && (
        <div className={`st-codectx is-${target.context.tone ?? "info"}`}>
          <Icon name={target.context.tone === "danger" ? "blocked" : target.context.tone === "warning" ? "attention" : "info"} size={14} />
          <div>
            <div className="st-codectx__title">{target.context.title}</div>
            {target.context.detail && <div className="st-codectx__detail">{target.context.detail}</div>}
          </div>
        </div>
      )}
      <div className="st-code">
        <div className="st-code__src">
          {src.isLoading ? (
            <div style={{ padding: 16 }}>
              <Skeleton lines={14} />
            </div>
          ) : src.data ? (
            <CodeView text={src.data} lang={langOf(target!.path)} focusLine={target?.line ?? null} markers={markers} label={`Source of ${target?.path}`} />
          ) : (
            <EmptyState icon="file" title="Source not available">
              The Studio shows only files Drift scanned in the open repository. Drift's facts for this file are on the right.
            </EmptyState>
          )}
        </div>
        <aside className="st-code__facts" aria-label="Drift's facts for this file">
          <div className="dui-overline">Symbols</div>
          {!file && <p className="t-muted t-body-sm">Not in the last scan.</p>}
          {file && (
            <ul className="st-symbols">
              {file.symbols.map((s) => {
                const ep = file.entry_points.find((e) => e.symbol === s.name || s.exported_as.includes(e.symbol));
                return (
                  <li key={`${s.name}:${s.line}`} className={s.line === target?.line ? "is-focus" : undefined}>
                    <div className="st-symbols__head">
                      <span className="dui-mono">{s.name}</span>
                      <span className="t-muted t-caption">:{s.line}</span>
                      <span className="st-grow" />
                      <Badge>{s.kind}</Badge>
                    </div>
                    {(ep || s.wraps.length > 0 || (s.suppressions?.length ?? 0) > 0 || (s.field_decorators?.length ?? 0) > 0 || (s.traits?.length ?? 0) > 0 || !!s.derives_from || !!s.made_by || rejectsCaller(s) || (s.after_continuation?.length ?? 0) > 0) && (
                      <div className="st-symbols__tags">
                        {ep && (
                          <Tag tone="info">
                            {ep.kind}
                            {ep.method ? ` ${ep.method}` : ""}
                          </Tag>
                        )}
                        {s.wraps.map((w, i) => (
                          <Tag key={i} title={isUnknownBase(w.wrapper) ? UNKNOWN_BASE_TITLE : `${w.kind}: ${w.wrapper}`}>
                            {w.kind === "decorator" ? "@" : w.kind === "extends" ? "extends " : ""}
                            {shortRef(w.wrapper)}
                          </Tag>
                        ))}
                        {ep && (
                          <Tag title={INPUT_LABEL[inputOf(s)].why}>{INPUT_LABEL[inputOf(s)].label}</Tag>
                        )}
                        {s.field_decorators?.map((d) => (
                          <Tag key={d} title={`field decorator: ${d}`}>
                            field @{shortRef(d)}
                          </Tag>
                        ))}
                        {s.traits?.map((tr) => (
                          <Tag key={tr} className="st-trait" tone={symbolTrait(tr).purpose ? "info" : undefined} title={symbolTrait(tr).why}>
                            {symbolTrait(tr).label}
                          </Tag>
                        ))}
                        {rejectsCaller(s) && (
                          <Tag tone="info" className="st-guardfact" title={GUARD_FACT.rejects.why}>
                            {GUARD_FACT.rejects.label}
                          </Tag>
                        )}
                        {s.after_continuation?.map((c) =>
                          s.throws?.includes(c) ? (
                            <Tag key={`after:${c}`} className="st-guardfact" title={`${GUARD_FACT.raisedAfter.why} (${c})`}>
                              {file.lang === "py" ? "raises" : "throws"} {shortRef(c)} {GUARD_FACT.after.label}
                            </Tag>
                          ) : (
                            <Tag key={`after:${c}`} className="st-guardfact" title={`${GUARD_FACT.after.why} (${c})`}>
                              {shortRef(c)}() {GUARD_FACT.after.label}
                            </Tag>
                          ),
                        )}
                        {s.derives_from && (
                          <Tag title={`built on: ${s.derives_from}`}>built on {shortRef(s.derives_from)}</Tag>
                        )}
                        {s.made_by && (
                          <Tag className="st-madeby" title={madeByTag(s.made_by).title}>
                            {madeByTag(s.made_by).label}
                          </Tag>
                        )}
                        {s.suppressions?.map((id) => (
                          <Tag key={id} tone="warning" title="drift-ignore">
                            ignore {id}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {file && file.directives.length > 0 && (
            <>
              <div className="dui-overline" style={{ marginTop: 16 }}>
                Directives
              </div>
              <div className="st-symbols__tags">
                {file.directives.map((d) => (
                  <Tag key={d}>{d}</Tag>
                ))}
              </div>
            </>
          )}
          {file && <FileCardFacts file={file} />}
        </aside>
      </div>
    </Drawer>
  );
}

/**
 * What `drift card <path>` prints for the file, from `drift security --json` and the policy: entry points with guards
 * and exposure, risky operations, env reads and leaks, what siblings of the same kind carry with one to copy from,
 * accepted conventions naming the file, and what is not known.
 */
function FileCardFacts({ file }: { file: FileFacts }) {
  const { repo } = useRepo();
  const sec = useSecurity(repo);
  const conv = useConventions(repo);
  const openCode = useOpenCode();
  const inv = sec.data?.data;
  if (!inv) return sec.error ? <p className="t-muted t-body-sm">drift security failed, so this file's entry points, siblings and exposure are not shown.</p> : null;
  const card = fileCard(inv, file);
  const naming = conv.rows.filter((r) => r.status === "accepted" && (r.example.path === file.path || r.outliers?.some((o) => o.path === file.path) || r.exempt?.some((e) => e.path === file.path)));
  const role = (r: (typeof naming)[number]) => (r.outliers?.some((o) => o.path === file.path) ? "an outlier" : r.exempt?.some((e) => e.path === file.path) ? "exempt" : "its example");
  return (
    <section className="st-card" aria-label="What drift card says about this file">
      <div className="dui-overline" style={{ marginTop: 16 }}>
        Entry points
      </div>
      {card.entries.length === 0 ? (
        <p className="t-muted t-body-sm">None in this file.</p>
      ) : (
        <ul className="st-plainlist st-card__list">
          {card.entries.map((e) => (
            <li key={`${e.symbol}:${e.line}`}>
              <span className="dui-mono">{e.method ? `${e.method} ` : ""}{e.route ?? e.symbol}</span> <Tag tone="info">{e.kind}</Tag>
              <div className="t-caption">
                {e.guards.length ? (
                  <>guards <span className="dui-mono">{e.guards.join(" > ")}</span></>
                ) : e.opaque?.length ? (
                  <span>guard unknown: <span className="dui-mono">{e.opaque.join(", ")}</span> cannot be read</span>
                ) : e.local ? (
                  <span>{LOCAL_NOTE}</span>
                ) : (
                  <span className="t-warning">{guardText(e)}</span>
                )}
                {e.wrappers?.length ? <>; wrappers <span className="dui-mono">{e.wrappers.join(" > ")}</span></> : ""}
                {e.opens?.length ? `; open: ${e.opens.join(", ")}` : ""}
                {e.authenticates?.length ? `; ${identifiedText(e.authenticates)}` : ""}
                {e.boundary ? `; ${exposureText(e)}` : e.local ? "" : "; exposure unknown"}
                {e.validates ? "; validates input" : ""}
                {e.reaches.length ? `; reaches ${e.reaches.map((r) => `${sinkLabel(r.kind)}${r.via.length > 1 ? ` via ${r.via.slice(1).join(" → ")}` : ""}`).join(", ")}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
      {card.sinks.length > 0 && (
        <p className="t-body-sm">
          Risky operations here: {card.sinks.map((s) => `${sinkLabel(s.kind)} (${s.symbol}:${s.line})`).join(", ")}
        </p>
      )}
      {card.reads.length > 0 && (
        <p className="t-body-sm">
          Env reads: <span className="dui-mono">{card.reads.join(", ")}</span>
        </p>
      )}
      {card.leaks.length > 0 && (
        <p className="t-body-sm t-warning">
          Client file reaching server-only code or secrets: <span className="dui-mono">{card.leaks.join(", ")}</span>
        </p>
      )}
      {card.siblings.length > 0 && (
        <>
          <div className="dui-overline" style={{ marginTop: 16 }}>
            Siblings
          </div>
          <ul className="st-plainlist st-card__list">
            {card.siblings.map((s) => (
              <li key={s.kind} className="t-body-sm">
                {s.tooFew ? (
                  <span className="t-muted">
                    Fewer than {MIN_ROLE_SIZE} {s.kind} entry points share a place with this file; no shared guard to report.
                  </span>
                ) : !s.shares.length ? (
                  <>
                    {s.members} {s.kind} entry points in {s.where}; {siblingsWithoutGuard(s)}.
                  </>
                ) : (
                  <>
                    {s.members} {s.kind} entry points in {s.where} carry{" "}
                    <span className="dui-mono">
                      {s.shares
                        .slice(0, 5)
                        .map((g) => `${g.guard} ${g.n}/${s.members}`)
                        .join(", ")}
                    </span>
                    {s.shares.length > 5 ? `, and ${s.shares.length - 5} more guards` : ""}.
                    {s.copy && (
                      <>
                        {" "}
                        To copy:{" "}
                        <button type="button" className="st-link dui-mono" onClick={() => openCode({ path: s.copy!.path, line: s.copy!.line, context: { title: `has ${s.shares[0].guard}`, detail: `${s.shares[0].n} of ${s.members} ${s.kind} entry points in ${s.where}` } })}>
                          {s.copy.path}:{s.copy.line} {s.copy.symbol}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="dui-overline" style={{ marginTop: 16 }}>
        Conventions
      </div>
      {naming.length > 0 && (
        <ul className="st-plainlist st-card__list">
          {naming.map((r) => (
            <li key={r.id} className="t-body-sm">
              <button type="button" className="st-link dui-mono" onClick={() => navigate("conventions", r.id)}>
                {r.id}
              </button>{" "}
              {r.summary} ({r.evidence.holders}/{r.evidence.total} follow it, {r.effectiveMode === "block" ? "blocks" : "advises"}); this file is {role(r)}
            </li>
          ))}
        </ul>
      )}
      <p className="t-muted t-caption">
        {naming.length ? "Accepted conventions naming this file (as their example, an outlier or exempt)." : "No accepted convention names this file as its example, an outlier or exempt."} Conventions it already follows are not listed: no JSON output names a rule&apos;s holders; <span className="dui-mono">drift card {file.path}</span> lists every accepted convention covering it.
      </p>
      <div className="dui-overline" style={{ marginTop: 16 }}>
        Not known
      </div>
      <p className="t-body-sm t-secondary">{card.unknown.join("; ")}.</p>
    </section>
  );
}
