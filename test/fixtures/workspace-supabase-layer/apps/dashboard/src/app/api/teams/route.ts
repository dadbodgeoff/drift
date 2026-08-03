// The violation, written the way midday's routes write it: a workspace package NAME plus a
// subpath, where the wrapper lives at packages/supabase/src/server.ts. Tail-matching the
// specifier against the path cannot work here - `@acme/supabase/server` shares no tail with
// `packages/supabase/src/server`.
import { createClient } from "@acme/supabase/server";

export async function GET() {
  const client = createClient();
  return Response.json({ ok: Boolean(client) });
}
