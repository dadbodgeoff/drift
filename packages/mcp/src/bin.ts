#!/usr/bin/env node
import { runReadOnlyMcpStdioServer } from "./index.js";

const databasePath = flagValue(process.argv.slice(2), "db") ?? process.env.DRIFT_DB;

if (!databasePath) {
  process.stderr.write("Missing --db <path> or DRIFT_DB for drift-mcp.\n");
  process.exit(1);
}

await runReadOnlyMcpStdioServer({ databasePath });

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
