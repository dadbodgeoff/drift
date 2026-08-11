import { prisma } from "../lib/prisma";

export async function createUser() {
  return prisma.user.create({ data: {} });
}
