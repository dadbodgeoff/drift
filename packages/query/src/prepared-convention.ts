/**
 * The convention entry both preflight surfaces emit, derived once.
 *
 * W6. `prepare`/`ask` (CLI) and `get_task_preflight` (MCP) each built this entry from the same
 * inputs through their own copy - `preparedConvention` in packages/cli/src/domain/preflight.ts and
 * `preflightConvention` in packages/mcp/src/index.ts. The two return objects were field-for-field
 * identical, which is why the divergence took a measurement to see rather than a diff:
 *
 *   D-A1  the CLI passed the task's `--path` to `conformingExemplars` as `referenceFile`; MCP
 *         passed nothing. `referenceFile` does two things there - it excludes the target from being
 *         offered as an example of itself (conforming-exemplars.ts:119) and it sorts the remainder
 *         by path distance (:135). So on a task naming a conforming file, `prepare` offered three
 *         neighbours and `get_task_preflight` offered the file the agent was already editing.
 *
 *   The second one had not been named at all, and is worse than a disagreement. MCP's private copy
 *   of `instructionForConvention` never received CV-5's `presence` branch, so every presence-kind
 *   convention - `api_route_requires_auth`, `api_route_requires_rate_limit`,
 *   `api_route_requires_request_validation` - fell through to the generic sentence. The branch
 *   exists to say one thing plainly: Drift checks only that an accepted helper is CALLED, not that
 *   it guards the route's work. An agent reading the MCP packet was never told that, and an agent
 *   that believes a passing check proves the route is protected stops looking. `beta:proof` diffs
 *   the two payloads and could not see it: its fixture repo accepts no presence-kind convention.
 *
 * Lives in @drift/query because MCP cannot import @drift/cli (drift.lock forbids it, blocking) and
 * this needs @drift/core's exemplar machinery. Both callers already built an `ExemplarContext` and
 * then hand-unpacked it into a bag of primitives, so taking the context directly removes a third
 * copy - the unpacking - rather than adding a parameter.
 */

import {
  conformingExemplars,
  conventionRationale,
  migrationSentence,
  type AcceptedConvention,
  type EnforcementMode,
  type ExemplarContext,
  type Severity
} from "@drift/core";

export interface PreparedConvention {
  id: string;
  kind: AcceptedConvention["kind"];
  statement: string;
  severity: Severity;
  enforcement_mode: EnforcementMode;
  enforcement_capability: AcceptedConvention["enforcement_capability"];
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  exceptions: AcceptedConvention["exceptions"];
  agent_instruction: string;
  /**
   * BB-5: files in scope that obey this convention. Never a violator - see
   * `core/src/conforming-exemplars.ts` for why that invariant is the item rather than a nicety.
   */
  conforming_examples: Array<{ file_path: string; role: string | null }>;
  /** BB-5: why an empty exemplar list is empty. Never a bare `[]` (the EW-3 shape). */
  conforming_examples_reason: string | null;
  /**
   * BB-5: the AK-8 split. `derivation` is how Drift came to believe the repo holds this convention;
   * `reason` is why the repo holds it, which is what a reader deciding whether to comply needs.
   */
  rationale: { derivation: string; reason: string | null };
  /**
   * BB-5: why the baselined violations around the exemplars are not precedent. Absent when there
   * are none - boilerplate saying "0 are baselined" trains readers to skip the line.
   */
  migration_sentence: string | null;
}

export function preparedConvention(
  convention: AcceptedConvention,
  // BB-5: optional so a caller with no scan state still gets the empty-with-reason shape rather
  // than a missing field. A packet that silently omits the exemplars is the status quo.
  context?: ExemplarContext,
  options: {
    /**
     * The file the task targets, when it named one. D-A1: this is what the CLI passed and MCP did
     * not. It is not a display preference - it decides whether the target can be cited as an
     * example of itself.
     */
    targetPath?: string;
  } = {}
): PreparedConvention {
  const exemplars = conformingExemplars({
    scopeFiles: context?.scopeFilesFor(convention) ?? [],
    // CV-5: any accepted convention, not just this one. A file conforming to the data-access rule
    // can violate the auth family, and offering it as an example sends an agent to open a file
    // that breaks another accepted rule - the trial-B1 defection trigger.
    violatingFiles: context?.violatingFilesAnyConvention() ?? [],
    roleByFile: context?.roleByFile,
    referenceFile: options.targetPath,
    // Verified against facts, not inferred from a missing finding. Neither surface runs a check,
    // so its violator set is only whatever a previous check happened to record.
    forbiddenImports: convention.matcher?.forbidden_imports ?? [],
    importsByFile: context?.importsByFile
  });
  return {
    id: convention.id,
    kind: convention.kind,
    statement: convention.statement,
    severity: convention.severity,
    enforcement_mode: convention.enforcement_mode,
    enforcement_capability: convention.enforcement_capability,
    scope: convention.scope,
    matcher: convention.matcher,
    exceptions: convention.exceptions,
    agent_instruction: instructionForConvention(convention),
    conforming_examples: exemplars.conforming_examples,
    conforming_examples_reason: exemplars.reason,
    rationale: conventionRationale({
      kind: convention.kind,
      derivation: convention.rationale ?? convention.statement
    }),
    migration_sentence: migrationSentence(context?.baselineActiveCountFor(convention.id) ?? 0)
  };
}

export function instructionForConvention(convention: AcceptedConvention): string {
  if (convention.kind === "api_route_no_direct_data_access") {
    const forbidden = (convention.matcher.forbidden_imports ?? []).join(", ");
    return [
      "When editing API route files, do not import data-access clients directly.",
      forbidden ? `Forbidden imports: ${forbidden}.` : "",
      "Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
    ].filter(Boolean).join(" ");
  }

  if (convention.kind === "api_route_requires_service_delegation") {
    const delegates = (convention.matcher.allowed_delegate_imports ?? []).join(", ");
    return [
      "When editing API route files, keep route modules thin and delegate business/data-access work to the service layer.",
      delegates ? `Observed delegate imports: ${delegates}.` : "",
      "Treat this as briefing guidance unless the repo later upgrades it to a deterministic check."
    ].filter(Boolean).join(" ");
  }

  // CV-5: the presence kinds. Without this they fell through to the generic sentence below, which
  // restates the convention and tells an agent nothing it can act on - and, worse, says nothing about
  // what the check does NOT verify. The instruction is the one place the packet can be explicit that
  // calling the helper is all that is checked, so an agent does not read a passing check as proof the
  // route is protected.
  if (convention.matcher.enforcement_semantics === "presence") {
    const members = (convention.matcher.required_calls ?? []).join(", ");
    const flavors = convention.matcher.applies_to_route_flavors ?? [];
    const noun =
      convention.kind === "api_route_requires_rate_limit"
        ? "rate-limit helper"
        : convention.kind === "api_route_requires_request_validation"
          ? "request validator"
          : "auth wrapper";
    const scopeClause =
      flavors.length > 0 && !flavors.includes("api_route")
        ? ` This applies to ${flavors.join(" and ")} routes only.`
        : flavors.length > 0
          ? " This applies to application routes only, not cron or webhook routes."
          : "";
    return [
      `When adding or editing an API route in scope, call one of the repo's accepted ${noun}s.`,
      members ? `Accepted: ${members}.` : "",
      scopeClause.trim(),
      // Said plainly, because an agent that believes this proves protection will stop looking.
      `Drift checks only that one of these is called - it does not verify that it guards the route's work.`
    ].filter(Boolean).join(" ");
  }

  return `${convention.statement} Follow its scope, matcher, and exceptions.`;
}
