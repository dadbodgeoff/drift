// S10: a bindingless side-effect import. There is no local binding, but importing a module
// for its side effects EXECUTES it - this route depends on @acme/database at runtime just as
// surely as `import { prisma } from "@acme/database"` does.
import "@acme/database";

export async function GET() {
  return new Response("ok");
}
