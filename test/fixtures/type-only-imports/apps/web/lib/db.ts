export type User = { id: string; email: string };
export type Prisma = { user: { findMany: () => Promise<User[]> } };
export const prisma: Prisma = { user: { findMany: async () => [] } };
