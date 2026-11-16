// Validation and command construction for the IPC surface. Pure functions, no
// Electron imports, so every rule here is unit-tested (tests/unit/electron.test.ts).
//
// The renderer never names a program, a flag or a file. It names an operation
// from IPC_CHANNELS; the arguments it may pass are checked here, and the
// `drift` argv is built here from fixed pieces.
import { isAbsolute, normalize, posix, relative, sep } from "node:path";
import { type Verdict, markFlags, upgradeFlags } from "./screens-ops";

export class InvalidArgument extends Error {}

export type DriftOp =
  | { op: "scan"; out: string }
  | { op: "census" }
  | { op: "check"; base?: string | null }
  | { op: "security"; base?: string | null }
  | { op: "review"; decision: ReviewDecision; ids: string[] }
  /** A reviewer's exception: added with a reason, removed with `reason: null`. */
  | { op: "exempt"; id: string; member: string; reason: string | null }
  /** The opt-in review log: on or off (`--set-log`), its study export to a path the person chose, a card shown. */
  | { op: "setLog"; on: boolean }
  | { op: "exportLog"; out: string; includePaths: boolean }
  | { op: "shown"; ids: string[] }
  /** A block candidate's one question: read (`--json`), answered (`--answer`). */
  | { op: "questions" }
  | { op: "answer"; id: string; answer: Answer; setApart: string[]; confirmEntry: string[] }
  | { op: "init" }
  /** The practice map (`drift practices --json`): read-only. */
  | { op: "practices" }
  /** A practice made a convention: what it would record (`--dry-run`, writes nothing), and the write itself. */
  | { op: "promotePreview"; promote: PromoteArgs }
  | { op: "promote"; promote: PromoteArgs }
  /** The structural map (`drift map --json`): packages with production and test dependencies apart. */
  | { op: "map" }
  /** What mining dropped, gate by gate (`drift census --why --json`): observation only, read-only. */
  | { op: "funnel" }
  /** Every practice that may be promoted now (`drift practices promote --list --json`): writes nothing. */
  | { op: "promoteList" }
  /** Proposals from Drift's map (`census --from-map --json`), and what qualified and is not proposed: read-only. */
  | { op: "fromMap" }
  /** What this Drift reads differently in the files an older one wrote (`upgrade --json`): changes nothing. */
  | { op: "upgrade" }
  /** `upgrade --apply --json`: only what changes no decision a person made; `--security-baseline` when asked. */
  | { op: "upgradeApply"; securityBaseline: boolean }
  /** A person's verdict on one violation (`feedback mark`), kept in .drift/feedback on this machine; nothing is sent. */
  | { op: "feedbackMark"; id: string; member: string; verdict: Verdict; why: string | null }
  | { op: "version" }
  | { op: "censusHelp" };

const ID = /^D-[0-9a-f]{6}$/;

export type ReviewDecision = "accept" | "reject" | "block" | "force_block" | "advise";
const DECISIONS: ReviewDecision[] = ["accept", "reject", "block", "force_block", "advise"];

/** `drift review` flags for a decision: `--accept`, ..., `--block --force` (always after the ids). */
export function reviewFlags(d: ReviewDecision, ids: string[]): string[] {
  const list = assertConventionIds(ids).join(",");
  return d === "force_block" ? ["--block", list, "--force"] : [`--${d}`, list];
}

export function assertConventionIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new InvalidArgument("expected 1-200 convention ids");
  for (const id of ids) if (typeof id !== "string" || !ID.test(id)) throw new InvalidArgument(`not a convention id: ${String(id).slice(0, 20)}`);
  return [...new Set(ids as string[])];
}

export function assertDecision(d: unknown): ReviewDecision {
  if (typeof d === "string" && (DECISIONS as string[]).includes(d)) return d as ReviewDecision;
  throw new InvalidArgument("decision must be accept, reject, block, force_block or advise");
}

/**
 * A member as conventions.yaml `exceptions` name it (`path#symbol`): a repo-relative path without `.`/`..`
 * segments, a non-empty symbol, no control characters, at most 1024 characters.
 */
export function assertMember(m: unknown): string {
  if (typeof m !== "string" || m.length > 1024 || /\p{Cc}/u.test(m)) throw new InvalidArgument("expected a member as path#symbol");
  const i = m.indexOf("#");
  const path = m.slice(0, i);
  if (i <= 0 || i === m.length - 1 || path.startsWith("/") || path.includes("\\") || path.split("/").some((p) => p === ".." || p === "." || p === ""))
    throw new InvalidArgument("expected a member as path#symbol");
  return m;
}

