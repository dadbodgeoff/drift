// The renderer's only way to get data: a named-operation API over the IPC
// contract (shared/ipc/contract.ts). In Electron it is backed by the preload
// bridge; in a plain browser by fixtures that the real drift binary produced.
import type { AbRow, Census, CheckReport, Inventory, MapPackage, PracticesReport, RepoFacts, ReviewQuestions, SecurityDiff, SessionState } from "@/shared/contract/drift";
import type { Answer, AuditEntry, Decision, DriftInfo, History, LogEntry, PolicyFiles, Provenance, RepoChange, RepoRef, SessionSummary, Snapshot } from "@/shared/ipc/contract";

export type { Answer, AuditEntry, Decision, DriftInfo, History, LogEntry, PolicyFiles, Provenance, RepoChange, RepoRef, SessionSummary, Snapshot };

export interface Loaded<T> {
  data: T;
  /** When the data was produced (ms since epoch). */
  at: number;
  /** Served from the Studio's cache rather than a fresh run. */
  cached: boolean;
  /** How long the drift run took. */
  ms?: number;
  provenance: Provenance;
}

export interface StudiesData {
  source: string;
  labels: string;
  secondOpinion: string | null;
  census: Record<string, Census>;
  ab: { name: string; rows: AbRow[] }[];
  /** Study runs' metrics (every metrics.json under eval/study/runs/<run>: views, parts, parts' views), by path relative to the checkout; `variant` for `metrics-<variant>.json`. */
  runs: { path: string; metrics?: unknown; error?: string; calibration?: boolean; variant?: string }[];
  calibrations: { path: string; shift?: unknown; agreements: { path: string; agreement: unknown }[] }[];
  /** Labeller agreement (`agreement.json`) by directory, anywhere under a run. */
  agreements?: { path: string; agreement: unknown }[];
  /** What an adjudication excluded (`adjudication/queue.json` `excluded`), by directory. */
  exclusions?: { path: string; excluded: unknown }[];
  manifests: { path: string; note: string; repos: number; language: string | null }[];
}

export interface Handshake {
  ipc: number;
  platform: string;
  appVersion: string;
}

export interface RunOpts {
  signal?: AbortSignal;
}

