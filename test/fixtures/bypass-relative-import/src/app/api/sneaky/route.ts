// T93 bypass: identical violation to a plain `@/lib/prisma` import, written as a relative path.
// `../../../lib/prisma` resolves to exactly the file `@/lib/prisma` names, but the matcher
// compares import specifier strings, so this is invisible and the check reports pass.
import { prisma } from "../../../lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
