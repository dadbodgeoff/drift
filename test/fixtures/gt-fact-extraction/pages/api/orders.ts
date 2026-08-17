import { queryUsers } from "../../lib/db";
import { helperUnused } from "../../lib/db";

export default function handler(req, res) {
  const x = helperUnused();
  res.json({ x });
}
