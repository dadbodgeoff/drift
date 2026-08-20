import { client } from "@/lib/external";
export async function GET() { return Response.json(await client.user.findMany()); }
