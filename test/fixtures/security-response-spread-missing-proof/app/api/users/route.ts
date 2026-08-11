export async function GET() {
  const user = { email: "redacted@example.test" };
  return Response.json({ ...user });
}
