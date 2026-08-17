// VIOLATION. The request body reaches a data sink with no accepted validator between them.
// The unvalidated sink is the `db.project.create` on line 7.
const db = { project: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
