#!/usr/bin/env node
/**
 * Detection breadth gate (W7).
 *
 * Runs the engine's scan over each pinned corpus repo and ratchets what it managed to SEE against
 * scripts/detection-breadth-baseline.json. See detection-breadth-predicate.mjs for why this exists
 * beside external-eval rather than inside it, and for the per-field direction rules.
 *
 *   node scripts/detection-breadth.mjs                    # verify against baseline
 *   node scripts/detection-breadth.mjs --update           # rewrite the baseline
 *   node scripts/detection-breadth.mjs --only dub,taxonomy
 *
 * Repos are expected at $DRIFT_EVAL_REPOS (default ~/drift-falsification/repos), the same place
 * external-eval reads them from, and the repo list is EVAL_REPOS so the two can never disagree
 * about what is under test (O-3).
 *
 * This runs `scan-repo` only, not the full onboarding loop. Everything it measures is a property of
 * extraction, and a scan takes seconds where onboarding takes minutes - so this gate can run on
 * every corpus repo where the end-to-end suite has to be budgeted.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { breadthVerdict, mergeBreadthRows } from "./detection-breadth-predicate.mjs";
import { EVAL_REPOS } from "./eval-repos.mjs";
import { contaminationAllowed, contaminationRefusal } from "./worktree-contamination.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const BASELINE = join(HERE, "detection-breadth-baseline.json");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((value) => value.trim()).filter(Boolean)
    : null;

/**
 * A route file that no folder named `api` sits above (D-H2).
 *
 * Deliberately computed from the file path here rather than asked of the engine. The engine's
 * answer is what is under test, and a gate that asks the thing under test whether it is right
 * measures nothing - the F3/BB-11 lesson applied to a harness.
 */
function isOutsideAnyApiFolder(filePath) {
  return !filePath.split("/").includes("api");
}

/**
 * The committed stack fixture, measured alongside the corpus and never optional.
 *
 * The seven corpus repos cannot cover D-H3, and the reason is worth recording: openstatus IS a
 * Drizzle app, but its package is `@openstatus/db`, so the pre-W7 vocabulary caught it by accident
 * through the `/db` clause. Every other repo names its data layer prisma or database. So a suite
 * built only from those seven passes whether or not the engine can see Drizzle at all - which is
 * exactly the state W7 found it in.
 *
 * This fixture is version-controlled, needs no network, and is shaped to the gaps: a Drizzle client
 * in a package called `store`, TypeORM and Kysely modules, two route handlers outside any folder
 * called `api`, a mixed inline/list export file and a list-only one, JSX in a `.js` file, Markdown
 * under a `.ts` extension, and an Express router in a `route.ts` that must NOT become a Next route.
 * The real repos remain the reality check; this is the coverage check, and neither substitutes for
 * the other.
 */
const FIXTURE_REPO = {
  name: "fixture-stacks",
  root: join(REPO_ROOT, "test/fixtures/detection-breadth-stacks"),
  /**
   * What the LEARNED contract must forbid, checked against the product's own output rather than
   * against a name heuristic.
   *
   * This is the D-H3 assertion and it has to be made this way. `data_layer_specifiers` below is a
   * name-hint count, and a data layer called `store` matches no hint by construction - that is the
   * entire point of the fixture. The only honest question to ask of it is the one the product
   * exists to answer: run the loop, and see whether the contract names the repo's real data layer.
   * Before D-H3 this fixture produced no data-access convention at all.
   */
  expectForbidden: ["@stacks/drizzle", "@stacks/kysely"]
};

