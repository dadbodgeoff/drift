import { createSession, generateSessionToken } from "~/lib/server/auth/session";
import { setSessionTokenCookie } from "~/lib/server/auth/cookies";
import { prisma } from "~/lib/server/db";

export async function POST() {
  const otp = await prisma.otp.findFirst();
  const token = generateSessionToken();
  await createSession(token, otp?.email ?? "anonymous");
  await setSessionTokenCookie(null, token);
  return Response.json({ ok: true });
}
