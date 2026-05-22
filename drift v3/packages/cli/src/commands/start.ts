import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { doctorCommand } from "../args/doctor-commands.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { runFullRepoCheck } from "../check/run-check.js";
import { createBaselineForFindings } from "../domain/baselines.js";
import { acceptDefaultCandidate } from "../domain/convention-candidates.js";
import { runScanRepo } from "../domain/scan-status.js";

export async function startRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<CommandPayload> {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const result = await runScanRepo(storage, {
    now,
    repoRoot: resolveRepoRoot(parsed),
    actor: actorFlag(parsed),
    databasePath: requiredDatabasePath(parsed)
  });
  const actor = actorFlag(parsed);
  const candidate = result.candidates[0];
  const accepted = parsed.flags.has("accept-defaults") && candidate
    ? acceptDefaultCandidate(storage, { now, actor }, candidate)
    : undefined;
  const initialFindings = accepted
    ? runFullRepoCheck(storage, parsed, result.repo.id, result.scan.completed_at ?? result.scan.started_at)
    : [];
  const baselinedCount = accepted
    ? createBaselineForFindings(storage, { now, actor }, result.repo.id, initialFindings).created_count
    : 0;
  const nextCommands = accepted
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
    ...result,
    accepted,
    baselined_count: baselinedCount,
    onboarding: {
      status: accepted ? "ready" : candidate ? "needs_convention_review" : "needs_more_signal",
      accepted_default: Boolean(accepted),
      baselined_count: baselinedCount,
      candidate_count: result.candidates.length
    },
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
      : "No enforceable convention candidates found yet.",
    "",
    "State:",
    `  export DRIFT_DB=${result.database_path}`,
    "",
    "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");

  return {
    payload: parsed.flags.has("json") ? onboardingPayload : text
  };
}
