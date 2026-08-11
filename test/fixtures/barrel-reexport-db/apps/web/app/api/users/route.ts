import { db } from "../../../lib";

export async function GET() {
  return Response.json(await db.user.findMany());
}
