import { openDriftStorage } from "@drift/storage";
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
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? `${error.message}\n` : "Unknown CLI error.\n"
    };
  }
}
