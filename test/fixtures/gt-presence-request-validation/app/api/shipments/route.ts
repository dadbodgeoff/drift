// VIOLATION, plain. The request body reaches a data sink and this handler calls no family member.
const db = { shipment: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  await db.shipment.create({ data: body });
  return Response.json({ ok: true });
}
