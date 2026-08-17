// NEAR-MISS VIOLATION (§4.3). `logPermissionCheck` is a deliberate hit for
// `is_authorization_candidate_symbol` (candidate_command.rs:1885 — its lowercased name contains
// "permission"), and it guards nothing. It is called from exactly one route file, which keeps it
// under the >= 2 threshold `push_guard_candidate` needs, so it must never become a candidate; and
// because it is not the accepted helper, this route must still be flagged
// `authorization_guard_missing`. Drop this route and a detector that matched /permission/i on the
// symbol name would score identically to the real one.
import { logPermissionCheck } from "@/server/authz";

const db = { report: { update: async (_query?: unknown) => ({ id: "report_1" }) } };

export async function PUT() {
  logPermissionCheck();
  const updated = await db.report.update({ where: { id: "report_1" } });
  return Response.json({ ok: true, id: updated.id });
}
