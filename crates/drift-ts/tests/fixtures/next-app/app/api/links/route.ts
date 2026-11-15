import { withAuth, prisma } from "@/lib";
import * as z from "zod";

export const GET = withAuth(
  async (req) => {
    const links = await prisma.link.findMany();
    return Response.json(links);
  },
  { requiredPermissions: ["links.read"] },
);

// drift-ignore D-abc123: public endpoint, verified by signature
// drift-ignore D-def456
export async function POST(req: Request) {
  try {
    const body = z.object({ url: z.string() }).parse(await req.json());
    return Response.json(body);
  } catch (e) {
    throw e;
  }
}

function shadowed() {
  // A local binding with the same name must not resolve to the import.
  const withAuth = (x: number) => x;
  return withAuth(1);
}
