"use server";

import { db } from "@acme/db";
import { idSchema } from "../zod";
import { authActionClient } from "./safe-action";

export const exportEventsAction = authActionClient
  .inputSchema(idSchema)
  .action(async ({ parsedInput }) => {
    await db.link.findMany({ where: { workspaceId: parsedInput.workspaceId } });
    return { ok: true };
  });
