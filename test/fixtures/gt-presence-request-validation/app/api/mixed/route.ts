// ONE handler compliant, ONE not — the per-handler half. `presence_findings` attributes a call to
// a handler by source-span intersection, so this file must produce exactly one finding, on `PUT`,
// and must not be excused file-wide by the validated `POST`.
import { validateBody } from "@/server/validation";

const db = { record: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  await db.record.create({ data: parsed });
  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const body = await request.json();
  await db.record.create({ data: body });
  return Response.json({ ok: true });
}
