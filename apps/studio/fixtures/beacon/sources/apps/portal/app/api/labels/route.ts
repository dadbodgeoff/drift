import { withSession } from "../../../lib/session";

export const GET = withSession(async (req: Request) => {
  return Response.json({ ok: true, path: new URL(req.url).pathname });
});
