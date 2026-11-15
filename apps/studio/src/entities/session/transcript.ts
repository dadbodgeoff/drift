// Claude Code transcripts (`~/.claude/projects/<project>/<session>.jsonl`) as a
// timeline, with Drift's hook interventions recognised and aligned.
//
// Records the parser understands (others are counted and skipped):
//   user       message.content: string (prompt) | [{type: tool_result, tool_use_id, content, is_error}];
//              isMeta: true (hook feedback such as "Stop hook feedback:", notifications) is skipped, never a prompt
//              toolUseResult: {filePath, structuredPatch, type: create|update, content}
//   assistant  message.content: [{type: text|thinking|tool_use, ...}]
//   attachment attachment.type: hook_success {hookEvent, hookName, toolUseID, stdout}
//              hook_additional_context {hookEvent, toolUseID, content: string[]}
//              hook_blocking_error {hookEvent, blockingError: {blockingError}}
//   system     subtype: stop_hook_summary {hookErrors: string[], preventedContinuation}
//
// Everything in a transcript is untrusted text. Nothing here interprets it as
// markup, links or commands.

import type { SessionState } from "@/shared/contract/drift";

export type DriftKind = "session" | "primed" | "practices" | "facts" | "advised" | "unsure" | "blocked" | "unsure_start" | "unsure_again" | "denied" | "stepped_aside" | "recovered" | "unchecked" | "exempt" | "unwired" | "lookup" | "brief" | "error";

export interface DriftFinding {
  id: string;
  path?: string;
  line?: number;
  symbol?: string;
  /** Exempt members (#45): Drift's reason the convention is not about this member. */
  reason?: string;
}

export interface DriftInfo {
  kind: DriftKind;
  ids: string[];
  findings: DriftFinding[];
  shell?: boolean;
  /** Exempt members (#45): how many the message counts (it names at most three). */
  members?: number;
}

