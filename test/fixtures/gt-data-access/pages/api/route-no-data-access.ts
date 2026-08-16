import { describeNoDataAccessHere } from "../../lib/no-data-access-here";
export default function handler(req, res) { res.json({ note: describeNoDataAccessHere() }); }
