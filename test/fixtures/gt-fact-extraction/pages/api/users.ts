import { queryUsers } from "../../lib/db";

export default function handler(req, res) {
  const users = queryUsers();
  res.json(users);
}
