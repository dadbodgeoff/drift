import { authorizeContextExport,type Finding,type SecurityBoundaryProof } from "@drift/core";
import { findingLocation } from "./findings.js";

export function formatCheckText(payload: {
  policy: ReturnType<typeof authorizeContextExport>;
  summary: {
    repo_id: string;
    scope: string;
    findings_count: number;
    blocking_count: number;
    waived_findings_count?: number;
    expired_findings_count?: number;
    skipped_deleted_files: string[];
    engine_source: "rust" | "typescript";
    affected_scope?: {
      changed_file_count: number;
      changed_line_count: number;
      deleted_file_count: number;
      renamed_file_count?: number;
      missing_file_count?: number;
    };
    outcome?: {
      blocking_reasons: Array<{ reason: string; count: number }>;
      warning_reasons: Array<{ reason: string; count: number }>;
      non_blocking_reasons: Array<{ reason: string; count: number }>;
    };
    // E-6 (D-2): conventions currently running weaker than block because something
    // explicitly demoted them. Present only while the weaker mode is in effect.
    enforcement_demotions?: Array<{
      convention_id: string;
      from: string;
      to: string;
      at: string;
    }>;
    /** BB-4: one line per forbidden module the repo no longer contains. */
    contract_staleness_warnings?: string[];
    /**
     * What each accepted convention actually did on this run. Optional so an older payload still
     * formats; absent means "this run did not say", not "every convention ran".
     */
    evaluation_receipts?: Array<{
      convention_id: string;
      kind: string;
      reached: boolean;
      inputs_considered: number;
      skip_reason: string | null;
    }>;
  };
  findings: Finding[];
  security_boundary_proofs?: SecurityBoundaryProof[];
}): string {
  const rows = payload.findings.length > 0
    ? payload.findings.map((finding) =>
        `${finding.id} ${finding.severity}/${finding.enforcement_result} ${finding.status} ${finding.diff_status} ${findingLocation(finding)} - ${finding.title}`
      )
    : ["  none"];

  return [
    "Drift check",
    "",
    `Repo: ${payload.summary.repo_id}`,
    `Scope: ${payload.summary.scope}`,
    `Engine: ${payload.summary.engine_source}`,
    `Policy: ${payload.policy.allowed ? "allowed" : "denied"} (${payload.policy.mode})`,
    `Findings: ${payload.summary.findings_count}`,
    `Blocking: ${payload.summary.blocking_count}`,
    `Waived: ${payload.summary.waived_findings_count ?? 0}`,
    `Expired: ${payload.summary.expired_findings_count ?? 0}`,
    // BB-1: what was examined, on every run, in the vocabulary a reader checks first.
    //
    // `Affected: 0 files` was already printed, but a human scanning for "did this check anything"
    // reads it as a property of the change, not of the check. `Checked N files` answers the question
    // directly, and names the deleted-file case rather than leaving a bare 0 to be misread as a
    // broken diff spec - deleting code is a legitimate change with a legitimately empty scope.
    checkedFilesLine(payload.summary),
    payload.summary.affected_scope
      ? `Affected: ${payload.summary.affected_scope.changed_file_count} files, ${payload.summary.affected_scope.changed_line_count} changed lines`
      : "",
    ...reasonLines("Block reasons", payload.summary.outcome?.blocking_reasons ?? []),
    ...reasonLines("Warn reasons", payload.summary.outcome?.warning_reasons ?? []),
    ...reasonLines("Non-blocking reasons", payload.summary.outcome?.non_blocking_reasons ?? []),
    // BB-4: before the demotion lines, because "this rule enforces nothing" outranks "this rule
    // enforces something weaker".
    ...(payload.summary.contract_staleness_warnings ?? []),
    ...(payload.summary.enforcement_demotions ?? []).map(
      (demotion) =>
        `Enforcement demoted: ${demotion.convention_id} ${demotion.from} -> ${demotion.to} at ${demotion.at}`
    ),
    `Skipped deleted files: ${payload.summary.skipped_deleted_files.length}`,
    ...silentConventionDisclosure(payload.summary),
    ...nonBlockingDisclosure(payload),
    "",
    "Findings:",
    ...rows.map((row) => `  ${row}`),
    ...securityBlocks(payload),
    ""
  ].join("\n");
}

