import { requireAuth } from "../../lib/auth";
export default function handler(req, res) {
  const user = requireAuth(req);
  res.json({ ok: true, userId: user.userId });
}
