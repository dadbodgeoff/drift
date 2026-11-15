import { createHash } from "crypto";

// Not for security: a short cache key.
export function fingerprint(s: string): string {
  return createHash("md5").update(s).digest("hex").slice(0, 8);
}
