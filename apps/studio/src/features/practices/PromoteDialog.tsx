// "Make this a convention": `drift practices promote` from the Practices view (docs/v2/PROMOTE-A-PRACTICE.md §5 item 4),
// in every form the command has. The dialog builds the command from typed choices (never a free-text command): the
// ways accepted (the first is the variant, none means `--concern`), mechanisms accepted whole (`--mechanism`), any
// enforcing way (`--any-enforcing`), all adding up; the place (a directory, one file, a route prefix); advise or block;
// and `--force`, offered only where Drift refused for the share and only once a person ticks what it overrides. It
// shows the exact command, runs the dry run (`--dry-run --json`) on open and on every choice, and shows what Drift
// answered as it answered it: what it records, what it replaces, the replay, or why it refuses. A combination the
// command line refuses before reading anything is not run, and says the command line's own sentence. Only "Make it a
// convention" writes (the same command without `--dry-run`); the Studio never decides whether a practice qualifies.
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Icon, Input, RadioGroup, SegmentedControl, useToast } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { keys } from "@/entities/drift";
import { mechanismWords } from "@/entities/convention";
import { useApi } from "@/shared/api";
import type { PracticeConcern, PromoteRefused, PromoteResult } from "@/shared/contract/drift";
import { num } from "@/shared/lib/format";
import { log } from "@/shared/lib/log";
import { ENFORCING_CONCERNS, type PlaceChoice, type PlaceKind, isRefused, noEnforcingMessage, placeArg, placeProblem, promoteCommand } from "@/shared/lib/promote";
import { navigate } from "@/shared/lib/router";
import { t } from "@/shared/i18n";
import {
  type PromoteChoice,
  blockOffer,
  choiceRefusal,
  exceptionsShown,
  followsText,
  forceOffer,
  forceText,
  mechanismOptions,
  refusedReplay,
  replacesText,
  replaySentence,
  replayText,
  requestOf,
  switchPlaceKind,
  toggleMechanism,
  toggleWay,
  unitAt,
  unitsWord,
  wayOptions,
} from "./model/promote";
import { jobsLine, notCheckedLine, refusalCause, unknownCauseText } from "./model/candidates";

type Mode = "advise" | "block";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const same = (a: PlaceChoice, b: PlaceChoice) => a.kind === b.kind && a.path === b.path && (a.prefix ?? "") === (b.prefix ?? "");

/** How long a place being typed waits before the dry run runs on it. */
const PLACE_SETTLE_MS = 400;

const PLACE_KINDS: { value: PlaceKind; label: string }[] = [
  { value: "dir", label: "Directory" },
  { value: "file", label: "File" },
  { value: "route", label: "Route prefix" },
];

/** The places the map names for a concern, offered as a person types: packages and directories, and the files of its examples. */
function placeHints(c: PracticeConcern | null): { dirs: string[]; files: string[]; packages: string[] } {
  const packages = [...new Set((c?.by_package ?? []).map((p) => p.package || "."))].sort();
  const dirs = [...new Set([".", ...packages, ...(c?.variants ?? []).flatMap((v) => v.where.dirs.map((d) => d.dir))])].sort();
  const files = [...new Set((c?.variants ?? []).flatMap((v) => [...v.examples, ...v.exceptions].map((e) => e.path)))].sort();
  return { dirs, files, packages };
}

/**
 * `concern`: the map's concern the choice is of (its title, unit, ways, mechanisms and places to offer); null when the
 * map does not list it. `labels`: way labels Drift printed elsewhere (a candidate's ways). `note`: why this candidate is
 * listed apart, when it is.
 */
