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
 */
const REPOS = [
  {
    name: "taxonomy",
    routeDir: "app/api",
    dataModule: "@/lib/db",
    dataSymbol: "db",
    cleanModule: "@/lib/session",
    cleanSymbol: "getCurrentUser",
    expectForbidden: ["@/lib/db"]
  },
  {
    name: "dub",
    routeDir: "apps/web/app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/api/errors",
    cleanSymbol: "handleAndReturnErrorResponse",
    expectForbidden: ["@/lib/prisma"]
  },
  {
    name: "formbricks",
    routeDir: "apps/web/app/api",
    dataModule: "@formbricks/database",
    dataSymbol: "prisma",
    cleanModule: "@/app/lib/api/response",
    cleanSymbol: "responses",
    expectForbidden: ["@formbricks/database"]
  },
  {
    name: "calcom",
    routeDir: "apps/web/app/api",
    dataModule: "@calcom/prisma",
    dataSymbol: "prisma",
    cleanModule: "@calcom/lib/constants",
    cleanSymbol: "WEBAPP_URL",
    expectForbidden: ["@calcom/prisma"]
  },
  {
    name: "papermark",
    routeDir: "app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/utils",
    cleanSymbol: "cn",
    expectForbidden: ["@/lib/prisma"]
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
    cleanSymbol: "sanitizeRedirect",
    expectForbidden: ["@midday/supabase/server"],
    whitelistIndependent: true,
    declaredDataModules: "@midday/supabase/server,@midday/supabase/cached-queries",
    expectDiscoveryWrapper: "packages/supabase/src/client/server.ts"
  },
  {
    name: "openstatus",
    routeDir: "apps/dashboard/src/app/api",
    dataModule: "@openstatus/db",
    dataSymbol: "db",
    cleanModule: "@openstatus/api",
    cleanSymbol: "edgeRouter",
    expectForbidden: ["@openstatus/db"]
  }
];

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
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
  const root = join(REPOS_DIR, cfg.name);
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
  result.check_exit_code = check.code;
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
    result.injection_diff_status = onBad[0]?.diff_status ?? null;
    result.injection_enforcement = onBad[0]?.enforcement_result ?? null;
    result.injection_finding_status = onBad[0]?.status ?? null;
    // Recorded, not yet asserted. On midday the contract materialises with
    // enforcement_mode "block" but the finding comes back "none", while the same
    // injection run by hand returns "block". Until that is explained this field is
    // diagnostic only - see the run log entry for T01c. Promoting it to an assertion is
    // the right end state: a block-mode convention that does not block is an F3-class
    // silent failure.
    result.enforcement_matches_mode =
      result.enforcement_mode === null || onBad.length === 0
        ? null
        : result.injection_enforcement === result.enforcement_mode;
    result.clean_control_false_positive = onClean.length > 0;
  } catch {
    result.check_status = "UNPARSEABLE";
  }

  resetTree(root);
  rmSync(home, { recursive: true, force: true });

  const f4AssertionsHold =
    !cfg.whitelistIndependent ||
    // The F4 gap is *exercised* when inference alone finds nothing and discovery names the
    // wrapper anyway. Asserting inference succeeds would assert the bug is absent, which is
    // the opposite of what this repo is here to prove.
    (result.inference_alone_found_data_layer === false && result.discovery_named_data_layer === true);

  result.status =
    result.onboarded &&
    f4AssertionsHold &&
    result.contract_names_real_data_layer &&
    result.injection_caught &&
    result.injection_evidence_correct &&
    !result.clean_control_false_positive &&
    result.engine_source === "rust" &&
    result.fallback_used === false
      ? "PASS"
      : "FAIL";
  return result;
}

// Counts move as upstream repos change; compared for reporting only, not for regressions.
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

if (!existsSync(CLI)) {
  console.error(`Missing CLI build at ${CLI}. Run: pnpm build`);
  process.exit(1);
}
if (!existsSync(ENGINE)) {
  console.error(`Missing engine at ${ENGINE}. Run: cargo build --release -p drift-engine`);
  process.exit(1);
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
      (r.discovery_named_data_layer !== undefined
        ? ` f4gap=${r.inference_alone_found_data_layer === false && r.discovery_named_data_layer ? "y" : "n"}`
        : "") +
      ` (${r.onboard_seconds ?? "?"}s)` +
      (r.error ? `\n       ${r.error}` : "")
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
  const changes = diffResult(byName.get(after.repo), after);
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
