/**
 * Errors that carry their own classification.
 *
 * The CLI's top-level handler classified failures by matching on message text -
 * `message.startsWith("Scan is stale")`, `message.includes("DRIFT_ENGINE_BIN")`, and six more.
 * That was fragile before and became load-bearing once exit codes turned into a documented
 * contract: the stale-scan branch maps to exit 3, a fail-closed refusal, so rewording an error
 * string silently changed exit-code behaviour.
 *
 * A `DriftError` states its own code, so the classifier reads a field instead of guessing from
 * prose. String matching is kept as a fallback for throw sites not yet migrated, which makes this
 * incremental rather than a big-bang rewrite.
 */

/** Failure codes the CLI reports. Kept in step with the classifier's fallback branches. */
export type DriftFailureCode =
  | "stale_scan"
  | "missing_contract"
  | "missing_engine"
  | "unsupported_database"
  | "missing_database"
  | "insufficient_disk"
  | "insufficient_memory"
  | "disk_full"
  | "disk_io_error"
  | "corrupt_database"
  | "permission_denied"
  | "shallow_clone"
  // BB-1: the diff scope resolved to zero examinable files, so no verdict is available. Distinct
  // from a clean pass, which is a verdict.
  | "empty_diff_scope"
  // BB-9: the diff named files the working tree does not have, and every one of them was missing, so
  // nothing could be examined. Distinct from `empty_diff_scope`: there the range is wrong, here the
  // diff and the checkout disagree about what exists, and the remediations differ accordingly.
  | "stale_diff_scope"
  // T-01: the engine streamed more data than onboarding can re-serialize into the
  // `infer-candidates` request. A refusal, not a crash: the repo is outside the supported
  // envelope, and nothing is claimed about it.
  | "engine_payload_too_large"
  // T-07: a contract exists but accepts nothing, so there is nothing to enforce. A refusal, not a
  // pass: reporting a clean run here is indistinguishable from a repo that was actually checked.
  | "empty_contract"
  | "cli_error";

export interface DriftErrorOptions {
  code: DriftFailureCode;
  /** What the operator should do about it, in one sentence. */
  userAction: string;
  /** Commands that address it, in the order worth trying. */
  recoveryCommands?: string[];
  /** Whether the same invocation could succeed unchanged. */
  safeToRetry?: boolean;
  /**
   * Process exit code. Defaults to 1 (an error). A fail-closed refusal - Drift declining to
   * claim anything rather than reporting something wrong - exits 3, matching CHECK_EXIT_REFUSED,
   * so CI and agents can tell "this is broken" from "this refused to guess".
   */
  exitCode?: number;
  /**
   * T-01: this failure learned nothing, so a database this invocation brought into existence
   * should not survive it.
   *
   * Set only where that is true. A partial database is worse than no database: `drift start` on
   * lobe-chat left a 495,616-byte file behind and every later command exited 1 against it, with
   * nothing in the output connecting the second failure to the first. A database that already
   * existed is never removed - it holds state this invocation did not create.
   */
  discardsCreatedState?: boolean;
}

export class DriftError extends Error {
  readonly code: DriftFailureCode;
  readonly userAction: string;
  readonly recoveryCommands: string[];
  readonly safeToRetry: boolean;
  readonly exitCode: number;
  readonly discardsCreatedState: boolean;

  constructor(message: string, options: DriftErrorOptions) {
    super(message);
    this.name = "DriftError";
    this.code = options.code;
    this.userAction = options.userAction;
    this.recoveryCommands = options.recoveryCommands ?? [];
    this.safeToRetry = options.safeToRetry ?? true;
    this.exitCode = options.exitCode ?? 1;
    this.discardsCreatedState = options.discardsCreatedState ?? false;
  }
}

export function isDriftError(value: unknown): value is DriftError {
  return value instanceof DriftError;
}
