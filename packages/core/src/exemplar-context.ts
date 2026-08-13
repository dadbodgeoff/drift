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
  /**
   * Every file violating ANY accepted convention.
   *
   * This is what "conforming" means from CV-5 on, and it is the correct generalization of BB-5's
   * invariant rather than an extension of it. BB-5 asked whether a file conforms to the convention
   * being described; with one accepted convention those were the same question. CV-5 made a repo able
   * to accept more than one, and they came apart immediately: on dub a file conforming to
   * `api_route_no_direct_data_access` can violate the auth family, and offering it as a conforming
   * example sends an agent to open a file that breaks another accepted rule. That is the trial-B1
   * defection trigger, which is the whole reason BB-5 exists - so the honest reading of its invariant
   * was always "zero open findings", not "zero open findings of this kind".
   *
   * Baselined violations are included, for BB-5's original reason: a baselined violation is still a
   * violation, and citing one as an exemplar is the same defection trigger with a different excuse.
   */
  violatingFilesAnyConvention(): Set<string>;
  baselineActiveCountFor(conventionId: string): number;
  /** `import_used` fact values by file path, for verifying an exemplar rather than assuming it. */
  importsByFile: Map<string, string[]>;
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
  /** `import_used` facts: file path -> the specifiers that file imports. */
  importsByFile?: Map<string, string[]>;
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
  let anyViolatorCache: Set<string> | undefined;

  return {
    roleByFile: input.roleByFile ?? new Map<string, string>(),
    importsByFile: input.importsByFile ?? new Map<string, string[]>(),
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
    violatingFilesAnyConvention() {
      if (!anyViolatorCache) {
        anyViolatorCache = new Set<string>();
        for (const files of violatingByConvention.values()) {
          for (const file of files) {
            anyViolatorCache.add(file);
          }
        }
      }
      return anyViolatorCache;
    },
    baselineActiveCountFor(conventionId) {
      return input.activeBaseline.filter((entry) => entry.convention_id === conventionId).length;
    }
  };
}
