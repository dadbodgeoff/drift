export async function GET() {
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
