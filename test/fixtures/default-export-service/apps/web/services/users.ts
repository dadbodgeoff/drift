import { prisma } from "../lib/prisma";

export default async function listUsers() {
  return prisma.user.findMany();
}
