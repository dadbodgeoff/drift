const db = { project: { findMany: async (_query?: unknown) => [] } };

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ ok: true, count: projects.length });
}
