// The typed, versioned IPC contract between the renderer, the preload bridge
// and the Electron main process. One table: channel -> request schema ->
// response schema. The main process validates every request against it before
// doing anything; the renderer validates every response before using it.
//
// Requests are small and validated strictly. Responses that carry Drift's JSON
// (facts, census, check, security) are validated at the envelope and top level
// here, and field by field where the views read them (entities/*), so a
// 36k-file scan is not walked twice.
import { z } from "zod";

import { CHANNEL_NAMES, IPC_VERSION } from "./names";

export { IPC_VERSION };

const convId = z.string().regex(/^D-[0-9a-f]{6}$/);
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const relPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && !p.split("/").includes(".."), "repo-relative path");

/** A git ref for `drift check --diff-base` and `drift security --diff-base` (validated again, strictly, in the main process). */
export const GitRef = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._/+-]*$/)
  .refine((r) => !r.includes("..") && !r.endsWith(".lock"), "git ref");
export const CheckOpts = z.object({ base: GitRef.nullable() });

export const RepoRef = z.object({ path: z.string().min(1).max(4096), name: z.string().max(256) });
export type RepoRef = z.infer<typeof RepoRef>;

export const DriftInfo = z.object({
  path: z.string().nullable(),
  version: z.string().nullable(),
  censusJson: z.boolean(),
  source: z.enum(["settings", "path", "fixture", "none"]),
  error: z.string().optional(),
});
export type DriftInfo = z.infer<typeof DriftInfo>;

export const Provenance = z.object({
  /** Short commit of HEAD when the data was produced (read from .git, never by running git). */
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  driftVersion: z.string().nullable(),
  /**
   * A check's only: whether the neighbour gate (round 11, WS-J) was on for the run (`DRIFT_NEIGHBOUR_GATE=on` in the
   * environment the Studio was started from; off, the default, otherwise). Absent for other payloads.
   */
  neighbourGate: z.enum(["on", "off"]).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

/** A Drift JSON payload plus when and from what it was produced. */
const loaded = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, at: z.number(), cached: z.boolean(), ms: z.number().optional(), provenance: Provenance });

// Top-level shapes of Drift's JSON; deeper fields are checked where read.
export const FactsEnvelope = z.object({ schema_version: z.number(), files: z.array(z.any()), skipped: z.array(z.any()) }).passthrough();
export const CensusEnvelope = z.object({ schema: z.number(), proposals: z.array(z.any()) }).passthrough();
export const CheckEnvelope = z.object({ violations: z.array(z.any()), fixed: z.array(z.string()) }).passthrough();
export const SecurityEnvelope = z.object({ entry_points: z.array(z.any()), sinks: z.array(z.any()), client_leaks: z.array(z.any()), env: z.record(z.string(), z.any()) }).passthrough();
/** `drift security --diff-base REF --json` (#167): what the change introduces, a payload of its own. */
export const SecurityDiffEnvelope = z
  .object({
    guard_gaps: z.array(z.any()),
    unguarded_reaching: z.array(z.any()),
    sinks: z.array(z.any()),
    leaks: z.array(z.any()),
    now_public: z.array(z.any()),
    diff: z.object({ base: z.string(), merge_base: z.string(), files: z.number() }).passthrough(),
  })
  .passthrough();

/** `drift practices --json` version 1 (PLAN-R13 §0.3); concerns are checked where read (features/practices). */
export const PracticesEnvelope = z
  .object({
    version: z.number(),
    summary: z.object({ population: z.number(), known: z.number(), none: z.number(), unknown: z.number(), coverage: z.number(), target: z.number() }).passthrough(),
    concerns: z.array(z.any()),
  })
  .passthrough();

/** `drift map --json` (map.rs `overview`, schema 1); packages are checked where read (features/map). */
export const MapEnvelope = z.object({ schema: z.number(), packages: z.array(z.any()) }).passthrough();

/** `drift census --why --json` (funnel.rs `why_json`, schema 1): gates and dropped candidates are checked where read (features/funnel). */
export const FunnelEnvelope = z
  .object({ schema: z.number(), observation_only: z.boolean(), gate: z.string().nullable(), reached: z.record(z.string(), z.number()), gates: z.array(z.any()), dropped: z.array(z.any()) })
  .passthrough();

export const PolicyFiles = z.object({ conventions: z.string().nullable(), lock: z.string().nullable() });
export type PolicyFiles = z.infer<typeof PolicyFiles>;

