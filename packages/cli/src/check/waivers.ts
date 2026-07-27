import type { AcceptedConvention,RepoContract } from "@drift/core";
import { matchesGlob } from "../domain/repo-paths.js";

export interface ConventionExceptionContext {
  filePath: string;
  symbol?: string;
  importSource?: string;
  endpointPaths?: string[];
  methods?: string[];
  resolvedModules?: string[];
  resolvedSymbols?: string[];
  dataStores?: string[];
  operationKinds?: string[];
}

export function isExceptedPath(filePath: string, convention: AcceptedConvention, now: string): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    exceptionMatchesContext(exception, { filePath }, now)
  );
}

export function isExceptedImport(
  filePath: string,
  symbol: string,
  importSource: string,
  convention: AcceptedConvention,
  now: string,
  context: Omit<ConventionExceptionContext, "filePath" | "symbol" | "importSource"> = {}
): boolean {
  return convention.exceptions.some((exception) =>
    isActiveException(exception, now) &&
    exceptionMatchesContext(exception, { filePath, symbol, importSource, ...context }, now)
  );
}

export function exceptionMatchesContext(
  exception: AcceptedConvention["exceptions"][number],
  context: ConventionExceptionContext,
  now: string
): boolean {
  if (!isActiveException(exception, now)) {
    return false;
  }
  const checks = [
    selectorMatches(exception.path_globs, [context.filePath], (glob, value) => matchesGlob(value, glob)),
    selectorMatches(exception.symbols, context.symbol ? [context.symbol] : []),
    selectorMatches(exception.imports, context.importSource ? [context.importSource] : []),
    selectorMatches(exception.endpoint_paths, context.endpointPaths ?? []),
    selectorMatches(exception.methods, context.methods ?? []),
    selectorMatches(exception.resolved_modules, context.resolvedModules ?? [], (glob, value) => matchesGlob(value, glob)),
    selectorMatches(exception.resolved_symbols, context.resolvedSymbols ?? []),
    selectorMatches(exception.data_stores, context.dataStores ?? [], undefined, "all"),
    selectorMatches(exception.operation_kinds, context.operationKinds ?? [], undefined, "all")
  ];
  return checks.some((check) => check.configured) &&
    checks.every((check) => !check.configured || check.matched);
}

function selectorMatches(
  selectors: string[] | undefined,
  values: string[],
  matches: (selector: string, value: string) => boolean = (selector, value) => selector === value,
  mode: "any" | "all" = "any"
): { configured: boolean; matched: boolean } {
  const uniqueSelectors = [...new Set(selectors ?? [])];
  if (uniqueSelectors.length === 0) {
    return { configured: false, matched: false };
  }
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) {
    return { configured: true, matched: false };
  }
  if (mode === "all") {
    return {
      configured: true,
      matched: uniqueValues.every((value) => uniqueSelectors.some((selector) => matches(selector, value)))
    };
  }
  return {
    configured: true,
    matched: uniqueValues.some((value) => uniqueSelectors.some((selector) => matches(selector, value)))
  };
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

export function findContractWaiverForPath(
  filePath: string,
  contract: RepoContract,
  now: string
): RepoContract["waivers"][number] | undefined {
  return contract.waivers.find((waiver) => {
    if (!isActiveException(waiver, now)) {
      return false;
    }
    const pathGlobs = waiver.path_globs ?? [];
    if (pathGlobs.length === 0) {
      return false;
    }
    return pathGlobs.some((glob) => matchesGlob(filePath, glob));
  });
}

export function waiverRequiresReapproval(
  waiver: RepoContract["waivers"][number],
  filePath: string,
  currentContentHash: string | undefined
): boolean {
  if (!waiver.requires_reapproval_on_change) {
    return false;
  }
  if (!currentContentHash) {
    return true;
  }
  return !(waiver.approved_file_hashes ?? []).some((entry) =>
    entry.file_path === filePath && entry.content_hash === currentContentHash
  );
}

export function isActiveException(
  exception: AcceptedConvention["exceptions"][number],
  now: string
): boolean {
  return !exception.expires_at || exception.expires_at > now;
}
