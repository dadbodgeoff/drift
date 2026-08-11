import { CommandPayload,ParsedArgs } from "./command-types.js";

export function formatOutput(payload: unknown, parsed: ParsedArgs): string {
  if (typeof payload === "string") {
    return payload.endsWith("\n") ? payload : `${payload}\n`;
  }
  if (parsed.flags.has("json")) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  return `${JSON.stringify(payload)}\n`;
}

export function normalizeCommandResult(result: unknown | CommandPayload): CommandPayload {
  if (isCommandPayload(result)) {
    return result;
  }
  return { payload: result };
}

export function isCommandPayload(value: unknown): value is CommandPayload {
  return Boolean(value && typeof value === "object" && "payload" in value);
}
