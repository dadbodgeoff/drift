// D5.1 GROUPING + D5.2 SUPPRESS. Three offending specifiers on one import line, all inert.
// Baseline: three findings. After D5.1: one. After D5.2: none.
import { ItemType, ViewType, LinkAudienceType } from "@prisma/client";

export default function handler(req: any, res: any) {
  const item = req.query.i === ItemType.FOLDER;
  const view = req.query.v === ViewType.DATAROOM;
  const audience = req.query.a === LinkAudienceType.GROUP;
  return res.json({ item, view, audience });
}
