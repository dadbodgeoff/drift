import { widen } from "@acme/lib/constants";

export async function GET() {
  return Response.json({ value: widen("ok") });
}
