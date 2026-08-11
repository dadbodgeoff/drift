import { ParsedArgs } from "../app/command-types.js";
import { isIsoTimestamp } from "./flag-readers.js";
import { BOOLEAN_FLAGS,VALUE_FLAGS } from "./flag-schema.js";

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const rawFlag = token.slice(2);
    if (!rawFlag) {
      throw new Error("Empty flag name.");
    }

    const equalsIndex = rawFlag.indexOf("=");
    if (equalsIndex >= 0) {
      const key = rawFlag.slice(0, equalsIndex);
      if (!key) {
        throw new Error("Empty flag name.");
      }
      if (flags.has(key)) {
        throw new Error(`Duplicate flag: --${key}`);
      }
      flags.set(key, rawFlag.slice(equalsIndex + 1));
      continue;
    }

    const key = rawFlag;
    if (flags.has(key)) {
      throw new Error(`Duplicate flag: --${key}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }

  validateParsedFlags(flags);
  return { positional, flags };
}

export function validateParsedFlags(flags: Map<string, string | true>): void {
  for (const [key, value] of flags) {
    if (!VALUE_FLAGS.has(key) && !BOOLEAN_FLAGS.has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
    if (VALUE_FLAGS.has(key)) {
      if (value === true) {
        throw new Error(`--${key} requires a value.`);
      }
      if (value === "") {
        throw new Error(`--${key} requires a non-empty value.`);
      }
      if (!value.trim()) {
        throw new Error(`--${key} must not be empty.`);
      }
      if (key === "now" && !isIsoTimestamp(value)) {
        throw new Error("--now must be an ISO timestamp.");
      }
      continue;
    }
    if (value !== true) {
      throw new Error(`--${key} does not accept a value.`);
    }
  }
}
