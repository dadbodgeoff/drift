// Negative: not every return is the binding.
import { prisma } from "@/lib/prisma";
export function getClient(flag: boolean) {
  if (flag) {
    return prisma;
  }
  return null as never;
}
