import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { cookies } from "next/headers";
import { sendWelcomeEmail } from "~/lib/server/mail";
import { setSessionTokenCookie } from "~/lib/server/auth/cookies";
import { github } from "~/lib/server/auth/github";
import { createSession, generateSessionToken } from "~/lib/server/auth/session";
import { prisma } from "~/lib/server/db";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return Response.json({ error: "missing_code" }, { status: 400 });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: code } });
    const token = generateSessionToken();
    await createSession(token, user?.id ?? "anonymous");
    await setSessionTokenCookie(await cookies(), token);
    await sendWelcomeEmail(user?.email ?? "nobody@example.com");
    await github.validateAuthorizationCode(code);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      return Response.json({ error: "db_error" }, { status: 409 });
    }
    return Response.json({ error: "unknown" }, { status: 500 });
  }
}
