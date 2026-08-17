// VIOLATION, and the §4.3 near-miss. Both calls here are the shapes the proposer's table
// deliberately excludes: `revalidateTag` is Next.js cache revalidation and `hasPermission` belongs
// to the authorization family. Neither may join the request-validation family, and this route must
// still be flagged. Without this file a predicate that dropped the exclusions would score
// identically to the correct one.
import { revalidateTag } from "next/cache";
import { hasPermission } from "@/server/authz";

const db = { import: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const allowed = hasPermission(body);
  await db.import.create({ data: body });
  revalidateTag("imports");
  return Response.json({ ok: allowed });
}
