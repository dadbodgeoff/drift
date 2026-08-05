#!/usr/bin/env node
/**
 * CV-4: measured precision and recall for presence-only family enforcement.
 *
 * **Why this exists rather than an extension of something.** CV-4's red #6 says to "run the full
 * 200-fixture precision/recall harness extended with 50 wrapper-present / 50 wrapper-absent fixtures
 * per promoted kind" and cites the data-access kind as having earned 1.000/1.000 through it. There is
 * no such harness. `scripts/evasion-matrix.mjs` measures 13 shapes across 7 repos (91 cells) and
 * classifies each as caught/silent/evaded; `test/fixtures/` holds 70 fixture repos exercised for
 * behaviour, not scored; and no precision or recall figure appears in any baseline in this repo,
 * for any kind. The premise was stale, so this measures the thing the item wanted rather than
 * extending a harness that was not there.
 *
 * **What is measured, and why it is honest.** Ground truth comes from construction, not from Drift.
 * Into each eval repo whose auth family forms, this injects two sets of routes:
 *
 *   - WRAPPER-ABSENT: a route that calls no family member. Ground truth: should be reported.
 *     Missing one is a false negative, so this set measures RECALL.
 *   - WRAPPER-PRESENT: a route that calls one family member, cycling through every member and
 *     through the shapes CV-4 pins (plain, renamed import, barrel re-export, namespace import).
 *     Ground truth: should be silent. Reporting one is a false positive, so this set measures
 *     PRECISION.
 *
 * Both sets are injected in the same run and the two are never conflated: a reported absent route is
 * a true positive, a reported present route is a false positive, an unreported absent route is a
 * false negative. Nothing here asks Drift what the answer is and then scores Drift against it.
 *
 * **What it deliberately does not claim.** These fixtures are synthetic and the presence semantics
 * are simple, so a high score here says the matcher does what it says on the shapes enumerated - it
 * does NOT say the tier catches unprotected routes. The residuals are in
 * docs/architecture/beta-claims.json: a guard called after its sink passes, and a same-named symbol
 * from an unrelated module passes. Those are excluded from the fixture sets on purpose, because
 * scoring a documented non-catch as a failure would make this number mean something it does not.
 *
 * Usage:
 *   node scripts/presence-precision-recall.mjs            # measure, compare to baseline
 *   node scripts/presence-precision-recall.mjs --update    # rewrite the baseline
 *   node scripts/presence-precision-recall.mjs --only dub
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
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? new Set(args[onlyIndex + 1].split(",").map((name) => name.trim()))
    : null;

/** 50 of each per repo, as the item specifies. */
const PER_SET = 50;

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };

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
 * Restore the pinned tree. Hard reset, not clean: `git clean` does not remove staged files, and a
 * killed run leaves injected routes staged - which is how a *detected* injection once read as
 * undetected.
 */
function resetTree(root) {
  git(root, "reset", "--hard", "HEAD");
  git(root, "clean", "-fd");
}

/**
 * The four import shapes CV-4 pins as satisfying presence, cycled across the present set so the
 * measurement covers them rather than repeating the easy one 50 times.
 */
function presentRoute(member, shape, index) {
  const body = (call) =>
    `export const GET = ${call}(async () => new Response("ok"));\n`;
  switch (shape) {
    case "renamed":
      return `import { ${member} as w${index} } from "@/lib/auth";\n` + body(`w${index}`);
    case "barrel":
      // The route imports from a barrel; presence keys on the imported symbol, not the specifier.
      return `import { ${member} } from "@/lib";\n` + body(member);
    case "namespace":
      return `import * as authNs${index} from "@/lib/auth";\n` + body(`authNs${index}.${member}`);
    default:
      return `import { ${member} } from "@/lib/auth";\n` + body(member);
  }
}

function absentRoute(index) {
  // Calls something real so the route is not trivially empty, but nothing in the family.
  return (
    `export async function GET() {\n` +
    `  const n = ${index};\n` +
    `  return new Response(String(n));\n` +
    `}\n`
  );
}

