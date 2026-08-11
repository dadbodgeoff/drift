import { sanitizeRedirectPath } from "@acme/utils/sanitize-redirect";

export async function GET() {
  return Response.json({ path: sanitizeRedirectPath("/") });
}
