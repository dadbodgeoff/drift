import type { AcceptedConvention,RepoContract } from "@drift/core";
import { matchesGlob } from "../domain/repo-paths.js";

export function isExceptedPath(filePath: string, convention: AcceptedConvention, now: string): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    (exception.path_globs ?? []).some((glob) => matchesGlob(filePath, glob))
  );
}

export function isExceptedImport(
  filePath: string,
  symbol: string,
  importSource: string,
  convention: AcceptedConvention,
  now: string
): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    (
      (exception.path_globs ?? []).some((glob) => matchesGlob(filePath, glob)) ||
      (exception.symbols ?? []).includes(symbol) ||
      (exception.imports ?? []).includes(importSource)
    )
  );
}

export function findContractWaiverForImport(
  filePath: string,
  symbol: string,
  importSource: string,
  contract: RepoContract,
  now: string
): RepoContract["waivers"][number] | undefined {
  return contract.waivers.find((waiver) => {
    if (!isActiveException(waiver, now)) {
      return false;
    }
    const pathGlobs = waiver.path_globs ?? [];
    const symbols = waiver.symbols ?? [];
    const imports = waiver.imports ?? [];
    if (pathGlobs.length === 0 && symbols.length === 0 && imports.length === 0) {
      return false;
    }
    const pathMatches = pathGlobs.length === 0 ||
      pathGlobs.some((glob) => matchesGlob(filePath, glob));
    const symbolMatches = symbols.length === 0 || symbols.includes(symbol);
    const importMatches = imports.length === 0 || imports.includes(importSource);
    return pathMatches && symbolMatches && importMatches;
  });
}

export function isActiveException(
  exception: AcceptedConvention["exceptions"][number],
  now: string
): boolean {
  return !exception.expires_at || exception.expires_at > now;
}
