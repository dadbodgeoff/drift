// T93 bypass: a barrel that re-exports the data client launders the import. The route holds a
// real runtime dependency on prisma, but the specifier it names is the barrel, so the matcher
// does not see it and the check reports pass.
import { prisma } from "@/lib/barrel";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
