import { withSession } from "../../lib/auth";

export default withSession(function handler(req, res, session) {
  const id = req.query.id;
  res.json({ ok: true, route: "session-a", id, userId: session.userId });
});
