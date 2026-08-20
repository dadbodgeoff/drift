// Negative: the returned `prisma` is a local, not the import.
import { prisma } from "@/lib/prisma";
export function getClient() {
  const prisma = { user: {} };
  return prisma;
}
