import type { AcceptedConvention,EnforcementMode,Finding } from "@drift/core";

/**
 * Match a forbidden import specifier.
 *
 * Exact match, or a prefix that ends on a path-segment boundary. Bare `includes` was
 * wrong in both directions: forbidding `@/lib/db` also matched `@/lib/dbutils` and
 * `@scope/lib/db-legacy`, while a subpath like `@calcom/prisma/enums` genuinely should
 * match a forbidden `@calcom/prisma`. Requiring the next character to be `/` keeps the
 * subpath behaviour and drops the accidental substring hits.
 *
 * Mirrored in crates/drift-engine/src/rules.rs - keep the two in step.
 */
export function isForbiddenImport(importSource: string, forbiddenImports: string[]): boolean {
  return forbiddenImports.some(
    (forbidden) =>
      importSource === forbidden ||
      (importSource.startsWith(forbidden) && importSource[forbidden.length] === "/")
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
