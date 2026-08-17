export function requireAuth(req) {
  if (!req.headers.authorization) {
    throw new Error("unauthenticated");
  }
  return { userId: "u1" };
}
