// E05. Every return of the exported function is the imported binding.
import { prisma } from "@/lib/prisma";
export function getClient() {
  return prisma;
}
