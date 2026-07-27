import { db } from "@acme/db";

export async function GET() {
  return Response.json(await db.user.findMany());
}
