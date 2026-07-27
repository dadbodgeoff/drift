import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function fileContentHash(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}
