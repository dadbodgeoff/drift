// NEGATIVE CONTROL for route-flavour scoping, not a miss. A `webhooks` path segment classifies
// this route as `webhook_handler` (facts.rs, WEBHOOK_SEGMENTS). Every family member is evidenced
// only in api_route files, so the family is emitted conditioned on `applies_to_route_flavors:
// ["api_route"]` and this route is out of scope. It is unvalidated on purpose: it must stay
// SILENT, which is what proves the conditioning is real rather than incidental.
const db = { webhook: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  await db.webhook.create({ data: body });
  return Response.json({ ok: true });
}
