export default function handler(req: unknown, res: { json: (v: unknown) => void }) {
  res.json({ ok: true });
}
