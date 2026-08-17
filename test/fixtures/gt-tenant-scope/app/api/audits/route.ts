import { throwIfTenantScopeMismatch } from "../../../../server/tenant";

const db = { audit: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  throwIfTenantScopeMismatch(request.headers.get("x-tenant") ?? "", "");
  const audits = await db.audit.findMany();
  return Response.json({ ok: true, count: audits.length });
}
