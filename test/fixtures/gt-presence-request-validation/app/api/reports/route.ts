// COMPLIANT. `validateQuery` is the family's SECOND member. Two are required: a one-member family
// is suppressed as a duplicate of the per-symbol candidate (candidate_command.rs, `members.len() < 2`).
import { validateQuery } from "@/server/validation";

const db = { report: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateQuery(body);
  await db.report.create({ data: parsed });
  return Response.json({ ok: true });
}
