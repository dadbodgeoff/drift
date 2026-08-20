import { getClient } from "@/lib/asyncfn";
export async function GET() { return Response.json(await (await getClient()).user.findMany()); }
