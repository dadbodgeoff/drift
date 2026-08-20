import { client } from "@/lib/renamed";
export async function GET() { return Response.json(await client.user.findMany()); }
