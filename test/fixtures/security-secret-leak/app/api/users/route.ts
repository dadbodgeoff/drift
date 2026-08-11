export async function GET() {
  const apiKey = process.env.API_KEY;
  return Response.json({ apiKey });
}
