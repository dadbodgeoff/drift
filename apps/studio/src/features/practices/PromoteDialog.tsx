// "Make this a convention": `drift practices promote` from the Practices view (docs/v2/PROMOTE-A-PRACTICE.md §5 item 4).
// The dialog runs the dry run (`--dry-run --json`) on open and again on every choice, and shows what Drift answered:
// the place, the accepted ways and how many follow, the exceptions it records as they are, what it could not read and
// the other ways present. Only "Make it a convention" writes (the same command without `--dry-run`). A refusal (exit 2)
// is shown here and the dialog stays open; the Studio never decides whether a practice qualifies.
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Icon, RadioGroup, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys } from "@/entities/drift";
import { useApi } from "@/shared/api";
import type { PracticeConcern, PracticeVariant, PromoteResult } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { log } from "@/shared/lib/log";
import { isRefused, promoteCommand } from "@/shared/lib/promote";
import { navigate } from "@/shared/lib/router";
import { exceptionsShown, followsText, promoteRequest, replayText, toggleWay, unitAt, unitsWord, wayChoices } from "./model/promote";

type Mode = "advise" | "block";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PromoteDialog({ c, v, place, onClose }: { c: PracticeConcern; v: PracticeVariant; place: string; onClose(): void }) {
  const { repo } = useRepo();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [withIds, setWithIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("advise");
  const [writing, setWriting] = useState(false);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const req = promoteRequest(v.id, place, withIds, mode === "block");

  const q = useQuery({
    queryKey: ["promotePreview", repo?.path ?? "none", req],
    enabled: !!repo,
    queryFn: ({ signal }) => api.promotePreview(repo!, req, { signal }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  // The last dry run that was not refused: its ways stay on screen (and tickable) while a choice is refused.
  const [lastOk, setLastOk] = useState<PromoteResult | null>(null);
  if (q.data && !isRefused(q.data) && q.data !== lastOk) setLastOk(q.data);

  const current = q.data && !isRefused(q.data) && !q.isPlaceholderData ? q.data : null;
  const refusal = q.data && isRefused(q.data) && !q.isPlaceholderData ? q.data.message : null;
  const shown = current ?? lastOk;
  const canWrite = !!repo && !!current && !q.isFetching && !writing;

  const choose = (next: () => void) => {
    setWriteRefusal(null);
    setWriteError(null);
    next();
  };

  const write = async () => {
    if (!repo || !current) return;
    const command = promoteCommand(repo.path, req, false);
    setWriting(true);
    setWriteRefusal(null);
    setWriteError(null);
    try {
      const out = await api.promote(repo, req);
      if (isRefused(out)) {
        log("warn", `practices promote ${v.id} refused`, { command, output: out.message });
        setWriteRefusal(out.message);
        return;
      }
      log("info", `practices promote ${v.id}`, { command, output: out.preview });
      await Promise.all([keys.policy(repo), keys.check(repo), keys.practices(repo), keys.history(repo), keys.census(repo)].map((queryKey) => qc.invalidateQueries({ queryKey })));
      const id = out.convention.id;
      toast.show({ title: `Convention ${id}`, body: out.convention.summary, tone: "success", duration: 6000, action: { label: "Open", onClick: () => navigate("conventions", id) } });
      onClose();
    } catch (e) {
      log("error", `practices promote ${v.id} failed`, { command, error: errText(e) });
      setWriteError(errText(e));
    } finally {
      setWriting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !writing) onClose();
      }}
      size="lg"
      title="Make this a convention"
      description={`${c.title}: ${v.label}. From now on drift check reports a new ${unitsWord(c.unit, 1)} in ${place} that does it another way, or not at all.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={writing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void write()} disabled={!canWrite} loading={writing}>
            {mode === "block" ? "Make it a blocking convention" : "Make it a convention"}
          </Button>
        </>
      }
    >
      <div className="pr-promote st-stack">
        {q.isLoading && !shown && <p className="t-muted t-body-sm">Running drift practices promote --dry-run…</p>}
        {q.error && (
          <p className="ck-note pr-promote__refused" role="alert">
            <Icon name="attention" size={14} />
            <span>{errText(q.error)}</span>
          </p>
        )}
        {shown && <Preview res={shown} stale={!current} />}
        {shown && (
          <WayChoices
            res={shown}
            unit={c.unit}
            checked={withIds}
            disabled={writing}
            onToggle={(id, on) => choose(() => setWithIds((xs) => toggleWay(xs, id, on)))}
          />
        )}
        <RadioGroup<Mode>
          label="Mode"
          value={mode}
          onValueChange={(m) => choose(() => setMode(m))}
          options={[
            { value: "advise", label: "Advise", hint: "Reported by drift check, never fails it." },
            { value: "block", label: "Block", hint: "Fails drift check. Drift allows it only when the most recently added units of the place already follow it." },
          ]}
        />
        {(refusal || writeRefusal) && (
          <p className="ck-note pr-promote__refused" role="alert">
            <Icon name="blocked" size={14} />
            <span>
              Drift refused{writeRefusal ? "; nothing was written" : ""}: {writeRefusal ?? refusal}
            </span>
          </p>
        )}
        {writeError && (
          <p className="ck-note pr-promote__refused" role="alert">
            <Icon name="attention" size={14} />
            <span>drift practices promote failed: {writeError}</span>
          </p>
        )}
        {current && replayText(current) && <p className="t-secondary t-body-sm">{replayText(current)}</p>}
        {repo && <code className="st-cmd pr-promote__cmd">{promoteCommand(repo.path, req, false)}</code>}
        {current && (
          <details className="st-raw">
            <summary>What drift prints</summary>
            <pre className="dui-mono t-caption">{current.preview}</pre>
          </details>
        )}
      </div>
    </Dialog>
  );
}

/** The place, the accepted ways and Drift's counts: what follows, what is recorded as it is, what it could not read. */
function Preview({ res, stale }: { res: PromoteResult; stale: boolean }) {
  const c = res.candidate;
  const exc = exceptionsShown(res);
  return (
    <div className={`pr-promote__preview st-stack${stale ? " is-stale" : ""}`} aria-busy={stale}>
      <div className="pr-promote__place">
        <span className="dui-overline">Place</span> <span className="dui-mono">{res.place}</span>
      </div>
      <div>
        <div className="dui-overline">Accepted {c.ways.length === 1 ? "way" : "ways"}</div>
        <ul className="st-plainlist t-body-sm">
          {c.ways.map((w) => (
            <li key={w.id}>
              {w.label} <span className="t-muted">· {num(w.members)}</span> <span className="dui-mono t-muted t-caption">{w.id}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="t-body-sm">{followsText(res)}</p>
      <div>
        <div className="dui-overline">Exceptions ({num(c.exceptions.length)})</div>
        {c.exceptions.length ? (
          <>
            <p className="t-caption t-muted">Recorded in drift.lock as they are, so drift check reports only new {unitsWord(c.unit, 2)}.</p>
            <ul className="st-plainlist dui-mono t-caption">
              {exc.shown.map((e) => (
                <li key={unitAt(e)}>{unitAt(e)}</li>
              ))}
            </ul>
            {exc.more > 0 && <p className="t-caption t-muted">and {num(exc.more)} more</p>}
          </>
        ) : (
          <p className="t-caption t-muted">None: every {unitsWord(c.unit, 1)} Drift could read here does it an accepted way.</p>
        )}
      </div>
      <p className="t-caption t-muted">
        {c.unknown === 0 ? `Drift could read every ${unitsWord(c.unit, 1)} here.` : `${num(c.unknown)} ${unitsWord(c.unit, c.unknown)} Drift could not read; those are never reported.`}
        {c.forced ? " Below the 80% share on a person's word: advise only." : ""}
      </p>
      {res.same_way && res.same_way.length > 0 && (
        <p className="t-caption t-muted pr-promote__same">
          <span className="dui-mono">{res.same_way.join(", ")}</span> {res.same_way.length === 1 ? "names" : "name"} the same way for code of this package. With both accepted, new code that breaks them is reported under each; reject one in Conventions if you want a single rule.
        </p>
      )}
    </div>
  );
}

/** The other ways present, one checkbox each: ticking one accepts it too (`--with`) and runs the dry run again. */
function WayChoices({ res, unit, checked, disabled, onToggle }: { res: PromoteResult; unit: string; checked: readonly string[]; disabled: boolean; onToggle(id: string, on: boolean): void }) {
  const choices = wayChoices(res);
  if (!choices.length) return <p className="t-caption t-muted">No other way is used here.</p>;
  return (
    <div className="pr-promote__ways">
      <div className="dui-overline">Other ways used here</div>
      <p className="t-caption t-muted">Tick one to accept it as well. None is added unless you tick it.</p>
      <div className="st-stack">
        {choices.map((way) => (
          <Checkbox
            key={way.id}
            checked={checked.includes(way.id)}
            disabled={disabled}
            onCheckedChange={(on) => onToggle(way.id, on)}
            label={way.label}
            hint={`${num(way.members)} ${unitsWord(unit, way.members)} · ${way.id}`}
          />
        ))}
      </div>
    </div>
  );
}
