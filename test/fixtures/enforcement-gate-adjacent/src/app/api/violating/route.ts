// S1-01: a complete, unambiguous violation. On its own this exits 2 with enforcement_result "block".
import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
