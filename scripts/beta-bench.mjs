#!/usr/bin/env node
/**
 * EW-4: the ordinary-edit refusal bench, and the parser-gap ratchet.
 *
 * Refusal rate is the single largest determinant of a stranger's first session. A check that
 * refuses (exit 3) is honest, but a developer who makes eight ordinary edits and is refused on four
 * of them has learned that Drift does not work on their repo - the honesty of each individual
 * refusal is beside the point.
 *
 * So this measures the thing a first session actually consists of: **edits that are not violations**.
 * Each of the eight shapes below is something a developer does hourly and none of them breaks the
 * data-access convention, so the only correct answers are 0 (clean) or, if Drift flags something,
 * a false positive worth knowing about. A 3 means Drift declined to answer about an edit it should
 * have had no trouble with.
 *
 * It also carries the **ratchet** the TDD asks for. Parser-gap counts rose after the resolver work
 * (formbricks 99 -> 1,104; openstatus 340 -> 750; cal.com 2,429 -> 2,535) because the resolver
 * began recognising far more specifiers as should-be-local and honestly reporting what it could not
 * place. The reporting is correct; the volume is the problem, and it rose *unnoticed*. Per-repo
 * counts may fall freely; a rise fails and names the delta.
 *
 *   node scripts/beta-bench.mjs                  # measure and check against the baseline
 *   node scripts/beta-bench.mjs --update         # rewrite the baseline
 *   node scripts/beta-bench.mjs --only calcom    # one repo (merges on --update, never truncates)
 *
 * Hermetic per repo: its own HOME, its own database, `git reset --hard` between edits. Nothing here
 * mutates the pinned evaluation repos' committed state.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVAL_REPOS } from "./eval-repos.mjs";
import { requireReleaseEngine } from "./engine-handshake.mjs";
import { ratchetRegressions } from "./beta-bench-ratchet.mjs";
import { contaminationAllowed, contaminationRefusal } from "./worktree-contamination.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const BASELINE = join(HERE, "beta-bench-baseline.json");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((value) => value.trim()).filter(Boolean)
    : null;

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };
delete env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function drift(cwd, extraEnv, ...a) {
  try {
    return {
      ok: true,
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
    return { ok: false, code: error.status ?? 1, stdout: error.stdout?.toString() ?? "" };
  }
}

/** Identical to the other harnesses: clean alone leaves staged files behind. */
function resetTree(root) {
  try {
    git(root, "reset", "-q", "--hard", "HEAD");
    git(root, "clean", "-qfd");
  } catch {
    /* best effort */
  }
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}

/** An existing route file to edit in place, chosen deterministically so runs are comparable. */
function anExistingRoute(root, routeDir) {
  const listed = git(root, "ls-files", `${routeDir}`)
    .split("\n")
    .filter((line) => line.endsWith("/route.ts") || line.endsWith("/route.tsx"))
    .sort();
  return listed[0] ?? null;
}

/**
 * The eight ordinary edits.
 *
 * Each returns the files it wrote, or null when the repo's shape makes the edit inapplicable (a
 * repo with no existing route file cannot have one edited). Inapplicable shapes are recorded as
 * such rather than counted as passes - a bench that silently skips is a bench that flatters.
 *
 * None of these violates the data-access convention. That is the point: they are the edits a
 * stranger makes before ever writing a violation, and a refusal on any of them is Drift failing to
 * be useful about work it should understand completely.
 */
