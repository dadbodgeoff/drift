import { requireMember } from "../../../lib/members";
import { find } from "../../../lib/db";

export async function GET(req: Request) {
  await requireMember();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json(await find("payouts", id));
}
