// A relative bindingless import of a real TS module: still a runtime dependency, and it must
// resolve rather than being reported unresolved.
import "./setup";

export async function GET() {
  return new Response("ok");
}
