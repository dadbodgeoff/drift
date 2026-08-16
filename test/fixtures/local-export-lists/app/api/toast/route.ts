import { toast, useToast } from "../../../components/ui/use-toast";
import { alpha, betaFn } from "../../../lib/only-list";
import { config } from "../../../lib/object-literal";

export async function GET() {
  return Response.json({ toast: String(toast), useToast: String(useToast), alpha, betaFn: String(betaFn), config });
}
