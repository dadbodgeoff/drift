export interface TenantScope {
  where: { tenantId: string };
}

/** The real helper: it produces the scope every query is expected to be narrowed by. */
export async function requireTenantScope(request: Request): Promise<TenantScope> {
  const tenantId = request.headers.get("x-tenant") ?? "";
  if (!tenantId) {
    throw new Error("no tenant");
  }
  return { where: { tenantId } };
}

/**
 * The near-miss (§4.3). The name is a deliberate hit for every substring
 * `is_tenant_candidate_symbol` looks for — "tenant", "scope" — and it narrows nothing: it compares
 * two ids and returns. `is_tenant_candidate_symbol` rejects it only on the `throwif` prefix, so a
 * detector that dropped that one clause would propose it as a tenant helper and then read the
 * routes that call it as scoped.
 */
export function throwIfTenantScopeMismatch(left: string, right: string): void {
  if (left !== right) {
    throw new Error("tenant mismatch");
  }
}
