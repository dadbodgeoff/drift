import { useMemo } from "react";
import type { RepoFacts } from "@/shared/contract/drift";
import { indexFacts } from "./model";

export * from "./model";

export function useFactsIndex(facts: RepoFacts | undefined | null) {
  return useMemo(() => (facts ? indexFacts(facts) : null), [facts]);
}
