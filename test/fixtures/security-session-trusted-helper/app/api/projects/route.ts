import { requireUser } from "@/server/auth";

export async function GET(request: Request) {
  const session = await requireUser(request);
  return Response.json({ ok: Boolean(session) });
}
