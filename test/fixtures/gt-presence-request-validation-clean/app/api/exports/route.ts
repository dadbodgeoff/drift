// COMPLIANT. The inverse fixture: every handler calls a family member, so the same accepted family
// must produce zero findings and the check must exit 0.
import { validateQuery } from "@/server/validation";

const db = { export: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateQuery(body);
  await db.export.create({ data: parsed });
  return Response.json({ ok: true });
}
