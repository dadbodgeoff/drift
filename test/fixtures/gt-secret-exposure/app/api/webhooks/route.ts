export async function GET() {
  const stripeApiKey = process.env.STRIPE_API_KEY;
  console.error("stripe webhook verification failed", stripeApiKey);
  return Response.json({ ok: true });
}
