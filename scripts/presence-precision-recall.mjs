#!/usr/bin/env node
/**
 * CV-4: measured precision and recall per convention kind, per eval repo.
 *
 * **Provenance, corrected.** CV-4's red #6 says to extend "the full 200-fixture precision/recall
 * harness", citing the data-access kind's 1.000/1.000 as prior art. That measurement was real, but it
 * was a SESSION ARTIFACT of the 2026-08-03 benchmark - methodology recorded in the bench artifact, raw
 * data since gone - and never repo infrastructure. Citing it as extendable was the planner's error, not
 * a false claim about the product.
 *
 * So this file is where that number now lives: reproducible, committed, re-measured on every run. It is
 * also why data-access is one of the kinds below rather than only the new ones. A claim whose evidence
 * exists solely in a past session's scrollback is indistinguishable from an unevidenced claim the moment
 * anyone asks, which is the failure mode the claims ledger exists to prevent.
 *
 * **What is measured, and why it is honest.** Ground truth comes from construction, never from Drift.
 * Per kind, per repo where that kind's convention exists, two fixture sets are injected in one run:
 *
 *   - COMPLIANT: routes that satisfy the convention. Ground truth: silent. Reporting one is a false
 *     positive, so this set measures PRECISION.
 *   - VIOLATING: routes that break it. Ground truth: reported. Missing one is a false negative, so this
 *     set measures RECALL.
 *
 * The two are never conflated, and nothing here asks Drift what the answer is and then scores Drift
 * against it.
 *
 * **What it does not claim.** These fixtures are synthetic and enumerate the shapes the matcher says it
 * handles, so a high score says the matcher does what it says on those shapes - not that the tier
 * catches unprotected routes. The presence residuals are in docs/architecture/beta-claims.json (a guard
 * called after its sink passes; a same-named symbol from an unrelated module passes) and are excluded
 * from the fixture sets on purpose: scoring a documented non-catch as a failure would make this number
 * mean something it does not.
 *
 * The "evasion cells green 7/7 repos" phrasing in CV-4's DoD is void, per Geoffrey: a presence family
 * exists on one or two repos, not seven. Shape coverage is unit-level in
 * crates/drift-engine/tests/presence_enforcement_cv3.rs; this is the per-repo measurement where a
 * convention actually exists.
 *
 * Usage:
 *   node scripts/presence-precision-recall.mjs                  # measure, compare to baseline
 *   node scripts/presence-precision-recall.mjs --update          # rewrite the baseline
 *   node scripts/presence-precision-recall.mjs --only dub        # one repo
 *   node scripts/presence-precision-recall.mjs --kind auth       # one kind
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_REPOS } from "./eval-repos.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const BASELINE = join(HERE, "presence-precision-recall-baseline.json");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const listFlag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1]
    ? new Set(args[index + 1].split(",").map((value) => value.trim()))
    : null;
};
const only = listFlag("--only");
const onlyKind = listFlag("--kind");

/** 50 of each per repo per kind, as the item specifies. */
const PER_SET = 50;

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };

const PRESENCE_SHAPES = ["plain", "renamed", "barrel", "namespace"];

/**
 * A route satisfying a presence family, cycling the four shapes CV-4 pins as satisfying.
 *
 * The module is read from the accepted convention rather than hardcoded: dub's auth family resolves
 * under `@/lib/auth` and its rate-limit family under `@/lib/upstash`, and a harness that assumed one
 * would score the other's compliant fixtures as violations.
 */
function presenceCompliantRoute(ctx, index) {
  const member = ctx.members[index % ctx.members.length];
  const shape = PRESENCE_SHAPES[index % PRESENCE_SHAPES.length];
  const body = (call) => `export const GET = ${call}(async () => new Response("ok"));\n`;
  switch (shape) {
    case "renamed":
      return `import { ${member} as w${index} } from "${ctx.module}";\n` + body(`w${index}`);
    case "barrel":
      // Presence keys on the imported symbol, not the specifier, so a barrel is transparent.
      return `import { ${member} } from "${ctx.barrelSpecifier}";\n` + body(member);
    case "namespace":
      return `import * as ns${index} from "${ctx.module}";\n` + body(`ns${index}.${member}`);
    default:
      return `import { ${member} } from "${ctx.module}";\n` + body(member);
  }
}

/** A route importing nothing of interest. Not trivially empty, so it is a real route. */
function plainRoute(index) {
  return (
    `export async function GET() {\n` +
    `  const n = ${index};\n` +
    `  return new Response(String(n));\n` +
    `}\n`
  );
}

/**
 * The kinds measured, and how a compliant and a violating route is built for each.
 *
 * `requiresAccept` is true for the presence families because `--accept-defaults` only auto-accepts
 * those clearing CV-5's floor. Pinning this harness to that floor would make the measurement depend on
 * a threshold it exists to be independent of - dub's rate-limit family is below the floor and is
 * measured here anyway.
 */
