export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  const rows = await db.$queryRaw`select * from users where id = ${id}`;
  return Response.json({ count: rows.length });
}
