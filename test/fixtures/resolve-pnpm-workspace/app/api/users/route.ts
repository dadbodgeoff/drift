import { prisma } from "@acme/database";
import { client } from "@acme/database/src/client";
import { legacy } from "@acme/database-legacy";
import type { DatabaseMarker } from "@acme/database";

export async function GET() {
  const users = await prisma.user.findMany();
  const rows = await client.query();
  await legacy.migrate();
  const marker: DatabaseMarker | null = null;
  return Response.json({ users, rows, marker });
}
