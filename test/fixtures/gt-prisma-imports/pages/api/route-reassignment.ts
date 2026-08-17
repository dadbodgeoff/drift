// D5.2 RETAIN — the specifier's value is read into a local and the local is invoked.
// TDD §5.5's `const q = db.query; q()`.
import { prismaClient } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  const q = prismaClient.user.findMany;
  return res.json(await q());
}
