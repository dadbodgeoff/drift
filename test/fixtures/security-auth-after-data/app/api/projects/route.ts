import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  const user = await requireUser();
  return Response.json({ projects, user });
}
