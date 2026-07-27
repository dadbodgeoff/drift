import { prisma } from "~/lib/server/db";

export const stripe = {
  webhooks: {
    constructEventAsync: async (_body: string, _signature: string, _secret: string) => {
      await prisma.webhook.create({ data: { type: "payment.probe" } });
      return { type: "checkout.session.completed" };
    }
  }
};
