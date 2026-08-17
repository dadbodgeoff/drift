import { throwIfTenantScopeMismatch } from "../../../../server/tenant";

const db = { export: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  throwIfTenantScopeMismatch(request.headers.get("x-tenant") ?? "", "");
  const exports = await db.export.findMany();
  return Response.json({ ok: true, count: exports.length });
}
