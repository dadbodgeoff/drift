import * as db from "@acme/database";

export async function GET() {
  const users = await db.prisma.user.findMany();
  return Response.json({ users });
}
