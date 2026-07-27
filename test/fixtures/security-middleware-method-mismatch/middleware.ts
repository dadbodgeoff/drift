async function requireUser() {
  return { id: "user_123" };
}

export async function middleware() {
  await requireUser();
}

export const config = {
  matcher: "/api/projects#POST"
};
