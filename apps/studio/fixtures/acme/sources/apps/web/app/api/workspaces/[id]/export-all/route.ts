import { db } from "@acme/db";
import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/auth";

export const GET = withWorkspace(async (req, { workspaceId }) => {
  const rows = await db.link.count({ where: { workspaceId, archived: false } });
  return NextResponse.json({ rows });
});
