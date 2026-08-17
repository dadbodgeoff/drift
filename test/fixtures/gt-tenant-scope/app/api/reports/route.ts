import { requireTenantScope } from "../../../../server/tenant";

const db = { report: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  const scope = await requireTenantScope(request);
  const reports = await db.report.findMany(scope.where);
  return Response.json({ ok: true, count: reports.length });
}