export const SessionSummary = z.object({
  id: sessionId,
  project: z.string(),
  title: z.string().nullable(),
  modified: z.number(),
  bytes: z.number(),
  hasState: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionState = z
  .object({
    baseline: z.array(z.string()).default([]),
    advised: z.array(z.string()).default([]),
    told_person: z.array(z.string()).default([]),
    primed: z.array(z.string()).default([]),
    blocks: z.number().default(0),
    last_block: z.array(z.string()).default([]),
  })
  .passthrough();

export const StudiesData = z.object({
  source: z.string(),
  labels: z.string(),
  secondOpinion: z.string().nullable(),
  census: z.record(z.string(), CensusEnvelope),
  ab: z.array(z.object({ name: z.string(), rows: z.array(z.object({ task: z.string(), arm: z.string() }).passthrough()) })),
  /** Every `metrics.json` (metrics.mjs --json) under `eval/study/runs/<run>`: the run, its views, its parts and their views; `variant` for a `metrics-<variant>.json` beside one. */
  // Checked run by run in entities/study (readRuns): one unreadable file is shown as such, never fails the view.
  runs: z.array(z.object({ path: z.string(), metrics: z.unknown().optional(), error: z.string().optional(), calibration: z.boolean().optional(), variant: z.string().optional() })).default([]),
  /** Labeller agreement files (`agreement.json`) anywhere under a run, by directory: A/B before adjudication. */
  agreements: z.array(z.object({ path: z.string(), agreement: z.unknown() })).default([]),
  /** What an adjudication excluded (`<…>/adjudication/queue.json` `excluded`: repos, uids, reason), by directory. */
  exclusions: z.array(z.object({ path: z.string(), excluded: z.unknown() })).default([]),
  /** Calibration runs: the label shift (`shift.json`) and labeller agreement per part (`<part>/agreement.json`). */
  calibrations: z.array(z.object({ path: z.string(), shift: z.unknown().optional(), agreements: z.array(z.object({ path: z.string(), agreement: z.unknown() })).default([]) })).default([]),
  /** Dev manifests (`eval/repos*.json`; held-out manifests are never read): which repo sets exist, labelled or not. */
  manifests: z.array(z.object({ path: z.string(), note: z.string(), repos: z.number(), language: z.string().nullable() })).default([]),
});

/** `drift review` flags: `force_block` is `--block --force` (a suggestion, confirmed by a person); `advise` is `--advise` (back from block). */
export const Decision = z.enum(["accept", "reject", "block", "force_block", "advise"]);
export type Decision = z.infer<typeof Decision>;

/** A block candidate's answer to its one question (`drift review --answer ID=<answer>`). */
export const Answer = z.enum(["same", "different", "not-a-convention"]);
export type Answer = z.infer<typeof Answer>;

/** What the audit trail records: a `drift review` decision, a reviewer's exception added (`exempt`) or removed (`unexempt`), a block candidate's answer, or a practice made a convention (`promote`). */
export const AuditDecision = z.enum([...Decision.options, "exempt", "unexempt", ...Answer.options, "promote"]);
export type AuditDecision = z.infer<typeof AuditDecision>;

/** A practice-map variant id (`drift practices --json` `concerns[].variants[].id`): `P-` and 6 hex digits. */
export const PracticeId = z.string().regex(/^P-[0-9a-f]{6}$/);

const repoPath = (p: string) => !p.startsWith("/") && !p.startsWith("-") && !p.includes("\\") && !/\p{Cc}/u.test(p) && !p.split("/").some((s) => s === ".." || s === "." || s === "");

/**
 * A place for `drift practices promote --in`: `.` (the root package), a directory or one file from the repository root,
 * or a route place `<package>:/<prefix>` (`.:/api/workspaces`, `apps/api:/v2`). No `..`, `.` or empty segment, no
 * leading `/` or `-` (it is passed as its own argument), no backslash or control character (validated again in the
 * main process).
 */
export const PromotePlacePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => {
    const at = p.indexOf(":/");
    if (at < 0) return p === "." || repoPath(p);
    const [pkg, prefix] = [p.slice(0, at), p.slice(at + 1)];
    return (pkg === "." || repoPath(pkg)) && prefix.length > 1 && !/\p{Cc}|\s|\\/u.test(prefix) && !prefix.slice(1).split("/").some((s) => s === "" || s === ".." || s === ".");
  }, "`.`, a repo-relative directory or file, or `<package>:/<route prefix>`");

/** A concern of the practice map (`concerns[].id`: `authn`, `data_access`, ...). */
export const ConcernId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
/** A mechanism in the map's own words (the part before the `:` of a variant key: `wrap`, `membership_guard`, ...). */
export const MechanismName = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);

