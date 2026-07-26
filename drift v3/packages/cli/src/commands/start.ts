import { BETA_START_RESPONSE_SCHEMA } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { doctorCommand } from "../args/doctor-commands.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { runFullRepoCheck } from "../check/run-check.js";
import { createBaselineForFindings } from "../domain/baselines.js";
import { betaStartResponse } from "../domain/beta-surfaces.js";
import { materializeRepoContract } from "../domain/contract-materialization.js";
import { acceptDefaultCandidate,declaredDataModulesCandidate } from "../domain/convention-candidates.js";
import { engineProvenance } from "../domain/engine-provenance.js";
import { discoverDataLayer,packageManifestPathsFromFiles } from "../domain/data-layer-discovery.js";
import { contractIdForRepo } from "../domain/identifiers.js";
import { checkDiskSpace,insufficientDiskMessage } from "../domain/disk-space.js";
import { DriftError } from "../app/drift-error.js";
import { dirname } from "node:path";
import { runScanRepo } from "../domain/scan-status.js";
import { currentMachineContractVersions,doctorV1Scope } from "../domain/versions.js";

export async function startRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<CommandPayload> {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();

  // Refuse before scanning rather than failing mid-write. Running out of space during a scan
  // leaves a partially written database and surfaces a raw SQLite error, and subsequent
  // operations then report failures unrelated to the repo. Exit 3 is the fail-closed refusal
  // code: enforcement could not be performed, so nothing is claimed about the repo.
  const databasePath = requiredDatabasePath(parsed);
  const diskSpace = checkDiskSpace(databasePath);
  if (!diskSpace.sufficient) {
    // Typed so the failure classifier reports insufficient_disk rather than inferring a code
    // from prose. This is a refusal, not an error: nothing is claimed about the repo.
    throw new DriftError(insufficientDiskMessage(diskSpace, dirname(databasePath)), {
      code: "insufficient_disk",
      userAction: "Free disk space for Drift's local state, then retry.",
      recoveryCommands: ["drift doctor --repo-root . --json"],
      safeToRetry: true
    });
  }
  const result = await runScanRepo(storage, {
    now,
    repoRoot: resolveRepoRoot(parsed),
    actor: actorFlag(parsed),
    databasePath: requiredDatabasePath(parsed)
  });
  const actor = actorFlag(parsed);
  // A6: `--data-modules` supplies the data layer inference could not name. The declared
  // candidate is persisted and accepted through the identical path as an inferred one,
  // so evidence, baselining and contract materialization all behave the same.
  const declaredModules = (stringFlag(parsed, "data-modules") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const declaredCandidate =
    declaredModules.length > 0 &&
    !result.candidates.some((entry) => entry.kind === "api_route_no_direct_data_access")
      ? declaredDataModulesCandidate({
          repoId: result.repo.id,
          scanId: result.scan.id,
          repoRoot: result.repo.root_path,
          now,
          declaredModules,
          facts: storage.listFacts(result.scan.id)
        })
      : undefined;
  if (declaredCandidate) {
    storage.upsertConventionCandidate(declaredCandidate);
    result.candidates.unshift(declaredCandidate);
    result.summary.candidates_count = result.candidates.length;
  }
  const candidate = result.candidates[0];
  const accepted = parsed.flags.has("accept-defaults") && candidate
    ? acceptDefaultCandidate(storage, { now, actor }, candidate)
    : undefined;
  const defaultContract = parsed.flags.has("accept-defaults") && !accepted
    ? storage.transaction(() => {
        const contract = materializeRepoContract(storage, result.repo.id, contractIdForRepo(result.repo.id), now);
        storage.upsertRepoContract(contract);
        return contract;
      })
    : undefined;
  // F4: candidate inference only recognises data layers whose import specifier contains
  // prisma/database/db/data-access, so a repo using Supabase - or Drizzle behind a module
  // called `store`, `repository` or `models` - produced zero candidates with the
  // violation in plain sight, and said nothing about why. A silent zero is
  // indistinguishable from "this repo has no convention to enforce".
  //
  // When no data-access candidate was inferred, fall back to something that does not
  // depend on local naming: the ORM or driver declared in package.json, traced through
  // the repo's own imports to the local module that wraps it. Report it as a suggestion
  // to declare, never as an enforced contract.
  const inferredDataAccess = result.candidates.some(
    (candidate) => candidate.kind === "api_route_no_direct_data_access"
  );
  const dataLayerDiscovery = inferredDataAccess
    ? undefined
    : discoverDataLayer(
        result.repo.root_path,
        packageManifestPathsFromFiles(
          storage.listFileSnapshots(result.repo.id, result.scan.id).map((snapshot) => snapshot.file_path)
        ),
        storage
          .listFacts(result.scan.id, { kind: "import_used" })
          .map((fact) => ({ file_path: fact.file_path, value: fact.value, name: fact.name }))
      );

  const contractReady = Boolean(accepted || defaultContract || storage.getRepoContract(result.repo.id));
  const initialFindings = accepted
    ? runFullRepoCheck(storage, parsed, result.repo.id, result.scan.completed_at ?? result.scan.started_at)
    : [];
  const baselinedCount = accepted
    ? createBaselineForFindings(storage, { now, actor }, result.repo.id, initialFindings).created_count
    : 0;
  const nextCommands = contractReady
    ? [
        doctorCommand(result.repo.root_path, parsed),
        `drift scan status --repo ${result.repo.id}`,
        `drift contract show --repo ${result.repo.id}`,
        `drift baseline status --repo ${result.repo.id}`,
        `drift prepare "task" --repo ${result.repo.id} --json`,
        `drift check --diff main...HEAD --repo ${result.repo.id} --scope changed-hunks`,
        `drift backup create --repo ${result.repo.id} --confirm`
      ]
    : [
        `drift conventions list --repo ${result.repo.id} --status candidate`,
        candidate
          ? `drift conventions accept ${candidate.id} --severity error --mode block --confirm`
          : "drift scan",
        `drift check --diff main...HEAD --repo ${result.repo.id} --scope changed-hunks`
      ];
  const onboardingPayload = {
    response_schema: BETA_START_RESPONSE_SCHEMA,
    ...result,
    summary: {
      ...result.summary,
      engine_source: betaStartEngineSource(result.summary.engine_source)
    },
    accepted,
    baselined_count: baselinedCount,
    machine_contract_versions: currentMachineContractVersions(result.scan.adapter_versions),
    engine: engineProvenance(),
    v1_scope: doctorV1Scope(),
    onboarding: {
      status: contractReady ? "ready" : candidate ? "needs_convention_review" : "needs_more_signal",
      accepted_default: Boolean(accepted),
      contract_ready: contractReady,
      baselined_count: baselinedCount,
      candidate_count: result.candidates.length
    },
    ...(dataLayerDiscovery
      ? {
          data_layer_discovery: {
            inferred_data_access_convention: false,
            declared_packages: dataLayerDiscovery.declaredPackages,
            suggestions: dataLayerDiscovery.suggestions,
            reason:
              dataLayerDiscovery.suggestions.length > 0
                ? "no_data_access_candidate_inferred_but_data_layer_found"
                : dataLayerDiscovery.declaredPackages.length > 0
                  ? "data_dependency_declared_but_no_local_wrapper_reached_by_routes"
                  : "no_data_dependency_declared"
          }
        }
      : {}),
    state: {
      repo_id: result.repo.id,
      repo_root: result.repo.root_path,
      database_path: result.database_path
    },
    next_commands: nextCommands
  };
  const text = [
    "Drift is ready for this repo.",
    "",
    `Scanned ${result.summary.files_indexed} files.`,
    `Stored ${result.summary.facts_count} facts.`,
    `Found ${result.summary.candidates_count} convention candidate${result.summary.candidates_count === 1 ? "" : "s"}.`,
    ...(accepted ? [
      "",
      "Accepted default convention.",
      `Baselined ${baselinedCount} existing violation${baselinedCount === 1 ? "" : "s"}.`,
      "Ready for AI-assisted work."
    ] : []),
    "",
    candidate
      ? [
          "Top candidate:",
          `  ${candidate.id}`,
          `  ${candidate.statement}`,
          `  Evidence: ${candidate.scoring.supporting_examples_count} matching import${candidate.scoring.supporting_examples_count === 1 ? "" : "s"}.`
        ].join("\n")
      : noCandidateText(dataLayerDiscovery),
    // Surface the data-layer gap even when some *other* convention was inferred. Gating
    // this on "no candidates at all" hid it on every real repo that infers an auth-helper
    // or validation candidate, which is most of them - the F4 gap stayed silent exactly
    // where it mattered.
    ...(dataLayerDiscovery && candidate ? ["", noCandidateText(dataLayerDiscovery)] : []),
    "",
    "State:",
    `  export DRIFT_DB=${result.database_path}`,
    "",
    "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");

  return {
    payload: parsed.flags.has("json") ? betaStartResponse(onboardingPayload) : text
  };
}

function betaStartEngineSource(engineSource: "rust" | "typescript"): "rust" | "typescript_fallback" {
  return engineSource === "rust" ? "rust" : "typescript_fallback";
}

/**
 * What to say when inference produced no enforceable data-access convention.
 *
 * "No enforceable convention candidates found yet." was indistinguishable from "this
 * repo has no convention to enforce", which is what made F4 invisible: a Supabase repo
 * with a route calling the database directly got the same message as a perfectly layered
 * one. If a data layer was found structurally, name it and give the command to declare it.
 */
function noCandidateText(discovery?: {
  declaredPackages: string[];
  suggestions: Array<{ filePath: string; packageName: string; importedAs: string[]; routeImporterCount: number }>;
}): string {
  if (!discovery) {
    return "No enforceable convention candidates found yet.";
  }
  if (discovery.suggestions.length > 0) {
    const lines = [
      "No data-access convention was inferred, but a data layer was found.",
      "",
      "Inference only recognises data modules named like prisma/database/db. These were",
      "found instead by tracing your declared dependencies through your own imports:"
    ];
    for (const suggestion of discovery.suggestions.slice(0, 5)) {
      lines.push(
        `  ${suggestion.filePath}  (wraps ${suggestion.packageName}; imported by ${suggestion.routeImporterCount} route${suggestion.routeImporterCount === 1 ? "" : "s"} as ${suggestion.importedAs.join(", ")})`
      );
    }
    lines.push(
      "",
      "To enforce layering on it:",
      `  drift start --repo-root . --accept-defaults --data-modules "${discovery.suggestions
        .slice(0, 3)
        .flatMap((suggestion) => suggestion.importedAs)
        .join(",")}"`
    );
    return lines.join("\n");
  }
  if (discovery.declaredPackages.length > 0) {
    return [
      "No data-access convention was inferred.",
      "",
      `Declared data dependencies: ${discovery.declaredPackages.join(", ")}.`,
      "No local module wrapping them is imported by an API route, so there is nothing to",
      "enforce yet. Declare one explicitly with --data-modules if that is wrong."
    ].join("\n");
  }
  return [
    "No enforceable convention candidates found yet.",
    "",
    "No database or ORM dependency was found in package.json, so Drift has nothing to",
    "infer a data-layer convention from. Declare one with --data-modules if it is",
    "vendored or reached another way."
  ].join("\n");
}
