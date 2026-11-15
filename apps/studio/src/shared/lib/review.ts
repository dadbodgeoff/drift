// The `drift review` command a decision runs, as the Studio shows it. The main
// process builds the real argv (electron/ops.ts `reviewFlags`); a unit test keeps the two equal.
import type { Answer, Decision } from "@/shared/ipc/contract";

export function reviewFlags(d: Decision, ids: string[]): string[] {
  const list = ids.join(",");
  return d === "force_block" ? ["--block", list, "--force"] : [`--${d}`, list];
}

export function reviewCommand(root: string, d: Decision, ids: string[]): string {
  return `drift --root ${root} review ${reviewFlags(d, ids).join(" ")}`;
}

/** The `drift review` command a reviewer's exception runs: `--exempt` with a reason, `--unexempt` without (electron/ops.ts `exemptFlags`). */
export function exemptCommand(root: string, id: string, member: string, reason: string | null): string {
  const q = (v: string) => (/[\s"'`$\\]/.test(v) ? JSON.stringify(v) : v);
  return reason === null ? `drift --root ${root} review --unexempt=${id} ${q(`--member=${member}`)}` : `drift --root ${root} review --exempt=${id} ${q(`--member=${member}`)} ${q(`--reason=${reason}`)}`;
}

/** The `drift review` command a block candidate's answer runs (electron/ops.ts `answerFlags`): values attached with `=`. */
export function answerFlags(id: string, answer: Answer, setApart: string[], confirmEntry: string[]): string[] {
  if (answer !== "different") return [`--answer=${id}=${answer}`];
  return [`--answer=${id}=${answer}`, `--set-apart=${[...new Set(setApart)].join(",")}`, ...(confirmEntry.length ? [`--confirm-entry=${[...new Set(confirmEntry)].join(",")}`] : [])];
}

export function answerCommand(root: string, id: string, answer: Answer, setApart: string[], confirmEntry: string[]): string {
  const q = (v: string) => (/[\s"'`$\\]/.test(v) ? JSON.stringify(v) : v);
  return `drift --root ${root} review ${answerFlags(id, answer, setApart, confirmEntry).map(q).join(" ")}`;
}
