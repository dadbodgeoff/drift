#!/usr/bin/env node
import { runMcpCli } from "./index.js";

const result = await runMcpCli(process.argv.slice(2));
process.exitCode = result.exitCode;
