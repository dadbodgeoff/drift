// The parameter-type oracle on Drift's synthetic fixtures, as a gate.
//
//   node eval/oracle/fixtures.mjs --drift target/debug/drift
//
// Each fixture is copied to a temporary directory. A fixture's `_node_modules`
// becomes `node_modules` there (the repository ignores `node_modules`, so a
// fixture's installed packages are kept under another name). Drift scans the copy
// and `types.mjs --strict` compares every key with the type checker. Exits 1 on
// any disagreement, `drift_only` keys included.
// Needs the `typescript` package (set TS_PATH to its directory if not installed here).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const drift = resolve(arg("--drift", join(here, "..", "..", "target", "debug", "drift")));
const fixtures = join(here, "..", "..", "crates", "drift-ts", "tests", "fixtures");
const FIXTURES = ["param-types", "param-types-tricky", "param-types-review2"];

let failed = false;
for (const name of FIXTURES) {
  const work = mkdtempSync(join(tmpdir(), `drift-oracle-${name}-`));
  try {
    const root = join(work, "repo");
    cpSync(join(fixtures, name), root, { recursive: true });
    if (existsSync(join(root, "_node_modules"))) renameSync(join(root, "_node_modules"), join(root, "node_modules"));
    const facts = join(work, "facts.json");
    const scan = spawnSync(drift, ["--root", root, "--no-cache", "scan", "--out", facts], { encoding: "utf8" });
    if (scan.status !== 0) throw new Error(`drift scan failed on ${name}: ${scan.stderr}`);
    const r = spawnSync(process.execPath, [join(here, "types.mjs"), root, facts, "--strict", "--verbose"], {
      encoding: "utf8",
      env: process.env,
    });
    process.stdout.write(`${name}: ${r.stdout}`);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) failed = true;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
process.exitCode = failed ? 1 : 0;
