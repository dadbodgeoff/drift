// Boundary (a): a stylesheet side-effect import is not a module dependency the resolver can
// or should follow. It must produce no import_decl node and no unresolved_import diagnostic -
// an unresolved_import on a route file makes the whole check refuse (exit 3).
import "./route.css";

export async function GET() {
  return new Response("ok");
}
