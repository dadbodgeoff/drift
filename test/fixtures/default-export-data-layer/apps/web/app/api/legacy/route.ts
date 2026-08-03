// A committed violation via the DEFAULT import, the way cal.com's routes write it. Its presence
// makes inference learn the convention in block mode (a minority violates).
import prisma from "@acme/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
