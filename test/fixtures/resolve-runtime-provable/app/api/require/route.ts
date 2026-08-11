export async function GET() {
  const db = require("@acme/database");
  const users = await db.prisma.user.findMany();
  return Response.json({ users });
}
