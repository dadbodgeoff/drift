// A committed violation, so inference learns the data-access convention in block mode
// (a minority of routes violates). Not in the diff for the tests that matter.
import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
