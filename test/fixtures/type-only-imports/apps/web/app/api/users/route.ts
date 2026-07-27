// T12: every binding below names the data layer, but only one creates a runtime dependency
// on it. TypeScript erases the rest, so flagging them is a false positive - they cannot
// perform data access at runtime because they do not exist at runtime.
import type { User } from "@/lib/db";
import { type Prisma, prisma } from "@/lib/db";

export async function GET(): Promise<Response> {
  // `prisma` is a value use and IS a genuine violation.
  const users: User[] = await prisma.user.findMany();
  const shape: Prisma | undefined = undefined;
  return Response.json({ users, shape });
}
