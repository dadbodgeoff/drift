import { undeclaredHelper } from "@acme/open-barrel";

export async function GET() {
  return Response.json({ value: undeclaredHelper() });
}
