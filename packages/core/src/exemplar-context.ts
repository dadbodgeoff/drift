import type { AcceptedConvention, BaselineViolation, Finding } from "./domain.js";
import { conventionScopeFiles } from "./convention-scope.js";

/**
 * BB-5/BB-6: the three facts exemplar selection needs about a convention, derived from stored state.
 *
 * In core rather than in either surface, because `prepare` (CLI) and `get_task_preflight` (MCP) both
 * need them and neither package can import the other. Two implementations would eventually disagree,
 * and a disagreement here means one surface offering a file as an example of a rule the other surface
 * flags - the exact failure BB-5 exists to prevent, and the shape of the EW-6 parity bug.
 *
 * Takes plain arrays rather than a storage handle so it stays testable and so the storage package
 * does not become a dependency of core.
 */
export interface ExemplarContext {
  roleByFile: Map<string, string>;
  scopeFilesFor(convention: AcceptedConvention): string[];
  violatingFilesFor(conventionId: string): Set<string>;
  baselineActiveCountFor(conventionId: string): number;
}

export function exemplarContext(input: {
  /** Every file the latest scan saw. */
  scanFiles: string[];
  /** `file_role_detected` facts: file path -> role. */
  roleByFile?: Map<string, string>;
  /** Open findings. Callers filter for openness; this treats every one it is given as a violation. */
  openFindings: Array<Pick<Finding, "convention_id" | "evidence_refs">>;
  /** Active baseline entries only. */
  activeBaseline: Array<Pick<BaselineViolation, "convention_id" | "file_path">>;
}): ExemplarContext {
  const violatingByConvention = new Map<string, Set<string>>();
  const addViolator = (conventionId: string, filePath: string) => {
    const set = violatingByConvention.get(conventionId) ?? new Set<string>();
    set.add(filePath);
    violatingByConvention.set(conventionId, set);
  };
  for (const finding of input.openFindings) {
    for (const ref of finding.evidence_refs) {
      addViolator(finding.convention_id, ref.file_path);
    }
  }
  // A baselined violation is still a violation. Citing one as an exemplar is precisely the defection
  // trigger observed in trial B1, so the baseline feeds this set rather than excusing it.
  for (const entry of input.activeBaseline) {
    addViolator(entry.convention_id, entry.file_path);
  }

  // Scope membership is a glob pass over every scanned file, so memoize per convention.
  const scopeFileCache = new Map<string, string[]>();

  return {
    roleByFile: input.roleByFile ?? new Map<string, string>(),
    scopeFilesFor(convention) {
      const cached = scopeFileCache.get(convention.id);
      if (cached) {
        return cached;
      }
      const files = conventionScopeFiles(input.scanFiles, convention);
      scopeFileCache.set(convention.id, files);
      return files;
    },
    violatingFilesFor(conventionId) {
      return violatingByConvention.get(conventionId) ?? new Set<string>();
    },
    baselineActiveCountFor(conventionId) {
      return input.activeBaseline.filter((entry) => entry.convention_id === conventionId).length;
    }
  };
}
