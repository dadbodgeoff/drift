// NEAR-MISS VIOLATION (§4.3). This route DOES call the accepted helper — a presence-only matcher
// scores it clean — but it calls it after the sink has already run. Guard dominance is the whole
// difference, so the expected reason is `authorization_guard_not_dominating_sink`, not
// `authorization_guard_missing`.
import { requirePermission } from "@/server/authz";

const db = { audit: { deleteMany: async (_query?: unknown) => ({ count: 1 }) } };

export async function DELETE() {
  const purged = await db.audit.deleteMany({ where: { id: "audit_1" } });
  await requirePermission();
  return Response.json({ ok: true, count: purged.count });
}
