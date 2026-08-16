import type { AcceptedConvention, ConventionCandidate } from "@drift/core";

/**
 * W4/D-CL2: the four convention-mutation commands had no human path.
 *
 * `conventions accept`, `reject`, `edit` and `exception add` are the governance surface - the
 * point where a human decides what Drift will enforce - and without `--json` each emitted compact
 * single-line JSON. One formatter rather than four because the payloads share a shape (a subject,
 * whether anything changed, whether this was a dry run, and what to run next); four near-identical
 * formatters is how the CLI/MCP copies started.
 */
export function formatConventionMutationText(
  action: "accepted" | "rejected" | "edited" | "exception added",
  payload: {
    /**
     * The subject appears under three different keys across the four commands - `accepted` (the
     * materialized convention), `convention` (exception add), `candidate` (reject/edit) - which
     * is itself a small instance of what D-CL2 is about: four payloads that were never rendered
     * for a human and so were never made to agree.
     */
    accepted?: AcceptedConvention;
    candidate?: ConventionCandidate;
    convention?: AcceptedConvention;
    changed?: boolean;
    changed_fields?: string[];
    dry_run?: boolean;
    write_intent?: boolean;
    next_commands?: string[];
  }
): string {
  const acceptedConvention = payload.accepted ?? payload.convention;
  const subject = payload.candidate ?? acceptedConvention;
  const dryRun = payload.dry_run === true;
  // A dry run that says "accepted" is the D-CL2 failure mode in words rather than in JSON: the
  // headline has to carry whether anything was written.
  const headline = dryRun
    ? `Convention would be ${action} (dry run - nothing written)`
    : payload.changed === false
      ? `Convention already ${action} - no change`
      : `Convention ${action}`;

  return [
    headline,
    "",
    ...(subject ? [`Id: ${subject.id}`, `Kind: ${subject.kind}`] : []),
    ...(payload.candidate
      ? [`Repo: ${payload.candidate.repo_id}`, `Status: ${payload.candidate.status}`]
      : []),
    ...(acceptedConvention
      ? [
          `Severity: ${acceptedConvention.severity}`,
          `Enforcement: ${acceptedConvention.enforcement_mode} (${acceptedConvention.enforcement_capability})`,
          `Exceptions: ${acceptedConvention.exceptions.length}`
        ]
      : []),
    ...(payload.changed_fields && payload.changed_fields.length > 0
      ? ["", `Changed fields: ${payload.changed_fields.join(", ")}`]
      : []),
    ...(subject ? ["", `Statement: ${subject.statement}`] : []),
    "",
    ...(payload.next_commands && payload.next_commands.length > 0
      ? ["Next commands:", ...payload.next_commands.map((command) => `  ${command}`)]
      : []),
    "",
    ""
  ].join("\n");
}
