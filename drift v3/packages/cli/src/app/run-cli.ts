import { openDriftStorage } from "@drift/storage";
import { isDriftError } from "./drift-error.js";
import { createAgentEnvelopeV2 } from "@drift/core";
import { unknownCommandError,validateCommandShape } from "../args/command-shape.js";
import { helpText,isHelpRequest,isVersionRequest } from "../args/help.js";
import { parseArgs } from "../args/parse-args.js";
import { resolveDatabasePath } from "../args/repo-flags.js";
import { verifyBackup } from "../commands/backup.js";
import { doctorRepo } from "../commands/doctor.js";
import { restoreBackup } from "../commands/restore.js";
import { ensureDatabasePath } from "../domain/repo-paths.js";
import { DRIFT_CLI_VERSION,assertSupportedLocalDatabase,capabilitiesPayload,formatCapabilitiesText,versionPayload } from "../domain/versions.js";
import { CliResult } from "./command-types.js";
import { formatOutput,normalizeCommandResult } from "./output.js";
import { runCommand } from "./router.js";

export async function runCli(argv: string[]): Promise<CliResult> {
  const wantsJson = argv.includes("--json");
  try {
    const parsed = parseArgs(argv);
    if (isVersionRequest(parsed)) {
      return {
        exitCode: 0,
        stdout: parsed.flags.has("json")
          ? `${JSON.stringify(versionPayload(), null, 2)}\n`
          : `${DRIFT_CLI_VERSION}\n`,
        stderr: ""
      };
    }
    if (isHelpRequest(parsed)) {
      return { exitCode: 0, stdout: helpText(parsed), stderr: "" };
    }

    const unknownCommand = unknownCommandError(parsed);
    if (unknownCommand) {
      throw new Error(unknownCommand);
    }
    validateCommandShape(parsed);

    if (parsed.positional[0] === "capabilities") {
      const payload = capabilitiesPayload();
      return {
        exitCode: 0,
        stdout: parsed.flags.has("json")
          ? formatOutput(payload, parsed)
          : formatOutput(formatCapabilitiesText(payload), parsed),
        stderr: ""
      };
    }

    if (parsed.positional[0] === "doctor") {
      const result = normalizeCommandResult(doctorRepo(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    }

    if (parsed.positional[0] === "restore") {
      const result = normalizeCommandResult(restoreBackup(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    }

    if (parsed.positional[0] === "backup" && parsed.positional[1] === "verify") {
      const result = normalizeCommandResult(verifyBackup(parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    }

    const databasePath = resolveDatabasePath(parsed);
    if (!databasePath) {
      throw new Error("Missing --db <path> or DRIFT_DB. Run drift --help.");
    }
    ensureDatabasePath(databasePath);

    const storage = openDriftStorage({ databasePath });
    assertSupportedLocalDatabase(storage.getAppliedMigrations());
    storage.migrate();
    assertSupportedLocalDatabase(storage.getAppliedMigrations());
    try {
      const result = normalizeCommandResult(await runCommand(storage, parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: ""
      };
    } finally {
      storage.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI error.";
    const failure = operationalFailureFor(error, message);
    if (wantsJson) {
      const staleRefusal = failure.code === "stale_scan";
      return {
        exitCode: 1,
        stdout: `${JSON.stringify({
          error: {
            message,
            type: "refusal",
            code: failure.code
          },
          failure,
          agent_envelope: createAgentEnvelopeV2({
            surface: "cli-error",
            policy: {
              allowed: staleRefusal,
              surface: "cli-preflight",
              reason: message
            },
            scan: staleRefusal
              ? {
                required_fresh: true,
                stale: true,
                latest_scan_id: null
              }
              : undefined,
            diagnostics: [message]
          })
        }, null, 2)}\n`,
        stderr: `${message}\n`
      };
    }
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${message}\n`
    };
  }
}

/**
 * Classify a thrown value.
 *
 * Prefers a `DriftError`'s own code over matching on message text. The string-matching branches
 * below remain as a fallback for throw sites not yet migrated - they are the reason rewording an
 * error message could previously change exit-code behaviour, since the stale-scan branch maps to
 * a fail-closed refusal.
 */
function operationalFailureFor(error: unknown, message: string) {
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
  return operationalFailureForMessage(message);
}

function operationalFailureForMessage(message: string): {
  code: string;
  surface: "cli";
  severity: "error";
  safe_to_retry: boolean;
  user_action: string;
  recovery_commands: string[];
  diagnostics: string[];
} {
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
  if (
    message.includes("database disk image is malformed") ||
    message.includes("file is not a database") ||
    message.includes("SQLITE_CORRUPT") ||
    message.includes("SQLITE_NOTADB")
  ) {
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
  if (
    message.includes("EACCES") ||
    message.includes("EPERM") ||
    message.includes("permission denied")
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
