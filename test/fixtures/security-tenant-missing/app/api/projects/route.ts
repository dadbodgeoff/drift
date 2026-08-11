import { requireUser } from "@/server/auth";

const db = { project: { findMany: async (_query?: unknown) => [] } };

export async function GET(request: Request) {
  const session = await requireUser(request);
  const concreteSessionValue = "session-concrete-value-should-not-leak";
  const concreteUserId = "user-actual-id-should-not-leak";
  const concreteTenantId = "tenant-actual-value";
  const concreteHeader = request.headers.get("x-tenant-debug") ?? "header-actual-value-should-not-leak";
  const concreteCookie = request.headers.get("cookie") ?? "cookie-actual-value-should-not-leak";
  const payload = await request.json().catch(() => ({ secret: "payload-actual-value-should-not-leak" }));
  const rawSql = "select * from projects where tenant_id = 'raw-sql-tenant-value-should-not-leak'";
  const projects = await db.project.findMany();
  return Response.json({
    ok: true,
    count: projects.length,
    session: Boolean(session),
    debug: Boolean(
      concreteSessionValue &&
        concreteUserId &&
        concreteTenantId &&
        concreteHeader &&
        concreteCookie &&
        payload &&
        rawSql
    )
  });
}
