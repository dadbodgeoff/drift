export async function GET(req: Request) {
  return Response.json({ ok: true, path: new URL(req.url).pathname });
}