const KINDS = [
  {
    id: "api_route_requires_auth_helper",
    label: "auth",
    requiresAccept: true,
    presence: true,
    compliant: presenceCompliantRoute,
    violating: (_ctx, index) => plainRoute(index)
  },
  {
    id: "api_route_requires_rate_limit",
    label: "rate-limit",
    requiresAccept: true,
    presence: true,
    compliant: presenceCompliantRoute,
    violating: (_ctx, index) => plainRoute(index)
  },
  {
    id: "api_route_no_direct_data_access",
    label: "data-access",
    requiresAccept: false,
    presence: false,
    // Compliant imports nothing forbidden; violating imports the repo's real data layer, which is the
    // same ground truth external-eval injects.
    compliant: (_ctx, index) => plainRoute(index),
    violating: (ctx, index) =>
      `${ctx.dataImport}\n` +
      `export async function GET() {\n` +
      `  const __h = ${ctx.dataSymbol}; void __h;\n` +
      `  const n = ${index};\n` +
      `  return new Response(String(n));\n` +
      `}\n`
  }
];

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function drift(cwd, ...a) {
  try {
    return {
      exit: 0,
      stdout: execFileSync("node", [CLI, ...a], { cwd, env, encoding: "utf8", maxBuffer: 1 << 28 })
    };
  } catch (error) {
    return { exit: error.status ?? 1, stdout: error.stdout ?? "" };
  }
}

/**
 * Restore the pinned tree. Hard reset, not clean: `git clean` does not remove staged files, and a killed
 * run leaves injected routes staged - which is how a *detected* injection once read as undetected.
 */
function resetTree(root) {
  git(root, "reset", "--hard", "HEAD");
  git(root, "clean", "-fd");
}