/**
 * BB-1: `Checked N files`, plus the reason when N is 0 for a legitimate reason.
 *
 * The count comes from `affected_scope`, which is the check's own record of what it looked at. When
 * that is absent (older payloads) the line is omitted rather than guessed at - a fabricated count is
 * worse than a missing one on a surface whose whole purpose is telling examined from unexamined.
 */
function checkedFilesLine(summary: {
  skipped_deleted_files: string[];
  affected_scope?: {
    changed_file_count: number;
    deleted_file_count: number;
    renamed_file_count?: number;
    missing_file_count?: number;
  };
}): string {
  if (!summary.affected_scope) {
    return "";
  }
  const checked = summary.affected_scope.changed_file_count;
  const deleted = summary.affected_scope.deleted_file_count;
  const renamed = summary.affected_scope.renamed_file_count ?? 0;
  const missing = summary.affected_scope.missing_file_count ?? 0;
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  // BB-1: name the reason a legitimate check examined nothing - a deletion or a pure rename. Both are
  // ordinary changes whose content scope is empty, and a bare `Checked 0 files` reads as a broken
  // diff spec.
  const reasons = [
    ...(deleted > 0 ? [`${plural(deleted, "deleted file")} skipped`] : []),
    ...(renamed > 0 ? [`${plural(renamed, "renamed file")} unchanged`] : [])
  ];
  // BB-9: a missing file is reported whether or not anything else was checked, because "I examined 3
  // of the 4 files you named" is a different claim from "I examined 3 files", and only the first is
  // true. The other reasons only matter when nothing was examined at all.
  const missingClause = missing > 0 ? `${plural(missing, "file")} missing from working tree` : "";
  const parts = [
    ...(checked === 0 ? reasons : []),
    ...(missingClause ? [missingClause] : [])
  ];
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Checked ${plural(checked, "file")}${suffix}`;
}

/**
 * Say, in the human output, which accepted conventions enforced nothing on this run.
 *
 * The JSON carries a receipt per convention unconditionally, because a machine reading a verdict
 * should be able to ask "did rule X run" without knowing the answer first. A human reading a
 * terminal cannot scan twenty receipts, so this is the one line that matters: `Findings: 0` above
 * is compatible with every convention having run and been satisfied, AND with none of them having
 * run at all, and those two runs deserve different reactions.
 *
 * Only when there is something to say - a clean run where everything was evaluated prints nothing
 * extra, on the same terms as `nonBlockingDisclosure` below.
 *
 * Two states, kept apart because their fixes are different. `reached: false` is a rule that never
 * executed, which is a Drift or contract problem. `inputs_considered: 0` is a rule that executed
 * against nothing in scope, which is usually an ordinary property of the diff and occasionally a
 * glob that matches nothing. Collapsing them into "did not enforce" would hide the first behind
 * the second, and the first is the one that shipped eight dead conventions.
 */
function silentConventionDisclosure(summary: {
  evaluation_receipts?: Array<{
    convention_id: string;
    kind: string;
    reached: boolean;
    inputs_considered: number;
    skip_reason: string | null;
  }>;
}): string[] {
  const receipts = summary.evaluation_receipts;
  if (!receipts || receipts.length === 0) {
    return [];
  }
  const unreached = receipts.filter((receipt) => !receipt.reached);
  const ranOnNothing = receipts.filter((receipt) => receipt.reached && receipt.inputs_considered === 0);
  if (unreached.length === 0 && ranOnNothing.length === 0) {
    return [];
  }
  const lines = [
    `Enforced nothing: ${unreached.length} of ${receipts.length} convention(s) did not run` +
      (ranOnNothing.length > 0 ? `, ${ranOnNothing.length} ran on 0 inputs` : "") +
      " - this run's 0 findings do not cover them."
  ];
  // The reason, not just the count: "no evaluator for this kind" and "nothing in the diff matched"
  // are the same silence with opposite remedies, and a bare count sends the reader to the JSON to
  // find out which they have.
  for (const receipt of unreached.slice(0, 3)) {
    lines.push(`  ${receipt.convention_id} (${receipt.kind}): ${receipt.skip_reason ?? "unknown"}`);
  }
  if (unreached.length > 3) {
    lines.push(`  ...and ${unreached.length - 3} more - see summary.evaluation_receipts in --json`);
  }
  return lines;
}

function securityBlocks(payload: {
  summary: { repo_id: string };
  findings: Finding[];
  security_boundary_proofs?: SecurityBoundaryProof[];
}): string[] {
  const findingsById = new Map(payload.findings.map((finding) => [finding.id, finding]));
  const blocks = (payload.security_boundary_proofs ?? [])
    .filter((proof) => proof.result.finding_ids.length > 0)
    .map((proof) => {
      const finding = proof.result.finding_ids
        .map((id) => findingsById.get(id))
        .find((candidate): candidate is Finding => Boolean(candidate));
      const contract = proof.contracts.find((entry) => entry.matched) ?? proof.contracts[0];
      const level = proof.result.enforcement_result === "block" ? "BLOCK" : "WARN";
      const route = proof.route.endpoint?.method && proof.route.endpoint?.path
        ? `${proof.route.endpoint.method} ${proof.route.endpoint.path}`
        : "unknown";
      return [
        "",
        `${level} ${contract?.kind ?? "security_boundary"}`,
        `  Route: ${route}`,
        `  File: ${proof.route.file_path}`,
        `  Reason: ${proof.missing_proof[0]?.code ?? proof.parser_gaps[0]?.code ?? finding?.title ?? proof.result.proof_status}`,
        `  Evidence: ${evidenceLine(proof)}`,
        `  Capability: ${proof.capability_status[0]?.name ?? proof.missing_proof[0]?.capability ?? "security"} ${contract?.capability ?? "deterministic_check"}`,
        `  Lifecycle: ${finding?.status ?? "unknown"}, ${finding?.diff_status ?? "changed-files"}`,
        `  Next: drift repo map --repo ${payload.summary.repo_id} --path ${proof.route.file_path} --json`
      ].join("\n");
    });
  return blocks;
}

function evidenceLine(proof: SecurityBoundaryProof): string {
  const refs = proof.evidence_refs ?? [];
  if (refs.length > 0) {
    return refs.slice(0, 4).map((ref) =>
      `${ref.kind}${ref.start_line ? ` line ${ref.start_line}` : ""}`
    ).join("; ");
  }
  const missingIds = proof.missing_proof.flatMap((missing) => missing.fact_ids);
  return missingIds.length > 0 ? missingIds.slice(0, 4).join("; ") : "proof metadata only";
}

function reasonLines(label: string, reasons: Array<{ reason: string; count: number }>): string[] {
  if (reasons.length === 0) {
    return [];
  }
  return [
    `${label}:`,
    ...reasons.map((reason) => `  ${reason.reason}: ${reason.count}`)
  ];
}

export function formatChecksText(payload: {
  summary?: {
    required_count: number;
    safe_count: number;
    total_count: number;
    filtered_count?: number;
    listed_count?: number;
  };
  pagination?: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  required_checks: Array<{ command: string; reason?: string }>;
  safe_commands: Array<{ command: string; reason?: string }>;
}): string {
  const requiredChecks = payload.required_checks.length > 0
    ? payload.required_checks.map((check) => `  ${check.command}${check.reason ? ` - ${check.reason}` : ""}`)
    : ["  none"];
  const safeCommands = payload.safe_commands.length > 0
    ? payload.safe_commands.map((command) => `  ${command.command}${command.reason ? ` - ${command.reason}` : ""}`)
    : ["  none"];

  return [
    "Drift checks",
    "",
    payload.summary
      ? `Summary: ${payload.summary.required_count} required, ${payload.summary.safe_count} safe, ${payload.summary.total_count} total`
      : "",
    payload.summary && payload.summary.filtered_count !== undefined
      ? `Returned: ${payload.summary.listed_count ?? payload.summary.total_count} of ${payload.summary.filtered_count}`
      : "",
    payload.pagination
      ? `Page: limit ${payload.pagination.limit ?? "none"}, offset ${payload.pagination.offset}, next ${payload.pagination.next_offset ?? "none"}`
      : "",
    payload.summary ? "" : "",
    "Required checks:",
    ...requiredChecks,
    "",
    "Safe commands:",
    ...safeCommands,
    ""
  ].join("\n");
}

/**
 * Say, at the moment of the verdict, that this run cannot fail a build.
 *
 * `drift start` already discloses it well — "in WARN mode (… new violations will be reported but
 * will NOT block)" plus the exact upgrade command. But that is said once, at onboarding, possibly
 * days before anyone reads a check. The check itself printed `Findings: 1 / Blocking: 0` and exited
 * 0, and nothing there connected the two: a reader scanning CI output sees a green step and a
 * finding, and has to already know that warn mode is why.
 *
 * A run that blocks does not need telling. A run that found nothing DOES, which is the correction
 * here: the guard used to be `findings.length === 0 || blocking_count > 0`, so the disclosure was
 * suppressed exactly when it mattered most. "0 findings, exit 0" from a contract that cannot fail
 * a build is the single most misreadable output Drift produces - it is indistinguishable, in a CI
 * log, from "0 findings, exit 0" from a contract that would have failed the build had there been
 * anything to fail on. The first is a green step that proves nothing; the second is a gate.
 *
 * So the trigger is the CONTRACT's posture, not the finding count. With findings, the sentence
 * says how many were reported and did not block. Without them, it says the run could not have
 * blocked whatever it found - and that is only claimed when the receipts establish it, because
 * "no finding blocked" and "no finding could have blocked" are different statements and only the
 * second is worth interrupting a clean run for.
 */
function nonBlockingDisclosure(payload: {
  summary: {
    repo_id: string;
    blocking_count: number;
    evaluation_receipts?: Array<{ convention_id: string; reached: boolean }>;
  };
  findings: Finding[];
}): string[] {
  if (payload.summary.blocking_count > 0) {
    return [];
  }
  if (payload.findings.length > 0) {
    const conventionIds = [...new Set(payload.findings.map((finding) => finding.convention_id))].filter(
      Boolean
    );
    if (conventionIds.length === 0) {
      return [];
    }
    return [
      `Not blocking: ${payload.findings.length} finding${payload.findings.length === 1 ? "" : "s"} reported, 0 blocking - this run exits 0 and will not fail CI.`,
      ...conventionIds.slice(0, 3).map((conventionId) =>
        `  To make it a gate: drift conventions accept ${conventionId} --repo ${payload.summary.repo_id} --severity error --mode block --confirm`
      )
    ];
  }
  // Zero findings. Worth a word only when the receipts show at least one convention actually ran -
  // a run where nothing ran is already covered, in stronger terms, by the line above this one, and
  // saying both would be two warnings about one silence.
  const receipts = payload.summary.evaluation_receipts ?? [];
  const reached = receipts.filter((receipt) => receipt.reached);
  if (reached.length === 0) {
    return [];
  }
  return [
    `Not blocking: 0 findings from ${reached.length} convention(s) that ran - this run exits 0 and will not fail CI.`,
    ...reached.slice(0, 3).map((receipt) =>
      `  To make it a gate: drift conventions accept ${receipt.convention_id} --repo ${payload.summary.repo_id} --severity error --mode block --confirm`
    )
  ];
}
