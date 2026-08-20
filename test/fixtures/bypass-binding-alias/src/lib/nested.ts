// Negative: the return belongs to an inner callback, not to the exported function.
import { prisma } from "@/lib/prisma";
export function getClient() {
  [1].forEach(() => {
    return prisma;
  });
}
