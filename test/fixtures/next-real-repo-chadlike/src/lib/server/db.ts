export const prisma = {
  user: { findUnique: async (_args?: unknown) => ({ id: "u1", email: "user@example.com" }) },
  otp: {
    create: async (_args?: unknown) => ({ id: "otp1" }),
    findFirst: async () => ({ email: "user@example.com" })
  },
  webhook: { create: async (_args?: unknown) => ({ id: "evt1" }) }
};
