// VIOLATION, line 4: the session object is built straight off the request headers rather than
// obtained from the accepted trusted helper (`requireUser` in server/auth.ts).
export async function GET(request: Request) {
  const session = request.headers.get("x-session-user");
  return Response.json({ userId: session });
}
