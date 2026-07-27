import { requireAllowedOutboundUrl } from "@/security/outbound";

export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = requireAllowedOutboundUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
