// D5.2 RETAIN — invocation evidence through an import alias.
import { prismaClient as db } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  return res.json(await db.user.findMany());
}