function ordinaryEdits(cfg) {
  const dir = cfg.routeDir;
  return [
    {
      id: "E1-comment-only",
      apply: (root) => {
        const target = anExistingRoute(root, dir);
        if (!target) return null;
        const path = join(root, target);
        writeFileSync(path, `// touched by the drift ordinary-edit bench\n${readFileSync(path, "utf8")}`);
        return [target];
      }
    },
    {
      id: "E2-new-layered-route",
      apply: (root) => {
        const path = `${dir}/drift-bench-layered/route.ts`;
        writeFileSync(
          ensureDir(join(root, path)),
          `import { ${cfg.cleanSymbol} } from "${cfg.cleanModule}";\n\n` +
            `export async function GET() {\n` +
            `  return Response.json({ ok: typeof ${cfg.cleanSymbol} !== "undefined" });\n` +
            `}\n`
        );
        return [path];
      }
    },
    {
      id: "E3-new-helper-module",
      apply: (root) => {
        const path = `${dir}/drift-bench-helper/shape.ts`;
        writeFileSync(
          ensureDir(join(root, path)),
          `export interface BenchShape {\n  id: string;\n}\n\n` +
            `export function benchShape(id: string): BenchShape {\n  return { id };\n}\n`
        );
        return [path];
      }
    },
    {
      id: "E4-route-uses-new-helper",
      apply: (root) => {
        const helper = `${dir}/drift-bench-pair/shape.ts`;
        const route = `${dir}/drift-bench-pair/route.ts`;
        writeFileSync(
          ensureDir(join(root, helper)),
          `export function benchLabel(): string {\n  return "bench";\n}\n`
        );
        writeFileSync(
          ensureDir(join(root, route)),
          `import { benchLabel } from "./shape";\n\n` +
            `export async function GET() {\n  return Response.json({ label: benchLabel() });\n}\n`
        );
        return [helper, route];
      }
    },
    {
      id: "E5-add-local-import-to-existing-route",
      apply: (root) => {
        const target = anExistingRoute(root, dir);
        if (!target) return null;
        const path = join(root, target);
        writeFileSync(
          path,
          `import { ${cfg.cleanSymbol} } from "${cfg.cleanModule}";\n${readFileSync(path, "utf8")}\n` +
            `// bench reference: ${cfg.cleanSymbol}\n`
        );
        return [target];
      }
    },
    {
      id: "E6-early-return-in-existing-route",
      apply: (root) => {
        const target = anExistingRoute(root, dir);
        if (!target) return null;
        const path = join(root, target);
        writeFileSync(
          path,
          `${readFileSync(path, "utf8")}\nexport const benchRuntime = "nodejs";\n`
        );
        return [target];
      }
    },
    {
      id: "E7-two-new-routes-one-diff",
      apply: (root) => {
        const first = `${dir}/drift-bench-two-a/route.ts`;
        const second = `${dir}/drift-bench-two-b/route.ts`;
        for (const path of [first, second]) {
          writeFileSync(
            ensureDir(join(root, path)),
            `export async function GET() {\n  return Response.json({ ok: true });\n}\n`
          );
        }
        return [first, second];
      }
    },
    {
      id: "E8-rename-a-new-route-directory",
      apply: (root) => {
        // A move, which is the shape a refactor produces: the file is new to this diff at its new
        // path, and its content is unchanged.
        const from = `${dir}/drift-bench-moved-from/route.ts`;
        const to = `${dir}/drift-bench-moved-to/route.ts`;
        writeFileSync(
          ensureDir(join(root, from)),
          `export async function GET() {\n  return Response.json({ ok: true });\n}\n`
        );
        git(root, "add", "-A");
        git(root, "-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "bench-move-base");
        mkdirSync(dirname(join(root, to)), { recursive: true });
        git(root, "mv", from, to);
        return [to];
      }
    }
  ];
}

function onboard(root, cfg) {
  const home = mkdtempSync(join(tmpdir(), "drift-bench-home-"));
  const repoEnv = { HOME: home, DRIFT_HOME: home };
  const startArgs = ["start", "--repo-root", ".", "--accept-defaults"];
  if (cfg.declaredDataModules) startArgs.push("--data-modules", cfg.declaredDataModules);
  const started = drift(root, repoEnv, ...startArgs);
  if (!started.ok) {
    return { home, repoEnv, repoId: null, error: "ONBOARD_FAILED" };
  }
  const reposDir = join(home, ".drift/repos");
  const repoId = existsSync(reposDir)
    ? execFileSync("ls", [reposDir], { encoding: "utf8" }).trim().split("\n")[0]
    : null;
  return {
    home,
    repoEnv,
    repoId,
    dbEnv: { ...repoEnv },
    db: repoId ? join(reposDir, repoId, "drift.sqlite") : null,
    error: repoId ? null : "REPO_ID_MISSING"
  };
}

/**
 * The parser-gap count for the onboarded scan, read from the check payload's readiness block.
 *
 * Taken from a check rather than a stored scan because that is the number a user is exposed to, and
 * because the check's own collection is what the coverage report (EW-3) describes.
 */
function parserGapCount(root, session, repoId) {
  const result = drift(
    root,
    session.dbEnv,
    "--db",
    session.db,
    "check",
    "--repo",
    repoId,
    "--diff",
    "HEAD",
    "--scope",
    "full",
    "--json"
  );
  try {
    const payload = JSON.parse(result.stdout);
    return {
      parser_gap_count: payload.readiness?.parser_gap_count ?? null,
      import_resolution_rate: payload.summary?.import_coverage?.local_import_resolution_rate ?? null
    };
  } catch {
    return { parser_gap_count: null, import_resolution_rate: null };
  }
}

/**
 * EW-6 (DET-1): do the two scan paths agree about how many facts there are?
 *
 * The scan manifest records the engine's emission count; the facts table holds what was stored.
 * They diverge whenever a fact is dropped between the two, and one class was: identical occurrences
 * on one line hashed to the same id and were silently merged. Measured per repo here rather than
 * only on a fixture, because that drop is content-dependent - a fixture proves the mechanism, seven
 * real repos prove there is not another class of it.
 */
function factCountAgreement(root, session, repoId) {
  const scan = drift(root, session.dbEnv, "--db", session.db, "scan", "--repo-root", ".", "--json");
  if (!scan.ok) {
    return { manifest: null, stored: null, agrees: null };
  }
  let scanId = null;
  try {
    scanId = JSON.parse(scan.stdout).scan?.id ?? null;
  } catch {
    return { manifest: null, stored: null, agrees: null };
  }
  const status = drift(
    root,
    session.dbEnv,
    "--db",
    session.db,
    "scan",
    "status",
    "--repo",
    repoId,
    "--json"
  );
  try {
    const payload = JSON.parse(status.stdout);
    const manifest = payload.latest_scan?.fact_count ?? null;
    const stored = payload.stored_fact_count ?? null;
    return {
      manifest,
      stored,
      agrees: manifest === null || stored === null ? null : manifest === stored,
      scan_id: scanId
    };
  } catch {
    return { manifest: null, stored: null, agrees: null };
  }
}

function evaluateRepo(cfg) {
  const root = join(REPOS_DIR, cfg.name);
  if (!existsSync(root)) {
    return { repo: cfg.name, onboarded: false, error: "MISSING_REPO", edits: [] };
  }

  // EW-7 (DET-2): refuse a contaminated worktree rather than measuring it. Before the reset,
  // because the reset is what destroyed the evidence.
  const contamination = contaminationRefusal(root, cfg.name);
  if (contamination.refused && !contaminationAllowed(process.argv)) {
    console.error(`  REFUSED ${cfg.name}: ${contamination.reason}`);
    return {
      repo: cfg.name,
      onboarded: false,
      error: "CONTAMINATED_WORKTREE",
      contaminated_files: contamination.entries.map((entry) => entry.path),
      edits: []
    };
  }

  resetTree(root);
  const baseCommit = git(root, "rev-parse", "HEAD").trim();
  const session = onboard(root, cfg);
  try {
    if (!session.repoId) {
      return { repo: cfg.name, onboarded: false, error: session.error, edits: [] };
    }
    const coverage = parserGapCount(root, session, session.repoId);
    const factCounts = factCountAgreement(root, session, session.repoId);
    const edits = [];
    for (const edit of ordinaryEdits(cfg)) {
      resetTree(root);
      git(root, "reset", "-q", "--hard", baseCommit);
      let written;
      try {
        written = edit.apply(root);
      } catch (error) {
        edits.push({ id: edit.id, applicable: false, reason: `APPLY_FAILED: ${error.message}` });
        continue;
      }
      if (!written) {
        edits.push({ id: edit.id, applicable: false, reason: "repo shape has no target for this edit" });
        continue;
      }
      git(root, "add", "-A");
      const check = drift(
        root,
        session.dbEnv,
        "--db",
        session.db,
        "check",
        "--repo",
        session.repoId,
        "--diff",
        "HEAD",
        "--scope",
        "changed-files",
        "--json"
      );
      let findings = null;
      let partialCoverage = null;
      try {
        const payload = JSON.parse(check.stdout);
        findings = payload.findings?.length ?? null;
        partialCoverage = payload.summary?.partial_coverage?.complete ?? null;
      } catch {
        /* a refusal may still emit JSON; a crash may not */
      }
      edits.push({
        id: edit.id,
        applicable: true,
        exit: check.code,
        // The metric. Ordinary edits are not violations, so 3 means Drift declined to answer.
        refused: check.code === 3,
        findings_count: findings,
        coverage_complete: partialCoverage
      });
    }
    resetTree(root);
    git(root, "reset", "-q", "--hard", baseCommit);

    const applicable = edits.filter((edit) => edit.applicable);
    return {
      repo: cfg.name,
      onboarded: true,
      error: null,
      parser_gap_count: coverage.parser_gap_count,
      import_resolution_rate: coverage.import_resolution_rate,
      fact_count_manifest: factCounts.manifest,
      fact_count_stored: factCounts.stored,
      fact_counts_agree: factCounts.agrees,
      refused: applicable.filter((edit) => edit.refused).length,
      applicable: applicable.length,
      edits
    };
  } finally {
    rmSync(session.home, { recursive: true, force: true });
    resetTree(root);
  }
}

const selected = only ? EVAL_REPOS.filter((cfg) => only.includes(cfg.name)) : EVAL_REPOS;
if (selected.length === 0) {
  console.error(`No evaluation repos matched --only ${only?.join(",")}`);
  process.exit(1);
}

// BB-2: before the first measured run, not after. This bench records timings into a committed
// baseline, and the 2026-08-03 debug-engine confound proves the harness cannot be trusted to notice
// on its own - a debug engine reports itself as a perfectly healthy `rust` engine.
requireReleaseEngine(ENGINE);

const rows = [];
for (const cfg of selected) {
  const row = evaluateRepo(cfg);
  rows.push(row);
  if (!row.onboarded) {
    console.log(`  SKIP ${row.repo.padEnd(11)} ${row.error}`);
    continue;
  }
  console.log(
    `  ${row.repo.padEnd(11)} refused ${row.refused}/${row.applicable} ordinary edits, ` +
      `${row.parser_gap_count ?? "?"} parser gaps, ` +
      `resolution ${row.import_resolution_rate === null ? "n/a" : `${(row.import_resolution_rate * 100).toFixed(1)}%`}`
  );
  for (const edit of row.edits) {
    if (!edit.applicable) {
      console.log(`      - ${edit.id.padEnd(38)} UNTESTABLE (${edit.reason})`);
    } else if (edit.refused) {
      console.log(`      - ${edit.id.padEnd(38)} REFUSED (exit 3)`);
    }
  }
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const baselineByRepo = new Map(baseline.map((row) => [row.repo, row]));

if (UPDATE) {
  // Merge rather than truncate, so `--only X --update` never drops the other repos' rows.
  const merged = new Map(baselineByRepo);
  for (const row of rows) {
    merged.set(row.repo, row);
  }
  const ordered = EVAL_REPOS.map((cfg) => merged.get(cfg.name)).filter(Boolean);
  writeFileSync(BASELINE, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`\nbaseline updated - ${rows.length} repo(s) written`);
  process.exit(0);
}

const regressions = rows.flatMap((row) => ratchetRegressions(row, baselineByRepo.get(row.repo)))

const totalRefused = rows.reduce((sum, row) => sum + (row.refused ?? 0), 0);
const totalApplicable = rows.reduce((sum, row) => sum + (row.applicable ?? 0), 0);
console.log(
  `\nordinary-edit refusal rate: ${totalRefused}/${totalApplicable} across ${rows.length} repo(s)`
);

if (regressions.length > 0) {
  console.error(`\nratchet failed:\n- ${regressions.join("\n- ")}`);
  process.exit(1);
}

console.log("ratchet ok - no repo regressed");
