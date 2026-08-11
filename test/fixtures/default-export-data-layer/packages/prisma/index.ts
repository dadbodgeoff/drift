// cal.com's packages/prisma/index.ts shape, reduced: the client is declared, exported by name, and
// then exported again as the default on a line of its own. That last line is the whole fixture -
// `export default prisma;` wraps no declaration, so it used to emit no export fact at all, and every
// route writing `import prisma from "@acme/prisma"` inherited an unresolved symbol on the one import
// its finding rests on.
import { PrismaClient } from "@prisma/client";

export const prisma: PrismaClient = new PrismaClient();

export default prisma;
