// COMPLIANT. The inverse fixture: every handler calls a family member, so the same accepted family
// must produce zero findings and the check must exit 0.
import { validateBody } from "@/server/validation";

const db = { invoice: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  await db.invoice.create({ data: parsed });
  return Response.json({ ok: true });
}
