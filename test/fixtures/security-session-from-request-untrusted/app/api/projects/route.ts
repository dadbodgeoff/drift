export async function GET(request: Request) {
  const session = request.headers.get("authorization");
  return Response.json({ ok: Boolean(session) });
}
