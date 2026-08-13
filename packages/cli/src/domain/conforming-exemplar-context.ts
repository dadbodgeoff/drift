import type { AcceptedConvention } from "@drift/core";
import { type ExemplarContext, exemplarContext } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";

import { isOpenPreflightFinding } from "./findings.js";
import { latestIndexedScan } from "./scan-status.js";

/**
 * BB-5/BB-6: read the stored state an exemplar context needs, then hand it to the shared derivation
 * in @drift/core.
 *
 * Only the reads live here. The logic - scope membership, the violator set, the baseline count - is
 * in core so `prepare` and MCP's `get_task_preflight` cannot drift apart, which is what the EW-6
 * parity failure taught and what an exemplar offered by one surface and flagged by the other would
 * reproduce.
 */
export function conformingExemplarContext(
  storage: SqliteDriftStorage,
  repoId: string
): ExemplarContext {
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const roleByFile = new Map<string, string>();
  // What each file imports, so an exemplar can be PROVEN to comply rather than merely lacking a
  // finding. prepare/ask/MCP never run a check, so without this their violator set is whatever
  // happens to be stored - and on a repo where no check has ever run, that is empty, which
  // certified every file in scope as conforming.
  const importsByFile = new Map<string, string[]>();
  if (latestScan) {
    for (const fact of storage.listFacts(latestScan.id, { kind: "file_role_detected" })) {
      roleByFile.set(fact.file_path, fact.name);
    }
    for (const fact of storage.listFacts(latestScan.id, { kind: "import_used" })) {
      const sources = importsByFile.get(fact.file_path) ?? [];
      if (fact.value) {
        sources.push(fact.value);
      }
      importsByFile.set(fact.file_path, sources);
    }
  }
  return exemplarContext({
    scanFiles: latestScan
      ? storage.listFileSnapshots(repoId, latestScan.id).map((snapshot) => snapshot.file_path)
      : [],
    roleByFile,
    importsByFile,
    openFindings: storage.listFindings(repoId).filter(isOpenPreflightFinding),
    activeBaseline: storage.listBaselineViolations(repoId).filter((entry) => entry.status === "active")
  });
}

export type { AcceptedConvention };
