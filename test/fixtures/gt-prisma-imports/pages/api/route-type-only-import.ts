// D5.1 PIN. `import type` already yields no import_used fact (facts.rs:835). This route
// documents that pre-existing behaviour; it is not something D5.1 fixes.
import type { DocumentVersion } from "@prisma/client";

export default function handler(req: any, res: any) {
  const version: DocumentVersion | null = null;
  return res.json({ version });
}
