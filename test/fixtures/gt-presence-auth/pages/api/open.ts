export default function handler(req, res) {
  // No wrapper of any kind. The unambiguous violation.
  const id = req.query.id;
  res.json({ ok: true, route: "open", id, secret: "unauthenticated-data" });
}
