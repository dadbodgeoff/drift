#!/usr/bin/env node
/**
 * External evaluation suite.
 *
 * Runs the full Drift loop against real open-source Next.js repos and asserts the
 * behaviours the falsification test pinned down: every repo onboards, the learned
 * contract names the repo's real data layer, an injected direct-DB route is caught
 * with correct file:line evidence, and a properly layered route is not flagged.
 *
 * Output is diffed against scripts/external-eval-baseline.json, so a clean run prints
 * one line and a regression prints only what changed.
 *
 *   node scripts/external-eval.mjs                  # verify against baseline
 *   node scripts/external-eval.mjs --update         # rewrite the baseline
 *   node scripts/external-eval.mjs --only dub,taxonomy
 *
 * Repos are expected at $DRIFT_EVAL_REPOS (default ~/drift-falsification/repos).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repoVerdict } from "./external-eval-predicate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const BASELINE = join(HERE, "external-eval-baseline.json");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

/**
 * dataModule/dataSymbol   real data layer, used for the injected violation
 * cleanModule/cleanSymbol properly layered import, used for the false-positive control
 * expectForbidden         entries that MUST appear in the learned forbidden_imports
 * expectedExitCode        the exit code the main check MUST produce (O-1). Recorded per
 *                         repo, never hardcoded in the predicate, so every transitional
 *                         value is explicit and reviewable here.
 *
 * On the expectedExitCode values (S1-01 transitional): taxonomy, calcom, papermark and
 * midday expect 3 (refused), not 0 or 2. That is S1-01 working, not a regression - an
 * unresolved import on a route in the diff zeroes every finding's enforcement_result, and
 * the check now refuses (exit 3) instead of reporting that as a clean run. These flip when
 * S1-04 lands resolver coverage (nested tsconfig + workspace packages), which makes those
 * imports resolvable: block-mode repos to 2, warn-mode repos to 0. Do not "fix" a 3 here
 * by reverting S1-01.
 */
const REPOS = [
  {
    name: "taxonomy",
    routeDir: "app/api",
    dataModule: "@/lib/db",
    dataSymbol: "db",
    cleanModule: "@/lib/session",
    cleanSymbol: "getCurrentUser",
    expectForbidden: ["@/lib/db"],
    expectForbiddenExact: ["@/lib/db"],
    expectedExitCode: 3
  },
  {
    name: "dub",
    routeDir: "apps/web/app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/api/errors",
    cleanSymbol: "handleAndReturnErrorResponse",
    expectForbidden: ["@/lib/prisma"],
    expectedExitCode: 0
  },
  {
    name: "formbricks",
    routeDir: "apps/web/app/api",
    dataModule: "@formbricks/database",
    dataSymbol: "prisma",
    cleanModule: "@/app/lib/api/response",
    cleanSymbol: "responses",
    expectForbidden: ["@formbricks/database"],
    expectForbiddenExact: ["@formbricks/database"],
    // E-2 transitional: was 2. Resolver coverage (pnpm-workspace.yaml) made
    // @formbricks/database imports resolve, which exposed the S1-05 residual class:
    // member-level symbol resolution stays conservative (unresolved_import_symbol on
    // route files, e.g. Prisma re-exports through packages/database/src/prisma.ts), so
    // S1-01 now refuses (3) where it previously blocked on specifier string-matching (2).
    // Pre-registered in TDD S1-05 ("S1-01 will keep refusing where it could legitimately
    // block"). Flips back to 2 when E-5 makes those symbols provable at runtime.
    expectedExitCode: 3
  },
  {
    name: "calcom",
    routeDir: "apps/web/app/api",
    dataModule: "@calcom/prisma",
    dataSymbol: "prisma",
    cleanModule: "@calcom/lib/constants",
    cleanSymbol: "WEBAPP_URL",
    expectForbidden: ["@calcom/prisma"],
    expectForbiddenExact: ["@calcom/prisma"],
    expectedExitCode: 3
  },
  {
    name: "papermark",
    routeDir: "app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/utils",
    cleanSymbol: "cn",
    expectForbidden: ["@/lib/prisma"],
    expectedExitCode: 3
  },
  {
    // T01: the only repo whose data layer defeats the substring whitelist in
    // is_data_access_source. Without it the suite passes whether or not F4 exists, because
    // every other repo names its data layer prisma/db/database. `whitelistIndependent`
    // switches on the F4 assertions in evaluateRepo.
    name: "midday",
    routeDir: "apps/dashboard/src/app/api",
    dataModule: "@midday/supabase/server",
    dataSymbol: "createClient",
    cleanModule: "@midday/utils/sanitize-redirect",
    // The module exports sanitizeRedirectPath. Importing a symbol that does not exist made the
    // clean control route unresolvable, which correctly suppressed blocking for the whole check.
    cleanSymbol: "sanitizeRedirectPath",
    expectForbidden: ["@midday/supabase/server"],
    whitelistIndependent: true,
    declaredDataModules: "@midday/supabase/server,@midday/supabase/cached-queries",
    expectDiscoveryWrapper: "packages/supabase/src/client/server.ts",
    expectedExitCode: 3
  },
  {
    name: "openstatus",
    routeDir: "apps/dashboard/src/app/api",
    dataModule: "@openstatus/db",
    dataSymbol: "db",
    cleanModule: "@openstatus/api",
    cleanSymbol: "edgeRouter",
    expectForbidden: ["@openstatus/db"],
    expectForbiddenExact: ["@openstatus/db", "@openstatus/db/src/db", "@openstatus/db/src/schema"],
    // E-3 transitional: was 2. Deep workspace globs (packages/**/*) made @openstatus/db
    // imports resolve to packages/db/src/index.ts, whose exports are all `export *`
    // re-exports - the injected route's `db` import now trips the conservative
    // member-level symbol gate (unresolved_import_symbol), so S1-01 refuses (3) where
    // specifier string-matching used to block (2). Same S1-05 residual class as
    // formbricks under E-2; flips back to 2 when E-5 lands.
    expectedExitCode: 3
  }
];

