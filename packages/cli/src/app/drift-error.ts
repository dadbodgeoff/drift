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
  // An agent contract's path_globs named a file the scan does not index, so a finding about it
  // would carry no content hash. Previously this surfaced as an uncaught Zod error on
  // `evidence_refs[0].file_hash` and exit 1, discarding every convention that had already passed.
  | "unindexed_contract_target"
  // The engine can emit fact kinds this CLI does not understand, so the pairing would fail partway
  // through the scan. Detected at the `scan_started` handshake, before anything is ingested.
  | "engine_vocabulary_mismatch"
  | "cli_error";

/**
 * What each code means for the process exit code and for `error.type` in JSON.
 *
 * One table, because the per-throw-site alternative was tried and failed. `exitCode` used to be an
 * option on every throw defaulting to 1, so a refusal exited 3 only when whoever wrote the throw
 * remembered to say so. Three did not: `missing_contract` and `insufficient_disk` omitted it, and
 * `missing_engine` was never constructed as a DriftError at all - so all three exited 1 while
 * docs/reference/errors.md documented them as exit-3 refusals. The repo's own suite had already
 * frozen the wrong behaviour (cli.test.ts asserts exitCode 1 directly above code:
 * "missing_contract"), so the docs and the tests disagreed and the tests won silently.
 *
 * A refusal means no enforcement claim was made - Drift declining to answer rather than answering
 * wrongly - and exits 3. An error means Drift itself failed, and exits 1. Exit 2 is deliberately
 * absent: it belongs to `check` finding a violation, which is a verdict, not a failure.
 */
export const FAILURE_CONTRACT: Record<
  DriftFailureCode,
  { exitCode: 1 | 3; type: "refusal" | "error" }
> = {
  // Refusals: nothing was claimed about the code under inspection.
  stale_scan: { exitCode: 3, type: "refusal" },
  missing_contract: { exitCode: 3, type: "refusal" },
  missing_engine: { exitCode: 3, type: "refusal" },
  insufficient_disk: { exitCode: 3, type: "refusal" },
  insufficient_memory: { exitCode: 3, type: "refusal" },
  shallow_clone: { exitCode: 3, type: "refusal" },
  empty_diff_scope: { exitCode: 3, type: "refusal" },
  stale_diff_scope: { exitCode: 3, type: "refusal" },
  empty_contract: { exitCode: 3, type: "refusal" },
  engine_payload_too_large: { exitCode: 3, type: "refusal" },
  unindexed_contract_target: { exitCode: 3, type: "refusal" },
  engine_vocabulary_mismatch: { exitCode: 3, type: "refusal" },

  // Errors: Drift itself failed, and the operator has something to fix.
  unsupported_database: { exitCode: 1, type: "error" },
  missing_database: { exitCode: 1, type: "error" },
  disk_full: { exitCode: 1, type: "error" },
  disk_io_error: { exitCode: 1, type: "error" },
  corrupt_database: { exitCode: 1, type: "error" },
  permission_denied: { exitCode: 1, type: "error" },
  cli_error: { exitCode: 1, type: "error" }
};

/**
 * Whether a string is a code this build knows.
 *
 * The shared classifier in @drift/core types its result as `string`, so this is the one place the
 * widening is undone. An unknown code is a bug rather than a state to absorb quietly, but the
 * error path is the wrong place to throw a second error, so callers fall back to `cli_error` -
 * which is what an unclassified failure has always meant.
 */
export function isDriftFailureCode(value: string): value is DriftFailureCode {
  return Object.hasOwn(FAILURE_CONTRACT, value);
}

/** Narrow a classifier code, falling back to the catch-all rather than throwing inside a handler. */
export function asDriftFailureCode(value: string): DriftFailureCode {
  return isDriftFailureCode(value) ? value : "cli_error";
}

/** The exit code this failure carries. A property of the code, never of the throw site. */
export function exitCodeForFailure(code: DriftFailureCode): 1 | 3 {
  return FAILURE_CONTRACT[code].exitCode;
}

/**
 * The `error.type` this failure reports.
 *
 * Was the hardcoded literal "refusal" for every JSON error, including plain usage errors: `drift
 * frobnicate --json` exits 1 with code `cli_error` and still called itself a refusal. The field
 * carried no information, so a consumer had to read the exit code or the failure code instead -
 * the opposite of what a typed discriminator is for.
 */
export function errorTypeForFailure(code: DriftFailureCode): "refusal" | "error" {
  return FAILURE_CONTRACT[code].type;
}

export interface DriftErrorOptions {
  code: DriftFailureCode;
  /** What the operator should do about it, in one sentence. */
  userAction: string;
  /** Commands that address it, in the order worth trying. */
  recoveryCommands?: string[];
  /** Whether the same invocation could succeed unchanged. */
  safeToRetry?: boolean;
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
    this.exitCode = exitCodeForFailure(options.code);
    this.discardsCreatedState = options.discardsCreatedState ?? false;
  }
}

export function isDriftError(value: unknown): value is DriftError {
  return value instanceof DriftError;
}

/**
 * A bad invocation: wrong flags, wrong paths, wrong combination.
 *
 * Worth a helper because the classifier's prose fallback is greedy and a usage message often reads
 * like a domain failure. "Contract export output already exists" contains both "contract" and
 * "exist", which is exactly the fallback's `missing_contract` test, so a bad `--output` path was
 * being reported as a missing contract. That cost nothing while every code exited 1; once the exit
 * code follows the code, it made a typo look like a fail-closed refusal. Saying `cli_error` at the
 * throw site skips the guessing entirely.
 */
export function usageError(message: string, recoveryCommands: string[] = ["drift --help"]): DriftError {
  return new DriftError(message, {
    code: "cli_error",
    userAction: "Read the diagnostic message and rerun with corrected inputs.",
    recoveryCommands,
    safeToRetry: false
  });
}
