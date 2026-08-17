import { withAdmin } from "../../lib/auth";

export default withAdmin(function handler(req, res, session) {
  const id = req.query.id;
  res.json({ ok: true, route: "admin-b", id, role: session.role });
});
