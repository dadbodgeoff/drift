// D5.2 RETAIN — measured against papermark, not invented. Two of the audit's 35
// `@prisma/client` findings are this shape: `Prisma.sql` tagged templates building raw SQL
// fragments that `prisma.$queryRaw` then executes. The audit's hand-check recorded all 35 as
// inert enum imports; these two are member CALLS on a datastore surface. A tagged template is
// a call_expression, so the classifier sees it — the hand-check did not.
import { Prisma } from "@prisma/client";
import { prismaClient } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  const filter = req.query.q ? Prisma.sql`AND email LIKE ${req.query.q}` : Prisma.empty;
  return res.json(await prismaClient.user.findMany({ filter }));
}
