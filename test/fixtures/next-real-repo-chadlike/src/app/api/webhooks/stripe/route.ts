import { getCurrentSession } from "~/lib/server/auth/session";
import { stripe } from "~/lib/server/payment";
import { prisma } from "~/lib/server/db";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  const event = await stripe.webhooks.constructEventAsync(await request.text(), "sig", "secret");
  await prisma.webhook.create({ data: { type: event.type, userId: session?.userId ?? null } });
  return Response.json({ received: true });
}
