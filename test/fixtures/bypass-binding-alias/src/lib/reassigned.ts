// Negative: the alias claim is false after the reassignment.
import { prisma } from "@/lib/prisma";
export let client = prisma;
client = null as never;
