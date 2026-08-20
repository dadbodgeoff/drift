import { prisma } from "@/lib/barrel";
export async function GET() { return Response.json(await prisma.user.findMany()); }