// O-1: the exit-code assertion fails closed (a missing expectation is a FAIL), so refuse
// to even start with a suite repo that lacks one - the failure should name the config gap,
// not surface as a per-repo FAIL an hour into a run.
for (const cfg of REPOS) {
  if (!Number.isInteger(cfg.expectedExitCode)) {
    console.error(`REPOS entry "${cfg.name}" has no integer expectedExitCode; every suite repo must record one.`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

/**
 * T06: evaluate a repo that is not in the suite, for triaging user reports without
 * committing to the baseline. Results are printed but never compared or written.
 *
 *   node scripts/external-eval.mjs --repo-path <dir> --data-module <spec> \
 *     --data-symbol <sym> --route-dir <dir> [--clean-module <spec>] [--declare <specs>] \
 *     [--expect-exit-code <n>]
 *
 * The exit-code assertion fails closed: without --expect-exit-code the ad-hoc result is
 * FAIL with `exit_code_expectation_recorded` named, so the printed record still shows
 * every measured field for triage.
 */
const AD_HOC = flag("--repo-path");
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };
delete env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function drift(cwd, extraEnv, ...a) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...a], {
      cwd,
      encoding: "utf8",
      env: { ...env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024
    });
    return { ok: true, stdout, stderr: "", code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
      code: error.status ?? 1
    };
  }
}


/**
 * Re-check with only the injected violation present.
 *
 * Returns whether the finding's enforcement_result equals the contract's enforcement_mode, or
 * null when there is nothing to compare. Isolated because the negative controls in the main check
 * deliberately import non-existent modules, which suppresses blocking for the whole check.
 */
function enforcementInIsolation(root, dbEnv, repoId, cfg, enforcementMode) {
  resetTree(root);
  const badPath = writeRoute(root, cfg.routeDir, "drift-eval-enforce", cfg.dataModule, cfg.dataSymbol);
  git(root, "add", "-A");
  const run = drift(root, dbEnv, "check", "--diff", "HEAD", "--scope", "changed-hunks", "--repo", repoId, "--json");
  let verdict = null;
  try {
    const payload = JSON.parse(run.stdout);
    const finding = (payload.findings ?? []).find((entry) =>
      (entry.evidence_refs ?? []).some((ref) => ref.file_path === badPath)
    );
    verdict =
      finding && enforcementMode ? finding.enforcement_result === enforcementMode : null;
  } catch {
    verdict = null;
  }
  resetTree(root);
  return verdict;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return join(dir, "route.ts");
}

