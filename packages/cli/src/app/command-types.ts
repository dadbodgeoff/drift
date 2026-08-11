import type { SqliteDriftStorage } from "@drift/storage";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

export interface CommandPayload {
  payload: unknown;
  exitCode?: number;
}

export interface CommandContext {
  storage: SqliteDriftStorage;
  parsed: ParsedArgs;
  now: () => string;
}
