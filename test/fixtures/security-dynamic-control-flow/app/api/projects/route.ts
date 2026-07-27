import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

const guards = { requireUser };

export async function GET(request: Request) {
  const guard = guards[request.headers.get("x-guard") as keyof typeof guards];
  await guard();
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
