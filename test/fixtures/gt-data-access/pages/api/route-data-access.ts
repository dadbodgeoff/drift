import { loadOrders } from "../../lib/data-access/orders";
export default function handler(req, res) { res.json(loadOrders()); }
