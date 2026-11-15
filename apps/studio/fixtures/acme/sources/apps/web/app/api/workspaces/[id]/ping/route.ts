import { NextResponse } from "next/server";

// drift-ignore D-ed1ec0: load balancer health probe, intentionally public
// drift-ignore D-b0d245: load balancer health probe, intentionally public
export async function GET() {
  return NextResponse.json({ ok: true });
}
