import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth";

export const GET = withAdmin(async (req) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json({ sso: q.get("page") });
});