/**
 * What a person asks to promote, every form `drift practices promote` has: the first way (`id`, a variant) or, with
 * none, the concern (`--concern`); the place (`--in`); more ways (`--with`), mechanisms accepted whole
 * (`--mechanism`) and any enforcing way (`--any-enforcing`), which add up; block mode (`--block`) and a promotion
 * below the share (`--force`, advise only). The optional fields are absent from an older Studio's request.
 */
export const PromoteRequest = z.object({
  id: PracticeId.optional(),
  concern: ConcernId.optional(),
  place: PromotePlacePath,
  with: z.array(PracticeId).max(50),
  mechanisms: z.array(MechanismName).max(20).optional(),
  any_enforcing: z.boolean().optional(),
  block: z.boolean(),
  force: z.boolean().optional(),
});
export type PromoteRequest = z.infer<typeof PromoteRequest>;

/** A member as conventions.yaml `exceptions` name it: `path#symbol` with a repo-relative path (validated again in the main process). */
export const MemberKey = z
  .string()
  .min(3)
  .max(1024)
  .refine((m) => {
    const i = m.indexOf("#");
    const path = m.slice(0, i);
    return i > 0 && i < m.length - 1 && !path.startsWith("/") && !path.includes("\\") && !/\p{Cc}/u.test(m) && !path.split("/").some((p) => p === ".." || p === "." || p === "");
  }, "path#symbol");

/** A control character other than whitespace (tab, newline, ...), which Drift refuses in a reason. */
function hasControl(s: string): boolean {
  return [...s].some((c) => {
    const n = c.codePointAt(0)!;
    return (n < 0x20 && (n < 9 || n > 13)) || (n >= 0x7f && n <= 0x9f);
  });
}

/** A reviewer's "fine because…" reason: one line, 1 to 120 characters (Drift refuses longer). */
export const ExceptionReason = z
  .string()
  .max(1000)
  .refine((r) => {
    const t = r.trim().split(/\s+/).join(" ");
    return t.length > 0 && [...t].length <= 120 && !hasControl(r);
  }, "a reason of 1 to 120 characters, one line");

/** A file a person sets apart (`--set-apart`): a repo-relative path (validated again in the main process). */
export const SetApartPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.includes("#") && !/\p{Cc}/u.test(p) && !p.split("/").some((s) => s === ".." || s === "." || s === ""), "a repo-relative file path");

