// Boundary (b): type-only import, erased at compile time. No runtime dependency, no finding.
import type { PrismaLike } from "@acme/database";

export async function GET() {
  const row: PrismaLike | null = null;
  return Response.json({ row });
}
