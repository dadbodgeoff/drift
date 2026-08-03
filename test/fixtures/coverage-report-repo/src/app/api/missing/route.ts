// An import Drift classifies as should-be-local (the `@/*` alias matches) and cannot place:
// exactly one `unresolved_import`, which is the numerator of the resolution rate.
import { soon } from "@/lib/not-written-yet";

export async function GET() {
  return Response.json({ soon });
}
