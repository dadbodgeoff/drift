// COMPLIANT. Second file for `validateBody`, which is what clears the family's
// `unique_fact_file_count >= 2` floor for that member.
import { validateBody } from "@/server/validation";

const db = { invoice: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  await db.invoice.create({ data: parsed });
  return Response.json({ ok: true });
}
