const { prisma, db: database } = require("../../../lib/prisma");
const auth = await import("../../../server/auth");

export async function GET() {
  await auth.requireUser();
  return Response.json(await prisma.user.findMany());
}
