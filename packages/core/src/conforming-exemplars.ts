/**
 * BB-5: files that actually obey the convention, and the sentence that explains why the ones around
 * them do not count as precedent.
 *
 * This is the empirically highest-leverage item in the beta set, and the reason is uncomfortable. In
 * controlled trials on 2026-08-03, unguided agents violated the data-access rule 7/7. Agents given
 * the convention *statement* conformed 2/3. And in two separate experiments an agent read the cited
 * files, found that they violate the rule themselves, and deliberately defected - one writing that
 * "the preflight's claim doesn't hold up against the actual codebase". A third, handed the honest
 * warn-mode packet, used the findings summary as evidence *against* the rule.
 *
 * Agents comply with perceived enforcement reality, not with statements. Two payload changes encode
 * that reality:
 *
 *   1. examples that actually conform, so reading them reinforces the rule instead of refuting it;
 *   2. one sentence saying why the 397 violations around them are baselined debt rather than the
 *      house style.
 *
 * The integrity invariant is the whole item: **an exemplar must never have an open finding against
 * the convention it exemplifies.** Violating it does not merely weaken the packet, it actively
 * teaches defection - which is what the current behaviour does by accident, because the files
 * nearest the one being edited are exactly the ones most likely to share its violation.
 */

/** A file offered as an example of the convention being obeyed. */
export interface ConformingExemplar {
  file_path: string;
  /** The role the scan classified it as, when it classified one. Used to prefer like-for-like. */
  role: string | null;
}

export type NoExemplarsReason =
  | "no_conforming_examples"
  | "no_files_in_scope"
  /** The convention forbids imports and the caller supplied no facts to verify against. */
  | "unverified";

/**
 * Segment-boundary specifier match, matching the engine's `rules::is_forbidden_import`.
 *
 * `@/lib/db` must not match `@/lib/db-legacy`: a lookalike is a different module, and treating it
 * as one produces a false positive here exactly as it did in the engine.
 */
function isForbiddenImportSource(source: string, forbidden: string): boolean {
  return source === forbidden || (source.startsWith(forbidden) && source[forbidden.length] === "/");
}

export interface ConformingExemplarsResult {
  conforming_examples: ConformingExemplar[];
  /**
   * Why the list is empty, when it is. Never a bare `[]` - the EW-3 lesson: an empty array with no
   * reason is indistinguishable from a bug, and a consumer cannot tell "this repo has no clean
   * example" from "this feature did not run".
   */
  reason: NoExemplarsReason | null;
}

export const MAX_CONFORMING_EXEMPLARS = 3;

export interface ConformingExemplarsInput {
  /** Files matching the convention's scope. */
  scopeFiles: string[];
  /**
   * Files with an **open** finding for this convention. Baselined and waived findings still count as
   * open for this purpose: a baselined violation is still a violation, and citing one as an example
   * is exactly the defection trigger observed in trial B1.
   */
  violatingFiles: Iterable<string>;
  /** `file_role_detected` classifications, by file path. */
  roleByFile?: Map<string, string>;
  /** The file being edited or flagged, if any - exemplars near it are more useful. */
  referenceFile?: string;
  limit?: number;
  /**
   * The convention's forbidden import specifiers, when it has any.
   *
   * Supplying these turns selection from "no finding says otherwise" into "the facts say this file
   * complies". Absence of a finding only ever meant NOT EVALUATED, and the two came apart badly: a
   * changed-hunks check records findings for the changed file only, while the candidate pool is the
   * whole repo, so on dub 138 of 139 API routes were certified conforming and one of the three
   * offered - `admin/ban/route.ts` - imported prisma at line 4 while the SAME payload cited it as
   * violation evidence.
   */
  forbiddenImports?: string[];
  /** `import_used` fact values by file path: what each file actually imports. */
  importsByFile?: Map<string, string[]>;
}

