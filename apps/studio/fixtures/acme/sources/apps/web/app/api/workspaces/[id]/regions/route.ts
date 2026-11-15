import { db } from "@acme/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return NextResponse.json(await db.link.findMany({ where: { workspaceId: id } }));
}
