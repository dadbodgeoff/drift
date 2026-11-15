"use server";

import { db } from "@acme/db";

export async function banCustomer(workspaceId: string, id: string) {
  await db.member.delete({ where: { id, workspaceId } });
}
