// D5.1 GROUPING, retained. Two offending specifiers on one import line, both invoked.
// Baseline: two findings. After D5.1: one finding naming both. D5.2 keeps it.
import { prismaClient, auditLog } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  const users = await prismaClient.user.findMany();
  await auditLog.write({ users: users.length });
  return res.json({ users });
}
