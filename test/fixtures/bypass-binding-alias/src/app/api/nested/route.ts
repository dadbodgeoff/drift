import { getClient } from "@/lib/nested";
export async function GET() { return Response.json(getClient()); }
