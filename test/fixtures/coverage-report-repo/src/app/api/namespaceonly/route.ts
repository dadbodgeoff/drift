// A namespace import of a real workspace package whose binding is never used in a value
// position. Member-level resolution stays conservative here by design, so this is a *named
// limitation* rather than a resolver bug - the shape doctor must describe with remediation.
import * as util from "@acme/util";

export async function GET() {
  return Response.json({ ok: true });
}
