// "Is this report true?": a person marks a violation true or wrong (`drift feedback mark`) where it is shown. Confirmed
// in a dialog that says what is written and where, and that nothing is sent; Drift's own output is shown after.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, Icon, Input } from "@drift/ui";
import { useRepo } from "@/entities/repo";
import { useApi } from "@/shared/api";
import type { Verdict } from "@/shared/ipc/contract";
import { log } from "@/shared/lib/log";
import "./feedback.css";
import { MAX_WHY, NOTHING_SENT, markCommand, markOf, marksKey, oneLine, useMarks } from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The mark on one violation (`id`, `path#symbol`) and the two buttons that record one. */
export function MarkControl({ id, member }: { id: string; member: string }) {
  const { repo } = useRepo();
  const marks = useMarks(repo);
  const [asking, setAsking] = useState<Verdict | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const mark = markOf(marks.data, id, member);
  return (
    <div className="fb-mark" data-testid="feedback-mark">
      <div className="st-row st-wrap fb-mark__row">
        <span className="dui-overline">Is this report right?</span>
        {mark && (
          <Badge tone={mark.verdict === "true" ? "success" : "warning"} icon className="fb-mark__current">
            marked {mark.verdict} on {mark.day}
          </Badge>
        )}
        <Button size="sm" variant="secondary" icon="check" onClick={() => setAsking("true")} disabled={!repo}>
          Mark true
        </Button>
        <Button size="sm" variant="secondary" icon="x" onClick={() => setAsking("wrong")} disabled={!repo}>
          Mark wrong…
        </Button>
      </div>
      {mark?.why && <p className="t-caption t-secondary">Your reason: {mark.why}</p>}
      {output && <pre className="t-caption t-secondary fb-mark__out">{output}</pre>}
      {asking && (
        <MarkDialog
          id={id}
          member={member}
          verdict={asking}
          replacing={!!mark}
          onDone={(o) => {
            setAsking(null);
            if (o !== null) setOutput(o);
          }}
        />
      )}
    </div>
  );
}

function MarkDialog({ id, member, verdict, replacing, onDone }: { id: string; member: string; verdict: Verdict; replacing: boolean; onDone(output: string | null): void }) {
  const { repo } = useRepo();
  const api = useApi();
  const qc = useQueryClient();
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = oneLine(why) ? oneLine(why) : null;
  const tooLong = !!reason && [...reason].length > MAX_WHY;
  const command = markCommand(id, member, verdict, reason);
  const run = async () => {
    if (!repo || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.feedbackMark(repo, id, member, verdict, reason);
      log("info", "feedback mark", { command });
      await qc.invalidateQueries({ queryKey: marksKey(repo) });
      onDone(out);
    } catch (e) {
      log("error", "feedback mark failed", { command, error: errText(e) });
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onDone(null);
      }}
      size="md"
      title={verdict === "true" ? "Mark this report true" : "Mark this report wrong"}
      description={verdict === "true" ? "The code really departs from the convention." : "Drift misread the code, or the rule does not fit it."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDone(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || tooLong} loading={busy}>
            {replacing ? "Replace the mark" : verdict === "true" ? "Mark true" : "Mark wrong"}
          </Button>
        </>
      }
    >
      <div className="st-stack fb-dialog">
        <p className="t-body-sm">
          <span className="dui-mono">{id}</span> on <span className="dui-mono">{member}</span>
        </p>
        <p className="ck-note is-info">
          <Icon name="info" size={13} />
          <span>{NOTHING_SENT} Only drift feedback export counts it, into a file you read and choose to share.</span>
        </p>
        {verdict === "wrong" && <p className="t-caption t-secondary">To make Drift stop reporting a member that is fine, record an exception instead (Conventions: fine because…, or a drift-ignore comment with a reason).</p>}
        <label className="st-stack fb-why">
          <span className="t-caption">Why, in your words (optional, at most {MAX_WHY} characters; exported only with --include-reasons)</span>
          <Input value={why} onChange={(e) => setWhy(e.currentTarget.value)} invalid={tooLong} maxLength={2000} aria-label="Why (optional)" />
        </label>
        {tooLong && <p className="t-caption t-danger">The reason is longer than {MAX_WHY} characters.</p>}
        <code className="st-cmd fb-cmd">{command}</code>
        {error && (
          <p className="ck-note" role="alert">
            <Icon name="attention" size={14} />
            <span>drift feedback mark failed: {error}</span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