function measureRepo(name, explicitRoot, expectForbidden) {
  const root = explicitRoot ?? join(REPOS_DIR, name);
  if (!existsSync(root)) {
    // The fixture is committed, so its absence is a broken checkout rather than a missing corpus.
    return { repo: name, status: explicitRoot ? "MISSING_REPO" : "SKIPPED_NO_CORPUS" };
  }

  // EW-7 (DET-2): refuse a contaminated worktree rather than measuring it. A number from a repo
  // another process was editing is not a slightly wrong number, it is a number about a different
  // repo, and recording it in a baseline looks like measurement.
  const contamination = explicitRoot
    ? { refused: false, entries: [] }
    : contaminationRefusal(root, name);
  if (contamination.refused && !contaminationAllowed(process.argv)) {
    return {
      repo: name,
      status: "CONTAMINATED_WORKTREE",
      contaminated_files: contamination.entries.map((entry) => entry.path)
    };
  }

  let payload;
  try {
    const stdout = execFileSync(ENGINE, ["scan-repo", root, "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    payload = JSON.parse(stdout);
  } catch (error) {
    return { repo: name, status: "SCAN_FAILED", error: String(error.message).slice(0, 200) };
  }

  const facts = payload.facts ?? [];
  const diagnostics = payload.diagnostics ?? [];

  const routeFiles = [
    ...new Set(
      facts
        .filter((fact) => fact.kind === "file_role_detected" && fact.name === "api_route")
        .map((fact) => fact.file_path)
    )
  ].sort();
  const routeFileSet = new Set(routeFiles);

  // The distinct import specifiers that route files pull their data layer from. This is the D-H3
  // quantity: a repo whose data layer the vocabulary cannot name contributes nothing here, however
  // many routes it has.
  const dataLayerSpecifiers = [
    ...new Set(
      facts
        .filter(
          (fact) =>
            fact.kind === "import_used" &&
            routeFileSet.has(fact.file_path) &&
            typeof fact.value === "string" &&
            looksLikeDataLayer(fact.value)
        )
        .map((fact) => fact.value)
    )
  ].sort();

  const countCode = (code) => diagnostics.filter((entry) => entry.code === code).length;

  return {
    repo: name,
    ...(expectForbidden ? learnedForbiddenImports(root, expectForbidden) : {}),
    status: "OK",
    route_files: routeFiles.length,
    route_files_outside_api: routeFiles.filter(isOutsideAnyApiFolder).length,
    exported_symbols: facts.filter((fact) => fact.kind === "exported_symbol").length,
    data_layer_specifiers_count: dataLayerSpecifiers.length,
    data_layer_specifiers: dataLayerSpecifiers,
    unresolved_import_symbol: countCode("unresolved_import_symbol"),
    unresolved_import: countCode("unresolved_import"),
    partial_parse: countCode("partial_parse")
  };
}

/**
 * The harness's own view of what a data-layer specifier looks like, kept independent of both
 * implementations under test.
 *
 * Broader than either on purpose: this is a *recall floor*, so it should over-collect. If the
 * engine's vocabulary narrows, the specifiers it stops reporting drop out of the measured set and
 * the ratchet fires. Matching the engine's own predicate here would make the gate agree with
 * whatever the engine currently believes, which is not a gate.
 */
const DATA_LAYER_HINTS = [
  "prisma",
  "drizzle",
  "typeorm",
  "sequelize",
  "kysely",
  "supabase",
  "mongoose",
  "knex",
  "database",
  "/db",
  "data-access"
];

/**
 * Run the full onboarding loop over the fixture and read back what the contract forbids.
 *
 * Only the fixture gets this: it is a dozen files and onboards in under a second, where a corpus
 * repo takes minutes and is already covered end to end by scripts/external-eval.mjs. Fresh state in
 * a temp HOME per run, because whether onboarding infers this at all is exactly the question.
 */
function learnedForbiddenImports(root, expectForbidden) {
  const home = mkdtempSync(join(tmpdir(), "drift-breadth-home-"));
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(REPO_ROOT, "packages/cli/dist/main.js"), "start", "--repo-root", ".", "--accept-defaults", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, HOME: home, DRIFT_HOME: home, DRIFT_ENGINE_BIN: ENGINE },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024
      }
    );
    const payload = JSON.parse(stdout);
    const convention = (payload.candidates ?? []).find(
      (candidate) => candidate.kind === "api_route_no_direct_data_access"
    );
    const learned = [...(convention?.matcher?.forbidden_imports ?? [])].sort();
    return {
      learned_forbidden_imports: learned,
      learned_contract_names_data_layer: expectForbidden.every((want) => learned.includes(want))
    };
  } catch (error) {
    return {
      learned_forbidden_imports: [],
      learned_contract_names_data_layer: false,
      learned_error: String(error.message).slice(0, 200)
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function looksLikeDataLayer(specifier) {
  const lower = specifier.toLowerCase();
  if (lower.includes("@prisma/client/runtime")) {
    return false;
  }
  return DATA_LAYER_HINTS.some((hint) => lower.includes(hint)) || lower.endsWith("db");
}

if (!existsSync(ENGINE)) {
  console.error(`Missing engine at ${ENGINE}. Run: cargo build --release -p drift-engine`);
  process.exit(1);
}

const suite = [
  FIXTURE_REPO,
  ...EVAL_REPOS.map((cfg) => ({ name: cfg.name, root: undefined }))
];
const results = suite
  .filter((entry) => !only || only.includes(entry.name))
  .map((entry) => measureRepo(entry.name, entry.root, entry.expectForbidden));

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const byRepo = new Map(baseline.map((row) => [row.repo, row]));

const verdicts = results.map((row) => ({ row, verdict: breadthVerdict(row, byRepo.get(row.repo)) }));

for (const { row, verdict } of verdicts) {
  console.log(
    `  ${verdict.status === "PASS" ? "ok  " : verdict.status.padEnd(4)} ${row.repo.padEnd(11)}` +
      ` routes=${row.route_files ?? "?"}(${row.route_files_outside_api ?? "?"} outside api)` +
      ` exports=${row.exported_symbols ?? "?"}` +
      ` dataLayers=${row.data_layer_specifiers_count ?? "?"}` +
      ` unresolvedSym=${row.unresolved_import_symbol ?? "?"}` +
      ` partialParse=${row.partial_parse ?? "?"}` +
      (verdict.failures.length ? `\n       failed: ${verdict.failures.join(", ")}` : "")
  );
  for (const move of verdict.moves) {
    console.log(`       ${move}`);
  }
}

if (UPDATE) {
  // A FAILING verdict is refused with no write, matching external-eval's O-4 rule: an update is a
  // record of a movement someone read, not a way to make red go away.
  const failing = verdicts.filter(({ verdict }) => verdict.status === "FAIL");
  if (failing.length) {
    console.error("\nrefusing to update the breadth baseline - these are regressions, not movement:");
    for (const { row, verdict } of failing) {
      console.error(`  ${row.repo}: ${verdict.failures.join(", ")}`);
    }
    console.error("\nIf a fall is genuinely correct, say why in the commit and remove the recorded");
    console.error("row for that repo so it re-baselines as NEW - do not widen the predicate.");
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify(mergeBreadthRows(baseline, results), null, 2)}\n`);
  console.log(`\nbreadth baseline updated - ${results.length} repo(s)`);
  process.exit(0);
}

const bad = verdicts.filter(({ verdict }) => verdict.status !== "PASS");
if (bad.length === 0) {
  console.log(`\nno breadth change vs baseline - ${results.length}/${results.length} passing`);
  process.exit(0);
}
console.log(`\n${bad.length} repo(s) not passing: ${bad.map(({ row }) => row.repo).join(", ")}`);
process.exit(1);
