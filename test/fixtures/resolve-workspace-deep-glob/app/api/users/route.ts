import { db } from "@acme/db";
import { docker } from "@acme/dockerlib";

export async function GET() {
  const rows = await db.query();
  await docker.compose();
  return Response.json({ rows });
}
