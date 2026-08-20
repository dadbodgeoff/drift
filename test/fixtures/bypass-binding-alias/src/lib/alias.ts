// E04. `export const client = prisma` - the exported name IS the imported binding.
import { prisma } from "@/lib/prisma";
export const client = prisma;
