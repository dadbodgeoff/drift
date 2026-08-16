// D5.2 RETAIN — `new` instantiation. The genuine violation shape (TDD §5.5).
import { PrismaClient } from "@prisma/client";

export default async function handler(req: any, res: any) {
  const client = new PrismaClient();
  return res.json(await client.user.findMany());
}
