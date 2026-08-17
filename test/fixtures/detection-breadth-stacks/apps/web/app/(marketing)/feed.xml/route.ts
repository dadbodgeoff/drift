// openstatus's real shape - a route handler inside a route group serving a URL with a dot in it -
// carrying the second D-H3 vocabulary entry.
import { reporting } from "@stacks/kysely";

export async function GET() {
  const rows = await reporting.selectFrom("reports").execute();
  return new Response(String(rows), { headers: { "content-type": "application/xml" } });
}
