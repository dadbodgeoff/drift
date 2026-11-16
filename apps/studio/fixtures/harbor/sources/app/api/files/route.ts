import { withSession } from "../../../lib/session";
import { find } from "../../../lib/db";

export const GET = withSession(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("files", id));
});
