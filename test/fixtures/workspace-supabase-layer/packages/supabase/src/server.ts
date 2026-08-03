// The data layer, identified by what it imports rather than what it is called. Nothing in this
// path or specifier contains prisma / database / db / data-access, which is exactly why the
// substring whitelist in candidate inference cannot see it.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createSupabaseClient("https://example.invalid", "anon-key");
}
