// Value-syntax namespace import used ONLY in type positions: TypeScript erases it at
// compile time, so it creates no runtime dependency and must not count as runtime use.
import * as T from "@acme/database";
import type { PrismaLike } from "@acme/database";

type Row = T.PrismaLike;
type Version = keyof typeof T;

export async function GET() {
  const row: Row | null = null;
  const version: Version | null = null;
  const marker: PrismaLike | null = null;
  return Response.json({ row, version, marker });
}