/** `drift review --json`: checked loosely (the view reads the fields it knows). */
export const QuestionsEnvelope = z
  .object({
    schema: z.literal("drift-review-questions"),
    schema_version: z.number(),
    question: z.string(),
    candidates: z.array(
      z
        .object({
          id: convId,
          holders: z.array(z.object({ path: z.string(), symbol: z.string(), line: z.number() }).passthrough()),
          flagged: z.array(z.object({ path: z.string(), members: z.array(z.object({ symbol: z.string(), line: z.number(), needs_confirmation: z.boolean() }).passthrough()) }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const PromoteWayEnvelope = z.object({ id: z.string(), key: z.string(), label: z.string(), members: z.number() }).passthrough();
const PromoteExampleEnvelope = z.object({ path: z.string(), symbol: z.string(), line: z.number() }).passthrough();

/** `drift practices promote --json` on success (exit 0): checked at the fields the dialog reads. */
export const PromoteResultEnvelope = z
  .object({
    written: z.boolean(),
    place: z.string(),
    convention: z.object({ id: convId, summary: z.string() }).passthrough(),
    candidate: z
      .object({
        concern: z.string(),
        ways: z.array(PromoteWayEnvelope),
        other_ways: z.array(PromoteWayEnvelope),
        follows: z.number(),
        exceptions: z.array(PromoteExampleEnvelope),
        unknown: z.number(),
        total: z.number(),
      })
      .passthrough(),
    baselined: z.number(),
    replay: z.object({ recent: z.number(), followed: z.number() }).passthrough().nullable(),
    preview: z.string(),
  })
  .passthrough();

/** `drift practices promote --json` when it refuses (exit 2, nothing written): the refusal and its sentence. */
export const PromoteRefusedEnvelope = z.object({ refused: z.object({ code: z.string() }).passthrough(), message: z.string() }).passthrough();

export const PromoteEnvelope = z.union([PromoteRefusedEnvelope, PromoteResultEnvelope]);

/** One entry of `drift practices promote --list --json`. */
const PromoteListItemEnvelope = z.object({ place: z.string(), command: z.string(), candidate: z.object({ concern: z.string(), ways: z.array(PromoteWayEnvelope) }).passthrough() }).passthrough();

/** `drift practices promote --list --json` (drift-cli promote.rs `list_of`, exit 0): each candidate is checked where read (features/practices). `passive`: newer drift. */
export const PromoteListEnvelope = z
  .object({
    candidates: z.array(PromoteListItemEnvelope),
    passive: z.array(PromoteListItemEnvelope).optional(),
    declined: z.number(),
    promoted: z.array(z.string()),
  })
  .passthrough();

/** One decision made through the Studio (Drift itself keeps no history). */
export const AuditEntry = z.object({
  at: z.number(),
  user: z.string(),
  decision: AuditDecision,
  ids: z.array(convId),
  command: z.string(),
  ok: z.boolean(),
  output: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** What a scan saw, kept to say what changed "since the last scan". */
export const Snapshot = z.object({
  at: z.number(),
  commit: z.string().nullable(),
  files: z.number(),
  pending: z.array(z.string()),
  newViolations: z.array(z.string()),
  unguarded: z.array(z.string()),
  reaching: z.array(z.string()),
  sinks: z.array(z.string()),
  leaks: z.array(z.string()),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const History = z.object({ snapshots: z.array(Snapshot), audit: z.array(AuditEntry) });
export type History = z.infer<typeof History>;

export const LogEntry = z.object({
  at: z.number(),
  level: z.enum(["debug", "info", "warn", "error"]),
  source: z.enum(["main", "renderer"]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const RepoChange = z.object({ repo: z.string(), changed: z.number(), sample: z.array(z.string()) });
export type RepoChange = z.infer<typeof RepoChange>;

export const channels = {
  handshake: { req: z.tuple([]), res: z.object({ ipc: z.number(), platform: z.string(), appVersion: z.string() }) },
  recentRepos: { req: z.tuple([]), res: z.array(RepoRef) },
  openRepo: { req: z.tuple([]), res: RepoRef.nullable() },
  forgetRepo: { req: z.tuple([RepoRef]), res: z.array(RepoRef) },
  driftInfo: { req: z.tuple([]), res: DriftInfo },
  chooseDrift: { req: z.tuple([z.boolean()]), res: DriftInfo },
  facts: { req: z.tuple([RepoRef, z.object({ refresh: z.boolean() })]), res: loaded(FactsEnvelope) },
  census: { req: z.tuple([RepoRef]), res: loaded(CensusEnvelope) },
  check: { req: z.union([z.tuple([RepoRef]), z.tuple([RepoRef, CheckOpts])]), res: loaded(CheckEnvelope) },
  /** With `{ base }`, `--diff-base <base>`: the diff payload instead of the inventory. */
  security: { req: z.union([z.tuple([RepoRef]), z.tuple([RepoRef, CheckOpts])]), res: loaded(z.union([SecurityEnvelope, SecurityDiffEnvelope])) },
  /** `drift practices --json`: the practice map (facts, not rules; read-only). */
  practices: { req: z.tuple([RepoRef]), res: loaded(PracticesEnvelope) },
  /** `drift map --json`: the structural map (read-only); the Map view reads each package's dependencies. */
  map: { req: z.tuple([RepoRef]), res: loaded(MapEnvelope) },
  /** `drift census --why --json`: what mining dropped, gate by gate (observation only, read-only). */
  funnel: { req: z.tuple([RepoRef]), res: loaded(FunnelEnvelope) },
  /** `drift practices promote --list --json`: every practice that may be promoted now. Writes nothing. */
  promoteList: { req: z.tuple([RepoRef]), res: loaded(PromoteListEnvelope) },
  policy: { req: z.tuple([RepoRef]), res: PolicyFiles },
  review: { req: z.tuple([RepoRef, Decision, z.array(convId).min(1).max(200)]), res: AuditEntry },
  /** `drift review --exempt <id> --member <m> --reason <r>`, or with a null reason `--unexempt <id> --member <m>`. */
  exempt: { req: z.tuple([RepoRef, convId, MemberKey, ExceptionReason.nullable()]), res: AuditEntry },
  /** `drift review --set-log=on|off`: the opt-in, local review log (`review_log` in conventions.yaml); Drift's output. */
  setReviewLog: { req: z.tuple([RepoRef, z.boolean()]), res: z.string() },
  /** `drift review --export-log=<path the person chose> [--include-paths]`: the path written, null when cancelled. */
  exportReviewLog: { req: z.tuple([RepoRef, z.object({ includePaths: z.boolean() })]), res: z.object({ path: z.string().nullable(), output: z.string() }) },
  /** `drift review --shown=<ids>`: records in the review log that these cards were shown (nothing while it is off); false when drift refused. */
  reviewShown: { req: z.tuple([RepoRef, z.array(convId).min(1).max(200)]), res: z.boolean() },
  /**
   * The review log's study export, read back (`drift review --export-log` to a file of the app's own, hashed, then
   * deleted): for the answers it holds (Settings). Null while the log is off or empty. Checked loosely.
   */
  reviewLogExport: { req: z.tuple([RepoRef]), res: z.object({ schema: z.literal("drift-review-log"), events: z.array(z.any()) }).passthrough().nullable() },
  /** `drift review --json`: each block candidate's one question. */
  reviewQuestions: { req: z.tuple([RepoRef]), res: QuestionsEnvelope },
  /** `drift review --answer=<id>=<answer> [--set-apart=<paths>] [--confirm-entry=<path#symbol,...>]`: an explicit write. */
  answer: { req: z.tuple([RepoRef, convId, Answer, z.array(SetApartPath).max(500), z.array(MemberKey).max(500)]), res: AuditEntry },
  init: { req: z.tuple([RepoRef]), res: z.string() },
  /** `drift practices promote <id> --in <place> [--with <id>]... [--block] --dry-run --json`: what promoting would record, or why it refuses. Writes nothing. */
  promotePreview: { req: z.tuple([RepoRef, PromoteRequest]), res: PromoteEnvelope },
  /** The same without `--dry-run`: an explicit write (one accepted convention, and a drift.lock entry per exception). A refusal writes nothing. */
  promote: { req: z.tuple([RepoRef, PromoteRequest]), res: PromoteEnvelope },
  readSource: { req: z.tuple([RepoRef, relPath]), res: z.string().nullable() },
  listSessions: { req: z.tuple([RepoRef, z.object({ all: z.boolean() })]), res: z.array(SessionSummary) },
  readTranscript: { req: z.tuple([RepoRef, sessionId]), res: z.string() },
  readSessionState: { req: z.tuple([RepoRef, sessionId]), res: SessionState.nullable() },
  loadStudies: { req: z.tuple([z.object({ choose: z.boolean() })]), res: StudiesData.nullable() },
  history: { req: z.tuple([RepoRef]), res: History },
  recordSnapshot: { req: z.tuple([RepoRef, Snapshot]), res: History },
  clearHistory: { req: z.tuple([RepoRef]), res: History },
  logs: { req: z.tuple([]), res: z.array(LogEntry) },
  log: { req: z.tuple([LogEntry]), res: z.null() },
  saveText: { req: z.tuple([z.string().max(200), z.string().max(5_000_000)]), res: z.boolean() },
  cancel: { req: z.tuple([z.string().max(64)]), res: z.boolean() },
} as const;

export type Channel = keyof typeof channels;
export const CHANNELS = Object.keys(channels) as Channel[];

// The preload's name list and the schema table must describe the same channels.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _sameChannels: Same<Channel, (typeof CHANNEL_NAMES)[number]> = true;
void _sameChannels;
export type Req<C extends Channel> = z.infer<(typeof channels)[C]["req"]>;
export type Res<C extends Channel> = z.infer<(typeof channels)[C]["res"]>;

/** Push events from main to renderer. */
export const EVENTS = { repoChanged: RepoChange } as const;
export type EventName = keyof typeof EVENTS;

/** The bridge the preload exposes as `window.driftStudio`. */
export interface Bridge {
  ipc: number;
  invoke(channel: Channel, args: unknown[], requestId?: string): Promise<unknown>;
  on(event: EventName, cb: (payload: unknown) => void): () => void;
}

export class IpcError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "drift" | "cancelled" | "unavailable" | "internal" = "internal",
  ) {
    super(message);
  }
}

declare global {
  interface Window {
    /** Exposed by electron/preload.ts with contextBridge; absent in a plain browser. */
    driftStudio?: Bridge;
  }
}
