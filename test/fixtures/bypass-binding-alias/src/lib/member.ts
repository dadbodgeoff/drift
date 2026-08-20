// Negative: member expression. The fact model has no member path.
import { prisma } from "@/lib/prisma";
export const q = prisma.user;
