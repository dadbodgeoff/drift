import { prisma } from "~/lib/server/db";

export function generateSessionToken() {
  return "session-token";
}

export async function createSession(token: string, userId: string) {
  await prisma.user.findUnique({ where: { id: userId } });
  return { token, userId };
}

export async function getCurrentSession() {
  await prisma.user.findUnique({ where: { id: "u1" } });
  return { userId: "u1" };
}
