import { db } from "@acme/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).pathname.split("/")[3];
  const archived = await db.link.count({ where: { workspaceId, archived: false } });
  return NextResponse.json({ archived });
}
