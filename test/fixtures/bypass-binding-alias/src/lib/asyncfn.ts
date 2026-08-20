// Negative: an async function returns a Promise, not the binding.
import { prisma } from "@/lib/prisma";
export async function getClient() {
  return prisma;
}
