// D5.2 RETAIN — AMBIGUITY branch. The client object itself escapes into a callee this rule
// cannot follow, so whether the datastore is touched is unresolved.
import { prismaClient } from "../../lib/prisma";
import { countUsers } from "../../lib/report";

export default async function handler(req: any, res: any) {
  return res.json(await countUsers(prismaClient));
}
