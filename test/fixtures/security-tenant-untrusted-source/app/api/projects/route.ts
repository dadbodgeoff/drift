const db = { project: { findMany: async (_query?: unknown) => [] } };

export async function POST(request: Request) {
  const body = await request.json();
  const projects = await db.project.findMany({ where: { tenantId: body.tenantId } });
  return Response.json({ ok: true, count: projects.length });
}
