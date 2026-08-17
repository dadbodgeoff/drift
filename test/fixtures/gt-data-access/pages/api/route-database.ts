import { connect } from "../../lib/database";
export default function handler(req, res) { res.json(connect()); }
