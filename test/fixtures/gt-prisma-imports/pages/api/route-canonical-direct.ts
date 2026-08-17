// D5.2 RETAIN — the canonical direct import, in the exact body `evasion-matrix.mjs` uses.
//
// This is the shape D5.2 regressed on: `const __h = <binding>; void __h;` is how every evasion
// catch cell marks an injected import as used, and the classifier called it Inert and suppressed
// the finding, turning S01-control-canonical from `warned`/`blocked` into `evaded` on all seven
// eval repos.
//
// Binding the whole data-access surface to a local and discarding it is not proof of inertness.
// It is proof only that THIS expression did not call it — the retain branch, not the suppress
// branch. Keep this route byte-comparable to the harness body it stands in for.
import { prismaClient } from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  const __h = prismaClient;
  void __h;
  return res.json({ ok: true });
}
