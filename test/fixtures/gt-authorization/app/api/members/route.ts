// CONFORMANCE. The guard runs on the straight line before the sink, so the proof is complete and
// this route must produce no finding.
import { requirePermission } from "@/server/authz";

const db = { member: { update: async (_query?: unknown) => ({ id: "member_1" }) } };

export async function PATCH() {
  await requirePermission();
  const updated = await db.member.update({ where: { id: "member_1" } });
  return Response.json({ ok: true, id: updated.id });
}
