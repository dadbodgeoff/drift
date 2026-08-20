import { getClient } from "@/lib/conditional";
export async function GET() { return Response.json(await getClient(true).user.findMany()); }
