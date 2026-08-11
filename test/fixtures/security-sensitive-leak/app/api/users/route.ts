export async function GET() {
  const email = "redacted@example.test";
  return Response.json({ user: { email } });
}
