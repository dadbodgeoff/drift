/**
 * Failure classification shared by every Drift surface.
 *
 * The CLI grew this first: a local-first tool's error message is its support channel, so every
 * failure must carry a code, a next action, and retry guidance. R-3 verified that the MCP surface
 * had none of it - raw SQLite strings ("file is not a database", "disk I/O error") reached agents
 * as bare JSON-RPC -32000 messages. Classification lives here in core so the CLI and MCP report
 * the same failure the same way.
 *
 * Two structured signals take precedence over message matching:
 * - errors carrying their own classification (the CLI's `DriftError`: `code` + `userAction`),
 *   detected structurally so no package has to share a class identity across build boundaries;
 * - the storage layer's corrupt-blob marker (`driftFailureCode: "corrupt_database"`), set at the
 *   throw site where "these bytes came from the database" is still known.
 */

export interface ClassifiedFailure {
  code: string;
  safe_to_retry: boolean;
  user_action: string;
  recovery_commands: string[];
}

/** Structurally detect an error that states its own classification (e.g. the CLI's DriftError). */
export function isSelfClassifiedError(error: unknown): error is {
  code: string;
  userAction: string;
  recoveryCommands?: string[];
  safeToRetry?: boolean;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { userAction?: unknown }).userAction === "string"
  );
}

/** True when a thrown value carries storage's corrupt-database marker. */
export function hasCorruptDatabaseMarker(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { driftFailureCode?: unknown }).driftFailureCode === "corrupt_database"
  );
}

/**
 * Classify a thrown value. Prefers structured signals on the error itself, then falls back to
 * message matching for throw sites not yet migrated to self-classified errors.
 */
export function classifyFailure(error: unknown, message: string): ClassifiedFailure {
  if (isSelfClassifiedError(error)) {
    return {
      code: error.code,
      safe_to_retry: error.safeToRetry ?? true,
      user_action: error.userAction,
      recovery_commands: error.recoveryCommands ?? []
    };
  }
  // R-3 (F-1c): a JSON parse failure on a blob read back from the database means a corrupted
  // page, not bad user input. The storage layer marks those at the throw site - the only place
  // that knows where the bytes came from - so this check must NOT generalize to all JSON errors:
  // a malformed file the user passed in still classifies as a generic error below.
  if (hasCorruptDatabaseMarker(error)) {
    return corruptDatabaseFailure();
  }
  return classifyFailureMessage(message);
}

