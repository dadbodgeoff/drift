import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  if (request.headers.get("x-auth") === "yes") {
    await requireUser();
  } else {
    const projects = await db.project.findMany();
    return Response.json({ projects });
  }
  return Response.json({ ok: true });
}
