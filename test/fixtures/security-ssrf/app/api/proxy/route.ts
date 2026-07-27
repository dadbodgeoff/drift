export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  await fetch(target);
  return Response.json({ ok: true });
}
