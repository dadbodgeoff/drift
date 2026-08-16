// D5.1 PIN. A plain VALUE import whose binding is only ever used in a type position. The
// runtime-use analysis (facts.rs, apply_runtime_use_analysis) already erases the fact.
import { ItemType } from "@prisma/client";

export default function handler(req: any, res: any) {
  const kind: ItemType | null = null;
  return res.json({ kind });
}
