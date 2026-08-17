// CONFORMANCE. The second call site is what makes `requirePermission` a candidate at all, and it
// is a real conformance route rather than a copy of members/ so the two halves stay independent.
import { requirePermission } from "@/server/authz";

const db = { invoice: { create: async (_query?: unknown) => ({ id: "invoice_1" }) } };

export async function POST() {
  await requirePermission();
  const created = await db.invoice.create({ data: { id: "invoice_1" } });
  return Response.json({ ok: true, id: created.id });
}
