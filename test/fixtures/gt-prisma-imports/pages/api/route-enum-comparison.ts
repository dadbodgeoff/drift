// D5.2 SUPPRESS. A plain value import of a generated enum, read as a member and compared.
// This is the papermark shape: value position, so the fact survives, but reading
// `LinkType.GROUP` cannot touch the datastore.
import { LinkType } from "@prisma/client";

export default function handler(req: any, res: any) {
  if (req.query.kind === LinkType.GROUP) {
    return res.json({ grouped: true });
  }
  return res.json({ grouped: false });
}
