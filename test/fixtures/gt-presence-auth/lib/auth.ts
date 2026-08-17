// Two interchangeable route wrappers from one module. Two is the threshold: a one-member
// family is identical in effect to the per-symbol candidate that already exists, so the
// proposer declines to emit it (candidate_command.rs, `members.len() < 2`).
export function withSession(handler) {
  return function wrapped(req, res) {
    if (!req.headers.authorization) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    return handler(req, res, { userId: "u1" });
  };
}

export function withAdmin(handler) {
  return function wrapped(req, res) {
    if (req.headers["x-role"] !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    return handler(req, res, { userId: "u1", role: "admin" });
  };
}
