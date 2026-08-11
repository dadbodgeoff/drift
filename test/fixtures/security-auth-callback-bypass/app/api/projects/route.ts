import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  ["auth"].forEach(async () => {
    await requireUser();
  });
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
