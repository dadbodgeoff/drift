import { requireRole, requireUser } from "@/server/auth";

const db = { project: { delete: async (_query?: unknown) => ({ id: "project_1" }) } };

export async function DELETE(request: Request) {
  const session = await requireUser(request);
  if (request.headers.get("x-admin") === "true") {
    requireRole(session.user, "admin");
  }
  const deleted = await db.project.delete({ where: { id: "project_1" } });
  return Response.json({ ok: true, id: deleted.id });
}
