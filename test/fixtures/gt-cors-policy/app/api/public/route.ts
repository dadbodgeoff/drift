// Violation: wildcard origin WITH credentials, the shape the accepted policy forbids.
export async function GET() {
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
