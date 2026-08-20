import { q } from "@/lib/member";
export async function GET() { return Response.json(await q.findMany()); }