export function classifyFailureMessage(message: string): ClassifiedFailure {
  if (message.startsWith("Scan is stale")) {
    return {
      code: "stale_scan",
      safe_to_retry: true,
      user_action: "Refresh the scan or rerun without --require-fresh for read-only stale context.",
      recovery_commands: extractRecoveryCommands(message, ["drift scan status --json"])
    };
  }
  if (
    message.startsWith("No repo contract exists") ||
    message.includes("No accepted repo contract exists") ||
    (message.toLowerCase().includes("contract") && message.toLowerCase().includes("exist"))
  ) {
    return {
      code: "missing_contract",
      safe_to_retry: true,
      user_action: "Accept or import a repo contract before running contract-backed enforcement.",
      recovery_commands: ["drift conventions list --status candidate --json", "drift contract import <contract.json> --dry-run --json"]
    };
  }
  // Dogfooding surfaced this: running from a Cargo workspace resolves the engine to `cargo run`,
  // and if the Rust toolchain is not resolvable the raw rustup text reached the user with no
  // Drift framing at all. Only affects people running from a checkout, but that is contributors.
  if (
    message.includes("rustup could not choose") ||
    message.includes("no default toolchain") ||
    (message.includes("cargo") && message.includes("toolchain"))
  ) {
    return {
      code: "missing_engine",
      safe_to_retry: true,
      user_action:
        "Drift resolved its engine to `cargo run` because it is running from a Cargo workspace, and the Rust toolchain is not configured. Run `rustup default stable`, or set DRIFT_ENGINE_BIN to a built drift-engine binary.",
      recovery_commands: ["rustup default stable", "drift doctor --repo-root . --json"]
    };
  }
  // W3: "missing" means the binary could not be found or trusted, per docs/reference/errors.md.
  // An engine that started and exited non-zero is a different event, and matching bare "Rust
  // engine" conflated them: `drift scan --repo-root <typo>` produced "Drift Rust engine failed
  // with exit code 1. No such file or directory", which was reported as a missing engine. Harmless
  // while every code exited 1; once the exit code follows the code, that mistyped path started
  // claiming to be a fail-closed refusal, blaming a component that was working correctly.
  const engineRanAndFailed = /engine failed with exit code/i.test(message);
  if (!engineRanAndFailed && (message.includes("DRIFT_ENGINE_BIN") || message.includes("Rust engine"))) {
    return {
      code: "missing_engine",
      safe_to_retry: true,
      user_action: "Install or point Drift at a trusted Rust engine binary.",
      recovery_commands: ["drift doctor --json"]
    };
  }
  if (message.includes("unsupported schema") || message.includes("Unsupported local state schema")) {
    return {
      code: "unsupported_database",
      safe_to_retry: false,
      user_action: "Use a Drift CLI version compatible with this local database.",
      recovery_commands: ["drift doctor --json"]
    };
  }
  if (message.startsWith("Missing --db")) {
    return {
      code: "missing_database",
      safe_to_retry: true,
      user_action: "Provide --db <path> or set DRIFT_DB.",
      recovery_commands: ["drift --help"]
    };
  }
  // Failures that reached users as a raw SQLite or filesystem string. Each of these was
  // observed during development: "database or disk is full" surfaced verbatim mid-scan with no
  // indication of what to do, which is how a guardrail loses trust - the error message is the
  // support channel for a local-first tool.
  if (message.includes("disk is full") || message.includes("ENOSPC") || message.includes("SQLITE_FULL")) {
    return {
      code: "disk_full",
      safe_to_retry: true,
      user_action: "Free disk space for Drift's local state, then rerun. Existing state may be incomplete.",
      recovery_commands: ["drift doctor --repo-root . --json", "drift state size --json"]
    };
  }
  // R-3 (F-1a): "disk I/O error" is how ENOSPC (and failing hardware) surfaces mid-check via
  // SQLITE_IOERR - SQLite reports the failed syscall, not the underlying errno. The old
  // catch-all told users to "rerun with corrected inputs", which is wrong on every cause.
  if (message.includes("disk I/O error") || message.includes("SQLITE_IOERR")) {
    return {
      code: "disk_io_error",
      // The cause is a full or failing disk, not the invocation; retrying unchanged will not fix it.
      safe_to_retry: false,
      user_action: "SQLite could not read or write Drift's local database. This usually means the disk is full or failing: check free disk space first, then disk health. Local state may be incomplete.",
      recovery_commands: ["drift doctor --repo-root . --json", "drift state size --json", "drift backup list --json"]
    };
  }
  if (
    message.includes("database disk image is malformed") ||
    message.includes("file is not a database") ||
    message.includes("SQLITE_CORRUPT") ||
    message.includes("SQLITE_NOTADB")
  ) {
    return corruptDatabaseFailure();
  }
  if (message.includes("JavaScript heap out of memory") || message.includes("Not enough heap")) {
    return {
      code: "insufficient_memory",
      safe_to_retry: true,
      user_action: "Raise Node's heap limit with NODE_OPTIONS=--max-old-space-size, then retry.",
      recovery_commands: ["drift doctor --repo-root . --json"]
    };
  }
  if (
    message.includes("EACCES") ||
    message.includes("EPERM") ||
    message.includes("permission denied") ||
    // R-3 (F-1b): SQLite's own phrasing for a permission problem - it never says "permission
    // denied", it says the database is readonly (SQLITE_READONLY).
    message.includes("attempt to write a readonly database") ||
    message.includes("SQLITE_READONLY")
  ) {
    return {
      code: "permission_denied",
      safe_to_retry: false,
      user_action: "Drift cannot read or write a required path. Check ownership of the repo and of the Drift state directory.",
      recovery_commands: ["drift doctor --repo-root . --json"]
    };
  }
  return {
    code: "cli_error",
    safe_to_retry: false,
    user_action: "Read the diagnostic message and rerun with corrected inputs.",
    recovery_commands: ["drift --help"]
  };
}

function corruptDatabaseFailure(): ClassifiedFailure {
  return {
    code: "corrupt_database",
    // Rerunning cannot repair a corrupt file; say so rather than inviting a retry loop.
    safe_to_retry: false,
    user_action: "The local database is unreadable. Restore a backup, or delete the repo's state directory to rebuild it from a fresh scan.",
    recovery_commands: ["drift backup list --json", "drift doctor --repo-root . --json"]
  };
}

function extractRecoveryCommands(message: string, fallback: string[]): string[] {
  const match = message.match(/Run (drift [^;]+);/);
  return match?.[1] ? [match[1]] : fallback;
}

/**
 * An error that states its own classification, without needing a shared class identity.
 *
 * W4/D-E7. `isSelfClassifiedError` above is deliberately structural so that "no package has to
 * share a class identity across build boundaries" - but only the CLI ever had a constructor for
 * the shape, so MCP kept throwing plain `Error`s and relied on `classifyFailureMessage` matching
 * their prose. Two of its throw sites land on codes the CLI migrated away from prose-matching in
 * W3: `Scan is stale for ...` -> `stale_scan` and `No repo contract exists for ...` ->
 * `missing_contract`.
 *
 * Those matched, so nothing was broken. What was true is that MCP's classification depended on
 * the first four words of two sentences, and since W3 the exit code follows the failure code - so
 * rewording either sentence would have silently demoted a refusal to the catch-all. The CLI has
 * not been able to do that since W3; this is the same protection for the other surface.
 *
 * Returns a real `Error` (so stacks and `instanceof Error` still work) with the classification
 * attached, which is exactly what `isSelfClassifiedError` looks for.
 */
export function selfClassifiedError(input: {
  message: string;
  code: string;
  userAction: string;
  recoveryCommands?: string[];
  safeToRetry?: boolean;
}): Error {
  return Object.assign(new Error(input.message), {
    code: input.code,
    userAction: input.userAction,
    recoveryCommands: input.recoveryCommands ?? [],
    safeToRetry: input.safeToRetry ?? true
  });
}
