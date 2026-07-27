import { requireUser } from "@/server/auth";

const db = { project: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  const session = await requireUser(request);
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  void tenantId;
  const projects = await db.project.findMany();
  return Response.json({ ok: true, count: projects.length, session: Boolean(session) });
}
