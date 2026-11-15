import { createSafeActionClient } from "next-safe-action";
import { getSession } from "../auth";

export const actionClient = createSafeActionClient();

export const authActionClient = actionClient.use(async ({ next }) => {
  const session = await getSession(new Request("http://internal"));
  return next({ ctx: { userId: session.userId } });
});
