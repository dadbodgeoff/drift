import { getClient } from "@/lib/factory";
export async function GET() { return Response.json(await getClient().user.findMany()); }
