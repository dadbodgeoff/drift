// VIOLATION — the unambiguous one. A protected write with no authorization guard anywhere in the
// handler. The accepted convention's helper is `requirePermission`; this route never calls it, so
// `build_authorization_proof_from_facts` records `authorization_guard_missing` against the sink.
const db = { project: { delete: async (_query?: unknown) => ({ id: "project_1" }) } };

export async function DELETE() {
  const deleted = await db.project.delete({ where: { id: "project_1" } });
  return Response.json({ ok: true, id: deleted.id });
}
