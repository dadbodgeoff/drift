import { isCorruptStoredDataError } from "@drift/storage";
import { isDriftError } from "./drift-error.js";

/**
 * Classify a thrown value.
 *
 * Prefers a `DriftError`'s own code over matching on message text. The string-matching branches
 * below remain as a fallback for throw sites not yet migrated - they are the reason rewording an
 * error message could previously change exit-code behaviour, since the stale-scan branch maps to
 * a fail-closed refusal.
 */
export interface OperationalFailure {
  code: string;
  surface: "cli";
  severity: "error";
  safe_to_retry: boolean;
  user_action: string;
  recovery_commands: string[];
  diagnostics: string[];
}

export function operationalFailureFor(error: unknown, message: string): OperationalFailure {
  if (isDriftError(error)) {
    return {
      code: error.code,
      surface: "cli" as const,
      severity: "error" as const,
      safe_to_retry: error.safeToRetry,
      user_action: error.userAction,
      recovery_commands: error.recoveryCommands,
      diagnostics: [message]
    };
  }
  // R-3 (F-1c): a JSON parse failure on a blob read back from the database means a corrupted
  // page, not bad user input. The storage layer marks those at the throw site - the only place
  // that knows where the bytes came from - so this check must NOT generalize to all JSON errors:
  // a malformed contract file the user passed in still classifies as cli_error below.
  if (isCorruptStoredDataError(error)) {
    return corruptDatabaseFailure(message);
  }
  return operationalFailureForMessage(message);
}

function corruptDatabaseFailure(message: string): OperationalFailure {
  return {
    code: "corrupt_database",
    surface: "cli",
    severity: "error",
    // Rerunning cannot repair a corrupt file; say so rather than inviting a retry loop.
    safe_to_retry: false,
    user_action: "The local database is unreadable. Restore a backup, or delete the repo's state directory to rebuild it from a fresh scan.",
    recovery_commands: ["drift backup list --json", "drift doctor --repo-root . --json"],
    diagnostics: [message]
  };
}

export function operationalFailureForMessage(message: string): OperationalFailure {
  if (message.startsWith("Scan is stale")) {
    return {
      code: "stale_scan",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Refresh the scan or rerun without --require-fresh for read-only stale context.",
      recovery_commands: extractRecoveryCommands(message, ["drift scan status --json"]),
      diagnostics: [message]
    };
  }
  if (
    message.startsWith("No repo contract exists") ||
    message.includes("No accepted repo contract exists") ||
    (message.toLowerCase().includes("contract") && message.toLowerCase().includes("exist"))
  ) {
    return {
      code: "missing_contract",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Accept or import a repo contract before running contract-backed enforcement.",
      recovery_commands: ["drift conventions list --status candidate --json", "drift contract import <contract.json> --dry-run --json"],
      diagnostics: [message]
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
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action:
        "Drift resolved its engine to `cargo run` because it is running from a Cargo workspace, and the Rust toolchain is not configured. Run `rustup default stable`, or set DRIFT_ENGINE_BIN to a built drift-engine binary.",
      recovery_commands: ["rustup default stable", "drift doctor --repo-root . --json"],
      diagnostics: [message]
    };
  }
  if (message.includes("DRIFT_ENGINE_BIN") || message.includes("Rust engine")) {
    return {
      code: "missing_engine",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Install or point Drift at a trusted Rust engine binary.",
      recovery_commands: ["drift doctor --json"],
      diagnostics: [message]
    };
  }
  if (message.includes("unsupported schema") || message.includes("Unsupported local state schema")) {
    return {
      code: "unsupported_database",
      surface: "cli",
      severity: "error",
      safe_to_retry: false,
      user_action: "Use a Drift CLI version compatible with this local database.",
      recovery_commands: ["drift doctor --json"],
      diagnostics: [message]
    };
  }
  if (message.startsWith("Missing --db")) {
    return {
      code: "missing_database",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Provide --db <path> or set DRIFT_DB.",
      recovery_commands: ["drift --help"],
      diagnostics: [message]
    };
  }
  // Failures that reached users as a raw SQLite or filesystem string. Each of these was
  // observed during development: "database or disk is full" surfaced verbatim mid-scan with no
  // indication of what to do, which is how a guardrail loses trust - the error message is the
  // support channel for a local-first tool.
  if (message.includes("disk is full") || message.includes("ENOSPC") || message.includes("SQLITE_FULL")) {
    return {
      code: "disk_full",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Free disk space for Drift's local state, then rerun. Existing state may be incomplete.",
      recovery_commands: ["drift doctor --repo-root . --json", "drift state size --json"],
      diagnostics: [message]
    };
  }
  // R-3 (F-1a): "disk I/O error" is how ENOSPC (and failing hardware) surfaces mid-check via
  // SQLITE_IOERR - SQLite reports the failed syscall, not the underlying errno. The old
  // catch-all told users to "rerun with corrected inputs", which is wrong on every cause.
  if (message.includes("disk I/O error") || message.includes("SQLITE_IOERR")) {
    return {
      code: "disk_io_error",
      surface: "cli",
      severity: "error",
      // The cause is a full or failing disk, not the invocation; retrying unchanged will not fix it.
      safe_to_retry: false,
      user_action: "SQLite could not read or write Drift's local database. This usually means the disk is full or failing: check free disk space first, then disk health. Local state may be incomplete.",
      recovery_commands: ["drift doctor --repo-root . --json", "drift state size --json", "drift backup list --json"],
      diagnostics: [message]
    };
  }
  if (
    message.includes("database disk image is malformed") ||
    message.includes("file is not a database") ||
    message.includes("SQLITE_CORRUPT") ||
    message.includes("SQLITE_NOTADB")
  ) {
    return corruptDatabaseFailure(message);
  }
  if (message.includes("JavaScript heap out of memory") || message.includes("Not enough heap")) {
    return {
      code: "insufficient_memory",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: "Raise Node's heap limit with NODE_OPTIONS=--max-old-space-size, then retry.",
      recovery_commands: ["drift doctor --repo-root . --json"],
      diagnostics: [message]
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
      surface: "cli",
      severity: "error",
      safe_to_retry: false,
      user_action: "Drift cannot read or write a required path. Check ownership of the repo and of the Drift state directory.",
      recovery_commands: ["drift doctor --repo-root . --json"],
      diagnostics: [message]
    };
  }
  return {
    code: "cli_error",
    surface: "cli",
    severity: "error",
    safe_to_retry: false,
    user_action: "Read the diagnostic message and rerun with corrected inputs.",
    recovery_commands: ["drift --help"],
    diagnostics: [message]
  };
}

function extractRecoveryCommands(message: string, fallback: string[]): string[] {
  const match = message.match(/Run (drift [^;]+);/);
  return match?.[1] ? [match[1]] : fallback;
}
