import { get } from "@/lib/arrow";
export async function GET() { return Response.json(await get().user.findMany()); }
