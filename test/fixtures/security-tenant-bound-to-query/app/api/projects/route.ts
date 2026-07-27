import { requireUser } from "@/server/auth";

const db = { project: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  const session = await requireUser(request);
  const projects = await db.project.findMany({
    where: { tenantId: session.user.tenantId }
  });
  return Response.json({ ok: true, count: projects.length });
}
