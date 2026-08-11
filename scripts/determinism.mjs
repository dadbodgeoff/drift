#!/usr/bin/env node
/**
 * EW-7 / DET-2: determinism, measured where the doubt actually is.
 *
 * The marketed claim is that Drift is deterministic. The published evidence covered taxonomy and
 * papermark. The one observed flap - cal.com's findings count changing between runs - was on neither,
 * and was attributed to cross-agent harness contamination after 26 consecutive clean runs failed to
 * reproduce it. That attribution was plausible and unfalsifiable at the same time, because nothing
 * detected contamination.
 *
 * Two things follow, and this script is both of them. It refuses to measure a worktree something else
 * has touched (so "it was contamination" becomes a statement with evidence either way), and it
 * measures the repo the doubt is about.
 *
 *   node scripts/determinism.mjs                      # every eval repo, 3 runs each
 *   node scripts/determinism.mjs --only calcom -n 10  # the repo the flap was seen on
 *
 * A run's digest covers what a user would notice change: the exit code, the check status, the number
 * of findings, and every finding's fingerprint and enforcement result. Timings and ids that
 * legitimately vary per invocation are excluded - a digest that changes every run proves nothing.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVAL_REPOS } from "./eval-repos.mjs";
import { contaminationAllowed, contaminationRefusal } from "./worktree-contamination.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((value) => value.trim()).filter(Boolean)
    : null;
const runsIndex = args.indexOf("-n");
const RUNS = runsIndex >= 0 && args[runsIndex + 1] ? Number(args[runsIndex + 1]) : 3;
if (!Number.isInteger(RUNS) || RUNS < 2) {
  console.error("-n must be an integer of at least 2; one run cannot disagree with anything");
  process.exit(1);
}

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };
delete env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;

function drift(cwd, extraEnv, ...a) {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...a], {
        cwd,
        encoding: "utf8",
        env: { ...env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024
      })
    };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout?.toString() ?? "" };
  }
}

/**
 * What a user would notice change between two runs.
 *
 * Deliberately excludes check ids, scan ids and durations: those vary by invocation by design (a
 * check id folds in a collision-avoidance nonce), so including them would make every run differ and
 * turn this into a test that cannot fail for the right reason.
 */
function runDigest(payload, exitCode) {
  const findings = (payload.findings ?? [])
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      enforcement_result: finding.enforcement_result,
      status: finding.status,
      diff_status: finding.diff_status,
      file: finding.evidence_refs?.[0]?.file_path ?? null,
      line: finding.evidence_refs?.[0]?.start_line ?? null,
      import_source: finding.evidence_refs?.[0]?.import_source ?? null
    }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const observable = {
    exit_code: exitCode,
    status: payload.check?.status ?? null,
    findings_count: findings.length,
    blocking_count: payload.summary?.blocking_count ?? null,
    partial_coverage: payload.summary?.partial_coverage?.complete ?? null,
    parser_gap_count: payload.readiness?.parser_gap_count ?? null,
    findings
  };
  return {
    digest: createHash("sha256").update(JSON.stringify(observable)).digest("hex").slice(0, 16),
    observable
  };
}

function measureRepo(cfg) {
  const root = join(REPOS_DIR, cfg.name);
  if (!existsSync(root)) {
    return { repo: cfg.name, status: "MISSING_REPO" };
  }

  // Before anything else, and before any reset: see EW-7 in worktree-contamination.mjs.
  const contamination = contaminationRefusal(root, cfg.name);
  if (contamination.refused && !contaminationAllowed(args)) {
    return {
      repo: cfg.name,
      status: "CONTAMINATED_WORKTREE",
      reason: contamination.reason,
      contaminated_files: contamination.entries.map((entry) => entry.path)
    };
  }

  const home = mkdtempSync(join(tmpdir(), "drift-determinism-home-"));
  const repoEnv = { HOME: home, DRIFT_HOME: home };
  try {
    const startArgs = ["start", "--repo-root", ".", "--accept-defaults"];
    if (cfg.declaredDataModules) startArgs.push("--data-modules", cfg.declaredDataModules);
    const started = drift(root, repoEnv, ...startArgs);
    if (started.code !== 0) {
      return { repo: cfg.name, status: "ONBOARD_FAILED" };
    }
    const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    const db = join(home, ".drift/repos", repoId, "drift.sqlite");

    const digests = [];
    for (let run = 0; run < RUNS; run += 1) {
      const check = drift(
        root,
        repoEnv,
        "--db",
        db,
        "check",
        "--repo",
        repoId,
        "--diff",
        "HEAD",
        "--scope",
        "full",
        "--json"
      );
      let payload = {};
      try {
        payload = JSON.parse(check.stdout);
      } catch {
        return { repo: cfg.name, status: "UNPARSEABLE_CHECK", run };
      }
      digests.push(runDigest(payload, check.code));
    }

    const unique = [...new Set(digests.map((entry) => entry.digest))];
    return {
      repo: cfg.name,
      status: unique.length === 1 ? "DETERMINISTIC" : "FLAPPED",
      runs: RUNS,
      digest: unique[0],
      distinct_digests: unique.length,
      // On a flap, keep every distinct observation. A flap that is not reproducible is exactly the
      // situation this exists to make investigable, so throwing the evidence away is not an option.
      observations:
        unique.length === 1
          ? undefined
          : digests.map((entry, index) => ({ run: index, digest: entry.digest, observable: entry.observable }))
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const selected = only ? EVAL_REPOS.filter((cfg) => only.includes(cfg.name)) : EVAL_REPOS;
if (selected.length === 0) {
  console.error(`No evaluation repos matched --only ${only?.join(",")}`);
  process.exit(1);
}

const rows = [];
for (const cfg of selected) {
  const row = measureRepo(cfg);
  rows.push(row);
  if (row.status === "DETERMINISTIC") {
    console.log(`  ${row.repo.padEnd(11)} ${row.runs} runs, identical (${row.digest})`);
  } else if (row.status === "CONTAMINATED_WORKTREE") {
    console.error(`  REFUSED ${row.repo}: ${row.reason}`);
  } else if (row.status === "FLAPPED") {
    console.error(
      `  FLAPPED ${row.repo}: ${row.distinct_digests} distinct results across ${row.runs} runs`
    );
    for (const observation of row.observations ?? []) {
      console.error(`      run ${observation.run}: ${observation.digest} ${JSON.stringify(observation.observable).slice(0, 300)}`);
    }
  } else {
    console.error(`  ${row.status} ${row.repo}`);
  }
}

// A repo that is not on this machine is a repo this run did not measure, so it is a failure and not
// a footnote. Exempting MISSING_REPO meant `pnpm eval:determinism` on a checkout with no eval repos
// cloned printed "0/7 repo(s) deterministic" and exited 0 — the harness reporting success for
// having measured nothing, which is the failure mode the whole battery exists to catch. Running
// against a subset is still supported; it just has to be said out loud with `--only`.
// external-eval.mjs already fails this way (`status !== "PASS"`); this matches it.
const failures = rows.filter((row) => row.status !== "DETERMINISTIC");
console.log(
  `\n${rows.filter((row) => row.status === "DETERMINISTIC").length}/${rows.length} repo(s) deterministic over ${RUNS} runs`
);
if (failures.length > 0) {
  process.exit(1);
}