export function PromoteDialog({ concern, initial, labels = {}, note, onClose }: { concern: PracticeConcern | null; initial: PromoteChoice; labels?: Record<string, string>; note?: string; onClose(): void }) {
  const { repo } = useRepo();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const title = concern?.title ?? initial.concern;
  const unit = concern?.unit ?? "unit";
  const hints = useMemo(() => placeHints(concern), [concern]);
  const [choice, setChoice] = useState<PromoteChoice>(initial);
  // The place as typed; the dry run follows it once typing settles.
  const [draft, setDraft] = useState<PlaceChoice>(initial.place);
  const [writing, setWriting] = useState(false);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (same(draft, choice.place)) return;
    const id = setTimeout(() => setChoice((c) => ({ ...c, place: draft })), PLACE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [draft, choice.place]);

  const req = requestOf(choice);
  const problem = placeProblem(draft);
  // What the command line refuses from the request alone: not run, said in its words.
  const cli = choiceRefusal(choice);
  const runnable = !!repo && !!req && !cli;

  const q = useQuery({
    queryKey: ["promotePreview", repo?.path ?? "none", req],
    enabled: runnable,
    queryFn: ({ signal }) => api.promotePreview(repo!, req!, { signal }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  // The last dry run that was not refused: its counts stay on screen (and its ways tickable) while a choice is refused.
  const [lastOk, setLastOk] = useState<PromoteResult | null>(null);
  if (q.data && !isRefused(q.data) && q.data !== lastOk) setLastOk(q.data);

  const fresh = runnable && q.data && !q.isPlaceholderData ? q.data : null;
  const current = fresh && !isRefused(fresh) ? fresh : null;
  const refused: PromoteRefused | null = fresh && isRefused(fresh) ? fresh : null;
  // A refusal for units Drift could not read names the one cause they share when it can: its config line, to copy.
  const refusalHint = refused ? (refusalCause(refused.refused)?.hint ?? null) : null;
  const replayRefused = refused ? refusedReplay(refused) : null;
  const shown = current ?? lastOk;
  const [seenWays, setSeenWays] = useState<Record<string, string>>(() => Object.fromEntries(initial.ways.map((id) => [id, labels[id] ?? id])));
  if (current) {
    const fresh = [...current.candidate.ways, ...current.candidate.other_ways].filter((w) => seenWays[w.id] !== w.label);
    if (fresh.length) setSeenWays((m) => ({ ...m, ...Object.fromEntries(fresh.map((w) => [w.id, w.label])) }));
  }
  const block = blockOffer(choice, lastOk);
  // `--force` is offered where Drift refused for the share (the only refusal it lifts), and stays while it is ticked.
  const offer = forceOffer(refused);
  const [forceFor, setForceFor] = useState<ReturnType<typeof forceOffer>>(null);
  if (offer && JSON.stringify(offer) !== JSON.stringify(forceFor)) setForceFor(offer);
  const forceShown = offer ?? (choice.force ? forceFor : null);
  const settled = same(draft, choice.place);
  const canWrite = runnable && !!current && settled && !q.isFetching && !writing;

  const choose = (next: (c: PromoteChoice) => PromoteChoice) => {
    setWriteRefusal(null);
    setWriteError(null);
    setChoice(next);
  };

  const write = async () => {
    if (!repo || !current || !req) return;
    const command = promoteCommand(repo.path, req, false);
    setWriting(true);
    setWriteRefusal(null);
    setWriteError(null);
    try {
      const out = await api.promote(repo, req);
      if (isRefused(out)) {
        log("warn", "practices promote refused", { command, output: out.message });
        setWriteRefusal(out.message);
        return;
      }
      log("info", `practices promote ${out.convention.id}`, { command, output: out.preview });
      await Promise.all([keys.policy(repo), keys.check(repo), keys.practices(repo), keys.history(repo), keys.census(repo), keys.promoteList(repo)].map((queryKey) => qc.invalidateQueries({ queryKey })));
      const id = out.convention.id;
      const replaced = (out.replaces ?? []).map((r) => r.id);
      toast.show({
        title: `Convention ${id}`,
        body: replaced.length ? `${out.convention.summary} (replaces ${replaced.join(", ")})` : out.convention.summary,
        tone: "success",
        duration: 6000,
        action: { label: "Open", onClick: () => navigate("conventions", id) },
      });
      onClose();
    } catch (e) {
      log("error", "practices promote failed", { command, error: errText(e) });
      setWriteError(errText(e));
    } finally {
      setWriting(false);
    }
  };

  const mechanisms = mechanismOptions(concern, choice.mechanisms);
  const enforcing = ENFORCING_CONCERNS.includes(choice.concern);
  // A way stays offered once seen (the first choice's, and every way an answer counted), so unticking one, or a form
  // whose answer counts no way, never takes its checkbox away.
  const ways = wayOptions(shown, concern, [...new Set([...choice.ways, ...Object.keys(seenWays)])], { ...labels, ...seenWays });
  const placeWords = req ? (req.place === "." ? "the root package" : req.place) : "this place";

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !writing) onClose();
      }}
      size="lg"
      title="Make this a convention"
      description={`${title}. From now on drift check reports a new ${unitsWord(unit, 1)} in ${placeWords} that does it another way, or not at all.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={writing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void write()} disabled={!canWrite} loading={writing}>
            {choice.block ? "Make it a blocking convention" : choice.force ? "Make it a convention below the share" : "Make it a convention"}
          </Button>
        </>
      }
    >
      <div className="pr-promote st-stack">
        {note && (
          <p className="ck-note pr-promote__note" role="note">
            <Icon name="info" size={14} />
            <span>{note}</span>
          </p>
        )}
        <fieldset className="pr-promote__accepts st-stack">
          <legend className="dui-overline">What it accepts</legend>
          <p className="t-caption t-muted">A {unitsWord(unit, 1)} follows when it does any of what is ticked. Nothing is added unless you tick it.</p>
          <div className="pr-promote__ways st-stack">
            <div className="t-caption t-secondary">Ways</div>
            {ways.length ? (
              ways.map((w) => (
                <Checkbox
                  key={w.id}
                  checked={choice.ways.includes(w.id)}
                  disabled={writing}
                  onCheckedChange={(on) => choose((c) => ({ ...c, ways: toggleWay(c.ways, w.id, on) }))}
                  label={w.label}
                  hint={`${w.members === null ? "not counted here yet" : `${num(w.members)} ${unitsWord(unit, w.members)}`} · ${w.id}`}
                />
              ))
            ) : (
              <p className="t-caption t-muted">No way of it is used here.</p>
            )}
          </div>
          {mechanisms.length > 0 && (
            <div className="pr-promote__mechanisms st-stack">
              <div className="t-caption t-secondary">A mechanism whole, whichever instrument it names</div>
              {mechanisms.map((m) => (
                <Checkbox
                  key={m}
                  checked={choice.mechanisms.includes(m)}
                  disabled={writing}
                  onCheckedChange={(on) => choose((c) => ({ ...c, mechanisms: toggleMechanism(c.mechanisms, m, on) }))}
                  label={mechanismWords(m)}
                  hint={`--mechanism ${m}`}
                />
              ))}
            </div>
          )}
          <Checkbox
            className="pr-promote__enforcing"
            checked={choice.anyEnforcing}
            disabled={writing || (!enforcing && !choice.anyEnforcing)}
            onCheckedChange={(on) => choose((c) => ({ ...c, anyEnforcing: on }))}
            label="Any way that enforces it"
            hint={enforcing ? "--any-enforcing: a way that opens a route on purpose is accepted only when you name it" : noEnforcingMessage(choice.concern)}
          />
        </fieldset>
        <fieldset className="pr-promote__placefield st-stack">
          <legend className="dui-overline">Place</legend>
          <SegmentedControl<PlaceKind>
            label="Kind of place"
            size="sm"
            items={PLACE_KINDS}
            value={draft.kind}
            onValueChange={(kind) => {
              setWriteRefusal(null);
              setDraft((p) => switchPlaceKind(p, kind, hints));
            }}
          />
          <div className="st-row st-wrap pr-promote__placeinputs">
            <Input
              aria-label={draft.kind === "route" ? "Package" : draft.kind === "file" ? "File" : "Directory"}
              className="dui-mono"
              value={draft.path}
              list={draft.kind === "file" ? "pr-promote-files" : draft.kind === "route" ? "pr-promote-packages" : "pr-promote-dirs"}
              invalid={!!problem}
              disabled={writing}
              onChange={(e) => setDraft((p) => ({ ...p, path: e.target.value }))}
            />
            {draft.kind === "route" && <Input aria-label="Route prefix" className="dui-mono" value={draft.prefix ?? ""} invalid={!!problem} disabled={writing} onChange={(e) => setDraft((p) => ({ ...p, prefix: e.target.value }))} />}
          </div>
          <datalist id="pr-promote-dirs">
            {hints.dirs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <datalist id="pr-promote-files">
            {hints.files.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <datalist id="pr-promote-packages">
            {hints.packages.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {problem ? (
            <p className="t-caption t-danger pr-promote__placeproblem" role="alert">
              {problem}
            </p>
          ) : (
            <p className="t-caption t-muted">
              {draft.kind === "route" ? `--in ${placeArg(draft)}: the routes of this package under the prefix, each parameter matching any parameter.` : draft.kind === "file" ? "Every unit of this one file." : "This directory and below (`.` is the root package)."}
            </p>
          )}
        </fieldset>
        {q.isLoading && !shown && <p className="t-muted t-body-sm">Running drift practices promote --dry-run…</p>}
        {q.error && (
          <p className="ck-note pr-promote__refused" role="alert">
            <Icon name="attention" size={14} />
            <span>{errText(q.error)}</span>
          </p>
        )}
        {shown && <Preview res={shown} stale={!current} />}
        {current && <PromoteAnswer res={current} />}
        <RadioGroup<Mode>
          label="Mode"
          value={choice.block ? "block" : "advise"}
          onValueChange={(m) => choose((c) => ({ ...c, block: m === "block" }))}
          options={[
            { value: "advise", label: "Advise", hint: "Reported by drift check, never fails it." },
            {
              value: "block",
              label: "Block",
              disabled: !block.can && !choice.block,
              hint: block.why ?? "Fails drift check. Drift allows it only when the replay of the units most recently added here shows they already follow it.",
            },
          ]}
        />
        {forceShown && (
          <div className="pr-promote__force st-stack">
            <Checkbox
              checked={choice.force}
              disabled={writing}
              onCheckedChange={(on) => choose((c) => ({ ...c, force: on, block: on ? false : c.block }))}
              label="Promote it below the share on my word (--force)"
              hint={forceText(forceShown, unit)}
            />
          </div>
        )}
        {cli && (
          <p className="ck-note pr-promote__refused" role="alert" data-code={cli.code}>
            <Icon name="blocked" size={14} />
            <span>Drift refuses this before reading anything: {cli.message}</span>
          </p>
        )}
        {(refused || writeRefusal) && (
          <p className="ck-note pr-promote__refused" role="alert" data-code={refused?.refused.code}>
            <Icon name="blocked" size={14} />
            <span>
              Drift refused{writeRefusal ? "; nothing was written" : ""}: {writeRefusal ?? refused?.message}
              {!writeRefusal && replayRefused && ` ${replaySentence(replayRefused, unit)}`}
            </span>
          </p>
        )}
        {refused && !writeRefusal && refusalHint && (
          <p className="t-caption t-muted pr-promote__cause">
            {t("practices.candidates.causeHint")} <code className="st-cmd">{refusalHint}</code>
          </p>
        )}
        {writeError && (
          <p className="ck-note pr-promote__refused" role="alert">
            <Icon name="attention" size={14} />
            <span>drift practices promote failed: {writeError}</span>
          </p>
        )}
        {repo && req && <code className="st-cmd pr-promote__cmd">{promoteCommand(repo.path, req, false)}</code>}
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

/** What Drift answered beyond the counts: the convention it records, what it replaces, the replay, a block it dropped. */
export function PromoteAnswer({ res }: { res: PromoteResult }) {
  const replaces = replacesText(res);
  const replay = replayText(res);
  return (
    <div className="pr-promote__answer st-stack" data-testid="promote-answer">
      <p className="t-caption t-secondary">
        Drift would write <span className="dui-mono">{res.convention.id}</span> ({res.convention.mode}): {res.convention.summary}.{" "}
        {res.baselined ? `${num(res.baselined)} drift.lock ${res.baselined === 1 ? "entry" : "entries"} added.` : "No drift.lock entry added."}
      </p>
      {replaces.map((r) => (
        <p key={r} className="ck-note pr-promote__replaces" role="note">
          <Icon name="info" size={14} />
          <span>{r}</span>
        </p>
      ))}
      {replay && <p className="t-secondary t-body-sm pr-promote__replay">{replay}</p>}
      {res.block_dropped && <p className="t-caption t-muted pr-promote__dropped">It blocked before; it advises now: {res.block_dropped}</p>}
    </div>
  );
}

/** The place, what is accepted and Drift's counts: what follows, what is recorded as it is, what it could not read. */
function Preview({ res, stale }: { res: PromoteResult; stale: boolean }) {
  const c = res.candidate;
  const exc = exceptionsShown(res);
  return (
    <div className={`pr-promote__preview st-stack${stale ? " is-stale" : ""}`} aria-busy={stale}>
      <div className="pr-promote__place">
        <span className="dui-overline">Place</span> <span className="dui-mono">{res.place}</span>
      </div>
      <div>
        <div className="dui-overline">Accepted</div>
        <ul className="st-plainlist t-body-sm">
          {c.ways.map((w) => (
            <li key={w.id}>
              {w.label} <span className="t-muted">· {num(w.members)}</span> <span className="dui-mono t-muted t-caption">{w.id}</span>
            </li>
          ))}
          {(c.mechanisms ?? []).map((m) => (
            <li key={`m:${m}`}>{mechanismWords(m)} whole, whichever instrument it names</li>
          ))}
          {c.any_enforcing && <li>any way that enforces it</li>}
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
        {notCheckedLine(c)}
        {c.forced ? " Below the 80% share on a person's word: advise only." : ""}
        {c.unread_routes ? ` Of those, ${num(c.unread_routes)} ${c.unread_routes === 1 ? "has" : "have"} a route Drift did not read to the end, so whether ${c.unread_routes === 1 ? "it is" : "they are"} under ${c.place.route ?? "the prefix"} is not known.` : ""}
      </p>
      {c.unknown_cause && <CauseNote text={unknownCauseText(c.unknown_cause)} />}
      {jobsLine(c) && <p className="t-caption t-muted pr-promote__jobs">{jobsLine(c)}</p>}
      {res.same_way && res.same_way.length > 0 && (
        <p className="t-caption t-muted pr-promote__same">
          <span className="dui-mono">{res.same_way.join(", ")}</span> {res.same_way.length === 1 ? "names" : "name"} the same way for code of this package. With both accepted, new code that breaks them is reported under each; reject one in Conventions if you want a single rule.
        </p>
      )}
    </div>
  );
}

/** The one cause every unit Drift could not read here shares, and the config line that would let it read them. */
function CauseNote({ text }: { text: ReturnType<typeof unknownCauseText> }) {
  return (
    <p className="t-caption t-muted pr-promote__cause">
      {text.what} {text.after}
      {text.hint && (
        <>
          {" "}
          <code className="st-cmd">{text.hint}</code>
        </>
      )}
    </p>
  );
}
