// The namespace binding is never used anywhere. No runtime use is provable, so the engine
// must KEEP its conservative diagnostic here - dropping it would be a silent miss.
import * as unused from "@acme/database";

export async function GET() {
  return Response.json({ ok: true });
}
