async function requireUser() {
  return { id: "user_123" };
}

function projectMatcher() {
  return "/api/projects";
}

export async function middleware() {
  await requireUser();
}

export const config = {
  matcher: projectMatcher()
};
