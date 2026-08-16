import { rawQuery } from "../../lib/db";
export default function handler(req, res) { res.json(rawQuery("select 1")); }
