import { withTeam } from "../../../lib/team";

export const GET = withTeam(async (req: Request) => {
  return Response.json({ path: new URL(req.url).pathname });
});
