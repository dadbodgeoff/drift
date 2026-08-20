// E04, renamed. `name` is the exported name and `imported_name` the source symbol; recording only
// the alias would make this unresolvable in its target.
import { prisma } from "@/lib/prisma";
export { prisma as client };