/** A reviewer's reason, as Drift stores it: whitespace collapsed, 1 to 120 characters, no control characters. */
/** A control character other than whitespace (tab, newline, ...), which Drift refuses in a reason. */
function hasControl(s: string): boolean {
  return [...s].some((c) => {
    const n = c.codePointAt(0)!;
    return (n < 0x20 && (n < 9 || n > 13)) || (n >= 0x7f && n <= 0x9f);
  });
}

export function assertReason(r: unknown): string {
  if (typeof r !== "string" || r.length > 1000 || hasControl(r)) throw new InvalidArgument("expected a one-line reason");
  const t = r.trim().split(/\s+/).join(" ");
  if (!t || [...t].length > 120) throw new InvalidArgument("the reason must be 1 to 120 characters");
  return t;
}

/**
 * `drift review` flags for an exception. Every value is attached with `=`, so a reason that reads like a flag
 * (`--accept D-…`) stays a value.
 */
export function exemptFlags(id: string, member: string, reason: string | null): string[] {
  const [cid] = assertConventionIds([id]);
  const m = assertMember(member);
  return reason === null ? [`--unexempt=${cid}`, `--member=${m}`] : [`--exempt=${cid}`, `--member=${m}`, `--reason=${assertReason(reason)}`];
}

export type Answer = "same" | "different" | "not-a-convention";
const ANSWERS: Answer[] = ["same", "different", "not-a-convention"];

export function assertAnswer(a: unknown): Answer {
  if (typeof a === "string" && (ANSWERS as string[]).includes(a)) return a as Answer;
  throw new InvalidArgument("answer must be same, different or not-a-convention");
}

/** A file to set apart: repo-relative, no `.`/`..` segments, no `#`, no control characters, at most 1024 characters. */
export function assertSetApartPath(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 1024 || /\p{Cc}/u.test(p) || p.includes("#") || p.startsWith("/") || p.includes("\\") || p.split("/").some((s) => s === ".." || s === "." || s === ""))
    throw new InvalidArgument("expected a repo-relative file path");
  return p;
}

/**
 * `drift review` flags for a block candidate's answer: `--answer=<id>=<answer>`, with `different` the files set apart
 * (at least one) and the entry points the person confirmed one by one (each in a file set apart). Values attach with `=`.
 */
export function answerFlags(id: string, answer: unknown, setApart: unknown, confirmEntry: unknown): string[] {
  const [cid] = assertConventionIds([id]);
  const a = assertAnswer(answer);
  if (!Array.isArray(setApart) || !Array.isArray(confirmEntry) || setApart.length > 500 || confirmEntry.length > 500) throw new InvalidArgument("expected lists of files and members");
  const files = [...new Set(setApart.map(assertSetApartPath))];
  const confirm = [...new Set(confirmEntry.map(assertMember))];
  if (a !== "different") {
    if (files.length || confirm.length) throw new InvalidArgument("only a `different` answer sets files apart");
    return [`--answer=${cid}=${a}`];
  }
  if (!files.length) throw new InvalidArgument("a `different` answer needs at least one file");
  for (const m of confirm) if (!files.includes(m.slice(0, m.indexOf("#")))) throw new InvalidArgument("a confirmed entry point must be in a file set apart");
  return [`--answer=${cid}=${a}`, `--set-apart=${files.join(",")}`, ...(confirm.length ? [`--confirm-entry=${confirm.join(",")}`] : [])];
}

/** What a person asks to promote (the `promotePreview` and `promote` channels' request). */
export interface PromoteArgs {
  /** The variant (`P-…`). */
  id: string;
  /** `.` or a directory from the repository root (`promotable.place`). */
  place: string;
  /** Other variants of the same concern accepted with it (`--with`). */
  with: string[];
  block: boolean;
}

const PRACTICE_ID = /^P-[0-9a-f]{6}$/;

export function assertPracticeId(id: unknown): string {
  if (typeof id !== "string" || !PRACTICE_ID.test(id)) throw new InvalidArgument(`not a practice variant id: ${String(id).slice(0, 20)}`);
  return id;
}

/**
 * A place for `--in`: `.` (the root package) or a directory from the repository root. No `..`, `.` or empty segment,
 * not absolute, never starting with `-` (it is its own argument, so it must not read as a flag), no backslash or
 * control character, at most 1024 characters.
 */
export function assertPlace(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 1024 || /\p{Cc}/u.test(p)) throw new InvalidArgument("expected a place: `.` or a repo-relative directory");
  if (p === ".") return p;
  if (p.startsWith("/") || p.startsWith("-") || p.includes("\\") || /^[A-Za-z]:/.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === ""))
    throw new InvalidArgument("expected a place: `.` or a repo-relative directory");
  return p;
}

