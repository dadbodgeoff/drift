import { serializePublicUser } from "../../../lib/serializers/user";

export async function GET() {
  const user = { email: "redacted@example.test" };
  const payload = serializePublicUser(user);
  return Response.json({ user: { email: payload.email } });
}
