// Boundary (b): a sibling package whose name merely shares a prefix with the data layer.
// It resolves to its OWN module, so it must never be attributed to @acme/database.
import "@acme/database-legacy";

export async function GET() {
  return new Response("ok");
}
