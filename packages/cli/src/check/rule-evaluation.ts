import type { AcceptedConvention,EnforcementMode,Finding } from "@drift/core";

export function isForbiddenImport(importSource: string, forbiddenImports: string[]): boolean {
  return forbiddenImports.some((forbidden) =>
    importSource === forbidden || importSource.includes(forbidden)
  );
}

export function isActiveConvention(convention: AcceptedConvention, now: string): boolean {
  return !convention.expires_at || convention.expires_at > now;
}

export function enforcementResultFor(mode: EnforcementMode): Finding["enforcement_result"] {
  if (mode === "block") {
    return "block";
  }
  if (mode === "warn") {
    return "warn";
  }
  return "none";
}
