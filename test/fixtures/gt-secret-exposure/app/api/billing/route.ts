export async function GET() {
  const stripeApiKey = process.env.STRIPE_API_KEY;
  return Response.json({ ok: true, stripeApiKey });
}