function writeRoute(root, relDir, sub, module, symbol) {
  const dir = join(root, relDir, sub);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "route.ts"),
    `import { NextResponse } from "next/server";\n` +
      `import { ${symbol} } from "${module}";\n\n` +
      `export async function GET() {\n` +
      `  return NextResponse.json({ ok: String(${symbol}) });\n` +
      `}\n`
  );
  return `${relDir}/${sub}/route.ts`;
}

/**
 * Return the repo to a pristine checkout of HEAD.
 *
 * `git clean` alone is not enough: it does not remove files that are staged, and the
 * injection step stages the routes it writes so they appear in `git diff HEAD`. A
 * clean-only reset therefore leaked injected routes between runs, which then got
 * committed as part of the base tree and made the injection look undetected. The hard
 * reset drops the index as well.
 */
function resetTree(root) {
  try {
    git(root, "reset", "-q", "--hard", "HEAD");
    git(root, "clean", "-qfd");
  } catch {
    /* best effort */
  }
}

function evaluateRepo(cfg) {
  return evaluateRepoAt(REPOS_DIR, cfg);
}

function evaluateRepoAt(reposDir, cfg) {
  const root = join(reposDir, cfg.name);
  const result = { repo: cfg.name };
  if (!existsSync(root)) {
    return { ...result, status: "MISSING_REPO" };
  }

  resetTree(root);

  // Fresh Drift state per repo: onboarding is part of what we measure.
  const home = mkdtempSync(join(tmpdir(), "drift-eval-home-"));
  const repoEnv = { HOME: home, DRIFT_HOME: home };

  // T02: for a repo whose data layer the whitelist cannot see, first prove the F4 gap is
  // actually exercised - inference alone must find no data-access convention, and A6
  // discovery must name the wrapper anyway. Without this the repo is in the suite but
  // tests nothing it was added for.
  if (cfg.whitelistIndependent) {
    const probeHome = mkdtempSync(join(tmpdir(), "drift-eval-probe-"));
    const probe = drift(
      root,
      { HOME: probeHome, DRIFT_HOME: probeHome },
      "start",
      "--repo-root",
      ".",
      "--accept-defaults",
      "--json"
    );
    try {
      const payload = JSON.parse(probe.stdout);
      const discovery = payload.data_layer_discovery;
      result.inference_alone_found_data_layer = discovery === undefined;
      result.discovery_named_data_layer = Boolean(
        discovery?.suggestions?.some((s) => s.filePath === cfg.expectDiscoveryWrapper)
      );
      result.discovery_reason = discovery?.reason ?? null;
    } catch {
      result.inference_alone_found_data_layer = null;
      result.discovery_named_data_layer = false;
      result.discovery_reason = "probe_unparseable";
    }
    rmSync(probeHome, { recursive: true, force: true });
    resetTree(root);
  }

  const started = Date.now();
  const startArgs = ["start", "--repo-root", ".", "--accept-defaults"];
  if (cfg.declaredDataModules) {
    startArgs.push("--data-modules", cfg.declaredDataModules);
  }
  const start = drift(root, repoEnv, ...startArgs);
  result.onboard_seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  result.onboarded = start.ok;

  if (!start.ok) {
    result.status = "ONBOARD_FAILED";
    result.error = (start.stderr || start.stdout).trim().split("\n")[0]?.slice(0, 300);
    rmSync(home, { recursive: true, force: true });
    return result;
  }

  const repoId = start.stdout.match(/repos\/(repo_[a-f0-9]+)\//)?.[1] ?? null;
  result.repo_id = repoId;
  result.files = Number(start.stdout.match(/Scanned (\d+) files/)?.[1] ?? 0);
  result.facts = Number(start.stdout.match(/Stored (\d+) facts/)?.[1] ?? 0);
  result.candidates = Number(start.stdout.match(/Found (\d+) convention candidate/)?.[1] ?? 0);
  result.baselined = Number(start.stdout.match(/Baselined (\d+) existing violation/)?.[1] ?? 0);

  const dbEnv = { ...repoEnv, DRIFT_DB: join(home, ".drift/repos", repoId ?? "", "drift.sqlite") };

  const contractRun = drift(root, dbEnv, "contract", "show", "--repo", repoId, "--json");
  let forbidden = [];
  try {
    const conventions = JSON.parse(contractRun.stdout).contract.conventions;
    const dataConvention = conventions.find((c) => c.kind === "api_route_no_direct_data_access");
    forbidden = dataConvention?.matcher?.forbidden_imports ?? [];
    result.enforcement_mode = dataConvention?.enforcement_mode ?? null;
  } catch {
    result.enforcement_mode = null;
  }
  result.forbidden_imports = [...forbidden].sort();
  result.contract_names_real_data_layer = cfg.expectForbidden.every((want) =>
    forbidden.includes(want)
  );
  // T14: pin the exact set where it is known. expectForbidden alone only proves the real data
  // layer is present, so it would not notice over-matching creeping back - cal.com carried four
  // wrong entries out of six while passing that check.
  result.forbidden_imports_exact_match =
    cfg.expectForbiddenExact === undefined
      ? null
      : JSON.stringify([...cfg.expectForbiddenExact].sort()) === JSON.stringify(result.forbidden_imports);

  // Injection and clean control land in the same diff. No commit is needed: the tree is
  // already a pristine HEAD checkout, and `git diff HEAD` includes staged new files.
  // Committing here would permanently mutate the eval repos.
  const badPath = writeRoute(root, cfg.routeDir, "drift-eval-bad", cfg.dataModule, cfg.dataSymbol);
  const cleanPath = writeRoute(
    root,
    cfg.routeDir,
    "drift-eval-clean",
    cfg.cleanModule,
    cfg.cleanSymbol
  );

  // T03 negative controls. The suite proved detection but never restraint: a rule that
  // flagged everything would satisfy every other assertion here. Each of these is a route
  // that must NOT be flagged, and each pins a specific fix against real repos rather than
  // fixtures.
  //
  //   type-only  - A3/F5: `import type` from the data module is erased at compile time and
  //                creates no runtime dependency.
  //   lookalike  - B3: `<dataModule>-legacy` must not match a forbidden `<dataModule>`,
  //                which bare substring matching got wrong.
  //   subpath    - B3 the other way: a *genuine* subpath of the data module must still be
  //                caught, so the boundary fix did not overshoot into a false negative.
  const typeOnlyPath = `${cfg.routeDir}/drift-eval-typeonly/route.ts`;
  writeFileSync(
    ensureDir(join(root, cfg.routeDir, "drift-eval-typeonly")),
    `import { NextResponse } from "next/server";\n` +
      `import type { ${cfg.dataSymbol} } from "${cfg.dataModule}";\n\n` +
      `export async function GET() {\n` +
      `  const value: ${cfg.dataSymbol} | undefined = undefined;\n` +
      `  return NextResponse.json({ ok: value === undefined });\n` +
      `}\n`
  );
  const lookalikePath = writeRoute(
    root,
    cfg.routeDir,
    "drift-eval-lookalike",
    `${cfg.dataModule}-legacy`,
    cfg.dataSymbol
  );
  const subpathPath = writeRoute(
    root,
    cfg.routeDir,
    "drift-eval-subpath",
    `${cfg.dataModule}/internal`,
    cfg.dataSymbol
  );

  git(root, "add", "-A");

  const check = drift(
    root,
    dbEnv,
    "check",
    "--diff",
    "HEAD",
    "--scope",
    "changed-files",
    "--repo",
    repoId,
    "--json"
  );
  // O-1: the exit code is asserted against the per-repo expectation, not merely recorded.
  // See the expectedExitCode note on REPOS for why several repos legitimately expect 3.
  result.check_exit_code = check.code;
  result.expected_exit_code = cfg.expectedExitCode ?? null;
  try {
    const payload = JSON.parse(check.stdout);
    const findings = payload.findings ?? [];
    result.check_status = payload.check?.status ?? null;
    result.engine_source = payload.check?.fallback_status?.engine_source ?? null;
    result.fallback_used = payload.check?.fallback_status?.fallback_used ?? null;
    result.can_block = payload.check?.capability_completeness?.can_block ?? null;
    result.findings_count = findings.length;
    result.blocking_count = payload.summary?.blocking_count ?? 0;

    const hasPath = (finding, path) =>
      (finding.evidence_refs ?? []).some((ref) => ref.file_path === path);
    const onBad = findings.filter((finding) => hasPath(finding, badPath));
    const onClean = findings.filter((finding) => hasPath(finding, cleanPath));
    const evidence = onBad[0]?.evidence_refs?.[0];

    result.injection_caught = onBad.length > 0;
    // The violating import is always line 2 of the generated route.
    result.injection_evidence_correct =
      evidence?.start_line === 2 && evidence?.import_source === cfg.dataModule;
    // O-1 attribution: the evidence the finding leads with must name the injected route
    // itself. `injection_caught` only proves SOME evidence ref touches the route; a finding
    // attributed to an intermediate barrel would still satisfy it (the papermark artifact).
    result.injected_route = badPath;
    result.injection_evidence_file = evidence?.file_path ?? null;
    result.injection_diff_status = onBad[0]?.diff_status ?? null;
    result.injection_enforcement = onBad[0]?.enforcement_result ?? null;
    result.injection_finding_status = onBad[0]?.status ?? null;
    // Enforcement is measured in a SEPARATE check containing only the injected violation.
    //
    // It cannot be measured in the check above, and that is by construction rather than by
    // accident: the lookalike and subpath probes must import modules that do not exist in order
    // to be negative controls, and an unresolvable import on a route in scope legitimately makes
    // capability coverage incomplete. The engine then declines to block anything - correctly, and
    // the contract enforces it (`blocking findings require complete capability coverage`).
    //
    // So the previously recorded mismatch on taxonomy, cal.com, papermark and midday was the
    // harness suppressing the very thing it was trying to observe. Product behaviour is right.
    result.enforcement_matches_mode = enforcementInIsolation(root, dbEnv, repoId, cfg, result.enforcement_mode);
    result.clean_control_false_positive = onClean.length > 0;
    result.fp_type_only_import = findings.some((f) => hasPath(f, typeOnlyPath));
    result.fp_lookalike_module = findings.some((f) => hasPath(f, lookalikePath));
    result.catches_genuine_subpath = findings.some((f) => hasPath(f, subpathPath));
  } catch {
    result.check_status = "UNPARSEABLE";
  }

  resetTree(root);
  rmSync(home, { recursive: true, force: true });

  const verdict = repoVerdict(result, cfg);
  result.status = verdict.status;
  if (verdict.failures.length) {
    result.failed_assertions = verdict.failures;
  }
  return result;
}

// Counts move as upstream repos change; compared for reporting only, not for regressions.
/**
 * T04: onboarding time is compared against a generous ceiling rather than exactly, so a
 * real regression fails while ordinary upstream growth does not. The ceiling comes from the
 * baseline (3x, floor 30s) because absolute numbers differ per machine.
 */
function performanceCeiling(baselineSeconds) {
  return Math.max(30, Math.round((baselineSeconds ?? 0) * 3));
}

const VOLATILE = new Set([
  "onboard_seconds",
  "repo_id",
  "files",
  "facts",
  "candidates",
  "baselined"
]);

function diffResult(before, after) {
  const changes = [];
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    if (key === "repo" || VOLATILE.has(key)) continue;
    const a = JSON.stringify(before?.[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) changes.push(`${key}: ${a ?? "(absent)"} -> ${b}`);
  }
  return changes;
}

/**
 * Disk preflight. Each repo's evaluation builds a fresh Drift state in a temp HOME, and for a
 * large repo that reaches ~1 GB. Exhausting the disk mid-run does not fail cleanly: it
 * produces false test failures and a raw "database or disk is full" from SQLite, so results
 * become untrustworthy rather than merely incomplete. Refuse up front instead.
 */
function freeSpaceGb() {
  try {
    const out = execFileSync("df", ["-k", REPOS_DIR], { encoding: "utf8" }).trim().split("\n").pop();
    const available = Number(out.split(/\s+/)[3]);
    return Number.isFinite(available) ? available / 1024 / 1024 : Infinity;
  } catch {
    return Infinity;
  }
}

const MIN_FREE_GB = 5;
const free = freeSpaceGb();
if (free < MIN_FREE_GB) {
  console.error(
    `Refusing to run: ${free.toFixed(1)} GB free, need ${MIN_FREE_GB} GB.\n` +
      `Each repo builds a fresh Drift state (~1 GB for the largest). Free space with:\n` +
      `  rm -rf ~/.drift /tmp/drift-eval-*`
  );
  process.exit(3);
}

if (!existsSync(CLI)) {
  console.error(`Missing CLI build at ${CLI}. Run: pnpm build`);
  process.exit(1);
}
if (!existsSync(ENGINE)) {
  console.error(`Missing engine at ${ENGINE}. Run: cargo build --release -p drift-engine`);
  process.exit(1);
}

if (AD_HOC) {
  const { basename, dirname: parentOf } = await import("node:path");
  const adHocCfg = {
    name: basename(AD_HOC),
    routeDir: flag("--route-dir") ?? "app/api",
    dataModule: flag("--data-module") ?? "",
    dataSymbol: flag("--data-symbol") ?? "db",
    cleanModule: flag("--clean-module") ?? "next/server",
    cleanSymbol: "NextResponse",
    expectForbidden: flag("--data-module") ? [flag("--data-module")] : [],
    ...(flag("--declare") ? { declaredDataModules: flag("--declare") } : {}),
    ...(flag("--expect-exit-code") !== undefined
      ? { expectedExitCode: Number(flag("--expect-exit-code")) }
      : {})
  };
  if (!adHocCfg.dataModule) {
    console.error("--repo-path requires --data-module");
    process.exit(1);
  }
  // evaluateRepo resolves the repo under REPOS_DIR, so point that at the parent.
  process.env.DRIFT_EVAL_REPOS = parentOf(AD_HOC);
  const adHocResult = evaluateRepoAt(parentOf(AD_HOC), adHocCfg);
  console.log(JSON.stringify(adHocResult, null, 2));
  process.exit(adHocResult.status === "PASS" ? 0 : 1);
}

const results = REPOS.filter((cfg) => !only || only.includes(cfg.name)).map((cfg) => {
  const r = evaluateRepo(cfg);
  console.log(
    `  ${r.status === "PASS" ? "ok  " : "FAIL"} ${r.repo.padEnd(11)}` +
      ` onboard=${r.onboarded ? "y" : "n"}` +
      ` contract=${r.contract_names_real_data_layer ? "y" : "n"}` +
      ` injected=${r.injection_caught ? "y" : "n"}` +
      ` evidence=${r.injection_evidence_correct ? "y" : "n"}` +
      ` cleanFP=${r.clean_control_false_positive ? "YES" : "no"}` +
      ` neg=${r.fp_type_only_import === false && r.fp_lookalike_module === false ? "ok" : "FP"}` +
      ` subpath=${r.catches_genuine_subpath ? "y" : "n"}` +
      (r.discovery_named_data_layer !== undefined
        ? ` f4gap=${r.inference_alone_found_data_layer === false && r.discovery_named_data_layer ? "y" : "n"}`
        : "") +
      ` (${r.onboard_seconds ?? "?"}s)` +
      (r.error ? `\n       ${r.error}` : "") +
      (r.failed_assertions ? `\n       failed: ${r.failed_assertions.join(", ")}` : "")
  );
  return r;
});

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify(results, null, 2)}\n`);
  const passing = results.filter((r) => r.status === "PASS").length;
  console.log(`\nbaseline updated - ${passing}/${results.length} passing`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const byName = new Map(baseline.map((r) => [r.repo, r]));
const changed = [];
for (const after of results) {
  const before = byName.get(after.repo);
  const ceiling = performanceCeiling(before?.onboard_seconds);
  if (before && after.onboard_seconds > ceiling) {
    changed.push(
      `  ${after.repo}:`,
      `    onboard_seconds: ${before.onboard_seconds} -> ${after.onboard_seconds} (exceeds ${ceiling}s ceiling)`
    );
    after.status = "FAIL";
  }
  const changes = diffResult(before, after);
  if (changes.length) {
    changed.push(`  ${after.repo}:`);
    for (const line of changes) changed.push(`    ${line}`);
  }
}

const failing = results.filter((r) => r.status !== "PASS");
if (!changed.length && !failing.length) {
  console.log(`\nno change vs baseline - ${results.length}/${results.length} passing`);
  process.exit(0);
}
if (changed.length) {
  console.log("\nchanged vs baseline:");
  console.log(changed.join("\n"));
}
if (failing.length) {
  console.log(`\n${failing.length} repo(s) failing: ${failing.map((r) => r.repo).join(", ")}`);
}
process.exit(1);
