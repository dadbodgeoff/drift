interface UserRecord {
  id: string;
  email: string;
  password: string;
}

export default function handler(req, res) {
  const user: UserRecord = { id: "1", email: "a@example.com", password: "hunter2" };
  const { password, ...safe } = user;
  res.json(safe);
}
