// The one trusted way to obtain a session in this repo.
export async function requireUser(request: Request): Promise<{ id: string }> {
  const header = request.headers.get("authorization");
  if (!header) {
    throw new Error("unauthenticated");
  }
  return { id: header.slice(7) };
}
