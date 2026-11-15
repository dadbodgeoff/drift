import { db } from "@acme/db";

export async function eventsFor(workspaceId: string, groupBy: string) {
  return db.$queryRawUnsafe(`SELECT ${groupBy}, count(*) FROM events WHERE workspace_id = '${workspaceId}' GROUP BY 1`);
}
