import { client } from "@/lib/alias";
export async function GET() { return Response.json(await client.user.findMany()); }
