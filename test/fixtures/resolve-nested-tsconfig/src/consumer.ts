// Scope negative control: this file is OUTSIDE apps/web and apps/admin, so neither
// nested tsconfig's "@/lib/*" alias may apply to it. The import must stay unresolvable.
import { db } from "@/lib/db";

export async function listUsers() {
  return db;
}
