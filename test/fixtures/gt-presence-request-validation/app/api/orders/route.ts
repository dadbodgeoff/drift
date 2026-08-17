// COMPLIANT. `validateBody` is a family member and this handler calls it.
import { validateBody } from "@/server/validation";

const db = { order: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  await db.order.create({ data: parsed });
  return Response.json({ ok: true });
}