export interface DriftInfo {
  kind: DriftKind;
  ids: string[];
  findings: DriftFinding[];
  shell?: boolean;
  /** `unchecked`: the files the message names as not checked (a note names at most three); `unsure`: the files of the violations it lists (#32). */
  files?: string[];
  /** `session`: how many accepted conventions; `unchecked` note (SessionStart, Stop): how many files it counts; `unsure`: how many possible violations; `unsure_start`: how many of the blocked violations were unsure at session start; `unsure_again`: how many are still there after blocking once (#32). */
  count?: number;
  /** `unsure`: the files not checked that the violations depend on, as named (at most three) (#32). */
  on?: string[];
  /** `unsure`: the message names only the first three files depended on (#32). */
  onMore?: boolean;
  /** A recovered baseline left out every violation of these languages: a file of the language changed since HEAD or is untracked (#32). */
  notBaselined?: string[];
  /** `session`: accepted conventions that block at end of turn, and those that only advise (absent in transcripts from before Drift counted them). */
  blocking?: number;
  advising?: number;
  /** `advised`: how many of the violations listed are in block mode (marked `(blocks)`), so block the end of the turn (PostToolUse) or fail `drift check` (MCP) if still there. */
  willBlock?: number;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface FileEdit {
  path: string;
  tool: string;
  created: boolean;
  hunks: Hunk[];
}

interface Base {
  /** Position in the file (stable key). */
  seq: number;
  time: number | null;
  sidechain: boolean;
}

export type TimelineEvent =
  | (Base & { type: "prompt"; text: string })
  | (Base & { type: "text"; text: string; model?: string })
  | (Base & { type: "thinking"; text: string; redacted: boolean })
  | (Base & {
      type: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      summary: string;
      result: { text: string; isError: boolean } | null;
      edit: FileEdit | null;
    })
  | (Base & {
      type: "hook";
      event: string;
      hookName: string;
      toolUseId: string | null;
      text: string;
      drift: DriftInfo | null;
    });

export interface Transcript {
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  start: number | null;
  end: number | null;
  events: TimelineEvent[];
  skipped: number;
  malformed: number;
}

const MAX_TEXT = 200_000;
const cap = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "\n… [truncated by Drift Studio]" : s);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function ts(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * How each of Drift's hook messages opens (crates/drift-cli/src/agent.rs, crates/drift-mine/src/report.rs).
 * A transcript holds only what the agent saw, so this is the one place the Studio reads Drift's text;
 * `source` is the literal it comes from, and tests/unit/coverage.test.ts fails when Drift's source no
 * longer contains it. Order matters: the first match wins.
 */
export const DRIFT_OPENINGS: { kind: DriftKind; re: RegExp; source: string; denyOnly?: boolean; legacy?: boolean }[] = [
  // SessionStart: how many accepted conventions block at end of turn and how many advise (the mode as checked).
  { kind: "session", re: /^Drift: \d+ of this repo's \d+ accepted conventions block at end of turn/, source: "Drift: {blocking} of this repo's {accepted} accepted conventions block at end of turn (a new violation stops the turn from ending), {advise} advise." },
  { kind: "session", re: /^Drift: this repo's \d+ accepted conventions advise only \(0 block at end of turn\)/, source: "Drift: this repo's {accepted} accepted conventions advise only (0 block at end of turn)." },
  // SessionStart with `agents.verify: on` (experimental): the suggestions hidden until the host agent verifies them (alone when none is shown).
  { kind: "session", re: /^Drift \(experimental\): \d+ accepted suggestion\(s\) are hidden from you until verified/, source: "Drift (experimental): {n} accepted suggestion(s) are hidden from you until verified" },
  // Before the counts: every accepted convention, blocking or not, was called "enforcing".
  { kind: "session", re: /^Drift is enforcing \d+ learned conventions/, source: "Drift is enforcing {accepted} learned conventions in this repo", legacy: true },
  // Since R3's text fixes: the prime says what N/M means, that advice needs no action where it does not fit, and offers drift-ignore for rules that block only.
  { kind: "primed", re: /^drift: conventions for files like .* \(N\/M: members of the rule's role that follow it\)/, source: "drift: conventions for files like {shown_rel} (N/M: members of the rule's role that follow it):" },
  { kind: "primed", re: /^drift: conventions for new files at .*, by what the file contains/, source: "drift: conventions for new files at {shown_rel}, by what the file contains (N/M: members of the rule's role that follow it):" },
  { kind: "primed", re: /^drift: files like .* follow these accepted conventions/, source: "drift: files like {shown_rel} follow these accepted conventions:", legacy: true },
  // Python parity (#12): rules chosen by what the new file declares.
  { kind: "primed", re: /^drift: accepted conventions for new files at .*, by what the file contains/, source: "drift: accepted conventions for new files at {shown_rel}, by what the file contains:", legacy: true },
  { kind: "primed", re: /^drift: files at .* follow these accepted conventions/, source: "drift: files at", legacy: true },
  // Round 13 practices (agent.rs `session_brief`, `new_file_recipe`): SessionStart's brief of the package's recipes, after
  // the session's opening, and PreToolUse's recipe for a new file of a recipe's kind; facts, not rules, each its own message.
  { kind: "practices", re: /^drift: practices in .+ \(facts, not rules; each names a file to copy\):/, source: "drift: practices in {} (facts, not rules; each names a file to copy):" },
  { kind: "practices", re: /^drift: practices for .+ \(facts, not rules\): /, source: "drift: practices for {} (facts, not rules): " },
  // PostToolUse (agent.rs `edit_facts`): the written file's entry points do a concern another way than at least 80% of
  // those around them; advice, once per unit, never a block, with nothing accepted too. Its own message, after any convention advice.
  { kind: "practices", re: /^drift: .+ departs from the practices around it \(facts, not rules; nothing is blocked\):/, source: " departs from the practices around it (facts, not rules; nothing is blocked):" },
  // PostToolUse (agent.rs `edit_facts`, `introduced_message`): what the edit introduced that the code did not have when the session started,
  // from the security inventory (a risky operation, an entry point reaching one with or without a guard, client code reaching server-only
  // code or a secret); advice, once per fact, never a block, with nothing accepted too. Its own message, after any practice departures.
  { kind: "facts", re: /^drift: .+ now does what it did not at session start \(facts, not rules; nothing is blocked\):/, source: " now does what it did not at session start (facts, not rules; nothing is blocked):" },
  // PostToolUse (agent.rs `edit_facts`, `edges_message`): an import of the edited file makes its package depend on a package it did not depend on
  // when the session started (a production edge of `drift map`'s package graph; tests and imports inside a package are not one), with the line
  // of the import and, when the other package already depends on this one, that the two now depend on each other. One sentence an edge, once.
  { kind: "facts", re: /^drift: .+ makes .+ depend on .+, which it did not depend on at session start \(facts, not rules; nothing is blocked\): /, source: ", which it did not depend on at session start (facts, not rules; nothing is blocked): " },
  // Stop (agent.rs `still_standing`): to the person, how many of the facts PostToolUse told the agent about its edits the code still has, and
  // where; the last line of Stop's systemMessage, at the end of a turn in which the agent was told one that still stands. Never a block.
  { kind: "facts", re: /^drift: \d+ fact\(s\) the agent was told about this session's edits still stand \(facts, not rules; nothing is blocked\): /, source: " fact(s) the agent was told about this session's edits still stand (facts, not rules; nothing is blocked): " },
  { kind: "blocked", re: /^drift: \d+ new convention violation\(s\) \(blocks end of turn\)/, source: '"blocks end of turn"' },
  // PostToolUse and MCP drift_check: advice, counting the block-mode ones (marked `(blocks)`) that block end of turn, or fail `drift check`, if still there.
  { kind: "advised", re: /^drift: \d+ new convention violation\(s\)/, source: "drift: {} new convention violation(s) ({head})" },
  { kind: "stepped_aside", re: /^drift: \d+ unresolved violation\(s\) of .* left for review/, source: "drift: {} unresolved violation(s) of {} left for review" },
  // Stack bound (#32). PostToolUse on a file Drift could not parse: the agent's context, then the person's systemMessage.
  { kind: "unchecked", re: /^drift: .+ was NOT checked against the accepted conventions \(/, source: "was NOT checked against the accepted conventions ({NO_STACK}). Do not assume it follows them" },
  { kind: "unchecked", re: /^drift: .+ was not checked: no thread stack/, source: "was not checked: {NO_STACK}. Run `drift check` with more memory to check it." },
  // SessionStart's and Stop's note to the person naming files not checked: its own line, before the hook's other message.
  { kind: "unchecked", re: /^drift: \d+ file\(s\) not checked \(.*\): no thread stack/, source: "drift: {} file(s) not checked ({}{}): no thread stack large enough to parse them could be reserved" },
  // Stop's note to the person beside a block: some blocked violations were unsure at session start, so they may predate it.
  { kind: "unsure_start", re: /^drift: \d+ of these were unsure at session start/, source: "of these were unsure at session start (their files read a file that could not be parsed then), so they may predate the session; drift blocks on them once, and lists them as advice after that while their files stay as they are." },
  // Stop's note on later turns: those that blocked once are still there, their files as they were then, listed as advice (`unsure_blocked`); its own line, before the hook's other message.
  { kind: "unsure_again", re: /^drift: \d+ violation\(s\) that were unsure at session start are still there \(/, source: "drift: {} violation(s) that were unsure at session start are still there ({}); they may predate the session, and drift blocked on them once." },
  // Unsure violations (crates/drift-mine/src/report.rs `agent_unsure_message`): in PostToolUse context after any advice, with the violations listed.
  { kind: "unsure", re: /^drift: \d+ possible violation\(s\), not certain: they depend on files not checked \(/, source: "drift: {} possible violation(s), not certain: they depend on files not checked ({}{}; no stack could be reserved to parse them)" },
  // Members of the agent's code a convention is not about (#45): its own line, after PostToolUse advice or in Stop's systemMessage; never blocks.
  { kind: "exempt", re: /^drift: \d+ member\(s\) exempt from accepted conventions:/, source: "drift: {} member(s) exempt from accepted conventions:" },
  // Stop without a recorded baseline (#6): a note, possibly followed by the real message.
  { kind: "recovered", re: /^drift: this session's state was missing/, source: "drift: this session's state was missing" },
  // Experimental wiring (#38): Stop shows it to the person, UserPromptSubmit hands it to the agent with the next prompt.
  { kind: "unwired", re: /^drift: code added in the last turn may not be wired up yet/, source: "drift: code added in the last turn may not be wired up yet" },
  { kind: "lookup", re: /^drift knows this: `drift card /, source: "drift knows this: `drift card {file}`" },
  { kind: "brief", re: /^Drift map \(facts from this repository, not rules\):/, source: "Drift map (facts from this repository, not rules):" },
  { kind: "error", re: /^drift: hook error/, source: "drift: hook error" },
  // PreToolUse denials: Write/Edit under .drift/ or drift.lock (#17 wording), and shell writes there (#23).
  { kind: "denied", re: /is Drift's policy or state .* and is changed by Drift and people only/, source: "is Drift's policy or state (conventions, lock, fact cache, sessions) and is changed by Drift and people only", denyOnly: true },
  { kind: "denied", re: /^This command looks like it writes under \.drift\/ or to drift\.lock/, source: "This command looks like it writes under .drift/ or to drift.lock", denyOnly: true },
  { kind: "denied", re: /is Drift policy and is changed by people only/, source: "is Drift policy and is changed by people only", denyOnly: true, legacy: true },
];

/** Why Drift did not check a file (crates/drift-cli/src/agent.rs `NO_STACK`): every stack-bound message (#32) says it. */
export const NO_STACK = "no thread stack large enough to parse it could be reserved, an address-space or memory limit on this run";

/** One-line notes (#32) Drift prepends to Stop's and SessionStart's systemMessage: the unchecked note, and Stop's note on unsure violations still there. Whatever follows one is another message. */
const NOTE_LINE = /^drift: (?:\d+ file\(s\) not checked \(|\d+ violation\(s\) that were unsure at session start are still there \()/;
/**
 * A line that starts a message of its own inside one hook text: the notes and the unsure part of PostToolUse context
 * (#32), the exemption line (#45) Drift appends to PostToolUse context and Stop's systemMessage, the practice departures,
 * then what the edit introduced and each package it made another depend on, which PostToolUse context ends with, the line
 * on what the agent was told and left, which Stop's systemMessage ends with, and in SessionStart's one message the
 * structure brief (after the practices lines) and the count of accepted conventions.
 */
const OWN_LINE = new RegExp(
  `${NOTE_LINE.source}|^drift: \\d+ possible violation\\(s\\), not certain: they depend on files not checked \\(|^drift: \\d+ member\\(s\\) exempt from accepted conventions:|^Drift: (?:\\d+ of this repo's|this repo's \\d+ accepted)|^Drift map \\(facts from this repository, not rules\\):|^drift: practices (?:in .+ \\(facts, not rules; each names a file to copy\\):|for .+ \\(facts, not rules\\): )|^drift: .+ departs from the practices around it \\(facts, not rules; nothing is blocked\\):|^drift: .+ now does what it did not at session start \\(facts, not rules; nothing is blocked\\):|^drift: .+ makes .+ depend on .+, which it did not depend on at session start \\(facts, not rules; nothing is blocked\\): |^drift: \\d+ fact\\(s\\) the agent was told about this session's edits still stand \\(facts, not rules; nothing is blocked\\): `,
);

/**
 * One hook text as the messages Drift put in it (#32). Stop's and SessionStart's
 * systemMessage carry the unchecked note before their own message (a recovered
 * baseline, a loop guard), and PostToolUse context carries the unsure part after
 * any advice; both end with the exemption line when there is one (#45): each is
 * shown, and counted, as its own entry. Anything else is one message.
 */
export function splitDriftMessages(text: string): string[] {
  const lines = text.split("\n");
  const parts: string[][] = [[]];
  lines.forEach((l, i) => {
    if (i > 0 && OWN_LINE.test(l) && parts[parts.length - 1].some((x) => x.trim())) parts.push([]);
    parts[parts.length - 1].push(l);
    if (NOTE_LINE.test(l) && i < lines.length - 1) parts.push([]);
  });
  const out = parts.map((p) => p.join("\n")).filter((p) => p.trim());
  return out.length > 1 ? out : [text];
}

/** The files a stack-bound message names (#32), as `crates/drift-cli/src/agent.rs` writes them. */
function uncheckedFacts(kind: DriftKind, t: string): Pick<DriftInfo, "files" | "count" | "on" | "onMore"> {
  const line = t.split("\n")[0];
  if (kind === "unsure") {
    const m = /^drift: (\d+) possible violation\(s\), not certain: they depend on files not checked \((.*); no stack could be reserved to parse them\)/.exec(line);
    if (!m) return {};
    const named = m[2].split(", ").filter(Boolean);
    const onMore = named[named.length - 1] === "...";
    // The files are those of the violations listed ("  at   path:line symbol").
    const files = [...new Set([...t.matchAll(/\n\s+at\s+(.+?):\d+\s/g)].map((x) => x[1]))];
    return { count: Number(m[1]), on: onMore ? named.slice(0, -1) : named, onMore, files };
  }
  const note = /^drift: (\d+) file\(s\) not checked \((.*)\): no thread stack/.exec(line);
  if (note)
    return {
      count: Number(note[1]),
      files: note[2]
        .split(", ")
        .filter((p) => p && p !== "..."),
    };
  const one = /^drift: (.+?) was (?:NOT checked against the accepted conventions \(|not checked: no thread stack)/.exec(line);
  return one ? { files: [one[1]], count: 1 } : {};
}

/** SessionStart's counts (crates/drift-cli/src/agent.rs `session_start_context`); none in the older "Drift is enforcing N" form. */
function sessionCounts(t: string): Pick<DriftInfo, "blocking" | "advising" | "count"> {
  const some = /^Drift: (\d+) of this repo's (\d+) accepted conventions block at end of turn \(.*?\), (\d+) advise\./.exec(t);
  if (some) return { blocking: Number(some[1]), count: Number(some[2]), advising: Number(some[3]) };
  const none = /^Drift: this repo's (\d+) accepted conventions advise only \(0 block/.exec(t);
  if (none) return { blocking: 0, count: Number(none[1]), advising: Number(none[1]) };
  const old = /^Drift is enforcing (\d+) learned conventions/.exec(t);
  return old ? { count: Number(old[1]) } : {};
}

function kindOf(t: string, deny: boolean): DriftKind | null {
  for (const o of DRIFT_OPENINGS) if ((!o.denyOnly || deny) && o.re.test(t)) return o.kind;
  return null;
}

/** "`Sym` not checked against D-xxxxxx: reason" items of an exemption line (crates/drift-mine/src/report.rs `exempt_message`). */
function exemptFindings(t: string): { findings: DriftFinding[]; members: number } {
  const line = t.split("\n")[0];
  const members = Number(/^drift: (\d+) member/.exec(line)?.[1] ?? 0);
  const findings: DriftFinding[] = [];
  const re = /`([^`]*)` not checked against (D-[0-9a-f]{6}): (.*?)(?=; `|; \+\d+ more|\. Run `drift check|$)/g;
  for (const m of line.matchAll(re)) findings.push({ id: m[2], symbol: m[1], reason: m[3] });
  return { findings, members };
}

/** Recognise Drift's own hook messages (crates/drift-cli/src/agent.rs). */
export function classifyDrift(text: string, extra?: { deny?: boolean }): DriftInfo | null {
  const t = text.trimStart();
  let kind = kindOf(t, !!extra?.deny);
  // A recovered baseline's note is followed by the message Stop would have sent anyway.
  if (kind === "recovered") {
    const rest = t.slice(t.indexOf("\n") + 1);
    const then = t.includes("\n") ? kindOf(rest, false) : null;
    if (then && then !== "recovered") kind = then;
  }
  if (!kind) return null;
  const ids = [...new Set([...t.matchAll(/\bD-[0-9a-f]{6}\b/g)].map((m) => m[0]))];
  const findings: DriftFinding[] = [];
  // "[D-xxxxxx] summary\n  at   path:line symbol"
  const re = /\[(D-[0-9a-f]{6})\][^\n]*\n\s+at\s+(.+?):(\d+)\s+([^\n]*)/g;
  for (const m of t.matchAll(re)) findings.push({ id: m[1], path: m[2], line: Number(m[3]), symbol: m[4].trim() });
  const out: DriftInfo = { kind, ids, findings };
  if (kind === "denied" && t.startsWith("This command")) out.shell = true;
  if (kind === "unchecked" || kind === "unsure") Object.assign(out, uncheckedFacts(kind, t));
  if (kind === "unsure_start") out.count = Number(/^drift: (\d+) of these/.exec(t)?.[1] ?? 0);
  if (kind === "session") Object.assign(out, sessionCounts(t));
  if (kind === "advised") {
    const m = /^drift: \d+ new convention violation\(s\) \((\d+) marked \(blocks\) /.exec(t);
    out.willBlock = m ? Number(m[1]) : 0;
  }
  if (kind === "unsure_again") {
    // "drift: N violation(s) that were unsure at session start are still there (D-xxxxxx path, ...); ..." (at most three named).
    const m = /^drift: (\d+) violation\(s\) that were unsure at session start are still there \((.*)\); they may predate/.exec(t.split("\n")[0]);
    out.count = Number(m?.[1] ?? 0);
    out.findings = [...(m?.[2] ?? "").matchAll(/(D-[0-9a-f]{6}) (.+?)(?=, D-[0-9a-f]{6} |$)/g)].map((x) => ({ id: x[1], path: x[2] }));
  }
  // A recovered baseline's note names the languages it left out (a file of the language changed since HEAD, or is untracked).
  const left = /^drift: this session's state was missing; [^\n]*?, none of them (.+?): a file of that language changed since HEAD/.exec(t);
  if (left) out.notBaselined = left[1].split(" or ");
  if (kind === "exempt") {
    const x = exemptFindings(t);
    out.findings = x.findings;
    out.members = x.members;
  }
  return out;
}

/** Text of a tool_result `content` (string or content blocks). */
function resultText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? str((b as { text?: unknown }).text) : ""))
      .filter(Boolean)
      .join("\n");
  return "";
}

/** One-line description of a tool call for the collapsed row. */
export function toolSummary(name: string, input: Record<string, unknown>, cwd: string | null): string {
  const rel = (p: unknown) => {
    const s = str(p);
    return cwd && s.startsWith(cwd + "/") ? s.slice(cwd.length + 1) : s;
  };
  switch (name) {
    case "Bash":
      return str(input.description) || str(input.command).split("\n")[0];
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return rel(input.file_path ?? input.notebook_path);
    case "Grep":
      return `${str(input.pattern)}${input.path ? ` in ${rel(input.path)}` : ""}`;
    case "Glob":
      return str(input.pattern);
    case "Task":
    case "Agent":
      return str(input.description);
    default: {
      const first = Object.values(input).find((v) => typeof v === "string");
      return typeof first === "string" ? first.split("\n")[0] : "";
    }
  }
}

function hunksFromStrings(oldS: string, newS: string): Hunk[] {
  return [
    {
      oldStart: 0,
      newStart: 0,
      lines: [...(oldS ? oldS.split("\n").map((l) => "-" + l) : []), ...(newS ? newS.split("\n").map((l) => "+" + l) : [])],
    },
  ];
}

function editFrom(name: string, input: Record<string, unknown>, result: Record<string, unknown> | null, cwd: string | null): FileEdit | null {
  if (!["Edit", "MultiEdit", "Write"].includes(name)) return null;
  const abs = str(input.file_path) || str(result?.filePath);
  if (!abs) return null;
  const path = cwd && abs.startsWith(cwd + "/") ? abs.slice(cwd.length + 1) : abs;
  const patch = result?.structuredPatch;
  let hunks: Hunk[] = [];
  if (Array.isArray(patch) && patch.length) {
    hunks = patch
      .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
      .map((h) => ({
        oldStart: Number(h.oldStart) || 0,
        newStart: Number(h.newStart) || 0,
        lines: Array.isArray(h.lines) ? h.lines.map(String) : [],
      }));
  } else if (name === "Write") {
    hunks = [{ oldStart: 0, newStart: 1, lines: str(input.content).split("\n").map((l) => "+" + l) }];
  } else if (name === "Edit") {
    hunks = hunksFromStrings(str(input.old_string), str(input.new_string));
  } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
    hunks = input.edits.flatMap((e) => (e && typeof e === "object" ? hunksFromStrings(str((e as Record<string, unknown>).old_string), str((e as Record<string, unknown>).new_string)) : []));
  }
  const created = name === "Write" && (result?.type === "create" || !Array.isArray(patch) || patch.length === 0);
  return { path, tool: name, created, hunks };
}

export function parseTranscript(text: string): Transcript {
  const t: Transcript = { sessionId: null, cwd: null, model: null, start: null, end: null, events: [], skipped: 0, malformed: 0 };
  const tools = new Map<string, Extract<TimelineEvent, { type: "tool" }>>();
  const seenHook = new Set<string>();
  // The texts of the hook_success just read: Claude Code records a hook's context twice, as its stdout and
  // as the hook_additional_context right after it, and for SessionStart under different ids (the run's uuid,
  // then "SessionStart"), so the id alone does not pair them.
  let lastSuccess: { event: string; texts: Set<string> } | null = null;
  let seq = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      t.malformed++;
      continue;
    }
    if (!r || typeof r !== "object") {
      t.malformed++;
      continue;
    }
    const time = ts(r.timestamp);
    if (time !== null) {
      t.start = t.start === null ? time : Math.min(t.start, time);
      t.end = t.end === null ? time : Math.max(t.end, time);
    }
    if (!t.sessionId && typeof r.sessionId === "string") t.sessionId = r.sessionId;
    if (!t.cwd && typeof r.cwd === "string") t.cwd = r.cwd;
    const sidechain = r.isSidechain === true;
    const base = () => ({ seq: seq++, time, sidechain });
    const msg = r.message as Record<string, unknown> | undefined;

    // Claude Code writes some text as a user turn the person never typed (`isMeta`): Stop's block as
    // "Stop hook feedback:\n<reason>" (also recorded as the hook's blocking error), notifications, caveats.
    if (r.type === "user" && r.isMeta === true && !(Array.isArray(msg?.content) && msg.content.some((b) => (b as { type?: unknown } | null)?.type === "tool_result"))) {
      t.skipped++;
      continue;
    }
    if (r.type === "user" && msg) {
      const c = msg.content;
      if (typeof c === "string") {
        t.events.push({ ...base(), type: "prompt", text: cap(c) });
        continue;
      }
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || typeof b !== "object") continue;
          const blk = b as Record<string, unknown>;
          if (blk.type === "tool_result") {
            const call = tools.get(str(blk.tool_use_id));
            if (call) {
              call.result = { text: cap(resultText(blk.content)), isError: blk.is_error === true };
              const tur = r.toolUseResult;
              const edit = editFrom(call.name, call.input, tur && typeof tur === "object" ? (tur as Record<string, unknown>) : null, t.cwd);
              // A failed or denied call changed nothing.
              call.edit = call.result.isError ? null : (edit ?? call.edit);
            }
          } else if (blk.type === "text" && str(blk.text)) {
            t.events.push({ ...base(), type: "prompt", text: cap(str(blk.text)) });
          }
        }
        continue;
      }
    }

    if (r.type === "assistant" && msg && Array.isArray(msg.content)) {
      if (typeof msg.model === "string" && !t.model && msg.model !== "<synthetic>") t.model = msg.model;
      for (const b of msg.content) {
        if (!b || typeof b !== "object") continue;
        const blk = b as Record<string, unknown>;
        if (blk.type === "text" && str(blk.text).trim()) t.events.push({ ...base(), type: "text", text: cap(str(blk.text)), model: str(msg.model) });
        else if (blk.type === "thinking" || blk.type === "redacted_thinking") {
          const th = str(blk.thinking);
          t.events.push({ ...base(), type: "thinking", text: cap(th), redacted: !th.trim() });
        } else if (blk.type === "tool_use") {
          const input = blk.input && typeof blk.input === "object" ? (blk.input as Record<string, unknown>) : {};
          const ev = {
            ...base(),
            type: "tool" as const,
            id: str(blk.id),
            name: str(blk.name),
            input,
            summary: toolSummary(str(blk.name), input, t.cwd),
            result: null,
            edit: null as FileEdit | null,
          };
          // A Write's or Edit's diff is known from its input until the result refines it.
          ev.edit = editFrom(ev.name, input, null, t.cwd);
          tools.set(ev.id, ev);
          t.events.push(ev);
        }
      }
      continue;
    }

    const after: { event: string; texts: Set<string> } | null = lastSuccess;
    lastSuccess = null;
    if (r.type === "attachment" && r.attachment && typeof r.attachment === "object") {
      const a = r.attachment as Record<string, unknown>;
      const event = str(a.hookEvent);
      const hookName = str(a.hookName) || event;
      const toolUseId = str(a.toolUseID) || null;
      let texts: { text: string; deny?: boolean }[] = [];
      if (a.type === "hook_success") {
        const out = str(a.stdout).trim();
        if (!out) continue;
        try {
          const j = JSON.parse(out) as Record<string, unknown>;
          const h = (j.hookSpecificOutput ?? {}) as Record<string, unknown>;
          if (str(h.additionalContext)) texts.push({ text: str(h.additionalContext) });
          if (h.permissionDecision === "deny") texts.push({ text: str(h.permissionDecisionReason), deny: true });
          if (str(j.systemMessage)) texts.push({ text: str(j.systemMessage) });
          if (j.decision === "block" && str(j.reason)) texts.push({ text: str(j.reason) });
        } catch {
          texts.push({ text: out });
        }
      } else if (a.type === "hook_additional_context" && Array.isArray(a.content)) {
        texts = a.content.map((c) => ({ text: String(c) }));
      } else if (a.type === "hook_blocking_error") {
        const be = a.blockingError as Record<string, unknown> | string | undefined;
        texts = [{ text: typeof be === "string" ? be : str(be?.blockingError) }];
      } else {
        t.skipped++;
        continue;
      }
      texts = texts.flatMap((x) => splitDriftMessages(x.text).map((text) => ({ ...x, text })));
      if (a.type === "hook_success") lastSuccess = { event, texts: new Set(texts.map((x) => x.text)) };
      else if (a.type === "hook_additional_context" && after?.event === event) {
        texts = texts.filter((x) => !after.texts.has(x.text));
        lastSuccess = after;
      }
      for (const x of texts) {
        if (!x.text.trim()) continue;
        const key = `${event}|${toolUseId}|${x.text}`;
        if (seenHook.has(key)) continue;
        seenHook.add(key);
        t.events.push({ ...base(), type: "hook", event, hookName, toolUseId, text: cap(x.text), drift: classifyDrift(x.text, { deny: x.deny }) });
      }
      continue;
    }

    if (r.type === "system" && r.subtype === "stop_hook_summary" && Array.isArray(r.hookErrors)) {
      for (const text of r.hookErrors.flatMap((e) => splitDriftMessages(String(e)))) {
        // The same Stop message is recorded as a blocking error and in the summary.
        const key = `Stop|${str(r.toolUseID) || null}|${text}`;
        // The blocking error's parts are the last events (a message and the exemption line it may carry).
        const recent = t.events.slice(-2);
        if (seenHook.has(key) || recent.some((x) => x.type === "hook" && x.event === "Stop" && x.text === text)) continue;
        seenHook.add(key);
        t.events.push({ ...base(), type: "hook", event: "Stop", hookName: "Stop", toolUseId: str(r.toolUseID) || null, text: cap(text), drift: classifyDrift(text) });
      }
      continue;
    }
    t.skipped++;
  }
  // A PreToolUse hook ran before its tool call: show it there.
  const order = t.events.slice();
  for (const e of t.events) {
    if (e.type !== "hook" || e.event !== "PreToolUse" || !e.toolUseId) continue;
    const ti = order.findIndex((x) => x.type === "tool" && x.id === e.toolUseId);
    const hi = order.indexOf(e);
    if (ti >= 0 && ti < hi) {
      order.splice(hi, 1);
      order.splice(ti, 0, e);
    }
  }
  t.events = order;
  return t;
}

export interface TimelineFilter {
  driftOnly: boolean;
  editsOnly: boolean;
  showThinking: boolean;
  showSidechain: boolean;
  query: string;
}

export function filterEvents(events: TimelineEvent[], f: TimelineFilter): TimelineEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (!f.showSidechain && e.sidechain) return false;
    // With both filters on, show the union: edits and where Drift spoke.
    if (f.driftOnly || f.editsOnly) {
      const isDrift = e.type === "hook" && !!e.drift;
      const isEdit = e.type === "tool" && !!e.edit;
      if (!((f.driftOnly && isDrift) || (f.editsOnly && isEdit))) return false;
    }
    if (!f.showThinking && e.type === "thinking") return false;
    if (q) {
      const hay =
        e.type === "tool" ? `${e.name} ${e.summary} ${e.result?.text ?? ""}` : e.type === "hook" ? `${e.event} ${e.text}` : e.text;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export interface SessionStats {
  prompts: number;
  toolCalls: number;
  edits: number;
  filesEdited: string[];
  drift: Record<DriftKind, number>;
  /** Drift messages by the hook event they came from, then kind (an unchecked note comes from SessionStart or Stop, an exemption line from PostToolUse or Stop). */
  byHook: Record<string, Partial<Record<DriftKind, number>>>;
  /** Denials of a shell command that writes under .drift/ (a subset of `drift.denied`). */
  shellDenied: number;
  /** Files Drift's messages named as not checked (#32), and files with possible violations, not certain, because they depend on one. */
  uncheckedFiles: string[];
  unsureFiles: string[];
  /** Exempt members the exemption lines count (#45); each is reported once per session. */
  exemptMembers: number;
  durationMs: number | null;
}

/**
 * The convention ids in a session state's `primed`: Drift also records there what else it
 * said once per session (`hint:<file>` for a search hint, and `<kind>:<key>` entries),
 * which are not rules.
 */
export function primedRules(s: Pick<SessionState, "primed"> | null | undefined): string[] {
  return (s?.primed ?? []).filter((id) => !id.includes(":"));
}

export function sessionStats(t: Transcript): SessionStats {
  const drift: Record<DriftKind, number> = { session: 0, primed: 0, practices: 0, facts: 0, advised: 0, unsure: 0, blocked: 0, unsure_start: 0, unsure_again: 0, denied: 0, stepped_aside: 0, recovered: 0, unchecked: 0, exempt: 0, unwired: 0, lookup: 0, brief: 0, error: 0 };
  const byHook: Record<string, Partial<Record<DriftKind, number>>> = {};
  const files = new Set<string>();
  const unchecked = new Set<string>();
  const unsure = new Set<string>();
  // PostToolUse tells the agent and the person that a file was not checked: one message, two texts.
  const told = new Set<string>();
  let prompts = 0;
  let toolCalls = 0;
  let edits = 0;
  let shellDenied = 0;
  let exemptMembers = 0;
  for (const e of t.events) {
    if (e.type === "prompt") prompts++;
    if (e.type === "tool") {
      toolCalls++;
      if (e.edit) {
        edits++;
        files.add(e.edit.path);
      }
    }
    if (e.type === "hook" && e.drift) {
      const d = e.drift;
      if (d.kind === "unchecked") d.files?.forEach((f) => unchecked.add(f));
      if (d.kind === "unsure") d.files?.forEach((f) => unsure.add(f));
      if (d.kind === "unchecked" && e.event === "PostToolUse") {
        const k = `${e.toolUseId}|${(d.files ?? []).join("\n")}`;
        if (told.has(k)) continue;
        told.add(k);
      }
      drift[d.kind]++;
      if (d.kind === "exempt") exemptMembers += d.members ?? 0;
      const h = (byHook[e.event] ??= {});
      h[d.kind] = (h[d.kind] ?? 0) + 1;
      if (d.shell) shellDenied++;
    }
  }
  return {
    prompts,
    toolCalls,
    edits,
    filesEdited: [...files].sort(),
    drift,
    byHook,
    shellDenied,
    uncheckedFiles: [...unchecked].sort(),
    unsureFiles: [...unsure].sort(),
    exemptMembers,
    durationMs: t.start !== null && t.end !== null ? t.end - t.start : null,
  };
}

export interface StateAlignment {
  /** Convention ids Drift recorded as primed, and whether the transcript shows the message. */
  primed: { id: string; seen: boolean }[];
  /** Advised violation keys (`id path#symbol`), and whether the transcript shows them. */
  advised: { key: string; id: string; seen: boolean }[];
  /** Exempt members Drift reported to the agent (`advised`) or the person (`told_person`), once each (`exempt id path#symbol`, #45), and whether an exemption line names them (it names at most three). */
  exempt: { key: string; id: string; path: string; symbol: string; seen: boolean }[];
  blocks: number;
  blocksSeen: number;
  /** Violations that existed when the session started. */
  baseline: number;
  /**
   * Violations reported as unsure when the baseline was recorded (`unsure_at_start`, #32), by key (`id path#symbol`).
   * A record only: never in the baseline, so one that becomes certain blocks like a new one. `blocked`: a block in the
   * transcript names it; `blockedOnce`: Drift's state says it has blocked once and is advice now (`unsure_blocked`), while its
   * file hashes to `blockedHash` (BLAKE3 of the violation's file as it blocked; empty when not blocked once).
   */
  unsureAtStart: { key: string; id: string; path: string; symbol: string; blocked: boolean; blockedOnce: boolean; blockedHash: string }[];
  /** Exempt members that existed when the session started (#45). */
  baselineExempt: number;
}

/** A session-state key for an exempt member (`exempt <id> <path>#<symbol>`, #45) rather than a violation. */
export const isExemptKey = (k: string) => k.startsWith("exempt ");

/** Violations a session's state says the agent was told about (exempt members excluded). */
export function advisedViolations(s: Pick<SessionState, "advised"> | null | undefined): string[] {
  return (s?.advised ?? []).filter((k) => !isExemptKey(k));
}

/** A violation key as Drift's session state writes it (`id path#symbol`): the path may hold spaces, the symbol follows the last `#`. */
export function violationKey(key: string): { id: string; path: string; symbol: string } {
  const sp = key.indexOf(" ");
  const id = sp < 0 ? key : key.slice(0, sp);
  const member = sp < 0 ? "" : key.slice(sp + 1);
  const hash = member.lastIndexOf("#");
  return { id, path: hash < 0 ? member : member.slice(0, hash), symbol: hash < 0 ? "" : member.slice(hash + 1) };
}

/** Cross-check Drift's session state file with the hook messages in the transcript. */
export function alignState(t: Transcript, s: SessionState): StateAlignment {
  const primedSeen = new Set<string>();
  const advisedSeen = new Set<string>();
  const exemptSeen = new Set<string>();
  let blocksSeen = 0;
  const blockedSeen = new Set<string>();
  const keys = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === "string") : []);
  // Keys of `unsure_at_start` that blocked once (`unsure_blocked`: key -> hash of the violation's file then): advice while that file is unchanged.
  const once = new Map<string, string>(
    s.unsure_blocked && typeof s.unsure_blocked === "object" && !Array.isArray(s.unsure_blocked)
      ? Object.entries(s.unsure_blocked).map(([k, h]): [string, string] => [k, typeof h === "string" ? h : ""])
      : [],
  );
  for (const e of t.events) {
    if (e.type !== "hook" || !e.drift) continue;
    if (e.drift.kind === "primed") e.drift.ids.forEach((id) => primedSeen.add(id));
    // Unsure violations (#32) are recorded as advised too: told once, with the file they depend on.
    if (e.drift.kind === "advised" || e.drift.kind === "unsure") e.drift.findings.forEach((f) => advisedSeen.add(`${f.id} ${f.path}`));
    if (e.drift.kind === "blocked") {
      blocksSeen++;
      e.drift.findings.forEach((f) => blockedSeen.add(`${f.id} ${f.path}`));
    }
    if (e.drift.kind === "exempt") e.drift.findings.forEach((f) => exemptSeen.add(`${f.id} ${f.symbol}`));
  }
  const advised = s.advised ?? [];
  const baseline = s.baseline ?? [];
  // PostToolUse records what it told the agent in `advised`; Stop records what it told the person in `told_person`.
  const exemptKeys = [...new Set([...advised, ...(s.told_person ?? [])].filter(isExemptKey))];
  return {
    primed: primedRules(s).map((id) => ({ id, seen: primedSeen.has(id) })),
    advised: advised
      .filter((k) => !isExemptKey(k))
      .map((key) => {
        const [id, rest = ""] = key.split(" ");
        const path = rest.split("#")[0];
        return { key, id, seen: advisedSeen.has(`${id} ${path}`) };
      }),
    exempt: exemptKeys.map((key) => {
      // `exempt <id> <path>#<symbol>`: the path may hold spaces, the symbol follows the last `#`.
      const rest = key.slice("exempt ".length);
      const sp = rest.indexOf(" ");
      const id = sp < 0 ? rest : rest.slice(0, sp);
      const member = sp < 0 ? "" : rest.slice(sp + 1);
      const hash = member.lastIndexOf("#");
      const path = hash < 0 ? member : member.slice(0, hash);
      const symbol = hash < 0 ? "" : member.slice(hash + 1);
      return { key, id, path, symbol, seen: exemptSeen.has(`${id} ${symbol}`) };
    }),
    blocks: s.blocks ?? 0,
    blocksSeen,
    baseline: baseline.filter((k) => !isExemptKey(k)).length,
    baselineExempt: baseline.filter(isExemptKey).length,
    unsureAtStart: [...new Set([...keys(s.unsure_at_start), ...once.keys()])]
      .map((key) => {
        const v = violationKey(key);
        return { key, ...v, blocked: blockedSeen.has(`${v.id} ${v.path}`), blockedOnce: once.has(key), blockedHash: once.get(key) ?? "" };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Claude Code's project directory name for a working directory. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, "-");
}
