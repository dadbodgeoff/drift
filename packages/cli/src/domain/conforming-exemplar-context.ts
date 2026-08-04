import type { AcceptedConvention } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";

import { filesForConvention } from "../check/diff.js";
import { isOpenPreflightFinding } from "./findings.js";
import { latestIndexedScan } from "./scan-status.js";

/**
 * BB-5: the stored-state side of exemplar selection, shared by `prepare` and `ask`.
 *
 * Two surfaces need the same three facts about a convention - which files are in its scope, which of
 * those already violate it, and how many violations are baselined - and two implementations of that
 * would eventually disagree. A disagreement here means one surface offering a file as an example of
 * a rule that the other surface flags, which is the exact failure BB-5 exists to prevent.
 *
 * Scope membership is delegated to `filesForConvention`, the same function the enforcement path
 * uses, rather than re-derived from globs. Re-deriving it is what produced F3: the CLI's own glob
 * matching silently disagreed with the engine's route detection and disabled enforcement for the
 * default create-next-app layout while still reporting `can_block: true`.
 */
export interface ConformingExemplarContext {
  roleByFile: Map<string, string>;
  scopeFilesFor(convention: AcceptedConvention): string[];
  violatingFilesFor(conventionId: string): Set<string>;
  baselineActiveCountFor(conventionId: string): number;
}

export function conformingExemplarContext(
  storage: SqliteDriftStorage,
  repoId: string
): ConformingExemplarContext {
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const scanFiles = latestScan
    ? storage.listFileSnapshots(repoId, latestScan.id).map((snapshot) => snapshot.file_path)
    : [];

  const roleByFile = new Map<string, string>();
  if (latestScan) {
    for (const fact of storage.listFacts(latestScan.id, { kind: "file_role_detected" })) {
      roleByFile.set(fact.file_path, fact.name);
    }
  }

  const violatingByConvention = new Map<string, Set<string>>();
  const addViolator = (conventionId: string, filePath: string) => {
    const set = violatingByConvention.get(conventionId) ?? new Set<string>();
    set.add(filePath);
    violatingByConvention.set(conventionId, set);
  };
  for (const finding of storage.listFindings(repoId)) {
    // Open findings only for the violation set, but note that `isOpenPreflightFinding` keeps
    // pre-existing ones: a baselined violation is still a violation, and citing one as an exemplar
    // is the defection trigger from trial B1.
    if (!isOpenPreflightFinding(finding)) {
      continue;
    }
    for (const ref of finding.evidence_refs) {
      addViolator(finding.convention_id, ref.file_path);
    }
  }

  const baselineEntries = storage.listBaselineViolations(repoId).filter((entry) => entry.status === "active");
  for (const entry of baselineEntries) {
    addViolator(entry.convention_id, entry.file_path);
  }

  // Scope files are the expensive part (a glob pass over every scanned file), so memoize per
  // convention: `prepare` asks once per convention and `ask` can ask for several.
  const scopeFileCache = new Map<string, string[]>();
  const allFilesDiff = {
    files: scanFiles.map((path) => ({ path, changedLines: new Set<number>(), isAdded: false })),
    deletedFiles: [] as string[]
  };

  return {
    roleByFile,
    scopeFilesFor(convention) {
      const cached = scopeFileCache.get(convention.id);
      if (cached) {
        return cached;
      }
      const files = filesForConvention(allFilesDiff, convention, "full");
      scopeFileCache.set(convention.id, files);
      return files;
    },
    violatingFilesFor(conventionId) {
      return violatingByConvention.get(conventionId) ?? new Set<string>();
    },
    baselineActiveCountFor(conventionId) {
      return baselineEntries.filter((entry) => entry.convention_id === conventionId).length;
    }
  };
}
