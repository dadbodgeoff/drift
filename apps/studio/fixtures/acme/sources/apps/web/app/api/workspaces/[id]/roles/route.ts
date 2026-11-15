import { db } from "@acme/db";
import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/auth";

export const GET = withWorkspace(async (req, { workspaceId }) => {
  const rows = await db.link.findMany({ where: { workspaceId, archived: false } });
  return NextResponse.json(rows);
});

export const POST = withWorkspace(async (req, { workspaceId }) => {
  const body = await req.json();
  return NextResponse.json(await db.link.create({ data: { ...body, workspaceId } }));
}, { requiredPermissions: ["roles.write"] });
