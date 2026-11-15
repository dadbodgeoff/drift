export function withAuth(handler: (req: Request) => Promise<Response>, opts?: { requiredPermissions?: string[] }) {
  return handler;
}

export async function requireUser() {
  return { id: "u" };
}
