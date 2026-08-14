import { openDriftStorage } from "@drift/storage";
import { existsSync,rmSync } from "node:fs";
import { isDriftError } from "./drift-error.js";
import { operationalFailureFor } from "./failure-classification.js";
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
  // T-01: what this invocation brought into existence, so a refusal that learned nothing can
  // leave the filesystem as it found it. Captured out here because the decision is made in the
  // catch, after `storage.close()` has run.
  let createdDatabasePath: string | undefined;
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

    // Before the open, which is what creates the file.
    if (!existsSync(databasePath)) {
      createdDatabasePath = databasePath;
    }
    const storage = openDriftStorage({ databasePath });
    // F-3b: WAL recovery that discarded commit records is a data-loss signal SQLite itself
    // never reports. It is a warning, not a failure - the recovered state is consistent - so
    // it goes to stderr and never contaminates the JSON payload on stdout.
    const openWarnings = storage.openDiagnostics
      .map((diagnostic) => `warning(${diagnostic.code}): ${diagnostic.message}\n`)
      .join("");
    assertSupportedLocalDatabase(storage.getAppliedMigrations());
    storage.migrate();
    assertSupportedLocalDatabase(storage.getAppliedMigrations());
    try {
      const result = normalizeCommandResult(await runCommand(storage, parsed));
      return {
        exitCode: result.exitCode ?? 0,
        stdout: formatOutput(result.payload, parsed),
        stderr: openWarnings
      };
    } finally {
      storage.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI error.";
    if (isDriftError(error) && error.discardsCreatedState && createdDatabasePath) {
      discardCreatedDatabase(createdDatabasePath);
    }
    const failure = operationalFailureFor(error, message);
    // A DriftError may declare its own exit code: 3 marks a fail-closed refusal (e.g. the
    // shallow-clone identity refusal, X-1), which CI must be able to tell from a plain error.
    const exitCode = isDriftError(error) ? error.exitCode : 1;
    if (wantsJson) {
      const staleRefusal = failure.code === "stale_scan";
      return {
        exitCode,
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
      exitCode,
      stdout: "",
      stderr: `${message}\n`
    };
  }
}

/**
 * Remove a database this invocation created, and the WAL sidecars SQLite creates beside it.
 *
 * `force` throughout: this runs on an error path, and a cleanup that throws would replace the
 * refusal the user needs to read with an unrelated filesystem error.
 */
function discardCreatedDatabase(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(path, { force: true });
  }
}

