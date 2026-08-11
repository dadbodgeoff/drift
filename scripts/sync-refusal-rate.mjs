#!/usr/bin/env node
/**
 * EW-10: copy the measured refusal rate from the bench baseline into the claims ledger.
 *
 * The ledger has to record the measured refusal rate, and a number typed by hand is a number that
 * drifts from what was measured - which is the exact failure mode a claims ledger exists to prevent.
 * So it is derived, from `scripts/beta-bench-baseline.json`, together with the sha it was measured at.
 *
 *   node scripts/sync-refusal-rate.mjs <commit-sha> <YYYY-MM-DD>
 *
 * The sha and date are arguments rather than read from git, because a baseline can be older than the
 * working tree and claiming otherwise would be the same lie in a different place.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BASELINE = join(HERE, "beta-bench-baseline.json");
const CLAIMS = join(REPO_ROOT, "docs/architecture/beta-claims.json");

const [shaArg, dateArg] = process.argv.slice(2);
const sha =
  shaArg ??
  execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
const measuredAt = dateArg ?? new Date().toISOString().slice(0, 10);
if (!/^[a-f0-9]{7,40}$/.test(sha)) {
  console.error(`not a commit sha: ${sha}`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) {
  console.error(`not an ISO date: ${measuredAt}`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const claims = JSON.parse(readFileSync(CLAIMS, "utf8"));

const perRepo = {};
for (const row of baseline) {
  if (!row.onboarded || typeof row.refused !== "number") {
    continue;
  }
  perRepo[row.repo] = {
    refused: row.refused,
    total: row.applicable,
    parser_gaps: row.parser_gap_count ?? null,
    import_resolution_rate: row.import_resolution_rate ?? null
  };
}
const refusedTotal = Object.values(perRepo).reduce((sum, entry) => sum + entry.refused, 0);
const editsTotal = Object.values(perRepo).reduce((sum, entry) => sum + entry.total, 0);

claims.enforcement_posture.measured_refusal_rate = {
  note:
    "How often Drift declines to answer about an edit that is not a violation. Eight ordinary edits " +
    "per repo - a comment, a new layered route, a new helper, a helper plus its caller, an added " +
    "local import, an appended export, two new routes in one diff, and a moved route - none of " +
    "which breaks the data-access convention. A refusal (exit 3) on any of them is Drift failing to " +
    "be useful about work it should understand completely. Derived from the harness baseline by " +
    "scripts/sync-refusal-rate.mjs, never typed by hand.",
  source: "scripts/beta-bench.mjs",
  baseline: "scripts/beta-bench-baseline.json",
  measured_at: measuredAt,
  commit: sha,
  refused: refusedTotal,
  total: editsTotal,
  rate: editsTotal === 0 ? null : Math.round((refusedTotal / editsTotal) * 10_000) / 10_000,
  per_repo: perRepo
};

writeFileSync(CLAIMS, `${JSON.stringify(claims, null, 2)}\n`);
console.log(
  `recorded refusal rate ${refusedTotal}/${editsTotal} across ${Object.keys(perRepo).length} repo(s) ` +
    `at ${sha} (${measuredAt})`
);
