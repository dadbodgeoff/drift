import { prisma } from "@/lib/detached";
export async function GET() { return Response.json(await prisma.user.findMany()); }
