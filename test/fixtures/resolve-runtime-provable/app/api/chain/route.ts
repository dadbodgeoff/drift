import { prisma } from "@acme/database";

export async function GET() {
  const users = await prisma.user.findMany();
  return Response.json({ users });
}
