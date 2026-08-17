import { dbg } from "../../lib/dbg";
export default function handler(req, res) { dbg("hit"); res.json({ ok: true }); }
