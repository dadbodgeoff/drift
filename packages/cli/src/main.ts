#!/usr/bin/env node
import { runCli } from "./index.js";

const result = await runCli(process.argv.slice(2));
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