export interface StudioApi {
  readonly mode: "electron" | "fixture";
  handshake(): Promise<Handshake>;
  recentRepos(): Promise<RepoRef[]>;
  /** Ask the person to choose a repository (a native dialog in Electron). */
  openRepo(): Promise<RepoRef | null>;
  forgetRepo(repo: RepoRef): Promise<RepoRef[]>;
  driftInfo(): Promise<DriftInfo>;
  /** Choose the drift binary (a native file dialog); `reset` goes back to auto-detect. */
  chooseDrift(reset: boolean): Promise<DriftInfo>;
  /** `drift scan --out`; `refresh: false` returns the last cached scan when there is one. */
  facts(repo: RepoRef, opts: { refresh: boolean } & RunOpts): Promise<Loaded<RepoFacts>>;
  census(repo: RepoRef, opts?: RunOpts): Promise<Loaded<Census>>;
  /** `drift check --format json`; with `base`, `--diff-base <base>`: only what the change since the merge base introduces. */
  check(repo: RepoRef, opts?: RunOpts & { base?: string | null }): Promise<Loaded<CheckReport>>;
  security(repo: RepoRef, opts?: RunOpts): Promise<Loaded<Inventory>>;
  /** `drift security --json --diff-base <base>`: only what the change since the merge base introduces (exit 0: facts for review). */
  securityDiff(repo: RepoRef, opts: RunOpts & { base: string }): Promise<Loaded<SecurityDiff>>;
  /** `drift practices --json`: for each cross-cutting concern, its variants by share, where each lives and an example (facts, not rules). */
  practices(repo: RepoRef, opts?: RunOpts): Promise<Loaded<PracticesReport>>;
  /** `drift map --json`: packages with production and test dependencies apart (the Map view draws its graph from `drift scan`). */
  map(repo: RepoRef, opts?: RunOpts): Promise<Loaded<{ schema: number; packages: MapPackage[] }>>;
  policy(repo: RepoRef): Promise<PolicyFiles>;
  /** `drift review --accept|--reject|--block <ids>`: an explicit write; returns the audit entry. */
  review(repo: RepoRef, decision: Decision, ids: string[]): Promise<AuditEntry>;
  /** A reviewer's "fine because…": `drift review --exempt <id> --member <path#symbol> --reason <reason>`, or `--unexempt` when `reason` is null. An explicit write; returns the audit entry. */
  exempt(repo: RepoRef, id: string, member: string, reason: string | null): Promise<AuditEntry>;
  /** `drift review --set-log=on|off`: the opt-in, local review log. An explicit write; Drift's output. */
  setReviewLog(repo: RepoRef, on: boolean): Promise<string>;
  /** `drift review --export-log` to a file the person chooses (a save dialog); `path` null when cancelled. */
  exportReviewLog(repo: RepoRef, opts: { includePaths: boolean }): Promise<{ path: string | null; output: string }>;
  /** `drift review --shown`: a card the person opened, for the review log (a no-op while it is off). */
  reviewShown(repo: RepoRef, ids: string[]): Promise<boolean>;
  /** The review log's study export (hashed), read back for what it holds; null while the log is off or empty. Writes nothing in the repository. */
  reviewLogExport(repo: RepoRef): Promise<unknown>;
  /** `drift review --json`: each block candidate's one question ("Are these the same kind of thing?"), with its holders and flagged members by file. Changes nothing. */
  reviewQuestions(repo: RepoRef): Promise<ReviewQuestions>;
  /** A block candidate's answer: `drift review --answer=<id>=<answer>`; with `different`, `--set-apart=<files>` and `--confirm-entry=<path#symbol,...>` (the separate tick). An explicit write; returns the audit entry. */
  answer(repo: RepoRef, id: string, answer: Answer, setApart: string[], confirmEntry: string[]): Promise<AuditEntry>;
  /** `drift init`: an explicit write. */
  init(repo: RepoRef): Promise<string>;
  /** A source file Drift scanned, as text (null when unavailable). */
  readSource(repo: RepoRef, path: string): Promise<string | null>;
  listSessions(repo: RepoRef, opts: { all: boolean }): Promise<SessionSummary[]>;
  readTranscript(repo: RepoRef, id: string): Promise<string>;
  /** `<repo>/.drift/cache/sessions/<id>.json`, or null. */
  readSessionState(repo: RepoRef, id: string): Promise<SessionState | null>;
  loadStudies(opts: { choose: boolean }): Promise<StudiesData | null>;
  /** Snapshots and the decision audit trail, kept in the app's data directory (never in the repo). */
  history(repo: RepoRef): Promise<History>;
  recordSnapshot(repo: RepoRef, s: Snapshot): Promise<History>;
  clearHistory(repo: RepoRef): Promise<History>;
  logs(): Promise<LogEntry[]>;
  log(e: LogEntry): Promise<void>;
  /** Save text to a file the person chooses (a native save dialog). */
  saveText(suggestedName: string, text: string): Promise<boolean>;
  onRepoChanged(cb: (c: RepoChange) => void): () => void;
}

/** Keep at most this many snapshots per repository (and none older than 90 days). */
export const SNAPSHOT_RETENTION = { count: 30, days: 90 };
/** Keep at most this many audit entries per repository (and none older than 365 days). */
export const AUDIT_RETENTION = { count: 1000, days: 365 };

/** Apply retention to a history (shared by the main process and the fixture adapter). */
export function retain(h: History, now = Date.now()): History {
  const day = 86_400_000;
  return {
    snapshots: h.snapshots.filter((s) => now - s.at <= SNAPSHOT_RETENTION.days * day).slice(-SNAPSHOT_RETENTION.count),
    audit: h.audit.filter((a) => now - a.at <= AUDIT_RETENTION.days * day).slice(-AUDIT_RETENTION.count),
  };
}
