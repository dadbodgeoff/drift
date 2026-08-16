// Conformance: a named origin, which is what the accepted policy is inferred from.
export async function GET() {
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": "https://app.example.com",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
