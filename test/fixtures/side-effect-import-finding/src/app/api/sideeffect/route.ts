// EW-1 / S10. A bindingless import of the forbidden module. It binds no symbol, so the
// evidence for the finding it produces has no symbol to name - only the specifier. This
// route exists to prove the evidence payload is still well-formed in that state, since
// every other finding in the codebase carries a symbol.
import "@/lib/prisma";

export async function GET() {
  return new Response("ok");
}
