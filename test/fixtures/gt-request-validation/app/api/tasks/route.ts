// COMPLIANT. `TaskInputSchema.safeParse` is the accepted validator, the `!success` guard exits,
// and only `result.data` reaches the sink.
import { TaskInputSchema } from "@/server/validation";

const db = { task: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const result = TaskInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  await db.task.create({ data: result.data });
  return Response.json({ ok: true });
}
