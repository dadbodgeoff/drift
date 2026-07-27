import * as dbModule from "@/lib/db";

export async function GET() {
  return Response.json(await dbModule.db.user.findMany());
}
