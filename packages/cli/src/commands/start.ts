import { BETA_START_RESPONSE_SCHEMA,isExperimentalSecurityKind,isPromotedPresenceConvention,presenceAutoAcceptDecision } from "@drift/core";
import type { Finding } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { doctorCommand } from "../args/doctor-commands.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { runCheck,runFullRepoCheck } from "../check/run-check.js";
import { createBaselineForFindings } from "../domain/baselines.js";
import { betaStartResponse } from "../domain/beta-surfaces.js";
import { materializeRepoContract } from "../domain/contract-materialization.js";
import { acceptanceDisclosure,acceptanceDisclosureLines } from "../domain/acceptance-disclosure.js";
import { acceptDefaultCandidate,declaredDataModulesCandidate } from "../domain/convention-candidates.js";
import { engineProvenance } from "../domain/engine-provenance.js";
import { discoverDataLayer,packageManifestPathsFromFiles } from "../domain/data-layer-discovery.js";
import { contractIdForRepo } from "../domain/identifiers.js";
import { checkDiskSpace,checkHeadroom,insufficientDiskMessage,insufficientHeapMessage } from "../domain/disk-space.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { workingTreeChangedFiles } from "../io/git.js";
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

  // Heap preflight, before the scan rather than during it. The Node CLI peaks around 19x the
  // Rust engine's memory doing storage and graph assembly, and when it runs out V8 kills the
  // process with a raw FATAL ERROR and exit 134 - no Drift error, no guidance, and a partially
  // written database. Constrained CI runners cap the heap routinely, so this is a real setup.
  const repoRootForHeap = stringFlag(parsed, "repo-root");
  if (repoRootForHeap) {
    const fileCount = walkIndexableFiles(repoRootForHeap).length;
    const headroom = checkHeadroom(fileCount);
    if (!headroom.sufficient) {
      throw new DriftError(insufficientHeapMessage(headroom, fileCount), {
        code: "insufficient_memory",
        userAction: "Raise Node's heap limit with NODE_OPTIONS=--max-old-space-size, then retry.",
        recoveryCommands: ["drift doctor --repo-root . --json"],
        safeToRetry: true
      });
    }
  }

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
          facts: storage.listFacts(result.scan.id),
          // E-6 (D-2): direction from the baseline scan only, same as inferred candidates.
          diffChangedFiles: workingTreeChangedFiles(result.repo.root_path)
        })
      : undefined;
  if (declaredCandidate) {
    storage.upsertConventionCandidate(declaredCandidate);
    result.candidates.unshift(declaredCandidate);
    result.summary.candidates_count = result.candidates.length;
  }
  // T25: never auto-accept an experimental security convention. --accept-defaults takes the top
  // candidate, and on several real repos an auth-helper candidate ranks first, which would have
  // meant onboarding silently enabled a heuristic layer whose own audit says it cannot prove what
  // it claims.
  const acceptableCandidates = parsed.flags.has("experimental-security")
    ? result.candidates
    : result.candidates.filter(
        (entry) =>
          !isExperimentalSecurityKind(entry.kind) || isPromotedPresenceConvention(entry)
      );
  // The top non-presence candidate keeps the original behaviour: one default convention, chosen by
  // rank. CV-5 adds presence families ALONGSIDE it, so a repo can onboard with more than one
  // convention for the first time.
  const candidate = acceptableCandidates.find((entry) => !isPromotedPresenceConvention(entry));
  // CV-5: every presence family clearing the pre-registered floor, and the ones that do not so the
  // disclosure can name them. A below-floor family is left as a candidate for a human - not rejected,
  // not hidden, not downgraded.
  const presenceDecisions = result.candidates
    .filter((entry) => isPromotedPresenceConvention(entry))
    .map((entry) => ({ candidate: entry, decision: presenceAutoAcceptDecision(entry) }));
  const accepted = parsed.flags.has("accept-defaults") && candidate
    ? acceptDefaultCandidate(storage, { now, actor }, candidate)
    : undefined;
  // CV-5: auto-acceptance is implemented and measured, but gated behind `--accept-families` rather
  // than default-on, because accepting a SECOND convention at onboarding surfaced three coupled
  // requirements that are not yet met. Measured on dub with it enabled, the eval suite goes red:
  //
  //   - `exemplar_integrity: true -> false`. The BB-5 exemplar predicate picks files that conform to
  //     the convention it is building guidance for, and a file conforming to data-access can violate
  //     the auth family. An agent told "here is a conforming example" then opens a file that breaks
  //     another accepted convention - the Q9/B1 defection shape, for real. CV-5's red #1 predicted
  //     exactly this ("its integrity property now spans kinds") and the predicate has not been
  //     extended yet.
  //   - `clean_control_false_positive`, `fp_type_only_import`, `fp_lookalike_module` all flip true.
  //     Those assertions are not convention-scoped: they read "any finding on the control route" as a
  //     data-access false positive, and an auth finding on a route that genuinely calls no wrapper is
  //     true rather than false. The harness has to attribute per convention.
  //   - evasion `S09-type-only-decoy` and `S11-lookalike-negative` assert silence and now see the
  //     auth family's true findings.
  //
  // None of those is a defect in the floor or in presence enforcement; they are the cost of a second
  // accepted convention, which nothing in the product had ever produced before. The floor, its
  // constants, its tests and the disclosure all stay - what waits is turning it on by default.
  // CV-5 item 4: default-on, now that its three preconditions are met.
  //
  // Gated at 2e85073a because switching it on turned the suite red. All three causes are fixed:
  // exemplar integrity spans kinds (638f8e6d), the harness attributes findings per convention
  // (e61ed626), and the onboarding baseline pass now seeds from the same evaluation
  // `drift check --scope full` performs, so an accepted family's pre-existing violations are
  // baselined instead of flooding the user's first check.
  //
  // `--accept-families` is kept as an explicit opt-in for the case where `--accept-defaults` is not
  // passed, and remains harmless when it is.
  const autoAcceptFamilies =
    parsed.flags.has("accept-defaults") && parsed.flags.has("accept-families");
  const acceptedPresenceFamilies = autoAcceptFamilies
    ? presenceDecisions
        .filter((entry) => entry.decision.eligible)
        // Always warn, never block. Clearing the floor changes what Drift reports, not what it fails.
        .map((entry) => acceptDefaultCandidate(storage, { now, actor }, entry.candidate))
    : [];
  // Reported either way: a family that exists and was not accepted is exactly what a silent
  // onboarding would hide, and that half of the decision is safe to ship on by default.
  const deferredPresenceFamilies = parsed.flags.has("accept-defaults")
    ? presenceDecisions.filter((entry) => !autoAcceptFamilies || !entry.decision.eligible)
    : [];
  const defaultContract = parsed.flags.has("accept-defaults") && !accepted && acceptedPresenceFamilies.length === 0
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
  // CV-5 item 3: seed the baseline from the SAME evaluation `drift check --scope full` performs,
  // rather than from a second, simplified pass.
  //
  // `runFullRepoCheck` walked `import_used` facts itself and opened with
  // `if (convention.kind !== "api_route_no_direct_data_access") continue;`. That was invisible while
  // onboarding could accept only one convention. CV-5's floor made it possible to accept more, and the
  // gap showed immediately: an accepted auth family's pre-existing violations were never baselined, so
  // the user's FIRST `drift check` reported ~81 dub routes as new violations for code they did not
  // write - the decision-C behaviour T121 protects and BB-8 keeps measurable.
  //
  // Unified rather than extended, per Geoffrey: a second evaluation path is what produced the gap, and
  // adding a presence pass beside the data-access pass would have kept the shape that caused it.
  //
  // **Measured cost, and why the unified path is conditional.** Running the full check at onboarding
  // is 4-9x slower than the hand-rolled pass on large repos: cal.com 30.7s -> 115.9s (ceiling 92s)
  // and papermark 8s -> 73.3s (ceiling 30s), both blowing the harness's onboarding budgets. The
  // duplication was cheap precisely because it did less. So the unified path is paid only when a
  // presence family was accepted - the case that needs it - and a repo accepting only the
  // data-access convention keeps the fast pass and its existing timings. That is not the clean
  // end-state; it is the honest one until the full check is fast enough to be unconditional.
  const anythingAccepted = Boolean(accepted) || acceptedPresenceFamilies.length > 0;
  const initialFindings = !anythingAccepted
    ? []
    : acceptedPresenceFamilies.length > 0
      ? await onboardingBaselineFindings(
          storage,
          parsed,
          result.repo.id,
          result.scan.completed_at ?? result.scan.started_at
        )
      : runFullRepoCheck(
          storage,
          parsed,
          result.repo.id,
          result.scan.completed_at ?? result.scan.started_at
        );
  const baselinedCount = anythingAccepted
    ? createBaselineForFindings(storage, { now, actor }, result.repo.id, initialFindings).created_count
    : 0;
  // BB-3: computed after the baseline exists, because the count is half of what the disclosure has
  // to say - "397 baselined" is what makes "will NOT block" mean something other than "broken".
  const acceptance = accepted || acceptedPresenceFamilies.length > 0
    ? acceptanceDisclosure({
        accepted,
        alsoAccepted: acceptedPresenceFamilies,
        deferred: deferredPresenceFamilies.map((entry) => ({
          candidate_id: entry.candidate.id,
          convention_kind: entry.candidate.kind,
          coverage_ratio: entry.decision.coverage_ratio,
          evidence_file_count: entry.decision.evidence_file_count,
          below_floor_reason: entry.decision.below_floor_reason
        })),
        repoId: result.repo.id,
        baselinedCount
      })
    : undefined;
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
    // BB-3: the four facts a user needs about what acceptance did - mode, severity, how many
    // violations were baselined, and the command that upgrades a suggestion to a gate.
    //
    // Named `acceptance` rather than folded into `accepted`, because `accepted` is already the
    // accepted-convention record on a schema-locked beta surface; adding `mode` beside its
    // `enforcement_mode` would have created two spellings of one fact.
    ...(acceptance ? { acceptance } : {}),
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
    ...(accepted && acceptance ? [
      "",
      // BB-3: replaces "Accepted default convention." - a line that was identical for dub (warn,
      // enforces nothing new by itself) and cal.com (block, exits 2).
      ...acceptanceDisclosureLines(acceptance),
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

/**
 * Exported for tests. The discovery message is the difference between "no convention here" and
 * "inference cannot see your data layer" - see packages/cli/test/discovery-message.test.ts.
 */
export const noCandidateTextForTest = noCandidateText;

/**
 * The findings that seed the onboarding baseline: every accepted convention's pre-existing violations,
 * produced by the same code path `drift check --scope full` uses.
 *
 * A synthesized `ParsedArgs` rather than a new entry point, because `runCheck` already resolves the
 * repo, materializes the diff, evaluates every accepted kind and writes the findings - and reusing it
 * is the whole point of the change. `--json` keeps its output structured and unprinted; the caller
 * reads the findings back from storage rather than parsing them.
 */
async function onboardingBaselineFindings(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  now: string
): Promise<Finding[]> {
  const checkParsed: ParsedArgs = {
    positional: [],
    flags: new Map<string, string | true>([
      ["repo", repoId],
      ["scope", "full"],
      ["json", true],
      ["now", now]
    ])
  };
  // Carry through the flags that decide WHERE state lives, or the check would look somewhere else.
  for (const flag of ["state-root", "repo-root", "db"]) {
    const value = parsed.flags.get(flag);
    if (value !== undefined) {
      checkParsed.flags.set(flag, value);
    }
  }
  await runCheck(storage, checkParsed);
  // Only the ones this check just opened. A closed or waived finding is not a violation to baseline.
  return storage.listFindings(repoId).filter((finding) => finding.status === "new");
}
