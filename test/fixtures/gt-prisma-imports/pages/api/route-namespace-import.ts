// D5.2 RETAIN — a NAMESPACE binding that reaches the datastore.
//
// Every D5.2 route in this fixture before it was a named specifier, which is how a routing
// defect that fires on `import * as`, `await import()` and `require()` alike went unmeasured
// here while breaking S06/S07/S08 on all seven eval repos.
import * as store from "../../lib/prisma";

export default async function handler(req: any, res: any) {
  return res.json(await store.prismaClient.user.findMany());
}
