export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await db.$queryRawUnsafe(`select * from users where id = ${id}`);
  return Response.json({ ok: true });
}
