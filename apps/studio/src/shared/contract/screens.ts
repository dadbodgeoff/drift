// Drift's JSON for the Upgrade and Feedback views: `drift upgrade --json` (crates/drift-cli/src/upgrade.rs, schema
// `drift-upgrade` version 1) and the marks file `drift feedback mark` writes (crates/drift-cli/src/feedback.rs,
// `.drift/feedback/marks.json`, schema `drift-feedback-marks` version 1). Proposals from the map are
// `Census.from_map` (drift.ts). tests/unit/screens.test.ts compares every field here with the Rust structs.

/** `drift upgrade --json` `schema`, and the versions this Studio reads. */
export const UPGRADE_SCHEMA = "drift-upgrade";
export const SUPPORTED_UPGRADE = [1];

/** One file Drift wrote, and what it records of the Drift that wrote it (upgrade.rs `FileRow`). */
export interface UpgradeFile {
  path: string;
  present: boolean;
  /** What a file of this kind records of its writer and format, the same for every repository. */
  records: string;
  /** The writer as the file says it; absent where it records none. */
  written_by?: string;
  /** Its format (or inventory) version, as the file says it. */
  format?: string;
  /** What this Drift reads and writes of it. */
  this_drift?: string;
  notes: string[];
}

/** What a person saw when they accepted a convention (policy.rs `AcceptedEvidence`). */
export interface UpgradeAcceptedEvidence {
  role_size: number;
  holders: number;
  total: number;
  lower_bound: number;
}

/** What this Drift reads of an accepted convention now (upgrade.rs `Now`). */
export interface UpgradeNow {
  role?: number;
  members?: number;
  holders?: number;
  not_checked: number;
  stale?: string;
  mode?: string;
  /** Why it is not checked at all (a wiring rule with the feature off). */
  unchecked?: string;
}

/** `stale`, `newly_violated_by_unchanged_code`, `no_longer_checkable` or `unchanged` (upgrade.rs `ConventionRow.classes`). */
export type UpgradeClass = "stale" | "newly_violated_by_unchanged_code" | "no_longer_checkable" | "unchanged" | (string & {});

/** An accepted convention, then and now (upgrade.rs `ConventionRow`). */
export interface UpgradeConvention {
  id: string;
  summary: string;
  /** `mined`, `practice` (promoted from the practice map) or `wiring`. */
  rule: string;
  /** Null where the file did not keep it (accepted before Drift kept it). */
  accepted: UpgradeAcceptedEvidence | null;
  now: UpgradeNow;
  classes: UpgradeClass[];
  reading_only: number;
  changed_code: number;
  cannot_tell: number;
}

/** One new violation, keyed as drift.lock keys it (upgrade.rs `Row`). */
export interface UpgradeViolation {
  id: string;
  member: string;
  line: number;
  /** The commit it was compared with (reading-only). */
  base?: string;
  /** Why Drift cannot tell (cannot-tell). */
  why?: string;
}

export interface UpgradeViolations {
  /** Appear only because this Drift reads the code differently: `--apply` baselines them. */
  reading_only: UpgradeViolation[];
  /** In code that changed since the convention was baselined: `drift check`'s business. */
  changed_code: UpgradeViolation[];
  /** Drift cannot tell which: for a person. */
  cannot_tell: UpgradeViolation[];
}

/** The security baseline against this Drift's inventory (upgrade.rs `Security`). */
export interface UpgradeSecurity {
  present: boolean;
  inventory?: number;
  stamped: boolean;
  this_inventory: number;
  new_in_drift: Record<string, number>;
  new_in_drift_total: number;
  failing_not_in_baseline: number;
}

/** An agent integration and how it compares with what this Drift writes (upgrade.rs `Integration`). */
export interface UpgradeIntegration {
  path: string;
  /** `agents-md` or `claude-settings`. */
  kind: string;
  /** `current`, `older` (an older Drift wrote it and nobody changed it), `edited`, or `differs` (Drift cannot tell). */
  state: "current" | "older" | "edited" | "differs" | (string & {});
  note: string;
}

/** Something left to do, and who does it (upgrade.rs `Todo`). */
export interface UpgradeTodo {
  what: string;
  command: string;
  /** `apply` (`drift upgrade --apply` does it), `security_baseline` (with `--security-baseline`), or `person`. */
  by: "apply" | "security_baseline" | "person" | (string & {});
}

/** `drift upgrade --json` (upgrade.rs `Report`): exit 0 when nothing is left, 3 when something is, 1 when a write of `--apply` failed. */
export interface UpgradeReport {
  schema: string;
  version: number;
  drift: string;
  apply: boolean;
  files: UpgradeFile[];
  conventions: UpgradeConvention[];
  violations: UpgradeViolations;
  security: UpgradeSecurity;
  integrations: UpgradeIntegration[];
  /** What `--apply` did (empty in a dry run). */
  done: string[];
  /** The write that failed; nothing after it was written. */
  failed?: string;
  left: UpgradeTodo[];
  pending: boolean;
}

/** `drift upgrade --json` when a file was written by a newer Drift or does not parse (upgrade.rs `refuse`, exit 2): nothing was read further or changed. */
export interface UpgradeRefusal {
  schema: string;
  version: number;
  drift: string;
  refused: true;
  newer: string[];
  unreadable: string[];
}

export type UpgradeOutcome = UpgradeReport | UpgradeRefusal;

export const isUpgradeRefusal = (u: UpgradeOutcome): u is UpgradeRefusal => (u as UpgradeRefusal).refused === true;

/** The marks file's `schema`, and the versions this Studio reads (feedback.rs `MARKS_SCHEMA`, `MARKS_VERSION`). */
export const MARKS_SCHEMA = "drift-feedback-marks";
export const SUPPORTED_MARKS = [1];

/** One person's verdict on one report (feedback.rs `Mark`). */
export interface FeedbackMark {
  /** `violation` or `finding`. */
  report: "violation" | "finding" | (string & {});
  /** The convention's id (a violation) or the finding's id. */
  id: string;
  /** `path#symbol` of a violation; absent for a finding. */
  member?: string;
  verdict: "true" | "wrong" | (string & {});
  /** The person's words, if they gave any (exported only with `--include-reasons`). */
  why?: string;
  /** The rule kind when it was marked (`wrapped_by:call`), or `finding:<concern>`. */
  kind: string;
  /** The convention's tier when it was marked; absent for a finding. */
  tier?: string;
  /** Whether the violation was in drift.lock when it was marked. */
  baselined: boolean;
  /** The day it was marked, `YYYY-MM-DD` (UTC). */
  day: string;
}

/** `.drift/feedback/marks.json` (feedback.rs `MarksFile`). */
export interface FeedbackMarks {
  schema: string;
  version: number;
  marks: FeedbackMark[];
}
