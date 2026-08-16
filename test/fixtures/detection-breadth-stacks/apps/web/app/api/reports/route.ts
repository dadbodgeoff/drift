// The ordinary shape, in scope before W7 and after: a handler under app/api.
import { NextResponse } from "next/server";
import { listReports } from "@/lib/reports";

export async function GET() {
  return NextResponse.json(await listReports());
}
