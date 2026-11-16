// Beta feedback marks (`drift feedback mark`, crates/drift-cli/src/feedback.rs): a person's verdict, true or wrong, on
// one report, kept in `.drift/feedback/marks.json` on this machine. Nothing in Drift reads that file but `drift feedback
// export`, which the person runs and shares by hand: a mark changes no verdict, and nothing is sent anywhere.
import { useQuery } from "@tanstack/react-query";
import { type RepoRef, useApi } from "@/shared/api";
import { type FeedbackMark, type FeedbackMarks, MARKS_SCHEMA, SUPPORTED_MARKS } from "@/shared/contract/screens";
import type { Verdict } from "@/shared/ipc/contract";

/** What the Studio says wherever a mark is made or listed, as `drift feedback mark` says it. */
export const NOTHING_SENT = "Kept in .drift/feedback/marks.json, on this machine only; nothing is sent anywhere. A mark changes no verdict: Drift reports the code as before.";

/** The longest reason Drift keeps (feedback.rs `MAX_WHY`). */
export const MAX_WHY = 300;

/** A reason as Drift keeps it: whitespace collapsed, trimmed (feedback.rs `why_text`). */
export const oneLine = (s: string) => s.trim().split(/\s+/).join(" ");

/** The marks file as Drift wrote it, every mark checked; another schema or a newer version is an error, said with what it got. */
export function readMarks(raw: unknown): FeedbackMarks | null {
  if (raw === null || raw === undefined) return null;
  const d = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (d.schema !== MARKS_SCHEMA || typeof d.version !== "number" || !SUPPORTED_MARKS.includes(d.version))
    throw new Error(`.drift/feedback/marks.json is ${String(d.schema)} version ${String(d.version)}; this Studio reads ${MARKS_SCHEMA} version ${SUPPORTED_MARKS.join("/")}`);
  const marks = (Array.isArray(d.marks) ? d.marks : []).filter((m): m is FeedbackMark => !!m && typeof m === "object" && typeof (m as FeedbackMark).id === "string" && typeof (m as FeedbackMark).verdict === "string");
  return { schema: MARKS_SCHEMA, version: d.version, marks };
}

/** The mark on a violation (`id` and `path#symbol`), if there is one: one per report. */
export function markOf(marks: FeedbackMarks | null | undefined, id: string, member: string): FeedbackMark | null {
  return marks?.marks.find((m) => m.report === "violation" && m.id === id && m.member === member) ?? null;
}

/** How many marks say true and wrong. */
export function tally(marks: readonly FeedbackMark[]): { true: number; wrong: number } {
  return { true: marks.filter((m) => m.verdict === "true").length, wrong: marks.filter((m) => m.verdict === "wrong").length };
}

/**
 * `drift feedback mark` arguments the Studio runs (electron/screens-ops.ts `markFlags`; a unit test keeps the two equal):
 * the verdict, the reason attached with `=`, then `--`, the convention id and the member.
 */
export function markFlags(id: string, member: string, verdict: Verdict, why: string | null): string[] {
  return [verdict === "true" ? "--true" : "--wrong", ...(why === null ? [] : [`--why=${oneLine(why)}`]), "--", id, member];
}

/** The command as a person would paste it: each value one shell word. */
export function markCommand(id: string, member: string, verdict: Verdict, why: string | null): string {
  const q = (v: string) => (/^[A-Za-z0-9_./#:=@,+-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
  return `drift feedback mark ${markFlags(id, member, verdict, why).map(q).join(" ")}`;
}

export const marksKey = (r: RepoRef) => ["policy", r.path, "feedback-marks"] as const;

/**
 * The marks file, read when a view asks. The key sits under the policy files' (`["policy", path]`), so a rescan reads
 * it again; a mark made here refetches it.
 */
export function useMarks(repo: RepoRef | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? marksKey(repo) : ["policy", "none", "feedback-marks"],
    enabled: !!repo && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => readMarks(await api.feedbackMarks(repo!)),
  });
}