function writeRoute(root, relative, contents) {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

/** The accepted presence family for this repo, or null when none formed. */
function acceptAuthFamily(root, repoId, databasePath) {
  const listed = drift(
    root,
    "--db", databasePath, "conventions", "list",
    "--repo", repoId, "--include-low-confidence", "--json"
  );
  if (listed.exit !== 0) return null;
  let payload;
  try {
    payload = JSON.parse(listed.stdout);
  } catch {
    return null;
  }
  const family = (payload.candidates ?? []).find(
    (candidate) =>
      candidate.kind === "api_route_requires_auth_helper" &&
      candidate.matcher?.enforcement_semantics === "presence"
  );
  if (!family) return null;

  const accepted = drift(
    root,
    "--db", databasePath, "conventions", "accept", family.id,
    "--repo", repoId, "--mode", "warn", "--severity", "warning",
    "--actor", "cv4-harness", "--confirm", "--json"
  );
  if (accepted.exit !== 0) return null;
  return {
    conventionId: `convention_${family.id.replace(/^candidate_/, "")}`,
    members: family.matcher.required_calls ?? [],
    flavors: family.matcher.applies_to_route_flavors ?? []
  };
}

function measureRepo(cfg) {
  const root = join(REPOS_DIR, cfg.name);
  if (!existsSync(root)) {
    return { repo: cfg.name, status: "MISSING_REPO" };
  }
  resetTree(root);
  const stateRoot = join("/tmp", `drift-cv4-${cfg.name}`);
  rmSync(stateRoot, { recursive: true, force: true });

  try {
    const started = drift(
      root,
      "start", "--repo-root", root, "--state-root", stateRoot,
      "--accept-defaults", "--json"
    );
    if (started.exit !== 0) return { repo: cfg.name, status: "ONBOARD_FAILED" };
    const startPayload = JSON.parse(started.stdout);
    const repoId = startPayload.repo.id;
    const databasePath = startPayload.state.database_path;

    const family = acceptAuthFamily(root, repoId, databasePath);
    if (!family) {
      // Honest and expected on most repos: CV-1 measured a family on dub and papermark only. A repo
      // with no family is not a failure and is not scored.
      return { repo: cfg.name, status: "NO_FAMILY", family_formed: false };
    }

    // Inject into the repo's own route directory so the routes are genuinely in scope, and - when the
    // family is flavour-conditioned - into a path of the flavour it covers.
    const base = `${cfg.routeDir}/drift-cv4`;
    const present = [];
    const absent = [];
    const shapes = ["plain", "renamed", "barrel", "namespace"];
    for (let index = 0; index < PER_SET; index += 1) {
      const member = family.members[index % family.members.length];
      const shape = shapes[index % shapes.length];
      const presentPath = `${base}-present-${index}/route.ts`;
      writeRoute(root, presentPath, presentRoute(member, shape, index));
      present.push({ path: presentPath, member, shape });

      const absentPath = `${base}-absent-${index}/route.ts`;
      writeRoute(root, absentPath, absentRoute(index));
      absent.push({ path: absentPath });
    }
    // A barrel that re-exports every member, so the barrel-shaped present routes resolve.
    writeRoute(
      root,
      "lib/index.ts",
      family.members.map((member) => `export { ${member} } from "@/lib/auth";\n`).join("")
    );

    const checked = drift(
      root,
      "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
    );
    let payload;
    try {
      payload = JSON.parse(checked.stdout);
    } catch {
      return { repo: cfg.name, status: "CHECK_UNPARSEABLE" };
    }

    const reported = new Set(
      (payload.findings ?? [])
        .filter((finding) => finding.convention_id === family.conventionId)
        .flatMap((finding) => (finding.evidence_refs ?? []).map((ref) => ref.file_path))
    );

    const truePositives = absent.filter((route) => reported.has(route.path)).length;
    const falseNegatives = absent.length - truePositives;
    const falsePositives = present.filter((route) => reported.has(route.path));

    const precision =
      truePositives + falsePositives.length === 0
        ? null
        : truePositives / (truePositives + falsePositives.length);
    const recall = absent.length === 0 ? null : truePositives / absent.length;

    return {
      repo: cfg.name,
      status: "MEASURED",
      family_formed: true,
      family_members: family.members.length,
      family_flavors: family.flavors,
      wrapper_absent_fixtures: absent.length,
      wrapper_present_fixtures: present.length,
      true_positives: truePositives,
      false_negatives: falseNegatives,
      false_positives: falsePositives.length,
      // Named, so a regression says which shape broke rather than only that the number moved.
      false_positive_shapes: [...new Set(falsePositives.map((route) => route.shape))].sort(),
      precision: precision === null ? null : Number(precision.toFixed(4)),
      recall: recall === null ? null : Number(recall.toFixed(4))
    };
  } finally {
    resetTree(root);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

const repos = EVAL_REPOS.filter((cfg) => !only || only.has(cfg.name));
const rows = repos.map((cfg) => {
  const row = measureRepo(cfg);
  const label =
    row.status === "MEASURED"
      ? `precision=${row.precision} recall=${row.recall} (${row.wrapper_present_fixtures} present / ${row.wrapper_absent_fixtures} absent, fp=${row.false_positives}, fn=${row.false_negatives})`
      : row.status;
  console.log(`  ${row.repo.padEnd(11)} ${label}`);
  return row;
});

const measured = rows.filter((row) => row.status === "MEASURED");
console.log(
  `\n${measured.length} of ${rows.length} repo(s) have an auth family to measure` +
    (measured.length === 0 ? " - nothing scored" : "")
);
// Never let "no family formed" read as a pass. A run that scored nothing is not a green run.
if (measured.length === 0 && !UPDATE) {
  console.error("No repo produced a presence family, so precision and recall are unmeasured.");
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
const byRepo = new Map(baseline.map((row) => [row.repo, row]));
let failed = false;
for (const row of rows) {
  const previous = byRepo.get(row.repo);
  if (!previous) {
    console.error(`  ${row.repo}: absent from the baseline`);
    failed = true;
    continue;
  }
  for (const field of ["status", "precision", "recall", "false_positives", "false_negatives"]) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(row[field])) {
      console.error(
        `  ${row.repo}: ${field} ${JSON.stringify(previous[field])} -> ${JSON.stringify(row[field])}`
      );
      failed = true;
    }
  }
}
if (failed) {
  console.error("\npresence precision/recall changed vs baseline");
  process.exit(1);
}
console.log("no change vs baseline");
