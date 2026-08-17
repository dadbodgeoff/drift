import { requireTenantScope } from "../../../../server/tenant";

const db = { invoice: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  const scope = await requireTenantScope(request);
  const invoices = await db.invoice.findMany(scope.where);
  return Response.json({ ok: true, count: invoices.length });
}
