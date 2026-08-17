export default function handler(req, res) {
  // BUG (intentional): no auth check before returning data.
  res.json({ secret: "unauthenticated-data" });
}