/**
 * `drift practices promote` arguments after the subcommand: the variant, `--in <place>`, `--with <id>` for each other
 * way (in the person's order, once each, never the variant itself), `--block` when asked, `--dry-run` for a preview,
 * and `--json` always. A preview is always `--dry-run`: only the `promote` op writes.
 */
export function promoteFlags(a: PromoteArgs, dryRun: boolean): string[] {
  if (!a || typeof a !== "object" || !Array.isArray(a.with) || a.with.length > 50) throw new InvalidArgument("expected a promotion request");
  const id = assertPracticeId(a.id);
  const place = assertPlace(a.place);
  const others = [...new Set(a.with.map(assertPracticeId))].filter((w) => w !== id);
  return [id, "--in", place, ...others.flatMap((w) => ["--with", w]), ...(assertBool(a.block, "block") ? ["--block"] : []), ...(dryRun ? ["--dry-run"] : []), "--json"];
}

/**
 * Whether an op writes to the repository. The only writes are `drift review` (decisions, exceptions, answers, the
 * review log setting), `drift init`, `drift practices promote` without `--dry-run`, `drift upgrade --apply` and
 * `drift feedback mark` (a local, git-ignored file); every other op reads.
 */
export function writesRepository(op: DriftOp["op"]): boolean {
  return op === "review" || op === "exempt" || op === "setLog" || op === "answer" || op === "init" || op === "promote" || op === "upgradeApply" || op === "feedbackMark";
}

/** argv for `drift`, never through a shell. `root` is an absolute repo path the person chose. */
export function driftArgs(root: string, op: DriftOp): string[] {
  switch (op.op) {
    case "version":
      return ["--version"];
    case "censusHelp":
      return ["census", "--help"];
    case "scan":
      return ["--root", root, "scan", "--out", op.out];
    case "census":
      return ["--root", root, "census", "--json"];
    case "check":
      return ["--root", root, "check", "--format", "json", ...(op.base ? ["--diff-base", assertGitRef(op.base)] : [])];
    case "security":
      return ["--root", root, "security", "--json", ...(op.base ? ["--diff-base", assertGitRef(op.base)] : [])];
    case "init":
      return ["--root", root, "init"];
    case "practices":
      return ["--root", root, "practices", "--json"];
    case "map":
      return ["--root", root, "map", "--json"];
    case "funnel":
      return ["--root", root, "census", "--why", "--json"];
    case "promoteList":
      return ["--root", root, "practices", "promote", "--list", "--json"];
    case "promotePreview":
      return ["--root", root, "practices", "promote", ...promoteFlags(op.promote, true)];
    case "promote":
      return ["--root", root, "practices", "promote", ...promoteFlags(op.promote, false)];
    case "review":
      return ["--root", root, "review", ...reviewFlags(assertDecision(op.decision), op.ids)];
    case "exempt":
      return ["--root", root, "review", ...exemptFlags(op.id, op.member, op.reason)];
    case "setLog":
      return ["--root", root, "review", `--set-log=${assertBool(op.on, "on") ? "on" : "off"}`];
    case "exportLog":
      return ["--root", root, "review", `--export-log=${assertSavePath(op.out)}`, ...(assertBool(op.includePaths, "includePaths") ? ["--include-paths"] : [])];
    case "shown":
      return ["--root", root, "review", `--shown=${assertConventionIds(op.ids).join(",")}`];
    case "questions":
      return ["--root", root, "review", "--json"];
    case "answer":
      return ["--root", root, "review", ...answerFlags(op.id, op.answer, op.setApart, op.confirmEntry)];
    case "fromMap":
      return ["--root", root, "census", "--from-map", "--json"];
    case "upgrade":
      return ["--root", root, "upgrade", ...upgradeFlags(false, false)];
    case "upgradeApply":
      return ["--root", root, "upgrade", ...upgradeFlags(true, op.securityBaseline)];
    case "feedbackMark":
      return ["--root", root, "feedback", "mark", ...markFlags(op.id, op.member, op.verdict, op.why)];
  }
}

/**
 * Exit codes that still carry a valid JSON report: `drift check` exits 1 when something blocks; `drift practices
 * promote` exits 2 when it refuses, with the refusal as JSON on stdout (or, for bad arguments, nothing there);
 * `drift upgrade` exits 3 when something is left and 2 when it refuses, and with `--apply` 1 when a write failed.
 */
