import { getClient } from "@/lib/shadowed";
export async function GET() { return Response.json(getClient()); }
