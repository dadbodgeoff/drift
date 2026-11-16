import { find } from "../../../lib/db";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("refunds", id));
}