function writeRoute(root, relative, contents) {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The repo's own import form for its data layer, matching what external-eval injects. */
function dataImportFor(cfg) {
  return cfg.dataImportKind === "default"
    ? `import ${cfg.dataSymbol} from "${cfg.dataModule}";`
    : `import { ${cfg.dataSymbol} } from "${cfg.dataModule}";`;
}

/**
 * Find this kind's convention, accepting the candidate first when the kind needs it.
 *
 * Returns null when the repo has no such convention - which is a legitimate and common outcome, not a
 * harness failure, and is reported as NO_CONVENTION rather than scored.
 */
function conventionFor(kind, root, repoId, databasePath) {
  const accepted = parseJson(
    drift(root, "--db", databasePath, "conventions", "list", "--repo", repoId,
      "--status", "accepted", "--json").stdout
  );
  const alreadyAccepted = (accepted?.candidates ?? []).find(
    (entry) => entry.kind === kind.id
  );
  if (alreadyAccepted) {
    return conventionContext(kind, alreadyAccepted);
  }
  if (!kind.requiresAccept) {
    return null;
  }
  const listed = parseJson(
    drift(root, "--db", databasePath, "conventions", "list", "--repo", repoId,
      "--include-low-confidence", "--json").stdout
  );
  const candidate = (listed?.candidates ?? []).find(
    (entry) => entry.kind === kind.id && entry.matcher?.enforcement_semantics === "presence"
  );
  if (!candidate) {
    return null;
  }
  const result = drift(
    root, "--db", databasePath, "conventions", "accept", candidate.id,
    "--repo", repoId, "--mode", "warn", "--severity", "warning",
    "--actor", "cv4-harness", "--confirm", "--json"
  );
  if (result.exit !== 0) {
    return null;
  }
  return conventionContext(kind, candidate);
}

function conventionContext(kind, candidate) {
  const members = candidate.matcher?.required_calls ?? [];
  // The module the members come from, taken from the family's own recorded helpers.
  const helperKey = ["auth_helpers", "rate_limit_helpers", "validators"].find(
    (key) => Array.isArray(candidate.requires?.[key])
  );
  const helper = helperKey ? candidate.requires[helperKey][0] : undefined;
  return {
    conventionId: candidate.id.startsWith("candidate_")
      ? `convention_${candidate.id.slice("candidate_".length)}`
      : candidate.id,
    members,
    module: helper?.import ?? helper?.module ?? "@/lib/auth",
    flavors: candidate.matcher?.applies_to_route_flavors ?? []
  };
}

function measureKind(kind, cfg, root, repoId, databasePath) {
  const convention = conventionFor(kind, root, repoId, databasePath);
  if (!convention || (kind.presence && convention.members.length === 0)) {
    return { kind: kind.label, status: "NO_CONVENTION" };
  }
  const ctx = {
    ...convention,
    barrelSpecifier: `@/drift-cv4-barrel-${kind.label}`,
    dataImport: dataImportFor(cfg),
    dataSymbol: cfg.dataSymbol
  };

  const base = `${cfg.routeDir}/drift-cv4-${kind.label}`;
  const compliant = [];
  const violating = [];
  for (let index = 0; index < PER_SET; index += 1) {
    const compliantPath = `${base}-ok-${index}/route.ts`;
    writeRoute(root, compliantPath, kind.compliant(ctx, index));
    compliant.push(compliantPath);

    const violatingPath = `${base}-bad-${index}/route.ts`;
    writeRoute(root, violatingPath, kind.violating(ctx, index));
    violating.push(violatingPath);
  }
  if (kind.presence) {
    // A barrel re-exporting every member, so the barrel-shaped compliant routes resolve.
    writeRoute(
      root,
      `drift-cv4-barrel-${kind.label}.ts`,
      ctx.members.map((member) => `export { ${member} } from "${ctx.module}";\n`).join("")
    );
  }

  const checked = drift(
    root, "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
  );
  const payload = parseJson(checked.stdout);
  if (!payload) {
    return { kind: kind.label, status: "CHECK_UNPARSEABLE" };
  }
  const reported = new Set(
    (payload.findings ?? [])
      .filter((finding) => finding.convention_id === convention.conventionId)
      .flatMap((finding) => (finding.evidence_refs ?? []).map((ref) => ref.file_path))
  );

  const truePositives = violating.filter((path) => reported.has(path)).length;
  const falseNegatives = violating.length - truePositives;
  const falsePositives = compliant.filter((path) => reported.has(path));
  const precision =
    truePositives + falsePositives.length === 0
      ? null
      : truePositives / (truePositives + falsePositives.length);
  const recall = violating.length === 0 ? null : truePositives / violating.length;

  return {
    kind: kind.label,
    status: "MEASURED",
    convention_kind: kind.id,
    members: convention.members.length,
    flavors: convention.flavors,
    compliant_fixtures: compliant.length,
    violating_fixtures: violating.length,
    true_positives: truePositives,
    false_negatives: falseNegatives,
    false_positives: falsePositives.length,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    recall: recall === null ? null : Number(recall.toFixed(4))
  };
}

function measureRepo(cfg) {
  const root = join(REPOS_DIR, cfg.name);
  if (!existsSync(root)) {
    return { repo: cfg.name, status: "MISSING_REPO", kinds: [] };
  }
  const kinds = KINDS.filter((kind) => !onlyKind || onlyKind.has(kind.label));
  const rows = [];
  for (const kind of kinds) {
    // One onboarding per kind, so the injected fixtures of one kind never sit in the scan another
    // kind is measured against.
    resetTree(root);
    const stateRoot = join("/tmp", `drift-cv4-${cfg.name}-${kind.label}`);
    rmSync(stateRoot, { recursive: true, force: true });
    try {
      const started = drift(
        root, "start", "--repo-root", root, "--state-root", stateRoot,
        "--accept-defaults", "--json"
      );
      const startPayload = started.exit === 0 ? parseJson(started.stdout) : null;
      if (!startPayload) {
        rows.push({ kind: kind.label, status: "ONBOARD_FAILED" });
        continue;
      }
      rows.push(
        measureKind(kind, cfg, root, startPayload.repo.id, startPayload.state.database_path)
      );
    } finally {
      resetTree(root);
      rmSync(stateRoot, { recursive: true, force: true });
    }
  }
  return { repo: cfg.name, status: "OK", kinds: rows };
}

const repos = EVAL_REPOS.filter((cfg) => !only || only.has(cfg.name));
const rows = repos.map((cfg) => {
  const row = measureRepo(cfg);
  for (const kind of row.kinds) {
    const label =
      kind.status === "MEASURED"
        ? `precision=${kind.precision} recall=${kind.recall} (${kind.compliant_fixtures} ok / ${kind.violating_fixtures} bad, fp=${kind.false_positives}, fn=${kind.false_negatives})`
        : kind.status;
    console.log(`  ${row.repo.padEnd(11)} ${kind.kind.padEnd(12)} ${label}`);
  }
  if (row.kinds.length === 0) {
    console.log(`  ${row.repo.padEnd(11)} ${row.status}`);
  }
  return row;
});

const measured = rows.flatMap((row) => row.kinds.filter((kind) => kind.status === "MEASURED"));
console.log(`\n${measured.length} kind/repo cell(s) measured`);
// Never let "nothing formed" read as a pass. A run that scored nothing is not a green run.
if (measured.length === 0 && !UPDATE) {
  console.error("No convention was available to measure, so precision and recall are unmeasured.");
  process.exit(1);
}

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`baseline written to ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Run with --update once, then commit it.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const baselineCell = new Map();
for (const row of baseline) {
  for (const kind of row.kinds ?? []) {
    baselineCell.set(`${row.repo}/${kind.kind}`, kind);
  }
}
let failed = false;
for (const row of rows) {
  for (const kind of row.kinds) {
    const key = `${row.repo}/${kind.kind}`;
    const previous = baselineCell.get(key);
    if (!previous) {
      console.error(`  ${key}: absent from the baseline`);
      failed = true;
      continue;
    }
    for (const field of ["status", "precision", "recall", "false_positives", "false_negatives"]) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(kind[field])) {
        console.error(
          `  ${key}: ${field} ${JSON.stringify(previous[field])} -> ${JSON.stringify(kind[field])}`
        );
        failed = true;
      }
    }
  }
}
if (failed) {
  console.error("\nprecision/recall changed vs baseline");
  process.exit(1);
}
console.log("no change vs baseline");