export function conformingExemplars(input: ConformingExemplarsInput): ConformingExemplarsResult {
  const violating = new Set(input.violatingFiles);
  const roleByFile = input.roleByFile ?? new Map<string, string>();
  const limit = input.limit ?? MAX_CONFORMING_EXEMPLARS;

  if (input.scopeFiles.length === 0) {
    return { conforming_examples: [], reason: "no_files_in_scope" };
  }

  const referenceRole = input.referenceFile ? roleByFile.get(input.referenceFile) ?? null : null;
  // Fail closed when the convention forbids imports but nothing was supplied to check them against.
  // Zero examples is a correct answer; a wrong example is not, and this module's whole purpose is
  // that an agent can copy what it is handed.
  const forbidden = input.forbiddenImports ?? [];
  if (forbidden.length > 0 && !input.importsByFile) {
    return { conforming_examples: [], reason: "unverified" };
  }
  const proves = (filePath: string): boolean => {
    if (forbidden.length === 0) {
      return true;
    }
    const imports = input.importsByFile?.get(filePath);
    // No fact row for a file in scope means the scan has nothing to say about it. Unproven is not
    // conforming.
    if (!imports) {
      return false;
    }
    return !imports.some((source) => forbidden.some((entry) => isForbiddenImportSource(source, entry)));
  };
  const candidates = input.scopeFiles.filter(
    (filePath) => !violating.has(filePath) && filePath !== input.referenceFile && proves(filePath)
  );

  if (candidates.length === 0) {
    return { conforming_examples: [], reason: "no_conforming_examples" };
  }

  // Deterministic by construction, because the packet is byte-compared by eval:determinism: same
  // role first, then nearest in the directory tree, then lexicographic as the total-order tiebreak.
  const ranked = [...candidates].sort((left, right) => {
    const roleRank =
      sameRoleRank(roleByFile.get(left) ?? null, referenceRole) -
      sameRoleRank(roleByFile.get(right) ?? null, referenceRole);
    if (roleRank !== 0) {
      return roleRank;
    }
    const distance = pathDistance(left, input.referenceFile) - pathDistance(right, input.referenceFile);
    if (distance !== 0) {
      return distance;
    }
    return left.localeCompare(right);
  });

  return {
    conforming_examples: ranked.slice(0, limit).map((filePath) => ({
      file_path: filePath,
      role: roleByFile.get(filePath) ?? null
    })),
    reason: null
  };
}

/** 0 when the roles match (or there is no reference role to match), 1 otherwise. Lower sorts first. */
function sameRoleRank(role: string | null, referenceRole: string | null): number {
  if (referenceRole === null) {
    return 0;
  }
  return role === referenceRole ? 0 : 1;
}

/**
 * Distance between two files in the directory tree: the number of segments each has outside their
 * common prefix, summed. Siblings score 2, a cousin one directory over scores 4.
 *
 * With no reference file every candidate is equidistant, which leaves the lexicographic tiebreak to
 * do the work - still a total order, still deterministic.
 */
function pathDistance(filePath: string, referenceFile?: string): number {
  if (!referenceFile) {
    return 0;
  }
  const left = filePath.split("/");
  const right = referenceFile.split("/");
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
    shared += 1;
  }
  return left.length - shared + (right.length - shared);
}

/**
 * BB-5: why the violations surrounding an exemplar are not precedent.
 *
 * Without this, an honest packet is self-undermining: it reports 397 open violations of a rule it is
 * asking the agent to follow, and trial Q19 shows an agent reading that as evidence the rule is
 * dead. `null` when the count is zero - boilerplate that says "0 existing violations are baselined"
 * trains readers to skip the line that matters when it is not zero.
 */
export function migrationSentence(baselineActiveCount: number): string | null {
  if (baselineActiveCount <= 0) {
    return null;
  }
  const clause = baselineActiveCount === 1
    ? "violation is baselined and does not block"
    : "violations are baselined and do not block";
  return `${baselineActiveCount} existing ${clause}; new code is held to this rule.`;
}

/**
 * BB-5: the AK-8 rationale split, scoped to the one accepted kind.
 *
 * `derivation` is how Drift came to believe the repo holds this convention - today's text, which is
 * evidence about Drift's inference. `reason` is why the repo holds it, which is what an agent
 * deciding whether to comply actually needs. Collapsing them left the payload with plenty of the
 * first and none of the second.
 */
export interface ConventionRationale {
  derivation: string;
  reason: string | null;
}

const DELEGATION_REASON =
  "Route modules are transport: they parse a request, delegate, and serialize a response. " +
  "Reaching into the data layer from a route couples the HTTP surface to storage, so auth, " +
  "validation, and query shape stop being enforceable in one place.";

export function conventionRationale(input: { kind: string; derivation: string }): ConventionRationale {
  return {
    derivation: input.derivation,
    reason: input.kind === "api_route_no_direct_data_access" ? DELEGATION_REASON : null
  };
}

/**
 * BB-6: which finding statuses are closed, in core so the CLI packet and the MCP packet agree.
 *
 * The predicate used to live only in the CLI. MCP building its own would have meant the two surfaces
 * disagreeing about which findings count as violations, and therefore about which files may be
 * offered as exemplars - a parity failure that would surface as one surface recommending a file the
 * other flags.
 */
const CLOSED_FINDING_STATUSES = new Set(["fixed", "false_positive", "suppressed", "accepted_drift", "expired"]);

export function isClosedFindingStatus(status: string): boolean {
  return CLOSED_FINDING_STATUSES.has(status);
}

export function isOpenFinding(finding: { status: string }): boolean {
  return !isClosedFindingStatus(finding.status);
}
