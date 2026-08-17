// COMPLIANT. Second file for `validateQuery`.
import { validateQuery } from "@/server/validation";

const db = { export: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateQuery(body);
  await db.export.create({ data: parsed });
  return Response.json({ ok: true });
}
