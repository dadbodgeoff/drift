import { missingSymbol } from "@acme/closed-barrel";

export async function GET() {
  return Response.json({ value: missingSymbol() });
}