export function acceptableExit(op: DriftOp["op"], code: number): boolean {
  return (
    code === 0 ||
    (op === "check" && code === 1) ||
    ((op === "promote" || op === "promotePreview") && code === 2) ||
    // `drift upgrade`: 3 when something is left to do, 2 when it refused (both with the report on stdout); with
    // `--apply`, 1 when a write failed (the report says what was written before it).
    (op === "upgrade" && (code === 2 || code === 3)) ||
    (op === "upgradeApply" && (code === 1 || code === 2 || code === 3))
  );
}

/**
 * A git ref for `drift check --diff-base` and `drift security --diff-base` (`origin/main`, `v1.2.0`, a commit id): what
 * `git check-ref-format` accepts for a branch, minus anything that could read as a flag
 * or a revision expression (`-x`, `a..b`, `@{1}`, `^`, `~`, `:`).
 */
export function assertGitRef(r: unknown): string {
  if (typeof r !== "string" || r.length === 0 || r.length > 200) throw new InvalidArgument("expected a git ref");
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/+-]*$/.test(r) || r.includes("..") || r.includes("//") || r.endsWith("/") || r.endsWith(".") || r.endsWith(".lock") || r.split("/").some((p) => p.startsWith(".")))
    throw new InvalidArgument(`not a git ref: ${r.slice(0, 40)}`);
  return r;
}

/**
 * A repo-relative POSIX path from the renderer: no absolute paths, no `..`,
 * no NUL, no backslashes, at most 1024 characters. Returns the normalised form.
 */
export function assertRelPath(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 1024) throw new InvalidArgument("expected a repo-relative path");
  if (p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new InvalidArgument("expected a repo-relative path");
  const n = posix.normalize(p);
  if (n === ".." || n.startsWith("../") || n.split("/").includes("..") || n === ".") throw new InvalidArgument("path leaves the repository");
  return n;
}

/** True when `child` (absolute, real) is inside `root` (absolute, real). */
export function isInside(root: string, child: string): boolean {
  const r = relative(normalize(root), normalize(child));
  return r !== "" && !r.startsWith("..") && !isAbsolute(r) && !r.split(sep).includes("..");
}

/** Session ids are file stems: Claude Code uses UUIDs; Drift keeps [A-Za-z0-9_-]{1,64}. */
export function assertSessionId(id: unknown): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new InvalidArgument("invalid session id");
  return id;
}

/** Claude Code's `~/.claude/projects/<name>` for a working directory. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, "-");
}

/** The environment variable that turns the neighbour gate on or off (round 11, WS-J; drift-mine check.rs `NEIGHBOUR_GATE_ENV`). */
export const NEIGHBOUR_GATE_ENV = "DRIFT_NEIGHBOUR_GATE";

/**
 * Whether the neighbour gate is on in `base`, as Drift reads it (check.rs `neighbour_gate_on`): `on` or `off` after
 * trimming; anything else, or unset, is the default, off (not admitted until dev4 measures it).
 */
export function neighbourGate(base: NodeJS.ProcessEnv): "on" | "off" {
  return base[NEIGHBOUR_GATE_ENV]?.trim() === "on" ? "on" : "off";
}

/**
 * Environment for drift: the inherited one minus anything that changes its behaviour, plus our cache. The one
 * behaviour a person sets for every Drift they run is kept: the neighbour gate, so the Studio's `drift check` holds
 * back what the hooks and the CLI hold back in this environment (passed as `on` only; off is the default).
 */
export function driftEnv(base: NodeJS.ProcessEnv, cacheDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]) if (base[k] !== undefined) env[k] = base[k];
  env.DRIFT_CACHE_DIR = cacheDir;
  // The review log (when a person turned it on) records decisions made here as the Studio's.
  env.DRIFT_REVIEW_VIA = "studio";
  if (neighbourGate(base) === "on") env[NEIGHBOUR_GATE_ENV] = "on";
  return env;
}

/**
 * What a failed drift run says, in one line: the error Drift printed last (`drift: <error>`, crates/drift-cli main.rs),
 * without its prefix. Drift prints an error with its context on several lines (a YAML error quotes the lines around
 * it), so the line that starts the error is the one to show, not stderr's last line. Null when stderr has none.
 */
export function driftErrorLine(stderr: string): string | null {
  const lines = stderr.split("\n").map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith("drift: ")) return lines[i].slice("drift: ".length).trim() || null;
  return lines.filter((l) => l.trim()).pop()?.trim() || null;
}

/** A file path from the save dialog: absolute, no NUL or control characters, at most 4096 characters. */
export function assertSavePath(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 4096 || !isAbsolute(p) || /\p{Cc}/u.test(p)) throw new InvalidArgument("expected an absolute file path");
  return p;
}

export function assertBool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw new InvalidArgument(`${name} must be a boolean`);
  return v;
}
