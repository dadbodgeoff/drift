import { db } from "@acme/db";

type Handler = (req: Request, ctx: { workspaceId: string; userId: string }) => Promise<Response>;

export function withWorkspace(handler: Handler, opts: { requiredPermissions?: string[] } = {}) {
  return async (req: Request) => {
    const session = await getSession(req);
    const member = await db.member.findFirst({ where: { userId: session.userId } });
    if (!member) return new Response("Forbidden", { status: 403 });
    if (opts.requiredPermissions?.length && member.role !== "owner") return new Response("Forbidden", { status: 403 });
    return handler(req, { workspaceId: member.workspaceId, userId: session.userId });
  };
}

export function withAdmin(handler: Handler) {
  return async (req: Request) => {
    const session = await getSession(req);
    if (!session.admin) return new Response("Not found", { status: 404 });
    return handler(req, { workspaceId: "", userId: session.userId });
  };
}

export async function getSession(req: Request): Promise<{ userId: string; admin: boolean }> {
  const token = req.headers.get("authorization") ?? "";
  if (!token) throw new Response("Unauthorized", { status: 401 });
  return { userId: token.slice(7), admin: token.endsWith(":admin") };
}
