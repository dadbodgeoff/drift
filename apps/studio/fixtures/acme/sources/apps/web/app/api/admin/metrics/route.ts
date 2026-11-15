import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth";
import { eventsFor } from "@/lib/analytics";

export const GET = withAdmin(async (req) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await eventsFor(q.get("workspace") ?? "", q.get("by") ?? "day"));
});
