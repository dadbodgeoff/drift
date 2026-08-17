interface UserRecord {
  id: string;
  email: string;
  password: string;
}

export default function handler(req, res) {
  const user: UserRecord = { id: "1", email: "a@example.com", password: "hunter2" };
  res.json({ id: user.id, email: user.email, password: user.password });
}
