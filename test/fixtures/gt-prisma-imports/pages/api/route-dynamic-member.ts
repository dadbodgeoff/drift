// D5.2 RETAIN — AMBIGUITY branch. The member is computed, so no syntactic classification of
// the use exists. Retained under prefer-FP-over-FN, not because invocation was proven.
import { prismaClient } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  const store = req.query.store as string;
  return res.json(await prismaClient[store].findMany());
}
