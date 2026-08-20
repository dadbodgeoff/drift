import { client } from "@/lib/reassigned";
export async function GET() { return Response.json(await client.user.findMany()); }
