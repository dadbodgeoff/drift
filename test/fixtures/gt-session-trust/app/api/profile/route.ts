// CONFORMANCE: the session object comes from the accepted trusted helper, so the phase-4 proof
// is required for this route AND proven, which is what makes its silence evidence of evaluation
// rather than evidence of a skip.
import { requireUser } from "@/server/auth";

export async function GET(request: Request) {
  const session = await requireUser(request);
  return Response.json({ userId: session.id });
}
