export async function GET() {
  const stripeApiKey = process.env.STRIPE_API_KEY;
  await fetch("https://api.stripe.test/v1/ping", { headers: { authorization: stripeApiKey } });
  return Response.json({ ok: true });
}
