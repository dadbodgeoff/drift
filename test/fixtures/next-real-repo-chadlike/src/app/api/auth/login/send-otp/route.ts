import { prisma } from "~/lib/server/db";

export async function POST() {
  await prisma.otp.create({ data: { email: "user@example.com" } });
  return Response.json({ ok: true });
}
