import type { runScanRepo } from "../domain/scan-status.js";

/**
 * W4/D-CL2: `drift scan` had no human path at all.
 *
 * `formatOutput` prints a string as-is, pretty JSON under `--json`, and otherwise compact
 * single-line JSON - so a command with no text branch emitted a one-line JSON blob to a terminal.
 * Every other command family has a `formatXText`; `scan` is the first thing a new user runs.
 */
export function formatScanText(payload: Awaited<ReturnType<typeof runScanRepo>>): string {
  const { summary } = payload;
  const changes = summary.incremental_changes;
  return [
    "Drift scan complete",
    "",
    `Repo: ${payload.repo.id}`,
    `Root: ${payload.repo.root_path}`,
    `Scan: ${payload.scan.id} (${payload.scan.status})`,
    `Engine: ${summary.engine_source}`,
    "",
    `Files indexed: ${summary.files_indexed}`,
    `Files skipped: ${summary.files_skipped}`,
    `Facts: ${summary.facts_count}`,
    // Named rather than summed into "issues": a diagnostic is something the scan could not read,
    // and a reader who cannot see the count cannot know the scan was partial.
    `Diagnostics: ${summary.diagnostics_count}`,
    `Candidates: ${summary.candidates_count}`,
    "",
    `Changes since last scan: ${changes.added} added, ${changes.modified} modified, ${changes.deleted} deleted`,
    `Mode: ${summary.incremental_plan.execution_mode}` +
      (summary.incremental_plan.reuse_applied
        ? ` (reused ${summary.incremental_plan.reusable_file_count}, reparsed ${summary.incremental_plan.changed_file_count})`
        : ""),
    // Why a full rescan happened, when one did. A silent "full_scan" reads as a choice rather
    // than as reuse being blocked, and the reasons are the actionable half.
    ...(summary.incremental_plan.blocked_reasons.length > 0
      ? [`Reuse blocked: ${summary.incremental_plan.blocked_reasons.join(", ")}`]
      : []),
    "",
    "Next commands:",
    `  drift conventions list --repo ${payload.repo.id}`,
    `  drift scan status --repo ${payload.repo.id}`,
    "",
    ""
  ].join("\n");
}
