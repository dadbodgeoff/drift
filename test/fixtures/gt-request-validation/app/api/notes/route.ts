// COMPLIANT. Second occurrence of the `safeParse` shape, which is what lifts it above the
// proposer's `facts.len() >= 2` floor and makes the candidate exist at all.
import { NoteInputSchema } from "@/server/validation";

const db = { note: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const result = NoteInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  await db.note.create({ data: result.data });
  return Response.json({ ok: true });
}
