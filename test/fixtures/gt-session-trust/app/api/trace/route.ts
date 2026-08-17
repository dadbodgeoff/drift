// NEAR-MISS (TDD §4.3): the same untrusted source — `request.headers.get(...)` — read into a
// variable that is not a session object. A check that merely flagged "route reads a header" would
// flag this route too, and would score identically to a correct one without it.
export async function GET(request: Request) {
  const traceId = request.headers.get("x-trace-id");
  return Response.json({ traceId });
}
